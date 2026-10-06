import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const MOVEMENT_TYPES = new Set([
  "OPENING_BALANCE",
  "PRODUCTION_RECEIPT",
  "TRANSFER_DISPATCH",
  "TRANSFER_RECEIPT",
  "FULFILLMENT",
  "RETURN",
  "DAMAGE",
  "LOSS",
  "ADJUSTMENT",
]);

const LOCATION_KINDS = new Set(["FACTORY", "DISTRIBUTOR", "IN_TRANSIT", "QUARANTINE", "DAMAGED", "LOST"]);

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") throw fail("Legacy variant data must be an array.", "INVALID_LEGACY_VARIANTS");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw fail("Legacy variant data contains invalid JSON.", "INVALID_LEGACY_VARIANTS");
  }
  if (!Array.isArray(parsed)) throw fail("Legacy variant data must be an array.", "INVALID_LEGACY_VARIANTS");
  return parsed;
};

export const normalizeSkuOption = (value) => {
  const label = String(value || "Standard").trim().replace(/\s+/g, " ");
  if (!label || label.length > 120) throw fail("SKU size and color values must be between 1 and 120 characters.", "INVALID_SKU_OPTION");
  return { label, key: label.toLowerCase() };
};

const uniqueVariants = (variants) => {
  const normalized = new Map();
  for (const variant of variants) {
    const size = normalizeSkuOption(variant?.size);
    const color = normalizeSkuOption(variant?.color);
    normalized.set(JSON.stringify([size.key, color.key]), { size: size.label, color: color.label });
  }
  return [...normalized.values()];
};

const catalogValues = (value, field) => parseArray(value)
  .map((entry) => {
    if (typeof entry === "string" || typeof entry === "number") return String(entry);
    return String(entry?.[field] || entry?.name || entry?.value || "").trim();
  })
  .filter(Boolean);

export const collectProductVariants = (product) => {
  const explicit = parseArray(product?.variants)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({ size: entry.size, color: entry.color }));
  if (explicit.length) return uniqueVariants(explicit);

  const sizes = catalogValues(product?.sizes, "size");
  const colors = catalogValues(product?.colors, "color");
  if (!sizes.length) return [{ size: "Standard", color: "Standard" }];
  return uniqueVariants(sizes.flatMap((size) =>
    (colors.length ? colors : ["Standard"]).map((color) => ({ size, color }))
  ));
};

export const collectLegacyInventoryVariants = (value) => uniqueVariants(
  parseArray(value).map((entry) => ({
    size: entry?.size,
    color: entry?.color,
  }))
);

export const planLegacyInventoryBackfill = (inventories) => {
  const entries = [];
  const skuVariants = [];
  const errors = [];
  for (const inventory of inventories) {
    try {
      let variants = parseArray(inventory.variantsStock);
      if (!variants.length && Number(inventory.quantity || 0) > 0) {
        variants = [{ size: "Standard", color: "Standard", quantity: inventory.quantity, reservedQty: inventory.reservedQty || 0 }];
      }
      const grouped = new Map();
      for (const variant of variants) {
        const size = normalizeSkuOption(variant?.size);
        const color = normalizeSkuOption(variant?.color);
        const quantity = Number(variant?.quantity || 0);
        const reservedQuantity = Number(variant?.reservedQty || 0);
        if (
          !Number.isSafeInteger(quantity) ||
          !Number.isSafeInteger(reservedQuantity) ||
          quantity < 0 ||
          reservedQuantity < 0 ||
          reservedQuantity > quantity
        ) {
          throw fail("Legacy variant quantities must be valid whole numbers with reservations within on-hand stock.", "INVALID_LEGACY_QUANTITY");
        }
        const key = JSON.stringify([size.key, color.key]);
        const current = grouped.get(key) || { size: size.label, color: color.label, quantity: 0, reservedQuantity: 0 };
        current.quantity += quantity;
        current.reservedQuantity += reservedQuantity;
        grouped.set(key, current);
      }
      const normalized = [...grouped.values()];
      skuVariants.push(...normalized.map((variant) => ({
        productId: inventory.productId,
        size: variant.size,
        color: variant.color,
      })));
      const totalQuantity = normalized.reduce((sum, variant) => sum + variant.quantity, 0);
      const totalReserved = normalized.reduce((sum, variant) => sum + variant.reservedQuantity, 0);
      if (totalQuantity !== Number(inventory.quantity || 0) || totalReserved !== Number(inventory.reservedQty || 0)) {
        throw fail(
          `Legacy inventory ${inventory.id} aggregate quantities do not match its variant quantities.`,
          "LEGACY_INVENTORY_VARIANCE",
          409,
        );
      }
      entries.push(...normalized.filter((variant) => variant.quantity > 0).map((variant) => ({
        manufacturerId: inventory.manufacturerId,
        productId: inventory.productId,
        manufacturerInventoryId: inventory.id,
        ...variant,
      })));
    } catch (error) {
      errors.push({ inventoryId: inventory.id, message: error.message, code: error.code || "INVALID_LEGACY_INVENTORY" });
    }
  }
  return { entries, skuVariants, errors };
};

export const planLegacyBalanceReconciliation = ({
  legacyQuantity,
  legacyReservedQuantity,
  ledgerQuantity,
  ledgerReservedQuantity,
}) => {
  const values = [legacyQuantity, legacyReservedQuantity, ledgerQuantity, ledgerReservedQuantity].map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 2147483647)) {
    throw fail("Legacy and ledger balances must be valid whole numbers.", "INVALID_BALANCE_RECONCILIATION");
  }
  const [legacyOnHand, legacyReserved, ledgerOnHand, ledgerReserved] = values;
  if (legacyReserved > legacyOnHand || ledgerReserved > ledgerOnHand) {
    throw fail("Reserved stock cannot exceed on-hand stock.", "INVALID_RESERVED_BALANCE", 409);
  }
  if (ledgerOnHand > legacyOnHand || ledgerReserved > legacyReserved) {
    throw fail("The ledger balance exceeds the legacy inventory quantity; reconcile the variance before backfilling.", "LEDGER_EXCEEDS_LEGACY", 409);
  }
  return {
    openingQuantity: legacyOnHand - ledgerOnHand,
    reservedQuantityIncrease: legacyReserved - ledgerReserved,
  };
};

export const ensureInventorySku = async (tx, { productId, size, color, skuCode = null }) => {
  if (!productId) throw fail("A product is required to create an inventory SKU.", "PRODUCT_REQUIRED");
  const normalizedSize = normalizeSkuOption(size);
  const normalizedColor = normalizeSkuOption(color);
  return tx.inventorySku.upsert({
    where: {
      productId_sizeKey_colorKey: {
        productId,
        sizeKey: normalizedSize.key,
        colorKey: normalizedColor.key,
      },
    },
    create: {
      productId,
      size: normalizedSize.label,
      color: normalizedColor.label,
      sizeKey: normalizedSize.key,
      colorKey: normalizedColor.key,
      skuCode: skuCode ? String(skuCode).trim() : null,
    },
    update: {},
  });
};

export const buildInventoryLocationKey = ({ kind, manufacturerId, distributorId, referenceId }) => {
  const normalizedKind = String(kind || "").trim().toUpperCase();
  if (!LOCATION_KINDS.has(normalizedKind)) throw fail("Select a valid inventory location type.", "INVALID_LOCATION_KIND");
  if (normalizedKind === "FACTORY") {
    if (!manufacturerId || distributorId) throw fail("A factory location must belong to exactly one manufacturer.", "INVALID_LOCATION_OWNER");
    return `FACTORY:${manufacturerId}`;
  }
  if (normalizedKind === "DISTRIBUTOR") {
    if (!distributorId || manufacturerId) throw fail("A distributor location must belong to exactly one distributor.", "INVALID_LOCATION_OWNER");
    return `DISTRIBUTOR:${distributorId}`;
  }
  if (normalizedKind === "IN_TRANSIT") {
    if (!referenceId || manufacturerId || distributorId) throw fail("An in-transit location requires a shipment reference.", "INVALID_LOCATION_OWNER");
    return `IN_TRANSIT:${referenceId}`;
  }
  if (Boolean(manufacturerId) === Boolean(distributorId)) {
    throw fail("A quarantine, damaged, or lost location must belong to exactly one custodian.", "INVALID_LOCATION_OWNER");
  }
  return `${normalizedKind}:${manufacturerId ? `MANUFACTURER:${manufacturerId}` : `DISTRIBUTOR:${distributorId}`}`;
};

export const ensureInventoryLocation = async (tx, {
  kind,
  name,
  manufacturerId = null,
  distributorId = null,
  referenceId = null,
}) => {
  const normalizedKind = String(kind || "").trim().toUpperCase();
  const locationKey = buildInventoryLocationKey({ kind: normalizedKind, manufacturerId, distributorId, referenceId });
  if (locationKey.length > 191) throw fail("Inventory location keys cannot exceed 191 characters.", "INVALID_LOCATION_KEY");
  const validateLocation = (location) => {
    if (
      location &&
      (
        location.kind !== normalizedKind ||
        location.manufacturerId !== manufacturerId ||
        location.distributorId !== distributorId ||
        location.inventoryOwner !== "PLATFORM"
      )
    ) throw fail("The inventory location key is already assigned to a different location.", "LOCATION_KEY_CONFLICT", 409);
    return location;
  };
  const existing = await tx.inventoryLocation.findUnique({ where: { locationKey } });
  if (existing) return validateLocation(existing);
  try {
    return await tx.inventoryLocation.create({
      data: {
        locationKey,
        name: (String(name || "").trim() || normalizedKind).slice(0, 191),
        kind: normalizedKind,
        inventoryOwner: "PLATFORM",
        manufacturerId,
        distributorId,
      },
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const racedLocation = await tx.inventoryLocation.findUnique({ where: { locationKey } });
    if (racedLocation) return validateLocation(racedLocation);
    throw error;
  }
};

const normalizeMovement = (movement) => {
  const quantity = Number(movement.quantity);
  const movementType = String(movement.movementType || "").trim().toUpperCase();
  const sourceLocationId = movement.sourceLocationId || null;
  const destinationLocationId = movement.destinationLocationId || null;
  const idempotencyKey = String(movement.idempotencyKey || "").trim();
  const actorId = String(movement.actorId || "").trim();
  const actorRole = String(movement.actorRole || "").trim().toUpperCase();

  if (!movement.inventorySkuId) throw fail("An inventory SKU is required.", "SKU_REQUIRED");
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
    throw fail("Movement quantity must be a positive whole number within the supported inventory limit.", "INVALID_QUANTITY");
  }
  if (!MOVEMENT_TYPES.has(movementType)) throw fail("Select a valid inventory movement type.", "INVALID_MOVEMENT_TYPE");
  if (!sourceLocationId && !destinationLocationId) throw fail("A stock movement must have a source or destination location.", "LOCATION_REQUIRED");
  if (sourceLocationId && sourceLocationId === destinationLocationId) throw fail("Source and destination locations must be different.", "SAME_LOCATION");
  if (!idempotencyKey || idempotencyKey.length > 191) throw fail("A valid idempotency key is required.", "IDEMPOTENCY_KEY_REQUIRED");
  if (movement.referenceId && String(movement.referenceId).length > 191) throw fail("Movement reference IDs cannot exceed 191 characters.", "INVALID_REFERENCE_ID");
  if (!actorId || !actorRole) throw fail("An actor and active workspace role are required for every stock movement.", "ACTOR_REQUIRED");
  if (!String(movement.reason || "").trim()) throw fail("A reason is required for every stock movement.", "REASON_REQUIRED");

  return {
    inventorySkuId: movement.inventorySkuId,
    sourceLocationId,
    destinationLocationId,
    quantity,
    movementType,
    inventoryOwner: "PLATFORM",
    referenceType: movement.referenceType ? String(movement.referenceType).trim().slice(0, 64) : null,
    referenceId: movement.referenceId ? String(movement.referenceId).trim() : null,
    productionCostLayerId: movement.productionCostLayerId || null,
    idempotencyKey,
    actorId,
    actorRole,
    reason: String(movement.reason).trim().slice(0, 2000),
  };
};

const assertIdempotentReplay = (existing, movement) => {
  const matches = existing.inventorySkuId === movement.inventorySkuId
    && existing.sourceLocationId === movement.sourceLocationId
    && existing.destinationLocationId === movement.destinationLocationId
    && existing.quantity === movement.quantity
    && existing.movementType === movement.movementType
    && existing.inventoryOwner === movement.inventoryOwner
    && existing.referenceType === movement.referenceType
    && existing.referenceId === movement.referenceId
    && existing.productionCostLayerId === movement.productionCostLayerId
    && existing.actorId === movement.actorId
    && existing.actorRole === movement.actorRole
    && existing.reason === movement.reason;
  if (!matches) throw fail("The idempotency key was already used for a different stock movement.", "IDEMPOTENCY_CONFLICT", 409);
};

const ensureBalance = (tx, locationId, inventorySkuId) => tx.inventoryBalance.upsert({
  where: { locationId_inventorySkuId: { locationId, inventorySkuId } },
  create: { locationId, inventorySkuId, quantityOnHand: 0, reservedQuantity: 0 },
  update: {},
});

export const applyInventoryMovement = async (tx, input) => {
  const movement = normalizeMovement(input);
  const existing = await tx.inventoryLedgerEntry.findUnique({
    where: { idempotencyKey: movement.idempotencyKey },
  });
  if (existing) {
    assertIdempotentReplay(existing, movement);
    return { ledgerEntry: existing, replayed: true };
  }

  const sku = await tx.inventorySku.findUnique({
    where: { id: movement.inventorySkuId },
    select: { id: true, isActive: true },
  });
  if (!sku?.isActive) throw fail("The inventory SKU is missing or inactive.", "SKU_INACTIVE", 409);
  const locationIds = [movement.sourceLocationId, movement.destinationLocationId].filter(Boolean);
  const locations = await tx.inventoryLocation.findMany({
    where: { id: { in: locationIds }, isActive: true, inventoryOwner: "PLATFORM" },
    select: { id: true },
  });
  if (locations.length !== locationIds.length) {
    throw fail("Every movement location must be active and platform-owned.", "LOCATION_INACTIVE", 409);
  }

  if (movement.sourceLocationId) {
    await ensureBalance(tx, movement.sourceLocationId, movement.inventorySkuId);
    const sourceBalance = await tx.inventoryBalance.findUnique({
      where: {
        locationId_inventorySkuId: {
          locationId: movement.sourceLocationId,
          inventorySkuId: movement.inventorySkuId,
        },
      },
    });
    if (!sourceBalance || sourceBalance.quantityOnHand < movement.quantity) {
      throw fail("The source location does not have enough stock.", "INSUFFICIENT_STOCK", 409);
    }
    if (sourceBalance.quantityOnHand - sourceBalance.reservedQuantity < movement.quantity) {
      throw fail("The source location has insufficient unreserved stock.", "INSUFFICIENT_AVAILABLE_STOCK", 409);
    }
    const decremented = await tx.inventoryBalance.updateMany({
      where: {
        locationId: movement.sourceLocationId,
        inventorySkuId: movement.inventorySkuId,
        quantityOnHand: sourceBalance.quantityOnHand,
        reservedQuantity: sourceBalance.reservedQuantity,
      },
      data: { quantityOnHand: { decrement: movement.quantity } },
    });
    if (decremented.count !== 1) {
      throw fail("The source balance changed concurrently; refresh and retry.", "INVENTORY_CONFLICT", 409);
    }
  }

  if (movement.destinationLocationId) {
    await ensureBalance(tx, movement.destinationLocationId, movement.inventorySkuId);
    const destinationBalance = await tx.inventoryBalance.findUnique({
      where: {
        locationId_inventorySkuId: {
          locationId: movement.destinationLocationId,
          inventorySkuId: movement.inventorySkuId,
        },
      },
    });
    if (destinationBalance.quantityOnHand + movement.quantity > 2147483647) {
      throw fail("The destination quantity exceeds the supported inventory limit.", "QUANTITY_OVERFLOW", 409);
    }
    const incremented = await tx.inventoryBalance.updateMany({
      where: {
        locationId: movement.destinationLocationId,
        inventorySkuId: movement.inventorySkuId,
        quantityOnHand: destinationBalance.quantityOnHand,
      },
      data: { quantityOnHand: { increment: movement.quantity } },
    });
    if (incremented.count !== 1) {
      throw fail("The destination balance changed concurrently; refresh and retry.", "INVENTORY_CONFLICT", 409);
    }
  }

  const ledgerEntry = await tx.inventoryLedgerEntry.create({ data: movement });
  return { ledgerEntry, replayed: false };
};

export const recordInventoryMovement = async (movement, { client = prisma } = {}) => {
  try {
    return await client.$transaction((tx) => applyInventoryMovement(tx, movement));
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const normalized = normalizeMovement(movement);
    const existing = await client.inventoryLedgerEntry.findUnique({
      where: { idempotencyKey: normalized.idempotencyKey },
    });
    if (!existing) throw error;
    assertIdempotentReplay(existing, normalized);
    return { ledgerEntry: existing, replayed: true };
  }
};

export const receiveCompletedProductionLine = async ({
  tx,
  requestId,
  manufacturerId,
  productId,
  factoryLocationId,
  size,
  color,
  quantity,
  unitCogs,
  unitDeliveryCost,
  actorId,
  actorRole = "MANUFACTURER",
}) => {
  if (!requestId || !manufacturerId || !productId || !factoryLocationId) {
    throw fail("Production request, manufacturer, product, and factory location are required.", "PRODUCTION_RECEIPT_CONTEXT_REQUIRED");
  }
  const sku = await ensureInventorySku(tx, { productId, size, color });
  const costLayer = await tx.manufacturerInventoryCostLayer.upsert({
    where: {
      productionRequestId_size_color: {
        productionRequestId: requestId,
        size: sku.size,
        color: sku.color,
      },
    },
    create: {
      productionRequestId: requestId,
      manufacturerId,
      productId,
      inventorySkuId: sku.id,
      size: sku.size,
      color: sku.color,
      producedQuantity: quantity,
      availableQuantity: quantity,
      unitCogs,
      unitDeliveryCost,
    },
    update: {},
  });
  if (
    costLayer.manufacturerId !== manufacturerId ||
    costLayer.productId !== productId ||
    costLayer.inventorySkuId !== sku.id ||
    costLayer.producedQuantity !== quantity ||
    !new Prisma.Decimal(String(costLayer.unitCogs)).equals(String(unitCogs)) ||
    !new Prisma.Decimal(String(costLayer.unitDeliveryCost)).equals(String(unitDeliveryCost))
  ) {
    throw fail("The production cost layer conflicts with the requested factory receipt.", "PRODUCTION_RECEIPT_CONFLICT", 409);
  }
  const movement = await applyInventoryMovement(tx, {
    inventorySkuId: sku.id,
    destinationLocationId: factoryLocationId,
    quantity,
    movementType: "PRODUCTION_RECEIPT",
    referenceType: "MANUFACTURER_PRODUCTION_REQUEST",
    referenceId: requestId,
    productionCostLayerId: costLayer.id,
    idempotencyKey: `production-receipt:${createHash("sha256").update(`${requestId}:${sku.id}`).digest("hex")}`,
    actorId,
    actorRole,
    reason: "Completed production received into factory stock.",
  });
  return { sku, costLayer, ...movement };
};

export const reconcileInventoryLedger = ({ balances, ledgerEntries, locationId = null }) => {
  const byKey = new Map();
  const getRecord = (locationId, inventorySkuId) => {
    const key = JSON.stringify([locationId, inventorySkuId]);
    if (!byKey.has(key)) {
      byKey.set(key, { locationId, inventorySkuId, ledgerQuantity: 0, balanceQuantity: 0, reservedQuantity: 0 });
    }
    return byKey.get(key);
  };
  for (const entry of ledgerEntries) {
    if (entry.sourceLocationId) getRecord(entry.sourceLocationId, entry.inventorySkuId).ledgerQuantity -= entry.quantity;
    if (entry.destinationLocationId) getRecord(entry.destinationLocationId, entry.inventorySkuId).ledgerQuantity += entry.quantity;
  }
  for (const balance of balances) {
    const record = getRecord(balance.locationId, balance.inventorySkuId);
    record.balanceQuantity = balance.quantityOnHand;
    record.reservedQuantity = balance.reservedQuantity;
  }
  return [...byKey.values()]
    .filter((record) => !locationId || record.locationId === locationId)
    .map((record) => ({ ...record, variance: record.balanceQuantity - record.ledgerQuantity }))
    .sort((left, right) =>
      left.locationId.localeCompare(right.locationId) || left.inventorySkuId.localeCompare(right.inventorySkuId)
    );
};

export const valueInventoryCostLayers = (layers) => {
  let total = new Prisma.Decimal(0);
  const bySku = new Map();
  for (const layer of layers) {
    if (!layer.inventorySkuId) continue;
    const quantity = Number(layer.availableQuantity || 0) + Number(layer.reservedQuantity || 0);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw fail("Cost-layer stock quantities must be non-negative whole numbers.", "INVALID_COST_LAYER_QUANTITY");
    }
    const value = new Prisma.Decimal(String(layer.unitCogs)).mul(quantity);
    total = total.add(value);
    const skuValue = (bySku.get(layer.inventorySkuId) || new Prisma.Decimal(0)).add(value);
    bySku.set(layer.inventorySkuId, skuValue);
  }
  return {
    total: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    bySku: [...bySku.entries()].map(([inventorySkuId, value]) => ({
      inventorySkuId,
      value: value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    })),
  };
};
