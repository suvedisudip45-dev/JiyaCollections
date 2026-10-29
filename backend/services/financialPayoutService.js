import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";

const fail = (message, statusCode = 400, code = "INVALID_PAYOUT") =>
  Object.assign(new Error(message), { statusCode, code });

const money = (value, label) => {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(raw)) {
    throw fail(`${label} must be a positive amount with no more than two decimal places.`, 400, "INVALID_AMOUNT");
  }
  let amount;
  try {
    amount = new Prisma.Decimal(raw);
  } catch {
    throw fail(`${label} must be a valid decimal amount.`, 400, "INVALID_AMOUNT");
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw fail(`${label} must be greater than zero.`, 400, "INVALID_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const requiredText = (value, label, maxLength = 191) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw fail(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return normalized;
};

const assertReplayMatches = (existing, input) => {
  if (
    existing.targetType !== input.targetType ||
    existing.targetId !== input.targetId ||
    existing.financialAccountId !== input.financialAccountId ||
    !new Prisma.Decimal(String(existing.amount)).equals(input.amount) ||
    !new Prisma.Decimal(String(existing.settlementAmount)).equals(input.settlementAmount)
  ) {
    throw fail("This payout idempotency key was already used with different details.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
};

export const initiateFinancialPayout = async ({
  targetType,
  targetId,
  amount,
  settlementAmount = amount,
  adjustmentType = "NONE",
  adjustmentAmount = 0,
  financialAccountId,
  idempotencyKey,
  externalPaymentReference = null,
  initiatedByAccountId = null,
  notes = null,
  validateTarget,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => {
  const normalizedTargetType = requiredText(targetType, "Payout target type", 32).toUpperCase();
  if (!["MANUFACTURER_SETTLEMENT", "MANUFACTURER_PAYABLE", "DISTRIBUTOR_SETTLEMENT", "ACCOUNT_PAYABLE"].includes(normalizedTargetType)) {
    throw fail("Payout target type is not supported.");
  }
  const normalizedTargetId = requiredText(targetId, "Payout target ID");
  const normalizedAccountId = requiredText(financialAccountId, "Source Treasury account ID");
  const key = requiredText(idempotencyKey, "Payout idempotency key");
  const payoutAmount = money(amount, "Payout amount");
  const payableReduction = money(settlementAmount, "Settlement amount");
  const adjustment = adjustmentType == null ? "NONE" : String(adjustmentType).trim().toUpperCase();
  if (!["NONE", "DISCOUNT", "FINE"].includes(adjustment)) {
    throw fail("Payout adjustment type is invalid.");
  }
  let adjustmentValue = new Prisma.Decimal(0);
  if (adjustmentAmount !== undefined && adjustmentAmount !== null && String(adjustmentAmount).trim() !== "") {
    const rawAdjustment = String(adjustmentAmount).trim();
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(rawAdjustment)) {
      throw fail("Payout adjustment amount must be a valid currency value with no more than two decimal places.", 400, "INVALID_AMOUNT");
    }
    try {
      adjustmentValue = new Prisma.Decimal(rawAdjustment);
    } catch {
      throw fail("Payout adjustment amount must be a valid decimal amount.", 400, "INVALID_AMOUNT");
    }
  }
  if (!adjustmentValue.isFinite() || adjustmentValue.isNegative() ||
      (adjustment === "NONE" && !adjustmentValue.isZero()) ||
      (adjustment !== "NONE" && adjustmentValue.isZero())) {
    throw fail("Payout adjustment amount does not match the selected adjustment type.");
  }
  const expectedSettlementAmount = adjustment === "DISCOUNT"
    ? payoutAmount.plus(adjustmentValue)
    : adjustment === "FINE"
      ? payoutAmount.minus(adjustmentValue)
      : payoutAmount;
  if (expectedSettlementAmount.lessThanOrEqualTo(0) || !expectedSettlementAmount.equals(payableReduction)) {
    throw fail("Settlement amount must match the payout and approved adjustment.");
  }
  const normalizedReference = externalPaymentReference == null
    ? null
    : String(externalPaymentReference).trim().slice(0, 191) || null;
  const normalizedNotes = notes == null ? null : String(notes).trim().slice(0, 2000) || null;

  const payoutInput = {
    targetType: normalizedTargetType,
    targetId: normalizedTargetId,
    financialAccountId: normalizedAccountId,
    amount: payoutAmount,
    settlementAmount: payableReduction,
  };
  const execute = async (tx) => {
    const existing = await tx.financialPayout.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      assertReplayMatches(existing, payoutInput);
      return { success: true, payout: existing, isReplay: true };
    }

    if (typeof validateTarget !== "function") {
      throw fail("Payout target validation is required.", 500, "PAYOUT_VALIDATOR_REQUIRED");
    }
    const target = await validateTarget(tx, {
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      amount: payoutAmount,
      settlementAmount: payableReduction,
      adjustmentType: adjustment,
      adjustmentAmount: adjustmentValue,
    });
    const targetAvailable = new Prisma.Decimal(String(target?.availableAmount ?? 0));
    if (payoutAmount.greaterThan(targetAvailable) || payableReduction.greaterThan(targetAvailable)) {
      throw fail("Payout exceeds the verified outstanding payable.", 409, "PAYOUT_EXCEEDS_PAYABLE");
    }

    const account = await tx.financialAccount.findUnique({ where: { id: normalizedAccountId } });
    if (!account || account.status !== "ACTIVE" || !["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())) {
      throw fail("An active cash, bank, or wallet account is required.", 409, "INVALID_TREASURY_ACCOUNT");
    }
    const currentBalance = new Prisma.Decimal(String(account.currentBalance));
    const reservedBalance = new Prisma.Decimal(String(account.reservedBalance || 0));
    if (currentBalance.minus(reservedBalance).lessThan(payoutAmount)) {
      throw fail("Unreserved Treasury balance is insufficient for this payout.", 409, "INSUFFICIENT_AVAILABLE_FUNDS");
    }
    const reservation = await tx.financialAccount.updateMany({
      where: {
        id: account.id,
        status: "ACTIVE",
        currentBalance: account.currentBalance,
        reservedBalance: account.reservedBalance || new Prisma.Decimal(0),
      },
      data: { reservedBalance: { increment: payoutAmount } },
    });
    if (reservation.count !== 1) {
      throw fail("Treasury balance or existing reservations changed. Refresh and retry.", 409, "PAYOUT_RESERVATION_CONFLICT");
    }

    const payout = await tx.financialPayout.create({
      data: {
        id: randomUUID(),
        idempotencyKey: key,
        targetType: normalizedTargetType,
        targetId: normalizedTargetId,
        financialAccountId: account.id,
        amount: payoutAmount,
        settlementAmount: payableReduction,
        adjustmentType: adjustment,
        adjustmentAmount: adjustmentValue,
        status: "INITIATED",
        externalPaymentReference: normalizedReference,
        initiatedByAccountId,
        notes: normalizedNotes,
      },
    });
    await writeAudit(
      { actorId: initiatedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "FINANCIAL_PAYOUT_INITIATED",
        entityType: "FinancialPayout",
        entityId: payout.id,
        afterState: {
          targetType: normalizedTargetType,
          targetId: normalizedTargetId,
          amount: payoutAmount.toFixed(2),
          settlementAmount: payableReduction.toFixed(2),
          financialAccountId: account.id,
          status: payout.status,
        },
      },
      { client: tx },
    );
    return { success: true, payout, isReplay: false };
  };
  return typeof client.$transaction === "function"
    ? client.$transaction(execute, { isolationLevel: "Serializable" })
    : execute(client);
};

export const confirmFinancialPayout = async ({
  payoutId,
  bankEvidenceReference,
  confirmedByAccountId = null,
  finalizePayout,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => {
  const id = requiredText(payoutId, "Payout ID");
  const evidenceReference = requiredText(bankEvidenceReference, "Bank transfer evidence reference");
  if (typeof finalizePayout !== "function") {
    throw fail("Payout settlement handler is required.", 500, "PAYOUT_FINALIZER_REQUIRED");
  }
  const execute = async (tx) => {
    const payout = await tx.financialPayout.findUnique({ where: { id } });
    if (!payout) throw fail("Payout was not found.", 404, "PAYOUT_NOT_FOUND");
    if (payout.status !== "INITIATED") {
      throw fail("Only an initiated payout can be confirmed as settled.", 409, "PAYOUT_NOT_INITIATED");
    }
    const reservation = await tx.financialAccount.updateMany({
      where: { id: payout.financialAccountId, reservedBalance: { gte: payout.amount } },
      data: { reservedBalance: { decrement: payout.amount } },
    });
    if (reservation.count !== 1) {
      throw fail("Payout reservation is missing; settlement was rolled back.", 409, "PAYOUT_RESERVATION_MISSING");
    }
    const evidence = await finalizePayout(tx, payout);
    const settledAt = new Date();
    const updated = await tx.financialPayout.updateMany({
      where: { id: payout.id, status: "INITIATED" },
      data: {
        status: "SETTLED",
        bankEvidenceReference: evidenceReference,
        confirmedByAccountId,
        settledAt,
      },
    });
    if (updated.count !== 1) {
      throw fail("Payout state changed during confirmation; settlement was rolled back.", 409, "PAYOUT_STATE_CONFLICT");
    }
    await writeAudit(
      { actorId: confirmedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "FINANCIAL_PAYOUT_SETTLED",
        entityType: "FinancialPayout",
        entityId: payout.id,
        beforeState: { status: payout.status },
        afterState: { status: "SETTLED", bankEvidenceReference: evidenceReference },
      },
      { client: tx },
    );
    return {
      success: true,
      payout: { ...payout, status: "SETTLED", bankEvidenceReference: evidenceReference, settledAt },
      settlement: evidence,
    };
  };
  return typeof client.$transaction === "function"
    ? client.$transaction(execute, { isolationLevel: "Serializable" })
    : execute(client);
};

export const failFinancialPayout = async ({
  payoutId,
  expectedTargetType = null,
  failureReason,
  failedByAccountId = null,
  client = prisma,
  writeAudit = recordSystemAudit,
} = {}) => {
  const id = requiredText(payoutId, "Payout ID");
  const reason = requiredText(failureReason, "Payout failure reason", 2000);
  const execute = async (tx) => {
    const payout = await tx.financialPayout.findUnique({ where: { id } });
    if (!payout) throw fail("Payout was not found.", 404, "PAYOUT_NOT_FOUND");
    if (expectedTargetType && payout.targetType !== expectedTargetType) {
      throw fail("Payout target type does not match this operation.", 409, "PAYOUT_TARGET_MISMATCH");
    }
    if (payout.status !== "INITIATED") {
      throw fail("Only an initiated payout can be marked failed.", 409, "PAYOUT_NOT_INITIATED");
    }
    const reservation = await tx.financialAccount.updateMany({
      where: { id: payout.financialAccountId, reservedBalance: { gte: payout.amount } },
      data: { reservedBalance: { decrement: payout.amount } },
    });
    if (reservation.count !== 1) {
      throw fail("Payout reservation is missing; failure was not recorded.", 409, "PAYOUT_RESERVATION_MISSING");
    }
    const failedAt = new Date();
    const updated = await tx.financialPayout.updateMany({
      where: { id: payout.id, status: "INITIATED" },
      data: { status: "FAILED", failureReason: reason, failedByAccountId, failedAt },
    });
    if (updated.count !== 1) {
      throw fail("Payout state changed before failure could be recorded.", 409, "PAYOUT_STATE_CONFLICT");
    }
    await writeAudit(
      { actorId: failedByAccountId, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "FINANCIAL_PAYOUT_FAILED",
        entityType: "FinancialPayout",
        entityId: payout.id,
        beforeState: { status: payout.status },
        afterState: { status: "FAILED", failureReason: reason },
      },
      { client: tx },
    );
    return { success: true, payout: { ...payout, status: "FAILED", failureReason: reason, failedAt } };
  };
  return typeof client.$transaction === "function"
    ? client.$transaction(execute, { isolationLevel: "Serializable" })
    : execute(client);
};
