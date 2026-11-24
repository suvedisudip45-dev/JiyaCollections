# P5-R1 — Accounting Domain and Report-Basis Inventory

**Review date:** 2026-11-17  
**Status:** **PARTIAL** — source-code inventory and a migration-free posted-ledger disclosure are implemented; end-to-end population validation and full report/export caller inventory remain open.

## 1. Evidence boundary

This is a static review of current routes, controllers, services, Admin readers, and the R14 domain/control inventories. “Implemented” means a code path is present, not that it is complete, persisted correctly, or reconciled. The earlier R14 inventories remain the detailed event-level references; this report records the Phase 5 coverage conclusion and revalidates the primary report basis.

No database, MySQL endpoint, production credential, external provider, migration, seed, historical record, or persisted balance was accessed or changed. Tests described here use mocked Prisma methods only.

Primary source anchors:

- [`accountingRoute.js`](../../backend/routes/accountingRoute.js), [`financialRoute.js`](../../backend/routes/financialRoute.js), and [`server.js`](../../backend/server.js) (mounts `/api/accounting` and `/api/finance`).
- [`accountingController.js`](../../backend/controllers/accountingController.js): `getGeneralLedgerReport`, `getTrialBalanceReport`, `getRealtimeFinancialStatements`, and `getSubledgerReconciliation`.
- [`accountingControlCoverageService.js`](../../backend/services/accountingControlCoverageService.js), [`accountingLedgerIntegrityService.js`](../../backend/services/accountingLedgerIntegrityService.js), and [`accountingCashFlowService.js`](../../backend/services/accountingCashFlowService.js).
- [`financialController.js`](../../backend/controllers/financialController.js): `getFinancialAnalyticsDashboard`, `getVATAndTaxReport`, and `getFinancialStatements`.
- [R14 business-event inventory](./09-r14-business-event-inventory.md), [R14 accounting event/reporting matrix](./10-r14-accounting-event-matrix.md), and [Phase 3 control-account inventory](./08-phase-3.0-control-account-inventory.md).

## 2. Domain coverage matrix

| Domain | Source and primary writer path | Accounting path / report reader | Current coverage and known limit |
|---|---|---|---|
| Customer orders and delivered sales | `Order` and accepted order snapshot; storefront `POST /api/order/place`, Admin `POST /api/order/admin-create`, [`manufacturerDirectOrderController.js`](../../backend/controllers/manufacturerDirectOrderController.js), and [`distributorDirectOrderController.js`](../../backend/controllers/distributorDirectOrderController.js) | Delivery accounting outbox and `postDeliveredOrderAccounting`; posted statements, sales/invoice readers | **Partial.** Accepted pricing and delivered-sale posting exist; order acceptance, delivery, returns, collection and journal populations are not proved complete or persisted-reconciled. |
| Customer collections and AR | Legacy `AccountReceivable`, source-linked `AccountingDocument`/`AccountingAllocation`, receipt events; finance collection routes | Treasury/journal collection paths; `/api/finance/receipt-reconciliation`, `/api/accounting/subledger-reconciliation` | **Partial.** Newer source-linked flows coexist with legacy/manual records; direct-order tenders and all 1130 populations are not unified. |
| Returns, refunds and exchanges | `CustomerReturn`, `OrderExchangeRequest`, inspection and refund records; customer, Admin and distributor workflows | Return/exchange posters, refund-payable and settlement paths; order/return and accounting readers | **Partial.** Platform and distributor-funded effects differ; no universal reversal or complete source population reconciliation. |
| Distributor COD and settlement | `DistributorCashEvent`, remittance/settlement batches, distributor order and payout records | Distributor settlement services and mapped GL postings; distributor portal reports and subledger reconciliation | **Partial.** Verified source events and newer settlement paths exist; legacy requests, full 1190/2190 controls, and independent bank evidence remain open. |
| NCM COD and carrier fees | `DeliveryFinancialSettlement`, NCM batches/items and variance resolutions | COD/carrier document and journal paths; `buildNcmCarrierFeeReconciliation`; Accounting Health | **Source-scoped.** Newer 1170/2180 flows are checked separately; historical and other-carrier populations and external bank matching remain outside the check. |
| Marketing CPA | `MarketingCardEvent` redemption/rate snapshot and partner identity | CPA expense/AP journal, source-linked bill and payout; `buildMarketingCpaPayableReconciliation` | **Source-scoped.** New CPA events are traceable; unknown historical rates, legacy settlements, withholding and full 2170 balance remain unreconciled. |
| Manufacturer production and payable | Production requests, accepted batch/cost layers, shipment freight, manufacturer payout records | Production/logistics posters and source-specific reconciliation services | **Partial.** Production and local freight checks exist independently; legacy delivery accruals, all settlement sources and complete 2160 balance remain open. |
| Distributor earnings and payable | `DistributorServiceEarning`, refund/exchange documents and settlement offsets | Distributor earning/refund journals and selected party subledger checks | **Partial.** Current check covers selected earning sources; bonuses, refunds and legacy payout paths are not a complete 2190 schedule. |
| Expenses, procurement and supplier AP | `OperatingExpense`, `AccountPayable`, `AccountingDocument`; expense and supplier-return routes | Expense/supplier-return posters, AP/payable reports and cash payout paths | **Partial.** Expense and selected supplier credit flows exist; parallel writers, general vendor-bill coverage, purchase receiving/cost-layer linkage and full 2110 reconciliation remain open. |
| Treasury, cash, bank and clearing | `FinancialAccount` and `CashTransaction`; Treasury, settlement, receipt and payout routes | `buildTreasuryGlReconciliation`, GL reports and Finance readers | **Partial.** Treasury-register balances compare with mapped GL; there is no connected cash-count or bank/provider statement-line reconciliation. Account 1180 can mix wallet and gateway-clearing use. |
| Inventory and COGS | `InventoryBalance`, `InventoryLedgerEntry`, cost layers plus legacy stock models | Inventory/production/delivery posters and `buildInventoryValuationReconciliation` | **Partial.** The current calculator excludes unsupported/unmatched quantities rather than guessing; legacy stock, cost completeness, physical existence, transit, returns and ownership remain unresolved. |
| Input/output VAT and corporate tax | Expense tax evidence, sale/return snapshots, `TaxFilingRecord`, effective-dated rate/policy records | Posted VAT snapshot, VAT filing services and `/api/finance/tax-report` | **Mixed / partial.** Posted VAT and operational corporate-tax projections are distinguishable; neither source completeness nor statutory filing accuracy is established. |
| Fixed assets and depreciation | `FixedAsset` register, acquisition and depreciation batch requests | Asset journals and `buildFixedAssetReconciliation`; Finance asset reader | **Source-scoped.** Register-to-GL checks do not prove physical existence, opening completeness, class policy or tax basis. |
| Loans and debt | `InvestorLiability`, loan schedule and repayment records | Loan accounting services and 2510/interest journal lines; Finance liability and schedule readers | **Partial.** Selected disbursement/repayment paths exist; lender statements, opening principal, interest completeness and precision remain unverified. |
| Capital, equity and drawings | Partner/share transactions, capital records, liability and Treasury movements | Share/loan/drawing posting paths; cap-table and partnership readers | **Partial.** Distinct code paths exist, but legal register, opening evidence, classifications and complete control tie-outs are not established. |
| Partner profit distribution | Operational partner data and posted accounting snapshot inputs | Estimate-only profit-distribution endpoint/UI | **Estimate only.** Current calculation cannot execute a payout or create AP/cash/journal effects; it is not an approved distribution or posting basis. |
| Journal, COA and period controls | Journal, account, approval and close-event sources | Accounting routes, ledger integrity, close/approval services and accounting reports | **Partial.** Posted/reversed journal reports and selected maker-checker/close controls exist; source-event coverage, external evidence, route-wide bypass review and persisted controls remain open. |

This matrix is not evidence that any listed balance is correct. The detailed control-source mappings, including blocked and partial controls, are in [08](./08-phase-3.0-control-account-inventory.md); event lifecycle details and unresolved policy questions are in [09](./09-r14-business-event-inventory.md) and [10](./10-r14-accounting-event-matrix.md).

## 3. Report and reader basis inventory

| Endpoint / reader | Current source basis | Consumer / compatibility | Coverage conclusion |
|---|---|---|---|
| `GET /api/accounting/general-ledger[/:accountId]` | `JournalEntry`/`JournalLine` filtered by transaction date and the posted/reversed report statuses | Admin General Ledger | Posted-ledger detail; source completeness is not established. API now returns additive `reportBasis` metadata. |
| `GET /api/accounting/trial-balance` | Posted/reversed journal lines, including journal-derived opening balances and period movement | Admin Trial Balance | Double-entry parity is a journal invariant, not proof of complete events or source reconciliation. API now returns additive `reportBasis`; UI says so. |
| `GET /api/accounting/financial-statements` | Posted/reversed journal lines for P&L/BS; direct cash-flow builder uses posted GL cash-equivalent activity | Admin Financial Statements | Posted-ledger basis; no operational fallback. It does not prove complete source populations or external cash/bank reconciliation. API now returns additive `reportBasis`. |
| `GET /api/accounting/subledger-reconciliation` | Mixed GL, Treasury, legacy AR/AP and selected source-specific operational/document populations | Admin Accounting Health | Explicitly `PARTIAL`; selected calculators do not establish completeness of the control accounts. |
| `GET /api/finance/dashboard` | Posted accounting snapshot is returned separately from operational costs, ROI, working-capital and snapshot estimates | Admin Finance Dashboard | UI separates posted totals and operational estimates. Activity and balance snapshots may have different populations and dates. |
| `GET /api/finance/statements` | Operational orders, current product cost, operational expenses/assets/Treasury/AP/AR and estimated cash-flow | Compatibility API; no current portal callsite was found in the inspected portal search | Estimate-only `reportBasis` exists. External API usage is unknown; endpoint is retained. |
| `GET /api/finance/tax-report` | Posted VAT snapshot plus operational expense/asset corporate-tax projection | Admin Tax Compliance | Additive mixed-basis metadata and estimate/non-filing notice exist. It is not a tax assessment or filing. |
| `GET /api/finance/payables-receivables`, `/receipt-reconciliation`, `/payouts` | Legacy balances plus selected source-linked bills, allocations, receipts and payout lifecycle records | Admin Payables & Receivables and receipt/settlement readers | Mixed operational/subledger scope; full 1130/2110 reconciliation and external cash evidence remain unestablished. |
| Sales invoices, paper-bill reports, operational order/sales/export readers | Transactional invoice, order, return and operational records, depending on endpoint | Admin tax and sales screens; portal order history and operational reports | These are not substitutes for posted-ledger statements. Full endpoint/export caller and per-field basis inventory remains an open P5 task. |
| `AccountingPostingStatusBanner` | Delivery accounting outbox status | Several Admin accounting pages | Reports delivery outbox backlog/status only; it is not a complete accounting-domain or source-reconciliation control. |

### Posted-ledger basis contract added in this increment

The three journal-derived report endpoints expose an additive top-level `reportBasis` object with:

- `classification: "POSTED_JOURNAL_LEDGER"`, source models, transaction-date basis, period and included journal statuses.
- `sourceCompleteness` and `subledgerReconciliation` explicitly set to `NOT_ESTABLISHED`.
- Limitations stating that pending/unposted events are excluded, balanced totals do not prove source completeness, and operational data does not reconstruct missing opening journals.

Existing response values and field types are unchanged. Admin pages render the limitations and fail visibly to a “metadata unavailable” notice if the backend omits the descriptor. This does not certify report authority, source completeness, or persisted reconciliation.

## 4. Tests and validation

- `node --test tests/accountingLedgerReports.test.js tests/realtimeFinancialStatements.test.js` from `backend/`: **7 passed, 0 failed**. These tests replace Prisma client methods with in-memory mocks; they validate report response shape, decimal arithmetic and date bounds, not database behavior.
- Targeted ESLint on Admin General Ledger, Trial Balance, Financial Statements and the new notice: **0 errors, 3 existing React-hook dependency warnings** in General Ledger/Trial Balance.
- `git diff --check`: passed.
- No migration, database-backed test, persisted balance validation, independent source schedule, or external cash/provider reconciliation was performed.

## 5. Remaining P5-R1 blockers and next priority

1. Complete endpoint/caller inventory for all Admin and portal reports, exports, dashboards and background jobs, with field-level source basis and stale/compatibility status.
2. Verify active event writers, readers, reversal/settlement paths and report populations against current code for every domain, then add focused mocked route/service tests where gaps exist.
3. Implement source completeness and balance comparisons only where independent source populations and cutoff semantics are demonstrated. Keep unsupported historical sources explicitly incomplete.
4. Compare representative reports and reconcile source/subledger/journal populations only after an independently verified, separately authorized isolated database and source evidence are available.
5. Keep legacy operational statements and mixed tax projections labeled; do not remove or promote them without external-caller inventory, comparison evidence and approval.

**Follow-up:** P5-R2 has completed a static route-to-reader and source-to-cash-to-GL trace for collection, return/refund and settlement paths, and added a receipt-specific audit event to the mounted customer invoice receipt service. See the [P5-R2 evidence-chain inventory](./20-p5-r2-collection-return-settlement-evidence-chain.md). The highest-priority remaining engineering gap is direct-order receipt capture and source allocation, after the Phase 4 money/date contract and direct-order evidence/tender policy are ready. Distributor remittance submission, source-specific correction paths, complete report/export coverage, and independent cash/bank reconciliation remain open. These must not be inferred from `Order.payment`, a balanced trial balance, or a Treasury-to-GL match.

**Status:** P5-R1 **PARTIAL**; Phase 5 remains **PARTIAL / INCOMPLETE**. R8 remains **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **IN PROGRESS, INCOMPLETE**. No new Phase 6 or Phase 7 work was started.

## P5-R7 inventory and COGS report-basis addendum (2026-11-17)

The inventory/COGS reader trace in [24-p5-r7-inventory-valuation-and-cogs-evidence-audit.md](./24-p5-r7-inventory-valuation-and-cogs-evidence-audit.md) refines the earlier inventory row and adds the following distinctions:

| Reader | Basis | Important limit |
|---|---|---|
| Admin product inventory list | `OPERATIONAL` — `Product.stockQuantity` and variant JSON | Legacy catalog projection; not canonical location balance, ownership, physical count, or valuation. |
| Admin manufacturer inventory monitor | `SUBLEDGER` — canonical PLATFORM-owned ledger balances | Current on-hand/reserved quantity only; not a physical count, cost valuation, or GL match. |
| Manufacturer inventory list | `OPERATIONAL` — `ManufacturerInventory` and legacy movement records | Not the canonical ledger or a verified inventory asset/valuation. |
| Distributor inventory | `SUBLEDGER` — canonical distributor/damaged location balances | Quantity only; no cost or GL reconciliation. |
| Admin COGS calculator | `ESTIMATE` / quote comparison — manufacturer price quotes and catalog prices | Not actual COGS, realized margin, or a posted result. |
| Finance Dashboard inventory value and product cost | `ESTIMATE` — production-layer valuation plus catalog-cost fallbacks and operational order activity | Not a complete 1140 inventory valuation or 5100 posted COGS population. |
| Accounting Health inventory comparison | `UNRECONCILED` — source-scoped canonical balances/layers compared with posted 1140 | Unsupported/unmatched quantities are excluded or flagged; does not establish full valuation, ownership, or physical existence. |
| GL statements and ledger, accounts 1140/5100 | `POSTED_LEDGER` for included journals | Posted-only; no complete movement/layer source tie-out is established. |

These are not interchangeable measures. Inventory dates are current/as-of-request for balance readers; the dashboard combines period activity with a current inventory snapshot. Quantity APIs use integer quantities serialized as JSON numbers; dashboard/cost-analytics estimates use JavaScript Number conversions/rounding; posted accounting endpoints use decimal-string output. No universal return treatment, cost method, date cutoff, or inventory-to-GL reconciliation exists across these readers.

P5-R7 made copy-only disclosures in affected inventory/COGS pages. No report calculation, endpoint, or posting behavior changed. The inventory row above and this addendum supersede any implication that the Finance Dashboard or ledger quantity screen is a complete valuation or physical stock report. P5-R7 is complete only for its static audit and disclosure scope; Phase 5 remains **PARTIAL / INCOMPLETE**.

## P5-R8 supplier procurement and payable report-basis addendum (2026-11-18)

The current supplier/AP trace is documented in [25-p5-r8-supplier-procurement-and-payables-evidence-audit.md](./25-p5-r8-supplier-procurement-and-payables-evidence-audit.md). It refines the earlier `Expenses, procurement and supplier AP` row above:

| Reader / source | Basis | Important limit |
|---|---|---|
| Admin Expense Management totals | `OPERATIONAL` expense records; paid/payable are recorded splits | Not a purchase order, goods-received schedule, inventory acquisition cost, or complete supplier balance. |
| Admin input VAT aggregate | Internal `Finance-reviewed` recorded invoice evidence and its posted reclassification journal | No independent supplier or tax-authority verification; not a filed VAT return or independently authenticated invoice. |
| Admin Payables & Receivables | Mixed legacy AP, expense-linked AP, selected accounting documents, and other operational/source-specific amounts | Not a supplier-only total, complete receipt register, complete AP/2110 reconciliation, or independent supplier/bank statement match. |
| Admin payout history | Internal `FinancialPayout`, Treasury, cash, AP and journal records | An entered bank evidence reference is not independently matched to a bank statement or supplier confirmation. |
| Supplier-return reconciliation | Return-specific `SupplierReturn`, credit document, journal, cash and legacy-receivable links | Does not establish supplier-wide AP/GL completeness or cost-layer/received-quantity evidence. |
| Manufacturer / Distributor supplier reports | No dedicated third-party supplier/AP report found in the inspected portal sources | Production cost breakdown and NCM/vendor references are different business sources, not supplier AP. |
| Posted account 2110 | Posted GL journal balance | A balanced/posted GL report does not prove complete supplier subledger or source population. |

Two Admin copy-only disclosures now state these bases. The static audit also found a generic payable payout-correction path that reopens `AccountPayable` without reversing a linked expense-bill allocation/document balance; persisted impact is **NOT_VERIFIABLE_WITHOUT_DATABASE**. No amount calculation, posting, report formula, schema, or transaction behavior changed.

## P5-R9 payable-correction report-basis addendum (2026-11-18)

The source-linked expense-bill allocation mismatch from P5-R8 has been corrected for the verified generic `PAYABLE` correction path; details are in [26-p5-r9-supplier-payable-correction-integrity.md](./26-p5-r9-supplier-payable-correction-integrity.md). This restores consistency between the affected legacy payable and its existing expense-bill document when exact allocation evidence exists. It does not change any report query, aggregation, date basis, status population, or report classification. Payables without a source-linked bill remain outside the bill subledger, and neither the correction nor its mocked tests establish persisted AP/2110 reconciliation or independent supplier/bank verification.

## P5-R10 supplier return and credit report-basis addendum (2026-11-18)

| Reader / source | Basis | Important limit |
|---|---|---|
| Admin Returns Management supplier-return list and amount summary | Internal `SupplierReturn` records, submitted unit-cost snapshots, recorded status and source IDs | Operational return register only; not accepted receipt quantity, supplier-approved credit, verified cash refund, or authoritative acquisition cost. |
| Supplier-return reconciliation | Return-specific document, journal, cash, and legacy-receivable source matching | Does not inspect original bill/receipt, Product/StockLog or canonical inventory ledger/cost layer, credit-application allocations, supplier acceptance, independent bank receipt, or complete supplier/2110 balances. `RECONCILED_*` is internal evidence matching only. |
| Supplier credit application | Internal credit/bill documents, paired OFFSET allocations, optional expense-backed AP, audit | Direct Admin application in the mounted route; not maker-checker approval despite the UI toast. No reversal was found. |
| Supplier return cost | Submitted item `unitCostPrice` snapshot | `UNRECONCILED`; no invoice-line/accepted-receipt/cost-layer match. Do not use as proof of historical acquisition cost. |
| Supplier cash refund | Internal Treasury balance, cash inflow, and journal | No independent bank or supplier evidence; not verified receipt of cash. |

See [P5-R10](./27-p5-r10-supplier-returns-and-credit-evidence-audit.md). No report calculation or classification code changed; persisted report populations and balances remain unverified.

## P5-R11 supplier-return credit and refund lifecycle report-basis addendum (2026-11-17)

| Reader / source | Basis | Important limit |
|---|---|---|
| Supplier-return creation approval | Internal `AccountingActionApproval` and return-creation service | Approval verifies request submission, not supplier acceptance or original receipt quantity/cost. |
| Supplier credit application | Direct route permission and account-document updates | UI says approval is pending, but mounted route executes directly; no independent maker/checker gate was found. |
| Supplier refund/Treasury inflow | Internal `CashTransaction` and Treasury account update | Not actual bank receipt or supplier-confirmed refund evidence. |
| Inventory return effect | Aggregate `Product.stockQuantity` and `StockLog` only | No canonical ledger movement or cost-layer linkage; inventory return remains unverified. |
| Reversal design | None found in the traced production path | No safe source-specific correction path for stock, AP, refund, journals, or audit history. |

The P5-R11 design review is documented at [26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md](./26-p5-r11-supplier-returns-credit-application-and-refund-lifecycle.md). No report calculation or business behavior changed.
