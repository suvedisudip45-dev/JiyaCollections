# P5-R17 — Duplicate Transfer and Cost-Evidence Controls

**Status:** Implemented in code; synthetic unit-test evidence only  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**  
**Evidence boundary:** No database, external system, physical inventory, or persisted cost valuation was inspected.

## 1. Scope

P5-R17 extends the P5-R16 pure calculator in `backend/services/stockTransferReconciliationService.js` without changing the exported `reconcileStockTransfers(input)` interface. It adds conservative duplicate signals and transfer-line cost-evidence coverage. The service remains independent of Prisma Client, database/network/file operations, current time, and random identifiers. Inputs remain read-only.

The current data model was checked statically in `backend/prisma/schema.prisma`, `backend/services/inventoryLedgerService.js`, `backend/services/stockTransferService.js`, and `backend/controllers/stockTransferController.js`, alongside P5-R7, P5-R14, and P5-R15 documentation.

## 2. Duplicate detection

### Confirmed identifier / idempotency conflicts

- `DUPLICATE_TRANSFER_IDENTIFIER` identifies multiple supplied transfer records with the same stable `StockTransfer.id`. It is a confirmed snapshot identity collision, not proof that two distinct business requests were duplicated. The calculator does not merge or select one record; that transfer is omitted from line reconciliation and the report is incomplete.
- `TRANSFER_IDEMPOTENCY_CONFLICT` identifies multiple shipment records sharing the schema-unique `StockTransferShipment.bookingIdempotencyKey`. It compares transfer ID, request hash, and shipment-line identities/quantities and returns all involved transfer and shipment IDs. Conflicting payloads are explicit; even identical repeated key records violate the supplied unique-key identity expectation.
- The `StockTransfer` model itself has no transfer-creation idempotency key. Shipment booking does have `bookingIdempotencyKey` and `bookingRequestHash`. The calculator does not invent a transfer idempotency field.

These are source-record integrity conflicts; they do not trigger deletion, cancellation, merge, or stock correction.

### `POSSIBLE_DUPLICATE_TRANSFER`

The calculator groups transfer records only when the complete business fingerprint matches:

1. Exact normalized `requestedAt` timestamp (ISO instant; no time window or current-time comparison).
2. Exact non-empty `requestedByAccountId`.
3. Manufacturer and distributor IDs.
4. Source and destination location IDs.
5. The complete set of unique inventory SKU IDs and positive requested integer quantities, sorted independently of input order.

Each matching fingerprint yields one low-severity `POSSIBLE_DUPLICATE_TRANSFER` exception with the sorted IDs of every transfer in that group. The result is a review candidate only, never a confirmed business duplicate. Different timestamp, requester, party, location, SKU, or requested quantity prevents grouping. Missing comparison fields yield `INSUFFICIENT_EVIDENCE`, not a guessed match. There is no configurable window because neither the P5-R15 design nor the transfer model establishes one. Similarity of quantities and locations alone is not sufficient.

No source reference is available on the current `StockTransfer` model; matching such a field is not assumed. No automatic duplicate cancellation or correction is performed.

## 3. Cost-evidence classifications

The calculator adds `costEvidence` per transfer line, separately from quantity reconciliation. It reports quantities of units with evidence, not monetary values; it never calculates unit cost, inventory value, or COGS.

| Classification | Evidence rule in this increment |
|---|---|
| `AUTHORITATIVE_COST_LAYER` | For dispatched shipment lines, supplied `StockTransferShipmentLineCostLayer`-shape records must have `status = DISPATCHED`, valid positive whole-unit quantities, and a matching supplied layer with the same SKU and manufacturer plus a valid non-negative decimal `unitCogs`. The valid allocation quantity is counted only when allocation quantity plus recorded uncosted quantity exactly covers the shipment line. Multiple layers can jointly cover one line. |
| `VERIFIED_RECEIVED_COST` | A matched good receipt ledger movement has `productionCostLayerId` pointing to a supplied, valid cost layer matching that transfer line's SKU and manufacturer. This is received-unit layer-link evidence, not a financial posting. |
| `HISTORICAL_COST_SNAPSHOT` | An explicitly supplied supplemental evidence record with `transferLineId`, `evidenceId`, classification, and non-negative integer quantity. It remains a historical snapshot, not an authoritative layer. |
| `REFERENCE_OR_CATALOG_COST` | An explicitly supplied supplemental catalog/reference evidence record. It does not become an authoritative layer. In particular, `Product.costPrice` is a mutable Float catalog value and is not sufficient proof of acquired unit cost. |
| `ESTIMATE` | An explicitly supplied estimate record. It remains an estimate and is not promoted to authoritative or verified received cost. |
| `UNRECONCILED` | Cost coverage is incomplete, a source link or layer identity conflicts, shipment allocation quantities do not reconcile, or supplied evidence is explicitly unresolved. |
| `MISSING` | Applied only to a positive `StockTransferShipmentLine.uncostedQuantity` on a shipment line with dispatch evidence. The code records that quantity as unallocated to an existing production cost layer; it produces `UNCOSTED_TRANSFER_QUANTITY` for investigation. Missing cost evidence is not interpreted as zero value. |

`coverage.costLayers` is optional and true only when the caller supplied a complete `costLayers` array. The supplemental `costEvidence` array is optional; its `coverage.costEvidence` flag indicates that source is complete. If the calculator cannot establish the layer/allocations, the cost result is `UNRECONCILED` and authoritative covered quantity is `null`, not zero. The existing top-level stock `reportStatus` retains its P5-R16 meaning; consumers must inspect the separate `coverage.costLayers` and per-line `costEvidence.status`.

The only definitive `UNCOSTED_TRANSFER_QUANTITY` finding in this increment is the persisted shipment-line uncosted quantity with defensible dispatch evidence. A missing `productionCostLayerId` on a dispatch ledger row alone is not sufficient: dispatch cost allocations live on `StockTransferShipmentLineCostLayer`, and ledger movements may not carry a layer link. No exception is inferred solely because a caller omits optional cost sources.

## 4. Model and policy limitations

- `ManufacturerInventoryCostLayer.unitCogs` is the strongest current source for accepted production cost, but does not cover every purchase, opening quantity, return, damage/loss, or legacy stock.
- `StockTransferShipmentLineCostLayer` allocates source production layers to shipment lines and tracks `RESERVED`, `DISPATCHED`, and `RELEASED`. Shipment line `uncostedQuantity` records quantities that the allocation planner could not map to existing layers.
- `InventoryLedgerEntry.productionCostLayerId` is optional. Receipt movement rows may carry the layer link; dispatch rows reference the transfer and shipment idempotency key, without a shipment-line foreign key.
- `ManufacturerInventoryCostAllocation`, accepted order-item snapshots, `Product.costPrice`, manufacturer proposed/agreed quotes, and legacy cost fields are not interchangeable. No system-wide approved FIFO/weighted-average method was established; FIFO behavior in selected allocation paths is not extended to other workflows.
- No complete supplier procurement receipt/acquisition-cost layer, historical opening-stock cost lineage, or independent cost-source population is established. Supplemental historical/reference/estimate records are reported as supplied claims with their evidence IDs; the calculator cannot independently verify their source.
- Dispatch and receipt are custody/location movements under Aama Clothings' continuing ownership policy. They do not represent a customer sale, inventory relief for COGS, distributor ownership, or a distributor receivable.

## 5. Tests and validation

`backend/tests/stockTransferReconciliationService.test.js` now includes P5-R16 regressions plus P5-R17 synthetic cases for duplicate transfer IDs, booking idempotency conflicts, conservative fingerprint dimensions, missing comparison fields, multi-record grouping and order-independent output; and authoritative/verified/historical/reference/estimate/unreconciled/missing cost evidence, partial and multi-layer coverage, and non-COGS custody behavior.

The calculator test file passed **53/53** tests, including all 29 P5-R16 regression cases and 24 P5-R17 cases. The combined calculator, stock-transfer-service, inventory-ledger-service, and inventory-valuation-reconciliation suites passed **82/82**:

```sh
node --test backend/tests/stockTransferReconciliationService.test.js backend/tests/stockTransferService.test.js backend/tests/inventoryLedgerService.test.js backend/tests/inventoryValuationReconciliationService.test.js
```

`node --check` passed for the service and test file; `git diff --check` passed. A static scan found no Prisma client/query, database transaction, network, filesystem, clock, or random-ID calls in the calculator. Tests use synthetic data only. Database-backed, persisted, supplier, production, title, physical-count, and valuation evidence remains outside this result.

## 6. Status and next gate

P5-R17 adds code-level exception detection only. It does not prove a business duplicate, inventory value, cost population completeness, physical existence, or posted COGS. A future read-only integration still requires explicit permission, complete source loading, consistent snapshots, audit/run metadata, and the independently verified isolated-database gate. No endpoint, UI, schema, migration, stock mutation, accounting mutation, or automatic resolution was introduced.

P5-R17 is **IMPLEMENTED IN CODE; SYNTHETIC UNIT TEST EVIDENCE ONLY**. Phase 5 remains **PARTIAL / INCOMPLETE**; Phase 4 remains incomplete; Phase 6 and Phase 7 were not started.
