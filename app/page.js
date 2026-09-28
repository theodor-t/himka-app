"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarPlus,
  ChartNoAxesCombined,
  CarFront,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Eye,
  FileText,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Minus,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Search,
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
import {
  amountToCents,
  applyPaymentToDebts,
  centsToAmount,
  clientIdKey,
  formatMoney,
  getUnpaidClients,
  MONTHS,
  monthLabel,
  outstandingForClient,
  parseRecordDate,
  periodKeyFor,
  reversePaymentFromDebts,
  sumAmounts,
  totalPaidForClient,
} from "./lib/finance.mjs";

const SCRIPT_URL = "/api/db";
const BACKUP_KEY = "angel-detailing-auto-backup";
const EMPTY_DB = {
  clients: [],
  expenses: [],
  incomes: [],
  warehouse: [],
  withdrawals: [],
  debts: [],
  windows: [],
  logs: [],
  stockMovements: [],
  services: [],
};
const NAV = [
  ["home", "Главная Панель", LayoutDashboard],
  ["analytics", "Аналитика", ChartNoAxesCombined],
  ["services", "Услуги и цены", Sparkles],
  ["calendar", "Календарь", CalendarDays],
  ["clients", "1. Записи клиентов", Users],
  ["expenses", "2. Затраты", Receipt],
  ["profit", "3. Прибыль", TrendingUp],
  ["warehouse", "4. Склад", Package],
  ["withdrawals", "5. Вывод денег", Wallet],
  ["debts", "6. Должники", Wallet],
  ["windows", "7. Свободные окна", CalendarPlus],
  ["logs", "8. Журнал логов", History],
];
const NAV_GROUPS = [
  { title: "ОБЗОР", items: ["home", "analytics"] },
  { title: "КЛИЕНТЫ И РАСПИСАНИЕ", items: ["calendar", "clients", "services"] },
  { title: "ФИНАНСЫ", items: ["expenses", "profit", "withdrawals", "debts"] },
  { title: "ОПЕРАЦИИ", items: ["warehouse", "windows", "logs"] },
];
const RU_COLLATOR = new Intl.Collator("ru", { numeric: true });

const money = formatMoney;
const dateText = (value) => {
  if (!value) return "";
  const date = parseRecordDate(value);
  if (!date) return value;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const nowText = () => dateText(new Date());
const currentMonth = () => MONTHS[new Date().getMonth()];
const currentPeriod = (date = new Date()) => ({
  month: MONTHS[date.getMonth()],
  year: date.getFullYear(),
  periodKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
});
const financeYears = (db) => {
  const currentYear = new Date().getFullYear();
  const recentYears = Array.from({ length: 11 }, (_, offset) =>
    String(currentYear - offset),
  );
  const recordYears = [
    ...db.incomes,
    ...db.expenses,
    ...db.withdrawals,
  ].map((item) => periodKeyFor(item).slice(0, 4));
  return [...new Set([...recentYears, ...recordYears])].sort(
    (first, second) => second.localeCompare(first),
  );
};
const subtractAmounts = (first, second) =>
  centsToAmount(amountToCents(first) - amountToCents(second));
const matchesPeriod = (item, selectedPeriod) => {
  if (selectedPeriod === "all") return true;
  const key = periodKeyFor(item);
  return selectedPeriod.length === 4
    ? key.startsWith(`${selectedPeriod}-`)
    : key === selectedPeriod;
};
const parseDate = parseRecordDate;
const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validPositiveAmount = (value) =>
  Number.isFinite(Number(value)) && amountToCents(value) > 0;
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
  stockMovements: data?.stockMovements || [],
  services: data?.services || [],
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

function LoadingOverlay({ message }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <LoaderCircle className="loading-spinner" size={30} />
      <strong>{message}</strong>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [selectedUser, setSelectedUser] = useState("TUDOR");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(null);
  const [db, setDb] = useState(EMPTY_DB);
  const [page, setPage] = useState("home");
  const [sync, setSync] = useState("Загрузка...");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [profitMonth, setProfitMonth] = useState("all");
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [clientQuery, setClientQuery] = useState("");
  const [clientStatus, setClientStatus] = useState("all");
  const [sort, setSort] = useState({ key: "", direction: 1 });
  const dbRef = useRef(EMPTY_DB);
  const syncInFlight = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const dataRevision = useRef(0);
  const localSavePending = useRef(false);

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
          id: createId(),
          datetime: nowText(),
          user: user || "Система",
          action: log,
        },
        ...dbRef.current.logs,
      ],
    };
    dataRevision.current += 1;
    dbRef.current = next;
    setDb(next);
    persist(next);
  };
  const persist = async (next) => {
    setLoadingMessage("Сохранение данных...");
    const revision = dataRevision.current;
    setSync("Сохранение...");
    const serialized = JSON.stringify(next);
    localSavePending.current = true;
    try {
      localStorage.setItem(
        BACKUP_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          pending: true,
          data: next,
        }),
      );
    } catch {
      // Continue with the cloud save if local storage is unavailable.
    }
    pendingSaves.current += 1;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const response = await fetch(SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
        if (!response.ok) throw new Error(`Save failed (${response.status})`);
        if (revision === dataRevision.current) {
          localSavePending.current = false;
          try {
            localStorage.setItem("angel-detailing-db", serialized);
            localStorage.setItem(
              BACKUP_KEY,
              JSON.stringify({
                savedAt: new Date().toISOString(),
                pending: false,
                data: next,
              }),
            );
          } catch {
            // Keep the successful server response even if browser storage is unavailable.
          }
          setSync("✓ Сохранено");
        }
      } catch {
        if (revision === dataRevision.current) {
          localSavePending.current = true;
          setSync("⚠ Ошибка сохранения");
        }
      } finally {
        pendingSaves.current = Math.max(0, pendingSaves.current - 1);
        if (revision === dataRevision.current) setLoadingMessage(null);
      }
    });
    return saveQueue.current;
  };
  const loadData = async () => {
    if (localSavePending.current && pendingSaves.current === 0) {
      void persist(dbRef.current);
      return;
    }
    if (
      syncInFlight.current ||
      pendingSaves.current > 0 ||
      document.visibilityState === "hidden"
    ) return;
    const revision = dataRevision.current;
    syncInFlight.current = true;
    setSync("Синхронизация...");
    try {
      const response = await fetch(SCRIPT_URL, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const freshDb = normalizeDb(await response.json());
      if (revision !== dataRevision.current || pendingSaves.current > 0) return;
      dbRef.current = freshDb;
      setDb(freshDb);
      try {
        localStorage.setItem("angel-detailing-db", JSON.stringify(freshDb));
      } catch {
        // Browser cache is optional; Google remains the source of truth.
      }
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
      const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null");
      const backupDb = backup?.data ? normalizeDb(backup.data) : null;
      if (
        backupDb &&
        Object.values(backupDb).every(Array.isArray) &&
        (backup.pending || !cachedDb)
      ) {
        dbRef.current = backupDb;
        setDb(backupDb);
        localSavePending.current = Boolean(backup.pending);
      }
    } catch {
      localStorage.removeItem("angel-detailing-db");
    }
    loadData();
    const timer = window.setInterval(() => loadData(), 30000);
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
    setLoadingMessage("Выполняется вход...");
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
    } finally {
      setLoadingMessage(null);
    }
  };
  const logout = async () => {
    setLoadingMessage("Выход из системы...");
    try {
      await fetch("/api/auth", { method: "DELETE" });
      setUser(null);
      setPage("home");
      dbRef.current = EMPTY_DB;
      setDb(EMPTY_DB);
    } finally {
      setLoadingMessage(null);
    }
  };
  const navigate = (next) => {
    setPage(next);
    setMenuOpen(false);
  };
  const sorted = (items, key, defaultDirection = 1) => {
    const activeKey = sort.key || key;
    return [...items].sort((a, b) => {
      if (activeKey === "datetime" || activeKey === "date") {
        const dateA = parseDate(a[activeKey])?.getTime() || 0;
        const dateB = parseDate(b[activeKey])?.getTime() || 0;
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
          dataRevision.current += 1;
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
    const todayPeriod = currentPeriod();
    const inCurrentMonth = (item) => periodKeyFor(item) === todayPeriod.periodKey;
    const income = sumAmounts(db.incomes);
    const incomeMonth = sumAmounts(db.incomes.filter(inCurrentMonth));
    const commonExpenses = sumAmounts(
      db.expenses.filter((item) => item.source !== "Личные средства"),
    );
    const expensesMonth = sumAmounts(
      db.expenses.filter(
        (item) => inCurrentMonth(item) && item.source !== "Личные средства",
      ),
    );
    const personal = sumAmounts(
      db.expenses.filter((item) => item.source === "Личные средства"),
    );
    const personalMonth = sumAmounts(
      db.expenses.filter(
        (item) => inCurrentMonth(item) && item.source === "Личные средства",
      ),
    );
    const withdrawals = sumAmounts(db.withdrawals);
    const lowStock = db.warehouse.filter(
      (item) => Number(item.qty || 0) <= Number(item.minQty ?? 2),
    );
    return {
      income,
      incomeMonth,
      commonExpenses,
      expensesMonth,
      personal,
      personalMonth,
      withdrawals,
      lowStock,
      profit: subtractAmounts(income, commonExpenses),
      cash: subtractAmounts(subtractAmounts(income, commonExpenses), withdrawals),
    };
  }, [db]);
  const period = useMemo(() => {
    const income = sumAmounts(db.incomes.filter((item) => matchesPeriod(item, profitMonth)));
    const expenses = sumAmounts(
      db.expenses.filter(
        (item) => matchesPeriod(item, profitMonth) && item.source !== "Личные средства",
      ),
    );
    const personal = sumAmounts(
      db.expenses.filter(
        (item) => matchesPeriod(item, profitMonth) && item.source === "Личные средства",
      ),
    );
    const withdrawals = sumAmounts(
      db.withdrawals.filter((item) => matchesPeriod(item, profitMonth)),
    );
    return {
      income,
      expenses,
      personal,
      withdrawals,
      profit: subtractAmounts(income, expenses),
    };
  }, [db, profitMonth]);
  const years = useMemo(() => financeYears(db), [db]);
  const monthly = useMemo(
    () =>
      MONTHS.map((month, index) => {
        const key = `${reportYear}-${String(index + 1).padStart(2, "0")}`;
        const income = sumAmounts(
          db.incomes.filter((item) => periodKeyFor(item) === key),
        );
        const expenses = sumAmounts(
          db.expenses.filter(
            (item) =>
              periodKeyFor(item) === key && item.source !== "Личные средства",
          ),
        );
        return { month, income, expenses, profit: centsToAmount(amountToCents(income) - amountToCents(expenses)) };
      }),
    [db, reportYear],
  );
  const pageContent = useMemo(
    () => (
      <PageContent
        page={page}
        db={db}
        user={user}
        sync={sync}
        totals={totals}
        monthly={monthly}
        years={years}
        reportYear={reportYear}
        setReportYear={setReportYear}
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
      years,
      reportYear,
      period,
      profitMonth,
      sync,
      clientQuery,
      clientStatus,
      navigate,
      sort,
    ],
  );

  if (!user)
    return (
      <>
        <Auth
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          password={password}
          setPassword={setPassword}
          error={authError}
          onSubmit={login}
          loading={!sessionChecked}
        />
        {(!sessionChecked || loadingMessage) && (
          <LoadingOverlay message={loadingMessage || "Проверка сессии..."} />
        )}
      </>
    );
  return (
    <>
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
            {NAV_GROUPS.map((group) => (
              <div className="nav-section" key={group.title}>
                <span className="nav-section-title">{group.title}</span>
                {group.items.map((id) => {
                  const [, label, Icon] = NAV.find((item) => item[0] === id);
                  return (
                    <button
                      key={id}
                      className={`nav-item ${page === id ? "active" : ""}`}
                      onClick={() => navigate(id)}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
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
            <div className="global-search-wrap">
              <Search size={17} />
              <input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setGlobalSearch("");
                  if (event.key === "Enter" && globalSearch.trim()) {
                    const match = db.clients.find((client) =>
                      [client.car, client.phone, client.service].some((value) =>
                        String(value || "").toLocaleLowerCase("ru").includes(globalSearch.trim().toLocaleLowerCase("ru")),
                      ),
                    );
                    if (match) {
                      setGlobalSearch("");
                      setModal({ type: "client-profile", item: match });
                    }
                  }
                }}
                placeholder="Поиск клиента..."
                aria-label="Поиск клиента по имени, авто или телефону"
              />
              {globalSearch.trim() && (
                <div className="global-search-results">
                  {db.clients
                    .filter((client) =>
                      [client.car, client.phone, client.service].some((value) =>
                        String(value || "").toLocaleLowerCase("ru").includes(globalSearch.trim().toLocaleLowerCase("ru")),
                      ),
                    )
                    .slice(0, 6)
                    .map((client) => (
                      <button
                        type="button"
                        key={client.id}
                        onClick={() => {
                          setGlobalSearch("");
                          setModal({ type: "client-profile", item: client });
                        }}
                      >
                        <CarFront size={16} />
                        <span><strong>{client.car}</strong><small>{client.phone || client.service || "Клиент"}</small></span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  {!db.clients.some((client) =>
                    [client.car, client.phone, client.service].some((value) =>
                      String(value || "").toLocaleLowerCase("ru").includes(globalSearch.trim().toLocaleLowerCase("ru")),
                    ),
                  ) && <p>Совпадений не найдено</p>}
                </div>
              )}
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
        {modal?.type === "client-profile" ? (
          <ClientProfile
            client={modal.item}
            db={db}
            onClose={() => setModal(null)}
            onEdit={() => setModal({ type: "client", item: modal.item })}
            onPayment={() => setModal({ type: "income", preset: { clientId: modal.item.id } })}
            onDebt={() => setModal({ type: "debt", preset: { clientId: modal.item.id } })}
          />
        ) : modal && (
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
      {loadingMessage && <LoadingOverlay message={loadingMessage} />}
    </>
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
  sync,
  totals,
  monthly,
  years,
  reportYear,
  setReportYear,
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
        user={user}
        totals={totals}
        monthly={monthly}
        sync={sync}
        years={years}
        reportYear={reportYear}
        setReportYear={setReportYear}
        reload={reload}
        exportData={exportData}
        importData={importData}
        navigate={navigate}
        openModal={openModal}
      />
    );
  if (page === "analytics")
    return (
      <AnalyticsPage
        db={db}
        totals={totals}
        monthly={monthly}
        years={years}
        reportYear={reportYear}
        setReportYear={setReportYear}
      />
    );
  if (page === "services") return <ServicesPage db={db} mutate={mutate} user={user} />;
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
        openProfile={(client) => openModal({ type: "client-profile", item: client })}
      />
    );
  if (page === "calendar")
    return <CalendarPage db={db} openModal={openModal} />;
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
        years={years}
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
        user={user}
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

function AnalyticsPage({ db, totals, monthly, years, reportYear, setReportYear }) {
  const annualIncome = sumAmounts(monthly, (item) => item.income);
  const annualExpenses = sumAmounts(monthly, (item) => item.expenses);
  const annualProfit = subtractAmounts(annualIncome, annualExpenses);
  const previousYear = String(Number(reportYear) - 1);
  const previousIncome = sumAmounts(
    db.incomes.filter((item) => periodKeyFor(item).startsWith(`${previousYear}-`)),
  );
  const revenueDelta = previousIncome
    ? ((annualIncome - previousIncome) / previousIncome) * 100
    : null;
  const averageTicket = db.incomes.length
    ? centsToAmount(Math.round(amountToCents(annualIncome) / Math.max(
        db.incomes.filter((item) => periodKeyFor(item).startsWith(`${reportYear}-`)).length,
        1,
      )))
    : 0;
  const completedAppointments = db.clients.filter(
    (client) => client.status === "Выполнено" && parseDate(client.datetime)?.getFullYear() === Number(reportYear),
  ).length;
  const categories = Object.entries(
    db.expenses
      .filter((item) => periodKeyFor(item).startsWith(`${reportYear}-`) && item.source !== "Личные средства")
      .reduce((result, item) => {
        const key = item.category || "Без категории";
        result[key] = (result[key] || 0) + amountToCents(item.amount);
        return result;
      }, {}),
  )
    .map(([name, cents]) => ({ name, amount: centsToAmount(cents) }))
    .sort((first, second) => second.amount - first.amount)
    .slice(0, 5);
  const bestMonth = [...monthly].sort((first, second) => second.profit - first.profit)[0];
  return (
    <div className="analytics-page">
      <section className="analytics-hero">
        <div>
          <span className="dashboard-kicker">BUSINESS INTELLIGENCE · {reportYear}</span>
          <h2>Цифры, которые помогают расти.</h2>
          <p>Выручка, расходы, динамика и поведение бизнеса без догадок.</p>
        </div>
        <label className="analytics-year-picker">
          <span>Отчётный год</span>
          <select value={reportYear} onChange={(event) => setReportYear(event.target.value)}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </section>
      <section className="analytics-kpis">
        <article className="analytics-kpi featured">
          <span><CircleDollarSign size={17} /> Выручка за год</span>
          <strong>{money(annualIncome)}</strong>
          <small>{revenueDelta === null ? "Нет данных за прошлый год" : `${revenueDelta >= 0 ? "+" : ""}${revenueDelta.toFixed(1)}% к ${previousYear}`}</small>
        </article>
        <article className="analytics-kpi"><span>Операционная прибыль</span><strong>{money(annualProfit)}</strong><small>Выручка минус общие расходы</small></article>
        <article className="analytics-kpi"><span>Средняя оплата</span><strong>{money(averageTicket)}</strong><small>За одну запись об оплате</small></article>
        <article className="analytics-kpi"><span>Выполнено услуг</span><strong>{completedAppointments}</strong><small>Записи со статусом «Выполнено»</small></article>
      </section>
      <section className="analytics-layout">
        <article className="card analytics-chart-card">
          <div className="card-header"><span>Денежный поток</span><span className="analytics-subtitle">По месяцам · {reportYear}</span></div>
          <div className="analytics-legend"><span><i className="legend-income" />Выручка</span><span><i className="legend-expenses" />Расходы</span><span><i className="legend-profit" />Прибыль</span></div>
          <MonthlyChart data={monthly} />
        </article>
        <article className="card analytics-insight-card">
          <div className="card-header"><span>Главный результат</span><Sparkles size={18} /></div>
          <div className="insight-highlight">
            <small>САМЫЙ ПРИБЫЛЬНЫЙ МЕСЯЦ</small>
            <strong>{bestMonth?.month || "—"}</strong>
            <span>{money(bestMonth?.profit || 0)} прибыли</span>
          </div>
          <div className="insight-row"><span>Баланс кассы сейчас</span><strong>{money(totals.cash)}</strong></div>
          <div className="insight-row"><span>Активные долги</span><strong>{money(sumAmounts(db.debts.filter((debt) => !debt.paid)))}</strong></div>
          <div className="insight-row"><span>Позиции с низким запасом</span><strong>{totals.lowStock.length}</strong></div>
        </article>
      </section>
      <section className="analytics-bottom-grid">
        <article className="card">
          <div className="card-header"><span>Куда уходят деньги</span><Receipt size={17} /></div>
          {categories.length ? categories.map((category, index) => {
            const share = annualExpenses ? (category.amount / annualExpenses) * 100 : 0;
            return <div className="category-analytics" key={category.name}><div><span>{category.name}</span><strong>{money(category.amount)}</strong></div><i><b style={{ width: `${Math.min(100, share)}%` }} /></i></div>;
          }) : <div className="empty-reminder">Расходов за этот год пока нет</div>}
        </article>
        <article className="card">
          <div className="card-header"><span>Что важно сейчас</span><Activity size={17} /></div>
          <div className="analytics-action"><span className="analytics-action-icon"><Clock3 size={16} /></span><div><strong>Записи на ближайшую неделю</strong><small>{db.clients.filter((client) => { const date = parseDate(client.datetime); return date && date >= new Date() && date < new Date(Date.now() + 7 * 86400000); }).length} запланировано</small></div></div>
          <div className="analytics-action"><span className="analytics-action-icon"><Package size={16} /></span><div><strong>Низкий остаток на складе</strong><small>{totals.lowStock.length ? totals.lowStock.map((item) => item.name).join(", ") : "Всё в норме"}</small></div></div>
          <div className="analytics-action"><span className="analytics-action-icon"><Check size={16} /></span><div><strong>Маржа за год</strong><small>{annualIncome ? `${((annualProfit / annualIncome) * 100).toFixed(1)}% от выручки` : "Добавьте оплаты и расходы"}</small></div></div>
        </article>
      </section>
    </div>
  );
}

function ServicesPage({ db, mutate, user }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", price: "", duration: "60", description: "" });
  const clearForm = () => {
    setEditingId(null);
    setForm({ name: "", price: "", duration: "60", description: "" });
  };
  const save = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !validPositiveAmount(form.price)) return alert("Укажите название услуги и цену больше нуля.");
    if (!Number.isInteger(Number(form.duration)) || Number(form.duration) <= 0) return alert("Длительность укажите в целых минутах.");
    const service = { ...form, id: editingId || createId(), name: form.name.trim(), price: centsToAmount(amountToCents(form.price)), duration: Number(form.duration), author: user };
    mutate({ services: editingId ? db.services.map((item) => item.id === editingId ? service : item) : [service, ...db.services] }, `${editingId ? "Изменена" : "Добавлена"} услуга: ${service.name}`);
    clearForm();
  };
  return (
    <div className="services-page">
      <section className="services-hero"><span className="dashboard-kicker">SERVICE MENU · PRICE BOOK</span><h2>Услуги с понятной ценой.</h2><p>Единый прайс ускоряет запись и автоматически подставляет стоимость клиенту.</p><div className="services-hero-count"><Sparkles size={18} /><strong>{db.services.length}</strong><span>позиций в прайсе</span></div></section>
      <div className="services-layout">
        <form className="card service-form" onSubmit={save}>
          <div className="card-header"><span>{editingId ? "Редактировать услугу" : "Новая услуга"}</span>{editingId && <button className="text-action" type="button" onClick={clearForm}>Отмена</button>}</div>
          <Field label="Название услуги"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Например, химчистка салона" /></Field>
          <div className="form-grid"><Field label="Цена (MDL)"><input type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="1500" /></Field><Field label="Длительность (мин.)"><input type="number" min="1" step="1" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /></Field></div>
          <Field label="Короткое описание"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Что входит в услугу" /></Field>
          <Button icon={Save}>{editingId ? "Сохранить изменения" : "Добавить в прайс"}</Button>
        </form>
        <section className="service-catalog">
          {db.services.length ? db.services.map((service) => (
            <article className="service-card" key={service.id}>
              <div className="service-card-icon"><Sparkles size={18} /></div><div className="service-card-main"><div className="service-card-heading"><h3>{service.name}</h3><strong>{money(service.price)}</strong></div><p>{service.description || "Профессиональный уход за автомобилем"}</p><span><Clock3 size={13} /> {service.duration} мин.</span></div>
              <div className="service-card-actions"><button className="btn-sm btn-edit" type="button" onClick={() => { setEditingId(service.id); setForm({ name: service.name, price: String(service.price), duration: String(service.duration), description: service.description || "" }); }} aria-label="Изменить услугу"><Pencil size={14} /></button><DeleteButton onClick={() => confirm(`Удалить услугу «${service.name}» из прайса? Существующие записи останутся без изменений.`) && mutate({ services: db.services.filter((item) => item.id !== service.id) }, `Удалена услуга из прайса: ${service.name}`)} /></div>
            </article>
          )) : <div className="card services-empty"><Sparkles size={24} /><h3>Прайс-лист пока пуст</h3><p>Добавьте первую услугу. Цена будет подставляться в запись клиента автоматически.</p></div>}
        </section>
      </div>
    </div>
  );
}

function ClientProfile({ client, db, onClose, onEdit, onPayment, onDebt }) {
  if (!client) return null;
  const phoneKey = String(client.phone || "").replace(/\D/g, "");
  const relatedClients = db.clients.filter((row) => row.id === client.id || (phoneKey && String(row.phone || "").replace(/\D/g, "") === phoneKey));
  const relatedIds = new Set(relatedClients.map((row) => clientIdKey(row.id)));
  const payments = db.incomes.filter((item) => relatedIds.has(clientIdKey(item.clientId))).sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0));
  const debts = db.debts.filter((item) => relatedIds.has(clientIdKey(item.clientId)));
  const paid = sumAmounts(payments);
  const openBalance = sumAmounts(relatedClients, (visit) => outstandingForClient(db, visit));
  return (
    <Modal title="Карточка клиента" onClose={onClose}>
      <div className="client-profile-head"><div className="client-avatar"><CarFront size={25} /></div><div><span className="dashboard-kicker">CLIENT PROFILE</span><h2>{client.car}</h2><p>{client.phone || "Телефон не указан"}</p></div><Badge status={statusClass(client.status)}>{client.status}</Badge></div>
      <div className="client-profile-actions"><Button variant="secondary" icon={Pencil} onClick={onEdit}>Запись</Button><Button icon={CircleDollarSign} onClick={onPayment} disabled={!getUnpaidClients(db).some((row) => clientIdKey(row.id) === clientIdKey(client.id))}>Принять оплату</Button><Button variant="secondary" icon={Plus} onClick={onDebt}>Добавить долг</Button></div>
      <div className="client-profile-stats"><div><span>Оплачено</span><strong>{money(paid)}</strong></div><div><span>Остаток к оплате</span><strong>{money(openBalance)}</strong></div><div><span>Визитов</span><strong>{relatedClients.length}</strong></div></div>
      <section className="profile-section"><div className="card-header">Последние визиты</div>{relatedClients.slice().sort((a, b) => (parseDate(b.datetime)?.getTime() || 0) - (parseDate(a.datetime)?.getTime() || 0)).map((visit) => <div className="profile-history-row" key={visit.id}><span><strong>{visit.service || "Услуга не указана"}</strong><small>{dateText(visit.datetime)}</small></span><Badge status={statusClass(visit.status)}>{visit.status}</Badge><strong>{visit.servicePrice ? money(visit.servicePrice) : "Цена не указана"}</strong></div>)}</section>
      <section className="profile-section"><div className="card-header">История оплат</div>{payments.length ? payments.slice(0, 8).map((payment) => <div className="profile-history-row" key={payment.id}><span><strong>{payment.debtId ? "Погашение долга" : "Оплата услуги"}</strong><small>{dateText(payment.date)}</small></span><strong className="positive">+{money(payment.amount)}</strong></div>) : <div className="empty-reminder">Оплат пока нет</div>}</section>
      {client.phone && <a className="client-call-link" href={`tel:${client.phone}`}>Позвонить клиенту <ArrowRight size={14} /></a>}
    </Modal>
  );
}

function Dashboard({
  db,
  user,
  totals,
  monthly,
  sync,
  years,
  reportYear,
  setReportYear,
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
      "Остаток к оплате",
      sumAmounts(getUnpaidClients(db), (client) => outstandingForClient(db, client)),
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
              {today.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })} · ВСЁ ПОД КОНТРОЛЕМ
            </span>
            <h2>Хорошего дня, {user}.</h2>
            <p>Вот что происходит в мастерской сегодня.</p>
          </div>
          <div className={`dashboard-live ${sync.includes("Ошибка") ? "sync-error" : sync.includes("Сохранено") || sync.includes("Google OK") ? "" : "sync-pending"}`}>
            <span /> {sync}
          </div>
        </div>
        <div className="dashboard-actions">
          <Button icon={CalendarPlus} onClick={() => openModal({ type: "client" })}>
            Новая запись
          </Button>
          <Button variant="secondary" icon={ChartNoAxesCombined} onClick={() => navigate("analytics")}>
            Аналитика
          </Button>
          <Button variant="secondary" icon={Sparkles} onClick={() => navigate("services")}>
            Прайс-лист
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={reload} title="Обновить данные" aria-label="Обновить данные" />
          <Button variant="secondary" icon={FileText} onClick={() => window.print()} title="Сформировать PDF" aria-label="Сформировать PDF" />
          <details className="dashboard-tools">
            <summary><Save size={15} /> Бэкап</summary>
            <div>
              <button type="button" onClick={exportData}>Скачать резервную копию</button>
              <label>Восстановить из файла<input type="file" accept="application/json,.json" onChange={importData} /></label>
            </div>
          </details>
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
                : label === "Остаток к оплате"
                  ? "по заданным ценам и долгам"
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
        reportYear={reportYear}
      />
      <FinancialInsights
        db={db}
        totals={totals}
        monthly={monthly}
        years={years}
        reportYear={reportYear}
        setReportYear={setReportYear}
      />
    </div>
  );
}

function DebtorsPreview({ db, navigate }) {
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const total = sumAmounts(activeDebts);
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
    .filter((slot) => parseDate(slot.datetime)?.getTime() > Date.now())
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const total = sumAmounts(activeDebts);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filteredDebts = db.debts.filter((debt) => {
    const client = db.clients.find(
      (row) => clientIdKey(row.id) === clientIdKey(debt.clientId),
    );
    return (
      (filter === "all" || (filter === "paid" ? debt.paid : !debt.paid)) &&
      (!normalizedQuery ||
        `${client?.car || ""} ${debt.comment || ""}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery))
    );
  });
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
            <strong>{new Set(activeDebts.map((debt) => clientIdKey(debt.clientId))).size}</strong>
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
        <div className="filter-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по клиенту или комментарию..."
            aria-label="Поиск долгов"
          />
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Фильтр долгов">
            <option value="all">Все долги</option>
            <option value="open">Открытые</option>
            <option value="paid">Погашенные</option>
          </select>
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
          {sort(filteredDebts, "date", -1).map((debt) => {
            const client = db.clients.find(
              (row) => clientIdKey(row.id) === clientIdKey(debt.clientId),
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
                <td>{dateText(debt.date)}</td>
                <td>
                  <Actions
                    onEdit={() => openModal({ type: "debt", item: debt })}
                    onDelete={() => {
                      const linkedPayment = db.incomes.some(
                        (income) =>
                          clientIdKey(income.debtId) === clientIdKey(debt.id) ||
                          income.debtAllocations?.some(
                            (allocation) =>
                              clientIdKey(allocation.debtId) === clientIdKey(debt.id),
                          ),
                      );
                      if (linkedPayment)
                        return alert("Нельзя удалить долг, связанный с оплатой. Сначала удалите связанную оплату из истории.");
                      if (confirm("Удалить долг?"))
                        mutate(
                          { debts: db.debts.filter((row) => row.id !== debt.id) },
                          `Удален долг: ${client?.car || debt.clientId}`,
                        );
                    }}
                  />
                </td>
              </tr>
            );
          })}
          {!filteredDebts.length && <EmptyRow colSpan={7}>Нет долгов по выбранному фильтру</EmptyRow>}
        </Table>
      </section>
    </>
  );
}

function FinancialInsights({ db, totals, monthly, years, reportYear, setReportYear }) {
  const annualIncome = sumAmounts(monthly.map((item) => ({ amount: item.income })));
  const annualExpenses = sumAmounts(monthly.map((item) => ({ amount: item.expenses })));
  const annualProfit = subtractAmounts(annualIncome, annualExpenses);
  const annualPersonal = sumAmounts(
    db.expenses.filter(
      (item) => periodKeyFor(item).startsWith(`${reportYear}-`) && item.source === "Личные средства",
    ),
  );
  const annualWithdrawals = sumAmounts(
    db.withdrawals.filter((item) => periodKeyFor(item).startsWith(`${reportYear}-`)),
  );
  const values = [
    ["Доходы", annualIncome, "income"],
    ["Затраты", annualExpenses, "expenses"],
    ["Прибыль", annualProfit, "profit"],
  ];
  const maximum = Math.max(...values.map(([, value]) => Math.abs(value)), 1);
  return (
    <section className="card financial-insights finance-board">
      <div className="finance-board-heading">
        <div>
          <span className="dashboard-kicker">
            Финансовый обзор · {reportYear}
          </span>
          <h3>Доходы и прибыль</h3>
              <p>Сравнение показателей за выбранный год</p>
        </div>
        <div className="finance-report-controls">
          <select
            aria-label="Год финансового отчёта"
            value={reportYear}
            onChange={(event) => setReportYear(event.target.value)}
          >
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <TrendingUp size={20} className="red-icon" />
        </div>
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
            <strong className={annualProfit >= 0 ? "positive" : "negative"}>
              {money(annualProfit)}
            </strong>
            <small>Доходы минус затраты за {reportYear} год</small>
          </div>
          <div className="finance-side-list">
            <div>
              <span>Баланс кассы сейчас</span>
              <strong className="cyan-text">{money(totals.cash)}</strong>
            </div>
            <div>
              <span>Клиентов</span>
              <strong>{db.clients.length}</strong>
            </div>
            <div>
              <span>Личные средства</span>
              <strong className="info-text">{money(annualPersonal)}</strong>
            </div>
            <div>
              <span>Выведено</span>
              <strong className="warning-text">
                {money(annualWithdrawals)}
              </strong>
            </div>
          </div>
        </div>
      </div>
      <MonthlyChart data={monthly} embedded />
    </section>
  );
}

function PrintReport({ db, totals, todayAppointments, monthly, reportYear }) {
  const activeDebts = db.debts.filter((debt) => !debt.paid);
  const debtTotal = sumAmounts(activeDebts);
  const availableWindows = db.windows
    .filter((slot) => parseDate(slot.datetime))
    .sort(
      (first, second) => parseDate(first.datetime) - parseDate(second.datetime),
    )
    .slice(0, 6);
  return (
    <section className="print-report">
      <div className="print-report-header">
        <div>
          <span className="print-report-kicker">
            ANGEL DETAILING · CONTROL CENTER
          </span>
          <h1>Операционный отчёт</h1>
          <p>Сформирован {dateText(new Date())}</p>
        </div>
        <img src="/angel-logo.png" alt="ANGEL DETAILING" />
      </div>
      <div className="print-report-grid">
        <div>
          <span>Баланс кассы</span>
          <strong>{money(totals.cash)}</strong>
        </div>
        <div>
          <span>Доходы всего</span>
          <strong>{money(totals.income)}</strong>
        </div>
        <div>
          <span>Затраты всего</span>
          <strong>{money(totals.commonExpenses)}</strong>
        </div>
        <div>
          <span>Чистая прибыль</span>
          <strong>{money(totals.profit)}</strong>
        </div>
      </div>
      <div className="print-report-secondary">
        <div>
          <span>Клиентов</span>
          <strong>{db.clients.length}</strong>
        </div>
        <div>
          <span>Долги к погашению</span>
          <strong>{money(debtTotal)}</strong>
        </div>
        <div>
          <span>Свободных окон</span>
          <strong>{db.windows.length}</strong>
        </div>
      </div>
      <div className="print-chart">
        <div className="print-chart-heading">
          <h2>Динамика по месяцам · {reportYear}</h2>
          <span>Доходы · затраты · прибыль</span>
        </div>
        <div className="print-chart-grid">
          {monthly.map((item) => (
            <div className="print-chart-column" key={item.month}>
              <div className="print-chart-bars">
                <i
                  className="income"
                  style={{
                    height: `${Math.max(3, (item.income / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%`,
                  }}
                />
                <i
                  className="expenses"
                  style={{
                    height: `${Math.max(3, (item.expenses / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%`,
                  }}
                />
                <i
                  className="profit"
                  style={{
                    height: `${Math.max(3, (Math.abs(item.profit) / Math.max(...monthly.map((row) => Math.max(row.income, row.expenses, Math.abs(row.profit))), 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>{item.month.slice(0, 3)}</span>
            </div>
          ))}
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
          {activeDebts.length ? (
            activeDebts.slice(0, 6).map((debt) => {
              const client = db.clients.find(
                (row) => String(row.id) === String(debt.clientId),
              );
              return (
                <div className="print-list-row" key={debt.id}>
                  <span>{client?.car || "Клиент"}</span>
                  <strong>{money(debt.amount)}</strong>
                </div>
              );
            })
          ) : (
            <p>Активных долгов нет.</p>
          )}
        </div>
        <div>
          <h2>Свободные окна</h2>
          {availableWindows.length ? (
            availableWindows.map((slot) => (
              <div className="print-list-row" key={slot.id}>
                <span>{dateText(slot.datetime).split(" ")[0]}</span>
                <strong>{dateText(slot.datetime).slice(11)}</strong>
              </div>
            ))
          ) : (
            <p>Свободных окон нет.</p>
          )}
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
function Actions({ onEdit, onDelete, onView }) {
  return (
    <span className="actions">
      {onView && (
        <button
          className="btn-sm btn-view"
          onClick={onView}
          title="Открыть карточку клиента"
          aria-label="Открыть карточку клиента"
        >
          <Eye size={13} />
        </button>
      )}
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

const startOfWeek = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
};
const localDateTimeValue = (date) => {
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function CalendarPage({ db, openModal }) {
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week);
    date.setDate(week.getDate() + index);
    return date;
  });
  const appointments = db.clients.filter((client) => parseDate(client.datetime));
  const rangeLabel = `${dateText(days[0]).slice(0, 10)} — ${dateText(days[6]).slice(0, 10)}`;
  return (
    <section className="card calendar-card">
      <div className="card-header calendar-header">
        <div>
          <strong>Расписание на неделю</strong>
          <span>{rangeLabel}</span>
        </div>
        <div className="calendar-controls">
          <button
            className="btn-sm btn-qty"
            type="button"
            aria-label="Предыдущая неделя"
            onClick={() => setWeek((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7))}
          >←</button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setWeek(startOfWeek(new Date()))}
          >Сегодня</Button>
          <button
            className="btn-sm btn-qty"
            type="button"
            aria-label="Следующая неделя"
            onClick={() => setWeek((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7))}
          >→</button>
        </div>
      </div>
      <div className="calendar-week-grid">
        {days.map((day) => {
          const dayAppointments = appointments
            .filter((client) => isSameDay(client.datetime, day))
            .sort((first, second) => parseDate(first.datetime) - parseDate(second.datetime));
          const suggestedTime = new Date(day);
          suggestedTime.setHours(day.toDateString() === new Date().toDateString() ? new Date().getHours() + 1 : 9, 0, 0, 0);
          return (
            <article className="calendar-day" key={day.toISOString()}>
              <div className="calendar-day-heading">
                <strong>{day.toLocaleDateString("ru-RU", { weekday: "short" })}</strong>
                <span>{day.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</span>
              </div>
              <div className="calendar-day-events">
                {dayAppointments.map((client) => (
                  <button
                    className={`calendar-event ${statusClass(client.status)}`}
                    type="button"
                    key={client.id}
                    onClick={() => openModal({ type: "client", item: client })}
                  >
                    <strong>{dateText(client.datetime).slice(11)} · {client.car}</strong>
                    <span>{client.service || client.phone || "Услуга не указана"}</span>
                    <Badge status={statusClass(client.status)}>{client.status}</Badge>
                  </button>
                ))}
                {!dayAppointments.length && <span className="calendar-empty">Нет записей</span>}
              </div>
              <button
                className="calendar-add"
                type="button"
                onClick={() => openModal({ type: "client", preset: { datetime: localDateTimeValue(suggestedTime) } })}
              >+ Записать</button>
            </article>
          );
        })}
      </div>
    </section>
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
  openProfile,
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
          "Статус записи",
          "Оплата",
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
            "payment",
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
              {(() => {
                const received = totalPaidForClient(db.incomes, client.id);
                const outstanding = outstandingForClient(db, client);
                const label = outstanding > 0
                  ? received > 0 ? "Частично" : "Ожидает"
                  : received > 0 ? "Оплачено" : "Не оплачено";
                return (
                  <Badge status={label === "Оплачено" ? "done" : label === "Частично" ? "waiting" : "cancelled"}>
                    {label}
                  </Badge>
                );
              })()}
            </td>
            <td>
              <Badge>{client.author || "TUDOR"}</Badge>
            </td>
            <td>{client.comment || "-"}</td>
            <td>
              <Actions
                onView={() => openProfile(client)}
                onEdit={() => openModal({ type: "client", item: client })}
                onDelete={() => {
                  const hasFinancialHistory =
                    db.incomes.some(
                      (income) => clientIdKey(income.clientId) === clientIdKey(client.id),
                    ) ||
                    db.debts.some(
                      (debt) => clientIdKey(debt.clientId) === clientIdKey(client.id),
                    );
                  if (hasFinancialHistory)
                    return alert("Нельзя удалить клиента с историей оплат или долгов. Измените статус записи вместо удаления.");
                  if (confirm("Удалить эту запись?"))
                    mutate(
                      { clients: db.clients.filter((item) => item.id !== client.id) },
                      `Удален клиент: ${client.car}`,
                    );
                }}
              />
            </td>
          </tr>
        ))}
          {!filteredClients.length && (
          <EmptyRow colSpan={10}>Нет клиентов по выбранным фильтрам</EmptyRow>
        )}
      </Table>
    </section>
  );
}

function Expenses({ db, sort, sortBy, mutate }) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [form, setForm] = useState({
    category: "",
    amount: "",
    month: currentMonth(),
    year: String(new Date().getFullYear()),
    source: "Общие",
    comment: "",
  });
  const update = (event) =>
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const save = (event) => {
    event.preventDefault();
    if (!form.category.trim() || !validPositiveAmount(form.amount))
      return alert("Укажите категорию и положительную сумму в MDL!");
    const transactionDate = new Date();
    const periodKey = `${form.year}-${String(MONTHS.indexOf(form.month) + 1).padStart(2, "0")}`;
    mutate(
      {
        expenses: [
          {
            ...form,
            id: createId(),
            amount: centsToAmount(amountToCents(form.amount)),
            date: transactionDate.toISOString(),
            periodKey,
            year: Number(form.year),
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
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={update}
              placeholder="1500"
            />
          </Field>
          <Field label="Месяц">
            <MonthSelect name="month" value={form.month} onChange={update} />
          </Field>
          <Field label="Год">
            <select name="year" value={form.year} onChange={update}>
              {financeYears(db).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
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
        <div className="filter-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по категории или комментарию..."
            aria-label="Поиск расходов"
          />
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Фильтр источника расходов">
            <option value="all">Все источники</option>
            <option value="Общие">Из кассы</option>
            <option value="Личные средства">Личные средства</option>
          </select>
        </div>
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
          {sort(
            db.expenses.filter((item) => {
              const search = query.trim().toLocaleLowerCase("ru");
              return (
                (sourceFilter === "all" || item.source === sourceFilter) &&
                (!search || `${item.category || ""} ${item.comment || ""}`.toLocaleLowerCase("ru").includes(search))
              );
            }),
            "date",
          ).map((item) => (
            <tr key={item.id}>
              <td>{dateText(item.date)}</td>
              <td>{monthLabel(periodKeyFor(item))}</td>
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
          {!db.expenses.filter((item) =>
            (sourceFilter === "all" || item.source === sourceFilter) &&
            (!query.trim() || `${item.category || ""} ${item.comment || ""}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))),
          ).length && <EmptyRow colSpan={8} />}
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
  years,
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
          <div className="report-actions">
            <Button
              variant="secondary"
              icon={FileText}
              onClick={() => exportFinancialCsv(db, month)}
            >
              CSV
            </Button>
            <Button
              onClick={() => openModal({ type: "income" })}
              disabled={!getUnpaidClients(db).length}
            >
              + Оплата
            </Button>
          </div>
        </div>
        <Field label="Выберите период">
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            <option value="all">За всё время</option>
            {years.map((year) => (
              <optgroup key={year} label={year}>
                <option value={year}>Весь {year} год</option>
                {MONTHS.map((name, index) => {
                  const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                  return <option key={key} value={key}>{name}</option>;
                })}
              </optgroup>
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
        <div className="card-header">История оплат</div>
        <Table
          sortBy={sortBy}
          headers={[
            "Дата",
            "Клиент",
            "Сумма",
            "Статус записи",
            "Автор",
            "Действия",
          ].map((label, i) => [
            label,
            ["date", "clientId", "amount", "author"][i],
          ])}
        >
          {sort(db.incomes.filter((item) => matchesPeriod(item, month)), "date", -1)
            .map((item) => {
              const client = db.clients.find(
                (row) => clientIdKey(row.id) === clientIdKey(item.clientId),
              );
              return (
                <tr key={item.id}>
                  <td>{dateText(item.date)}</td>
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
                        confirm("Удалить оплату?") &&
                        mutate(
                          {
                            incomes: db.incomes.filter((row) => row.id !== item.id),
                            debts: item.debtId
                              ? db.debts.map((debt) =>
                                  clientIdKey(debt.id) === clientIdKey(item.debtId)
                                    ? { ...debt, paid: false }
                                    : debt,
                                )
                              : reversePaymentFromDebts(
                                  db.debts,
                                  item.debtAllocations || [],
                                ),
                          },
                          `Удалена оплата: ${money(item.amount)}`,
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          {!db.incomes.filter((item) => matchesPeriod(item, month)).length && (
            <EmptyRow colSpan={6}>Нет оплат за выбранный период</EmptyRow>
          )}
        </Table>
      </section>
    </>
  );
}

function Warehouse({ db, sort, sortBy, openModal, mutate, user }) {
  const changeStock = (item, delta) => {
    const quantity = Number(item.qty || 0) + delta;
    if (quantity < 0) return;
    const movementDate = new Date();
    const movement = {
      id: createId(),
      itemId: item.id,
      name: item.name,
      delta,
      date: movementDate.toISOString(),
      author: user,
    };
    mutate(
      {
        warehouse: db.warehouse.map((row) =>
          row.id === item.id ? { ...row, qty: quantity } : row,
        ),
        stockMovements: [movement, ...db.stockMovements],
      },
      `Склад ${item.name}: ${delta > 0 ? "+" : ""}${delta}`,
    );
  };
  return (
    <>
      <section className="card">
        <div className="card-header">
          <span>Учет расходников (Склад)</span>
          <Button onClick={() => openModal({ type: "warehouse" })}>
            + Товар
          </Button>
        </div>
        <Table
          sortBy={sortBy}
          headers={[
            ["Расходник", "name"],
            ["В наличии", "qty"],
            ["Мин. запас", "minQty"],
            ["Автор", "author"],
            ["Движение", ""],
            ["Управление", ""],
          ]}
        >
          {sort(db.warehouse, "name").map((item) => (
            <tr key={item.id}>
              <td><strong>{item.name}</strong></td>
              <td className="quantity">{item.qty}</td>
              <td>{item.minQty ?? 2}</td>
              <td><Badge>{item.author || "TUDOR"}</Badge></td>
              <td>
                <button
                  className="btn-sm btn-qty"
                  aria-label={`Уменьшить запас: ${item.name}`}
                  disabled={Number(item.qty || 0) <= 0}
                  onClick={() => changeStock(item, -1)}
                >
                  <Minus size={13} />
                </button>{" "}
                <button
                  className="btn-sm btn-qty"
                  aria-label={`Увеличить запас: ${item.name}`}
                  onClick={() => changeStock(item, 1)}
                >
                  <Plus size={13} />
                </button>
              </td>
              <td>
                <Actions
                  onEdit={() => openModal({ type: "warehouse", item })}
                  onDelete={() =>
                    confirm("Удалить товар? История движений останется.") &&
                    mutate(
                      { warehouse: db.warehouse.filter((row) => row.id !== item.id) },
                      `Удален товар: ${item.name}`,
                    )
                  }
                />
              </td>
            </tr>
          ))}
          {!db.warehouse.length && <EmptyRow colSpan={6}>Склад пуст</EmptyRow>}
        </Table>
      </section>
      <section className="card">
        <div className="card-header">История движения склада</div>
        <Table
          sortBy={sortBy}
          headers={[["Дата", "date"], ["Товар", "name"], ["Изменение", "delta"], ["Автор", "author"]]}
        >
          {sort(db.stockMovements, "date", -1).map((movement) => (
            <tr key={movement.id}>
              <td>{dateText(movement.date)}</td>
              <td>{movement.name || "Удалённый товар"}</td>
              <td className={Number(movement.delta) >= 0 ? "positive" : "negative"}>
                {Number(movement.delta) > 0 ? "+" : ""}{movement.delta}
              </td>
              <td><Badge>{movement.author || "TUDOR"}</Badge></td>
            </tr>
          ))}
          {!db.stockMovements.length && <EmptyRow colSpan={4}>Движений пока нет</EmptyRow>}
        </Table>
      </section>
    </>
  );
}

function Withdrawals({ db, sort, sortBy, mutate }) {
  const [form, setForm] = useState({
    amount: "",
    month: currentMonth(),
    year: String(new Date().getFullYear()),
    comment: "",
  });
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = (event) => {
    event.preventDefault();
    if (!validPositiveAmount(form.amount))
      return alert("Введите положительную сумму вывода!");
    const transactionDate = new Date();
    const periodKey = `${form.year}-${String(MONTHS.indexOf(form.month) + 1).padStart(2, "0")}`;
    mutate(
      {
        withdrawals: [
          {
            ...form,
            id: createId(),
            amount: centsToAmount(amountToCents(form.amount)),
            date: transactionDate.toISOString(),
            periodKey,
            year: Number(form.year),
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
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={update}
              placeholder="2000"
            />
          </Field>
          <Field label="Месяц">
            <MonthSelect name="month" value={form.month} onChange={update} />
          </Field>
          <Field label="Год">
            <select name="year" value={form.year} onChange={update}>
              {financeYears(db).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
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
              <td>{dateText(item.date)}</td>
              <td>{monthLabel(periodKeyFor(item))}</td>
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
      ? isClient
        ? { ...item, servicePrice: item.servicePrice ?? "" }
        : { ...item }
      : isClient
        ? {
            car: "",
            phone: "",
            seatType: "",
            service: "",
            servicePrice: "",
            datetime: preset?.datetime || "",
            windowId: preset?.windowId || "",
            status: "В ожидании",
            comment: "",
          }
        : isWarehouse
          ? { name: "", qty: "", minQty: 2 }
          : isDebt
            ? {
                clientId: preset?.clientId || db.clients[0]?.id || "",
                amount: "",
                paid: false,
                comment: "",
              }
            : isWindow
              ? { datetime: "", comment: "" }
              : { clientId: preset?.clientId || getUnpaidClients(db)[0]?.id || "", amount: "" },
  );
  const paymentClients = getUnpaidClients(db);
  const update = (event) => {
    const { name, value } = event.target;
    if (name === "service") {
      const catalogItem = db.services.find((service) => service.name === value);
      setForm((current) => ({
        ...current,
        service: value,
        servicePrice: catalogItem ? String(catalogItem.price) : "",
      }));
      return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  };
  const save = (event) => {
    event.preventDefault();
    if (isClient && (!form.car || !form.datetime))
      return alert("Заполните марку авто и дату/время!");
    if (isClient) {
      const appointmentTime = parseDate(form.datetime)?.getTime();
      if (!appointmentTime) return alert("Укажите корректную дату и время записи.");
      if (
        form.servicePrice != null &&
        form.servicePrice !== "" &&
        (!Number.isFinite(Number(form.servicePrice)) || Number(form.servicePrice) < 0)
      ) return alert("Стоимость услуги должна быть нулём или положительной суммой.");
      const collision = db.clients.some((client) => {
        if (client.id === item?.id || ["Отменен", "Не пришел"].includes(client.status)) return false;
        return parseDate(client.datetime)?.getTime() === appointmentTime;
      });
      if (collision) return alert("На это время уже записан другой клиент.");
    }
    if (
      isWarehouse &&
      (!form.name.trim() ||
        !Number.isInteger(Number(form.qty)) ||
        Number(form.qty) < 0 ||
        !Number.isInteger(Number(form.minQty ?? 2)) ||
        Number(form.minQty ?? 2) < 0)
    )
      return alert("Заполните название и количество!");
    if (type === "income" && (!form.clientId || !validPositiveAmount(form.amount)))
      return alert("Выберите клиента и укажите положительную сумму оплаты!");
    if (isDebt && (!form.clientId || !validPositiveAmount(form.amount)))
      return alert("Выберите клиента и укажите сумму долга!");
    if (
      isDebt &&
      item &&
      clientIdKey(item.clientId) !== clientIdKey(form.clientId) &&
      db.incomes.some(
        (income) =>
          clientIdKey(income.debtId) === clientIdKey(item.id) ||
          income.debtAllocations?.some(
            (allocation) => clientIdKey(allocation.debtId) === clientIdKey(item.id),
          ),
      )
    ) return alert("Нельзя сменить клиента у долга с историей оплат. Создайте новый долг для другого клиента.");
    if (isWindow) {
      const windowTime = parseDate(form.datetime)?.getTime();
      if (!windowTime || windowTime <= Date.now())
        return alert("Укажите дату и время в будущем!");
      const duplicateWindow = db.windows.some(
        (slot) => slot.id !== item?.id && parseDate(slot.datetime)?.getTime() === windowTime,
      );
      const occupied = db.clients.some(
        (client) =>
          !["Отменен", "Не пришел"].includes(client.status) &&
          parseDate(client.datetime)?.getTime() === windowTime,
      );
      if (duplicateWindow || occupied)
        return alert("На это время уже есть свободное окно или запись клиента.");
    }
    if (isClient) {
      const value = {
        ...form,
        id: item?.id || createId(),
        servicePrice:
          form.servicePrice === ""
            ? ""
            : centsToAmount(amountToCents(form.servicePrice)),
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
      const itemId = item?.id || createId();
      const quantity = Number(form.qty);
      const minQty = Number(form.minQty ?? 2);
      const value = {
        ...form,
        id: itemId,
        name: form.name.trim(),
        qty: quantity,
        minQty,
        author: item?.author || user,
      };
      const delta = quantity - Number(item?.qty || 0);
      const movementDate = new Date();
      const movements = delta
        ? [
            {
              id: createId(),
              itemId,
              name: value.name,
              delta,
              date: movementDate.toISOString(),
              author: user,
            },
            ...db.stockMovements,
          ]
        : db.stockMovements;
      mutate(
        {
          warehouse: item
            ? db.warehouse.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.warehouse],
          stockMovements: movements,
        },
        `${item ? "Склад обновлён" : "Добавлен товар"}: ${form.name}`,
      );
    }
    if (type === "income") {
      const client = db.clients.find(
        (row) => clientIdKey(row.id) === clientIdKey(form.clientId),
      );
      if (!client || !paymentClients.some((row) => clientIdKey(row.id) === clientIdKey(client.id)))
        return alert("Этот клиент уже оплатил или отсутствует в списке должников.");
      if (
        amountToCents(client.servicePrice) > 0 &&
        amountToCents(form.amount) > amountToCents(outstandingForClient(db, client))
      ) return alert(`Оплата больше остатка. К оплате: ${money(outstandingForClient(db, client))}.`);
      const transactionDate = new Date();
      const allocation = applyPaymentToDebts(
        db.debts,
        client.id,
        amountToCents(form.amount),
      );
      const value = {
        id: createId(),
        clientId: client.id,
        amount: centsToAmount(amountToCents(form.amount)),
        date: transactionDate.toISOString(),
        ...currentPeriod(transactionDate),
        debtAllocations: allocation.allocations,
        author: user,
      };
      mutate(
        {
          incomes: [value, ...db.incomes],
          debts: allocation.debts,
        },
        `Оплата: +${money(value.amount)} (${client.car})`,
      );
    }
    if (isDebt) {
      const client = db.clients.find(
        (row) => clientIdKey(row.id) === clientIdKey(form.clientId),
      );
      const transactionDate = new Date();
      const value = {
        ...form,
        id: item?.id || createId(),
        clientId: client?.id ?? form.clientId,
        amount: centsToAmount(amountToCents(form.amount)),
        paid: Boolean(form.paid),
        date: item?.date || transactionDate.toISOString(),
        author: item?.author || user,
      };
      const existingDebtPayment = db.incomes.find(
        (income) => clientIdKey(income.debtId) === clientIdKey(value.id),
      );
      let incomes = db.incomes;
      if (value.paid && !existingDebtPayment) {
        incomes = [
          {
            id: createId(),
            clientId: value.clientId,
            amount: value.amount,
            date: transactionDate.toISOString(),
            ...currentPeriod(transactionDate),
            debtId: value.id,
            debtAllocations: [],
            author: user,
          },
          ...incomes,
        ];
      } else if (value.paid && existingDebtPayment) {
        incomes = incomes.map((income) =>
          income.id === existingDebtPayment.id
            ? { ...income, clientId: value.clientId, amount: value.amount }
            : income,
        );
      } else if (!value.paid && existingDebtPayment) {
        incomes = incomes.filter((income) => income.id !== existingDebtPayment.id);
      }
      mutate(
        {
          incomes,
          debts: item
            ? db.debts.map((row) => (row.id === item.id ? value : row))
            : [value, ...db.debts],
        },
        `${item ? (value.paid ? "Погашен долг" : "Изменен долг") : "Добавлен долг"}: ${client?.car || form.clientId}`,
      );
    }
    if (isWindow) {
      const value = { ...form, id: item?.id || createId() };
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
                : "Добавить оплату"
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
                list="service-catalog-options"
                value={form.service}
                onChange={update}
                placeholder="Детейлинг / Химчистка"
              />
              <datalist id="service-catalog-options">
                {db.services.map((service) => <option key={service.id} value={service.name}>{`${money(service.price)} · ${service.duration} мин.`}</option>)}
              </datalist>
            </Field>
            <Field label="Стоимость услуги (MDL)">
              <input
                name="servicePrice"
                type="number"
                min="0"
                step="0.01"
                value={form.servicePrice ?? ""}
                onChange={update}
                placeholder="Например, 1500"
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
            <Field label="Минимальный запас для уведомления">
              <input
                name="minQty"
                type="number"
                min="0"
                step="1"
                value={form.minQty ?? 2}
                onChange={update}
              />
            </Field>
          </>
        )}
        {type === "income" && (
          <>
            <Field label="Выберите клиента">
              <select
                name="clientId"
                value={form.clientId}
                onChange={update}
                disabled={!paymentClients.length}
              >
                {paymentClients.length ? (
                  paymentClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.car}
                      {client.service ? ` (${client.service})` : ""}
                    </option>
                  ))
                ) : (
                  <option value="">Нет клиентов с ожидающей оплатой</option>
                )}
              </select>
            </Field>
            <Field label="Сумма (MDL)">
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFinancialCsv(db, selectedPeriod) {
  const clientsById = new Map(
    db.clients.map((client) => [clientIdKey(client.id), client.car || ""]),
  );
  const rows = [
    ["Тип", "Дата", "Клиент / категория", "Сумма MDL", "Период", "Комментарий"],
    ...db.incomes
      .filter((item) => matchesPeriod(item, selectedPeriod))
      .map((item) => [
        "Оплата",
        dateText(item.date),
        clientsById.get(clientIdKey(item.clientId)) || "Удаленный клиент",
        centsToAmount(amountToCents(item.amount)),
        periodKeyFor(item),
        item.comment || "",
      ]),
    ...db.expenses
      .filter((item) => matchesPeriod(item, selectedPeriod))
      .map((item) => [
        item.source === "Личные средства" ? "Личный расход" : "Расход",
        dateText(item.date),
        item.category,
        -centsToAmount(amountToCents(item.amount)),
        periodKeyFor(item),
        item.comment || "",
      ]),
    ...db.withdrawals
      .filter((item) => matchesPeriod(item, selectedPeriod))
      .map((item) => [
        "Вывод",
        dateText(item.date),
        "Касса",
        -centsToAmount(amountToCents(item.amount)),
        periodKeyFor(item),
        item.comment || "",
      ]),
  ];
  const csv = `\uFEFF${rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(";"),
    )
    .join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `angel-detailing-finance-${selectedPeriod}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
