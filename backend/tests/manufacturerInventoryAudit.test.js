import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManufacturerStockMovements,
  normalizeStockAdjustmentReason,
} from "../services/manufacturerInventoryAudit.js";

test("stock changes are recorded as signed per-variant movements", () => {
  const movements = buildManufacturerStockMovements({
    previousVariants: [
      { size: "M", color: "Black", quantity: 8 },
      { size: "L", color: "Black", quantity: 2 },
    ],
    nextVariants: [
      { size: "M", color: "Black", quantity: 11 },
      { size: "L", color: "Black", quantity: 0 },
      { size: "S", color: "Red", quantity: 5 },
    ],
    productId: "product-1",
    productName: "T-Shirt",
    manufacturerId: "manufacturer-1",
    actorId: "actor-1",
    reason: "RECEIVED",
    note: "Shipment received",
  });

  assert.deepEqual(movements.map(({ variantLabel, previousQty, newQty, changeQty, movementType }) => ({
    variantLabel,
    previousQty,
    newQty,
    changeQty,
    movementType,
  })), [
    { variantLabel: "M / Black", previousQty: 8, newQty: 11, changeQty: 3, movementType: "STOCK_IN" },
    { variantLabel: "L / Black", previousQty: 2, newQty: 0, changeQty: -2, movementType: "STOCK_OUT" },
    { variantLabel: "S / Red", previousQty: 0, newQty: 5, changeQty: 5, movementType: "STOCK_IN" },
  ]);
  assert.ok(movements.every((movement) => movement.manufacturerId === "manufacturer-1"));
  assert.ok(movements.every((movement) => movement.actorId === "actor-1"));
});

test("unchanged variant quantities do not create stock movements", () => {
  assert.deepEqual(buildManufacturerStockMovements({
    previousVariants: [{ size: "Standard", color: "Standard", quantity: 3 }],
    nextVariants: [{ size: "Standard", color: "Standard", quantity: 3 }],
  }), []);
});

test("stock adjustment reasons are validated and Other requires an explanation", () => {
  assert.deepEqual(normalizeStockAdjustmentReason(" received ", " Stock intake "), {
    reason: "RECEIVED",
    note: "Stock intake",
  });
  assert.throws(() => normalizeStockAdjustmentReason("UNKNOWN", ""), /valid reason/);
  assert.throws(() => normalizeStockAdjustmentReason("OTHER", ""), /Add a note/);
  assert.throws(() => normalizeStockAdjustmentReason("RECEIVED", "x".repeat(1001)), /1000 characters/);
});
