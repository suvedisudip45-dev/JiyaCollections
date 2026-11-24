# P6-R3A - Canonical Inventory Movement and Balance Foundation

**Status:** COMPLETE - DATABASE-INDEPENDENT IMPLEMENTATION
**P6-R2D:** COMPLETE - STATIC WRITE-PATH/RBAC DESIGN
**P6-R3:** PLANNED - OVERALL IMPLEMENTATION NOT STARTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Scope and evidence boundary

This increment hardens the existing canonical application-layer inventory
movement boundary in `backend/services/inventoryLedgerService.js`. It does not
add a competing service, change Prisma models, migrate database writers, run
database-backed tests, or mutate inventory/accounting records.

The existing `applyInventoryMovement` service already:

- Updates `InventoryBalance` and creates `InventoryLedgerEntry` in the caller
  transaction.
- Checks exact idempotency replay and detects conflicting payloads.
- Rejects inactive or missing SKUs and locations.
- Rejects platform-ownership or location conflicts.
- Checks source on-hand and available quantity.
- Applies optimistic `updateMany` predicates for balance concurrency attempts.

The existing schema has the minimum fields used by this foundation:

- `InventoryLedgerEntry.idempotencyKey` with database uniqueness.
- SKU, source/destination location, quantity, movement type, owner, reference,
  cost-layer link, actor, role and reason.
- `InventoryBalance` unique location/SKU balance with on-hand/reserved quantity.
- `InventoryDiscrepancy` for exception evidence.

No reversal or correction movement type is established by this implementation.
The current ledger is append-only in the helper and does not silently edit
historical entries.

## 2. Implemented movement contract

`normalizeInventoryMovement` is now exported and performs exact validation:

- Movement type must be in the existing canonical movement set.
- Quantity must be a positive safe whole number or an exact integer string.
- Fractional, negative, zero, malformed and out-of-range quantities are rejected.
- `TRANSFER_DISPATCH` and `TRANSFER_RECEIPT` require source and destination.
- `FULFILLMENT` requires source and rejects destination.
- `OPENING_BALANCE` and `PRODUCTION_RECEIPT` require destination and reject source.
- `RETURN` requires destination.
- `DAMAGE` and `LOSS` require source and destination.
- `ADJUSTMENT` requires exactly one source or destination location.
- Every movement requires active workspace actor evidence, reason and stable
  idempotency key.

`applyInventoryMovement` remains the shared atomic operation. It:

- Replays an existing exact ledger entry.
- Rejects same-key/different-payload reuse.
- Updates source and destination balances.
- Creates the immutable ledger entry in the caller transaction.
- Returns a structured replay or new-movement result.
- Performs no revenue, COGS or accounting mutation.

## 3. Balance and transaction invariants

The helper applies source decrement before destination increment only after:

- SKU validation.
- Active, platform-owned location validation.
- Exact on-hand and unreserved source availability checks.
- Destination overflow checks.

The caller transaction owns atomicity. A caller failure prevents ledger and
balance changes from persisting together. The helper's mock tests verify the
mock boundary rollback pattern but do not prove real database isolation or
constraint behavior.

Reservations remain a separate counter and are not a physical movement. A
transfer to a distributor remains custody and does not create accounting
recognition.

Persisted concurrent-write safety remains unverified without an isolated database.
The existing `updateMany` predicates improve optimistic concurrency in deployed
code, but real conflict/serialization behavior was not database-tested.

## 4. Writer integration

No new legacy writer was migrated in P6-R3A.

Existing evidence confirmed that stock-transfer dispatch/receipt, distributor
stock damage/loss, stock return and production receipt already call
`applyInventoryMovement` in selected paths. This increment does not claim every
stock-write path is converted or every direct ledger/balance writer removed.

Deferred legacy and direct writers:

- Product add/update and dedicated Admin stock adjustment.
- Storefront/Admin order catalog stock decrements.
- Customer RMA restock.
- Distributor self-delivery customer-return random-idempotency direct writes.
- Distributor exchange replacement direct balance/ledger writes.
- Supplier returns.
- Manufacturer direct-order route, which remains unmounted.
- Manufacturer legacy inventory updates.

No newly integrated workflow has dual active movement paths in this increment.

## 5. Schema blockers and unresolved requirements

Existing schema is sufficient for P6-R3A database-independent movement validation
and for extending the existing helper.

The following cannot be established or resolved by R3A:

- Stable reversal/correction linkage is not represented as an explicit
  movement contract.
- Warehouse identity, warehouse hierarchy and bin models are not established.
- Location-scoped warehouse operator identity and permissions are not modeled.
- Multi-quantity/unit semantics beyond whole units are not stored.
- Persisted concurrent transaction behavior remains unverified.
- The direct-write return paths still lack deterministic replay identities.
- Opening stock/cutoff/owner evidence is not established by source code alone.

These require separate schema/policy/isolated-data decisions rather than
invented helper fields or random identifiers.

## 6. Tests

Database-independent command:

```sh
cd backend
node --test tests/inventoryLedgerService.test.js
```

Result: 10 passed, 0 failed.

Relevant combined regression command:

```sh
cd backend
node --test tests/inventoryLedgerService.test.js tests/stockTransferReconciliationService.test.js tests/stockTransferService.test.js
```

Result: 82 passed, 0 failed.

The tests use mocks or controlled doubles. They do not prove real database
transaction isolation, Prisma constraints, persisted concurrency or physical
stock.

## 7. Files changed

- `backend/services/inventoryLedgerService.js`
- `backend/tests/inventoryLedgerService.test.js`
- `docs/phase-6/07-p6-r3a-canonical-inventory-movement-foundation.md`
- Updated Phase 6/ERP trackers and architecture references

## 8. P6-R3A verification and P6-R3B prerequisites

Static validation passed:

- Movement helper and test syntax.
- Route mount status: manufacturer direct-order route remains unmounted.
- Existing permission identifiers remain unchanged.
- Relative documentation links and Markdown fences.
- `git diff --check`.

P6-R3B prerequisites:

- Warehouse identity/location hierarchy approval.
- Warehouse and operator permission/resource ownership design.
- Persistently isolated database and migration/recovery controls.
- Physical warehouse receiving/picking/dispatch evidence and status policy.
- Persistent transaction/concurrency validation.
- Resolution of warehouse opening stock, count and maker/checker thresholds.

P6-R3A does not start P6-R3B.

