/**
 * ANGEL DETAILING database API.
 * Store API_KEY in Project Settings > Script properties.
 */
const SPREADSHEET_ID = "1oeCmLQMyshlypcv0oZ_xy0v_jouelNv8pG71_BuoA1o";
const DATABASE_SHEET = "Database";

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
  if (!value) {
    return {
      clients: [],
      expenses: [],
      incomes: [],
      warehouse: [],
      withdrawals: [],
      debts: [],
      windows: [],
      logs: [],
    };
  }
  return JSON.parse(value);
}

function writeDatabase(data) {
  const sheet = getDatabaseSheet();
  sheet.getRange("A1").setValue(JSON.stringify(data));
  sheet.getRange("A1").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setFrozenRows(0);
}

function validateDatabase(data) {
  const collections = [
    "clients",
    "expenses",
    "incomes",
    "warehouse",
    "withdrawals",
    "debts",
    "windows",
    "logs",
  ];
  if (!data || typeof data !== "object") throw new Error("Invalid database");
  collections.forEach((collection) => {
    if (!Array.isArray(data[collection])) {
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
