import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DATABASE_COLLECTIONS } from "./database.mjs";
import { roleCanWriteCollection } from "./access-control.mjs";
import { normalizePhoneForMessaging } from "./messages.mjs";

const ACTION_TTL_MS = 5 * 60 * 1000;
const MAX_ACTION_DATA_LENGTH = 12_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CRM_MUTATION_PATTERN = /(?:^|\s)(?:создай|создать|добавь|добавить|измени|изменить|обнови|обновить|удали|удалить|отмени|отменить|creează|crează|adaugă|modifică|actualizează|șterge|sterge|anulează)(?=$|[\s,.!?])/iu;
const ACTION_CANCELLATION_PATTERN = /^\s*(?:не\s+надо|отмена|отмени(?:\s+(?:это|создание|предложение|действие))?|забудь(?:\s+это)?|cancel(?:\s+(?:that|it))?|stop|anulează(?:\s+(?:asta|acțiunea))?)\s*[.!?]*$/iu;
const CLARIFICATION_PATTERN = /уточн\w*|укаж\w*|назов\w*|предостав\w*|нуж(?:ен|на|но|ны)\b|не\s+был\w*\s+предоставлен|missing\b|please\b.{0,60}\b(?:provide|tell|specify)|am nevoie de|vă rog.{0,60}(?:indica|specifica)/iu;

function actionError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function looksLikeAiCrmMutationRequest(text) {
  return CRM_MUTATION_PATTERN.test(String(text || ""));
}

export function isAiCrmActionCancellation(text) {
  return ACTION_CANCELLATION_PATTERN.test(String(text || ""));
}

export function getPendingAiCrmAction(messages) {
  if (!Array.isArray(messages)) return null;
  const recent = messages.slice(-10);
  let assistantIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index]?.role === "assistant") {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;

  const lastAssistant = recent[assistantIndex];
  const savedPendingAction = lastAssistant.metadata?.pendingCrmAction;
  if (savedPendingAction?.active && typeof savedPendingAction.request === "string") {
    return { request: savedPendingAction.request };
  }
  if (lastAssistant.metadata?.actionProposal) return null;

  const assistantText = [
    lastAssistant.metadata?.analysis,
    lastAssistant.content,
  ].filter((value) => typeof value === "string").join("\n");
  if (!CLARIFICATION_PATTERN.test(assistantText)) return null;

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (message?.role === "user" && looksLikeAiCrmMutationRequest(message.content)) {
      return { request: String(message.content).slice(0, 600) };
    }
  }
  return null;
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

function requireAiVehicleCustomer(database, vehicle) {
  const customerId = String(vehicle?.customerId || "").trim();
  if (!customerId) {
    throw actionError("Не удалось определить клиента для автомобиля. Назовите клиента.");
  }
  const customer = (Array.isArray(database?.customers) ? database.customers : [])
    .find((item) => String(item?.id) === customerId);
  if (!customer) {
    throw actionError("Клиент для автомобиля не найден. Назовите клиента или сначала создайте его.");
  }
  if (customer.archived) {
    throw actionError("Нельзя добавить автомобиль к архивному клиенту.");
  }
  return customer;
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
        const defaults = {
          customers: ["name", "phone", "createdAt"],
          vehicles: ["customerId", "makeModel", "year", "color", "plate", "vin", "notes", "createdAt", "author"],
        };
        const fields = new Set(defaults[collection] || []);
        for (const record of (database?.[collection] || []).slice(0, 100)) {
          if (record && typeof record === "object" && !Array.isArray(record)) {
            Object.keys(record).forEach((key) => fields.add(key));
          }
        }
        return [collection, [...fields].sort().slice(0, 80)];
      }),
  );
}

export function getAiCrmActionCollectionOptions(database, role) {
  const collections = Object.keys(getAiCrmActionSchema(database, role));
  return collections.length ? collections : ["none"];
}

export function resolveAiCrmVehicleCustomer(database, question, messages) {
  const customers = Array.isArray(database?.customers) ? database.customers : [];
  const normalizedQuestion = String(question || "").toLocaleLowerCase();
  const namedCustomers = customers.filter((customer) => {
    const name = String(customer?.name || "").trim();
    return name.length >= 2 && normalizedQuestion.includes(name.toLocaleLowerCase());
  });
  const uniqueNamedCustomers = [...new Map(
    namedCustomers.map((customer) => [String(customer.id), customer]),
  ).values()];
  if (uniqueNamedCustomers.length > 1) {
    return { customerId: "", customerName: "", ambiguous: true };
  }
  if (uniqueNamedCustomers.length === 1) {
    const customer = uniqueNamedCustomers[0];
    return {
      customerId: String(customer.id),
      customerName: String(customer.name || customer.phone || ""),
      ambiguous: false,
    };
  }

  const refersToRecentCustomer =
    /для\s+него|для\s+не[её]|к\s+нему|его\s+(?:авто|машин)|for\s+(?:him|her)|his\s+(?:car|vehicle)|pentru\s+(?:el|ea|clientul)/iu
      .test(String(question || ""));
  if (!refersToRecentCustomer || !Array.isArray(messages)) {
    return { customerId: "", customerName: "", ambiguous: false };
  }

  const recentCustomerProposal = messages.slice(-20).reverse().find((message) => {
    const proposal = message?.metadata?.actionProposal;
    return message?.role === "assistant" &&
      proposal?.operation === "create" &&
      proposal?.collection === "customers" &&
      typeof proposal.recordId === "string";
  });
  const recordId = recentCustomerProposal?.metadata?.actionProposal?.recordId;
  const customer = customers.find((item) => String(item?.id) === recordId);
  return customer
    ? {
        customerId: String(customer.id),
        customerName: String(customer.name || customer.phone || ""),
        ambiguous: false,
      }
    : { customerId: "", customerName: "", ambiguous: false };
}

export function findUnlinkedAiCrmVehicles(database, makeModel) {
  const normalizeModel = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const targetModel = normalizeModel(makeModel);
  if (!targetModel) return [];
  const customers = Array.isArray(database?.customers) ? database.customers : [];
  const vehicles = Array.isArray(database?.vehicles) ? database.vehicles : [];
  const customerIds = new Set(customers.map((customer) => String(customer?.id)));
  return vehicles.filter((vehicle) =>
    vehicle?.id != null &&
    String(vehicle.id).trim().length > 0 &&
    !vehicle.archived &&
    normalizeModel(vehicle?.makeModel) === targetModel &&
    (!vehicle?.customerId || !customerIds.has(String(vehicle.customerId))),
  );
}

export function extractSingleUserPhone(text) {
  const source = String(text || "");
  const labeledMatches = [...source.matchAll(
    /(?:телефон|phone|telefon|tel)(?:\s+номер)?\s*[:=]?\s*(\+?\d[\d\s().-]{6,}\d)/giu,
  )]
    .map((match) => match[1].trim())
    .map((phone) => phone);
  const internationalMatches = [...source.matchAll(
    /(?<!\w)(\+\d[\d\s().-]{6,}\d)(?!\w)/gu,
  )].map((match) => match[1].trim());
  const matches = [...labeledMatches, ...internationalMatches]
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
    let vehicleOwner = null;
    if (collection === "vehicles") {
      data.makeModel = String(data.makeModel || "").trim();
      if (!data.makeModel) throw actionError("Для создания автомобиля укажите марку и модель.");
      vehicleOwner = requireAiVehicleCustomer(database, data);
      data.author = username;
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
    const after = previewRecord(proposal.data);
    if (vehicleOwner) after.customerName = vehicleOwner.name || vehicleOwner.phone || "";
    proposal.preview = { after };
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
      if (Object.keys(data).some((key) =>
        !Object.hasOwn(target, key) &&
        !(collection === "vehicles" && key === "customerId"),
      )) {
        throw actionError("AI предложил поля, которых нет в этой записи.");
      }
      if (collection === "notificationPreferences" && data.username && data.username !== username) {
        throw actionError("Можно менять только собственные настройки уведомлений.", 403);
      }
      const vehicleOwner = collection === "vehicles"
        ? requireAiVehicleCustomer(database, { ...target, ...data })
        : null;
      proposal.data = data;
      const changedKeys = Object.keys(data);
      const previewKeys = collection === "vehicles"
        ? [...new Set([...changedKeys, "makeModel"])]
        : changedKeys;
      const after = previewRecord({ ...target, ...data }, previewKeys);
      if (vehicleOwner) after.customerName = vehicleOwner.name || vehicleOwner.phone || "";
      const before = previewRecord(target, previewKeys);
      if (collection === "vehicles") {
        const previousOwner = (Array.isArray(database?.customers) ? database.customers : [])
          .find((customer) => String(customer?.id) === String(target.customerId || ""));
        before.customerName = previousOwner?.name || "Не привязан";
      }
      proposal.preview = {
        before,
        after,
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
  if (collection === "vehicles" && proposal.operation === "create") {
    requireAiVehicleCustomer(database, proposal.data);
  } else if (collection === "vehicles" && proposal.operation === "update" && existing) {
    requireAiVehicleCustomer(database, { ...existing, ...proposal.data });
  }
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

export function verifyAiCrmActionPersistence(expectedDatabase, persistedDatabase, proposal) {
  const collection = proposal?.collection;
  const operation = proposal?.operation;
  const recordId = String(proposal?.recordId || "");
  if (
    !["create", "update", "delete"].includes(operation) ||
    !DATABASE_COLLECTIONS.includes(collection) ||
    !recordId
  ) {
    throw actionError("Не удалось проверить сохранённую CRM-запись.", 502);
  }
  const persistedRecords = Array.isArray(persistedDatabase?.[collection])
    ? persistedDatabase[collection]
    : [];
  const persistedRecord = persistedRecords.find((record) => String(record?.id) === recordId);

  if (operation === "delete") {
    if (persistedRecord) {
      throw actionError("CRM не подтвердила удаление записи после повторной проверки.", 502);
    }
    return true;
  }

  const expectedRecords = Array.isArray(expectedDatabase?.[collection])
    ? expectedDatabase[collection]
    : [];
  const expectedRecord = expectedRecords.find((record) => String(record?.id) === recordId);
  if (!expectedRecord || !persistedRecord || !isDeepStrictEqual(persistedRecord, expectedRecord)) {
    throw actionError("CRM не подтвердила ожидаемые данные после сохранения. Обновите список и проверьте запись.", 502);
  }
  return true;
}
