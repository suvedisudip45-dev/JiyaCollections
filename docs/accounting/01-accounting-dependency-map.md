# Accounting Discovery 01: Dependency Map

**Snapshot:** 2026-09-28  
**Status:** Source-level map; no business/runtime code changed.

## System Context

```text
Customer/admin order commands ──> Order (selling-price snapshot)
                                            │
                                            ├──> manufacturer allocation/fulfillment
                                            │       └──> manufacturer agreed cost per product
                                            │
                                            ├──> NCM delivery events ──> DeliveryOrder/Return/Settlement
                                            │
                                            └──> current async GL sale poster (order-time COGS)

Expense/treasury/asset/loan/share commands ──> finance operational tables
                 └───────────────────────────> several independent GL posters

Marketing redemptions ──> MarketingPartnerSettlement/CPA facts
                 └──────> no accounting-party/GL posting found

Operational tables + product costs + GL lines ──> multiple independent reports
```

## Cross-Domain Event Map

| Business event/source | Current owner and data | Current accounting adapter/result | Conflict or dependency |
| --- | --- | --- | --- |
| Online order created | `controllers/orderController.js`; `Order`, JSON item snapshot | Async `postSalesOrderAccounting` from order controller | Posts at order creation, before delivery/return outcome; COGS is looked up from current global `Product.costPrice`; hook failure does not roll back order |
| Admin direct order created | Same controller; `Order.orderType=ADMIN_DIRECT` | Async sales posting; may also async-post payment | Same issues; admin direct order can have different customer/fulfillment semantics |
| Selling price lock | Order item JSON contains `purchasedUnitPrice`, quantity, line total | Sales revenue poster reads `Order.amount` | Selling price snapshot exists; approved manufacturer cost snapshot does not appear in the inspected snapshot builder |
| Product cost proposal/approval | `ManufacturerInventory.proposedCostPrice`, `agreedCostPrice`, `priceStatus`; COGS controller | No posting at price approval | COGS poster later reads `Product.costPrice`; approval only sets product cost if global cost was unset, so manufacturer-level approved price is not authoritative for GL |
| Manufacturer assignment | `OrderAssignment` references one manufacturer; fulfillment status/state service | No manufacturer payable poster at assignment | Good candidate source link for per-manufacturer cost attribution, but no durable source snapshot or party subledger |
| Delivery package submitted to NCM | `DeliveryService.prepareReadyDelivery` and `submitDeliveryToNcm`; `DeliveryOrder`, attempt/event rows | No GL posting at submission | Submission is not delivery; should not recognize the requested delivered COGS/payable here |
| NCM delivered event | `applyNcmStatus`; updates `DeliveryOrder`, `Order.status=Delivered`, `payment=true`, `OrderAssignment` | No GL poster in transition | Primary candidate trigger for the user’s COGS rule; currently setting payment true does not run the customer payment poster in this flow |
| NCM return/RTO event | `applyNcmStatus`; `DeliveryReturn`, order `Returned`, settlement `RETURN_PENDING` | No GL reversal/adjustment | Distinct from customer-initiated `CustomerReturn`; treatment after prior delivered recognition requires a policy decision |
| NCM COD/fee reconciliation | `reconcileDelivery`; `DeliveryFinancialSettlement` | No journal; settlement stores expected/actual COD and delivery fees | Need NCM-party AR/AP gross balances, fee recognition and settlement policy before automating netting |
| Customer return/refund | `ReturnsController`; `CustomerReturn`, global stock mutation, cash transaction or `AccountPayable` | Async `postCustomerReturnAccounting` | Record, cash/AP update and GL are not one transaction; restocked cost is not passed to poster; repeated or concurrent requests need idempotency |
| Supplier inbound shipment | `InboundShipment`; JSON items, costs, payments and payable fields | `postInboundShipmentAccounting` exists but no live call site found | Purchase/AP/inventory/input-VAT policy and inventory ownership need confirmation |
| Supplier return | `SupplierReturn`; JSON item snapshot, refund/credit-note status | No supplier-return posting function call found | Must reverse supplier AP/AR, tax and inventory under defined rules |
| Expense create via `/api/expense` | `OperatingExpense` | `postExpenseAccounting` awaited after record write | Poster catches its own error, so API can succeed while GL is absent; VAT fields are not passed into the poster |
| Expense via `/api/finance/record-operating-expense` | `FinancialAccount`, `CashTransaction`, `AccountPayable` | Async `postDirectExpenseAccounting` | Adapter hardcodes BANK and `isPayable=false`, ignoring cash account and payable/partial-payment inputs; independent partial transaction risk |
| Expense update/delete | `OperatingExpense` | No reversal/replacement posting found | Historical GL may no longer agree with edited/deleted source rows |
| Cash/bank transfer/outflow | `FinancialAccount.currentBalance`, `CashTransaction` | Some outflows start async expense poster; internal transfers/inflows often no GL entry | Source transaction and journal are not atomic; treasury balance is another mutable source of truth |
| AP settlement | `AccountPayable` history and `FinancialAccount`/`CashTransaction` updates | Async `postSupplierPaymentAccounting` | Poster idempotency key includes `Date.now()` and is not stable across retries; no allocation record to individual bills |
| AR collection | `AccountReceivable`, treasury, cash transaction | No GL poster found in inspected collect flow | GL and subledger/cash can diverge |
| Fixed asset purchase/depreciation | `FixedAsset`, cash/AP | Async purchase/depreciation posters | Asset/cash/AP update is not atomic with journal; disposal/damage path mutates asset/cash without a demonstrated disposal journal |
| Debt/equity/share movement | `InvestorLiability`, `PartnerEquity`, `ShareTransaction`, cash records | Some loan/share functions call GL poster asynchronously | Does not cover all mutations or provide party bill/settlement subledgers; shareholder partner is not a marketing partner |
| Profit distribution | `ProfitDistribution`, AP/cash | Some flow may create payable and payment; no dedicated distribution poster was identified in the poster inventory | Verify full posting path and historical behavior before replacing |
| Marketing CPA/reward | `MarketingCampaign.cpaRate`, `MarketingPartnerSettlement`, redemption/card event | No GL/accounting posting found | Requires recognition trigger (verified redemption vs payable approval), partner identity linkage and expense/payable accounts |
| Financial statements and VAT | Finance controller queries operational tables and current costs | Not derived from GL in `/api/finance/statements` and `/api/finance/tax-report` | Two report bases can disagree; status, timing, cost and rate rules differ |

## Existing Manufacturer Cost/Commission Calculation

`getManufacturerFinancialSummary` filters orders by manufacturer and date range, reads that manufacturer’s current inventory prices, and falls back through agreed cost, proposed cost, and global product cost. It increments `totalPayable` for each order regardless of delivery/return state. It calculates a `receivable` only when status appears delivered, using sales less cost less commission, then returns `netReceivable = receivable - payable` in the order breakdown and summary. Because receivable already subtracts cost and payable is that same cost again, the displayed net subtracts COGS twice. It also applies manufacturer commission without excluding online or admin-created social orders. This is a calculated projection, not an immutable accounting subledger. It does not implement the owner-approved delivered/non-returned COGS or direct-manufacturer-only commission rules.

Owner-approved accounting treatment: only `DIRECT_MANUFACTURER` + `HUB_VISIT|PHONE_ORDER` qualifies for manufacturer commission. Its gross-profit base is discounted product revenue excluding VAT and delivery fee, less approved agreed COGS excluding recoverable input VAT. Commission and COGS accrue at delivery only if the goods are not subsequently returned. `ONLINE_STORE` and `ADMIN_DIRECT` social orders receive no manufacturer commission.

The source classifier exists: `manufacturerDirectOrderController.createDirectOrder` writes `orderType: "DIRECT_MANUFACTURER"` and `directOrderType` as `HUB_VISIT` or `PHONE_ORDER`. A hub visit is marked delivered at creation; a phone order starts as `Order Placed` and is later status-updated. Storefront orders use `ONLINE_STORE`; admin social/direct orders use `ADMIN_DIRECT`. The accounting adapter can classify source type from these persisted fields without changing business behavior, but must honor actual delivery and return transitions for phone orders. Manufacturer COGS must be snapshotted at acceptance; input VAT is claimable only when a valid manufacturer invoice exists.

The manufacturer UI presents payable, receivable, net receivable, and commission terms. These labels therefore need a policy/data contract review before they are reused as the new ledger UI.

## Existing GL Call Graph

```text
orderController.create order ──async──> postSalesOrderAccounting
orderController.cashReceived ──async──> postCustomerPaymentAccounting
admin order creation ──async──> postSalesOrderAccounting (+ optional payment poster)
returnsController.create return ──async──> postCustomerReturnAccounting
expenseController.create ──await──> postExpenseAccounting (errors logged/swallowed internally)
financialController asset/loan/share/expense/AP flows ──mostly async──> selected poster functions
deliveryService NCM delivered/return/reconcile ──X──> no accounting poster found
marketing partner redemption/settlement ──X──> no accounting poster found
```

All asynchronous posting arrows currently cross a persistence boundary: the source business record can commit and the API can report success before accounting posting has succeeded.

## Security And Authorization Boundary

Current finance/accounting routes use unified authentication plus seeded permissions such as `accounting:*`, `finance:*`, `expense:*`, and `cogs:*`. Manufacturer summary access is explicitly granted to the manufacturer role. The new accounting party/statement APIs should use this RBAC foundation rather than add a second authorization system. Accounting authorization changes are in scope; general auth/RBAC redesign is not.

## Candidate Accounting Event Boundary

The repository has a notification outbox, but no generic durable accounting outbox/event service was found. For accounting-critical transitions, the target should use an accounting-owned event/posting boundary with:

1. Stable source type, source ID/version, party ID, effective date, currency and immutable amount/cost snapshot.
2. Atomic event capture with the source transition where feasible (not a later fire-and-forget promise).
3. A unique idempotency key and durable pending/posted/failed state.
4. A central posting service that validates period, party/account mappings, precision, debits/credits, and writes journals/subledgers/audit atomically.
5. Reconciliation/retry operations that never create a second posting.

Whether the delivery transition writes the journal synchronously in its transaction or emits a durable event for a worker is a design decision for the target architecture. It must not depend on an in-memory background queue.