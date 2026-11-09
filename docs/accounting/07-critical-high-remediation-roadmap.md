# Critical and High Accounting Remediation Roadmap

**Prepared:** 2026-11-09  
**Purpose:** Turn the repository's accounting findings into a sequenced, testable remediation plan.  
**Status:** Implementation is in progress by user request; this does not waive the policy, isolated-database, CA-review, or production cutover gates below.

## 1. Scope and professional boundary

This is a software and internal-control remediation plan based on the current repository, its accounting documentation, and focused unit tests. It is not a Nepal statutory audit, legal opinion, tax computation, or substitute for approval by a Nepal Chartered Accountant (CA), tax adviser, management, and (where applicable) the company's external auditor.

The project has a double-entry GL and tested posting components. That is not enough to conclude that the complete system is correct: production database state, business-event completeness, historical balances, statutory treatment, and all subledger reconciliations have not been independently verified.

## 2. Evidence-based current assessment

The following are observed in the repository as of the prepared date:

- The implementation tracker identifies migration/cutover and historical backfill as release blockers. It says payout migration and database-backed payout transition/concurrency tests remain unverified.
- Decimal fields have been introduced in parts of the schema, but Decimal migration of all money writers/readers is incomplete; the schema still contains monetary `Float` fields.
- The control-account coverage service explicitly marks important controls as partial or unreconciled, including inventory, input VAT, cash/bank, gateway clearing, tax, manufacturer payables, fixed assets, and loans.
- The Admin financial statement path now uses posted GL data, and direct cash flow includes accounts 1110, 1120, and 1180. However, 1180 combines Treasury wallets and payment gateway clearing. Including it in cash flow does not reconcile it to wallet/provider evidence or prove availability of those funds.
- Fixed-asset acquisition and depreciation now have code paths that transact source updates and GL posting together, use mapped Treasury / BS-period identities, and guard retry duplication. These controls have focused unit-test evidence only; asset policy, reconciliation, isolated-database concurrency/recovery testing, and CA approval remain outstanding.
- Fixed-asset damage/write-off now clears the GL cost and accumulated depreciation with a book-loss journal in the same transaction as the register update. Asset sale proceeds remain disabled pending CA-approved tax/VAT handling; fixed-asset control reconciliation and database-backed recovery/concurrency checks are still open.
- Direct Treasury receipts, outflows, and internal transfers now have atomic, idempotent mapped journals; unsupported generic sales entries are rejected. This code-level control does not replace external cash/bank reconciliation or isolated-database concurrency testing.
- Primary share issuance and company share buyback now require active mapped NPR Treasury accounts and atomically post their cap-table/cash/share-transaction effects with the existing equity journal classification. Both require idempotency; buybacks check unreserved funds. Legal authority/evidence, distributions, peer-transfer controls, CA policy review, historical reconciliation, and database-backed concurrency/recovery validation remain open.
- Peer-to-peer share transfers now update both shareholders and the share ledger in one serializable transaction with optimistic balance guards. `ShareTransaction` has nullable unique idempotency and payload-hash fields with an additive migration; isolated migration validation/deployment is still required. Secondary purchase consideration is no longer treated as company-contributed capital.
- Share handling still has unresolved legal-register reconciliation, legacy Float precision, and a 100,000-share fallback that can diverge from issued/outstanding shares. Do not alter share denominator, fractional-share, buyback, or capital classification rules without CA/company-secretary approval and verified company records.
- Legacy operational reports and tax calculations still exist and can use a different basis from posted-ledger statements.
- Existing focused tests validate selected invariants, not every route, production migration, source event, or accounting policy.

**Conclusion:** Treat production accounting statements as **not yet independently validated**. Do not describe them as audited, statutory-compliant, or complete until the exit gates below are met.

## 3.1 Recommended execution order and work packages

The phases below are broad control objectives. Execute the following work packages in order, preserving the gates between policy decisions, engineering changes, reconciliation, and release. Do not set dates until management assigns engineering, finance, DBA, and Nepal CA capacity.

| Order | Priority | Work package and accountable owners | Required deliverables / exit gate |
|---|---|---|---|
| 1 | Critical | **Approve entity facts and Nepal policy** — Management + Nepal CA/tax adviser; Engineering supplies current behavior and sample outputs. | Dated, signed policy matrix: legal entity/reporting framework, accounting period, VAT/PAN status by effective date, tax/TDS scope, invoice obligations, inventory and revenue/return rules, fixed-asset/depreciation policy, loan/equity presentation, and report definitions. Document unresolved decisions as blockers; do not encode developer assumptions. |
| 2 | Critical release blocker | **Establish safe test and recovery environment** — DBA/operations + Engineering + independent reviewer. | Dedicated isolated database and verified backup; prove clean and representative-data migration from the checked-in migration chain, Prisma/schema alignment, restore and rollback. Verify exact environment before every run. Do not use shared, local business, or production data for destructive tests. |
| 3 | Critical | **Capture baseline and reconcile source balances** — Finance preparer + independent finance reviewer; Engineering provides exports and drill-downs. | Signed opening/period schedules for cash/bank, wallet/provider clearing, AR/AP, inventory/COGS, VAT/TDS/tax, fixed assets, loans, equity, distributors, manufacturers and settlements. Record evidence, source population, GL, variance, owner and disposition. No unsupported opening balance or historical backfill. |
| 4 | Critical / High | **Complete money and date correctness** — Engineering + CA review. | Field/writer/report inventory; CA-approved NPR precision/rounding and BS/AD/timezone rules; staged fixed-precision migrations and exact conversion/reconciliation reports. Convert high-risk financial domains first (Treasury, journals, bills/allocations, tax, inventory cost, payouts), then assets, loans, equity and remaining reports. Each migration must pass isolated clean/populated tests and have a reconciliation/rollback plan before the next domain. |
| 5 | Critical | **Close event-integrity gaps** — Engineering + domain finance owners. | Event-to-journal matrix for every money-changing feature; identify direct writes, suppressed errors, missing source links, weak IDs and non-atomic posting. Fix one bounded domain at a time using transaction-scoped posting, durable visible failure/outbox where necessary, stable idempotency, compare-and-set/concurrency checks, and reversal paths. Prioritize unverified payouts/settlements, customer refund/return/exchange, procurement/inventory, tax payments, equity distributions, peer-transfer durable idempotency, and remaining non-atomic routes. Buyback/issuance/peer transfers still need database-backed validation. Include forced-failure, duplicate, mismatch, retry and concurrent-database tests. |
| 6 | Critical for statements | **Separate clearing balances and reconcile all control accounts** — Finance + Engineering. | CA-approved separation of wallet Treasury and payment-provider clearing; map and reconcile each by statement/transaction ID, fees, refunds and settlement-in-transit. Add reviewed monthly roll-forwards for every material control. Do not represent combined GL 1180 as available cash or mark a control reconciled solely because the trial balance balances. |
| 7 | High | **Unify reports and complete accounting domains** — Engineering + finance owner + CA. | One authoritative posted-ledger basis for statements; clear labels for estimates; traceable statement drill-down; complete domain coverage and tax schedules. Compare operational and GL outputs over a representative period; keep incompatible reports disabled or explicitly non-authoritative until migration and regression tests pass. |
| 8 | High | **Implement close, approval and audit controls** — Controller + Management + Engineering. | Monthly close checklist, preparer/reviewer separation, maker-checker approval, period lock/reopen controls, immutable close evidence, permission review, and reproducible close pack demonstrated in UAT. |
| 9 | Critical release gate | **Nepal compliance validation and controlled cutover** — Nepal CA/tax adviser + Management + independent reviewer + Engineering. | CA-reviewed representative close and statutory schedules against current official requirements and entity-specific facts; parallel close for at least one representative business cycle; approved opening balances, UAT/recovery evidence, rollback/monitoring plan, operator training, and written sign-offs. No cutover while a material variance, migration uncertainty, policy gap, silent failure, or unsupported balance remains. |

### Immediate next action

Start with work package 1: management should appoint the finance preparer/reviewer and Nepal CA, and provide entity registration/tax status and approved reporting use. In parallel, Engineering/DBA may prepare a **new isolated** test environment, but must not run a migration or data correction against an unverified/shared database. After policy and environment gates pass, build the reconciliation baseline before historical backfill or broad Decimal conversion.

### Iteration acceptance standard

For each bounded implementation, record the affected source events and accounting policy, before/after journal and subledger examples, failure rollback result, same-key replay and changed-payload rejection, concurrent-request database result, control-account reconciliation impact, test evidence, and reviewer. A build or unit-test pass alone is not acceptance. Track “implemented,” “unit tested,” “database validated,” “reconciled,” “CA approved,” and “production approved” as separate states.

## 3. Governance and rules of engagement

Assign named owners before execution:

| Role | Accountability |
|---|---|
| Management / business owner | Approves business facts, opening balances, materiality, control owners, and cutover decision. |
| Nepal CA / tax adviser | Approves accounting policies, Nepal tax/VAT/TDS treatment, applicable reporting framework, and evidence requirements. |
| Engineering owner | Implements controlled changes, migration/recovery tooling, posting/reconciliation controls, and automated tests. |
| Finance operator | Supplies original source documents and performs monthly reconciliations with review evidence. |
| Independent reviewer / auditor | Reviews design, sample transactions, migration/reconciliations, and final evidence independently of preparer. |

Rules:

1. Never migrate, seed, reset, or backfill against production or an unverified/shared database.
2. No opening balance or historical amount is inferred from a UI summary. Require source evidence and an approved opening journal.
3. Keep posted journals immutable; correct them with linked reversals/adjustments.
4. No silent posting failure, success-shaped fallback, or unsupported estimate in a statutory or GL statement.
5. Freeze approved policy before coding; account mappings, recognition events, tax treatment, and rounding are configuration/policy, not developer assumptions.
6. Preserve evidence, reviewer approval, source IDs, import files, hashes, run logs, and reconciliation sign-off.

## 4. Sequenced remediation plan

### Phase 0 — Establish the baseline and approved policy (gate before accounting changes)

**Priority:** Critical  
**Owners:** Management, Nepal CA, engineering  
**Work:**

- Confirm legal entity type, company registration status, taxpayer PAN/VAT status, seller/collector role by sales channel, reporting period, fiscal-year convention, currency, materiality, and intended use of each report.
- Have the CA document the applicable financial-reporting framework (including whether NAS/NFRS or another framework applies), significant accounting policies, chart-of-account presentation, revenue/return/COGS recognition, inventory ownership and valuation, fixed assets/depreciation, foreign currency (if any), provisions, related parties, and period-close entries.
- Produce a Nepal tax matrix for the actual entity and transaction types: VAT registration/effective date, taxable/exempt treatment, tax point, tax invoice/credit note evidence, input VAT eligibility, VAT return mapping, TDS applicability/rates/deposit/filing evidence, income-tax estimates versus filed liabilities, and any e-billing/e-invoicing obligations applicable to this taxpayer.
- Validate the current law and IRD requirements against the applicable Acts, Rules, Finance Act, directives, notices, and taxpayer-specific status at implementation time. The IRD site changes its published law and Finance Act materials; do not hardcode a rate or obligation from this plan.
- Record each policy as an effective-dated, approved requirement linked to its source and owner.

**Exit gate:** Written CA and management approval of a dated policy matrix and report definitions. Unresolved policy is a blocker, not a coding default.

### Phase 1 — Prove database and release safety (no production mutation)

**Priority:** Critical release blocker  
**Owners:** Engineering, DBA/operations, independent reviewer  
**Work:**

- Create a dedicated, access-controlled accounting test database from a verified sanitized backup or a controlled empty schema. Confirm the connection target before every migration/test.
- Run Prisma validation/generation, apply the exact migration chain from a clean database, then repeat against a representative non-empty copy. Verify migration checksums/history and compare actual schema to Prisma.
- Validate all staged migrations, especially payout lifecycle and supplier-credit migrations, including indexes, unique constraints, Decimal precision, foreign keys, rollback/recovery path, and deployment ordering.
- Add database-backed tests for payout initiation/confirm/fail, supplier-credit application, settlement allocations, duplicate/retry requests, simultaneous requests, transaction rollback, and deadlock/retry behavior.
- Exercise backup restore and point-in-time recovery. Record duration, RPO/RTO, access controls, and evidence.
- Do not use `db push` as evidence that the checked-in migration chain is deployable or that migration history is recorded.

**Exit gate:** Clean and populated isolated-database migration tests pass; no unexplained schema drift; backups restore; evidence reviewed. No live cutover yet.

### Phase 2 — Stop accounting divergence at the source

**Priority:** Critical  
**Owners:** Engineering, finance process owner  
**Work:**

- Inventory every business event that changes financial state: sales/receipts, delivery COD and fees, returns/refunds/exchanges, manufacturer production and payable, supplier/manufacturer payouts, distributor settlements, marketing CPA, expenses, procurement, inventory, assets/depreciation/disposal, loans, equity, tax payments, and manual journals.
- For each event, define a source-of-truth event, debit/credit policy, party/control-account mapping, idempotency key, evidence, reversal path, and expected subledger effect.
- Route eligible event mutations through one transactional posting boundary. Commit source state, immutable accounting event, journal, allocations/subledger, and audit evidence atomically where possible. If external systems prevent atomicity, persist a durable pending/outbox event, expose its failure state, retry idempotently, and provide an operator reconciliation queue.
- Eliminate background `.catch()` patterns that permit the business API to report success while required accounting silently fails. Return explicit pending/failure status and prevent duplicate financial effects on retry.
- Apply stable event-based idempotency, unique constraints, serializable/optimistic concurrency controls, and safe journal-number sequencing. Do not use timestamps or mutable amounts as the event identity.
- Prevent editing/deleting financial source records without linked reversal/replacement events and approvals.

**Exit gate:** Every in-scope event has a tested posting contract; forced failures leave either a fully committed event or a durable visible pending event; retries/concurrent duplicates produce one financial effect.

### Phase 3 — Reconcile and complete subledgers

**Priority:** Critical for statement reliability  
**Owners:** Finance preparer, finance reviewer, engineering  
**Work:**

Create dated opening and monthly roll-forward reconciliations for each control account. Each reconciliation must show source population, GL population, opening balance, period movement, closing balance, variance, aging/owner, evidence links, and review approval.

Minimum controls:

- **Cash and bank (1110/1120):** physical cash count and signed cash sheet; bank statement import/matching; outstanding deposits/payments; stale items; bank confirmations where appropriate.
- **Wallet and gateway clearing (1180):** first separate wallet balances from provider clearing. Create distinct GL accounts and map each Treasury wallet to its own wallet GL (or an explicitly approved clearing design); map gateway receivable/clearing by provider. Reconcile wallet statements and gateway gross receipts, fees, refunds, reserves, settlements, and settlement-in-transit by transaction ID. Until separation and evidence reconciliation, label 1180 combined and do not call the whole amount available cash.
- **AR/AP and party balances:** tie bill-wise invoices, credit notes, payments, receipts, and allocations by stable party/document IDs to GL controls; age unresolved/unapplied advances; confirm key suppliers/manufacturers/carriers.
- **Inventory (1140):** tie SKU/location quantities to cost layers/ownership records and approved valuation; investigate uncosted, negative, damaged, consignment, in-transit and return stock; reconcile COGS and supplier payable.
- **VAT/TDS/income tax:** reconcile transaction registers and tax evidence to GL liability/receivable, returns filed, assessments, payments and carryforward balances; separate estimates from assessed/paid liabilities.
- **Fixed assets/depreciation:** register-to-GL roll-forward by asset, category, cost, depreciation method/rate/life, accumulated depreciation, additions/disposals, impairment and physical existence.
- **Loans/equity/partner distributions:** confirm agreements/statements, principal/interest, ownership register, approvals and payable distributions against GL.
- **NCM/distributor/marketing:** reconcile COD gross receivable, delivery-fee payable, distributor collection/settlement, CPA accruals and settlement documents separately; no unsupported netting.

**Exit gate:** Every material account is reconciled or has an approved, quantified, time-bound exception. No stale unexplained difference is hidden inside a summary.

### Phase 4 — Complete Decimal and Nepal-calendar correctness

**Priority:** High, with critical sub-ledger impact  
**Owners:** Engineering, CA reviewer  
**Work:**

- Inventory all money and quantity fields and all arithmetic paths (API validation, calculations, Prisma writes, reports, exports, imported data, and tests). Prioritize GL, invoices, taxes, payouts, inventory cost, AR/AP, cash, assets, and loans.
- Migrate monetary database fields to fixed precision Decimal with explicit scale; define a single Decimal arithmetic/rounding library and NPR paisa rounding policy approved by CA. Keep quantities/unit rates at separately defined precision.
- Define where rounding occurs (line, tax, document, allocation, journal); ensure journal lines balance exactly and the same result is used in source documents and GL.
- Add boundary tests for fractional tax, split allocations, partial payments/refunds, large values, negative corrections, and repeated conversions. Prohibit JS floating-point as the accounting authority.
- Verify Bikram Sambat dates, Gregorian storage, timezone Asia/Kathmandu, Shrawan 1 to Ashadh end boundaries, effective-dated tax rates, leap-year/conversion boundaries, and reports across BS/AD inputs.

**Exit gate:** No critical money writer/report uses binary floating point as its accounting authority; conversion/reconciliation report shows zero unexplained precision drift; fiscal boundaries pass reference-date tests.

### Phase 5 — Finish core accounting domains and remove conflicting bases

**Priority:** High  
**Owners:** Engineering, finance process owner, CA  
**Work:**

- Prioritize the currently incomplete expense/procurement, tax, asset, debt/equity, marketing CPA, customer collection/refund, and legacy distributor settlement pathways. For each, implement source-linked posting, party/document allocations, reversals, evidence, idempotency, and reconciliation coverage.
- Confirm order lifecycle and returns produce one consistent revenue/VAT/COGS/payable result for delivered, failed, RTO, exchange, partial return, refund and manufacturer-return outcomes.
- Ensure payouts only clear confirmed liabilities against evidence-backed mapped NPR Treasury accounts. Separate reservations from actual bank movement and retain bank/wallet reference evidence.
- Keep operational estimates (e.g. heuristic profit distribution/tax dashboard) visibly separate from posted GL. Remove them from authoritative statements, or label them estimate-only with source date and limitations.
- Decommission or clearly mark redundant `/api/finance/statements` and tax/report bases only after caller inventory, migration plan, comparison period and regression tests.
- Expand accounting health to expose completeness, mismatches, missing source events, unreconciled control status, stale pending postings and duplicate/reversal exceptions; do not report “balanced” as “reconciled.”

**Exit gate:** All in-scope domains are covered by traceable postings and reconciliations; no financial report mixes estimate and posted bases without an explicit label.

### Phase 6 — Close controls, access controls, and audit evidence

**Priority:** High  
**Owners:** Finance controller, management, engineering  
**Work:**

- Establish monthly close calendar and checklist: bank/cash, clearing, AR/AP, inventory/COGS, VAT/TDS, assets/depreciation, payroll (if in scope), loans, accruals, provisions, FX (if applicable), intercompany/related parties, suspense, subsequent events, and management review.
- Add period close prerequisites, preparer/reviewer separation, approval thresholds, lock/reopen approval with reason, and immutable close snapshots.
- Require maker-checker approval for manual journals, opening balances, tax adjustments, write-offs, refunds above threshold, settlements, period reopen, and COA changes.
- Preserve immutable audit history: actor, role, timestamps, reason, source/evidence references, before/after state, approvals, reversals, import provenance, and export hash.
- Review least-privilege permissions, MFA/admin access, sensitive export controls, log retention, backup retention, and audit log access.

**Exit gate:** Demonstrate segregation of duties, closed-period enforcement, complete audit attribution, and reproducible close pack in the test environment.

### Phase 7 — Nepal compliance validation and controlled cutover

**Priority:** Critical release gate  
**Owners:** Nepal CA/tax adviser, management, engineering, independent reviewer  
**Work:**

- Against current official Nepal requirements and this entity's actual registrations, validate: applicable NAS/NFRS/reporting obligations; Companies Act audit/filing duties; Income Tax Act and current Finance Act; VAT Act/Rules and IRD directives/notices; PAN/VAT registration and effective dates; invoice/credit-note content and serial controls; electronic billing obligations; TDS rates, deduction points, deposit/return evidence; tax period and calendar mapping; and retention of accounting/tax records.
- Validate every tax rate and eligibility rule against a dated official source and accountant approval. Model effective dates; never infer VAT registration or deductible input VAT from a configured rate or user checkbox alone.
- Prepare trial balance, GL, statement of profit or loss, financial position, cash flows, changes in equity (if applicable), tax/VAT schedules, subledger aging, reconciliation pack, and management representations for a representative closed period. CA validates presentation and treatment.
- Run parallel reports for at least one full business cycle (minimum one monthly close; use a longer period if volumes/seasonality make it unrepresentative). Compare source documents, legacy reports, GL and bank/provider statements. Document every difference and approved disposition.
- Migrate only verified opening balances with source support and approved opening journals; preserve legacy history read-only as needed. Do not fabricate unavailable transaction detail.
- Conduct role-based UAT and failure/recovery drills; train finance operators; obtain written CA, management, and independent reviewer sign-off.
- Deploy with a rollback plan, restricted finance access, daily exception monitoring, reconciliation dashboards, and an agreed hypercare period.

**Cutover is blocked if:** material control accounts are unreconciled; migration history/schema is uncertain; tax/reporting policy lacks approval; a required posting can silently fail; balances lack evidence; or rollback/backup restore has not been demonstrated.

## 5. Priority ordering and dependencies

```text
Phase 0: Policy and entity facts
    ↓
Phase 1: Isolated migration/recovery validation
    ↓
Phase 2: Event integrity, atomicity, idempotency
    ↓
Phase 3: Historical/opening and ongoing reconciliations
    ↔ Phase 4: Decimal/date correctness (start inventory in Phase 0)
    ↓
Phase 5: Complete domains and unify reporting basis
    ↓
Phase 6: Close, approval, and audit controls
    ↓
Phase 7: CA validation, parallel close, sign-off, controlled cutover
```

Parallel work is allowed only where policy and schemas are stable. Do not backfill or cut over before the event contract and reconciliation rules are approved.

## 6. Nepal-specific validation checklist

The software should support—not decide—the following, based on the actual entity and current official requirements:

- PAN/VAT registration status and effective dates by legal entity and taxable activity.
- VAT tax point, taxable/exempt treatment, invoice and credit-note requirements, input tax eligibility and evidence, return-period mapping, adjustments and payment matching.
- Tax withholding applicability and transaction-specific TDS treatment, counterparty PAN, deposit/return deadlines, certificates and GL settlement.
- Income-tax accounting versus tax computation, advances/installments, assessments, deferred items if applicable, and annual filing support. Estimated tax must never be shown as an assessed liability without clear status.
- Electronic billing/e-invoicing requirements, approved systems, serial-number controls, and retention obligations as applicable to the taxpayer.
- Applicable Nepal Accounting Standards / NFRS reporting framework and Companies Act statutory audit/filing requirements for the entity's type and size.
- NPR as functional/reporting currency unless approved otherwise; BS fiscal calendar and timezone with auditable AD timestamps; any foreign currency transaction/translation policy if introduced.

**Current-law caveat:** IRD publishes updated Acts and Finance Act material over time. Confirm the version effective for each transaction/tax period from official IRD publications and a Nepal CA. This plan intentionally does not state a VAT rate, TDS rate, threshold, deadline, or framework applicability as a universal rule.

## 7. Definition of done

The critical/high remediation is complete only when all conditions below have evidence:

1. Approved, dated Nepal accounting/tax policy matrix exists.
2. Clean and representative isolated database migration tests pass; schema and migration history are verified; backup restoration succeeds.
3. Every in-scope source event posts exactly once or remains durably pending with visible, retryable failure state; concurrent/retry tests pass.
4. All material control accounts reconcile to independently evidenced subledgers/statements, or have approved immaterial/time-bound exceptions.
5. Wallet and gateway clearing are separately identifiable and reconciled, or the combined account is explicitly unresolved and cutover is blocked for affected reporting.
6. Decimal and BS/AD date tests pass across source, GL, reports, tax periods, and exports.
7. Statement outputs use posted ledger sources, are traceable to journals, and include appropriate statement notes and exceptions.
8. Close, approval, audit trail, period locks, and access controls are demonstrated in UAT.
9. Nepal CA, management, and independent reviewer sign-off is recorded; no one person's approval substitutes for the others where duties require separation.
10. Rollback, monitoring, operator training, and post-deployment reconciliation ownership are ready.

## 8. Official reference points

Use the current published versions and confirm applicability with a Nepal CA:

- [Inland Revenue Department (IRD), Government of Nepal](https://ird.gov.np/) — current Acts, Finance Act publications, tax notices, and taxpayer guidance. The repository's Tax Compliance documentation also records limitations of the current application, including that its system record is not itself a legally issued bill or IRD electronic billing submission.
- [IRD: Value Added Tax Act, 2052 (as amended)](https://ird.gov.np/content/13407/value-added-tax-act--2052--as-amended/) — verify the version and amendments effective for the relevant period.
- [Office of the Company Registrar (OCR), Government of Nepal](https://ocr.gov.np/) — company registration and filing information; confirm the entity-specific Companies Act duties with counsel/CA.
- Nepal Accounting Standards Board publications and applicable standards should be obtained from the current official Board source and mapped to the company's legal form, size, and reporting obligations by the CA. Do not select NAS/NFRS solely from this software plan.

## 9. Repository evidence to maintain

Keep the implementation tracker, gap analysis, operations guide, and cutover runbook aligned with this roadmap:

- `docs/accounting/02-current-accounting-gap-analysis.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`
- `docs/accounting/05-accounting-operations-guide.md`
- `docs/accounting/06-sandbox-migration-and-cutover-runbook.md`
- `backend/services/accountingControlCoverageService.js`

When a gap is closed, update status only after its stated test/reconciliation evidence exists. “Code complete,” “unit tests pass,” “migrated in a developer DB,” “CA reviewed,” and “production approved” are different statuses and must remain distinct.
