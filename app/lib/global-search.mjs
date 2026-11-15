const searchable = (values, query) =>
  values.some((value) =>
    String(value ?? "").toLocaleLowerCase("ru").includes(query),
  );

export function searchRecords(db, input, limit = 8) {
  const query = String(input || "").trim().toLocaleLowerCase("ru");
  if (!query) return [];

  const results = [];
  db.customers.forEach((customer) => {
    if (searchable([customer.name, customer.phone], query)) {
      results.push({
        id: `customer:${customer.id}`,
        type: "customer",
        title: customer.name || customer.phone || "Клиент",
        detail: customer.phone || "Карточка клиента",
        value: customer,
      });
    }
  });
  db.vehicles.forEach((vehicle) => {
    if (searchable([vehicle.makeModel, vehicle.plate, vehicle.vin], query)) {
      results.push({
        id: `vehicle:${vehicle.id}`,
        type: "vehicle",
        title: vehicle.makeModel || "Автомобиль",
        detail: [vehicle.plate, vehicle.vin].filter(Boolean).join(" · ") || "Карточка автомобиля",
        value: vehicle,
      });
    }
  });
  db.clients.forEach((booking) => {
    if (searchable([booking.car, booking.phone, booking.service, booking.comment], query)) {
      results.push({
        id: `booking:${booking.id}`,
        type: "booking",
        title: booking.car || booking.phone || "Запись клиента",
        detail: [booking.phone, booking.service].filter(Boolean).join(" · ") || "Запись клиента",
        value: booking,
      });
    }
  });
  db.orders.forEach((order) => {
    if (searchable([order.number, order.car, order.customerName, order.status], query)) {
      results.push({
        id: `order:${order.id}`,
        type: "order",
        title: order.number || order.car || "Заказ",
        detail: [order.car, order.status].filter(Boolean).join(" · ") || "Заказ мастерской",
        value: order,
      });
    }
  });
  db.suppliers.forEach((supplier) => {
    if (searchable([supplier.name, supplier.contact, supplier.phone], query)) {
      results.push({
        id: `supplier:${supplier.id}`,
        type: "supplier",
        title: supplier.name || "Поставщик",
        detail: supplier.phone || supplier.contact || "Поставщик",
        value: supplier,
      });
    }
  });
  return results.slice(0, Math.max(0, limit));
}
