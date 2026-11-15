"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Target, TrendingUp } from "lucide-react";
import { amountToCents, centsToAmount, formatMoney } from "../lib/finance.mjs";
import { summarizeFinancialGoal } from "../lib/financial-goals.mjs";

const currentPeriodKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function FinancialGoals({ db, mutate }) {
  const [periodKey, setPeriodKey] = useState(currentPeriodKey);
  const [draftTarget, setDraftTarget] = useState("");
  const [error, setError] = useState("");
  const goal = db.financialGoals.find((item) => item.periodKey === periodKey);
  useEffect(() => {
    setDraftTarget(goal ? String(goal.target) : "");
  }, [periodKey, goal?.id, goal?.target]);
  const summary = summarizeFinancialGoal(
    goal,
    db.incomes,
    db.expenses,
  );
  const displayedTarget = draftTarget;

  const save = (event) => {
    event.preventDefault();
    const targetCents = amountToCents(displayedTarget);
    if (!/^\d{4}-\d{2}$/.test(periodKey) || targetCents <= 0) {
      setError("Выберите месяц и укажите положительную цель выручки.");
      return;
    }

    const nextGoal = {
      id: goal?.id || createId(),
      periodKey,
      target: centsToAmount(targetCents),
      updatedAt: new Date().toISOString(),
    };
    mutate(
      {
        financialGoals: goal
          ? db.financialGoals.map((item) => item.id === goal.id ? nextGoal : item)
          : [nextGoal, ...db.financialGoals],
      },
      `${goal ? "Обновлена" : "Установлена"} цель выручки на ${periodKey}: ${formatMoney(nextGoal.target)}`,
    );
    setDraftTarget("");
    setError("");
  };

  const comparisonLabel = summary?.comparisonPercent == null
    ? "Нет данных для сравнения с прошлым месяцем"
    : `${summary.comparisonPercent >= 0 ? "+" : ""}${summary.comparisonPercent.toFixed(1)}% к прошлому месяцу`;

  return (
    <div className="financial-goals-page">
      <section className="customers-hero">
        <div>
          <span className="dashboard-kicker">FINANCIAL PLANNING</span>
          <h2>Цели и план выручки</h2>
          <p>Сравните фактические поступления с месячной целью и рассчитайте необходимый темп.</p>
        </div>
        <div className="work-orders-count"><Target size={17} /><strong>{db.financialGoals.length}</strong><span>целей</span></div>
      </section>

      <section className="card financial-goal-controls">
        <label className="work-order-field">
          <span>Месяц планирования</span>
          <input type="month" value={periodKey} onChange={(event) => { setPeriodKey(event.target.value); setError(""); }} required />
        </label>
        <form onSubmit={save}>
          <label className="work-order-field">
            <span>Целевая выручка, MDL</span>
            <input type="number" min="0.01" step="0.01" value={displayedTarget} onChange={(event) => { setDraftTarget(event.target.value); setError(""); }} placeholder="Например, 100000" required />
          </label>
          <button type="submit" className="action-btn"><Target size={15} /> {goal ? "Обновить цель" : "Установить цель"}</button>
        </form>
        {error && <p className="work-order-error" role="alert">{error}</p>}
      </section>

      {summary ? (
        <section className="card financial-goal-summary">
          <header><div><span className="dashboard-kicker">MONTHLY TARGET</span><h3>{periodKey}</h3></div><strong>{formatMoney(summary.actualRevenue)} <span>из {formatMoney(summary.target)}</span></strong></header>
          <div className="goal-progress-track" role="progressbar" aria-label="Выполнение цели выручки" aria-valuenow={Math.round(summary.progressPercent)} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${summary.progressPercent}%` }} />
          </div>
          <div className="goal-progress-caption"><span>{summary.progressPercent.toFixed(1)}% выполнено</span><span>{summary.remaining ? `Осталось ${formatMoney(summary.remaining)}` : "Цель достигнута"}</span></div>
          <div className="goal-metrics">
            <article><span>Нужно в день</span><strong>{summary.daysRemaining ? formatMoney(summary.requiredPerDay) : "—"}</strong><small>{summary.daysRemaining ? `${summary.daysRemaining} дн. осталось, включая сегодня` : "Период завершён"}</small></article>
            <article><span>Прибыль за месяц</span><strong>{formatMoney(summary.profit)}</strong><small>Поступления минус расходы</small></article>
            <article><span>Динамика выручки</span><strong className={summary.comparisonPercent == null ? "" : summary.comparisonPercent >= 0 ? "goal-up" : "goal-down"}>{summary.comparisonPercent == null ? "—" : <>{summary.comparisonPercent >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{Math.abs(summary.comparisonPercent).toFixed(1)}%</>}</strong><small>{comparisonLabel}</small></article>
          </div>
          <p className="goal-simulator-note"><TrendingUp size={14} /> План рассчитывается по фактическим поступлениям текущего месяца. Это ориентир, а не прогноз гарантированной выручки.</p>
        </section>
      ) : (
        <section className="card customers-empty"><Target size={25} /><h3>Цель на этот месяц не установлена</h3><p>Задайте план выручки, чтобы видеть прогресс и необходимый ежедневный темп.</p></section>
      )}
    </div>
  );
}
