import { parseRecordDate } from "./finance.mjs";
import { availableWorkPost } from "./appointments.mjs";

function dateKey(value) {
  const date = parseRecordDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeKey(value) {
  const date = parseRecordDate(value);
  return date
    ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : "";
}

export function findWaitlistMatches(entry, windows, appointments, services, workPosts, now = Date.now()) {
  const service = services.find((item) => item.id === entry.serviceId);
  if (!service) return [];

  const duration = Number(service.duration) || 60;
  const requestedEnd =
    Number(entry.endTime.slice(0, 2)) * 60 + Number(entry.endTime.slice(3, 5));

  return windows.flatMap((window) => {
    const windowDate = parseRecordDate(window.datetime);
    if (!windowDate || windowDate.getTime() <= now || dateKey(window.datetime) !== entry.date) {
      return [];
    }

    const time = timeKey(window.datetime);
    if (!time || time < entry.startTime || time > entry.endTime) return [];

    if (window.service && window.service !== service.name) return [];

    const endMinutes =
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + duration;
    if (endMinutes > requestedEnd) return [];

    const slot = availableWorkPost(
      appointments,
      { datetime: window.datetime, serviceDuration: duration, workPostId: window.workPostId || "" },
      services,
      workPosts,
    );
    return slot ? [{ ...window, suggestedPostId: slot.postId }] : [];
  });
}
