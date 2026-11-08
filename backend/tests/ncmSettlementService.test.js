import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmNcmSettlementBatch,
  listNcmSettlementBatches,
  listNcmSettlementCandidates,
  resolveNcmSettlementVariance,
} from "../services/ncmSettlementService.js";

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
    batchCreates: [],
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
    ncmSettlementBatch: {
      create: async ({ data }) => {
        state.batchCreates.push(data);
        return { id: "batch-1", ...data };
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

const makeVarianceHarness = ({ varianceAmount, suspenseRemaining = "0.00", receivableRemaining = "100.00" }) => {
  const state = {
    batch: {
      id: "batch-variance",
      idempotencyKey: "NCM_COD_BATCH:hash",
      varianceAmount: String(varianceAmount),
      status: "VARIANCE_OPEN",
    },
    resolutions: [],
    allocations: [],
    journals: [],
    cashTransactions: [],
  };
  const documents = [
    {
      id: "ncm-cod-receivable",
      partyId: "ncm-party",
      side: "RECEIVABLE",
      sourceType: "NCM_COD_SALE",
      sourceId: "order-1",
      remainingAmount: receivableRemaining,
      allocatedAmount: "0.00",
      status: "OPEN",
      idempotencyKey: "NCM_COD_SALE:order-1",
    },
    ...(Number(varianceAmount) > 0 ? [{
      id: "ncm-variance-suspense",
      partyId: "ncm-party",
      side: "PAYABLE",
      sourceType: "NCM_REMITTANCE_VARIANCE",
      sourceId: "hash",
      remainingAmount: suspenseRemaining,
      allocatedAmount: "0.00",
      status: "OPEN",
      idempotencyKey: "NCM_REMITTANCE_VARIANCE:hash",
    }] : []),
  ];
  const tx = {
    ncmSettlementVarianceResolution: {
      findUnique: async ({ where }) => state.resolutions.find((item) => item.idempotencyKey === where.idempotencyKey) || null,
      aggregate: async () => ({
        _sum: { amount: state.resolutions.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2) },
      }),
      create: async ({ data }) => {
        const resolution = { id: `resolution-${state.resolutions.length + 1}`, ...data };
        state.resolutions.push(resolution);
        return resolution;
      },
    },
    ncmSettlementBatch: {
      findUnique: async () => state.batch,
      updateMany: async ({ data }) => {
        Object.assign(state.batch, data);
        return { count: 1 };
      },
    },
    ncmSettlementBatchItem: {
      findMany: async () => [{ settlementId: "settlement-1" }],
    },
    deliveryFinancialSettlement: {
      findMany: async () => [{ deliveryOrderId: "delivery-1" }],
    },
    deliveryOrder: {
      findMany: async () => [{ orderId: "order-1" }],
    },
    accountingParty: {
      findUnique: async () => ({ id: "ncm-party" }),
    },
    accountingDocument: {
      findUnique: async ({ where }) => documents.find((document) => document.idempotencyKey === where.idempotencyKey) || null,
      findMany: async ({ where }) => documents.filter((document) =>
        document.partyId === where.partyId &&
        document.side === where.side &&
        (Array.isArray(where.sourceType?.in)
          ? where.sourceType.in.includes(document.sourceType)
          : document.sourceType === where.sourceType) &&
        (!where.sourceId?.in || where.sourceId.in.includes(document.sourceId)) &&
        where.status.in.includes(document.status)
      ),
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        accountName: "NPR Bank",
        accountType: "BANK",
        currency: "NPR",
        status: "ACTIVE",
        currentBalance: "1000.00",
        accountingAccount: { accountCode: "1120", accountType: "ASSET", normalBalance: "DEBIT" },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    cashTransaction: {
      create: async ({ data }) => {
        const cash = { id: `cash-${state.cashTransactions.length + 1}`, ...data };
        state.cashTransactions.push(cash);
        return cash;
      },
    },
  };
  const client = {
    ...tx,
    $transaction: async (callback, options) => {
      state.transactionOptions = options;
      return callback(tx);
    },
  };
  const documentAllocator = async (input) => {
    state.allocations.push(input);
    const doc = input.side === "PAYABLE" ? documents.find(({ side }) => side === "PAYABLE") : documents.find(({ side }) => side === "RECEIVABLE");
    return {
      unallocatedAmount: "0.00",
      allocations: doc ? [{ documentId: doc.id }] : [],
    };
  };
  return { client, state, documentAllocator };
};

test("NCM settlement candidates are date-filtered and paginated for manual selection", async () => {
  let deliveryFilter;
  const result = await listNcmSettlementCandidates({
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    page: 2,
    limit: 1,
  }, {
    deliveryOrder: {
      findMany: async ({ where }) => {
        deliveryFilter = where;
        return [
          { id: "delivery-a", orderId: "order-a", ncmOrderId: 101, deliveredAt: new Date("2026-10-02T10:00:00Z") },
          { id: "delivery-b", orderId: "order-b", ncmOrderId: 102, deliveredAt: new Date("2026-10-01T10:00:00Z") },
        ];
      },
    },
    deliveryFinancialSettlement: {
      findMany: async () => [
        { id: "settlement-a", deliveryOrderId: "delivery-a", settlementState: "PENDING", codExpected: 1000, deliveryFeeExpected: 100 },
        { id: "settlement-b", deliveryOrderId: "delivery-b", settlementState: "REQUESTED", codCollected: 500, deliveryFeeActual: 40, ncmTicketId: 22 },
      ],
    },
  });

  assert.equal(deliveryFilter.state, "DELIVERED");
  assert.ok(deliveryFilter.deliveredAt.gte instanceof Date);
  assert.ok(deliveryFilter.deliveredAt.lt instanceof Date);
  assert.deepEqual(result.candidates.map(({ id }) => id), ["settlement-b"]);
  assert.equal(result.candidates[0].calculatedNetDeposit, 460);
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, pages: 2 });
});

test("NCM batch history bounds resolution details but derives remaining variance from all resolutions", async () => {
  let resolutionQuery;
  let batchQuery;
  const result = await listNcmSettlementBatches({
    ncmSettlementBatch: {
      findMany: async (query) => {
        batchQuery = query;
        return [{
          id: "batch-history",
          varianceAmount: "-100.00",
          varianceResolutions: [
            { id: "latest-resolution", amount: "20.00", createdAt: new Date("2026-11-07T00:00:00Z") },
          ],
          _count: { items: 2 },
        }];
      },
    },
    ncmSettlementVarianceResolution: {
      groupBy: async (query) => {
        resolutionQuery = query;
        return [{ batchId: "batch-history", _sum: { amount: "75.00" } }];
      },
    },
  });

  assert.equal(batchQuery.take, 50);
  assert.equal(batchQuery.include.varianceResolutions.take, 20);
  assert.equal(resolutionQuery.by[0], "batchId");
  assert.equal(result.batches[0].resolvedVarianceAmount, "75.00");
  assert.equal(result.batches[0].remainingVarianceAmount, "25.00");
  assert.equal(result.batches[0].varianceResolutions[0].id, "latest-resolution");
});

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
  assert.equal(harness.state.batchCreates[0].items.create.length, 2);
  assert.equal(harness.state.batchCreates[0].status, "SETTLED");
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

test("NCM shortfall collection posts cash and allocates only against its open COD receivables", async () => {
  const harness = makeVarianceHarness({ varianceAmount: "-100.00", receivableRemaining: "100.00" });
  const resolutionInput = {
    batchId: "batch-variance",
    action: "COLLECT_SHORTFALL",
    amount: "30.00",
    financialAccountId: "treasury-1",
    reference: "BANK-RECEIPT-30",
    notes: "NCM paid the remaining portion",
    idempotencyKey: "ncm-shortfall-collect-001",
    client: harness.client,
    documentAllocator: harness.documentAllocator,
    journalPoster: async (journal) => {
      harness.state.journals.push(journal);
      return { id: "journal-collect" };
    },
  };
  const result = await resolveNcmSettlementVariance(resolutionInput);
  const replay = await resolveNcmSettlementVariance(resolutionInput);

  assert.equal(result.remainingVarianceAmount, "70.00");
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(harness.state.batch.status, "VARIANCE_PARTIALLY_RESOLVED");
  assert.equal(harness.state.cashTransactions[0].type, "INFLOW");
  assert.equal(harness.state.cashTransactions.length, 1);
  assert.equal(harness.state.cashTransactions[0].amount, 30);
  assert.deepEqual(harness.state.journals[0].lines.map((line) => [line.accountCode, Number(line.debit), Number(line.credit)]), [
    ["1120", 30, 0],
    ["1170", 0, 30],
  ]);
  assert.equal(harness.state.allocations[0].side, "RECEIVABLE");
  assert.deepEqual(harness.state.allocations[0].targetDocumentIds, ["ncm-cod-receivable"]);
  assert.equal(harness.state.transactionOptions.isolationLevel, "Serializable");
});

test("NCM overpayment can be applied to open COD receivables without cash movement", async () => {
  const harness = makeVarianceHarness({ varianceAmount: "100.00", suspenseRemaining: "100.00" });
  const result = await resolveNcmSettlementVariance({
    batchId: "batch-variance",
    action: "APPLY_OVERPAYMENT",
    amount: "25.00",
    reference: "NCM-STATEMENT-25",
    notes: "Apply NCM overpayment to the next open COD balance",
    idempotencyKey: "ncm-overpayment-apply-001",
    client: harness.client,
    documentAllocator: harness.documentAllocator,
    journalPoster: async (journal) => {
      harness.state.journals.push(journal);
      return { id: "journal-apply" };
    },
  });

  assert.equal(result.remainingVarianceAmount, "75.00");
  assert.equal(harness.state.batch.status, "VARIANCE_PARTIALLY_RESOLVED");
  assert.equal(harness.state.cashTransactions.length, 0);
  assert.deepEqual(harness.state.journals[0].lines.map((line) => [line.accountCode, Number(line.debit), Number(line.credit)]), [
    ["2185", 25, 0],
    ["1170", 0, 25],
  ]);
  assert.deepEqual(harness.state.allocations.map(({ side, allocationType }) => [side, allocationType]), [
    ["PAYABLE", "OFFSET"],
    ["RECEIVABLE", "OFFSET"],
  ]);
});

test("NCM overpayment refund posts a treasury outflow and clears suspense", async () => {
  const harness = makeVarianceHarness({ varianceAmount: "100.00", suspenseRemaining: "100.00" });
  const result = await resolveNcmSettlementVariance({
    batchId: "batch-variance",
    action: "REFUND_OVERPAYMENT",
    amount: "40.00",
    financialAccountId: "treasury-1",
    reference: "BANK-REFUND-40",
    notes: "Refund NCM overpayment",
    idempotencyKey: "ncm-overpayment-refund-001",
    client: harness.client,
    documentAllocator: harness.documentAllocator,
    journalPoster: async (journal) => {
      harness.state.journals.push(journal);
      return { id: "journal-refund" };
    },
  });

  assert.equal(result.remainingVarianceAmount, "60.00");
  assert.equal(harness.state.cashTransactions[0].type, "OUTFLOW");
  assert.equal(harness.state.cashTransactions[0].fromAccountId, "treasury-1");
  assert.deepEqual(harness.state.journals[0].lines.map((line) => [line.accountCode, Number(line.debit), Number(line.credit)]), [
    ["2185", 40, 0],
    ["1120", 0, 40],
  ]);
  assert.equal(harness.state.allocations[0].allocationType, "CASH");
});

test("NCM variance resolution rejects actions that do not match the batch variance", async () => {
  const harness = makeVarianceHarness({ varianceAmount: "-100.00" });
  await assert.rejects(() => resolveNcmSettlementVariance({
    batchId: "batch-variance",
    action: "REFUND_OVERPAYMENT",
    amount: "10.00",
    financialAccountId: "treasury-1",
    reference: "REF-10",
    notes: "Wrong action",
    idempotencyKey: "ncm-wrong-action-001",
    client: harness.client,
    documentAllocator: harness.documentAllocator,
    journalPoster: async () => {
      throw new Error("Journal must not be posted");
    },
  }), (error) => error.code === "VARIANCE_ACTION_MISMATCH");
});

test("NCM short payment is posted as an open receivable variance for the selected batch", async () => {
  const harness = makeHarness({ settlements: sampleSettlements() });
  const result = await confirmNcmSettlementBatch({
    settlementIds: ["set-1", "set-2"],
    financialAccountId: "treasury-1",
    actualNetDeposit: "1300.00",
    varianceType: "PENALTY_OR_FINE",
    varianceReason: "NCM deducted a documented late pickup penalty.",
    client: harness.client,
    settlementPoster: async (settlement) => {
      harness.state.journals.push(settlement);
      return { id: "short-payment-journal" };
    },
    carrierFeeAccrualPoster: async () => ({ id: "fee-journal" }),
  });

  assert.equal(result.expectedNetDeposit, "1365.00");
  assert.equal(result.netDeposit, "1300.00");
  assert.equal(result.varianceAmount, "-65.00");
  assert.equal(harness.state.cashCreates[0].amount, 1300);
  assert.equal(
    harness.state.allocations
      .filter((allocation) => ["ncm-cod-doc-1", "ncm-cod-doc-2"].includes(allocation.documentId))
      .reduce((total, allocation) => total + Number(allocation.amount), 0),
    1435,
  );
  assert.equal(harness.state.documents.reduce((total, document) => total + Number(document.remainingAmount), 0), 65);
  assert.equal(harness.state.batchCreates[0].status, "VARIANCE_OPEN");
  assert.equal(harness.state.batchCreates[0].varianceAmount, "-65.00");
  assert.equal(harness.state.batchCreates[0].varianceReason, "NCM deducted a documented late pickup penalty.");
});

test("NCM overpayment is held as an open payable suspense document", async () => {
  const harness = makeHarness({ settlements: sampleSettlements() });
  const result = await confirmNcmSettlementBatch({
    settlementIds: ["set-1", "set-2"],
    financialAccountId: "treasury-1",
    actualNetDeposit: "1400.00",
    varianceType: "OTHER",
    varianceReason: "NCM transferred an extra amount pending statement clarification.",
    client: harness.client,
    settlementPoster: async () => ({ id: "overpayment-journal" }),
    carrierFeeAccrualPoster: async () => ({ id: "fee-journal" }),
  });

  assert.equal(result.varianceAmount, "35.00");
  const varianceDocument = harness.state.documents.find((document) => document.sourceType === "NCM_REMITTANCE_VARIANCE");
  assert.equal(varianceDocument.side, "PAYABLE");
  assert.equal(Number(varianceDocument.originalAmount), 35);
  assert.equal(harness.state.batchCreates[0].status, "VARIANCE_OPEN");
});

test("NCM variance requires an explanation and settlement claims remain concurrency-safe", async () => {
  const unexplainedVariance = makeHarness({ settlements: sampleSettlements() });
  await assert.rejects(() => confirmNcmSettlementBatch({
    settlementIds: ["set-1"],
    financialAccountId: "treasury-1",
    actualNetDeposit: "800.00",
    client: unexplainedVariance.client,
  }), (error) => error.code === "VARIANCE_EXPLANATION_REQUIRED");

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
