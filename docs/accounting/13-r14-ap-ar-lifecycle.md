# R14 — Accounts Payable and Receivable Lifecycle

**Review date:** 2026-11-16

**Status:** **PARTIAL** — route/service/schema review only; balances and source populations were not read from a database.

## 1. Design boundary

AP/AR is not a single table or report. The repository has parallel generations:

- Newer `AccountingDocument`/allocation records model typed party obligations and settlements.
- Legacy mutable `AccountPayable` and `AccountReceivable` rows support operational and manual finance flows.
- Source-specific records exist for production, expenses, returns, CPA, NCM/COD, distributor settlement, payouts, and loans.
- Journal lines and cash transactions provide accounting effects, but they do not prove every source or open balance is included.

**PROPOSED INTERNAL POLICY:** Use an immutable source-linked document for each obligation/credit, immutable allocations for settlement/application, and a separately evidenced cash/settlement event. Preserve legacy rows as explicitly identified migration/compatibility sources until their population is reconciled. A journal-balanced control account is not proof that all documents are present.

## 2. Payables

| Obligation/source | Current writer and settlement | Current readers/reports | Gaps / evidence status |
|---|---|---|---|
| Supplier operating expense | `POST /api/expense/add` writes expense, paid cash and/or unpaid bill, journal and audit in the main transactional path. A parallel `/api/finance/record-operating-expense` writer exists. | Admin payable and expense summaries combine expense-linked balances and other payable sources; Treasury/GL reports are separate. | Two writers and category fallbacks; source-to-bill-to-journal population reconciliation incomplete. Monetary Decimal conversions in recent bounded reports do not establish all legacy/source precision. |
| Manufacturer production and logistics | Production completion posts approved cost payable; local/manual freight can accrue manufacturer payable at dispatch. Manufacturer settlement request and payout paths are distinct. | Manufacturer summary/settlement history and legacy journal-line synthesis. | New document, legacy amount fields, settlement-request history and journal summaries can overlap or omit populations; no persisted full manufacturer/AP/GL reconciliation. |
| Customer refunds | Selected platform return paths create refund AP; Admin payout settles through maker-checker flow. Distributor refund has separate evidence/review handling. | Payout history, return reports, AP readers. | Different populations/funders; return approval is not payment evidence; no universal linked refund reconciliation. |
| Marketing CPA | Verified redemption accrues CPA bill; payout clears it. Legacy `MarketingPartnerSettlement` remains. | CPA reports and party payable readers. | Legacy and new sources coexist; historic rates, complete population and withholding treatment remain unverified. |
| Distributor obligations / netting | New `StockTransfer`/settlement documents and selected logistics costs; settlement can offset eligible AP/AR documents before cash. | Distributor portal statements and Admin summary/reconciliation services. | Legacy requests and earnings still coexist; set-off authority/source evidence needs review; not a full control-account population. |
| Generic/manual payable | Manual finance path can create a legacy AP balance. | Admin payable summary/party readers. | May not have a source bill, allocation, or journal; do not infer valid obligation solely from row existence. |
| Supplier return / credit note | Return creates supplier credit note or refund record; application allocates credit to open bill without a second return journal. | Supplier payable documents/statements. | Application reversal was not found; source completeness and credit note to stock/GL reconciliation remain incomplete. |

### Expected payable sequence

1. Establish an approved bill/obligation from a verifiable source and counterparty.
2. Record appropriate expense, inventory, asset, or return effect and liability; do not create an unclassified payable as a substitute for source evidence.
3. Keep payment request/reservation separate from confirmed payment.
4. At independently authorized confirmation, record Treasury/cash transaction, linked payable allocation and journal in the same transaction; enforce maker-checker identity and key replay rules.
5. Apply credits/adjustments through separately keyed allocations or correcting events. Preserve the original bill and posted journal.
6. Report total bill, approved adjustments, allocated paid, and remaining amount using exact decimal arithmetic. A positive residual is outstanding; it must not be rounded to zero for classification.

## 3. Receivables

| Receivable/source | Current writer and collection | Current readers/reports | Gaps / evidence status |
|---|---|---|---|
| Delivered customer order | Delivered-sale accounting creates receivable/tender effect under the existing delivery-recognition rule. Collection is through distinct finance/order helper paths. | Receivable cards, sales analytics, customer collection and GL reports. | Order `payment` flag is not an authoritative collection ledger; delivered COD can be marked paid while carrier money remains due. |
| Manual/customer AR | Finance route may create legacy `AccountReceivable` independently of a posted invoice/journal. | Admin AR summary and collection service. | A row may not have a source invoice, customer allocation or journal. Source-backed vs manual balances need distinct reporting. |
| Distributor COD/remittance | Delivery and NCM flows create COD/carrier receivable, batch remittance and settlement/variance records. | Distributor and NCM reports, source-specific reconciliation. | New and older settlement helpers coexist; external bank deposit evidence is outside the API source and complete control tie is not proven. |
| Distributor settlement/offset | Selected settlement path nets eligible payable and receivable documents and records remainder/cash. | Distributor statements and settlement reports. | Legal/contractual set-off authority and legacy source coverage need decision and evidence. |
| Customer collection | Treasury collection path has transactional cash/AR/journal behavior and decimal-string API serialization. A separate `financialController` path handles discount/fine adjustments. An order cash-receipt helper is not mounted in the reviewed order routes. | Receivable summary/collection history, Treasury and GL reports. | Two implementations differ in adjustment semantics and source/linkage. Do not equate mocked service tests with persisted atomicity. |
| Sales return / customer credit | Return poster and refund obligation are separate from original receivable and any cash refund. | Return reports, payout, AR/AP views. | Credit application and refund funding are not unified across platform and distributor routes. |

### Expected receivable sequence

1. Create a receivable only from a supported source (delivered sale, approved invoice, or explicitly authorized manual document) with counterparty, effective date and immutable source identity.
2. Record each receipt separately with method, actual settlement evidence, Treasury account and caller-supplied key where required.
3. Allocate no more than the eligible open amount. If a valid receipt exceeds that amount, preserve the unallocated amount explicitly for approved handling rather than over-applying or dropping it.
4. For split allocations, compute with shared Decimal utilities and deterministic residual assignment; allocations must sum exactly to the collection amount and preserve each document's cap.
5. Record adjustments (discount, fine, credit note, write-off) under an explicit authorized reason/source and mapped accounting treatment, not as unexplained collection differences.
6. Keep unapplied receipts/customer advances distinct from revenue and from settled AR until applied or refunded under approved policy.
7. Serialize monetary API values as decimal strings; UI may format strings but must not convert authoritative amounts back to `Number`.

## 4. Aging, status, summaries and statements

- **Balances:** New document balances are based on face amount less adjustments and allocations; legacy rows may store mutable amounts or paid flags. Recompute/compare only with precise source definitions.
- **Paid/partial/unpaid:** Use exact Decimal comparisons: outstanding `<= 0` is settled; positive outstanding is not settled; allocation and amount precision must be retained. Do not infer settlement solely from a Boolean or round before comparison.
- **Overdue:** Require an explicit due date and report cutoff. Apply the project's Kathmandu-local calendar date handling consistently; do not use host-UTC midnight or a floating 24-hour duration to define a local calendar day.
- **Aging buckets:** Compute from the same cutoff and due-date semantics; specify bucket boundaries as inclusive/exclusive dates so adjacent buckets neither overlap nor omit a day. Keep missing due dates as an explicit category, not implicitly current or overdue.
- **Summaries:** A card is only as complete as its selected source population. Label included source generations and exclude/flag duplicate legacy representations rather than adding them blindly.
- **Statements:** Party statements should show opening balance, source documents, credit/adjustment, allocation, payment, running balance and closing balance, each with a stable source/reference and effective date.
- **API/UI/export:** Monetary values use decimal-string serialization. Admin readers and downloadable reports must preserve the string/Decimal contract through aggregate, sorting, classification, filtering and formatting. Counts, quantities and dates remain appropriately typed.

Current code includes expense-linked payable aggregation, party payable summaries, settlement history, supplier/manufacturer/distributor statements and controller serializers, but not every source-generation combination uses the same model. Report classifications and aging should not be assumed consistent simply because each endpoint displays a total.

## 5. Source, allocation and journal reconciliation map

For each party and cutoff, reconcile three independent layers:

1. **Source-to-document:** source expense/production/return/CPA/settlement/approved manual bill equals the correct typed bill or explicit legacy record, without missing or duplicated source IDs.
2. **Document-to-settlement:** face amount less valid credits and allocations equals exact open balance; every payout/collection allocation is within source document and receipt limits; unallocated funds/credits are separately surfaced.
3. **Subledger-to-GL:** complete document and adjustment population equals mapped AP/AR control balance by party and cutoff; cash/Treasury movement agrees to settlement journal and actual external evidence.

An expense-linked report calculation test proves only its arithmetic for fixtures. A persisted source-to-payable test requires an isolated database and real transaction path. A source-to-journal reconciliation requires complete source, allocation, journal and control-account populations. R14 has executed none of these.

## 6. Known cross-cutting risks

**P1**

- Parallel legacy and document subledgers make it possible for manual balances to lack a source journal or for summaries to double-count overlapping sources.
- Two customer-collection implementations have differing adjustment semantics and source identity. The delivered-order cash helper is not routed through the reviewed order API.
- COD `payment=true` semantics can overstate settled customer cash if reports use it as payment evidence.
- No complete source-to-AP/AR-control-account reconciliation has been demonstrated.

**P2**

- Excess, unapplied payments/credits, supplier advances and customer advances lack one consistent treatment.
- Aging/status/report dates and population boundaries differ by endpoint.
- Legacy Float-backed amount fields and Number-based readers remain in the broader AP/AR source graph; do not claim exact precision just from Decimal output serialization.
- Report/export and statement coverage across all expense-linked, production, refund, CPA, NCM and legacy sources remains incomplete.

## 7. Validation boundary

Existing focused tests include Decimal collection and payable/settlement report tests, document allocation tests, financial payout lifecycle tests and selected reconciliation tests. R14 ran no code tests. Database integrations remain gated; without a separately verified isolated endpoint, persisted source-to-document, transaction rollback, replay, concurrency and source-to-journal validation are **BLOCKED**. Do not access configured `localhost/clothing`.

## 8. P5-R8 supplier procurement and payable-correction revalidation (2026-11-18)

The current static supplier procurement/AP findings and report basis are in [P5-R8](./25-p5-r8-supplier-procurement-and-payables-evidence-audit.md). Current routes confirm local vendor registry, expense-backed vendor bills, AP payouts, supplier returns/credits, and return-specific reconciliation. They do not establish a production PO/receipt chain, accepted supplier quantity/cost, a supplier advance subledger, complete 2110 vendor reconciliation, or independent supplier/bank statement matching. `InboundShipment` and its accounting helper remain legacy/unmounted for production-route evidence.

**Correction-path defect:** `settlementCorrectionService`'s generic `PAYABLE` path reverses the legacy payable/Treasury/journal and can mark the linked AP payout reversed, but it does not reverse a CASH `AccountingAllocation` or restore the linked `OperatingExpense` supplier `AccountingDocument` balance/status. The AP and bill-document subledgers can diverge after correction. This is verified in code; actual persisted incidence is not known. No transaction behavior was changed. A focused, separately approved correction should validate and reverse the exact bill allocation atomically with the existing Treasury/AP/journal/reversion effects.

The Admin VAT and AP page disclosures are copy-only. R14 and P5-R8 remain static/code-evidence audits; actual supplier balances, source completeness, rollback/concurrency, and external payment/statement evidence require a separately verified isolated database and independently obtained supplier/bank records.

## 9. P5-R9 supplier payable correction integrity (2026-11-18)

The P5-R8 generic payable correction defect has a bounded code correction. The mounted Admin approval path now identifies the single `OPERATING_EXPENSE` bill for a payable's `accountingPartyId` and `referenceId`, then reverses only the CASH allocation linked to the selected source payment journal and payout key. The correction restores the document's allocated/remaining Decimal balances and derives `OPEN`/`PARTIALLY_PAID`/`PAID` status from those balances. Missing, ambiguous, already-reversed, mismatched, or over-reversal evidence fails closed.

The original allocation and journal remain historical records. A linked `REVERSAL` allocation records the source allocation ID and correction journal; the bill update, payable/Treasury/cash/journal/payout correction, settlement reversion, approval, and audit remain within the existing serializable approval transaction. Payables without an accounting-party bill link continue on their existing generic path; the code does not infer a supplier bill for them. The generic correction still permits only its existing record-level correction and latest-history selection, not multiple corrections against one AP row.

Focused tests cover full and partial restoration with other allocations remaining, missing/already-reversed/mismatched/over-reversal allocations, approval idempotency and maker-checker behavior, and injected failure using an in-memory transaction wrapper. Those mocks do not establish persisted rollback, concurrency, or database balance correctness. No schema, purchase/receipt, payment-initiation, Treasury-posting, customer-receipt, or inventory-costing behavior changed. See [P5-R9](./26-p5-r9-supplier-payable-correction-integrity.md) for the route trace and validation limits.

## 10. P5-R10 supplier return and credit evidence (2026-11-18)

The mounted supplier-return path is `POST /api/returns/supplier/create` → independent accounting-action approval → `createSupplierReturn`. Approval creates a completed return and atomically posts a Product/StockLog decrement plus either a payable-side internal credit document and AP journal or an internal Treasury cash inflow and journal. There is no required link to an original supplier bill, accepted receipt line, cost layer, physical handoff, supplier-approved credit note, or independent refund evidence. The optional legacy shipment reference matches supplier/invoice text only.

The internal AP credit is posted at return approval without allocation to the original bill. Later application is a direct, permission-gated Admin route, limited to same-vendor/same-currency open bills issued on or after the return date. It updates credit/bill document balances, optional expense-backed legacy AP, paired allocations, and audit history without another journal. It does not use a separate approval request, despite the Admin UI message, and no application reversal was found. P5-R9 payable correction does not supply a correction path for these return records.

Internal return credit or cash records do not establish a supplier obligation reduction or cash receipt. Return-specific reconciliation matches internal records but is not a supplier subledger/2110 tie-out or a physical/cost-layer reconciliation. Do not claim return or credit confirmation without independent supplier, receipt, and bank evidence. Keep this workflow audit-only pending source-link and reversal policy; see [P5-R10](./27-p5-r10-supplier-returns-and-credit-evidence-audit.md).

## 11. P5-R11 supplier return credit and refund control gap (2026-11-17)

P5-R11 confirms the core design gap: return posting is source-unlinked and inventory/cost evidence is not authoritative, while the direct credit-application route is not maker-checker gated in production. The UI message stating an independent approval is pending is a mismatch with the mounted route behavior. Until the repository can prove original receipt linkage, accepted quantity and cost, supplier acceptance, confirmed refund evidence, and a source-specific reversal path, treat return and credit positions as internal ledger evidence only.

The safe next step is a source-linked design and policy gate, not a production code change. No production behavior was changed in this increment; see [26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md](./26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md).
