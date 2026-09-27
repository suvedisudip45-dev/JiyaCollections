# Accounting Iteration 03 Sub-Checkpoint: Decimal Ledger And BS Calendar

**Status:** SUBPHASE COMPLETE; Iteration 03 remains open for event/party/account mappings.  
**Date:** 2026-09-28

## Completed

- Converted `Account.currentBalance`, `JournalEntry.totalDebit/totalCredit`, and `JournalLine.debit/credit` to MySQL `DECIMAL(20,2)`.
- Added per-BS-fiscal-year `JournalSequence`; journal numbers no longer use table row count.
- Central journal validation and cached-balance deltas use Prisma Decimal; negative amounts are rejected, each line has exactly one positive side, and rounded totals must match exactly.
- Idempotency lookup and period creation now run inside the journal transaction. Period/year creation uses upsert; duplicate idempotency races return the existing posted journal.
- Added `nepali-date-converter` behind `services/nepaliFiscalCalendar.js`; period and FY boundaries use Shrawan 1/Ashadh end and Asia/Kathmandu instants.
- Applied all 30 pending migrations to the verified-empty `clothing` database using `prisma migrate deploy`; no reset was used and no business records were created.

## Files Changed

- `backend/package.json`, `backend/package-lock.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260928195000_exact_decimal_ledger_sequence/migration.sql`
- `backend/services/accountingMoney.js`
- `backend/services/accountingPostingEngine.js`
- `backend/services/nepaliFiscalCalendar.js`
- `backend/tests/accountingMoney.test.js`
- `backend/tests/accountingPostingEngineUnit.test.js`
- `backend/tests/nepaliFiscalCalendar.test.js`
- This checkpoint and `docs/accounting/03-implementation-plan-and-iteration-tracker.md`

## Verification

- Database-independent accounting suite: **22 passed, 0 failed**.
- `npx prisma validate`: passed.
- `npx prisma migrate status`: database schema up to date.
- `npx prisma generate`: passed after the backend process exited.
- No DB-backed posting test ran; tests use pure functions or a mock Prisma client.

## Still In Scope For Iteration 03

Add normalized accounting party/event/account-mapping foundations and audit their migration shape. Existing finance tables still use `Float`, existing operational posting adapters still contain floating-point calculations, the central engine is not yet wired to the new source events, and no delivery/return/CPA journal hook is live. This checkpoint does not declare the complete accounting platform done.