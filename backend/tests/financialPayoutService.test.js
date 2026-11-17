import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { payManufacturer } from "../controllers/financialController.js";
import {
  confirmFinancialPayout,
  failFinancialPayout,
  initiateFinancialPayout,
} from "../services/financialPayoutService.js";
import { createAuthorize } from "../middleware/authorize.js";

const createHarness = ({ synchronizeInitialPayoutLookups = false } = {}) => {
  const account = {
    id: "treasury-1",
    status: "ACTIVE",
    accountType: "BANK",
    currentBalance: new Prisma.Decimal("100.00"),
    reservedBalance: new Prisma.Decimal("0.00"),
  };
  const payouts = new Map();
  let initialLookupCount = 0;
  let releaseInitialLookups;
  const initialLookupsBarrier = new Promise((resolve) => {
    releaseInitialLookups = resolve;
  });
  let accountLookupCount = 0;
  let releaseAccountLookups;
  const accountLookupsBarrier = new Promise((resolve) => {
    releaseAccountLookups = resolve;
  });
  const tx = {
    financialAccount: {
      findUnique: async () => {
        const snapshot = { ...account };
        if (synchronizeInitialPayoutLookups && accountLookupCount < 2) {
          accountLookupCount += 1;
          if (accountLookupCount === 2) releaseAccountLookups();
          await accountLookupsBarrier;
        }
        return snapshot;
      },
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
      findUnique: async ({ where }) => {
        if (
          synchronizeInitialPayoutLookups &&
          where.idempotencyKey === "payout-concurrent-1" &&
          !payouts.has(where.idempotencyKey) &&
          initialLookupCount < 2
        ) {
          initialLookupCount += 1;
          if (initialLookupCount === 2) releaseInitialLookups();
          await initialLookupsBarrier;
        }
        return payouts.get(where.idempotencyKey || where.id) || null;
      },
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
  const client = {
    $transaction: async (callback) => callback(tx),
    financialPayout: tx.financialPayout,
  };
  const auditEvents = [];
  const audit = async (actor, event) => {
    auditEvents.push({ actor, event });
  };
  return { account, client, audit, auditEvents, payouts };
};

const stubMethod = (t, target, methodName, implementation) => {
  const original = target[methodName];
  target[methodName] = implementation;
  t.after(() => {
    target[methodName] = original;
  });
};

const guardRead = (t, target, methodName) => {
  let callCount = 0;
  stubMethod(t, target, methodName, async () => {
    callCount += 1;
    throw new Error(`Unexpected database read: ${methodName}`);
  });
  return () => callCount;
};

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("payout initiation reserves funds without posting settlement; confirmation requires evidence", async () => {
  const { account, client, audit, auditEvents, payouts } = createHarness();
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
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actor.actorId, "admin-1");

  let finalizerCalls = 0;
  await assert.rejects(
    confirmFinancialPayout({
      payoutId: started.payout.id,
      bankEvidenceReference: "BANK-STATEMENT-LINE-456",
      confirmedByAccountId: " admin-1 ",
      finalizePayout: async () => { finalizerCalls += 1; },
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_SELF_APPROVAL" },
  );
  assert.equal(finalizerCalls, 0);
  assert.equal(payouts.get(started.payout.id).status, "INITIATED");
  assert.equal(account.reservedBalance.toFixed(2), "20.00");
  assert.equal(auditEvents.length, 1);

  await assert.rejects(
    confirmFinancialPayout({
      payoutId: started.payout.id,
      confirmedByAccountId: "admin-2",
      finalizePayout: async () => { finalizerCalls += 1; },
      client,
      writeAudit: audit,
    }),
    { code: "INVALID_PAYOUT" },
  );
  assert.equal(finalizerCalls, 0);
  assert.equal(payouts.get(started.payout.id).status, "INITIATED");
  assert.equal(account.reservedBalance.toFixed(2), "20.00");

  let finalized = false;
  let finalizerEvidence = null;
  const settled = await confirmFinancialPayout({
    payoutId: started.payout.id,
    bankEvidenceReference: "BANK-STATEMENT-LINE-456",
    confirmedByAccountId: "admin-2",
    finalizePayout: async (_tx, payout) => {
      assert.equal(payout.amount.toFixed(2), "20.00");
      assert.equal(account.reservedBalance.toFixed(2), "0.00");
      finalizerEvidence = payout.bankEvidenceReference;
      finalized = true;
      finalizerCalls += 1;
      return { journalEntryId: "journal-1" };
    },
    client,
    writeAudit: audit,
  });
  assert.equal(finalized, true);
  assert.equal(finalizerCalls, 1);
  assert.equal(finalizerEvidence, "BANK-STATEMENT-LINE-456");
  assert.equal(settled.payout.status, "SETTLED");
  assert.equal(settled.payout.bankEvidenceReference, "BANK-STATEMENT-LINE-456");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
  assert.equal(payouts.get(started.payout.id).confirmedByAccountId, "admin-2");
  assert.deepEqual(auditEvents.map(({ actor, event }) => [actor.actorId, event.action]), [
    ["admin-1", "FINANCIAL_PAYOUT_INITIATED"],
    ["admin-2", "FINANCIAL_PAYOUT_SETTLED"],
  ]);
  await assert.rejects(
    confirmFinancialPayout({
      payoutId: started.payout.id,
      bankEvidenceReference: "BANK-STATEMENT-LINE-456",
      confirmedByAccountId: "admin-2",
      finalizePayout: async () => { finalizerCalls += 1; },
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_NOT_INITIATED" },
  );
  assert.equal(finalizerCalls, 1);
  assert.equal(auditEvents.length, 2);
});

test("failed payout releases reservation and cannot later be settled", async () => {
  const { account, client, audit, auditEvents, payouts } = createHarness();
  const { payout } = await initiateFinancialPayout({
    targetType: "DISTRIBUTOR_SETTLEMENT",
    targetId: "dist-settlement-1",
    amount: "15.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-fail-1",
    initiatedByAccountId: "admin-maker",
    validateTarget: async () => ({ availableAmount: "15.00" }),
    client,
    writeAudit: audit,
  });
  const failed = await failFinancialPayout({
    payoutId: payout.id,
    failureReason: "Transfer rejected by bank.",
    failedByAccountId: "admin-reviewer",
    client,
    writeAudit: audit,
  });
  assert.equal(failed.payout.status, "FAILED");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
  assert.equal(payouts.get(payout.id).failedByAccountId, "admin-reviewer");
  assert.deepEqual(auditEvents.map(({ actor, event }) => [actor.actorId, event.action]), [
    ["admin-maker", "FINANCIAL_PAYOUT_INITIATED"],
    ["admin-reviewer", "FINANCIAL_PAYOUT_FAILED"],
  ]);
  await assert.rejects(
    confirmFinancialPayout({
      payoutId: payout.id,
      bankEvidenceReference: "BANK-REF",
      confirmedByAccountId: "admin-late-reviewer",
      finalizePayout: async () => ({}),
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_NOT_INITIATED" },
  );

  const retry = await initiateFinancialPayout({
    targetType: "DISTRIBUTOR_SETTLEMENT",
    targetId: "dist-settlement-1",
    amount: "15.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-fail-retry-1",
    initiatedByAccountId: "admin-maker-2",
    validateTarget: async () => ({ availableAmount: "15.00" }),
    client,
    writeAudit: audit,
  });
  assert.equal(retry.payout.status, "INITIATED");
  assert.equal(account.reservedBalance.toFixed(2), "15.00");
  const retriedSettlement = await confirmFinancialPayout({
    payoutId: retry.payout.id,
    bankEvidenceReference: "BANK-RETRY-REF",
    confirmedByAccountId: "admin-checker-2",
    finalizePayout: async (_tx, currentPayout) => {
      assert.equal(currentPayout.amount.toFixed(2), "15.00");
      return { journalEntryId: "journal-retry-1" };
    },
    client,
    writeAudit: audit,
  });
  assert.equal(retriedSettlement.payout.status, "SETTLED");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
  assert.equal(payouts.get(retry.payout.id).confirmedByAccountId, "admin-checker-2");
});

test("Marketing CPA bill payouts can reserve and release funds through the shared payout lifecycle", async () => {
  const { account, client, audit } = createHarness();
  const { payout } = await initiateFinancialPayout({
    targetType: "MARKETING_CPA_PAYABLE",
    targetId: "cpa-bill-1",
    amount: "20.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "cpa-payout-1",
    initiatedByAccountId: "admin-maker",
    externalPaymentReference: "CPA-PAYMENT-REF",
    validateTarget: async () => ({ availableAmount: "40.00" }),
    client,
    writeAudit: audit,
  });
  assert.equal(payout.targetType, "MARKETING_CPA_PAYABLE");
  assert.equal(account.reservedBalance.toFixed(2), "20.00");

  const failed = await failFinancialPayout({
    payoutId: payout.id,
    expectedTargetType: "MARKETING_CPA_PAYABLE",
    failureReason: "Payment instruction was rejected.",
    failedByAccountId: "admin-reviewer",
    client,
    writeAudit: audit,
  });
  assert.equal(failed.payout.status, "FAILED");
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
});

test("a payable fine can make cash exceed the payable while the settled amount stays within the open balance", async () => {
  const { account, client, audit } = createHarness();
  const { payout } = await initiateFinancialPayout({
    targetType: "ACCOUNT_PAYABLE",
    targetId: "ap-fine-1",
    amount: "95.00",
    settlementAmount: "90.00",
    adjustmentType: "FINE",
    adjustmentAmount: "5.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-fine-1",
    initiatedByAccountId: "admin-1",
    validateTarget: async () => ({ availableAmount: "90.00" }),
    client,
    writeAudit: audit,
  });

  assert.equal(payout.amount.toFixed(2), "95.00");
  assert.equal(payout.settlementAmount.toFixed(2), "90.00");
  assert.equal(account.reservedBalance.toFixed(2), "95.00");
});

test("concurrent same-key payout initiation returns the winning payout as an idempotent replay", async () => {
  const { account, client, payouts } = createHarness({ synchronizeInitialPayoutLookups: true });
  let auditCount = 0;
  const input = {
    targetType: "ACCOUNT_PAYABLE",
    targetId: "ap-concurrent-1",
    amount: "20.00",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-concurrent-1",
    initiatedByAccountId: "admin-1",
    externalPaymentReference: "BANK-TRANSFER-REF-1",
    notes: "Supplier invoice 123",
    validateTarget: async () => ({ availableAmount: "50.00" }),
    client,
    writeAudit: async () => { auditCount += 1; },
  };

  const results = await Promise.all([
    initiateFinancialPayout(input),
    initiateFinancialPayout(input),
  ]);
  assert.equal(results.every(({ success }) => success), true);
  assert.deepEqual(results.map(({ isReplay }) => isReplay).sort(), [false, true]);
  assert.equal(payouts.size, 2);
  assert.equal(auditCount, 1);
  assert.equal(account.reservedBalance.toFixed(2), "20.00");

  await assert.rejects(
    initiateFinancialPayout({ ...input, notes: "Changed payout details" }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
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
    initiatedByAccountId: "admin-1",
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
      initiatedByAccountId: "admin-2",
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
      initiatedByAccountId: "admin-1",
      validateTarget: async () => ({ availableAmount: "100.00" }),
      client,
      writeAudit: audit,
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );
});

test("payout initiation, confirmation, and failure reject missing identities before financial mutations", async () => {
  const { account, client, audit, auditEvents, payouts } = createHarness();
  const initiation = {
    targetType: "ACCOUNT_PAYABLE",
    targetId: "ap-identity-1",
    amount: "12.34",
    financialAccountId: "treasury-1",
    idempotencyKey: "payout-identity-1",
    validateTarget: async () => ({ availableAmount: "12.34" }),
    client,
    writeAudit: audit,
  };
  await assert.rejects(initiateFinancialPayout(initiation), { code: "PAYOUT_MAKER_REQUIRED" });
  assert.equal(account.reservedBalance.toFixed(2), "0.00");
  assert.equal(payouts.size, 0);
  assert.equal(auditEvents.length, 0);

  const { payout } = await initiateFinancialPayout({
    ...initiation,
    initiatedByAccountId: "admin-maker",
  });
  await assert.rejects(
    confirmFinancialPayout({
      payoutId: payout.id,
      bankEvidenceReference: "BANK-REF-IDENTITY",
      confirmedByAccountId: "  ",
      finalizePayout: async () => ({ journalEntryId: "journal-identity" }),
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_CHECKER_REQUIRED" },
  );
  await assert.rejects(
    failFinancialPayout({
      payoutId: payout.id,
      failureReason: "Bank rejected the instruction.",
      failedByAccountId: " admin-maker ",
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_SELF_REVIEW" },
  );
  await assert.rejects(
    failFinancialPayout({
      payoutId: payout.id,
      failureReason: "Bank rejected the instruction.",
      client,
      writeAudit: audit,
    }),
    { code: "PAYOUT_REVIEWER_REQUIRED" },
  );
  assert.equal(payouts.get(payout.id).status, "INITIATED");
  assert.equal(account.reservedBalance.toFixed(2), "12.34");
  assert.equal(auditEvents.length, 1);
});

test("payout routes deny a reviewer without the payable-settlement permission", async () => {
  let auditEvent = null;
  let handlerReached = false;
  const authorizePayoutReview = createAuthorize(
    async () => new Set(),
    async (_actor, event) => { auditEvent = event; },
  );
  const middleware = authorizePayoutReview("finance:payable_settle");
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await middleware(
    { auth: { accountId: "unauthorized-reviewer", role: "ADMIN" }, method: "POST", path: "/api/finance/settle-payable" },
    response,
    () => { handlerReached = true; },
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "FORBIDDEN");
  assert.equal(handlerReached, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auditEvent.action, "AUTHORIZATION_DENIED");

  let authorizedNext = false;
  const authorizeAllowedReviewer = createAuthorize(
    async () => new Set(["finance:payable_settle"]),
    async () => {},
  );
  await authorizeAllowedReviewer("finance:payable_settle")(
    { auth: { accountId: "authorized-reviewer", role: "ADMIN" } },
    response,
    () => { authorizedNext = true; },
  );
  assert.equal(authorizedNext, true);
});

test("manufacturer payout confirmation shares normalized maker-checker enforcement", async (t) => {
  let lookupCount = 0;
  const guardedReads = [
    guardRead(t, prisma.manufacturer, "findUnique"),
    guardRead(t, prisma.financialAccount, "findUnique"),
    guardRead(t, prisma.order, "findMany"),
    guardRead(t, prisma.product, "findMany"),
    guardRead(t, prisma.manufacturerInventory, "findMany"),
    guardRead(t, prisma.cashTransaction, "findMany"),
    guardRead(t, prisma.account, "findUnique"),
    guardRead(t, prisma.journalLine, "findMany"),
  ];
  stubMethod(t, prisma.financialPayout, "findUnique", async () => {
    lookupCount += 1;
    return {
      id: "manufacturer-payout-1",
      targetType: "MANUFACTURER_PAYABLE",
      targetId: "manufacturer-1",
      status: "INITIATED",
      initiatedByAccountId: " maker-1 ",
      amount: new Prisma.Decimal("20.00"),
    };
  });

  const response = createResponse();
  await payManufacturer({
    body: {
      action: "CONFIRM",
      payoutId: "manufacturer-payout-1",
      manufacturerId: "manufacturer-1",
      bankEvidenceReference: "BANK-EVIDENCE-1",
    },
    auth: { accountId: "maker-1" },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "PAYOUT_SELF_APPROVAL");
  assert.equal(lookupCount, 1);
  assert.deepEqual(guardedReads.map((getCallCount) => getCallCount()), Array(guardedReads.length).fill(0));
});

test("manufacturer payout initiation requires a caller idempotency key before database reads", async (t) => {
  const guardedReads = [
    guardRead(t, prisma.manufacturer, "findUnique"),
    guardRead(t, prisma.financialAccount, "findUnique"),
    guardRead(t, prisma.order, "findMany"),
    guardRead(t, prisma.product, "findMany"),
    guardRead(t, prisma.manufacturerInventory, "findMany"),
    guardRead(t, prisma.cashTransaction, "findMany"),
  ];
  const response = createResponse();

  await payManufacturer({
    body: {
      action: "INITIATE",
      manufacturerId: "manufacturer-1",
      amount: "20.00",
      fromAccountId: "treasury-1",
    },
    auth: { accountId: "maker-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.deepEqual(guardedReads.map((getCallCount) => getCallCount()), Array(guardedReads.length).fill(0));
});
