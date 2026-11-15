import { randomUUID } from "node:crypto";
import { isLocalPreviewRequest } from "./local-preview.mjs";

const LOCAL_CHAT_STORE_KEY = Symbol.for("angel-detailing.local-ai-chat-store");

function getLocalStore() {
  if (!globalThis[LOCAL_CHAT_STORE_KEY]) {
    globalThis[LOCAL_CHAT_STORE_KEY] = {
      conversations: new Map(),
      attachments: new Map(),
    };
  }
  return globalThis[LOCAL_CHAT_STORE_KEY];
}

function clone(value) {
  return structuredClone(value);
}

function safeLocalConversation(conversation) {
  const { owner, messages, ...visible } = conversation;
  return clone(visible);
}

function appsScriptUrl(action, values = {}) {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google AI chat storage is not configured");
  const url = new URL(scriptUrl);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("action", action);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url;
}

async function parseResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google AI chat storage returned invalid JSON (${response.status})`);
  }
  const status = Number(payload.status) || response.status;
  if (!response.ok || status >= 400 || payload.error) {
    const obsoleteGeminiAttachmentApi = payload.error === "Invalid or oversized AI chat file";
    const obsoleteApi = obsoleteGeminiAttachmentApi ||
      payload.error === "Unknown AI chat action" ||
      /Invalid collection:\s*clients/i.test(String(payload.error || ""));
    const error = new Error(obsoleteApi
      ? obsoleteGeminiAttachmentApi
        ? "Apps Script is outdated for Gemini attachments. Deploy the current Code.gs version."
        : "Google Apps Script is not updated for AI chat storage. Deploy the current Code.gs version."
      : payload.error || `Google AI chat storage failed (${status})`);
    error.status = obsoleteApi ? 503 : status;
    throw error;
  }
  return payload;
}

function requireAiChatPayload(payload, valid) {
  if (!valid(payload)) {
    const error = new Error("Google Apps Script is not updated for AI chat storage. Deploy the current Code.gs version.");
    error.status = 503;
    throw error;
  }
  return payload;
}

async function callAppsScript(action, { method = "GET", values = {}, body } = {}) {
  const response = await fetch(appsScriptUrl(action, values), {
    method,
    cache: "no-store",
    redirect: "follow",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return parseResponse(response);
}

export function createAiChatId() {
  return randomUUID();
}

export async function listAiConversations(request, username) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    return [...store.conversations.values()]
      .filter((conversation) => conversation.owner === username)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100)
      .map(safeLocalConversation);
  }
  const payload = await callAppsScript("aiChatList", { values: { username } });
  requireAiChatPayload(payload, (value) => Array.isArray(value.conversations));
  return payload.conversations;
}

export async function getAiConversation(request, username, id) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const conversation = store.conversations.get(id);
    if (!conversation || conversation.owner !== username) {
      const error = new Error("AI chat not found");
      error.status = 404;
      throw error;
    }
    return clone({
      conversation: safeLocalConversation(conversation),
      messages: conversation.messages,
      pendingAttachments: [...store.attachments.values()]
        .filter((attachment) =>
          attachment.conversationId === id &&
          attachment.owner === username &&
          attachment.status === "pending",
        )
        .map(({ base64, fileUri, owner, status, ...attachment }) => attachment),
    });
  }
  const payload = await callAppsScript("aiChatGet", { values: { username, id } });
  requireAiChatPayload(
    payload,
    (value) =>
      value.conversation?.id === id &&
      Array.isArray(value.messages) &&
      Array.isArray(value.pendingAttachments),
  );
  return payload;
}

export async function createAiConversation(request, username, { mode, title }) {
  const conversation = {
    id: createAiChatId(),
    mode,
    title: title || "Новый чат",
    preview: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    store.conversations.set(conversation.id, {
      ...conversation,
      owner: username,
      messages: [],
    });
    return clone(conversation);
  }
  const payload = await callAppsScript("aiChatCreate", {
    method: "POST",
    body: { ...conversation, username },
  });
  requireAiChatPayload(payload, (value) => value.conversation?.id === conversation.id);
  return payload.conversation;
}

export async function saveAiChatMessage(request, username, { conversationId, message, attachmentIds = [] }) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const conversation = store.conversations.get(conversationId);
    if (!conversation || conversation.owner !== username) {
      const error = new Error("AI chat not found");
      error.status = 404;
      throw error;
    }
    const existing = conversation.messages.find((item) => item.id === message.id);
    if (existing) return clone(existing);
    if (!["user", "assistant"].includes(message.role) || !message.content.trim()) {
      throw new Error("Invalid AI chat message");
    }
    if (attachmentIds.length > 3 || new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error("Invalid AI chat attachments");
    }
    const attachments = attachmentIds.map((id) => {
      const attachment = store.attachments.get(id);
      if (
        !attachment ||
        attachment.owner !== username ||
        attachment.conversationId !== conversationId ||
        attachment.status !== "pending"
      ) {
        throw new Error("AI chat attachment is unavailable");
      }
      attachment.status = "linked";
      attachment.messageId = message.id;
      const { base64, fileUri, owner, status, messageId, ...metadata } = attachment;
      return clone(metadata);
    });
    const saved = { ...clone(message), attachments };
    conversation.messages.push(saved);
    conversation.preview = message.content.slice(0, 200);
    conversation.updatedAt = message.createdAt;
    if (message.role === "user" && conversation.title === "Новый чат") {
      conversation.title = message.content.replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return clone(saved);
  }
  const payload = await callAppsScript("aiChatSaveMessage", {
    method: "POST",
    body: { username, conversationId, message, attachmentIds },
  });
  requireAiChatPayload(payload, (value) => value.message?.id === message.id);
  return payload.message;
}

export async function renameAiConversation(request, username, id, title) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const conversation = store.conversations.get(id);
    if (!conversation || conversation.owner !== username) {
      const error = new Error("AI chat not found");
      error.status = 404;
      throw error;
    }
    conversation.title = title;
    conversation.updatedAt = new Date().toISOString();
    return safeLocalConversation(conversation);
  }
  const payload = await callAppsScript("aiChatRename", {
    method: "POST",
    body: { username, id, title },
  });
  requireAiChatPayload(payload, (value) => value.conversation?.id === id);
  return payload.conversation;
}

export async function deleteAiConversation(request, username, id) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const conversation = store.conversations.get(id);
    if (!conversation || conversation.owner !== username) {
      const error = new Error("AI chat not found");
      error.status = 404;
      throw error;
    }
    store.conversations.delete(id);
    for (const [attachmentId, attachment] of store.attachments) {
      if (attachment.conversationId === id && attachment.owner === username) {
        store.attachments.delete(attachmentId);
      }
    }
    return;
  }
  await callAppsScript("aiChatDelete", {
    method: "POST",
    body: { username, id },
  });
}

export async function uploadAiChatAttachment(request, username, {
  conversationId,
  id,
  name,
  mimeType,
  size,
  fileUri,
  expiresAt,
}) {
  const metadata = {
    id,
    conversationId,
    name,
    mimeType,
    size,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const conversation = store.conversations.get(conversationId);
    if (!conversation || conversation.owner !== username || conversation.mode !== "general") {
      const error = new Error("AI chat not found");
      error.status = 404;
      throw error;
    }
    store.attachments.set(id, {
      ...metadata,
      owner: username,
      status: "pending",
      fileUri,
    });
    return clone(metadata);
  }
  const payload = await callAppsScript("aiChatUploadAttachment", {
    method: "POST",
    body: { ...metadata, username, fileUri },
  });
  requireAiChatPayload(payload, (value) => value.attachment?.id === id);
  return payload.attachment;
}

export async function getAiChatAttachment(request, username, conversationId, id) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const attachment = store.attachments.get(id);
    const conversation = store.conversations.get(conversationId);
    if (
      !attachment ||
      !conversation ||
      attachment.owner !== username ||
      attachment.conversationId !== conversationId ||
      conversation.owner !== username
    ) {
      const error = new Error("AI chat attachment not found");
      error.status = 404;
      throw error;
    }
    return clone(attachment);
  }
  const payload = await callAppsScript("aiChatAttachment", {
    values: { username, conversationId, id },
  });
  requireAiChatPayload(payload, (value) => value.id === id && typeof value.fileUri === "string");
  return payload;
}

export async function deleteAiChatAttachment(request, username, conversationId, id) {
  if (isLocalPreviewRequest(request)) {
    const store = getLocalStore();
    const attachment = store.attachments.get(id);
    if (
      !attachment ||
      attachment.owner !== username ||
      attachment.conversationId !== conversationId ||
      attachment.status !== "pending"
    ) {
      const error = new Error("Pending AI chat attachment not found");
      error.status = 404;
      throw error;
    }
    store.attachments.delete(id);
    return;
  }
  await callAppsScript("aiChatDeleteAttachment", {
    method: "POST",
    body: { username, conversationId, id },
  });
}

export function resetLocalAiChatStore() {
  globalThis[LOCAL_CHAT_STORE_KEY] = {
    conversations: new Map(),
    attachments: new Map(),
  };
}
