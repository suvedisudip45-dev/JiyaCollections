import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStockTransferReconciliationReport,
  serializeStockTransferReconciliationReportCsv,
  serializeStockTransferReconciliationReportJson,
} from "../services/stockTransferReconciliationReportService.js";
import { reconcileStockTransfers } from "../services/stockTransferReconciliationService.js";

const sourceNames = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];
const completeCoverage = Object.fromEntries(sourceNames.map((name) => [name, true]));

const makeLine = (overrides = {}) => ({
  transferLineId: "line-1",
  inventorySkuId: "sku-1",
  comparisonStatus: "COMPLETE",
  requestedQuantity: 5,
  authorizedQuantity: 5,
  reservedQuantity: 0,
  dispatchedCounterQuantity: 5,
  dispatchedShipmentQuantity: 5,
  dispatchedLedgerQuantity: 5,
  receivedGoodQuantity: 5,
  receivedDamagedQuantity: 0,
  receivedMissingQuantity: 0,
  receivedReportedQuantity: 5,
  receivedLedgerQuantity: 5,
  authorizedUnshippedQuantity: 0,
  outstandingInTransitQuantity: 0,
  unresolvedDiscrepancyQuantity: 0,
  costEvidence: {
    status: "COVERED",
    dispatchedQuantity: 5,
    authoritativeCostLayerQuantity: 5,
    verifiedReceivedCostQuantity: 5,
    uncostedQuantity: 0,
    classifications: [{
      classification: "AUTHORITATIVE_COST_LAYER",
      quantity: 5,
      evidenceId: "layer-allocation-1",
    }],
  },
  ...overrides,
});

const makeTransfer = (overrides = {}) => ({
  transferId: "transfer-1",
  status: "RECEIVED",
  inventoryOwner: "PLATFORM",
  sourceLocationId: "factory-1",
  destinationLocationId: "distributor-1",
  comparisonStatus: "COMPLETE",
  lines: [makeLine()],
  ...overrides,
});

const makeException = (overrides = {}) => ({
  exceptionKey: "exception-1",
  code: "QUANTITY_MISMATCH",
  severity: "MEDIUM",
  transferId: "transfer-1",
  transferLineId: "line-1",
  discrepancyIds: [],
  ledgerEntryIds: ["ledger-1"],
  expectedQuantity: 5,
  actualQuantity: 4,
  explanation: "Reported quantity differs.",
  investigationStatus: "REQUIRES_INVESTIGATION",
  ...overrides,
});

const makeResult = (overrides = {}) => ({
  reportStatus: "NO_EXCEPTION_DETECTED",
  coverage: { ...completeCoverage, costLayers: true, costEvidence: true },
  unavailableSources: [],
  transfers: [makeTransfer()],
  exceptions: [],
  ...overrides,
});

test("formats a complete reconciliation without exceptions", () => {
  const report = formatStockTransferReconciliationReport(makeResult());

  assert.equal(report.reconciliationOutcome, "NO_EXCEPTION_DETECTED");
  assert.equal(report.sourceCoverage.status, "COMPLETE");
  assert.equal(report.summary.transfersEvaluated, 1);
  assert.equal(report.summary.completeComparisons, 1);
  assert.equal(report.summary.exceptions.total, 0);
  assert.equal(report.summary.costEvidence.completeTransfers, 1);
  assert.equal(report.summary.quantityTotalsByInventorySku[0].dispatchedShipmentQuantity, "5");
});

test("formats exceptions and their source identifiers", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException()],
  }));

  assert.equal(report.reconciliationOutcome, "EXCEPTIONS_DETECTED");
  assert.equal(report.summary.exceptions.bySeverity.MEDIUM, 1);
  assert.equal(report.summary.exceptions.byClassification.QUANTITY_MISMATCH, 1);
  assert.deepEqual(report.exceptions[0].sourceRecordIds, ["ledger-1", "line-1", "transfer-1"]);
  assert.equal(report.exceptions[0].quantityDifference, "-1");
});

test("incomplete coverage remains incomplete even with no exceptions", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "RECONCILIATION_INCOMPLETE",
    coverage: { ...completeCoverage, shipments: false, costLayers: false },
    transfers: [makeTransfer({ comparisonStatus: "INCOMPLETE", lines: [makeLine({ comparisonStatus: "INCOMPLETE" })] })],
  }));

  assert.equal(report.reconciliationOutcome, "RECONCILIATION_INCOMPLETE");
  assert.equal(report.sourceCoverage.status, "INCOMPLETE");
  assert.equal(report.summary.exceptions.total, 0);
  assert.ok(report.limitations.some((item) => item.includes("absence of exceptions")));
});

test("data-unavailable status and source identity are preserved", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "DATA_UNAVAILABLE",
    unavailableSources: ["ledgerEntries"],
    exceptions: [makeException({
      exceptionKey: "source-unavailable",
      code: "INSUFFICIENT_EVIDENCE",
      transferLineId: null,
    })],
  }));

  assert.equal(report.reconciliationOutcome, "DATA_UNAVAILABLE");
  assert.deepEqual(report.sourceCoverage.unavailableSources, ["ledgerEntries"]);
  assert.equal(report.sourceCoverage.status, "DATA_UNAVAILABLE");
});

test("known exceptions and incomplete evidence are reported together", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "RECONCILIATION_INCOMPLETE",
    coverage: { ...completeCoverage, receipts: false },
    transfers: [makeTransfer({ comparisonStatus: "INCOMPLETE", lines: [makeLine({ comparisonStatus: "INCOMPLETE" })] })],
    exceptions: [makeException()],
  }));

  assert.equal(report.reconciliationOutcome, "RECONCILIATION_INCOMPLETE");
  assert.equal(report.summary.exceptions.total, 1);
  assert.equal(report.summary.incompleteComparisons, 1);
});

test("duplicate integrity conflicts and possible duplicate groups are counted distinctly", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [
      makeException({
        exceptionKey: "dup-identifier",
        code: "DUPLICATE_TRANSFER_IDENTIFIER",
        relatedTransferIds: ["transfer-2", "transfer-1"],
      }),
      makeException({
        exceptionKey: "idempotency-conflict",
        code: "TRANSFER_IDEMPOTENCY_CONFLICT",
      }),
      makeException({
        exceptionKey: "possible-duplicate",
        code: "POSSIBLE_DUPLICATE_TRANSFER",
        severity: "LOW",
        relatedTransferIds: ["transfer-2"],
      }),
    ],
  }));

  assert.equal(report.summary.possibleDuplicateGroups, 1);
  assert.equal(report.summary.duplicateIntegrityConflicts, 2);
  assert.equal(report.summary.transfersExcludedOrUnavailable, 1);
});

test("all supported cost-evidence classifications are retained", () => {
  const classifications = [
    "AUTHORITATIVE_COST_LAYER",
    "VERIFIED_RECEIVED_COST",
    "HISTORICAL_COST_SNAPSHOT",
    "REFERENCE_OR_CATALOG_COST",
    "ESTIMATE",
    "UNRECONCILED",
    "MISSING",
  ];
  const report = formatStockTransferReconciliationReport(makeResult({
    transfers: [makeTransfer({
      lines: [makeLine({
        costEvidence: {
          status: "PARTIAL",
          classifications: classifications.map((classification) => ({ classification, quantity: 1 })),
        },
      })],
    })],
  }));

  assert.deepEqual(
    report.transfers[0].lines[0].costEvidence.classifications.map((item) => item.classification),
    classifications.slice().sort()
  );
  assert.equal(report.summary.costEvidence.classificationCounts.MISSING, 1);
  assert.equal(report.summary.costEvidence.partialTransfers, 1);
});

test("explicit uncosted quantity is grouped by SKU without monetary interpretation", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [
      makeException({
        exceptionKey: "uncosted-1",
        code: "UNCOSTED_TRANSFER_QUANTITY",
        actualQuantity: 2,
      }),
    ],
  }));

  assert.deepEqual(report.summary.costEvidence.explicitlyUncostedByInventorySku, [{
    inventorySkuId: "sku-1",
    quantity: "2",
    exceptionCount: 1,
  }]);
});

test("multiple exceptions for one transfer are ordered and retained as distinct details", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [
      makeException({ exceptionKey: "b", code: "BALANCE_MISMATCH", severity: "HIGH" }),
      makeException({ exceptionKey: "a", code: "QUANTITY_MISMATCH", severity: "MEDIUM" }),
    ],
  }));

  assert.deepEqual(report.exceptions.map((item) => item.exceptionKey), ["b", "a"]);
});

test("report ordering and JSON object ordering are stable", () => {
  const first = makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [
      makeException({ exceptionKey: "b", code: "Z_EXCEPTION" }),
      makeException({ exceptionKey: "a", code: "A_EXCEPTION" }),
    ],
    transfers: [
      makeTransfer({ transferId: "transfer-b", lines: [makeLine({ transferLineId: "line-b" })] }),
      makeTransfer({ transferId: "transfer-a", lines: [makeLine({ transferLineId: "line-a" })] }),
    ],
  });
  const second = {
    ...first,
    exceptions: first.exceptions.slice().reverse(),
    transfers: first.transfers.slice().reverse(),
  };

  assert.equal(
    serializeStockTransferReconciliationReportJson(formatStockTransferReconciliationReport(first)),
    serializeStockTransferReconciliationReportJson(formatStockTransferReconciliationReport(second))
  );
});

test("JSON export is byte-for-byte deterministic for repeated calls", () => {
  const report = formatStockTransferReconciliationReport(makeResult());
  assert.equal(
    serializeStockTransferReconciliationReportJson(report),
    serializeStockTransferReconciliationReportJson(report)
  );
});

test("JSON export uses the exact canonical representation", () => {
  const report = {
    schemaVersion: "1.0",
    reconciliationOutcome: "NO_EXCEPTION_DETECTED",
    sourceCoverage: { status: "COMPLETE" },
    summary: {},
    transfers: [],
    exceptions: [],
  };

  assert.equal(
    serializeStockTransferReconciliationReportJson(report),
    '{"exceptions":[],"reconciliationOutcome":"NO_EXCEPTION_DETECTED","schemaVersion":"1.0","sourceCoverage":{"status":"COMPLETE"},"summary":{},"transfers":[]}'
  );
});

test("CSV output quotes comma-containing values", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ explanation: "Mismatch, review required." })],
  }));

  assert.match(serializeStockTransferReconciliationReportCsv(report), /"Mismatch, review required\."/);
});

test("CSV output doubles embedded quotes", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ explanation: 'Reported "good" quantity differs.' })],
  }));

  assert.match(serializeStockTransferReconciliationReportCsv(report), /Reported ""good"" quantity differs\./);
});

test("CSV output preserves embedded line breaks inside a quoted cell", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ explanation: "First line\r\nSecond line" })],
  }));

  assert.match(serializeStockTransferReconciliationReportCsv(report), /"First line\r\nSecond line"/);
});

test("CSV text fields receive formula-injection protection", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ explanation: "=HYPERLINK(\"bad\")" })],
  }));
  const csv = serializeStockTransferReconciliationReportCsv(report);

  assert.ok(csv.includes(`"'=HYPERLINK(""bad"")`));
});

test("CSV preserves generated negative quantity differences as exact numeric text", () => {
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ expectedQuantity: 5, actualQuantity: 4 })],
  }));
  const csv = serializeStockTransferReconciliationReportCsv(report);

  assert.ok(csv.includes('"5","4","-1"'));
});

test("missing optional fields remain explicitly unavailable", () => {
  const input = makeResult({
    transfers: [makeTransfer({
      lines: [makeLine({ costEvidence: undefined })],
    })],
    exceptions: [makeException({
      relatedTransferIds: undefined,
      relatedShipmentIds: undefined,
      discrepancyIds: undefined,
      ledgerEntryIds: undefined,
      investigationStatus: undefined,
    })],
    reportStatus: "EXCEPTION_DETECTED",
  });
  const report = formatStockTransferReconciliationReport(input);

  assert.equal(report.transfers[0].lines[0].costEvidence, null);
  assert.deepEqual(report.exceptions[0].discrepancyIds, []);
  assert.equal(report.summary.costEvidence.unresolvedTransfers, 1);
  assert.doesNotThrow(() => serializeStockTransferReconciliationReportCsv(report));
});

test("unsupported and inconsistent results produce explicit validation errors", () => {
  assert.throws(() => formatStockTransferReconciliationReport({ reportStatus: "SUCCESS" }), /reportStatus/);
  assert.throws(() => formatStockTransferReconciliationReport(makeResult({
    coverage: { ...completeCoverage, balances: undefined },
  })), /Coverage for balances/);
  assert.throws(() => formatStockTransferReconciliationReport(makeResult({
    reportStatus: "NO_EXCEPTION_DETECTED",
    coverage: { ...completeCoverage, transfers: false },
  })), /requires complete source/);
  assert.throws(() => formatStockTransferReconciliationReport(makeResult({
    reportStatus: "NO_EXCEPTION_DETECTED",
    transfers: [makeTransfer({
      lines: [makeLine({ comparisonStatus: "INCOMPLETE" })],
    })],
  })), /conflicts with its line comparisons/);
  assert.throws(() => serializeStockTransferReconciliationReportJson({
    schemaVersion: "99.0",
    reconciliationOutcome: "NO_EXCEPTION_DETECTED",
    sourceCoverage: {},
    summary: {},
    transfers: [],
    exceptions: [],
  }), /unsupported schema version/);
});

test("invalid non-finite quantities and unsupported cost classifications are rejected", () => {
  assert.throws(() => formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ actualQuantity: Number.NaN })],
  })), /exact integer/);
  assert.throws(() => formatStockTransferReconciliationReport(makeResult({
    transfers: [makeTransfer({
      lines: [makeLine({
        costEvidence: {
          status: "COVERED",
          classifications: [{ classification: "INVENTED_CLASS", quantity: 1 }],
        },
      })],
    })],
  })), /classification is unsupported/);
});

test("large integer quantities remain exact through report, JSON, and CSV", () => {
  const exact = "900719925474099312345";
  const report = formatStockTransferReconciliationReport(makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ expectedQuantity: exact, actualQuantity: "900719925474099312346" })],
  }));
  const json = serializeStockTransferReconciliationReportJson(report);
  const csv = serializeStockTransferReconciliationReportCsv(report);

  assert.equal(report.exceptions[0].quantityDifference, "1");
  assert.ok(json.includes(`"expectedQuantity":"${exact}"`));
  assert.ok(csv.includes(`"${exact}"`));
});

test("formatting and export do not mutate calculator results", () => {
  const result = makeResult({
    reportStatus: "EXCEPTION_DETECTED",
    exceptions: [makeException({ relatedTransferIds: ["transfer-2"] })],
  });
  const before = structuredClone(result);

  const report = formatStockTransferReconciliationReport(result);
  serializeStockTransferReconciliationReportJson(report);
  serializeStockTransferReconciliationReportCsv(report);
  assert.deepEqual(result, before);
});

test("formatter accepts the calculator's P5-R16/P5-R17 output contract", () => {
  const result = reconcileStockTransfers({
    transfers: [],
    shipments: [],
    receipts: [],
    discrepancies: [],
    ledgerEntries: [],
    balances: [],
    locations: [],
    coverage: completeCoverage,
  });

  assert.equal(result.reportStatus, "NO_EXCEPTION_DETECTED");
  assert.equal(formatStockTransferReconciliationReport(result).reconciliationOutcome, "NO_EXCEPTION_DETECTED");
});
