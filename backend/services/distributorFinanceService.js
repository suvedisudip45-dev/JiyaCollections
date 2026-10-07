import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";
import { recordSystemAudit } from "./auditService.js";

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

  const distributor = await client.distributor.findUnique({
    where: { id: distributorId },
    select: { id: true, name: true, phone: true, city: true, status: true, isActive: true },
  });
  if (!distributor) throw fail("Distributor profile not found.", 404);

  // Date filters
  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  // 1. Fetch delivered assignments
  const deliveredAssignments = await client.orderAssignment.findMany({
    where: {
      distributorId,
      status: { in: ["delivered", "Delivered"] },
      ...(Object.keys(dateFilter).length ? { deliveredAt: dateFilter } : {}),
    },
    include: {
      distributor: { select: { id: true, name: true } },
    },
    orderBy: { deliveredAt: "desc" },
  });

  const deliveredOrderIds = deliveredAssignments.map((a) => a.orderId);
  const deliveredOrders = await client.order.findMany({
    where: { id: { in: deliveredOrderIds } },
  });
  const orderMap = new Map(deliveredOrders.map((o) => [o.id, o]));

  // 2. Fetch returned assignments
  const returnedAssignments = await client.orderAssignment.findMany({
    where: {
      distributorId,
      status: { in: ["returned", "Returned"] },
      ...(Object.keys(dateFilter).length ? { returnedAt: dateFilter } : {}),
    },
    orderBy: { returnedAt: "desc" },
  });

  // 3. Fetch all settlements
  const settlementRequests = await client.distributorSettlementRequest.findMany({
    where: {
      distributorId,
      ...(Object.keys(dateFilter).length ? { requestedAt: dateFilter } : {}),
    },
    orderBy: { requestedAt: "desc" },
  });

  // Calculate earnings and transactions
  const rateCard = await resolveActiveRateCard({ distributorId, client });
  const vatRate = rateCard.vatRate ?? 13;

  let grossDeliveryEarnings = 0;
  let earnedIncentives = 0;
  let adminDiscountsApplied = 0;
  let returnFeesEarned = 0;
  const itemizedTransactions = [];

  // Itemize deliveries
  for (const assignment of deliveredAssignments) {
    const order = orderMap.get(assignment.orderId);
    const deliveryCharge = rateCard.deliveryCharge;
    const bonus = rateCard.bonusRate || rateCard.incentiveRate;
    const commission = (rateCard.commissionRate > 0 && rateCard.commissionRate <= 100)
      ? (deliveryCharge * (rateCard.commissionRate / 100))
      : rateCard.commissionRate;
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
    });
  }

  // Itemize returns
  for (const assignment of returnedAssignments) {
    const returnFee = rateCard.returnCharge;
    returnFeesEarned += returnFee;

    itemizedTransactions.push({
      id: `tx-ret-${assignment.id}`,
      type: "RETURN",
      referenceId: assignment.orderId,
      date: assignment.returnedAt || assignment.assignedAt,
      description: `Customer return QA processed for Order ${assignment.orderId.slice(0, 8)}`,
      grossAmount: Number(returnFee.toFixed(2)),
      incentiveAmount: 0,
      discountChargeAmount: 0,
      netAmount: Number(returnFee.toFixed(2)),
      orderAmount: 0,
      paymentMethod: "N/A",
    });
  }

  // Itemize settlements
  let totalSettledPaid = 0;
  let pendingSettlementAmount = 0;

  for (const s of settlementRequests) {
    const amt = Number(s.amount);
    if (s.status === "SETTLED") {
      totalSettledPaid += amt;
    } else if (s.status === "PENDING") {
      pendingSettlementAmount += amt;
    }

    itemizedTransactions.push({
      id: `tx-set-${s.id}`,
      type: "SETTLEMENT",
      referenceId: s.id,
      date: s.settledAt || s.requestedAt,
      description: s.status === "SETTLED" ? "Settlement Payout Executed" : "Settlement Payout Requested (Pending)",
      grossAmount: -amt,
      incentiveAmount: 0,
      discountChargeAmount: 0,
      netAmount: -amt,
      status: s.status,
      notes: s.notes || s.adminNotes || null,
      financialAccountId: s.financialAccountId || null,
    });
  }

  // Sort transactions descending
  itemizedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Compute subtotal before VAT
  const subtotalBeforeVat = Number(
    (grossDeliveryEarnings + earnedIncentives + returnFeesEarned - adminDiscountsApplied).toFixed(2)
  );
  const vatAmount = Number((subtotalBeforeVat * (vatRate / 100)).toFixed(2));
  const totalWithVat = Number((subtotalBeforeVat + vatAmount).toFixed(2));
  const totalWithoutVat = subtotalBeforeVat;

  const currentEarnings = Boolean(withVat) ? totalWithVat : totalWithoutVat;
  const netPayableBalance = Number(Math.max(0, currentEarnings - totalSettledPaid).toFixed(2));

  return {
    success: true,
    distributor,
    rateCard,
    vatMode: Boolean(withVat) ? "WITH_VAT" : "WITHOUT_VAT",
    summary: {
      grossDeliveryEarnings: Number(grossDeliveryEarnings.toFixed(2)),
      earnedIncentives: Number(earnedIncentives.toFixed(2)),
      returnFeesEarned: Number(returnFeesEarned.toFixed(2)),
      adminDiscountsApplied: Number(adminDiscountsApplied.toFixed(2)),
      subtotalBeforeVat,
      vatRate,
      vatAmount,
      totalWithVat,
      totalWithoutVat,
      totalSettledPaid: Number(totalSettledPaid.toFixed(2)),
      pendingSettlementAmount: Number(pendingSettlementAmount.toFixed(2)),
      netPayableBalance, // Outstanding amount platform owes to distributor
      receivables: 0, // In standard operations, distributor receivables from platform
      payables: netPayableBalance, // Platform accounts payable to distributor
    },
    transactions: itemizedTransactions,
    settlementRequests,
  };
};

/**
 * Submit Settlement Request from Distributor to Admin
 */
export const submitDistributorSettlementRequest = async ({
  distributorId,
  amount,
  notes = null,
  idempotencyKey = null,
  requestedByAccountId = null,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    throw fail("Settlement amount must be a positive number.", 400);
  }

  const statement = await getDistributorFinancialStatement({ distributorId, withVat: true, client });
  const availableBalance = statement.summary.netPayableBalance;

  if (numAmount > availableBalance + 0.01) {
    throw fail(
      `Requested amount (Rs. ${numAmount.toFixed(2)}) exceeds available net balance (Rs. ${availableBalance.toFixed(2)}).`,
      409,
      "INSUFFICIENT_SETTLEMENT_BALANCE"
    );
  }

  const key = idempotencyKey || `dist-settle-req-${distributorId}-${Date.now()}`;

  const existing = await client.distributorSettlementRequest.findFirst({
    where: { idempotencyKey: key },
  });
  if (existing) {
    return {
      success: true,
      message: "Settlement request already submitted.",
      settlementRequest: existing,
      isReplay: true,
    };
  }

  const settlementRequest = await client.distributorSettlementRequest.create({
    data: {
      distributorId,
      amount: numAmount,
      grossEarnings: statement.summary.subtotalBeforeVat,
      incentives: statement.summary.earnedIncentives,
      discountsApplied: statement.summary.adminDiscountsApplied,
      vatAmount: statement.summary.vatAmount,
      netPayable: numAmount,
      status: "PENDING",
      notes: notes ? String(notes).trim() : null,
      requestedBy: requestedByAccountId,
      idempotencyKey: key,
    },
    include: {
      distributor: { select: { id: true, name: true, city: true, phone: true } },
    },
  });

  return {
    success: true,
    message: "Settlement request submitted successfully to Admin.",
    settlementRequest,
  };
};

/**
 * Admin Executes Settlement (applying commissions, bonuses, discounts, and charges)
 */
export const executeAdminDistributorSettlement = async ({
  settlementId = null,
  distributorId = null,
  amount = null,
  financialAccountId = null,
  bonusAmount = 0,
  discountsApplied = 0,
  chargesApplied = 0,
  adminNotes = null,
  adminAccountId = null,
  client = prisma,
} = {}) => {
  let targetSettlement = null;

  if (settlementId) {
    targetSettlement = await client.distributorSettlementRequest.findUnique({
      where: { id: settlementId },
      include: { distributor: true },
    });
    if (!targetSettlement) throw fail("Distributor settlement request not found.", 404);
  } else if (distributorId) {
    targetSettlement = await client.distributorSettlementRequest.findFirst({
      where: { distributorId, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
      include: { distributor: true },
    });
  }

  const targetDistributorId = targetSettlement ? targetSettlement.distributorId : distributorId;
  if (!targetDistributorId) throw fail("Distributor ID or settlement ID is required.", 400);

  const settleAmount = Number(amount !== null && amount !== undefined ? amount : (targetSettlement ? targetSettlement.amount : 0));
  if (!Number.isFinite(settleAmount) || settleAmount <= 0) {
    throw fail("Settlement execution amount must be a positive number.", 400);
  }

  const now = new Date();

  return client.$transaction(async (tx) => {
    // 1. If financialAccountId provided, deduct balance and record CashTransaction
    let financialAccount = null;
    if (financialAccountId) {
      financialAccount = await tx.financialAccount.findUnique({
        where: { id: financialAccountId },
      });
      if (!financialAccount) throw fail("Selected financial account not found.", 404);
      if (financialAccount.currentBalance < settleAmount) {
        throw fail(
          `Insufficient balance in ${financialAccount.accountName} (Balance: Rs. ${financialAccount.currentBalance.toLocaleString()}) to pay settlement of Rs. ${settleAmount.toLocaleString()}.`,
          409,
          "INSUFFICIENT_FUNDS"
        );
      }

      await tx.financialAccount.update({
        where: { id: financialAccountId },
        data: { currentBalance: { decrement: settleAmount } },
      });

      await tx.cashTransaction.create({
        data: {
          accountId: financialAccountId,
          type: "OUTFLOW",
          category: "DISTRIBUTOR_PAYOUT",
          amount: settleAmount,
          description: `Distributor settlement payout for ${targetSettlement?.distributor?.name || targetDistributorId}`,
          referenceType: "DISTRIBUTOR_SETTLEMENT",
          referenceId: targetSettlement?.id || targetDistributorId,
          date: now,
          performedBy: adminAccountId || "ADMIN",
        },
      });
    }

    // 2. Update or create DistributorSettlementRequest
    let finalizedSettlement;
    if (targetSettlement) {
      finalizedSettlement = await tx.distributorSettlementRequest.update({
        where: { id: targetSettlement.id },
        data: {
          status: "SETTLED",
          amount: settleAmount,
          incentives: Number(bonusAmount || 0),
          discountsApplied: Number(discountsApplied || 0),
          chargesApplied: Number(chargesApplied || 0),
          adminNotes: adminNotes ? String(adminNotes).trim() : null,
          reviewedBy: adminAccountId,
          financialAccountId: financialAccountId || null,
          settledAt: now,
        },
        include: {
          distributor: { select: { id: true, name: true, city: true, phone: true } },
        },
      });
    } else {
      finalizedSettlement = await tx.distributorSettlementRequest.create({
        data: {
          distributorId: targetDistributorId,
          amount: settleAmount,
          grossEarnings: settleAmount,
          incentives: Number(bonusAmount || 0),
          discountsApplied: Number(discountsApplied || 0),
          chargesApplied: Number(chargesApplied || 0),
          status: "SETTLED",
          notes: "Direct Admin Settlement Execution",
          adminNotes: adminNotes ? String(adminNotes).trim() : null,
          reviewedBy: adminAccountId,
          financialAccountId: financialAccountId || null,
          settledAt: now,
          idempotencyKey: `admin-settle-${targetDistributorId}-${Date.now()}`,
        },
        include: {
          distributor: { select: { id: true, name: true, city: true, phone: true } },
        },
      });
    }

    // 3. System Audit Log
    await recordSystemAudit(
      {
        actorId: adminAccountId,
        actorRole: "ADMIN",
        portalSource: "ADMIN",
      },
      {
        action: "DISTRIBUTOR_SETTLEMENT_EXECUTED",
        entityType: "DistributorSettlementRequest",
        entityId: finalizedSettlement.id,
        beforeState: { status: targetSettlement?.status || "NONE" },
        afterState: {
          status: "SETTLED",
          amount: settleAmount,
          distributorId: targetDistributorId,
          financialAccountId,
        },
      },
      { client: tx }
    );

    return {
      success: true,
      message: `Distributor settlement of Rs. ${settleAmount.toLocaleString()} executed successfully.`,
      settlement: finalizedSettlement,
    };
  });
};
