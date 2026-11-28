# R14 — Internal Business-Event Inventory

**Review date:** 2026-11-16

**Status:** **PARTIAL** — static source inventory; not a persisted accounting audit.

**Method:** Read-only review of repository portals, API routes, controllers, services, Prisma schema/migrations, reporting paths and test files. No database connection, database-dependent test, migration, seed, diagnostic or monetary mutation was performed.

This inventory records behavior found in code, not proof that the behavior has run correctly or that a displayed balance is complete. `IMPLEMENTED` means a source path exists; it does not mean end-to-end correctness. `PARTIALLY IMPLEMENTED` means selected paths or records are represented but completeness, accounting linkage, or reversal coverage is missing. `NOT FOUND` means no active call path was found in the inspected repository; it is not proof no manual process exists.

## 1. Source-of-truth design boundary

The internal accounting design must preserve distinct records for:

1. **Business source/evidence:** what was ordered, delivered, received, returned, approved, paid, or corrected.
2. **Operational state:** fulfillment, physical custody, quantity, counterparty and workflow status.
3. **Subledger:** the party document, allocation, asset, loan, or cost-layer balance that explains an amount due or held.
4. **Settlement evidence:** actual cash, bank, wallet, COD, carrier, or provider movement. An order-paid Boolean or remittance status is not a receipt.
5. **General ledger:** immutable posted journal lines that classify the financial event.
6. **Management reports:** reproducible views over identified source/subledger/GL populations at an explicit cutoff.

This is a **PROPOSED INTERNAL SOURCE-OF-TRUTH CONTRACT**, not a claim that the repository currently enforces the full chain:

```text
business source + evidence
  -> stable event identity and effective date
  -> source-linked party/inventory subledger and settlement allocation
  -> one immutable, balanced journal (or explicit non-posting state)
  -> report/reconciliation result with cutoff and exception population
```

An event can have more than one consequence (for example a return affects sales, tax, inventory, and refund payable), but it must retain one original business identity and linked, separately identifiable accounting effects. Do not equate a balanced journal with source completeness, create a second journal to mask a missing source, or mutate posted entries to force a report tie-out.

## 2. Event-entry inventory

| Domain / event | Portal and entry point; source identity | Current source, lifecycle, and financial/inventory effect | Retry, reversal, reports, existing tests and evidence status |
|---|---|---|---|
| Storefront checkout / order placement | Frontend `PlaceOrder`; `POST /api/order/place`; `Order.id`, `checkoutGroupId` | Server recalculates product prices and delivery fee; creates order/split shipment snapshots. Storefront path is COD and initially unpaid. Order exists before delivery recognition. | Order-create caller idempotency is not established by this review. A delivered-order accounting outbox exists. Customer order, sales, and inventory reports consume different populations. **PARTIALLY IMPLEMENTED.** |
| Admin-created order | Admin order page; `POST /api/order/admin-create`; `Order.id` | Accepts method, payment Boolean, manual discount and delivery fee; not a payment-provider authorization/capture flow. May create accounting event(s) depending on payment/delivery state. | Replay behavior differs from customer checkout; confirm source idempotency and tender evidence. **PARTIALLY IMPLEMENTED.** |
| Delivery and sales recognition | NCM delivery webhooks/status service; `DeliveryOrder`, `DeliveryEvent`, `Order.id` | Delivery status triggers `DELIVERY_SALE` accounting outbox; delivered poster recognizes sales/tax/delivery, receivable or tender, and relevant cost/payable effects. Delivery also changes `Order.payment=true` for COD, which is not itself cash proof. | Outbox retries posting. Recognition timing has an owner-confirmed delivered-event rule in existing accounting documentation; exact late/corrected delivery-period policy still needs explicit operating rules. **PARTIALLY IMPLEMENTED.** |
| Customer receipt / collection | `recordDeliveredOrderCashReceipt` helper and `/api/financial/collect-receivable`; `AccountReceivable` or order ID | Treasury collection path updates AR, cash/Treasury and journal in a transaction; a separate helper exists but is not mounted by the order route. Other collection endpoint supports discount/fine adjustments. | Stable keys and exact replay exist in selected paths. Duplicate collection implementations differ in adjustment semantics and route availability. **PARTIALLY IMPLEMENTED.** |
| Pre-handoff cancellation | Customer/Admin order cancellation; order/delivery/assignment IDs | Cancels before NCM handoff and releases reservations. No refund/journal reversal in that cancellation operation. Customer cancellation wrapper does not require the order to be unpaid; Admin wrapper does. | No completed-payment compensation in customer cancellation path. **PARTIALLY IMPLEMENTED; P1 risk.** |
| Customer return request and review | Customer portal and Admin RMA; `CustomerReturn.id`, request key, order/line identity | Request is idempotency-keyed and quantity/refund snapshots derive from sold quantity/prior returns. Decision captures route, approved refund, and fee. Request alone does not move cash or restock. | Event/request keys and NCM attempts support replay/reconciliation. **IMPLEMENTED for request/review controls; financial completion is separate.** |
| Return receipt and inspection | NCM event or distributor self-delivery; return ID and item quantities | Warehouse receipt precedes inspection. Restockable and damaged items have distinct outcomes; distributor route uses ledger movements/discrepancies, while some customer/manufacturer return paths update legacy stock/`StockLog`. Accepted non-distributor return can post a sales-return journal and refund payable. | Stable posting/event keys exist; no complete end-to-end reversal/reopen for completed refund plus stock disposition. **PARTIALLY IMPLEMENTED.** |
| Refund | Platform payable payout or distributor evidence review; return/exchange ID | Platform refund uses customer-refund AP and later payable payout; distributor refund requires evidence and Admin review and can reverse counter-sale earnings. | Settlement/payout keys and evidence-review replay exist in selected flows. Refund report/reconciliation excludes some distributor and legacy sources; no universal reversal. **PARTIALLY IMPLEMENTED.** |
| Exchange | Customer/Admin/Distributor exchange workflow; `OrderExchangeRequest.id` and request key | Delivered-order window, item/price snapshots, return/replacement legs, inventory reservations, price-difference collection/credit, accounting and invoice adjustment are distinct steps. | NCM attempt/status reconciliation exists. No approved/in-progress customer cancellation or atomic business-level reversal across stock, collection/credit and journal. **PARTIALLY IMPLEMENTED.** |
| Supplier/manufacturer purchase and payable | Expense module, production workflow, inbound-shipment model/helper; `OperatingExpense`, production request, shipment, `AccountingDocument` | Expense entry posts cash/AP and journal transactionally. Production receipt posts costed inventory and manufacturer AP. Inbound-purchase poster exists but no active caller or connected quantity/cost-layer receipt was found. | Expense idempotency, payout initiation/confirmation, and production source keys exist. Purchase-to-stock receipt is a material gap. **PARTIALLY IMPLEMENTED.** |
| Supplier return / credit | Admin supplier-return route; return ID, request key, supplier and shipment | Return affects stock and posts accounting; can create a supplier credit note or cash-refund record. Credit application reduces open credit/bill balances and records allocation without a second journal. | Return request and credit application are keyed; application reversal was not found. **PARTIALLY IMPLEMENTED.** |
| Supplier/manufacturer payment | Admin finance / manufacturer workflow; payout ID/key, target party and payable document | Payout reservation is not payment. Independent reviewer confirmation updates Treasury, cash transaction, AP/payment allocation and journal; failure releases reservation. Manufacturer allocation and legacy journal summary are separate from some document flows. | Idempotency, maker-checker and selected correction paths exist. Unallocated excess, legacy sources and general AP/GL reconciliation remain incomplete. **PARTIALLY IMPLEMENTED.** |
| Customer/distributor receivable and cash settlement | Finance and distributor portals; AR/document, cash event, settlement batch IDs | Customer collection and distributor COD/remittance use separate source records. New distributor settlement can net approved AP/AR docs and record cash and journal; manual generic receivable creation may create only a balance record. | Stable keys/serializable logic exist in newer paths; legacy/manual records and full controls not reconciled. **PARTIALLY IMPLEMENTED.** |
| Inventory receipt / production | Admin production workflow; `ManufacturerProductionRequest`, SKU, receipt key | Good production units create factory `InventoryBalance`, `InventoryLedgerEntry` and Decimal cost layer; `ManufacturerInventory` is also maintained as a projection. | Request/SKU idempotency and posting keys exist. Damage is reviewed but not fully represented as received damaged inventory. **PARTIALLY IMPLEMENTED.** |
| Stock transfer / reservation / sale issue | Manufacturer/distributor portals; `StockTransfer`, shipment/receipt/order assignment IDs | Internal bulk transfer uses transit and distributor locations; distributor fulfillment consumes canonical balance with cost-layer references. Manufacturer order reservations use a separate cost-layer mechanism. | New movement keys and transfer receipt hashes exist. Layer provenance is missing on some transit/damage/return movements; some legacy order paths use `Product`/`StockLog`. **PARTIALLY IMPLEMENTED.** |
| Damage/loss/stock adjustment | Distributor inventory and transfer receipt; discrepancy/movement IDs | Evidence-bearing `DAMAGE`/`LOSS` movements and discrepancy records exist in some distributor flows. Some manual product stock edits remain in `Product`/`StockLog`. | No universal inventory-to-GL write-off posting or reversal path found. **PARTIALLY IMPLEMENTED.** |
| Operating expense | Admin `POST /api/expense/add` and parallel `/api/finance/record-operating-expense`; expense/key | Main expense flow posts source, cash/AP, bill, journal and audit in one transaction. A second writer has its own source/idempotency logic. Expense category mapping includes broad fallback. | Focused Decimal/idempotency tests exist; paths need population-level reconciliation. **PARTIALLY IMPLEMENTED.** |
| Marketing CPA | Marketing benefit redemption; redemption/card event ID | Verified redemption accrues CPA expense/AP bill; confirmed payout clears the bill and cash. A legacy `MarketingPartnerSettlement` still exists separately. | Redemption/payout keys and maker-checker exist. Full control reconciliation, historical rates/legacy settlements and withholding treatment are not established. **PARTIALLY IMPLEMENTED.** |
| Delivery / NCM COD and fees | Delivery reconciliation and NCM batch; batch/order/variance IDs | COD documents and carrier-fee accrual/remittance/variance services exist. Gross COD and carrier payable are represented separately in newer flows; legacy settlement helpers also exist. | Source-scoped tests/reconciliations exist. External bank/settlement evidence is not present in code and full 1170/2180/2185 control coverage is not demonstrated. **PARTIALLY IMPLEMENTED.** |
| Treasury, cash, bank, wallet and transfers | Admin Treasury; `FinancialAccount`, `CashTransaction`, source/idempotency key | Mapped cash/bank/wallet movements and selected direct entries post journal and Treasury changes transactionally. Account 1180 is used for wallet and gateway clearing; no provider statement importer was found. | Reconciliation compares Treasury to GL, not bank statements/cash counts/provider balances. **PARTIALLY IMPLEMENTED.** |
| Loans, assets, depreciation | Admin finance; liability/repayment and fixed-asset/batch IDs | Dedicated loan, asset acquisition/depreciation, and write-off flows exist. Some are approval/idempotency controlled; sale proceeds are disabled pending tax-aware treatment. | Mocked/service tests exist. Float/Number paths and incomplete external/source schedules remain. **PARTIALLY IMPLEMENTED.** |
| Owner capital, drawings and distribution | Admin share/equity/Treasury; share transaction, liability, drawing identity | Share issuance, buyback, peer transfer and drawings have separate semantics. Profit distribution remains estimate-only in the inspected calculation path; helper presence is not a live workflow. | Keying/approval exists in selected flows. Owner-specific subledger, float precision and current legal/entity facts are unresolved. **PARTIALLY IMPLEMENTED.** |
| Journal correction and reversal | Admin accounting approval/reversal; original journal ID and correction request | Posted journals are not edited through ordinary correction; source-backed correction uses originating service. Manual journal reversal is approval mediated; selected settlement correction paths update linked cash/AP and post corrections. | Reversal scope is not universal; closed-period and source-type exceptions require explicit review. **PARTIALLY IMPLEMENTED.** |

## 3. Coverage and evidence limitations

- The event entry points above were located through static source/schema review. This is not a measured list of production traffic, configured webhooks, manual procedures, or actual records.
- Existing tests are enumerated in the domain specifications; **R14 did not run them**. Unit/service tests do not prove transaction persistence, concurrency, rollback, migration compatibility, or source-to-journal reconciliation.
- No external accounting platform, government integration, or third-party accounting dependency is proposed. Existing NCM delivery operations remain an existing business boundary, not a new R14 integration proposal.
- R14 changes no business behavior, financial balance, schema, tax rule, account mapping, or rounding policy.
- The prior architecture documents [`00-current-architecture.md`](./00-current-architecture.md) and [`01-accounting-dependency-map.md`](./01-accounting-dependency-map.md) are historical snapshots and contain findings superseded by newer code. Use this R14 inventory together with current source, not as evidence of persisted correctness.

## 4. Related specifications

- [Accounting event and reporting matrix](./10-r14-accounting-event-matrix.md)
- [Sales lifecycle](./11-r14-sales-lifecycle.md)
- [Returns and exchanges](./12-r14-returns-exchanges.md)
- [Payables and receivables](./13-r14-ap-ar-lifecycle.md)
- [Inventory and COGS](./14-r14-inventory-cogs.md)
- [Accounting invariants and test matrix](./15-r14-invariants-test-matrix.md)
