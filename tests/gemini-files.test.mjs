import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteGeminiFile, uploadGeminiFile } from "../app/lib/gemini-files.mjs";

test("Gemini file upload uses a resumable request and returns validated URI metadata", async () => {
  const calls = [];
  const now = Date.parse("2026-03-01T10:00:00.000Z");
  const expiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  const result = await uploadGeminiFile({
    apiKey: "test-key",
    name: "notes.txt",
    mimeType: "text/plain",
    data: Buffer.from("private test content"),
    now,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(null, {
          status: 200,
          headers: {
            "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test",
          },
        });
      }
      return new Response(JSON.stringify({
        file: {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file",
          expirationTime: expiresAt,
        },
      }), { status: 200 });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["X-Goog-Upload-Protocol"], "resumable");
  assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
  assert.equal(calls[1].options.headers["X-Goog-Upload-Command"], "upload, finalize");
  assert.equal(result.fileUri, "https://generativelanguage.googleapis.com/v1beta/files/test-file");
  assert.equal(result.expiresAt, expiresAt);
});

test("Gemini upload refuses an untrusted resumable upload URL", async () => {
  let callCount = 0;
  await assert.rejects(
    uploadGeminiFile({
      apiKey: "test-key",
      name: "notes.txt",
      mimeType: "text/plain",
      data: Buffer.from("private test content"),
      fetchImpl: async () => {
        callCount += 1;
        return new Response(null, {
          status: 200,
          headers: { "x-goog-upload-url": "https://attacker.example/upload" },
        });
      },
    }),
    /valid upload URL/,
  );
  assert.equal(callCount, 1);
});

test("Gemini file deletion tolerates automatic expiry but rejects untrusted URIs", async () => {
  let callCount = 0;
  await deleteGeminiFile({
    apiKey: "test-key",
    fileUri: "https://generativelanguage.googleapis.com/v1beta/files/expired-file",
    fetchImpl: async () => {
      callCount += 1;
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(callCount, 1);
  await assert.rejects(
    deleteGeminiFile({
      apiKey: "test-key",
      fileUri: "https://attacker.example/v1beta/files/file",
      fetchImpl: async () => {
        callCount += 1;
        return new Response(null, { status: 204 });
      },
    }),
    /invalid file URI/,
  );
  assert.equal(callCount, 1);
});
