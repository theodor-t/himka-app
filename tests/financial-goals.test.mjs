import test from "node:test";
import assert from "node:assert/strict";
import {
  financialPeriodTotals,
  previousPeriodKey,
  summarizeFinancialGoal,
} from "../app/lib/financial-goals.mjs";

test("previous period handles year boundaries", () => {
  assert.equal(previousPeriodKey("2026-01"), "2025-12");
});

test("period totals exclude personal funds from operating expenses", () => {
  const result = financialPeriodTotals(
    [{ periodKey: "2026-11", amount: 150 }],
    [
      { periodKey: "2026-11", amount: 40 },
      { periodKey: "2026-11", amount: 20, source: "Личные средства" },
    ],
    "2026-11",
  );
  assert.deepEqual(result, { income: 150, expense: 40, profit: 110 });
});

test("monthly goal calculates progress, remaining balance and daily pace in cents", () => {
  const summary = summarizeFinancialGoal(
    { periodKey: "2026-10", target: 1000 },
    [{ periodKey: "2026-10", amount: 250 }, { periodKey: "2026-09", amount: 200 }],
    [{ periodKey: "2026-10", amount: 80 }],
    new Date(2026, 9, 21),
  );
  assert.equal(summary.progressPercent, 25);
  assert.equal(summary.remaining, 750);
  assert.equal(summary.requiredPerDay, 68.19);
  assert.equal(summary.profit, 170);
  assert.equal(summary.comparisonPercent, 25);
});

test("past goal reports no remaining days and completed goals need no daily revenue", () => {
  const past = summarizeFinancialGoal(
    { periodKey: "2026-09", target: 100 },
    [],
    [],
    new Date(2026, 9, 1),
  );
  const completed = summarizeFinancialGoal(
    { periodKey: "2026-10", target: 100 },
    [{ periodKey: "2026-10", amount: 120 }],
    [],
    new Date(2026, 9, 1),
  );
  assert.equal(past.daysRemaining, 0);
  assert.equal(past.requiredPerDay, 0);
  assert.equal(completed.remaining, 0);
  assert.equal(completed.progressPercent, 100);
});
