# P5-R12 — Supplier Credit Application Approval Implementation

**Status:** Implemented in code using the existing approval schema and transaction architecture. Mocked tests pass. Persisted database validation was not performed.

## 1. Scope and findings

P5-R12 closes the mounted-route approval bypass for applying an existing internal supplier-return credit to a later supplier bill. It does not change supplier-return creation, stock reduction, credit-note creation, supplier refund, or inventory costing.

The existing Prisma `AccountingActionApproval` and `AccountingActionApprovalEvent` models already store the request key and payload hash, maker identity/role, reviewer identity/role, decision, review reason, timestamps, result snapshot, and ordered event history. The existing generic review endpoint also enforces an Admin reviewer and maker/checker separation. This provided a schema-safe route to implement the requested control without a schema change.

## 2. Actual production route and callers

| Route / caller | Production behavior after P5-R12 |
|---|---|
| `POST /api/returns/supplier/:id/apply-credit` in `backend/routes/returnsRoute.js` | Remains protected by authentication, Admin-role check, and `finance:payable_settle`. It now submits a `SUPPLIER_RETURN_CREDIT_APPLICATION` approval request; it does not mutate credit, bill, or payable balances. |
| Admin `ReturnsManagement.jsx` | Submits the selected bill, decimal-string amount, notes, and `Idempotency-Key`; displays that the request is pending approval and that balances remain unchanged until approval. |
| `GET /api/accounting/approval-requests` | Existing approval list is used by the Admin Accounting Approvals page to display the pending request. |
| `POST /api/accounting/approval-requests/review` | Existing route requires `accounting:approval_review`; the service also requires an authenticated Admin actor and rejects the maker. |
| Approval executor | On approval only, calls `applySupplierReturnCreditToBill` within the approval transaction. Rejection never calls the application service. |

Repository search found no other mounted production caller of the supplier-return credit-application mutation. The service remains an internal service function; the direct HTTP path has been removed.

## 3. Before and after

**Before:** The supplier-credit route called `applySupplierReturnCreditToBill` directly. A user with `finance:payable_settle` could mutate the internal credit/bill balances and create the paired allocations without the separate review described by the UI.

**After:** The same route queues a pending approval. The requester is recorded as maker with creation timestamp and `SUBMITTED` event. An independent Admin with `accounting:approval_review` must approve or reject. Only approval executes the financial mutation. The requester cannot approve their own request.

No supplier acceptance or external credit-note evidence is created by this approval. The credit remains an internal return-credit record, and application remains an internal offset against the same supplier's bill.

## 4. Approval state machine and authorization

```text
POST apply-credit
  -> PENDING + SUBMITTED event + request audit
      -> APPROVE by distinct authorized Admin
          -> application, paired allocations, approval event/audit, APPROVED (atomic)
      -> REJECT by distinct authorized Admin
          -> REJECTED event/audit (no financial mutation)
```

Submission requires the existing `returns/:id/apply-credit` authorization chain: authenticated Admin role plus `finance:payable_settle`. Review requires the existing accounting approval permission plus the service's Admin-role check. A requester/reviewer identity match fails with `MAKER_CANNOT_REVIEW`.

The application request is bound to the unique approval `requestKey` and normalized payload hash. Exact submission replay returns the same request; a changed payload or different maker reusing the key fails with `IDEMPOTENCY_KEY_REUSED`. Review replay is accepted only for the same reviewer, decision, and reason. A conflicting or second review is rejected.

## 5. Approval-time validation and accounting effects

Approval execution re-enters the existing application service inside the final mutation transaction. It revalidates:

- completed return and applicable credit settlement type;
- credit document type, side, source return ID, supplier identity, original amount, and posted/balanced source journal;
- bill type, payable side, same supplier and currency, eligible date/status, and exclusion of self-allocation;
- current remaining credit and bill balances and positive amount;
- linked operating-expense payable balance where the bill is expense-backed.

The application service uses the shared `parseNprAmountString` policy; request normalization rejects JavaScript Number inputs and snapshots a canonical two-decimal NPR string. Amounts use the shared NPR HALF_EVEN policy effective 2026-11-15. The final service uses Prisma Decimal values and conditional `updateMany` balance claims.

On approval it creates one `SupplierReturnCreditApplication`, decreases remaining amounts and updates statuses, adjusts a linked operating-expense `AccountPayable` where applicable, creates paired `OFFSET` allocations referencing the existing supplier-return journal, and writes the application audit outbox record. It does **not** post a second journal. The approval service then records reviewer decision, result snapshot, approval event, and audit outbox record in the same outer Serializable transaction.

## 6. Idempotency, transaction, and concurrency

- Approval request key uniqueness, normalized payload hash, and maker identity prevent duplicate or changed-payload requests.
- The application uses the approval ID as its unique application idempotency key.
- The existing application service uses a Serializable transaction when called standalone; under approval it uses the enclosing Serializable transaction client.
- Conditional balance updates compare current allocated amount, remaining amount, and status before mutation.
- The application record and paired allocation keys are unique; duplicate or concurrent mutation cannot silently create a second application.
- Application, document/payable updates, allocations, audit outbox, approval state/event, and reviewer audit are in the same outer Prisma transaction. A thrown validation, allocation, or audit error aborts that transaction.

These are code-level guarantees. Mocked tests do not establish MySQL locking, serialization-conflict behavior, rollback persistence, or concurrent request outcomes.

## 7. Audit evidence

The existing approval event history records `SUBMITTED`, then `APPROVED` or `REJECTED`, with actor IDs, role, timestamp, reason, and snapshots. The system audit outbox records the request, review, and successful supplier-credit application with maker/checker attribution and source IDs. The application stores the reviewer as `appliedByAccountId` and links the return, credit, target bill, and original journal.

## 8. Supplier-return and refund workflows deferred

### Supplier return

No return/stock change was made. The return route still lacks source-linked accepted receipt/bill quantities, location ownership, authoritative cost-layer provenance, supplier acceptance evidence, and a safe post-approval reversal path. The submitted unit-cost snapshot remains unsuitable as independently verified historical acquisition cost. Do not interpret return approval or the internal credit document as supplier acceptance.

### Supplier refund

No refund posting was changed. Expected refund, requested refund, supplier-confirmed refund, actual received money, internal Treasury receipt, and independently reconciled bank receipt remain distinct. An internal return request must not be used to increase available Treasury cash. The existing internal Treasury record is not independent bank evidence.

## 9. Tests and validation

Focused database-free tests cover:

- pending request with no pre-approval mutation;
- authorized independent approval and source-linked paired allocations;
- unauthorized review and self-approval rejection;
- rejection without financial mutation;
- exact request/review replay and changed-payload conflict;
- supplier and currency mismatch and insufficient remaining credit at approval time;
- requester/reviewer/audit attribution and no duplicate journal;
- rejection of JavaScript Number money and the NPR HALF_EVEN two-decimal boundary.

Validation results:

- `node --test tests/supplierReturnCreditApplicationApproval.test.js tests/supplierReturnCreditApplication.test.js tests/supplierReturnService.test.js tests/accountingActionApprovalService.test.js` — **35 passed, 0 failed, 0 skipped**.
- `npm run build` in `backend/` — passed; Prisma Client generation only, with no database connection.
- `npx eslint src/pages/ReturnsManagement.jsx` — passed.
- `npm run build` in `admin/` — passed; Vite reported the existing large-chunk warning.
- `node --check` for changed backend JavaScript and `git diff --check` — passed.
- The two supplier-return `.integration.test.js` files were not run as database tests: invoking them without the required safety configuration was refused by `requireIntegrationDatabaseSafety` before client construction. They were **not** skipped by the runner, and no integration database validation occurred. The guard was not bypassed.

The in-memory harness exercises service logic and mocked transactional calls. It does not prove route middleware behavior, persisted atomicity, database constraints, true concurrent overapplication protection, historical state, or independent supplier/bank facts. No DB-dependent test was enabled.

No database was connected to; no migration, seed, reset, `db push`, schema change, external supplier, or bank access was performed.

## 10. Remaining release gates and next increment

- Persisted migration/schema alignment and MySQL rollback, duplicate, and concurrency validation remain unperformed. No schema change was made in this increment.
- Confirm independent Admin account permission assignments in the intended environment; the implementation relies on existing `accounting:approval_review` RBAC.
- Reconcile the internal credit-application records and supplier payable control account against representative source records before operational release.
- Continue source-linked return and inventory design only after accepted-receipt linkage, return eligibility/location policy, authoritative cost basis, supplier acceptance evidence, and source-specific reversal rules are established.
- Keep refund cash recognition blocked until the evidence distinguishes actual receipt from expected/requested refund and provides reconciliation support.
- Phase 5, R8, P4.2, P4.3, and Phase 4 remain incomplete. No Phase 6 or Phase 7 work was started.
