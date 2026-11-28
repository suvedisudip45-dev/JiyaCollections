import test from "node:test";
import assert from "node:assert/strict";

import { toStorefrontProduct } from "../utils/storefrontProductResponse.js";

test("storefront product response contains only customer-facing fields", () => {
  const product = toStorefrontProduct({
    id: "product-1",
    name: "Shirt",
    nepaliName: "सर्ट",
    description: "Cotton",
    price: 1200,
    image: '["front.jpg"]',
    category: '["Men","New"]',
    subCategory: "Casual",
    sizes: ["M", "L"],
    colors: ["Blue"],
    colorImages: [],
    variants: [{ size: "M", color: "Blue", quantity: 3 }],
    bestseller: true,
    newInStore: false,
    isUnisex: false,
    discount: 10,
    stockQuantity: 3,
    date: 1700000000000n,
    costPrice: 500,
    lowStockThreshold: 2,
    updatedAt: new Date(),
  }, { rating: 4.5, reviewCount: 2 });

  assert.deepEqual(product, {
    _id: "product-1",
    name: "Shirt",
    nepaliName: "सर्ट",
    description: "Cotton",
    price: 1200,
    image: ["front.jpg"],
    category: "Men, New",
    subCategory: "Casual",
    sizes: ["M", "L"],
    colors: ["Blue"],
    colorImages: [],
    variants: [{ size: "M", color: "Blue", quantity: 3 }],
    bestseller: true,
    newInStore: false,
    isUnisex: false,
    discount: 10,
    stockQuantity: 3,
    date: 1700000000000,
    rating: 4.5,
    reviewCount: 2,
  });
  assert.equal("id" in product, false);
  assert.equal("categories" in product, false);
  assert.equal("costPrice" in product, false);
  assert.equal("lowStockThreshold" in product, false);
  assert.equal("updatedAt" in product, false);
});
