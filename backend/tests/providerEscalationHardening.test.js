import test from "node:test";
import assert from "node:assert/strict";
import { setManufacturerContext, setMarketingPartnerContext } from "../middleware/unifiedAuth.js";

test("manufacturer and partner context middleware ignore forged body IDs and use authenticated identity", () => {
  const manufacturerReq = {
    auth: { accountId: "acc-1", profileId: "profile-1", manufacturerId: "manufacturer-42" },
    body: { manufacturerId: "evil-manufacturer" },
  };
  const manufacturerRes = { status: () => ({ json: () => {} }) };
  setManufacturerContext(manufacturerReq, manufacturerRes, () => {
    assert.equal(manufacturerReq.manufacturerId, "manufacturer-42");
    assert.equal(manufacturerReq.body.manufacturerId, "manufacturer-42");
  });

  const partnerReq = {
    auth: { accountId: "acc-2", profileId: "partner-profile-9", partnerId: "partner-99" },
    body: { partnerId: "evil-partner" },
  };
  const partnerRes = { status: () => ({ json: () => {} }) };
  setMarketingPartnerContext(partnerReq, partnerRes, () => {
    assert.equal(partnerReq.partnerId, "partner-99");
    assert.equal(partnerReq.body.partnerId, "partner-99");
  });
});
