import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "./auditService.js";
import { postDeliveredOrderAccounting, postCustomerReturnAccounting } from "./accountingPostingEngine.js";

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

const fail = (message, statusCode = 400, code = "SELF_DELIVERY_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
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
  "ready_for_pickup",
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

  const where = { distributorId };
  if (status && status !== "all") {
    const norm = normalize(status);
    if (norm === "dispatched") where.status = { in: ["dispatched", "Dispatched"] };
    else if (norm === "on_the_way" || norm === "on the way") where.status = { in: ["on_the_way", "On the Way", "out_for_delivery"] };
    else if (norm === "delivered") where.status = { in: ["delivered", "Delivered"] };
    else if (norm === "returned") where.status = { in: ["returned", "Returned", "return_requested"] };
    else where.status = status;
  }

  const [assignments, total] = await Promise.all([
    client.orderAssignment.findMany({
      where,
      orderBy: { assignedAt: "desc" },
      skip,
      take: numLimit,
      include: {
        distributor: { select: { id: true, name: true, city: true, phone: true } },
      },
    }),
    client.orderAssignment.count({ where }),
  ]);

  const orderIds = assignments.map((a) => a.orderId);
  const orders = await client.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      assignedGift: true,
    },
  });
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const enriched = assignments.map((assignment) => {
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
      order: order
        ? {
            id: order.id,
            userId: order.userId,
            amount: order.amount,
            deliveryFee: order.deliveryFee,
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

  return {
    success: true,
    orders: enriched,
    pagination: {
      page: numPage,
      limit: numLimit,
      total,
      pages: Math.ceil(total / numLimit),
    },
  };
};

/**
 * Update Self-Delivery Status sequentially (Dispatched -> On the Way -> Delivered)
 */
export const updateSelfDeliveryStatus = async ({
  distributorId,
  assignmentIdOrOrderId,
  status,
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

  const transition = validateSelfDeliveryTransition(assignment.status, status);
  if (!transition.valid) {
    throw fail(transition.message, 409, "INVALID_STATUS_TRANSITION");
  }

  const { canonicalStatus, internalStatus } = transition;
  const now = new Date();

  return client.$transaction(async (tx) => {
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
    } else if (internalStatus === "on_the_way") {
      assignmentUpdateData.onTheWayAt = now;
    } else if (internalStatus === "delivered") {
      assignmentUpdateData.deliveredAt = now;
      orderUpdateData.payment = true; // Mark payment collected if COD

      // Stock Fulfillment: Release reserved quantity & decrement quantityOnHand in distributor stock location
      const distributorLocation = await tx.inventoryLocation.findFirst({
        where: { distributorId, kind: "DISTRIBUTOR", isActive: true },
      });

      if (distributorLocation) {
        const orderItems = parseJSON(order.items, []);
        for (const item of orderItems) {
          const productId = item.productId || item._id || item.id;
          const sizeKey = normalizeSkuKey(item.size);
          const colorKey = normalizeSkuKey(item.color);
          const qty = Number(item.quantity ?? 1);

          const sku = await tx.inventorySku.findFirst({
            where: { productId, sizeKey, colorKey, isActive: true },
          });

          if (sku) {
            const balance = await tx.inventoryBalance.findUnique({
              where: {
                locationId_inventorySkuId: {
                  locationId: distributorLocation.id,
                  inventorySkuId: sku.id,
                },
              },
            });

            if (balance) {
              const decrementReserved = Math.min(balance.reservedQuantity, qty);
              await tx.inventoryBalance.update({
                where: { id: balance.id },
                data: {
                  quantityOnHand: { decrement: qty },
                  reservedQuantity: { decrement: decrementReserved },
                },
              });

              // Create FULFILLMENT ledger entry
              await tx.inventoryLedgerEntry.create({
                data: {
                  inventorySkuId: sku.id,
                  sourceLocationId: distributorLocation.id,
                  destinationLocationId: null,
                  quantity: qty,
                  movementType: "FULFILLMENT",
                  inventoryOwner: "PLATFORM",
                  referenceType: "ORDER",
                  referenceId: order.id,
                  idempotencyKey: `dist-fulfill-${assignment.id}-${sku.id}-${crypto.randomBytes(4).toString("hex")}`,
                  actorId: actorContext.actorId || distributorId,
                  actorRole: "DISTRIBUTOR",
                  reason: `Self-delivery completed for Order ${order.id}`,
                },
              });
            }
          }
        }
      }

      // Post Delivered Order Accounting entries
      try {
        await postDeliveredOrderAccounting(order.id, tx);
      } catch (err) {
        console.warn("Accounting posting note on self-delivery:", err.message);
      }
    }

    const updatedAssignment = await tx.orderAssignment.update({
      where: { id: assignment.id },
      data: assignmentUpdateData,
    });

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
      order: updatedOrder,
    };
  });
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

  const order = await client.order.findUnique({
    where: { id: assignment.orderId },
  });
  if (!order) throw fail("Order not found.", 404);

  const orderItems = parseJSON(order.items, []);
  const customerAddress = parseJSON(order.address, {});
  const customerName = `${customerAddress.firstName || ""} ${customerAddress.lastName || ""}`.trim() || "Valued Customer";
  const customerPhone = customerAddress.phone || "";

  return client.$transaction(async (tx) => {
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
      const lineRefund = unitPrice * quantity;
      totalRefundAmount += lineRefund;

      processedItems.push({
        productId,
        name: matchingOrderLine.name || "Returned Product",
        size,
        color,
        quantity,
        unitPrice,
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

    const vatRefunded = Number((totalRefundAmount - totalRefundAmount / 1.13).toFixed(2));

    // 2. Create CustomerReturn record
    const customerReturn = await tx.customerReturn.create({
      data: {
        orderId: order.id,
        userId: order.userId || null,
        customerName,
        customerPhone,
        items: processedItems,
        totalRefundAmount,
        vatRefunded,
        refundMethod: "STORE_CREDIT",
        refundStatus: "COMPLETED",
        inventoryAction: hasDamagedItems ? "DAMAGED_WRITE_OFF" : "RESTOCKED",
        reason: reason.trim(),
        notes: notes ? String(notes).trim() : null,
        status: "RECEIVED_AT_WAREHOUSE",
      },
    });

    // 3. Post Return Accounting
    try {
      await postCustomerReturnAccounting(customerReturn.id, tx);
    } catch (err) {
      console.warn("Accounting posting note on return:", err.message);
    }

    // 4. Update Order and Assignment status
    const now = new Date();
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

    // 5. System Audit log to notify admin
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
};
