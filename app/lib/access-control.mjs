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

export function readableDatabaseForRole(database, role) {
  if (role !== "technician") return database;
  return {
    ...database,
    ...Object.fromEntries(FINANCIAL_COLLECTIONS.map((collection) => [collection, []])),
    employeeProfiles: [],
    systemEvents: [],
  };
}

export function changedDatabaseCollections(current, incoming, collections = ALL_COLLECTIONS) {
  return collections.filter(
    (collection) =>
      JSON.stringify(current?.[collection] ?? []) !==
      JSON.stringify(incoming?.[collection] ?? []),
  );
}

export function databaseForRoleWrite(current, incoming, role, collections = ALL_COLLECTIONS) {
  const visibleCurrent = readableDatabaseForRole(current, role);
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
