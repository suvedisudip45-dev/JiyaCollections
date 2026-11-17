import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  allocatePricingAmount,
  applyPercentagePriceDiscount,
  calculatePricedLine,
  createOrderPricingSnapshot,
  createOrderPricingSnapshotV3,
  decimalFromStoredFloat,
  decimalQuantity,
  exactPricingApiFields,
  hasNoOverDiscount,
  readOrderPricingSnapshot,
  requirePricingDecimal,
  roundCommercialOrderTotal,
  wholeOrderQuantity,
  withOrderPricingSnapshot,
} from "../services/checkoutPricingService.js";

test("checkout pricing uses decimal arithmetic and preserves fractional unit prices", () => {
  const lineA = calculatePricedLine({ unitPrice: "12.35", quantity: "2" });
  const lineB = calculatePricedLine({ unitPrice: "0.10", quantity: "3" });
  const fractionalLine = calculatePricedLine({ unitPrice: "12.35", quantity: "0.5" });

  assert.equal(lineA.lineTotal.toString(), "24.7");
  assert.equal(lineB.lineTotal.toString(), "0.3");
  assert.equal(fractionalLine.lineTotal.toString(), "6.175");
  assert.equal(applyPercentagePriceDiscount("10", "12.5").toString(), "9");
});

test("commercial nearest-NPR-5 rounding remains distinct from NPR HALF_EVEN", () => {
  assert.equal(roundCommercialOrderTotal("132").toString(), "130");
  assert.equal(roundCommercialOrderTotal("134").toString(), "135");
  assert.equal(roundCommercialOrderTotal("138").toString(), "140");
  assert.equal(roundCommercialOrderTotal("132.5").toString(), "130");
  assert.equal(
    decimalFromStoredFloat(2.345).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN).toString(),
    "2.34",
  );
  assert.equal(
    decimalFromStoredFloat(2.355).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN).toString(),
    "2.36",
  );
});

test("checkout monetary boundaries reject Number values and invalid quantities", () => {
  assert.throws(() => requirePricingDecimal(1.25, "Price"), { code: "INVALID_DECIMAL_INPUT" });
  assert.equal(decimalQuantity("1.5").toString(), "1.5");
  assert.throws(() => wholeOrderQuantity("1.5"), { code: "INVALID_ORDER_QUANTITY" });
  assert.throws(() => decimalQuantity("2147483648"), { code: "INVALID_ORDER_QUANTITY" });
  assert.throws(() => calculatePricedLine({ unitPrice: "-1", quantity: "1" }), { code: "INVALID_ORDER_PRICE" });
});

test("split discount allocation has deterministic decimal residuals", () => {
  const allocated = allocatePricingAmount("10.00", ["200", "100", "50"]);
  assert.deepEqual(allocated.map((amount) => amount.toString()), ["5.71", "2.86", "1.43"]);
  assert.throws(() => hasNoOverDiscount("10.01", "10.00"), { code: "INVALID_ORDER_DISCOUNT" });
});

test("versioned snapshots serialize exact amounts and preserve legacy API fields", () => {
  const pricingSnapshot = createOrderPricingSnapshot({
    lines: [{
      productId: "p1",
      size: "M",
      color: "Navy",
      unitPrice: "12.35",
      quantity: "2",
      lineTotal: "24.70",
    }],
    subtotal: "24.70",
    deliveryFee: "0",
    preCommercialRoundingTotal: "24.70",
    finalPayableTotal: "25",
    commercialRoundingRule: "NEAREST_NPR_5_V1",
  });
  const locationPricingSnapshot = withOrderPricingSnapshot(
    { province: "Bagmati Province", district: "Kathmandu" },
    pricingSnapshot,
  );
  const order = {
    amount: 25,
    deliveryFee: 0,
    locationPricingSnapshot,
  };

  assert.equal(readOrderPricingSnapshot(locationPricingSnapshot).totals.finalPayableTotal, "25");
  assert.deepEqual(exactPricingApiFields(order), {
    amountDecimal: "25",
    deliveryFeeDecimal: "0",
    pricingSnapshotVersion: 2,
    pricingSnapshot,
    legacyNumericFieldsCompatibilityOnly: true,
  });
  assert.equal(readOrderPricingSnapshot({ amount: 25, items: [] }), null);
});

test("legacy Float-backed orders remain readable without recovering historical precision", () => {
  const legacyOrder = {
    amount: 0.1 + 0.2,
    deliveryFee: 4.5,
    locationPricingSnapshot: null,
  };
  assert.deepEqual(exactPricingApiFields(legacyOrder), {
    amountDecimal: "0.30000000000000004",
    deliveryFeeDecimal: "4.5",
    pricingSnapshotVersion: null,
    pricingSnapshot: null,
    legacyNumericFieldsCompatibilityOnly: true,
  });
});

test("v2 snapshots with incomplete provenance remain unchanged and expose no invented components", () => {
  const legacySnapshot = {
    version: 2,
    pricingRuleVersion: "NPR-CHECKOUT-2",
    currency: "NPR",
    lines: [{
      productId: "legacy-v2-product",
      unitPrice: "90",
      quantity: "1",
      lineTotal: "90",
      discountPercentage: "10",
    }],
    totals: {
      subtotal: "90",
      discountTotal: "0",
      deliveryFee: "0",
      otherAdjustments: "0",
      preCommercialRoundingTotal: "90",
      finalPayableTotal: "90",
    },
  };
  const before = JSON.stringify(legacySnapshot);
  const parsed = readOrderPricingSnapshot(legacySnapshot);

  assert.equal(parsed.version, 2);
  assert.equal(parsed.lines[0].discountComponents, undefined);
  assert.equal(JSON.stringify(legacySnapshot), before);
});

test("v3 snapshots preserve typed discount provenance and reconcile accepted amounts", () => {
  const snapshot = createOrderPricingSnapshotV3({
    lines: [{
      productId: "bundle-product",
      size: "M",
      color: "Navy",
      catalogUnitPrice: "100",
      unitPrice: "80",
      quantity: "2",
      lineTotal: "160",
      priceSteps: [
        {
          source: "PRODUCT",
          sourceId: "bundle-product",
          unitPriceBefore: "100",
          unitPriceAfter: "90",
          rate: "10",
        },
        {
          source: "BUNDLE",
          sourceId: "bundle-1",
          unitPriceBefore: "90",
          unitPriceAfter: "80",
          rate: "11.1111",
        },
      ],
    }],
    subtotal: "160",
    discountTotal: "5",
    deliveryFee: "10",
    preCommercialRoundingTotal: "165",
    finalPayableTotal: "165",
    orderDiscountComponents: [{ source: "LOYALTY", amount: "5" }],
  });

  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.provenanceStatus, "COMPLETE");
  assert.equal(snapshot.lines[0].catalogUnitPrice, "100");
  assert.deepEqual(snapshot.lines[0].quantityMeasure, { value: "2", unit: "EACH" });
  assert.equal(snapshot.acceptedAt, snapshot.calculatedAt);
  assert.deepEqual(
    snapshot.lines[0].discountComponents.map(({ source, amount }) => ({ source, amount })),
    [
      { source: "PRODUCT", amount: "20" },
      { source: "BUNDLE", amount: "20" },
    ],
  );
  assert.equal(snapshot.totals.lineGrossTotal, "200");
  assert.equal(snapshot.totals.lineDiscountTotal, "40");
  assert.equal(snapshot.totals.commercialRoundingAdjustment, "0");
  assert.equal(snapshot.adjustments.find((adjustment) => adjustment.source === "LOYALTY").amount, "5");
  assert.equal(readOrderPricingSnapshot(snapshot).version, 3);
  const apiFields = exactPricingApiFields({
    amount: 165,
    deliveryFee: 10,
    locationPricingSnapshot: withOrderPricingSnapshot(null, snapshot),
  });
  assert.equal(apiFields.amountDecimal, "165");
  assert.equal(apiFields.pricingSnapshotVersion, 3);
  assert.equal(apiFields.legacyNumericFieldsCompatibilityOnly, true);

  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.lines[0].discountComponents[0].amount = "19";
  assert.equal(readOrderPricingSnapshot(invalidSnapshot), null);
});

test("new order snapshot rejects values outside the legacy database amount range", () => {
  assert.throws(() => createOrderPricingSnapshot({
    lines: [],
    subtotal: "100000000000000000000",
    preCommercialRoundingTotal: "100000000000000000000",
    finalPayableTotal: "100000000000000000000",
  }), { code: "DECIMAL_OUT_OF_RANGE" });
});
