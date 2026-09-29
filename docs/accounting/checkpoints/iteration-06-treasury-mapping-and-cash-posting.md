# Accounting Iteration 06 Checkpoint: Treasury Mapping And Cash Posting

**Status:** PARTIAL IMPLEMENTATION; migration and runtime rollout not performed  
**Date:** 2026-09-29

## Objective

Make Treasury balances explainable against mapped GL asset accounts and stop selected Treasury commands from succeeding without a corresponding journal.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260929100000_add_treasury_gl_mapping/migration.sql`
- `backend/services/treasuryAccountingService.js`
- `backend/controllers/treasuryAccountingController.js`
- `backend/controllers/accountingController.js`
- `backend/routes/financialRoute.js`
- `admin/src/pages/TreasuryCash.jsx`
- `admin/src/pages/AccountingHealth.jsx`
- `admin/src/pages/FinancialStatements.jsx`
- `backend/tests/treasuryAccountingService.test.js`
- `backend/tests/accountingOperationalPosters.test.js`
- `docs/accounting-system-redesign.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`

## Implemented

- Added optional `FinancialAccount.accountingAccountId` relation. No existing account is auto-mapped and no opening balance is invented.
- Added mapping validation: active debit-balance asset leaf account, restricted to `1110` cash, `1120` bank, or `1180` gateway clearing.
- Treasury account creation requires a mapping and zero initial balance. A nonzero opening balance is rejected until an approved opening-voucher journal flow exists.
- Added map-existing-account endpoint under existing `finance:treasury_create` authorization.
- Treasury/GL reconciliation now groups by mapped GL account, aggregates multiple Treasury accounts mapped to one GL account, and marks unmapped Treasury records `NOT_RECONCILED` instead of comparing unrelated totals.
- Internal Treasury transfers and selected simple inflow/outflow categories post balanced journals within the same transaction as Treasury updates. Transfers are balance-sheet movements, not income/expense.
- Requires client idempotency keys and returns the original result for exact retries; rejects a key reused with different transaction data.
- Generic direct cash entry rejects sales, vendor bills, COD, asset purchases, and non-principal loan movements that need dedicated source documents/tax/allocation rules.
- Generic payable settlement now debits the mapped cash/bank account and configured payable control inside the same transaction as Treasury, payable, and cash-history updates. Generic AP and NCM/AR receipts now post through the dedicated transactional Treasury/accounting controller.
- Admin payable/receipt/manufacturer payout forms retain idempotency keys across retries of an unchanged request.
- Health UI reports partial coverage and does not claim all transactions were posted. It separately lists unmapped Treasury accounts.
- GL statement now includes COGS-related and operating expense accounts `6410`, `6420`, `6430`; balance sheet includes COD/gateway assets `1170`, `1180` and payable controls `2160`, `2170`, `2180`.
- P&L and balance sheet UI no longer silently fills missing GL values from operational estimates. The current operational cash-flow view is visibly labeled as an estimate.
- GL, trial-balance, and GL-statement default dates use the active Nepali fiscal year and date-only report filters use Asia/Kathmandu boundaries.

## Verification

- `npx prisma validate`: passed.
- `node --test tests/treasuryAccountingService.test.js`: 9 passed.
- Selected database-independent accounting suite: 32 passed.
- Nepali calendar tests: 3 passed.
- `node --check` on modified backend controllers: passed after recovery.
- `npm run build` in `admin/`: passed; existing large-chunk warning remains.
- Prisma Client regeneration failed with Windows `EPERM` replacing `query_engine-windows.dll.node`; a running process may be holding the binary. No process was stopped.
- No migration was applied and no DB-backed test was run.

## Remaining Work / Known Limits

- Existing Treasury account mappings remain null until an admin maps them. Their old cash transactions are not backfilled or reclassified.
- There is no approved opening-balance voucher yet. Zero-balance account creation is supported; opening funds require a separate approved journal workflow.
- Direct movement classification remains limited to non-sales receipts, miscellaneous expenses, and drawings. Owner capital, loans, sales, bills, COD and asset movements must use dedicated source-document workflows; supporting evidence and future approval/audit fields remain required.
- Generic AP settlement, collection, expense, returns, asset, financing, NCM, and manufacturer operations are not all atomic with journals. This checkpoint does not claim complete accounting coverage.
- Legacy AP reconciliation still covers 2110 only; the UI warns that manufacturer/marketing/carrier control-account document coverage is incomplete.
- Financial statement account classification is still code-based rather than metadata-driven; cash flow remains an operational estimate, not a ledger-derived statement.
- Current date/tax policy requires professional review; this implementation does not claim Nepal statutory compliance.
- Before using the new Prisma relation at runtime: safely resolve the engine DLL lock, regenerate Prisma Client, apply the migration only to a verified target environment, and test against an isolated DB.
