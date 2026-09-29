# Aama Clothings Accounting System Redesign

**Status:** Target design and implementation contract, as of 2026-09-29  
**Scope:** Accounting-owned schema, posting, subledgers, reporting, reconciliation, and accounting UI. Existing commerce, manufacturer, marketing, delivery, customer, and authentication services remain owners of their business facts. Accounting consumes their persisted records and existing hooks; required changes outside this boundary are documented, not silently made.  
**Professional review:** Not a legal opinion or a claim of NFRS/NAS or tax compliance. Nepal reporting framework, VAT/TDS treatment, invoice obligations, and company classification require confirmation by a Nepal-qualified accountant/tax adviser.

## 1. Executive Decision

The accounting implementation has a useful foundation: a Decimal-based double-entry poster, Nepali fiscal-period helper, account mappings, party/event models, delivery-time approved COGS snapshots, and document/allocation primitives. It is not yet one integrated accounting system. Treasury, legacy AP/AR, operational expenses, orders, delivery settlements, and the GL still overlap without complete transaction links. Several reports use different sources and recognition dates.

The target is one authoritative posted GL, with source-linked accounting events and bill-wise AP/AR documents. Treasury records actual money locations and must map to the GL; it is not a second profit-and-loss ledger. Posted-ledger reports must not silently substitute operational estimates. Missing or failed accounting must appear as `UNPOSTED`, `FAILED`, `INCOMPLETE`, or `NOT RECONCILED`, never as a fabricated balance.

Implementation is staged and additive. No migration is applied, database is reset, or historical transaction is replayed by this design document.

## 2. Scope And Business Boundaries

### Accounting may own

- Chart of accounts, account mapping, journal headers/lines, periods, posting, reversals, and accounting audit.
- Accounting parties, documents, AP/AR balances, allocations, tax evidence, opening-balance vouchers, treasury-to-GL configuration, bank/cash statement reconciliation, and accounting reports.
- Accounting adapters and APIs that convert already-persisted business facts into accounting effects.
- Admin accounting UI and the accounting portions of portal statements, subject to existing permissions and data scope.

### Other services remain owners of

Orders and order status; product catalogue and stock quantities; manufacturer assignments and cost approvals; card redemptions; NCM delivery callbacks and physical return state; customer identity; portal authentication/RBAC. Accounting must not rewrite these policies. If an accounting event cannot be derived safely from the current source record or hook, record the missing integration contract and do not create a guessed journal.

## 3. Verified Current State

| Area | Existing foundation | Verified limitation |
| --- | --- | --- |
| GL | `Account`, `JournalEntry`, `JournalLine`; Decimal(20,2); balanced posting and sequence; Nepali FY helper | Some adapters still use old float behavior; cached account balances are trusted by some reports; source-to-journal coverage is incomplete |
| Accounting events | `AccountingEvent` has unique idempotency key, payload/hash, status and error fields | Current poster creates/marks the event inside the posting transaction; a rolled-back failure leaves no durable failed attempt/outbox item |
| Parties | `AccountingParty` supports a shared party identity | Not every party-facing flow uses it, and portal summaries still calculate from current operational values |
| Documents | `AccountingDocument` and `AccountingAllocation` plus a Decimal subledger service | Normal finance settlement controllers continue to use legacy `AccountPayable` / `AccountReceivable`; new documents are not the sole AP/AR source |
| Treasury | `FinancialAccount` and `CashTransaction` hold separate balances and movement history | No FK maps a Treasury account to a GL account; opening balances, direct inflows and internal transfers do not consistently post journals |
| Delivery/COGS | Approved COGS snapshots are created at manufacturer acceptance; delivery poster exists | Existing delivery hook logs/catches accounting failures; `HUB_VISIT` can be marked delivered in a different service path; accounting must not change that service under this scope |
| NCM/COD | Delivery settlements and NCM receivable posting concepts exist | Settlement batches and cash deposits need stable source/document links and gross COD/fee clearing; multiple settlement handlers exist |
| Expenses/procurement | Expense, payable, shipment, return and poster models/helpers exist | Expense accounting can be asynchronous; direct outflow assumes bank; purchase/return posting coverage is incomplete; mutable summaries use current costs |
| Reports | GL, trial balance, GL statements, finance statements, tax report and health UI exist | `finance/statements` and tax report derive values from live operational data; GL statements have incomplete account coverage; Accounting Health compares mismatched populations |
| Reversal | A settlement reversion audit model and operational compensation writes exist | Reversions do not consistently create linked GL reversals; the generic journal reversal is not atomic across original/reversal status changes |
| Access | Existing unified RBAC and accounting/finance permissions | Preserve it; do not introduce another authentication or permission system |

Current APIs are mounted by `backend/server.js`:

- `/api/accounting`: chart of accounts, journal read/create/reverse, general ledger, trial balance, GL statements, subledger reconciliation, fiscal years and periods.
- `/api/finance`: treasury accounts/transactions, operational AP/AR, manufacturer payouts, expenses, assets, liabilities, tax and legacy statements.
- `/api/expense`, `/api/cogs`, `/api/delivery`, `/api/returns`, and marketing-card APIs expose source-domain operations. They remain source systems, not alternate accounting ledgers.

Current schemas and code take precedence over historical checkpoint claims. Iteration documents describe intended or previously tested slices and are not evidence that every current caller follows the new model.

## 4. Accounting Vocabulary For Product Decisions

- **Cash on hand:** physical company cash. It is a GL asset account, normally debit-balance.
- **Treasury account:** a real money location in the app, such as the cash drawer, a named bank account, wallet, gateway, or carrier clearing account. It must map to a GL account and have its own reconciliation state.
- **Journal:** the double-entry explanation of a financial event. Debits and credits must balance.
- **Receivable/payable document:** a named customer/carrier/manufacturer/vendor obligation. A bill or invoice is not the same thing as its cash payment.
- **Allocation:** which payment settled which document. Partial payments remain visible as outstanding amounts.
- **COD receivable:** money the carrier collected from a customer but has not yet remitted to the company. It is not company cash.
- **COGS:** the cost recognized when the related sale is recognized. A later manufacturer payment reduces the manufacturer payable; it does not create COGS again.
- **Opening balance:** the verified position at a chosen start date. It is not automatically owner capital.

## 5. Accounting Policy And Event Matrix

The owner-approved policies in `docs/accounting/04-target-accounting-domain-model.md` remain the business policy baseline. The entries below are the proposed system behavior, subject to accountant review of tax/account classification.

| Event | Recognition and source evidence | Debit | Credit | Subledger / settlement | Reversal |
| --- | --- | --- | --- | --- | --- |
| Order accepted | No financial recognition. Acceptance snapshots approved manufacturer/product terms | None | None | Preserve accepted terms and source IDs | Cancel snapshot only through explicit source status; no journal to reverse |
| Delivered COD sale | NCM `DELIVERED`; customer price is VAT-inclusive under current owner policy | COD receivable from NCM for gross amount | Product revenue, delivery revenue (if charged), output VAT | Customer/order source link; carrier receivable document | Linked credit/reversal only after qualifying return/refund event |
| Delivered non-COD sale | Delivery plus evidence of actual tender/processor; do not infer bank receipt from `Order.payment` alone | Actual bank/gateway clearing or customer receivable, based on payment evidence | Revenue and applicable output VAT | Receipt/payment reference; gateway balance until payout | Reverse/refund through linked source event |
| Manufacturer-owned consignment COGS | Delivery, not order creation; only accepted immutable agreed cost; not returned | COGS for gross cost; split recoverable input VAT only with valid invoice evidence | Manufacturer payable control (2160) for gross amount | Manufacturer payable document, order/product dimensions | Reverse linked COGS/AP after confirmed physical return/inspection |
| NCM/carrier fee | Fee obligation supported by carrier settlement/statement | Delivery/carrier expense | Carrier payable control (2180) | Carrier bill/document; do not net away gross evidence | Linked carrier credit/adjustment |
| NCM net remittance | Verified bank receipt/approved statement, not merely order delivery | Bank for cash actually received; clear carrier payable for fee settled | COD receivable for gross COD | Allocate bank receipt to settlement; retain COD/fee gross source lines | Bank reversal or corrected settlement, linked to original |
| Manufacturer payment | Approved payment to named manufacturer | Manufacturer payable (2160), plus any applicable withholding payable when approved | Mapped cash/bank for actual payment; TDS payable only under approved rule | Allocate payment to manufacturer documents | Linked payment reversal; do not rewrite original |
| Expense incurred on credit | Valid bill/expense evidence | Expense and supported input VAT, if eligible | Vendor AP (2110 or configured control) | Vendor bill and due date | Credit note/reversal |
| Expense paid immediately | Valid expense evidence and selected treasury account | Expense and supported input VAT | Mapped cash/bank | Payment reference and expense document | Refund/reversal journal linked to source |
| Payment of an existing bill | Actual money movement | Relevant AP control | Mapped cash/bank | Allocation to one or more open bills | Linked reversal and allocation restoration |
| Customer/carrier receipt | Actual money movement | Mapped cash/bank | Relevant AR/COD control | Allocate receipt to invoice/settlement | Linked reversal and allocation restoration |
| Cash/bank internal transfer | Transfer between company-controlled money locations | Destination GL cash/bank | Source GL cash/bank | One transfer source record; neither revenue nor expense | Reverse transfer legs together |
| Opening balance | Approved opening-balance voucher with evidence and balancing account | Asset/expense/equity/liability accounts per approved opening schedule | Opposite side of approved opening schedule; never assume capital | Opening voucher with date, approvals, source and attachments | Reverse/adjust in an allowed period; retain original |
| Customer return/refund | Return/refund policy event plus physical status as applicable | Sales returns/output VAT reversal and inventory/COGS correction if saleable stock is actually received | Cash/bank, customer refund payable or AR clearing | Credit note linked to original sale and refund | Correction journal linked to credit note |
| Marketing CPA | Verified eligible benefit redemption per owner policy | Marketing CPA expense | Marketing-partner payable (2170) | One source-linked partner document per redemption/contract unit | Reverse if redemption/benefit is reversed under approved policy |
| Fixed asset purchase/depreciation | Supported invoice and asset recognition policy | Fixed asset; later depreciation expense | Cash/bank or AP; later accumulated depreciation | Asset register linked to purchase journal | Disposal/damage journals and asset audit |

### Explicit policy boundaries

- Manufacturer stock remains manufacturer-owned consignment inventory until delivery under owner-approved policy. Do not debit company inventory on receipt for that stock.
- Do not apply VAT input credit without documented valid tax invoice/evidence and approved configuration.
- Customer prices are currently treated as VAT-inclusive in the owner-approved design; this is a business assumption to validate with a Nepal accountant.
- TDS, exemptions, e-invoice applicability, tax periods, corporate income tax, and statutory account presentation require current legal/accountant review. No guessed rate is a posting rule.
- Offsets between a manufacturer receivable and payable or between COD and carrier fee require explicit source documents and a supported right-of-setoff policy. Preserve gross positions.

## 6. Target Chart Of Accounts

Retain existing codes where they match the approved accounting purpose; fix coverage and add subaccounts only when a real reporting/reconciliation need exists. Codes are mappings, not logic embedded throughout controllers.

| Group | Existing codes to retain/map | Target use |
| --- | --- | --- |
| Cash/bank/clearing | 1110, 1120, 1170, 1180 | Physical cash, bank, COD receivable, gateway clearing |
| Other current assets | 1130-1160 | Customer AR, inventory only when company-owned, input VAT, advances |
| Current liabilities | 2110-2180 | General AP, VAT, tax/TDS, refunds, distributions, manufacturer AP, marketing AP, carrier AP |
| Equity | 3100-3500 | Capital, premium, retained earnings, current-year earnings, drawings |
| Revenue/contra revenue | 4100, 4200, 4500, 4600, 8100 | Product revenue, delivery income, returns, discounts, other income |
| Cost of sales | 5100-5500 | COGS, inbound costs only when company inventory policy says so, packaging, returns, write-down/scrap |
| Expenses | 6100-7200 | Operating categories, manufacturer/marketing/carrier costs, depreciation, financing and bank fees |

Account metadata must drive statement/report grouping: type, subtype/report group, parent, normal balance, active/system/control flags, manual-posting policy, cash/bank classification, reconciliation requirement, tax category and optional dimensions. A mapped system account must not be freely changed through ordinary COA editing.

## 7. Data Model And Ownership

Reuse rather than duplicate the existing Decimal GL, party, event, document, and allocation concepts. Complete them as one accounting architecture.

| Concept | Owner and design requirement |
| --- | --- |
| `Account`, `JournalEntry`, `JournalLine`, periods, sequences | Accounting owns these. Posted entry immutable; each line has exactly one positive side; Decimal scale and date/period validated. Statement classification lives on accounts or explicit report mappings, not controller code lists. |
| `AccountingParty` | Accounting identity for customer, manufacturer, carrier, vendor, marketing partner, tax authority. Stable source type/ID and historical display-name snapshot. |
| `AccountingEvent` | Unique source/type/version/idempotency key; immutable payload/hash; PENDING/PROCESSING/POSTED/FAILED/BLOCKED and durable attempts/error/journal link. Persist failure evidence outside the journal transaction when async/outbox is required. |
| `AccountingDocument` and lines | Authoritative invoice, bill, credit/debit note, COD statement/settlement and opening voucher. Store document date, posting date, due date, party, currency, tax snapshot, original/outstanding amounts, control account and source link. |
| `AccountingAllocation` | Immutable allocations from receipt/payment/credit to documents; support partial, advance and unallocated cash. Lock/recheck remaining balance inside a DB transaction. |
| Payment/receipt | One immutable payment or receipt event with unique idempotency key, treasury mapping, date, method, external reference and allocations. Do not use `Order.payment` boolean as a payment ledger. |
| `FinancialAccount` / Treasury | Actual money location with required active mapping to one GL cash/bank/clearing account before financial operations. Multiple Treasury accounts may map to an explicitly approved aggregate GL control; report at mapped-account aggregate and account level where mapping permits. Unmapped accounts are `NOT RECONCILED`. |
| Cash/bank transaction | Link source transaction to accounting event/journal and settlement document. Internal transfer has source and destination, never an income/expense category. |
| Tax code/transaction | Effective-dated rule version, tax type, jurisdiction, rate, inclusive/exclusive, input/output, recoverability and evidence requirement. Record tax base/amount/rule version with the posted source. |
| Bank statement/reconciliation | Statement header and lines; imported source hash/unique transaction key; match links can be one-to-one or supported one-to-many; preserve unmatched items and user/date/reason. |
| Accounting audit event | Append-only actor/action/time/source/reason/old-new values for configuration, posting, approval, period, reconciliation and reversal. Never allow posted-line editing/deletion via API. |
| Inventory valuation | Accounting value only for company-owned goods. Manufacturer-consigned units remain out of company inventory asset until the approved recognition event. Quantity system remains owned by inventory domain. |
| Legacy `AccountPayable`, `AccountReceivable`, `CashTransaction` | Compatibility/read adapters during cutover only. Do not maintain them as a second authoritative balance after migration. Preserve source data until caller audit and reconciled cutover. |

Schema changes should be staged in additive migrations. Never run `db reset`, destructive seed, or production migration as part of implementation. Verify actual environment and migration status before any deploy.

## 8. Posting And Integration Architecture

```text
Existing business source record/event
  -> accounting adapter (read immutable source evidence)
  -> AccountingEvent (stable source key + version + payload hash)
  -> accounting document/subledger
  -> balanced journal transaction
  -> GL and audit record
  -> reports/reconciliation
```

- Internal accounting-only operations use one Prisma transaction for treasury movement, document/allocation, journal, cached balance update and audit evidence.
- A non-accounting service event that cannot share the same database transaction must create/allow a durable accounting event and visible status. If the source service cannot be changed under the scope boundary, accounting must reconcile/poll the source and show the delay/failure; it must not claim atomicity.
- Every adapter is idempotent on a stable source key. Do not use `Date.now()` or random IDs as a retry key.
- Reversals are new entries that link to the original journal and source. Operational state restoration alone is not an accounting reversal.
- Do not catch and discard accounting posting failures. Internal transaction: roll back and fail the accounting operation. External event: persist failure and expose authorized retry/resolution.
- `createdAt`, document date, source event date, delivery date, payment date, posting date and accounting period are distinct.

## 9. Reporting And Reconciliation

### Reports

- Trial balance, P&L, balance sheet, GL, account register and ledger cash flow are produced from posted journal lines and account metadata. Use one date-boundary helper and Nepali fiscal periods in Asia/Kathmandu.
- Reports distinguish an actual zero from missing accounting data. Never merge operational estimates into a GL statement as fallback.
- AP/AR ageing and party statements derive from open AccountingDocuments and allocations, reconciled to the corresponding control accounts.
- Cash flow uses posted cash/bank journal movements and explicit flow classifications. Do not derive beginning cash as ending cash minus an estimated flow.
- Tax reports use tax transactions/journal links and display rule version, period, evidence coverage, and exclusions. Until validated, label outputs `ESTIMATE / NOT FOR FILING`.

### Reconciliation checks

Each run records scope, as-of/period, source accounts, query/population, result, timestamp, actor, evidence and unresolved items.

1. Trial balance debits equal credits; separately check journal line totals against header totals and cached balances against a rebuild.
2. For every mapped Treasury account, compare transaction-derived expected balance and configured GL balance. Show unassigned accounts and unmapped transaction populations separately.
3. Open AP documents equal their configured AP controls, by control account and party; include 2110, 2160, 2170 and 2180 as applicable.
4. Open AR documents equal their configured AR controls, including NCM COD and gateway clearing where those are document-backed.
5. Inventory valuation equals inventory GL only for company-owned quantities and policy-approved valuation; never equate hub stock counts with owned inventory automatically.
6. Tax subledger totals reconcile to tax control accounts by rule/version/period.
7. Carrier statement COD, fee, adjustments, net remittance, COD receivable and carrier payable reconcile gross and by settlement.
8. Source-event coverage: required source events without journals; journals without source; failed/pending events; duplicate source versions; reversals without originals; manual journals to protected accounts; suspense/clearing balances.

A health card may say `PASS` only if it compares the same accounting population at the same date. Other states are `WARNING`, `ERROR`, `NOT RECONCILED`, or `NOT AVAILABLE` with matched/unmatched evidence.

## 10. API And UI Direction

Preserve existing routes and RBAC while consolidating ownership behind accounting services. Avoid breaking portal consumers before caller migration.

- Keep `/api/accounting` for chart, journal, GL, period, subledger, reconciliation and reports.
- Keep `/api/finance` compatibility endpoints while Treasury/payment workflows migrate to accounting commands. Responses should name whether a value is GL, Treasury, estimate or reconciled.
- Add/complete accounting-document, payment/receipt, allocation, bank statement import/match, opening-balance and reconciliation-run endpoints under existing `accounting:*` permissions.
- Accounting UI should drill down `report -> account -> journal -> document -> source event`, show posting/reconciliation status and failed events, and support AP/AR ageing, allocation, statements and bank matching.
- Manufacturer and marketing partner portals may only read their own statement/documents. Customer may only read invoice/receipt/refund documents. Never expose company margin, internal COGS or other parties' accounting.

## 11. Controls

- Unique source idempotency, journal/document numbering and statement transaction keys.
- Decimal arithmetic, safe rounding and all amount validation in shared accounting money utilities.
- DB transaction for posting and allocations; concurrency-safe balance checks and allocations.
- Period OPEN/SOFT_CLOSED/CLOSED/LOCKED; reopen only via audited permission. Normal postings cannot target closed/locked periods.
- System/control accounts cannot be changed or manually posted by normal users; explicit accounting permission for approved adjustment.
- Posted document/journal immutability; adjustment/reversal instead of update/delete.
- Durable failed-event attempts and safe retry; no hidden log-only financial failures.
- Granular existing RBAC, server-side party scoping, audit of configuration and privileged activity.
- Backup, migration status, isolated test DB, rollback plan and accountant review before production cutover.

## 12. External Research And Assumptions (2026-09-29)

### Nepal standards and law

- ASB Nepal's official [publication index](https://asbnepal.gov.np/publication) lists NFRS 2024, NFRS 2018, NFRS for SMEs 2017, NAS for MEs 2018 and NAS for NPOs. ASB describes its role as formulating Nepal accounting standards. The app cannot determine which framework Aama must apply; company legal form, size/public accountability and current adoption notices need accountant/company confirmation.
- Official [ASB Nepal home](https://asbnepal.gov.np/) and [standards portal](https://asbnepal.gov.np/standards) were reachable. Standard texts are copyrighted; this design records references and principles, not copied standard wording.
- Official IRD URLs attempted: [IRD home](https://ird.gov.np/), [laws and bylaws](https://ird.gov.np/category/laws-and-bylaws), [VAT law PDF candidate](https://ird.gov.np/public/pdf/Value-Added-Tax-Act-2052.pdf), and [VAT page candidate](https://ird.gov.np/page/vat). The fetcher could not extract them. Official [OCR](https://ocr.gov.np/) and [Nepal Law Commission](https://lawcommission.gov.np/) pages also did not extract. Therefore current VAT/TDS/e-billing thresholds, effective amendments, record-retention terms, and filing-specific requirements are **unverified** here and must not be declared compliant or coded as legal fact without a qualified reviewer and current official texts.
- Existing code and owner notes use 13% VAT and VAT-inclusive prices as current assumptions. These remain effective-dated configuration candidates, not statutory conclusions. The current 25% income-tax number remains estimate-only as previously agreed.

### Mature product patterns

- TallyPrime official [banking](https://tallysolutions.com/features/banking/) and [credit/cash-flow](https://tallysolutions.com/features/credit-and-cashflow-management/) pages describe bank-statement matching, bill-wise references, ageing, payment/receipt vouchers and cash-flow reporting.
- Odoo official [Accounting](https://www.odoo.com/app/accounting) page describes bank reconciliation, bills, localized taxes, real-time reports, audit/drill-down and deferrals.
- QuickBooks/Xero official pages redirected to advertising/measurement endpoints during retrieval; no product-specific claims are relied on from those fetches. The design uses common non-proprietary accounting patterns only.

## 13. Implementation Sequence And Gates

| Slice | Work | Exit gate |
| --- | --- | --- |
| A. Treasury mapping and cash integrity | Add explicit treasury-to-GL mapping and opening-balance voucher; make direct inflow/outflow/transfer commands post appropriate journals; show mapping variance. | No mapped money movement can commit without its journal; transfers are not P&L; unmapped accounts show not reconciled. |
| B. Documented AP/AR cutover | Route vendor/manufacturer/carrier/partner bills and customer/COD receivables through AccountingDocument; payments/receipts allocate in transactions; legacy AP/AR become compatibility projections. | Bill balances reconcile by control account and party; partial, advance and retry tests pass. |
| C. Durable event reliability | Add failed attempts/outbox visibility where existing source hook cannot share transaction; remove log-only failure behavior within permitted accounting boundary. | Retry produces one journal and visible outcome; no false success for accounting-owned commands. External hook limits are documented. |
| D. Operational accounting coverage | Expenses, procurement, returns, fixed assets, loans/equity and marketing/carrier settlement post once using established policy and evidence. | Each supported event has journal, document, source trace and reversal test. |
| E. Reports/health | GL-only statements, account metadata mapping, real cash-flow grouping, full AP/AR/cash/COD/inventory/tax controls; remove operational fallback. | Reports replay from posted journals; health checks compare identical scopes and expose missing links. |
| F. Bank reconciliation and admin UX | Statement import, matching, ageing, drill-down, failed event and exception workflows. | Imported statement totals, book balance and unresolved differences are explainable and auditable. |
| G. Cutover | Verify environment/data, migration rollout/rollback and source coverage; reconcile opening position. | No destructive action; accountant approves openings, account mapping and tax configuration. |

### Out of scope without new approval

- Modifying order, delivery, manufacturer, marketing, customer or auth business rules outside a minimal accounting adapter contract.
- Automatically replaying historical sources or creating opening balances.
- Filing legal VAT/income-tax returns or claiming statutory compliance.
- Resetting a database, deleting legacy tables, or applying migrations to an unknown/production database.

## 14. Current Implementation Status

This document records target design. Existing implementation is partial: Decimal ledger and Nepali period helper exist; delivery/marketing adapters and party/document foundations exist; Treasury mapping, unified AP/AR usage, event failure visibility, complete reports and reconciliation remain incomplete. Each implementation slice must update this section and the iteration tracker with actual files, migrations, tests, DB scope and known blockers. A passing unit suite alone does not complete a slice.
