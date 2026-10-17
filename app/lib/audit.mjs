import { parseRecordDate } from "./finance.mjs";

export function sortAuditLogsNewestFirst(logs = []) {
  return [...logs].sort((first, second) => {
    const firstTime = parseRecordDate(first.datetime)?.getTime() || 0;
    const secondTime = parseRecordDate(second.datetime)?.getTime() || 0;
    return secondTime - firstTime;
  });
}
