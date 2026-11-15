import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const code = await readFile(
  new URL("../google-apps-script/Code.gs", import.meta.url),
  "utf8",
);

function createMigrationContext({ legacyValue, initialCell = "" }) {
  let cellValue = initialCell;
  const properties = { AUTOSPA_DB: legacyValue };
  const logs = [];
  const range = {
    getValue: () => cellValue,
    setValue: (value) => { cellValue = value; },
    setWrapStrategy: () => {},
  };
  const sheet = {
    getRange: () => range,
    setFrozenRows: () => {},
  };
  const spreadsheet = {
    getSheetByName: () => sheet,
    insertSheet: () => sheet,
  };
  const context = {
    Logger: { log: (message) => logs.push(message) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] || null,
      }),
    },
    SpreadsheetApp: {
      openById: () => spreadsheet,
      WrapStrategy: { CLIP: "CLIP" },
    },
  };

  vm.runInNewContext(code, context);
  return {
    migrate: () => context.migrateLegacyAutospaDb(),
    getCell: () => cellValue,
    getLegacyValue: () => properties.AUTOSPA_DB,
    logs,
  };
}

test("legacy AUTOSPA_DB is copied and retained as a backup", () => {
  const legacy = {
    schemaVersion: 4,
    clients: [{ id: "client-1" }],
    expenses: [],
    incomes: [],
    warehouse: [],
    withdrawals: [],
  };
  const serializedLegacy = JSON.stringify(legacy);
  const migration = createMigrationContext({ legacyValue: serializedLegacy });

  assert.equal(migration.migrate(), "Migration complete. AUTOSPA_DB remains as a backup.");
  const migrated = JSON.parse(migration.getCell());
  assert.deepEqual(migrated.clients, legacy.clients);
  assert.deepEqual(migrated.expenses, []);
  assert.deepEqual(migrated.notifications, []);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migration.getLegacyValue(), serializedLegacy);
  assert.match(migration.logs[0], /original AUTOSPA_DB backup was kept/);
});

test("legacy migration refuses to overwrite an existing Database sheet", () => {
  const existing = JSON.stringify({ clients: [{ id: "existing-client" }] });
  const migration = createMigrationContext({
    legacyValue: JSON.stringify({
      clients: [],
      expenses: [],
      incomes: [],
      warehouse: [],
      withdrawals: [],
    }),
    initialCell: existing,
  });

  assert.throws(migration.migrate, /refusing to overwrite it/);
  assert.equal(migration.getCell(), existing);
});

test("AI chat attachment upload stores Gemini metadata and migrates the sheet without Drive", () => {
  function makeSheet(rows) {
    const data = rows.map((row) => [...row]);
    return {
      getLastRow: () => data.length,
      getLastColumn: () => Math.max(0, ...data.map((row) => row.length)),
      getRange(row, column, rowCount = 1, columnCount = 1) {
        return {
          getValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              data[row + rowOffset - 1]?.[column + columnOffset - 1] ?? "",
            ),
          ),
          setValue(value) {
            data[row - 1] ||= [];
            data[row - 1][column - 1] = value;
          },
          setValues(values) {
            values.forEach((value, rowOffset) => {
              data[row + rowOffset - 1] = [...value];
            });
          },
        };
      },
      appendRow(row) { data.push([...row]); },
      setFrozenRows() {},
      data,
    };
  }

  const conversations = makeSheet([
    ["id", "username", "mode", "title", "preview", "createdAt", "updatedAt"],
    ["conversation-1234567890", "TUDOR", "general", "Test", "", "", ""],
  ]);
  const attachments = makeSheet([
    ["id", "conversationId", "messageId", "username", "fileId", "name", "mimeType", "size", "createdAt", "status"],
  ]);
  const sheets = new Map([
    ["AI Chat Conversations", conversations],
    ["AI Chat Attachments", attachments],
  ]);
  const context = {
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; },
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => sheets.get(name) || null,
        insertSheet: (name) => {
          const sheet = makeSheet([]);
          sheets.set(name, sheet);
          return sheet;
        },
      }),
    },
  };
  vm.runInNewContext(code, context);

  const now = new Date();
  const result = context.uploadAiChatAttachment("TUDOR", {
    conversationId: "conversation-1234567890",
    id: "attachment-1234567890",
    name: "photo.png",
    mimeType: "image/png",
    size: 1024,
    fileUri: "https://generativelanguage.googleapis.com/v1beta/files/gemini-file",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  });

  const payload = JSON.parse(result.content);
  assert.equal(payload.attachment.id, "attachment-1234567890");
  assert.equal(attachments.data[0][10], "expiresAt");
  assert.equal(attachments.data[1][4], "https://generativelanguage.googleapis.com/v1beta/files/gemini-file");
  assert.equal(attachments.data[1][10], payload.attachment.expiresAt);
  assert.equal("base64" in payload.attachment, false);
});
