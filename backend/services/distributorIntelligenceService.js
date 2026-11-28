import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";

const fail = (message, code = "INVALID_INTELLIGENCE_REQUEST", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const clean = (value, maxLength = 191) => {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw fail(`Value cannot exceed ${maxLength} characters.`);
  return text;
};
const decimal = (value) => new Prisma.Decimal(String(value ?? 0));
const roundDecimal = (value) => decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const validDateRange = (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 86400000);
  const end = endDate ? new Date(endDate) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw fail("Valid startDate and endDate values are required.");
  }
  if ((end.getTime() - start.getTime()) > 366 * 86400000) throw fail("Date range cannot exceed 366 days.");
  return { start, end };
};

const cancelledStatus = (status) =>
  ["cancelled", "canceled", "rejected", "voided"].includes(String(status || "").trim().toLowerCase());

export const calculateNetVelocity = (soldQuantity, returnedQuantity, elapsedDays) => {
  if (!Number.isSafeInteger(soldQuantity) && soldQuantity !== 0) throw fail("Sold quantity must be a whole number.");
  if (!Number.isSafeInteger(returnedQuantity) && returnedQuantity !== 0) throw fail("Returned quantity must be a whole number.");
  if (!Number.isSafeInteger(elapsedDays) || elapsedDays <= 0) throw fail("Elapsed days must be positive.");
  const net = Math.max(0, Number(soldQuantity) - Number(returnedQuantity));
  return roundDecimal(net / elapsedDays);
};

export const getSalesVelocity = async ({
  distributorId,
  startDate,
  endDate,
  productId = null,
  client = prisma,
}) => {
  const range = validDateRange(startDate, endDate);
  const assignments = await client.orderAssignment.findMany({
    where: { distributorId },
    select: { orderId: true },
  });
  const assignmentOrderIds = assignments.map((item) => item.orderId);
  const orders = await client.order.findMany({
    where: {
      date: { gte: BigInt(range.start.getTime()), lt: BigInt(range.end.getTime()) },
      ...(assignmentOrderIds.length ? {
        OR: [{ distributorId }, { id: { in: assignmentOrderIds } }, { directNotes: { contains: "B2B wholesale" } }],
      } : { distributorId }),
    },
    select: { id: true, status: true, items: true, amount: true, distributorId: true, paymentMethod: true, date: true },
  });
  const productSold = new Map();
  for (const order of orders) {
    if (cancelledStatus(order.status)) continue;
    const items = parseJson(order.items, []);
    for (const item of items) {
      const itemProductId = String(item.productId || item._id || item.id || "");
      if (!itemProductId || (productId && itemProductId !== productId)) continue;
      const quantity = Number(item.quantity || 0);
      if (!Number.isSafeInteger(quantity) || quantity < 0) continue;
      const key = itemProductId;
      const current = productSold.get(key) || { soldQuantity: 0, revenue: 0, sizes: new Map(), colors: new Map() };
      current.soldQuantity += quantity;
      current.revenue += Number(item.lineTotal || item.price || 0) * quantity;
      const size = String(item.size || "Standard");
      const color = String(item.color || "Standard");
      current.sizes.set(size, (current.sizes.get(size) || 0) + quantity);
      current.colors.set(color, (current.colors.get(color) || 0) + quantity);
      productSold.set(key, current);
    }
  }
  const returns = await client.customerReturn.findMany({
    where: {
      refundStatus: "COMPLETED",
      returnDate: { gte: range.start, lt: range.end },
      OR: [{ distributorId }, { orderId: { in: orders.map((order) => order.id) } }],
    },
    select: { items: true, distributorId: true },
  });
  const returnedByProduct = new Map();
  for (const customerReturn of returns) {
    for (const item of parseJson(customerReturn.items, [])) {
      const itemProductId = String(item.productId || item._id || item.id || "");
      if (!itemProductId || (productId && itemProductId !== productId)) continue;
      returnedByProduct.set(itemProductId, (returnedByProduct.get(itemProductId) || 0) + Number(item.quantity || 0));
    }
  }
  const elapsed = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  const periods = [14, 30, 60, 90];
  const now = new Date();
  const result = [];
  for (const [itemProductId, sold] of productSold.entries()) {
    const returned = returnedByProduct.get(itemProductId) || 0;
    const velocities = {};
    for (const days of periods) {
      const periodStart = new Date(now.getTime() - days * 86400000);
      const periodOrders = orders.filter((order) =>
        Number(order.date) >= periodStart.getTime() &&
        !cancelledStatus(order.status)
      );
      let periodSold = 0;
      for (const order of periodOrders) {
        for (const item of parseJson(order.items, [])) {
          if (String(item.productId || item._id || item.id || "") === itemProductId) {
            periodSold += Number(item.quantity || 0);
          }
        }
      }
      velocities[days] = calculateNetVelocity(periodSold, returned, days);
    }
    result.push({
      productId: itemProductId,
      soldQuantity: sold.soldQuantity,
      returnedQuantity: returned,
      netQuantity: Math.max(0, sold.soldQuantity - returned),
      grossRevenue: Number(sold.revenue.toFixed(2)),
      velocities,
      sizes: [...sold.sizes.entries()].map(([size, quantity]) => ({ size, quantity })),
      colors: [...sold.colors.entries()].map(([color, quantity]) => ({ color, quantity })),
    });
  }
  return { range: { start: range.start, end: range.end }, elapsedDays: elapsed, products: result };
};

export const getInventoryReplenishment = async ({
  distributorId,
  generatedAt = new Date(),
  client = prisma,
}) => {
  const location = await client.inventoryLocation.findFirst({
    where: { kind: "DISTRIBUTOR", distributorId, inventoryOwner: "PLATFORM", isActive: true },
  });
  if (!location) throw fail("No active distributor inventory location was found.", "DISTRIBUTOR_LOCATION_NOT_FOUND", 404);
  const balances = await client.inventoryBalance.findMany({
    where: { locationId: location.id },
    include: {
      inventorySku: { include: { product: { select: { id: true, name: true, image: true } } } },
    },
  });
  const policies = await client.distributorInventoryPolicy.findMany({
    where: { distributorId, active: true },
  });
  const policyBySku = new Map(policies.map((policy) => [policy.inventorySkuId, policy]));
  const incomingLines = await client.stockTransferLine.findMany({
    where: {
      stockTransfer: {
        distributorId,
        status: { in: ["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] },
      },
    },
    select: {
      inventorySkuId: true,
      approvedQuantity: true,
      dispatchedQuantity: true,
      requestedQuantity: true,
    },
  });
  const incomingBySku = new Map();
  for (const line of incomingLines) {
    incomingBySku.set(
      line.inventorySkuId,
      (incomingBySku.get(line.inventorySkuId) || 0) +
        Math.max(0, (line.approvedQuantity ?? line.requestedQuantity ?? 0) - (line.dispatchedQuantity ?? 0)),
    );
  }
  const start90 = new Date(generatedAt.getTime() - 90 * 86400000);
  const velocity = await getSalesVelocity({
    distributorId,
    startDate: start90,
    endDate: generatedAt,
    client,
  });
  const velocityByProduct = new Map(velocity.products.map((product) => [product.productId, product]));
  const damagedLocations = await client.inventoryLocation.findMany({
    where: { kind: { in: ["DAMAGED", "LOST", "QUARANTINE"] }, distributorId, isActive: true },
    select: { id: true },
  });
  const damagedIds = damagedLocations.map((item) => item.id);
  const damagedBalances = damagedIds.length
    ? await client.inventoryBalance.findMany({
        where: { locationId: { in: damagedIds } },
        select: { inventorySkuId: true, quantityOnHand: true },
      })
    : [];
  const damagedBySku = new Map();
  for (const balance of damagedBalances) {
    damagedBySku.set(balance.inventorySkuId, (damagedBySku.get(balance.inventorySkuId) || 0) + balance.quantityOnHand);
  }
  const recommendations = [];
  for (const balance of balances) {
    const sku = balance.inventorySku;
    const policy = policyBySku.get(sku.id);
    const reorderPoint = policy?.reorderPoint ?? 5;
    const safetyStock = policy?.safetyStock ?? 2;
    const leadTimeDays = policy?.leadTimeDays ?? 7;
    const available = Math.max(0, balance.quantityOnHand - balance.reservedQuantity);
    const incoming = incomingBySku.get(sku.id) || 0;
    const damaged = damagedBySku.get(sku.id) || 0;
    const productVelocity = velocityByProduct.get(sku.productId);
    const velocity30 = productVelocity?.velocities?.[30] || 0;
    const velocity14 = productVelocity?.velocities?.[14] || 0;
    const trend = velocity14.greaterThan
      ? (velocity14.greaterThan(velocity30) ? "UP" : "DOWN")
      : "STABLE";
    const target = Math.max(reorderPoint, Math.ceil(Number(velocity30) * leadTimeDays + safetyStock));
    const recommended = Math.max(0, target - available - incoming);
    const historyPoints = productVelocity ? Number(productVelocity.soldQuantity > 0) : 0;
    const confidence = historyPoints && Number(velocity30) > 0 ? "MEDIUM" : "LOW";
    recommendations.push({
      inventorySkuId: sku.id,
      productId: sku.productId,
      productName: sku.product.name,
      size: sku.size,
      color: sku.color,
      availableQuantity: available,
      reservedQuantity: balance.reservedQuantity,
      damagedQuantity: damaged,
      incomingQuantity: incoming,
      reorderPoint,
      safetyStock,
      leadTimeDays,
      targetQuantity: target,
      recommendedQuantity: recommended,
      trend,
      confidence,
      salesVelocity14: velocity14,
      salesVelocity30: velocity30,
      salesVelocity60: productVelocity?.velocities?.[60] || new Prisma.Decimal(0),
      salesVelocity90: productVelocity?.velocities?.[90] || new Prisma.Decimal(0),
      status: recommended > 0 ? "SUGGESTED" : "SUFFICIENT",
    });
  }
  return {
    generatedAt,
    recommendations,
  };
};

export const saveInventoryPolicies = async ({
  distributorId,
  actorAccountId,
  policies,
  client,
}) => client.$transaction(async (tx) => {
  if (!Array.isArray(policies) || policies.length < 1 || policies.length > 500) throw fail("Provide 1 to 500 inventory policies.");
  const saved = [];
  for (const input of policies) {
    const inventorySkuId = clean(input.inventorySkuId);
    const reorderPoint = Number(input.reorderPoint ?? 0);
    const safetyStock = Number(input.safetyStock ?? 0);
    const leadTimeDays = Number(input.leadTimeDays ?? 7);
    if (![reorderPoint, safetyStock, leadTimeDays].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        leadTimeDays > 365) throw fail("Policy quantities must be non-negative whole numbers and lead time cannot exceed 365 days.");
    const sku = await tx.inventorySku.findFirst({ where: { id: inventorySkuId, isActive: true } });
    if (!sku) throw fail("Inventory SKU not found.", "SKU_NOT_FOUND", 404);
    saved.push(await tx.distributorInventoryPolicy.upsert({
      where: { distributorId_inventorySkuId: { distributorId, inventorySkuId } },
      create: {
        distributorId,
        inventorySkuId,
        reorderPoint,
        safetyStock,
        leadTimeDays,
        preferredSource: clean(input.preferredSource || "FACTORY", 32).toUpperCase(),
        active: input.active !== false,
        createdByAccountId: actorAccountId,
        updatedByAccountId: actorAccountId,
      },
      update: {
        reorderPoint,
        safetyStock,
        leadTimeDays,
        preferredSource: clean(input.preferredSource || "FACTORY", 32).toUpperCase(),
        active: input.active !== false,
        updatedByAccountId: actorAccountId,
      },
    }));
  }
  return saved;
}, { isolationLevel: "Serializable" });

export const getProfitability = async ({
  distributorId,
  startDate,
  endDate,
  client = prisma,
}) => {
  const range = validDateRange(startDate, endDate);
  const assignments = await client.orderAssignment.findMany({
    where: { distributorId },
    select: { orderId: true },
  });
  const orderIds = assignments.map((item) => item.orderId);
  const orders = await client.order.findMany({
    where: {
      date: { gte: BigInt(range.start.getTime()), lt: BigInt(range.end.getTime()) },
      OR: [
        { distributorId },
        ...(orderIds.length ? [{ id: { in: orderIds } }] : []),
      ],
      status: { not: "Cancelled" },
    },
    select: {
      id: true,
      orderReference: true,
      amount: true,
      deliveryFee: true,
      items: true,
      status: true,
      paymentMethod: true,
      distributorId: true,
      date: true,
      directOrderType: true,
    },
  });
  const earnings = await client.distributorServiceEarning.findMany({
    where: {
      distributorId,
      effectiveAt: { gte: range.start, lt: range.end },
    },
    select: {
      id: true,
      orderId: true,
      serviceType: true,
      deliveryCharge: true,
      incentiveAmount: true,
      commissionAmount: true,
      otherCharges: true,
      vatRate: true,
      vatAmount: true,
      payableAmount: true,
      appliedReversalAmount: true,
    },
  });
  let grossSales = new Prisma.Decimal(0);
  let grossProfit = new Prisma.Decimal(0);
  let costDataAvailable = true;
  const orderRows = [];
  for (const order of orders) {
    const items = parseJson(order.items, []);
    let orderSales = new Prisma.Decimal(String(order.amount || 0));
    grossSales = grossSales.plus(orderSales);
    let orderCost = new Prisma.Decimal(0);
    let orderCostKnown = true;
    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const allocations = Array.isArray(item.productionCostAllocations) ? item.productionCostAllocations : [];
      if (!allocations.length) {
        const costPrice = item.costPrice;
        if (costPrice === null || costPrice === undefined || Number(costPrice) <= 0) orderCostKnown = false;
        else orderCost = orderCost.plus(new Prisma.Decimal(String(costPrice)).mul(quantity));
      } else {
        for (const allocation of allocations) {
          const unitCogs = Number(allocation.unitCogs);
          if (!Number.isFinite(unitCogs) || unitCogs <= 0) orderCostKnown = false;
          else orderCost = orderCost.plus(new Prisma.Decimal(String(unitCogs)).mul(Number(allocation.quantity || 0)));
        }
      }
    }
    if (!orderCostKnown) costDataAvailable = false;
    const orderProfit = orderCostKnown ? orderSales.minus(orderCost) : new Prisma.Decimal(0);
    if (orderCostKnown) grossProfit = grossProfit.plus(orderProfit);
    const orderEarnings = earnings.filter((earning) => earning.orderId === order.id);
    const operatingExpense = orderEarnings.reduce(
      (sum, earning) => sum.plus(decimal(earning.deliveryCharge))
        .plus(decimal(earning.incentiveAmount))
        .plus(decimal(earning.otherCharges)),
      new Prisma.Decimal(0),
    );
    const commissionDeduction = orderEarnings.reduce(
      (sum, earning) => sum.plus(decimal(earning.commissionAmount)).plus(decimal(earning.appliedReversalAmount)),
      new Prisma.Decimal(0),
    );
    const netEarnings = orderEarnings.reduce((sum, earning) => sum.plus(decimal(earning.payableAmount)), new Prisma.Decimal(0));
    const vatAmount = orderEarnings.reduce((sum, earning) => sum.plus(decimal(earning.vatAmount)), new Prisma.Decimal(0));
    orderRows.push({
      orderId: order.id,
      orderReference: order.orderReference,
      channel: order.directOrderType === "HUB_VISIT" ? "RETAIL" : order.directOrderType === "PHONE_ORDER" ? "PHONE_RETAIL" : "WHOLESALE",
      grossSales: orderSales.toFixed(2),
      grossProfit: orderCostKnown ? orderProfit.toFixed(2) : null,
      costAvailable: orderCostKnown,
      operatingExpense: operatingExpense.toFixed(2),
      commissionDeduction: commissionDeduction.toFixed(2),
      netEarnings: netEarnings.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
    });
  }
  const operatingExpenses = earnings.reduce(
    (sum, earning) => sum.plus(decimal(earning.deliveryCharge))
      .plus(decimal(earning.incentiveAmount))
      .plus(decimal(earning.otherCharges))
      .plus(decimal(earning.commissionAmount))
      .plus(decimal(earning.appliedReversalAmount)),
    new Prisma.Decimal(0),
  );
  const netEarnings = earnings.reduce((sum, earning) => sum.plus(decimal(earning.payableAmount)), new Prisma.Decimal(0));
  return {
    period: { start: range.start, end: range.end },
    grossSales: grossSales.toFixed(2),
    grossProfit: costDataAvailable ? grossProfit.toFixed(2) : null,
    operatingExpenses: operatingExpenses.toFixed(2),
    netEarnings: netEarnings.toFixed(2),
    costDataAvailable,
    methodology: "Gross profit uses only recorded production cost allocations or positive item cost snapshots. Missing cost is never estimated.",
    orders: orderRows,
  };
};

export const getExplainableForecast = async ({
  distributorId,
  inventorySkuId = null,
  client = prisma,
}) => {
  const range = await getSalesVelocity({
    distributorId,
    startDate: new Date(Date.now() - 90 * 86400000),
    endDate: new Date(),
    productId: null,
    client,
  });
  const rows = range.products
    .filter((product) => !inventorySkuId || product.sizes.length > 0)
    .map((product) => {
      const v14 = decimal(product.velocities[14]);
      const v30 = decimal(product.velocities[30]);
      const v90 = decimal(product.velocities[90]);
      const sampleCount = product.sizes.reduce((sum, item) => sum + item.quantity, 0);
      const confidence = sampleCount >= 30 && v90.greaterThan(0)
        ? "MEDIUM"
        : sampleCount >= 10
          ? "LOW"
          : "INSUFFICIENT";
      const forecastDaily = v14.mul(0.5).plus(v30.mul(0.3)).plus(v90.mul(0.2));
      return {
        productId: product.productId,
        forecastDailyUnits: forecastDaily.toDecimalPlaces(6).toString(),
        forecast30DayUnits: forecastDaily.mul(30).toDecimalPlaces(2).toString(),
        confidence,
        basis: {
          netQuantity14: v14.toString(),
          netQuantity30: v30.toString(),
          netQuantity90: v90.toString(),
          soldQuantityInWindow: product.soldQuantity,
          returnedQuantityInWindow: product.returnedQuantity,
        },
        disclaimer: "Explainable weighted historical estimate; not a guaranteed demand forecast.",
      };
    });
  return { generatedAt: new Date(), forecasts: rows };
};

export const createReplenishmentDemand = async ({
  distributorId,
  suggestionId,
  manufacturerId,
  actorAccountId,
  client,
}) => client.$transaction(async (tx) => {
  if (!clean(manufacturerId)) throw fail("Select a manufacturer or approved stock source.");
  const suggestion = await tx.distributorReplenishmentSuggestion.findFirst({
    where: { id: suggestionId, distributorId },
  });
  if (!suggestion) throw fail("Replenishment suggestion not found.", "REPLENISHMENT_NOT_FOUND", 404);
  if (suggestion.status === "DEMAND_CREATED") return tx.stockTransfer.findUnique({ where: { id: suggestion.demandRequestId } });
  const manufacturer = await tx.manufacturer.findFirst({ where: { id: manufacturerId, isActive: true } });
  if (!manufacturer) throw fail("Manufacturer is unavailable.", "MANUFACTURER_NOT_ACTIVE", 404);
  const sourceLocation = await tx.inventoryLocation.findFirst({
    where: { kind: "FACTORY", manufacturerId, inventoryOwner: "PLATFORM", isActive: true },
  });
  if (!sourceLocation) throw fail("Manufacturer stock location not found.", "FACTORY_LOCATION_NOT_FOUND", 409);
  const destinationLocation = await tx.inventoryLocation.findFirst({
    where: { kind: "DISTRIBUTOR", distributorId, inventoryOwner: "PLATFORM", isActive: true },
  });
  if (!destinationLocation) throw fail("Distributor inventory location not found.", "DISTRIBUTOR_LOCATION_NOT_FOUND", 409);
  const key = `replenishment-demand:${suggestion.id}`;
  const existing = await tx.stockTransfer.findFirst({
    where: { manufacturerId, distributorId, requestedByAccountId: key },
  });
  if (existing) {
    await tx.distributorReplenishmentSuggestion.update({
      where: { id: suggestion.id },
      data: { status: "DEMAND_CREATED", demandRequestId: existing.id },
    });
    return existing;
  }
  const transfer = await tx.stockTransfer.create({
    data: {
      manufacturerId,
      distributorId,
      sourceLocationId: sourceLocation.id,
      destinationLocationId: destinationLocation.id,
      status: "PENDING_ADMIN_APPROVAL",
      requestedByAccountId: key,
      lines: {
        create: [{
          inventorySkuId: suggestion.inventorySkuId,
          requestedQuantity: suggestion.recommendedQuantity,
          approvedQuantity: 0,
        }],
      },
    },
  });
  await tx.distributorReplenishmentSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "DEMAND_CREATED", demandRequestId: transfer.id },
  });
  return transfer;
}, { isolationLevel: "Serializable" });

export const getMonthlyStatementData = async ({
  distributorId,
  year,
  month,
  client = prisma,
}) => {
  if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(month)) ||
      Number(month) < 1 || Number(month) > 12) throw fail("Valid year and month are required.");
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const end = new Date(Date.UTC(Number(year), Number(month), 1));
  const statement = await client.distributorServiceEarning.findMany({
    where: { distributorId, effectiveAt: { gte: start, lt: end } },
    orderBy: { effectiveAt: "asc" },
  });
  const earnings = statement.map((earning) => ({
    id: earning.id,
    orderId: earning.orderId,
    assignmentId: earning.assignmentId,
    serviceType: earning.serviceType,
    effectiveAt: earning.effectiveAt,
    deliveryCharge: earning.deliveryCharge,
    incentiveAmount: earning.incentiveAmount,
    commissionAmount: earning.commissionAmount,
    otherCharges: earning.otherCharges,
    vatRate: earning.vatRate,
    vatAmount: earning.vatAmount,
    payableAmount: earning.payableAmount,
    appliedReversalAmount: earning.appliedReversalAmount,
  }));
  const totals = earnings.reduce((sum, earning) => ({
    gross: sum.gross.plus(decimal(earning.deliveryCharge).plus(decimal(earning.incentiveAmount)).plus(decimal(earning.otherCharges))),
    commission: sum.commission.plus(decimal(earning.commissionAmount)).plus(decimal(earning.appliedReversalAmount)),
    vat: sum.vat.plus(decimal(earning.vatAmount)),
    net: sum.net.plus(decimal(earning.payableAmount)),
  }), {
    gross: new Prisma.Decimal(0),
    commission: new Prisma.Decimal(0),
    vat: new Prisma.Decimal(0),
    net: new Prisma.Decimal(0),
  });
  return {
    period: { start, end, year: Number(year), month: Number(month) },
    totals: {
      gross: totals.gross.toFixed(2),
      commission: totals.commission.toFixed(2),
      vat: totals.vat.toFixed(2),
      net: totals.net.toFixed(2),
    },
    earnings,
  };
};

export const createReplenishmentSuggestion = async ({
  distributorId,
  actorAccountId,
  inventorySkuId,
  client,
}) => client.$transaction(async (tx) => {
  const report = await getInventoryReplenishment({ distributorId, client: tx });
  const recommendation = report.recommendations.find((item) => item.inventorySkuId === inventorySkuId);
  if (!recommendation) throw fail("Inventory SKU not found at this distributor.", "SKU_NOT_FOUND", 404);
  if (recommendation.recommendedQuantity <= 0) throw fail("No replenishment quantity is recommended.", "REPLENISHMENT_NOT_REQUIRED", 409);
  const periodEnd = report.generatedAt;
  const periodStart = new Date(periodEnd.getTime() - 90 * 86400000);
  const idempotencyKey = `replenishment:${distributorId}:${inventorySkuId}:${periodStart.toISOString().slice(0, 10)}`;
  const existing = await tx.distributorReplenishmentSuggestion.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  return tx.distributorReplenishmentSuggestion.create({
    data: {
      distributorId,
      inventorySkuId,
      periodStart,
      periodEnd,
      salesVelocity14: recommendation.salesVelocity14,
      salesVelocity30: recommendation.salesVelocity30,
      salesVelocity60: recommendation.salesVelocity60,
      salesVelocity90: recommendation.salesVelocity90,
      availableQuantity: recommendation.availableQuantity,
      reservedQuantity: recommendation.reservedQuantity,
      damagedQuantity: recommendation.damagedQuantity,
      incomingQuantity: recommendation.incomingQuantity,
      reorderPoint: recommendation.reorderPoint,
      safetyStock: recommendation.safetyStock,
      leadTimeDays: recommendation.leadTimeDays,
      targetQuantity: recommendation.targetQuantity,
      recommendedQuantity: recommendation.recommendedQuantity,
      trend: recommendation.trend,
      confidence: recommendation.confidence,
      status: "PENDING",
      idempotencyKey,
      snapshot: recommendation,
      createdByAccountId: actorAccountId,
    },
  });
}, { isolationLevel: "Serializable" });
