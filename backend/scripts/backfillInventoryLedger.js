import "dotenv/config";
import { createHash } from "node:crypto";
import { prisma } from "../config/db.js";
import {
  applyInventoryMovement,
  collectProductVariants,
  ensureInventoryLocation,
  ensureInventorySku,
  planLegacyBalanceReconciliation,
  planLegacyInventoryBackfill,
} from "../services/inventoryLedgerService.js";

const applyChanges = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-ledger-backfill");

const run = async () => {
  const [products, inventories] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, name: true, sizes: true, colors: true, variants: true },
    }),
    prisma.manufacturerInventory.findMany({
      select: {
        id: true,
        manufacturerId: true,
        productId: true,
        productName: true,
        quantity: true,
        reservedQty: true,
        variantsStock: true,
      },
    }),
  ]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const backfill = planLegacyInventoryBackfill(inventories);
  const orphanedInventory = backfill.skuVariants.filter((entry) => !productById.has(entry.productId));
  if (orphanedInventory.length) {
    backfill.errors.push({
      inventoryId: orphanedInventory[0].manufacturerInventoryId,
      message: "Legacy inventory references a product that no longer exists.",
      code: "ORPHANED_PRODUCT",
    });
  }
  console.log(JSON.stringify({
    mode: applyChanges ? "APPLY" : "DRY_RUN",
    productCount: products.length,
    legacyInventoryCount: inventories.length,
    plannedOpeningMovements: backfill.entries.length,
    legacyInventoryErrors: backfill.errors,
  }, null, 2));

  if (!applyChanges) {
    if (backfill.errors.length) process.exitCode = 2;
    return;
  }
  if (!confirmed) {
    throw new Error("Applying requires both --apply and --confirm-ledger-backfill.");
  }
  if (backfill.errors.length) {
    throw new Error("Legacy inventory discrepancies must be reconciled before applying the backfill.");
  }

  const unlinkedCostLayers = await prisma.manufacturerInventoryCostLayer.findMany({
    where: { inventorySkuId: null },
    select: { id: true, productId: true, size: true, color: true },
  });
  if (unlinkedCostLayers.some((layer) => !productById.has(layer.productId))) {
    throw new Error("Some production cost layers reference products that no longer exist; reconcile them before applying the backfill.");
  }
  const variantsByProduct = new Map();
  for (const product of products) {
    variantsByProduct.set(product.id, collectProductVariants(product));
  }
  for (const entry of backfill.skuVariants) {
    const variants = variantsByProduct.get(entry.productId) || [];
    variants.push({ size: entry.size, color: entry.color });
    variantsByProduct.set(entry.productId, variants);
  }
  for (const layer of unlinkedCostLayers) {
    const variants = variantsByProduct.get(layer.productId) || [];
    variants.push({ size: layer.size, color: layer.color });
    variantsByProduct.set(layer.productId, variants);
  }

  for (const [productId, variants] of variantsByProduct) {
    const skuByKey = new Map();
    for (const variant of variants) {
      const sku = await prisma.$transaction((tx) => ensureInventorySku(tx, { productId, ...variant }));
      skuByKey.set(JSON.stringify([sku.sizeKey, sku.colorKey]), sku);
    }
    variantsByProduct.set(productId, skuByKey);
  }
  for (const layer of unlinkedCostLayers) {
    const skuMap = variantsByProduct.get(layer.productId);
    const sku = skuMap?.get(JSON.stringify([
      String(layer.size || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
      String(layer.color || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
    ]));
    if (!sku) throw new Error(`No canonical SKU could be matched to cost layer ${layer.id}.`);
    await prisma.manufacturerInventoryCostLayer.updateMany({
      where: { id: layer.id, inventorySkuId: null },
      data: { inventorySkuId: sku.id },
    });
  }

  for (const inventory of inventories) {
    const entries = backfill.entries.filter((entry) => entry.manufacturerInventoryId === inventory.id);
    if (!entries.length) continue;
    await prisma.$transaction(async (tx) => {
      const product = productById.get(inventory.productId);
      const location = await ensureInventoryLocation(tx, {
        kind: "FACTORY",
        manufacturerId: inventory.manufacturerId,
        name: `${product?.name || inventory.productName} Factory`,
      });
      for (const entry of entries) {
        const sku = await ensureInventorySku(tx, {
          productId: entry.productId,
          size: entry.size,
          color: entry.color,
        });
        const currentBalance = await tx.inventoryBalance.findUnique({
          where: { locationId_inventorySkuId: { locationId: location.id, inventorySkuId: sku.id } },
        });
        const reconciliation = planLegacyBalanceReconciliation({
          legacyQuantity: entry.quantity,
          legacyReservedQuantity: entry.reservedQuantity,
          ledgerQuantity: currentBalance?.quantityOnHand || 0,
          ledgerReservedQuantity: currentBalance?.reservedQuantity || 0,
        });
        if (reconciliation.openingQuantity > 0) {
          await applyInventoryMovement(tx, {
            inventorySkuId: sku.id,
            destinationLocationId: location.id,
            quantity: reconciliation.openingQuantity,
            movementType: "OPENING_BALANCE",
            referenceType: "LEGACY_MANUFACTURER_INVENTORY",
            referenceId: inventory.id,
            idempotencyKey: `legacy-opening:${createHash("sha256").update(`${inventory.id}:${sku.id}:${currentBalance?.quantityOnHand || 0}:${entry.quantity}`).digest("hex")}`,
            actorId: "SYSTEM_MIGRATION",
            actorRole: "SYSTEM",
            reason: "One-time reconciled opening balance from legacy variant inventory.",
          });
        }
        if (reconciliation.reservedQuantityIncrease > 0) {
          const balance = await tx.inventoryBalance.findUnique({
            where: { locationId_inventorySkuId: { locationId: location.id, inventorySkuId: sku.id } },
          });
          const reserved = await tx.inventoryBalance.updateMany({
            where: {
              locationId: location.id,
              inventorySkuId: sku.id,
              quantityOnHand: balance.quantityOnHand,
              reservedQuantity: balance.reservedQuantity,
            },
            data: { reservedQuantity: { increment: reconciliation.reservedQuantityIncrease } },
          });
          if (reserved.count !== 1) throw new Error(`Could not restore reserved quantity for legacy inventory ${inventory.id}.`);
        }
      }
    });
  }
  console.log(`Backfilled ${backfill.entries.length} variant stock balances, linked ${unlinkedCostLayers.length} cost layers, and created opening ledger entries.`);
};

run()
  .catch((error) => {
    console.error("Inventory ledger backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
