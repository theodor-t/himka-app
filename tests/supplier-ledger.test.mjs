import test from "node:test";
import assert from "node:assert/strict";
import {
  openSupplierPurchases,
  supplierBalanceCents,
  supplierPurchaseBalanceCents,
} from "../app/lib/supplier-ledger.mjs";

const purchases = [
  { id: "p1", type: "purchase", supplierId: "s1", amount: 100.25, paidAmount: 20 },
  { id: "p2", type: "purchase", supplierId: "s1", amount: 50, paidAmount: 50 },
  { id: "p3", type: "purchase", supplierId: "s2", amount: 10, paidAmount: 0 },
];
const payments = [
  ...purchases,
  { id: "payment-1", type: "payment", supplierId: "s1", purchaseId: "p1", amount: 30.1 },
  { id: "payment-2", type: "payment", supplierId: "s1", purchaseId: "p1", amount: 50.15 },
];

test("supplier debt uses exact cents and includes only payment allocations for the purchase", () => {
  assert.equal(supplierPurchaseBalanceCents(purchases[0], payments), 0);
  assert.equal(supplierPurchaseBalanceCents(purchases[2], payments), 1000);
});

test("supplier balance sums outstanding purchase balances", () => {
  assert.equal(supplierBalanceCents("s1", payments), 0);
  assert.equal(supplierBalanceCents("s2", payments), 1000);
});

test("open supplier purchases excludes fully paid purchases", () => {
  assert.deepEqual(openSupplierPurchases(payments).map((purchase) => purchase.id), ["p3"]);
});
