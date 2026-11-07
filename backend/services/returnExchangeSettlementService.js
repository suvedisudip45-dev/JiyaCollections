import { prisma } from "../config/db.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";

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
  if (!["NCM", "DISTRIBUTOR"].includes(request.deliveryRoute)) {
    throw new Error("A completed return or exchange has no valid logistics route for settlement.");
  }

  const referenceType = operation === "RETURN" ? "RETURN_LOGISTICS_SETTLEMENT" : "EXCHANGE_LOGISTICS_SETTLEMENT";
  const existing = await tx.accountPayable.findFirst({
    where: { referenceType, referenceId: request.id },
  });
  if (existing) return existing;

  const reportedNcmCharge = request.deliveryRoute === "NCM"
    ? operation === "RETURN"
      ? request.ncmDeliveryCharge
      : request.ncmTotalCharge ?? (
          request.ncmReturnCharge != null && request.ncmReplacementCharge != null
            ? Number(request.ncmReturnCharge) + Number(request.ncmReplacementCharge)
            : null
        )
    : null;
  const hasReportedCharge = reportedNcmCharge !== null && reportedNcmCharge !== undefined;
  const amount = Number(reportedNcmCharge ?? request.logisticsSettlementAmount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Return or exchange logistics charge must be a valid non-negative amount.");
  }
  if (amount === 0) return null;

  if (request.deliveryRoute === "NCM" && request.ncmChargePayer === "CUSTOMER") {
    return null;
  }

  let payeeName = "Nepal Can Move";
  if (request.deliveryRoute === "DISTRIBUTOR") {
    if (!request.distributorId) throw new Error("The distributor for this logistics settlement is missing.");
    const distributor = await tx.distributor.findUnique({
      where: { id: request.distributorId },
      select: { id: true, name: true },
    });
    if (!distributor) throw new Error("The distributor for this logistics settlement could not be found.");
    payeeName = distributor.name;
    const party = await ensureAccountingParty({
      partyType: "DISTRIBUTOR",
      sourceEntityId: distributor.id,
      displayName: distributor.name || `Distributor (${distributor.id.slice(-6)})`,
    }, { client: tx });

    const documentSourceType = operation === "RETURN"
      ? "DISTRIBUTOR_RETURN_LOGISTICS"
      : "DISTRIBUTOR_EXCHANGE_LOGISTICS";
    const document = await createAccountingDocument({
      documentType: "BILL",
      documentNumber: `DIST-${operation === "RETURN" ? "RET" : "EXC"}-${request.id}`,
      partyId: party.id,
      side: "PAYABLE",
      sourceType: documentSourceType,
      sourceId: request.id,
      amount,
      issueDate: new Date(),
      notes: `Distributor ${operation.toLowerCase()} logistics ${hasReportedCharge ? "reported charge" : "configured rate estimate"}.`,
      idempotencyKey: `${documentSourceType}:${request.id}`,
    }, { client: tx });
    return {
      id: document.id,
      title: `${operation === "RETURN" ? "Return" : "Exchange"} logistics settlement #${request.id.slice(0, 8)}`,
      payeeName,
      totalAmount: document.originalAmount,
      accountingDocumentId: document.id,
      amountSource: hasReportedCharge ? "PROVIDER_REPORTED" : "CONFIGURED_ESTIMATE",
    };
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
      notes: `${hasReportedCharge ? "Provider-reported" : "Configured rate estimate"} for ${request.deliveryRoute.toLowerCase()} ${operation.toLowerCase()} logistics settlement.`,
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
  const request = operation === "RETURN"
    ? await client.customerReturn.findUnique({
        where: { id: requestId },
        select: { deliveryRoute: true, distributorId: true },
      })
    : await client.orderExchangeRequest.findUnique({
        where: { id: requestId },
        select: { deliveryRoute: true, distributorId: true },
      });
  let accountingPartyId = null;
  if (request?.deliveryRoute === "DISTRIBUTOR" && request.distributorId) {
    const distributor = await client.distributor.findUnique({
      where: { id: request.distributorId },
      select: { id: true, name: true },
    });
    if (!distributor) throw new Error("The distributor for this logistics settlement could not be found.");
    const party = await ensureAccountingParty({
      partyType: "DISTRIBUTOR",
      sourceEntityId: distributor.id,
      displayName: distributor.name || `Distributor (${distributor.id.slice(-6)})`,
    }, { client });
    accountingPartyId = party.id;
  }
  const payableMappingKey = request?.deliveryRoute === "NCM"
    ? "NCM_CARRIER_PAYABLE"
    : request?.deliveryRoute === "DISTRIBUTOR"
      ? "DISTRIBUTOR_PAYABLE"
      : "AP_CONTROL";
  const amount = String(payable.totalAmount);
  return postJournalEntry({
    transactionDate: new Date(),
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
        mappingKey: payableMappingKey,
        debit: 0,
        credit: payable.totalAmount,
        description: `Recorded as liability to ${payable.payeeName || "carrier"}`,
        supplierName: payable.payeeName || "",
        supplierId: request?.distributorId || null,
        accountingPartyId,
      },
    ],
    client,
  });
};
