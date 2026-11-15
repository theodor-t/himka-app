import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  createAiChatId,
  createAiConversation,
  deleteAiChatAttachment,
  deleteAiConversation,
  getAiChatAttachment,
  getAiConversation,
  listAiConversations,
  resetLocalAiChatStore,
  saveAiChatMessage,
  uploadAiChatAttachment,
} from "../app/lib/ai-chat-store.mjs";
import {
  geminiChatAttachmentPart,
  validateChatFile,
} from "../app/lib/ai-chat-files.mjs";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "development";
});

afterEach(() => {
  resetLocalAiChatStore();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const request = new Request("http://localhost:3000/api/ai/conversations");

test("AI conversations persist and are isolated by employee", async () => {
  const conversation = await createAiConversation(request, "TUDOR", {
    mode: "general",
    title: "Test conversation",
  });
  await saveAiChatMessage(request, "TUDOR", {
    conversationId: conversation.id,
    message: {
      id: createAiChatId(),
      role: "user",
      content: "Remember this question",
      createdAt: new Date().toISOString(),
    },
  });

  assert.equal((await listAiConversations(request, "TUDOR")).length, 1);
  assert.equal((await listAiConversations(request, "DAN")).length, 0);
  await assert.rejects(
    getAiConversation(request, "DAN", conversation.id),
    (error) => error.status === 404,
  );
  assert.equal((await getAiConversation(request, "TUDOR", conversation.id)).messages[0].content, "Remember this question");
});

test("AI attachments keep Gemini references server-side and link to messages", async () => {
  const conversation = await createAiConversation(request, "TUDOR", {
    mode: "general",
    title: "Image analysis",
  });
  const attachmentId = createAiChatId();
  const fileUri = "https://generativelanguage.googleapis.com/v1beta/files/test-file";
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const attachment = await uploadAiChatAttachment(request, "TUDOR", {
    conversationId: conversation.id,
    id: attachmentId,
    name: "photo.png",
    mimeType: "image/png",
    size: 1024,
    fileUri,
    expiresAt,
  });
  assert.equal(attachment.id, attachmentId);
  await assert.rejects(
    getAiChatAttachment(request, "DAN", conversation.id, attachmentId),
    (error) => error.status === 404,
  );

  const message = await saveAiChatMessage(request, "TUDOR", {
    conversationId: conversation.id,
    message: {
      id: createAiChatId(),
      role: "user",
      content: "What is in this picture?",
      createdAt: new Date().toISOString(),
    },
    attachmentIds: [attachmentId],
  });
  assert.equal(message.attachments[0].id, attachmentId);
  assert.equal(message.attachments[0].expiresAt, expiresAt);
  assert.equal("fileUri" in message.attachments[0], false);
  await assert.rejects(
    deleteAiChatAttachment(request, "TUDOR", conversation.id, attachmentId),
    (error) => error.status === 404,
  );
  assert.equal(
    (await getAiChatAttachment(request, "TUDOR", conversation.id, attachmentId)).fileUri,
    fileUri,
  );
  assert.equal(
    (await getAiConversation(request, "TUDOR", conversation.id)).messages[0].attachments[0].fileUri,
    undefined,
  );

  await deleteAiConversation(request, "TUDOR", conversation.id);
  await assert.rejects(
    getAiConversation(request, "TUDOR", conversation.id),
    (error) => error.status === 404,
  );
  await assert.rejects(
    getAiChatAttachment(request, "TUDOR", conversation.id, attachmentId),
    (error) => error.status === 404,
  );
});

test("file validation rejects MIME spoofing and malformed UTF-8 documents", () => {
  assert.throws(
    () => validateChatFile(Buffer.from("%PDF-1.7"), "image/png"),
    /PNG/,
  );
  assert.throws(
    () => validateChatFile(Buffer.from([0xff, 0xfe, 0x00]), "text/plain"),
    /UTF-8/,
  );
  assert.equal(
    validateChatFile(Buffer.from("%PDF-1.7"), "application/pdf").toString("ascii"),
    "%PDF-1.7",
  );
});

test("Gemini receives server-side file references and rejects unsafe file URIs", () => {
  const fileUri = "https://generativelanguage.googleapis.com/v1beta/files/test-file";
  assert.deepEqual(
    geminiChatAttachmentPart({ mimeType: "image/png", fileUri }),
    { fileData: { mimeType: "image/png", fileUri } },
  );
  assert.throws(
    () => geminiChatAttachmentPart({
      mimeType: "image/png",
      fileUri: "https://attacker.example/v1beta/files/test-file",
    }),
    /не найдено на сервере Gemini/,
  );
});

test("an older Apps Script deployment fails visibly instead of returning empty chat history", async () => {
  const previousFetch = globalThis.fetch;
  const previousScriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const previousApiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  process.env.NODE_ENV = "production";
  process.env.GOOGLE_SCRIPT_URL = "https://example.test/exec";
  process.env.GOOGLE_SCRIPT_API_KEY = "local-test-key";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ schemaVersion: 5, clients: [] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  try {
    await assert.rejects(
      listAiConversations(new Request("https://crm.example.test/api/ai/conversations"), "TUDOR"),
      /Deploy the current Code\.gs version/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousScriptUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = previousScriptUrl;
    if (previousApiKey === undefined) delete process.env.GOOGLE_SCRIPT_API_KEY;
    else process.env.GOOGLE_SCRIPT_API_KEY = previousApiKey;
  }
});

test("an older Apps Script attachment endpoint requests deployment instead of reporting an invalid file", async () => {
  const previousFetch = globalThis.fetch;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousScriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const previousApiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  process.env.NODE_ENV = "production";
  process.env.GOOGLE_SCRIPT_URL = "https://example.test/exec";
  process.env.GOOGLE_SCRIPT_API_KEY = "local-test-key";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "Invalid or oversized AI chat file", status: 400 }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
  try {
    await assert.rejects(
      uploadAiChatAttachment(
        new Request("https://crm.example.test/api/ai/conversation-attachments"),
        "TUDOR",
        {
          conversationId: createAiChatId(),
          id: createAiChatId(),
          name: "photo.png",
          mimeType: "image/png",
          size: 1024,
          fileUri: "https://generativelanguage.googleapis.com/v1beta/files/test-file",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ),
      (error) =>
        error.status === 503 &&
        /outdated for Gemini attachments/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousScriptUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = previousScriptUrl;
    if (previousApiKey === undefined) delete process.env.GOOGLE_SCRIPT_API_KEY;
    else process.env.GOOGLE_SCRIPT_API_KEY = previousApiKey;
  }
});
