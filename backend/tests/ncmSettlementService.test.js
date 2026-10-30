import assert from "node:assert/strict";
import test from "node:test";
import { confirmNcmSettlementBatch } from "../services/ncmSettlementService.js";

const makeHarness = ({ settlements, existingCash = null, failClaim = false } = {}) => {
  const state = {
    settlements: structuredClone(settlements || []),
    documents: (settlements || []).map((settlement, index) => ({
      id: `ncm-cod-doc-${index + 1}`,
      partyId: "ncm-party",
      side: "RECEIVABLE",
      sourceType: "NCM_COD_SALE",
      sourceId: `order-${settlement.id}`,
      originalAmount: settlement.codCollected || settlement.codExpected,
      allocatedAmount: 0,
      remainingAmount: settlement.codCollected || settlement.codExpected,
      status: "OPEN",
      issueDate: new Date("2026-10-01T00:00:00.000Z"),
      idempotencyKey: `NCM_COD_SALE:${settlement.id}`,
    })),
    cash: existingCash,
    cashCreates: [],
    balanceIncrements: [],
    journals: [],
    allocations: [],
    options: null,
  };
  const tx = {
    deliveryOrder: {
      findMany: async ({ where }) => where.id.in.map((id) => ({
        id,
        orderId: `order-${state.settlements.find((settlement) => settlement.deliveryOrderId === id)?.id}`,
      })),
    },
    accountingParty: {
      upsert: async () => ({ id: "ncm-party" }),
    },
    accountingDocument: {
      findMany: async ({ where }) => state.documents.filter((document) =>
        document.partyId === where.partyId &&
        document.side === where.side &&
        (where.sourceType?.in ? where.sourceType.in.includes(document.sourceType) : document.sourceType === where.sourceType) &&
        (!where.sourceId?.in || where.sourceId.in.includes(document.sourceId)) &&
        where.status.in.includes(document.status)
      ),
      upsert: async ({ create }) => {
        let document = state.documents.find((item) => item.idempotencyKey === create.idempotencyKey);
        if (!document) {
          document = { id: `document-${state.documents.length + 1}`, ...create };
          state.documents.push(document);
        }
        return document;
      },
      updateMany: async ({ where, data }) => {
        const document = state.documents.find((item) =>
          where.id === item.id &&
          Number(item.allocatedAmount) === Number(where.allocatedAmount) &&
          Number(item.remainingAmount) === Number(where.remainingAmount) &&
          item.status === where.status
        );
        if (!document) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    },
    accountingAllocation: {
      findUnique: async ({ where }) => state.allocations.find((allocation) => allocation.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const allocation = { id: `allocation-${state.allocations.length + 1}`, ...data };
        state.allocations.push(allocation);
        return allocation;
      },
    },
    cashTransaction: {
      findUnique: async () => state.cash,
      create: async ({ data }) => {
        state.cash = { id: "cash-1", ...data };
        state.cashCreates.push(data);
        return state.cash;
      },
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        accountName: "NPR Bank",
        accountType: "BANK",
        currency: "NPR",
        status: "ACTIVE",
        accountingAccount: { id: "gl-bank", accountCode: "1120", accountType: "ASSET", normalBalance: "DEBIT" },
      }),
      updateMany: async ({ data }) => {
        state.balanceIncrements.push(data.currentBalance.increment);
        return { count: 1 };
      },
    },
    deliveryFinancialSettlement: {
      findMany: async ({ where }) => state.settlements.filter((row) => where.id.in.includes(row.id)),
      updateMany: async ({ where, data }) => {
        if (failClaim && data.settlementState === "SETTLED" && where.id) return { count: 0 };
        const selected = state.settlements.filter((row) =>
          (where.id === row.id || where.id?.in?.includes(row.id)) &&
          (!where.settlementState || row.settlementState === where.settlementState) &&
          (!("journalEntryId" in where) || row.journalEntryId === where.journalEntryId)
        );
        selected.forEach((row) => Object.assign(row, data));
        return { count: selected.length };
      },
    },
  };
  const client = {
    cashTransaction: tx.cashTransaction,
    $transaction: async (callback, options) => {
      state.options = options;
      return callback(tx);
    },
  };
  return { client, state };
};

const sampleSettlements = () => [
  { id: "set-1", deliveryOrderId: "delivery-set-1", settlementState: "REQUESTED", codExpected: 1000, codCollected: 1000, deliveryFeeExpected: 100, deliveryFeeActual: 90, otherAdjustments: 0, journalEntryId: null },
  { id: "set-2", deliveryOrderId: "delivery-set-2", settlementState: "PENDING", codExpected: 500, codCollected: 500, deliveryFeeExpected: 50, deliveryFeeActual: 45, otherAdjustments: 0, journalEntryId: null },
];

test("NCM batch posts a net receipt once and atomically claims and links every order", async () => {
  const harness = makeHarness({ settlements: sampleSettlements() });
  const result = await confirmNcmSettlementBatch({
    settlementIds: ["set-2", "set-1"],
    financialAccountId: "treasury-1",
    reference: "BANK-REF-01",
    notes: "Statement 10/27",
    client: harness.client,
    settlementPoster: async (settlement, { client }) => {
      assert.ok(client);
      harness.state.journals.push(settlement);
      return { id: "journal-1" };
    },
    carrierFeeAccrualPoster: async () => ({ id: "fee-journal-1" }),
    now: new Date("2026-10-27T04:00:00.000Z"),
  });

  assert.equal(result.netDeposit, "1365.00");
  assert.equal(result.totalCod, "1500.00");
  assert.equal(result.totalFee, "135.00");
  assert.equal(result.settledCount, 2);
  assert.equal(harness.state.cashCreates.length, 1);
  assert.equal(harness.state.cashCreates[0].amount, 1365);
  assert.equal(harness.state.balanceIncrements[0], 1365);
  assert.deepEqual(harness.state.settlements.map((row) => [row.settlementState, row.journalEntryId]), [
    ["SETTLED", "journal-1"],
    ["SETTLED", "journal-1"],
  ]);
  assert.equal(harness.state.journals[0].cashAccountCode, "1120");
  assert.equal(Number(harness.state.documents.find((document) => document.side === "PAYABLE").originalAmount), 135);
  assert.equal(harness.state.documents.filter((document) => document.status === "PAID").length, 3);
  assert.equal(harness.state.options.isolationLevel, "Serializable");
});

test("NCM discount reduces the carrier fee deduction without changing COD collected", async () => {
  const harness = makeHarness({
    settlements: [{
      id: "discounted",
      deliveryOrderId: "delivery-discounted",
      settlementState: "PENDING",
      codExpected: 1535,
      codCollected: 1535,
      deliveryFeeExpected: 199,
      deliveryFeeActual: 159.2,
      deliveryFeeDiscount: 39.8,
      otherAdjustments: 0,
      journalEntryId: null,
    }],
  });
  const result = await confirmNcmSettlementBatch({
    settlementIds: ["discounted"],
    financialAccountId: "treasury-1",
    client: harness.client,
    settlementPoster: async (settlement) => {
      harness.state.journals.push(settlement);
      return { id: "discount-journal" };
    },
    carrierFeeAccrualPoster: async ({ feeAmount }) => {
      assert.equal(feeAmount, "159.20");
      return { id: "discount-fee-journal" };
    },
  });

  assert.equal(result.totalCod, "1535.00");
  assert.equal(result.totalFee, "159.20");
  assert.equal(result.netDeposit, "1375.80");
});

test("NCM batch idempotency returns prior receipt and does not post cash twice", async () => {
  const firstHarness = makeHarness({ settlements: sampleSettlements() });
  const options = {
    settlementIds: ["set-1", "set-2"],
    financialAccountId: "treasury-1",
    client: firstHarness.client,
    settlementPoster: async () => ({ id: "journal-1" }),
    carrierFeeAccrualPoster: async () => ({ id: "fee-journal-1" }),
  };
  const first = await confirmNcmSettlementBatch(options);
  const replay = await confirmNcmSettlementBatch(options);
  assert.equal(first.alreadyProcessed, false);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(firstHarness.state.cashCreates.length, 1);
});

test("NCM batch rejects non-open rows and fees that exceed remittance", async () => {
  const closed = makeHarness({ settlements: [{ ...sampleSettlements()[0], settlementState: "SETTLED" }] });
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1"],
    financialAccountId: "treasury-1",
    client: closed.client,
  }), (error) => error.code === "SETTLEMENTS_NOT_OPEN");

  const excessiveFee = makeHarness({
    settlements: [{ ...sampleSettlements()[0], codCollected: 50, deliveryFeeActual: 50, codExpected: 50 }],
  });
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1"],
    financialAccountId: "treasury-1",
    client: excessiveFee.client,
  }), (error) => error.code === "NON_POSITIVE_NET_REMITTANCE");
});

test("NCM batch rejects unknown adjustments and settlement claims lost to concurrency", async () => {
  const adjustment = makeHarness({
    settlements: [{ ...sampleSettlements()[0], otherAdjustments: 5 }],
  });
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1"],
    financialAccountId: "treasury-1",
    client: adjustment.client,
  }), (error) => error.code === "SETTLEMENT_VARIANCE_REVIEW_REQUIRED");

  const concurrent = makeHarness({ settlements: sampleSettlements(), failClaim: true });
  let journalCalls = 0;
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1"],
    financialAccountId: "treasury-1",
    client: concurrent.client,
    settlementPoster: async () => { journalCalls += 1; return { id: "journal-1" }; },
  }), (error) => error.code === "SETTLEMENT_CONCURRENCY_CONFLICT");
  assert.equal(journalCalls, 0);
  assert.equal(concurrent.state.cashCreates.length, 0);
});

test("NCM batch rejects duplicate and oversized ID selections", async () => {
  const harness = makeHarness({ settlements: sampleSettlements() });
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1", "set-1"],
    financialAccountId: "treasury-1",
    client: harness.client,
  }), (error) => error.code === "INVALID_SETTLEMENT_IDS");
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: Array.from({ length: 101 }, (_, index) => `set-${index}`),
    financialAccountId: "treasury-1",
    client: harness.client,
  }), (error) => error.code === "INVALID_SETTLEMENT_IDS");
});
