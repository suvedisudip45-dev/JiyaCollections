# Manufacturer and Retail Distribution Architecture Plan

## Status and scope

Implementation is authorized and is being delivered incrementally. Iterations 1–3 added the additive inventory/distributor schema, workspace-aware authentication and registration, admin application review, a shared distributor workspace, canonical SKU/location keys, a transactional stock ledger, a guarded legacy backfill, and admin audit/reconciliation views. Iteration 4 records completed production in factory stock and links each receipt to its COGS cost layer in the production completion transaction. Iteration 5 adds distributor stock requests, admin authorization, manufacturer manual/NCM dispatch, per-SKU receipts and discrepancies, transfer COGS-layer provenance, and admin freight tracking. Prisma validation, manufacturer/admin production builds, and 14 focused transfer/stock/production tests pass. The database migrations and backfill have **not** been applied; database-backed auth and transfer integration tests remain blocked until the additive schema is deployed to a test database. Customer-order allocation remains on the legacy path pending Iteration 6.

The earlier manufacturer production/payment work in the working tree is pre-existing and remains intact. The new model intentionally supersedes its manufacturer-hub-as-retail-inventory assumption. It is being integrated additively; no existing records or legacy inventory fields are rewritten in this slice.

## Executive summary

Separate the present all-in-one manufacturer hub into three independently permissioned business capabilities:

1. **Manufacturer / factory** — requests or records production, holds platform-owned finished goods at the factory location as custodian, prepares bulk dispatch to a distributor, and can request distributor capability.
2. **Distributor** — receives bulk transfers into platform-owned outlet stock as custodian, receives online customer orders from the allocation hub, and owns customer-order packaging, marketing-card, letter, checklist, carrier-booking, delivery, return, and compensation workflows.
3. **Administrator / platform** — owns all product inventory, pays manufacturer COGS, pays distributor compensation, approves applications and role upgrades, manufacturer-to-distributor enablement, stock transfers, compensation plans, inventory loss/damage resolutions, and network-wide reporting/settlement policies.

Use **MANUFACTURER** and **DISTRIBUTOR** as distinct backend roles with distinct permissions and profile context. Use one shared Manufacturer/Distributor portal application with role-specific workspaces/navigation selected after login. “Retailer” describes the distributor's retail outlet/workflow, not a separate backend role in this design.

Allow multiple approved roles on one login account, especially MANUFACTURER plus DISTRIBUTOR. A manufacturer applying for distributor capability receives a separate distributor profile after admin approval, associated with the same login account. An external distributor registers directly as DISTRIBUTOR. The shared login experience selects an authorized workspace after credentials and MFA; it never trusts a role value supplied only by the browser.

Separate physical stock into explicit locations and immutable inventory movements:

```text
Production batch
    -> manufacturer/factory on-hand
    -> bulk transfer dispatched (in transit)
    -> distributor receipt accepted (platform-owned distributor-location stock)
    -> distributor customer-order reservation
    -> distributor handoff to carrier / delivery
    -> delivered, returned, lost, or damaged disposition
```

The platform owns the stock throughout the lifecycle. The factory's finished stock must never be available to online order allocation. A transfer raises distributor-location sellable inventory only for the quantity confirmed received; shortages, transit loss, and damage are recorded as dispositions rather than silently added to sellable stock.

Keep order APIs and shared services common across manufacturer-distributors and external distributors. Inventory ownership stays with the platform; custody and permissions come from the authenticated active workspace profile and database relationships, not from client-supplied manufacturer/distributor IDs.

## Existing architecture and constraints discovered

### Identity and portal access

- `AuthAccount` currently has a single `role` string and direct profile relations for customer, admin, manufacturer, and marketing partner.
- `AuthAccountRoleMapping` exists and supports multiple account-to-role mappings, but the current login resolver still validates a requested portal against the account's one `role` field and token creation emits `portalAccess: [account.role]`.
- Manufacturer login is implemented separately from the unified `/api/auth/login` route, while the manufacturer portal's current registration and login are factory-specific.
- The target cannot be safely implemented by only adding a `DISTRIBUTOR` string. Account/session/refresh-token/2FA/permission resolution must consistently carry the selected, active workspace and its profile ID.

### Inventory and order allocation

- `ManufacturerInventory` stores manufacturer/product totals plus a JSON `variantsStock` array. It currently conflates factory stock and local customer-order sellable stock.
- `OrderAssignment` currently points to a `Manufacturer`; `Order` also has `manufacturerId`, and the allocation engine selects/holds manufacturer inventory.
- `DeliveryOrder` currently has one order-oriented carrier workflow with a manufacturer ID. It cannot represent the separate factory-to-retailer bulk shipment and retailer-to-customer parcel as first-class shipments.
- Current stock, reservation, fulfillment, return, gifts, and product-stock synchronization services use a mix of relational rows and JSON variant quantities. The new design should establish one canonical inventory ledger and prevent aggregate/catalog stock from becoming a second editable source of truth.

### Retail operations currently hosted in the manufacturer portal

The manufacturer portal currently combines production, inventory, customer order assignments, direct orders, marketing cards, personalized letters, gift inventory, pickup profile, customer loyalty, and finance. Under the target:

- Factory workspace: production batches, platform-owned factory stock in manufacturer custody, stock-transfer requests, bulk dispatch, loss/damage claims, manufacturer payables and manufacturing reports.
- Distributor workspace: platform-owned outlet stock in distributor custody, inbound transfers/receipts, online order assignments, order preparation, marketing cards, customer letters, gift/packing checklist, carrier booking, customer-delivery tracking, returns/exchanges and distributor earnings/finance.
- Do not expose customer direct website orders, retail fulfillment tools, marketing card allocation, letters, or customer delivery checklists in factory-only mode.

### Accounting

- Existing accounting uses `JournalEntry`, `JournalLine`, accounting parties and account mappings. Manufacturer payouts flow through the existing payable/treasury pathway.
- The recent production workflow recognizes product COGS payable at production completion, excluding delivery/packaging overhead; successful customer delivery currently recognizes per-unit delivery overhead.
- The platform owns all inventory. Recognize product COGS payable to the manufacturer when finished production is completed; later movement to a distributor is a custody/location transfer, not a wholesale sale or second payable. Distributor compensation creates a distinct earnings payable. Manufacturer-set packaging/overhead is excluded from product COGS and becomes payable only for successfully delivered units, under approved cost terms.
- A manufacturer who is also a distributor may have two profiles attached to one login. Keep manufacturer COGS/overhead payables and distributor earnings in distinct subledgers; do not silently net balances or treat an inter-profile transfer as cash.

### Current working-tree note

Prior production-flow files are already modified/untracked in the working tree. They must be preserved. The implementation phase must inspect the current branch and diff before reconciling prior work; it must not revert unrelated or user changes.

## Target domain model

The names below are conceptual. The detailed Prisma design should settle exact names and referential actions during Iteration 1.

### Identity and role model

- `AuthAccount`: login identity and security state; remove authorization decisions based solely on its legacy single `role` once a backward-compatible role migration is ready.
- `BusinessProfile` (or separate typed profile records): registered legal/business identity and contact/location details.
- `ManufacturerProfile`: capability and contract specific to manufacturing, attached to a business identity.
- `DistributorProfile`: outlet/retail capability, attached to a business identity; for a dual-role manufacturer it references the same business identity/account but remains a distinct operational profile and backend role.
- `AccountWorkspaceRole` or the existing role mapping: active role grants, approval state, granted/revoked timestamps, actor, and profile binding. Make portal selection explicit in access and refresh tokens.
- `RoleApplication`: public registration or manufacturer request for distributor capability; submitted documents, review outcome, reason, reviewer and audit trail.
- Keep end-user customer/admin/marketing-partner authorization semantics unchanged except where shared auth code requires safe compatibility.

The additive schema adds `Distributor` linked optionally to `AuthAccount` and a `DISTRIBUTOR` RBAC role. Iteration 2 seeds profile-read and admin-review permissions, grants the role only after approval, and makes approved distributor profiles login-selectable. The migration remains unapplied, so those schema and seed changes are not yet deployed.

### Product and inventory model

Replace mutable variant arrays as the authoritative quantity with normalized SKU and stock records. The additive first-slice schema introduces these records alongside legacy inventory without backfilling or making either system authoritative yet:

- `ProductVariant` (or canonical SKU): product, size, color, stable SKU identity and active state. The same product's unit COGS remains product/batch-level and is independent of size/color, per the confirmed business rule.
- `InventoryLocation`: manufacturer factory, distributor outlet, transit shipment, quarantine/damage/scrap; records platform ownership separately from physical location and custodian profile.
- `InventoryLedgerEntry`: immutable stock delta, SKU, source/destination location, quantity, movement type, actor, source document/line, reason, idempotency key, timestamps.
- The first schema slice includes source references, optional production-cost-layer linkage and a unique idempotency key. Runtime movement writers and immutable-ledger enforcement arrive in the stock-service iteration.
- `InventoryBalance`: transactionally maintained location/SKU on-hand and reserved quantities. Transit, distributor, quarantine, damaged and loss states use separate location kinds; sellable quantity is derived only from active distributor locations. Ledger entries remain the audit source; balances cannot be directly client-edited.
- `ProductionBatch` and `ProductionBatchLine`: approved production terms, product-level unit COGS, MOQ as a commercial term, actual completion quantities by size/color, cost snapshot and factory location.
- Inventory state constraints: available quantity cannot be negative; reservations cannot exceed sellable stock; dispatch does not create retailer sellable stock; receipt quantity cannot exceed dispatched minus prior dispositions; each lifecycle command is idempotent.

### Bulk stock-transfer and logistics model

- `StockTransfer` and `StockTransferLine`: bulk movement request/authorization for products and variant quantities; source manufacturer location, destination distributor location, batch allocations, custody handoff, and status. This is not a wholesale sale or inventory ownership transfer.
- `StockTransferShipment` / `StockTransferShipmentLine`: one or more bulk carrier parcels, carrier booking/tracking, dispatched quantities, expected destination and status. Supports split/partial dispatch.
- `StockTransferReceipt` / `StockTransferReceiptLine`: distributor-confirmed good quantity, damaged quantity, missing quantity, packaging/condition, evidence and confirmation actor/time.
- `InventoryDiscrepancy`: typed claim and resolution for transit loss, missing units, stitch/manufacturing defect, delivery damage, other damage, refused/short receipt, or approved count adjustment. The initial schema records custody stage, responsible party, evidence, resolution and platform-loss amount. The platform bears the financial loss by default; recording responsibility must not silently create a deduction or recovery from a manufacturer/distributor.
- Keep bulk transfer shipping separate from customer `DeliveryOrder`; common carrier integration components can be shared, while the domain records and status transitions remain distinct.

### Retail order and compensation model

- `DistributorOrderAssignment`: online customer order allocated to a distributor profile, with availability/reservation snapshot and acceptance/decline lifecycle.
- `DistributorOrderFulfillment`: checklist, marketing-card/letter status, packing and carrier readiness owned by distributor. Reuse current services only behind distributor context after review.
- Keep `Order` as customer purchase. Replace manufacturer fulfillment ownership with retailer assignment ownership; retain source/seller/manufacturer references on line-level provenance when required for cost and supplier reporting.
- `DistributorCompensationPlan`: admin-approved effective-dated plan with type `COMMISSION`, `PER_SUCCESSFUL_DELIVERED_UNIT`, or `SALARY`; percentage/rate/amount, eligible scope, period, effective dates, approval and immutable version snapshot.
- `DistributorEarning` / `DistributorEarningLine`: accrual source order/item/delivery or salary period, formula snapshot, reversals for returns/cancellations, and settlement state.
- `DistributorSettlement` / `DistributorTransaction`: compensation payment, adjustment, reversal, and settlement linkage. Persist a printable statement view backed by ledger facts; do not include wholesale inventory AP/AR because the platform owns inventory.

## Target workflows and invariants

### A. Public registration and role-upgrade requests

1. Registration asks for **Manufacturer** or **Distributor**. Each path collects role-specific information and submits an application with a pending status.
2. Registration creates one secure login account and an application/profile in a transaction. Never let public input create an approved role grant, compensation plan or active inventory location.
3. Admin reviews, approves, rejects, suspends or requests more information. Role grant, profile activation and audit event are atomic.
4. An approved manufacturer can request DISTRIBUTOR capability from the factory workspace. Admin approval provisions a separate distributor profile and role grant using the existing account; a manufacturer remains factory-only until approval.
5. A user with one role enters its workspace directly after login. A user with both roles sees a workspace selector/switcher. Switching obtains a server-validated role-bound token/session (or an explicitly scoped session); UI-only switching is not authorization.
6. Single login route and consistent MFA, account lockout, refresh, revocation, audit and password-change policies apply to manufacturer and distributor roles.

### B. Manufacturing and production history

1. Manufacturer requests admin-approved product terms (one unit COGS for product across sizes/colors, MOQ, and separately itemized overhead/packaging if it is still applicable to manufacturer work).
2. Approved production request transitions through in-production, quality-check (if required), and completed.
3. Completed actual output creates production batch rows and factory on-hand quantities; changes appear in the factory's production/recent-changes view.
4. Factory on-hand quantities are not eligible for customer order assignment and are not shown as distributor sellable stock. Batch receipt creates platform-owned factory stock; production COGS payable is recognized at completed production.
5. Keep edits to completed production immutable; corrections use explicit adjustment/disposition records.

### C. Manufacturer bulk transfer to distributor

1. Distributor requests stock by product/SKU; admin reviews and individually authorizes every transfer before dispatch.
2. Manufacturer allocates platform-owned factory batches, prepares shipment and requests/books a carrier.
3. Dispatch atomically reduces factory available stock and records transit stock against the shipment. It does **not** increase distributor sellable inventory.
4. Distributor confirms receipt by SKU: good units, damaged units (typed), missing/lost units, and notes/evidence. Partial receipt is supported. Only confirmed-good units become distributor sellable stock.
5. Differences create a tracked discrepancy, escalation and resolution. A loss/damage adjustment is auditable, affects the correct location and financial party, and cannot be hidden by changing the received quantity.
6. Shipment can be partially received, split into parcels, lost, damaged, returned to sender or closed after resolution. No double receipt or over-receipt.

### D. Online customer orders and retail fulfillment

1. Order allocation searches eligible distributor outlets by real-time platform-owned sellable SKU quantities, status, service area, order constraints and existing ranking rules.
2. The hub assigns the customer order to a distributor, reserves its location inventory transactionally and stores a cost/provenance snapshot.
3. Only the distributor workspace receives assignment details and may accept/decline within policy. A manufacturer has no direct website order assignment or customer order detail access unless separately approved as a distributor.
4. Distributor portal owns order checklist, gift/marketing-card assignment, customer letter print, package details, delivery partner/carrier booking and delivery/return status.
5. On delivery, release/consume distributor-location stock and accrue distributor compensation according to the immutable plan snapshot. On cancellation, failed delivery, return, exchange or partial delivery, apply explicit reversal/restock/loss rules.
6. Each order item retains product, SKU, producing manufacturer, production batch, stock-transfer receipt and distributor-location provenance for recall, cost accounting and dispute resolution.

### E. Retailer compensation and finances

Admin defines one active compensation plan per retailer and effective period:

- **Commission-based**: percentage of net product amount after discounts/refunds, excluding delivery charges and tax (confirmed); accrue only for successfully delivered quantities; reverse/recalculate against accepted returns/refunds.
- **Per successful delivered product**: fixed amount per successfully delivered unit; partial orders accrue only on delivered quantities, while undelivered quantities accrue nothing until delivered. Later accepted returns must be reconciled.
- **Salary-based**: monthly salary period (confirmed), with proration/start/end rules and attendance/performance deductions only if explicitly approved; salary must not be computed as a per-order commission.

Finance dashboard for every retailer:

- Date window presets and custom start/end; timezone and inclusive boundaries defined.
- Accrued, paid and outstanding distributor compensation; advances, adjustments and reversals shown separately. Inventory custody does not create distributor AP/AR.
- Transaction ledger with source document, customer order or stock-transfer reference, posting/payment date, status, amount, account and explanatory description.
- Printable/downloadable statement includes selected period, opening balance, line items, totals, closing balances and generation timestamp; export respects permissions and sensitive customer data is minimized.
- Existing manufacturer finance remains separate and is accessible only in factory workspace. Dual-role users see each role ledger and, only if approved, a separately labeled consolidated view.

## Authorization and API architecture

- Use shared product/order/delivery/finance service logic where possible; separate controller/route policy and typed domain services by capability.
- Introduce explicit authenticated contexts such as `req.manufacturerProfileId`, `req.retailerProfileId`, and selected `req.workspaceRole`. Resolve the profile from validated account-role grants; ignore/reject client attempts to choose another profile.
- Scope all list, read, mutation, download, invoice and receipt queries to the active profile and referenced business relation. Add negative tests for cross-retailer and cross-manufacturer IDs.
- Proposed API families (exact route names to be finalized during implementation):
  - `/api/auth/register` or application endpoints for role-select registration; `/api/auth/login` with a target workspace; workspace list/switch endpoint.
  - `/api/role-applications` for public applications and manufacturer retailer-capability requests; `/api/admin/role-applications` for review.
  - `/api/manufacturer/production`, `/api/manufacturer/stock-transfers`, `/api/manufacturer/shipments`.
  - `/api/retailer/inventory`, `/api/retailer/receipts`, `/api/retailer/orders`, `/api/retailer/fulfillment`, `/api/retailer/finance`.
  - `/api/admin/distributors`, `/api/admin/stock-transfers`, `/api/admin/inventory-discrepancies`, `/api/admin/compensation-plans`.
- Keep a versioned compatibility period for existing `/api/manufacturer/*`, `/api/manufacturer-inventory/*`, order assignment, card, letter and finance routes. Migrate callers in a controlled sequence; reject legacy write routes once replacement has proven parity.
- Create a role/permission matrix. Factory-only cannot read or mutate customer assignments/retail fulfillment. Retailer-only cannot create/approve production or alter manufacturer batch stock. Dual-role workspace grants each permission only while that specific workspace is selected. Admin review operations are separately permissioned and audited.

## Portal redesign

### Single manufacturer/distributor portal and role selection

Replace the manufacturer-only login surface with a partner identity entry supporting:

- public registration type selection (Manufacturer / Distributor);
- one login route and common MFA/password reset;
- active-workspace selector after authentication for dual-role accounts;
- clearly separate navigation, context banners, route guards and APIs for Factory and Retailer modes;
- pending/suspended/rejected applications and capability-request status.

### Factory workspace

- Production requests, batches, quality and production history/recent changes.
- Platform-owned factory stock by product, size and color; available, reserved for transfer, and in transit separated.
- Distributor stock requests, authorized transfers, packing, bulk delivery partner/carrier booking, dispatch proof, receipts/discrepancies and manufacturer finance.
- Request “enable distributor workspace” action and status.
- No website customer orders, retail inventory, retail commission, customer cards/letters, customer packing checklist or direct customer orders.

### Retailer / distributor workspace

- Dashboard, platform-owned sellable inventory in distributor custody, inbound stock transfers, receipt verification and discrepancies.
- Online customer order hub, allocation acceptance, order details, stock reservation/release, fulfillment checklist, card/letter printing, customer delivery bookings, delivery/return status and customer support actions.
- Distributor compensation plan, finance dashboard, statement print/download and date filter.
- Manufacturer tools appear only in an approved factory workspace, not as blended sections.

### Admin portal

- Application queue: manufacturer registration, external distributor registration, and manufacturer distributor-upgrade requests.
- Manufacturer production contracts/terms and factory stock monitoring.
- Stock transfers, carrier statuses, distributor receipts, loss/damage claims and approvals.
- Distributor profile/status/service areas/order allocation eligibility.
- Compensation plan authoring, approval and effective-date history.
- Order routing monitor showing manufacturer provenance and actual retailer fulfillment owner.
- Separate manufacturer COGS AP, manufacturer delivery-overhead payable, distributor earnings payable, delivery charges and stock loss reporting; avoid an unexplained blended balance.

## Migration and rollout principles

1. **No destructive cutover.** Preserve current order, production, inventory, journal, payment, manufacturer, delivery and auth records; do not rename or drop legacy tables until verified data migration and rollback window close.
2. Add new role grants, retailer profiles, normalized SKUs, locations, stock balances/ledger, wholesale transfer records and assignment ownership alongside current data.
3. Backfill manufacturer hub quantities as factory stock by variant. Do not create retailer inventory or infer receipt merely because old stock existed.
4. Existing manufacturers become factory-only by default. Do not grant retailer authority implicitly. Existing operators apply or are explicitly approved for retailer capability.
5. Existing orders preserve their historical manufacturer assignment and cost snapshots. New orders route to retailer; historic reports must distinguish legacy manufacturer fulfillment from new retailer fulfillment.
6. Existing production layers and current payable journals must be reconciled against prior stock/COGS so migration does not duplicate liabilities or double-count stock. Establish a one-time reconciliation report and admin sign-off.
7. During dual-write/read migration, use idempotency keys and reconciliation checks; do not let both JSON and normalized ledgers independently mutate inventory.
8. Roll out by feature flags: schema/read-only admin view, factory/retailer applications, bulk transfer, retailer allocation, retail fulfillment, finance, then disable old pathways.
9. Prepare reversibility at each gate: stop new workflow, retain records, route supported users to legacy read-only screens if appropriate. Never delete canonical ledgers or accounting evidence as rollback.
10. Deploy migration and permission seeds through the normal controlled release process. Do not apply to production until backups, dry-run counts, accounting reconciliation and stakeholder approval are complete.

## Iterative delivery plan

Every iteration has an explicit review/demo gate. Iterations 1–5 are implemented locally, with Iteration 5 awaiting review and database-backed UAT. No database migration is applied or operational inventory cutover performed without a separate safe rollout/reconciliation gate.

**Current progress:** Iterations 1–5 are implemented locally. Iteration 2 includes active-role-specific token/MFA/profile context, workspace switching, pending distributor registration, manufacturer upgrade requests, admin review, and the initial distributor workspace. Iteration 3 introduces normalized case-insensitive SKU keys, stable location keys, append-only movement records, conditional balance updates that fail on concurrent changes or reserved-stock consumption, ledger/balance reconciliation, and COGS-only valuation helpers. Iteration 4 writes factory receipt movements and canonical COGS layers in the same serializable transaction as production completion and payable posting. Iteration 5 requests are distributor-scoped; admins approve per-SKU quantities; manufacturers can ship approved quantities with manually entered carrier details or NCM; NCM bookings use COD 0 and store the quoted freight as pending admin settlement. Dispatch moves stock factory → shipment transit, reduces transitional legacy factory/product availability in the same transaction, and links shipped units to FIFO COGS layers. Receipt is idempotent and can be partial; only accepted-good units enter the distributor's sellable location, while damaged/missing units move to non-sellable locations and open discrepancies. A dry-run-first migration utility is available at `backend/scripts/backfillInventoryLedger.js`; it will not write unless invoked with both `--apply` and `--confirm-ledger-backfill`. Existing stock and accounting data are untouched because migrations and backfill have not been run. Database-backed transfer execution and end-to-end NCM validation remain pending until deployment to a test database. Customer-order allocation still reads the legacy manufacturer inventory; retailer-order allocation and compensation remain later iterations.

### Iteration 0 — Policy and architecture sign-off

**Deliverables**

- Confirm platform ownership and distributor custody semantics, manufacturer COGS/overhead payable events, transfer approval policy, MOQ constraints, partial shipments/receipts, discrepancy liability and compensation formulas.
- Agree role-permission matrix, status state machines and accounting-party structure.
- Record baseline report totals and representative historical stock/order/payable data for reconciliation.

**Exit gate:** written decisions accepted; no unresolved rule would change core stock ownership or accounting events.

### Iteration 1 — Domain model, schema and migration design

**Progress:** additive base tables and Prisma relations for distributor identity, normalized SKU, platform-owned stock locations/balances/ledger, stock transfer, shipment, receipt and discrepancy have been added locally and Prisma-validated. Iteration 3 refined normalized SKU and stable location uniqueness. The migration is additive and has not been applied. Historical backfill/reconciliation design, final ERD/state diagram, and migration review remain before closing this iteration.

**Deliverables**

- ERD and canonical status/state transitions for applications, profiles, production, locations, ledger, stock transfers, shipments, receipts, discrepancies, distributor assignments, compensation and settlements.
- Prisma schema plan with foreign keys, uniqueness/idempotency constraints, indexes and decimal monetary types.
- Migration/backfill specification for existing stock, variants, orders, cost layers, journal lines and role grants.
- Data reconciliation SQL/scripts design, rollback and feature-flag plan.

**Exit gate:** schema review proves no stock or payable is created twice and historical records remain attributable.

### Iteration 2 — Identity, registration, workspace-aware authorization

**Progress:** implemented locally. The shared portal supports manufacturer/distributor sign-in selection and separate registration paths; manufacturers can request distributor access. Admins can list and review applications, with role grants/revocations and audit events. Active workspace selection, MFA, token rotation, profile loading, middleware, and role-scoped permission resolution are wired. Portal production builds and focused auth/RBAC tests pass; the DB-backed marketing-partner login test was blocked because the additive migration is intentionally unapplied. No migration has been applied.

**Deliverables**

- Registration type selector, pending manufacturer/distributor applications and manufacturer-to-retailer role-upgrade request.
- Admin review workflow and audit events.
- Multi-role login, MFA, access/refresh token role scope, workspace switching and profile-context middleware.
- Permission tests covering factory-only, retailer-only, dual-role, pending, suspended and admin accounts.

**Exit gate:** one account can safely select only its approved workspaces; existing customer/admin/partner auth tests remain green.

### Iteration 3 — Product variant catalog and stock ledger foundation

**Progress:** implemented locally. SKU identity uses normalized product/size/color keys while retaining display labels; factory, distributor, transit, quarantine, damaged, and lost locations use stable keys. Ledger service operations validate actors/idempotency, perform conditional source/destination balance updates inside a transaction, refuse consumption of reserved quantity, and expose reconciliation and COGS-only valuation helpers. Added a dry-run-first legacy JSON variant backfill utility, protected admin ledger/options/reconciliation APIs, an admin audit view, and focused unit tests. Prisma validation and the admin portal build pass. The database migration and backfill remain unapplied; the legacy customer order/stock paths remain unchanged during this iteration.

**Deliverables**

- Canonical product/size/color SKU IDs and migration of JSON variants.
- Factory, transit, retailer, quarantine and loss/damage locations.
- Append-only inventory ledger and transactionally updated balances.
- Inventory reconciliation, audit views, concurrency/oversell protections, stock movement and valuation tests.

**Exit gate:** all quantity changes have a source, actor, location, idempotency key and balanced before/after reconciliation.

### Iteration 4 — Manufacturer production and factory stock

**Progress:** implemented locally and focused tests pass. On completion, each approved product/size/color line gets one canonical SKU/cost layer and one idempotent `PRODUCTION_RECEIPT` movement into the manufacturer's factory location. This runs in the same serializable transaction as the legacy inventory update, production payable journal, and request completion. Production COGS remains product-level and excludes delivery overhead; the approved overhead is retained on the cost layer for the later successful-delivery settlement flow. Customer-order allocation was deliberately not switched in this iteration: the legacy manufacturer inventory and allocation paths remain active until the distributor receipt/fulfillment cutover and data reconciliation. Migrations remain unapplied.

**Deliverables**

- Factory-only navigation and production/batch/recent-change screens.
- Admin production terms, product-level unit COGS, MOQ policy and completed output by variant.
- Production receipt creates manufacturer-location ledger stock; ledger stock is not yet the customer-order source of truth.
- Production payable/accounting posts once according to Iteration 0 policy; batch costs remain frozen.

**Exit gate:** factory stock and production payable reconcile to batch output and cannot be used as retailer stock.

### Iteration 5 — Bulk stock transfer, shipment and distributor receipt

**Progress:** transfer APIs and portal/admin surfaces are implemented locally. Distributors can request factory SKUs; admin approval is per line and cannot exceed the request or currently ledger-available factory quantity. Manufacturers can split approved quantities across shipments and choose manual carrier details or NCM booking. NCM creates a shipment with COD set to zero; quoted freight is recorded with `PENDING_ADMIN_SETTLEMENT`, not journaled or paid by this iteration. External booking is submitted once, never blindly retried; uncertain outcomes reserve ledger, legacy, and cost-layer stock until an admin confirms booked/not-booked. Dispatch moves factory units to a shipment-specific transit location and decrements transitional legacy manufacturer/product stock in the same serializable transaction. Each shipment line carries FIFO production cost-layer allocations and an explicit uncosted legacy quantity. Distributor receipts are idempotent and partial; good units move to sellable distributor stock, damaged units to distributor damage stock, and reported missing units to a loss location with linked open discrepancies. Manufacturer/distributor portals and admin transfer review are wired. Prisma validation, both portal builds, and focused tests pass. Database-backed UAT is still required because migration application is intentionally outside this implementation turn.

**Deliverables**

- Distributor stock request / admin authorization and manufacturer allocation.
- Batch allocation, custody handoff and manufacturer bulk dispatch; no wholesale pricing or inventory-sale invoice.
- Bulk carrier selection and booking through NCM or manual tracking capture.
- Distributor receipt by SKU with good/damaged/missing quantities, evidence, partials and discrepancy resolution.
- Platform-owned stock ledger movements factory -> transit -> distributor/quarantine/loss; only accepted-good stock becomes sellable at the distributor location.
- Manufacturer-distributor same-account transfer path with two workspace views, custody audit and no duplicate physical stock.

**Exit gate:** dispatch and receipt are idempotent; inventory totals and money balances match across parties for partial, damaged, missing and complete shipments. Code-level idempotency and stock-conservation tests pass; the deployed database/UAT reconciliation gate remains open.

### Iteration 6 — Retailer order hub and retail operations

**Deliverables**

- Allocation engine chooses eligible platform-owned distributor-location inventory, reserves the variant, and assigns to the distributor profile.
- Distributor order acceptance/decline, checklist, card/letter, gift, packing, carrier booking and delivery workflows.
- Migrate relevant existing manufacturer portal components into distributor capability and remove them from factory-only routes/navigation.
- Cancellation, failed delivery, customer returns/exchanges, reallocation, partial delivery, inventory restore and loss paths.
- Keep shared APIs for manufacturer/distributor accounts while server-side scoping derives the active role/profile and inventory custody.

**Exit gate:** no manufacturer-only account receives customer order details; every assigned order has retailer stock provenance and audited state transitions.

### Iteration 7 — Retailer pay plans and financial statements

**Deliverables**

- Admin-authorized, effective-dated commission, per-successfully-delivered-unit and salary plans.
- Immutable order/period earning calculation snapshots, return/cancel reversals, approvals and settlements.
- Distributor dashboard: earnings payable/receivable, advances, adjustments, transaction history, date selection and printable statement. Do not show inventory wholesale AP/AR.
- Manufacturer COGS/overhead payables and distributor earnings payable remain separate in admin and dual-role workspaces.

**Exit gate:** test fixtures prove each compensation model, period, partial delivery, return, adjustment and settlement produces the expected subledger and journal totals.

### Iteration 8 — Admin portal and operational controls

**Deliverables**

- Unified application and role-upgrade review queue.
- Manufacturer, distributor, production, bulk transfer, shipment, receipt, damage/loss, customer order assignment and compensation administration.
- Network dashboards, search/filter/export, audit timeline, reconciliation exceptions and permission enforcement.
- Carrier integration supports bulk transfer shipments independently of customer delivery orders.

**Exit gate:** admin can trace an individual sold item from production batch through bulk transfer and customer delivery, including every financial and stock event.

### Iteration 9 — Backfill, parallel operation, UAT and cutover

**Deliverables**

- Migration rehearsal against a production-like backup; signed inventory, order and payable reconciliation.
- Role-by-role pilot with selected factory-only, retailer-only and dual-capability accounts.
- End-to-end UAT for production, bulk receipt, allocation, retailer compensation, return, loss/damage and printable statements.
- Performance, access-control, audit, backup/restore, rollback and monitoring checks.
- Feature-flag cutover; legacy manufacturer order allocation/direct-order/manual stock writes disabled after parity sign-off.

**Exit gate:** stakeholder acceptance, no unexplained stock/accounting variances, operational support guide and rollback window completed.

### Iteration 10 — Legacy retirement and post-launch hardening

**Deliverables**

- Remove legacy write paths only after cutover and reconciliation window.
- Retain historical reporting/access to legacy manufacturer assignments and finance records.
- Add monitoring for negative/reserved stock, shipments unreceived, unreconciled losses, stale compensation plans and subledger/general-ledger differences.
- Run post-launch review and prioritize operational refinements.

**Exit gate:** no active workflow depends on legacy mutable inventory arrays or manufacturer customer-order ownership.

## Cross-cutting test strategy and acceptance criteria

- **Identity/RBAC:** registration tampering, workspace selection, token refresh, MFA/revocation, cross-profile IDs, suspended/revoked role access.
- **Inventory:** variant accuracy, product-level same cost across size/color, no oversell under concurrent order assignment, idempotent dispatch/receipt, no pre-receipt retailer availability, no over-receipt, balanced stock movements.
- **Wholesale/shipping:** partial shipments, multiple parcels, short receipt, damage/loss, return-to-sender, duplicate carrier events, evidence and claim resolution.
- **Order hub:** no factory stock allocation, retailers with varying stock, assignment conflict, decline/reallocation, split quantities if supported.
- **Compensation/accounting:** every pay type, rate changes effective-dated, delivered-only recognition, delivery failure, cancellation, returns/exchanges, salary periods, partial/full settlement, adjustments, cash solvency, party-level subledger.
- **Reporting:** chosen dates/timezone, opening/closing balances, printable output agrees with ledger, no cross-tenant or unnecessary customer PII exposure.
- **Regression:** existing customer checkout, admin order management, delivery partner/carrier integration, NCM settlement, returns, accounting reports and customer/admin auth remain correct during transition.

## Risks and controls

| Risk | Control |
| --- | --- |
| Same account has factory and retailer capabilities; balances may be conflated | Separate role-bound profiles, parties, ledgers and workspace-scoped tokens; explicitly decide settlement netting |
| Old manufacturer inventory does not identify factory vs retailer stock precisely | Backfill only to factory location; require approved retailer opening-stock transfer/receipt rather than assuming |
| JSON variant stock and normalized ledger diverge during rollout | One canonical write path, temporary parity checks, feature-flagged read migration, reconciliation before disabling legacy writes |
| Duplicate payable due to prior production flow and new wholesale accounting | Reconcile existing journals and cost layers; source-key idempotency and one authoritative payable event per batch/contract |
| Transit stock appears available too early | Distinct transit location and receipt-confirmed retailer stock rule enforced in allocation query and DB service layer |
| Carrier webhook duplicates or out-of-order events | Idempotency keys, event log, allowed-transition state machine, reconciliation queue |
| Compensation disagreement or retroactive plan changes | Admin-approved immutable versions, effective periods, per-order calculation snapshots and visible earning details |
| User registration grants privileges before review | Pending application only; backend role grants/profile activation occur after authorized admin decision |
| Too-wide rewrite changes customer/shopper operations unexpectedly | Iteration gates, compatibility APIs, regression suite, feature flags and explicit migration scope |

## Decisions required before implementation

These are blocking domain decisions, not implementation details. The proposed defaults below minimize duplicate entities and preserve the existing unit-cost and payable decisions where possible.

1. **Role/portal design — resolved:** MANUFACTURER and DISTRIBUTOR are separate backend roles and permission sets. They share one Manufacturer/Distributor portal application. A single account can hold both after admin approval; the user selects a role-specific workspace after login. “Retailer” refers to the distributor outlet/workflow, not a third role.
2. **Manufacturer payment trigger — resolved:** Recognize product COGS payable when finished production is completed at the factory. The payable remains due while goods are at the factory or in transit. Bulk dispatch and distributor receipt move/confirm stock locations and must not create a second product payable. Packaging and other overhead remain excluded from bulk product COGS and are handled under the later successful-delivery rule.
3. **Inventory ownership and distributor compensation — resolved:** The platform/admin owns all product inventory. Manufacturers and distributors hold stock as custodians at their respective locations. The platform pays manufacturer COGS at completed production and distributor compensation under the admin-defined commission, per-successfully-delivered-unit, or salary plan. Manufacturer-set packaging/overhead remains separate from COGS and is payable only after successful customer delivery. A bulk transfer creates no wholesale sale or distributor AP/AR.
4. **Manufacturer acting as distributor — transfer invariant resolved:** Stock available to a distributor workspace must pass through an auditable platform stock transfer and distributor receipt, even when the manufacturer and distributor profiles share one account. Use a same-site transfer type when no physical carrier movement is needed.
5. **Commission basis — resolved:** Calculate commission as a percentage of the net product amount after discounts and refunds, excluding delivery charges and tax. Persist the eligible amount and plan/rate snapshot on each earning; reverse or recalculate against accepted returns/refunds.
6. **Salary and delivery compensation details — partly resolved:** Salary period is monthly. Salary proration/start/end rules remain open. Commission and per-unit compensation accrue on successfully delivered quantities in partially delivered orders; undelivered quantities accrue nothing until delivered.
7. **Inventory source — resolved:** All customer-order inventory is platform-owned and must trace to a manufacturer production batch and a confirmed distributor receipt. Distributors do not contribute independently owned stock.
8. **Transfer approvals — resolved:** Admin must individually approve each distributor stock transfer before dispatch.
9. **Loss/damage — partly resolved:** The platform bears the financial loss. The system records the custody stage/responsible party and evidence for admin review; it must not automatically deduct or recover the loss from a manufacturer/distributor. Detailed claim/dispute workflow remains to be defined.
10. **External carriers — resolved:** Manufacturers use the delivery-partner booking flow for bulk shipments to distributors. Keep bulk shipment/stock-transfer records separate from customer delivery orders, while reusing the existing delivery-partner integration where supported.
11. **Registration and existing manufacturer users — resolved:** Registration offers Manufacturer or Distributor. Existing manufacturers remain factory-only and cannot access the customer order hub until they request and receive admin approval for DISTRIBUTOR capability.

## Approval checkpoint

After the remaining decisions are answered and the plan is approved, implementation should begin with Iteration 0/1 design artifacts and schema/migration review—not a broad one-shot rewrite. Each iteration should be completed, tested, demonstrated and approved before starting the next.
