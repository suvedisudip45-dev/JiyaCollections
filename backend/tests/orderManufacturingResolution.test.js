import assert from "node:assert/strict";
import test from "node:test";

import { resolveOrderManufacturingPlan } from "../controllers/orderController.js";

test("single-supplier order stays standard and keeps the manufacturer id", () => {
  const plan = resolveOrderManufacturingPlan(
    [
      { _id: "p1", size: "M", color: "Black", quantity: 1 },
      { _id: "p2", size: "L", color: "White", quantity: 2 },
    ],
    [
      { manufacturerId: "mfg-1", productId: "p1", quantity: 10, reservedQty: 1, variantsStock: [{ size: "M", color: "Black", quantity: 10, reservedQty: 1 }] },
      { manufacturerId: "mfg-1", productId: "p2", quantity: 20, reservedQty: 4, variantsStock: [{ size: "L", color: "White", quantity: 20, reservedQty: 4 }] },
    ]
  );

  assert.equal(plan.specialOrder, false);
  assert.equal(plan.primaryManufacturerId, "mfg-1");
  assert.deepEqual(plan.specialOrderManufacturerIds, ["mfg-1"]);
});

test("mixed-manufacturer order is flagged as a special order and keeps a fallback manufacturer", () => {
  const plan = resolveOrderManufacturingPlan(
    [
      { _id: "p1", size: "M", color: "Black", quantity: 1 },
      { _id: "p2", size: "L", color: "White", quantity: 2 },
    ],
    [
      { manufacturerId: "mfg-1", productId: "p1", quantity: 10, reservedQty: 1, variantsStock: [{ size: "M", color: "Black", quantity: 10, reservedQty: 1 }] },
      { manufacturerId: "mfg-2", productId: "p2", quantity: 20, reservedQty: 4, variantsStock: [{ size: "L", color: "White", quantity: 20, reservedQty: 4 }] },
    ]
  );

  assert.equal(plan.specialOrder, true);
  assert.equal(plan.primaryManufacturerId, "mfg-1");
  assert.deepEqual(plan.specialOrderManufacturerIds, ["mfg-1", "mfg-2"]);
  assert.match(plan.specialOrderReason, /special order/i);
});
