const REPORT_SCHEMA_VERSION = "1.0";
const CORE_SOURCES = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];
const OUTCOMES = new Set([
  "NO_EXCEPTION_DETECTED",
  "EXCEPTION_DETECTED",
  "RECONCILIATION_INCOMPLETE",
  "DATA_UNAVAILABLE",
]);
const REPORT_OUTCOMES = new Set([
  "NO_EXCEPTION_DETECTED",
  "EXCEPTIONS_DETECTED",
  "RECONCILIATION_INCOMPLETE",
  "DATA_UNAVAILABLE",
]);
const SEVERITIES = ["HIGH", "MEDIUM", "LOW", "INFO"];
const COST_STATUSES = new Set(["COVERED", "PARTIAL", "UNRECONCILED", "MISSING", "NOT_APPLICABLE"]);
const COST_CLASSIFICATIONS = new Set([
  "AUTHORITATIVE_COST_LAYER",
  "VERIFIED_RECEIVED_COST",
  "HISTORICAL_COST_SNAPSHOT",
  "REFERENCE_OR_CATALOG_COST",
  "ESTIMATE",
  "UNRECONCILED",
  "MISSING",
]);
const QUANTITY_FIELDS = [
  "requestedQuantity",
  "authorizedQuantity",
  "reservedQuantity",
  "dispatchedCounterQuantity",
  "dispatchedShipmentQuantity",
  "dispatchedLedgerQuantity",
  "receivedGoodQuantity",
  "receivedDamagedQuantity",
  "receivedMissingQuantity",
  "receivedReportedQuantity",
  "receivedLedgerQuantity",
  "authorizedUnshippedQuantity",
  "outstandingInTransitQuantity",
  "unresolvedDiscrepancyQuantity",
  "unresolvedDiscrepancyQuantity",
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const compareText = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};
const requiredText = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
};
const optionalText = (value, label) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string or null.`);
  return value.trim() || null;
};
const exactIntegerText = (value, label) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer or exact integer string.`);
    return String(value);
  }
  if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) return value;
  throw new TypeError(`${label} must be an exact integer, bigint, or null.`);
};
const exactIntegerBigInt = (value, label) => {
  const text = exactIntegerText(value, label);
  return text === null ? null : BigInt(text);
};
const sumExact = (values) => values.reduce((total, value) => total + value, 0n).toString();
const stableStringList = (value, label) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return [...new Set(value.map((item, index) => requiredText(item, `${label}[${index}]`)))]
    .sort(compareText);
};

const normalizeCoverage = (result) => {
  if (!isRecord(result.coverage)) throw new TypeError("Reconciliation coverage must be an object.");
  const sources = {};
  for (const source of CORE_SOURCES) {
    if (typeof result.coverage[source] !== "boolean") {
      throw new TypeError(`Coverage for ${source} must be a boolean.`);
    }
    sources[source] = result.coverage[source] ? "COMPLETE" : "INCOMPLETE";
  }
  for (const source of ["costLayers", "costEvidence"]) {
    if (result.coverage[source] !== undefined && typeof result.coverage[source] !== "boolean") {
      throw new TypeError(`Coverage for ${source} must be a boolean when supplied.`);
    }
  }
  const complete = CORE_SOURCES.every((source) => result.coverage[source]);
  const unavailableSources = stableStringList(result.unavailableSources, "unavailableSources");
  return {
    sourceCoverage: {
      status: unavailableSources.length
        ? "DATA_UNAVAILABLE"
        : complete ? "COMPLETE" : "INCOMPLETE",
      sources,
      unavailableSources,
      costLayers: result.coverage.costLayers === true ? "COMPLETE" :
        result.coverage.costLayers === false ? "INCOMPLETE" : "UNKNOWN",
      costEvidence: result.coverage.costEvidence === true ? "COMPLETE" :
        result.coverage.costEvidence === false ? "INCOMPLETE" : "UNKNOWN",
    },
    coreComplete: complete,
    unavailableSources,
  };
};

const normalizeExceptions = (exceptions) => {
  if (!Array.isArray(exceptions)) throw new TypeError("Reconciliation exceptions must be an array.");
  const normalized = exceptions.map((exception, index) => {
    if (!isRecord(exception)) throw new TypeError(`Exception ${index} must be an object.`);
    const severity = requiredText(exception.severity, `exceptions[${index}].severity`).toUpperCase();
    if (!SEVERITIES.includes(severity)) {
      throw new TypeError(`exceptions[${index}].severity is unsupported.`);
    }
    if (typeof exception.explanation !== "string") {
      throw new TypeError(`exceptions[${index}].explanation must be a string.`);
    }
    return {
      exceptionKey: requiredText(exception.exceptionKey, `exceptions[${index}].exceptionKey`),
      code: requiredText(exception.code, `exceptions[${index}].code`),
      severity,
      transferId: optionalText(exception.transferId, `exceptions[${index}].transferId`),
      transferLineId: optionalText(exception.transferLineId, `exceptions[${index}].transferLineId`),
      shipmentId: optionalText(exception.shipmentId, `exceptions[${index}].shipmentId`),
      shipmentLineId: optionalText(exception.shipmentLineId, `exceptions[${index}].shipmentLineId`),
      receiptId: optionalText(exception.receiptId, `exceptions[${index}].receiptId`),
      receiptLineId: optionalText(exception.receiptLineId, `exceptions[${index}].receiptLineId`),
      relatedTransferIds: stableStringList(exception.relatedTransferIds, `exceptions[${index}].relatedTransferIds`),
      relatedShipmentIds: stableStringList(exception.relatedShipmentIds, `exceptions[${index}].relatedShipmentIds`),
      discrepancyIds: stableStringList(exception.discrepancyIds, `exceptions[${index}].discrepancyIds`),
      ledgerEntryIds: stableStringList(exception.ledgerEntryIds, `exceptions[${index}].ledgerEntryIds`),
      expectedQuantity: exactIntegerText(exception.expectedQuantity, `exceptions[${index}].expectedQuantity`),
      actualQuantity: exactIntegerText(exception.actualQuantity, `exceptions[${index}].actualQuantity`),
      explanation: exception.explanation,
      investigationStatus: optionalText(exception.investigationStatus, `exceptions[${index}].investigationStatus`),
    };
  });
  return normalized.sort((left, right) =>
    SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity) ||
    compareText(left.code, right.code) ||
    compareText(left.exceptionKey, right.exceptionKey) ||
    compareText(left.transferId || "", right.transferId || "") ||
    compareText(left.transferLineId || "", right.transferLineId || "") ||
    compareText(left.relatedTransferIds.join(","), right.relatedTransferIds.join(",")) ||
    compareText(left.relatedShipmentIds.join(","), right.relatedShipmentIds.join(",")) ||
    compareText(left.discrepancyIds.join(","), right.discrepancyIds.join(",")) ||
    compareText(left.ledgerEntryIds.join(","), right.ledgerEntryIds.join(",")) ||
    compareText(left.expectedQuantity || "", right.expectedQuantity || "") ||
    compareText(left.actualQuantity || "", right.actualQuantity || "") ||
    compareText(left.shipmentId || "", right.shipmentId || "") ||
    compareText(left.shipmentLineId || "", right.shipmentLineId || "") ||
    compareText(left.receiptId || "", right.receiptId || "") ||
    compareText(left.receiptLineId || "", right.receiptLineId || "") ||
    compareText(left.explanation, right.explanation)
  );
};

const normalizeTransfers = (transfers) => {
  if (!Array.isArray(transfers)) throw new TypeError("Reconciliation transfers must be an array.");
  const normalized = transfers.map((transfer, transferIndex) => {
    if (!isRecord(transfer)) throw new TypeError(`Transfer ${transferIndex} must be an object.`);
    if (!Array.isArray(transfer.lines)) throw new TypeError(`Transfer ${transferIndex} lines must be an array.`);
    const lines = transfer.lines.map((line, lineIndex) => {
      if (!isRecord(line)) throw new TypeError(`Transfer ${transferIndex} line ${lineIndex} must be an object.`);
      const comparisonStatus = requiredText(line.comparisonStatus, `transfers[${transferIndex}].lines[${lineIndex}].comparisonStatus`);
      if (!["COMPLETE", "INCOMPLETE"].includes(comparisonStatus)) {
        throw new TypeError(`transfers[${transferIndex}].lines[${lineIndex}].comparisonStatus is unsupported.`);
      }
      const quantities = {};
      for (const field of QUANTITY_FIELDS) {
        quantities[field] = exactIntegerText(line[field], `transfers[${transferIndex}].lines[${lineIndex}].${field}`);
      }
      let costEvidence = null;
      if (line.costEvidence !== undefined && line.costEvidence !== null) {
        if (!isRecord(line.costEvidence)) {
          throw new TypeError(`transfers[${transferIndex}].lines[${lineIndex}].costEvidence must be an object or null.`);
        }
        const status = requiredText(
          line.costEvidence.status,
          `transfers[${transferIndex}].lines[${lineIndex}].costEvidence.status`
        );
        if (!COST_STATUSES.has(status)) throw new TypeError("Cost evidence status is unsupported.");
        const classifications = line.costEvidence.classifications === undefined
          ? []
          : line.costEvidence.classifications;
        if (!Array.isArray(classifications)) throw new TypeError("Cost evidence classifications must be an array.");
        costEvidence = {
          status,
          dispatchedQuantity: exactIntegerText(
            line.costEvidence.dispatchedQuantity,
            `transfers[${transferIndex}].lines[${lineIndex}].costEvidence.dispatchedQuantity`
          ),
          authoritativeCostLayerQuantity: exactIntegerText(
            line.costEvidence.authoritativeCostLayerQuantity,
            `transfers[${transferIndex}].lines[${lineIndex}].costEvidence.authoritativeCostLayerQuantity`
          ),
          verifiedReceivedCostQuantity: exactIntegerText(
            line.costEvidence.verifiedReceivedCostQuantity,
            `transfers[${transferIndex}].lines[${lineIndex}].costEvidence.verifiedReceivedCostQuantity`
          ),
          uncostedQuantity: exactIntegerText(
            line.costEvidence.uncostedQuantity,
            `transfers[${transferIndex}].lines[${lineIndex}].costEvidence.uncostedQuantity`
          ),
          classifications: classifications.map((classification, classificationIndex) => {
            if (!isRecord(classification)) throw new TypeError("Cost classification must be an object.");
            const name = requiredText(
              classification.classification,
              `costEvidence.classifications[${classificationIndex}].classification`
            );
            if (!COST_CLASSIFICATIONS.has(name)) throw new TypeError("Cost evidence classification is unsupported.");
            return {
              classification: name,
              quantity: exactIntegerText(classification.quantity, "cost classification quantity"),
              evidenceId: optionalText(classification.evidenceId, "cost classification evidenceId"),
              evidenceIds: stableStringList(classification.evidenceIds, "cost classification evidenceIds"),
            };
          }).sort((left, right) =>
            compareText(left.classification, right.classification) ||
            compareText(left.evidenceId || "", right.evidenceId || "") ||
            compareText(left.evidenceIds.join(","), right.evidenceIds.join(","))
          ),
        };
      }
      return {
        transferLineId: optionalText(line.transferLineId, "transferLineId"),
        inventorySkuId: optionalText(line.inventorySkuId, "inventorySkuId"),
        comparisonStatus,
        ...quantities,
        costEvidence,
      };
    }).sort((left, right) =>
      compareText(left.inventorySkuId || "", right.inventorySkuId || "") ||
      compareText(left.transferLineId || "", right.transferLineId || "") ||
      compareText(JSON.stringify(left), JSON.stringify(right))
    );
    const derivedComparisonStatus = lines.length === 0 ||
      lines.some((line) => line.comparisonStatus === "INCOMPLETE")
      ? "INCOMPLETE"
      : "COMPLETE";
    const comparisonStatus = transfer.comparisonStatus === undefined
      ? derivedComparisonStatus
      : requiredText(transfer.comparisonStatus, `transfers[${transferIndex}].comparisonStatus`);
    if (!["COMPLETE", "INCOMPLETE"].includes(comparisonStatus)) {
      throw new TypeError(`Transfer ${transferIndex} comparisonStatus is unsupported.`);
    }
    if (comparisonStatus !== derivedComparisonStatus) {
      throw new TypeError(`Transfer ${transferIndex} comparisonStatus conflicts with its line comparisons.`);
    }
    return {
      transferId: requiredText(transfer.transferId, `transfers[${transferIndex}].transferId`),
      status: optionalText(transfer.status, "transfer status"),
      inventoryOwner: optionalText(transfer.inventoryOwner, "inventoryOwner"),
      sourceLocationId: optionalText(transfer.sourceLocationId, "sourceLocationId"),
      destinationLocationId: optionalText(transfer.destinationLocationId, "destinationLocationId"),
      comparisonStatus,
      lines,
    };
  }).sort((left, right) => compareText(left.transferId, right.transferId));
  const transferIds = new Set();
  for (const transfer of normalized) {
    if (transferIds.has(transfer.transferId)) {
      throw new TypeError(`Transfer identifier ${transfer.transferId} occurs more than once in the result.`);
    }
    const allLineIds = normalized.flatMap((transfer) =>
      transfer.lines.map((line) => line.transferLineId).filter(Boolean)
    );
    if (new Set(allLineIds).size !== allLineIds.length) {
      throw new TypeError("Transfer line identifiers must be unique across the result.");
    }
    transferIds.add(transfer.transferId);
  }
  for (const transfer of normalized) {
    const lineIds = transfer.lines.map((line) => line.transferLineId).filter(Boolean);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new TypeError(`Transfer ${transfer.transferId} contains duplicate transfer line identifiers.`);
    }
  }
  return normalized;
};

const quantityTotalsByVariant = (transfers) => {
  const groups = new Map();
  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      if (!line.inventorySkuId) continue;
      const group = groups.get(line.inventorySkuId) || Object.fromEntries(
        ["authorizedQuantity", "dispatchedShipmentQuantity", "receivedReportedQuantity", "outstandingInTransitQuantity"]
          .map((field) => [field, { values: [], unavailable: false }])
      );
      for (const field of Object.keys(group)) {
        const value = exactIntegerBigInt(line[field], field);
        if (value === null) group[field].unavailable = true;
        else group[field].values.push(value);
      }
      groups.set(line.inventorySkuId, group);
    }
  }
  return [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([inventorySkuId, group]) => ({
    inventorySkuId,
    ...Object.fromEntries(Object.entries(group).map(([field, record]) => [
      field,
      record.unavailable ? null : sumExact(record.values),
    ])),
  }));
};

const buildSummary = (transfers, exceptions, coverage) => {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const byClassification = {};
  const costClassifications = {};
  for (const exception of exceptions) {
    bySeverity[exception.severity] += 1;
    byClassification[exception.code] = (byClassification[exception.code] || 0) + 1;
  }
  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      for (const evidence of line.costEvidence?.classifications || []) {
        costClassifications[evidence.classification] = (costClassifications[evidence.classification] || 0) + 1;
      }
    }
  }

  const transferIds = new Set(transfers.map((transfer) => transfer.transferId));
  const excludedIds = new Set();
  for (const exception of exceptions.filter((item) => item.code === "DUPLICATE_TRANSFER_IDENTIFIER")) {
    if (exception.transferId) excludedIds.add(exception.transferId);
    exception.relatedTransferIds.forEach((id) => excludedIds.add(id));
  }
  const unavailableTransferIds = new Set();
  for (const exception of exceptions) {
    const ids = [exception.transferId, ...exception.relatedTransferIds].filter(Boolean);
    ids.filter((id) => !transferIds.has(id)).forEach((id) => unavailableTransferIds.add(id));
  }

  let costCompleteTransfers = 0;
  let costPartialTransfers = 0;
  let costUnresolvedTransfers = 0;
  let costNotApplicableTransfers = 0;
  for (const transfer of transfers) {
    const statuses = transfer.lines.map((line) => line.costEvidence?.status || "UNRECONCILED");
    if (!statuses.length || statuses.every((status) => status === "NOT_APPLICABLE")) {
      costNotApplicableTransfers += 1;
    } else if (statuses.some((status) => status === "UNRECONCILED" || status === "MISSING")) {
      costUnresolvedTransfers += 1;
    } else if (statuses.some((status) => status === "PARTIAL")) {
      costPartialTransfers += 1;
    } else if (statuses.some((status) => status === "COVERED") &&
        statuses.every((status) => status === "COVERED" || status === "NOT_APPLICABLE")) {
      costCompleteTransfers += 1;
    } else {
      costUnresolvedTransfers += 1;
    }
  }

  const uncostedBySku = new Map();
  let uncostedQuantityUnavailable = 0;
  const transferLineSku = new Map();
  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      if (line.transferLineId) transferLineSku.set(line.transferLineId, line.inventorySkuId);
    }
  }
  for (const exception of exceptions.filter((item) => item.code === "UNCOSTED_TRANSFER_QUANTITY")) {
    const inventorySkuId = exception.transferLineId
      ? transferLineSku.get(exception.transferLineId) || null
      : null;
    const quantity = exactIntegerBigInt(exception.actualQuantity, "uncosted actualQuantity");
    if (quantity === null || !inventorySkuId) {
      uncostedQuantityUnavailable += 1;
      continue;
    }
    const group = uncostedBySku.get(inventorySkuId) || { quantity: 0n, exceptionCount: 0 };
    group.quantity += quantity;
    group.exceptionCount += 1;
    uncostedBySku.set(inventorySkuId, group);
  }

  return {
    transfersEvaluated: transfers.length,
    transfersExcludedOrUnavailable: [...new Set([...excludedIds, ...unavailableTransferIds])]
      .filter((id) => !transferIds.has(id)).length,
    transferCountUnavailable: coverage.sourceCoverage.sources.transfers !== "COMPLETE",
    completeComparisons: transfers.filter((transfer) => transfer.comparisonStatus === "COMPLETE").length,
    incompleteComparisons: transfers.filter((transfer) => transfer.comparisonStatus === "INCOMPLETE").length,
    exceptions: {
      total: exceptions.length,
      bySeverity,
      byClassification: Object.fromEntries(Object.entries(byClassification).sort(([left], [right]) => compareText(left, right))),
    },
    possibleDuplicateGroups: byClassification.POSSIBLE_DUPLICATE_TRANSFER || 0,
    duplicateIntegrityConflicts: exceptions.filter((item) =>
      ["DUPLICATE_TRANSFER_IDENTIFIER", "TRANSFER_IDEMPOTENCY_CONFLICT"].includes(item.code)
    ).length,
    costEvidence: {
      completeTransfers: costCompleteTransfers,
      partialTransfers: costPartialTransfers,
      unresolvedTransfers: costUnresolvedTransfers,
      notApplicableTransfers: costNotApplicableTransfers,
      classificationCounts: Object.fromEntries(
        Object.entries(costClassifications).sort(([left], [right]) => compareText(left, right))
      ),
      explicitlyUncostedByInventorySku: [...uncostedBySku.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([inventorySkuId, value]) => ({
          inventorySkuId,
          quantity: value.quantity.toString(),
          exceptionCount: value.exceptionCount,
        })),
      uncostedQuantityUnavailable,
    },
    quantityTotalsByInventorySku: quantityTotalsByVariant(transfers),
  };
};

const sourceRecordIdsFor = (exception) => [...new Set([
  exception.transferId,
  exception.transferLineId,
  exception.shipmentId,
  exception.shipmentLineId,
  exception.receiptId,
  exception.receiptLineId,
  ...exception.relatedTransferIds,
  ...exception.relatedShipmentIds,
  ...exception.discrepancyIds,
  ...exception.ledgerEntryIds,
].filter(Boolean))].sort(compareText);

const limitationsFor = (outcome, coverage, transfers, exceptions) => {
  const limitations = new Set([
    "This export formats only the supplied reconciliation result; it does not load or verify persisted records.",
    "A deterministic report is not evidence of physical inventory, legal title, or accounting valuation.",
    "Quantities are summarized only by inventory SKU; monetary values and COGS are not calculated.",
  ]);
  if (outcome === "RECONCILIATION_INCOMPLETE") {
    limitations.add("At least one comparison or required source is incomplete; absence of exceptions does not establish reconciliation.");
  }
  if (outcome === "DATA_UNAVAILABLE") {
    limitations.add("At least one required source was unavailable; affected values are not represented as zero.");
  }
  if (coverage.sourceCoverage.costLayers !== "COMPLETE") {
    limitations.add("Authoritative cost-layer source coverage is incomplete or was not supplied.");
  }
  if (exceptions.some((item) => item.code === "INSUFFICIENT_EVIDENCE")) {
    limitations.add("Known exceptions include insufficient or ambiguous source evidence.");
  }
  if (transfers.some((transfer) =>
    transfer.lines.some((line) => ["PARTIAL", "UNRECONCILED", "MISSING"].includes(line.costEvidence?.status))
  )) {
    limitations.add("At least one transfer line has partial, missing, or unreconciled cost evidence.");
  }
  return [...limitations].sort(compareText);
};

export const formatStockTransferReconciliationReport = (result) => {
  if (!isRecord(result)) throw new TypeError("Reconciliation result must be an object.");
  if (!OUTCOMES.has(result.reportStatus)) throw new TypeError("Reconciliation reportStatus is unsupported.");
  const coverage = normalizeCoverage(result);
  const transfers = normalizeTransfers(result.transfers);
  const exceptions = normalizeExceptions(result.exceptions);
  const allComparisonsComplete = transfers.every((transfer) => transfer.comparisonStatus === "COMPLETE");

  if (result.reportStatus === "NO_EXCEPTION_DETECTED" &&
      (!coverage.coreComplete || exceptions.length > 0 || !allComparisonsComplete)) {
    throw new TypeError("NO_EXCEPTION_DETECTED requires complete source/comparison coverage and no exceptions.");
  }
  if (result.reportStatus === "EXCEPTION_DETECTED" &&
      (!coverage.coreComplete || exceptions.length === 0 || !allComparisonsComplete)) {
    throw new TypeError("EXCEPTION_DETECTED requires complete comparisons and at least one exception.");
  }
  if (result.reportStatus === "DATA_UNAVAILABLE" && coverage.unavailableSources.length === 0) {
    throw new TypeError("DATA_UNAVAILABLE requires at least one unavailable source identifier.");
  }

  const outcome = result.reportStatus === "EXCEPTION_DETECTED"
    ? "EXCEPTIONS_DETECTED"
    : result.reportStatus;
  const sourceCoverage = coverage.sourceCoverage;
  const summary = buildSummary(transfers, exceptions, coverage);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reconciliationOutcome: outcome,
    sourceCoverage,
    summary,
    transfers,
    exceptions: exceptions.map((exception) => ({
      ...exception,
      sourceRecordIds: sourceRecordIdsFor(exception),
      quantityDifference: exception.expectedQuantity === null || exception.actualQuantity === null
        ? null
        : (BigInt(exception.actualQuantity) - BigInt(exception.expectedQuantity)).toString(),
    })),
    limitations: limitationsFor(outcome, coverage, transfers, exceptions),
  };
};

const canonicalizeJson = (value, path = "$") => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(`${path} contains an unsafe integer; use an exact integer string.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    if (value.constructor !== Object && Object.getPrototypeOf(value) !== null) {
      if (value.constructor?.name === "Decimal" && /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(String(value))) {
        return String(value);
      }
      throw new TypeError(`${path} contains an unsupported object type.`);
    }
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => {
      if (value[key] === undefined) throw new TypeError(`${path}.${key} is undefined.`);
      return [key, canonicalizeJson(value[key], `${path}.${key}`)];
    }));
  }
  throw new TypeError(`${path} contains an unsupported value.`);
};

const validateFormattedReport = (report) => {
  if (!isRecord(report) || report.schemaVersion !== REPORT_SCHEMA_VERSION ||
      !REPORT_OUTCOMES.has(report.reconciliationOutcome) ||
      !isRecord(report.summary) || !Array.isArray(report.transfers) ||
      !Array.isArray(report.exceptions) || !isRecord(report.sourceCoverage)) {
    throw new TypeError("Formatted reconciliation report is malformed or has an unsupported schema version.");
  }
  canonicalizeJson(report);
  return report;
};

export const serializeStockTransferReconciliationReportJson = (report) =>
  JSON.stringify(canonicalizeJson(validateFormattedReport(report)));

const csvText = (value) => {
  const text = value === null || value === undefined ? "UNAVAILABLE" : String(value);
  const protectedText = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
};
const csvExactQuantity = (value) => {
  const text = value === null || value === undefined ? "UNAVAILABLE" : String(value);
  if (text !== "UNAVAILABLE" && !/^-?(0|[1-9]\d*)$/.test(text)) {
    throw new TypeError("CSV quantity values must be exact integer text or unavailable.");
  }
  return `"${text}"`;
};
const csvQuantity = (value) => value === null || value === undefined ? "UNAVAILABLE" : String(value);
const csvDifference = (expected, actual) => (
  expected === null || actual === null
    ? "UNAVAILABLE"
    : (BigInt(actual) - BigInt(expected)).toString()
);
const csvHeaders = [
  "Report outcome",
  "Transfer identifier",
  "Product variant identifier",
  "Source location",
  "Destination location",
  "Exception code",
  "Severity",
  "Expected quantity",
  "Actual quantity",
  "Difference (actual - expected)",
  "Cost-evidence classification",
  "Source evidence identifiers",
  "Explanation",
];

export const serializeStockTransferReconciliationReportCsv = (report) => {
  validateFormattedReport(report);
  const transfersById = new Map(report.transfers.map((transfer) => [transfer.transferId, transfer]));
  const lineById = new Map();
  for (const transfer of report.transfers) {
    for (const line of transfer.lines) {
      if (line.transferLineId) lineById.set(line.transferLineId, { transfer, line });
    }
  }
  const rows = [];
  const exceptionsByLine = new Map();
  for (const exception of report.exceptions) {
    const lineId = exception.transferLineId;
    const linked = lineId ? lineById.get(lineId) : null;
    const transfer = linked?.transfer ||
      (exception.transferId ? transfersById.get(exception.transferId) : null);
    if (lineId) {
      const linkedExceptions = exceptionsByLine.get(lineId) || [];
      linkedExceptions.push(exception);
      exceptionsByLine.set(lineId, linkedExceptions);
    }
    const expected = exception.expectedQuantity;
    const actual = exception.actualQuantity;
    rows.push([
      report.reconciliationOutcome,
      exception.transferId || transfer?.transferId,
      linked?.line.inventorySkuId,
      transfer?.sourceLocationId,
      transfer?.destinationLocationId,
      exception.code,
      exception.severity,
      csvQuantity(expected),
      csvQuantity(actual),
      csvDifference(expected, actual),
      linked?.line.costEvidence
        ? `${linked.line.costEvidence.status};${linked.line.costEvidence.classifications.map((item) =>
          `${item.classification}:${item.quantity ?? "UNAVAILABLE"}`
        ).join(";")}`
        : "UNAVAILABLE",
      JSON.stringify(exception.sourceRecordIds),
      exception.explanation,
    ]);
  }
  for (const transfer of report.transfers) {
    if (!transfer.lines.length) {
      rows.push([
        report.reconciliationOutcome,
        transfer.transferId,
        null,
        transfer.sourceLocationId,
        transfer.destinationLocationId,
        transfer.comparisonStatus === "COMPLETE" ? "NO_EXCEPTION_DETECTED" : "RECONCILIATION_INCOMPLETE",
        "INFO",
        null,
        null,
        null,
        "UNAVAILABLE",
        transfer.transferId,
        transfer.comparisonStatus === "COMPLETE"
          ? "No exception detected for this transfer."
          : "Transfer comparison is incomplete.",
      ]);
      continue;
    }
    for (const line of transfer.lines) {
      if ((exceptionsByLine.get(line.transferLineId) || []).length) continue;
      rows.push([
        report.reconciliationOutcome,
        transfer.transferId,
        line.inventorySkuId,
        transfer.sourceLocationId,
        transfer.destinationLocationId,
        line.comparisonStatus === "COMPLETE" ? "NO_EXCEPTION_DETECTED" : "RECONCILIATION_INCOMPLETE",
        "INFO",
        null,
        null,
        null,
        line.costEvidence
          ? `${line.costEvidence.status};${line.costEvidence.classifications.map((item) =>
            `${item.classification}:${item.quantity ?? "UNAVAILABLE"}`
          ).join(";")}`
          : "UNAVAILABLE",
        JSON.stringify([transfer.transferId, line.transferLineId].filter(Boolean)),
        line.comparisonStatus === "COMPLETE"
          ? "No exception detected for this transfer line."
          : "Transfer-line comparison is incomplete.",
      ]);
    }
  }
  if (!rows.length) {
    rows.push([
      report.reconciliationOutcome,
      null,
      null,
      null,
      null,
      "NO_TRANSFER_ROWS",
      "INFO",
      null,
      null,
      null,
      "UNAVAILABLE",
      null,
      "No transfer rows were evaluated.",
    ]);
  }
  const orderedRows = rows.sort((left, right) =>
    compareText(left[1] || "", right[1] || "") ||
    compareText(left[2] || "", right[2] || "") ||
    compareText(left[5] || "", right[5] || "") ||
    compareText(left[11] || "", right[11] || "")
  );
  return [
    csvHeaders.map(csvText).join(","),
    ...orderedRows.map((row) => row.map((value, index) =>
      [7, 8, 9].includes(index) ? csvExactQuantity(value) : csvText(value)
    ).join(",")),
  ].join("\r\n");
};
