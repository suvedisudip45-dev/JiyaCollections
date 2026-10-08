import { prisma } from "../config/db.js";
import { applyInventoryMovement, ensureInventoryLocation, normalizeSkuOption } from "../services/inventoryLedgerService.js";
import { accrueCollaborationSalesForOrder, createCollaborationSalesForOrder } from "../services/collaborationSalesService.js";
import { postDeliveredOrderAccounting } from "../services/accountingPostingEngine.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

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
      isPaid = true,
      discountAmount = 0,
      notes = "",
      applyLoyaltyDiscount = false,
    } = req.body || {};
    if (!["HUB_VISIT", "PHONE_ORDER"].includes(directOrderType)) {
      return res.status(400).json({ success: false, message: "directOrderType must be HUB_VISIT or PHONE_ORDER." });
    }
    if (!String(customerName || "").trim() || !String(customerPhone || "").trim()) {
      return res.status(400).json({ success: false, message: "Customer name and phone are required." });
    }
    const lines = normalizeOrderLines(items);
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, published: true },
      select: { id: true, name: true, image: true, category: true, subCategory: true, price: true },
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
      const unitPrice = Number(product.price) || 0;
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
        lineTotal: unitPrice * quantity,
      };
    });
    const subtotal = frozenItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const requestedDiscount = Number(discountAmount || 0);
    if (!Number.isFinite(requestedDiscount) || requestedDiscount < 0 || requestedDiscount > subtotal) {
      return res.status(400).json({ success: false, message: "Discount must be between zero and the order subtotal." });
    }

    let linkedUser = null;
    let loyaltyRewardApplied = null;
    let loyaltyDiscount = 0;
    linkedUser = await prisma.user.findFirst({ where: { phone: String(customerPhone).trim() } });
    if (linkedUser) {
      const loyaltyStatus = await calculateUserLoyalty(linkedUser.id);
      if (loyaltyStatus) {
        const reward = loyaltyStatus.activeReward;
        if (reward?.isEligible && applyLoyaltyDiscount) {
          loyaltyDiscount = Number(reward.discountAmount || 0);
          loyaltyRewardApplied = {
            applied: true,
            adminCreated: false,
            source: `Distributor Direct (${directOrderType})`,
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            discountAmount: loyaltyDiscount,
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

    const totalDiscount = Math.min(subtotal, requestedDiscount + loyaltyDiscount);
    const amount = Math.max(0, subtotal - totalDiscount);
    const isWalkIn = directOrderType === "HUB_VISIT";
    const acceptedAt = new Date();
    const distributor = await prisma.distributor.findFirst({
      where: { id: distributorId, status: "ACTIVE", isActive: true },
      select: { id: true, name: true, city: true },
    });
    if (!distributor) {
      return res.status(403).json({ success: false, message: "An active distributor profile is required." });
    }

    const order = await prisma.$transaction(async (tx) => {
      const location = await ensureInventoryLocation(tx, {
        kind: "DISTRIBUTOR",
        distributorId,
        name: `Distributor ${distributor.name}`,
      });
      const created = await tx.order.create({
        data: {
          userId: linkedUser?.id || (isWalkIn ? "GUEST_WALK_IN" : "GUEST_PHONE_ORDER"),
          items: frozenItems,
          amount,
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
          payment: Boolean(isPaid),
          date: BigInt(acceptedAt.getTime()),
          fulfillmentStatus: isWalkIn ? "delivered" : "accepted",
          orderType: "DIRECT_DISTRIBUTOR",
          directOrderType,
          distributorId,
          loyaltyDiscount,
          rewardApplied: loyaltyRewardApplied,
          directNotes: String(notes || "").trim() || (
            isWalkIn
              ? "In-person distributor hub counter sale."
              : "Direct phone order for distributor hub fulfillment."
          ),
        },
      });

      const quantitiesBySku = new Map();
      for (const item of frozenItems) {
        quantitiesBySku.set(item.inventorySkuId, (quantitiesBySku.get(item.inventorySkuId) || 0) + item.quantity);
      }
      for (const [inventorySkuId, quantity] of quantitiesBySku) {
        await applyInventoryMovement(tx, {
          inventorySkuId,
          sourceLocationId: location.id,
          quantity,
          movementType: "FULFILLMENT",
          referenceType: "DIRECT_DISTRIBUTOR_ORDER",
          referenceId: created.id,
          idempotencyKey: `distributor-direct-order:${created.id}:${inventorySkuId}`,
          actorId: req.auth.accountId,
          actorRole: "DISTRIBUTOR",
          reason: `Direct distributor hub sale (${directOrderType}).`,
        });
      }
      const productIds = new Set(frozenItems.map((item) => item.productId));
      await Promise.all([...productIds].map((id) =>
        syncProductStock(id, { client: tx, throwOnError: true })
      ));

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
      const finalized = { ...created, items: frozenItems, assignmentId: assignment.id };
      await tx.order.update({ where: { id: created.id }, data: { assignmentId: assignment.id } });
      await createCollaborationSalesForOrder({ order: created, items: frozenItems, client: tx });
      if (isWalkIn) {
        await postDeliveredOrderAccounting({ order: finalized, client: tx });
        await accrueCollaborationSalesForOrder({ orderId: created.id, deliveredAt: acceptedAt, client: tx });
      }
      return finalized;
    }, { isolationLevel: "Serializable" });

    return res.status(201).json({
      success: true,
      message: isWalkIn
        ? "Distributor hub walk-in sale completed and inventory updated."
        : "Distributor direct phone order created.",
      order: { ...order, date: Number(order.date), address: parseJSON(order.address), items: frozenItems },
      loyaltyApplied: loyaltyRewardApplied,
      loyaltyDiscountAmt: loyaltyDiscount,
    });
  } catch (error) {
    return errorResponse(res, error, "createDistributorDirectOrder");
  }
};

export const updateDistributorDirectOrderStatus = async (req, res) => {
  try {
    const { orderId, status, payment } = req.body || {};
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
      if (payment !== undefined) updateData.payment = Boolean(payment);
      const updatedOrder = await tx.order.update({ where: { id: order.id }, data: updateData });
      await tx.orderAssignment.updateMany({
        where: { orderId: order.id, distributorId: req.distributorId },
        data: { status: updateData.fulfillmentStatus || order.fulfillmentStatus },
      });
      if (normalizedStatus === "Delivered" && order.status !== "Delivered") {
        await postDeliveredOrderAccounting({ order: updatedOrder, client: tx });
        await accrueCollaborationSalesForOrder({ orderId: order.id, deliveredAt: new Date(), client: tx });
      }
      return updatedOrder;
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, message: "Direct distributor order updated.", order: updated });
  } catch (error) {
    return errorResponse(res, error, "updateDistributorDirectOrderStatus");
  }
};
