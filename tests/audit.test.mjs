import test from "node:test";
import assert from "node:assert/strict";
import { sortAuditLogsNewestFirst } from "../app/lib/audit.mjs";

test("audit entries are sorted newest first without mutating the source array", () => {
  const logs = [
    { id: "older", datetime: "2026-10-16T10:00:00.000Z" },
    { id: "newer", datetime: "2026-10-17T10:00:00.000Z" },
    { id: "middle", datetime: "2026-10-16T18:00:00.000Z" },
  ];

  assert.deepEqual(
    sortAuditLogsNewestFirst(logs).map(({ id }) => id),
    ["newer", "middle", "older"],
  );
  assert.deepEqual(logs.map(({ id }) => id), ["older", "newer", "middle"]);
});

test("audit entries with identical timestamps retain their input order", () => {
  const logs = [
    { id: "first", datetime: "2026-10-17T10:00:00.000Z" },
    { id: "second", datetime: "2026-10-17T10:00:00.000Z" },
  ];

  assert.deepEqual(
    sortAuditLogsNewestFirst(logs).map(({ id }) => id),
    ["first", "second"],
  );
});
