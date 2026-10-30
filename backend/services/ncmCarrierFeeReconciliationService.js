const rounded = (amount) => Number(Number(amount || 0).toFixed(2));

export const buildNcmCarrierFeeReconciliation = ({
  accrualJournalLines = [],
  documents = [],
  settlementJournalLines = [],
} = {}) => {
  const rowsBySource = new Map();
  const getRow = (sourceId) => {
    if (!rowsBySource.has(sourceId)) {
      rowsBySource.set(sourceId, {
        sourceId,
        accrualPayable: 0,
        documentOriginal: 0,
        documentOutstanding: 0,
        allocationAmount: 0,
        settlementJournalDebit: 0,
        accrualLineCount: 0,
        documentCount: 0,
        allocationCount: 0,
        settlementJournalLineCount: 0,
        allocationJournalEntryIds: new Set(),
        settlementJournalEntryIds: new Set(),
      });
    }
    return rowsBySource.get(sourceId);
  };

  for (const line of accrualJournalLines) {
    if (line.journalEntry?.sourceType !== "NCM_CARRIER_FEE_ACCRUAL" || !line.journalEntry?.sourceId) continue;
    const row = getRow(line.journalEntry.sourceId);
    row.accrualPayable += Number(line.credit || 0) - Number(line.debit || 0);
    row.accrualLineCount += 1;
  }

  for (const document of documents) {
    if (
      document.side !== "PAYABLE" ||
      document.sourceType !== "NCM_CARRIER_FEE" ||
      !document.sourceId
    ) continue;
    const row = getRow(document.sourceId);
    row.documentOriginal += Number(document.originalAmount || 0);
    row.documentOutstanding += Number(document.remainingAmount || 0);
    row.documentCount += 1;
    for (const allocation of document.allocations || []) {
      row.allocationAmount += Number(allocation.amount || 0);
      row.allocationCount += 1;
      if (allocation.journalEntryId) row.allocationJournalEntryIds.add(allocation.journalEntryId);
    }
  }

  for (const line of settlementJournalLines) {
    const journalEntry = line.journalEntry;
    const prefix = "NCM-REMIT-";
    if (
      journalEntry?.sourceType !== "PAYMENT" ||
      !String(journalEntry.sourceId || "").startsWith(prefix)
    ) continue;
    const sourceId = String(journalEntry.sourceId).slice(prefix.length);
    const row = getRow(sourceId);
    row.settlementJournalDebit += Number(line.debit || 0) - Number(line.credit || 0);
    row.settlementJournalLineCount += 1;
    if (journalEntry.id) row.settlementJournalEntryIds.add(journalEntry.id);
  }

  const rows = [...rowsBySource.values()]
    .map((row) => {
      const accrualPayable = rounded(row.accrualPayable);
      const documentOriginal = rounded(row.documentOriginal);
      const allocationAmount = rounded(row.allocationAmount);
      const settlementJournalDebit = rounded(row.settlementJournalDebit);
      const documentOutstanding = rounded(row.documentOutstanding);
      const accrualToDocumentVariance = rounded(documentOriginal - accrualPayable);
      const allocationToSettlementVariance = rounded(settlementJournalDebit - allocationAmount);
      const allocationsLinkedToRemittance = row.allocationCount > 0
        && row.allocationJournalEntryIds.size > 0
        && [...row.allocationJournalEntryIds].every((id) => row.settlementJournalEntryIds.has(id))
        && [...row.settlementJournalEntryIds].every((id) => row.allocationJournalEntryIds.has(id));
      const isReconciled = row.accrualLineCount === 1
        && row.documentCount === 1
        && allocationsLinkedToRemittance
        && Math.abs(accrualToDocumentVariance) <= 0.05
        && Math.abs(allocationToSettlementVariance) <= 0.05
        && Math.abs(documentOutstanding - (documentOriginal - allocationAmount)) <= 0.05;

      return {
        ...row,
        accrualPayable,
        documentOriginal,
        documentOutstanding,
        allocationAmount,
        settlementJournalDebit,
        accrualToDocumentVariance,
        allocationToSettlementVariance,
        allocationsLinkedToRemittance,
        isReconciled,
        status: isReconciled ? "MATCH" : "REVIEW",
      };
    })
    .sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)));

  const sums = rows.reduce((total, row) => ({
    accrualPayable: total.accrualPayable + row.accrualPayable,
    documentOriginal: total.documentOriginal + row.documentOriginal,
    documentOutstanding: total.documentOutstanding + row.documentOutstanding,
    allocationAmount: total.allocationAmount + row.allocationAmount,
    settlementJournalDebit: total.settlementJournalDebit + row.settlementJournalDebit,
  }), {
    accrualPayable: 0,
    documentOriginal: 0,
    documentOutstanding: 0,
    allocationAmount: 0,
    settlementJournalDebit: 0,
  });
  const unmatchedCount = rows.filter((row) => !row.isReconciled).length;
  const sourceCount = rows.length;

  return {
    coverageStatus: "SOURCE_SCOPED",
    sourceCount,
    unmatchedCount,
    isReconciled: sourceCount > 0 && unmatchedCount === 0,
    accrualPayable: rounded(sums.accrualPayable),
    documentOriginal: rounded(sums.documentOriginal),
    documentOutstanding: rounded(sums.documentOutstanding),
    allocationAmount: rounded(sums.allocationAmount),
    settlementJournalDebit: rounded(sums.settlementJournalDebit),
    coverageNote: "Compares NCM carrier-fee accrual credits to payable bills, document allocations, and matching 2180 debits in NCM remittance journals. This source-scoped check does not reconcile other carrier obligations, historical balances, or the full 2180 control.",
    sources: rows,
  };
};
