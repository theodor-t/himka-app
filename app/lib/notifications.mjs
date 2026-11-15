import { amountToCents, parseRecordDate, sumAmounts } from "./finance.mjs";
import { orderBalanceCents } from "./work-orders.mjs";

const CLOSED_APPOINTMENT_STATUSES = new Set(["Отменен", "Не пришел", "Выполнено"]);
const CLOSED_ORDER_STATUSES = new Set(["Завершён", "Выдан клиенту", "Отменён"]);
const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function formattedDate(value) {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "дата не указана";
}

function daysBetween(currentTime, value) {
  const time = parseRecordDate(value)?.getTime();
  return Number.isFinite(time) ? Math.floor((currentTime - time) / DAY) : null;
}

function candidate({
  id,
  dedupeKey,
  kind,
  category,
  priority,
  title,
  message,
  explanation,
  recommendation,
  page,
  related,
  detectedAt,
  facts,
}) {
  return {
    id,
    dedupeKey: dedupeKey || id,
    kind,
    category,
    priority,
    title,
    message,
    explanation,
    recommendation,
    page,
    related: related || null,
    detectedAt: detectedAt || "",
    facts: facts || {},
    fingerprint: JSON.stringify(facts || {}),
  };
}

export function buildSystemNotifications(db, now = new Date()) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const nextDay = currentTime + DAY;
  const notifications = [];
  const clients = Array.isArray(db?.clients) ? db.clients : [];
  const orders = Array.isArray(db?.orders) ? db.orders : [];
  const warehouse = Array.isArray(db?.warehouse) ? db.warehouse : [];

  clients.forEach((booking) => {
    const time = parseRecordDate(booking.datetime)?.getTime();
    if (
      Number.isFinite(time) &&
      time >= currentTime &&
      time <= nextDay &&
      !CLOSED_APPOINTMENT_STATUSES.has(booking.status)
    ) {
      const hasOrder = orders.some(
        (order) => String(order.bookingId) === String(booking.id),
      );
      notifications.push(candidate({
        id: `system:appointment:${booking.id}`,
        kind: "appointment",
        category: "appointments",
        priority: "medium",
        title: hasOrder ? "Скоро запись клиента" : "Скоро запись без рабочего заказа",
        message: `${booking.car || "Автомобиль"} · ${formattedDate(booking.datetime)}${booking.service ? ` · ${booking.service}` : ""}`,
        explanation: hasOrder
          ? "Запись начнётся в ближайшие 24 часа."
          : "Запись начнётся в ближайшие 24 часа, но связанный рабочий заказ ещё не найден.",
        recommendation: hasOrder
          ? "Проверьте подготовку рабочего места и подтверждение записи."
          : "Проверьте, нужно ли подготовить заказ к приёму автомобиля.",
        page: "calendar",
        related: { type: "appointment", id: booking.id },
        detectedAt: booking.datetime,
        facts: {
          hoursUntil: Math.max(0, Math.round((time - currentTime) / 3600000)),
          hasOrder,
        },
      }));
    }
  });

  const serviceDurations = new Map(
    (Array.isArray(db?.services) ? db.services : [])
      .map((service) => [String(service.name || "").trim().toLocaleLowerCase("ru"), Number(service.duration)])
      .filter(([name, duration]) => name && Number.isFinite(duration) && duration > 0),
  );
  const timedBookings = clients
    .filter((booking) => !CLOSED_APPOINTMENT_STATUSES.has(booking.status))
    .map((booking) => ({
      booking,
      start: parseRecordDate(booking.datetime)?.getTime(),
      duration: serviceDurations.get(String(booking.service || "").trim().toLocaleLowerCase("ru")),
    }))
    .filter((entry) =>
      Number.isFinite(entry.start) &&
      entry.start >= currentTime &&
      Number.isFinite(entry.duration),
    );
  timedBookings.forEach((first, index) => {
    timedBookings.slice(index + 1).forEach((second) => {
      if (first.start + first.duration * 60000 <= second.start ||
          second.start + second.duration * 60000 <= first.start) return;
      const ids = [String(first.booking.id), String(second.booking.id)].sort();
      const overlapMinutes = Math.round(
        (Math.min(first.start + first.duration * 60000, second.start + second.duration * 60000) -
          Math.max(first.start, second.start)) / 60000,
      );
      notifications.push(candidate({
        id: `smart:appointment-overlap:${ids.join(":")}`,
        kind: "appointment-overlap",
        category: "appointments",
        priority: "high",
        title: "Пересечение записей в календаре",
        message: `${formattedDate(first.booking.datetime)} · пересечение около ${overlapMinutes} мин.`,
        explanation: "Интервалы двух будущих записей перекрываются по длительности услуг из каталога.",
        recommendation: "Проверьте календарь и при необходимости согласуйте другое время.",
        page: "calendar",
        related: { type: "appointment", id: first.booking.id },
        detectedAt: first.booking.datetime,
        facts: { overlapMinutes },
      }));
    });
  });

  warehouse.forEach((item) => {
    if (item.qty === "" || item.qty == null) return;
    const quantity = Number(item.qty);
    const minimum = Number(item.minQty ?? 2);
    if (Number.isFinite(quantity) && Number.isFinite(minimum) && quantity <= minimum) {
      notifications.push(candidate({
        id: `system:low-stock:${item.id}`,
        kind: "low-stock",
        category: "inventory",
        priority: quantity <= 0 ? "critical" : "high",
        title: quantity <= 0 ? "Товар закончился" : "Остаток достиг минимума",
        message: `${item.name}: ${quantity} шт. (минимум ${minimum} шт.)`,
        explanation: quantity <= 0
          ? "Текущий остаток равен нулю."
          : "Количество товара достигло установленного минимального остатка.",
        recommendation: "Проверьте потребность и при необходимости оформите пополнение.",
        page: "warehouse",
        related: { type: "inventory", id: item.id },
        facts: { quantity, minimum },
      }));
    }
  });

  orders.forEach((order) => {
    const completionTime = parseRecordDate(order.plannedCompletion)?.getTime();
    if (
      Number.isFinite(completionTime) &&
      completionTime < currentTime &&
      !CLOSED_ORDER_STATUSES.has(order.status)
    ) {
      const daysLate = Math.max(0, Math.floor((currentTime - completionTime) / DAY));
      notifications.push(candidate({
        id: `system:overdue-order:${order.id}`,
        kind: "overdue-order",
        category: "orders",
        priority: daysLate >= 3 ? "high" : "medium",
        title: "Просрочен срок заказа",
        message: `${order.number || "Заказ"} · ${order.car || "Автомобиль"} · срок ${formattedDate(order.plannedCompletion)}`,
        explanation: `Плановый срок заказа прошёл ${daysLate} дн. назад, а заказ ещё не закрыт.`,
        recommendation: "Проверьте текущий этап и обновите клиента при необходимости.",
        page: "orders",
        related: { type: "order", id: order.id },
        detectedAt: order.plannedCompletion,
        facts: { daysLate, status: order.status || "не указан" },
      }));
    }

    if (order.status === "Завершён") {
      const balanceCents = orderBalanceCents(db?.incomes || [], order);
      if (balanceCents > 0) {
        notifications.push(candidate({
          id: `smart:unpaid-order:${order.id}`,
          kind: "unpaid-order",
          category: "finance",
          priority: "high",
          title: "У завершённого заказа есть остаток к оплате",
          message: `${order.number || "Заказ"} · ${Math.round(balanceCents / 100).toLocaleString("ru-RU")} MDL`,
          explanation: "Заказ отмечен как завершённый, но расчёт по существующим платежам показывает непогашенный остаток.",
          recommendation: "Сверьте заказ и платежи перед изменением финансовых данных.",
          page: "orders",
          related: { type: "order", id: order.id },
          facts: { balanceCents },
        }));
      }
    }
  });

  const completedVisitsByCustomer = new Map();
  const completedVisitsByVehicle = new Map();
  const futureBookingsByCustomer = new Set();
  clients.forEach((visit) => {
    const key = String(visit.customerId || "");
    if (!key) return;
    const time = parseRecordDate(visit.datetime)?.getTime();
    if (time > currentTime && !CLOSED_APPOINTMENT_STATUSES.has(visit.status)) {
      futureBookingsByCustomer.add(key);
    }
    if (visit.status !== "Выполнено" || !Number.isFinite(time) || time > currentTime) return;
    const visits = completedVisitsByCustomer.get(key) || [];
    visits.push(visit);
    completedVisitsByCustomer.set(key, visits);
    if (visit.vehicleId) {
      const vehicleVisits = completedVisitsByVehicle.get(String(visit.vehicleId)) || [];
      vehicleVisits.push(visit);
      completedVisitsByVehicle.set(String(visit.vehicleId), vehicleVisits);
    }
  });

  const customers = Array.isArray(db?.customers) ? db.customers : [];
  customers.forEach((customer) => {
    const key = String(customer.id || "");
    if (!key || futureBookingsByCustomer.has(key)) return;
    const visits = completedVisitsByCustomer.get(key) || [];
    if (!visits.length) {
      const daysSinceRegistration = daysBetween(currentTime, customer.createdAt);
      if (daysSinceRegistration >= 7) {
        notifications.push(candidate({
          id: `smart:new-client-no-appointment:${key}`,
          kind: "new-client-no-appointment",
          category: "clients",
          priority: "low",
          title: "Новый клиент ещё не записан",
          message: `Регистрация была ${daysSinceRegistration} дн. назад; в истории нет визитов.`,
          explanation: "У клиента есть дата регистрации, но пока нет связанной истории обслуживания или будущей записи.",
          recommendation: "Проверьте, нужна ли помощь с выбором услуги или времени.",
          page: "customers",
          related: { type: "customer", id: customer.id },
          detectedAt: customer.createdAt,
          facts: { daysSinceRegistration },
        }));
      }
      return;
    }
    if (visits.length < 2) return;
    const lastVisit = visits.reduce((latest, visit) => {
      const time = parseRecordDate(visit.datetime)?.getTime();
      return Number.isFinite(time) && time > latest ? time : latest;
    }, 0);
    const daysSinceVisit = Math.floor((currentTime - lastVisit) / DAY);
    if (daysSinceVisit >= 60) {
      notifications.push(candidate({
        id: `smart:inactive-client:${key}`,
        kind: "inactive-client",
        category: "clients",
        priority: daysSinceVisit >= 90 ? "high" : "medium",
        title: "Постоянный клиент давно не приезжал",
        message: `Последний завершённый визит был ${daysSinceVisit} дн. назад.`,
        explanation: `В истории клиента есть ${visits.length} завершённых визита, последний — более 60 дней назад.`,
        recommendation: "Проверьте историю общения и при необходимости предложите удобное время для визита.",
        page: "customers",
        related: { type: "customer", id: customer.id },
        detectedAt: new Date(lastVisit).toISOString(),
        facts: { daysSinceVisit, completedVisits: visits.length },
      }));
    }

  });

  const vehiclesByCustomer = new Map();
  (Array.isArray(db?.vehicles) ? db.vehicles : [])
    .filter((vehicle) => !vehicle.archived && vehicle.customerId)
    .forEach((vehicle) => {
      const key = String(vehicle.customerId);
      const vehicles = vehiclesByCustomer.get(key) || [];
      vehicles.push(vehicle);
      vehiclesByCustomer.set(key, vehicles);
    });
  vehiclesByCustomer.forEach((vehicles, customerId) => {
    if (vehicles.length < 2) return;
    const withHistory = vehicles.filter((vehicle) =>
      (completedVisitsByVehicle.get(String(vehicle.id)) || []).length > 0,
    );
    const withoutHistory = vehicles.length - withHistory.length;
    if (!withHistory.length || withoutHistory < 1) return;
    notifications.push(candidate({
      id: `smart:vehicle-history-gap:${customerId}`,
      kind: "vehicle-history-gap",
      category: "clients",
      priority: "low",
      title: "История обслуживания заполнена не для всех автомобилей",
      message: `У клиента ${vehicles.length} активных автомобиля; визиты есть для ${withHistory.length}.`,
      explanation: "Связанные записи показывают историю обслуживания хотя бы одного автомобиля, но не всех.",
      recommendation: "Проверьте, обслуживались ли остальные автомобили и правильно ли связаны записи.",
      page: "customers",
      related: { type: "customer", id: customerId },
      facts: { vehicleCount: vehicles.length, vehiclesWithHistory: withHistory.length },
    }));
  });

  const completedVisits = clients.filter((visit) => visit.status === "Выполнено");
  const last30Days = completedVisits.filter((visit) => {
    const time = parseRecordDate(visit.datetime)?.getTime();
    return Number.isFinite(time) && time >= currentTime - 30 * DAY && time <= currentTime;
  }).length;
  const previous30Days = completedVisits.filter((visit) => {
    const time = parseRecordDate(visit.datetime)?.getTime();
    return Number.isFinite(time) && time >= currentTime - 60 * DAY && time < currentTime - 30 * DAY;
  }).length;
  if (last30Days >= 5 && previous30Days >= 5) {
    const changePercent = Math.round(((last30Days - previous30Days) / previous30Days) * 100);
    if (Math.abs(changePercent) >= 30) {
      const trend = changePercent > 0 ? "увеличилось" : "снизилось";
      notifications.push(candidate({
        id: "smart:completed-visits-trend",
        kind: "activity-trend",
        category: "ai-insights",
        priority: "medium",
        title: `Число завершённых визитов ${trend}`,
        message: `${last30Days} за последние 30 дней против ${previous30Days} в предыдущие 30 дней (${Math.abs(changePercent)}%).`,
        explanation: "Сравнение основано на записях со статусом «Выполнено» и только при наличии не менее пяти записей в каждом периоде.",
        recommendation: "Проверьте расписание и полноту внесённых данных, прежде чем менять операционные планы.",
        page: "analytics",
        detectedAt: new Date(currentTime).toISOString(),
        facts: { last30Days, previous30Days, changePercent },
      }));
    }

    const customersRegisteredRecently = customers.filter((customer) => {
      const time = parseRecordDate(customer.createdAt)?.getTime();
      return Number.isFinite(time) && time >= currentTime - 30 * DAY && time <= currentTime;
    }).length;
    const customersRegisteredPreviously = customers.filter((customer) => {
      const time = parseRecordDate(customer.createdAt)?.getTime();
      return Number.isFinite(time) && time >= currentTime - 60 * DAY && time < currentTime - 30 * DAY;
    }).length;
    if (customersRegisteredRecently >= 5 && customersRegisteredPreviously >= 5) {
      const changePercent = Math.round(
        ((customersRegisteredRecently - customersRegisteredPreviously) / customersRegisteredPreviously) * 100,
      );
      if (changePercent <= -30) {
        notifications.push(candidate({
          id: "smart:new-client-trend",
          kind: "new-client-trend",
          category: "ai-insights",
          priority: "medium",
          title: "Новых регистраций стало меньше",
          message: `${customersRegisteredRecently} за последние 30 дней против ${customersRegisteredPreviously} в предыдущие 30 дней.`,
          explanation: "Сравнение учитывает только клиентские записи с датой регистрации и не менее пяти записей в каждом периоде.",
          recommendation: "Проверьте полноту регистрации и внешние факторы, прежде чем менять маркетинговый план.",
          page: "analytics",
          facts: { currentClients: customersRegisteredRecently, previousClients: customersRegisteredPreviously, changePercent },
        }));
      }
    }

    const completedVisitsByService = new Map();
    completedVisits.forEach((visit) => {
      const service = String(visit.service || "").trim();
      const time = parseRecordDate(visit.datetime)?.getTime();
      if (!service || !Number.isFinite(time)) return;
      const counts = completedVisitsByService.get(service) || { current: 0, previous: 0 };
      if (time >= currentTime - 30 * DAY && time <= currentTime) counts.current += 1;
      if (time >= currentTime - 60 * DAY && time < currentTime - 30 * DAY) counts.previous += 1;
      completedVisitsByService.set(service, counts);
    });
    const serviceTrends = [...completedVisitsByService.entries()]
      .map(([service, counts]) => ({
        service,
        ...counts,
        changePercent: counts.previous
          ? Math.round(((counts.current - counts.previous) / counts.previous) * 100)
          : 0,
      }))
      .filter((item) =>
        item.current >= 5 &&
        item.previous >= 5 &&
        Math.abs(item.changePercent) >= 40,
      )
      .sort((first, second) =>
        Math.abs(second.changePercent) - Math.abs(first.changePercent),
      );
    const serviceTrend = serviceTrends[0];
    if (serviceTrend) {
      notifications.push(candidate({
        id: `smart:service-demand-trend:${serviceTrend.service.toLocaleLowerCase("ru")}`,
        kind: "service-demand-trend",
        category: "ai-insights",
        priority: "medium",
        title: serviceTrend.changePercent > 0 ? "Услуга стала заметно популярнее" : "Спрос на услугу снизился",
        message: `${serviceTrend.service}: ${serviceTrend.current} завершённых визитов за 30 дней против ${serviceTrend.previous} ранее (${Math.abs(serviceTrend.changePercent)}%).`,
        explanation: "Сравнение выполнено по завершённым визитам с одинаковым названием услуги и достаточным числом записей в обоих периодах.",
        recommendation: "Проверьте расписание и наличие ресурсов для услуги; изменение спроса не объясняет его причину.",
        page: "analytics",
        facts: {
          currentServiceVisits: serviceTrend.current,
          previousServiceVisits: serviceTrend.previous,
          changePercent: serviceTrend.changePercent,
        },
      }));
    }
  }

  const incomes = Array.isArray(db?.incomes) ? db.incomes : [];
  const currentIncomeRecords = incomes.filter((item) => {
    const time = parseRecordDate(item.date || item.datetime)?.getTime();
    return Number.isFinite(time) && time >= currentTime - 30 * DAY && time <= currentTime;
  });
  const previousIncomeRecords = incomes.filter((item) => {
    const time = parseRecordDate(item.date || item.datetime)?.getTime();
    return Number.isFinite(time) && time >= currentTime - 60 * DAY && time < currentTime - 30 * DAY;
  });
  if (currentIncomeRecords.length >= 5 && previousIncomeRecords.length >= 5) {
    const currentCents = amountToCents(sumAmounts(currentIncomeRecords));
    const previousCents = amountToCents(sumAmounts(previousIncomeRecords));
    const dropPercent = previousCents > 0
      ? Math.round(((previousCents - currentCents) / previousCents) * 100)
      : 0;
    if (currentCents >= 0 && dropPercent >= 30) {
      notifications.push(candidate({
        id: "smart:incoming-payments-trend",
        kind: "income-trend",
        category: "finance",
        priority: "medium",
        title: "Поступления снизились относительно предыдущего периода",
        message: `${currentIncomeRecords.length} записей о поступлениях за последние 30 дней; сумма ниже на ${dropPercent}%.`,
        explanation: "Сравнение использует текущие записи доходов и одинаковые 30-дневные периоды; при неполных периодах сигнал не создаётся.",
        recommendation: "Сверьте полноту внесённых поступлений и календарный контекст. Сигнал не заменяет проверку финансовых записей.",
        page: "profit",
        facts: {
          currentRevenueCents: currentCents,
          previousRevenueCents: previousCents,
          dropPercent,
        },
      }));
    }
  }

  const expenses = Array.isArray(db?.expenses) ? db.expenses : [];
  const currentExpenseRecords = expenses.filter((item) => {
    const time = parseRecordDate(item.date || item.datetime)?.getTime();
    return item.source !== "Личные средства" &&
      Number.isFinite(time) && time >= currentTime - 30 * DAY && time <= currentTime;
  });
  const previousExpenseRecords = expenses.filter((item) => {
    const time = parseRecordDate(item.date || item.datetime)?.getTime();
    return item.source !== "Личные средства" &&
      Number.isFinite(time) && time >= currentTime - 60 * DAY && time < currentTime - 30 * DAY;
  });
  if (currentExpenseRecords.length >= 5 && previousExpenseRecords.length >= 5) {
    const currentCents = amountToCents(sumAmounts(currentExpenseRecords));
    const previousCents = amountToCents(sumAmounts(previousExpenseRecords));
    const increasePercent = previousCents > 0
      ? Math.round(((currentCents - previousCents) / previousCents) * 100)
      : 0;
    if (previousCents > 0 && currentCents >= previousCents * 1.4) {
      notifications.push(candidate({
        id: "smart:operating-expenses-trend",
        kind: "expense-trend",
        category: "finance",
        priority: "high",
        title: "Операционные расходы заметно выросли",
        message: `${currentExpenseRecords.length} записей за последние 30 дней; сумма выше на ${increasePercent}% относительно предыдущих 30 дней.`,
        explanation: "Сравнение включает только операционные расходы, исключает личные средства и требует не менее пяти записей в каждом равном периоде.",
        recommendation: "Сверьте категории расходов и правильность записей; сигнал сам по себе не устанавливает причину роста.",
        page: "expenses",
        detectedAt: new Date(currentTime).toISOString(),
        facts: { currentExpenseCents: currentCents, previousExpenseCents: previousCents, increasePercent },
      }));
    }
  }

  return notifications.sort((first, second) =>
    PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority] ||
    (parseRecordDate(first.detectedAt)?.getTime() || 0) -
      (parseRecordDate(second.detectedAt)?.getTime() || 0),
  );
}

function isSmartNotification(item) {
  return Boolean(item && item.smart === true && item.dedupeKey);
}

export function reconcileSmartNotifications(existingNotifications, candidates, now = new Date()) {
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const existing = Array.isArray(existingNotifications) ? existingNotifications : [];
  const activeByKey = new Map();
  existing.forEach((item) => {
    if (isSmartNotification(item) && item.status === "active") {
      const current = activeByKey.get(item.dedupeKey);
      if (!current || String(item.updatedAt) > String(current.updatedAt)) {
        activeByKey.set(item.dedupeKey, item);
      }
    }
  });

  const currentKeys = new Set();
  const updates = [];
  candidates.forEach((item) => {
    const key = item.dedupeKey || item.id;
    currentKeys.add(key);
    const current = activeByKey.get(key);
    if (!current) {
      const legacyReceipt = existing.find((receipt) =>
        receipt.id === item.id && receipt.kind === "system" && receipt.readAt,
      );
      updates.push({
        ...item,
        id: `${item.id}:${new Date(timestamp).getTime()}`,
        smart: true,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        readBy: {},
        archivedBy: [],
        dismissedBy: [],
        legacyReadAt: legacyReceipt?.readAt || "",
        aiExplanation: "",
        aiRecommendation: "",
        aiFingerprint: "",
        aiGenerated: false,
      });
      return;
    }

    const materiallyChanged = current.fingerprint !== item.fingerprint;
    updates.push({
      ...current,
      ...item,
      id: current.id,
      smart: true,
      status: "active",
      updatedAt: materiallyChanged ? timestamp : current.updatedAt,
      readBy: materiallyChanged ? {} : current.readBy || {},
      archivedBy: materiallyChanged ? [] : current.archivedBy || [],
      dismissedBy: materiallyChanged ? [] : current.dismissedBy || [],
      aiExplanation: materiallyChanged ? "" : current.aiExplanation || "",
      aiRecommendation: materiallyChanged ? "" : current.aiRecommendation || "",
      aiFingerprint: materiallyChanged ? "" : current.aiFingerprint || "",
      aiGenerated: materiallyChanged ? false : Boolean(current.aiGenerated),
      createdAt: current.createdAt || timestamp,
    });
  });

  const smart = existing.filter(isSmartNotification);
  const canonicalActiveIds = new Set(
    [...activeByKey.values()].map((item) => item.id),
  );
  const resolved = smart
    .filter((item) =>
      item.status === "active" &&
      canonicalActiveIds.has(item.id) &&
      !currentKeys.has(item.dedupeKey),
    )
    .map((item) => ({ ...item, status: "resolved", resolvedAt: timestamp, updatedAt: timestamp }));
  const byId = new Map();
  existing.filter((item) => !isSmartNotification(item)).forEach((item) => byId.set(item.id, item));
  const retentionCutoff = new Date(timestamp).getTime() - 180 * DAY;
  smart.filter((item) => {
    if (item.status === "active") {
      return canonicalActiveIds.has(item.id) && currentKeys.has(item.dedupeKey);
    }
    if (item.status === "resolved" && item.resolvedAt) {
      const resolvedTime = parseRecordDate(item.resolvedAt)?.getTime();
      if (Number.isFinite(resolvedTime) && resolvedTime < retentionCutoff) return false;
    }
    return true;
  })
    .forEach((item) => byId.set(item.id, item));
  resolved.forEach((item) => byId.set(item.id, item));
  updates.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

export function notificationState(notification, username) {
  const user = String(username || "");
  const dismissed = notification?.dismissedBy || {};
  const archived = notification?.archivedBy || {};
  const readBy = notification?.readBy || {};
  return {
    read: Boolean(readBy[user] || notification?.legacyReadAt),
    archived: Boolean(archived[user]),
    dismissed: Boolean(dismissed[user]),
  };
}

export function unreadNotificationCount(notifications, username) {
  return (Array.isArray(notifications) ? notifications : []).filter((item) =>
    isSmartNotification(item) &&
    item.status === "active" &&
    !notificationState(item, username).read &&
    !notificationState(item, username).archived &&
    !notificationState(item, username).dismissed,
  ).length;
}

export function updateNotificationUserState(notification, username, field, value) {
  if (!isSmartNotification(notification) || !username) return notification;
  const timestamp = value === null ? "" : value || new Date().toISOString();
  if (field === "readBy") {
    return { ...notification, readBy: { ...(notification.readBy || {}), [username]: timestamp } };
  }
  if (field === "archivedBy" || field === "dismissedBy") {
    const state = { ...(notification[field] || {}) };
    if (value === null) delete state[username];
    else state[username] = timestamp;
    return {
      ...notification,
      [field]: state,
    };
  }
  throw new Error("Unsupported notification state");
}

export function updateNotificationPreferences(preferences, username, changes) {
  const current = (Array.isArray(preferences) ? preferences : [])
    .find((item) => item.username === username);
  const next = {
    id: current?.id || `notification-preferences:${username}`,
    username,
    ...current,
    ...changes,
    categories: Array.isArray(changes.categories)
      ? changes.categories
      : Array.isArray(current?.categories)
        ? current.categories
        : ["clients", "appointments", "orders", "finance", "inventory", "employees", "ai-insights", "system"],
    priorities: Array.isArray(changes.priorities)
      ? changes.priorities
      : Array.isArray(current?.priorities)
        ? current.priorities
        : ["critical", "high", "medium", "low"],
    inApp: changes.inApp ?? current?.inApp ?? true,
    dailyDigest: changes.dailyDigest ?? current?.dailyDigest ?? false,
    quietHours: {
      enabled: changes.quietHours?.enabled ?? current?.quietHours?.enabled ?? false,
      start: changes.quietHours?.start || current?.quietHours?.start || "22:00",
      end: changes.quietHours?.end || current?.quietHours?.end || "08:00",
    },
  };
  return [
    ...(Array.isArray(preferences) ? preferences : []).filter((item) => item.username !== username),
    next,
  ];
}

export function unreadSystemNotificationCount(notifications, receipts) {
  const readIds = new Set(
    receipts.filter((receipt) => receipt.readAt).map((receipt) => receipt.id),
  );
  return notifications.filter((notification) => !readIds.has(notification.id)).length;
}

export function systemNotificationReceipts(notifications, existingReceipts, readAt) {
  const byId = new Map(existingReceipts.map((receipt) => [receipt.id, receipt]));
  notifications.forEach((notification) => {
    const current = byId.get(notification.id);
    if (!current?.readAt) {
      byId.set(notification.id, {
        id: notification.id,
        kind: "system",
        readAt,
      });
    }
  });
  return [...byId.values()];
}
