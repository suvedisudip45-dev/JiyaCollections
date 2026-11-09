import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import {
  postLoanDisbursementAccounting,
  postLoanRepaymentAccounting,
} from "./accountingPostingEngine.js";
import { validateTreasuryPayoutAccount } from "./treasuryAccountingService.js";

const fail = (message, statusCode = 400, code = "LOAN_ACCOUNTING_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const money = (value, label, { allowZero = false } = {}) => {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(raw)) {
    throw fail(`${label} must be a valid NPR amount with no more than two decimal places.`, 400, "INVALID_LOAN_AMOUNT");
  }
  const amount = new Prisma.Decimal(raw);
  if (!amount.isFinite() || amount.isNegative() || (!allowZero && amount.isZero())) {
    throw fail(`${label} must be ${allowZero ? "non-negative" : "positive"}.`, 400, "INVALID_LOAN_AMOUNT");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const requiredIdempotencyKey = (value) => {
  const key = String(value || "").trim();
  if (!key || key.length > 150) {
    throw fail("A valid idempotency key is required for this loan transaction.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
};

const LOAN_TYPES = new Set(["LONG_TERM_LOAN", "SHORT_TERM_BORROWING", "CREDIT_LINE"]);
const LOAN_PRODUCTS = new Set(["TERM_LOAN", "WORKING_CAPITAL", "REVOLVING_CREDIT", "PROMISSORY_NOTE"]);

const sameMoney = (left, right) =>
  new Prisma.Decimal(String(left ?? 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .equals(new Prisma.Decimal(String(right ?? 0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));

const assertDisbursementReplay = async (tx, existing, input) => {
  if (
    existing.category !== "LOAN_DISBURSEMENT" ||
    existing.type !== "INFLOW" ||
    existing.toAccountId !== input.depositAccountId ||
    !sameMoney(existing.amount, input.principal)
  ) {
    throw fail("This idempotency key was already used for a different transaction.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  const record = await tx.investorLiability.findUnique({ where: { id: existing.referenceId } });
  if (
    !record ||
    record.investorName !== input.loanData.investorName ||
    record.type !== input.loanData.type ||
    record.loanType !== input.loanData.loanType ||
    record.disbursementAccountId !== input.depositAccountId ||
    !sameMoney(record.principalAmount, input.principal) ||
    !sameMoney(record.interestRate, input.loanData.interestRate) ||
    !sameMoney(record.monthlyInstallment, input.loanData.monthlyInstallment) ||
    record.loanTermMonths !== input.loanData.loanTermMonths ||
    (input.verifyStartDate && new Date(record.startDate).getTime() !== new Date(input.loanData.startDate).getTime()) ||
    (input.verifyMaturityDate && new Date(record.maturityDate).getTime() !== new Date(input.loanData.maturityDate).getTime())
  ) {
    throw fail("This idempotency key was already used for different loan details.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  return record;
};

const findDisbursementReplay = async (client, idempotencyKey, input) => {
  const existing = await client.cashTransaction.findUnique({
    where: { idempotencyKey: `LOAN_DISBURSEMENT:${idempotencyKey}` },
  });
  if (!existing) return null;
  const record = await assertDisbursementReplay(client, existing, input);
  return { record, isReplay: true };
};

export const recordLoanDisbursement = async ({
  loanData,
  depositAccountId,
  idempotencyKey,
  verifyStartDate = true,
  verifyMaturityDate = true,
  client = prisma,
  validateTreasury = validateTreasuryPayoutAccount,
  postDisbursement = postLoanDisbursementAccounting,
} = {}) => {
  const key = requiredIdempotencyKey(idempotencyKey);
  if (!LOAN_TYPES.has(String(loanData?.type || "").toUpperCase()) ||
      !LOAN_PRODUCTS.has(String(loanData?.loanType || "").toUpperCase())) {
    throw fail("Choose a supported debt facility and loan product. Equity investments must use the share-issuance workflow.", 400, "UNSUPPORTED_DEBT_TYPE");
  }
  if (!depositAccountId) {
    throw fail("Select the Treasury account that received the loan proceeds.", 400, "LOAN_DEPOSIT_ACCOUNT_REQUIRED");
  }
  const principal = money(loanData?.principalAmount, "Loan principal");
  const input = { loanData, depositAccountId, principal, verifyStartDate, verifyMaturityDate };
  const replay = await findDisbursementReplay(client, key, input);
  if (replay) return replay;

  const transactionDate = new Date(loanData.startDate);
  if (Number.isNaN(transactionDate.getTime())) {
    throw fail("A valid loan disbursement date is required.", 400, "INVALID_LOAN_DATE");
  }

  const execute = async (tx) => {
    const account = await tx.financialAccount.findUnique({ where: { id: depositAccountId } });
    const glAccount = await validateTreasury(account, tx);
    const record = await tx.investorLiability.create({
      data: { ...loanData, principalAmount: Number(principal), disbursementAccountId: depositAccountId },
    });
    const creditResult = await tx.financialAccount.updateMany({
      where: { id: depositAccountId, status: "ACTIVE", currency: "NPR" },
      data: { currentBalance: { increment: Number(principal) } },
    });
    if (creditResult.count !== 1) {
      throw fail("The selected Treasury account is no longer active for NPR transactions.", 409, "INVALID_TREASURY_ACCOUNT");
    }

    await tx.cashTransaction.create({
      data: {
        idempotencyKey: `LOAN_DISBURSEMENT:${key}`,
        amount: Number(principal),
        date: transactionDate,
        type: "INFLOW",
        toAccountId: depositAccountId,
        category: "LOAN_DISBURSEMENT",
        partyName: record.investorName,
        referenceId: record.id,
        description: `Loan disbursement received from ${record.investorName}`,
      },
    });

    await postDisbursement(record, {
      client: tx,
      cashAccountCode: glAccount.accountCode,
      transactionDate,
      throwOnError: true,
    });
    return { record, isReplay: false };
  };

  try {
    return await client.$transaction(execute, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error.code === "P2002") {
      const concurrentReplay = await findDisbursementReplay(client, key, input);
      if (concurrentReplay) return concurrentReplay;
    }
    if (error.code === "P2034") {
      throw fail("The loan transaction conflicted with another finance update. Retry the same request.", 409, "LOAN_TRANSACTION_CONFLICT");
    }
    throw error;
  }
};

const assertRepaymentReplay = (existing, input) => {
  if (
    existing.category !== "LOAN_REPAYMENT" ||
    existing.type !== "OUTFLOW" ||
    existing.referenceId !== input.liabilityId ||
    existing.fromAccountId !== input.fromAccountId ||
    !sameMoney(existing.amount, input.amount) ||
    existing.description !== input.description
  ) {
    throw fail("This idempotency key was already used for a different repayment.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
};

const findRepaymentReplay = async (client, idempotencyKey, input) => {
  const existing = await client.cashTransaction.findUnique({
    where: { idempotencyKey: `LOAN_REPAYMENT:${idempotencyKey}` },
  });
  if (!existing) return null;
  assertRepaymentReplay(existing, input);
  const liability = await client.investorLiability.findUnique({ where: { id: input.liabilityId } });
  return { liability, isReplay: true };
};

export const recordLoanRepayment = async ({
  liabilityId,
  repaymentAmount,
  principalPortion,
  interestPortion,
  fromAccountId,
  idempotencyKey,
  notes,
  transactionDate = new Date(),
  client = prisma,
  validateTreasury = validateTreasuryPayoutAccount,
  postRepayment = postLoanRepaymentAccounting,
} = {}) => {
  const key = requiredIdempotencyKey(idempotencyKey);
  if (!liabilityId || !fromAccountId) {
    throw fail("Loan liability and mapped Treasury account are required.", 400, "LOAN_REPAYMENT_FIELDS_REQUIRED");
  }
  if (principalPortion === undefined || principalPortion === null || String(principalPortion).trim() === "" ||
      interestPortion === undefined || interestPortion === null || String(interestPortion).trim() === "") {
    throw fail("Enter the principal and interest portions explicitly before recording the repayment.", 400, "LOAN_SPLIT_REQUIRED");
  }

  const amount = money(repaymentAmount, "Repayment amount");
  const principal = money(principalPortion, "Principal portion", { allowZero: true });
  const interest = money(interestPortion, "Interest portion", { allowZero: true });
  if (!principal.plus(interest).equals(amount)) {
    throw fail("Principal and interest portions must add up exactly to the repayment amount.", 400, "LOAN_SPLIT_MISMATCH");
  }
  const date = new Date(transactionDate);
  if (Number.isNaN(date.getTime())) {
    throw fail("A valid loan repayment date is required.", 400, "INVALID_LOAN_DATE");
  }

  const description = `Loan repayment to liability ${liabilityId} (Principal: ${principal.toFixed(2)}, Interest: ${interest.toFixed(2)})`;
  const input = { liabilityId, fromAccountId, amount, description };
  const replay = await findRepaymentReplay(client, key, input);
  if (replay) return replay;

  const execute = async (tx) => {
    const liability = await tx.investorLiability.findUnique({ where: { id: liabilityId } });
    if (!liability || liability.status !== "ACTIVE") {
      throw fail("An active loan liability is required for repayment.", 404, "ACTIVE_LOAN_NOT_FOUND");
    }
    const outstanding = money(liability.outstandingBalance, "Outstanding principal");
    if (principal.greaterThan(outstanding)) {
      throw fail("Principal repayment cannot exceed the outstanding loan principal.", 409, "PRINCIPAL_EXCEEDS_OUTSTANDING");
    }
    const account = await tx.financialAccount.findUnique({ where: { id: fromAccountId } });
    const glAccount = await validateTreasury(account, tx);
    const currentBalance = new Prisma.Decimal(String(account.currentBalance || 0));
    const reservedBalance = new Prisma.Decimal(String(account.reservedBalance || 0));
    if (currentBalance.minus(reservedBalance).lessThan(amount)) {
      throw fail("Available Treasury balance is insufficient for this loan repayment.", 409, "INSUFFICIENT_TREASURY_FUNDS");
    }

    const newPrincipalPaid = money(new Prisma.Decimal(String(liability.principalPaid || 0)).plus(principal), "Principal paid", { allowZero: true });
    const newInterestPaid = money(new Prisma.Decimal(String(liability.interestPaid || 0)).plus(interest), "Interest paid", { allowZero: true });
    const newTotalRepaid = money(new Prisma.Decimal(String(liability.amountRepaid || 0)).plus(amount), "Total repaid", { allowZero: true });
    const remainingPrincipal = money(new Prisma.Decimal(String(liability.principalAmount)).minus(newPrincipalPaid), "Remaining principal", { allowZero: true });
    if (remainingPrincipal.isNegative()) {
      throw fail("Principal repayment cannot exceed the original loan principal.", 409, "PRINCIPAL_EXCEEDS_OUTSTANDING");
    }

    const updatedSchedule = Array.isArray(liability.loanSchedule) ? [...liability.loanSchedule] : [];
    const nextUpcomingIndex = updatedSchedule.findIndex((entry) => entry.status === "UPCOMING");
    if (nextUpcomingIndex !== -1) {
      updatedSchedule[nextUpcomingIndex] = {
        ...updatedSchedule[nextUpcomingIndex],
        status: "PAID",
        paidDate: date.toISOString().slice(0, 10),
        paidAmount: Number(amount),
      };
    }

    const liabilityUpdate = await tx.investorLiability.updateMany({
      where: { id: liabilityId, status: "ACTIVE", outstandingBalance: liability.outstandingBalance },
      data: {
        principalPaid: Number(newPrincipalPaid),
        interestPaid: Number(newInterestPaid),
        amountRepaid: Number(newTotalRepaid),
        outstandingBalance: Number(remainingPrincipal),
        loanSchedule: updatedSchedule,
        status: remainingPrincipal.isZero() ? "SETTLED" : "ACTIVE",
        ...(notes ? { notes: `${liability.notes || ""}\n${String(notes).trim()}`.trim() } : {}),
      },
    });
    if (liabilityUpdate.count !== 1) {
      throw fail("The loan balance changed while this repayment was being recorded. Refresh and retry.", 409, "LOAN_REPAYMENT_CONFLICT");
    }

    const accountUpdate = await tx.financialAccount.updateMany({
      where: {
        id: fromAccountId,
        status: "ACTIVE",
        currency: "NPR",
        currentBalance: account.currentBalance,
        reservedBalance: account.reservedBalance || new Prisma.Decimal(0),
      },
      data: { currentBalance: { decrement: Number(amount) } },
    });
    if (accountUpdate.count !== 1) {
      throw fail("Treasury balance or reservations changed while this repayment was being recorded. Refresh and retry.", 409, "TREASURY_BALANCE_CONFLICT");
    }

    await tx.cashTransaction.create({
      data: {
        idempotencyKey: `LOAN_REPAYMENT:${key}`,
        amount: Number(amount),
        date,
        type: "OUTFLOW",
        fromAccountId,
        category: "LOAN_REPAYMENT",
        partyName: liability.investorName,
        referenceId: liability.id,
        description,
      },
    });

    await postRepayment({
      liability,
      amount: Number(amount),
      principalPortion: Number(principal),
      interestPortion: Number(interest),
    }, {
      cashAccountCode: glAccount.accountCode,
      idempotencyKey: `LOAN_REPAYMENT:${key}`,
      transactionDate: date,
      client: tx,
      throwOnError: true,
    });
    const updated = await tx.investorLiability.findUnique({ where: { id: liabilityId } });
    return { liability: updated, isReplay: false };
  };

  try {
    return await client.$transaction(execute, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error.code === "P2002") {
      const concurrentReplay = await findRepaymentReplay(client, key, input);
      if (concurrentReplay) return concurrentReplay;
    }
    if (error.code === "P2034") {
      throw fail("The loan transaction conflicted with another finance update. Retry the same request.", 409, "LOAN_TRANSACTION_CONFLICT");
    }
    throw error;
  }
};
