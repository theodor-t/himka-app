"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Check, Clock3, Trash2, Users } from "lucide-react";
import { parseRecordDate } from "../lib/finance.mjs";
import { findWaitlistMatches } from "../lib/waitlist.mjs";

const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function dateKey(value) {
  const date = parseRecordDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value) {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(date)
    : "—";
}

export default function Waitlist({ db, mutate, openModal }) {
  const [form, setForm] = useState({
    customerId: "",
    vehicleId: "",
    serviceId: "",
    date: "",
    startTime: "09:00",
    endTime: "18:00",
    comment: "",
  });
  const [error, setError] = useState("");

  const customer = db.customers.find((item) => item.id === form.customerId);
  const vehicles = db.vehicles.filter((vehicle) =>
    vehicle.customerId === form.customerId && !vehicle.archived,
  );
  const entries = useMemo(() =>
    db.waitlistEntries
      .filter((entry) => entry.status !== "booked" && entry.status !== "cancelled")
      .slice()
      .sort((first, second) =>
        `${first.date} ${first.startTime}`.localeCompare(`${second.date} ${second.startTime}`),
      ),
  [db.waitlistEntries]);

  const save = (event) => {
    event.preventDefault();
    if (!form.customerId || !form.vehicleId || !form.serviceId || !form.date) {
      setError("Выберите клиента, автомобиль, услугу и желаемую дату.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !/^\d{2}:\d{2}$/.test(form.endTime) || form.startTime >= form.endTime) {
      setError("Проверьте желаемый диапазон времени.");
      return;
    }
    if (form.date < dateKey(new Date())) {
      setError("Желаемая дата не может быть в прошлом.");
      return;
    }
    const vehicle = vehicles.find((item) => item.id === form.vehicleId);
    if (!customer || !vehicle) {
      setError("Клиент или автомобиль больше не доступны. Обновите страницу и повторите.");
      return;
    }
    const entry = {
      id: createId(),
      customerId: customer.id,
      vehicleId: vehicle.id,
      serviceId: form.serviceId,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      comment: form.comment.trim(),
      status: "waiting",
      createdAt: new Date().toISOString(),
    };
    mutate({ waitlistEntries: [entry, ...db.waitlistEntries] }, `Добавлен в лист ожидания: ${customer.name || customer.phone} · ${vehicle.makeModel}`);
    setForm({ ...form, comment: "" });
    setError("");
  };

  const bookWindow = (entry, window) => {
    const customer = db.customers.find((item) => item.id === entry.customerId);
    const vehicle = db.vehicles.find((item) => item.id === entry.vehicleId);
    const service = db.services.find((item) => item.id === entry.serviceId);
    if (!customer || !vehicle || !service) {
      setError("Не удалось найти связанные данные ожидания. Проверьте клиента, автомобиль и услугу.");
      return;
    }
    openModal({
      type: "client",
      preset: {
        customerId: customer.id,
        vehicleId: vehicle.id,
        car: vehicle.makeModel,
        phone: customer.phone,
        service: service.name,
        servicePrice: service.price,
        serviceDuration: service.duration,
        workPostId: window.suggestedPostId || "",
        datetime: window.datetime ? toLocalDateTime(window.datetime) : "",
        windowId: window.id,
        waitlistEntryId: entry.id,
      },
    });
  };

  const cancel = (entry) => {
    if (!confirm("Убрать клиента из листа ожидания? Запись будет архивирована, история сохранится.")) return;
    mutate({
      waitlistEntries: db.waitlistEntries.map((item) =>
        item.id === entry.id ? { ...item, status: "cancelled" } : item,
      ),
    }, "Клиент убран из листа ожидания");
  };

  return (
    <div className="waitlist-page">
      <section className="customers-hero">
        <div>
          <span className="dashboard-kicker">SMART WAITLIST</span>
          <h2>Лист ожидания</h2>
          <p>Подходящие освободившиеся окна показываются здесь. Запись создаётся только после подтверждения сотрудником.</p>
        </div>
        <div className="work-orders-count"><Users size={17} /><strong>{entries.length}</strong><span>ожидают</span></div>
      </section>
      <form className="card waitlist-form" onSubmit={save}>
        <div className="card-header">Добавить в лист ожидания</div>
        <div className="waitlist-form-grid">
          <label className="work-order-field">
            <span>Клиент</span>
            <select value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value, vehicleId: "" })} required>
              <option value="">Выберите клиента</option>
              {db.customers.filter((item) => !item.archived).map((item) => (
                <option key={item.id} value={item.id}>{item.name || item.phone}</option>
              ))}
            </select>
          </label>
          <label className="work-order-field">
            <span>Автомобиль</span>
            <select value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })} required disabled={!form.customerId}>
              <option value="">Выберите автомобиль</option>
              {vehicles.map((item) => <option key={item.id} value={item.id}>{item.makeModel}{item.plate ? ` · ${item.plate}` : ""}</option>)}
            </select>
          </label>
          <label className="work-order-field">
            <span>Желаемая услуга</span>
            <select value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })} required>
              <option value="">Выберите услугу</option>
              {db.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="work-order-field">
            <span>Желаемая дата</span>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
          </label>
          <label className="work-order-field">
            <span>С этого времени</span>
            <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required />
          </label>
          <label className="work-order-field">
            <span>До этого времени</span>
            <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required />
          </label>
        </div>
        <label className="work-order-field">
          <span>Комментарий</span>
          <textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} placeholder="Пожелания клиента и предпочтительный диапазон" />
        </label>
        {error && <p className="work-order-error" role="alert">{error}</p>}
        <button className="action-btn" type="submit"><CalendarPlus size={15} /> Добавить в ожидание</button>
      </form>
      <section className="waitlist-entry-list">
        {entries.map((entry) => {
          const customer = db.customers.find((item) => item.id === entry.customerId);
          const vehicle = db.vehicles.find((item) => item.id === entry.vehicleId);
          const service = db.services.find((item) => item.id === entry.serviceId);
          const matches = findWaitlistMatches(
            entry,
            db.windows,
            db.clients,
            db.services,
            db.workPosts,
          );
          return (
            <article className="card waitlist-entry" key={entry.id}>
              <header>
                <div><h3>{customer?.name || customer?.phone || "Клиент не найден"}</h3><span>{vehicle?.makeModel || "Автомобиль не найден"}{vehicle?.plate ? ` · ${vehicle.plate}` : ""}</span></div>
                <button type="button" className="waitlist-remove" onClick={() => cancel(entry)} aria-label="Убрать из листа ожидания"><Trash2 size={15} /></button>
              </header>
              <div className="waitlist-entry-details">
                <span>{service?.name || "Услуга удалена"}</span>
                <span><Clock3 size={13} /> {entry.date} · {entry.startTime}–{entry.endTime}</span>
                {entry.comment && <p>{entry.comment}</p>}
              </div>
              <section className="waitlist-matches">
                <strong>{matches.length ? `Подходящие окна · ${matches.length}` : "Подходящего свободного окна пока нет"}</strong>
                {matches.map((window) => (
                  <div key={window.id}>
                    <span>{displayDate(window.datetime)}{window.comment ? ` · ${window.comment}` : ""}</span>
                    <button type="button" onClick={() => bookWindow(entry, window)}><Check size={14} /> Подтвердить и записать</button>
                  </div>
                ))}
              </section>
            </article>
          );
        })}
        {!entries.length && <section className="card customers-empty"><Users size={25} /><h3>Лист ожидания пуст</h3><p>Добавьте клиента, если ему не подошли доступные время записи.</p></section>}
      </section>
    </div>
  );
}

function toLocalDateTime(value) {
  const date = parseRecordDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
