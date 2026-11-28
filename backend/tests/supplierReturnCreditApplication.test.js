import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import test from "node:test";
import {
  applySupplierReturnCreditToBill,
  getSupplierReturnApplicableBills,
  getSupplierReturnReconciliation,
} from "../services/supplierReturnCreditApplicationService.js";

const createHarness = ({ differentVendor = false } = {}) => {
  const supplierReturn = {
    id: "return-1",
    supplierName: "Vendor One",
    supplierReference: "VENDOR-1",
    totalDebitAmount: new Prisma.Decimal("100.00"),
    settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
    status: "COMPLETED",
    accountingDocumentId: "credit-1",
    accountingJournalEntryId: "journal-1",
    returnDate: new Date("2026-01-01T00:00:00.000Z"),
  };
  const credit = {
    id: "credit-1",
    documentType: "CREDIT_NOTE",
    documentNumber: "SRCN-1",
    side: "PAYABLE",
    sourceType: "SUPPLIER_RETURN",
    sourceId: supplierReturn.id,
    partyId: "party-1",
    currency: "NPR",
    originalAmount: new Prisma.Decimal("100.00"),
    allocatedAmount: new Prisma.Decimal("0.00"),
    remainingAmount: new Prisma.Decimal("100.00"),
    status: "OPEN",
    party: { partyType: "VENDOR", sourceEntityId: "VENDOR-1" },
  };
  const bill = {
    id: "bill-1",
    documentType: "BILL",
    documentNumber: "BILL-1",
    side: "PAYABLE",
    sourceType: "PROCUREMENT",
    sourceId: "shipment-1",
    issueDate: new Date("2026-01-02T00:00:00.000Z"),
    partyId: differentVendor ? "party-2" : "party-1",
    currency: "NPR",
    originalAmount: new Prisma.Decimal("150.00"),
    allocatedAmount: new Prisma.Decimal("0.00"),
    remainingAmount: new Prisma.Decimal("150.00"),
    status: "OPEN",
    party: { partyType: "VENDOR", sourceEntityId: differentVendor ? "VENDOR-2" : "VENDOR-1" },
  };
  const journal = {
    id: "journal-1",
    status: "POSTED",
    sourceType: "SUPPLIER_RETURN",
    sourceId: supplierReturn.id,
    totalDebit: new Prisma.Decimal("100.00"),
    totalCredit: new Prisma.Decimal("100.00"),
    lines: [
      {
        account: { accountCode: "2110" },
        accountingParty: { partyType: "VENDOR", sourceEntityId: "VENDOR-1" },
        debit: new Prisma.Decimal("100.00"),
      },
    ],
  };
  const state = { supplierReturn, credit, bill, journal, applications: [], allocations: [], auditCalls: 0 };
  const client = {
    $transaction: async (callback) => callback(client),
    supplierReturn: { findUnique: async () => state.supplierReturn },
    supplierReturnCreditApplication: {
      findUnique: async ({ where }) => state.applications.find((application) => application.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const application = { ...data };
        state.applications.push(application);
        return application;
      },
    },
    accountingDocument: {
      findUnique: async ({ where }) => [state.credit, state.bill].find((document) => document.id === where.id) || null,
      findMany: async ({ where }) => {
        assert.equal(where.issueDate.gte, state.supplierReturn.returnDate);
        return [state.bill];
      },
      updateMany: async ({ where, data }) => {
        const document = [state.credit, state.bill].find((entry) => entry.id === where.id);
        if (
          !document ||
          !document.allocatedAmount.equals(where.allocatedAmount) ||
          !document.remainingAmount.equals(where.remainingAmount) ||
          document.status !== where.status
        ) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
    },
    journalEntry: { findUnique: async () => state.journal },
    accountingAllocation: {
      createMany: async ({ data }) => {
        state.allocations.push(...data);
        return { count: data.length };
      },
    },
  };
  const writeAudit = async () => { state.auditCalls += 1; };
  return { client, state, writeAudit };
};

const buildInput = (overrides = {}) => ({
  supplierReturnId: "return-1",
  billDocumentId: "bill-1",
  amount: "40.00",
  idempotencyKey: "supplier-return-credit-1",
  notes: "Apply to future supplier invoice",
  ...overrides,
});

test("supplier return credit applies to a later payable bill for the same vendor", async () => {
  const { client, state, writeAudit } = createHarness();
  const result = await applySupplierReturnCreditToBill({
    ...buildInput(),
    appliedByAccountId: "admin-1",
    client,
    writeAudit,
  });

  assert.equal(result.journalEntryId, "journal-1");
  assert.equal(result.journalPostedForApplication, false);
  assert.equal(state.credit.remainingAmount.toFixed(2), "60.00");
  assert.equal(state.bill.remainingAmount.toFixed(2), "110.00");
  assert.equal(state.allocations.length, 2);
  assert.ok(state.allocations.every((allocation) => allocation.allocationType === "OFFSET"));
  assert.equal(state.auditCalls, 1);
});

test("supplier return credit cannot be applied to another vendor's bill", async () => {
  const { client } = createHarness({ differentVendor: true });
  await assert.rejects(
    applySupplierReturnCreditToBill({ ...buildInput(), client }),
    { code: "SUPPLIER_BILL_PARTY_MISMATCH" },
  );
});

test("supplier return credit cannot be applied to a bill dated before the return", async () => {
  const { client, state } = createHarness();
  state.bill.issueDate = new Date("2025-12-31T23:59:59.999Z");
  await assert.rejects(
    applySupplierReturnCreditToBill({ ...buildInput(), client }),
    { code: "SUPPLIER_BILL_PARTY_MISMATCH" },
  );
});

test("supplier return credit application replays by key and rejects changed payloads", async () => {
  const { client, state, writeAudit } = createHarness();
  const input = { ...buildInput(), client, writeAudit };
  const first = await applySupplierReturnCreditToBill(input);
  const replay = await applySupplierReturnCreditToBill(input);
  assert.equal(first.isReplay, undefined);
  assert.equal(replay.isReplay, true);
  assert.equal(state.applications.length, 1);
  assert.equal(state.allocations.length, 2);
  await assert.rejects(
    applySupplierReturnCreditToBill({ ...input, amount: "35.00" }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );
});

test("supplier credit bill selection is restricted to the same vendor and currency", async () => {
  const { client } = createHarness();
  const result = await getSupplierReturnApplicableBills({ supplierReturnId: "return-1", client });
  assert.equal(result.credit.id, "credit-1");
  assert.equal(result.bills.length, 1);
  assert.equal(result.bills[0].id, "bill-1");
});

test("historical supplier return reconciliation flags legacy receivables without changing them", async () => {
  const supplierReturn = {
    id: "legacy-return",
    supplierName: "Vendor One",
    supplierReference: null,
    totalDebitAmount: 100,
    settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
    status: "COMPLETED",
    accountingJournalEntryId: null,
    accountingDocumentId: null,
    cashTransactionId: null,
    returnDate: new Date("2025-01-01T00:00:00.000Z"),
  };
  let writeCalls = 0;
  const client = {
    supplierReturn: { findMany: async () => [supplierReturn] },
    accountingDocument: { findMany: async () => [] },
    journalEntry: { findMany: async () => [] },
    cashTransaction: { findMany: async () => [] },
    accountReceivable: {
      findMany: async () => [{
        id: "legacy-ar",
        referenceId: supplierReturn.id,
        totalAmount: 100,
        remainingBalance: 100,
        status: "UNPAID",
        category: "SUPPLIER_DEBIT_REFUND",
      }],
    },
    $executeRaw: async () => { writeCalls += 1; },
  };
  const report = await getSupplierReturnReconciliation({ client });
  assert.equal(report.total, 1);
  assert.equal(report.records[0].status, "LEGACY_RECEIVABLE_RECLASSIFICATION_REVIEW");
  assert.equal(report.records[0].evidence.legacyReceivableId, "legacy-ar");
  assert.deepEqual(report.summary, { LEGACY_RECEIVABLE_RECLASSIFICATION_REVIEW: 1 });
  assert.equal(writeCalls, 0);
});
