import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recordPeerShareTransfer } from "../services/peerShareTransferService.js";

const createHarness = () => {
  const state = {
    partners: [
      { id: "seller", partnerName: "Seller", email: "seller@example.com", role: "FOUNDER", status: "ACTIVE", shareCount: 600, ownershipPercentage: 60, currentCapital: 600000 },
      { id: "buyer", partnerName: "Buyer", email: "buyer@example.com", role: "PARTNER", status: "ACTIVE", shareCount: 400, ownershipPercentage: 40, currentCapital: 400000 },
    ],
    shareTransactions: [],
  };
  const tx = {
    partnerEquity: {
      findUnique: async ({ where }) => state.partners.find((partner) =>
        (where.id && partner.id === where.id) || (where.email && partner.email === where.email)
      ) || null,
      findMany: async ({ where }) => state.partners.filter((partner) => where.status.in.includes(partner.status)),
      updateMany: async ({ where, data }) => {
        const partner = state.partners.find((row) =>
          row.id === where.id && row.shareCount === where.shareCount && row.status === where.status
        );
        if (!partner) return { count: 0 };
        Object.assign(partner, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        const partner = state.partners.find((row) => row.id === where.id);
        Object.assign(partner, data);
        return partner;
      },
      create: async ({ data }) => {
        if (state.partners.some((partner) => partner.email === data.email)) {
          throw Object.assign(new Error("Duplicate partner email"), { code: "P2002" });
        }
        const partner = { id: `partner-${state.partners.length + 1}`, ...data };
        state.partners.push(partner);
        return partner;
      },
    },
    shareTransaction: {
      findUnique: async ({ where }) => state.shareTransactions.find((row) => row.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (data.idempotencyKey && state.shareTransactions.some((row) => row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Duplicate share transfer"), { code: "P2002" });
        }
        const transaction = { id: `share-transaction-${state.shareTransactions.length + 1}`, ...data };
        state.shareTransactions.push(transaction);
        return transaction;
      },
    },
  };
  const client = {
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
      const before = JSON.parse(JSON.stringify(state));
      try {
        return await callback(tx);
      } catch (error) {
        state.partners = before.partners;
        state.shareTransactions = before.shareTransactions;
        throw error;
      }
    },
  };
  return { client, state, tx };
};

const baseRequest = {
  sellerPartnerId: "seller",
  buyerType: "EXISTING_PARTNER",
  buyerPartnerId: "buyer",
  sharesToTransfer: "100",
  sharePrice: "125.50",
  idempotencyKey: "peer-transfer-001",
};

test("peer transfer atomically moves existing-partner shares and preserves total shares", async () => {
  const { client, state, tx } = createHarness();
  const outcome = await recordPeerShareTransfer(baseRequest, { client });

  assert.equal(outcome.shares, 100);
  assert.equal(outcome.ownershipPercentage, 10);
  assert.equal(state.partners.find((partner) => partner.id === "seller").shareCount, 500);
  assert.equal(state.partners.find((partner) => partner.id === "seller").ownershipPercentage, 50);
  assert.equal(state.partners.find((partner) => partner.id === "buyer").shareCount, 500);
  assert.equal(state.partners.find((partner) => partner.id === "buyer").ownershipPercentage, 50);
  assert.equal(state.partners.reduce((sum, partner) => sum + partner.shareCount, 0), 1000);
  assert.equal(state.shareTransactions.length, 1);
  assert.equal(state.shareTransactions[0].settlementType, "PRIVATE_PEER_TO_PEER");
  assert.equal(state.shareTransactions[0].totalAmount, 12550);
  assert.equal(state.partners.find((partner) => partner.id === "buyer").currentCapital, 400000);
  assert.equal(state.partners.find((partner) => partner.id === "seller").currentCapital, 600000);
  assert.equal(state.shareTransactions[0].idempotencyKey.startsWith("PEER_SHARE_TRANSFER:"), true);
  assert.equal(state.shareTransactions[0].requestPayloadHash.length, 64);
});

test("peer transfer creates a new investor and exits a fully transferred seller", async () => {
  const { client, state } = createHarness();
  const outcome = await recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "NEW_INVESTOR",
    buyerName: "New Buyer",
    buyerEmail: "NEWBUYER@example.com",
    sharesToTransfer: "600",
    sharePrice: "100",
    idempotencyKey: "peer-transfer-new-001",
  }, { client });

  const seller = state.partners.find((partner) => partner.id === "seller");
  const buyer = state.partners.find((partner) => partner.email === "newbuyer@example.com");
  assert.equal(seller.status, "EXITED");
  assert.equal(seller.shareCount, 0);
  assert.equal(buyer.shareCount, 600);
  assert.equal(buyer.initialCapital, 0);
  assert.equal(buyer.currentCapital, 0);
  assert.equal(buyer.ownershipPercentage, 60);
  assert.equal(state.partners.find((partner) => partner.id === "buyer").ownershipPercentage, 40);
  assert.equal(outcome.buyerName, "New Buyer");
  assert.equal(state.shareTransactions.length, 1);
});

test("peer transfer retries return the same transaction and reject changed request payloads", async () => {
  const { client, state } = createHarness();
  const first = await recordPeerShareTransfer(baseRequest, { client });
  const replay = await recordPeerShareTransfer(baseRequest, { client });

  assert.equal(first.alreadyProcessed, false);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.transactionId, first.transactionId);
  assert.equal(state.shareTransactions.length, 1);
  assert.equal(state.partners.find((partner) => partner.id === "seller").shareCount, 500);
  await assert.rejects(
    recordPeerShareTransfer({ ...baseRequest, sharesToTransfer: "101" }, { client }),
    { statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED" },
  );
  assert.equal(state.shareTransactions.length, 1);
});

test("peer transfer prevents a new-investor record from duplicating an existing shareholder email", async () => {
  const { client, state } = createHarness();
  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "NEW_INVESTOR",
    buyerName: "Duplicate Buyer",
    buyerEmail: "BUYER@example.com",
    sharesToTransfer: 10,
    idempotencyKey: "peer-transfer-duplicate-email",
  }, { client }), { code: "BUYER_ALREADY_EXISTS" });
  assert.equal(state.partners.length, 2);
  assert.equal(state.shareTransactions.length, 0);
});

test("peer transfer rolls back all cap-table updates when the transaction-ledger write fails", async () => {
  const { client, state, tx } = createHarness();
  const before = JSON.stringify(state);
  client.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    const snapshot = JSON.parse(JSON.stringify(state));
    try {
      const failingTx = {
        ...tx,
        partnerEquity: {
          ...tx.partnerEquity,
        },
        shareTransaction: {
          ...tx.shareTransaction,
          create: async () => {
            throw new Error("share transaction write failed");
          },
        },
      };
      return await callback(failingTx);
    } catch (error) {
      state.partners = snapshot.partners;
      state.shareTransactions = snapshot.shareTransactions;
      throw error;
    }
  };

  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "EXISTING_PARTNER",
    buyerPartnerId: "buyer",
    sharesToTransfer: 100,
    idempotencyKey: "peer-transfer-rollback",
  }, { client }), /share transaction write failed/);
  assert.equal(JSON.stringify(state), before);
});

test("peer transfer rejects invalid parties, amounts, and insufficient shares without changes", async () => {
  const { client, state } = createHarness();
  const before = JSON.stringify(state);

  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "EXISTING_PARTNER",
    buyerPartnerId: "seller",
    sharesToTransfer: 1,
    idempotencyKey: "peer-transfer-invalid-party",
  }, { client }), /cannot be the same partner/);
  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "EXISTING_PARTNER",
    buyerPartnerId: "buyer",
    sharesToTransfer: 601,
    idempotencyKey: "peer-transfer-insufficient",
  }, { client }), { code: "INSUFFICIENT_SHARES" });
  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "NEW_INVESTOR",
    buyerName: "New",
    buyerEmail: "new@example.com",
    sharesToTransfer: "0.001",
    idempotencyKey: "peer-transfer-precision",
  }, { client }), /at most two decimals/);
  await assert.rejects(recordPeerShareTransfer({
    sellerPartnerId: "seller",
    buyerType: "EXISTING_PARTNER",
    buyerPartnerId: "buyer",
    sharesToTransfer: 1,
  }, { client }), { statusCode: 400, message: "A valid Idempotency-Key is required." });
  assert.equal(JSON.stringify(state), before);
});
