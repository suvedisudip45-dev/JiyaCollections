const rounded = (amount) => Number(Number(amount || 0).toFixed(2));

export const buildCollaborationFeeReceivableReconciliation = ({
  invoices = [],
  documents = [],
  journalLines = [],
  documentAllocations = [],
  allocations = [],
  collectionJournals = [],
  creditApplications = [],
} = {}) => {
  const rowsBySource = new Map();
  const allocationsByDocumentId = new Map();
  const allocationsByJournalId = new Map();
  const journalsById = new Map();
  const documentSigns = new Map();
  const documentsById = new Map();
  const offsetAllocationsByApplicationKey = new Map();
  const creditApplicationsByKey = new Map();
  const invalidOffsetCountsByDocumentId = new Map();
  const validOffsetApplicationKeys = new Set();
  let offsetApplicationAmount = 0;
  let offsetApplicationCount = 0;
  let offsetApplicationInvalidCount = 0;
  const addInvalidOffsetCount = (documentId) => {
    if (!documentId) return;
    invalidOffsetCountsByDocumentId.set(
      documentId,
      (invalidOffsetCountsByDocumentId.get(documentId) || 0) + 1,
    );
  };
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
        offsetAllocationAmount: 0,
        offsetApplicationCount: 0,
        offsetApplicationInvalidCount: 0,
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
    if (document.id) documentsById.set(document.id, document);
    if (document.side !== "RECEIVABLE" || document.sourceType !== "COLLABORATION_FEE" || !document.sourceId) continue;
    const row = getRow(document.sourceId);
    const sign = document.documentType === "CREDIT_NOTE" ? -1 : 1;
    documentSigns.set(document.id, sign);
    row.documentOriginal += sign * Number(document.originalAmount || 0);
    row.documentAllocated += sign * Number(document.allocatedAmount || 0);
    row.documentOutstanding += sign * Number(document.remainingAmount || 0);
    row.documentBalanceVariance += sign * (
      Number(document.allocatedAmount || 0)
      + Number(document.remainingAmount || 0)
      - Number(document.originalAmount || 0)
    );
    row.documentCount += 1;
    row.documentIds = [...(row.documentIds || []), document.id];
  }

  for (const allocation of documentAllocations) {
    if (!allocation.documentId) continue;
    const documentAllocationRows = allocationsByDocumentId.get(allocation.documentId) || [];
    documentAllocationRows.push(allocation);
    allocationsByDocumentId.set(allocation.documentId, documentAllocationRows);

    if (allocation.allocationType === "OFFSET") {
      const keyMatch = /^(.*):(CREDIT|INVOICE)$/.exec(allocation.idempotencyKey || "");
      if (!keyMatch || !keyMatch[1]) {
        offsetApplicationInvalidCount += 1;
        addInvalidOffsetCount(allocation.documentId);
        continue;
      }
      const [, applicationKey, side] = keyMatch;
      const applicationAllocations = offsetAllocationsByApplicationKey.get(applicationKey) || { CREDIT: [], INVOICE: [] };
      applicationAllocations[side].push(allocation);
      offsetAllocationsByApplicationKey.set(applicationKey, applicationAllocations);
    }
  }

  for (const allocation of allocations) {
    if (allocation.journalEntryId && allocation.allocationType !== "OFFSET") {
      const journalAllocations = allocationsByJournalId.get(allocation.journalEntryId) || [];
      journalAllocations.push(allocation);
      allocationsByJournalId.set(allocation.journalEntryId, journalAllocations);
    }
  }

  for (const journal of collectionJournals) {
    if (journal.id) journalsById.set(journal.id, journal);
  }

  for (const application of creditApplications) {
    if (!application.idempotencyKey) continue;
    const records = creditApplicationsByKey.get(application.idempotencyKey) || [];
    records.push(application);
    creditApplicationsByKey.set(application.idempotencyKey, records);
  }

  for (const [applicationKey, groupedAllocations] of offsetAllocationsByApplicationKey) {
    const applicationAllocations = [...groupedAllocations.CREDIT, ...groupedAllocations.INVOICE];
    const [creditAllocation] = groupedAllocations.CREDIT;
    const [invoiceAllocation] = groupedAllocations.INVOICE;
    const [persistedApplication] = creditApplicationsByKey.get(applicationKey) || [];
    const creditDocument = creditAllocation && documentsById.get(creditAllocation.documentId);
    const invoiceDocument = invoiceAllocation && documentsById.get(invoiceAllocation.documentId);
    const creditJournal = creditAllocation && journalsById.get(creditAllocation.journalEntryId);
    const creditJournalReceivable = (creditJournal?.lines || []).reduce(
      (sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0),
      0,
    );
    const creditAmount = Number(creditAllocation?.amount || 0);
    const invoiceAmount = Number(invoiceAllocation?.amount || 0);
    const creditDate = new Date(creditDocument?.issueDate).getTime();
    const invoiceDate = new Date(invoiceDocument?.issueDate).getTime();
    const isValidPair = groupedAllocations.CREDIT.length === 1
      && groupedAllocations.INVOICE.length === 1
      && creditAllocation.journalEntryId
      && creditAllocation.journalEntryId === invoiceAllocation.journalEntryId
      && creditAllocation.idempotencyKey === `${applicationKey}:CREDIT`
      && invoiceAllocation.idempotencyKey === `${applicationKey}:INVOICE`
      && (creditApplicationsByKey.get(applicationKey) || []).length === 1
      && persistedApplication.creditDocumentId === creditAllocation.documentId
      && persistedApplication.invoiceDocumentId === invoiceAllocation.documentId
      && persistedApplication.journalEntryId === creditAllocation.journalEntryId
      && Math.abs(Number(persistedApplication.amount || 0) - creditAmount) <= 0.05
      && creditAllocation.documentId !== invoiceAllocation.documentId
      && creditDocument?.documentType === "CREDIT_NOTE"
      && invoiceDocument?.documentType === "INVOICE"
      && creditDocument.side === "RECEIVABLE"
      && invoiceDocument.side === "RECEIVABLE"
      && creditDocument.sourceType === "COLLABORATION_FEE"
      && invoiceDocument.sourceType === "COLLABORATION_FEE"
      && creditDocument.partyId
      && creditDocument.partyId === invoiceDocument.partyId
      && creditDocument.currency
      && creditDocument.currency === invoiceDocument.currency
      && Number.isFinite(creditDate)
      && Number.isFinite(invoiceDate)
      && invoiceDate >= creditDate
      && creditJournal?.status === "POSTED"
      && creditJournal.sourceType === "COLLABORATION_FEE_INVOICE"
      && creditJournal.sourceId === creditDocument.sourceId
      && Math.abs(creditJournalReceivable - Number(creditDocument.originalAmount || 0)) <= 0.05
      && creditAmount > 0
      && Math.abs(creditAmount - invoiceAmount) <= 0.05;

    if (isValidPair) {
      validOffsetApplicationKeys.add(applicationKey);
      offsetApplicationAmount += creditAmount;
      offsetApplicationCount += 1;
    } else {
      offsetApplicationInvalidCount += 1;
      for (const documentId of new Set(applicationAllocations.map((allocation) => allocation.documentId))) {
        addInvalidOffsetCount(documentId);
      }
    }
  }

  for (const [applicationKey, applicationRecords] of creditApplicationsByKey) {
    if (offsetAllocationsByApplicationKey.has(applicationKey)) continue;
    offsetApplicationInvalidCount += applicationRecords.length;
    for (const application of applicationRecords) {
      addInvalidOffsetCount(application.creditDocumentId);
      addInvalidOffsetCount(application.invoiceDocumentId);
    }
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
      const allocationAmount = sourceAllocations.reduce(
        (sum, allocation) => sum + (documentSigns.get(allocation.documentId) || 1) * Number(allocation.amount || 0),
        0,
      );
      const allocationVariance = rounded(allocationAmount - row.documentAllocated);
      const offsetAllocations = sourceAllocations.filter((allocation) => allocation.allocationType === "OFFSET");
      const receiptAllocations = sourceAllocations.filter((allocation) => allocation.allocationType !== "OFFSET");
      const journalIds = [...new Set(receiptAllocations.map((allocation) => allocation.journalEntryId).filter(Boolean))];
      let postedReceiptAllocationAmount = 0;
      let collectionJournalVariance = 0;
      let collectionJournalMismatchCount = 0;
      let collectionJournalInvalidCount = receiptAllocations.filter((allocation) => !allocation.journalEntryId).length;
      const offsetApplicationInvalidCount = documentIds.reduce(
        (sum, documentId) => sum + (invalidOffsetCountsByDocumentId.get(documentId) || 0),
        0,
      );
      const offsetApplicationCount = offsetAllocations.filter((allocation) => {
        const keyMatch = /^(.*):(CREDIT|INVOICE)$/.exec(allocation.idempotencyKey || "");
        return keyMatch && validOffsetApplicationKeys.has(keyMatch[1]);
      }).length;
      const offsetAllocationAmount = rounded(offsetAllocations.reduce(
        (sum, allocation) => sum + Math.abs(Number(allocation.amount || 0)),
        0,
      ));

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
          collectionJournalInvalidCount += receiptAllocations.filter(
            (allocation) => allocation.journalEntryId === journalId
          ).length;
          continue;
        }

        collectionJournalVariance = rounded(collectionJournalVariance + variance);
        if (Math.abs(variance) > 0.05) collectionJournalMismatchCount += 1;
        postedReceiptAllocationAmount += receiptAllocations
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
        && collectionJournalMismatchCount === 0
        && offsetApplicationInvalidCount === 0;
      const isNetZeroAdjustment = Math.abs(invoiceTotal) <= 0.05
        && row.documentCount === 0
        && row.journalLineCount === 0
        && sourceAllocations.length === 0;
      const isReconciled = row.invoiceCount === 1
        && invoiceStatusSupported
        && Math.abs(invoiceToDocumentVariance) <= 0.05
        && Math.abs(documentToJournalVariance) <= 0.05
        && collectionEvidenceMatches
        && (isNetZeroAdjustment || row.documentCount === 1);

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
        offsetAllocationAmount,
        offsetApplicationCount,
        offsetApplicationInvalidCount,
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
      .filter((allocation) => allocation.allocationType !== "OFFSET")
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
    offsetApplicationAmount: rounded(offsetApplicationAmount),
    offsetApplicationCount,
    offsetApplicationInvalidCount,
    collectionJournalCredit,
    journalReceivable,
    invoiceToDocumentVariance: rounded(documentOriginal - invoiceTotal),
    documentToJournalVariance: rounded(journalReceivable - documentOriginal),
    coverageNote: "Compares collaboration fee invoices, COLLABORATION_FEE receivable documents, posted 1130 invoice journals, cash receipt allocations, paired credit offsets, and linked posted 1130 receipt journals. This source-scoped check does not cover unlinked or legacy collections, cash refunds, or the full 1130 control.",
    sources: rows,
  };
};
