# Accounting Discovery 00: Current Architecture

**Snapshot:** 2026-09-28  
**Status:** Repository discovery; no accounting runtime code or database was changed.  
**Scope:** Existing accounting/finance architecture and the business events it depends on.

## Executive Summary

The project is a multi-portal commerce and manufacturing platform with a shared Express API and Prisma/MySQL persistence. It already contains a double-entry ledger engine, a chart of accounts, journal/line models, periods, journal reports, and manual reversals. It also contains a second operational finance suite for treasury balances, cash transactions, generic payables/receivables, tax estimates, assets, loans, investor equity, and manufacturer balances.

These are not currently one coherent accounting source of truth. Many operational records are written first and GL entries are posted asynchronously or independently. Finance statements are recalculated from orders, products, expenses, fixed assets, treasury balances, and generic AP/AR rather than derived from the GL. Monetary values are predominantly JavaScript `Number` and Prisma `Float`.

The requested manufacturer rule is not implemented as a ledger rule today. Sales posting recognizes COGS at order creation using the global product cost; it does not wait for a delivered/non-returned outcome or create a manufacturer-specific AP party balance. A separate manufacturer finance summary calculates a payable/receivable view from current inventory costs and commission data.

“No room for error” cannot be guaranteed by architecture alone. The achievable objective is to prevent invalid postings by construction, persist business/accounting events atomically, make posting idempotent, retain immutable audit history, reconcile subledgers to GL, and test concurrency and failure paths.

## Application Topology

| Application | Directory | Local port | Accounting responsibility |
| --- | --- | ---: | --- |
| Customer storefront | `frontend/` | 5173 | Creates customer commerce events; no authoritative accounting logic belongs in the browser |
| Admin | `admin/` | 5174 | Current finance/accounting UI and operations |
| Manufacturer | `manufacturer/` | 5175 | Inventory, agreed/proposed product costs, order fulfillment, and a manufacturer-facing calculated finance summary |
| Marketing Partner | `marketing/` | 5176 | Campaign/card and redemption activity; the backend has a settlement model but no discovered accounting posting integration |
| Shared API | `backend/` | 4000 default | Domain rules, auth/RBAC, persistence, accounting and external integrations |

There is no separate `delivery/` UI in this checkout. Carrier delivery is implemented in backend APIs and the Nepal Can Move integration.

## Backend Structure And Runtime

`backend/server.js` connects Prisma/MySQL and Cloudinary, then mounts Express routers. The typical flow is:

```text
router -> authentication/permission middleware -> controller -> service -> Prisma transaction/client -> MySQL
```

Relevant modules:

| Concern | Current entry points |
| --- | --- |
| Runtime and route mounts | `backend/server.js` |
| Schema and migrations | `backend/prisma/schema.prisma`, `backend/prisma/migrations/` |
| Chart, journal posting, reversals | `backend/services/accountingPostingEngine.js` |
| Journal/GL/trial balance/period/reconciliation APIs | `backend/routes/accountingRoute.js`, `backend/controllers/accountingController.js` |
| Finance, treasury, AP/AR, assets, capital, tax, statements | `backend/routes/financialRoute.js`, `backend/controllers/financialController.js` |
| Operating expenses | `backend/routes/expenseRoute.js`, `backend/controllers/expenseController.js` |
| Manufacturer proposed/agreed COGS | `backend/routes/cogsRoute.js`, `backend/controllers/cogsController.js`, `backend/controllers/manufacturerInventoryController.js` |
| Sales and payment events | `backend/controllers/orderController.js` |
| Customer return/refund events | `backend/controllers/returnsController.js` |
| Delivery/NCM events and settlement facts | `backend/routes/deliveryRoute.js`, `backend/controllers/deliveryController.js`, `backend/services/deliveryService.js`, `backend/services/ncmClient.js` |
| Marketing Partner campaigns/redemptions | `backend/controllers/marketingPartnerController.js`, `backend/services/marketingPartnerService.js`, `backend/services/marketingCardService.js` |
| Permission definitions/seed | `backend/prisma/seed.js`, `backend/middleware/authorize.js` |

## Current Accounting And Finance Data Model

The Prisma schema is canonical. The main accounting-related models are:

| Models | What they currently represent | Important limitation |
| --- | --- | --- |
| `Account`, `FiscalYear`, `AccountingPeriod`, `JournalEntry`, `JournalLine` | COA, fiscal periods, posted journal headers and double-entry lines | Amounts are `Float`; current balance is cached on `Account`; no database-level balancing constraint |
| `FinancialAccount`, `CashTransaction` | Treasury cash/bank/wallet-like balances and cash movement history | A separate ledger-like balance and transaction stream; no required FK to the GL journal |
| `AccountPayable`, `AccountReceivable` | Generic outstanding/settled amounts and JSON settlement histories | Free-text party names, mutable totals, no bill-wise allocation entities or GL control reconciliation relationship |
| `OperatingExpense`, `MonthlyExpense` | Expense records and older monthly cost assumptions | Separate expense paths; update/delete of an expense does not visibly reverse/replace its GL posting |
| `InboundShipment`, `SupplierReturn` | Shipment/purchase data and supplier-return snapshots | Supplier return items are JSON; the shipment GL poster exists but no live controller call was found |
| `FixedAsset`, `InvestorLiability`, `PartnerEquity`, `CompanyValuation`, `ShareTransaction`, `ProfitDistribution` | Asset/depreciation, debt, shareholder/cap-table, valuation and distribution operations | Many values are floats; each has separate mutation flows; these are not all linked to party subledgers |
| `TaxConfiguration`, `TaxFilingRecord` | Tax rates/configuration and filing snapshots | Some reports hardcode rates and derive tax from operational records instead of posted tax journals |
| `ManufacturerInventory` | Per-manufacturer/product quantity, reserved quantity, proposed/agreed cost and approval state | Agreed price is mutable; no per-order immutable approved-cost snapshot exists in order item data |
| `DeliveryOrder`, `DeliveryEvent`, `DeliveryReturn`, `DeliveryFinancialSettlement`, `NcmRequestAttempt`, `NcmWebhookEvent` | Carrier package, event history, RTO/return, COD/fee settlement facts, NCM attempts/webhooks | Operational delivery settlement exists, but no accounting journal hook was found; `journalEntryId` is not a demonstrated integration |
| `MarketingPartnerSettlement` | Campaign/partner CPA/redemption amount and payment status | No accounting posting or party subledger linkage was found |

There is no canonical `Payment` or `Receipt` record in the schema. An order has a `payment` boolean and `paymentMethod`; cash receipts are also represented through `CashTransaction`. AP/AR collection histories are JSON arrays.

`PartnerEquity` is the shareholder/investor equity domain. It is distinct from the `MarketingPartner` operational campaign partner. They must not be conflated in accounting-party design.

## Existing Accounting APIs And Admin Screens

### `/api/accounting`

Protected by `authenticate` and accounting permissions. Current operations include COA read/create/update, journal list/detail/manual journal/reversal, GL, trial balance, financial statements, subledger reconciliation, fiscal-year list/create, and period status toggle.

### `/api/finance`

Protected by finance permissions. Current operations include dashboard, manufacturer summary, treasury account CRUD/listing, cash transfers/transactions, fixed assets/depreciation/damage, capital table/shares/valuation/profit distribution, investor liabilities/repayments, generic AP/AR and collections/payments, tax reports, and financial statements.

### Other financial APIs

- `/api/cogs`: manufacturer price proposal reads/approval/rejection and cost overview.
- `/api/expense`: operating expense create/list/update/delete/summary.
- `/api/returns`: customer and supplier return operations.
- `/api/delivery`: delivery settlement and NCM delivery state operations.

The admin portal has separate screens for `ChartOfAccounts`, `JournalEntries`, `GeneralLedger`, `TrialBalance`, `FinanceDashboard`, `FinancialStatements`, `TreasuryCash`, `PayablesReceivables`, `ExpenseManagement`, `CogsCalculator`, `TaxCompliance`, `AssetManagement`, `PartnershipEquity`, `DeliveryMonitor`, and `ReturnsManagement`. The manufacturer portal has a `Finance` screen that calls `/api/finance/manufacturer-summary` and displays payable, receivable, net and commission proposal values.

## Current Posting Engine Behavior

`accountingPostingEngine.js` defines a standard hierarchical COA with fixed account codes and seeds it only when the entire `Account` table is empty. It creates a fiscal year/month on demand. `postJournalEntry` currently checks at least two non-zero lines, rejects a line with both debit and credit, rounds inputs to two decimal places, checks that totals balance, checks that a period is open, inserts a journal and lines in a Prisma transaction, then increments cached account balances.

Current poster functions cover sales/order, customer payment, inbound shipment, supplier payment, customer return, expense, fixed asset purchase/depreciation, loan disbursement/repayment, share issuance/buyback, and reversal. Coverage in callers is uneven; existence of a function does not mean a domain event is integrated.

## Existing Financial Flows

1. **Storefront order:** `orderController` snapshots the selling price and creates the order, then starts `postSalesOrderAccounting` asynchronously. The poster queries the current `Product.costPrice` (not the order's manufacturer-approved agreed cost) and books revenue, output VAT, COGS, and inventory at order time.
2. **Admin direct order:** creates the order and starts the same sales poster; prepaid orders also start the customer-payment poster asynchronously.
3. **Cash-on-delivery collection:** `cashReceived` marks an order paid and starts a GL receipt poster. NCM status processing independently sets order `payment=true` on delivery but does not invoke this poster in the inspected status-transition path.
4. **Customer return:** writes `CustomerReturn`, updates global product stock, mutates cash or creates AP, then posts a return journal asynchronously. The caller does not supply `restockedInventoryCost`, so the current poster cannot reverse inventory/COGS for returned stock through this integration.
5. **Expense:** there are two record flows. `/api/expense` writes `OperatingExpense` then awaits a poster that catches/logs posting errors internally. `/api/finance/record-operating-expense` directly updates treasury/AP and starts GL posting asynchronously. Its `postDirectExpenseAccounting` adapter hardcodes a BANK credit and non-payable treatment, so cash-account selection and credit/partial-payment AP splits do not flow into the journal. Their persisted business updates and GL posting are not one transaction.
6. **Supplier purchase:** `postInboundShipmentAccounting` exists and the `InboundShipment` model exists, but a live route/controller call was not found in this pass. Supplier-return model/controller activity has no matching supplier-return GL poster call.
7. **Finance movements:** various controllers update `FinancialAccount.currentBalance`, `CashTransaction`, AP/AR or asset/debt/share records. Some then post GL asynchronously; some have no posting call. The independent mutations can partially succeed.
8. **Delivery:** NCM status transitions update delivery/order/assignment and upsert a `DeliveryFinancialSettlement`. COD/fee settlement can be requested/reconciled, but no GL poster is called from the delivery paths inspected.
9. **Manufacturer COGS/commission:** cost proposals live per manufacturer/product, while commission rates live on Manufacturer. A calculated finance summary combines order sales, current costs, commission and status; this is not a durable AP/AR ledger.
10. **Marketing Partner:** campaign `cpaRate` and `MarketingPartnerSettlement` capture settlement facts/status, but no GL or party-subledger posting was found.

## User-Required Manufacturer COGS Rule

Target rule provided for this project:

> Only when a product/order is delivered and not returned to the manufacturer should the mutually agreed COGS be shown as payable for admin and receivable for that specific manufacturer.

Accounting interpretation: one posted manufacturer-party payable in the company books appears as the matching receivable in that manufacturer's statement; this is one underlying obligation, not two independently posted amounts.

### Owner decisions received (2026-09-28)

- Manufacturer-supplied inventory is manufacturer-owned consignment stock until sale/delivery; do not treat it as company-owned inventory on hub receipt.
- Recognize the agreed COGS/payable at NCM `DELIVERED`; if the customer product is subsequently returned to the manufacturer, reverse all linked sales/VAT/customer-settlement and manufacturer COGS/payable entries. Restock only after manufacturer receipt/inspection. The COGS basis is admin-approved agreed cost, not proposed cost, snapshotted at manufacturer acceptance.
- Agreed COGS is VAT-inclusive at the current 13% rate. Claim input VAT only when a valid manufacturer tax invoice is recorded; otherwise treat gross cost as cost. Rates must be configurable/effective-dated rather than constants.
- Customer-facing prices are VAT-inclusive. Recognize customer sales revenue and VAT on delivery. Preserve separate gross COD receivable and carrier-fee payable to NCM until bank settlement is confirmed.
- Manufacturer commission is additional to COGS only for manufacturer-originated phone/shop sales, calculated as the agreed rate multiplied by gross profit: discounted product revenue excluding VAT/delivery, less approved COGS excluding recoverable input VAT. Accrue at delivery when not returned. Existing source tags are `Order.orderType=DIRECT_MANUFACTURER` and `directOrderType=PHONE_ORDER|HUB_VISIT`; storefront `ONLINE_STORE` and admin-entered social `ADMIN_DIRECT` orders are excluded.
- Include Marketing Partner CPA per verified benefit redemption and NCM delivery/COD accounting. Use NPR and a Nepali fiscal year from Shrawan 1 through Ashadh end in Asia/Kathmandu time. The current 25% corporate-tax figure remains an estimate only until accountant approval.
- The company is the seller and collector for manufacturer-originated orders too.
- Manufacturer acceptance requires admin-approved COGS; direct phone/shop orders also require an admin-approved commission rate. Missing approval blocks acceptance/order creation.
- Readiness gating applies to finance/accounting operations only; do not block catalog/product or customer order operations on accounting setup.

These are owner-provided requirements, not current implementation behavior. The source code currently calculates manufacturer commission across orders, posts COGS at order creation, has no delivery-triggered manufacturer ledger posting, and permits acceptance without approved COGS/commission.

## Source Documents And Authority

- `backend/prisma/schema.prisma` is the schema authority.
- Current routes/controllers/services/tests are the behavioral authority.
- `BACKEND_ARCHITECTURE.md`, `FEATURES_CATALOG.md`, `README.md`, `SCHEMA.md`, `SECURITY.md`, the auth/RBAC docs, `docs/marketing-card-architecture.md`, and `DELIVERY_AUTOMATION_PLAN.md` are useful context, but parts contain stale status or architecture descriptions.
- The user-provided `enterprise_accounting_integration_prompt.md` is the target requirements brief, not proof that those features already exist.

## Discovery Safety

The owner reports that the database currently has no data. This was not verified by connecting to the database; no database command or accounting integration test was run. The accounting test `backend/tests/accountingEngine.test.js` seeds the COA and creates transactions, so it is not a read-only discovery test. Existing Prisma migration history must still be reviewed before any schema reset or migration, even if the data tables are believed empty.