# P5-R13 — Multi-Party Commerce, Manufacturer, Distributor and Accounting Integration Architecture

**Review date:** 2026-11-18
**Status:** Complete for this static, repository-grounded architecture review only.
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.
**Scope:** Current mounted routes, portal callers, services, Prisma models, focused tests and accounting documentation. This is an architecture and roadmap deliverable, not authorization to change production behavior.

## Evidence boundary and status vocabulary

“Verified” below means that a current route/caller/service/model path was found in the repository. It does not establish that the route is deployed, the migration is applied, the transaction persisted, a source population is complete, or a balance is reconciled.

| Label | Meaning |
|---|---|
| `VERIFIED_IN_CODE` | The current mounted route or service path and its code-level source/effects were located. |
| `PARTIAL` | A path exists, but one or more source, lifecycle, evidence, reversal, report, or policy links are incomplete. |
| `MISSING` | No active, mounted end-to-end path was found for the stated workflow. |
| `LEGACY_OR_UNMOUNTED` | Code or models exist, but the reviewed production route/caller is absent or a compatibility path remains active. |
| `NOT_VERIFIABLE_WITHOUT_DATABASE` | Persistence, deployment/migration state, history, reconciliation, concurrency, or physical/legal evidence cannot be established from this review. |

No database, migration, seed, production system, customer/provider account, carrier, supplier, bank, tax authority, or external accounting system was accessed. No schema, production code, report calculation, or portal behavior changed. No Phase 6 or Phase 7 work was started.

The P5-R13-specific document `28-p5-r12-supplier-return-credit-and-refund-business-accounting-specification.md` was not present. Existing P5-R11, P5-R12, P5-R8, inventory/COGS, accounting-event, report-basis, Phase 4, and architecture documents were reviewed where relevant. The older `04-target-accounting-domain-model.md` and `manufacturer-distributor-retailer-architecture-plan.md` are design inputs, not proof of deployed behavior; conflicts with current code are called out below.

## 1. Current-state architecture

The repository is a set of independently routed React portals sharing an Express/Prisma API:

```text
frontend/        customer storefront
admin/           central business operations and accounting
manufacturer/    manufacturer and distributor workspace UI
marketing/       marketing-partner portal
backend/         Express API, services, Prisma models, accounting and integrations
```

`backend/server.js` mounts the route groups. The central runtime includes `/api/user`, `/api/product`, `/api/cart`, `/api/order`, `/api/finance`, `/api/returns`, `/api/accounting`, `/api/manufacturer`, `/api/manufacturer-production`, `/api/manufacturer-inventory`, `/api/distributor`, `/api/stock-transfers`, `/api/admin/inventory-ledger`, `/api/delivery`, and `/api/expense`. The server starts delivery-accounting and system-audit outbox workers. These are source-code facts; the configured database and deployment migration state were not inspected.

The usual boundary is portal/API caller → mounted route and middleware → controller/domain service → Prisma transaction → operational, subledger, inventory, Treasury, or journal records. Authorization is enforced server-side with the route middleware and workspace context where applicable. A portal permission check is not an authorization boundary.

| Area | Current authoritative or best-supported source | Important qualification |
|---|---|---|
| Identity and workspace | `AuthAccount`, customer/manufacturer/distributor/marketing profiles, account-role mappings and context middleware | Profiles remain separate; a dual-role account uses distinct workspace/profile context. The portal UI does not itself prove the server scope. |
| Customer order | `Order` and accepted pricing snapshots | A placed/unpaid COD order is not a receipt or earned sale. Split/package orders require an explicit parent/commercial-order distinction in metrics. |
| Production output | Production request/line plus accepted actual-good counts | The accepted output has a canonical factory receipt and production cost layer, alongside still-active legacy inventory projections. |
| Distributor custody | `StockTransfer`, shipment/receipt/discrepancy records, canonical location balances and movements | A carrier-delivered status is not distributor receipt. Receipt confirmation is a separate event. |
| Current stock quantity | `InventoryBalance`, with `InventoryLedgerEntry` movement history for supported paths | It is not the exclusive writer/reader. `Product.stockQuantity`/variant JSON, `StockLog`, `ManufacturerInventory`, and its movement records remain active in some paths. |
| Cost and COGS | Accepted production cost layers and linked allocations for supported production quantities | There is no complete cost-layer population for purchases, opening balances, all returns, damage/loss, and legacy stock; FIFO is used only in selected flows. |
| AP/AR and payments | `AccountingParty`, `AccountingDocument`, `AccountingAllocation`, legacy AP/AR records, `CashTransaction`, and journals | The newer source-linked documents coexist with legacy/manual records; source-population and control-account completeness are not established. |
| Posted financial statements | Posted/reversed journal population | Balanced journals or trial balance parity do not prove source completeness or external bank/cash reconciliation. |

The deployed/system-of-record state is `NOT_VERIFIABLE_WITHOUT_DATABASE`. Static route presence, generated Prisma code, and mocked tests do not establish that checked-in schema/migrations match the configured database.

## 2. Customer workflow map

| Stage | Current path and records | Current status and boundary |
|---|---|---|
| Account and profile | `/api/user/register`, profile and address routes; transactionally creates account and customer profile. Frontend login/registration is in `frontend/src/pages/Login.jsx`. | `VERIFIED_IN_CODE`. Duplicate identity and consent tests exist. |
| Product discovery and price | `/api/product/list`, `/single`, and `/resolve-prices`; product/location pricing services; frontend collection and shared shop context. | `VERIFIED_IN_CODE`. Product catalog/price fields and reports retain Float/Number compatibility sources; accepted snapshots protect some order flows but do not repair lost source precision. |
| Cart and checkout | `/api/cart/*` stores cart data on the customer profile. `/api/order/place` validates current product/price/stock and writes order and accepted pricing snapshots. | `PARTIAL`. Checkout defaults to COD and `payment=false`; it does not charge an online payment provider. Cart data is not a normalized, independent order/stock reservation ledger. Product stock writes and canonical distributor reservations are separate operations. |
| Order history and cancellation | `/api/order/userorders`; order cancellation is handoff/financial-activity gated and releases reservations when eligible. `frontend/src/pages/Orders.jsx` is the primary caller. | `PARTIAL`. Order/payment status is operational data, not proof of a customer receipt. The direct-order cash-receipt helper is not mounted from `orderRoute.js`. |
| Delivery | Customer tracking under `/api/delivery/customer/:id`; delivery provider webhook routes; delivery and settlement source records. Delivery accounting is queued via the outbox. | `PARTIAL`. A delivery status can trigger sale recognition but is not proof that COD reached company Treasury. |
| Returns, exchanges, refunds | Customer RMA and exchange requests under `/api/returns/customer/*` and `/api/returns/exchange/*`; Admin review/inspection, refund payable and payout are distinct transitions. | `PARTIAL`. Inspection and some accounting paths exist; legacy stock paths, source-linked restock/COGS, and universal correction/reversal are incomplete. The legacy direct return route is explicitly rejected. |
| Receivables and receipts | Staff-only `/api/finance/create-receivable` and `/api/finance/collect-receivable`; receipt service links eligible posted invoices, cash transaction, allocations and journal. | Customer-initiated receipt capture is `MISSING`. The generic staff collection route is `PARTIAL` relative to the whole commerce population and does not provide a direct-order receipt endpoint or independent bank statement match. |

**Commerce-to-accounting rule:** Order placement, COD selection, payment flags, delivery completion, distributor collection declarations, and courier remittance are distinct events. Recognize revenue/COGS only through the supported delivered-sale posting path; recognize a cash receipt only from an explicit source-linked receipt/remittance event and do not infer company cash from order or delivery state.

## 3. Manufacturer workflow map

| Stage | Current path and records | Current status and boundary |
|---|---|---|
| Registration and approval | Manufacturer registration under `/api/manufacturer`; self-registration creates an inactive/pending account/profile; Admin contract/status operations are mounted. | `VERIFIED_IN_CODE`. Pending registration does not grant active production access. |
| Capabilities and profile | Manufacturer profile, availability and pickup routes; `Manufacturer` has identity/contract/availability information. | `PARTIAL`. No complete production-capability catalog was established. |
| Production request and quality | Manufacturer production routes and `Production.jsx`/checklist screens manage terms, pre-production checks, start, completion and post-production checks with actual good size/color counts. | `VERIFIED_IN_CODE` for the supported workflow. Required production terms and quality transitions are enforced in the service path. |
| Accepted production receipt | Admin acceptance calls the production completion service; good units create a factory `PRODUCTION_RECEIPT`, production cost layer, and production accounting/payable effects in the completion transaction. | `VERIFIED_IN_CODE`; focused tests are mocked. Persistence, physical good counts and database migration state are `NOT_VERIFIABLE_WITHOUT_DATABASE`. |
| Manufacturer inventory screen | `/api/manufacturer-inventory` reads and records legacy `ManufacturerInventory` and `ManufacturerInventoryMovement`; increases are restricted to completed production while selected decreases remain possible. | `PARTIAL / LEGACY`. These records are not interchangeable with canonical location balances or movement history. |
| Stock supply to distributors | Manufacturer shipment/dispatch is part of the `StockTransfer` lifecycle; dispatch moves supported stock into transit and explicit distributor receipt determines good/damaged/missing disposition. | `VERIFIED_IN_CODE` for supported transfer sources; product payable is not created a second time by dispatch or receipt. |
| Customer orders | Normal automatic storefront allocation considers eligible distributor locations and stock. A manufacturer direct-order route file exists but was not mounted in `server.js`; a legacy manufacturer assignment surface may remain. | Manufacturer direct order is `LEGACY_OR_UNMOUNTED`; do not treat manufacturer portal code or a route file as a live customer fulfillment contract. |
| Payables and settlement | Production creates manufacturer payable accounting in the supported path. Manufacturer settlement request/history routes exist; Admin payout and approval routes are mounted. | `PARTIAL`. No dedicated manufacturer supplier-bill lifecycle was established, and the manufacturer Finance UI has no caller for the mounted settlement request POST. Broader payout bases and source completeness remain mixed. |

**Policy discrepancy requiring resolution:** `04-target-accounting-domain-model.md` documents manufacturer consignment, no company inventory asset at factory receipt, and manufacturer COGS/payable at delivery. Current production completion code and the newer inventory audit record PLATFORM-owned factory stock plus manufacturer payable at production completion. The older manufacturer/distributor plan also describes PLATFORM ownership. These are materially different recognition/title models. This architecture records current code as code behavior only; management must ratify the business rule, and documentation and code must be aligned before extending or reversing it. Do not silently reinterpret existing journals, layers, or stock.

## 4. Distributor workflow map

| Stage | Current path and records | Current status and boundary |
|---|---|---|
| Registration and territory | Distributor profile/application and Admin coverage/review routes; `DistributorLocation` stores coverage. | `PARTIAL`. The portal submits `POST /api/distributor/register`, while the reviewed mounted route is `GET /register`; the caller and route method do not match. Admin review/coverage exists, but normal portal submission is not verified end-to-end. |
| Stock request and approval | Distributor requests quantities; Admin approves per line against eligible source availability. | `VERIFIED_IN_CODE` for mounted stock-transfer routes and portal callers. Transfer approval is not a wholesale sale or AP/AR recognition. |
| Dispatch and transit | Manufacturer dispatch creates shipment-specific transit movement; supported shipment lines carry cost-layer allocations where available. NCM/manual freight has a separate logistics/accounting path. | `VERIFIED_IN_CODE`, with external booking outcome and actual custody not independently verified. An uncertain carrier booking must not be treated as a successful handoff. |
| Receipt and custody | Distributor records partial received quantities and good/damaged/missing disposition; discrepancies are opened for damage/loss. | `VERIFIED_IN_CODE`. Carrier delivery alone does not make stock sellable. Received returns may remain quarantined pending disposition. |
| Customer fulfillment and direct orders | Distributor order assignment/self-delivery and direct-order APIs are mounted. Canonical distributor balance reservations and fulfillment consumption support selected flows. | `PARTIAL`. Legacy Product and manufacturer stock paths remain; returned inventory and some older movements are not uniformly cost-layer-linked. |
| Customer cash collection | Distributor self-delivery records a source-linked `DistributorCashEvent`; OTP can verify it, otherwise the event is a pending distributor declaration. | `PARTIAL`. A distributor's declaration/OTP event is not company Treasury cash, and a pending declaration is not verified collection. No general partial-COD collection lifecycle was established. |
| Remittance and settlement | Distributor remittance/evidence and Admin review routes are mounted; other balance-settlement request/evidence/review/payout routes exist. Service records link internal Treasury, journal and allocations in supported paths. | `PARTIAL`. Distributor customer cash, cash held, remitted funds, company Treasury receipt and independent bank reconciliation must remain separate states. Legacy earning/request flows coexist with newer settlements. |
| Earnings and payout | Rate/earning/bonus and settlement services create selected distributor payable documents and journal effects; Admin maintains rates and reviews payouts. | `PARTIAL`. Service earnings are not the same as COD receivables. Legacy payout/reconciliation paths and source completeness remain open. |
| Stock returns and discrepancies | Distributor stock-return request, review, collection, receipt, inspection and discrepancy workflows are mounted. | `PARTIAL`. Quarantine and evidence flows exist, but responsibility/financial settlement and universal reversal are unresolved. Do not increase sellable distributor stock outside the approved transfer/receipt rule. |

## 5. Central operations workflow map

Admin is the control portal, but it does not yet provide one universal transaction ledger for all operational domains.

| Admin function | Mounted surface / source | Current status and limitation |
|---|---|---|
| Catalog and pricing | `/api/product` create/update/publish/delete/list plus Admin location pricing and discounts. | `VERIFIED_IN_CODE` for catalog controls. `Product.price`, `costPrice`, discounts, and several accepted order fields remain Float-backed or compatibility snapshots; pricing readers are not fully unified. |
| Manual stock adjustment | `/api/product/adjust-stock`, `/stock-logs`; product stock and variant JSON plus `StockLog`. | `PARTIAL / LEGACY`: this mounted path does not create an `InventoryLedgerEntry`/cost-layer event. It can change a catalog projection without a complete valuation/ownership journal effect. |
| Inventory ledger operations | `/api/admin/inventory-ledger` options, movement, audit and reconciliation surfaces; canonical `InventoryBalance` and `InventoryLedgerEntry`. | `PARTIAL`. Canonical movements are transaction-scoped and idempotent on supported paths, but legacy writers/readers remain and a complete physical/cost/GL reconciliation is not established. |
| Orders and allocation | Admin order creation/management, distributor assignment, delivery monitor and related APIs. | `PARTIAL`. Order creation may modify legacy product stock and separately reserve canonical distributor stock; these are not one universal source event. Normal automatic customer allocation is distributor-based. |
| Manufacturer and distributor management | Application, profile, coverage, production, transfer, receipt, finance and settlement routes; manufacturer/distributor screens share a portal app but use different server contexts. | `PARTIAL`. Portal role/workspace separation is implemented; route/caller mismatches and deployment/data validation remain. |
| Supplier bills and procurement | Expense management and selected vendor payable/credit routes; `OperatingExpense`, `AccountPayable`, and `AccountingDocument`. | `PARTIAL`. No mounted purchase-order → accepted goods-receipt → supplier-invoice → inventory cost-layer workflow was found. Expense-backed AP is not evidence of inventory receipt or acquired unit cost. |
| Treasury, AP/AR and payouts | `/api/finance`, Admin payables/receivables, treasury, payout and settlement screens. | `PARTIAL`. Some source-linked Decimal and approval paths exist; legacy AP/AR and Number/Float sources coexist. A user-entered reference or uploaded file is not independent bank evidence. |
| GL, approvals and audit | `/api/accounting`; journal, ledger, trial balance, statements, reconciliation and approval endpoints; existing `AccountingActionApproval`/events and audit outbox. | `PARTIAL`. Posted-ledger reports are distinct from source completeness; approval coverage is workflow-specific, not universal. |
| Management reporting | Posted-ledger statements, operational dashboards, source-scoped Accounting Health calculators, tax/operational reports and portal summaries. | `PARTIAL`. These readers have different source populations, time bases and precision. A balanced TB is not proof of complete events or bank reconciliation. |

The `marketing/` portal and partner campaign/redemption/accounting flows are adjacent to this core. P5-R1 identifies selected marketing CPA source-linked flows but incomplete legacy and full payable reconciliation; they should use the same event, party, approval, and report-basis controls rather than a separate accounting balance.

## 6. Cross-domain transaction map

| Transaction | Initiator / portal → API/service | Records and inventory effect | Financial/approval/report/correction boundary |
|---|---|---|---|
| Customer order | Customer storefront → `/api/order/place` → order/pricing services | Creates order and accepted pricing snapshot; checkout stock projection changes and distributor reservation are separate operations. | No online capture; COD default is unpaid. Delivered-sale outbox is a later source event. Cancellation releases an eligible reservation; it is not a refund. |
| Production completion | Manufacturer completes; Admin accepts → manufacturer-production route/controller → completion service | Production request/actual counts, canonical factory receipt, cost layer and legacy projection update. | Current code recognizes production payable/journal at completion. No production-specific receipt reversal was found. Reconcile this with the conflicting consignment-at-delivery design policy. |
| Distributor replenishment | Distributor requests; Admin approves; manufacturer dispatches; distributor receives → stock-transfer routes/service | StockTransfer/shipment/receipt/discrepancy plus factory→transit→distributor/quarantine/loss ledger movements where supported. | No wholesale sale/AP/AR at transfer. Manufacturer-paid local freight is separate. Correct through transfer/discrepancy/approved correction paths, not a second stock-in. |
| Delivered sale | Carrier/distributor delivery transition → delivery/self-delivery service → accounting outbox/poster | Delivery/order snapshot, fulfillment inventory/layer consumption for supported distributor stock, sale documents and journal. | Posting is idempotent/outbox-backed; pending/blocked events remain operationally visible. Delivery/COD is not company cash. |
| Distributor collection | Distributor records customer payment → self-delivery route/service | Source-linked DistributorCashEvent; verified or pending collection status. | No company Treasury movement on customer collection. A separate remittance event/review is required; do not recognize cash twice. |
| Distributor remittance | Distributor submits evidence; Admin reviews → distributor finance/remittance route/service | Cash events, remittance batch, allocations and settlement records. | Supported review can post Treasury/journal effects; independent bank matching and full legacy-population reconciliation remain absent. |
| Customer return/refund | Customer requests; Admin inspects/approves; payout/Distributor may participate → returns workflow and settlement routes | RMA/exchange history; some legacy stock writes; return/credit/payable documents. | Refund approval, payable, payout, actual cash and bank reconciliation are separate. No universal linked inventory/COGS reversal exists. |
| Supplier purchase/receipt | Admin expense/vendor bill path → expense/AP services | Expense/AP/document records; no active accepted supplier goods receipt and source-linked acquisition cost layer established. | Cannot treat a bill or `InboundShipment` snapshot as received stock or authoritative cost. Do not create inventory/GL effects without approved receipt, ownership, valuation and tax policy. |
| Supplier return/credit/refund | Admin supplier-return route; P5-R12 credit application approval | Return and internal credit/application records; existing return path can alter aggregate Product stock using submitted cost snapshots. | Credit application now has maker/checker using existing approval schema. Source receipt/cost, supplier acceptance, actual refund and reversal remain deferred. |
| Customer invoice receipt / payout | Authorized Finance/Admin → `/api/finance/collect-receivable` or approved payout route | CashTransaction, document allocations, Treasury and journal records in supported flows. | Idempotency and selected maker/checker exist; user evidence is not bank verification. Legacy sources and persisted concurrency remain unverified. |

## 7. Unified inventory and ownership architecture

### Current implementation

The canonical model is SKU/location based: normalized product/size/color identity, integer on-hand/reserved balances, locations such as factory, transit, distributor, quarantine, damaged, lost and return-related locations, plus append-only ledger entries with movement type, reference, actor/reason, idempotency, ownership marker and optional production cost-layer link. Supported movement services update source/destination balances and append the movement within the caller's transaction.

This is not yet a complete inventory source of truth:

- Canonical active code records `inventoryOwner = PLATFORM`; manufacturer/distributor IDs identify custody/location, not a separate proven legal owner. The service does not establish title from contracts or physical records.
- `Product.stockQuantity` and variant JSON, `StockLog`, `ManufacturerInventory`, and `ManufacturerInventoryMovement` still have active write/read paths. They cannot represent all locations, reservations, conditions, owners, in-transit stock or cost provenance.
- Production cost layers cover accepted production output only. Some transfer and fulfillment allocations link those layers; purchases, opening stock, some returns, damage/loss and legacy quantities may be uncosted or use catalog/legacy snapshots.
- FIFO appears in selected layer-allocation paths, not as one complete approved costing method across all source populations.
- Distributor customer returns and some older return/exchange paths can bypass the shared movement helper or restore legacy projections. Current repository policy prohibits an unsubstantiated distributor stock increase outside transfer receipt; returned items must remain held/quarantined until an approved disposition.
- A ledger balance is not a physical count, proof of legal ownership, or a complete 1140 inventory valuation/5100 COGS reconciliation.

### Target invariants

1. Represent **economic owner**, **custodian**, **physical location**, **condition/status**, and **reservation** as distinct dimensions. Do not infer title from a portal, user role, warehouse, manufacturer ID, or stock quantity.
2. Maintain one canonical quantity writer per SKU/location/owner. A movement records source/destination, integer quantity, condition, source event, actor, reason/evidence, stable idempotency key and timestamp. Update balances and append the movement in the same transaction.
3. Keep transfer custody stages explicit: source available → reserved → dispatched/in-transit → receipt inspected → good sellable, damaged/quarantine, missing/loss. Carrier status alone does not complete distributor receipt.
4. Link each valued quantity to an approved cost source/layer and preserve layer allocations through transfer, fulfillment, return and write-off. A unit without valid source cost is visible as uncosted; do not fill it from mutable catalog `Product.costPrice`.
5. Treat reservations as availability controls, not on-hand movement. Release, consume, or reverse reservations by the source order/transfer event.
6. Require accepted physical receipt and inspection before returning goods to sellable stock. Reversal must reference the original movement and layer allocation; do not increase stock from an internal return request.
7. Reconcile quantity by owner/location/condition and reconcile layer valuation, subledger and GL separately. Each report must state its cutoff, population, exclusions and uncosted/unmatched quantities.

### Ownership/custody decision gate

P5-R14 confirms that all stock transferred to distributors remains Aama-owned while held by them; distributors are custodians, and transfer/receipt is not a sale. The canonical ledger's `inventoryOwner = PLATFORM` convention and the existing manufacturer/distributor operations plan are consistent with that distributor-held rule, but neither proves physical stock or external legal title by itself. The older `04-target-accounting-domain-model.md` consignment wording must not be applied to stock already transferred to a distributor.

This decision does not resolve title, risk, or recognition for manufacturer-held stock before dispatch. Current production code records platform-owned factory stock and manufacturer payable at completion, while the older target-accounting document describes manufacturer consignment and payable/COGS at delivery. Keep that conflict open pending an explicit upstream policy decision. Do not reclassify historical stock or journals without source evidence and a reconciled migration plan.

## 8. Procurement and production architecture

### Confirmed current production path

The Admin-issued manufacturer production workflow has explicit material/GSM/target/batch terms, pre-production checks, MOQ/unit COGS terms, actual good size/color counts and post-production QA. Accepted good units enter the factory inventory-ledger path with a production cost layer. The production completion transaction updates production status, inventory/cost records, and manufacturer payable/journal. Distributor transfer/receipt is distinct and must not create another production payable.

This path is `VERIFIED_IN_CODE`, not persisted or physically verified. Production layer cost is the strongest current source for its supported population only.

### Missing supplier procurement path

The reviewed code did not establish a mounted PO → accepted goods receipt → supplier invoice match → inventory/cost layer path. `InboundShipment` is a legacy Float/JSON-backed model; its accounting helper has no active end-to-end receipt/cost-layer caller established. Expense-backed supplier bills support selected internal AP and journal records but do not prove accepted inventory, ownership, invoice eligibility, landed-cost allocation or unit acquisition cost.

### Target procurement sequence

```text
approved supplier / sourcing request
  → approved purchase order and immutable line terms
  → physical goods receipt and inspection (accepted / damaged / rejected / short)
  → source-linked quantity movement and cost evidence
  → supplier invoice matched to PO and accepted receipt
  → AP document and approved tax treatment
  → payment / allocation / independently reconciled bank evidence
  → source-to-subledger-to-GL and inventory valuation reconciliation
```

Do not post a supplier invoice as accepted inventory merely because a bill exists. Do not capitalize unsupported freight/tax or invent an allocation policy. Require policy for title, acceptance cutoff, quantity variance, landed cost, input VAT evidence/eligibility, foreign currency (if ever supported), returns, and correction/reversal before building this workflow.

Production purchase order and supplier procurement are different sources even if a manufacturer can act as a supplier. Keep production batch cost and supplier-received goods distinct; do not duplicate AP by attaching a procurement bill to a production payable without explicit event identity and reconciliation.

## 9. Distributor settlement architecture

Keep the following states and records distinct:

```text
stock requested → approved → dispatched → in transit → received/inspected → held/sellable
order assigned → fulfilled/delivered → customer collection declared/verified
cash held by distributor → remittance submitted → Admin-reviewed internal receipt
→ company Treasury recorded → independently bank-reconciled
```

An OTP or distributor collection event supports an operational collection state; it is not a company bank deposit. A remittance request, transfer reference, uploaded evidence, Admin approval, Treasury record and bank statement match are separate assertions. The current system has source-linked collection/remittance/settlement components, but no universal all-tender collection ledger or independent bank-statement-line reconciliation.

Distributor sales/collection, COD receivable, remitted cash, distributor payable/commission, manufacturer production payable and return/damage liability must not be netted implicitly. Any offset requires approved contractual authority, source-document allocations and an auditable event. Legacy earnings/request paths and newer settlement routes must be reconciled before retirement. Retain correction/reversal linkage to original cash events and journals; a generic journal reversal does not restore all operational/subledger records.

## 10. Unified accounting integration

### Current integration

The backend has source-linked `AccountingEvent`, `AccountingParty`, `AccountingDocument`, `AccountingAllocation`, journal and Treasury structures, delivery accounting outbox, audit events, and the reusable `AccountingActionApproval`/event maker-checker workflow. These models and helpers are real integration assets, but coverage is domain-specific; existence does not prove complete source populations or persisted balances.

Use the established posting engine and source-specific services. A source transaction should own its operational state change and durable posting event, with stable source identity/hash, effective date, actor, approval and complete transaction/retry semantics. One event produces one journal. Posted journals are not edited/deleted; corrections use linked reversals/adjustments and must also restore the matching source/subledger/inventory state.

### Event/evidence rules

| Event | Required evidence and effect boundary |
|---|---|
| Order accepted | Accepted price/discount/tax/quantity snapshot. No revenue or cash merely from placement. |
| Delivered sale | Delivery/fulfillment source, accepted snapshot and source-linked inventory/cost/receivable. Enqueue/post once; delivery is not cash. |
| Customer receipt | Eligible invoice/order, amount, tender, receiving party/account, actor, idempotency, evidence and allocation. Actual receipt is distinct from an entered reference. |
| Production completion | Approved batch terms, actual good output and QA. Link factory movement, cost layer and payable/journal under the ratified recognition policy. |
| Transfer dispatch/receipt | Approved transfer, shipment, actor, actual received good/damaged/missing quantities and discrepancy evidence. Movement does not create a second product payable. |
| Distributor remittance | Verified source collections, remitted amount, fee/variance and receiving Treasury account; separate independent bank match. |
| Supplier invoice/receipt | PO/accepted receipt, supplier bill, source cost, tax evidence and matching rules; no inventory valuation from expense bill alone. |
| Return/refund | Original source sale/receipt/line, eligible quantity/amount, physical disposition, supplier/customer evidence and linked journal/allocation reversal. Requested/expected refund is not received cash. |

### Monetary and date policy

Preserve the approved internal NPR policy: two decimal places, shared `accountingDecimal.js`, `Prisma.Decimal` for authoritative calculations, JavaScript Number rejected at strict monetary API boundaries, decimal-string serialization, explicit HALF_EVEN quantization, and effective date 2026-11-15. Continue to distinguish existing checkout nearest-NPR-5 final-payable behavior from accounting quantization until separately approved. The schema contains both Float and Decimal values, and JSON snapshots have historical Number values; schema scalar counts are not semantic monetary-field counts.

Do not invent account codes or statutory tax treatment. Existing ledger accounts are configured through mappings. PAN/VAT and tax reporting remains subject to entity facts and professional review; an internal tax projection is not a statutory filing. The 2026-11-15 policy, source-field scales and legacy conversion still need end-to-end coverage and isolated persisted validation.

## 11. Canonical database design

Prefer the existing source and posting models. The proposal below is a minimal design direction, not a schema change or approval to migrate. Use `Restrict`/immutable source history where existing patterns require it, unique event/idempotency keys, explicit currency and snapshot values, and indexes matching source lookup and open-balance/report queries.

| Concept | Existing model(s) and relationship | Required key/constraint/index and type direction |
|---|---|---|
| Identity / business party | Separate `AuthAccount`, `User`, `Manufacturer`, `Distributor`, and marketing profile models; `AccountingParty` maps `partyType + sourceEntityId` to one accounting party. | Retain unique source-party mapping and workspace RBAC. Do not merge portal profiles or let a client-supplied profile ID establish ownership. Index party type/status and source identity. |
| Product / SKU | `Product` plus canonical normalized `InventorySku`; `Order` retains accepted item/pricing JSON snapshots for compatibility. | SKU identity unique by product/normalized size/color. Keep garment quantity integral. Normalize commercial order lines only if required for referential source linkage; do not create a parallel order ledger. |
| Locations / quantity | `InventoryLocation`, `InventoryBalance`, `InventoryLedgerEntry`. Balance is a projection; ledger is append-only movement evidence. | Unique SKU/location/owner balance key; movement idempotency unique; FK to SKU/location/source where modeled; source/destination and movement indexes. Whole-unit `Int` quantities; owner and custodian explicit and independently policy-backed. |
| Production source / production layer | Production request/line and `ManufacturerInventoryCostLayer` / allocations. | Unique production request/SKU/variant cost-layer identity; integer produced/available/reserved/consumed quantities; Decimal costs; indexes by source, SKU, and allocation target. Current model is production-specific, not a universal supplier cost layer. |
| Distributor transfer | Existing `StockTransfer`, shipment, receipt, discrepancy, cost-layer allocation, and ledger movement records. | Stable request/shipment/receipt idempotency; unique source line/stage keys; integer sent/accepted/damaged/missing quantities; indexes by transfer status, manufacturer/distributor, shipment, and receipt date. Do not add a wholesale sale/AP model absent approved sale policy. |
| Procurement (missing) | Add only after policy: `PurchaseOrder` + `PurchaseOrderLine`, and `GoodsReceipt` + `GoodsReceiptLine`; link supplier to `AccountingParty`, PO lines to accepted receipt lines, receipt line to SKU and movement. | Unique PO number and external/source key; unique receipt idempotency; FK supplier/PO/line/SKU; indexes by supplier/status/date and PO/receipt line. Whole garment quantities as `Int`; monetary amounts as `Decimal(20,2)` under NPR policy; never Float/JSON for authoritative values. Keep expected, accepted, damaged and rejected quantities separate. |
| Acquisition cost layer (missing supplier source) | Do not pretend `ManufacturerInventoryCostLayer` covers supplier purchases. Prefer one generalized cost-layer model only if production and procurement can share invariants; otherwise retain explicit source-layer models and a common allocation contract. | Link exactly to accepted receipt/production source line and SKU; immutable origin/currency/unit-cost evidence; integer remaining quantity; explicit layer allocation history; unique origin key and source/SKU indexes. Scale/rounding of per-unit cost must reconcile with the approved two-decimal NPR policy before migration; no unapproved costing method. |
| Sales / delivery / return | `Order`, `DeliveryOrder`, `CustomerReturn`, `OrderExchangeRequest`, delivery events and accepted snapshots. | Stable order/delivery/return source IDs; immutable accepted values; unique source-event keys. Add normalized line FKs only when required to enforce returned/fulfilled quantities without duplicate source records. |
| Cash and settlement | `DistributorCashEvent`, remittance/settlement models, `CashTransaction`, `FinancialAccount`, payout records and `AccountingAllocation`. | Unique source/idempotency keys; amount `Decimal(20,2)`; explicit currency, tender, custody/receiving party, evidence status, reviewer and bank-reconciliation status. Index party/date/status and allocation/document/cash links. Never treat a transfer reference as a bank match. |
| Subledger / GL | Existing `AccountingParty`, `AccountingEvent`, `AccountingDocument`, `AccountingAllocation`, `JournalEntry`, `JournalLine`, `CashTransaction`. | `AccountingEvent.idempotencyKey` unique; source type/id/version indexed; `AccountingDocument` source/party/side/status indexed; allocations unique by idempotency and reverse link; amounts Decimal under approved scale; journals balanced/immutable with reversal relation and source link. Do not introduce a second GL. |
| Approval / audit | Existing `AccountingActionApproval` and ordered `AccountingActionApprovalEvent`, system audit outbox. | Unique request key/payload hash; maker/reviewer IDs and timestamps; reject self-review; event sequence unique; preserve immutable approval history. Reuse for actions requiring maker/checker rather than adding an approval Boolean. |
| Reconciliation | Existing source-scoped Accounting Health calculators and report basis descriptors. | Extend only for defined source populations/cutoffs: run ID, source population and cutoff, GL/control account, source/subledger totals, exclusions and variances. Persisted runs require independent population evidence and reviewer identity; “balanced TB” is not a completeness flag. |

The schema review found no active `PurchaseOrder`/accepted `GoodsReceipt` model path. `InboundShipment` is not a substitute. The suggested procurement entities are a future minimum, subject to ownership, receipt, valuation, landed-cost, tax and correction policy approval. No schema or migration was created in P5-R13.

## 12. Reporting source-of-truth matrix

| KPI / report | Authoritative source and population | Required caveat / not an acceptable substitute |
|---|---|---|
| Total orders | Distinct commercial order identity from `Order`, with split/package grouping explicitly defined. | Do not count split shipments as independent customer demand unless the metric is labeled packages/orders. |
| Delivered units / fulfillment | Delivery and fulfillment source event joined to order lines and actual accepted quantity. | Order status alone does not prove inventory issue, collection or receipt. |
| Recognized sales/revenue | Posted source-linked delivery-sale journals and invoices, using transaction/effective date basis. | Placed orders, catalog prices, `Order.payment`, analytics totals and operational `Order.date` are not posted revenue. |
| Gross profit / COGS | Posted sale/COGS journals linked to accepted cost-layer or explicitly classified legacy cost for the same delivered quantity. | Do not use current `Product.costPrice` or incomplete costs as confirmed gross profit. Label estimates or suppress margin when cost provenance is missing. |
| Inventory quantity | `InventoryBalance` by SKU, owner, location and condition as of one cutoff; reconcile movements. | Admin Product stock and manufacturer legacy inventory are projections, not the canonical all-location balance. |
| Inventory value | Eligible remaining cost-layer quantity and approved valuation method, tied to the same location/owner cutoff and inventory GL control. | No total valuation until legacy, opening, receipt, return, damage/loss and uncosted populations are included or explicitly excluded. |
| Manufacturer performance | Production requests, approved batch terms, accepted good counts, QA outcomes, transfer dispatch/receipt and source-linked settlement. | Portal order counts or manufacturer inventory alone do not measure yield, quality or payable accuracy. |
| Distributor performance | Assigned orders, accepted transfer receipts, fulfilled/delivered quantities, verified collections, remittances, approved service earnings and returns. | Keep delivery, cash collected, cash held, remitted, Treasury-received and bank-reconciled metrics separate. |
| Distributor cash outstanding | Verified customer collection events less linked remittances/approved adjustments at a defined cutoff. | Exclude pending declarations; do not equate delivery COD or balance-settlement request with company cash. |
| Customer AR / supplier AP | Open `AccountingDocument` plus explicitly reconciled legacy balances and allocations, by party/side/currency/cutoff. | Current mixed Payables & Receivables reports are not complete source-population or control-account proof. |
| Treasury balances | `FinancialAccount`/`CashTransaction` internal register and corresponding mapped GL, separately by account. | Treasury-to-GL match is not physical cash count, bank statement match, gateway settlement or proof of availability. |
| Cash flow | Posted journal lines for approved cash-equivalent mappings and period, with separate actual-bank reconciliation. | Operational dashboard estimates and combined cash/provider-clearing balances are not reconciled cash flow. |
| Returns/refunds | Original sale/receipt linked to RMA inspection, accepted quantity/value, credit/payable, payment and reversal events. | Return request, expected refund, distributor evidence upload or refund status is not received cash or completed stock restoration. |
| Tax / VAT | Effective-dated approved tax status/rate and source invoice/sale evidence, reconciled to posted tax journals. | Internal estimate and recorded invoice reference are not tax-authority verification or a filed return. |

Reports must expose date basis, status population, source models, exclusions, estimate/unverified markers, and whether reconciliation is established. The current posted-ledger statements correctly differ from operational dashboards; do not consolidate them into one unqualified KPI.

## 13. Critical gap register

Rank reflects financial, inventory, authorization, operational, data-integrity and reporting risk together. Exact file anchors identify the current path to investigate; they do not prove a deployed incident.

| Rank | Gap and current evidence | Required correction / acceptance criteria |
|---|---|---|
| **Critical 1** | Multiple inventory sources/writers: `backend/controllers/productController.js` stock adjustment; `backend/controllers/orderController.js` checkout/Admin creation; `backend/services/inventoryLedgerService.js`; legacy `ManufacturerInventory` controllers; customer/distributor return services. P5-R7 documents Product/JSON, StockLog, canonical ledger and cost layers as non-equivalent. | Apply the confirmed Aama-owned/distributor-custody rule to distributor-held units; resolve remaining manufacturer-held/source ownership, valuation and disposition policies; enumerate active writers/readers; cut over one source at a time. Every quantity change must be one idempotent source-linked movement with balance parity, reason/actor, reservation and layer impact. No unexplained quantity or value variance in isolated persisted tests. |
| **Critical 2** | Production asset/payable-at-completion code conflicts with `docs/accounting/04-target-accounting-domain-model.md` consignment/COGS-at-delivery policy and older inventory ownership descriptions. | Obtain dated management approval for title, risk, recognition and loss responsibility; reconcile prior postings/layers; update canonical policy docs and tests before further recognition changes. No historical journal rewrite without explicit plan. |
| **Critical 3** | Supplier procurement has no active mounted PO/accepted receipt/source-linked acquisition-cost path; `InboundShipment` and helper are not a proven production workflow. | Approve PO/acceptance/landed-cost/tax/ownership/correction policies. Design source-linked PO and accepted receipt; match supplier invoices and cost layers; prove AP/GL/inventory invariants with clean/populated isolated DB tests and independent invoice/physical evidence. |
| **Critical 4** | Storefront/Admin stock changes and subsequent distributor reservation/fulfillment are separate; legacy stock adjustment does not write canonical ledger. | Define the sole stock source and cutover sequence; include order placement, reservation, cancellation, fulfillment, direct order, return and legacy projection parity. Prevent oversell/concurrent duplicate issue in real database tests. |
| **High 5** | Distributor registration caller uses POST while reviewed route is GET; `manufacturer/src/pages/Login.jsx` and `backend/routes/distributorRoute.js`. | Align the intended method/contract and test the actual portal route plus pending-application/admin-approval lifecycle, workspace scope and no pre-approval role grant. |
| **High 6** | Customer online payment and direct-order receipt capture are missing; mounted invoice collection is staff-only, and `orderController.cashReceived` is not mounted. | Approve tender, collector/custody, partial payment, advance/unallocated receipt and reversal rules; add one source-linked receipt path and separate independently verified bank reconciliation. Do not use `Order.payment` as proof. |
| **High 7** | Distributor cash states are partly represented but not unified; pending OTP-disabled declarations, remittance, Treasury record and bank match differ. Legacy and newer settlement routes coexist. | Define full state machine and source-keyed collection→remittance→Treasury→bank reconciliation; ensure no double revenue/cash and each correction restores its source allocations. |
| **High 8** | Returns and exchanges have mixed legacy/canonical stock, COGS and refund paths; supplier returns may use submitted cost snapshots. | Require original source-line/receipt, inspection/disposition, original cost allocation, external acceptance/receipt evidence as relevant, and linked reversal before posting. Keep supplier returns/refunds deferred until supported. |
| **High 9** | Report populations differ: posted GL, operational dashboards, estimate tax/working capital, partial control calculators, legacy AP/AR and inventory estimates. | Complete endpoint/export population map, label all report bases, compare representative period and reconcile complete source/subledger/GL populations on a verified isolated database. |
| **High 10** | Float/Number fields and Number-valued JSON coexist with Decimal posting; schema type counts differ across older documentation and are not semantic money totals. | Continue field-level R8 inventory, preserve approved NPR/HALF_EVEN boundary, stage migration with exact conversion/drift report, API compatibility and rollback; never bulk-convert based on field names. |
| **Release blocker 11** | Database migration, persisted state, historical balances, rollback, concurrency, and independent physical/bank/supplier evidence are unknown. | Provision and independently verify an isolated clean and representative-data database; rehearse migrations, backups, rollback, source reconciliations and concurrency. Keep production release blocked until signed exit evidence exists. |

## 14. Prioritized development roadmap

| Order | Work package | Dependencies / exit gate |
|---|---|---|
| 0 | **Policy and source facts:** retain the confirmed Aama ownership of distributor-held stock; resolve manufacturer-held title/production recognition, procurement acceptance/valuation, return disposition, distributor loss responsibility, cash custody, tax evidence and KPI definitions. | Named management/Finance owners; dated approvals and effective dates. Do not encode unresolved choices. |
| 1 | **Safe validation foundation:** provision a new independently verified isolated database, establish migration/backup/restore/rollback rehearsal and representative fixtures. | Never use the prohibited/shared database. Verify schema/migration alignment before persisted claims. |
| 2 | **Canonical inventory source plan:** inventory every legacy/canonical writer and reader, define opening-stock and layerless quantity treatment, and choose one bounded cutover with source keys. | Reconcile existing supported production→transfer→receipt→fulfillment flow; no duplicate inventory or payable. |
| 3 | **Single-writer inventory increments:** migrate narrowly selected manual adjustment/order paths to canonical movements only after policy; preserve old history, feature-gate, and compare old/new quantity projections. | Idempotency, actor/evidence, concurrent oversell, cancellation and rollback tests; source-to-balance and cost-layer reconciliation. |
| 4 | **Supplier procurement foundation:** implement approved PO/receipt/invoice matching and accepted quantity/cost evidence without assuming tax/landed-cost rules. | New minimal schema proposal and migration rehearsal; purchase receipt, AP, cost layer and GL source event must reconcile. |
| 5 | **Cash and settlement lifecycle:** complete customer/direct-order receipt, distributor cash custody/remittance, bank statement matching and correction/reversal, keeping expected/declared/received/reconciled states distinct. | Approved tender/custody policies and source-linked idempotent state machines; independent bank/cash evidence. |
| 6 | **Returns and exchanges:** unify physical disposition, original cost-layer restoration/write-off, invoice/credit/refund and linked reversal. | Original source line, title/ownership, return eligibility and acceptance evidence; isolated rollback/concurrency tests. |
| 7 | **Reporting and reconciliation:** reconcile inventory/cost/GL, AP/AR/party, Treasury and source populations at common cutoffs; retire estimates only after parity. | Complete reader/export inventory, representative data, variance ownership and independent review. |
| 8 | **Controlled migration/cutover:** backfill only with supported source evidence; dual-run, sign off, monitor and retire legacy writers in bounded domains. | Data-owner reconciliation, recovery test, permissions review, rollback window and written release approval. |

Do not start Phase 6 or Phase 7. The existing roadmap and tracker remain authoritative for broader Phase 4/5 close-out and professional/accounting release gates.

## 15. Recommended next implementation increment

**P5-R14 proposal — Reconcile distributor transfer movements before any stock-writer cutover.**

The distributor-held ownership rule is now confirmed. The remaining policy decision is manufacturer-held inventory before dispatch: reconcile current code's PLATFORM factory inventory and manufacturer payable at accepted production completion with the older consignment design's no platform inventory at factory receipt and COGS/payable at delivery. Do not extend that unresolved conflict to distributor-held stock.

The next code slice should be read-only: extend the existing source-scoped Accounting Health inventory comparison to reconcile StockTransfer authorization/dispatch/receipt/discrepancy quantities against canonical ledger movements and balances, including `PLATFORM` ownership, in-transit/damaged/missing/uncosted populations, and partial shipments. Preserve existing API compatibility; report exceptions without auto-correcting stock or creating accounting entries.

Use mocked tests for classification and error behavior, then require a verified isolated database and physical/custody evidence before any persisted reconciliation claim. Do not combine this slice with stock-writer cutover, manual adjustments, checkout, procurement, returns, historical backfill, or GL recognition. The separate Admin manual stock-adjustment path remains a later cutover candidate because it changes Product/JSON and `StockLog` outside the canonical ledger.

### Validation and status summary

- **Files reviewed:** `backend/server.js`; current customer, manufacturer, distributor, product, inventory, production, stock-transfer, delivery, returns, finance, accounting and expense route/service/controller/model surfaces; portal callers and focused tests identified in the workflow traces; `backend/prisma/schema.prisma`; relevant accounting/architecture documents including P5-R1/R2/R7/R8/R11/R12 and R14 references.
- **Confirmed workflows:** customer registration/catalog/checkout/order and delivery; manufacturer onboarding/production QA/accepted receipt/cost layer/payable; distributor stock transfer/receipt, fulfillment, collection/remittance and selected earnings; Admin catalog/order/finance/accounting/approval/report surfaces.
- **Missing or inconsistent:** supplier PO/accepted receipt/acquisition cost path; customer online/direct-order receipt; canonical inventory single-writer/cost population; portal/route mismatch for distributor registration; universal return/COGS/refund reversal; independent bank reconciliation; report-source completeness; conflicting production ownership/recognition policies.
- **Critical architecture risk:** multiple active inventory sources and incompatible title/recognition assumptions can produce quantities, costs, payables and reports that are individually plausible but not mutually reconciled.
- **P5-R13:** **COMPLETE FOR STATIC ARCHITECTURE/DOCUMENTATION SCOPE ONLY**; no production implementation.
- **Phase 5:** **PARTIAL / INCOMPLETE**.
- **R8:** **PARTIAL**.
- **P4.2:** **INCOMPLETE**.
- **P4.3:** **IN PROGRESS, INCOMPLETE**.
- **Phase 4:** **INCOMPLETE**.
- **Validation performed:** repository/static route, model, document and test-evidence review; `git diff --check` after documentation edits. No application test/build was run because no runtime code/schema changed.
- **Database/external access:** none. No database or migration commands, suppliers, banks, carriers, payment providers, or government systems were accessed.
- **Production behavior/schema changes:** none. Persisted validation was **NOT PERFORMED**.
