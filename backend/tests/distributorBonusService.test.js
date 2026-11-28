import assert from "node:assert/strict";
import test from "node:test";
import { getClosedDistributorBonusPreview } from "../services/distributorBonusService.js";

test("closed Kathmandu delivery periods calculate additive target tiers and current progress", async () => {
  const plan = {
    id: "plan-1",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    tiers: [
      { targetCount: 10, bonusAmount: "100.00" },
      { targetCount: 20, bonusAmount: "175.00" },
    ],
  };
  const client = {
    distributorBonusPlan: { findMany: async () => [plan] },
    distributorBonusEarning: { findFirst: async () => null },
    orderAssignment: {
      count: async ({ where }) => {
        const month = new Date(where.deliveredAt.gte.getTime() + 345 * 60 * 1000).getUTCMonth();
        if (month === 0) return 7;
        if (month === 1) return 24;
        return 6;
      },
    },
  };

  const preview = await getClosedDistributorBonusPreview({
    distributorId: "dist-1",
    now: new Date("2026-03-15T00:00:00.000Z"),
    client,
  });

  assert.deepEqual(preview.periods.map((period) => period.period), ["2026-02"]);
  assert.equal(preview.periods[0].eligibleDeliveryCount, 24);
  assert.equal(preview.periods[0].bonusAmount, "275.00");
  assert.equal(preview.periods[0].accrued, false);
  assert.equal(preview.projectedBonusTotal, 275);
  assert.equal(preview.currentPeriod.period, "2026-03");
  assert.equal(preview.currentPeriod.eligibleDeliveryCount, 6);
});
