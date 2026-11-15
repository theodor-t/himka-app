import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit } from "../app/lib/ai-rate-limit.mjs";

test("AI rate limit allows a bounded request window and reports retry delay", () => {
  const key = `rate-limit-${Date.now()}-${Math.random()}`;
  assert.equal(consumeRateLimit(key, 2, 60_000, 1_000).allowed, true);
  assert.equal(consumeRateLimit(key, 2, 60_000, 1_100).allowed, true);
  const limited = consumeRateLimit(key, 2, 60_000, 1_200);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 60);
  assert.equal(consumeRateLimit(key, 2, 60_000, 61_001).allowed, true);
});
