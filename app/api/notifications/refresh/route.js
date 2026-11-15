import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserRole, SESSION_COOKIE, verifySessionToken } from "../../../lib/auth";
import { roleCanWriteCollection } from "../../../lib/access-control.mjs";
import { normalizeDatabase } from "../../../lib/database.mjs";
import {
  buildSystemNotifications,
  reconcileSmartNotifications,
} from "../../../lib/notifications.mjs";
import {
  getLocalPreviewDatabase,
  isLocalPreviewRequest,
  setLocalPreviewDatabase,
} from "../../../lib/local-preview.mjs";

export const maxDuration = 60;

const jsonError = (error, status) => NextResponse.json({ error }, { status });

function secretMatches(supplied, expected) {
  if (!supplied || !expected) return false;
  const first = Buffer.from(supplied);
  const second = Buffer.from(expected);
  return first.length === second.length && timingSafeEqual(first, second);
}

async function authorizedCaller(request) {
  const expectedSecret = process.env.NOTIFICATION_CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (secretMatches(suppliedSecret, expectedSecret)) {
    return { type: "cron", username: "Система" };
  }

  const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!username) return null;
  if (!roleCanWriteCollection(getUserRole(username), "notifications")) return null;
  return { type: "session", username };
}

async function readRemoteDatabase() {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google database is not configured");
  const url = new URL(scriptUrl);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { cache: "no-store", redirect: "follow" });
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
  return { database: normalizeDatabase(payload), url, apiKey };
}

async function persistRemoteNotifications(url, apiKey, notifications) {
  url.searchParams.set("action", "mergeNotifications");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notifications }),
    redirect: "follow",
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || payload.error || Number(payload.status) >= 400) {
    throw new Error(payload.error || `Google notification save failed (${response.status})`);
  }
}

async function claimAiRequestSlot(url, apiKey) {
  const claimUrl = new URL(url);
  claimUrl.searchParams.set("action", "claimNotificationAiSlot");
  claimUrl.searchParams.set("key", apiKey);
  const response = await fetch(claimUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    redirect: "follow",
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || payload.error || Number(payload.status) >= 400) {
    throw new Error(payload.error || `Google AI request limit failed (${response.status})`);
  }
  return payload.granted === true;
}

function aiFacts(notification) {
  const allowed = [
    "hoursUntil",
    "daysLate",
    "daysSinceVisit",
    "daysSinceRegistration",
    "completedVisits",
    "vehicleCount",
    "vehiclesWithHistory",
    "quantity",
    "minimum",
    "overlapMinutes",
    "balanceCents",
    "last30Days",
    "previous30Days",
    "changePercent",
    "currentClients",
    "previousClients",
    "currentServiceVisits",
    "previousServiceVisits",
    "hasOrder",
    "currentRevenueCents",
    "previousRevenueCents",
    "dropPercent",
  ];
  return Object.fromEntries(
    allowed.filter((key) => Number.isFinite(notification.facts?.[key]))
      .map((key) => [key, notification.facts[key]]),
  );
}

function cleanText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 360) : fallback;
}

async function enrichWithGemini(notifications, allowRequest = true) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { notifications, warning: "Gemini не настроен; используются проверенные правила." };

  const pending = notifications
    .filter((item) => item.smart && item.status === "active" && item.aiFingerprint !== item.fingerprint)
    .slice(0, 10);
  if (!pending.length) return { notifications, warning: "" };
  if (!allowRequest) {
    return { notifications, warning: "Достигнут лимит AI-запросов; уведомления сохранены по правилам CRM." };
  }

  const tokenMap = new Map(pending.map((item, index) => [`N${index + 1}`, item.id]));
  const input = pending.map((item, index) => ({
    ref: `N${index + 1}`,
    category: item.category,
    priority: item.priority,
    title: item.title,
    verifiedMetrics: aiFacts(item),
  }));
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
    throw new Error("Invalid GEMINI_MODEL configuration");
  }
  const fallbackModel = model === "gemini-3.8-flash"
    ? "gemini-3.5-flash-lite"
    : "gemini-3.8-flash";
  const requestBody = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "Ты помощник CRM. Объясняй только подтверждённые метрики из входных данных. Не делай предположений и не добавляй факты. Не запрашивай и не раскрывай персональные данные. Рекомендации должны быть только советом: никаких автоматических изменений или отправки сообщений. Верни короткий JSON для каждого ref.",
      }],
    },
    contents: [{ parts: [{ text: JSON.stringify(input) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1400,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          notifications: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                ref: { type: "STRING" },
                explanation: { type: "STRING" },
                recommendation: { type: "STRING" },
              },
              required: ["ref", "explanation", "recommendation"],
            },
          },
        },
        required: ["notifications"],
      },
    },
  });

  let providerError = "";
  let result;
  for (const [index, selectedModel] of [model, fallbackModel].entries()) {
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: requestBody,
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      providerError = error.name === "TimeoutError" ? "Gemini не ответил вовремя." : error.message;
      break;
    }
    if (response.ok) {
      try {
        result = await response.json();
      } catch {
        providerError = "Gemini вернул некорректный ответ.";
        break;
      }
      break;
    }
    providerError = `Gemini вернул ошибку ${response.status}.`;
    if (![429, 503].includes(response.status) || index === 1) break;
  }

  let generated = [];
  if (result) {
    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    try {
      const parsed = JSON.parse(text);
      generated = Array.isArray(parsed?.notifications) ? parsed.notifications : [];
      if (!Array.isArray(parsed?.notifications)) {
        providerError = "Gemini вернул ответ в неподдерживаемом формате.";
      }
    } catch {
      providerError = "Gemini вернул ответ в неподдерживаемом формате.";
    }
  }
  const byRef = new Map(generated
    .filter((item) => item && tokenMap.has(item.ref))
    .map((item) => [item.ref, item]));
  const enrichedById = new Map(pending.map((item, index) => {
    const response = byRef.get(`N${index + 1}`);
    return [item.id, {
      ...item,
      aiExplanation: cleanText(response?.explanation, item.explanation),
      aiRecommendation: cleanText(response?.recommendation, item.recommendation),
      aiFingerprint: response ? item.fingerprint : "",
      aiGenerated: Boolean(response),
    }];
  }));
  return {
    notifications: notifications.map((item) => enrichedById.get(item.id) || item),
    warning: providerError,
  };
}

export async function POST(request) {
  try {
    const caller = await authorizedCaller(request);
    if (!caller) return jsonError("Unauthorized", 401);

    const localPreview = caller.type === "session" && isLocalPreviewRequest(request);
    let database;
    let remote;
    if (localPreview) {
      database = getLocalPreviewDatabase();
    } else {
      remote = await readRemoteDatabase();
      database = remote.database;
    }

    const now = new Date();
    const candidates = buildSystemNotifications(database, now);
    let notifications = reconcileSmartNotifications(database.notifications, candidates, now);
    let allowAiRequest = localPreview;
    let limitWarning = "";
    const needsAi = notifications.some((item) =>
      item.smart && item.status === "active" && item.aiFingerprint !== item.fingerprint,
    );
    if (!localPreview && process.env.GEMINI_API_KEY && needsAi) {
      try {
        allowAiRequest = await claimAiRequestSlot(remote.url, remote.apiKey);
      } catch (error) {
        limitWarning = error instanceof Error ? error.message : "Не удалось проверить лимит AI-запросов.";
      }
    }
    const enriched = await enrichWithGemini(notifications, allowAiRequest);
    notifications = enriched.notifications;

    if (localPreview) {
      database = setLocalPreviewDatabase({ ...database, notifications });
    } else {
      await persistRemoteNotifications(remote.url, remote.apiKey, notifications);
    }
    return NextResponse.json({
      ok: true,
      activeCount: notifications.filter((item) => item.smart && item.status === "active").length,
      aiWarning: limitWarning || enriched.warning,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Notification refresh failed", 500);
  }
}
