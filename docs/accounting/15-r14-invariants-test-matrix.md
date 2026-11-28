# R14 — Accounting Invariants and Test Matrix

**Review date:** 2026-11-16

**Status:** **PARTIAL** — this is a design/coverage map from source review, not test evidence or persisted reconciliation.

## 1. Evidence labels

Use the following distinctions in test reports and remediation:

- **REPORT-CALCULATION TEST:** verifies a calculation, classification, serialization or report over a controlled fixture. Does not prove the database contains all sources or postings.
- **PERSISTED SOURCE/SUBLEDGER TEST:** exercises real persistence and transaction behavior in an explicitly verified isolated database, then compares source to document/allocation/ledger rows.
- **SOURCE-TO-JOURNAL RECONCILIATION:** compares complete persisted business source, subledger, cash evidence, and journal/control-account populations for an explicit period/cutoff and explains exceptions.
- **EXTERNAL-SETTLEMENT RECONCILIATION:** additionally matches provider, carrier, bank statement or cash-count evidence to internal settlements. A mocked response or Treasury-to-GL comparison is not this evidence.

The existing source tests referenced by domain docs were not executed as part of R14. No persisted or external reconciliation was executed.

## 2. Cross-domain accounting invariants

| ID | Invariant | Scope / test evidence needed | Current assessment |
|---|---|---|---|
| INV-01 | Every posted financial effect has a stable business source identity, source type, actor and effective date; one source event cannot post twice. | Orders, returns, exchanges, production, AP/AR, payouts, Treasury, CPA, NCM. Unit/service replay test plus persisted uniqueness/concurrency test. | Idempotency/outbox patterns exist in selected paths; legacy writers and cross-path duplicates remain. **PARTIAL.** |
| INV-02 | Posted journals are balanced, immutable and attributable; corrections are linked compensating entries. | Journal engine, manual journal, payout, source reversal. Service test plus persisted audit/journal comparison. | Existing controls exist; reversal coverage is not universal. **PARTIAL.** |
| INV-03 | Source, subledger and journal effects are atomic where a workflow claims transactionality. | Production completion, collection, payout, expense, transfer, settlement. Inject failures at each write and verify no partial state in isolated persistence. | Transactional services exist; no persisted rollback test was run for R14. **BLOCKED.** |
| INV-04 | Monetary calculations use shared Decimal utilities; no monetary `Number` arithmetic/conversion in authoritative paths. | All source writers, allocations, aggregations, comparisons, sorting, serialization, UI and exports. Static audit plus behavioral tests. | Decimal remediation is incremental; Float schema and Number consumers remain. **PARTIAL.** |
| INV-05 | Preserve amounts as decimal strings across API and UI/report/export boundaries; no float-based display value feeds business logic. | API response schemas, Admin cards/statements, downloadable reports. API tests and UI/report tests. | Several bounded areas updated; end-to-end coverage across all domains not demonstrated. **PARTIAL.** |
| INV-06 | Use the approved internal NPR two-decimal HALF_EVEN rounding policy effective 2026-11-15 only at approved quantization boundaries; do not re-round silently. | Monetary ingress, allocation, journal and output. Boundary tests at half-cent values and serialization. | Policy is documented; source Float values may already have lost precision. **PARTIAL.** |
| INV-07 | A positive exact balance is not settled; allocations cannot exceed open document or eligible source amounts. | AP/AR, refund, payout and collection. Fractional residual plus over-allocation tests. | Some service paths enforce this; legacy booleans/readers and unallocated cases remain. **PARTIAL.** |
| INV-08 | Cash is recognized only from supported cash/settlement evidence, not from workflow approval, delivery, order paid flag or remittance status alone. | COD, customer collection, provider, payout, NCM and Treasury. Status-transition test plus external evidence reconciliation. | COD/order Boolean mismatch and missing provider model are known. **P1 GAP.** |
| INV-09 | Quantity, ownership, location, condition, reservation and valued cost layer remain consistent. | Production, transfer, fulfillment, return, damage/loss, legacy projections. Ledger tests and persisted quantity/layer reconciliation. | Canonical and legacy inventory paths coexist; layer lineage is partial. **P1 GAP.** |
| INV-10 | Return/exchange adjustments are capped cumulatively to original eligible sale quantity/value and reference original snapshots. | Concurrent and sequential partial returns/exchanges. Service tests plus database locking/uniqueness tests. | Workflow exists but universal cancellation/reversal and source population validation do not. **PARTIAL.** |
| INV-11 | Report totals use explicit source population, status and cutoff; no overlap between legacy and document sources. | Cards, statements, exports, aging, GL and analytics. Fixture population tests plus source-to-report query validation. | Report paths differ by source/date; full reconciliations absent. **P1/P2 GAP.** |
| INV-12 | Date cutoffs and aging are consistent with Kathmandu-local calendar handling; effective date and journal date remain distinct. | Due dates, sales/tax point, return and payment events, fiscal/year reports. Boundary tests and isolated persisted comparisons. | Helpers exist; different report paths use different timestamps. **PARTIAL.** |
| INV-13 | Maker-checker, workspace authorization and actor attribution are enforced before consequential state or ledger changes. | Payout, settlement, refund and financial approvals. Independent reviewer, self-review, missing-actor and rejected-mutation tests. | Controls exist in selected paths; do not weaken them; complete persisted validation not available. **PARTIAL.** |
| INV-14 | Failures, ambiguous external results and unknown settlement state remain explicit and reconcilable; no success-shaped fallback. | NCM, provider, payout and notification boundaries. Simulated timeout/replay tests plus external reconciliation. | NCM path has reconciliation mechanisms; payment-provider capture/settlement absent. **PARTIAL.** |

## 3. Event-level test matrix

| Domain | High-value report/service tests | Persisted tests required before claiming transactional correctness | Reconciliation required before claiming completeness |
|---|---|---|---|
| Sales and receipt | Undelivered vs delivered; COD is receivable not cash; split checkout fee/discount totals; replay outbox; receipt over-collection and partial allocation; decimal-string response | Concurrent outbox delivery, source/event/journal atomicity, receipt replay and rollback, cancellation of paid order | Delivered order lines to revenue/tax/COGS, receipt allocation to Treasury, COD remittance to statement/bank |
| Returns | Full/partial cumulative cap, discount/tax snapshots, accepted vs damaged/missing, refund approved vs paid, positive residual | Concurrent final eligible return, inspection/restock and refund allocation atomicity, replay after injected failure | Original sale to return quantity/value, stock and cost layers, refund obligation/payout/cash/journal |
| Exchanges | Up/down price difference, replacement quantity/cost, request replay and status retries | Duplicate dispatch/collection, cancellation at every transition after policy approval | Original/replacement sale legs, inventory, customer credit/receipt and journals |
| AP/AR | Expense linked unpaid/partial/paid, multiple sources, fractional/large amounts, zero balance, exact aging cutoff, credit notes/adjustments, decimal strings | Bill/credit allocation and payout/collection atomicity, concurrency cap, rollback and exact replay | Source expense/production/refund/CPA to document, allocation and mapped control account; payment evidence to Treasury and GL |
| Inventory/COGS | Production layer FIFO, insufficient/uncosted layer exception, transfer good/damage/missing, returns and manual adjustment | Competing reservation/issue, ledger/balance/layer atomicity, transfer replay and rollback | SKU/location/owner/condition movement to balances, layers, legacy projections and inventory/COGS controls |
| Expenses/procurement | Paid/unpaid splits, two-decimal policy, category mapping, credit and duplicate key | Atomic dual-writer behavior and purchase receipt/cost-layer linkage | Invoice/receipt/tax evidence to inventory/expense/AP/journal and cash |
| CPA/NCM/COD | Verified redemption accrual, payout replay, COD gross vs net fee, missing/late remittance and variance | Payout maker-checker, batch close/replay, ambiguous settlement state | Redemption and NCM batch source populations to liabilities, bank/provider statement and mapped controls |
| Loans/assets/equity | Decimal large/half-even tests, principal/interest split, depreciation date and remaining value, share/capital attribution | Approval/replay and atomic Treasury/journal/source updates | Lender schedule and bank statement; physical asset register and GL; owner/share register and evidence |
| Reporting/GL | Debits equal credits, exact reconciliation equality, source-scoped totals, cutoffs, decimal sorting/string serialization | Persisted report queries at isolated test data plus rollback behavior | Complete source, subledger, Treasury/external evidence and GL populations, with every difference owned |

## 4. Test anti-patterns to avoid

- Do not describe a mocked Prisma/client test as persisted transactional evidence.
- Do not describe a balanced journal as proof that all sources were posted.
- Do not describe a Treasury-to-GL equality as bank, provider, wallet, COD-carrier or cash-count reconciliation.
- Do not bypass an integration guard to make a test run or claim a database name is safe without verifying the endpoint is isolated.
- Do not write fixtures that mutate the production-configured `localhost/clothing` database.
- Do not test only helper arithmetic when the risk exists in the actual service's aggregation, classification, allocation, serialization or UI/export path.
- Do not assert only a rounded display value when the required outcome is an exact positive residual that remains outstanding.
- Do not create automatic journals or mutate balances to make a reconciliation report pass.

## 5. R15 ordered backlog proposal

R15 is a **PROPOSED remediation sequence**, not authorization to change policy, schema, production data or unrelated workflows. Each increment requires its own scope and evidence gate.

| Order | Candidate bounded increment | Reason / expected evidence | Dependencies and stop conditions |
|---:|---|---|---|
| 1 | Verify P4.2-R13 isolated-database prerequisites with DBA and retain independent endpoint/isolation evidence; run only safety-gated tests. | R13 remains PARTIAL/BLOCKED; persisted transaction and reconciliation work must not touch `localhost/clothing`. | No safe, independently verified isolated endpoint => stop before DB tests/migrations; continue code-level tests only. |
| 2 | Sales receipt/COD state semantics and paid-order cancellation gap analysis; select one narrow correction after business decision. | `Order.payment` is not actual receipt evidence; customer cancellation path may allow paid orders without compensation. | Do not alter delivery revenue recognition or refund policy without owner approval; preserve audit/idempotency. |
| 3 | Source-to-inventory/COGS reconciliation report for canonical ledger, layers and legacy projections (read-only first). | Active `Product.stockQuantity`, `ManufacturerInventory`, `StockLog`, layer fallback and purchase-receipt gaps. | No auto-correction or history conversion. Establish source-owner and approved costing policy first. |
| 4 | Complete one selected return/refund or exchange lifecycle, including policy decisions, exact amount/quantity caps, stock disposition, settlement and reversal tests. | Parallel routes and incomplete cancellation/reversal impair source completeness. | Select one lifecycle; do not generalize to all routes until persisted evidence and policy are approved. |
| 5 | Source-to-AP/AR document and allocation reconciliation by party, distinguishing new documents and legacy rows; start read-only. | Manual/legacy balances and source-linked documents are not one population. | Define treatment/ownership of unmatched legacy records; no automatic journals or balance migration. |
| 6 | Migrate one source writer from legacy AP/AR or stock representation only after read-only exception review, explicit mapping, backup/rollback and isolated rehearsal. | Reduces parallel sources and Number paths. | No production migration without separate authorization and validated isolated rehearsal; schema changes require migration safety gate. |
| 7 | External settlement reconciliation for one selected channel (NCM/COD, bank, wallet or provider) once source statements are available. | Existing Treasury-to-GL is not external cash reconciliation. | Requires genuine statement/evidence import and matching rules; no provider/government integration is implied by R14. |
| 8 | Continue remaining P4.2 source-path Decimal conversion and regression tests by bounded domain. | Float-backed loans/assets/equity, other reports, UI/export paths and source precision remain. | Follow approved helper/rounding policy; Decimalizing a Float does not restore lost historic precision. |

Do not begin P4.3 until all explicit P4.2 exit criteria in the tracker are met and independently evidenced.

## 6. R14 execution record

- No application code, schema, migration, test fixture, financial balance, or external integration was changed.
- No tests, builds, database connections, database diagnostics, seeds or migrations were run for R14.
- R14 evidence consists of static source/schema/documentation review and the specifications linked from [09-r14-business-event-inventory.md](./09-r14-business-event-inventory.md).
- Persisted source/subledger, source-to-journal, and external settlement reconciliation remain **BLOCKED / NOT PERFORMED**.

## 7. P4.2-R15 execution record (2026-11-16)

**Status: PARTIAL.** R15 implemented the safe delivery/payment-status distinction, a fail-closed paid/financially-active cancellation guard, explicit actual NCM deposit input, Decimal NCM batch/report calculations, and related Admin formatting. It did not create a canonical payment/refund ledger or complete the inventory of every report consumer with persisted evidence.

### Database-free test evidence

Command run from `backend/`:

```text
node --test tests\ncmSettlementService.test.js tests\adminOrderCancellation.test.js tests\distributorSelfDeliveryAndFinance.test.js tests\deliveryAccountingOutboxIntegration.test.js
```

Result: **64 passed, 0 failed, 0 skipped**. These tests use service/controller mocks and synthetic fixtures. The NCM reconciliation tests stub the HTTP provider; their logged simulated provider outcomes are not external settlement evidence.

Covered behaviors include delivery status not mutating payment state, pending distributor COD declaration remaining unpaid, explicit actual NCM deposit input, decimal-string/fractional batch output, HALF_EVEN summary rounding, changed-payload replay conflict, and cancellation blocked before mutation when order financial activity exists.

### Remaining tests and evidence

- **NOT TESTED:** Partial/failed/multiple COD collection, collection replay at a canonical payment-record layer, per-delivery collection amount differing from expected, and collection without remittance.
- **NOT TESTED:** Full/partial/multiple refund eligibility, pending/completed/failed/retried refund, over-refund prevention, original-payment linkage, refund reversal, and refund reports.
- **NOT TESTED:** End-to-end Admin/manufacturer/distributor direct-order payment posting and associated cash evidence; all sales/cash/refund reports and exports.
- **NOT TESTED:** UI behavior tests or browser verification. Admin targeted ESLint reported three `react/prop-types` errors in `DeliveryMonitor.jsx` (`CopyableId` and `DeliveryMonitor` props); frontend ESLint reported 0 errors and 1 existing React-hook dependency warning. No build was run at this point.
- **BLOCKED BY DATABASE VALIDATION:** Persisted transaction/replay/rollback/concurrency, source-to-subledger, source-to-journal, refund-to-cash, and external bank/carrier reconciliation.

No database was connected to, inspected, or modified. No migration, seed, provider call, or historical data conversion was run. The configured `localhost/clothing` database remains prohibited. R15 is **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **NOT STARTED**.

## 8. P4.2-R16 receipt lifecycle test evidence (2026-11-16)

Command run from `backend/`:

```text
node --test tests\distributorDeliveryOtp.test.js tests\distributorCashSettlement.test.js tests\distributorSelfDeliveryAndFinance.test.js tests\orderListProjection.test.js
```

Result: **43 passed, 0 failed, 0 skipped** using mocked Prisma clients and synthetic fixtures.

| Requirement | Database-free test evidence | Remaining evidence gap |
|---|---|---|
| Expected COD Decimal amount and HALF_EVEN | `distributorDeliveryOtp.test.js` tests half-cent ties, invalid/negative source amounts, and OTP amount binding. | Source values originate in Float-backed Order columns; no history is recovered. |
| Delivery is not receipt | `orderListProjection.test.js` proves delivered self-delivery COD with `payment=false` remains unpaid in the API projection. Existing self-delivery tests verify a non-OTP declaration stays pending. | Full portal/report/API population and persisted status consistency are not proven. |
| Collection actor attribution | `distributorSelfDeliveryAndFinance.test.js` verifies missing actor rejection before collection event write and that non-OTP events retain the actor. | No database-backed audit/source-link or actor identity reconciliation. |
| Remittance helper cannot exceed collected funds | `distributorCashSettlement.test.js` verifies no-collection rejection, partial remittance within verified collection, and over-collection rejection. Cash-position tests verify string amounts and cap calculation. | These are service-helper tests only: no production caller or routed submission endpoint for `submitDistributorRemittance` was found. The routed `COMPANY_COLLECTS` settlement-request flow does not use this cap. Persisted concurrency, reversal behavior, and physical custody remain unverified. |
| Idempotency and accounting writes | Existing `distributorCashSettlement.test.js` tests remittance replay, changed eligibility, Admin review accounting, and evidence requirements. | No persisted replay, uniqueness, rollback, or complete source-to-journal check. |
| Partial/failed collection, receipt corrections/reversals, direct-order receipts, advances, provider webhooks | Not implemented in this increment. | **NOT TESTED / NEEDS BUSINESS DECISION.** |
| External cash settlement | No provider or bank statement accessed. | **BLOCKED / NOT PERFORMED.** |

These are **REPORT/SERVICE-CALCULATION TESTS**, not persisted source-to-subledger checks or source-to-journal reconciliation. No database was connected to, inspected, or modified. No migration, seed, provider request, or historical data conversion was run. Persisted transaction/replay/rollback/concurrency, source-to-journal, and external settlement validation remain **BLOCKED BY DATABASE VALIDATION**.

**R16: PARTIAL. R8: PARTIAL. P4.2: INCOMPLETE. Phase 4: INCOMPLETE. P4.3: NOT STARTED.**
