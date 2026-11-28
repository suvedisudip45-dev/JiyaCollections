import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  acknowledgeDistributorSettlementPayout,
  createDistributorSettlementRequestToken,
  getDistributorUnifiedSettlementPosition,
  recordDistributorSettlementPayout,
  reviewDistributorSettlementRequestToken,
  submitDistributorSettlementRequestEvidence,
  postDistributorBalanceSettlement,
} from "../services/distributorCashSettlementService.js";
import { allocatePaymentToDocuments } from "../services/accountingSubledgerService.js";

const makeDocument = (id, side, remainingAmount, sourceType) => ({
  id,
  documentType: side === "RECEIVABLE" ? "INVOICE" : "BILL",
  documentNumber: `DOC-${id}`,
  side,
  sourceType,
  sourceId: `source-${id}`,
  issueDate: new Date("2026-01-01T00:00:00.000Z"),
  dueDate: null,
  originalAmount: new Prisma.Decimal(remainingAmount),
  allocatedAmount: new Prisma.Decimal(0),
  remainingAmount: new Prisma.Decimal(remainingAmount),
  status: "OPEN",
  currency: "NPR",
});

const createSettlementHarness = ({
  receivable = "1000.00",
  payable = "700.00",
  pendingRemittance = "0.00",
  pendingRequests = 0,
  legacyLogisticsPayables = [],
  verifiedCollections = "1000.00",
  priorCompanyCollections = "0.00",
  receivableSourceType = "DISTRIBUTOR_COD_SALE",
  collectionOrderId = "source-ar-1",
} = {}) => {
  const state = {
    documents: [
      ...(Number(receivable) > 0 ? [makeDocument("ar-1", "RECEIVABLE", receivable, receivableSourceType)] : []),
      ...(Number(payable) > 0 ? [makeDocument("ap-1", "PAYABLE", payable, "DISTRIBUTOR_SERVICE_EARNING")] : []),
    ],
    batches: [],
    allocations: [],
    journals: [],
    cashTransactions: [],
    cashEvents: [],
    collectionEvents: [{
      orderId: collectionOrderId,
      amount: new Prisma.Decimal(verifiedCollections),
      status: "VERIFIED",
    }],
    audits: [],
    requestTokens: [],
    legacyLogisticsPayables,
    treasuryBalance: new Prisma.Decimal("10000.00"),
    transactionOptions: null,
  };
  const tx = {
    $queryRaw: async () => [],
    distributor: { findUnique: async () => ({ id: "dist-1", accountId: "distributor-account-1", name: "Distributor One" }) },
    authAccount: { findMany: async () => [] },
    portalNotification: { createMany: async ({ data }) => ({ count: data.length }) },
    distributorSettlementRequestToken: {
      findUnique: async ({ where }) => state.requestTokens.find((request) =>
        request.id === where.id || request.idempotencyKey === where.idempotencyKey
      ) || null,
      findFirst: async ({ where }) => state.requestTokens.find((request) =>
        (!where.id || request.id === where.id) &&
        (!where.idempotencyKey || request.idempotencyKey === where.idempotencyKey) &&
        (!where.distributorId || request.distributorId === where.distributorId) &&
        (!where.direction || request.direction === where.direction) &&
        (!where.status || (typeof where.status === "string"
          ? request.status === where.status
          : where.status.in.includes(request.status)))
      ) || null,
      create: async ({ data }) => {
        const request = { id: `request-${state.requestTokens.length + 1}`, ...data };
        state.requestTokens.push(request);
        return request;
      },
      update: async ({ where, data }) => {
        const request = state.requestTokens.find((item) => item.id === where.id);
        Object.assign(request, data);
        return request;
      },
      updateMany: async ({ where, data }) => {
        const request = state.requestTokens.find((item) =>
          item.id === where.id &&
          (!where.distributorId || item.distributorId === where.distributorId) &&
          (!where.direction || item.direction === where.direction) &&
          (!where.status || item.status === where.status)
        );
        if (!request) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      },
    },
    accountingParty: {
      upsert: async () => ({ id: "party-dist-1" }),
      findUnique: async () => ({ id: "party-dist-1" }),
    },
    accountingDocument: {
      findMany: async ({ where }) => state.documents.filter((document) => {
        const sideMatches = !where?.side || (
          typeof where.side === "string" ? where.side === document.side : where.side.in.includes(document.side)
        );
        const statusMatches = !where?.status || (
          typeof where.status === "string" ? where.status === document.status : where.status.in.includes(document.status)
        );
        const sourceMatches = !where?.sourceType || (
          typeof where.sourceType === "string"
            ? where.sourceType === document.sourceType
            : where.sourceType.in.includes(document.sourceType)
        );
        return (!where?.partyId || where.partyId === "party-dist-1") &&
          sideMatches && statusMatches && sourceMatches;
      }),
    },
    customerReturn: {
      findMany: async () => state.legacyLogisticsPayables.some((item) => item.referenceType === "RETURN_LOGISTICS_SETTLEMENT")
        ? [{ id: "return-1" }]
        : [],
    },
    orderExchangeRequest: {
      findMany: async () => state.legacyLogisticsPayables.some((item) => item.referenceType === "EXCHANGE_LOGISTICS_SETTLEMENT")
        ? [{ id: "exchange-1" }]
        : [],
    },
    accountPayable: {
      findMany: async () => state.legacyLogisticsPayables,
    },
    distributorRemittanceBatch: {
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal(pendingRemittance) } }),
    },
    distributorSettlementRequest: {
      count: async () => pendingRequests,
      findMany: async () => Array.from({ length: pendingRequests }, () => ({
        amount: new Prisma.Decimal("100.00"),
        paidAmount: new Prisma.Decimal(0),
      })),
    },
    distributorBalanceSettlement: {
      aggregate: async () => ({
        _sum: {
          cashAmount: new Prisma.Decimal(priorCompanyCollections).plus(
            state.batches
              .filter((batch) => batch.direction === "COMPANY_COLLECTS" && batch.status === "POSTED")
              .reduce((sum, batch) => sum.plus(batch.cashAmount), new Prisma.Decimal(0)),
          ),
        },
      }),
      findUnique: async ({ where }) => state.batches.find((batch) =>
        (where.id && batch.id === where.id) ||
        (where.idempotencyKey && batch.idempotencyKey === where.idempotencyKey)
      ) || null,
      create: async ({ data }) => {
        const batch = { id: `settlement-${state.batches.length + 1}`, ...data };
        state.batches.push(batch);
        return batch;
      },
      update: async ({ where, data }) => {
        const batch = state.batches.find((item) => item.id === where.id);
        Object.assign(batch, data);
        return batch;
      },
    },
    financialAccount: {
      findUnique: async () => ({
        id: "treasury-1",
        accountName: "Main Bank",
        accountType: "BANK",
        status: "ACTIVE",
        currency: "NPR",
        currentBalance: state.treasuryBalance,
        accountingAccountId: "bank-gl",
        accountingAccount: { accountType: "ASSET", normalBalance: "DEBIT" },
      }),
      updateMany: async ({ data }) => {
        if (data.currentBalance?.decrement) {
          if (state.treasuryBalance.lessThan(data.currentBalance.decrement)) return { count: 0 };
          state.treasuryBalance = state.treasuryBalance.minus(data.currentBalance.decrement);
        }
        if (data.currentBalance?.increment) {
          state.treasuryBalance = state.treasuryBalance.plus(data.currentBalance.increment);
        }
        return { count: 1 };
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        const transaction = { id: `cash-${state.cashTransactions.length + 1}`, ...data };
        state.cashTransactions.push(transaction);
        return transaction;
      },
    },
    distributorCashEvent: {
      aggregate: async ({ where }) => {
        const sourceIds = where.OR?.flatMap((condition) =>
          condition.orderId?.in || condition.accountingDocumentId?.in || []
        );
        const matches = state.collectionEvents.filter((event) =>
          where.eventType === "CUSTOMER_COLLECTION" &&
          (!sourceIds || sourceIds.includes(event.orderId) || sourceIds.includes(event.accountingDocumentId)) &&
          where.status.in.includes(event.status)
        );
        return {
          _sum: {
            amount: matches.reduce((sum, event) => sum.plus(event.amount), new Prisma.Decimal(0)),
          },
        };
      },
      create: async ({ data }) => {
        state.cashEvents.push(data);
        return data;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: `audit-${state.audits.length}` };
      },
    },
  };
  const client = {
    distributorSettlementRequestToken: tx.distributorSettlementRequestToken,
    distributorBalanceSettlement: {
      findUnique: async ({ where }) => state.batches.find((batch) =>
        (where.id && batch.id === where.id) ||
        (where.idempotencyKey && batch.idempotencyKey === where.idempotencyKey)
      ) || null,
    },
    $transaction: async (callback, options) => {
      state.transactionOptions = options;
      return callback(tx);
    },
  };
  const journalPoster = async (entry) => {
    assert.equal(entry.client, tx);
    state.journals.push(entry);
    return { id: `journal-${state.journals.length}` };
  };
  const allocationService = async (allocation) => {
    state.allocations.push(allocation);
    let remaining = new Prisma.Decimal(String(allocation.amount));
    for (const document of state.documents.filter((item) => item.side === allocation.side)) {
      if (remaining.isZero()) break;
      const applied = Prisma.Decimal.min(remaining, document.remainingAmount);
      document.remainingAmount = document.remainingAmount.minus(applied);
      document.allocatedAmount = document.allocatedAmount.plus(applied);
      document.status = document.remainingAmount.isZero() ? "PAID" : "PARTIALLY_PAID";
      remaining = remaining.minus(applied);
    }
    return { unallocatedAmount: remaining };
  };
  return { client, state, journalPoster, allocationService };
};

const post = (harness, overrides = {}) => postDistributorBalanceSettlement({
  distributorId: "dist-1",
  cashAmount: "300.00",
  reference: "BANK-SETTLE-001",
  setoffAgreementReference: "AGREEMENT-SET-OFF-01",
  setoffConfirmed: true,
  financialAccountId: "treasury-1",
  transferConfirmed: true,
  idempotencyKey: "unified-settlement-001",
  notes: "Monthly distributor settlement.",
  adminAccountId: "admin-1",
  client: harness.client,
  journalPoster: harness.journalPoster,
  allocationService: harness.allocationService,
  now: new Date("2026-06-15T12:00:00.000Z"),
  ...overrides,
});

test("unified position includes all open receivable and payable documents", async () => {
  const harness = createSettlementHarness();
  const position = await getDistributorUnifiedSettlementPosition({
    distributorId: "dist-1",
    client: {
      accountingParty: { findUnique: async () => ({ id: "party-dist-1" }) },
      accountingDocument: { findMany: async () => harness.state.documents },
      customerReturn: { findMany: async () => [] },
      orderExchangeRequest: { findMany: async () => [] },
      accountPayable: { findMany: async () => [] },
      distributorRemittanceBatch: {
        aggregate: async () => ({ _sum: { amount: new Prisma.Decimal("45.00") } }),
      },
      distributorSettlementRequest: { findMany: async () => [{ amount: new Prisma.Decimal("30.00"), paidAmount: new Prisma.Decimal(0) }] },
    },
  });

  assert.equal(position.outstandingReceivable, "1000.00");
  assert.equal(position.outstandingPayable, "700.00");
  assert.equal(position.netBalance, "300.00");
  assert.equal(position.companyCollects, "300.00");
  assert.equal(position.companyPays, "0.00");
  assert.equal(position.pendingRemittance, "45.00");
  assert.equal(position.pendingSettlementRequests, 1);
});

test("legacy return/exchange logistics payables are surfaced and block unified settlement", async () => {
  const legacyPayable = {
    id: "legacy-ap-1",
    title: "Return logistics settlement",
    referenceType: "RETURN_LOGISTICS_SETTLEMENT",
    referenceId: "return-1",
    remainingBalance: new Prisma.Decimal("125.50"),
  };
  const harness = createSettlementHarness({ legacyLogisticsPayables: [legacyPayable] });
  const position = await getDistributorUnifiedSettlementPosition({
    distributorId: "dist-1",
    client: {
      accountingParty: { findUnique: async () => ({ id: "party-dist-1" }) },
      accountingDocument: { findMany: async () => harness.state.documents },
      customerReturn: { findMany: async () => [{ id: "return-1" }] },
      orderExchangeRequest: { findMany: async () => [] },
      accountPayable: { findMany: async () => harness.state.legacyLogisticsPayables },
      distributorRemittanceBatch: {
        aggregate: async () => ({ _sum: { amount: new Prisma.Decimal(0) } }),
      },
      distributorSettlementRequest: { findMany: async () => [] },
    },
  });

  assert.equal(position.excludedLegacyLogisticsPayableTotal, "125.50");
  assert.equal(position.excludedLegacyLogisticsPayables[0].id, "legacy-ap-1");
  assert.equal(position.outstandingPayable, "825.50");
  assert.equal(position.netBalance, "174.50");
  assert.equal(position.unifiedSettlementBlocked, true);
  await assert.rejects(
    post(harness),
    (error) => error.code === "UNLEDGERED_DISTRIBUTOR_PAYABLE" && /125\.50/.test(error.message),
  );
  assert.equal(harness.state.journals.length, 0);
});

test("company collection posts net offset, receipt, allocations, and audit atomically", async () => {
  const harness = createSettlementHarness();
  const result = await post(harness);

  assert.equal(result.isReplay, false);
  assert.equal(result.settlement.direction, "COMPANY_COLLECTS");
  assert.equal(result.settlement.receivableApplied.toFixed(2), "1000.00");
  assert.equal(result.settlement.payableApplied.toFixed(2), "700.00");
  assert.equal(result.settlement.cashAmount.toFixed(2), "300.00");
  assert.equal(result.settlement.offsetAmount.toFixed(2), "700.00");
  const lines = harness.state.journals[0].lines;
  const debits = lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
  const credits = lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
  assert.ok(debits.equals(credits));
  assert.deepEqual(harness.state.allocations.map(({ side, allocationType }) => [side, allocationType]), [
    ["RECEIVABLE", "OFFSET"],
    ["PAYABLE", "OFFSET"],
    ["RECEIVABLE", "CASH"],
  ]);
  assert.equal(harness.state.cashTransactions[0].type, "INFLOW");
  assert.equal(harness.state.cashEvents[0].settlementBatchId, result.settlement.id);
  assert.equal(harness.state.treasuryBalance.toFixed(2), "10300.00");
  assert.equal(harness.state.audits.length, 1);
  assert.equal(harness.state.transactionOptions.isolationLevel, "Serializable");
});

test("company payout nets the receivable first and debits treasury for the remainder", async () => {
  const harness = createSettlementHarness({ receivable: "200.00", payable: "800.00" });
  const result = await post(harness, {
    cashAmount: "600.00",
    reference: "BANK-PAYOUT-002",
    idempotencyKey: "unified-settlement-002",
  });

  assert.equal(result.settlement.direction, "COMPANY_PAYS");
  assert.equal(result.settlement.receivableApplied.toFixed(2), "200.00");
  assert.equal(result.settlement.payableApplied.toFixed(2), "800.00");
  const lines = harness.state.journals[0].lines;
  const debits = lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
  const credits = lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
  assert.ok(debits.equals(credits));
  assert.equal(harness.state.cashTransactions[0].type, "OUTFLOW");
  assert.equal(harness.state.treasuryBalance.toFixed(2), "9400.00");
});

test("settlement requires documented set-off authority and confirmed cash movement", async () => {
  const withoutAgreement = createSettlementHarness();
  await assert.rejects(() => post(withoutAgreement, {
    setoffAgreementReference: null,
    setoffConfirmed: false,
  }), (error) =>
    error.code === "SETOFF_AUTHORITY_REQUIRED");
  assert.equal(withoutAgreement.state.journals.length, 0);

  const withoutAuthorityConfirmation = createSettlementHarness();
  await assert.rejects(() => post(withoutAuthorityConfirmation, {
    setoffConfirmed: false,
  }), (error) => error.code === "SETOFF_AUTHORITY_REQUIRED");
  assert.equal(withoutAuthorityConfirmation.state.journals.length, 0);

  const withoutConfirmation = createSettlementHarness({ payable: "0.00" });
  await assert.rejects(() => post(withoutConfirmation, {
    setoffAgreementReference: null,
    setoffConfirmed: false,
    transferConfirmed: false,
  }), (error) => error.code === "CASH_SETTLEMENT_DETAILS_REQUIRED");
  assert.equal(withoutConfirmation.state.journals.length, 0);
});

test("pending remittances and legacy settlement requests block a new unified batch", async () => {
  const pendingRemittance = createSettlementHarness({ pendingRemittance: "10.00" });
  await assert.rejects(() => post(pendingRemittance), (error) => error.code === "PENDING_REMITTANCE_REVIEW");
  assert.equal(pendingRemittance.state.journals.length, 0);

  const pendingRequest = createSettlementHarness({ payable: "0.00", pendingRequests: 1 });
  await assert.rejects(() => post(pendingRequest, { setoffAgreementReference: null }), (error) =>
    error.code === "PENDING_SETTLEMENT_REQUEST");
  assert.equal(pendingRequest.state.journals.length, 0);
});

test("unified settlement replay does not duplicate journal, cash, or allocations", async () => {
  const harness = createSettlementHarness();
  const first = await post(harness);
  const replay = await post(harness);

  assert.equal(first.isReplay, false);
  assert.equal(replay.isReplay, true);
  assert.equal(harness.state.journals.length, 1);
  assert.equal(harness.state.cashTransactions.length, 1);
  assert.equal(harness.state.allocations.length, 3);
});

test("Admin-issued collection request requires evidence and is posted only after Admin verification", async () => {
  const harness = createSettlementHarness();
  const created = await createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "300.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Collect the net balance.",
    idempotencyKey: "request-collection-001",
    adminAccountId: "admin-1",
    client: harness.client,
  });
  assert.equal(created.request.direction, "COMPANY_COLLECTS");
  assert.equal(created.request.status, "REQUESTED");
  assert.equal(harness.state.journals.length, 0);

  await assert.rejects(
    () => post(harness, { idempotencyKey: "manual-settlement-during-request" }),
    (error) => error.code === "ACTIVE_SETTLEMENT_REQUEST",
  );

  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "100.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Second request.",
    idempotencyKey: "request-collection-002",
    adminAccountId: "admin-1",
    client: harness.client,
  }), (error) => error.code === "ACTIVE_SETTLEMENT_REQUEST");

  const submitted = await submitDistributorSettlementRequestEvidence({
    distributorId: "dist-1",
    requestId: created.request.id,
    transferReference: "BANK-TRANSFER-001",
    evidenceUrl: "https://evidence.example/collection.png",
    distributorAccountId: "distributor-account-1",
    client: harness.client,
  });
  assert.equal(submitted.request.status, "EVIDENCE_SUBMITTED");
  assert.equal(harness.state.journals.length, 0);

  await assert.rejects(() => reviewDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestId: created.request.id,
    decision: "VERIFY",
    actualReceivedAmount: "299.00",
    financialAccountId: "treasury-1",
    adminAccountId: "admin-1",
    client: harness.client,
    journalPoster: harness.journalPoster,
    allocationService: harness.allocationService,
  }), (error) => error.code === "ACTUAL_RECEIPT_AMOUNT_MISMATCH");
  assert.equal(harness.state.journals.length, 0);
  assert.equal(harness.state.cashTransactions.length, 0);
  assert.equal(harness.state.batches.length, 0);

  const reviewed = await reviewDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestId: created.request.id,
    decision: "VERIFY",
    actualReceivedAmount: "300.00",
    financialAccountId: "treasury-1",
    adminAccountId: "admin-1",
    client: harness.client,
    journalPoster: harness.journalPoster,
    allocationService: harness.allocationService,
  });
  assert.equal(reviewed.request.status, "POSTED");
  assert.equal(harness.state.journals.length, 1);
  assert.equal(harness.state.cashTransactions.length, 1);

  const replay = await reviewDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestId: created.request.id,
    decision: "VERIFY",
    actualReceivedAmount: "300.00",
    financialAccountId: "treasury-1",
    adminAccountId: "admin-1",
    client: harness.client,
    journalPoster: harness.journalPoster,
    allocationService: harness.allocationService,
  });
  assert.equal(replay.isReplay, true);
  assert.equal(harness.state.journals.length, 1);
  await assert.rejects(() => reviewDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestId: created.request.id,
    decision: "VERIFY",
    actualReceivedAmount: "301.00",
    financialAccountId: "treasury-1",
    adminAccountId: "admin-1",
    client: harness.client,
    journalPoster: harness.journalPoster,
    allocationService: harness.allocationService,
  }), (error) => error.code === "IDEMPOTENCY_KEY_REUSED");
  assert.equal(harness.state.journals.length, 1);
  assert.equal(harness.state.cashTransactions.length, 1);
});

test("company collection requests fail closed without verified COD funds or source linkage", async () => {
  const noCollections = createSettlementHarness({ verifiedCollections: "0.00" });
  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "300.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Request collection.",
    idempotencyKey: "request-no-collections",
    adminAccountId: "admin-1",
    client: noCollections.client,
  }), (error) => error.code === "SETTLEMENT_EXCEEDS_VERIFIED_COLLECTIONS");

  const unlinkedCollections = createSettlementHarness({
    collectionOrderId: "unrelated-order",
  });
  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "300.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Request against an unrelated collection.",
    idempotencyKey: "request-unlinked-collections",
    adminAccountId: "admin-1",
    client: unlinkedCollections.client,
  }), (error) => error.code === "SETTLEMENT_EXCEEDS_VERIFIED_COLLECTIONS");

  const unsupportedSource = createSettlementHarness({
    receivableSourceType: "UNSUPPORTED_RECEIVABLE",
  });
  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "100.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Request collection.",
    idempotencyKey: "request-unsupported-source",
    adminAccountId: "admin-1",
    client: unsupportedSource.client,
  }), (error) => error.code === "UNSUPPORTED_COLLECTION_SOURCE");
});

test("direct company cash settlement cannot exceed verified unremitted COD collections", async () => {
  const noCollections = createSettlementHarness({ verifiedCollections: "0.00" });
  await assert.rejects(() => post(noCollections), (error) =>
    error.code === "SETTLEMENT_EXCEEDS_VERIFIED_COLLECTIONS");
  assert.equal(noCollections.state.journals.length, 0);
  assert.equal(noCollections.state.cashTransactions.length, 0);
  assert.equal(noCollections.state.batches.length, 0);

  const alreadyRemitted = createSettlementHarness({
    verifiedCollections: "500.00",
    priorCompanyCollections: "300.00",
  });
  await assert.rejects(() => post(alreadyRemitted, { cashAmount: "250.00" }), (error) =>
    error.code === "SETTLEMENT_EXCEEDS_VERIFIED_COLLECTIONS");
});

test("authoritative distributor settlement amounts reject JavaScript Number inputs", async () => {
  const harness = createSettlementHarness();
  await assert.rejects(() => post(harness, { cashAmount: 300 }), (error) => error.code === "INVALID_AMOUNT");
  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: 300,
    idempotencyKey: "numeric-request",
    adminAccountId: "admin-1",
    client: harness.client,
  }), (error) => error.code === "INVALID_AMOUNT");
});

test("unified net-balance requests are blocked while a legacy earnings request is active", async () => {
  const harness = createSettlementHarness({ pendingRequests: 1 });
  await assert.rejects(() => createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "300.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-01",
    setoffConfirmed: true,
    notes: "Prevent overlapping settlement requests.",
    idempotencyKey: "request-blocked-by-legacy",
    adminAccountId: "admin-1",
    client: harness.client,
  }), (error) => error.code === "PENDING_SETTLEMENT_REQUEST");
  assert.equal(harness.state.requestTokens.length, 0);
});

test("Admin-issued payout is posted with evidence and waits for distributor acknowledgment", async () => {
  const harness = createSettlementHarness({ receivable: "200.00", payable: "800.00" });
  const created = await createDistributorSettlementRequestToken({
    distributorId: "dist-1",
    requestedAmount: "600.00",
    setoffAgreementReference: "AGREEMENT-SET-OFF-02",
    setoffConfirmed: true,
    notes: "Pay the net balance.",
    idempotencyKey: "request-payout-001",
    adminAccountId: "admin-1",
    client: harness.client,
  });
  assert.equal(created.request.direction, "COMPANY_PAYS");

  const sent = await recordDistributorSettlementPayout({
    distributorId: "dist-1",
    requestId: created.request.id,
    transferReference: "BANK-PAYOUT-001",
    evidenceUrl: "https://evidence.example/payout.png",
    financialAccountId: "treasury-1",
    adminAccountId: "admin-1",
    client: harness.client,
    journalPoster: harness.journalPoster,
    allocationService: harness.allocationService,
  });
  assert.equal(sent.request.status, "PAYMENT_SENT");
  assert.equal(harness.state.journals.length, 1);

  const acknowledged = await acknowledgeDistributorSettlementPayout({
    distributorId: "dist-1",
    requestId: created.request.id,
    distributorAccountId: "distributor-account-1",
    client: harness.client,
  });
  assert.equal(acknowledged.request.status, "ACKNOWLEDGED");
});

test("subledger allocations retain unified settlement and cash/offset classification", async () => {
  const document = makeDocument("allocation-doc", "RECEIVABLE", "25.00", "DISTRIBUTOR_COD_SALE");
  let createdAllocation;
  const client = {
    accountingDocument: {
      findMany: async () => [document],
      updateMany: async () => ({ count: 1 }),
    },
    accountingAllocation: {
      findUnique: async () => null,
      create: async ({ data }) => {
        createdAllocation = data;
        return { id: "allocation-1", ...data };
      },
    },
  };

  const result = await allocatePaymentToDocuments({
    partyId: "party-dist-1",
    side: "RECEIVABLE",
    amount: "25.00",
    journalEntryId: "journal-1",
    settlementBatchId: "settlement-1",
    allocationType: "OFFSET",
    idempotencyKey: "settlement-allocation-1",
  }, { client });

  assert.equal(result.unallocatedAmount.toFixed(2), "0.00");
  assert.equal(createdAllocation.settlementBatchId, "settlement-1");
  assert.equal(createdAllocation.allocationType, "OFFSET");
});
