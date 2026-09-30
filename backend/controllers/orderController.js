import { prisma } from "../config/db.js";
import { randomUUID } from "node:crypto";
import { calculateUserLoyalty } from "./loyaltyController.js";
import {
  postSalesOrderAccounting,
  postCustomerPaymentAccounting,
} from "../services/accountingPostingEngine.js";
import { runAllocationEngine } from "./orderAssignmentController.js";
import { resolveDistrictShippingFee } from "./shippingController.js";
import { createInactiveSocialCustomerProfile } from "./userController.js";
import { isValidMobileNumber } from "../utils/socialCustomerProfile.js";
import {
  findAdminOrderCustomer,
  getAdminOrderCustomerForCreation,
} from "../services/adminOrderCustomerService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { productBelongsToCategory } from "../services/productCategoryRules.js";
import {
  allocateComboBundleComponentPrices,
  calculateComboBundlePrice,
  getSharedComboBundleVariants,
} from "../services/comboBundleRules.js";

// global variables
const deliveryCharge = 50;

const buildOrderListItem = (order) => {
  const parsedReward = (() => {
    if (!order?.rewardApplied) return null;
    if (typeof order.rewardApplied === "string") {
      try {
        return JSON.parse(order.rewardApplied);
      } catch {
        return null;
      }
    }
    return order.rewardApplied;
  })();

  const specialOrderManufacturerIds = (() => {
    if (!order?.specialOrderManufacturerIds) return [];
    if (Array.isArray(order.specialOrderManufacturerIds)) return order.specialOrderManufacturerIds;
    if (typeof order.specialOrderManufacturerIds === "string") {
      try {
        return JSON.parse(order.specialOrderManufacturerIds);
      } catch {
        return [];
      }
    }
    return [];
  })();

  const parsedItems = (() => {
    if (Array.isArray(order?.items)) return order.items;
    if (typeof order?.items === "string") {
      try {
        return JSON.parse(order.items);
      } catch {
        return [];
      }
    }
    return [];
  })();

  const address = (() => {
    if (!order?.address) return {};
    if (typeof order.address === "string") {
      try {
        return JSON.parse(order.address);
      } catch {
        return {};
      }
    }
    return order.address;
  })();

  return {
    id: order.id,
    _id: order.id,
    userId: order.userId,
    items: parsedItems,
    amount: Number(order.amount || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    address,
    status: order.status,
    paymentMethod: order.paymentMethod,
    payment: Boolean(order.payment),
    date: Number(order.date || 0),
    loyaltyDiscount: Number(order.loyaltyDiscount || 0),
    rewardApplied: parsedReward,
    fulfillmentStatus: order.fulfillmentStatus,
    assignmentId: order.assignmentId,
    deliveryJobId: order.deliveryJobId,
    orderType: order.orderType,
    directOrderType: order.directOrderType,
    manufacturerId: order.manufacturerId,
    specialOrder: Boolean(order.specialOrder),
    specialOrderReason: order.specialOrderReason || null,
    specialOrderManufacturerIds,
    directNotes: order.directNotes,
    delivery: order.deliveryOrder || null,
    deliveryOrder: order.deliveryOrder || null,
    totalItems: Array.isArray(parsedItems) ? parsedItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0) : 0,
  };
};

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const getAvailableInventoryForItem = (inventoryEntry, item) => {
  if (!inventoryEntry) return 0;

  const variantsStock = parseJsonArray(inventoryEntry.variantsStock, []);
  if (variantsStock.length > 0) {
    const targetSize = (item?.size || "").trim().toLowerCase();
    const targetColor = (item?.color || "").trim().toLowerCase();

    let matchedVariant = null;
    if (targetSize && targetColor) {
      matchedVariant = variantsStock.find(
        (v) =>
          (v.size || "").trim().toLowerCase() === targetSize &&
          (v.color || "").trim().toLowerCase() === targetColor
      );
    } else if (targetSize) {
      matchedVariant = variantsStock.find(
        (v) => (v.size || "").trim().toLowerCase() === targetSize
      );
    } else if (targetColor) {
      matchedVariant = variantsStock.find(
        (v) => (v.color || "").trim().toLowerCase() === targetColor
      );
    }

    if (matchedVariant) {
      return Math.max(0, Number(matchedVariant.quantity || 0) - Number(matchedVariant.reservedQty || 0));
    }

    return variantsStock.reduce(
      (sum, v) => sum + Math.max(0, Number(v.quantity || 0) - Number(v.reservedQty || 0)),
      0
    );
  }

  return Math.max(0, Number(inventoryEntry.quantity || 0) - Number(inventoryEntry.reservedQty || 0));
};

export const resolveOrderManufacturingPlan = (items = [], inventoryRecords = []) => {
  const productInventoryMap = new Map();
  for (const inventoryEntry of inventoryRecords) {
    if (!inventoryEntry?.productId) continue;
    const list = productInventoryMap.get(inventoryEntry.productId) || [];
    list.push(inventoryEntry);
    productInventoryMap.set(inventoryEntry.productId, list);
  }

  const itemAssignments = items.map((item) => {
    const productId = item?._id || item?.id || item?.productId;
    const candidates = (productInventoryMap.get(productId) || []).filter(
      (entry) => getAvailableInventoryForItem(entry, item) > 0
    );
    const candidateManufacturerIds = [...new Set(candidates.map((entry) => entry.manufacturerId).filter(Boolean))];
    const primaryCandidateId = candidateManufacturerIds[0] || null;

    return {
      productId,
      candidateManufacturerIds,
      primaryCandidateId,
      isSpecialOrder: candidateManufacturerIds.length === 0 || candidateManufacturerIds.length > 1,
    };
  });

  const allCandidateManufacturerIds = [...new Set(itemAssignments.flatMap((item) => item.candidateManufacturerIds))];
  const primaryManufacturerId =
    allCandidateManufacturerIds.length === 1
      ? allCandidateManufacturerIds[0]
      : (itemAssignments.find((item) => item.primaryCandidateId)?.primaryCandidateId) || allCandidateManufacturerIds[0] || null;

  const specialOrder = itemAssignments.some((item) => item.isSpecialOrder) || allCandidateManufacturerIds.length > 1;
  const specialOrderReason = specialOrder
    ? "Special order: this cart contains products sourced from multiple manufacturer hubs and needs a fallback assignment."
    : null;

  return {
    specialOrder,
    primaryManufacturerId,
    specialOrderManufacturerIds: allCandidateManufacturerIds,
    specialOrderReason,
    itemAssignments,
  };
};

// Helper to validate stock before order placement
const validateOrderStock = (items, dbProducts) => {
  for (const cartItem of items) {
    const pId = cartItem._id || cartItem.id || cartItem.productId;
    const matchedProduct = dbProducts.find((p) => p.id === pId);
    if (!matchedProduct) {
      return { valid: false, message: `Product not found: ${cartItem.name || pId}` };
    }

    const orderedQty = Math.max(1, Number(cartItem.quantity || 1));
    let parsedVariants = typeof matchedProduct.variants === "string"
      ? JSON.parse(matchedProduct.variants || "[]")
      : (matchedProduct.variants || []);
    if (!Array.isArray(parsedVariants)) parsedVariants = [];

    const itemSize = (cartItem.size || "").trim().toLowerCase();
    const itemColor = (cartItem.color || "").trim().toLowerCase();

    if (parsedVariants.length > 0) {
      let matchedVariant = null;
      if (itemSize && itemColor) {
        matchedVariant = parsedVariants.find(
          (v) => (v.size || "").trim().toLowerCase() === itemSize &&
                 (v.color || "").trim().toLowerCase() === itemColor
        );
      } else if (itemSize) {
        matchedVariant = parsedVariants.find(
          (v) => (v.size || "").trim().toLowerCase() === itemSize
        );
      } else if (itemColor) {
        matchedVariant = parsedVariants.find(
          (v) => (v.color || "").trim().toLowerCase() === itemColor
        );
      }

      if (matchedVariant) {
        const varQty = Number(matchedVariant.quantity ?? 0);
        if (varQty <= 0) {
          return {
            valid: false,
            message: `Product "${matchedProduct.name}" (${cartItem.size || ""}${cartItem.color ? ` / ${cartItem.color}` : ""}) is out of stock.`,
          };
        }
        if (orderedQty > varQty) {
          return {
            valid: false,
            message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" (${cartItem.size || ""}${cartItem.color ? ` / ${cartItem.color}` : ""}) exceeds available stock (${varQty}).`,
          };
        }
      } else {
        const totalVarStock = parsedVariants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
        if (totalVarStock <= 0) {
          return {
            valid: false,
            message: `Product "${matchedProduct.name}" is completely out of stock.`,
          };
        }
        if (orderedQty > totalVarStock) {
          return {
            valid: false,
            message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" exceeds available stock (${totalVarStock}).`,
          };
        }
      }
    } else {
      const stock = Number(matchedProduct.stockQuantity ?? 0);
      if (stock <= 0) {
        return {
          valid: false,
          message: `Product "${matchedProduct.name}" is out of stock.`,
        };
      }
      if (orderedQty > stock) {
        return {
          valid: false,
          message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" exceeds available stock (${stock}).`,
        };
      }
    }
  }
  return { valid: true };
};

// Placing orders using COD Method with Immutable Price Snapshot
const placeOrder = async (req, res) => {
  try {
    const { userId, address, comboBundle } = req.body;
    let items = Array.isArray(req.body.items) ? req.body.items : [];
    let comboBundleRecord = null;

    if (comboBundle?.comboBundleId) {
      comboBundleRecord = await prisma.comboBundle.findUnique({
        where: { id: String(comboBundle.comboBundleId) },
        include: {
          category: true,
          products: {
            include: { product: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      if (!comboBundleRecord || comboBundleRecord.status !== "ACTIVE") {
        return res.status(400).json({ success: false, message: "This combo bundle is no longer available." });
      }

      const initialMemberProducts = comboBundleRecord.products.map((entry) => entry.product).filter(Boolean);
      await Promise.all(initialMemberProducts.map((product) => syncProductStock(product.id)));
      const currentProducts = await prisma.product.findMany({
        where: { id: { in: initialMemberProducts.map((product) => product.id) } },
      });
      const currentProductsById = new Map(currentProducts.map((product) => [product.id, product]));
      comboBundleRecord.products = comboBundleRecord.products.map((entry) => ({
        ...entry,
        product: currentProductsById.get(entry.productId) || null,
      }));
      const memberProducts = comboBundleRecord.products.map((entry) => entry.product ? {
        ...entry.product,
        comboBundleColor: entry.selectedColor || "",
      } : null).filter(Boolean);
      if (memberProducts.length !== comboBundleRecord.products.length || memberProducts.some((product) => !product.published)) {
        return res.status(400).json({ success: false, message: "Every product in this combo bundle must be published before checkout." });
      }
      if (memberProducts.some((product) => !productBelongsToCategory(product, comboBundleRecord.category.name))) {
        return res.status(400).json({ success: false, message: "This combo bundle contains a product outside its assigned category." });
      }

      const bundleQuantity = Math.max(1, Math.floor(Number(comboBundle.quantity) || 1));
      const sharedVariants = getSharedComboBundleVariants(memberProducts, bundleQuantity);
      const selectedVariant = sharedVariants.find(
        (variant) => variant.size.toLowerCase() === String(comboBundle.size || "").trim().toLowerCase()
      );
      if (!selectedVariant) {
        return res.status(400).json({ success: false, message: "The selected size is not available for every product in this combo bundle." });
      }

      items = memberProducts.map((product, index) => ({
        _id: product.id,
        productId: product.id,
        size: selectedVariant.size,
        color: selectedVariant.productVariants[index].color,
        quantity: bundleQuantity,
      }));
      comboBundle.quantity = bundleQuantity;
      comboBundle.size = selectedVariant.size;
    }

    if (!items || items.length === 0) {
      return res.json({ success: false, message: "No items in order" });
    }

    // Extract product IDs and query current DB records to freeze price snapshots
    const productIds = items.map((i) => i._id || i.id || i.productId).filter(Boolean);
    const [dbProducts, manufacturerInventory] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds } },
      }),
      prisma.manufacturerInventory.findMany({
        where: { productId: { in: productIds } },
      }),
    ]);

    // Validate stock before proceeding
    const stockValidation = validateOrderStock(items, dbProducts);
    if (!stockValidation.valid) {
      return res.json({ success: false, message: stockValidation.message });
    }

    let frozenItemsSnapshot = items.map((cartItem) => {
      const pId = cartItem._id || cartItem.id;
      const matchedProduct = dbProducts.find((p) => p.id === pId);

      const originalUnitPrice = matchedProduct ? matchedProduct.price : Number(cartItem.price || 0);
      const discountPercentage = matchedProduct ? (matchedProduct.discount || 0) : Number(cartItem.discount || 0);

      const purchasedUnitPrice = discountPercentage > 0
        ? Math.round(originalUnitPrice * (1 - discountPercentage / 100))
        : originalUnitPrice;

      const qty = Number(cartItem.quantity || 1);

      return {
        ...cartItem,
        _id: pId,
        productId: pId,
        name: matchedProduct ? matchedProduct.name : (cartItem.name || "Product"),
        image: matchedProduct ? matchedProduct.image : (cartItem.image || []),
        category: matchedProduct ? matchedProduct.category : (cartItem.category || ""),
        subCategory: matchedProduct ? matchedProduct.subCategory : (cartItem.subCategory || ""),
        size: cartItem.size,
        quantity: qty,
        originalUnitPrice: originalUnitPrice,
        discountPercentage: discountPercentage,
        offerTag: matchedProduct?.offerTag || cartItem.offerTag || "",
        offerTitle: matchedProduct?.offerTitle || cartItem.offerTitle || "",
        purchasedUnitPrice: purchasedUnitPrice, // Price snapshot frozen at purchase time
        price: purchasedUnitPrice, // Standardized unit price snapshot
        lineTotal: purchasedUnitPrice * qty,
      };
    });

    if (comboBundleRecord) {
      const bundlePrice = calculateComboBundlePrice({
        products: dbProducts,
        discountPercentage: comboBundleRecord.discountPercentage,
        manualPriceOverride: comboBundleRecord.manualPriceOverride,
        sellingPrice: comboBundleRecord.sellingPrice,
      });
      const componentPrices = allocateComboBundleComponentPrices(frozenItemsSnapshot, bundlePrice.sellingPrice);
      frozenItemsSnapshot = frozenItemsSnapshot.map((item, index) => {
        const purchasedUnitPrice = componentPrices[index];
        return {
          ...item,
          comboBundleId: comboBundleRecord.id,
          comboBundleName: comboBundleRecord.name,
          comboBundleCategory: comboBundleRecord.category.name,
          comboBundleDescription: comboBundleRecord.description || "",
          comboBundleImage: comboBundleRecord.bannerImage || parseJsonArray(comboBundleRecord.image, [])[0] || "",
          comboBundleQuantity: comboBundle.quantity,
          comboBundleUnitPrice: bundlePrice.sellingPrice,
          comboBundleCalculatedPrice: bundlePrice.calculatedPrice,
          comboBundleDiscountPercentage: bundlePrice.discountPercentage,
          comboBundleManualPriceOverride: bundlePrice.manualPriceOverride,
          purchasedUnitPrice,
          price: purchasedUnitPrice,
          lineTotal: purchasedUnitPrice * Number(item.quantity || 1),
        };
      });
    }

    const itemsTotal = frozenItemsSnapshot.reduce((acc, item) => acc + item.lineTotal, 0);
    const manufacturingPlan = resolveOrderManufacturingPlan(frozenItemsSnapshot, manufacturerInventory);

    // Resolve dynamic shipping charge from ShippingConfig (authoritative backend calculation)
    let expectedFee = deliveryCharge;
    try {
      const customerDistrict = address?.district || address?.city || "";
      const customerProvince = address?.state || address?.province || "";
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: itemsTotal,
      });
      expectedFee = shippingResult.fee;
    } catch (cfgErr) {
      console.error("Error calculating district shipping fee in placeOrder:", cfgErr);
    }

    // Check user loyalty level and reward eligibility
    let loyaltyDiscount = 0;
    let rewardApplied = null;
    try {
      if (userId) {
        const loyaltyStatus = await calculateUserLoyalty(userId);
        if (loyaltyStatus?.activeReward?.isEligible) {
          const act = loyaltyStatus.activeReward;

          if (act.freeShipping) {
            expectedFee = 0;
          }

          if (act.discountAmount > 0) {
            loyaltyDiscount = Math.min(itemsTotal, Number(act.discountAmount));
          }

          rewardApplied = {
            freeShipping: Boolean(act.freeShipping),
            discountAmount: loyaltyDiscount,
            giftAmount: act.giftAmount || 0,
            giftDescription: act.giftDescription || "",
            letterIncluded: Boolean(act.letterIncluded),
            customPerk: act.customPerk || "",
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            title: act.title || "VIP Reward",
            usage: `Use ${act.currentUseIndex} of ${act.orderLimit}`,
          };
        }
      }
    } catch (loyErr) {
      console.error("Error applying loyalty reward:", loyErr);
    }

    // Price-lock: Backend authoritative fee is locked into order amount and deliveryFee
    const resolvedFee = expectedFee;
    const finalAmount = Math.max(0, itemsTotal + resolvedFee - loyaltyDiscount);

    const orderData = {
      userId,
      items: frozenItemsSnapshot,
      amount: finalAmount,
      deliveryFee: resolvedFee,
      paymentMethod: "COD",
      payment: false,
      date: BigInt(Date.now()),
      address,
      loyaltyDiscount,
      manufacturerId: manufacturingPlan.primaryManufacturerId || null,
      specialOrder: Boolean(manufacturingPlan.specialOrder),
      specialOrderReason: manufacturingPlan.specialOrderReason,
      specialOrderManufacturerIds: manufacturingPlan.specialOrderManufacturerIds,
      rewardApplied: rewardApplied ? JSON.stringify(rewardApplied) : "{}",
    };

    const createdOrder = await prisma.order.create({ data: orderData });

    // Update user cart and saved addresses
    try {
      const userRecord = await prisma.user.findUnique({ where: { id: userId } });
      if (userRecord) {
        let addresses = [];
        if (Array.isArray(userRecord.addresses)) addresses = userRecord.addresses;
        else if (typeof userRecord.addresses === "string") {
          try {
            addresses = JSON.parse(userRecord.addresses);
          } catch {
            addresses = [];
          }
        }

        const newAddr = {
          ...address,
          id: Date.now().toString(),
          createdAt: Date.now(),
        };

        const existingIdx = addresses.findIndex(
          (a) =>
            a.city === address.city &&
            a.street === address.street &&
            a.state === address.state
        );

        if (existingIdx !== -1) {
          addresses[existingIdx] = { ...addresses[existingIdx], ...newAddr };
        } else {
          addresses = [newAddr, ...addresses].slice(0, 5);
        }

        await prisma.user.update({
          where: { id: userId },
          data: { ...(!comboBundleRecord && { cartData: {} }), addresses },
        });
      }
    } catch (addrErr) {
      console.error("Error saving address to user profile:", addrErr);
      if (!comboBundleRecord) {
        await prisma.user.update({
          where: { id: userId },
          data: { cartData: {} },
        });
      }
    }

    // Aggregate all requested items by product ID and variant
    const productDeductions = {};
    for (const cartItem of frozenItemsSnapshot) {
      const pId = cartItem.productId || cartItem._id;
      const orderedQty = Number(cartItem.quantity || 1);
      if (!pId) continue;

      if (!productDeductions[pId]) {
        productDeductions[pId] = {
          totalQty: 0,
          variantDeductions: [],
        };
      }
      productDeductions[pId].totalQty += orderedQty;

      if (cartItem.size && cartItem.color) {
        productDeductions[pId].variantDeductions.push({
          size: cartItem.size,
          color: cartItem.color,
          quantity: orderedQty,
        });
      }
    }

    // Safely apply aggregated stock deduction per product in DB
    for (const [pId, deduction] of Object.entries(productDeductions)) {
      const currentProd = await prisma.product.findUnique({ where: { id: pId } });
      if (!currentProd) continue;

      let updateData = {};
      let parsedVariants = typeof currentProd.variants === "string"
        ? JSON.parse(currentProd.variants || "[]")
        : (currentProd.variants || []);

      const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;

      if (hasVariants && deduction.variantDeductions.length > 0) {
        for (const vd of deduction.variantDeductions) {
          const vIdx = parsedVariants.findIndex(
            (v) =>
              (v.size || "").trim().toLowerCase() === (vd.size || "").trim().toLowerCase() &&
              (v.color || "").trim().toLowerCase() === (vd.color || "").trim().toLowerCase()
          );
          if (vIdx !== -1) {
            const currentVariantQty = Number(parsedVariants[vIdx].quantity || 0);
            parsedVariants[vIdx].quantity = Math.max(0, currentVariantQty - vd.quantity);
          }
        }
        updateData.variants = parsedVariants;

        // Synchronize stockQuantity to the total remaining across all variants
        const totalVariantStock = parsedVariants.reduce(
          (acc, v) => acc + (Number(v.quantity) || 0),
          0
        );
        updateData.stockQuantity = totalVariantStock;
      } else if (
        currentProd.stockQuantity !== undefined &&
        currentProd.stockQuantity !== null
      ) {
        const newStock = Math.max(0, Number(currentProd.stockQuantity) - deduction.totalQty);
        updateData.stockQuantity = newStock;
      }

      await prisma.product.update({
        where: { id: pId },
        data: updateData,
      });

      // Record StockLog entry
      try {
        const finalQty = updateData.stockQuantity !== undefined ? updateData.stockQuantity : (currentProd.stockQuantity || 0);
        await prisma.stockLog.create({
          data: {
            productId: pId,
            productName: currentProd.name,
            variantLabel: deduction.variantDeductions.length > 0
              ? deduction.variantDeductions.map((v) => `${v.size}/${v.color}`).join(", ")
              : null,
            previousQty: currentProd.stockQuantity || 0,
            newQty: finalQty,
            changeQty: -deduction.totalQty,
            reason: "order_sale",
            note: "Website Customer Order",
            source: "website",
          },
        });
      } catch (logErr) {
        console.error("StockLog creation failed in placeOrder:", logErr);
      }
    }

    // Trigger allocation engine asynchronously (non-blocking)
    runAllocationEngine(createdOrder.id).then((result) => {
      if (!result.success) {
        console.warn(`[Allocation] Order ${createdOrder.id} could not be auto-assigned: ${result.message}`);
      } else {
        console.log(`[Allocation] Order ${createdOrder.id} assigned to manufacturer ${result.assignment?.manufacturerId}`);
      }
    }).catch((err) => {
      console.error("[Allocation] Engine error:", err);
    });

    res.json({ success: true, message: "Order Placed Successfully" });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// All Orders data for Admin Panel (monitor all orders - read-only context)
const allOrders = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const orderInclude = {
        deliveryOrder: {
          select: {
            id: true,
            ncmOrderId: true,
            state: true,
            ncmStatus: true,
            vendorReference: true,
            originBranchName: true,
            destinationBranchName: true,
            pickedUpAt: true,
            deliveredAt: true,
          },
        },
      };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        orderBy: { date: "desc" },
        include: orderInclude,
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.order.count(),
    ]);
    const orders = rawOrders.map((item) => buildOrderListItem(item));
    res.json(paginatedResponse("orders", orders, pagination, total));
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

/**
 * Returns ONLY admin-created orders (Social Media / Phone / Manual orders created by admin).
 * These are the orders admin can operationally manage (status transitions, cash received, etc.).
 */
const allAdminOrders = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const where = { orderType: "ADMIN_DIRECT" };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: { date: "desc" },
        include: { deliveryOrder: { select: { id: true, ncmOrderId: true, state: true, ncmStatus: true, vendorReference: true, originBranchName: true, destinationBranchName: true, pickedUpAt: true, deliveredAt: true } } },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.order.count({ where }),
    ]);
    const adminOrders = rawOrders;
    const orders = adminOrders.map((item) => buildOrderListItem(item));
    res.json(paginatedResponse("orders", orders, pagination, total));
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// User Order Data For Frontend
const userOrders = async (req, res) => {
  try {
    const { userId } = req.body;
    const pagination = getPagination(req.query);
    const where = { userId };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: { date: "desc" },
        include: {
        deliveryOrder: {
          select: {
            id: true,
            ncmOrderId: true,
            state: true,
            ncmStatus: true,
            vendorReference: true,
            originBranchName: true,
            destinationBranchName: true,
            pickedUpAt: true,
            deliveredAt: true,
          },
        },
        },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.order.count({ where }),
    ]);
    const orders = rawOrders.map((item) => buildOrderListItem(item));
    res.json(paginatedResponse("orders", orders, pagination, total));
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// update order status from Admin Panel
// GUARD: Admin can ONLY update status of orders they directly created.
// Website/storefront orders are managed exclusively by assigned manufacturer hubs.
const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }

    // Check if this is an admin-created order
    let isAdminCreated = order.orderType === "ADMIN_DIRECT";
    if (!isAdminCreated) {
      try {
        const reward =
          typeof order.rewardApplied === "string"
            ? JSON.parse(order.rewardApplied)
            : order.rewardApplied;
        if (reward && reward.adminCreated === true) isAdminCreated = true;
      } catch {}
    }

    if (!isAdminCreated) {
      return res.json({
        success: false,
        message:
          "Access denied: Website and storefront orders are managed exclusively by the assigned manufacturer hub. Admin can only update orders they directly created.",
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
    res.json({ success: true, message: "Status Updated" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const cashReceived = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }
    if (order.status !== "Delivered") {
      return res.json({ success: false, message: "Order not delivered yet" });
    }
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { payment: true },
    });

    // Post Customer Payment to Double-Entry General Ledger (DR Liquid Cash, CR Accounts Receivable)
    postCustomerPaymentAccounting(updatedOrder).catch((glErr) => {
      console.error("General Ledger payment posting error:", glErr);
    });

    res.json({ success: true, message: "Cash marked as received" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const lookupAdminOrderCustomer = async (req, res) => {
  try {
    const result = await findAdminOrderCustomer(req.query.phone || "");
    if (result.state === "INVALID_PHONE") {
      return res.json({ success: false, message: "A valid contact number is required" });
    }
    res.json({ success: true, state: result.state, found: result.state !== "NEW_CUSTOMER", customer: result.customer || null });
  } catch (error) {
    console.error("Admin customer lookup error:", error);
    res.json({ success: false, message: error.message });
  }
};

const verifyAdminOrderCustomer = async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    const result = await getAdminOrderCustomerForCreation(phone || "", code || "");
    if (result.state === "INVALID_PHONE") {
      return res.json({ success: false, message: "A valid contact number is required" });
    }
    res.json({
      success: true,
      state: result.state,
      verified: result.state === "VERIFIED",
      loyaltyEligible: result.loyaltyEligible,
      giftEligible: result.giftEligible,
      customer: result.customer || null,
    });
  } catch (error) {
    console.error("Admin customer verification error:", error);
    res.json({ success: false, message: error.message });
  }
};

// Admin Create Order for Social Media & Manual Phone Inquiries
const adminCreateOrder = async (req, res) => {
  try {
    const {
      client,
      items,
      discount = 0,
      deliveryFee,
      paymentMethod = "COD",
      payment = false,
      status = "Order Placed",
    } = req.body;

    if (!client || !client.phone) {
      return res.json({
        success: false,
        message: "Customer contact phone number is required",
      });
    }

    if (!/^\d{10}$/.test(String(client.phone).trim()) || !isValidMobileNumber(client.phone)) {
      return res.json({
        success: false,
        message: "Contact number must contain exactly 10 digits and start with 97 or 98",
      });
    }

    const customerDecision = await getAdminOrderCustomerForCreation(
      client.phone,
      client.socialCode || ""
    );
    if (customerDecision.state === "CODE_REQUIRED") {
      return res.json({
        success: false,
        message: "This contact number already exists. Enter the social code provided by the customer.",
      });
    }

    const customerData = customerDecision.customer;
    const resolvedClient = customerData
      ? {
          ...client,
          firstName: client.firstName || customerData.firstName,
          lastName: client.lastName || customerData.lastName,
          email: client.email || customerData.email,
          gender: client.gender || customerData.gender,
          phone: customerData.phone || client.phone,
          province: client.province || customerData.address.province,
          district: client.district || customerData.address.district,
          city: client.city || customerData.address.city,
          ncmBranch: client.ncmBranch || customerData.address.ncmBranch,
          state: client.state || customerData.address.state,
          zipcode: client.zipcode || customerData.address.zipcode,
          country: client.country || customerData.address.country,
          street: client.street || customerData.address.street,
          landmark: client.landmark || customerData.address.landmark,
        }
      : client;

    if (!resolvedClient.firstName || !resolvedClient.lastName || !resolvedClient.street || !resolvedClient.landmark) {
      return res.json({
        success: false,
        message: "Complete the required customer and delivery details before creating the order",
      });
    }

    if (!String(resolvedClient.ncmBranch || "").trim() || !String(resolvedClient.ncmCoveredArea || "").trim()) {
      return res.json({
        success: false,
        message: "Select the NCM branch and covered delivery location before creating the order",
      });
    }

    if (!items || items.length === 0) {
      return res.json({
        success: false,
        message: "Please select at least one product for the order",
      });
    }

    // Extract product IDs and query current DB records to freeze price snapshots
    const productIds = items.map((i) => i._id || i.id || i.productId).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    // Validate stock before proceeding
    const stockValidation = validateOrderStock(items, dbProducts);
    if (!stockValidation.valid) {
      return res.json({ success: false, message: stockValidation.message });
    }

    // Freeze snapshot of items
    const frozenItemsSnapshot = items.map((cartItem) => {
      const pId = cartItem._id || cartItem.id || cartItem.productId;
      const matchedProduct = dbProducts.find((p) => p.id === pId);

      const originalUnitPrice = matchedProduct
        ? matchedProduct.price
        : Number(cartItem.originalUnitPrice || cartItem.price || 0);
      const discountPercentage = matchedProduct
        ? matchedProduct.discount || 0
        : Number(cartItem.discountPercentage || 0);

      const calculatedUnit =
        discountPercentage > 0
          ? Math.round(originalUnitPrice * (1 - discountPercentage / 100))
          : originalUnitPrice;

      const purchasedUnitPrice =
        cartItem.purchasedUnitPrice !== undefined
          ? Number(cartItem.purchasedUnitPrice)
          : cartItem.price !== undefined
          ? Number(cartItem.price)
          : calculatedUnit;

      const qty = Number(cartItem.quantity || 1);

      return {
        ...cartItem,
        _id: pId,
        productId: pId,
        name: matchedProduct ? matchedProduct.name : cartItem.name || "Product",
        image: matchedProduct ? matchedProduct.image : cartItem.image || [],
        category: matchedProduct ? matchedProduct.category : cartItem.category || "",
        subCategory: matchedProduct ? matchedProduct.subCategory : cartItem.subCategory || "",
        size: cartItem.size || "",
        color: cartItem.color || "",
        quantity: qty,
        originalUnitPrice: originalUnitPrice,
        discountPercentage: discountPercentage,
        purchasedUnitPrice: purchasedUnitPrice,
        price: purchasedUnitPrice,
        lineTotal: purchasedUnitPrice * qty,
      };
    });

    const itemsTotal = frozenItemsSnapshot.reduce((acc, item) => acc + item.lineTotal, 0);

    // Dynamic shipping calculation according to shipment rates (ShippingConfig)
    let expectedFee = 50;
    try {
      const customerDistrict = resolvedClient.district || resolvedClient.city || "";
      const customerProvince = resolvedClient.state || resolvedClient.province || "";
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: itemsTotal,
      });
      expectedFee = shippingResult.fee;
    } catch (cfgErr) {
      console.error("Error calculating shipping config in admin order:", cfgErr);
    }

    const resolvedFee =
      deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== ""
        ? Math.max(0, Number(deliveryFee))
        : expectedFee;

    const manualDiscount = Math.max(0, Number(discount) || 0);
    const finalAmount = Math.max(0, itemsTotal + resolvedFee - manualDiscount);

    // Only a verified existing customer may be linked. Invalid-code orders use a
    // unique anonymous identity so their loyalty history cannot be shared.
    let orderUserId = customerDecision.userId || `admin_social_client_${randomUUID()}`;

    const isSocialOrder = /social|instagram|facebook|whatsapp|tiktok|messenger|phone/i.test(
      String(resolvedClient.source || "Social Media")
    );

    let socialCustomerProfile = null;
    if (isSocialOrder && resolvedClient.phone && customerDecision.state === "NEW_CUSTOMER") {
      try {
        socialCustomerProfile = await createInactiveSocialCustomerProfile({
          firstName: resolvedClient.firstName,
          lastName: resolvedClient.lastName,
          phone: resolvedClient.phone,
          email: resolvedClient.email,
          gender: resolvedClient.gender,
          province: resolvedClient.province || resolvedClient.state || "Bagmati Province",
          district: resolvedClient.district || resolvedClient.city || "Kathmandu",
          city: resolvedClient.city || resolvedClient.ncmBranch || resolvedClient.district || "Kathmandu",
          ncmBranch: resolvedClient.ncmBranch || resolvedClient.city || resolvedClient.district || "Kathmandu",
          state: resolvedClient.state || resolvedClient.province || "Bagmati Province",
          country: resolvedClient.country || "Nepal",
          address: {
            firstName: resolvedClient.firstName,
            lastName: resolvedClient.lastName,
            phone: resolvedClient.phone,
            province: resolvedClient.province || resolvedClient.state || "Bagmati Province",
            district: resolvedClient.district || resolvedClient.city || "Kathmandu",
            city: resolvedClient.city || resolvedClient.ncmBranch || resolvedClient.district || "Kathmandu",
            ncmBranch: resolvedClient.ncmBranch || resolvedClient.city || resolvedClient.district || "Kathmandu",
            state: resolvedClient.state || resolvedClient.province || "Bagmati Province",
            country: resolvedClient.country || "Nepal",
            street: resolvedClient.street || "",
            landmark: resolvedClient.landmark || "",
            zipcode: resolvedClient.zipcode || "44600",
          },
          socialUsername: resolvedClient.socialUsername || "",
          source: resolvedClient.source || "Social Media",
          loyaltyTier: resolvedClient.loyaltyTier || "",
          orderId: "",
        });

        if (socialCustomerProfile?.success && socialCustomerProfile.user) {
          orderUserId = socialCustomerProfile.user.id;
        }
      } catch (profileErr) {
        console.error("Error creating inactive social customer profile in admin order:", profileErr);
      }
    }

    const addressSnapshot = {
      firstName: resolvedClient.firstName.trim(),
      lastName: (resolvedClient.lastName || "").trim(),
      email: (resolvedClient.email || "").trim(),
      phone: resolvedClient.phone.trim(),
      gender: resolvedClient.gender || "PREFER_NOT_TO_SAY",
      street: resolvedClient.street || "",
      landmark: resolvedClient.landmark || "",
      province: resolvedClient.province || resolvedClient.state || "Bagmati Province",
      district: resolvedClient.district || resolvedClient.city || "Kathmandu",
      city: resolvedClient.city || resolvedClient.ncmBranch || resolvedClient.district || "Kathmandu",
      ncmBranch: resolvedClient.ncmBranch || resolvedClient.city || resolvedClient.district || "Kathmandu",
      ncmCoveredArea: resolvedClient.ncmCoveredArea || "",
      state: resolvedClient.state || resolvedClient.province || "Bagmati Province",
      zipcode: resolvedClient.zipcode || "44600",
      country: resolvedClient.country || "Nepal",
      source: resolvedClient.source || "Social Media",
      socialUsername: resolvedClient.socialUsername || "",
      socialCode: resolvedClient.socialCode || "",
      orderNotes: resolvedClient.orderNotes || "",
      deliveryInstruction: resolvedClient.deliveryInstruction || resolvedClient.orderNotes || "",
      loyaltyExcluded: !customerDecision.loyaltyEligible,
      giftEligible: customerDecision.giftEligible,
    };

    const manufacturingPlan = resolveOrderManufacturingPlan(
      frozenItemsSnapshot,
      await prisma.manufacturerInventory.findMany({
        where: { productId: { in: productIds } },
      })
    );

    const newOrder = await prisma.order.create({
      data: {
        userId: orderUserId,
        items: frozenItemsSnapshot,
        amount: finalAmount,
        deliveryFee: resolvedFee,
        paymentMethod: paymentMethod || "COD",
        payment: Boolean(payment),
        status: status || "Order Placed",
        date: BigInt(Date.now()),
        address: addressSnapshot,
        loyaltyDiscount: manualDiscount,
        manufacturerId: manufacturingPlan.primaryManufacturerId || null,
        specialOrder: Boolean(manufacturingPlan.specialOrder),
        specialOrderReason: manufacturingPlan.specialOrderReason,
        specialOrderManufacturerIds: manufacturingPlan.specialOrderManufacturerIds,
        orderType: "ADMIN_DIRECT", // Mark as admin-created for guard in updateStatus
        rewardApplied: JSON.stringify({
          source: resolvedClient.source || "Social Media",
          manualDiscount,
          deliveryFee: resolvedFee,
          adminCreated: true,
          loyaltyExcluded: !customerDecision.loyaltyEligible,
          giftEligible: customerDecision.giftEligible,
          socialCodeVerified: customerDecision.state === "VERIFIED",
          customerVerificationState: customerDecision.state,
        }),
      },
    });




    if (newOrder.payment) {
      postCustomerPaymentAccounting(newOrder).catch((glErr) => {
        console.error("General Ledger admin payment posting error:", glErr);
      });
    }

    // Deduct stock
    const productDeductions = {};
    for (const cartItem of frozenItemsSnapshot) {
      const pId = cartItem.productId || cartItem._id;
      const orderedQty = Number(cartItem.quantity || 1);
      if (!pId) continue;

      if (!productDeductions[pId]) {
        productDeductions[pId] = {
          totalQty: 0,
          variantDeductions: [],
        };
      }
      productDeductions[pId].totalQty += orderedQty;

      if (cartItem.size && cartItem.color) {
        productDeductions[pId].variantDeductions.push({
          size: cartItem.size,
          color: cartItem.color,
          quantity: orderedQty,
        });
      }
    }

    for (const [pId, deduction] of Object.entries(productDeductions)) {
      const currentProd = await prisma.product.findUnique({ where: { id: pId } });
      if (!currentProd) continue;

      let updateData = {};
      let parsedVariants =
        typeof currentProd.variants === "string"
          ? JSON.parse(currentProd.variants || "[]")
          : currentProd.variants || [];

      const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;

      if (hasVariants && deduction.variantDeductions.length > 0) {
        for (const vd of deduction.variantDeductions) {
          const vIdx = parsedVariants.findIndex(
            (v) =>
              (v.size || "").trim().toLowerCase() === (vd.size || "").trim().toLowerCase() &&
              (v.color || "").trim().toLowerCase() === (vd.color || "").trim().toLowerCase()
          );
          if (vIdx !== -1) {
            const currentVariantQty = Number(parsedVariants[vIdx].quantity || 0);
            parsedVariants[vIdx].quantity = Math.max(0, currentVariantQty - vd.quantity);
          }
        }
        updateData.variants = parsedVariants;
        const totalVariantStock = parsedVariants.reduce(
          (acc, v) => acc + (Number(v.quantity) || 0),
          0
        );
        updateData.stockQuantity = totalVariantStock;
      } else if (
        currentProd.stockQuantity !== undefined &&
        currentProd.stockQuantity !== null
      ) {
        const newStock = Math.max(0, Number(currentProd.stockQuantity) - deduction.totalQty);
        updateData.stockQuantity = newStock;
      }

      await prisma.product.update({
        where: { id: pId },
        data: updateData,
      });

      // Record StockLog entry
      try {
        const channelSource = (resolvedClient.source || "admin").toLowerCase().replace(/\s+/g, "_");
        const finalQty = updateData.stockQuantity !== undefined ? updateData.stockQuantity : (currentProd.stockQuantity || 0);
        await prisma.stockLog.create({
          data: {
            productId: pId,
            productName: currentProd.name,
            variantLabel: deduction.variantDeductions.length > 0
              ? deduction.variantDeductions.map((v) => `${v.size}/${v.color}`).join(", ")
              : null,
            previousQty: currentProd.stockQuantity || 0,
            newQty: finalQty,
            changeQty: -deduction.totalQty,
            reason: "order_sale",
            note: `Manual Order (${resolvedClient.source || "Social Media"})`,
            source: channelSource || "admin",
          },
        });
      } catch (logErr) {
        console.error("StockLog creation failed in adminCreateOrder:", logErr);
      }
    }

    // Trigger smart allocation engine asynchronously
    runAllocationEngine(newOrder.id)
      .then((result) => {
        if (!result.success) {
          console.warn(`[Allocation] Admin Order ${newOrder.id} could not be auto-assigned: ${result.message}`);
        } else {
          console.log(`[Allocation] Admin Order ${newOrder.id} assigned to manufacturer ${result.assignment?.manufacturerId}`);
        }
      })
      .catch((err) => {
        console.error("[Allocation] Engine error on admin order:", err);
      });

    res.json({
      success: true,
      message: "Order created successfully",
      orderId: newOrder.id,
      order: {
        ...newOrder,
        _id: newOrder.id,
        date: Number(newOrder.date),
      },
    });
  } catch (error) {
    console.error("Admin create order error:", error);
    res.json({ success: false, message: error.message });
  }
};

export {
  placeOrder,
  allOrders,
  allAdminOrders,
  userOrders,
  updateStatus,
  cashReceived,
  lookupAdminOrderCustomer,
  verifyAdminOrderCustomer,
  adminCreateOrder,
  buildOrderListItem,
};
