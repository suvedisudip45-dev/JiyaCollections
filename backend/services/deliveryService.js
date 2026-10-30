import crypto from "node:crypto";
import { prisma, reconnectPrisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import {
  createOrder as createNcmOrder,
  getBranches,
  getNcmBranchName,
  getNcmBranchRows,
  createCodTransferTicket,
  extractNcmDeliveryPricing,
  getShippingRate,
  getOrderStatus,
  requestOrderReturn,
  shippingRateTypeForNcm,
  validateNcmPackageName,
} from "./ncmClient.js";
import { validateFulfillmentTransition } from "./fulfillmentStateMachine.js";
import { ensureOrderCardAttached } from "./marketingCardService.js";
import { postConfirmedDeliveryReturnAccounting } from "./accountingPostingEngine.js";
import { enqueueDeliveredSaleAccounting } from "./accountingOutboxService.js";
import { transitionOrderProductionAllocations } from "./manufacturerProductionService.js";
import { accrueCollaborationSalesForOrder } from "./collaborationSalesService.js";
import { applyExchangeNcmStatus } from "./orderExchangeService.js";
import { applyCustomerReturnNcmStatus } from "./customerReturnWorkflowService.js";
import { applyGiftDeliveryTransition } from "./giftService.js";
import { consumeDistributorOrderInventory } from "./distributorOrderInventoryService.js";

const VALID_READY_STATES = new Set(["package_details_complete", "ready_for_pickup"]);
const MAX_NCM_WEBHOOK_ORDER_IDS = 100;
const MAX_NCM_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;
let ncmBranchNamesCache = { expiresAt: 0, names: [] };

export const validateNcmDeliveryPackageDetails = ({ productDescription = "", packageType = "Box" } = {}) => {
  const description = String(productDescription || "").trim();
  if (description.length > 50) {
    throw Object.assign(new Error("Product description cannot exceed 50 characters for NCM delivery."), {
      code: "NCM_PACKAGE_DESCRIPTION_TOO_LONG",
    });
  }
  return validateNcmPackageName(packageType);
};

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

const normalizeNcmStatusText = (value) =>
  String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const NCM_STATUS_ALIASES = new Map([
  ...["delivered", "delivery completed", "order delivered"].map((value) => [
    value,
    { deliveryState: "DELIVERED", canonicalStatus: "Delivered" },
  ]),
  ...["sent for delivery", "out for delivery"].map((value) => [
    value,
    { deliveryState: "OUT_FOR_DELIVERY", canonicalStatus: "Sent for Delivery" },
  ]),
  ...["arrived", "order arrived", "arrived at destination"].map((value) => [
    value,
    { deliveryState: "ARRIVED_AT_DESTINATION", canonicalStatus: "Arrived" },
  ]),
  ...["dispatched", "order dispatched", "order dispached", "in transit"].map((value) => [
    value,
    { deliveryState: "IN_TRANSIT", canonicalStatus: "Dispatched" },
  ]),
  ...["pickup complete", "pickup completed", "picked up", "order pickup"].map((value) => [
    value,
    { deliveryState: "PICKUP_CONFIRMED", canonicalStatus: "Pickup Complete" },
  ]),
  ...["pickup order created", "drop off order created", "sent for pickup", "ready for pickup"].map((value) => [
    value,
    { deliveryState: "NCM_CREATED", canonicalStatus: "Pickup Order Created" },
  ]),
  ...["returned", "return requested", "vendor return", "order return"].map((value) => [
    value,
    { deliveryState: "RETURN_REQUESTED", canonicalStatus: "Returned" },
  ]),
]);

const DELIVERY_STATE_RANK = {
  READY_TO_DELIVER: 0,
  BOOKED: 0,
  NCM_CREATED: 1,
  PICKUP_CONFIRMED: 2,
  IN_TRANSIT: 3,
  ARRIVED_AT_DESTINATION: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
  RETURN_REQUESTED: 7,
  RETURNED: 8,
  CANCELLED: 8,
};

/**
 * Normalizes any NCM event, status, or raw string variation into
 * canonical delivery state, assignment status, fulfillment status, and display status.
 */
export const normalizeDeliveryStatus = (rawStatus = "", rawEvent = "") => {
  const statusText = normalizeNcmStatusText(rawStatus);
  const eventText = normalizeNcmStatusText(rawEvent);
  const statusMatch = NCM_STATUS_ALIASES.get(statusText);
  const eventMatch = NCM_STATUS_ALIASES.get(eventText);
  const isGenericStatus = ["", "update received", "status changed", "order status changed"].includes(statusText);
  const mapped = statusMatch || (isGenericStatus ? eventMatch : null);
  const conflictingStatuses = statusMatch && eventMatch &&
    statusMatch.deliveryState !== eventMatch.deliveryState;

  if (mapped && !conflictingStatuses) {
    const summary = syncSummary(mapped.deliveryState);
    return {
      deliveryState: mapped.deliveryState,
      assignmentStatus: mapped.deliveryState === "NCM_CREATED" ? "ready_for_pickup" : summary,
      fulfillmentStatus: summary,
      canonicalStatus: mapped.canonicalStatus,
    };
  }

  return {
    deliveryState: "NEEDS_RECONCILIATION",
    assignmentStatus: null,
    fulfillmentStatus: null,
    canonicalStatus: String(rawStatus || rawEvent || "Status unavailable").trim().slice(0, 191),
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

const resolvePickupBranch = (manufacturer, address, assignment) => {
  if (assignment?.distributorId) {
    return normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  }
  const direct = normalizeBranch(manufacturer?.ncmPickupBranch || manufacturer?.pickupBranch || "");
  return direct;
};

export const deliveryTypeForNcm = (deliveryType = "Door2Door") => {
  const allowed = new Set(["Door2Door", "Branch2Door", "Branch2Branch", "Door2Branch"]);
  return allowed.has(deliveryType) ? deliveryType : "Door2Door";
};

export const statusEventKey = ({ orderId, status, timestamp, event }) =>
  crypto.createHash("sha256").update(JSON.stringify({ orderId, status, timestamp, event })).digest("hex");

export const sanitizeNcmWebhookPayload = (payload) => {
  const sensitiveKey = /(?:token|secret|authorization|password|api[_-]?key)/i;
  const sanitize = (value, depth = 0) => {
    if (depth > 12) return "[TRUNCATED]";
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : sanitize(entry, depth + 1),
      ]));
    }
    return value;
  };
  if (!payload || typeof payload !== "object") return {};
  return sanitize(payload);
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

export const getCarrierBookingAssignmentStatus = ({ success, currentStatus, previousStatus }) => {
  if (success) {
    return "ready_for_pickup";
  }

  return previousStatus || currentStatus || "package_details_complete";
};

export const assignmentStatusFromNcmStatus = (status) => {
  return normalizeDeliveryStatus(status).assignmentStatus;
};

const webhookIdentifierValues = (payload = {}) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return [
    payload.order_id,
    payload.orderid,
    payload.orderId,
    payload.vref_id,
    payload.vendorReference,
    payload.delivery_order_id,
    ...(Array.isArray(payload.order_ids) ? payload.order_ids : []),
  ].filter((value) => value !== undefined && value !== null && value !== "");
};

const isValidWebhookIdentifier = (value) =>
  (typeof value === "string" && value.trim().length > 0 && value.trim().length <= 191 && !/[\u0000-\u001f\u007f]/.test(value)) ||
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0);

export const webhookIdentifiers = (payload = {}) => {
  const values = webhookIdentifierValues(payload);
  return [...new Set(values
    .filter(isValidWebhookIdentifier)
    .map((value) => String(value).trim()))];
};

export const validateNcmWebhookPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, statusCode: 400, message: "Invalid webhook payload" };
  }
  if (payload.order_ids !== undefined && !Array.isArray(payload.order_ids)) {
    return { valid: false, statusCode: 400, message: "NCM order_ids must be an array" };
  }
  if (Array.isArray(payload.order_ids) && payload.order_ids.length > MAX_NCM_WEBHOOK_ORDER_IDS) {
    return { valid: false, statusCode: 413, message: "NCM webhook contains too many order IDs" };
  }
  if (
    (payload.status !== undefined && payload.status !== null && typeof payload.status !== "string") ||
    (payload.event !== undefined && payload.event !== null && typeof payload.event !== "string")
  ) {
    return { valid: false, statusCode: 400, message: "NCM status and event values must be strings" };
  }
  if (!String(payload.status || "").trim() && !String(payload.event || "").trim()) {
    return { valid: false, statusCode: 400, message: "NCM webhook must include a status or event" };
  }
  let serializedPayload;
  try {
    serializedPayload = JSON.stringify(payload);
  } catch {
    return { valid: false, statusCode: 400, message: "Invalid webhook payload" };
  }
  if (Buffer.byteLength(serializedPayload, "utf8") > MAX_NCM_WEBHOOK_PAYLOAD_BYTES) {
    return { valid: false, statusCode: 413, message: "NCM webhook payload is too large" };
  }
  const identifiers = webhookIdentifiers(payload);
  if (!identifiers.length) {
    return { valid: false, statusCode: 400, message: "Webhook payload has no valid order ID" };
  }
  return {
    valid: true,
    identifiers,
    invalidIdentifierCount: webhookIdentifierValues(payload).filter((value) => !isValidWebhookIdentifier(value)).length,
  };
};

const findDeliveryOrdersForNcmId = async (ncmId) => {
  const numericId = Number(ncmId);
  const candidates = [];
  if (/^\d+$/.test(ncmId) && Number.isSafeInteger(numericId) && numericId > 0) {
    candidates.push({ ncmOrderId: numericId });
  }
  candidates.push(
    { vendorReference: ncmId },
    { orderId: ncmId },
    { id: ncmId },
  );
  return prisma.deliveryOrder.findMany({
    where: { OR: candidates },
    include: {
      order: { select: { paymentMethod: true, payment: true } },
      events: {
        where: { source: { in: ["NCM_WEBHOOK", "ADMIN_RECONCILIATION", "ADMIN_RECONCILIATION_DECISION"] } },
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { occurredAt: true },
      },
    },
    take: 2,
  });
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
    packageWeight: data.packageWeight ?? "",
    packageDimensions: String(data.packageDimensions || "").trim(),
    packagingNotes: String(data.packagingNotes || "").trim(),
  };
};

export const normalizePackageWeight = (value) => {
  const weight = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(weight) && weight > 0 ? weight : null;
};

export const buildDeliveryInput = ({ order, assignment, manufacturer, packagingMeta = {}, itemsOverride = null }) => {
  const address = parseJson(order.address, {});
  const items = itemsOverride || parseJson(order.items, []);
  const origin = resolvePickupBranch(manufacturer, address, assignment);
  const destination = normalizeBranch(address.ncmBranch || address.city);
  if (!origin) {
    const error = new Error(
      assignment?.distributorId
        ? "Distributor NCM pickup branch is required before booking customer delivery."
        : "Manufacturer NCM pickup branch is required. Ask admin to assign and verify the pickup branch before readying the order.",
    );
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
  const customerAddress = [address.ncmCoveredArea, address.street || address.address]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
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
  const packageDimensions = String(packagingMeta.packageDimensions || meta.packageDimensions || "").trim();
  const packagingNotes = String(packagingMeta.packagingNotes || meta.packagingNotes || "").trim();

  const packageDescription = [
    productDescription,
    packageDimensions ? `Dimensions: ${packageDimensions}` : "",
    isFragile ? "Fragile" : "Standard",
    packagingNotes ? `Inspection/packaging: ${packagingNotes}` : "",
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
    packageDimensions,
    packagingNotes,
    instruction,
    packageDescription,
    vendorReference,
    codAmount: itemAmount,
    originCandidates: origin === "KATHMANDU" ? ["TINKUNE", origin] : [origin],
  };
};

export const buildNcmOrderPayload = ({
  input,
  delivery,
  origin,
  destination,
}) => ({
  name: input.name,
  phone: input.phone,
  phone2: input.address.phone2 || "",
  cod_charge: String(input.codAmount),
  address: input.customerAddress,
  fbranch: origin,
  branch: destination,
  package: input.packageDescription,
  package_type: input.packageType,
  handling: input.isFragile ? "Fragile" : "Non-Fragile",
  vref_id: input.vendorReference,
  instruction: String(input.instruction || input.address.deliveryInstruction || "").slice(0, 500),
  delivery_type: input.deliveryType,
  weight: String(Math.max(0.1, Number(delivery.packageWeight || 1))),
});

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

export const isDeliveryOrderOwner = ({ order, assignment, distributorId, manufacturerId }) => Boolean(
  order &&
  assignment &&
  (
    (distributorId && assignment.distributorId === distributorId && (!order.distributorId || order.distributorId === distributorId)) ||
    (manufacturerId && assignment.manufacturerId === manufacturerId && order.manufacturerId === manufacturerId) ||
    (!distributorId && !manufacturerId)
  )
);

export const prepareReadyDelivery = async ({ orderId, distributorId, manufacturerId, adminId, packageWeight, packageDimensions, packagingNotes, productType, productDescription, packageType, isFragile, deliveryInstruction, instruction, packagingChecklist, allowRetryAfterUnknown = false }) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    const error = new Error("Order not found or unauthorized");
    error.code = "DELIVERY_NOT_FOUND";
    throw error;
  }

  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId } });
  const isAssignmentOwner = assignment && (
    (distributorId && assignment.distributorId === distributorId) ||
    (manufacturerId && assignment.manufacturerId === manufacturerId) ||
    (adminId && !distributorId && !manufacturerId)
  );
  if (!assignment || !isAssignmentOwner) {
    const error = new Error("Fulfillment assignment not found");
    error.code = "DELIVERY_ASSIGNMENT_NOT_FOUND";
    throw error;
  }
  if (!isDeliveryOrderOwner({ order, assignment, distributorId, manufacturerId })) {
    const error = new Error("Order not found or unauthorized");
    error.code = "DELIVERY_NOT_FOUND";
    throw error;
  }

  await ensureOrderCardAttached({
    orderId,
    manufacturerId: assignment.manufacturerId || manufacturerId,
    distributorId: assignment.distributorId || distributorId,
  });

  const existingNotes = parsePackagingMeta(assignment.notes);
  const { deliveryOnHold: _deliveryOnHold, deliveryOnHoldAt: _deliveryOnHoldAt, ...existingPackagingNotes } = existingNotes;
  const packagingMeta = {
    ...existingPackagingNotes,
    packageWeight: packageWeight ?? existingPackagingNotes.packageWeight ?? "",
    productType: productType ?? existingPackagingNotes.productType ?? "",
    productDescription: productDescription ?? existingPackagingNotes.productDescription ?? "",
    packageType: packageType ?? existingPackagingNotes.packageType ?? "Box",
    isFragile: isFragile !== undefined ? parseBoolean(isFragile) : parseBoolean(existingPackagingNotes.isFragile),
    deliveryInstruction: deliveryInstruction ?? instruction ?? existingPackagingNotes.deliveryInstruction ?? "",
    packagingNotes: packagingNotes ?? existingPackagingNotes.packagingNotes ?? "",
    packageDimensions: packageDimensions ?? existingPackagingNotes.packageDimensions ?? "",
    packagingChecklist: packagingChecklist ?? existingPackagingNotes.packagingChecklist ?? null,
  };

  validateNcmDeliveryPackageDetails(packagingMeta);

  const isAdminRequest = Boolean(adminId && !distributorId && !manufacturerId);
  const normalizedWeight = normalizePackageWeight(packagingMeta.packageWeight);
  if (isAdminRequest && (
    !normalizedWeight ||
    !String(packagingMeta.packageDimensions || "").trim() ||
    !String(packagingMeta.productType || "").trim() ||
    !String(packagingMeta.productDescription || "").trim() ||
    !String(packagingMeta.packageType || "").trim()
  )) {
    const error = new Error("Product type, product description, package type, package weight, and package dimensions are required before NCM booking.");
    error.code = "DELIVERY_PACKAGE_DETAILS_REQUIRED";
    throw error;
  }
  const effectiveWeight = normalizedWeight || normalizePackageWeight(existingNotes.packageWeight) || 1;
  packagingMeta.packageWeight = effectiveWeight;

  let effectiveAssignment = assignment;
  let persistedAssignmentStatus = assignment.status;
  if (
    String(assignment.status || "").toLowerCase() === "on_hold" &&
    assignment.deliveryType === "NCM" &&
    existingNotes.deliveryOnHold === true
  ) {
    effectiveAssignment = { ...assignment, status: "package_details_complete" };
  }
  if (isAdminRequest) {
    const currentStatus = String(assignment.status || "").toLowerCase();
    if (!["packed", "package_details_complete", "ready_for_pickup"].includes(currentStatus)) {
      const error = new Error("The fulfillment hub must pack and quality-check this order before admin can request NCM delivery.");
      error.code = "DELIVERY_INVALID_STATE";
      throw error;
    }
    if (currentStatus === "packed") {
      const packageTransition = validateFulfillmentTransition({
        currentStatus,
        nextStatus: "package_details_complete",
        notes: assignment.notes,
        packageData: packagingMeta,
        workflowType: assignment.distributorId ? "DISTRIBUTOR" : "MANUFACTURER",
      });
      if (!packageTransition.valid) {
        const error = new Error(packageTransition.message);
        error.code = "DELIVERY_INVALID_STATE";
        throw error;
      }
      effectiveAssignment = await prisma.orderAssignment.update({
        where: { id: assignment.id },
        data: { status: "package_details_complete", notes: JSON.stringify(packagingMeta) },
      });
      persistedAssignmentStatus = effectiveAssignment.status;
      await prisma.order.update({
        where: { id: orderId },
        data: { fulfillmentStatus: "package_details_complete" },
      });
    }
  }

  const transition = validateFulfillmentTransition({
    currentStatus: effectiveAssignment.status,
    nextStatus: "ready_for_pickup",
    notes: effectiveAssignment.notes,
    packageData: packagingMeta,
    workflowType: effectiveAssignment.distributorId ? "DISTRIBUTOR" : "MANUFACTURER",
  });
  if (!transition.valid && effectiveAssignment.status !== "ready_for_pickup") {
    const error = new Error(transition.message);
    error.code = "DELIVERY_INVALID_STATE";
    throw error;
  }

  const existing = await prisma.deliveryOrder.findUnique({ where: { orderId } });
  const latestCreateAttempt = existing
    ? await prisma.ncmRequestAttempt.findFirst({
        where: { deliveryOrderId: existing.id, operation: "CREATE_ORDER" },
        orderBy: { attemptNumber: "desc" },
      })
    : null;
  const handoffOutcomeUnknown = existing?.state === "NCM_SUBMISSION_STARTED" || ["STARTED", "UNKNOWN"].includes(latestCreateAttempt?.result);
  if (existing && handoffOutcomeUnknown && !(allowRetryAfterUnknown && existing.state === "SUBMISSION_FAILED")) {
    return { delivery: existing, alreadySubmitted: true, recoveryRequired: true };
  }
  const submittedStates = ["NCM_SUBMISSION_STARTED", "NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED"];
  if (existing && submittedStates.includes(existing.state)) {
    return { delivery: existing, alreadySubmitted: true };
  }

  const isPacked = VALID_READY_STATES.has(effectiveAssignment.status);
  const isRetryingHandoff = effectiveAssignment.status === "ready_for_pickup" && existing && ["SUBMISSION_PENDING", "SUBMISSION_FAILED"].includes(existing.state);
  if (!isPacked && !isRetryingHandoff) {
    const error = new Error(`Order must be packed before delivery submission; current state is ${effectiveAssignment.status}`);
    error.code = "DELIVERY_INVALID_STATE";
    throw error;
  }

  const assignedDistributorId = effectiveAssignment.distributorId || distributorId || null;
  const assignedManufacturerId = effectiveAssignment.manufacturerId || manufacturerId || null;
  const activeDistributor = assignedDistributorId ? await prisma.distributor.findUnique({ where: { id: assignedDistributorId } }) : null;
  const activeManufacturer = assignedManufacturerId ? await prisma.manufacturer.findUnique({ where: { id: assignedManufacturerId } }) : null;
  const originEntity = activeDistributor || activeManufacturer;

  const input = buildDeliveryInput({ order, assignment: effectiveAssignment, manufacturer: originEntity, packagingMeta });

  logger.info("Prepared NCM delivery payload", {
    orderId,
    distributorId,
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
            packageWeight: effectiveWeight,
            assignmentId: effectiveAssignment.id,
            manufacturerId: assignedManufacturerId,
            distributorId: assignedDistributorId,
            lastSyncError: null,
          },
        })
      : await tx.deliveryOrder.create({
          data: {
            orderId,
            assignmentId: effectiveAssignment.id,
            manufacturerId: assignedManufacturerId,
            distributorId: assignedDistributorId,
            state: "SUBMISSION_PENDING",
            deliveryType: input.deliveryType,
            packageDescription: input.packageDescription,
            originBranchName: input.origin,
            destinationBranchName: input.destination,
            itemAmount: input.itemAmount,
            codAmount: input.codAmount,
            packageWeight: effectiveWeight,
            vendorReference: input.vendorReference,
          },
        });

    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: "submission_pending" },
    });
    const assignmentClaim = await tx.orderAssignment.updateMany({
      where: {
        id: assignment.id,
        status: persistedAssignmentStatus,
        deliveryType: effectiveAssignment.deliveryType,
      },
      data: {
        status: effectiveAssignment.status,
        deliveryType: "NCM",
        notes: JSON.stringify({
          ...packagingMeta,
        }),
      },
    });
    if (assignmentClaim.count !== 1) {
      const error = new Error("The delivery method changed while booking NCM. Refresh and try again.");
      error.code = "DELIVERY_METHOD_CHANGED";
      throw error;
    }
    await createEvent(tx, {
      deliveryOrderId: record.id,
      orderId,
      source: adminId ? "ADMIN" : distributorId ? "DISTRIBUTOR" : "MANUFACTURER",
      eventType: "READY_TO_DELIVER",
      fromState: existing?.state || effectiveAssignment.status,
      toState: "SUBMISSION_PENDING",
      actorId: adminId || distributorId || manufacturerId,
      idempotencyKey: `READY_TO_DELIVER:${record.id}:${record.packageVersion}`,
    });
    return record;
  });

  return { delivery, input };
};

export const submitDeliveryToNcm = async (deliveryId, { allowRetryAfterUnknown = false } = {}) => {
  const delivery = await prisma.deliveryOrder.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw new Error("Delivery not found");
  if (delivery.ncmOrderId) return delivery;
  if (delivery.state === "NCM_SUBMISSION_STARTED") {
    const error = new Error("NCM order creation is already in progress or has an unknown result. Reconcile it before retrying.");
    error.code = "NCM_SUBMISSION_UNKNOWN";
    throw error;
  }
  if (delivery.state !== "SUBMISSION_PENDING") throw new Error(`Delivery is not awaiting submission: ${delivery.state}`);

  const order = await prisma.order.findUnique({ where: { id: delivery.orderId } });
  if (!order || order.status === "Cancelled") {
    const error = new Error("Cancelled orders cannot be submitted to NCM.");
    error.code = "ORDER_CANCELLED";
    throw error;
  }
  const manufacturer = delivery.manufacturerId
    ? await prisma.manufacturer.findUnique({ where: { id: delivery.manufacturerId } })
    : null;
  const distributor = delivery.distributorId
    ? await prisma.distributor.findUnique({ where: { id: delivery.distributorId } })
    : null;
  const assignment = await prisma.orderAssignment.findUnique({ where: { orderId: delivery.orderId } });
  const assignmentNotes = parsePackagingMeta(assignment?.notes);
  const input = buildDeliveryInput({
    order,
    assignment,
    manufacturer: distributor || manufacturer,
    packagingMeta: assignmentNotes,
  });
  validateNcmDeliveryPackageDetails(input);
  const priorAttempts = await prisma.ncmRequestAttempt.findMany({
    where: { deliveryOrderId: delivery.id, operation: "CREATE_ORDER" },
    orderBy: { attemptNumber: "desc" },
  });
  const priorAttempt = priorAttempts[0] || null;
  if (priorAttempt?.result === "SUCCESS") return prisma.deliveryOrder.findUnique({ where: { id: delivery.id } });
  const explicitlyRejected = priorAttempt?.result === "RESOLVED_NOT_CREATED" ||
    (priorAttempt?.result === "FAILED" && Number(priorAttempt.httpStatus) >= 400 && Number(priorAttempt.httpStatus) < 500);
  if (priorAttempt && !explicitlyRejected && !allowRetryAfterUnknown) {
    const error = new Error("An NCM create attempt already exists and may have reached the carrier. Reconcile it before retrying.");
    error.code = "NCM_SUBMISSION_UNKNOWN";
    throw error;
  }
  const attemptNumber = Number(priorAttempt?.attemptNumber || 0) + 1;
  const attemptKey = `NCM_CREATE:${delivery.id}:${delivery.packageVersion}:${attemptNumber}`;
  let attempt = null;

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
    const ncmPricing = extractNcmDeliveryPricing(rate, { allowGenericDiscount: true });
    if (!ncmPricing) {
      throw Object.assign(new Error("NCM returned no valid delivery charge for this route."), {
        code: "NCM_RATE_INVALID",
      });
    }
    const ncmPayload = buildNcmOrderPayload({
      input,
      delivery,
      origin: resolvedOrigin,
      destination: resolvedDestination,
    });

    logger.info("NCM create payload ready", {
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      manufacturerId: delivery.manufacturerId,
      distributorId: delivery.distributorId,
      fbranch: ncmPayload.fbranch,
      branch: ncmPayload.branch,
      delivery_type: ncmPayload.delivery_type,
      weight: ncmPayload.weight,
      cod_charge: ncmPayload.cod_charge,
      package: ncmPayload.package,
      package_type: ncmPayload.package_type,
      handling: ncmPayload.handling,
      vref_id: ncmPayload.vref_id,
      phone: "[REDACTED]",
      address: "[REDACTED]",
      instruction: "[REDACTED]",
    });

    attempt = await prisma.$transaction(async (tx) => {
      const orderClaim = await tx.order.updateMany({
        where: { id: delivery.orderId, status: { not: "Cancelled" } },
        data: { fulfillmentStatus: "ncm_submission_started" },
      });
      if (orderClaim.count !== 1) {
        const error = new Error("The order was cancelled before NCM handoff.");
        error.code = "ORDER_CANCELLED";
        throw error;
      }
      const deliveryClaim = await tx.deliveryOrder.updateMany({
        where: { id: delivery.id, state: "SUBMISSION_PENDING", ncmOrderId: null },
        data: { state: "NCM_SUBMISSION_STARTED" },
      });
      if (deliveryClaim.count !== 1) {
        const error = new Error("The delivery changed before NCM handoff. Reconcile before retrying.");
        error.code = "NCM_SUBMISSION_UNKNOWN";
        throw error;
      }
      return tx.ncmRequestAttempt.create({
        data: {
          deliveryOrderId: delivery.id,
          operation: "CREATE_ORDER",
          idempotencyKey: attemptKey,
          attemptNumber,
          requestUrl: "/api/v1/order/create",
          requestJson: ncmPayload,
          result: "STARTED",
        },
      });
    }, { isolationLevel: "Serializable" });

    const response = await createNcmOrder(ncmPayload);
    const ncmOrderId = Number(response.data?.orderid);
    if (!Number.isInteger(ncmOrderId)) throw new Error("NCM did not return a valid order ID");
    const bookedPricing = extractNcmDeliveryPricing(response, { allowGenericDiscount: true }) || ncmPricing;

    const updated = await runTransaction(async (tx) => {
      const record = await tx.deliveryOrder.update({
        where: { id: delivery.id },
        data: {
          state: "NCM_CREATED",
          ncmOrderId,
          ncmStatus: "Pickup Order Created",
          originBranchName: resolvedOrigin,
          destinationBranchName: resolvedDestination,
          ncmDeliveryCharge: bookedPricing.actualCharge,
          ncmDeliveryChargeBeforeDiscount: bookedPricing.chargeBeforeDiscount,
          ncmDeliveryDiscount: bookedPricing.discountAmount,
          customerDeliveryCharge: Number(order.deliveryFee ?? bookedPricing.actualCharge),
          ncmCreatedAt: new Date(),
          lastSyncedAt: new Date(),
          nextSyncAt: null,
          lastSyncError: null,
        },
      });
      await tx.ncmRequestAttempt.update({
        where: { id: attempt.id },
        data: { result: "SUCCESS", httpStatus: response.httpStatus, responseJson: response.data, finishedAt: new Date() },
      });
      await tx.order.update({ where: { id: delivery.orderId }, data: { fulfillmentStatus: "ncm_created", deliveryJobId: delivery.id } });
      await tx.orderAssignment.updateMany({
        where: { orderId: delivery.orderId },
        data: {
          status: getCarrierBookingAssignmentStatus({ success: true, currentStatus: assignment?.status || "package_details_complete" }),
          readyAt: new Date(),
        },
      });
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source: "SYSTEM",
        eventType: "NCM_ORDER_CREATED",
        fromState: "NCM_SUBMISSION_STARTED",
        toState: "NCM_CREATED",
        ncmStatus: "Pickup Order Created",
        payloadJson: { orderid: ncmOrderId },
        idempotencyKey: `NCM_ORDER_CREATED:${delivery.id}:${ncmOrderId}`,
      });
      return record;
    });
    return updated;
  } catch (error) {
    if (attempt) {
      const unknownOutcome = !error.httpStatus || Number(error.httpStatus) >= 500 || error.code === "NCM_TIMEOUT";
      await prisma.ncmRequestAttempt.update({
        where: { id: attempt.id },
        data: {
          result: unknownOutcome ? "UNKNOWN" : "FAILED",
          httpStatus: error.httpStatus || null,
          responseJson: error.response || null,
          errorCode: error.code || "NCM_REQUEST_FAILED",
          errorMessage: error.message,
          finishedAt: new Date(),
        },
      }).catch(() => {});
      if (!unknownOutcome && Number(error.httpStatus) >= 400 && Number(error.httpStatus) < 500) {
        await prisma.order.updateMany({
          where: { id: delivery.orderId, fulfillmentStatus: "ncm_submission_started" },
          data: { fulfillmentStatus: "ready_for_pickup" },
        });
      }
    }
    await prisma.deliveryOrder.updateMany({
      where: { id: delivery.id, state: { not: "CANCELLED" } },
      data: { state: "SUBMISSION_FAILED", lastSyncError: error.message, syncFailureCount: { increment: 1 } },
    });
    await prisma.orderAssignment.updateMany({
      where: { orderId: delivery.orderId },
      data: {
        status: getCarrierBookingAssignmentStatus({
          success: false,
          currentStatus: assignment?.status || "package_details_complete",
          previousStatus: assignment?.status || "package_details_complete",
        }),
      },
    });
    throw error;
  }
};

const findOtherCustomerNcmRecords = async (ncmId) => {
  if (!/^\d+$/.test(ncmId)) return [];
  const numericId = Number(ncmId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return [];
  const [returns, exchanges] = await Promise.all([
    prisma.customerReturn.findMany({
      where: {
        requestKey: { not: null },
        lifecycleStatus: {
          in: ["APPROVED_BY_ADMIN", "SUBMITTING", "NCM_SUBMISSION_UNKNOWN", "NCM_RETURN_INITIATED", "RETURN_IN_TRANSIT"],
        },
        OR: [{ originalNcmOrderId: numericId }, { ncmReturnOrderId: numericId }],
      },
      select: { id: true },
      take: 2,
    }),
    prisma.orderExchangeRequest.findMany({
      where: { OR: [{ ncmReturnOrderId: numericId }, { ncmReplacementOrderId: numericId }] },
      select: { id: true },
      take: 2,
    }),
  ]);
  return [
    ...returns.map(({ id }) => ({ type: "customerReturn", id })),
    ...exchanges.map(({ id }) => ({ type: "orderExchange", id })),
  ];
};

export const applyNcmStatus = async ({
  payload,
  source = "NCM_WEBHOOK",
  onStockTransferStatus = null,
  actorId = null,
}) => {
  const ids = webhookIdentifiers(payload);
  const results = [];
  for (const ncmId of ids) {
    const trimmedId = String(ncmId || "").trim();
    if (!trimmedId) continue;
    const stockTransferShipments = await prisma.stockTransferShipment.findMany({
      where: {
        bookingMode: "NCM",
        OR: [{ ncmOrderId: trimmedId }, { externalReference: trimmedId }],
      },
      select: { id: true },
      take: 2,
    });
    if (stockTransferShipments.length > 1) {
      logger.error("Ambiguous NCM webhook identifier matches multiple stock-transfer shipments", {
        ncmId: trimmedId,
        shipmentIds: stockTransferShipments.map(({ id }) => id),
      });
      results.push({ ncmId: trimmedId, ambiguous: true });
      continue;
    }
    if (stockTransferShipments.length === 1) {
      const [deliveryOrders, otherCustomerRecords] = await Promise.all([
        findDeliveryOrdersForNcmId(trimmedId),
        findOtherCustomerNcmRecords(trimmedId),
      ]);
      if (deliveryOrders.length || otherCustomerRecords.length) {
        logger.error("Ambiguous NCM webhook identifier matches both stock-transfer and customer-delivery records", {
          ncmId: trimmedId,
          shipmentId: stockTransferShipments[0].id,
          deliveryOrderIds: deliveryOrders.map(({ id }) => id),
          customerRecords: otherCustomerRecords,
        });
        results.push({ ncmId: trimmedId, ambiguous: true });
        continue;
      }
      const handled = onStockTransferStatus
        ? await onStockTransferStatus({ payload, ncmId: trimmedId, source })
        : false;
      if (handled) {
        results.push({
          ncmId: trimmedId,
          stockTransferShipment: true,
          ...(typeof handled === "object" ? handled : {}),
        });
        continue;
      }
      const ncmStatus = String(payload.status || payload.event || "").trim().slice(0, 191);
      await prisma.stockTransferShipment.update({
        where: { id: stockTransferShipments[0].id },
        data: {
          ...(ncmStatus ? { ncmStatus } : {}),
          ncmLastSyncedAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        },
      });
      results.push({ ncmId: trimmedId, stockTransferShipment: true });
      continue;
    }
    const deliveryOrders = await findDeliveryOrdersForNcmId(trimmedId);
    if (deliveryOrders.length > 1) {
      logger.error("Ambiguous NCM webhook identifier matches multiple customer-delivery records", {
        ncmId: trimmedId,
        deliveryOrderIds: deliveryOrders.map(({ id }) => id),
      });
      results.push({ ncmId: trimmedId, ambiguous: true });
      continue;
    }
    const appliedReturnStatus = await applyCustomerReturnNcmStatus({
      ncmOrderId: trimmedId,
      status: payload.status,
      event: payload.event,
      timestamp: payload.timestamp,
    });
    if (appliedReturnStatus) {
      results.push({ ncmId: trimmedId, customerReturn: true });
      continue;
    }

    // Resolve delivery order by NCM ID, vendor reference, order ID, or delivery ID.
    const delivery = deliveryOrders[0] || null;

    if (!delivery) {
      const numericId = Number(trimmedId);
      if (/^\d+$/.test(trimmedId) && Number.isSafeInteger(numericId) && numericId > 0) {
        const matchedExchange = await applyExchangeNcmStatus({
          ncmOrderId: numericId,
          status: payload.status,
          event: payload.event,
          timestamp: payload.timestamp,
          source,
        });
        if (matchedExchange) {
          results.push({ ncmId: trimmedId, exchange: true });
          continue;
        }
      }
      logger.warn("Delivery order not found for NCM webhook ID", {
        ncmId: trimmedId,
        status: typeof payload.status === "string" ? payload.status.slice(0, 191) : null,
        event: typeof payload.event === "string" ? payload.event.slice(0, 191) : null,
      });
      continue;
    }

    const { deliveryState, assignmentStatus, fulfillmentStatus, canonicalStatus } = normalizeDeliveryStatus(
      payload.status,
      payload.event
    );
    const receivedAt = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const occurredAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;
    const currentRank = DELIVERY_STATE_RANK[delivery.state] ?? -1;
    const nextRank = DELIVERY_STATE_RANK[deliveryState] ?? -1;
    const latestStatusEventAt = delivery.events?.[0]?.occurredAt
      ? new Date(delivery.events[0].occurredAt).getTime()
      : null;
    const isOlderEvent = source !== "ADMIN_RECONCILIATION_DECISION" &&
      latestStatusEventAt !== null &&
      occurredAt.getTime() < latestStatusEventAt;
    const isStaleStatus = source !== "ADMIN_RECONCILIATION_DECISION" &&
      (isOlderEvent || (currentRank >= 0 && nextRank >= 0 && nextRank < currentRank));
    const shouldApplyStatus = deliveryState !== "NEEDS_RECONCILIATION" && !isStaleStatus;
    const shouldReconcile = deliveryState === "NEEDS_RECONCILIATION" || isStaleStatus;
    const reconciliationReason = deliveryState === "NEEDS_RECONCILIATION"
      ? `Unrecognized or conflicting NCM status: ${canonicalStatus}`
      : isStaleStatus
        ? `NCM reported out-of-order status "${canonicalStatus}" after local state "${delivery.state}".`
        : null;
    const isNewDeliveryConfirmation = deliveryState === "DELIVERED" &&
      delivery.state !== "DELIVERED" && !delivery.deliveredAt;

    const eventKey = statusEventKey({
      orderId: trimmedId,
      status: payload.status || canonicalStatus,
      timestamp: payload.timestamp,
      event: payload.event,
    });

    const updated = await prisma.$transaction(async (tx) => {
      if (source === "ADMIN_RECONCILIATION_DECISION") {
        const current = await tx.deliveryOrder.findUnique({
          where: { id: delivery.id },
          select: { ncmReconciliationRequired: true },
        });
        if (!current?.ncmReconciliationRequired) {
          throw Object.assign(new Error("This delivery is no longer awaiting NCM reconciliation."), { statusCode: 409 });
        }
      }
      await createEvent(tx, {
        deliveryOrderId: delivery.id,
        orderId: delivery.orderId,
        source,
        eventType: payload.event || "NCM_STATUS_CHANGED",
        fromState: delivery.state,
        toState: shouldApplyStatus ? deliveryState : delivery.state,
        ncmStatus: canonicalStatus,
        payloadJson: sanitizeNcmWebhookPayload(payload),
        actorId,
        occurredAt,
        idempotencyKey: `NCM_STATUS:${eventKey}`,
      });

      const ncmPricing = extractNcmDeliveryPricing(payload);
      const deliveryUpdateData = {
        ncmStatus: canonicalStatus,
        lastSyncedAt: new Date(),
        nextSyncAt: null,
        ...(ncmPricing ? {
          ncmDeliveryCharge: ncmPricing.actualCharge,
          ncmDeliveryChargeBeforeDiscount: ncmPricing.chargeBeforeDiscount,
          ncmDeliveryDiscount: ncmPricing.discountAmount,
        } : {}),
        ...(shouldApplyStatus ? { state: deliveryState } : {}),
        ...(deliveryState === "PICKUP_CONFIRMED" && shouldApplyStatus
          ? { pickedUpAt: delivery.pickedUpAt || new Date() }
          : {}),
        ...(deliveryState === "DELIVERED" && shouldApplyStatus
          ? { deliveredAt: delivery.deliveredAt || new Date() }
          : {}),
        ...(deliveryState === "RETURN_REQUESTED" && shouldApplyStatus
          ? { returnedAt: delivery.returnedAt || new Date() }
          : {}),
        ncmReconciliationRequired: shouldReconcile || (!shouldApplyStatus && Boolean(delivery.ncmReconciliationRequired)),
        ncmReconciliationReason: shouldReconcile
          ? reconciliationReason
          : shouldApplyStatus
            ? null
            : delivery.ncmReconciliationReason,
        lastSyncError: shouldReconcile
          ? reconciliationReason
          : shouldApplyStatus
            ? null
            : delivery.lastSyncError,
      };

      const record = await tx.deliveryOrder.update({ where: { id: delivery.id }, data: deliveryUpdateData });
      let accountingStatus = null;

      // Synchronize Order model
      if (fulfillmentStatus && shouldApplyStatus) {
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
        if (deliveryState === "DELIVERED" && isNewDeliveryConfirmation) {
          await applyGiftDeliveryTransition(tx, delivery.orderId);
          await accrueCollaborationSalesForOrder({ orderId: delivery.orderId, deliveredAt: new Date(), client: tx });
        }
      }

      // Synchronize OrderAssignment model
      if (assignmentStatus && shouldApplyStatus) {
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

      if (deliveryState === "RETURN_REQUESTED" && shouldApplyStatus) {
        await tx.deliveryReturn.upsert({
          where: { deliveryOrderId: delivery.id },
          create: {
            deliveryOrderId: delivery.id,
            orderId: delivery.orderId,
            manufacturerId: delivery.manufacturerId,
            distributorId: delivery.distributorId,
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
            deliveryFeeActual: ncmPricing?.actualCharge ?? Number(delivery.ncmDeliveryCharge ?? 0),
            deliveryFeeDiscount: ncmPricing?.discountAmount ?? Number(delivery.ncmDeliveryDiscount || 0),
            settlementState: "RETURN_PENDING",
            varianceReason: "NCM reported a returned delivery; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
          },
          update: {
            codExpected: 0,
            settlementState: "RETURN_PENDING",
            varianceReason: "NCM reported a returned delivery; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
            ...(ncmPricing ? {
              deliveryFeeActual: ncmPricing.actualCharge,
              deliveryFeeDiscount: ncmPricing.discountAmount,
            } : {}),
          },
        });
      }

      // Create or update Financial Settlement upon delivery
      if (deliveryState === "DELIVERED" && shouldApplyStatus && delivery.codAmount > 0) {
        await tx.deliveryFinancialSettlement.upsert({
          where: { deliveryOrderId: delivery.id },
          create: {
            deliveryOrderId: delivery.id,
            ncmOrderId: delivery.ncmOrderId,
            codExpected: delivery.codAmount,
            deliveryFeeExpected: Number(delivery.customerDeliveryCharge || 0),
            deliveryFeeActual: ncmPricing?.actualCharge
              ?? Number(delivery.ncmDeliveryCharge ?? delivery.customerDeliveryCharge ?? 0),
            deliveryFeeDiscount: ncmPricing?.discountAmount ?? Number(delivery.ncmDeliveryDiscount || 0),
            settlementState: "PENDING",
          },
          update: {
            codExpected: delivery.codAmount,
            ncmOrderId: delivery.ncmOrderId,
            ...(ncmPricing ? {
              deliveryFeeActual: ncmPricing.actualCharge,
              deliveryFeeDiscount: ncmPricing.discountAmount,
            } : {}),
          },
        }).catch((err) => {
          logger.warn("Financial settlement upsert notice", { error: err.message });
        });
      }

      // Post Delivered Order Double-Entry Accounting
      if (isNewDeliveryConfirmation && shouldApplyStatus) {
        const fullOrder = await tx.order.findUnique({ where: { id: delivery.orderId } });
        if (!fullOrder) throw new Error(`Order ${delivery.orderId} was not found for delivered-sale accounting.`);

        const assignment = await tx.orderAssignment.findUnique({
          where: { orderId: delivery.orderId },
          select: { id: true, distributorId: true },
        });
        if (assignment?.distributorId) {
          const inventoryConsumption = await consumeDistributorOrderInventory({
            tx,
            orderId: fullOrder.id,
            distributorId: assignment.distributorId,
            assignmentId: assignment.id,
            items: parseJson(fullOrder.items, []),
            actorRole: "NCM",
          });
          fullOrder.items = inventoryConsumption.accountingItems;
          await tx.order.update({
            where: { id: fullOrder.id },
            data: { items: inventoryConsumption.accountingItems },
          });
        }
        const accountingEvent = await enqueueDeliveredSaleAccounting(
          { order: fullOrder, deliveryOrder: record },
          { client: tx },
        );
        accountingStatus = accountingEvent.status;
        await transitionOrderProductionAllocations({
          tx,
          orderId: fullOrder.id,
          fromState: "RESERVED",
          toState: "CONSUMED",
        });
      }

      return { record, accountingStatus };
    });

    results.push({
      ncmId: trimmedId,
      deliveryOrder: true,
      deliveryState,
      ...(isStaleStatus ? { stale: true } : {}),
      reconciliationRequired: Boolean(updated.record.ncmReconciliationRequired),
      ncmStatus: canonicalStatus,
      ...(updated.accountingStatus ? { accountingStatus: updated.accountingStatus } : {}),
    });
  }
  return results;
};

export const storeAndApplyWebhook = async (payload, { onStockTransferStatus = null } = {}) => {
  // Handle test webhooks sent from NCM Vendor Portal
  if (
    payload.test === true ||
    payload.test === "true" ||
    String(payload.order_id || "").toUpperCase().startsWith("TEST-")
  ) {
    logger.info("NCM test webhook received and acknowledged", {
      event: typeof payload.event === "string" ? payload.event.slice(0, 191) : null,
      status: typeof payload.status === "string" ? payload.status.slice(0, 191) : null,
    });
    return { duplicate: false, test: true, updated: [] };
  }

  const ids = webhookIdentifiers(payload);
  const eventKey = statusEventKey({
    orderId: ids.join(","),
    status: payload.status,
    timestamp: payload.timestamp,
    event: payload.event,
  });
  let duplicate = false;
  const occurredAt = payload.timestamp ? new Date(payload.timestamp) : null;

  try {
    await prisma.ncmWebhookEvent.create({
      data: {
        eventKey,
        event: payload.event || null,
        orderId: ids[0] || null,
        orderIds: payload.order_ids || ids,
        status: payload.status || null,
        timestamp: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
        payloadJson: sanitizeNcmWebhookPayload(payload),
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      duplicate = true;
    } else {
      throw error;
    }
  }

  try {
    const updated = await applyNcmStatus({ payload, onStockTransferStatus });
    await prisma.ncmWebhookEvent.update({
      where: { eventKey },
      data: { processingStatus: "PROCESSED", processedAt: new Date(), processingError: null },
    });
    return { duplicate, updated };
  } catch (error) {
    try {
      await prisma.ncmWebhookEvent.update({
        where: { eventKey },
        data: { processingStatus: "FAILED", processingError: error.message },
      });
    } catch (recordError) {
      logger.error("Failed to record NCM webhook processing error", {
        eventKey,
        error: recordError.message,
      });
    }
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
        payloadJson: sanitizeNcmWebhookPayload(payload),
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

const markNcmReconciliationRequired = async ({ delivery, reason, ncmStatus = null }) => {
  const now = new Date();
  const eventKey = statusEventKey({
    orderId: delivery.id,
    status: ncmStatus || reason,
    timestamp: now.toISOString(),
    event: "NCM_RECONCILIATION_REQUIRED",
  });
  return prisma.$transaction(async (tx) => {
    await createEvent(tx, {
      deliveryOrderId: delivery.id,
      orderId: delivery.orderId,
      source: "ADMIN_RECONCILIATION",
      eventType: "NCM_RECONCILIATION_REQUIRED",
      fromState: delivery.state,
      toState: delivery.state,
      ncmStatus: ncmStatus || delivery.ncmStatus,
      payloadJson: { reason },
      occurredAt: now,
      idempotencyKey: `NCM_RECONCILIATION:${eventKey}`,
    });
    return tx.deliveryOrder.update({
      where: { id: delivery.id },
      data: {
        ...(ncmStatus ? { ncmStatus: ncmStatus.slice(0, 191) } : {}),
        ncmReconciliationRequired: true,
        ncmReconciliationReason: reason,
        lastSyncError: reason,
        lastSyncedAt: now,
        nextSyncAt: null,
      },
    });
  });
};

const getLatestNcmStatusRecord = (response) => {
  let data = response?.data ?? response;
  if (data && typeof data === "object" && !Array.isArray(data) && data.data !== undefined) {
    data = data.data;
  }
  const records = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.statuses)
        ? data.statuses
        : null;
  if (!records) return data && typeof data === "object" ? data : null;
  return [...records].sort((left, right) => {
    const leftTime = new Date(left?.timestamp || left?.added_time || 0).getTime();
    const rightTime = new Date(right?.timestamp || right?.added_time || 0).getTime();
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  })[0] || null;
};

export const reconcileDelivery = async (deliveryId, { actorId = null } = {}) => {
  const delivery = await prisma.deliveryOrder.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      orderId: true,
      ncmOrderId: true,
      state: true,
      ncmStatus: true,
      ncmReconciliationRequired: true,
    },
  });
  if (!delivery) {
    throw Object.assign(new Error("Delivery not found"), { code: "DELIVERY_NOT_FOUND" });
  }
  if (!delivery.ncmOrderId) {
    const reason = "No NCM order ID is linked to this delivery; Admin review is required.";
    await markNcmReconciliationRequired({ delivery, reason });
    return prisma.deliveryOrder.findUnique({ where: { id: delivery.id }, include: { events: { orderBy: { occurredAt: "desc" } } } });
  }

  let response;
  try {
    response = await getOrderStatus(delivery.ncmOrderId);
  } catch (error) {
    logger.error("NCM status lookup failed during Admin reconciliation", {
      deliveryId: delivery.id,
      errorName: error.name,
      errorCode: error.code,
    });
    const reason = "NCM status lookup failed; verify the carrier status and resolve this delivery manually.";
    await markNcmReconciliationRequired({ delivery, reason });
    throw Object.assign(new Error("NCM status lookup failed; this delivery was added to the reconciliation queue."), {
      code: "NCM_RECONCILIATION_FETCH_FAILED",
    });
  }

  const latestStatus = getLatestNcmStatusRecord(response);
  const status = typeof latestStatus?.status === "string" ? latestStatus.status.trim() : "";
  const event = typeof latestStatus?.event === "string" ? latestStatus.event.trim() : "";
  const timestamp = latestStatus?.timestamp || latestStatus?.added_time || new Date().toISOString();
  if (!status && !event) {
    const reason = "NCM returned no recognizable status record; verify the carrier order and resolve it manually.";
    await markNcmReconciliationRequired({ delivery, reason });
    return prisma.deliveryOrder.findUnique({ where: { id: delivery.id }, include: { events: { orderBy: { occurredAt: "desc" } } } });
  }

  await applyNcmStatus({
    payload: {
      order_id: String(delivery.ncmOrderId),
      ...(status ? { status } : {}),
      ...(event ? { event } : {}),
      timestamp,
    },
    source: "ADMIN_RECONCILIATION",
    actorId,
  });
  return prisma.deliveryOrder.findUnique({
    where: { id: delivery.id },
    include: { events: { orderBy: { occurredAt: "desc" } } },
  });
};

export const requestCodSettlement = async ({ bankName, bankAccountName, bankAccountNumber }) => {
  const response = await createCodTransferTicket({ bankName, bankAccountName, bankAccountNumber });
  return response.data;
};

export const reconcileActiveDeliveries = async () => {
  return prisma.deliveryOrder.findMany({
    where: { ncmOrderId: { not: null }, state: { in: ["NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY"] } },
    include: { events: { orderBy: { occurredAt: "desc" }, take: 10 } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
};

export const requestDeliveryReturn = async ({ deliveryId, manufacturerId, distributorId, reason }) => {
  const delivery = await prisma.deliveryOrder.findUnique({
    where: { id: deliveryId },
    include: { order: { select: { paymentMethod: true, payment: true } } },
  });
  const ownsDelivery = (manufacturerId && delivery?.manufacturerId === manufacturerId) ||
    (distributorId && delivery?.distributorId === distributorId);
  if (!delivery || !ownsDelivery || !delivery.ncmOrderId) throw new Error("Delivery not found or not eligible for return");
  const existing = await prisma.deliveryReturn.findUnique({ where: { deliveryOrderId: deliveryId } });
  if (existing) return existing;
  const response = await requestOrderReturn({ pk: delivery.ncmOrderId, comment: reason });
  return runTransaction(async (tx) => {
    const returned = await tx.deliveryReturn.create({ data: { deliveryOrderId: deliveryId, orderId: delivery.orderId, manufacturerId: delivery.manufacturerId, distributorId: delivery.distributorId, returnReason: reason, ncmReturnComment: reason, ncmReturnRequestedAt: new Date(), state: "RETURN_REQUESTED" } });
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
        deliveryFeeActual: Number(delivery.ncmDeliveryCharge ?? 0),
        deliveryFeeDiscount: Number(delivery.ncmDeliveryDiscount || 0),
        settlementState: "RETURN_PENDING",
        varianceReason: "Carrier return requested; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
      },
      update: {
        codExpected: 0,
        settlementState: "RETURN_PENDING",
        varianceReason: "Carrier return requested; awaiting physical receipt and inspection before refund, restock, or VAT reversal.",
      },
    });
    await createEvent(tx, { deliveryOrderId: deliveryId, orderId: delivery.orderId, source: distributorId ? "DISTRIBUTOR" : "MANUFACTURER", eventType: "RETURN_REQUESTED", fromState: delivery.state, toState: "RETURN_REQUESTED", actorId: distributorId || manufacturerId, payloadJson: response.data, idempotencyKey: `RETURN_REQUESTED:${deliveryId}` });
    return returned;
  });
};
