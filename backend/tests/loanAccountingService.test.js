import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  recordLoanDisbursement,
  recordLoanRepayment,
} from "../services/loanAccountingService.js";

const cloneState = (state) => structuredClone(state);

const createHarness = () => {
  const state = {
    accounts: [{
      id: "treasury-bank",
      accountType: "BANK",
      status: "ACTIVE",
      currency: "NPR",
      accountingAccountId: "gl-bank",
      currentBalance: 1000,
      reservedBalance: 100,
    }],
    liabilities: {},
    cashTransactions: {},
    nextLiabilityId: 1,
  };

  const makeClient = (target) => ({
    financialAccount: {
      findUnique: async ({ where }) => target.accounts.find((account) => account.id === where.id) || null,
      updateMany: async ({ where, data }) => {
        const account = target.accounts.find((entry) => entry.id === where.id);
        if (!account || account.status !== where.status || account.currency !== where.currency) return { count: 0 };
        if (where.currentBalance !== undefined && !new Prisma.Decimal(String(account.currentBalance)).equals(String(where.currentBalance))) {
          return { count: 0 };
        }
        if (where.reservedBalance !== undefined && !new Prisma.Decimal(String(account.reservedBalance)).equals(String(where.reservedBalance))) {
          return { count: 0 };
        }
        if (data.currentBalance.increment !== undefined) {
          account.currentBalance = Number(new Prisma.Decimal(String(account.currentBalance)).plus(data.currentBalance.increment));
        } else {
          account.currentBalance = Number(new Prisma.Decimal(String(account.currentBalance)).minus(data.currentBalance.decrement));
        }
        return { count: 1 };
      },
    },
    investorLiability: {
      create: async ({ data }) => {
        const record = { id: `loan-${target.nextLiabilityId++}`, ...data };
        target.liabilities[record.id] = record;
        return record;
      },
      findUnique: async ({ where }) => target.liabilities[where.id] || null,
      updateMany: async ({ where, data }) => {
        const record = target.liabilities[where.id];
        if (
          !record ||
          record.status !== where.status ||
          !new Prisma.Decimal(String(record.outstandingBalance)).equals(String(where.outstandingBalance))
        ) return { count: 0 };
        target.liabilities[where.id] = { ...record, ...data };
        return { count: 1 };
      },
    },
    cashTransaction: {
      findUnique: async ({ where }) => target.cashTransactions[where.idempotencyKey] || null,
      create: async ({ data }) => {
        if (target.cashTransactions[data.idempotencyKey]) {
          throw Object.assign(new Error("Unique idempotency key"), { code: "P2002" });
        }
        const record = { id: `cash-${Object.keys(target.cashTransactions).length + 1}`, ...data };
        target.cashTransactions[data.idempotencyKey] = record;
        return record;
      },
    },
    $transaction: async (operation) => {
      const workingState = cloneState(target);
      const result = await operation(makeClient(workingState));
      Object.assign(target, workingState);
      return result;
    },
  });

  const validateTreasury = async (account) => {
    if (!account || account.status !== "ACTIVE" || account.currency !== "NPR") {
      throw Object.assign(new Error("Invalid Treasury account"), { statusCode: 409 });
    }
    return { accountCode: account.accountType === "CASH" ? "1110" : account.accountType === "WALLET" ? "1180" : "1120" };
  };

  return { state, client: makeClient(state), validateTreasury };
};

const loanData = {
  investorName: "Example Bank",
  type: "LONG_TERM_LOAN",
  loanType: "TERM_LOAN",
  principalAmount: 500,
  principalPaid: 0,
  interestPaid: 0,
  totalInterestPayable: 20,
  amountRepaid: 0,
  outstandingBalance: 500,
  interestRate: 12,
  loanTermMonths: 12,
  monthlyInstallment: 42,
  loanSchedule: [{ status: "UPCOMING", monthNumber: 1 }],
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  maturityDate: new Date("2027-10-01T00:00:00.000Z"),
  status: "ACTIVE",
};

test("loan disbursement commits liability, Treasury, cash record, and journal together", async () => {
  const harness = createHarness();
  const posted = [];
  const result = await recordLoanDisbursement({
    loanData,
    depositAccountId: "treasury-bank",
    idempotencyKey: "disbursement-001",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postDisbursement: async (record, options) => {
      posted.push({ record, options });
    },
  });

  assert.equal(result.isReplay, false);
  assert.equal(result.record.principalAmount, 500);
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1500.00");
  assert.equal(Object.keys(harness.state.liabilities).length, 1);
  assert.equal(harness.state.cashTransactions["LOAN_DISBURSEMENT:disbursement-001"].toAccountId, "treasury-bank");
  assert.equal(posted[0].options.cashAccountCode, "1120");
  assert.equal(posted[0].options.throwOnError, true);
});

test("loan disbursement rolls back all source changes when journal posting fails", async () => {
  const harness = createHarness();
  await assert.rejects(recordLoanDisbursement({
    loanData,
    depositAccountId: "treasury-bank",
    idempotencyKey: "disbursement-fail",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postDisbursement: async () => { throw new Error("GL unavailable"); },
  }), /GL unavailable/);

  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1000.00");
  assert.equal(Object.keys(harness.state.liabilities).length, 0);
  assert.equal(Object.keys(harness.state.cashTransactions).length, 0);
});

test("loan disbursement retry returns the prior record without duplicating cash", async () => {
  const harness = createHarness();
  const args = {
    loanData,
    depositAccountId: "treasury-bank",
    idempotencyKey: "disbursement-replay",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postDisbursement: async () => {},
  };
  const first = await recordLoanDisbursement(args);
  const replay = await recordLoanDisbursement(args);
  assert.equal(replay.isReplay, true);
  assert.equal(replay.record.id, first.record.id);
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1500.00");
  assert.equal(Object.keys(harness.state.liabilities).length, 1);
});

test("loan disbursement retry accepts server-defaulted dates when the caller supplied none", async () => {
  const harness = createHarness();
  const first = await recordLoanDisbursement({
    loanData,
    depositAccountId: "treasury-bank",
    idempotencyKey: "disbursement-default-date",
    verifyStartDate: false,
    verifyMaturityDate: false,
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postDisbursement: async () => {},
  });
  const replay = await recordLoanDisbursement({
    loanData: {
      ...loanData,
      startDate: new Date("2026-10-02T00:00:00.000Z"),
      maturityDate: new Date("2027-10-02T00:00:00.000Z"),
    },
    depositAccountId: "treasury-bank",
    idempotencyKey: "disbursement-default-date",
    verifyStartDate: false,
    verifyMaturityDate: false,
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postDisbursement: async () => assert.fail("A replay must not post again"),
  });

  assert.equal(replay.isReplay, true);
  assert.equal(replay.record.id, first.record.id);
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1500.00");
});

test("loan repayment requires an explicit balanced split and atomically posts the mapped outflow", async () => {
  const harness = createHarness();
  harness.state.liabilities["loan-1"] = {
    id: "loan-1",
    investorName: "Example Bank",
    principalAmount: 500,
    principalPaid: 0,
    interestPaid: 0,
    amountRepaid: 0,
    outstandingBalance: 500,
    status: "ACTIVE",
    loanSchedule: [{ status: "UPCOMING", monthNumber: 1 }],
    notes: null,
  };
  const posted = [];
  const result = await recordLoanRepayment({
    liabilityId: "loan-1",
    repaymentAmount: "110.00",
    principalPortion: "100.00",
    interestPortion: "10.00",
    fromAccountId: "treasury-bank",
    idempotencyKey: "repayment-001",
    transactionDate: new Date("2026-10-15T00:00:00.000Z"),
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postRepayment: async (params, options) => posted.push({ ...params, ...options }),
  });

  assert.equal(result.isReplay, false);
  assert.equal(result.liability.principalPaid, 100);
  assert.equal(result.liability.interestPaid, 10);
  assert.equal(result.liability.outstandingBalance, 400);
  assert.equal(result.liability.loanSchedule[0].status, "PAID");
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "890.00");
  assert.equal(harness.state.cashTransactions["LOAN_REPAYMENT:repayment-001"].amount, 110);
  assert.equal(posted[0].cashAccountCode, "1120");
  assert.equal(posted[0].idempotencyKey, "LOAN_REPAYMENT:repayment-001");
  assert.equal(posted[0].throwOnError, true);
});

test("loan repayment rolls back liability and Treasury when journal posting fails", async () => {
  const harness = createHarness();
  harness.state.liabilities["loan-1"] = {
    id: "loan-1",
    investorName: "Example Bank",
    principalAmount: 500,
    principalPaid: 0,
    interestPaid: 0,
    amountRepaid: 0,
    outstandingBalance: 500,
    status: "ACTIVE",
    loanSchedule: [],
    notes: null,
  };
  await assert.rejects(recordLoanRepayment({
    liabilityId: "loan-1",
    repaymentAmount: "110.00",
    principalPortion: "100.00",
    interestPortion: "10.00",
    fromAccountId: "treasury-bank",
    idempotencyKey: "repayment-fail",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postRepayment: async () => { throw new Error("GL unavailable"); },
  }), /GL unavailable/);

  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1000.00");
  assert.equal(harness.state.liabilities["loan-1"].outstandingBalance, 500);
  assert.equal(Object.keys(harness.state.cashTransactions).length, 0);
});

test("loan repayment rejects missing or mismatched split before changing balances", async () => {
  const harness = createHarness();
  harness.state.liabilities["loan-1"] = {
    id: "loan-1",
    investorName: "Example Bank",
    principalAmount: 500,
    principalPaid: 0,
    interestPaid: 0,
    amountRepaid: 0,
    outstandingBalance: 500,
    status: "ACTIVE",
    loanSchedule: [],
  };
  const args = {
    liabilityId: "loan-1",
    repaymentAmount: "110.00",
    fromAccountId: "treasury-bank",
    idempotencyKey: "repayment-invalid",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postRepayment: async () => assert.fail("Should not post an invalid repayment"),
  };

  await assert.rejects(recordLoanRepayment(args), { code: "LOAN_SPLIT_REQUIRED" });
  await assert.rejects(recordLoanRepayment({
    ...args,
    principalPortion: "100.00",
    interestPortion: "9.99",
  }), { code: "LOAN_SPLIT_MISMATCH" });
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "1000.00");
  assert.equal(harness.state.liabilities["loan-1"].outstandingBalance, 500);
  assert.equal(Object.keys(harness.state.cashTransactions).length, 0);
});

test("loan repayment rejects retry-key reuse with different details", async () => {
  const harness = createHarness();
  harness.state.liabilities["loan-1"] = {
    id: "loan-1",
    investorName: "Example Bank",
    principalAmount: 500,
    principalPaid: 0,
    interestPaid: 0,
    amountRepaid: 0,
    outstandingBalance: 500,
    status: "ACTIVE",
    loanSchedule: [],
  };
  const args = {
    liabilityId: "loan-1",
    repaymentAmount: "110.00",
    principalPortion: "100.00",
    interestPortion: "10.00",
    fromAccountId: "treasury-bank",
    idempotencyKey: "repayment-replay",
    client: harness.client,
    validateTreasury: harness.validateTreasury,
    postRepayment: async () => {},
  };
  await recordLoanRepayment(args);
  const replay = await recordLoanRepayment(args);
  assert.equal(replay.isReplay, true);
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "890.00");
  await assert.rejects(recordLoanRepayment({
    ...args,
    repaymentAmount: "120.00",
    principalPortion: "100.00",
    interestPortion: "20.00",
  }), { code: "IDEMPOTENCY_KEY_REUSED" });
  assert.equal(harness.state.accounts[0].currentBalance.toFixed(2), "890.00");
});
