import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
} from "./accountingDecimal.js";

const EXPENSE_PAYABLE_CATEGORY = "OPERATING_EXPENSE";
const EXPENSE_PAYABLE_REFERENCE_TYPES = new Set(["EXPENSE", "OPERATING_EXPENSE"]);
const HISTORY_AMOUNT_FIELDS = [
  "amount",
  "settlementAmount",
  "adjustmentAmount",
  "offsetAmount",
  "grossPayable",
  "grossReceivable",
];
const amountString = (value) => accountingDecimal(value ?? "0").toFixed(2);

const dateKey = (date, timeZone = "UTC") => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dueDateKey = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T00:00:00(?:\.000)?Z$)/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new TypeError("Payable due date is invalid."), { code: "INVALID_PAYABLE_DUE_DATE" });
  }
  return dateKey(date);
};

const normalizeSettlementHistory = (history) => {
  let entries = history;
  if (typeof entries === "string") {
    try {
      entries = JSON.parse(entries);
    } catch (cause) {
      throw Object.assign(new TypeError("Payable settlement history is invalid."), {
        code: "INVALID_PAYABLE_SETTLEMENT_HISTORY",
        cause,
      });
    }
  }
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const serialized = { ...entry };
    for (const field of HISTORY_AMOUNT_FIELDS) {
      if (serialized[field] !== undefined && serialized[field] !== null) {
        serialized[field] = accountingDecimal(
          typeof serialized[field] === "number" ? String(serialized[field]) : serialized[field],
          `Settlement history ${field}`,
        ).toString();
      }
    }
    return serialized;
  });
};

const isExpensePayable = (payable) =>
  String(payable.category || "").toUpperCase() === EXPENSE_PAYABLE_CATEGORY ||
  EXPENSE_PAYABLE_REFERENCE_TYPES.has(String(payable.referenceType || "").toUpperCase());

const resolveSourceConsistency = (payable, expense) => {
  if (!expense) return "SOURCE_MISSING";
  const linked = expense.payableId === payable.id || expense.id === payable.referenceId;
  if (!linked) return "SOURCE_LINK_MISMATCH";

  const sourceTotal = accountingDecimal(expense.amount ?? "0");
  const sourcePaid = accountingDecimal(expense.paidAmount ?? "0");
  const sourcePayable = accountingDecimal(expense.payableAmount ?? "0");
  const splitMatches = compareDecimals(addDecimals(sourcePaid, sourcePayable), sourceTotal) === 0;
  const payableMatches = compareDecimals(sourcePayable, payable.totalAmount) === 0;
  return splitMatches && payableMatches ? "MATCH" : "AMOUNT_MISMATCH";
};

const classifyPayableStatus = ({ payable, totalAmount, paidAmount, creditAppliedAmount, remainingBalance }) => {
  const currentStatus = String(payable.status || "").toUpperCase();
  if (
    currentStatus === "CANCELLED" ||
    compareDecimals(remainingBalance, "0") < 0 ||
    compareDecimals(totalAmount, "0") === 0
  ) {
    return currentStatus;
  }
  if (compareDecimals(remainingBalance, "0") === 0) return "SETTLED";
  if (
    compareDecimals(paidAmount, "0") > 0 ||
    compareDecimals(creditAppliedAmount, "0") > 0 ||
    compareDecimals(remainingBalance, totalAmount) < 0
  ) {
    return "PARTIALLY_PAID";
  }
  return "UNPAID";
};

export const isExpenseLinkedPayable = isExpensePayable;

export const buildExpenseLinkedPayableReport = ({
  payables = [],
  expenses = [],
  asOfDate = new Date(),
} = {}) => {
  const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
  if (!Number.isFinite(asOf.getTime())) {
    throw Object.assign(new TypeError("Payable reporting cutoff is invalid."), { code: "INVALID_PAYABLE_CUTOFF" });
  }
  const asOfKey = dateKey(asOf, "Asia/Kathmandu");
  const expenseByPayableId = new Map();
  const expenseById = new Map();
  for (const expense of expenses) {
    expenseById.set(expense.id, expense);
    if (expense.payableId) expenseByPayableId.set(expense.payableId, expense);
  }

  let totalAmount = accountingDecimal("0");
  let paidAmount = accountingDecimal("0");
  let creditAppliedAmount = accountingDecimal("0");
  let outstandingAmount = accountingDecimal("0");
  let overdueAmount = accountingDecimal("0");
  let outstandingCount = 0;
  let overdueCount = 0;
  let sourceExceptionCount = 0;

  const rows = payables.filter(isExpensePayable).map((payable) => {
    const total = accountingDecimal(payable.totalAmount ?? "0");
    const paid = accountingDecimal(payable.paidAmount ?? "0");
    const creditApplied = accountingDecimal(payable.creditAppliedAmount ?? "0");
    const remaining = accountingDecimal(payable.remainingBalance ?? "0");
    const status = classifyPayableStatus({
      payable,
      totalAmount: total,
      paidAmount: paid,
      creditAppliedAmount: creditApplied,
      remainingBalance: remaining,
    });
    const expense = expenseByPayableId.get(payable.id)
      || (payable.referenceId ? expenseById.get(payable.referenceId) : null);
    const sourceConsistencyStatus = resolveSourceConsistency(payable, expense);
    const dueKey = dueDateKey(payable.dueDate);
    const isOverdue = status !== "SETTLED" &&
      status !== "CANCELLED" &&
    compareDecimals(remaining, "0") > 0 &&
      dueKey !== null &&
      dueKey < asOfKey;

    totalAmount = addDecimals(totalAmount, total);
    paidAmount = addDecimals(paidAmount, paid);
    creditAppliedAmount = addDecimals(creditAppliedAmount, creditApplied);
    if (status !== "CANCELLED" && compareDecimals(remaining, "0") > 0) {
      outstandingCount += 1;
      outstandingAmount = addDecimals(outstandingAmount, remaining);
      if (isOverdue) {
        overdueCount += 1;
        overdueAmount = addDecimals(overdueAmount, remaining);
      }
    }
    if (sourceConsistencyStatus !== "MATCH") sourceExceptionCount += 1;

    return {
      ...payable,
      totalAmount: amountString(total),
      paidAmount: amountString(paid),
      creditAppliedAmount: amountString(creditApplied),
      remainingBalance: amountString(remaining),
      settlementHistory: normalizeSettlementHistory(payable.settlementHistory),
      status,
      isExpenseLinked: true,
      isOverdue,
      sourceConsistencyStatus,
    };
  });

  return {
    payables: rows,
    summary: {
      totalAmount: amountString(totalAmount),
      paidAmount: amountString(paidAmount),
      creditAppliedAmount: amountString(creditAppliedAmount),
      outstandingAmount: amountString(outstandingAmount),
      overdueAmount: amountString(overdueAmount),
      outstandingCount,
      overdueCount,
      sourceExceptionCount,
    },
  };
};
