import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocalPreviewDatabase,
  isLocalPreviewRequest,
  resetLocalPreviewDatabase,
  setLocalPreviewDatabase,
} from "../app/lib/local-preview.mjs";
import { DB_SCHEMA_VERSION } from "../app/lib/database.mjs";

test("local preview requires development mode and a loopback hostname", () => {
  assert.equal(
    isLocalPreviewRequest({ url: "http://localhost:3000/api/auth" }, "development"),
    true,
  );
  assert.equal(
    isLocalPreviewRequest({ url: "http://127.0.0.1:3000/api/auth" }, "development"),
    true,
  );
  assert.equal(
    isLocalPreviewRequest({ url: "http://crm.example.com/api/auth" }, "development"),
    false,
  );
  assert.equal(
    isLocalPreviewRequest({ url: "http://localhost:3000/api/auth" }, "production"),
    false,
  );
});

test("local preview database is isolated, normalized and resettable", () => {
  resetLocalPreviewDatabase();
  const initial = getLocalPreviewDatabase();
  assert.deepEqual(initial.clients, []);

  initial.clients.push({ id: "client-not-saved" });
  assert.deepEqual(getLocalPreviewDatabase().clients, []);

  const updated = setLocalPreviewDatabase({
    clients: [{ id: "local-client" }],
  });
  assert.equal(updated.clients[0].id, "local-client");
  assert.equal(updated.schemaVersion, DB_SCHEMA_VERSION);

  resetLocalPreviewDatabase();
  assert.deepEqual(getLocalPreviewDatabase().clients, []);
});
