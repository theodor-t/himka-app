import test from "node:test";
import assert from "node:assert/strict";
import {
  DATABASE_COLLECTIONS,
  DB_SCHEMA_VERSION,
  EMPTY_DB,
  normalizeDatabase,
} from "../app/lib/database.mjs";

test("legacy database snapshots gain empty collections without losing existing records", () => {
  const legacy = {
    clients: [{ id: "visit-1", car: "Honda Civic" }],
    incomes: [{ id: "payment-1", clientId: "visit-1", amount: 500 }],
  };

  const normalized = normalizeDatabase(legacy);

  assert.equal(normalized.schemaVersion, DB_SCHEMA_VERSION);
  assert.equal(normalized.clients[0].id, legacy.clients[0].id);
  assert.equal(normalized.clients[0].car, legacy.clients[0].car);
  assert.equal(normalized.clients[0].customerId, "legacy-customer-visit-1");
  assert.deepEqual(normalized.incomes, legacy.incomes);
  for (const collection of DATABASE_COLLECTIONS) {
    assert.ok(Array.isArray(normalized[collection]), `${collection} should be initialized`);
  }
});

test("database normalization preserves unknown future fields and newer schema versions", () => {
  const normalized = normalizeDatabase({
    schemaVersion: DB_SCHEMA_VERSION + 1,
    futureCollection: [{ id: "future-1" }],
  });

  assert.equal(normalized.schemaVersion, DB_SCHEMA_VERSION + 1);
  assert.deepEqual(normalized.futureCollection, [{ id: "future-1" }]);
});

test("legacy visits link to customers by normalized phone and vehicles by name", () => {
  const legacy = {
    clients: [
      { id: "visit-1", car: "Honda Civic", phone: "+373 69 123 456" },
      { id: "visit-2", car: "BMW X5", phone: "+373 (69) 123-456" },
      { id: "visit-3", car: " Honda   Civic ", phone: "069 123 456" },
      { id: "visit-4", car: "Audi A4", phone: "" },
      { id: "visit-5", car: "Audi A4", phone: "" },
    ],
    incomes: [{ id: "payment-1", clientId: "visit-1", amount: 500 }],
    debts: [{ id: "debt-1", clientId: "visit-1", amount: 100 }],
  };

  const migrated = normalizeDatabase(legacy);
  const [first, second, third, fourth, fifth] = migrated.clients;

  assert.equal(first.customerId, second.customerId);
  assert.equal(first.customerId, third.customerId);
  assert.equal(first.vehicleId, third.vehicleId);
  assert.notEqual(first.vehicleId, second.vehicleId);
  assert.notEqual(fourth.customerId, fifth.customerId);
  assert.deepEqual(migrated.incomes, legacy.incomes);
  assert.deepEqual(migrated.debts, legacy.debts);
  assert.equal(migrated.vehicles.length, 4);
});

test("legacy visit migration is deterministic and does not duplicate entities", () => {
  const legacy = {
    clients: [{ id: "visit-1", car: "Honda Civic", phone: "069 123 456" }],
  };
  const first = normalizeDatabase(legacy);
  const second = normalizeDatabase(legacy);

  assert.deepEqual(first.customers, second.customers);
  assert.deepEqual(first.vehicles, second.vehicles);
  assert.deepEqual(first.clients, second.clients);
});

test("legacy visits without vehicle names are not merged into one vehicle", () => {
  const migrated = normalizeDatabase({
    clients: [
      { id: "visit-1", phone: "+373 69 123 456" },
      { id: "visit-2", phone: "+373 69 123 456" },
    ],
  });

  assert.equal(migrated.vehicles.length, 2);
  assert.notEqual(migrated.clients[0].vehicleId, migrated.clients[1].vehicleId);
});

test("database normalization rejects invalid collection shapes", () => {
  assert.throws(
    () => normalizeDatabase({ customers: { id: "not-an-array" } }),
    /Invalid database collection: customers/,
  );
  assert.throws(() => normalizeDatabase([]), /Invalid database payload/);
});

test("database normalization fills missing required collections without breaking partial snapshots", () => {
  const normalized = normalizeDatabase({
    schemaVersion: DB_SCHEMA_VERSION,
    customers: [{ id: "c-1" }],
  });

  assert.ok(Array.isArray(normalized.clients));
  assert.deepEqual(normalized.customers, [{ id: "c-1" }]);
  assert.equal(normalized.schemaVersion, DB_SCHEMA_VERSION);
});

test("empty database includes every supported collection", () => {
  for (const collection of DATABASE_COLLECTIONS) {
    assert.deepEqual(EMPTY_DB[collection], []);
  }
});
