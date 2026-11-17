import "../utils/requireIntegrationDatabaseSafety.js";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import {
  failFinancialPayout,
  initiateFinancialPayout,
} from "../services/financialPayoutService.js";

test("concurrent same-key payout initiation creates one reservation and replays the winner", {
  skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1",
}, async () => {
  const timestamp = Date.now();
  const idempotencyKey = `PAYOUT-CONCURRENCY-${timestamp}`;
  const competingKeyPrefix = `PAYOUT-COMPETING-${timestamp}-`;
  const bankGlAccount = await prisma.account.findUnique({ where: { accountCode: "1120" } });
  assert.ok(bankGlAccount, "Bank GL account 1120 must exist for payout integration tests");

  const treasury = await prisma.financialAccount.create({
    data: {
      accountName: `Test Payout Concurrency Treasury ${timestamp}`,
      accountType: "BANK",
      accountingAccountId: bankGlAccount.id,
      currentBalance: 1000,
      reservedBalance: 0,
      status: "ACTIVE",
    },
  });
  const payable = await prisma.accountPayable.create({
    data: {
      title: `Test Payout Concurrency Payable ${timestamp}`,
      payeeName: "Integration Test Supplier",
      totalAmount: 100,
      paidAmount: 0,
      remainingBalance: 100,
      status: "UNPAID",
    },
  });

  let releaseValidationBarrier;
  const bothValidationsStarted = new Promise((resolve) => {
    releaseValidationBarrier = resolve;
  });
  let validationCount = 0;

  const requestPayout = () => initiateFinancialPayout({
    targetType: "ACCOUNT_PAYABLE",
    targetId: payable.id,
    amount: "75.00",
    financialAccountId: treasury.id,
    idempotencyKey,
    initiatedByAccountId: "integration-test",
    validateTarget: async (tx) => {
      const currentPayable = await tx.accountPayable.findUnique({ where: { id: payable.id } });
      const pending = await tx.financialPayout.aggregate({
        where: { targetType: "ACCOUNT_PAYABLE", targetId: payable.id, status: "INITIATED" },
        _sum: { settlementAmount: true },
      });
      const availableAmount = Number(currentPayable.remainingBalance) - Number(pending._sum.settlementAmount || 0);
      validationCount += 1;
      if (validationCount === 2) releaseValidationBarrier();
      await bothValidationsStarted;
      return { availableAmount };
    },
  });

  try {
    const settledRequests = await Promise.allSettled([requestPayout(), requestPayout()]);
    const failures = settledRequests.filter(({ status }) => status === "rejected");
    assert.equal(failures.length, 0, failures.map(({ reason }) => reason.message).join("; "));
    const results = settledRequests.map(({ value }) => value);
    assert.equal(validationCount, 2);
    assert.equal(results.every(({ success }) => success), true);
    assert.deepEqual(results.map(({ isReplay }) => isReplay).sort(), [false, true]);

    const payouts = await prisma.financialPayout.findMany({ where: { idempotencyKey } });
    assert.equal(payouts.length, 1);
    assert.equal(payouts[0].status, "INITIATED");
    const updatedTreasury = await prisma.financialAccount.findUnique({ where: { id: treasury.id } });
    assert.equal(Number(updatedTreasury.reservedBalance), 75);

    const competingPayables = await Promise.all(["A", "B"].map((suffix) => prisma.accountPayable.create({
      data: {
        title: `Test Competing Payout ${suffix} ${timestamp}`,
        payeeName: "Integration Test Supplier",
        totalAmount: 500,
        paidAmount: 0,
        remainingBalance: 500,
        status: "UNPAID",
      },
    })));
    let releaseCompetingBarrier;
    const bothCompetingValidationsStarted = new Promise((resolve) => {
      releaseCompetingBarrier = resolve;
    });
    let competingValidationCount = 0;
    const competingRequests = competingPayables.map((competingPayable, index) => initiateFinancialPayout({
      targetType: "ACCOUNT_PAYABLE",
      targetId: competingPayable.id,
      amount: "500.00",
      financialAccountId: treasury.id,
      idempotencyKey: `${competingKeyPrefix}${index}`,
      initiatedByAccountId: "integration-test",
      validateTarget: async () => {
        competingValidationCount += 1;
        if (competingValidationCount === 2) releaseCompetingBarrier();
        await bothCompetingValidationsStarted;
        return { availableAmount: "500.00" };
      },
    }));
    const competingResults = await Promise.allSettled(competingRequests);
    const competingSuccesses = competingResults.filter(({ status }) => status === "fulfilled");
    const competingFailures = competingResults.filter(({ status }) => status === "rejected");
    assert.equal(competingSuccesses.length, 1);
    assert.equal(competingFailures.length, 1);
    assert.equal(competingFailures[0].reason.code, "INSUFFICIENT_AVAILABLE_FUNDS");
    const finalTreasury = await prisma.financialAccount.findUnique({ where: { id: treasury.id } });
    assert.equal(Number(finalTreasury.reservedBalance), 575);
    assert.ok(Number(finalTreasury.reservedBalance) <= Number(finalTreasury.currentBalance));
  } finally {
    const payouts = await prisma.financialPayout.findMany({
      where: { OR: [
        { idempotencyKey },
        { idempotencyKey: { startsWith: competingKeyPrefix } },
      ] },
    });
    for (const payout of payouts) {
      if (payout.status === "INITIATED") {
        await failFinancialPayout({
          payoutId: payout.id,
          failureReason: "Release integration-test payout reservation.",
          failedByAccountId: "integration-reviewer",
        });
      }
    }
    await prisma.financialAccount.update({
      where: { id: treasury.id },
      data: { status: "INACTIVE" },
    });
  }
});
