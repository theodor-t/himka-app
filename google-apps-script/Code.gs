/**
 * ANGEL DETAILING database API.
 * Store API_KEY in Project Settings > Script properties.
 */
const SPREADSHEET_ID = "1oeCmLQMyshlypcv0oZ_xy0v_jouelNv8pG71_BuoA1o";
const DATABASE_SHEET = "Database";
const DB_SCHEMA_VERSION = 3;
const REQUIRED_COLLECTIONS = [
  "clients",
  "expenses",
  "incomes",
  "warehouse",
  "withdrawals",
  "debts",
  "windows",
  "logs",
  "stockMovements",
  "services",
  "videoDescriptions",
  "messageTemplates",
];
const EXTENDED_COLLECTIONS = [
  "customers",
  "vehicles",
  "orders",
  "inspections",
  "waitlistEntries",
  "servicePackages",
  "loyaltyTransactions",
  "reminders",
  "notifications",
  "suppliers",
  "supplierPayments",
  "workPosts",
  "financialGoals",
  "employeeProfiles",
  "systemEvents",
];

function doGet(e) {
  if (!isAuthorized(e)) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const data = readDatabase();
    return jsonResponse(data);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

function doPost(e) {
  if (!isAuthorized(e)) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    if (!e?.postData?.contents) throw new Error("Request body is empty");
    const data = JSON.parse(e.postData.contents);
    validateDatabase(data);
    writeDatabase(data);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

function isAuthorized(e) {
  const expectedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
  return Boolean(expectedKey && e?.parameter?.key === expectedKey);
}

function getDatabaseSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheet.getSheetByName(DATABASE_SHEET) || spreadsheet.insertSheet(DATABASE_SHEET);
}

function readDatabase() {
  const sheet = getDatabaseSheet();
  const value = sheet.getRange("A1").getValue();
  if (!value) return createEmptyDatabase();
  const data = JSON.parse(value);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid database");
  }
  const database = Object.assign(createEmptyDatabase(), data);
  if (!Number.isSafeInteger(data.schemaVersion)) database.schemaVersion = 1;
  return database;
}

function writeDatabase(data) {
  const sheet = getDatabaseSheet();
  const current = readDatabase();
  const incomingVersion = Number.isSafeInteger(data.schemaVersion)
    ? data.schemaVersion
    : 1;
  const next = Object.assign({}, current, data, {
    schemaVersion: Math.max(current.schemaVersion, incomingVersion),
  });
  EXTENDED_COLLECTIONS.forEach(function (collection) {
    if (!Object.prototype.hasOwnProperty.call(data, collection)) {
      next[collection] = current[collection] || [];
    }
  });
  sheet.getRange("A1").setValue(JSON.stringify(next));
  sheet.getRange("A1").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setFrozenRows(0);
}

function createEmptyDatabase() {
  const data = { schemaVersion: DB_SCHEMA_VERSION };
  REQUIRED_COLLECTIONS.concat(EXTENDED_COLLECTIONS).forEach(function (collection) {
    data[collection] = [];
  });
  return data;
}

function validateDatabase(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid database");
  REQUIRED_COLLECTIONS.forEach(function (collection) {
    if (!Array.isArray(data[collection])) {
      throw new Error("Invalid collection: " + collection);
    }
  });
  EXTENDED_COLLECTIONS.forEach(function (collection) {
    if (data[collection] !== undefined && !Array.isArray(data[collection])) {
      throw new Error("Invalid collection: " + collection);
    }
  });
}

function jsonResponse(data, status) {
  return ContentService.createTextOutput(JSON.stringify({ ...data, status }))
    .setMimeType(ContentService.MimeType.JSON);
}

function generateApiKey() {
  const key = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("API_KEY", key);
  Logger.log(key);
}
