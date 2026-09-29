# Accounting Iteration 03 Checkpoint: Decimal Ledger Foundation

**Status:** IN PROGRESS; Prisma Client generation is blocked by a running Node server holding the Windows query-engine DLL.  
**Date:** 2026-09-28

## Objective

Move authoritative GL monetary columns from binary floating point to fixed-scale decimal, make journal amount validation exact, and remove count-based journal numbering.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260928195000_exact_decimal_ledger_sequence/migration.sql`
- `backend/services/accountingMoney.js`
- `backend/services/accountingPostingEngine.js`
- `backend/tests/accountingMoney.test.js`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`

## Implementation State

- `Account.currentBalance`, `JournalEntry.totalDebit/totalCredit`, and `JournalLine.debit/credit` are declared as `Decimal(20,2)`.
- Added `JournalSequence`, keyed per Gregorian year for now. The BS fiscal-year numbering conversion is a remaining design follow-up.
- Journal lines reject negative values, reject debit+credit on one line, round half-up to two decimals, skip zero lines, and require exact Decimal equality.
- Posting now looks up idempotency and creates periods/journal/lines/account-balance updates inside one Prisma transaction. It uses an atomic sequence upsert and resolves a concurrent idempotency unique-key race by returning the existing posted journal.
- `ensureFiscalYearAndPeriod` now accepts a transaction client and uses upserts to avoid duplicate period-creation races.

## Verification

- `node --test tests/accountingMoney.test.js`: **3 passed, 0 failed**.
- `npx prisma validate`: **passed**.
- `node --check services/accountingPostingEngine.js`: **passed**.
- `npx prisma generate`: **failed with Windows `EPERM` replacing `query_engine-windows.dll.node`**. A running `node server.js` process was found; it was not stopped.
- No migration was applied and no database was queried or modified.

## Blocking Validation

Prisma Client must be regenerated after the process holding the engine DLL is safely stopped. Then run the existing database-backed accounting test only against an isolated test database after applying the migration there. Do not call the new `journalSequence` delegate in a running app until the generated client and database migration are both current.

## Remaining Work

This is not yet an authoritative end-to-end accounting platform. Payment/receipt, delivery, return, CPA events, party documents/subledgers, durable source events, reporting and reconciliation are not wired. The old operational finance paths remain active pending their migration and cutover iterations.