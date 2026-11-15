/**
 * ANGEL DETAILING database API.
 * Store API_KEY in Project Settings > Script properties.
 */
const SPREADSHEET_ID = "1oeCmLQMyshlypcv0oZ_xy0v_jouelNv8pG71_BuoA1o";
const DATABASE_SHEET = "Database";
const DB_SCHEMA_VERSION = 5;
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
  "advisorRecommendations",
];

function doGet(e) {
  if (!isAuthorized(e)) return jsonResponse({ error: "Unauthorized" }, 401);

  if (String(e?.parameter?.action || "").indexOf("aiChat") === 0) {
    try {
      return handleAiChatGet(e);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

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
    if (String(e?.parameter?.action || "").indexOf("aiChat") === 0) {
      return handleAiChatPost(e.parameter.action, e.postData.contents);
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

const AI_CHAT_CONVERSATIONS_SHEET = "AI Chat Conversations";
const AI_CHAT_MESSAGES_SHEET = "AI Chat Messages";
const AI_CHAT_ATTACHMENTS_SHEET = "AI Chat Attachments";
const AI_CHAT_MAX_FILE_BYTES = 3 * 1024 * 1024;
const AI_CHAT_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "text/csv"];

function handleAiChatGet(e) {
  const action = String(e?.parameter?.action || "");
  const username = validateAiChatUsername(e?.parameter?.username);
  if (action === "aiChatList") {
    return jsonResponse({ conversations: listAiChatConversations(username) }, 200);
  }
  if (action === "aiChatGet") {
    const result = getAiChatConversation(username, e.parameter.id);
    return jsonResponse(result, result.status || 200);
  }
  if (action === "aiChatAttachment") {
    return getAiChatAttachment(username, e.parameter.conversationId, e.parameter.id);
  }
  return jsonResponse({ error: "Unknown AI chat action" }, 400);
}

function handleAiChatPost(action, contents) {
  const request = JSON.parse(contents);
  const username = validateAiChatUsername(request?.username);
  if (action === "aiChatCreate") return createAiChatConversation(username, request);
  if (action === "aiChatSaveMessage") return saveAiChatMessage(username, request);
  if (action === "aiChatRename") return renameAiChatConversation(username, request);
  if (action === "aiChatDelete") return deleteAiChatConversation(username, request);
  if (action === "aiChatUploadAttachment") return uploadAiChatAttachment(username, request);
  if (action === "aiChatDeleteAttachment") return deleteAiChatAttachment(username, request);
  return jsonResponse({ error: "Unknown AI chat action" }, 400);
}

function validateAiChatUsername(value) {
  const username = String(value || "");
  if (!/^[A-Z0-9._-]{1,60}$/.test(username)) throw new Error("Invalid AI chat owner");
  return username;
}

function validateAiChatId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(id)) throw new Error("Invalid AI chat ID");
  return id;
}

function aiChatSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const storedHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const canAddExpiryColumn = headers[headers.length - 1] === "expiresAt" &&
      storedHeaders[storedHeaders.length - 1] === "" &&
      headers.slice(0, -1).every(function (header, index) {
        return storedHeaders[index] === header;
      });
    if (canAddExpiryColumn) {
      sheet.getRange(1, headers.length).setValue("expiresAt");
    } else if (headers.some(function (header, index) { return storedHeaders[index] !== header; })) {
      throw new Error("Invalid AI chat sheet structure: " + name);
    }
  }
  return sheet;
}

function aiChatConversationSheet() {
  return aiChatSheet(AI_CHAT_CONVERSATIONS_SHEET, [
    "id", "username", "mode", "title", "preview", "createdAt", "updatedAt",
  ]);
}

function aiChatMessageSheet() {
  return aiChatSheet(AI_CHAT_MESSAGES_SHEET, [
    "id", "conversationId", "username", "role", "content", "createdAt",
    "attachmentsJson", "metadataJson",
  ]);
}

function aiChatAttachmentSheet() {
  return aiChatSheet(AI_CHAT_ATTACHMENTS_SHEET, [
    "id", "conversationId", "messageId", "username", "fileId", "name", "mimeType",
    "size", "createdAt", "status", "expiresAt",
  ]);
}

function aiChatRows(sheet) {
  const lastRow = sheet.getLastRow();
  return lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
}

function aiChatConversationFromRow(row) {
  return {
    id: String(row[0]),
    mode: String(row[2]),
    title: String(row[3]),
    preview: String(row[4] || ""),
    createdAt: String(row[5]),
    updatedAt: String(row[6]),
  };
}

function listAiChatConversations(username) {
  return aiChatRows(aiChatConversationSheet())
    .filter(function (row) { return String(row[1]) === username; })
    .map(aiChatConversationFromRow)
    .sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); })
    .slice(0, 100);
}

function findAiChatConversation(username, id) {
  const conversationId = validateAiChatId(id);
  const sheet = aiChatConversationSheet();
  const rows = aiChatRows(sheet);
  const index = rows.findIndex(function (row) { return String(row[0]) === conversationId; });
  if (index < 0 || String(rows[index][1]) !== username) return null;
  return { sheet: sheet, row: rows[index], rowNumber: index + 2 };
}

function getAiChatConversation(username, id) {
  const found = findAiChatConversation(username, id);
  if (!found) return { error: "AI chat not found", status: 404 };
  const messages = aiChatRows(aiChatMessageSheet())
    .filter(function (row) {
      return String(row[1]) === String(found.row[0]) && String(row[2]) === username;
    })
    .map(function (row) {
      let attachments = [];
      let metadata = {};
      try {
        attachments = JSON.parse(String(row[6] || "[]"));
        metadata = JSON.parse(String(row[7] || "{}"));
      } catch (error) {
        throw new Error("Invalid AI chat message metadata");
      }
      return {
        id: String(row[0]),
        role: String(row[3]),
        content: String(row[4]),
        createdAt: String(row[5]),
        attachments: attachments,
        metadata: metadata,
      };
    });
  const pendingAttachments = aiChatRows(aiChatAttachmentSheet())
    .filter(function (row) {
      return String(row[1]) === String(found.row[0]) &&
        String(row[3]) === username && String(row[9]) === "pending";
    })
    .map(aiChatAttachmentFromRow);
  return {
    conversation: aiChatConversationFromRow(found.row),
    messages: messages,
    pendingAttachments: pendingAttachments,
  };
}

function createAiChatConversation(username, request) {
  const id = validateAiChatId(request?.id);
  const mode = String(request?.mode || "");
  if (mode !== "crm" && mode !== "general") throw new Error("Invalid AI chat mode");
  const title = cleanAiChatTitle(request?.title) || "Новый чат";
  const now = new Date().toISOString();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = aiChatConversationSheet();
    const existing = aiChatRows(sheet).find(function (row) { return String(row[0]) === id; });
    if (existing) {
      if (String(existing[1]) !== username) throw new Error("AI chat ID already exists");
      return jsonResponse({ conversation: aiChatConversationFromRow(existing) }, 200);
    }
    sheet.appendRow([id, username, mode, title, "", now, now]);
    return jsonResponse({
      conversation: { id: id, mode: mode, title: title, preview: "", createdAt: now, updatedAt: now },
    }, 200);
  } finally {
    lock.releaseLock();
  }
}

function saveAiChatMessage(username, request) {
  const conversationId = validateAiChatId(request?.conversationId);
  const messageId = validateAiChatId(request?.message?.id);
  const role = String(request?.message?.role || "");
  const content = String(request?.message?.content || "");
  if (!["user", "assistant"].includes(role) || !content.trim() || content.length > 10000) {
    throw new Error("Invalid AI chat message");
  }
  const attachmentIds = Array.isArray(request.attachmentIds) ? request.attachmentIds : [];
  if (role !== "user" && attachmentIds.length) throw new Error("Only user messages can have attachments");
  if (attachmentIds.length > 3) throw new Error("A message can contain at most 3 attachments");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = findAiChatConversation(username, conversationId);
    if (!found) return jsonResponse({ error: "AI chat not found" }, 404);
    const messageSheet = aiChatMessageSheet();
    const existing = aiChatRows(messageSheet).find(function (row) { return String(row[0]) === messageId; });
    if (existing) {
      if (String(existing[1]) !== conversationId || String(existing[2]) !== username) {
        throw new Error("AI chat message ID already exists");
      }
      const savedAttachments = JSON.parse(String(existing[6] || "[]"));
      if (savedAttachments.length) {
        const attachmentSheet = aiChatAttachmentSheet();
        const attachmentRows = aiChatRows(attachmentSheet);
        savedAttachments.forEach(function (savedAttachment) {
          const index = attachmentRows.findIndex(function (row) {
            return String(row[0]) === String(savedAttachment.id);
          });
          if (index < 0) return;
          const row = attachmentRows[index];
          if (
            String(row[1]) === conversationId &&
            String(row[3]) === username &&
            (String(row[9]) === "pending" ||
              (String(row[9]) === "linked" && String(row[2]) === messageId))
          ) {
            attachmentSheet.getRange(index + 2, 3).setValue(messageId);
            attachmentSheet.getRange(index + 2, 10).setValue("linked");
          }
        });
      }
      return jsonResponse({
        message: {
          id: String(existing[0]),
          role: String(existing[3]),
          content: String(existing[4]),
          createdAt: String(existing[5]),
          attachments: JSON.parse(String(existing[6] || "[]")),
          metadata: JSON.parse(String(existing[7] || "{}")),
        },
      }, 200);
    }

    const attachmentSheet = aiChatAttachmentSheet();
    const attachmentRows = aiChatRows(attachmentSheet);
    const selectedAttachments = attachmentIds.map(function (id) {
      const attachmentId = validateAiChatId(id);
      const index = attachmentRows.findIndex(function (row) { return String(row[0]) === attachmentId; });
      if (index < 0) throw new Error("AI chat attachment not found");
      const row = attachmentRows[index];
      if (
        String(row[1]) !== conversationId ||
        String(row[3]) !== username ||
        String(row[9]) !== "pending"
      ) {
        throw new Error("AI chat attachment is unavailable");
      }
      return { row: row, rowNumber: index + 2 };
    });
    const attachments = selectedAttachments.map(function (item) {
      return aiChatAttachmentFromRow(item.row);
    });

    const createdAt = String(request.message.createdAt || new Date().toISOString());
    const metadata = request.message.metadata && typeof request.message.metadata === "object"
      ? request.message.metadata
      : {};
    messageSheet.appendRow([
      messageId, conversationId, username, role, content.trim(), createdAt,
      JSON.stringify(attachments), JSON.stringify(metadata),
    ]);
    selectedAttachments.forEach(function (item) {
      attachmentSheet.getRange(item.rowNumber, 3).setValue(messageId);
      attachmentSheet.getRange(item.rowNumber, 10).setValue("linked");
    });
    const conversation = found.row.slice();
    conversation[4] = content.trim().slice(0, 200);
    conversation[6] = new Date().toISOString();
    if (role === "user" && (!String(conversation[3]) || String(conversation[3]) === "Новый чат")) {
      conversation[3] = cleanAiChatTitle(content) || "Новый чат";
    }
    found.sheet.getRange(found.rowNumber, 1, 1, conversation.length).setValues([conversation]);
    return jsonResponse({
      message: {
        id: messageId,
        role: role,
        content: content.trim(),
        createdAt: createdAt,
        attachments: attachments,
        metadata: metadata,
      },
    }, 200);
  } finally {
    lock.releaseLock();
  }
}

function renameAiChatConversation(username, request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = findAiChatConversation(username, request?.id);
    if (!found) return jsonResponse({ error: "AI chat not found" }, 404);
    const title = cleanAiChatTitle(request?.title);
    if (!title) throw new Error("Invalid AI chat title");
    found.sheet.getRange(found.rowNumber, 4).setValue(title);
    found.sheet.getRange(found.rowNumber, 7).setValue(new Date().toISOString());
    const row = found.row.slice();
    row[3] = title;
    row[6] = new Date().toISOString();
    return jsonResponse({ conversation: aiChatConversationFromRow(row) }, 200);
  } finally {
    lock.releaseLock();
  }
}

function deleteAiChatConversation(username, request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = findAiChatConversation(username, request?.id);
    if (!found) return jsonResponse({ error: "AI chat not found" }, 404);
    const attachmentSheet = aiChatAttachmentSheet();
    deleteAiChatRows(aiChatMessageSheet(), function (row) {
      return String(row[1]) === String(found.row[0]) && String(row[2]) === username;
    });
    deleteAiChatRows(attachmentSheet, function (row) {
      return String(row[1]) === String(found.row[0]) && String(row[3]) === username;
    });
    found.sheet.deleteRow(found.rowNumber);
    return jsonResponse({ ok: true }, 200);
  } finally {
    lock.releaseLock();
  }
}

function deleteAiChatRows(sheet, predicate) {
  const rows = aiChatRows(sheet);
  for (let index = rows.length - 1; index >= 0; index--) {
    if (predicate(rows[index])) sheet.deleteRow(index + 2);
  }
}

function uploadAiChatAttachment(username, request) {
  const conversationId = validateAiChatId(request?.conversationId);
  const id = validateAiChatId(request?.id);
  const mimeType = String(request?.mimeType || "");
  const fileUri = String(request?.fileUri || "");
  const size = Number(request?.size);
  const createdAtValue = Date.parse(String(request?.createdAt || ""));
  const createdAt = Number.isFinite(createdAtValue)
    ? new Date(createdAtValue)
    : new Date();
  const requestedExpiry = Date.parse(String(request?.expiresAt || ""));
  const maxExpiry = createdAt.getTime() + 48 * 60 * 60 * 1000 + 5 * 60 * 1000;
  const expiresAt = Number.isFinite(requestedExpiry) &&
      requestedExpiry > createdAt.getTime() &&
      requestedExpiry <= maxExpiry
    ? new Date(requestedExpiry)
    : new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
  if (!AI_CHAT_FILE_TYPES.includes(mimeType)) throw new Error("Unsupported AI chat file type");
  if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[A-Za-z0-9_-]+$/.test(fileUri)) {
    throw new Error("Invalid Gemini file URI");
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > AI_CHAT_MAX_FILE_BYTES) {
    throw new Error("Invalid Gemini file size");
  }
  if (expiresAt.getTime() <= Date.now()) throw new Error("Gemini file has expired");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!findAiChatConversation(username, conversationId)) {
      return jsonResponse({ error: "AI chat not found" }, 404);
    }
    const fileName = String(request.name || "ai-attachment")
      .replace(/[\\/:*?"<>|\r\n]/g, "_")
      .slice(0, 120);
    aiChatAttachmentSheet().appendRow([
      id, conversationId, "", username, fileUri, fileName, mimeType,
      size, createdAt.toISOString(), "pending", expiresAt.toISOString(),
    ]);
    return jsonResponse({
      attachment: {
        id: id, conversationId: conversationId, name: fileName, mimeType: mimeType,
        size: size, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
      },
    }, 200);
  } finally {
    lock.releaseLock();
  }
}

function getAiChatAttachment(username, conversationId, id) {
  const conversation = findAiChatConversation(username, conversationId);
  if (!conversation) return jsonResponse({ error: "AI chat not found" }, 404);
  const attachmentId = validateAiChatId(id);
  const row = aiChatRows(aiChatAttachmentSheet()).find(function (item) {
    return String(item[0]) === attachmentId &&
      String(item[1]) === String(conversation.row[0]) &&
      String(item[3]) === username;
  });
  if (!row) return jsonResponse({ error: "AI chat attachment not found" }, 404);
  const fileUri = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[A-Za-z0-9_-]+$/.test(String(row[4]))
    ? String(row[4])
    : "";
  return jsonResponse({
    id: attachmentId,
    name: String(row[5]),
    mimeType: String(row[6]),
    size: Number(row[7]),
    fileUri: fileUri,
    expiresAt: String(row[10] || ""),
  }, 200);
}

function deleteAiChatAttachment(username, request) {
  const conversationId = validateAiChatId(request?.conversationId);
  const attachmentId = validateAiChatId(request?.id);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!findAiChatConversation(username, conversationId)) {
      return jsonResponse({ error: "AI chat not found" }, 404);
    }
    const sheet = aiChatAttachmentSheet();
    const rows = aiChatRows(sheet);
    const index = rows.findIndex(function (row) {
      return String(row[0]) === attachmentId &&
        String(row[1]) === conversationId &&
        String(row[3]) === username &&
        String(row[9]) === "pending";
    });
    if (index < 0) return jsonResponse({ error: "Pending AI chat attachment not found" }, 404);
    sheet.deleteRow(index + 2);
    return jsonResponse({ ok: true }, 200);
  } finally {
    lock.releaseLock();
  }
}

function aiChatAttachmentFromRow(row) {
  return {
    id: String(row[0]),
    name: String(row[5]),
    mimeType: String(row[6]),
    size: Number(row[7]),
    createdAt: String(row[8]),
    expiresAt: String(row[10] || ""),
  };
}

function cleanAiChatTitle(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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

function migrateLegacyAutospaDb() {
  const legacyValue = PropertiesService.getScriptProperties().getProperty("AUTOSPA_DB");
  if (!legacyValue) throw new Error("AUTOSPA_DB was not found; no data was migrated");

  let legacyData;
  try {
    legacyData = JSON.parse(legacyValue);
  } catch (error) {
    throw new Error("AUTOSPA_DB is not valid JSON; no data was migrated");
  }
  if (!legacyData || typeof legacyData !== "object" || Array.isArray(legacyData)) {
    throw new Error("AUTOSPA_DB is not a database object; no data was migrated");
  }

  const database = Object.assign(createEmptyDatabase(), legacyData);
  if (!Number.isSafeInteger(legacyData.schemaVersion)) database.schemaVersion = 1;
  validateDatabase(database);

  const sheet = getDatabaseSheet();
  if (sheet.getRange("A1").getValue()) {
    throw new Error("Database sheet already contains data; refusing to overwrite it");
  }

  sheet.getRange("A1").setValue(JSON.stringify(database));
  sheet.getRange("A1").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setFrozenRows(0);
  Logger.log("AUTOSPA_DB copied to Database. The original AUTOSPA_DB backup was kept.");
  return "Migration complete. AUTOSPA_DB remains as a backup.";
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
