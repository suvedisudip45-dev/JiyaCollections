import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";
import {
  accrueDistributorDeliveryEarning,
  accrueDistributorServiceCharge,
} from "./distributorServiceEarningService.js";
import { accrueClosedDistributorBonuses, getClosedDistributorBonusPreview } from "./distributorBonusService.js";
import { recordSystemAudit } from "./auditService.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments } from "./accountingSubledgerService.js";
import {
  postSupplierPaymentAccounting,
} from "./accountingPostingEngine.js";
import { requireExternalPaymentReference } from "../utils/externalPaymentReference.js";
import { getDistributorCashPosition } from "./distributorCashSettlementService.js";
import { validateTreasuryPayoutAccount } from "./treasuryAccountingService.js";
import {
  confirmFinancialPayout,
  failFinancialPayout,
  initiateFinancialPayout,
} from "./financialPayoutService.js";

const parseJSON = (val, fallback = []) => {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const fail = (message, statusCode = 400, code = "DISTRIBUTOR_FINANCE_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const parseMoney = (value, label) => {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,18}(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw fail(`${label} must be a positive amount with no more than two decimal places.`, 400, "INVALID_AMOUNT");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw fail(`${label} must be a positive amount with no more than two decimal places.`, 400, "INVALID_AMOUNT");
  }
  return Number(amount.toFixed(2));
};

const validateOptionalText = (value, label, maxLength) => {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw fail(`${label} must be text.`, 400, "INVALID_INPUT");
  }
  const text = value == null ? "" : value.trim();
  if (text.length > maxLength) {
    throw fail(`${label} must be ${maxLength} characters or fewer.`, 400, "INVALID_INPUT");
  }
  return text || null;
};

const accrueUnrecordedReturnCharges = async ({
  distributorId,
  distributorName,
  client,
  accrueServiceCharge = accrueDistributorServiceCharge,
}) => {
  if (!client.distributorServiceEarning) return;
  const returnedAssignments = await client.orderAssignment.findMany({
    where: {
      distributorId,
      deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
      status: { in: ["returned", "Returned"] },
    },
    select: { id: true, orderId: true, returnedAt: true, assignedAt: true },
  });
  if (!returnedAssignments.length) return;
  const assignmentIds = returnedAssignments.map((assignment) => assignment.id);
  const existingEarnings = await client.distributorServiceEarning.findMany({
    where: {
      distributorId,
      serviceType: "RETURN",
      assignmentId: { in: assignmentIds },
    },
    select: { assignmentId: true },
  });
  const existingAssignmentIds = new Set(existingEarnings.map((earning) => earning.assignmentId));
  const ncmDeliveries = await client.deliveryOrder.findMany({
    where: { orderId: { in: returnedAssignments.map((assignment) => assignment.orderId) } },
    select: { orderId: true },
  });
  const ncmOrderIds = new Set(ncmDeliveries.map((delivery) => delivery.orderId));

  for (const assignment of returnedAssignments) {
    if (existingAssignmentIds.has(assignment.id) || ncmOrderIds.has(assignment.orderId)) continue;
    const effectiveAt = assignment.returnedAt || assignment.assignedAt || new Date();
    const rateCard = await resolveActiveRateCard({ distributorId, effectiveAt, client });
    await accrueServiceCharge({
      distributorId,
      distributorName,
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      sourceId: assignment.id,
      rateCardId: rateCard.rateCardId || null,
      serviceType: "RETURN",
      chargeAmount: rateCard.returnCharge,
      vatRate: rateCard.vatRate,
      effectiveAt,
      client,
    });
  }
};

const accrueUnrecordedDeliveryEarnings = async ({
  distributorId,
  distributorName,
  client,
  accrueDelivery = accrueDistributorDeliveryEarning,
}) => {
  if (!client.distributorServiceEarning) return;
  const assignments = await client.orderAssignment.findMany({
    where: {
      distributorId,
      deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
      status: { in: ["delivered", "Delivered", "returned", "Returned"] },
    },
    select: { id: true, orderId: true, deliveredAt: true, assignedAt: true },
  });
  if (!assignments.length) return;

  const existingEarnings = await client.distributorServiceEarning.findMany({
    where: {
      distributorId,
      serviceType: "DELIVERY",
      assignmentId: { in: assignments.map((assignment) => assignment.id) },
    },
    select: { assignmentId: true },
  });
  const existingAssignmentIds = new Set(existingEarnings.map((earning) => earning.assignmentId));
  const ncmDeliveries = await client.deliveryOrder.findMany({
    where: { orderId: { in: assignments.map((assignment) => assignment.orderId) } },
    select: { orderId: true },
  });
  const ncmOrderIds = new Set(ncmDeliveries.map((delivery) => delivery.orderId));

  for (const assignment of assignments) {
    if (existingAssignmentIds.has(assignment.id) || ncmOrderIds.has(assignment.orderId)) continue;
    await accrueDelivery({
      distributorId,
      distributorName,
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      effectiveAt: assignment.deliveredAt || assignment.assignedAt || new Date(),
      client,
    });
  }
};

export const initiateAdminDistributorSettlement = async ({
  settlementId,
  amount,
  financialAccountId,
  externalPaymentReference = null,
  idempotencyKey,
  adminNotes = null,
  adminAccountId = null,
  resolveAccountingParty = ensureAccountingParty,
  validatePayoutAccount = validateTreasuryPayoutAccount,
  writeAudit = recordSystemAudit,
  client = prisma,
} = {}) => {
  if (typeof settlementId !== "string" || !settlementId.trim() || settlementId.length > 191) {
    throw fail("A valid settlement request ID is required.", 400, "INVALID_SETTLEMENT_ID");
  }
  const settleAmount = parseMoney(amount, "Settlement payment amount");
  const normalizedKey = validateOptionalText(idempotencyKey, "Idempotency key", 191);
  if (!normalizedKey) throw fail("A payout idempotency key is required.", 400, "IDEMPOTENCY_KEY_REQUIRED");

  const validateTarget = async (tx) => {
    const settlement = await tx.distributorSettlementRequest.findUnique({
      where: { id: settlementId },
      include: { distributor: true },
    });
    if (!settlement) throw fail("Distributor settlement request not found.", 404);
    if (settlement.status === "SETTLED" || settlement.status === "REJECTED") {
      throw fail("This distributor settlement request is already closed.", 409, "SETTLEMENT_NOT_PAYABLE");
    }
    if (settlement.metadata?.settlementBasis === "LEGACY_EARNINGS_RECONCILIATION_REQUIRED") {
      throw fail("Reconcile verified earning documents before initiating this payout.", 409, "LEGACY_EARNINGS_RECONCILIATION_REQUIRED");
    }
    const requestRemaining = new Prisma.Decimal(String(settlement.amount))
      .minus(new Prisma.Decimal(String(settlement.paidAmount || 0)));
    const pending = await tx.financialPayout.aggregate({
      where: {
        targetType: "DISTRIBUTOR_SETTLEMENT",
        targetId: settlementId,
        status: "INITIATED",
      },
      _sum: { amount: true },
    });
    const alreadyReserved = new Prisma.Decimal(String(pending._sum.amount || 0));
    const requestAvailable = requestRemaining.minus(alreadyReserved);

    let documentAvailable = new Prisma.Decimal(0);
    if (settlement.metadata?.settlementBasis === "ACCOUNTING_SUBLEDGER") {
      const party = await resolveAccountingParty({
        partyType: "DISTRIBUTOR",
        sourceEntityId: settlement.distributorId,
        displayName: settlement.distributor.name,
      }, { client: tx });
      const documentIds = Array.isArray(settlement.metadata.earningDocumentIds)
        ? settlement.metadata.earningDocumentIds
        : [];
      const documents = documentIds.length
        ? await tx.accountingDocument.findMany({
            where: {
              id: { in: documentIds },
              partyId: party.id,
              side: "PAYABLE",
              sourceType: { in: ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"] },
              status: { in: ["OPEN", "PARTIALLY_PAID"] },
            },
            select: { remainingAmount: true },
          })
        : [];
      documentAvailable = documents.reduce(
        (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
        new Prisma.Decimal(0),
      );
    } else {
      const payable = settlement.metadata?.accountPayableId
        ? await tx.accountPayable.findUnique({ where: { id: settlement.metadata.accountPayableId } })
        : await tx.accountPayable.findFirst({
            where: { referenceType: "DISTRIBUTOR_SETTLEMENT", referenceId: settlement.id },
          });
      if (!payable) throw fail("The linked Accounts Payable record is missing.", 409, "DISTRIBUTOR_PAYABLE_NOT_FOUND");
      documentAvailable = new Prisma.Decimal(String(payable.remainingBalance));
    }

    const availableAmount = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      Prisma.Decimal.min(requestAvailable, documentAvailable),
    );
    if (new Prisma.Decimal(String(settleAmount)).greaterThan(availableAmount)) {
      throw fail("Payout exceeds the unreserved, verified distributor payable.", 409, "PAYOUT_EXCEEDS_PAYABLE");
    }
    const account = await tx.financialAccount.findUnique({ where: { id: financialAccountId } });
    await validatePayoutAccount(account, tx);
    return { availableAmount };
  };

  return initiateFinancialPayout({
    targetType: "DISTRIBUTOR_SETTLEMENT",
    targetId: settlementId,
    amount: settleAmount,
    financialAccountId,
    idempotencyKey: normalizedKey,
    externalPaymentReference,
    initiatedByAccountId: adminAccountId,
    notes: adminNotes,
    validateTarget,
    writeAudit,
    client,
  });
};

export const confirmAdminDistributorSettlement = async ({
  payoutId,
  bankEvidenceReference,
  adminAccountId = null,
  client = prisma,
  writeAudit = recordSystemAudit,
  ...dependencies
} = {}) => confirmFinancialPayout({
  payoutId,
  bankEvidenceReference,
  confirmedByAccountId: adminAccountId,
  client,
  writeAudit,
  finalizePayout: async (tx, payout) => {
    if (payout.targetType !== "DISTRIBUTOR_SETTLEMENT") {
      throw fail("This payout is not a distributor settlement.", 409, "PAYOUT_TARGET_MISMATCH");
    }
    return executeAdminDistributorSettlement({
      settlementId: payout.targetId,
      amount: payout.amount.toString(),
      financialAccountId: payout.financialAccountId,
      externalPaymentReference: payout.externalPaymentReference,
      idempotencyKey: payout.idempotencyKey,
      adminNotes: payout.notes,
      adminAccountId,
      client: tx,
      writeAudit,
      ...dependencies,
    });
  },
});

export const failAdminDistributorSettlement = async ({
  payoutId,
  failureReason,
  adminAccountId = null,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => failFinancialPayout({
  payoutId,
  expectedTargetType: "DISTRIBUTOR_SETTLEMENT",
  failureReason,
  failedByAccountId: adminAccountId,
  client,
  writeAudit,
});

/**
 * Detailed Financial Statement for Distributor Dashboard
 */
export const getDistributorFinancialStatement = async ({
  distributorId,
  withVat = true,
  startDate = null,
  endDate = null,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (typeof withVat !== "boolean") throw fail("VAT display mode must be a boolean.", 400, "INVALID_VAT_MODE");

  const distributor = await client.distributor.findUnique({
    where: { id: distributorId },
    select: { id: true, name: true, phone: true, city: true, status: true, isActive: true },
  });
  if (!distributor) throw fail("Distributor profile not found.", 404);

  // Date filters
  const dateFilter = {};
  if (startDate !== null && startDate !== undefined) {
    const parsedStart = new Date(startDate);
    if (typeof startDate !== "string" || !Number.isFinite(parsedStart.getTime())) {
      throw fail("Start date must be a valid date.", 400, "INVALID_DATE_RANGE");
    }
    dateFilter.gte = parsedStart;
  }
  if (endDate !== null && endDate !== undefined) {
    const parsedEnd = new Date(endDate);
    if (typeof endDate !== "string" || !Number.isFinite(parsedEnd.getTime())) {
      throw fail("End date must be a valid date.", 400, "INVALID_DATE_RANGE");
    }
    dateFilter.lte = parsedEnd;
  }
  if (dateFilter.gte && dateFilter.lte && dateFilter.gte > dateFilter.lte) {
    throw fail("Start date cannot be after end date.", 400, "INVALID_DATE_RANGE");
  }

  // 1. Fetch delivered assignments
  const deliveredAssignments = await client.orderAssignment.findMany({
    where: {
      distributorId,
      deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
      status: { in: ["delivered", "Delivered", "returned", "Returned"] },
      ...(Object.keys(dateFilter).length ? { deliveredAt: dateFilter } : {}),
    },
    include: {
      distributor: { select: { id: true, name: true } },
    },
    orderBy: { deliveredAt: "desc" },
  });

  const deliveredOrderIds = deliveredAssignments.map((a) => a.orderId);
  const ncmDeliveries = deliveredOrderIds.length
    ? await client.deliveryOrder.findMany({
        where: { orderId: { in: deliveredOrderIds } },
        select: { orderId: true },
      })
    : [];
  const ncmOrderIds = new Set(ncmDeliveries.map((delivery) => delivery.orderId));
  const selfDeliveredAssignments = deliveredAssignments.filter((assignment) => !ncmOrderIds.has(assignment.orderId));
  const selfDeliveredOrderIds = selfDeliveredAssignments.map((assignment) => assignment.orderId);
  const deliveredOrders = await client.order.findMany({
    where: { id: { in: selfDeliveredOrderIds } },
  });
  const orderMap = new Map(deliveredOrders.map((o) => [o.id, o]));

  // 2. Fetch returned assignments
  const returnedAssignmentsFromQuery = await client.orderAssignment.findMany({
    where: {
      distributorId,
      deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
      status: { in: ["returned", "Returned"] },
      ...(Object.keys(dateFilter).length ? { returnedAt: dateFilter } : {}),
    },
    orderBy: { returnedAt: "desc" },
  });
  const returnedOrderIds = returnedAssignmentsFromQuery.map((assignment) => assignment.orderId);
  const ncmReturnedDeliveries = returnedOrderIds.length
    ? await client.deliveryOrder.findMany({
        where: { orderId: { in: returnedOrderIds } },
        select: { orderId: true },
      })
    : [];
  const ncmReturnedOrderIds = new Set(ncmReturnedDeliveries.map((delivery) => delivery.orderId));
  const returnedAssignments = returnedAssignmentsFromQuery.filter(
    (assignment) => !ncmReturnedOrderIds.has(assignment.orderId),
  );

  // 3. Fetch all settlements
  const settlementRequests = await client.distributorSettlementRequest.findMany({
    where: {
      distributorId,
      ...(Object.keys(dateFilter).length ? { requestedAt: dateFilter } : {}),
    },
    orderBy: { requestedAt: "desc" },
  });
  const bonusPreview = await getClosedDistributorBonusPreview({ distributorId, client });

  // Calculate earnings and transactions
  const rateCard = await resolveActiveRateCard({ distributorId, client });
  const vatRate = Number(rateCard.vatRate ?? 13);
  const serviceEarnings = client.distributorServiceEarning
    ? await client.distributorServiceEarning.findMany({
        where: {
          distributorId,
          serviceType: { in: ["DELIVERY", "RETURN", "EXCHANGE", "NCM_TRANSFER"] },
          ...(Object.keys(dateFilter).length ? { effectiveAt: dateFilter } : {}),
        },
        orderBy: { effectiveAt: "desc" },
      })
    : [];
  const earningByAssignment = new Map(
    serviceEarnings
      .filter((earning) => earning.serviceType === "DELIVERY")
      .map((earning) => [earning.assignmentId, earning])
  );
  const returnEarningByAssignment = new Map(
    serviceEarnings
      .filter((earning) => earning.serviceType === "RETURN")
      .map((earning) => [earning.assignmentId, earning])
  );
  const exchangeEarnings = serviceEarnings.filter((earning) => earning.serviceType === "EXCHANGE");
  const ncmTransferEarnings = serviceEarnings.filter((earning) => earning.serviceType === "NCM_TRANSFER");

  let grossDeliveryEarnings = 0;
  let earnedIncentives = 0;
  let adminDiscountsApplied = 0;
  let returnFeesEarned = 0;
  let exchangeFeesEarned = 0;
  let ncmTransferFeesEarned = 0;
  let snapshottedDeliverySubtotal = 0;
  let snapshottedServiceSubtotal = 0;
  let snapshottedVatAmount = 0;
  let legacyReturnFees = 0;
  let legacyReturnVatAmount = 0;
  let earnedBonuses = 0;
  const itemizedTransactions = [];

  // Itemize deliveries
  for (const assignment of selfDeliveredAssignments) {
    const order = orderMap.get(assignment.orderId);
    const earning = earningByAssignment.get(assignment.id);
    if (earning) {
      const deliveryCharge = Number(earning.deliveryCharge);
      const bonus = Number(earning.incentiveAmount);
      const commission = Number(earning.commissionAmount);
      const vatAmount = Number(earning.vatAmount);
      const netEarning = Number(earning.payableAmount);
      grossDeliveryEarnings += deliveryCharge;
      earnedIncentives += bonus;
      adminDiscountsApplied += commission;
      snapshottedDeliverySubtotal += deliveryCharge + bonus - commission;
      snapshottedVatAmount += vatAmount;
      itemizedTransactions.push({
        id: `tx-del-${earning.id}`,
        type: "DELIVERY",
        referenceId: earning.orderId,
        date: earning.effectiveAt,
        description: `Self-delivery completed for Order ${earning.orderId.slice(0, 8)}`,
        grossAmount: deliveryCharge,
        incentiveAmount: bonus,
        discountChargeAmount: commission,
        netAmount: netEarning,
        orderAmount: order ? Number(order.amount) : 0,
        paymentMethod: order ? order.paymentMethod : "COD",
        rateCardId: earning.rateCardId,
        earningId: earning.id,
        assignmentId: earning.assignmentId,
        accountingDocumentId: earning.accountingDocumentId,
        journalEntryId: earning.journalEntryId,
        taxSnapshot: earning.snapshot,
        isRateSnapshotted: true,
      });
      continue;
    }

    const deliveryCharge = Number(rateCard.deliveryCharge || 0);
    const bonus = 0;
    const commission = (rateCard.commissionRate > 0 && rateCard.commissionRate <= 100)
      ? (deliveryCharge * (rateCard.commissionRate / 100))
      : Number(rateCard.commissionRate || 0);
    const netEarning = deliveryCharge + bonus - commission;

    grossDeliveryEarnings += deliveryCharge;
    earnedIncentives += bonus;
    adminDiscountsApplied += commission;

    itemizedTransactions.push({
      id: `tx-del-${assignment.id}`,
      type: "DELIVERY",
      referenceId: assignment.orderId,
      date: assignment.deliveredAt || assignment.assignedAt,
      description: `Self-delivery completed for Order ${assignment.orderId.slice(0, 8)}`,
      grossAmount: Number(deliveryCharge.toFixed(2)),
      incentiveAmount: Number(bonus.toFixed(2)),
      discountChargeAmount: Number(commission.toFixed(2)),
      netAmount: Number(netEarning.toFixed(2)),
      orderAmount: order ? Number(order.amount) : 0,
      paymentMethod: order ? order.paymentMethod : "COD",
      isRateSnapshotted: false,
      assignmentId: assignment.id,
    });
  }

  for (const bonus of bonusPreview.periods) {
    const bonusDate = new Date(bonus.periodEnd);
    if ((dateFilter.gte && bonusDate < dateFilter.gte) || (dateFilter.lte && bonusDate > dateFilter.lte)) continue;
    const amount = Number(bonus.bonusAmount);
    earnedBonuses += amount;
    itemizedTransactions.push({
      id: `tx-bonus-${bonus.earningId || bonus.period}`,
      type: "BONUS",
      referenceId: bonus.period,
      date: bonus.periodEnd,
      description: `Monthly delivery target bonus · ${bonus.period}`,
      eligibleDeliveryCount: bonus.eligibleDeliveryCount,
      earnedTiers: bonus.earnedTiers,
      tiers: bonus.tiers,
      grossAmount: amount,
      incentiveAmount: 0,
      bonusAmount: amount,
      discountChargeAmount: 0,
      netAmount: amount,
      status: bonus.accrued ? "ACCRUED" : "ELIGIBLE_PENDING_ACCRUAL",
      earningId: bonus.earningId,
      accountingDocumentId: bonus.accountingDocumentId,
    });
  }

  // Itemize returns
  for (const assignment of returnedAssignments) {
    const earning = returnEarningByAssignment.get(assignment.id);
    const effectiveAt = assignment.returnedAt || assignment.assignedAt;
    const returnRateCard = earning
      ? null
      : await resolveActiveRateCard({ distributorId, effectiveAt: effectiveAt || new Date(), client });
    const returnFee = Number(earning?.otherCharges ?? returnRateCard?.returnCharge ?? 0);
    returnFeesEarned += returnFee;
    if (earning) {
      snapshottedServiceSubtotal += returnFee;
      snapshottedVatAmount += Number(earning.vatAmount || 0);
    } else {
      legacyReturnFees += returnFee;
      legacyReturnVatAmount += returnFee * Number(returnRateCard?.vatRate ?? vatRate) / 100;
    }

    itemizedTransactions.push({
      id: `tx-ret-${earning?.id || assignment.id}`,
      type: "RETURN",
      referenceId: assignment.orderId,
      date: earning?.effectiveAt || effectiveAt,
      description: `Customer return QA processed for Order ${assignment.orderId.slice(0, 8)}`,
      grossAmount: Number(returnFee.toFixed(2)),
      incentiveAmount: 0,
      discountChargeAmount: 0,
      netAmount: Number(earning?.payableAmount ?? returnFee),
      vatAmount: Number(earning?.vatAmount || 0),
      orderAmount: 0,
      paymentMethod: "N/A",
      earningId: earning?.id,
      assignmentId: assignment.id,
      accountingDocumentId: earning?.accountingDocumentId,
      journalEntryId: earning?.journalEntryId,
      rateCardId: earning?.rateCardId,
      isRateSnapshotted: Boolean(earning),
    });
  }

  for (const earning of exchangeEarnings) {
    const exchangeFee = Number(earning.otherCharges || 0);
    exchangeFeesEarned += exchangeFee;
    snapshottedServiceSubtotal += exchangeFee;
    snapshottedVatAmount += Number(earning.vatAmount || 0);
    itemizedTransactions.push({
      id: `tx-exchange-${earning.id}`,
      type: "EXCHANGE",
      referenceId: earning.orderId,
      date: earning.effectiveAt,
      description: `Distributor exchange completed for Order ${earning.orderId.slice(0, 8)}`,
      grossAmount: Number(exchangeFee.toFixed(2)),
      incentiveAmount: 0,
      discountChargeAmount: 0,
      netAmount: Number(earning.payableAmount),
      vatAmount: Number(earning.vatAmount || 0),
      orderAmount: 0,
      paymentMethod: "N/A",
      earningId: earning.id,
      assignmentId: earning.assignmentId,
      accountingDocumentId: earning.accountingDocumentId,
      journalEntryId: earning.journalEntryId,
      isRateSnapshotted: true,
    });
  }

  for (const earning of ncmTransferEarnings) {
    const transferFee = Number(earning.otherCharges || 0);
    ncmTransferFeesEarned += transferFee;
    snapshottedServiceSubtotal += transferFee;
    snapshottedVatAmount += Number(earning.vatAmount || 0);
    itemizedTransactions.push({
      id: `tx-ncm-transfer-${earning.id}`,
      type: "NCM_TRANSFER",
      referenceId: earning.orderId,
      date: earning.effectiveAt,
      description: `NCM customer delivery transfer fee for Order ${earning.orderId.slice(0, 8)}`,
      grossAmount: Number(transferFee.toFixed(2)),
      incentiveAmount: 0,
      discountChargeAmount: 0,
      netAmount: Number(earning.payableAmount),
      vatAmount: Number(earning.vatAmount || 0),
      orderAmount: 0,
      paymentMethod: "N/A",
      earningId: earning.id,
      assignmentId: earning.assignmentId,
      accountingDocumentId: earning.accountingDocumentId,
      journalEntryId: earning.journalEntryId,
      rateCardId: earning.rateCardId,
      isRateSnapshotted: true,
    });
  }

  // Itemize settlements
  let totalSettledPaid = 0;
  let pendingSettlementAmount = 0;

  for (const s of settlementRequests) {
    const amt = Number(s.amount);
    const paidAmount = s.status === "SETTLED" && Number(s.paidAmount || 0) === 0
      ? amt
      : Number(s.paidAmount || 0);
    const remainingAmount = Math.max(0, amt - paidAmount);
    totalSettledPaid += paidAmount;
    if (s.status !== "REJECTED") pendingSettlementAmount += remainingAmount;

    itemizedTransactions.push({
      id: `tx-set-${s.id}`,
      type: "SETTLEMENT",
      referenceId: s.id,
      date: s.settledAt || s.requestedAt,
      description: s.status === "SETTLED"
        ? "Settlement Payout Executed"
        : paidAmount > 0
          ? "Settlement Partially Paid"
          : s.status === "REJECTED"
            ? "Settlement Request Rejected"
            : "Settlement Payout Requested (Pending)",
      grossAmount: -paidAmount,
      incentiveAmount: 0,
      bonusAmount: 0,
      discountChargeAmount: 0,
      netAmount: -paidAmount,
      status: s.status,
      requestedAmount: amt,
      paidAmount,
      outstandingAmount: remainingAmount,
      notes: s.notes || s.adminNotes || null,
      financialAccountId: s.financialAccountId || null,
      statementSnapshot: parseJSON(s.metadata, {}).statementSnapshot || null,
    });
  }

  // Sort transactions descending
  itemizedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Compute subtotal before VAT
  const subtotalBeforeVat = Number(
    (grossDeliveryEarnings + earnedIncentives + earnedBonuses + returnFeesEarned + exchangeFeesEarned + ncmTransferFeesEarned - adminDiscountsApplied).toFixed(2)
  );
  const legacyDeliverySubtotal = Math.max(0, subtotalBeforeVat - snapshottedDeliverySubtotal - snapshottedServiceSubtotal);
  const taxableLegacySubtotal = Math.max(0, legacyDeliverySubtotal - legacyReturnFees);
  const vatAmount = Number((taxableLegacySubtotal * (vatRate / 100) + legacyReturnVatAmount + snapshottedVatAmount).toFixed(2));
  const totalWithVat = Number((subtotalBeforeVat + vatAmount).toFixed(2));
  const totalWithoutVat = subtotalBeforeVat;

  const currentEarnings = Boolean(withVat) ? totalWithVat : totalWithoutVat;
  const grossOutstandingPayableBalance = Number(Math.max(0, currentEarnings - totalSettledPaid).toFixed(2));
  const netPayableBalance = Number(Math.max(0, grossOutstandingPayableBalance - pendingSettlementAmount).toFixed(2));

  return {
    success: true,
    distributor,
    rateCard,
    vatMode: Boolean(withVat) ? "WITH_VAT" : "WITHOUT_VAT",
    summary: {
      grossDeliveryEarnings: Number(grossDeliveryEarnings.toFixed(2)),
      earnedIncentives: Number(earnedIncentives.toFixed(2)),
      earnedBonuses: Number(earnedBonuses.toFixed(2)),
      returnFeesEarned: Number(returnFeesEarned.toFixed(2)),
      exchangeFeesEarned: Number(exchangeFeesEarned.toFixed(2)),
      ncmTransferFeesEarned: Number(ncmTransferFeesEarned.toFixed(2)),
      adminDiscountsApplied: Number(adminDiscountsApplied.toFixed(2)),
      subtotalBeforeVat,
      vatRate,
      vatAmount,
      totalWithVat,
      totalWithoutVat,
      totalSettledPaid: Number(totalSettledPaid.toFixed(2)),
      pendingSettlementAmount: Number(pendingSettlementAmount.toFixed(2)),
      netPayableBalance, // Outstanding amount platform owes to distributor
      grossOutstandingPayableBalance,
      receivables: grossOutstandingPayableBalance,
      payables: grossOutstandingPayableBalance,
    },
    transactions: itemizedTransactions,
    bonusProgram: bonusPreview,
    settlementRequests,
  };
};

/**
 * Submit Settlement Request from Distributor to Admin
 */
export const submitDistributorSettlementRequest = async ({
  distributorId,
  amount,
  withVat = true,
  notes = null,
  idempotencyKey = null,
  requestedByAccountId = null,
  client = prisma,
  accrueDelivery = accrueDistributorDeliveryEarning,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (typeof withVat !== "boolean") {
    throw fail("VAT mode must be selected as true or false.", 400, "INVALID_VAT_MODE");
  }

  const numAmount = parseMoney(amount, "Settlement amount");
  const normalizedNotes = validateOptionalText(notes, "Settlement notes", 1000);
  const suppliedKey = idempotencyKey == null ? null : validateOptionalText(idempotencyKey, "Idempotency key", 191);
  const key = suppliedKey || `dist-settle-req-${distributorId}-${Date.now()}`;

  let settlementRequest;
  try {
    settlementRequest = await client.$transaction(async (tx) => {
      if (tx.$queryRaw) {
        await tx.$queryRaw`SELECT id FROM Distributor WHERE id = ${distributorId} FOR UPDATE`;
      }
      const existing = await tx.distributorSettlementRequest.findFirst({
        where: { idempotencyKey: key },
      });
      if (existing) {
        const existingVatMode = existing.metadata?.statementSnapshot?.vatMode;
        if (
          existing.distributorId !== distributorId ||
          Number(existing.amount) !== numAmount ||
          (existingVatMode && existingVatMode !== (withVat ? "WITH_VAT" : "WITHOUT_VAT"))
        ) {
          throw fail("This idempotency key was already used for a different settlement request.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { ...existing, isReplay: true };
      }

      const distributor = await tx.distributor.findUnique({
        where: { id: distributorId },
        select: { id: true, name: true },
      });
      if (!distributor) throw fail("Distributor profile not found.", 404);
      await accrueClosedDistributorBonuses({
        distributorId,
        distributorName: distributor.name,
        client: tx,
      });
      await accrueUnrecordedDeliveryEarnings({
        distributorId,
        distributorName: distributor.name,
        client: tx,
        accrueDelivery,
      });
      await accrueUnrecordedReturnCharges({
        distributorId,
        distributorName: distributor.name,
        client: tx,
      });
      const statement = await getDistributorFinancialStatement({ distributorId, withVat, client: tx });
      const availableBalance = statement.summary.netPayableBalance;
      if (numAmount > availableBalance) {
        throw fail(
          `Requested amount (Rs. ${numAmount.toFixed(2)}) exceeds available net settlement payable (Rs. ${availableBalance.toFixed(2)}).`,
          409,
          "INSUFFICIENT_SETTLEMENT_BALANCE",
        );
      }

      const created = await tx.distributorSettlementRequest.create({
        data: {
          distributorId,
          amount: numAmount,
          grossEarnings: statement.summary.subtotalBeforeVat,
          incentives: statement.summary.earnedIncentives,
          bonuses: statement.summary.earnedBonuses,
          discountsApplied: statement.summary.adminDiscountsApplied,
          vatAmount: withVat ? statement.summary.vatAmount : 0,
          netPayable: numAmount,
          status: "PENDING",
          notes: normalizedNotes,
          requestedBy: requestedByAccountId,
          idempotencyKey: key,
        },
        include: {
          distributor: { select: { id: true, name: true, city: true, phone: true } },
        },
      });
      
      const earningDocuments = tx.accountingDocument
        ? await tx.accountingDocument.findMany({
            where: {
              party: { partyType: "DISTRIBUTOR", sourceEntityId: distributorId },
              side: "PAYABLE",
              sourceType: { in: ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"] },
              status: { in: ["OPEN", "PARTIALLY_PAID"] },
            },
            orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
          })
        : [];
      const openEarnings = earningDocuments.reduce((sum, document) => sum + Number(document.remainingAmount), 0);
      const useSubledger = earningDocuments.length > 0;
      if (useSubledger && numAmount > openEarnings + 0.001) {
        throw fail(
          "Requested settlement exceeds recorded distributor earning documents. Reconcile legacy delivery earnings before payout.",
          409,
          "LEGACY_EARNINGS_RECONCILIATION_REQUIRED",
        );
      }
      const openSourceIds = new Set(earningDocuments.map((document) => document.sourceId));
      const settlementLineItems = statement.transactions
        .filter((item) => ["DELIVERY", "RETURN", "EXCHANGE", "NCM_TRANSFER", "BONUS"].includes(item.type))
        .filter((item) => !item.earningId || openSourceIds.has(item.earningId));
      const statementSnapshot = {
        createdAt: new Date().toISOString(),
        vatMode: withVat ? "WITH_VAT" : "WITHOUT_VAT",
        vatIncluded: withVat,
        requestedAmount: numAmount,
        availableBalance: statement.summary.netPayableBalance,
        summary: statement.summary,
        lineItems: settlementLineItems
          .map((item) => ({
            type: item.type,
            referenceId: item.referenceId,
            date: item.date,
            description: item.description,
            earningId: item.earningId || null,
            accountingDocumentId: item.accountingDocumentId || null,
            assignmentId: item.assignmentId || null,
            quantity: item.type === "DELIVERY" ? 1 : undefined,
            deliveryCharge: item.type === "DELIVERY" ? item.grossAmount : 0,
            incentiveAmount: item.incentiveAmount || 0,
            bonusAmount: item.bonusAmount || 0,
            returnCharge: item.type === "RETURN" ? item.grossAmount : 0,
            exchangeCharge: item.type === "EXCHANGE" ? item.grossAmount : 0,
            ncmTransferCharge: item.type === "NCM_TRANSFER" ? item.grossAmount : 0,
            commissionDeduction: item.discountChargeAmount || 0,
            netAmount: item.netAmount,
            eligibleDeliveryCount: item.eligibleDeliveryCount,
            tiers: item.earnedTiers || undefined,
            rateCardId: item.rateCardId || null,
            isRateSnapshotted: item.isRateSnapshotted ?? false,
          })),
      };
      if (useSubledger) {
        await tx.distributorSettlementRequest.update({
          where: { id: created.id },
          data: {
            metadata: {
              settlementBasis: "ACCOUNTING_SUBLEDGER",
              earningDocumentIds: earningDocuments.map((document) => document.id),
              statementSnapshot,
            },
          },
        });
      } else {
        await tx.distributorSettlementRequest.update({
          where: { id: created.id },
          data: {
            metadata: {
              settlementBasis: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED",
              statementSnapshot,
            },
          },
        });
      }
      return {
        ...created,
        metadata: useSubledger
          ? {
              settlementBasis: "ACCOUNTING_SUBLEDGER",
              earningDocumentIds: earningDocuments.map((document) => document.id),
              statementSnapshot,
            }
          : { settlementBasis: "LEGACY_EARNINGS_RECONCILIATION_REQUIRED", statementSnapshot },
      };
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const racedRequest = await client.distributorSettlementRequest.findFirst({
      where: { idempotencyKey: key },
    });
    if (!racedRequest) throw error;
    if (racedRequest.distributorId !== distributorId || Number(racedRequest.amount) !== numAmount) {
      throw fail("This idempotency key was already used for a different settlement request.", 409, "IDEMPOTENCY_KEY_REUSED");
    }
    return {
      success: true,
      message: "Settlement request already submitted.",
      settlementRequest: racedRequest,
      isReplay: true,
    };
  }

  return {
    success: true,
    message: settlementRequest.isReplay
      ? "Settlement request already submitted."
      : settlementRequest.metadata?.settlementBasis === "LEGACY_EARNINGS_RECONCILIATION_REQUIRED"
        ? "Settlement request recorded, but Admin payment is blocked until historical earnings are reconciled to accounting documents."
        : "Settlement request submitted successfully to Admin.",
    settlementRequest,
    ...(settlementRequest.isReplay ? { isReplay: true } : {}),
  };
};

export const resolveDistributorSettlementReconciliation = async ({
  settlementId,
  decision,
  earningDocumentIds = [],
  reviewNotes,
  reviewerAccountId,
  writeAudit = recordSystemAudit,
  backfillBonuses = accrueClosedDistributorBonuses,
  backfillDeliveryEarning = accrueDistributorDeliveryEarning,
  backfillServiceCharge = accrueDistributorServiceCharge,
  client = prisma,
} = {}) => {
  if (typeof settlementId !== "string" || !settlementId.trim() || settlementId.length > 191) {
    throw fail("A valid settlement request ID is required.", 400, "INVALID_SETTLEMENT_ID");
  }
  const normalizedDecision = String(decision || "").trim().toUpperCase();
  if (!["RECONCILE", "REJECT", "BACKFILL"].includes(normalizedDecision)) {
    throw fail("Decision must be RECONCILE, REJECT, or BACKFILL.", 400, "INVALID_RECONCILIATION_DECISION");
  }
  const normalizedNotes = validateOptionalText(reviewNotes, "Review notes", 1000);
  if (!normalizedNotes) {
    throw fail("Review notes are required to resolve a legacy settlement request.", 400, "REVIEW_NOTES_REQUIRED");
  }
  if (
    normalizedDecision === "RECONCILE" &&
    (!Array.isArray(earningDocumentIds) ||
      earningDocumentIds.length === 0 ||
      earningDocumentIds.length > 100 ||
      earningDocumentIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 191) ||
      new Set(earningDocumentIds).size !== earningDocumentIds.length)
  ) {
    throw fail("Select one or more unique earning document IDs to reconcile this request.", 400, "INVALID_EARNING_DOCUMENTS");
  }

  return client.$transaction(async (tx) => {
    const request = await tx.distributorSettlementRequest.findUnique({
      where: { id: settlementId },
      include: { distributor: { select: { id: true, name: true } } },
    });
    if (!request) throw fail("Distributor settlement request not found.", 404, "SETTLEMENT_NOT_FOUND");
    if (
      request.status !== "PENDING" ||
      new Prisma.Decimal(String(request.paidAmount || 0)).greaterThan(0) ||
      request.metadata?.settlementBasis !== "LEGACY_EARNINGS_RECONCILIATION_REQUIRED"
    ) {
      throw fail("Only unpaid legacy reconciliation requests can be resolved.", 409, "SETTLEMENT_NOT_RECONCILABLE");
    }

    let updatedMetadata = parseJSON(request.metadata, {});
    let verifiedDocuments = [];
    let backfilledLineItems = [];
    if (normalizedDecision === "BACKFILL") {
      const distributor = request.distributor || await tx.distributor.findUnique({
        where: { id: request.distributorId },
        select: { id: true, name: true },
      });
      if (!distributor) throw fail("Distributor profile not found.", 404, "DISTRIBUTOR_NOT_FOUND");
      await backfillBonuses({
        distributorId: request.distributorId,
        distributorName: distributor.name,
        client: tx,
      });
      await accrueUnrecordedDeliveryEarnings({
        distributorId: request.distributorId,
        distributorName: distributor.name,
        client: tx,
        accrueDelivery: backfillDeliveryEarning,
      });
      await accrueUnrecordedReturnCharges({
        distributorId: request.distributorId,
        distributorName: distributor.name,
        client: tx,
        accrueServiceCharge: backfillServiceCharge,
      });

      const lineItems = Array.isArray(updatedMetadata.statementSnapshot?.lineItems)
        ? updatedMetadata.statementSnapshot.lineItems
        : [];
      const orderIds = [...new Set(lineItems
        .filter((item) => ["DELIVERY", "RETURN"].includes(item.type) && !item.earningId)
        .map((item) => item.referenceId)
        .filter(Boolean))];
      const earnings = orderIds.length
        ? await tx.distributorServiceEarning.findMany({
            where: {
              distributorId: request.distributorId,
              orderId: { in: orderIds },
              serviceType: { in: ["DELIVERY", "RETURN"] },
            },
            select: {
              id: true,
              orderId: true,
              assignmentId: true,
              serviceType: true,
              accountingDocumentId: true,
            },
          })
        : [];
      const earningsByKey = new Map(
        earnings.map((earning) => [`${earning.serviceType}:${earning.orderId}`, earning]),
      );
      backfilledLineItems = lineItems.map((item) => {
        if (item.earningId || !["DELIVERY", "RETURN"].includes(item.type)) return item;
        const earning = earningsByKey.get(`${item.type}:${item.referenceId}`);
        return earning
          ? {
              ...item,
              earningId: earning.id,
              accountingDocumentId: earning.accountingDocumentId || null,
              assignmentId: earning.assignmentId,
              isRateSnapshotted: true,
            }
          : item;
      });
      const linkedEarningCount = backfilledLineItems.filter(
        (item, index) => !lineItems[index].earningId && item.earningId,
      ).length;
      if (linkedEarningCount === 0) {
        throw fail(
          "No missing delivery or return earnings could be verified from completed distributor assignments.",
          409,
          "NO_VERIFIED_EARNINGS_TO_BACKFILL",
        );
      }
      updatedMetadata = {
        ...updatedMetadata,
        statementSnapshot: {
          ...updatedMetadata.statementSnapshot,
          lineItems: backfilledLineItems,
        },
        earningsBackfilledAt: new Date().toISOString(),
        earningsBackfilledBy: reviewerAccountId || null,
      };
    } else if (normalizedDecision === "RECONCILE") {
      verifiedDocuments = await tx.accountingDocument.findMany({
        where: {
          id: { in: earningDocumentIds },
          side: "PAYABLE",
          sourceType: { in: ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"] },
          status: { in: ["OPEN", "PARTIALLY_PAID"] },
          party: { partyType: "DISTRIBUTOR", sourceEntityId: request.distributorId },
        },
        select: { id: true, sourceId: true, remainingAmount: true },
      });
      if (verifiedDocuments.length !== earningDocumentIds.length) {
        throw fail("One or more selected documents are not open earning documents for this distributor.", 409, "EARNING_DOCUMENTS_NOT_VERIFIED");
      }

      const competingRequests = await tx.distributorSettlementRequest.findMany({
        where: {
          distributorId: request.distributorId,
          status: { in: ["PENDING", "PARTIALLY_PAID"] },
        },
        select: { id: true, metadata: true },
      });
      const reservedDocumentIds = new Set(
        competingRequests
          .filter((other) => other.id !== request.id)
          .flatMap((other) => {
            const metadata = parseJSON(other.metadata, {});
            return Array.isArray(metadata.earningDocumentIds) ? metadata.earningDocumentIds : [];
          })
      );
      if (verifiedDocuments.some((document) => reservedDocumentIds.has(document.id))) {
        throw fail("A selected earning document is already reserved by another open settlement request.", 409, "EARNING_DOCUMENT_ALREADY_RESERVED");
      }

      const eligibleSnapshotEarningIds = new Set(
        (Array.isArray(updatedMetadata.statementSnapshot?.lineItems)
          ? updatedMetadata.statementSnapshot.lineItems
          : [])
          .map((item) => item.earningId)
          .filter(Boolean)
      );
      if (
        eligibleSnapshotEarningIds.size > 0 &&
        verifiedDocuments.some((document) => !eligibleSnapshotEarningIds.has(document.sourceId))
      ) {
        throw fail("Selected earning documents do not match the settlement request's recorded statement.", 409, "EARNING_DOCUMENT_SNAPSHOT_MISMATCH");
      }

      const verifiedBalance = verifiedDocuments.reduce(
        (sum, document) => sum.plus(new Prisma.Decimal(String(document.remainingAmount))),
        new Prisma.Decimal(0)
      );
      if (new Prisma.Decimal(String(request.amount)).greaterThan(verifiedBalance)) {
        throw fail("Verified earning documents do not cover the requested settlement amount.", 409, "INSUFFICIENT_VERIFIED_EARNINGS");
      }
      updatedMetadata = {
        ...updatedMetadata,
        settlementBasis: "ACCOUNTING_SUBLEDGER",
        earningDocumentIds: verifiedDocuments.map((document) => document.id),
        reconciledAt: new Date().toISOString(),
        reconciledBy: reviewerAccountId || null,
        reconciliationNotes: normalizedNotes,
      };
    }

    const claim = await tx.distributorSettlementRequest.updateMany({
      where: {
        id: request.id,
        status: "PENDING",
        paidAmount: request.paidAmount,
      },
      data: normalizedDecision === "RECONCILE"
        ? { metadata: updatedMetadata, adminNotes: normalizedNotes, reviewedBy: reviewerAccountId || null }
        : normalizedDecision === "BACKFILL"
          ? { metadata: updatedMetadata, adminNotes: normalizedNotes, reviewedBy: reviewerAccountId || null }
          : { status: "REJECTED", metadata: { ...updatedMetadata, rejectedAt: new Date().toISOString(), rejectedBy: reviewerAccountId || null, rejectionNotes: normalizedNotes }, adminNotes: normalizedNotes, reviewedBy: reviewerAccountId || null },
    });
    if (claim.count !== 1) {
      throw fail("Settlement request changed while reconciliation was being recorded. Refresh and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
    }

    await writeAudit(
      { actorId: reviewerAccountId || null, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: normalizedDecision === "RECONCILE"
          ? "DISTRIBUTOR_SETTLEMENT_RECONCILIATION_RESOLVED"
          : normalizedDecision === "BACKFILL"
            ? "DISTRIBUTOR_SETTLEMENT_EARNINGS_BACKFILLED"
            : "DISTRIBUTOR_SETTLEMENT_RECONCILIATION_REJECTED",
        entityType: "DistributorSettlementRequest",
        entityId: request.id,
        beforeState: { status: request.status, settlementBasis: request.metadata?.settlementBasis },
        afterState: {
          status: normalizedDecision === "REJECT" ? "REJECTED" : request.status,
          settlementBasis: normalizedDecision === "RECONCILE" ? "ACCOUNTING_SUBLEDGER" : request.metadata?.settlementBasis,
          earningDocumentIds: normalizedDecision === "BACKFILL"
            ? [...new Set(backfilledLineItems.map((item) => item.accountingDocumentId).filter(Boolean))]
            : verifiedDocuments.map((document) => document.id),
          reviewNotes: normalizedNotes,
        },
      },
      { client: tx },
    );

    return {
      success: true,
      decision: normalizedDecision,
      message: normalizedDecision === "RECONCILE"
        ? "Verified earning documents linked to the settlement request."
        : normalizedDecision === "BACKFILL"
          ? "Missing earnings were created only for completed distributor delivery and return work. Review and link the resulting accounting documents before payout."
          : "Unsupported settlement request rejected with an audited reason.",
      settlementRequest: {
        ...request,
        status: normalizedDecision === "REJECT" ? "REJECTED" : request.status,
        metadata: updatedMetadata,
        adminNotes: normalizedNotes,
        reviewedBy: reviewerAccountId || null,
      },
    };
  }, { isolationLevel: "Serializable" });
};

/**
 * Admin Executes Settlement (applying commissions, bonuses, discounts, and charges)
 */
export const executeAdminDistributorSettlement = async ({
  settlementId = null,
  amount = null,
  financialAccountId = null,
  externalPaymentReference = null,
  idempotencyKey = null,
  adminNotes = null,
  adminAccountId = null,
  postPaymentAccounting = postSupplierPaymentAccounting,
  allocateAccountingPayment = allocatePaymentToDocuments,
  resolveAccountingParty = ensureAccountingParty,
  validatePayoutAccount = validateTreasuryPayoutAccount,
  loadCashPosition = getDistributorCashPosition,
  writeAudit = recordSystemAudit,
  client = prisma,
} = {}) => {
  if (typeof settlementId !== "string" || !settlementId.trim() || settlementId.length > 191) {
    throw fail("A valid settlement request ID is required.", 400, "INVALID_SETTLEMENT_ID");
  }
  if (typeof financialAccountId !== "string" || !financialAccountId.trim() || financialAccountId.length > 191) {
    throw fail("Select a valid current cash, bank, or wallet account to pay this settlement.", 400, "INVALID_FINANCIAL_ACCOUNT");
  }
  const settleAmount = parseMoney(amount, "Settlement payment amount");
  const normalizedExternalPaymentReference = requireExternalPaymentReference(externalPaymentReference);
  const normalizedNotes = validateOptionalText(adminNotes, "Admin notes", 1000);
  const normalizedKey = idempotencyKey == null ? null : validateOptionalText(idempotencyKey, "Idempotency key", 191);
  const now = new Date();

  const execute = async (tx) => {
    const targetSettlement = await tx.distributorSettlementRequest.findUnique({
      where: { id: settlementId },
      include: { distributor: true },
    });
    if (!targetSettlement) throw fail("Distributor settlement request not found.", 404);
    if (targetSettlement.metadata?.settlementBasis === "LEGACY_EARNINGS_RECONCILIATION_REQUIRED") {
      throw fail(
        "This request has no matched distributor earning documents. Reconcile and backfill the historical earnings before paying it.",
        409,
        "LEGACY_EARNINGS_RECONCILIATION_REQUIRED",
      );
    }
    if (targetSettlement.metadata?.settlementBasis === "ACCOUNTING_SUBLEDGER") {
      if (!normalizedKey) {
        throw fail("An idempotency key is required for subledger-backed distributor payouts.", 400, "IDEMPOTENCY_KEY_REQUIRED");
      }
      const paymentKey = normalizedKey;
      const existingPayment = await tx.cashTransaction.findUnique({ where: { idempotencyKey: paymentKey } });
      if (existingPayment) {
        if (existingPayment.referenceId !== settlementId ||
            Number(existingPayment.amount) !== settleAmount ||
            existingPayment.fromAccountId !== financialAccountId ||
            existingPayment.externalPaymentReference !== normalizedExternalPaymentReference) {
          throw fail("This idempotency key was already used with different payment details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return {
          success: true,
          message: "This distributor settlement payment was already recorded.",
          settlement: targetSettlement,
          payable: null,
          isReplay: true,
        };
      }
      if (targetSettlement.status === "SETTLED" || targetSettlement.status === "REJECTED") {
        throw fail("This distributor settlement request is already closed.", 409, "SETTLEMENT_NOT_PAYABLE");
      }
      const requestOutstanding = Number(targetSettlement.amount) - Number(targetSettlement.paidAmount || 0);
      if (settleAmount > requestOutstanding + 0.001) {
        throw fail("Payment amount exceeds the approved distributor settlement request balance.", 409, "SETTLEMENT_AMOUNT_EXCEEDS_PAYABLE");
      }

      const party = await resolveAccountingParty({
        partyType: "DISTRIBUTOR",
        sourceEntityId: targetSettlement.distributorId,
        displayName: targetSettlement.distributor.name,
      }, { client: tx });
      const targetDocumentIds = Array.isArray(targetSettlement.metadata.earningDocumentIds)
        ? targetSettlement.metadata.earningDocumentIds
        : [];
      const targetDocuments = targetDocumentIds.length
        ? await tx.accountingDocument.findMany({
            where: {
              id: { in: targetDocumentIds },
              partyId: party.id,
              side: "PAYABLE",
              sourceType: { in: ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"] },
              status: { in: ["OPEN", "PARTIALLY_PAID"] },
            },
          })
        : [];
      const availableDocuments = targetDocuments.reduce((sum, document) => sum + Number(document.remainingAmount), 0);
      if (availableDocuments + 0.001 < settleAmount) {
        throw fail("Recorded distributor payable documents changed or were already allocated. Refresh and reconcile before paying.", 409, "DISTRIBUTOR_PAYABLE_CHANGED");
      }

      const financialAccount = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
      });
      let accountingAccount;
      try {
        accountingAccount = await validatePayoutAccount(financialAccount, tx);
      } catch (error) {
        throw fail(error.message, error.statusCode || 409, "INVALID_TREASURY_ACCOUNT");
      }
      const cashPosition = await loadCashPosition({ distributorId: targetSettlement.distributorId, client: tx });
      const codExposureWarning = Number(cashPosition.outstandingReceivable) > 0
        ? {
            code: "UNREMITTED_COD_OUTSTANDING",
            outstandingReceivable: cashPosition.outstandingReceivable,
            pendingRemittance: cashPosition.pendingRemittance,
            availableToRemit: cashPosition.availableToRemit,
            message: "Outstanding distributor COD is tracked separately and is not netted from this service-earning payout.",
          }
        : null;
      const treasuryUpdate = await tx.financialAccount.updateMany({
        where: {
          id: financialAccount.id,
          status: "ACTIVE",
          currentBalance: { gte: settleAmount },
        },
        data: { currentBalance: { decrement: settleAmount } },
      });
      if (treasuryUpdate.count !== 1) {
        throw fail("Treasury balance changed or is insufficient. Refresh and retry.", 409, "INSUFFICIENT_FUNDS");
      }

      await tx.cashTransaction.create({
        data: {
          idempotencyKey: paymentKey,
          amount: settleAmount,
          type: "OUTFLOW",
          fromAccountId: financialAccount.id,
          category: "SUPPLIER_PAYMENT",
          partyName: targetSettlement.distributor.name,
          referenceId: settlementId,
          externalPaymentReference: normalizedExternalPaymentReference,
          description: `Distributor settlement payout for ${targetSettlement.distributor.name}`,
        },
      });
      const paymentJournal = await postPaymentAccounting({
        payableId: settlementId,
        payeeName: targetSettlement.distributor.name,
        amount: settleAmount,
        settlementAmount: settleAmount,
        cashAccountId: accountingAccount.id,
        fromAccountType: financialAccount.accountType === "CASH" ? "CASH" : "BANK",
        payableAccountCode: "2190",
        accountingPartyId: party.id,
        idempotencyKey: paymentKey,
        referenceNumber: `DIST-PAY-${settlementId.slice(-8)}`,
        client: tx,
      });
      if (!paymentJournal?.id) {
        throw fail("Distributor payment journal could not be posted.", 500, "DISTRIBUTOR_PAYMENT_ACCOUNTING_FAILED");
      }
      const allocation = await allocateAccountingPayment({
        partyId: party.id,
        side: "PAYABLE",
        amount: settleAmount,
        journalEntryId: paymentJournal.id,
        targetDocumentIds,
        sourceTypes: ["DISTRIBUTOR_SERVICE_EARNING", "DISTRIBUTOR_TARGET_BONUS"],
        idempotencyKey: paymentKey,
        notes: normalizedNotes || `Admin settlement payout ${settlementId}`,
      }, { client: tx });
      if (Number(allocation.unallocatedAmount) > 0) {
        throw fail("Payout could not be fully allocated to distributor earning documents.", 409, "DISTRIBUTOR_PAYMENT_ALLOCATION_INCOMPLETE");
      }

      const paidToDate = Number((Number(targetSettlement.paidAmount || 0) + settleAmount).toFixed(2));
      const settlementIsFullyPaid = paidToDate + 0.001 >= Number(targetSettlement.amount);
      const claim = await tx.distributorSettlementRequest.updateMany({
        where: {
          id: settlementId,
          status: targetSettlement.status,
          paidAmount: targetSettlement.paidAmount,
        },
        data: {
          paidAmount: paidToDate,
          status: settlementIsFullyPaid ? "SETTLED" : "PARTIALLY_PAID",
          adminNotes: normalizedNotes || targetSettlement.adminNotes,
          reviewedBy: adminAccountId,
          financialAccountId,
          externalPaymentReference: normalizedExternalPaymentReference,
          settledAt: settlementIsFullyPaid ? now : targetSettlement.settledAt,
        },
      });
      if (claim.count !== 1) {
        throw fail("Distributor settlement changed while paying. Refresh and retry.", 409, "SETTLEMENT_CONCURRENCY_CONFLICT");
      }
      const finalizedSettlement = await tx.distributorSettlementRequest.findUnique({
        where: { id: settlementId },
        include: { distributor: { select: { id: true, name: true, city: true, phone: true } } },
      });
      await writeAudit(
        { actorId: adminAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: "DISTRIBUTOR_SETTLEMENT_EXECUTED",
          entityType: "DistributorSettlementRequest",
          entityId: settlementId,
          beforeState: { status: targetSettlement.status, paidAmount: Number(targetSettlement.paidAmount || 0) },
          afterState: {
            status: finalizedSettlement.status,
            amount: settleAmount,
            paidAmount: paidToDate,
            distributorId: targetSettlement.distributorId,
            financialAccountId,
            externalPaymentReference: normalizedExternalPaymentReference,
            accountingDocumentIds: allocation.allocations.map((item) => item.documentId),
            codExposureWarning,
          },
        },
        { client: tx },
      );
      return {
        success: true,
        message: codExposureWarning
          ? `Distributor settlement payment of Rs. ${settleAmount.toLocaleString()} recorded from ${financialAccount.accountName}. Outstanding COD exposure remains separate and was not netted.`
          : `Distributor settlement payment of Rs. ${settleAmount.toLocaleString()} recorded from ${financialAccount.accountName}.`,
        codExposureWarning,
        requiresCodRemittanceReview: Boolean(codExposureWarning),
        settlement: finalizedSettlement,
        payable: { amount: targetSettlement.amount, paidAmount: paidToDate, remainingBalance: requestOutstanding - settleAmount },
      };
    }

    const payableId = targetSettlement.metadata?.accountPayableId;
    let payable = payableId
      ? await tx.accountPayable.findUnique({ where: { id: payableId } })
      : await tx.accountPayable.findFirst({
          where: { referenceType: "DISTRIBUTOR_SETTLEMENT", referenceId: targetSettlement.id },
        });
    if (!payable) throw fail("The linked Accounts Payable record is missing.", 409, "DISTRIBUTOR_PAYABLE_NOT_FOUND");
    if (
      payable.referenceType !== "DISTRIBUTOR_SETTLEMENT" ||
      payable.referenceId !== targetSettlement.id ||
      Number(payable.totalAmount) !== Number(targetSettlement.amount)
    ) {
      throw fail("The linked Accounts Payable does not match this settlement request.", 409, "DISTRIBUTOR_PAYABLE_MISMATCH");
    }
    if (normalizedKey) {
      const existingPayment = await tx.cashTransaction.findUnique({
        where: { idempotencyKey: normalizedKey },
      });
      if (existingPayment) {
        if (existingPayment.referenceId !== payable.id) {
          throw fail("This idempotency key is already associated with a different payment.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        if (
          Number(existingPayment.amount) !== settleAmount ||
          existingPayment.fromAccountId !== financialAccountId ||
          existingPayment.externalPaymentReference !== normalizedExternalPaymentReference
        ) {
          throw fail("This idempotency key was already used with different payment details.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return {
          success: true,
          message: "This distributor settlement payment was already recorded.",
          settlement: targetSettlement,
          payable,
          isReplay: true,
        };
      }
    }
    if (targetSettlement.status === "SETTLED" || targetSettlement.status === "REJECTED") {
      throw fail("This distributor settlement request is already closed.", 409, "SETTLEMENT_NOT_PAYABLE");
    }
    if (settleAmount > Number(payable.remainingBalance) + 0.001) {
      throw fail("Payment amount exceeds the distributor settlement payable balance.", 409, "SETTLEMENT_AMOUNT_EXCEEDS_PAYABLE");
    }

    const financialAccount = await tx.financialAccount.findUnique({
      where: { id: financialAccountId },
    });
    let accountingAccount;
    try {
      accountingAccount = await validatePayoutAccount(financialAccount, tx);
    } catch (error) {
      throw fail(error.message, error.statusCode || 409, "INVALID_TREASURY_ACCOUNT");
    }
    const cashPosition = await loadCashPosition({ distributorId: targetSettlement.distributorId, client: tx });
    const codExposureWarning = Number(cashPosition.outstandingReceivable) > 0
      ? {
          code: "UNREMITTED_COD_OUTSTANDING",
          outstandingReceivable: cashPosition.outstandingReceivable,
          pendingRemittance: cashPosition.pendingRemittance,
          availableToRemit: cashPosition.availableToRemit,
          message: "Outstanding distributor COD is tracked separately and is not netted from this service-earning payout.",
        }
      : null;
    if (Number(financialAccount.currentBalance) < settleAmount) {
      throw fail(
        `Insufficient balance in ${financialAccount.accountName} (Balance: Rs. ${Number(financialAccount.currentBalance).toFixed(2)}) to pay Rs. ${settleAmount.toFixed(2)}.`,
        409,
        "INSUFFICIENT_FUNDS",
      );
    }

    const newPaidAmount = Number((Number(payable.paidAmount) + settleAmount).toFixed(2));
    const newRemainingBalance = Number(Math.max(0, Number(payable.remainingBalance) - settleAmount).toFixed(2));
    const isFullyPaid = newRemainingBalance <= 0.001;
    let history = parseJSON(payable.settlementHistory);
    const historyEntry = {
      id: crypto.randomUUID(),
      idempotencyKey: normalizedKey || `DISTRIBUTOR_SETTLEMENT_PAYMENT:${settlementId}:${newPaidAmount.toFixed(2)}`,
      date: now.toISOString(),
      amount: settleAmount,
      settlementAmount: settleAmount,
      fromAccountId: financialAccount.id,
      accountName: financialAccount.accountName,
      externalPaymentReference: normalizedExternalPaymentReference,
      notes: normalizedNotes || "Distributor settlement payout.",
    };
    history = [...history, historyEntry];

    await tx.financialAccount.update({
      where: { id: financialAccountId },
      data: { currentBalance: { decrement: settleAmount } },
    });
    await tx.cashTransaction.create({
      data: {
        idempotencyKey: historyEntry.idempotencyKey,
        amount: settleAmount,
        type: "OUTFLOW",
        fromAccountId: financialAccountId,
        category: "SUPPLIER_PAYMENT",
        partyName: targetSettlement.distributor.name,
        referenceId: payable.id,
        externalPaymentReference: normalizedExternalPaymentReference,
        description: `Distributor settlement payout for ${targetSettlement.distributor.name}`,
      },
    });
    await tx.accountPayable.update({
      where: { id: payable.id },
      data: {
        paidAmount: newPaidAmount,
        remainingBalance: newRemainingBalance,
        status: isFullyPaid ? "SETTLED" : "PARTIALLY_PAID",
        settlementHistory: history,
      },
    });
    const paidToDate = Number((Number(targetSettlement.paidAmount || 0) + settleAmount).toFixed(2));
    const settlementIsFullyPaid = paidToDate + 0.001 >= Number(targetSettlement.amount);
    const finalizedSettlement = await tx.distributorSettlementRequest.update({
      where: { id: settlementId },
      data: {
        paidAmount: paidToDate,
        status: settlementIsFullyPaid ? "SETTLED" : "PARTIALLY_PAID",
        adminNotes: normalizedNotes || targetSettlement.adminNotes,
        reviewedBy: adminAccountId,
        financialAccountId,
        externalPaymentReference: normalizedExternalPaymentReference,
        settledAt: settlementIsFullyPaid ? now : targetSettlement.settledAt,
      },
      include: {
        distributor: { select: { id: true, name: true, city: true, phone: true } },
      },
    });
    await postPaymentAccounting({
      payableId: payable.id,
      payeeName: targetSettlement.distributor.name,
      amount: settleAmount,
      settlementAmount: settleAmount,
      cashAccountId: accountingAccount.id,
      fromAccountType: financialAccount.accountType === "CASH" ? "CASH" : "BANK",
      payableAccountCode: "2110",
      idempotencyKey: historyEntry.idempotencyKey,
      referenceNumber: `DIST-PAY-${settlementId.slice(-8)}`,
      client: tx,
    });
    await recordSystemAudit(
      { actorId: adminAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "DISTRIBUTOR_SETTLEMENT_EXECUTED",
        entityType: "DistributorSettlementRequest",
        entityId: settlementId,
        beforeState: { status: targetSettlement.status, paidAmount: Number(targetSettlement.paidAmount || 0) },
        afterState: {
          status: finalizedSettlement.status,
          amount: settleAmount,
          paidAmount: paidToDate,
          distributorId: targetSettlement.distributorId,
          financialAccountId,
          externalPaymentReference: normalizedExternalPaymentReference,
          codExposureWarning,
        },
      },
      { client: tx },
    );
    return {
      success: true,
      message: codExposureWarning
        ? `Distributor settlement payment of Rs. ${settleAmount.toLocaleString()} recorded from ${financialAccount.accountName}. Outstanding COD exposure remains separate and was not netted.`
        : `Distributor settlement payment of Rs. ${settleAmount.toLocaleString()} recorded from ${financialAccount.accountName}.`,
      codExposureWarning,
      requiresCodRemittanceReview: Boolean(codExposureWarning),
      settlement: finalizedSettlement,
      payable: { ...payable, paidAmount: newPaidAmount, remainingBalance: newRemainingBalance },
    };
  };
  return typeof client.$transaction === "function"
    ? client.$transaction(execute, { isolationLevel: "Serializable" })
    : execute(client);
};
