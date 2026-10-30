const rounded = (amount) => Number(Number(amount || 0).toFixed(2));

export const buildCollaborationFeeReceivableReconciliation = ({
  invoices = [],
  documents = [],
  journalLines = [],
  documentAllocations = [],
  allocations = [],
  collectionJournals = [],
} = {}) => {
  const rowsBySource = new Map();
  const allocationsByDocumentId = new Map();
  const allocationsByJournalId = new Map();
  const journalsById = new Map();
  const getRow = (sourceId) => {
    if (!rowsBySource.has(sourceId)) {
      rowsBySource.set(sourceId, {
        sourceId,
        invoiceNumber: null,
        invoiceStatus: null,
        invoiceTotal: 0,
        documentOriginal: 0,
        documentAllocated: 0,
        documentOutstanding: 0,
        documentBalanceVariance: 0,
        allocationAmount: 0,
        allocationVariance: 0,
        postedReceiptAllocationAmount: 0,
        documentCount: 0,
        journalReceivable: 0,
        journalLineCount: 0,
        collectionJournalVariance: 0,
        collectionJournalMismatchCount: 0,
        collectionJournalInvalidCount: 0,
      });
    }
    return rowsBySource.get(sourceId);
  };

  for (const invoice of invoices) {
    if (!invoice.id) continue;
    const row = getRow(invoice.id);
    row.invoiceNumber = invoice.invoiceNumber || null;
    row.invoiceStatus = invoice.status || null;
    row.invoiceTotal += Number(invoice.totalAmount || 0);
    row.invoiceCount = (row.invoiceCount || 0) + 1;
  }

  for (const document of documents) {
    if (document.side !== "RECEIVABLE" || document.sourceType !== "COLLABORATION_FEE" || !document.sourceId) continue;
    const row = getRow(document.sourceId);
    row.documentOriginal += Number(document.originalAmount || 0);
    row.documentAllocated += Number(document.allocatedAmount || 0);
    row.documentOutstanding += Number(document.remainingAmount || 0);
    row.documentBalanceVariance += Number(document.allocatedAmount || 0)
      + Number(document.remainingAmount || 0)
      - Number(document.originalAmount || 0);
    row.documentCount += 1;
    row.documentIds = [...(row.documentIds || []), document.id];
  }

  for (const allocation of documentAllocations) {
    if (!allocation.documentId) continue;
    const documentAllocationRows = allocationsByDocumentId.get(allocation.documentId) || [];
    documentAllocationRows.push(allocation);
    allocationsByDocumentId.set(allocation.documentId, documentAllocationRows);
  }

  for (const allocation of allocations) {
    if (allocation.journalEntryId) {
      const journalAllocations = allocationsByJournalId.get(allocation.journalEntryId) || [];
      journalAllocations.push(allocation);
      allocationsByJournalId.set(allocation.journalEntryId, journalAllocations);
    }
  }

  for (const journal of collectionJournals) {
    if (journal.id) journalsById.set(journal.id, journal);
  }

  for (const line of journalLines) {
    if (line.journalEntry?.sourceType !== "COLLABORATION_FEE_INVOICE" || !line.journalEntry?.sourceId) continue;
    const row = getRow(line.journalEntry.sourceId);
    row.journalReceivable += Number(line.debit || 0) - Number(line.credit || 0);
    row.journalLineCount += 1;
  }

  const rows = [...rowsBySource.values()]
    .map((row) => {
      const { documentIds = [], ...sourceRow } = row;
      const sourceAllocations = documentIds
        .flatMap((documentId) => allocationsByDocumentId.get(documentId) || []);
      const allocationAmount = sourceAllocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      const allocationVariance = rounded(allocationAmount - row.documentAllocated);
      const journalIds = [...new Set(sourceAllocations.map((allocation) => allocation.journalEntryId).filter(Boolean))];
      let postedReceiptAllocationAmount = 0;
      let collectionJournalVariance = 0;
      let collectionJournalMismatchCount = 0;
      let collectionJournalInvalidCount = sourceAllocations.filter((allocation) => !allocation.journalEntryId).length;

      for (const journalId of journalIds) {
        const journal = journalsById.get(journalId);
        const journalAllocations = allocationsByJournalId.get(journalId) || [];
        const journalAllocationTotal = journalAllocations.reduce(
          (sum, allocation) => sum + Number(allocation.amount || 0),
          0
        );
        const journalReceivableCredit = (journal?.lines || []).reduce(
          (sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0),
          0
        );
        const variance = rounded(journalReceivableCredit - journalAllocationTotal);

        if (!journal || journal.status !== "POSTED") {
          collectionJournalInvalidCount += sourceAllocations.filter(
            (allocation) => allocation.journalEntryId === journalId
          ).length;
          continue;
        }

        collectionJournalVariance = rounded(collectionJournalVariance + variance);
        if (Math.abs(variance) > 0.05) collectionJournalMismatchCount += 1;
        postedReceiptAllocationAmount += sourceAllocations
          .filter((allocation) => allocation.journalEntryId === journalId)
          .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      }

      const invoiceTotal = rounded(row.invoiceTotal);
      const documentOriginal = rounded(row.documentOriginal);
      const journalReceivable = rounded(row.journalReceivable);
      const invoiceToDocumentVariance = rounded(documentOriginal - invoiceTotal);
      const documentToJournalVariance = rounded(journalReceivable - documentOriginal);
      const invoiceStatusSupported = ["ISSUED", "PAID"].includes(row.invoiceStatus);
      const documentBalanceVariance = rounded(row.documentBalanceVariance);
      const documentAllocationVariance = allocationVariance;
      const collectionEvidenceMatches = Math.abs(documentBalanceVariance) <= 0.05
        && Math.abs(documentAllocationVariance) <= 0.05
        && collectionJournalInvalidCount === 0
        && collectionJournalMismatchCount === 0;
      const isReconciled = row.invoiceCount === 1
        && row.documentCount === 1
        && invoiceStatusSupported
        && Math.abs(invoiceToDocumentVariance) <= 0.05
        && Math.abs(documentToJournalVariance) <= 0.05
        && collectionEvidenceMatches;

      return {
        ...sourceRow,
        invoiceTotal,
        documentOriginal,
        documentAllocated: rounded(row.documentAllocated),
        documentOutstanding: rounded(row.documentOutstanding),
        documentBalanceVariance,
        allocationAmount: rounded(allocationAmount),
        allocationVariance: documentAllocationVariance,
        postedReceiptAllocationAmount: rounded(postedReceiptAllocationAmount),
        collectionJournalVariance,
        collectionJournalMismatchCount,
        collectionJournalInvalidCount,
        collectionEvidenceMatches,
        journalReceivable,
        invoiceToDocumentVariance,
        documentToJournalVariance,
        isReconciled,
        status: isReconciled ? "MATCH" : "REVIEW",
      };
    })
    .sort((left, right) => String(left.invoiceNumber || left.sourceId).localeCompare(String(right.invoiceNumber || right.sourceId)));

  const invoiceTotal = rounded(rows.reduce((sum, row) => sum + row.invoiceTotal, 0));
  const documentOriginal = rounded(rows.reduce((sum, row) => sum + row.documentOriginal, 0));
  const documentAllocated = rounded(rows.reduce((sum, row) => sum + row.documentAllocated, 0));
  const documentOutstanding = rounded(rows.reduce((sum, row) => sum + row.documentOutstanding, 0));
  const allocationAmount = rounded(rows.reduce((sum, row) => sum + row.allocationAmount, 0));
  const postedReceiptAllocationAmount = rounded(rows.reduce((sum, row) => sum + row.postedReceiptAllocationAmount, 0));
  const journalReceivable = rounded(rows.reduce((sum, row) => sum + row.journalReceivable, 0));
  const collectionJournalIds = new Set(
    allocations
      .map((allocation) => allocation.journalEntryId)
      .filter((journalId) => journalId && journalsById.get(journalId)?.status === "POSTED")
  );
  const collectionJournalCredit = rounded([...collectionJournalIds].reduce((sum, journalId) => {
    const journal = journalsById.get(journalId);
    return sum + (journal?.lines || []).reduce(
      (journalSum, line) => journalSum + Number(line.credit || 0) - Number(line.debit || 0),
      0
    );
  }, 0));
  const unmatchedCount = rows.filter((row) => !row.isReconciled).length;
  const sourceCount = rows.length;

  return {
    coverageStatus: "SOURCE_SCOPED",
    sourceCount,
    unmatchedCount,
    isReconciled: sourceCount > 0 && unmatchedCount === 0,
    invoiceTotal,
    documentOriginal,
    documentAllocated,
    documentOutstanding,
    allocationAmount,
    postedReceiptAllocationAmount,
    collectionJournalCredit,
    journalReceivable,
    invoiceToDocumentVariance: rounded(documentOriginal - invoiceTotal),
    documentToJournalVariance: rounded(journalReceivable - documentOriginal),
    coverageNote: "Compares collaboration fee invoices, COLLABORATION_FEE receivable documents, posted 1130 invoice journals, recorded allocations, and linked posted 1130 receipt journals. This source-scoped check does not cover unlinked or legacy collections, credits/reversals, or the full 1130 control.",
    sources: rows,
  };
};
