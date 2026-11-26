import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdminOrderCustomerForCreation } from "../services/adminOrderCustomerService.js";

test("legacy existing customer stays loyalty- and gift-eligible without a code", async () => {
  const legacyCustomer = {
    id: "legacy-customer",
    firstName: "Legacy",
    lastName: "Customer",
    name: "Legacy Customer",
    email: "",
    phone: "9846008537",
    socialCustomerCode: null,
    socialCustomerPhone: null,
    gender: "PREFER_NOT_TO_SAY",
    addresses: "[]",
    isInactiveProfile: false,
  };

  let customerUpdateCalls = 0;
  const client = {
    user: {
      findFirst: async () => legacyCustomer,
      findUnique: async () => null,
      update: async () => {
        customerUpdateCalls += 1;
        throw new Error("Customer lookup must not provision a code");
      },
    },
    order: { findMany: async () => [] },
  };

  const result = await getAdminOrderCustomerForCreation("9846008537", "", client);

  assert.equal(result.state, "PHONE_MATCHED");
  assert.equal(result.verified, true);
  assert.equal(result.customer.id, "legacy-customer");
  assert.equal(result.socialCustomerCode, null);
  assert.equal(result.userId, "legacy-customer");
  assert.equal(result.loyaltyEligible, true);
  assert.equal(result.giftEligible, true);
  assert.equal(customerUpdateCalls, 0);
});
