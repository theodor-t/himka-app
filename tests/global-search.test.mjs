import test from "node:test";
import assert from "node:assert/strict";
import { searchRecords } from "../app/lib/global-search.mjs";

const db = {
  customers: [{ id: "c1", name: "Иван", phone: "+37360000000" }],
  vehicles: [{ id: "v1", customerId: "c1", makeModel: "BMW X5", plate: "ABC123" }],
  clients: [{ id: "b1", car: "BMW X5", phone: "+37360000000", service: "Полировка" }],
  orders: [{ id: "o1", number: "AD-2026-00001", car: "BMW X5", status: "В работе" }],
  suppliers: [{ id: "s1", name: "АвтоХим", phone: "+37361111111" }],
};

test("global search finds customer, vehicle, visit, work order and supplier records", () => {
  const results = searchRecords(db, "BMW X5");
  assert.deepEqual(results.map((result) => result.type), ["vehicle", "booking", "order"]);
  assert.deepEqual(searchRecords(db, "Иван").map((result) => result.type), ["customer"]);
  assert.deepEqual(searchRecords(db, "АвтоХим").map((result) => result.type), ["supplier"]);
});

test("global search is case-insensitive, bounded and returns no results for blank input", () => {
  assert.deepEqual(searchRecords(db, "   "), []);
  assert.equal(searchRecords(db, "BMW", 2).length, 2);
  assert.equal(searchRecords(db, "bmw").length, 3);
});
