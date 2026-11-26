import { prisma } from "../config/db.js";
import { randomUUID } from "node:crypto";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { getPlatformFeatures } from "../services/platformFeatureService.js";
import { postSalesOrderAccounting } from "../services/accountingPostingEngine.js";
import { recordDeliveredOrderCashReceipt } from "../services/orderPaymentAccountingService.js";
import {
  createAdminDirectOrderWithStock,
  validateOrderStock,
} from "../services/adminDirectOrderService.js";
import { runAllocationEngine } from "./orderAssignmentController.js";
import { resolveDistrictShippingFee } from "./shippingController.js";
import { createInactiveSocialCustomerProfile } from "./userController.js";
import { isValidMobileNumber } from "../utils/socialCustomerProfile.js";
import { directOrderReceiptRequiredError } from "../utils/directOrderReceiptPolicy.js";
import {
  findAdminOrderCustomer,
  getAdminOrderCustomerForCreation,
} from "../services/adminOrderCustomerService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { productBelongsToCategory } from "../services/productCategoryRules.js";
import {
  allocateComboBundleComponentPriceDecimals,
  calculateComboBundlePrice,
  getSharedComboBundleVariants,
} from "../services/comboBundleRules.js";
import { resolveLocationProductPrices } from "../services/locationPricingService.js";
import { getAddressProvince } from "../services/deliveryLocationService.js";
import { campaignMatchesOrder } from "../services/marketingCardService.js";
import { calculateMarketingCardDiscount } from "../services/marketingCardReward.js";
import { containsSqlInjection, sanitizeText } from "../middleware/sanitize.js";
import { bindGiftRewardsToCheckout, createPendingGiftEntitlement } from "../services/giftService.js";
import { createOrderIdentity } from "../utils/orderReference.js";
import {
  addDecimals,
  compareDecimals,
  quantizeCurrencyAmount,
  serializeAccountingDecimal,
  subtractDecimals,
} from "../services/accountingDecimal.js";
import {
  allocatePricingAmount,
  applyPercentagePriceDiscount,
  calculatePricedLine,
  createOrderPricingSnapshotV3,
  decimalFromStoredFloat,
  exactPricingApiFields,
  hasNoOverDiscount,
  roundCommercialOrderTotal,
  toLegacyFloatMirror,
  wholeOrderQuantity,
  withOrderPricingSnapshot,
} from "../services/checkoutPricingService.js";

const normalizeOrderVariant = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();
const validateDeliveryStreet = (value) => {
  if (typeof value !== "string" || containsSqlInjection(value)) {
    return { error: "Enter a valid street address without SQL syntax." };
  }
  const street = sanitizeText(value, { stripAllHtml: true });
  if (!street || /[\u0001-\u001f\u007f]/.test(street)) {
    return { error: "Street address is required and must contain plain text." };
  }
  if (street.length > 255) {
    return { error: "Street address must be 255 characters or fewer." };
  }
  return { street };
};

export const splitItemsIntoDistributorShipments = (items, shipments) => {
  const remainingByShipment = shipments.map((shipment) => ({
    ...shipment,
    remainingItems: shipment.items.map((item) => ({ ...item, remainingQuantity: Number(item.qty) })),
  }));
  const ordersByDistributorProduct = new Map();

  for (const orderItem of items) {
    let remaining = Number(orderItem.quantity || 1);
    const productId = String(orderItem.productId || orderItem._id || orderItem.id || "");
    for (const shipment of remainingByShipment) {
      for (const requirement of shipment.remainingItems) {
        if (
          requirement.productId !== productId ||
          normalizeOrderVariant(requirement.size) !== normalizeOrderVariant(orderItem.size) ||
          normalizeOrderVariant(requirement.color) !== normalizeOrderVariant(orderItem.color)
        ) continue;
        const quantity = Math.min(remaining, requirement.remainingQuantity);
        if (!quantity) continue;
          const unitPrice = orderItem._pricingDecimal?.unitPrice ??
            decimalFromStoredFloat(orderItem.purchasedUnitPrice ?? orderItem.price ?? 0, "Accepted unit price").toString();
          const pricedLine = calculatePricedLine({ unitPrice, quantity: String(quantity) });
        const orderKey = `${shipment.distributor.id}\0${productId}`;
        const packageOrder = ordersByDistributorProduct.get(orderKey) || {
          distributor: shipment.distributor,
          items: [],
        };
        packageOrder.items.push({
          ...orderItem,
          quantity,
          lineTotal: toLegacyFloatMirror(pricedLine.lineTotal, "Order-item line total"),
          _pricingDecimal: {
            ...(orderItem._pricingDecimal || {}),
            unitPrice: serializeAccountingDecimal(pricedLine.unitPrice),
            quantity: serializeAccountingDecimal(pricedLine.quantity),
            lineTotal: serializeAccountingDecimal(pricedLine.lineTotal),
          },
          ...(orderItem.comboBundleQuantity !== undefined ? { comboBundleQuantity: quantity } : {}),
        });
        ordersByDistributorProduct.set(orderKey, packageOrder);
        requirement.remainingQuantity -= quantity;
        remaining -= quantity;
        if (!remaining) break;
      }
      if (!remaining) break;
    }
    if (remaining) {
      throw Object.assign(
        new Error("The distributor stock plan no longer covers every item. Refresh checkout and retry."),
        { status: 409, code: "DISTRIBUTOR_STOCK_PLAN_MISMATCH" }
      );
    }
  }

  if (remainingByShipment.some((shipment) =>
    shipment.remainingItems.some((item) => item.remainingQuantity > 0)
  )) {
    throw Object.assign(
      new Error("The distributor stock plan contains items that do not match the checkout cart."),
      { status: 409, code: "DISTRIBUTOR_STOCK_PLAN_MISMATCH" }
    );
  }
  return [...ordersByDistributorProduct.values()];
};

const buildCheckoutPackages = (shippingResult, items) => {
  if (shippingResult.shipments?.length > 1) {
    return splitItemsIntoDistributorShipments(items, shippingResult.shipments);
  }
  return [{
    distributor: shippingResult.probableDistributor || null,
    items,
  }];
};

const getShipmentPackageSignature = (packages) => {
  const quantities = new Map();
  for (const shipment of packages) {
    for (const item of shipment.items) {
      const key = [
        shipment.distributor?.id || "",
        item.productId || item._id || item.id || "",
        normalizeOrderVariant(item.size),
        normalizeOrderVariant(item.color),
      ].join("\0");
      quantities.set(key, (quantities.get(key) || 0) + Number(item.quantity || 0));
    }
  }
  return [...quantities.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, quantity]) => `${key}\0${quantity}`)
    .join("\n");
};

const allocateMoneyAcrossShipmentsExact = (amount, shipments) => allocatePricingAmount(
  amount,
  shipments.map(({ items }) => serializeAccountingDecimal(addDecimals(...items.map((item) =>
    item._pricingDecimal?.lineTotal ??
      decimalFromStoredFloat(item.lineTotal || 0, "Order-item line total").toString()
  )))),
);

export const allocateMoneyAcrossShipments = (amount, shipments) => {
  const total = decimalFromStoredFloat(amount, "Discount amount");
  return allocateMoneyAcrossShipmentsExact(total.toString(), shipments)
    .map((allocation) => Number(allocation));
};

const allocateOrderToDistributor = async (
  orderId,
  source,
  req,
  preferredDistributorId = null,
  forcePreferredDistributorId = false
) => {
  const result = await runAllocationEngine(orderId, {
    actorId: req.auth?.accountId || null,
    actorRole: req.auth?.role || "SYSTEM",
    portalSource: source,
    ipAddress: req.ip || null,
    userAgent: req.headers["user-agent"] || null,
    correlationId: req.correlationId || null,
    ...(preferredDistributorId ? { preferredDistributorId } : {}),
    ...(forcePreferredDistributorId ? { forcePreferredDistributorId: true } : {}),
  });

  if (!result.success) {
    console.warn(`[Allocation] ${source} order ${orderId} remains unassigned: ${result.message}`);
    return {
      status: "PENDING_ASSIGNMENT",
      message: result.message,
    };
  }

  return {
    status: "ASSIGNED",
    assignmentId: result.assignment.id,
    distributor: {
      id: result.distributor.id,
      name: result.distributor.name,
    },
  };
};

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
    orderReference: order.orderReference,
    userId: order.userId,
    items: parsedItems,
    amount: Number(order.amount || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    ...exactPricingApiFields(order),
    address,
    status: order.status,
    paymentMethod: order.paymentMethod,
    payment: Boolean(order.payment),
    date: Number(order.date || 0),
    loyaltyDiscount: Number(order.loyaltyDiscount || 0),
    rewardApplied: parsedReward,
    assignedGift: order.assignedGift ? {
      id: order.assignedGift.id,
      name: order.assignedGift.name,
      sku: order.assignedGift.sku,
      priceValue: Number(order.assignedGift.priceValue || 0),
    } : null,
    giftStatus: order.giftStatus || "NONE",
    fulfillmentStatus: order.fulfillmentStatus,
    checkoutGroupId: order.checkoutGroupId || null,
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
    paperBill: order.paperBill || null,
    distributorReview: order.distributorReview || null,
    assignedDistributorId: order.assignedDistributorId || order.distributorId || null,
    distributorAssignment: order.distributorAssignment || null,
    distributorDelivery: order.distributorDelivery || null,
    totalItems: Array.isArray(parsedItems) ? parsedItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0) : 0,
  };
};

const attachDistributorAssignmentHistory = async (orders) => {
  if (!orders.length) return orders;

  const orderIds = orders.map(({ id }) => id);
  const [assignments, auditEntries] = await Promise.all([
    prisma.orderAssignment.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        distributorId: true,
        assignedAt: true,
        paperBillRequested: true,
        paperBillStatus: true,
        paperBillDocumentType: true,
        paperBillNumber: true,
        paperBillIssuedAt: true,
        paperBillVoidedAt: true,
        paperBillVoidReason: true,
        paperBillAdjustedAt: true,
        paperBillAdjustmentReason: true,
        distributor: { select: { id: true, name: true } },
      },
    }),
    prisma.systemAuditLog.findMany({
      where: {
        entityType: "Order",
        entityId: { in: orderIds },
        action: "ORDER_AUTO_ASSIGNED",
        status: "SUCCESS",
      },
      orderBy: { createdAt: "asc" },
      select: { entityId: true, afterState: true, createdAt: true },
    }),
  ]);
  const assignmentByOrderId = new Map(assignments.map((assignment) => [assignment.orderId, assignment]));
  const auditsByOrderId = new Map();
  const distributorIds = new Set(assignments.map(({ distributorId }) => distributorId).filter(Boolean));

  for (const audit of auditEntries) {
    const distributorId = audit.afterState?.distributorId;
    if (!audit.entityId || !distributorId) continue;
    distributorIds.add(distributorId);
    const entries = auditsByOrderId.get(audit.entityId) || [];
    entries.push({ distributorId, assignedAt: audit.createdAt });
    auditsByOrderId.set(audit.entityId, entries);
  }

  const distributors = distributorIds.size
    ? await prisma.distributor.findMany({
      where: { id: { in: [...distributorIds] } },
      select: { id: true, name: true },
    })
    : [];
  const distributorById = new Map(distributors.map((distributor) => [distributor.id, distributor]));

  return orders.map((order) => {
    const auditHistory = auditsByOrderId.get(order.id) || [];
    const initialAudit = auditHistory[0] || null;
    const latestAudit = auditHistory[auditHistory.length - 1] || null;
    const assignment = assignmentByOrderId.get(order.id) || null;
    const currentDistributorId = assignment?.distributorId || latestAudit?.distributorId || null;
    const initialDistributorId = initialAudit?.distributorId || null;
    const currentDistributor = assignment?.distributor || distributorById.get(currentDistributorId) || null;
    const initialDistributor = distributorById.get(initialDistributorId) || null;

    return {
      ...order,
      assignedDistributorId: currentDistributorId,
      paperBill: {
        requested: Boolean(assignment?.paperBillRequested),
        status: assignment?.paperBillStatus || "NOT_SELECTED",
        documentType: assignment?.paperBillDocumentType || null,
        number: assignment?.paperBillNumber || null,
        issuedAt: assignment?.paperBillIssuedAt || null,
        voidedAt: assignment?.paperBillVoidedAt || null,
        voidReason: assignment?.paperBillVoidReason || null,
        adjustedAt: assignment?.paperBillAdjustedAt || null,
        adjustmentReason: assignment?.paperBillAdjustmentReason || null,
      },
      distributorAssignment: {
        initial: initialDistributorId
          ? {
            distributorId: initialDistributorId,
            distributorName: initialDistributor?.name || null,
            assignedAt: initialAudit.assignedAt,
          }
          : null,
        current: currentDistributorId
          ? {
            distributorId: currentDistributorId,
            distributorName: currentDistributor?.name || null,
            assignedAt: assignment?.assignedAt || latestAudit?.assignedAt || null,
            status: assignment?.status || null,
          }
          : null,
        changed: Boolean(initialDistributorId && currentDistributorId && initialDistributorId !== currentDistributorId),
      },
    };
  });
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

// Placing orders using COD Method with Immutable Price Snapshot
const placeOrder = async (req, res) => {
  try {
    const userId = req.userId || req.auth?.userId;
    const { comboBundle } = req.body;
    const submittedAddress = req.body.address;
    const rewardChoice = String(req.body.rewardChoice || "").trim().toUpperCase();
    const selectedCardId = String(req.body.marketingCardId || "").trim();
    const platformFeatures = await getPlatformFeatures();
    if (!userId) return res.status(401).json({ success: false, message: "Authenticated customer is required." });
    if (!submittedAddress || typeof submittedAddress !== "object" || Array.isArray(submittedAddress)) {
      return res.status(400).json({ success: false, message: "A delivery address is required." });
    }
    const streetValidation = validateDeliveryStreet(submittedAddress.street);
    if (streetValidation.error) {
      return res.status(400).json({ success: false, message: streetValidation.error });
    }
    const address = {
      ...submittedAddress,
      street: streetValidation.street,
      landmark: sanitizeText(submittedAddress.landmark, { stripAllHtml: true }) || "",
    };
    if (rewardChoice && !["CARD", "LOYALTY", "NONE"].includes(rewardChoice)) {
      return res.status(400).json({ success: false, message: "Select either a card reward, a loyalty reward, or no reward." });
    }
    if (rewardChoice === "CARD" && !platformFeatures.marketingCardsEnabled) {
      return res.status(403).json({ success: false, code: "FEATURE_DISABLED", message: "Marketing card rewards are currently unavailable." });
    }
    if (rewardChoice === "LOYALTY" && !platformFeatures.loyaltyEnabled) {
      return res.status(403).json({ success: false, code: "FEATURE_DISABLED", message: "Loyalty rewards are currently unavailable." });
    }
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
        where: {
          id: { in: initialMemberProducts.map((product) => product.id) },
          collaborationLink: null,
        },
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
        where: { id: { in: productIds }, collaborationLink: null },
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

    const locationPricing = comboBundleRecord ? null : await resolveLocationProductPrices({
      items,
      province: address?.province || address?.state,
      district: address?.district,
    });

    let frozenItemsSnapshot = items.map((cartItem, itemIndex) => {
      const pId = cartItem._id || cartItem.id || cartItem.productId;
      const matchedProduct = dbProducts.find((p) => p.id === pId);
      const resolvedPrice = locationPricing?.items[itemIndex];
      const qty = Number(wholeOrderQuantity(cartItem.quantity ?? 1).toString());
      const originalUnitPriceDecimal = resolvedPrice?.pricing?.basePrice
        ? decimalFromStoredFloat(resolvedPrice.pricing.basePrice, "Product price")
        : decimalFromStoredFloat(matchedProduct?.price ?? cartItem.price ?? 0, "Product price");
      const discountPercentageDecimal = resolvedPrice?.pricing?.effectiveDiscountPercentage
        ? decimalFromStoredFloat(resolvedPrice.pricing.effectiveDiscountPercentage, "Product discount")
        : decimalFromStoredFloat(matchedProduct?.discount ?? cartItem.discount ?? 0, "Product discount");
      const purchasedUnitPriceDecimal = resolvedPrice?.pricing?.effectiveUnitPrice
        ? decimalFromStoredFloat(resolvedPrice.pricing.effectiveUnitPrice, "Accepted unit price")
        : applyPercentagePriceDiscount(
          originalUnitPriceDecimal.toString(),
          discountPercentageDecimal.toString(),
        );
      const line = calculatePricedLine({
        unitPrice: serializeAccountingDecimal(purchasedUnitPriceDecimal),
        quantity: String(qty),
      });
      const originalUnitPrice = toLegacyFloatMirror(originalUnitPriceDecimal, "Legacy product price snapshot");
      const discountPercentage = toLegacyFloatMirror(discountPercentageDecimal, "Legacy discount percentage snapshot");
      const purchasedUnitPrice = toLegacyFloatMirror(line.unitPrice, "Legacy accepted unit price snapshot");

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
        globalProductDiscountPercentage: Number(matchedProduct?.discount || 0),
        locationDiscountPercentage: resolvedPrice?.locationDiscountPercentage ?? null,
        discountSource: resolvedPrice?.discountSource || (discountPercentage > 0 ? "PRODUCT" : "BASE"),
        locationDiscountDistributorId: resolvedPrice?.locationDiscountDistributorId || null,
        offerTag: matchedProduct?.offerTag || cartItem.offerTag || "",
        offerTitle: matchedProduct?.offerTitle || cartItem.offerTitle || "",
        purchasedUnitPrice: purchasedUnitPrice, // Price snapshot frozen at purchase time
        price: purchasedUnitPrice, // Standardized unit price snapshot
        lineTotal: toLegacyFloatMirror(line.lineTotal, "Legacy order-item line total"),
        _pricingDecimal: {
          unitPrice: serializeAccountingDecimal(line.unitPrice),
          catalogUnitPrice: serializeAccountingDecimal(originalUnitPriceDecimal),
          catalogPriceSource: matchedProduct ? "PRODUCT_FLOAT_COMPATIBILITY" : "CART_COMPATIBILITY",
          quantity: serializeAccountingDecimal(line.quantity),
          lineTotal: serializeAccountingDecimal(line.lineTotal),
          discountPercentage: serializeAccountingDecimal(discountPercentageDecimal),
          discountSource: resolvedPrice?.discountSource ||
            (discountPercentageDecimal.greaterThan(0) ? "PRODUCT" : "BASE"),
          discountSourceId: resolvedPrice?.discountSource === "LOCATION"
            ? resolvedPrice.locationDiscountRuleId
            : pId,
        },
      };
    });

    if (comboBundleRecord) {
      const bundlePrice = calculateComboBundlePrice({
        products: dbProducts,
        discountPercentage: comboBundleRecord.discountPercentage,
        manualPriceOverride: comboBundleRecord.manualPriceOverride,
        sellingPrice: comboBundleRecord.sellingPrice,
      });
      const componentPrices = allocateComboBundleComponentPriceDecimals(
        frozenItemsSnapshot,
        bundlePrice.sellingPriceDecimal,
      );
      frozenItemsSnapshot = frozenItemsSnapshot.map((item, index) => {
        const purchasedUnitPrice = componentPrices[index];
        const line = calculatePricedLine({
          unitPrice: purchasedUnitPrice,
          quantity: item._pricingDecimal.quantity,
        });
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
          purchasedUnitPrice: toLegacyFloatMirror(line.unitPrice, "Legacy bundle component price"),
          price: toLegacyFloatMirror(line.unitPrice, "Legacy bundle component price"),
          lineTotal: toLegacyFloatMirror(line.lineTotal, "Legacy bundle component line total"),
          _pricingDecimal: {
            ...item._pricingDecimal,
            preBundleUnitPrice: item._pricingDecimal.unitPrice,
            unitPrice: serializeAccountingDecimal(line.unitPrice),
            lineTotal: serializeAccountingDecimal(line.lineTotal),
            bundleUnitPrice: bundlePrice.sellingPriceDecimal,
            bundleDiscountPercentage: bundlePrice.manualPriceOverride
              ? null
              : bundlePrice.discountPercentageDecimal,
            bundleDiscountSourceId: comboBundleRecord.id,
          },
        };
      });
    }

    let itemsTotal = addDecimals(...frozenItemsSnapshot.map((item) =>
      item._pricingDecimal.lineTotal
    ));
    let manufacturingPlan = resolveOrderManufacturingPlan(frozenItemsSnapshot, manufacturerInventory);

    // Resolve dynamic shipping charge from ShippingConfig (authoritative backend calculation)
    let expectedFee = 0;
    let expectedFeeDecimal = decimalFromStoredFloat("0");
    let packages = [];
    try {
      const customerDistrict = address?.district || address?.city || "";
      const customerProvince = getAddressProvince(address);
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: serializeAccountingDecimal(itemsTotal),
        items: frozenItemsSnapshot,
        ncmBranch: address?.ncmBranch || address?.city || "",
        deliveryType: address?.deliveryType || "Door2Door",
      });
      const unpricedItems = frozenItemsSnapshot;
      packages = buildCheckoutPackages(shippingResult, unpricedItems);

      if (!comboBundleRecord) {
        packages = await Promise.all(packages.map(async (shipment) => {
          if (!shipment.distributor?.id) return shipment;
          const pricing = await resolveLocationProductPrices({
            items: shipment.items,
            province: customerProvince,
            district: customerDistrict,
            distributorId: shipment.distributor.id,
          });
          return {
            ...shipment,
            items: shipment.items.map((item, index) => {
              const resolvedPrice = pricing.items[index];
            const purchasedUnitPriceDecimal = decimalFromStoredFloat(
              resolvedPrice.pricing.effectiveUnitPrice,
              "Location-priced unit price",
            );
            const line = calculatePricedLine({
              unitPrice: serializeAccountingDecimal(purchasedUnitPriceDecimal),
              quantity: item._pricingDecimal.quantity,
            });
              return {
                ...item,
              originalUnitPrice: toLegacyFloatMirror(resolvedPrice.pricing.basePrice, "Legacy product price snapshot"),
              discountPercentage: Number(resolvedPrice.effectiveDiscountPercentage || 0),
              globalProductDiscountPercentage: Number(resolvedPrice.productDiscountPercentage || 0),
                locationDiscountPercentage: resolvedPrice.locationDiscountPercentage ?? null,
                discountSource: resolvedPrice.discountSource,
                locationDiscountDistributorId: resolvedPrice.discountSource === "LOCATION"
                  ? shipment.distributor.id
                  : null,
              purchasedUnitPrice: toLegacyFloatMirror(line.unitPrice, "Legacy accepted unit price snapshot"),
              price: toLegacyFloatMirror(line.unitPrice, "Legacy accepted unit price snapshot"),
              lineTotal: toLegacyFloatMirror(line.lineTotal, "Legacy order-item line total"),
              _pricingDecimal: {
                ...item._pricingDecimal,
                catalogUnitPrice: resolvedPrice.pricing.basePrice,
                catalogPriceSource: "PRODUCT_FLOAT_COMPATIBILITY",
                unitPrice: serializeAccountingDecimal(line.unitPrice),
                lineTotal: serializeAccountingDecimal(line.lineTotal),
                discountPercentage: resolvedPrice.pricing.effectiveDiscountPercentage,
                discountSource: resolvedPrice.discountSource,
                discountSourceId: resolvedPrice.discountSource === "LOCATION"
                  ? resolvedPrice.locationDiscountRuleId
                  : item.productId,
              },
              };
            }),
          };
        }));
      }

      frozenItemsSnapshot = packages.flatMap((shipment) => shipment.items);
      itemsTotal = addDecimals(...frozenItemsSnapshot.map((item) => item._pricingDecimal.lineTotal));

      const finalShippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: serializeAccountingDecimal(itemsTotal),
        items: frozenItemsSnapshot,
        ncmBranch: address?.ncmBranch || address?.city || "",
        deliveryType: address?.deliveryType || "Door2Door",
      });
      const finalPackages = buildCheckoutPackages(finalShippingResult, unpricedItems);
      if (getShipmentPackageSignature(finalPackages) !== getShipmentPackageSignature(packages)) {
        throw Object.assign(new Error("Distributor stock changed while checkout prices were being confirmed. Refresh checkout and try again."), {
          status: 409,
          code: "DISTRIBUTOR_STOCK_CHANGED",
        });
      }
      expectedFee = finalShippingResult.fee;
      expectedFeeDecimal = decimalFromStoredFloat(
        finalShippingResult.feeDecimal ?? finalShippingResult.fee,
        "Delivery fee",
      );
      address.deliveryType = finalShippingResult.deliveryType || "Door2Door";
    } catch (cfgErr) {
      console.error("Error calculating authoritative shipping fee in placeOrder:", cfgErr);
      return res.status(cfgErr.status || 500).json({
        success: false,
        code: cfgErr.code || "SHIPPING_QUOTE_FAILED",
        message: cfgErr.message || "Unable to confirm delivery availability and fee.",
        ...(cfgErr.stockShortages ? { stockShortages: cfgErr.stockShortages } : {}),
      });
    }

    // Rewards are selected explicitly at checkout. Older clients that omit a choice
    // retain the prior loyalty-reward behavior.
    let loyaltyDiscount = decimalFromStoredFloat("0");
    let cardDiscount = decimalFromStoredFloat("0");
    let rewardApplied = null;
    let selectedRedemptionId = null;
    if (rewardChoice === "CARD") {
      if (!selectedCardId) {
        return res.status(400).json({ success: false, message: "Choose an Own Store card reward to apply." });
      }
      const redemption = await prisma.marketingBenefitRedemption.findFirst({
        where: { cardId: selectedCardId, customerId: userId, status: "CLAIMED" },
        include: {
          benefit: true,
          card: {
            include: {
              customerLinks: { where: { customerId: userId, status: "ACTIVE" }, take: 1 },
              campaign: true,
            },
          },
        },
      });
      const now = new Date();
      const campaign = redemption?.card?.campaign;
      const benefit = redemption?.benefit;
      if (
        !redemption ||
        !campaign?.isOwnStore ||
        redemption.card.physicalStatus === "CANCELLED" ||
        !redemption.card.customerLinks.length ||
        benefit?.status !== "ACTIVE" ||
        !["DISCOUNT", "VOUCHER"].includes(benefit.benefitType) ||
        (benefit.startsAt && benefit.startsAt > now) ||
        (benefit.expiresAt && benefit.expiresAt < now) ||
        (campaign.cardExpiresAt && campaign.cardExpiresAt < now) ||
        compareDecimals(itemsTotal, decimalFromStoredFloat(campaign.minOrderValue || 0, "Campaign minimum order value")) < 0 ||
        !campaignMatchesOrder(campaign, { address })
      ) {
        return res.status(409).json({ success: false, message: "This Own Store reward is no longer eligible for this order." });
      }
      const cardDiscountResult = calculateMarketingCardDiscount(
        benefit.benefitType,
        benefit.value,
        itemsTotal,
        benefit.maxDiscountAmount,
      );
      if (cardDiscountResult === null) {
        return res.status(409).json({ success: false, message: "This card reward has an invalid discount configuration." });
      }
      cardDiscount = decimalFromStoredFloat(cardDiscountResult, "Marketing card discount");
      selectedRedemptionId = redemption.id;
      rewardApplied = {
        source: "MARKETING_CARD",
        benefitType: benefit.benefitType,
        cardId: redemption.card.id,
        cardCode: redemption.card.cardCode,
        campaignId: campaign.id,
        benefitId: benefit.id,
        benefitName: benefit.name,
        ...(benefit.benefitType === "DISCOUNT" ? {
          discountPercentage: Number(benefit.value),
          ...(benefit.maxDiscountAmount !== null ? { maxDiscountAmount: Number(benefit.maxDiscountAmount) } : {}),
        } : {}),
        ...(benefit.benefitType === "VOUCHER" ? { voucherValue: Number(benefit.value) } : {}),
        discountAmount: Number(cardDiscount.toString()),
      };
    } else if (rewardChoice === "LOYALTY" && platformFeatures.loyaltyEnabled) {
      try {
        const loyaltyStatus = await calculateUserLoyalty(userId);
        if (loyaltyStatus?.activeReward?.isEligible) {
          const act = loyaltyStatus.activeReward;
          if (act.freeShipping) {
            expectedFee = 0;
            expectedFeeDecimal = decimalFromStoredFloat("0");
          }
          const requestedLoyaltyDiscount = decimalFromStoredFloat(act.discountAmount || 0, "Loyalty discount");
          if (requestedLoyaltyDiscount.greaterThan(0)) {
            loyaltyDiscount = compareDecimals(requestedLoyaltyDiscount, itemsTotal) > 0
              ? itemsTotal
              : requestedLoyaltyDiscount;
          }
          rewardApplied = {
            source: "LOYALTY",
            freeShipping: Boolean(act.freeShipping),
            discountAmount: Number(loyaltyDiscount.toString()),
            giftAmount: Number(act.giftAmount || 0),
            giftDescription: act.giftDescription || "",
            letterIncluded: Boolean(act.letterIncluded),
            customPerk: act.customPerk || "",
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            title: act.title || "VIP Reward",
            usage: `Use ${act.currentUseIndex} of ${act.orderLimit}`,
          };
        } else if (rewardChoice === "LOYALTY") {
          return res.status(409).json({ success: false, message: "Your loyalty reward is no longer eligible." });
        }
      } catch (loyErr) {
        console.error("Error applying loyalty reward:", loyErr);
        if (rewardChoice === "LOYALTY") {
          return res.status(500).json({ success: false, message: "Unable to verify your loyalty reward. Please retry checkout." });
        }
      }
    }

    // Price-lock: Backend authoritative fee is locked into order amount and deliveryFee
    const resolvedFee = expectedFee;
    if (expectedFeeDecimal.isZero() && resolvedFee !== 0) {
      expectedFeeDecimal = decimalFromStoredFloat(resolvedFee, "Delivery fee");
    }
    const exactDiscountTotal = addDecimals(loyaltyDiscount, cardDiscount);
    if (compareDecimals(exactDiscountTotal, itemsTotal) > 0) {
      return res.status(409).json({ success: false, message: "Applied rewards exceed the order subtotal." });
    }
    const preCommercialRoundingTotal = subtractDecimals(
      addDecimals(itemsTotal, expectedFeeDecimal),
      exactDiscountTotal,
    );
    const exactFinalAmount = roundCommercialOrderTotal(preCommercialRoundingTotal);
    const finalAmount = toLegacyFloatMirror(exactFinalAmount, "Legacy order amount");

    const orderData = {
      userId,
      items: frozenItemsSnapshot,
      amount: finalAmount,
      deliveryFee: resolvedFee,
      paymentMethod: "COD",
      payment: false,
      date: BigInt(Date.now()),
      address,
      loyaltyDiscount: toLegacyFloatMirror(loyaltyDiscount, "Legacy loyalty discount mirror"),
      manufacturerId: null,
      locationDiscountManufacturerId: null,
      locationDiscountDistributorId: null,
      locationDiscountProvince: null,
      locationDiscountDistrict: null,
      locationPricingSnapshot: null,
      specialOrder: Boolean(manufacturingPlan.specialOrder),
      specialOrderReason: manufacturingPlan.specialOrderReason,
      specialOrderManufacturerIds: manufacturingPlan.specialOrderManufacturerIds,
      rewardApplied: rewardApplied ? JSON.stringify(rewardApplied) : "{}",
    };

    const checkoutGroupId = packages.length > 1 ? randomUUID() : null;
    const packageLoyaltyDiscounts = allocateMoneyAcrossShipmentsExact(loyaltyDiscount.toString(), packages);
    const packageCardDiscounts = allocateMoneyAcrossShipmentsExact(cardDiscount.toString(), packages);
    const packageSubtotals = packages.map(({ items: shipmentItems }) =>
      addDecimals(...shipmentItems.map((item) => item._pricingDecimal.lineTotal))
    );
    const packageAmounts = packages.map((shipment, index) => {
      const shipmentFee = index === 0 ? expectedFeeDecimal : decimalFromStoredFloat("0");
      const packageDiscount = addDecimals(
        packageLoyaltyDiscounts[index],
        packageCardDiscounts[index],
      );
      const rawAmount = subtractDecimals(
        addDecimals(packageSubtotals[index], shipmentFee),
        packageDiscount,
      );
      if (rawAmount.isNegative()) {
        throw Object.assign(new Error("A shipment discount exceeds its allocated merchandise and delivery total."), {
          status: 409,
          code: "ORDER_SPLIT_OVERALLOCATION",
        });
      }
      return quantizeCurrencyAmount(rawAmount, "NPR");
    });
    const packageRoundingAdjustment = subtractDecimals(
      exactFinalAmount,
      addDecimals(...packageAmounts),
    );
    if (!packageRoundingAdjustment.isNegative()) {
      packageAmounts[0] = addDecimals(packageAmounts[0], packageRoundingAdjustment);
    } else {
      let amountToDeduct = packageRoundingAdjustment.abs();
      for (let index = 0; index < packageAmounts.length && amountToDeduct.greaterThan(0); index += 1) {
        const deduction = compareDecimals(packageAmounts[index], amountToDeduct) < 0
          ? packageAmounts[index]
          : amountToDeduct;
        packageAmounts[index] = subtractDecimals(packageAmounts[index], deduction);
        amountToDeduct = subtractDecimals(amountToDeduct, deduction);
      }
      if (amountToDeduct.greaterThan(0)) {
        throw Object.assign(new Error("The shipment allocation cannot reconcile to the accepted checkout total."), {
          status: 409,
          code: "ORDER_SPLIT_OVERALLOCATION",
        });
      }
    }
    if (!addDecimals(...packageAmounts).equals(exactFinalAmount)) {
      throw Object.assign(new Error("The shipment totals do not reconcile to the accepted checkout total."), {
        status: 409,
        code: "ORDER_SPLIT_ALLOCATION_MISMATCH",
      });
    }
    const packageOrders = await prisma.$transaction(async (tx) => {
      if (selectedRedemptionId) {
        const redeemed = await tx.marketingBenefitRedemption.updateMany({
          where: { id: selectedRedemptionId, customerId: userId, status: "CLAIMED" },
          data: { status: "REDEEMED", redeemedAt: new Date() },
        });
        if (redeemed.count !== 1) {
          const error = new Error("This card reward has already been applied to another order.");
          error.code = "MARKETING_CARD_REWARD_REDEEMED";
          error.status = 409;
          throw error;
        }
      }
      const createdOrders = [];
      for (const [index, shipment] of packages.entries()) {
        const shipmentFee = index === 0 ? expectedFeeDecimal : decimalFromStoredFloat("0");
        const shipmentLoyaltyDiscount = packageLoyaltyDiscounts[index];
        const shipmentCardDiscount = packageCardDiscounts[index];
        const shipmentDiscount = addDecimals(shipmentLoyaltyDiscount, shipmentCardDiscount);
        const shipmentPreRound = subtractDecimals(
          addDecimals(packageSubtotals[index], shipmentFee),
          shipmentDiscount,
        );
        const shipmentReward = rewardApplied
          ? {
            ...rewardApplied,
            ...(rewardApplied.discountAmount !== undefined
              ? { discountAmount: Number((shipmentCardDiscount.isZero() ? shipmentLoyaltyDiscount : shipmentCardDiscount).toString()) }
              : {}),
          }
          : null;
        const shipmentLocationItems = shipment.items.filter((item) => item.discountSource === "LOCATION");
        const shipmentHasLocationDiscount = shipmentLocationItems.length > 0;
        const locationSnapshot = shipmentHasLocationDiscount
          ? {
            province: locationPricing.location.province,
            district: locationPricing.location.district,
            distributorId: shipment.distributor?.id || null,
            items: shipmentLocationItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              originalUnitPrice: item.originalUnitPrice,
              locationDiscountPercentage: item.locationDiscountPercentage,
              purchasedUnitPrice: item.purchasedUnitPrice,
              lineTotal: item.lineTotal,
            })),
          }
          : null;
        const pricingSnapshot = createOrderPricingSnapshotV3({
          lines: shipment.items.map((item) => ({
            productId: item.productId,
            size: item.size,
            color: item.color,
            unitPrice: item._pricingDecimal.unitPrice,
            quantity: item._pricingDecimal.quantity,
            lineTotal: item._pricingDecimal.lineTotal,
            discountPercentage: item._pricingDecimal.discountPercentage,
            catalogUnitPrice: item._pricingDecimal.catalogUnitPrice,
            catalogPriceSource: item._pricingDecimal.catalogPriceSource,
            provenanceStatus: item._pricingDecimal.catalogPriceSource === "CART_COMPATIBILITY"
              ? "PARTIAL"
              : undefined,
            priceSteps: item._pricingDecimal.bundleUnitPrice
              ? [
                  {
                    source: item._pricingDecimal.discountSource,
                    sourceId: item._pricingDecimal.discountSourceId,
                    unitPriceBefore: item._pricingDecimal.catalogUnitPrice,
                    unitPriceAfter: item._pricingDecimal.preBundleUnitPrice,
                    rate: item._pricingDecimal.discountPercentage,
                  },
                  {
                    source: "BUNDLE",
                    sourceId: item._pricingDecimal.bundleDiscountSourceId,
                    unitPriceBefore: item._pricingDecimal.preBundleUnitPrice,
                    unitPriceAfter: item._pricingDecimal.unitPrice,
                    rate: item._pricingDecimal.bundleDiscountPercentage,
                  },
                ]
              : [{
                  source: item._pricingDecimal.discountSource,
                  sourceId: item._pricingDecimal.discountSourceId,
                  unitPriceBefore: item._pricingDecimal.catalogUnitPrice,
                  unitPriceAfter: item._pricingDecimal.unitPrice,
                  rate: item._pricingDecimal.discountPercentage,
                }],
          })),
          subtotal: packageSubtotals[index].toString(),
          discountTotal: shipmentDiscount.toString(),
          deliveryFee: shipmentFee.toString(),
          preCommercialRoundingTotal: shipmentPreRound.toString(),
          finalPayableTotal: packageAmounts[index].toString(),
          commercialRoundingRule: "NEAREST_NPR_5_V1",
          orderDiscountComponents: [
            ...(shipmentLoyaltyDiscount.greaterThan(0) ? [{
              source: "LOYALTY",
              amount: shipmentLoyaltyDiscount.toString(),
            }] : []),
            ...(shipmentCardDiscount.greaterThan(0) ? [{
              source: rewardApplied?.source === "MARKETING_CARD" ? "MARKETING_CARD" : "REWARD",
              sourceId: rewardApplied?.benefitId || rewardApplied?.campaignId || rewardApplied?.cardId,
              amount: shipmentCardDiscount.toString(),
              provenanceStatus: rewardApplied?.source === "MARKETING_CARD" ? "COMPLETE" : "PARTIAL",
            }] : []),
          ],
          allocationRule: packages.length > 1 ? "CHECKOUT_SPLIT_RESIDUAL_V1" : null,
          group: checkoutGroupId ? {
            checkoutGroupId,
            finalPayableTotal: exactFinalAmount.toString(),
          } : null,
          calculatedAt: new Date(Number(orderData.date)),
        });
        const shipmentLocationSnapshot = withOrderPricingSnapshot(locationSnapshot, pricingSnapshot);
        const order = await tx.order.create({
          data: {
            ...orderData,
            ...createOrderIdentity(),
            items: shipment.items,
            amount: toLegacyFloatMirror(packageAmounts[index], "Legacy order amount mirror"),
            deliveryFee: toLegacyFloatMirror(shipmentFee, "Legacy delivery fee mirror"),
            loyaltyDiscount: toLegacyFloatMirror(shipmentLoyaltyDiscount, "Legacy loyalty discount mirror"),
            rewardApplied: shipmentReward ? JSON.stringify(shipmentReward) : "{}",
            locationDiscountDistributorId: shipmentHasLocationDiscount ? shipment.distributor?.id || null : null,
            locationDiscountProvince: shipmentHasLocationDiscount ? locationPricing.location.province : null,
            locationDiscountDistrict: shipmentHasLocationDiscount ? locationPricing.location.district : null,
            locationPricingSnapshot: shipmentLocationSnapshot,
            checkoutGroupId,
          },
        });
        createdOrders.push(order);
      }
      let preferredGiftEntitlementId;
      if (rewardApplied?.source === "LOYALTY" && Number(rewardApplied.giftAmount) > 0) {
        const entitlement = await createPendingGiftEntitlement({
          client: tx,
          customerId: userId,
          sourceType: "LOYALTY",
          sourceKey: `LOYALTY_ORDER:${checkoutGroupId || createdOrders[0].id}`,
          rewardValue: rewardApplied.giftAmount,
        });
        preferredGiftEntitlementId = entitlement.id;
      }
      await bindGiftRewardsToCheckout({
        client: tx,
        customerId: userId,
        checkoutGroupId,
        orderId: createdOrders[0].id,
        preferredEntitlementId: preferredGiftEntitlementId,
      });
      return createdOrders;
    });

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

      if (cartItem.size || cartItem.color) {
        productDeductions[pId].variantDeductions.push({
          size: cartItem.size || "",
          color: cartItem.color || "",
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

    const allocations = [];
    for (const [index, order] of packageOrders.entries()) {
      allocations.push(await allocateOrderToDistributor(
        order.id,
        "STOREFRONT",
        req,
        packages[index].distributor?.id || null,
        packages[index].items.some((item) => item.discountSource === "LOCATION")
      ));
    }
    const allocation = packages.length > 1
      ? {
        status: allocations.every((entry) => entry.status === "ASSIGNED") ? "ASSIGNED" : "PENDING_ASSIGNMENT",
        shipments: packageOrders.map((order, index) => ({
          orderId: order.id,
          ...allocations[index],
        })),
      }
      : allocations[0];
    res.json({
      success: true,
      message: allocation.status === "ASSIGNED"
        ? packages.length > 1
          ? `Order placed as ${packages.length} product shipments and assigned to their distributors.`
          : "Order placed and assigned to a distributor."
        : `Order placed, but distributor assignment is pending: ${
          allocations.filter((entry) => entry.status === "PENDING_ASSIGNMENT").map((entry) => entry.message).join(" ")
        }`,
      allocation,
      orderIds: packageOrders.map((order) => order.id),
      checkoutGroupId,
      shipmentCount: packageOrders.length,
      amountDecimal: exactFinalAmount.toString(),
      deliveryFeeDecimal: expectedFeeDecimal.toString(),
      pricingSnapshotVersion: 3,
      pricingSnapshots: packageOrders.map((order) => exactPricingApiFields(order).pricingSnapshot),
    });

  } catch (error) {
    console.log(error);
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        code: error.code || "ORDER_PLACEMENT_FAILED",
        message: error.message,
      });
    }
    res.json({ success: false, message: error.message });
  }
};

// All Orders data for Admin Panel (monitor all orders - read-only context)
const allOrders = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const status = String(req.query.status || "").trim();
    const fulfillmentStatus = String(req.query.fulfillmentStatus || "").trim();
    const orderId = String(req.query.orderId || "").trim();
    const search = String(req.query.search || "").trim();
    const searchWhere = search
      ? {
          OR: [
            { id: { contains: search } },
            { orderReference: { contains: search } },
            ...["firstName", "lastName", "phone", "city"].map((field) => ({
              address: { path: [field], string_contains: search },
            })),
          ],
        }
      : {};
    const where = {
      orderType: { not: "ADMIN_DIRECT" },
      ...(orderId ? { id: orderId } : {}),
      ...(status && status !== "all" ? { status } : {}),
      ...(fulfillmentStatus && fulfillmentStatus !== "all" ? { fulfillmentStatus } : {}),
      ...(!orderId ? searchWhere : {}),
    };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { date: "desc" }],
        include: {
          assignedGift: true,
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
    const orders = (await attachDistributorAssignmentHistory(rawOrders))
      .map((item) => buildOrderListItem(item));
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
    const status = String(req.query.status || "").trim();
    const orderId = String(req.query.orderId || "").trim();
    const search = String(req.query.search || "").trim();
    const searchWhere = search
      ? {
          OR: [
            { id: { contains: search } },
            { orderReference: { contains: search } },
            ...["firstName", "lastName", "phone", "city"].map((field) => ({
              address: { path: [field], string_contains: search },
            })),
          ],
        }
      : {};
    const where = {
      orderType: "ADMIN_DIRECT",
      ...(orderId ? { id: orderId } : {}),
      ...(status && status !== "all" ? { status } : {}),
      ...(!orderId ? searchWhere : {}),
    };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { date: "desc" }],
        include: { deliveryOrder: { select: { id: true, ncmOrderId: true, state: true, ncmStatus: true, vendorReference: true, originBranchName: true, destinationBranchName: true, pickedUpAt: true, deliveredAt: true } } },
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

// User Order Data For Frontend
const userOrders = async (req, res) => {
  try {
    const { userId } = req.body;
    const pagination = getPagination(req.query);
    const where = { userId };
    const [rawOrders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { date: "desc" }],
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
          distributorReview: {
            select: {
              id: true,
              rating: true,
              comment: true,
              updatedAt: true,
              distributor: { select: { name: true } },
            },
          },
        },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.order.count({ where }),
    ]);
    const assignments = rawOrders.length
      ? await prisma.orderAssignment.findMany({
          where: { orderId: { in: rawOrders.map((item) => item.id) } },
          select: {
            orderId: true,
            distributorId: true,
            deliveryType: true,
            status: true,
            assignedAt: true,
            dispatchedAt: true,
            onTheWayAt: true,
            deliveredAt: true,
            distributor: { select: { id: true, name: true } },
          },
        })
      : [];
    const assignmentByOrderId = new Map(assignments.map((assignment) => [assignment.orderId, assignment]));
    const orders = rawOrders.map((item) => buildOrderListItem({
      ...item,
      assignedDistributorId: item.distributorId || assignmentByOrderId.get(item.id)?.distributorId || null,
      distributorDelivery: (() => {
        const assignment = assignmentByOrderId.get(item.id);
        if (!assignment || String(assignment.deliveryType || "").toUpperCase() !== "SELF_DELIVERY") return null;
        return {
          deliveryType: "SELF_DELIVERY",
          status: assignment.status,
          assignedAt: assignment.assignedAt,
          dispatchedAt: assignment.dispatchedAt,
          onTheWayAt: assignment.onTheWayAt,
          deliveredAt: assignment.deliveredAt,
          distributor: assignment.distributor,
        };
      })(),
    }));
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
    await recordDeliveredOrderCashReceipt(orderId);
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
      discount = "0",
      deliveryFee,
      deliveryType: requestedDeliveryType = client?.deliveryType || "Door2Door",
      paymentMethod = "COD",
      payment = false,
      status = "Order Placed",
    } = req.body;

    if (typeof discount !== "string" || (
      deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== "" && typeof deliveryFee !== "string"
    )) {
      return res.status(400).json({
        success: false,
        message: "Discount and custom delivery fee must be provided as decimal strings.",
        code: "INVALID_DECIMAL_INPUT",
      });
    }

    const receiptDeclarationError = directOrderReceiptRequiredError(payment);
    if (receiptDeclarationError) {
      return res.status(receiptDeclarationError.statusCode).json({
        success: false,
        message: receiptDeclarationError.message,
        code: receiptDeclarationError.code,
      });
    }

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
    if (!["Door2Door", "Door2Branch"].includes(String(requestedDeliveryType))) {
      return res.status(400).json({ success: false, message: "Choose door-to-door or door-to-hub delivery." });
    }

    const suppliedSocialCode = String(client.socialCode || "").trim();
    const customerDecision = await getAdminOrderCustomerForCreation(client.phone, suppliedSocialCode);

    const customerData = suppliedSocialCode ? customerDecision.customer : null;
    let resolvedClient = customerData
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

    const streetValidation = validateDeliveryStreet(resolvedClient.street);
    if (streetValidation.error) {
      return res.json({
        success: false,
        message: streetValidation.error,
      });
    }
    resolvedClient = {
      ...resolvedClient,
      street: streetValidation.street,
      landmark: sanitizeText(resolvedClient.landmark, { stripAllHtml: true }) || "",
    };

    if (!resolvedClient.firstName || !resolvedClient.lastName || !resolvedClient.landmark) {
      return res.json({
        success: false,
        message: "Complete the required customer and delivery details before creating the order",
      });
    }

    if (!String(resolvedClient.ncmBranch || "").trim()) {
      return res.json({
        success: false,
        message: "Select an NCM branch before creating the order",
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
      where: { id: { in: productIds }, collaborationLink: null },
    });

    // Validate stock before proceeding
    const stockValidation = validateOrderStock(items, dbProducts);
    if (!stockValidation.valid) {
      return res.json({ success: false, message: stockValidation.message });
    }

    // Freeze snapshot of items
    let itemsTotal = decimalFromStoredFloat("0");
    const frozenItemsSnapshot = items.map((cartItem) => {
      const pId = cartItem._id || cartItem.id || cartItem.productId;
      const matchedProduct = dbProducts.find((p) => p.id === pId);

      const qty = Number(wholeOrderQuantity(cartItem.quantity ?? 1).toString());
      const originalUnitPrice = matchedProduct
        ? decimalFromStoredFloat(matchedProduct.price, "Product price")
        : requirePricingDecimal(cartItem.originalUnitPrice ?? cartItem.price ?? "0", "Direct-order unit price");
      const discountPercentage = matchedProduct
        ? decimalFromStoredFloat(matchedProduct.discount || 0, "Product discount")
        : decimalFromStoredFloat(cartItem.discountPercentage || 0, "Product discount");
      const purchasedUnitPrice = discountPercentage.greaterThan(0)
        ? applyPercentagePriceDiscount(
          originalUnitPrice.toString(),
          discountPercentage.toString(),
        )
        : originalUnitPrice;
      const line = calculatePricedLine({
        unitPrice: serializeAccountingDecimal(purchasedUnitPrice),
        quantity: String(qty),
      });
      itemsTotal = addDecimals(itemsTotal, line.lineTotal);

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
        originalUnitPrice: toLegacyFloatMirror(originalUnitPrice, "Legacy product price snapshot"),
        discountPercentage: toLegacyFloatMirror(discountPercentage, "Legacy product discount snapshot"),
        purchasedUnitPrice: toLegacyFloatMirror(line.unitPrice, "Legacy accepted unit price snapshot"),
        price: toLegacyFloatMirror(line.unitPrice, "Legacy accepted unit price snapshot"),
        lineTotal: toLegacyFloatMirror(line.lineTotal, "Legacy order-item line total"),
        _pricingDecimal: {
          unitPrice: serializeAccountingDecimal(line.unitPrice),
          catalogUnitPrice: serializeAccountingDecimal(originalUnitPrice),
          catalogPriceSource: matchedProduct ? "PRODUCT_FLOAT_COMPATIBILITY" : "CART_COMPATIBILITY",
          quantity: serializeAccountingDecimal(line.quantity),
          lineTotal: serializeAccountingDecimal(line.lineTotal),
          discountPercentage: serializeAccountingDecimal(discountPercentage),
          discountSource: discountPercentage.greaterThan(0) ? "PRODUCT" : "BASE",
          discountSourceId: pId,
        },
      };
    });

    // Dynamic shipping calculation according to shipment rates (ShippingConfig)
    let expectedFee = decimalFromStoredFloat("50");
    let resolvedDeliveryType = "Door2Door";
    try {
      const customerDistrict = resolvedClient.district || resolvedClient.city || "";
      const customerProvince = getAddressProvince(resolvedClient);
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: itemsTotal.toString(),
        items: frozenItemsSnapshot,
        ncmBranch: resolvedClient.ncmBranch || resolvedClient.city || "",
        deliveryType: requestedDeliveryType,
      });
      expectedFee = decimalFromStoredFloat(shippingResult.feeDecimal ?? shippingResult.fee, "Delivery fee");
      resolvedDeliveryType = shippingResult.deliveryType || "Door2Door";
    } catch (cfgErr) {
      console.error("Error calculating shipping config in admin order:", cfgErr);
      if (requestedDeliveryType === "Door2Branch") {
        return res.status(cfgErr.status || 409).json({
          success: false,
          code: cfgErr.code || "SHIPPING_QUOTE_FAILED",
          message: cfgErr.message || "Unable to confirm door-to-hub delivery availability and fee.",
        });
      }
    }

    const hasManualDeliveryFee = deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== "";
    const manualDeliveryFee = hasManualDeliveryFee
      ? requirePricingDecimal(deliveryFee, "Delivery fee")
      : null;
    const resolvedFee = manualDeliveryFee ?? expectedFee;
    const manualDiscount = requirePricingDecimal(discount, "Direct-order discount");
    hasNoOverDiscount(manualDiscount, itemsTotal, "Direct-order discount");
    const preCommercialRoundingTotal = subtractDecimals(
      addDecimals(itemsTotal, resolvedFee),
      manualDiscount,
    );
    if (preCommercialRoundingTotal.isNegative()) {
      return res.status(400).json({ success: false, message: "Discount cannot exceed the order subtotal." });
    }
    const exactFinalAmount = quantizeCurrencyAmount(preCommercialRoundingTotal, "NPR");
    const finalAmount = toLegacyFloatMirror(exactFinalAmount, "Legacy order amount mirror");
    const pricingAcceptedAt = new Date();
    const pricingSnapshot = createOrderPricingSnapshotV3({
      lines: frozenItemsSnapshot.map((item) => ({
        productId: item.productId,
        size: item.size,
        color: item.color,
        unitPrice: item._pricingDecimal.unitPrice,
        quantity: item._pricingDecimal.quantity,
        lineTotal: item._pricingDecimal.lineTotal,
        discountPercentage: item._pricingDecimal.discountPercentage,
        catalogUnitPrice: item._pricingDecimal.catalogUnitPrice,
        catalogPriceSource: item._pricingDecimal.catalogPriceSource,
        provenanceStatus: item._pricingDecimal.catalogPriceSource === "CART_COMPATIBILITY"
          ? "PARTIAL"
          : undefined,
        priceSteps: [{
          source: item._pricingDecimal.discountSource,
          sourceId: item._pricingDecimal.discountSourceId,
          unitPriceBefore: item._pricingDecimal.catalogUnitPrice,
          unitPriceAfter: item._pricingDecimal.unitPrice,
          rate: item._pricingDecimal.discountPercentage,
        }],
      })),
      subtotal: itemsTotal.toString(),
      discountTotal: manualDiscount.toString(),
      deliveryFee: resolvedFee.toString(),
      preCommercialRoundingTotal: preCommercialRoundingTotal.toString(),
      finalPayableTotal: exactFinalAmount.toString(),
      source: "ADMIN_DIRECT",
      orderDiscountComponents: manualDiscount.greaterThan(0)
        ? [{ source: "ADMIN_MANUAL", amount: manualDiscount.toString() }]
        : [],
      calculatedAt: pricingAcceptedAt,
    });

    // A phone-matched existing account or a code-verified account may be linked.
    // Unverified matches use a unique anonymous identity to protect account history.
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
            street: resolvedClient.street,
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
      state: resolvedClient.state || resolvedClient.province || "Bagmati Province",
      zipcode: resolvedClient.zipcode || "44600",
      country: resolvedClient.country || "Nepal",
      source: resolvedClient.source || "Social Media",
      socialUsername: resolvedClient.socialUsername || "",
      socialCode: resolvedClient.socialCode || "",
      orderNotes: resolvedClient.orderNotes || "",
      deliveryInstruction: resolvedClient.deliveryInstruction || resolvedClient.orderNotes || "",
      deliveryType: resolvedDeliveryType,
      loyaltyExcluded: !customerDecision.loyaltyEligible,
      giftEligible: customerDecision.giftEligible,
    };

    const manufacturingPlan = resolveOrderManufacturingPlan(
      frozenItemsSnapshot,
      await prisma.manufacturerInventory.findMany({
        where: { productId: { in: productIds } },
      })
    );

    const newOrder = await createAdminDirectOrderWithStock({
      orderData: {
        ...createOrderIdentity(),
        userId: orderUserId,
        items: frozenItemsSnapshot,
        amount: finalAmount,
        deliveryFee: toLegacyFloatMirror(resolvedFee, "Legacy delivery fee mirror"),
        paymentMethod: paymentMethod || "COD",
        payment: Boolean(payment),
        status: status || "Order Placed",
        date: BigInt(pricingAcceptedAt.getTime()),
        address: addressSnapshot,
        loyaltyDiscount: toLegacyFloatMirror(manualDiscount, "Legacy direct-order discount mirror"),
        locationPricingSnapshot: withOrderPricingSnapshot(null, pricingSnapshot),
        manufacturerId: null,
        specialOrder: Boolean(manufacturingPlan.specialOrder),
        specialOrderReason: manufacturingPlan.specialOrderReason,
        specialOrderManufacturerIds: manufacturingPlan.specialOrderManufacturerIds,
        orderType: "ADMIN_DIRECT",
        rewardApplied: JSON.stringify({
          source: resolvedClient.source || "Social Media",
          manualDiscount: Number(manualDiscount.toString()),
          deliveryFee: Number(resolvedFee.toString()),
          adminCreated: true,
          loyaltyExcluded: !customerDecision.loyaltyEligible,
          giftEligible: customerDecision.giftEligible,
          socialCodeVerified: customerDecision.state === "VERIFIED",
          customerVerificationState: customerDecision.state,
        }),
      },
      items: frozenItemsSnapshot,
      source: resolvedClient.source || "Social Media",
    });

    const allocation = await allocateOrderToDistributor(newOrder.id, "ADMIN", req);

    res.json({
      success: true,
      message: allocation.status === "ASSIGNED"
        ? "Order created and assigned to a distributor."
        : `Order created, but distributor assignment is pending: ${allocation.message}`,
      allocation,
      orderId: newOrder.id,
      order: {
        ...newOrder,
        _id: newOrder.id,
        date: Number(newOrder.date),
        ...exactPricingApiFields(newOrder),
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
