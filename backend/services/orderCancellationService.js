import { prisma } from "../config/db.js";
import { syncProductStock } from "./stockSyncService.js";
import { transitionOrderProductionAllocations } from "./manufacturerProductionService.js";

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const cancelledError = (message, code) => Object.assign(new Error(message), { code });

export const isBeforeNcmHandoff = ({ order, delivery, submissionAttempt }) => {
  const attemptMayHaveReachedCarrier = submissionAttempt && (
    ["STARTED", "UNKNOWN", "SUCCESS"].includes(submissionAttempt.result) ||
    (submissionAttempt.result === "FAILED" && (!submissionAttempt.httpStatus || Number(submissionAttempt.httpStatus) >= 500))
  );
  const handedToCarrier = Boolean(
    delivery?.ncmOrderId || attemptMayHaveReachedCarrier ||
    ["NCM_SUBMISSION_STARTED", "NCM_CREATED", "PICKUP_CONFIRMED", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "OUT_FOR_DELIVERY", "DELIVERED", "RETURN_REQUESTED"].includes(delivery?.state)
  );
  const shippedStatus = ["shipped", "delivered", "returned"].includes(normalize(order?.status)) ||
    ["ncm_submission_started", "ncm_created", "picked_up", "in_transit", "arrived_at_destination", "out_for_delivery", "delivered", "return_requested"].includes(normalize(order?.fulfillmentStatus));
  return !handedToCarrier && !shippedStatus;
};

const aggregateOrderItems = (items) => {
  const quantities = new Map();
  for (const item of parseJsonArray(items)) {
    const productId = String(item.productId || item._id || item.id || "");
    const quantity = Math.max(0, Number(item.quantity || 0));
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
    const size = String(item.size || "");
    const color = String(item.color || "");
    const key = `${productId}\u0000${normalize(size)}\u0000${normalize(color)}`;
    const existing = quantities.get(key);
    if (existing) existing.quantity += quantity;
    else quantities.set(key, { productId, size, color, quantity });
  }
  return [...quantities.values()];
};

const restoreUnhubbedProductStock = async (tx, productId, itemLines) => {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) return null;

  const totalQuantity = itemLines.reduce((sum, item) => sum + item.quantity, 0);
  const variants = parseJsonArray(product.variants);
  const hasVariants = variants.length > 0;
  const restoredVariants = hasVariants
    ? variants.map((variant) => {
        const itemQuantity = itemLines
          .filter((item) => normalize(item.size) === normalize(variant.size) && normalize(item.color) === normalize(variant.color))
          .reduce((sum, item) => sum + item.quantity, 0);
        return itemQuantity > 0
          ? { ...variant, quantity: Number(variant.quantity || 0) + itemQuantity }
          : variant;
      })
    : variants;
  const newStock = Number(product.stockQuantity || 0) + totalQuantity;

  await tx.product.update({
    where: { id: productId },
    data: {
      stockQuantity: newStock,
      ...(hasVariants ? { variants: restoredVariants } : {}),
    },
  });

  return { productName: product.name, previousQty: Number(product.stockQuantity || 0), newQty: newStock, quantity: totalQuantity };
};

const releaseManufacturerReservation = async (tx, manufacturerId, item) => {
  const inventory = await tx.manufacturerInventory.findUnique({
    where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
  });
  if (!inventory) return false;

  const variantsStock = parseJsonArray(inventory.variantsStock);
  const matchingVariants = variantsStock.filter((variant) =>
    normalize(variant.size || "Standard") === normalize(item.size || "Standard") &&
    normalize(variant.color || "Standard") === normalize(item.color || "Standard")
  );
  const nextVariantsStock = variantsStock.map((variant) => {
    if (
      normalize(variant.size || "Standard") !== normalize(item.size || "Standard") ||
      normalize(variant.color || "Standard") !== normalize(item.color || "Standard")
    ) return variant;
    return { ...variant, reservedQty: Math.max(0, Number(variant.reservedQty || 0) - item.quantity) };
  });

  await tx.manufacturerInventory.update({
    where: { manufacturerId_productId: { manufacturerId, productId: item.productId } },
    data: {
      reservedQty: Math.max(0, Number(inventory.reservedQty || 0) - item.quantity),
      ...(variantsStock.length > 0 && matchingVariants.length > 0 ? { variantsStock: nextVariantsStock } : {}),
    },
  });
  return true;
};

export const cancelCustomerOrder = async ({ orderId, customerId, reason }) => {
  const cancellationReason = String(reason || "").trim();
  if (!orderId || !customerId || cancellationReason.length < 3) {
    throw cancelledError("Order ID and a cancellation reason are required.", "INVALID_CANCELLATION");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId: customerId },
      include: { deliveryOrder: true },
    });
    if (!order) throw cancelledError("Order not found.", "ORDER_NOT_FOUND");
    if (order.status === "Cancelled") {
      return { alreadyCancelled: true, order };
    }

    const delivery = order.deliveryOrder;
    const submissionAttempt = delivery
      ? await tx.ncmRequestAttempt.findFirst({ where: { deliveryOrderId: delivery.id } })
      : null;
    if (!isBeforeNcmHandoff({ order, delivery, submissionAttempt })) {
      throw cancelledError("This order can no longer be cancelled because it has been handed to the delivery partner. Submit an exchange request instead.", "CANCELLATION_CUTOFF_PASSED");
    }

    const changed = await tx.order.updateMany({
      where: { id: order.id, userId: customerId, status: { not: "Cancelled" } },
      data: {
        status: "Cancelled",
        fulfillmentStatus: "cancelled",
        cancelledAt: new Date(),
        cancellationReason,
        cancelledByUserId: customerId,
      },
    });
    if (changed.count !== 1) {
      throw cancelledError("The order changed while cancellation was being processed. Refresh and try again.", "CANCELLATION_CONFLICT");
    }

    const assignment = await tx.orderAssignment.findUnique({ where: { orderId: order.id } });
    const itemLines = aggregateOrderItems(order.items);
    const productLines = new Map();
    for (const item of itemLines) {
      if (assignment?.manufacturerId && !order.specialOrder) {
        await releaseManufacturerReservation(tx, assignment.manufacturerId, item);
      }
      const lines = productLines.get(item.productId) || [];
      lines.push(item);
      productLines.set(item.productId, lines);
    }
    if (assignment?.manufacturerId) {
      await transitionOrderProductionAllocations({
        tx,
        orderId: order.id,
        fromState: "RESERVED",
        toState: "RELEASED",
      });
    }

    if (assignment) {
      await tx.orderAssignment.updateMany({
        where: { orderId: order.id },
        data: { status: "cancelled", rejectionReason: cancellationReason },
      });
    }

    if (delivery) {
      await tx.deliveryOrder.update({ where: { id: delivery.id }, data: { state: "CANCELLED" } });
    }

    const cardLink = await tx.marketingCardOrder.findUnique({
      where: { orderId: order.id },
      include: { card: true },
    });
    if (cardLink?.card && cardLink.card.physicalStatus === "ATTACHED") {
      await tx.marketingCard.update({
        where: { id: cardLink.cardId },
        data: { physicalStatus: "AVAILABLE", reservedAt: null, attachedAt: null },
      });
      await tx.marketingCardEvent.create({
        data: {
          cardId: cardLink.cardId,
          eventType: "CARD_RELEASED_AFTER_ORDER_CANCELLATION",
          actorId: customerId,
          actorRole: "CUSTOMER",
          fromStatus: "ATTACHED",
          toStatus: "AVAILABLE",
          referenceId: order.id,
          metadata: { reason: cancellationReason },
        },
      });
      await tx.marketingCardOrder.delete({ where: { id: cardLink.id } });
    }

    for (const [productId, lines] of productLines) {
      const hubs = await tx.manufacturerInventory.count({ where: { productId } });
      const before = await tx.product.findUnique({ where: { id: productId }, select: { stockQuantity: true, name: true } });
      const stockChange = hubs > 0
        ? await syncProductStock(productId, { client: tx, throwOnError: true })
        : await restoreUnhubbedProductStock(tx, productId, lines);
      if (stockChange) {
        await tx.stockLog.create({
          data: {
            productId,
            productName: before?.name || stockChange.name || stockChange.productName,
            previousQty: Number(before?.stockQuantity || 0),
            newQty: Number(stockChange.stockQuantity ?? stockChange.newQty ?? 0),
            changeQty: lines.reduce((sum, item) => sum + item.quantity, 0),
            reason: `Customer order cancelled before NCM handoff (${order.id})`,
            source: "customer_cancel",
            orderId: order.id,
          },
        });
      }
    }

    return {
      alreadyCancelled: false,
      order: await tx.order.findUnique({ where: { id: order.id } }),
    };
  }, { isolationLevel: "Serializable" });
};