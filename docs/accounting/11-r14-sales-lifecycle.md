# R14 — Sales and Customer-Payment Lifecycle

**Review date:** 2026-11-16

**Status:** **PARTIAL** — route and service behavior mapped statically; no database or provider evidence was inspected.

## 1. Policy boundary

- **CONFIRMED EXISTING POLICY:** Existing owner-confirmed accounting design says the company is seller/collector, customer prices are VAT-inclusive, and sales revenue/output tax are recognized at delivery, not merely because checkout created an order. Manufacturer-supplied stock is treated as consigned until the applicable sale/delivery event. See [`04-target-accounting-domain-model.md`](./04-target-accounting-domain-model.md).
- **IMPLEMENTED:** Current order path creates business records and the delivered-sale accounting path is keyed through an accounting outbox. This is not proof every sale reaches the posted ledger.
- **NEEDS BUSINESS DECISION:** The complete customer-payment lifecycle is not represented by a canonical tender/payment model. The intended treatment of funds received before fulfillment, mixed/partial tender, provider fees, failed payment, chargebacks and customer advances needs explicit internal rules before implementation.
- **PROPOSED INTERNAL POLICY:** Keep order, delivery, payment/receipt, revenue recognition, inventory issue, return, refund and exchange as linked but distinct event types. Every event must have an immutable source identity and cutoff. Payment is not revenue; an order-paid Boolean is not settlement evidence.

## 2. Current sales entry and lifecycle

| Stage | Current entry/source | Observed behavior | Accounting implications and gaps |
|---|---|---|---|
| Storefront checkout | `frontend/src/pages/PlaceOrder.jsx`; `POST /api/order/place`; `Order` and `checkoutGroupId` | UI submits selected items/address/total. Backend recalculates product prices and delivery fee; creates order or split orders in a transaction; snapshots item prices, discounts and shipping; split orders share a checkout group and delivery fee is assigned to the first split order. The storefront path is COD and initially `payment=false`. | No general authorization/capture/provider webhook or multiple-tender record found. A displayed checkout total is not an authoritative accounting amount. Checkout can create the source order before revenue recognition. |
| Admin order | `POST /api/order/admin-create`; `Order.id` | Admin path accepts tender/payment Boolean, manual discount and optional delivery fee. It is an order-entry operation, not evidence of provider authorization/capture. | Payment Boolean needs separate receipt evidence; Admin and customer paths have different inputs and replay behavior. |
| Delivery handoff/status | NCM routes and `deliveryService.applyNcmStatus`; `DeliveryOrder`, `DeliveryEvent`, `Order.id` | NCM status processing advances delivery/order state. Delivery confirmation enqueues `DELIVERY_SALE` accounting; a worker retries failed outbox events. | Delivery recognition is the established trigger. Outbox state is a durable retry boundary, but source/event/journal completeness has not been persisted-validated. |
| Delivered sale | `accountingPostingEngine.postDeliveredOrderAccounting` | Posts receivable/tender, product revenue, output tax, delivery revenue and relevant manufacturer cost/payable effects. Distributor fulfillment consumes canonical inventory; manufacturer fulfillment still has cost-layer/legacy stock differences (see [inventory specification](./14-r14-inventory-cogs.md)). | For COD, posting a COD receivable at delivery is not proof that cash reached Treasury. The status path also sets `Order.payment=true`, including COD, creating a semantic mismatch. |
| Customer receipt helper | `orderPaymentAccountingService.recordDeliveredOrderCashReceipt`; controller wrapper `cashReceived` | Helper requires delivered order, stable key, replay checks and a serializable transaction; it updates paid state and posts customer-payment journal. | The `cashReceived` wrapper was not mounted in `orderRoute.js` in the reviewed route set. A `CashTransaction` link was not found in this helper. Verify route and receipt linkage before relying on it. |
| AR collection | `POST /api/financial/collect-receivable` and separate collection paths | Treasury collection service updates AR, Treasury, cash transaction and journal in a transaction; a separate controller collection path supports discount/fine adjustments. | Semantics and idempotency differ; generic/manual AR may not map to a typed customer/invoice. See [AP/AR specification](./13-r14-ap-ar-lifecycle.md). |
| Cancellation | `orderCancellationService.cancelCustomerOrder` | Customer/Admin cancellation is limited to before NCM handoff and releases inventory reservations/assignments. Admin cancellation requires unpaid; customer wrapper does not. | Cancellation does not post payment refund or journal reversal. Paid-order customer cancellation is a **P1 control gap** until the policy and compensation flow are enforced. |
| Return/refund | Customer RMA and refund workflow | Separate approval, receipt, inspection, return accounting and refund settlement steps. | See [returns/exchanges specification](./12-r14-returns-exchanges.md); do not conflate delivered sale with later return or refund. |

Primary source locations: `backend/routes/orderRoute.js`, `backend/controllers/orderController.js`, `backend/services/deliveryService.js`, `backend/services/accountingOutboxService.js`, `backend/services/accountingPostingEngine.js`, `backend/services/orderPaymentAccountingService.js`, `backend/services/orderCancellationService.js`, and `backend/prisma/schema.prisma` (`Order`, delivery and outbox models).

## 3. Required accounting sequence

The sequence below distinguishes existing policy from a complete implementation contract. Items marked proposed must not be silently treated as approved accounting policy.

1. **Order snapshot — IMPLEMENTED IN PART.** Save server-calculated product/quantity/discount/shipping and stable order/split-group references. Do not book revenue or COGS solely from order creation.
2. **Tender authorization/capture — NOT FOUND as a general workflow.** If the business later accepts prepaid or mixed tender, record each authorization, capture, failure, fee, refund and settlement against an immutable payment identity. Do not use the Boolean `Order.payment` as a substitute.
3. **Pre-delivery funds — PROPOSED INTERNAL POLICY / NEEDS BUSINESS DECISION.** Hold an actual pre-delivery receipt as customer funds/advance liability until earned or refunded; define application and cutoff before enabling that flow.
4. **Delivery and revenue/tax — CONFIRMED EXISTING POLICY.** At the supported delivery/tax point, post once from the order and accepted commercial snapshots. Retried delivery/outbox processing must return the original result, not duplicate revenue or tax.
5. **Tender classification — PARTIAL.** Record gross customer consideration as receivable or verified receipt/clearing based on the actual tender. Keep COD due from carrier/distributor separate from company cash until evidence of remittance exists.
6. **Inventory and cost — PARTIAL.** For company-owned inventory, issue actual fulfilled quantities at supported cost-layer valuation. For documented manufacturer consignment, recognize the agreed approved cost/payable at delivery per existing policy. Do not substitute current catalog cost for missing source snapshots.
7. **Post-delivery adjustments — PARTIAL.** Return, refund, exchange and sales-invoice adjustment must reference original sale lines and record separate compensating events. Do not rewrite an original posted journal.
8. **Reporting — PARTIAL.** Sales analytics, financial statements, receivables, COD and cash reports must disclose their event date/cutoff and population. A reporting-period mismatch remains visible; do not silently shift the original sale to a refund date.

## 4. Sales scenarios and expected behavior

| Scenario | Internal rule to enforce | Current status |
|---|---|---|
| Order placed, not delivered | No earned revenue/COGS merely from order existence; reserve stock only through the appropriate fulfillment workflow. | Delivery recognition path exists; prior/legacy poster paths and all channels need call-site coverage. |
| Prepaid before delivery | Receipt is not automatically earned revenue; hold customer advance or other approved liability, apply once at recognition or refund. | General provider/capture and advance subledger not found. **NEEDS BUSINESS DECISION / NOT IMPLEMENTED.** |
| Delivered COD | Record sale/receivable and tax at delivery; retain COD due from carrier/distributor until actual remittance. | Sale outbox and COD source paths exist, but `Order.payment=true` is set on delivery and can be mistaken for cash. **PARTIAL.** |
| Partial or multiple tender | Record tender lines with source references and ensure sum cannot exceed eligible receivable. | No canonical multiple-payment entity found. **NOT FOUND.** |
| Discount / promotion | Snapshot eligibility, line allocation and taxable base; refunds use original allocated discount, not current promotion configuration. | Checkout snapshots discounts; end-to-end refund allocation and tax treatment need regression coverage. **PARTIAL.** |
| Delivery charge | Keep charge distinct from product consideration and actual carrier cost; apply documented VAT treatment and recognition trigger. | Delivered sale can record delivery revenue; carrier fee has separate accrual/remittance flows. Reconcile at same cutoff. **PARTIAL.** |
| Pre-handoff cancellation | Release reservation; if no financial effect posted, no GL entry. If money was received, separately refund/credit and reverse only eligible effects. | Reservation cancellation exists; paid-customer guard/refund is absent. **P1.** |
| Failed delivery / RTO | Do not recognize a new delivered sale for a failed delivery; reverse or adjust only if a prior delivery posting exists and goods/cash outcomes are evidenced. | NCM delivery and return states exist. Full prior-sale reversal/finality policy requires testable event linkage. **PARTIAL.** |
| Full/partial return | Cap quantity and refund to original eligible value net of prior returns; actual inspection controls restockability and COGS reversal. | Workflow exists; see RMA specification. **PARTIAL.** |
| Late return / adjustment | Preserve original sale period and record the return adjustment in its proper approved period with original-sale reference. | Analytics and posted GL can use different date fields. Period/cutoff policy must be explicit. |

## 5. Sales-source and reporting invariants

- One `Order`/sale source identity produces at most one delivered-sale accounting event, with stable idempotency across webhook retry and reconciliation.
- Split orders retain common checkout-group identity; allocated delivery fee and discounts must sum exactly to the original checkout snapshot.
- A delivered/COD Boolean must never, by itself, reduce the COD receivable or increase reported cash.
- Customer receipts cannot exceed the eligible open receivable; excess must remain explicitly unallocated or be refunded under an approved process.
- Sales revenue, tax, inventory issue/COGS, receipt, refund and exchange have distinct IDs and links.
- A return or cancellation cannot reverse more than the original eligible quantity, value, discount or tax.
- Report cutoff metadata identifies whether the source date is order, delivery, tax point, journal, payment, return request, inspection, refund settlement or bank receipt.
- Posted sale, receipt and return journal lines are immutable; correction is a linked event.

Test references (present, not run in R14): `orderPaymentAccountingService.test.js`, `accountingOperationalPosters.test.js`, `deliveryAccountingOutboxIntegration.test.js` (database-dependent portions not run), `productSalesAnalytics.test.js`, `orderExchangePolicy.test.js`, and return/refund tests listed in [returns and exchanges](./12-r14-returns-exchanges.md). These do not prove persisted provider settlement or complete source-to-journal reconciliation.

## 6. Open decisions and risks

**P1**

- Customer cancellation can complete for a paid order without its refund/reversal workflow.
- Order payment state is not a payment ledger; delivered COD can show `payment=true` while the accounting event creates a COD receivable. The order receipt helper is not exposed by the inspected route.
- There is no general provider authorization/capture, failed-capture, split tender, chargeback, or payment-fee source model.

**P2**

- Checkout, Admin order, delivery, cash receipt and AR collection have different entry/replay semantics.
- Sales analytics aggregates return item snapshots at `returnDate`; the completed/approved amount may differ, and a later refund can be attributed to an earlier request period.
- Exchange differences and delivery fees are not consistently reflected in sales/return analytics.
- No complete end-to-end reversal exists for a completed exchange/return with inventory, cash, invoice and journal effects.

**NEEDS BUSINESS DECISION**

- Whether COD delivery should continue setting `Order.payment=true`; it should not be used as settlement evidence.
- Prepaid receipt/advance treatment; multiple tender and provider fee policy.
- Return of original delivery charge, return-fee eligibility, refund method/funder and late-period cutoffs.
- Exchange cancellation, no-delivery, lower-value credit, price-difference cutoff and customer advance use.

No R14 code change implements these rules.

## 7. P4.2-R15 execution note (2026-11-16)

**Status: PARTIAL.** This increment corrected two status/evidence defects and the NCM batch receipt calculation/report path. It did not establish a canonical payment/refund ledger or complete the sales-to-journal/report reconciliation.

### Entry points and observed accounting effects

| Entry point | Source/event and posting | R15 result and remaining limitation |
|---|---|---|
| Storefront checkout | `frontend/src/pages/PlaceOrder.jsx` → `POST /api/order/place` → order source; COD orders are created unpaid. | No general payment-provider authorization/capture or partial-tender source was found. Order/source totals remain Float-backed. |
| Admin direct order | `admin/src/pages/CreateOrder.jsx` → `POST /api/order/admin-create` → `createAdminDirectOrderWithStock`. | R16 follow-up rejects `payment: true` before writes; unpaid direct orders no longer infer a receipt from the Admin Boolean. No source-linked receipt endpoint, linked `CashTransaction`, or Treasury selection exists. |
| Manufacturer/distributor direct order | Direct-order controllers create walk-in or phone orders; delivered posting uses `postDeliveredOrderAccounting`. | R16 follow-up rejects `isPaid: true` and status `payment: true`; delivery/status changes no longer claim receipt. Unpaid direct sales use customer receivables instead of NCM COD/cash/bank. Actual receipt workflow, Decimal source migration, and reversal remain unimplemented. |
| NCM delivery | `deliveryService.applyNcmStatus` updates delivery/order status and enqueues the existing `DELIVERY_SALE:<orderId>` accounting event. | Removed delivery/return-status mutations of `Order.payment`. Delivered status still posts sale/receivable through the existing outbox; it no longer claims company receipt. The sale poster and its idempotency key were not changed. |
| Distributor self-delivery | `distributorSelfDeliveryService.updateSelfDeliveryStatus` writes a keyed `DistributorCashEvent` for full COD. OTP-enabled collection is verified; when OTP is disabled the distributor declaration is `PENDING_VERIFICATION`. | `Order.payment` is now set true only for the OTP-verified collection; pending declaration no longer marks the order paid. This remains full-amount only: partial/failure amounts and independent evidence review are not modeled here. |
| NCM remittance | `confirmNcmSettlementBatch` creates the remittance batch, cash transaction, journal and receivable/fee allocations under the existing batch key. | An explicit decimal-string `actualNetDeposit` is required; the expected net is no longer silently substituted. Candidate totals, batch calculations, treasury increments and settlement-summary outputs use the shared Decimal helper and decimal strings. Gross COD in non-reversed batches is separately reported as `codSettledGross`; `codOpenExpected` reports currently open expected amounts. Legacy `codReceived`/`codToReceive` fields retain their per-delivery `codCollected` semantics and are not bank evidence. |
| Order cancellation | Customer and Admin routes call `orderCancellationService` in a serializable transaction. | Before mutation, cancellation now rejects paid orders or orders with order-linked journal, accounting document, cash transaction, or distributor cash event. It still does not issue a refund or reverse an existing journal; paid/financially active orders require the existing approved refund workflow. |
| Returns/refunds | Customer RMA and distributor refund paths remain separate from pre-handoff order cancellation. | R15 did not change refund writers, payout settlement, return journals, or inventory handling; see [returns and exchanges](./12-r14-returns-exchanges.md). |

### Exact changes, precision and compatibility

- `backend/services/deliveryService.js`: delivery and return-status transitions no longer set/reset `Order.payment`.
- `backend/services/distributorSelfDeliveryService.js`: only verified OTP collection sets `Order.payment=true`; the existing unverified declaration stays pending.
- `backend/services/orderCancellationService.js`: cancellation checks existing order-linked financial records before any state or inventory mutation.
- `backend/services/ncmSettlementService.js` and `backend/controllers/deliveryController.js`: NCM candidate, batch, and dashboard arithmetic use shared Decimal helpers; API money values are decimal strings. `actualNetDeposit` must be supplied as a decimal string with at most two places. `codSettledGross` and `codOpenExpected` are additive; legacy `codReceived`/`codToReceive` retain their per-delivery field semantics and are not independently bank-verified cash.
- Admin's NCM settlement manager and delivery monitor use decimal-string arithmetic/formatting and label batch gross COD separately from delivery status. Customer-facing/Admin customer detail labels describe payment as recorded/not recorded rather than inferring carrier receipt.
- The `Order` and `DeliveryFinancialSettlement` monetary source fields remain Float-backed. `String(Float)` allows Decimal arithmetic on the current stored representation but cannot recover precision already lost. Other direct-order and return/refund paths still contain Number conversions and were not migrated.
- No sale posting, account mapping, tax treatment, refund posting, or journal reversal policy was changed.

### Evidence and remaining work

Database-free mocked/service tests cover NCM fractional aggregation, HALF_EVEN boundary display, explicit actual deposit, changed-payload replay rejection, NCM return-status non-mutation of payment, distributor pending collection, and cancellation rejection before mutation. These are **REPORT/SERVICE-CALCULATION TESTS**, not persisted source-to-journal or bank reconciliation.

No database was connected to, inspected, or modified. No migration, seed, provider integration, historical conversion, or external statement matching was run. Persisted transaction/replay/rollback, source-to-subledger, source-to-journal, and external settlement validation remain **BLOCKED BY DATABASE VALIDATION**. Partial/multiple payments, partial/failed COD collection, direct-order receipt evidence, pre-delivery customer advances, cancellation refunds, complete refund caps/retries, and complete sales/cash/refund reporting remain **NOT IMPLEMENTED**, **NEEDS BUSINESS DECISION**, or **NOT TESTED**. R15 is **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **NOT STARTED**.

## 8. P4.2-R16 receipt lifecycle increment (2026-11-16)

**Status: PARTIAL.** R16 maps checkout, Admin/manufacturer/distributor direct-order, distributor self-delivery, NCM, remittance, payment-webhook, accounting-posting, and report entry points. The detailed lifecycle specification is in [16-r16-receipt-lifecycle.md](./16-r16-receipt-lifecycle.md).

- `distributorDeliveryOtpService.formatCollectionAmount` and OTP amount comparison now use the shared Decimal helper and NPR HALF_EVEN quantization. This operates on the string representation of Float-backed `Order.amount` and `deliveryFee`; it cannot restore lost source precision.
- `distributorSelfDeliveryService.updateSelfDeliveryStatus` now requires an authenticated actor before creating a COD collection event. OTP-verified full collections remain `VERIFIED`; the SMS-disabled declaration remains pending and does not set `Order.payment`.
- `orderController.buildOrderListItem` no longer derives a paid response from delivered self-delivery COD status; payment output reflects the stored payment flag only.
- The `submitDistributorRemittance` helper requires actor attribution and cannot exceed both open COD receivable and verified, unremitted `CUSTOMER_COLLECTION` amounts. No production caller or routed submission endpoint was found. The routed Admin-created `COMPANY_COLLECTS` settlement-request/evidence/review flow is separate and does not apply this cap. Distributor cash-position fields distinguish verified collections, remitted-or-pending amount, derived cash held, and the remittable cap as decimal strings; the derived cash-held amount is not a custody subledger or physical cash verification.
- Admin, manufacturer, and distributor direct-order routes now reject a true Boolean payment declaration until a source-linked receipt is available; portal forms no longer expose a paid toggle. Unpaid direct manufacturer/distributor sales post to customer receivables instead of NCM COD or company cash. The actual-receipt record, Treasury/account evidence, allocation, reversal, and Decimal conversion of Float-backed order amounts remain **NEEDS BUSINESS DECISION / NOT IMPLEMENTED**. NCM delivery still lacks trusted per-delivery collection evidence; NCM batch remittance remains separate from collection and external bank reconciliation.
- Existing NCM report names retain their legacy meanings: `codReceived` is the Float-backed `codCollected` field total, and `codToReceive` is the expected-minus-that-field calculation. `codSettledGross` is batch gross COD, while `codOpenExpected` is expected COD in open settlement rows. None is independently verified cash.

From `backend/`, the four focused database-free test files passed **43/43**: `distributorDeliveryOtp.test.js`, `distributorCashSettlement.test.js`, `distributorSelfDeliveryAndFinance.test.js`, and `orderListProjection.test.js`. The subsequent R16-plus-adjacent suite passed **82/82** with mocked clients/synthetic data, including delivery-accounting outbox, NCM settlement, and order-payment accounting tests. These tests cover the remittance helper only, not a production submission route. No schema, migration, seed, database, external provider, or historical data was accessed. Persisted transaction/replay/rollback/concurrency, source-to-journal and external settlement checks remain **BLOCKED BY DATABASE VALIDATION**.

R16 does not implement partial/failed/multiple COD collection, collection reversal, direct-order receipt ledger, provider capture/webhooks, collector-custody accounting, or broad receipt exports. **R16: PARTIAL. R8: PARTIAL. P4.2 and Phase 4: INCOMPLETE. P4.3: NOT STARTED.** The next increment should first resolve tender/evidence and collector-custody account decisions, then design the canonical direct-order/partial-COD receipt event with an isolated-database validation plan.

## 9. P4.2-R22 checkout and delivered-sale Decimal increment (2026-11-16)

**Status: PARTIAL.** This increment hardened the delivered-sale accounting poster and recorded a bounded checkout/source-to-report trace. It did not convert checkout calculations or Float-backed schema fields.

### Production call graph and source-to-journal trace

| Stage | Production path and effect |
|---|---|
| Catalog pricing | `productController.addProduct` / `updateProduct` validate and persist `Product.price`, `Product.discount`, and `Product.costPrice` as Number values into Float fields. |
| Storefront checkout | `frontend` checkout → `POST /api/order/place` (`orderRoute.js` → `orderController.placeOrder`). The backend reads current product/location/bundle prices, applies product and reward discounts, shipping, split allocation and existing nearest-NPR-5 total rounding, then persists item snapshots and Float `Order.amount`/`deliveryFee`. Storefront orders are COD and `payment=false`; order creation does not post revenue. |
| Direct orders | Manufacturer and distributor direct-order controllers calculate item and order totals using Number, persist Float totals and item snapshots, and keep `payment=false`. A completed walk-in can be a delivery event, but its unpaid consideration remains a customer receivable. |
| Delivery evidence | NCM transition in `deliveryService.applyNcmStatus` or distributor self-delivery records the supported delivery transition and enqueues the existing `DELIVERY_SALE:{orderId}` snapshot. This is the revenue-recognition trigger; order existence or payment status alone is not. |
| Accounting outbox | `enqueueDeliveredSaleAccounting` stores an immutable hashed snapshot; `processDeliveryAccountingOutbox` calls `postDeliveredOrderAccounting` with stable source/journal identity. Invalid permanent source conditions now enter `BLOCKED`, not a blind retry loop. |
| Posting/subledger | Delivered-sale poster uses shared Decimal functions and NPR HALF_EVEN boundaries for accepted order gross, delivery charge, VAT and aggregated COGS. It rejects nonpositive/invalid amounts and quantities, negative COGS, and production/legacy cost quantities that do not equal fulfilled quantity. It creates the sales invoice, appropriate customer or COD receivable, and manufacturer payable documents in the posting transaction. |
| Receipt and reports | Receipts still flow through `recordCustomerReceipt`; receipt reversal through `reverseCustomerReceipt` and independent correction approval; reconciliation remains read-only. Selected order/customer/paper-bill/discount analytics still use Number or raw Float sources; the manufacturer summary has Decimal helper use for its traced direct-order path. No full report/export/portal reconciliation is demonstrated. |

### R22 behavior and evidence

- Non-COD sales post to customer receivables instead of bank based only on payment method. A `payment=true` assertion without a source-linked receipt is rejected and blocked for review; a direct self-fulfilled sale cannot become cash merely from that Boolean. COD delivery remains a receivable and does not imply carrier remittance.
- Delivered-sale COGS multiplies unit cost by Decimal quantity without per-line NPR rounding, aggregates before quantization, and checks allocation quantity against the accepted order quantity. Existing outbox/journal idempotency remains in place.
- The legacy `postSalesOrderAccounting` helper now uses shared Decimal calculations, but no production caller was found. It is not treated as an alternate production route.
- `Order.amount`, `Order.deliveryFee`, `Order.loyaltyDiscount`, `Product.price`, and `Product.costPrice` remain Float-backed. `Order.items` contains Number-valued JSON snapshots. `String(Float)` compatibility makes current stored values parseable as Decimal but cannot restore precision already lost.
- Return/refund, cancellation, COD remittance, checkout pricing, direct-order pricing, stock movement, and all report/API serialization paths are not fully Decimal-converted or reconciled. The current nearest-NPR-5 order-total rule was preserved because policy approval/effective date was not established.

From `backend/`, `node --test tests\accountingOperationalPosters.test.js tests\accountingOutbox.test.js` passed **86/86**. New in-memory poster tests cover HALF_EVEN amount ties, fractional quantity, aggregate-before-round COGS, negative cost rejection, allocation mismatch, unlinked paid status rejection, receivable treatment and outbox permanent blocking. `node --check` passed for both changed services and `git diff --check` passed (with pre-existing line-ending warnings in unrelated files). These tests use an in-memory client; they do not prove persisted transaction atomicity, rollback, concurrency, source-to-inventory movement, or journal/subledger agreement.

No database, provider, migration, seed, or historical data was accessed. R18/R19 remain unapplied. **R22: PARTIAL. R8: PARTIAL. P4.2: INCOMPLETE. P4.3: IN PROGRESS, INCOMPLETE (no P4.3 work was added in R22). Phase 4: INCOMPLETE.** The highest-priority next task is a compatible Decimal checkout calculation/storage/API migration plan that preserves historical snapshots and resolves the existing nearest-NPR-5 total policy before implementation.

## 10. P4.2-R23 checkout pricing and accepted-order snapshot (2026-11-16)

**Status: PARTIAL.** Checkout and direct-order calculation now use shared Decimal logic and persist versioned exact values in the existing JSON snapshot field. This is not a Float-column migration and is not persisted-database validation.

### Source → accepted amount → accounting → API/report

| Path | R23 behavior and trace |
|---|---|
| Storefront | `frontend/src/pages/PlaceOrder.jsx` → `POST /api/order/place` (`backend/routes/orderRoute.js`) → `orderController.placeOrder`. Server resolves product/location/bundle pricing, discounts, reward choice, shipping, split allocation and final payable using `checkoutPricingService.js` and shared Decimal helpers. It persists Float compatibility mirrors, historical-compatible item JSON, and a v2 `locationPricingSnapshot.pricingSnapshot`. |
| Admin direct order | `admin/src/pages/CreateOrder.jsx` → `orderController` Admin creation → `adminDirectOrderService.createAdminDirectOrderWithStock`. Discount and custom shipping inputs are submitted as strings and the backend persists the same snapshot/mirror compatibility pattern. |
| Manufacturer/distributor direct order | Routes invoke `manufacturerDirectOrderController.createManufacturerDirectOrder` or `distributorDirectOrderController.createDistributorDirectOrder`. Both use Decimal line/order calculations and write the v2 snapshot with legacy Float mirrors. |
| Delivery/accounting | Delivery transitions remain distinct from receipt. The accepted snapshot is copied to the existing delivery accounting outbox; `postDeliveredOrderAccounting` reads that accepted snapshot, not today's catalog price. Existing receivable/receipt/COD treatment, journals, COGS allocation and outbox idempotency remain. `recordCustomerReceipt`, `reverseCustomerReceipt`, independent correction approval, and read-only reconciliation were not replaced. |
| Readers/reports | `orderController` projection keeps legacy numeric fields and adds decimal-string fields. Snapshot-first readers include delivery/accounting, receipt amount validation, paper bills, selected customer/manufacturer/financial views, and loyalty/gift/marketing-card spend eligibility. The complete portal/export/report consumer set is not inventoried. |

### Snapshot, rounding, migration, and validation

New `pricingSnapshot` version 2 records `currency: "NPR"`, pricing-rule version, source, timestamp, item/product and variant identifiers, decimal-string unit prices, quantities, line totals, discounts, and subtotal/discount/delivery/adjustment/pre-commercial/final totals. Split allocation is deterministic with a residual assigned so child totals reconcile to the source total. Existing unrelated keys in `locationPricingSnapshot` are preserved. The reader accepts version 2 only; historical records are neither recalculated nor rewritten and use an explicit legacy fallback.

The nearest-NPR-5 rule is applied only to the final checkout payable, after whole-rupee rounding; its digit behavior remains 0–3 down, 4–7 to 5, and 8–9 up to the next ten. It is a commercial rule distinct from NPR two-decimal HALF_EVEN accounting quantization. Existing UI text and `orderAmount.test.js` establish behavior, not effective date or business approval. R23 preserves and snapshots this rule and does not apply nearest-5 separately to line, discount, or shipping components.

No Prisma model or migration was changed. Current schema precision remains `Product.price Float`, `Product.costPrice Float @default(0)`, `Order.amount Float`, `Order.deliveryFee Float @default(0)`, and `Order.loyaltyDiscount Float?`; `Order.items` and `Order.locationPricingSnapshot` are JSON. Decimal→Number conversion occurs only at explicit legacy-mirror writes. This conversion is not exact persistence. Legacy Float and JSON Number values cannot recover previously lost precision; API consumers expecting numeric fields remain supported via additive exact fields.

Focused pricing, projection, loyalty, gift, marketing-card, accounting poster and outbox tests use production functions with mocked/in-memory dependencies. They do not prove persisted atomicity, route/database integration, rollback, concurrency, deployed-column availability, historical conversion, or source-to-journal reconciliation. No database, migration, seed, provider, or production credential was accessed; R18/R19 remain unapplied.

Remaining gaps include the full portal and report/export/API reader inventory; safe staged Float-to-Decimal storage and historical comparison; direct evidence that every accepted component agrees across all reports; and unresolved returns/refunds, inventory movement/valuation, COD remittance and receivable settlement paths. Marketing-card selection also retains an existing fallback to any active card if no campaign matches the minimum-order filter; R23 only changed the amount comparison, not that selection policy. **R23 PARTIAL; R8 PARTIAL; P4.2 and Phase 4 INCOMPLETE; P4.3 IN PROGRESS, INCOMPLETE.** The next priority is a complete reader inventory and staged migration plan for Product/order fields, then isolated-database validation before any deployment or historical conversion.

## 11. P4.2-R24 pricing readers, provenance and storage gates (2026-11-17)

R24 expands the R23 reader trace across the known customer, Admin, manufacturer, distributor, and marketing APIs/UIs; order assignment and delivery; COD/remittance and customer receipts; cancellation/returns/exchanges/refunds; and order, discount, product-sales, finance, customer, paper-bill and operational reporting consumers. It records exact entry points and distinguishes amount, unit price, percentage, quantity, fee, and compatibility values in [18-r24-order-pricing-reader-inventory-and-migration-plan.md](./18-r24-order-pricing-reader-inventory-and-migration-plan.md). The inventory identifies remaining Number/Float consumers instead of treating additive v2 fields as universal adoption.

The current v2 snapshot does not reliably preserve original catalog price and source-separated product/location/bundle discount amounts. Proposed v3 records the accepted price path, typed source components, quantity/rate units, line/order reconciliation, split allocation residuals, commercial rounding adjustment, and provenance completeness. It must not infer missing components in v2 or historical orders. Legacy numeric API fields remain compatibility projections while exact strings are additive.

The declared Prisma schema and checked-in initial migration use Float/DOUBLE for `Order.amount`, `deliveryFee`, `loyaltyDiscount`, and product price/cost; JSON order items remain historical numeric snapshots. R24 proposes nullable Decimal shadow fields and candidate precision by semantic type, with migration-before-writer ordering, validation, dual-read/write conflict detection, cutover and rollback gates. This is design only: no schema or migration change, historical conversion, database operation, or deployed-schema verification occurred. `Product.costPrice` remains a reference cost and is not an authoritative inventory/COGS layer.

The read-only historical procedure classifies exact agreement, explainable rounding, recoverable Float representation/precision loss, missing provenance, unexplained discrepancy, and invalid/out-of-range data. It requires source linkage, raw-value preservation, deterministic thresholds, and approved exception handling; no generic tolerance or current-catalog reconstruction is permitted. R24 evidence remains static and unit-test-only; it does not establish persisted accounting reconciliation, actual deployed schema, historical accuracy, or cutover readiness.

**R24 COMPLETE FOR STATIC INVENTORY/DESIGN SCOPE ONLY. R8 PARTIAL; P4.2 INCOMPLETE; P4.3 IN PROGRESS, INCOMPLETE; Phase 4 INCOMPLETE; Phase 5 not started.** The highest-priority next task is the additive v3 provenance writer/reader and migration of the identified accounting/customer-facing snapshot consumers, preserving v2/history and legacy numeric response compatibility. Decimal storage writes remain gated on a separately authorized additive migration and independently verified isolated-database validation.

## 12. Phase 4 programme — first v3 snapshot integration increment (2026-11-17)

Verified the live code baseline before editing: `checkoutPricingService.js` created v2 snapshots and rejected all other versions; storefront, Admin direct, manufacturer direct, and distributor direct creation already used Decimal calculations and wrote v2 into the existing JSON field. `accountingOutboxService` and `postDeliveredOrderAccounting` read accepted snapshot totals through the shared parser. The schema remains Float/DOUBLE for catalog and order amount/fee/discount fields, with item and pricing snapshots in JSON. The repository's existing date helper has Kathmandu and BS conversion functionality, but this increment did not audit or normalize every financial route's date filters. R24 and the R8 register remain working inventory/design documents, not proof of complete reader coverage.

The shared service now writes and validates v3 while retaining the v2 factory/parser for historical and test fixtures. It captures catalog and accepted unit prices, quantity with unit, price-rule steps, per-line discount components, order-level typed adjustments, signed commercial-rounding adjustment, accepted timestamp, and `COMPLETE`/`PARTIAL` provenance. Every line and total must reconcile; missing/unclassified evidence remains partial rather than being reconstructed. Location price resolution now carries the selected location-rule ID. All four order-creation writers create v3; existing shared order/API, outbox, and accounting readers accept it via the common version-aware parser. Exact response projections add `legacyNumericFieldsCompatibilityOnly: true` and preserve legacy numeric fields unchanged.

This integration does not make the Float source columns exact: catalog values are labeled as Float-compatible source representations. It also does not replace legacy numeric order-item JSON, migrate storage, or complete the discount/report/portal/return/exchange/refund consumer inventory. Operational consumers which derive discount analytics or printed line amounts from legacy item JSON remain gaps.

Focused command from `backend/`: `node --test tests\checkoutPricingService.test.js tests\locationPricing.test.js tests\orderShipmentSplitting.test.js tests\orderListProjection.test.js tests\directOrderReceiptPolicy.test.js tests\accountingOperationalPosters.test.js tests\accountingOutbox.test.js tests\adminDirectOrderService.test.js` passed **123/123** mocked/in-memory tests. `node --check` passed for `checkoutPricingService.js`, `locationPricingService.js`, `orderController.js`, `manufacturerDirectOrderController.js`, and `distributorDirectOrderController.js`. Expected error logs in accounting poster/outbox tests correspond to tested rejection/retry paths; no test failed. No database, migration, seed, provider, or historical data was accessed. No schema writes were activated.

**Baseline gaps remain:** repository-wide R8 classification and non-order financial field coverage; all material v3 consumer conversions; COD collection/remittance/receipt/reversal/refund lifecycle completeness; returns/exchanges/inventory valuation and COGS reconciliation; AP/AR, treasury and settlement source-to-journal/report reconciliation; broad Kathmandu-local date and BS fiscal-boundary coverage; and persisted migration/history validation. R8 is **PARTIAL**; P4.2 is **INCOMPLETE**; P4.3 is **IN PROGRESS, INCOMPLETE**; Phase 4 is **INCOMPLETE**; Phase 5 was not started. The next bounded action is v3 consumer adoption for high-risk order/accounting/report readers and route-level mocked creation coverage, then proceed through the programme's ordered remaining domains.
