import assert from "node:assert/strict";
import test from "node:test";
import { createManufacturerCostSnapshot } from "../services/manufacturerCostSnapshot.js";

const items = [
  { productId: "product-1", quantity: 2, lineTotal: 2000 },
  { productId: "product-2", quantity: 1, lineTotal: 1500 },
];

const approvedInventory = [
  { productId: "product-1", priceStatus: "APPROVED", agreedCostPrice: 500.5 },
  { productId: "product-2", priceStatus: "APPROVED", agreedCostPrice: 700 },
];

test("acceptance snapshot freezes each approved COGS and direct-sale commission rate", () => {
  const acceptedAt = new Date("2026-09-28T12:00:00.000Z");
  const snapshot = createManufacturerCostSnapshot({
    items,
    inventoryRows: approvedInventory,
    acceptedAt,
    directSale: true,
    commissionStatus: "APPROVED",
    agreedCommissionRate: 7.5,
  });

  assert.deepEqual(snapshot.map((item) => ({
    productId: item.productId,
    cogs: item.agreedUnitCogsVatInclusiveAtAcceptance,
    commissionRate: item.agreedCommissionRateAtAcceptance,
    costSnapshotAt: item.cogsSnapshotAtAcceptance,
  })), [
    { productId: "product-1", cogs: "500.50", commissionRate: "7.5000", costSnapshotAt: acceptedAt.toISOString() },
    { productId: "product-2", cogs: "700.00", commissionRate: "7.5000", costSnapshotAt: acceptedAt.toISOString() },
  ]);
  assert.equal(Object.hasOwn(items[0], "agreedUnitCogsVatInclusiveAtAcceptance"), false);
});

test("acceptance is rejected if an item has no admin-approved COGS", () => {
  assert.throws(() => createManufacturerCostSnapshot({
    items,
    inventoryRows: [{ ...approvedInventory[0], priceStatus: "PENDING" }, approvedInventory[1]],
  }), (error) => error.code === "ACCOUNTING_APPROVED_COGS_REQUIRED" && error.statusCode === 409);
});

test("direct sale acceptance is rejected if its commission rate is not approved", () => {
  assert.throws(() => createManufacturerCostSnapshot({
    items,
    inventoryRows: approvedInventory,
    directSale: true,
    commissionStatus: "PENDING",
    agreedCommissionRate: null,
  }), (error) => error.code === "ACCOUNTING_APPROVED_COMMISSION_REQUIRED" && error.statusCode === 409);
});

test("non-direct orders snapshot COGS without adding commission terms", () => {
  const snapshot = createManufacturerCostSnapshot({ items, inventoryRows: approvedInventory });
  assert.equal(snapshot[0].agreedUnitCogsVatInclusiveAtAcceptance, "500.50");
  assert.equal(Object.hasOwn(snapshot[0], "agreedCommissionRateAtAcceptance"), false);
});