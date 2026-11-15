"use client";

import { Bell, CalendarDays, CircleAlert, Package, Wrench } from "lucide-react";
import {
  buildSystemNotifications,
  systemNotificationReceipts,
  unreadSystemNotificationCount,
} from "../lib/notifications.mjs";

const ICONS = {
  appointment: CalendarDays,
  "low-stock": Package,
  "overdue-order": Wrench,
};

export default function NotificationCenter({ db, mutate, navigate }) {
  const notifications = buildSystemNotifications(db);
  const unreadCount = unreadSystemNotificationCount(notifications, db.notifications);

  const markRead = (notification) => {
    mutate(
      {
        notifications: systemNotificationReceipts(
          [notification],
          db.notifications,
          new Date().toISOString(),
        ),
      },
      `Прочитано системное уведомление: ${notification.title}`,
    );
  };

  const markAllRead = () => {
    if (!unreadCount) return;
    mutate(
      {
        notifications: systemNotificationReceipts(
          notifications,
          db.notifications,
          new Date().toISOString(),
        ),
      },
      `Прочитано системных уведомлений: ${unreadCount}`,
    );
  };

  return (
    <div className="notifications-page">
      <section className="customers-hero">
        <div>
          <span className="dashboard-kicker">OPERATIONS INBOX</span>
          <h2>Центр уведомлений</h2>
          <p>Ближайшие записи, критические остатки и заказы с истёкшим сроком.</p>
        </div>
        <div className="work-orders-count"><Bell size={17} /><strong>{unreadCount}</strong><span>не прочитано</span></div>
      </section>
      <div className="notification-toolbar">
        <span>{notifications.length ? `Всего событий: ${notifications.length}` : "Новых событий нет"}</span>
        <button type="button" className="btn-sm" onClick={markAllRead} disabled={!unreadCount}>Отметить всё прочитанным</button>
      </div>
      <section className="notification-list">
        {notifications.map((notification) => {
          const Icon = ICONS[notification.kind] || CircleAlert;
          const isRead = db.notifications.some(
            (receipt) => receipt.id === notification.id && receipt.readAt,
          );
          return (
            <article
              className={`card notification-card severity-${notification.severity} ${isRead ? "is-read" : ""}`}
              key={notification.id}
            >
              <span className="notification-icon"><Icon size={17} /></span>
              <div className="notification-copy">
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
              </div>
              <div className="notification-actions">
                {!isRead && <button type="button" className="btn-sm" onClick={() => markRead(notification)}>Прочитано</button>}
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => {
                    if (!isRead) markRead(notification);
                    navigate(notification.page);
                  }}
                >
                  Открыть
                </button>
              </div>
            </article>
          );
        })}
        {!notifications.length && (
          <section className="card customers-empty"><Bell size={25} /><h3>Всё спокойно</h3><p>Сейчас нет срочных операционных уведомлений.</p></section>
        )}
      </section>
    </div>
  );
}
