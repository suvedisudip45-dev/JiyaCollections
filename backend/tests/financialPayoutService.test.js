import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  confirmFinancialPayout,
  failFinancialPayout,
  initiateFinancialPayout,
} from "../services/financialPayoutService.js";

const createHarness = () => {
  const account = {
    id: "treasury-1",
    status: "ACTIVE",
    accountType: "BANK",
    currentBalance: new Prisma.Decimal("100.00"),
    reservedBalance: new Prisma.Decimal("0.00"),
  };
  const payouts = new Map();
  const tx = {
    financialAccount: {
      findUnique: async () => account,
      updateMany: async ({ where, data }) => {
        if (!(where.reservedBalance instanceof Prisma.Decimal)) {
          if (account.reservedBalance.lessThan(where.reservedBalance.gte)) return { count: 0 };
          account.reservedBalance = account.reservedBalance.minus(data.reservedBalance.decrement);
          return { count: 1 };
        }
        if (!account.currentBalance.equals(where.currentBalance) ||
            !account.reservedBalance.equals(where.reservedBalance)) return { count: 0 };
        account.reservedBalance = account.reservedBalance.plus(data.reservedBalance.increment);
        return { count: 1 };
      },
    },
    financialPayout: {
      findUnique: async ({ where }) => payouts.get(where.idempotencyKey || where.id) || null,
      create: async ({ data }) => {
        const payout = { ...data };
        payouts.set(data.idempotencyKey, payout);
        payouts.set(data.id, payout);
        return payout;
      },
      updateMany: async ({ where, data }) => {
        const payout = payouts.get(where.id);
        if (!payout || payout.status !== where.status) return { count: 0 };
        Object.assign(payout, data);
        return { count: 1 };
      },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };
  const audit = async () => {};
  return { account, client, audit };
};

test("payout initiation reserves funds without posting settlement; confirmation requires evidence", async () => {
  const { account, client, audit } = createHarness();
  const input = {
    targetType: "ACCOUNT_PAYABLE",
    targetId: "ap-1",
    amount: "20.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-1",
    initiatedByAccountId: "admin-1",
    validateTarget: async () => ({ availableAmount: "50.00" }),
    client,
    writeAudit: audit,
  };
  const started = await initiateFinancialPayout(input);
  assert.equal(started.payout.status, "INITIATED");
  assert.equal(account.reservedBalance.toFixed(2), "20.00");
  assert.equal(account.currentBalance.toFixed(2), "100.00");
  assert.equal((await initiateFinancialPayout(input)).isReplay, true);

  await assert.rejects(
    confirmFinancialPayout({
      payoutId: started.payout.id,
      confirmedByAccountId: "admin-2",
      finalizePayout: async () => ({ journalEntryId: "journal-1" }),
      client,
      writeAudit: audit,
    }),
    { code: "INVALID_PAYOUT" },
  );
  assert.equal(account.reservedBalance.toFixed(2), "20.00");

  let finalized = false;
  const settled = await confirmFinancialPayout({
    payoutId: started.payout.id,
    bankEvidenceReference: "BANK-STATEMENT-LINE-456",
    confirmedByAccountId: "admin-2",
    finalizePayout: async () => {
      assert.equal(account.reservedBalance.toFixed(2), "0.00");
      finalized = true;
      return { journalEntryId: "journal-1" };
    },
    client,
    writeAudit: audit,
  });
  assert.equal(finalized, true);
  assert.equal(settled.payout.status, "SETTLED");
  assert.equal(settled.payout.bankEvidenceReference, "BANK-STATEMENT-LINE-456");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
});

test("failed payout releases reservation and cannot later be settled", async () => {
  const { account, client, audit } = createHarness();
  const { payout } = await initiateFinancialPayout({
    targetType: "DISTRIBUTOR_SETTLEMENT",
    targetId: "dist-settlement-1",
    amount: "15.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-fail-1",
    validateTarget: async () => ({ availableAmount: "15.00" }),
    client,
    writeAudit: audit,
  });
  const failed = await failFinancialPayout({
    payoutId: payout.id,
    failureReason: "Transfer rejected by bank.",
    failedByAccountId: "admin-1",
    client,
    writeAudit: audit,
  });
  assert.equal(failed.payout.status, "FAILED");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
  await assert.rejects(
    confirmFinancialPayout({
      payoutId: payout.id,
      bankEvidenceReference: "BANK-REF",
      finalizePayout: async () => ({}),
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_NOT_INITIATED" },
  );
});

test("payout initiation prevents over-reservation and rejects idempotency-key reuse with changed details", async () => {
  const { account, client, audit } = createHarness();
  const first = await initiateFinancialPayout({
    targetType: "ACCOUNT_PAYABLE",
    targetId: "ap-1",
    amount: "85.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-reservation-1",
    validateTarget: async () => ({ availableAmount: "100.00" }),
    client,
    writeAudit: audit,
  });
  assert.equal(first.payout.status, "INITIATED");

  await assert.rejects(
    initiateFinancialPayout({
      targetType: "ACCOUNT_PAYABLE",
      targetId: "ap-2",
      amount: "20.00",
      financialAccountId: "treasury-1",
      idempotencyKey: "payout-reservation-2",
      validateTarget: async () => ({ availableAmount: "100.00" }),
      client,
      writeAudit: audit,
    }),
    { code: "INSUFFICIENT_AVAILABLE_FUNDS" },
  );
  assert.equal(account.reservedBalance.toFixed(2), "85.00");

  await assert.rejects(
    initiateFinancialPayout({
      targetType: "ACCOUNT_PAYABLE",
      targetId: "ap-1",
      amount: "80.00",
      financialAccountId: "treasury-1",
      idempotencyKey: "payout-reservation-1",
      validateTarget: async () => ({ availableAmount: "100.00" }),
      client,
      writeAudit: audit,
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );
});
