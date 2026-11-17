import assert from "node:assert/strict";
import test from "node:test";
import { correctNcmSettlementBatch } from "../services/ncmSettlementService.js";

const makeHarness = ({ priorSettlementState = "REQUESTED" } = {}) => {
  const batch = {
    id: "batch-1",
    idempotencyKey: "NCM_COD_BATCH:hash-1",
    status: "VARIANCE_RESOLVED",
    actualNetDeposit: "100.00",
    totalCarrierFee: "10.00",
    varianceAmount: "10.00",
    financialAccountId: "bank-1",
    journalEntryId: "journal-batch",
    cashTransactionId: "cash-batch",
    items: [{
      settlementId: "settlement-1",
      priorSettlementState,
      settlement: {
        settlementState: "SETTLED",
        journalEntryId: "journal-batch",
      },
    }],
    varianceResolutions: [{
      id: "resolution-1",
      action: "REFUND_OVERPAYMENT",
      amount: "10.00",
      financialAccountId: "bank-1",
      journalEntryId: "journal-resolution",
      cashTransactionId: "cash-resolution",
      idempotencyKey: "resolution-key",
      reversedAt: null,
    }],
  };
  const cashTransactions = new Map([
    ["cash-batch", {
      id: "cash-batch",
      idempotencyKey: batch.idempotencyKey,
      referenceId: batch.idempotencyKey,
      category: "COD_REMITTANCE",
      type: "INFLOW",
      toAccountId: "bank-1",
      invoiceNumber: "NCM-BANK-REF-01",
      amount: "100.00",
    }],
    ["cash-resolution", {
      id: "cash-resolution",
      idempotencyKey: "resolution-key",
      referenceId: "NCM_VARIANCE:batch-1",
      type: "OUTFLOW",
      fromAccountId: "bank-1",
      amount: "10.00",
    }],
  ]);
  const journals = new Map([
    ["journal-batch", { id: "journal-batch", sourceType: "PAYMENT", sourceId: "NCM-REMIT-hash-1", status: "POSTED" }],
    ["journal-fee", { id: "journal-fee", sourceType: "NCM_CARRIER_FEE_ACCRUAL", sourceId: "hash-1", status: "POSTED" }],
    ["journal-resolution", { id: "journal-resolution", sourceType: "NCM_VARIANCE_RESOLUTION", sourceId: "NCM_VARIANCE:batch-1", status: "POSTED" }],
  ]);
  const documents = [
    { id: "cod-doc", idempotencyKey: "NCM_COD_SALE:order-1", sourceType: "NCM_COD_SALE", originalAmount: "100.00", allocatedAmount: "100.00", remainingAmount: "0.00", status: "PAID" },
    { id: "fee-doc", idempotencyKey: "NCM_CARRIER_FEE:hash-1", sourceType: "NCM_CARRIER_FEE", sourceId: "hash-1", side: "PAYABLE", originalAmount: "10.00", allocatedAmount: "10.00", remainingAmount: "0.00", status: "PAID" },
    { id: "suspense-doc", idempotencyKey: "NCM_REMITTANCE_VARIANCE:hash-1", sourceType: "NCM_REMITTANCE_VARIANCE", sourceId: "hash-1", side: "PAYABLE", originalAmount: "10.00", allocatedAmount: "10.00", remainingAmount: "0.00", status: "PAID" },
  ];
  const allocations = [
    { id: "allocation-cod", documentId: "cod-doc", journalEntryId: "journal-batch", amount: "100.00" },
    { id: "allocation-fee", documentId: "fee-doc", journalEntryId: "journal-fee", amount: "10.00" },
    { id: "allocation-suspense", documentId: "suspense-doc", journalEntryId: "journal-resolution", amount: "10.00" },
  ];
  const account = { id: "bank-1", accountName: "NPR Bank", currency: "NPR", currentBalance: "1000.00", reservedBalance: "100.00" };
  const state = {
    batch,
    cashTransactions,
    documents,
    allocations,
    account,
    cashCreates: [],
    allocationCreates: [],
    resolutionUpdates: [],
    settlementUpdates: [],
    batchUpdates: [],
    reversions: [],
    audits: [],
  };
  const tx = {
    ncmSettlementBatch: {
      findUnique: async () => batch,
      updateMany: async ({ data }) => {
        Object.assign(batch, data);
        state.batchUpdates.push(data);
        return { count: 1 };
      },
    },
    deliveryFinancialSettlement: {
      findFirst: async () => null,
      updateMany: async ({ where, data }) => {
        const item = batch.items.find(({ settlementId }) => settlementId === where.id);
        if (!item || item.settlement.settlementState !== where.settlementState ||
            item.settlement.journalEntryId !== where.journalEntryId) return { count: 0 };
        Object.assign(item.settlement, data);
        state.settlementUpdates.push(data);
        return { count: 1 };
      },
    },
    ncmSettlementBatchItem: {
      findUnique: async () => null,
    },
    ncmSettlementVarianceResolution: {
      updateMany: async ({ where, data }) => {
        const resolution = batch.varianceResolutions.find(({ id }) => id === where.id);
        if (!resolution || resolution.reversedAt !== where.reversedAt) return { count: 0 };
        Object.assign(resolution, data);
        state.resolutionUpdates.push(data);
        return { count: 1 };
      },
    },
    settlementReversion: {
      findFirst: async () => null,
      create: async ({ data }) => state.reversions.push(data),
    },
    cashTransaction: {
      findUnique: async ({ where }) => cashTransactions.get(where.id) || null,
      create: async ({ data }) => {
        const transaction = { id: `cash-correction-${state.cashCreates.length + 1}`, ...data };
        state.cashCreates.push(transaction);
        return transaction;
      },
    },
    journalEntry: {
      findUnique: async ({ where }) => journals.get(where.id) || null,
      findMany: async () => [journals.get("journal-fee")],
    },
    accountingAllocation: {
      findMany: async ({ where }) => where.documentId?.in
        ? allocations.filter(({ documentId }) => where.documentId.in.includes(documentId))
        : allocations,
      create: async ({ data }) => {
        state.allocationCreates.push(data);
        return data;
      },
    },
    accountingDocument: {
      findUnique: async ({ where }) => documents.find(({ idempotencyKey }) => idempotencyKey === where.idempotencyKey) || null,
      findMany: async ({ where }) => documents.filter(({ id }) => where.id.in.includes(id)),
      updateMany: async ({ where, data }) => {
        const document = documents.find(({ id }) => id === where.id);
        if (
          !document ||
          Number(document.allocatedAmount) !== Number(where.allocatedAmount) ||
          Number(document.remainingAmount) !== Number(where.remainingAmount) ||
          document.status !== where.status
        ) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    },
    financialAccount: {
      findMany: async () => [account],
      updateMany: async ({ data }) => {
        const delta = data.currentBalance.decrement || data.currentBalance.increment;
        state.account.currentBalance = data.currentBalance.decrement
          ? Number(state.account.currentBalance) - Number(delta)
          : Number(state.account.currentBalance) + Number(delta);
        return { count: 1 };
      },
    },
  };
  const client = { $transaction: async (callback) => callback(tx) };
  return { client, state };
};

test("NCM correction reverses the batch, fee, and variance accounting atomically", async () => {
  const { client, state } = makeHarness();
  const reverseCalls = [];
  const result = await correctNcmSettlementBatch({
    batchId: "batch-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "NCM returned the incorrect remittance",
    evidenceReference: "BANK-RETURN-789",
    actorAccountId: "admin-1",
    actorEmail: "owner@example.com",
    client,
    reverseJournal: async (input) => {
      reverseCalls.push(input);
      return { id: `reversal-${input.journalEntryId}` };
    },
    writeAudit: async (_actor, event) => state.audits.push(event),
    now: new Date("2026-11-09T12:00:00.000Z"),
  });

  assert.equal(result.status, "REVERSED");
  assert.equal(reverseCalls.length, 3);
  assert.deepEqual(reverseCalls.map(({ expectedSourceType }) => expectedSourceType), [
    "PAYMENT",
    "NCM_CARRIER_FEE_ACCRUAL",
    "NCM_VARIANCE_RESOLUTION",
  ]);
  assert.equal(state.batch.status, "REVERSED");
  assert.equal(state.batch.items[0].settlement.settlementState, "REQUESTED");
  assert.equal(state.batch.items[0].settlement.journalEntryId, null);
  assert.equal(state.resolutionUpdates[0].reversalJournalEntryId, "reversal-journal-resolution");
  assert.equal(state.resolutionUpdates[0].reversalCashTransactionId, "cash-correction-2");
  assert.equal(state.cashCreates.length, 2);
  assert.equal(state.cashCreates[0].type, "OUTFLOW");
  assert.equal(state.cashCreates[0].externalPaymentReference, "BANK-RETURN-789");
  assert.equal(state.account.currentBalance, 910);
  assert.deepEqual(state.documents.map(({ id, allocatedAmount, remainingAmount, status }) => [
    id,
    Number(allocatedAmount),
    Number(remainingAmount),
    status,
  ]), [
    ["cod-doc", 0, 100, "OPEN"],
    ["fee-doc", 0, 0, "CANCELLED"],
    ["suspense-doc", 0, 0, "CANCELLED"],
  ]);
  assert.deepEqual(state.allocationCreates.map(({ amount }) => Number(amount)), [-100, -10, -10]);
  assert.equal(state.reversions[0].correctionMode, "RETURNED_FUNDS");
  assert.equal(state.reversions[0].evidenceReference, "BANK-RETURN-789");
  assert.equal(state.audits[0].afterState.reversedAllocationCount, 3);
});

test("NCM correction fails closed when historical delivery state was not captured", async () => {
  const { client, state } = makeHarness({ priorSettlementState: null });
  await assert.rejects(() => correctNcmSettlementBatch({
    batchId: "batch-1",
    correctionMode: "RETURNED_FUNDS",
    correctionReason: "NCM returned the incorrect remittance",
    evidenceReference: "BANK-RETURN-789",
    actorAccountId: "admin-1",
    client,
  }), { code: "NCM_BATCH_SOURCE_STATE_MISMATCH" });
  assert.equal(state.cashCreates.length, 0);
  assert.equal(state.allocationCreates.length, 0);
  assert.equal(state.batch.status, "VARIANCE_RESOLVED");
});

test("NCM batch with a bank reference cannot be voided as if the remittance never arrived", async () => {
  const { client, state } = makeHarness();
  await assert.rejects(() => correctNcmSettlementBatch({
    batchId: "batch-1",
    correctionMode: "VOID_NOT_EXECUTED",
    correctionReason: "No payment arrived",
    evidenceReference: "BANK-TRACE-123",
    actorAccountId: "admin-1",
    client,
  }), { code: "NCM_CONFIRMED_REMITTANCE_CANNOT_BE_VOIDED" });
  assert.equal(state.cashCreates.length, 0);
  assert.equal(state.batch.status, "VARIANCE_RESOLVED");
});
