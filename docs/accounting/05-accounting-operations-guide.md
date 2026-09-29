# Accounting Operations Guide

## 1. Purpose

This guide explains how the accounting layer works in this project and how to operate it safely. It is written for the admin team, finance approvers, and technical operators who need to validate money movements, posted journals, balance-sheet statements, Treasury movements, and cash/bank reconciliation.

The design follows the same patterns used by mature accounting systems such as Tally, Odoo, and Xero:

- one authoritative General Ledger
- double-entry journal posting
- cash/bank/Treasury mapping to GL accounts
- explicit reconciliation status instead of hidden assumptions
- audit trail and idempotency for retries and duplicate requests

Important: this is not a legal opinion or a tax filing guarantee. Nepal VAT, tax thresholds, and reporting compliance still require a qualified accountant or finance adviser.

---

## 2. Core accounting model

### 2.1 Source-of-truth rule

The accounting layer does not invent missing values. It must post from a valid source event or approved manual voucher.

This project follows these rules:

- business services own their operational data
- accounting owns journal posting, periods, control accounts, and reporting
- Treasury accounts must map to a GL account before they can receive or disburse funds
- if data is missing or a posting is not supported, the system must show a warning, block the action, or mark it as incomplete
- no operational estimate may silently replace a missing GL balance

### 2.2 Important accounting objects

- Chart of Accounts: the master list of all account codes and names
- Journal Entry: a balanced double-entry transaction
- Journal Line: each journal has two or more non-zero entries with a clear debit/credit split
- Treasury Account: actual company cash/bank/wallet location
- GL Account: the mapped accounting account behind each Treasury account
- Balance Sheet: position as of a date
- Profit & Loss: activity over a period
- Reconciliation: proof that Treasury, AP, AR, and control accounts agree with source records

---

## 3. Roles and permissions

Accounting operations must be done through the existing RBAC model. Access should be given only to roles that need to:

- read the GL and trial balance
- approve accounting documents
- post manual journals
- manage Treasury accounts and mappings
- reconcile cash/bank and settlements
- review statements and health status

Recommended role separation:

- Admin / Finance: final review and approval
- Accounting: journal posting and control-account review
- Treasury: cash, bank, and wallet account management
- Read-only: reporting and reconciliation review only

---

## 4. Treasury, bank, and cash setup

### 4.1 Treasury account types

Treasury accounts are not allowed to be random cash buckets. The project enforces strict mapping:

- Cash account -> GL 1110
- Bank account -> GL 1120
- Wallet / digital wallet -> GL 1180
- COD receivable and carrier escrow are not treated as company cash

This prevents a common accounting failure: using a receivable or held-payment account as if it were cash.

### 4.2 Required setup steps

1. Open the Treasury section.
2. Create a Treasury account with a clear name such as:
   - Main Cash Drawer
   - Business Bank Account
   - eSewa Wallet
3. Select the correct account type.
4. Map it to the correct GL account.
5. Confirm the initial balance is zero unless an approved opening-balance journal exists.

### 4.3 Zero-balance rule

This project intentionally blocks non-zero opening balance creation in a generic Treasury account. That is deliberate and safer.

Reason:

- a random opening balance can create fake equity or cash
- opening balances must be documented and approved
- the project avoids silent startup assumptions

If a real opening balance is needed, it must be entered through an approved opening-balance journal flow, not by guessing a current balance.

### 4.4 Internal transfer rule

Transfers between Treasury accounts are allowed only when both accounts are mapped and both sides are known to be valid money locations.

Examples:

- cash drawer -> business bank
- wallet -> bank

These are internal transfers and are not treated as revenue or expense.

### 4.5 Supported direct entries

The generic direct cash entry form is restricted to clearly supported categories only. These are safe and explicitly coded:

- Miscellaneous non-sales receipt
- Expense payment
- Drawings
- Controlled direct transfer

The system blocks unsupported categories such as:

- customer sales without an invoice or source document
- vendor payment with no AP document
- owner capital injection through the generic shortcut
- COD as company cash
- asset purchase without a proper asset record

This is a major design principle: no “best guess” accounting.

---

## 5. General Ledger (GL)

### 5.1 What GL means here

The GL is the authoritative ledger of posted double-entry transactions. All statements and reconciliation must ultimately be derived from these posted entries.

### 5.2 Typical GL workflow

1. Create or review the Chart of Accounts.
2. Post a journal entry with at least two non-zero lines.
3. Ensure debit total equals credit total.
4. Use a valid source reference such as invoice number, settlement ID, or approved voucher.
5. Save the entry and ensure it is marked as posted.
6. Review it in the GL, trial balance, and statement view.

### 5.3 Manual journal rules

Manual journals should only be used when:

- an approved accounting adjustment is required
- there is supporting evidence
- the transaction is not covered by an automated posting flow

Manual journal guidelines:

- never hand-enter a guessed revenue or expense without documentation
- maintain a clear reason and approval reference
- reverse the original if the adjustment is correcting a previous entry
- do not post directly to protected system accounts without explicit approval

### 5.4 Reversal rules

A reversal is not a delete.

A correction must be created as a new journal entry linked to the original entry and reason. This preserves auditability.

---

## 6. Profit and Loss (P&L)

### 6.1 What it shows

The Profit & Loss statement summarizes activity over a period and derives from posted ledger activity. It includes:

- revenue
- returns and discounts
- COGS
- operating expenses
- manufacturer commissions
- marketing partner CPA
- delivery/carrier costs
- depreciation and interest
- net income before tax

### 6.2 Important rule

P&L values are not used as a fallback for missing GL data.

If a GL value is empty or missing, the report shows that gap, rather than replacing it with operational estimates. That is critical to prevent false financial reporting.

### 6.3 Example interpretation

- revenue from online store sales
- less customer returns and discounts
- less approved COGS
- less marketing, delivery, salaries, rent, and tools
- equals gross profit and net income before tax

---

## 7. Balance sheet

### 7.1 What it shows

The balance sheet is the company position as of a date. It shows:

- current assets
- fixed assets
- current liabilities
- long-term liabilities
- equity

### 7.2 Important balance-sheet rule

Balance-sheet profit must be based on current fiscal-year earnings up to the balance-sheet date, not just the currently selected P&L period.

This avoids a common bug: a user selects a shorter reporting range and accidentally changes the equity position shown on the balance sheet.

### 7.3 Balance-sheet sections in this project

Assets include:

- cash on hand
- bank accounts
- accounts receivable
- COD receivable
- gateway clearing
- inventory where company-owned
- fixed assets and accumulated depreciation

Liabilities include:

- supplier/manufacturer payable
- general accounts payable
- output VAT payable
- tax payable
- partner payable
- carrier payable
- loans

Equity includes:

- share capital
- retained earnings
- current fiscal-year net income

---

## 8. Cash, bank, and reconciliation workflow

### 8.1 Bank/Cash health check

Use the reconciliation and health screens to review:

- unmapped Treasury accounts
- GL mapping issues
- unpaid or partially paid documents
- cash mismatches
- missing entries and duplicates

### 8.2 Reconciliation rule

A Treasury account is not reconciled just because it has a balance. It must be mapped to a valid GL account and be reviewed against the ledger.

### 8.3 Good practice

- reconcile Treasury accounts daily or at a fixed close cycle
- confirm the actual bank statement or cash count before marking a balance final
- review unsupported categories and blocked entries
- keep the reason and reference for every movement

### 8.4 Unsupported cases

The system intentionally blocks or warns on these patterns:

- COD held by carrier treated as company cash
- capital injection through generic cash entry
- direct payment without a payable document
- receipt without a valid receivable or source record
- transfer between identical accounts
- payment or receipt with a reused idempotency key for a different amount or account

---

## 9. Accounts receivable and payable

### 9.1 AP and AR are document-ledger based

The system is designed so that actual open payables and receivables reconcile to control accounts. In this project, the older legacy flows remain compatibility-oriented until the full document cutover is finished.

### 9.2 Safe patterns

- pay an invoice only when a payable exists and the amount does not exceed the remaining balance
- receive payment only when a receivable exists and the amount does not exceed the remaining balance
- ensure the Treasury account used for the payment/receipt is mapped to a valid GL cash/bank entry
- use a stable idempotency key for retries

### 9.3 Warning

Do not mark a receivable or payable as cleared based only on a UI toggle or a partial payment status. It must reconcile to the balance and to the ledger.

---

## 10. Delivery, COD, and NCM settlement

### 10.1 COD receivable

COD is not cash. The carrier has collected customer funds, but the money is still due to the company as a receivable until settlement is confirmed.

### 10.2 NCM settlement rule

When a COD remittance is received from a carrier or settlement partner, the system calculates:

- COD collected
- delivery/carrier fee
- net remittance actually received

The posted receipt must match the net remittance, not the gross COD value.

### 10.3 Why this matters

This avoids double-counting or book-cash before funds are actually received. It also keeps gross COD receivable and carrier fee obligations separate and visible.

---

## 11. Manual operation checklist

Use this checklist before finalizing a finance close:

- [ ] Treasury accounts are mapped to valid GL accounts
- [ ] no unmapped cash/bank account is being used for posting
- [ ] opening balances were approved and not guessed
- [ ] all journal entries are balanced
- [ ] duplicates and retries produce the same result with the same key
- [ ] AP and AR balances reconcile to control accounts
- [ ] P&L values are derived from posted entries, not operational estimates
- [ ] balance sheet values use fiscal-year totals through the balance-sheet date
- [ ] reconciliation status is reviewed before closing the period
- [ ] all unsupported accounting shortcuts are blocked or flagged

---

## 12. Do not do these things

Never:

- assume a cash balance exists without a GL mapping
- use a random timestamp as a posting idempotency key
- silently replace missing data with operational values
- treat COD as company cash
- create an opening balance without approval
- post a payment without a valid source document or control account
- reverse a journal without preserving the original reference
- edit a posted journal

---

## 13. Best-practice workflow for operators

### Daily use

1. Review Treasury balances and mappings.
2. Check cash/bank and wallet mapping status.
3. Review AP and AR status.
4. Look for pending or failed accounting events.
5. Validate the trial balance and reconciliation status.

### Period close

1. Freeze the accounting period.
2. Check the trial balance for balance equality.
3. Review the P&L.
4. Review the balance sheet for equity and liabilities.
5. Reconcile Treasury to GL.
6. Verify open AP/AR documents.
7. Review the health status before sign-off.

---

## 14. Summary

The accounting feature in this project is designed to behave like a disciplined professional ledger, not a loose operational helper. It enforces:

- valid Treasury-to-GL mapping
- balanced double-entry posting
- safe retry logic
- no silent estimate fallback
- explicit reconciliation status
- reversible, auditable correction paths

If a user or operator cannot prove the source of the money movement, the system should block it or warn clearly rather than create a false balance.

This is the safest and most reliable way to operate bank, cash, GL, and balance-sheet records.
