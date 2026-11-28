import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLegacyManufacturerCommission,
  classifySaleChannel,
} from "../services/accountingRecognitionPolicy.js";

test("legacy sale-channel classification identifies manufacturer direct orders", () => {
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "PHONE_ORDER" }), "MANUFACTURER_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "HUB_VISIT" }), "MANUFACTURER_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_DISTRIBUTOR", directOrderType: "PHONE_ORDER" }), "DISTRIBUTOR_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_DISTRIBUTOR", directOrderType: "HUB_VISIT" }), "DISTRIBUTOR_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "ONLINE_STORE" }), "ONLINE_STORE");
  assert.equal(classifySaleChannel({ orderType: "ADMIN_DIRECT" }), "ADMIN_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "UNKNOWN" }), "UNKNOWN");
});

test("legacy manufacturer commission reversals use decimal gross profit and paisa rounding", () => {
  assert.deepEqual(calculateLegacyManufacturerCommission({
    productRevenueExVat: "1000.01",
    agreedCogsVatInclusive: "565.01",
    recoverableInputVat: "65.00",
    commissionRatePercent: "7.5",
  }), {
    grossProfit: "500.00",
    commissionAmount: "37.50",
  });
});

test("legacy manufacturer commission reversal treats unverified VAT as non-recoverable cost", () => {
  assert.deepEqual(calculateLegacyManufacturerCommission({
    productRevenueExVat: "1000.00",
    agreedCogsVatInclusive: "565.00",
    recoverableInputVat: "0",
    commissionRatePercent: "10",
  }), {
    grossProfit: "435.00",
    commissionAmount: "43.50",
  });
});

test("legacy manufacturer commission reversal is zero when gross profit is negative", () => {
  assert.deepEqual(calculateLegacyManufacturerCommission({
    productRevenueExVat: "400",
    agreedCogsVatInclusive: "500",
    recoverableInputVat: "0",
    commissionRatePercent: "10",
  }), {
    grossProfit: "-100.00",
    commissionAmount: "0.00",
  });
});

test("legacy manufacturer commission reversal rejects invalid monetary inputs", () => {
  assert.throws(() => calculateLegacyManufacturerCommission({
    productRevenueExVat: "100",
    agreedCogsVatInclusive: "10",
    recoverableInputVat: "11",
    commissionRatePercent: "10",
  }), /cannot exceed/);
  assert.throws(() => calculateLegacyManufacturerCommission({
    productRevenueExVat: "-1",
    agreedCogsVatInclusive: "10",
    commissionRatePercent: "10",
  }), /cannot be negative/);
});