import test from "node:test";
import assert from "node:assert/strict";
import { setManufacturerContext, setMarketingPartnerContext } from "../middleware/unifiedAuth.js";

test("manufacturer and partner context middleware ignore forged body IDs and use authenticated identity", () => {
  const manufacturerReq = {
    auth: { accountId: "acc-1", profileId: "profile-1", manufacturerId: "manufacturer-42", role: "MANUFACTURER" },
    body: { manufacturerId: "evil-manufacturer" },
  };
  const manufacturerRes = { status: () => ({ json: () => {} }) };
  setManufacturerContext(manufacturerReq, manufacturerRes, () => {
    assert.equal(manufacturerReq.manufacturerId, "manufacturer-42");
    assert.equal(manufacturerReq.body.manufacturerId, "manufacturer-42");
  });

  const partnerReq = {
    auth: { accountId: "acc-2", profileId: "partner-profile-9", partnerId: "partner-99", role: "MARKETING_PARTNER" },
    body: { partnerId: "evil-partner" },
  };
  const partnerRes = { status: () => ({ json: () => {} }) };
  setMarketingPartnerContext(partnerReq, partnerRes, () => {
    assert.equal(partnerReq.partnerId, "partner-99");
    assert.equal(partnerReq.body.partnerId, "partner-99");
  });
});

test("manufacturer and marketing partner context reject cross-portal identities", () => {
  let manufacturerStatus;
  let partnerStatus;
  const response = {
    status: (code) => ({ json: () => { manufacturerStatus = code; } }),
  };
  setManufacturerContext(
    { auth: { accountId: "customer-1", role: "CUSTOMER" }, body: {} },
    response,
    () => { throw new Error("customer reached manufacturer context"); }
  );

  const partnerResponse = {
    status: (code) => ({ json: () => { partnerStatus = code; } }),
  };
  setMarketingPartnerContext(
    { auth: { accountId: "manufacturer-1", role: "MANUFACTURER" }, body: {} },
    partnerResponse,
    () => { throw new Error("manufacturer reached partner context"); }
  );

  assert.equal(manufacturerStatus, 403);
  assert.equal(partnerStatus, 403);
});

test("admins retain access to manufacturer and partner context setters", () => {
  const manufacturerReq = { auth: { accountId: "admin-1", role: "ADMIN" }, body: {} };
  const partnerReq = { auth: { accountId: "admin-1", role: "ADMIN" }, body: {} };
  let manufacturerNext = false;
  let partnerNext = false;

  setManufacturerContext(manufacturerReq, { status: () => ({ json: () => {} }) }, () => { manufacturerNext = true; });
  setMarketingPartnerContext(partnerReq, { status: () => ({ json: () => {} }) }, () => { partnerNext = true; });

  assert.equal(manufacturerNext, true);
  assert.equal(partnerNext, true);
});
