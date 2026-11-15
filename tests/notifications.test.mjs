import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemNotifications,
  notificationState,
  reconcileSmartNotifications,
  systemNotificationReceipts,
  updateNotificationUserState,
  unreadSystemNotificationCount,
} from "../app/lib/notifications.mjs";

test("system notifications include upcoming bookings, low stock and overdue orders", () => {
  const db = {
    clients: [
      { id: "soon", datetime: "2026-11-15T12:00:00", car: "BMW", service: "Полировка" },
      { id: "old", datetime: "2026-11-15T09:00:00", car: "Audi" },
    ],
    warehouse: [{ id: "polish", name: "Полироль", qty: 1, minQty: 2 }],
    orders: [
      { id: "late", plannedCompletion: "2026-11-14T12:00:00", status: "В работе", number: "AD-01" },
      { id: "done", plannedCompletion: "2026-11-14T12:00:00", status: "Завершён" },
    ],
  };
  const result = buildSystemNotifications(db, new Date(2026, 10, 15, 11));

  assert.deepEqual(result.map((item) => item.kind).sort(), ["appointment", "low-stock", "overdue-order"]);
});

test("notification receipts mark unseen system alerts as read idempotently", () => {
  const notifications = [
    { id: "system:stock:a" },
    { id: "system:stock:b" },
  ];
  const once = systemNotificationReceipts(notifications, [], "2026-11-15T12:00:00Z");
  const twice = systemNotificationReceipts(notifications, once, "2026-11-15T12:05:00Z");

  assert.equal(once.length, 2);
  assert.deepEqual(twice, once);
  assert.equal(unreadSystemNotificationCount(notifications, twice), 0);
});

test("smart notification lifecycle keeps reads, resolves cleared rules and creates a new episode", () => {
  const now = new Date("2026-03-20T12:00:00Z");
  const database = { warehouse: [{ id: "polish", name: "Полироль", qty: 1, minQty: 2 }] };
  const [candidate] = buildSystemNotifications(database, now);
  const created = reconcileSmartNotifications([], [candidate], now);
  const active = created.find((item) => item.smart && item.status === "active");

  assert.ok(active);
  assert.equal(active.priority, "high");
  const read = updateNotificationUserState(active, "TUDOR", "readBy", "2026-03-20T12:01:00Z");
  const unchanged = reconcileSmartNotifications([read], [candidate], new Date("2026-03-20T12:02:00Z"));
  const stillActive = unchanged.find((item) => item.status === "active");
  assert.equal(stillActive.id, active.id);
  assert.equal(notificationState(stillActive, "TUDOR").read, true);
  assert.equal(notificationState(stillActive, "DAN").read, false);

  const resolved = reconcileSmartNotifications(unchanged, [], new Date("2026-03-20T13:00:00Z"));
  assert.equal(resolved.find((item) => item.id === active.id).status, "resolved");
  const nextEpisode = reconcileSmartNotifications(resolved, [candidate], new Date("2026-03-20T14:00:00Z"));
  const newActive = nextEpisode.find((item) => item.status === "active");
  assert.notEqual(newActive.id, active.id);
  assert.equal(notificationState(newActive, "TUDOR").read, false);
});

test("smart rules use reliable CRM fields for client, overlap, payment and trend insights", () => {
  const now = new Date("2026-03-20T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const dated = (offset) => new Date(now.getTime() + offset * day).toISOString();
  const db = {
    clients: [
      { id: "past-1", customerId: "regular", status: "Выполнено", datetime: dated(-100) },
      { id: "past-2", customerId: "regular", status: "Выполнено", datetime: dated(-75) },
      { id: "one", status: "В ожидании", datetime: dated(1), service: "Полировка" },
      { id: "two", status: "В ожидании", datetime: dated(1) , service: "Полировка" },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `recent-${index}`, status: "Выполнено", datetime: dated(-index - 1),
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `previous-${index}`, status: "Выполнено", datetime: dated(-31 - index),
      })),
    ],
    customers: [
      { id: "regular", createdAt: dated(-300) },
      { id: "new", createdAt: dated(-10) },
    ],
    services: [{ name: "Полировка", duration: 120 }],
    orders: [{
      id: "done-order",
      bookingId: "booking",
      status: "Завершён",
      number: "AD-2026-1",
      services: [{ price: 250 }],
    }],
    incomes: [
      ...Array.from({ length: 5 }, (_, index) => ({ id: `income-now-${index}`, amount: 100, date: dated(-index - 1) })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `income-before-${index}`, amount: 200, date: dated(-31 - index) })),
    ],
  };
  const result = buildSystemNotifications(db, now);
  const kinds = new Set(result.map((item) => item.kind));

  assert.ok(kinds.has("inactive-client"));
  assert.ok(kinds.has("appointment-overlap"));
  assert.ok(kinds.has("unpaid-order"));
  assert.ok(kinds.has("activity-trend"));
  assert.ok(kinds.has("income-trend"));
  assert.ok(kinds.has("new-client-no-appointment"));
  assert.equal(result.find((item) => item.kind === "inactive-client").facts.daysSinceVisit, 75);
});

test("notification state changes are scoped to one employee", () => {
  const [notification] = buildSystemNotifications({
    warehouse: [{ id: "item", name: "Средство", qty: 0, minQty: 2 }],
  }, new Date("2026-03-20T12:00:00Z"));
  const [record] = reconcileSmartNotifications([], [notification], new Date("2026-03-20T12:00:00Z"));
  const archived = updateNotificationUserState(record, "TUDOR", "archivedBy", "2026-03-20T12:00:00Z");

  assert.equal(notificationState(archived, "TUDOR").archived, true);
  assert.equal(notificationState(archived, "DAN").archived, false);
});
