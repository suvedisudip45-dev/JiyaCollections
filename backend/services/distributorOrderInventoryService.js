import { syncProductStock } from "./stockSyncService.js";

const normalizeSkuKey = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();
const skuKeyFor = (productId, sizeKey, colorKey) => JSON.stringify([productId, sizeKey, colorKey]);

const applyDistributorCostAllocationsToItems = (items, allocationsBySku) => {
  const pending = new Map([...allocationsBySku.entries()].map(([key, allocations]) => [
    key,
    allocations.map((allocation) => ({ ...allocation })),
  ]));

  return items.map((item) => {
    const productId = String(item.productId || item._id || item.id || "");
    const quantity = Number(item.quantity ?? 1);
    const key = skuKeyFor(productId, normalizeSkuKey(item.size), normalizeSkuKey(item.color));
    const allocations = [];
    const existingAllocations = Array.isArray(item.productionCostAllocations)
      ? item.productionCostAllocations
      : [];
    allocations.push(...existingAllocations);
    let remaining = Math.max(0, quantity - existingAllocations.reduce(
      (sum, allocation) => sum + Number(allocation.quantity || 0),
      0,
    ));
    const skuAllocations = pending.get(key) || [];
    while (remaining > 0 && skuAllocations.length) {
      const next = skuAllocations[0];
      const allocatedQuantity = Math.min(remaining, next.quantity);
      allocations.push({ ...next, quantity: allocatedQuantity });
      next.quantity -= allocatedQuantity;
      remaining -= allocatedQuantity;
      if (next.quantity === 0) skuAllocations.shift();
    }
    pending.set(key, skuAllocations);
    return {
      ...item,
      productionCostAllocations: allocations,
      legacyCostQuantity: remaining,
    };
  });
};

export const consumeDistributorOrderInventory = async ({
  tx,
  orderId,
  distributorId,
  assignmentId,
  items,
  directSale = false,
  actorId = null,
  actorRole = "DISTRIBUTOR",
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Distributor order must contain inventory items before fulfillment.");
  }
  const quantities = new Map();
  for (const item of items || []) {
    const productId = String(item.productId || item._id || item.id || "");
    const quantity = Number(item.quantity ?? 1);
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Distributor order contains an invalid product or quantity.");
    }
    const sizeKey = normalizeSkuKey(item.size);
    const colorKey = normalizeSkuKey(item.color);
    const key = JSON.stringify([productId, sizeKey, colorKey]);
    const current = quantities.get(key);
    if (current) current.quantity += quantity;
    else quantities.set(key, { productId, sizeKey, colorKey, quantity });
  }

  const affectedProductIds = new Set();
  const allocationsBySku = new Map();
  const movementReferenceType = directSale ? "DIRECT_DISTRIBUTOR_ORDER" : "ORDER";
  for (const { productId, sizeKey, colorKey, quantity } of quantities.values()) {
    const itemSkuKey = skuKeyFor(productId, sizeKey, colorKey);
    const sku = await tx.inventorySku.findUnique({
      where: { productId_sizeKey_colorKey: { productId, sizeKey, colorKey } },
      select: { id: true, isActive: true },
    });
    if (!sku?.isActive) {
      throw new Error(`Distributor inventory SKU is missing or inactive for product ${productId}.`);
    }

    const priorMovements = await tx.inventoryLedgerEntry.findMany({
      where: {
        inventorySkuId: sku.id,
        referenceType: movementReferenceType,
        referenceId: orderId,
        movementType: "FULFILLMENT",
        idempotencyKey: {
          startsWith: directSale
            ? `DIRECT_DISTRIBUTOR_ORDER:${orderId}:${sku.id}:`
            : `ORDER_FULFILLMENT:${assignmentId}:${sku.id}:`,
        },
      },
      include: {
        productionCostLayer: {
          select: {
            manufacturerId: true,
            unitCogs: true,
            unitVatAmount: true,
            vatInvoiceVerified: true,
            manufacturerPayableRecognizedAtProduction: true,
            unitDeliveryCost: true,
          },
        },
      },
    });
    if (priorMovements.length) {
      const previouslyConsumed = priorMovements.reduce((total, movement) => total + movement.quantity, 0);
      if (previouslyConsumed !== quantity) {
        throw new Error("Existing fulfillment movements do not match the order quantity.");
      }
      allocationsBySku.set(itemSkuKey, priorMovements.flatMap((movement) =>
        movement.productionCostLayerId && movement.productionCostLayer
          ? [{
              quantity: movement.quantity,
              costLayerId: movement.productionCostLayerId,
              manufacturerId: movement.productionCostLayer.manufacturerId,
              manufacturerPayableRecognizedAtProduction:
                movement.productionCostLayer.manufacturerPayableRecognizedAtProduction === true,
              unitCogs: String(movement.productionCostLayer.unitCogs),
              unitVatAmount: String(movement.productionCostLayer.unitVatAmount || 0),
              vatInvoiceVerified: movement.productionCostLayer.vatInvoiceVerified === true,
              unitDeliveryCost: String(movement.productionCostLayer.unitDeliveryCost),
            }]
          : []
      ));
      affectedProductIds.add(productId);
      continue;
    }

    const balances = await tx.inventoryBalance.findMany({
      where: {
        inventorySkuId: sku.id,
        location: {
          distributorId,
          kind: "DISTRIBUTOR",
          inventoryOwner: "PLATFORM",
          isActive: true,
        },
      },
      orderBy: { locationId: "asc" },
    });
    let remaining = quantity;
    const costAllocations = [];
    for (const balance of balances) {
      const availableQuantity = directSale
        ? Math.max(0, balance.quantityOnHand - balance.reservedQuantity)
        : balance.reservedQuantity;
      const consumeQuantity = Math.min(remaining, availableQuantity);
      if (!consumeQuantity) continue;
      const idempotencyKey = directSale
        ? `DIRECT_DISTRIBUTOR_ORDER:${orderId}:${sku.id}:${balance.locationId}`
        : `ORDER_FULFILLMENT:${assignmentId}:${sku.id}:${balance.locationId}`;
      if (balance.quantityOnHand < consumeQuantity) {
        throw new Error(directSale
          ? "Available distributor stock is below the direct sale quantity."
          : "Reserved distributor stock is below the order quantity.");
      }
      const updated = await tx.inventoryBalance.updateMany({
        where: {
          id: balance.id,
          quantityOnHand: balance.quantityOnHand,
          reservedQuantity: balance.reservedQuantity,
        },
        data: {
          quantityOnHand: { decrement: consumeQuantity },
          ...(directSale ? {} : { reservedQuantity: { decrement: consumeQuantity } }),
        },
      });
      if (updated.count !== 1) {
        throw new Error("Distributor stock changed during order fulfillment. Retry the delivery update.");
      }
      const costMovements = await tx.inventoryLedgerEntry.findMany({
        where: {
          inventorySkuId: sku.id,
          productionCostLayerId: { not: null },
          OR: [
            { destinationLocationId: balance.locationId },
            { sourceLocationId: balance.locationId },
          ],
        },
        include: {
          productionCostLayer: {
            select: {
              id: true,
              manufacturerId: true,
              unitCogs: true,
              unitVatAmount: true,
              vatInvoiceVerified: true,
              manufacturerPayableRecognizedAtProduction: true,
              unitDeliveryCost: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const availableByLayer = new Map();
      for (const movement of costMovements) {
        if (!movement.productionCostLayer) continue;
        const layerId = movement.productionCostLayerId;
        const current = availableByLayer.get(layerId) || {
          layer: movement.productionCostLayer,
          quantity: 0,
        };
        if (movement.destinationLocationId === balance.locationId) current.quantity += movement.quantity;
        if (movement.sourceLocationId === balance.locationId) current.quantity -= movement.quantity;
        availableByLayer.set(layerId, current);
      }
      const costLayers = [...availableByLayer.values()]
        .filter((entry) => entry.quantity > 0)
        .sort((left, right) => (
          new Date(left.layer.createdAt).getTime() - new Date(right.layer.createdAt).getTime()
          || left.layer.id.localeCompare(right.layer.id)
        ));
      let costedRemaining = consumeQuantity;
      const fulfillmentMovements = [];
      for (const entry of costLayers) {
        const allocatedQuantity = Math.min(costedRemaining, entry.quantity);
        if (!allocatedQuantity) continue;
        fulfillmentMovements.push({
          quantity: allocatedQuantity,
          productionCostLayerId: entry.layer.id,
          layer: entry.layer,
        });
        costAllocations.push({
          quantity: allocatedQuantity,
          costLayerId: entry.layer.id,
          manufacturerId: entry.layer.manufacturerId,
          manufacturerPayableRecognizedAtProduction:
            entry.layer.manufacturerPayableRecognizedAtProduction === true,
          unitCogs: String(entry.layer.unitCogs),
          unitVatAmount: String(entry.layer.unitVatAmount || 0),
          vatInvoiceVerified: entry.layer.vatInvoiceVerified === true,
          unitDeliveryCost: String(entry.layer.unitDeliveryCost),
        });
        costedRemaining -= allocatedQuantity;
        if (!costedRemaining) break;
      }
      if (costedRemaining > 0) {
        fulfillmentMovements.push({ quantity: costedRemaining, productionCostLayerId: null, layer: null });
      }
      for (const movement of fulfillmentMovements) {
        await tx.inventoryLedgerEntry.create({
          data: {
            inventorySkuId: sku.id,
            sourceLocationId: balance.locationId,
            destinationLocationId: null,
            quantity: movement.quantity,
            movementType: "FULFILLMENT",
            inventoryOwner: "PLATFORM",
            referenceType: movementReferenceType,
            referenceId: orderId,
            productionCostLayerId: movement.productionCostLayerId,
            idempotencyKey: movement.productionCostLayerId
              ? `${idempotencyKey}:${movement.productionCostLayerId}`
              : `${idempotencyKey}:uncosted`,
            actorId,
            actorRole,
            reason: directSale
              ? `Distributor direct hub sale for Order ${orderId}`
              : `Distributor fulfillment for Order ${orderId}`,
          },
        });
      }
      remaining -= consumeQuantity;
    }
    if (remaining) {
      throw new Error(directSale
        ? `Available distributor stock is insufficient for product ${productId}.`
        : `Distributor reservation is insufficient for product ${productId}.`);
    }
    allocationsBySku.set(itemSkuKey, costAllocations);
    affectedProductIds.add(productId);
  }

  await Promise.all([...affectedProductIds].map((productId) =>
    syncProductStock(productId, { client: tx, throwOnError: true })
  ));
  return { accountingItems: applyDistributorCostAllocationsToItems(items, allocationsBySku) };
};
