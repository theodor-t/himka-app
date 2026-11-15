import test from "node:test";
import assert from "node:assert/strict";
import { findWaitlistMatches } from "../app/lib/waitlist.mjs";

const now = new Date(2026, 9, 1).getTime();
const entry = {
  serviceId: "service-1",
  date: "2026-10-12",
  startTime: "10:00",
  endTime: "12:00",
};
const services = [{ id: "service-1", name: "Полировка", duration: 90 }];
const windows = [
  { id: "fits", datetime: "2026-10-12T10:00:00", service: "Полировка" },
  { id: "too-late", datetime: "2026-10-12T11:00:00", service: "Полировка" },
  { id: "wrong-service", datetime: "2026-10-12T10:00:00", service: "Мойка" },
  { id: "past", datetime: "2026-09-30T10:00:00", service: "Полировка" },
];

test("waitlist matching respects date, service, time range and service duration", () => {
  const result = findWaitlistMatches(entry, windows, [], services, [], now);
  assert.deepEqual(result.map((window) => window.id), ["fits"]);
});

test("waitlist matching excludes unavailable windows and suggests a free post", () => {
  const appointments = [
    { id: "occupied", datetime: "2026-10-12T10:00:00", serviceDuration: 90, workPostId: "post-1" },
  ];
  const posts = [{ id: "post-1" }, { id: "post-2" }];

  const result = findWaitlistMatches(entry, windows, appointments, services, posts, now);
  assert.equal(result[0].suggestedPostId, "post-2");
});

test("waitlist matching returns no results when the requested service was removed", () => {
  assert.deepEqual(findWaitlistMatches(entry, windows, [], [], [], now), []);
});
