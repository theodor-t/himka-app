import { normalizePhoneForMessaging } from "./messages.mjs";

export const DB_SCHEMA_VERSION = 4;

export const DATABASE_COLLECTIONS = [
  "clients",
  "expenses",
  "incomes",
  "warehouse",
  "withdrawals",
  "debts",
  "windows",
  "logs",
  "stockMovements",
  "services",
  "videoDescriptions",
  "messageTemplates",
  "customers",
  "vehicles",
  "orders",
  "inspections",
  "waitlistEntries",
  "servicePackages",
  "loyaltyTransactions",
  "reminders",
  "notifications",
  "notificationPreferences",
  "suppliers",
  "supplierPayments",
  "workPosts",
  "financialGoals",
  "employeeProfiles",
  "systemEvents",
];

export const EMPTY_DB = {
  schemaVersion: DB_SCHEMA_VERSION,
  ...Object.fromEntries(DATABASE_COLLECTIONS.map((collection) => [collection, []])),
};

export function normalizeDatabase(data) {
  if (data != null && (typeof data !== "object" || Array.isArray(data))) {
    throw new Error("Invalid database payload");
  }

  const previousVersion = Number.isSafeInteger(data?.schemaVersion)
    ? data.schemaVersion
    : 1;
  const normalized = {
    ...EMPTY_DB,
    ...(data || {}),
    schemaVersion: Math.max(previousVersion, DB_SCHEMA_VERSION),
  };

  for (const collection of DATABASE_COLLECTIONS) {
    if (data?.[collection] == null) {
      normalized[collection] = [];
    } else if (!Array.isArray(data[collection])) {
      throw new Error(`Invalid database collection: ${collection}`);
    } else {
      normalized[collection] = data[collection];
    }
  }

  if (previousVersion < 3) migrateLegacyVisits(normalized);
  return normalized;
}

function migrateLegacyVisits(database) {
  const customersByPhone = new Map(
    database.customers
      .filter((customer) => customer.phone)
      .map((customer) => [
        normalizePhoneForMessaging(customer.phone),
        customer,
      ])
      .filter(([phone]) => phone),
  );
  const vehiclesByCustomerAndName = new Map(
    database.vehicles.map((vehicle) => [
      `${vehicle.customerId}:${normalizeVehicleName(vehicle.makeModel || vehicle.name)}`,
      vehicle,
    ]).filter(([key]) => !key.endsWith(":")),
  );

  database.clients = database.clients.map((visit, index) => {
    const phone = normalizePhoneForMessaging(visit.phone);
    const customerKey = phone || `visit:${visit.id ?? index}`;
    let customer = customersByPhone.get(customerKey);

    if (!customer) {
      customer = {
        id: `legacy-customer-${visit.id ?? index}`,
        name: "",
        phone: visit.phone || "",
        createdAt: "",
        legacy: true,
      };
      database.customers.push(customer);
      if (phone) customersByPhone.set(phone, customer);
    }

    const vehicleName = normalizeVehicleName(visit.car);
    const vehicleKey = vehicleName
      ? `${customer.id}:${vehicleName}`
      : `${customer.id}:visit:${visit.id ?? index}`;
    let vehicle = vehiclesByCustomerAndName.get(vehicleKey);

    if (!vehicle) {
      vehicle = {
        id: `legacy-vehicle-${visit.id ?? index}`,
        customerId: customer.id,
        makeModel: visit.car || "",
        seatType: visit.seatType || "",
        plate: "",
        vin: "",
        createdAt: "",
        legacy: true,
      };
      database.vehicles.push(vehicle);
      vehiclesByCustomerAndName.set(vehicleKey, vehicle);
    }

    return {
      ...visit,
      customerId: visit.customerId || customer.id,
      vehicleId: visit.vehicleId || vehicle.id,
    };
  });
}

function normalizeVehicleName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
