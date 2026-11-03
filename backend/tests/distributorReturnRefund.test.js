import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  reviewDistributorCustomerRefund,
  submitDistributorCustomerRefund,
} from "../services/distributorReturnRefundService.js";

const createHarness = () => {
  const state = {
    returnRecord: {
      id: "return-1",
      distributorId: "dist-1",
      deliveryRoute: "DISTRIBUTOR",
      lifecycleStatus: "REFUND_PENDING",
      refundStatus: "PENDING",
      approvedAt: new Date("2026-10-01T10:00:00.000Z"),
      inspectedAt: new Date("2026-10-02T10:00:00.000Z"),
      totalRefundAmount: 1000,
      approvedRefundAmount: new Prisma.Decimal("875.50"),
      refundPolicySnapshot: { chargeRatePercent: 5, vatRatePercent: "13.00", originalDeliveryFeeRefunded: false },
    },
    cashEvents: [],
    returnEvents: [],
    audits: [],
  };
  const matches = (record, where) => Object.entries(where).every(([key, value]) => (
    key === "status" && value?.in ? value.in.includes(record[key]) : record[key] === value
  ));
  const tx = {
    customerReturn: {
      findFirst: async ({ where }) => matches(state.returnRecord, where) ? state.returnRecord : null,
      updateMany: async ({ where, data }) => {
        if (!matches(state.returnRecord, where)) return { count: 0 };
        Object.assign(state.returnRecord, data);
        return { count: 1 };
      },
    },
    distributorCashEvent: {
      findUnique: async ({ where }) => state.cashEvents.find((event) => event.idempotencyKey === where.idempotencyKey) || null,
      findFirst: async ({ where }) => state.cashEvents.find((event) =>
        Object.entries(where).every(([key, value]) => (
          key === "status" && value?.in ? value.in.includes(event.status) : event[key] === value
        ))
      ) || null,
      create: async ({ data }) => {
        const event = { id: `cash-${state.cashEvents.length + 1}`, ...data };
        state.cashEvents.push(event);
        return event;
      },
      updateMany: async ({ where, data }) => {
        const event = state.cashEvents.find((candidate) =>
          Object.entries(where).every(([key, value]) => candidate[key] === value)
        );
        if (!event) return { count: 0 };
        Object.assign(event, data);
        return { count: 1 };
      },
    },
    customerReturnEvent: {
      create: async ({ data }) => {
        const event = { id: `return-event-${state.returnEvents.length + 1}`, ...data };
        state.returnEvents.push(event);
        return event;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: `audit-${state.audits.length}` };
      },
    },
  };
  return { state, client: { $transaction: async (callback) => callback(tx) } };
};

const submission = (client, overrides = {}) => submitDistributorCustomerRefund({
  distributorId: "dist-1",
  returnId: "return-1",
  amount: "875.50",
  adjustmentReason: "",
  paymentMethod: "CASH",
  externalReference: "cash receipt 42",
  evidenceUrl: "https://evidence.example/receipt-42",
  idempotencyKey: "refund-submit-1",
  recordedByAccountId: "account-1",
  client,
  now: new Date("2026-10-03T10:00:00.000Z"),
  ...overrides,
});

test("distributor refund submission accepts the approved amount and is idempotent", async () => {
  const { state, client } = createHarness();
  const first = await submission(client);
  assert.equal(first.isReplay, false);
  assert.equal(first.cashEvent.status, "PENDING_VERIFICATION");
  assert.equal(first.cashEvent.amount.toFixed(2), "875.50");
  assert.equal(state.returnRecord.lifecycleStatus, "DISTRIBUTOR_REFUND_REVIEW");
  assert.equal(state.returnRecord.refundStatus, "PROCESSING");

  const replay = await submission(client);
  assert.equal(replay.isReplay, true);
  await assert.rejects(
    () => submission(client, { amount: "875.49" }),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.statusCode === 409,
  );
  await assert.rejects(
    () => submission(client, { idempotencyKey: "refund-submit-2" }),
    (error) => error.code === "REFUND_ALREADY_SUBMITTED" && error.statusCode === 409,
  );
});

test("distributor refund amount changes require a reason and are bounded by returned product value", async () => {
  const { state, client } = createHarness();
  await assert.rejects(
    () => submission(client, { amount: "800.00", idempotencyKey: "refund-adjustment-1" }),
    (error) => error.code === "REFUND_ADJUSTMENT_REASON_REQUIRED" && error.statusCode === 400,
  );
  await assert.rejects(
    () => submission(client, { amount: "1000.01", adjustmentReason: "Goodwill adjustment", idempotencyKey: "refund-adjustment-2" }),
    (error) => error.code === "REFUND_AMOUNT_EXCEEDS_RETURN_VALUE" && error.statusCode === 400,
  );

  const result = await submission(client, {
    amount: "800.00",
    adjustmentReason: "Customer returned one sealed item only.",
    idempotencyKey: "refund-adjustment-3",
  });
  assert.equal(result.cashEvent.amount.toFixed(2), "800.00");
  assert.equal(result.cashEvent.notes, "Customer returned one sealed item only.");
  assert.equal(state.returnRecord.approvedRefundAmount.toFixed(2), "875.50");
});

test("Admin rejection releases the return for a corrected distributor refund submission", async () => {
  const { state, client } = createHarness();
  await submission(client);
  const rejected = await reviewDistributorCustomerRefund({
    distributorId: "dist-1",
    returnId: "return-1",
    decision: "REJECT",
    reviewNotes: "Receipt is not legible",
    reviewerAccountId: "admin-1",
    client,
  });
  assert.equal(rejected.decision, "REJECTED");
  assert.equal(state.cashEvents[0].status, "REJECTED");
  assert.equal(state.returnRecord.lifecycleStatus, "REFUND_PENDING");
  assert.equal(state.returnRecord.refundStatus, "PENDING");
  assert.equal(state.audits.length, 2);

  const resubmitted = await submission(client, { idempotencyKey: "refund-submit-2" });
  assert.equal(resubmitted.isReplay, false);
  assert.equal(state.cashEvents.length, 2);
});

test("Admin verification accounts for the submitted amount and preserves the adjustment reason", async () => {
  const { state, client: baseClient } = createHarness();
  await submission(baseClient, {
    amount: "800.00",
    adjustmentReason: "Customer returned one sealed item only.",
    idempotencyKey: "refund-adjustment-verify",
  });
  let postedReturn;
  const client = {
    $transaction: async (callback) => baseClient.$transaction((innerTx) => callback({
        ...innerTx,
        distributor: { findUnique: async () => ({ name: "Test Distributor" }) },
        accountingDocument: { findUnique: async () => ({ id: "document-1" }) },
      })),
  };
  const result = await reviewDistributorCustomerRefund({
    distributorId: "dist-1",
    returnId: "return-1",
    decision: "VERIFY",
    reviewerAccountId: "admin-1",
    client,
    postRefundAccounting: async ({ returnRecord }) => {
      postedReturn = returnRecord;
      return { id: "journal-1", journalNumber: "JE-1" };
    },
    reverseCounterSaleEarning: async () => null,
  });

  assert.equal(result.decision, "VERIFIED");
  assert.equal(postedReturn.approvedRefundAmount.toFixed(2), "800.00");
  assert.equal(postedReturn.vatRefunded, 92.04);
  assert.equal(state.returnRecord.approvedRefundAmount.toFixed(2), "800.00");
  assert.equal(state.returnRecord.vatRefunded, 92.04);
  assert.match(state.cashEvents[0].notes, /Distributor adjustment reason: Customer returned one sealed item only\./);
});

test("verification retry after a committed distributor refund returns its existing accounting references", async () => {
  const { state, client } = createHarness();
  state.returnRecord.lifecycleStatus = "REFUNDED";
  state.returnRecord.refundStatus = "COMPLETED";
  state.cashEvents.push({
    id: "cash-1",
    distributorId: "dist-1",
    customerReturnId: "return-1",
    eventType: "CUSTOMER_REFUND",
    status: "POSTED",
    accountingDocumentId: "doc-1",
    journalEntryId: "journal-1",
  });
  const result = await reviewDistributorCustomerRefund({
    distributorId: "dist-1",
    returnId: "return-1",
    decision: "VERIFY",
    client,
  });
  assert.equal(result.isReplay, true);
  assert.equal(result.accountingDocumentId, "doc-1");
  assert.equal(result.journalEntryId, "journal-1");
});

test("distributor refund evidence and payment details are validated", async () => {
  const { client } = createHarness();
  await assert.rejects(
    () => submission(client, { evidenceUrl: "http://insecure.example/receipt" }),
    (error) => error.code === "INVALID_REFUND_EVIDENCE",
  );
  await assert.rejects(
    () => submission(client, { paymentMethod: "BANK_TRANSFER", externalReference: null }),
    (error) => error.code === "REFUND_REFERENCE_REQUIRED",
  );
});
