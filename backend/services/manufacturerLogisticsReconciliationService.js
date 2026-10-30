const manufacturerKey = (party) => {
  if (party?.partyType === "MANUFACTURER" && party.sourceEntityId) {
    return String(party.sourceEntityId);
  }
  return null;
};

const rounded = (amount) => Number(Number(amount || 0).toFixed(2));

const buildManufacturerPayableReconciliation = ({
  journalLines = [],
  documents = [],
  sourceType,
  coverageNote,
} = {}) => {
  const rowsBySource = new Map();
  const getRow = (sourceId, manufacturerId) => {
    const key = `${manufacturerId || "UNATTRIBUTED"}:${sourceId}`;
    if (!rowsBySource.has(key)) {
      rowsBySource.set(key, {
        sourceId,
        manufacturerId,
        journalPayable: 0,
        documentOriginal: 0,
        documentOutstanding: 0,
        journalLineCount: 0,
        documentCount: 0,
      });
    }
    return rowsBySource.get(key);
  };

  for (const line of journalLines) {
    const sourceId = line.journalEntry?.sourceId;
    if (!sourceId) continue;
    const row = getRow(sourceId, manufacturerKey(line.accountingParty) || line.supplierId || null);
    row.journalPayable += Number(line.credit || 0) - Number(line.debit || 0);
    row.journalLineCount += 1;
  }

  for (const document of documents) {
    if (document.side !== "PAYABLE" || !document.sourceId) continue;
    const row = getRow(document.sourceId, manufacturerKey(document.party));
    row.documentOriginal += Number(document.originalAmount || 0);
    row.documentOutstanding += Number(document.remainingAmount || 0);
    row.documentCount += 1;
  }

  const rows = [...rowsBySource.values()]
    .map((row) => {
      const journalPayable = rounded(row.journalPayable);
      const documentOriginal = rounded(row.documentOriginal);
      const variance = rounded(documentOriginal - journalPayable);
      return {
        ...row,
        journalPayable,
        documentOriginal,
        documentOutstanding: rounded(row.documentOutstanding),
        variance,
        isReconciled: Math.abs(variance) <= 0.05,
        status: Math.abs(variance) <= 0.05 ? "MATCH" : "REVIEW",
      };
    })
    .sort((left, right) =>
      String(left.manufacturerId || "").localeCompare(String(right.manufacturerId || "")) ||
      String(left.sourceId).localeCompare(String(right.sourceId))
    );

  const journalPayable = rounded(rows.reduce((sum, row) => sum + row.journalPayable, 0));
  const documentOriginal = rounded(rows.reduce((sum, row) => sum + row.documentOriginal, 0));
  const variance = rounded(documentOriginal - journalPayable);
  const unmatchedCount = rows.filter((row) => !row.isReconciled).length;
  const sourceCount = rows.length;

  return {
    coverageStatus: "SOURCE_SCOPED",
    sourceType,
    journalPayable,
    documentOriginal,
    documentOutstanding: rounded(rows.reduce((sum, row) => sum + row.documentOutstanding, 0)),
    variance,
    journalSourceCount: journalLines.length,
    documentSourceCount: documents.length,
    sourceCount,
    unmatchedCount,
    isReconciled: sourceCount > 0 && unmatchedCount === 0,
    coverageNote,
    sources: rows,
  };
};

export const buildManufacturerLogisticsReconciliation = (input = {}) =>
  buildManufacturerPayableReconciliation({
    ...input,
    sourceType: "MANUFACTURER_LOGISTICS",
    coverageNote: "Compares posted local manufacturer logistics payable journals with source-linked payable documents. This does not reconcile other manufacturer payable sources or legacy opening balances.",
  });

export const buildManufacturerProductionReconciliation = (input = {}) =>
  buildManufacturerPayableReconciliation({
    ...input,
    sourceType: "MANUFACTURER_PRODUCTION",
    coverageNote: "Compares posted accepted-production payable journals with source-linked production bills. This does not reconcile legacy delivery-accrued costs, other manufacturer payable sources, or historical opening balances.",
  });
