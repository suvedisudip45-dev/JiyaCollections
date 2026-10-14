# Accounting System Audit and Remediation Plan

**Prepared:** 2026-10-15  
**Status:** Phase 0 source review complete; the first delivered-sale outbox slice is implemented, with migration and rollout validation still gated.  
**Purpose:** Evidence-based starting point for making accounting postings, reports, and operational records consistent, current, and reconcilable. This is not an accounting, tax, or legal compliance opinion.

## 1. Executive summary

The project already has a useful accounting foundation: Decimal-valued journal entries and lines, a balanced posting helper, unique journal idempotency keys, Nepali fiscal periods, account mappings, permission-protected accounting routes, and some source workflows that pass a Prisma transaction client to the poster.

It is not yet one end-to-end accounting source of truth. The operational finance domain still has independent balances and records, and some business paths return success even when their GL post is missing or fails. The GL reports are journal-derived, but their current query patterns can read different commits within one response, and one statement builder has bounded-looking output but reads every qualifying journal line into application memory. Some statement classification is hardcoded to account codes. The data supports useful diagnostics, but a “latest shared version” or consistent as-of snapshot is not yet an explicit report contract.

**Recommended design interpretation of “same latest version”:**

1. Posted journal lines are the authoritative accounting facts; posted history is immutable and corrected with linked reversals/adjustments.
2. A posting's source event, operational mutations owned by the accounting workflow, journal, GL balance cache (if retained), and audit/outbox record must commit atomically, or have a durable, visible, idempotent recovery state.
3. A report is computed from one defined database snapshot and returns its `asOf`/ledger revision and period. Related report panels should share that snapshot/revision or be obtained from one combined reporting response. Reports must not silently combine different reads or operational estimates.
4. Treasury, inventory, AP/AR, and settlement summaries remain their own domain records but must be explicitly mapped, source-linked, and reconciled to the GL. They must not independently masquerade as the authoritative profit-and-loss ledger.
5. A mutable account master-data revision is not the same as a posted-ledger revision. Changes to account mapping or reporting classification must be audited and must not rewrite the historical meaning of posted lines.

No database connection was used in this Phase 0 review. The repository declares and locks Prisma `5.22.0`; the actual MySQL server version and production data state remain unverified. The working tree already contained unrelated changes before this review; those files were not modified.

## 2. Review scope and limits

Reviewed the supplied remediation prompt; root and backend package context; the project accounting reference and redesign document; current accounting engine, money helper, GL controller/routes, relevant schema models, accounting migrations, expense/direct-income paths, Treasury GL service/controller, distributor settlement service, delivery and self-delivery posting call sites, inventory cost helper, and focused accounting tests.

Current accounting endpoints are protected by `authenticate` and accounting permission checks in `backend/routes/accountingRoute.js`. The review did not conduct a complete security assessment of every finance endpoint or a production-data reconciliation. Those remain mandatory before implementation/rollout.

The prompt is appropriately conservative about existing references being historical and about not editing business logic before verifying it. Existing documents have different snapshots and should not override current source. For example, repository search found no production caller for `postSalesOrderAccounting`; current delivered-sale integrations call `postDeliveredOrderAccounting`. Treat the former as a legacy/tested helper until its callers and historical postings are separately audited.

## 2.1 Implementation update — delivered-sale accounting outbox

The delivery failure mode in A-01 has an initial technical remediation in code. NCM and distributor self-delivery now enqueue a versioned, hashed delivered-sale snapshot in the same transaction as the delivered transition. A scheduled worker conditionally claims eligible events, retries transient failures with backoff, reclaims stale claims, and posts through the existing journal engine. The journal and event `POSTED` state are committed in the same journal transaction. Invalid snapshots become `BLOCKED`; unresolved event counts and sample order amounts are exposed to accounting APIs and shown in accounting screens, with an explicit warning that unposted amounts are excluded from posted GL figures.

This is a delivery-specific outbox slice, not a claim that every accounting source, report, and subledger now shares one consistent snapshot. The additive migration `20261017000000_delivery_accounting_outbox_schedule` has not been applied. Do not deploy the updated worker before applying the migration and regenerating Prisma Client in the target environment. No live database was used. Focused outbox/poster/self-delivery tests pass, including claimed-event posting, delivery-fee coverage, and an NCM transaction test that verifies delivery state and outbox event are committed in one transaction. An isolated database concurrency test remains a rollout validation item. Windows Prisma Client generation remains unverified because the active backend process held the native engine DLL.

## 3. Verified findings

Severity definitions: **High** means a realistic route can leave material operational/GL state inconsistent or misstate a report; **Medium** means a report, concurrency, valuation, or audit-control weakness that needs correction before relying on that path; **Low** means limited impact or usability. Severity is a prioritization aid, not a claim that a production loss has occurred.

### A-01 — Delivery can commit as delivered when its GL posting throws

- **Classification / severity:** Verified defect — **High**.
- **Evidence:** `backend/services/deliveryService.js` calls `postDeliveredOrderAccounting` with the in-transaction client and catches/logs its error inside the surrounding transition (`around L1291-L1321`). `backend/services/distributorSelfDeliveryService.js` likewise catches/logs the poster error while processing the delivered transition (`around L420-L445`).
- **Current behavior / failure scenario:** The poster can fail after inventory and order/delivery state are changed. Because the error is caught inside the caller's transaction callback, the callback may return normally and commit the delivery/inventory changes without the required journal.
- **Impact:** A delivered sale can be absent from the GL while the operational workflow appears complete; retries may not occur because the event is already marked delivered.
- **Correction direction:** If posting is required synchronously, let the failure abort the business transaction. If the source transition cannot share the accounting transaction, persist an accounting event/outbox with explicit `PENDING`/`FAILED` status and provide a safe retry/reconciliation path; never log-only success.
- **Migration / compatibility:** No historical rewrite is implied. A durable event/status link may need an additive schema migration after checking current `AccountingEvent`/source uniqueness. Preserve delivery API behavior except that required accounting failures must become explicit or recoverable.
- **Regression tests:** Inject poster failures in both delivery modes; assert either complete rollback or a durable failed event and visible non-success/retry state. Add duplicate delivery/retry coverage.
- **Implementation status (2026-10-17):** Durable enqueueing, retry/claim processing, linked journal posting and report/UI visibility are implemented for NCM and distributor self-delivery. An NCM transaction test verifies delivery state and outbox enqueueing use the same transaction. Isolated database concurrency verification, Prisma Client generation, migration application and deployment verification remain open; therefore this finding is mitigated in code but not rollout-closed.

### A-02 — Some expense and direct-income APIs succeed before GL posting, and the expense poster suppresses failures

- **Classification / severity:** Verified defect — **High**.
- **Evidence:** `backend/controllers/expenseController.js` writes Treasury, cash, and expense/payable records, then starts `postExpenseAccounting` without awaiting it (`around L190-L300`). The direct-income path likewise writes records before starting `postCustomerPaymentAccounting` asynchronously (`around L511-L552`). `postExpenseAccounting` catches and logs errors rather than rethrowing (`backend/services/accountingPostingEngine.js`, around `L1448-L1496`).
- **Current behavior / failure scenario:** A GL account mapping, closed-period, database, or validation failure does not prevent the API from returning success; in the expense poster, callers cannot even observe the rejection because it is swallowed.
- **Impact:** Treasury, expense/AP, and GL totals can diverge without a durable failed-post status or reliable retry identity.
- **Correction direction:** Move these writes into one transaction using the passed `tx` client, or introduce a durable, idempotent accounting event/outbox and expose pending/failed state. Do not suppress errors at the accounting boundary.
- **Migration / compatibility:** Add source/journal links or retry metadata only after checking existing source identifiers and duplicates. Keep API response shapes compatible while adding explicit posting status.
- **Regression tests:** Fail the poster after source validation; assert transaction rollback or durable failure state, no false success, and one journal on retry.

### A-03 — Direct/miscellaneous income is posted as customer-receivable settlement, not categorized income

- **Classification / severity:** Verified defect — **High**.
- **Evidence:** `createDirectIncome` calls `postCustomerPaymentAccounting` with a generated order/reference identity (`backend/controllers/expenseController.js`, around `L488-L552`). That helper debits cash/bank and credits account `1130` Accounts Receivable (`backend/services/accountingPostingEngine.js`, around `L1138-L1188`); it does not receive or use the income category.
- **Current behavior / failure scenario:** Recording a scrap sale, service fee, commission, or other direct income through this path can credit customer AR instead of the appropriate income account.
- **Impact:** Revenue classification and AR balances can be wrong while the journal remains arithmetically balanced.
- **Correction direction:** Create a dedicated income posting command with an approved category-to-account mapping and source identity, or link to an appropriate invoice/receivable when the income is genuinely on credit. Require explicit category mapping; do not infer an account from arbitrary user text.
- **Migration / compatibility:** Historical postings require read-only identification and accountant-approved reversal/adjustment; do not mutate old journal lines.
- **Regression tests:** Cover each configured income category, cash/bank mapping, source idempotency, and ensure AR is used only for actual credit sales/receivables.

### A-04 — Delivered-sale delivery fee and tender mappings do not use the complete order/payment evidence

- **Classification / severity:** Verified defect / policy-dependent consequences — **High**.
- **Evidence:** `Order` stores `deliveryFee` in `backend/prisma/schema.prisma` (around `L620-L621`). The live delivered-sale poster computes delivery charge from `order.deliveryCharge` or `deliveryOrder.customerDeliveryCharge` (`backend/services/accountingPostingEngine.js`, `L417-L435`). Self-delivery calls it without `deliveryOrder` (`backend/services/distributorSelfDeliveryService.js`, around `L435`), and the poster does not fall back to `Order.deliveryFee`. The poster chooses NCM COD receivable for every COD order and Bank for every non-COD order (`accountingPostingEngine.js`, `L503-L505`) without checking confirmed payment state or actual collector. The reversal helper repeats a subset of this tender selection (`L695-L765`).
- **Current behavior / failure scenario:** A self-delivered order with a nonzero checkout delivery fee can post no delivery-revenue/tax component. COD collected by a distributor is classified as NCM receivable. A non-COD order is mapped to bank based on method alone even if the passed order evidence does not show successful settlement.
- **Impact:** Revenue, VAT, cash/receivable ownership, settlement and refund/reversal figures may be misstated. No production loss is established from source inspection alone.
- **Correction direction:** Define a posted sale payload from immutable order, delivery and actual payment/collector evidence; reconcile `deliveryFee` to any delivery-order customer charge and reject/flag conflicting amounts rather than double count. Map tenders by confirmed payment/collection lifecycle.
- **Policy decisions:** Delivery charge taxability/VAT basis; treatment of paid online, unpaid non-COD, partial payment, NCM COD, distributor COD, payment gateway clearing, gateway fees, chargebacks, and refunds.
- **Migration / compatibility:** Backward-compatible poster inputs first; historical restatement only after dry-run and explicit approval.
- **Regression tests:** Include positive delivery fee on self-delivery and NCM, mismatched source values, COD collectors, paid/unpaid gateway orders, and reversals.

### A-05 — Distributor settlement payout mutates Treasury/request state without a matching GL payment entry in this execution path

- **Classification / severity:** Verified defect — **High**.
- **Evidence:** `executeAdminDistributorSettlement` in `backend/services/distributorFinanceService.js` decrements `FinancialAccount`, creates a `CashTransaction`, marks/creates a settled `DistributorSettlementRequest`, and audits the change inside a transaction (`L286-L420`). The function has no GL posting call, confirmed by its complete flow and repository search. The existing test asserts the cash/account/request updates but does not assert a journal (`backend/tests/distributorSelfDeliveryAndFinance.test.js`, around `L561-L610`).
- **Current behavior / failure scenario:** A successful distributor payout can reduce operational cash and mark the request settled without a debit to the applicable distributor-payable control and credit to the mapped Treasury GL account.
- **Impact:** Treasury and GL cash/payables can disagree; payout reconciliation and period reports can be wrong.
- **Correction direction:** Establish the payable-accrual source and map, then make settlement payment, Treasury movement, request state, accounting document/allocation (if used), GL journal and audit atomic and idempotent. Avoid adding a payout journal until the payable/accrual policy and control account are confirmed.
- **Migration / compatibility:** Add stable payment identity/GL source link only after duplicate and historical-payout diagnostics. Preserve the existing permission and response contract.
- **Regression tests:** Assert correct debit/credit, insufficient funds, duplicate/concurrent payout safety, atomic rollback and reconciliation to the open distributor payable.

### A-06 — Report reads are not guaranteed to be one shared ledger snapshot; report paths are unbounded or N+1

- **Classification / severity:** Verified defect — **High** for report consistency; **Medium** for performance.
- **Evidence:** `getTrialBalanceReport` in `backend/controllers/accountingController.js` queries prior and period journal lines separately for every account (`L373-L493`) without wrapping the report reads in one transaction/snapshot. A posting committed between queries can make rows reflect different ledger states. It aggregates Prisma Decimal values using JavaScript `Number` and declares balanced within a five-cent tolerance (`L398-L493`). `getRealtimeFinancialStatements` fetches all journal lines through the report end date into memory and separately fetches accounts (`L521-L585`), then computes report figures in-process. General Ledger also loads all prior and period lines for the requested account without pagination (`L245-L350`).
- **Current behavior / failure scenario:** Concurrent posting during a multi-query trial balance may yield a mixed-state response. Large ledgers can produce high memory use and long response times; concurrent account fetch and journal-line fetch are also not an explicit shared snapshot.
- **Impact:** A report can be stale/internally inconsistent for the instant it is returned, and query cost scales with account count and ledger history.
- **Correction direction:** Define one report snapshot/as-of contract. Prefer bounded, database-side grouped aggregates and one consistent transaction/read snapshot or a persisted report run/revision where required. Add stable pagination to detailed GL. Return `asOf`/revision metadata. Preserve exact decimal arithmetic and exact balance assertions; distinguish unavailable data from zero.
- **Migration / compatibility:** Likely no schema change for aggregate/read-snapshot optimization. A ledger revision/report-run table is optional and should be justified by cross-panel snapshot requirements. Maintain response fields while adding revision metadata.
- **Regression tests:** Seed journals before/during report reads; assert repeatable snapshot semantics, exact debit/credit totals, correct period boundaries, pagination stability, and query-count bounds.

### A-07 — Financial statements classify accounts with hardcoded account-code lists

- **Classification / severity:** Verified design defect — **Medium**.
- **Evidence:** `createAccount` permits new non-system accounts (`backend/controllers/accountingController.js`, around `L53-L89`). `getRealtimeFinancialStatements` groups P&L and balance-sheet amounts by explicit code comparisons and switches (`L614-L774`), not by a complete account reporting classification.
- **Current behavior / failure scenario:** A valid new/custom revenue, expense, asset, liability, contra, or equity account may be absent from statement totals unless code is also changed.
- **Impact:** GL journals can be balanced while P&L and balance-sheet presentations omit balances, potentially hiding statement differences.
- **Correction direction:** Add/validate statement-group metadata or a governed account-to-report mapping. Include all active posting accounts or report unmapped balances as exceptions; do not guess grouping for existing accounts.
- **Migration / compatibility:** Backfill classifications from current account codes under review; reject or visibly flag unmapped posting accounts before relying on statements.
- **Regression tests:** Add user-created accounts in each supported type and assert inclusion or an explicit unclassified-account exception.

### A-08 — Idempotency returns a prior journal even when a retry payload differs

- **Classification / severity:** Verified defect — **Medium**.
- **Evidence:** `postJournalEntry` returns an existing `POSTED` journal solely by `idempotencyKey` (`backend/services/accountingPostingEngine.js`, around `L249-L272`), while the new payload hash is created afterward and never compared. Event `sourceVersion` is hardcoded to `1` (`L332-L342`). The unique idempotency key prevents duplicate journal rows, but does not validate that the same key is being retried with the same accounting facts.
- **Current behavior / failure scenario:** The first call posts one amount; a later call with changed lines/date/source data but the same key reports the original journal as success.
- **Impact:** A caller may believe changed financial facts were recorded when the ledger still reflects old facts; audit/reconciliation evidence is misleading.
- **Correction direction:** Persist and compare a canonical payload hash/source version for a reused key. Return the existing journal only for an identical request; otherwise return a specific idempotency conflict. Define how source events evolve—new version/key or linked adjustment, never overwrite a posted journal.
- **Migration / compatibility:** Existing events have hashes; audit for missing or inconsistent hashes before enforcing new behavior. Keep identical retries backward-compatible.
- **Regression tests:** Same key + same normalized payload returns the same journal; same key + different payload/date fails safely and creates no second event/journal.

### A-09 — Generic reversal is not atomic with the original journal state change

- **Classification / severity:** Verified defect — **High**.
- **Evidence:** `reverseJournalEntryById` posts the reversal first via `postJournalEntry` and updates the original entry to `REVERSED` in a separate operation (`backend/services/accountingPostingEngine.js`, around `L1805-L1850`). It reads/checks the original before either write, outside a single transaction.
- **Current behavior / failure scenario:** If the original-status update fails after the reversal commits, the original can remain `POSTED` while a reversal exists. Two concurrent reversal attempts can both pass the initial status check; the unique reversal key may prevent a duplicate, but there is no atomic compare-and-set over the original and reversal.
- **Impact:** Original/reversal status, reporting, audit and retry behavior can diverge.
- **Correction direction:** In one transaction, lock or conditionally transition the original, create the linked reversal through the same `tx`, update both links/status, and create audit evidence. Enforce one reversal per original at the database level after checking existing data.
- **Migration / compatibility:** Check duplicate/missing `reversedEntryId` links before adding any uniqueness constraint. Keep reversals as new immutable journals.
- **Regression tests:** Failure injection between writes, two concurrent reversals, duplicate retries, closed-period reversal policy and linked balanced entry.

### A-10 — Treasury and other operational money use Float while posted GL uses Decimal

- **Classification / severity:** Verified design defect — **Medium**.
- **Evidence:** `FinancialAccount.currentBalance` and `CashTransaction.amount` are `Float` in `backend/prisma/schema.prisma` (`L977-L1002`); generic `AccountPayable`, `AccountReceivable`, `OperatingExpense` and `DirectIncome` amount fields are also floating-point (models around `L1366-L1413` and `L2912-L2950`). GL `Account.currentBalance`, journal totals and lines use Decimal(20,2) (`L1413-L1530`). `accountingMoney.js` correctly normalizes journal amounts with Prisma Decimal, but several operational/reporting paths convert values to `Number`.
- **Current behavior / failure scenario:** Values are rounded/coerced across distinct numeric representations and report calculations; repeated float calculations or conversions can create rounding drift or reconciliation tolerances.
- **Impact:** Minor paisa discrepancies can accumulate or be masked; Treasury-to-GL reconciliation may require tolerances and may not expose exact mismatches.
- **Correction direction:** Decide a currency/precision policy, then safely migrate authoritative operational money columns to Decimal or use a documented integer-minor-unit representation. Audit current data and all API serializers/consumers first. Avoid broad conversion without a backfill/rollout plan.
- **Migration / compatibility:** Additive dual-read/write or carefully staged Decimal migration; compare pre/post totals and handle invalid legacy values before constraint changes.
- **Regression tests:** Round-trip API/DB precision, aggregation, partial payment, tax rounding, and parity between Treasury ledger and mapped GL.

### A-11 — Treasury solvency checks are read-then-write in some operational paths

- **Classification / severity:** Verified concurrency risk — **Medium**.
- **Evidence:** `checkAccountSolvency` reads `FinancialAccount.currentBalance` and compares in application code (`backend/controllers/financialController.js`, around `L1643-L1662`). `createExpense` invokes that helper before a separate balance decrement transaction (`backend/controllers/expenseController.js`, around `L181-L198`). The decrement itself has no conditional balance predicate.
- **Current behavior / failure scenario:** Two concurrent expenses can each pass against the same starting balance and both decrement it; equivalent call sites should be audited before applying this finding beyond this path.
- **Impact:** Treasury can go negative or be overcommitted despite the solvency check; a GL-only change would not fix it.
- **Correction direction:** Use an atomic conditional decrement / row-locking strategy supported by the deployed MySQL version and check affected rows; make the business operation idempotent and include the journal in the same transaction.
- **Migration / compatibility:** No schema change necessarily required; verify isolation/version and all consumers.
- **Regression tests:** Separate DB connections, overlapping expense requests, exact balance boundary, one success/one conflict, no negative balance, no orphan journal.

### A-12 — Distributor delivery statements recalculate historical earnings using the current rate card

- **Classification / severity:** Verified operational subledger weakness — **Medium**.
- **Evidence:** `getDistributorFinancialStatement` resolves the active rate card and uses its delivery charge, bonus, commission and VAT rate while iterating historical delivered assignments (`backend/services/distributorFinanceService.js`, around `L30-L180`).
- **Current behavior / failure scenario:** Changing the active rate card can change previously displayed earnings for old deliveries unless the settlement request snapshot has already fixed them.
- **Impact:** Historical payable calculations may not be reproducible and can differ from what was approved or accrued.
- **Correction direction:** Snapshot approved rate/tax terms per assignment or accounting event at recognition time; preserve historical versions and settlement evidence. Confirm the contractual effective-date policy first.
- **Migration / compatibility:** Historical assignments without snapshots are ambiguous; do not backfill from today’s rate card as if it were historical truth. Use explicit exception status or approved source evidence.
- **Regression tests:** Change the active card after an earlier delivery and verify its prior recognized amount remains unchanged.

## 4. Existing foundations to retain

- `normalizeBalancedJournalLines` uses `Prisma.Decimal`, enforces at least two nonzero lines, rejects negative/both-sided line values and requires exact debit-credit equality (`backend/services/accountingMoney.js`).
- `JournalEntry.idempotencyKey` and `AccountingEvent.idempotencyKey` are unique; posted GL rows are Decimal(20,2); `FinancialAccount` can map to an Account through a foreign key.
- Some current flows use the transaction-scoped client correctly: the central poster accepts a client, the new Treasury accounting route posts within its transaction, and focused poster tests verify the client path.
- Accounting routes apply server-side authentication and granular permissions.
- Existing tests cover balanced posting, semantic mappings, duplicate-key idempotency, closed periods, certain delivery/return/settlement posters, and subledger allocation. These are a foundation, not complete acceptance coverage.

## 5. Open policy/owner decisions before affected implementation

Do not silently decide these as engineering defaults:

1. **Reporting framework:** Which Nepal framework and reporting basis does the accountant approve for statutory accounts versus internal management reports? ASB Nepal lists standards including NFRS and SME-related frameworks, but the app cannot determine the entity’s applicability.
2. **Inventory valuation and cost recognition:** Confirm the existing approved valuation method; capitalizable production costs; accepted-good-unit denominator; damaged/missing unit treatment; legacy-stock opening valuation; returns and write-offs; and the sale recognition trigger. Do not change FIFO/weighted-average or infer an opening value from current catalog cost.
3. **Tax/VAT:** Confirm applicable tax rates, inclusive/exclusive pricing, taxable delivery, discounts, invoice requirements, input VAT recoverability, tax rounding, refunds, and effective dates with a Nepal-qualified accountant/tax adviser.
4. **Sales/payment evidence:** Confirm exactly when revenue is recognized and how the source records indicate payment confirmation, collector, NCM COD, distributor-held COD, gateway settlement, split/partial payments, fees, failed payments and chargebacks.
5. **Carrier/logistics:** Choose a consistent policy for direct carrier expense versus carrier payable; confirm distributor delivery compensation and stock-transfer freight recognition.
6. **Distribution/retained earnings:** Confirm whether profit distributions are allowed, their approval basis, and year-end close/retained-earnings policy. The existing 55%-of-revenue COGS estimate is not GL profit.
7. **Historical corrections:** Authorize no write-mode backfill until dry-run variances, source evidence, correction approach and backup/recovery plan are reviewed.

## 6. Recommended execution sequence

1. **Finish Phase 0 audit:** Complete source/caller map for every finance mutation, settlement, return, asset, loan/equity, inventory valuation, permission, migration and report. Record which findings above are reproduced, which are source-verified only, and which are unresolved. Establish baseline only with an approved isolated database and representative data.
2. **Confirm policies:** Resolve only the relevant questions above with the owner/accountant. Separate statutory reports from management estimates.
3. **Harden the posting primitive:** Add same-payload idempotency validation, stable source-version semantics, transaction-client use, period checks, atomic linked reversals, explicit failure handling, and immutable-history tests. Add constraints only after checking actual data.
4. **Correct event adapters in risk order:** Delivered sale/COGS/tender; expenses/direct income; Treasury and settlement payments; returns/refunds; then fixed assets, loans/equity and other workflows. Each work item needs a source-to-journal link, one economic posting, atomicity or a durable recoverable status, and security/compatibility tests.
5. **Settle cost/subledger contracts:** Establish approved cost provenance and account mapping; make the AP/AR documents and party balances reconcile to GL controls. Do not estimate a missing posting into official reports.
6. **Unify report snapshots:** Use the same posted-line basis, account reporting metadata, fiscal boundaries and defined report snapshot/as-of token. Keep estimates explicitly labelled. Optimize with database aggregates and bounded/paginated detail; benchmark before/after.
7. **Dry-run and controlled rollout:** Reconcile journals/caches, Treasury, AP/AR, settlements, inventory and returns. Show exception counts and amounts. Obtain explicit write approval for historical corrections; use resumable, idempotent reversals/adjustments, audit logs, monitoring and recovery instructions.

## 7. Baseline validation and limitations

Ran from `backend/`:

```text
node --test tests/accountingMoney.test.js tests/accountingPostingEngineUnit.test.js tests/accountingMappings.test.js tests/accountingSubledger.test.js tests/accountingOperationalPosters.test.js
```

**Result:** 28 tests passed; 0 failed; 0 skipped. These are focused unit/harness tests and do not prove behavior against MySQL, concurrent connections, production data, routes, or real migration state. No DB integration tests, historical reconciliation, query-plan inspection, heap/RSS benchmark, or endpoint latency baseline was run in this Phase 0 review.

**Environment facts:** Backend package and lockfile specify Prisma `5.22.0`. The MySQL server engine/version and live migration state were not checked. Do not apply migrations, run seeds, reset/push the database, or run integration tests against a non-isolated database.

## 8. External design references

These are principles and comparative references, not policy authority for this company or code to copy:

- [ERPNext accounting entries](https://docs.frappe.io/erpnext/accounting-entries): business documents create balanced GL effects; sale recognition, inventory/COGS and payment are distinct events.
- [Modern Treasury ledger guarantees](https://docs.moderntreasury.com/ledgers/docs/ledgers-guarantees): balance, immutability, idempotency and atomicity guarantees.
- [Modern Treasury concurrency guidance](https://docs.moderntreasury.com/ledgers/docs/handle-concurrency): choose synchronous locking intentionally when a decision depends on current balance; avoid unsafe read-then-write.
- [IAS 1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/), [IAS 2](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/), and [IAS 16](https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/): presentation, inventory and PPE/depreciation standards to discuss with the accountant.
- [Accounting Standards Board Nepal publications](https://asbnepal.gov.np/publication): local standard-setting publications; entity applicability needs professional confirmation.

Core arithmetic checks include:

```text
For each posted journal and currency: sum(debits) = sum(credits)
At a statement snapshot: Assets = Liabilities + Equity
For a normal-balance account: closing = opening + debits - credits (debit-normal)
For a normal-balance account: closing = opening + credits - debits (credit-normal)
```

These equations detect inconsistencies but do not define recognition, tax, inventory valuation, or statutory presentation policy.

## 9. Audit conclusion

The prompt’s overall direction is suitable. Its strongest requirement should be implemented as **canonical posted facts + atomic/recoverable event posting + snapshot-consistent GL-derived reports + explicit operational reconciliation**, not as keeping several independently editable balance columns synchronized by copying numbers.

Phase 0 found source-level defects and test coverage gaps, but it has not yet established the company’s historical monetary variance or proved every finance workflow. The next safe step is to confirm the policy decisions relevant to the first remediation slice, then complete the remaining source/caller audit and produce read-only diagnostics before changing accounting behavior or historical balances.
