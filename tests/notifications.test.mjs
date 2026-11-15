import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemNotifications,
  systemNotificationReceipts,
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
