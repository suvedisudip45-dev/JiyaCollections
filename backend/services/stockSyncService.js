import { prisma } from "../config/db.js";

const normalizeVariantKey = (size, color) =>
  JSON.stringify([
    String(size || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
    String(color || "Standard").trim().replace(/\s+/g, " ").toLowerCase(),
  ]);

export const aggregateDistributorStock = (balances) => {
  const variantAvailableMap = new Map();
  for (const balance of balances) {
    const size = balance.inventorySku.sizeKey || balance.inventorySku.size || "Standard";
    const color = balance.inventorySku.colorKey || balance.inventorySku.color || "Standard";
    const key = normalizeVariantKey(size, color);
    const available = Math.max(0, balance.quantityOnHand - balance.reservedQuantity);
    variantAvailableMap.set(key, (variantAvailableMap.get(key) || 0) + available);
  }
  return {
    variantAvailableMap,
    stockQuantity: [...variantAvailableMap.values()].reduce((total, quantity) => total + quantity, 0),
  };
};

/**
 * Storefront stock is the aggregate unreserved stock at active distributor hubs.
 * Factory stock remains unavailable until it is received at a distributor.
 */
export const syncProductStock = async (productId, { client = prisma, throwOnError = false } = {}) => {
  if (!productId) return null;

  try {
    const product = await client.product.findUnique({
      where: { id: productId },
    });

    if (!product) return null;

    const balances = await client.inventoryBalance.findMany({
      where: {
        location: {
          kind: "DISTRIBUTOR",
          inventoryOwner: "PLATFORM",
          isActive: true,
          distributor: { status: "ACTIVE", isActive: true },
        },
        inventorySku: { productId, isActive: true },
      },
      select: {
        quantityOnHand: true,
        reservedQuantity: true,
        inventorySku: { select: { size: true, color: true, sizeKey: true, colorKey: true } },
      },
    });
    const { variantAvailableMap, stockQuantity } = aggregateDistributorStock(balances);
    if (stockQuantity > 2147483647) {
      throw new Error("Distributor stock exceeds the supported product quantity limit.");
    }

    // Update product.variants array
    let productVariants = Array.isArray(product.variants) ? product.variants : [];

    if (Array.isArray(productVariants) && productVariants.length > 0) {
      productVariants = productVariants.map((pv) => {
        const key = normalizeVariantKey(pv.size, pv.color);
        const avail = variantAvailableMap.get(key) || 0;
        return {
          ...pv,
          quantity: avail,
        };
      });
    }

    // Persist updated product stock & variants
    const updatedProduct = await client.product.update({
      where: { id: productId },
      data: {
        stockQuantity,
        variants: productVariants,
      },
    });

    return updatedProduct;
  } catch (err) {
    console.error(`syncProductStock error for ${productId}:`, err);
    if (throwOnError) throw err;
    return null;
  }
};

/**
 * Sync stock for all products in DB
 */
export const syncAllProductsStock = async () => {
  const products = await prisma.product.findMany({ select: { id: true } });
  await Promise.all(products.map((product) =>
    syncProductStock(product.id, { throwOnError: true })
  ));
};
