import { Prisma } from "@prisma/client";

const normalizeVariantValue = (value) => String(value || "Standard").trim().toLowerCase();

export const validateProductionRequestInput = ({ lines, unitCogs, minimumOrderQuantity, deliveryCost }) => {
  const cogs = new Prisma.Decimal(String(unitCogs));
  const moq = Number(minimumOrderQuantity);
  const overhead = new Prisma.Decimal(String(deliveryCost ?? 0));
  if (!cogs.isFinite() || !cogs.greaterThan(0)) {
    throw new Error("Per-piece COGS must be a valid amount greater than zero.");
  }
  if (!Number.isInteger(moq) || moq < 1 || moq > 2147483647) {
    throw new Error("MOQ must be a positive whole number.");
  }
  if (!overhead.isFinite() || overhead.isNegative()) {
    throw new Error("Packaging and other delivery costs must be a valid non-negative per-piece amount.");
  }
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new Error("Provide production quantities for at least one size and color.");
  }

  const unique = new Set();
  const normalizedLines = lines.map((line) => {
    const size = String(line?.size || "Standard").trim();
    const color = String(line?.color || "Standard").trim();
    const quantity = Number(line?.quantity);
    const key = JSON.stringify([normalizeVariantValue(size), normalizeVariantValue(color)]);
    if (!size || !color || unique.has(key)) throw new Error("Production size/color entries must be valid and unique.");
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
      throw new Error(`Production quantity for ${size} / ${color} must be a positive whole number.`);
    }
    unique.add(key);
    return { size, color, quantity };
  });

  const totalQuantity = normalizedLines.reduce((total, line) => total + line.quantity, 0);
  if (totalQuantity > 2147483647) throw new Error("Total production quantity cannot exceed 2147483647 units.");

  return {
    lines: normalizedLines,
    unitCogs: cogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    minimumOrderQuantity: moq,
    deliveryCost: overhead.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    totalQuantity,
  };
};

export const allocateProductionLayersForOrderItem = async ({
  tx,
  orderId,
  itemIndex,
  manufacturerId,
  item,
}) => {
  const productId = String(item.productId || item._id || item.id || "");
  const size = String(item.size || "Standard").trim();
  const color = String(item.color || "Standard").trim();
  const quantity = Number(item.quantity || 1);
  if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Cannot allocate production cost to an invalid order item.");
  }

  const layers = await tx.manufacturerInventoryCostLayer.findMany({
    where: {
      manufacturerId,
      productId,
      size,
      color,
      availableQuantity: { gt: 0 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let remaining = quantity;
  const allocations = [];
  for (const layer of layers) {
    if (!remaining) break;
    const take = Math.min(remaining, layer.availableQuantity);
    const claimed = await tx.manufacturerInventoryCostLayer.updateMany({
      where: { id: layer.id, availableQuantity: { gte: take } },
      data: {
        availableQuantity: { decrement: take },
        reservedQuantity: { increment: take },
      },
    });
    if (claimed.count !== 1) throw Object.assign(new Error("Production stock changed during FIFO allocation. Retry the order acceptance."), { statusCode: 409 });

    const allocation = await tx.manufacturerInventoryCostAllocation.create({
      data: { orderId, orderItemIndex: itemIndex, costLayerId: layer.id, quantity: take, state: "RESERVED" },
    });
    allocations.push({
      allocationId: allocation.id,
      costLayerId: layer.id,
      quantity: take,
      unitCogs: layer.unitCogs.toFixed(2),
      unitDeliveryCost: layer.unitDeliveryCost.toFixed(2),
    });
    remaining -= take;
  }

  return {
    productionCostAllocations: allocations,
    legacyCostQuantity: remaining,
  };
};

export const transitionOrderProductionAllocations = async ({ tx, orderId, fromState, toState }) => {
  const allocations = await tx.manufacturerInventoryCostAllocation.findMany({
    where: { orderId, state: fromState },
    include: { costLayer: true },
  });
  for (const allocation of allocations) {
    const claimed = await tx.manufacturerInventoryCostAllocation.updateMany({
      where: { id: allocation.id, state: fromState },
      data: { state: toState },
    });
    if (claimed.count !== 1) throw Object.assign(new Error("Production cost allocation changed during order transition."), { statusCode: 409 });

    if (fromState === "RESERVED" && toState === "CONSUMED") {
      await tx.manufacturerInventoryCostLayer.update({
        where: { id: allocation.costLayerId },
        data: {
          reservedQuantity: { decrement: allocation.quantity },
          consumedQuantity: { increment: allocation.quantity },
        },
      });
    } else if (fromState === "RESERVED" && toState === "RELEASED") {
      await tx.manufacturerInventoryCostLayer.update({
        where: { id: allocation.costLayerId },
        data: {
          reservedQuantity: { decrement: allocation.quantity },
          availableQuantity: { increment: allocation.quantity },
        },
      });
    }
  }
  return allocations;
};
