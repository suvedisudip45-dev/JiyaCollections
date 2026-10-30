import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import {
  attachRandomCardToOrder,
  ensureOrderCardAttached,
  isMarketingCardAttachable,
} from "../services/marketingCardService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createHarness = (t, replacementCards = []) => {
  const now = Date.now();
  const releasedCards = [];
  const events = [];
  const order = {
    id: "order-1",
    amount: 1000,
    items: [{ name: "T-shirt" }],
    address: { province: "Bagmati Province", district: "Kathmandu" },
    marketingCardRequired: true,
    manufacturerId: null,
    distributorId: null,
  };
  const assignment = { manufacturerId: null, distributorId: "distributor-1" };
  const oldLink = {
    id: "old-link",
    cardId: "expired-card",
    orderId: order.id,
    card: {
      id: "expired-card",
      campaign: {
        status: "ACTIVE",
        endsAt: new Date(now - 60_000),
        cardExpiresAt: new Date(now + 86_400_000),
      },
    },
  };
  let orderLink = oldLink;

  const tx = {
    marketingCard: {
      findMany: async ({ where }) => where.physicalStatus?.in ? [] : replacementCards,
      updateMany: async ({ where, data }) => {
        releasedCards.push({ id: where.id, data });
        return { count: 1 };
      },
    },
    marketingCardEvent: {
      create: async ({ data }) => {
        events.push(data);
        return data;
      },
    },
    marketingCardOrder: {
      delete: async () => {
        orderLink = null;
        return {};
      },
      create: async ({ data }) => {
        orderLink = {
          id: "replacement-link",
          ...data,
          card: replacementCards.find((card) => card.id === data.cardId),
        };
        return orderLink;
      },
      findUnique: async ({ where }) => where.id === orderLink?.id ? orderLink : null,
    },
    order: {
      findUnique: async () => ({ ...order, marketingCardOrder: orderLink }),
    },
    orderAssignment: {
      findUnique: async () => assignment,
    },
  };

  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));
  return { events, releasedCards, getOrderLink: () => orderLink };
};

test("campaign cards cannot be attached when inactive or outside their campaign/card dates", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  assert.equal(isMarketingCardAttachable({ campaign: { status: "ACTIVE", endsAt: future, cardExpiresAt: future } }), true);
  assert.equal(isMarketingCardAttachable({ campaign: { status: "PAUSED", endsAt: future, cardExpiresAt: future } }), false);
  assert.equal(isMarketingCardAttachable({ campaign: { status: "ACTIVE", endsAt: past, cardExpiresAt: future } }), false);
  assert.equal(isMarketingCardAttachable({ campaign: { status: "ACTIVE", endsAt: future, cardExpiresAt: past } }), false);
});

test("attaching to an order releases an ended-campaign card and attaches an active replacement", async (t) => {
  const replacement = {
    id: "active-card",
    campaign: {
      status: "ACTIVE",
      endsAt: new Date(Date.now() + 86_400_000),
      cardExpiresAt: new Date(Date.now() + 172_800_000),
      targetScopeType: "NATIONWIDE",
      minOrderValue: 0,
      targetCategories: [],
    },
  };
  const harness = createHarness(t, [replacement]);

  const link = await attachRandomCardToOrder({
    orderId: "order-1",
    distributorId: "distributor-1",
  });

  assert.equal(link.cardId, replacement.id);
  assert.equal(harness.getOrderLink().cardId, replacement.id);
  assert.equal(harness.releasedCards[0].id, "expired-card");
  assert.equal(harness.releasedCards[0].data.physicalStatus, "CANCELLED");
  assert.equal(harness.events[0].metadata.reason, "CAMPAIGN_ENDED_BEFORE_ORDER_PLACEMENT");
});

test("fulfillment handoff rejects an attached card from an ended campaign", async () => {
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        marketingCardRequired: true,
        marketingCardOrder: {
          card: {
            campaign: {
              status: "ACTIVE",
              endsAt: new Date(Date.now() - 60_000),
              cardExpiresAt: new Date(Date.now() + 86_400_000),
            },
          },
        },
      }),
    },
    platformFeatureConfig: {
      findUnique: async () => ({ marketingCardsEnabled: true }),
    },
  };

  await assert.rejects(
    ensureOrderCardAttached({ tx, orderId: "order-1", distributorId: "distributor-1" }),
    (error) => error.code === "MARKETING_CARD_REATTACH_REQUIRED"
  );
});
