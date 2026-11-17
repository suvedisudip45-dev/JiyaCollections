import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  parseNprAmountString,
  subtractDecimals,
} from "./accountingDecimal.js";

const collectionError = (message, statusCode = 400, code = "INVALID_RECEIVABLE_COLLECTION") =>
  Object.assign(new Error(message), { statusCode, code });

export const parseReceivableCollectionAmounts = ({
  amount,
  adjustmentAmount = "0",
  adjustmentType = "NONE",
}) => {
  const parseAmount = (value, label, options) => {
    try {
      return parseNprAmountString(value, label, options);
    } catch (error) {
      throw collectionError(error.message, 400, error.code || "INVALID_RECEIVABLE_COLLECTION");
    }
  };
  const normalizeRequestedAmount = (value, label) => {
    try {
      return accountingDecimal(value, label).toString();
    } catch (error) {
      throw collectionError(error.message, 400, error.code || "INVALID_RECEIVABLE_COLLECTION");
    }
  };
  const requestedAmount = normalizeRequestedAmount(amount, "Collection amount");
  const requestedAdjustmentAmount = normalizeRequestedAmount(adjustmentAmount, "Adjustment amount");
  const collectedAmount = parseAmount(amount, "Collection amount", { allowZero: false });
  const normalizedAdjustmentType = String(adjustmentType || "NONE").toUpperCase();
  const normalizedAdjustmentAmount = parseAmount(adjustmentAmount, "Adjustment amount");

  if (
    !["NONE", "DISCOUNT", "FINE"].includes(normalizedAdjustmentType) ||
    (normalizedAdjustmentType === "NONE" && compareDecimals(normalizedAdjustmentAmount, "0") > 0) ||
    (normalizedAdjustmentType !== "NONE" && compareDecimals(normalizedAdjustmentAmount, "0") <= 0)
  ) {
    throw collectionError("Choose a valid discount or fine amount, or select no adjustment.");
  }

  const settlementAmount = normalizedAdjustmentType === "DISCOUNT"
    ? addDecimals(collectedAmount, normalizedAdjustmentAmount)
    : normalizedAdjustmentType === "FINE"
      ? subtractDecimals(collectedAmount, normalizedAdjustmentAmount)
      : collectedAmount;

  if (compareDecimals(settlementAmount, "0") <= 0) {
    throw collectionError("The collection and adjustment must settle a positive amount of the receivable.");
  }

  return {
    collectedAmount,
    requestedAmount,
    adjustmentType: normalizedAdjustmentType,
    adjustmentAmount: normalizedAdjustmentAmount,
    requestedAdjustmentAmount,
    settlementAmount,
  };
};

export const readCollectionHistory = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw collectionError("Receivable collection history is invalid.", 500, "INVALID_COLLECTION_HISTORY");
  }
  try {
    const history = JSON.parse(value);
    if (!Array.isArray(history)) throw new Error("Collection history must be an array.");
    return history;
  } catch {
    throw collectionError("Receivable collection history is invalid.", 500, "INVALID_COLLECTION_HISTORY");
  }
};

export const classifyReceivableCollectionReplay = ({
  existingTransaction,
  collectionHistory,
  receivableId,
  expectedReferenceId = receivableId,
  amounts,
  toAccountId,
  notes,
  legacyDescription,
}) => {
  if (!existingTransaction) return "NEW";

  const historyEntry = (collectionHistory || []).find(
    (entry) => entry.idempotencyKey === existingTransaction.idempotencyKey,
  );
  const transactionMatches =
    existingTransaction.type === "INFLOW" &&
    existingTransaction.referenceId === expectedReferenceId &&
    existingTransaction.toAccountId === toAccountId &&
    compareDecimals(existingTransaction.amount, amounts.collectedAmount) === 0;

  if (!transactionMatches) return "CONFLICT";
  if (!historyEntry) {
    return legacyDescription && existingTransaction.description === legacyDescription ? "REPLAY" : "CONFLICT";
  }

  const historyMatches =
    compareDecimals(historyEntry.amount, amounts.collectedAmount) === 0 &&
    compareDecimals(historyEntry.settlementAmount, amounts.settlementAmount) === 0 &&
    compareDecimals(historyEntry.adjustmentAmount || "0", amounts.adjustmentAmount) === 0 &&
    (historyEntry.requestedAmount === undefined || historyEntry.requestedAmount === amounts.requestedAmount) &&
    (historyEntry.requestedAdjustmentAmount === undefined ||
      historyEntry.requestedAdjustmentAmount === amounts.requestedAdjustmentAmount) &&
    String(historyEntry.adjustmentType || "NONE").toUpperCase() === amounts.adjustmentType &&
    historyEntry.toAccountId === toAccountId &&
    String(historyEntry.notes || "Receivable collection") === String(notes || "Receivable collection");

  return historyMatches ? "REPLAY" : "CONFLICT";
};

export const applyReceivableCollection = async ({
  client,
  receivable,
  createReceivable,
  totalAmount,
  balance,
  amounts,
  idempotencyKey,
  toAccountId,
  toAccountName,
  notes,
  category,
  referenceId,
  partyName,
  description,
  postAccounting,
  orderId,
  customerName,
  depositAccountType,
}) => {
  const previousReceived = receivable?.receivedAmount ?? "0";
  const previousBalance = balance ?? receivable?.remainingBalance;
  if (compareDecimals(amounts.settlementAmount, previousBalance) > 0) {
    throw collectionError("Net settlement cannot exceed the remaining receivable balance.", 409, "RECEIVABLE_AMOUNT_EXCEEDS_BALANCE");
  }

  const newRemaining = subtractDecimals(previousBalance, amounts.settlementAmount);
  const newReceived = addDecimals(previousReceived, amounts.collectedAmount);
  const status = compareDecimals(newRemaining, "0") === 0 ? "SETTLED" : "PARTIALLY_RECEIVED";
  const history = readCollectionHistory(receivable?.collectionHistory ?? []);
  const collectionEntry = {
    id: Date.now().toString(),
    idempotencyKey,
    date: new Date().toISOString(),
    amount: amounts.collectedAmount.toFixed(2),
    requestedAmount: amounts.requestedAmount,
    settlementAmount: amounts.settlementAmount.toFixed(2),
    adjustmentType: amounts.adjustmentType,
    adjustmentAmount: amounts.adjustmentAmount.toFixed(2),
    requestedAdjustmentAmount: amounts.requestedAdjustmentAmount,
    toAccountId,
    accountName: toAccountName,
    notes: notes || "Receivable collection",
  };
  history.push(collectionEntry);

  await client.financialAccount.update({
    where: { id: toAccountId },
    data: { currentBalance: { increment: amounts.collectedAmount.toFixed(2) } },
  });
  await client.cashTransaction.create({
    data: {
      idempotencyKey,
      amount: amounts.collectedAmount.toFixed(2),
      type: "INFLOW",
      toAccountId,
      category,
      partyName,
      referenceId,
      description,
    },
  });

  if (receivable) {
    const claimed = await client.accountReceivable.updateMany({
      where: {
        id: receivable.id,
        totalAmount: receivable.totalAmount,
        receivedAmount: receivable.receivedAmount,
        remainingBalance: receivable.remainingBalance,
        status: receivable.status,
      },
      data: {
        totalAmount: totalAmount?.toFixed(2) ?? receivable.totalAmount,
        receivedAmount: newReceived.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        status,
        collectionHistory: history,
      },
    });
    if (claimed.count !== 1) {
      throw collectionError("Receivable changed during collection; refresh and retry.", 409, "RECEIVABLE_CONCURRENCY_CONFLICT");
    }
  } else {
    await client.accountReceivable.create({
      data: {
        ...createReceivable,
        totalAmount: totalAmount.toFixed(2),
        receivedAmount: newReceived.toFixed(2),
        remainingBalance: newRemaining.toFixed(2),
        status,
        collectionHistory: history,
      },
    });
  }

  await postAccounting({
    id: receivable?.id || createReceivable.id,
    orderId,
    customerName,
    amount: amounts.collectedAmount.toFixed(2),
    settlementAmount: amounts.settlementAmount.toFixed(2),
    discountAmount: amounts.adjustmentType === "DISCOUNT" ? amounts.adjustmentAmount.toFixed(2) : "0.00",
    fineAmount: amounts.adjustmentType === "FINE" ? amounts.adjustmentAmount.toFixed(2) : "0.00",
    depositAccountType,
    referenceNumber: `REC-COLL-${idempotencyKey.slice(-48)}`,
    idempotencyKey: `CUSTOMER_PAYMENT:${idempotencyKey}`,
    client,
  });

  return {
    collectedAmount: amounts.collectedAmount.toFixed(2),
    settlementAmount: amounts.settlementAmount.toFixed(2),
    adjustmentAmount: amounts.adjustmentAmount.toFixed(2),
    remainingBalance: newRemaining.toFixed(2),
    receivedAmount: newReceived.toFixed(2),
    status,
  };
};
