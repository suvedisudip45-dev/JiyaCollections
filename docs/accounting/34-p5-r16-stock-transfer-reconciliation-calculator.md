# P5-R16 — Pure Stock Transfer Reconciliation Calculator

**Status:** Implemented in code; synthetic unit-test evidence only  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**  
**Evidence boundary:** No database, external system, physical inventory, or persisted report was accessed or validated.

## 1. Scope and implementation

The calculator is in `backend/services/stockTransferReconciliationService.js` and exports:

```js
reconcileStockTransfers(input)
```

It accepts already-loaded source snapshots, makes no Prisma or network calls, performs no file I/O, and does not change transfer, inventory, or accounting state. It does not import production inventory-writing services. Results are ordered deterministically by transfer ID, SKU/line ID, severity, code, and stable source identifiers. It uses no clock, random value, or mutable process state.

P5-R15 described the proposed export as `buildStockTransferReconciliation`; P5-R16 uses the existing service naming pattern and exports `reconcileStockTransfers` instead. No endpoint, UI, scheduled task, worker, schema field, or migration was added.

## 2. Current model semantics used

The calculator was checked against `backend/prisma/schema.prisma`, `backend/controllers/stockTransferController.js`, `backend/services/stockTransferService.js`, and `backend/services/inventoryLedgerService.js`.

- `StockTransferLine.approvedQuantity` is nullable. A pending transfer may legitimately have no approved quantity; a null on other states is not treated as an approved zero.
- `reservedShipmentQuantity` is separate from `dispatchedQuantity`. The calculator derives reservations from supplied active booking shipment lines and compares that amount with the transfer-line counter.
- `IN_TRANSIT` is not treated as dispatch evidence. It can describe an active reservation or approved remaining quantity. Dispatch quantity requires a valid dispatch timestamp and/or an exact linked ledger movement; shipment status alone produces insufficient evidence.
- Booking-only statuses (`PREPARING`, `BOOKING_PENDING`, `BOOKING_UNKNOWN`, `BOOKED`) contribute reservation quantities, not dispatched quantities. Failed booking retries are not counted as dispatch merely because shipment rows exist.
- Dispatch movement rows reference `STOCK_TRANSFER` and the transfer ID. The expected dispatch idempotency key includes shipment and SKU. The calculator requires the key, transfer reference, PLATFORM owner, SKU, source, and shipment-specific transit destination to agree.
- Receipt lines contain separate good, damaged, and missing quantities. Good receipts use `TRANSFER_RECEIPT`; damaged and missing quantities use `DAMAGE` and `LOSS`. Receipt movement keys identify the receipt and shipment line, but the schema has no ledger foreign key to that line.
- `InventoryBalance.quantityOnHand` and movement quantities are Prisma `Int`. Quantities are validated as whole values in the signed 32-bit range where appropriate; no decimal or monetary arithmetic is performed.
- Distributor-held inventory is reported as company-owned (`PLATFORM`). Discrepancy quantities are not converted into distributor liability, expenses, or journals.

## 3. Input and output contract

Required input arrays:

```js
{
  transfers,
  shipments,
  receipts,
  discrepancies,
  ledgerEntries,
  balances,
  locations,
  coverage: {
    transfers, shipments, receipts, discrepancies,
    ledgerEntries, balances, locations
  },
  sourceErrors?: ["ledgerEntries", ...]
}
```

Each `coverage` member must be `true` before the calculator considers that source complete. Missing arrays, false coverage, unavailable source names, malformed IDs, invalid quantities, ambiguous location links, and unlinked receipt/dispatch details are surfaced as incomplete or unavailable; they are not silently replaced with zero.

The result contains:

- `reportStatus`: `NO_EXCEPTION_DETECTED`, `EXCEPTION_DETECTED`, `RECONCILIATION_INCOMPLETE`, or `DATA_UNAVAILABLE`.
- `coverage` and `unavailableSources`.
- Transfer and line summaries with separate requested, authorized, reserved, dispatched-counter, dispatched-shipment, dispatched-ledger, reported-receipt, receipt-ledger, authorized-unshipped, outstanding-transit, and open-discrepancy quantities.
- Stable exception keys, codes, severity, transfer/shipment/receipt/discrepancy/ledger identifiers, expected and actual quantities when determinable, explanation, and investigation status.

Pure-function results intentionally omit a report run ID and detection timestamp. A future caller must provide run metadata and audit logging; it must not add current-time or random behavior to this calculator.

## 4. Invariants and calculations

- **Authorization:** positive approved quantities require reviewer and approval timestamp evidence. A pending line with null approval remains unauthorized and distinct from a zero-approved line.
- **Reservations:** active booking shipment quantities are reconciled separately against `reservedShipmentQuantity`; they are not dispatched inventory.
- **Dispatch:** shipment-line quantities with dispatch evidence are compared with `dispatchedQuantity` and uniquely linked `TRANSFER_DISPATCH` movements. Duplicate or unlinked movements are not silently counted as valid dispatch.
- **Receipt:** receipt-line good, damaged, and missing totals remain separate from matched receipt-ledger quantities. Receipt cannot establish dispatch. Partial receipts are not promoted to full receipts.
- **Transit:** outstanding transit is computed only when dispatch and receipt movement linkage is complete. It is the non-negative difference of linked dispatch and receipt quantities where determinable; it is not proof of physical carrier custody.
- **Balances:** for every supplied PLATFORM location/SKU pair, all supplied ledger history is netted by source and destination and compared with `quantityOnHand`. Comparisons require complete balance, ledger-history, and location snapshots.
- **Cancellation:** cancellation does not erase previously recorded quantities or ledger movements.
- **Precision:** quantities are parsed as exact integer values, using `BigInt` for aggregation before safe serialization. Invalid, negative, decimal, non-finite, or out-of-range quantities are not accepted as zero.

## 5. Exception classifications

All emitted exceptions require investigation; none can be automatically resolved.

| Code | Implemented detection |
|---|---|
| `MISSING_AUTHORIZATION` | Positive approved quantity or dispatch/receipt evidence without verifiable approval evidence. |
| `DISPATCH_WITHOUT_LEDGER_ENTRY` | A dispatch timestamp exists but no unique matching dispatch movement exists in a complete ledger snapshot. |
| `RECEIPT_WITHOUT_DISPATCH` | Receipt lines exist but no defensibly linked dispatch movement exists. |
| `PARTIAL_RECEIPT` | Reported receipt disposition is positive but less than the quantity supported by dispatch evidence. |
| `QUANTITY_MISMATCH` | Invalid or inconsistent transfer, reservation, shipment, receipt, movement, or balance quantities; includes missing expected receipt movement where source snapshots are complete. |
| `MISSING_RECEIPT` | A uniquely linked dispatch movement has no linked receipt-line record in a complete receipt snapshot. |
| `DUPLICATE_MOVEMENT` | Duplicate idempotency keys or duplicate semantic movement slots are detected; duplicates are not accepted as a single valid movement. |
| `ORPHAN_LEDGER_ENTRY` | A transfer/receipt-referenced ledger row cannot be assigned to a source transfer/shipment-line or receipt-line when the relevant source snapshots are complete. |
| `BALANCE_MISMATCH` | Supplied complete ledger history does not net to the supplied PLATFORM balance, including negative on-hand quantities. |
| `INVALID_STATUS_TRANSITION` | A status is unsupported or conflicts with recorded authorization, booking, dispatch, or receipt quantities. |
| `CANCELLED_WITH_RECORDED_MOVEMENT` | A cancelled transfer/shipment retains positive quantity or movement evidence. |
| `UNRESOLVED_IN_TRANSIT` | Matched dispatch movements exceed matched receipt movements. |
| `INSUFFICIENT_EVIDENCE` | Required coverage, actors, timestamps, identifiers, location links, or defensible movement links are absent or ambiguous. |

`MISSING_RECEIPT` is not emitted from a status label or an incomplete receipt source. A missing receipt ledger movement is represented as a `QUANTITY_MISMATCH`; no stock correction is created.

## 6. Unit-test evidence

`backend/tests/stockTransferReconciliationService.test.js` uses synthetic fixtures only. The focused suite covers:

- Full dispatch/receipt, partial dispatch, partial receipt, reservations, and unresolved transit.
- Missing dispatch evidence and ledger movements; missing receipt movement; receipt without dispatch.
- Duplicate dispatch/receipt movements, orphan and unlinked movements, and balance mismatch.
- Cancellation, invalid status, missing authorization, over-dispatch, over-receipt, and incomplete source coverage.
- Multiple transfers sharing a SKU/location, pending null authorization, Prisma Int boundaries and invalid values.
- Deterministic repeated results, no input mutation, and malformed receipt-line linkage.

Relevant existing pure tests are also run for `stockTransferService`, `inventoryLedgerService`, and `inventoryValuationReconciliationService`. No database integration tests are part of this evidence.

The combined focused Node test command passed **58/58** tests:

```sh
node --test backend/tests/stockTransferReconciliationService.test.js backend/tests/stockTransferService.test.js backend/tests/inventoryLedgerService.test.js backend/tests/inventoryValuationReconciliationService.test.js
```

`node --check` passed for the calculator and its test file. `git diff --check` passed. `backend/package.json` defines no lint script, so no backend lint command was available.

## 7. Limitations and integration dependencies

- Dispatch shipment-line association still relies on the existing idempotency-key convention plus movement fields and a shipment-specific transit location. There is no relational ledger shipment-line foreign key; rows that cannot be linked exactly remain unlinked/incomplete.
- Receipt association likewise relies on existing receipt/line idempotency-key conventions. The calculator does not invent schema relationships.
- It cannot prove physical stock, carrier handoff, distributor custody, opening-balance completeness, deployed data quality, or consistency among legacy Product, `ManufacturerInventory`, and `StockLog` projections.
- A complete supplied ledger is an input assertion, not independently verified evidence. `InventoryBalance.reservedQuantity` may contain reservations from other workflows and is not treated as a transfer-only reservation total.
- Open discrepancy quantities remain investigation data, not proof of cause or financial responsibility.
- The calculator does not enforce authorization or expose data. A separately approved Admin read-only integration must establish permission checks, bounded loading, a consistent snapshot, source coverage, audit/run metadata, and failure behavior before persisted validation.
- Database integration and persisted/physical acceptance remain blocked until an isolated database endpoint is independently verified and authorized.

## 8. Read-only and release status

There are no database clients, Prisma imports, API calls, inventory mutations, journals, receivables, expenses, or automatic exception resolutions in the calculator. Company ownership of distributor-held stock remains unchanged.

P5-R16 is **IMPLEMENTED IN CODE; SYNTHETIC UNIT TEST EVIDENCE ONLY**. This is not persisted reconciliation or proof of inventory accuracy. Phase 5 remains **PARTIAL / INCOMPLETE**; R8 remains partial; P4.2 incomplete; P4.3 in progress/incomplete; Phase 4 incomplete. No Phase 6 or Phase 7 work was started.
