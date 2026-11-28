# P6-R3K - Receipt Foundation Verification and Reconciliation Readiness

**Status:** COMPLETE - DATABASE-INDEPENDENT VERIFICATION AND NARROW CORRECTION
**P6-R3J:** COMPLETED FOR PURE FOUNDATION SCOPE
**Generic warehouse/supplier receiving:** NOT IMPLEMENTED
**Existing stock-transfer receipt:** PERSISTED ROUTE EXISTS; R3J helpers are not integrated
**P6-R3:** INCOMPLETE
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Executive assessment

P6-R3J provides pure eligibility, replay and movement-planning helpers. It did
not implement a new persistent receipt lifecycle: the repository already has a
bounded persistent stock-transfer receipt route, which remains separate from
the new helpers. Generic warehouse/supplier receiving and put-away are not
implemented.

Verification found and corrected these helper gaps:

- Eligibility and planning now require consistent transfer, shipment and line
  links plus a canonical dispatch reference, idempotency key, source, transit
  destination, owner and exact quantity.
- The planned destination must be the transfer's stored destination.
- The planner now requires dispatch evidence and approved/dispatched quantities.
- Cumulative prior plus current receipt quantities are bounded by the shipment
  line, and an authorized excess remains an explicit exception.
- Explicit null, blank and boolean quantities are rejected; whole-unit values
  are bounded by Prisma `Int` range.

No new receipt writer, route, schema or database migration was added. No
database or external system was accessed.

## 2. Source implementation evidence

P6-R3J functions in `backend/services/stockTransferService.js`:

- `normalizeReceiptWholeNumber`
- `evaluateTransferReceiptEligibility`
- `evaluateStockTransferReceiptReplay`
- `buildCanonicalStockTransferReceiptPlan`

Supporting live code:

- `receiveStockTransferShipment`
- `normalizeShipmentReceiptLines`
- `buildReceiptRequestHash`
- `applyInventoryMovement`
- `locationScope.js`
- P5-R16–R19 reconciliation service/formatter/API
- `stockTransferRoute.js`, `StockTransferReceipt`/line Prisma models, and
  `stockTransferService.test.js`
- P6-R3C receiving contract, P6-R3D evidence/readiness report,
  P6-R3E blueprint, P6-R3F readiness, P6-R3G plan, P6-R3H-V verification,
  P6-R3I report, and current canonical inventory specification

The live `receiveStockTransferShipment` controller persists
`StockTransferReceipt` and `StockTransferReceiptLine` and posts canonical
movements inside its existing transaction. The new pure R3J functions are not
called by that controller. They are therefore verification/planning helpers,
not the active receipt implementation and not proof of persistent correctness.

## 3. Quantity arithmetic verification

The helpers use nonnegative whole numbers within the supported Prisma `Int`
range (`0..2,147,483,647`). JavaScript numbers are used only after safe-integer
and range checks; accepted totals are bounded by the dispatched quantity before
remaining quantity is calculated.

```text
outstanding_before = dispatched - previously_received
accounted_this_receipt = accepted + damaged + rejected + missing
outstanding_after = outstanding_before - accounted_this_receipt
```

Example boundary cases:

- Dispatch 10, prior 0, accepted 10 => outstanding 0, full receipt.
- Dispatch 10, prior 4, accepted 6 => outstanding 0; a repeated partial cannot
  exceed the remaining 6.
- Dispatch 10, prior 0, accepted 9, missing 1 => outstanding 0 and
  `SHORT_RECEIPT`; missing is not accepted stock.
- Dispatch 10, prior 0, accepted 10, excess 1 => the excess requires explicit
  authorization, remains `EXCESS_RECEIPT`, and creates no accepted movement.
- Damage and rejection are separate dispositions; neither is added to accepted
  quantity. Put-away remains a subset of accepted quantity and does not change
  the receipt partition.
- Zero is valid for an optional disposition, but an all-zero receipt is
  rejected. Negative, fractional, unsafe/out-of-range, null, blank and boolean
  quantities are rejected.

Defects corrected:

- Cumulative accepted/damaged/missing/rejected plus prior received cannot
  exceed the shipment line.
- Eligibility and planning reject shipment quantities above approved or
  recorded dispatched quantities.
- Transfer → shipment → shipment-line → transfer-line identity links and
  destination-location identity are checked rather than inferred from IDs
  merely being present.
- Authorized excess is returned as an explicit exception instead of appearing
  as an exception-free full receipt.

## 4. Dispatch evidence and identity

The pure helpers now require the supplied dispatch evidence snapshot to match:

- Stable transfer ID.
- Stable shipment ID.
- Stable shipment-line ID.
- The shipment's transfer ID and shipment-line-to-transfer-line link.
- Stable inventory SKU.
- `TRANSFER_DISPATCH`, `PLATFORM` ownership, `STOCK_TRANSFER` reference to the
  transfer, and the canonical dispatch idempotency key.
- Exact dispatched quantity, transfer source location and transit destination.
- The destination location stored on the transfer.

The service can compare these fields but cannot prove they were read from a
genuine unique ledger row. `exists` and the evidence properties are still
caller-supplied inputs; the pure helper has no database reader. The active
controller obtains the shipment and transfer through Prisma and the canonical
executor checks movement/location invariants, but R3J is not integrated into
that route. A future adapter must resolve and verify the evidence server-side.

The pure replay helper distinguishes:

- New receipt.
- Exact replay.
- Identity conflict.
- Idempotency hash conflict.

The pure replay helper's identity is application-level only. Separately, the
existing live controller uses a database-unique receipt `idempotencyKey` and
`requestHash`; this source-level observation does not establish database
deployment, transaction concurrency or crash-recovery guarantees.

## 5. Canonical movement planning

The pure plan creates descriptors for movement types supported by
`inventoryLedgerService.js`:

- `TRANSFER_RECEIPT`: accepted quantity to distributor destination.
- `DAMAGE`: damaged quantity to damaged location.
- `LOSS`: missing quantity to lost location.

Rejected quantity creates no stock movement.

It preserves Aama ownership by:

- source/destination `PLATFORM` destination validation.
- distributor location as custodian destination.
- no revenue/COGS/receivable fields.

The plan does not execute a movement, deduct source stock, or change balances.
`applyInventoryMovement` remains the canonical executor. Although movement
types and location directions are supported, the pure plan's accepted-good
idempotency key is not the active controller's cost-layer-suffixed key. The
plan is therefore not a drop-in adapter for the existing receipt writer;
integrated idempotency/cost-layer compatibility must be designed and tested
before use. No revenue, COGS, receivable or ownership-transfer fields are
created by the plan.

## 6. Destination authorization

The pure eligibility and plan validate:

- active destination
- platform ownership
- distributor kind
- distributor ID consistency
- exact equality with the server-resolved transfer destination ID
- an explicit authorization flag for eligibility

The existing receipt route is distributor-authorized and loads the shipment
from the server, verifies its transfer belongs to the authenticated
distributor, and uses the transfer's stored destination rather than a
client-supplied location. The canonical movement executor validates active
PLATFORM-owned locations. The route is not wired to R3J's pure helper or
`locationScope` destination middleware, so those helper checks are not route
enforcement; the current route's authorization and R3J's separate validation
must not be conflated. The route is not an Admin global-access route.

Client destination substitution is not accepted by the current controller
because destination identity is server-resolved. A dedicated destination
middleware and end-to-end authorization tests remain a hardening prerequisite.

## 7. Reconciliation compatibility

The read-only reconciliation calculator compares supplied shipment, receipt,
ledger, location and balance snapshots. Its current classifications map as
follows:

| Receipt outcome | Current reconciliation support | Limitation |
|---|---|---|
| Dispatched, not received | `MISSING_RECEIPT` and/or `UNRESOLVED_IN_TRANSIT` | Indicates missing receipt evidence or unmatched quantity, not proof of loss |
| Partial receipt | `PARTIAL_RECEIPT`; residual transit is `UNRESOLVED_IN_TRANSIT` | No receipt-session lifecycle state |
| Full receipt | Inferred from source and movement totals matching dispatch | No distinct `FULL_RECEIPT` classification |
| Excess receipt | `QUANTITY_MISMATCH` when recorded totals exceed shipment/dispatch | No dedicated excess disposition or approval evidence |
| Damaged | `DAMAGE` movement quantity/source/destination checked against receipt line | Damage detail is limited to the existing `damageType` field |
| Rejected | Not represented by existing receipt schema | No rejected quantity to reconcile |
| Duplicate receipt movement | `DUPLICATE_MOVEMENT` | Does not establish duplicate receipt-session identity |
| Receipt without dispatch | `RECEIPT_WITHOUT_DISPATCH` | Blocks relying on receipt as dispatch proof |
| Missing movement evidence | `DISPATCH_WITHOUT_LEDGER_ENTRY`, `INSUFFICIENT_EVIDENCE`, or `QUANTITY_MISMATCH` | Classification depends on supplied snapshot coverage |
| Destination/balance mismatch | `INSUFFICIENT_EVIDENCE` for invalid location; `BALANCE_MISMATCH` for ledger/balance divergence | Does not identify a physical count variance |
| Unresolved discrepancy | Open discrepancy records remain reportable; transit can be `UNRESOLVED_IN_TRANSIT` | No auto-close, liability, charge, or repair |
| Put-away or correction | No dedicated classification | Neither is part of the current receipt schema/lifecycle |

The calculator is therefore useful for the existing good/damaged/missing
receipt schema, but cannot distinguish rejected, excess, put-away or
receipt-session/replay outcomes. The smallest safe reconciliation additions
after a separately approved schema/API increment are explicit classifications
for rejected/excess quantity and receipt identity, plus source-linked
put-away/correction evidence. Do not repair balances or close exceptions in
reconciliation.

No reconciliation exception should be automatically closed or repaired.

## 8. Tests

Executed from `backend/`:

```sh
node --test tests/stockTransferService.test.js
```

Result: **29 passed, 0 failed**.

Executed from `backend/` for dispatch, ledger, authorization and reconciliation
regressions:

```sh
node --test tests/stockTransferService.test.js tests/inventoryLedgerService.test.js tests/locationScope.test.js tests/stockTransferReconciliationService.test.js tests/stockTransferReconciliationReportService.test.js tests/stockTransferReconciliationController.test.js tests/ncmWebhookSimulator.test.js
```

Result: **140 passed, 0 failed**.

The modified pure receipt tests executed cover:

- valid full and partial receipt, shortage, damage, rejection and authorized excess
- zero, negative, fractional, unsafe/out-of-range, null, blank and boolean quantities
- missing/conflicting dispatch evidence and source/destination identity mismatch
- inactive/unauthorized destination, cancellation and completion rejection
- cumulative prior receipt, approved/dispatched limits and rejected-only no-movement plan
- exact replay, conflicting receipt identity and idempotency-hash conflict
- canonical movement destinations and no financial fields/source re-deduction

Existing reconciliation tests were inspected and executed for missing/partial
receipt, receipt without dispatch, duplicate/missing movements, balance
mismatch, unresolved transit, cancellation and status conflicts. No test in
this iteration establishes persistent uniqueness, transaction concurrency or
database isolation. All test commands were database-independent.

Additional executed checks:

- `node --check backend/services/stockTransferService.js`
- `node --check backend/tests/stockTransferService.test.js`
- `git diff --check`
- Markdown local-link and code-fence check: 7 edited documentation files
- Common exposed-secret pattern scan: no matches

## 9. Defects found and corrections

- Removed duplicate and contradictory approved/dispatched checks.
- Required consistent transfer/shipment/line identities and canonical dispatch
  reference, owner, source, transit destination, quantity and idempotency key.
- Bound receipt destination to the transfer's stored destination.
- Required dispatch proof and non-null approved/dispatched quantities for
  movement planning.
- Classified an authorized excess explicitly; it is not counted as accepted or
  moved into stock.
- Rejected null, blank and boolean quantities in the shared whole-number
  normalizer.

These are pure validation changes and tests only. They do not prove that the
evidence object came from a unique persisted movement or that receipt and ledger
writes are concurrency-safe.

## 10. Persistent receiving prerequisites

Before any future persistence or integration work:

- DBA-provisioned isolated test database, with written confirmation that it is
  not production and cannot share production credentials/data.
- Independently verify the database endpoint, server identity, database name,
  user privileges and network route before connecting; never infer isolation
  from a database name.
- Verified backup and restore evidence for the isolated environment.
- Approved migration plan, preflight checks, rollback procedure and recovery
  owner; schema diff and migration review must not include unrelated objects.
- Stable receipt/session and source-line identity, with persisted unique
  idempotency constraints and request-hash conflict behavior.
- Explicit transaction boundaries for receipt, disposition, discrepancy,
  balance, ledger, audit and cost-layer effects.
- Concurrent partial-receipt protection (row locking or equivalent) and tests
  proving competing requests cannot over-receive.
- Atomic destination balance and movement writes, with source transit deduction
  exactly once and durable retry/crash recovery.
- Evidence-backed historical transfer/receipt reconciliation and an approved
  classification policy for existing receipt lines.
- Post-migration physical inventory verification and reconciliation sign-off.
- Approved rejected/excess, damage, discrepancy, put-away and correction
  policies; no implied distributor liability or accounting effect.

None of these prerequisites was attempted or proven in this database-independent
iteration.

## 11. Recommended next increment

The next increment should first close the source and authorization contract
gaps, then—only after the persistence prerequisites are approved—integrate the
pure helper into the existing stock-transfer receipt path:

- Resolve canonical dispatch and transit evidence server-side and verify exact
  transfer/shipment/line/location links.
- Align receipt movement idempotency with existing cost-layer allocation.
- Reuse existing `StockTransferReceipt` and `StockTransferReceiptLine` if
  migration is additive and approved.
- Add explicit previously received/cumulative received fields or derive them
  transactionally from existing receipt lines.
- Add rejected/excess distinction if approved.
- Add dedicated destination location middleware or prove equivalent route
  enforcement with end-to-end authorization tests.
- Keep `applyInventoryMovement` as the canonical executor.
- Add database uniqueness and serializable concurrency tests.
- Preserve the existing reconciliation/reporting exception model.

Generic receiving and put-away remain unimplemented; do not claim that existing
bounded stock-transfer receipt persistence proves a generic receiving lifecycle.
