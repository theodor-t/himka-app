/**
 * ANGEL DETAILING database API.
 * Store API_KEY in Project Settings > Script properties.
 */
const SPREADSHEET_ID = "1oeCmLQMyshlypcv0oZ_xy0v_jouelNv8pG71_BuoA1o";
const DATABASE_SHEET = "Database";
const DB_SCHEMA_VERSION = 4;
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
  "notificationPreferences",
  "suppliers",
  "supplierPayments",
  "workPosts",
  "financialGoals",
  "employeeProfiles",
  "systemEvents",
];

function doGet(e) {
  if (!isAuthorized(e)) return jsonResponse({ error: "Unauthorized" }, 401);

  if (e?.parameter?.action === "getInspectionFile") {
    try {
      return getInspectionFile(e.parameter.id);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const result = removeExpiredWindowsFromDatabase(readDatabase(), new Date());
    if (result.expired.length) writeDatabase(result.database);
    return jsonResponse(result.database);
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function doPost(e) {
  if (!isAuthorized(e)) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    if (!e?.postData?.contents) throw new Error("Request body is empty");
    if (e?.parameter?.action === "mergeNotifications") {
      return mergeNotifications(e.postData.contents);
    }
    if (e?.parameter?.action === "claimNotificationAiSlot") {
      return claimNotificationAiSlot();
    }
    if (e?.parameter?.action === "uploadInspectionFile") {
      return uploadInspectionFile(e.postData.contents);
    }

    if (e?.parameter?.action === "deleteInspectionFile") {
      return deleteInspectionFile(e.postData.contents);
    }
    const data = JSON.parse(e.postData.contents);
    validateDatabase(data);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const now = new Date();
      const current = removeExpiredWindowsFromDatabase(readDatabase(), now);
      if (current.expired.length) writeDatabase(current.database);
      const incoming = removeExpiredWindowsFromDatabase(data, now);
      const incomingLogIds = new Set(incoming.database.logs.map(function (log) {
        return String(log.id);
      }));
      const existingExpirationLogs = current.database.logs.filter(function (log) {
        return String(log.id).indexOf("system-expired-window:") === 0;
      });
      const existingSmartNotificationLogs = current.database.logs.filter(function (log) {
        return String(log.id).indexOf("system-smart-notification:") === 0;
      });
      incoming.database.logs = existingExpirationLogs
        .concat(existingSmartNotificationLogs)
        .filter(function (log, index, logs) {
          return !incomingLogIds.has(String(log.id)) &&
            logs.findIndex(function (candidate) {
              return String(candidate.id) === String(log.id);
            }) === index;
        })
        .concat(incoming.database.logs);
      writeDatabase(incoming.database);
    } finally {
      lock.releaseLock();
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

function mergeNotifications(contents) {
  const payload = JSON.parse(contents);
  if (!payload || !Array.isArray(payload.notifications)) {
    return jsonResponse({ error: "Invalid notifications payload" }, 400);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const database = readDatabase();
    const existing = Array.isArray(database.notifications) ? database.notifications : [];
    const existingById = new Map(existing.map(function (item) {
      return [String(item.id), item];
    }));
    const incomingById = new Map(payload.notifications.map(function (item) {
      return [String(item.id), item];
    }));
    const merged = existing.map(function (item) {
      const update = incomingById.get(String(item.id));
      if (!update) return item;
      incomingById.delete(String(item.id));
      if (!update.smart) return item;
      return Object.assign({}, update, {
        readBy: Object.assign({}, item.readBy || {}, update.readBy || {}),
        archivedBy: Object.assign({}, item.archivedBy || {}, update.archivedBy || {}),
        dismissedBy: Object.assign({}, item.dismissedBy || {}, update.dismissedBy || {}),
      });
    });
    incomingById.forEach(function (item) {
      if (item && item.smart === true && typeof item.id === "string") merged.push(item);
    });
    const notificationLogs = payload.notifications.filter(function (item) {
      if (!item || item.smart !== true) return false;
      const previous = existingById.get(String(item.id));
      return !previous ||
        previous.status !== item.status ||
        previous.fingerprint !== item.fingerprint;
    }).map(function (item) {
      const updatedAt = String(item.updatedAt || new Date().toISOString());
      const parsedDate = new Date(updatedAt);
      const logDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      return {
        id: "system-smart-notification:" + String(item.id) + ":" + updatedAt,
        datetime: Utilities.formatDate(
          logDate,
          Session.getScriptTimeZone(),
          "dd.MM.yyyy HH:mm",
        ),
        user: "Система",
        action: (existingById.has(String(item.id)) ? "Обновлён сигнал" : "Создан сигнал") +
          ": " + String(item.title || "уведомление").slice(0, 120),
      };
    });
    const currentSmartLogs = (database.logs || []).filter(function (log) {
      return String(log.id).indexOf("system-smart-notification:") === 0;
    });
    const smartLogIds = new Set(currentSmartLogs.map(function (log) {
      return String(log.id);
    }));
    const newSmartLogs = notificationLogs.filter(function (log) {
      return !smartLogIds.has(String(log.id));
    });
    database.logs = newSmartLogs.concat(database.logs || []);
    database.notifications = merged;
    writeDatabase(database);
    return jsonResponse({ ok: true, count: merged.length });
  } finally {
    lock.releaseLock();
  }
}

function claimNotificationAiSlot() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = "LAST_NOTIFICATION_AI_REQUEST_AT";
    const now = Date.now();
    const lastRequest = Number(properties.getProperty(key)) || 0;
    const cooldown = 5 * 60 * 1000;
    if (now - lastRequest < cooldown) {
      return jsonResponse({
        granted: false,
        retryAfterSeconds: Math.ceil((cooldown - (now - lastRequest)) / 1000),
      });
    }
    properties.setProperty(key, String(now));
    return jsonResponse({ granted: true });
  } finally {
    lock.releaseLock();
  }
}

function uploadInspectionFile(contents) {
  const fileData = JSON.parse(contents);
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;
  if (!fileData || !allowedTypes.includes(fileData.mimeType)) {
    return jsonResponse({ error: "Unsupported file type" }, 400);
  }
  if (
    typeof fileData.base64 !== "string" ||
    fileData.base64.length > Math.ceil(maxBytes * 4 / 3) + 8 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(fileData.base64)
  ) {
    return jsonResponse({ error: "Invalid or oversized file" }, 400);
  }

  const bytes = Utilities.base64Decode(fileData.base64);
  if (
    !bytes.length ||
    bytes.length > maxBytes ||
    Number(fileData.size) !== bytes.length ||
    !hasImageSignature(bytes, fileData.mimeType)
  ) {
    return jsonResponse({ error: "Invalid or oversized file" }, 400);
  }
  const fileName = String(fileData.name || "inspection-photo")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .slice(0, 120);
  const folder = getInspectionFolder();
  const file = folder.createFile(
    Utilities.newBlob(bytes, fileData.mimeType, fileName),
  );
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const cleanupToken =
    Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "");
  file.setDescription(cleanupToken);
  return jsonResponse({
    ok: true,
    file: {
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      createdAt: file.getDateCreated().toISOString(),
      cleanupToken: cleanupToken,
    },
  }, 200);
}

function deleteInspectionFile(contents) {
  const request = JSON.parse(contents);
  if (
    !request ||
    !/^[A-Za-z0-9_-]{10,}$/.test(String(request.id || "")) ||
    !/^[A-Za-z0-9_-]{24,}$/.test(String(request.cleanupToken || ""))
  ) {
    return jsonResponse({ error: "Invalid cleanup request" }, 400);
  }
  const folder = getInspectionFolder();
  const file = DriveApp.getFileById(request.id);
  const parents = file.getParents();
  let belongsToFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) belongsToFolder = true;
  }
  if (!belongsToFolder || file.getDescription() !== request.cleanupToken) {
    return jsonResponse({ error: "Temporary file not found" }, 404);
  }
  file.setTrashed(true);
  return jsonResponse({ ok: true }, 200);
}

function getInspectionFile(fileId) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId || ""))) {
    return jsonResponse({ error: "Invalid file ID" }, 400);
  }
  const folder = getInspectionFolder();
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  let belongsToFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) belongsToFolder = true;
  }
  if (!belongsToFolder || file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    return jsonResponse({ error: "File not found" }, 404);
  }
  const mimeType = file.getMimeType();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return jsonResponse({ error: "Unsupported file type" }, 415);
  }
  const bytes = file.getBlob().getBytes();
  if (
    !bytes.length ||
    bytes.length > 5 * 1024 * 1024 ||
    !hasImageSignature(bytes, mimeType)
  ) {
    return jsonResponse({ error: "Invalid or unsupported image file" }, 415);
  }
  return jsonResponse({
    id: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
    size: bytes.length,
    base64: Utilities.base64Encode(bytes),
  }, 200);
}

function hasImageSignature(bytes, mimeType) {
  const unsigned = bytes.map(function (byte) { return byte & 255; });
  if (mimeType === "image/jpeg") {
    return unsigned[0] === 0xff && unsigned[1] === 0xd8 && unsigned[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every(function (byte, index) { return unsigned[index] === byte; });
  }
  if (mimeType === "image/webp") {
    return (
      String.fromCharCode.apply(null, unsigned.slice(0, 4)) === "RIFF" &&
      String.fromCharCode.apply(null, unsigned.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

function getInspectionFolder() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = properties.getProperty("INSPECTION_FOLDER_ID");
  let folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const currentId = properties.getProperty("INSPECTION_FOLDER_ID");
      folder = currentId
        ? DriveApp.getFolderById(currentId)
        : DriveApp.createFolder("ANGEL DETAILING — Осмотры");
      if (!currentId) properties.setProperty("INSPECTION_FOLDER_ID", folder.getId());
    } finally {
      lock.releaseLock();
    }
  }
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error("Inspection folder must be private");
  }
  return folder;
}

function cleanupExpiredWindows() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = removeExpiredWindowsFromDatabase(readDatabase(), new Date());
    if (result.expired.length) writeDatabase(result.database);
    return result.expired.length;
  } finally {
    lock.releaseLock();
  }
}

function installWindowExpirationTrigger() {
  const alreadyInstalled = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "cleanupExpiredWindows";
  });
  if (alreadyInstalled) return;
  ScriptApp.newTrigger("cleanupExpiredWindows").timeBased().everyHours(1).create();
}

function refreshSmartNotifications() {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty("NOTIFICATION_REFRESH_URL");
  const secret = properties.getProperty("NOTIFICATION_CRON_SECRET");
  if (!url || !secret) throw new Error("Set NOTIFICATION_REFRESH_URL and NOTIFICATION_CRON_SECRET");
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + secret },
    payload: "{}",
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("Smart notification refresh failed (" + status + "): " + body.slice(0, 300));
  }
  return body;
}

function installSmartNotificationTrigger() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("NOTIFICATION_REFRESH_URL") ||
      !properties.getProperty("NOTIFICATION_CRON_SECRET")) {
    throw new Error("Set NOTIFICATION_REFRESH_URL and NOTIFICATION_CRON_SECRET first");
  }
  const alreadyInstalled = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "refreshSmartNotifications";
  });
  if (!alreadyInstalled) {
    ScriptApp.newTrigger("refreshSmartNotifications").timeBased().everyHours(1).create();
  }
}

function removeExpiredWindowsFromDatabase(database, now) {
  const expired = [];
  const active = [];
  database.windows.forEach(function (window) {
    const date = parseWindowDateTime(window.datetime);
    if (date && date.getTime() <= now.getTime()) expired.push(window);
    else active.push(window);
  });
  if (!expired.length) return { database: database, expired: expired };

  const logIds = new Set(database.logs.map(function (log) { return String(log.id); }));
  const newLogs = expired.map(function (window) {
    const logId = "system-expired-window:" + String(window.id || "") + ":" + String(window.datetime || "");
    if (logIds.has(logId)) return null;
    return {
      id: logId,
      datetime: Utilities.formatDate(now, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm"),
      user: "Система",
      action: "Свободное окно удалено системой: истёк срок действия (" +
        formatWindowDateTime(window.datetime) + ")",
    };
  }).filter(function (log) { return log !== null; });

  return {
    database: Object.assign({}, database, {
      windows: active,
      logs: newLogs.concat(database.logs),
    }),
    expired: expired,
  };
}

function parseWindowDateTime(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = String(value || "").trim();
  const legacy = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (legacy) {
    const date = new Date(
      Number(legacy[3]),
      Number(legacy[2]) - 1,
      Number(legacy[1]),
      Number(legacy[4] || 0),
      Number(legacy[5] || 0),
    );
    return date.getFullYear() === Number(legacy[3]) &&
      date.getMonth() === Number(legacy[2]) - 1 &&
      date.getDate() === Number(legacy[1])
      ? date
      : null;
  }
  const localIso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localIso) {
    const date = new Date(
      Number(localIso[1]),
      Number(localIso[2]) - 1,
      Number(localIso[3]),
      Number(localIso[4] || 0),
      Number(localIso[5] || 0),
      Number(localIso[6] || 0),
    );
    return date.getFullYear() === Number(localIso[1]) &&
      date.getMonth() === Number(localIso[2]) - 1 &&
      date.getDate() === Number(localIso[3])
      ? date
      : null;
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatWindowDateTime(value) {
  const date = parseWindowDateTime(value);
  return date
    ? Utilities.formatDate(date, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm")
    : String(value || "неизвестно");
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
