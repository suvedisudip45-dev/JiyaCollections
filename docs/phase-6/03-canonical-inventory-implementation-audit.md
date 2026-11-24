# P6-R2 — Canonical Inventory Implementation Audit

**Status:** Static implementation audit complete
**Scope:** Inventory routes, services, Prisma models, P5 reconciliation, RBAC and documentation
**Production implementation status:** NOT CHANGED
**Database/migration status:** NO CHANGES

## 1. Executive conclusion

The canonical inventory architecture is substantially stronger than the legacy stock implementation, but it is not yet a universal ERP inventory source.

Supported canonical flows exist for:

- Production good-unit receipt.
- Stock-transfer dispatch.
- Stock-transfer receipt.
- Distributor fulfillment of assigned/direct orders.
- Evidence-backed distributor damage/loss entries.
- Distributor stock-return handover/receipt/inspection.
- P5 stock-transfer reconciliation for bounded pages.

Material implementation gaps remain in:

- Supplier procurement/GRN/invoice/cost lineage.
- Central warehouse operations and warehouse-specific RBAC.
- Customer return canonical restock/quarantine.
- Admin manual adjustment canonical movement linkage.
- Reservation provenance/expiry.
- Universal reversal and write-off workflows.
- Legacy catalog/manufacturer stock projection retirement.
- Full-population, physical and cost reconciliation.

The current system is suitable for bounded, isolated implementation increments, but it is not ready for an inventory cutover or a claim of globally reconciled inventory.

## 2. Audited source areas

The audit checked:

- `backend/server.js`
- `backend/routes/stockTransferRoute.js`
- `backend/routes/adminStockTransferReconciliationRoute.js`
- `backend/routes/inventoryLedgerRoute.js`
- `backend/routes/manufacturerProductionRoute.js`
- `backend/routes/distributorRoute.js`
- `backend/routes/adminDistributorDetailRoute.js`
- `backend/routes/productRoute.js`
- `backend/routes/returnsRoute.js`
- `backend/services/inventoryLedgerService.js`
- `backend/services/stockTransferService.js`
- `backend/services/distributorOrderInventoryService.js`
- `backend/services/manufacturerProductionWorkflowService.js`
- `backend/services/distributorStockReturnService.js`
- `backend/services/customerReturnWorkflowService.js`
- `backend/controllers/productController.js`
- `backend/prisma/schema.prisma`
- `backend/prisma/seed.js`
- P5-R16 through P5-R19 services and tests

No database was connected and no external system was accessed.

## 3. Critical findings

### 3.1 Admin stock adjustment bypasses canonical inventory

Evidence:

- `POST /api/product/adjust-stock`
- `stock:adjust`
- `backend/controllers/productController.js`
- `Product.stockQuantity`
- `Product.variants`
- `StockLog`

The adjustment path updates catalog stock and creates a legacy stock log. It does not:

- Select a location or custodian.
- Update `InventoryBalance`.
- Create `InventoryLedgerEntry`.
- Attach a cost layer or cost-evidence status.
- Create an approved write-off/disposition reference.

Risk: high. A catalog quantity change can report or reserve stock that is absent from canonical balances.

Required follow-up:

- Disable or quarantine the legacy adjustment route until replaced.
- Add a canonical inventory adjustment context requiring location/SKU/reason/evidence.
- Add maker-checker approval for positive and negative adjustments.
- Preserve an immutable link to the legacy adjustment log during migration.

### 3.2 Customer return restock bypasses canonical inventory

Evidence:

- `POST /api/returns/customer/request`
- Admin decision and inspection routes
- `customerReturnWorkflowService.js`
- legacy `Product.stockQuantity`/`StockLog` restock behavior

The accepted customer-return path does not consistently restore canonical `InventoryBalance` or create canonical `RETURN` movements to an explicit distributor/warehouse location.

Risk: high. It can change sellable catalog projections without restoring cost-layer-linked stock or location/custody state.

Required follow-up:

- Require original sale and fulfilled SKU/quantity lineage.
- Require inspection good/damaged/missing quantities.
- Restock only approved good units into an explicit location.
- Create canonical `RETURN` movements and cost restoration evidence.
- Add separate damaged/quarantine movements.
- Treat accounting refund/credit as independent from inventory restock approval.

### 3.3 Supplier procurement and accepted receipt are missing

Evidence:

- No mounted purchase-order or goods-received route.
- No canonical supplier purchase/GRN/invoice model.
- `InboundShipment` is legacy/unmounted.
- `OperatingExpense`/`AccountPayable` are expense/AP sources, not received inventory evidence.

Risk: high for inventory acquisition, cost and supplier reconciliation.

Required follow-up:

- Define supplier/PO/acknowledgement/GRN/invoice status and evidence.
- Implement a warehouse receipt only after policy approval.
- Add accepted/rejected/damaged/missing quantity records.
- Link receipt to accepted acquisition cost evidence.
- Preserve three-way match as supplier/receipt/invoice reconciliation, not a single inventory movement.

### 3.4 Central warehouse lifecycle is missing

Evidence:

- `InventoryLocation.kind` has no explicitly implemented central warehouse operational role.
- Stock transfers assume factory/manufacturer source and distributor destination.
- No warehouse operator profile/context or dedicated warehouse routes are mounted.

Risk: high. Internal warehouse transfer, supplier receipt and physical count cannot be represented as a complete operational workflow.

Required follow-up:

- Introduce warehouse location/context semantics as a domain decision, not a new status label.
- Add warehouse operator permissions and independent dispatch/receipt roles.
- Add warehouse receive, dispatch, count and disposition APIs only after schema and policy approval.

## 4. High findings

### 4.1 Reservation provenance is incomplete

`InventoryBalance.reservedQuantity` is enforced in supported flows, but most reservations do not have a dedicated canonical reservation header/line.

Risks:

- Reservation conflict audit is limited.
- Cancellation and reassignment can release the wrong or stale quantity.
- TTL/expiry is not modeled.
- Admin/direct order compatibility remains split.

Required follow-up:

- Add reservation records or a formal reservation domain contract.
- Preserve order/assignment/source and quantity.
- Keep reserve/release/consume as separate ledger-independent operations.
- Add reservation leak detection to reconciliation.

### 4.2 Legacy stock sources remain active

Active stock-changing or stock-reading sources include:

- `Product.stockQuantity`
- `Product.variants`
- `StockLog`
- `ManufacturerInventory`
- `ManufacturerInventoryMovement`
- `ManufacturerInventoryCostAllocation`

These are projection or compatibility sources, not replacements for canonical location/SKU balances.

Required follow-up:

- Classify each writer and reader.
- Ban direct legacy quantity mutation for new flows.
- Keep projection synchronization separate from canonical issue/receipt.
- Build a legacy-to-canonical reconciliation report before cutover.

### 4.3 Cost evidence is not universal

The strongest existing source is `ManufacturerInventoryCostLayer` for accepted production. Supplier and opening stock cost evidence is incomplete. `Product.costPrice` is mutable catalog/reference cost.

Required follow-up:

- Separate quantity coverage from valuation coverage.
- Preserve catalog cost as estimate/reference only.
- Define when a movement is costed, uncosted or unresolved.
- Never infer COGS/valuation from missing evidence.
- Add a single approved costing policy for supplier, opening, production and return units.

### 4.4 Reconciliation scope is bounded

P5-R19 reconciles a transfer page and P5-R16/R17 evidence. It does not cover:

- Central warehouse physical counts.
- Distributor shelf counts.
- Supplier receipts.
- Customer return restock.
- Full-population movement replay.
- Cost-to-ledger-to-GL valuation.

Required follow-up:

- Add explicit location/SKU scope and snapshot time.
- Extend reconciliation to opening balance and full movement history.
- Preserve operational reconciliation separately from GL/subledger reconciliation.
- Keep reports read-only until an approved adjustment lifecycle exists.

## 5. Demonstrably enforced invariants

The following are enforced in supported canonical helpers:

- Active, platform-owned locations.
- Active canonical SKU.
- Source on-hand coverage.
- Source unreserved availability for dispatch/equivalent movements.
- Destination overflow limits.
- Exact idempotency replay matching.
- Conflicting idempotency rejection.
- Optimistic balance concurrency checks.
- Prerequisite quantity integrity in production, transfer and fulfillment services.
- Exact whole-unit quantity semantics in canonical movement helpers.

These controls do not establish that every stock-changing path uses the canonical ledger.

## 6. Recommended implementation sequence

### P6-R2A: canonical contract freeze

Status: COMPLETE for documentation and static-code-audit scope only. The
movement, reservation, ownership/custody, cost-evidence, idempotency,
concurrency, audit/RBAC, and accounting contracts and the four finding
acceptance matrices are recorded in
[03-canonical-inventory-contract-freeze.md](./03-canonical-inventory-contract-freeze.md).
No production code, test, route, schema, migration, or database change was
made by this contract freeze.

### P6-R2C — Legacy-to-canonical source mapping

Scope:

- Read-only SKU/location population mapping.
- Opening balance and movement-history comparison.
- Catalog/manufacturer projection mismatch report.
- Ambiguous and missing source mapping.
- Exact reader/writer and transaction-boundary inventory across portals and
  backend domains.

Prerequisites:

- P6-R2B whole-project readiness audit is complete.
- P6-R2C is tracked in
  [05-legacy-to-canonical-inventory-source-mapping.md](./05-legacy-to-canonical-inventory-source-mapping.md).
- Approved source-population and opening-balance scope.
- Independent verification of isolation and backup/recovery before any
  persisted validation.

No cutover or backfill.

P6-R2D implements this static read/map as a [write-path and warehouse/RBAC
design freeze](./06-inventory-write-path-and-warehouse-rbac-design.md). P6-R2D
is complete for static audit/design scope; it remains no implementation
authorization.

P6-R3A hardens the existing canonical
[movement and balance foundation](./07-p6-r3a-canonical-inventory-movement-foundation.md)
through exact validation and database-independent tests. It is complete only for
that mock-tested application boundary and migrates no legacy writer.

P6-R3B maps existing location/profile/RBAC evidence and adds a reusable
[location-scope middleware design](./08-p6-r3b-warehouse-location-and-scoped-rbac.md)
plus one distributor-decrease route example. It does not add persisted warehouse
staff assignments or P6-R3C operations.

P6-R3C maps existing stock-transfer, distributor-return and customer/production
receipt evidence and defines the
[receiving and put-away contract](./09-p6-r3c-receiving-and-put-away-contract.md).
It adds pure database-independent validation only; supplier GRN and persisted
warehouse put-away remain blocked.

P6-R3D verifies the R3C contract and defines receipt identity/evidence,
proposed persistence, transaction recovery and the first implementation gate in
[10-p6-r3d-receipt-evidence-and-persistence-readiness.md](./10-p6-r3d-receipt-evidence-and-persistence-readiness.md).

P6-R3E defines a first-persistent-receiving implementation package in
[11-p6-r3e-persistent-receiving-implementation-blueprint.md](./11-p6-r3e-persistent-receiving-implementation-blueprint.md),
including proposed Prisma models, API/service boundaries, concurrency,
migration and tests. It applies no schema or route implementation.

P6-R3F maps the existing stock-transfer dispatch/receipt lifecycle and
[receipt hardening readiness](./12-p6-r3f-stock-transfer-receipt-hardening-readiness.md),
including canonical movement, location scope, idempotency and reconciliation
gaps. It implements no persistent hardening.

### P6-R3: isolated warehouse lifecycle

Scope:

- Warehouse location and operator context.
- Internal receive/dispatch/count/disposition.
- Maker-checker authorization.
- Canonical ledger integration.
- Customer return and adjustment source links where included in the approved slice.

Prerequisites:

- P6-R2A and P6-R2B.
- P6-R2C static source mapping and its separately authorized persisted-data
  validation gate.
- Approved warehouse custody, adjustment, cost, and location-scoped RBAC policy.
- Phase 1 database release gates.

Status: PLANNED — NOT STARTED. Supplier PO/GRN/invoice and acquisition-cost
implementation remains P6-R4; this P6-R3 scope does not authorize procurement.

### P6-R3 follow-up priority

Before any warehouse route/UI implementation exposes affected stock, replace
or gate the two highest-risk legacy writers:

1. Admin manual adjustment.
2. Customer return canonical restock.

Supplier procurement/receipt is a separate P6-R4 lifecycle.

## 7. Suggested next action

P6-R2B is complete for static whole-project readiness mapping. The next
candidate is to schedule the separate read-only legacy/canonical source map
and reconciliation scope; its iteration ID is not assigned. Any persisted
validation requires separate authorization and independent verification of
database isolation and recovery controls. Do not start P6-R3 until source
mapping, policy, RBAC, and release gates are satisfied.

## 8. Acceptance criteria

P6-R2 implementation audit is complete if:

- All critical and high findings have source evidence.
- Canonical and legacy inventory sources are explicitly separated.
- Next implementation increment and stop gates are clear.
- No database or production code change is required.
- P5 reconciliation remains read-only.
- Phase 4/5 status is unchanged.
- Phase 6 remains in architecture/planning.

## 9. Validation

Static validation performed:

- Route/model/service/permission references checked.
- P6-R2 route inconsistency corrected.
- P6-R1/P6-R2 tracker statuses cross-checked.
- Existing database-independent inventory suites were reviewed for no-database safety.
- `git diff --check` passed.

No database was inspected or connected. No migration, seed, reset or database diagnostic was run. No Prisma/schema, route, controller, service or UI implementation was changed. No inventory, financial or stock record was mutated.
