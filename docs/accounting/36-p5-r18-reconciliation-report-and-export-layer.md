# P5-R18 — Deterministic Stock Reconciliation Report and Export Layer

**Status:** Implemented in code; synthetic unit-test evidence only  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**  
**Evidence boundary:** This is a formatter over a supplied calculator result. It is not a live Admin report, persisted reconciliation, physical count, or accounting validation.

## 1. Module and interface

`backend/services/stockTransferReconciliationReportService.js` exports:

```js
formatStockTransferReconciliationReport(result)
serializeStockTransferReconciliationReportJson(report)
serializeStockTransferReconciliationReportCsv(report)
```

Call `formatStockTransferReconciliationReport` with the already-computed output of `reconcileStockTransfers(input)`. The JSON and CSV functions take that normalized report. The formatter does not call the calculator again. It has no Prisma import, database/network/filesystem access, clock read, random identifier, inventory mutation, or financial side effect.

The formatter validates required result structure, core source coverage booleans, outcome/status values, identifiers, exception details, cost classifications, and exact integer quantities. Unsupported or inconsistent inputs throw `TypeError`; they are not silently repaired. Missing optional cost evidence and optional source ID arrays remain explicitly unavailable/empty in the normalized output.

## 2. Report schema

The normalized report contains:

- `schemaVersion: "1.0"`.
- `reconciliationOutcome`.
- `sourceCoverage`: per-core-source `COMPLETE`/`INCOMPLETE`, aggregate source status, unavailable source IDs, and separate cost-layer/cost-evidence coverage (`COMPLETE`, `INCOMPLETE`, or `UNKNOWN`).
- `summary`: evaluated, excluded/unavailable, complete, and incomplete transfer counts; exception counts by severity and code; possible duplicate groups; duplicate integrity conflicts; cost-evidence counts/classification counts; explicitly uncosted quantities grouped by inventory SKU; and safe quantity totals by inventory SKU.
- Deterministically ordered transfer and line summaries, including exact quantity strings and cost-evidence details.
- Detailed exceptions with normalized source record identifiers and exact quantity difference (`actual - expected`) when both sides are known.
- Explicit, deterministic limitations.

Quantity values are emitted as decimal strings or `null` when unavailable. Aggregate quantities are grouped by inventory SKU and metric; if any component for an aggregate is unavailable, that aggregate is `null`. No totals combine different SKUs, monetary values, or COGS.

`transfersExcludedOrUnavailable` counts identifiable transfer IDs not present in the evaluated transfer summaries. `transferCountUnavailable` separately signals that the transfer source itself was not declared complete.

## 3. Outcome and coverage semantics

The formatter maps calculator `EXCEPTION_DETECTED` to report `EXCEPTIONS_DETECTED`. It preserves:

- `NO_EXCEPTION_DETECTED` only for complete required source and transfer comparisons with no exceptions.
- `EXCEPTIONS_DETECTED` when completed comparisons produce one or more exceptions.
- `RECONCILIATION_INCOMPLETE` when required comparisons/source coverage are incomplete; known exceptions remain present and counted.
- `DATA_UNAVAILABLE` when the calculator identifies unavailable source records.

An inconsistent `NO_EXCEPTION_DETECTED` or `EXCEPTION_DETECTED` result is rejected. Empty exceptions alone do not establish completeness. The calculator's core stock-reconciliation outcome remains distinct from optional cost-source coverage; incomplete/unknown cost coverage is shown separately and as a report limitation, not converted into a stock or financial exception.

Cost transfer counts are mutually exclusive: complete means at least one covered line and all applicable lines are covered; partial means at least one line is partial and none is unresolved; unresolved includes missing or unreconciled evidence; transfers with no applicable cost evidence are counted separately. Classification counts count supplied classification records, not cost amounts.

## 4. JSON export

JSON serialization sorts object keys lexically and normalizes array order before serialization. BigInt and supported Decimal values serialize as strings; unsafe integer Numbers, non-finite numbers, `undefined`, unsupported object types, and unsupported schema versions throw. No timestamp or random identifier is generated. The same normalized report produces byte-for-byte identical JSON.

## 5. CSV export

CSV uses fixed headers, CRLF row separators, and quotes every cell; embedded quotes are doubled and commas/line breaks remain inside quoted cells. Unavailable cells use the literal `UNAVAILABLE`. Quantity cells are validated as exact integer text and are not converted to JavaScript `Number`; the difference column is exact `actual - expected`.

Text cells whose first non-whitespace character is `=`, `+`, `-`, `@`, tab, or carriage return receive a leading apostrophe before CSV quoting. This spreadsheet formula-injection mitigation follows the existing audit-export convention. Numeric quantity cells are separately validated and emitted unchanged, including negative differences; untrusted text identifiers and explanations always pass through the mitigation.

The row strategy is one row per exception. A transfer line without a line-level exception receives a deterministic no-exception or incomplete-comparison row; a transfer without lines receives one transfer-level row. A transfer with multiple line exceptions therefore has multiple rows. Transfer-level exceptions do not suppress the line rows. Source identifiers are represented as a JSON array within the CSV cell to preserve identifier boundaries. Exception text is not truncated.

## 6. Limits and deferred checks

- The formatter trusts the supplied calculator result and cannot establish source-query completeness, transaction snapshot consistency, physical custody, or correctness of persisted values.
- Transfer dispatch/receipt linkage limits, missing historical/opening-ledger coverage, and cost-layer population gaps remain those documented in P5-R16/P5-R17.
- Cost classifications report evidence coverage only; no cost, valuation, COGS, title transfer, liability, or accounting posting is calculated.
- Duplicate groups remain review candidates, not proof; no transfer is merged, canceled, or corrected.
- No API endpoint, Admin UI, file-writing export, database access, schema change, migration, stock change, or financial mutation is part of P5-R18.

Synthetic tests are in `backend/tests/stockTransferReconciliationReportService.test.js`. They cover outcomes, summary semantics, cost classifications, ordering, exact deterministic JSON, CSV quoting/formula protection, large integer quantities, validation, compatibility with calculator output, and input immutability. The formatter suite passed **23/23**; the combined formatter, calculator, stock-transfer-service, inventory-ledger-service, and inventory-valuation-reconciliation suites passed **105/105**. `node --check` passed for the formatter, formatter tests, calculator, and calculator tests; `git diff --check` passed. The backend package defines no lint script. Tests used synthetic data only. P5-R18 is **IMPLEMENTED IN CODE; SYNTHETIC UNIT TEST EVIDENCE ONLY**. Phase 5 remains partial/incomplete; Phase 4 remains incomplete; Phase 6 and Phase 7 were not started.
