import test from "node:test";
import assert from "node:assert/strict";
import {
  advisorDateRange,
  advisorFactsForAi,
  answerAdvisorQuestion,
  buildAdvisorAnalytics,
  buildAdvisorInsights,
  buildAdvisorRecommendations,
  inferAdvisorQuestionPeriod,
} from "../app/lib/business-advisor.mjs";

test("advisor date presets compare the same elapsed part of today and week", () => {
  const now = new Date(2026, 10, 18, 14, 30);
  const today = advisorDateRange("today", "", "", now);
  const week = advisorDateRange("week", "", "", now);

  assert.equal(today.start.getDate(), 18);
  assert.equal(today.previousStart.getDate(), 17);
  assert.equal(today.previousEnd.getHours(), now.getHours());
  assert.equal(week.start.getDay(), 1);
  assert.equal(week.previousStart.getTime(), week.start.getTime() - 7 * 86400000);
  assert.equal(week.previousEnd.getTime(), now.getTime() - 7 * 86400000);
  assert.throws(() => advisorDateRange("custom", "2026-02-30", "2026-03-01", now), /корректные даты/);
});

test("advisor infers an explicitly named month and year from chat questions", () => {
  const now = new Date(2026, 10, 15, 12);

  assert.deepEqual(inferAdvisorQuestionPeriod("Сколько я заработал за август?", now), {
    period: "custom",
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.deepEqual(inferAdvisorQuestionPeriod("Care a fost venitul în martie 2025?", now), {
    period: "custom",
    from: "2025-03-01",
    to: "2025-03-31",
  });
  assert.deepEqual(inferAdvisorQuestionPeriod("Что было в феврале прошлого года?", now), {
    period: "custom",
    from: "2025-02-01",
    to: "2025-02-28",
  });
  assert.equal(inferAdvisorQuestionPeriod("Сравни поступления", now), null);

  const question = "Сколько я заработал за август?";
  const augustPeriod = inferAdvisorQuestionPeriod(question, now);
  const augustAnalytics = buildAdvisorAnalytics({
    incomes: [{ amount: 420, periodKey: "2026-08" }],
    expenses: [],
    orders: [],
    clients: [],
    customers: [],
    warehouse: [],
  }, augustPeriod, now);
  assert.match(answerAdvisorQuestion(augustAnalytics, question).text, /420/);
});

test("advisor metrics reuse CRM payment and operating-expense facts without personal funds", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [
      { id: "income-current", amount: 500, date: "2026-03-10", clientId: "visit-current" },
      { id: "income-previous", amount: 300, date: "2026-02-10", clientId: "visit-old" },
    ],
    expenses: [
      { id: "expense-current", amount: 100, date: "2026-03-12", category: "Материалы" },
      { id: "personal-current", amount: 900, date: "2026-03-13", source: "Личные средства" },
    ],
    orders: [{
      id: "order-1",
      bookingId: "visit-current",
      customerId: "customer-1",
      status: "Выдан клиенту",
      createdAt: "2026-03-10",
      history: [{ status: "Выдан клиенту", at: "2026-03-15" }],
      services: [{ name: "Полировка", price: 600 }],
    }],
    clients: [
      { id: "visit-current", customerId: "customer-1", service: "Полировка", status: "Выполнено", datetime: "2026-03-15" },
      { id: "visit-old", customerId: "customer-1", service: "Полировка", status: "Выполнено", datetime: "2026-02-01" },
      { id: "visit-dormant", customerId: "customer-dormant", service: "Мойка", status: "Выполнено", datetime: "2026-01-01" },
      { id: "visit-future", customerId: "customer-dormant", status: "Подтверждена", datetime: "2026-04-01" },
      { id: "visit-stale", customerId: "customer-stale", service: "Мойка", status: "Выполнено", datetime: "2026-01-01" },
    ],
    customers: [
      { id: "customer-1", name: "Мария", createdAt: "2025-01-01" },
      { id: "customer-new", name: "Ирина", createdAt: "2026-03-04" },
      { id: "customer-dormant", name: "Ольга", createdAt: "2025-01-01" },
      { id: "customer-stale", name: "Анна", createdAt: "2025-01-01" },
    ],
    warehouse: [{ id: "wax", name: "Воск", qty: 1, minQty: 2 }],
  };
  const analytics = buildAdvisorAnalytics(db, { period: "month" }, now);

  assert.equal(analytics.current.revenue, 500);
  assert.equal(analytics.current.expenses, 100);
  assert.equal(analytics.current.profit, 400);
  assert.equal(analytics.current.completedOrders, 1);
  assert.equal(analytics.current.averageOrderValue, 600);
  assert.equal(analytics.current.averageClientSpend, 500);
  assert.equal(analytics.current.payingClients, 1);
  assert.equal(analytics.current.newClients, 1);
  assert.equal(analytics.current.returningClients, 1);
  assert.equal(analytics.services[0].visits, 1);
  assert.equal(analytics.services[0].revenue, 600);
  assert.equal(analytics.services[0].previousVisits, 1);
  assert.equal(analytics.services[0].changePercent, 0);
  assert.equal(analytics.series.reduce((count, item) => count + item.completedOrders, 0), 1);
  assert.equal(analytics.topClients[0].name, "Мария");
  assert.equal(analytics.inactiveClients.length, 1);
  assert.equal(analytics.inactiveClients[0].id, "customer-stale");
});

test("advisor calculates linked client spending and compares expense categories without personal funds", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [
      { amount: 100, date: "2026-03-10", customerId: "customer-1" },
      { amount: 200, date: "2026-03-11", customerId: "customer-1" },
      { amount: 900, date: "2026-03-12" },
    ],
    expenses: [
      { amount: 100, date: "2026-03-12", category: "Материалы" },
      { amount: 50, date: "2026-02-12", category: "Материалы" },
      { amount: 700, date: "2026-03-13", category: "Материалы", source: "Личные средства" },
    ],
    clients: [],
    customers: [{ id: "customer-1", name: "Мария" }],
    orders: [],
    warehouse: [],
  };
  const analytics = buildAdvisorAnalytics(db, { period: "month" }, now);

  assert.equal(analytics.current.revenue, 1200);
  assert.equal(analytics.current.averageClientSpend, 300);
  assert.equal(analytics.current.payingClients, 1);
  assert.deepEqual(analytics.expenseCategories[0], {
    name: "Материалы",
    amount: 100,
    count: 1,
    previousAmount: 50,
    previousCount: 1,
    changePercent: 100,
  });
  assert.match(answerAdvisorQuestion(analytics, "средние траты клиента", "ru").text, /300/);
  assert.match(answerAdvisorQuestion(analytics, "Cât cheltuiește în medie un client?", "ro").text, /300/);
});

test("advisor follows CRM financial periods when transaction dates differ or are legacy month-only", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [
      { amount: 100, date: "2026-03-15", periodKey: "2026-02", customerId: "customer-1" },
      { amount: 50, month: "Февраль", year: 2026, customerId: "customer-1" },
    ],
    expenses: [
      { amount: 20, date: "2026-03-16", periodKey: "2026-02", category: "Материалы" },
      { amount: 10, month: "Февраль", year: 2026, category: "Материалы" },
    ],
    clients: [],
    customers: [{ id: "customer-1", name: "Мария" }],
    orders: [],
    warehouse: [],
  };
  const february = buildAdvisorAnalytics(db, {
    period: "custom",
    from: "2026-02-01",
    to: "2026-02-28",
  }, now);
  const march = buildAdvisorAnalytics(db, {
    period: "custom",
    from: "2026-03-01",
    to: "2026-03-31",
  }, now);

  assert.equal(february.current.revenue, 150);
  assert.equal(february.current.expenses, 30);
  assert.equal(february.current.profit, 120);
  assert.equal(february.current.averageClientSpend, 150);
  assert.equal(february.expenseCategories[0].amount, 30);
  assert.equal(february.series.reduce((total, item) => total + item.revenue, 0), 150);
  assert.equal(march.current.revenue, 0);
  assert.equal(march.current.expenses, 0);
});

test("advisor answers data-source and best-month questions from CRM facts", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [
      { amount: 100, periodKey: "2026-01" },
      { amount: 300, periodKey: "2026-02" },
    ],
    expenses: [{ amount: 50, periodKey: "2026-02", category: "Материалы" }],
    clients: [],
    customers: [],
    orders: [],
    warehouse: [],
  };
  const analytics = buildAdvisorAnalytics(db, { period: "month" }, now);

  const sourceAnswer = answerAdvisorQuestion(analytics, "Откуда ты берёшь информацию?", "ru");
  assert.match(sourceAnswer.text, /записей CRM/);
  assert.match(JSON.stringify(sourceAnswer.table), /2026-01/);
  const productiveMonth = answerAdvisorQuestion(analytics, "Care lună a fost cea mai productivă?", "ro");
  assert.match(productiveMonth.text, /februarie 2026/i);
  assert.match(JSON.stringify(productiveMonth.table), /300/);
  assert.match(answerAdvisorQuestion(analytics, "что нового?", "ru").text, /Не могу уверенно ответить/);
});

test("advisor insights and recommendation statuses are evidence-backed and persistent", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [
      ...Array.from({ length: 5 }, (_, index) => ({ amount: 100, date: `2026-03-${String(index + 1).padStart(2, "0")}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ amount: 200, date: `2026-02-${String(index + 1).padStart(2, "0")}` })),
    ],
    expenses: [],
    clients: [],
    customers: [],
    orders: [],
    warehouse: [],
  };
  const analytics = buildAdvisorAnalytics(db, { period: "month" }, now);
  const insights = buildAdvisorInsights(analytics, db, now);
  const revenueInsight = insights.find((item) => item.id === "revenue-change");
  assert.ok(revenueInsight);
  assert.equal(revenueInsight.facts.changePercent, -50);

  const initial = buildAdvisorRecommendations([], insights, now);
  const inProgress = initial.map((item) =>
    item.key === revenueInsight.key ? { ...item, status: "in_progress" } : item,
  );
  const refreshed = buildAdvisorRecommendations(inProgress, insights, new Date("2026-03-21T12:00:00Z"));
  assert.equal(refreshed.find((item) => item.key === revenueInsight.key).status, "in_progress");
});

test("advisor answers facts from CRM and sends no client identity in AI evidence", () => {
  const now = new Date(2026, 2, 20, 12);
  const db = {
    incomes: [{ amount: 750, date: "2026-03-10", clientId: "visit-1" }],
    expenses: [],
    orders: [],
    clients: [],
    customers: [{ id: "customer-1", name: "Confidential Name", createdAt: "2026-03-01" }],
    warehouse: [],
  };
  const analytics = buildAdvisorAnalytics(db, { period: "month" }, now);
  const factAnswer = answerAdvisorQuestion(analytics, "сколько прибыль", "ru");
  const aiFacts = advisorFactsForAi(analytics, []);

  assert.match(factAnswer.text, /750/);
  assert.equal(JSON.stringify(aiFacts).includes("Confidential Name"), false);
  assert.equal(JSON.stringify(aiFacts).includes("visit-1"), false);
});
