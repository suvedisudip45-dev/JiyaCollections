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
| Assets | Distributor COD receivable | 1190 | COD due from the assigned distributor until an evidenced remittance is verified and allocated |
| Assets | Fixed assets | 1510–1530 | Asset classes |
| Assets | Accumulated depreciation | 1590 | Contra-asset |
| Liabilities | Accounts payable | 2110 | General AP |
| Liabilities | Output VAT payable | 2120 | VAT collected on taxable sales |
| Liabilities | Customer refunds/advances | 2140 | Customer refund/advance control |
| Liabilities | Manufacturer payable | 2160 | Manufacturer production, logistics and certain order costs |
| Liabilities | Marketing partner payable | 2170 | Partner settlements |
| Liabilities | NCM carrier payable | 2180 | Accrued for actual carrier fees and cleared when netted against remittance |
| Liabilities | Distributor payable | 2190 | Admin-verified customer refunds paid by distributors; cleared by a separate treasury payout |
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

The account code is not proof that a particular workflow actually uses the account; for example, 1180 exists in the chart but is not selected by the delivered-sale poster.

### VAT rate configuration

Admin can schedule an immutable `VatRateVersion` for a future UTC effective timestamp from the Tax Compliance page. Versions are append-only; only the latest future version can be cancelled, and effective or historical rates cannot be edited or deleted. New delivered-sale and full delivery-return postings resolve the rate against the source order timestamp. Customer return approval stores the applicable rate in the refund-policy snapshot so later rate changes do not alter an approved refund. Until a version exists for the source date, the legacy singleton `TaxConfiguration.vatRate` is used, with 13% as the final fallback. Pre-version historical tax therefore still needs accountant-reviewed reconciliation; do not treat this configuration as a legal tax opinion.

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

For NCM COD, this posting uses NCM COD receivable 1170. For distributor-collected self-delivery COD, it uses distributor COD receivable 1190 and creates an idempotent distributor receivable document. For non-COD, it uses Bank 1120. The existing gateway-clearing account 1180 is not selected by this function. The sale's gross total is separated into product and delivery amounts using `Order.amount` and `Order.deliveryFee`; the effective rate for the order timestamp is used to calculate the taxable base and embedded VAT.

The NCM delivery completion path in `backend/services/deliveryService.js` passes the `DeliveryOrder` to the poster, including its `customerDeliveryCharge`. The distributor self-delivery path calls the same poster without a `DeliveryOrder`; the poster therefore uses the locked `Order.deliveryFee` field.

When notifications and SMS are enabled, unpaid distributor COD delivery
requires a short-lived hashed customer OTP bound to the order, assigned
distributor, and exact order amount. When either is disabled, the dashboard
instead requires the distributor to confirm that the full amount was collected;
the cash event remains `PENDING_VERIFICATION` and records this as a distributor
declaration, not OTP verification. The delivery transition, inventory movement,
`DistributorCashEvent`, and accounting-outbox enqueue are transactional. A
distributor's collection is not company cash: it remains an open 1190 receivable
until the distributor submits a bank/wallet reference and a JPG/PNG image of the
transfer evidence, which an Admin verifies.
Verification posts the selected treasury inflow, journal, cash transaction,
receivable allocation, and batch/event status atomically.

For NCM deliveries, only an exact recognized delivered milestone or an explicit
Admin “confirm delivered” decision can start the delivered-sale transaction.
Unknown, negative, conflicting, or stale carrier updates enter the Admin
reconciliation queue and do not change COD/order state, consume inventory, or
enqueue delivered-sale accounting. An Admin decision is recorded with its
investigation note in the delivery event history.

### Distributor return and reimbursement postings

Admin return approval snapshots the configured return-charge percentage
against returned product value. The original delivery fee is excluded from the
refund. For a distributor-routed return, receipt/inspection does not mark the
customer paid and does not create the legacy customer-refund payable. The
distributor records the exact Admin-approved amount, payment method/reference,
and a JPG/PNG image of the refund evidence. Return inspection also requires a
JPG/PNG photo of the returned goods. Admin verification alone completes the
refund and posts:

```text
DR sales returns / output VAT reversal
    CR distributor payable (2190)
DR inventory / CR COGS (restockable returned units only)
```

The matching payable accounting document is linked to the distributor party.
Admin payout is separate: it debits 2190, credits the selected NPR treasury
account, creates a cash outflow, and allocates the amount to that specific
payable document in one serializable transaction. Distributor COD receivable
and refund payable are deliberately reported separately until an Admin
explicitly approves an offset in distributor Finance detail. An offset is
limited to the lower of verified refund payable and open COD receivable less
pending remittances; it debits 2190, credits 1190, and allocates both gross
subledger documents in the same serializable transaction. The unique
`DistributorSettlementOffset` record, linked journal, Admin actor, notes, and
audit event preserve the approval history. The existing gateway-clearing
account 1180 remains unselected for non-COD delivered-sale tenders and should
be addressed independently.

## 4. Product cost and COGS

### Current production costing

Manufacturer approval records `approvedUnitCogs`, MOQ, `approvedDeliveryCost`, and VAT treatment. A production request must pass its pre-production requirements, and completion validates actual good/damaged size-color quantities. Good quantities are received into manufacturer inventory through `backend/services/inventoryLedgerService.js` as production cost layers containing `unitCogs`, unit VAT, VAT treatment/rate, supplier invoice reference/verification state, and `unitDeliveryCost`.

For a verified VAT invoice, production completion capitalizes the net unit cost, debits verified VAT to input VAT receivable, and credits manufacturer payable for the gross payable (plus any batch cost). If the invoice has not been verified, VAT remains part of inventory cost and no input-VAT credit is posted. The VAT report reads output VAT and input VAT from posted journal entries; it does not estimate input VAT by reapplying 13% to product or freight costs.

The production completion flow posts the production value for good units to inventory and manufacturer payable: in concept, `DR inventory 1140 / DR input VAT receivable 1150 (verified invoice only) / CR manufacturer payable 2160`. Batch other cost remains allocated across actual good units under the current cost-terms version.

Production cost layers retain:

- `unitCogs`: capitalized cost used as product inventory value and later COGS, excluding verified recoverable input VAT.
- `unitVatAmount`, `vatTreatment`, `vatRate`, and `vatInvoiceVerified`: VAT evidence snapshot; VAT is recognized once at production receipt.
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

Manufacturer production settlement summaries in `backend/services/manufacturerSettlementService.js` derive production payables from manufacturer production journals, logistics payables from `MANUFACTURER_LOGISTICS` journals, and subtract payments/settled settlement requests. The manufacturer settlement payment flow validates outstanding payable and treasury funds, updates cash, posts supplier-payment accounting, updates the request and audit record in one transaction. A LOGISTICS settlement clears the freight payable recognized at dispatch; it does not recognize freight expense again. The 6430 expense remains in the income statement after payment because the shipment cost was already incurred; the amount that clears is the 2160 liability, while the selected cash/bank asset decreases.

Manufacturer payable categories represented in the reviewed flows include:

- Approved production value for accepted good units.
- Certain legacy/direct order COGS and manufacturer commissions.
- Per-unit packaging/delivery overhead when its production-layer allocation is expensed at order delivery.
- Manufacturer-paid manual/local StockTransfer freight. Dispatch debits delivery expense (6430) and credits manufacturer payable (2160) when the carrier service is performed; settlement later clears the payable against cash. This is separate from product COGS.

Paid manufacturer `LOGISTICS` settlements are allocated oldest-dispatch-first across local shipments. The shipment keeps the cumulative paid amount, so partial settlement is visible as both paid and outstanding freight in Admin finance details. If a paid logistics amount cannot be matched to dispatched local freight, the payment response explicitly flags reconciliation rather than reporting a clean match.

NCM bookings are a separate carrier flow. Do not treat the existence of an NCM booking or a manufacturer logistics payable as proof that it is in the same payable subledger.

## 6. Distributor balances and delivery methods

### Distributor delivery statement

`backend/services/distributorFinanceService.js` derives distributor delivery earnings from delivered assignments, returns, incentives, commission/discount, VAT mode and settlement requests. It returns an operational payable balance owed by the platform to the distributor. Its statement explicitly reports `receivables: 0`; it is not a general accounts-receivable ledger between distributor and platform.

The service resolves the distributor's active approved rate card, with a product-specific card before a general card, and a fallback default if none exists. New completed self-deliveries write a `DistributorServiceEarning` with the exact delivery, incentive, commission, effective timestamp, rate-card identifier, and tax treatment used. That event creates one debit to delivery expense 6430, one credit to distributor payable 2190, and a linked payable accounting document in the same delivery transaction. A unique source key prevents duplicate accrual. Distributor service VAT is zero unless a future verified-invoice workflow explicitly supports eligible input VAT; a configured rate is not evidence for a tax claim.

This distributor rate card concerns distributor compensation. It is distinct from the customer-facing destination/origin shipping quote. In particular, the customer charge and distributor payment do not have to be equal.

Admin rate-card revisions create new versions, while closing a card retains its history. Approved rate-card values are not rewritten to update past earnings. The Admin rate editor uses the actual delivery, return, commission-percent, and incentive-amount fields.

Settlement requests backed by these source documents are paid from the recorded earning documents, with the journal clearing 2190, Treasury/cash movement, and document allocations in a serializable transaction. Legacy settlement requests retain their older `AccountPayable` path. Historical delivered assignments without a `DistributorServiceEarning` are still displayed using the legacy calculation and must be reconciled before those historical figures are treated as immutable or accounting-authoritative.

### NCM versus distributor self-delivery

- **NCM delivery:** delivered COD sales create an NCM receivable document linked to the source order. The remittance workflow requires those documents to exist and allocates gross COD against only the selected source orders. The actual carrier fee is accrued to expense 6430 and payable 2180 with a party-level bill; the net receipt journal debits cash/bank, clears 2180, and credits NCM COD receivable 1170. The fee bill and COD invoices are allocated in the same serializable transaction as the journal and Treasury cash movement.
- **Distributor self-delivery:** completion consumes distributor inventory and calls the delivered-sale poster. The distributor finance statement separately calculates delivery earnings and settlements. Its COD tender mapping currently shares the NCM COD mapping, as noted above.
- **Stock and goods:** distributor on-hand quantities are inventory-location/ledger concerns, not the same as distributor financial receivables. Distributor replenishment is a `StockTransfer`; it should not be conflated with the customer-order `OrderAssignment`.

### Distributor settlement accounting

For new earning documents, a settlement request does not accrue service expense a second time. Admin payout is limited to open earning-document balances and clears distributor payable control account 2190. Old request-created payables remain supported only for existing settlement requests; do not create a new legacy payable for a delivery that already has an earning document.

## 7. NCM COD and carrier charges

The GL has NCM COD receivable 1170 and NCM carrier payable 2180. Delivered COD sales debit NCM COD receivable. At NCM remittance, the current poster does:

```text
DR cash/bank                   COD collected - actual carrier fee
DR delivery expense 6430       actual carrier fee
    CR NCM COD receivable 1170  total COD collected
```

The shared `backend/services/ncmSettlementService.js` processes Admin remittances from the delivery monitor and the legacy single-receipt endpoints. It bounds a batch to 100 unique settlements, verifies a mapped active NPR asset account, validates the net deposit, claims each open settlement, requires matching open NCM COD source documents, accrues a batch-level NCM carrier bill, posts the accrual and settlement journals, allocates gross COD and carrier fees, links the settlement journal to each included row, increments Treasury and writes the idempotent inflow `CashTransaction` in one serializable transaction. Replaying a processed batch does not post cash or fees twice. Unexplained adjustments and non-positive deposits are rejected for reconciliation instead of being silently booked.

The settlement list defaults to the same three remittable states accepted by the service, so return-pending and already settled rows are not accidentally selected by the Admin batch action. Admin 2FA issuance and resend use cryptographically random OTPs, with a fixed OTP permitted only through an explicit development-only configuration; never configure that override in production.

The NCM bill currently represents the fee netted from a remittance batch, not a separately invoiced fee collected at another date. Use actual settlement values, not only the expected quote. If the carrier later supplies a separate fee invoice, do not accrue it again; reconcile the source document and remittance before posting any additional bill.

## 8. Returns, exchanges and refunds

The delivery return poster reverses relevant sale revenue and VAT using the original order date's effective VAT rate and handles return-related settlement, manufacturer payable/commission/overhead and inventory/COGS reversal where applicable. Customer return approval snapshots the approved charge, non-refundable original delivery fee, refund and VAT portion, and the original effective VAT rate. Distributor-paid customer refunds create party-level distributor payables; the company payout later clears that obligation instead of paying the customer a second time. The older `postCustomerReturnAccounting` path separately posts return/allowance 4500, reverses output VAT, credits cash/bank or refund payable, and can restore inventory/reverse COGS when a restocked cost is provided.

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

1. **Finance analytics dashboard** (`financialController.js`): now includes a `postedAccounting` summary sourced from posted journal lines for period P&L, VAT and closing GL balances. Its operational metrics and itemized cost detail still aggregate orders, returns, operating expenses, cost layers/legacy costs, treasury, receivables, payables, loans, partner capital and assets; they are analytical/subledger estimates, not posted GL totals.
2. **Legacy financial statement calculation**: another controller path derives COGS from product `costPrice`, estimates retained earnings as assets less liabilities and partner capital, and estimates cash flow from operational records. It can differ from cost-layer and GL results.
3. **Accounting reports** (`accountingController.js`): the General Ledger, trial balance, journals and GL-derived statements use posted journal data. These are the appropriate reports for verifying what actually reached the double-entry ledger, subject to posting gaps noted here.
4. **Party/portal statements**: manufacturer and distributor services derive payable/settlement summaries from their own journals, cost events, rates and requests; these do not constitute every entity's full GL subledger.

Use the dashboard's `postedAccounting` section when comparing to posted GL statements. Treat its operational analysis separately and check period boundaries, VAT basis, order status, return timing, cost source and asynchronous posting status before interpreting differences.

## 14. Key implementation gaps and cautions for future work

The following items are directly relevant to improving the accounting design:

1. **Non-COD tender mapping:** delivered-sale posting uses Bank 1120 for all non-COD tenders, despite payment gateway clearing 1180 existing.
2. **Legacy distributor settlement:** existing delivery-earnings payout requests remain a separate operational flow and should be reconciled against their relevant GL accounts; do not confuse them with COD remittance or the new 2190 customer-refund reimbursement.
3. **Direct-income mapping:** the direct-income controller calls a helper that credits customer AR 1130 rather than visibly crediting an income account.
4. **Non-atomic posting in some flows:** expense, direct income, depreciation, loan/equity and some delivery paths invoke GL posting asynchronously or catch posting errors after changing operational state. In these paths, GL and operational data can diverge.
5. **COGS source differences:** cost-layer allocations, legacy manufacturer cost snapshots, product `costPrice`, and percentage-estimated COGS all coexist.
6. **Profit distributions are estimates:** fixed 55% estimated COGS is not actual batch COGS or GL net income; retained earnings are recorded in the distribution model but not proven to post to 3300.
7. **Payable/receivable systems coexist:** operational `AccountPayable`/`AccountReceivable`, accounting-party journals, supplier settlements and legacy distributor settlements require explicit reconciliation.
8. **VAT treatment varies by pathway:** production supplier VAT now captures inclusive/exclusive/exempt terms and only posts input VAT after Admin invoice verification. Other legacy supplier-cost and sale/delivery paths retain their existing assumptions; do not treat VAT as income or apply the production rule to unrelated flows.

## 15. Recommended guardrails for an accounting enhancement

These guardrails apply to the existing and future accounting work:

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
- Distributor COD remittance, cash position, and refund-payable payout: [distributorCashSettlementService.js](./backend/services/distributorCashSettlementService.js)
- Distributor-submitted customer-refund evidence and Admin review: [distributorReturnRefundService.js](./backend/services/distributorReturnRefundService.js)
- NCM remittance and delivery settlement controller: [deliveryController.js](./backend/controllers/deliveryController.js)
- Expense and direct-income workflows: [expenseController.js](./backend/controllers/expenseController.js)
- Finance analytics, expenses, depreciation, loans, equity and profit distributions: [financialController.js](./backend/controllers/financialController.js)
- Treasury and cash movement controller: [treasuryAccountingController.js](./backend/controllers/treasuryAccountingController.js)
- Finance endpoints and permissions: [financialRoute.js](./backend/routes/financialRoute.js)
- GL endpoints and permissions: [accountingRoute.js](./backend/routes/accountingRoute.js)
- Financial and accounting models: [schema.prisma](./backend/prisma/schema.prisma)
