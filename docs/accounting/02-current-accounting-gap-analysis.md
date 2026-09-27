# Accounting Discovery 02: Gap Analysis And Risks

**Snapshot:** 2026-09-28  
**Status:** Findings for requirements/design review; implementation has not started.

## Priority Findings

### P0: Multiple financial sources of truth

The project stores overlapping financial facts in GL journals, cached `Account.currentBalance`, treasury `FinancialAccount.currentBalance`, `CashTransaction`, generic mutable AP/AR, and operational models such as orders, expenses, returns, assets, manufacturer inventory, delivery settlement and partner settlements. The `/api/finance/statements` and tax report recompute values from operational tables, while accounting endpoints report journal lines. These representations are not reconciled as one authoritative ledger.

**Risk:** an admin can see different cash, payable, COGS, profit, VAT or delivery values depending on screen/report.

### P0: Requested manufacturer payable trigger and cost basis are not implemented

The sales poster recognizes COGS at order creation, before delivery outcome, by reading mutable global `Product.costPrice`. The order snapshot captures selling prices but not a manufacturer-approved cost snapshot. Manufacturer agreed cost is per manufacturer/product in `ManufacturerInventory`; the finance summary may use current agreed/proposed values and increments calculated payable for orders independent of delivered status.

**Risk:** premature COGS, wrong manufacturer attribution, retroactive cost changes, and payable values for undelivered or returned orders. The requested trigger is a delivery-state event requiring explicit return/finality rules.

The manufacturer summary compounds this mismatch: it computes delivered receivable as sales less COGS and commission, also records COGS in payable, then subtracts payable from receivable for net. The resulting display subtracts the same COGS twice.

### P0: Business success can commit without accounting success

Several controllers persist operational changes and call GL posting using `.catch()` in the background. Expense posting also catches/logs internal errors. The source mutation can return success with no matching journal. Financial and delivery paths often update multiple models in separate transactions.

**Risk:** invisible unposted events, partial cash/AP/asset mutations, delayed or permanently missing journals. A retry may produce duplicate or inconsistent results.

### P0: Money precision is binary floating point

Schema financial values primarily use Prisma `Float`, and posting uses JS `Number` followed by decimal rounding. Sum operations can accrue binary rounding differences; two-decimal rounding does not provide deterministic multi-currency or tax allocation semantics.

**Risk:** residual imbalances, inconsistent line/invoice/tax totals, and unsupported currency precision. There is no documented rounding mode or amount scale.

### P0: Idempotency/concurrency gaps in posting

`postJournalEntry` checks for an existing entry before its write transaction. Concurrent callers can both pass the check; unique indexes may reject one, but the engine does not consistently resolve/reuse the winner. Journal numbers use `count + 1`, which is race-prone. Supplier payment keys include `Date.now()`, so a retry is a new key. Other keys based on amount/period may collapse distinct events or permit changed-amount reposts.

**Risk:** duplicate journals, failed business operations on uniqueness races, journal-number collisions, or inability to safely retry.

### P1: AP/AR are not bill-wise subledgers

AP/AR store mutable totals and JSON histories with free-text payee/payer names. They have no common party FK, bill allocation rows, payment/receipt entities, source idempotency key, currency, or direct control-account reconciliation. Customer receivables, manufacturer obligations, marketing settlements, NCM COD/fees and vendor obligations are not consistently represented.

**Risk:** partial payments, advances, offsets, statements and ageing cannot be audited or reconstructed reliably; same real party may appear under multiple names.

### P1: Customer payment and NCM delivery paths disagree

The explicit `cashReceived` route posts payment accounting after checking order `status=Delivered`. NCM delivery processing independently sets `Order.payment=true` on delivered but no payment poster was found in that status transition. A Boolean cannot identify multiple payments, gateway fees, refunds, split tender or a durable receipt.

**Risk:** delivered COD can appear paid in orders without a matching receipt journal/treasury movement; reports may treat expected COD as collected.

### P1: Returns do not reverse all financial effects

Customer return processing updates the return, inventory and cash/AP, then posts a return journal asynchronously. The GL caller does not pass `restockedInventoryCost`, so the poster’s inventory/COGS reversal branch is not reached by the inspected controller. Supplier returns have no matching GL poster call. NCM RTO and customer returns are different models and flows.

**Risk:** overstated COGS/inventory, inconsistent refund liabilities, unreconciled VAT and duplicate/omitted reversal accounting.

### P1: Reports are not ledger-derived and use mixed recognition rules

`/api/finance/statements` derives P&L, balance sheet and cash flow from orders, current product costs, current assets, treasury balances and generic AP/AR. It is not a GL report. `/api/finance/tax-report` derives VAT from non-cancelled orders, current `Product.costPrice`, JSON shipment/returns and expenses. Some rates are hardcoded (13% VAT, 25% corporate tax) despite `TaxConfiguration`/`TaxFilingRecord` models. Accounting-side real-time statements separately query journals.

**Risk:** reports can change after master-data edits, include orders at the wrong status/period, and disagree with posted journals. Tax outputs must not be represented as legal filing figures until policies and source controls are verified.

### P1: Inventory ownership and valuation are unclear

Both global `Product.stockQuantity`/`costPrice` and per-manufacturer `ManufacturerInventory.quantity`/`reservedQty`/`agreedCostPrice` exist. Customer returns mutate global stock. Order allocation reserves manufacturer inventory. Current GL sales posting credits global merchandise inventory using global product cost. The prompt’s delivered-triggered payable suggests manufacturer-owned/consigned goods until delivery, but this legal/economic ownership model is not confirmed.

**Risk:** recording an inventory asset and a manufacturer payable at incompatible lifecycle stages, double-counting inventory/COGS, and wrong return treatment.

### P1: Delivery/marketing settlements are operational only

`DeliveryFinancialSettlement` tracks expected/collected COD, fees, status and a nullable `journalEntryId`, but no journal adapter was found. `MarketingPartnerSettlement` tracks CPA amount/payment status but no GL link or common party subledger was found.

**Risk:** COD receivable, carrier fees, marketing expense and partner payable can be absent from the ledger or only visible in operational dashboards.

### P2: Accounting period, COA and audit controls need hardening

- COA seeding only runs when account count is zero; a partially seeded COA is not repaired/validated.
- Server startup calls `ensureStandardChartOfAccounts()` without awaiting it.
- `ensureFiscalYearAndPeriod` uses Gregorian calendar-year boundaries and creates periods lazily; this may not match Nepal fiscal-year requirements.
- Period states are only `OPEN/CLOSED` in schema, not the requested soft-close/lock lifecycle.
- Manual journal and reversal APIs need immutable audit attribution, approvals and closed-period controls.
- App-level debit/credit checks do not protect against direct DB writes or malformed transactions; no database-enforced journal balancing constraint exists.
- Cached account balances are incrementally updated; no robust repair/rebuild command was identified in this pass.

## Accounting Feature Coverage Matrix

| Capability | Current state | Discovery judgment |
| --- | --- | --- |
| COA | Hierarchy, fixed codes, seed-if-empty, create/update UI/API | Exists, but account mappings and partial-seed validation need redesign/configuration |
| Double-entry journal | Central poster with balance checks and transaction for journal+lines+cached account updates | Useful foundation, but amount precision, race/idempotency and transaction boundaries are insufficient |
| GL/trial balance | Journal-line reports exist | Need reconcile against operational balances and test filtered/date/period correctness |
| Reversal | Reciprocal journal and original status update | Original status update is outside reversal posting transaction; concurrent reversal/idempotency needs hardening |
| Periods | FiscalYear/AccountingPeriod created on demand, OPEN/CLOSED | Gregorian dates and weak period lifecycle; no explicit close checklist/audit/locking model |
| AR/AP | Basic mutable records, partial paid fields and JSON histories | Not a bill-wise party subledger; collection path not fully posted |
| Payments/receipts | Boolean order payment, CashTransaction and poster helpers | No canonical immutable payment/receipt objects, allocation model, provider refs or stable idempotency |
| Cash/bank | Treasury accounts and balance mutation; solvency checks exist | Separate state from GL; race-prone read/check/write patterns and multiple posting paths |
| Manufacturer payable/receivable | Finance summary computes balances; no manufacturer party subledger | Does not meet requested delivered/non-returned COGS rule |
| Marketing Partner AP/AR | CPA rate and settlement model | Settlement facts exist; accounting posting, party ledger and statements not found |
| Delivery COD/fees | NCM COD/fee and settlement lifecycle models/routes | Operational reconciliation exists; GL and party settlement posting not found |
| Inventory/COGS | Global product cost plus manufacturer proposed/agreed costs | No confirmed valuation/ownership policy or approved per-order cost snapshot; current sale poster uses wrong lifecycle for requested policy |
| Sales returns | Return/refund model, inventory, treasury/AP and GL helper | Incomplete COGS reversal in inspected call; no immutable link/allocation to original sale lines |
| Supplier purchases/returns | Shipment and supplier-return tables; purchase poster function | No purchase poster caller found; no supplier return posting found |
| Expenses | Multiple create paths, VAT fields, category mapping, reports | Duplicate flows; GL errors can be swallowed; edit/delete and tax source links missing |
| Fixed assets/depreciation | Asset records and purchase/depreciation poster helpers | Reports compute independently; operations can partially commit; disposal posting unclear |
| Loans/equity | Share and liability models plus selected poster calls | Separate investor/cap-table business model; incomplete unified party/subledger integration |
| Tax/VAT | Tax config/file records and report UI/API | Hardcoded assumptions and operational-data derivation; requires accountant/legal policy validation |
| Audit/immutability | Auth audit and delivery/card events; GL reversal status | Accounting-specific complete audit/edit trail and approvals not established |
| Reconciliation | GL subledger endpoint and delivery status dashboard | Need define and automate control-account/party/cash/bank/inventory/settlement reconciliation |

## Migration And Cutover Risks

The owner says there is currently no database data, but that has not been independently checked. The schema has numerous dated migrations, including several with generic/test-like names. Do not delete migrations or run `db push`, `migrate reset`, or seed scripts until the actual environment and migration status are confirmed. Even with empty business tables, a schema redesign still requires a clean, reproducible migration chain and safe deployment order.

Before retiring old tables/endpoints, verify all current UI/API callers. The existing `accountingEngine.test.js` writes to the configured DB and is not a safe default smoke test; future accounting tests should use isolated test databases/transactional fixtures or mocked clients.

## Owner-Confirmed Policy Decisions (2026-09-28)

- **Inventory ownership:** manufacturer owns supplied stock on consignment until sale/delivery.
- **Manufacturer COGS trigger:** recognize admin-approved agreed COGS at NCM `DELIVERED`; reverse/adjust with a linked event if the item is subsequently returned to the manufacturer.
- **Cost tax flag:** agreed COGS is VAT-inclusive at the current 13% rate; rates are configurable/effective-dated.
- **Revenue/VAT event:** recognize on delivery; rates are configurable/effective-dated.
- **Manufacturer commission:** additional to COGS only for manufacturer-originated phone/shop sales, and calculated as commission rate times gross profit. Exclude customer storefront sales and admin-entered social orders. Current source tags are `DIRECT_MANUFACTURER` + `PHONE_ORDER|HUB_VISIT`; excluded tags include `ONLINE_STORE` and `ADMIN_DIRECT`.
- **NCM accounting:** include COD receivable and carrier-fee payable gross; keep them outstanding until bank settlement is confirmed.
- **Marketing/NCM scope:** include Marketing Partner CPA and NCM accounting.
- **Currency/calendar:** NPR; Nepali fiscal year from Shrawan 1 to Ashadh end, Asia/Kathmandu.
- **Readiness:** gate accounting/finance actions only; never gate product/catalog or customer order operations on accounting readiness.

These decisions are recorded as requirements, not claims about existing code. The current code does not yet implement these triggers or exclusions.

## Owner-Confirmed Policies (2026-09-28)

Commission formula, approved-cost snapshot timing, input-VAT invoice evidence, VAT-inclusive customer prices, post-delivery reversal scope, CPA recognition per verified redemption, NPR/Nepali FY, finance-only readiness gate, and the estimate-only corporate-tax treatment are recorded in `00-current-architecture.md` and `03-implementation-plan-and-iteration-tracker.md`.

## Owner-Confirmed Acceptance Gate

The owner confirmed that manufacturer acceptance must be blocked unless every assigned line has an admin-approved agreed COGS. Direct manufacturer phone/shop orders also require an admin-approved commission rate. Proposed/global/default values must never be substituted. This is not true in the current business flow; the minimal acceptance/create-order hook is defined in `04-target-accounting-domain-model.md`.

## Design/Professional Review Items (Not Owner-Policy Blockers)

- Verify the authoritative Nepal BS calendar conversion and implement Shrawan 1 through Ashadh end using Asia/Kathmandu boundaries and tested conversion tables/library.
- Define minor-unit/decimal precision and deterministic rounding for NPR; use exact decimal arithmetic and confirm line-vs-document rounding with the accountant.
- Confirm whether zero opening balances are appropriate for a truly empty DB and use an auditable opening voucher for any balance entered later.
- Preserve/rebuild current assets, loans, equity/cap-table, operating expense, tax, delivery and Marketing CPA capabilities behind the single ledger unless the owner explicitly retires them.
- Keep the current 25% corporate-tax value as an estimate only; do not claim statutory filing correctness without accountant/tax-adviser sign-off.

Tax and commercial treatment should be approved by a qualified accountant/tax adviser; this report is technical discovery, not professional tax advice.