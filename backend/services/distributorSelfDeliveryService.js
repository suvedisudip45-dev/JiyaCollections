import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { enqueueDeliveredSaleAccounting } from "./accountingOutboxService.js";
import { consumeDistributorOrderInventory } from "./distributorOrderInventoryService.js";
import { isDistributorLocalDeliveryEligible } from "./deliveryLocationService.js";
import { resolveActiveRateCard } from "./distributorRateCardService.js";
import {
  createReturnExchangeSettlementPayable,
  postReturnExchangeSettlementAccounting,
} from "./returnExchangeSettlementService.js";
import {
  formatCollectionAmount,
  isDistributorDeliveryOtpEnabled,
  verifyDistributorDeliveryOtp,
} from "./distributorDeliveryOtpService.js";

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

const normalize = (val) => String(val || "").trim().toLowerCase();
const normalizeSkuKey = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();
const serializeOrder = (order) => ({
  ...order,
  date: order.date == null ? order.date : Number(order.date),
});
const SELF_DELIVERY_STATUSES = [
  "on_hold",
  "package_details_complete",
  "ready_for_pickup",
  "Ready for Pickup",
  "dispatched",
  "Dispatched",
  "on_the_way",
  "On the Way",
  "out_for_delivery",
  "delivered",
  "Delivered",
  "returned",
  "Returned",
  "return_requested",
];

const fail = (message, statusCode = 400, code = "SELF_DELIVERY_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const ensureNoNcmDelivery = async (assignment, client) => {
  const ncmDelivery = await client.deliveryOrder.findUnique({
    where: { orderId: assignment.orderId },
    select: { id: true },
  });
  if (ncmDelivery) {
    throw fail("This order already has an NCM delivery and cannot be handled as self-delivery.", 409, "NCM_DELIVERY_EXISTS");
  }
};

const ensureSelfDeliveryAssignment = async (assignment, client) => {
  if (normalize(assignment.deliveryType || "SELF_DELIVERY") !== "self_delivery") {
    throw fail("This order is assigned to NCM, not distributor self-delivery.", 409, "NOT_SELF_DELIVERY");
  }
  await ensureNoNcmDelivery(assignment, client);
};

/**
 * Sequential State Machine for Distributor Self-Delivery
 * Allowed: Initial/Assigned -> Dispatched -> On the Way -> Delivered
 */
const ALLOWED_INITIAL_STATES = new Set([
  "assigned",
  "pending_acceptance",
  "accepted",
  "packed",
  "package_details_complete",
  "ready_for_pickup",
  "on_hold",
]);

export const validateSelfDeliveryTransition = (currentStatus, targetStatus) => {
  const current = normalize(currentStatus);
  const target = normalize(targetStatus);

  if (target === "dispatched") {
    if (ALLOWED_INITIAL_STATES.has(current) || current === "dispatched") {
      return { valid: true, canonicalStatus: "Dispatched", internalStatus: "dispatched" };
    }
    return {
      valid: false,
      message: `Cannot dispatch order in current state '${currentStatus}'. Order must be assigned first.`,
    };
  }

  if (target === "on_the_way" || target === "on the way" || target === "out_for_delivery") {
    if (current === "dispatched" || current === "on_the_way" || current === "on the way") {
      return { valid: true, canonicalStatus: "On the Way", internalStatus: "on_the_way" };
    }
    return {
      valid: false,
      message: `Cannot move order to 'On the Way'. Order must be 'Dispatched' first (current: '${currentStatus}').`,
    };
  }

  if (target === "delivered") {
    if (current === "on_the_way" || current === "on the way" || current === "dispatched" || current === "delivered") {
      return { valid: true, canonicalStatus: "Delivered", internalStatus: "delivered" };
    }
    return {
      valid: false,
      message: `Cannot mark order 'Delivered'. Order must be 'On the Way' or 'Dispatched' first (current: '${currentStatus}').`,
    };
  }

  return {
    valid: false,
    message: `Invalid target status '${targetStatus}'. Self-delivery sequence is Dispatched -> On the Way -> Delivered.`,
  };
};

/**
 * List orders assigned to this Distributor hub
 */
export const listAssignedDistributorOrders = async ({
  distributorId,
  status = "all",
  page = 1,
  limit = 20,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);

  const numPage = Math.max(1, Number(page || 1));
  const numLimit = Math.min(100, Math.max(1, Number(limit || 20)));
  const skip = (numPage - 1) * numLimit;

  const where = {
    distributorId,
    status: { in: SELF_DELIVERY_STATUSES },
  };
  if (status && status !== "all") {
    const norm = normalize(status);
    if (norm === "assigned") where.status = { in: ["ready_for_pickup", "Ready for Pickup"] };
    else if (norm === "on_hold") where.status = { in: ["on_hold", "ON_HOLD"] };
    else if (norm === "dispatched") where.status = { in: ["dispatched", "Dispatched"] };
    else if (norm === "on_the_way" || norm === "on the way") where.status = { in: ["on_the_way", "On the Way", "out_for_delivery"] };
    else if (norm === "delivered") where.status = { in: ["delivered", "Delivered"] };
    else if (norm === "returned") where.status = { in: ["returned", "Returned", "return_requested"] };
    else where.status = status;
  }

  const assignments = await client.orderAssignment.findMany({
    where,
    orderBy: { assignedAt: "desc" },
    include: {
      distributor: { select: { id: true, name: true, city: true, phone: true } },
    },
  });

  const assignmentOrderIds = assignments.map((assignment) => assignment.orderId);
  const ncmDeliveries = assignmentOrderIds.length
    ? await client.deliveryOrder.findMany({
        where: { orderId: { in: assignmentOrderIds } },
        select: { orderId: true },
      })
    : [];
  const ncmOrderIds = new Set(ncmDeliveries.map((delivery) => delivery.orderId));
  const selfDeliveryAssignments = assignments.filter((assignment) =>
    normalize(assignment.deliveryType || "SELF_DELIVERY") === "self_delivery" &&
    !ncmOrderIds.has(assignment.orderId) &&
    (
      normalize(assignment.status) !== "package_details_complete" ||
      parseJSON(assignment.notes, {}).deliveryOnHold === true
    )
  );
  const total = selfDeliveryAssignments.length;
  const pageAssignments = selfDeliveryAssignments.slice(skip, skip + numLimit);
  const orderIds = pageAssignments.map((assignment) => assignment.orderId);
  const orders = await client.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      assignedGift: true,
    },
  });
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const enriched = pageAssignments.map((assignment) => {
    const order = orderMap.get(assignment.orderId);
    return {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      status: assignment.status,
      deliveryType: assignment.deliveryType || "SELF_DELIVERY",
      assignedAt: assignment.assignedAt,
      acceptedAt: assignment.acceptedAt,
      dispatchedAt: assignment.dispatchedAt,
      onTheWayAt: assignment.onTheWayAt,
      deliveredAt: assignment.deliveredAt,
      returnedAt: assignment.returnedAt,
      notes: parseJSON(assignment.notes, assignment.notes),
      onHold: normalize(assignment.status) === "on_hold" && parseJSON(assignment.notes, {}).deliveryOnHold === true,
      order: order
        ? {
            id: order.id,
            userId: order.userId,
            amount: order.amount,
            deliveryFee: order.deliveryFee,
            loyaltyDiscount: order.loyaltyDiscount,
            rewardApplied: order.rewardApplied,
            status: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
            paymentMethod: order.paymentMethod,
            payment: order.payment,
            date: order.date ? String(order.date) : null,
            address: parseJSON(order.address, {}),
            items: parseJSON(order.items, []),
            assignedGift: order.assignedGift || null,
          }
        : null,
    };
  });
  const rateCard = await resolveActiveRateCard({ distributorId, client });
  const expectedDeliveryCharge = Number(rateCard.deliveryCharge || 0);

  return {
    success: true,
    orders: enriched.map((assignment) => ({
      ...assignment,
      expectedDeliveryCharge,
    })),
    pagination: {
      page: numPage,
      limit: numLimit,
      total,
      pages: Math.ceil(total / numLimit),
    },
  };
};

export const markDistributorSelfDeliveryReady = async ({
  distributorId,
  assignmentIdOrOrderId,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (!assignmentIdOrOrderId) throw fail("Order or Assignment ID is required.", 400);

  const assignment = await client.orderAssignment.findFirst({
    where: {
      OR: [{ id: assignmentIdOrOrderId }, { orderId: assignmentIdOrOrderId }],
      distributorId,
    },
  });
  if (!assignment) throw fail("Assigned order not found for this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");

  const order = await client.order.findUnique({ where: { id: assignment.orderId } });
  if (!order) throw fail("Order not found.", 404);

  if (
    normalize(assignment.status) === "ready_for_pickup" &&
    normalize(assignment.deliveryType) === "self_delivery"
  ) {
    await ensureSelfDeliveryAssignment(assignment, client);
    return { success: true, duplicate: true, assignment, order: serializeOrder(order) };
  }

  const heldForSelfDelivery = normalize(assignment.status) === "on_hold" &&
    parseJSON(assignment.notes, {}).deliveryOnHold === true &&
    normalize(assignment.deliveryType) === "self_delivery";
  if (normalize(assignment.status) !== "package_details_complete" && !heldForSelfDelivery) {
    throw fail("Complete package details before selecting distributor self-delivery.", 409, "INVALID_SELF_DELIVERY_STATE");
  }

  const address = parseJSON(order.address, {});
  const distributor = await client.distributor.findUnique({
    where: { id: distributorId },
    include: {
      locations: {
        where: { isActive: true },
        select: { province: true, district: true },
      },
    },
  });
  if (!isDistributorLocalDeliveryEligible({ customerAddress: address, distributor: distributor || {} })) {
    throw fail(
      "Self-delivery is available only when the customer and distributor share a district or the same city.",
      409,
      "SELF_DELIVERY_DISTRICT_MISMATCH",
    );
  }

  await ensureNoNcmDelivery(assignment, client);

  return client.$transaction(async (tx) => {
    const ncmDelivery = await tx.deliveryOrder.findUnique({
      where: { orderId: assignment.orderId },
      select: { id: true },
    });
    if (ncmDelivery) {
      throw fail("This order already has an NCM delivery and cannot be handled as self-delivery.", 409, "NCM_DELIVERY_EXISTS");
    }

    const claimed = await tx.orderAssignment.updateMany({
      where: {
        id: assignment.id,
        status: assignment.status,
        deliveryType: assignment.deliveryType,
      },
      data: { deliveryType: "SELF_DELIVERY", status: "ready_for_pickup" },
    });
    if (claimed.count !== 1) {
      throw fail("The delivery method changed while you were selecting self-delivery. Refresh and try again.", 409, "DELIVERY_METHOD_CHANGED");
    }

    const updatedAssignment = {
      ...assignment,
      deliveryType: "SELF_DELIVERY",
      status: "ready_for_pickup",
    };
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "ready_for_pickup" },
    });

    await recordSystemAudit(
      {
        actorId: actorContext.actorId || distributorId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
        ...actorContext,
      },
      {
        action: "DISTRIBUTOR_SELF_DELIVERY_SELECTED",
        entityType: "Order",
        entityId: order.id,
        beforeState: { status: assignment.status, deliveryType: assignment.deliveryType },
        afterState: { status: updatedAssignment.status, deliveryType: updatedAssignment.deliveryType },
      },
      { client: tx },
    );

    return {
      success: true,
      message: "Order is ready for distributor self-delivery.",
      assignment: updatedAssignment,
      order: serializeOrder(updatedOrder),
    };
  });
};

/**
 * Update Self-Delivery Status sequentially (Dispatched -> On the Way -> Delivered)
 */
export const updateSelfDeliveryStatus = async ({
  distributorId,
  assignmentIdOrOrderId,
  status,
  otpCode = null,
  collectionConfirmed = false,
  paymentMethod = "CASH",
  notificationConfig,
  notes = null,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (!assignmentIdOrOrderId) throw fail("Order or Assignment ID is required.", 400);
  if (!status) throw fail("Target status is required.", 400);

  const assignment = await client.orderAssignment.findFirst({
    where: {
      OR: [{ id: assignmentIdOrOrderId }, { orderId: assignmentIdOrOrderId }],
      distributorId,
    },
  });

  if (!assignment) {
    throw fail("Assigned order not found for this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");
  }
  await ensureSelfDeliveryAssignment(assignment, client);

  const transition = validateSelfDeliveryTransition(assignment.status, status);
  if (!transition.valid) {
    throw fail(transition.message, 409, "INVALID_STATUS_TRANSITION");
  }

  const { canonicalStatus, internalStatus } = transition;
  const now = new Date();

  const result = await client.$transaction(async (tx) => {
    let accountingStatus = null;
    const order = await tx.order.findUnique({
      where: { id: assignment.orderId },
    });
    if (!order) throw fail("Order not found.", 404);

    const assignmentUpdateData = {
      status: internalStatus,
    };
    const orderUpdateData = {
      fulfillmentStatus: internalStatus === "on_the_way" ? "out_for_delivery" : internalStatus,
      status: canonicalStatus,
    };

    if (notes) {
      const prevNotes = parseJSON(assignment.notes, {});
      assignmentUpdateData.notes = JSON.stringify(
        typeof prevNotes === "object" ? { ...prevNotes, statusNote: notes, updatedAt: now } : { note: notes }
      );
    }

    if (internalStatus === "dispatched") {
      assignmentUpdateData.dispatchedAt = now;
      const prevNotes = parseJSON(assignment.notes, {});
      assignmentUpdateData.notes = JSON.stringify({
        ...prevNotes,
        deliveryOnHold: false,
        deliveryDispatchedAt: now.toISOString(),
      });
    } else if (internalStatus === "on_the_way") {
      assignmentUpdateData.onTheWayAt = now;
    } else if (internalStatus === "delivered") {
      assignmentUpdateData.deliveredAt = now;
      const isUnpaidCod = String(order.paymentMethod || "COD").trim().toUpperCase() === "COD" && !order.payment;
      if (isUnpaidCod) {
        let collection;
        const otpRequired = isDistributorDeliveryOtpEnabled(notificationConfig);
        if (otpRequired) {
          collection = await verifyDistributorDeliveryOtp({
            tx,
            distributorId,
            order,
            code: otpCode,
            paymentMethod,
            actorId: actorContext.actorId || distributorId,
            now,
          });
          if (collection.error) return { deliveryOtpError: collection.error };
        } else {
          if (collectionConfirmed !== true) {
            return {
              deliveryOtpError: fail(
                "Confirm that you collected the full COD amount before completing delivery.",
                400,
                "COD_COLLECTION_CONFIRMATION_REQUIRED",
              ),
            };
          }
          const normalizedPaymentMethod = String(paymentMethod || "").trim().toUpperCase();
          if (!["CASH", "BANK_TRANSFER", "MOBILE_WALLET", "CARD"].includes(normalizedPaymentMethod)) {
            return {
              deliveryOtpError: fail("Select a valid customer payment method.", 400, "INVALID_PAYMENT_METHOD"),
            };
          }
          collection = {
            collectionAmount: formatCollectionAmount(order),
            paymentMethod: normalizedPaymentMethod,
          };
        }
        await tx.distributorCashEvent.create({
          data: {
            distributorId,
            orderId: order.id,
            eventType: "CUSTOMER_COLLECTION",
            amount: collection.collectionAmount,
            status: otpRequired ? "VERIFIED" : "PENDING_VERIFICATION",
            paymentMethod: collection.paymentMethod,
            idempotencyKey: `delivery-collection:${order.id}`,
            occurredAt: now,
            recordedByAccountId: actorContext.actorId || null,
            ...(otpRequired
              ? {
                  verifiedByAccountId: actorContext.actorId || null,
                  verifiedAt: now,
                }
              : {}),
            notes: otpRequired
              ? "Customer COD collection confirmed by delivery OTP."
              : "Customer COD collection declared by distributor; SMS OTP was disabled.",
          },
        });
      }
      orderUpdateData.payment = true;

      const inventoryConsumption = await consumeDistributorOrderInventory({
        tx,
        orderId: order.id,
        distributorId,
        assignmentId: assignment.id,
        items: parseJSON(order.items, []),
        actorId: actorContext.actorId || distributorId,
      });
      orderUpdateData.items = inventoryConsumption.accountingItems;

      const accountingEvent = await enqueueDeliveredSaleAccounting(
        {
          order: {
            ...order,
            ...orderUpdateData,
            deliveredAt: now,
            collectionDistributorId: isUnpaidCod ? distributorId : null,
          },
        },
        { client: tx },
      );
      accountingStatus = accountingEvent.status;
    }

    const assignmentClaim = await tx.orderAssignment.updateMany({
      where: { id: assignment.id, status: assignment.status },
      data: assignmentUpdateData,
    });
    if (assignmentClaim.count !== 1) {
      throw fail("Order delivery status changed concurrently. Refresh and retry.", 409, "DELIVERY_STATUS_CONFLICT");
    }
    const updatedAssignment = { ...assignment, ...assignmentUpdateData };

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: orderUpdateData,
    });

    await recordSystemAudit(
      {
        actorId: actorContext.actorId || distributorId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
        ...actorContext,
      },
      {
        action: `DISTRIBUTOR_SELF_DELIVERY_${internalStatus.toUpperCase()}`,
        entityType: "Order",
        entityId: order.id,
        beforeState: { status: assignment.status, fulfillmentStatus: order.fulfillmentStatus },
        afterState: { status: internalStatus, fulfillmentStatus: orderUpdateData.fulfillmentStatus },
      },
      { client: tx }
    );

    return {
      success: true,
      message: `Order status successfully updated to '${canonicalStatus}'.`,
      assignment: updatedAssignment,
      order: serializeOrder(updatedOrder),
      ...(accountingStatus ? { accountingStatus } : {}),
    };
  });
  if (result?.deliveryOtpError) throw result.deliveryOtpError;
  return result;
};

export const dispatchDistributorSelfDeliveryOrders = async ({
  distributorId,
  assignmentIds,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    throw fail("Select at least one self-delivery order to dispatch.");
  }
  if (assignmentIds.length > 50) {
    throw fail("A maximum of 50 orders can be dispatched in one batch.");
  }

  const uniqueIds = [...new Set(assignmentIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) throw fail("Select at least one valid order.");

  const results = [];
  for (const assignmentId of uniqueIds) {
    let orderId = null;
    try {
      const assignment = await client.orderAssignment.findFirst({
        where: { id: assignmentId, distributorId },
        select: { orderId: true },
      });
      if (!assignment) {
        throw fail("Order assignment not found in this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");
      }
      orderId = assignment.orderId;
      const result = await updateSelfDeliveryStatus({
        distributorId,
        assignmentIdOrOrderId: assignmentId,
        status: "Dispatched",
        actorContext,
        client,
      });
      results.push({ assignmentId, orderId, success: true, status: result.assignment.status });
    } catch (error) {
      results.push({
        assignmentId,
        ...(orderId ? { orderId } : {}),
        success: false,
        code: error.code || "SELF_DELIVERY_DISPATCH_FAILED",
        message: error.message || "Self-delivery dispatch failed.",
      });
    }
  }

  const successful = results.filter((result) => result.success).length;
  return {
    success: successful === results.length,
    partial: successful > 0 && successful < results.length,
    message: successful === results.length
      ? `Dispatched ${successful} order${successful === 1 ? "" : "s"}.`
      : successful > 0
        ? `Dispatched ${successful} of ${results.length} orders. Review failed orders before retrying.`
        : "None of the selected orders could be dispatched.",
    results,
  };
};

/**
 * Process Self-Delivery Customer Return, QA, stock restocking/damage write-off, and notify Admin
 */
export const processSelfDeliveryReturn = async ({
  distributorId,
  assignmentIdOrOrderId,
  items,
  reason,
  notes = null,
  damageType = null,
  damageNotes = null,
  returnRequestId = null,
  inspectionEvidenceUrl,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.", 400);
  if (!assignmentIdOrOrderId) throw fail("Order or Assignment ID is required.", 400);
  if (!Array.isArray(items) || items.length === 0) {
    throw fail("At least one return item with quantity and inspection condition is required.", 400);
  }
  if (!reason || String(reason).trim().length < 3) {
    throw fail("A valid return reason (at least 3 characters) is required.", 400);
  }
  const assignment = await client.orderAssignment.findFirst({
    where: {
      OR: [{ id: assignmentIdOrOrderId }, { orderId: assignmentIdOrOrderId }],
      distributorId,
    },
  });

  if (!assignment) {
    throw fail("Assigned order not found for this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");
  }
  await ensureSelfDeliveryAssignment(assignment, client);
  if (!returnRequestId) {
    throw fail("An admin-approved customer return request is required before distributor return processing.", 409, "RETURN_ADMIN_APPROVAL_REQUIRED");
  }
  const approvedReturn = await client.customerReturn.findFirst({
    where: {
      id: returnRequestId,
      orderId: assignment.orderId,
      distributorId,
      deliveryRoute: "DISTRIBUTOR",
      lifecycleStatus: "DISTRIBUTOR_RETURN_PENDING",
    },
  });
  if (!approvedReturn) {
    throw fail("This return request is not approved for this distributor or has already been processed.", 409, "RETURN_NOT_APPROVED_FOR_DISTRIBUTOR");
  }
  if (typeof inspectionEvidenceUrl !== "string" || !/^https:\/\//i.test(inspectionEvidenceUrl)) {
    throw fail("A JPG or PNG return-goods evidence image is required.", 400, "RETURN_EVIDENCE_REQUIRED");
  }

  const order = await client.order.findUnique({
    where: { id: assignment.orderId },
  });
  if (!order) throw fail("Order not found.", 404);

  const orderItems = parseJSON(order.items, []);
  const approvedItems = parseJSON(approvedReturn.items, []);
  const approvedQuantities = new Map(approvedItems.map((item) => [
    `${item.productId}|${normalizeSkuKey(item.size)}|${normalizeSkuKey(item.color)}`,
    Number(item.quantity || 0),
  ]));
  const submittedQuantities = new Map();
  for (const item of items) {
    const key = `${item.productId || item._id || item.id}|${normalizeSkuKey(item.size)}|${normalizeSkuKey(item.color)}`;
    submittedQuantities.set(key, (submittedQuantities.get(key) || 0) + Number(item.quantity || 0));
  }
  if (
    submittedQuantities.size !== approvedQuantities.size ||
    [...approvedQuantities].some(([key, quantity]) => submittedQuantities.get(key) !== quantity)
  ) {
    throw fail("Returned items and quantities must match the admin-approved request.", 409, "RETURN_ITEMS_NOT_APPROVED");
  }
  const customerAddress = parseJSON(order.address, {});
  const customerName = `${customerAddress.firstName || ""} ${customerAddress.lastName || ""}`.trim() || "Valued Customer";
  const customerPhone = customerAddress.phone || "";

  const result = await client.$transaction(async (tx) => {
    const claimedReturn = await tx.customerReturn.updateMany({
      where: {
        id: approvedReturn.id,
        distributorId,
        lifecycleStatus: "DISTRIBUTOR_RETURN_PENDING",
      },
      data: { lifecycleStatus: "DISTRIBUTOR_RETURN_PROCESSING" },
    });
    if (claimedReturn.count !== 1) {
      throw fail("This approved return is already being processed or is no longer available.", 409, "RETURN_PROCESSING_CONFLICT");
    }

    // 1. Ensure Distributor Stock & Damaged Locations exist
    let stockLocation = await tx.inventoryLocation.findFirst({
      where: { distributorId, kind: "DISTRIBUTOR", isActive: true },
    });
    if (!stockLocation) {
      stockLocation = await tx.inventoryLocation.create({
        data: {
          locationKey: `DIST_${distributorId}_STOCK`,
          kind: "DISTRIBUTOR",
          distributorId,
          inventoryOwner: "PLATFORM",
          isActive: true,
        },
      });
    }

    let damagedLocation = await tx.inventoryLocation.findFirst({
      where: { distributorId, kind: "DAMAGED", isActive: true },
    });
    if (!damagedLocation) {
      damagedLocation = await tx.inventoryLocation.create({
        data: {
          locationKey: `DIST_${distributorId}_DAMAGED`,
          kind: "DAMAGED",
          distributorId,
          inventoryOwner: "PLATFORM",
          isActive: true,
        },
      });
    }

    let totalRefundAmount = 0;
    const processedItems = [];
    let hasDamagedItems = false;

    for (const returnItem of items) {
      const productId = returnItem.productId || returnItem._id || returnItem.id;
      const size = String(returnItem.size || "Standard");
      const color = String(returnItem.color || "Standard");
      const quantity = Math.max(1, Number(returnItem.quantity || 1));
      const condition = String(returnItem.condition || "GOOD").toUpperCase();
      const isDamaged = condition === "DAMAGED" || condition === "SCRAP" || condition === "DEFECTIVE";
      if (isDamaged) hasDamagedItems = true;

      // Find matching order line item
      const matchingOrderLine = orderItems.find(
        (oItem) =>
          (oItem.productId === productId || oItem._id === productId || oItem.id === productId) &&
          normalizeSkuKey(oItem.size) === normalizeSkuKey(size) &&
          normalizeSkuKey(oItem.color) === normalizeSkuKey(color)
      ) || orderItems[0] || {};

      const unitPrice = Number(matchingOrderLine.purchasedUnitPrice ?? matchingOrderLine.price ?? 0);
      const unitCostPrice = Number(
        matchingOrderLine.agreedUnitCogsVatInclusiveAtAcceptance ??
        matchingOrderLine.costPrice ??
        0,
      );
      const lineRefund = unitPrice * quantity;
      totalRefundAmount += lineRefund;

      processedItems.push({
        productId,
        name: matchingOrderLine.name || "Returned Product",
        size,
        color,
        quantity,
        unitPrice,
        unitCostPrice,
        refundAmount: lineRefund,
        condition: isDamaged ? "DAMAGED" : "RESTOCKABLE",
      });

      // Find SKU
      const sku = await tx.inventorySku.findFirst({
        where: { productId, sizeKey: normalizeSkuKey(size), colorKey: normalizeSkuKey(color), isActive: true },
      });

      if (sku) {
        if (!isDamaged) {
          // RESTOCK to Distributor stock location
          const balance = await tx.inventoryBalance.upsert({
            where: {
              locationId_inventorySkuId: {
                locationId: stockLocation.id,
                inventorySkuId: sku.id,
              },
            },
            create: {
              locationId: stockLocation.id,
              inventorySkuId: sku.id,
              quantityOnHand: quantity,
              reservedQuantity: 0,
            },
            update: {
              quantityOnHand: { increment: quantity },
            },
          });

          await tx.inventoryLedgerEntry.create({
            data: {
              inventorySkuId: sku.id,
              sourceLocationId: null,
              destinationLocationId: stockLocation.id,
              quantity,
              movementType: "RETURN",
              inventoryOwner: "PLATFORM",
              referenceType: "RETURN",
              referenceId: order.id,
              idempotencyKey: `dist-return-restock-${order.id}-${sku.id}-${crypto.randomBytes(4).toString("hex")}`,
              actorId: actorContext.actorId || distributorId,
              actorRole: "DISTRIBUTOR",
              reason: `Distributor return restock for order ${order.id}: ${reason}`,
            },
          });
        } else {
          // Move to DAMAGED location & create InventoryDiscrepancy
          await tx.inventoryBalance.upsert({
            where: {
              locationId_inventorySkuId: {
                locationId: damagedLocation.id,
                inventorySkuId: sku.id,
              },
            },
            create: {
              locationId: damagedLocation.id,
              inventorySkuId: sku.id,
              quantityOnHand: quantity,
              reservedQuantity: 0,
            },
            update: {
              quantityOnHand: { increment: quantity },
            },
          });

          await tx.inventoryLedgerEntry.create({
            data: {
              inventorySkuId: sku.id,
              sourceLocationId: null,
              destinationLocationId: damagedLocation.id,
              quantity,
              movementType: "DAMAGE",
              inventoryOwner: "PLATFORM",
              referenceType: "RETURN_DAMAGE",
              referenceId: order.id,
              idempotencyKey: `dist-return-damage-${order.id}-${sku.id}-${crypto.randomBytes(4).toString("hex")}`,
              actorId: actorContext.actorId || distributorId,
              actorRole: "DISTRIBUTOR",
              reason: `Distributor return damaged write-off for order ${order.id}: ${reason} - ${damageNotes || ""}`,
            },
          });

          await tx.inventoryDiscrepancy.create({
            data: {
              distributorId,
              inventorySkuId: sku.id,
              discrepancyType: "DAMAGED",
              quantity,
              damageType: damageType || "DELIVERY_DAMAGE",
              details: `Self-delivery customer return damage: ${reason}. Notes: ${damageNotes || notes || "No additional notes"}`,
              reportedByRole: "DISTRIBUTOR",
              reportedByAccountId: actorContext.actorId || null,
              status: "OPEN",
            },
          });
        }
      }
    }

    if (!approvedReturn.approvedRefundAmount || !approvedReturn.refundPolicySnapshot) {
      throw fail("This return has no approved refund-policy snapshot. Contact Admin before processing.", 409, "RETURN_REFUND_POLICY_MISSING");
    }
    if (Number(approvedReturn.totalRefundAmount).toFixed(2) !== Number(totalRefundAmount).toFixed(2)) {
      throw fail("Returned product value differs from the Admin-approved return request.", 409, "RETURN_VALUE_MISMATCH");
    }

    // 2. Create CustomerReturn record
    const now = new Date();
    const customerReturn = await tx.customerReturn.update({
      where: { id: approvedReturn.id },
      data: {
        items: processedItems,
        totalRefundAmount,
        vatRefunded: Number(approvedReturn.vatRefunded || 0),
        refundMethod: "CASH",
        refundStatus: "PENDING",
        inventoryAction: hasDamagedItems ? "DAMAGED_WRITE_OFF" : "RESTOCKED",
        inspectionEvidenceUrl,
        notes: [approvedReturn.adminNotes, notes ? String(notes).trim() : ""].filter(Boolean).join("\n") || null,
        lifecycleStatus: "REFUND_PENDING",
        inspectionResult: hasDamagedItems ? "PARTIAL" : "RESTOCKABLE",
        inspectedAt: now,
      },
    });
    await createReturnExchangeSettlementPayable(tx, customerReturn, "RETURN");
    await tx.customerReturnEvent.create({
      data: {
        customerReturnId: customerReturn.id,
        eventType: "DISTRIBUTOR_RETURN_RECEIVED_AND_INSPECTED",
        fromStatus: "DISTRIBUTOR_RETURN_PROCESSING",
        toStatus: "REFUND_PENDING",
        actorId: actorContext.actorId || distributorId,
        actorRole: "DISTRIBUTOR",
        reason: reason.trim(),
        metadata: { items: processedItems, damageType, damageNotes },
        idempotencyKey: `RETURN:${customerReturn.id}:DISTRIBUTOR_RECEIVED`,
      },
    });

    // 3. Update Order and Assignment status
    await tx.orderAssignment.update({
      where: { id: assignment.id },
      data: {
        status: "returned",
        returnedAt: now,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "Returned",
        fulfillmentStatus: "returned",
      },
    });

    // 4. System Audit log to notify admin
    await recordSystemAudit(
      {
        actorId: actorContext.actorId || distributorId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
        ...actorContext,
      },
      {
        action: "DISTRIBUTOR_SELF_DELIVERY_RETURN_PROCESSED",
        entityType: "CustomerReturn",
        entityId: customerReturn.id,
        beforeState: { orderId: order.id, fulfillmentStatus: order.fulfillmentStatus },
        afterState: {
          customerReturnId: customerReturn.id,
          totalRefundAmount,
          approvedRefundAmount: approvedReturn.approvedRefundAmount.toString(),
          hasDamagedItems,
          inventoryAction: customerReturn.inventoryAction,
        },
      },
      { client: tx }
    );

    return {
      success: true,
      message: "Customer return and QA inspection recorded successfully.",
      customerReturn,
      hasDamagedItems,
      totalRefundAmount,
    };
  });
  if (client === prisma) {
    await postReturnExchangeSettlementAccounting({ operation: "RETURN", requestId: approvedReturn.id });
  }
  return result;
};
