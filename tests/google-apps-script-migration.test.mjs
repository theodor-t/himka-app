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
