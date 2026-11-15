import { amountToCents } from "./finance.mjs";

export function supplierPurchaseBalanceCents(purchase, supplierPayments) {
  const paidByPurchase = supplierPayments
    .filter((payment) => payment.type === "payment" && payment.purchaseId === purchase.id)
    .reduce((total, payment) => total + Math.max(0, amountToCents(payment.amount)), 0);

  return Math.max(
    0,
    amountToCents(purchase.amount) -
      Math.max(0, amountToCents(purchase.paidAmount)) -
      paidByPurchase,
  );
}

export function supplierBalanceCents(supplierId, supplierPayments) {
  const purchases = supplierPayments.filter(
    (payment) => payment.type === "purchase" && payment.supplierId === supplierId,
  );
  return purchases.reduce(
    (total, purchase) => total + supplierPurchaseBalanceCents(purchase, supplierPayments),
    0,
  );
}

export function openSupplierPurchases(supplierPayments) {
  return supplierPayments
    .filter((payment) => payment.type === "purchase")
    .map((purchase) => ({
      ...purchase,
      balanceCents: supplierPurchaseBalanceCents(purchase, supplierPayments),
    }))
    .filter((purchase) => purchase.balanceCents > 0);
}
