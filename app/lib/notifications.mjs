import { parseRecordDate } from "./finance.mjs";

const CLOSED_APPOINTMENT_STATUSES = new Set(["Отменен", "Не пришел", "Выполнено"]);
const CLOSED_ORDER_STATUSES = new Set(["Завершён", "Выдан клиенту", "Отменён"]);

function formattedDate(value) {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "дата не указана";
}

export function buildSystemNotifications(db, now = new Date()) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const nextDay = currentTime + 24 * 60 * 60 * 1000;
  const notifications = [];

  db.clients.forEach((booking) => {
    const time = parseRecordDate(booking.datetime)?.getTime();
    if (
      Number.isFinite(time) &&
      time >= currentTime &&
      time <= nextDay &&
      !CLOSED_APPOINTMENT_STATUSES.has(booking.status)
    ) {
      notifications.push({
        id: `system:appointment:${booking.id}`,
        kind: "appointment",
        severity: "info",
        title: "Скоро запись клиента",
        message: `${booking.car || "Автомобиль"} · ${formattedDate(booking.datetime)}${booking.service ? ` · ${booking.service}` : ""}`,
        page: "calendar",
        createdAt: booking.datetime,
      });
    }
  });

  db.warehouse.forEach((item) => {
    const quantity = Number(item.qty || 0);
    if (quantity <= Number(item.minQty ?? 2)) {
      notifications.push({
        id: `system:low-stock:${item.id}`,
        kind: "low-stock",
        severity: quantity <= 0 ? "danger" : "warning",
        title: quantity <= 0 ? "Товар закончился" : "Низкий остаток на складе",
        message: `${item.name}: ${quantity} шт. (минимум ${Number(item.minQty ?? 2)} шт.)`,
        page: "warehouse",
        createdAt: "",
      });
    }
  });

  db.orders.forEach((order) => {
    const completionTime = parseRecordDate(order.plannedCompletion)?.getTime();
    if (
      Number.isFinite(completionTime) &&
      completionTime < currentTime &&
      !CLOSED_ORDER_STATUSES.has(order.status)
    ) {
      notifications.push({
        id: `system:overdue-order:${order.id}`,
        kind: "overdue-order",
        severity: "danger",
        title: "Просрочен срок заказа",
        message: `${order.number || "Заказ"} · ${order.car || "Автомобиль"} · срок ${formattedDate(order.plannedCompletion)}`,
        page: "orders",
        createdAt: order.plannedCompletion,
      });
    }
  });

  return notifications.sort((first, second) => {
    const severity = { danger: 0, warning: 1, info: 2 };
    return severity[first.severity] - severity[second.severity] ||
      (parseRecordDate(first.createdAt)?.getTime() || 0) -
        (parseRecordDate(second.createdAt)?.getTime() || 0);
  });
}

export function unreadSystemNotificationCount(notifications, receipts) {
  const readIds = new Set(
    receipts.filter((receipt) => receipt.readAt).map((receipt) => receipt.id),
  );
  return notifications.filter((notification) => !readIds.has(notification.id)).length;
}

export function systemNotificationReceipts(notifications, existingReceipts, readAt) {
  const byId = new Map(existingReceipts.map((receipt) => [receipt.id, receipt]));
  notifications.forEach((notification) => {
    const current = byId.get(notification.id);
    if (!current?.readAt) {
      byId.set(notification.id, {
        id: notification.id,
        kind: "system",
        readAt,
      });
    }
  });
  return [...byId.values()];
}
