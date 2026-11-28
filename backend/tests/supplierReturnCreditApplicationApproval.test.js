import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import test from "node:test";
import {
  requestAccountingActionApproval,
  reviewAccountingActionApproval,
} from "../services/accountingActionApprovalService.js";

const decimal = (value) => new Prisma.Decimal(value);

const createHarness = () => {
  const state = {
    approval: null,
    approvalEvents: [],
    auditEvents: [],
    applications: [],
    allocations: [],
    journalWrites: 0,
    supplierReturn: {
      id: "return-1",
      supplierName: "Vendor One",
      supplierReference: "VENDOR-1",
      totalDebitAmount: decimal("100.00"),
      settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
      status: "COMPLETED",
      accountingDocumentId: "credit-1",
      accountingJournalEntryId: "journal-1",
      returnDate: new Date("2026-01-01T00:00:00.000Z"),
    },
    credit: {
      id: "credit-1",
      documentType: "CREDIT_NOTE",
      documentNumber: "SRCN-1",
      side: "PAYABLE",
      sourceType: "SUPPLIER_RETURN",
      sourceId: "return-1",
      partyId: "party-1",
      currency: "NPR",
      originalAmount: decimal("100.00"),
      allocatedAmount: decimal("0.00"),
      remainingAmount: decimal("100.00"),
      status: "OPEN",
      party: { partyType: "VENDOR", sourceEntityId: "VENDOR-1" },
    },
    bill: {
      id: "bill-1",
      documentType: "BILL",
      documentNumber: "BILL-1",
      side: "PAYABLE",
      sourceType: "PROCUREMENT",
      sourceId: "shipment-1",
      issueDate: new Date("2026-01-02T00:00:00.000Z"),
      partyId: "party-1",
      currency: "NPR",
      originalAmount: decimal("150.00"),
      allocatedAmount: decimal("0.00"),
      remainingAmount: decimal("150.00"),
      status: "OPEN",
      party: { partyType: "VENDOR", sourceEntityId: "VENDOR-1" },
    },
    journal: {
      id: "journal-1",
      status: "POSTED",
      sourceType: "SUPPLIER_RETURN",
      sourceId: "return-1",
      totalDebit: decimal("100.00"),
      totalCredit: decimal("100.00"),
      lines: [{
        account: { accountCode: "2110" },
        accountingParty: { partyType: "VENDOR", sourceEntityId: "VENDOR-1" },
        debit: decimal("100.00"),
      }],
    },
  };

  const tx = {
    accountingActionApproval: {
      findUnique: async ({ where, include }) => {
        const approval = where.id
          ? state.approval?.id === where.id ? state.approval : null
          : state.approval?.requestKey === where.requestKey ? state.approval : null;
        if (!approval) return null;
        return include?.events
          ? { ...approval, events: [...state.approvalEvents].sort((a, b) => b.sequence - a.sequence).slice(0, include.events.take || undefined) }
          : approval;
      },
      create: async ({ data }) => {
        state.approval = { id: "approval-1", ...data, status: "PENDING", createdAt: new Date() };
        return state.approval;
      },
      updateMany: async ({ where, data }) => {
        if (state.approval?.id !== where.id || state.approval.status !== where.status) return { count: 0 };
        state.approval = { ...state.approval, ...data };
        return { count: 1 };
      },
    },
    accountingActionApprovalEvent: {
      create: async ({ data }) => {
        const event = { id: `approval-event-${state.approvalEvents.length + 1}`, ...data };
        state.approvalEvents.push(event);
        return event;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.auditEvents.push(data.event);
        return { id: data.id };
      },
    },
    supplierReturn: {
      findUnique: async ({ where }) => where.id === state.supplierReturn.id ? state.supplierReturn : null,
    },
    accountingDocument: {
      findUnique: async ({ where }) => [state.credit, state.bill].find((document) => document.id === where.id) || null,
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
    journalEntry: {
      findUnique: async ({ where }) => where.id === state.journal.id ? state.journal : null,
      create: async () => { state.journalWrites += 1; },
    },
    supplierReturnCreditApplication: {
      findUnique: async ({ where }) => state.applications.find((application) => application.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const application = { id: `application-${state.applications.length + 1}`, ...data };
        state.applications.push(application);
        return application;
      },
    },
    accountPayable: { findFirst: async () => null },
    accountingAllocation: {
      createMany: async ({ data }) => {
        state.allocations.push(...data);
        return { count: data.length };
      },
    },
  };

  return {
    state,
    client: { $transaction: async (callback) => callback(tx) },
  };
};

const requestCreditApplication = (client, overrides = {}) => requestAccountingActionApproval({
  actionType: "SUPPLIER_RETURN_CREDIT_APPLICATION",
  requestKey: "supplier-credit-application-request-1",
  payload: {
    supplierReturnId: "return-1",
    billDocumentId: "bill-1",
    amount: "40.00",
    reason: "Apply the approved supplier credit to this bill.",
  },
  actor: { accountId: "maker-1", role: "ADMIN" },
  client,
  ...overrides,
});

const review = (client, approvalId, overrides = {}) => reviewAccountingActionApproval({
  approvalId,
  decision: "APPROVE",
  reason: "Verified the matching supplier documents.",
  actor: { accountId: "checker-1", role: "ADMIN" },
  client,
  ...overrides,
});

test("supplier credit request is pending and does not mutate balances before approval", async () => {
  const { client, state } = createHarness();
  const result = await requestCreditApplication(client);

  assert.equal(result.approvalRequest.status, "PENDING");
  assert.equal(result.approvalRequest.makerAccountId, "maker-1");
  assert.ok(result.approvalRequest.createdAt instanceof Date);
  assert.equal(state.approvalEvents[0].eventType, "SUBMITTED");
  assert.equal(state.applications.length, 0);
  assert.equal(state.allocations.length, 0);
  assert.equal(state.credit.remainingAmount.toFixed(2), "100.00");
  assert.equal(state.bill.remainingAmount.toFixed(2), "150.00");
});

test("independent Admin approval applies the credit and records reviewer and source linkage", async () => {
  const { client, state } = createHarness();
  const submitted = await requestCreditApplication(client);
  const result = await review(client, submitted.approvalRequest.id);

  assert.equal(result.approvalRequest.status, "APPROVED");
  assert.equal(result.approvalRequest.reviewerAccountId, "checker-1");
  assert.equal(state.credit.remainingAmount.toFixed(2), "60.00");
  assert.equal(state.bill.remainingAmount.toFixed(2), "110.00");
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].appliedByAccountId, "checker-1");
  assert.equal(state.applications[0].journalEntryId, "journal-1");
  assert.equal(state.allocations.length, 2);
  assert.ok(state.allocations.every((allocation) => allocation.journalEntryId === "journal-1"));
  assert.equal(state.journalWrites, 0);
  assert.deepEqual(state.approvalEvents.map((event) => event.eventType), ["SUBMITTED", "APPROVED"]);
  assert.ok(state.auditEvents.some((event) => event.action === "SUPPLIER_RETURN_CREDIT_APPLIED" && event.actorId === "checker-1"));
  assert.ok(state.auditEvents.some((event) => event.action === "ACCOUNTING_ACTION_APPROVED" && event.actorId === "checker-1"));
});

test("unauthorized and self-approval are rejected without financial mutation", async () => {
  const { client, state } = createHarness();
  const submitted = await requestCreditApplication(client);

  await assert.rejects(
    review(client, submitted.approvalRequest.id, { actor: { accountId: "other-1", role: "MANAGER" } }),
    { code: "ADMIN_REQUIRED" },
  );
  await assert.rejects(
    review(client, submitted.approvalRequest.id, { actor: { accountId: "maker-1", role: "ADMIN" } }),
    { code: "MAKER_CANNOT_REVIEW" },
  );
  assert.equal(state.applications.length, 0);
  assert.equal(state.credit.remainingAmount.toFixed(2), "100.00");
  assert.equal(state.bill.remainingAmount.toFixed(2), "150.00");
});

test("rejection does not apply the credit and records the rejecting checker", async () => {
  const { client, state } = createHarness();
  const submitted = await requestCreditApplication(client);
  const result = await review(client, submitted.approvalRequest.id, {
    decision: "REJECT",
    reason: "The bill evidence does not support this application.",
  });

  assert.equal(result.approvalRequest.status, "REJECTED");
  assert.equal(result.approvalRequest.reviewerAccountId, "checker-1");
  assert.equal(state.applications.length, 0);
  assert.equal(state.allocations.length, 0);
  assert.equal(state.credit.remainingAmount.toFixed(2), "100.00");
  assert.equal(state.bill.remainingAmount.toFixed(2), "150.00");
  assert.deepEqual(state.approvalEvents.map((event) => event.eventType), ["SUBMITTED", "REJECTED"]);
});

test("request and approval replays are idempotent and changed-payload replay conflicts", async () => {
  const { client, state } = createHarness();
  const submitted = await requestCreditApplication(client);
  const replayedRequest = await requestCreditApplication(client);
  assert.equal(replayedRequest.isReplay, true);

  await assert.rejects(
    requestCreditApplication(client, {
      payload: {
        supplierReturnId: "return-1",
        billDocumentId: "bill-1",
        amount: "35.00",
        reason: "Apply a changed amount to this supplier bill.",
      },
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  );

  const result = await review(client, submitted.approvalRequest.id);
  const replayedReview = await review(client, submitted.approvalRequest.id);
  assert.equal(result.isReplay, false);
  assert.equal(replayedReview.isReplay, true);
  assert.equal(state.applications.length, 1);
  assert.equal(state.allocations.length, 2);
});

test("supplier identity, bill currency, and remaining credit are revalidated at approval", async (t) => {
  const cases = [
    {
      name: "credit ownership mismatch",
      mutate: (state) => { state.credit.sourceId = "another-return"; },
      code: "SUPPLIER_RETURN_ACCOUNTING_MISMATCH",
    },
    {
      name: "supplier mismatch",
      mutate: (state) => { state.bill.party.sourceEntityId = "VENDOR-2"; },
      code: "SUPPLIER_BILL_PARTY_MISMATCH",
    },
    {
      name: "bill date mismatch",
      mutate: (state) => { state.bill.issueDate = new Date("2025-12-31T23:59:59.999Z"); },
      code: "SUPPLIER_BILL_PARTY_MISMATCH",
    },
    {
      name: "currency mismatch",
      mutate: (state) => { state.bill.currency = "USD"; },
      code: "SUPPLIER_BILL_PARTY_MISMATCH",
    },
    {
      name: "insufficient remaining credit",
      mutate: (state) => {
        state.credit.remainingAmount = decimal("10.00");
        state.credit.allocatedAmount = decimal("90.00");
        state.credit.status = "PARTIALLY_PAID";
      },
      code: "CREDIT_APPLICATION_EXCEEDS_BALANCE",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { client, state } = createHarness();
      const submitted = await requestCreditApplication(client);
      scenario.mutate(state);

      await assert.rejects(review(client, submitted.approvalRequest.id), { code: scenario.code });
      assert.equal(state.applications.length, 0);
      assert.equal(state.allocations.length, 0);
    });
  }
});

test("credit request requires a decimal string and applies the approved NPR HALF_EVEN boundary", async () => {
  const { client, state } = createHarness();
  await assert.rejects(
    requestCreditApplication(client, {
      payload: {
        supplierReturnId: "return-1",
        billDocumentId: "bill-1",
        amount: 40,
        reason: "Reject JavaScript Number as an authoritative amount.",
      },
    }),
    { code: "INVALID_AMOUNT" },
  );

  const submitted = await requestCreditApplication(client, {
    payload: {
      supplierReturnId: "return-1",
      billDocumentId: "bill-1",
      amount: "40.005",
      reason: "Use the shared NPR rounding policy.",
    },
  });
  assert.equal(submitted.approvalRequest.payload.amount, "40.00");
  await review(client, submitted.approvalRequest.id);
  assert.equal(state.applications[0].amount.toFixed(2), "40.00");
});
