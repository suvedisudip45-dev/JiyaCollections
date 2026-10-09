import test from "node:test";
import assert from "node:assert/strict";
import {
  campaignMatchesOrder,
  cardTokenHash,
  isCardOrderAssignmentOwner,
  normalizeMaxScansPerCustomer,
} from "../services/marketingCardService.js";
import {
  assertCardOrderEligibility,
  assertCardCanBeScanned,
  assertCardNotPreviouslyScanned,
  assertOwnStoreScanQuota,
  getOwnStoreScanLimits,
  getScanWeekIndex,
} from "../services/marketingCardCustomerService.js";
import marketingCardRateLimit from "../middleware/marketingCardRateLimit.js";

const responseDouble = () => {
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { response.headers[name] = value; return response; },
    status(code) { response.statusCode = code; return response; },
    json(body) { response.body = body; return response; },
  };
  return response;
};

test("campaign geography matches nationwide, province, and district rules", () => {
  const order = { address: { province: "Bagmati Province", district: "Kathmandu" } };
  assert.equal(campaignMatchesOrder({ targetScopeType: "NATIONWIDE" }, order), true);
  assert.equal(campaignMatchesOrder({ targetScopeType: "PROVINCE", targetProvince: "Bagmati Province" }, order), true);
  assert.equal(campaignMatchesOrder({ targetScopeType: "PROVINCE", targetProvince: "Gandaki Province" }, order), false);
  assert.equal(campaignMatchesOrder({ targetScopeType: "DISTRICT", targetDistrict: "Kathmandu" }, order), true);
  assert.equal(campaignMatchesOrder({ targetScopeType: "DISTRICT", targetDistrict: "Parbat" }, order), false);
});

test("card token hashing is deterministic and one-way shaped", () => {
  const token = "a".repeat(64);
  const hash = cardTokenHash(token);
  assert.equal(hash, cardTokenHash(token));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test("distributor card attachment accepts auto-allocated orders owned by their assignment", () => {
  const distributorId = "distributor-1";
  const order = { distributorId: null };
  const assignment = { distributorId, manufacturerId: null };

  assert.equal(isCardOrderAssignmentOwner({ order, assignment, distributorId }), true);
  assert.equal(isCardOrderAssignmentOwner({
    order: { distributorId: "another-distributor" },
    assignment,
    distributorId,
  }), false);
  assert.equal(isCardOrderAssignmentOwner({
    order,
    assignment: { distributorId: "another-distributor", manufacturerId: null },
    distributorId,
  }), false);
});

test("customer scans are blocked while an exchange locks the card", () => {
  assert.doesNotThrow(() => assertCardCanBeScanned({ exchangeLockRequestId: null }));
  assert.throws(() => assertCardCanBeScanned({ exchangeLockRequestId: "exchange-1" }), (error) => {
    assert.equal(error.code, "MARKETING_CARD_EXCHANGE_LOCKED");
    return true;
  });
});

test("a scanned card cannot be scanned again by the same or a different customer", () => {
  assert.doesNotThrow(() => assertCardNotPreviouslyScanned({ customerLinks: [] }));
  for (const customerId of ["customer-1", "customer-2"]) {
    assert.throws(() => assertCardNotPreviouslyScanned({
      customerLinks: [{ customerId, status: "LINKED" }],
    }), (error) => {
      assert.equal(error.code, "MARKETING_CARD_ALREADY_SCANNED");
      return true;
    });
  }
});

test("Own Store cards are not gated by order ownership or delivery", () => {
  assert.doesNotThrow(() => assertCardOrderEligibility(
    { campaign: { isOwnStore: true }, orderLink: null },
    "customer-1"
  ));
  assert.doesNotThrow(() => assertCardOrderEligibility(
    {
      campaign: { isOwnStore: false },
      orderLink: { order: { userId: "customer-1", status: "Delivered" } },
    },
    "customer-1"
  ));
  assert.throws(() => assertCardOrderEligibility(
    { campaign: { isOwnStore: false }, orderLink: null },
    "customer-1"
  ), (error) => {
    assert.equal(error.code, "MARKETING_CARD_NOT_ELIGIBLE");
    return true;
  });
  assert.throws(() => assertCardOrderEligibility(
    {
      campaign: { isOwnStore: false },
      orderLink: { order: { userId: "customer-2", status: "Delivered" } },
    },
    "customer-1"
  ), (error) => {
    assert.equal(error.code, "MARKETING_CARD_FORBIDDEN");
    return true;
  });
});

test("Own Store scan quotas enforce weekly and per-organization thresholds", () => {
  const remaining = getOwnStoreScanLimits(4, 1);
  assert.deepEqual(remaining, {
    weekly: { used: 4, limit: 5, remaining: 1 },
    campaign: { used: 0, limit: 1, remaining: 1 },
    organization: { used: 1, limit: 2, remaining: 1 },
  });
  assert.doesNotThrow(() => assertOwnStoreScanQuota(remaining, "Test Organization"));

  const weeklyLimit = getOwnStoreScanLimits(5, 0);
  assert.throws(() => assertOwnStoreScanQuota(weeklyLimit, "Test Organization"), (error) => {
    assert.equal(error.code, "MARKETING_CARD_SCAN_LIMIT");
    assert.equal(error.details.limit, "WEEKLY_CAMPAIGN");
    return true;
  });

  const organizationLimit = getOwnStoreScanLimits(1, 2);
  assert.throws(() => assertOwnStoreScanQuota(organizationLimit, "Test Organization"), (error) => {
    assert.equal(error.code, "MARKETING_CARD_SCAN_LIMIT");
    assert.equal(error.details.limit, "ORGANIZATION_CAMPAIGN");
    return true;
  });
});

test("public Own Store scans use the campaign-wide per-customer cap", () => {
  assert.deepEqual(getOwnStoreScanLimits(2, 0, {
    isPublic: true,
    campaignUsed: 1,
    maxScansPerCustomer: 3,
  }), {
    weekly: { used: 2, limit: 5, remaining: 3 },
    campaign: { used: 1, limit: 3, remaining: 2 },
  });
  assert.doesNotThrow(() => assertOwnStoreScanQuota(
    getOwnStoreScanLimits(2, 0, { isPublic: true, campaignUsed: 0, maxScansPerCustomer: 1 }),
    "Everyone"
  ));
  assert.throws(() => assertOwnStoreScanQuota(
    getOwnStoreScanLimits(2, 0, { isPublic: true, campaignUsed: 1, maxScansPerCustomer: 1 }),
    "Everyone"
  ), (error) => {
    assert.equal(error.code, "MARKETING_CARD_SCAN_LIMIT");
    assert.equal(error.details.limit, "CAMPAIGN_CUSTOMER");
    return true;
  });
});

test("campaign public scan cap defaults to one and validates admin limits", () => {
  assert.equal(normalizeMaxScansPerCustomer(), 1);
  assert.equal(normalizeMaxScansPerCustomer("3"), 3);
  for (const invalidLimit of [0, -1, 1.5, 5001, "not-a-number"]) {
    assert.throws(() => normalizeMaxScansPerCustomer(invalidLimit), /integer between 1 and 5000/);
  }
});

test("Own Store weekly scan window changes at midnight Monday Nepal time", () => {
  const beforeMondayInNepal = new Date("2024-01-07T18:14:59.000Z");
  const mondayInNepal = new Date("2024-01-07T18:15:00.000Z");
  assert.equal(getScanWeekIndex(mondayInNepal), getScanWeekIndex(beforeMondayInNepal) + 1);
});

test("customer card rate limit returns 429 after the operation quota", () => {
  const limiter = marketingCardRateLimit("link");
  const request = { userId: `security-test-${Date.now()}` };
  let nextCalls = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = responseDouble();
    limiter(request, response, () => { nextCalls += 1; });
    assert.equal(response.statusCode, 200);
  }
  const blocked = responseDouble();
  limiter(request, blocked, () => { nextCalls += 1; });
  assert.equal(nextCalls, 10);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "MARKETING_CARD_RATE_LIMITED");
  assert.ok(Number(blocked.headers["Retry-After"]) > 0);
});
