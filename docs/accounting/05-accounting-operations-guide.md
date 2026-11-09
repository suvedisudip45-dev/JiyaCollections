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

Manufacturer, distributor, and generic payable payouts additionally require an active NPR Treasury account whose GL mapping matches its type. An unmapped, inactive, wrong-currency, or mismatched account is blocked. The payout journal credits the mapped GL account; it must not guess a cash/bank account code.

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

The Expense Management income form is limited to **Other Income** receipts that finance has confirmed do not require output VAT. It posts the deposit to the Treasury account's mapped GL account and credits Other Income (8100) in the same transaction as the income and cash-transaction records. Do not use it for sales, scrap disposals, or services; use their tax-aware workflows instead. VAT-bearing receipts remain blocked from this manual form until their tax treatment is implemented and approved.

Operating expenses post the expense and either the mapped Treasury outflow or Accounts Payable within one database transaction. A failed GL posting rolls back the associated expense and Treasury/subledger change. Supplier VAT remains pending review; input VAT is recognized only after evidence and the effective-dated Admin VAT registration checks pass.

The direct operating-expense endpoint requires an idempotency key and writes its cash movement, payable (if any), and GL journal in one transaction. Partial payments must reconcile exactly to the expense total; paid amounts use the selected mapped Treasury account. Retrying an unchanged request returns the prior posting, while reuse of the key for different details is rejected.

Treasury direct entries and internal transfers also post their mapped journal in the same transaction as the balance and cash-log changes. Supported direct entries are limited to non-sales other receipts, operating expenses, and drawings. Internal transfers debit the destination mapping and credit the source mapping. Sales, asset proceeds, loans, vendor-bill payments, and other specialized receipts/disbursements must use their dedicated workflows.

### 4.6 Loan funding and repayments

Record a loan only when its proceeds are received into an active NPR Treasury account mapped to the matching cash, bank, or wallet GL account. The liability record, Treasury balance, cash transaction, and journal must commit together; a failed posting must not leave a partial loan or cash balance.

For repayments, select the actual mapped Treasury source and enter the principal and interest portions from approved repayment evidence. The two portions must equal the total payment. The displayed monthly-interest calculation is a legacy estimate for guidance only; it is not posted automatically and is not a substitute for the lender's statement or approved amortization evidence. Repayment balance, Treasury balance, cash transaction, and journal post atomically and retries use an idempotency key.

### 4.7 Fixed-asset acquisition

For a fixed-asset purchase paid in full or in part, use the actual active NPR Treasury account and confirm it is mapped to the correct cash, bank, or wallet GL account. The asset register, Treasury outflow, related payable (if any), and acquisition journal are committed together. The journal debits the asset category account, credits the mapped Treasury account for the paid amount, and credits Accounts Payable for the unpaid amount. It must not assume every cash payment came from Bank (1120).

The Admin form sends an idempotency key for each unchanged submission. Retrying that request returns the existing acquisition without repeating cash or GL effects; reusing the key with changed purchase details is rejected. Keep the same request key when retrying after an uncertain network result.

The monthly depreciation batch uses the configured Bikram Sambat accounting period and can be posted only once for that period. Asset book-value updates and the 6600/1590 journal are committed together; if posting fails, the asset updates roll back. A retry of a posted period returns the existing result without changing asset values again. This guard does not determine the correct accounting or tax depreciation start date and does not provide catch-up batches for missed periods; confirm those policies with the finance approver before use.

Damage/write-off derecognition is transactional and idempotent. It removes the gross asset cost, clears accumulated depreciation, recognizes the remaining book-value loss in GL 6800, and updates the register only if the three amounts reconcile. Asset sales and any disposal proceeds are disabled pending CA-approved tax/VAT treatment; do not record sale receipts as capital injections or other income. The control-coverage report remains unreconciled until asset-register balances and additions, depreciation, and disposals are independently tied to the fixed-asset GL accounts.

### 4.8 Primary share issuance

Record a primary share issue only after the funds are received into an active NPR cash, bank, or wallet Treasury account mapped to its matching GL account. The share register/dilution, Treasury balance and cash receipt, valuation milestone, share-transaction record, and journal must commit together. The journal debits the selected mapped Treasury account and credits Share Capital (3100), retaining the current configured classification; any share-premium or legal-capital reclassification requires CA approval and a separate policy change.

The Admin request carries an idempotency key. Retrying an unchanged request returns the prior recorded issue, while reusing its key for different terms is rejected. A journal failure rolls back the cap-table and Treasury changes. Preserve bank receipt evidence and approved allotment/company records. This system workflow does not establish compliance with company-law allotment, board/shareholder approval, OCR filing, tax, or statutory register requirements; confirm those with the company secretary and Nepal CA.

### 4.9 Company share buyback

Record a company buyback only against an active NPR cash, bank, or wallet account mapped to the matching Treasury GL account, and only from funds available after reservations. Treasury, seller share count/status, remaining ownership percentages, the cash outflow, share-transaction record, and journal are committed together. The journal uses the currently configured Share Capital (3100) debit and credits the selected mapped Treasury account; do not infer a different treasury-share or capital-reduction presentation without CA approval.

The Admin request uses an idempotency key; retry an unchanged request with that same key after an uncertain network result. Reusing the key with changed terms is rejected. The accounting record is not proof of legal authority to repurchase, solvency under company law, required board/shareholder approvals, tax treatment, or required OCR/company-register filings. Obtain and retain those approvals and source documents before processing, and have a Nepal CA/company secretary verify applicable requirements. Database-backed concurrent execution and production reconciliations remain separate release checks.

Private peer-to-peer share transfers update the seller/buyer cap table and append a share-transaction record in one database transaction; they do not represent company Treasury movement or a company GL cash receipt/payment. The private purchase consideration is recorded on the share transaction only: it does not increase the company's contributed capital or the buyer's company-capital balance. Record and retain the parties' signed transfer agreement and settlement evidence outside this company-cash workflow. Admin retries use a durable idempotency key after the additive ShareTransaction migration is deployed; until the application schema is migrated and generated client updated, do not assume production retries are protected.

The cap table uses share counts to calculate ownership, but still includes legacy floating-point share fields and a 100,000-share fallback for some overview/valuation calculations. Do not treat that fallback as the entity's authorized or issued share capital. Reconcile holdings to the legal shareholder register and approved allotment/transfer records; obtain CA/company-secretary approval of authorized versus issued shares, fractional-share precision, and capital presentation before changing those rules.

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
- historical manufacturer commission postings (no new accruals)
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

## PAN/VAT and bill records

The Admin Tax Compliance page starts in `PAN_ONLY` mode. Save the seller's legal name, PAN, and registered address, then record VAT registration as an effective-dated change only after the actual IRD registration is confirmed. Sales output VAT is determined by the registration state at the recorded transaction tax point; a configured rate alone does not activate VAT.

For the current paper-bill process, issue the official bill through the business's approved paper stationery and record its actual bill number/date against the system invoice. Keep the original bill and supporting evidence. The system record is not itself a legally issued bill, does not print or submit one, and does not provide an IRD electronic billing integration.

VAT return drafts are posted-ledger reconciliations, not ready-to-submit IRD returns. Check the IRD-assigned period, taxable sales, the complete purchase/invoice and credit-note registers, the carried-forward credit, and all adjustments with the accountant before marking the return filed. Record the IRD reference and assessed amount. A variance reason is audited, but this release does not classify/post an accounting journal for assessment differences. Record each actual payment once, using its reference and the matching cash/bank Treasury account; partial and outstanding amounts remain visible.

Do not claim supplier input VAT solely because a supplier bill is marked verified: the business must also be VAT-registered at acquisition. Non-recoverable VAT is included in inventory/COGS. The acquisition-time cost-layer snapshot prevents a later VAT registration from retrospectively creating an input credit.

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

The system is designed so that actual open payables and receivables reconcile to control accounts. Manufacturer production bills are created when delivered goods trigger payable recognition; manufacturer payments allocate to those open bills. A confirmed return creates a supplier credit note only when the original delivery bill exists. Older manufacturer journals remain a legacy balance until reconciled.

New distributor settlement requests do not create an AP from the amount requested. Requests backed by distributor earning documents are linked to those documents. Requests without matching earning documents are marked for reconciliation and cannot be paid until historical earnings are backfilled/reconciled. Pre-existing request-accrual AP records remain on the compatibility path pending controlled migration.

### 9.2 Safe patterns

- pay an invoice only when a payable exists and the amount does not exceed the remaining balance
- receive payment only when a receivable exists and the amount does not exceed the remaining balance
- ensure the Treasury account used for the payment/receipt is mapped to a valid GL cash/bank entry
- use a stable idempotency key for retries

### 9.3 Payable payout lifecycle

Admin payable, manufacturer, and distributor transfers use a two-step confirmation flow:

1. Initiate the payout from a mapped Treasury account. The system reserves the cash amount, but does not yet debit Treasury, clear the payable, create a cash transaction, or post the payment journal.
2. Make the transfer through the bank or other payment provider outside the application.
3. Confirm only after checking the bank statement or equivalent transfer evidence. Record the evidence reference; confirmation atomically debits Treasury, posts the journal, updates the payable/settlement, releases the reservation, and records the audit event.
4. If the transfer failed, mark the initiated payout failed with a reason. The reservation is released without recording a payment.

An initiated payout remains recoverable from the Admin payout list if the original dialog is closed. Do not treat the external transfer reference entered at initiation as proof of settlement. The payout lifecycle migration and database-backed transition tests must be verified in an isolated database before operational rollout.

### 9.4 Warning

Do not mark a receivable or payable as cleared based only on a UI toggle or a partial payment status. It must reconcile to the balance and to the ledger.

---

## 10. Delivery, COD, and NCM settlement

### 10.1 COD receivable

COD is not cash. The carrier has collected customer funds, but the money is still due to the company as a receivable until settlement is confirmed.

Outstanding distributor COD is displayed as a separate exposure warning on Admin service-settlement views and payout results. Distributor service earnings are paid gross against their own payable documents; COD is not automatically netted from that payout. Remittance verification or an explicitly approved offset workflow is required to clear the COD receivable.

### 10.2 NCM settlement rule

When a COD remittance is received from a carrier or settlement partner, the system calculates:

- COD collected
- delivery/carrier fee
- net remittance actually received

The posted receipt must match the net remittance, not the gross COD value.

### 10.3 Why this matters

This avoids double-counting or book-cash before funds are actually received. It also keeps gross COD receivable and carrier fee obligations separate and visible.

### 10.4 NCM returns and exchanges

An NCM return request or return status is not proof that the goods reached the seller, passed inspection, or were refunded. Keep it in `RETURN_REQUESTED`; do not mark the order fully returned, set physical-return dates, restock inventory, reverse sales/VAT/COGS, or create a manufacturer supplier credit from that event alone. A delivered order retains its payment and COD settlement facts while the return and any refund/remittance variance are reconciled separately. A return before delivery has no recognized COD sale.

Use the customer-return workflow for authorization, physical receipt, inspection, refund, and restocking decisions. Post any customer refund, VAT adjustment, inventory movement, and manufacturer credit only from their verified workflow evidence, without duplicating an existing journal. NCM's exchange operation creates separate return and replacement order IDs; track both legs independently and do not treat either leg's delivery status as settlement proof.

Carrier status and money are separate evidence streams. Reconcile COD and carrier fees to the carrier statement and actual bank receipt; a delivery scan, return request, or COD transfer-ticket request is not bank evidence. Other courier APIs follow the same useful separation: [EasyPost tracking](https://docs.easypost.com/docs/trackers) distinguishes return-to-sender tracking from a return shipment, and its [webhook guidance](https://docs.easypost.com/docs/webhooks) recommends idempotent handling; [Shiprocket's API documentation](https://apidocs.shiprocket.in/) distinguishes order/tracking identifiers but does not establish COD remittance. Confirm NCM's own statement and return-status semantics before treating provider events as physical or financial evidence.

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

### Legacy distributor settlement requests

Requests marked `LEGACY_EARNINGS_RECONCILIATION_REQUIRED` are not payable until an Admin resolves them through `POST /api/admin/distributor-finance/settlements/:id/resolve-reconciliation`.

- `RECONCILE` requires selecting existing, open distributor earning or target-bonus documents for that distributor. The requested amount must be covered, selected documents must not already be reserved by another open request, and the decision requires review notes.
- `REJECT` closes an unsupported unpaid request and requires review notes.
- Both decisions are audited. This endpoint does not backfill or create earning records. If historical delivery earnings are missing from the subledger, investigate and backfill them from verified source records before reconciling; never infer or fabricate an earning amount.

Open supplier credit notes are reported separately from gross manufacturer bills. An Admin with `finance:payable_settle` may apply a confirmed manufacturer return credit to the matching delivery bill for the same manufacturer and order. The workflow requires an existing posted `DELIVERY_RETURN` payable reversal, a positive amount within both open balances, and a reason note. It updates the two document balances, stores paired allocations against the existing return journal, and writes an audit event; it does not post another journal for the return. The action is idempotent and a retry with the same key and payload returns the prior application.

Do not apply credits across manufacturers, currencies, or orders. Do not apply a credit when the return journal or original bill is missing. The additive `SupplierCreditApplication` migration must be applied and verified in an isolated database before enabling this workflow in a deployed environment.

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
