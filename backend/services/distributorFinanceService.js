import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";
import { recordSystemAudit } from "./auditService.js";
import {
  postDistributorSettlementRequestAccounting,
  postSupplierPaymentAccounting,
} from "./accountingPostingEngine.js";

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
      status: { in: ["delivered", "Delivered"] },
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

  // Calculate earnings and transactions
  const rateCard = await resolveActiveRateCard({ distributorId, client });
  const vatRate = Number(rateCard.vatRate ?? 13);

  let grossDeliveryEarnings = 0;
  let earnedIncentives = 0;
  let adminDiscountsApplied = 0;
  let returnFeesEarned = 0;
  const itemizedTransactions = [];

  // Itemize deliveries
  for (const assignment of selfDeliveredAssignments) {
    const order = orderMap.get(assignment.orderId);
    const deliveryCharge = Number(rateCard.deliveryCharge || 0);
    const bonus = Number(rateCard.bonusRate ?? rateCard.incentiveRate ?? 0);
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
    });
  }

  // Itemize returns
  for (const assignment of returnedAssignments) {
    const returnFee = Number(rateCard.returnCharge || 0);
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
      discountChargeAmount: 0,
      netAmount: -paidAmount,
      status: s.status,
      requestedAmount: amt,
      paidAmount,
      outstandingAmount: remainingAmount,
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
      grossOutstandingPayableBalance,
      receivables: grossOutstandingPayableBalance,
      payables: grossOutstandingPayableBalance,
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
  postRequestAccounting = postDistributorSettlementRequestAccounting,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);

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
        if (existing.distributorId !== distributorId || Number(existing.amount) !== numAmount) {
          throw fail("This idempotency key was already used for a different settlement request.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { ...existing, isReplay: true };
      }

      const statement = await getDistributorFinancialStatement({ distributorId, withVat: true, client: tx });
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
          discountsApplied: statement.summary.adminDiscountsApplied,
          vatAmount: statement.summary.vatAmount,
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
      const payable = await tx.accountPayable.create({
        data: {
          title: `Distributor settlement request ${created.id.slice(-8)}`,
          payeeName: created.distributor.name,
          category: "DISTRIBUTOR_SETTLEMENT",
          referenceType: "DISTRIBUTOR_SETTLEMENT",
          referenceId: created.id,
          totalAmount: numAmount,
          paidAmount: 0,
          remainingBalance: numAmount,
          status: "UNPAID",
          priority: "MEDIUM",
          notes: normalizedNotes || "Distributor requested settlement.",
        },
      });
      await tx.distributorSettlementRequest.update({
        where: { id: created.id },
        data: {
          metadata: {
            accountPayableId: payable.id,
            settlementBasis: "DISTRIBUTOR_SELF_DELIVERY",
          },
        },
      });
      await postRequestAccounting({
        settlement: created,
        distributorName: created.distributor.name,
        client: tx,
      });
      return {
        ...created,
        metadata: {
          ...(created.metadata || {}),
          accountPayableId: payable.id,
          settlementBasis: "DISTRIBUTOR_SELF_DELIVERY",
        },
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
      : "Settlement request submitted successfully to Admin.",
    settlementRequest,
    ...(settlementRequest.isReplay ? { isReplay: true } : {}),
  };
};

/**
 * Admin Executes Settlement (applying commissions, bonuses, discounts, and charges)
 */
export const executeAdminDistributorSettlement = async ({
  settlementId = null,
  amount = null,
  financialAccountId = null,
  idempotencyKey = null,
  adminNotes = null,
  adminAccountId = null,
  postPaymentAccounting = postSupplierPaymentAccounting,
  client = prisma,
} = {}) => {
  if (typeof settlementId !== "string" || !settlementId.trim() || settlementId.length > 191) {
    throw fail("A valid settlement request ID is required.", 400, "INVALID_SETTLEMENT_ID");
  }
  if (typeof financialAccountId !== "string" || !financialAccountId.trim() || financialAccountId.length > 191) {
    throw fail("Select a valid current cash, bank, or wallet account to pay this settlement.", 400, "INVALID_FINANCIAL_ACCOUNT");
  }
  const settleAmount = parseMoney(amount, "Settlement payment amount");
  const normalizedNotes = validateOptionalText(adminNotes, "Admin notes", 1000);
  const normalizedKey = idempotencyKey == null ? null : validateOptionalText(idempotencyKey, "Idempotency key", 191);
  const now = new Date();

  return client.$transaction(async (tx) => {
    const targetSettlement = await tx.distributorSettlementRequest.findUnique({
      where: { id: settlementId },
      include: { distributor: true },
    });
    if (!targetSettlement) throw fail("Distributor settlement request not found.", 404);
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
          existingPayment.fromAccountId !== financialAccountId
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
      include: { accountingAccount: { select: { accountType: true, normalBalance: true } } },
    });
    if (
      !financialAccount ||
      financialAccount.status !== "ACTIVE" ||
      !["CASH", "BANK", "WALLET"].includes(String(financialAccount.accountType).toUpperCase())
    ) {
      throw fail("Selected active treasury account was not found.", 404);
    }
    if (
      financialAccount.accountingAccountId &&
      (financialAccount.accountingAccount?.accountType !== "ASSET" ||
        financialAccount.accountingAccount?.normalBalance !== "DEBIT")
    ) {
      throw fail("The selected treasury account must map to a debit-balance asset account.", 409, "INVALID_TREASURY_GL_MAPPING");
    }
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
      cashAccountId: financialAccount.accountingAccountId || null,
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
        },
      },
      { client: tx },
    );
    return {
      success: true,
      message: `Distributor settlement payment of Rs. ${settleAmount.toLocaleString()} recorded from ${financialAccount.accountName}.`,
      settlement: finalizedSettlement,
      payable: { ...payable, paidAmount: newPaidAmount, remainingBalance: newRemainingBalance },
    };
  });
};
