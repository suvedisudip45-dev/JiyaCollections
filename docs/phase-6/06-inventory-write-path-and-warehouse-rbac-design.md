# P6-R2D - Inventory Write-Path Remediation and Warehouse/RBAC Design Freeze

**Status:** COMPLETE - STATIC AUDIT AND IMPLEMENTATION-DESIGN ONLY
**P6-R2C:** COMPLETE - STATIC SOURCE MAPPING
**P6-R3:** PLANNED - IMPLEMENTATION NOT STARTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED
**Database, migration, stock, accounting, and external-system status:** NOT ACCESSED OR CHANGED

## 1. Executive summary

P6-R2D converts the P6-R2C repository source map into a frozen target design for
inventory-changing operations. It does not implement the design.

Repository evidence establishes that `InventoryBalance` and
`InventoryLedgerEntry`, together with `applyInventoryMovement`, are the intended
canonical quantity-history foundation for supported production, transfer,
fulfillment and selected return workflows. They are not the only inventory writer:
`Product.stockQuantity`, `Product.variants`, `StockLog`,
`ManufacturerInventory`, `ManufacturerInventoryMovement`, and
`ManufacturerInventoryCostAllocation` remain active.

The target design therefore has two parts:

1. A common canonical movement contract and movement-specific domain services.
2. A phased retirement of legacy projections and writers.

This document does not approve a costing method, supplier/manufacturer title,
landed-cost policy, loss responsibility, central-warehouse operating threshold,
or database migration. Those items remain blocked or exception states.

## 2. Evidence classes

- **VERIFIED_IN_CODE**: the route, function or model exists and source behavior
  was verified statically.
- **MOUNTED**: `server.js` mounts the route at the stated `/api` prefix.
- **UNMOUNTED**: a route module exists but no matching mount exists in
  `server.js`.
- **PROPOSED**: target contract or future permission; not existing behavior.
- **UNVERIFIED_PERSISTED**: no database data, deployed grant or physical record
  was inspected.

## 3. Source-verified inventory write-path register

| Path | Exact source and caller | Current writes and transaction | Movement/evidence | Accounting and classification |
|---|---|---|---|---|
| Product create/update | `POST /api/product/add`, `product:create`; `POST /api/product/update`, `product:update`; [productRoute.js](../../backend/routes/productRoute.js), [productController.js](../../backend/controllers/productController.js). | `addProduct`/`updateProduct` write `Product.stockQuantity`, `Product.variants`, catalog fields and variant JSON. Create/update quantity is derived from submitted variants or submitted `stockQuantity`; no product inventory transaction or location is supplied. | No canonical movement, balance or ledger event. | Catalog changes only; any product quantity in the same request is currently implicit inventory fact. **VERIFIED_IN_CODE / MOUNTED.** |
| Admin stock adjustment | `POST /api/product/adjust-stock`, `stock:adjust`; [productRoute.js](../../backend/routes/productRoute.js), [productController.js](../../backend/controllers/productController.js). | `adjustStock` updates `Product.stockQuantity`/`Product.variants`, creates `StockLog`, and writes `SystemAuditLog`. | No canonical balance/ledger, location, cost layer or adjustment identity. | No linked inventory valuation or GL assessment. **VERIFIED_IN_CODE / MOUNTED.** |
| Storefront order | `POST /api/order/place`, `customer:order_place`; [orderRoute.js](../../backend/routes/orderRoute.js), [orderController.js](../../backend/controllers/orderController.js). | Writes order and decrements Product/variant stock plus `StockLog`; allocation/reservation follows separately. | Not a canonical physical issue. | Reservation, payment, fulfillment, delivery, collection and COGS are separate. **VERIFIED_IN_CODE / MOUNTED.** |
| Admin direct order | `POST /api/order/admin-create`, `order:admin_create`; [orderRoute.js](../../backend/routes/orderRoute.js), [adminDirectOrderService.js](../../backend/services/adminDirectOrderService.js). | A serializable legacy order/product/StockLog transaction precedes separate distributor allocation. | No canonical issue at order creation. | Later fulfillment/accounting is separate. **VERIFIED_IN_CODE / MOUNTED.** |
| Allocation/reservation | `/api/assignment/assign`, `assignment:create` and Admin/manual/reassignment routes; [orderAssignmentRoute.js](../../backend/routes/orderAssignmentRoute.js), [orderAssignmentController.js](../../backend/controllers/orderAssignmentController.js). | Atomically increments canonical `InventoryBalance.reservedQuantity` in supported distributor paths; reassignment/cancellation can release it. | Reservation is not ledger movement or on-hand decrement. | No revenue or COGS. **VERIFIED_IN_CODE / MOUNTED.** |
| Distributor fulfillment/direct sale | Distributor assignment/direct-order/status routes; [distributorRoute.js](../../backend/routes/distributorRoute.js), [distributorOrderInventoryService.js](../../backend/services/distributorOrderInventoryService.js). | Decrements canonical balance and creates `FULFILLMENT` entries, cost allocations where available, and resynchronizes Product projection. | Replay and optimistic/conflict checks exist in supported direct fulfillment service. | Sale/accounting posting is separate; selected cost layers may be missing. **VERIFIED_IN_CODE / MOUNTED.** |
| Distributor inventory decrease | `POST /api/distributor/inventory/decrease`, `distributor:inventory_decrease`, distributor context; [distributorRoute.js](../../backend/routes/distributorRoute.js), [distributorInventoryController.js](../../backend/controllers/distributorInventoryController.js). | Evidence-backed canonical `DAMAGE`/`LOSS`, discrepancy and Product projection updates in supported implementation. | Shared helper/idempotency behavior must be checked per implementation. | Not a universal cost consumption or GL write-off. **VERIFIED_IN_CODE / MOUNTED.** |
| Transfer | `/api/stock-transfers/*`, transfer permissions and workspace context; [stockTransferRoute.js](../../backend/routes/stockTransferRoute.js), [stockTransferController.js](../../backend/controllers/stockTransferController.js), [stockTransferService.js](../../backend/services/stockTransferService.js). | Request, authorization, preparation, dispatch, booking, receipt and discrepancy records update selected canonical balances/ledger entries and legacy projections. | Dispatch/receipt/replay evidence is more complete than legacy paths, but receipt and carrier evidence remain distinct. | Dispatch/receipt is custody; freight, payable and accounting are separate. **VERIFIED_IN_CODE / MOUNTED.** |
| Production receipt | `/api/manufacturer-production/requests/:id/complete` and `/api/manufacturer-production/admin/requests/:id/acceptance`; [manufacturerProductionRoute.js](../../backend/routes/manufacturerProductionRoute.js), [manufacturerProductionController.js](../../backend/controllers/manufacturerProductionController.js), [manufacturerProductionWorkflowService.js](../../backend/services/manufacturerProductionWorkflowService.js). | Accepted good units create a factory balance/`PRODUCTION_RECEIPT`, cost layer, manufacturer projection and payable/journal in the supported transaction. | Idempotent SKU/request movement and exact replay exist in the receipt helper. | Recognizes production-period inventory/payable in the supported flow. Title/physical evidence remain unverified. **VERIFIED_IN_CODE / MOUNTED / PARTIAL.** |
| Manufacturer inventory update | `POST /api/manufacturer-inventory/update`, `manufacturer:inventory_update`; [manufacturerInventoryRoute.js](../../backend/routes/manufacturerInventoryRoute.js), [manufacturerInventoryController.js](../../backend/controllers/manufacturerInventoryController.js). | Updates legacy `ManufacturerInventory` and `ManufacturerInventoryMovement`; portal increases are restricted to supported production/completion behavior. | Generally does not create a canonical balance or factory ledger adjustment. | Legacy projection only; no universal cost/GL mapping. **VERIFIED_IN_CODE / MOUNTED.** |
| Manufacturer direct order | Route module exists in [manufacturerDirectOrderRoute.js](../../backend/routes/manufacturerDirectOrderRoute.js) for `/create`, `/my-orders`, `/update-status`, with direct-order permissions. It is not imported or mounted by [server.js](../../backend/server.js). | Controller allocates production cost layers and posts accounting in a Prisma transaction, then updates `ManufacturerInventory`, `syncProductStock` and `StockLog` outside that transaction. | No canonical factory `FULFILLMENT` ledger movement. | Walk-in accounting and later legacy stock update can diverge. **VERIFIED_IN_CODE / UNMOUNTED / RISK.** |
| Distributor self-delivery customer return | `POST /api/distributor/orders/:id/return`, distributor context; [distributorRoute.js](../../backend/routes/distributorRoute.js), [distributorDeliveryController.js](../../backend/controllers/distributorDeliveryController.js), [distributorSelfDeliveryService.js](../../backend/services/distributorSelfDeliveryService.js). | Directly upserts `InventoryBalance` and creates `RETURN` or `DAMAGE` ledger entries. Good restock and damaged disposition use random `crypto.randomBytes` suffixes in idempotency keys. | Direct Prisma writes do not call `applyInventoryMovement`; retries are not deterministic business-event replay. | Refund/accounting is separate and must not make the quantity saleable. **VERIFIED_IN_CODE / MOUNTED / CONFLICT.** |
| Distributor exchange return and replacement | `POST /api/returns/exchange/distributor/:id/process`, `distributor:delivery_return`; [returnsRoute.js](../../backend/routes/returnsRoute.js), [distributorExchangeService.js](../../backend/services/distributorExchangeService.js). | Exchange inspection uses `applyInventoryMovement` for `RETURN`/`DAMAGE`; replacement dispatch decrements reserved balance directly and creates a `FULFILLMENT` ledger entry. | Deterministic exchange keys exist for return/replacement, but replacement bypasses the shared movement helper and direct balance updates can differ from its replay checks. | Exchange accounting and paper bill/service-charge treatment is separate. **VERIFIED_IN_CODE / MOUNTED / PARTIAL.** |
| Distributor stock return to platform | `/api/admin/distributors/:id/stock-returns...`; [adminDistributorDetailRoute.js](../../backend/routes/adminDistributorDetailRoute.js), [distributorStockReturnService.js](../../backend/services/distributorStockReturnService.js). | Authorization, collection, receipt, inspection and discrepancy stages; moves custody toward return hold/receipt and selected platform quantity. | Evidence/request hash/idempotency fields exist. | Not automatic restock, write-off or distributor liability. **VERIFIED_IN_CODE / MOUNTED.** |
| Customer RMA inspection/restock | `POST /api/returns/customer/admin/:id/inspection`, `returns:admin_inspect`; [returnsRoute.js](../../backend/routes/returnsRoute.js), [customerReturnWorkflowService.js](../../backend/services/customerReturnWorkflowService.js). | Restock increments `ManufacturerInventory` or `Product`, updates variants and creates `StockLog`; reversed cost allocations may cover less than legacy quantity. Damaged/missing/disputed cases create zero-quantity/legacy audit only. | No canonical return/location movement in this path. | Refund/financial resolution is not dependent on or proven by legacy stock restock. **VERIFIED_IN_CODE / MOUNTED / CONFLICT.** |
| Supplier return | `POST /api/returns/supplier/create`, `returns:supplier_create`; [returnsRoute.js](../../backend/routes/returnsRoute.js), [returnsController.js](../../backend/controllers/returnsController.js), [supplierReturnService.js](../../backend/services/supplierReturnService.js). | Decrements `Product.stockQuantity` and creates `StockLog`; supplier-return/AP data is maintained separately. | No canonical issue or received-cost-layer link. | Debit/credit may use submitted item cost, not verified original receipt cost. **VERIFIED_IN_CODE / MOUNTED.** |

## 4. Single canonical inventory write boundary

### 4.1 Proposed domain boundary

All future inventory-changing business operations should route through
movement-specific domain services that share a canonical movement contract.
Controllers remain responsible for request parsing, authentication, workspace
scope, orchestration of business lifecycle evidence, and presentation of domain
errors.

The shared contract should accept only:

- Stable business event/reference.
- Client or business idempotency identity.
- Canonical SKU.
- Source/destination location.
- Owner/custodian context.
- Exact whole-unit quantity.
- Movement type.
- Actor and role.
- Reason and evidence references.
- Effective and recorded timestamps.
- Optional cost-layer and/or explicit uncosted quantity.
- Reversal/correction reference.

The shared helper should own:

- Movement validation.
- Location/SKU activation and owner checks.
- Source unreserved availability.
- Destination overflow.
- Optimistic concurrency or locking.
- Exact idempotency replay and conflict detection.
- Atomic balance update and immutable ledger creation.
- Event audit and stable reference linkage.

Domain services should own:

- Opening balance.
- Production receipt.
- Transfer dispatch/receipt.
- Fulfillment/consumption.
- Customer/distributor return receipt and disposition.
- Manual or count adjustment.
- Damage/loss.
- Reversal and correction.

A generic HTTP movement endpoint is not proposed. It would bypass business
authorization and lifecycle evidence.

### 4.2 Invariants

The target implementation must prevent:

- Direct `InventoryBalance` or `InventoryLedgerEntry` mutations outside the
  approved movement service.
- Ledger creation without a balance mutation in the same transaction.
- Balance mutation without ledger history for the business movement.
- Random or payload-derived idempotency keys that differ across retries.
- Replay with a changed payload or actor against the same business event.
- Two different business events being merged solely by SKU, quantity or text.
- Source/destination location without valid owner/kind/custody scope.
- Decreasing unavailable or reserved stock.
- Adjustment of physical on-hand outside count/evidence/approval evidence.
- Corrections that overwrite or delete original movement history.

### 4.3 Transaction model

The canonical balance and ledger update and its associated business lifecycle
record must commit atomically for each movement. Separate accounting posting,
carrier requests and notifications may use outboxes or reconciliation jobs.
Physical handoff, commercial authorization and inventory posting must remain
separate.

## 5. Product creation and update stock separation

### 5.1 Target field contract

| Field | Target classification |
|---|---|
| `Product.stockQuantity`, `Product.variants` | Compatibility/read projection only, where retained |
| `Product.sizes`, `Product.colors`, variant labels | Catalog/SKU mapping data |
| `Product.costPrice` | Catalog/reference cost only, not authoritative inventory cost |
| `InventorySku` | Canonical product/size/color identity |
| `InventoryLocation` | Canonical warehouse/distributor/factory/custody location |
| `InventoryBalance` | Canonical location/SKU on-hand/reserved projection |
| `InventoryLedgerEntry` | Canonical immutable movement history |

Target behavior:

- Product create/update must no longer accept inventory quantity as an implicit
  stock-field mutation.
- Initial variants may be catalog records, but quantity is not established until
  an opening/receipt workflow is executed.
- Product edits and variant edits must preserve identity and avoid changing
  inventory quantity.
- Administrative stock correction must be a separate adjustment request.
- Import/bulk creation is currently not identified by a dedicated mounted
  inventory import route. Future imports must create catalog records and an
  explicit, reviewed opening/reconciliation batch, never direct balances.

Opening stock requires location, owner/custodian, SKU/variant, exact quantity,
evidence, actor/approver, effective date, reason, idempotency and cost evidence
classification. Existing product quantities must not be converted automatically.

Compatibility can retain `Product.stockQuantity` and variant quantities as
derived projections. The API may return them for a bounded compatibility window,
but only canonical movements may change them. Their values must be recoverable
from canonical balances or marked unavailable while source coverage is incomplete.

## 6. Distributor return and replacement dispatch

### 6.1 Self-delivery customer return

The target lifecycle is:

`RETURN_REQUESTED -> AUTHORIZED -> PHYSICAL_RECEIPT -> INSPECTED ->
RESTOCKABLE/QUARANTINE/DAMAGED/MISSING/REJECTED -> MOVEMENT_POSTED ->
FINANCIAL_RESOLUTION`

Physical receipt and inventory disposition require exact SKU/variant and quantity,
location, inspector, evidence, condition and timestamp. A status change alone
must not increase on-hand or available quantity.

Accepted good stock moves to the approved return location and may later move to
saleable stock through a separately authorized restock movement. Damaged stock
moves to a damaged location and missing/rejected stock remains an exception.

Financial refund may be blocked until inspection/disposition is complete, or
remain separately pending while accepted physical stock exists. Neither status
implies the other.

### 6.2 Exchange return

The exchange service currently demonstrates useful contracts:

- `applyInventoryMovement` for good/damaged return receipt.
- Exact approved-versus-inspected quantity validation.
- Deterministic return key:
  `EXCHANGE_RETURN:<request>:<sku>:<destination>`.
- Deterministic discrepancy key for damaged exchange returns.
- Replacement reservation and exact SKU/quantity matching.

Gaps:

- Replacement dispatch directly updates the balance and creates a ledger entry
  instead of calling the shared movement helper.
- The direct dispatch entry bypasses source-availability replay handling.
- Reservation/dispatch uses request and SKU/location identities but needs a
  separate reservation lifecycle, expiry and release contract.
- Exchange accounting is not a physical movement and must remain separate.

The target return and dispatch phases should both call the canonical service,
with deterministic business event keys and exact replay checks.

### 6.3 Replacement dispatch

Replacement stock must be:

1. Reserved in the selected location.
2. Matched to approved exact replacement SKU/variant and quantity.
3. Picked with operator/evidence.
4. Dispatched with its own movement reference.
5. Relieved only on dispatch/fulfillment evidence, never by reservation alone.
6. Delivered/returned independently of the original sale financial result.

The original sale remains a distinct financial event. Replacement fulfillment
is a separate inventory movement and may have a separate accounting treatment.

### 6.4 Distributor-held stock return

All distributor-held inventory remains Aama-owned. A return to platform custody
requires transfer authorization, collection/dispatch evidence, transit custody,
central receipt, inspection and final disposition. Inspection may leave units
in return-hold/return-receipt or quarantine. It does not itself prove saleable
restock or write-off.

## 7. Idempotency and retry identity

The self-delivery service's random randomBytes suffix is confirmed and must not
become a canonical target pattern.

Deterministic identity should use a stable business event, SKU and location:

- Separate client request idempotency from business-event uniqueness.
- Repeated retry uses the same request key and canonical payload hash.
- A changed payload under an existing request key is a conflict.
- Different legitimate business events never share an identity merely because
  quantity, customer or text is similar.
- Heuristic similarity is never proof of duplication.

Database uniqueness already exists for `InventoryLedgerEntry.idempotencyKey`
and for some return/transfer/receipt/discrepancy records. The target should
preserve these constraints and add domain/request uniqueness where no stable
business key is already stored.

## 8. Admin adjustment lifecycle

Proposed states:

`REQUESTED -> EVIDENCE_VALIDATED -> APPROVAL_PENDING -> APPROVED ->
EXECUTABLE -> EXECUTED -> RECONCILED`, with `REJECTED` and `CORRECTION_REQUIRED`.

Required fields:

- Location and exact SKU/variant.
- Direction and whole-unit quantity.
- Reason code and free-text justification.
- Count/report/incident/evidence references.
- Effective time.
- Requester.
- Approver/checker.
- Canonical movement reference.
- Cost evidence classification.
- Accounting assessment.
- Audit/correlation identifier.

Physical count variance, damage/loss report, correction and write-off remain
separate actions. A consequential adjustment should require independent
approval. Read-only/reporting permissions must not permit execution.

No distributor receivable or liability is automatically created.

## 9. Customer-return lifecycle

The target distinguishes:

- Return authorization.
- Carrier/personal pickup status.
- Warehouse/return-receipt physical custody.
- Inspection.
- Accepted, rejected, damaged, missing or quarantined quantity.
- Restock decision and canonical movement.
- Refund/credit/adjustment approval and posting.
- Original order and cost-allocation linkage.

The current `CustomerReturn` model has `lifecycleStatus`, `inspectedAt`,
`inspectionResult`, `inventoryAction`, `refundStatus`, and accounting journal
references. It is a useful lifecycle source but does not itself prove canonical
inventory restoration.

If financial resolution is approved before physical receipt, it remains a
financial pending/approved state, not a restock or inventory increase. If
physical stock is received before financial approval, it remains physical
evidence/pending disposition and cannot imply refund completion. Missing
inspection, custody or cost evidence uses blocked/exception states.

## 10. Central warehouse operating model

No central-warehouse profile, warehouse hierarchy, bin model or mounted
warehouse workflow has been verified. `InventoryLocation.kind` is not itself a
warehouse operating model.

The proposed warehouse model should identify:

- Warehouse identity/status.
- Parent warehouse or zone.
- Storage bins only if there is an approved operational need.
- Location owner/custodian.
- Receiving staging.
- Inspection/quarantine.
- Put-away.
- Available, reserved and in-transit quantities.
- Picking/packing/dispatch.
- Internal custody transfers.
- Customer/distributor returns.
- Damaged/lost/rejected stock.
- Opening stock and count adjustments.
- Cycle-count schedule and reconciliation.

Proposed lifecycle:

`AUTHORIZED -> RECEIVED -> INSPECTED -> ACCEPTED/REJECTED ->
PUT_AWAY -> AVAILABLE/RESERVED -> PICKED -> PACKED -> DISPATCHED ->
IN_TRANSIT -> RECEIVED_BY_DESTINATION`

Every operation should record initiator, approver, physical executor,
evidence, movement, status, audit and exception resolution.

## 11. Warehouse-scoped RBAC design

The repository proves:

- Session-aware JWT and database-backed RBAC.
- Existing role membership and permission resolution.
- Manufacturer/distributor dual-role union in the authorization helper.
- `setManufacturerContext`, `setDistributorContext`, and
  `setFulfillmentContext`.
- Existing permission identifiers including `stock:adjust`,
  `inventory:ledger_read`, `inventory:admin_read_all`,
  `transfer:*`, `manufacturer:*`, `distributor:*`, `returns:*`,
  `exchange:*`, `assignment:*`, and accounting/finance permissions.

No warehouse role, warehouse permission, warehouse scope field or warehouse
resource middleware is established. The names below are proposed and must not
be presented as deployed permissions.

| Capability | Existing identifier or evidence | Proposed treatment |
|---|---|---|
| Read inventory | `inventory:ledger_read`, `inventory:admin_read_all`, scoped distributor/manufacturer read permissions | Require warehouse/distributor/manufacturer resource scope; proposed warehouse read permission may not use existing identifier |
| Adjust stock | `stock:adjust` | Separate request/approve/execute permissions; retain identifier only for compatibility where Admin route remains |
| Transfer request | `transfer:distributor_request` | Scope to authenticated distributor profile |
| Transfer dispatch | `transfer:manufacturer_dispatch` | Scope to authenticated manufacturer or approved warehouse |
| Transfer receive | `transfer:distributor_receive` | Scope to destination distributor |
| Transfer review | `transfer:admin_review` | Admin plus warehouse/return-disposition scope |
| Customer return inspect | `returns:admin_inspect` | Require receiving/warehouse location scope and separate refund permission |
| Customer return refund | `returns:admin_refund` | Accounting/Finance approval; not inventory receipt permission |
| Exchange inspect/review | `exchange:admin_review` | Separate exchange inventory movement from accounting action |
| Manufacturer production | `manufacturer:production_manage`, `manufacturer:production_admin` | Scope to manufacturer/factory; acceptance requires independent role |
| Distributor inventory decrease | `distributor:inventory_decrease` | Evidence and discrepancy; scope to active distributor |
| Ledger/reconciliation read | `inventory:ledger_read` | Read-only, warehouse/business scope and export permission separated |

Role membership, permission membership, warehouse scope, record ownership,
approval state and physical execution remain separate checks. A user should not
approve its own consequential adjustment or execute the movement they requested
when maker-checker is required.

Proposed role names may include Warehouse Manager, Warehouse Operator,
Receiving Operator, Dispatch Operator, Inventory Controller and Finance.
They are not confirmed repository roles. Deployment requires role grants,
resource-to-user assignment, permission catalog additions and route tests.

## 12. Manufacturer and supplier integration boundaries

### 12.1 Manufacturer direct order

The route module has direct-order create/read/status permissions and
setManufacturerContext assumptions. However, it is unmounted, so it is not an
active route.

The controller:

- Reads `ManufacturerInventory` and legacy variants.
- Creates an order and cost allocations in a transaction.
- Posts delivered-sale accounting for walk-in orders.
- Updates legacy inventory and `StockLog` after that transaction.
- Calls `syncProductStock` outside the direct-order transaction.
- Creates `OrderAssignment`.

Risks:

- Accounting/cost consumption can commit before legacy stock decrement.
- No canonical factory `FULFILLMENT` movement exists.
- Physical title, hub stock and canonical balance may diverge.
- Readiness cannot be inferred from route-file presence.

Do not mount or activate it until redesign and policy approval.

### 12.2 Supplier and manufacturer receipt

The canonical receipt contract needs integration points for:

- Supplier purchase order/acknowledgement.
- Accepted goods receipt.
- Rejected/damaged/partially received quantity.
- Location receipt/inspection/put-away.
- Supplier invoice and landed-cost evidence.
- Cost-layer creation or explicit uncosted quantity.
- Accounts payable/asset recognition.
- Manufacturer production acceptance.

Supplier/manufacturer title, accepted receipt timing and costing remain unresolved.
The implementation must not infer title or choose FIFO/weighted average.
Procurement/P6-R4 work remains separate from warehouse/P6-R3 work.

## 13. Legacy compatibility and transition

| Legacy representation/writer | Compatibility requirement | Migration/retirement criterion |
|---|---|---|
| `Product.stockQuantity`/`Product.variants` | Derived projection only; preserve API fields for bounded compatibility. | Every writer gated or migrated; canonical balance reconciled and consumer reads migrated. |
| `StockLog` | Immutable legacy audit evidence. | Preserve historical rows; no synthetic canonical movement without evidence. |
| `ManufacturerInventory` | Legacy portal projection and transition compatibility. | Replace with canonical location/SKU reads or prove it is a maintained derived view. |
| `ManufacturerInventoryMovement` | Retain history and actor/reason evidence. | Map only to canonical evidence with approved source lineage. |
| Admin adjustment | Replace with request/approval/execution domain service. | Remove direct Product/variant write from route. |
| Customer return restock | Replace with receipt/inspection/disposition/restock movements. | Preserve original order/return/journal and cost allocation evidence. |
| Supplier return | Replace Product decrement with canonical issue plus supplier/layer linkage. | Accepted source receipt/layer policy required. |
| Direct manufacturer order | Keep unmounted until redesign. | Canonical ledger issue, cost and accounting committed in an appropriate transaction. |
| Distributor self-delivery return | Replace random keys/direct upserts with shared movement service and deterministic event key. | Return receipt/disposition/refund and accounting independently replayable. |
| Exchange return/replacement | Reuse shared helper and exact-inspection validation. | Replacement reservation/dispatch/restock paths canonical and replay-safe. |

No dual-write migration should run without:

- Explicit transaction and failure recovery design.
- Canonical writer as the authority.
- Projection sync as a derived projection.
- Idempotency replay and conflict tests.
- Evidence that legacy consumers have been migrated or gated.

## 14. P6-R3 implementation sequence

### P6-R3A - Canonical inventory service foundation

- **Scope:** shared movement contract, request/event idempotency, balance/ledger
  transaction helper, movement validation and audit.
- **Prerequisites:** P6-R2A-D design freeze, DB isolation/recovery for
  implementation validation.
- **Source modules:** `inventoryLedgerService.js`, Prisma canonical models,
  existing movement callers.
- **Approvals:** none for movement mechanism; valuation-sensitive costing remains
  blocked.
- **Tests:** replay, changed payload, concurrency, invalid location, insufficient
  stock, overflow and rollback.
- **Gate:** synthetic tests and reviewed isolated DB transaction tests.

### P6-R3B - Warehouse identity and scoped authorization

- **Scope:** warehouse/location hierarchy, workspace operator, resource scope
  and proposed role/permission catalog.
- **Prerequisites:** management approval of warehouse locations and operator
  scope.
- **Source modules:** auth middleware, RBAC seed, route permission maps, location
  models.
- **Approvals:** warehouse organization and maker-checker thresholds.
- **Tests:** role/permission denial, cross-warehouse access, owner/profile mismatch
  and dual-role behavior.
- **Gate:** deployed RBAC and resource grant evidence; not documentation alone.

### P6-R3C - Receiving, inspection and put-away

- **Scope:** receiving stage, inspect, quarantine, rejected/damaged accepted
  quantity, put-away and receipt movement.
- **Prerequisites:** R3A/B and receiving evidence policy.
- **Source modules:** stock-transfer receipt, return, production receipt and
  warehouse route/controller/service candidates.
- **Approvals:** accepted/rejected/damaged disposition and evidence.
- **Tests:** partial receipt, duplicate receipt, missing evidence, damaged
  quarantine and rollback.
- **Gate:** physical count/UAT in isolated approved environment.

### P6-R3D - Picking, dispatch and internal transfers

- **Scope:** reservation, pick, pack, dispatch, in-transit and destination receipt.
- **Prerequisites:** R3A-C and carrier/custody policy.
- **Source modules:** stock-transfer and future warehouse transfer services.
- **Approvals:** dispatch authority, custody stages and carrier bookkeeping.
- **Tests:** reservation conflict, duplicate dispatch, partial transfer, lost
  shipment and rollback.
- **Gate:** cross-location reconciliation and approved operational UAT.

### P6-R3E - Controlled adjustments and opening balances

- **Scope:** request/approval/execution lifecycle, counts, opening balance,
  discrepancy and adjustment movement.
- **Prerequisites:** R3A/B and approved opening/evidence/approval policy.
- **Source modules:** product adjustment route/controller, inventory ledger,
  audit and reconciliation readers.
- **Approvals:** count, adjustment threshold and maker-checker policy.
- **Tests:** exact replay, wrong location, own-approval denial, cost classification
  and historical immutability.
- **Gate:** opening scope/physical count/cutoff and isolated migration sign-off.

### P6-R3F - Customer and distributor return integration

- **Scope:** physical return, inspection, disposition, canonical restock/write-off,
  distributor custody return and exchange replacement.
- **Prerequisites:** R3A-E and unresolved return/damage/liability policy.
- **Source modules:** customer return, distributor return/exchange, stock return
  and accounting posting services.
- **Approvals:** return eligibility, restock, damage/loss, refund/credit treatment.
- **Tests:** refunded-not-received, received-not-refunded, duplicate return,
  exchange replay and partial disposition.
- **Gate:** source-to-physical/accounting reconciliation.

### P6-R3G - Legacy writer retirement

- **Scope:** migrate/gate direct writers, compatibility projections and report/read
  consumers.
- **Prerequisites:** R3A-F stable; legacy population and opening mapping approved.
- **Source modules:** product/order/return/supplier/manufacturer/direct-order
  writers and portal stock readers.
- **Approvals:** compatibility/API and cutover policy.
- **Tests:** legacy reader parity, no direct write bypass, source reconciliation,
  rollback and cutover replay.
- **Gate:** independent balance/physical/cost/GL/portal acceptance.

The sequence may proceed with static implementation design before database access.
Production routes, schema, migrations and persisted tests require an independently
verified isolated database, backup/restore and rollback approval.

## 15. Decision and exception register

| Classification | Item | Required treatment |
|---|---|---|
| Confirmed business policy | Distributor-held stock remains Aama-owned; distributor is custodian. | Preserve owner/custodian semantics; no automatic liability. |
| Confirmed business policy | Distributor transfer/receipt is not sale/COGS/revenue. | Require separate fulfillment/sale evidence and approved cost. |
| Confirmed internal policy | NPR monetary quantization is two decimals, HALF_EVEN, effective 2026-11-15. | Internal bookkeeping only; no statutory/CA approval claim. |
| Verified implementation fact | Canonical ledger/balance exists for selected workflows. | Reuse but do not claim universal coverage. |
| Verified implementation fact | Product and ManufacturerInventory direct writers remain active. | Gate/migrate before canonical cutover. |
| Verified implementation fact | Distributor self-delivery return uses random idempotency suffixes. | Replace with deterministic business-event identity. |
| Verified implementation fact | Manufacturer direct-order route is unmounted. | Do not activate or present as live functionality. |
| Proposed technical contract | Shared movement domain service and movement-specific orchestration. | Implementation review required; not approved business policy. |
| Proposed technical contract | Warehouse roles, permissions and location hierarchy. | Require user/management approval and deployed grant evidence. |
| Unresolved business decision | Costing method. | Block authoritative valuation-sensitive implementation. |
| Unresolved business decision | Supplier/manufacturer title and accepted receipt timing. | Block affected posting or keep exception state. |
| Unresolved business decision | Landed-cost allocation and missing cost. | Report uncosted quantity; no catalog fallback as authority. |
| Unresolved business decision | Damage/loss responsibility and return financial treatment. | No automatic liability, receivable or write-off journal. |
| Unresolved business decision | Warehouse count frequency, bins and maker/checker thresholds. | Block operational implementation; define blocked state. |
| Release blocker | Persisted population/opening-balance mapping. | Separate authorized isolated read-only validation. |
| Release blocker | Physical count, cost valuation and GL reconciliation. | Independent evidence required. |
| Release blocker | Deployed RBAC and resource scope. | Not complete by route/source review. |

## 16. P6-R3 readiness verdict

**P6-R3 is not ready to start production implementation.**

Static design and tests that do not access or mutate state may proceed. The following
gates remain:

- Approved canonical movement and opening-balance scope.
- Approved warehouse identity/location hierarchy and operating thresholds.
- Approved location-scoped RBAC and independent approval roles.
- Legacy population mapping and cutover policy.
- Customer-return and distributor-return disposition policy.
- Costing/title/landed-cost policy only for valuation-sensitive work.
- Independently verified isolated database.
- Backup/restore and migration rollback evidence.
- Physical-count and source-to-balance reconciliation.
- Cost/GL reconciliation and independent release approval.

P6-R3A and R3B have safe design/test predecessors, but no route, schema,
migration or persisted implementation should be started under this increment.

## 17. Exact source references

- [Backend server route mounts](../../backend/server.js)
- [Unified authentication and workspace context](../../backend/middleware/unifiedAuth.js)
- [Database-backed authorize middleware](../../backend/middleware/authorize.js)
- [RBAC seed and permission catalog](../../backend/prisma/seed.js)
- [Product routes](../../backend/routes/productRoute.js)
- [Product controller](../../backend/controllers/productController.js)
- [Canonical inventory ledger service](../../backend/services/inventoryLedgerService.js)
- [Stock synchronization service](../../backend/services/stockSyncService.js)
- [Order routes](../../backend/routes/orderRoute.js)
- [Order assignment routes](../../backend/routes/orderAssignmentRoute.js)
- [Stock transfer routes](../../backend/routes/stockTransferRoute.js)
- [Stock transfer service](../../backend/services/stockTransferService.js)
- [Manufacturer inventory routes](../../backend/routes/manufacturerInventoryRoute.js)
- [Manufacturer production routes](../../backend/routes/manufacturerProductionRoute.js)
- [Distributor inventory routes](../../backend/routes/distributorRoute.js)
- [Distributor self-delivery service](../../backend/services/distributorSelfDeliveryService.js)
- [Distributor exchange service](../../backend/services/distributorExchangeService.js)
- [Distributor stock-return service](../../backend/services/distributorStockReturnService.js)
- [Customer and exchange return routes](../../backend/routes/returnsRoute.js)
- [Customer return workflow service](../../backend/services/customerReturnWorkflowService.js)
- [Manufacturer direct-order route](../../backend/routes/manufacturerDirectOrderRoute.js)
- [Manufacturer direct-order controller](../../backend/controllers/manufacturerDirectOrderController.js)
- [Canonical and legacy Prisma models](../../backend/prisma/schema.prisma)
- [P6-R2C source mapping](./05-legacy-to-canonical-inventory-source-mapping.md)
- [P6-R2 canonical specification](./02-canonical-inventory-architecture-and-movement-specification.md)
- [P6-R2A contract freeze](./03-canonical-inventory-contract-freeze.md)
- [P6-R2B whole-project readiness audit](./04-whole-project-erp-implementation-readiness-audit.md)
- [P5-R7 valuation and COGS evidence audit](../accounting/24-p5-r7-inventory-valuation-and-cogs-evidence-audit.md)

