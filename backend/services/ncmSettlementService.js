import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postJournalEntry,
  postNcmCarrierFeeAccrualAccounting,
  postNcmRemittanceAccounting,
} from "./accountingPostingEngine.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments, createAccountingDocument } from "./accountingSubledgerService.js";
import { getKathmanduDateRange } from "./adminDeliveryMonitoringService.js";

const fail = (message, statusCode = 400, code = "NCM_SETTLEMENT_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const normalizeIds = (settlementIds) => {
  if (!Array.isArray(settlementIds) || settlementIds.length < 1 || settlementIds.length > 100) {
    throw fail("Select between 1 and 100 NCM settlements.", 400, "INVALID_SETTLEMENT_IDS");
  }
  const ids = settlementIds.map((id) => typeof id === "string" ? id.trim() : "");
  if (ids.some((id) => !id || id.length > 191) || new Set(ids).size !== ids.length) {
    throw fail("NCM settlement IDs must be valid and unique.", 400, "INVALID_SETTLEMENT_IDS");
  }
  return ids.sort();
};

const getNcmSettlementPeriod = (startDate, endDate) =>
  getKathmanduDateRange({ range: "custom", startDate, endDate });

const getSelectedNcmSettlementRecords = async (ids, period, client) => {
  const settlements = await client.deliveryFinancialSettlement.findMany({
    where: {
      id: { in: ids },
      settlementState: { in: ["PENDING", "COD_RECEIVED", "REQUESTED"] },
      ncmSettlementBatchItem: null,
    },
  });
  if (settlements.length !== ids.length) {
    throw fail("One or more selected NCM deliveries are no longer available for settlement.", 409, "SETTLEMENTS_CHANGED");
  }
  const deliveries = await client.deliveryOrder.findMany({
    where: {
      id: { in: settlements.map(({ deliveryOrderId }) => deliveryOrderId) },
      state: "DELIVERED",
      ncmOrderId: { not: null },
      deliveredAt: { gte: period.start, lt: period.endExclusive },
    },
    select: { id: true },
  });
  if (deliveries.length !== settlements.length) {
    throw fail("Every selected settlement must belong to an NCM delivery completed in the selected period.", 409, "SETTLEMENT_PERIOD_MISMATCH");
  }
  return settlements;
};

export const validateNcmSettlementSelection = async ({
  settlementIds,
  startDate,
  endDate,
} = {}, client = prisma) => {
  const ids = normalizeIds(settlementIds);
  const period = getNcmSettlementPeriod(startDate, endDate);
  const settlements = await getSelectedNcmSettlementRecords(ids, period, client);
  return { ids, settlements, period };
};

const optionalText = (value, label, maxLength) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw fail(`${label} must be text.`, 400, "INVALID_SETTLEMENT_INPUT");
  }
  const text = String(value || "").trim();
  if (text.length > maxLength) throw fail(`${label} must be ${maxLength} characters or fewer.`, 400, "INVALID_SETTLEMENT_INPUT");
  return text || null;
};

const getSettlementCod = (settlement) =>
  Number(settlement.codCollected ?? 0) > 0
    ? settlement.codCollected
    : settlement.codExpected;

const getSettlementFee = (settlement) =>
  Number(settlement.deliveryFeeActual ?? 0) === 0 &&
  Number(settlement.deliveryFeeDiscount ?? 0) === 0 &&
  Number(settlement.deliveryFeeExpected ?? 0) > 0
    ? settlement.deliveryFeeExpected
    : settlement.deliveryFeeActual ?? settlement.deliveryFeeExpected ?? 0;

export const listNcmSettlementCandidates = async ({
  startDate,
  endDate,
  page = 1,
  limit = 25,
} = {}, client = prisma) => {
  const range = getNcmSettlementPeriod(startDate, endDate);
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  if (!Number.isSafeInteger(parsedPage) || parsedPage < 1 || !Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    throw fail("Settlement candidate page and limit are invalid.", 400, "INVALID_SETTLEMENT_FILTER");
  }
  const deliveries = await client.deliveryOrder.findMany({
    where: {
      state: "DELIVERED",
      ncmOrderId: { not: null },
      deliveredAt: { gte: range.start, lt: range.endExclusive },
    },
    select: {
      id: true,
      orderId: true,
      ncmOrderId: true,
      deliveredAt: true,
    },
    orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
  });
  if (!deliveries.length) {
    return { success: true, candidates: [], pagination: { page: parsedPage, limit: parsedLimit, total: 0, pages: 0 } };
  }
  const deliveryIds = deliveries.map(({ id }) => id);
  const settlements = await client.deliveryFinancialSettlement.findMany({
    where: {
      deliveryOrderId: { in: deliveryIds },
      settlementState: { in: ["PENDING", "COD_RECEIVED", "REQUESTED"] },
      ncmSettlementBatchItem: null,
    },
  });
  const settlementsByDeliveryId = new Map(settlements.map((settlement) => [settlement.deliveryOrderId, settlement]));
  const candidates = deliveries.flatMap((delivery) => {
    const settlement = settlementsByDeliveryId.get(delivery.id);
    if (!settlement) return [];
    const cod = Number(getSettlementCod(settlement) || 0);
    const fee = Number(getSettlementFee(settlement) || 0);
    return [{
      id: settlement.id,
      deliveryOrderId: delivery.id,
      orderId: delivery.orderId,
      ncmOrderId: delivery.ncmOrderId,
      deliveredAt: delivery.deliveredAt,
      settlementState: settlement.settlementState,
      ncmTicketId: settlement.ncmTicketId,
      codAmount: cod,
      carrierFee: fee,
      calculatedNetDeposit: Number((cod - fee).toFixed(2)),
    }];
  });
  const offset = (parsedPage - 1) * parsedLimit;
  const pageRows = candidates.slice(offset, offset + parsedLimit);
  return {
    success: true,
    candidates: pageRows,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total: candidates.length,
      pages: Math.ceil(candidates.length / parsedLimit),
    },
  };
};

export const listNcmSettlementBatches = async (client = prisma) => {
  const batches = await client.ncmSettlementBatch.findMany({
    orderBy: { settledAt: "desc" },
    take: 50,
    include: {
      _count: { select: { items: true } },
      varianceResolutions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  const batchIds = batches.map(({ id }) => id);
  const resolvedByBatch = batchIds.length
    ? await client.ncmSettlementVarianceResolution.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batchIds } },
      _sum: { amount: true },
    })
    : [];
  const resolvedAmounts = new Map(
    resolvedByBatch.map(({ batchId, _sum }) => [
      batchId,
      new Prisma.Decimal(String(_sum.amount || 0)),
    ]),
  );
  return {
    success: true,
    batches: batches.map((batch) => {
      const resolved = resolvedAmounts.get(batch.id) || new Prisma.Decimal(0);
      return {
        ...batch,
        varianceResolutions: batch.varianceResolutions.reverse(),
        resolvedVarianceAmount: resolved.toFixed(2),
        remainingVarianceAmount: Prisma.Decimal.max(
          new Prisma.Decimal(String(batch.varianceAmount)).abs().minus(resolved),
          0,
        ).toFixed(2),
      };
    }),
  };
};

export const resolveNcmSettlementVariance = async ({
  batchId,
  action,
  amount,
  financialAccountId = null,
  reference = null,
  notes,
  idempotencyKey,
  createdBy = "ADMIN",
  client = prisma,
  journalPoster = postJournalEntry,
  documentAllocator = allocatePaymentToDocuments,
  now = new Date(),
} = {}) => {
  const normalizedAction = String(action || "").trim().toUpperCase();
  if (!["COLLECT_SHORTFALL", "REFUND_OVERPAYMENT", "APPLY_OVERPAYMENT"].includes(normalizedAction)) {
    throw fail("Choose a supported NCM variance resolution action.", 400, "INVALID_VARIANCE_ACTION");
  }
  if (typeof batchId !== "string" || !batchId.trim()) {
    throw fail("NCM settlement batch is required.", 400, "INVALID_BATCH_ID");
  }
  if (typeof idempotencyKey !== "string" || !/^[\w:-]{8,150}$/.test(idempotencyKey)) {
    throw fail("A valid idempotency key is required.", 400, "INVALID_IDEMPOTENCY_KEY");
  }
  const amountText = String(amount ?? "").trim();
  if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(amountText)) {
    throw fail("Resolution amount must be positive with at most two decimal places.", 400, "INVALID_RESOLUTION_AMOUNT");
  }
  const resolutionAmount = new Prisma.Decimal(amountText);
  if (!resolutionAmount.isFinite() || !resolutionAmount.greaterThan(0)) {
    throw fail("Resolution amount must be greater than zero.", 400, "INVALID_RESOLUTION_AMOUNT");
  }
  const normalizedReference = optionalText(reference, "Resolution reference", 191);
  const resolutionNotes = optionalText(notes, "Resolution notes", 2000);
  if (!normalizedReference || !resolutionNotes) {
    throw fail("A bank/payment reference and resolution explanation are required.", 400, "RESOLUTION_EVIDENCE_REQUIRED");
  }
  if (["COLLECT_SHORTFALL", "REFUND_OVERPAYMENT"].includes(normalizedAction) &&
      (typeof financialAccountId !== "string" || !financialAccountId.trim())) {
    throw fail("Select an active NPR treasury account.", 400, "TREASURY_ACCOUNT_REQUIRED");
  }

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.ncmSettlementVarianceResolution.findUnique({
        where: { idempotencyKey },
      });
      if (replay) {
        if (replay.batchId !== batchId || replay.action !== normalizedAction ||
            !new Prisma.Decimal(String(replay.amount)).equals(resolutionAmount) ||
            replay.reference !== normalizedReference ||
            replay.financialAccountId !== (financialAccountId || null) ||
            replay.notes !== resolutionNotes) {
          throw fail("This resolution key was already used with different details.", 409, "RESOLUTION_IDEMPOTENCY_CONFLICT");
        }
        return { success: true, resolution: replay, alreadyProcessed: true };
      }

      const batch = await tx.ncmSettlementBatch.findUnique({ where: { id: batchId } });
      if (!batch || new Prisma.Decimal(String(batch.varianceAmount)).isZero()) {
        throw fail("This NCM batch has no open variance to resolve.", 409, "NO_OPEN_VARIANCE");
      }
      const variance = new Prisma.Decimal(String(batch.varianceAmount));
      const isShortfall = variance.isNegative();
      const actionMatchesVariance = isShortfall
        ? normalizedAction === "COLLECT_SHORTFALL"
        : ["REFUND_OVERPAYMENT", "APPLY_OVERPAYMENT"].includes(normalizedAction);
      if (!actionMatchesVariance) {
        throw fail("The selected action does not match the direction of this NCM variance.", 409, "VARIANCE_ACTION_MISMATCH");
      }

      const prior = await tx.ncmSettlementVarianceResolution.aggregate({
        where: { batchId },
        _sum: { amount: true },
      });
      const amountAlreadyResolved = new Prisma.Decimal(String(prior._sum.amount || 0));
      const varianceRemaining = variance.abs().minus(amountAlreadyResolved);
      if (!varianceRemaining.greaterThan(0) || resolutionAmount.greaterThan(varianceRemaining)) {
        throw fail(`Resolution amount exceeds the remaining NCM variance of NPR ${Prisma.Decimal.max(varianceRemaining, 0).toFixed(2)}.`, 409, "RESOLUTION_EXCEEDS_VARIANCE");
      }

      const ncmParty = await tx.accountingParty.findUnique({
        where: { partyType_sourceEntityId: { partyType: "CARRIER", sourceEntityId: "NCM" } },
      });
      if (!ncmParty) throw fail("NCM accounting party is missing; reconcile accounting setup first.", 409, "NCM_PARTY_MISSING");

      let sourceDocument = null;
      let targetDocumentId = null;
      if (isShortfall) {
        const batchItems = await tx.ncmSettlementBatchItem.findMany({
          where: { batchId },
          select: { settlementId: true },
        });
        const settlements = await tx.deliveryFinancialSettlement.findMany({
          where: { id: { in: batchItems.map(({ settlementId }) => settlementId) } },
          select: { deliveryOrderId: true },
        });
        const deliveryOrders = await tx.deliveryOrder.findMany({
          where: { id: { in: settlements.map(({ deliveryOrderId }) => deliveryOrderId) } },
          select: { orderId: true },
        });
        const receivables = await tx.accountingDocument.findMany({
          where: {
            partyId: ncmParty.id,
            side: "RECEIVABLE",
            sourceType: "NCM_COD_SALE",
            sourceId: { in: deliveryOrders.map(({ orderId }) => orderId) },
            status: { in: ["OPEN", "PARTIALLY_PAID"] },
          },
        });
        const openBalance = receivables.reduce(
          (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
          new Prisma.Decimal(0),
        );
        if (resolutionAmount.greaterThan(openBalance)) {
          throw fail(`Collection exceeds the remaining NCM COD receivable of NPR ${openBalance.toFixed(2)}.`, 409, "COLLECTION_EXCEEDS_RECEIVABLE");
        }
      } else {
        const batchHash = batch.idempotencyKey.replace(/^NCM_COD_BATCH:/, "");
        sourceDocument = await tx.accountingDocument.findUnique({
          where: { idempotencyKey: `NCM_REMITTANCE_VARIANCE:${batchHash}` },
        });
        if (!sourceDocument || sourceDocument.side !== "PAYABLE" ||
            !["OPEN", "PARTIALLY_PAID"].includes(sourceDocument.status) ||
            resolutionAmount.greaterThan(new Prisma.Decimal(String(sourceDocument.remainingAmount)))) {
          throw fail("Overpayment suspense balance is missing or smaller than the requested resolution.", 409, "SUSPENSE_BALANCE_INSUFFICIENT");
        }
      }

      const needsCashAccount = normalizedAction !== "APPLY_OVERPAYMENT";
      const account = needsCashAccount
        ? await tx.financialAccount.findUnique({
          where: { id: financialAccountId },
          include: { accountingAccount: { select: { id: true, accountCode: true, accountType: true, normalBalance: true } } },
        })
        : null;
      if (needsCashAccount && (
        !account ||
        account.status !== "ACTIVE" ||
        account.currency !== "NPR" ||
        !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase()) ||
        !account.accountingAccount ||
        account.accountingAccount.accountType !== "ASSET" ||
        account.accountingAccount.normalBalance !== "DEBIT"
      )) {
        throw fail("Select an active NPR cash, bank, or wallet account mapped to a debit-balance asset.", 409, "INVALID_TREASURY_ACCOUNT");
      }
      if (normalizedAction === "REFUND_OVERPAYMENT" &&
          new Prisma.Decimal(String(account.currentBalance))
            .minus(new Prisma.Decimal(String(account.reservedBalance || 0)))
            .lessThan(resolutionAmount)) {
        throw fail("The selected treasury account does not have enough unreserved balance for this NCM refund.", 409, "INSUFFICIENT_TREASURY_BALANCE");
      }

      const amountFixed = resolutionAmount.toFixed(2);
      const isCollection = normalizedAction === "COLLECT_SHORTFALL";
      const isRefund = normalizedAction === "REFUND_OVERPAYMENT";
      const sourceId = `NCM_VARIANCE:${batch.id}`;
      const lines = isCollection
        ? [
          { accountCode: account.accountingAccount.accountCode, debit: resolutionAmount, credit: 0 },
          { accountCode: "1170", debit: 0, credit: resolutionAmount, accountingPartyId: ncmParty.id },
        ]
        : isRefund
          ? [
            { accountCode: "2185", debit: resolutionAmount, credit: 0, accountingPartyId: ncmParty.id },
            { accountCode: account.accountingAccount.accountCode, debit: 0, credit: resolutionAmount },
          ]
          : [
            { accountCode: "2185", debit: resolutionAmount, credit: 0, accountingPartyId: ncmParty.id },
            { accountCode: "1170", debit: 0, credit: resolutionAmount, accountingPartyId: ncmParty.id },
          ];
      const journal = await journalPoster({
        transactionDate: now,
        sourceType: "NCM_VARIANCE_RESOLUTION",
        sourceId,
        idempotencyKey,
        referenceNumber: normalizedReference,
        description: `${normalizedAction.replace(/_/g, " ")} for NCM settlement batch ${batch.id}: ${resolutionNotes}`,
        lines,
        createdBy,
        client: tx,
      });
      if (!journal?.id) throw fail("NCM variance resolution journal could not be posted.", 500, "NCM_ACCOUNTING_FAILED");

      if (isShortfall) {
        const batchItems = await tx.ncmSettlementBatchItem.findMany({
          where: { batchId },
          select: { settlementId: true },
        });
        const settlements = await tx.deliveryFinancialSettlement.findMany({
          where: { id: { in: batchItems.map(({ settlementId }) => settlementId) } },
          select: { deliveryOrderId: true },
        });
        const deliveryOrders = await tx.deliveryOrder.findMany({
          where: { id: { in: settlements.map(({ deliveryOrderId }) => deliveryOrderId) } },
          select: { orderId: true },
        });
        const receivables = await tx.accountingDocument.findMany({
          where: {
            partyId: ncmParty.id,
            side: "RECEIVABLE",
            sourceType: "NCM_COD_SALE",
            sourceId: { in: deliveryOrders.map(({ orderId }) => orderId) },
            status: { in: ["OPEN", "PARTIALLY_PAID"] },
          },
          select: { id: true },
        });
        const allocation = await documentAllocator({
          partyId: ncmParty.id,
          side: "RECEIVABLE",
          amount: resolutionAmount,
          journalEntryId: journal.id,
          targetDocumentIds: receivables.map(({ id }) => id),
          sourceTypes: ["NCM_COD_SALE"],
          idempotencyKey: `${idempotencyKey}:COLLECT`,
          notes: `Collect NCM shortfall for batch ${batch.id}. ${resolutionNotes}`,
        }, { client: tx });
        if (!new Prisma.Decimal(String(allocation.unallocatedAmount)).isZero()) {
          throw fail("NCM shortfall collection could not be fully allocated to its COD receivables.", 409, "COLLECTION_ALLOCATION_INCOMPLETE");
        }
      } else {
        const suspenseAllocation = await documentAllocator({
          partyId: ncmParty.id,
          side: "PAYABLE",
          amount: resolutionAmount,
          journalEntryId: journal.id,
          allocationType: isRefund ? "CASH" : "OFFSET",
          targetDocumentIds: [sourceDocument.id],
          sourceTypes: ["NCM_REMITTANCE_VARIANCE"],
          idempotencyKey: `${idempotencyKey}:SUSPENSE`,
          notes: `${normalizedAction} of NCM overpayment for batch ${batch.id}. ${resolutionNotes}`,
        }, { client: tx });
        if (!new Prisma.Decimal(String(suspenseAllocation.unallocatedAmount)).isZero()) {
          throw fail("NCM overpayment could not be fully applied to its suspense document.", 409, "SUSPENSE_ALLOCATION_INCOMPLETE");
        }
        if (!isRefund) {
          const allocation = await documentAllocator({
            partyId: ncmParty.id,
            side: "RECEIVABLE",
            amount: resolutionAmount,
            journalEntryId: journal.id,
            allocationType: "OFFSET",
            sourceTypes: ["NCM_COD_SALE"],
            idempotencyKey: `${idempotencyKey}:COD`,
            notes: `Apply NCM overpayment from batch ${batch.id} to open COD receivables. ${resolutionNotes}`,
          }, { client: tx });
          if (!new Prisma.Decimal(String(allocation.unallocatedAmount)).isZero()) {
            throw fail("NCM overpayment cannot be applied because eligible COD receivables are insufficient.", 409, "COD_OFFSET_ALLOCATION_INCOMPLETE");
          }
          targetDocumentId = allocation.allocations?.[0]?.documentId || null;
        }
      }

      let cashTransaction = null;
      if (needsCashAccount) {
        const balanceDelta = isCollection ? resolutionAmount : resolutionAmount.negated();
        const balanceUpdate = await tx.financialAccount.updateMany({
          where: { id: account.id, status: "ACTIVE", currency: "NPR" },
          data: { currentBalance: { increment: balanceDelta.toNumber() } },
        });
        if (balanceUpdate.count !== 1) throw fail("Treasury account changed during resolution.", 409, "TREASURY_ACCOUNT_CONFLICT");
        cashTransaction = await tx.cashTransaction.create({
          data: {
            idempotencyKey,
            amount: resolutionAmount.toNumber(),
            type: isCollection ? "INFLOW" : "OUTFLOW",
            ...(isCollection ? { toAccountId: account.id } : { fromAccountId: account.id }),
            category: isCollection ? "COD_REMITTANCE" : "REFUND",
            partyName: "Nepal Can Move (NCM)",
            invoiceNumber: normalizedReference,
            referenceId: sourceId,
            description: `${normalizedAction.replace(/_/g, " ")} for NCM settlement batch ${batch.id}. ${resolutionNotes}`,
            date: now,
          },
        });
      }

      const resolution = await tx.ncmSettlementVarianceResolution.create({
        data: {
          batchId,
          action: normalizedAction,
          amount: resolutionAmount,
          sourceDocumentId: sourceDocument?.id || null,
          targetDocumentId,
          financialAccountId: account?.id || null,
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction?.id || null,
          idempotencyKey,
          reference: normalizedReference,
          notes: resolutionNotes,
          createdBy,
        },
      });
      const totalResolved = amountAlreadyResolved.plus(resolutionAmount);
      const newStatus = totalResolved.greaterThanOrEqualTo(variance.abs())
        ? "VARIANCE_RESOLVED"
        : "VARIANCE_PARTIALLY_RESOLVED";
      const batchUpdate = await tx.ncmSettlementBatch.updateMany({
        where: { id: batchId, status: { in: ["VARIANCE_OPEN", "VARIANCE_PARTIALLY_RESOLVED"] } },
        data: { status: newStatus },
      });
      if (batchUpdate.count !== 1) {
        throw fail("NCM batch status changed while recording the resolution.", 409, "RESOLUTION_CONCURRENCY_CONFLICT");
      }
      return {
        success: true,
        resolution,
        remainingVarianceAmount: Prisma.Decimal.max(variance.abs().minus(totalResolved), 0).toFixed(2),
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("NCM variance changed concurrently. Refresh the batch and retry.", 409, "RESOLUTION_CONCURRENCY_CONFLICT");
    }
    if (error?.code === "P2002") {
      const replay = await client.ncmSettlementVarianceResolution.findUnique({ where: { idempotencyKey } });
      if (replay &&
          replay.batchId === batchId &&
          replay.action === normalizedAction &&
          new Prisma.Decimal(String(replay.amount)).equals(resolutionAmount) &&
          replay.reference === normalizedReference &&
          replay.financialAccountId === (financialAccountId || null) &&
          replay.notes === resolutionNotes) {
        return { success: true, resolution: replay, alreadyProcessed: true };
      }
    }
    throw error;
  }
};

export const confirmNcmSettlementBatch = async ({
  settlementIds,
  financialAccountId,
  reference = null,
  notes = null,
  expectedNetDeposit = null,
  actualNetDeposit = null,
  varianceType = null,
  varianceReason = null,
  periodStart = null,
  periodEnd = null,
  ncmTicketId = null,
  createdBy = "ADMIN",
  client = prisma,
  settlementPoster = postNcmRemittanceAccounting,
  carrierFeeAccrualPoster = postNcmCarrierFeeAccrualAccounting,
  partyResolver = ensureAccountingParty,
  documentCreator = createAccountingDocument,
  documentAllocator = allocatePaymentToDocuments,
  now = new Date(),
} = {}) => {
  const ids = normalizeIds(settlementIds);
  if (typeof financialAccountId !== "string" || !financialAccountId.trim()) {
    throw fail("Select an active NPR treasury account.", 400, "TREASURY_ACCOUNT_REQUIRED");
  }
  const receiptReference = optionalText(reference, "Bank reference", 191);
  const settlementNotes = optionalText(notes, "Settlement notes", 2000);
  const expectedDepositText = expectedNetDeposit == null ? null : String(expectedNetDeposit).trim();
  if (expectedDepositText !== null && !/^\d{1,18}(?:\.\d{1,2})?$/.test(expectedDepositText)) {
    throw fail("Expected net deposit must be a positive amount with at most two decimal places.", 400, "INVALID_NET_DEPOSIT");
  }
  const expectedDeposit = expectedDepositText === null
    ? null
    : new Prisma.Decimal(expectedDepositText).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (expectedDeposit && !expectedDeposit.greaterThan(0)) {
    throw fail("Expected net deposit must be a positive amount.", 400, "INVALID_NET_DEPOSIT");
  }
  const batchHash = crypto.createHash("sha256").update(ids.join("|")).digest("hex");
  const batchKey = `NCM_COD_BATCH:${batchHash}`;
  const varianceCategory = optionalText(varianceType, "Variance type", 40);
  const varianceDescription = optionalText(varianceReason, "Variance explanation", 2000);
  if (
    varianceCategory &&
    !["DISCOUNT_OR_PROMOTION", "PENALTY_OR_FINE", "OTHER"].includes(varianceCategory)
  ) {
    throw fail("Select a supported NCM variance type.", 400, "INVALID_VARIANCE_TYPE");
  }
  if (ncmTicketId != null && (!Number.isSafeInteger(ncmTicketId) || ncmTicketId < 1)) {
    throw fail("NCM ticket ID must be a positive whole number.", 400, "INVALID_NCM_TICKET_ID");
  }
  let selectionPeriod = null;
  if (periodStart != null || periodEnd != null) {
    if (periodStart == null || periodEnd == null) {
      throw fail("Both settlement period dates are required.", 400, "INVALID_SETTLEMENT_PERIOD");
    }
    selectionPeriod = getNcmSettlementPeriod(periodStart, periodEnd);
  }
  const periodStartDate = selectionPeriod?.start || null;
  const periodEndDate = selectionPeriod
    ? new Date(selectionPeriod.endExclusive.getTime() - 1)
    : null;

  try {
    return await client.$transaction(async (tx) => {
      const replay = await tx.cashTransaction.findUnique({ where: { idempotencyKey: batchKey } });
      if (replay) {
        if (
          replay.toAccountId !== financialAccountId ||
          replay.referenceId !== batchKey ||
          (actualNetDeposit != null && Number(replay.amount) !== Number(actualNetDeposit))
        ) {
          throw fail("These NCM settlements were already processed with different treasury details.", 409, "NCM_SETTLEMENT_ALREADY_PROCESSED");
        }
        return { success: true, transactionId: replay.id, netDeposit: replay.amount, alreadyProcessed: true };
      }

      const account = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
        include: { accountingAccount: { select: { id: true, accountCode: true, accountType: true, normalBalance: true } } },
      });
      if (
        !account ||
        account.status !== "ACTIVE" ||
        account.currency !== "NPR" ||
        !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase()) ||
        !account.accountingAccount ||
        account.accountingAccount.accountType !== "ASSET" ||
        account.accountingAccount.normalBalance !== "DEBIT"
      ) {
        throw fail("Select an active NPR cash, bank, or wallet account mapped to a debit-balance asset.", 409, "INVALID_TREASURY_ACCOUNT");
      }

      const settlements = await tx.deliveryFinancialSettlement.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
      });
      if (settlements.length !== ids.length) {
        throw fail("One or more selected NCM settlements no longer exist. Refresh and retry.", 409, "SETTLEMENTS_CHANGED");
      }
      if (settlements.some((settlement) => !["PENDING", "COD_RECEIVED", "REQUESTED"].includes(settlement.settlementState))) {
        throw fail("One or more selected NCM settlements are not open for remittance.", 409, "SETTLEMENTS_NOT_OPEN");
      }
      if (selectionPeriod) {
        await getSelectedNcmSettlementRecords(ids, selectionPeriod, tx);
      }
      let totalCod = new Prisma.Decimal(0);
      let totalFee = new Prisma.Decimal(0);
      for (const settlement of settlements) {
        const cod = new Prisma.Decimal(String(getSettlementCod(settlement) || 0));
        const fee = new Prisma.Decimal(String(getSettlementFee(settlement) || 0));
        if (!cod.isFinite() || !fee.isFinite() || cod.lessThanOrEqualTo(0) || fee.isNegative()) {
          throw fail("A selected NCM settlement has invalid COD or carrier-fee values.", 409, "INVALID_SETTLEMENT_AMOUNT");
        }
        totalCod = totalCod.plus(cod);
        totalFee = totalFee.plus(fee);
      }
      const expectedNet = totalCod.minus(totalFee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!expectedNet.greaterThan(0)) {
        throw fail("Net remittance must be positive. Reconcile carrier charges separately before closing these settlements.", 409, "NON_POSITIVE_NET_REMITTANCE");
      }
      const actualDepositText = actualNetDeposit == null ? null : String(actualNetDeposit).trim();
      if (actualDepositText !== null && !/^\d{1,18}(?:\.\d{1,2})?$/.test(actualDepositText)) {
        throw fail("Actual NCM deposit must be a non-negative amount with at most two decimal places.", 400, "INVALID_NET_DEPOSIT");
      }
      const actualDeposit = actualDepositText === null
        ? expectedNet
        : new Prisma.Decimal(actualDepositText).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!actualDeposit.isFinite() || actualDeposit.isNegative()) {
        throw fail("Actual NCM deposit must be a non-negative amount.", 400, "INVALID_NET_DEPOSIT");
      }
      if (actualDeposit.isZero()) {
        throw fail("Actual NCM deposit must be greater than zero to close a remittance batch.", 400, "INVALID_NET_DEPOSIT");
      }
      if (expectedDeposit && !expectedDeposit.equals(actualDeposit)) {
        throw fail(`Receipt must match the reconciled net remittance of NPR ${expectedNet.toFixed(2)}.`, 409, "NET_REMITTANCE_MISMATCH");
      }
      const varianceAmount = actualDeposit.minus(expectedNet).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (!varianceAmount.isZero() && (!varianceCategory || !varianceDescription)) {
        throw fail("Select a variance type and explain the NCM amount difference.", 400, "VARIANCE_EXPLANATION_REQUIRED");
      }

      const ncmParty = await partyResolver({
        partyType: "CARRIER",
        sourceEntityId: "NCM",
        displayName: "Nepal Can Move (NCM)",
      }, { client: tx });
      const deliveryOrders = await tx.deliveryOrder.findMany({
        where: { id: { in: settlements.map(({ deliveryOrderId }) => deliveryOrderId) } },
        select: { id: true, orderId: true },
      });
      if (deliveryOrders.length !== settlements.length) {
        throw fail("One or more NCM delivery orders are missing; reconcile them before remittance.", 409, "NCM_DELIVERY_LINK_MISSING");
      }
      const orderIds = deliveryOrders.map(({ orderId }) => orderId);
      const receivableDocuments = await tx.accountingDocument.findMany({
        where: {
          partyId: ncmParty.id,
          side: "RECEIVABLE",
          sourceType: "NCM_COD_SALE",
          sourceId: { in: orderIds },
          status: { in: ["OPEN", "PARTIALLY_PAID"] },
        },
      });
      const openNcmCod = receivableDocuments.reduce(
        (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
        new Prisma.Decimal(0),
      );
      if (openNcmCod.lessThan(totalCod)) {
        throw fail("NCM COD sale documents are missing or already allocated. Reconcile delivery accounting before settlement.", 409, "NCM_COD_SUBLEDGER_MISMATCH");
      }

      const settledAt = now;
      for (const settlement of settlements) {
        const claim = await tx.deliveryFinancialSettlement.updateMany({
          where: {
            id: settlement.id,
            settlementState: settlement.settlementState,
          },
          data: {
            settlementState: "SETTLED",
            settledAt,
            codCollected: Number(getSettlementCod(settlement) || 0),
          },
        });
        if (claim.count !== 1) {
          throw fail("An NCM settlement changed while processing. Refresh and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
        }
      }

      let carrierFeeDocument = null;
      if (totalFee.greaterThan(0)) {
        const feeJournal = await carrierFeeAccrualPoster({
          settlementId: batchHash,
          feeAmount: totalFee.toFixed(2),
          ncmPartyId: ncmParty.id,
          createdBy,
        }, { client: tx });
        if (!feeJournal?.id) {
          throw fail("NCM carrier fee accrual journal could not be posted.", 500, "NCM_FEE_ACCOUNTING_FAILED");
        }
        carrierFeeDocument = await documentCreator({
          documentType: "BILL",
          documentNumber: `NCM-FEE-${batchHash.slice(0, 24)}`,
          partyId: ncmParty.id,
          side: "PAYABLE",
          sourceType: "NCM_CARRIER_FEE",
          sourceId: batchHash,
          issueDate: settledAt,
          amount: totalFee,
          idempotencyKey: `NCM_CARRIER_FEE:${batchHash}`,
          notes: `NCM fee deducted from COD remittance; accrual journal ${feeJournal.id}.`,
        }, { client: tx });
      }

      const journal = await settlementPoster({
        settlementId: batchHash,
        codCollected: totalCod.toFixed(2),
        deliveryFeeActual: totalFee.toFixed(2),
        actualNetDeposit: actualDeposit.toFixed(2),
        cashAccountCode: account.accountingAccount.accountCode,
        destinationAccountName: account.accountName,
        createdBy,
        ncmPartyId: ncmParty.id,
      }, { client: tx });
      if (!journal?.id) throw fail("NCM remittance journal could not be posted.", 500, "NCM_ACCOUNTING_FAILED");

      const receivableAllocationAmount = varianceAmount.isNegative()
        ? totalCod.plus(varianceAmount)
        : totalCod;
      const receivableAllocation = await documentAllocator({
        partyId: ncmParty.id,
        side: "RECEIVABLE",
        amount: receivableAllocationAmount,
        journalEntryId: journal.id,
        targetDocumentIds: receivableDocuments.map(({ id }) => id),
        sourceTypes: ["NCM_COD_SALE"],
        idempotencyKey: `${batchKey}:COD`,
        notes: `NCM remittance batch ${batchHash}`,
      }, { client: tx });
      if (new Prisma.Decimal(String(receivableAllocation.unallocatedAmount)).greaterThan(0)) {
        throw fail("NCM remittance could not be fully allocated to delivered COD invoices.", 409, "NCM_COD_ALLOCATION_INCOMPLETE");
      }
      if (carrierFeeDocument) {
        const feeAllocation = await documentAllocator({
          partyId: ncmParty.id,
          side: "PAYABLE",
          amount: totalFee,
          journalEntryId: journal.id,
          targetDocumentIds: [carrierFeeDocument.id],
          sourceTypes: ["NCM_CARRIER_FEE"],
          idempotencyKey: `${batchKey}:FEE`,
          notes: `NCM carrier fee netted against remittance ${batchHash}`,
        }, { client: tx });
        if (new Prisma.Decimal(String(feeAllocation.unallocatedAmount)).greaterThan(0)) {
          throw fail("NCM carrier fee could not be fully allocated to its payable document.", 409, "NCM_FEE_ALLOCATION_INCOMPLETE");
        }
      }

      if (varianceAmount.greaterThan(0)) {
        await documentCreator({
          documentType: "BILL",
          documentNumber: `NCM-VAR-${batchHash.slice(0, 24)}`,
          partyId: ncmParty.id,
          side: "PAYABLE",
          sourceType: "NCM_REMITTANCE_VARIANCE",
          sourceId: batchHash,
          issueDate: settledAt,
          amount: varianceAmount,
          idempotencyKey: `NCM_REMITTANCE_VARIANCE:${batchHash}`,
          notes: `NCM remittance overpayment held in suspense. ${varianceDescription}`,
        }, { client: tx });
      }

      const journalLink = await tx.deliveryFinancialSettlement.updateMany({
        where: { id: { in: ids }, settlementState: "SETTLED", journalEntryId: null },
        data: { journalEntryId: journal.id },
      });
      if (journalLink.count !== settlements.length) {
        throw fail("NCM settlement journal could not be linked to every order.", 409, "SETTLEMENT_JOURNAL_LINK_FAILED");
      }

      const balanceUpdate = await tx.financialAccount.updateMany({
        where: { id: account.id, status: "ACTIVE", currency: "NPR" },
        data: { currentBalance: { increment: actualDeposit.toNumber() } },
      });
      if (balanceUpdate.count !== 1) {
        throw fail("Treasury account changed while posting the remittance.", 409, "TREASURY_ACCOUNT_CONFLICT");
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: batchKey,
          amount: actualDeposit.toNumber(),
          type: "INFLOW",
          toAccountId: account.id,
          category: "COD_REMITTANCE",
          partyName: "Nepal Can Move (NCM)",
          invoiceNumber: receiptReference || "",
          referenceId: batchKey,
          description: `NCM remittance: received NPR ${actualDeposit.toFixed(2)}; expected NPR ${expectedNet.toFixed(2)}${varianceDescription ? `; variance ${varianceAmount.toFixed(2)} (${varianceDescription})` : ""}${settlementNotes ? ` - ${settlementNotes}` : ""}`,
          date: settledAt,
        },
      });

      const batch = await tx.ncmSettlementBatch.create({
        data: {
          idempotencyKey: batchKey,
          periodStart: periodStartDate,
          periodEnd: periodEndDate,
          status: varianceAmount.isZero() ? "SETTLED" : "VARIANCE_OPEN",
          ncmTicketId,
          totalCod: totalCod.toFixed(2),
          totalCarrierFee: totalFee.toFixed(2),
          expectedNetDeposit: expectedNet.toFixed(2),
          actualNetDeposit: actualDeposit.toFixed(2),
          varianceAmount: varianceAmount.toFixed(2),
          varianceType: varianceCategory,
          varianceReason: varianceDescription,
          reference: receiptReference,
          notes: settlementNotes,
          financialAccountId: account.id,
          journalEntryId: journal.id,
          cashTransactionId: cashTransaction.id,
          createdBy,
          settledAt,
          items: {
            create: settlements.map(({ id }) => ({ settlementId: id })),
          },
        },
      });

      return {
        success: true,
        alreadyProcessed: false,
        transactionId: cashTransaction.id,
        journalEntryId: journal.id,
        batchId: batch.id,
        netDeposit: actualDeposit.toFixed(2),
        expectedNetDeposit: expectedNet.toFixed(2),
        varianceAmount: varianceAmount.toFixed(2),
        totalCod: totalCod.toFixed(2),
        totalFee: totalFee.toFixed(2),
        settledCount: settlements.length,
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("NCM settlement changed concurrently. Refresh the reconciliation list and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
    }
    if (error?.code === "P2002") {
      const replay = await client.cashTransaction.findUnique({ where: { idempotencyKey: batchKey } });
      if (replay && replay.toAccountId === financialAccountId && replay.referenceId === batchKey) {
        return { success: true, transactionId: replay.id, netDeposit: replay.amount, alreadyProcessed: true };
      }
    }
    throw error;
  }
};
