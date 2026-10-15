import assert from "node:assert/strict";
import test from "node:test";
import {
  getAddressProvince,
  isDistributorLocalDeliveryEligible,
} from "../services/deliveryLocationService.js";

test("selected customer province takes precedence over a stale legacy state", () => {
  assert.equal(getAddressProvince({
    province: "Bagmati Province",
    state: "Koshi Province",
  }), "Bagmati Province");
  assert.equal(getAddressProvince({ state: "Gandaki Province" }), "Gandaki Province");
});

test("local self-delivery accepts a canonical same-city match within the same province", () => {
  assert.equal(isDistributorLocalDeliveryEligible({
    customerAddress: {
      province: "Bagmati Province",
      district: "Bhaktapur",
      city: "Kathmandu",
    },
    distributor: {
      province: "Bagmati",
      district: "Kathmandu",
      city: "kathmandu",
    },
  }), true);
});

test("local self-delivery accepts district labels with a district suffix", () => {
  assert.equal(isDistributorLocalDeliveryEligible({
    customerAddress: {
      province: "Bagmati Province",
      district: "Kathmandu District",
    },
    distributor: {
      province: "Bagmati Province",
      district: "Kathmandu",
    },
  }), true);
});

test("same city does not permit self-delivery across provinces", () => {
  assert.equal(isDistributorLocalDeliveryEligible({
    customerAddress: {
      province: "Koshi Province",
      district: "Sunsari",
      city: "Pokhara",
    },
    distributor: {
      province: "Gandaki Province",
      district: "Kaski",
      city: "Pokhara",
    },
  }), false);
});

test("self-delivery requires an exact district or city match", () => {
  assert.equal(isDistributorLocalDeliveryEligible({
    customerAddress: {
      province: "Bagmati Province",
      district: "Makwanpur",
      city: "Hetauda",
    },
    distributor: {
      province: "Bagmati Province",
      district: "Kathmandu",
      city: "Kathmandu",
    },
  }), false);
});
