# P6-R3G - Stock Transfer Hardening Implementation Plan

**Status:** COMPLETE - IMPLEMENTATION PLAN AND EXECUTION READINESS ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3B:** COMPLETE - EXISTING-SCHEMA LOCATION/RBAC FOUNDATION
**P6-R3C:** COMPLETE - STATIC RECEIVING CONTRACT
**P6-R3D:** COMPLETE - RECEIPT EVIDENCE/PERSISTENCE READINESS
**P6-R3E:** COMPLETE - PERSISTENT RECEIVING BLUEPRINT
**P6-R3F:** COMPLETE - STOCK-TRANSFER RECEIPT HARDENING READINESS
**P6-R3:** INCOMPLETE
**Persistent stock-transfer hardening:** NOT IMPLEMENTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Scope and evidence boundary

This increment defines the smallest safe sequence for hardening stock-transfer
dispatch, receipt, discrepancy, correction and reconciliation behavior. It
does not change schema, routes, services, database records or external systems.

Evidence sources include:

- `backend/routes/stockTransferRoute.js`
- `backend/controllers/stockTransferController.js`
- `backend/services/stockTransferService.js`
- `backend/services/inventoryLedgerService.js`
- `backend/middleware/locationScope.js`
- `backend/middleware/unifiedAuth.js`
- `backend/prisma/schema.prisma`
- P5-R16 through P5-R19 reconciliation reports and implementation
- P6-R3A through P6-R3F documentation
- Database-independent transfer, ledger, reconciliation and RBAC tests

## 2. Dependency matrix

| Stage | Current implementation | Balance/ledger path | Authorization | Idempotency/concurrency | Remaining work |
|---|---|---|---|---|---|
| Transfer request | `createStockTransferRequest` validates active manufacturer/SKU, factory balance and creates request/lines in a serializable transaction. | No physical stock movement; factory reservation not changed at request. | `transfer:distributor_request` + distributor context. | No universal request idempotency key found. | Add stable client/request identity and source authorization tests. |
| Approval | `reviewStockTransferRequest` validates approved quantities and exact line coverage. | No physical movement. | `transfer:admin_review` + Admin role. | Prisma optimistic status/line checks in service. | Separate approval evidence/actor, and cancel/reopen policy. |
| Reservation | NCM booking reserves factory on-hand for shipment cost/layer quantities. | Direct `InventoryBalance.reservedQuantity` update plus cost-layer counters; no ledger movement. | `transfer:manufacturer_dispatch` + manufacturer context. | Transfer line and balance optimistic predicates; shipment booking hash/key. | Centralize reservation contract and retry/cleanup behavior. |
| Dispatch | Manual dispatch and verified NCM reconciliation call `dispatchShipmentStock`. | `applyInventoryMovement(TRANSFER_DISPATCH)` source factory -> shipment transit; legacy manufacturer/Product projection updates remain. | Manufacturer ID/workspace; no reusable source-location middleware. | Shipment/dispatch idempotency key and serializable transaction. | Add source-location scope and remove or explicitly derive legacy projection writes. |
| Transit | `StockTransferShipment` status, transit location and shipment lines. | Canonical in-transit balance/ledger, plus carrier event data. | Manufacturer booking/distribution/read routes. | Carrier event/booking keys where implemented. | Separate carrier outcome from physical dispatch and preserve unknown state. |
| Receipt initiation | Distributor receipt route loads shipment and checks destination/distributor ownership. | No movement until line quantities pass validation. | `transfer:distributor_receive` + distributor context. | Receipt header key/request hash. | Apply destination locationScope and receipt-session model. |
| Full receipt | Good/damaged/missing quantities account the entire shipment. | Canonical `TRANSFER_RECEIPT`, `DAMAGE` or `LOSS` in one transaction. | Destination distributor ownership; no reusable location middleware. | Existing receipt key, receipt-line and movement keys. | Persist cumulative/session evidence and prove database concurrency. |
| Partial receipt | Remaining shipment quantity is recalculated from existing receipt lines. | Good/damage/loss movements post partial quantities. | Destination distributor context. | Same receipt key can represent a session; unique line constraints prevent line duplication. | Add explicit receipt session identity and cumulative source-line guard. |
| Excess/shortage | Excess is rejected in the normalizer; under-receipt leaves partial status. Missing quantity creates `LOSS` and discrepancy. | Missing units leave or move to lost location according to current service. | Distributor receiving actor. | Partial-receipt remaining quantity in transaction. | Approve over-receipt policy and correction/revision contract. |
| Damaged/rejected | Damaged receipt creates canonical `DAMAGE` and discrepancy. Rejected is not a separate universal canonical disposition. | Transit -> damaged location. | Distributor receive/evidence. | Receipt movement key and discrepancy ID/key. | Add explicit rejected/quarantine disposition and independent resolution. |
| Put-away | No universal warehouse bin/put-away transaction exists. | Destination distributor location is the current receipt target. | No persisted warehouse staff/location assignment. | None beyond receipt movement. | Requires future warehouse location hierarchy and put-away schema. |
| Completion | Shipment/transfer status derives from total dispatched and accounted quantities. | Existing canonical movements/discrepancy records. | Distributor/receipt and Admin reconciliation read. | Existing status update in serializable transaction. | Do not use status alone as physical evidence. |
| Cancellation | No completed general cancellation/reversal route found; NCM booking failure releases NCM reservations. | Reversal is incomplete. | No general approved correction role. | NCM resolution keys only. | Define cancellation/reversal/correction authorization and compensating movements. |
| Reversal/correction | No canonical compensating transfer receipt/reversal contract. | Historical movements remain append-only; no automatic corrections. | Not first-class. | No stable correction key. | Add original-movement reference, reason/evidence/checker and correction key. |
| Reconciliation | P5-R16–R19 calculator, formatter and Admin reader use bounded persisted source snapshots. | Read-only; no inventory or GL mutation. | Admin + `inventory:ledger_read`. | Cursor-bound pagination and repeatable-read snapshot. | Resolution workflow must not silently close exceptions. |

## 3. Canonical dispatch integration

### P6-R3G-A

Dispatch must retain one authoritative movement:

- Movement type: `TRANSFER_DISPATCH`
- Source: transfer `sourceLocationId`
- Destination: shipment-specific `IN_TRANSIT` location
- SKU: exact shipment line inventory SKU
- Quantity: exact shipment line quantity
- Owner: `PLATFORM`
- Reference: stock transfer ID
- Idempotency: `stock-transfer:<shipmentId>:dispatch:<inventorySkuId>`
- Actor: authenticated manufacturer/dispatch actor
- Reason: transfer dispatch evidence

The implementation must:

- Validate positive exact integers.
- Confirm source and destination locations are active/platform-owned.
- Confirm source dispatch permission and source-location scope.
- Consume no source quantity outside the canonical helper.
- Prevent duplicate physical deduction on retry.
- Keep NCM booking reservations separate from dispatch.
- Prevent a carrier rejection/unknown outcome from becoming dispatch.
- Not post revenue, COGS or financial liability.

### Legacy projection boundary

`updateLegacyFactoryStock`, `ManufacturerInventoryMovement`, `StockLog` and
`syncProductStock` are compatibility projections. They must not become direct
independent stock authorities. Their future handling requires a separate
transaction and failure contract: canonical movement commits or projection
repair/reconciliation is explicit.

## 4. Canonical receipt integration

### P6-R3G-B

Receipt is only eligible after verified dispatch evidence. The future receipt
transaction should:

- Load the shipment and source/destination from the server, not client location.
- Verify authenticated distributor/destination scope.
- Require exact remaining dispatched quantity.
- Create one receipt session and receipt-line/session relation.
- Post good units as `TRANSFER_RECEIPT`.
- Post damaged units as `DAMAGE`.
- Post missing units as `LOSS`.
- Keep cost-layer split and uncosted quantity explicit.
- Update shipment/line accounting only after movement success.
- Keep the original dispatch and receipt IDs linked.

One receipt session may contain multiple shipment lines and partial quantities.
Every line has cumulative received, damaged, missing and outstanding amounts.

## 5. Partial receipts and discrepancies

### P6-R3G-C

Quantity formula:

`outstanding = dispatched - previously accounted - current accounted`

Where current accounted is good + damaged + missing. Each category remains
separate:

- Accepted/good may move to the destination saleable location.
- Damaged moves to a damaged location.
- Missing moves to a lost location or remains transit depending on approved
  physical/custody evidence.
- Rejected is a separate non-saleable disposition, not inferred.
- Excess is blocked unless an approved exception policy is activated.

Required evidence:

- Exact dispatched/source line.
- Count and receiving actor.
- Damage/rejection reason and evidence.
- Missing quantity evidence.
- Independent reviewer for consequential discrepancy resolution.
- Destination put-away/receipt location.

No automatic distributor receivable/liability or platform loss write-off is
allowed in P6-R3G.

## 6. Authorization and location scope

### P6-R3G-D

Existing identifiers:

- `transfer:distributor_request`
- `transfer:distributor_read`
- `transfer:distributor_receive`
- `transfer:manufacturer_dispatch`
- `transfer:manufacturer_read`
- `transfer:admin_read`
- `transfer:admin_review`
- `inventory:ledger_read`

Required future route chain:

`authenticate -> authorize(permission) -> setWorkspaceContext ->
resolveSourceAndDestinationFromTransfer -> requireLocationAccess ->
domain service`

Rules:

- Manufacturer dispatch actor must be authorized for the transfer source and
  source factory location.
- Distributor receipt actor must be authorized for the destination distributor
  location.
- Admin review/exception resolution remains distinct from physical dispatch and
  receipt authority.
- Client `locationId` fields do not establish access.
- Inactive/non-platform locations fail closed.
- Admin global access must remain explicit rather than implicit.
- Cross-location actor access is denied and audited.

The stock-transfer route currently does not mount R3B
`requireDistributorInventoryLocation` or any source/destination movement helper.
This is the main authorization gap.

## 7. Reversals and corrections

### P6-R3G-E

The first persistent implementation must include no silent inventory correction.
A correction should create:

- A stable correction request/event ID.
- Reference to original movement/receipt/shipment/line.
- Exact correction quantity and direction.
- Reason code and evidence.
- Maker/checker actors.
- Effective time.
- Canonical compensating movement.
- Discrepancy resolution state.

Reversal quantity is constrained by original eligible quantity and original
unresolved/corrected balance. It must not restore twice.

No correction may edit or delete original `InventoryLedgerEntry`,
`StockTransferReceipt` or balance history. Physical and accounting corrections
remain separate; no GL posting is included in this package.

## 8. Reconciliation and exception closure

### P6-R3G-F

The existing P5-R16–R19 implementation should remain the read-only reconciliation
basis. It can detect:

- Duplicate dispatch/receipt movement.
- Receipt without dispatch.
- Dispatch quantity above authorization.
- Receipt quantity above dispatch.
- Missing/insufficient location evidence.
- Reservation mismatch.
- Incomplete source coverage.
- Cost-evidence gaps.
- Duplicate candidate groups.

A correction may update subsequent reconciliation inputs but must not close an
open exception through status alone. Closure requires:

- Linked compensating/correction movement.
- Evidence and reviewer.
- Updated receipt/dispatch quantities.
- Coverage state.
- Explicit resolved/rejected status.

No financial charge or loss recognition is automatic.

## 9. Acceptance criteria

### P6-R3G-A dispatch

- Exact positive quantity.
- Valid active source/destination/owner.
- One canonical dispatch entry per shipment line.
- Repeated exact request replay.
- Changed request conflict.
- No revenue/COGS/financial fields.
- Legacy projection remains explicitly secondary.

### P6-R3G-B receipt

- Receipt only for a dispatched/partial shipment.
- Remaining quantity guard.
- Exact good/damage/missing partition.
- One canonical transfer receipt movement per session/line/cost layer.
- Repeated exact receipt replay.
- Conflicting payload rejection.

### P6-R3G-C discrepancy

- Partial, excess, short, damaged and rejected categories cannot overlap.
- Missing evidence leaves an open exception.
- No automatic distributor liability.
- Cumulative receipt never exceeds shipment.
- Multiple partial receipts are attributable to stable sessions/lines.

### P6-R3G-D authorization

- Cross-location denial.
- Inactive location denial.
- Non-platform owner denial.
- Client location cannot override server-resolved transfer locations.
- Independent source/destination permission.
- Authorization denial audit.

### P6-R3G-E correction

- Original movement remains immutable.
- Reversal/replacement quantity cannot exceed eligibility.
- Replay/corrected payload conflict.
- No double balance restoration.
- Separate physical/accounting outcome.

### P6-R3G-F reconciliation

- Duplicate and orphan movements remain visible.
- Correction produces different/reconciled page data.
- Incomplete coverage remains incomplete.
- Exception cannot close on status alone.
- Synthetic and persisted test labels stay distinct.

## 10. Database-independent test matrix

Add or retain pure/mocked tests for:

- Exact quantity calculations.
- Multiple partial receipts.
- Duplicate submissions.
- Conflicting idempotency hash.
- Concurrent dispatch attempts as controlled doubles.
- Concurrent receipt attempts as controlled doubles.
- Source/destination authorization.
- Inactive and non-platform locations.
- Unauthorized cross-location access.
- Excess/short/damage/rejection quantities.
- Correction/reversal replay.
- Duplicate ledger entry prevention.
- Reconciliation after correction.
- Retry after mock partial failure.
- Input immutability.

Persisted concurrency and transaction safety require separately isolated database
integration tests. Mocked tests cannot prove MySQL isolation or locking.

## 11. Implementation sequence

### Next executable increment: database-free hardening

Before database work, implement only pure/application hardening:

1. Add transfer receipt/session identity helpers.
2. Centralize source/destination movement authorization in an existing helper.
3. Strengthen mock tests for partial receipt, conflicting key and duplicate movement.
4. Add discrepancy/correction pure validators.
5. Add reconciliation fixture coverage for corrected movement and exception closure.

Likely files:

- `backend/services/stockTransferService.js`
- `backend/services/stockTransferReconciliationService.js`
- `backend/controllers/stockTransferController.js`
- `backend/middleware/locationScope.js`
- `backend/routes/stockTransferRoute.js`
- Existing stock-transfer and reconciliation test files

This increment is not authorized to change schema, routes that create persistence,
or inventory/financial records. Route additions should wait for approved API
and location assignment design.

### Database-dependent increment

After separate approval:

- Add receipt-session/correction/reversal schema.
- Add unique constraints and source-line remaining/cumulative fields.
- Integrate serializable persisted receipt/put-away/correction transaction.
- Add isolated MySQL integration/concurrency/migration tests.
- Run reconciliation and physical count validation.

No schema or migration exists in this task.

## 12. DBA and release prerequisites

Before persistent implementation:

- DBA-provisioned isolated test MySQL database.
- Independently verified endpoint identity.
- Explicit confirmation that production/prohibited `clothing` databases cannot be reached.
- Separate migration authorization.
- Backup/restore evidence.
- Migration and rollback rehearsal.
- Transaction isolation/concurrency test plan.
- Referential integrity and unique constraint design.
- Historical source and line classification.
- Post-migration transfer/balance/ledger/receipt reconciliation.
- Release approval.

Existing database integration guards must remain fail closed.

## 13. Policy decision register

| Decision | Status | Required treatment |
|---|---|---|
| Distributor-held inventory ownership | Confirmed | Aama owns; distributor custodian |
| Transfer/receipt vs sale | Confirmed | No revenue/COGS |
| NPR rounding | Confirmed internal policy | 2 decimals, HALF_EVEN, 2026-11-15; no tax/CA claim |
| Costing method | Unresolved | Block authoritative valuation choice |
| Supplier/manufacturer title | Unresolved | Block affected ownership assumptions |
| Landed cost | Unresolved | Keep uncosted/exception separate |
| Damage/loss responsibility | Unresolved | No automatic liability |
| Return financial treatment | Unresolved | Separate physical and financial disposition |
| Warehouse approval thresholds | Unresolved | Block consequential correction/write-off |
| Opening/historical stock | Unresolved | No automatic conversion |
| Historical transfer evidence | Unresolved | Classify verifiable/partial/ambiguous/excluded |

## 14. Files and validation

The implementation plan itself documents existing source files and test suites.
No production code is required for this increment.

Validation should use database-independent:

- `stockTransferService.test.js`
- `stockTransferReconciliationService.test.js`
- `stockTransferReconciliationReportService.test.js`
- `stockTransferReconciliationController.test.js`
- `inventoryLedgerService.test.js`
- `locationScope.test.js`
- `rbacAuthorization.test.js`
- syntax checks and `git diff --check`

