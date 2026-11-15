import test from "node:test";
import assert from "node:assert/strict";
import {
  databaseForRoleWrite,
  readableDatabaseForRole,
  roleCanViewPage,
  roleCanWriteCollection,
} from "../app/lib/access-control.mjs";

test("technician sees no financial or employee administration records", () => {
  const database = {
    clients: [{ id: "c1" }],
    incomes: [{ id: "income-1", amount: 100 }],
    expenses: [{ id: "expense-1", amount: 20 }],
    employeeProfiles: [{ id: "e1" }],
  };
  const visible = readableDatabaseForRole(database, "technician");

  assert.deepEqual(visible.incomes, []);
  assert.deepEqual(visible.expenses, []);
  assert.deepEqual(visible.employeeProfiles, []);
  assert.equal(database.incomes.length, 1);
});

test("technician can update shop operations without overwriting hidden finance data", () => {
  const current = {
    clients: [{ id: "c1" }],
    orders: [],
    incomes: [{ id: "income-1", amount: 100 }],
    expenses: [{ id: "expense-1", amount: 20 }],
  };
  const incoming = {
    ...readableDatabaseForRole(current, "technician"),
    clients: [{ id: "c1" }, { id: "c2" }],
    orders: [{ id: "o1" }],
    logs: [{ id: "log-1" }],
  };
  const result = databaseForRoleWrite(current, incoming, "technician");

  assert.deepEqual(result.forbidden, []);
  assert.equal(result.database.clients.length, 2);
  assert.equal(result.database.orders.length, 1);
  assert.deepEqual(result.database.incomes, current.incomes);
  assert.deepEqual(result.database.expenses, current.expenses);
});

test("non-admin roles cannot edit protected collections or financial records", () => {
  assert.equal(roleCanViewPage("technician", "profit"), false);
  assert.equal(roleCanViewPage("technician", "orders"), true);
  assert.equal(roleCanViewPage("manager", "profit"), true);
  assert.equal(roleCanWriteCollection("manager", "financialGoals"), true);
  assert.equal(roleCanWriteCollection("manager", "employeeProfiles"), false);
  assert.equal(roleCanWriteCollection("technician", "incomes"), false);
  assert.equal(roleCanWriteCollection("readonly", "clients"), false);

  const result = databaseForRoleWrite(
    { incomes: [{ id: "income-1" }], clients: [] },
    { incomes: [{ id: "forged-income" }], clients: [{ id: "c1" }] },
    "technician",
  );
  assert.equal(result.database, null);
  assert.deepEqual(result.forbidden, ["incomes"]);
});

test("notification writes only change the signed-in employee state and preferences", () => {
  const stored = {
    notifications: [{
      id: "smart:stock:1",
      smart: true,
      title: "Original",
      status: "active",
      readBy: { DAN: "old-read" },
      archivedBy: {},
      dismissedBy: {},
    }],
    notificationPreferences: [
      { id: "prefs:DAN", username: "DAN", dailyDigest: false },
      { id: "prefs:TUDOR", username: "TUDOR", dailyDigest: false },
    ],
  };
  const staleIncoming = {
    ...stored,
    notifications: [
      {
        ...stored.notifications[0],
        title: "Forged title",
        readBy: { DAN: "forged-read", TUDOR: "new-read" },
      },
    ],
    notificationPreferences: [
      { id: "prefs:DAN", username: "DAN", dailyDigest: true },
      { id: "prefs:TUDOR", username: "TUDOR", dailyDigest: true },
    ],
  };
  const result = databaseForRoleWrite(stored, staleIncoming, "admin", undefined, "TUDOR");

  assert.equal(result.database.notifications[0].title, "Original");
  assert.equal(result.database.notifications[0].readBy.DAN, "old-read");
  assert.equal(result.database.notifications[0].readBy.TUDOR, "new-read");
  assert.equal(result.database.notificationPreferences.find((item) => item.username === "DAN").dailyDigest, false);
  assert.equal(result.database.notificationPreferences.find((item) => item.username === "TUDOR").dailyDigest, true);
});

test("stale employee snapshots cannot remove scheduled smart notifications", () => {
  const stored = {
    notifications: [{ id: "smart:current", smart: true, status: "active" }],
    notificationPreferences: [],
  };
  const result = databaseForRoleWrite(stored, { notifications: [], notificationPreferences: [] }, "admin", undefined, "TUDOR");

  assert.deepEqual(result.database.notifications, stored.notifications);
});

test("technicians cannot read financial notifications or another employee's preferences", () => {
  const visible = readableDatabaseForRole({
    notifications: [
      { id: "finance-1", smart: true, category: "finance" },
      { id: "stock-1", smart: true, category: "inventory" },
    ],
    notificationPreferences: [
      { id: "prefs:DAN", username: "DAN" },
      { id: "prefs:TUDOR", username: "TUDOR" },
    ],
  }, "technician", "DAN");

  assert.deepEqual(visible.notifications.map((item) => item.id), ["stock-1"]);
  assert.deepEqual(visible.notificationPreferences.map((item) => item.username), ["DAN"]);
});
