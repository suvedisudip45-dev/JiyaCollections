import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInventoryMovement,
  normalizeInventoryMovement,
  collectProductVariants,
  normalizeSkuOption,
  planLegacyInventoryBackfill,
  planLegacyBalanceReconciliation,
  reconcileInventoryLedger,
  receiveCompletedProductionLine,
  valueInventoryCostLayers,
} from "../services/inventoryLedgerService.js";

const createInventoryTransaction = ({ quantityOnHand = 0, reservedQuantity = 0 } = {}) => {
  const balances = new Map();
  const entries = new Map();
  const costLayers = new Map();
  const balanceKey = (locationId, inventorySkuId) => `${locationId}:${inventorySkuId}`;
  if (quantityOnHand || reservedQuantity) {
    balances.set(balanceKey("factory-1", "sku-1"), {
      locationId: "factory-1",
      inventorySkuId: "sku-1",
      quantityOnHand,
      reservedQuantity,
    });
  }

  const tx = {
    inventorySku: {
      upsert: async ({ create }) => ({ id: "sku-1", ...create, isActive: true }),
      findUnique: async ({ where }) => where.id === "sku-1" ? { id: "sku-1", isActive: true } : null,
    },
    manufacturerInventoryCostLayer: {
      upsert: async ({ where, create }) => {
        const key = JSON.stringify(where.productionRequestId_size_color);
        if (!costLayers.has(key)) costLayers.set(key, { id: "cost-layer-1", ...create });
        return costLayers.get(key);
      },
    },
    inventoryLocation: {
      findMany: async ({ where }) => where.id.in.filter((id) => ["factory-1", "transit-1"].includes(id)).map((id) => ({ id })),
    },
    inventoryBalance: {
      upsert: async ({ where, create }) => {
        const key = balanceKey(where.locationId_inventorySkuId.locationId, where.locationId_inventorySkuId.inventorySkuId);
        if (!balances.has(key)) balances.set(key, { ...create });
        return balances.get(key);
      },
      findUnique: async ({ where }) => balances.get(balanceKey(
        where.locationId_inventorySkuId.locationId,
        where.locationId_inventorySkuId.inventorySkuId,
      )) || null,
      updateMany: async ({ where, data }) => {
        const key = balanceKey(where.locationId, where.inventorySkuId);
        const balance = balances.get(key);
        if (!balance) return { count: 0 };
        if (typeof where.quantityOnHand === "number" && balance.quantityOnHand !== where.quantityOnHand) return { count: 0 };
        if (typeof where.reservedQuantity === "number" && balance.reservedQuantity !== where.reservedQuantity) return { count: 0 };
        if (where.quantityOnHand?.gte !== undefined && balance.quantityOnHand < where.quantityOnHand.gte) return { count: 0 };
        if (where.quantityOnHand?.lte !== undefined && balance.quantityOnHand > where.quantityOnHand.lte) return { count: 0 };
        if (where.reservedQuantity?.lte !== undefined && balance.reservedQuantity > where.reservedQuantity.lte) return { count: 0 };
        if (data.quantityOnHand?.decrement) balance.quantityOnHand -= data.quantityOnHand.decrement;
        if (data.quantityOnHand?.increment) balance.quantityOnHand += data.quantityOnHand.increment;
        return { count: 1 };
      },
    },
    inventoryLedgerEntry: {
      findUnique: async ({ where }) => entries.get(where.idempotencyKey) || null,
      create: async ({ data }) => {
        const entry = { id: `entry-${entries.size + 1}`, ...data };
        entries.set(data.idempotencyKey, entry);
        return entry;
      },
    },
  };
  return { tx, balances, entries, costLayers, balanceKey };
};

const movement = {
  inventorySkuId: "sku-1",
  sourceLocationId: "factory-1",
  destinationLocationId: "transit-1",
  quantity: 4,
  movementType: "TRANSFER_DISPATCH",
  idempotencyKey: "shipment-line-1",
  actorId: "manufacturer-1",
  actorRole: "MANUFACTURER",
  reason: "Dispatch against approved transfer.",
};

test("SKU option normalization and catalog variant expansion are canonical", () => {
  assert.deepEqual(normalizeSkuOption("  Size   M "), { label: "Size M", key: "size m" });
  assert.deepEqual(collectProductVariants({
    sizes: ["S", "M"],
    colors: [{ name: "Red" }, "Blue"],
    variants: [],
  }), [
    { size: "S", color: "Red" },
    { size: "S", color: "Blue" },
    { size: "M", color: "Red" },
    { size: "M", color: "Blue" },
  ]);
});

test("legacy backfill planning merges equivalent labels and flags aggregate variance", () => {
  const planned = planLegacyInventoryBackfill([{
    id: "inventory-1",
    manufacturerId: "manufacturer-1",
    productId: "product-1",
    quantity: 6,
    reservedQty: 1,
    variantsStock: [
      { size: "M", color: "Red", quantity: 4, reservedQty: 1 },
      { size: " m ", color: "RED", quantity: 2, reservedQty: 0 },
    ],
  }]);

  assert.equal(planned.errors.length, 0);
  assert.deepEqual(planned.entries, [{
    manufacturerId: "manufacturer-1",
    productId: "product-1",
    manufacturerInventoryId: "inventory-1",
    size: "M",
    color: "Red",
    quantity: 6,
    reservedQuantity: 1,
  }]);

  const invalid = planLegacyInventoryBackfill([{
    id: "inventory-2",
    manufacturerId: "manufacturer-1",
    productId: "product-1",
    quantity: 8,
    reservedQty: 0,
    variantsStock: [{ size: "M", color: "Red", quantity: 7, reservedQty: 0 }],
  }]);
  assert.equal(invalid.entries.length, 0);
  assert.equal(invalid.errors[0].code, "LEGACY_INVENTORY_VARIANCE");

  const zeroStockVariant = planLegacyInventoryBackfill([{
    id: "inventory-3",
    manufacturerId: "manufacturer-1",
    productId: "product-1",
    quantity: 0,
    reservedQty: 0,
    variantsStock: [{ size: "XS", color: "Black", quantity: 0, reservedQty: 0 }],
  }]);
  assert.deepEqual(zeroStockVariant.skuVariants, [{ productId: "product-1", size: "XS", color: "Black" }]);
  assert.equal(zeroStockVariant.entries.length, 0);
});

test("stock movement is atomic, idempotent, and cannot consume reserved quantity", async () => {
  const { tx, balances, entries, balanceKey } = createInventoryTransaction({
    quantityOnHand: 6,
    reservedQuantity: 2,
  });
  const first = await applyInventoryMovement(tx, movement);
  assert.equal(first.replayed, false);
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 2);
  assert.equal(balances.get(balanceKey("transit-1", "sku-1")).quantityOnHand, 4);
  assert.equal(entries.size, 1);

  const replay = await applyInventoryMovement(tx, movement);
  assert.equal(replay.replayed, true);
  assert.equal(entries.size, 1);
  const { tx: reservedTx } = createInventoryTransaction({ quantityOnHand: 6, reservedQuantity: 2 });
  await assert.rejects(
    applyInventoryMovement(reservedTx, { ...movement, quantity: 5, idempotencyKey: "reserved-stock" }),
    (error) => error.code === "INSUFFICIENT_AVAILABLE_STOCK",
  );
  await assert.rejects(
    applyInventoryMovement(tx, { ...movement, quantity: 5, idempotencyKey: "different-shipment-line" }),
    (error) => error.code === "INSUFFICIENT_STOCK",
  );
  await assert.rejects(
    applyInventoryMovement(tx, { ...movement, quantity: 3, idempotencyKey: "shipment-line-1" }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("movement contract rejects invalid movement types, quantities, and required locations", () => {
  assert.throws(
    () => normalizeInventoryMovement({ ...movement, movementType: "UNSUPPORTED" }),
    (error) => error.code === "INVALID_MOVEMENT_TYPE",
  );
  for (const quantity of [0, -1, 1.5, "1.5", "", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeInventoryMovement({ ...movement, quantity }),
      (error) => error.code === "INVALID_QUANTITY",
    );
  }
  assert.throws(
    () => normalizeInventoryMovement({ ...movement, sourceLocationId: null }),
    (error) => error.code === "SOURCE_LOCATION_REQUIRED",
  );
  assert.throws(
    () => normalizeInventoryMovement({ ...movement, destinationLocationId: null }),
    (error) => error.code === "DESTINATION_LOCATION_REQUIRED",
  );
  assert.throws(
    () => normalizeInventoryMovement({
      ...movement,
      movementType: "FULFILLMENT",
      destinationLocationId: "transit-1",
    }),
    (error) => error.code === "UNEXPECTED_DESTINATION_LOCATION",
  );
  assert.throws(
    () => normalizeInventoryMovement({
      ...movement,
      movementType: "PRODUCTION_RECEIPT",
      sourceLocationId: "factory-1",
      destinationLocationId: "factory-1",
    }),
    (error) => error.code === "UNEXPECTED_SOURCE_LOCATION",
  );
});

test("movement contract normalizes exact integer text without mutating input", () => {
  const input = { ...movement, quantity: "4" };
  const snapshot = { ...input };
  const normalized = normalizeInventoryMovement(input);
  assert.equal(normalized.quantity, 4);
  assert.deepEqual(input, snapshot);
});

test("movement replay handles conflicts and does not repeat balance effects", async () => {
  const { tx, balances, entries, balanceKey } = createInventoryTransaction({
    quantityOnHand: 10,
  });
  const first = await applyInventoryMovement(tx, movement);
  const replay = await applyInventoryMovement(tx, movement);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(entries.size, 1);
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 6);
  assert.equal(balances.get(balanceKey("transit-1", "sku-1")).quantityOnHand, 4);
  await assert.rejects(
    applyInventoryMovement(tx, { ...movement, quantity: 3 }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("movement contract preserves custody ownership and has no accounting side effects", async () => {
  const { tx, balances, entries, balanceKey } = createInventoryTransaction({
    quantityOnHand: 5,
  });
  const result = await applyInventoryMovement(tx, {
    ...movement,
    idempotencyKey: "custody-dispatch-1",
  });
  assert.equal(result.replayed, false);
  assert.equal(entries.values().next().value.inventoryOwner, "PLATFORM");
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 1);
  assert.equal(balances.get(balanceKey("transit-1", "sku-1")).quantityOnHand, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(result.ledgerEntry, "journalEntryId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.ledgerEntry, "revenue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.ledgerEntry, "cogs"), false);
});

test("mocked transaction boundary reports rollback without partial balance or ledger state", async () => {
  const { tx, balances, entries, balanceKey } = createInventoryTransaction({
    quantityOnHand: 6,
  });
  const runMockTransaction = async (operation) => {
    const beforeBalances = new Map([...balances].map(([key, value]) => [key, { ...value }]));
    const beforeEntries = new Map(entries);
    try {
      return await operation(tx);
    } catch (error) {
      balances.clear();
      entries.clear();
      for (const [key, value] of beforeBalances) balances.set(key, value);
      for (const [key, value] of beforeEntries) entries.set(key, value);
      throw error;
    }
  };
  await assert.rejects(
    runMockTransaction(() => applyInventoryMovement(tx, {
      ...movement,
      quantity: 7,
      idempotencyKey: "failed-transfer",
    })),
    (error) => error.code === "INSUFFICIENT_STOCK",
  );
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 6);
  assert.equal(balances.get(balanceKey("transit-1", "sku-1")), undefined);
  assert.equal(entries.size, 0);
});

test("completed production receipt creates one canonical cost layer and factory ledger movement", async () => {
  const { tx, balances, entries, costLayers, balanceKey } = createInventoryTransaction();
  const input = {
    tx,
    requestId: "production-request-1",
    manufacturerId: "manufacturer-1",
    productId: "product-1",
    factoryLocationId: "factory-1",
    size: "M",
    color: "Black",
    quantity: 5,
    unitCogs: "10.00",
    manufacturerPayableRecognizedAtProduction: true,
    unitDeliveryCost: "3.00",
    actorId: "account-1",
    actorRole: "MANUFACTURER",
  };

  const first = await receiveCompletedProductionLine(input);
  assert.equal(first.replayed, false);
  assert.equal(first.costLayer.inventorySkuId, "sku-1");
  assert.equal(first.costLayer.manufacturerPayableRecognizedAtProduction, true);
  assert.equal(entries.size, 1);
  assert.equal(costLayers.size, 1);
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 5);

  const replay = await receiveCompletedProductionLine(input);
  assert.equal(replay.replayed, true);
  assert.equal(entries.size, 1);
  assert.equal(costLayers.size, 1);
  assert.equal(balances.get(balanceKey("factory-1", "sku-1")).quantityOnHand, 5);
  await assert.rejects(
    receiveCompletedProductionLine({ ...input, manufacturerPayableRecognizedAtProduction: false }),
    (error) => error.code === "PRODUCTION_RECEIPT_CONFLICT",
  );
});

test("ledger reconciliation reports source/destination balances and COGS-only valuation", () => {
  const items = reconcileInventoryLedger({
    balances: [
      { locationId: "factory-1", inventorySkuId: "sku-1", quantityOnHand: 3, reservedQuantity: 1 },
      { locationId: "transit-1", inventorySkuId: "sku-1", quantityOnHand: 4, reservedQuantity: 0 },
    ],
    ledgerEntries: [{
      sourceLocationId: "factory-1",
      destinationLocationId: "transit-1",
      inventorySkuId: "sku-1",
      quantity: 4,
    }],
  });
  assert.deepEqual(items.map(({ ledgerQuantity, balanceQuantity, variance }) => [ledgerQuantity, balanceQuantity, variance]), [
    [-4, 3, 7],
    [4, 4, 0],
  ]);

  const valuation = valueInventoryCostLayers([
    { inventorySkuId: "sku-1", availableQuantity: 1, reservedQuantity: 1, unitCogs: "10.25", unitDeliveryCost: "30.00" },
    { inventorySkuId: null, availableQuantity: 8, reservedQuantity: 0, unitCogs: "100.00" },
  ]);
  assert.deepEqual(valuation, { total: "20.50", bySku: [{ inventorySkuId: "sku-1", value: "20.50" }] });
  assert.deepEqual(planLegacyBalanceReconciliation({
    legacyQuantity: 10,
    legacyReservedQuantity: 3,
    ledgerQuantity: 4,
    ledgerReservedQuantity: 1,
  }), { openingQuantity: 6, reservedQuantityIncrease: 2 });
  assert.throws(() => planLegacyBalanceReconciliation({
    legacyQuantity: 3,
    legacyReservedQuantity: 0,
    ledgerQuantity: 4,
    ledgerReservedQuantity: 0,
  }), (error) => error.code === "LEDGER_EXCEEDS_LEGACY");
});
