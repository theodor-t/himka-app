import { parseRecordDate } from "./finance.mjs";

const isCancelled = (appointment) =>
  ["Отменен", "Не пришел"].includes(appointment?.status);

function serviceDuration(appointment, services) {
  return Math.max(
    1,
    Number(appointment?.serviceDuration) ||
      Number(services.find((service) => service.name === appointment?.service)?.duration) ||
      60,
  );
}

export function availableWorkPost(appointments, candidate, services, workPosts, ignoredId) {
  const start = parseRecordDate(candidate?.datetime)?.getTime();
  if (!Number.isFinite(start)) return null;
  const end = start + serviceDuration(candidate, services) * 60000;
  const posts = workPosts.filter((post) => !post.archived && post.status !== "maintenance");

  if (!posts.length) {
    const conflict = appointments.some((appointment) => {
      if (appointment.id === ignoredId || isCancelled(appointment)) return false;
      const appointmentStart = parseRecordDate(appointment.datetime)?.getTime();
      if (!Number.isFinite(appointmentStart)) return false;
      const appointmentEnd =
        appointmentStart + serviceDuration(appointment, services) * 60000;
      return start < appointmentEnd && appointmentStart < end;
    });
    return conflict ? null : { postId: "" };
  }

  const overlapping = appointments.filter((appointment) => {
    if (appointment.id === ignoredId || isCancelled(appointment)) return false;
    const appointmentStart = parseRecordDate(appointment.datetime)?.getTime();
    if (!Number.isFinite(appointmentStart)) return false;
    const appointmentEnd =
      appointmentStart + serviceDuration(appointment, services) * 60000;
    return start < appointmentEnd && appointmentStart < end;
  });
  const occupied = new Set(
    overlapping
      .map((appointment) => appointment.workPostId)
      .filter(Boolean)
      .map(String),
  );
  const unassignedCount = overlapping.filter((appointment) => !appointment.workPostId).length;
  const unassignedSpots = posts
    .filter((post) => !occupied.has(String(post.id)))
    .slice(0, unassignedCount);
  unassignedSpots.forEach((post) => occupied.add(String(post.id)));

  const preferred = candidate.workPostId &&
    posts.some((post) => String(post.id) === String(candidate.workPostId)) &&
    !occupied.has(String(candidate.workPostId))
    ? posts.find((post) => String(post.id) === String(candidate.workPostId))
    : null;
  const selected = preferred || posts.find((post) => !occupied.has(String(post.id)));
  return selected ? { postId: selected.id } : null;
}

