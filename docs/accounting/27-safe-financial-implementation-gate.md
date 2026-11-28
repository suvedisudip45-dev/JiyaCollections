# Safe Financial Implementation Gate and Architecture Blueprint

**Prepared:** 2026-11-17  
**Status:** Audit/design only. No database access, no production code changes, no schema changes, no migration, and no external banking/supplier validation were performed.

## 1. Purpose and scope

This document defines the minimum engineering and accounting acceptance gate before any bounded financial fix is implemented in the repository. It is deliberately conservative and is designed to stop unsafe changes in source-linked supplier, inventory, payable, Treasury, return, and refund flows.

The concrete case study is the P5-R11 supplier return/credit/refund gap and its P5-R12 bounded approval correction:

- supplier return creation is approval-gated; P5-R11 found credit application executed directly, and P5-R12 moved that route to the existing maker-checker approval workflow;
- supplier return posting can reduce aggregate stock and create internal AP/Treasury records using submitted unit-cost snapshots;
- no original receipt/bill linkage is required;
- no supplier acceptance evidence is required;
- no safe source-linked reversal path was found for stock, credit, refund, AP, Treasury, or journal corrections.

This gate is reusable across future accounting modifications, not a one-off policy for one endpoint.

## 2. Mandatory acceptance criteria

Each production change must satisfy all gates below before code is merged or released.

### Gate A — Business and accounting policy

Before any implementation, the team must establish:

- the business event being recorded;
- the source transaction or approved source record;
- the accounting recognition point;
- the accounts affected and the underlying policy basis;
- the inventory, return, settlement, or supply consequences;
- the evidence required to prove the transaction;
- the actor and approval requirement;
- the correction and reversal rule;
- unresolved business-policy decisions.

If essential policy is unclear, implementation stops at design.

### Gate B — Source and evidence integrity

Require:

- a stable source entity and source ID;
- original transaction linkage;
- original receipt or supplier invoice/bill linkage where relevant;
- evidence classification and provenance;
- actor and timestamp evidence;
- approval reference and review evidence;
- idempotency identity and duplicate prevention;
- a clear distinction between internal records and independently supplied external evidence.

For supplier returns, the system must distinguish:

- internal return request;
- physical dispatch or goods handoff;
- supplier receipt or acceptance;
- confirmed supplier credit note;
- actual cash refund or bank receipt;
- the difference between “an internal accounting record exists” and “a verified external fact exists.”

### Gate C — Database integrity

Before code changes, define the required database relationships and constraints:

- foreign keys and required relationship rules;
- uniqueness constraints and source-event uniqueness;
- required status transitions;
- transitional integrity for allocations and balances;
- monetary precision and rounding policy;
- quantity precision and validation rules;
- reversal linkage to original source records;
- index and locking strategy;
- referential integrity and fail-closed behavior.

Do not assume a field or relation is a control unless it is verified in the mounted implementation.

### Gate D — Approval and authorization

Define:

- which actions require independent approval;
- whether maker and checker must be different actors;
- server-side authorization requirements;
- approval status transitions and rejections;
- cancellation and re-open logic;
- duplicate approval prevention;
- audit record requirements;
- API/UI consistency.

A UI message is not an approval control. A permission-gated route is not automatically an independent maker-checker workflow.

### Gate E — Atomic financial consequences

Identify every affected component:

- source business record;
- inventory movement;
- cost layer or accepted cost snapshot;
- supplier or customer subledger;
- Treasury/bank account;
- journal and general ledger;
- audit history and report-readers.

Every monetary effect must be atomic. The implementation must specify:

- transaction boundary;
- retry behavior;
- idempotency behavior;
- concurrency protection;
- rollback semantics;
- failure behavior if any leg fails.

No partial mutation may produce an internally inconsistent combination of inventory, AP, Treasury, and GL.

### Gate F — Correction and reversal

Every correction must be source-specific and must preserve original history.

Every reversal must:

- reference the original event;
- preserve original audit data;
- validate remaining reversible amounts and quantities;
- prevent duplicate reversals;
- restore affected balances consistently;
- reverse or correct related journal entries;
- preserve actor, approval, reason, and evidence;
- handle partial reversals explicitly.

Never delete or rewrite posted financial history to avoid correction complexity.

### Gate G — Tests and verification

Required tests include:

- valid flow;
- invalid source or invalid amount;
- unauthorized actor;
- self-approval and maker-checker violations;
- duplicate request;
- exact replay and changed-payload rejection;
- concurrent requests;
- partial completion and rollback;
- reversal and recovery;
- monetary rounding and Decimal behavior;
- source-to-subledger-to-GL linkage.

Testing levels must be explicit:

- unit tests;
- mocked integration tests;
- isolated database integration tests;
- end-to-end accounting validation;
- external evidence reconciliation (if available).

A passing mocked test never proves persisted correctness.

### Gate H — Migration and release safety

For any change that touches financial data or schema semantics, the team must define:

- migration design;
- historical-data impact analysis;
- backup and recovery strategy;
- rollback strategy;
- compatibility analysis;
- deployment order;
- post-deployment reconciliation;
- explicit release approval.

Database validation requires an independently verified isolated environment and explicit authorization before cutover.

## 3. Evidence requirements

Financial production changes are blocked unless the evidence requirements below are satisfied.

### Evidence classification matrix

| Evidence category | Required before implementation | Notes |
|---|---|---|
| Internal ledger record | Required | Useful but not sufficient |
| Original invoice/bill record | Required where supplier obligations or inventory costs are involved | Must be linked to source and amount |
| Accepted receipt record | Required for stock and return eligibility | Must identify quantity, item, and location |
| Supplier acceptance | Required for supplier-return and supplier-credit recognition | Not inferred from internal journal alone |
| Verified refund or bank evidence | Required for cash refund or outbound Treasury settlement | Internal ledger is not enough |
| Approval evidence | Required | UI copy is not evidence |
| Reversal source linkage | Required | Original event must be identifiable and exact |

The project must clearly distinguish:

- internal accounting evidence;
- source-document evidence;
- externally verified evidence;
- estimated or placeholder values.

## 4. Database integrity requirements

The implementation must not proceed unless the team can answer these questions from the code and verified isolated schema:

- What is the canonical source record?
- Which table owns the authoritative amount and quantity?
- What is the unique business-key for the transaction?
- Which status transitions are allowed?
- What unique constraints exist?
- What is the locking and retry pattern?
- How is a reversal linked to the original entry?
- How are duplicates prevented?
- How is the balance derived and validated?

For supplier return and credit flows, the database must necessarily support:

- source return request → approved return event;
- return event → product/location stock effect;
- return event → supplier bill or credit document relationship;
- return event → Treasury or AP effect;
- reversal event → original event linkage and restoration;
- audit record and actor attribution.

If these relationships are absent or ambiguous, the change is blocked.

## 5. Approval requirements

The implementation must define the actual approval design:

- who can create the source event;
- who can approve it;
- whether approval is separate from the action itself;
- whether maker and checker must differ;
- how approval is recorded;
- how approvals are replayed or invalidated;
- which status transitions are allowed.

A direct permission-gated route is not equivalent to an independent approval path.

For the P5-R11 case, the P5-R12 implementation now enforces:

- return creation is approval-gated;
- supplier credit application is queued by the mounted route and executes only after approval by a distinct authorized Admin;
- the UI identifies the action as an approval request;
- source-linked return evidence, supplier acceptance, actual refund evidence, and reversal controls remain unresolved.

That design is not safe to generalize.

## 6. Accounting and posting requirements

Before any code change, define the accounting treatment precisely.

### Required accounting design elements

- Source event identity
- Accounting document provenance
- Journal posting rules
- Control-account mapping
- Inventory or cost impact
- Supplier/AP impact
- Treasury impact
- Journal reversals and adjustments
- Report basis and report-reader effects

### Required boundary for supplier-return work

A supplier-return implementation is only safe when it can prove:

- which original supplier bill/receipt line is being returned;
- which product and location are affected;
- which quantity is accepted as returnable;
- which cost basis is authoritative;
- whether the supplier accepted the return;
- whether a credit note or refund is confirmed;
- how the system restores inventory and AP if the return is later rejected or reversed.

Without these elements, the code should remain audit-only.

## 7. Atomicity and concurrency requirements

A valid financial change must behave correctly under concurrency and retries.

Required guarantees:

- same business event must be idempotent;
- changed payload on the same idempotency key must fail safely;
- duplicate concurrent actions must not allocate twice;
- inventory and financial balances must remain consistent after any failure;
- a posting exception must not leave an incomplete audit trail;
- recovery from retry must preserve original event identity.

For P5-R11, the current return/credit/refund flow is partially idempotent in code, but it is not source-evidenced and not safe as a general reversal model.

## 8. Correction and reversal requirements

Every implementation must define a correction policy before the code is written.

### Minimum reversal design

- original event reference;
- reversal reason and actor;
- remaining reversible quantity and amount;
- exact original source linkage;
- audit trail preservation;
- no silent overwrite;
- no duplicate reversal;
- no over-reversal or under-reversal;
- same treatment for stock, AP, Treasury, and journal lines.

Never rely on a generic “reverse last thing” model when multiple valid allocations or documents exist.

## 9. Testing and validation levels

### Required validation stack

1. Unit tests: logic correctness and guardrails
2. Mocked service tests: transaction-object and branch coverage
3. Isolated database tests: realistic transaction behavior, concurrency, rollback, and replay
4. Manual reconciliation: source document to subledger to journal to report
5. External evidence check: bank, supplier, or independent statement evidence when applicable

### Required test cases

- valid workflow
- invalid workflow
- unauthorized actor
- self-approval
- duplicate request
- exact replay
- changed-payload replay
- concurrent duplicate requests
- partial failure and transaction rollback
- reversal and restoration
- over-allocation and under-allocation detection
- Decimal rounding and quantity precision
- source-to-subledger-to-GL trace

A unit-test pass, by itself, is not evidence of accounting correctness.

## 10. Migration and release requirements

The implementation must not proceed without:

- isolated validation environment;
- migration plan and rollback proof;
- historical-data impact analysis;
- representative data validation;
- reconciliation against source data;
- reviewed release plan;
- explicit release approval.

The project must not assume that a local schema or a shared development DB is a safe validation target.

## 11. P5-R11 application assessment

### Workflow 1 — Supplier return and inventory reduction

| Aspect | Assessment |
|---|---|
| Current production path | `POST /api/returns/supplier/create` → approval review → `supplierReturnService.createSupplierReturn` |
| Required evidence | Original supplier receipt, accepted quantity, unit cost, location ownership, supplier acceptance |
| Required DB relationships | Return request → return record → product/location → inventory effect → supplier document → journal → audit |
| Accounting treatment | Internal return request reduces stock and posts journals; not yet proven as accepted supplier return |
| Approval requirements | Request approval exists; external acceptance not presently required |
| Transaction boundary | Internal transaction exists, but source evidence and later reversal semantics are incomplete |
| Reversal requirements | Not safely defined; stock and AP/Treasury restoration path not proven |
| Tests required | Return valid, invalid quantity, replay, concurrent duplicate, reversal, stock restoration, journal consistency |
| Missing policy decisions | Original source linkage, accepted return quantity, location ownership, supplier acceptance, cost basis |
| Implementation blocker | Missing evidence and missing source-linked reversal discipline |
| Smallest safe increment | Definition and policy gate, not production code |

### Workflow 2 — Supplier credit-note creation and application

| Aspect | Assessment |
|---|---|
| Current production path | return creation + credit-document generation + `applySupplierReturnCreditToBill` |
| Required evidence | Confirmed credit note, original supplier bill, same-vendor linkage, approved offset |
| Required DB relationships | Supplier return → credit document → bill allocation → document balance → journal → audit |
| Accounting treatment | Internal credit allocation exists; external credit confirmation is not proven |
| Approval requirements | UI text suggests separate approval, but mounted route is direct and permission-gated |
| Transaction boundary | Internal transaction exists, but no independent approval or source-linked offset requirement is enforced |
| Reversal requirements | No proven restoration path for bill allocations or credits |
| Tests required | same-vendor validation, over-allocation, duplicate credit application, replay, concurrent application |
| Missing policy decisions | Approved supplier credit issue, independent approval route, same-bill validity, restoration policy |
| Implementation blocker | No verified source-linked credit acceptance path |
| Smallest safe increment | Source-linked policy design and explicit approval model |

### Workflow 3 — Supplier refund and Treasury receipt

| Aspect | Assessment |
|---|---|
| Current production path | `CASH_REFUND` return settlement → Treasury inflow and journal entry |
| Required evidence | Supplier refund instruction, confirmed bank receipt, same-party relation |
| Required DB relationships | refund request → Treasury movement → cash/bank reconciliations → journal → audit |
| Accounting treatment | Internal Treasury inflow is recorded; external cash evidence is missing |
| Approval requirements | Internal approval is not equivalent to actual supplier refund authorization |
| Transaction boundary | Journal and Treasury functions may be atomic internally, but source and external evidence remain missing |
| Reversal requirements | No safe refund-reversal design with source linkage found |
| Tests required | refund validation, duplicate refund, cash reallocation, retraction, bank reconciliation |
| Missing policy decisions | Supplier-authorized refund, bank receipt proof, refund timing, event-to-Treasury linkage |
| Implementation blocker | Confirmed external payment evidence absent |
| Smallest safe increment | Policy gate and external evidence model before code |

## 12. Implementation blockers and next steps

The following are current blockers and must be resolved before any production code change is allowed:

- no source-linked return bill/receipt relationship;
- no supplier acceptance evidence requirement;
- no verified supplier credit note or refund evidence requirement;
- no safe return or credit reversal path;
- no independent approval route for supplier credit application despite UI messaging;
- no authoritative inventory-cost provenance in the return flow;
- no production-safe reconciliation model for supplier return to stock and AP/Treasury.

### Smallest safe next implementation increment

The next safe change is not a generic supplier-return fix. The next safe step is a design-only governance increment that defines:

1. the original source and evidence required for return eligibility;
2. the exact approval model for credit application;
3. the authoritative supplier-credit policy;
4. the refund evidence and bank confirmation rule;
5. the reversal semantics for stock, AP, Treasury, and journals;
6. the isolated database validation plan;
7. the exact tests required before any code change.

Only after these are approved should a bounded implementation be considered.

## 13. Ready / blocked classification

| Proposed change | Classification | Reason |
|---|---|---|
| Add UI wording without a route change | `READY_AFTER_POLICY_DECISION` | Need to define actual approval semantics |
| Add a strict supplier-return source validation gate | `READY_AFTER_POLICY_DECISION` | Need exact source evidence and ownership policy |
| Add supplier credit application independent approval | `READY_AFTER_POLICY_DECISION` | Depends on actual business process and approval design |
| Add refund confirmation or bank evidence requirement | `READY_AFTER_POLICY_DECISION` | Requires external evidence definition and accounting treatment |
| Add a source-linked return reversal path | `BLOCKED_BY_MISSING_EVIDENCE` | Missing return/source linkage and reversal policy |
| Generic AP/Treasury rollback for returns | `BLOCKED_BY_UNSAFE_EXISTING_ARCHITECTURE` | Current architecture does not provide safe source-links |
| Schema-level required constraints for return and credit documents | `READY_AFTER_SCHEMA_DESIGN` | Requires isolated schema review and migration design |
| Any production fix without isolated validation | `BLOCKED_BY_UNSAFE_EXISTING_ARCHITECTURE` | Database and evidence validation is required |

## 14. File creation and reference status

This document is the reference implementation gate for the P5-R11/P5-R12 progression. It should be read alongside:

- [docs/accounting/26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md](./26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md)
- [docs/accounting/27-p5-r10-supplier-returns-and-credit-evidence-audit.md](./27-p5-r10-supplier-returns-and-credit-evidence-audit.md)
- [docs/accounting/03-implementation-plan-and-iteration-tracker.md](./03-implementation-plan-and-iteration-tracker.md)
- [docs/accounting/07-critical-high-remediation-roadmap.md](./07-critical-high-remediation-roadmap.md)

## 15. Final safety statement

No financial production change should proceed until its business meaning, source evidence, database integrity, authorization, accounting consequences, reversal behavior, and validation requirements are demonstrably defined. This document establishes that gate and applies it directly to the current supplier-return and credit/refund architecture.

## 16. P5-R12 implementation outcome

The P5-R12 approval correction is a bounded example of a change that passed the schema-design gate because the existing approval models already provide maker identity/time, independent reviewer identity/time, request hash and uniqueness, state, result snapshot, and ordered audit events. The mounted credit-application route now queues the request; approval invokes the existing atomic application service, while rejection performs no financial mutation. No schema change was made.

This correction does not pass the remaining release gates by itself. The application still relies on an internally generated supplier-return credit whose original receipt, supplier acceptance, historical cost provenance, and external supplier credit evidence are not established. Persisted transaction, rollback, and concurrency validation was not performed. Do not treat the P5-R12 implementation as proof of supplier acceptance, bank settlement, or reconciled AP/GL balances. Details are in [P5-R12](./29-p5-r12-supplier-credit-application-approval-implementation.md).
