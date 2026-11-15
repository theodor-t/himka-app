import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserRole, SESSION_COOKIE, verifySessionToken } from "../../../lib/auth";
import { roleCanViewPage } from "../../../lib/access-control.mjs";
import { normalizeDatabase } from "../../../lib/database.mjs";
import {
  advisorFactsForAi,
  answerAdvisorQuestion,
  buildAdvisorAnalytics,
  buildAdvisorInsights,
  inferAdvisorQuestionPeriod,
} from "../../../lib/business-advisor.mjs";
import { consumeRateLimit } from "../../../lib/ai-rate-limit.mjs";
import {
  getLocalPreviewDatabase,
  isLocalPreviewRequest,
} from "../../../lib/local-preview.mjs";

export const maxDuration = 45;

const ALLOWED_PERIODS = new Set(["today", "week", "month", "lastMonth", "last3Months", "year", "custom"]);
const jsonError = (error, status) => NextResponse.json({ error }, { status });

async function readDatabase(request) {
  if (isLocalPreviewRequest(request)) return getLocalPreviewDatabase();
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google database is not configured");
  const url = new URL(scriptUrl);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || payload.error || Number(payload.status) >= 400) {
    throw new Error(payload.error || `Google database read failed (${response.status})`);
  }
  return normalizeDatabase(payload);
}

function cleanText(value, maximum = 600) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function redactSensitiveText(value, customers) {
  let text = cleanText(value, 600);
  for (const customer of customers) {
    const name = String(customer.name || "").trim();
    if (name.length >= 2) {
      text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[client]");
    }
  }
  return text.replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[redacted number]");
}

function cleanAiNarrative(value, fallback) {
  const text = cleanText(value, 500)
    .replace(/\b\d[\d\s.,]*(?:%|MDL|lei)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function asksForRecommendation(question) {
  return /рекоменд|совет|что (?:делать|улучшить|стоит)|как (?:увеличить|улучшить)|предложи|порекомендуй|recomand|ce ar trebui|ce să fac|ce putem face|cum putem|sfat/i.test(question);
}

function sanitizeConversation(history, customers) {
  if (!Array.isArray(history)) return [];
  return history.slice(-6).flatMap((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return [];
    const content = redactSensitiveText(message.content, customers);
    return content ? [{ role: message.role, content }] : [];
  });
}

function geminiErrorMessage(status, mode = "crm") {
  if (status === 429) return "Достигнут лимит запросов Gemini. Попробуйте позже.";
  if (status === 503) {
    return mode === "general"
      ? "Gemini временно недоступен. Попробуйте позже."
      : "Gemini временно недоступен. Фактические данные CRM рассчитаны.";
  }
  if (status === 401 || status === 403) return "Google отклонил API-ключ Gemini.";
  if (status === 404) return "Модель Gemini не найдена. Проверьте GEMINI_MODEL.";
  if (status === 504) {
    return mode === "general"
      ? "Gemini не ответил вовремя. Попробуйте ещё раз."
      : "Gemini не ответил вовремя. Фактические данные CRM рассчитаны.";
  }
  return "Не удалось получить анализ Gemini. Фактические данные CRM рассчитаны.";
}

async function requestGemini({ apiKey, model, schema, instruction, contents, mode = "crm" }) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
    throw new Error("Invalid GEMINI_MODEL configuration");
  }
  const fallbackModel = model === "gemini-3.8-flash"
    ? "gemini-3.5-flash-lite"
    : "gemini-3.8-flash";
  let lastStatus = 502;
  for (const [index, selectedModel] of [...new Set([model, fallbackModel])].entries()) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1400,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
        signal: AbortSignal.timeout(18_000),
      },
    );
    if (response.ok) {
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!text) throw new Error("Gemini вернул пустой ответ.");
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Gemini вернул ответ в неподдерживаемом формате.");
      }
    }
    lastStatus = response.status;
    if (![429, 503].includes(response.status) || index === 1) break;
  }
  const error = new Error(geminiErrorMessage(lastStatus, mode));
  error.status = lastStatus;
  throw error;
}

const CHAT_SCHEMA = {
  type: "OBJECT",
  properties: {
    analysis: { type: "STRING" },
    recommendation: { type: "STRING" },
  },
  required: ["analysis"],
};

const GENERAL_CHAT_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" } },
  required: ["answer"],
};

const INSIGHTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    insights: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          explanation: { type: "STRING" },
          recommendation: { type: "STRING" },
        },
        required: ["id", "explanation", "recommendation"],
      },
    },
  },
  required: ["insights"],
};

export async function POST(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return jsonError("Unauthorized", 401);
    const role = getUserRole(username);
    if (!roleCanViewPage(role, "businessAdvisor")) {
      return jsonError("Недостаточно прав для доступа к бизнес-аналитике.", 403);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return jsonError("Некорректный запрос.", 400);
    }
    const action = input?.action || "chat";
    if (!["chat", "analyze"].includes(action)) return jsonError("Неизвестное действие.", 400);
    const mode = input?.mode || "crm";
    if (action === "chat" && !["crm", "general"].includes(mode)) {
      return jsonError("Неизвестный режим чата.", 400);
    }
    const period = ALLOWED_PERIODS.has(input?.period) ? input.period : "month";
    const language = ["ru", "ro"].includes(input?.language) ? input.language : "ru";
    const question = cleanText(input?.question, 600);
    if (action === "chat" && !question) return jsonError("Введите вопрос.", 400);
    if (action === "chat" && String(input?.question || "").length > 600) {
      return jsonError("Вопрос слишком длинный. Максимум 600 символов.", 400);
    }
    if (action === "analyze" && !question) {
      input.question = "Сформируй объяснения для подтверждённых бизнес-инсайтов.";
    }
    const rateLimit = consumeRateLimit(username, 12, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Слишком много запросов к бизнес-советнику. Подождите минуту.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    if (action === "chat" && mode === "general") {
      if (!apiKey) return jsonError("Общий AI-режим недоступен: Gemini не настроен на сервере.", 503);
      const history = sanitizeConversation(input?.history, []);
      const generated = await requestGemini({
        apiKey,
        model,
        schema: GENERAL_CHAT_SCHEMA,
        mode: "general",
        instruction: "Ты обычный универсальный AI-ассистент. Отвечай на конкретный вопрос пользователя на языке ru или ro из запроса, учитывай предыдущие сообщения и сохраняй контекст диалога. Помогай с объяснениями, идеями, письмом, переводом, обучением и планированием. В этом режиме у тебя нет доступа к CRM и веб-поиску: не утверждай, что проверил внешние источники или актуальные данные. Если вопрос требует свежей информации, честно обозначь ограничение. Не добавляй нерелевантные советы.",
        contents: [{
          role: "user",
          parts: [{
            text: JSON.stringify({
              language,
              history,
              question,
            }),
          }],
        }],
      });
      const answer = cleanText(generated?.answer, 2500);
      if (!answer) return jsonError("Gemini вернул пустой ответ.", 502);
      return NextResponse.json({
        ok: true,
        aiAvailable: true,
        mode: "general",
        answer: { text: answer },
        analysis: "",
        recommendation: "",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const database = await readDatabase(request);
    const inferredPeriod = action === "chat" && mode === "crm"
      ? inferAdvisorQuestionPeriod(question)
      : null;
    const analytics = buildAdvisorAnalytics(database, {
      period: inferredPeriod?.period || period,
      from: inferredPeriod?.from || input?.from,
      to: inferredPeriod?.to || input?.to,
    });
    const insights = buildAdvisorInsights(analytics, database);
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        aiAvailable: false,
        aiError: "Gemini не настроен. Фактические показатели и правила CRM доступны, AI-анализ отключён.",
        ...(action === "chat" ? { answer: answerAdvisorQuestion(analytics, question, language), analysis: "", recommendation: "" } : { insights }),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const evidence = advisorFactsForAi(analytics, insights);
    if (action === "analyze") {
      if (!insights.length) {
        return NextResponse.json({
          ok: true,
          aiAvailable: true,
          aiError: "",
          insights: [],
          note: "По выбранному периоду нет отклонений, подтверждённых достаточными данными.",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      const customers = database.customers || [];
      const prompt = JSON.stringify({
        evidence,
        candidates: insights.map(({ id, title, explanation, whyItMatters, recommendation, supportingData }) => ({
          id, title, explanation, whyItMatters, recommendation, supportingData,
        })),
        language,
      });
      const generated = await requestGemini({
        apiKey,
        model,
        schema: INSIGHTS_SCHEMA,
        instruction: "Ты аналитик ANGEL DETAILING CRM. Переформулируй только переданные подтверждённые инсайты и рекомендации. Не добавляй цифры, имена, причины, обещания или новые события. Для каждого ответа используй только существующий id. Пиши на языке ru или ro из запроса.",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const byId = new Map((Array.isArray(generated?.insights) ? generated.insights : [])
        .filter((item) => insights.some((insight) => insight.id === item?.id))
        .map((item) => [item.id, item]));
      return NextResponse.json({
        ok: true,
        aiAvailable: true,
        aiError: "",
        insights: insights.map((insight) => {
          const generatedInsight = byId.get(insight.id);
          return generatedInsight
            ? {
                ...insight,
                aiExplanation: cleanAiNarrative(generatedInsight.explanation, insight.explanation),
                aiRecommendation: cleanAiNarrative(generatedInsight.recommendation, insight.recommendation),
              }
            : insight;
        }),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const factAnswer = answerAdvisorQuestion(analytics, question, language);
    const recentQuestions = sanitizeConversation(input?.history, database.customers || []);
    recentQuestions.push({ role: "user", content: redactSensitiveText(question, database.customers || []) });
    const prompt = JSON.stringify({
      language,
      question: redactSensitiveText(question, database.customers || []),
      recentQuestions,
      verifiedEvidence: evidence,
      instruction: "The UI separately displays exact values computed by CRM. Do not output new numbers, customer identities, vehicle details, causes not proved by the evidence, or actions that modify CRM.",
    });
    let analysis = "";
    let recommendation = "";
    let aiError = "";
    try {
      const generated = await requestGemini({
        apiKey,
        model,
        schema: CHAT_SCHEMA,
        instruction: "Ты AI бизнес-советник ANGEL DETAILING. Сначала ответь именно на заданный вопрос, используя только verifiedEvidence и контекст диалога. Если доказательств недостаточно — прямо укажи, каких данных не хватает; не подменяй ответ общими советами и не повторяй сводку показателей. Для вопроса об источнике объясни, что цифры рассчитываются сервером по записям CRM за выбранный период, а тебе передаются агрегированные факты. Не выдумывай клиентов, заказы, платежи или причины. Не предлагай менять CRM или отправлять сообщения. В recommendation дай совет только если пользователь просит рекомендацию или совет действительно следует из вопроса; иначе верни пустую строку. Не включай цифры, даты, проценты или имена: точные факты отображаются отдельно. Язык ru или ro указан в запросе.",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      analysis = cleanAiNarrative(generated?.analysis, "");
      if (asksForRecommendation(question)) {
        recommendation = cleanAiNarrative(generated?.recommendation, "");
      }
    } catch (error) {
      aiError = error instanceof Error ? error.message : "Gemini временно недоступен.";
    }
    return NextResponse.json({
      ok: true,
      aiAvailable: Boolean(analysis || recommendation),
      aiError,
      answer: factAnswer,
      analysis,
      recommendation,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /даты начала и окончания/.test(error.message)) {
      return jsonError(error.message, 400);
    }
    return jsonError(
      error instanceof Error ? error.message : "Business Advisor failed.",
      error?.status || 500,
    );
  }
}
