import test from "node:test";
import assert from "node:assert/strict";
import { availableWorkPost } from "../app/lib/appointments.mjs";

const posts = [
  { id: "post-1", name: "Пост 1" },
  { id: "post-2", name: "Пост 2" },
];
const candidate = { datetime: "2026-11-15T10:00", serviceDuration: 60 };

test("legacy behavior still blocks overlapping appointments if no posts exist", () => {
  const appointments = [{ id: "a1", datetime: "2026-11-15T10:30", serviceDuration: 30 }];
  assert.equal(availableWorkPost(appointments, candidate, [], [], ""), null);
  assert.equal(availableWorkPost([], candidate, [], [], "").postId, "");
});

test("appointment capacity is limited by the number of active work posts", () => {
  const appointments = [
    { id: "a1", datetime: "2026-11-15T10:00", serviceDuration: 60, workPostId: "post-1" },
  ];

  assert.equal(availableWorkPost(appointments, candidate, [], posts)?.postId, "post-2");
  assert.equal(
    availableWorkPost(
      [...appointments, { id: "a2", datetime: "2026-11-15T10:15", serviceDuration: 30, workPostId: "post-2" }],
      candidate,
      [],
      posts,
    ),
    null,
  );
});

test("maintenance posts do not count as bookable capacity", () => {
  const result = availableWorkPost(
    [{ id: "a1", datetime: "2026-11-15T10:00", serviceDuration: 60, workPostId: "post-1" }],
    candidate,
    [],
    [...posts, { id: "post-3", status: "maintenance" }],
  );

  assert.equal(result?.postId, "post-2");
});

test("unassigned legacy appointments consume free post capacity", () => {
  const appointments = [
    { id: "a1", datetime: "2026-11-15T10:00", serviceDuration: 60 },
    { id: "a2", datetime: "2026-11-15T10:15", serviceDuration: 30 },
  ];

  assert.equal(availableWorkPost(appointments, candidate, [], posts), null);
});

test("non-overlapping intervals may use the same post", () => {
  const appointments = [
    { id: "a1", datetime: "2026-11-15T08:00", serviceDuration: 60, workPostId: "post-1" },
  ];

  assert.equal(availableWorkPost(appointments, candidate, [], posts)?.postId, "post-1");
});
