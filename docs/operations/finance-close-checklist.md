# Finance Close Checklist

This is an operational review checklist for the current system, not an
accounting opinion or a statutory filing instruction. A finance preparer and
independent reviewer should be assigned for each close; tax workpapers and
Nepal-specific filing decisions must be reviewed by a Nepal-qualified
accountant.

## Before the period close

- Confirm the approved Bikram Sambat year mapping, fiscal-year boundaries, and
  accounting-period status. Do not silently edit a saved calendar mapping or
  backdate into a closed period.
- Confirm that the target database migration history matches the deployed
  Prisma schema. Do not use the project baseline or a local test database as
  evidence of production migration state.
- Preserve the period's sales, refunds/exchanges, payment, carrier settlement,
  bank, treasury, payable, receivable, and inventory evidence under the
  organization's retention policy.

## Operational reconciliation

- Run `npm run ops:exceptions` from `backend/`. Review delivery reconciliation
  requirements, ambiguous NCM return/exchange outcomes, open/partially resolved
  NCM settlement variances, and delivered-sale accounting events. Resolve or
  document each exception with its source and approver.
- Reconcile NCM settlement batches to the carrier statement and bank/treasury
  evidence: COD, actual carrier fees, net deposits, and each remaining variance.
  The local report cannot establish completeness against carrier-only orders.
- Reconcile distributor COD remittances, approved customer refunds, and
  distributor payables separately. Do not net gross receivable/payable
  balances without the explicit approved, audited offset workflow.
- Review manufacturer production/logistics bills against their source requests
  and shipment evidence. Do not infer missing cost layers, tax identity, or
  supplier VAT from later profile changes or cash settlement.
- Reconcile inventory ledger quantities and cost-layer traceability; investigate
  damaged, missing, uncosted, and quarantined quantities without inventing
  valuations or posting unsupported write-offs.

## General ledger and tax review

- Review posted journals, trial balance, GL-derived statements, Treasury
  movements, and applicable source-scoped Accounting Health checks. The
  repository documents legacy/opening balances, incomplete subledger coverage,
  and operational finance records that may not reconcile to the GL; a clean
  source-scoped check does not imply the entire control account is reconciled.
- Review the VAT workpaper's sales invoice/adjustment registers, output VAT,
  verified expense and manufacturer purchase evidence, opening credits, filing
  payments, and variance explanations. Its purchase register is partial; other
  purchase sources, historical opening balances, returns, timing differences,
  and GL variances require accountant review.
- Treat paper bill records as internal number/issuance evidence only. The app
  does not generate or submit statutory invoices or transmit filings to IRD.
  Confirm legal issuance, adjustment, and filing requirements with the
  qualified accountant.
- Do not treat the profit-distribution estimate as posted GL profit or audited
  retained earnings. Confirm period-close journals and retained-earnings
  treatment with the accountant; automatic year-end closing was not established
  in the reviewed flows.

## Sign-off record

For each close, retain the reporting period, preparer and reviewer, report
exports, source-document references, unresolved exception IDs/amounts, approved
adjustments, and follow-up owner/due date. Close only when exceptions are
resolved or explicitly accepted by the authorized reviewer with a documented
reason.
