"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  History,
  LayoutDashboard,
  Menu,
  Minus,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
  Trash2,
  Pencil,
  User,
} from "lucide-react";

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbx6OpGz3BhnwS7XPA1efSINsmEBgoQ_tKGrTSkJwrl0arcP_C8bVSmDjHXrL7Zm0XyJ/exec";
const USERS = { TUDOR: "326688", DAN: "326699" };
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
  logs: [],
};
const NAV = [
  ["home", "Главная Панель", LayoutDashboard],
  ["clients", "1. Записи клиентов", Users],
  ["expenses", "2. Затраты", Receipt],
  ["profit", "3. Прибыль", TrendingUp],
  ["warehouse", "4. Склад", Package],
  ["withdrawals", "5. Вывод денег", Wallet],
  ["logs", "6. Журнал логов", History],
];

const money = (value) => `${Number(value || 0).toLocaleString("ru-RU")} MDL`;
const dateText = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const nowText = () => dateText(new Date());
const currentMonth = () => MONTHS[new Date().getMonth()];
const normalizeDb = (data) => ({
  ...EMPTY_DB,
  ...(data || {}),
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
    try {
      await fetch(SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      localStorage.setItem("angel-detailing-db", JSON.stringify(next));
      setSync("✓ Сохранено");
    } catch {
      setSync("⚠ Ошибка сохранения");
    }
  };
  const loadData = async () => {
    if (syncInFlight.current) return;
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
    return () => window.clearInterval(timer);
  }, [user]);

  const login = (event) => {
    event.preventDefault();
    if (USERS[selectedUser] === password) {
      setUser(selectedUser);
      setAuthError(false);
    } else {
      setAuthError(true);
      setPassword("");
    }
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
        String(a[activeKey] ?? "").localeCompare(
          String(b[activeKey] ?? ""),
          "ru",
          { numeric: true },
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
        if (confirm("Înlocuiești datele actuale cu backup-ul selectat?")) {
          dbRef.current = importedDb;
          setDb(importedDb);
          persist(importedDb);
        }
      } catch {
        alert(
          "Backup invalid. Selectează un fișier JSON exportat din aplicație.",
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

  if (!user)
    return (
      <Auth
        selectedUser={selectedUser}
        setSelectedUser={setSelectedUser}
        password={password}
        setPassword={setPassword}
        error={authError}
        onSubmit={login}
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
              <Sparkles size={20} />
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
          <span>
            <User size={16} /> <strong>{user}</strong>
          </span>
          <b>F90 LCI</b>
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
          <span className="sync-status">{sync}</span>
        </header>
        <div className="page-container">
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
            sort={sorted}
            sortBy={sortBy}
            openModal={setModal}
            mutate={mutate}
            addLog={addLog}
            reload={loadData}
            exportData={() => download(db)}
            importData={importData}
          />{" "}
        </div>
      </main>
      {modal && (
        <ModalContent
          type={modal.type}
          item={modal.item}
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
}) {
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-icon">
          <ShieldCheck size={32} />
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
        totals={totals}
        monthly={monthly}
        reload={reload}
        exportData={exportData}
        importData={importData}
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
  return <Logs db={db} sort={sort} sortBy={sortBy} />;
}

function Dashboard({ totals, monthly, reload, exportData, importData }) {
  const month = currentMonth();
  const cards = [
    ["Доходы текущий месяц", totals.incomeMonth, "success"],
    ["Доходы за всё время", totals.income, "success"],
    ["Затраты текущий месяц", totals.expensesMonth, "danger"],
    ["Затраты за всё время", totals.commonExpenses, "danger"],
    ["Личные средства", totals.personalMonth, "info"],
    ["Выведено за всё время", totals.withdrawals, "warning"],
    ["Чистая прибыль", totals.profit, "red"],
    ["Общая касса", totals.cash, "cyan"],
  ];
  return (
    <>
      <section className="card">
        <div className="card-header">
          <span>Финансовые показатели</span>
          <Activity size={18} className="red-icon" />
        </div>
        <div className="stats-grid">
          {cards.map(([label, value, color], index) => (
            <div className={`stat-card ${color}`} key={label}>
              <span className="stat-label">
                {index === 0 || index === 2
                  ? `${label.replace("текущий месяц", "")} (${month})`
                  : label}
              </span>
              <strong>{money(value)}</strong>
            </div>
          ))}
        </div>
        {totals.lowStock.length > 0 && (
          <div className="low-stock-alert">
            <Package size={18} />
            <span>
              <strong>Мало товара:</strong>{" "}
              {totals.lowStock
                .map((item) => `${item.name} (${item.qty})`)
                .join(", ")}
            </span>
          </div>
        )}
        <div className="button-row">
          <Button variant="secondary" icon={Save} onClick={exportData}>
            Бэкап
          </Button>
          <label className="action-btn btn-secondary file-btn">
            <Save size={16} />
            Importă
            <input
              type="file"
              accept="application/json,.json"
              onChange={importData}
            />
          </label>
          <Button variant="secondary" icon={RefreshCw} onClick={reload}>
            Обновить
          </Button>
        </div>
      </section>
      <MonthlyChart data={monthly} />
    </>
  );
}

function MonthlyChart({ data }) {
  const maxValue = Math.max(
    ...data.map((item) =>
      Math.max(item.income, item.expenses, Math.abs(item.profit)),
    ),
    1,
  );
  return (
    <section className="card chart-card">
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
  return (
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
        <tbody>{children}</tbody>
      </table>
    </div>
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
          <EmptyRow colSpan={8}>Нет клиентов по выбранным фильтрам</EmptyRow>
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
          <span>Прибыль и Аналитика</span>
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

function ModalContent({ type, item, db, user, onClose, mutate }) {
  const isClient = type === "client";
  const isWarehouse = type === "warehouse";
  const [form, setForm] = useState(
    item
      ? { ...item }
      : isClient
        ? {
            car: "",
            phone: "",
            service: "",
            datetime: "",
            status: "В ожидании",
            comment: "",
          }
        : isWarehouse
          ? { name: "", qty: "" }
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
        `${item ? "Склад обновлен" : "Склад добавлено"}: ${form.name}`,
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
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
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
