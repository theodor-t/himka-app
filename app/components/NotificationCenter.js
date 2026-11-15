"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  Package,
  RefreshCw,
  Settings2,
  Sparkles,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import {
  notificationState,
  updateNotificationPreferences,
  updateNotificationUserState,
} from "../lib/notifications.mjs";
import { parseRecordDate } from "../lib/finance.mjs";

const CATEGORIES = [
  ["all", "Все"],
  ["clients", "Клиенты"],
  ["appointments", "Записи"],
  ["orders", "Заказы"],
  ["finance", "Финансы"],
  ["inventory", "Склад"],
  ["employees", "Сотрудники"],
  ["ai-insights", "AI-инсайты"],
  ["system", "Система"],
];
const PRIORITIES = [
  ["critical", "Критический"],
  ["high", "Высокий"],
  ["medium", "Средний"],
  ["low", "Низкий"],
];
const PRIORITY_LABELS = Object.fromEntries(PRIORITIES);
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);
const CATEGORY_ICONS = {
  clients: Users,
  appointments: CalendarDays,
  orders: Wrench,
  finance: Wallet,
  inventory: Package,
  "ai-insights": Sparkles,
  system: CircleAlert,
};
const CATEGORIES_FOR_TECHNICIAN = CATEGORIES.filter(([id]) => !["finance", "employees"].includes(id));

function formatDetectedAt(value) {
  if (!value) return "Дата не указана";
  const date = parseRecordDate(value);
  return !date
    ? "Дата не указана"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function isActive(notification) {
  return notification.smart === true && notification.status === "active";
}

export default function NotificationCenter({
  db,
  mutate,
  navigate,
  openModal,
  openOrder,
  reload,
  user,
  role,
}) {
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [view, setView] = useState("active");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refreshOnOpen = useRef(false);
  const categories = role === "technician" ? CATEGORIES_FOR_TECHNICIAN : CATEGORIES;
  const preferences = useMemo(
    () => {
      const stored = db.notificationPreferences.find((item) => item.username === user) || {};
      return {
        ...stored,
        categories: Array.isArray(stored.categories)
          ? stored.categories
          : categories.slice(1).map(([id]) => id),
        priorities: Array.isArray(stored.priorities)
          ? stored.priorities
          : PRIORITIES.map(([id]) => id),
        inApp: stored.inApp !== false,
        dailyDigest: Boolean(stored.dailyDigest),
        quietHours: {
          enabled: Boolean(stored.quietHours?.enabled),
          start: stored.quietHours?.start || "22:00",
          end: stored.quietHours?.end || "08:00",
        },
      };
    },
    [db.notificationPreferences, user, categories],
  );
  const allNotifications = db.notifications.filter((item) => item.smart === true);
  const activeNotifications = allNotifications.filter(isActive);
  const visibleNotifications = allNotifications.filter((item) => {
    const state = notificationState(item, user);
    if (view === "archived") return state.archived;
    if (view === "dismissed") return state.dismissed;
    if (view === "resolved") return item.status === "resolved";
    return item.status === "active" && !state.archived && !state.dismissed;
  }).filter((item) =>
    (category === "all" || item.category === category) &&
    (priority === "all" || item.priority === priority),
  ).filter((item) =>
    view !== "active" ||
    (preferences.categories || []).includes(item.category) &&
    (preferences.priorities || []).includes(item.priority),
  ).sort((first, second) =>
    new Date(second.updatedAt || second.createdAt || 0) -
    new Date(first.updatedAt || first.createdAt || 0),
  );

  const refreshNotifications = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/notifications/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось обновить уведомления");
      if (result.storageWarning || result.aiWarning) {
        setError([result.storageWarning, result.aiWarning].filter(Boolean).join(" "));
      }
      await reload();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Ошибка обновления уведомлений");
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  useEffect(() => {
    if (refreshOnOpen.current || role === "readonly") return;
    refreshOnOpen.current = true;
    void refreshNotifications();
  }, [refreshNotifications, role]);

  const changeUserState = (notification, field, value, actionText) => {
    const notifications = db.notifications.map((item) =>
      item.id === notification.id
        ? updateNotificationUserState(item, user, field, value)
        : item,
    );
    mutate({ notifications }, `${actionText}: ${notification.title}`);
  };

  const markRead = (notification) =>
    changeUserState(notification, "readBy", new Date().toISOString(), "Прочитано уведомление");

  const markAllRead = () => {
    const timestamp = new Date().toISOString();
    const visibleIds = new Set(visibleNotifications.map((item) => item.id));
    mutate({
      notifications: db.notifications.map((item) =>
        visibleIds.has(item.id)
          ? updateNotificationUserState(item, user, "readBy", timestamp)
          : item,
      ),
    }, "Отмечены прочитанными все видимые уведомления");
  };

  const savePreferences = (changes) => {
    mutate({
      notificationPreferences: updateNotificationPreferences(
        db.notificationPreferences,
        user,
        changes,
      ),
    }, "Изменены настройки уведомлений");
  };

  const togglePreference = (key, value) => {
    const current = Array.isArray(preferences[key]) ? preferences[key] : [];
    savePreferences({
      [key]: current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    });
  };

  const openRelated = (notification) => {
    if (notificationState(notification, user).read === false) markRead(notification);
    const related = notification.related;
    if (related?.type === "customer") {
      const customer = db.customers.find((item) => String(item.id) === String(related.id));
      if (customer) openModal({ type: "customer-profile", item: customer });
      else navigate("customers");
      return;
    }
    if (related?.type === "appointment") {
      const appointment = db.clients.find((item) => String(item.id) === String(related.id));
      if (appointment) openModal({ type: "client-profile", item: appointment });
      else navigate("calendar");
      return;
    }
    if (related?.type === "inventory") {
      navigate("warehouse");
      return;
    }
    if (related?.type === "order") {
      openOrder(related.id);
      return;
    }
    navigate(notification.page || "home");
  };

  const todayKey = new Date().toDateString();
  const todayAppointments = db.clients.filter((item) => {
    const date = parseRecordDate(item.datetime);
    return date &&
      date.toDateString() === todayKey &&
      !["Отменен", "Не пришел", "Выполнено"].includes(item.status);
  });
  const digestItems = [
    { category: "appointments", label: "Записей сегодня", count: todayAppointments.length, page: "calendar" },
    { category: "clients", label: "Клиентам нужен follow-up", count: activeNotifications.filter((item) => item.category === "clients").length, page: "customers" },
    { category: "orders", label: "Заказов требуют внимания", count: activeNotifications.filter((item) => item.category === "orders").length, page: "orders" },
    { category: "inventory", label: "Позиции на минимуме", count: activeNotifications.filter((item) => item.category === "inventory").length, page: "warehouse" },
    { category: "finance", label: "Финансовых проверок", count: activeNotifications.filter((item) => item.category === "finance").length, page: "orders" },
  ];

  return (
    <div className="notifications-page">
      <section className="notification-hero">
        <div className="notification-hero-copy">
          <span className="dashboard-kicker">SMART OPERATIONS</span>
          <h2>Центр уведомлений</h2>
          <p>Проверенные сигналы из записей, заказов, клиентов и склада — без автоматических изменений в CRM.</p>
        </div>
        <div className="notification-hero-actions">
          <div className="notification-unread-summary" aria-live="polite">
            <Bell size={17} />
            <strong>{activeNotifications.filter((item) =>
              preferences.inApp !== false &&
              preferences.categories.includes(item.category) &&
              preferences.priorities.includes(item.priority) &&
              !notificationState(item, user).read &&
              !notificationState(item, user).archived &&
              !notificationState(item, user).dismissed &&
              preferences.inApp !== false,
            ).length}</strong>
            <span>непрочитано</span>
          </div>
          {role !== "readonly" && (
            <button type="button" className="btn-sm notification-refresh" onClick={refreshNotifications} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "notification-spin" : ""} />
              {refreshing ? "Проверяем…" : "Обновить"}
            </button>
          )}
        </div>
      </section>

      {!!error && <p className="notification-feedback" role="status">{error}</p>}

      {preferences.dailyDigest && (
        <section className="notification-digest card">
          <header><Sparkles size={16} /><div><strong>Сводка на сегодня</strong><span>Числа рассчитаны по текущим данным CRM</span></div></header>
          <div className="notification-digest-items">
            {digestItems.map((item) => (
              <button type="button" key={item.category} onClick={() => { setCategory(item.category); setView("active"); }}>
                <strong>{item.count}</strong><span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="notification-controls card">
        <div className="notification-controls-top">
          <div className="notification-views" role="tablist" aria-label="Состояние уведомлений">
            {[
              ["active", "Активные"],
              ["archived", "Архив"],
              ["dismissed", "Отклонённые"],
              ["resolved", "Решённые"],
            ].map(([id, label]) => (
              <button type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="notification-control-actions">
            <label>
              <span>Приоритет</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="all">Все уровни</option>
                {PRIORITIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="btn-sm" onClick={markAllRead} disabled={!visibleNotifications.some((item) => !notificationState(item, user).read)}>
              <Check size={14} /> Прочитать все
            </button>
            <button type="button" className={`btn-sm notification-settings-toggle${settingsOpen ? " active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
              <Settings2 size={14} /> Настройки
            </button>
          </div>
        </div>

        <div className="notification-category-filter" aria-label="Категории уведомлений">
          {categories.map(([id, label]) => (
            <button type="button" key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>
              {label}
            </button>
          ))}
        </div>

        {settingsOpen && (
          <div className="notification-preferences">
            <div className="notification-preferences-heading">
              <div><strong>Предпочтения</strong><p>Настройки сохраняются отдельно для аккаунта {user}.</p></div>
            </div>
            <label className="notification-preference-switch">
              <input type="checkbox" checked={preferences.inApp !== false} onChange={(event) => savePreferences({ inApp: event.target.checked })} />
              <span><strong>Уведомления в CRM</strong><small>Показывать сигналы и счётчик у колокольчика</small></span>
            </label>
            <label className="notification-preference-switch">
              <input type="checkbox" checked={Boolean(preferences.dailyDigest)} onChange={(event) => savePreferences({ dailyDigest: event.target.checked })} />
              <span><strong>Ежедневная сводка</strong><small>Показывать фактическую сводку в центре уведомлений</small></span>
            </label>
            <div className="notification-preference-groups">
              <fieldset>
                <legend>Категории</legend>
                {categories.slice(1).map(([id, label]) => (
                  <label key={id}><input type="checkbox" checked={preferences.categories.includes(id)} onChange={() => togglePreference("categories", id)} />{label}</label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Приоритеты</legend>
                {PRIORITIES.map(([id, label]) => (
                  <label key={id}><input type="checkbox" checked={preferences.priorities.includes(id)} onChange={() => togglePreference("priorities", id)} />{label}</label>
                ))}
              </fieldset>
            </div>
            <div className="notification-quiet-hours">
              <Clock3 size={15} />
              <span>Push-уведомления пока не подключены. Тихие часы можно сохранить для будущего канала доставки.</span>
              <label><input type="checkbox" checked={Boolean(preferences.quietHours?.enabled)} onChange={(event) => savePreferences({ quietHours: { ...preferences.quietHours, enabled: event.target.checked } })} /> Тихие часы</label>
              <input type="time" aria-label="Начало тихих часов" value={preferences.quietHours?.start || "22:00"} onChange={(event) => savePreferences({ quietHours: { ...preferences.quietHours, start: event.target.value } })} />
              <input type="time" aria-label="Окончание тихих часов" value={preferences.quietHours?.end || "08:00"} onChange={(event) => savePreferences({ quietHours: { ...preferences.quietHours, end: event.target.value } })} />
            </div>
          </div>
        )}
      </section>

      <div className="notification-list-heading">
        <span>{visibleNotifications.length ? `${visibleNotifications.length} уведомлений` : "Уведомлений нет"}</span>
        <span>Сортировка: сначала новые</span>
      </div>
      <section className="notification-list">
        {visibleNotifications.map((notification) => {
          const Icon = CATEGORY_ICONS[notification.category] || CircleAlert;
          const state = notificationState(notification, user);
          const explanation = notification.aiExplanation || notification.explanation || notification.message;
          const recommendation = notification.aiRecommendation || notification.recommendation;
          return (
            <article
              className={`card notification-card priority-${notification.priority || "low"}${state.read ? " is-read" : ""}`}
              key={notification.id}
            >
              <span className="notification-icon"><Icon size={18} /></span>
              <div className="notification-copy">
                <div className="notification-card-heading">
                  <strong>{notification.title}</strong>
                  <span className={`notification-priority priority-${notification.priority || "low"}`}>{PRIORITY_LABELS[notification.priority] || "Низкий"}</span>
                  {notification.aiGenerated && <span className="notification-ai-badge"><Sparkles size={11} /> AI</span>}
                  <span className={`notification-read-indicator${state.read ? " is-read" : ""}`}>{state.read ? "Прочитано" : "Новое"}</span>
                </div>
                <p className="notification-message">{notification.message}</p>
                <p className="notification-explanation">{explanation}</p>
                {!!recommendation && <p className="notification-recommendation"><span>Что можно сделать</span>{recommendation}</p>}
                <div className="notification-card-meta">
                  <span>{CATEGORY_LABELS[notification.category] || "Система"}</span>
                  <span><Clock3 size={12} />{formatDetectedAt(notification.detectedAt || notification.createdAt)}</span>
                </div>
              </div>
              <div className="notification-actions">
                {!state.read && <button type="button" className="btn-sm" onClick={() => markRead(notification)}><Check size={13} /> Прочитано</button>}
                <button type="button" className="btn-sm notification-open-action" onClick={() => openRelated(notification)}>Открыть запись</button>
                {view === "archived"
                  ? <button type="button" className="btn-sm" onClick={() => changeUserState(notification, "archivedBy", null, "Возвращено из архива уведомление")}>Вернуть</button>
                  : <button type="button" className="btn-sm notification-icon-action" title="В архив" aria-label="В архив" onClick={() => changeUserState(notification, "archivedBy", new Date().toISOString(), "В архив отправлено уведомление")}><Archive size={14} /></button>}
                {view === "dismissed"
                  ? <button type="button" className="btn-sm" onClick={() => changeUserState(notification, "dismissedBy", null, "Восстановлено уведомление")}>Восстановить</button>
                  : <button type="button" className="btn-sm notification-icon-action" title="Отклонить" aria-label="Отклонить уведомление" onClick={() => changeUserState(notification, "dismissedBy", new Date().toISOString(), "Отклонено уведомление")}><X size={14} /></button>}
              </div>
            </article>
          );
        })}
        {!visibleNotifications.length && (
          <section className="card notification-empty">
            <Bell size={24} />
            <h3>{view === "active" ? "Всё спокойно" : "Здесь пока пусто"}</h3>
            <p>{view === "active" ? "Новых ситуаций, требующих внимания, не найдено." : "Для выбранного фильтра нет уведомлений."}</p>
          </section>
        )}
      </section>
    </div>
  );
}
