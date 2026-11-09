# Accounting Implementation Plan And Iteration Tracker

**Owner:** Engineering + business/accounting approver  
**Last updated:** 2026-11-09
**Overall status:** Core recognition, payout mapping, bill/document controls, and the payout initiation/confirmation/failure lifecycle are implemented in code. The 2026-10-29 revalidation added strict manufacturer attribution and an Admin resolution path for legacy distributor settlement claims. Admin supplier-credit application is implemented against the existing return journal without a duplicate posting. Full Decimal writer migration, verified-source historical backfill, isolated-database migration 05 validation, and cutover remain incomplete.
**Scope:** Accounting/finance models, services, routes, UI, reports, tests and minimal event hooks only. Do not rewrite unrelated product/order/manufacturer/marketing/delivery/auth business behavior.

Manufacturer commissions were removed on 2026-10-28; historical postings remain, but the prior commission accrual requirements below are superseded.

## Goals And Invariants

The target is one authoritative, auditable financial ledger with source-linked subledgers. “No room for error” is treated as a request for enforceable invariants, safe retry/recovery and visible reconciliation, not as a claim that software can eliminate all operational/accounting error.

Hard invariants for the target design:

- Every posted journal has at least two non-zero lines; every line has exactly one positive side; total debits equal credits in integer minor units or a documented decimal representation.
- Posted entries are immutable. Corrections are new reversal/adjustment entries linked to originals.
- A source business event has a stable unique idempotency key; retry returns the same posting and cannot double-post.
- Journal, subledger, accounting event status and audit evidence commit atomically or remain durably pending for retry; no successful API response may silently discard an accounting failure.
- AR/AP are bill-wise and linked to stable party IDs; payments/receipts have allocations and immutable references.
- Financial reports derive from posted ledger entries/subledgers and reconcile to control accounts; discrepancies are visible and actionable.
- Money uses a documented currency, scale, deterministic rounding and database representation; JavaScript floating-point arithmetic is not the accounting authority.
- Manufacturer COGS/payable is recognized only under the owner-approved delivered/non-returned rule, using a locked approved cost snapshot and a manufacturer party key.
- Approved cost is snapshotted at manufacturer acceptance. Input VAT is claimable only with a valid manufacturer tax invoice; customer prices are VAT-inclusive. Post-delivery return to manufacturer reverses linked sales/VAT/customer settlement and COGS/payable; restock after receipt/inspection.
- Marketing CPA accrues per verified benefit redemption. Corporate tax remains estimate-only until accountant approval.
- Company is seller and collector for manufacturer-originated direct orders as well as storefront/admin orders.
- Block manufacturer acceptance unless every order line has approved agreed COGS; no commission approval is required.
- Delivery COD receivable and NCM carrier-fee payable remain gross and open until bank settlement confirmation.
- Accounting readiness gates finance/accounting operations only; product and customer order flows stay available.
- No external webhook, retry, duplicate command, or concurrent request can create duplicate financial effects.

## Target Architecture Direction (Provisional)

```text
Business source transition
  -> accounting adapter / durable AccountingEvent (source ID + version + snapshot)
  -> one posting service inside transaction/worker lease
  -> immutable JournalEntry + JournalLines
  -> bill-wise AR/AP, payment/receipt allocations, settlement subledgers
  -> audit event and idempotency record
  -> GL-derived statements and reconciliation reports
```

Use the existing unified RBAC for accounting permissions. Do not add a new auth system. Minimize business changes: add only the smallest transaction-aware adapter hook needed to capture a money event at the correct source transition. Do not make ordinary product/customer flows depend on an accounting service outage unless the owner explicitly accepts the readiness gate and its operational impact.

## Discovery Deliverables

| Deliverable | Status | Result |
| --- | --- | --- |
| `docs/accounting/00-current-architecture.md` | Complete | Current modules, models, routes, portals, flows and source-of-truth summary |
| `docs/accounting/01-accounting-dependency-map.md` | Complete | Cross-domain event/posting/settlement dependency map |
| `docs/accounting/02-current-accounting-gap-analysis.md` | Complete | Prioritized correctness gaps, risks and blocking accounting questions |
| `docs/accounting/04-target-accounting-domain-model.md` | Complete | Owner-approved policies, target entities, posting matrix and event contracts |
| `docs/accounting/checkpoints/iteration-02-recognition-and-acceptance.md` | Complete | Acceptance gates and recognition policies; 13 isolated tests pass |
| `docs/accounting/checkpoints/iteration-03-decimal-calendar.md` | Complete | Decimal/BS calendar subphase; migrations deployed and 22 isolated tests pass |
| `docs/accounting/checkpoints/iteration-04-operational-events-wiring.md` | Complete | Delivery, return reversal, Marketing CPA, and NCM settlement posting adapters wired; 41 isolated tests pass |
| `docs/accounting/checkpoints/iteration-05-subledger-documents-and-allocations.md` | Historical checkpoint | Document/allocation services exist; normal AP/AR controller paths are still not fully integrated |
| `docs/accounting/06-sandbox-migration-and-cutover-runbook.md` | Current gate | Sandbox migration, validation, rollback and production sign-off procedure |
| `docs/accounting-system-redesign.md` | Current target design | Consolidated accounting policy, source-of-truth, posting matrix, research limits, and staged implementation gates |

No runtime source, schema, frontend, database or accounting records were changed during discovery.

## Payment-Control Remediation Follow-up

| Phase | Result | Status |
| --- | --- | --- |
| A — Manufacturer recognition | New production COGS/payable is recognized at delivery; historical production-recognized layers retain compatibility handling. | COMPLETE |
| B — Production receipt gate | Manufacturer QA counts remain pending until Admin accepts them; only accepted good units enter stock/cost layers. | COMPLETE |
| C — Payout evidence | Manufacturer and distributor payout flows require and persist the external transfer reference. | COMPLETE |
| D — Manufacturer payable subledger | Delivered production creates bills; manufacturer payouts allocate to open bills; returns create supplier credit notes only when a delivery bill exists. | COMPLETE |
| E — Distributor legacy accrual | New requests without earning documents are recorded as reconciliation-required claims, not AP; pre-existing legacy AP requests retain their compatibility path. | COMPLETE |
| F — Treasury payout validation | Manufacturer, distributor, and generic payable payouts require an active NPR Treasury account mapped to the matching cash/bank/wallet GL account; the journal credits that mapped account. | COMPLETE |
| G — COD exposure | Admin settlement lists and payout results expose outstanding distributor COD and pending remittance; COD remains gross and is not silently netted against service earnings. | COMPLETE |
| H — Documentation and release gates | Operations, cutover, and iteration guidance updated below. | COMPLETE |

## Revalidation Follow-up (2026-10-29)

The approved remediation plan was checked against the current schema and routes before implementation. Stale plan snippets were not copied where they disagreed with the repository: `AccountingAllocation` stores `amount` (not `allocatedAmount`), and the current wallet clearing mapping is GL `1180` (not `1130`, which is receivables).

| Follow-up | Result | Status |
| --- | --- | --- |
| Manufacturer attribution | Settlement journal lines are attributed only through stable `supplierId` or manufacturer `AccountingParty` identity. Same-name records do not cross-attribute. Unattributed same-name legacy lines are surfaced as a reconciliation warning count. Completed payments are based on matching payable journal postings, not settlement-request totals. | IMPLEMENTED; focused tests pass |
| Distributor legacy request resolution | Admin can reconcile an unpaid legacy request to existing, open earning/bonus documents belonging to the distributor, provided the amount is covered and the documents are not reserved by another open request. Admin can instead reject an unsupported request with mandatory notes. Both decisions are audited and use a serializable transaction. No earnings are synthesized by this endpoint. | IMPLEMENTED; focused tests pass |
| Distributor Admin UI | The settlement screen exposes the review action, verified-document selection, and audited rejection path to users with `finance:payable_settle`. | IMPLEMENTED; Admin build required |
| Manufacturer supplier credits | Admin can apply a confirmed return credit only to the same manufacturer's bill for the same order, with balance guards, audit evidence, idempotency, and paired document allocations. It references the existing return-payable reversal and does not post a second journal. | IMPLEMENTED IN CODE; additive migration and isolated-database verification pending |
| Transfer lifecycle | Manufacturer, distributor, and generic AP payouts now reserve funds at initiation, post cash/journal/AP effects only after Admin records bank-statement evidence, and release reservations on a recorded failure. Initiated payouts are recoverable from the Admin payout list. | IMPLEMENTED IN CODE; isolated migration and database-backed transition/concurrency tests pending |
| Money precision/state convergence | Treasury, cash transaction, AP, AR, payout, and manufacturer settlement-request schema fields use Decimal in the staged migration. The preflight report is present, but not all application writers/readers use Decimal and full balance reconciliation is not complete. | PARTIAL; migration `20261029000005_financial_payout_lifecycle` and writer inventory/reconciliation required |
| Cutover/backfill | The supplier-credit migration was reported applied to an isolated test database. The user reports running `npm run db:push` against `local_dev`; this script synchronizes schema and runs seed data, but it does not apply or record migration 05. Its resulting schema state has not been verified. No dedicated isolated payout-test DB was used, and no historical source dataset has been identified or backfilled. Missing source earnings require verified evidence and an authenticated Admin approval record; approver contact is to remain null. | RELEASE BLOCKER |

These phases are implementation-complete, not production-approved. Existing unmapped Treasury accounts must be mapped and legacy accounting balances reconciled in an isolated sandbox. Do not pay a distributor request marked `LEGACY_EARNINGS_RECONCILIATION_REQUIRED` until source earnings have been backfilled/reconciled.

## Iterations

| Iteration | Objective | Status | Exit gate |
| --- | --- | --- | --- |
| 0 | Repository/accounting discovery and dependency map | COMPLETE | Findings reviewed; source-of-truth and current COGS mismatch documented |
| 1 | Freeze accounting/business policies | COMPLETE | Owner rules confirmed; accountant review for statutory classification and rounding remains a later gate |
| 2 | Recognition policy and acceptance snapshot | COMPLETE | Checkpoint `checkpoints/iteration-02-recognition-and-acceptance.md`; 13 focused tests pass; no database mutation |
| 3 | Precision, database foundation, COA/account mappings and periods | COMPLETE | Decimal schema and BS periods are migrated/validated; party/event/account mappings seeded and tested |
| 4 | Central posting service and durable idempotent accounting events | COMPLETE | Atomic balanced posting, immutable journals, stable idempotency, operational event wiring and 41 tests pass |
| 5 | Party master, bill-wise AR/AP, payments, receipts and allocations | COMPLETE | Partial/full/advance/overpayment allocation tests pass; manufacturer delivery bills and payout allocations are covered; remaining legacy balances stay explicitly identified |
| 6 | Cash, bank, petty cash and readiness controls | IN PROGRESS (partial) | Payout paths require NPR Treasury-to-GL mappings and use the mapped account; lifecycle is code-complete but needs isolated migration/DB verification; opening vouchers, legacy cash migration, full source reconciliation, and finance readiness remain |
| 7 | Sales, manufacturer COGS and delivery-triggered payable | COMPLETE | Delivered/non-returned rule, approved-cost snapshot, direct-order commission classification, COD/revenue event timing and idempotency pass |
| 8 | Customer/supplier returns, RTO and exchanges | COMPLETE | Original-event links, reversals, manufacturer supplier-credit notes for documented delivery bills, inventory/ownership treatment, refund and tax effects pass |
| 9 | Manufacturer, marketing-partner and NCM settlements | IN PROGRESS (legacy cutover remains) | Manufacturer delivery bills/allocations, NPR mapped payouts, payout lifecycle code, COD warnings, and gross COD/service-payable handling pass focused tests; legacy distributor claims have a safe Admin resolution path but need historical reconciliation and database-backed payout transition tests |
| 10 | Expenses, procurement, tax, assets, debt and equity | IN PROGRESS (partial) | Direct expense and Treasury movements now post atomically/idempotently; fixed-asset acquisition, period depreciation, write-off, and primary share issuance have transactional GL controls; tax-aware asset sales, procurement, other debt/equity domains, historical reconciliation, and CA policy approval remain incomplete |
| 11 | GL reports, statements, ageing and health reconciliation | IN PROGRESS (partial) | GL statement now includes key manufacturer/partner/carrier controls; report UI has no operational P&L/BS fallback; AP/AR/event coverage and ledger cash flow remain incomplete |
| 12 | Admin accounting UI and permissions | NOT STARTED | Existing required finance capability covered with drill-down, filters, statuses, warnings and exports |
| 13 | Failure, concurrency, security and portal regression | NOT STARTED | Duplicate/retry/out-of-order/concurrent/failure scenarios pass; customer/manufacturer/marketing/admin flows remain compatible |
| 14 | Cutover and final audit | IN PROGRESS (sandbox gate) | Sandbox migration runbook, reconciliation gate, rollback plan and accountant sign-off are documented; live deployment remains blocked |

### NCM return and settlement hardening increment

- NCM return requests now remain `RETURN_REQUESTED`: the order is not marked fully `Returned`, `returnedAt` is not set, and no refund, restock, sales/VAT/COGS reversal, or supplier credit is inferred from the carrier event.
- A return before delivery creates a zero-COD pending settlement. A return after delivery preserves the order's payment and original COD expectation; an already-settled remittance and its journal link remain intact. Delivery-fee and COD settlement-write errors propagate so the delivery transaction can roll back instead of acknowledging an incomplete settlement record.
- Focused evidence: **12 tests passed** in `backend/tests/deliveryAccountingOutboxIntegration.test.js`, covering manual and webhook return requests, missed-webhook status reconciliation, pre-delivery returns, post-delivery COD preservation, settled remittances, and failed settlement writes.
- Comparative provider review supports separate shipment/return legs, durable idempotent and timestamp-aware status ingestion, and separate carrier-status versus bank-settlement evidence. NCM's documented `/order/return` sets a vendor-return flag; it does not establish physical receipt. NCM exchange creation returns distinct vendor-return and customer-replacement order IDs. See the [operations guide](./05-accounting-operations-guide.md#104-ncm-returns-and-exchanges) and its cited provider documentation.
- Confirmed customer-return receipt now also recognizes NCM's `Sent to Vendor` label for an active NCM return; a generic `Delivered` status remains insufficient until the return is in transit. Warehouse receipt enables the existing inspection workflow only; it does not automatically restock or post refund/tax/accounting entries.
- Added Admin-triggered NCM status reconciliation for active customer returns. It polls the documented status history, processes timestamped events oldest-first, ignores pre-request updates, records the source and Admin actor, and fails explicitly on carrier errors or malformed responses. The Admin Returns panel exposes a refresh action without adding any automatic refund/restock/posting behavior.
- Final targeted run: **56 tests passed** across delivery accounting, NCM client, and return/exchange state suites; the Admin production build passed with its existing large-chunk warning. Targeted ESLint reports the component's existing missing `react/prop-types` declaration for `token`. No migration or database operation was performed.
- Still open: confirm NCM's exact operational meaning and webhook delivery of `Sent to Vendor`, verify carrier statement evidence with NCM, and run database-backed transaction, concurrency, recovery, and webhook replay tests. No migration, database operation, live-provider check, or accountant approval was performed in this increment.

### Supplier-credit application increment

- Added `SupplierCreditApplication` as an auditable application record and an Admin-only endpoint/UI action.
- The service verifies the posted `DELIVERY_RETURN` journal reverses manufacturer payable account 2160 for the same manufacturer, and that the credit note and bill are for that manufacturer's same returned order and currency.
- The application updates document balances using compare-and-set conditions, creates paired allocations tied to the existing return journal, records an audit event, and never posts another journal for the return.
- Idempotency replay is supported; reuse with different document/amount details is rejected. A caller cannot apply a different manufacturer's documents through another manufacturer's route.
- The supplier-credit migration was reported applied to an isolated test database; verify migration history and balances in the cutover runbook before relying on that environment.
- The user reports running `npm run db:push` against `local_dev`. That command is not `prisma migrate deploy`; do not infer migration history or isolated-database readiness from it. Its target schema/seed effects were not inspected by this session.
- Migration `20261029000005_financial_payout_lifecycle` is staged but not confirmed deployed through migrations or validated in a dedicated isolated database. Code generation and unit tests do not establish database migration correctness or production readiness.
- The payout lifecycle requires Admin review of bank evidence before settlement. It does not automate bank confirmation.
- Full Decimal migration, historical backfill, isolated-database reconciliation, and accountant approval remain release gates.

## Loan accounting integrity follow-up (2026-11-09)

- Loan disbursement now requires the actual mapped NPR Treasury destination. The loan liability, Treasury balance, cash transaction, and GL journal are written in one serializable transaction; journal failure rolls back the source and cash changes.
- Loan repayment now requires the mapped NPR Treasury source and explicit principal/interest amounts that sum exactly to the payment. The account's unreserved balance and loan principal are guarded inside the transaction. The old monthly interest formula is displayed only as a guidance estimate and is not posted unless finance enters/validates the split.
- Repayment and disbursement requests use stable idempotency keys; mismatched key reuse is rejected. Focused service tests cover balanced posting inputs, retry replay, source rollback on posting failure, and mapped GL account selection. Final focused run: **61 passed, 0 failed** across loan, accounting poster/reporting, and financial calendar tests.
- Validation is code/unit-test evidence only. No database-backed migration, concurrency, recovery, or historical loan reconciliation was run. Loan schema amounts remain `Float`; this does not complete the roadmap's Decimal phase. Other financing/equity behaviors and CA review remain open.

## Fixed-asset acquisition integrity follow-up (2026-11-09)

- Fixed-asset creation, Treasury deduction and cash transaction, payable document, asset-to-payable link, and acquisition journal now run in one Prisma transaction. A journal or source-write error rolls the transaction back instead of leaving an unposted asset or cash movement.
- Paid acquisition validates an active NPR Treasury mapping and credits the corresponding GL account (1110/1120/1180), rather than hard-coding Bank (1120). The conditional Treasury update checks the unreserved balance and detects a concurrent balance/reservation change.
- The Admin request reuses an idempotency key for an unchanged form submission. The API derives a stable asset tag from that key, returns an existing matching acquisition on retry, rejects changed purchase details, and gives paid cash transactions a unique idempotency key.
- A focused journal test verifies that a partial purchase debits the asset account and credits both the mapped Treasury account and Accounts Payable with balanced totals.
- At this checkpoint, depreciation atomicity and period idempotency were not yet addressed; the following iteration records that follow-up. Asset disposal and full fixed-asset control reconciliation also remain open. No schema migration, DB-backed concurrency/recovery validation, historical reconciliation, or CA review was performed.

## Fixed-asset depreciation integrity follow-up (2026-11-09)

- Depreciation now uses a stable `ASSET_DEPRECIATION:BS-YYYY-MM` key from the configured Bikram Sambat accounting period. A posted period batch is replay-safe, including detection of earlier depreciation journals dated within the same BS period, and the UI reports that the period has already been processed.
- Asset book-value and accumulated-depreciation updates use conditional updates within a serializable Prisma transaction together with the GL journal. Journal failure or a conflicting source update aborts the batch; errors are returned explicitly instead of a success-shaped response.
- The endpoint now accepts exactly one month per batch to keep period identity unambiguous. Focused service tests cover period selection, atomic rollback, retry behavior, and rejection of multi-month input.
- This is a technical integrity control, not a CA-approved depreciation policy. Start-date/available-for-use rule, missed-period catch-up, disposal/impairment, reconciliation to GL, and database-backed concurrency/recovery remain open. No migration or historical data correction was performed.

## Fixed-asset write-off integrity follow-up (2026-11-09)

- Damage/write-off now commits asset status/book derecognition and its journal together in a serializable transaction. The journal clears gross category cost and accumulated depreciation, recognizes the net book-value loss, rejects an asset whose register values do not reconcile, and uses an idempotency key that rejects payload mismatches.
- The UI no longer offers the previous unjournaled “sold”/salvage-receipt path. Backend requests for sale proceeds fail closed until the CA-approved tax/VAT sale treatment is implemented; write-off with no proceeds remains available. The finance guide and control coverage now describe this limitation accurately.
- Focused poster tests verify balanced write-off and gain/proceeds journal shapes, and reject unreconciled asset amounts. These are unit-level checks; transaction rollback/concurrency against an isolated database, tax policy, and full asset-to-GL reconciliation remain pending. No migration or historical correction was performed.

## Direct operating-expense posting integrity follow-up (2026-11-09)

- The direct expense endpoint now requires an idempotency key, validates the requested cash/credit split, and transactionally records the mapped Treasury deduction/cash transaction, payable document, and GL journal. Journal failures roll back the source effects, and retries with changed details are rejected.
- Partial-expense journals debit the expense account and credit the paid Treasury portion and remaining AP portion separately. Treasury spend is guarded against reservations and concurrent balance changes.
- Focused poster tests verify mapped cash/AP split balance and reject mismatched allocations. No isolated-database rollback/concurrency test, historical expense reconciliation, or CA/tax review was performed. The generic cash outflow is covered in the following Treasury direct-entry iteration.

## Treasury direct-entry and transfer integrity follow-up (2026-11-09)

- Treasury inflows, outflows, and internal transfers now require stable request idempotency and use one serializable transaction for Treasury balance changes, cash-log records, and mapped double-entry journals.
- Internal transfers debit the destination GL mapping and credit the source mapping; allowed direct receipts post to Other Income only, and direct outflows are restricted to operating expenses or drawings. Unsupported categories such as sales are rejected and must use dedicated accounting flows.
- Spend checks exclude reserved balances and use conditional account updates. Retry payload mismatch is rejected, and journal failures prevent partial Treasury/cash effects.
- Focused poster tests cover receipt, expense, drawings, transfer, retry, and unsupported category behavior. Database-backed rollback/concurrency validation and independent statement-to-bank reconciliation remain outstanding.

## Delivery Accounting Outbox Follow-up (2026-10-17)

- NCM and distributor self-delivery transactions persist a minimal version-1 source snapshot and SHA-256 payload hash in `AccountingEvent` with the delivered state change.
- A scheduled worker claims due events with a database compare-and-set, retries transient failures with bounded exponential backoff, and recovers stale `PROCESSING` claims. Posting uses the same transaction-scoped client; the journal and event `POSTED` transition commit together.
- Accounting report/reconciliation APIs return unresolved event counts and a bounded event list. Admin accounting pages warn that these amounts are not part of posted ledger totals until journal posting succeeds.
- Focused test run: `node --test tests/accountingOutbox.test.js tests/accountingOperationalPosters.test.js tests/distributorSelfDeliveryAndFinance.test.js tests/deliveryAccountingOutboxIntegration.test.js` — **32 passed, 0 failed**. The NCM test confirms delivery state and outbox enqueueing share one transaction. Prisma schema validation passed in the prior validation pass.
- Migration `20261017000000_delivery_accounting_outbox_schedule` is unapplied. Prisma Client generation is pending because the running Windows backend process held the native engine DLL; do not terminate that process as part of this work.
- Remaining release checks: isolated-database claim concurrency/recovery test, Prisma Client generation, migration and post-migration verification in an approved environment, then deployment/worker monitoring. Do not claim project-wide ledger snapshot consistency from this slice.

## Iteration Checkpoint Template

For every implementation iteration, update this tracker and create a concise checkpoint containing:

```text
Iteration and objective:
Accounting policies assumed/approved:
Files inspected and changed:
Schema/migration changes:
API/UI changes:
Business layer touched: NO / YES (if YES, justify the minimal hook)
Invariants verified:
Security/RBAC verified:
Tests run / passed / failed:
Duplicate/retry/concurrency results:
Reconciliation results:
Portal regression: Admin / Manufacturer / Marketing / Customer
Known issues and next gate:
```

Do not mark an iteration complete because it compiles. It is complete only after its stated accounting invariants, focused tests, integration checks, reconciliation gates and review are satisfied.

### Equity control increments

- The issuance endpoint now requires an active NPR cash/bank/wallet account with the existing Treasury-to-GL mapping and posts to that mapped code (1110, 1120, or 1180); Share Capital remains the existing credit classification pending CA approval.
- Cap-table dilution/investor updates, the compare-and-set Treasury balance increase, cash receipt, valuation, share transaction, and journal are executed in one serializable transaction. Journal failures are surfaced and roll back the operational changes.
- Admin sends a stable idempotency key. A posted retry returns its existing valuation/investor/source records; mismatched request reuse is rejected. Missing prior source records result in a finance-review conflict rather than an invented success response.
- Focused poster coverage validates mapped-wallet GL posting and caller-transaction use. Route-level rollback/retry/concurrency validation still requires isolated database testing; company-law allotment evidence, historical cap-table reconciliation, CA approval, and production cutover remain release gates. This iteration does not change share premium policy or claim statutory compliance.
- Company buyback now requires an active mapped NPR Treasury account and checks unreserved funds. Treasury, share retirement/cap-table rebalance, cash record, immutable share transaction, and the existing Share Capital (3100) debit/mapped Treasury credit journal commit atomically. Buyback API errors are surfaced with conflict/error status rather than success-shaped responses.
- Buyback Admin requests carry stable idempotency keys; unchanged retries replay the posted journal result, and changed-payload reuse is rejected. Focused tests cover mapped-account journal posting, atomic rollback after posting failure, idempotent replay, mismatch rejection, insufficient available balance, and missing mapping.
- Peer-to-peer transfers update seller/buyer shares, ownership percentages, and the transfer ledger in one serializable transaction; compare-and-set checks guard both parties, and transaction failures roll back all changes. The share ledger has nullable unique idempotency-key and payload-hash fields, with an additive migration; same-key retries replay the original transfer and changed-payload reuse is rejected.
- A private secondary sale does not change company cash or company contributed capital. Existing buyers' `currentCapital` is no longer increased by the private purchase price, and new secondary buyers start with zero company `initialCapital`/`currentCapital`; agreed private consideration remains on the PRIVATE_PEER_TO_PEER share transaction.
- Peer-transfer focused tests cover replay, mismatch, existing/new investors, total-share conservation, seller exit, capital neutrality, invalid/insufficient shares, and rollback on a ledger-write failure. Schema validation and isolated clean/populated migration tests remain required before deploying the additive migration.
- Share counts/ownership continue to use legacy Float fields, and the cap-table overview retains a 100,000-share fallback that may not match the legally issued/outstanding share register after non-standard allotments or repurchases. Reconcile against the statutory register and obtain CA/company-secretary approval of authorized-versus-issued-share rules before changing denominator or fractional-share policy. Historical capital fields and classifications also need reconciliation. No database operation was performed.
- Final validation: **142 backend test files passed; 10 database-integration files skipped**; 10 focused peer-transfer/buyback tests passed; `npx prisma validate`, `npm run check:migrations`, targeted Admin ESLint/build, syntax checks, and `git diff --check` passed. The Admin build retains its existing large-chunk warning. Prisma Client generation and migration application were not run; regenerate the client and validate/apply the migration only against the verified isolated database before deploying this service code.

## Stop Conditions

Pause and request a decision if inventory ownership, manufacturer payable trigger/basis, post-delivery return behavior, commission/CPA recognition, COD settlement, VAT/tax rules, fiscal year/currency, cash opening balances, or allowed readiness gating remains ambiguous. Do not invent accounting policy, seed fake opening balances, run live-DB accounting tests, reset a database, or remove current finance features before caller/dependency review.