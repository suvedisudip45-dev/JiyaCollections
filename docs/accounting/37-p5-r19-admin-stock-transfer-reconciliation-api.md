# P5-R19 — Admin Stock-Transfer Reconciliation Reader API

**Status:** Implemented in code; mocked source-loader and synthetic unit-test evidence only
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**
**Evidence boundary:** This is a bounded, read-only API over a page of persisted source records. It is not a full-population or persisted reconciliation, physical count, verified valuation, or accounting validation.

## 1. Route and authorization

The endpoint is:

```text
GET /api/admin/accounting/stock-transfer-reconciliation
```

It is mounted in `backend/server.js` and implemented by `backend/routes/adminStockTransferReconciliationRoute.js` and `backend/controllers/stockTransferReconciliationController.js`. Middleware order is authentication, `ADMIN` role, and `inventory:ledger_read`. This permission already exists in the permission catalog and Admin role mapping; no new permission grant was added.

Successful requests are access-audited with action `ADMIN_STOCK_TRANSFER_RECONCILIATION_READ` through the existing system audit outbox. Access-audit failure is logged and does not change the read result. This audit event is the only intended write associated with report access; the endpoint does not update inventory, stock transfers, costs, or financial records.

## 2. Query and page contract

Supported query parameters:

- `from` and `to`: both required together, valid timestamps, a positive range no longer than 90 days.
- `sourceLocationId`, `destinationLocationId`, `distributorId`, `inventorySkuId`.
- `status`: an existing stock-transfer status.
- `limit`: positive integer, default 25, maximum 50.
- `cursor`: opaque, versioned cursor bound to the normalized filters.
- `exceptionCode` and `severity`: filter exception detail rows after reconciliation; summary counts remain for the full selected page.
- `format`: `json` (default) or `csv`.

Transfers are ordered by `requestedAt` descending and ID descending. The loader fetches one extra transfer to determine whether another page exists. Each request loads its source page inside a Prisma `RepeatableRead` transaction; separate pages do not share a database snapshot. A cursor is rejected if it is malformed or used with different filters.

The API's scope is one page, not the entire filtered transfer population. If `hasMore` is true, the transfer source is marked incomplete so cross-page possible-duplicate detection cannot be mistaken for a full-scope negative result. Summary counts and exceptions describe the computed page; `scope.hasMore`, `pagination`, and `scope.coreSourceCoverageComplete` expose the page boundary for the core stock-reconciliation sources. Optional cost-evidence coverage remains separate in `sourceCoverage`.

## 3. Source loading and limits

`backend/services/stockTransferReconciliationDataService.js` supplies bounded, explicitly selected records to the existing `reconcileStockTransfers(input)` calculator and then to the P5-R18 report formatter. The loader does not independently calculate a reconciliation.

Bounds are fixed in the loader: at most 50 transfers per page, 200 lines per transfer, 2,000 related rows per source read, 5,000 ledger rows, 1,000 location rows, and 500 location/SKU history pairs. A cap, failed read, or failed snapshot marks the affected source incomplete or unavailable. Coverage dependencies are propagated: failed or truncated shipment/receipt reads cannot leave dependent receipt, discrepancy, ledger, location, balance, or cost-layer coverage marked complete.

Ledger history is loaded for affected location/SKU pairs to compare current balances against movement history. Product combinations are bounded; if the pair cap is exceeded, balance and ledger-history coverage is incomplete. Only `DISPATCHED` shipment-line cost-layer allocations are provided as authoritative dispatch linkage. Catalog/reference cost, historical cost snapshots, or other supplemental cost evidence are not inferred by this endpoint; `costEvidence` coverage remains explicitly incomplete/unavailable unless supplied by a future supported source.

The calculator preserves exact Prisma `Int` quantity semantics and the P5-R17 duplicate/cost evidence rules. The formatter retains P5-R18 JSON/CSV validation and deterministic serialization. Exception-code/severity filters affect detailed rows identically for JSON and CSV but do not recalculate summary counts.

## 4. Response and outcome semantics

Responses preserve the formatter outcomes:

- `NO_EXCEPTION_DETECTED`
- `EXCEPTIONS_DETECTED`
- `RECONCILIATION_INCOMPLETE`
- `DATA_UNAVAILABLE`

Incomplete coverage is not promoted to a successful reconciliation. A report may show both exceptions and incomplete evidence. On source-read failure the API returns HTTP 503 with the report outcome and an explicit error code; malformed filters/cursors return HTTP 400. `success` describes whether the report could be generated from available sources, not whether the transfers reconcile without exceptions. `reportStatus` and `X-Report-Outcome` carry the reconciliation outcome.

JSON and CSV carry the same filtered exception-detail set. JSON uses the P5-R18 deterministic serializer. CSV uses the formatter's escaping and spreadsheet formula-injection mitigation. No export is written to disk.

## 5. Safety and known limitations

- The endpoint is read-only for inventory, transfer, cost, and accounting data. It creates no ledger movements, reservations, cost allocations, COGS, receivables, or accounting journals.
- Distributor-held inventory ownership is not changed; transfer custody movements are not sales or COGS events.
- A page-level result cannot establish full-population completeness or detect a possible duplicate on another page. Separate pages may observe different database snapshots.
- The database schema does not provide direct shipment-line foreign keys on ledger entries for every movement. The loader uses existing reference types and movement history and does not fabricate missing links.
- Missing/unloaded cost evidence is not zero value. No valuation, COGS, or authoritative historical-cost conclusion is produced.
- Database-backed validation, authorization against persisted assignments, physical inventory verification, complete source-population checks, and operational performance under production volumes remain unverified. No isolated database target was configured for this increment, so no database connection or database-backed test was attempted.
- This endpoint is a read API only. No Admin UI, correction workflow, duplicate cancellation, automatic reconciliation write, schema change, or migration is included.

## 6. Validation record

Focused mocked tests cover bounded query parsing, filter-bound cursors, page completeness, exception filters for JSON/CSV, unavailable source handling, access auditing, Admin-role/permission denial and allow paths, repeatable-read transaction options, source-coverage dependency failures, cost-allocation evidence selection, actual calculator/formatter response serialization, and read-only query behavior. The API/source-loader plus P5-R16/P5-R17 calculator and P5-R18 formatter suites passed **89/89**. The expanded set including stock-transfer, inventory-ledger, and inventory-valuation regressions passed **118/118** across seven test files. `node --check` passed for the new service, controller, route, both new test files, and `server.js`; `git diff --check` passed. No backend lint script is defined. Tests used mocks and synthetic data; no database or external access occurred.

P5-R19 is **IMPLEMENTED IN CODE; MOCKED/SYNTHETIC TEST EVIDENCE ONLY**. Phase 5 remains partial/incomplete. Phase 4 remains incomplete; Phase 6 and Phase 7 were not started.

P6-R3F separately documents the bounded stock-transfer receipt lifecycle and
hardening gaps in
[12-p6-r3f-stock-transfer-receipt-hardening-readiness.md](../phase-6/12-p6-r3f-stock-transfer-receipt-hardening-readiness.md).
P6-R3F adds no reconciliation writes or persisted receipt hardening. P5-R19
continues to be read-only and page-scoped.
