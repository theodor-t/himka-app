import { amountToCents, centsToAmount, parseRecordDate } from "./finance.mjs";
import { normalizePhoneForMessaging } from "./messages.mjs";

export function visitsForCustomer(db, customer) {
  const phone = normalizePhoneForMessaging(customer?.phone);
  return db.clients.filter(
    (visit) =>
      String(visit.customerId ?? "") === String(customer?.id ?? "") ||
      (!visit.customerId &&
        phone &&
        normalizePhoneForMessaging(visit.phone) === phone),
  );
}

export function visitsForVehicle(db, vehicle) {
  return db.clients.filter(
    (visit) =>
      String(visit.vehicleId ?? "") === String(vehicle?.id ?? "") ||
      (!visit.vehicleId &&
        String(visit.customerId ?? "") === String(vehicle?.customerId ?? "") &&
        normalizeVehicleName(visit.car) ===
          normalizeVehicleName(vehicle?.makeModel || vehicle?.name)),
  );
}

export function customerSummary(db, customer) {
  const visits = visitsForCustomer(db, customer);
  const visitIds = new Set(visits.map((visit) => String(visit.id)));
  const payments = db.incomes.filter((payment) =>
    visitIds.has(String(payment.clientId)),
  );
  const paidCents = payments.reduce(
    (total, payment) => total + amountToCents(payment.amount),
    0,
  );
  const latestVisit = visits.reduce((latest, visit) => {
    const timestamp = parseRecordDate(visit.datetime)?.getTime();
    return Number.isFinite(timestamp) && timestamp > (latest?.timestamp ?? -Infinity)
      ? { visit, timestamp }
      : latest;
  }, null);

  return {
    visits,
    payments,
    visitCount: visits.length,
    totalPaid: centsToAmount(paidCents),
    averagePaidPerVisit: visits.length
      ? centsToAmount(Math.round(paidCents / visits.length))
      : 0,
    lastVisit: latestVisit?.visit || null,
  };
}

function normalizeVehicleName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
