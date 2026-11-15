import test from "node:test";
import assert from "node:assert/strict";
import { removeExpiredWindows } from "../app/lib/windows.mjs";

test("expired windows are removed and logged as system actions", () => {
  const database = {
    windows: [
      { id: "yesterday", datetime: "2026-11-14T12:00:00" },
      { id: "earlier-today", datetime: "2026-11-15T10:00:00" },
      { id: "later-today", datetime: "2026-11-15T12:00:00" },
      { id: "invalid", datetime: "not-a-date" },
    ],
    logs: [],
  };

  const result = removeExpiredWindows(database, new Date(2026, 10, 15, 11, 0));
  assert.deepEqual(result.database.windows.map((window) => window.id), ["later-today", "invalid"]);
  assert.equal(result.expired.length, 2);
  assert.equal(result.database.logs.length, 2);
  assert.ok(result.database.logs.every((log) => log.user === "Система"));
  assert.ok(result.database.logs.every((log) => log.action.includes("истёк срок действия")));
  assert.equal(database.windows.length, 4, "expiration must not mutate the source snapshot");
});

test("expiration is idempotent and creates a single audit log per window", () => {
  const database = {
    windows: [{ id: "slot-1", datetime: "2026-11-15T10:00:00" }],
    logs: [],
  };
  const first = removeExpiredWindows(database, new Date(2026, 10, 15, 11, 0)).database;
  const second = removeExpiredWindows(first, new Date(2026, 10, 15, 11, 1)).database;

  assert.equal(second.logs.length, 1);
  assert.equal(second.logs[0].id, first.logs[0].id);
});

test("future windows and snapshots without expired windows remain unchanged", () => {
  const database = {
    windows: [{ id: "future", datetime: "2026-11-16T10:00:00" }],
    logs: [],
  };
  const result = removeExpiredWindows(database, new Date(2026, 10, 15, 11, 0));

  assert.equal(result.database, database);
  assert.deepEqual(result.expired, []);
});
