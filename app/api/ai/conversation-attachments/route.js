import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAiChatUser, aiChatErrorResponse } from "../../../lib/ai-chat-auth";
import {
  AI_CHAT_MAX_ATTACHMENT_BYTES,
  AI_CHAT_MAX_ATTACHMENTS,
  AI_CHAT_MAX_TOTAL_BYTES,
  safeChatFileName,
  resolveChatFileMimeType,
  validateChatFile,
} from "../../../lib/ai-chat-files.mjs";
import {
  deleteAiChatAttachment,
  getAiChatAttachment,
  getAiConversation,
  uploadAiChatAttachment,
} from "../../../lib/ai-chat-store.mjs";
import { consumeRateLimit } from "../../../lib/ai-rate-limit.mjs";

const ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;

export async function GET(request) {
  try {
    const { username } = await requireAiChatUser();
    const params = new URL(request.url).searchParams;
    const id = params.get("id") || "";
    const conversationId = params.get("conversationId") || "";
    if (!ID_PATTERN.test(id) || !ID_PATTERN.test(conversationId)) {
      return NextResponse.json({ error: "Некорректный запрос вложения." }, { status: 400 });
    }
    const conversation = await getAiConversation(request, username, conversationId);
    if (conversation.conversation.mode !== "general") {
      return NextResponse.json({ error: "Вложения доступны только в общем AI-чате." }, { status: 404 });
    }
    const attachment = await getAiChatAttachment(request, username, conversationId, id);
    if (!attachment || typeof attachment.base64 !== "string") {
      return NextResponse.json({ error: "Вложение недоступно." }, { status: 404 });
    }
    const data = Buffer.from(attachment.base64, "base64");
    validateChatFile(data, attachment.mimeType);
    if (data.length !== Number(attachment.size)) {
      return NextResponse.json({ error: "Размер вложения не совпадает с метаданными." }, { status: 502 });
    }
    return new Response(data, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `inline; filename="${safeChatFileName(attachment.name) || "attachment"}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { username } = await requireAiChatUser();
    const limit = consumeRateLimit(`ai-chat-upload:${username}`, 15, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Слишком много загрузок. Попробуйте через минуту." },
        { status: 429 },
      );
    }
    let form;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Некорректный файл." }, { status: 400 });
    }
    const conversationId = String(form.get("conversationId") || "");
    const file = form.get("file");
    if (!ID_PATTERN.test(conversationId) || !file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Укажите чат и файл." }, { status: 400 });
    }
    const conversation = await getAiConversation(request, username, conversationId);
    if (conversation.conversation.mode !== "general") {
      return NextResponse.json({ error: "Вложения доступны только в общем AI-чате." }, { status: 400 });
    }
    const pending = Array.isArray(conversation.pendingAttachments)
      ? conversation.pendingAttachments
      : [];
    if (pending.length >= AI_CHAT_MAX_ATTACHMENTS) {
      return NextResponse.json({ error: "Можно добавить не более трёх вложений к сообщению." }, { status: 400 });
    }
    if (Number(file.size) > AI_CHAT_MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Размер одного вложения не должен превышать 3 МБ." }, { status: 400 });
    }
    const mimeType = resolveChatFileMimeType(file);
    const data = Buffer.from(await file.arrayBuffer());
    validateChatFile(data, mimeType);
    const totalBytes = pending.reduce((total, attachment) => total + Number(attachment.size || 0), 0);
    if (totalBytes + data.length > AI_CHAT_MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "Общий размер вложений одного сообщения не должен превышать 6 МБ." }, { status: 400 });
    }
    const attachment = await uploadAiChatAttachment(request, username, {
      conversationId,
      id: randomUUID(),
      name: safeChatFileName(file.name),
      mimeType,
      size: data.length,
      base64: data.toString("base64"),
    });
    return NextResponse.json({ attachment }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}

export async function DELETE(request) {
  try {
    const { username } = await requireAiChatUser();
    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
    }
    if (!ID_PATTERN.test(String(input?.id || "")) || !ID_PATTERN.test(String(input?.conversationId || ""))) {
      return NextResponse.json({ error: "Некорректный запрос вложения." }, { status: 400 });
    }
    await deleteAiChatAttachment(request, username, input.conversationId, input.id);
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}
