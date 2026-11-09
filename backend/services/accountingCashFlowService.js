const CASH_EQUIVALENT_ACCOUNT_CODES = new Set(["1110", "1120", "1180"]);
const CUSTOMER_RECEIPT_CODES = new Set(["1130", "4100", "4200"]);
const SUPPLIER_PAYABLE_CODES = new Set(["2110", "2160"]);

const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const getCashFlowCategory = (account) => {
  const code = String(account?.accountCode || "");
  if (code.startsWith("15")) return "investing";
  if (account?.accountType === "EQUITY" || code.startsWith("25") || code === "2150") {
    return "financing";
  }
  return "operating";
};

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
    operating: { inflows: 0, outflows: 0 },
    investing: { inflows: 0, outflows: 0 },
    financing: { inflows: 0, outflows: 0 },
  };
  const details = {
    cashReceivedFromCustomers: 0,
    otherOperatingInflows: 0,
    supplierPayments: 0,
    otherOperatingOutflows: 0,
    investingInflows: 0,
    investingOutflows: 0,
    financingInflows: 0,
    financingOutflows: 0,
  };
  let beginningCash = 0;
  let endingCash = 0;

  journals.forEach(({ date, lines }) => {
    if (Number.isNaN(date.getTime()) || date > end) return;

    const cashLines = lines.filter((line) => CASH_EQUIVALENT_ACCOUNT_CODES.has(String(line.account?.accountCode || "")));
    if (!cashLines.length) return;
    const cashMovement = cashLines.reduce(
      (sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0),
      0,
    );
    if (Math.abs(cashMovement) < 0.005) return;

    if (date < start) {
      beginningCash += cashMovement;
      endingCash += cashMovement;
      return;
    }

    endingCash += cashMovement;
    const isInflow = cashMovement > 0;
    const movementAmount = Math.abs(cashMovement);
    const counterpartLines = lines.filter(
      (line) => !CASH_EQUIVALENT_ACCOUNT_CODES.has(String(line.account?.accountCode || "")),
    );
    const counterpartTotal = counterpartLines.reduce(
      (sum, line) => sum + Number(isInflow ? line.credit || 0 : line.debit || 0),
      0,
    );

    if (counterpartTotal <= 0) {
      totals.operating[isInflow ? "inflows" : "outflows"] += movementAmount;
      details[isInflow ? "otherOperatingInflows" : "otherOperatingOutflows"] += movementAmount;
      return;
    }

    counterpartLines.forEach((line) => {
      const counterpartAmount = Number(isInflow ? line.credit || 0 : line.debit || 0);
      if (counterpartAmount <= 0) return;
      const allocatedAmount = movementAmount * counterpartAmount / counterpartTotal;
      const category = getCashFlowCategory(line.account);
      totals[category][isInflow ? "inflows" : "outflows"] += allocatedAmount;

      if (category === "investing") {
        details[isInflow ? "investingInflows" : "investingOutflows"] += allocatedAmount;
      } else if (category === "financing") {
        details[isInflow ? "financingInflows" : "financingOutflows"] += allocatedAmount;
      } else if (isInflow && CUSTOMER_RECEIPT_CODES.has(String(line.account?.accountCode || ""))) {
        details.cashReceivedFromCustomers += allocatedAmount;
      } else if (!isInflow && SUPPLIER_PAYABLE_CODES.has(String(line.account?.accountCode || ""))) {
        details.supplierPayments += allocatedAmount;
      } else {
        details[isInflow ? "otherOperatingInflows" : "otherOperatingOutflows"] += allocatedAmount;
      }
    });
  });

  Object.keys(totals).forEach((category) => {
    totals[category].inflows = roundCurrency(totals[category].inflows);
    totals[category].outflows = roundCurrency(totals[category].outflows);
    totals[category].net = roundCurrency(totals[category].inflows - totals[category].outflows);
  });
  Object.keys(details).forEach((key) => {
    details[key] = roundCurrency(details[key]);
  });

  const netCashFlow = roundCurrency(
    totals.operating.net + totals.investing.net + totals.financing.net,
  );
  beginningCash = roundCurrency(beginningCash);
  endingCash = roundCurrency(endingCash);
  const reconciliationDifference = roundCurrency(endingCash - beginningCash - netCashFlow);

  return {
    operatingActivities: totals.operating.net,
    investingActivities: totals.investing.net,
    financingActivities: totals.financing.net,
    netCashFlow,
    beginningCash,
    endingCash,
    reconciliationDifference,
    isReconciled: Math.abs(reconciliationDifference) <= 0.05,
    details: {
      ...details,
      operatingInflows: totals.operating.inflows,
      operatingOutflows: totals.operating.outflows,
      investingInflows: totals.investing.inflows,
      investingOutflows: totals.investing.outflows,
      financingInflows: totals.financing.inflows,
      financingOutflows: totals.financing.outflows,
    },
    basis: "POSTED_GL_CASH_EQUIVALENTS",
    cashEquivalentAccountCodes: [...CASH_EQUIVALENT_ACCOUNT_CODES],
  };
};
