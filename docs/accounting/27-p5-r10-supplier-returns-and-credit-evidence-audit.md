# P5-R10 — Supplier Returns, Supplier Credits, and AP/Inventory Evidence Audit

**Status:** Complete for static code trace and evidence classification only. No production behavior, schema, or historical data changed.

## 1. Scope and evidence boundary

This audit traced the mounted supplier-return routes, Admin caller, approval executor, supplier-return posting service, supplier-credit application service, relevant records, tests, and current report readers. It did not connect to any database, inspect persisted return records, or obtain supplier, bank, physical-stock, or tax evidence.

Statuses below describe code evidence, not proof that persisted records are complete or correct:

- `VERIFIED_IN_CODE`: an active route/service explicitly performs the stated internal action.
- `PARTIAL`: a partial internal relationship exists, but required source evidence or lifecycle controls are missing.
- `MISSING`: no production relationship or control was found in the traced path.
- `LEGACY_OR_UNMOUNTED`: a similarly named model/helper is not evidence of an active production route.
- `NOT_VERIFIABLE_WITHOUT_DATABASE`: persisted occurrence, balances, or historical data cannot be established from static inspection.

## 2. Mounted route and caller register

`backend/server.js` mounts `returnsRoute.js` at `/api/returns`.

| Route | Caller / gate | Production behavior and classification |
|---|---|---|
| `POST /api/returns/supplier/create` | Admin Returns Management; `authenticate` + `returns:supplier_create` | Submits `SUPPLIER_RETURN_CREATE` to `requestAccountingActionApproval`. The request is pending until a separate accounting-action reviewer approves it. `VERIFIED_IN_CODE`. |
| `POST /api/accounting/approval-requests/review` | Accounting approval screen; `authenticate` + `accounting:approval_review` | Approval execution calls `createSupplierReturn` with the approval ID as its idempotency key and the reviewer as actor. This is the posting gate for creation, not supplier acceptance. `VERIFIED_IN_CODE`. |
| `GET /api/returns/supplier/list` | Admin Returns Management; `authenticate` + `returns:supplier_read` | Reads `SupplierReturn` rows and presents their internal status and links. `VERIFIED_IN_CODE`. |
| `GET /api/returns/supplier/reconciliation` | Admin; `requireAdminRole` + `finance:payables_read` | Read-only matching of return records to internal credit document, journal, cash transaction, and legacy receivable evidence. It does not inspect inventory movement/cost layers or external supplier/bank evidence. `PARTIAL`. |
| `GET /api/returns/supplier/:id/applicable-bills` | Admin; `requireAdminRole` + `finance:payable_settle` | Selects open same-vendor, same-currency bills issued on or after the return date. `VERIFIED_IN_CODE` for this constrained application policy. |
| `POST /api/returns/supplier/:id/apply-credit` | Admin; `requireAdminRole` + `finance:payable_settle` | Directly applies a credit in `applySupplierReturnCreditToBill`; this route does not submit an accounting approval request. `VERIFIED_IN_CODE`. |

`admin/src/pages/ReturnsManagement.jsx` is the supplier-return creator and credit-application caller. The UI says a credit application is “submitted for independent Admin approval,” but the mounted controller calls the application service synchronously and returns its result. That is a disclosure mismatch. Creation approval and credit application are distinct paths: creation is maker-checker gated; application is permission-gated but has no second reviewer in the traced route.

## 3. Supplier-return request, posting, and stock evidence

The request normalizer requires a registered active vendor, a matching supplier display name, at least one product, positive whole-unit quantities, and a submitted unit-cost string. It parses monetary values through the NPR Decimal helpers. VAT reversal is capped at the submitted return total and requires an invoice-number string. Settlement is either `CREDIT_NOTE_OFFSET_PAYABLE` or `CASH_REFUND`.

`shipmentBatchId` is optional. When supplied, `createSupplierReturn` checks that the referenced `InboundShipment` has a matching supplier name and, when provided, matching invoice number. It does not match product lines, accepted quantities, unit costs, receipt state, or an original supplier bill. The legacy shipment relationship is therefore not a verified receipt-to-return link.

The approval executor creates the `SupplierReturn` only after approval and stores it as `COMPLETED` immediately. In the same serializable transaction, `supplierReturnService.js`:

1. Checks the requested quantity against current aggregate `Product.stockQuantity`.
2. Conditionally decrements that aggregate quantity and writes a legacy `StockLog`.
3. Posts a balanced `SUPPLIER_RETURN` journal.
4. Creates a payable credit document or increments the selected Treasury balance and creates a cash inflow record.
5. Links those internal records to the return and writes the audit event.

The stock update is guarded against stale quantities and insufficient aggregate stock. The transaction and request-key/payload-hash handling protect one request from partial writes and exact replay. They do not prove the decremented units came from this supplier, an accepted purchase, a specific invoice, or a particular inventory lot. Different request keys can represent duplicate returns against the same unlinked source while aggregate stock remains available.

No canonical `InventoryLedgerEntry` or `InventoryBalance` movement, inventory location/SKU, production cost-layer consumption, or original procurement allocation is created. The return items are JSON snapshots of product, name, quantity, submitted `unitCostPrice`, and extended amount. `SupplierReturn` has optional shipment/invoice identifiers but no direct purchase-bill or accepted receipt-line relation. Code cannot establish that the business owns the stock or is entitled to return it.

The schema allows `PENDING`, `COMPLETED`, and `CANCELLED`, but the active posting path writes `COMPLETED`; no mounted supplier-return cancellation, rejection-after-posting, stock-restoration, or journal-reversal route was found. A rejected approval does not create the return, but there is no discovered correction path for a posted return.

## 4. Supplier credit, AP, and Treasury evidence chain

### Credit-note offset path

On internal Admin approval, the service:

- Debits mapped AP control (`AP_CONTROL`, code 2110) by the full submitted return amount.
- Credits mapped inventory by return amount less entered VAT reversal.
- Credits input VAT by the entered VAT reversal, when positive.
- Creates an internal `AccountingDocument` of type `CREDIT_NOTE`, side `PAYABLE`, linked to the supplier return and vendor.

This proves an internal journal/document pair was recorded in the same transaction. It does **not** prove that the supplier accepted the physical return or issued/confirmed a credit note. The Admin form’s “Supplier Invoice Unit Cost” is a user-entered snapshot; an invoice number alone is not validated invoice or receipt evidence. The journal reduces AP at return approval without linking the reduction to the original bill. No supplier-side credit confirmation or return-handoff evidence is required by this path.

`applySupplierReturnCreditToBill` validates the return, internal credit document, and posted AP reversal journal, then applies a positive Decimal amount bounded by both remaining balances. It permits only a same-vendor, same-currency open bill issued on or after the return date. It updates credit and bill document balances/status, updates a linked legacy `AccountPayable` only for an `OPERATING_EXPENSE` bill after verifying the balances match, creates paired `OFFSET` allocations linked to the original return journal, and writes an audit event. It does not post another journal. The application is serialized, uses compare-and-set updates, and is idempotent by key; changed-payload reuse fails. This application does not associate the return credit with a pre-return supplier bill, and no application reversal was found.

### Cash-refund path

On internal approval, the service debits the selected mapped Treasury GL account, increments its internal `FinancialAccount.currentBalance`, and records a `CashTransaction` inflow. These writes are atomic with the return and journal. No bank statement, supplier remittance, deposit receipt, or independent verification is required. The internal inflow is not proof cash was actually received from the supplier.

### Reversals, approvals, and duplicates

- Return creation has a stable approval/request identity, payload-hash replay protection, transaction rollback, and serializable retry handling in code.
- Credit application has its own idempotency key, payload ownership check, serializable updates, paired allocation records, and audit event.
- Neither mechanism prevents economically duplicative returns submitted under distinct request keys because there is no original accepted receipt quantity or returnable-lot allocation.
- Supplier credit application itself is not maker-checker gated in its mounted route, despite the Admin toast text.
- No supplier-return cancellation, credit-application reversal, or posted return correction path was found. Persisted duplication or incidence is `NOT_VERIFIABLE_WITHOUT_DATABASE`.

## 5. Acquisition-cost classification

| Evidence | Classification | Reason |
|---|---|---|
| Submitted return `unitCostPrice` and extended amount | `UNRECONCILED` | Operator-supplied snapshot stored in JSON; not checked against an invoice line, accepted receipt, prior bill, or inventory layer. It drives the inventory credit and the return/credit amount. |
| Supplier invoice unit price | `MISSING` in this return path | Invoice number is an optional reference except for VAT reversal; no invoice document or source line is loaded and matched. |
| Accepted received quantity/cost | `MISSING` | No supplier goods-receipt or returnable quantity relationship is checked. |
| Product catalog `costPrice` | `REFERENCE_OR_CATALOG_COST` generally; not used as supplier-return source in this service | It cannot substitute for historic supplier cost or a cost layer. |
| Production cost layers | `MISSING` relationship for this path | No layer is referenced, consumed, or restored by supplier-return posting. |
| Freight, discounts, customs, other landed costs | `MISSING` | No allocation or return adjustment for these costs is present in the traced workflow. |
| VAT reversal amount | `UNRECONCILED` | The amount is user-entered, non-negative, and capped at the return total; only a reference string is required. No supplier/tax invoice authentication or prior input-VAT posting match is established here. |

The posted inventory credit is an accounting amount derived from the submitted snapshot, not evidence that the physical stock reduction is cost-layer accurate. No system-wide acquisition-cost method or historical supplier-cost lineage is inferred.

## 6. Return, credit, report, and evidence classification

| Relationship | Status | Finding |
|---|---|---|
| Active supplier-return create and independent Admin approval | `VERIFIED_IN_CODE` | Mounted create route queues an accounting action; reviewer execution performs posting. |
| Supplier identity | `PARTIAL` | Active vendor identity/name is checked; the return does not retain a direct supplier party ID, and no external supplier confirmation is recorded. |
| Original purchase/bill to returned goods | `MISSING` | No required original bill or bill-line relation. |
| Shipment to returned goods | `PARTIAL` | Optional legacy shipment checks supplier/invoice text only; not received items, accepted quantity, or cost. |
| Returned stock movement | `PARTIAL` | Aggregate Product quantity and StockLog update; no canonical SKU/location ledger movement or source-lot evidence. |
| Ownership/return eligibility | `NOT_VERIFIABLE_WITHOUT_DATABASE` | Current on-hand aggregate quantity is not evidence of ownership or source supplier. External physical/title evidence was not accessed. |
| Return cost to invoice/receipt/cost layer | `MISSING` | Submitted snapshot only. |
| Internal AP credit/document/journal consistency | `VERIFIED_IN_CODE` for newly posted path | Internal document and journal are transactionally linked and source-checked by credit application. This is not supplier-confirmed credit. |
| Supplier-approved credit note | `MISSING` | No supplier-issued credit-note evidence or confirmation is required or linked. |
| Cash refund receipt | `PARTIAL` | Internal Treasury balance, cash transaction, and journal are recorded; independent bank receipt is absent. |
| Credit application to a later bill | `VERIFIED_IN_CODE` | Decimal-bounded and source-linked internal allocation; not maker-checker gated in this route and no reversal path found. |
| Return-specific reconciliation report | `PARTIAL` | Matches internal return, journal, credit document, cash transaction, and legacy receivable sources. Does not verify original receipt, stock log/ledger, cost layer, credit application allocation, supplier acceptance, or bank receipt. `RECONCILED_SUPPLIER_CREDIT` means internal source matching only. |
| Supplier-wide AP/GL reconciliation | `MISSING` | Return-specific report is not a complete supplier subledger/2110 reconciliation. |
| Persisted balances, history, and incidence | `NOT_VERIFIABLE_WITHOUT_DATABASE` | No database was accessed. |
| External supplier, bank, physical, and tax evidence | `NOT_VERIFIABLE_WITHOUT_DATABASE` | No independent evidence was accessed. |

## 7. Report-basis findings

- Admin Returns Management lists internal `SupplierReturn` records, summarizes their recorded debit amounts, and displays internal journal/document/cash IDs and return status. It is an operational return register, not a received-stock or supplier-accepted-return report.
- The modal labels the supplied value “Supplier Invoice Unit Cost,” but the server does not validate it against an invoice line. The report amount is therefore an unreconciled submitted snapshot, not authoritative acquired cost.
- The header text “Stock & Ledger Synchronized” overstates the traced supplier-return path: it changes `Product.stockQuantity` and `StockLog`, not the canonical inventory ledger/cost layer.
- Supplier-return reconciliation evaluates internal source-count, amount, and journal/document/cash matches. A `RECONCILED_*` status is not evidence of external credit acceptance, actual cash receipt, original stock eligibility, or supplier-wide AP/GL reconciliation.
- The credit-application UI says independent approval is pending, while its route directly performs the application. This status text is not the transaction lifecycle.
- No supplier return aging or independently sourced supplier credit report was found in Admin, Manufacturer, or Distributor portals. The existing credit-document readers are internal accounting subledger readers; report completeness and persisted balances remain unverified.

## 8. Risk ranking and recommended next boundary

1. **Highest — unlinked stock and submitted-cost claim posts AP/Treasury effects immediately.** Approval can decrease aggregate stock and post an AP reduction or Treasury inflow without an original accepted receipt, bill line, return handoff, supplier credit acceptance, or bank receipt. This can misstate inventory and AP/cash, and cannot be traced to a defensible acquisition cost. Relevant path: `returnsController.createSupplierReturn` → accounting-action approval executor → `supplierReturnService.createSupplierReturn`.
2. **High — no post-posting correction/reversal lifecycle.** A wrong or disputed return can leave Product quantity, StockLog, journal, document/Treasury, and any later credit allocations inconsistent. No supplier-return cancellation or credit-application reversal was found.
3. **High — distinct request keys can duplicate source claims.** Per-request replay protection and stock availability checks do not cap returns to a particular received quantity or cost layer.
4. **High — internal confirmation is easy to overread.** Internal debit-note documents and cash inflows do not establish supplier acceptance or external funds. The return-specific reconciliation report does not include physical/cost evidence.
5. **Medium — credit application lacks second reviewer and reversal.** The direct route is permission-protected and audited/idempotent but contradicts the UI's independent-approval message.

**Recommendation:** Keep this increment audit-only. Do not patch AP or stock amounts without source evidence. Before a separately approved implementation, establish policy and evidence requirements for: a specific supplier bill/invoice line; accepted receipt item, quantity, location, and cost layer; eligible return quantity and ownership; physical handoff and supplier acceptance; the point at which a supplier credit is confirmed; independent cash-refund receipt evidence; treatment of VAT/landed costs; and cancellation/correction/reversal rules. Then design a source-linked, idempotent transition that moves only accepted quantities and cost, records supplier credit/refund evidence, posts the agreed accounting effect atomically, and preserves maker-checker/audit history. Do not introduce the missing procurement/receiving workflow as an assumed part of this audit.

## 9. Validation and limitations

Static inspection covered `backend/server.js`, `backend/routes/returnsRoute.js`, `backend/controllers/returnsController.js`, `backend/services/accountingActionApprovalService.js`, `backend/services/supplierReturnService.js`, `backend/services/supplierReturnCreditApplicationService.js`, the relevant Prisma models, `admin/src/pages/ReturnsManagement.jsx`, and existing supplier-return unit/integration tests. `node --test tests/supplierReturnService.test.js tests/supplierReturnCreditApplication.test.js` passed **11 tests, 0 failed, 0 skipped**. These unit tests exercise service-level replay, changed payload, transaction-failure mocks, stock checks, mapped Treasury, credit bounds, and internal reconciliation. They do not establish actual database rollback/isolation, persisted balances, route authorization, production concurrency, inventory-lot correctness, external supplier acceptance, or bank receipt.

No database, external payment provider, supplier, bank, or tax-authority system was accessed. Database integration tests were not run. No implementation, schema, migration, inventory-costing, AP, Treasury, or report-calculation change was made.

## 10. Required future validation

After policy and source linkage are approved, use a separately verified isolated database with representative synthetic and migrated cases to validate complete/partial returns, duplicate submissions under different keys, concurrent stock claims, application/reversal, journal and audit rollback, and supplier/bill/stock/cost-layer balances. Independently match supplier invoices, accepted receipt records, supplier return authorizations/credit notes, and bank refund evidence. Separately establish physical quantity and ownership. Do not use production or `localhost:3306/clothing`; do not claim persisted reconciliation or external confirmation from mocked tests or this static audit.

## 11. Status

- **P5-R10:** Complete for static evidence audit and remediation proposal only.
- **Phase 5:** Partial / incomplete.
- **R8 semantic monetary-field register:** Partial.
- **P4.2:** Incomplete.
- **P4.3:** In progress / incomplete.
- **Phase 4:** Incomplete.
- No Phase 6 or Phase 7 work was started.
