import assert from "node:assert/strict";
import test from "node:test";
import {
  barcodeScanIdempotencyKey,
  normalizeCycleCountInput,
  normalizePrePackInput,
  normalizeWarehouseScanInput,
} from "../services/distributorWarehouseService.js";

test("pre-pack input requires unique SKU lines and positive quantities", () => {
  assert.deepEqual(normalizePrePackInput({
    name: "Curve A",
    description: "Standard 1-2-2-1 pack",
    lines: [
      { inventorySkuId: "sku-s", quantity: 1 },
      { inventorySkuId: "sku-m", quantity: 2 },
    ],
  }), {
    name: "Curve A",
    description: "Standard 1-2-2-1 pack",
    lines: [
      { inventorySkuId: "sku-s", quantity: 1 },
      { inventorySkuId: "sku-m", quantity: 2 },
    ],
  });

  assert.throws(() => normalizePrePackInput({
    name: "Duplicate",
    lines: [
      { inventorySkuId: "sku-s", quantity: 1 },
      { inventorySkuId: "sku-s", quantity: 2 },
    ],
  }), /unique/);
});

test("warehouse scan input is normalized and operation is allowlisted", () => {
  assert.deepEqual(normalizeWarehouseScanInput({
    scanCode: "  SKU-M-001  ",
    operation: "pick",
    quantity: "1",
  }), {
    scanCode: "SKU-M-001",
    operation: "PICK",
    quantity: 1,
    referenceType: null,
    referenceId: null,
    expectedInventorySkuId: null,
  });
  assert.throws(() => normalizeWarehouseScanInput({
    scanCode: "SKU-M-001",
    operation: "DELETE",
  }), /operation/i);
});

test("cycle count calculates non-negative physical counts and unique SKU lines", () => {
  const count = normalizeCycleCountInput({
    countCode: "CC-1",
    lines: [{ inventorySkuId: "sku-m", countedQuantity: 7, note: "Shelf 2" }],
  });
  assert.equal(count.lines[0].countedQuantity, 7);
  assert.throws(() => normalizeCycleCountInput({
    lines: [{ inventorySkuId: "sku-m", countedQuantity: -1 }],
  }), /non-negative/);
  assert.throws(() => normalizeCycleCountInput({
    lines: [
      { inventorySkuId: "sku-m", countedQuantity: 7 },
      { inventorySkuId: "sku-m", countedQuantity: 8 },
    ],
  }), /unique/);
});

test("barcode scan idempotency identity is stable for the same operation", () => {
  const first = barcodeScanIdempotencyKey({
    distributorId: "dist-1",
    operation: "PICK",
    scanCode: "SKU-M-001",
    referenceId: "order-1",
    actorId: "account-1",
  });
  const replay = barcodeScanIdempotencyKey({
    distributorId: "dist-1",
    operation: "PICK",
    scanCode: "SKU-M-001",
    referenceId: "order-1",
    actorId: "account-1",
  });
  assert.equal(first, replay);
  assert.equal(first.length, 64);
});
