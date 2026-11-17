# R14 — Inventory and Cost of Goods Sold

**Review date:** 2026-11-16

**Status:** **PARTIAL** — current source and code paths reviewed statically. No stock, cost-layer, production or journal rows were read.

## 1. Inventory source-of-truth boundary

The repository has two overlapping generations of stock and cost data:

- **Current quantity/ledger path:** `InventoryBalance` is the current SKU/location quantity; `InventoryLedgerEntry` is the auditable movement history. Newer distributor receipt, reservation, fulfillment, damage/loss and production flows use these records.
- **Legacy/parallel paths:** `Product.stockQuantity`, `ManufacturerInventory`, and `StockLog` remain active in selected route/service/report paths. They are not equivalent to the canonical ledger.
- **Cost evidence:** Production flows create costed production layers and selected distributor fulfillment consumes FIFO layers. Some reports and legacy paths fall back to `Product.costPrice`, which is not an immutable per-unit receipt/issue layer.
- **Ownership:** Platform-owned distributor stock and manufacturer-consigned stock have distinct accounting. Consigned units are not company inventory merely because a manufacturer or distributor UI displays quantity.

**PROPOSED INTERNAL POLICY:** Define a single authoritative balance by SKU, location, owner, condition and as-of cutoff. Every change is an immutable ledger movement with source, actor, reference, idempotency key and, where valued, cost-layer provenance. Legacy quantity/cost models remain projections or historical evidence until a verified migration and reconciliation; do not make them co-equal sources.

## 2. Quantity and costing lifecycle

| Event | Current path | Accounting/valuation expectation | Current status and limitation |
|---|---|---|---|
| Production order | Admin-issued manufacturer order with required fabric/GSM, target date and batch plan | Production request establishes authorization, not received stock or payable by itself. | Pre-production checks and MOQ/unit COGS, post-production QA and size/color actuals exist in the documented flow. |
| Production completion/receipt | Manufacturer completion and inventory-ledger receipt path; production cost layers | Record only good units in canonical balance and a layer with approved actual unit cost; record corresponding manufacturer payable/journal in the same transaction. Damaged output must be separate evidence/disposition. | New flow is transactional and layered; `ManufacturerInventory` is also maintained. Damage disposition and complete legacy projection agreement need validation. |
| Supplier purchase/inbound | Purchase poster helper and inbound shipment models | Approved purchase and physical receipt should create inventory quantity and cost layer with freight/eligible landed cost; AP and tax follow verified source. | Poster exists, but no active caller connected to quantity/cost-layer receipt was found. Procurement-to-stock accounting is **NOT FOUND end to end**. |
| Manufacturer-to-distributor transfer | `StockTransfer` dispatch/receipt; transit and distributor locations | Preserve quantity through source, in-transit and destination locations; receiving checklist maps good/damaged/missing; do not book new total company inventory or duplicate manufacturer cost. | New ledger transaction supports transfer and receipt. Cost-layer provenance is missing on some transit/damage/return movements. |
| Customer order allocation/reservation | Order assignment and reservation services | Reservation is not a sale issue; it changes availability, not total on-hand quantity or COGS. Release on cancellation/expiry. | Canonical and manufacturer-specific reservation paths coexist. Avoid reintroducing manufacturer assignment/legacy `ManufacturerInventory` reservation into checkout. |
| Distributor fulfillment | Distributor order fulfillment; `InventoryBalance`, `InventoryLedgerEntry`, cost-layer issue | On actual shipped/delivered accounting trigger, issue exact fulfilled quantity from layers and recognize COGS/related payable as required. | Selected distributor path uses ledger and layer references; other legacy order paths still use product stock. |
| Return | Inspection then accepted/restock or damage/loss | Restock only received, inspected accepted good quantity, restoring layer provenance/cost; damaged/lost amount is not saleable stock and requires separate loss/return accounting. | Distributor path uses ledger/discrepancies in selected flows; some customer/manufacturer return paths update legacy `Product`/`StockLog`. |
| Distributor damage/loss | Evidence-backed discrepancy and `DAMAGE`/`LOSS` movement | Decrease quantity with an open discrepancy and appropriate approved loss accounting. No unsupported stock-increase path. | Required controls exist for newer distributor flows; no universal inventory write-off journal found. |
| Manual adjustment | Admin or legacy stock routes | Require reason, actor, evidence, approval and idempotent source; use ledger movement and cost/GL consequence. | Legacy `Product.stockQuantity` edits/`StockLog` remain in some paths. Cannot claim all adjustments are ledger-controlled. |

## 3. Cost-of-sales policy and current limits

- **CONFIRMED EXISTING DESIGN:** Production layers use FIFO in selected flows. This is a path-level implementation fact, not evidence that FIFO is approved and complete for every inventory source.
- **PARTIALLY IMPLEMENTED:** Some sale/transfer issue paths carry layer references and calculate cost from available production layers. Other flows use `Product.costPrice` fallback or do not preserve layer provenance.
- **NOT FOUND:** A connected supplier purchase receipt that updates both canonical quantity and cost layers was not identified.
- **NOT ESTABLISHED:** One uniform costing policy covering purchased goods, production, landed freight, returns, damage, transfers, consignment, opening quantities and historical inventory. Do not silently extend production FIFO to all stock.
- **Precision:** Internal NPR amounts follow the documented two-decimal HALF_EVEN policy effective 2026-11-15 when the approved helper is used. Source fields still include Float values such as product cost, so converting a Float to Decimal cannot recover precision already lost at persistence.

Before any uniform costing implementation, the business must approve (and document as **PROPOSED INTERNAL POLICY** until confirmed): which cost components enter layer basis; FIFO vs another method by inventory class; treatment of negative/insufficient layers; layer ordering/tie-break; returns to original layer vs current layer; in-transit ownership; damaged and missing inventory; consigned stock; and opening/historical quantity and valuation evidence.

## 4. Inventory-to-COGS reporting and reconciliation

At a matching time/location/owner/condition cutoff, compare:

1. Opening quantity/value plus ledger receipts, transfers, accepted returns and approved corrections minus issues, transfers, losses and rejected/damaged dispositions equals closing quantity/value.
2. SKU/location/owner ledger movement totals agree to `InventoryBalance` and the selected legacy projection, with every difference enumerated.
3. Issued units map to delivered sale/fulfillment source lines and consumed cost layers; no layer is consumed twice or below available quantity.
4. COGS journal amount equals the sum of supported issue costs; inventory control changes agree with the same source movements.
5. Manufacturer consignment issues map to approved manufacturer cost/payable rather than platform-owned inventory asset reduction.
6. Stock transfer outflow equals in-transit plus accepted destination plus damaged/missing evidence; do not recognize the same units twice.
7. Return/restock movements match physical receipt/inspection and original issue provenance; rejected/damaged quantities do not inflate saleable balances.
8. Every discrepancy, uncosted issue, negative balance, fallback cost, missing layer, manual adjustment and out-of-period posting appears as an exception.

An inventory dashboard or balance equality alone does not establish valuation or journal accuracy. Reconcile source, canonical ledger, cost layers, legacy projections and GL separately. No such persisted reconciliation was performed for R14.

## 5. Main gaps and priority

**P1**

- Active legacy quantity writers/reports coexist with the canonical ledger, so source completeness and balance equality are not assured.
- Legacy product-cost fallbacks and incomplete cost-layer provenance weaken COGS reproducibility.
- No complete inventory-to-GL write-off path was found for damage/loss and some transfer/return movements.
- Purchase poster is not connected to a physical quantity and cost-layer receipt path.

**P2**

- `ManufacturerInventory` projection may diverge from canonical `InventoryBalance`.
- Stock reservations, location transfers, returns, in-transit and damaged quantities have different lineage.
- No persisted reconciliation across SKU/location/owner/condition, layers, `Product.stockQuantity`, `StockLog`, COGS and inventory GL control.
- Historical/opening inventory quantity and valuation evidence is absent from this static audit.

## 6. Safe implementation order

1. Inventory all active write/read call sites for `Product.stockQuantity`, `ManufacturerInventory` and `StockLog`, and assign owners to each migration/retirement decision.
2. Add read-only exception reports comparing legacy projections with canonical ledger and cost layers; do not auto-correct balances.
3. Connect approved purchase receiving to source evidence, canonical ledger, cost layers, AP and journal in an isolated-testable transaction.
4. Close cost-layer provenance on transfer, return, exchange, damage and loss events; ensure negative/uncosted consumption becomes an explicit exception.
5. Establish source-to-COGS and inventory-control reconciliation tests and then obtain separately verified isolated-database evidence before any historical conversion or cutover.

R14 did not change inventory behavior, model schema, cost method, balances, or history.
