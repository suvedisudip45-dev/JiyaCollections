import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { finalizeMarketingCpaPayablePayout } from "../services/marketingCpaSettlementService.js";

const createHarness = () => {
  const state = {
    document: {
      id: "cpa-bill-1",
      documentType: "BILL",
      side: "PAYABLE",
      sourceType: "MARKETING_CPA",
      currency: "NPR",
      originalAmount: new Prisma.Decimal("100.00"),
      allocatedAmount: new Prisma.Decimal("0.00"),
      remainingAmount: new Prisma.Decimal("100.00"),
      status: "OPEN",
      documentNumber: "CPA-BILL-1",
      party: {
        partyType: "MARKETING_PARTNER",
        sourceEntityId: "partner-1",
        displayName: "Partner One",
      },
    },
    account: {
      id: "treasury-1",
      status: "ACTIVE",
      currentBalance: new Prisma.Decimal("80.00"),
    },
    cashTransactions: [],
    allocations: [],
  };
  const client = {
    accountingDocument: {
      findUnique: async () => ({ ...state.document, party: { ...state.document.party } }),
      updateMany: async ({ where, data }) => {
        if (
          state.document.id !== where.id ||
          !state.document.allocatedAmount.equals(where.allocatedAmount) ||
          !state.document.remainingAmount.equals(where.remainingAmount) ||
          state.document.status !== where.status
        ) return { count: 0 };
        Object.assign(state.document, data);
        return { count: 1 };
      },
    },
    financialAccount: {
      findUnique: async () => state.account,
      updateMany: async ({ where, data }) => {
        if (
          state.account.id !== where.id ||
          state.account.status !== where.status ||
          state.account.currentBalance.lessThan(where.currentBalance.gte)
        ) return { count: 0 };
        state.account.currentBalance = state.account.currentBalance.minus(data.currentBalance.decrement);
        return { count: 1 };
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        state.cashTransactions.push(data);
        return data;
      },
    },
    accountingAllocation: {
      create: async ({ data }) => {
        state.allocations.push(data);
        return data;
      },
    },
  };
  return { client, state };
};

const payout = (overrides = {}) => ({
  id: "payout-1",
  idempotencyKey: "payout-key-1",
  targetType: "MARKETING_CPA_PAYABLE",
  targetId: "cpa-bill-1",
  financialAccountId: "treasury-1",
  amount: new Prisma.Decimal("30.00"),
  settlementAmount: new Prisma.Decimal("30.00"),
  adjustmentType: "NONE",
  adjustmentAmount: new Prisma.Decimal("0.00"),
  externalPaymentReference: "PAYMENT-INSTRUCTION-1",
  bankEvidenceReference: "PAYMENT-EVIDENCE-1",
  ...overrides,
});

test("finalizes only evidenced cash, allocates the bill, and preserves a partial outstanding balance", async () => {
  const { client, state } = createHarness();
  const journalCalls = [];
  const audits = [];

  const result = await finalizeMarketingCpaPayablePayout({
    client,
    payout: payout(),
    actorId: "admin-1",
    validateTreasury: async (account) => ({ id: "gl-bank-1", account }),
    postAccounting: async (input) => {
      journalCalls.push(input);
      return { id: "journal-1" };
    },
    writeAudit: async (_actor, event) => audits.push(event),
  });

  assert.equal(result.status, "PARTIALLY_PAID");
  assert.equal(result.remainingAmount.toFixed(2), "70.00");
  assert.equal(state.document.allocatedAmount.toFixed(2), "30.00");
  assert.equal(state.document.remainingAmount.toFixed(2), "70.00");
  assert.equal(state.account.currentBalance.toFixed(2), "50.00");
  assert.equal(state.cashTransactions[0].category, "MARKETING_CPA_PAYOUT");
  assert.equal(state.cashTransactions[0].externalPaymentReference, "PAYMENT-INSTRUCTION-1");
  assert.equal(state.allocations[0].allocationType, "CASH");
  assert.equal(state.allocations[0].amount.toFixed(2), "30.00");
  assert.equal(state.allocations[0].journalEntryId, "journal-1");
  assert.equal(journalCalls[0].cashAccountId, "gl-bank-1");
  assert.equal(journalCalls[0].document.id, "cpa-bill-1");
  assert.equal(audits[0].action, "MARKETING_CPA_PAYABLE_PAYOUT_SETTLED");
});

test("rejects unsupported documents, adjustments, and missing evidence before changing balances", async () => {
  const cases = [
    { payout: payout({ targetType: "ACCOUNT_PAYABLE" }), code: "MARKETING_CPA_SETTLEMENT_INVALID" },
    { payout: payout({ adjustmentType: "FINE", adjustmentAmount: "1.00" }), code: "CPA_ADJUSTMENT_UNSUPPORTED" },
    { payout: payout({ bankEvidenceReference: null }), code: "PAYOUT_EVIDENCE_REQUIRED" },
  ];

  for (const { payout: request, code } of cases) {
    const { client, state } = createHarness();
    await assert.rejects(
      finalizeMarketingCpaPayablePayout({
        client,
        payout: request,
        validateTreasury: async () => ({ id: "gl-bank-1" }),
        postAccounting: async () => ({ id: "journal-1" }),
        writeAudit: async () => {},
      }),
      { code },
    );
    assert.equal(state.document.remainingAmount.toFixed(2), "100.00");
    assert.equal(state.account.currentBalance.toFixed(2), "80.00");
    assert.equal(state.cashTransactions.length, 0);
    assert.equal(state.allocations.length, 0);
  }
});

test("rejects a cash amount above the current bill balance", async () => {
  const { client, state } = createHarness();
  await assert.rejects(
    finalizeMarketingCpaPayablePayout({
      client,
      payout: payout({ amount: "101.00", settlementAmount: "101.00" }),
      validateTreasury: async () => ({ id: "gl-bank-1" }),
      postAccounting: async () => ({ id: "journal-1" }),
      writeAudit: async () => {},
    }),
    { code: "SETTLEMENT_AMOUNT_EXCEEDS_PAYABLE" },
  );
  assert.equal(state.document.remainingAmount.toFixed(2), "100.00");
  assert.equal(state.account.currentBalance.toFixed(2), "80.00");
});
