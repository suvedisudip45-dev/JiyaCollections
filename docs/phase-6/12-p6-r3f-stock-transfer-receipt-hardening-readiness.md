# P6-R3F - Stock-Transfer Receipt Hardening Readiness

**Status:** COMPLETE - STATIC RECEIPT LIFECYCLE AND IMPLEMENTATION-READINESS ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3B:** COMPLETE - EXISTING-SCHEMA LOCATION/RBAC FOUNDATION
**P6-R3C:** COMPLETE - STATIC RECEIVING CONTRACT
**P6-R3D:** COMPLETE - RECEIPT EVIDENCE/PERSISTENCE READINESS
**P6-R3E:** COMPLETE - PERSISTENT RECEIVING BLUEPRINT
**Persistent transfer-receipt hardening:** NOT IMPLEMENTED
**P6-R3:** INCOMPLETE
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Complete source-to-destination lifecycle

### Request creation

`POST /api/stock-transfers/requests` in
`backend/routes/stockTransferRoute.js` is guarded by `authenticate`,
`transfer:distributor_request` and `setDistributorContext`.
`createStockTransferRequest` in `backend/controllers/stockTransferController.js`
loads the selected manufacturer, factory location and destination distributor
location, validates active SKUs and unreserved factory stock, evaluates
auto-approval and creates `StockTransfer` plus `StockTransferLine` in a
serializable transaction.

### Approval

`PATCH /api/stock-transfers/admin/:id/review` uses
`transfer:admin_review` and records approval/rejection quantities. The
controller checks requested-line bounds and exact line coverage. Rejection does
not create a stock movement.

### Preparation and reservation

Manufacturer preparation is
`PATCH /api/stock-transfers/:id/preparation` with
`transfer:manufacturer_dispatch` and `setManufacturerContext`.
The route can be edited only before shipment activity.

NCM booking reserves canonical factory balance quantities and cost layers.
Manual dispatch creates a shipment immediately and dispatches stock in the same
shipment transaction.

Reservation updates only `InventoryBalance.reservedQuantity` and
`StockTransferLine.reservedShipmentQuantity`. These counters are reservation
state, not physical stock movement.

### Dispatch

Manual and own-store/NCM reconciliation paths call
`dispatchShipmentStock`. It:

1. Allocates production cost layers.
2. Ensures an shipment-specific `IN_TRANSIT` location.
3. Calls `applyInventoryMovement` with `TRANSFER_DISPATCH`.
4. Updates `StockTransferLine.dispatchedQuantity`.
5. Updates legacy `ManufacturerInventory`/`StockLog` projections.
6. Updates shipment/transfer status.

NCM booking is not dispatch. A booking outcome can remain pending/unknown and
must be reconciled rather than treated as physical dispatch.

### Transit and receipt initiation

The distributor reads dispatched shipments and submits
`POST /api/stock-transfers/shipments/:shipmentId/receipt`.
The route requires `transfer:distributor_receive`, distributor context and
`Idempotency-Key`.

Receipt is only accepted while the shipment is `DISPATCHED` or
`PARTIALLY_RECEIVED`.

### Receipt confirmation

`receiveStockTransferShipment` executes a serializable transaction. It verifies:

- Shipment exists.
- Shipment belongs to the authenticated distributor.
- Distributor profile is active.
- Receipt line IDs are unique and belong to shipment lines.
- Good/damaged/missing quantities are valid and within the remaining shipment balance.
- Evidence URLs are valid.
- Request hash and replay match.

The function creates `StockTransferReceipt` and `StockTransferReceiptLine`
records, then creates canonical good/damage/loss movements and discrepancies.

### Completion and reconciliation

Shipment status becomes `DELIVERED` or `DISCREPANCY` when every shipment line
is accounted. A remaining balance produces `PARTIALLY_RECEIVED`.

The P5 reconciliation service/formatter links:

- Request and approval evidence.
- Dispatch movement evidence.
- Shipment/receipt records.
- Good/damage/missing quantities.
- Cost evidence.
- Source coverage.
- Duplicate candidates and movement conflicts.

No reconciliation result proves physical stock, full source coverage or
persisted accounting correctness.

### Cancellation and reversal

No general transfer-cancellation route or canonical correction/reversal model
was found as a completed lifecycle. NCM booking rejection releases reservations
and sets a failed/unknown booking state. Existing ledger movements are not
edited or deleted as correction. Any future reversal requires a linked
compensating canonical movement and explicit review.

## 2. Existing balance and ledger writes

### Canonical dispatch

`applyInventoryMovement` updates source/destination `InventoryBalance`,
creates `InventoryLedgerEntry`, and enforces exact idempotency replay.

### Canonical receipt

Good accepted units call `receiveCostedTransferStock`, which applies
`TRANSFER_RECEIPT` movement(s) split by production cost layer and uncosted
quantity. Damaged units apply `DAMAGE`; missing units apply `LOSS`.

These canonical write paths delegate through `applyInventoryMovement`; no direct
`inventoryLedgerEntry.create` was found in the receipt loop.

### Reservation-only direct balances

NCM reservation and dispatch preparation directly use
`InventoryBalance.upsert/updateMany` to reserve/release factory stock:

- This is reservation state, not a physical stock movement.
- It must remain distinct from dispatch.
- It must be reconciled with shipment reservation counters.

### Legacy projection writes

The stock-transfer controller also updates `ManufacturerInventory`,
`ManufacturerInventoryMovement` and `Product`/variant projections for
compatibility. These projections must not become a second canonical stock
authority.

## 3. Receipt identity and quantity findings

The existing receipt line identity is `StockTransferReceiptLine.shipmentLineId`.
Partial receipts are supported: previously accounted quantities are subtracted
from each shipment line remainder.

Confirmed distinctions:

- Approved: `StockTransferLine.approvedQuantity`.
- Reserved: `StockTransferLine.reservedShipmentQuantity`.
- Dispatched: `StockTransferLine.dispatchedQuantity`.
- Shipment quantity: `StockTransferShipmentLine.quantity`.
- Receipt: `StockTransferReceiptLine.good/damaged/missing`.
- Outstanding: shipment quantity minus all accounted receipt quantities.

Duplicate submissions use receipt idempotency:
`${shipment.id}:receipt:${Idempotency-Key}` and a sorted request hash.
The same key with a different hash conflicts.

Same shipment-line duplicates in one receipt are rejected.
Concurrent partial receipts use serializable transaction and remaining
quantity checks.

Excess receipt is rejected because total good/damaged/missing exceeds the
remaining shipment quantity. Receipt with no dispatch is blocked by shipment
status. Duplicate movement/reconciliation exceptions are detected as
`DUPLICATE_MOVEMENT` or insufficient-evidence cases.

Corrections after receipt are not represented as a first-class receipt
correction model. The system has discrepancy records and carrier re-resolution,
but no canonical compensating transfer-reversal API was found.

## 4. Canonical movement integration gaps

| Operation | Existing movement contract |
|---|---|
| Manual dispatch | `TRANSFER_DISPATCH`; source factory to shipment transit |
| NCM dispatch event | `TRANSFER_DISPATCH` when verified pickup/event reconciliation applies |
| Own-store | Existing dispatch/own-store flow; no delivery-custody default without receipt |
| Good receipt | `TRANSFER_RECEIPT`; transit to distributor location, split by layer |
| Damaged receipt | `DAMAGE`; transit to damaged location |
| Missing receipt | `LOSS`; transit to lost location |
| Reversal/correction | Missing first-class compensating-event contract |

No transfer receipt should increase destination stock more than once. Existing
ledger idempotency keys, shipment-line receipt keys and replay checks support
this for covered canonical paths, but persisted concurrency must be tested.

No invalid receipt should create a balance increase because quantity and status
validation precedes canonical movement calls.

## 5. Source and destination authorization findings

The stock-transfer route has permission checks and workspace contexts:

- Distributor catalog/request/edit/receive: distributor context.
- Manufacturer catalog/edit/dispatch: manufacturer context.
- Admin review/read: Admin role plus transfer permissions.

It does not use P6-R3B `requireDistributorInventoryLocation` or
`evaluateMovementLocationAccess` for stock-transfer dispatch/receipt. The
existing route verifies entity ownership separately:

- Manufacturer ID for dispatch.
- Distributor ID for receipt.
- Source/destination IDs are loaded from the transfer record.

This is source-based authorization, not a reusable server-side warehouse
location assignment. R3B middleware is applied only to the distributor
inventory-decrease route.

Required future transfer hardening:

- Resolve source/destination from server transfer record, never client location.
- Require source dispatch permission and source location scope.
- Require destination receipt permission and destination location scope.
- Reject inactive/non-platform locations.
- Audit cross-location denial.
- Keep approval/dispatch/receipt actors and permissions separate.

## 6. Idempotency and concurrency requirements

### Dispatch

Dispatch key:
`stock-transfer:<shipmentId>:dispatch:<inventorySkuId>`.

Full shipment booking key is transfer plus manual/NCM plus client key.
Replay requires exact booking payload hash.

### Receipt

Receipt key:
`<shipmentId>:receipt:<Idempotency-Key>`.

Each good/layer movement key includes receipt ID, shipment line and cost
layer/uncosted suffix. Damaged/missing keys include receipt and shipment line.

Same-key/same-content replay is allowed. Changed content conflicts.

Future implementation should add:

- Receipt session identity distinct from line identity.
- Deterministic correction/reversal keys.
- Database uniqueness on receipt session/line where not already sufficient.
- Conditional source remaining quantity and balance update in one transaction.
- Bounded serialized retry for concurrent partial receipts.

Application-level protections do not prove MySQL concurrency safety.

## 7. Discrepancy and reconciliation design

Existing discrepancies cover:

- Damage type and evidence.
- Missing quantity.
- Custody stage.
- Open/resolution status.

Reconciliation handles:

- Missing/duplicate dispatch and receipt movements.
- Receipt without dispatch.
- Dispatch/receipt quantity conflicts.
- Status conflicts.
- Incomplete source coverage.
- Cost evidence gaps.
- Reservation mismatches.
- Duplicate candidate groups separately from confirmed duplicates.

Future discrepancy closure must preserve original evidence and movement records.
It must not auto-credit, debit or change a distributor receivable.

## 8. Proposed bounded implementation stages

### R3F-A: Canonical dispatch hardening

- Add source-location scope middleware to manual, own-store and NCM dispatch.
- Keep `TRANSFER_DISPATCH` movement helper as sole canonical physical effect.
- Preserve reservation as separate state.
- Add tests for duplicate dispatch and source mismatch.

### R3F-B: Canonical receipt hardening

- Integrate destination locationScope/RBAC and receipt-session identity.
- Keep existing replay hash/line validation.
- Preserve split good/damage/loss movements.
- Add tests for partial, duplicate and conflicting receipt.

### R3F-C: Partial receipt/discrepancy

- Persisted receipt line remaining/cumulative quantity.
- Explicit excess/short evidence.
- Stable discrepancy resolution and compensating movement keys.
- No automatic financial liability.

### R3F-D: Source/destination authorization

- Add reusable movement route middleware.
- Resolve source/destination from transfer record.
- Separate source dispatch and destination receipt permissions.
- Add cross-location denial/audit tests.

### R3F-E: Corrections/reversals

- Add append-only compensating movement contract.
- No historical movement deletion/update.
- Add approved reason/evidence/actor/checker fields.
- Reconcile status and remaining quantity from original and correction records.

### R3F-F: Reconciliation and closure

- Reuse P5-R16–R19 calculators/reporters.
- Link discrepancy resolution to explicit outcome.
- Publish bounded coverage and incomplete-evidence status.
- No whole-company or GL conclusion.

No stage is authorized here.

## 9. DBA and release prerequisites

Future persisted work requires:

- Explicit separately authorized DBA implementation approval.
- Independently verified isolated MySQL endpoint.
- Exact host/port/database identity.
- Confirmation that the database is not `clothing`.
- Explicit migration authorization.
- Backup/restore evidence.
- Forward migration and rollback plan.
- Persisted serializable/concurrency tests.
- Idempotency race tests.
- Partial receipt/correction tests.
- Post-migration receipt/balance/ledger reconciliation.

Existing database safety guards must remain intact.

## 10. Files inspected

- `backend/routes/stockTransferRoute.js`
- `backend/controllers/stockTransferController.js`
- `backend/services/stockTransferService.js`
- `backend/services/inventoryLedgerService.js`
- `backend/middleware/locationScope.js`
- `backend/middleware/unifiedAuth.js`
- `backend/prisma/schema.prisma`
- `backend/tests/stockTransferService.test.js`
- `backend/tests/stockTransferReconciliationService.test.js`
- `backend/tests/locationScope.test.js`
- P5-R16–R19 reconciliation reports and P6-R3A–R3E documents

P6-R3G extends this readiness audit into an executable implementation plan in
[13-p6-r3g-stock-transfer-hardening-implementation-plan.md](./13-p6-r3g-stock-transfer-hardening-implementation-plan.md).
P6-R3G does not implement persistent hardening.

P6-R3H adds bounded canonical dispatch planning and manufacturer source-location
route middleware. It does not implement persistent receipt or correction behavior.
P6-R3I closes part of the remaining dispatch gap by adding fail-closed NCM
custody/source validation and legacy projection consistency checks. It does not
prove persisted concurrency or compare legacy projections in reconciliation.

