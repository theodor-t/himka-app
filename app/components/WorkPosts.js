"use client";

import { useState } from "react";
import { Archive, CarFront, Check, Plus, RotateCcw, User, Wrench } from "lucide-react";
import { formatMoney, parseRecordDate } from "../lib/finance.mjs";
import { availableWorkPost } from "../lib/appointments.mjs";

const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const activeOrder = (order) =>
  order && !["Выдан клиенту", "Отменён"].includes(order.status);

function displayDate(value) {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "—";
}

export default function WorkPosts({ db, mutate, user }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const activeOrders = db.orders.filter(activeOrder);
  const posts = db.workPosts.slice().sort((first, second) =>
    first.name.localeCompare(second.name, "ru", { numeric: true }),
  );

  const addPost = (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Введите название рабочего поста.");
      return;
    }
    if (db.workPosts.some((post) => post.name.toLocaleLowerCase("ru") === trimmedName.toLocaleLowerCase("ru"))) {
      setError("Пост с таким названием уже существует.");
      return;
    }
    mutate(
      { workPosts: [{ id: createId(), name: trimmedName, status: "available", createdAt: new Date().toISOString(), author: user }, ...db.workPosts] },
      `Создан рабочий пост: ${trimmedName}`,
    );
    setName("");
    setError("");
  };

  const updatePost = (post, changes, action) => {
    mutate(
      {
        workPosts: db.workPosts.map((item) =>
          item.id === post.id ? { ...item, ...changes } : item,
        ),
      },
      `${action}: ${post.name}`,
    );
  };

  const assignOrder = (post, orderId) => {
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) {
      updatePost(post, { currentOrderId: "" }, "Освобождён пост");
      return;
    }
    if (post.status === "maintenance" || post.archived) {
      setError("Нельзя назначить заказ на пост, который выключен или находится на обслуживании.");
      return;
    }
    const occupiedByOther = activeOrders.find(
      (item) => item.id !== order.id && item.workPostId === post.id,
    );
    if (occupiedByOther) {
      setError(`Пост занят заказом ${occupiedByOther.number}. Сначала освободите его.`);
      return;
    }
    const booking = db.clients.find((item) => item.id === order.bookingId);
    if (booking) {
      const available = availableWorkPost(
        db.clients,
        { ...booking, workPostId: post.id },
        db.services,
        db.workPosts,
        booking.id,
      );
      if (!available || available.postId !== post.id) {
        setError("Этот пост уже занят на время записи. Освободите пост или перенесите запись.");
        return;
      }
    }
    const previousPost = db.workPosts.find((item) => item.id === order.workPostId);
    const updatedOrder = {
      ...order,
      workPostId: post.id,
      updatedAt: new Date().toISOString(),
      history: [
        {
          status: order.status,
          at: new Date().toISOString(),
          user,
          workPost: post.name,
        },
        ...(order.history || []),
      ],
    };
    mutate(
      {
        orders: db.orders.map((item) => item.id === order.id ? updatedOrder : item),
        ...(booking
          ? {
              clients: db.clients.map((item) =>
                item.id === booking.id ? { ...item, workPostId: post.id } : item,
              ),
            }
          : {}),
        workPosts: db.workPosts.map((item) => {
          if (item.id === post.id) return { ...item, currentOrderId: order.id };
          if (previousPost && item.id === previousPost.id) return { ...item, currentOrderId: "" };
          return item;
        }),
      },
      `Заказ ${order.number} назначен на пост ${post.name}`,
    );
    setError("");
  };

  return (
    <div className="work-posts-page">
      <section className="work-orders-hero">
        <div>
          <span className="dashboard-kicker">LIVE STUDIO CAPACITY</span>
          <h2>Рабочие посты</h2>
          <p>Занятость выводится из активных заказов; посты на обслуживании не доступны для записи.</p>
        </div>
        <div className="work-orders-count"><Wrench size={17} /><strong>{posts.filter((post) => !post.archived && post.status !== "maintenance").length}</strong><span>доступно</span></div>
      </section>
      <form className="card work-post-create" onSubmit={addPost}>
        <label className="work-order-field">
          <span>Название нового поста</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Пост 1 / Мойка" />
        </label>
        <button className="action-btn" type="submit"><Plus size={15} /> Добавить пост</button>
        {error && <p className="work-order-error" role="alert">{error}</p>}
      </form>
      {posts.length ? (
        <section className="work-post-grid">
          {posts.map((post) => {
            const order = activeOrders.find((item) => item.workPostId === post.id);
            const booking = order && db.clients.find((item) => item.id === order.bookingId);
            const customer = order && db.customers.find((item) => item.id === order.customerId);
            const vehicle = order && db.vehicles.find((item) => item.id === order.vehicleId);
            const isMaintenance = post.status === "maintenance";
            return (
              <article className={`work-post-card ${isMaintenance ? "maintenance" : order ? "occupied" : "available"} ${post.archived ? "archived" : ""}`} key={post.id}>
                <header className="work-post-card-heading">
                  <span className="work-post-indicator">{isMaintenance ? <Wrench size={17} /> : order ? <CarFront size={17} /> : <Check size={17} />}</span>
                  <div><h3>{post.name}</h3><span>{post.archived ? "В архиве" : isMaintenance ? "Обслуживание" : order ? "Занят" : "Свободен"}</span></div>
                </header>
                {order ? (
                  <div className="work-post-current-order">
                    <strong>{order.number}</strong>
                    <span><CarFront size={13} /> {vehicle?.makeModel || booking?.car || "Автомобиль"}</span>
                    <span><User size={13} /> {customer?.name || customer?.phone || booking?.phone || "Клиент"}</span>
                    <span>{order.status} · выдача {displayDate(order.plannedCompletion)}</span>
                    <strong>{formatMoney(Number(order.totalCents || 0) / 100)}</strong>
                  </div>
                ) : <p className="work-post-empty">{isMaintenance ? "Пост временно недоступен для записей" : "На этот пост не назначен активный заказ"}</p>}
                <label className="work-order-field">
                  <span>Назначить заказ</span>
                  <select
                    value={order?.id || ""}
                    disabled={post.archived || isMaintenance}
                    onChange={(event) => assignOrder(post, event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {activeOrders.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.number} · {db.clients.find((visit) => visit.id === item.bookingId)?.car || "Автомобиль"}
                      </option>
                    ))}
                  </select>
                </label>
                <footer className="work-post-actions">
                  <button
                    type="button"
                    className="btn-sm btn-qty"
                    disabled={Boolean(order) || post.archived}
                    onClick={() => updatePost(post, { status: isMaintenance ? "available" : "maintenance" }, isMaintenance ? "Пост доступен" : "Пост отправлен на обслуживание")}
                  >
                    {isMaintenance ? <Check size={14} /> : <Wrench size={14} />}
                    {isMaintenance ? "Включить" : "Обслуживание"}
                  </button>
                  <button
                    type="button"
                    className="btn-sm btn-qty"
                    onClick={() => {
                      if (order && !post.archived) {
                        setError(`Сначала завершите или переназначьте заказ ${order.number}.`);
                        return;
                      }
                      updatePost(post, { archived: !post.archived, status: "available", currentOrderId: "" }, post.archived ? "Восстановлен пост" : "Архивирован пост");
                    }}
                  >
                    {post.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                    {post.archived ? "Восстановить" : "В архив"}
                  </button>
                </footer>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="card customers-empty">
          <Wrench size={25} />
          <h3>Рабочие посты пока не настроены</h3>
          <p>Добавьте фактические посты студии. После этого система сможет распределять записи по их доступности.</p>
        </section>
      )}
      {!activeOrders.length && <p className="work-order-hint">Активных заказов пока нет. Создайте заказ, затем назначьте его на свободный пост.</p>}
    </div>
  );
}
