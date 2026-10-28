import { Prisma } from "@prisma/client";

const normalizeVariantValue = (value) => String(value || "Standard").trim().toLowerCase();

const VALID_VAT_TREATMENTS = new Set(["EXEMPT", "VAT_INCLUSIVE", "VAT_EXCLUSIVE"]);

export const normalizeProductionVatTerms = ({
  vatTreatment = "EXEMPT",
  vatRate = 13,
  vatInvoiceReference = "",
} = {}) => {
  const treatment = String(vatTreatment || "EXEMPT").trim().toUpperCase();
  const rate = new Prisma.Decimal(String(vatRate));
  const invoiceReference = String(vatInvoiceReference || "").trim();
  if (!VALID_VAT_TREATMENTS.has(treatment)) {
    throw new Error("Choose VAT inclusive, VAT exclusive, or no VAT.");
  }
  if (!rate.isFinite() || rate.isNegative() || rate.greaterThan(100) ||
      (treatment !== "EXEMPT" && !rate.greaterThan(0))) {
    throw new Error("VAT rate must be greater than zero and no more than 100% when VAT applies.");
  }
  if (invoiceReference.length > 120) {
    throw new Error("VAT invoice reference cannot exceed 120 characters.");
  }
  if (treatment !== "EXEMPT" && !invoiceReference) {
    throw new Error("Provide the VAT invoice reference when VAT applies.");
  }
  return {
    vatTreatment: treatment,
    vatRate: rate.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    vatInvoiceReference: invoiceReference || null,
  };
};

export const calculateProductionUnitCost = ({
  unitAmount,
  vatTreatment = "EXEMPT",
  vatRate = 13,
  vatInvoiceVerified = false,
  vatInvoiceReference = "",
}) => {
  const enteredAmount = new Prisma.Decimal(String(unitAmount));
  if (!enteredAmount.isFinite() || !enteredAmount.greaterThan(0)) {
    throw new Error("Per-piece COGS must be a valid amount greater than zero.");
  }
  const terms = normalizeProductionVatTerms({ vatTreatment, vatRate, vatInvoiceReference });
  const rate = new Prisma.Decimal(String(terms.vatRate));
  let netAmount = enteredAmount;
  let vatAmount = new Prisma.Decimal(0);
  let grossAmount = enteredAmount;
  if (terms.vatTreatment === "VAT_INCLUSIVE") {
    netAmount = enteredAmount.div(new Prisma.Decimal(1).plus(rate.div(100)))
      .toDecimalPlaces(14, Prisma.Decimal.ROUND_HALF_UP);
    vatAmount = enteredAmount.minus(netAmount);
  } else if (terms.vatTreatment === "VAT_EXCLUSIVE") {
    vatAmount = enteredAmount.mul(rate).div(100)
      .toDecimalPlaces(14, Prisma.Decimal.ROUND_HALF_UP);
    grossAmount = enteredAmount.plus(vatAmount);
  }
  const recoverableVat = vatInvoiceVerified ? vatAmount : new Prisma.Decimal(0);
  const capitalizedAmount = vatInvoiceVerified ? netAmount : grossAmount;
  return {
    vatTreatment: terms.vatTreatment,
    vatRate: terms.vatRate,
    netAmount,
    vatAmount,
    grossAmount,
    recoverableVat,
    capitalizedAmount,
  };
};

export const validateManufacturerProductionQuote = ({
  unitCogs,
  averagePricePerUnit,
  otherCost,
  vatTreatment,
  vatRate,
  vatInvoiceReference,
  manufacturerNote,
} = {}) => {
  const price = new Prisma.Decimal(String(averagePricePerUnit ?? unitCogs ?? ""));
  const batchOtherCost = new Prisma.Decimal(String(otherCost ?? ""));
  if (!price.isFinite() || !price.greaterThan(0) ||
      !batchOtherCost.isFinite() || batchOtherCost.isNegative()) {
    throw new Error("Provide a positive per-piece price and a non-negative batch expense.");
  }
  const vatTerms = normalizeProductionVatTerms({ vatTreatment, vatRate, vatInvoiceReference });
  calculateProductionUnitCost({ unitAmount: price, ...vatTerms });
  const note = String(manufacturerNote || "").trim();
  if (note.length > 2000) {
    throw new Error("Manufacturer note cannot exceed 2000 characters.");
  }
  return {
    unitCogs: price.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    otherCost: batchOtherCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    ...vatTerms,
    manufacturerNote: note || null,
  };
};

export const normalizeProductionRequestLines = (lines) => {
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
  return { lines: normalizedLines, totalQuantity };
};

export const calculateFullyLoadedUnitCogs = ({ unitCogs, batchOtherCost, goodQuantity }) => {
  const baseCogs = new Prisma.Decimal(String(unitCogs));
  const otherCost = new Prisma.Decimal(String(batchOtherCost ?? 0));
  if (!baseCogs.isFinite() || baseCogs.isNegative() || !otherCost.isFinite() || otherCost.isNegative()) {
    throw new Error("Production unit COGS and batch other cost must be valid non-negative amounts.");
  }
  if (!Number.isInteger(goodQuantity) || goodQuantity < 0) {
    throw new Error("Good production quantity must be a non-negative whole number.");
  }
  if (goodQuantity === 0) return baseCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return baseCogs.add(otherCost.div(goodQuantity))
    .toDecimalPlaces(14, Prisma.Decimal.ROUND_HALF_UP);
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
      unitCogs: layer.unitCogs.toFixed(14),
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
