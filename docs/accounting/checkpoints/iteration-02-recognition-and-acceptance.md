# Accounting Iteration 02 Checkpoint: Recognition And Acceptance

**Status:** COMPLETE (policy/helper and acceptance-snapshot slice)  
**Date:** 2026-09-28

## Objective

Encode owner-approved sale-channel/recognition rules and prevent manufacturer acceptance without admin-approved COGS; direct manufacturer sales also require an approved commission rate.

## Files Changed

- `backend/services/accountingRecognitionPolicy.js`
- `backend/services/manufacturerCostSnapshot.js`
- `backend/controllers/orderAssignmentController.js`
- `backend/controllers/manufacturerDirectOrderController.js`
- `backend/tests/accountingRecognitionPolicy.test.js`
- `backend/tests/manufacturerCostSnapshot.test.js`
- `docs/accounting/00-current-architecture.md`
- `docs/accounting/01-accounting-dependency-map.md`
- `docs/accounting/02-current-accounting-gap-analysis.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`
- `docs/accounting/04-target-accounting-domain-model.md`

## Behavior Implemented

- Commission channel policy recognizes only `DIRECT_MANUFACTURER` `PHONE_ORDER`/`HUB_VISIT`; `ONLINE_STORE` and `ADMIN_DIRECT` are excluded.
- Manufacturer COGS eligibility requires delivery and no confirmed manufacturer receipt/return.
- Direct manufacturer commission uses exact decimal gross-profit arithmetic and half-up two-decimal rounding; recoverable input VAT is separately supplied and cannot exceed gross agreed COGS.
- Manufacturer acceptance and direct phone/shop order creation reject missing/unapproved agreed COGS. Direct sales also reject a missing/unapproved commission rate.
- Accepted terms are snapshotted onto order-item JSON at acceptance as fixed decimal strings, independent of later inventory-price edits.
- Assignment status and the order’s accepted cost snapshot are written in one Prisma transaction.

## Verification

- `node --test tests/accountingRecognitionPolicy.test.js tests/manufacturerCostSnapshot.test.js tests/assignmentWorkflowRules.test.js`: **13 passed, 0 failed**.
- `node --check controllers/manufacturerDirectOrderController.js`: passed.
- Editor diagnostics for touched controllers/services: no errors.
- No MySQL/database test was run; no database or migration was changed.

## Limitations And Next Work

- The snapshot is currently embedded in `Order.items`; the target normalized snapshot/event models are designed in `04-target-accounting-domain-model.md` but not migrated.
- No delivery, revenue, VAT, COGS, manufacturer payable, commission or CPA journal is posted yet. Current legacy posting remains active; do not treat this slice as the new authoritative ledger.
- No integration test exercised the controllers against a test database. Add isolated transaction/client fixtures before enabling posting hooks.
- Next: Iteration 03, exact-decimal ledger schema and durable accounting-event/party/document foundation, followed by central transactional posting. Preserve the legacy API/ledger until a tested cutover is ready.