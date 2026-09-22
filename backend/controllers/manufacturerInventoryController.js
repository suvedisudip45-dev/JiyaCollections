import { prisma } from "../config/db.js";
import { syncProductStock } from "../services/stockSyncService.js";

// Helper to safely parse JSON
const parseJSON = (val, fallback = []) => {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

// ─── MANUFACTURER: GET MY INVENTORY & PRODUCT VARIANTS ───────────────────────
const getMyInventory = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;

    // 1. Get all published products (with admin-defined sizes, colors, variants)
    const allProducts = await prisma.product.findMany({
      where: { published: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        image: true,
        price: true,
        category: true,
        subCategory: true,
        sizes: true,
        colors: true,
        variants: true,
        stockQuantity: true,
      },
    });

    // 2. Get manufacturer's inventory entries
    const myInventory = await prisma.manufacturerInventory.findMany({
      where: { manufacturerId },
    });

    const inventoryMap = {};
    for (const inv of myInventory) {
      inventoryMap[inv.productId] = inv;
    }

    // 3. Build merged list with admin-locked variants
    const merged = allProducts.map((p) => {
      const inv = inventoryMap[p.id];
      const adminSizes = parseJSON(p.sizes, []);
      const adminColors = parseJSON(p.colors, []);
      const adminVariants = parseJSON(p.variants, []);

      // If manufacturer already has variantsStock saved, use it; otherwise build from admin variants/sizes/colors
      const savedVariantsStock = inv ? parseJSON(inv.variantsStock, []) : [];

      // Build consolidated list of variants based STRICTLY on admin's defined sizes/colors
      const variantsTable = [];

      if (adminVariants.length > 0) {
        adminVariants.forEach((av) => {
          const size = av.size || "Standard";
          const color = av.color || "Standard";
          const match = savedVariantsStock.find(
            (sv) => sv.size === size && sv.color === color
          );
          variantsTable.push({
            size,
            color,
            quantity: match ? Number(match.quantity || 0) : 0,
            reservedQty: match ? Number(match.reservedQty || 0) : 0,
            availableQty: match ? Math.max(0, (match.quantity || 0) - (match.reservedQty || 0)) : 0,
          });
        });
      } else if (adminSizes.length > 0) {
        adminSizes.forEach((size) => {
          if (adminColors.length > 0) {
            adminColors.forEach((color) => {
              const colorName = typeof color === "object" ? color.name : color;
              const match = savedVariantsStock.find(
                (sv) => sv.size === size && sv.color === colorName
              );
              variantsTable.push({
                size,
                color: colorName,
                quantity: match ? Number(match.quantity || 0) : 0,
                reservedQty: match ? Number(match.reservedQty || 0) : 0,
                availableQty: match ? Math.max(0, (match.quantity || 0) - (match.reservedQty || 0)) : 0,
              });
            });
          } else {
            const match = savedVariantsStock.find((sv) => sv.size === size);
            variantsTable.push({
              size,
              color: "Standard",
              quantity: match ? Number(match.quantity || 0) : 0,
              reservedQty: match ? Number(match.reservedQty || 0) : 0,
              availableQty: match ? Math.max(0, (match.quantity || 0) - (match.reservedQty || 0)) : 0,
            });
          }
        });
      } else {
        // Single default item
        const match = savedVariantsStock[0];
        variantsTable.push({
          size: "Standard",
          color: "Standard",
          quantity: match ? Number(match.quantity || 0) : (inv ? inv.quantity : 0),
          reservedQty: match ? Number(match.reservedQty || 0) : (inv ? inv.reservedQty : 0),
          availableQty: match
            ? Math.max(0, (match.quantity || 0) - (match.reservedQty || 0))
            : (inv ? Math.max(0, inv.quantity - inv.reservedQty) : 0),
        });
      }

      const totalPhysicalQty = variantsTable.reduce((sum, v) => sum + v.quantity, 0);
      const totalReservedQty = variantsTable.reduce((sum, v) => sum + v.reservedQty, 0);
      const totalAvailableQty = Math.max(0, totalPhysicalQty - totalReservedQty);

      return {
        id: inv ? inv.id : `temp-${p.id}`,
        productId: p.id,
        productName: p.name,
        product: {
          id: p.id,
          name: p.name,
          image: p.image,
          price: Number(p.price) || 0,
          category: p.category,
          adminSizes,
          adminColors,
        },
        image: p.image,
        inventoryId: inv ? inv.id : null,
        quantity: totalPhysicalQty,
        reservedQty: totalReservedQty,
        availableQty: totalAvailableQty,
        variantsStock: variantsTable,
        proposedCostPrice: inv ? inv.proposedCostPrice : null,
        agreedCostPrice: inv ? inv.agreedCostPrice : null,
        priceStatus: inv ? (inv.priceStatus || "PENDING") : "PENDING",
        priceNote: inv ? inv.priceNote : null,
        adminFeedback: inv ? inv.adminFeedback : null,
        lowStockThreshold: 5,
        stockStatus: totalAvailableQty === 0 ? "OUT_OF_STOCK" : totalAvailableQty <= 5 ? "LOW_STOCK" : "AVAILABLE",
        lastUpdated: inv ? inv.lastUpdated : null,
      };
    });

    res.json({ success: true, inventory: merged });
  } catch (error) {
    console.error("getMyInventory error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── MANUFACTURER: UPDATE VARIANT STOCK & PROPOSE SUPPLY PRICE ───────────────
const updateStock = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const {
      productId,
      variantsStock,
      proposedCostPrice,
      priceNote,
      lowStockThreshold,
    } = req.body;

    if (!productId) {
      return res.json({ success: false, message: "productId is required" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        published: true,
        price: true,
        sizes: true,
        colors: true,
        variants: true,
      },
    });
    if (!product) return res.json({ success: false, message: "Product not found" });

    // Existing inventory
    const existing = await prisma.manufacturerInventory.findUnique({
      where: { manufacturerId_productId: { manufacturerId, productId } },
    });

    const existingVariantsStock = existing ? parseJSON(existing.variantsStock, []) : [];

    // Normalize variantsStock input
    let cleanVariantsStock = [];
    if (Array.isArray(variantsStock)) {
      cleanVariantsStock = variantsStock.map((v) => {
        const matchingExisting = existingVariantsStock.find(
          (ev) => ev.size === v.size && ev.color === v.color
        );
        const reservedQty = matchingExisting ? Number(matchingExisting.reservedQty || 0) : 0;
        const inputQty = Math.max(0, Number(v.quantity || 0));
        // Physical quantity cannot be less than already reserved quantity
        const safeQty = Math.max(inputQty, reservedQty);

        return {
          size: v.size || "Standard",
          color: v.color || "Standard",
          quantity: safeQty,
          reservedQty,
        };
      });
    }

    const totalPhysicalQuantity = cleanVariantsStock.reduce((sum, v) => sum + v.quantity, 0);
    const totalReservedQty = cleanVariantsStock.reduce((sum, v) => sum + v.reservedQty, 0);

    // Handle Proposed Price
    const updateData = {
      productName: product.name,
      quantity: totalPhysicalQuantity,
      reservedQty: totalReservedQty,
      variantsStock: cleanVariantsStock,
    };

    if (proposedCostPrice !== undefined && proposedCostPrice !== null && proposedCostPrice !== "") {
      const numPrice = parseFloat(proposedCostPrice);
      if (!isNaN(numPrice) && numPrice > 0) {
        // If proposed price is different from currently agreed, put into PENDING status
        if (numPrice !== existing?.agreedCostPrice) {
          updateData.proposedCostPrice = numPrice;
          updateData.priceStatus = "PENDING";
          if (priceNote !== undefined) updateData.priceNote = priceNote;
        }
      }
    }

    const inv = await prisma.manufacturerInventory.upsert({
      where: { manufacturerId_productId: { manufacturerId, productId } },
      create: {
        manufacturerId,
        productId,
        productName: product.name,
        quantity: totalPhysicalQuantity,
        reservedQty: totalReservedQty,
        variantsStock: cleanVariantsStock,
        proposedCostPrice: updateData.proposedCostPrice || null,
        agreedCostPrice: null,
        priceStatus: "PENDING",
        priceNote: priceNote || null,
      },
      update: updateData,
    });

    // Sync aggregate product stock & variant quantities across all manufacturer hubs
    await syncProductStock(productId);

    res.json({
      success: true,
      message: "Hub stock and price proposal saved successfully!",
      inventory: inv,
    });
  } catch (error) {
    console.error("updateStock error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: GET ALL INVENTORY (Multi-Hub Monitor) ─────────────────────────────
const buildAdminInventoryItem = (inventory, product) => ({
  id: inventory.id,
  productId: inventory.productId,
  productName: inventory.productName,
  quantity: inventory.quantity,
  reservedQty: inventory.reservedQty,
  manufacturer: {
    id: inventory.manufacturer.id,
    name: inventory.manufacturer.name,
    city: inventory.manufacturer.city,
    businessName: inventory.manufacturer.name,
  },
  product: product || {
    id: inventory.productId,
    name: inventory.productName,
  },
  availableQty: Math.max(0, inventory.quantity - inventory.reservedQty),
  lowStockThreshold: 5,
});

const getAllInventory = async (req, res) => {
  try {
    const allInventory = await prisma.manufacturerInventory.findMany({
      select: {
        id: true,
        productId: true,
        productName: true,
        quantity: true,
        reservedQty: true,
        manufacturer: {
          select: { id: true, name: true, city: true },
        },
      },
      orderBy: { productName: "asc" },
    });

    const productIds = [...new Set(allInventory.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, image: true, price: true, category: true },
    });
    const productMap = {};
    products.forEach((p) => {
      productMap[p.id] = p;
    });

    const enriched = allInventory.map((inv) => buildAdminInventoryItem(inv, productMap[inv.productId]));

    res.json({ success: true, inventory: enriched });
  } catch (error) {
    console.error("getAllInventory error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: GET LOW STOCK ALERTS ─────────────────────────────────────────────
const getLowStockAlerts = async (req, res) => {
  try {
    const allInventory = await prisma.manufacturerInventory.findMany({
      include: {
        manufacturer: { select: { id: true, name: true, city: true } },
      },
    });

    const alerts = allInventory
      .filter((inv) => inv.quantity - inv.reservedQty <= 5)
      .map((inv) => ({
        ...inv,
        manufacturer: {
          ...inv.manufacturer,
          businessName: inv.manufacturer.name,
        },
        availableQty: Math.max(0, inv.quantity - inv.reservedQty),
      }));

    res.json({ success: true, alerts });
  } catch (error) {
    console.error("getLowStockAlerts error:", error);
    res.json({ success: false, message: error.message });
  }
};

export {
  getMyInventory,
  updateStock,
  getAllInventory,
  getLowStockAlerts,
  buildAdminInventoryItem,
};
