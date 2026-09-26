import test from "node:test";
import assert from "node:assert/strict";
import { campaignMatchesOrder, cardTokenHash } from "../services/marketingCardService.js";
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
