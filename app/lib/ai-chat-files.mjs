export const AI_CHAT_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const AI_CHAT_MAX_ATTACHMENTS = 3;
export const AI_CHAT_MAX_TOTAL_BYTES = 6 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
]);

export const AI_CHAT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

export function safeChatFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 120);
}

export function resolveChatFileMimeType(file) {
  const declared = String(file?.type || "").toLowerCase();
  if (AI_CHAT_ALLOWED_MIME_TYPES.has(declared)) return declared;
  const name = String(file?.name || "").toLowerCase();
  const extension = name.match(/\.[a-z0-9]+$/)?.[0];
  return MIME_BY_EXTENSION.get(extension) || "";
}

export function validateChatFile(data, mimeType) {
  if (!Buffer.isBuffer(data) || !AI_CHAT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Поддерживаются изображения JPEG/PNG/WebP, PDF, TXT и CSV.");
  }
  if (!data.length || data.length > AI_CHAT_MAX_ATTACHMENT_BYTES) {
    throw new Error("Размер одного вложения не должен превышать 3 МБ.");
  }

  if (mimeType === "image/jpeg") {
    if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
      throw new Error("Содержимое файла не соответствует JPEG.");
    }
  } else if (mimeType === "image/png") {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (data.length < signature.length || !data.subarray(0, signature.length).equals(signature)) {
      throw new Error("Содержимое файла не соответствует PNG.");
    }
  } else if (mimeType === "image/webp") {
    if (data.length < 12 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error("Содержимое файла не соответствует WebP.");
    }
  } else if (mimeType === "application/pdf") {
    if (data.length < 8 || data.toString("ascii", 0, 5) !== "%PDF-") {
      throw new Error("Содержимое файла не соответствует PDF.");
    }
  } else {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new Error("TXT и CSV должны быть в кодировке UTF-8.");
    }
    if (text.includes("\u0000")) throw new Error("Вложение содержит недопустимые бинарные данные.");
  }
  return data;
}

export function chatAttachmentPromptText(attachment, base64) {
  if (attachment.mimeType !== "text/plain" && attachment.mimeType !== "text/csv") return "";
  const content = Buffer.from(base64, "base64").toString("utf8").slice(0, 60_000);
  return `\n\n[Содержимое файла «${safeChatFileName(attachment.name)}»]\n${content}`;
}

export function geminiChatAttachmentPart(attachment, base64) {
  const text = chatAttachmentPromptText(attachment, base64);
  if (text) return { text };
  return {
    inlineData: {
      mimeType: attachment.mimeType,
      data: base64,
    },
  };
}

