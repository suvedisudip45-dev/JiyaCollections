import { prisma } from "../config/db.js";
import { postJournalEntry } from "./accountingPostingEngine.js";

const RATE_FIELDS = {
  NCM: {
    RETURN: "ncmReturnSettlementRate",
    EXCHANGE: "ncmExchangeSettlementRate",
  },
  DISTRIBUTOR: {
    RETURN: "distributorReturnSettlementRate",
    EXCHANGE: "distributorExchangeSettlementRate",
  },
};

export const resolveReturnExchangeSettlementRate = (config, route, operation) => {
  const field = RATE_FIELDS[String(route || "").toUpperCase()]?.[String(operation || "").toUpperCase()];
  return field ? Number(config?.[field] ?? 0) : 0;
};

export const createReturnExchangeSettlementPayable = async (tx, request, operation) => {
  if (!["RETURN", "EXCHANGE"].includes(operation)) {
    throw new Error("Unsupported return or exchange settlement operation.");
  }
  const amount = Number(request.logisticsSettlementAmount || 0);
  if (amount <= 0) return null;
  if (!["NCM", "DISTRIBUTOR"].includes(request.deliveryRoute)) {
    throw new Error("A completed return or exchange has no valid logistics route for settlement.");
  }

  const referenceType = operation === "RETURN" ? "RETURN_LOGISTICS_SETTLEMENT" : "EXCHANGE_LOGISTICS_SETTLEMENT";
  const existing = await tx.accountPayable.findFirst({
    where: { referenceType, referenceId: request.id },
  });
  if (existing) return existing;

  let payeeName = "Nepal Can Move";
  if (request.deliveryRoute === "DISTRIBUTOR") {
    if (!request.distributorId) throw new Error("The distributor for this logistics settlement is missing.");
    const distributor = await tx.distributor.findUnique({
      where: { id: request.distributorId },
      select: { name: true },
    });
    if (!distributor) throw new Error("The distributor for this logistics settlement could not be found.");
    payeeName = distributor.name;
  }

  return tx.accountPayable.create({
    data: {
      title: `${operation === "RETURN" ? "Return" : "Exchange"} logistics settlement #${request.id.slice(0, 8)}`,
      payeeName,
      category: "OPERATING_EXPENSE",
      referenceType,
      referenceId: request.id,
      totalAmount: amount,
      paidAmount: 0,
      remainingBalance: amount,
      status: "UNPAID",
      priority: "MEDIUM",
      notes: `Configured ${request.deliveryRoute.toLowerCase()} ${operation.toLowerCase()} logistics settlement.`,
    },
  });
};

export const postReturnExchangeSettlementAccounting = async ({
  operation,
  requestId,
  payable: suppliedPayable = null,
  client = prisma,
}) => {
  const referenceType = operation === "RETURN" ? "RETURN_LOGISTICS_SETTLEMENT" : "EXCHANGE_LOGISTICS_SETTLEMENT";
  const payable = suppliedPayable || await client.accountPayable.findFirst({
    where: { referenceType, referenceId: requestId },
  });
  if (!payable || Number(payable.totalAmount || 0) <= 0) return null;
  const amount = String(payable.totalAmount);
  return postJournalEntry({
    transactionDate: payable.createdAt || new Date(),
    sourceType: "EXPENSE_PAYMENT",
    sourceId: `LOGISTICS-${referenceType}-${requestId}`,
    idempotencyKey: `EXPENSE:LOGISTICS-${referenceType}-${requestId}:${amount}`,
    referenceNumber: `EXP-${requestId.slice(-6)}`,
    description: payable.title || `${operation} logistics settlement`,
    createdBy: "SYSTEM",
    lines: [
      {
        accountCode: "6430",
        debit: payable.totalAmount,
        credit: 0,
        description: payable.title || `${operation} logistics expense`,
      },
      {
        accountCode: "2110",
        debit: 0,
        credit: payable.totalAmount,
        description: `Recorded as liability to ${payable.payeeName || "carrier"}`,
        supplierName: payable.payeeName || "",
      },
    ],
    client,
  });
};
