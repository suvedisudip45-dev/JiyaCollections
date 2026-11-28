# R14 — Returns, Refunds, and Exchanges

**Review date:** 2026-11-16

**Status:** **PARTIAL** — current workflow paths were mapped statically. No persisted return, inventory, payment-provider, or journal data was examined.

## 1. Policy boundary and source identities

- **CONFIRMED EXISTING POLICY:** A return request is not a completed return, refund, or inventory receipt. Inspection determines restockable, damaged, missing, or otherwise ineligible units. Existing target accounting separates operational receipt, refund obligation/payment, inventory, and sales/tax effects.
- **IMPLEMENTED:** Customer return requests/reviews, receipt and inspection stages, distributor return routes, platform refund payables, evidence-based distributor refunds, and exchange price-difference paths exist.
- **PARTIALLY IMPLEMENTED:** The paths vary by customer/distributor/platform route; some inventory outcomes remain in legacy `Product`/`StockLog` rather than canonical ledger movements. A universal reversal and reporting/reconciliation population was not found.
- **PROPOSED INTERNAL POLICY:** Every adjustment retains the original sale, order line, return/exchange request, physical inspection, refund/credit, inventory movement, and journal references. An original posted sale must not be edited or reversed more than once.
- **NEEDS BUSINESS DECISION:** Return of original shipping, fee exceptions, late-return cutoffs, distributor refund funding, lower-value exchange credit and exchange cancellation rules must be approved before normalizing behavior.

Source model names in the reviewed schema include `CustomerReturn` and `OrderExchangeRequest`; related item, event, refund, and delivery models should be followed through the current Prisma schema and owning service when implementing any single workflow change.

## 2. Return/refund lifecycle matrix

| Stage | Current behavior | Financial/inventory effect | Status / gap |
|---|---|---|---|
| Customer return request | Customer requests a return against an order/line with a request key. Eligibility and remaining returnable quantity are derived from sale/prior returns; amount snapshots use original line data. | No cash movement or stock receipt merely on request. | Request/replay checks exist. Cross-path completeness and repeat partial-return boundaries need focused validation. |
| Admin decision | Review records decision, route and allowed amount/fee data. Platform and distributor cases diverge. | Approval creates or enables a future obligation; it is not proof of receipt, refund, or inventory restoration. | **PARTIAL:** policy around return fees, delivery charges, adjustment period and refund sponsor remains unresolved. |
| Physical receipt | NCM or distributor self-delivery records a return handoff/receipt. | Establishes custody evidence only; do not make goods saleable solely from a carrier status. | **PARTIAL:** external delivery status and physical inspection are distinct, but route-specific evidence quality differs. |
| Item inspection | Received items are accepted/restockable or classified damaged/missing/ineligible. | Accepted quantities may return to stock; damaged/lost quantities require separate disposition and may need write-off. | Canonical distributor ledger/discrepancy flow exists. Some customer/manufacturer return paths update legacy stock/`StockLog`; no universal inventory-to-GL write-off was found. |
| Return accounting | Accepted return can post a sales-return/tax adjustment; cost reversal depends on accepted returned quantity and stock ownership. | Reverse eligible original consideration/tax and eligible COGS; do not reverse COGS for goods not physically accepted/restockable without a separate approved loss event. | Poster exists for selected paths. Cost/tax source linkage and all route population completeness are not persisted-proven. |
| Refund obligation | Platform route creates a customer refund payable linked to return; distributor route uses distributor evidence/review and earnings reversal behavior. | Recognize a distinct customer credit/refund obligation according to the approved route. | **PARTIAL:** distributor and platform obligations are not one fully reconciled population. |
| Refund settlement | Platform refund payable is paid through payout lifecycle; distributor refund requires supporting evidence and Admin review. | Clear the linked obligation against actual settlement account/evidence; approval alone does not clear payable. | Idempotency and audit attribution exist in selected paths. No universal refund method or complete bank/provider match. |
| Reporting | Analytics, return summaries, payout history and posted journals consume different event dates and populations. | Reconcile gross sale, return adjustment, refund obligation, actual cash refund and inventory change separately. | **PARTIAL:** request/return date, approved amount, completed refund and ledger dates may differ; exports and statements are not one canonical view. |

Primary source locations include `backend/routes/customerReturnRoute.js`, Admin return routes/controllers, customer-return and order-exchange services, `backend/services/accountingPostingEngine.js`, refund payout services, distributor evidence-review services, inventory ledger services, and `backend/prisma/schema.prisma`. Exact service and test files should be re-traced at implementation time because customer, platform and distributor workflows are not interchangeable.

## 3. Amount, quantity and cutoff rules

The following are proposed implementation invariants, not newly approved fee or tax policy:

1. Determine refundable quantity from delivered eligible quantity minus prior completed/approved return quantities, with a lock or equivalent serialization to prevent concurrent over-return.
2. Derive line value, discount allocation and applicable tax from the original sale snapshots. Do not recalculate with current catalog, promotion, or tax configuration.
3. Keep requested, approved, received, inspected, refund-obligated, refund-paid, accepted-restock, damaged, and missing quantities/amounts distinct.
4. A return cannot exceed original eligible quantity or remaining consideration after prior returns/credits.
5. Refund total must not exceed the approved return amount after documented prior payments and adjustments. An unallocated difference is an exception, not a silent rounding plug.
6. Only physical inspected and accepted units can be restored to sellable inventory. Damage/loss follows evidence-backed movement and discrepancy handling; it does not become ordinary restock.
7. Revenue/tax adjustments and refund settlement are separate events. The journal cutoff for the adjustment and the bank/cash cutoff for the refund must both remain visible.
8. Use existing accounting Decimal utilities for monetary operations and exact quantity types for units. Do not convert a Decimal amount to JavaScript `Number` to compare, allocate, cap, sort or serialize.
9. Preserve posted journals. Corrections must be linked compensating events and must restore inventory/subledger/cash only if the corresponding original effect occurred.

## 4. Exchange lifecycle

| Stage | Current implementation shape | Required control / unresolved behavior |
|---|---|---|
| Eligibility/request | Customer/Admin/Distributor exchange request records original order/item, proposed replacement, key and price snapshots; a delivered-order window is enforced by current policy code. | Do not assume request window is an accounting-period rule. Duplicate and simultaneous exchange requests must be checked against already returned/committed quantity. |
| Old item handoff/inspection | Original product must be physically received and inspected before restock/return effects. | Same accepted/damaged/missing evidence rules as returns; no stock increment based only on request approval. |
| Replacement reservation/dispatch | Replacement quantity is reserved and fulfilled through route-specific inventory/delivery workflow. | If replacement is not delivered, define reservation release and compensation without repeating original sale accounting. |
| Price difference | Service records difference and route-specific collection/credit. | Collect the customer-upward difference once; downward difference becomes an explicit customer credit/refund obligation. Define delivery-fee and tax treatment. Existing treatment is not a universal policy decision. |
| Accounting | Poster creates exchange revenue/tax/inventory effects and invoice adjustment linked to request. | Ensure old-sale reversal and replacement sale effects are not double-counted. Both legs must retain original and replacement line identity and cost basis. |
| Completion/replay | NCM attempt/status reconciliation and keyed processing exist in selected paths. | **GAP:** no universal cancellation/reversal across inventory reservation, physical return, difference receipt/credit, invoice adjustment and journal. Retry must reproduce the same completed effect, not create a second replacement or adjustment. |

**NEEDS BUSINESS DECISION:** exchange cancellation after approval, after handoff, after replacement dispatch, and after price-difference collection; exchanges with lower replacement value; original/replacement delivery fees; return-window extension; treatment of no-delivery/rejected replacement; and whether a replacement is a linked adjustment or a new sale plus credit. Until decided, do not add a generic “exchange reversal” endpoint.

## 5. Reporting and reconciliation

At one explicit cutoff, a complete return/exchange reconciliation should compare:

1. Original delivered sale lines and their allocated discount/tax.
2. Eligible requested and approved return/exchange quantities.
3. Physical receipt and inspection quantities (accepted, damaged, missing, rejected).
4. Inventory ledger movements and cost-layer quantities/cost reversals.
5. Posted sales/tax/COGS adjustment journal lines.
6. Refund/customer-credit obligation and all allocations.
7. Actual refund/price-difference receipt evidence and Treasury journal lines.
8. In-flight, failed, canceled, duplicate or unallocated cases as explicit exceptions.

An analytics total that subtracts a return snapshot from sales is not the same as a refund paid, stock accepted, or a posted return journal. Report event-date basis explicitly: order date, delivered date, return request date, approval date, physical receipt/inspection date, journal date, refund date, and bank/provider value date are distinct.

## 6. Focused test matrix for a future implementation

| Case | Expected assertion | Evidence type |
|---|---|---|
| Full return of one eligible delivered line | One capped return adjustment, correct accepted quantity/cost handling, one obligation and no duplicate effect on replay | Service/outbox test; persistence test separately required |
| Partial returns in multiple requests | Cumulative quantity/value never exceeds original eligible sale after discount and prior returns | Actual return-service business outcome |
| Concurrent last-unit requests | At most one request consumes remaining eligible quantity | Isolated transactional integration test |
| Damaged/missing item | No sellable stock increase; discrepancy/loss path and accounting disposition explicit | Inventory ledger + GL source test |
| Partial physical receipt | Refund and restock cap to independently approved/received/inspected amounts | Service and persistence tests |
| Refund approved vs paid | AP remains open until actual payout; payout idempotent and journal/cash agree | Payout lifecycle test and isolated persistence |
| Distributor-funded refund | Evidence, reviewer actor, earnings reversal and settlement are linked, replay-safe | Distributor workflow test |
| Discounted/taxed sale | Original snapshots drive refund and adjustment; no current-price/tax lookup | Accounting poster test |
| Exchange higher/lower value | Difference collected or customer credit is exact and one-time | Exchange service/poster test |
| Exchange cancellation at each stage | Only completed effects are compensated; no fabricated receipt/refund | Lifecycle tests after policy decision |
| Period boundary | Original sale and later return/refund appear in their correct cutoff reports with source linkage | Report test with Kathmandu date boundary where applicable |

These are recommended cases; R14 did not execute them. No persisted source-to-journal or bank reconciliation is claimed.

## 7. Priority findings

**P1**

- Return routes do not all use the canonical inventory ledger; some legacy stock writes can diverge from balances/cost layers.
- A complete exchange cancellation/reversal spanning stock, price difference, invoice adjustment and journal is absent.
- Refund obligation, approval, paid payout, actual cash evidence and sales analytics are distinct populations and are not universally reconciled.

**P2**

- Return reporting dates/amounts differ from approved/completed/refunded lifecycle stages.
- Delivery-fee and lower-value exchange-credit policies are unresolved.
- Supplier-style credit application reversal patterns should not be assumed to provide customer return reversal coverage.

R14 made no code, database, schema, tax, balance or refund-policy changes.

## 8. P4.2-R15 cancellation and refund boundary (2026-11-16)

**Status: PARTIAL.**

- **IMPLEMENTED:** `orderCancellationService` now checks `Order.payment` and order-linked `JournalEntry`, `AccountingDocument`, `CashTransaction`, and `DistributorCashEvent` rows inside the serializable cancellation transaction before changing order, reservation, assignment, or stock state. Customer and Admin cancellation fail with `PAID_ORDER_REFUND_REQUIRED` when payment or financial activity exists. A database-free regression confirms a customer cancellation with a sale journal is rejected before mutation.
- **NOT IMPLEMENTED:** The guard does not issue a refund, reverse a posted journal, or calculate a refundable amount. This is intentionally fail-closed: cancellation must not fabricate a refund or erase a payment. There is no general `OrderPayment`/`OrderRefund` record that can calculate actual captured funds less completed and pending refunds, especially for multiple/partial tenders.
- **IMPLEMENTED in existing separate workflows:** Customer return inspection may create a refund payable, and payout settlement pays that obligation through the payable lifecycle. Distributor refunds use a separate evidence and Admin-review workflow. These remain return/refund paths, not a pre-delivery cancellation refund API.
- **NOT TESTED / BLOCKED BY DATABASE VALIDATION:** No persisted refund allocation, payable, cash, journal, source-link, replay, or rollback test was run. No persisted source-to-journal or bank/provider reconciliation is claimed.

R15 did not change refund amounts, return eligibility, tax/discount treatment, cash execution, stock disposition, or posted journals. Full, partial, multiple, failed, retried, pending, and completed refund cases—including cumulative over-refund caps and reversal linkage—remain **NOT IMPLEMENTED / NOT TESTED** as a unified order-payment lifecycle. They require a bounded follow-up and confirmation of tender, funding, and cutoff rules; do not infer them from order cancellation or RMA completion.
