"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BrainCircuit,
  CalendarDays,
  Check,
  CircleDollarSign,
  Download,
  FileText,
  Gauge,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  ADVISOR_PERIODS,
  answerAdvisorQuestion,
  buildAdvisorAnalytics,
  buildAdvisorInsights,
  buildAdvisorRecommendations,
} from "../lib/business-advisor.mjs";
import { formatMoney } from "../lib/finance.mjs";
import { roleCanWriteCollection } from "../lib/access-control.mjs";

const RECOMMENDATION_STATUSES = [
  ["new", "Новая"],
  ["in_progress", "В работе"],
  ["completed", "Выполнена"],
  ["dismissed", "Отклонена"],
];
const PRIORITY_LABELS = { high: "Высокий", medium: "Средний", low: "Низкий" };
const CHAT_PROMPTS = {
  ru: [
    "Сравни поступления с прошлым периодом",
    "Какие услуги самые популярные?",
    "Кто наши самые ценные клиенты?",
    "Какой день был самым загруженным?",
  ],
  ro: [
    "Compară veniturile cu perioada anterioară",
    "Care sunt cele mai populare servicii?",
    "Cine sunt clienții cu cele mai mari plăți?",
    "Care a fost cea mai aglomerată zi?",
  ],
};

function percentage(value) {
  if (value === null || value === undefined) return "Нет данных для сравнения";
  return `${value > 0 ? "+" : ""}${value}% к предыдущему периоду`;
}

function KpiCard({ label, value, change, Icon, featured, money = false, inverted = false }) {
  const positive = typeof change === "number" && (change >= 0) !== inverted;
  return (
    <article className={`advisor-kpi${featured ? " is-featured" : ""}`}>
      <div className="advisor-kpi-label"><span>{label}</span><i><Icon size={16} /></i></div>
      <strong>{money ? value === null ? "—" : formatMoney(value) : value ?? "—"}</strong>
      <small className={typeof change === "number" ? positive ? "trend-up" : "trend-down" : ""}>
        {typeof change === "number" && (positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />)}
        {percentage(change)}
      </small>
    </article>
  );
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadReport(analytics, insights, recommendations) {
  const lines = [
    ["ANGEL DETAILING — AI Business Advisor"],
    ["Период", analytics.range.from, analytics.range.to],
    [],
    ["Показатель", "Значение", "Изменение"],
    ["Поступления", analytics.current.revenue, analytics.changes.revenue],
    ["Операционные расходы", analytics.current.expenses, analytics.changes.expenses],
    ["Операционная прибыль", analytics.current.profit, analytics.changes.profit],
    ["Завершённые заказы", analytics.current.completedOrders, analytics.changes.completedOrders],
    ["Средняя стоимость заказа", analytics.current.averageOrderValue ?? "", ""],
    ["Новые клиенты", analytics.current.newClients, analytics.changes.newClients],
    ["Вернувшиеся клиенты", analytics.current.returningClients, analytics.changes.returningClients],
    [],
    ["Предыдущий равный период", analytics.range.previousStart.toLocaleDateString("sv-SE"), analytics.range.previousEnd.toLocaleDateString("sv-SE")],
    ["Поступления предыдущего периода", analytics.previous.revenue],
    ["Операционные расходы предыдущего периода", analytics.previous.expenses],
    ["Операционная прибыль предыдущего периода", analytics.previous.profit],
    [],
    ["Тренд", "Поступления", "Расходы", "Прибыль", "Заказы"],
    ...analytics.series.map((item) => [item.label, item.revenue, item.expenses, item.profit, item.completedOrders]),
    [],
    ["Услуги", "Визиты", "Выручка заказов"],
    ...analytics.services.map((item) => [item.name, item.visits, item.revenue]),
    [],
    ["Клиенты с наибольшими оплатами", "Оплаты"],
    ...analytics.topClients.map((item) => [item.name, item.revenue]),
    [],
    ["Клиенты без визита 60+ дней", "Дней с последнего визита"],
    ...analytics.inactiveClients.map((item) => [item.name, item.daysSinceVisit]),
    [],
    ["Статусы заказов", "Количество"],
    ...analytics.orders.statusDistribution.map((item) => [item.status, item.count]),
    [],
    ["Загруженность по дням недели", "Записей"],
    ...analytics.orders.busiestWeekdays.map((item) => [item.weekday, item.appointments]),
    [],
    ["AI Insights", "Приоритет", "Подтверждающие данные", "Рекомендация"],
    ...insights.map((item) => [item.title, PRIORITY_LABELS[item.priority], item.supportingData, item.aiRecommendation || item.recommendation]),
    [],
    ["Business Recommendations", "Приоритет", "Статус", "Основание", "Данные", "Действие"],
    ...recommendations.map((item) => [
      item.title,
      PRIORITY_LABELS[item.priority],
      RECOMMENDATION_STATUSES.find(([status]) => status === item.status)?.[1] || item.status,
      item.reason,
      item.supportingData,
      item.action,
    ]),
  ];
  const csv = `\uFEFF${lines.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `angel-detailing-advisor-${analytics.range.from}-${analytics.range.to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TrendChart({ series }) {
  const values = series.flatMap((item) => [item.revenue, item.expenses, item.profit]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const yFor = (value) => 206 - ((value - min) / Math.max(1, max - min)) * 170;
  const coordinates = (key) => series.map((item, index) => {
    const x = series.length < 2 ? 400 : 46 + (index / (series.length - 1)) * 708;
    return `${x},${yFor(item[key])}`;
  }).join(" ");
  const labels = series.length > 10
    ? series.filter((_, index) => index % Math.ceil(series.length / 8) === 0 || index === series.length - 1)
    : series;
  return (
    <div className="advisor-chart">
      {series.length ? (
        <>
          <div className="advisor-chart-plot">
            <svg viewBox="0 0 800 230" role="img" aria-label="График поступлений, расходов и прибыли">
              {[36, 78, 120, 162, 204].map((y) => <line key={y} x1="42" x2="760" y1={y} y2={y} />)}
              <polyline className="chart-revenue-line" points={coordinates("revenue")} />
              <polyline className="chart-expenses-line" points={coordinates("expenses")} />
              <polyline className="chart-profit-line" points={coordinates("profit")} />
              {series.map((item, index) => {
                if (series.length > 10 && index % Math.ceil(series.length / 8) !== 0 && index !== series.length - 1) return null;
                const x = series.length < 2 ? 400 : 46 + (index / (series.length - 1)) * 708;
                return <circle key={item.key} cx={x} cy={yFor(item.revenue)} r="3" className="chart-revenue-dot" />;
              })}
            </svg>
          </div>
          <div className="advisor-chart-labels">{labels.map((item) => <span key={item.key}>{item.label}</span>)}</div>
          <div className="advisor-chart-legend">
            <span><i className="legend-revenue" />Поступления</span>
            <span><i className="legend-expenses" />Расходы</span>
            <span><i className="legend-profit" />Прибыль</span>
          </div>
        </>
      ) : <p className="advisor-muted">За выбранный период нет данных для графика.</p>}
    </div>
  );
}

function MetricBars({ items, valueKey, formatValue, emptyText, labelKey = "name" }) {
  const maximum = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));
  if (!items.length) return <p className="advisor-muted">{emptyText}</p>;
  return (
    <div className="advisor-metric-bars">
      {items.map((item) => (
        <div className="advisor-metric-bar" key={item.id || item[labelKey]}>
          <div><span>{item[labelKey]}</span><strong>{formatValue(item[valueKey])}</strong></div>
          <i><b style={{ width: `${Math.max(2, (Number(item[valueKey]) / maximum) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
}

export default function BusinessAdvisor({ db, mutate, navigate, openModal, role, user }) {
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [to, setTo] = useState(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const [language, setLanguage] = useState("ru");
  const [question, setQuestion] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiInsights, setAiInsights] = useState(null);
  const [chat, setChat] = useState([]);
  const chatEndRef = useRef(null);
  const canManageRecommendations = roleCanWriteCollection(role, "advisorRecommendations");
  const analytics = useMemo(
    () => buildAdvisorAnalytics(db, { period, from, to }),
    [db, period, from, to],
  );
  const insights = useMemo(
    () => buildAdvisorInsights(analytics, db),
    [analytics, db],
  );
  const recommendations = useMemo(
    () => buildAdvisorRecommendations(db.advisorRecommendations, insights),
    [db.advisorRecommendations, insights],
  );
  const currentRecommendationKeys = new Set(insights.map((item) => item.key));
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const visibleRecommendations = recommendations
    .filter((item) => currentRecommendationKeys.has(item.key))
    .sort((first, second) => priorityOrder[first.priority] - priorityOrder[second.priority]);
  const effectiveInsights = aiInsights || insights;
  const smartNotifications = (db.notifications || [])
    .filter((item) => item.smart && item.status === "active" && item.category === "ai-insights")
    .slice(0, 3);

  useEffect(() => {
    if (!canManageRecommendations) return;
    const current = JSON.stringify(db.advisorRecommendations || []);
    const next = JSON.stringify(recommendations);
    if (current !== next) {
      mutate({ advisorRecommendations: recommendations }, "Обновлены бизнес-рекомендации AI Advisor");
    }
  }, [canManageRecommendations, db.advisorRecommendations, mutate, recommendations]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat]);

  const askAdvisor = async (prompt = question) => {
    const text = prompt.trim();
    if (!text || chatBusy) return;
    const nextChat = [...chat, { role: "user", content: text }].slice(-20);
    setChat(nextChat);
    setQuestion("");
    setChatBusy(true);
    setAiError("");
    try {
      const response = await fetch("/api/ai/business-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          action: "chat",
          question: text,
          history: nextChat.slice(-7),
          language,
          period,
          from,
          to,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось получить ответ.");
      const answer = {
        role: "assistant",
        content: result.answer?.text || "",
        table: result.answer?.table || null,
        analysis: result.analysis || "",
        recommendation: result.recommendation || "",
      };
      setChat((current) => [...current, answer].slice(-20));
      if (result.aiError) setAiError(result.aiError);
    } catch (error) {
      setChat((current) => current.filter((item, index) => !(index === current.length - 1 && item.role === "user" && item.content === text)));
      setQuestion(text);
      setAiError(error instanceof Error ? error.message : "Ошибка связи с бизнес-советником.");
    } finally {
      setChatBusy(false);
    }
  };

  const generateAiInsights = async () => {
    setAnalysisBusy(true);
    setAiError("");
    try {
      const response = await fetch("/api/ai/business-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ action: "analyze", language, period, from, to }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сформировать AI-анализ.");
      setAiInsights(result.insights || []);
      if (result.aiError || result.note) setAiError(result.aiError || result.note);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Ошибка AI-анализа.");
    } finally {
      setAnalysisBusy(false);
    }
  };

  const updateRecommendation = (recommendation, status) => {
    mutate({
      advisorRecommendations: recommendations.map((item) =>
        item.key === recommendation.key
          ? { ...item, status, updatedAt: new Date().toISOString(), updatedBy: user }
          : item,
      ),
    }, `Изменён статус рекомендации: ${recommendation.title}`);
  };

  const openCustomer = (customerId) => {
    const customer = db.customers.find((item) => String(item.id) === String(customerId));
    if (customer) openModal({ type: "customer-profile", item: customer });
    else navigate("customers");
  };

  return (
    <div className="business-advisor-page">
      <section className="advisor-hero">
        <div className="advisor-hero-copy">
          <span className="dashboard-kicker"><BrainCircuit size={14} /> ANGEL INTELLIGENCE</span>
          <h2>AI Business Advisor</h2>
          <p>Показатели и рекомендации на основе записей CRM. Факты рассчитаны приложением; AI помогает интерпретировать тенденции.</p>
        </div>
        <div className="advisor-hero-actions">
          <span className="advisor-data-status"><i /> Данные CRM</span>
          <button type="button" className="btn-sm advisor-export-button" onClick={() => downloadReport(analytics, effectiveInsights, visibleRecommendations)}>
            <Download size={15} /> Экспорт отчёта
          </button>
        </div>
      </section>

      <section className="advisor-period-bar">
        <label className="advisor-period-select">
          <span><CalendarDays size={15} /> Период</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            {ADVISOR_PERIODS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
          </select>
        </label>
        {period === "custom" && (
          <div className="advisor-custom-range">
            <label>С <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>По <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
        )}
        <div className="advisor-period-note">
          <span>{analytics.range.from} — {analytics.range.to}</span>
          <small>Сравнение с предыдущим равным периодом</small>
        </div>
      </section>

      <section className="advisor-kpis" aria-label="Ключевые показатели">
        <KpiCard label="Поступления" value={analytics.current.revenue} change={analytics.changes.revenue} Icon={CircleDollarSign} featured money />
        <KpiCard label="Расходы" value={analytics.current.expenses} change={analytics.changes.expenses} Icon={Wallet} money inverted />
        <KpiCard label="Операционная прибыль" value={analytics.current.profit} change={analytics.changes.profit} Icon={TrendingUp} money />
        <KpiCard label="Завершённые заказы" value={analytics.current.completedOrders} change={analytics.changes.completedOrders} Icon={Check} />
        <KpiCard label="Средний заказ" value={analytics.current.averageOrderValue} change={null} Icon={Gauge} money />
        <KpiCard label="Новые клиенты" value={analytics.current.newClients} change={analytics.changes.newClients} Icon={Users} />
        <KpiCard label="Вернувшиеся клиенты" value={analytics.current.returningClients} change={analytics.changes.returningClients} Icon={RefreshCw} />
      </section>

      <section className="advisor-main-grid">
        <article className="advisor-panel advisor-trend-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><TrendingUp size={16} /></span><div><h3>Финансовая динамика</h3><p>Поступления, операционные расходы и прибыль</p></div></div>
            <span className="advisor-period-chip">{analytics.range.from} — {analytics.range.to}</span>
          </header>
          <TrendChart series={analytics.series} />
        </article>
        <article className="advisor-panel advisor-summary-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><Target size={16} /></span><div><h3>Краткий обзор</h3><p>Сравнение с прошлым периодом</p></div></div>
          </header>
          <div className="advisor-summary-list">
            {[
              ["Поступления", analytics.current.revenue, analytics.changes.revenue],
              ["Расходы", analytics.current.expenses, analytics.changes.expenses],
              ["Прибыль", analytics.current.profit, analytics.changes.profit],
              ["Заказы", analytics.current.completedOrders, analytics.changes.completedOrders],
            ].map(([label, value, change]) => (
              <div key={label}><span>{label}</span><strong>{typeof value === "number" ? label === "Заказы" ? value : formatMoney(value) : "—"}</strong><small className={typeof change === "number" ? change >= 0 ? "trend-up" : "trend-down" : ""}>{percentage(change)}</small></div>
            ))}
          </div>
          <p className="advisor-accounting-note">Прибыль = поступления минус операционные расходы. Личные средства исключены, снятие денег не считается расходом.</p>
        </article>
      </section>

      <section className="advisor-analytics-grid">
        <article className="advisor-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><Sparkles size={16} /></span><div><h3>Популярность услуг</h3><p>По завершённым визитам за выбранный период</p></div></div>
          </header>
          <MetricBars items={analytics.services} valueKey="visits" formatValue={(value) => `${value} виз.`} emptyText="Нет завершённых визитов за этот период." />
        </article>
        <article className="advisor-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><CircleDollarSign size={16} /></span><div><h3>Выручка по услугам</h3><p>Строки услуг из завершённых заказов</p></div></div>
          </header>
          <MetricBars items={[...analytics.services].sort((a, b) => b.revenue - a.revenue).filter((item) => item.revenue > 0)} valueKey="revenue" formatValue={formatMoney} emptyText="В завершённых заказах нет данных для распределения по услугам." />
        </article>
        <article className="advisor-panel advisor-order-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><FileText size={16} /></span><div><h3>Статусы заказов</h3><p>Заказы, созданные в выбранном периоде</p></div></div>
          </header>
          {analytics.orders.statusDistribution.length ? (
            <div className="advisor-status-list">
              {analytics.orders.statusDistribution.map((item) => (
                <div key={item.status}><span>{item.status}</span><strong>{item.count}</strong></div>
              ))}
            </div>
          ) : <p className="advisor-muted">Нет заказов за выбранный период.</p>}
          {!!analytics.orders.busiestWeekdays.length && (
            <div className="advisor-busiest-day"><span>Больше всего записей</span><strong>{analytics.orders.busiestWeekdays[0].weekday} · {analytics.orders.busiestWeekdays[0].appointments}</strong></div>
          )}
        </article>
      </section>

      <section className="advisor-client-grid">
        <article className="advisor-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><Users size={16} /></span><div><h3>Клиенты с наибольшими оплатами</h3><p>Только поступления за выбранный период</p></div></div>
            <button type="button" className="advisor-link-button" onClick={() => navigate("customers")}>Все клиенты <ArrowRight size={14} /></button>
          </header>
          {analytics.topClients.length ? (
            <div className="advisor-client-list">
              {analytics.topClients.slice(0, 5).map((client, index) => (
                <button type="button" key={client.id} onClick={() => openCustomer(client.id)}>
                  <span className="advisor-client-rank">{index + 1}</span><strong>{client.name}</strong><b>{formatMoney(client.revenue)}</b><ArrowRight size={14} />
                </button>
              ))}
            </div>
          ) : <p className="advisor-muted">Нет связанных клиентских оплат за выбранный период.</p>}
        </article>
        <article className="advisor-panel">
          <header className="advisor-section-heading">
            <div><span className="advisor-section-icon"><RefreshCw size={16} /></span><div><h3>Клиентам нужен follow-up</h3><p>Последний завершённый визит был 60+ дней назад</p></div></div>
            <button type="button" className="advisor-link-button" onClick={() => navigate("customers")}>Клиенты <ArrowRight size={14} /></button>
          </header>
          {analytics.inactiveClients.length ? (
            <div className="advisor-client-list advisor-inactive-list">
              {analytics.inactiveClients.slice(0, 5).map((client) => (
                <button type="button" key={client.id} onClick={() => openCustomer(client.id)}>
                  <span className="advisor-client-rank"><Users size={13} /></span><strong>{client.name}</strong><b>{client.daysSinceVisit} дн.</b><ArrowRight size={14} />
                </button>
              ))}
            </div>
          ) : <p className="advisor-muted">Нет клиентов, удовлетворяющих условию 60 дней без визита.</p>}
        </article>
      </section>

      <section className="advisor-panel advisor-insights-panel">
        <header className="advisor-section-heading">
          <div><span className="advisor-section-icon advisor-ai-icon"><BrainCircuit size={17} /></span><div><h3>AI Insights</h3><p>Сигналы создаются только при наличии подтверждающих данных CRM</p></div></div>
          <button type="button" className="btn-sm advisor-ai-button" onClick={generateAiInsights} disabled={analysisBusy}>
            <Sparkles size={14} />{analysisBusy ? "Анализируем…" : "Сформировать AI-анализ"}
          </button>
        </header>
        {effectiveInsights.length ? (
          <div className="advisor-insight-grid">
            {effectiveInsights.map((insight) => (
              <article className={`advisor-insight-card priority-${insight.priority}`} key={insight.id}>
                <div className="advisor-insight-top"><span className={`advisor-priority priority-${insight.priority}`}>{PRIORITY_LABELS[insight.priority]}</span><time>{new Date(insight.generatedAt).toLocaleDateString(language === "ro" ? "ro-RO" : "ru-RU")}</time></div>
                <h4>{insight.title}</h4>
                <p>{insight.aiExplanation || insight.explanation}</p>
                <div className="advisor-evidence"><strong>Данные CRM</strong><span>{insight.supportingData}</span></div>
                <div className="advisor-insight-action"><strong>Рекомендуемое действие</strong><span>{insight.aiRecommendation || insight.recommendation}</span></div>
                <small className="advisor-why">{insight.whyItMatters}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="advisor-insights-empty">
            <Check size={18} /><div><strong>Подтверждённых отклонений не найдено</strong><span>Проверены доступные платежи, расходы, визиты и остатки. Это не прогноз.</span></div>
          </div>
        )}
        {!!smartNotifications.length && (
          <div className="advisor-notification-bridge">
            <div><BellIcon /><span><strong>Smart Notifications</strong><small>{smartNotifications.length} активных AI-сигнала из общего центра</small></span></div>
            <button type="button" onClick={() => navigate("notifications")}>Открыть <ArrowRight size={14} /></button>
          </div>
        )}
      </section>

      <section className="advisor-panel advisor-recommendations-panel">
        <header className="advisor-section-heading">
          <div><span className="advisor-section-icon"><Target size={16} /></span><div><h3>Business Recommendations</h3><p>Статусы сохраняются в CRM для сотрудников с правом управления</p></div></div>
        </header>
        {visibleRecommendations.length ? (
          <div className="advisor-recommendation-grid">
            {visibleRecommendations.map((item) => (
              <article className={`advisor-recommendation-card priority-${item.priority}`} key={item.key}>
                <div className="advisor-recommendation-top"><span className={`advisor-priority priority-${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span><select aria-label={`Статус рекомендации ${item.title}`} value={item.status} disabled={!canManageRecommendations} onChange={(event) => updateRecommendation(item, event.target.value)}>
                  {RECOMMENDATION_STATUSES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select></div>
                <h4>{item.title}</h4>
                <p>{item.reason}</p>
                <div className="advisor-evidence"><strong>На чём основано</strong><span>{item.supportingData}</span></div>
                <small>{item.action}</small>
              </article>
            ))}
          </div>
        ) : <p className="advisor-muted">Сейчас нет рекомендаций, подтверждённых данными за выбранный период.</p>}
      </section>

      <section className="advisor-chat-panel">
        <header className="advisor-chat-header">
          <div><span className="advisor-chat-avatar"><BrainCircuit size={19} /></span><div><h3>Спросите ANGEL AI</h3><p>Точные показатели вычисляются CRM; AI помогает интерпретировать их.</p></div></div>
          <div className="advisor-language-toggle" aria-label="Язык ответов">
            <button type="button" className={language === "ru" ? "active" : ""} onClick={() => setLanguage("ru")}>RU</button>
            <button type="button" className={language === "ro" ? "active" : ""} onClick={() => setLanguage("ro")}>RO</button>
          </div>
        </header>
        <div className="advisor-chat-messages" aria-live="polite">
          {!chat.length && (
            <div className="advisor-chat-welcome">
              <Sparkles size={17} /><strong>{language === "ro" ? "Întreabă despre afacere" : "Задайте вопрос о бизнесе"}</strong>
              <span>{language === "ro" ? "Asistentul folosește date CRM agregate, fără contacte personale." : "Ассистент использует агрегированные данные CRM без передачи контактных данных."}</span>
            </div>
          )}
          {chat.map((message, index) => (
            <article className={`advisor-chat-message ${message.role}`} key={`${index}:${message.content.slice(0, 30)}`}>
              <div className="advisor-chat-bubble">
                <p>{message.content}</p>
                {message.table?.rows?.length > 0 && (
                  <div className="advisor-chat-table-wrap"><table><thead><tr>{message.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{message.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
                )}
                {!!message.analysis && <p className="advisor-chat-analysis">{message.analysis}</p>}
                {!!message.recommendation && <div className="advisor-chat-recommendation"><Sparkles size={13} /><span>{message.recommendation}</span></div>}
              </div>
            </article>
          ))}
          {chatBusy && <div className="advisor-chat-loading"><i /><i /><i /><span>ANGEL AI анализирует данные…</span></div>}
          <div ref={chatEndRef} />
        </div>
        {!chat.length && (
          <div className="advisor-prompt-chips">
            {CHAT_PROMPTS[language].map((prompt) => <button type="button" key={prompt} onClick={() => askAdvisor(prompt)}>{prompt}</button>)}
          </div>
        )}
        {!!aiError && <p className="advisor-ai-error" role="status">{aiError}</p>}
        <form className="advisor-chat-form" onSubmit={(event) => { event.preventDefault(); void askAdvisor(); }}>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} rows={2} placeholder={language === "ro" ? "Întreabă despre venituri, clienți sau servicii…" : "Например: почему в этом месяце снизилась прибыль?"} />
          <button type="submit" disabled={!question.trim() || chatBusy} aria-label="Отправить вопрос"><Send size={17} /></button>
          <span>{question.length}/600</span>
        </form>
        <p className="advisor-privacy-note"><MessageCircle size={13} /> AI получает только агрегированные показатели. Он не меняет CRM и не отправляет сообщения.</p>
      </section>
    </div>
  );
}

function BellIcon() {
  return <Bell size={16} />;
}
