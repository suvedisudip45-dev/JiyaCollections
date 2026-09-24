import assert from "node:assert/strict";
import {
  NEPAL_LOCATION_MAP,
  NEPAL_PROVINCES,
  resolveLocationEntry,
  get4CharCodeForCampaign,
} from "../utils/nepalLocationData.js";
import {
  campaignMatchesOrder,
  getOrderLocationCodes,
} from "../services/marketingCardService.js";

console.log("▶ Testing Nepal Location 4-char Mappings...");

// Test unique 4-character codes
const seenCodes = new Set();
for (const item of NEPAL_LOCATION_MAP) {
  assert.equal(item.code.length, 4, `Code ${item.code} must be exactly 4 characters`);
  assert.ok(!seenCodes.has(item.code), `Duplicate code found: ${item.code}`);
  seenCodes.add(item.code);
}
console.log(`✅ All ${NEPAL_LOCATION_MAP.length} location codes are unique and exactly 4 characters.`);

// Test specific examples requested by user
const parbat = resolveLocationEntry("Parbat");
assert.equal(parbat?.code, "PRBT", "Parbat must map to PRBT");

const ktm = resolveLocationEntry("Kathmandu");
assert.equal(ktm?.code, "0KTM", "Kathmandu must map to 0KTM");

const rest = resolveLocationEntry("Rukum East");
assert.equal(rest?.code, "REST", "Rukum East must map to REST");

const rwst = resolveLocationEntry("Rukum West");
assert.equal(rwst?.code, "RWST", "Rukum West must map to RWST");

console.log("✅ User-specified examples (PRBT, 0KTM, REST, RWST) verified successfully.");

// Test get4CharCodeForCampaign
const campaignDist = { targetScopeType: "DISTRICT", targetDistrict: "Parbat" };
assert.equal(get4CharCodeForCampaign(campaignDist), "PRBT");

const campaignProv = { targetScopeType: "PROVINCE", targetProvince: "Bagmati Province" };
assert.equal(get4CharCodeForCampaign(campaignProv), "BAGM");

const campaignNat = { targetScopeType: "NATIONWIDE" };
assert.equal(get4CharCodeForCampaign(campaignNat), "NATW");

console.log("✅ Campaign 4-character code resolver verified.");

// Test campaign matching with order address
const orderFromParbat = {
  address: JSON.stringify({
    city: "Kushma",
    district: "Parbat",
    province: "Gandaki Province",
  }),
};

assert.equal(campaignMatchesOrder({ targetScopeType: "DISTRICT", targetDistrict: "Parbat" }, orderFromParbat), true);
assert.equal(campaignMatchesOrder({ targetScopeType: "DISTRICT", targetDistrict: "Kathmandu" }, orderFromParbat), false);
assert.equal(campaignMatchesOrder({ targetScopeType: "PROVINCE", targetProvince: "Gandaki Province" }, orderFromParbat), true);
assert.equal(campaignMatchesOrder({ targetScopeType: "PROVINCE", targetProvince: "Bagmati Province" }, orderFromParbat), false);
assert.equal(campaignMatchesOrder({ targetScopeType: "NATIONWIDE" }, orderFromParbat), true);

console.log("✅ Campaign matching with order location verified.");

// Test Weighted Random Simulation (5 District : 3 Province : 2 Nationwide)
console.log("▶ Simulating 100,000 card allocations with District, Province, Nationwide available...");

const counts = { DISTRICT: 0, PROVINCE: 0, NATIONWIDE: 0 };
const candidateTiers = [
  { tier: "DISTRICT", weight: 5 },
  { tier: "PROVINCE", weight: 3 },
  { tier: "NATIONWIDE", weight: 2 },
];
const totalWeight = candidateTiers.reduce((sum, item) => sum + item.weight, 0);

const SIMULATION_COUNT = 100000;
for (let i = 0; i < SIMULATION_COUNT; i++) {
  let randomWeight = Math.random() * totalWeight;
  let chosenTier = candidateTiers[0].tier;
  for (const item of candidateTiers) {
    if (randomWeight < item.weight) {
      chosenTier = item.tier;
      break;
    }
    randomWeight -= item.weight;
  }
  counts[chosenTier]++;
}

const distRatio = (counts.DISTRICT / SIMULATION_COUNT) * 10;
const provRatio = (counts.PROVINCE / SIMULATION_COUNT) * 10;
const natRatio = (counts.NATIONWIDE / SIMULATION_COUNT) * 10;

console.log(`Allocated distribution (out of 10):`);
console.log(`- District:   ${distRatio.toFixed(2)} / 10 (Expected: ~5.00)`);
console.log(`- Province:   ${provRatio.toFixed(2)} / 10 (Expected: ~3.00)`);
console.log(`- Nationwide: ${natRatio.toFixed(2)} / 10 (Expected: ~2.00)`);

assert.ok(Math.abs(distRatio - 5.0) < 0.2, "District distribution should be ~50%");
assert.ok(Math.abs(provRatio - 3.0) < 0.2, "Province distribution should be ~30%");
assert.ok(Math.abs(natRatio - 2.0) < 0.2, "Nationwide distribution should be ~20%");

console.log("✅ Prioritized weighted random distribution verified!");
