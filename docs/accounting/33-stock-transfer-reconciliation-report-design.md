# P5-R15 — Stock Transfer Reconciliation: Exception Report Design

**Review date:** 2026-11-17
**Status:** **COMPLETE FOR STATIC WORKFLOW TRACE AND REPORT DESIGN ONLY**
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.

## 1. Scope and evidence boundary

This design specifies a deterministic, read-only exception report for the supported company-stock transfer lifecycle into distributor custody. It builds on P5-R13 and P5-R14 and the P5-R7 inventory/COGS evidence audit. Repository inspection confirms code paths, not deployment, persisted data, physical quantities, or legal title. No database or external provider was accessed.

The governing policy is that Aama Clothings owns inventory transferred to distributors; the distributor is a custodian. Dispatch and receipt are location/custody movements, not a sale. Distributor custody differences do not by themselves establish distributor liability, an expense, or a journal entry.

### Confirmed implementation surface

| Stage | Actual route and code path | Records and transactional behavior |
|---|---|---|
| Request creation | `POST /api/stock-transfers/requests` and the distributor alias `POST /api/distributor/stock-requests` → `createStockTransferRequest` in `backend/controllers/stockTransferController.js`. | A Serializable transaction checks an active distributor, active manufacturer/SKUs, a PLATFORM-owned factory location, available factory `InventoryBalance`, and distributor destination. Creates `StockTransfer` and unique-SKU `StockTransferLine` rows. `evaluateStockTransferAutoApproval` can set `APPROVED` with reviewer `SYSTEM_AUTO_POLICY`; otherwise the transfer starts `PENDING_ADMIN_APPROVAL`. Transfer creation has no request idempotency key. |
| Authorization / rejection | `PATCH /api/stock-transfers/admin/:id/review` → `reviewStockTransferRequest`. | A Serializable transaction permits only pending requests. Approval writes `approvedQuantity` on every line after checking factory availability, then marks `APPROVED` with reviewer/time. Rejection sets each approved quantity to zero and status `REJECTED`. A separate auto-approval policy path is also an authorization source. |
| Preparation / edits | `PATCH /api/stock-transfers/:id/preparation` → `updateStockTransferPreparation`; distributor, manufacturer, and Admin edit routes → `editStockTransferRequest`. | Preparation is limited to approved, pre-shipment transfers. Editing is limited to pre-shipment states; it resets review/preparation data and replaces transfer lines in a Serializable transaction. It is not a post-dispatch correction path. |
| Shipment booking and dispatch | `POST /api/manufacturer/stock-requests/:id/dispatch` → `dispatchStockTransferRequest`, which selects own-store, NCM, or local dispatch by request method. Separately, `POST /api/stock-transfers/:id/dispatch` maps directly to `dispatchManualStockTransfer`; `POST /api/stock-transfers/:id/ncm-booking` maps to `bookNcmStockTransfer`. | Manual and own-store paths create shipment and shipment lines, call `dispatchShipmentStock`, append `TRANSFER_DISPATCH` through `applyInventoryMovement`, increment `StockTransferLine.dispatchedQuantity`, decrement legacy `ManufacturerInventory`, and synchronize the Product projection in the same Serializable transaction. NCM booking first reserves quantities and layers; it does not move on-hand stock until a custody-confirming NCM event is applied by `applyNcmStockTransferWebhook`. NCM calls are an external boundary; none were made for this audit. |
| Receipt confirmation | `POST /api/stock-transfers/shipments/:shipmentId/receipt` → `receiveStockTransferShipment`; distributor alias `POST /api/distributor/stock-requests/:id/receive` → `receiveStockTransferForRequest`. | The caller must provide an idempotency key. A Serializable transaction records `StockTransferReceipt` and lines: good, damaged, and missing quantities. Good stock moves from shipment transit to the distributor location as `TRANSFER_RECEIPT`; damaged and missing quantities move to `DAMAGED`/`LOST` as `DAMAGE`/`LOSS`, with `InventoryDiscrepancy` records. Receipt, movement, balance update, projection sync, and current status update share the transaction. |
| Status and participant views | `GET /api/stock-transfers/admin`, `/manufacturer`, `/distributor`; the distributor alias `GET /api/distributor/inventory`; transfer detail is returned with nested shipment, receipt, discrepancy, and event records. | The transfer lists order by mutable `updatedAt` then `requestedAt`; they are operational views, not a reconciled report. Distributor inventory reads `InventoryBalance` at distributor/damaged locations and reports on-hand, reserved, available, and damaged totals. Manufacturer transfer catalogs read factory balances. There is no general `WAREHOUSE` location kind or confirmed central-warehouse transfer population in the inspected model. |
| Existing ledger reconciliation | `GET /api/admin/inventory-ledger/reconciliation` → `reconcileInventory` → `reconcileInventoryLedger`. | Admin must select an SKU and/or location. It compares current `InventoryBalance.quantityOnHand` with net movement quantities but does not join transfer authorization, shipments, receipts, evidence, ownership, or discrepancy status. It is a useful balance comparison, not this transfer report. |

Mounted paths are configured in `backend/server.js` (`/api/stock-transfers`, `/api/distributor`, and `/api/admin/inventory-ledger`). Route authorization is in `backend/routes/stockTransferRoute.js`, `backend/routes/distributorRoute.js`, and `backend/routes/inventoryLedgerRoute.js`.

### Models and exact references

- `StockTransfer`: `status`, `manufacturerId`, `distributorId`, `sourceLocationId`, `destinationLocationId`, request/review/preparation actors and timestamps, `dispatchedAt`, `completedAt`.
- `StockTransferLine`: `inventorySkuId`, `requestedQuantity`, `approvedQuantity`, mutable `dispatchedQuantity` and `reservedShipmentQuantity`; unique on `(stockTransferId, inventorySkuId)`.
- `StockTransferShipment`: `status`, `bookingMode`, idempotency key/request hash, tracking and external references, carrier, `dispatchedAt`, `deliveredAt`, NCM status and event timestamps.
- `StockTransferShipmentLine`: shipment/transfer-line reference, shipped `quantity`, `uncostedQuantity`; unique on `(shipmentId, stockTransferLineId)`.
- `StockTransferReceipt` / `StockTransferReceiptLine`: receipt actor/time/status/idempotency and per-shipment-line good/damaged/missing quantities, evidence and notes. Receipt lines are unique per `(receiptId, shipmentLineId)`; multiple receipts can account for one shipment line over time.
- `InventoryDiscrepancy`: transfer/shipment/receipt, SKU, reported quantity/type, custody stage, evidence, status and review fields. Its financial-responsibility fields are not proof that responsibility has been approved.
- `InventoryLedgerEntry`: SKU, source/destination location, positive quantity, movement type, `inventoryOwner`, `referenceType`, `referenceId`, cost-layer ID, unique idempotency key, actor/reason, and `createdAt`.
- `InventoryBalance`: unique `(locationId, inventorySkuId)` current on-hand and reserved quantities. `InventoryLocation.inventoryOwner` is expected to remain `PLATFORM`; distributor/manufacturer IDs indicate the location/custodian.

### Actual status semantics and limitations

The schema comments list transfer states `PENDING_ADMIN_APPROVAL`, `APPROVED`, `REJECTED`, `IN_TRANSIT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `DISCREPANCY`, and `CANCELLED`. `deriveTransferStatus` calculates current state from approved remainder, reservations, dispatched counters, receipt totals, and damage/missing counts. In particular, `IN_TRANSIT` can mean a pending shipment reservation or approved quantity still available for dispatch; it is not proof of a dispatch movement.

Shipment statuses include preparation/booking states (`PREPARING`, `BOOKING_PENDING`, `BOOKING_UNKNOWN`, `BOOKING_FAILED`, `BOOKED`), custody/receipt states (`DISPATCHED`, `PARTIALLY_RECEIVED`, `DELIVERED`, `DISCREPANCY`, `LOST`), and `CANCELLED`. Status names are not sufficient evidence on their own: the report must compare recorded quantities and movement links. Own-store delivery performs dispatch and all-good receipt in one transaction without independent carrier evidence. NCM carrier “delivered” does not substitute for distributor receipt.

The `CANCELLED` values appear in schema status comments, but no mounted StockTransfer cancellation operation or controller assignment to `StockTransfer.status = CANCELLED` was found. Admin rejection is pre-dispatch. NCM booking failure releases reservations; an NCM return request records a carrier-return request and does not reverse stock movements. No general dispatch reversal route was found. Do not represent a return request, status edit, or rejected discrepancy as a stock correction.

## 2. Reconciliation population and formulas

### Population and keys

The unit of authorization reconciliation is a `StockTransferLine` (one SKU per transfer). The unit of dispatch/receipt reconciliation is a `StockTransferShipmentLine` and its `StockTransferReceiptLine` records. Compute quantities as safe non-negative whole numbers; preserve separate transfer, shipment, receipt, location, and ledger IDs. Do not group solely by product name, SKU label, transfer status, or `updatedAt`.

For each transfer line \(l\), define:

- \(A_l\): approved quantity. A missing, negative, non-integer, or contradictory value is invalid. Pending/rejected request quantity is not authorized inventory and must not be added to transit.
- \(R_l\): reserved shipment quantity not yet dispatched, derived from booking/shipment records and compared with `reservedShipmentQuantity`. Do not treat it as dispatched.
- \(D^{counter}_l\): mutable `StockTransferLine.dispatchedQuantity`.
- \(D^{shipment}_l\): sum of shipment-line quantities in a dispatch/receipt state (`DISPATCHED`, `PARTIALLY_RECEIVED`, `DELIVERED`, `DISCREPANCY`, or `LOST`) or with receipt rows. `BOOKING_PENDING`, `BOOKING_UNKNOWN`, `BOOKING_FAILED`, and `BOOKED` alone do not prove on-hand dispatch; ambiguous NCM evidence is unresolved, not zero-success.
- \(D^{ledger}_l\): sum of correctly linked `TRANSFER_DISPATCH` entry quantities for the shipment lines. Match the expected source/destination, SKU, `referenceType = STOCK_TRANSFER`, transfer `referenceId`, PLATFORM ownership, and dispatch idempotency-key structure.
- \(G_l\), \(X_l\), \(M_l\): receipt-line totals for good, damaged, and reported missing quantities respectively. \(Q_l = G_l + X_l + M_l\).
- \(T_l = \max(0, D_l - Q_l)\): dispatched quantity with no recorded receipt disposition. This is unresolved transit quantity, not proof of physical carrier custody.
- \(U_l = \max(0, A_l - D^{counter}_l - R_l)\): counter-based approved quantity neither dispatched nor reserved. It is authorized-to-ship remainder, not in-transit stock; call it reconciled only when the dispatch sources agree.

Use the separately sourced values \(D^{counter}\), \(D^{shipment}\), and \(D^{ledger}\) in comparisons; never silently choose one as the truth when they disagree. For a fully matched line, the expected invariants are:

1. `0 <= approvedQuantity <= requestedQuantity`.
2. `0 <= reservedShipmentQuantity`, `0 <= dispatchedQuantity`, and `reservedShipmentQuantity + dispatchedQuantity <= approvedQuantity`.
3. Shipment-line quantities are positive integers and their line total does not exceed approved quantity after accounting for booking reservations.
4. For each shipment line, `0 <= G + X + M <= shipmentLine.quantity`; each receipt row is counted once. Across a transfer line, shipment quantities plus undispatched reservations cannot exceed approved quantity.
5. When quantities and links are complete, `Dcounter = Dshipment = Dledger`.
6. When quantities and links are complete, `Q <= Dshipment`; estimated unresolved transit is `max(0, Dshipment - Q)`. Report this as reconciled transit only when the dispatch sources agree.
7. Transfer dispatch movement effects are source `-D`, shipment-specific transit `+D`; receipt effects are transit `-(G+X+M)`, distributor `+G`, damaged `+X`, and lost `+M`.
8. Every expected movement has `inventoryOwner = PLATFORM`; source and destination location IDs/kinds must match the transfer/shipment stage. Owner mismatch is an exception, not a basis for reclassifying title.
9. For every affected `(locationId, inventorySkuId)`, all-history ledger-derived on-hand is `sum(destination quantity) - sum(source quantity)`. Compare with `InventoryBalance.quantityOnHand`. Include all applicable ledger history, not just transfer rows. Reservations are not ledger movements and must not be included in this equation.

The expected dispatch key is currently assembled as `stock-transfer:<shipmentId>:dispatch:<inventorySkuId>`, while its ledger `referenceId` points to the transfer, not the shipment. Good-receipt keys include receipt and shipment-line IDs, with a suffix for cost layer or uncosted quantity; their `referenceId` points to the receipt. Damage/loss keys also include receipt and shipment-line IDs. Reuse these current conventions for matching, but flag their missing relational link rather than treating a parsed string as a database foreign key.

The current report cannot prove physical stock, carrier handoff, distributor custody, or completeness of an unverified opening balance. It cannot exactly reconcile `InventoryBalance.reservedQuantity` to transfer reservations because customer-order and other reservation populations share that balance field. It can compare transfer-level reservations with transfer/shipment records and identify a reservation-counter mismatch, without labeling all other reserved units as a transfer error.

## 3. Exception classifications

Severity is an investigation priority, not an accounting conclusion. No exception is automatically resolved. “Required evidence” below means evidence an investigator should review; it does not imply the existing API enforces that evidence.

| Code | Detection rule and required records | Severity / action | Evidence to resolve | Automatic resolution |
|---|---|---|---|---|
| `MISSING_AUTHORIZATION` | Positive approved/dispatched/receipt quantity or dispatch/receipt movement exists, but no valid current approved quantity and review/auto-approval evidence supports it. Compare transfer, lines, reviewer/time, and source records. | High; investigate unauthorized or corrupted transfer. | Approved line quantities, Admin reviewer or recorded auto-policy decision, audit trail. | No |
| `DISPATCH_WITHOUT_LEDGER_ENTRY` | A dispatched shipment-line/counter has no matching `TRANSFER_DISPATCH` movement by SKU, source, shipment transit location, transfer reference, and idempotency key. | High; investigate source quantity and movement trace. | Shipment handoff, actor/time, source balance history, movement/service logs. | No |
| `RECEIPT_WITHOUT_DISPATCH` | Receipt line or receipt movement exists without a corresponding dispatched shipment quantity/movement. | High; investigate unsupported destination increase or missing dispatch evidence. | Receipt actor/time/evidence, shipment handoff and matching transit movement. | No |
| `PARTIAL_RECEIPT` | `0 < Q < D` for a shipment/line, or recorded receipt quantities leave a remaining shipment quantity. | Informational until reviewed; also emit `UNRESOLVED_IN_TRANSIT` for positive remaining quantity. No due date is present, so do not mark overdue. | Remaining checklist, subsequent receipt, carrier/distributor confirmation. | No |
| `QUANTITY_MISMATCH` | Any mismatch among approved, reserved, transfer dispatched counter, shipment quantities, receipt totals, expected movements, or line constraints; includes negative/non-integer/out-of-range values. | High; investigate source records and concurrency/history. | Original authorization, shipment/receipt lines, idempotency keys, ledger rows, actor/time. | No |
| `MISSING_RECEIPT` | Dispatched quantity is positive and no receipt record exists for a dispatched shipment line. | Medium; investigate custody and timing. | Distributor receipt/checklist or independently verified handoff/return evidence. | No |
| `DUPLICATE_MOVEMENT` | More than one ledger entry matches one expected movement stage/line after grouping by semantic source, destination, SKU, reference and shipment/receipt-line key. Exact idempotent replay should be one row; distinct keys do not make a duplicate valid. | High; investigate duplicate stock movement. | All matching entry IDs/keys and transaction/audit context. | No |
| `ORPHAN_LEDGER_ENTRY` | Transfer/receipt-referenced ledger entry points to no transfer, shipment, receipt, or compatible transfer line; or an expected transfer-stage entry cannot be assigned uniquely. | High; investigate unlinked movement. | Underlying transfer, shipment, receipt, and movement audit trail. | No |
| `BALANCE_MISMATCH` | For an affected location/SKU, all-history ledger-derived on-hand differs from stored `InventoryBalance.quantityOnHand`, or balance is negative/invalid. | High; investigate source completeness and balance writers. | Full ledger history, opening-balance evidence, current balance and any legacy writer. | No |
| `INVALID_STATUS_TRANSITION` | Current transfer/shipment status contradicts supported recorded quantities (for example `RECEIVED` with unaccounted dispatched quantity, `REJECTED` with approved/dispatched amount, or booking-only status with a dispatch movement). | High; investigate state corruption or incomplete status update. | Transfer/shipment/receipt records, NCM event history where applicable, audit logs. | No |
| `CANCELLED_WITH_RECORDED_MOVEMENT` | A transfer or shipment marked `CANCELLED` has dispatch/receipt ledger movement or positive dispatched/received quantities. | High; investigate; current code has no general transfer cancellation/reversal workflow. | Cancellation authority/time, handoff, receipt, approved correction/reversal evidence. | No |
| `UNRESOLVED_IN_TRANSIT` | `T > 0`, a transit balance remains for the shipment/SKU, or booking/custody outcome is unknown. A carrier status alone does not clear it. | Medium; investigate; never infer loss or liability from age alone. | Carrier event/source, transfer movement, distributor receipt or documented return. | No |
| `INSUFFICIENT_EVIDENCE` | Required actor/time/link is absent, a disputed quantity has no usable supporting evidence, or current models cannot uniquely link a movement to its shipment line. | Medium; report as incomplete and do not claim reconciled. | Original request/review, actor and custody evidence, matching source records. | No |
| `POSSIBLE_DUPLICATE_TRANSFER` | The current schema has no request idempotency key. In v1, emit only a deterministic candidate group where manufacturer, distributor, source/destination, normalized SKU quantities, requester, and persisted `requestedAt` are exactly equal; similarity alone is not proof of duplication. | Low/informational; candidate only, never merge automatically. | Requester intent, separate approvals, business reference. | No |
| `UNCOSTED_TRANSFER_QUANTITY` | Shipment-line uncosted quantity is positive or dispatched receipt has no cost-layer link. | Informational; inventory quantity may reconcile while valuation lineage remains incomplete. | Original accepted production cost-layer records and transfer allocation rows. | No |

An open `InventoryDiscrepancy` is evidence of a reported investigation item, not proof of cause or liability. Do not double-count its quantity in receipt totals. When it refers to the same receipt line, expose the discrepancy separately and aggregate the quantity only once in the movement arithmetic.

## 4. Proposed report contract

### Reader surface and access

This refines P5-R14's initial suggestion to extend the existing inventory valuation comparison. Transfer authorization, receipt disposition, evidence, and row-level movement lineage are operational checks, not GL valuation; keep the transfer report separate from the COGS/valuation result and from the existing SKU/location ledger comparison.

Add a dedicated, additive reader, preferably `GET /api/accounting/stock-transfer-reconciliation`, rather than overloading the existing GL inventory-valuation comparison or the SKU/location-only ledger reconciliation. Reuse the repository’s authenticated accounting report convention: `authenticate` and `authorize("accounting:subledger_read")`, with access limited to authorized Admin accounting users. Do not expose the cross-party report to distributor or manufacturer workspaces. Confirm the final permission mapping before implementation.

The reader should call a pure reconciliation builder over records loaded in one read-only, consistent database snapshot. Use a single `RepeatableRead` snapshot if verified for the deployed Prisma/MySQL combination; do not acquire row locks. A database/read failure must return an explicit failure (`success: false`, `reportStatus: DATA_UNAVAILABLE`, error/request reference), never an empty “successful” report.

### Filters, date meaning, and pagination

- `transferId`, `manufacturerId`, `distributorId`, `inventorySkuId`, and current transfer `status` are optional exact filters.
- `requestedAtFrom` is inclusive and `requestedAtTo` is exclusive, UTC ISO timestamps; they select a transfer-request cohort by `StockTransfer.requestedAt`.
- The request cohort date filter does **not** clip child shipments, receipts, discrepancies, or ledger entries. Include all associated records needed to reconcile each selected transfer.
- This is a current-state snapshot, not a historical as-of report. Current status/counters can be overwritten and there is no general transfer status-event log; do not offer a backdated “as of” guarantee. Return `snapshotAt` to identify when reads were taken.
- Paginate by transfer (never split one transfer’s details) with a versioned opaque keyset cursor ordered deterministically by `(requestedAt DESC, transferId DESC)`. Cap `limit` at 100. Bind the cursor to normalized filters and re-check access on every page.
- Each page request is a separate `reportRunId` and snapshot. Do not combine pages into a single historical snapshot or claim a full-cohort “no exceptions” result when the filter spans multiple pages. Page results remain useful; scope incompleteness must be explicit.

### Response shape

```json
{
  "success": true,
  "reportRunId": "uuid",
  "snapshotAt": "UTC timestamp",
  "reportStatus": "NO_EXCEPTION_DETECTED | EXCEPTION_DETECTED | RECONCILIATION_INCOMPLETE | DATA_UNAVAILABLE",
  "scope": {
    "filters": {},
    "scopeType": "TRANSFER_PAGE",
    "pageComplete": true,
    "hasMore": false,
    "nextCursor": null
  },
  "coverage": {
    "transfers": "COMPLETE",
    "shipments": "COMPLETE",
    "receipts": "COMPLETE",
    "discrepancies": "COMPLETE",
    "ledgerEntries": "COMPLETE",
    "balances": "COMPLETE"
  },
  "summary": {
    "transfersEvaluated": 0,
    "exceptionsOnPage": 0,
    "authorizedQuantity": 0,
    "dispatchedQuantity": 0,
    "goodReceivedQuantity": 0,
    "damagedQuantity": 0,
    "reportedMissingQuantity": 0,
    "unresolvedTransitQuantity": 0,
    "uncostedQuantity": 0
  },
  "transfers": [],
  "exceptions": []
}
```

`NO_EXCEPTION_DETECTED` is allowed only when all required comparisons for the represented scope completed and no exception was found; if the request has more pages, the selection as a whole is not reconciled. `EXCEPTION_DETECTED` means complete comparisons found one or more exceptions. `RECONCILIATION_INCOMPLETE` means one or more required comparisons are ambiguous, unsupported, or outside the evaluated page/scope; return the known exceptions alongside it. `DATA_UNAVAILABLE` means a required source read failed. Never encode missing source rows as zero or “reconciled.”

Each transfer row should include:

- Stable `transferId`, current status, `requestedAt`, reviewer/auto-approval and preparation actor/time references.
- `sourceLocationId`, `destinationLocationId`, kind, owner, manufacturer/distributor IDs.
- Per-line `transferLineId`, `inventorySkuId`, product/size/color labels, requested, approved, reserved, dispatched-counter, shipment-dispatched, and received good/damaged/missing/unresolved quantities.
- Per-shipment `shipmentId`, `shipmentLineId`, booking mode/status, carrier/tracking/external references, dispatch timestamp, and receipt IDs/actors/timestamps.
- Per-movement references: ledger entry IDs, idempotency keys, type, source/destination, quantity, owner, reference type/ID, actor, and created timestamp.
- Current `InventoryBalance.quantityOnHand` and all-history ledger-derived quantity/variance per affected location/SKU; reserved quantity shown separately.
- `comparisonStatus`/coverage indicators, so an incomplete comparison cannot be presented as a clean reconciliation.

Each exception should include stable `exceptionKey` (code + transfer/line/shipment/receipt/movement identity), `code`, severity, informational/investigation flag, concise detection detail, expected and actual whole-unit quantities where applicable, exact source record IDs, evidence references, and `detectedAt`. Do not return broad personal information or external evidence contents when IDs/links suffice. Sort by transfer `(requestedAt DESC, id DESC)`, then line SKU ID, severity rank, code, and `exceptionKey`. The ordering and exception key must not depend on database row-return order.

### Audit and incomplete sources

Record report access through the approved access-audit mechanism (actor, permission, normalized filters, run ID, time, outcome); this is an access audit only and must not create inventory/financial records. If access auditing is mandatory and unavailable, surface the failure explicitly. Record report errors server-side with a correlation ID; do not log secrets or full evidence payloads.

Missing/malformed linked records produce `RECONCILIATION_INCOMPLETE` and the applicable exception, not zero quantities. Missing ledger history, legacy writers, unsupported locations, stale/missing NCM events, or ambiguous references must be identified in `coverage`/notes. The report can reconcile only the queried source population; it cannot establish physical existence, legal title beyond the governing policy, cost completeness, bank/cash, or a complete opening-balance history.

## 5. Read-only guarantees and acceptance tests

The report path must use read operations only for transfer, shipment, receipt, discrepancy, ledger, balance, SKU, and location data. It must not call `applyInventoryMovement`, `ensureInventoryLocation`, stock-sync functions, transfer mutators, accounting posting, or any external NCM client. Access-audit records are isolated from inventory and financial domains.

Test read-only guarantees with repository fakes/spies that fail on any mutating Prisma method (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, raw writes), movement helper, accounting poster, stock sync, or external provider call. Snapshot reads and report access logging are explicitly separated. Repeated reads over identical fixtures must produce identical ordered transfer/exception keys and quantities; only run ID/detection timestamp may differ.

## 6. Test and release matrix

| Layer | Proposed cases | Release meaning |
|---|---|---|
| Pure unit tests | Complete dispatch/receipt produces no exception; multi-shipment and same SKU/location transfers remain distinct; partial receipt emits `PARTIAL_RECEIPT` and outstanding transit; no receipt emits `MISSING_RECEIPT`; absent dispatch/receipt movements; duplicate semantic movements with different keys; orphan transfer/receipt references; incorrect and negative balances; over-receipt/over-dispatch; cancelled-after-dispatch; conflicting status; missing actor/evidence; uncosted units; stable sorting and arithmetic. | Verifies formulas/taxonomy only; no persistence claim. |
| Mocked integration tests | Route authorization; filters and UTC half-open request dates; page cursor/tie ordering; required child rows loaded without N+1 behavior; one snapshot per request; explicit unavailable-source errors; no success-shaped empty fallback; no write, provider, or accounting calls; repeated identical fixtures retain keys and ordering. | Verifies API/service wiring and read-only boundaries against mocks only. |
| Isolated-database tests | Read-only query plans, MySQL integer/null behavior, actual foreign-key relations, query limits, snapshot consistency, two concurrent transfer updates during a report read, duplicate/missing ledger rows, and rollback-free error behavior. | Blocked until a genuinely isolated database endpoint is independently verified and explicitly authorized. Never use `localhost:3306/clothing` or an unverified test schema. |
| Persisted reconciliation evidence | Run ID/snapshot metadata, exact filters and coverage, exception export, source record IDs, independently reviewed dispatch/receipt evidence, matched physical custody counts, and documented exception dispositions. | Required before claiming persisted or physical reconciliation; not satisfied by unit tests or a successful endpoint response. |

Cancellation/reversal tests must assert that the report detects existing movements under a cancellation label but never creates a compensating movement. Concurrent-update tests must verify snapshot consistency or return explicit incomplete/error status; no report query should lock or block stock writers.

## 7. Dependencies, risks, and implementation sequence

### Current source gaps the implementation must preserve

1. `InventoryLedgerEntry` has no foreign-key column for `shipmentId` or `shipmentLineId`. Dispatch points `referenceId` to the transfer; receipt points it to the receipt. Current idempotency-key text embeds shipment/line IDs but is not a relational constraint.
2. Transfer creation has no idempotency key; semantically similar requests cannot be automatically deduplicated.
3. General transfer status changes are mutable and not event-sourced. `StockTransferShipmentEvent` primarily records NCM events, not a complete manual dispatch/receipt status history.
4. Current code writes canonical location balances/ledger and also adjusts legacy `ManufacturerInventory`/Product projections. A transfer report is not a global inventory cutover or reconciliation of those legacy representations.
5. Transfer source locations currently use factory locations; a general central warehouse workflow/view was not established.
6. Existing `reconcileInventoryLedger` compares balances to ledger only for a selected SKU/location. It does not prove complete opening balances, physical stock, title, or transfer authorization.
7. Damaged/missing receipt data and `InventoryDiscrepancy` rows do not establish financial responsibility; not all discrepancy evidence is independently verified.

### Recommended bounded implementation increment

Implement a pure `buildStockTransferReconciliation` calculator and focused unit tests first. The calculator should accept already-loaded transfer/line/shipment/receipt/discrepancy/ledger/balance fixtures, produce deterministic quantities and exception keys, enforce `PLATFORM` owner expectations, and return incomplete status for ambiguous/unlinked data. It must have no Prisma or accounting dependencies.

In the next independently reviewed slice, wire it to a dedicated Admin-accounting read endpoint using one repeatable-read snapshot and bounded keyset pagination. Keep it additive; do not change transfer mutation routes, inventory posting, model/schema, or the broad Accounting Health response. No automatic exception resolution.

Dependencies before wiring:

- Verify deployed Prisma/MySQL repeatable-read behavior and query volume using the approved isolated test database.
- Define the access-audit mechanism and confirm final permission mapping.
- Confirm filter/cursor contract and current-snapshot semantics with accounting and operations.
- Preserve existing idempotency/reference matching; surface cases lacking direct foreign-key linkage as incomplete.
- Validate the current transfer and ledger data population only after database and physical-evidence gates are met.

Primary operational risk is false confidence: an internally consistent transfer ledger is not proof of the physical units or their custody. Other risks include false duplicate detection across valid separate shipments, incomplete opening ledger history, legacy balance writers, and concurrent mutable transfer summaries. The report must communicate scope and evidence limitations in UI/API output.

## 8. Database, validation, and release gates

- **Static design gate:** complete; implementation is not part of P5-R15.
- **Unit/mocked gate:** not run; required before considering code behavior validated.
- **Database integration gate:** blocked until an isolated endpoint is independently verified and explicitly authorized. Do not connect during this task.
- **Persisted reconciliation gate:** blocked pending approved isolated data, immutable run/source references, and investigation of every material exception.
- **Physical custody gate:** requires independently reviewed counts and dispatch/receipt evidence; API declarations and carrier status alone are insufficient.
- **Release gate:** Admin-only access, repeatable-read behavior and bounded query performance verified; read-only spies pass; errors never return success-shaped reconciliation; report disclaimer and source coverage are visible; no automatic stock or financial posting exists.

P5-R15 is **COMPLETE FOR STATIC WORKFLOW TRACE AND REPORT DESIGN ONLY**. Phase 5 remains **PARTIAL / INCOMPLETE**. P5-R14 ownership/custody documentation remains complete only for its static scope; its proposed persisted transfer reconciliation is not implemented. R8 remains partial; P4.2 incomplete; P4.3 in progress/incomplete; Phase 4 incomplete. No Phase 6 or Phase 7 work was started.
