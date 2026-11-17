import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postJournalEntry,
  postNcmCarrierFeeAccrualAccounting,
  postNcmRemittanceAccounting,
  reverseSettlementJournalEntry,
} from "./accountingPostingEngine.js";
import { recordSystemAudit } from "./auditService.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments, createAccountingDocument } from "./accountingSubledgerService.js";
import { getKathmanduDateRange } from "./adminDeliveryMonitoringService.js";
import { requireExternalPaymentReference } from "../utils/externalPaymentReference.js";
import {
  accountingDecimal,
  addDecimals,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";

const fail = (message, statusCode = 400, code = "NCM_SETTLEMENT_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const runSerializable = (client, callback) =>
  typeof client.$transaction === "function"
    ? client.$transaction(callback, { isolationLevel: "Serializable" })
    : callback(client);

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
      ncmSettlementBatchItems: { none: { batch: { status: { not: "REVERSED" } } } },
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

const getSettlementCod = (settlement) => {
  const collected = accountingDecimal(String(settlement.codCollected ?? 0));
  return collected.greaterThan(0)
    ? collected
    : accountingDecimal(String(settlement.codExpected ?? 0));
};

const getSettlementFee = (settlement) => {
  const actual = accountingDecimal(String(settlement.deliveryFeeActual ?? 0));
  const discount = accountingDecimal(String(settlement.deliveryFeeDiscount ?? 0));
  const expected = accountingDecimal(String(settlement.deliveryFeeExpected ?? 0));
  return actual.isZero() && discount.isZero() && expected.greaterThan(0) ? expected : actual;
};

export const summarizeNcmSettlementTotals = ({
  settlements = [],
  deliveries = [],
  batches = [],
} = {}) => {
  const sumField = (rows, field) => rows.reduce(
    (total, row) => addDecimals(
      total,
      quantizeNprAmount(accountingDecimal(String(row[field] ?? 0))),
    ),
    accountingDecimal("0"),
  );
  const totalDeliveryChargeExpected = quantizeNprAmount(sumField(deliveries, "customerDeliveryCharge"));
  const totalCarrierFees = quantizeNprAmount(sumField(settlements, "deliveryFeeActual"));
  const totalCarrierDiscounts = quantizeNprAmount(sumField(settlements, "deliveryFeeDiscount"));
  const totalDeliveryChargePaid = quantizeNprAmount(sumField(
    settlements.filter((item) => item.settlementState === "SETTLED"),
    "deliveryFeeActual",
  ));
  const codExpected = quantizeNprAmount(sumField(settlements, "codExpected"));
  const codReportedCollected = quantizeNprAmount(sumField(settlements, "codCollected"));
  const codSettledGross = quantizeNprAmount(sumField(batches, "totalCod"));
  const pendingSettlements = settlements.filter((item) =>
    ["PENDING", "COD_RECEIVED", "REQUESTED"].includes(item.settlementState)
  );
  const codOpenExpected = quantizeNprAmount(sumField(pendingSettlements, "codExpected"));
  const carrierFeeOutstanding = subtractDecimals(totalCarrierFees, totalDeliveryChargePaid);
  const legacyCodOutstanding = subtractDecimals(codExpected, codReportedCollected);
  const codSettledGrossText = codSettledGross.toFixed(2);
  return {
    totalDeliveryChargeExpected: totalDeliveryChargeExpected.toFixed(2),
    totalCarrierDiscounts: totalCarrierDiscounts.toFixed(2),
    totalDeliveryChargePaid: totalDeliveryChargePaid.toFixed(2),
    deliveryChargeToPay: quantizeNprAmount(
      carrierFeeOutstanding.greaterThan(0) ? carrierFeeOutstanding : accountingDecimal("0"),
    ).toFixed(2),
    codExpected: codExpected.toFixed(2),
    codSettledGross: codSettledGrossText,
    codOpenExpected: codOpenExpected.toFixed(2),
    codReceived: codReportedCollected.toFixed(2),
    codToReceive: quantizeNprAmount(
      legacyCodOutstanding.greaterThan(0) ? legacyCodOutstanding : accountingDecimal("0"),
    ).toFixed(2),
    pendingSettlements: pendingSettlements.length,
    settledCount: settlements.filter((item) => item.settlementState === "SETTLED").length,
  };
};

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
      ncmSettlementBatchItems: { none: { batch: { status: { not: "REVERSED" } } } },
    },
  });
  const settlementsByDeliveryId = new Map(settlements.map((settlement) => [settlement.deliveryOrderId, settlement]));
  const candidates = deliveries.flatMap((delivery) => {
    const settlement = settlementsByDeliveryId.get(delivery.id);
    if (!settlement) return [];
    const cod = quantizeNprAmount(getSettlementCod(settlement));
    const fee = quantizeNprAmount(getSettlementFee(settlement));
    return [{
      id: settlement.id,
      deliveryOrderId: delivery.id,
      orderId: delivery.orderId,
      ncmOrderId: delivery.ncmOrderId,
      deliveredAt: delivery.deliveredAt,
      settlementState: settlement.settlementState,
      ncmTicketId: settlement.ncmTicketId,
      codAmount: cod.toFixed(2),
      carrierFee: fee.toFixed(2),
      calculatedNetDeposit: quantizeNprAmount(subtractDecimals(cod, fee)).toFixed(2),
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
      where: { batchId: { in: batchIds }, reversedAt: null },
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
        remainingVarianceAmount: batch.status === "REVERSED" ? "0.00" : Prisma.Decimal.max(
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
    return await runSerializable(client, async (tx) => {
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
      if (!["VARIANCE_OPEN", "VARIANCE_PARTIALLY_RESOLVED"].includes(batch.status)) {
        throw fail("This NCM batch is not open for variance resolution.", 409, "NCM_BATCH_NOT_OPEN");
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
        where: { batchId, reversedAt: null },
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
          data: { currentBalance: { increment: balanceDelta.toFixed(2) } },
        });
        if (balanceUpdate.count !== 1) throw fail("Treasury account changed during resolution.", 409, "TREASURY_ACCOUNT_CONFLICT");
        cashTransaction = await tx.cashTransaction.create({
          data: {
            idempotencyKey,
            amount: resolutionAmount.toFixed(2),
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
    });
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

export const correctNcmSettlementBatch = async ({
  batchId,
  correctionMode,
  correctionReason,
  evidenceReference,
  cashTransactionId = null,
  actorAccountId,
  actorEmail,
  actorContext = {},
  client = prisma,
  reverseJournal = reverseSettlementJournalEntry,
  writeAudit = recordSystemAudit,
  now = new Date(),
} = {}) => {
  if (typeof batchId !== "string" || !batchId.trim()) {
    throw fail("NCM settlement batch is required.", 400, "INVALID_BATCH_ID");
  }
  if (!["VOID_NOT_EXECUTED", "RETURNED_FUNDS"].includes(correctionMode)) {
    throw fail("Choose whether the NCM transfer was not executed or the funds were returned.", 400, "SETTLEMENT_CORRECTION_MODE_REQUIRED");
  }
  const reason = typeof correctionReason === "string" ? correctionReason.trim() : "";
  if (reason.length < 3) {
    throw fail("A correction reason of at least three characters is required.", 400, "SETTLEMENT_CORRECTION_REASON_REQUIRED");
  }
  const proofReference = requireExternalPaymentReference(evidenceReference);
  if (!actorAccountId) {
    throw fail("An authenticated Admin account is required to correct an NCM settlement.", 401, "SETTLEMENT_CORRECTION_ACTOR_REQUIRED");
  }

  const execute = async (tx) => {
    let batch = await tx.ncmSettlementBatch.findUnique({
      where: { id: batchId },
      include: {
        items: { include: { settlement: true } },
        varianceResolutions: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!batch) {
      const settlement = await tx.deliveryFinancialSettlement.findFirst({
        where: { OR: [{ id: batchId }, { deliveryOrderId: batchId }] },
        select: { id: true },
      });
      if (settlement) {
        const batchItem = await tx.ncmSettlementBatchItem.findFirst({
          where: {
            settlementId: settlement.id,
            batch: { status: { not: "REVERSED" } },
          },
          orderBy: { createdAt: "desc" },
          select: { batchId: true },
        });
        if (batchItem) {
          batch = await tx.ncmSettlementBatch.findUnique({
            where: { id: batchItem.batchId },
            include: {
              items: { include: { settlement: true } },
              varianceResolutions: { orderBy: { createdAt: "asc" } },
            },
          });
        }
      }
    }
    if (!batch) throw fail("NCM settlement batch was not found.", 404, "NCM_BATCH_NOT_FOUND");
    if (!["SETTLED", "VARIANCE_OPEN", "VARIANCE_PARTIALLY_RESOLVED", "VARIANCE_RESOLVED"].includes(batch.status)) {
      throw fail("Only an unreversed NCM settlement batch can be corrected.", 409, "NCM_BATCH_NOT_CORRECTABLE");
    }

    const settlementIds = batch.items.map(({ settlementId }) => settlementId);
    const existing = await tx.settlementReversion.findFirst({
      where: {
        reversionType: "NCM_COD",
        originalRecordId: { in: [batch.id, ...settlementIds] },
      },
    });
    if (existing) throw fail("This NCM settlement batch has already been corrected.", 409, "SETTLEMENT_ALREADY_CORRECTED");
    if (!batch.items.length || batch.items.some((item) =>
      !item.priorSettlementState ||
      !["PENDING", "COD_RECEIVED", "REQUESTED"].includes(item.priorSettlementState) ||
      item.settlement?.settlementState !== "SETTLED" ||
      item.settlement?.journalEntryId !== batch.journalEntryId
    )) {
      throw fail("The original NCM delivery states are missing or changed; reconcile the batch before correcting it.", 409, "NCM_BATCH_SOURCE_STATE_MISMATCH");
    }

    const batchKey = batch.idempotencyKey;
    const batchHash = typeof batchKey === "string" && batchKey.startsWith("NCM_COD_BATCH:")
      ? batchKey.slice("NCM_COD_BATCH:".length)
      : "";
    if (!batchHash || !batch.cashTransactionId || !batch.journalEntryId) {
      throw fail("The NCM batch is missing its original cash or journal reference.", 409, "NCM_BATCH_ACCOUNTING_REFERENCE_MISSING");
    }

    const originalCash = await tx.cashTransaction.findUnique({ where: { id: batch.cashTransactionId } });
    const depositAmount = new Prisma.Decimal(String(batch.actualNetDeposit));
    if (
      !originalCash ||
      (cashTransactionId && originalCash.id !== cashTransactionId) ||
      originalCash.type !== "INFLOW" ||
      originalCash.category !== "COD_REMITTANCE" ||
      originalCash.toAccountId !== batch.financialAccountId ||
      originalCash.idempotencyKey !== batchKey ||
      originalCash.referenceId !== batchKey ||
      !new Prisma.Decimal(String(originalCash.amount)).equals(depositAmount) ||
      !depositAmount.isFinite() ||
      !depositAmount.greaterThan(0)
    ) {
      throw fail("The NCM batch cash transaction does not match the recorded remittance.", 409, "NCM_BATCH_CASH_MISMATCH");
    }
    if (correctionMode === "VOID_NOT_EXECUTED" && (batch.reference || originalCash.invoiceNumber)) {
      throw fail("This batch has a recorded bank reference; use returned-funds correction instead of voiding it as unexecuted.", 409, "NCM_CONFIRMED_REMITTANCE_CANNOT_BE_VOIDED");
    }

    const sourceJournals = [];
    const baseJournal = await tx.journalEntry.findUnique({ where: { id: batch.journalEntryId } });
    const expectedBaseSourceId = `NCM-REMIT-${batchHash}`;
    if (
      !baseJournal ||
      baseJournal.sourceType !== "PAYMENT" ||
      baseJournal.sourceId !== expectedBaseSourceId ||
      baseJournal.status !== "POSTED"
    ) {
      throw fail("The posted NCM remittance journal is missing or does not match this batch.", 409, "NCM_BATCH_JOURNAL_MISMATCH");
    }
    sourceJournals.push({
      id: baseJournal.id,
      sourceType: "PAYMENT",
      sourceId: expectedBaseSourceId,
    });

    const feeAmount = new Prisma.Decimal(String(batch.totalCarrierFee || 0));
    const feeJournals = await tx.journalEntry.findMany({
      where: {
        sourceType: "NCM_CARRIER_FEE_ACCRUAL",
        sourceId: batchHash,
        status: "POSTED",
      },
      select: { id: true, sourceType: true, sourceId: true, status: true },
    });
    if ((feeAmount.greaterThan(0) && feeJournals.length !== 1) || feeJournals.length > 1) {
      throw fail("The NCM carrier-fee journal is missing or ambiguous; reconcile the batch before correcting it.", 409, "NCM_FEE_JOURNAL_MISMATCH");
    }
    sourceJournals.push(...feeJournals.map((journal) => ({
      id: journal.id,
      sourceType: "NCM_CARRIER_FEE_ACCRUAL",
      sourceId: batchHash,
    })));

    const documentsToCancel = [];
    if (feeAmount.greaterThan(0)) {
      const feeDocument = await tx.accountingDocument.findUnique({
        where: { idempotencyKey: `NCM_CARRIER_FEE:${batchHash}` },
      });
      if (
        !feeDocument ||
        feeDocument.side !== "PAYABLE" ||
        feeDocument.sourceType !== "NCM_CARRIER_FEE" ||
        feeDocument.sourceId !== batchHash ||
        !new Prisma.Decimal(String(feeDocument.originalAmount)).equals(feeAmount)
      ) {
        throw fail("The NCM carrier-fee payable is missing or does not match this batch.", 409, "NCM_FEE_DOCUMENT_MISMATCH");
      }
      documentsToCancel.push(feeDocument);
    }

    const varianceAmount = new Prisma.Decimal(String(batch.varianceAmount || 0));
    if (varianceAmount.greaterThan(0)) {
      const varianceDocument = await tx.accountingDocument.findUnique({
        where: { idempotencyKey: `NCM_REMITTANCE_VARIANCE:${batchHash}` },
      });
      if (
        !varianceDocument ||
        varianceDocument.side !== "PAYABLE" ||
        varianceDocument.sourceType !== "NCM_REMITTANCE_VARIANCE" ||
        varianceDocument.sourceId !== batchHash ||
        !new Prisma.Decimal(String(varianceDocument.originalAmount)).equals(varianceAmount)
      ) {
        throw fail("The NCM overpayment suspense payable is missing or does not match this batch.", 409, "NCM_VARIANCE_DOCUMENT_MISMATCH");
      }
      documentsToCancel.push(varianceDocument);
    }

    const resolutions = batch.varianceResolutions || [];
    for (const resolution of resolutions) {
      if (resolution.reversedAt) {
        throw fail("An NCM variance resolution was already corrected; reconcile the full batch history before proceeding.", 409, "NCM_RESOLUTION_ALREADY_CORRECTED");
      }
      const journal = await tx.journalEntry.findUnique({ where: { id: resolution.journalEntryId } });
      if (
        !journal ||
        journal.sourceType !== "NCM_VARIANCE_RESOLUTION" ||
        journal.sourceId !== `NCM_VARIANCE:${batch.id}` ||
        journal.status !== "POSTED"
      ) {
        throw fail("An NCM variance resolution journal is missing or does not match the batch.", 409, "NCM_RESOLUTION_JOURNAL_MISMATCH");
      }
      sourceJournals.push({
        id: journal.id,
        sourceType: "NCM_VARIANCE_RESOLUTION",
        sourceId: `NCM_VARIANCE:${batch.id}`,
      });
    }

    const sourceJournalIds = [...new Set(sourceJournals.map(({ id }) => id))];
    if (sourceJournalIds.length !== sourceJournals.length) {
      throw fail("The NCM batch links duplicate source journals; reconcile it before correcting.", 409, "NCM_DUPLICATE_SOURCE_JOURNAL");
    }

    const cashEntries = [{ original: originalCash, correctionType: "OUTFLOW", accountId: originalCash.toAccountId }];
    for (const resolution of resolutions) {
      const isCollection = resolution.action === "COLLECT_SHORTFALL";
      const isRefund = resolution.action === "REFUND_OVERPAYMENT";
      if (!isCollection && !isRefund) {
        if (resolution.action !== "APPLY_OVERPAYMENT" || resolution.cashTransactionId) {
          throw fail("An NCM variance resolution has an unsupported cash effect.", 409, "NCM_RESOLUTION_CASH_MISMATCH");
        }
        continue;
      }
      if (!resolution.cashTransactionId || !resolution.financialAccountId) {
        throw fail("An NCM cash variance resolution is missing its treasury reference.", 409, "NCM_RESOLUTION_CASH_MISMATCH");
      }
      const cash = await tx.cashTransaction.findUnique({ where: { id: resolution.cashTransactionId } });
      const expectedType = isCollection ? "INFLOW" : "OUTFLOW";
      const linkedAccountId = isCollection ? cash?.toAccountId : cash?.fromAccountId;
      const resolutionAmount = new Prisma.Decimal(String(resolution.amount));
      if (
        !cash ||
        cash.type !== expectedType ||
        cash.idempotencyKey !== resolution.idempotencyKey ||
        cash.referenceId !== `NCM_VARIANCE:${batch.id}` ||
        linkedAccountId !== resolution.financialAccountId ||
        !new Prisma.Decimal(String(cash.amount)).equals(resolutionAmount) ||
        !resolutionAmount.isFinite() ||
        !resolutionAmount.greaterThan(0)
      ) {
        throw fail("An NCM variance cash transaction does not match its resolution record.", 409, "NCM_RESOLUTION_CASH_MISMATCH");
      }
      cashEntries.push({
        original: cash,
        correctionType: isCollection ? "OUTFLOW" : "INFLOW",
        accountId: resolution.financialAccountId,
      });
    }

    const journalReversals = [];
    const reversalJournalBySourceId = new Map();
    for (const source of sourceJournals) {
      const reversal = await reverseJournal({
        journalEntryId: source.id,
        expectedSourceType: source.sourceType,
        expectedSourceId: source.sourceId,
        reversalReason: reason,
        reversedBy: actorAccountId,
        actorContext,
        client: tx,
      });
      journalReversals.push({ sourceJournalEntryId: source.id, reversalJournalEntryId: reversal.id });
      reversalJournalBySourceId.set(source.id, reversal.id);
    }

    const allocationRows = await tx.accountingAllocation.findMany({
      where: { journalEntryId: { in: sourceJournalIds } },
      select: {
        id: true,
        documentId: true,
        journalEntryId: true,
        settlementBatchId: true,
        allocationType: true,
        amount: true,
      },
    });
    const documentsToCancelById = new Map(documentsToCancel.map((document) => [document.id, document]));
    const cancellationAllocations = documentsToCancel.length
      ? await tx.accountingAllocation.findMany({
        where: { documentId: { in: documentsToCancel.map(({ id }) => id) } },
        select: { id: true, documentId: true },
      })
      : [];
    const sourceAllocationIds = new Set(allocationRows.map(({ id }) => id));
    if (cancellationAllocations.some(({ id }) => !sourceAllocationIds.has(id))) {
      throw fail("An NCM fee or suspense document has allocations outside this batch; reconcile it before correction.", 409, "NCM_DOCUMENT_HAS_EXTERNAL_ALLOCATIONS");
    }
    const allocationsByDocument = new Map();
    for (const allocation of allocationRows) {
      const amount = new Prisma.Decimal(String(allocation.amount));
      if (!amount.isFinite() || !amount.greaterThan(0)) {
        throw fail("An NCM source allocation has an invalid amount; reconcile the subledger before correcting.", 409, "NCM_ALLOCATION_MISMATCH");
      }
      const current = allocationsByDocument.get(allocation.documentId) || new Prisma.Decimal(0);
      allocationsByDocument.set(allocation.documentId, current.plus(amount));
    }
    const documentIds = [...new Set([
      ...allocationsByDocument.keys(),
      ...documentsToCancelById.keys(),
    ])];
    const documents = documentIds.length
      ? await tx.accountingDocument.findMany({ where: { id: { in: documentIds } } })
      : [];
    if (documents.length !== documentIds.length) {
      throw fail("An NCM source accounting document is missing; reconcile the subledger before correcting.", 409, "NCM_ALLOCATION_DOCUMENT_MISSING");
    }
    for (const document of documents) {
      const amount = allocationsByDocument.get(document.id) || new Prisma.Decimal(0);
      const allocated = new Prisma.Decimal(String(document.allocatedAmount));
      const remaining = new Prisma.Decimal(String(document.remainingAmount));
      const original = new Prisma.Decimal(String(document.originalAmount));
      const nextAllocated = allocated.minus(amount);
      const nextRemaining = remaining.plus(amount);
      const cancelDocument = documentsToCancelById.has(document.id);
      if (
        !["OPEN", "PARTIALLY_PAID", "PAID"].includes(document.status) ||
        !nextAllocated.isFinite() ||
        nextAllocated.isNegative() ||
        nextRemaining.greaterThan(original) ||
        (cancelDocument && (!nextAllocated.isZero() || !nextRemaining.equals(original)))
      ) {
        throw fail("An NCM source document no longer matches its allocation history; reconcile the subledger before correcting.", 409, "NCM_ALLOCATION_MISMATCH");
      }
      const nextStatus = cancelDocument ? "CANCELLED" : nextAllocated.isZero() ? "OPEN" : "PARTIALLY_PAID";
      const changed = await tx.accountingDocument.updateMany({
        where: {
          id: document.id,
          allocatedAmount: document.allocatedAmount,
          remainingAmount: document.remainingAmount,
          status: document.status,
        },
        data: {
          allocatedAmount: cancelDocument ? new Prisma.Decimal(0) : nextAllocated,
          remainingAmount: cancelDocument ? new Prisma.Decimal(0) : nextRemaining,
          status: nextStatus,
        },
      });
      if (changed.count !== 1) {
        throw fail("An NCM source document changed while reversing its allocations.", 409, "NCM_ALLOCATION_CONFLICT");
      }
    }
    for (const allocation of allocationRows) {
      const reversalJournalEntryId = reversalJournalBySourceId.get(allocation.journalEntryId);
      if (!reversalJournalEntryId) {
        throw fail("An NCM allocation has no matching reversal journal.", 409, "NCM_ALLOCATION_JOURNAL_MISSING");
      }
      await tx.accountingAllocation.create({
        data: {
          documentId: allocation.documentId,
          journalEntryId: reversalJournalEntryId,
          settlementBatchId: allocation.settlementBatchId,
          allocationType: allocation.allocationType,
          amount: new Prisma.Decimal(String(allocation.amount)).negated(),
          allocatedAt: now,
          notes: `Reversal of NCM settlement allocation ${allocation.id}. ${reason}`,
          idempotencyKey: `NCM_CORRECTION:${batch.id}:ALLOC:${allocation.id}`,
        },
      });
    }

    const cashReversals = [];
    const deltasByAccount = new Map();
    for (const entry of cashEntries) {
      const amount = new Prisma.Decimal(String(entry.original.amount));
      const delta = entry.correctionType === "INFLOW" ? amount : amount.negated();
      const currentDelta = deltasByAccount.get(entry.accountId) || new Prisma.Decimal(0);
      deltasByAccount.set(entry.accountId, currentDelta.plus(delta));
      const isInflow = entry.correctionType === "INFLOW";
      const reversal = await tx.cashTransaction.create({
        data: {
          idempotencyKey: `NCM_SETTLEMENT_CORRECTION:${batch.id}:${entry.original.id}`,
          externalPaymentReference: proofReference,
          amount,
          type: entry.correctionType,
          ...(isInflow ? { toAccountId: entry.accountId } : { fromAccountId: entry.accountId }),
          category: "REFUND",
          referenceId: batch.id,
          partyName: "Nepal Can Move (NCM)",
          description: `${correctionMode === "VOID_NOT_EXECUTED" ? "VOID" : "RETURNED FUNDS"}: NCM batch ${batch.id} correction. Evidence: ${proofReference}. Reason: ${reason}`,
          date: now,
        },
      });
      cashReversals.push({ originalCashTransactionId: entry.original.id, reversalCashTransactionId: reversal.id });
    }

    const accountIds = [...deltasByAccount.keys()];
    const accounts = accountIds.length
      ? await tx.financialAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, accountName: true, currency: true, currentBalance: true, reservedBalance: true },
      })
      : [];
    if (accounts.length !== accountIds.length) {
      throw fail("A treasury account linked to the NCM batch no longer exists.", 409, "NCM_TREASURY_ACCOUNT_MISSING");
    }
    for (const account of accounts) {
      if (account.currency !== "NPR") {
        throw fail("The NCM correction is linked to a non-NPR treasury account.", 409, "NCM_TREASURY_ACCOUNT_CURRENCY_MISMATCH");
      }
      const delta = deltasByAccount.get(account.id);
      const update = delta.isNegative()
        ? {
          where: {
            id: account.id,
            currency: "NPR",
            reservedBalance: account.reservedBalance,
            currentBalance: {
              gte: new Prisma.Decimal(String(account.reservedBalance || 0)).plus(delta.abs()),
            },
          },
          data: { currentBalance: { decrement: delta.abs() } },
        }
        : {
          where: {
            id: account.id,
            currency: "NPR",
            reservedBalance: account.reservedBalance,
          },
          data: { currentBalance: { increment: delta } },
        };
      if (delta.isZero()) continue;
      const changed = await tx.financialAccount.updateMany(update);
      if (changed.count !== 1) {
        throw fail("The treasury balance changed or contains reserved funds needed for this NCM correction.", 409, "NCM_TREASURY_BALANCE_CONFLICT");
      }
    }

    const resolutionReversals = [];
    for (const resolution of resolutions) {
      const reversalJournalEntryId = reversalJournalBySourceId.get(resolution.journalEntryId);
      const reversalCashTransactionId = cashReversals.find(
        ({ originalCashTransactionId }) => originalCashTransactionId === resolution.cashTransactionId,
      )?.reversalCashTransactionId || null;
      const changed = await tx.ncmSettlementVarianceResolution.updateMany({
        where: { id: resolution.id, reversedAt: null },
        data: {
          reversedAt: now,
          reversedByAccountId: actorAccountId,
          reversalJournalEntryId,
          reversalCashTransactionId,
        },
      });
      if (changed.count !== 1) {
        throw fail("An NCM variance resolution changed while reversing the batch.", 409, "NCM_RESOLUTION_CONFLICT");
      }
      resolutionReversals.push({
        resolutionId: resolution.id,
        reversalJournalEntryId,
        reversalCashTransactionId,
      });
    }

    for (const item of batch.items) {
      const changed = await tx.deliveryFinancialSettlement.updateMany({
        where: {
          id: item.settlementId,
          settlementState: "SETTLED",
          journalEntryId: batch.journalEntryId,
        },
        data: {
          settlementState: item.priorSettlementState,
          journalEntryId: null,
        },
      });
      if (changed.count !== 1) {
        throw fail("An NCM delivery settlement changed while correcting its batch.", 409, "NCM_SETTLEMENT_CONFLICT");
      }
    }
    const batchUpdate = await tx.ncmSettlementBatch.updateMany({
      where: { id: batch.id, status: batch.status, journalEntryId: batch.journalEntryId },
      data: { status: "REVERSED" },
    });
    if (batchUpdate.count !== 1) {
      throw fail("NCM batch status changed while correcting the batch.", 409, "NCM_BATCH_CONFLICT");
    }

    const originalStates = batch.items.map((item) => ({
      settlementId: item.settlementId,
      status: item.priorSettlementState,
    }));
    await tx.settlementReversion.create({
      data: {
        reversionType: "NCM_COD",
        originalRecordId: batch.id,
        cashTransactionId: originalCash.id,
        reversalTransactionId: cashReversals[0]?.reversalCashTransactionId || null,
        reversalJournalEntryId: reversalJournalBySourceId.get(baseJournal.id),
        originalAmount: depositAmount,
        partyName: "Nepal Can Move (NCM)",
        accountId: batch.financialAccountId,
        accountName: accounts.find(({ id }) => id === batch.financialAccountId)?.accountName || null,
        priorStatus: batch.status,
        restoredStatus: "REVERSED",
        priorPaidAmount: depositAmount,
        priorRemainingBalance: "0.00",
        revertedByAdminId: actorAccountId,
        revertedByEmail: actorEmail || null,
        revertReason: reason,
        correctionMode,
        evidenceReference: proofReference,
      },
    });

    await writeAudit({ ...actorContext, actorId: actorAccountId }, {
      action: "NCM_SETTLEMENT_BATCH_CORRECTED",
      entityType: "NcmSettlementBatch",
      entityId: batch.id,
      beforeState: {
        status: batch.status,
        settlementStates: batch.items.map(({ settlementId, settlement }) => ({
          settlementId,
          status: settlement?.settlementState,
        })),
        originalCashTransactionId: originalCash.id,
        sourceJournalEntryIds: sourceJournalIds,
      },
      afterState: {
        status: "REVERSED",
        correctionMode,
        evidenceReference: proofReference,
        reason,
        restoredSettlementStates: originalStates,
        cashReversals,
        journalReversals,
        resolutionReversals,
        reversedAllocationCount: allocationRows.length,
        cancelledDocumentIds: [...documentsToCancelById.keys()],
      },
    }, { client: tx });

    return {
      batchId: batch.id,
      status: "REVERSED",
      correctionMode,
      reversalTransactionId: cashReversals[0]?.reversalCashTransactionId || null,
      reversalJournalEntryId: reversalJournalBySourceId.get(baseJournal.id),
      restoredSettlementStates: originalStates,
    };
  };

  try {
    return typeof client.$transaction === "function"
      ? await client.$transaction(execute, { isolationLevel: "Serializable" })
      : await execute(client);
  } catch (error) {
    if (error?.code === "P2034") {
      throw fail("NCM settlement changed concurrently. Refresh the batch and retry.", 409, "NCM_BATCH_CONFLICT");
    }
    if (error?.code === "P2002") {
      throw fail("This NCM settlement batch has already been corrected.", 409, "SETTLEMENT_ALREADY_CORRECTED");
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
    : quantizeNprAmount(accountingDecimal(expectedDepositText));
  if (expectedDeposit && !expectedDeposit.greaterThan(0)) {
    throw fail("Expected net deposit must be a positive amount.", 400, "INVALID_NET_DEPOSIT");
  }
  const actualDepositText = typeof actualNetDeposit === "string" ? actualNetDeposit.trim() : null;
  if (actualDepositText === null || !/^\d{1,18}(?:\.\d{1,2})?$/.test(actualDepositText)) {
    throw fail("Enter the actual NCM deposit; an expected amount cannot substitute for a received amount.", 400, "INVALID_NET_DEPOSIT");
  }
  const requestedActualDeposit = quantizeNprAmount(accountingDecimal(actualDepositText));
  if (requestedActualDeposit.isNegative() || requestedActualDeposit.isZero()) {
    throw fail("Actual NCM deposit must be greater than zero to close a remittance batch.", 400, "INVALID_NET_DEPOSIT");
  }
  let batchHash = crypto.createHash("sha256").update(ids.join("|")).digest("hex");
  let batchKey = `NCM_COD_BATCH:${batchHash}`;
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
    return await runSerializable(client, async (tx) => {
      let retryNumber = 0;
      while (true) {
        const replay = await tx.cashTransaction.findUnique({ where: { idempotencyKey: batchKey } });
        if (!replay) break;
        const priorBatch = await tx.ncmSettlementBatch.findFirst({
          where: { cashTransactionId: replay.id },
          select: { status: true },
        });
        if (!priorBatch) {
          throw fail("An NCM remittance transaction exists without its source batch; reconcile it before processing.", 409, "NCM_BATCH_SOURCE_MISSING");
        }
        if (priorBatch.status !== "REVERSED") {
          if (
            replay.toAccountId !== financialAccountId ||
            replay.referenceId !== batchKey ||
            !accountingDecimal(replay.amount).equals(requestedActualDeposit)
          ) {
            throw fail("These NCM settlements were already processed with different treasury details.", 409, "NCM_SETTLEMENT_ALREADY_PROCESSED");
          }
          return { success: true, transactionId: replay.id, netDeposit: replay.amount, alreadyProcessed: true };
        }
        retryNumber += 1;
        batchHash = crypto.createHash("sha256").update(`${ids.join("|")}|retry:${retryNumber}`).digest("hex");
        batchKey = `NCM_COD_BATCH:${batchHash}`;
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
      const priorSettlementStates = new Map(
        settlements.map(({ id, settlementState }) => [id, settlementState]),
      );
      if (selectionPeriod) {
        await getSelectedNcmSettlementRecords(ids, selectionPeriod, tx);
      }
      let totalCod = accountingDecimal("0");
      let totalFee = accountingDecimal("0");
      for (const settlement of settlements) {
        const cod = quantizeNprAmount(getSettlementCod(settlement));
        const fee = quantizeNprAmount(getSettlementFee(settlement));
        if (cod.lessThanOrEqualTo(0) || fee.isNegative()) {
          throw fail("A selected NCM settlement has invalid COD or carrier-fee values.", 409, "INVALID_SETTLEMENT_AMOUNT");
        }
        totalCod = addDecimals(totalCod, cod);
        totalFee = addDecimals(totalFee, fee);
      }
      const expectedNet = quantizeNprAmount(subtractDecimals(totalCod, totalFee));
      if (!expectedNet.greaterThan(0)) {
        throw fail("Net remittance must be positive. Reconcile carrier charges separately before closing these settlements.", 409, "NON_POSITIVE_NET_REMITTANCE");
      }
      const actualDeposit = requestedActualDeposit;
      if (expectedDeposit && !expectedDeposit.equals(actualDeposit)) {
        throw fail(`Receipt must match the reconciled net remittance of NPR ${expectedNet.toFixed(2)}.`, 409, "NET_REMITTANCE_MISMATCH");
      }
      const varianceAmount = quantizeNprAmount(subtractDecimals(actualDeposit, expectedNet));
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
      const openNcmCod = quantizeNprAmount(receivableDocuments.reduce(
        (sum, document) => addDecimals(sum, accountingDecimal(String(document.remainingAmount))),
        accountingDecimal("0"),
      ));
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
          amount: totalFee.toFixed(2),
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
        ? addDecimals(totalCod, varianceAmount)
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
      if (accountingDecimal(String(receivableAllocation.unallocatedAmount)).greaterThan(0)) {
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
        if (accountingDecimal(String(feeAllocation.unallocatedAmount)).greaterThan(0)) {
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
          amount: varianceAmount.toFixed(2),
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
        data: { currentBalance: { increment: actualDeposit.toFixed(2) } },
      });
      if (balanceUpdate.count !== 1) {
        throw fail("Treasury account changed while posting the remittance.", 409, "TREASURY_ACCOUNT_CONFLICT");
      }

      const cashTransaction = await tx.cashTransaction.create({
        data: {
          idempotencyKey: batchKey,
          amount: actualDeposit.toFixed(2),
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
            create: settlements.map(({ id, settlementState }) => ({
              settlementId: id,
              priorSettlementState: priorSettlementStates.get(id) || settlementState,
            })),
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
    });
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
