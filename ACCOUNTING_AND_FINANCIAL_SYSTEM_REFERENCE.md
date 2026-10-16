# Accounting and Financial System Reference

This document describes the accounting and finance behavior currently present in this repository. It is an implementation reference for future work, not an assertion that every screen or workflow is a complete accounting subledger or a compliant set of financial statements.

**Important:** The system has a double-entry General Ledger (GL), but it also has older operational finance tables and dashboard calculations that do not always reconcile to the GL. Where those paths differ, this document calls that out rather than treating them as one source of truth. Verify the behavior against the cited code before changing it.

## 1. System map and records

### General Ledger

`backend/services/accountingPostingEngine.js` is the central GL posting layer. It normalizes and validates balanced journal lines, checks the fiscal year/accounting period, applies idempotency keys, records an accounting event and posted journal, and updates GL account balances in a transaction. Posting helpers cover delivered sales, returns, supplier/manufacturer obligations, expenses, asset depreciation, loans, share activity, and other flows.

The accounting APIs in `backend/routes/accountingRoute.js` expose the chart of accounts, journal entries, manual journals and reversals, general ledger, trial balance, GL-derived statements, subledger reconciliation, and fiscal-period controls. These endpoints are permission-protected.

### Operational finance data

The project also stores operational financial records in models such as `FinancialAccount`, `CashTransaction`, `OperatingExpense`, `DirectIncome`, `AccountPayable`, `AccountReceivable`, `DistributorSettlementRequest`, and `ManufacturerSettlementRequest`. These records support cash operations, requests and portal summaries. Some workflows update these records and post the GL separately or asynchronously; some do not visibly post the GL at all.

The broad finance routes are in `backend/routes/financialRoute.js`; the legacy expense/income routes are in `backend/routes/expenseRoute.js`. Treat an operational cash record, party balance, portal statement, dashboard calculation, and GL balance as different representations unless a specific flow below says they are linked.

## 2. Chart of accounts

The standard accounts and mapping keys are declared in `backend/services/accountingPostingEngine.js`. The following are the principal mappings relevant to current business flows:

| Category | Account | Code | How it is used |
|---|---|---:|---|
| Assets | Cash | 1110 | Cash treasury account |
| Assets | Bank | 1120 | Bank treasury account and several non-COD receipts |
| Assets | Customer accounts receivable | 1130 | Customer AR control |
| Assets | Inventory | 1140 | Merchandise inventory |
| Assets | Input VAT receivable | 1150 | Recoverable VAT in supported supplier-cost cases |
| Assets | NCM COD receivable | 1170 | COD due from NCM in the delivery-sale flow |
| Assets | Payment gateway clearing | 1180 | Exists in the chart; not the default tender mapping in delivered-sale posting |
| Assets | Fixed assets | 1510–1530 | Asset classes |
| Assets | Accumulated depreciation | 1590 | Contra-asset |
| Liabilities | Accounts payable | 2110 | General AP |
| Liabilities | Output VAT payable | 2120 | VAT collected on taxable sales |
| Liabilities | Customer refunds/advances | 2140 | Customer refund/advance control |
| Liabilities | Manufacturer payable | 2160 | Manufacturer production, logistics and certain order costs |
| Liabilities | Marketing partner payable | 2170 | Partner settlements |
| Liabilities | NCM carrier payable | 2180 | Exists in the chart; NCM remittance flow below uses direct expense instead |
| Liabilities | Term loans | 2510 | Investor/lender debt |
| Equity | Share capital / premium | 3100 / 3200 | Share issuance and capital |
| Equity | Retained earnings | 3300 | Account exists; automatic year-end close was not established in the reviewed flows |
| Equity | Current-year profit/loss / drawings | 3400 / 3500 | Equity accounts |
| Revenue | Product sales | 4100 | Product revenue, excluding VAT |
| Revenue | Delivery revenue | 4200 | Customer delivery charge, excluding VAT |
| Revenue | Collaboration fee | 4300 | Partner/collaboration revenue |
| Contra-revenue | Returns / discounts | 4500 / 4600 | Sales returns and discounts |
| Cost | COGS | 5100 | Product cost recognized on sale |
| Cost | Inbound freight / packaging / damage | 5200 / 5300 / 5500 | Cost and inventory-loss accounts |
| Operating expense | Payroll, rent, utilities, marketing, delivery, depreciation, etc. | 6100–6700 | Operating costs |
| Finance expense / other income | Finance expense / other income | 7100 / 8100 | Loan interest and other postings |

The account code is not proof that a particular workflow actually uses the account; for example, 1180 and 2180 exist but some reviewed transaction paths do not post through them.

## 3. Customer orders, checkout price and delivery charges

### Checkout total and price lock

The customer order placement flow in `backend/controllers/orderController.js` asks the backend shipping resolver for a quote using the customer district/province, item snapshot and subtotal. The backend then locks the resolved fee into `Order.deliveryFee`; the order `amount` is calculated as item total plus delivery fee minus applicable loyalty/card discounts. The shipping quote is therefore a customer charge, not the same thing as the delivery partner's later earning or the carrier's actual fee.

The quote logic in `backend/services/shippingRateService.js` uses a route override when configured, then same-district, same-province or different-province configured fees. It can apply a free-shipping minimum. Kathmandu, Lalitpur and Bhaktapur are treated as the same district group for this calculation. The current route override mechanism is capped at 50 explicit routes; it is not a table of every district pair. Distributor selection and stock availability are separate inputs to the shipment plan.

### Delivery-sale journal

When delivery is marked complete, `postDeliveredOrderAccounting` in `backend/services/accountingPostingEngine.js` posts a `DELIVERY_SALE` journal (idempotency key `DELIVERY_SALE:<orderId>`). At a high level, the intended lines are:

```text
DR tender / receivable (gross customer total)
    CR product sales (product gross excluding embedded 13% VAT)
    CR delivery revenue (delivery gross excluding embedded 13% VAT)
    CR output VAT

DR COGS
    CR inventory
```

For COD, this posting currently uses NCM COD receivable 1170 as the tender account. For non-COD, it uses Bank 1120. The existing gateway-clearing account 1180 is not selected by this function. The sale's gross total is separated into product and delivery amounts, and each is divided by 1.13 to calculate the taxable base; the remainder is treated as 13% embedded VAT.

The NCM delivery completion path in `backend/services/deliveryService.js` passes the `DeliveryOrder` to the poster, including its `customerDeliveryCharge`. The distributor self-delivery path calls the same poster without a `DeliveryOrder`.

### Material delivery-charge and COD gaps

These are important before relying on the books for delivery profitability:

1. The checkout schema stores the quote in `Order.deliveryFee` (`backend/prisma/schema.prisma`, `Order` model), while the sale poster reads `order.deliveryCharge` or `deliveryOrder.customerDeliveryCharge`. `Order` does not declare a `deliveryCharge` field. Therefore, the NCM path can use the delivery order's customer charge, but the self-delivery path as currently called has no corresponding value passed to the poster; its delivery-revenue component may be zero even though `Order.deliveryFee` was charged.
2. COD is always mapped to NCM COD receivable in the delivered-sale poster, including when called from distributor self-delivery. That does not distinguish cash collected by a distributor from cash collected by NCM.
3. The order-placement path sets COD and unpaid (`payment: false`) in the shown online checkout flow. The poster uses Bank for all non-COD methods rather than selecting the payment gateway clearing account.

These are implementation observations, not assumptions about how a particular deployment configures its payment provider. Check the order path, settlement path and actual delivery mode together when correcting them.

## 4. Product cost and COGS

### Current production costing

Manufacturer approval records `approvedUnitCogs`, MOQ and `approvedDeliveryCost`. A production request must pass its pre-production requirements, and completion validates actual good/damaged size-color quantities. Good quantities are received into manufacturer inventory through `backend/services/inventoryLedgerService.js` as production cost layers containing `unitCogs` and `unitDeliveryCost`.

The production completion flow posts the production value for good units to inventory and manufacturer payable: in concept, `DR inventory 1140 / CR manufacturer payable 2160` for approved unit COGS multiplied by good units. The implementation uses the approved per-piece COGS; it does **not** automatically calculate a final COGS by dividing a separately entered total batch overhead by the actual good units.

Production cost layers retain both:

- `unitCogs`: cost used as product inventory value and later COGS.
- `unitDeliveryCost`: packaging/other delivery overhead tracked separately from product cost.

At delivery, production-layer allocations are used to recognize `DR COGS 5100 / CR inventory 1140`. Legacy order cost snapshots can instead recognize COGS and manufacturer payable directly. For a valid manufacturer tax invoice in supported legacy-cost cases, the poster can split the gross approved amount into net COGS, input VAT receivable 1150, and manufacturer payable 2160.

### Cost formula the user described versus implementation

The desired business interpretation discussed for this project is:

```text
per-unit product COGS =
  (direct production cost for the batch + production costs intended to be capitalized)
  / good units produced
```

Factory-to-distributor delivery and other logistics are intended as overhead, not product COGS. The current implementation is narrower: admin-approved `approvedUnitCogs` becomes `unitCogs`; approved delivery/packaging cost is a separate `unitDeliveryCost`. Do not describe the broader total-batch formula as already implemented.

### Dashboard COGS is not one calculation

`backend/services/financialDashboardCosting.js`, used by the finance analytics dashboard, prefers order item cost allocations and production cost layers, falls back to approved legacy manufacturer inventory costs, and ultimately can fall back to product cost. It reports direct COGS separately from delivery/other overhead.

Other report and legacy paths calculate COGS differently. For example, `postSalesOrderAccounting` uses product `costPrice`; a legacy financial statements calculation also aggregates product `costPrice` for orders and divides by 1.13. Those approaches can disagree with batch cost-layer COGS. Future work should identify the intended authoritative report rather than assuming all dashboard cards read the same posting or cost source.

## 5. Manufacturer payables, logistics and settlements

Manufacturer production settlement summaries in `backend/services/manufacturerSettlementService.js` derive production payables from manufacturer production journals, logistics payables from `MANUFACTURER_LOGISTICS` journals, and subtract payments/settled settlement requests. The manufacturer settlement payment flow validates outstanding payable and treasury funds, updates cash, posts supplier-payment accounting, updates the request and audit record in one transaction. A LOGISTICS settlement clears the freight payable recognized at dispatch; it does not recognize freight expense again.

Manufacturer payable categories represented in the reviewed flows include:

- Approved production value for accepted good units.
- Certain legacy/direct order COGS and manufacturer commissions.
- Per-unit packaging/delivery overhead when its production-layer allocation is expensed at order delivery.
- Manufacturer-paid manual/local StockTransfer freight. Dispatch debits delivery expense (6430) and credits manufacturer payable (2160) when the carrier service is performed; settlement later clears the payable against cash. This is separate from product COGS.

NCM bookings are a separate carrier flow. Do not treat the existence of an NCM booking or a manufacturer logistics payable as proof that it is in the same payable subledger.

## 6. Distributor balances and delivery methods

### Distributor delivery statement

`backend/services/distributorFinanceService.js` derives distributor delivery earnings from delivered assignments, returns, incentives, commission/discount, VAT mode and settlement requests. It returns an operational payable balance owed by the platform to the distributor. Its statement explicitly reports `receivables: 0`; it is not a general accounts-receivable ledger between distributor and platform.

The service resolves the distributor's active approved rate card, with a product-specific card before a general card, and a fallback default if none exists. The current statement code applies the resolved rate to delivered historical assignments rather than visibly using an immutable per-delivery rate snapshot. Consequently, changing an active card may affect how historical statement earnings are recomputed.

This distributor rate card concerns distributor compensation. It is distinct from the customer-facing destination/origin shipping quote. In particular, the customer charge and distributor payment do not have to be equal.

### NCM versus distributor self-delivery

- **NCM delivery:** the NCM booking COD is the system-provided order COD and does not include the carrier's delivery fee. The admin is responsible for that fee. Carrier settlement records expected/actual COD and delivery fees; on remittance, treasury receives net COD after the fee, and the GL poster debits cash/bank for net COD, debits delivery expense 6430 for the carrier fee, and credits NCM COD receivable 1170 for gross COD.
- **Distributor self-delivery:** completion consumes distributor inventory and calls the delivered-sale poster. The distributor finance statement separately calculates delivery earnings and settlements. Its COD tender mapping currently shares the NCM COD mapping, as noted above.
- **Stock and goods:** distributor on-hand quantities are inventory-location/ledger concerns, not the same as distributor financial receivables. Distributor replenishment is a `StockTransfer`; it should not be conflated with the customer-order `OrderAssignment`.

### Distributor settlement GL integration caveat

The reviewed distributor settlement execution updates Treasury cash, creates a `CashTransaction`, and updates the settlement request. Unlike the manufacturer settlement flow, no matching GL payment posting was visible in the reviewed execution path. Treat the distributor operational settlement amount and GL payable balance as requiring reconciliation until that path is confirmed or integrated.

## 7. NCM COD and carrier charges

The GL has NCM COD receivable 1170 and NCM carrier payable 2180. Delivered COD sales debit NCM COD receivable. At NCM remittance, the current poster does:

```text
DR cash/bank                   COD collected - actual carrier fee
DR delivery expense 6430       actual carrier fee
    CR NCM COD receivable 1170  total COD collected
```

The admin settlement controller also increments the selected `FinancialAccount`, creates an inflow `CashTransaction`, and marks delivery settlements settled. The GL posting is invoked in that settlement transaction.

Although carrier payable 2180 exists, the inspected remittance poster recognizes the actual carrier fee as direct delivery expense rather than accruing and clearing a separate carrier payable. Use the actual settlement record values, not only the expected quote, for carrier expense reconciliation.

## 8. Returns, exchanges and refunds

The delivery return poster reverses relevant sale revenue and VAT and handles return-related settlement, manufacturer payable/commission/overhead and inventory/COGS reversal where applicable. The older `postCustomerReturnAccounting` path separately posts return/allowance 4500, reverses output VAT, credits cash/bank or refund payable, and can restore inventory/reverse COGS when a restocked cost is provided.

These are separate paths. A return request, exchange request, physical stock receipt and customer refund are not necessarily the same event. Confirm the workflow's final/confirmed transition and stock evidence before assuming revenue, cash, payable and COGS were all reversed.

## 9. Operating expenses, income and marketing

### Expenses

`backend/controllers/expenseController.js` provides expense categories and paid/payable expense recording. An immediately paid expense checks treasury solvency, updates a `FinancialAccount`, writes a `CashTransaction` and creates an `OperatingExpense`; a payable expense creates an `AccountPayable` and an `OperatingExpense`. Both invoke GL expense posting asynchronously. The finance controller also has a separate `record-operating-expense` endpoint that can split the paid and payable portions.

Expense VAT is treated as embedded 13% VAT when `isVatBill` is true unless a VAT amount is explicitly provided. The expense dashboard recognizes marketing as an operating expense category; manufacturer commission, partner CPA, delivery/carrier costs, software, salaries, rent and other categories have separate GL mappings.

### Direct/miscellaneous income

The expense controller supports direct income categories such as direct sales, scrap sales, custom work, printing service, commission and other. It updates Treasury and creates `CashTransaction` and `DirectIncome` records, then calls `postCustomerPaymentAccounting`.

**Important mismatch:** despite a nearby comment describing income as sales/other income, `postCustomerPaymentAccounting` debits cash/bank and credits customer AR 1130 (with optional discount/fine lines). The GL posting does not visibly credit a category-specific income account. DirectIncome's operational record therefore should not be assumed to produce the intended GL income classification.

### Marketing and partner costs

Marketing can be recorded through operating expenses and mapped to marketing expense 6400. Manufacturer commission is separately mapped to 6410; partner CPA and delivery/carrier expenses have dedicated mappings. Depending on entry point, a partner obligation may be a partner payable or an operating expense. Confirm which pathway created it before interpreting the balance.

## 10. Treasury, receivables and payables

`FinancialAccount` represents cash/bank treasury balances, and `CashTransaction` is the operational cash movement history. Treasury accounts are mapped to GL cash/bank/clearing accounts. Opening balances are intended to require an approved opening journal rather than an unbalanced manual entry.

General payable/receivable features also use `AccountPayable` and `AccountReceivable`, while newer GL flows use accounts such as 2110/1130 and accounting-party/subledger relations. These systems coexist. A row in an operational payable/receivable table is not automatically proof of a matching GL control-account posting.

Manufacturer and distributor settlement requests are their own workflow records, with distinct permissions and payout rules. For all parties, reconcile party-level requests, treasury transactions, GL control accounts and GL journals before treating the displayed balance as authoritative.

## 11. Fixed assets and depreciation

`FixedAsset` stores purchase cost, salvage value, useful life, depreciation method/rate, accumulated depreciation, current book value and status.

The depreciation batch supports:

- **Straight line:** `(purchase cost - salvage value) / useful life months * months requested`.
- **Written-down value:** current book value multiplied by annual depreciation rate divided by 12, multiplied by months requested.

The result is capped at book value less salvage value. Active asset balances are updated, then a GL journal is invoked for `DR depreciation expense 6600 / CR accumulated depreciation 1590`. Damaged/written-off assets are separately reflected by some dashboard calculations and disposal operations.

Implementation caveat: the reviewed depreciation controller updates assets before invoking GL posting asynchronously; it is not one atomic transaction with the GL. The finance analytics dashboard also estimates monthly depreciation independently, using a monthly rate calculation; that estimate is not necessarily the same as a posted depreciation batch.

## 12. Investors, lenders, shares and retained earnings

Relevant models include `PartnerEquity`, `CompanyValuation`, `ShareTransaction`, `ProfitDistribution` and `InvestorLiability`.

- **Partner/share capital:** the GL has share capital 3100 and share premium 3200. Share issue and buyback posting helpers exist. Partner equity/cap table and company valuation are also stored as operational records.
- **Loans:** `InvestorLiability` tracks principal, repayment and outstanding balance; the GL has term loans 2510 and finance expense 7100. Loan disbursement/repayment posting helpers exist, but the reviewed controller updates operational records/Treasury and starts GL posting asynchronously, so a posting failure can leave the records out of sync.
- **Profit distribution:** the calculation currently estimates taxable revenue as gross order revenue divided by 1.13, estimates COGS at a fixed 55% of taxable revenue, subtracts operating expenses, retains a configurable percentage (default 20%), and allocates the remainder by partner ownership. It can create payable records or pay partners from Treasury and record cash transactions.
- **Retained earnings:** `ProfitDistribution` records retained percentage and retained amount; account 3300 exists. The reviewed flow does not establish an automatic year-end closing journal transferring current-year profit to retained earnings.

**Profit-distribution caveat:** this is a heuristic operational distribution calculator, not a distribution based on posted GL net profit. Its fixed 55% COGS estimate, order revenue basis, expense inputs, payout records and retained amount should not be treated as audited retained earnings or shareholder equity without reconciliation. No corresponding GL distribution/retained-earnings posting was visible in the inspected controller flow.

## 13. Dashboard and statements: distinguish the sources

There are multiple reporting paths:

1. **Finance analytics dashboard** (`financialController.js`): aggregates orders, returns, operating expenses, cost layers/legacy costs, treasury, receivables, payables, loans, partner capital and assets. It computes several metrics itself, including revenue excluding embedded VAT, profitability, inventory valuation and estimated depreciation.
2. **Legacy financial statement calculation**: another controller path derives COGS from product `costPrice`, estimates retained earnings as assets less liabilities and partner capital, and estimates cash flow from operational records. It can differ from cost-layer and GL results.
3. **Accounting reports** (`accountingController.js`): the General Ledger, trial balance, journals and GL-derived statements use posted journal data. These are the appropriate reports for verifying what actually reached the double-entry ledger, subject to posting gaps noted here.
4. **Party/portal statements**: manufacturer and distributor services derive payable/settlement summaries from their own journals, cost events, rates and requests; these do not constitute every entity's full GL subledger.

Do not compare a dashboard value and a GL account balance without first checking period boundaries, VAT basis, order status, return timing, cost source and asynchronous posting status.

## 14. Key implementation gaps and cautions for future work

The following items are directly relevant to improving the accounting design:

1. **Delivery amount field mismatch:** checkout writes `Order.deliveryFee`; the sale poster looks for `Order.deliveryCharge` or a delivery-order charge. Self-delivery does not pass a delivery-order object.
2. **COD party mismatch:** self-delivery COD is posted to NCM COD receivable, just like NCM-collected COD.
3. **Non-COD tender mapping:** delivered-sale posting uses Bank 1120 for all non-COD tenders, despite payment gateway clearing 1180 existing.
4. **Distributor payout:** the reviewed payout path updates treasury and request records but did not show the matching GL payable settlement.
5. **Direct-income mapping:** the direct-income controller calls a helper that credits customer AR 1130 rather than visibly crediting an income account.
6. **Non-atomic posting in some flows:** expense, direct income, depreciation, loan/equity and some delivery paths invoke GL posting asynchronously or catch posting errors after changing operational state. In these paths, GL and operational data can diverge.
7. **COGS source differences:** cost-layer allocations, legacy manufacturer cost snapshots, product `costPrice`, and percentage-estimated COGS all coexist.
8. **Profit distributions are estimates:** fixed 55% estimated COGS is not actual batch COGS or GL net income; retained earnings are recorded in the distribution model but not proven to post to 3300.
9. **Payable/receivable systems coexist:** operational `AccountPayable`/`AccountReceivable`, accounting-party journals, supplier settlements and distributor settlements require explicit reconciliation.
10. **VAT treatment varies by pathway:** sale and delivery charge handling assumes embedded 13% VAT; input VAT requires specified evidence in some supplier-cost paths. Verify invoice evidence and VAT inclusion before changing rates or formulas.

## 15. Recommended guardrails for an accounting enhancement

These are constraints for a future implementation, not claims about current behavior:

- Define one authoritative source for posted revenue, delivery revenue, VAT, COGS, logistics, operating expense and cash movement; build dashboards from that source or clearly label estimates.
- Keep order customer delivery charge, NCM's actual fee, distributor's delivery compensation, and manufacturer-to-distributor freight as separate amounts and separate business events.
- Use delivered/order cost allocations from production layers for COGS; capitalize only costs intentionally classified as product cost. Keep outbound/customer and manufacturer-to-distributor logistics as overhead if that remains the chosen policy.
- Record production batch cost inputs with an explicit classification (capitalizable product cost vs overhead), total amount/unit basis, and denominator (accepted good units); preserve source documents and the resulting unit-cost snapshot.
- Keep COD receivable ownership tied to the entity that actually collects/remits it (NCM versus distributor); don't infer the collector from payment method alone.
- Make the operational state change, treasury movement, GL posting and settlement record atomic where feasible. Otherwise, return an explicit posting failure and provide a reconciliation/retry path.
- Preserve idempotency keys for delivery, return, settlement, refund, expense, depreciation, share and loan postings; avoid posting the same source event through both legacy and new pathways.
- Reconcile party-level balances and operational cash/payables/receivables against GL control accounts, including exceptions and unmatched source records.
- Treat retained earnings as a period-close process based on approved GL balances, not as a residual dashboard value or fixed-percentage estimate.

## 16. Source map

- Core posting engine and chart of accounts: [accountingPostingEngine.js](./backend/services/accountingPostingEngine.js)
- Dashboard product costing: [financialDashboardCosting.js](./backend/services/financialDashboardCosting.js)
- Checkout, order total and delivery fee lock: [orderController.js](./backend/controllers/orderController.js)
- Shipping tiers and route overrides: [shippingRateService.js](./backend/services/shippingRateService.js)
- Production approval and completion: [manufacturerProductionController.js](./backend/controllers/manufacturerProductionController.js)
- Inventory ledger and cost layers: [inventoryLedgerService.js](./backend/services/inventoryLedgerService.js)
- Manufacturer settlement summary: [manufacturerSettlementService.js](./backend/services/manufacturerSettlementService.js)
- Distributor statement and settlement request: [distributorFinanceService.js](./backend/services/distributorFinanceService.js)
- Distributor rate cards: [distributorRateCardService.js](./backend/services/distributorRateCardService.js)
- NCM delivery state and accounting call: [deliveryService.js](./backend/services/deliveryService.js)
- Distributor self-delivery state and accounting call: [distributorSelfDeliveryService.js](./backend/services/distributorSelfDeliveryService.js)
- NCM remittance and delivery settlement controller: [deliveryController.js](./backend/controllers/deliveryController.js)
- Expense and direct-income workflows: [expenseController.js](./backend/controllers/expenseController.js)
- Finance analytics, expenses, depreciation, loans, equity and profit distributions: [financialController.js](./backend/controllers/financialController.js)
- Treasury and cash movement controller: [treasuryAccountingController.js](./backend/controllers/treasuryAccountingController.js)
- Finance endpoints and permissions: [financialRoute.js](./backend/routes/financialRoute.js)
- GL endpoints and permissions: [accountingRoute.js](./backend/routes/accountingRoute.js)
- Financial and accounting models: [schema.prisma](./backend/prisma/schema.prisma)
