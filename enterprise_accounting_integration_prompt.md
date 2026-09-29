# Enterprise Accounting System Integration Prompt

## Objective

Act as a principal software architect and senior JavaScript/Node.js
financial-systems designer. Integrate a production-grade, double-entry
accounting subsystem into the existing distributed manufacturing and
distribution platform.

The system contains:

-   Admin portal
-   Manufacturer portal
-   Marketing Partner portal
-   Customer website/portal
-   Products and inventory
-   Sales, sales returns and exchanges
-   Manufacturer-assigned and manufacturer-approved COGS
-   Delivery partners and COD
-   Existing finance/accounting implementation

**The existing accounting/finance implementation must be fully analyzed
and then replaced/restructured as required.** Do not blindly patch it.

The target is an ERP-grade accounting subsystem inspired by established
accounting practices and TallyPrime capabilities, but implemented
natively in the current project's architecture.

------------------------------------------------------------------------

# 1. Absolute Scope Rules

### You may change only accounting/finance-related areas

You may alter:

-   accounting and finance tables
-   chart of accounts
-   journal/ledger tables
-   AR/AP and bill-wise subledgers
-   cash/bank/petty cash accounting
-   payment/receipt accounting
-   settlement accounting
-   COGS accounting
-   inventory-accounting integration
-   sales-accounting integration
-   returns/exchange accounting integration
-   manufacturer/marketing/delivery accounting linkage
-   accounting APIs
-   accounting UI
-   accounting services/repositories/workers
-   accounting configuration
-   accounting migrations
-   accounting tests
-   accounting reports

### Do NOT alter unrelated business functionality

Do not modify business rules for:

-   products
-   customers
-   orders
-   manufacturers
-   marketing operations
-   delivery operations
-   authentication
-   authorization
-   notifications
-   2FA
-   unrelated inventory behavior
-   unrelated portal functionality

If a business event must create an accounting entry, connect it through
an accounting adapter/event boundary. Do not rewrite the business rule.

**Business layer must remain untouched except for the smallest possible
integration hook when absolutely unavoidable.** If an accounting
requirement appears to require changing business logic, stop and explain
why before doing it.

------------------------------------------------------------------------

# 2. Mandatory First Step: Analyze the Whole Repository

Do not start coding.

First inspect the entire project and map:

``` text
frontend applications
backend applications
API architecture
modules/packages
controllers/routes
services
repositories
ORM/database schema
migrations
sales
orders
inventory
product
manufacturer
marketing partner
delivery partner
customer
payments
existing finance/accounting
reports
queues/events
workers
configuration
permissions
```

Locate every existing accounting/finance integration point.

Produce before implementation:

``` text
docs/accounting/00-current-architecture.md
docs/accounting/01-accounting-dependency-map.md
docs/accounting/02-current-accounting-gap-analysis.md
```

The discovery report must identify:

-   current accounting tables
-   current accounting APIs
-   current accounting services
-   current journal/ledger model
-   current AR/AP model
-   current payment model
-   current COGS calculation
-   current manufacturer relationship
-   current marketing relationship
-   current delivery relationship
-   current sales/return/exchange flow
-   inventory valuation behavior
-   tax behavior
-   current reporting
-   current data inconsistencies
-   migration risks
-   duplicate posting risks

**No unrelated source file may be changed during discovery.**

------------------------------------------------------------------------

# 3. TallyPrime Benchmark

Use current official TallyPrime documentation as a functional benchmark,
not as a code/UI copy.

TallyPrime currently provides accounting and financial reporting around
ledgers, cash/bank books, receivables/payables, ageing, trial balance,
balance sheet, P&L, cash flow, fund flow, ratio analysis, cost centres,
budgets, inventory reports, stock/item cost analysis, audit/edit trail,
and bank reconciliation. Its bill-wise accounting model tracks credit
sales/purchases separately against payments/receipts. Its
inventory/manufacturing capabilities also support stock journals,
manufacturing journals and additional costs.

Official references:

-   https://help.tallysolutions.com/accounting-in-tally-prime/
-   https://help.tallysolutions.com/accounting-financial-reports-tally/
-   https://tallysolutions.com/features/cost-control-and-cost-analysis/
-   https://help.tallysolutions.com/company-features-f11-tally/
-   https://help.tallysolutions.com/bank-reconciliation-tally/
-   https://help.tallysolutions.com/manage-inventory-in-manufacturing-tally/
-   https://help.tallysolutions.com/tally-prime/

Use the useful concepts:

``` text
Chart of Accounts
Double-entry journals
Ledgers
Bill-wise AR/AP
Ageing
Cash Book
Bank Book
Trial Balance
Profit & Loss
Balance Sheet
Cash Flow
Fund Flow
Cost Centres
Budgets
Inventory valuation
COGS
Stock movement
Bank reconciliation
Audit/Edit trail
Voucher/source references
```

Do not copy Tally's proprietary database or implementation.

------------------------------------------------------------------------

# 4. Core Accounting Architecture

The new system must be built around a real double-entry ledger.

``` text
Business transaction
        |
        v
Accounting event / adapter
        |
        v
Accounting rule
        |
        v
Central posting engine
        |
        +--> Journal Entry
        +--> Journal Lines
        +--> General Ledger
        +--> AR/AP subledger
        +--> Inventory/COGS
        +--> Settlement
        +--> Audit trail
        |
        v
Financial statements / reports
```

Business tables are not the GL.

The accounting ledger is the authoritative financial source of truth.

------------------------------------------------------------------------

# 5. Double-Entry Invariants

Every posted journal must satisfy:

``` text
SUM(debits) == SUM(credits)
```

Every line must satisfy:

``` text
debit >= 0
credit >= 0
debit > 0 XOR credit > 0
```

Posted accounting entries must be immutable.

Corrections use:

``` text
reversal
adjustment
replacement entry
```

Never silently edit or delete posted financial history.

The system should not claim literal "100% error-free" operation. Instead
enforce accounting correctness through database constraints,
transactions, idempotency, reconciliation, invariant tests, audit
trails, controlled approvals and recovery procedures.

------------------------------------------------------------------------

# 6. Money and Precision

Never use JavaScript floating-point arithmetic for accounting.

Use the existing project's proven decimal/money approach or implement:

-   database NUMERIC/DECIMAL where appropriate
-   integer minor units where appropriate
-   deterministic decimal arithmetic
-   centralized rounding policy
-   explicit currency and precision

Document:

``` text
currency
precision
scale
rounding mode
line rounding
invoice rounding
tax rounding
```

------------------------------------------------------------------------

# 7. Core Data Model

Design and implement equivalents of:

``` text
ChartOfAccount
Account
AccountingPeriod
JournalEntry
JournalLine
AccountingParty
Receivable
Payable
Bill
Payment
Receipt
Allocation
Settlement
Reversal
CashAccount
BankAccount
PettyCashAccount
TaxCode
TaxTransaction
CostCentre
AccountingEvent
AccountingAuditLog
BankTransaction
BankReconciliation
```

Adapt names to the existing project's conventions.

------------------------------------------------------------------------

# 8. Chart of Accounts

Implement a hierarchical COA with at least:

``` text
ASSETS
  Cash
  Bank
  Petty Cash
  Accounts Receivable
  Inventory
  Inventory In Transit
  Tax Receivable
  Other Current Assets
  Fixed Assets

LIABILITIES
  Accounts Payable
  Manufacturer Payable
  Marketing Partner Payable
  Delivery Partner Payable
  Tax Payable
  Other Current Liabilities

EQUITY
  Capital
  Retained Earnings
  Current Year Earnings

REVENUE
  Product Sales
  Other Operating Revenue
  Sales Return / Contra Revenue

COGS
  Product COGS
  Inventory Adjustments

EXPENSES
  Delivery Charges
  Marketing Commission
  Manufacturer Settlement Expense
  Payment Gateway Fees
  Bank Charges
  Inventory Write-off
  Other Operating Expenses
```

Do not hardcode account IDs. Store configurable mappings.

Support system/control accounts that cannot be casually deleted.

------------------------------------------------------------------------

# 9. Accounting Periods

Implement fiscal/accounting periods if not already available:

``` text
OPEN
SOFT_CLOSED
CLOSED
LOCKED
```

Closed periods cannot receive normal postings.

Corrections use controlled reversal/adjustment entries.

Period close/reopen must be permission-controlled and audited.

------------------------------------------------------------------------

# 10. Central Posting Engine

Create one authoritative posting service, following project conventions,
conceptually:

``` text
AccountingPostingService.post()
```

It must:

1.  validate source
2.  validate accounting period
3.  validate account mappings
4.  validate amounts/currency
5.  validate idempotency key
6.  construct journal lines
7.  validate debit = credit
8.  create journal + lines atomically
9.  update required subledgers atomically
10. write audit information
11. commit transaction

No controller or random business service may directly insert ledger
lines.

------------------------------------------------------------------------

# 11. Idempotency and Distributed Safety

The platform is distributed. Events may be duplicated, delayed, retried
or reordered.

Every accounting source must have an idempotency key, for example:

``` text
SALE:<saleId>
SALE_RETURN:<returnId>
EXCHANGE:<exchangeId>
MANUFACTURER_SETTLEMENT:<settlementId>
MARKETING_SETTLEMENT:<settlementId>
DELIVERY_SETTLEMENT:<settlementId>
PAYMENT:<paymentId>
RECEIPT:<receiptId>
REFUND:<refundId>
```

If the same source is delivered twice:

``` text
first -> posts
second -> returns/reuses existing posting
```

Never double-post.

Use the existing outbox/event infrastructure where available. Do not
introduce a second messaging architecture unnecessarily.

------------------------------------------------------------------------

# 12. Party Accounting Model

Create a common accounting-party abstraction linked to existing entities
without changing their business models:

``` text
AccountingParty
  id
  partyType
  partyReferenceId
  nameSnapshot
  currency
  receivableAccountId
  payableAccountId
  status
```

Party types:

``` text
CUSTOMER
MANUFACTURER
MARKETING_PARTNER
DELIVERY_PARTNER
OTHER
```

A party may have both receivable and payable balances.

Never assume a party can only be on one side.

------------------------------------------------------------------------

# 13. Accounts Receivable

Implement a true AR subledger.

Support:

``` text
invoice/bill
party
original amount
allocated amount
remaining amount
due date
currency
status
source transaction
```

Statuses:

``` text
OPEN
PARTIALLY_PAID
PAID
OVERDUE
WRITTEN_OFF
CANCELLED
```

Support bill-wise allocation, partial payments, credits/debits, advances
and ageing.

------------------------------------------------------------------------

# 14. Accounts Payable

Implement a true AP subledger for:

``` text
Manufacturer
Marketing Partner
Delivery Partner
Other legitimate suppliers/service providers
```

Support:

``` text
bill
original amount
paid amount
balance
due date
allocation
partial payment
credit/debit adjustments
settlement
ageing
```

------------------------------------------------------------------------

# 15. Bill-Wise Tracking

Every receivable/payable must be traceable to:

``` text
source invoice/bill
party
source transaction
due date
original amount
payments/receipts allocated
remaining balance
```

Do not maintain only a mutable running balance.

------------------------------------------------------------------------

# 16. Initial Cash/Bank Readiness Gate

Mandatory business requirement:

> Before the system permits accounting-dependent operations, at least
> one active Bank or Cash-in-Hand account must exist.

Also require:

``` text
Chart of Accounts initialized
required system accounts configured
open accounting period exists
```

Create an accounting readiness service/guard, conceptually:

``` text
AccountingReadinessService.assertReady()
```

The guard must be applied at the appropriate API/security boundary.

Do not scatter accounting checks through unrelated business services.

Required gate coverage includes, at minimum:

``` text
product creation
sales
finance/accounting operations
```

The customer website and unrelated functionality must not be
accidentally blocked.

------------------------------------------------------------------------

# 17. Cash, Bank and Petty Cash

Implement:

``` text
Cash Account
Bank Account
Petty Cash Account
```

Support:

``` text
cash receipts
cash payments
bank receipts
bank payments
petty cash in/out
replenishment
bank reconciliation foundation
```

Do not permit cash/bank payments to exceed available balance unless the
system explicitly supports a configured overdraft/credit facility.

Balance checks must be server-side and transaction-safe.

For concurrent payments use appropriate DB
transactions/locks/conditional updates.

------------------------------------------------------------------------

# 18. Payments and Receipts

Create centralized accounting payment/receipt services.

Payment must contain:

``` text
party
source
amount
currency
financial account
reference
idempotency key
date
```

Receipt similarly.

Support allocation:

``` text
Payment
  -> Bill A
  -> Bill B
  -> Credit Note
  -> Advance
```

Support:

``` text
partial allocation
full allocation
overpayment
unallocated amount
```

Never simply reduce a party balance without an allocation record.

------------------------------------------------------------------------

# 19. Sales Accounting

Inspect the existing sales/payment/tax architecture before defining
exact entries.

Typical credit sale concept:

``` text
Dr Accounts Receivable
    Cr Sales Revenue
    Cr Tax Payable (if applicable)
```

Cash/bank sale:

``` text
Dr Cash/Bank
    Cr Sales Revenue
    Cr Tax Payable
```

COGS/inventory:

``` text
Dr COGS
    Cr Inventory
```

Do not blindly apply these entries if the project's
ownership/consignment/payment model differs. Document the final rule.

------------------------------------------------------------------------

# 20. Manufacturer COGS --- Critical Requirement

Manufacturer-assigned and manufacturer-approved COGS must be
distinguished:

``` text
assigned COGS
approved COGS
posted COGS
```

Only approved COGS can become the accounting basis.

The price payable to the manufacturer is, under the stated business
requirement, based on:

``` text
approved manufacturer COGS × actual units sold
```

not:

``` text
retail price
inventory quantity merely received
marketing price
delivery fee
```

Example:

``` text
approved COGS = 500
sold quantity = 3
manufacturer sale-based payable = 1,500
```

However, before implementation, inspect the actual inventory
ownership/consignment/purchase model. If inventory is owned by the
company versus consigned by the manufacturer, the journal architecture
can differ materially. Ask if the repository cannot establish the
answer.

------------------------------------------------------------------------

# 21. Manufacturer Payable

Normal sale flow should create manufacturer payable only according to
the approved commercial/accounting rule.

Track separately:

``` text
COGS payable
settlement fees
returns/credits
debits
payments
receivables
offsets
```

Manufacturer statement must show:

``` text
Opening balance
COGS payable
Approved settlements
Credits/debits
Payments
Receivables
Offsets
Closing balance
```

------------------------------------------------------------------------

# 22. Manufacturer Receivable

Support manufacturer receivables where they occur:

``` text
refunds
reimbursements
manufacturer credits
overpayments
approved debit/credit adjustments
```

A manufacturer can simultaneously have AP and AR balances.

Do not force everything into AP.

------------------------------------------------------------------------

# 23. Expiry / Clearance / Settlement Fees

When inventory expires or the manufacturer requires inventory clearance,
a settlement fee may become payable.

Do NOT automatically post a fee simply because a product expired.

Create an explicit approved settlement transaction:

``` text
ManufacturerSettlement
  id
  manufacturerId
  type
  sourceType
  sourceId
  amount
  currency
  approvalStatus
  approvedBy
  approvedAt
  journalEntryId
```

Types may include:

``` text
EXPIRED_INVENTORY
CLEARANCE
RETURN_SETTLEMENT
COMMERCIAL_ADJUSTMENT
OTHER_APPROVED_SETTLEMENT
```

The exact debit/credit treatment must be based on the commercial
arrangement and accounting policy. If unclear, stop and ask.

------------------------------------------------------------------------

# 24. Sales Returns

Returns must reverse the correct accounting effects and link to the
original sale whenever possible.

Typical concepts:

``` text
Dr Sales Return / Contra Revenue
Dr Tax Reversal where applicable
Cr Customer AR/Cash
```

Inventory return:

``` text
Dr Inventory
Cr COGS
```

The returned inventory must use the appropriate original recognized
cost, not an arbitrary current retail price.

Never implement a return by deleting the original sale.

------------------------------------------------------------------------

# 25. Exchanges

An exchange is not:

``` text
delete old sale
create new sale
```

It must preserve:

``` text
original sale
return component
new sale component
price difference
tax difference
inventory movement
old COGS reversal
new COGS
AR/refund difference
```

If new item costs more:

``` text
additional receivable/payment
```

If new item costs less:

``` text
refund/credit
```

------------------------------------------------------------------------

# 26. Marketing Partner Accounting

Current gap:

> Marketing Partners do not currently have proper accounting linkage.

Create accounting linkage for every Marketing Partner without changing
the Marketing Partner's operational business model.

Support:

``` text
commission expense
partner payable
partner receivable
adjustments
advances
payments
receipts
settlements
statement
```

Example commission posting:

``` text
Dr Marketing Commission Expense
Cr Marketing Partner Payable
```

When paid:

``` text
Dr Marketing Partner Payable
Cr Bank/Cash
```

Do not invent the commission basis. Inspect the repository and ask if it
is not defined.

------------------------------------------------------------------------

# 27. Delivery Partner Accounting

Create accounting linkage for each delivery partner.

Track separately:

``` text
COD receivable
Delivery charge payable
Return/failure charges
Other approved adjustments
Payments
Receipts
Settlements
```

------------------------------------------------------------------------

# 28. Delivery COD

If the delivery partner collects COD from customers, the collected COD
represents money owed to the business until remitted.

Conceptually:

``` text
Dr Delivery Partner Receivable
Cr appropriate sales/customer settlement clearing account
```

The exact source entry must be reconciled with the project's
sales/payment model.

COD must be traceable from:

``` text
customer order
-> delivery
-> COD collection
-> delivery partner statement
-> settlement
-> bank/cash receipt
```

------------------------------------------------------------------------

# 29. Delivery Charge

Delivery fees owed to the delivery partner must be recorded separately.

Typical concept:

``` text
Dr Delivery Expense
Cr Delivery Partner Payable
```

Do not destroy the gross AP/AR information by immediately storing only a
net amount.

------------------------------------------------------------------------

# 30. Delivery Net Position

The UI must show:

``` text
COD Receivable
- Delivery Charges Payable
+/- Adjustments
= Net Receivable / Net Payable
```

Example:

``` text
COD receivable:     100,000
Delivery payable:    12,000
Net receivable:      88,000
```

If payable exceeds COD:

``` text
COD receivable:       8,000
Delivery payable:    12,000
Net payable:           4,000
```

Always preserve gross balances and show the net position separately.

------------------------------------------------------------------------

# 31. Settlements

Build a reusable settlement engine for:

``` text
Manufacturer
Marketing Partner
Delivery Partner
```

A settlement can contain:

``` text
opening balance
receivables
payables
credits
debits
adjustments
payments
receipts
offsets
closing balance
```

Support controlled AR/AP netting for the same party where business/legal
policy permits it.

Never overwrite the underlying gross subledger balances.

------------------------------------------------------------------------

# 32. AR/AP Ageing

Implement configurable ageing buckets, for example:

``` text
Current
1-30
31-60
61-90
91-180
180+
```

Reports:

``` text
Receivable Ageing
Payable Ageing
Party Ageing
Bill Ageing
```

------------------------------------------------------------------------

# 33. Credit Notes / Debit Notes

Support controlled adjustments for:

``` text
customer
manufacturer
marketing partner
delivery partner
```

Every note must contain:

``` text
original source/reference
reason
amount
approval if required
journal entry
AR/AP effect
audit trail
```

------------------------------------------------------------------------

# 34. Inventory Accounting

Keep operational stock quantity separate from financial valuation.

Support accounting integration for:

``` text
inventory receipt
inventory issue
COGS
return
transfer where financially relevant
write-off
expiry
clearance
adjustment
```

Do not rewrite operational inventory algorithms merely to produce
accounting entries.

------------------------------------------------------------------------

# 35. Expired Inventory / Write-off

Do not silently change inventory value.

Use controlled transactions such as:

``` text
Dr Inventory Write-off Expense
Cr Inventory
```

or an approved manufacturer settlement model where the manufacturer
bears the financial obligation.

Every write-off/settlement needs:

``` text
reason
quantity
cost
source inventory
approval
user
date
journal reference
```

------------------------------------------------------------------------

# 36. Financial Statements

Implement reports derived from the GL/COA, not duplicated business
calculations.

Required:

``` text
Trial Balance
Profit & Loss
Balance Sheet
Cash Flow
Fund Flow
```

Trial Balance must balance.

Balance Sheet must satisfy:

``` text
Assets = Liabilities + Equity
```

Cash Flow must reconcile:

``` text
Opening Cash/Bank
+/- Net Cash Movement
= Closing Cash/Bank
```

------------------------------------------------------------------------

# 37. General Ledger / Books

Implement:

``` text
General Ledger
Account Ledger
Party Ledger
Journal Register
Day Book
Cash Book
Bank Book
```

All should drill down:

``` text
report -> account/party -> journal -> source transaction
```

------------------------------------------------------------------------

# 38. Cost Centres

Where compatible with the existing architecture, support:

``` text
cost centre
cost category
allocation
```

Possible dimensions:

``` text
warehouse
region
marketing
distribution
delivery
branch
channel
```

Do not invent organizational dimensions without inspecting the
repository.

------------------------------------------------------------------------

# 39. Bank Reconciliation

Build an internal bank reconciliation model:

``` text
BankTransaction
BankStatement
Reconciliation
```

Support:

``` text
import
matching
unmatched items
reconciled status
reconciliation date
reconciled by
```

Do not require external banking APIs if the project does not have them.

------------------------------------------------------------------------

# 40. Audit Trail

Record for accounting mutations:

``` text
who
when
what
source
reason
reference
```

Never log:

``` text
credentials
secrets
payment credentials
sensitive authentication tokens
```

Posted journals are immutable.

Corrections use reversals/adjustments.

------------------------------------------------------------------------

# 41. Reconciliation Engine

Implement automated checks:

``` text
GL debits = GL credits
AR subledger = AR control account
AP subledger = AP control account
Manufacturer subledger = manufacturer control account
Marketing subledger = marketing control account
Delivery subledger = delivery control account
Cash book = cash GL
Bank book = bank GL
Inventory valuation = inventory GL
Assets = Liabilities + Equity
Opening cash + movement = closing cash
```

Expose differences clearly.

Never hide reconciliation failures.

------------------------------------------------------------------------

# 42. Accounting Health Dashboard

Show:

``` text
Ledger balanced
Trial Balance balanced
Balance Sheet balanced
AR reconciled
AP reconciled
Inventory reconciled
Cash reconciled
Bank reconciled
Unposted events
Failed accounting events
Suspense balance
Unallocated receipts
Unallocated payments
Overdue AR
Overdue AP
```

------------------------------------------------------------------------

# 43. Suspense Account

If needed, implement a controlled suspense account.

Every suspense balance must have:

``` text
source
reason
reference
owner/status
```

Outstanding suspense must be visible in accounting health reports.

------------------------------------------------------------------------

# 44. Approval Controls

Support approval workflows for high-risk accounting operations:

``` text
manual journal
large settlement
write-off
manufacturer settlement fee
inventory write-off
opening balance
period close/reopen
```

Do not invent approval thresholds. Make them configurable or ask if the
business rule is unknown.

------------------------------------------------------------------------

# 45. Accounting Permissions

Integrate with the existing authorization system.

Suggested permissions:

``` text
ACCOUNTING_VIEW
ACCOUNTING_CREATE
ACCOUNTING_POST
ACCOUNTING_ADJUST
ACCOUNTING_REVERSE
ACCOUNTING_SETTLE
ACCOUNTING_RECONCILE
ACCOUNTING_CLOSE_PERIOD
ACCOUNTING_MANAGE_COA
ACCOUNTING_VIEW_AUDIT
```

Do not create a parallel authorization system.

------------------------------------------------------------------------

# 46. Accounting APIs

Follow existing project conventions. Potential capabilities include:

``` text
accounts
ledger
journals
receivables
payables
ageing
payments
receipts
settlements
reversals
cash
bank
petty cash
bank reconciliation
trial balance
P&L
balance sheet
cash flow
fund flow
reconciliation health
```

Do not blindly copy endpoint names. Fit them into the existing
architecture.

------------------------------------------------------------------------

# 47. UI

Create a professional ERP-style Accounting area:

``` text
Accounting
├── Dashboard
├── Chart of Accounts
├── Journals
├── General Ledger
├── Receivables
├── Payables
├── Settlements
├── Cash
├── Bank
├── Petty Cash
├── Inventory Accounting
├── COGS
├── Financial Statements
│   ├── Trial Balance
│   ├── Profit & Loss
│   ├── Balance Sheet
│   ├── Cash Flow
│   └── Fund Flow
├── Reconciliation
├── Cost Centres
└── Audit / Accounting Health
```

Use the existing design system.

Accounting UI must prioritize:

``` text
debit/credit visibility
gross vs net values
outstanding balances
ageing
status
reconciliation warnings
drill-down
filters
export
```

------------------------------------------------------------------------

# 48. Receivable/Payable UI

Receivable screen:

``` text
Total Receivable
Current
Due Soon
Overdue
Collected
Outstanding
```

Columns:

``` text
Party
Bill
Date
Due Date
Original
Paid
Outstanding
Age
Status
```

Payable screen should provide the equivalent.

Party-specific screens must clearly distinguish:

``` text
Receivable
Payable
Net Position
```

------------------------------------------------------------------------

# 49. Manufacturer Accounting UI

Show:

``` text
Approved COGS
Units Sold
COGS Payable
Settlement Fees
Returns/Credits
Payments
Receivable
Payable
Net Balance
```

------------------------------------------------------------------------

# 50. Marketing Partner Accounting UI

Show:

``` text
Commission
Payable
Receivable
Adjustments
Payments
Receipts
Settlements
Net Balance
```

------------------------------------------------------------------------

# 51. Delivery Partner Accounting UI

Show:

``` text
COD Receivable
Delivery Charges Payable
Other Charges
Adjustments
Payments
Receipts
Net Receivable/Payable
```

Always show both gross sides before the net.

------------------------------------------------------------------------

# 52. Reporting Requirements

At minimum implement:

### Core accounting

``` text
Chart of Accounts
General Ledger
Account Ledger
Journal Register
Day Book
Trial Balance
```

### Financial statements

``` text
P&L
Balance Sheet
Cash Flow
Fund Flow
```

### AR

``` text
AR Summary
AR Detail
AR Ageing
Party Statement
Customer Statement
Manufacturer Receivable
Marketing Receivable
Delivery Receivable
```

### AP

``` text
AP Summary
AP Detail
AP Ageing
Manufacturer Payable
Marketing Payable
Delivery Payable
```

### Cash/bank

``` text
Cash Book
Bank Book
Petty Cash
Bank Reconciliation
```

### Inventory/COGS

``` text
Inventory Valuation
COGS Report
Stock Profitability
Write-off
Expiry/Clearance Settlement
```

------------------------------------------------------------------------

# 53. Historical Migration

Because the existing accounting/finance implementation is being
replaced:

1.  Back up existing data.
2.  Map old accounting tables to new accounting structures.
3.  Identify duplicates/inconsistencies.
4.  Migrate recoverable historical accounting data.
5.  Preserve source references.
6.  Reconcile migrated balances.
7.  Produce a migration report.
8.  Do not silently discard financial history.
9.  Do not fabricate missing accounting records.

If historical records cannot be safely migrated, stop and produce a
manual reconciliation/migration list.

Before and after migration verify:

``` text
Trial Balance
AR
AP
Cash
Bank
Inventory
Manufacturer balances
Marketing balances
Delivery balances
```

------------------------------------------------------------------------

# 54. Iterative Development Model

Do not implement the entire system in one pass.

Use these iterations.

## Iteration 0 --- Discovery

-   inspect whole repository
-   map current accounting
-   map dependencies
-   identify existing accounting defects
-   create architecture report

Checklist:

``` text
[ ] Repository inspected
[ ] Accounting mapped
[ ] Finance mapped
[ ] Sales mapped
[ ] COGS mapped
[ ] Inventory mapped
[ ] Manufacturer mapped
[ ] Marketing mapped
[ ] Delivery mapped
[ ] Payment mapped
[ ] Reports mapped
[ ] Migration risk documented
[ ] No unrelated code changed
```

## Iteration 1 --- Requirements and Gap Analysis

Create current-vs-target matrix based on TallyPrime-style capabilities
and this project's business model.

Checklist:

``` text
[ ] Missing features identified
[ ] Incorrect current features identified
[ ] Accounting rules documented
[ ] Ambiguities documented
[ ] Migration requirements documented
```

## Iteration 2 --- Domain and ERD

Design:

``` text
COA
Journal
Ledger
AR
AP
Bill
Payment
Receipt
Allocation
Settlement
Party
Period
Audit
Reconciliation
```

Checklist:

``` text
[ ] Double-entry model
[ ] Subledgers
[ ] Party linkage
[ ] Settlement model
[ ] Idempotency
[ ] Audit
[ ] Concurrency
```

## Iteration 3 --- Database Foundation

Implement migrations, constraints, indexes and system account seeding.

Checklist:

``` text
[ ] Reversible migration
[ ] Constraints
[ ] Indexes
[ ] Unique idempotency constraints
[ ] Journal balance constraints
[ ] No unrelated schema damage
```

## Iteration 4 --- Replace Existing Accounting Engine

Remove/restructure the old accounting implementation only after its
dependencies are understood.

There must be exactly one authoritative posting engine.

Checklist:

``` text
[ ] Old engine mapped
[ ] Migration strategy complete
[ ] New engine active
[ ] Duplicate paths removed
[ ] Historical data preserved
[ ] Reconciled
```

## Iteration 5 --- Core Ledger

Implement:

``` text
posting engine
journal
journal lines
GL
reversal
period validation
idempotency
money precision
```

Checklist:

``` text
[ ] Debit=credit enforced
[ ] Transactional
[ ] Idempotent
[ ] Immutable
[ ] Reversal
[ ] Audit
[ ] Concurrency safe
```

## Iteration 6 --- AR/AP

Implement bill-wise AR/AP, ageing, allocations, partial payments, notes
and party statements.

Checklist:

``` text
[ ] Customer AR
[ ] Manufacturer AR/AP
[ ] Marketing AR/AP
[ ] Delivery AR/AP
[ ] Ageing
[ ] Allocation
[ ] Reconciliation
```

## Iteration 7 --- Cash/Bank/Petty Cash

Checklist:

``` text
[ ] Cash
[ ] Bank
[ ] Petty cash
[ ] Payment
[ ] Receipt
[ ] Balance validation
[ ] Concurrency protection
[ ] Reconciliation
```

## Iteration 8 --- Accounting Readiness Gate

Implement centralized readiness check for required
product/sales/finance/accounting entry points.

Checklist:

``` text
[ ] Bank/Cash required
[ ] COA initialized
[ ] Period open
[ ] Product gate
[ ] Sales gate
[ ] Finance gate
[ ] Customer unaffected
```

## Iteration 9 --- Sales + COGS

Integrate approved manufacturer COGS, revenue, tax, AR/cash, inventory
and manufacturer payable according to documented ownership model.

Checklist:

``` text
[ ] Revenue
[ ] Tax
[ ] AR/cash
[ ] Approved COGS
[ ] Inventory valuation
[ ] Manufacturer payable
[ ] Idempotency
[ ] Reconciliation
```

## Iteration 10 --- Returns + Exchanges

Checklist:

``` text
[ ] Original-sale linkage
[ ] Return revenue reversal
[ ] Tax reversal
[ ] COGS reversal
[ ] Inventory restoration
[ ] Refund
[ ] Exchange price difference
[ ] No duplicate posting
```

## Iteration 11 --- Manufacturer Accounting

Implement:

``` text
COGS payable
manufacturer receivable
settlement
expiry
clearance
approved settlement fee
payments
offsets
statement
```

Checklist:

``` text
[ ] Party linkage
[ ] Approved COGS
[ ] Sold quantity basis
[ ] Payable
[ ] Receivable
[ ] Settlement
[ ] Expiry
[ ] Clearance
[ ] Approval
[ ] Payment
[ ] Statement
```

## Iteration 12 --- Marketing Partner Accounting

Implement:

``` text
party linkage
commission
payable
receivable
adjustments
settlement
payment
receipt
statement
```

Checklist:

``` text
[ ] Every partner linked
[ ] Commission rule mapped
[ ] Payable
[ ] Receivable
[ ] Adjustments
[ ] Settlement
[ ] Statement
[ ] Reconciliation
```

## Iteration 13 --- Delivery Partner Accounting

Implement:

``` text
COD receivable
delivery payable
other charges
settlement
net position
```

Checklist:

``` text
[ ] Party linkage
[ ] COD
[ ] Delivery charges
[ ] Gross values retained
[ ] Net settlement
[ ] Partial settlement
[ ] Statement
[ ] Reconciliation
```

## Iteration 14 --- Financial Statements

Implement:

``` text
Trial Balance
P&L
Balance Sheet
Cash Flow
Fund Flow
```

Checklist:

``` text
[ ] Trial Balance balanced
[ ] P&L correct
[ ] Balance Sheet balances
[ ] Cash Flow reconciles
[ ] Drill-down
[ ] Date filters
```

## Iteration 15 --- Reconciliation

Implement automated reconciliation between GL and every important
subledger.

Checklist:

``` text
[ ] AR vs GL
[ ] AP vs GL
[ ] Manufacturer vs GL
[ ] Marketing vs GL
[ ] Delivery vs GL
[ ] Inventory vs GL
[ ] Cash vs GL
[ ] Bank vs GL
[ ] Differences visible
```

## Iteration 16 --- Accounting UI

Implement dashboard, COA, journals, GL, AR/AP, settlements, cash/bank,
financial statements, reconciliation and audit views.

Checklist:

``` text
[ ] ERP-style UI
[ ] Responsive
[ ] Drill-down
[ ] Filters
[ ] Export
[ ] Permission handling
[ ] Reconciliation warnings
```

## Iteration 17 --- Audit and Controls

Implement:

``` text
audit trail
approval workflow
manual journal restrictions
period close
reversal
write-off
settlement approval
```

Checklist:

``` text
[ ] Audit
[ ] Immutable posted entries
[ ] Reversal
[ ] Period close
[ ] Permissions
[ ] Approvals
```

## Iteration 18 --- Full Accounting Tests

Implement unit, integration, E2E, migration, invariant and concurrency
tests.

Test:

``` text
sales
returns
exchange
COGS
manufacturer
marketing
delivery
AR
AP
payments
receipts
settlements
refunds
reversals
period close
```

## Iteration 19 --- Failure and Recovery

Simulate:

``` text
duplicate event
retry
consumer crash
database retry
partial failure
concurrent payment
concurrent settlement
duplicate payment
duplicate receipt
```

Verify no duplicate or partial financial posting.

## Iteration 20 --- Final Reconciliation and Audit

Produce:

``` text
docs/accounting/final-reconciliation-report.md
docs/accounting/final-accounting-audit.md
```

Verify all key balances and financial statements.

------------------------------------------------------------------------

# 55. Mandatory Iteration Checkpoint

After every iteration, output exactly this style of report:

``` text
========================================
ACCOUNTING ITERATION CHECKPOINT
========================================

Iteration:
Objective:

Files inspected:
Files changed:
Database changes:
API changes:
UI changes:

Business layer touched: YES / NO
If YES, STOP and explain why.

Accounting invariants verified:
Security controls verified:
Migration status:

Tests executed:
Tests passed:
Tests failed:

Regression:
Admin: PASS/FAIL
Manufacturer: PASS/FAIL
Marketing: PASS/FAIL
Customer: PASS/FAIL

Reconciliation status:
Known issues:
Known accounting assumptions:

Next iteration:
```

Do not silently proceed after critical failures.

------------------------------------------------------------------------

# 56. Required Tests / Invariants

At minimum test:

``` text
Every journal balances.
No duplicate source creates duplicate journal.
Posted journal is immutable.
Reversal cannot be duplicated.
Closed period rejects posting.
AR allocation cannot exceed open AR.
AP allocation cannot exceed open AP.
Payment cannot exceed available cash/bank unless explicitly supported.
Concurrent payments cannot create an invalid negative balance.
Manufacturer COGS uses approved value.
Manufacturer payable uses sold quantity according to business rule.
Delivery COD remains traceable until settlement.
Delivery charges remain separately visible.
Marketing Partner has AR/AP linkage.
Returns reverse correct accounting.
Exchanges preserve original and replacement financial effects.
Trial Balance balances.
Balance Sheet balances.
Cash Flow reconciles.
All subledgers reconcile to control accounts.
```

------------------------------------------------------------------------

# 57. Final Regression Matrix

  Area                Expected
  ------------------- -----------------------------------------------------
  Admin               Existing functionality preserved
  Manufacturer        Existing functionality preserved
  Marketing Partner   Existing functionality preserved
  Customer            Existing functionality preserved
  Authentication      Unchanged
  Authorization       Unchanged except accounting permissions
  Notifications       Unchanged
  Product             Only accounting-readiness gate where required
  Sales               Existing business behavior + accounting posting
  Inventory           Existing business behavior + accounting integration
  Accounting          New authoritative system
  Finance             Replaced by new accounting subsystem
  Reports             New accounting reports
  Business layer      Not changed

------------------------------------------------------------------------

# 58. Stop Conditions / Questions

Stop and ask before implementation if the repository cannot establish:

1.  inventory ownership model
2.  manufacturer payable trigger
3.  approved COGS lifecycle
4.  manufacturer expiry/clearance responsibility
5.  marketing commission basis and recognition point
6.  delivery COD settlement model
7.  delivery charge timing
8.  customer revenue recognition timing
9.  tax rules
10. fiscal year/period rules
11. inventory valuation method
12. historical accounting migration requirements
13. whether multi-currency is required
14. whether negative bank balances/overdrafts are supported

Do not invent financial policy.

------------------------------------------------------------------------

# 59. Final Definition of Done

The implementation is complete only when:

``` text
[ ] Existing accounting implementation replaced safely
[ ] One authoritative double-entry posting engine exists
[ ] Chart of Accounts exists
[ ] Accounting periods exist
[ ] General Ledger exists
[ ] AR exists
[ ] AP exists
[ ] Bill-wise tracking exists
[ ] Ageing exists
[ ] Customer accounting remains compatible
[ ] Manufacturer accounting linked
[ ] Marketing Partner accounting linked
[ ] Delivery Partner accounting linked
[ ] Approved manufacturer COGS integrated
[ ] Manufacturer payable integrated
[ ] Manufacturer receivable supported
[ ] Expiry/clearance settlement supported
[ ] Sales accounting integrated
[ ] Sales return integrated
[ ] Exchange integrated
[ ] COD receivable integrated
[ ] Delivery charges payable integrated
[ ] Net settlement supported
[ ] Cash implemented
[ ] Bank implemented
[ ] Petty cash implemented
[ ] Payments implemented
[ ] Receipts implemented
[ ] Settlement engine implemented
[ ] Reconciliation implemented
[ ] Trial Balance implemented
[ ] P&L implemented
[ ] Balance Sheet implemented
[ ] Cash Flow implemented
[ ] Fund Flow implemented
[ ] Cost centres implemented where appropriate
[ ] Audit trail implemented
[ ] Period close implemented
[ ] Reversal implemented
[ ] Idempotency implemented
[ ] Concurrency controls implemented
[ ] Migration verified
[ ] No duplicate accounting engine remains
[ ] No unrelated business logic changed
[ ] Full regression passed
[ ] Final reconciliation passed
```

------------------------------------------------------------------------

# 60. Final Instruction to the Coding Agent

**Do not start coding immediately.**

First inspect the entire repository and produce the accounting
architecture/gap analysis.

Then implement one iteration at a time:

``` text
inspect
-> plan
-> implement
-> test
-> reconcile
-> review diff
-> checkpoint
-> next iteration
```

The final architecture must be a serious ERP-grade financial subsystem
with:

``` text
double-entry accounting
subledgers
AR/AP
bill-wise accounting
settlements
COGS
inventory accounting
cash
bank
petty cash
financial statements
cash flow
reconciliation
audit trail
period control
idempotency
concurrency safety
```

It must fit the existing JavaScript project rather than forcing a new
unrelated architecture.

**Optimize for accounting correctness, auditability, safe migration and
minimal change surface---not implementation speed.**
