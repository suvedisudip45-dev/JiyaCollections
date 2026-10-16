# Manufacturer Production, Inventory, and Payment

## Purpose

Replace manufacturer-entered on-hand quantity changes with an auditable production workflow. Keep existing customer order allocation, delivery, return, commission, finance, and settlement behavior except where an explicit cost-layer link is required to avoid duplicate manufacturer COGS.

## Current flow

1. The manufacturer inventory API lists published products and their configured variants.
2. Before this workflow, the manufacturer could directly submit absolute quantities per size/color and a proposed product cost. The API calculated quantity deltas, upserted `ManufacturerInventory`, wrote `ManufacturerInventoryMovement` rows, and synchronized aggregate product stock. The API now rejects quantity increases through this route; non-increasing stock corrections and cost proposals remain available.
3. The stock update does not create a production request, approval, cost lot, payable, or payment event.
4. Manufacturer COGS is currently snapshotted from the approved manufacturer/product cost when an order is accepted. On successful delivery, `postDeliveredOrderAccounting` debits COGS and credits the manufacturer payable. A confirmed delivery return reverses the existing sale/COGS/payable posting.
5. `payManufacturer` settles the posted payable in full or in part, checks treasury funds, supports a `DISCOUNT` or `FINE` adjustment, records a cash transaction, updates the generic payable, and posts supplier-payment accounting.

The legacy payable trigger was the delivered sale, not the inventory quantity update. The production workflow adds the missing production-receipt trigger without changing legacy inventory or order history.

## Confirmed business rules

- A manufacturer submits a production request for a published product and provides requested quantities by size/color.
- The manufacturer proposes base per-piece COGS, MOQ, and a separate batch-total production other cost.
- An admin approves or rejects the request and proposed terms before production begins.
- MOQ is a disclosed order-size term, not a price tier or payout trigger. For MOQ 50 and unit COGS Rs 200, a completed quantity of 20 creates Rs 4,000 of COGS payable; quantities above MOQ retain the same approved unit price.
- An approved request may be started by the manufacturer. Marking it complete atomically adds its approved size/color quantities to hub inventory and recognizes the COGS payable.
- New production requests allocate batch-total production other cost across actual good units; that allocation is included in each unit's inventory COGS and in production payable. Local freight to a distributor is separate from production cost.
- Manufacturer-paid local freight is recognized as delivery expense and accrued to manufacturer payable when dispatch hands the goods to the carrier. Paying a LOGISTICS settlement clears the payable against cash and does not recognize the expense a second time.
- Existing production requests with cost-terms version 1 retain their prior per-unit overhead treatment.
- Existing full/partial settlements and discounts/fines remain available through the existing manufacturer settlement route.
- Cost layers use FIFO. Legacy inventory without a production cost layer retains the current delivery-based COGS recognition until sold.

## Target domain model

| Record | Responsibility |
| --- | --- |
| `ManufacturerProductionRequest` | Manufacturer/product, proposed and approved terms, lifecycle state, review metadata, timestamps, and idempotent completion marker |
| `ManufacturerProductionRequestLine` | Requested size/color and whole-unit quantity |
| `ManufacturerInventoryCostLayer` | Immutable completed-production batch/variant COGS at 14-decimal unit precision, remaining/reserved/consumed/returned quantities, and legacy per-unit delivery overhead |
| `ManufacturerInventoryCostAllocation` | FIFO layer units reserved/consumed by an order; `returnedQuantity` prevents a partial customer return from restoring the same units twice |
| `ManufacturerInventoryMovement` | Existing auditable aggregate/variant stock delta, now sourced from a completed approved production request rather than direct manufacturer edits |
| `JournalEntry` / `JournalLine` | Production completion: debit inventory, credit manufacturer payable. Delivery: debit COGS/credit inventory for production-layer units; retain the existing COGS/payable posting for legacy units. Delivery overhead is expensed and credited to manufacturer payable on successful delivery. |

Money values use the existing accounting Decimal convention where stored in newly added financial fields. Approved terms and cost-layer values are immutable snapshots; later proposals cannot rewrite a completed batch's costs.

## Lifecycle and invariants

```text
PENDING_REVIEW -> APPROVED -> IN_PRODUCTION -> COMPLETED
       |              |
       +-> REJECTED   +-> CANCELLED (before completion only)
```

- Only the authenticated manufacturer can create and progress its request.
- Only authorized admins can approve/reject pending requests.
- Approval freezes proposed unit COGS, MOQ, batch other cost, and variant quantities.
- A request can complete once. Its stock changes, movements, FIFO layers, payable journal, audit entry, and completed status commit atomically.
- Direct quantity edits cannot generate a payable. Count corrections, damages, returns, or other adjustments do not create production COGS.
- FIFO layer reservation is persisted with the order's accepted cost snapshot. Cancellation releases reservations; delivery consumes them; restockable returns restore the original layer.
- A production-layer unit's COGS is not credited to manufacturer payable again at delivery. Only legacy units retain the old delivery payable trigger.
- For version-2 production terms, batch other cost is allocated across actual good units and capitalized into unit COGS; the new cost layer has no separate delivery-overhead amount. Legacy version-1 layers retain their existing delivery overhead behavior.
- Local/manual StockTransfer freight is a distinct logistics payable. Dispatch debits delivery expense 6430 and credits manufacturer payable 2160; payment later debits that payable and credits cash/bank without re-expensing freight.
- Retries cannot complete a request or post COGS/overhead twice.

## Iteration plan

### Iteration 0 — Discovery and policy

Complete. Traced inventory update, approval, order cost snapshots, delivery accounting, return, finance-summary, and settlement paths. Confirmed unit pricing below/above MOQ, admin approval, per-delivered-unit overhead, FIFO, and existing partial/full settlement adjustments.

### Iteration 1 — Persistence and production lifecycle

Implemented: request, request-line, cost-layer, and allocation models; an additive migration; authenticated manufacturer/admin APIs; state transitions; transactional stock completion and payable posting; inventory movement/audit records; focused service tests; and server-side rejection of manual stock increases.

### Iteration 2 — Portal workflows

Implemented: manufacturer request/list/start/complete UI and an admin approval/rejection queue. MOQ is displayed as informational, while COGS and delivery overhead are separate.

### Iteration 3 — FIFO and accounting integration

Implemented: inventory/AP accrual on completed production; FIFO allocations for accepted and direct manufacturer orders; consumption on delivery; reservation release on eligible cancellation; partial layer restoration on restockable returns; delivery-timed overhead; legacy delivery-based COGS; and production AP recognition in manufacturer settlement and scoped finance summaries.

### Iteration 4 — Verification and rollout

Verified: focused service/accounting tests, Prisma validation/client generation, and both portal builds. The full backend suite was run and reported failures in `adminTwoFactorService.test.js` involving fixed/repeated OTP values, unrelated to this workflow. Review migration compatibility and deploy the migration plus RBAC seed; the migration has not been applied to a live database.

## Out of scope

- Rewriting general customer checkout, assignment, direct-sale, delivery, returns, or treasury workflows.
- Retroactively creating manufacturing requests or payables for old on-hand inventory.
- Changing manufacturer commissions, customer selling prices, tax treatment, or delivery provider behavior.
- Replacing the generic payable/treasury settlement system.
