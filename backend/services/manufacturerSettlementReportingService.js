import {
  accountingDecimal,
  compareDecimals,
  subtractDecimals,
} from "./accountingDecimal.js";

const amountString = (value, fieldName) =>
  accountingDecimal(value ?? "0", fieldName).toString();

const remainingAmount = (amount, paidAmount) => {
  const remaining = subtractDecimals(
    accountingDecimal(amount ?? "0", "Manufacturer settlement amount"),
    accountingDecimal(paidAmount ?? "0", "Manufacturer settlement paid amount"),
  );
  return compareDecimals(remaining, "0") > 0 ? remaining.toString() : "0";
};

const serializePayout = (payout) => ({
  ...payout,
  amount: amountString(payout.amount, "Manufacturer payout amount"),
  settlementAmount: amountString(payout.settlementAmount, "Manufacturer payout settlement amount"),
  adjustmentAmount: amountString(payout.adjustmentAmount, "Manufacturer payout adjustment amount"),
  cashTransaction: payout.cashTransaction
    ? {
        ...payout.cashTransaction,
        amount: amountString(payout.cashTransaction.amount, "Manufacturer payout cash transaction amount"),
      }
    : null,
});

export const serializeManufacturerSettlementHistory = (requests = []) =>
  requests.map((request) => ({
    ...request,
    amount: amountString(request.amount, "Manufacturer settlement amount"),
    paidAmount: amountString(request.paidAmount, "Manufacturer settlement paid amount"),
    remainingAmount: remainingAmount(request.amount, request.paidAmount),
    payoutHistory: (request.payoutHistory || []).map(serializePayout),
  }));
