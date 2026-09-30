import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProductCategoryNames,
  productBelongsToCategory,
} from "../services/productCategoryRules.js";

test("product categories parse JSON arrays and legacy comma-separated strings", () => {
  assert.deepEqual(parseProductCategoryNames('["Male", "Accessories"]'), ["Male", "Accessories"]);
  assert.deepEqual(parseProductCategoryNames("Male, Accessories"), ["Male", "Accessories"]);
  assert.deepEqual(parseProductCategoryNames(["Male", "Accessories"]), ["Male", "Accessories"]);
});

test("product category membership compares names case-insensitively and exactly", () => {
  const product = { category: '["Male", "Accessories"]' };
  assert.equal(productBelongsToCategory(product, "male"), true);
  assert.equal(productBelongsToCategory(product, "Accessories"), true);
  assert.equal(productBelongsToCategory(product, "Men"), false);
  assert.equal(productBelongsToCategory(product, "male accessories"), false);
});
