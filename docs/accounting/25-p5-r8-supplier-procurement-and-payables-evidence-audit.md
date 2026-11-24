# P5-R8 — Supplier Procurement, Accounts Payable, and Acquisition-Cost Evidence Audit

**Review date:** 2026-11-18  
**Status:** **COMPLETE FOR THE DOCUMENTED STATIC AUDIT AND SAFE-DISCLOSURE SCOPE ONLY**  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.

## 1. Scope and evidence boundary

This audit traced the current mounted supplier/vendor, operating-expense bill, payable, payout, supplier-return/credit, and Admin reporting paths. It also checked the inbound-shipment schema and accounting poster, procurement and AP documentation, the Phase 5 tracker/roadmap, P5-R1/R2/R4/R5/R6/R7, the R8 semantic register, and the R24 pricing inventory. Source and route mounts were checked in the current repository; an unused service or test fixture is not treated as a production workflow.

No database connection or inspection, `localhost:3306/clothing` access, migration, seed, reset, historical rewrite, production supplier access, bank/provider/NCM access, or external statement review was performed. No procurement, payable, payment, inventory, or posting business logic or schema was changed. Two Admin copy-only disclosures now clarify the internal VAT-review and AP-report basis.

Evidence classifications:

| Classification | Meaning |
|---|---|
| `VERIFIED_IN_CODE` | Current mounted route/caller and implementation establish the described code behavior; this is not persisted-state proof. |
| `MOCKED_TESTED` | Existing tests exercise the path using mocks/in-memory state; they do not prove deployed or persisted correctness. |
| `PARTIAL` | A source or lifecycle exists but does not establish the full evidence chain or population. |
| `MISSING` | No active, mounted end-to-end production path was found in the inspected code. |
| `LEGACY_OR_UNMOUNTED` | Schema/helper or old path exists, but no current mounted production caller was established. |
| `NOT_VERIFIABLE_WITHOUT_DATABASE` | Requires persisted rows, deployed configuration, or transaction evidence. |

Cost classifications use `AUTHORITATIVE_SUPPLIER_INVOICE`, `VERIFIED_RECEIVED_COST`, `AUTHORITATIVE_COST_LAYER`, `HISTORICAL_COST_SNAPSHOT`, `REFERENCE_OR_CATALOG_COST`, `ESTIMATE`, `UNRECONCILED`, and `MISSING`. A reviewed invoice record is not independent supplier confirmation; a posted journal is not proof of receipt or external cash movement.

## 2. Executive findings

1. **No complete supplier purchase-order, approval, goods-received, and invoice-matching workflow was found.** There is no `PurchaseOrder`, goods-receipt, or supplier-invoice Prisma model in the inspected schema, nor a mounted purchase/receipt route. `InboundShipment` is a legacy Float/JSON-backed model without an active writer/receipt path found.
2. The active `AccountingParty` vendor registry is used by operating-expense workflows. Vendor creation creates a local identity keyed by an idempotency-derived synthetic source ID, not an independently verified legal-supplier identity. Duplicate-looking names can remain separate records; no vendor edit/deactivation or external verification workflow was found.
3. Supplier bills in the active expense path represent recorded expenses and payable documents, **not received inventory**. `OperatingExpense`, `AccountPayable`, and `AccountingDocument` can be linked and posted transactionally, but the documents do not prove product-level quantities or accepted supplier receipt.
4. The AP payout path has a maker/checker lifecycle for `AccountPayable`: initiation reserves Treasury funds; confirmation requires a distinct Admin and an evidence reference; confirmation posts internal Treasury, cash, payable, journal, allocation, and audit records. The reference is user-supplied; the application does not independently match it to a bank statement.
5. **Confirmed code-level payout-correction mismatch:** generic payable correction restores the legacy `AccountPayable`, Treasury, payout state, and journal, but does not reverse a linked supplier bill's existing `AccountingAllocation` or restore the `AccountingDocument` balances. A supplier bill can therefore remain paid/allocated while its AP row is reopened. This is `VERIFIED_IN_CODE`; affected persisted records are `NOT_VERIFIABLE_WITHOUT_DATABASE`. This task does not change the correction logic.
6. Supplier returns have a mounted, separately reviewed workflow. It decrements legacy `Product.stockQuantity`, uses submitted unit-cost snapshots for the return journal, and produces either a supplier credit note or an internal Treasury refund record. It does not tie returned units/cost to accepted receipt quantities or a supplier cost layer.
7. There is no complete supplier acquisition-cost method. `Product.costPrice` is reference/catalog cost; inbound shipment amounts are unreconciled; production cost layers apply to accepted manufacturer production, not third-party supplier receipts. No uniform FIFO, weighted-average, or specific-identification policy is established for supplier inventory.
8. No supplier subledger-to-2110 GL reconciliation or independent supplier statement matching is established. The current supplier-return reconciliation checks only return-specific documents/journals/cash/legacy receivables.

## 3. Supplier and procurement route/service register

| Workflow | Current production path and records | Evidence status and limit |
|---|---|---|
| Vendor registration/list | `GET /api/expense/vendors`, `POST /api/expense/vendors/add` (`expenseRoute.js` → `expenseController.js`). Creates `AccountingParty(partyType: VENDOR)` and a system audit record. | **VERIFIED_IN_CODE** for local registration/list. `sourceEntityId` is `ADMIN:` plus a hash of the idempotency key; names/legal names are not a unique or independently validated supplier identity. No supplier update/deactivation route or external registry/statement check found. |
| Purchase request / PO / approval | No corresponding model, mounted route, or active portal caller found. | **MISSING**. |
| Goods received / partial receipt / rejection | No active supplier receipt route/model found. `InboundShipment` exists in Prisma with JSON `items`, Float costs/payment fields, free-text supplier/invoice, and no canonical accepted-quantity/condition lines or supplier-party relation. | **MISSING** as an end-to-end production flow; schema is **LEGACY_OR_UNMOUNTED**. No receipt proves quantities or inventory ownership. |
| Inbound purchase posting helper | `postInboundShipmentAccounting` in `accountingPostingEngine.js`; repository search found test/helper use, not a mounted production caller or `inboundShipment.create/update` production writer. | **LEGACY_OR_UNMOUNTED**. It posts a journal from Float/Number fields, hard-codes Bank 1120, does not create receipt/cost-layer evidence or a supplier bill document, and does not establish Treasury/AP settlement. Its taxes field is posted to 1150 as input VAT/customs; do not treat that helper as active acquisition-cost policy. |
| Supplier invoice / expense bill | `POST /api/expense/add` and `GET /api/expense/list`/`summary`; a second writer is `POST /api/finance/record-operating-expense`. When a vendor is selected, the current expense path can create a synthetic `AccountingDocument(BILL, sourceType: OPERATING_EXPENSE)`; an unpaid/partial amount also creates `AccountPayable(referenceType: EXPENSE)`. | **VERIFIED_IN_CODE** for expense bill/AP creation and journal linkage. This is not a PO, goods-received note, inventory purchase, or unit-cost record. The original invoice number is text/evidence, not a matched procurement document. |
| Purchase invoice VAT review | `POST /api/expense/:id/input-vat-review`; finance-tax permission. `purchaseVatService.js` checks required recorded fields, 9-digit VAT number format, URL syntax, duplicate supplier-VAT-number/invoice-number, amount/rate arithmetic, effective-dated buyer registration, and original posted expense journal; a review creates an input-VAT reclassification journal. | **VERIFIED_IN_CODE** for internal review checks. No external supplier/tax-authority lookup, URL content verification, independent invoice authentication, or bank/supplier statement match is performed. |
| Generic manual payable | `POST /api/finance/create-payable` can record supported non-expense legacy payables; supplier invoice/operating expense is directed to the expense workflow. | **PARTIAL**. A row is not by itself source-bill, receipt, or supplier-identity evidence. |
| Supplier payment request/approval | `POST /api/finance/settle-payable` (`action: INITIATE/CONFIRM/FAIL`) and `GET /api/finance/payouts`. Uses `FinancialPayout(targetType: ACCOUNT_PAYABLE)`, Treasury reservation, and an independent checker for confirmation/failure. | **VERIFIED_IN_CODE** for lifecycle. A pending payout is not a paid supplier; confirmation is based on an entered evidence reference, not independent bank validation. |
| Supplier payment correction | `POST /api/finance/revert-settlement` uses the approved settlement-correction lifecycle and `settlementCorrectionService.js`. Generic `PAYABLE` supports `VOID_NOT_EXECUTED` or `RETURNED_FUNDS`; it checks the linked cash transaction and posted journal, restores Treasury/AP, reverses the journal, records a correction/reversion, and can mark the linked account-payable payout `REVERSED`. | **VERIFIED_IN_CODE**, with the linked-bill allocation defect described in sections 5 and 9. Correction approval/evidence is internal workflow, not external bank confirmation. |
| Supplier returns / credit notes | `POST /api/returns/supplier/create`, `GET /api/returns/supplier/list`, `/reconciliation`, `/:id/applicable-bills`, and `/:id/apply-credit`. Return creation requests `SUPPLIER_RETURN_CREATE` approval; an approved action calls `supplierReturnService.js`. | **VERIFIED_IN_CODE** for the selected return/credit lifecycle; not a general procurement-return workflow or proof of original receipt/cost. |
| Purchase cancellation / supplier refunds | No PO or receipt cancellation lifecycle found. Supplier cash refund exists only as a supplier-return settlement option. Expense update/delete restrictions do not constitute a source-linked purchase cancellation/reversal flow. | Purchase cancellation **MISSING**; supplier refund **PARTIAL**, limited to approved return treatment. |
| Supplier advances / unapplied payments | No dedicated supplier-advance or unapplied supplier-payment record/workflow found. Payouts settle a payable; direct expense writers record a paid amount against an expense. | **MISSING** as a first-class supplier advance lifecycle. Do not infer a supplier advance from a Treasury outflow or generic payable. |
| Currency / exchange rate | Active vendor/accounting documents are NPR-only in the inspected flows; no procurement FX rate or foreign-currency settlement mechanism found. | **MISSING** for foreign-currency procurement. Persisted historical currency populations are **NOT_VERIFIABLE_WITHOUT_DATABASE**. |

The Admin Expense Management and Returns Management pages are the identified supplier-facing operations surfaces. Repository search across the Manufacturer/Distributor portal found no dedicated third-party supplier/AP/procurement reports; matches there are production cost breakdowns or NCM/vendor references, not supplier payable reports.

## 4. Purchase, receipt, invoice, and payable evidence chain

| Stage | Current evidence | What it establishes / does not establish |
|---|---|---|
| Supplier identity | Local active `AccountingParty(VENDOR)` with display/legal name and synthetic `sourceEntityId`. | Establishes an internal party row. Does not establish legal identity, uniqueness, supplier bank details, or independent counterparty confirmation. |
| Commercial authorization | No current PO/request/approval path found. | **Missing:** accepted item, quantity, unit, price, currency, approver, and commercial terms. |
| Physical receipt | No active goods-received path/model found. Legacy `InboundShipment.items` is JSON and is not connected to a mounted receipt acceptance workflow. | **Missing:** accepted/good/damaged/missing quantities, location, stock ownership, actor, and receipt-to-inventory movement. |
| Invoice | Expense `invoiceNumber`, optional supplier VAT number and URL; vendor can be linked to an internally generated bill document. | Records user-entered expense/invoice references. Does not prove a supplier invoice is authentic, that goods were received, or that price/quantity matches a PO/receipt. |
| Payable | `AccountPayable` stores Decimal total/paid/credit/remaining values, status, due date, supplier-party ID where linked, and generic references. Expense-backed bill documents use Decimal amounts and source IDs. | Establishes internal AP/subledger values. Generic/manual AP may not have a source bill; no whole-population bill-to-AP match has been demonstrated. |
| Expense recognition | Expense posting writes journal and, where applicable, the immediate cash/AP portions in a transaction; vendor bill and paid amount can be allocated. | Supports operating-expense/AP bookkeeping. It is not an inventory-acquisition journal or receipt. |
| Supplier payment | Payout request, reservation, independent Admin confirmation/failure, cash transaction, payable update, journal and linked bill allocation for the new expense-linked payout path. | Internal lifecycle and ledger effects are source-linked. The bank-evidence string is supplied by the user; no external bank statement is queried. |
| Supplier balance/report | Admin reports combine legacy AP, expense-linked AP, selected accounting documents, and other operational/source-specific amounts. | Not a complete supplier statement, supplier-statement reconciliation, or proof all liabilities are present. |

### Operating-expense bill writers

- The mounted `/api/expense/add` path records an `OperatingExpense`; payment/AP values, vendor and invoice references are captured in the expense workflow. VAT-bearing input remains pending internal review until approved. Where a vendor bill exists, the workflow creates the bill/links expense, AP, and journal/payment records under its transaction and idempotency patterns.
- `/api/finance/record-operating-expense` accepts full cash, credit/payable, or partial payment. For an unpaid amount it requires an active registered vendor; for an immediate paid portion it debits a selected mapped NPR Treasury account and creates a `CashTransaction`. The payable, synthetic supplier bill, expense, journal, any paid-document allocation, and audit are created in a Serializable transaction. Its input VAT fields are explicitly `NOT_CLAIMED`.
- These are two expense writers, not two purchase-order or receiving workflows. Their coexistence and source populations require a database-backed reconciliation. The original supplier bill amount is not decomposed into accepted inventory quantities, unit acquisition costs, freight, discounts, or landed costs.

## 5. Accounts-payable and payment lifecycle

### AP recognition and report basis

`OperatingExpense` is Decimal(20,2); `AccountPayable` and `AccountingDocument` are Decimal(20,2). Expense-linked payable reporting uses shared Decimal helpers to compare source expense totals, paid/payable splits, and AP balances. It classifies due dates against an as-of date in `Asia/Kathmandu` and flags source-link/amount exceptions.

The main Admin `/api/finance/payables-receivables` reader loads all legacy `AccountPayable` rows, selected marketing documents, and operational/synthetic party sources. Expense-linked balances are identified separately in `metrics.expenseLinkedPayables`; total payable pressure is not a supplier-only total and is not a complete supplier-bill schedule. The reader does not establish that every vendor bill, receipt, expense, AP row, supplier credit, cash movement, and 2110 journal line is represented exactly once.

### AP payout request, confirmation, and failure

1. Initiation validates the target payable and current remaining balance, subtracts other `INITIATED` account-payable payouts from the available amount, validates a mapped active Treasury account, reserves funds, creates an idempotent `FinancialPayout`, and audits the initiation. No cash outflow or payable settlement occurs at this stage.
2. Confirmation requires an authenticated Admin checker different from the maker and a non-empty `bankEvidenceReference`. The payout finalizer runs transactionally: it debits Treasury, updates `AccountPayable`, creates `CashTransaction`, posts the supplier-payment journal, allocates payment to the linked expense bill when available, and writes audit evidence. The payout becomes `SETTLED` only when these internal effects succeed.
3. Failure requires an independent Admin reviewer and a reason, releases the reserved funds, marks the payout `FAILED`, and writes an audit event. It does not post supplier cash outflow or settle the payable.
4. Immediate paid amounts entered through expense creation are recorded directly in the expense transaction and are not the same request/approval lifecycle as a later `FinancialPayout`.
5. A settled payout is only internally confirmed against a supplied reference. It is not independently verified against a supplier receipt, bank statement line, or supplier statement.

### Verified supplier payout-correction mismatch

For generic `type: PAYABLE`, `settlementCorrectionService.js` checks the legacy AP settlement history, cash transaction, linked supplier-payment journal, and (when present) settled `FinancialPayout`; it restores Treasury and `AccountPayable`, reverses the original journal, creates a correction cash transaction and `SettlementReversion`, and marks the payout reversed for returned funds.

The linked supplier bill correction is incomplete: unlike its separate Marketing CPA correction branch, the generic payable branch does not load or reverse the `AccountingAllocation` created against an `OperatingExpense` `AccountingDocument`, does not create a reversal allocation, and does not restore that document's `allocatedAmount`, `remainingAmount`, or status. Therefore a corrected supplier payout may leave the bill `PAID` while the linked legacy AP balance is reopened. This is a source-visible defect; actual occurrence and balance impact require isolated database inspection. No code change was made under this audit's no-transaction-logic boundary.

### Supplier advances, overpayments, failed payments, and duplicates

- A distinct supplier-advance balance and later bill allocation path was not found. The payable payout validator subtracts already initiated settlement amounts for an existing AP, preventing a second request from exceeding the currently available AP balance in the normal path; this does not create an advance workflow.
- Initiated payout retry uses the same idempotency key and rejects changed details. Independent requests are capped by the remaining AP less pending payout reservations. A failed payout releases the reservation and remains an internal failure record; a fresh request needs a new key.
- No external payment initiation/provider integration is part of this flow. A `SETTLED` internal payout is not evidence that the supplier received funds unless independently matched outside the application.
- Generic manual AP and unlinked supplier payments/advances remain separate source-completeness risks.

## 6. Supplier returns, credits, and refunds

The mounted create route submits an accounting action for approval; the approval executor calls `createSupplierReturn`. The service validates a registered active vendor and matching supplier name, request idempotency, positive whole-unit quantities, and available legacy `Product.stockQuantity`. Optional shipment matching checks the free-text supplier name and invoice number; it does not validate item-line identity, received quantity, accepted unit cost, or supplier invoice amount against a receipt.

On approval, the service:

- creates a completed `SupplierReturn` with item quantity and submitted `unitCostPrice`/`totalDebitCost` snapshots;
- decrements `Product.stockQuantity` and writes `StockLog` (not canonical `InventoryLedgerEntry` or supplier-cost-layer consumption);
- posts a `SUPPLIER_RETURN` journal. The inventory credit is calculated from the submitted return cost less any entered VAT reversal; no received cost layer is selected;
- creates a `CREDIT_NOTE` payable-side `AccountingDocument`, or records an internal Treasury inflow and `CashTransaction` for `CASH_REFUND`;
- records actor/audit and linked journal/document/cash IDs.

The credit-application service validates the source return, supplier party, posted return journal, and credit note; it can apply credit only to an open/partial bill for the same supplier and currency with issue date on or after the return date. Expense-linked AP and bill balances are checked/updated together. It records an idempotent application/allocation against the existing return journal rather than posting a duplicate return journal. No reversal path for `SupplierReturnCreditApplication` was found; the issue-date restriction may prevent applying a valid credit against an earlier originating bill and requires a business-policy decision.

The return-specific reconciliation reader checks for duplicate/missing return credit documents, journals, cash transactions, and legacy receivables, and compares linked amounts/source references. It does not reconcile the entire supplier AP subledger to 2110 or to an independent supplier statement. A cash refund record is an internal inflow and does not independently prove money was returned by the supplier.

## 7. Acquisition-cost source classification and costing method

| Source | Classification | Evidence and limitation |
|---|---|---|
| Supplier invoice total / invoice URL in expense | `AUTHORITATIVE_SUPPLIER_INVOICE` only as a recorded internal invoice reference/amount; not independently authenticated | `OperatingExpense` stores total, supplier name/party, invoice text, VAT metadata and optional URL. No item-level accepted cost, external verification, or received-quantity match exists in the active path. |
| Accepted received unit cost | `MISSING` | No active accepted-goods-received record or line-level cost path was found. |
| `InboundShipment` item/freight/tax/landed/payment fields | `UNRECONCILED` | Float and JSON schema fields exist, but no active mounted writer/receipt/layer connection was found. The legacy journal helper is not production evidence. |
| `postInboundShipmentAccounting` amounts | `UNRECONCILED` / `LEGACY_OR_UNMOUNTED` | Helper reads with JavaScript `Number`, posts freight plus items to 1140 and `customsOrTaxes` to 1150, hard-codes bank code 1120, and creates a `PURCHASE_BILL` journal only. It does not create a supplier bill, receipt, cost layer, Treasury movement, or payable allocation. |
| `Product.costPrice` | `REFERENCE_OR_CATALOG_COST` | Mutable Float catalog field. It is not supplier invoice evidence or a receipt-specific cost layer; it must not replace historical supplier cost. |
| Manufacturer production cost layers | `AUTHORITATIVE_COST_LAYER` for the supported production population only | P5-R7 established production-request/variant cost-layer evidence. These layers do not establish third-party supplier receipt costs. |
| Supplier-return item `unitCostPrice` / `totalDebitCost` | `HISTORICAL_COST_SNAPSHOT` / `UNRECONCILED` | Submitted to the return flow and used in journal value; not matched to an original received supplier cost record. |
| Freight, discounts, customs/duty, and other landed acquisition cost | `UNRECONCILED` or `MISSING` | No active production allocation method from bill/receipt to item/stock/layer was found. The unmounted helper conflates the `customsOrTaxes` input with input VAT account 1150; no active policy is established. |
| Damaged/rejected/missing supplier goods and supplier credits | `MISSING` for receipt-linked cost treatment | No goods-receipt acceptance or acquisition-layer movement exists in the active supplier path. Return code uses a separate operator-entered amount. |
| Foreign currency / FX | `MISSING` | No active supplier procurement FX rate, remeasurement, or foreign-currency bill/payment chain was found. |

**Costing-method finding:** No complete documented and implemented supplier inventory cost method was established. FIFO exists only in selected production-layer allocation/consumption paths described by P5-R7. Do not claim FIFO, weighted average, specific identification, or a uniform landed-cost method for purchased inventory.

## 8. Supplier subledger and GL evidence

The operating-expense writer posts expense/AP and Treasury effects through the existing accounting posting engine, with AP control account 2110 used by the supplier-return path and supplier-payment poster. New expense-backed `AccountPayable` and `AccountingDocument` records can be source-linked; `allocatePaymentToDocuments` records payment application on payout confirmation. These code paths support a transaction-level internal trace for the supported expense population.

The following complete reconciliations were not established:

| Comparison | Current evidence | Status |
|---|---|---|
| Supplier invoice total ↔ accepted goods receipt | No active PO/receipt population and no invoice-to-receipt matcher. | `MISSING` |
| Goods receipt ↔ inventory balance/cost layer | No active supplier receipt-to-ledger/layer writer. | `MISSING` |
| Expense bill ↔ AP row ↔ expense journal | Source links and a source-consistency report exist for expense-linked AP. Two writers and actual stored populations were not reconciled. | `PARTIAL`; persistence `NOT_VERIFIABLE_WITHOUT_DATABASE` |
| Supplier payment ↔ payout ↔ Treasury outflow ↔ journal | Linked transaction code path exists for AP payout; independent bank evidence is absent. Generic payout correction may leave supplier bill allocations unchanged. | `PARTIAL` |
| Supplier credit note ↔ returned stock ↔ payable control | Return-specific service and reconciliation exist, but the stock value is operator-entered and not linked to receipt/layers; full population not established. | `PARTIAL` |
| Supplier subledger ↔ posted AP control 2110 | Posted GL readers show journal balances, but no complete vendor-document/legacy-AP/control-account reconciliation was found. | `MISSING` / `NOT_VERIFIABLE_WITHOUT_DATABASE` |
| Supplier statements ↔ application balances | No independent supplier statement ingestion, matching, or reconciliation evidence. | `MISSING` |

A balanced Trial Balance proves only that included journal entries balance. It does not prove that every supplier bill, return, credit, payment, advance, or legacy AP record is present, unique, or reconciled.

## 9. Supplier financial report-basis matrix

| Report / portal | Source and calculation | Date/status/precision basis | Representation and reconciliation limit |
|---|---|---|---|
| Admin Expense Management list and summary | `OperatingExpense`; amounts and VAT aggregated from expense rows. Paid/payable use recorded `paidAmount`/`payableAmount`; categories are expense categories. | `startDate`/`endDate` are resolved by the Nepali calendar helper and filter `OperatingExpense.date`. Monetary aggregation uses Decimal helpers/string serialization. | Operational expense/AP summary, not purchase quantity, goods received, acquisition cost, or a complete supplier balance. |
| Admin Input VAT summary/status | `OperatingExpense` rows aggregated by `purchaseVatStatus: VERIFIED` | Follows filtered expense dates; amount uses Decimal aggregation. The approval service posts a linked reclassification journal in its transaction, but the summary does not independently verify each status against a posted journal. | Internal Finance-review status, not independent supplier or tax-authority verification or a filed VAT return. The Admin label now says **Finance-Reviewed Input VAT** and discloses this limit. |
| Admin Payables & Receivables | Loads all legacy `AccountPayable`, selected Marketing CPA documents, customer documents and synthesized non-expense party sources; includes a separate expense-linked AP summary/source-exception count. | Current report query; expense linked overdue uses a current as-of cutoff and Kathmandu-local date key. Total payable pressure is mixed-source and not a vendor-only, date-filtered supplier schedule. Some legacy projections use Number; expense-linked report uses Decimal strings. | Internal subledger/operational liability view. It is not a complete supplier statement, purchase-receipt register, or AP-to-GL reconciliation. UI disclosure was added. |
| Admin payout list/history | `FinancialPayout` and associated Treasury/cash/journal/source records. | Status filter `INITIATED`, `SETTLED`, or `FAILED`; latest initiated timestamp / internal settlement time. Decimal schema values, but some UI projections are converted for display. | Internal payout workflow. Entered bank reference is not independently matched to bank data. Failed/initiated/settled are distinct from externally verified supplier payment. |
| Admin Supplier Returns & Debit Notes / reconciliation | `SupplierReturn`, linked `AccountingDocument`, `JournalEntry`, `CashTransaction`, and legacy `AccountReceivable`. | Reconciliation loads all supplier returns ordered by `returnDate`; compares linked source IDs, counts, states, and Decimal amounts. No external supplier statement or full AP cutoff. | Return-specific internal reconciliation, not supplier-wide AP/GL, receipt, or cost-layer reconciliation. |
| Admin GL / Trial Balance / Financial Statements, account 2110 | Posted `JournalEntry`/`JournalLine` population and mapped GL account. | Requested report period and posted status; journal money is Decimal-backed. | Posted-ledger balance only. No complete source-to-supplier subledger completeness tie was established. |
| Manufacturer / Distributor portals | Search found no dedicated third-party supplier procurement/AP report. Manufacturing production cost breakdowns and delivery carrier/vendor references are distinct. | Not applicable. | Do not treat manufacturer production obligations, distributor inventory/settlements, or NCM delivery data as supplier AP. |

## 10. Evidence-backed gaps and risk ranking

| Risk | Finding | Classification |
|---|---|---|
| P1 — AP document mismatch on payout correction | Generic payable correction can restore `AccountPayable` while a linked expense supplier bill's CASH allocation and document balance/status remain unchanged. | `VERIFIED_IN_CODE`; persisted incidence `NOT_VERIFIABLE_WITHOUT_DATABASE` |
| P1 — No source-backed purchase/receipt chain | No mounted PO/approval/partial receipt/accepted goods workflow; no supplier receipt to inventory/cost layer. An expense bill can be recorded without evidence of goods receipt. | `MISSING` |
| P1 — Supplier subledger completeness | Mixed legacy AP, expense documents, source-specific settlements and synthetic summaries are not reconciled as a complete supplier schedule to 2110. | `PARTIAL` / `NOT_VERIFIABLE_WITHOUT_DATABASE` |
| P1 — Acquisition cost / inventory valuation | No verified received supplier cost, landed-cost allocation, or supplier cost-layer method. Current catalog cost is not authoritative. | `MISSING` / `UNRECONCILED` |
| P2 — Third-party payment evidence | Internal confirmation requires a reference and separate checker, but no bank statement line or supplier confirmation is independently matched. | `VERIFIED_IN_CODE` for workflow; external outcome `NOT_VERIFIABLE_WITHOUT_DATABASE` / independent evidence absent |
| P2 — Supplier identity quality | Local registry identity is synthetic/idempotency-key sourced; duplicate names and legal identity are not independently validated. | `PARTIAL` |
| P2 — Supplier credit/reversal | Credit application is limited by return date and no reversal path was found. | `VERIFIED_IN_CODE` limitation; policy intent requires decision |
| P2 — Advances, overpayments, FX | No dedicated vendor advances/unapplied payment or foreign-currency purchasing path was found. | `MISSING` |
| P2 — Legacy numeric acquisition fields | Inbound shipment is Float/JSON and its Number-based poster is unmounted; historical precision, usage, and actual journals are unknown. | `LEGACY_OR_UNMOUNTED` / `NOT_VERIFIABLE_WITHOUT_DATABASE` |

### Highest-risk gap and next bounded implementation

The most immediately actionable code defect is the **supplier bill allocation not being reversed when a linked AP payout is corrected**. It can cause the payable row and bill document to report contradictory balances even though the Treasury and journal correction path ran. Do not repair it in P5-R8 because that changes core settlement transaction behavior, which this task explicitly excludes.

Recommended next bounded increment: separately approve and test an AP payout-correction fix that identifies the exact linked supplier bill and original CASH allocation, validates allocation/source/journal consistency, atomically restores bill balances/status, and creates an immutable reversal allocation tied to the original. Cover full and partial payouts, multiple payments, returned-funds vs not-executed correction, replay, and mismatched/missing bill/allocation failure. Keep the existing audit and transaction boundaries. In parallel, treat the absence of supplier receiving/cost records as a policy/model design blocker; do not use `Product.costPrice` or the unmounted inbound helper as a workaround.

## 11. Required future isolated-data and external-evidence validation

Only after explicit authorization and confirmation of an isolated test database distinct from `localhost:3306/clothing`:

1. Inventory source populations for `AccountingParty(VENDOR)`, `OperatingExpense`, `AccountPayable`, vendor `AccountingDocument` bills/credits/allocations, `SupplierReturn`/applications, `FinancialPayout`, `CashTransaction`, `JournalEntry`/lines, and any `InboundShipment`.
2. Reconcile expense source IDs, invoice references, AP totals, payments/credits, remaining bill balances, and journals by vendor/currency/date; identify duplicates, missing rows, and out-of-balance document/AP pairs.
3. Validate the P5-R9 source-linked payable correction against representative persisted expense bills, including transaction rollback, allocation and payout state before and after correction.
4. Reconcile all supplier-related journal lines to the complete 2110 control balance by cutoff. Compare to the payable/document subledgers without assuming a balanced GL proves completeness.
5. If purchase records exist outside the application, obtain separately authorized PO, accepted receipt, invoice, credit, and return source evidence. Match independent supplier statements and bank statement lines under a documented matching policy; do not use user-entered references as independent proof.
6. Inspect representative stock physically and by title/location, then link accepted quantities and supplier costs only under approved receipt, landed-cost, return, damage, and costing policies. Validate totals against inventory balances, cost layers, and posted 1140/COGS.
7. Use only a database explicitly verified as isolated, and never bypass repository database safety guards. No such validation was run for this report.

## 12. Validation, changes, and status

- Production behavior and Prisma schema: **unchanged**.
- Admin UI: copy-only clarification of internally Finance-reviewed VAT invoice evidence and mixed-source AP/Treasury report limitations.
- Database, external supplier, bank, NCM, provider, or historical-record access: **none**.
- Backend mocked/in-memory tests: `node --test tests\expensePayableReportingService.test.js tests\purchaseVatService.test.js tests\supplierReturnService.test.js tests\supplierReturnCreditApplication.test.js tests\financialPayoutService.test.js tests\settlementCorrectionService.test.js` — **36 passed, 0 failed, 0 skipped**.
- Admin checks: `npx eslint src/pages/ExpenseManagement.jsx src/pages/PayablesReceivables.jsx` passed; `npm run build` passed with the existing large-chunk warning. `git diff --check` passed.
- These tests and checks do not establish persisted supplier/AP/inventory correctness, rollback/concurrency against MySQL, or independent bank/supplier evidence.

Statuses are separate:

| Workstream | Status |
|---|---|
| P5-R8 | **COMPLETE FOR DOCUMENTED STATIC AUDIT AND SAFE-DISCLOSURE SCOPE ONLY** |
| Phase 5 | **PARTIAL / INCOMPLETE** |
| R8 | **PARTIAL** |
| P4.2 | **INCOMPLETE** |
| P4.3 | **IN PROGRESS, INCOMPLETE** |
| Phase 4 | **INCOMPLETE** |

No Phase 6 or Phase 7 work was started.

**P5-R9 follow-up:** The verified source-linked expense-bill allocation correction was implemented in [26-p5-r9-supplier-payable-correction-integrity.md](./26-p5-r9-supplier-payable-correction-integrity.md). This resolves the documented code-path omission for uniquely linked bills but does not validate any persisted record, supplier balance, bank payment, or supplier statement. P5-R8 remains complete only for its static audit and safe-disclosure scope.
