# P5-R9 — Supplier Payable Correction and Bill-Allocation Integrity

**Review date:** 2026-11-18

**Status:** **IMPLEMENTED FOR THE VERIFIED SOURCE-LINKED EXPENSE-BILL CORRECTION PATH; MOCKED TESTS PASS**

**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.

## 1. Scope and evidence boundary

P5-R9 addresses the P5-R8 code finding that generic payable correction restored the legacy payable, Treasury and journal while leaving a linked expense-bill allocation and `AccountingDocument` balance unchanged. The change is limited to allocation reversal and bill balance/status restoration when the existing payable contains a supplier-party link. It does not add procurement, receiving, inventory costing, or a new payment workflow.

No database connection or inspection, `localhost:3306/clothing` access, migration, seed, reset, historical rewrite, production supplier access, bank/provider access, or external statement review was performed. No schema change was made. Tests use mocked/in-memory Prisma methods; they do not prove persisted transaction behavior.

## 2. Mounted route and service trace

| Step | Production path | Evidence and effect |
|---|---|---|
| Expense-backed bill creation | `POST /api/expense/add` and `POST /api/finance/record-operating-expense`; expense controller/service and accounting posting create the `OperatingExpense`, legacy `AccountPayable`, and source-linked `AccountingDocument` within the existing expense transaction. | The bill source is `sourceType: OPERATING_EXPENSE`, `sourceId: AccountPayable.referenceId`, and its `partyId` is the payable's `accountingPartyId`. This remains an expense bill; it does not evidence received inventory. |
| Payout initiation and confirmation | `POST /api/finance/settle-payable`; `settlePayable` initiates `FinancialPayout`. On `CONFIRM`, `confirmFinancialPayout` calls `finalizeAccountPayablePayout`. | The finalizer records the AP settlement history and Treasury cash movement, posts the `SUPPLIER_PAYMENT` journal, and allocates the settlement amount to the exact source bill using idempotency key `ACCOUNT_PAYABLE_PAYOUT:<payoutId>`. These are internal records; a user-entered bank reference is not independently verified bank evidence. |
| Correction request | `POST /api/finance/revert-settlement`, protected by `authenticate` and `authorize("finance:payable_settle")`; the controller also requires the authenticated role to be `ADMIN`. | The controller submits `SETTLEMENT_CORRECTION` to `requestAccountingActionApproval` with a caller idempotency key. No financial state changes at request submission. |
| Independent review and execution | `POST /api/accounting/approval-requests/review`, protected by `authenticate` and `authorize("accounting:approval_review")`; `reviewAccountingActionApproval` rejects maker self-review and executes approved actions. | `executeApprovedAction` calls `correctSettledTransaction` using the review transaction client. Correction, journal reversal, approval state/event, and audit writes share that serializable transaction. |

The generic correction selects the latest referenced `AccountPayable.settlementHistory` entry, resolves its `CashTransaction` and posted source `SUPPLIER_PAYMENT` journal, and loads the related settled payout when present. For a payable with `accountingPartyId`, the correction requires exactly one `PAYABLE`/`BILL`/`OPERATING_EXPENSE` document matching the payable party and reference. It then identifies only the allocation for the payout's exact idempotency key; if no payout row exists, it requires exactly one cash allocation linked to the posted source journal and bill.

Relevant implementation: [financialRoute.js](../../backend/routes/financialRoute.js), [financialController.js](../../backend/controllers/financialController.js), [accountingRoute.js](../../backend/routes/accountingRoute.js), [accountingController.js](../../backend/controllers/accountingController.js), [accountingActionApprovalService.js](../../backend/services/accountingActionApprovalService.js), [accountingSubledgerService.js](../../backend/services/accountingSubledgerService.js), and [settlementCorrectionService.js](../../backend/services/settlementCorrectionService.js).

## 3. Accounting invariants applied

For the selected bill and allocation, correction now requires:

- The bill is uniquely identified by party, payable side, bill type, operating-expense source type, and source ID.
- The target allocation is a `CASH` allocation for that bill and original posted payment journal. For current payouts, its key must resolve from the exact payout ID. A non-null allocation cash-transaction link must match the corrected cash transaction.
- The allocation amount is positive and exactly equals the settlement amount in the AP history. Cash paid and bill settlement amount remain distinct where a discount or fine was recorded.
- The document's original amount equals allocated plus remaining amount; no amount is negative; its existing status agrees with the current exact Decimal balances.
- The target amount does not exceed the valid allocated amount or restore the remaining amount above the original bill amount.
- No reversal allocation already links to the target through `reversesAllocationId`, and the deterministic correction-allocation key is unused.

The original allocation remains immutable. Correction writes a `REVERSAL` allocation linked through `reversesAllocationId`, with the reversal cash transaction, reversal journal, target amount, reason/evidence references, and a deterministic idempotency key. The bill's allocated amount decreases by exactly that allocation, its remaining balance increases by the same amount, and status is derived as `OPEN`, `PARTIALLY_PAID`, or `PAID`. Existing allocations from earlier payments or other valid sources remain in the bill balance.

## 4. Before-and-after behavior

**Before:** Generic `PAYABLE` correction restored legacy `AccountPayable` amounts/status, Treasury, and journal; it could mark the payout reversed. It did not reverse the linked supplier-bill allocation or restore the bill's `AccountingDocument`, leaving operational AP and document balances inconsistent.

**After:** When `accountingPartyId` establishes the existing expense-bill link, correction validates the exact bill allocation and reverses it atomically with the existing Treasury/AP/cash/journal/payout/reversion/audit operations. Missing, ambiguous, already-reversed, mismatched, or over-reversal evidence fails closed before financial mutations. When `accountingPartyId` is absent, no supplier-bill allocation is inferred and the existing generic payable correction behavior is preserved for legitimate non-bill payables.

The customer `RECEIVABLE` and Marketing CPA branches are unchanged. No purchase/receipt, supplier-return, payment-initiation, Treasury-posting, inventory-costing, or historical-record behavior changed.

## 5. Transaction, authorization, idempotency, and audit guarantees

- The correction service uses a serializable transaction when invoked directly. The mounted approval path passes the approval transaction client, so allocation reversal, document restoration, existing Treasury/AP/cash/journal/payout changes, `SettlementReversion`, approval events, and audit records are committed or rolled back together.
- The `AccountingDocument.updateMany` uses the observed allocated amount, remaining amount, and status as compare-and-set conditions. The payable and approval updates retain their existing conditional state checks.
- `AccountingAllocation.reversesAllocationId` and the deterministic reversal idempotency key prevent a second allocation reversal for the same source allocation. Existing `SettlementReversion` and approval state/replay checks remain in force.
- Exact approval-request replay by the same maker returns the existing request. Reusing the request key with a changed normalized payload fails with `IDEMPOTENCY_KEY_REUSED`. An approved/reviewed request is not executed again on an exact review replay. Maker self-review remains forbidden.
- The correction audit includes bill document ID, reversed allocation ID and amount in addition to the prior AP/Treasury/journal correction details. Actor attribution continues to identify the independent reviewer.

The current generic path selects the latest settlement-history entry and has a record-level existing-reversion guard. It therefore still does not support correcting multiple different payouts against the same `AccountPayable` record after one correction has been recorded. P5-R9 reverses only the selected payout's allocation and preserves other bill allocations; it does not broaden correction eligibility to multiple corrections per payable.

## 6. Regression tests

Run from `backend/`:

```powershell
node --test .\tests\settlementCorrectionService.test.js .\tests\accountingActionApprovalService.test.js
```

Result: **26 passed, 0 failed, 0 skipped**. `npm run build` passed (Prisma Client generation); `git diff --check` passed.

Focused mocked/in-memory coverage includes:

- Full bill allocation reversal and reopening.
- Partial reversal when an earlier allocation remains against the same bill.
- An unlinked payable continuing through the existing generic correction path.
- Missing allocation, already-reversed allocation, over-reversal, and allocation/settlement amount mismatch rejection.
- Bill balance/status updates, reversal allocation linkage, and correction audit details.
- Injected reversal-allocation failure with a test transaction wrapper restoring its in-memory state.
- Approval request exact replay, changed-payload conflict, and maker self-review enforcement.
- Existing generic payable, receivable, Marketing CPA correction and payout-state regression cases.

The in-memory rollback wrapper demonstrates that the service invokes all mocked changes inside its serializable transaction boundary. It does **not** establish Prisma/MySQL rollback, database constraints, persisted isolation/concurrency behavior, deployed migration state, or actual supplier/AP accuracy. Concurrent correction attempts still require isolated-database validation.

## 7. Remaining validation and remediation

Before asserting persisted accounting correctness, use a separately verified, isolated database to validate representative expense bills with zero, partial, multiple, discounted/fined, already-reversed, and mismatched allocations; transaction rollback; duplicate/concurrent approvals; and source-to-AP/document/allocation/journal balances. Do not use the configured local or production database without separate authorization and isolation checks.

Supplier statement matching, bank outflow verification, legal supplier identity, goods receipt, accepted quantities, inventory acquisition cost, and AP-to-2110 completeness remain outside this correction and require independent source evidence and the approved workflows/policies. A correction evidence reference remains internally recorded, not independently authenticated.

## 8. Separate workstream status

| Workstream | Status |
|---|---|
| P5-R9 | **IMPLEMENTED FOR THE VERIFIED SOURCE-LINKED EXPENSE-BILL CORRECTION PATH; MOCKED TESTS PASS** |
| Phase 5 | **PARTIAL / INCOMPLETE** |
| R8 semantic monetary-field register | **PARTIAL** |
| P4.2 | **INCOMPLETE** |
| P4.3 | **IN PROGRESS, INCOMPLETE** |
| Phase 4 | **INCOMPLETE** |

No Phase 6 or Phase 7 work was started.
