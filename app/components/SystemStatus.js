"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Archive,
  Cloud,
  Database,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { DATABASE_COLLECTIONS } from "../lib/database.mjs";
import { parseRecordDate } from "../lib/finance.mjs";
import { ROLE_LABELS } from "../lib/access-control.mjs";

const BACKUP_KEY = "angel-detailing-auto-backup";

function formattedTimestamp(value) {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "Нет данных";
}

export default function SystemStatus({ db, role, sync, lastSyncedAt, reload, exportData }) {
  const [backup, setBackup] = useState(null);
  const [storage, setStorage] = useState("Проверяется...");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null");
      setBackup(saved && typeof saved === "object" ? saved : null);
      setStorage("Доступно");
    } catch (error) {
      setStorage("Недоступно");
    }
  }, []);

  const recordCount = DATABASE_COLLECTIONS.reduce(
    (total, collection) => total + db[collection].length,
    0,
  );
  const connectionState = sync.includes("Ошибка")
    ? "error"
    : sync.includes("Сохран") || sync.includes("Google OK")
      ? "ok"
      : "pending";
  const backupState = backup?.pending
    ? "Есть несохранённые локальные изменения"
    : backup?.savedAt
      ? "Локальная резервная копия доступна"
      : "Локальная копия ещё не создана";

  return (
    <div className="system-status-page">
      <section className="customers-hero">
        <div>
          <span className="dashboard-kicker">SYSTEM HEALTH</span>
          <h2>Состояние системы</h2>
          <p>Проверка соединения, сохранения данных и состояния резервной копии.</p>
        </div>
        <div className="work-orders-count"><Activity size={17} /><strong>{recordCount}</strong><span>записей в базе</span></div>
      </section>

      <section className="system-health-grid">
        <article className={`card system-health-card health-${connectionState}`}>
          <span className="system-health-icon"><Cloud size={18} /></span>
          <div><strong>Google Sheets</strong><span>{connectionState === "error" ? "Нет соединения" : connectionState === "ok" ? "Соединение подтверждено" : "Проверка соединения"}</span><small>{sync}</small></div>
          <i />
        </article>
        <article className="card system-health-card health-ok">
          <span className="system-health-icon"><Database size={18} /></span>
          <div><strong>Структура данных</strong><span>Схема {db.schemaVersion || 1} · {DATABASE_COLLECTIONS.length} коллекций</span><small>{recordCount.toLocaleString("ru-RU")} записей</small></div>
          <i />
        </article>
        <article className={`card system-health-card ${backup?.pending ? "health-warning" : "health-ok"}`}>
          <span className="system-health-icon"><HardDrive size={18} /></span>
          <div><strong>Локальная копия</strong><span>{backupState}</span><small>Хранилище браузера: {storage}</small></div>
          <i />
        </article>
        <article className="card system-health-card health-ok">
          <span className="system-health-icon"><ShieldCheck size={18} /></span>
          <div><strong>Сессия · {ROLE_LABELS[role] || "Роль не определена"}</strong><span>Доступ предоставлен через защищённую сессию</span><small>Секреты подключения не хранятся в браузере</small></div>
          <i />
        </article>
      </section>

      <section className="card system-details">
        <div className="card-header"><Activity size={16} /> Детали синхронизации и восстановления</div>
        <div className="system-detail-list">
          <div><span>Последнее подтверждённое соединение с базой</span><strong>{formattedTimestamp(lastSyncedAt)}</strong></div>
          <div><span>Время создания локальной резервной копии</span><strong>{formattedTimestamp(backup?.savedAt)}</strong></div>
          <div><span>Состояние локальной копии</span><strong>{backup?.pending ? "Ожидает отправки в Google Sheets" : backup?.savedAt ? "Синхронизирована" : "Не создана"}</strong></div>
          <div><span>Коллекции приложения</span><strong>{DATABASE_COLLECTIONS.length}</strong></div>
        </div>
        <p className="system-backup-warning"><Archive size={14} /> Локальная копия помогает восстановить данные в этом браузере, но не заменяет регулярное скачивание резервного JSON-файла.</p>
        <div className="system-status-actions">
          <button type="button" className="btn-sm" onClick={reload}><RefreshCw size={14} /> Проверить подключение</button>
          {role !== "technician" && (
            <button type="button" className="action-btn" onClick={exportData}><Archive size={14} /> Скачать резервную копию</button>
          )}
        </div>
      </section>
    </div>
  );
}
