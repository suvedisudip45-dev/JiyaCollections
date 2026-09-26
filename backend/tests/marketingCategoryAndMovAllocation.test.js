import assert from "node:assert/strict";
import { campaignMatchesCategory } from "../services/marketingCardService.js";

console.log("▶ Testing Smart Category Matching Engine...");

// Test 1: General campaign matches any category
const generalCampaign = { targetCategories: [] };
const res1 = campaignMatchesCategory(generalCampaign, new Set(["women dresses", "kurthi"]));
assert.equal(res1.isTargeted, false, "General campaign should not be targeted");
assert.equal(res1.matches, true, "General campaign should match any order");

// Test 2: Targeted campaign matches when order has matching category
const dressesCampaign = { targetCategories: ["Women Dresses", "Party Gowns"] };
const orderCatsMatch = new Set(["women dresses", "cotton saree"]);
const res2 = campaignMatchesCategory(dressesCampaign, orderCatsMatch);
assert.equal(res2.isTargeted, true, "Campaign targeting dresses should be marked targeted");
assert.equal(res2.matches, true, "Should match when order contains 'women dresses'");

// Test 3: Targeted campaign does not match when order has unrelated categories
const orderCatsNoMatch = new Set(["men shirts", "jeans"]);
const res3 = campaignMatchesCategory(dressesCampaign, orderCatsNoMatch);
assert.equal(res3.isTargeted, true);
assert.equal(res3.matches, false, "Should not match when order has no overlapping dress categories");

// Test 4: String JSON targetCategories parsing
const stringJsonCampaign = { targetCategories: '["Jackets", "Hoodies"]' };
const orderJackets = new Set(["winter hoodies", "gloves"]);
const res4 = campaignMatchesCategory(stringJsonCampaign, orderJackets);
assert.equal(res4.isTargeted, true);
assert.equal(res4.matches, true, "Should parse JSON string categories and match substring");

console.log("✅ Smart Category Matching Engine tests passed!");

console.log("▶ Testing 6-Tier Weighted Random Allocation Math...");
// Verify weights:
// CAT_DISTRICT (10) + CAT_PROVINCE (8) + CAT_NATIONWIDE (6) + GEN_DISTRICT (5) + GEN_PROVINCE (3) + GEN_NATIONWIDE (2)
// Total weight = 34
const weights = {
  CAT_DISTRICT: 10,
  CAT_PROVINCE: 8,
  CAT_NATIONWIDE: 6,
  GEN_DISTRICT: 5,
  GEN_PROVINCE: 3,
  GEN_NATIONWIDE: 2,
};

const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
assert.equal(totalWeight, 34, "Total multi-tier weight should be 34");

// Simulate 100,000 draws
const counts = {
  CAT_DISTRICT: 0,
  CAT_PROVINCE: 0,
  CAT_NATIONWIDE: 0,
  GEN_DISTRICT: 0,
  GEN_PROVINCE: 0,
  GEN_NATIONWIDE: 0,
};

const activeTiers = Object.entries(weights).map(([tier, weight]) => ({ tier, weight }));
const N = 100000;

for (let i = 0; i < N; i++) {
  let randomWeight = Math.random() * totalWeight;
  let chosenTier = activeTiers[0].tier;
  for (const item of activeTiers) {
    if (randomWeight < item.weight) {
      chosenTier = item.tier;
      break;
    }
    randomWeight -= item.weight;
  }
  counts[chosenTier]++;
}

console.log("Allocated distribution for 100k simulated allocations:");
for (const [tier, count] of Object.entries(counts)) {
  const pct = (count / N) * 100;
  const expectedPct = (weights[tier] / totalWeight) * 100;
  console.log(`- ${tier.padEnd(16)}: ${pct.toFixed(2)}% (Expected: ${expectedPct.toFixed(2)}%)`);
  assert.ok(Math.abs(pct - expectedPct) < 1.0, `${tier} distribution deviated significantly`);
}

console.log("✅ 6-Tier Weighted Random Allocation verified successfully!");
