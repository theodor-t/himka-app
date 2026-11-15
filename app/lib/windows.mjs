import { parseRecordDate } from "./finance.mjs";
import { sortAuditLogsNewestFirst } from "./audit.mjs";

function localDateTime(value) {
  const date = parseRecordDate(value);
  if (!date) return String(value || "неизвестно");
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function removeExpiredWindows(database, now = new Date()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  const expired = [];
  const active = [];

  for (const window of database.windows) {
    const windowTime = parseRecordDate(window.datetime)?.getTime();
    if (Number.isFinite(windowTime) && windowTime <= nowTime) expired.push(window);
    else active.push(window);
  }

  if (!expired.length) return { database, expired };

  const existingLogIds = new Set(database.logs.map((log) => String(log.id)));
  const expirationLogs = expired
    .map((window) => {
      const id = `system-expired-window:${window.id ?? ""}:${window.datetime ?? ""}`;
      if (existingLogIds.has(id)) return null;
      return {
        id,
        datetime: localDateTime(now),
        user: "Система",
        action: `Свободное окно удалено системой: истёк срок действия (${localDateTime(window.datetime)})`,
      };
    })
    .filter(Boolean);

  return {
    database: {
      ...database,
      windows: active,
      logs: sortAuditLogsNewestFirst([...expirationLogs, ...database.logs]),
    },
    expired,
  };
}
