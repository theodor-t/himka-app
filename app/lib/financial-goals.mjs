import { amountToCents, centsToAmount, periodKeyFor, sumAmounts } from "./finance.mjs";

export function previousPeriodKey(periodKey) {
  const [year, month] = periodKey.split("-").map(Number);
  const previous = new Date(year, month - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}

export function financialPeriodTotals(incomes, expenses, periodKey) {
  const income = sumAmounts(incomes.filter((item) => periodKeyFor(item) === periodKey));
  const expense = sumAmounts(
    expenses.filter(
      (item) => periodKeyFor(item) === periodKey && item.source !== "Личные средства",
    ),
  );
  return { income, expense, profit: centsToAmount(amountToCents(income) - amountToCents(expense)) };
}

export function summarizeFinancialGoal(goal, incomes, expenses, today = new Date()) {
  if (!goal || !/^\d{4}-(0[1-9]|1[0-2])$/.test(goal.periodKey || "")) return null;
  const targetCents = amountToCents(goal.target);
  if (targetCents <= 0) return null;

  const actual = financialPeriodTotals(incomes, expenses, goal.periodKey);
  const [year, month] = goal.periodKey.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const daysRemaining =
    goal.periodKey < currentPeriod
      ? 0
      : goal.periodKey > currentPeriod
        ? daysInMonth
        : Math.max(0, daysInMonth - today.getDate() + 1);
  const actualCents = amountToCents(actual.income);
  const remainingCents = Math.max(0, targetCents - actualCents);
  const previousPeriod = previousPeriodKey(goal.periodKey);
  const previousIncome = sumAmounts(
    incomes.filter((item) => periodKeyFor(item) === previousPeriod),
  );
  const previousCents = amountToCents(previousIncome);

  return {
    ...actual,
    target: centsToAmount(targetCents),
    actualRevenue: centsToAmount(actualCents),
    remaining: centsToAmount(remainingCents),
    progressPercent: Math.min(100, (actualCents / targetCents) * 100),
    daysRemaining,
    requiredPerDay: daysRemaining
      ? centsToAmount(Math.ceil(remainingCents / daysRemaining))
      : 0,
    previousPeriod,
    previousIncome,
    comparisonPercent: previousCents
      ? ((actualCents - previousCents) / previousCents) * 100
      : null,
  };
}
