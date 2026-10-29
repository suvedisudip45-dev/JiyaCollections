import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments } from "./accountingSubledgerService.js";

const roundAmount = (value) => Number(new Prisma.Decimal(String(value || 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
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
            sourceType: { in: ["MANUFACTURER_DELIVERY_COGS", "MANUFACTURER_DELIVERY_RETURN"] },
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
  let legacyProductionRecognized = 0;
  let logisticsRecognized = 0;
  let totalPaid = 0;
  let unattributedLegacyLineCount = 0;
  const documentedProductionSources = new Set(
    manufacturerDocuments
      .filter((document) => document.side === "PAYABLE" && document.sourceType === "MANUFACTURER_DELIVERY_COGS")
      .map((document) => document.sourceId)
  );
  const productionBills = manufacturerDocuments.filter((document) =>
    document.side === "PAYABLE" && document.sourceType === "MANUFACTURER_DELIVERY_COGS"
  );
  const supplierCredits = manufacturerDocuments.filter((document) =>
    document.side === "RECEIVABLE" && document.sourceType === "MANUFACTURER_DELIVERY_RETURN"
  );
  const supplierCreditOriginalByReturn = new Map();
  for (const document of supplierCredits) {
    supplierCreditOriginalByReturn.set(
      document.sourceId,
      (supplierCreditOriginalByReturn.get(document.sourceId) || 0) + Number(document.originalAmount || 0)
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
    const netPayable = Number(line.credit || 0) - Number(line.debit || 0);
    if (sourceType === "MANUFACTURER_PRODUCTION" ||
        (sourceType === "DELIVERY_SALE" && !documentedProductionSources.has(line.journalEntry?.sourceId))) {
      legacyProductionRecognized += netPayable;
    }
    if (sourceType === "DELIVERY_RETURN") {
      legacyProductionRecognized += netPayable + (supplierCreditOriginalByReturn.get(line.journalEntry?.sourceId) || 0);
    }
    if (sourceType === "MANUFACTURER_LOGISTICS") logisticsRecognized += netPayable;
    if (sourceType === "SUPPLIER_PAYMENT") totalPaid -= netPayable;
  }
  const productionBillOriginal = productionBills.reduce((sum, document) => sum + Number(document.originalAmount || 0), 0);
  const productionBillOutstanding = productionBills.reduce((sum, document) => sum + Number(document.remainingAmount || 0), 0);
  const productionAllocatedPayments = productionBills.reduce((sum, document) => sum + Number(document.allocatedAmount || 0), 0);
  const supplierCreditOutstanding = supplierCredits.reduce((sum, document) => sum + Number(document.remainingAmount || 0), 0);
  const settlementTotal = (status, requestType) => Number(
    settlementTotals.find((entry) => entry.status === status && entry.requestType === requestType)?._sum.amount || 0
  );
  const pendingProduction = settlementTotal("PENDING", "PRODUCTION");
  const pendingLogistics = settlementTotal("PENDING", "LOGISTICS");
  const partiallyPaid = (requestType) => {
    const entry = settlementTotals.find((item) => item.status === "PARTIALLY_PAID" && item.requestType === requestType);
    return Math.max(0, Number(entry?._sum.amount || 0) - Number(entry?._sum.paidAmount || 0));
  };
  const paidFromSettlements = (requestType) => {
    const paidEntry = settlementTotals.find((item) => item.status === "PAID" && item.requestType === requestType);
    const partialEntry = settlementTotals.find((item) => item.status === "PARTIALLY_PAID" && item.requestType === requestType);
    return Number(paidEntry?._sum.paidAmount ?? paidEntry?._sum.amount ?? 0)
      + Number(partialEntry?._sum.paidAmount || 0);
  };
  const settlementPaidLogistics = paidFromSettlements("LOGISTICS");
  const pendingRequestTotal = pendingProduction + pendingLogistics
    + partiallyPaid("PRODUCTION") + partiallyPaid("LOGISTICS");
  const nonDocumentedProductionPayments = Math.max(0, totalPaid - productionAllocatedPayments - settlementPaidLogistics);
  const productionRecognized = productionBillOriginal + legacyProductionRecognized;
  const productionOutstanding = Math.max(
    0,
    productionBillOutstanding + legacyProductionRecognized - nonDocumentedProductionPayments
  );
  const logisticsOutstanding = Math.max(0, logisticsRecognized - settlementPaidLogistics);
  const completedPayments = totalPaid;

  return {
    manufacturer,
    totalManufacturedGoodsValue: roundAmount(productionRecognized),
    logisticsReimbursements: roundAmount(logisticsRecognized),
    pendingSettlementAmount: roundAmount(pendingRequestTotal),
    completedPayments: roundAmount(completedPayments),
    outstandingPayable: roundAmount(Math.max(0, productionOutstanding + logisticsOutstanding)),
    supplierCreditOutstanding: roundAmount(supplierCreditOutstanding),
    supplierCreditsRequireExplicitApplication: supplierCreditOutstanding > 0,
    unattributedLegacyLineCount,
    attributionReconciliationRequired: unattributedLegacyLineCount > 0,
    productionOutstanding: roundAmount(productionOutstanding),
    logisticsOutstanding: roundAmount(logisticsOutstanding),
    productionPayableAvailable: roundAmount(Math.max(0, productionOutstanding - pendingProduction)),
    logisticsPayableAvailable: roundAmount(Math.max(0, logisticsOutstanding - pendingLogistics)),
    settlements,
  };
};

export const allocateManufacturerPaymentToDocuments = async ({
  manufacturerId,
  amount,
  journalEntryId,
  idempotencyKey,
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
      sourceType: "MANUFACTURER_DELIVERY_COGS",
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
    sourceTypes: ["MANUFACTURER_DELIVERY_COGS"],
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

export const normalizeSettlementRequest = ({ requestType, amount, notes }) => {
  const type = String(requestType || "PRODUCTION").trim().toUpperCase();
  const normalizedAmount = new Prisma.Decimal(String(amount ?? ""));
  const normalizedNotes = String(notes || "").trim();
  if (!["PRODUCTION", "LOGISTICS"].includes(type)) {
    throw Object.assign(new Error("Settlement type must be PRODUCTION or LOGISTICS."), { statusCode: 400 });
  }
  if (!normalizedAmount.isFinite() || !normalizedAmount.greaterThan(0)) {
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
