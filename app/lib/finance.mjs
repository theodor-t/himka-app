export const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function amountToCents(value) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
}

export function centsToAmount(cents) {
  return Math.round(cents) / 100;
}

export function sumAmounts(items, selectAmount = (item) => item.amount) {
  return centsToAmount(
    items.reduce((total, item) => total + amountToCents(selectAmount(item)), 0),
  );
}

export function formatMoney(value) {
  const amount = centsToAmount(amountToCents(value));
  return `${amount.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} MDL`;
}

export function parseRecordDate(value) {
  if (!value) return null;
  const match = String(value).match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/,
  );
  if (match) {
    const [, day, month, year, hours = "0", minutes = "0"] = match;
    const date = new Date(+year, +month - 1, +day, +hours, +minutes);
    return date.getFullYear() === +year && date.getMonth() === +month - 1 && date.getDate() === +day
      ? date
      : null;
  }
  const nativeDate = new Date(value);
  return Number.isNaN(nativeDate.getTime()) ? null : nativeDate;
}

export function periodKeyFor(item, fallbackDate = new Date()) {
  if (/^\d{4}-\d{2}$/.test(item?.periodKey || "")) return item.periodKey;
  const date = parseRecordDate(item?.date || item?.datetime);
  if (date) return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const monthIndex = MONTHS.indexOf(item?.month);
  if (monthIndex >= 0) {
    const year = Number(item?.year) || fallbackDate.getFullYear();
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  }
  return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(periodKey) {
  const [year, month] = periodKey.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export const clientIdKey = (value) => String(value ?? "");

export function hasOpenDebt(debts, clientId) {
  return debts.some(
    (debt) =>
      clientIdKey(debt.clientId) === clientIdKey(clientId) &&
      !debt.paid &&
      amountToCents(debt.amount) > 0,
  );
}

export function getUnpaidClients(db) {
  return db.clients.filter(
    (client) => {
      const receivedPayment = db.incomes.some(
        (income) => clientIdKey(income.clientId) === clientIdKey(client.id),
      );
      const activeAppointment = !["Отменен", "Не пришел"].includes(client.status);
      return (
        hasOpenDebt(db.debts, client.id) ||
        (!receivedPayment && activeAppointment)
      );
    },
  );
}

export function applyPaymentToDebts(debts, clientId, paymentCents) {
  let remaining = paymentCents;
  const allocations = [];
  const eligible = debts
    .filter(
      (debt) =>
        clientIdKey(debt.clientId) === clientIdKey(clientId) &&
        !debt.paid &&
        amountToCents(debt.amount) > 0,
    )
    .sort(
      (first, second) =>
        (parseRecordDate(first.date)?.getTime() || 0) -
        (parseRecordDate(second.date)?.getTime() || 0),
    );
  const updates = new Map();
  eligible.forEach((debt) => {
    if (remaining <= 0) return;
    const debtCents = amountToCents(debt.amount);
    const applied = Math.min(debtCents, remaining);
    const balance = debtCents - applied;
    remaining -= applied;
    allocations.push({ debtId: debt.id, amountCents: applied });
    updates.set(debt.id, {
      ...debt,
      amount: centsToAmount(balance),
      paid: balance === 0,
    });
  });
  return {
    debts: updates.size ? debts.map((debt) => updates.get(debt.id) || debt) : debts,
    allocations,
  };
}

export function reversePaymentFromDebts(debts, allocations = []) {
  const reversed = new Map(
    allocations.map((allocation) => [
      clientIdKey(allocation.debtId),
      Number.isFinite(allocation.amountCents)
        ? Math.round(allocation.amountCents)
        : amountToCents(allocation.amount),
    ]),
  );
  return debts.map((debt) => {
    const cents = reversed.get(clientIdKey(debt.id));
    if (!cents) return debt;
    return {
      ...debt,
      amount: centsToAmount(amountToCents(debt.amount) + cents),
      paid: false,
    };
  });
}