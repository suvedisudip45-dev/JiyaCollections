import { prisma } from "../config/db.js";

const parseJSON = (val, fallback = []) => {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
};

/**
 * Recalculate total available stockQuantity and variant-level quantities across
 * all manufacturer hubs for a given product, and sync the aggregate numbers
 * to the main Product record in DB.
 */
export const syncProductStock = async (productId, { client = prisma, throwOnError = false } = {}) => {
  if (!productId) return null;

  try {
    const product = await client.product.findUnique({
      where: { id: productId },
    });

    if (!product) return null;

    // Fetch all manufacturer inventories for this product
    const allHubs = await client.manufacturerInventory.findMany({
      where: { productId },
    });

    const variantAvailableMap = {};
    let fallbackTotalAvailable = 0;

    for (const hub of allHubs) {
      const hubVariants = parseJSON(hub.variantsStock, []);
      if (Array.isArray(hubVariants) && hubVariants.length > 0) {
        for (const v of hubVariants) {
          const sizeKey = v.size || "Standard";
          const colorKey = v.color || "Standard";
          const key = `${sizeKey}-${colorKey}`;

          const physical = Math.max(0, Number(v.quantity || 0));
          const reserved = Math.max(0, Number(v.reservedQty || 0));
          const available = Math.max(0, physical - reserved);

          variantAvailableMap[key] = (variantAvailableMap[key] || 0) + available;
        }
      } else {
        const physical = Math.max(0, Number(hub.quantity || 0));
        const reserved = Math.max(0, Number(hub.reservedQty || 0));
        const available = Math.max(0, physical - reserved);
        fallbackTotalAvailable += available;
      }
    }

    const mapValues = Object.values(variantAvailableMap);
    let grandTotalAvailable = fallbackTotalAvailable;
    if (mapValues.length > 0) {
      grandTotalAvailable = mapValues.reduce((sum, qty) => sum + qty, 0);
    }

    // Update product.variants array
    let productVariants = parseJSON(product.variants, []);

    if (Array.isArray(productVariants) && productVariants.length > 0) {
      productVariants = productVariants.map((pv) => {
        const sizeKey = pv.size || "Standard";
        const colorKey = pv.color || "Standard";
        const key = `${sizeKey}-${colorKey}`;
        const avail = variantAvailableMap[key] || 0;
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
        stockQuantity: grandTotalAvailable,
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
  try {
    const products = await prisma.product.findMany({ select: { id: true } });
    await Promise.all(products.map((p) => syncProductStock(p.id)));
  } catch (err) {
    console.error("syncAllProductsStock error:", err);
  }
};
