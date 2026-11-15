"use client";

import { useMemo, useState } from "react";
import { Archive, Box, Plus, Save, Truck, Wallet } from "lucide-react";
import { amountToCents, centsToAmount, formatMoney, MONTHS } from "../lib/finance.mjs";
import { openSupplierPurchases, supplierBalanceCents } from "../lib/supplier-ledger.mjs";

const createId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const EMPTY_SUPPLIER = { name: "", contact: "", phone: "", address: "", comment: "" };

function createExpense(amountCents, category, supplierId, paymentId, author) {
  const date = new Date();
  return {
    id: createId(),
    category,
    amount: centsToAmount(amountCents),
    date: date.toISOString(),
    periodKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    month: MONTHS[date.getMonth()],
    year: date.getFullYear(),
    supplierId,
    supplierPaymentId: paymentId,
    author,
  };
}

export default function Suppliers({ db, mutate, user }) {
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [editingId, setEditingId] = useState("");
  const [purchase, setPurchase] = useState({
    supplierId: "",
    itemId: "",
    quantity: "",
    unitCost: "",
    paidNow: "0",
  });
  const [payment, setPayment] = useState({ purchaseId: "", amount: "" });
  const [error, setError] = useState("");

  const activeSuppliers = db.suppliers.filter((supplier) => !supplier.archived);
  const openPurchases = useMemo(
    () => openSupplierPurchases(db.supplierPayments),
    [db.supplierPayments],
  );
  const selectedPurchase = openPurchases.find((item) => item.id === payment.purchaseId);

  const saveSupplier = (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Укажите название поставщика.");
      return;
    }

    const supplier = { ...form, name, id: editingId || createId() };
    mutate(
      {
        suppliers: editingId
          ? db.suppliers.map((item) => (item.id === editingId ? supplier : item))
          : [supplier, ...db.suppliers],
      },
      `${editingId ? "Обновлён поставщик" : "Добавлен поставщик"}: ${name}`,
    );
    setForm(EMPTY_SUPPLIER);
    setEditingId("");
    setError("");
  };

  const startEdit = (supplier) => {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || "",
      contact: supplier.contact || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      comment: supplier.comment || "",
    });
    setError("");
  };

  const archiveSupplier = (supplier) => {
    if (!confirm(`Архивировать поставщика «${supplier.name}»? История закупок сохранится.`)) return;
    mutate(
      {
        suppliers: db.suppliers.map((item) =>
          item.id === supplier.id ? { ...item, archived: true } : item,
        ),
      },
      `Поставщик архивирован: ${supplier.name}`,
    );
  };

  const receivePurchase = (event) => {
    event.preventDefault();
    const supplier = activeSuppliers.find((item) => item.id === purchase.supplierId);
    const stockItem = db.warehouse.find((item) => item.id === purchase.itemId);
    const quantity = Number(purchase.quantity);
    const unitCostCents = amountToCents(purchase.unitCost);
    const paidNowCents = amountToCents(purchase.paidNow);
    const totalCents = quantity * unitCostCents;
    if (
      !supplier ||
      !stockItem ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      unitCostCents <= 0 ||
      !Number.isSafeInteger(totalCents) ||
      paidNowCents < 0 ||
      paidNowCents > totalCents
    ) {
      setError("Проверьте поставщика, товар, количество, цену и первоначальную оплату.");
      return;
    }

    const purchaseId = createId();
    const paymentId = createId();
    const record = {
      id: purchaseId,
      type: "purchase",
      supplierId: supplier.id,
      itemId: stockItem.id,
      itemName: stockItem.name,
      quantity,
      unitCost: centsToAmount(unitCostCents),
      amount: centsToAmount(totalCents),
      paidAmount: 0,
      date: new Date().toISOString(),
      author: user,
    };
    const initialPayment = {
      id: paymentId,
      type: "payment",
      supplierId: supplier.id,
      purchaseId,
      amount: centsToAmount(paidNowCents),
      date: record.date,
      author: user,
    };
    const changes = {
      supplierPayments: [
        ...(paidNowCents ? [initialPayment] : []),
        record,
        ...db.supplierPayments,
      ],
      warehouse: db.warehouse.map((item) =>
        item.id === stockItem.id ? { ...item, qty: Number(item.qty || 0) + quantity } : item,
      ),
      stockMovements: [
        {
          id: createId(),
          itemId: stockItem.id,
          name: stockItem.name,
          delta: quantity,
          date: record.date,
          author: user,
          reason: `Поставка от ${supplier.name}`,
          supplierId: supplier.id,
          purchaseId,
        },
        ...db.stockMovements,
      ],
      ...(paidNowCents
        ? {
            expenses: [
              createExpense(
                paidNowCents,
                `Оплата поставщику: ${supplier.name}`,
                supplier.id,
                paymentId,
                user,
              ),
              ...db.expenses,
            ],
          }
        : {}),
    };
    mutate(changes, `Принята поставка ${stockItem.name}: ${quantity} шт. от ${supplier.name}`);
    setPurchase({ supplierId: supplier.id, itemId: "", quantity: "", unitCost: "", paidNow: "0" });
    setError("");
  };

  const payPurchase = (event) => {
    event.preventDefault();
    const purchaseRecord = openPurchases.find((item) => item.id === payment.purchaseId);
    const amountCents = amountToCents(payment.amount);
    if (!purchaseRecord || amountCents <= 0 || amountCents > purchaseRecord.balanceCents) {
      setError("Укажите сумму оплаты в пределах остатка по поставке.");
      return;
    }

    const supplier = db.suppliers.find((item) => item.id === purchaseRecord.supplierId);
    if (!supplier) {
      setError("Поставщик этой поставки не найден. Проверьте записи.");
      return;
    }

    const paymentId = createId();
    const record = {
      id: paymentId,
      type: "payment",
      supplierId: supplier.id,
      purchaseId: purchaseRecord.id,
      amount: centsToAmount(amountCents),
      date: new Date().toISOString(),
      author: user,
    };
    mutate(
      {
        supplierPayments: [record, ...db.supplierPayments],
        expenses: [
          createExpense(
            amountCents,
            `Оплата поставщику: ${supplier.name}`,
            supplier.id,
            paymentId,
            user,
          ),
          ...db.expenses,
        ],
      },
      `Оплата поставщику ${supplier.name}: ${formatMoney(record.amount)}`,
    );
    setPayment({ purchaseId: "", amount: "" });
    setError("");
  };

  return (
    <div className="suppliers-page">
      <section className="customers-hero">
        <div>
          <span className="dashboard-kicker">SUPPLIERS & PURCHASES</span>
          <h2>Поставщики и закупки</h2>
          <p>Принимайте поставки на склад, фиксируйте оплаты и контролируйте задолженность.</p>
        </div>
        <div className="work-orders-count"><Truck size={17} /><strong>{activeSuppliers.length}</strong><span>поставщиков</span></div>
      </section>

      <div className="suppliers-workflow">
        <form className="card supplier-form" onSubmit={receivePurchase}>
          <div className="card-header"><Box size={16} /> Принять поставку</div>
          <label className="work-order-field">
            <span>Поставщик</span>
            <select value={purchase.supplierId} onChange={(event) => setPurchase({ ...purchase, supplierId: event.target.value })} required>
              <option value="">Выберите поставщика</option>
              {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label className="work-order-field">
            <span>Товар</span>
            <select value={purchase.itemId} onChange={(event) => setPurchase({ ...purchase, itemId: event.target.value })} required>
              <option value="">Выберите товар на складе</option>
              {db.warehouse.map((item) => <option key={item.id} value={item.id}>{item.name} · остаток {item.qty}</option>)}
            </select>
          </label>
          <div className="supplier-form-grid">
            <label className="work-order-field"><span>Количество, шт.</span><input type="number" min="1" step="1" value={purchase.quantity} onChange={(event) => setPurchase({ ...purchase, quantity: event.target.value })} required /></label>
            <label className="work-order-field"><span>Цена за единицу, MDL</span><input type="number" min="0.01" step="0.01" value={purchase.unitCost} onChange={(event) => setPurchase({ ...purchase, unitCost: event.target.value })} required /></label>
          </div>
          <label className="work-order-field"><span>Оплачено при приёмке, MDL</span><input type="number" min="0" step="0.01" value={purchase.paidNow} onChange={(event) => setPurchase({ ...purchase, paidNow: event.target.value })} /></label>
          <button className="action-btn" type="submit"><Plus size={15} /> Зафиксировать поставку</button>
        </form>

        <form className="card supplier-form" onSubmit={payPurchase}>
          <div className="card-header"><Wallet size={16} /> Оплатить задолженность</div>
          <label className="work-order-field">
            <span>Незакрытая поставка</span>
            <select
              value={payment.purchaseId}
              onChange={(event) => {
                const nextPurchase = openPurchases.find((item) => item.id === event.target.value);
                setPayment({
                  purchaseId: event.target.value,
                  amount: nextPurchase ? centsToAmount(nextPurchase.balanceCents).toFixed(2) : "",
                });
              }}
              required
            >
              <option value="">Выберите поставку</option>
              {openPurchases.map((item) => {
                const supplier = db.suppliers.find((row) => row.id === item.supplierId);
                return <option key={item.id} value={item.id}>{supplier?.name || "Поставщик"} · {item.itemName} · остаток {formatMoney(centsToAmount(item.balanceCents))}</option>;
              })}
            </select>
          </label>
          <label className="work-order-field">
            <span>Сумма оплаты, MDL{selectedPurchase ? ` · остаток ${formatMoney(centsToAmount(selectedPurchase.balanceCents))}` : ""}</span>
            <input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} required disabled={!selectedPurchase} />
          </label>
          <button className="action-btn" type="submit" disabled={!selectedPurchase}><Wallet size={15} /> Записать оплату</button>
        </form>
      </div>

      {error && <p className="work-order-error" role="alert">{error}</p>}

      <form className="card supplier-form supplier-profile-form" onSubmit={saveSupplier}>
        <div className="card-header"><Truck size={16} /> {editingId ? "Редактировать поставщика" : "Новый поставщик"}</div>
        <div className="supplier-form-grid supplier-profile-grid">
          <label className="work-order-field"><span>Название</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="work-order-field"><span>Контактное лицо</span><input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></label>
          <label className="work-order-field"><span>Телефон</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label className="work-order-field"><span>Адрес</span><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        </div>
        <label className="work-order-field"><span>Комментарий</span><textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></label>
        <div className="supplier-form-actions">
          {editingId && <button type="button" className="btn-sm" onClick={() => { setEditingId(""); setForm(EMPTY_SUPPLIER); }}>Отмена</button>}
          <button className="action-btn" type="submit"><Save size={15} /> {editingId ? "Сохранить" : "Добавить поставщика"}</button>
        </div>
      </form>

      <section className="supplier-list">
        {activeSuppliers.map((supplier) => {
          const balance = supplierBalanceCents(supplier.id, db.supplierPayments);
          const history = db.supplierPayments
            .filter((record) => record.supplierId === supplier.id)
            .slice()
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
          return (
            <article className="card supplier-card" key={supplier.id}>
              <header>
                <div><h3>{supplier.name}</h3><span>{[supplier.contact, supplier.phone, supplier.address].filter(Boolean).join(" · ") || "Контактные данные не указаны"}</span></div>
                <div className="supplier-card-actions">
                  <strong className={balance ? "supplier-debt" : "supplier-settled"}>{balance ? `Долг ${formatMoney(centsToAmount(balance))}` : "Расчёты закрыты"}</strong>
                  <button type="button" className="btn-sm" onClick={() => startEdit(supplier)}>Изменить</button>
                  <button type="button" className="btn-sm" onClick={() => archiveSupplier(supplier)} aria-label="Архивировать поставщика"><Archive size={14} /></button>
                </div>
              </header>
              {supplier.comment && <p className="supplier-comment">{supplier.comment}</p>}
              <div className="supplier-history">
                {history.slice(0, 5).map((record) => (
                  <div key={record.id}>
                    <span>{record.type === "purchase" ? `Поставка · ${record.itemName || "товар"}${record.quantity ? ` · ${record.quantity} шт.` : ""}` : "Оплата поставщику"}</span>
                    <strong>{record.type === "purchase" ? formatMoney(record.amount) : `−${formatMoney(record.amount)}`}</strong>
                  </div>
                ))}
                {!history.length && <span>Поставок и оплат пока нет</span>}
              </div>
            </article>
          );
        })}
        {!activeSuppliers.length && <section className="card customers-empty"><Truck size={25} /><h3>Поставщиков пока нет</h3><p>Добавьте поставщика, чтобы регистрировать закупки и остатки задолженности.</p></section>}
      </section>
    </div>
  );
}
