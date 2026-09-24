import { prisma } from "../config/db.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { syncProductStock } from "../services/stockSyncService.js";

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

// ─── CREATE DIRECT ORDER (HUB WALK-IN / DIRECT PHONE SALE) ────────────────────
export const createDirectOrder = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const {
      items,
      directOrderType = "HUB_VISIT", // "HUB_VISIT" | "PHONE_ORDER"
      customerName,
      customerPhone,
      customerEmail,
      street,
      city,
      paymentMethod = "CASH",
      isPaid = true,
      discountAmount = 0,
      notes = "",
      applyLoyaltyDiscount = false, // Whether to apply the customer's active loyalty reward
    } = req.body;

    if (!manufacturerId) {
      return res.json({ success: false, message: "Manufacturer authentication required." });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.json({ success: false, message: "Please select at least 1 item." });
    }

    if (!customerName || !customerPhone) {
      return res.json({ success: false, message: "Customer Name and Phone are required." });
    }

    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: manufacturerId },
    });
    if (!manufacturer) {
      return res.json({ success: false, message: "Manufacturer not found." });
    }

    // Verify and prepare items from manufacturer's inventory
    const productIds = items.map((i) => i.productId || i._id).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    const mInventories = await prisma.manufacturerInventory.findMany({
      where: { manufacturerId, productId: { in: productIds } },
    });

    const frozenItems = [];
    let itemsTotal = 0;

    for (const item of items) {
      const pId = item.productId || item._id;
      const product = dbProducts.find((p) => p.id === pId);
      if (!product) {
        return res.json({ success: false, message: `Product not found: ${item.name || pId}` });
      }

      const inv = mInventories.find((i) => i.productId === pId);
      if (!inv) {
        return res.json({
          success: false,
          message: `Product "${product.name}" is not registered in your hub inventory.`,
        });
      }

      const variantList = parseJSON(inv.variantsStock, []);
      const size = item.size || "Standard";
      const color = item.color || "Standard";
      const orderQty = Math.max(1, Number(item.quantity || 1));

      const matchedVariant = variantList.find(
        (v) => (v.size || "Standard") === size && (v.color || "Standard") === color
      );

      const availableVariantStock = matchedVariant
        ? Math.max(0, (matchedVariant.quantity || 0) - (matchedVariant.reservedQty || 0))
        : Math.max(0, (inv.quantity || 0) - (inv.reservedQty || 0));

      if (orderQty > availableVariantStock) {
        return res.json({
          success: false,
          message: `Insufficient stock for "${product.name}" (${size} / ${color}). Available: ${availableVariantStock}, Requested: ${orderQty}`,
        });
      }

      const unitPrice = Number(item.price !== undefined ? item.price : product.price);
      const lineTotal = unitPrice * orderQty;
      itemsTotal += lineTotal;

      let imgArr = [];
      if (Array.isArray(product.image)) imgArr = product.image;
      else if (typeof product.image === "string") {
        try {
          imgArr = JSON.parse(product.image);
        } catch {
          imgArr = [product.image];
        }
      }

      frozenItems.push({
        _id: product.id,
        productId: product.id,
        name: product.name,
        image: imgArr,
        category: product.category || "",
        subCategory: product.subCategory || "",
        size,
        color,
        quantity: orderQty,
        price: unitPrice,
        originalUnitPrice: Number(product.price),
        lineTotal,
      });
    }

    // ─── Loyalty Integration ──────────────────────────────────────────────
    let loyaltyRewardApplied = null;
    let loyaltyDiscountAmt = 0;

    if (customerPhone) {
      try {
        // Find user by phone number (exact match)
        const linkedUser = await prisma.user.findFirst({
          where: { phone: customerPhone.trim() },
        });
        if (linkedUser) {
          const loyaltyStatus = await calculateUserLoyalty(linkedUser.id);
          if (loyaltyStatus && loyaltyStatus.activeReward?.isEligible && applyLoyaltyDiscount) {
            const reward = loyaltyStatus.activeReward;
            loyaltyDiscountAmt = Number(reward.discountAmount || 0);
            loyaltyRewardApplied = {
              applied: true,
              adminCreated: false,
              source: `Direct Hub (${directOrderType})`,
              levelName: loyaltyStatus.currentLevel.name,
              levelIcon: loyaltyStatus.currentLevel.badgeIcon,
              discountAmount: loyaltyDiscountAmt,
              freeShipping: reward.freeShipping || false,
              giftAmount: reward.giftAmount || 0,
              giftDescription: reward.giftDescription || "",
              letterIncluded: reward.letterIncluded || false,
              customPerk: reward.customPerk || "",
              perkTags: reward.perkTags || [],
              userId: linkedUser.id,
              usageBadge: reward.usageBadge,
            };
          } else if (loyaltyStatus) {
            // Record loyalty info even if not applying discount (informational)
            loyaltyRewardApplied = {
              applied: false,
              levelName: loyaltyStatus.currentLevel.name,
              levelIcon: loyaltyStatus.currentLevel.badgeIcon,
              userId: linkedUser.id,
              isEligible: loyaltyStatus.activeReward?.isEligible || false,
            };
          }
        }
      } catch (loyErr) {
        console.error("Loyalty lookup error in direct order:", loyErr);
      }
    }

    const totalDiscount = Math.max(0, Number(discountAmount || 0)) + loyaltyDiscountAmt;
    const netAmount = Math.max(0, itemsTotal - totalDiscount);
    const isWalkIn = directOrderType === "HUB_VISIT";
    const orderStatus = isWalkIn ? "Delivered" : "Order Placed";
    const fulfillmentStatus = isWalkIn ? "delivered" : "accepted";
    const paymentStatus = Boolean(isPaid);

    const addressObject = {
      firstName: customerName.split(" ")[0] || customerName,
      lastName: customerName.split(" ").slice(1).join(" ") || "",
      name: customerName,
      phone: customerPhone,
      email: customerEmail || "",
      street:
        street ||
        (isWalkIn
          ? `In-Person Purchase @ ${manufacturer.name} Hub`
          : "Direct Phone Customer Delivery"),
      city: city || manufacturer.city,
      state: "Nepal",
      zipcode: "44600",
      country: "Nepal",
      directOrderType,
      hubName: manufacturer.name,
      hubCity: manufacturer.city,
    };

    // Create Order Record
    const order = await prisma.order.create({
      data: {
        userId: loyaltyRewardApplied?.userId || (isWalkIn ? "GUEST_WALK_IN" : "GUEST_PHONE_ORDER"),
        items: frozenItems,
        amount: netAmount,
        address: addressObject,
        status: orderStatus,
        paymentMethod,
        payment: paymentStatus,
        date: BigInt(Date.now()),
        fulfillmentStatus,
        orderType: "DIRECT_MANUFACTURER",
        directOrderType,
        manufacturerId,
        loyaltyDiscount: loyaltyDiscountAmt,
        rewardApplied: loyaltyRewardApplied ? JSON.stringify(loyaltyRewardApplied) : null,
        directNotes:
          notes ||
          (isWalkIn
            ? "In-Person Hub Counter Sale (No delivery partner needed)"
            : "Direct Phone Order (Self-Delivered by Manufacturer Hub)"),
      },
    });

    // Deduct stock from Manufacturer inventory and sync product stockQuantity
    for (const item of frozenItems) {
      const inv = await prisma.manufacturerInventory.findUnique({
        where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
      });

      if (inv) {
        const variants = parseJSON(inv.variantsStock, []);
        let updatedVariants = [];
        if (variants.length > 0) {
          updatedVariants = variants.map((v) => {
            if (
              (v.size || "Standard") === item.size &&
              (v.color || "Standard") === item.color
            ) {
              const currentQty = Math.max(0, Number(v.quantity || 0));
              return {
                ...v,
                quantity: Math.max(0, currentQty - item.quantity),
              };
            }
            return v;
          });
        } else {
          updatedVariants = [
            {
              size: item.size,
              color: item.color,
              quantity: Math.max(0, inv.quantity - item.quantity),
              reservedQty: 0,
            },
          ];
        }

        const newTotalQty = updatedVariants.reduce((sum, v) => sum + (v.quantity || 0), 0);

        await prisma.manufacturerInventory.update({
          where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
          data: {
            quantity: newTotalQty,
            variantsStock: updatedVariants,
          },
        });

        // Sync Product aggregate stock and variant quantities
        await syncProductStock(item.productId);

        // Create audit StockLog
        await prisma.stockLog.create({
          data: {
            productId: item.productId,
            productName: item.name,
            variantLabel: `${item.size} / ${item.color}`,
            previousQty: inv.quantity,
            newQty: newTotalQty,
            changeQty: -item.quantity,
            reason: `Direct Hub Sale (${directOrderType})`,
            note: `Direct sale fulfilled by ${manufacturer.name} (Order: ${order.id})`,
            orderId: order.id,
            source: "manufacturer",
          },
        });
      }
    }

    // Create OrderAssignment record (Direct self-fulfillment, no external delivery partner)
    const assignment = await prisma.orderAssignment.create({
      data: {
        orderId: order.id,
        manufacturerId,
        status: fulfillmentStatus,
        acceptedAt: new Date(),
        packedAt: isWalkIn ? new Date() : null,
        readyAt: isWalkIn ? new Date() : null,
        pickedUpAt: isWalkIn ? new Date() : null,
        notes: isWalkIn
          ? "Direct Hub Walk-in sale. Over-the-counter handoff complete. No delivery partner required."
          : "Direct Phone Order. Fulfill & self-deliver directly to customer.",
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { assignmentId: assignment.id },
    });

    if (isWalkIn) {
      await prisma.manufacturer.update({
        where: { id: manufacturerId },
        data: { totalOrdersFulfilled: { increment: 1 } },
      });
    }

    res.json({
      success: true,
      message: isWalkIn
        ? "Hub walk-in sale completed and inventory updated!"
        : "Direct phone order created! Fulfill and deliver directly to customer.",
      order: {
        ...order,
        date: Number(order.date),
        items: frozenItems,
        address: addressObject,
        assignmentId: assignment.id,
      },
      loyaltyApplied: loyaltyRewardApplied,
      loyaltyDiscountAmt,
    });
  } catch (error) {
    console.error("createDirectOrder error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── GET MY DIRECT ORDERS ─────────────────────────────────────────────────────
export const getMyDirectOrders = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const pagination = getPagination(req.query);
    const where = { manufacturerId, orderType: "DIRECT_MANUFACTURER" };

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({ where, orderBy: { date: "desc" }, skip: pagination.skip, take: pagination.limit }),
      prisma.order.count({ where }),
    ]);

    const formatted = orders.map((o) => ({
      ...o,
      items: parseJSON(o.items, []),
      address: parseJSON(o.address, {}),
      date: Number(o.date),
    }));

    res.json(paginatedResponse("orders", formatted, pagination, total));
  } catch (error) {
    console.error("getMyDirectOrders error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── UPDATE DIRECT ORDER STATUS (e.g. Dispatched / Delivered) ─────────────────
export const updateDirectOrderStatus = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const { orderId, status, payment } = req.body;

    const order = await prisma.order.findFirst({
      where: { id: orderId, manufacturerId },
    });
    if (!order) {
      return res.json({ success: false, message: "Order not found or unauthorized." });
    }

    const updateData = {};
    if (status) {
      updateData.status = status;
      updateData.fulfillmentStatus = status.toLowerCase();
    }
    if (payment !== undefined) {
      updateData.payment = Boolean(payment);
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    if (order.assignmentId && status) {
      await prisma.orderAssignment.update({
        where: { id: order.assignmentId },
        data: { status: status.toLowerCase() },
      });
    }

    if (status && status.toLowerCase() === "delivered" && order.status !== "Delivered") {
      await prisma.manufacturer.update({
        where: { id: manufacturerId },
        data: { totalOrdersFulfilled: { increment: 1 } },
      });
    }

    res.json({ success: true, message: "Order status updated successfully!", order: updated });
  } catch (error) {
    console.error("updateDirectOrderStatus error:", error);
    res.json({ success: false, message: error.message });
  }
};
