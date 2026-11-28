import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  multiplyDecimals,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";
import { pricingSnapshotAmounts } from "./checkoutPricingService.js";

const payableJournalSourceTypes = new Set([
  "MANUFACTURER_PRODUCTION",
  "MANUFACTURER_LOGISTICS",
  "DELIVERY_SALE",
  "DELIVERY_RETURN",
]);

const zero = () => accountingDecimal("0");
const sourceDecimal = (value, fieldName) => accountingDecimal(
  value === null || value === undefined
    ? "0"
    : typeof value === "number"
      ? String(value)
      : value,
  fieldName,
);
const nprDecimal = (value) => quantizeNprAmount(sourceDecimal(value).toString());
const amountString = (value) => nprDecimal(value).toFixed(2);
const sourceAmountString = (value, fieldName) => sourceDecimal(value, fieldName).toString();
const maxZero = (value) => compareDecimals(value, "0") > 0 ? accountingDecimal(value) : zero();
const maxDecimal = (left, right) => compareDecimals(left, right) >= 0
  ? accountingDecimal(left)
  : accountingDecimal(right);

const parseOrderItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const quantityOf = (item) => Number(item.quantity || 1);
const orderQuantityOf = (items) => items.reduce((sum, item) => sum + quantityOf(item), 0);

const makeProductCostMap = (products) => new Map(products.map((product) => [
  product.id,
  sourceDecimal(product.costPrice || 0, "Product cost price"),
]));

const makeInventoryCostMap = (inventoryRows, keyOf) => new Map(inventoryRows.map((entry) => {
  const cost = entry.agreedCostPrice || entry.proposedCostPrice || 0;
  return [keyOf(entry), sourceDecimal(cost, "Manufacturer inventory cost price")];
}));

const calculateOrderCost = (items, orderManufacturerId, inventoryCostMap, productCostMap, keyOf) => {
  const orderCost = items.reduce((total, item) => {
    const productId = item.productId || item._id || item.id;
    const manufacturerId = item.manufacturerId || orderManufacturerId;
    const customCost = manufacturerId ? inventoryCostMap.get(keyOf(manufacturerId, productId)) : undefined;
    const fallbackCost = productCostMap.get(productId) || zero();
    const unitCost = customCost && compareDecimals(customCost, "0") > 0 ? customCost : fallbackCost;
    return addDecimals(total, multiplyDecimals(sourceDecimal(item.quantity || 1, "Order quantity"), unitCost));
  }, zero());

  return nprDecimal(orderCost);
};

const isDirectManufacturerOrder = (order) =>
  order.orderType === "DIRECT_MANUFACTURER" &&
  ["PHONE_ORDER", "HUB_VISIT"].includes(order.directOrderType);

const orderStatusFlags = (order) => {
  const statusText = String(order.status || "").trim().toLowerCase();
  return {
    isDelivered: statusText.includes("deliver") || order.fulfillmentStatus === "DELIVERED",
    isReturned: statusText.includes("return") || statusText.includes("cancel"),
  };
};

const serializeOrder = ({
  order,
  manufacturerId,
  manufacturerName,
  isDirect,
  orderSales,
  orderQuantity,
  orderCost,
  payable,
  receivable,
}) => ({
  id: order.id,
  manufacturerId,
  manufacturerName,
  orderType: order.orderType,
  directOrderType: order.directOrderType || null,
  isDirect,
  status: order.status,
  fulfillmentStatus: order.fulfillmentStatus,
  date: order.date ? Number(order.date) : null,
  ...(isDirect ? { amount: sourceAmountString(orderSales, "Order amount") } : {}),
  quantity: orderQuantity,
  cogs: amountString(orderCost),
  payable: amountString(payable),
  receivable: amountString(receivable),
  netPosition: subtractDecimals(receivable, payable).toFixed(2),
});

const isManufacturerJournalLine = (line, manufacturerId, manufacturerName) => {
  const normalizedName = String(manufacturerName || "").trim().toLowerCase();
  return line.supplierId === manufacturerId ||
    (line.accountingParty?.partyType === "MANUFACTURER" &&
      line.accountingParty.sourceEntityId === manufacturerId) ||
    String(line.supplierName || "").trim().toLowerCase() === normalizedName;
};

const emptyPostedPayable = () => ({
  recognized: zero(),
  paid: zero(),
});

const addPostedPayableLine = (totals, line, isManufacturerLine, includePaymentByReference = false) => {
  const sourceType = line.journalEntry?.sourceType;
  const debit = sourceDecimal(line.debit, "Posted manufacturer payable debit");
  const credit = sourceDecimal(line.credit, "Posted manufacturer payable credit");

  if (payableJournalSourceTypes.has(sourceType) && isManufacturerLine) {
    totals.recognized = addDecimals(totals.recognized, subtractDecimals(credit, debit));
  }
  if (sourceType === "SUPPLIER_PAYMENT" && (isManufacturerLine || includePaymentByReference)) {
    totals.paid = addDecimals(totals.paid, subtractDecimals(debit, credit));
  }
};

export const summarizePostedManufacturerPayable = (lines, manufacturerId, manufacturerName) => {
  const totals = emptyPostedPayable();
  for (const line of lines) {
    const matchesManufacturer = isManufacturerJournalLine(line, manufacturerId, manufacturerName);
    const sourceIdMatches = line.journalEntry?.sourceId === `MFG-COGS-${manufacturerId}`;
    addPostedPayableLine(totals, line, matchesManufacturer, sourceIdMatches);
  }

  const recognized = nprDecimal(totals.recognized);
  const paid = nprDecimal(totals.paid);
  const outstanding = maxZero(nprDecimal(subtractDecimals(recognized, paid)));
  return {
    recognized: amountString(recognized),
    paid: amountString(paid),
    outstanding: amountString(outstanding),
  };
};

const addToMap = (map, key, amount) => {
  map.set(key, addDecimals(map.get(key) || zero(), amount));
};

const buildOrderMetrics = ({
  order,
  orderManufacturerId,
  manufacturerName,
  inventoryCostMap,
  productCostMap,
  inventoryKey,
  isAdminView,
}) => {
  const items = parseOrderItems(order.items);
  const orderQuantity = orderQuantityOf(items);
  const orderSales = sourceDecimal(
    pricingSnapshotAmounts(order).finalPayableTotal,
    "Accepted order amount",
  );
  const orderCost = calculateOrderCost(items, orderManufacturerId, inventoryCostMap, productCostMap, inventoryKey);
  const isDirect = isDirectManufacturerOrder(order);
  const manufacturerPayable = isDirect
    ? maxZero(nprDecimal(subtractDecimals(orderSales, orderCost)))
    : zero();
  const manufacturerReceivable = orderCost;

  return {
    items,
    orderQuantity,
    orderSales,
    orderCost,
    isDirect,
    payable: isAdminView ? manufacturerReceivable : manufacturerPayable,
    receivable: isAdminView ? manufacturerPayable : manufacturerReceivable,
    ...orderStatusFlags(order),
    manufacturerName,
  };
};

export const buildSingleManufacturerSummary = ({
  manufacturerId,
  manufacturer,
  orders = [],
  inventoryRows = [],
  products = [],
  transactions = [],
  postedPayableLines = [],
  isAdminView = false,
} = {}) => {
  const scopedOrders = orders.filter((order) => order.manufacturerId === manufacturerId);
  const scopedTransactions = transactions.filter(
    (transaction) => transaction.referenceId === manufacturerId || transaction.partyName === manufacturerId,
  );
  const inventoryCostMap = makeInventoryCostMap(
    inventoryRows.filter((entry) => entry.manufacturerId === manufacturerId),
    (entry) => entry.productId,
  );
  const productCostMap = makeProductCostMap(products);
  const totals = {
    sales: zero(),
    cogs: zero(),
    payable: zero(),
    receivable: zero(),
  };
  let itemsSold = 0;
  let itemsDelivered = 0;
  let itemsReturned = 0;
  let deliveredOrders = 0;
  let returnedOrders = 0;

  const orderBreakdown = scopedOrders.map((order) => {
    const metrics = buildOrderMetrics({
      order,
      orderManufacturerId: manufacturerId,
      manufacturerName: manufacturer?.name || "Manufacturer",
      inventoryCostMap,
      productCostMap,
      inventoryKey: (_manufacturerId, productId) => productId,
      isAdminView,
    });
    totals.sales = addDecimals(totals.sales, metrics.isDirect ? metrics.orderSales : "0");
    totals.cogs = addDecimals(totals.cogs, metrics.orderCost);
    totals.payable = addDecimals(totals.payable, metrics.payable);
    totals.receivable = addDecimals(totals.receivable, metrics.receivable);
    itemsSold += metrics.orderQuantity;
    if (metrics.isDelivered) {
      itemsDelivered += metrics.orderQuantity;
      deliveredOrders += 1;
    }
    if (metrics.isReturned) {
      itemsReturned += metrics.orderQuantity;
      returnedOrders += 1;
    }

    return serializeOrder({
      order,
      manufacturerId,
      manufacturerName: metrics.manufacturerName,
      isDirect: metrics.isDirect,
      orderSales: metrics.orderSales,
      orderQuantity: metrics.orderQuantity,
      orderCost: metrics.orderCost,
      payable: metrics.payable,
      receivable: metrics.receivable,
    });
  });

  let paidToManufacturer = zero();
  let collectedFromManufacturer = zero();
  const formattedTransactions = scopedTransactions.map((transaction) => {
    const amount = sourceDecimal(transaction.amount, "Manufacturer transaction amount");
    if (transaction.type === "OUTFLOW") paidToManufacturer = addDecimals(paidToManufacturer, amount);
    if (transaction.type === "INFLOW") collectedFromManufacturer = addDecimals(collectedFromManufacturer, amount);
    return {
      id: transaction.id,
      date: transaction.date || transaction.createdAt,
      amount: sourceAmountString(amount, "Manufacturer transaction amount"),
      type: transaction.type,
      category: transaction.category,
      partyName: transaction.partyName,
      accountName: transaction.fromAccount?.accountName || transaction.toAccount?.accountName || "Treasury Account",
      accountType: transaction.fromAccount?.accountType || transaction.toAccount?.accountType || "BANK",
      description: transaction.description,
      createdAt: transaction.createdAt,
    };
  });

  const postedPayable = summarizePostedManufacturerPayable(
    postedPayableLines,
    manufacturerId,
    manufacturer?.name,
  );
  const paidAgainstReceivable = isAdminView ? collectedFromManufacturer : paidToManufacturer;
  const totalPayable = sourceDecimal(postedPayable.recognized);
  const totalPaidToManufacturer = sourceDecimal(postedPayable.paid);
  const remainingPayable = sourceDecimal(postedPayable.outstanding);
  const remainingReceivable = maxZero(nprDecimal(subtractDecimals(totals.receivable, paidAgainstReceivable)));
  const netPayable = maxZero(nprDecimal(subtractDecimals(remainingPayable, remainingReceivable)));
  const netReceivable = maxZero(nprDecimal(subtractDecimals(remainingReceivable, remainingPayable)));

  const summary = {
    totalOrders: scopedOrders.length,
    totalSales: amountString(totals.sales),
    totalCogs: amountString(totals.cogs),
    payable: amountString(totalPayable),
    paidAmount: amountString(totalPaidToManufacturer),
    remainingPayable: amountString(remainingPayable),
    receivable: amountString(totals.receivable),
    collectedAmount: amountString(collectedFromManufacturer),
    remainingReceivable: amountString(remainingReceivable),
    netPayable: amountString(netPayable),
    netReceivable: amountString(netReceivable),
    netSettlementDue: netPayable.isPositive() ? amountString(netPayable) : amountString(subtractDecimals("0", netReceivable)),
    itemsSold,
    itemsDelivered,
    itemsReturned,
    deliveredOrders,
    returnedOrders,
  };
  const manufacturerRow = {
    id: manufacturer?.id || manufacturerId,
    name: manufacturer?.name || "Manufacturer",
    email: manufacturer?.email || "",
    phone: manufacturer?.phone || "",
    city: manufacturer?.city || "",
    ...summary,
    orders: orderBreakdown,
  };

  return {
    manufacturer: manufacturer || { id: manufacturerId },
    summary,
    manufacturers: [manufacturerRow],
    orders: orderBreakdown,
    transactions: formattedTransactions,
  };
};

const sumPostedPayablesByManufacturer = (lines, manufacturers) => {
  const totalsByManufacturer = new Map();
  for (const line of lines) {
    const sourceType = line.journalEntry?.sourceType;
    const sourceId = String(line.journalEntry?.sourceId || "");
    const fallbackId = sourceType === "SUPPLIER_PAYMENT" && sourceId.startsWith("MFG-COGS-")
      ? sourceId.slice("MFG-COGS-".length)
      : null;
    const manufacturer = manufacturers.find((entry) =>
      entry.id === line.supplierId ||
      entry.id === line.accountingParty?.sourceEntityId ||
      entry.id === fallbackId ||
      String(entry.name || "").trim().toLowerCase() === String(line.supplierName || "").trim().toLowerCase()
    );
    if (!manufacturer) continue;

    const totals = totalsByManufacturer.get(manufacturer.id) || emptyPostedPayable();
    addPostedPayableLine(
      totals,
      line,
      true,
      sourceType === "SUPPLIER_PAYMENT" && sourceId === `MFG-COGS-${manufacturer.id}`,
    );
    totalsByManufacturer.set(manufacturer.id, totals);
  }
  return totalsByManufacturer;
};

export const buildAllManufacturersSummary = ({
  orders = [],
  manufacturers = [],
  inventoryRows = [],
  products = [],
  supplierPayments = [],
  apRecords = [],
  postedPayableLines = [],
} = {}) => {
  const postedPayableMap = sumPostedPayablesByManufacturer(postedPayableLines, manufacturers);
  const paidByManufacturer = new Map();
  for (const transaction of supplierPayments) {
    const amount = sourceDecimal(transaction.amount, "Supplier payment amount");
    if (transaction.referenceId) addToMap(paidByManufacturer, transaction.referenceId, amount);
    for (const manufacturer of manufacturers) {
      const nameMatches =
        transaction.partyName?.toLowerCase() === manufacturer.name?.toLowerCase() ||
        transaction.description?.toLowerCase().includes(manufacturer.name?.toLowerCase());
      if (transaction.referenceId === manufacturer.id || nameMatches) {
        addToMap(
          paidByManufacturer,
          manufacturer.id,
          transaction.referenceId === manufacturer.id ? "0" : amount,
        );
      }
    }
  }
  for (const payable of apRecords) {
    if (!payable.referenceId) continue;
    const priorPaid = paidByManufacturer.get(payable.referenceId) || zero();
    paidByManufacturer.set(
      payable.referenceId,
      maxDecimal(priorPaid, sourceDecimal(payable.paidAmount, "Manufacturer payable paid amount")),
    );
  }

  const inventoryCostMap = makeInventoryCostMap(
    inventoryRows,
    (entry) => `${entry.manufacturerId}_${entry.productId}`,
  );
  const productCostMap = makeProductCostMap(products);
  const groups = new Map(manufacturers.map((manufacturer) => [
    manufacturer.id,
    {
      id: manufacturer.id,
      name: manufacturer.name,
      email: manufacturer.email,
      phone: manufacturer.phone,
      city: manufacturer.city,
      totalOrders: 0,
      totalSales: zero(),
      totalCogs: zero(),
      payable: zero(),
      paidAmount: nprDecimal(paidByManufacturer.get(manufacturer.id) || zero()),
      remainingPayable: zero(),
      receivable: zero(),
      itemsSold: 0,
      itemsDelivered: 0,
      itemsReturned: 0,
      deliveredOrders: 0,
      returnedOrders: 0,
      orders: [],
    },
  ]));
  const totals = {
    sales: zero(),
    cogs: zero(),
    payable: zero(),
    receivable: zero(),
    paid: zero(),
  };
  let itemsSold = 0;
  let itemsDelivered = 0;
  let itemsReturned = 0;
  let deliveredOrders = 0;
  let returnedOrders = 0;

  const orderBreakdown = [];
  for (const order of orders) {
    const items = parseOrderItems(order.items);
    const orderManufacturerId = order.manufacturerId || items[0]?.manufacturerId;
    const group = groups.get(orderManufacturerId);
    if (!orderManufacturerId || !group) continue;

    const metrics = buildOrderMetrics({
      order,
      orderManufacturerId,
      manufacturerName: groups.get(orderManufacturerId)?.name || "Unassigned",
      inventoryCostMap,
      productCostMap,
      inventoryKey: (manufacturerId, productId) => `${manufacturerId}_${productId}`,
      isAdminView: true,
    });
    const orderItem = serializeOrder({
      order,
      manufacturerId: orderManufacturerId,
      manufacturerName: metrics.manufacturerName || "Unassigned",
      isDirect: metrics.isDirect,
      orderSales: metrics.orderSales,
      orderQuantity: metrics.orderQuantity,
      orderCost: metrics.orderCost,
      payable: metrics.payable,
      receivable: metrics.receivable,
    });
    orderBreakdown.push(orderItem);

    totals.sales = addDecimals(totals.sales, metrics.isDirect ? metrics.orderSales : "0");
    totals.cogs = addDecimals(totals.cogs, metrics.orderCost);
    totals.receivable = addDecimals(totals.receivable, metrics.receivable);
    itemsSold += metrics.orderQuantity;
    if (metrics.isDelivered) {
      itemsDelivered += metrics.orderQuantity;
      deliveredOrders += 1;
    }
    if (metrics.isReturned) {
      itemsReturned += metrics.orderQuantity;
      returnedOrders += 1;
    }

    group.totalOrders += 1;
    group.totalSales = addDecimals(group.totalSales, metrics.isDirect ? metrics.orderSales : "0");
    group.totalCogs = addDecimals(group.totalCogs, metrics.orderCost);
    group.payable = addDecimals(group.payable, metrics.payable);
    group.receivable = addDecimals(group.receivable, metrics.receivable);
    group.itemsSold += metrics.orderQuantity;
    if (metrics.isDelivered) {
      group.itemsDelivered += metrics.orderQuantity;
      group.deliveredOrders += 1;
    }
    if (metrics.isReturned) {
      group.itemsReturned += metrics.orderQuantity;
      group.returnedOrders += 1;
    }
    group.orders.push(orderItem);
  }

  const manufacturersList = [...groups.values()].map((group) => {
    const posted = postedPayableMap.get(group.id);
    if (posted) {
      group.payable = nprDecimal(posted.recognized);
      group.paidAmount = nprDecimal(posted.paid);
    }
    group.remainingPayable = maxZero(nprDecimal(subtractDecimals(group.payable, group.paidAmount)));
    group.netPayable = maxZero(nprDecimal(subtractDecimals(group.remainingPayable, group.receivable)));
    group.netReceivable = maxZero(nprDecimal(subtractDecimals(group.receivable, group.remainingPayable)));
    totals.payable = addDecimals(totals.payable, group.payable);
    totals.paid = addDecimals(totals.paid, group.paidAmount);
    return {
      ...group,
      totalSales: amountString(group.totalSales),
      totalCogs: amountString(group.totalCogs),
      payable: amountString(group.payable),
      paidAmount: amountString(group.paidAmount),
      remainingPayable: amountString(group.remainingPayable),
      receivable: amountString(group.receivable),
      netPayable: amountString(group.netPayable),
      netReceivable: amountString(group.netReceivable),
    };
  });

  const remainingSummaryPayable = maxZero(nprDecimal(subtractDecimals(totals.payable, totals.paid)));
  const netPayable = maxZero(nprDecimal(subtractDecimals(remainingSummaryPayable, totals.receivable)));
  const netReceivable = maxZero(nprDecimal(subtractDecimals(totals.receivable, remainingSummaryPayable)));
  const summary = {
    totalOrders: orderBreakdown.length,
    totalSales: amountString(totals.sales),
    totalCogs: amountString(totals.cogs),
    payable: amountString(totals.payable),
    paidAmount: amountString(totals.paid),
    remainingPayable: amountString(remainingSummaryPayable),
    receivable: amountString(totals.receivable),
    netPayable: amountString(netPayable),
    netReceivable: amountString(netReceivable),
    itemsSold,
    itemsDelivered,
    itemsReturned,
    deliveredOrders,
    returnedOrders,
  };

  return {
    manufacturer: { id: "ALL", name: "All Manufacturers" },
    summary,
    manufacturers: manufacturersList,
    orders: orderBreakdown,
  };
};

export const serializeManufacturerSummaryTransactions = (transactions = []) =>
  transactions.map((transaction) => ({
    id: transaction.id,
    date: transaction.date || transaction.createdAt,
    amount: sourceAmountString(transaction.amount, "Manufacturer transaction amount"),
    type: transaction.type,
    category: transaction.category,
    partyName: transaction.partyName,
    accountName: transaction.fromAccount?.accountName || transaction.toAccount?.accountName || "Treasury Account",
    accountType: transaction.fromAccount?.accountType || transaction.toAccount?.accountType || "BANK",
    description: transaction.description,
    createdAt: transaction.createdAt,
  }));
