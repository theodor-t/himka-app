import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DATABASE_COLLECTIONS } from "./database.mjs";
import { roleCanWriteCollection } from "./access-control.mjs";
import { normalizePhoneForMessaging } from "./messages.mjs";

const ACTION_TTL_MS = 5 * 60 * 1000;
const MAX_ACTION_DATA_LENGTH = 12_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function actionError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSigningSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw actionError("AI-действия не настроены на сервере.", 503);
  return secret;
}

function hashRecord(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("base64url");
}

function previewRecord(record, keys = Object.keys(record || {})) {
  const preview = { id: record?.id };
  for (const key of keys.filter((item) => item !== "id").slice(0, 40)) {
    const value = record?.[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      preview[key] = typeof value === "string" ? value.slice(0, 500) : value;
    } else if (Array.isArray(value)) {
      preview[key] = `[${value.length} элементов]`;
    } else if (value && typeof value === "object") {
      preview[key] = "[объект]";
    }
  }
  return preview;
}

function parseActionData(value) {
  if (typeof value !== "string" || value.length > MAX_ACTION_DATA_LENGTH) {
    throw actionError("AI-предложение содержит некорректные данные.");
  }
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    throw actionError("Не удалось разобрать данные AI-предложения.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw actionError("AI-предложение должно содержать объект данных.");
  }
  validateJsonValue(data);
  return data;
}

function validateJsonValue(value, depth = 0) {
  if (depth > 8) throw actionError("Слишком глубокая структура AI-предложения.");
  if (typeof value === "string" && value.length > 5000) {
    throw actionError("Поле AI-предложения слишком длинное.");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw actionError("AI-предложение содержит некорректное число.");
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw actionError("Слишком много элементов в AI-предложении.");
    value.forEach((item) => validateJsonValue(item, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw actionError("AI-предложение содержит запрещённое поле.");
      validateJsonValue(nested, depth + 1);
    }
  }
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSigningSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(token, username, now) {
  if (typeof token !== "string" || token.length > 32_000) {
    throw actionError("Предложение не найдено или повреждено.", 400);
  }
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw actionError("Предложение не найдено или повреждено.", 400);
  }
  const encoded = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = createHmac("sha256", getSigningSecret()).update(encoded).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw actionError("Подтверждение предложения недействительно.", 403);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw actionError("Предложение не найдено или повреждено.", 400);
  }
  if (payload.username !== username) {
    throw actionError("Предложение создано для другого пользователя.", 403);
  }
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
    throw actionError("Срок подтверждения истёк. Попросите AI подготовить предложение заново.", 410);
  }
  return payload;
}

export function getAiCrmActionSchema(database, role) {
  return Object.fromEntries(
    DATABASE_COLLECTIONS
      .filter((collection) =>
        !["logs", "systemEvents"].includes(collection) &&
        roleCanWriteCollection(role, collection),
      )
      .map((collection) => {
        const fields = new Set(collection === "customers" ? ["name", "phone", "createdAt"] : []);
        for (const record of (database?.[collection] || []).slice(0, 100)) {
          if (record && typeof record === "object" && !Array.isArray(record)) {
            Object.keys(record).forEach((key) => fields.add(key));
          }
        }
        return [collection, [...fields].sort().slice(0, 80)];
      }),
  );
}

export function extractSingleUserPhone(text) {
  const matches = [...String(text || "").matchAll(
    /(?:телефон|phone|telefon|tel)(?:\s+номер)?\s*[:=]?\s*(\+?\d[\d\s().-]{6,}\d)/giu,
  )]
    .map((match) => match[1].trim())
    .map((phone) => ({ phone, normalized: normalizePhoneForMessaging(phone) }))
    .filter((item) => item.normalized);
  const unique = new Map(matches.map((item) => [item.normalized, item.phone]));
  return unique.size === 1 ? [...unique.values()][0] : "";
}

export function createAiCrmActionProposal({
  username,
  role,
  database,
  action,
  now = Date.now(),
}) {
  if (!action || action.operation === "none") return null;
  const { operation, collection } = action;
  if (!["create", "update", "delete"].includes(operation)) {
    throw actionError("AI предложил неподдерживаемый тип изменения.");
  }
  if (!DATABASE_COLLECTIONS.includes(collection)) {
    throw actionError("AI предложил неизвестный раздел CRM.");
  }
  if (["logs", "systemEvents"].includes(collection)) {
    throw actionError("AI не может создавать или менять системные журналы.", 403);
  }
  if (!roleCanWriteCollection(role, collection)) {
    throw actionError("У вашей роли нет прав на изменение этого раздела.", 403);
  }

  const records = Array.isArray(database?.[collection]) ? database[collection] : [];
  const fieldSchema = new Set(getAiCrmActionSchema(database, role)[collection] || []);
  const proposal = {
    id: randomUUID(),
    username,
    operation,
    collection,
    expiresAt: now + ACTION_TTL_MS,
  };

  if (operation === "create") {
    const data = parseActionData(action.dataJson);
    if (Object.hasOwn(data, "id")) throw actionError("ID новой записи назначает сервер.");
    if (!Object.keys(data).length) throw actionError("В AI-предложении нет полей для создания записи.");
    if (collection === "customers") {
      data.name = String(data.name || "").trim();
      if (!data.name) throw actionError("Для создания клиента укажите имя.");
      if (data.name.length > 120) throw actionError("Имя клиента слишком длинное.");
      if (data.phone && !normalizePhoneForMessaging(data.phone)) {
        throw actionError("Телефон клиента указан в неподдерживаемом формате.");
      }
      const newPhone = normalizePhoneForMessaging(data.phone);
      if (newPhone && records.some((record) =>
        normalizePhoneForMessaging(record?.phone) === newPhone,
      )) {
        throw actionError("Клиент с таким телефоном уже существует. Для изменения используйте его ID.", 409);
      }
    }
    if (fieldSchema.size && Object.keys(data).some((key) => !fieldSchema.has(key))) {
      throw actionError("AI предложил неизвестные для этой записи поля. Уточните данные и повторите.");
    }
    if (collection === "notificationPreferences" && data.username !== username) {
      throw actionError("Можно менять только собственные настройки уведомлений.", 403);
    }
    proposal.recordId = randomUUID();
    proposal.data = {
      ...data,
      id: proposal.recordId,
      ...(fieldSchema.has("createdAt") ? { createdAt: new Date(now).toISOString() } : {}),
    };
    proposal.preview = { after: previewRecord(proposal.data) };
  } else {
    const targetId = typeof action.targetId === "string" ? action.targetId.trim() : "";
    if (!targetId || targetId.length > 120) {
      throw actionError("Для изменения или удаления укажите точный ID записи.");
    }
    const target = records.find((record) => String(record?.id) === targetId);
    if (!target) throw actionError("Запись с указанным ID не найдена.");
    if (
      collection === "notificationPreferences" &&
      target.username !== username
    ) {
      throw actionError("Можно менять только собственные настройки уведомлений.", 403);
    }
    proposal.recordId = targetId;
    proposal.beforeHash = hashRecord(target);
    if (operation === "update") {
      const data = parseActionData(action.dataJson);
      if (!Object.keys(data).length) throw actionError("AI-предложение не содержит изменений.");
      if (Object.hasOwn(data, "id") || Object.hasOwn(data, "createdAt")) {
        throw actionError("ID и дата создания записи не могут быть изменены.");
      }
      if (Object.keys(data).some((key) => !Object.hasOwn(target, key))) {
        throw actionError("AI предложил поля, которых нет в этой записи.");
      }
      if (collection === "notificationPreferences" && data.username && data.username !== username) {
        throw actionError("Можно менять только собственные настройки уведомлений.", 403);
      }
      proposal.data = data;
      const changedKeys = Object.keys(data);
      proposal.preview = {
        before: previewRecord(target, changedKeys),
        after: previewRecord({ ...target, ...data }, changedKeys),
      };
    } else {
      proposal.preview = { before: previewRecord(target) };
    }
  }

  return {
    id: proposal.id,
    operation: proposal.operation,
    collection: proposal.collection,
    recordId: proposal.recordId,
    preview: proposal.preview,
    expiresAt: new Date(proposal.expiresAt).toISOString(),
    token: signPayload(proposal),
  };
}

export function applyAiCrmAction({ username, role, database, token, now = Date.now() }) {
  const proposal = verifyPayload(token, username, now);
  if (
    !["create", "update", "delete"].includes(proposal.operation) ||
    !DATABASE_COLLECTIONS.includes(proposal.collection) ||
    !roleCanWriteCollection(role, proposal.collection)
  ) {
    throw actionError("Текущая роль больше не может выполнить это изменение.", 403);
  }
  const collection = proposal.collection;
  if (["logs", "systemEvents"].includes(collection)) {
    throw actionError("AI не может создавать или менять системные журналы.", 403);
  }
  const records = Array.isArray(database?.[collection]) ? database[collection] : [];
  const existing = records.find((record) => String(record?.id) === proposal.recordId);
  let nextRecords;
  let alreadyApplied = false;

  if (proposal.operation === "create") {
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(proposal.data)) {
        throw actionError("ID уже используется другой записью. Подготовьте предложение заново.", 409);
      }
      nextRecords = records;
      alreadyApplied = true;
    } else {
      nextRecords = [proposal.data, ...records];
    }
  } else if (!existing) {
    if (proposal.operation !== "delete") {
      throw actionError("Запись уже удалена или больше недоступна.", 409);
    }
    nextRecords = records;
    alreadyApplied = true;
  } else if (hashRecord(existing) !== proposal.beforeHash) {
    const updateAlreadyApplied = proposal.operation === "update" &&
      JSON.stringify({ ...existing, ...proposal.data }) === JSON.stringify(existing);
    if (updateAlreadyApplied) {
      nextRecords = records;
      alreadyApplied = true;
    } else {
      throw actionError("Запись изменилась после подготовки предложения. Попросите AI проверить её заново.", 409);
    }
  } else if (proposal.operation === "update") {
    nextRecords = records.map((record) =>
      String(record?.id) === proposal.recordId ? { ...record, ...proposal.data } : record,
    );
  } else {
    nextRecords = records.filter((record) => String(record?.id) !== proposal.recordId);
  }

  return {
    database: alreadyApplied ? database : { ...database, [collection]: nextRecords },
    alreadyApplied,
    proposal: {
      id: proposal.id,
      operation: proposal.operation,
      collection,
      recordId: proposal.recordId,
    },
  };
}
