# P6-R3H - Canonical Stock-Transfer Dispatch Implementation

**Status:** PARTIALLY VERIFIED - DATABASE-INDEPENDENT DISPATCH HARDENING
**P6-R3G:** COMPLETE - IMPLEMENTATION PLAN
**P6-R3:** INCOMPLETE
**Persistent transfer receiving:** NOT IMPLEMENTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Existing dispatch path before implementation

Stock-transfer dispatch existed in
`backend/controllers/stockTransferController.js`. Manual, own-store and verified
NCM paths created shipment records and called `dispatchShipmentStock`.
`dispatchShipmentStock` already delegated physical quantity movement to
`applyInventoryMovement` with `TRANSFER_DISPATCH`, so canonical dispatch balance/
ledger movement was partly reused.

Gaps remained:

- Dispatch line planning existed only inside the controller.
- Shipment quantities were normalized at the controller but no reusable canonical
  dispatch plan described movement identity and stable reference.
- Shipment source authorization verified manufacturer profile/entity ownership,
  but no reusable server-resolved source-location middleware covered transfer
  dispatch routes.
- Approval, reservation and dispatch quantities used separate counters.
- Repeated shipment requests had booking idempotency, but movement-specific
  planning was not exposed/tested independently.
- Legacy `ManufacturerInventory`/`StockLog` compatibility writes remained in the
  same dispatch path.

## 2. Implementation changes

### 2.1 Reusable canonical dispatch plan

`backend/services/stockTransferService.js` now exports:

- `normalizeDispatchRequestLines`
- `assertDispatchAvailability`
- `planCanonicalTransferDispatch`

The plan:

- Requires transfer and shipment identities.
- Requires a verified in-transit location.
- Requires a unique, positive exact quantity for each shipment line.
- Verifies each quantity remains within approved minus already dispatched.
- Resolves the exact inventory SKU and transfer line.
- Produces `TRANSFER_DISPATCH` descriptors with:
  - stable shipment line and transfer line references
  - source factory and destination transit locations
  - exact whole-unit quantity
  - `PLATFORM` ownership through the canonical helper
  - shipment/transfer reference
  - deterministic dispatch idempotency key
  - actor, role and reason

`dispatchShipmentStock` now calls this plan before applying each canonical
movement. It no longer constructs the canonical dispatch payload inline.

### 2.2 Source-location authorization

`backend/middleware/locationScope.js` now exports
`createRequireManufacturerTransferSourceLocation` and
`requireManufacturerTransferSourceLocation`.

The middleware:

- Resolves the transfer by server-side transfer ID.
- Confirms the transfer manufacturer matches the authenticated manufacturer.
- Resolves the transfer's server-side source location.
- Rejects missing or inactive locations.
- Rejects non-`PLATFORM` ownership.
- Rejects cross-manufacturer source access.
- Records a source-location authorization denial audit event.
- Ignores client-supplied location IDs.

The stock-transfer route applies it to:

- manual `/api/stock-transfers/:id/dispatch`
- NCM `/api/stock-transfers/:id/ncm-booking`

The manufacturer route applies it to:

- `/api/manufacturer/stock-requests/:id/dispatch`

This is a bounded source-location check. It does not add warehouse roles,
account-location assignments or persisted location authorization.

### 2.3 Existing canonical helper reuse

The controller still calls `applyInventoryMovement` for the planned
`TRANSFER_DISPATCH` movements. It does not write a second canonical balance or
ledger entry.

Dispatch still runs in the existing controller transaction/serializable pattern.
The helper provides exact replay/conflict behavior and optimistic balance
predicates, but real persisted concurrency remains unverified.

## 3. What remains unchanged

- No Prisma schema or migration changes.
- No database connection or database-backed test.
- No receipt/persistent receiving implementation.
- No reversal/correction API.
- No general stock-transfer cancellation implementation.
- No COGS, revenue, distributor receivable or accounting journal posting.
- NCM provider behavior remains external and unchanged.
- Legacy `ManufacturerInventory` and `StockLog` compatibility writes remain
  secondary projections.

## 4. Dispatch behavior boundaries

Approval and reservation are not dispatch:

- Approval changes transfer authorization.
- Reservation changes unreserved/available quantity state.
- Dispatch applies a source-to-transit canonical movement.
- Shipment status or an NCM booking is not physical dispatch evidence.

An eligible line is dispatchable only when quantity is positive and no greater
than approved minus already dispatched.

The existing `applyInventoryMovement` replay prevents exact same-key payload
duplication. A changed payload under the same key remains an idempotency conflict.

## 5. Tests

Database-independent tests added or extended:

- exact canonical dispatch plan
- stable references and stable dispatch idempotency key
- duplicate transfer-line dispatch rejection
- invalid/zero dispatch quantity
- over-dispatch rejection
- exact dispatch request normalization
- duplicate shipment-line normalization
- invalid quantity text
- server-resolved manufacturer transfer source
- cross-manufacturer source denial
- missing/inactive/cross-location source behavior

Relevant existing tests cover canonical replay/conflict, insufficient stock,
reservation, NCM lifecycle, stock-transfer status and reconciliation.

## 6. Validation status

The implementation has database-independent unit/mocked test evidence only.
It does not establish:

- persisted concurrency
- MySQL transaction isolation
- database uniqueness behavior
- real serializable conflict behavior
- physical dispatch/custody verification

All deferred receiving, reversal and reconciliation closure behavior remains
outside P6-R3H.

P6-R3I subsequently added database-independent NCM custody/source validation
and legacy projection consistency checks. It does not add persisted identity,
database concurrency or reconciliation comparison.

## 7. Files changed

- `backend/services/stockTransferService.js`
- `backend/controllers/stockTransferController.js`
- `backend/middleware/locationScope.js`
- `backend/routes/stockTransferRoute.js`
- `backend/routes/manufacturerRoute.js`
- `backend/tests/stockTransferService.test.js`
- `backend/tests/locationScope.test.js`
- `docs/phase-6/14-p6-r3h-canonical-stock-transfer-dispatch-implementation.md`
- Phase 6/tracker documentation references

## 8. Post-implementation verification

The actual verification report is
[15-p6-r3h-v-dispatch-implementation-verification.md](./15-p6-r3h-v-dispatch-implementation-verification.md).
It concludes that P6-R3H is only partially verified:

- Canonical movement planning and the three mounted HTTP source-location routes
  are verified database-independently.
- NCM webhook/sync dispatch is not covered by HTTP source-location middleware.
- Legacy `ManufacturerInventory` projection writes remain alongside canonical
  movement.
- Manual dispatch can create a separate logistics expense/payable journal.
- Persisted concurrency, real transaction rollback and full-route authorization
  remain unverified.
