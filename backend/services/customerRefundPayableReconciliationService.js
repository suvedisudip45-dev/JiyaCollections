const REFUND_PAYABLE_SOURCES = {
  CUSTOMER_REFUND: {
    journalSourceType: "SALES_RETURN",
    journalSourceId: (referenceId) => referenceId,
    label: "Customer return refund",
  },
  CUSTOMER_EXCHANGE_REFUND: {
    journalSourceType: "ORDER_EXCHANGE",
    journalSourceId: (referenceId) => `EXCHANGE-${referenceId}`,
    label: "Customer exchange downgrade refund",
  },
};

const rounded = (amount) => Number(Number(amount || 0).toFixed(2));

export const buildCustomerRefundPayableReconciliation = ({
  journalLines = [],
  payables = [],
} = {}) => {
  const rowsBySource = new Map();
  const getRow = (referenceType, referenceId) => {
    const key = `${referenceType}:${referenceId}`;
    if (!rowsBySource.has(key)) {
      rowsBySource.set(key, {
        referenceType,
        sourceId: referenceId,
        journalPayable: 0,
        payableOriginal: 0,
        payableOutstanding: 0,
        payablePaid: 0,
        journalLineCount: 0,
        payableCount: 0,
      });
    }
    return rowsBySource.get(key);
  };

  for (const [referenceType, source] of Object.entries(REFUND_PAYABLE_SOURCES)) {
    for (const line of journalLines) {
      if (line.journalEntry?.sourceType !== source.journalSourceType) continue;
      const sourceId = line.journalEntry?.sourceId;
      const referenceId = referenceType === "CUSTOMER_REFUND"
        ? sourceId
        : String(sourceId || "").startsWith("EXCHANGE-")
          ? String(sourceId).slice("EXCHANGE-".length)
          : null;
      if (!referenceId) continue;
      const netPayable = Number(line.credit || 0) - Number(line.debit || 0);
      if (netPayable === 0) continue;
      const row = getRow(referenceType, referenceId);
      row.journalPayable += netPayable;
      row.journalLineCount += 1;
    }
  }

  for (const payable of payables) {
    if (!REFUND_PAYABLE_SOURCES[payable.referenceType] || !payable.referenceId) continue;
    const row = getRow(payable.referenceType, payable.referenceId);
    row.payableOriginal += Number(payable.totalAmount || 0);
    row.payableOutstanding += Number(payable.remainingBalance || 0);
    row.payablePaid += Number(payable.paidAmount || 0);
    row.payableCount += 1;
  }

  const rows = [...rowsBySource.values()]
    .map((row) => {
      const source = REFUND_PAYABLE_SOURCES[row.referenceType];
      const journalPayable = rounded(row.journalPayable);
      const payableOriginal = rounded(row.payableOriginal);
      const variance = rounded(payableOriginal - journalPayable);
      return {
        ...row,
        label: source.label,
        journalSourceType: source.journalSourceType,
        journalSourceId: source.journalSourceId(row.sourceId),
        journalPayable,
        payableOriginal,
        payableOutstanding: rounded(row.payableOutstanding),
        payablePaid: rounded(row.payablePaid),
        variance,
        isReconciled: row.payableCount === 1 && Math.abs(variance) <= 0.05,
        status: row.payableCount === 1 && Math.abs(variance) <= 0.05 ? "MATCH" : "REVIEW",
      };
    })
    .sort((left, right) =>
      left.referenceType.localeCompare(right.referenceType) ||
      left.sourceId.localeCompare(right.sourceId)
    );

  const journalPayable = rounded(rows.reduce((sum, row) => sum + row.journalPayable, 0));
  const payableOriginal = rounded(rows.reduce((sum, row) => sum + row.payableOriginal, 0));
  const variance = rounded(payableOriginal - journalPayable);
  const unmatchedCount = rows.filter((row) => !row.isReconciled).length;
  const sourceCount = rows.length;

  return {
    coverageStatus: "SOURCE_SCOPED",
    journalPayable,
    payableOriginal,
    payableOutstanding: rounded(rows.reduce((sum, row) => sum + row.payableOutstanding, 0)),
    payablePaid: rounded(rows.reduce((sum, row) => sum + row.payablePaid, 0)),
    variance,
    sourceCount,
    unmatchedCount,
    isReconciled: sourceCount > 0 && unmatchedCount === 0,
    coverageNote: "Compares only platform-funded customer return and exchange downgrade refund AP originals with their source-linked 2110 journal credits. Paid/open AP balances are shown, but payment clearing, distributor-funded refunds, legacy AP, and other 2110 sources are not reconciled here.",
    sources: rows,
  };
};
