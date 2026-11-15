import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_CAPTION_LANGUAGES,
  AI_CAPTION_SERVICES,
  AI_CAPTION_STYLES,
  AI_CAPTION_TONES,
  normalizeAiCaptionOutput,
} from "../app/lib/ai-caption.mjs";

test("AI caption generation options are fixed structured values", () => {
  assert.ok(AI_CAPTION_SERVICES.some((option) => option.id === "interior-cleaning"));
  assert.deepEqual(AI_CAPTION_LANGUAGES.map((option) => option.id), ["ru", "ro"]);
  assert.ok(AI_CAPTION_STYLES.some((option) => option.id === "transformation"));
  assert.ok(AI_CAPTION_TONES.some((option) => option.id === "professional"));
});

test("normalizes generated caption and limits hashtags", () => {
  assert.deepEqual(normalizeAiCaptionOutput({
    caption: "  Чистый салон — комфорт в каждой поездке.  ",
    hashtags: ["детейлинг", "#авто", "невалидный тег", "длинный".repeat(10), 3],
  }), {
    caption: "Чистый салон — комфорт в каждой поездке.",
    hashtags: ["#детейлинг", "#авто"],
  });
});

test("rejects empty or oversized generated text", () => {
  assert.throws(() => normalizeAiCaptionOutput({ caption: " ", hashtags: [] }));
  assert.throws(() => normalizeAiCaptionOutput({ caption: "x".repeat(701), hashtags: [] }));
});
