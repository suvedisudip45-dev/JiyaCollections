# P6-R3J - Canonical Stock-Transfer Receipt Foundation

**Status:** COMPLETE - DATABASE-INDEPENDENT RECEIPT FOUNDATION
**P6-R3H:** PARTIALLY VERIFIED
**P6-R3H-V:** COMPLETE - VERIFICATION ONLY
**P6-R3I:** COMPLETE - DATABASE-INDEPENDENT
**P6-R3:** INCOMPLETE
**Generic warehouse/supplier receiving:** NOT IMPLEMENTED
**Existing stock-transfer receipt:** PERSISTED ROUTE EXISTS; R3J helpers are not integrated
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Source audit

The existing stock-transfer receipt path is in
`backend/controllers/stockTransferController.js`. It uses:

- `StockTransferReceipt`
- `StockTransferReceiptLine`
- `StockTransferShipmentLine`
- `StockTransferLine`
- canonical `InventoryBalance`
- canonical `InventoryLedgerEntry`
- `applyInventoryMovement`
- `normalizeShipmentReceiptLines`
- `buildReceiptRequestHash`

The path already enforces exact whole-number quantities, partial remaining
shipment quantities, duplicate line rejection, evidence URL shape and receipt
replay hash/conflict checks. It does not expose a separate pure receipt
eligibility or canonical receipt-plan service.

P6-R3J adds those pure functions to
`backend/services/stockTransferService.js` without adding persistence or route
writers. This does not mean the repository has no persisted receipt path: the
bounded stock-transfer receipt route already persists receipt and line records
and posts canonical movements. R3J does not replace or integrate with it.

## 2. Receipt eligibility

`evaluateTransferReceiptEligibility` validates:

- Stable transfer, shipment and shipment-line identities.
- Eligible transfer lifecycle state.
- Eligible shipment lifecycle state.
- Dispatch timestamp.
- Canonical `TRANSFER_DISPATCH` evidence.
- Exact dispatch quantity and inventory SKU.
- Transfer source location, when supplied by dispatch evidence.
- Previously received quantity.
- Outstanding dispatched quantity.
- Proposed accepted/damaged/rejected/missing/excess quantities.
- Put-away quantity.
- Destination authorization and destination location status/ownership.

If evidence is missing or contradictory, it returns an explicit thrown
domain error rather than a guessed receipt eligibility result.

## 3. Exact quantity semantics

The service uses exact safe whole numbers.

The quantity partition is:

- `acceptedQuantity`: good units eligible for destination stock.
- `damagedQuantity`: good? no; units moved to damaged location.
- `rejectedQuantity`: inspected but not accepted; no canonical stock increase.
- `missingQuantity`: not accounted/arrived; loss exception.
- `excessQuantity`: exception quantity above eligible dispatch.
- `putAwayQuantity`: accepted quantity physically assigned or placed.

Rules:

- Accepted + damaged + rejected + missing cannot exceed outstanding dispatched
  quantity.
- Put-away cannot exceed accepted quantity.
- Missing and excess quantities remain explicit exceptions.
- Excess quantity requires approved exception authorization.
- Rejected quantity creates no accepted-stock movement.
- Previous received quantity is not double counted.

## 4. Canonical movement planning

`buildCanonicalStockTransferReceiptPlan` creates movement descriptors only.
It does not call Prisma or mutate inventory.

Accepted quantities produce:

- `TRANSFER_RECEIPT`
- source: in-transit location
- destination: distributor location
- stable receipt/session and shipment-line reference

Damaged quantities produce:

- `DAMAGE`
- source: in-transit location
- destination: damaged location

Missing quantities produce:

- `LOSS`
- source: in-transit location
- destination: lost location

Rejected quantities produce no stock-increase movement.

Each descriptor uses:

- exact quantity
- inventory SKU
- stable movement idempotency key
- actor/role
- transfer receipt reference
- source/destination location

The movement plan is not a writer. Its persistence must remain a future
transaction that atomically commits receipt state, balance and ledger.

## 5. Replay and idempotency

`evaluateStockTransferReceiptReplay` distinguishes:

- `NEW_RECEIPT`
- `REPLAY`
- `RECEIPT_IDEMPOTENCY_CONFLICT`

Receipt identity and request hash must both be present for replay evaluation.
The same identity and hash is replay; a changed hash or different identity is
not silently merged.

It does not create database uniqueness or prove concurrency.

## 6. Destination authorization

Receipt eligibility accepts explicit pure destination authorization.

Destination must:

- have a stable ID
- be active
- be kind `DISTRIBUTOR`
- have `inventoryOwner = PLATFORM`
- match the transfer distributor ID

The existing `locationScope` middleware is a server-side source/destination
foundation, but no stock-transfer receipt route is wired to a destination
location middleware in this increment.

## 7. Implemented tests

Database-independent tests include:

- receipt eligibility with valid dispatch evidence
- partial, exception and over-dispatch quantities
- missing dispatch evidence
- missing/unauthorized destination
- cancelled/completed transfer rejection
- exact canonical accepted/damaged/missing movement descriptors
- rejected-only receipt creates no stock movement
- stable replay/new/conflict behavior
- exact whole-number receipt quantities

Focused command:

```sh
cd backend
node --test tests/stockTransferService.test.js tests/locationScope.test.js tests/inventoryLedgerService.test.js tests/ncmWebhookSimulator.test.js
```

Result: **54 passed, 0 failed**.

This suite is mocked/database-independent. It does not prove Prisma transaction
atomicity or persisted concurrency.

## 8. Files changed

- `backend/services/stockTransferService.js`
- `backend/tests/stockTransferService.test.js`
- `docs/phase-6/17-p6-r3j-canonical-stock-transfer-receipt-foundation.md`

No controller, route, Prisma model, migration or persisted stock/receipt record
was changed.

## 9. Deferred work

- Generic warehouse/supplier receipt header/line/session models and endpoints.
- Integration of the pure R3J helpers into the existing stock-transfer receipt
  route.
- Put-away persistence and confirmation.
- Receipt correction/reversal.
- Destination middleware integration for stock-transfer routes.
- Persisted database uniqueness and concurrent partial receipt locking.
- Reconciliation repair/exception closure.
- Accounting and cost posting.

P6-R3J is a pure foundation. Generic warehouse/supplier receiving and put-away
remain NOT IMPLEMENTED; the existing bounded stock-transfer receipt route is
persistent and must be hardened separately.

P6-R3K independently verified R3J in
[18-p6-r3k-receipt-foundation-verification-and-reconciliation-readiness.md](./18-p6-r3k-receipt-foundation-verification-and-reconciliation-readiness.md).
The verification corrected prior-received, approved/dispatched, linked dispatch
evidence, destination consistency and authorized-excess classification gaps.
Rejected/excess receipt, put-away and receipt-session reconciliation still
require future approved persistence scope.
