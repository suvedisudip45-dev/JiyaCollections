# P6-R3C - Receiving and Put-Away Contract

**Status:** COMPLETE - STATIC CONTRACT AND DATABASE-INDEPENDENT VALIDATION ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3B:** COMPLETE - EXISTING-SCHEMA LOCATION/RBAC FOUNDATION
**P6-R3:** PLANNED - OVERALL IMPLEMENTATION NOT STARTED
**P6-R3D:** COMPLETE - RECEIPT EVIDENCE AND PERSISTENCE READINESS
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Existing receipt and procurement evidence

No active supplier purchase-order, goods-received-note or supplier-invoice
matching workflow was found. `InboundShipment` stores supplier name, invoice
number, shipment date, freight, customs/tax, item cost and payment fields as a
legacy shipment/acquisition snapshot. It is not an evidence chain for an
accepted PO, received quantity, inspection or canonical inventory movement.

`SupplierReturn` is a supplier-return/debit workflow, not an inbound goods
receipt.

The active bounded receiving paths are:

- Stock-transfer shipment receipt:
  `receiveStockTransferShipment` validates the distributor workspace,
  shipment/distributor ownership, Idempotency-Key and request hash, then creates
  `StockTransferReceipt`/line records and canonical transfer receipt,
  damage and loss movements in a serializable transaction.
- Distributor stock-return warehouse receipt:
  `receiveDistributorStockReturnCollection` validates collected line quantities,
  good/damaged/missing totals, evidence, request hash and replay. It moves return
  units from return transit to a `RETURN_RECEIPT` location and records
  discrepancies.
- Customer return physical receipt:
  NCM and workflow state can set `RECEIVED_AT_WAREHOUSE`, but this is separate
  from inspection and stock restock.
- Customer exchange receipt/inspection:
  status and inspection models exist, while inventory movement may depend on
  legacy or distributor-canonical paths.
- Manufacturer production acceptance:
  accepted good units create a production receipt/cost layer in the existing
  factory location. It is not a general supplier GRN.

The existing stock-transfer receipt normalizer:

- Requires at least one known shipment line.
- Prevents duplicate shipment-line entries.
- Uses exact safe integers.
- Requires good/damaged/missing totals not to exceed remaining dispatched quantity.
- Requires approved damage types.
- Normalizes evidence and deterministic request hashes.

The existing distributor stock-return receipt normalizer similarly requires all
collected SKU lines and reconciles good/damaged/missing units to collected
quantity.

These are reusable proof patterns but do not constitute a universal receiving
model for supplier procurement or central warehouse put-away.

## 2. Receiving lifecycle

The proposed lifecycle is:

`EXPECTED -> ARRIVAL_REPORTED -> RECEIPT_INITIATED -> INSPECTION_PENDING ->
INSPECTED -> DISCREPANCY_OPEN -> PUT_AWAY_PENDING ->
PARTIALLY_PUT_AWAY -> COMPLETED`

`CANCELLED` and `BLOCKED` are exception/terminal states. The pure contract in
`backend/services/receivingContractService.js` validates allowed transitions
and does not persist state.

Stage distinctions:

| Stage | Physical custody | Availability | Canonical movement |
|---|---|---|---|
| Expected | None | No | No |
| Arrival reported | Arrival may be unverified | No | No |
| Receipt initiated | Receiving/staging custody claimed | No | No |
| Inspection pending | Staged non-saleable/unknown | No | No |
| Inspected | Accepted/rejected/damaged/quarantined quantities separated | Accepted only pending put-away | No by status alone |
| Discrepancy open | Quantity evidence remains at custody stage | No automatic available quantity | No accounting/automatic financial charge |
| Put-away pending | Accepted goods remain in staging | No | No |
| Partial put-away | Accepted goods partially placed | Destination saleability only after placement policy | Only for confirmed placement |
| Completed | All accepted quantities physically placed | Destination state becomes governed | Traceable put-away entries |

Expected, dispatch or NCM status is not physical arrival. Arrival is not
inspection or acceptance. Put-away selection is not physical placement.

## 3. Exact quantity contract

The receiving contract distinguishes:

- Ordered quantity.
- Dispatched quantity.
- Arrived quantity.
- Inspected quantity.
- Accepted quantity.
- Rejected quantity.
- Damaged quantity.
- Missing/short quantity.
- Excess quantity.
- Quarantined quantity.
- Put-away quantity.
- Previously received quantity.
- Outstanding quantity.

Exact rules:

- Use safe whole numbers within the existing `Prisma Int` range.
- `accepted + rejected + damaged + missing + quarantined == inspected`.
- Inspected quantity cannot exceed arrived quantity.
- Put-away quantity cannot exceed accepted quantity.
- Partial put-away is cumulative and cannot exceed accepted quantity.
- Receipt lines cannot repeat the same source line.
- A line-level accounted quantity cannot exceed its remaining dispatched quantity.
- Missing and over/under discrepancies remain explicit exceptions.
- Excess received units require an approved over-receipt policy.
- Corrections use additive compensating movements and immutable history.
- Repeated receipt request identity with the same hash is replay; changed details
  conflict.
- A repeated retry cannot post accepted quantity twice.

The database-independent
`calculateReceivingQuantities` helper reports short and outstanding quantities
and rejects under-inspection, mismatch, over-inspection and put-away overflow.
It does not infer source documents or persist quantities.

## 4. Inspection and quarantine

Inspection must separate:

- Incorrect or unidentified product/SKU.
- Incorrect size or color.
- Damage.
- Missing quantity.
- Quality failure.
- Missing documentation or label.
- Quarantine due to unresolved evidence.
- Rejected goods that remain with the source or carrier.

Rejected/damaged/quarantined goods never enter available sellable balance.
Damage and missing quantities create discrepancy evidence, not supplier,
manufacturer or distributor liability or receivable.

Discrepancy resolution requires:

- Source document and dispatch/receipt reference.
- Exact SKU/variant/quantity.
- Evidence and inspection notes.
- Receiving actor.
- Independent approval for consequential resolution where applicable.
- Destination custody state.
- Linked correction or compensating movement.

## 5. Put-away and canonical movement integration

A put-away must move accepted units only after physical placement confirmation
from receiving staging to an approved warehouse or sub-location.

The target movement is:

- Source: receiving staging or inspected accepted location.
- Destination: warehouse available location or approved storage location.
- Type: future movement-specific receipt/put-away type; no generic free-form
  balance mutation.
- Quantity: exact put-away units.
- Actor/evidence: physical placer and checker/approver where required.
- Idempotency: stable receipt/line/location quantity key.
- Transaction: canonical balance + ledger entry + receipt line state together.

Quarantine, damaged and rejected goods use different locations and are not
available for allocation. Put-away must not be posted based on UI selection
alone.

P6-R3A's `applyInventoryMovement` remains the canonical balance/ledger boundary.
P6-R3B's `locationScope` contract remains reusable for server-resolved source
and destination authorization.

## 6. Supplier and manufacturer boundaries

### Supplier receipts

Missing models:

- Supplier identity/master.
- Purchase request/order/line.
- Goods receipt note and receipt line.
- Dispatch/arrival evidence.
- Inspection and put-away records.
- Supplier invoice match.
- Accepted cost/landed-cost lineage.

The existing `InboundShipment` is a batch cost snapshot, not a PO/GRN. It must
not be converted into accepted inventory automatically.

Posting is blocked until supplier title/timing, accepted quantity, acquisition
cost, invoice match and landed-cost policy are approved.

### Manufacturer production

Production completion is separate from a general warehouse receiving path.
Accepted good production counts may already create a factory
`PRODUCTION_RECEIPT` and production cost layer. Central warehouse receipt,
inspection and transfer remain separate evidence.

The manufacturer direct-order route is unmounted and is not a goods receipt or
supplier purchase path.

## 7. Accounting boundaries

No receiving implementation in this increment creates accounting effects.

The system must keep separate:

- Expected purchase value.
- Supplier invoice value.
- Verified acquisition cost.
- Estimated cost.
- Freight/customs/landed-cost components.
- Accepted quantity.
- Inventory valuation.
- Supplier payable.
- Accounting journal.

`Product.costPrice`, manufacturer quote values and inbound shipment estimates
remain non-authoritative for receipt cost unless a separate approved evidence
chain establishes them.

No FIFO, weighted average or standard-cost policy is selected here.

## 8. Receiving RBAC and segregation of duties

Existing route permissions include:

- `transfer:distributor_receive`.
- `transfer:admin_review` and `transfer:admin_read`.
- `returns:admin_inspect`.
- `returns:admin_refund`.
- `manufacturer:production_manage` and `manufacturer:production_admin`.
- `inventory:ledger_read`.

Future receiving capabilities need separate, approved permissions for:

- View expected receipts.
- Initiate receipt.
- Confirm physical arrival.
- Inspect goods.
- Accept/reject quantities.
- Resolve discrepancies.
- Assign put-away.
- Confirm put-away.
- Approve exceptions.
- View receipt history.

Maker/checker separation is required for consequential acceptance/discrepancy,
write-off or financial consequences. P6-R3B currently provides reusable
location scope but not persisted account/location assignments or proposed
warehouse role grants.

## 9. Required schema changes

No schema change was applied. Future implementation would require proposal and
approval for:

- Supplier and purchase request/order/line.
- Goods receipt note and receipt line.
- Receipt stage/event history.
- Arrived, inspected, accepted, rejected, damaged, missing and quarantined quantities.
- Put-away line and physical confirmation.
- Receipt discrepancy and investigation relation.
- Invoice/PO/GRN matching lineage.
- Receipt cost evidence and landed-cost allocation.
- Warehouse/staging/destination location hierarchy.
- Account/location assignment and unique assignment constraints.
- Maker/checker approval relations.
- Receipt revision/correction linkage.

Unique idempotency keys and foreign-key restrictions must preserve history.
No migration is authorized by this contract.

## 10. Implementation sequence

- **R3C-A — Receipt evidence model:** supplier/PO/dispatch/GRN and return/production
  source lineage. Requires separate policy and schema.
- **R3C-B — Lifecycle and quantity validation:** implement persisted lifecycle
  using the pure receiving contract; synthetic tests first.
- **R3C-C — Inspection/discrepancy:** quarantine/damage/missing evidence and
  independent discrepancy resolution.
- **R3C-D — Put-away and R3B scope:** staging/destination/sub-location, server
  source/destination authorization and physical confirmation.
- **R3C-E — Canonical movement:** accepted put-away only through R3A movement
  helper; partial put-away/replay/correction tests.
- **R3C-F — Supplier/manufacturer integration:** supplier PO/GRN and production
  receipt source adapters.
- **R3C-G — Cost/accounting:** only after costing, title, invoice, landed-cost
  and liability policy approval.

P6-R3C-A/B/C/D should be separately approved implementation increments rather
than one all-at-once ERP change.

## 11. Release gates

Before receiving implementation:

- Isolated database and migration/rollback controls.
- Approved warehouse location hierarchy and staff assignment.
- Approved receipt and discrepancy permissions.
- Approved supplier/manufacturer title and cost policy.
- Source-to-GRN-to-movement lineage tests.
- Partial, over, duplicate, missing, damaged and correction replay tests.
- Persisted balance/ledger/receipt atomicity tests.
- Physical count and source-to-balance reconciliation.
- Cost/GL approval when accounting is included.

Database, physical stock and release readiness are not established by this
contract or its mocked tests.

## 12. Database-independent implementation

Added `backend/services/receivingContractService.js`:

- Receiving status transition validation.
- Exact integer quantity normalization.
- Inspection disposition reconciliation.
- Put-away overflow and location authorization validation.
- Explicit over-reception and short quantity reporting.

No Prisma, filesystem, network or accounting call is present in this module.

## 13. Files changed

- `backend/services/receivingContractService.js`
- `backend/tests/receivingContractService.test.js`
- `docs/phase-6/09-p6-r3c-receiving-and-put-away-contract.md`
- Phase 6 and accounting tracker updates

## 14. Outstanding decisions

- Supplier model and PO/GRN schema.
- Supplier/manufacturer title and timing.
- Accepted cost evidence and costing method.
- Landed-cost allocation.
- Over-receipt policy.
- Damage/loss responsibility.
- Warehouse hierarchy and staff/location assignment.
- Maker/checker thresholds and accounting posting gate.
