const roundAmount = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
};

const signedAmount = (debit, credit) => Number(debit || 0) - Number(credit || 0);

export const buildMarketingCpaPayableReconciliation = ({
  redemptionEvents = [],
  journalEntries = [],
  documents = [],
} = {}) => {
  const rowsBySource = new Map();
  const getRow = (sourceId) => {
    if (!rowsBySource.has(sourceId)) {
      rowsBySource.set(sourceId, {
        sourceId,
        redemptionEventCount: 0,
        redemptionEventIds: [],
        sourceIdMissing: false,
        sourceIdMismatch: false,
        snapshotKnown: false,
        snapshotUnknown: false,
        snapshotInvalid: false,
        expectedCpaAmount: null,
        cpaExpected: null,
        journalCount: 0,
        journalIds: [],
        journalStatuses: [],
        expenseLineCount: 0,
        payableLineCount: 0,
        expenseAmount: 0,
        payableAmount: 0,
        expenseParty: null,
        payableParty: null,
        documentCount: 0,
        documentIds: [],
        documentSides: [],
        documentTypes: [],
        documentCurrencies: [],
        documentStatuses: [],
        documentOriginal: 0,
        documentAllocated: 0,
        documentOutstanding: 0,
        documentBalanceVariance: 0,
        documentParty: null,
        partnerName: null,
        amountInvalid: false,
      });
    }
    return rowsBySource.get(sourceId);
  };
  const addParty = (row, field, party) => {
    if (!party) return;
    if (!row[field]) row[field] = [];
    row[field].push(party);
  };

  for (const [index, event] of redemptionEvents.entries()) {
    if (event.eventType !== "BENEFIT_REDEEMED") continue;
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const metadataSourceId = metadata.redemptionId ? String(metadata.redemptionId) : null;
    const referenceSourceId = event.referenceId ? String(event.referenceId) : null;
    const sourceId = referenceSourceId || metadataSourceId || `UNLINKED-EVENT:${event.id || index}`;
    const row = getRow(sourceId);
    row.redemptionEventCount += 1;
    if (event.id) row.redemptionEventIds.push(event.id);
    if (!referenceSourceId && !metadataSourceId) row.sourceIdMissing = true;
    if (referenceSourceId && metadataSourceId && referenceSourceId !== metadataSourceId) {
      row.sourceIdMismatch = true;
    }

    const snapshot = metadata.cpaRateSnapshot;
    if (snapshot === undefined || snapshot === null) {
      row.snapshotUnknown = true;
      continue;
    }
    const snapshotIsNumericScalar = typeof snapshot === "number" ||
      (typeof snapshot === "string" && snapshot.trim() !== "");
    const snapshotAmount = snapshotIsNumericScalar ? roundAmount(snapshot) : null;
    if (snapshotAmount === null || snapshotAmount < 0) {
      row.snapshotInvalid = true;
      continue;
    }
    if (row.snapshotKnown && row.expectedCpaAmount !== snapshotAmount) {
      row.snapshotInvalid = true;
    }
    row.snapshotKnown = true;
    row.expectedCpaAmount = snapshotAmount;
    row.cpaExpected = snapshotAmount > 0;
  }

  for (const [index, journal] of journalEntries.entries()) {
    if (journal.sourceType !== "MARKETING_CPA") continue;
    const sourceId = journal.sourceId ? String(journal.sourceId) : `UNLINKED-JOURNAL:${journal.id || index}`;
    const row = getRow(sourceId);
    if (!journal.sourceId) row.sourceIdMissing = true;
    row.journalCount += 1;
    if (journal.id) row.journalIds.push(journal.id);
    row.journalStatuses.push(journal.status || "UNKNOWN");

    for (const line of journal.lines || []) {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
        row.amountInvalid = true;
        continue;
      }
      if (line.account?.accountCode === "6420") {
        row.expenseLineCount += 1;
        row.expenseAmount += signedAmount(debit, credit);
        addParty(row, "expenseParty", line.accountingParty);
      }
      if (line.account?.accountCode === "2170") {
        row.payableLineCount += 1;
        row.payableAmount += signedAmount(credit, debit);
        addParty(row, "payableParty", line.accountingParty);
      }
    }
  }

  for (const [index, document] of documents.entries()) {
    if (document.sourceType !== "MARKETING_CPA") continue;
    const sourceId = document.sourceId ? String(document.sourceId) : `UNLINKED-BILL:${document.id || index}`;
    const row = getRow(sourceId);
    if (!document.sourceId) row.sourceIdMissing = true;
    row.documentCount += 1;
    if (document.id) row.documentIds.push(document.id);
    row.documentSides.push(document.side || "UNKNOWN");
    row.documentTypes.push(document.documentType || "UNKNOWN");
    row.documentCurrencies.push(document.currency || "UNKNOWN");
    row.documentStatuses.push(document.status || "UNKNOWN");
    const original = roundAmount(document.originalAmount);
    const allocated = roundAmount(document.allocatedAmount);
    const outstanding = roundAmount(document.remainingAmount);
    if (original === null || allocated === null || outstanding === null) {
      row.amountInvalid = true;
    } else {
      if (original < 0 || allocated < 0 || outstanding < 0) row.amountInvalid = true;
      row.documentOriginal += original;
      row.documentAllocated += allocated;
      row.documentOutstanding += outstanding;
      row.documentBalanceVariance += allocated + outstanding - original;
    }
    addParty(row, "documentParty", document.party);
  }

  const sources = [...rowsBySource.values()]
    .map((row) => {
      const expenseAmount = roundAmount(row.expenseAmount);
      const payableAmount = roundAmount(row.payableAmount);
      const documentOriginal = roundAmount(row.documentOriginal);
      const documentAllocated = roundAmount(row.documentAllocated);
      const documentOutstanding = roundAmount(row.documentOutstanding);
      const documentBalanceVariance = roundAmount(row.documentBalanceVariance);
      const expenseParty = row.expenseParty?.length === 1 ? row.expenseParty[0] : null;
      const payableParty = row.payableParty?.length === 1 ? row.payableParty[0] : null;
      const documentParty = row.documentParty?.length === 1 ? row.documentParty[0] : null;
      const documentSide = row.documentSides.length === 1 ? row.documentSides[0] : "MULTIPLE";
      const documentType = row.documentTypes.length === 1 ? row.documentTypes[0] : "MULTIPLE";
      const documentCurrency = row.documentCurrencies.length === 1 ? row.documentCurrencies[0] : "MULTIPLE";
      const documentStatus = row.documentStatuses.length === 1 ? row.documentStatuses[0] : "MULTIPLE";
      const accountingEvidenceExists = row.journalCount > 0 || row.documentCount > 0;
      const partyMatches = Boolean(
        expenseParty &&
        payableParty &&
        documentParty &&
        expenseParty.partyType === "MARKETING_PARTNER" &&
        payableParty.partyType === "MARKETING_PARTNER" &&
        documentParty.partyType === "MARKETING_PARTNER" &&
        expenseParty.sourceEntityId === payableParty.sourceEntityId &&
        payableParty.sourceEntityId === documentParty.sourceEntityId,
      );
      const journalDocumentVariance = roundAmount(documentOriginal - payableAmount);
      const journalStatus = row.journalStatuses.length === 1
        ? row.journalStatuses[0]
        : row.journalStatuses.length > 1 ? "MULTIPLE" : null;
      const issues = [];

      if (row.redemptionEventCount === 0) issues.push("MISSING_REDEMPTION_EVENT");
      if (row.redemptionEventCount > 1) issues.push("DUPLICATE_REDEMPTION_EVENTS");
      if (row.sourceIdMissing) issues.push("MISSING_SOURCE_ID");
      if (row.sourceIdMismatch) issues.push("REDEMPTION_EVENT_SOURCE_MISMATCH");
      if (row.snapshotUnknown) issues.push("CPA_RATE_SNAPSHOT_UNKNOWN");
      if (row.snapshotInvalid) issues.push("CPA_RATE_SNAPSHOT_INVALID");
      if (row.snapshotKnown && row.expectedCpaAmount > 0 && row.journalCount === 0) {
        issues.push("MISSING_JOURNAL");
      }
      if (row.journalCount > 1) issues.push("DUPLICATE_JOURNALS");
      if (row.journalCount === 1 && journalStatus !== "POSTED") issues.push(`JOURNAL_${journalStatus}`);
      if (
        row.journalCount > 0 &&
        (row.expenseLineCount !== 1 || row.payableLineCount !== 1)
      ) {
        issues.push("JOURNAL_LINES_MISMATCH");
      }
      if (
        row.snapshotKnown &&
        row.expectedCpaAmount > 0 &&
        row.documentCount === 0
      ) {
        issues.push("MISSING_BILL");
      }
      if (row.documentCount > 1) issues.push("DUPLICATE_BILLS");
      if (row.documentCount === 1 && documentSide !== "PAYABLE") issues.push("DOCUMENT_SIDE_MISMATCH");
      if (row.documentCount === 1 && documentType !== "BILL") issues.push("DOCUMENT_TYPE_MISMATCH");
      if (row.documentCount === 1 && documentCurrency !== "NPR") issues.push("DOCUMENT_CURRENCY_MISMATCH");
      if (row.documentCount === 1 && !["OPEN", "PARTIALLY_PAID", "PAID"].includes(documentStatus)) {
        issues.push("DOCUMENT_STATUS_MISMATCH");
      }
      if (row.amountInvalid) issues.push("INVALID_AMOUNT");
      if (
        accountingEvidenceExists &&
        row.expenseLineCount === 1 &&
        row.payableLineCount === 1 &&
        (expenseAmount <= 0 ||
          Math.abs(expenseAmount - payableAmount) > 0.05 ||
          Math.abs(journalDocumentVariance) > 0.05)
      ) {
        issues.push("AMOUNT_MISMATCH");
      }
      if (row.documentCount === 1 && Math.abs(documentBalanceVariance) > 0.05) {
        issues.push("DOCUMENT_BALANCE_MISMATCH");
      }
      if (row.journalCount === 1 && row.documentCount === 1 && !partyMatches) {
        issues.push("PARTY_MISMATCH");
      }
      if (row.snapshotKnown && row.expectedCpaAmount === 0 && accountingEvidenceExists) {
        issues.push("UNEXPECTED_ACCOUNTING");
      }
      if (
        row.snapshotKnown &&
        row.expectedCpaAmount > 0 &&
        accountingEvidenceExists &&
        ((row.expenseLineCount > 0 && Math.abs(expenseAmount - row.expectedCpaAmount) > 0.05) ||
          (row.payableLineCount > 0 && Math.abs(payableAmount - row.expectedCpaAmount) > 0.05) ||
          (row.documentCount > 0 && Math.abs(documentOriginal - row.expectedCpaAmount) > 0.05))
      ) {
        issues.push("EXPECTED_AMOUNT_MISMATCH");
      }

      const expectedAccountingComplete = row.snapshotKnown && row.expectedCpaAmount === 0
        ? !accountingEvidenceExists
        : row.snapshotKnown && row.expectedCpaAmount > 0
          ? row.journalCount === 1 &&
            journalStatus === "POSTED" &&
            row.expenseLineCount === 1 &&
            row.payableLineCount === 1 &&
            row.documentCount === 1 &&
            !row.amountInvalid &&
            partyMatches &&
            expenseAmount > 0 &&
            Math.abs(expenseAmount - payableAmount) <= 0.05 &&
            Math.abs(journalDocumentVariance) <= 0.05 &&
            Math.abs(documentBalanceVariance) <= 0.05 &&
            Math.abs(expenseAmount - row.expectedCpaAmount) <= 0.05 &&
            Math.abs(payableAmount - row.expectedCpaAmount) <= 0.05 &&
            Math.abs(documentOriginal - row.expectedCpaAmount) <= 0.05
          : !accountingEvidenceExists || (
            row.journalCount === 1 &&
            journalStatus === "POSTED" &&
            row.expenseLineCount === 1 &&
            row.payableLineCount === 1 &&
            row.documentCount === 1 &&
            !row.amountInvalid &&
            partyMatches &&
            expenseAmount > 0 &&
            Math.abs(expenseAmount - payableAmount) <= 0.05 &&
            Math.abs(journalDocumentVariance) <= 0.05 &&
            Math.abs(documentBalanceVariance) <= 0.05
          );
      const isReconciled = issues.length === 0 &&
        row.redemptionEventCount === 1 &&
        !row.sourceIdMissing &&
        !row.sourceIdMismatch &&
        !row.snapshotUnknown &&
        !row.snapshotInvalid &&
        expectedAccountingComplete;

      return {
        sourceId: row.sourceId,
        redemptionEventCount: row.redemptionEventCount,
        redemptionEventIds: row.redemptionEventIds,
        snapshotKnown: row.snapshotKnown,
        snapshotUnknown: row.snapshotUnknown,
        snapshotInvalid: row.snapshotInvalid,
        expectedCpaAmount: row.snapshotKnown ? row.expectedCpaAmount : null,
        cpaExpected: row.cpaExpected,
        journalCount: row.journalCount,
        journalIds: row.journalIds,
        journalStatus,
        expenseLineCount: row.expenseLineCount,
        payableLineCount: row.payableLineCount,
        expenseAmount,
        payableAmount,
        documentCount: row.documentCount,
        documentIds: row.documentIds,
        documentSide,
        documentType,
        documentCurrency,
        documentStatus,
        documentOriginal,
        documentAllocated,
        documentOutstanding,
        documentBalanceVariance,
        journalDocumentVariance,
        partnerName: documentParty?.displayName || payableParty?.displayName || null,
        partyMatches,
        amountInvalid: row.amountInvalid,
        issues,
        isReconciled,
        status: isReconciled
          ? (row.expectedCpaAmount === 0 ? "NO_CPA_EXPECTED" : "MATCH")
          : issues.join(", ") || "REVIEW",
      };
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const totals = sources.reduce((sum, source) => ({
    expenseAmount: sum.expenseAmount + (source.expenseAmount || 0),
    payableAmount: sum.payableAmount + (source.payableAmount || 0),
    documentOriginal: sum.documentOriginal + (source.documentOriginal || 0),
    documentAllocated: sum.documentAllocated + (source.documentAllocated || 0),
    documentOutstanding: sum.documentOutstanding + (source.documentOutstanding || 0),
  }), {
    expenseAmount: 0,
    payableAmount: 0,
    documentOriginal: 0,
    documentAllocated: 0,
    documentOutstanding: 0,
  });
  const unmatchedCount = sources.filter((source) => !source.isReconciled).length;

  return {
    coverageStatus: "SOURCE_SCOPED",
    sourceCount: sources.length,
    unmatchedCount,
    rateSnapshotUnknownCount: sources.filter((source) => source.snapshotUnknown).length,
    expectedCpaAmount: roundAmount(sources.reduce(
      (total, source) => total + (source.expectedCpaAmount || 0),
      0,
    )),
    isReconciled: sources.length > 0 &&
      unmatchedCount === 0 &&
      !sources.some((source) => source.snapshotUnknown || source.snapshotInvalid),
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundAmount(value)])),
    coverageNote: "Matches partner benefit-redemption events and their captured CPA-rate snapshots to 6420/2170 journals and payable bills. Historical redemption events without snapshots remain unverified; legacy settlements/payouts and the full 2170 control are not reconciled.",
    sources,
  };
};
