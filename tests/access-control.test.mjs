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
