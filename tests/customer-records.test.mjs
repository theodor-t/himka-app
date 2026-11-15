import test from "node:test";
import assert from "node:assert/strict";
import {
  customerSummary,
  visitsForCustomer,
  visitsForVehicle,
} from "../app/lib/customer-records.mjs";

const db = {
  clients: [
    { id: "visit-1", customerId: "customer-1", vehicleId: "vehicle-1", datetime: "2025-01-02T10:00:00", car: "Honda Civic" },
    { id: "visit-2", customerId: "customer-1", vehicleId: "vehicle-2", datetime: "2025-02-02T10:00:00", car: "BMW X5" },
    { id: "visit-3", phone: "069 123 456", car: "Old visit" },
    { id: "visit-4", customerId: "customer-2", vehicleId: "vehicle-3", car: "Other car" },
  ],
  incomes: [
    { id: "payment-1", clientId: "visit-1", amount: 100.1 },
    { id: "payment-2", clientId: "visit-1", amount: 50.2 },
    { id: "payment-3", clientId: "visit-2", amount: 100 },
    { id: "payment-4", clientId: "visit-4", amount: 900 },
  ],
};

test("customer history includes all linked visits and only their payments", () => {
  const summary = customerSummary(db, {
    id: "customer-1",
    phone: "+37369123456",
  });

  assert.deepEqual(summary.visits.map(({ id }) => id), ["visit-1", "visit-2", "visit-3"]);
  assert.deepEqual(summary.payments.map(({ id }) => id), ["payment-1", "payment-2", "payment-3"]);
  assert.equal(summary.visitCount, 3);
  assert.equal(summary.totalPaid, 250.3);
  assert.equal(summary.averagePaidPerVisit, 83.43);
  assert.equal(summary.lastVisit.id, "visit-2");
});

test("vehicle history stays scoped to the selected vehicle", () => {
  const visits = visitsForVehicle(db, {
    id: "vehicle-1",
    customerId: "customer-1",
    makeModel: "Honda Civic",
  });

  assert.deepEqual(visits.map(({ id }) => id), ["visit-1"]);
});

test("customer with no visit has an empty, zero-valued summary", () => {
  const summary = customerSummary(
    { clients: [], incomes: [] },
    { id: "customer-new" },
  );

  assert.deepEqual(summary.visits, []);
  assert.equal(summary.totalPaid, 0);
  assert.equal(summary.averagePaidPerVisit, 0);
  assert.equal(summary.lastVisit, null);
});
