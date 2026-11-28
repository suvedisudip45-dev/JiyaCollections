import { prisma } from "../config/db.js";
import { ensureInventoryLocation, normalizeSkuOption } from "../services/inventoryLedgerService.js";
import { accrueCollaborationSalesForOrder } from "../services/collaborationSalesService.js";
import {
  postDeliveredOrderAccounting,
} from "../services/accountingPostingEngine.js";
import { consumeDistributorOrderInventory } from "../services/distributorOrderInventoryService.js";
import {
  accrueDistributorCounterSaleEarning,
  accrueDistributorDeliveryEarning,
  accrueDistributorStockTransferEarning,
} from "../services/distributorServiceEarningService.js";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { createOrderIdentity } from "../utils/orderReference.js";
import { directOrderReceiptRequiredError } from "../utils/directOrderReceiptPolicy.js";
import {
  addDecimals,

  quantizeCurrencyAmount,
  serializeAccountingDecimal,
  subtractDecimals,
} from "../services/accountingDecimal.js";
import {
  calculatePricedLine,
  createOrderPricingSnapshotV3,
  decimalFromStoredFloat,
  exactPricingApiFields,
  hasNoOverDiscount,
  requirePricingDecimal,
  toLegacyFloatMirror,
  withOrderPricingSnapshot,
} from "../services/checkoutPricingService.js";

const parseJSON = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const errorResponse = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "The distributor direct order could not be completed.",
    ...(error.code ? { code: error.code } : {}),
  });
};

const normalizeOrderLines = (items) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw Object.assign(new Error("Please select between 1 and 100 items."), { statusCode: 400 });
  }
  return items.map((item) => {
    const productId = String(item?.productId || item?._id || "").trim();
    const size = normalizeSkuOption(item?.size);
    const color = normalizeSkuOption(item?.color);
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      throw Object.assign(new Error("Each order line needs a valid product and positive whole-number quantity."), { statusCode: 400 });
    }
    return { productId, size: size.label, sizeKey: size.key, color: color.label, colorKey: color.key, quantity };
  });
};

export const getDistributorDirectOrders = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const where = { distributorId: req.distributorId, orderType: "DIRECT_DISTRIBUTOR" };
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: { date: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.order.count({ where }),
    ]);
    const formatted = orders.map((order) => ({
      ...order,
      items: parseJSON(order.items, []),
      address: parseJSON(order.address, {}),
      rewardApplied: parseJSON(order.rewardApplied, null),
      date: Number(order.date),
      ...exactPricingApiFields(order),
    }));
    return res.json(paginatedResponse("orders", formatted, pagination, total));
  } catch (error) {
    return errorResponse(res, error, "getDistributorDirectOrders");
  }
};

export const createDistributorDirectOrder = async (req, res) => {
  try {
    const distributorId = req.distributorId;
    const {
      items,
      directOrderType = "HUB_VISIT",
      customerName,
      customerPhone,
      customerEmail,
      street,
      city,
      paymentMethod = "CASH",
      isPaid = false,
      discountAmount = "0",
      notes = "",
      billingMode = "RETAIL",
      applyLoyaltyDiscount = false,
    } = req.body || {};
    if (!["RETAIL", "WHOLESALE"].includes(String(billingMode).toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "billingMode must be RETAIL or WHOLESALE.",
        code: "INVALID_BILLING_MODE",
      });
    }
    const serverBillingMode = String(billingMode).toUpperCase();
    const receiptDeclarationError = directOrderReceiptRequiredError(isPaid);
    if (receiptDeclarationError) {
      return res.status(receiptDeclarationError.statusCode).json({
        success: false,
        message: receiptDeclarationError.message,
        code: receiptDeclarationError.code,
      });
    }
    if (!["HUB_VISIT", "PHONE_ORDER"].includes(directOrderType)) {
      return res.status(400).json({ success: false, message: "directOrderType must be HUB_VISIT or PHONE_ORDER." });
    }
    if (!String(customerName || "").trim() || !String(customerPhone || "").trim()) {
      return res.status(400).json({ success: false, message: "Customer name and phone are required." });
    }
    if (typeof discountAmount !== "string") {
      return res.status(400).json({ success: false, message: "Discount must be provided as a decimal string.", code: "INVALID_DECIMAL_INPUT" });
    }
    const lines = normalizeOrderLines(items);
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, published: true, collaborationLink: null },
      select: { id: true, name: true, image: true, category: true, subCategory: true, price: true, costPrice: true },
    });
    if (products.length !== productIds.length) {
      return res.status(404).json({ success: false, message: "One or more products are unavailable for sale." });
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const skuCriteria = lines.map(({ productId, sizeKey, colorKey }) => ({ productId, sizeKey, colorKey }));
    const skus = await prisma.inventorySku.findMany({
      where: { isActive: true, OR: skuCriteria },
      select: { id: true, productId: true, size: true, color: true, sizeKey: true, colorKey: true },
    });
    const skusByVariant = new Map(skus.map((sku) => [
      JSON.stringify([sku.productId, sku.sizeKey, sku.colorKey]),
      sku,
    ]));
    const resolvedLines = lines.map((line) => {
      const sku = skusByVariant.get(JSON.stringify([line.productId, line.sizeKey, line.colorKey]));
      if (!sku) {
        throw Object.assign(
          new Error(`Inventory SKU not found for ${productsById.get(line.productId).name} (${line.size} / ${line.color}).`),
          { statusCode: 409, code: "SKU_NOT_FOUND" },
        );
      }
      return { ...line, sku, product: productsById.get(line.productId) };
    });

    let subtotal = decimalFromStoredFloat("0");
    const frozenItems = resolvedLines.map(({ product, sku, quantity }) => {
      let images = [];
      if (Array.isArray(product.image)) images = product.image;
      else if (typeof product.image === "string") {
        try {
          images = JSON.parse(product.image);
        } catch {
          images = [product.image];
        }
      }
      const line = calculatePricedLine({
        unitPrice: decimalFromStoredFloat(product.price, "Product price").toString(),
        quantity: String(quantity),
      });
      subtotal = addDecimals(subtotal, line.lineTotal);
      const unitPrice = toLegacyFloatMirror(line.unitPrice, "Legacy direct-order unit price");
      return {
        _id: product.id,
        productId: product.id,
        inventorySkuId: sku.id,
        name: product.name,
        image: images,
        category: product.category || "",
        subCategory: product.subCategory || "",
        size: sku.size,
        color: sku.color,
        quantity,
        price: unitPrice,
        originalUnitPrice: unitPrice,
        costPrice: toLegacyFloatMirror(decimalFromStoredFloat(product.costPrice, "Product cost price"), "Legacy cost-price snapshot"),
        lineTotal: toLegacyFloatMirror(line.lineTotal, "Legacy direct-order line total"),
        _pricingDecimal: {
          unitPrice: serializeAccountingDecimal(line.unitPrice),
          catalogUnitPrice: serializeAccountingDecimal(line.unitPrice),
          catalogPriceSource: "PRODUCT_FLOAT_COMPATIBILITY",
          quantity: serializeAccountingDecimal(line.quantity),
          lineTotal: serializeAccountingDecimal(line.lineTotal),
          discountSource: "BASE",
          discountSourceId: product.id,
        },
      };
    });
    const requestedDiscount = requirePricingDecimal(discountAmount, "Direct-order discount");
    hasNoOverDiscount(requestedDiscount, subtotal, "Direct-order discount");
    if (requestedDiscount.greaterThan(0)) {
      return res.status(403).json({
        success: false,
        message: "Manual distributor discounts are disabled. Product prices and promotions are controlled by Admin.",
        code: "DISTRIBUTOR_DISCOUNT_NOT_ALLOWED",
      });
    }

    let linkedUser = null;
    let loyaltyRewardApplied = null;
    let loyaltyDiscount = decimalFromStoredFloat("0");
    linkedUser = await prisma.user.findFirst({ where: { phone: String(customerPhone).trim() } });
    if (linkedUser) {
      const loyaltyStatus = await calculateUserLoyalty(linkedUser.id);
      if (loyaltyStatus) {
        const reward = loyaltyStatus.activeReward;
        if (reward?.isEligible && applyLoyaltyDiscount) {
          loyaltyDiscount = decimalFromStoredFloat(reward.discountAmount || 0, "Loyalty discount");
          loyaltyRewardApplied = {
            applied: true,
            adminCreated: false,
            source: `Distributor Direct (${directOrderType})`,
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            discountAmount: Number(loyaltyDiscount.toString()),
            freeShipping: reward.freeShipping || false,
            giftAmount: reward.giftAmount || 0,
            giftDescription: reward.giftDescription || "",
            letterIncluded: reward.letterIncluded || false,
            customPerk: reward.customPerk || "",
            perkTags: reward.perkTags || [],
            userId: linkedUser.id,
            usageBadge: reward.usageBadge,
          };
        } else {
          loyaltyRewardApplied = {
            applied: false,
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            userId: linkedUser.id,
            isEligible: reward?.isEligible || false,
          };
        }
      }
    }

    const totalDiscount = addDecimals(requestedDiscount, loyaltyDiscount);
    hasNoOverDiscount(totalDiscount, subtotal, "Combined direct-order discount");
    const netBeforeRounding = subtractDecimals(subtotal, totalDiscount);
    const amount = quantizeCurrencyAmount(netBeforeRounding, "NPR");
    const acceptedAt = new Date();
    const pricingSnapshot = createOrderPricingSnapshotV3({
      lines: frozenItems.map((item) => ({
        productId: item.productId,
        size: item.size,
        color: item.color,
        unitPrice: item._pricingDecimal.unitPrice,
        quantity: item._pricingDecimal.quantity,
        lineTotal: item._pricingDecimal.lineTotal,
        catalogUnitPrice: item._pricingDecimal.catalogUnitPrice,
        catalogPriceSource: item._pricingDecimal.catalogPriceSource,
        discountSource: item._pricingDecimal.discountSource,
        discountSourceId: item._pricingDecimal.discountSourceId,
      })),
      subtotal: subtotal.toString(),
      discountTotal: totalDiscount.toString(),
      preCommercialRoundingTotal: netBeforeRounding.toString(),
      finalPayableTotal: amount.toString(),
      source: "DISTRIBUTOR_DIRECT",
      orderDiscountComponents: [
        ...(requestedDiscount.greaterThan(0) ? [{
          source: "DISTRIBUTOR_MANUAL",
          amount: requestedDiscount.toString(),
        }] : []),
        ...(loyaltyDiscount.greaterThan(0) ? [{
          source: "LOYALTY",
          amount: loyaltyDiscount.toString(),
        }] : []),
      ],
      calculatedAt: acceptedAt,
    });
    const isWalkIn = directOrderType === "HUB_VISIT";
    const distributor = await prisma.distributor.findFirst({
      where: { id: distributorId, status: "ACTIVE", isActive: true },
      select: { id: true, name: true, city: true },
    });
    if (!distributor) {
      return res.status(403).json({ success: false, message: "An active distributor profile is required." });
    }

    const order = await prisma.$transaction(async (tx) => {
      await ensureInventoryLocation(tx, {
        kind: "DISTRIBUTOR",
        distributorId,
        name: `Distributor ${distributor.name}`,
      });
      const created = await tx.order.create({
        data: {
          ...createOrderIdentity(),
          userId: linkedUser?.id || (isWalkIn ? "GUEST_WALK_IN" : "GUEST_PHONE_ORDER"),
          items: frozenItems,
            amount: toLegacyFloatMirror(amount, "Legacy order amount mirror"),
            locationPricingSnapshot: withOrderPricingSnapshot(null, pricingSnapshot),
          address: {
            firstName: String(customerName).trim().split(/\s+/)[0],
            lastName: String(customerName).trim().split(/\s+/).slice(1).join(" "),
            phone: String(customerPhone).trim(),
            email: String(customerEmail || "").trim(),
            street: String(street || "").trim(),
            city: String(city || distributor.city || "").trim(),
            province: "",
            district: "",
          },
          status: isWalkIn ? "Delivered" : "Order Placed",
          paymentMethod,
          payment: false,
          date: BigInt(acceptedAt.getTime()),
          fulfillmentStatus: isWalkIn ? "delivered" : "accepted",
          orderType: "DIRECT_DISTRIBUTOR",
          directOrderType,
          distributorId,
          loyaltyDiscount: toLegacyFloatMirror(loyaltyDiscount, "Legacy loyalty discount mirror"),
          rewardApplied: loyaltyRewardApplied,
          directNotes: [
            `Billing mode: ${serverBillingMode}`,
            String(notes || "").trim(),
          ].filter(Boolean).join("\n") || (
            isWalkIn
              ? "In-person distributor hub counter sale."
              : "Direct phone order for distributor hub fulfillment."
          ),
        },
      });

      const assignment = await tx.orderAssignment.create({
        data: {
          orderId: created.id,
          distributorId,
          status: isWalkIn ? "DELIVERED" : "ACCEPTED",
          acceptedAt,
          packedAt: isWalkIn ? acceptedAt : null,
          readyAt: isWalkIn ? acceptedAt : null,
          pickedUpAt: isWalkIn ? acceptedAt : null,
          deliveredAt: isWalkIn ? acceptedAt : null,
          notes: isWalkIn
            ? "Distributor hub walk-in sale completed at counter."
            : "Distributor direct phone order; fulfill directly to the customer.",
        },
      });
      const inventoryConsumption = await consumeDistributorOrderInventory({
        tx,
        orderId: created.id,
        distributorId,
        assignmentId: assignment.id,
        items: frozenItems,
        directSale: true,
        actorId: req.auth.accountId,
      });
      const accountingItems = inventoryConsumption.accountingItems;
      const finalized = { ...created, items: accountingItems, assignmentId: assignment.id };
      await tx.order.update({
        where: { id: created.id },
        data: { assignmentId: assignment.id, items: accountingItems },
      });
      if (isWalkIn) {
        await postDeliveredOrderAccounting({ order: finalized, client: tx });
        await accrueCollaborationSalesForOrder({ orderId: created.id, deliveredAt: acceptedAt, client: tx });
        await accrueDistributorCounterSaleEarning({
          distributorId,
          distributorName: distributor.name,
          assignmentId: assignment.id,
          orderId: created.id,
          saleBaseAmount: subtotal.toString(),
          effectiveAt: acceptedAt,
          client: tx,
        });
        await accrueDistributorStockTransferEarning({
          distributorId,
          distributorName: distributor.name,
          assignmentId: assignment.id,
          orderId: created.id,
          items: frozenItems,
          effectiveAt: acceptedAt,
          client: tx,
        });
      }
      return finalized;
    }, { isolationLevel: "Serializable" });

    return res.status(201).json({
      success: true,
      message: isWalkIn
        ? "Distributor hub walk-in sale completed and inventory updated."
        : "Distributor direct phone order created.",
      order: {
        ...order,
        date: Number(order.date),
        address: parseJSON(order.address),
        items: order.items,
        ...exactPricingApiFields(order),
      },
      loyaltyApplied: loyaltyRewardApplied,
      loyaltyDiscountAmt: Number(loyaltyDiscount.toString()),
    });
  } catch (error) {
    return errorResponse(res, error, "createDistributorDirectOrder");
  }
};

export const updateDistributorDirectOrderStatus = async (req, res) => {
  try {
    const { orderId, status, payment } = req.body || {};
    const receiptDeclarationError = directOrderReceiptRequiredError(payment);
    if (receiptDeclarationError) {
      return res.status(receiptDeclarationError.statusCode).json({
        success: false,
        message: receiptDeclarationError.message,
        code: receiptDeclarationError.code,
      });
    }
    const nextStatus = String(status || "").trim();
    const allowedStatuses = new Map([
      ["order placed", "Order Placed"],
      ["dispatched", "Dispatched"],
      ["on the way", "On the Way"],
      ["delivered", "Delivered"],
      ["cancelled", "Cancelled"],
    ]);
    const normalizedStatus = nextStatus ? allowedStatuses.get(nextStatus.toLowerCase()) : null;
    if (status && !normalizedStatus) {
      return res.status(400).json({ success: false, message: "Select a valid direct order status." });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, distributorId: req.distributorId, orderType: "DIRECT_DISTRIBUTOR" },
      });
      if (!order) throw Object.assign(new Error("Order not found or unauthorized."), { statusCode: 404 });
      const updateData = {};
      if (normalizedStatus) {
        updateData.status = normalizedStatus;
        updateData.fulfillmentStatus = normalizedStatus.toLowerCase().replaceAll(" ", "_");
      }
      const updatedOrder = await tx.order.update({ where: { id: order.id }, data: updateData });
      await tx.orderAssignment.updateMany({
        where: { orderId: order.id, distributorId: req.distributorId },
        data: { status: updateData.fulfillmentStatus || order.fulfillmentStatus },
      });
      if (normalizedStatus === "Delivered" && order.status !== "Delivered") {
        await postDeliveredOrderAccounting({ order: updatedOrder, client: tx });
        await accrueCollaborationSalesForOrder({ orderId: order.id, deliveredAt: new Date(), client: tx });
        if (order.directOrderType === "PHONE_ORDER") {
          const [assignment, distributor] = await Promise.all([
            tx.orderAssignment.findFirst({
              where: { orderId: order.id, distributorId: req.distributorId },
            }),
            tx.distributor.findUnique({
              where: { id: req.distributorId },
              select: { name: true },
            }),
          ]);
          if (assignment && distributor) {
            await accrueDistributorDeliveryEarning({
              distributorId: req.distributorId,
              distributorName: distributor.name,
              assignmentId: assignment.id,
              orderId: order.id,
              effectiveAt: new Date(),
              client: tx,
            });
            await accrueDistributorStockTransferEarning({
              distributorId: req.distributorId,
              distributorName: distributor.name,
              assignmentId: assignment.id,
              orderId: order.id,
              items: updatedOrder.items,
              effectiveAt: new Date(),
              client: tx,
            });
          }
        }
      }
      return updatedOrder;
    }, { isolationLevel: "Serializable" });
    return res.json({
      success: true,
      message: "Direct distributor order updated.",
      order: { ...updated, ...exactPricingApiFields(updated) },
    });
  } catch (error) {
    return errorResponse(res, error, "updateDistributorDirectOrderStatus");
  }
};
