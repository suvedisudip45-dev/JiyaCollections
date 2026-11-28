import {
  accountingDecimal,
  addDecimals,
  allocateDecimal,
  CURRENCY_PRECISION,
  quantizeNprAmount,
  subtractDecimals,
} from "./accountingDecimal.js";

const CASH_EQUIVALENT_ACCOUNT_CODES = new Set(["1110", "1120", "1180"]);
const CUSTOMER_RECEIPT_CODES = new Set(["1130", "4100", "4200"]);
const SUPPLIER_PAYABLE_CODES = new Set(["2110", "2160"]);

const getCashFlowCategory = (account) => {
  const code = String(account?.accountCode || "");
  if (code.startsWith("15")) return "investing";
  if (account?.accountType === "EQUITY" || code.startsWith("25") || code === "2150") {
    return "financing";
  }
  return "operating";
};

const amountString = (value) => quantizeNprAmount(value).toFixed(2);
const zeroAmount = () => accountingDecimal("0");

export const buildDirectCashFlowStatement = ({
  journalLines = [],
  startDate,
  endDate,
} = {}) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("Valid cash-flow statement date boundaries are required.");
  }

  const journals = new Map();
  journalLines.forEach((line, index) => {
    const journalId = line.journalEntryId || line.journalEntry?.id || line.id || `line-${index}`;
    const journal = journals.get(journalId) || {
      date: new Date(line.journalEntry?.transactionDate),
      lines: [],
    };
    journal.lines.push(line);
    journals.set(journalId, journal);
  });

  const totals = {
    operating: { inflows: zeroAmount(), outflows: zeroAmount() },
    investing: { inflows: zeroAmount(), outflows: zeroAmount() },
    financing: { inflows: zeroAmount(), outflows: zeroAmount() },
  };
  const detailKeys = [
    "cashReceivedFromCustomers",
    "otherOperatingInflows",
    "supplierPayments",
    "otherOperatingOutflows",
    "investingInflows",
    "investingOutflows",
    "financingInflows",
    "financingOutflows",
  ];
  const details = Object.fromEntries(detailKeys.map((key) => [key, zeroAmount()]));
  let beginningCash = zeroAmount();
  let endingCash = zeroAmount();

  journals.forEach(({ date, lines }) => {
    if (Number.isNaN(date.getTime()) || date > end) return;

    const cashLines = lines.filter((line) => CASH_EQUIVALENT_ACCOUNT_CODES.has(String(line.account?.accountCode || "")));
    if (!cashLines.length) return;
    const cashMovement = cashLines.reduce(
      (sum, line) => addDecimals(
        sum,
        subtractDecimals(line.debit ?? "0", line.credit ?? "0"),
      ),
      zeroAmount(),
    );
    if (cashMovement.isZero()) return;

    if (date < start) {
      beginningCash = addDecimals(beginningCash, cashMovement);
      endingCash = addDecimals(endingCash, cashMovement);
      return;
    }

    endingCash = addDecimals(endingCash, cashMovement);
    const isInflow = cashMovement.isPositive();
    const flowType = isInflow ? "inflows" : "outflows";
    const movementAmount = cashMovement.abs();
    const counterpartLines = lines.filter(
      (line) => !CASH_EQUIVALENT_ACCOUNT_CODES.has(String(line.account?.accountCode || "")),
    );
    const counterpartAllocations = counterpartLines
      .map((line, index) => ({
        line,
        index,
        weight: accountingDecimal(isInflow ? line.credit ?? "0" : line.debit ?? "0"),
      }))
      .filter(({ weight }) => weight.greaterThan(0))
      .sort((left, right) => {
        const leftAccountCode = String(left.line.account?.accountCode || "");
        const rightAccountCode = String(right.line.account?.accountCode || "");
        const accountCodeOrder = leftAccountCode < rightAccountCode
          ? -1
          : leftAccountCode > rightAccountCode
            ? 1
            : 0;
        if (accountCodeOrder !== 0) return accountCodeOrder;
        const leftId = String(left.line.id || left.index);
        const rightId = String(right.line.id || right.index);
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      });
    const counterpartTotal = addDecimals(...counterpartAllocations.map(({ weight }) => weight));

    if (counterpartTotal.isZero()) {
      totals.operating[flowType] = addDecimals(totals.operating[flowType], movementAmount);
      const detailKey = isInflow ? "otherOperatingInflows" : "otherOperatingOutflows";
      details[detailKey] = addDecimals(details[detailKey], movementAmount);
      return;
    }

    const { allocations } = allocateDecimal(
      movementAmount,
      counterpartAllocations.map(({ weight }) => weight),
      {
        scale: 2,
        roundingMode: CURRENCY_PRECISION.NPR.roundingMode,
        residualTargetIndex: counterpartAllocations.length - 1,
        divisionSignificantDigits: 80,
      },
    );
    counterpartAllocations.forEach(({ line }, index) => {
      const allocatedAmount = allocations[index];
      const category = getCashFlowCategory(line.account);
      totals[category][flowType] = addDecimals(totals[category][flowType], allocatedAmount);

      if (category === "investing") {
        const detailKey = isInflow ? "investingInflows" : "investingOutflows";
        details[detailKey] = addDecimals(details[detailKey], allocatedAmount);
      } else if (category === "financing") {
        const detailKey = isInflow ? "financingInflows" : "financingOutflows";
        details[detailKey] = addDecimals(details[detailKey], allocatedAmount);
      } else if (isInflow && CUSTOMER_RECEIPT_CODES.has(String(line.account?.accountCode || ""))) {
        details.cashReceivedFromCustomers = addDecimals(details.cashReceivedFromCustomers, allocatedAmount);
      } else if (!isInflow && SUPPLIER_PAYABLE_CODES.has(String(line.account?.accountCode || ""))) {
        details.supplierPayments = addDecimals(details.supplierPayments, allocatedAmount);
      } else {
        const detailKey = isInflow ? "otherOperatingInflows" : "otherOperatingOutflows";
        details[detailKey] = addDecimals(details[detailKey], allocatedAmount);
      }
    });
  });

  Object.keys(totals).forEach((category) => {
    totals[category].inflows = quantizeNprAmount(totals[category].inflows);
    totals[category].outflows = quantizeNprAmount(totals[category].outflows);
    totals[category].net = subtractDecimals(totals[category].inflows, totals[category].outflows);
  });
  detailKeys.forEach((key) => {
    details[key] = quantizeNprAmount(details[key]);
  });

  const netCashFlow = addDecimals(
    totals.operating.net,
    totals.investing.net,
    totals.financing.net,
  );
  beginningCash = quantizeNprAmount(beginningCash);
  endingCash = quantizeNprAmount(endingCash);
  const reconciliationDifference = subtractDecimals(
    subtractDecimals(endingCash, beginningCash),
    netCashFlow,
  );

  return {
    operatingActivities: amountString(totals.operating.net),
    investingActivities: amountString(totals.investing.net),
    financingActivities: amountString(totals.financing.net),
    netCashFlow: amountString(netCashFlow),
    beginningCash: amountString(beginningCash),
    endingCash: amountString(endingCash),
    reconciliationDifference: amountString(reconciliationDifference),
    isReconciled: reconciliationDifference.abs().lessThanOrEqualTo("0.05"),
    details: {
      ...Object.fromEntries(detailKeys.map((key) => [key, amountString(details[key])])),
      operatingInflows: amountString(totals.operating.inflows),
      operatingOutflows: amountString(totals.operating.outflows),
      investingInflows: amountString(totals.investing.inflows),
      investingOutflows: amountString(totals.investing.outflows),
      financingInflows: amountString(totals.financing.inflows),
      financingOutflows: amountString(totals.financing.outflows),
    },
    basis: "POSTED_GL_CASH_EQUIVALENTS",
    cashEquivalentAccountCodes: [...CASH_EQUIVALENT_ACCOUNT_CODES],
  };
};
