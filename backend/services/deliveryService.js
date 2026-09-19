import crypto from "node:crypto";
import { prisma, reconnectPrisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import {
  createOrder as createNcmOrder,
  getBranches,
  getNcmBranchName,
  getNcmBranchRows,
  getBulkOrderStatuses,
  createCodTransferTicket,
  getOrder,
  getOrderComments,
  getOrderStatus,
  getShippingRate,
  requestOrderReturn,
  shippingRateTypeForNcm,
} from "./ncmClient.js";

const VALID_READY_STATES = new Set(["packed"]);
let ncmBranchNamesCache = { expiresAt: 0, names: [] };

const getNcmBranchNames = async () => {
  if (ncmBranchNamesCache.expiresAt > Date.now() && ncmBranchNamesCache.names.length) return ncmBranchNamesCache.names;
  try {
    const response = await getBranches();
    const names = [...new Set(getNcmBranchRows(response).map(getNcmBranchName).filter(Boolean))];
    ncmBranchNamesCache = { names, expiresAt: Date.now() + 10 * 60 * 1000 };
    return names;
  } catch (error) {
    logger.warn("Unable to load NCM branch catalog before rate lookup", { error: error.message });
    return [];
  }
};

export const STATUS_MAP = {
  "Pickup Order Created": "NCM_CREATED",
  "Drop off Order Created": "NCM_CREATED",
  "Sent for Pickup": "NCM_CREATED",
  "Pickup Complete": "PICKUP_CONFIRMED",
  "Sent for Delivery": "OUT_FOR_DELIVERY",
  Dispatched: "IN_TRANSIT",
  "In Transit": "IN_TRANSIT",
  Arrived: "ARRIVED_AT_DESTINATION",
  Delivered: "DELIVERED",
  Returned: "RETURN_REQUESTED",
};

/**
 * Normalizes any NCM event, status, or raw string variation into
 * canonical delivery state, assignment status, fulfillment status, and display status.
 */
export const normalizeDeliveryStatus = (rawStatus = "", rawEvent = "") => {
  const combined = `${String(rawEvent || "")} ${String(rawStatus || "")}`.toLowerCase().trim();
  const s = String(rawStatus || "").toLowerCase().trim();
  const e = String(rawEvent || "").toLowerCase().trim();

  // 1. Delivered / Completed
  if (
    s === "delivered" ||
    e === "delivery_completed" ||
    combined.includes("delivery_completed") ||
    s.includes("delivered")
  ) {
    return {
      deliveryState: "DELIVERED",
      assignmentStatus: "delivered",
      fulfillmentStatus: "delivered",
      canonicalStatus: "Delivered",
    };
  }

  // 2. Sent for delivery / Out for delivery
  if (
    s === "sent for delivery" ||
    s === "out for delivery" ||
    s === "out_for_delivery" ||
    e === "sent_for_delivery" ||
    combined.includes("sent_for_delivery") ||
    combined.includes("out for delivery")
  ) {
    return {
      deliveryState: "OUT_FOR_DELIVERY",
      assignmentStatus: "out_for_delivery",
      fulfillmentStatus: "out_for_delivery",
      canonicalStatus: "Sent for Delivery",
    };
  }

  // 3. Arrived at destination branch
  if (
    s === "arrived" ||
    s === "order_arrived" ||
    s === "arrived_at_destination" ||
    e === "order_arrived" ||
    combined.includes("order_arrived") ||
    s.includes("arrived")
  ) {
    return {
      deliveryState: "ARRIVED_AT_DESTINATION",
      assignmentStatus: "arrived_at_destination",
      fulfillmentStatus: "arrived_at_destination",
      canonicalStatus: "Arrived",
    };
  }

  // 4. Dispatched / In Transit
  if (
    s === "dispatched" ||
    s === "order_dispatched" ||
    s === "order_dispached" || // handle common typo in user request & webhook
    s === "in transit" ||
    s === "in_transit" ||
    e === "order_dispatched" ||
    e === "order_dispached" ||
    combined.includes("dispatched") ||
    combined.includes("dispached") ||
    combined.includes("in transit") ||
    combined.includes("in_transit")
  ) {
    return {
      deliveryState: "IN_TRANSIT",
      assignmentStatus: "in_transit",
      fulfillmentStatus: "in_transit",
      canonicalStatus: "Dispatched",
    };
  }

  // 5. Pickup completed / Picked up
  if (
    s === "pickup complete" ||
    s === "pickup_completed" ||
    s === "picked up" ||
    s === "picked_up" ||
    s === "order pickup" ||
    s === "order_pickup" ||
    e === "pickup_completed" ||
    combined.includes("pickup_completed") ||
    combined.includes("pickup complete") ||
    combined.includes("picked up")
  ) {
    return {
      deliveryState: "PICKUP_CONFIRMED",
      assignmentStatus: "picked_up",
      fulfillmentStatus: "picked_up",
      canonicalStatus: "Pickup Complete",
    };
  }

  // 6. Pickup order created / Sent for pickup
  if (
    s === "pickup order created" ||
    s === "pickup_order_created" ||
    s === "drop off order created" ||
    s === "sent for pickup" ||
    s === "ready_for_pickup" ||
    e === "pickup_order_created" ||
    combined.includes("pickup order created") ||
    combined.includes("pickup_order_created") ||
    combined.includes("sent for pickup")
  ) {
    return {
      deliveryState: "NCM_CREATED",
      assignmentStatus: "ready_for_pickup",
      fulfillmentStatus: "ncm_created",
      canonicalStatus: "Pickup Order Created",
    };
  }

  // 7. Returned
  if (
    s === "returned" ||
    s === "return requested" ||
    s === "return_requested" ||
    s === "vendor_return" ||
    e === "order_return" ||
    combined.includes("returned") ||
    combined.includes("return")
  ) {
    return {
      deliveryState: "RETURN_REQUESTED",
      assignmentStatus: "return_requested",
      fulfillmentStatus: "return_requested",
      canonicalStatus: "Returned",
    };
  }

  // Fallback: check STATUS_MAP or return unmapped
  const mapped = STATUS_MAP[rawStatus];
  if (mapped) {
    const summary = syncSummary(mapped) || "in_transit";
    return {
      deliveryState: mapped,
      assignmentStatus: summary,
      fulfillmentStatus: summary,
      canonicalStatus: rawStatus || "In Transit",
    };
  }

  return {
    deliveryState: "EXTERNAL_STATUS_UNMAPPED",
    assignmentStatus: null,
    fulfillmentStatus: null,
    canonicalStatus: rawStatus || "Update Received",
  };
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeBranch = (value) => String(value || "").trim().toUpperCase();

const resolvePickupBranch = (manufacturer) => {
  const direct = normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  return direct;
};

export const deliveryTypeForNcm = (deliveryType = "Door2Door") => {
  const allowed = new Set(["Door2Door", "Branch2Door", "Branch2Branch", "Door2Branch"]);
  return allowed.has(deliveryType) ? deliveryType : "Door2Door";
};

export const statusEventKey = ({ orderId, status, timestamp, event }) =>
  crypto.createHash("sha256").update(JSON.stringify({ orderId, status, timestamp, event })).digest("hex");

const sanitizePayload = (payload) => {
  if (!payload || typeof payload !== "object") return {};
  return JSON.parse(JSON.stringify(payload));
};

export const generateVendorReference = ({ order, assignment }) => {
  const orderKey = String(order?.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "ORD";
  const assignmentKey = String(assignment?.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "ASS";
  const suffix = crypto.createHash("sha256").update(`${order?.id || ""}|${assignment?.id || ""}`).digest("hex").slice(0, 4).toUpperCase();
  return `NCM${orderKey}${assignmentKey}${suffix}`.slice(0, 15);
};

const runTransaction = async (handler, { retries = 1 } = {}) => {
  try {
    return await prisma.$transaction(handler);
  } catch (error) {
    if (error.code === "P2028" && retries > 0) {
      await reconnectPrisma();
      return runTransaction(handler, { retries: retries - 1 });
    }
    throw error;
  }
};

const createEvent = async (tx, data) => {
  try {
    return await tx.deliveryEvent.create({ data });
  } catch (error) {
    if (error.code === "P2002") return null;
    throw error;
  }
};

const syncSummary = (state) => {
  const summary = {
    NCM_CREATED: "ncm_created",
    PICKUP_CONFIRMED: "picked_up",
    IN_TRANSIT: "in_transit",
    ARRIVED_AT_DESTINATION: "arrived_at_destination",
    OUT_FOR_DELIVERY: "out_for_delivery",
    DELIVERED: "delivered",
    RETURN_REQUESTED: "return_requested",
  };
  return summary[state] || null;
};

export const assignmentStatusFromNcmStatus = (status) => {
  return normalizeDeliveryStatus(status).assignmentStatus;
};

export const webhookIdentifiers = (payload = {}) => {
  const values = [
    payload.order_id,
    payload.orderid,
    payload.orderId,
    payload.vref_id,
    payload.vendorReference,
    payload.delivery_order_id,
    ...(Array.isArray(payload.order_ids) ? payload.order_ids : []),
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
};

const normalizePackagingMeta = (source = {}) => {
  const data = source && typeof source === "object" ? source : {};
  const firstItem = Array.isArray(data.items) ? data.items[0] : null;
  const productType = String(data.productType || firstItem?.productType || firstItem?.category || firstItem?.name || "Garment").trim() || "Garment";
  const productDescription = String(data.productDescription || firstItem?.description || firstItem?.productDescription || firstItem?.name || "Ready-to-ship product").trim() || "Ready-to-ship product";
  const packageType = String(data.packageType || firstItem?.packageType || "Box").trim() || "Box";
  const isFragile = data.isFragile !== undefined
    ? parseBoolean(data.isFragile)
    : parseBoolean(firstItem?.isFragile ?? firstItem?.fragile);
  const instruction = String(data.deliveryInstruction ?? data.instruction ?? "").trim();

  return {
    productType,
    productDescription,
    packageType,
    isFragile,
    deliveryInstruction: instruction,
  };
};

export const buildDeliveryInput = ({ order, assignment, manufacturer, packagingMeta = {}, itemsOverride = null }) => {
  const address = parseJson(order.address, {});
  const items = itemsOverride || parseJson(order.items, []);
  const origin = resolvePickupBranch(manufacturer);
  const destination = normalizeBranch(address.ncmBranch || address.city);
  if (!origin) {
    const error = new Error("Manufacturer NCM pickup branch is required. Ask admin to assign and verify the pickup branch before readying the order.");
    error.code = "NCM_PICKUP_BRANCH_REQUIRED";
    throw error;
  }
  if (!destination) {
    const error = new Error("NCM destination branch mapping is required. Configure the customer city mapping before dispatch.");
    error.code = "NCM_DESTINATION_BRANCH_REQUIRED";
    throw error;
  }

  const phone = String(address.phone || "").trim();
  const name = String(address.name || `${address.firstName || ""} ${address.lastName || ""}`).trim();
  const customerAddress = String(address.street || address.address || "").trim();
  if (!name || !phone || !customerAddress) {
    const error = new Error("Customer name, phone, and address are required before delivery");
    error.code = "DELIVERY_CUSTOMER_DATA_REQUIRED";
    throw error;
  }

  const itemAmount = Number(order.amount || 0);
  const deliveryType = deliveryTypeForNcm(address.deliveryType || "Door2Door");
  const meta = normalizePackagingMeta({ items, ...packagingMeta });
  const productType = String(packagingMeta.productType || meta.productType || "Garment").trim() || "Garment";
  const productDescription = String(packagingMeta.productDescription || meta.productDescription || "Ready-to-ship product").trim() || "Ready-to-ship product";
  const packageType = String(packagingMeta.packageType || meta.packageType || "Box").trim() || "Box";
  const isFragile = packagingMeta.isFragile !== undefined ? parseBoolean(packagingMeta.isFragile) : meta.isFragile;
  const instruction = String(packagingMeta.deliveryInstruction ?? packagingMeta.instruction ?? address.deliveryInstruction ?? "").trim();

  const packageDescription = [
    productType,
    productDescription,
    packageType,
    isFragile ? "Fragile" : "Standard",
  ].filter(Boolean).join(" | ").slice(0, 500);
  const vendorReference = generateVendorReference({ order, assignment });

  return {
    origin,
    destination,
    destinationCandidates: [destination],
    address,
    name,
    phone,
    customerAddress,
    itemAmount,
    deliveryType,
    productType,
    productDescription,
    packageType,
    isFragile,
    instruction,
    packageDescription,
    vendorReference,
    codAmount: itemAmount,
    originCandidates: origin === "KATHMANDU" ? ["TINKUNE", origin] : [origin],
  };
};

const parsePackagingMeta = (payload) => {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return payload;
};

export const prepareReadyDelivery = async ({ orderId, manufacturerId, packageWeight, packageDimensions, packagingNotes, productType, productDescription, packageType, isFragile, deliveryInstruction, instruction, packagingChecklist }) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.manufacturerId !== manufacturerId) {
    const error = new Error("Order not found or unauthorized");
    error.code = "DELIVERY_NOT_FOUND";
    throw error;
  }

  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId } });
  if (!assignment || assignment.manufacturerId !== manufacturerId) {
    const error = new Error("Manufacturer assignment not found");
    error.code = "DELIVERY_ASSIGNMENT_NOT_FOUND";
    throw error;
  }

  const existingNotes = parsePackagingMeta(assignment.notes);
  const packagingMeta = {
    ...existingNotes,
    productType: productType ?? existingNotes.productType ?? "",
    productDescription: productDescription ?? existingNotes.productDescription ?? "",
    packageType: packageType ?? existingNotes.packageType ?? "Box",
    isFragile: isFragile !== undefined ? parseBoolean(isFragile) : parseBoolean(existingNotes.isFragile),
    deliveryInstruction: deliveryInstruction ?? instruction ?? existingNotes.deliveryInstruction ?? "",
    packagingNotes: packagingNotes ?? existingNotes.packagingNotes ?? "",
    packageDimensions: packageDimensions ?? existingNotes.packageDimensions ?? "",
    packagingChecklist: packagingChecklist ?? existingNotes.packagingChecklist ?? null,
  };

  const existing = await prisma.deliveryOrder.findUnique({ where: { orderId } });
  const submittedStates = ["NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED"];
  if (existing && submittedStates.includes(existing.state)) {
    return { delivery: existing, alreadySubmitted: true };
  }

  const isPacked = VALID_READY_STATES.has(assignment.status) || order.fulfillmentStatus === "packed";
  const isRetryingHandoff = assignment.status === "ready_for_pickup" && existing && ["SUBMISSION_PENDING", "SUBMISSION_FAILED"].includes(existing.state);
  if (!isPacked && !isRetryingHandoff) {
    const error = new Error(`Order must be packed before delivery submission; current state is ${assignment.status}`);
    error.code = "DELIVERY_INVALID_STATE";
    throw error;
  }

  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  const input = buildDeliveryInput({ order, assignment, manufacturer, packagingMeta });

  logger.info("Prepared NCM delivery payload", {
    orderId,
    manufacturerId,
    origin: input.origin,
    destination: input.destination,
    deliveryType: input.deliveryType,
    itemAmount: input.itemAmount,
    codAmount: input.codAmount,
    packageDescription: input.packageDescription,
    vendorReference: input.vendorReference,
  });

  const delivery = await runTransaction(async (tx) => {
    const record = existing
      ? await tx.deliveryOrder.update({
          where: { id: existing.id },
          data: {
            state: "SUBMISSION_PENDING",
            packageVersion: { increment: 1 },
            originBranchName: input.origin,
            destinationBranchName: input.destination,
            deliveryType: input.deliveryType,
            packageDescription: input.packageDescription,
            itemAmount: input.itemAmount,
            codAmount: input.codAmount,
            packageWeight: Math.max(0.1, Number(packageWeight || existing.packageWeight || 1)),
            assignmentId: assignment.id,
            manufacturerId,
            lastSyncError: null,
          },
        })
      : await tx.deliveryOrder.create({
          data: {
            orderId,
            assignmentId: assignment.id,
            manufacturerId,
            state: "SUBMISSION_PENDING",
            deliveryType: input.deliveryType,
            packageDescription: input.packageDescription,
            originBranchName: input.origin,
            destinationBranchName: input.destination,
            itemAmount: input.itemAmount,
            codAmount: input.codAmount,
            packageWeight: Math.max(0.1, Number(packageWeight || 1)),
            vendorReference: input.vendorReference,
          },
        });

    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: "submission_pending" },
    });
    await tx.orderAssignment.update({
      where: { id: assignment.id },
      data: {
        status: "ready_for_pickup",
        readyAt: new Date(),
        notes: JSON.stringify({
          ...existingNotes,
          ...packagingMeta,
          packageWeight: Number(packageWeight || existing?.packageWeight || 1),
        }),
      },
    });
    await createEvent(tx, {
      deliveryOrderId: record.id,
      orderId,
      source: "MANUFACTURER",
      eventType: "READY_TO_DELIVER",
      fromState: existing?.state || assignment.status,
      toState: "SUBMISSION_PENDING",
      actorId: manufacturerId,
      idempotencyKey: `READY_TO_DELIVER:${record.id}:${record.packageVersion}`,
    });
    return record;
  });

  return { delivery, input };
};

export const submitDeliveryToNcm = async (deliveryId) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.ncmOrderId) return delivery;
  if (delivery.state !== "SUBMISSION_PENDING") throw new Error(`Delivery is not awaiting submission: ${delivery.state}`);

  const order = await prisma.order.findUnique({ where: { id: delivery.orderId } });
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: delivery.manufacturerId } });
  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId: delivery.orderId } });
  const assignmentNotes = parsePackagingMeta(assignment?.notes);
  const input = buildDeliveryInput({
    order,
    assignment,
    manufacturer,
    packagingMeta: assignmentNotes,
  });
  const attemptKey = `NCM_CREATE:${delivery.id}:${delivery.packageVersion}`;
  const priorAttempt = await prisma.ncmRequestAttempt.findUnique({ where: { idempotencyKey: attemptKey } });
  if (priorAttempt?.result === "SUCCESS") return prisma.deliveryOrder.findUnique({ where: { id: delivery.id } });

  const attempt = priorAttempt || await prisma.ncmRequestAttempt.create({
    data: {
      deliveryOrderId: delivery.id,
      operation: "CREATE_ORDER",
      idempotencyKey: attemptKey,
      attemptNumber: 1,
      requestUrl: "/api/v1/order/create",
      requestJson: {
        name: input.name,
        phone: input.phone,
        customerAddress: input.customerAddress,
        origin: input.origin,
        destination: input.destination,
        deliveryType: input.deliveryType,
        vendorReference: input.vendorReference,
        codAmount: input.codAmount,
      },
      result: "STARTED",
    },
  });

  try {
    let rate;
    let resolvedOrigin = input.origin;
    let resolvedDestination = input.destination;
    let lastRateError;
    const catalog = await getNcmBranchNames();
    const originCandidates = input.originCandidates || [input.origin];
    const destinationCandidates = input.destinationCandidates || [input.destination];
    for (const originCandidate of originCandidates) {
      if (catalog.length && !catalog.includes(originCandidate)) continue;
      for (const destinationCandidate of destinationCandidates) {
        if (catalog.length && !catalog.includes(destinationCandidate)) continue;
        try {
          rate = await getShippingRate({
            creation: originCandidate,
            destination: destinationCandidate,
            type: shippingRateTypeForNcm(input.deliveryType),
          });
          resolvedOrigin = originCandidate;
          resolvedDestination = destinationCandidate;
          break;
        } catch (error) {
          lastRateError = error;
          const responseText = String(error.response?.raw || error.message || "");
          if (!/branch matching query does not exist|branch.*not found/i.test(responseText)) throw error;
        }
      }
      if (rate) break;
    }
    if (!rate) {
      const error = new Error(`NCM has no valid branch mapping for ${originCandidates.join(", ")} -> ${destinationCandidates.join(", ")}`);
      error.code = "NCM_BRANCH_NOT_FOUND";
      error.response = lastRateError?.response;
      throw error;
    }
    const rateValue = Number(rate.data?.delivery_charge ?? rate.data?.charge ?? rate.data?.shipping_charge ?? 0);
    const ncmPayload = {
      name: input.name,
      phone: input.phone,
      phone2: input.address.phone2 || "",
      cod_charge: String(input.codAmount + rateValue),
      address: input.customerAddress,
      fbranch: resolvedOrigin,
      branch: resolvedDestination,
      package: input.packageDescription,
      vref_id: input.vendorReference,
      instruction: String(input.instruction || input.address.deliveryInstruction || "").slice(0, 500),
      delivery_type: input.deliveryType,
      weight: String(Math.max(0.1, Number(delivery.packageWeight || 1))),
    };

    logger.info("NCM create payload ready", {
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      manufacturerId: delivery.manufacturerId,
      fbranch: ncmPayload.fbranch,
      branch: ncmPayload.branch,
      delivery_type: ncmPayload.delivery_type,
      weight: ncmPayload.weight,
      cod_charge: ncmPayload.cod_charge,
      package: ncmPayload.package,
      vref_id: ncmPayload.vref_id,
      phone: "[REDACTED]",
      address: "[REDACTED]",
      instruction: "[REDACTED]",
    });

    const response = await createNcmOrder(ncmPayload);
    const ncmOrderId = Number(response.data?.orderid);
    if (!Number.isInteger(ncmOrderId)) throw new Error("NCM did not return a valid order ID");

    const updated = await runTransaction(async (tx) => {
      const record = await tx.deliveryOrder.update({
        where: { id: delivery.id },
        data: {
          state: "NCM_CREATED",
          ncmOrderId,
          ncmStatus: "Pickup Order Created",
          originBranchName: resolvedOrigin,
          destinationBranchName: resolvedDestination,
          ncmDeliveryCharge: rateValue,
          customerDeliveryCharge: rateValue,
          ncmCreatedAt: new Date(),
          lastSyncedAt: new Date(),
          nextSyncAt: new Date(Date.now() + 15 * 60 * 1000),
          lastSyncError: null,
        },
      });
      await tx.ncmRequestAttempt.update({
        where: { id: attempt.id },
        data: { result: "SUCCESS", httpStatus: response.httpStatus, responseJson: response.data, finishedAt: new Date() },
      });
      await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: "ncm_created", deliveryJobId: delivery.id } });
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source: "SYSTEM",
        eventType: "NCM_ORDER_CREATED",
        fromState: "SUBMISSION_PENDING",
        toState: "NCM_CREATED",
        ncmStatus: "Pickup Order Created",
        payloadJson: { orderid: ncmOrderId },
        idempotencyKey: `NCM_ORDER_CREATED:${delivery.id}:${ncmOrderId}`,
      });
      return record;
    });
    return updated;
  } catch (error) {
    await prisma.ncmRequestAttempt.update({
      where: { id: attempt.id },
      data: {
        result: "FAILED",
        httpStatus: error.httpStatus || null,
        responseJson: error.response || null,
        errorCode: error.code || "NCM_REQUEST_FAILED",
        errorMessage: error.message,
        finishedAt: new Date(),
      },
    }).catch(() => {});
    await prisma.deliveryOrder.update({ where: { id: delivery.id }, data: { state: "SUBMISSION_FAILED", lastSyncError: error.message, syncFailureCount: { increment: 1 } } });
    throw error;
  }
};

export const applyNcmStatus = async ({ payload, source = "NCM_WEBHOOK" }) => {
  const ids = webhookIdentifiers(payload);
  const results = [];
  for (const ncmId of ids) {
    const trimmedId = String(ncmId || "").trim();
    if (!trimmedId) continue;

    // Resolve delivery order by ncmOrderId (numeric), vendorReference, orderId, or deliveryOrder id
    let delivery = null;
    const numericId = Number(trimmedId);
    if (Number.isInteger(numericId) && numericId > 0) {
      delivery = await prisma.deliveryOrder.findFirst({
        where: { ncmOrderId: numericId },
        include: { order: { select: { paymentMethod: true, payment: true } } },
      });
    }
    if (!delivery) {
      delivery = await prisma.deliveryOrder.findFirst({
        where: {
          OR: [
            { vendorReference: trimmedId },
            { orderId: trimmedId },
            { id: trimmedId },
          ],
        },
        include: { order: { select: { paymentMethod: true, payment: true } } },
      });
    }

    if (!delivery) {
      logger.warn("Delivery order not found for NCM webhook ID", { ncmId: trimmedId, payload });
      continue;
    }

    const { deliveryState, assignmentStatus, fulfillmentStatus, canonicalStatus } = normalizeDeliveryStatus(
      payload.status,
      payload.event
    );

    const eventKey = statusEventKey({
      orderId: trimmedId,
      status: payload.status || canonicalStatus,
      timestamp: payload.timestamp,
      event: payload.event,
    });

    const updated = await prisma.$transaction(async (tx) => {
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source,
        eventType: payload.event || "NCM_STATUS_CHANGED",
        fromState: delivery.state,
        toState: deliveryState,
        ncmStatus: canonicalStatus,
        payloadJson: sanitizePayload(payload),
        occurredAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        idempotencyKey: `NCM_STATUS:${eventKey}`,
      });

      const deliveryUpdateData = {
        ncmStatus: canonicalStatus,
        lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + 30 * 60 * 1000),
        ...(deliveryState !== "EXTERNAL_STATUS_UNMAPPED" ? { state: deliveryState } : {}),
        ...(deliveryState === "PICKUP_CONFIRMED" ? { pickedUpAt: new Date() } : {}),
        ...(deliveryState === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(deliveryState === "RETURN_REQUESTED" ? { returnedAt: new Date() } : {}),
      };

      const record = await tx.deliveryOrder.update({ where: { id: delivery.id }, data: deliveryUpdateData });

      // Synchronize Order model
      if (fulfillmentStatus) {
        const orderUpdateData = {
          fulfillmentStatus,
        };

        if (deliveryState === "DELIVERED") {
          orderUpdateData.status = "Delivered";
          orderUpdateData.payment = true; // COD or online payment settled on delivery
        } else if (deliveryState === "RETURN_REQUESTED") {
          orderUpdateData.status = "Returned";
          orderUpdateData.payment = String(delivery.order?.paymentMethod || "COD").toUpperCase() === "COD"
            ? false
            : Boolean(delivery.order?.payment);
        } else if (
          ["PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY"].includes(deliveryState)
        ) {
          orderUpdateData.status = "Shipped";
        }

        await tx.order.update({
          where: { id: delivery.orderId },
          data: orderUpdateData,
        });
      }

      // Synchronize OrderAssignment model
      if (assignmentStatus) {
        const assignmentUpdate = {
          status: assignmentStatus,
        };
        if (assignmentStatus === "ready_for_pickup") assignmentUpdate.readyAt = new Date();
        if (assignmentStatus === "picked_up") assignmentUpdate.pickedUpAt = new Date();

        await tx.orderAssignment.updateMany({
          where: { orderId: delivery.orderId },
          data: assignmentUpdate,
        });
      }

      if (deliveryState === "RETURN_REQUESTED") {
        await tx.deliveryReturn.upsert({
          where: { deliveryOrderId: delivery.id },
          create: {
            deliveryOrderId: delivery.id,
            orderId: delivery.orderId,
            manufacturerId: delivery.manufacturerId,
            state: "RETURN_REQUESTED",
            returnReason: payload.reason || payload.message || "NCM reported a returned delivery",
            ncmReturnComment: payload.comment || payload.reason || payload.message || null,
            ncmReturnRequestedAt: new Date(),
          },
          update: {
            state: "RETURN_REQUESTED",
            ncmReturnComment: payload.comment || payload.reason || payload.message || undefined,
          },
        });
        await tx.deliveryFinancialSettlement.upsert({
          where: { deliveryOrderId: delivery.id },
          create: {
            deliveryOrderId: delivery.id,
            ncmOrderId: delivery.ncmOrderId,
            codExpected: 0,
            deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
            deliveryFeeActual: Number(delivery.ncmDeliveryCharge || 0),
            settlementState: "RETURN_PENDING",
            varianceReason: "NCM reported a returned delivery; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
          },
          update: {
            codExpected: 0,
            settlementState: "RETURN_PENDING",
            varianceReason: "NCM reported a returned delivery; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
          },
        });
      }

      // Create or update Financial Settlement upon delivery
      if (deliveryState === "DELIVERED" && delivery.codAmount > 0) {
        await tx.deliveryFinancialSettlement.upsert({
          where: { deliveryOrderId: delivery.id },
          create: {
            deliveryOrderId: delivery.id,
            ncmOrderId: delivery.ncmOrderId,
            codExpected: delivery.codAmount,
            deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
            deliveryFeeActual: Number(delivery.ncmDeliveryCharge || delivery.customerDeliveryCharge || 0),
            settlementState: "PENDING",
          },
          update: {
            codExpected: delivery.codAmount,
            ncmOrderId: delivery.ncmOrderId,
          },
        }).catch((err) => {
          logger.warn("Financial settlement upsert notice", { error: err.message });
        });
      }

      return record;
    });

    results.push(updated);
  }
  return results;
};

export const storeAndApplyWebhook = async (payload) => {
  // Handle test webhooks sent from NCM Vendor Portal
  if (
    payload.test === true ||
    payload.test === "true" ||
    String(payload.order_id || "").toUpperCase().startsWith("TEST-")
  ) {
    logger.info("NCM test webhook received and acknowledged", { payload });
    return { duplicate: false, test: true, updated: [] };
  }

  const ids = webhookIdentifiers(payload);
  const eventKey = statusEventKey({
    orderId: ids.join(","),
    status: payload.status,
    timestamp: payload.timestamp,
    event: payload.event,
  });

  try {
    await prisma.ncmWebhookEvent.create({
      data: {
        eventKey,
        event: payload.event || null,
        orderId: payload.order_id ? String(payload.order_id) : null,
        orderIds: payload.order_ids || null,
        status: payload.status || null,
        timestamp: payload.timestamp ? new Date(payload.timestamp) : null,
        payloadJson: sanitizePayload(payload),
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      // Event already recorded; re-apply in case order was created after previous webhook attempt
      const updated = await applyNcmStatus({ payload });
      return { duplicate: true, updated };
    }
    throw error;
  }

  try {
    const updated = await applyNcmStatus({ payload });
    await prisma.ncmWebhookEvent.update({
      where: { eventKey },
      data: { processingStatus: "PROCESSED", processedAt: new Date() },
    });
    return { duplicate: false, updated };
  } catch (error) {
    await prisma.ncmWebhookEvent.update({
      where: { eventKey },
      data: { processingStatus: "FAILED", processingError: error.message },
    }).catch(() => {});
    throw error;
  }
};

const parseNcmOrderId = (payload) => Number(payload.order_id ?? payload.orderid ?? payload.id);

export const storeOrderCommentWebhook = async (payload) => {
  const ncmOrderId = parseNcmOrderId(payload);
  const comments = String(payload.comments ?? payload.comment ?? payload.message ?? "").trim();
  if (!Number.isInteger(ncmOrderId) || ncmOrderId <= 0 || !comments) {
    const error = new Error("Order comment webhook requires a valid order ID and comment");
    error.code = "INVALID_ORDER_COMMENT_WEBHOOK";
    throw error;
  }

  const addedAt = payload.added_time || payload.addedAt || payload.timestamp;
  const eventKey = statusEventKey({
    orderId: String(ncmOrderId),
    status: comments,
    timestamp: addedAt || "",
    event: "order.comment.created",
  });
  const delivery = await prisma.deliveryOrder.findFirst({ where: { ncmOrderId } });

  try {
    const comment = await prisma.deliveryComment.create({
      data: {
        deliveryOrderId: delivery?.id || null,
        ncmOrderId,
        comments,
        addedBy: String(payload.addedBy ?? payload.added_by ?? "NCM").slice(0, 150),
        addedAt: addedAt ? new Date(addedAt) : null,
        payloadJson: sanitizePayload(payload),
        eventKey,
      },
    });

    if (delivery) {
      await createEvent(prisma, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source: "NCM_COMMENT_WEBHOOK",
        eventType: "NCM_COMMENT_RECEIVED",
        ncmStatus: delivery.ncmStatus,
        payloadJson: { commentId: comment.id, comments, addedBy: comment.addedBy },
        idempotencyKey: `NCM_COMMENT:${eventKey}`,
        occurredAt: comment.addedAt || new Date(),
      });
    }
    return { duplicate: false, comment, matchedDelivery: Boolean(delivery) };
  } catch (error) {
    if (error.code === "P2002") return { duplicate: true, matchedDelivery: Boolean(delivery) };
    throw error;
  }
};

export const reconcileDelivery = async (deliveryId) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery?.ncmOrderId) throw new Error("Delivery has no NCM order ID");
  const [detail, statuses, commentsResponse] = await Promise.all([
    getOrder(delivery.ncmOrderId),
    getOrderStatus(delivery.ncmOrderId),
    getOrderComments(delivery.ncmOrderId),
  ]);
  const latest = Array.isArray(statuses.data) ? statuses.data[0] : null;
  if (latest?.status) await applyNcmStatus({ payload: { order_id: delivery.ncmOrderId, status: latest.status, timestamp: latest.added_time, event: "NCM_POLL_STATUS" }, source: "NCM_POLL" });
  const deliveryCharge = Number(detail.data?.delivery_charge ?? delivery.ncmDeliveryCharge ?? 0);
  const codAmount = Number(detail.data?.cod_charge ?? delivery.codAmount ?? 0);
  const paymentStatus = detail.data?.payment_status || null;
  const codCollected = ["completed", "paid", "received", "success"].includes(String(paymentStatus || "").toLowerCase())
    ? codAmount
    : 0;
  const existingSettlement = await prisma.deliveryFinancialSettlement.findUnique({ where: { deliveryOrderId: delivery.id } });
  const nextSettlementState = ["REQUESTED", "SETTLED"].includes(existingSettlement?.settlementState)
    ? existingSettlement.settlementState
    : codCollected > 0 ? "COD_RECEIVED" : "PENDING";
  await prisma.deliveryFinancialSettlement.upsert({
    where: { deliveryOrderId: delivery.id },
    create: {
      deliveryOrderId: delivery.id,
      ncmOrderId: delivery.ncmOrderId,
      codExpected: codAmount,
      deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
      deliveryFeeActual: deliveryCharge,
      codCollected,
      settlementState: nextSettlementState,
    },
    update: {
      ncmOrderId: delivery.ncmOrderId,
      codExpected: codAmount,
      deliveryFeeActual: deliveryCharge,
      codCollected,
      settlementState: nextSettlementState,
    },
  });

  const comments = Array.isArray(commentsResponse.data) ? commentsResponse.data : [];
  for (const comment of comments) {
    const commentsText = String(comment.comments || "").trim();
    if (!commentsText) continue;
    const eventKey = statusEventKey({
      orderId: String(delivery.ncmOrderId),
      status: commentsText,
      timestamp: comment.added_time || "",
      event: "order.comment.created",
    });
    await prisma.deliveryComment.create({
      data: {
        deliveryOrderId: delivery.id,
        ncmOrderId: delivery.ncmOrderId,
        comments: commentsText,
        addedBy: String(comment.addedBy || "NCM").slice(0, 150),
        addedAt: comment.added_time ? new Date(comment.added_time) : null,
        payloadJson: sanitizePayload(comment),
        eventKey,
      },
    }).catch((error) => {
      if (error.code !== "P2002") logger.warn("NCM comment persistence notice", { error: error.message });
    });
  }

  return prisma.deliveryOrder.update({ where: { id: delivery.id }, data: { lastSyncedAt: new Date(), nextSyncAt: new Date(Date.now() + 30 * 60 * 1000), ncmPaymentStatus: paymentStatus, ncmDeliveryCharge: deliveryCharge, syncFailureCount: 0, lastSyncError: null } });
};

export const requestCodSettlement = async ({ bankName, bankAccountName, bankAccountNumber }) => {
  const response = await createCodTransferTicket({ bankName, bankAccountName, bankAccountNumber });
  return response.data;
};

export const reconcileActiveDeliveries = async () => {
  const active = await prisma.deliveryOrder.findMany({
    where: { ncmOrderId: { not: null }, state: { in: ["NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY"] } },
    select: { id: true, ncmOrderId: true },
    take: 100,
  });
  if (!active.length) return [];
  const statusResponse = await getBulkOrderStatuses(active.map((item) => item.ncmOrderId));
  const result = statusResponse.data?.result || {};
  for (const item of active) {
    if (result[String(item.ncmOrderId)]) {
      await applyNcmStatus({ payload: { order_id: item.ncmOrderId, status: result[String(item.ncmOrderId)], event: "NCM_BULK_STATUS" }, source: "NCM_POLL" });
    }
  }
  return active;
};

export const requestDeliveryReturn = async ({ deliveryId, manufacturerId, reason }) => {
  const delivery = await prisma.deliveryOrder.findUnique({
    where: { id: deliveryId },
    include: { order: { select: { paymentMethod: true, payment: true } } },
  });
  if (!delivery || delivery.manufacturerId !== manufacturerId || !delivery.ncmOrderId) throw new Error("Delivery not found or not eligible for return");
  const existing = await prisma.deliveryReturn.findUnique({ where: { deliveryOrderId: deliveryId } });
  if (existing) return existing;
  const response = await requestOrderReturn({ pk: delivery.ncmOrderId, comment: reason });
  return runTransaction(async (tx) => {
    const returned = await tx.deliveryReturn.create({ data: { deliveryOrderId: deliveryId, orderId: delivery.orderId, manufacturerId, returnReason: reason, ncmReturnComment: reason, ncmReturnRequestedAt: new Date(), state: "RETURN_REQUESTED" } });
    await tx.deliveryOrder.update({ where: { id: deliveryId }, data: { state: "RETURN_REQUESTED", ncmStatus: "Return Requested", returnedAt: new Date() } });
    await tx.order.update({
      where: { id: delivery.orderId },
      data: {
        status: "Returned",
        fulfillmentStatus: "return_requested",
        payment: String(delivery.order?.paymentMethod || "COD").toUpperCase() === "COD"
          ? false
          : Boolean(delivery.order?.payment),
      },
    });
    await tx.deliveryFinancialSettlement.upsert({
      where: { deliveryOrderId: deliveryId },
      create: {
        deliveryOrderId: deliveryId,
        ncmOrderId: delivery.ncmOrderId,
        codExpected: 0,
        deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
        deliveryFeeActual: Number(delivery.ncmDeliveryCharge || 0),
        settlementState: "RETURN_PENDING",
        varianceReason: "Carrier return requested; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
      },
      update: {
        codExpected: 0,
        settlementState: "RETURN_PENDING",
        varianceReason: "Carrier return requested; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
      },
    });
    await createEvent(tx, { deliveryOrderId: deliveryId, orderId: delivery.orderId, source: "MANUFACTURER", eventType: "RETURN_REQUESTED", fromState: delivery.state, toState: "RETURN_REQUESTED", actorId: manufacturerId, payloadJson: response.data, idempotencyKey: `RETURN_REQUESTED:${deliveryId}` });
    return returned;
  });
};

