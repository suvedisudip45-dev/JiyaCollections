import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { prepareReadyDelivery, submitDeliveryToNcm } from "./deliveryService.js";
import { isDistributorLocalDeliveryEligible } from "./deliveryLocationService.js";

const parseNotes = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const fail = (message, statusCode = 400, code = "DISTRIBUTOR_DELIVERY_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const validDeliveryTypes = new Set(["NCM", "SELF_DELIVERY"]);
const NCM_STATUS_FILTERS = {
  "PICKUP ORDER CREATED": ["Pickup Order Created"],
  "SENT FOR PICKUP": ["Pickup Order Created"],
  "DROP OFF ORDER CREATED": ["Pickup Order Created"],
  "PICKUP COMPLETE": ["Pickup Complete"],
  "SENT FOR DELIVERY": ["Sent for Delivery"],
  DISPATCHED: ["Dispatched"],
  "IN TRANSIT": ["Dispatched"],
  ARRIVED: ["Arrived"],
  "OUT FOR DELIVERY": ["Sent for Delivery"],
  DELIVERED: ["Delivered"],
  RETURNED: ["Returned"],
};

export const normalizeDistributorNcmStatusFilter = (status) => {
  const key = String(status || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
  return NCM_STATUS_FILTERS[key] || null;
};

export const canReapplyNcmSubmission = (delivery) =>
  delivery?.state === "SUBMISSION_FAILED" && delivery.ncmOrderId == null;

export const holdDistributorOrderForDelivery = async ({
  distributorId,
  assignmentId,
  deliveryType,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId || !assignmentId) throw fail("Distributor and assignment are required.");
  if (!validDeliveryTypes.has(deliveryType)) throw fail("Choose a valid delivery type.");

  const assignment = await client.orderAssignment.findFirst({
    where: { id: assignmentId, distributorId },
  });
  if (!assignment) throw fail("Assigned order not found for this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");

  const currentStatus = String(assignment.status || "").toLowerCase();
  const alreadyHeld = currentStatus === "on_hold" && parseNotes(assignment.notes).deliveryOnHold === true;
  if (currentStatus !== "package_details_complete" && !alreadyHeld) {
    throw fail("Complete package details before placing this order on hold.", 409, "INVALID_DELIVERY_HOLD_STATE");
  }

  const order = await client.order.findUnique({ where: { id: assignment.orderId } });
  if (!order || order.status === "Cancelled") throw fail("Cancelled or missing orders cannot be put on hold.", 409, "ORDER_NOT_AVAILABLE");

  const existingDelivery = await client.deliveryOrder.findUnique({
    where: { orderId: assignment.orderId },
    select: { id: true },
  });
  if (existingDelivery) throw fail("An NCM delivery has already been prepared for this order.", 409, "DELIVERY_ALREADY_PREPARED");

  if (deliveryType === "SELF_DELIVERY") {
    const [distributor, address] = await Promise.all([
      client.distributor.findUnique({
        where: { id: distributorId },
        select: {
          city: true,
          province: true,
          district: true,
          locations: {
            where: { isActive: true },
            select: { province: true, district: true },
          },
        },
      }),
      Promise.resolve(parseNotes(order.address)),
    ]);
    if (!isDistributorLocalDeliveryEligible({ customerAddress: address, distributor: distributor || {} })) {
      throw fail("Self-delivery is available only when the customer and distributor share a district or the same city.", 409, "SELF_DELIVERY_DISTRICT_MISMATCH");
    }
  }

  const notes = parseNotes(assignment.notes);
  const now = new Date();
  const heldNotes = JSON.stringify({
    ...notes,
    deliveryOnHold: true,
    deliveryOnHoldAt: now.toISOString(),
  });

  return client.$transaction(async (tx) => {
    const updated = await tx.orderAssignment.updateMany({
      where: {
        id: assignment.id,
        status: assignment.status,
        deliveryType: assignment.deliveryType,
      },
      data: {
        status: "on_hold",
        deliveryType,
        notes: heldNotes,
      },
    });
    if (updated.count !== 1) throw fail("The order changed while being placed on hold. Refresh and try again.", 409, "DELIVERY_HOLD_CONFLICT");

    await tx.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "on_hold" },
    });
    await recordSystemAudit(
      {
        actorId: actorContext.actorId || distributorId,
        actorRole: "DISTRIBUTOR",
        portalSource: "DISTRIBUTOR",
        ...actorContext,
      },
      {
        action: "DISTRIBUTOR_ORDER_HELD_FOR_DELIVERY",
        entityType: "Order",
        entityId: order.id,
        beforeState: { status: assignment.status, deliveryType: assignment.deliveryType },
        afterState: { status: "on_hold", deliveryType },
      },
      { client: tx },
    );

    return {
      success: true,
      message: `${deliveryType === "NCM" ? "NCM" : "Self-delivery"} order placed on hold.`,
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      deliveryType,
      status: "on_hold",
    };
  });
};

export const distributorNcmDeliveryWhere = (type, status) => {
  const where = {};
  if (type === "FAILED") {
    where.state = "SUBMISSION_FAILED";
    where.ncmOrderId = null;
  } else if (type === "BOOKED") {
    where.state = { not: "DELIVERED" };
    where.ncmOrderId = { not: null };
  } else if (type === "DELIVERED") {
    where.state = "DELIVERED";
    where.ncmOrderId = { not: null };
  } else {
    where.ncmOrderId = { not: null };
  }
  if (status) where.ncmStatus = { in: normalizeDistributorNcmStatusFilter(status) };
  return where;
};

const getNcmAssignmentIds = async (distributorId, type, client, status) => {
  if (type === "ON_HOLD") {
    const assignments = await client.orderAssignment.findMany({
      where: { distributorId, deliveryType: "NCM", status: "on_hold" },
      select: { id: true },
      orderBy: { assignedAt: "desc" },
    });
    return assignments.map(({ id }) => id);
  }

  if (type === "FAILED" || type === "BOOKED" || type === "DELIVERED" || status) {
    const where = distributorNcmDeliveryWhere(type, status);
    where.distributorId = distributorId;
    const deliveries = await client.deliveryOrder.findMany({
      where,
      select: { assignmentId: true },
      orderBy: { createdAt: "desc" },
    });
    return [...new Set(deliveries.map(({ assignmentId }) => assignmentId).filter(Boolean))];
  }

  const assignments = await client.orderAssignment.findMany({
    where: { distributorId, deliveryType: "NCM" },
    select: { id: true },
    orderBy: { assignedAt: "desc" },
  });
  return assignments.map(({ id }) => id);
};

const getLikelyDeliveryDate = (delivery) => {
  const candidates = (delivery?.events || [])
    .map((event) => event.payloadJson)
    .filter((payload) => payload && typeof payload === "object")
    .flatMap((payload) => [payload, payload.data].filter((value) => value && typeof value === "object"));
  for (const payload of candidates) {
    const value = payload.estimatedDeliveryDate || payload.expectedDeliveryDate ||
      payload.estimated_delivery || payload.expected_delivery || payload.delivery_date ||
      payload.expected_delivery_date || payload.eta;
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
};

const getCarrierDisplayStatus = (delivery) => {
  const latestPayload = delivery?.events?.[0]?.payloadJson;
  const payloads = [latestPayload, latestPayload?.data].filter((payload) => payload && typeof payload === "object");
  for (const payload of payloads) {
    if (typeof payload.status === "string" && payload.status.trim()) return payload.status.trim();
  }
  return delivery?.ncmStatus || null;
};

export const listDistributorNcmOrders = async ({
  distributorId,
  type = "ALL",
  status,
  page: pageValue,
  limit: limitValue,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  const typeFilter = String(type || "ALL").trim().toUpperCase();
  if (!["ALL", "ON_HOLD", "FAILED", "BOOKED", "DELIVERED"].includes(typeFilter)) {
    throw fail("Unsupported NCM order filter.");
  }
  const statusFilter = String(status || "").trim();
  if (statusFilter && !normalizeDistributorNcmStatusFilter(statusFilter)) {
    throw fail("Unsupported NCM carrier status filter.");
  }
  if (statusFilter && typeFilter === "ON_HOLD") {
    throw fail("Carrier status filters cannot be used with the on-hold view.");
  }

  const pagination = getPagination({ page: pageValue, limit: limitValue });
  const failedWhere = distributorNcmDeliveryWhere("FAILED");
  failedWhere.distributorId = distributorId;
  const bookedWhere = distributorNcmDeliveryWhere("BOOKED");
  bookedWhere.distributorId = distributorId;
  const deliveredWhere = distributorNcmDeliveryWhere("DELIVERED");
  deliveredWhere.distributorId = distributorId;
  const [matchingIds, heldCount, failedCount, allCount, bookedCount, deliveredCount] = await Promise.all([
    getNcmAssignmentIds(distributorId, typeFilter, client, statusFilter),
    client.orderAssignment.count({ where: { distributorId, deliveryType: "NCM", status: "on_hold" } }),
    client.deliveryOrder.count({ where: failedWhere }),
    client.orderAssignment.count({ where: { distributorId, deliveryType: "NCM" } }),
    client.deliveryOrder.count({ where: bookedWhere }),
    client.deliveryOrder.count({ where: deliveredWhere }),
  ]);
  const total = matchingIds.length;
  const pageIds = matchingIds.slice(pagination.skip, pagination.skip + pagination.limit);
  const assignments = pageIds.length
    ? await client.orderAssignment.findMany({
        where: { id: { in: pageIds }, distributorId },
        orderBy: { assignedAt: "desc" },
      })
    : [];
  const orderIds = assignments.map(({ orderId }) => orderId);
  const [orders, deliveries] = await Promise.all([
    orderIds.length
      ? client.order.findMany({ where: { id: { in: orderIds } }, include: { assignedGift: true } })
      : [],
    orderIds.length
      ? client.deliveryOrder.findMany({
          where: { orderId: { in: orderIds }, distributorId },
          include: {
            events: {
              orderBy: { occurredAt: "desc" },
              take: 10,
              select: { id: true, ncmStatus: true, payloadJson: true, occurredAt: true },
            },
          },
        })
      : [],
  ]);
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const deliveryMap = new Map(deliveries.map((delivery) => [delivery.orderId, delivery]));
  const records = assignments.map((assignment) => {
    const order = orderMap.get(assignment.orderId);
    const delivery = deliveryMap.get(assignment.orderId) || null;
    const items = parseNotes(order?.items);
    const address = parseNotes(order?.address);
    return {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      status: assignment.status,
      deliveryType: assignment.deliveryType,
      heldAt: parseNotes(assignment.notes).deliveryOnHoldAt || null,
      assignedAt: assignment.assignedAt,
      order: order ? {
        id: order.id,
        amount: Number(order.amount || 0),
        deliveryFee: Number(order.deliveryFee || 0),
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        paymentMethod: order.paymentMethod,
        payment: Boolean(order.payment),
        date: order.date == null ? null : Number(order.date),
        createdAt: order.createdAt,
        address,
        items: Array.isArray(items) ? items : [],
        assignedGift: order.assignedGift || null,
      } : null,
      delivery: delivery ? {
        id: delivery.id,
        state: delivery.state,
        deliveryType: delivery.deliveryType,
        ncmOrderId: delivery.ncmOrderId,
        ncmStatus: delivery.ncmStatus,
        displayStatus: getCarrierDisplayStatus(delivery),
        canReapply: canReapplyNcmSubmission(delivery),
        ncmPaymentStatus: delivery.ncmPaymentStatus,
        ncmDeliveryCharge: delivery.ncmDeliveryCharge,
        ncmCreatedAt: delivery.ncmCreatedAt,
        lastSyncedAt: delivery.lastSyncedAt,
        likelyDeliveryAt: getLikelyDeliveryDate(delivery),
      } : null,
    };
  });

  return {
    ...paginatedResponse("orders", records, pagination, total),
    counts: {
      all: allCount,
      onHold: heldCount,
      failed: failedCount,
      booked: bookedCount,
      delivered: deliveredCount,
    },
  };
};

export const bookDistributorNcmOrders = async ({
  distributorId,
  assignmentIds,
  client = prisma,
} = {}) => {
  if (!distributorId) throw fail("Distributor ID is required.");
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    throw fail("Select at least one held NCM order.");
  }
  if (assignmentIds.length > 50) throw fail("A maximum of 50 orders can be booked in one batch.");

  const uniqueIds = [...new Set(assignmentIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) throw fail("Select at least one valid order.");

  const results = [];
  for (const assignmentId of uniqueIds) {
    let orderId = null;
    try {
      const assignment = await client.orderAssignment.findFirst({
        where: { id: assignmentId, distributorId },
      });
      if (!assignment) throw fail("Order assignment not found in this distributor hub.", 404, "ASSIGNMENT_NOT_FOUND");
      orderId = assignment.orderId;
      const isHeldNcmOrder =
        assignment.status === "on_hold" &&
        assignment.deliveryType === "NCM" &&
        parseNotes(assignment.notes).deliveryOnHold === true;
      const existingDelivery = await client.deliveryOrder.findUnique({ where: { orderId } });
      const isRetryableFailedSubmission = canReapplyNcmSubmission(existingDelivery);
      if (!isHeldNcmOrder && !isRetryableFailedSubmission) {
        throw fail("Only held NCM orders or definitively failed NCM submissions can be booked.", 409, "NCM_ORDER_NOT_ON_HOLD");
      }

      const notes = parseNotes(assignment.notes);
      const prepared = await prepareReadyDelivery({
        orderId: assignment.orderId,
        distributorId,
        packageWeight: notes.packageWeight,
        packageDimensions: notes.packageDimensions,
        packagingNotes: notes.packagingNotes,
        productType: notes.productType,
        productDescription: notes.productDescription,
        packageType: notes.packageType,
        isFragile: notes.isFragile,
        deliveryInstruction: notes.deliveryInstruction,
        packagingChecklist: notes.packagingChecklist,
        allowRetryAfterUnknown: isRetryableFailedSubmission,
      });
      const delivery = prepared.alreadySubmitted
        ? prepared.delivery
        : await submitDeliveryToNcm(prepared.delivery.id, {
            allowRetryAfterUnknown: isRetryableFailedSubmission,
          });
      results.push({ assignmentId, orderId, success: true, delivery });
    } catch (error) {
      results.push({
        assignmentId,
        ...(orderId ? { orderId } : {}),
        success: false,
        code: error.code || "NCM_BOOKING_FAILED",
        message: error.message || "NCM booking failed.",
      });
    }
  }

  const successful = results.filter((result) => result.success).length;
  return {
    success: successful === results.length,
    partial: successful > 0 && successful < results.length,
    message: successful === results.length
      ? `NCM booking submitted for ${successful} order${successful === 1 ? "" : "s"}.`
      : successful > 0
        ? `NCM booking submitted for ${successful} of ${results.length} orders. Review failed orders before retrying.`
        : "No selected orders could be booked with NCM.",
    results,
  };
};
