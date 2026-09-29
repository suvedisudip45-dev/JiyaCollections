# Accounting Implementation Plan And Iteration Tracker

**Owner:** Engineering + business/accounting approver  
**Last updated:** 2026-09-29
**Overall status:** Treasury mapping and a limited atomic posting slice are in progress; no migration has been applied.
**Scope:** Accounting/finance models, services, routes, UI, reports, tests and minimal event hooks only. Do not rewrite unrelated product/order/manufacturer/marketing/delivery/auth business behavior.

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
- Manufacturer commission applies only to manufacturer-originated phone/shop orders (`DIRECT_MANUFACTURER`), in addition to COGS, using discounted product revenue ex-VAT/delivery less approved COGS ex-recoverable VAT as gross profit. Exclude `ONLINE_STORE` and admin-entered `ADMIN_DIRECT` social orders; accrue only after delivered/non-returned.
- Approved cost is snapshotted at manufacturer acceptance. Input VAT is claimable only with a valid manufacturer tax invoice; customer prices are VAT-inclusive. Post-delivery return to manufacturer reverses linked sales/VAT/customer settlement and COGS/payable; restock after receipt/inspection.
- Marketing CPA accrues per verified benefit redemption. Corporate tax remains estimate-only until accountant approval.
- Company is seller and collector for manufacturer-originated direct orders as well as storefront/admin orders.
- Block manufacturer acceptance unless every order line has approved agreed COGS; direct phone/shop sales additionally require an approved commission rate.
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

## Iterations

| Iteration | Objective | Status | Exit gate |
| --- | --- | --- | --- |
| 0 | Repository/accounting discovery and dependency map | COMPLETE | Findings reviewed; source-of-truth and current COGS mismatch documented |
| 1 | Freeze accounting/business policies | COMPLETE | Owner rules confirmed; accountant review for statutory classification and rounding remains a later gate |
| 2 | Recognition policy and acceptance snapshot | COMPLETE | Checkpoint `checkpoints/iteration-02-recognition-and-acceptance.md`; 13 focused tests pass; no database mutation |
| 3 | Precision, database foundation, COA/account mappings and periods | COMPLETE | Decimal schema and BS periods are migrated/validated; party/event/account mappings seeded and tested |
| 4 | Central posting service and durable idempotent accounting events | COMPLETE | Atomic balanced posting, immutable journals, stable idempotency, operational event wiring and 41 tests pass |
| 5 | Party master, bill-wise AR/AP, payments, receipts and allocations | COMPLETE | Partial/full/advance/overpayment allocation tests and subledger-to-control reconciliation pass |
| 6 | Cash, bank, petty cash and readiness controls | IN PROGRESS (partial) | Treasury-to-GL mapping is explicit; internal transfers and limited direct entries post atomically; opening vouchers, full source reconciliation, complete failure coverage, and finance readiness remain |
| 7 | Sales, manufacturer COGS and delivery-triggered payable | COMPLETE | Delivered/non-returned rule, approved-cost snapshot, direct-order commission classification, COD/revenue event timing and idempotency pass |
| 8 | Customer/supplier returns, RTO and exchanges | COMPLETE | Original-event links, reversals, inventory/ownership treatment, refund and tax effects pass |
| 9 | Manufacturer, marketing-partner and NCM settlements | COMPLETE | Gross AP/AR, CPA/commission basis, COD/fee settlement, offsets and statements reconcile |
| 10 | Expenses, procurement, tax, assets, debt and equity | NOT STARTED | Each supported finance event posts exactly once; policy-based tax and period behavior verified |
| 11 | GL reports, statements, ageing and health reconciliation | IN PROGRESS (partial) | GL statement now includes key manufacturer/partner/carrier controls; report UI has no operational P&L/BS fallback; AP/AR/event coverage and ledger cash flow remain incomplete |
| 12 | Admin accounting UI and permissions | NOT STARTED | Existing required finance capability covered with drill-down, filters, statuses, warnings and exports |
| 13 | Failure, concurrency, security and portal regression | NOT STARTED | Duplicate/retry/out-of-order/concurrent/failure scenarios pass; customer/manufacturer/marketing/admin flows remain compatible |
| 14 | Cutover and final audit | IN PROGRESS (sandbox gate) | Sandbox migration runbook, reconciliation gate, rollback plan and accountant sign-off are documented; live deployment remains blocked |

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

## Stop Conditions

Pause and request a decision if inventory ownership, manufacturer payable trigger/basis, post-delivery return behavior, commission/CPA recognition, COD settlement, VAT/tax rules, fiscal year/currency, cash opening balances, or allowed readiness gating remains ambiguous. Do not invent accounting policy, seed fake opening balances, run live-DB accounting tests, reset a database, or remove current finance features before caller/dependency review.