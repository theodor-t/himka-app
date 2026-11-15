import { DATABASE_COLLECTIONS } from "./database.mjs";

export const ROLE_LABELS = {
  admin: "Администратор",
  manager: "Менеджер",
  technician: "Мастер",
  readonly: "Только просмотр",
};

const ALL_COLLECTIONS = DATABASE_COLLECTIONS;
const FINANCIAL_COLLECTIONS = [
  "expenses", "incomes", "withdrawals", "debts", "financialGoals",
  "supplierPayments",
];
const MANAGEMENT_COLLECTIONS = ["employeeProfiles", "systemEvents"];
const TECHNICIAN_WRITE_COLLECTIONS = [
  "clients", "customers", "vehicles", "warehouse", "windows", "logs",
  "stockMovements", "services", "orders", "inspections", "waitlistEntries",
  "notifications", "workPosts",
  "notificationPreferences",
];

export function roleCanWriteCollection(role, collection) {
  if (role === "admin") return ALL_COLLECTIONS.includes(collection);
  if (role === "manager") {
    return ALL_COLLECTIONS.includes(collection) &&
      !MANAGEMENT_COLLECTIONS.includes(collection);
  }
  if (role === "technician") {
    return TECHNICIAN_WRITE_COLLECTIONS.includes(collection);
  }
  return false;
}

export function roleCanViewPage(role, page) {
  if (role !== "technician") return true;
  return [
    "home", "calendar", "orders", "workPosts", "waitlist",
    "customers", "clients", "services", "warehouse", "windows",
    "notifications", "systemStatus", "weather",
  ].includes(page);
}

export function readableDatabaseForRole(database, role, username) {
  const scoped = username
    ? {
        ...database,
        notificationPreferences: (database.notificationPreferences || [])
          .filter((item) => item.username === username),
      }
    : database;
  if (role !== "technician") return scoped;
  return {
    ...scoped,
    ...Object.fromEntries(FINANCIAL_COLLECTIONS.map((collection) => [collection, []])),
    employeeProfiles: [],
    systemEvents: [],
    advisorRecommendations: [],
    notifications: (scoped.notifications || []).filter(
      (item) => item.category !== "finance",
    ),
  };
}

export function changedDatabaseCollections(current, incoming, collections = ALL_COLLECTIONS) {
  return collections.filter(
    (collection) =>
      JSON.stringify(current?.[collection] ?? []) !==
      JSON.stringify(incoming?.[collection] ?? []),
  );
}

export function mergeNotificationUserChanges(current, incoming, username) {
  if (!username) return incoming;
  const currentNotifications = Array.isArray(current?.notifications) ? current.notifications : [];
  const incomingNotifications = Array.isArray(incoming?.notifications) ? incoming.notifications : [];
  const incomingById = new Map(incomingNotifications.map((item) => [String(item.id), item]));
  const notifications = currentNotifications.map((stored) => {
    if (stored?.smart !== true) return stored;
    const changed = incomingById.get(String(stored.id));
    if (!changed) return stored;
    const mergeOwnState = (field) => {
      const state = { ...(stored[field] || {}) };
      if (username && changed[field] && typeof changed[field] === "object") {
        if (Object.hasOwn(changed[field], username)) state[username] = changed[field][username];
        else delete state[username];
      }
      return state;
    };
    return {
      ...stored,
      readBy: mergeOwnState("readBy"),
      archivedBy: mergeOwnState("archivedBy"),
      dismissedBy: mergeOwnState("dismissedBy"),
    };
  });

  const currentPreferences = Array.isArray(current?.notificationPreferences)
    ? current.notificationPreferences
    : [];
  const incomingPreferences = Array.isArray(incoming?.notificationPreferences)
    ? incoming.notificationPreferences
    : [];
  const ownPreference = incomingPreferences.find((item) => item.username === username);
  const notificationPreferences = [
    ...currentPreferences.filter((item) => item.username !== username),
    ...(ownPreference ? [ownPreference] : []),
  ];
  return {
    ...incoming,
    notifications,
    notificationPreferences,
  };
}

export function databaseForRoleWrite(current, incoming, role, collections = ALL_COLLECTIONS, username) {
  incoming = mergeNotificationUserChanges(current, incoming, username);
  const visibleCurrent = readableDatabaseForRole(current, role, username);
  const changed = changedDatabaseCollections(visibleCurrent, incoming, collections);
  const forbidden = changed.filter(
    (collection) => !roleCanWriteCollection(role, collection),
  );
  if (forbidden.length) return { database: null, forbidden };

  const merged = role === "admin" ? { ...current, ...incoming } : { ...current };
  collections.forEach((collection) => {
    if (roleCanWriteCollection(role, collection)) {
      merged[collection] = incoming[collection] ?? current[collection] ?? [];
    }
  });
  return { database: merged, forbidden: [] };
}
