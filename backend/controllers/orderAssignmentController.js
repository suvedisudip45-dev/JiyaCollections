import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { validateFulfillmentTransition, parseNotes } from "../services/fulfillmentStateMachine.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { ensureOrderCardAttached } from "../services/marketingCardService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { createManufacturerCostSnapshot } from "../services/manufacturerCostSnapshot.js";
import { onOrderPacked } from "../services/giftService.js";
import { assignGiftToOrder, getManufacturerGiftOptions } from "../services/giftService.js";
import { allocateProductionLayersForOrderItem } from "../services/manufacturerProductionService.js";
import { canonicalizeNepalLocation } from "../services/locationPricingService.js";

// Helper: Safely parse JSON
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

const auditActorContext = (req, fallbackRole = "MANUFACTURER") => ({
  actorId: req.auth?.accountId || null,
  actorRole: req.auth?.role || fallbackRole,
  portalSource: req.auth?.role || fallbackRole,
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

export const canAdminReassignAssignment = ({ status, hasDeliveryOrder = false } = {}) => {
  const normalized = String(status || "").toLowerCase();

  if (hasDeliveryOrder) return false;

  const lockedStatuses = new Set([
    "accepted",
    "preparing",
    "quality_check",
    "packed",
    "ready_for_pickup",
    "picked_up",
    "out_for_delivery",
    "in_transit",
    "arrived_at_destination",
    "delivered",
    "return_requested",
  ]);

  if (lockedStatuses.has(normalized)) return false;

  return ["assigned", "pending_acceptance", "pending_assignment", "rejected"].includes(normalized) || normalized === "";
};

export const canManufacturerRejectAssignment = ({ status, hasDeliveryOrder = false } = {}) => {
  const normalized = String(status || "").toLowerCase();

  if (hasDeliveryOrder) return false;
  if (["accepted", "preparing", "quality_check", "packed", "ready_for_pickup", "picked_up", "out_for_delivery", "in_transit", "arrived_at_destination", "delivered", "return_requested"].includes(normalized)) {
    return false;
  }

  return ["assigned", "pending_acceptance", "pending_assignment"].includes(normalized) || normalized === "";
};

const buildFulfillmentBenefits = (order, items = []) => {
  const reward = parseJSON(order?.rewardApplied, {}) || {};
  const productDiscount = items.reduce((total, item) => {
    const original = Number(item.originalUnitPrice || 0);
    const purchased = Number(item.purchasedUnitPrice ?? item.price ?? 0);
    return total + Math.max(0, (original - purchased) * Number(item.quantity || 1));
  }, 0);
  const loyaltyDiscount = Number(order?.loyaltyDiscount || reward.discountAmount || 0);
  const offerItems = items
    .filter((item) => Number(item.discountPercentage || 0) > 0 || item.offerTag || item.offerTitle)
    .map((item) => ({
      name: item.name,
      discountPercentage: Number(item.discountPercentage || 0),
      offerTag: item.offerTag || item.offerTitle || "Product offer",
      quantity: Number(item.quantity || 1),
    }));

  return {
    loyaltyTier: reward.levelName || "Standard customer",
    rewardTitle: reward.title || "",
    rewardDescription: reward.description || "",
    rewardUsage: reward.usage || reward.usageBadge || "",
    loyaltyDiscount,
    productDiscount: Number(productDiscount.toFixed(2)),
    totalDiscount: Number((loyaltyDiscount + productDiscount).toFixed(2)),
    freeShipping: Boolean(reward.freeShipping),
    giftAmount: Number(reward.giftAmount || 0),
    giftDescription: order?.assignedGift?.name || reward.giftDescription || "",
    assignedGift: order?.assignedGift ? {
      id: order.assignedGift.id,
      name: order.assignedGift.name,
      sku: order.assignedGift.sku,
      priceValue: Number(order.assignedGift.priceValue || 0),
      status: order.giftStatus,
    } : null,
    handwrittenCard: Boolean(reward.letterIncluded),
    customPerk: reward.customPerk || "",
    offerItems,
    packingInstructions: [
      reward.letterIncluded ? "Include a handwritten thank-you card." : "",
      reward.giftDescription ? `Include gift: ${reward.giftDescription}.` : "",
      reward.customPerk || "",
    ].filter(Boolean),
  };
};

// ─── NEPAL CITY PROXIMITY MAP ─────────────────────────────────────────────────
const CITY_PROXIMITY = {
  kathmandu: ["lalitpur", "bhaktapur", "kirtipur", "madhyapur thimi", "budhanilkantha", "banepa", "dhulikhel"],
  lalitpur: ["kathmandu", "bhaktapur", "kirtipur", "madhyapur thimi", "godawari"],
  bhaktapur: ["kathmandu", "lalitpur", "madhyapur thimi", "banepa", "dhulikhel"],
  pokhara: ["lekhnath", "prithvichowk", "birauta", "syangja", "damauli", "kaski"],
  lekhnath: ["pokhara", "damauli"],
  biratnagar: ["itahari", "inaruwa", "dharan", "damak", "belbari", "urlabari"],
  itahari: ["biratnagar", "dharan", "damak", "inaruwa"],
  dharan: ["itahari", "biratnagar", "damak"],
  butwal: ["bhairahawa", "siddharthanagar", "palpa", "sunwal", "tilottama"],
  bhairahawa: ["butwal", "siddharthanagar", "sunwal"],
  siddharthanagar: ["bhairahawa", "butwal"],
  birgunj: ["parwanipur", "simara", "hetauda", "kalaiya"],
  hetauda: ["birgunj", "makwanpur", "chitwan", "bharatpur"],
  chitwan: ["bharatpur", "hetauda", "nawalpur", "ratnanagar"],
  bharatpur: ["chitwan", "hetauda", "ratnanagar", "gaindakot"],
  nepalgunj: ["kohalpur", "banke", "surkhet"],
  dhangadhi: ["attariya", "tikapur", "mahendranagar", "kailali"],
  janakpur: ["dhanusa", "bardibas", "jaleshwor", "mahottari"],
};

const normalize = (city) => (city || "").toLowerCase().trim();
const normalizeSkuKey = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();

const distributorHasStock = (distributor, requirements) => requirements.every((requirement) => {
  const available = (distributor.stockLocations || [])
    .flatMap((location) => location.balances || [])
    .filter((balance) =>
      balance.inventorySku?.productId === requirement.productId &&
      normalizeSkuKey(balance.inventorySku?.sizeKey || balance.inventorySku?.size) === normalizeSkuKey(requirement.size) &&
      normalizeSkuKey(balance.inventorySku?.colorKey || balance.inventorySku?.color) === normalizeSkuKey(requirement.color)
    )
    .reduce((total, balance) => total + Math.max(0, balance.quantityOnHand - balance.reservedQuantity), 0);
  return available >= requirement.qty;
});

export const runAllocationEngine = async (orderId, actorContext = {}) => {
  const actor = {
    actorId: null,
    actorRole: "SYSTEM",
    portalSource: "SYSTEM",
    ipAddress: null,
    userAgent: null,
    correlationId: null,
    ...actorContext,
  };

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: "Order not found." };
    if (String(order.status || "").toLowerCase() === "cancelled") {
      return { success: false, message: "Cancelled orders cannot be assigned to a distributor." };
    }
    if (order.assignmentId) return { success: false, message: "Order already assigned." };

    const address = parseJSON(order.address, {});
    const location = canonicalizeNepalLocation(address.province || address.state, address.district || address.city);
    if (!location) {
      return { success: false, message: "A valid customer province and district are required for distributor hub allocation." };
    }
    const lineItems = parseJSON(order.items, []).map((item) => ({
      productId: String(item.productId || item._id || item.id || ""),
      size: String(item.size || "Standard"),
      color: String(item.color || "Standard"),
      qty: Number(item.quantity ?? 1),
    }));
    if (!lineItems.length || lineItems.some((item) => !item.productId || !Number.isSafeInteger(item.qty) || item.qty < 1)) {
      return { success: false, message: "Order items are invalid for distributor allocation." };
    }
    const requirementsBySku = new Map();
    for (const item of lineItems) {
      const key = [item.productId, normalizeSkuKey(item.size), normalizeSkuKey(item.color)].join("\0");
      const existing = requirementsBySku.get(key);
      if (existing) existing.qty += item.qty;
      else requirementsBySku.set(key, { ...item });
    }
    const requirements = [...requirementsBySku.values()];
    const productIds = [...new Set(requirements.map((item) => item.productId))];
    const locations = await prisma.distributorLocation.findMany({
      where: {
        province: location.province,
        district: location.district,
        isActive: true,
        distributor: { status: "ACTIVE", isActive: true },
      },
      include: {
        distributor: {
          include: {
            stockLocations: {
              where: { kind: "DISTRIBUTOR", isActive: true },
              include: {
                balances: {
                  where: { inventorySku: { productId: { in: productIds }, isActive: true } },
                  include: { inventorySku: true },
                },
              },
            },
          },
        },
      },
    });
    const candidateMap = new Map(locations.map(({ distributor }) => [distributor.id, distributor]));
    const customerCity = normalize(address.city || address.district);
    const nearbyCities = CITY_PROXIMITY[customerCity] || [];
    const candidates = [...candidateMap.values()]
      .filter((distributor) => distributorHasStock(distributor, requirements))
      .sort((left, right) => {
        const score = (distributor) => {
          const city = normalize(distributor.city);
          return city === customerCity && city ? 2 : nearbyCities.includes(city) ? 1 : 0;
        };
        return score(right) - score(left) || left.id.localeCompare(right.id);
      });
    const selected = candidates[0];
    if (!selected) {
      return { success: false, message: "No approved distributor covering this district has all requested variants in stock." };
    }

    const assignment = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, assignmentId: null, status: { not: "Cancelled" } },
        data: { fulfillmentStatus: "assigned", manufacturerId: null },
      });
      if (claimed.count !== 1) throw new Error("Order was cancelled or assigned before allocation completed.");

      for (const requirement of requirements) {
        let remaining = requirement.qty;
        const balances = await tx.inventoryBalance.findMany({
          where: {
            location: { distributorId: selected.id, kind: "DISTRIBUTOR", isActive: true },
            inventorySku: {
              productId: requirement.productId,
              isActive: true,
              sizeKey: normalizeSkuKey(requirement.size),
              colorKey: normalizeSkuKey(requirement.color),
            },
          },
          orderBy: { id: "asc" },
        });
        for (const balance of balances) {
          const available = Math.max(0, balance.quantityOnHand - balance.reservedQuantity);
          const reserveQuantity = Math.min(remaining, available);
          if (!reserveQuantity) continue;
          const updated = await tx.inventoryBalance.updateMany({
            where: {
              id: balance.id,
              reservedQuantity: balance.reservedQuantity,
              quantityOnHand: { gte: balance.reservedQuantity + reserveQuantity },
            },
            data: { reservedQuantity: { increment: reserveQuantity } },
          });
          if (updated.count !== 1) {
            throw Object.assign(new Error("Distributor stock changed during allocation. Retry the assignment."), {
              code: "DISTRIBUTOR_STOCK_CHANGED",
              statusCode: 409,
            });
          }
          remaining -= reserveQuantity;
          if (!remaining) break;
        }
        if (remaining) {
          throw Object.assign(new Error("Distributor stock changed during allocation. Retry the assignment."), {
            code: "DISTRIBUTOR_STOCK_CHANGED",
            statusCode: 409,
          });
        }
      }

      const createdAssignment = await tx.orderAssignment.create({
        data: {
          orderId,
          distributorId: selected.id,
          status: "assigned",
          notes: `Auto-allocated to ${selected.name} for ${location.district}; all requested variants were in stock.`,
        },
      });
      await tx.order.update({ where: { id: orderId }, data: { assignmentId: createdAssignment.id } });
      await recordSystemAudit(actor, {
        action: "ORDER_AUTO_ASSIGNED",
        entityType: "Order",
        entityId: orderId,
        beforeState: { fulfillmentStatus: order.fulfillmentStatus, assignmentId: order.assignmentId },
        afterState: {
          fulfillmentStatus: "assigned",
          distributorId: selected.id,
          assignmentId: createdAssignment.id,
          allocationMode: "distributor_hub",
        },
      }, { client: tx });
      return createdAssignment;
    }, { isolationLevel: "Serializable" });

    return { success: true, assignment, distributor: selected };
  } catch (error) {
    console.error("runAllocationEngine error:", error);
    return { success: false, message: error.message, ...(error.code ? { code: error.code } : {}) };
  }
};

// ─── ADMIN / INTERNAL: TRIGGER ASSIGN ────────────────────────────────────────
const assignOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.json({ success: false, message: "orderId required" });

    const result = await runAllocationEngine(orderId, auditActorContext(req, "ADMIN"));
    if (result.success) {
      res.json({
        success: true,
        message: "Order successfully allocated to a distributor covering the customer location.",
        assignment: result.assignment,
        distributor: result.distributor?.name,
      });
    } else {
      res.json({ success: false, message: result.message });
    }
  } catch (error) {
    console.error("assignOrder error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── WORKSPACE: GET MY CUSTOMER-ORDER ASSIGNMENTS ────────────────────────────
const getMyAssignments = async (req, res) => {
  try {
    const distributorId = req.distributorId;
    const manufacturerId = distributorId ? null : (req.manufacturerId || req.body?.manufacturerId);
    if (!distributorId && !manufacturerId) {
      return res.status(403).json({ success: false, message: "No active assignment workspace is available." });
    }
    const { status } = req.query;
    const pagination = getPagination(req.query);

    const where = distributorId ? { distributorId } : { manufacturerId };
    if (status && status !== "all") where.status = status;

    const [assignments, total] = await prisma.$transaction([
      prisma.orderAssignment.findMany({
        where,
        orderBy: { assignedAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          manufacturer: {
            select: { id: true, name: true, city: true, phone: true, qualityRating: true },
          },
          distributor: {
            select: { id: true, name: true, city: true, phone: true },
          },
        },
      }),
      prisma.orderAssignment.count({ where }),
    ]);

    const orderIds = assignments.map((a) => a.orderId);
    const [orders, deliveryOrders] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { assignedGift: true },
      }),
      prisma.deliveryOrder.findMany({
        where: { orderId: { in: orderIds } },
        include: {
          events: {
            orderBy: { occurredAt: "desc" },
            take: 10,
            select: {
              id: true,
              eventType: true,
              fromState: true,
              toState: true,
              ncmStatus: true,
              occurredAt: true,
              payloadJson: true,
            },
          },
        },
      }),
    ]);

    const deliveryIds = deliveryOrders.map((delivery) => delivery.id);
    const ncmAttempts = deliveryIds.length
      ? await prisma.ncmRequestAttempt.findMany({
          where: { deliveryOrderId: { in: deliveryIds }, operation: "CREATE_ORDER" },
          orderBy: { attemptNumber: "desc" },
          select: { deliveryOrderId: true, attemptNumber: true, result: true, errorCode: true, errorMessage: true, startedAt: true, finishedAt: true },
        })
      : [];
    const ncmAttemptsByDelivery = {};
    ncmAttempts.forEach((attempt) => {
      (ncmAttemptsByDelivery[attempt.deliveryOrderId] ||= []).push(attempt);
    });
    const deliveryComments = deliveryIds.length
      ? await prisma.deliveryComment.findMany({
          where: { deliveryOrderId: { in: deliveryIds } },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [];
    const commentsMap = {};
    deliveryComments.forEach((comment) => {
      (commentsMap[comment.deliveryOrderId] ||= []).push(comment);
    });

    const orderMap = {};
    orders.forEach((o) => {
      const items = parseJSON(o.items, []);
      const address = parseJSON(o.address, {});
      orderMap[o.id] = {
        ...o,
        items,
        address,
        date: Number(o.date),
        fulfillmentBenefits: buildFulfillmentBenefits(o, items),
      };
    });

    const deliveryMap = {};
    deliveryOrders.forEach((d) => {
      deliveryMap[d.orderId] = {
        ...d,
        ncmRequestAttempts: ncmAttemptsByDelivery[d.id] || [],
      };
    });

    const enriched = assignments.map((a) => ({
      ...a,
      manufacturer: a.manufacturer ? { ...a.manufacturer, businessName: a.manufacturer.name } : null,
      distributor: a.distributor || null,
      order: orderMap[a.orderId] || null,
      delivery: deliveryMap[a.orderId]
        ? { ...deliveryMap[a.orderId], comments: commentsMap[deliveryMap[a.orderId].id] || [] }
        : null,
      createdAt: a.assignedAt,
    }));

    res.json(paginatedResponse("assignments", enriched, pagination, total));
  } catch (error) {
    console.error("getMyAssignments error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── FULFILLMENT HUB: ACCEPT ORDER ───────────────────────────────────────────────
const acceptOrder = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.body?.distributorId;
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const assignmentId = req.params?.id || req.body?.assignmentId || req.body?.id;

    const acceptedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const assignment = await tx.orderAssignment.findUnique({ where: { id: assignmentId } });
      const isOwner =
        (distributorId && assignment?.distributorId === distributorId) ||
        (manufacturerId && assignment?.manufacturerId === manufacturerId) ||
        req.adminId;

      if (!assignment || !isOwner) {
        const error = new Error("Assignment not found");
        error.statusCode = 404;
        throw error;
      }

      const deliveryExists = await tx.deliveryOrder.findUnique({ where: { orderId: assignment.orderId } });
      if (deliveryExists || !canAdminReassignAssignment({ status: assignment.status, hasDeliveryOrder: Boolean(deliveryExists) })) {
        const error = new Error("This order is already in fulfillment or has moved to delivery handoff and cannot be re-routed.");
        error.statusCode = 409;
        throw error;
      }

      const order = await tx.order.findUnique({ where: { id: assignment.orderId } });
      if (!order) {
        const error = new Error("Assigned order not found");
        error.statusCode = 404;
        throw error;
      }

      const items = parseJSON(order.items, []);
      let acceptedItems = items;

      if (manufacturerId && !distributorId) {
        const productIds = [...new Set(items.map((item) => item.productId || item._id || item.id).filter(Boolean))];
        const inventoryRows = await tx.manufacturerInventory.findMany({
          where: { manufacturerId, productId: { in: productIds } },
        });
        const costSnapshottedItems = createManufacturerCostSnapshot({ items, inventoryRows, acceptedAt });
        acceptedItems = [];
        for (let index = 0; index < costSnapshottedItems.length; index += 1) {
          const item = costSnapshottedItems[index];
          const productionAllocation = await allocateProductionLayersForOrderItem({
            tx,
            orderId: order.id,
            itemIndex: index,
            manufacturerId,
            item,
          });
          acceptedItems.push({
            ...item,
            legacyUnitCogsVatInclusiveAtAcceptance: item.agreedUnitCogsVatInclusiveAtAcceptance,
            ...productionAllocation,
          });
        }
      }

      const claimed = await tx.orderAssignment.updateMany({
        where: { id: assignmentId, status: assignment.status },
        data: { status: "accepted", acceptedAt },
      });
      if (claimed.count !== 1) {
        const error = new Error("Assignment changed while it was being accepted. Refresh and try again.");
        error.statusCode = 409;
        throw error;
      }

      await tx.order.update({
        where: { id: assignment.orderId },
        data: { items: acceptedItems, fulfillmentStatus: "accepted", status: "In Production" },
      });
      await recordSystemAudit(auditActorContext(req, distributorId ? "DISTRIBUTOR" : "MANUFACTURER"), {
        action: "ORDER_ACCEPTED_FOR_FULFILLMENT",
        entityType: "Order",
        entityId: assignment.orderId,
        beforeState: {
          fulfillmentStatus: order.fulfillmentStatus,
          status: order.status,
        },
        afterState: {
          fulfillmentStatus: "accepted",
          status: "In Production",
        },
      }, { client: tx });
    });

    res.json({ success: true, message: "Order accepted for fulfillment!" });
  } catch (error) {
    console.error("acceptOrder error:", error);
    res.status(error.statusCode || 400).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
};

// ─── FULFILLMENT HUB: REJECT ORDER ───────────────────────────────────────────────
const rejectOrder = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.body?.distributorId;
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const assignmentId = req.params?.id || req.body?.assignmentId || req.body?.id;
    const reason = req.body?.reason || req.body?.rejectionReason;

    const assignment = await prisma.orderAssignment.findUnique({ where: { id: assignmentId } });
    const isOwner =
      (distributorId && assignment?.distributorId === distributorId) ||
      (manufacturerId && assignment?.manufacturerId === manufacturerId) ||
      req.adminId;

    if (!assignment || !isOwner)
      return res.json({ success: false, message: "Assignment not found" });

    const deliveryExists = await prisma.deliveryOrder.findUnique({ where: { orderId: assignment.orderId } });
    if (!canManufacturerRejectAssignment({ status: assignment.status, hasDeliveryOrder: Boolean(deliveryExists) })) {
      return res.status(409).json({
        success: false,
        message: "This order is already accepted or already assigned to a delivery partner. Only the admin can reassign it.",
      });
    }

    await prisma.$transaction(async (tx) => {
      const orderBefore = await tx.order.findUnique({
        where: { id: assignment.orderId },
        select: { fulfillmentStatus: true, status: true },
      });
      if (manufacturerId) {
        await tx.manufacturer.update({
          where: { id: manufacturerId },
          data: { rejectionCount: { increment: 1 } },
        }).catch(() => null);
      }
      await tx.orderAssignment.update({
        where: { id: assignmentId },
        data: { status: "rejected", rejectionReason: reason || "No capacity" },
      });
      await tx.order.update({
        where: { id: assignment.orderId },
        data: { fulfillmentStatus: "rejected", status: "Rejected by Hub" },
      });
      await recordSystemAudit(auditActorContext(req, distributorId ? "DISTRIBUTOR" : "MANUFACTURER"), {
        action: "ORDER_REJECTED_BY_HUB",
        entityType: "Order",
        entityId: assignment.orderId,
        beforeState: {
          fulfillmentStatus: orderBefore?.fulfillmentStatus || null,
          status: orderBefore?.status || null,
        },
        afterState: {
          fulfillmentStatus: "rejected",
          status: "Rejected by Hub",
        },
      }, { client: tx });
    });

    res.json({ success: true, message: "Order rejected. Admin or allocation engine will reassign this order." });
  } catch (error) {
    console.error("rejectOrder error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── FULFILLMENT HUB: UPDATE ASSIGNMENT STATUS ───────────────────────────────────
const updateAssignmentStatus = async (req, res) => {
  try {
    const distributorId = req.distributorId || req.body?.distributorId;
    const manufacturerId = req.manufacturerId || req.body?.manufacturerId;
    const assignmentId = req.params?.id || req.body?.assignmentId || req.body?.id;
    const {
      status,
      packagingNotes,
      packageWeight,
      packageDimensions,
      productType,
      productDescription,
      packageType,
      isFragile,
      deliveryInstruction,
      instruction,
      packagingChecklist,
      giftInventoryId,
    } = req.body;

    const normalizedStatus = String(status || "").toLowerCase();
    const allowedStatuses = new Set(["assigned", "accepted", "preparing", "quality_check", "letter_ready", "checklist_complete", "packed", "package_details_complete"]);
    if (!allowedStatuses.has(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Carrier delivery states are controlled by the NCM integration. Use the dedicated ready-for-delivery action for handoff.",
      });
    }

    const assignment = await prisma.orderAssignment.findUnique({ where: { id: assignmentId } });
    const isOwner =
      (distributorId && assignment?.distributorId === distributorId) ||
      (manufacturerId && assignment?.manufacturerId === manufacturerId) ||
      req.adminId;

    if (!assignment || !isOwner)
      return res.json({ success: false, message: "Assignment not found" });

    if (giftInventoryId && normalizedStatus !== "checklist_complete") {
      return res.status(400).json({ success: false, message: "Select a gift while completing the final packing checklist." });
    }
    if (normalizedStatus === "checklist_complete") {
      const giftOptions = await getManufacturerGiftOptions({ orderId: assignment.orderId, manufacturerId });
      if (giftOptions.eligible && !giftOptions.alreadyAssigned && giftOptions.options.length > 0 && !giftInventoryId) {
        return res.status(409).json({
          success: false,
          message: "This order has an active gift reward. Select one of the accepted gifts available at your hub before completing the checklist.",
          code: "GIFT_SELECTION_REQUIRED",
        });
      }
    }

    if (["checklist_complete", "packed", "package_details_complete"].includes(normalizedStatus)) {
      try {
        await ensureOrderCardAttached({ orderId: assignment.orderId, manufacturerId });
      } catch (error) {
        return res.status(error.code === "MARKETING_CARD_REQUIRED" ? 409 : 400).json({
          success: false,
          message: error.message,
          code: error.code || "MARKETING_CARD_VALIDATION_FAILED",
        });
      }
    }

    const lockedStatuses = new Set(["ready_for_pickup", "picked_up", "in_transit", "delivered", "return_requested"]);
    if (lockedStatuses.has(String(assignment.status || "").toLowerCase()) && (status !== undefined || packagingNotes !== undefined || packageWeight !== undefined || packageDimensions !== undefined || productType !== undefined || productDescription !== undefined || packageType !== undefined || isFragile !== undefined || deliveryInstruction !== undefined || instruction !== undefined || packagingChecklist !== undefined)) {
      return res.status(409).json({
        success: false,
        message: "This order is already ready for dispatch. Packaging details are locked and cannot be changed after handoff.",
      });
    }

    const existingNotes = parseNotes(assignment.notes);

    const updateData = { status: normalizedStatus };
    const payload = {
      ...existingNotes,
      stitchingBrandingCompleted: req.body.stitchingBrandingCompleted !== undefined
        ? Boolean(req.body.stitchingBrandingCompleted)
        : existingNotes.stitchingBrandingCompleted,
      packageWeight: packageWeight !== undefined ? packageWeight : existingNotes.packageWeight,
      packageDimensions: packageDimensions !== undefined ? packageDimensions : existingNotes.packageDimensions,
      packagingNotes: packagingNotes !== undefined ? packagingNotes : existingNotes.packagingNotes,
      productType: productType !== undefined ? productType : existingNotes.productType,
      productDescription: productDescription !== undefined ? productDescription : existingNotes.productDescription,
      packageType: packageType !== undefined ? packageType : existingNotes.packageType,
      isFragile: isFragile !== undefined ? isFragile : existingNotes.isFragile,
      deliveryInstruction: deliveryInstruction !== undefined ? deliveryInstruction : (instruction !== undefined ? instruction : existingNotes.deliveryInstruction),
      packagingChecklist: packagingChecklist !== undefined ? packagingChecklist : existingNotes.packagingChecklist,
    };
    const transition = validateFulfillmentTransition({
      currentStatus: assignment.status === "PENDING_ACCEPTANCE" ? "assigned" : assignment.status,
      nextStatus: normalizedStatus,
      notes: assignment.notes,
      packageData: payload,
    });
    if (!transition.valid) {
      return res.status(409).json({ success: false, message: transition.message });
    }
    if (Object.keys(payload).some((key) => payload[key] !== undefined)) {
      updateData.notes = JSON.stringify(payload);
    }

    await prisma.$transaction(async (tx) => {
      const orderBefore = await tx.order.findUnique({
        where: { id: assignment.orderId },
        select: { fulfillmentStatus: true },
      });
      if (giftInventoryId) {
        await assignGiftToOrder({
          orderId: assignment.orderId,
          manufacturerId,
          inventoryId: giftInventoryId,
          client: tx,
        });
      }
      await tx.orderAssignment.update({ where: { id: assignmentId }, data: updateData });
      await tx.order.update({
        where: { id: assignment.orderId },
        data: { fulfillmentStatus: normalizedStatus },
      });
      await recordSystemAudit(auditActorContext(req), {
        action: "ORDER_FULFILLMENT_STATUS_UPDATED",
        entityType: "Order",
        entityId: assignment.orderId,
        beforeState: { fulfillmentStatus: orderBefore?.fulfillmentStatus || null },
        afterState: { fulfillmentStatus: normalizedStatus },
      }, { client: tx });
    });
    if (normalizedStatus === "packed") {
      await onOrderPacked(assignment.orderId, manufacturerId);
    }

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (error) {
    console.error("updateAssignmentStatus error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── ADMIN: GET ALL ASSIGNMENTS ───────────────────────────────────────────────
const getAllAssignments = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const { status, manufacturerId } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (manufacturerId) where.manufacturerId = manufacturerId;

    const [assignments, total] = await prisma.$transaction([
      prisma.orderAssignment.findMany({
        where,
        orderBy: { assignedAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
        include: {
        manufacturer: {
          select: {
            id: true,
            name: true,
            city: true,
            phone: true,
            qualityRating: true,
            ncmPickupBranch: true,
            pickupAddress: true,
            pickupContactName: true,
            pickupContactPhone: true,
            pickupWindow: true,
          },
        },
          distributor: {
            select: { id: true, name: true, city: true, phone: true },
          },
        },
      }),
      prisma.orderAssignment.count({ where }),
    ]);

    const orderIds = assignments.map((a) => a.orderId);
    const [orders, deliveryOrders] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { assignedGift: true },
      }),
      prisma.deliveryOrder.findMany({
        where: { orderId: { in: orderIds } },
        include: {
          events: {
            orderBy: { occurredAt: "desc" },
            take: 10,
            select: {
              id: true,
              eventType: true,
              fromState: true,
              toState: true,
              ncmStatus: true,
              occurredAt: true,
              payloadJson: true,
            },
          },
        },
      }),
    ]);

    const deliveryIds = deliveryOrders.map((delivery) => delivery.id);
    const deliveryComments = deliveryIds.length
      ? await prisma.deliveryComment.findMany({
          where: { deliveryOrderId: { in: deliveryIds } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];
    const commentsMap = {};
    deliveryComments.forEach((comment) => {
      (commentsMap[comment.deliveryOrderId] ||= []).push(comment);
    });

    const orderMap = {};
    orders.forEach((o) => {
      const items = parseJSON(o.items, []);
      const address = parseJSON(o.address, {});
      orderMap[o.id] = {
        ...o,
        items,
        address,
        date: Number(o.date),
        fulfillmentBenefits: buildFulfillmentBenefits(o, items),
      };
    });

    const deliveryMap = {};
    deliveryOrders.forEach((d) => {
      deliveryMap[d.orderId] = d;
    });

    const enriched = assignments.map((a) => ({
      ...a,
      manufacturer: a.manufacturer ? { ...a.manufacturer, businessName: a.manufacturer.name } : null,
      distributor: a.distributor || null,
      order: orderMap[a.orderId] || null,
      delivery: deliveryMap[a.orderId]
        ? { ...deliveryMap[a.orderId], comments: commentsMap[deliveryMap[a.orderId].id] || [] }
        : null,
      createdAt: a.assignedAt,
    }));

    res.json(paginatedResponse("assignments", enriched, pagination, total));
  } catch (error) {
    console.error("getAllAssignments error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── GET SINGLE ASSIGNMENT WITH FULL AUDIT & DELIVERY TRAIL ───────────────────
const getAssignmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const assignment = await prisma.orderAssignment.findUnique({
      where: { id },
      include: {
        manufacturer: {
          select: {
            id: true,
            name: true,
            city: true,
            phone: true,
            qualityRating: true,
            ncmPickupBranch: true,
            pickupAddress: true,
            pickupContactName: true,
            pickupContactPhone: true,
            pickupWindow: true,
          },
        },
        distributor: {
          select: { id: true, name: true, city: true, phone: true },
        },
      },
    });

    if (!assignment) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (req.manufacturerId && assignment.manufacturerId !== req.manufacturerId) {
      return res.status(403).json({ success: false, message: "Unauthorized access" });
    }
    if (req.distributorId && assignment.distributorId !== req.distributorId) {
      return res.status(403).json({ success: false, message: "Unauthorized access" });
    }

    const [order, delivery] = await Promise.all([
      prisma.order.findUnique({ where: { id: assignment.orderId }, include: { assignedGift: true } }),
      prisma.deliveryOrder.findUnique({
        where: { orderId: assignment.orderId },
        include: {
          events: {
            orderBy: { occurredAt: "asc" },
            select: {
              id: true,
              eventType: true,
              fromState: true,
              toState: true,
              ncmStatus: true,
              occurredAt: true,
              payloadJson: true,
              source: true,
            },
          },
        },
      }),
    ]);

    const comments = delivery
      ? await prisma.deliveryComment.findMany({ orderBy: { createdAt: "desc" }, where: { deliveryOrderId: delivery.id }, take: 100 })
      : [];

    const enrichedItems = order ? parseJSON(order.items, []) : [];
    const enrichedOrder = order
      ? {
          ...order,
          items: enrichedItems,
          address: parseJSON(order.address, {}),
          date: Number(order.date),
          fulfillmentBenefits: buildFulfillmentBenefits(order, enrichedItems),
        }
      : null;

    res.json({
      success: true,
      assignment: {
        ...assignment,
        manufacturer: assignment.manufacturer
          ? { ...assignment.manufacturer, businessName: assignment.manufacturer.name }
          : null,
        distributor: assignment.distributor || null,
        order: enrichedOrder,
        delivery: delivery ? { ...delivery, comments } : null,
        createdAt: assignment.assignedAt,
      },
    });
  } catch (error) {
    console.error("getAssignmentById error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── ADMIN: MANUAL OVERRIDE ASSIGN ───────────────────────────────────────────
const manualAssign = async (req, res) => {
  return res.status(409).json({
    success: false,
    message: "Manual manufacturer assignment is disabled. Route customer orders through distributor allocation.",
  });
};

export {
  assignOrder,
  getMyAssignments,
  getAssignmentById,
  acceptOrder,
  rejectOrder,
  updateAssignmentStatus,
  getAllAssignments,
  manualAssign,
};
