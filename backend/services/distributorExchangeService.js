import { prisma } from "../config/db.js";
import { ensureInventoryLocation, applyInventoryMovement } from "./inventoryLedgerService.js";
import { syncProductStock } from "./stockSyncService.js";
import {
  createReturnExchangeSettlementPayable,
  postReturnExchangeSettlementAccounting,
} from "./returnExchangeSettlementService.js";

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalized = (value) => String(value || "Standard").trim().replace(/\s+/g, " ").toLowerCase();
const itemKey = (item) => JSON.stringify([
  String(item.productId || ""),
  normalized(item.size),
  normalized(item.color),
]);
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

const addEvent = (tx, { requestId, type, fromStatus, toStatus, actorId, reason, metadata }) =>
  tx.orderExchangeEvent.create({
    data: {
      exchangeRequestId: requestId,
      eventType: type,
      fromStatus,
      toStatus,
      actorId,
      actorRole: "DISTRIBUTOR",
      reason,
      metadata,
      idempotencyKey: `EXCHANGE:${requestId}:${type}`,
    },
  });

const validateInspectionItems = (requestedItems, inspectedItems) => {
  if (!Array.isArray(inspectedItems) || inspectedItems.length === 0) {
    throw fail("Inspect and classify each returned item before proceeding.", "EXCHANGE_INSPECTION_REQUIRED");
  }
  const expected = new Map();
  for (const item of requestedItems) {
    const key = itemKey(item);
    expected.set(key, (expected.get(key) || 0) + Number(item.quantity || 0));
  }
  const actual = new Map();
  for (const item of inspectedItems) {
    const key = itemKey(item);
    const quantity = Number(item.quantity);
    const condition = String(item.condition || "").trim().toUpperCase();
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !["GOOD", "DAMAGED"].includes(condition)) {
      throw fail("Each inspected item must have a valid quantity and Good or Damaged condition.", "INVALID_EXCHANGE_INSPECTION");
    }
    actual.set(key, (actual.get(key) || 0) + quantity);
  }
  if (expected.size !== actual.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)) {
    throw fail("Inspection quantities must match the exact approved returned items.", "EXCHANGE_INSPECTION_QUANTITY_MISMATCH", 409);
  }
  return inspectedItems;
};

const consumeReservedReplacementStock = async ({ tx, request, reservations, actorId }) => {
  if (!Array.isArray(reservations) || reservations.length === 0) {
    throw fail("The approved replacement stock reservation could not be found.", "EXCHANGE_RESERVATION_MISSING", 409);
  }
  const requested = new Map();
  for (const item of parseArray(request.replacementItems).length ? parseArray(request.replacementItems) : parseArray(request.items)) {
    const key = itemKey(item);
    requested.set(key, (requested.get(key) || 0) + Number(item.quantity || 0));
  }
  const products = new Set();
  const allocated = new Map();
  for (const reservation of reservations) {
    const sku = await tx.inventorySku.findUnique({
      where: { id: reservation.inventorySkuId },
      select: { productId: true, sizeKey: true, colorKey: true, isActive: true },
    });
    if (!sku?.isActive) throw fail("A reserved replacement SKU is no longer active.", "EXCHANGE_REPLACEMENT_SKU_MISSING", 409);
    const key = itemKey({ productId: sku.productId, size: sku.sizeKey, color: sku.colorKey });
    allocated.set(key, (allocated.get(key) || 0) + Number(reservation.quantity || 0));
    products.add(sku.productId);
  }
  if (requested.size !== allocated.size || [...requested].some(([key, quantity]) => allocated.get(key) !== quantity)) {
    throw fail("The recorded stock reservation does not match the approved replacement items.", "EXCHANGE_RESERVATION_MISMATCH", 409);
  }

  for (const reservation of reservations) {
    const balance = await tx.inventoryBalance.findUnique({
      where: {
        locationId_inventorySkuId: {
          locationId: reservation.locationId,
          inventorySkuId: reservation.inventorySkuId,
        },
      },
    });
    const quantity = Number(reservation.quantity);
    if (!balance || balance.quantityOnHand < quantity || balance.reservedQuantity < quantity) {
      throw fail("Reserved replacement stock is no longer available at the distributor hub.", "EXCHANGE_RESERVATION_UNAVAILABLE", 409);
    }
    const updated = await tx.inventoryBalance.updateMany({
      where: {
        id: balance.id,
        quantityOnHand: balance.quantityOnHand,
        reservedQuantity: balance.reservedQuantity,
      },
      data: {
        quantityOnHand: { decrement: quantity },
        reservedQuantity: { decrement: quantity },
      },
    });
    if (updated.count !== 1) throw fail("Replacement stock changed during dispatch. Retry the action.", "EXCHANGE_STOCK_CONFLICT", 409);
    await tx.inventoryLedgerEntry.create({
      data: {
        inventorySkuId: reservation.inventorySkuId,
        sourceLocationId: reservation.locationId,
        destinationLocationId: null,
        quantity,
        movementType: "FULFILLMENT",
        inventoryOwner: "PLATFORM",
        referenceType: "EXCHANGE",
        referenceId: request.id,
        idempotencyKey: `EXCHANGE_REPLACEMENT:${request.id}:${reservation.inventorySkuId}:${reservation.locationId}`,
        actorId,
        actorRole: "DISTRIBUTOR",
        reason: `Distributor exchange replacement dispatched for request ${request.id}`,
      },
    });
  }
  await Promise.all([...products].map((productId) =>
    syncProductStock(productId, { client: tx, throwOnError: true })
  ));
};

export const processDistributorExchange = async ({
  requestId,
  distributorId,
  actorId,
  action,
  inspectedItems,
  notes,
}) => {
  const normalizedAction = String(action || "").trim().toUpperCase();
  if (!requestId || !distributorId || !actorId || !["RECEIVE_AND_INSPECT", "DISPATCH", "DELIVER"].includes(normalizedAction)) {
    throw fail("A valid request, distributor, actor, and exchange action are required.", "INVALID_DISTRIBUTOR_EXCHANGE_ACTION");
  }

  const record = await prisma.$transaction(async (tx) => {
    const request = await tx.orderExchangeRequest.findFirst({
      where: { id: requestId, distributorId, deliveryRoute: "DISTRIBUTOR" },
    });
    if (!request) throw fail("Approved exchange request not found for this distributor.", "EXCHANGE_NOT_FOUND", 404);

    if (normalizedAction === "RECEIVE_AND_INSPECT") {
      if (request.inspectedAt) return request;
      if (request.status !== "APPROVED_FOR_DISTRIBUTOR") {
        throw fail("Only an admin-approved exchange can be received by the distributor.", "EXCHANGE_NOT_APPROVED", 409);
      }
      const items = validateInspectionItems(parseArray(request.items), inspectedItems);
      const reason = String(notes || "").trim();
      const damagedItems = items.filter((item) => String(item.condition).toUpperCase() === "DAMAGED");
      if (damagedItems.length && reason.length < 3) {
        throw fail("Add inspection notes when any returned item is marked damaged.", "EXCHANGE_DAMAGE_NOTES_REQUIRED");
      }

      const stockLocation = await ensureInventoryLocation(tx, {
        kind: "DISTRIBUTOR",
        name: `Distributor ${distributorId} stock`,
        distributorId,
      });
      const damagedLocation = damagedItems.length ? await ensureInventoryLocation(tx, {
        kind: "DAMAGED",
        name: `Distributor ${distributorId} damaged stock`,
        distributorId,
      }) : null;
      const inventoryChanges = [];
      const affectedProducts = new Set();
      for (const item of items) {
        const sizeKey = normalized(item.size);
        const colorKey = normalized(item.color);
        const sku = await tx.inventorySku.findUnique({
          where: { productId_sizeKey_colorKey: { productId: item.productId, sizeKey, colorKey } },
          select: { id: true, isActive: true },
        });
        if (!sku?.isActive) {
          throw fail(`Inventory SKU is missing or inactive for returned product ${item.productId}.`, "EXCHANGE_RETURN_SKU_MISSING", 409);
        }
        const damaged = String(item.condition).toUpperCase() === "DAMAGED";
        const destination = damaged ? damagedLocation : stockLocation;
        const movementType = damaged ? "DAMAGE" : "RETURN";
        const quantity = Number(item.quantity);
        await applyInventoryMovement(tx, {
          inventorySkuId: sku.id,
          destinationLocationId: destination.id,
          quantity,
          movementType,
          inventoryOwner: "PLATFORM",
          referenceType: "EXCHANGE_RETURN",
          referenceId: request.id,
          idempotencyKey: `EXCHANGE_RETURN:${request.id}:${sku.id}:${destination.id}`,
          actorId,
          actorRole: "DISTRIBUTOR",
          reason: damaged
            ? `Exchange return inspection found damage: ${reason}`
            : `Distributor received approved exchange return ${request.id}`,
        });
        inventoryChanges.push({ productId: item.productId, quantity, condition: damaged ? "DAMAGED" : "GOOD" });
        affectedProducts.add(item.productId);
        if (damaged) {
          await tx.inventoryDiscrepancy.create({
            data: {
              distributorId,
              inventoryLocationId: damagedLocation.id,
              inventorySkuId: sku.id,
              discrepancyType: "OTHER_DAMAGE",
              quantity,
              status: "OPEN",
              reportedBy: actorId,
              reportedByRole: "DISTRIBUTOR",
              details: `Exchange ${request.id} return inspection: ${reason}`,
              idempotencyKey: `EXCHANGE_RETURN_DAMAGE:${request.id}:${sku.id}`,
            },
          });
        }
      }
      await Promise.all([...affectedProducts].map((productId) =>
        syncProductStock(productId, { client: tx, throwOnError: true })
      ));
      const now = new Date();
      const updated = await tx.orderExchangeRequest.update({
        where: { id: request.id },
        data: {
          status: "IN_PROGRESS",
          returnPickupStatus: "PICKUP_COMPLETE",
          returnPickupCompletedAt: now,
          inspectedAt: now,
          inspectionResult: damagedItems.length ? "DAMAGED" : "RESTOCKABLE",
          inspectionNotes: String(notes || "").trim() || null,
          replacementStatus: "READY_FOR_DISPATCH",
        },
      });
      await addEvent(tx, {
        requestId: request.id,
        type: "DISTRIBUTOR_RETURN_INSPECTED",
        fromStatus: request.status,
        toStatus: updated.status,
        actorId,
        reason: reason || "Returned items received and inspected by distributor.",
        metadata: { inspectedItems: items, inventoryChanges },
      });
      return updated;
    }

    if (normalizedAction === "DISPATCH") {
      if (request.replacementStatus === "DISPATCHED" || request.replacementStockConsumedAt) return request;
      if (!request.inspectedAt || request.status !== "IN_PROGRESS") {
        throw fail("Receive and inspect the returned items before dispatching the replacement.", "EXCHANGE_RETURN_NOT_INSPECTED", 409);
      }
      if (!request.replacementStockReservedAt) {
        throw fail("Replacement stock was not reserved during admin approval.", "EXCHANGE_RESERVATION_MISSING", 409);
      }
      const approval = await tx.orderExchangeEvent.findFirst({
        where: { exchangeRequestId: request.id, eventType: "APPROVE" },
        orderBy: { occurredAt: "desc" },
        select: { metadata: true },
      });
      const reservations = approval?.metadata?.replacementReservations;
      await consumeReservedReplacementStock({ tx, request, reservations, actorId });
      const now = new Date();
      const updated = await tx.orderExchangeRequest.update({
        where: { id: request.id },
        data: { replacementStatus: "DISPATCHED", replacementStockConsumedAt: now },
      });
      await addEvent(tx, {
        requestId: request.id,
        type: "DISTRIBUTOR_REPLACEMENT_DISPATCHED",
        fromStatus: request.status,
        toStatus: updated.status,
        actorId,
        reason: "Reserved replacement stock dispatched from distributor hub.",
        metadata: { replacementItems: parseArray(request.replacementItems) },
      });
      return updated;
    }

    if (request.status === "COMPLETED") return request;
    if (request.replacementStatus !== "DISPATCHED" || !request.replacementStockConsumedAt) {
      throw fail("Dispatch the replacement before marking it delivered.", "EXCHANGE_REPLACEMENT_NOT_DISPATCHED", 409);
    }
    const now = new Date();
    const updated = await tx.orderExchangeRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        replacementStatus: "DELIVERED",
        replacementDeliveredAt: now,
        completedAt: now,
      },
    });
    const logisticsPayable = await createReturnExchangeSettlementPayable(tx, updated, "EXCHANGE");
    if (logisticsPayable) {
      await postReturnExchangeSettlementAccounting({
        operation: "EXCHANGE",
        requestId: updated.id,
        payable: logisticsPayable,
        client: tx,
      });
    }
    await addEvent(tx, {
      requestId: request.id,
      type: "DISTRIBUTOR_REPLACEMENT_DELIVERED",
      fromStatus: request.status,
      toStatus: updated.status,
      actorId,
      reason: "Replacement delivered to the customer by the distributor.",
      metadata: { replacementItems: parseArray(request.replacementItems) },
    });
    return updated;
  }, { isolationLevel: "Serializable" });
  return record;
};
