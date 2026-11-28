import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { getPartnerCards } from "../services/marketingPartnerService.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

test("marketing partner card list filters and categorizes expired campaign cards without changing physical status", async (t) => {
  const expiredByCampaign = {
    id: "campaign-expired-card",
    physicalStatus: "AVAILABLE",
    campaign: { status: "ACTIVE", endsAt: new Date(Date.now() - 60_000), cardExpiresAt: null },
  };
  const expiredByCard = {
    id: "card-expired-card",
    physicalStatus: "ATTACHED",
    campaign: { status: "ACTIVE", endsAt: null, cardExpiresAt: new Date(Date.now() - 60_000) },
  };
  const expiredStatus = {
    id: "campaign-status-card",
    physicalStatus: "CANCELLED",
    campaign: { status: "EXPIRED", endsAt: null, cardExpiresAt: null },
  };
  let queriedWhere;

  stubMethod(t, prisma, "$transaction", async (callback) => callback(prisma));
  stubMethod(t, prisma.marketingCard, "findMany", async ({ where }) => {
    if (where.physicalStatus?.in) return [];
    queriedWhere = where;
    return [expiredByCampaign, expiredByCard, expiredStatus];
  });
  stubMethod(t, prisma.marketingCard, "count", async ({ where }) => {
    assert.deepEqual(where, queriedWhere);
    return 3;
  });

  const [cards, total] = await getPartnerCards({
    partnerId: "partner-1",
    status: "EXPIRED",
    page: 1,
    limit: 25,
  });

  assert.equal(total, 3);
  assert.deepEqual(cards.map((card) => card.dashboardCategory), ["EXPIRED", "EXPIRED", "EXPIRED"]);
  assert.deepEqual(cards.map((card) => card.physicalStatus), ["AVAILABLE", "ATTACHED", "CANCELLED"]);
  assert.equal(queriedWhere.partnerId, "partner-1");
  assert.deepEqual(queriedWhere.campaign.OR.map((condition) => Object.keys(condition)[0]), [
    "status",
    "endsAt",
    "cardExpiresAt",
  ]);
  assert.equal(queriedWhere.physicalStatus, undefined);
});
