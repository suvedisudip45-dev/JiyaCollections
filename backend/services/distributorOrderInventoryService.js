import { syncProductStock } from "./stockSyncService.js";

const normalizeSkuKey = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();

export const consumeDistributorOrderInventory = async ({
  tx,
  orderId,
  distributorId,
  assignmentId,
  items,
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
  for (const { productId, sizeKey, colorKey, quantity } of quantities.values()) {
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
        referenceType: "ORDER",
        referenceId: orderId,
        movementType: "FULFILLMENT",
        idempotencyKey: { startsWith: `ORDER_FULFILLMENT:${assignmentId}:${sku.id}:` },
      },
      select: { quantity: true },
    });
    if (priorMovements.length) {
      const previouslyConsumed = priorMovements.reduce((total, movement) => total + movement.quantity, 0);
      if (previouslyConsumed !== quantity) {
        throw new Error("Existing fulfillment movements do not match the order quantity.");
      }
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
    for (const balance of balances) {
      const consumeQuantity = Math.min(remaining, balance.reservedQuantity);
      if (!consumeQuantity) continue;
      const idempotencyKey = `ORDER_FULFILLMENT:${assignmentId}:${sku.id}:${balance.locationId}`;
      if (balance.quantityOnHand < consumeQuantity) {
        throw new Error("Reserved distributor stock is below the order quantity.");
      }
      const updated = await tx.inventoryBalance.updateMany({
        where: {
          id: balance.id,
          quantityOnHand: balance.quantityOnHand,
          reservedQuantity: balance.reservedQuantity,
        },
        data: {
          quantityOnHand: { decrement: consumeQuantity },
          reservedQuantity: { decrement: consumeQuantity },
        },
      });
      if (updated.count !== 1) {
        throw new Error("Distributor stock changed during order fulfillment. Retry the delivery update.");
      }
      await tx.inventoryLedgerEntry.create({
        data: {
          inventorySkuId: sku.id,
          sourceLocationId: balance.locationId,
          destinationLocationId: null,
          quantity: consumeQuantity,
          movementType: "FULFILLMENT",
          inventoryOwner: "PLATFORM",
          referenceType: "ORDER",
          referenceId: orderId,
          idempotencyKey,
          actorId,
          actorRole,
          reason: `Distributor fulfillment for Order ${orderId}`,
        },
      });
      remaining -= consumeQuantity;
    }
    if (remaining) {
      throw new Error(`Distributor reservation is insufficient for product ${productId}.`);
    }
    affectedProductIds.add(productId);
  }

  await Promise.all([...affectedProductIds].map((productId) =>
    syncProductStock(productId, { client: tx, throwOnError: true })
  ));
};
