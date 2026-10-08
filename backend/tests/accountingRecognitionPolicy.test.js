import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateManufacturerCommission,
  classifySaleChannel,
  isDeliveredAndNotReturnedToManufacturer,
  isManufacturerCommissionEligible,
} from "../services/accountingRecognitionPolicy.js";

test("manufacturer commission is limited to manufacturer-originated phone and hub sales", () => {
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "PHONE_ORDER" }), "MANUFACTURER_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "HUB_VISIT" }), "MANUFACTURER_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_DISTRIBUTOR", directOrderType: "PHONE_ORDER" }), "DISTRIBUTOR_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_DISTRIBUTOR", directOrderType: "HUB_VISIT" }), "DISTRIBUTOR_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "ONLINE_STORE" }), "ONLINE_STORE");
  assert.equal(classifySaleChannel({ orderType: "ADMIN_DIRECT" }), "ADMIN_DIRECT");
  assert.equal(classifySaleChannel({ orderType: "DIRECT_MANUFACTURER", directOrderType: "UNKNOWN" }), "UNKNOWN");
});

test("distributor direct sales do not qualify for manufacturer commission", () => {
  assert.equal(isManufacturerCommissionEligible({
    order: { orderType: "DIRECT_DISTRIBUTOR", directOrderType: "HUB_VISIT", status: "Delivered" },
  }), false);
});

test("COGS recognition requires delivery and no confirmed manufacturer return", () => {
  assert.equal(isDeliveredAndNotReturnedToManufacturer({ order: { status: "Delivered" } }), true);
  assert.equal(isDeliveredAndNotReturnedToManufacturer({ deliveryState: "DELIVERED" }), true);
  assert.equal(isDeliveredAndNotReturnedToManufacturer({ deliveryState: "IN_TRANSIT" }), false);
  assert.equal(isDeliveredAndNotReturnedToManufacturer({
    order: { status: "Delivered" },
    deliveryState: "RETURN_REQUESTED",
  }), true);
  assert.equal(isDeliveredAndNotReturnedToManufacturer({
    order: { status: "Delivered" },
    returnedToManufacturer: true,
  }), false);
});

test("manufacturer commission uses decimal gross profit and rounds half up to paisa", () => {
  assert.deepEqual(calculateManufacturerCommission({
    productRevenueExVat: "1000.01",
    agreedCogsVatInclusive: "565.01",
    recoverableInputVat: "65.00",
    commissionRatePercent: "7.5",
  }), {
    grossProfit: "500.00",
    commissionAmount: "37.50",
  });
});

test("manufacturer commission treats unverified VAT as non-recoverable cost", () => {
  assert.deepEqual(calculateManufacturerCommission({
    productRevenueExVat: "1000.00",
    agreedCogsVatInclusive: "565.00",
    recoverableInputVat: "0",
    commissionRatePercent: "10",
  }), {
    grossProfit: "435.00",
    commissionAmount: "43.50",
  });
});

test("manufacturer commission is zero when gross profit is negative", () => {
  assert.deepEqual(calculateManufacturerCommission({
    productRevenueExVat: "400",
    agreedCogsVatInclusive: "500",
    recoverableInputVat: "0",
    commissionRatePercent: "10",
  }), {
    grossProfit: "-100.00",
    commissionAmount: "0.00",
  });
});

test("manufacturer commission rejects invalid monetary inputs", () => {
  assert.throws(() => calculateManufacturerCommission({
    productRevenueExVat: "100",
    agreedCogsVatInclusive: "10",
    recoverableInputVat: "11",
    commissionRatePercent: "10",
  }), /cannot exceed/);
  assert.throws(() => calculateManufacturerCommission({
    productRevenueExVat: "-1",
    agreedCogsVatInclusive: "10",
    commissionRatePercent: "10",
  }), /cannot be negative/);
});