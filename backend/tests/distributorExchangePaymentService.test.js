import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  reviewDistributorExchangePaymentEvidence,
  submitDistributorExchangePaymentEvidence,
} from "../services/distributorExchangePaymentService.js";

const createHarness = (priceDifference = "250.00") => {
  const state = {
    request: {
      id: "exchange-1",
      deliveryRoute: "NCM",
      settlementDistributorId: "dist-1",
      status: "NCM_CREATED",
      priceDifference: new Prisma.Decimal(priceDifference),
      exchangeJournalEntryId: "journal-1",
    },
    cashEvents: [],
    exchangeEvents: [],
    audits: [],
  };
  const matches = (record, where) => Object.entries(where).every(([key, value]) => (
    value?.in ? value.in.includes(record[key]) : record[key] === value
  ));
  const tx = {
    orderExchangeRequest: {
      findFirst: async ({ where }) => matches(state.request, where) ? state.request : null,
    },
    distributorCashEvent: {
      findUnique: async ({ where }) => state.cashEvents.find((event) => event.idempotencyKey === where.idempotencyKey) || null,
      findFirst: async ({ where }) => state.cashEvents.find((event) => matches(event, where)) || null,
      create: async ({ data }) => {
        const event = { id: `cash-${state.cashEvents.length + 1}`, ...data };
        state.cashEvents.push(event);
        return event;
      },
      updateMany: async ({ where, data }) => {
        const event = state.cashEvents.find((candidate) => matches(candidate, where));
        if (!event) return { count: 0 };
        Object.assign(event, data);
        return { count: 1 };
      },
    },
    accountingDocument: {
      findUnique: async ({ where }) => ({ id: `document-${where.idempotencyKey}` }),
    },
    orderExchangeEvent: {
      create: async ({ data }) => {
        state.exchangeEvents.push(data);
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
  return { state, client: { $transaction: async (callback) => callback(tx) } };
};

const submit = (client, overrides = {}) => submitDistributorExchangePaymentEvidence({
  distributorId: "dist-1",
  requestId: "exchange-1",
  amount: "250.00",
  paymentMethod: "MOBILE_WALLET",
  externalReference: "wallet-tx-1",
  evidenceUrl: "https://res.cloudinary.com/test/payment.png",
  idempotencyKey: "exchange-payment-1",
  recordedByAccountId: "account-1",
  client,
  now: new Date("2026-10-10T10:00:00.000Z"),
  ...overrides,
});

test("NCM exchange payment evidence is exact, audited, and idempotent", async () => {
  const { state, client } = createHarness();
  const first = await submit(client);
  assert.equal(first.isReplay, false);
  assert.equal(first.cashEvent.eventType, "EXCHANGE_UPGRADE_COLLECTION");
  assert.equal(first.cashEvent.status, "PENDING_VERIFICATION");
  assert.equal(state.exchangeEvents[0].eventType, "DISTRIBUTOR_PAYMENT_EVIDENCE_SUBMITTED");
  assert.equal(state.audits.length, 1);

  const replay = await submit(client);
  assert.equal(replay.isReplay, true);
  await assert.rejects(
    () => submit(client, { amount: "249.99" }),
    (error) => error.code === "EXCHANGE_PAYMENT_AMOUNT_MISMATCH",
  );
  await assert.rejects(
    () => submit(client, { idempotencyKey: "exchange-payment-2" }),
    (error) => error.code === "EXCHANGE_PAYMENT_ALREADY_SUBMITTED",
  );
});

test("NCM exchange downgrade evidence records a distributor-paid customer refund", async () => {
  const { state, client } = createHarness("-175.50");
  const result = await submit(client, { amount: "175.50" });
  assert.equal(result.cashEvent.eventType, "EXCHANGE_DOWNGRADE_REFUND");
  assert.equal(result.cashEvent.amount.toFixed(2), "175.50");
  assert.equal(state.request.settlementDistributorId, "dist-1");
});

test("Admin can verify distributor payment evidence and link an existing accounting document", async () => {
  const { state, client } = createHarness("-175.50");
  const submitted = await submit(client, {
    amount: "175.50",
    idempotencyKey: "exchange-refund-1",
  });
  const result = await reviewDistributorExchangePaymentEvidence({
    requestId: "exchange-1",
    cashEventId: submitted.cashEvent.id,
    decision: "VERIFY",
    reviewerAccountId: "admin-1",
    actorContext: { ipAddress: "127.0.0.1" },
    client,
    now: new Date("2026-10-11T10:00:00.000Z"),
  });

  assert.equal(result.decision, "VERIFIED");
  assert.equal(state.cashEvents[0].status, "VERIFIED");
  assert.equal(state.cashEvents[0].accountingDocumentId, "document-DISTRIBUTOR_CUSTOMER_REFUND:EXCHANGE-exchange-1");
  assert.equal(state.cashEvents[0].journalEntryId, "journal-1");
});

test("Admin rejection allows corrected NCM exchange payment evidence", async () => {
  const { state, client } = createHarness();
  const submitted = await submit(client);
  const result = await reviewDistributorExchangePaymentEvidence({
    requestId: "exchange-1",
    cashEventId: submitted.cashEvent.id,
    decision: "REJECT",
    reviewNotes: "Screenshot does not show the transaction",
    reviewerAccountId: "admin-1",
    client,
  });
  assert.equal(result.decision, "REJECTED");
  assert.equal(state.cashEvents[0].status, "REJECTED");

  const corrected = await submit(client, { idempotencyKey: "exchange-payment-2" });
  assert.equal(corrected.isReplay, false);
  assert.equal(state.cashEvents.length, 2);
});
