import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments } from "./accountingSubledgerService.js";
import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  parseNprAmountString,
  quantizeCurrencyAmount,
  serializeAccountingValue,
  subtractDecimals,
} from "./accountingDecimal.js";

const amountOrZero = (value, fieldName) => accountingDecimal(value ?? "0", fieldName);
const sumAmounts = (rows, fieldName, selectAmount) => rows.reduce(
  (total, row) => addDecimals(total, amountOrZero(selectAmount(row), fieldName)),
  accountingDecimal("0"),
);
const nonNegativeAmount = (value) =>
  compareDecimals(value, "0") > 0 ? accountingDecimal(value) : accountingDecimal("0");
const serializeNprAmount = (value) => quantizeCurrencyAmount(value, "NPR").toFixed(2);
const isManufacturerLine = (line, manufacturer) =>
  line.supplierId === manufacturer.id ||
  (line.accountingParty?.partyType === "MANUFACTURER" && line.accountingParty.sourceEntityId === manufacturer.id);

export const getManufacturerSettlementSummary = async (manufacturerId, { client = prisma } = {}) => {
  const manufacturer = await client.manufacturer.findUnique({
    where: { id: manufacturerId },
    select: { id: true, name: true },
  });
  if (!manufacturer) return null;

  const [settlements, settlementTotals, payableAccount, manufacturerDocuments] = await Promise.all([
    client.manufacturerSettlementRequest.findMany({
      where: { manufacturerId },
      orderBy: { requestedAt: "desc" },
      take: 100,
    }),
    client.manufacturerSettlementRequest.groupBy({
      by: ["status", "requestType"],
      where: { manufacturerId },
      _sum: { amount: true, paidAmount: true },
    }),
    client.account.findUnique({ where: { accountCode: "2160" }, select: { id: true } }),
    client.accountingDocument
      ? client.accountingDocument.findMany({
          where: {
            party: { is: { partyType: "MANUFACTURER", sourceEntityId: manufacturerId } },
            sourceType: { in: ["MANUFACTURER_PRODUCTION", "MANUFACTURER_DELIVERY_COGS", "MANUFACTURER_DELIVERY_RETURN"] },
            side: { in: ["PAYABLE", "RECEIVABLE"] },
          },
          select: {
            side: true,
            sourceType: true,
            sourceId: true,
            originalAmount: true,
            allocatedAmount: true,
            remainingAmount: true,
            status: true,
          },
        })
      : [],
  ]);

  const accountingLines = payableAccount
    ? await client.journalLine.findMany({
        where: { accountId: payableAccount.id },
        select: {
          debit: true,
          credit: true,
          supplierId: true,
          supplierName: true,
          accountingParty: { select: { partyType: true, sourceEntityId: true } },
          journalEntry: { select: { sourceType: true, sourceId: true } },
        },
      })
    : [];
  let legacyProductionRecognized = accountingDecimal("0");
  let logisticsRecognized = accountingDecimal("0");
  let totalPaid = accountingDecimal("0");
  let unattributedLegacyLineCount = 0;
  const documentedProductionSources = new Set(
    manufacturerDocuments
      .filter((document) =>
        document.side === "PAYABLE" &&
        ["MANUFACTURER_PRODUCTION", "MANUFACTURER_DELIVERY_COGS"].includes(document.sourceType)
      )
      .map((document) => document.sourceId)
  );
  const productionBills = manufacturerDocuments.filter((document) =>
    document.side === "PAYABLE" &&
    ["MANUFACTURER_PRODUCTION", "MANUFACTURER_DELIVERY_COGS"].includes(document.sourceType)
  );
  const supplierCredits = manufacturerDocuments.filter((document) =>
    document.side === "RECEIVABLE" && document.sourceType === "MANUFACTURER_DELIVERY_RETURN"
  );
  const supplierCreditOriginalByReturn = new Map();
  for (const document of supplierCredits) {
    supplierCreditOriginalByReturn.set(
      document.sourceId,
      addDecimals(
        supplierCreditOriginalByReturn.get(document.sourceId) || accountingDecimal("0"),
        amountOrZero(document.originalAmount, "Manufacturer supplier credit amount"),
      )
    );
  }
  for (const line of accountingLines) {
    if (
      !line.supplierId &&
      !(line.accountingParty?.partyType === "MANUFACTURER" && line.accountingParty.sourceEntityId === manufacturer.id) &&
      String(line.supplierName || "").trim().toLowerCase() === manufacturer.name.trim().toLowerCase()
    ) {
      unattributedLegacyLineCount += 1;
    }
    if (!isManufacturerLine(line, manufacturer)) continue;
    const sourceType = line.journalEntry?.sourceType;
    const netPayable = subtractDecimals(
      amountOrZero(line.credit, "Manufacturer payable journal credit"),
      amountOrZero(line.debit, "Manufacturer payable journal debit"),
    );
    if ((sourceType === "MANUFACTURER_PRODUCTION" &&
         !documentedProductionSources.has(line.journalEntry?.sourceId)) ||
        (sourceType === "DELIVERY_SALE" && !documentedProductionSources.has(line.journalEntry?.sourceId))) {
      legacyProductionRecognized = addDecimals(legacyProductionRecognized, netPayable);
    }
    if (sourceType === "DELIVERY_RETURN") {
      legacyProductionRecognized = addDecimals(
        legacyProductionRecognized,
        netPayable,
        supplierCreditOriginalByReturn.get(line.journalEntry?.sourceId) || accountingDecimal("0"),
      );
    }
    if (sourceType === "MANUFACTURER_LOGISTICS") {
      logisticsRecognized = addDecimals(logisticsRecognized, netPayable);
    }
    if (sourceType === "SUPPLIER_PAYMENT") {
      totalPaid = subtractDecimals(totalPaid, netPayable);
    }
  }
  const productionBillOriginal = sumAmounts(
    productionBills,
    "Manufacturer production bill amount",
    (document) => document.originalAmount,
  );
  const productionBillOutstanding = sumAmounts(
    productionBills,
    "Manufacturer production bill balance",
    (document) => document.remainingAmount,
  );
  const productionAllocatedPayments = sumAmounts(
    productionBills,
    "Manufacturer production bill allocation",
    (document) => document.allocatedAmount,
  );
  const supplierCreditOutstanding = sumAmounts(
    supplierCredits,
    "Manufacturer supplier credit balance",
    (document) => document.remainingAmount,
  );
  const activeRequestBalance = (requestType) => settlementTotals
    .filter((entry) => ["PENDING", "PARTIALLY_PAID"].includes(entry.status) && entry.requestType === requestType)
    .reduce((total, entry) => addDecimals(
      total,
      subtractDecimals(
        amountOrZero(entry._sum.amount, "Manufacturer settlement request amount"),
        amountOrZero(entry._sum.paidAmount, "Manufacturer settlement paid amount"),
      ),
    ), accountingDecimal("0"));
  const pendingProduction = nonNegativeAmount(activeRequestBalance("PRODUCTION"));
  const pendingLogistics = nonNegativeAmount(activeRequestBalance("LOGISTICS"));
  const paidFromSettlements = (requestType) => {
    const paidEntry = settlementTotals.find((item) => item.status === "PAID" && item.requestType === requestType);
    const partialEntry = settlementTotals.find((item) => item.status === "PARTIALLY_PAID" && item.requestType === requestType);
    return addDecimals(
      amountOrZero(paidEntry?._sum.paidAmount ?? paidEntry?._sum.amount, "Manufacturer settled request amount"),
      amountOrZero(partialEntry?._sum.paidAmount, "Manufacturer partially paid request amount"),
    );
  };
  const settlementPaidLogistics = paidFromSettlements("LOGISTICS");
  const pendingRequestTotal = addDecimals(pendingProduction, pendingLogistics);
  const nonDocumentedProductionPayments = nonNegativeAmount(
    subtractDecimals(subtractDecimals(totalPaid, productionAllocatedPayments), settlementPaidLogistics),
  );
  const productionRecognized = addDecimals(productionBillOriginal, legacyProductionRecognized);
  const productionOutstanding = nonNegativeAmount(
    subtractDecimals(addDecimals(productionBillOutstanding, legacyProductionRecognized), nonDocumentedProductionPayments),
  );
  const logisticsOutstanding = nonNegativeAmount(subtractDecimals(logisticsRecognized, settlementPaidLogistics));
  const completedPayments = totalPaid;
  const outstandingPayable = nonNegativeAmount(addDecimals(productionOutstanding, logisticsOutstanding));
  const productionPayableAvailable = nonNegativeAmount(subtractDecimals(productionOutstanding, pendingProduction));
  const logisticsPayableAvailable = nonNegativeAmount(subtractDecimals(logisticsOutstanding, pendingLogistics));

  return {
    manufacturer,
    totalManufacturedGoodsValue: serializeNprAmount(productionRecognized),
    logisticsReimbursements: serializeNprAmount(logisticsRecognized),
    pendingSettlementAmount: serializeNprAmount(pendingRequestTotal),
    completedPayments: serializeNprAmount(completedPayments),
    outstandingPayable: serializeNprAmount(outstandingPayable),
    supplierCreditOutstanding: serializeNprAmount(supplierCreditOutstanding),
    supplierCreditsRequireExplicitApplication: compareDecimals(supplierCreditOutstanding, "0") > 0,
    unattributedLegacyLineCount,
    attributionReconciliationRequired: unattributedLegacyLineCount > 0,
    productionOutstanding: serializeNprAmount(productionOutstanding),
    logisticsOutstanding: serializeNprAmount(logisticsOutstanding),
    productionPayableAvailable: serializeNprAmount(productionPayableAvailable),
    logisticsPayableAvailable: serializeNprAmount(logisticsPayableAvailable),
    settlements: serializeAccountingValue(settlements),
  };
};

export const allocateManufacturerPaymentToDocuments = async ({
  manufacturerId,
  amount,
  journalEntryId,
  idempotencyKey,
  sourceTypes = ["MANUFACTURER_PRODUCTION", "MANUFACTURER_DELIVERY_COGS"],
  notes = null,
  client = prisma,
}) => {
  const paymentAmount = new Prisma.Decimal(String(amount || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!paymentAmount.isFinite() || paymentAmount.lessThanOrEqualTo(0)) {
    throw new Error("Manufacturer payment allocation requires a positive amount.");
  }
  const manufacturer = await client.manufacturer.findUnique({
    where: { id: manufacturerId },
    select: { id: true, name: true },
  });
  if (!manufacturer) throw new Error("Manufacturer profile not found while allocating payment.");
  const party = await ensureAccountingParty({
    partyType: "MANUFACTURER",
    sourceEntityId: manufacturer.id,
    displayName: manufacturer.name,
  }, { client });
  const documents = await client.accountingDocument.findMany({
    where: {
      partyId: party.id,
      side: "PAYABLE",
      sourceType: { in: sourceTypes },
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, remainingAmount: true },
  });
  const availableDocumentAmount = documents.reduce(
    (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
    new Prisma.Decimal(0)
  );
  const allocationAmount = Prisma.Decimal.min(paymentAmount, availableDocumentAmount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (allocationAmount.lessThanOrEqualTo(0)) {
    return {
      totalAllocated: new Prisma.Decimal(0),
      unallocatedAmount: paymentAmount,
      allocations: [],
      updatedDocuments: [],
    };
  }
  const allocation = await allocatePaymentToDocuments({
    partyId: party.id,
    side: "PAYABLE",
    amount: allocationAmount,
    journalEntryId,
    targetDocumentIds: documents.map((document) => document.id),
    sourceTypes,
    idempotencyKey,
    notes: notes || `Manufacturer payout allocation ${idempotencyKey}`,
  }, { client });
  return {
    ...allocation,
    unallocatedAmount: paymentAmount.minus(allocation.totalAllocated)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
};

export const reconcileManufacturerLogisticsShipmentPayments = async ({ manufacturerId, client = prisma }) => {
  const [paidSettlements, shipments] = await Promise.all([
    client.manufacturerSettlementRequest.aggregate({
      where: { manufacturerId, requestType: "LOGISTICS", status: "PAID" },
      _sum: { amount: true },
    }),
    client.stockTransferShipment.findMany({
      where: {
        bookingMode: "MANUAL",
        dispatchedAt: { not: null },
        freightCharge: { gt: 0 },
        stockTransfer: { manufacturerId },
      },
      orderBy: [{ dispatchedAt: "asc" }, { id: "asc" }],
      select: { id: true, freightCharge: true, freightPaidAmount: true },
    }),
  ]);
  let remainingPaid = new Prisma.Decimal(String(paidSettlements._sum.amount || 0));
  let allocatedPaid = new Prisma.Decimal(0);

  for (const shipment of shipments) {
    const charge = new Prisma.Decimal(String(shipment.freightCharge || 0));
    const targetPaid = Prisma.Decimal.min(charge, remainingPaid).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const currentPaid = new Prisma.Decimal(String(shipment.freightPaidAmount || 0));
    const settlementStatus = targetPaid.greaterThanOrEqualTo(charge)
      ? "SETTLED"
      : targetPaid.greaterThan(0)
        ? "PARTIALLY_SETTLED"
        : "PENDING_ADMIN_SETTLEMENT";

    if (!targetPaid.equals(currentPaid) || shipment.freightSettlementStatus !== settlementStatus) {
      await client.stockTransferShipment.update({
        where: { id: shipment.id },
        data: { freightPaidAmount: targetPaid, freightSettlementStatus: settlementStatus },
      });
    }
    allocatedPaid = allocatedPaid.plus(targetPaid);
    remainingPaid = remainingPaid.minus(targetPaid);
  }

  return {
    allocatedPaidAmount: allocatedPaid.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    unreconciledPaidAmount: Prisma.Decimal.max(remainingPaid, 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
};

export const normalizeSettlementRequest = ({ requestType, amount, notes } = {}) => {
  const type = String(requestType || "PRODUCTION").trim().toUpperCase();
  const normalizedNotes = String(notes || "").trim();
  if (!["PRODUCTION", "LOGISTICS"].includes(type)) {
    throw Object.assign(new Error("Settlement type must be PRODUCTION or LOGISTICS."), { statusCode: 400 });
  }
  let normalizedAmount;
  try {
    normalizedAmount = parseNprAmountString(amount, "Settlement amount", { allowZero: false });
  } catch (error) {
    if (error.code !== "INVALID_DECIMAL_INPUT" && error.code !== "DECIMAL_OUT_OF_RANGE" &&
        error.code !== "UNSUPPORTED_DECIMAL_PRECISION") {
      throw error;
    }
    throw Object.assign(new Error("Settlement amount must be a positive valid amount."), { statusCode: 400 });
  }
  if (normalizedNotes.length > 2000) {
    throw Object.assign(new Error("Settlement notes cannot exceed 2000 characters."), { statusCode: 400 });
  }
  return {
    requestType: type,
    amount: normalizedAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    notes: normalizedNotes || null,
  };
};
