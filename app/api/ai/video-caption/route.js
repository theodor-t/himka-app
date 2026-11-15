import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getUserRole,
  SESSION_COOKIE,
  verifySessionToken,
} from "../../../lib/auth";
import { roleCanWriteCollection } from "../../../lib/access-control.mjs";
import {
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
    const tone = findOption(AI_CAPTION_TONES, input?.toneId);
    const style = findOption(AI_CAPTION_STYLES, input?.styleId);
    if (!service || !tone || !style) {
      return NextResponse.json({ error: "Выберите услугу, тон и формат описания" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini не настроен: задайте GEMINI_API_KEY на сервере" }, { status: 503 });
    }
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
      throw new Error("Invalid GEMINI_MODEL configuration");
    }
    const models = [...new Set([model, "gemini-3.6-flash"])];

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "Ты создаёшь короткие подписи для видео детейлинг-мастерской. Пиши по-русски. Не добавляй имена, телефоны, номера автомобилей, цены, гарантии или неподтверждённые факты. Верни только JSON по указанной схеме.",
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

    let response;
    let providerMessage = "";
    for (const [index, selectedModel] of models.entries()) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: requestBody,
          signal: AbortSignal.timeout(25000),
        },
      );
      if (response.ok || response.status !== 503 || index === models.length - 1) break;
    }

    if (!response.ok) {
      if (!providerMessage) {
        try {
          const providerError = await response.json();
          providerMessage = typeof providerError?.error?.message === "string"
            ? providerError.error.message.slice(0, 300)
            : "";
        } catch {
          providerMessage = "";
        }
      }
      return NextResponse.json(
        {
          error: providerMessage
            ? `Gemini не выполнил запрос (HTTP ${response.status}): ${providerMessage}`
            : `Gemini не выполнил запрос (HTTP ${response.status})`,
        },
        { status: 502 },
      );
    }

    let result;
    try {
      result = await response.json();
    } catch {
      return NextResponse.json({ error: "Gemini вернул некорректный ответ" }, { status: 502 });
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
