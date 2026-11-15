import {
  amountToCents,
  centsToAmount,
  parseRecordDate,
  periodKeyFor,
  sumAmounts,
} from "./finance.mjs";
import { orderTotalCents } from "./work-orders.mjs";

const DAY = 24 * 60 * 60 * 1000;
const COMPLETED_ORDER_STATUSES = new Set(["Завершён", "Выдан клиенту"]);
const CLOSED_APPOINTMENT_STATUSES = new Set(["Отменен", "Не пришел"]);

export const ADVISOR_PERIODS = [
  ["today", "Сегодня"],
  ["week", "Эта неделя"],
  ["month", "Этот месяц"],
  ["lastMonth", "Прошлый месяц"],
  ["last3Months", "Последние 3 месяца"],
  ["year", "Этот год"],
  ["custom", "Свой период"],
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function shiftMonth(date, amount) {
  const shifted = new Date(date);
  const day = shifted.getDate();
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + amount);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
}

function strictDateInput(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return end ? endOfDay(date) : startOfDay(date);
}

function previousEquivalentRange(start, end) {
  const duration = end.getTime() - start.getTime() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  return {
    start: new Date(previousEnd.getTime() - duration + 1),
    end: previousEnd,
  };
}

export function advisorDateRange(period = "month", from = "", to = "", now = new Date()) {
  const current = new Date(now);
  let start;
  let end = current;
  let previous;

  if (period === "custom") {
    start = strictDateInput(from);
    end = strictDateInput(to, true);
    if (!start || !end || start > end) {
      throw new Error("Укажите корректные даты начала и окончания периода.");
    }
    previous = previousEquivalentRange(start, end);
  } else if (period === "today") {
    start = startOfDay(current);
    previous = {
      start: new Date(start.getTime() - DAY),
      end: new Date(current.getTime() - DAY),
    };
  } else if (period === "week") {
    start = startOfDay(current);
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    previous = {
      start: new Date(start.getTime() - 7 * DAY),
      end: new Date(current.getTime() - 7 * DAY),
    };
  } else if (period === "lastMonth") {
    start = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    end = new Date(current.getFullYear(), current.getMonth(), 0, 23, 59, 59, 999);
    previous = {
      start: new Date(start.getFullYear(), start.getMonth() - 1, 1),
      end: new Date(start.getFullYear(), start.getMonth(), 0, 23, 59, 59, 999),
    };
  } else if (period === "last3Months") {
    start = shiftMonth(current, -3);
    start = startOfDay(start);
    previous = previousEquivalentRange(start, end);
  } else if (period === "year") {
    start = new Date(current.getFullYear(), 0, 1);
    previous = {
      start: new Date(current.getFullYear() - 1, 0, 1),
      end: new Date(current.getFullYear() - 1, current.getMonth(), current.getDate(), 23, 59, 59, 999),
    };
  } else {
    period = "month";
    start = new Date(current.getFullYear(), current.getMonth(), 1);
    const previousStart = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const previousEndDay = Math.min(
      current.getDate(),
      new Date(previousStart.getFullYear(), previousStart.getMonth() + 1, 0).getDate(),
    );
    previous = {
      start: previousStart,
      end: new Date(previousStart.getFullYear(), previousStart.getMonth(), previousEndDay, 23, 59, 59, 999),
    };
  }

  return {
    period,
    start,
    end,
    previousStart: previous.start,
    previousEnd: previous.end,
    from: formatDateInput(start),
    to: formatDateInput(end),
  };
}

const MONTH_WORDS = [
  ["январ", "ianuarie", "january"],
  ["феврал", "februarie", "february"],
  ["март", "martie", "march"],
  ["апрел", "aprilie", "april"],
  ["май", "мая", "mai", "may"],
  ["июн", "iunie", "june"],
  ["июл", "iulie", "july"],
  ["август", "august"],
  ["сентябр", "septembrie", "september"],
  ["октябр", "octombrie", "october"],
  ["ноябр", "noiembrie", "november"],
  ["декабр", "decembrie", "december"],
];

export function inferAdvisorQuestionPeriod(question, now = new Date()) {
  const text = String(question || "").toLocaleLowerCase();
  const current = new Date(now);
  const lastYear = /прошл(?:ом|ого|ый|ую)? года|anul trecut|last year/.test(text);
  const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
  let year = yearMatch ? Number(yearMatch[1]) : current.getFullYear() - Number(lastYear);
  let month = MONTH_WORDS.findIndex((words) => words.some((word) => text.includes(word)));

  if (month < 0 && /прошл(?:ом|ый|ого) месяц|last month|luna trecută|luna trecuta/.test(text)) {
    const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    month = previous.getMonth();
    if (!yearMatch && !lastYear) year = previous.getFullYear();
  } else if (month < 0 && /эт(?:от|ом) меся|this month|luna aceasta|luna curent/.test(text)) {
    month = current.getMonth();
  }

  if (month < 0 && lastYear) {
    return {
      period: "custom",
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    };
  }
  if (month < 0) return null;
  if (!yearMatch && !lastYear && month > current.getMonth()) year -= 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    period: "custom",
    from: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    to: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recordDate(record, fields = ["date", "datetime", "createdAt"]) {
  for (const field of fields) {
    const value = parseRecordDate(record?.[field]);
    if (value) return value;
  }
  return null;
}

function financialRecordDate(record) {
  const hasPeriodKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(record?.periodKey || ""));
  const hasLegacyPeriod = typeof record?.month === "string" &&
    /^\d{4}$/.test(String(record?.year || ""));
  if (!hasPeriodKey && !hasLegacyPeriod) return recordDate(record);

  const period = periodKeyFor(record);
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return recordDate(record);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return recordDate(record);

  const date = recordDate(record);
  if (date && date.getFullYear() === year && date.getMonth() === month - 1) return date;
  return new Date(year, month - 1, 1);
}

function inRange(date, range) {
  return date && date >= range.start && date <= range.end;
}

function completedOrderDate(order) {
  if (!COMPLETED_ORDER_STATUSES.has(order?.status)) return null;
  const completedEntry = [...(Array.isArray(order.history) ? order.history : [])]
    .reverse()
    .find((entry) => COMPLETED_ORDER_STATUSES.has(entry.status));
  return parseRecordDate(completedEntry?.at || completedEntry?.date) ||
    recordDate(order, ["updatedAt", "createdAt"]);
}

function customerKey(visit) {
  return String(visit?.customerId || visit?.phone || "");
}

function completedVisits(db) {
  return (Array.isArray(db?.clients) ? db.clients : []).filter((visit) => visit.status === "Выполнено");
}

function metricPeriod(db, range) {
  const incomes = (Array.isArray(db?.incomes) ? db.incomes : []).filter((item) =>
    inRange(financialRecordDate(item), range),
  );
  const expenses = (Array.isArray(db?.expenses) ? db.expenses : []).filter((item) =>
    item.source !== "Личные средства" && inRange(financialRecordDate(item), range),
  );
  const revenueCents = amountToCents(sumAmounts(incomes));
  const expenseCents = amountToCents(sumAmounts(expenses));
  const periodOrders = (Array.isArray(db?.orders) ? db.orders : [])
    .map((order) => ({ order, date: completedOrderDate(order) }))
    .filter(({ date }) => inRange(date, range))
    .map(({ order }) => order);
  const pricedOrders = periodOrders.filter((order) => orderTotalCents(order) > 0);
  const completed = completedVisits(db).filter((visit) => inRange(recordDate(visit), range));
  const customers = Array.isArray(db?.customers) ? db.customers : [];
  const newClients = customers.filter((customer) =>
    inRange(recordDate(customer, ["createdAt"]), range),
  ).length;
  const previousVisits = completedVisits(db).filter((visit) => {
    const date = recordDate(visit);
    return date && date < range.start;
  });
  const returningKeys = new Set(previousVisits.map(customerKey).filter(Boolean));
  const currentVisitKeys = new Set(completed.map(customerKey).filter(Boolean));
  const returningClients = [...currentVisitKeys].filter((key) => returningKeys.has(key)).length;
  const payingClients = clientPaymentTotals(db, range);
  const linkedRevenueCents = payingClients.reduce((total, client) => total + client.revenueCents, 0);

  return {
    revenueCents,
    expenseCents,
    profitCents: revenueCents - expenseCents,
    incomeRecords: incomes.length,
    expenseRecords: expenses.length,
    completedOrders: periodOrders.length,
    averageOrderValueCents: pricedOrders.length
      ? Math.round(pricedOrders.reduce((total, order) => total + orderTotalCents(order), 0) / pricedOrders.length)
      : null,
    newClients,
    returningClients,
    completedVisits: completed.length,
    payingClients: payingClients.length,
    averageClientSpendCents: payingClients.length
      ? Math.round(linkedRevenueCents / payingClients.length)
      : null,
  };
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function seriesFor(db, range) {
  const durationDays = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime() + 1) / DAY));
  const monthly = durationDays > 62;
  const buckets = [];
  const byKey = new Map();
  let cursor = startOfDay(range.start);
  while (cursor <= range.end) {
    const bucketDate = monthly ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : new Date(cursor);
    const key = monthly
      ? `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, "0")}`
      : dateKey(bucketDate);
    if (!byKey.has(key)) {
      const bucket = {
        key,
        label: monthly
          ? bucketDate.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" })
          : bucketDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
        revenueCents: 0,
        expenseCents: 0,
        completedOrders: 0,
      };
      byKey.set(key, bucket);
      buckets.push(bucket);
    }
    cursor.setDate(cursor.getDate() + (monthly ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate() - cursor.getDate() + 1 : 1));
  }

  const bucketKey = (date) => {
    if (!date) return null;
    return monthly
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      : dateKey(date);
  };
  (db.incomes || []).forEach((item) => {
    const date = financialRecordDate(item);
    if (inRange(date, range)) {
      const bucket = byKey.get(bucketKey(date));
      if (bucket) bucket.revenueCents += amountToCents(item.amount);
    }
  });
  (db.expenses || []).forEach((item) => {
    const date = financialRecordDate(item);
    if (item.source !== "Личные средства" && inRange(date, range)) {
      const bucket = byKey.get(bucketKey(date));
      if (bucket) bucket.expenseCents += amountToCents(item.amount);
    }
  });
  (db.orders || []).forEach((order) => {
    const date = completedOrderDate(order);
    if (inRange(date, range)) {
      const bucket = byKey.get(bucketKey(date));
      if (bucket) bucket.completedOrders += 1;
    }
  });
  return buckets.map((bucket) => ({
    ...bucket,
    revenue: centsToAmount(bucket.revenueCents),
    expenses: centsToAmount(bucket.expenseCents),
    profit: centsToAmount(bucket.revenueCents - bucket.expenseCents),
  }));
}

function monthlyBusinessPerformance(db) {
  const months = new Map();
  const bucketFor = (date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!months.has(key)) months.set(key, { period: key, revenueCents: 0, expenseCents: 0, completedOrders: 0 });
    return months.get(key);
  };
  (db.incomes || []).forEach((item) => {
    const date = financialRecordDate(item);
    if (date) bucketFor(date).revenueCents += amountToCents(item.amount);
  });
  (db.expenses || []).forEach((item) => {
    const date = financialRecordDate(item);
    if (date && item.source !== "Личные средства") {
      bucketFor(date).expenseCents += amountToCents(item.amount);
    }
  });
  (db.orders || []).forEach((order) => {
    const date = completedOrderDate(order);
    if (date) bucketFor(date).completedOrders += 1;
  });
  return [...months.values()]
    .sort((first, second) => first.period.localeCompare(second.period))
    .map((item) => ({
      period: item.period,
      revenue: centsToAmount(item.revenueCents),
      expenses: centsToAmount(item.expenseCents),
      profit: centsToAmount(item.revenueCents - item.expenseCents),
      completedOrders: item.completedOrders,
    }));
}

function dataCoverage(db) {
  const dated = (records, getDate) => records
    .map(getDate)
    .filter(Boolean)
    .sort((first, second) => first - second);
  const incomes = dated(db.incomes || [], financialRecordDate);
  const expenses = dated(
    (db.expenses || []).filter((item) => item.source !== "Личные средства"),
    financialRecordDate,
  );
  const completedOrders = dated(db.orders || [], completedOrderDate);
  const coverage = (dates) => ({
    records: dates.length,
    from: dates.length ? dateKey(dates[0]) : null,
    to: dates.length ? dateKey(dates.at(-1)) : null,
  });
  return {
    income: coverage(incomes),
    operatingExpenses: coverage(expenses),
    completedOrders: coverage(completedOrders),
  };
}

function serviceAnalytics(db, range, limit = 8) {
  const demand = new Map();
  completedVisits(db).filter((visit) => inRange(recordDate(visit), range)).forEach((visit) => {
    const name = String(visit.service || "").trim();
    if (!name) return;
    const current = demand.get(name) || { name, visits: 0, revenueCents: 0 };
    current.visits += 1;
    demand.set(name, current);
  });
  (db.orders || []).filter((order) => inRange(completedOrderDate(order), range))
    .forEach((order) => (order.services || []).forEach((line) => {
      const name = String(line.name || line.title || "").trim();
      if (!name) return;
      const current = demand.get(name) || { name, visits: 0, revenueCents: 0 };
      current.revenueCents += amountToCents(line.price) * Math.max(1, Number(line.quantity) || 1);
      demand.set(name, current);
    }));
  return [...demand.values()]
    .map((item) => ({ ...item, revenue: centsToAmount(item.revenueCents) }))
    .sort((first, second) => second.visits - first.visits || second.revenueCents - first.revenueCents)
    .slice(0, limit);
}

function clientPaymentTotals(db, range) {
  const customers = Array.isArray(db?.customers) ? db.customers : [];
  const visits = Array.isArray(db?.clients) ? db.clients : [];
  const orders = Array.isArray(db?.orders) ? db.orders : [];
  const visitsById = new Map(visits.map((visit) => [String(visit.id), visit]));
  const ordersById = new Map(orders.map((order) => [String(order.id), order]));
  const customerByKey = new Map(customers.map((customer) => [String(customer.id), customer]));
  const totals = new Map();
  (db.incomes || []).filter((income) => inRange(financialRecordDate(income), range)).forEach((income) => {
    const booking = visitsById.get(String(income.clientId));
    const order = ordersById.get(String(income.orderId));
    const key = String(order?.customerId || booking?.customerId || income.customerId || income.clientId || "");
    if (!key) return;
    const current = totals.get(key) || { key, revenueCents: 0, name: "" };
    current.revenueCents += amountToCents(income.amount);
    current.name = customerByKey.get(key)?.name || booking?.name || current.name || "Без имени";
    totals.set(key, current);
  });
  return [...totals.values()];
}

function topClients(db, range) {
  return clientPaymentTotals(db, range)
    .sort((first, second) => second.revenueCents - first.revenueCents)
    .slice(0, 10)
    .map(({ key, name, revenueCents }) => ({ id: key, name, revenue: centsToAmount(revenueCents) }));
}

function expenseCategoryAnalytics(db, range, previousRange) {
  const currentByCategory = new Map();
  const previousByCategory = new Map();
  (db?.expenses || [])
    .filter((expense) => expense.source !== "Личные средства")
    .forEach((expense) => {
      const date = financialRecordDate(expense);
      if (!date) return;
      const category = String(expense.category || "Без категории").trim() || "Без категории";
      if (inRange(date, range)) {
        const totals = currentByCategory.get(category) || { amountCents: 0, count: 0 };
        totals.amountCents += amountToCents(expense.amount);
        totals.count += 1;
        currentByCategory.set(category, totals);
      } else if (inRange(date, previousRange)) {
        const totals = previousByCategory.get(category) || { amountCents: 0, count: 0 };
        totals.amountCents += amountToCents(expense.amount);
        totals.count += 1;
        previousByCategory.set(category, totals);
      }
    });
  const categories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  return [...categories]
    .map((name) => {
      const current = currentByCategory.get(name) || { amountCents: 0, count: 0 };
      const previous = previousByCategory.get(name) || { amountCents: 0, count: 0 };
      return {
        name,
        amount: centsToAmount(current.amountCents),
        count: current.count,
        previousAmount: centsToAmount(previous.amountCents),
        previousCount: previous.count,
        changePercent: percentChange(current.amountCents, previous.amountCents),
      };
    })
    .sort((first, second) =>
      Math.max(second.amount, second.previousAmount) - Math.max(first.amount, first.previousAmount),
    )
    .slice(0, 8);
}

function inactiveClients(db, now) {
  const visitsByCustomer = new Map();
  const futureBookings = new Set((db?.clients || [])
    .filter((visit) => !CLOSED_APPOINTMENT_STATUSES.has(visit.status))
    .filter((visit) => {
      const date = recordDate(visit);
      return date && date > now;
    })
    .map(customerKey)
    .filter(Boolean));
  completedVisits(db).forEach((visit) => {
    const key = customerKey(visit);
    const date = recordDate(visit);
    if (!key || !date || date > now) return;
    const latest = visitsByCustomer.get(key);
    if (!latest || date > latest.lastVisit) {
      visitsByCustomer.set(key, {
        lastVisit: date,
        count: (latest?.count || 0) + 1,
        id: visit.customerId || key,
      });
    } else {
      latest.count += 1;
    }
  });
  const names = new Map((db.customers || []).map((customer) => [String(customer.id), customer.name]));
  return [...visitsByCustomer.entries()]
    .map(([key, value]) => ({
      id: value.id,
      name: names.get(key) || "Без имени",
      daysSinceVisit: Math.floor((now.getTime() - value.lastVisit.getTime()) / DAY),
      visits: value.count,
    }))
    .filter((client) => !futureBookings.has(String(client.id)))
    .filter((client) => client.daysSinceVisit >= 60)
    .sort((first, second) => second.daysSinceVisit - first.daysSinceVisit)
    .slice(0, 20);
}

function orderAnalytics(db, range) {
  const orders = (db.orders || []).filter((order) =>
    inRange(recordDate(order, ["createdAt", "updatedAt"]), range),
  );
  const byStatus = new Map();
  orders.forEach((order) => {
    const status = String(order.status || "Без статуса");
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  });
  const appointmentsByWeekday = new Map();
  (db.clients || []).filter((visit) =>
    !CLOSED_APPOINTMENT_STATUSES.has(visit.status) && inRange(recordDate(visit), range),
  ).forEach((visit) => {
    const date = recordDate(visit);
    const weekday = date.toLocaleDateString("ru-RU", { weekday: "long" });
    appointmentsByWeekday.set(weekday, (appointmentsByWeekday.get(weekday) || 0) + 1);
  });
  return {
    statusDistribution: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((first, second) => second.count - first.count),
    busiestWeekdays: [...appointmentsByWeekday.entries()]
      .map(([weekday, appointments]) => ({ weekday, appointments }))
      .sort((first, second) => second.appointments - first.appointments)
      .slice(0, 3),
  };
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function buildAdvisorAnalytics(db, options = {}, now = new Date()) {
  const range = advisorDateRange(options.period, options.from, options.to, now);
  const current = metricPeriod(db, range);
  const previous = metricPeriod(db, { start: range.previousStart, end: range.previousEnd });
  const previousRange = { start: range.previousStart, end: range.previousEnd };
  const previousServices = new Map(
    serviceAnalytics(db, previousRange, Number.POSITIVE_INFINITY)
      .map((item) => [item.name, item.visits]),
  );
  const services = serviceAnalytics(db, range).map((item) => {
    const previousVisits = previousServices.get(item.name) || 0;
    return {
      ...item,
      previousVisits,
      changePercent: percentChange(item.visits, previousVisits),
    };
  });
  const expenseCategories = expenseCategoryAnalytics(db, range, previousRange);
  const series = seriesFor(db, range);
  const monthlyPerformance = monthlyBusinessPerformance(db);
  const dataAvailability = dataCoverage(db);
  const orders = orderAnalytics(db, range);
  const inactive = inactiveClients(db, now);
  return {
    range,
    current: {
      ...current,
      revenue: centsToAmount(current.revenueCents),
      expenses: centsToAmount(current.expenseCents),
      profit: centsToAmount(current.profitCents),
      averageOrderValue: current.averageOrderValueCents === null
        ? null
        : centsToAmount(current.averageOrderValueCents),
      averageClientSpend: current.averageClientSpendCents === null
        ? null
        : centsToAmount(current.averageClientSpendCents),
    },
    previous: {
      ...previous,
      revenue: centsToAmount(previous.revenueCents),
      expenses: centsToAmount(previous.expenseCents),
      profit: centsToAmount(previous.profitCents),
      averageOrderValue: previous.averageOrderValueCents === null
        ? null
        : centsToAmount(previous.averageOrderValueCents),
      averageClientSpend: previous.averageClientSpendCents === null
        ? null
        : centsToAmount(previous.averageClientSpendCents),
    },
    changes: {
      revenue: percentChange(current.revenueCents, previous.revenueCents),
      expenses: percentChange(current.expenseCents, previous.expenseCents),
      profit: percentChange(current.profitCents, previous.profitCents),
      completedOrders: percentChange(current.completedOrders, previous.completedOrders),
      newClients: percentChange(current.newClients, previous.newClients),
      returningClients: percentChange(current.returningClients, previous.returningClients),
      averageClientSpend: percentChange(current.averageClientSpendCents, previous.averageClientSpendCents),
    },
    series,
    monthlyPerformance,
    dataAvailability,
    services,
    expenseCategories,
    topClients: topClients(db, range),
    inactiveClients: inactive,
    orders,
    generatedAt: now.toISOString(),
  };
}

function percentLabel(value) {
  return value === null ? "сравнение невозможно: нет данных предыдущего периода" : `${value > 0 ? "+" : ""}${value}%`;
}

export function buildAdvisorInsights(analytics, db, now = new Date()) {
  const insights = [];
  const current = analytics.current;
  const previous = analytics.previous;
  const add = (data) => insights.push({ ...data, generatedAt: now.toISOString() });

  if (
    current.incomeRecords >= 3 &&
    previous.incomeRecords >= 3 &&
    analytics.changes.revenue !== null &&
    Math.abs(analytics.changes.revenue) >= 15
  ) {
    const falling = analytics.changes.revenue < 0;
    add({
      id: "revenue-change",
      key: `revenue-change:${analytics.range.from}:${analytics.range.to}`,
      title: falling ? "Поступления заметно снизились" : "Поступления заметно выросли",
      explanation: `За выбранный период зарегистрировано ${current.incomeRecords} платежей на ${current.revenue.toLocaleString("ru-RU")} MDL; сравнение с предыдущим равным периодом: ${percentLabel(analytics.changes.revenue)}.`,
      supportingData: `${current.revenue.toLocaleString("ru-RU")} MDL против ${previous.revenue.toLocaleString("ru-RU")} MDL`,
      whyItMatters: falling
        ? "Снижение может повлиять на планирование закупок и загрузки."
        : "Рост важно сопоставить с реальной загрузкой и текущими расходами.",
      recommendation: falling
        ? "Сверьте полноту внесения оплат и количество выполненных заказов; эти данные не устанавливают причину снижения."
        : "Проверьте, поддерживается ли рост пропускной способностью и маржинальностью.",
      priority: falling ? "high" : "medium",
      type: "financial",
      facts: { currentRevenue: current.revenue, previousRevenue: previous.revenue, changePercent: analytics.changes.revenue },
    });
  }

  if (
    current.expenseRecords >= 5 &&
    previous.expenseRecords >= 5 &&
    previous.expenseCents > 0 &&
    current.expenseCents >= previous.expenseCents * 1.4
  ) {
    const increase = percentChange(current.expenseCents, previous.expenseCents);
    add({
      id: "expense-increase",
      key: `expense-increase:${analytics.range.from}:${analytics.range.to}`,
      title: "Операционные расходы выросли",
      explanation: `В текущем периоде ${current.expenseRecords} записей расходов; сумма выросла на ${increase}% относительно равного периода.`,
      supportingData: `${current.expenses.toLocaleString("ru-RU")} MDL против ${previous.expenses.toLocaleString("ru-RU")} MDL`,
      whyItMatters: "Рост расходов может уменьшить операционную прибыль.",
      recommendation: "Сравните категории расходов и проверьте корректность записей до принятия мер.",
      priority: "high",
      type: "expense",
      facts: { currentExpenses: current.expenses, previousExpenses: previous.expenses, changePercent: increase },
    });
  }

  const currentVisits = new Map();
  const previousVisits = new Map();
  completedVisits(db).forEach((visit) => {
    const name = String(visit.service || "").trim();
    const date = recordDate(visit);
    if (!name || !date) return;
    const target = inRange(date, analytics.range) ? currentVisits : (
      date >= analytics.range.previousStart && date <= analytics.range.previousEnd ? previousVisits : null
    );
    if (target) target.set(name, (target.get(name) || 0) + 1);
  });
  [...previousVisits.entries()].forEach(([name, previousCount]) => {
    const currentCount = currentVisits.get(name) || 0;
    if (previousCount < 5 || currentCount >= previousCount) return;
    const change = percentChange(currentCount, previousCount);
    if (change === null || change > -30) return;
    add({
      id: `service-demand:${name}`,
      key: `service-demand:${name}:${analytics.range.from}:${analytics.range.to}`,
      title: `Спрос на услугу «${name}» снизился`,
      explanation: `Выполнено ${currentCount} визитов против ${previousCount} в предыдущем периоде (${change}%).`,
      supportingData: `${currentCount} против ${previousCount} выполненных визитов`,
      whyItMatters: "Устойчивое снижение спроса может влиять на загрузку.",
      recommendation: "Проверьте актуальность услуги, расписания и полноту внесения визитов; причина по этим данным не определяется.",
      priority: "medium",
      type: "service",
      facts: { service: name, currentVisits: currentCount, previousVisits: previousCount, changePercent: change },
    });
  });

  [...currentVisits.entries()].forEach(([name, currentCount]) => {
    const previousCount = previousVisits.get(name) || 0;
    if (currentCount < 5 || previousCount < 5) return;
    const change = percentChange(currentCount, previousCount);
    if (change === null || change < 30) return;
    add({
      id: `service-growth:${name}`,
      key: `service-growth:${name}:${analytics.range.from}:${analytics.range.to}`,
      title: `Спрос на услугу «${name}» вырос`,
      explanation: `Выполнено ${currentCount} визитов против ${previousCount} в предыдущем периоде (+${change}%).`,
      supportingData: `${currentCount} против ${previousCount} выполненных визитов`,
      whyItMatters: "Изменение спроса может потребовать пересмотра доступной загрузки.",
      recommendation: "Проверьте расписание и наличие ресурсов; рост спроса сам по себе не доказывает рост прибыли.",
      priority: "medium",
      type: "service",
      facts: { service: name, currentVisits: currentCount, previousVisits: previousCount, changePercent: change },
    });
  });

  if (analytics.inactiveClients.length >= 3) {
    add({
      id: "client-retention",
      key: `client-retention:${analytics.range.from}:${analytics.range.to}`,
      title: "Есть клиенты без визитов более 60 дней",
      explanation: `В истории CRM найдено ${analytics.inactiveClients.length} клиентов с последним завершённым визитом не менее 60 дней назад.`,
      supportingData: `${analytics.inactiveClients.length} клиентов требуют проверки истории`,
      whyItMatters: "Потеря повторных визитов может уменьшать устойчивость клиентской базы.",
      recommendation: "Проверьте историю отношений и при необходимости подготовьте персональный follow-up. Сообщения автоматически не отправляются.",
      priority: "medium",
      type: "retention",
      facts: { inactiveClientCount: analytics.inactiveClients.length },
    });
  }

  const lowStock = (db.warehouse || []).filter((item) => {
    const quantity = Number(item.qty);
    const minimum = Number(item.minQty ?? 2);
    return item.qty !== "" && item.qty != null &&
      Number.isFinite(quantity) && Number.isFinite(minimum) && quantity <= minimum;
  });
  if (lowStock.length) {
    add({
      id: "inventory-low",
      key: `inventory-low:${analytics.range.from}:${analytics.range.to}`,
      title: "Склад требует проверки",
      explanation: `${lowStock.length} позиций достигли или опустились ниже установленного минимального остатка.`,
      supportingData: lowStock.slice(0, 5).map((item) => `${item.name}: ${item.qty}/${item.minQty ?? 2}`).join(" · "),
      whyItMatters: "Недостаток расходных материалов может затруднить выполнение запланированных работ.",
      recommendation: "Сверьте остатки и запланированные работы перед оформлением закупки.",
      priority: lowStock.some((item) => Number(item.qty) <= 0) ? "high" : "medium",
      type: "inventory",
      facts: { lowStockCount: lowStock.length },
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return insights.sort(
    (first, second) => priorityOrder[first.priority] - priorityOrder[second.priority],
  );
}

export function buildAdvisorRecommendations(existing, insights, now = new Date()) {
  const previous = Array.isArray(existing) ? existing : [];
  const byKey = new Map(previous.map((item) => [item.key, item]));
  const updated = insights.map((insight) => {
    const stored = byKey.get(insight.key);
    return {
      id: stored?.id || `advisor-recommendation:${insight.key}`,
      key: insight.key,
      title: insight.title,
      reason: insight.whyItMatters,
      supportingData: insight.supportingData,
      action: insight.recommendation,
      priority: insight.priority,
      status: stored?.status || "new",
      createdAt: stored?.createdAt || now.toISOString(),
      updatedAt: stored ? stored.updatedAt || stored.createdAt : now.toISOString(),
      type: insight.type,
      periodFrom: insight.key.split(":").at(-2) || "",
      periodTo: insight.key.split(":").at(-1) || "",
    };
  });
  const currentKeys = new Set(insights.map((item) => item.key));
  return [
    ...previous.filter((item) => !currentKeys.has(item.key)),
    ...updated,
  ];
}

export function advisorFactsForAi(analytics, insights) {
  return {
    period: {
      from: analytics.range.from,
      to: analytics.range.to,
    },
    current: {
      revenue: analytics.current.revenue,
      expenses: analytics.current.expenses,
      profit: analytics.current.profit,
      completedOrders: analytics.current.completedOrders,
      averageOrderValue: analytics.current.averageOrderValue,
      averageClientSpend: analytics.current.averageClientSpend,
      payingClients: analytics.current.payingClients,
      newClients: analytics.current.newClients,
      returningClients: analytics.current.returningClients,
      incomeRecords: analytics.current.incomeRecords,
      expenseRecords: analytics.current.expenseRecords,
    },
    comparison: {
      revenuePercent: analytics.changes.revenue,
      expensePercent: analytics.changes.expenses,
      profitPercent: analytics.changes.profit,
      ordersPercent: analytics.changes.completedOrders,
      newClientsPercent: analytics.changes.newClients,
      returningClientsPercent: analytics.changes.returningClients,
      averageClientSpendPercent: analytics.changes.averageClientSpend,
    },
    monthlyPerformance: analytics.monthlyPerformance,
    dataAvailability: analytics.dataAvailability,
    services: analytics.services.map(({ name, visits, revenue, previousVisits, changePercent }) => ({
      name, visits, revenue, previousVisits, changePercent,
    })),
    expenseCategories: analytics.expenseCategories.map(({ name, amount, count, previousAmount, changePercent }) => ({
      name, amount, count, previousAmount, changePercent,
    })),
    insights: insights.map(({ id, title, supportingData, facts }) => ({ id, title, supportingData, facts })),
    dataLimits: {
      clientsWithLongGap: analytics.inactiveClients.length,
      note: "No customer names, phone numbers, vehicle identifiers, or raw database records are included.",
    },
  };
}

function money(value, language) {
  return `${Number(value || 0).toLocaleString(language === "ro" ? "ro-RO" : "ru-RU", {
    maximumFractionDigits: 2,
  })} MDL`;
}

export function answerAdvisorQuestion(analytics, question, language = "ru") {
  const text = String(question || "").toLocaleLowerCase(language === "ro" ? "ro" : "ru");
  const ro = language === "ro";
  const table = (headers, rows) => ({ headers, rows });
  if (/откуда.*(информац|данн|цифр)|источник.*данн|на чем.*осн|de unde.*(informa|date|cifre)|surs.*dat/.test(text)) {
    const availability = analytics.dataAvailability || {};
    const coverage = (item) => item?.records
      ? `${item.records} · ${item.from} — ${item.to}`
      : ro ? "fără înregistrări cu perioadă cunoscută" : "нет записей с известным периодом";
    return {
      text: ro
        ? `Datele vin din înregistrările CRM pentru perioada ${analytics.range.from} — ${analytics.range.to}. CRM calculează cifrele pe server; Gemini primește doar indicatori agregați, nu baza brută sau date personale.`
        : `Данные берутся из записей CRM за период ${analytics.range.from} — ${analytics.range.to}. Показатели рассчитываются на сервере; Gemini получает только агрегированные метрики, а не базу целиком или персональные данные.`,
      table: table(
        ro ? ["Sursa", "Înregistrări / acoperire"] : ["Данные CRM", "Записей / охват"],
        [
          [ro ? "Venituri" : "Поступления", coverage(availability.income)],
          [ro ? "Cheltuieli operaționale" : "Операционные расходы", coverage(availability.operatingExpenses)],
          [ro ? "Comenzi finalizate" : "Завершённые заказы", coverage(availability.completedOrders)],
        ],
      ),
    };
  }
  if (/de ce.*(zero|zerouri|0)|de ce.*(venit|cheltu|profit).*(lips|zero|0)|почему.*(нул|0|пуст)|нул.*(доход|выруч|расход|прибыл)|почему.*(доход|выруч|расход|прибыл).*(нет|пуст|0)/.test(text)) {
    const availability = analytics.dataAvailability || {};
    const rows = [
      [ro ? "Indicator" : "Показатель", ro ? "În perioada selectată" : "За выбранный период", ro ? "În tot CRM" : "Во всей CRM"],
      [ro ? "Încasări" : "Поступления", `${analytics.current.incomeRecords}`, `${availability.income?.records || 0}`],
      [ro ? "Cheltuieli operaționale" : "Операционные расходы", `${analytics.current.expenseRecords}`, `${availability.operatingExpenses?.records || 0}`],
      [ro ? "Comenzi finalizate" : "Завершённые заказы", `${analytics.current.completedOrders}`, `${availability.completedOrders?.records || 0}`],
    ];
    const hasRecordsOutsideRange = rows.slice(1).some((row) => Number(row[2]) > Number(row[1]));
    return {
      text: hasRecordsOutsideRange
        ? ro
          ? `Perioada selectată (${analytics.range.from} — ${analytics.range.to}) nu conține aceste înregistrări, deși CRM are date în afara ei. Verifică intervalul selectat.`
          : `В выбранном интервале (${analytics.range.from} — ${analytics.range.to}) записей нет, но в CRM есть записи за другие даты. Проверьте выбранный период.`
        : ro
          ? "Analiza nu a găsit înregistrări datate pentru acești indicatori în datele CRM primite."
          : "В полученных данных CRM не найдено записей с датами для этих показателей.",
      table: table(rows[0], rows.slice(1)),
    };
  }
  if (/care lun[aă].*(productiv|profit|venit|aglomer)|cea mai productiv|cel mai productiv|most productive month|best.*month|сам(ый|ый) продуктивн.*месяц|какой.*месяц.*(продуктив|прибыл|выруч|загруж)|сам(ый|ый) прибыльн.*месяц/.test(text)) {
    const months = analytics.monthlyPerformance || [];
    const monthName = (period) => {
      const [year, month] = period.split("-").map(Number);
      return new Date(year, month - 1, 1).toLocaleDateString(ro ? "ro-RO" : "ru-RU", {
        month: "long",
        year: "numeric",
      });
    };
    const topMonth = (field) => months.reduce(
      (best, item) => item[field] > (best?.[field] ?? -Infinity) ? item : best,
      null,
    );
    if (months.length < 2) {
      return {
        text: ro
          ? "Nu există cel puțin două luni cu date în CRM pentru a compara productivitatea."
          : "В CRM нет данных как минимум за два месяца, поэтому сравнить продуктивность пока нельзя.",
        table: null,
      };
    }
    const bestRevenue = topMonth("revenue");
    const bestProfit = topMonth("profit");
    const bestOrders = topMonth("completedOrders");
    const rows = months.slice().sort((first, second) => second.revenue - first.revenue)
      .slice(0, 5)
      .map((item) => [monthName(item.period), money(item.revenue, language), money(item.profit, language), String(item.completedOrders)]);
    return {
      text: ro
        ? `Pe baza întregii istorii datate din CRM: venitul maxim a fost în ${monthName(bestRevenue.period)} (${money(bestRevenue.revenue, language)}); profitul operațional maxim în ${monthName(bestProfit.period)} (${money(bestProfit.profit, language)}); cele mai multe comenzi finalizate în ${monthName(bestOrders.period)} (${bestOrders.completedOrders}).`
        : `По всей датированной истории CRM: максимум поступлений был в месяце «${monthName(bestRevenue.period)}» (${money(bestRevenue.revenue, language)}); максимум операционной прибыли — в «${monthName(bestProfit.period)}» (${money(bestProfit.profit, language)}); больше всего завершённых заказов — в «${monthName(bestOrders.period)}» (${bestOrders.completedOrders}).`,
      table: table(
        ro ? ["Luna", "Venituri", "Profit", "Comenzi"] : ["Месяц", "Поступления", "Прибыль", "Заказы"],
        rows,
      ),
    };
  }
  if (/top|топ|сам(ый|ая|ые) цен|cei mai profit|clien.t.*valoro/.test(text)) {
    return {
      text: ro
        ? "Clasamentul este calculat din plățile CRM în perioada selectată."
        : "Рейтинг рассчитан по фактически внесённым платежам за выбранный период.",
      table: table(
        ro ? ["Client", "Plăți"] : ["Клиент", "Оплаты"],
        analytics.topClients.map((item) => [item.name, money(item.revenue, language)]),
      ),
    };
  }
  if (/60|не возвращ|давно не|inactive|nu au revenit|nu au vizit/.test(text)) {
    return {
      text: ro
        ? `CRM conține ${analytics.inactiveClients.length} clienți fără vizite finalizate în ultimele 60+ zile.`
        : `В CRM найдено ${analytics.inactiveClients.length} клиентов без завершённых визитов более 60 дней.`,
      table: table(
        ro ? ["Client", "Zile fără vizită"] : ["Клиент", "Дней без визита"],
        analytics.inactiveClients.map((item) => [item.name, String(item.daysSinceVisit)]),
      ),
    };
  }
  if (/ziua.*aglomer|cel mai aglomer|busy day|сам(ый|ый) загруж|загруженн/.test(text)) {
    const day = analytics.orders.busiestWeekdays[0];
    return {
      text: day
        ? ro
          ? `Cea mai aglomerată zi după programările din perioada selectată este ${day.weekday} (${day.appointments} programări).`
          : `Самый загруженный день по записям за выбранный период — ${day.weekday} (${day.appointments} записей).`
        : ro ? "Nu există date suficiente despre programări în această perioadă." : "Недостаточно данных о записях за этот период.",
      table: table(ro ? ["Zi", "Programări"] : ["День", "Записи"], analytics.orders.busiestWeekdays.map((item) => [item.weekday, String(item.appointments)])),
    };
  }
  if (/popular|популяр|cerere|most requested/.test(text)) {
    const rows = analytics.services.slice().sort((first, second) => second.visits - first.visits)
      .map((item) => [item.name, String(item.visits)]);
    return {
      text: rows.length
        ? ro ? "Serviciile sunt ordonate după numărul vizitelor finalizate." : "Услуги отсортированы по числу завершённых визитов."
        : ro ? "Nu există vizite finalizate în perioada selectată." : "Нет завершённых визитов за выбранный период.",
      table: table(ro ? ["Serviciu", "Vizite"] : ["Услуга", "Визиты"], rows),
    };
  }
  if (/average.*client|average.*spend|cheltuiel.*medii.*client|cheltuie.*medie.*client|medie.*client|spending per client|средн.*(трат|расход|клиент)|средний клиент/.test(text)) {
    return {
      text: analytics.current.averageClientSpend === null
        ? ro
          ? "Nu există plăți legate de clienți în perioada selectată."
          : "Нет оплат, связанных с клиентами, за выбранный период."
        : ro
          ? `Cheltuiala medie per client care are plăți legate în CRM: ${money(analytics.current.averageClientSpend, language)}.`
          : `Средние оплаты на клиента с привязанными платежами: ${money(analytics.current.averageClientSpend, language)}.`,
      table: table(
        ro ? ["Indicator", "Valoare"] : ["Показатель", "Значение"],
        [
          [ro ? "Clienți cu plăți legate" : "Клиенты со связанными оплатами", String(analytics.current.payingClients)],
          [ro ? "Medie per client" : "Среднее на клиента", analytics.current.averageClientSpend === null ? "—" : money(analytics.current.averageClientSpend, language)],
        ],
      ),
    };
  }
  if (/new.*return|return.*client|noi.*reven|clien.t.*noi|нов.*вернув|новых.*возвращ|вернувшихся.*новых/.test(text)) {
    return {
      text: ro
        ? "Clienții noi se bazează pe data înregistrării; cei reveniți au vizite finalizate atât înainte, cât și în perioada selectată."
        : "Новые клиенты считаются по дате регистрации; вернувшиеся — по завершённым визитам и до, и внутри выбранного периода.",
      table: table(
        ro ? ["Categorie", "Perioada curentă", "Perioada precedentă"] : ["Категория", "Текущий период", "Предыдущий период"],
        [
          [ro ? "Clienți noi" : "Новые клиенты", String(analytics.current.newClients), String(analytics.previous.newClients)],
          [ro ? "Clienți reveniți" : "Вернувшиеся клиенты", String(analytics.current.returningClients), String(analytics.previous.returningClients)],
        ],
      ),
    };
  }
  if (/profitabil|generat.*venit|revenue by service|servici.*venit|услуг.*доход|выруч.*услуг/.test(text)) {
    const rows = analytics.services.slice().sort((first, second) => second.revenue - first.revenue)
      .map((item) => [item.name, money(item.revenue, language)]);
    return {
      text: ro
        ? "Venitul pe servicii folosește valorile serviciilor din comenzile finalizate; datele lipsă nu sunt estimate."
        : "Выручка по услугам рассчитана по строкам услуг завершённых заказов; отсутствующие значения не оцениваются.",
      table: table(ro ? ["Serviciu", "Venit"] : ["Услуга", "Выручка"], rows),
    };
  }
  if (/completat|finalizat|orders|заказ/.test(text)) {
    return {
      text: ro
        ? `Comenzi finalizate în perioada selectată: ${analytics.current.completedOrders}.`
        : `Завершённых заказов за выбранный период: ${analytics.current.completedOrders}.`,
      table: null,
    };
  }
  if (/average|medie|средн|ticket|чек/.test(text)) {
    return {
      text: analytics.current.averageOrderValue === null
        ? ro ? "Nu există comenzi finalizate cu preț calculabil în această perioadă." : "Нет завершённых заказов с рассчитываемой стоимостью за этот период."
        : ro
          ? `Valoarea medie a unei comenzi finalizate: ${money(analytics.current.averageOrderValue, language)}.`
          : `Средняя стоимость завершённого заказа: ${money(analytics.current.averageOrderValue, language)}.`,
      table: null,
    };
  }
  if (/expense|cheltu|затрат|расход/.test(text)) {
    return {
      text: ro
        ? `Cheltuieli operaționale: ${money(analytics.current.expenses, language)}; profit operațional: ${money(analytics.current.profit, language)}. Fondurile personale sunt excluse.`
        : `Операционные расходы: ${money(analytics.current.expenses, language)}; операционная прибыль: ${money(analytics.current.profit, language)}. Личные средства исключены.`,
      table: null,
    };
  }
  if (/compare|срав|compara|față de|versus/.test(text)) {
    return {
      text: ro
        ? `Venit ${money(analytics.current.revenue, language)} (${percentLabel(analytics.changes.revenue)}); cheltuieli ${money(analytics.current.expenses, language)} (${percentLabel(analytics.changes.expenses)}); profit ${money(analytics.current.profit, language)} (${percentLabel(analytics.changes.profit)}), față de perioada precedentă echivalentă.`
        : `Поступления ${money(analytics.current.revenue, language)} (${percentLabel(analytics.changes.revenue)}); расходы ${money(analytics.current.expenses, language)} (${percentLabel(analytics.changes.expenses)}); прибыль ${money(analytics.current.profit, language)} (${percentLabel(analytics.changes.profit)}) относительно предыдущего равного периода.`,
      table: null,
    };
  }
  if (/why|de ce|почему|причин/.test(text)) {
    return {
      text: ro
        ? `Venitul curent este ${money(analytics.current.revenue, language)} (${percentLabel(analytics.changes.revenue)}). CRM nu demonstrează cauza; compară plățile, comenzile și activitatea clienților înainte de a trage concluzii.`
        : `Поступления за период — ${money(analytics.current.revenue, language)} (${percentLabel(analytics.changes.revenue)}). Данные CRM сами по себе не доказывают причину; перед выводами сравните оплаты, заказы и активность клиентов.`,
      table: table(
        ro ? ["Indicator", "Valoare"] : ["Показатель", "Значение"],
        [
          [ro ? "Comenzi finalizate" : "Завершённые заказы", String(analytics.current.completedOrders)],
          [ro ? "Clienți noi" : "Новые клиенты", String(analytics.current.newClients)],
          [ro ? "Clienți reveniți" : "Вернувшиеся клиенты", String(analytics.current.returningClients)],
        ],
      ),
    };
  }
  if (/profit|profitabil|прибыл|venit|încas|incas|c[aâ]știg|castig|revenue|income|earn|заработ|выруч|доход|поступлен/.test(text)) {
    const asksProfit = /profit|profitabil|прибыл/.test(text);
    const current = asksProfit ? analytics.current.profit : analytics.current.revenue;
    const previous = asksProfit ? analytics.previous.profit : analytics.previous.revenue;
    const change = asksProfit ? analytics.changes.profit : analytics.changes.revenue;
    return {
      text: ro
        ? `${asksProfit ? "Profitul operațional" : "Venitul"} în perioada selectată (${analytics.range.from} — ${analytics.range.to}) este ${money(current, language)}; față de perioada precedentă: ${percentLabel(change)}.`
        : `${asksProfit ? "Операционная прибыль" : "Поступления"} за выбранный период (${analytics.range.from} — ${analytics.range.to}) — ${money(current, language)}; к предыдущему равному периоду: ${percentLabel(change)}.`,
      table: table(
        ro ? ["Perioadă", asksProfit ? "Profit" : "Venit"] : ["Период", asksProfit ? "Прибыль" : "Поступления"],
        [
          [ro ? "Selectată" : "Выбранный", money(current, language)],
          [ro ? "Precedentă" : "Предыдущий", money(previous, language)],
        ],
      ),
    };
  }
  return {
    text: ro
      ? "Nu pot răspunde cu încredere la această întrebare din indicatorii agregați disponibili. Încearcă să întrebi despre venituri, profit, cheltuieli, servicii, clienți sau comenzi."
      : "Не могу уверенно ответить на этот вопрос по доступным агрегированным показателям. Спросите о поступлениях, прибыли, расходах, услугах, клиентах или заказах.",
    table: null,
  };
}
