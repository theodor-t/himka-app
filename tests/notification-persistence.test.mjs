import test from "node:test";
import assert from "node:assert/strict";
import { persistNotifications } from "../app/lib/notification-persistence.mjs";

function response(payload, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    text: async () => JSON.stringify(payload),
  };
}

test("notification persistence falls back when deployed Apps Script lacks merge action", async () => {
  const calls = [];
  const database = {
    schemaVersion: 4,
    clients: [{ id: "client-1" }],
    notifications: [],
  };
  const notifications = [{ id: "smart-1", smart: true, status: "active" }];
  const result = await persistNotifications({
    url: "https://script.google.com/macros/s/test/exec",
    apiKey: "test-key",
    notifications,
    database,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return calls.length === 1
        ? response({ error: "Invalid collection: clients", status: 400 }, false)
        : response({ ok: true, status: 200 });
    },
  });

  assert.equal(result.compatibilityFallback, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("action"), "mergeNotifications");
  assert.equal(calls[1].url.searchParams.has("action"), false);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    ...database,
    notifications,
  });
});

test("notification persistence does not hide unrelated Google errors", async () => {
  await assert.rejects(
    persistNotifications({
      url: "https://script.google.com/macros/s/test/exec",
      apiKey: "test-key",
      notifications: [],
      database: { clients: [] },
      fetchImpl: async () => response({ error: "Unauthorized", status: 401 }, false),
    }),
    /Unauthorized/,
  );
});
