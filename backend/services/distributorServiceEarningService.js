import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments, createAccountingDocument } from "./accountingSubledgerService.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";

const money = (value, label) => {
  const amount = new Prisma.Decimal(String(value ?? 0));
  if (!amount.isFinite() || amount.isNegative()) {
    throw new Error(`${label} must be a non-negative amount.`);
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const commissionFor = (rate, base) => {
  const commissionRate = money(rate, "Distributor commission rate");
  return commissionRate.greaterThan(0) && commissionRate.lessThanOrEqualTo(100)
    ? base.mul(commissionRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : commissionRate;
};

const applyOutstandingCounterSaleReversals = async ({ distributorId, distributorName, document, client }) => {
  if (!document?.id || !client.distributorServiceEarning?.findMany) return;
  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributorId,
    displayName: distributorName,
  }, { client });
  const reversals = await client.distributorServiceEarning.findMany({
    where: { distributorId, serviceType: "COUNTER_SALE_REVERSAL" },
    orderBy: { effectiveAt: "asc" },
  });
  for (const reversal of reversals) {
    if (!reversal.accountingDocumentId) {
      throw new Error(`Counter-sale reversal ${reversal.id} is missing its payable credit note.`);
    }
    const remaining = new Prisma.Decimal(String(reversal.payableAmount)).abs()
      .minus(new Prisma.Decimal(String(reversal.appliedReversalAmount || 0)));
    if (!remaining.greaterThan(0)) continue;
    const allocation = await allocatePaymentToDocuments({
      partyId: party.id,
      side: "PAYABLE",
      amount: remaining,
      journalEntryId: reversal.journalEntryId,
      allocationType: "OFFSET",
      targetDocumentIds: [document.id],
      sourceTypes: ["DISTRIBUTOR_SERVICE_EARNING"],
      notes: `Apply hub sale return reversal ${reversal.id} against distributor payable.`,
      idempotencyKey: `${reversal.id}:OFFSET:${document.id}`,
    }, { client });
    if (allocation.totalAllocated.greaterThan(0)) {
      const creditNoteAllocation = await allocatePaymentToDocuments({
        partyId: party.id,
        side: "PAYABLE",
        amount: allocation.totalAllocated,
        journalEntryId: reversal.journalEntryId,
        allocationType: "OFFSET",
        targetDocumentIds: [reversal.accountingDocumentId],
        sourceTypes: ["DISTRIBUTOR_SERVICE_EARNING_REVERSAL"],
        notes: `Apply hub sale return credit note ${reversal.accountingDocumentId}.`,
        idempotencyKey: `${reversal.id}:CREDIT_NOTE_OFFSET:${document.id}`,
      }, { client });
      if (!creditNoteAllocation.totalAllocated.equals(allocation.totalAllocated)) {
        throw new Error(`Counter-sale reversal credit note ${reversal.accountingDocumentId} is out of balance.`);
      }
      await client.distributorServiceEarning.update({
        where: { id: reversal.id },
        data: { appliedReversalAmount: new Prisma.Decimal(String(reversal.appliedReversalAmount || 0)).plus(allocation.totalAllocated) },
      });
    }
  }
};

export const accrueDistributorDeliveryEarning = async ({
  distributorId,
  distributorName,
  assignmentId,
  orderId,
  effectiveAt = new Date(),
  client = prisma,
  rateCardResolver = resolveActiveRateCard,
  journalPoster = postJournalEntry,
} = {}) => {
  if (!distributorId || !distributorName || !assignmentId || !orderId) {
    throw new Error("Distributor, assignment, and order details are required to accrue delivery earnings.");
  }
  if (!client.distributorServiceEarning) {
    throw new Error("Distributor service earning storage is unavailable. Apply the pending Prisma migration first.");
  }

  const idempotencyKey = `DISTRIBUTOR_DELIVERY_EARNING:${assignmentId}`;
  const prior = await client.distributorServiceEarning.findUnique({ where: { idempotencyKey } });
  if (prior) {
    if (prior.distributorId !== distributorId || prior.orderId !== orderId) {
      throw new Error("Delivery earning idempotency key is already associated with a different source.");
    }
    return prior;
  }

  const rateCard = await rateCardResolver({
    distributorId,
    effectiveAt,
    client,
  });
  const deliveryCharge = money(rateCard.deliveryCharge, "Delivery charge");
  const incentiveAmount = money(0, "Delivery incentive");
  const commissionAmount = commissionFor(rateCard.commissionRate ?? 0, deliveryCharge);
  const payableAmount = deliveryCharge.plus(incentiveAmount).minus(commissionAmount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (payableAmount.isNegative()) {
    throw new Error("Configured distributor commission exceeds delivery compensation.");
  }

  const vatInvoiceVerified = false;
  const vatRate = new Prisma.Decimal(0);
  const vatAmount = new Prisma.Decimal(0);
  const rateSnapshot = {
    rateCardId: rateCard.rateCardId || null,
    isDefaultFallback: Boolean(rateCard.isDefaultFallback),
    deliveryCharge: deliveryCharge.toFixed(2),
    incentiveAmount: incentiveAmount.toFixed(2),
    commissionRate: String(rateCard.commissionRate ?? 0),
    commissionAmount: commissionAmount.toFixed(2),
    otherCharges: "0.00",
    vatRate: vatRate.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    vatInvoiceVerified,
    taxTreatment: "NO_RECOVERABLE_INPUT_VAT_WITHOUT_VERIFIED_INVOICE",
  };
  const earning = await client.distributorServiceEarning.create({
    data: {
      distributorId,
      assignmentId,
      orderId,
      serviceType: "DELIVERY",
      idempotencyKey,
      rateCardId: rateCard.rateCardId || null,
      effectiveAt,
      deliveryCharge,
      incentiveAmount,
      commissionAmount,
      otherCharges: new Prisma.Decimal(0),
      vatRate,
      vatAmount,
      vatInvoiceVerified,
      payableAmount,
      snapshot: rateSnapshot,
    },
  });

  if (payableAmount.isZero()) return earning;

  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributorId,
    displayName: distributorName,
  }, { client });
  const journal = await journalPoster({
    transactionDate: effectiveAt,
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    idempotencyKey,
    referenceNumber: `DIST-EARN-${assignmentId.slice(-8)}`,
    description: `Distributor delivery earning for order ${orderId}`,
    lines: [
      {
        mappingKey: "DELIVERY_EXPENSE",
        debit: payableAmount,
        credit: 0,
        description: `Distributor delivery service expense for order ${orderId}`,
        accountingPartyId: party.id,
      },
      {
        mappingKey: "DISTRIBUTOR_PAYABLE",
        debit: 0,
        credit: payableAmount,
        description: `Distributor service payable for order ${orderId}`,
        accountingPartyId: party.id,
      },
    ],
    client,
  });
  const document = await createAccountingDocument({
    documentType: "BILL",
    documentNumber: `DIST-EARN-${earning.id}`,
    partyId: party.id,
    side: "PAYABLE",
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    issueDate: effectiveAt,
    amount: payableAmount,
    idempotencyKey,
    notes: JSON.stringify(rateSnapshot),
  }, { client });

  const updatedEarning = await client.distributorServiceEarning.update({
    where: { id: earning.id },
    data: {
      accountingDocumentId: document.id,
      journalEntryId: journal.id,
    },
  });
  await applyOutstandingCounterSaleReversals({ distributorId, distributorName, document, client });
  return updatedEarning;
};

export const accrueDistributorServiceCharge = async ({
  distributorId,
  distributorName,
  assignmentId,
  orderId,
  sourceId,
  rateCardId = null,
  serviceType,
  chargeAmount,
  snapshotDetails = {},
  vatRate = 0,
  effectiveAt = new Date(),
  client = prisma,
  journalPoster = postJournalEntry,
} = {}) => {
  const normalizedType = String(serviceType || "").trim().toUpperCase();
  if (!["RETURN", "EXCHANGE", "NCM_TRANSFER", "COUNTER_SALE"].includes(normalizedType)) {
    throw new Error("Distributor service charge must be a RETURN, EXCHANGE, NCM_TRANSFER, or COUNTER_SALE.");
  }
  if (!distributorId || !distributorName || !assignmentId || !orderId || !sourceId) {
    throw new Error("Distributor, assignment, order, and service source details are required.");
  }
  if (!client.distributorServiceEarning) {
    throw new Error("Distributor service earning storage is unavailable. Apply the pending Prisma migration first.");
  }

  const idempotencyKey = `DISTRIBUTOR_${normalizedType}_EARNING:${sourceId}`;
  const prior = await client.distributorServiceEarning.findUnique({ where: { idempotencyKey } });
  if (prior) {
    if (prior.distributorId !== distributorId || prior.orderId !== orderId || prior.serviceType !== normalizedType) {
      throw new Error("Service earning idempotency key is already associated with a different source.");
    }
    return prior;
  }

  const serviceCharge = money(chargeAmount, `${normalizedType} service charge`);
  const normalizedVatRate = money(vatRate, "Distributor service VAT rate");
  if (normalizedVatRate.greaterThan(100)) {
    throw new Error("Distributor service VAT rate cannot exceed 100%.");
  }
  const vatAmount = serviceCharge.mul(normalizedVatRate).div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const payableAmount = serviceCharge.plus(vatAmount)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const snapshot = {
    serviceType: normalizedType,
    serviceCharge: serviceCharge.toFixed(2),
    rateCardId,
    vatRate: normalizedVatRate.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    taxTreatment: normalizedType === "NCM_TRANSFER"
      ? "NCM_TRANSFER_FEE_NO_VAT"
      : normalizedType === "COUNTER_SALE"
        ? "HUB_COUNTER_SALE_FEE_NO_VAT"
        : "RATE_CARD_SERVICE_CHARGE",
    ...snapshotDetails,
  };
  const earning = await client.distributorServiceEarning.create({
    data: {
      distributorId,
      assignmentId,
      orderId,
      serviceType: normalizedType,
      idempotencyKey,
      rateCardId,
      effectiveAt,
      deliveryCharge: new Prisma.Decimal(0),
      incentiveAmount: new Prisma.Decimal(0),
      commissionAmount: new Prisma.Decimal(0),
      otherCharges: serviceCharge,
      vatRate: normalizedVatRate,
      vatAmount,
      vatInvoiceVerified: false,
      payableAmount,
      snapshot,
    },
  });
  if (payableAmount.isZero()) return earning;

  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: distributorId,
    displayName: distributorName,
  }, { client });
  const expenseMappingKey = normalizedType === "NCM_TRANSFER"
    ? "DISTRIBUTOR_NCM_TRANSFER_EXPENSE"
    : normalizedType === "COUNTER_SALE"
      ? "DISTRIBUTOR_COUNTER_SALE_EXPENSE"
      : "DELIVERY_EXPENSE";
  const journal = await journalPoster({
    transactionDate: effectiveAt,
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    idempotencyKey,
    referenceNumber: `DIST-${normalizedType}-${String(sourceId).slice(-8)}`,
    description: `Distributor ${normalizedType.toLowerCase()} service earning for order ${orderId}`,
    createdBy: "SYSTEM",
    lines: [
      {
        mappingKey: expenseMappingKey,
        debit: payableAmount,
        credit: 0,
        description: `Distributor ${normalizedType.toLowerCase()} service expense for order ${orderId}`,
        accountingPartyId: party.id,
      },
      {
        mappingKey: "DISTRIBUTOR_PAYABLE",
        debit: 0,
        credit: payableAmount,
        description: `Distributor ${normalizedType.toLowerCase()} service payable for order ${orderId}`,
        accountingPartyId: party.id,
      },
    ],
    client,
  });
  const document = await createAccountingDocument({
    documentType: "BILL",
    documentNumber: `DIST-${normalizedType}-${earning.id}`,
    partyId: party.id,
    side: "PAYABLE",
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    issueDate: effectiveAt,
    amount: payableAmount,
    idempotencyKey,
    notes: JSON.stringify(snapshot),
  }, { client });

  const updatedEarning = await client.distributorServiceEarning.update({
    where: { id: earning.id },
    data: {
      accountingDocumentId: document.id,
      journalEntryId: journal.id,
    },
  });
  await applyOutstandingCounterSaleReversals({ distributorId, distributorName, document, client });
  return updatedEarning;
};

export const accrueDistributorCounterSaleEarning = async ({
  distributorId,
  distributorName,
  assignmentId,
  orderId,
  saleBaseAmount,
  effectiveAt = new Date(),
  client = prisma,
  rateCardResolver = resolveActiveRateCard,
  journalPoster = postJournalEntry,
} = {}) => {
  const rateCard = await rateCardResolver({ distributorId, effectiveAt, client });
  const chargeAmount = money(rateCard.counterSaleCharge ?? 0, "Hub counter sale charge");
  if (chargeAmount.isZero()) return null;
  return accrueDistributorServiceCharge({
    distributorId,
    distributorName,
    assignmentId,
    orderId,
    sourceId: orderId,
    rateCardId: rateCard.rateCardId || null,
    serviceType: "COUNTER_SALE",
    chargeAmount,
    vatRate: 0,
    effectiveAt,
    snapshotDetails: { saleBaseAmount: money(saleBaseAmount, "Hub sale merchandise amount").toFixed(2) },
    client,
    journalPoster,
  });
};

export const reverseDistributorCounterSaleEarning = async ({
  returnRecord,
  distributorName,
  effectiveAt = new Date(),
  client = prisma,
  journalPoster = postJournalEntry,
} = {}) => {
  if (!returnRecord?.id || !returnRecord.orderId || !returnRecord.distributorId) return null;
  const idempotencyKey = `DISTRIBUTOR_COUNTER_SALE_REVERSAL:${returnRecord.id}`;
  const prior = await client.distributorServiceEarning.findUnique({ where: { idempotencyKey } });
  if (prior) return prior;

  const order = await client.order.findUnique({
    where: { id: returnRecord.orderId },
    select: { id: true, orderType: true, directOrderType: true, items: true, distributorId: true },
  });
  if (
    !order ||
    order.orderType !== "DIRECT_DISTRIBUTOR" ||
    order.directOrderType !== "HUB_VISIT" ||
    order.distributorId !== returnRecord.distributorId
  ) return null;

  const originalEarning = await client.distributorServiceEarning.findUnique({
    where: { idempotencyKey: `DISTRIBUTOR_COUNTER_SALE_EARNING:${order.id}` },
  });
  if (!originalEarning) return null;
  const originalBase = new Prisma.Decimal(String(originalEarning.snapshot?.saleBaseAmount || 0));
  if (!originalBase.greaterThan(0)) return null;

  const items = Array.isArray(returnRecord.items)
    ? returnRecord.items
    : typeof returnRecord.items === "string"
      ? JSON.parse(returnRecord.items)
      : [];
  const returnedBase = items.reduce((total, item) => {
    const value = Number(item.refundAmount ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0)));
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  if (returnedBase <= 0) return null;

  const existingReversals = await client.distributorServiceEarning.findMany({
    where: { distributorId: returnRecord.distributorId, orderId: order.id, serviceType: "COUNTER_SALE_REVERSAL" },
  });
  const alreadyReversed = existingReversals.reduce(
    (total, earning) => total.plus(new Prisma.Decimal(String(earning.payableAmount)).abs()),
    new Prisma.Decimal(0),
  );
  const originalPayable = new Prisma.Decimal(String(originalEarning.payableAmount));
  const proportionalAmount = originalPayable.mul(returnedBase).div(originalBase)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const reversalAmount = Prisma.Decimal.min(proportionalAmount, Prisma.Decimal.max(new Prisma.Decimal(0), originalPayable.minus(alreadyReversed)));
  if (!reversalAmount.greaterThan(0)) return null;

  const earning = await client.distributorServiceEarning.create({
    data: {
      distributorId: returnRecord.distributorId,
      assignmentId: returnRecord.assignmentId || originalEarning.assignmentId,
      orderId: order.id,
      serviceType: "COUNTER_SALE_REVERSAL",
      idempotencyKey,
      rateCardId: originalEarning.rateCardId,
      effectiveAt,
      deliveryCharge: new Prisma.Decimal(0),
      incentiveAmount: new Prisma.Decimal(0),
      commissionAmount: new Prisma.Decimal(0),
      otherCharges: reversalAmount.negated(),
      vatRate: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
      vatInvoiceVerified: false,
      payableAmount: reversalAmount.negated(),
      appliedReversalAmount: new Prisma.Decimal(0),
      snapshot: {
        serviceType: "COUNTER_SALE_REVERSAL",
        originalEarningId: originalEarning.id,
        returnId: returnRecord.id,
        returnedMerchandiseAmount: returnedBase.toFixed(2),
        originalMerchandiseAmount: originalBase.toFixed(2),
        reversalAmount: reversalAmount.toFixed(2),
      },
    },
  });
  const party = await ensureAccountingParty({
    partyType: "DISTRIBUTOR",
    sourceEntityId: returnRecord.distributorId,
    displayName: distributorName,
  }, { client });
  const journal = await journalPoster({
    transactionDate: effectiveAt,
    sourceType: "DISTRIBUTOR_SERVICE_EARNING",
    sourceId: earning.id,
    idempotencyKey,
    referenceNumber: `DIST-COUNTER-RETURN-${String(returnRecord.id).slice(-8)}`,
    description: `Reverse hub counter sale earning for return ${returnRecord.id}`,
    lines: [
      {
        mappingKey: "DISTRIBUTOR_PAYABLE",
        debit: reversalAmount,
        credit: 0,
        description: `Reduce distributor payable for returned hub sale ${order.id}`,
        accountingPartyId: party.id,
      },
      {
        mappingKey: "DISTRIBUTOR_COUNTER_SALE_EXPENSE",
        debit: 0,
        credit: reversalAmount,
        description: `Reverse hub counter sale compensation for order ${order.id}`,
        accountingPartyId: party.id,
      },
    ],
    client,
  });
  const creditNote = await createAccountingDocument({
    documentType: "CREDIT_NOTE",
    documentNumber: `DIST-COUNTER-RETURN-${earning.id}`,
    partyId: party.id,
    side: "PAYABLE",
    sourceType: "DISTRIBUTOR_SERVICE_EARNING_REVERSAL",
    sourceId: earning.id,
    issueDate: effectiveAt,
    amount: reversalAmount,
    idempotencyKey: `${idempotencyKey}:CREDIT_NOTE`,
    notes: JSON.stringify(earning.snapshot),
  }, { client });
  const allocation = await allocatePaymentToDocuments({
    partyId: party.id,
    side: "PAYABLE",
    amount: reversalAmount,
    journalEntryId: journal.id,
    allocationType: "OFFSET",
    sourceTypes: ["DISTRIBUTOR_SERVICE_EARNING"],
    notes: `Apply hub sale return reversal for return ${returnRecord.id}.`,
    idempotencyKey: `${idempotencyKey}:OFFSET`,
  }, { client });
  if (allocation.totalAllocated.greaterThan(0)) {
    const creditNoteAllocation = await allocatePaymentToDocuments({
      partyId: party.id,
      side: "PAYABLE",
      amount: allocation.totalAllocated,
      journalEntryId: journal.id,
      allocationType: "OFFSET",
      targetDocumentIds: [creditNote.id],
      sourceTypes: ["DISTRIBUTOR_SERVICE_EARNING_REVERSAL"],
      notes: `Apply hub sale return credit note for return ${returnRecord.id}.`,
      idempotencyKey: `${idempotencyKey}:CREDIT_NOTE_OFFSET`,
    }, { client });
    if (!creditNoteAllocation.totalAllocated.equals(allocation.totalAllocated)) {
      throw new Error(`Counter-sale reversal credit note ${creditNote.id} is out of balance.`);
    }
  }
  return client.distributorServiceEarning.update({
    where: { id: earning.id },
    data: {
      journalEntryId: journal.id,
      accountingDocumentId: creditNote.id,
      appliedReversalAmount: allocation.totalAllocated,
    },
  });
};

export const accrueDistributorNcmTransferEarning = async ({
  distributorId,
  distributorName,
  assignmentId,
  orderId,
  deliveryOrderId,
  effectiveAt = new Date(),
  client = prisma,
  rateCardResolver = resolveActiveRateCard,
  accrueServiceCharge = accrueDistributorServiceCharge,
} = {}) => {
  if (!deliveryOrderId) {
    throw new Error("NCM delivery record ID is required to accrue a transfer earning.");
  }
  const rateCard = await rateCardResolver({ distributorId, effectiveAt, client });
  const chargeAmount = money(rateCard.ncmTransferCharge ?? 0, "NCM transfer charge");
  if (chargeAmount.isZero()) return null;

  return accrueServiceCharge({
    distributorId,
    distributorName,
    assignmentId,
    orderId,
    sourceId: deliveryOrderId,
    rateCardId: rateCard.rateCardId || null,
    serviceType: "NCM_TRANSFER",
    chargeAmount,
    effectiveAt,
    client,
  });
};
