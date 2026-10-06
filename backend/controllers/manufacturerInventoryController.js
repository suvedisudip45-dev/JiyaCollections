import { prisma } from "../config/db.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { recordSystemAudit } from "../services/auditService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  buildManufacturerStockMovements,
  normalizeStockAdjustmentReason,
} from "../services/manufacturerInventoryAudit.js";

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
    const pagination = getPagination(req.query);

    // 1. Get all published products (with admin-defined sizes, colors, variants)
    const productWhere = { published: true };
    const [allProducts, total] = await prisma.$transaction([
      prisma.product.findMany({
        where: productWhere,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.limit,
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
      }),
      prisma.product.count({ where: productWhere }),
    ]);

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

    res.json(paginatedResponse("inventory", merged, pagination, total));
  } catch (error) {
    console.error("getMyInventory error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── MANUFACTURER: UPDATE VARIANT STOCK & PROPOSE SUPPLY PRICE ───────────────
const updateStock = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;
    const {
      productId,
      variantsStock,
      proposedCostPrice,
      priceNote,
      stockAdjustmentReason,
      stockAdjustmentNote,
    } = req.body;

    if (!manufacturerId) {
      return res.status(403).json({ success: false, message: "Manufacturer context is required." });
    }
    if (!productId) {
      return res.status(400).json({ success: false, message: "productId is required" });
    }
    if (!Array.isArray(variantsStock)) {
      return res.status(400).json({ success: false, message: "Variant stock quantities are required." });
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
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.manufacturerInventory.findUnique({
        where: { manufacturerId_productId: { manufacturerId, productId } },
      });
      const existingVariantsStock = existing ? parseJSON(existing.variantsStock, []) : [];
      const submittedVariantKeys = new Set();
      const cleanVariantsStock = variantsStock.map((v) => {
        if (!v || typeof v !== "object") {
          throw new Error("Each variant stock entry must be an object.");
        }
        const size = String(v.size || "Standard").trim();
        const color = String(v.color || "Standard").trim();
        if (!size || !color) throw new Error("Variant size and color are required.");
        const variantKey = JSON.stringify([size, color]);
        if (submittedVariantKeys.has(variantKey)) {
          throw new Error(`Duplicate stock entry for ${size} / ${color}.`);
        }
        submittedVariantKeys.add(variantKey);
        const matchingExisting = existingVariantsStock.find(
          (ev) => String(ev.size || "Standard").trim() === size
            && String(ev.color || "Standard").trim() === color
        );
        const reservedQty = matchingExisting ? Number(matchingExisting.reservedQty || 0) : 0;
        const inputQty = Number(v.quantity);
        if (!Number.isInteger(inputQty) || inputQty < 0 || inputQty > 2147483647) {
          throw new Error(`Quantity for ${size} / ${color} must be a whole number between 0 and 2147483647.`);
        }
        if (inputQty < reservedQty) {
          throw new Error(`Quantity for ${size} / ${color} cannot be lower than its ${reservedQty} reserved unit(s).`);
        }
        return {
          size,
          color,
          quantity: inputQty,
          reservedQty,
        };
      });

      const omittedReservedVariant = existingVariantsStock.find((variant) => (
        !submittedVariantKeys.has(JSON.stringify([
          String(variant.size || "Standard").trim(),
          String(variant.color || "Standard").trim(),
        ]))
        && Number(variant.reservedQty || 0) > 0
      ));
      if (omittedReservedVariant) {
        throw new Error("A variant with reserved stock cannot be removed from the stock update.");
      }

      const totalPhysicalQuantity = cleanVariantsStock.reduce((sum, variant) => sum + variant.quantity, 0);
      const totalReservedQty = cleanVariantsStock.reduce((sum, variant) => sum + variant.reservedQty, 0);
      const movements = buildManufacturerStockMovements({
        previousVariants: existingVariantsStock,
        nextVariants: cleanVariantsStock,
        productId,
        productName: product.name,
        manufacturerId,
        actorId: req.auth?.profileId || req.auth?.accountId || null,
      });
      if (movements.length) {
        const adjustment = normalizeStockAdjustmentReason(stockAdjustmentReason, stockAdjustmentNote);
        movements.forEach((movement) => {
          movement.reason = adjustment.reason;
          movement.note = adjustment.note;
        });
      }

      const updateData = {
        productName: product.name,
        quantity: totalPhysicalQuantity,
        reservedQty: totalReservedQty,
        variantsStock: cleanVariantsStock,
      };

      if (proposedCostPrice !== undefined && proposedCostPrice !== null && proposedCostPrice !== "") {
        const numPrice = parseFloat(proposedCostPrice);
        if (!isNaN(numPrice) && numPrice > 0) {
          if (numPrice !== existing?.agreedCostPrice) {
            updateData.proposedCostPrice = numPrice;
            updateData.priceStatus = "PENDING";
            if (priceNote !== undefined) updateData.priceNote = priceNote;
          }
        }
      }

      const inventory = await tx.manufacturerInventory.upsert({
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
      if (movements.length) {
        await tx.manufacturerInventoryMovement.createMany({ data: movements });
      }
      await recordSystemAudit({
        actorId: req.auth?.accountId,
        actorRole: req.auth?.role || "MANUFACTURER",
        portalSource: req.auth?.role || "MANUFACTURER",
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        correlationId: req.correlationId || null,
      }, {
        action: "MANUFACTURER_INVENTORY_UPDATED",
        entityType: "ManufacturerInventory",
        entityId: inventory.id,
        beforeState: {
          quantity: existing?.quantity || 0,
          reservedQty: existing?.reservedQty || 0,
          variantsStock: existingVariantsStock,
          agreedCostPrice: existing?.agreedCostPrice ?? null,
          proposedCostPrice: existing?.proposedCostPrice ?? null,
        },
        afterState: {
          quantity: inventory.quantity,
          reservedQty: inventory.reservedQty,
          variantsStock: cleanVariantsStock,
          agreedCostPrice: inventory.agreedCostPrice ?? null,
          proposedCostPrice: inventory.proposedCostPrice ?? null,
        },
      }, { client: tx });
      return { inventory, movementCount: movements.length };
    }, { isolationLevel: "Serializable" });

    // Sync aggregate product stock & variant quantities across all manufacturer hubs
    await syncProductStock(productId);

    return res.json({
      success: true,
      message: "Hub stock and price proposal saved successfully!",
      inventory: result.inventory,
      movementCount: result.movementCount,
    });
  } catch (error) {
    console.error("updateStock error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

const getMyInventoryMovements = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;
    const { productId } = req.params;
    if (!manufacturerId) {
      return res.status(403).json({ success: false, message: "Manufacturer context is required." });
    }
    const inventory = await prisma.manufacturerInventory.findUnique({
      where: { manufacturerId_productId: { manufacturerId, productId } },
      select: { id: true },
    });
    if (!inventory) {
      return res.json(paginatedResponse("movements", [], getPagination(req.query), 0));
    }

    const pagination = getPagination(req.query);
    const where = { manufacturerId, productId };
    const [movements, total] = await prisma.$transaction([
      prisma.manufacturerInventoryMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.manufacturerInventoryMovement.count({ where }),
    ]);
    return res.json(paginatedResponse("movements", movements, pagination, total));
  } catch (error) {
    console.error("getMyInventoryMovements error:", error);
    return res.status(500).json({ success: false, message: "Unable to load stock movement history." });
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
    const pagination = getPagination(req.query);
    const [allInventory, total] = await prisma.$transaction([
      prisma.manufacturerInventory.findMany({
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
      skip: pagination.skip,
      take: pagination.limit,
      }),
      prisma.manufacturerInventory.count(),
    ]);

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

    res.json(paginatedResponse("inventory", enriched, pagination, total));
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
  getMyInventoryMovements,
  updateStock,
  getAllInventory,
  getLowStockAlerts,
  buildAdminInventoryItem,
};
