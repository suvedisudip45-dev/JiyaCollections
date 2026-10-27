import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  getDistributorCashPosition,
  netDistributorRefundPayable,
  reviewDistributorRemittance,
  settleDistributorRefundPayable,
  submitDistributorRemittance,
} from "../services/distributorCashSettlementService.js";

const createSubmitHarness = (receivableAmount = "1000.00") => {
  const state = { batches: [], events: [], audits: [] };
  const tx = {
    distributor: { findUnique: async () => ({ id: "dist-1", name: "Distributor One" }) },
    accountingParty: {
      upsert: async () => ({ id: "party-dist-1" }),
    },
    accountingDocument: {
      aggregate: async () => ({ _sum: { remainingAmount: new Prisma.Decimal(receivableAmount) } }),
    },
    distributorRemittanceBatch: {
      findUnique: async ({ where }) => state.batches.find((batch) => batch.idempotencyKey === where.idempotencyKey) || null,
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal(0) } }),
      create: async ({ data }) => {
        const batch = { id: `batch-${state.batches.length + 1}`, ...data };
        state.batches.push(batch);
        return batch;
      },
    },
    distributorCashEvent: {
      create: async ({ data }) => {
        state.events.push(data);
        return data;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: "audit-1" };
      },
    },
  };
  return {
    state,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

test("distributor remittance submission is scoped, idempotent, and cannot exceed open receivables", async () => {
  const harness = createSubmitHarness("800.00");
  const submitted = await submitDistributorRemittance({
    distributorId: "dist-1",
    amount: "300.00",
    reference: "BANK-REF-001",
    evidenceUrl: "https://evidence.example/remittance-001",
    idempotencyKey: "remit-request-001",
    recordedByAccountId: "account-dist-1",
    client: harness.client,
  });
  assert.equal(submitted.isReplay, false);
  assert.equal(harness.state.batches[0].status, "PENDING_REVIEW");
  assert.equal(harness.state.events[0].status, "PENDING_VERIFICATION");
  assert.equal(harness.state.events[0].amount.toFixed(2), "300.00");
  assert.equal(harness.state.audits.length, 1);

  const replay = await submitDistributorRemittance({
    distributorId: "dist-1",
    amount: "300.00",
    reference: "BANK-REF-001",
    evidenceUrl: "https://evidence.example/remittance-001",
    idempotencyKey: "remit-request-001",
    client: harness.client,
  });
  assert.equal(replay.isReplay, true);

  await assert.rejects(() => submitDistributorRemittance({
    distributorId: "dist-1",
    amount: "900.00",
    reference: "BANK-REF-002",
    evidenceUrl: "https://evidence.example/remittance-002",
    idempotencyKey: "remit-request-002",
    client: createSubmitHarness("800.00").client,
  }), (error) => error.code === "REMITTANCE_EXCEEDS_RECEIVABLE");
});

test("distributor cash position reports COD receivable and refund payable separately", async () => {
  const client = {
    accountingParty: {
      findUnique: async () => ({ id: "party-1" }),
    },
    accountingDocument: {
      aggregate: async ({ where }) => ({
        _sum: {
          remainingAmount: new Prisma.Decimal(where.side === "RECEIVABLE" ? "650.00" : "125.25"),
        },
      }),
    },
    distributorRemittanceBatch: {
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal("100.00") } }),
    },
  };
  const position = await getDistributorCashPosition({ distributorId: "dist-1", client });
  assert.deepEqual(position, {
    outstandingReceivable: "650.00",
    pendingRemittance: "100.00",
    refundPayable: "125.25",
    availableToRemit: "550.00",
    availableToOffset: "125.25",
  });
});

const createNettingHarness = ({ receivable = "500.00", payable = "350.00", pending = "100.00" } = {}) => {
  const state = { offsets: [], journals: [], allocations: [], audits: [], transactionOptions: null };
  const tx = {
    distributor: { findUnique: async () => ({ id: "dist-1", name: "Distributor One" }) },
    accountingParty: { upsert: async () => ({ id: "party-dist-1" }) },
    distributorSettlementOffset: {
      findUnique: async ({ where }) => state.offsets.find((offset) => offset.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const offset = { id: `offset-${state.offsets.length + 1}`, ...data };
        state.offsets.push(offset);
        return offset;
      },
    },
    accountingDocument: {
      aggregate: async ({ where }) => ({
        _sum: {
          remainingAmount: new Prisma.Decimal(where.side === "RECEIVABLE" ? receivable : payable),
        },
      }),
    },
    distributorRemittanceBatch: {
      aggregate: async () => ({ _sum: { amount: new Prisma.Decimal(pending) } }),
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: "audit-1" };
      },
    },
  };
  const client = {
    distributorSettlementOffset: {
      findUnique: async ({ where }) => state.offsets.find((offset) => offset.idempotencyKey === where.idempotencyKey) || null,
    },
    $transaction: async (callback, options) => {
      state.transactionOptions = options;
      return callback(tx);
    },
  };
  return { client, state };
};

test("Admin-approved refund netting posts balanced journal and allocates both gross balances", async () => {
  const harness = createNettingHarness();
  const result = await netDistributorRefundPayable({
    distributorId: "dist-1",
    amount: "200.00",
    idempotencyKey: "offset-approval-001",
    reviewerAccountId: "admin-1",
    notes: "Reviewed refund evidence.",
    client: harness.client,
    journalPoster: async (entry, { client }) => {
      assert.ok(client);
      harness.state.journals.push(entry);
      return { id: "journal-1" };
    },
    allocationService: async (allocation) => {
      harness.state.allocations.push(allocation);
      return { unallocatedAmount: new Prisma.Decimal(0) };
    },
  });

  assert.equal(result.isReplay, false);
  assert.equal(result.offset.amount.toFixed(2), "200.00");
  assert.deepEqual(harness.state.journals[0].lines.map((line) => [line.accountCode, line.debit, line.credit]), [
    ["2190", 200, 0],
    ["1190", 0, 200],
  ]);
  assert.deepEqual(harness.state.allocations.map(({ side, sourceTypes }) => [side, sourceTypes[0]]), [
    ["RECEIVABLE", "DISTRIBUTOR_COD_SALE"],
    ["PAYABLE", "DISTRIBUTOR_CUSTOMER_REFUND"],
  ]);
  assert.equal(harness.state.offsets.length, 1);
  assert.equal(harness.state.audits.length, 1);
  assert.equal(harness.state.transactionOptions.isolationLevel, "Serializable");
});

test("refund netting cannot consume COD reserved by pending remittances", async () => {
  const harness = createNettingHarness({ receivable: "500.00", payable: "400.00", pending: "250.00" });
  let journalCalls = 0;
  await assert.rejects(() => netDistributorRefundPayable({
    distributorId: "dist-1",
    amount: "251.00",
    idempotencyKey: "offset-exceeds-reserved",
    client: harness.client,
    journalPoster: async () => { journalCalls += 1; return { id: "journal-1" }; },
    allocationService: async () => ({ unallocatedAmount: new Prisma.Decimal(0) }),
  }), (error) => error.code === "OFFSET_EXCEEDS_AVAILABLE_BALANCE");
  assert.equal(journalCalls, 0);
  assert.equal(harness.state.offsets.length, 0);
});

test("refund netting idempotency replays the original approval without reposting", async () => {
  const harness = createNettingHarness();
  let journalCalls = 0;
  const options = {
    distributorId: "dist-1",
    amount: "100.00",
    idempotencyKey: "offset-replay-001",
    client: harness.client,
    journalPoster: async () => { journalCalls += 1; return { id: "journal-1" }; },
    allocationService: async () => ({ unallocatedAmount: new Prisma.Decimal(0) }),
  };
  const first = await netDistributorRefundPayable(options);
  const replay = await netDistributorRefundPayable(options);
  assert.equal(first.isReplay, false);
  assert.equal(replay.isReplay, true);
  assert.equal(journalCalls, 1);
  assert.equal(harness.state.offsets.length, 1);
});

test("concurrent netting idempotency conflict returns the already-posted approval", async () => {
  const harness = createNettingHarness();
  harness.state.offsets.push({
    id: "offset-existing",
    distributorId: "dist-1",
    amount: new Prisma.Decimal("100.00"),
    idempotencyKey: "DISTRIBUTOR_SETTLEMENT_NETTING:offset-race-001",
  });
  harness.client.$transaction = async () => {
    const error = new Error("Unique constraint conflict");
    error.code = "P2002";
    throw error;
  };
  const result = await netDistributorRefundPayable({
    distributorId: "dist-1",
    amount: "100.00",
    idempotencyKey: "offset-race-001",
    client: harness.client,
  });
  assert.equal(result.isReplay, true);
  assert.equal(result.offset.id, "offset-existing");
});

test("distributor remittance requires payment evidence over HTTPS", async () => {
  const harness = createSubmitHarness();
  await assert.rejects(() => submitDistributorRemittance({
    distributorId: "dist-1",
    amount: "50.00",
    reference: "BANK-REF-003",
    idempotencyKey: "remit-no-evidence",
    client: harness.client,
  }), (error) => error.code === "INVALID_INPUT");

  await assert.rejects(() => submitDistributorRemittance({
    distributorId: "dist-1",
    amount: "50.00",
    reference: "BANK-REF-004",
    evidenceUrl: "http://insecure.example/proof",
    idempotencyKey: "remit-insecure-evidence",
    client: harness.client,
  }), (error) => error.code === "INVALID_EVIDENCE_URL");
});

  test("Admin payout settles only an open distributor refund payable and records cash and accounting atomically", async () => {
    const state = {
      document: {
        id: "refund-doc-1",
        documentNumber: "DREF-return-1",
        partyId: "party-dist-1",
        side: "PAYABLE",
        sourceType: "DISTRIBUTOR_CUSTOMER_REFUND",
        sourceId: "return-1",
        status: "OPEN",
        originalAmount: new Prisma.Decimal("875.50"),
        allocatedAmount: new Prisma.Decimal("0.00"),
        remainingAmount: new Prisma.Decimal("875.50"),
      },
      allocations: [],
      events: [],
      cashTransactions: [],
      auditEntries: [],
      treasuryBalance: 2000,
    };
    let posterArgs;
    const tx = {
      distributor: { findUnique: async () => ({ id: "dist-1", name: "Distributor One" }) },
      accountingParty: { upsert: async () => ({ id: "party-dist-1" }) },
      distributorCashEvent: {
        findUnique: async ({ where }) => state.events.find((event) => event.idempotencyKey === where.idempotencyKey) || null,
        create: async ({ data }) => {
          const event = { id: `event-${state.events.length + 1}`, ...data };
          state.events.push(event);
          return event;
        },
      },
      accountingDocument: {
        findFirst: async ({ where }) => {
          const doc = state.document;
          if (
            doc.id !== where.id ||
            doc.partyId !== where.partyId ||
            doc.side !== where.side ||
            doc.sourceType !== where.sourceType ||
            !where.status.in.includes(doc.status)
          ) return null;
          return doc;
        },
        findMany: async ({ where }) => (
          where.partyId === state.document.partyId &&
          where.side === state.document.side &&
          where.id.in.includes(state.document.id) &&
          ["OPEN", "PARTIALLY_PAID"].includes(state.document.status)
            ? [state.document]
            : []
        ),
        updateMany: async ({ where, data }) => {
          const doc = state.document;
          if (
            doc.id !== where.id ||
            !doc.allocatedAmount.equals(where.allocatedAmount) ||
            !doc.remainingAmount.equals(where.remainingAmount) ||
            doc.status !== where.status
          ) return { count: 0 };
          Object.assign(doc, data);
          return { count: 1 };
        },
      },
      financialAccount: {
        findUnique: async () => ({
          id: "treasury-1",
          accountName: "Operating Bank",
          accountType: "BANK",
          currency: "NPR",
          status: "ACTIVE",
          currentBalance: state.treasuryBalance,
          accountingAccountId: "bank-gl",
          accountingAccount: { accountType: "ASSET", normalBalance: "DEBIT" },
        }),
        updateMany: async ({ where, data }) => {
          if (state.treasuryBalance < where.currentBalance.gte || where.id !== "treasury-1") return { count: 0 };
          state.treasuryBalance -= data.currentBalance.decrement;
          return { count: 1 };
        },
      },
      accountingAllocation: {
        findUnique: async ({ where }) => state.allocations.find((entry) => entry.idempotencyKey === where.idempotencyKey) || null,
        create: async ({ data }) => {
          const allocation = { id: `allocation-${state.allocations.length + 1}`, ...data };
          state.allocations.push(allocation);
          return allocation;
        },
      },
      cashTransaction: {
        create: async ({ data }) => {
          const transaction = { id: `cash-${state.cashTransactions.length + 1}`, ...data };
          state.cashTransactions.push(transaction);
          return transaction;
        },
      },
      systemAuditOutbox: {
        create: async ({ data }) => {
          state.auditEntries.push(data);
          return { id: `audit-${state.auditEntries.length}` };
        },
      },
    };
    const client = { $transaction: async (callback) => callback(tx) };
    const paymentAccountingPoster = async (args) => {
      posterArgs = args;
      return { id: "journal-payout-1" };
    };
    const payout = await settleDistributorRefundPayable({
      distributorId: "dist-1",
      accountingDocumentId: "refund-doc-1",
      financialAccountId: "treasury-1",
      amount: "875.50",
      idempotencyKey: "refund-payout-1",
      reviewerAccountId: "admin-1",
      client,
      paymentAccountingPoster,
    });

    assert.equal(payout.isReplay, false);
    assert.equal(posterArgs.payableAccountCode, "2190");
    assert.equal(posterArgs.accountingPartyId, "party-dist-1");
    assert.equal(posterArgs.cashAccountId, "bank-gl");
    assert.equal(state.document.status, "PAID");
    assert.equal(state.document.remainingAmount.toFixed(2), "0.00");
    assert.equal(state.treasuryBalance, 1124.5);
    assert.equal(state.cashTransactions[0].type, "OUTFLOW");
    assert.equal(state.cashTransactions[0].category, "REFUND");
    assert.equal(state.events[0].status, "POSTED");
    assert.equal(state.events[0].journalEntryId, "journal-payout-1");
    assert.equal(state.auditEntries.length, 1);

    const replay = await settleDistributorRefundPayable({
      distributorId: "dist-1",
      accountingDocumentId: "refund-doc-1",
      financialAccountId: "treasury-1",
      amount: "875.50",
      idempotencyKey: "refund-payout-1",
      client,
      paymentAccountingPoster,
    });
    assert.equal(replay.isReplay, true);
    assert.equal(state.cashTransactions.length, 1);
});

const createReviewHarness = () => {
  const state = {
    batch: {
      id: "batch-1",
      distributorId: "dist-1",
      amount: new Prisma.Decimal("300.00"),
      reference: "BANK-REF-001",
      status: "PENDING_REVIEW",
      idempotencyKey: "remit-request-001",
    },
    party: { id: "party-dist-1" },
    document: {
      id: "doc-1",
      partyId: "party-dist-1",
      side: "RECEIVABLE",
      originalAmount: new Prisma.Decimal("500.00"),
      allocatedAmount: new Prisma.Decimal("0"),
      remainingAmount: new Prisma.Decimal("500.00"),
      status: "OPEN",
      dueDate: null,
      issueDate: new Date("2026-01-01T00:00:00.000Z"),
    },
    accounts: new Map([
      ["bank", { id: "bank", accountCode: "1120", accountName: "Bank", accountType: "ASSET", normalBalance: "DEBIT", currentBalance: new Prisma.Decimal(0) }],
      ["receivable", { id: "receivable", accountCode: "1190", accountName: "Distributor COD Receivable", accountType: "ASSET", normalBalance: "DEBIT", currentBalance: new Prisma.Decimal(0) }],
    ]),
    journalEntries: [],
    allocations: [],
    cashEvents: [{
      id: "event-1",
      remittanceBatchId: "batch-1",
      eventType: "COMPANY_REMITTANCE",
      status: "PENDING_VERIFICATION",
    }],
    cashTransactions: [],
    audits: [],
  };
  const tx = {
    distributorRemittanceBatch: {
      findFirst: async () => state.batch,
      findUnique: async () => state.batch,
      updateMany: async ({ where, data }) => {
        if (state.batch.status !== where.status) return { count: 0 };
        Object.assign(state.batch, data);
        return { count: 1 };
      },
    },
    distributor: { findUnique: async () => ({ id: "dist-1", name: "Distributor One" }) },
    accountingParty: { upsert: async () => state.party },
    accountingDocument: {
      aggregate: async () => ({ _sum: { remainingAmount: state.document.remainingAmount } }),
      findMany: async () => [state.document],
      updateMany: async ({ where, data }) => {
        const doc = state.document;
        if (
          doc.id !== where.id ||
          !doc.allocatedAmount.equals(where.allocatedAmount) ||
          !doc.remainingAmount.equals(where.remainingAmount) ||
          doc.status !== where.status
        ) return { count: 0 };
        Object.assign(doc, data);
        return { count: 1 };
      },
    },
    financialAccount: {
      findUnique: async () => ({
        id: "bank-account-1",
        accountName: "Operating Bank",
        accountType: "BANK",
        currency: "NPR",
        status: "ACTIVE",
        currentBalance: 0,
        accountingAccountId: "bank",
        accountingAccount: { accountType: "ASSET", normalBalance: "DEBIT" },
      }),
      update: async ({ data }) => {
        state.financialBalance = data.currentBalance.increment;
        return { id: "bank-account-1" };
      },
    },
    fiscalYear: {
      upsert: async () => ({ id: "fy-1", status: "OPEN" }),
    },
    accountingPeriod: {
      upsert: async () => ({ id: "period-1", status: "OPEN" }),
    },
    journalSequence: {
      upsert: async () => ({ nextNumber: 2 }),
    },
    account: {
      findUnique: async ({ where }) => state.accounts.get(where.id) || [...state.accounts.values()].find((account) => account.accountCode === where.accountCode),
      update: async ({ where, data }) => {
        const account = state.accounts.get(where.id);
        account.currentBalance = account.currentBalance.plus(data.currentBalance.increment);
        return account;
      },
    },
    accountingAccountMapping: {
      findUnique: async ({ where }) => {
        const account = [...state.accounts.values()].find((entry) => entry.accountCode === "1190");
        return where.mappingKey === "DISTRIBUTOR_COD_RECEIVABLE" ? { account } : null;
      },
    },
    accountingEvent: {
      create: async ({ data }) => ({ id: "accounting-event-1", ...data }),
      update: async ({ data }) => data,
      findUnique: async () => null,
    },
    journalEntry: {
      findUnique: async () => null,
      create: async ({ data }) => {
        const entry = {
          id: "journal-1",
          ...data,
          lines: data.lines.create.map((line) => ({
            ...line,
            account: state.accounts.get(line.accountId),
          })),
        };
        state.journalEntries.push(entry);
        return entry;
      },
    },
    accountingAllocation: {
      findUnique: async () => null,
      create: async ({ data }) => {
        const allocation = { id: "allocation-1", ...data };
        state.allocations.push(allocation);
        return allocation;
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        const transaction = { id: "cash-1", ...data };
        state.cashTransactions.push(transaction);
        return transaction;
      },
    },
    distributorCashEvent: {
      updateMany: async ({ where, data }) => {
        const event = state.cashEvents.find((entry) =>
          entry.remittanceBatchId === where.remittanceBatchId &&
          entry.eventType === where.eventType &&
          entry.status === where.status
        );
        if (!event) return { count: 0 };
        Object.assign(event, data);
        return { count: 1 };
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: "audit-1" };
      },
    },
  };
  return { state, client: { $transaction: async (callback) => callback(tx) } };
};

test("admin remittance verification posts bank, distributor AR, allocations and cash records atomically", async () => {
  const harness = createReviewHarness();
  const result = await reviewDistributorRemittance({
    distributorId: "dist-1",
    batchId: "batch-1",
    decision: "VERIFY",
    financialAccountId: "bank-account-1",
    reviewerAccountId: "admin-1",
    client: harness.client,
  });
  const { state } = harness;
  assert.equal(result.success, true);
  assert.equal(state.batch.status, "VERIFIED");
  assert.equal(state.batch.financialAccountId, "bank-account-1");
  assert.equal(state.document.remainingAmount.toFixed(2), "200.00");
  assert.equal(state.document.status, "PARTIALLY_PAID");
  assert.equal(state.allocations[0].amount.toFixed(2), "300.00");
  assert.equal(state.allocations[0].idempotencyKey, "DISTRIBUTOR_REMITTANCE:batch-1:doc-1");
  assert.equal(state.journalEntries.length, 1);
  assert.equal(state.journalEntries[0].lines.find((line) => line.account.accountCode === "1190").credit.toFixed(2), "300.00");
  assert.equal(state.cashEvents[0].status, "POSTED");
  assert.equal(state.cashEvents[0].journalEntryId, "journal-1");
  assert.equal(state.cashTransactions[0].type, "INFLOW");
  assert.equal(state.cashTransactions[0].toAccountId, "bank-account-1");
  assert.equal(Number(state.financialBalance), 300);
  assert.equal(state.audits.length, 1);
});
