import { NextResponse } from "next/server";
import { requireAiChatUser, aiChatErrorResponse } from "../../../lib/ai-chat-auth";
import {
  createAiConversation,
  deleteAiConversation,
  getAiChatAttachment,
  getAiConversation,
  listAiConversations,
  renameAiConversation,
} from "../../../lib/ai-chat-store.mjs";
import { deleteGeminiFile } from "../../../lib/gemini-files.mjs";

const ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const cleanTitle = (value) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
  : "";

export async function GET(request) {
  try {
    const { username } = await requireAiChatUser();
    const id = new URL(request.url).searchParams.get("id");
    const payload = id
      ? await getAiConversation(request, username, id)
      : { conversations: await listAiConversations(request, username) };
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { username } = await requireAiChatUser();
    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
    }
    if (!["crm", "general"].includes(input?.mode)) {
      return NextResponse.json({ error: "Неизвестный режим чата." }, { status: 400 });
    }
    const conversation = await createAiConversation(request, username, {
      mode: input.mode,
      title: cleanTitle(input.title) || "Новый чат",
    });
    return NextResponse.json({ conversation }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}

export async function PATCH(request) {
  try {
    const { username } = await requireAiChatUser();
    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
    }
    if (!ID_PATTERN.test(String(input?.id || "")) || !cleanTitle(input?.title)) {
      return NextResponse.json({ error: "Укажите название чата (до 80 символов)." }, { status: 400 });
    }
    const conversation = await renameAiConversation(
      request,
      username,
      input.id,
      cleanTitle(input.title),
    );
    return NextResponse.json({ conversation }, {
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
    if (!ID_PATTERN.test(String(input?.id || ""))) {
      return NextResponse.json({ error: "Некорректный ID чата." }, { status: 400 });
    }
    const conversation = await getAiConversation(request, username, input.id);
    const attachmentIds = new Set([
      ...(conversation.pendingAttachments || []).map((attachment) => attachment.id),
      ...(conversation.messages || []).flatMap((message) =>
        (message.attachments || []).map((attachment) => attachment.id),
      ),
    ]);
    if (attachmentIds.size) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Gemini не настроен на сервере." }, { status: 503 });
      }
      for (const attachmentId of attachmentIds) {
        const attachment = await getAiChatAttachment(
          request,
          username,
          input.id,
          attachmentId,
        );
        if (attachment.fileUri) {
          await deleteGeminiFile({ apiKey, fileUri: attachment.fileUri });
        }
      }
    }
    await deleteAiConversation(request, username, input.id);
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return aiChatErrorResponse(error);
  }
}
