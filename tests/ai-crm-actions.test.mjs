import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  applyAiCrmAction,
  createAiCrmActionProposal,
  findUnlinkedAiCrmVehicles,
  getAiCrmActionCollectionOptions,
  getPendingAiCrmAction,
  isAiCrmActionCancellation,
  extractSingleUserPhone,
  getAiCrmActionSchema,
  looksLikeAiCrmMutationRequest,
  resolveAiCrmVehicleCustomer,
  verifyAiCrmActionPersistence,
} from "../app/lib/ai-crm-actions.mjs";

const originalSecret = process.env.AUTH_SESSION_SECRET;
const now = Date.parse("2026-11-15T12:00:00.000Z");
const database = {
  customers: [
    { id: "customer-1", name: "Existing customer", phone: "60000000", createdAt: "2026-01-01" },
  ],
};

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = originalSecret;
});

test("CRM proposals are signed, previewed, role-checked, and applied only once", () => {
  process.env.AUTH_SESSION_SECRET = "ai-action-test-secret";
  const proposal = createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database,
    now,
    action: {
      operation: "create",
      collection: "customers",
      dataJson: JSON.stringify({ name: "New customer", phone: "61111111" }),
    },
  });
  assert.equal(proposal.preview.after.name, "New customer");
  assert.ok(proposal.token);

  const applied = applyAiCrmAction({
    username: "TUDOR",
    role: "admin",
    database,
    token: proposal.token,
    now: now + 1,
  });
  assert.equal(applied.database.customers.length, 2);
  assert.equal(applied.database.customers[0].name, "New customer");

  const repeated = applyAiCrmAction({
    username: "TUDOR",
    role: "admin",
    database: applied.database,
    token: proposal.token,
    now: now + 2,
  });
  assert.equal(repeated.alreadyApplied, true);
  assert.equal(repeated.database.customers.length, 2);
});

test("CRM action confirmation rejects another user, an expired proposal, and a forbidden role", () => {
  process.env.AUTH_SESSION_SECRET = "ai-action-test-secret";
  const proposal = createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database,
    now,
    action: {
      operation: "delete",
      collection: "customers",
      targetId: "customer-1",
    },
  });

  assert.throws(
    () => applyAiCrmAction({ username: "DAN", role: "admin", database, token: proposal.token, now }),
    /другого пользователя/,
  );
  assert.throws(
    () => applyAiCrmAction({ username: "TUDOR", role: "admin", database, token: proposal.token, now: now + 6 * 60 * 1000 }),
    /истёк/,
  );
  assert.throws(
    () => applyAiCrmAction({ username: "TUDOR", role: "readonly", database, token: proposal.token, now }),
    /роль/,
  );
});

test("CRM update proposals conflict when the target record changes before confirmation", () => {
  process.env.AUTH_SESSION_SECRET = "ai-action-test-secret";
  const proposal = createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database,
    now,
    action: {
      operation: "update",
      collection: "customers",
      targetId: "customer-1",
      dataJson: JSON.stringify({ name: "Updated name" }),
    },
  });

  assert.throws(
    () => applyAiCrmAction({
      username: "TUDOR",
      role: "admin",
      database: { ...database, customers: [{ ...database.customers[0], phone: "62222222" }] },
      token: proposal.token,
      now,
    }),
    /изменилась после подготовки/,
  );
});

test("AI receives writable collection field names without record values", () => {
  const schema = getAiCrmActionSchema(database, "manager");
  assert.deepEqual(schema.customers.sort(), ["createdAt", "id", "name", "phone"]);
  assert.ok(schema.vehicles.includes("customerId"));
  assert.ok(schema.vehicles.includes("makeModel"));
  assert.equal("employeeProfiles" in schema, false);
  assert.equal("systemEvents" in schema, false);
  assert.equal(JSON.stringify(schema).includes("Existing customer"), false);
});

test("Gemini collection enum never contains an empty option", () => {
  const writableOptions = getAiCrmActionCollectionOptions(database, "manager");
  assert.ok(writableOptions.includes("customers"));
  assert.equal(writableOptions.includes(""), false);
  assert.deepEqual(getAiCrmActionCollectionOptions(database, "readOnly"), ["none"]);
});

test("CRM action intent carries through clarification replies and can be cancelled", () => {
  const pendingMessages = [
    { role: "user", content: "Создай клиента Test" },
    {
      role: "assistant",
      content: "Уточните имя клиента.",
      metadata: { analysis: "Уточните имя клиента." },
    },
  ];
  assert.equal(looksLikeAiCrmMutationRequest("Создай клиента Test"), true);
  assert.deepEqual(getPendingAiCrmAction(pendingMessages), {
    request: "Создай клиента Test",
  });
  assert.equal(getPendingAiCrmAction([
    ...pendingMessages,
    {
      role: "assistant",
      content: "Предложение подготовлено.",
      metadata: { actionProposal: { id: "proposal-1" } },
    },
  ]), null);
  assert.equal(isAiCrmActionCancellation("Не надо"), true);
  assert.equal(isAiCrmActionCancellation("Отмени заказ 123"), false);
});

test("vehicle actions resolve and validate the customer relationship", () => {
  process.env.AUTH_SESSION_SECRET = "ai-action-test-secret";
  const vehicleDatabase = { ...database, vehicles: [] };
  const history = [{
    role: "assistant",
    metadata: {
      actionProposal: {
        operation: "create",
        collection: "customers",
        recordId: "customer-1",
      },
    },
  }];
  const owner = resolveAiCrmVehicleCustomer(
    vehicleDatabase,
    "Добавь для него авто BMW M5 F90",
    history,
  );
  assert.equal(owner.customerId, "customer-1");

  assert.throws(() => createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database: vehicleDatabase,
    now,
    action: {
      operation: "create",
      collection: "vehicles",
      dataJson: JSON.stringify({ makeModel: "BMW M5 F90" }),
    },
  }), /клиента/);

  const proposal = createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database: vehicleDatabase,
    now,
    action: {
      operation: "create",
      collection: "vehicles",
      dataJson: JSON.stringify({ customerId: owner.customerId, makeModel: "BMW M5 F90" }),
    },
  });
  assert.equal(proposal.preview.after.customerName, "Existing customer");

  assert.throws(() => applyAiCrmAction({
    username: "TUDOR",
    role: "admin",
    database: {
      ...vehicleDatabase,
      customers: [{ ...vehicleDatabase.customers[0], archived: true }],
    },
    token: proposal.token,
    now,
  }), /архивному клиенту/);

  const applied = applyAiCrmAction({
    username: "TUDOR",
    role: "admin",
    database: vehicleDatabase,
    token: proposal.token,
    now,
  });
  assert.equal(applied.database.vehicles[0].customerId, owner.customerId);
  assert.equal(applied.database.vehicles[0].makeModel, "BMW M5 F90");
  assert.equal(verifyAiCrmActionPersistence(applied.database, applied.database, applied.proposal), true);
  const unlinkedVehicle = { ...applied.database.vehicles[0] };
  delete unlinkedVehicle.customerId;
  assert.throws(() => verifyAiCrmActionPersistence(
    applied.database,
    { ...applied.database, vehicles: [unlinkedVehicle] },
    applied.proposal,
  ), /не подтвердила ожидаемые данные/);

  const orphanedDatabase = {
    ...vehicleDatabase,
    vehicles: [{ id: "orphan-vehicle", makeModel: "BMW M5 F90" }],
  };
  const orphanedVehicles = findUnlinkedAiCrmVehicles(orphanedDatabase, "bmw  m5 f90");
  assert.equal(orphanedVehicles.length, 1);
  assert.deepEqual(findUnlinkedAiCrmVehicles({
    ...orphanedDatabase,
    vehicles: [
      { id: "owned-vehicle", makeModel: "BMW M5 F90", customerId: owner.customerId },
      { id: "archived-vehicle", makeModel: "BMW M5 F90", archived: true },
    ],
  }, "BMW M5 F90"), []);
  assert.equal(findUnlinkedAiCrmVehicles({
    ...orphanedDatabase,
    vehicles: [...orphanedDatabase.vehicles, { id: "orphan-vehicle-2", makeModel: "BMW M5 F90" }],
  }, "BMW M5 F90").length, 2);
  const repairProposal = createAiCrmActionProposal({
    username: "TUDOR",
    role: "admin",
    database: orphanedDatabase,
    now,
    action: {
      operation: "update",
      collection: "vehicles",
      targetId: orphanedVehicles[0].id,
      dataJson: JSON.stringify({ customerId: owner.customerId }),
    },
  });
  assert.equal(repairProposal.preview.before.customerName, "Не привязан");
  assert.equal(repairProposal.preview.after.makeModel, "BMW M5 F90");
  assert.equal(repairProposal.preview.after.customerName, "Existing customer");

  const repaired = applyAiCrmAction({
    username: "TUDOR",
    role: "admin",
    database: orphanedDatabase,
    token: repairProposal.token,
    now,
  });
  assert.equal(repaired.database.vehicles[0].customerId, owner.customerId);
  assert.equal(repaired.database.vehicles[0].makeModel, "BMW M5 F90");
  assert.equal(verifyAiCrmActionPersistence(repaired.database, repaired.database, repaired.proposal), true);
  assert.deepEqual(findUnlinkedAiCrmVehicles(repaired.database, "BMW M5 F90"), []);
});

test("phone values can be retained server-side without sending them to Gemini", () => {
  assert.equal(
    extractSingleUserPhone("Создай клиента Иван, телефон: +373 69 123 456"),
    "+373 69 123 456",
  );
  assert.equal(
    extractSingleUserPhone("Создай клиента Test +36369917817\nЯ отправил номер телефона!"),
    "+36369917817",
  );
  assert.equal(extractSingleUserPhone("Создай клиента в ноябре 2026 года"), "");
  assert.equal(
    extractSingleUserPhone("Телефон 060123456 и телефон 069123456"),
    "",
  );
});
