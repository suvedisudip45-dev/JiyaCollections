import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketingCardDiscount } from "../services/marketingCardReward.js";

test("percentage card discounts apply to the eligible item subtotal", () => {
  assert.equal(calculateMarketingCardDiscount("DISCOUNT", 20, 1000), 200);
  assert.equal(calculateMarketingCardDiscount("DISCOUNT", 20, 100), 20);
});

test("fixed-value voucher discounts reduce only the item subtotal", () => {
  const itemSubtotal = 1200;
  const deliveryFee = 150;

  assert.equal(calculateMarketingCardDiscount("VOUCHER", 500, itemSubtotal), 500);
  assert.equal(itemSubtotal + deliveryFee - calculateMarketingCardDiscount("VOUCHER", 500, itemSubtotal), 850);
});

test("fixed-value vouchers are capped at the item subtotal", () => {
  assert.equal(calculateMarketingCardDiscount("VOUCHER", 500, 300), 300);
});

test("invalid reward values, percentages, and subtotals are rejected", () => {
  assert.equal(calculateMarketingCardDiscount("VOUCHER", 0, 1000), null);
  assert.equal(calculateMarketingCardDiscount("VOUCHER", Number.NaN, 1000), null);
  assert.equal(calculateMarketingCardDiscount("DISCOUNT", 101, 1000), null);
  assert.equal(calculateMarketingCardDiscount("DISCOUNT", 10, -1), null);
  assert.equal(calculateMarketingCardDiscount("GIFT", 500, 1000), null);
});
