import assert from "node:assert/strict";
import test from "node:test";
import { redeemPartnerBenefit } from "../services/marketingPartnerService.js";

const makeHarness = ({ cpaRate = 25 } = {}) => {
  const committed = { redemptions: [], events: [] };
  const card = {
    id: "card-1",
    cardCode: "CARD-1",
    partnerId: "partner-1",
    physicalStatus: "ATTACHED",
    hasBenefit: true,
    benefitId: "benefit-1",
    benefit: { id: "benefit-1", name: "Test reward", value: 100, status: "ACTIVE" },
    campaign: { id: "campaign-1", cpaRate, cardExpiresAt: null },
    partner: { id: "partner-1", name: "Test partner" },
    customerLinks: [{ status: "ACTIVE", activatedAt: new Date("2026-11-09T00:00:00.000Z"), customerId: "customer-1" }],
  };

  const client = {
    $transaction: async (callback) => {
      const transactionState = { redemptions: [], events: [] };
      const tx = {
        marketingCard: {
          findFirst: async () => card,
        },
        marketingBenefitRedemption: {
          findFirst: async () => null,
          create: async ({ data }) => {
            const redemption = { id: "redemption-1", ...data, redeemedAt: new Date() };
            transactionState.redemptions.push(redemption);
            return redemption;
          },
        },
        marketingCardEvent: {
          create: async ({ data }) => {
            transactionState.events.push(data);
            return data;
          },
        },
      };

      const result = await callback(tx);
      committed.redemptions.push(...transactionState.redemptions);
      committed.events.push(...transactionState.events);
      return result;
    },
  };

  return { client, committed };
};

const request = { partnerId: "partner-1", cardCode: "CARD-1", benefitId: "benefit-1" };

test("marketing benefit redemption fails and rolls back when required CPA accounting fails", async () => {
  const { client, committed } = makeHarness();
  let posterClient;

  await assert.rejects(
    redeemPartnerBenefit(request, {
      client,
      expireCards: async () => {},
      postAccounting: async (input) => {
        posterClient = input.client;
        throw new Error("Accounting mapping unavailable");
      },
    }),
    /Accounting mapping unavailable/,
  );

  assert.ok(posterClient, "CPA poster must be called");
  assert.notEqual(posterClient, client, "CPA poster must use the active transaction client");
  assert.deepEqual(committed.redemptions, []);
  assert.deepEqual(committed.events, []);
});

test("marketing benefit redemption commits after required CPA accounting succeeds", async () => {
  const { client, committed } = makeHarness();
  let posterInput;
  let posterClient;

  const result = await redeemPartnerBenefit(request, {
    client,
    expireCards: async () => {},
    postAccounting: async (input) => {
      posterInput = input;
      posterClient = input.client;
      return { id: "journal-1" };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.redemptionId, "redemption-1");
  assert.equal(posterInput.redemption.id, result.redemptionId);
  assert.equal(posterInput.redemption.cpaRateSnapshot, "25");
  assert.equal(posterInput.campaign.id, "campaign-1");
  assert.equal(committed.events[0].referenceId, result.redemptionId);
  assert.equal(committed.events[0].metadata.cpaRateSnapshot, "25");
  assert.notEqual(posterClient, client, "CPA poster must use the active transaction client");
  assert.equal(committed.redemptions.length, 1);
  assert.equal(committed.events.length, 1);
});

test("zero-rate partner redemption snapshots the rate without invoking the CPA poster", async () => {
  const { client, committed } = makeHarness({ cpaRate: 0 });

  const result = await redeemPartnerBenefit(request, {
    client,
    expireCards: async () => {},
    postAccounting: async () => {
      throw new Error("Zero-rate redemption must not post CPA accounting.");
    },
  });

  assert.equal(result.success, true);
  assert.equal(committed.events[0].referenceId, result.redemptionId);
  assert.equal(committed.events[0].metadata.cpaRateSnapshot, "0");
  assert.equal(committed.redemptions.length, 1);
});
