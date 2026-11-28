import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  multiplyDecimals,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";

const payableAmountFields = ["totalAmount", "paidAmount", "creditAppliedAmount", "remainingBalance"];
const receivableAmountFields = ["totalAmount", "receivedAmount", "remainingBalance"];
const partyPayableTypes = new Set(["MANUFACTURER_COGS", "DISTRIBUTOR_SETTLEMENT"]);
const manufacturerReceivableTypes = new Set(["MANUFACTURER_DIRECT"]);
const amountString = (value) => accountingDecimal(value).toFixed(2);
const asStoredDecimal = (value, fieldName) => {
  if (value === null || value === undefined) return accountingDecimal("0");
  return accountingDecimal(typeof value === "number" ? String(value) : value, fieldName);
};
const maxZero = (value) => compareDecimals(value, "0") > 0 ? accountingDecimal(value) : accountingDecimal("0");
const minDecimal = (left, right) => compareDecimals(left, right) <= 0
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

const dateKey = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const isValidDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const dueDateValue = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    const dateOnly = value.slice(0, 10);
    if (isValidDateOnly(dateOnly) && (value === dateOnly || /^T00:00:00(?:\.000)?Z$/.test(value.slice(10)))) {
      return { dateOnly };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new TypeError("Payable or receivable due date is invalid."), {
      code: "INVALID_PARTY_DUE_DATE",
    });
  }
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    const key = date.toISOString().slice(0, 10);
    if (isValidDateOnly(key)) return { dateOnly: key };
  }
  return { instant: date };
};

const isPastDue = ({ dueDate, remainingBalance, status, asOfDate }) => {
  if (
    !dueDate ||
    status === "SETTLED" ||
    status === "CANCELLED" ||
    compareDecimals(remainingBalance, "0") <= 0
  ) {
    return false;
  }
  const parsedDueDate = dueDateValue(dueDate);
  if (!parsedDueDate) return false;
  if (parsedDueDate.dateOnly) {
    return parsedDueDate.dateOnly < dateKey(asOfDate, "Asia/Kathmandu");
  }
  return parsedDueDate.instant.getTime() < asOfDate.getTime();
};

const classifyPayableStatus = (row, total, paid, creditApplied, remaining) => {
  const currentStatus = String(row.status || "UNPAID").toUpperCase();
  if (currentStatus === "CANCELLED" || compareDecimals(total, "0") <= 0 || compareDecimals(remaining, "0") < 0) {
    return currentStatus;
  }
  if (compareDecimals(remaining, "0") === 0) return "SETTLED";
  if (
    compareDecimals(paid, "0") > 0 ||
    compareDecimals(creditApplied, "0") > 0 ||
    compareDecimals(remaining, total) < 0
  ) {
    return "PARTIALLY_PAID";
  }
  return "UNPAID";
};

const classifyReceivableStatus = (row, total, received, remaining) => {
  const currentStatus = String(row.status || "UNPAID").toUpperCase();
  if (currentStatus === "CANCELLED" || compareDecimals(total, "0") <= 0 || compareDecimals(remaining, "0") < 0) {
    return currentStatus;
  }
  if (compareDecimals(remaining, "0") === 0) return "SETTLED";
  if (compareDecimals(received, "0") > 0 || compareDecimals(remaining, total) < 0) {
    return "PARTIALLY_RECEIVED";
  }
  return "UNPAID";
};

const normalizePartyPayable = (row, asOfDate) => {
  if (!partyPayableTypes.has(String(row.referenceType || "").toUpperCase())) return row;
  const values = Object.fromEntries(payableAmountFields.map((field) => [
    field,
    asStoredDecimal(row[field], `Payable ${field}`),
  ]));
  const status = classifyPayableStatus(
    row,
    values.totalAmount,
    values.paidAmount,
    values.creditAppliedAmount,
    values.remainingBalance,
  );
  return {
    ...row,
    ...Object.fromEntries(payableAmountFields.map((field) => [field, amountString(values[field])])),
    status,
    isPartyBalance: true,
    isOverdue: isPastDue({
      dueDate: row.dueDate,
      remainingBalance: values.remainingBalance,
      status,
      asOfDate,
    }),
  };
};

const normalizeManufacturerReceivable = (row, asOfDate) => {
  if (!manufacturerReceivableTypes.has(String(row.referenceType || "").toUpperCase())) return row;
  const values = Object.fromEntries(receivableAmountFields.map((field) => [
    field,
    asStoredDecimal(row[field], `Receivable ${field}`),
  ]));
  const status = classifyReceivableStatus(row, values.totalAmount, values.receivedAmount, values.remainingBalance);
  return {
    ...row,
    ...Object.fromEntries(receivableAmountFields.map((field) => [field, amountString(values[field])])),
    status,
    isPartyBalance: true,
    isOverdue: isPastDue({
      dueDate: row.dueDate,
      remainingBalance: values.remainingBalance,
      status,
      asOfDate,
    }),
  };
};

const getManufacturerOrderCosts = ({ manufacturers, orders, products, manufacturerInventories }) => {
  const productCosts = new Map(products.map((product) => [
    product.id,
    asStoredDecimal(product.costPrice, "Product cost price"),
  ]));
  const agreedCosts = new Map();
  for (const inventory of manufacturerInventories) {
    const price = inventory.agreedCostPrice !== null && inventory.agreedCostPrice !== undefined
      ? inventory.agreedCostPrice
      : inventory.proposedCostPrice;
    if (price !== null && price !== undefined) {
      agreedCosts.set(`${inventory.manufacturerId}_${inventory.productId}`, asStoredDecimal(price, "Manufacturer agreed cost"));
    }
  }

  const cogsByManufacturer = new Map(manufacturers.map(({ id }) => [id, accountingDecimal("0")]));
  const directReceivableByManufacturer = new Map(manufacturers.map(({ id }) => [id, accountingDecimal("0")]));
  for (const order of orders) {
    const items = parseOrderItems(order.items);
    const orderManufacturerId = order.manufacturerId ||
      items[0]?.manufacturerId ||
      order.deliveryOrder?.manufacturerId;
    if (!orderManufacturerId) continue;

    let orderCost = accountingDecimal("0");
    for (const item of items) {
      const quantity = asStoredDecimal(item.quantity || 1, "Order quantity");
      const productId = item.productId || item._id || item.id;
      const itemManufacturerId = item.manufacturerId || orderManufacturerId;
      const customCost = agreedCosts.get(`${itemManufacturerId}_${productId}`);
      const fallbackCost = productCosts.get(productId) || accountingDecimal("0");
      const unitCost = customCost && compareDecimals(customCost, "0") > 0 ? customCost : fallbackCost;
      orderCost = addDecimals(orderCost, multiplyDecimals(quantity, unitCost));
    }
    orderCost = quantizeNprAmount(orderCost.toString());

    const currentCogs = cogsByManufacturer.get(orderManufacturerId);
    if (currentCogs !== undefined) {
      cogsByManufacturer.set(orderManufacturerId, addDecimals(currentCogs, orderCost));
    }

    const isDirect = order.orderType === "DIRECT_MANUFACTURER" &&
      ["PHONE_ORDER", "HUB_VISIT"].includes(order.directOrderType);
    if (isDirect && directReceivableByManufacturer.has(orderManufacturerId)) {
      const sales = asStoredDecimal(order.amount, "Direct manufacturer order amount");
      const margin = quantizeNprAmount(subtractDecimals(sales, orderCost).toString());
      directReceivableByManufacturer.set(
        orderManufacturerId,
        addDecimals(directReceivableByManufacturer.get(orderManufacturerId), maxZero(margin)),
      );
    }
  }
  return { cogsByManufacturer, directReceivableByManufacturer };
};

export const calculateManufacturerDirectReceivableTotal = ({
  manufacturerId,
  orders = [],
  products = [],
  manufacturerInventories = [],
}) => {
  const { directReceivableByManufacturer } = getManufacturerOrderCosts({
    manufacturers: [{ id: manufacturerId }],
    orders,
    products,
    manufacturerInventories,
  });
  return directReceivableByManufacturer.get(manufacturerId);
};

const getManufacturerPaidAmounts = ({ manufacturers, supplierCashOutflows, payables }) => {
  const paidByManufacturer = new Map();
  for (const transaction of supplierCashOutflows) {
    const amount = asStoredDecimal(transaction.amount, "Supplier payment amount");
    if (transaction.referenceId) {
      paidByManufacturer.set(
        transaction.referenceId,
        addDecimals(paidByManufacturer.get(transaction.referenceId) || "0", amount),
      );
    }
    for (const manufacturer of manufacturers) {
      const nameMatches =
        transaction.partyName?.toLowerCase() === manufacturer.name?.toLowerCase() ||
        transaction.description?.toLowerCase().includes(manufacturer.name?.toLowerCase());
      if (transaction.referenceId === manufacturer.id || nameMatches) {
        const increment = transaction.referenceId === manufacturer.id ? "0" : amount;
        paidByManufacturer.set(
          manufacturer.id,
          addDecimals(paidByManufacturer.get(manufacturer.id) || "0", increment),
        );
      }
    }
  }
  for (const payable of payables) {
    if (payable.referenceType !== "MANUFACTURER_COGS" || !payable.referenceId) continue;
    const payablePaid = asStoredDecimal(payable.paidAmount, "Manufacturer payable paid amount");
    const existingPaid = paidByManufacturer.get(payable.referenceId) || accountingDecimal("0");
    if (compareDecimals(payablePaid, existingPaid) > 0) {
      paidByManufacturer.set(payable.referenceId, payablePaid);
    }
  }
  return paidByManufacturer;
};

const synthesizeManufacturerPayables = ({ payables, manufacturers, cogsByManufacturer, paidByManufacturer, asOfDate }) => {
  for (const manufacturer of manufacturers) {
    const total = cogsByManufacturer.get(manufacturer.id) || accountingDecimal("0");
    const paid = quantizeNprAmount(
      (paidByManufacturer.get(manufacturer.id) || accountingDecimal("0")).toString(),
    );
    const remaining = maxZero(quantizeNprAmount(subtractDecimals(total, paid).toString()));
    const existingIndex = payables.findIndex(
      (row) => row.referenceType === "MANUFACTURER_COGS" && row.referenceId === manufacturer.id,
    );
    const prior = existingIndex >= 0 ? payables[existingIndex] : null;
    const status = compareDecimals(remaining, "0") === 0 && compareDecimals(total, "0") > 0
      ? "SETTLED"
      : compareDecimals(paid, "0") > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";
    const row = {
      ...(prior || {}),
      id: prior?.id || `AP-MFG-${manufacturer.id}`,
      title: `Manufacturer Payable - ${manufacturer.name}`,
      payeeName: prior?.payeeName || manufacturer.name,
      category: prior?.category || "SUPPLIER_INVOICE",
      referenceType: "MANUFACTURER_COGS",
      referenceId: manufacturer.id,
      totalAmount: amountString(total),
      paidAmount: amountString(paid),
      creditAppliedAmount: amountString(prior?.creditAppliedAmount ?? "0"),
      remainingBalance: amountString(remaining),
      dueDate: prior?.dueDate || null,
      invoiceNumber: prior?.invoiceNumber || `COGS-${manufacturer.id.slice(0, 6).toUpperCase()}`,
      status,
      priority: prior?.priority || "HIGH",
      notes: "Manufacturer orders are payable at approved COGS.",
      settlementHistory: prior?.settlementHistory || [],
      createdAt: prior?.createdAt || new Date(),
      updatedAt: prior?.updatedAt || new Date(),
      isPartyBalance: true,
      isOverdue: isPastDue({ dueDate: prior?.dueDate, remainingBalance: remaining, status, asOfDate }),
    };
    if (existingIndex >= 0) payables[existingIndex] = row;
    else if (compareDecimals(total, "0") > 0 || compareDecimals(paid, "0") > 0) payables.push(row);
  }
};

const synthesizeDistributorSettlementPayables = ({
  payables,
  requests,
  earningDocuments,
  asOfDate,
}) => {
  const balancesByDocument = new Map(earningDocuments.map((document) => [
    document.id,
    {
      remainingAmount: asStoredDecimal(document.remainingAmount, "Distributor earning document balance"),
      distributorId: document.party?.sourceEntityId,
    },
  ]));
  for (const request of requests) {
    if (request.metadata?.settlementBasis !== "ACCOUNTING_SUBLEDGER") continue;
    if (payables.some((row) =>
      row.referenceType === "DISTRIBUTOR_SETTLEMENT" && row.referenceId === request.id
    )) continue;

    const amount = asStoredDecimal(request.amount, "Distributor settlement request amount");
    const paid = asStoredDecimal(request.paidAmount, "Distributor settlement request paid amount");
    const requestRemaining = maxZero(subtractDecimals(amount, paid));
    const earningDocumentIds = Array.isArray(request.metadata?.earningDocumentIds)
      ? request.metadata.earningDocumentIds
      : [];
    let availableDocuments = accountingDecimal("0");
    for (const documentId of earningDocumentIds) {
      const document = balancesByDocument.get(documentId);
      if (document?.distributorId === request.distributorId) {
        availableDocuments = addDecimals(availableDocuments, document.remainingAmount);
      }
    }
    const remaining = minDecimal(requestRemaining, availableDocuments);
    if (compareDecimals(remaining, "0") <= 0) continue;

    const status = compareDecimals(paid, "0") > 0 ? "PARTIALLY_PAID" : "UNPAID";
    payables.push({
      id: request.id,
      title: `Distributor Settlement - ${request.distributor?.name || request.distributorId}`,
      payeeName: request.distributor?.name || `Distributor ${request.distributorId}`,
      category: "DISTRIBUTOR_SETTLEMENT",
      referenceType: "DISTRIBUTOR_SETTLEMENT",
      referenceId: request.id,
      totalAmount: amountString(amount),
      paidAmount: amountString(paid),
      creditAppliedAmount: "0.00",
      remainingBalance: amountString(remaining),
      dueDate: null,
      invoiceNumber: `DIST-SET-${request.id.slice(0, 8).toUpperCase()}`,
      status,
      priority: "HIGH",
      notes: `Distributor requested settlement ${request.metadata?.statementSnapshot?.vatMode === "WITHOUT_VAT" ? "without VAT" : "with VAT"}.`,
      settlementHistory: [],
      createdAt: request.requestedAt,
      updatedAt: request.updatedAt,
      isPartyBalance: true,
      isOverdue: isPastDue({ dueDate: null, remainingBalance: remaining, status, asOfDate }),
      settlementVatMode: request.metadata?.statementSnapshot?.vatMode || "WITH_VAT",
    });
  }
};

const synthesizeManufacturerReceivables = ({ receivables, manufacturers, directReceivableByManufacturer, asOfDate }) => {
  for (const manufacturer of manufacturers) {
    const total = directReceivableByManufacturer.get(manufacturer.id) || accountingDecimal("0");
    const existingIndex = receivables.findIndex(
      (row) => row.referenceType === "MANUFACTURER_DIRECT" && row.referenceId === manufacturer.id,
    );
    const prior = existingIndex >= 0 ? receivables[existingIndex] : null;
    const received = asStoredDecimal(prior?.receivedAmount, "Manufacturer receivable received amount");
    const remaining = maxZero(subtractDecimals(total, received));
    const status = compareDecimals(remaining, "0") === 0 && compareDecimals(total, "0") > 0
      ? "SETTLED"
      : compareDecimals(received, "0") > 0
        ? "PARTIALLY_RECEIVED"
        : "UNPAID";
    const row = {
      ...(prior || {}),
      id: prior?.id || `AR-MFG-DIRECT-${manufacturer.id}`,
      title: `Direct Sales Margin - ${manufacturer.name}`,
      payerName: prior?.payerName || manufacturer.name,
      category: prior?.category || "CUSTOMER_RECEIVABLE",
      referenceType: "MANUFACTURER_DIRECT",
      referenceId: manufacturer.id,
      totalAmount: amountString(total),
      receivedAmount: amountString(received),
      remainingBalance: amountString(remaining),
      dueDate: prior?.dueDate || null,
      invoiceNumber: prior?.invoiceNumber || `DIR-${manufacturer.id.slice(0, 6).toUpperCase()}`,
      status,
      notes: "Direct manufacturer sales less approved COGS, payable to the platform.",
      collectionHistory: prior?.collectionHistory || [],
      createdAt: prior?.createdAt || new Date(),
      updatedAt: prior?.updatedAt || new Date(),
      isPartyBalance: true,
      isOverdue: isPastDue({ dueDate: prior?.dueDate, remainingBalance: remaining, status, asOfDate }),
    };
    if (existingIndex >= 0) receivables[existingIndex] = row;
    else if (compareDecimals(total, "0") > 0) receivables.push(row);
  }
};

export const buildNonExpensePartyReport = ({
  payables = [],
  receivables = [],
  manufacturers = [],
  orders = [],
  products = [],
  manufacturerInventories = [],
  supplierCashOutflows = [],
  distributorSettlementRequests = [],
  distributorEarningDocuments = [],
  asOfDate = new Date(),
} = {}) => {
  const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
  if (!Number.isFinite(asOf.getTime())) {
    throw Object.assign(new TypeError("Party reporting cutoff is invalid."), { code: "INVALID_PARTY_CUTOFF" });
  }

  const reportedPayables = payables.map((row) => normalizePartyPayable(row, asOf));
  const reportedReceivables = receivables.map((row) => normalizeManufacturerReceivable(row, asOf));
  const { cogsByManufacturer, directReceivableByManufacturer } = getManufacturerOrderCosts({
    manufacturers,
    orders,
    products,
    manufacturerInventories,
  });
  const paidByManufacturer = getManufacturerPaidAmounts({
    manufacturers,
    supplierCashOutflows,
    payables: reportedPayables,
  });

  synthesizeDistributorSettlementPayables({
    payables: reportedPayables,
    requests: distributorSettlementRequests,
    earningDocuments: distributorEarningDocuments,
    asOfDate: asOf,
  });
  synthesizeManufacturerPayables({
    payables: reportedPayables,
    manufacturers,
    cogsByManufacturer,
    paidByManufacturer,
    asOfDate: asOf,
  });
  synthesizeManufacturerReceivables({
    receivables: reportedReceivables,
    manufacturers,
    directReceivableByManufacturer,
    asOfDate: asOf,
  });

  return { payables: reportedPayables, receivables: reportedReceivables };
};

export const summarizePayablesAndReceivables = ({ payables = [], receivables = [], accounts = [] } = {}) => {
  const totalPayablesOutstanding = payables
    .filter((row) => row.status !== "SETTLED" && row.status !== "CANCELLED")
    .reduce(
      (total, row) => addDecimals(total, String(row.remainingBalance || "0")),
      accountingDecimal("0"),
    );
  const totalPayablesSettled = payables.reduce(
    (total, row) => addDecimals(total, String(row.paidAmount || "0")),
    accountingDecimal("0"),
  );
  const totalReceivablesOutstanding = receivables
    .filter((row) => row.status !== "SETTLED" && row.status !== "CANCELLED")
    .reduce(
      (total, row) => addDecimals(total, String(row.remainingBalance || "0")),
      accountingDecimal("0"),
    );
  const totalReceivablesCollected = receivables.reduce(
    (total, row) => addDecimals(total, String(row.receivedAmount || "0")),
    accountingDecimal("0"),
  );
  const totalLiquidCash = accounts.reduce(
    (total, account) => addDecimals(total, String(account.currentBalance || "0")),
    accountingDecimal("0"),
  );

  return {
    totalPayablesOutstanding: amountString(totalPayablesOutstanding),
    totalPayablesSettled: amountString(totalPayablesSettled),
    totalReceivablesOutstanding: amountString(totalReceivablesOutstanding),
    totalReceivablesCollected: amountString(totalReceivablesCollected),
    totalLiquidCash: amountString(totalLiquidCash),
    netPayablePressure: amountString(subtractDecimals(totalPayablesOutstanding, totalLiquidCash)),
    canCoverAllPayablesNow: compareDecimals(totalLiquidCash, totalPayablesOutstanding) >= 0,
  };
};
