import assert from "node:assert/strict";
import test from "node:test";

import {
  getSharedComboBundleVariants,
  calculateComboBundlePrice,
  allocateComboBundleComponentPrices,
} from "../services/comboBundleRules.js";

test("shared collection variants require stock for every member and use minimum available quantity", () => {
  const variants = getSharedComboBundleVariants([
    { variants: [{ size: "M", color: "Black", quantity: 4 }, { size: "L", color: "Black", quantity: 3 }] },
    { variants: [{ size: "m", color: "black", quantity: 2 }, { size: "L", color: "Black", quantity: 0 }] },
  ]);

  assert.deepEqual(variants, [{
    size: "M",
    availableQuantity: 2,
    productVariants: [
      { size: "M", color: "Black", availableQuantity: 4 },
      { size: "m", color: "black", availableQuantity: 2 },
    ],
  }]);
});

test("shared variants also work for products with separate size and color lists", () => {
  const variants = getSharedComboBundleVariants([
    { sizes: '["M", "L"]', colors: '["Black"]', stockQuantity: 5 },
    { sizes: '["M"]', colors: '["Black", "White"]', stockQuantity: 2 },
  ]);

  assert.deepEqual(variants, [{
    size: "M",
    availableQuantity: 2,
    productVariants: [
      { size: "M", color: "Black", availableQuantity: 5 },
      { size: "M", color: "Black", availableQuantity: 2 },
    ],
  }]);
});

test("shared bundle sizes allow each product to use its own in-stock color", () => {
  const variants = getSharedComboBundleVariants([
    { variants: [{ size: "M", color: "White", quantity: 4 }, { size: "L", color: "White", quantity: 1 }] },
    { variants: [{ size: "M", color: "Black", quantity: 2 }, { size: "L", color: "Black", quantity: 0 }] },
  ]);

  assert.deepEqual(variants, [{
    size: "M",
    availableQuantity: 2,
    productVariants: [
      { size: "M", color: "White", availableQuantity: 4 },
      { size: "M", color: "Black", availableQuantity: 2 },
    ],
  }]);
});

test("assigned bundle colors constrain each product to its chosen color", () => {
  const variants = getSharedComboBundleVariants([
    { comboBundleColor: "White", variants: [{ size: "M", color: "White", quantity: 4 }, { size: "M", color: "Black", quantity: 9 }] },
    { comboBundleColor: "Black", variants: [{ size: "M", color: "Black", quantity: 2 }, { size: "M", color: "Blue", quantity: 8 }] },
  ]);

  assert.deepEqual(variants, [{
    size: "M",
    availableQuantity: 2,
    productVariants: [
      { size: "M", color: "White", availableQuantity: 4 },
      { size: "M", color: "Black", availableQuantity: 2 },
    ],
  }]);
});

test("bundle price sums member sale prices then applies the collection discount", () => {
  const price = calculateComboBundlePrice({
    products: [
      { price: 1000, discount: 10 },
      { price: 500, discount: 0 },
    ],
    discountPercentage: 20,
  });

  assert.deepEqual(price, {
    calculatedPrice: 1400,
    sellingPrice: 1120,
    discountPercentage: 20,
    manualPriceOverride: false,
  });
});

test("manual bundle price overrides the discounted member-price total", () => {
  const price = calculateComboBundlePrice({
    products: [{ price: 1000, discount: 0 }],
    discountPercentage: 10,
    manualPriceOverride: true,
    sellingPrice: 825,
  });

  assert.equal(price.calculatedPrice, 1000);
  assert.equal(price.sellingPrice, 825);
  assert.equal(price.manualPriceOverride, true);
});

test("a zero manual override falls back to the calculated bundle price", () => {
  const price = calculateComboBundlePrice({
    products: [{ price: 1000, discount: 0 }],
    manualPriceOverride: true,
    sellingPrice: 0,
  });

  assert.equal(price.sellingPrice, 1000);
  assert.equal(price.manualPriceOverride, false);
});

test("component unit prices add back to the single bundle price without rounding loss", () => {
  const allocated = allocateComboBundleComponentPrices(
    [{ purchasedUnitPrice: 100 }, { purchasedUnitPrice: 100 }, { purchasedUnitPrice: 100 }],
    250
  );

  assert.deepEqual(allocated, [83.33, 83.33, 83.34]);
  assert.equal(allocated.reduce((sum, price) => sum + price, 0), 250);
});
