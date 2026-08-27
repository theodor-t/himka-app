"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarPlus,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Minus,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
  Trash2,
  Pencil,
  User,
} from "lucide-react";

const SCRIPT_URL = "/api/db";
const BACKUP_KEY = "angel-detailing-auto-backup";
const MONTHS = [
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
const EMPTY_DB = {
  clients: [],
  expenses: [],
  incomes: [],
  warehouse: [],
  withdrawals: [],
  debts: [],
  windows: [],
  logs: [],
};
const NAV = [
  ["home", "Главная Панель", LayoutDashboard],
  ["clients", "1. Записи клиентов", Users],
  ["expenses", "2. Затраты", Receipt],
  ["profit", "3. Прибыль", TrendingUp],
  ["warehouse", "4. Склад", Package],
  ["withdrawals", "5. Вывод денег", Wallet],
  ["debts", "6. Должники", Wallet],
  ["windows", "7. Свободные окна", CalendarPlus],
  ["logs", "8. Журнал логов", History],
];
const RU_COLLATOR = new Intl.Collator("ru", { numeric: true });

const money = (value) => `${Number(value || 0).toLocaleString("ru-RU")} MDL`;
const dateText = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const nowText = () => dateText(new Date());
const currentMonth = () => MONTHS[new Date().getMonth()];
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const isSameDay = (value, reference = new Date()) => {
  const date = parseDate(value);
  return (
    date &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
};
const normalizeDb = (data) => ({
  ...EMPTY_DB,
  ...(data || {}),
  debts: data?.debts || [],
  windows: data?.windows || [],
  logs: data?.logs || [],
});

function Button({
  children,
  variant = "primary",
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <button
      className={`action-btn ${variant === "secondary" ? "btn-secondary" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modal active"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="form-group">
      <span>{label}</span>
      {children}
    </label>
  );
}
function EmptyRow({ colSpan, children = "Нет записей" }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-row">
        {children}
      </td>
    </tr>
  );
}
function Badge({ children, status }) {
  return (
    <span
      className={`status-badge ${status ? `status-${status}` : "user-badge"}`}
    >
      {children}
    </span>
  );
}
function DeleteButton({ onClick, label = "Удалить" }) {
  return (
    <button
      className="btn-sm btn-del"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Trash2 size={14} />
    </button>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [selectedUser, setSelectedUser] = useState("TUDOR");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(false);
  const [db, setDb] = useState(EMPTY_DB);
  const [page, setPage] = useState("home");
  const [sync, setSync] = useState("Загрузка...");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [profitMonth, setProfitMonth] = useState("all");
  const [clientQuery, setClientQuery] = useState("");
  const [clientStatus, setClientStatus] = useState("all");
  const [sort, setSort] = useState({ key: "", direction: 1 });
  const dbRef = useRef(EMPTY_DB);
  const syncInFlight = useRef(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((response) => response.json())
      .then(({ user: savedUser }) => setUser(savedUser || null))
      .catch(() => setUser(null))
      .finally(() => setSessionChecked(true));
  }, []);

  const mutate = (changes, log) => {
    const withCurrentAuthor = (collection, values) =>
      values.map((item) =>
        dbRef.current[collection].some((existing) => existing.id === item.id)
          ? item
          : { ...item, author: user || item.author },
      );
    const normalizedChanges = { ...changes };
    if (changes.expenses)
      normalizedChanges.expenses = withCurrentAuthor(
        "expenses",
        changes.expenses,
      );
    if (changes.withdrawals)
      normalizedChanges.withdrawals = withCurrentAuthor(
        "withdrawals",
        changes.withdrawals,
      );
    const next = {
      ...dbRef.current,
      ...normalizedChanges,
      logs: [
        {
          id: Date.now(),
          datetime: nowText(),
          user: user || "Система",
          action: log,
        },
        ...dbRef.current.logs,
      ],
    };
    dbRef.current = next;
    setDb(next);
    persist(next);
  };
  const persist = async (next) => {
    setSync("Сохранение...");
    const serialized = JSON.stringify(next);
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), data: next }),
    );
    try {
      await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      });
      localStorage.setItem("angel-detailing-db", serialized);
      setSync("✓ Сохранено");
    } catch {
      setSync("⚠ Ошибка сохранения");
    }
  };
  const loadData = async () => {
    if (syncInFlight.current || document.visibilityState === "hidden") return;
    syncInFlight.current = true;
    setSync("Синхронизация...");
    try {
      const response = await fetch(SCRIPT_URL, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const freshDb = normalizeDb(await response.json());
      dbRef.current = freshDb;
      setDb(freshDb);
      localStorage.setItem("angel-detailing-db", JSON.stringify(freshDb));
      setSync("✓ Google OK");
    } catch {
      setSync("⚠ Ошибка Google");
    } finally {
      syncInFlight.current = false;
    }
  };
  useEffect(() => {
    if (!user) return undefined;
    try {
      const cachedDb = localStorage.getItem("angel-detailing-db");
      if (cachedDb) {
        const parsedDb = normalizeDb(JSON.parse(cachedDb));
        dbRef.current = parsedDb;
        setDb(parsedDb);
      }
    } catch {
      localStorage.removeItem("angel-detailing-db");
    }
    loadData();
    const timer = window.setInterval(loadData, 30000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user]);

  const login = async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: selectedUser, password }),
      });
      if (!response.ok) throw new Error();
      setUser(selectedUser);
      setAuthError(false);
    } catch {
      setAuthError(true);
      setPassword("");
    }
  };
  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setUser(null);
    setPage("home");
    dbRef.current = EMPTY_DB;
    setDb(EMPTY_DB);
  };
  const navigate = (next) => {
    setPage(next);
    setMenuOpen(false);
  };
  const sorted = (items, key, defaultDirection = 1) => {
    const activeKey = sort.key || key;
    return [...items].sort((a, b) => {
      if (activeKey === "datetime") {
        const dateA = Date.parse(a[activeKey] || "") || 0;
        const dateB = Date.parse(b[activeKey] || "") || 0;
        return (dateA - dateB) * (sort.key ? sort.direction : defaultDirection);
      }
      return (
        RU_COLLATOR.compare(
          String(a[activeKey] ?? ""),
          String(b[activeKey] ?? ""),
        ) * (sort.key ? sort.direction : defaultDirection)
      );
    });
  };
  const sortBy = (key) =>
    setSort((current) => ({
      key,
      direction: current.key === key ? current.direction * -1 : 1,
    }));
  const addLog = (action) => mutate({}, action);
  const importData = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importedDb = normalizeDb(JSON.parse(reader.result));
        if (!Object.values(importedDb).every((value) => Array.isArray(value)))
          throw new Error();
        if (confirm("Заменить текущие данные выбранной резервной копией?")) {
          dbRef.current = importedDb;
          setDb(importedDb);
          persist(importedDb);
        }
      } catch {
        alert(
          "Недействительная резервная копия. Выберите JSON-файл, экспортированный из приложения.",
        );
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  const totals = useMemo(() => {
    const month = currentMonth();
    const income = db.incomes.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    const incomeMonth = db.incomes
      .filter((item) => item.month === month)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const commonExpenses = db.expenses
      .filter((item) => item.source !== "Личные средства")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expensesMonth = db.expenses
      .filter(
        (item) => item.month === month && item.source !== "Личные средства",
      )
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const personal = db.expenses
      .filter((item) => item.source === "Личные средства")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const personalMonth = db.expenses
      .filter(
        (item) => item.month === month && item.source === "Личные средства",
      )
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = db.withdrawals.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    const lowStock = db.warehouse.filter((item) => Number(item.qty || 0) <= 2);
    return {
      income,
      incomeMonth,
      commonExpenses,
      expensesMonth,
      personal,
      personalMonth,
      withdrawals,
      lowStock,
      profit: income - commonExpenses,
      cash: income - commonExpenses - withdrawals,
    };
  }, [db]);
  const period = useMemo(() => {
    const matches = (item) =>
      profitMonth === "all" || item.month === profitMonth;
    const income = db.incomes
      .filter(matches)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expenses = db.expenses
      .filter((item) => matches(item) && item.source !== "Личные средства")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const personal = db.expenses
      .filter((item) => matches(item) && item.source === "Личные средства")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = db.withdrawals
      .filter(matches)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      income,
      expenses,
      personal,
      withdrawals,
      profit: income - expenses,
    };
  }, [db, profitMonth]);
  const monthly = useMemo(
    () =>
      MONTHS.map((month) => {
        const income = db.incomes
          .filter((item) => item.month === month)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const expenses = db.expenses
          .filter(
            (item) => item.month === month && item.source !== "Личные средства",
          )
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        return { month, income, expenses, profit: income - expenses };
      }),
    [db],
  );
  const pageContent = useMemo(
    () => (
      <PageContent
        page={page}
        db={db}
        user={user}
        totals={totals}
        monthly={monthly}
        period={period}
        month={profitMonth}
        setMonth={setProfitMonth}
        clientQuery={clientQuery}
        setClientQuery={setClientQuery}
        clientStatus={clientStatus}
        setClientStatus={setClientStatus}
        navigate={navigate}
        sort={sorted}
        sortBy={sortBy}
        openModal={setModal}
        mutate={mutate}
        addLog={addLog}
        reload={loadData}
        exportData={() => download(db)}
        importData={importData}
      />
    ),
    [
      page,
      db,
      user,
      totals,
      monthly,
      period,
      profitMonth,
      clientQuery,
      clientStatus,
      navigate,
      sort,
    ],
  );

  if (!user)
    return (
      <Auth
        selectedUser={selectedUser}
        setSelectedUser={setSelectedUser}
        password={password}
        setPassword={setPassword}
        error={authError}
        onSubmit={login}
        loading={!sessionChecked}
      />
    );
  return (
    <div className="app-container">
      <div
        className={`overlay ${menuOpen ? "active" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon">
              <img src="/angel-logo.webp" alt="ANGEL DETAILING" />
            </span>
            <span className="brand-text">
              ANGEL <small>DETAILING</small>
            </span>
          </div>
        </div>
        <nav className="nav-list">
          {NAV.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="user-info-sidebar">
          <div className="user-profile">
            <User size={16} /> <strong>{user}</strong>
          </div>
          <button
            className="logout-btn"
            type="button"
            onClick={logout}
            title="Выйти из системы"
            aria-label="Выйти из системы"
          >
            <LogOut size={14} />
            <span>Выйти</span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="top-bar">
          <div className="top-title">
            <button
              className="mobile-menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Открыть меню"
            >
              <Menu size={21} />
            </button>
            <h1>{NAV.find((item) => item[0] === page)?.[1] || "Панель"}</h1>
          </div>
          <div className="top-bar-actions">
            <span className="sync-status">{sync}</span>
            <button
              className="page-reload-btn"
              type="button"
              onClick={() => window.location.reload()}
              title="Перезагрузить страницу"
              aria-label="Перезагрузить страницу"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <div className="page-container">{pageContent}</div>
      </main>
      {modal && (
        <ModalContent
          type={modal.type}
          item={modal.item}
          preset={modal.preset}
          db={db}
          user={user}
          onClose={() => setModal(null)}
          mutate={mutate}
        />
      )}
    </div>
  );
}

function Auth({
  selectedUser,
  setSelectedUser,
  password,
  setPassword,
  error,
  onSubmit,
  loading,
}) {
  return (
    <div className={`auth-screen ${loading ? "session-loading" : ""}`}>
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-icon">
          <img src="/angel-logo.webp" alt="ANGEL DETAILING" />
        </div>
        <h2>ANGEL DETAILING</h2>
        <p>Система учета и управления</p>
        <Field label="Пользователь">
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
          >
            <option>TUDOR</option>
            <option>DAN</option>
          </select>
        </Field>
        <Field label="Пароль">
          <input
            autoFocus
            type="password"
            placeholder="Введите пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button icon={ArrowRight}>Войти в систему</Button>
        {error && <div className="error-msg">Неверный пароль!</div>}
      </form>
    </div>
  );
}

function PageContent({
  page,
  db,
  user,
  totals,
  monthly,
  period,
  month,
  setMonth,
  clientQuery,
  setClientQuery,
  clientStatus,
  setClientStatus,
  navigate,
  sort,
  sortBy,
  openModal,
  mutate,
  addLog,
  reload,
  exportData,
  importData,
}) {
  if (page === "home")
    return (
      <Dashboard
        db={db}
        totals={totals}
        monthly={monthly}
        reload={reload}
        exportData={exportData}
        importData={importData}
        navigate={navigate}
        openModal={openModal}
      />
    );
  if (page === "clients")
    return (
      <Clients
        db={db}
        sort={sort}
        sortBy={sortBy}
        query={clientQuery}
        setQuery={setClientQuery}
        status={clientStatus}
        setStatus={setClientStatus}
        openModal={openModal}
        mutate={mutate}
      />
    );
  if (page === "expenses")
    return (
      <Expenses
        db={db}
        sort={sort}
        sortBy={sortBy}
        mutate={mutate}
        user={user}
      />
    );
  if (page === "profit")
    return (
      <Profit
        db={db}
        period={period}
        month={month}
        setMonth={setMonth}
        sort={sort}
        sortBy={sortBy}
        openModal={openModal}
        mutate={mutate}
      />
    );
  if (page === "warehouse")
    return (
      <Warehouse
        db={db}
        sort={sort}
        sortBy={sortBy}
        openModal={openModal}
        mutate={mutate}
      />
    );
  if (page === "withdrawals")
    return (
      <Withdrawals
        db={db}
        sort={sort}
        sortBy={sortBy}
        mutate={mutate}
        user={user}
      />
    );
  if (page === "debts")
    return (
      <Debtors
        db={db}
        sort={sort}
        sortBy={sortBy}
        openModal={openModal}
        mutate={mutate}
        user={user}
      />
    );
  if (page === "windows")
    return (
      <Windows
        db={db}
        sort={sort}
        sortBy={sortBy}
        openModal={openModal}
        mutate={mutate}
      />
    );
  return <Logs db={db} sort={sort} sortBy={sortBy} />;
}

function Dashboard({
  db,
  totals,
  monthly,
  reload,
  exportData,
  importData,
  navigate,
  openModal,
}) {
  const today = new Date();
  const appointments = db.clients
    .map((client) => ({ ...client, parsedDate: parseDate(client.datetime) }))
    .filter(({ parsedDate }) => parsedDate)
    .filter(({ parsedDate }) => {
      const daysFromToday =
        (parsedDate -
          new Date(today.getFullYear(), today.getMonth(), today.getDate())) /
        86400000;
      return daysFromToday >= 0 && daysFromToday < 7;
    })
    .sort((a, b) => a.parsedDate - b.parsedDate);
  const todayAppointments = appointments.filter((client) =>
    isSameDay(client.datetime, today),
  );
  const dashboardMetrics = [
    ["Баланс кассы", totals.cash, "cyan", Wallet],
    ["Доходы всего", totals.income, "success", TrendingUp],
    ["Затраты всего", totals.commonExpenses, "warning", Receipt],
    [
      "Активные долги",
      db.debts
        .filter((debt) => !debt.paid)
        .reduce((sum, debt) => sum + Number(debt.amount || 0), 0),
      "danger",
      Bell,
    ],
  ];
  return (
    <div className="dashboard-shell">
      <section className="dashboard-welcome">
        <div className="dashboard-hero-heading">
          <div>
            <span className="dashboard-kicker">
              ANGEL DETAILING · CONTROL CENTER
            </span>
            <h2>Главная панель</h2>
            <p>Ключевые цифры и ближайшие действия на одном экране.</p>
          </div>
          <div className="dashboard-live">
            <span /> Данные синхронизированы
          </div>
        </div>
        <div className="dashboard-actions">
          <Button variant="secondary" icon={RefreshCw} onClick={reload}>
            Обновить
          </Button>
          <Button
            variant="secondary"
            icon={FileText}
            onClick={() => window.print()}
          >
            PDF
          </Button>
          <Button variant="secondary" icon={Save} onClick={exportData}>
            Бэкап
          </Button>
          <label className="action-btn btn-secondary file-btn">
            <Save size={16} /> Импорт{" "}
            <input
              type="file"
              accept="application/json,.json"
              onChange={importData}
            />
          </label>
        </div>
      </section>
      <section className="dashboard-metrics">
        {dashboardMetrics.map(([label, value, color, Icon]) => (
          <div className={`dashboard-metric ${color}`} key={label}>
            <div className="dashboard-metric-top">
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{money(value)}</strong>
            <small>
              {label === "Баланс кассы"
                ? "после расходов и выводов"
                : label === "Активные долги"
                  ? "ожидается к погашению"
                  : "за всё время"}
            </small>
          </div>
        ))}
      </section>
      {totals.lowStock.length > 0 && (
        <div className="low-stock-alert dashboard-alert">
          <Package size={18} />
          <span>
            <strong>Мало товара:</strong>{" "}
            {totals.lowStock
              .map((item) => `${item.name} (${item.qty})`)
              .join(", ")}
          </span>
        </div>
      )}
      <AvailableWindows db={db} openModal={openModal} navigate={navigate} />
      <section className="dashboard-grid">
        <div className="card reminder-card">
          <div className="card-header">
            <span>Напоминания</span>
            <Bell size={18} className="red-icon" />
          </div>
          <div className="reminder-summary">
            <strong>{todayAppointments.length}</strong>
            <span>записей сегодня</span>
          </div>
          {appointments.length ? (
            <div className="appointment-list">
              {appointments.slice(0, 6).map((client) => (
                <div className="appointment-item" key={client.id}>
                  <CalendarDays size={16} />
                  <div>
                    <strong>{client.car || "Без имени"}</strong>
                    <span>
                      {isSameDay(client.datetime, today)
                        ? `Сегодня, ${dateText(client.datetime).slice(11)}`
                        : dateText(client.datetime)}
                      {client.service ? ` · ${client.service}` : ""}
                    </span>
                  </div>
                  <Badge status={statusClass(client.status)}>
                    {client.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-reminder">Нет ближайших записей</div>
          )}
        </div>
        <div className="card snapshot-card">
          <div className="card-header">
            <span>Список должников</span>
            <Wallet size={18} className="warning-icon" />
          </div>
          <DebtorsPreview db={db} navigate={navigate} />
        </div>
      </section>
      <PrintReport
        db={db}
        totals={totals}
        todayAppointments={todayAppointments}
        monthly={monthly}
      />
      <FinancialInsights db={db} totals={totals} monthly={monthly} />
    </div>
  );
}

function DebtorsPreview({ db, navigate }) {
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const total = activeDebts.reduce(
    (sum, debt) => sum + Number(debt.amount || 0),
    0,
  );
  return activeDebts.length ? (
    <>
      <div className="debt-preview-total">
        <span>Ожидается к погашению</span>
        <strong>{money(total)}</strong>
      </div>
      <div className="debt-preview-list">
        {activeDebts.slice(0, 4).map((debt) => {
          const client = db.clients.find(
            (row) => String(row.id) === String(debt.clientId),
          );
          return (
            <div className="debt-preview-row" key={debt.id}>
              <span>{client?.car || "Удаленный клиент"}</span>
              <strong>{money(debt.amount)}</strong>
            </div>
          );
        })}
      </div>
      <button
        className="text-action"
        type="button"
        onClick={() => navigate("debts")}
      >
        Открыть всех должников <ArrowRight size={14} />
      </button>
    </>
  ) : (
    <div className="empty-reminder">Активных долгов нет</div>
  );
}

function AvailableWindows({ db, openModal, navigate }) {
  const windows = [...db.windows]
    .filter((slot) => parseDate(slot.datetime))
    .sort(
      (first, second) => parseDate(first.datetime) - parseDate(second.datetime),
    );
  return (
    <section className="card windows-panel">
      <div className="card-header">
        <span>Свободные окна</span>
        <Button
          variant="secondary"
          icon={CalendarPlus}
          onClick={() => navigate("windows")}
        >
          Управление
        </Button>
      </div>
      {windows.length ? (
        <div className="window-grid">
          {windows.slice(0, 8).map((slot) => (
            <button
              className="window-slot"
              type="button"
              key={slot.id}
              onClick={() =>
                openModal({
                  type: "client",
                  preset: { datetime: slot.datetime, windowId: slot.id },
                })
              }
            >
              <span>{dateText(slot.datetime).split(" ")[0]}</span>
              <strong>{dateText(slot.datetime).slice(11)}</strong>
              <small>
                Записать клиента <ArrowRight size={13} />
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-reminder">
          Добавьте свободные даты и время в разделе управления.
        </div>
      )}
    </section>
  );
}

function Windows({ db, sort, sortBy, openModal, mutate }) {
  return (
    <section className="card">
      <div className="card-header">
        <span>Свободные окна</span>
        <Button
          icon={CalendarPlus}
          onClick={() => openModal({ type: "window" })}
        >
          Добавить окно
        </Button>
      </div>
      <Table
        sortBy={sortBy}
        headers={["Дата и время", "Комментарий", "Действия"].map(
          (label, index) => [label, ["datetime", "comment"][index]],
        )}
      >
        {sort(db.windows, "datetime").map((slot) => (
          <tr key={slot.id}>
            <td>
              <strong>{dateText(slot.datetime)}</strong>
            </td>
            <td>{slot.comment || "-"}</td>
            <td>
              <Actions
                onEdit={() => openModal({ type: "window", item: slot })}
                onDelete={() =>
                  confirm("Удалить свободное окно?") &&
                  mutate(
                    { windows: db.windows.filter((row) => row.id !== slot.id) },
                    `Удалено свободное окно: ${dateText(slot.datetime)}`,
                  )
                }
              />
            </td>
          </tr>
        ))}
        {!db.windows.length && (
          <EmptyRow colSpan={3}>Свободных окон нет</EmptyRow>
        )}
      </Table>
    </section>
  );
}

function Debtors({ db, sort, sortBy, openModal, mutate, user }) {
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const total = activeDebts.reduce(
    (sum, debt) => sum + Number(debt.amount || 0),
    0,
  );
  return (
    <>
      <section className="card debt-summary-card">
        <div className="card-header">
          <span>Учет долгов</span>
          <Button icon={Plus} onClick={() => openModal({ type: "debt" })}>
            Добавить долг
          </Button>
        </div>
        <div className="stats-grid">
          <div className="stat-card warning">
            <span className="stat-label">Активных должников</span>
            <strong>{activeDebts.length}</strong>
          </div>
          <Stat label="Общая сумма долга" value={total} color="danger" />
          <div className="stat-card success">
            <span className="stat-label">Погашено долгов</span>
            <strong>{db.debts.filter((debt) => debt.paid).length}</strong>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <span>Все долги</span>
        </div>
        <Table
          sortBy={sortBy}
          headers={[
            "Клиент",
            "Сумма",
            "Статус",
            "Комментарий",
            "Автор",
            "Дата",
            "Действия",
          ].map((label, index) => [
            label,
            ["clientId", "amount", "paid", "comment", "author", "date"][index],
          ])}
        >
          {sort(db.debts, "date", -1).map((debt) => {
            const client = db.clients.find(
              (row) => String(row.id) === String(debt.clientId),
            );
            return (
              <tr key={debt.id}>
                <td>
                  <strong>{client?.car || "Удаленный клиент"}</strong>
                </td>
                <td className={debt.paid ? "positive" : "warning"}>
                  {money(debt.amount)}
                </td>
                <td>
                  <Badge status={debt.paid ? "done" : "waiting"}>
                    {debt.paid ? "Погашен" : "Не погашен"}
                  </Badge>
                </td>
                <td>{debt.comment || "-"}</td>
                <td>
                  <Badge>{debt.author || user}</Badge>
                </td>
                <td>{debt.date}</td>
                <td>
                  <Actions
                    onEdit={() => openModal({ type: "debt", item: debt })}
                    onDelete={() =>
                      confirm("Удалить долг?") &&
                      mutate(
                        { debts: db.debts.filter((row) => row.id !== debt.id) },
                        `Удален долг: ${client?.car || debt.clientId}`,
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
          {!db.debts.length && (
            <EmptyRow colSpan={7}>Должников пока нет</EmptyRow>
          )}
        </Table>
      </section>
    </>
  );
}

function FinancialInsights({ db, totals, monthly }) {
  const values = [
    ["Доходы", totals.income, "income"],
    ["Затраты", totals.commonExpenses, "expenses"],
    ["Прибыль", totals.profit, "profit"],
  ];
  const maximum = Math.max(...values.map(([, value]) => Math.abs(value)), 1);
  return (
    <section className="card financial-insights finance-board">
      <div className="finance-board-heading">
        <div>
          <span className="dashboard-kicker">
            Финансовый обзор · {currentMonth()}
          </span>
          <h3>Доходы и прибыль</h3>
          <p>Сравнение ключевых показателей за всё время</p>
        </div>
        <TrendingUp size={20} className="red-icon" />
      </div>
      <div className="finance-board-grid">
        <div className="finance-main-chart">
          <div className="finance-chart-label">Сравнение показателей</div>
          <div className="comparison-chart">
            {values.map(([label, value, type]) => (
              <div className="comparison-column" key={label}>
                <div className={`comparison-value ${type}`}>{money(value)}</div>
                <div className="comparison-bar-area">
                  <i
                    className={type}
                    style={{
                      height: `${Math.max(5, (Math.abs(value) / maximum) * 100)}%`,
                    }}
                  />
                </div>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="finance-side">
          <div className="finance-side-total">
            <span>Чистая прибыль</span>
            <strong className={totals.profit >= 0 ? "positive" : "negative"}>
              {money(totals.profit)}
            </strong>
            <small>Доходы − затраты из кассы</small>
          </div>
          <div className="finance-side-list">
            <div>
              <span>Касса</span>
              <strong className="cyan-text">{money(totals.cash)}</strong>
            </div>
            <div>
              <span>Клиенты</span>
              <strong>{db.clients.length}</strong>
            </div>
            <div>
              <span>Личные средства</span>
              <strong className="info-text">{money(totals.personal)}</strong>
            </div>
            <div>
              <span>Выведено</span>
              <strong className="warning-text">
                {money(totals.withdrawals)}
              </strong>
            </div>
          </div>
        </div>
      </div>
      <MonthlyChart data={monthly} embedded />
    </section>
  );
}

function PrintReport({ db, totals, todayAppointments, monthly }) {
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const debtTotal = activeDebts.reduce(
    (sum, debt) => sum + Number(debt.amount || 0),
    0,
  );
  const availableWindows = db.windows
    .filter((slot) => parseDate(slot.datetime))
    .sort((first, second) => parseDate(first.datetime) - parseDate(second.datetime))
    .slice(0, 6);
  return (
    <section className="print-report">
      <div className="print-report-header">
        <div>
          <span className="print-report-kicker">ANGEL DETAILING · CONTROL CENTER</span>
          <h1>Операционный отчёт</h1>
          <p>Сформирован {dateText(new Date())}</p>
        </div>
        <img src="/angel-logo.png" alt="ANGEL DETAILING" />
      </div>
      <div className="print-report-grid">
        <div><span>Баланс кассы</span><strong>{money(totals.cash)}</strong></div>
        <div><span>Доходы всего</span><strong>{money(totals.income)}</strong></div>
        <div><span>Затраты всего</span><strong>{money(totals.commonExpenses)}</strong></div>
        <div><span>Чистая прибыль</span><strong>{money(totals.profit)}</strong></div>
      </div>
      <div className="print-report-secondary">
        <div><span>Клиентов</span><strong>{db.clients.length}</strong></div>
        <div><span>Долги к погашению</span><strong>{money(debtTotal)}</strong></div>
        <div><span>Свободных окон</span><strong>{db.windows.length}</strong></div>
      </div>
      <div className="print-chart">
        <div className="print-chart-heading"><h2>Динамика по месяцам</h2><span>Доходы · затраты · прибыль</span></div>
        <div className="print-chart-grid">
          {monthly.map((item) => <div className="print-chart-column" key={item.month}><div className="print-chart-bars"><i className="income" style={{ height: `${Math.max(3, (item.income / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%` }} /><i className="expenses" style={{ height: `${Math.max(3, (item.expenses / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%` }} /><i className="profit" style={{ height: `${Math.max(3, (Math.abs(item.profit) / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%` }} /></div><span>{item.month.slice(0, 3)}</span></div>)}
        </div>
      </div>
      <h2>Записи на сегодня</h2>
      {todayAppointments.length ? (
        todayAppointments.map((client) => (
          <div className="print-appointment" key={client.id}>
            <strong>
              {dateText(client.datetime).slice(11)} ·{" "}
              {client.car || "Без имени"}
            </strong>
            <span>
              {client.service || "Услуга не указана"} ·{" "}
              {client.phone || "Телефон не указан"}
            </span>
          </div>
        ))
      ) : (
        <p>Записей на сегодня нет.</p>
      )}
      <div className="print-report-columns">
        <div>
          <h2>Должники</h2>
          {activeDebts.length ? activeDebts.slice(0, 6).map((debt) => {
            const client = db.clients.find((row) => String(row.id) === String(debt.clientId));
            return <div className="print-list-row" key={debt.id}><span>{client?.car || "Клиент"}</span><strong>{money(debt.amount)}</strong></div>;
          }) : <p>Активных долгов нет.</p>}
        </div>
        <div>
          <h2>Свободные окна</h2>
          {availableWindows.length ? availableWindows.map((slot) => <div className="print-list-row" key={slot.id}><span>{dateText(slot.datetime).split(" ")[0]}</span><strong>{dateText(slot.datetime).slice(11)}</strong></div>) : <p>Свободных окон нет.</p>}
        </div>
      </div>
    </section>
  );
}

function MonthlyChart({ data, embedded = false }) {
  const maxValue = Math.max(
    ...data.map((item) =>
      Math.max(item.income, item.expenses, Math.abs(item.profit)),
    ),
    1,
  );
  return (
    <section
      className={`${embedded ? "" : "card "}chart-card ${embedded ? "embedded-chart" : ""}`}
    >
      <div className="card-header">
        <span>Динамика по месяцам</span>
        <TrendingUp size={18} className="red-icon" />
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-income" />
          Доходы
        </span>
        <span>
          <i className="legend-expenses" />
          Затраты
        </span>
        <span>
          <i className="legend-profit" />
          Прибыль
        </span>
      </div>
      <div className="monthly-chart">
        {data.map((item) => (
          <div className="chart-column" key={item.month}>
            <div className="chart-bars">
              <span
                className="chart-bar income"
                style={{
                  height: `${Math.max(3, (item.income / maxValue) * 100)}%`,
                }}
                title={`Доходы: ${money(item.income)}`}
              />
              <span
                className="chart-bar expenses"
                style={{
                  height: `${Math.max(3, (item.expenses / maxValue) * 100)}%`,
                }}
                title={`Затраты: ${money(item.expenses)}`}
              />
              <span
                className="chart-bar profit"
                style={{
                  height: `${Math.max(3, (Math.abs(item.profit) / maxValue) * 100)}%`,
                }}
                title={`Прибыль: ${money(item.profit)}`}
              />
            </div>
            <span className="chart-label">{item.month.slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Table({ headers, children, sortBy }) {
  const [currentPage, setCurrentPage] = useState(1);
  const rows = Children.toArray(children);
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  useEffect(
    () => setCurrentPage((page) => Math.min(page, totalPages)),
    [totalPages],
  );
  const visibleRows = rows.slice((currentPage - 1) * 20, currentPage * 20);
  return (
    <>
      <div className="table-responsive">
        <table>
          <thead>
            <tr>
              {headers.map(([label, key]) => (
                <th key={label} onClick={() => key && sortBy(key)}>
                  {label}
                  {key && " ⇳"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{visibleRows}</tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination" aria-label="Пагинация">
          <button
            className="btn-sm btn-qty"
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((page) => page - 1)}
          >
            ←
          </button>
          <span>
            Страница {currentPage} из {totalPages} · 20 записей
          </span>
          <button
            className="btn-sm btn-qty"
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((page) => page + 1)}
          >
            →
          </button>
        </div>
      )}
    </>
  );
}
function Actions({ onEdit, onDelete }) {
  return (
    <span className="actions">
      <button
        className="btn-sm btn-edit"
        onClick={onEdit}
        title="Редактировать"
        aria-label="Редактировать"
      >
        <Pencil size={13} />
      </button>
      <DeleteButton onClick={onDelete} />
    </span>
  );
}
function statusClass(value) {
  return (
    {
      "В ожидании": "waiting",
      "Не пришел": "no-show",
      Отменен: "cancelled",
      Выполнено: "done",
    }[value] || "waiting"
  );
}

function Clients({
  db,
  sort,
  sortBy,
  query,
  setQuery,
  status,
  setStatus,
  openModal,
  mutate,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredClients = db.clients.filter(
    (client) =>
      (!normalizedQuery ||
        [client.car, client.phone, client.service, client.comment].some(
          (value) =>
            String(value || "")
              .toLowerCase()
              .includes(normalizedQuery),
        )) &&
      (status === "all" || client.status === status),
  );
  return (
    <section className="card">
      <div className="card-header">
        <span>Записи клиентов</span>
        <Button onClick={() => openModal({ type: "client" })}>+ Клиент</Button>
      </div>
      <div className="filter-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск: авто, телефон, услуга..."
          aria-label="Поиск клиентов"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Фильтр по статусу"
        >
          <option value="all">Все статусы</option>
          {["В ожидании", "Не пришел", "Отменен", "Выполнено"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <Table
        sortBy={sortBy}
        headers={[
          "Авто",
          "Телефон",
          "Сиденья",
          "Услуга",
          "Дата",
          "Статус",
          "Автор",
          "Инфо",
          "Действия",
        ].map((label, i) => [
          label,
          [
            "car",
            "phone",
            "seatType",
            "service",
            "datetime",
            "status",
            "author",
            "comment",
          ][i],
        ])}
      >
        {sort(filteredClients, "datetime", -1).map((client) => (
          <tr key={client.id}>
            <td>
              <strong>{client.car}</strong>
            </td>
            <td>{client.phone || "-"}</td>
            <td>{client.seatType || "-"}</td>
            <td>{client.service || "-"}</td>
            <td>{dateText(client.datetime)}</td>
            <td>
              <Badge status={statusClass(client.status)}>{client.status}</Badge>
            </td>
            <td>
              <Badge>{client.author || "TUDOR"}</Badge>
            </td>
            <td>{client.comment || "-"}</td>
            <td>
              <Actions
                onEdit={() => openModal({ type: "client", item: client })}
                onDelete={() =>
                  confirm("Удалить эту запись?") &&
                  mutate(
                    {
                      clients: db.clients.filter(
                        (item) => item.id !== client.id,
                      ),
                    },
                    `Удален клиент: ${client.car}`,
                  )
                }
              />
            </td>
          </tr>
        ))}
        {!filteredClients.length && (
          <EmptyRow colSpan={9}>Нет клиентов по выбранным фильтрам</EmptyRow>
        )}
      </Table>
    </section>
  );
}

function Expenses({ db, sort, sortBy, mutate }) {
  const [form, setForm] = useState({
    category: "",
    amount: "",
    month: currentMonth(),
    source: "Общие",
    comment: "",
  });
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = (event) => {
    event.preventDefault();
    if (!form.category || !Number(form.amount))
      return alert("Заполните категорию и сумму!");
    mutate(
      {
        expenses: [
          {
            ...form,
            id: Date.now(),
            amount: Number(form.amount),
            date: nowText(),
            author: "TUDOR",
          },
          ...db.expenses,
        ],
      },
      `Затрата: ${form.category} - ${form.amount} MDL (${form.source})`,
    );
    setForm({ ...form, category: "", amount: "", comment: "" });
  };
  return (
    <>
      <form className="card" onSubmit={save}>
        <div className="card-header">Добавить затрату</div>
        <div className="form-grid">
          <Field label="Категория расхода">
            <input
              name="category"
              value={form.category}
              onChange={update}
              placeholder="Автохимия / Аренда"
            />
          </Field>
          <Field label="Сумма (MDL)">
            <input
              name="amount"
              type="number"
              value={form.amount}
              onChange={update}
              placeholder="1500"
            />
          </Field>
          <Field label="Месяц">
            <MonthSelect name="month" value={form.month} onChange={update} />
          </Field>
          <Field label="Источник средств">
            <select name="source" value={form.source} onChange={update}>
              <option>Общие</option>
              <option>Личные средства</option>
            </select>
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea
            name="comment"
            value={form.comment}
            onChange={update}
            placeholder="Детали..."
          />
        </Field>
        <Button>Сохранить расход</Button>
      </form>
      <section className="card">
        <div className="card-header">История затрат</div>
        <Table
          sortBy={sortBy}
          headers={[
            "Дата",
            "Месяц",
            "Категория",
            "Сумма",
            "Источник",
            "Автор",
            "Заметка",
            "Удалить",
          ].map((label, i) => [
            label,
            [
              "date",
              "month",
              "category",
              "amount",
              "source",
              "author",
              "comment",
            ][i],
          ])}
        >
          {sort(db.expenses, "date").map((item) => (
            <tr key={item.id}>
              <td>{item.date}</td>
              <td>{item.month}</td>
              <td>{item.category}</td>
              <td className="negative">-{money(item.amount)}</td>
              <td>{item.source}</td>
              <td>
                <Badge>{item.author || "TUDOR"}</Badge>
              </td>
              <td>{item.comment || "-"}</td>
              <td>
                <DeleteButton
                  onClick={() =>
                    confirm("Удалить затрату?") &&
                    mutate(
                      {
                        expenses: db.expenses.filter(
                          (row) => row.id !== item.id,
                        ),
                      },
                      `Удалена затрата: ${item.category}`,
                    )
                  }
                />
              </td>
            </tr>
          ))}
          {!db.expenses.length && <EmptyRow colSpan={8} />}
        </Table>
      </section>
    </>
  );
}

function MonthSelect({ name, value, onChange }) {
  return (
    <select name={name} value={value} onChange={onChange}>
      {MONTHS.map((item) => (
        <option key={item}>{item}</option>
      ))}
    </select>
  );
}
function Stat({ label, value, color = "" }) {
  return (
    <div className={`stat-card ${color}`}>
      <span className="stat-label">{label}</span>
      <strong>{money(value)}</strong>
    </div>
  );
}

function Profit({
  db,
  period,
  month,
  setMonth,
  sort,
  sortBy,
  openModal,
  mutate,
}) {
  return (
    <>
      <section className="card">
        <div className="card-header">
          <span>Прибыль и аналитика</span>
          <Button onClick={() => openModal({ type: "income" })}>+ Доход</Button>
        </div>
        <Field label="Выберите период">
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            <option value="all">За всё время</option>
            {MONTHS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <div className="stats-grid">
          <Stat label="Выручка" value={period.income} color="success" />
          <Stat
            label="Затраты (из кассы)"
            value={period.expenses}
            color="danger"
          />
          <Stat label="Личные средства" value={period.personal} color="info" />
          <Stat
            label="Выведено из кассы"
            value={period.withdrawals}
            color="warning"
          />
          <Stat
            label="Чистая прибыль за период"
            value={period.profit}
            color="red"
          />
        </div>
      </section>
      <section className="card">
        <div className="card-header">Список доходов</div>
        <Table
          sortBy={sortBy}
          headers={[
            "Дата",
            "Клиент",
            "Сумма",
            "Статус",
            "Автор",
            "Действия",
          ].map((label, i) => [
            label,
            ["date", "clientId", "amount", "author"][i],
          ])}
        >
          {db.incomes
            .filter((item) => month === "all" || item.month === month)
            .map((item) => {
              const client = db.clients.find((row) => row.id === item.clientId);
              return (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>
                    <strong>{client?.car || "Удаленный клиент"}</strong>
                  </td>
                  <td className="positive">+{money(item.amount)}</td>
                  <td>
                    <select
                      className="compact-select"
                      value={client?.status || "Выполнено"}
                      onChange={(event) =>
                        client &&
                        mutate(
                          {
                            clients: db.clients.map((row) =>
                              row.id === client.id
                                ? { ...row, status: event.target.value }
                                : row,
                            ),
                          },
                          `Статус ${client.car}: ${event.target.value}`,
                        )
                      }
                    >
                      {["В ожидании", "Не пришел", "Отменен", "Выполнено"].map(
                        (status) => (
                          <option key={status}>{status}</option>
                        ),
                      )}
                    </select>
                  </td>
                  <td>
                    <Badge>{item.author || "TUDOR"}</Badge>
                  </td>
                  <td>
                    <DeleteButton
                      onClick={() =>
                        confirm("Удалить доход?") &&
                        mutate(
                          {
                            incomes: db.incomes.filter(
                              (row) => row.id !== item.id,
                            ),
                          },
                          `Удален доход: ${item.amount} MDL`,
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          {!db.incomes.length && <EmptyRow colSpan={6} />}
        </Table>
      </section>
    </>
  );
}

function Warehouse({ db, sort, sortBy, openModal, mutate }) {
  return (
    <section className="card">
      <div className="card-header">
        <span>Учет расходников (Склад)</span>
        <Button onClick={() => openModal({ type: "warehouse" })}>
          + Товар
        </Button>
      </div>
      <Table
        sortBy={sortBy}
        headers={["Расходник", "Кол-во", "Автор", "Изменить", "Управление"].map(
          (label, i) => [label, ["name", "qty", "author"][i]],
        )}
      >
        {sort(db.warehouse, "name").map((item) => (
          <tr key={item.id}>
            <td>
              <strong>{item.name}</strong>
            </td>
            <td className="quantity">{item.qty}</td>
            <td>
              <Badge>{item.author || "TUDOR"}</Badge>
            </td>
            <td>
              <button
                className="btn-sm btn-qty"
                onClick={() =>
                  mutate(
                    {
                      warehouse: db.warehouse.map((row) =>
                        row.id === item.id
                          ? { ...row, qty: Math.max(0, Number(row.qty) - 1) }
                          : row,
                      ),
                    },
                    `Кол-во ${item.name}: -1`,
                  )
                }
              >
                <Minus size={13} />
              </button>{" "}
              <button
                className="btn-sm btn-qty"
                onClick={() =>
                  mutate(
                    {
                      warehouse: db.warehouse.map((row) =>
                        row.id === item.id
                          ? { ...row, qty: Number(row.qty) + 1 }
                          : row,
                      ),
                    },
                    `Кол-во ${item.name}: +1`,
                  )
                }
              >
                <Plus size={13} />
              </button>
            </td>
            <td>
              <Actions
                onEdit={() => openModal({ type: "warehouse", item })}
                onDelete={() =>
                  confirm("Удалить товар?") &&
                  mutate(
                    {
                      warehouse: db.warehouse.filter(
                        (row) => row.id !== item.id,
                      ),
                    },
                    `Удален товар: ${item.name}`,
                  )
                }
              />
            </td>
          </tr>
        ))}
        {!db.warehouse.length && <EmptyRow colSpan={5}>Склад пуст</EmptyRow>}
      </Table>
    </section>
  );
}

function Withdrawals({ db, sort, sortBy, mutate }) {
  const [form, setForm] = useState({
    amount: "",
    month: currentMonth(),
    comment: "",
  });
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = (event) => {
    event.preventDefault();
    if (!Number(form.amount)) return alert("Введите сумму вывода!");
    mutate(
      {
        withdrawals: [
          {
            ...form,
            id: Date.now(),
            amount: Number(form.amount),
            date: nowText(),
            author: "TUDOR",
          },
          ...db.withdrawals,
        ],
      },
      `Вывод средств: -${form.amount} MDL`,
    );
    setForm({ ...form, amount: "", comment: "" });
  };
  return (
    <>
      <form className="card" onSubmit={save}>
        <div className="card-header">Вывод денег из кассы</div>
        <div className="form-grid">
          <Field label="Сумма вывода (MDL)">
            <input
              name="amount"
              type="number"
              value={form.amount}
              onChange={update}
              placeholder="2000"
            />
          </Field>
          <Field label="Месяц">
            <MonthSelect name="month" value={form.month} onChange={update} />
          </Field>
        </div>
        <Field label="Комментарий / На что выведено">
          <textarea
            name="comment"
            value={form.comment}
            onChange={update}
            placeholder="Зарплата / Личные нужды..."
          />
        </Field>
        <Button>Зафиксировать вывод</Button>
      </form>
      <section className="card">
        <div className="card-header">История выводов</div>
        <Table
          sortBy={sortBy}
          headers={["Дата", "Месяц", "Сумма", "Автор", "Детали", "Удалить"].map(
            (label, i) => [
              label,
              ["date", "month", "amount", "author", "comment"][i],
            ],
          )}
        >
          {sort(db.withdrawals, "date").map((item) => (
            <tr key={item.id}>
              <td>{item.date}</td>
              <td>{item.month}</td>
              <td className="warning">-{money(item.amount)}</td>
              <td>
                <Badge>{item.author || "TUDOR"}</Badge>
              </td>
              <td>{item.comment || "-"}</td>
              <td>
                <DeleteButton
                  onClick={() =>
                    confirm("Удалить вывод?") &&
                    mutate(
                      {
                        withdrawals: db.withdrawals.filter(
                          (row) => row.id !== item.id,
                        ),
                      },
                      `Удален вывод: ${item.amount} MDL`,
                    )
                  }
                />
              </td>
            </tr>
          ))}
          {!db.withdrawals.length && <EmptyRow colSpan={6} />}
        </Table>
      </section>
    </>
  );
}
function Logs({ db, sort, sortBy }) {
  return (
    <section className="card">
      <div className="card-header">Журнал действий</div>
      <Table
        sortBy={sortBy}
        headers={["Дата", "Пользователь", "Действие"].map((label, i) => [
          label,
          ["datetime", "user", "action"][i],
        ])}
      >
        {sort(db.logs, "datetime").map((log) => (
          <tr key={log.id}>
            <td>{log.datetime}</td>
            <td>
              <Badge>{log.user}</Badge>
            </td>
            <td>{log.action}</td>
          </tr>
        ))}
        {!db.logs.length && <EmptyRow colSpan={3}>Журнал пуст</EmptyRow>}
      </Table>
    </section>
  );
}

function ModalContent({ type, item, preset, db, user, onClose, mutate }) {
  const isClient = type === "client";
  const isWarehouse = type === "warehouse";
  const isDebt = type === "debt";
  const isWindow = type === "window";
  const [form, setForm] = useState(
    item
      ? { ...item }
      : isClient
        ? {
            car: "",
            phone: "",
            seatType: "",
            service: "",
            datetime: preset?.datetime || "",
            windowId: preset?.windowId || "",
            status: "В ожидании",
            comment: "",
          }
        : isWarehouse
          ? { name: "", qty: "" }
          : isDebt
            ? {
                clientId: db.clients[0]?.id || "",
                amount: "",
                paid: false,
                comment: "",
              }
            : isWindow
              ? { datetime: "", comment: "" }
              : { clientId: db.clients[0]?.id || "", amount: "" },
  );
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = (event) => {
    event.preventDefault();
    if (isClient && (!form.car || !form.datetime))
      return alert("Заполните марку авто и дату/время!");
    if (isWarehouse && (!form.name || Number.isNaN(Number(form.qty))))
      return alert("Заполните название и количество!");
    if (type === "income" && (!form.clientId || !Number(form.amount)))
      return alert("Выберите клиента и сумму!");
    if (isDebt && (!form.clientId || Number(form.amount) <= 0))
      return alert("Выберите клиента и укажите сумму долга!");
    if (isWindow && !form.datetime)
      return alert("Укажите дату и время свободного окна!");
    if (isClient) {
      const value = {
        ...form,
        id: item?.id || Date.now(),
        author: item?.author || user,
      };
      mutate(
        {
          clients: item
            ? db.clients.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.clients],
          ...(form.windowId
            ? {
                windows: db.windows.filter((slot) => slot.id !== form.windowId),
              }
            : {}),
        },
        `${item ? "Изменена запись" : "Добавлен клиент"}: ${form.car}`,
      );
    }
    if (isWarehouse) {
      const value = {
        ...form,
        id: item?.id || Date.now(),
        qty: Number(form.qty),
        author: item?.author || user,
      };
      mutate(
        {
          warehouse: item
            ? db.warehouse.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.warehouse],
        },
        `${item ? "Склад обновлён" : "Добавлен товар"}: ${form.name}`,
      );
    }
    if (type === "income") {
      const client = db.clients.find(
        (row) => String(row.id) === String(form.clientId),
      );
      const value = {
        id: Date.now(),
        clientId: Number(form.clientId),
        amount: Number(form.amount),
        date: nowText(),
        month: currentMonth(),
        author: user,
      };
      mutate(
        { incomes: [value, ...db.incomes] },
        `Доход: +${form.amount} MDL (${client?.car || form.clientId})`,
      );
    }
    if (isDebt) {
      const client = db.clients.find(
        (row) => String(row.id) === String(form.clientId),
      );
      const value = {
        ...form,
        id: item?.id || Date.now(),
        clientId: Number(form.clientId),
        amount: Number(form.amount),
        paid: Boolean(form.paid),
        date: item?.date || nowText(),
        author: item?.author || user,
      };
      mutate(
        {
          debts: item
            ? db.debts.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.debts],
        },
        `${item ? "Изменен долг" : "Добавлен долг"}: ${client?.car || form.clientId}`,
      );
    }
    if (isWindow) {
      const value = { ...form, id: item?.id || Date.now() };
      mutate(
        {
          windows: item
            ? db.windows.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.windows],
        },
        `${item ? "Изменено" : "Добавлено"} свободное окно: ${dateText(form.datetime)}`,
      );
    }
    onClose();
  };
  return (
    <Modal
      title={
        isClient
          ? item
            ? "Редактировать запись"
            : "Новый клиент"
          : isWarehouse
            ? item
              ? "Редактировать товар"
              : "Новый товар"
            : isDebt
              ? item
                ? "Редактировать долг"
                : "Новый долг"
              : isWindow
                ? item
                  ? "Редактировать окно"
                  : "Новое свободное окно"
                : "Добавить доход"
      }
      onClose={onClose}
    >
      <form onSubmit={save}>
        {isClient && (
          <>
            <Field label="Марка авто / Имя">
              <input
                name="car"
                value={form.car}
                onChange={update}
                placeholder="BMW M5 / Иван"
              />
            </Field>
            <Field label="Телефон">
              <input
                name="phone"
                value={form.phone}
                onChange={update}
                placeholder="+373 ..."
              />
            </Field>
            <Field label="Тип сидений">
              <select
                name="seatType"
                value={form.seatType || ""}
                onChange={update}
              >
                <option value="">Не указано</option>
                <option>Ткань</option>
                <option>Кожа</option>
                <option>Ткань+кожа</option>
                <option>Алькантара</option>
                <option>Другое</option>
              </select>
            </Field>
            <Field label="Услуга">
              <input
                name="service"
                value={form.service}
                onChange={update}
                placeholder="Детейлинг / Химчистка"
              />
            </Field>
            <Field label="Дата и время">
              <input
                name="datetime"
                type="datetime-local"
                value={form.datetime}
                onChange={update}
              />
            </Field>
            <Field label="Статус">
              <select name="status" value={form.status} onChange={update}>
                {["В ожидании", "Не пришел", "Отменен", "Выполнено"].map(
                  (status) => (
                    <option key={status}>{status}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Комментарий">
              <textarea name="comment" value={form.comment} onChange={update} />
            </Field>
          </>
        )}
        {isWarehouse && (
          <>
            <Field label="Название">
              <input
                name="name"
                value={form.name}
                onChange={update}
                placeholder="Шампунь / Керамика"
              />
            </Field>
            <Field label="Количество">
              <input
                name="qty"
                type="number"
                value={form.qty}
                onChange={update}
              />
            </Field>
          </>
        )}
        {type === "income" && (
          <>
            <Field label="Выберите клиента">
              <select name="clientId" value={form.clientId} onChange={update}>
                {db.clients.length ? (
                  db.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.car}
                      {client.service ? ` (${client.service})` : ""}
                    </option>
                  ))
                ) : (
                  <option value="">Сначала добавьте клиентов</option>
                )}
              </select>
            </Field>
            <Field label="Сумма (MDL)">
              <input
                name="amount"
                type="number"
                value={form.amount}
                onChange={update}
                placeholder="1000"
              />
            </Field>
          </>
        )}
        {isDebt && (
          <>
            <Field label="Выберите клиента">
              <select name="clientId" value={form.clientId} onChange={update}>
                {db.clients.length ? (
                  db.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.car}
                      {client.phone ? ` (${client.phone})` : ""}
                    </option>
                  ))
                ) : (
                  <option value="">Сначала добавьте клиентов</option>
                )}
              </select>
            </Field>
            <Field label="Сумма долга (MDL)">
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={update}
                placeholder="450"
              />
            </Field>
            <Field label="Комментарий">
              <textarea
                name="comment"
                value={form.comment}
                onChange={update}
                placeholder="Что осталось оплатить..."
              />
            </Field>
            <label className="checkbox-field">
              <input
                name="paid"
                type="checkbox"
                checked={Boolean(form.paid)}
                onChange={(event) =>
                  setForm({ ...form, paid: event.target.checked })
                }
              />
              <span>Долг погашен</span>
            </label>
          </>
        )}
        {isWindow && (
          <>
            <Field label="Дата и время">
              <input
                name="datetime"
                type="datetime-local"
                value={form.datetime}
                onChange={update}
              />
            </Field>
            <Field label="Комментарий">
              <textarea
                name="comment"
                value={form.comment}
                onChange={update}
                placeholder="Например: большое окно"
              />
            </Field>
          </>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={Save}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}

function download(data) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "angel_detailing_backup.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
