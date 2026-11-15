import test from "node:test";
import assert from "node:assert/strict";
import {
  mappedAppointmentStatus,
  nextOrderNumber,
  orderBalance,
  orderTotal,
  paidForOrder,
  WORK_ORDER_STATUSES,
} from "../app/lib/work-orders.mjs";

test("order total applies fixed and percentage discounts without negative totals", () => {
  const services = [
    { name: "Полировка", price: 1000 },
    { name: "Покрытие", price: 500, quantity: 2 },
  ];

  assert.equal(orderTotal({ services, discount: { type: "fixed", value: 250 } }), 1750);
  assert.equal(orderTotal({ services, discount: { type: "percent", value: 10 } }), 1800);
  assert.equal(orderTotal({ services, discount: { type: "fixed", value: 9000 } }), 0);
});

test("payments count service allocations once and exclude debt-only receipts", () => {
  const order = { id: "order-1", bookingId: "visit-1", services: [{ price: 1000 }] };
  const incomes = [
    { id: "paid-1", clientId: "visit-1", amount: 300, serviceAmountCents: 20000, debtAllocations: [{ amountCents: 10000 }] },
    { id: "debt-1", clientId: "visit-1", amount: 75, debtId: "debt-record" },
    { id: "other-visit", clientId: "visit-2", amount: 800, serviceAmountCents: 80000 },
  ];

  assert.equal(paidForOrder(incomes, order), 20000);
  assert.equal(orderBalance(incomes, order), 800);
});

test("legacy payments without service allocation subtract debt allocations", () => {
  const order = { id: "order-1", bookingId: "visit-1", services: [{ price: 500 }] };
  const incomes = [
    { clientId: "visit-1", amount: 150, debtAllocations: [{ amount: 50 }] },
  ];

  assert.equal(paidForOrder(incomes, order), 10000);
  assert.equal(orderBalance(incomes, order), 400);
});

test("order numbers increment within the current year without changing other years", () => {
  const orders = [
    { number: "AD-2026-00003" },
    { number: "AD-2025-00099" },
    { number: "AD-2026-invalid" },
  ];

  assert.equal(nextOrderNumber(orders, 2026), "AD-2026-00004");
  assert.equal(nextOrderNumber(orders, 2027), "AD-2027-00001");
});

test("order status transitions keep appointment statuses compatible", () => {
  assert.equal(WORK_ORDER_STATUSES.length, 9);
  assert.equal(mappedAppointmentStatus("Отменён", "В работе"), "Отменен");
  assert.equal(mappedAppointmentStatus("Выдан клиенту", "В ожидании"), "Выполнено");
  assert.equal(mappedAppointmentStatus("В работе", "В ожидании"), "В ожидании");
});
