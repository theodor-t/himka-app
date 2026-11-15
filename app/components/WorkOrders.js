"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  CarFront,
  CircleDollarSign,
  ClipboardList,
  Plus,
  Receipt,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  amountToCents,
  centsToAmount,
  formatMoney,
  parseRecordDate,
} from "../lib/finance.mjs";
import {
  mappedAppointmentStatus,
  WORK_ORDER_STATUSES,
  nextOrderNumber,
  orderBalance,
  orderTotal,
} from "../lib/work-orders.mjs";
import {
  inspectionSummary,
  VEHICLE_INSPECTION_FINDINGS,
  VEHICLE_INSPECTION_PARTS,
} from "../lib/inspections.mjs";
import { availableWorkPost } from "../lib/appointments.mjs";

const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateText = (value) => {
  const date = parseRecordDate(value);
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "Дата не указана";
};
const localInputDate = (value) => {
  const date = parseRecordDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function initialServices(appointment, services) {
  if (!appointment) return [];
  const catalogService = services.find((service) => service.name === appointment.service);
  return appointment.service
    ? [{
        serviceId: catalogService?.id || "",
        name: appointment.service,
        price: Number(appointment.servicePrice) || Number(catalogService?.price) || 0,
        duration: Number(appointment.serviceDuration) || Number(catalogService?.duration) || 60,
        quantity: 1,
      }]
    : [];
}

export default function WorkOrders({ db, mutate, user }) {
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const [discountType, setDiscountType] = useState("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [plannedCompletion, setPlannedCompletion] = useState("");
  const [assignee, setAssignee] = useState("");
  const [workPostId, setWorkPostId] = useState("");
  const [comment, setComment] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [draggedOrderId, setDraggedOrderId] = useState("");
  const [error, setError] = useState("");

  const bookingsWithoutOrders = useMemo(() => {
    const linkedBookingIds = new Set(db.orders.map((order) => String(order.bookingId)));
    return db.clients.filter(
      (booking) =>
        !linkedBookingIds.has(String(booking.id)) &&
        !["Отменен", "Не пришел"].includes(booking.status),
    );
  }, [db.clients, db.orders]);
  const selectedBooking = bookingsWithoutOrders.find(
    (booking) => String(booking.id) === String(selectedBookingId),
  );
  const selectedInitialServices = initialServices(selectedBooking, db.services);
  const selectedServices = db.services.filter((service) => serviceIds.includes(service.id));
  const lineItems = [
    ...selectedInitialServices,
    ...selectedServices
      .filter((service) => !selectedInitialServices.some((initial) => initial.serviceId === service.id))
      .map((service) => ({
        serviceId: service.id,
        name: service.name,
        price: Number(service.price) || 0,
        duration: Number(service.duration) || 60,
        quantity: 1,
      })),
  ];
  const subtotalCents = lineItems.reduce(
    (total, service) => total + amountToCents(service.price) * service.quantity,
    0,
  );
  const discountCents = discountType === "percent"
    ? Math.round((subtotalCents * Math.min(100, Math.max(0, Number(discountValue) || 0))) / 100)
    : Math.min(subtotalCents, Math.max(0, amountToCents(discountValue)));
  const totalCents = Math.max(0, subtotalCents - discountCents);

  const resetForm = () => {
    setSelectedBookingId("");
    setServiceIds([]);
    setDiscountType("fixed");
    setDiscountValue("");
    setPlannedCompletion("");
    setAssignee("");
    setWorkPostId("");
    setComment("");
    setError("");
  };

  const createOrder = (event) => {
    event.preventDefault();
    const booking = bookingsWithoutOrders.find(
      (candidate) => String(candidate.id) === String(selectedBookingId),
    );
    if (!booking) {
      setError("Выберите активную запись. Для неё заказ ещё не создан.");
      return;
    }
    if (!lineItems.length) {
      setError("Добавьте хотя бы одну услугу из прайса или записи.");
      return;
    }
    const newDuration = lineItems.reduce((total, service) => total + service.duration, 0);
    const bookingSlot = availableWorkPost(
      db.clients,
      { ...booking, serviceDuration: newDuration, workPostId: workPostId || booking.workPostId },
      db.services,
      db.workPosts,
      booking.id,
    );
    if (!bookingSlot) {
      setError("Суммарная длительность заказа не помещается на свободном рабочем посте. Перенесите запись или измените состав услуг.");
      return;
    }
    const assignedPostId = bookingSlot.postId;
    if (workPostId && assignedPostId !== workPostId) {
      setError("Выбранный пост занят на всём интервале заказа. Выберите другой пост.");
      return;
    }
    if (assignedPostId) {
      const assignedPost = db.workPosts.find((item) => item.id === assignedPostId);
      if (!assignedPost || assignedPost.archived || assignedPost.status === "maintenance") {
        setError("Выбранный рабочий пост недоступен.");
        return;
      }
      const otherOrder = db.orders.find(
        (order) =>
          order.bookingId !== booking.id &&
          order.workPostId === assignedPostId &&
          !["Выдан клиенту", "Отменён"].includes(order.status),
      );
      if (otherOrder) {
        setError(`Пост занят заказом ${otherOrder.number}. Выберите другой пост.`);
        return;
      }
    }
    const discount = {
      type: discountType,
      value: Number(discountValue) || 0,
      amountCents: discountCents,
    };
    const createdAt = new Date().toISOString();
    const order = {
      id: createId(),
      number: nextOrderNumber(db.orders),
      bookingId: booking.id,
      customerId: booking.customerId || "",
      vehicleId: booking.vehicleId || "",
      workPostId: assignedPostId,
      services: lineItems,
      subtotalCents,
      discount,
      totalCents,
      status: "Ожидает приезда",
      assignedTo: assignee.trim(),
      plannedCompletion: plannedCompletion ? new Date(plannedCompletion).toISOString() : "",
      comment: comment.trim(),
      history: [{ status: "Ожидает приезда", at: createdAt, user }],
      createdAt,
      updatedAt: createdAt,
      createdBy: user,
    };
    const updatedBooking = {
      ...booking,
      workPostId: assignedPostId,
      service: lineItems.map((service) => service.name).join(", "),
      servicePrice: centsToAmount(totalCents),
      serviceDuration: lineItems.reduce((total, service) => total + service.duration, 0),
    };

    mutate(
      {
        orders: [order, ...db.orders],
        clients: db.clients.map((candidate) =>
          candidate.id === booking.id ? updatedBooking : candidate,
        ),
        ...(assignedPostId
          ? {
              workPosts: db.workPosts.map((post) =>
                post.id === assignedPostId ? { ...post, currentOrderId: order.id } : post,
              ),
            }
          : {}),
      },
      `Создан заказ ${order.number} для ${booking.car || "автомобиля"}`,
    );
    resetForm();
  };

  const changeStatus = (order, status) => {
    if (!WORK_ORDER_STATUSES.includes(status) || order.status === status) return;
    let cancelReason = order.cancelReason || "";
    if (status === "Отменён") {
      cancelReason = window.prompt("Укажите причину отмены заказа:")?.trim() || "";
      if (!cancelReason) return;
    }
    const changedAt = new Date().toISOString();
    const updated = {
      ...order,
      status,
      cancelReason,
      updatedAt: changedAt,
      history: [
        { status, at: changedAt, user, ...(cancelReason ? { reason: cancelReason } : {}) },
        ...(order.history || []),
      ],
    };
    const booking = db.clients.find((candidate) => candidate.id === order.bookingId);
    mutate(
      {
        orders: db.orders.map((candidate) => candidate.id === order.id ? updated : candidate),
        ...(order.workPostId && ["Отменён", "Выдан клиенту"].includes(status)
          ? {
              workPosts: db.workPosts.map((post) =>
                post.id === order.workPostId && post.currentOrderId === order.id
                  ? { ...post, currentOrderId: "" }
                  : post,
              ),
            }
          : {}),
        ...(booking && ["Отменён", "Выдан клиенту"].includes(status)
          ? {
              clients: db.clients.map((candidate) =>
                candidate.id === booking.id
                  ? { ...candidate, status: mappedAppointmentStatus(status, candidate.status) }
                  : candidate,
              ),
            }
          : {}),
      },
      `Заказ ${order.number}: ${status}${cancelReason ? ` — ${cancelReason}` : ""}`,
    );
  };

  const moveOrder = (orderId, status) => {
    const order = db.orders.find((candidate) => candidate.id === orderId);
    if (order) changeStatus(order, status);
    setDraggedOrderId("");
  };

  const collectPayment = (event, order) => {
    event.preventDefault();
    const rawAmount = paymentDrafts[order.id] || "";
    const cents = amountToCents(rawAmount);
    const balanceCents = amountToCents(orderBalance(db.incomes, order));
    if (cents <= 0 || cents > balanceCents) {
      setError(`Для заказа ${order.number} укажите сумму от 0,01 до ${formatMoney(centsToAmount(balanceCents))}.`);
      return;
    }
    const booking = db.clients.find((candidate) => candidate.id === order.bookingId);
    if (!booking) {
      setError(`Не найден визит, связанный с заказом ${order.number}; оплата не записана.`);
      return;
    }
    const paidAt = new Date();
    const payment = {
      id: createId(),
      clientId: booking.id,
      orderId: order.id,
      amount: centsToAmount(cents),
      date: paidAt.toISOString(),
      month: new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(paidAt),
      year: paidAt.getFullYear(),
      periodKey: `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, "0")}`,
      debtAllocations: [],
      serviceAmountCents: cents,
      author: user,
    };
    mutate(
      { incomes: [payment, ...db.incomes] },
      `Оплата заказа ${order.number}: +${formatMoney(payment.amount)}`,
    );
    setPaymentDrafts((drafts) => ({ ...drafts, [order.id]: "" }));
    setError("");
  };

  return (
    <div className="work-orders-page">
      <section className="work-orders-hero">
        <div>
          <span className="dashboard-kicker">DIGITAL WORK ORDER</span>
          <h2>Заказы мастерской</h2>
          <p>Заказ связан с исходной записью, автомобилем клиента и фактическими оплатами.</p>
        </div>
        <div className="work-orders-count"><ClipboardList size={18} /><strong>{db.orders.length}</strong><span>заказов</span></div>
      </section>

      <form className="card work-order-create" onSubmit={createOrder}>
        <div className="card-header">
          <span>Создать заказ из записи</span>
          <span className="work-order-form-note">Одна запись — не более одного заказа</span>
        </div>
        <div className="work-order-create-grid">
          <label className="work-order-field">
            <span>Запись / автомобиль</span>
            <select
              value={selectedBookingId}
              onChange={(event) => {
                setSelectedBookingId(event.target.value);
                setServiceIds([]);
                setError("");
              }}
              required
            >
              <option value="">Выберите запись</option>
              {bookingsWithoutOrders.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {dateText(booking.datetime)} · {booking.car || booking.phone || "Автомобиль"}
                </option>
              ))}
            </select>
          </label>
          <label className="work-order-field">
            <span>Плановая выдача</span>
            <input
              type="datetime-local"
              value={plannedCompletion}
              onChange={(event) => setPlannedCompletion(event.target.value)}
            />
          </label>
          <label className="work-order-field">
            <span>Ответственный сотрудник</span>
            <input
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Имя мастера"
            />
          </label>
          <label className="work-order-field">
            <span>Рабочий пост</span>
            <select value={workPostId} onChange={(event) => setWorkPostId(event.target.value)}>
              <option value="">Не назначен</option>
              {db.workPosts
                .filter((post) => !post.archived && post.status !== "maintenance")
                .map((post) => {
                  const occupiedOrder = db.orders.find(
                    (order) =>
                      order.workPostId === post.id &&
                      !["Выдан клиенту", "Отменён"].includes(order.status),
                  );
                  return (
                    <option key={post.id} value={post.id} disabled={Boolean(occupiedOrder)}>
                      {post.name}{occupiedOrder ? ` · занят ${occupiedOrder.number}` : ""}
                    </option>
                  );
                })}
            </select>
          </label>
          <label className="work-order-field">
            <span>Скидка</span>
            <span className="work-order-discount">
              <select value={discountType} onChange={(event) => setDiscountType(event.target.value)} aria-label="Тип скидки">
                <option value="fixed">MDL</option>
                <option value="percent">%</option>
              </select>
              <input
                type="number"
                min="0"
                step={discountType === "percent" ? "1" : "0.01"}
                max={discountType === "percent" ? "100" : undefined}
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                placeholder="0"
              />
            </span>
          </label>
        </div>
        {!!selectedBooking && db.services.length > 0 && (
          <fieldset className="work-order-service-picker">
            <legend>Дополнительные услуги</legend>
            <p>Услуга из записи уже включена. Выберите дополнительные позиции из прайса.</p>
            <div className="work-order-service-options">
              {db.services.map((service) => {
                const included = selectedInitialServices.some((item) => item.serviceId === service.id);
                return (
                  <label key={service.id} className={included ? "included" : ""}>
                    <input
                      type="checkbox"
                      disabled={included}
                      checked={included || serviceIds.includes(service.id)}
                      onChange={(event) => setServiceIds((current) =>
                        event.target.checked
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id),
                      )}
                    />
                    <span>{service.name}</span>
                    <strong>{formatMoney(service.price)}</strong>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {selectedBooking && (
          <div className="work-order-total-line">
            <span>{lineItems.length} услуг · сумма до скидки {formatMoney(centsToAmount(subtotalCents))}</span>
            <strong>Итого: {formatMoney(centsToAmount(totalCents))}</strong>
          </div>
        )}
        <label className="work-order-field">
          <span>Комментарий к заказу</span>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Пожелания клиента или примечания при приёме" />
        </label>
        {error && <p className="work-order-error" role="alert">{error}</p>}
        <div className="work-order-create-actions">
          <button type="button" className="action-btn btn-secondary" onClick={resetForm}>Очистить</button>
          <button type="submit" className="action-btn" disabled={!bookingsWithoutOrders.length}>
            <Plus size={16} /> Создать заказ
          </button>
        </div>
        {!bookingsWithoutOrders.length && <p className="work-order-hint">Нет активных записей без заказа. Создайте запись в календаре.</p>}
      </form>

      <section className="work-orders-board" aria-label="Канбан-доска заказов">
        {WORK_ORDER_STATUSES.map((status) => {
          const orders = db.orders
            .filter((order) => (order.status || "Ожидает приезда") === status)
            .sort((first, second) =>
              (parseRecordDate(first.plannedCompletion)?.getTime() || Infinity) -
              (parseRecordDate(second.plannedCompletion)?.getTime() || Infinity),
            );
          return (
            <section
              className={`work-order-column ${status === "Отменён" ? "cancelled" : ""}`}
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedOrderId) moveOrder(draggedOrderId, status);
              }}
            >
              <header className="work-order-column-heading">
                <span>{status}</span>
                <strong>{orders.length}</strong>
              </header>
              <div className="work-order-column-cards">
                {orders.map((order) => {
                  const booking = db.clients.find((candidate) => candidate.id === order.bookingId);
                  const customer = db.customers.find((candidate) => candidate.id === order.customerId);
                  const vehicle = db.vehicles.find((candidate) => candidate.id === order.vehicleId);
                  const paid = Math.max(0, orderTotal(order) - orderBalance(db.incomes, order));
                  return (
                    <article
                      className="work-order-card"
                      key={order.id}
                      draggable
                      onDragStart={() => setDraggedOrderId(order.id)}
                      onDragEnd={() => setDraggedOrderId("")}
                    >
                      <div className="work-order-card-top">
                        <strong>{order.number}</strong>
                        <span><ArrowDown size={13} /> {dateText(order.createdAt)}</span>
                      </div>
                      <h3><CarFront size={16} /> {vehicle?.makeModel || booking?.car || "Автомобиль"}</h3>
                      <p className="work-order-customer"><User size={13} /> {customer?.name || customer?.phone || booking?.phone || "Клиент"}</p>
                      <div className="work-order-services">
                        {(order.services || []).map((service, index) => (
                          <span key={`${service.serviceId || service.name}-${index}`}>
                            {service.name} <strong>{formatMoney(service.price)}</strong>
                          </span>
                        ))}
                      </div>
                      <div className="work-order-finance">
                        <span>Итого <strong>{formatMoney(orderTotal(order))}</strong></span>
                        <span>Оплачено <strong className={paid ? "positive" : ""}>{formatMoney(paid)}</strong></span>
                        <span>Остаток <strong className={orderBalance(db.incomes, order) ? "warning" : "positive"}>{formatMoney(orderBalance(db.incomes, order))}</strong></span>
                      </div>
                      <div className="work-order-meta">
                        <span><CalendarDays size={13} /> {order.plannedCompletion ? dateText(order.plannedCompletion) : "Выдача не назначена"}</span>
                        <span><User size={13} /> {order.assignedTo || "Исполнитель не назначен"}</span>
                        <span><CarFront size={13} /> {db.workPosts.find((post) => post.id === order.workPostId)?.name || "Пост не назначен"}</span>
                      </div>
                      {order.comment && <p className="work-order-comment">{order.comment}</p>}
                      {order.cancelReason && <p className="work-order-cancel-reason">Причина отмены: {order.cancelReason}</p>}
                      <label className="work-order-status-control">
                        <span>Изменить этап</span>
                        <select value={status} onChange={(event) => changeStatus(order, event.target.value)}>
                          {WORK_ORDER_STATUSES.map((item) => <option key={item}>{item}</option>)}
                        </select>
                      </label>
                      {orderBalance(db.incomes, order) > 0 && status !== "Отменён" && (
                        <form className="work-order-payment" onSubmit={(event) => collectPayment(event, order)}>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={orderBalance(db.incomes, order)}
                            value={paymentDrafts[order.id] || ""}
                            onChange={(event) => setPaymentDrafts((drafts) => ({ ...drafts, [order.id]: event.target.value }))}
                            placeholder={`До ${formatMoney(orderBalance(db.incomes, order))}`}
                            aria-label={`Оплата по заказу ${order.number}`}
                            required
                          />
                          <button type="submit" title="Принять оплату" aria-label={`Принять оплату по заказу ${order.number}`}>
                            <CircleDollarSign size={16} />
                          </button>
                        </form>
                      )}
                      {!!db.incomes.filter((payment) => payment.orderId === order.id || String(payment.clientId) === String(order.bookingId)).length && (
                        <details className="work-order-payment-history">
                          <summary><Receipt size={13} /> История оплат</summary>
                          {db.incomes
                            .filter((payment) => String(payment.clientId) === String(order.bookingId))
                            .sort((first, second) =>
                              (parseRecordDate(second.date)?.getTime() || 0) -
                              (parseRecordDate(first.date)?.getTime() || 0),
                            )
                            .map((payment) => (
                              <span key={payment.id}>{dateText(payment.date)} · {formatMoney(payment.amount)}</span>
                            ))}
                        </details>
                      )}
                      <div className="work-order-history">
                        {(order.history || []).slice(0, 3).map((entry, index) => (
                          <span key={`${entry.at}-${index}`}>{entry.status} · {dateText(entry.at)}</span>
                        ))}
                      </div>
                      <InspectionPanel
                        key={`${order.id}-${db.inspections.find((inspection) => inspection.orderId === order.id)?.id || "new"}`}
                        order={order}
                        db={db}
                        mutate={mutate}
                        user={user}
                      />
                    </article>
                  );
                })}
                {!orders.length && <p className="work-order-column-empty">Перетащите заказ сюда</p>}
              </div>
            </section>
          );
        })}
      </section>
      {!!error && db.orders.length > 0 && <p className="work-order-error" role="alert">{error}</p>}
    </div>
  );
}

function InspectionPanel({ order, db, mutate, user }) {
  const history = db.inspections
    .filter((inspection) => inspection.orderId === order.id)
    .slice()
    .sort((first, second) =>
      (parseRecordDate(second.createdAt)?.getTime() || 0) -
      (parseRecordDate(first.createdAt)?.getTime() || 0),
    );
  const latest = history[0];
  const [part, setPart] = useState(VEHICLE_INSPECTION_PARTS[0]);
  const [findingType, setFindingType] = useState(VEHICLE_INSPECTION_FINDINGS[0]);
  const [findingComment, setFindingComment] = useState("");
  const [findings, setFindings] = useState(() => latest?.findings || []);
  const [notes, setNotes] = useState(() => latest?.notes || "");
  const [error, setError] = useState("");
  const summary = inspectionSummary(latest);

  const addFinding = () => {
    const comment = findingComment.trim();
    if (!comment && findingType === "Другое") {
      setError("Добавьте описание для дефекта типа «Другое».");
      return;
    }
    setFindings((current) => [
      ...current,
      { id: createId(), part, type: findingType, comment, createdAt: new Date().toISOString() },
    ]);
    setFindingComment("");
    setError("");
  };

  const saveInspection = () => {
    const createdAt = new Date().toISOString();
    const inspection = {
      id: createId(),
      orderId: order.id,
      bookingId: order.bookingId,
      vehicleId: order.vehicleId || "",
      customerId: order.customerId || "",
      revision: (latest?.revision || 0) + 1,
      previousInspectionId: latest?.id || "",
      findings,
      notes: notes.trim(),
      createdAt,
      createdBy: user,
    };
    mutate(
      { inspections: [inspection, ...db.inspections] },
      `Осмотр ${order.number} сохранён · версия ${inspection.revision} · дефектов ${findings.length}`,
    );
    setError("");
  };

  return (
    <details className="work-order-inspection">
      <summary>
        <ShieldCheck size={14} />
        Осмотр автомобиля
        {latest && <span>v{latest.revision} · {summary.findingCount} замечаний</span>}
      </summary>
      <div className="inspection-panel">
        <div className="inspection-vehicle-outline" aria-label="Схема автомобиля: выберите часть для фиксации дефекта">
          <div className="inspection-car-nose">Передняя часть</div>
          <div className="inspection-car-row">
            <button type="button" className={part === "Левая сторона" ? "selected" : ""} onClick={() => setPart("Левая сторона")}>Левая сторона</button>
            <div className="inspection-car-cabin">
              <button type="button" className={part === "Капот" ? "selected" : ""} onClick={() => setPart("Капот")}>Капот</button>
              <button type="button" className={part === "Крыша" ? "selected" : ""} onClick={() => setPart("Крыша")}>Крыша</button>
              <button type="button" className={part === "Салон" ? "selected" : ""} onClick={() => setPart("Салон")}>Салон</button>
            </div>
            <button type="button" className={part === "Правая сторона" ? "selected" : ""} onClick={() => setPart("Правая сторона")}>Правая сторона</button>
          </div>
          <div className="inspection-car-nose rear">Задняя часть</div>
        </div>
        <label className="work-order-field">
          <span>Часть автомобиля</span>
          <select value={part} onChange={(event) => setPart(event.target.value)}>
            {VEHICLE_INSPECTION_PARTS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <div className="inspection-finding-form">
          <label className="work-order-field">
            <span>Тип замечания</span>
            <select value={findingType} onChange={(event) => setFindingType(event.target.value)}>
              {VEHICLE_INSPECTION_FINDINGS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="work-order-field">
            <span>Комментарий к дефекту</span>
            <input value={findingComment} onChange={(event) => setFindingComment(event.target.value)} placeholder="Опишите расположение и состояние" />
          </label>
          <button type="button" className="btn-sm btn-qty" onClick={addFinding}><Plus size={14} /> Добавить</button>
        </div>
        {findings.length > 0 && (
          <div className="inspection-findings-list">
            {findings.map((item) => (
              <article key={item.id}>
                <span><strong>{item.part}</strong><small>{item.type}{item.comment ? ` · ${item.comment}` : ""}</small></span>
                <button type="button" aria-label={`Удалить замечание ${item.part}`} onClick={() => setFindings((current) => current.filter((finding) => finding.id !== item.id))}><X size={14} /></button>
              </article>
            ))}
          </div>
        )}
        <label className="work-order-field">
          <span>Общее состояние и замечания</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Состояние кузова, салона, комплектность автомобиля…" />
        </label>
        <div className="inspection-photo-unavailable">
          Фото дефектов пока не прикрепляются: подключённое хранилище проекта — Google Sheets, оно не подходит для хранения изображений. Текстовый осмотр сохраняется полностью.
        </div>
        {error && <p className="work-order-error" role="alert">{error}</p>}
        <button type="button" className="action-btn" onClick={saveInspection}>
          <ShieldCheck size={15} /> Сохранить осмотр {latest ? `v${(latest.revision || 0) + 1}` : ""}
        </button>
        {!!history.length && (
          <details className="inspection-history">
            <summary>Предыдущие осмотры · {history.length}</summary>
            {history.map((inspection) => (
              <div key={inspection.id}>
                <strong>Версия {inspection.revision} · {dateText(inspection.createdAt)}</strong>
                <span>{inspection.findings?.length || 0} замечаний · {inspection.createdBy || "Сотрудник"}</span>
                {inspection.notes && <small>{inspection.notes}</small>}
              </div>
            ))}
          </details>
        )}
      </div>
    </details>
  );
}
