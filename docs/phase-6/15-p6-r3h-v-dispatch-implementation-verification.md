# P6-R3H-V - Canonical Stock-Transfer Dispatch Verification

**Status:** PARTIALLY VERIFIED - DATABASE-INDEPENDENT ONLY
**P6-R3H implementation status:** PARTIAL; persisted dispatch hardening remains unverified
**P6-R3:** INCOMPLETE
**Persistent receiving:** NOT IMPLEMENTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Executive conclusion

P6-R3H made a bounded, real improvement:

- Dispatch line normalization and canonical dispatch planning now live in
  `backend/services/stockTransferService.js`.
- `dispatchShipmentStock` consumes the reusable plan and calls
  `applyInventoryMovement` with `TRANSFER_DISPATCH`.
- Manual, NCM and own-store dispatch paths converge on
  `dispatchShipmentStock`.
- Manufacturer source-location middleware is mounted on the direct manual/NCM
  transfer routes and the manufacturer legacy dispatch route.
- Database-independent tests pass for dispatch plan, quantity, duplicate-line,
  replay and source-location behavior.

P6-R3H is not fully verified:

- It does not cover every dispatch trigger. NCM webhook and NCM sync/reconciliation
  dispatch can reach `dispatchShipmentStock` without the HTTP source-location
  middleware.
- It retains legacy `ManufacturerInventory`, `StockLog` and `Product` projection
  updates alongside the canonical ledger.
- Manual local dispatch posts a shipment-linked logistics expense/payable
  journal. This is logistics accounting, not COGS/revenue, but it means dispatch
  is not completely accounting-neutral.
- Persisted concurrency, database uniqueness, real transaction rollback and
  deployed authorization are not verified.
- A destination-location scope helper is not applied to stock-transfer dispatch.
- Reversal/correction and receipt-to-dispatch reconciliation remain incomplete.

The previous P6-R3H report is therefore over-broad. P6-R3H is complete only as
a database-independent dispatch-hardening increment.

## 2. Exact changed-file evidence

Tracked P6-R3H diff:

- `backend/controllers/stockTransferController.js`: 19 insertions, 51 deletions.
- `backend/services/stockTransferService.js`: 93 insertions.
- `backend/routes/stockTransferRoute.js`: 3 insertions.
- `backend/routes/manufacturerRoute.js`: 2 insertions.
- `backend/tests/stockTransferService.test.js`: 102 insertions.

The P6-R3H report is 129 lines.

Files created or used outside tracked P6-R3H diff:

- `backend/middleware/locationScope.js`: 278 lines, untracked in the repository
  diff and predated P6-R3H verification. It was created by earlier R3B work,
  not attributable solely to P6-R3H source diff.
- `backend/tests/locationScope.test.js`: 247 lines, untracked and not part of
  the P6-R3H tracked diff.
- `docs/phase-6/14-p6-r3h-canonical-stock-transfer-dispatch-implementation.md`
  was untracked in the git diff and is 129 lines, not the reported 171 lines.

No P6-R3H schema or migration file exists.

## 3. Dispatch route and write-path inventory

### Manual HTTP dispatch

Route:

- `POST /api/stock-transfers/:id/dispatch`

Source:

- `stockTransferRoute.js`
- `dispatchManualStockTransfer`
- `dispatchShipmentStock`
- `applyInventoryMovement`

Authorization:

- `authenticate`
- `transfer:manufacturer_dispatch`
- `setManufacturerContext`
- `requireManufacturerTransferSourceLocation`

The middleware resolves transfer source server-side and checks the authenticated
manufacturer and active, platform-owned factory location.

### Manufacturer compatibility dispatch route

Route:

- `POST /api/manufacturer/stock-requests/:id/dispatch`

Source:

- `manufacturerRoute.js`
- `dispatchStockTransferRequest`
- local/NCM/self-store selector
- `dispatchManualStockTransfer`,
  `bookNcmStockTransfer`, or
  `deliverStockTransferToOwnStore`

It includes the same source-location middleware.

### NCM booking

Route:

- `POST /api/stock-transfers/:id/ncm-booking`

This reserves canonical factory balance and cost-layer quantities. It does not
create `TRANSFER_DISPATCH` merely by successfully creating a carrier booking.
It uses server-source middleware because P6-R3H mounted it on the route.

### NCM custody-confirming webhook and reconciliation

Source:

- `deliveryRoute.js` NCM webhook/simulation/sync paths
- `applyNcmStockTransferWebhook`
- `dispatchShipmentStock`

This path dispatches canonical stock when custody-confirming status is observed
and shipment status is pending/unknown. It does not pass the HTTP
source-location middleware. It does use the NCM event secret or Admin
reconciliation route; persisted source/destination location authorization is
not first-class here.

### Own-store dispatch

Source:

- `deliverStockTransferToOwnStore`
- `dispatchShipmentStock`
- receipt creation and receipt movement

It dispatches and immediately creates accepted receipt movements in one
transaction. The route is covered by the manufacturer source-location
middleware. Destination and receipt authorization remain not centralized.

## 4. Canonical ledger integration

Verified canonical dispatch:

- `dispatchShipmentStock` builds a dispatch movement plan.
- Each movement uses `movementType = "TRANSFER_DISPATCH"`.
- Source is `transfer.sourceLocationId`.
- Destination is a shipment-specific `IN_TRANSIT` location.
- Quantity is the exact shipment line quantity.
- `inventoryOwner = PLATFORM` is enforced by `applyInventoryMovement`.
- Stable key:
  `stock-transfer:<shipmentId>:dispatch:<inventorySkuId>`.

The canonical helper:

- Checks exact idempotent replay.
- Rejects a reused key with conflicting movement content.
- Updates source/destination balances and creates `InventoryLedgerEntry` in the
  caller transaction.
- Preserves optimistic balance update predicates.

The P6-R3H plan adds exact quantity, duplicate-line and approved-minus-dispatched
guards. These guards are database-independent, not persisted integrity controls.

## 5. Legacy and direct writes

Dispatch still calls `updateLegacyFactoryStock`, which:

- Updates `ManufacturerInventory.quantity` and `variantsStock`.
- Updates `ManufacturerInventoryMovement`.
- Synchronizes `Product.stockQuantity`.

This is a legacy compatibility write alongside the canonical ledger. It does
not prove that legacy and canonical quantities remain equal under failures or
concurrency.

NCM preparation/reservation directly updates `InventoryBalance.reservedQuantity`
and cost-layer reservation counters. This is reservation state, not dispatch.

No direct canonical `InventoryLedgerEntry` creation was found in dispatch route
code outside `applyInventoryMovement` and the shared helper.

## 6. Authorization findings

VERIFIED:

- Manufacturer profile ownership is checked for direct dispatch and manufacturer
  route dispatch.
- Transfer source location is resolved server-side for mounted manual/NCM and
  manufacturer-route dispatch.
- Missing/inactive/non-platform/cross-manufacturer source location fails closed.
- Client location ID values are not used to establish source access.
- Inactive and non-platform destination locations are rejected in canonical
  movement helper calls.
- Admin routes use existing permission middleware.

PARTIALLY VERIFIED:

- Destination-location scope is not applied as a dedicated location middleware
  for transfer dispatch/receipt routes.
- NCM webhook/sync dispatch is not covered by profile/location HTTP middleware.
- External webhook secret or Admin reconciliation authority is not equivalent
  to persisted warehouse location assignment.
- Persistent account-to-location authorization is absent.

NOT VERIFIED:

- Deployed role grants.
- Persisted warehouse staff assignments.
- Real cross-location race or IDOR behavior.

## 7. Accounting and ownership findings

VERIFIED:

- Dispatch movement is `TRANSFER_DISPATCH`, not fulfillment or sale.
- No revenue or COGS movement is created by the stock-movement helper.
- Distributor inventory remains recorded as `PLATFORM`-owned canonical stock.
- No distributor receivable is created by canonical dispatch.

NOT VERIFIED/PARTIAL:

- Manual local freight dispatch calls `postManufacturerLogisticsAccounting`.
- That function creates a shipment-linked logistics expense and manufacturer
  payable journal/document.
- This is a logistics settlement accounting side effect, not COGS/revenue.
- P6-R3H does not create freight accounting for NCM or own-store paths.
- The report's prior no-accounting claim is too broad: manual dispatch can create
  an accounting journal.

## 8. Idempotency and concurrency findings

VERIFIED:

- Dispatch request keys are deterministic for manual, NCM and own-store bookings.
- `planCanonicalTransferDispatch` is deterministic for same input.
- Canonical ledger key is shipment-line SKU-specific.
- Changed request payload conflicts with existing booking key.
- Duplicate shipment-line request is rejected.
- Canonical replay and conflict behavior are unit-tested.

REQUIRES ISOLATED DATABASE VALIDATION:

- Concurrent duplicate dispatch.
- Concurrent partial dispatch.
- Transaction rollback with canonical and legacy updates.
- Database unique constraint and replay race.
- Retry after canonical movement and legacy projection failure.
- Real NCM webhook/sync duplicate and stale-event behavior.

NOT IMPLEMENTED:

- Stable first-class correction/reversal key.
- Reversal beyond existing physical/receipt evidence.
- Destination put-away receipt session for dispatch.

## 9. Test execution evidence

Current verification command:

```sh
cd backend
node --test tests/stockTransferService.test.js tests/inventoryLedgerService.test.js tests/locationScope.test.js tests/rbacAuthorization.test.js tests/stockTransferReconciliationService.test.js tests/stockTransferReconciliationReportService.test.js tests/stockTransferReconciliationController.test.js
```

Result: **134 passed, 0 failed**.

P6-R3H-specific focused command:

```sh
cd backend
node --test --test-name-pattern="manufacturer transfer dispatch source scope|manufacturer transfer source middleware|canonical dispatch plan|dispatch request normalization" tests/stockTransferService.test.js tests/locationScope.test.js
```

Result: **5 passed, 0 failed**.

Accounting evidence command:

```sh
cd backend
node --test --test-name-pattern="manufacturer local freight dispatch creates one shipment-linked payable bill" tests/accountingOperationalPosters.test.js
```

Result: **1 passed, 0 failed**.

P6-R3H-added tests identifiable in tracked diff:

- canonical dispatch plan exact quantity/reference test
- duplicate-line/invalid/over-dispatch test
- dispatch request normalization duplicate-safe test

Location source tests in `backend/tests/locationScope.test.js` cover P6-R3H
source middleware behavior, but that file is untracked and cannot have its
P6-R3H provenance proven by the tracked diff alone.

Syntax:

- `node --check` passed for P6-R3H source, route and test files.

Static:

- `git diff --check` passed.
- Documentation link/fence validation passed.
- Secret-pattern scan passed.
- No database, schema, migration or external call occurred.

## 10. Remaining risks

VERIFIED limitation:

- P6-R3H is only database-independent.

P6-R3I subsequently adds NCM custody/source fail-closed validation and
legacy/canonical projection consistency checks in
[16-p6-r3i-webhook-dispatch-authorization-and-legacy-projection-consistency.md](./16-p6-r3i-webhook-dispatch-authorization-and-legacy-projection-consistency.md).
Persisted webhook identity, reconciliation legacy comparison and database
concurrency remain open.
- HTTP source middleware is applied to only manual/NCM/compatibility routes.
- NCM webhook/sync and reconciliation remain without R3B HTTP location scope.
- Freight accounting is a real dispatch-time side effect.

PARTIAL:

- Canonical dispatch helper is shared for manual/NCM/own-store paths.
- Legacy projection writes remain.
- Reservation/direct balance updates remain separate from movement.

NOT IMPLEMENTED:

- Destination location middleware for transfer dispatch.
- Persistent correction/reversal.
- Physical/custody reconciliation.
- Real persisted concurrency.
- Complete receiving integration.
- Complete accounting movement isolation.

## 11. Recommended next increment
P6-R3I has addressed the bounded NCM custody/source fail-closed validation and
legacy projection consistency checks. The next increment should implement
persisted account/location identity and isolated database proof only after
separate approval:

- Persisted destination/source location assignment.
- NCM reconciliation authorization and full dispatch-trigger location scope.
- Legacy/canonical reconciliation persisted source comparison.
- Receipt and reversal/correction integration.
- Add persisted receipt session and reversal/correction schema only after DBA
  approval.
- Add isolated MySQL concurrency tests for exact dispatch/replay and legacy
  projection consistency.
