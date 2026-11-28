# P5-R4 — Direct-Order Receipt and Reversal Regression Coverage

**Review date:** 2026-11-17  
**Status:** **COMPLETE FOR THE MOCKED REGRESSION SCOPE ONLY**  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.

## 1. Scope and safety

P5-R4 adds regression tests for existing `DIRECT_ORDER_RECEIVABLE` invoices using the existing generic customer receipt and full-reversal services. It changes no production code, order behavior, payment synchronization, receipt rules, remittance routes, or schema.

No P5-R3 document file existed when this work began; its read-only audit was delivered in the preceding conversation. The route and service findings below were rechecked against current code. This document records those findings alongside the R4 tests and does not modify the P5-R2 evidence-chain document.

No database, MySQL endpoint, migration, seed, provider, bank, or production system was accessed. The tests use in-memory service fixtures and mocked posting/audit callbacks. They do not establish persisted behavior, transaction rollback, concurrency, or independent cash receipt.

## 2. Production-path evidence

| Path | Current code evidence | Status |
|---|---|---|
| Admin direct-order creation | Mounted `POST /api/order/admin-create` calls `adminCreateOrder`; the Admin Create Order page calls that route. Paid declarations are rejected by the controller and again by `createAdminDirectOrderWithStock`. | Route and fail-closed behavior **VERIFIED_IN_CODE**. |
| Distributor direct-order creation/status | Mounted `POST /api/distributor/orders/direct` and `PATCH /api/distributor/orders/direct/status` call the distributor direct-order controller. The Distributor workspace Direct Orders page calls these routes. Paid declarations/payment mutations are rejected. | Route and fail-closed behavior **VERIFIED_IN_CODE**. |
| Manufacturer direct-order controller | `manufacturerDirectOrderRoute.js` defines handlers, but the router is not imported or mounted by `server.js`; no portal caller was found. Controller-level tests do not establish a production route. | **LEGACY_OR_UNMOUNTED**. |
| Delivered direct-order receivable | `postDeliveredOrderAccounting` uses the accepted order-pricing snapshot when present (legacy `Order.amount` fallback remains), posts the delivered-sale journal, and creates a customer `DIRECT_ORDER_RECEIVABLE` invoice linked to the source order. The Admin receivables reader queries customer invoices without filtering out this `sourceType`. | Posting and reader linkage **VERIFIED_IN_CODE**; persisted invoice/journal linkage **NOT_VERIFIABLE_WITHOUT_DATABASE**. |
| Generic receipt | Mounted `POST /api/finance/collect-receivable` calls `recordCustomerReceipt`. Eligibility requires an open customer invoice/debit note in NPR; the service does not restrict invoice `sourceType`, so eligible `DIRECT_ORDER_RECEIVABLE` documents can use this path. It writes the `CashTransaction`, mapped Treasury movement, customer-payment journal, invoice allocations, and `CUSTOMER_RECEIPT_RECORDED` audit event in its transaction. A single-invoice receipt references the invoice's `sourceId` (the order ID). | Generic source-linked receipt path **VERIFIED_IN_CODE**; direct-order behavior is now **MOCKED_TESTED**. |
| Generic reversal | Receipt reversals use the approved correction workflow and `reverseCustomerReceipt`. The service supports full reversal, restores invoice allocations/balances, reduces Treasury, reverses the customer-payment journal, records reversal/audit evidence, and rejects duplicate reversal. | Reversal logic **VERIFIED_IN_CODE**; direct-order reversal is now **MOCKED_TESTED**. |

The generic receipt service updates the accounting invoice and its allocations, but does not update `Order.payment`. This behavior is intentionally unchanged.

## 3. Regression coverage added

Updated `backend/tests/customerReceiptService.test.js` only:

1. **Admin direct-order invoice — full receipt:** verifies the `DIRECT_ORDER_RECEIVABLE` source/order reference, customer party, invoice number, Treasury destination, payment journal, allocation, and actor/source-linked audit event.
2. **Admin direct-order invoice — replay:** verifies an exact replay creates no second receipt, allocation, Treasury effect, journal, or audit event; changed-payload reuse conflicts.
3. **Distributor direct-order invoice — partial receipt:** verifies receipt/customer/order linkage, journal and allocation, and the remaining invoice balance.
4. **Distributor direct-order invoice — invalid states:** verifies overpayment is rejected without new effects and a settled invoice is rejected with the existing `RECEIVABLE_INVOICE_CLOSED` result.
5. **Direct-order invoice reversal:** verifies full allocation/balance restoration and Treasury/journal/reversal/audit effects; a repeated reversal creates no duplicate effects.

Existing tests in the same suite continue to cover generic invalid amounts, allocation integrity, missing journal, audit-write failure, allocation rounding, replay conflict, and reversal rejection. Existing `accountingOperationalPosters.test.js` cases cover creation of direct-order receivable invoices for unpaid direct manufacturer, distributor, and non-COD Admin sales. All of these tests are mocked/in-memory; no persisted path is claimed.

## 4. Order payment-status readers and consistency question

No payment-status behavior was changed.

- Admin Orders cards/details display the serialized order `payment` boolean. Some false-state labels say “Pending (COD)” or “COD - Pending” regardless of tender method.
- Distributor Direct Orders displays “Paid”/“Pending” from `o.payment` and calculates its `totalRevenue` using only orders with `payment === true`.
- Admin Payables & Receivables instead displays `AccountingDocument` status and cash allocation history. A receipt can therefore make a direct-order invoice fully or partially settled while order-facing screens still display `payment: false`.
- The order API serialization and direct-order UI use the boolean order field; the receivable reader uses invoice balances/allocations. They are distinct projections, not a reconciled status.

Future payment-status work needs a business decision on whether `Order.payment` is authoritative or only a compatibility projection of invoice settlement. If projected, define the rules for partial receipts, multiple invoices, discounts/fines, refunds, receipt reversal, and cancelled/returned orders before implementation. Do not infer cash collection from delivery or from the `payment` flag.

## 5. Distributor-remittance boundary

No remittance code was changed. The standalone `submitDistributorRemittance` helper still has no confirmed production submission route/caller. The mounted Admin review route does not make that helper a complete active submission workflow.

The separate mounted `COMPANY_COLLECTS` settlement-request lifecycle remains unchanged: Admin creates the request, Distributor submits evidence, and Admin verifies the actual received amount before posting. It has different entities, statuses, source caps, and amount-validation behavior. The open decision remains whether the standalone helper is obsolete or should eventually become the canonical submission flow. No second route was added and the models were not merged.

Neither workflow provides independent bank-statement or physical-cash verification. User-supplied references, uploaded evidence, Admin review, and internal ledger links do not establish that funds reached the bank.

## 6. Validation

Final focused command from `backend/`:

```text
node --test tests\customerReceiptService.test.js tests\customerReceiptRoute.test.js tests\directOrderReceiptPolicy.test.js tests\adminDirectOrderService.test.js tests\accountingOperationalPosters.test.js tests\accountingOutbox.test.js
```

Result: **118 passed, 0 failed, 0 skipped**. All selected suites use mocked route/service clients or in-memory fixtures; none uses persisted database state. The Accounting Operational Posters and Accounting Outbox suites emitted expected error logs from rejection/retry tests; these were not test failures.

- `node --check tests\customerReceiptService.test.js`: passed.
- `git diff --check`: passed.
- No lint or portal build was run; this increment changes only backend tests and accounting documentation, and no backend lint script is defined.

## 7. Remaining gaps and status

- Direct-order receipt and reversal paths have mocked regression coverage, but no database-backed transaction, rollback, persistence, or concurrency validation.
- `Order.payment` may disagree with invoice settlement; synchronization remains a policy decision and was not changed.
- The standalone distributor remittance lifecycle decision remains open; active company-collection settlement remains separate.
- Independent cash/bank evidence and statement matching remain missing.
- R8 remains **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **IN PROGRESS, INCOMPLETE**.

**P5-R4:** complete for the mocked regression scope only. **Phase 5:** **PARTIAL / INCOMPLETE**. No Phase 6 or Phase 7 work was started.
