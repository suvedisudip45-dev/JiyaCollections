import assert from "node:assert/strict";
import test from "node:test";
import {
  accrueDistributorDeliveryEarning,
  accrueDistributorServiceCharge,
} from "../services/distributorServiceEarningService.js";

const createHarness = () => {
  const state = { earnings: [], journals: [], documents: [] };
  const client = {
    distributorServiceEarning: {
      findUnique: async ({ where }) => state.earnings.find((earning) => earning.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const earning = { id: `earning-${state.earnings.length + 1}`, ...data };
        state.earnings.push(earning);
        return earning;
      },
      update: async ({ where, data }) => {
        const earning = state.earnings.find((item) => item.id === where.id);
        Object.assign(earning, data);
        return earning;
      },
    },
    accountingParty: {
      upsert: async ({ create }) => ({ id: "party-1", ...create }),
    },
    accountingDocument: {
      upsert: async ({ create }) => {
        const document = { id: "document-1", ...create };
        state.documents.push(document);
        return document;
      },
    },
  };
  return { client, state };
};

test("delivery earning excludes new per-delivery incentives and snapshots the approved rate", async () => {
  const { client, state } = createHarness();
  const result = await accrueDistributorDeliveryEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    effectiveAt: new Date("2026-10-27T00:00:00.000Z"),
    client,
    rateCardResolver: async () => ({
      rateCardId: "rate-1",
      deliveryCharge: 200,
      bonusRate: 40,
      commissionRate: 10,
    }),
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "journal-1" };
    },
  });

  assert.equal(result.incentiveAmount.toString(), "0");
  assert.equal(result.payableAmount.toString(), "180");
  assert.equal(result.rateCardId, "rate-1");
  assert.equal(result.vatAmount.toString(), "0");
  assert.equal(result.accountingDocumentId, "document-1");
  assert.equal(result.journalEntryId, "journal-1");
  assert.equal(state.documents[0].side, "PAYABLE");
  assert.equal(state.documents[0].sourceType, "DISTRIBUTOR_SERVICE_EARNING");
  assert.equal(state.journals[0].lines[0].debit.toString(), "180");
  assert.equal(state.journals[0].lines[1].credit.toString(), "180");
});

test("delivery earning replay does not accrue a duplicate document or journal", async () => {
  const { client, state } = createHarness();
  const input = {
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    client,
    rateCardResolver: async () => ({ deliveryCharge: 100 }),
    journalPoster: async () => {
      state.journals.push("posted");
      return { id: "journal-1" };
    },
  };
  const first = await accrueDistributorDeliveryEarning(input);
  const replay = await accrueDistributorDeliveryEarning(input);

  assert.equal(first.id, replay.id);
  assert.equal(state.earnings.length, 1);
  assert.equal(state.documents.length, 1);
  assert.equal(state.journals.length, 1);
});

test("delivery earning rejects a commission larger than the contracted compensation", async () => {
  const { client } = createHarness();
  await assert.rejects(() => accrueDistributorDeliveryEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    client,
    rateCardResolver: async () => ({ deliveryCharge: 100, commissionRate: 150 }),
  }), /commission exceeds delivery compensation/);
});

test("return service charge is snapshotted and creates a payable earning document with VAT", async () => {
  const { client, state } = createHarness();
  const result = await accrueDistributorServiceCharge({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    sourceId: "return-1",
    serviceType: "RETURN",
    chargeAmount: 50,
    vatRate: 13,
    effectiveAt: new Date("2026-10-30T00:00:00.000Z"),
    client,
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "return-journal-1" };
    },
  });

  assert.equal(result.serviceType, "RETURN");
  assert.equal(result.otherCharges.toString(), "50");
  assert.equal(result.vatAmount.toString(), "6.5");
  assert.equal(result.payableAmount.toString(), "56.5");
  assert.equal(result.accountingDocumentId, "document-1");
  assert.equal(result.journalEntryId, "return-journal-1");
  assert.equal(state.documents[0].sourceType, "DISTRIBUTOR_SERVICE_EARNING");
  assert.equal(state.documents[0].originalAmount.toString(), "56.5");
  assert.equal(state.journals[0].lines[1].credit.toString(), "56.5");
});
