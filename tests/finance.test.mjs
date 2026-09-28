import test from "node:test";
import assert from "node:assert/strict";
import {
  amountToCents,
  applyPaymentToDebts,
  centsToAmount,
  formatMoney,
  getUnpaidClients,
  parseRecordDate,
  periodKeyFor,
  reversePaymentFromDebts,
  sumAmounts,
} from "../app/lib/finance.mjs";

test("money arithmetic rounds to cents and avoids floating point drift", () => {
  assert.equal(amountToCents(0.1 + 0.2), 30);
  assert.equal(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.equal(centsToAmount(129999), 1299.99);
});

test("invalid and non-finite amounts are treated as zero", () => {
  assert.equal(amountToCents("not money"), 0);
  assert.equal(amountToCents(Infinity), 0);
  assert.equal(sumAmounts([{ amount: -12.34 }]), -12.34);
});

test("formats whole and fractional MDL amounts consistently", () => {
  assert.equal(formatMoney(1200), "1 200 MDL");
  assert.equal(formatMoney(1200.5), "1 200,50 MDL");
});

test("parses legacy date strings and keeps month/year separate", () => {
  const date = parseRecordDate("04.03.2024 09:05");
  assert.equal(date?.getFullYear(), 2024);
  assert.equal(periodKeyFor({ date: "04.03.2024 09:05", month: "Март" }), "2024-03");
  assert.equal(periodKeyFor({ month: "Март", year: 2025 }), "2025-03");
});

test("fully paid clients disappear, while clients with an open debt remain selectable", () => {
  const db = {
    clients: [{ id: 1 }, { id: 2 }, { id: 3, status: "Отменен" }],
    incomes: [{ clientId: 1, amount: 100 }],
    debts: [{ clientId: 1, amount: 20, paid: false }],
  };
  assert.deepEqual(getUnpaidClients(db).map((client) => client.id), [1, 2]);
  db.debts[0].paid = true;
  assert.deepEqual(getUnpaidClients(db).map((client) => client.id), [2]);
});

test("payments reduce debts by exact cents and can be reversed", () => {
  const debts = [{ id: "d1", clientId: 7, amount: 30.1, paid: false }];
  const payment = applyPaymentToDebts(debts, "7", amountToCents(10.1));
  assert.equal(payment.debts[0].amount, 20);
  assert.equal(payment.debts[0].paid, false);
  assert.deepEqual(payment.allocations, [{ debtId: "d1", amountCents: 1010 }]);
  assert.equal(reversePaymentFromDebts(payment.debts, payment.allocations)[0].amount, 30.1);

  const finalPayment = applyPaymentToDebts(payment.debts, 7, amountToCents(20));
  assert.equal(finalPayment.debts[0].amount, 0);
  assert.equal(finalPayment.debts[0].paid, true);
});