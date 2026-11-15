import { amountToCents, centsToAmount } from "./finance.mjs";

export const WORK_ORDER_STATUSES = [
  "Ожидает приезда",
  "Автомобиль принят",
  "Ожидает осмотра",
  "В работе",
  "Ожидает дополнительных работ",
  "Завершён",
  "Готов к выдаче",
  "Выдан клиенту",
  "Отменён",
];

export function orderTotalCents(order) {
  const servicesCents = (order?.services || []).reduce(
    (total, service) =>
      total + amountToCents(service.price) * Math.max(1, Number(service.quantity) || 1),
    0,
  );
  const discount = order?.discount || {};
  const discountCents = Math.max(0, discount.type === "percent"
    ? Math.round((servicesCents * Math.min(100, Math.max(0, Number(discount.value) || 0))) / 100)
    : amountToCents(discount.value));
  return Math.max(0, servicesCents - Math.min(servicesCents, discountCents));
}

export function paidForOrder(incomes, order) {
  const visitPayments = incomes.filter(
    (payment) => String(payment.clientId) === String(order.bookingId),
  );
  return visitPayments.reduce((total, payment) => {
    if (payment.debtId) return total;
    if (Number.isFinite(payment.serviceAmountCents)) {
      return total + Math.max(0, Math.round(payment.serviceAmountCents));
    }
    const debtAllocatedCents = (payment.debtAllocations || []).reduce(
      (sum, allocation) =>
        sum +
        (Number.isFinite(allocation.amountCents)
          ? Math.round(allocation.amountCents)
          : amountToCents(allocation.amount)),
      0,
    );
    return total + Math.max(0, amountToCents(payment.amount) - debtAllocatedCents);
  }, 0);
}

export function orderBalanceCents(incomes, order) {
  return Math.max(0, orderTotalCents(order) - paidForOrder(incomes, order));
}

export function nextOrderNumber(orders, year = new Date().getFullYear()) {
  const prefix = `AD-${year}-`;
  const sequence = orders.reduce((maximum, order) => {
    if (!String(order.number || "").startsWith(prefix)) return maximum;
    const value = Number(String(order.number).slice(prefix.length));
    return Number.isSafeInteger(value) ? Math.max(maximum, value) : maximum;
  }, 0);
  return `${prefix}${String(sequence + 1).padStart(5, "0")}`;
}

export function orderTotal(order) {
  return centsToAmount(orderTotalCents(order));
}

export function orderBalance(incomes, order) {
  return centsToAmount(orderBalanceCents(incomes, order));
}

export function mappedAppointmentStatus(orderStatus, currentStatus) {
  if (orderStatus === "Отменён") return "Отменен";
  if (orderStatus === "Выдан клиенту") return "Выполнено";
  return currentStatus || "В ожидании";
}
