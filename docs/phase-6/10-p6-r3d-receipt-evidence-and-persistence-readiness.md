# P6-R3D - Receipt Evidence, Identity and Persistence Readiness

**Status:** COMPLETE - STATIC RECEIPT READINESS AND PERSISTENCE-DESIGN ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3B:** COMPLETE - EXISTING-SCHEMA LOCATION/RBAC FOUNDATION
**P6-R3C:** COMPLETE - STATIC RECEIVING CONTRACT AND DATABASE-INDEPENDENT VALIDATION
**Persistent receiving:** NOT IMPLEMENTED
**P6-R3:** INCOMPLETE
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. R3C implementation review

`backend/services/receivingContractService.js` is a pure contract validator.
It defines lifecycle states, exact integer normalization, lifecycle transitions,
inspection disposition reconciliation, over/under receipt checks and partial
put-away authorization.

Verified:

- Lifecycle states are explicitly listed and transitions fail closed.
- Integer values use safe whole numbers within the existing 2,147,483,647
  inventory limit.
- Accepted, rejected, damaged, missing, quarantined and put-away quantities
  remain separate fields.
- Put-away cannot exceed accepted quantity or use the same source/destination.
- Validation does not mutate input objects.
- The module has no Prisma, filesystem, network, accounting or movement calls.

One R3C arithmetic defect was corrected: short/outstanding quantity now
represents remaining source quantity as
`dispatched - previously received - current arrived`. It no longer subtracts
put-away, which is a later physical-placement state. A focused test covers
partial receipt with prior receipt and partial put-away.

## 2. Existing source identity

### Stock transfer

Source header: `StockTransfer.id`.

Stable source lines: `StockTransferLine.id`, paired with
`StockTransferLine.inventorySkuId`.

Supporting records:

- `StockTransferShipment.id`
- `StockTransferShipmentLine.id`
- `StockTransferReceipt.id`
- `StockTransferReceiptLine.id`
- `InventoryDiscrepancy.id`

The source has requested, approved and dispatched quantities and supports
multiple shipment lines/partial receipts. Receipt quantity cannot exceed the
remaining shipment quantity. Duplicate shipment lines are rejected by
normalizers and schema uniqueness.

The route is mounted at `/api/stock-transfers`; receipt uses
`transfer:distributor_receive` and distributor context. The controller creates
canonical transfer receipt/damage/loss movements in a serializable transaction.

### Distributor stock return

Source header: `DistributorStockReturn.id`.

Stable source lines: `DistributorStockReturnLine.id`, paired with inventory SKU.

Collections provide stable `DistributorStockReturnCollection.id` and
`DistributorStockReturnCollectionLine.id`; they support partial collection and
warehouse receipt. Receipt counts reconcile good/damaged/missing units to each
collected quantity. `receiptIdempotencyKey` and `receiptRequestHash` provide
replay/conflict protection.

This flow already creates a return receipt location and canonical movements.
It is return custody/inspection evidence, not a supplier goods receipt or sale.

### Manufacturer production

Source header: `ManufacturerProductionRequest.id`.

Stable source lines:
`ManufacturerProductionRequestLine.id`, with size/color and quantity/actual
quantity.

The production workflow creates accepted production cost layers and a
`PRODUCTION_RECEIPT` at a factory location. It has request/line identity and
deterministic production receipt keys. It is not a general warehouse PO/GRN
and does not prove central warehouse receipt.

### Supplier inbound shipment

`InboundShipment` has stable `id` and unique `batchNumber`, plus JSON `items`,
supplier name, invoice number and cost/payment totals. It lacks:

- Stable supplier identity.
- Purchase-order identity.
- Purchase-order line identity.
- Goods receipt header and line identity.
- Dispatched/arrived/inspected/accepted/rejected quantity by line.
- PO/dispatch/GRN links.
- Receipt evidence/event history.
- Canonical inventory movement reference.

It is an accounting/batch shipment snapshot, not verifiable receipt lineage.

### Customer and exchange returns

Customer returns have `CustomerReturn.id/requestKey` and JSON item snapshots.
Exchange requests have `OrderExchangeRequest.id/requestKey/requestHash`.
NCM/status history and receipt timestamps are present, but their physical and
inventory semantics differ by route. JSON item records do not provide the stable
line identity required for a universal inbound receipt model.

## 3. Receipt identity and idempotency

The persistent receipt model should distinguish:

1. **Receipt document identity:** stable UUID plus an optional source-scoped
   business receipt number.
2. **Receipt line identity:** stable UUID tied to one receipt and one source line.
3. **Receipt event identity:** stable UUID and append-only event type/history.
4. **Physical session identity:** stable delivery session or controlled
   request identity.

A receipt may contain multiple source lines and one delivery may produce multiple
receipt documents/sessions. Partial receipts must retain source line and
remaining-quantity linkage.

Deterministic replay scope:

- Receipt document: source type + source document ID + controlled receipt
  session ID.
- Receipt line: receipt document ID + source line ID + disposition.
- Put-away: receipt line ID + staging location ID + destination location ID
  + quantity.
- Movement posting: canonical movement idempotency key derived from receipt
  event/line/location/SKU.

The request key and canonical payload hash must match for replay. A key reused
with different source, line, quantity, location, actor or disposition is
`IDEMPOTENCY_CONFLICT`.

No supplier delivery-note number should be assumed globally unique. It is
evidence only until reconciled with the source and supplier identity.

Unplanned inbound stock must use a separately approved exception request,
with no purchase order or receipt source that is merely invented.

## 4. Evidence contract

Minimum evidence by stage:

| Event | Minimum evidence |
|---|---|
| Expected delivery | Approved source document/line and expected quantity |
| Physical arrival | Authorized arrival confirmation, source/delivery reference, timestamp |
| Receipt initiation | Authenticated receiver, destination/staging location |
| Identity verification | Exact SKU/variant and source line mapping |
| Quantity verification | Count, counter if required, source line and remaining quantity |
| Inspection | Inspector, result, timestamp, discrepancy evidence |
| Accepted/rejected | Authorized disposition and exact quantity |
| Damage/shortage | Condition, quantity, evidence and discrepancy record |
| Discrepancy approval | Independent approver where policy requires, reason and source |
| Put-away assignment | Source/destination location, line quantity and actor |
| Physical placement | Placement confirmation and accepting executor |
| Movement posting | Canonical actor/reference/idempotency/ledger result |

System audit events and upload URLs are supporting evidence. An upload or
delivery status is not proof of inspection or physical placement without an
authorized action tied to the receipt line.

## 5. Proposed persistence model

No schema was changed. A future approved implementation may require:

### GoodsReceipt

- Stable UUID.
- Source type.
- Source document ID/type.
- Supplier/manufacturer/other party reference.
- Receiving location.
- Status/lifecycle.
- Created/received/completed timestamps.
- Creator/receiver/approver actors.
- Unique request/idempotency key.
- Request hash.

Indexes: source, status, source + source line, created time.

### GoodsReceiptLine

- Stable UUID.
- Receipt ID.
- Source line ID.
- Inventory SKU/variant.
- Ordered/authorized, dispatched, arrived, inspected, accepted, rejected,
  damaged, missing, quarantined and put-away quantities.
- Evidence/reason references.

Unique: `(receiptId, sourceLineId)` while enforcing partial-session semantics
separately. Source line plus session may require a session/receipt relationship.

### GoodsReceiptEvent

- Stable UUID.
- Receipt ID.
- Event type, from/to status.
- Actor and role.
- Effective/recorded timestamps.
- Evidence and authorization references.
- Request/event idempotency key.

### PutAwayLine

- Receipt line ID.
- Source/staging location.
- Destination location.
- Quantity.
- Physical confirmation/actor.
- Canonical movement reference.
- Idempotency key.

### Evidence and discrepancy relations

Use existing `InventoryDiscrepancy` for inventory exceptions where it is
applicable, and add receipt/dispute evidence links without copying mutable
source data. Inspection result and discrepancy approval should be explicit
records/events.

Essential first-increment fields are stable identity, source line, exact
quantities, actor/evidence, lifecycle, idempotency and movement reference.
Cost and invoice matching are separate future fields.

## 6. Posting and recovery boundary

At the line level:

1. Receipt acceptance records evidence and exact accepted/disposition quantities.
2. Put-away confirmation verifies staged/destination scope and placed quantity.
3. Canonical movement adds balance/ledger entry.
4. Receipt line/status closes only after the movement and put-away evidence commit.

Receipt acceptance and put-away confirmation may remain pending when physical
confirmation or approval is missing. The accepted-to-balanced movement and
ledger entry must remain atomic in the existing caller transaction.

Partial put-away creates one receipt event/ledger movement per confirmed line
fragment. Completion occurs only when cumulative put-away equals accepted
quantity. Rejected/damaged/quarantined units remain exception/non-saleable
states and do not enter available stock.

Reversal requires a linked compensating movement and original evidence trail,
never deletion or mutation of the historical receipt/movement.

Concurrent receipt submissions use database uniqueness and transaction isolation
in the future persisted implementation. Mocked tests cannot prove this.

## 7. Ownership and costing blockers

Supplier receipt remains blocked until:

- Supplier and purchase source identity are approved.
- Ownership/title timing is approved.
- Accepted quantity evidence is linked to source line.
- Acquisition cost authority and invoice matching are approved.
- Landed-cost allocation policy is approved.
- Any liability/payable posting policy is approved.

Manufacturer production receipt is a scoped accepted-production/cost-layer
evidence path, but title and central-warehouse custody remain separate.

A physical arrival or accepted quantity must not create supplier payable or
journal. Catalog `costPrice`, `InboundShipment` totals and manufacturer quote
values are not authoritative substitute cost evidence.

The internal NPR two-decimal/HALF_EVEN policy remains internal bookkeeping
policy only.

## 8. Legacy migration

Existing candidate historical sources:

- `StockTransferReceipt` / `StockTransferReceiptLine`.
- `DistributorStockReturnCollection` receipt fields.
- `StockLog`.
- `ManufacturerProductionRequestLine` / production actuals.
- `InboundShipment`.
- Legacy `ManufacturerInventory` and direct `Product` stock changes.
- Customer RMA/exchange records.

Classification rules:

- **Verifiable:** stable source and line IDs, exact quantities, evidence,
  replay identity and canonical movement/receipt linkage.
- **Partially evidenced:** source exists but one receipt stage, line, quantity
  or actor/evidence is missing.
- **Ambiguous:** array/JSON snapshots, name/size/color only, duplicate delivery
  references or conflicting legacy quantities.
- **Unmatched balance:** balance/stock value cannot be linked to movement/history.
- **Exception:** remain isolated and explicitly unreconciled.

No missing source line, arrival, inspection or title should be fabricated.
Legacy population migration requires separate isolated review and approved
cutover/backfill policy.

## 9. Smallest safe first persistent increment

The smallest implementation should not begin with general supplier procurement.
It should implement one existing source with a stable line model:
**stock-transfer receipt persistence hardening** or a similarly bounded
existing return receipt.

Required:

- Existing source/line/location uniqueness remains.
- Receipt header/session is explicit if not already equivalent.
- Request hash and stable Idempotency-Key are mandatory.
- Receipt line status stores exact good/damaged/missing quantities.
- Put-away or destination movement uses R3A movement helper atomically.
- R3B server-side source/destination scope is enforced.
- Rejected/damaged/missing units remain discrepancy/evidence states.
- No invoice, payable or COGS behavior is added in this increment.

Schema must be proposed and approved before implementation:

- Receipt event/history relation if not represented sufficiently.
- Put-away/confirmed placement relation.
- Source line receipt/session relation for partial sessions.
- Reversal/correction reference relation.
- Evidence review fields and actor/approver relationship.
- Unique indexes for source session/line and idempotency.
- Foreign keys using `Restrict`/`Cascade` according to historical retention.

Database-independent tests:

- Partial receipt.
- Duplicate source line.
- Replay same hash.
- Conflicting reuse.
- Over/under/short receipt.
- Split put-away.
- Put-away overflow.
- Source/destination unauthorized.
- Canonical movement replay.
- Input immutability.

Persisted integration tests require an independently verified isolated database:

- Serializable concurrent receipt.
- Ledger/balance/receipt atomic rollback.
- Idempotency race.
- Partial receipt/correction/reversal.
- Location scope and audit.
- Migration/rollback and historical exceptions.

## 10. Files and validation

R3C implementation defects corrected:

- `backend/services/receivingContractService.js`
- `backend/tests/receivingContractService.test.js`

Deliverables:

- `docs/phase-6/10-p6-r3d-receipt-evidence-and-persistence-readiness.md`

Tracking and architecture references will be updated.

No database, schema, migration, receipt, inventory, supplier, financial,
accounting or external provider behavior was changed.

