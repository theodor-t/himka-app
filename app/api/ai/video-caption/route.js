import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getUserRole,
  SESSION_COOKIE,
  verifySessionToken,
} from "../../../lib/auth";
import { roleCanWriteCollection } from "../../../lib/access-control.mjs";
import {
  AI_CAPTION_LANGUAGES,
  AI_CAPTION_SERVICES,
  AI_CAPTION_STYLES,
  AI_CAPTION_TONES,
  normalizeAiCaptionOutput,
} from "../../../lib/ai-caption.mjs";

export const maxDuration = 60;

const findOption = (options, id) => options.find((option) => option.id === id);

export async function POST(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!roleCanWriteCollection(getUserRole(username), "videoDescriptions")) {
      return NextResponse.json({ error: "Недостаточно прав для генерации описания" }, { status: 403 });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    const service = findOption(AI_CAPTION_SERVICES, input?.serviceId);
    const language = findOption(AI_CAPTION_LANGUAGES, input?.languageId);
    const tone = findOption(AI_CAPTION_TONES, input?.toneId);
    const style = findOption(AI_CAPTION_STYLES, input?.styleId);
    if (!service || !language || !tone || !style) {
      return NextResponse.json({ error: "Выберите услугу, язык, тон и подачу описания" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini не настроен: задайте GEMINI_API_KEY на сервере" }, { status: 503 });
    }
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
      throw new Error("Invalid GEMINI_MODEL configuration");
    }
    const fallbackModel = model === "gemini-3.8-flash"
      ? "gemini-3.5-flash-lite"
      : "gemini-3.8-flash";
    const models = [...new Set([model, fallbackModel])];

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{
          text: `Ты создаёшь короткие подписи для видео детейлинг-мастерской. Пиши на ${language.instruction}. Не добавляй имена, телефоны, номера автомобилей, цены, гарантии или неподтверждённые факты. Верни только JSON по указанной схеме.`,
        }],
      },
      contents: [{
        parts: [{
          text: `Услуга: ${service.label}. Тон: ${tone.label}. Формат: ${style.label}. Создай естественную подпись без выдуманных деталей и 3–6 тематических хэштегов.`,
        }],
      }],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            caption: { type: "STRING" },
            hashtags: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["caption", "hashtags"],
        },
      },
    });

    let result;
    let lastFailure;
    for (const [index, selectedModel] of models.entries()) {
      let response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: requestBody,
            signal: AbortSignal.timeout(18000),
          },
        );
      } catch (error) {
        if (error.name !== "TimeoutError" || index === models.length - 1) throw error;
        lastFailure = { status: 504, message: "Время ожидания ответа модели истекло." };
        continue;
      }

      if (response.ok) {
        try {
          result = await response.json();
        } catch {
          return NextResponse.json({ error: "Gemini вернул некорректный ответ" }, { status: 502 });
        }
        break;
      }

      let providerMessage = "";
      try {
        const providerError = await response.json();
        providerMessage = typeof providerError?.error?.message === "string"
          ? providerError.error.message.slice(0, 300)
          : "";
      } catch {
        providerMessage = "";
      }
      lastFailure = { status: response.status, message: providerMessage };
      if (![429, 503].includes(response.status) || index === models.length - 1) break;
    }

    if (!result) {
      const { status, message } = lastFailure || { status: 502, message: "" };
      if (status === 503) {
        return NextResponse.json({
          error: "Gemini временно перегружен. Попробуйте ещё раз через минуту.",
          details: message,
        }, { status: 503 });
      }
      if (status === 429) {
        return NextResponse.json({
          error: "Достигнут лимит запросов Gemini. Проверьте квоту и тариф API в Google AI Studio.",
          details: message,
        }, { status: 429 });
      }
      if (status === 403 || status === 401) {
        return NextResponse.json({
          error: "Google отклонил API-ключ. Проверьте ключ и доступ к Gemini API.",
          details: message,
        }, { status: 502 });
      }
      if (status === 404) {
        return NextResponse.json({
          error: "Модель Gemini не найдена. Проверьте значение GEMINI_MODEL в Vercel.",
          details: message,
        }, { status: 502 });
      }
      if (status === 504) {
        return NextResponse.json({
          error: "Gemini не ответил вовремя. Попробуйте ещё раз.",
          details: message,
        }, { status: 504 });
      }
      return NextResponse.json({
        error: "Не удалось получить ответ от Gemini.",
        details: message,
      }, { status: 502 });
    }

    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("");
    try {
      return NextResponse.json(normalizeAiCaptionOutput(JSON.parse(text)));
    } catch (error) {
      return NextResponse.json(
        { error: error.message || "Gemini вернул ответ в неподдерживаемом формате" },
        { status: 502 },
      );
    }
  } catch (error) {
    const status = error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json(
      { error: status === 504 ? "Gemini не ответил вовремя. Повторите попытку." : error.message },
      { status },
    );
  }
}
