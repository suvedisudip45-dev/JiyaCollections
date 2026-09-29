# Accounting Iteration 05 Checkpoint: Bill-Wise Subledger Documents & Payment Allocations

**Status:** COMPLETE  
**Date:** 2026-09-28

## Completed

- **Subledger Data Models (`AccountingDocument`, `AccountingAllocation`)**:
  - Added Prisma models `AccountingDocument` (Invoices, Bills, Credit Notes, Debit Notes) with explicit side (`RECEIVABLE` / `PAYABLE`), currency (`NPR`), `originalAmount`, `allocatedAmount`, `remainingAmount`, and `status` (`OPEN`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`).
  - Added `AccountingAllocation` linking payments/receipts to specific bills with exact Decimal amounts.
  - Deployed migration `20260928230000_accounting_subledger_documents` to the database and generated Prisma client.
- **Subledger Service (`accountingSubledgerService.js`)**:
  - `createAccountingDocument`: creates open invoices/bills with Decimal balance checks and party relations.
  - `allocatePaymentToDocuments`: handles targeted and FIFO payment allocation across multiple open bills; enforces the invariant `allocatedAmount + remainingAmount == originalAmount`; tracks unallocated advance amounts.
  - `reconcileSubledgerToControl`: calculates the sum of open document balances and compares against the GL Control accounts (`CUSTOMER_RECEIVABLE_CONTROL` 1130 or `MANUFACTURER_PAYABLE` 2160 / `AP_CONTROL` 2110) to flag variances.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260928230000_accounting_subledger_documents/migration.sql`
- `backend/services/accountingSubledgerService.js`
- `backend/tests/accountingSubledger.test.js`
- `docs/accounting/checkpoints/iteration-05-subledger-documents-and-allocations.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`

## Verification

- Complete accounting test suite: **45 passed, 0 failed** across all unit and subledger allocation tests.
- Invariants verified:
  - Document balance invariant: `allocatedAmount + remainingAmount == originalAmount` strictly preserved.
  - FIFO allocation across multiple bills verified with advance balance tracking.
  - Subledger-to-Control GL reconciliation verified.
