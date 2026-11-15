import test from "node:test";
import assert from "node:assert/strict";
import {
  advisorDateRange,
  advisorFactsForAi,
  answerAdvisorQuestion,
  buildAdvisorAnalytics,
  buildAdvisorInsights,
  buildAdvisorRecommendations,
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
  assert.equal(analytics.current.newClients, 1);
  assert.equal(analytics.current.returningClients, 1);
  assert.equal(analytics.services[0].visits, 1);
  assert.equal(analytics.services[0].revenue, 600);
  assert.equal(analytics.topClients[0].name, "Мария");
  assert.equal(analytics.inactiveClients.length, 1);
  assert.equal(analytics.inactiveClients[0].id, "customer-stale");
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
