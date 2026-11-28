# P5-R11 — Supplier Returns, Credit Application, Refunds, and Reversal Lifecycle

**Status:** Static audit and design review only. No production behavior, schema, or historical-data change was made.

## 1. Executive summary

P5-R10 concluded that the current supplier-return flow posts internal AP or Treasury effects from submitted unit-cost snapshots without a required original supplier receipt, original supplier bill, accepted quantity, accepted unit cost, or supplier acceptance evidence. P5-R11 confirms those findings and adds a route-level discrepancy: the mounted supplier credit-application route is permission-gated and direct, while the UI claims an independent Admin approval path that does not exist in the traced production code.

The repository does not establish a safe, source-linked return/reversal lifecycle that can be treated as authoritative supplier-accepted stock or supplier-repaid funds. The path is therefore audit-only unless a later, bounded implementation establishes the following before any production change:

- original purchase or accepted receipt linkage to the returned stock;
- accepted quantity, cost, and location ownership;
- supplier acceptance or confirmed supplier credit note;
- actual receipt of refund cash or bank confirmation;
- a source-specific reversal path that restores stock, AP, Treasury, journal, and audit history atomically;
- clear maker/checker separation for credit application and any refund settlement approval.

At present, the repository supports only an internal return request, internal AP/Treasury posting, and internal settlement application. These internal records are not independent evidence of external supplier acceptance or actual payment.

## 2. Actual mounted route and service map

### Routes and callers

| Route | Mounted production path | Actual behavior |
|---|---|---|
| `POST /api/returns/supplier/create` | `returnsRoute.js` → `returnsController.createSupplierReturn` → `requestAccountingActionApproval` | Creates a pending approval request; the actual posting occurs only after independent review. `VERIFIED_IN_CODE`. |
| `POST /api/accounting/approval-requests/review` | `accountingRoute.js` → `reviewAccountingActionApprovalController` → `reviewAccountingActionApproval` | Reviewer executes the approval and invokes `createSupplierReturn` from `supplierReturnService.js`. `VERIFIED_IN_CODE`. |
| `GET /api/returns/supplier/list` | `returnsRoute.js` → `getSupplierReturns` | Lists `SupplierReturn` rows and their stored links. `VERIFIED_IN_CODE`. |
| `GET /api/returns/supplier/reconciliation` | `returnsRoute.js` → `getSupplierReturnReconciliation` | Reads `SupplierReturn`, accounting document, journal, cash, and legacy receivable sources. `PARTIAL`. |
| `GET /api/returns/supplier/:id/applicable-bills` | `returnsRoute.js` → `getSupplierReturnApplicableBills` | Validates a completed return credit and returns open same-vendor same-currency bills. `VERIFIED_IN_CODE`. |
| `POST /api/returns/supplier/:id/apply-credit` | `returnsRoute.js` → `applySupplierReturnCredit` → `applySupplierReturnCreditToBill` | Applies a credit directly to a bill with idempotency and allocation updates. No second approval route was found in the mounted path. `VERIFIED_IN_CODE`. |

### Service logic

`backend/services/supplierReturnService.js` is the authoritative posted-return writer in the mounted path. The service:

1. normalizes the request and enforces a stable request key + payload hash;
2. validates the selected vendor and supplier name match;
3. optionally validates an inbound-shipment reference by supplier name and invoice string only;
4. validates aggregate `Product.stockQuantity` against item quantities;
5. decrements `Product.stockQuantity` using a conditional update;
6. writes a `StockLog` event;
7. creates a posted `SUPPLIER_RETURN` journal;
8. creates either a payable credit document or a Treasury cash inflow record;
9. stores the internal source IDs on the `SupplierReturn` row;
10. writes a system audit record.

This is the authoritative internal production path for return posting. It is not a supplier-acceptance or return-validation workflow.

## 3. Supplier return lifecycle

### 3.1 Request creation

The supplier-return request is created from admin UI form data in `admin/src/pages/ReturnsManagement.jsx`. It includes:

- a selected supplier party;
- supplier display name and stable reference;
- an invoice number, optional but required for VAT reversal;
- return items with product IDs, name, quantity, and submitted unit-cost snapshot;
- settlement type (`CREDIT_NOTE_OFFSET_PAYABLE` or `CASH_REFUND`);
- optional `shipmentBatchId` and reason/notes.

The request is not required to include an original supplier bill, accepted receipt line, accepted quantity, or cost-layer reference.

### 3.2 Approval and posting

The route is approval-gated at creation, but the approval executor executes the production logic in `accountingActionApprovalService.js` by calling `createSupplierReturn` with the approval ID as the request key. The created `SupplierReturn` is set to `status: COMPLETED` immediately after approval.

This means the return is treated as a completed event once approved, even though no supplier acceptance evidence is required. The approval is therefore an internal control on request submission, not proof of external acceptance.

### 3.3 Inventory effect

The return decrements aggregate `Product.stockQuantity` and creates `StockLog` entries. There is no canonical `InventoryLedgerEntry` movement, no inventory location/SKU reconciliation, and no cost-layer consumption or restoration.

The code does not validate:

- original receipt quantity;
- accepted returnable quantity;
- original accepted unit cost;
- location ownership;
- actual supplier return authorization;
- disposal or return destination.

This is the highest-risk issue: it can reduce stock without a corresponding, source-linked accepted return inventory event.

### 3.4 AP and Treasury effects

The journal posted by the return service uses a standard internal pattern:

- debit `AP_CONTROL` for `CREDIT_NOTE_OFFSET_PAYABLE` settlement;
- credit inventory by return amount less VAT reversal;
- credit input VAT when input-VAT reversal is provided;
- debit the selected Treasury account for `CASH_REFUND` settlement.

For a credit-note path, it creates an `AccountingDocument` of type `CREDIT_NOTE` and side `PAYABLE`. For a cash-refund path, it increments the Treasury balance and creates a `CashTransaction` inflow.

These are internal accounting records, not proof that:

- the supplier confirmed the return;
- the supplier agreed to a credit;
- the supplier actually refunded cash;
- the bank actually received money.

## 4. Supplier credit-note lifecycle

### 4.1 Internal credit-note creation

`createSupplierReturn` generates an internal payable-side credit document when `settlementType === "CREDIT_NOTE_OFFSET_PAYABLE"`.

The document is linked to:

- the `SupplierReturn` row;
- the supplier party;
- the return journal entry.

The amount is the submitted return amount and is not required to match an original accepted receipt or bill.

### 4.2 Credit application path

`applySupplierReturnCreditToBill` accepts a supplier-return ID, bill document ID, amount, and idempotency key. It validates:

- a completed return exists;
- the credit document belongs to that return and same supplier;
- target bill is same vendor and same currency;
- target bill is open or partially paid;
- bill issue date is on or after return date;
- application amount does not exceed remaining credit or bill balance;
- cost and journal relationship remain internally consistent.

The method then:

- updates credit document allocated/remaining amounts and status;
- updates bill allocated/remaining amounts and status;
- optionally updates legacy `AccountPayable` where the bill is linked to an operating expense;
- creates `OFFSET` allocations against the journal;
- writes an audit record.

This is an internal application path, not a supplier-accepted credit issuance path.

### 4.3 Approval discrepancy

The UI in `admin/src/pages/ReturnsManagement.jsx` says that applying the credit is “submitted for independent Admin approval.” The mounted route in `returnsRoute.js` calls `applySupplierReturnCreditToBill` directly and returns its result without a second approval request.

Therefore the production behavior is:

- creation of a return is approval-gated;
- application of a return credit is direct, permission-gated, and idempotent.

The UI message is misleading. There is no traced independent review gate for credit application in the production route.

## 5. Supplier refund and Treasury lifecycle

The return service creates a `CashTransaction` inflow when `settlementType === "CASH_REFUND"`. It also increments the selected Treasury account’s `currentBalance` and debits the Treasury GL account in the journal.

This records an internal Treasury inflow, but it does not prove:

- the supplier actually remitted funds;
- the bank actually received the payment;
- the refund was supported by a supplier-authorized credit or refund instruction;
- the refund was received in the correct account or for the correct party.

The repo uses the internal Treasury amount as an internal ledger record only, not as external receipt evidence. This is consistent with the earlier P5-R8/P5-R10 findings.

## 6. Evidence classifications

These are repository-grounded classifications for current production behavior, not legal or external evidence grades.

| Evidence state | Current status |
|---|---|
| `INTERNAL_RETURN_REQUEST` | `VERIFIED_IN_CODE` |
| `INTERNAL_RETURN_APPROVAL` | `VERIFIED_IN_CODE` |
| `VERIFIED_INVENTORY_MOVEMENT` | `MISSING` |
| `ORIGINAL_RECEIPT_LINKED` | `MISSING` |
| `ORIGINAL_SUPPLIER_BILL_LINKED` | `MISSING` |
| `SUPPLIER_ACCEPTANCE_UNVERIFIED` | `VERIFIED_IN_CODE` |
| `SUPPLIER_ACCEPTANCE_CONFIRMED` | `MISSING` |
| `INTERNAL_CREDIT_NOTE` | `VERIFIED_IN_CODE` |
| `SUPPLIER_CREDIT_NOTE_EVIDENCED` | `MISSING` |
| `CREDIT_APPLICATION_PENDING_APPROVAL` | `MISSING` in mounted code |
| `CREDIT_APPLICATION_APPROVED` | `PARTIAL` / route not mounted as approval-gated |
| `SUPPLIER_REFUND_EXPECTED` | `VERIFIED_IN_CODE` |
| `SUPPLIER_REFUND_CONFIRMED` | `MISSING` |
| `TREASURY_RECEIPT_RECORDED` | `VERIFIED_IN_CODE` |
| `TREASURY_RECEIPT_EVIDENCED` | `MISSING` |
| `UNRECONCILED` | `VERIFIED_IN_CODE` for return cost and return evidence chain |
| `REVERSAL_REQUIRED` | `VERIFIED_IN_CODE` need remains unresolved |
| `REVERSAL_COMPLETED` | `MISSING` |

## 7. Inventory valuation and source-linkage findings

The return service uses submitted `unitCostPrice` values to compute the return total. This is a user-entered or UI-supplied snapshot, not a validated original accepted receipt or bill-line unit cost.

The current return path therefore does not establish:

- accepted quantity or accepted unit cost from source receipt;
- cost-layer provenance;
- original supplier invoice line linkage;
- location-specific ownership or stock title;
- the difference between goods returned and goods accepted.

`Product.costPrice` was not found as a source-of-truth for supplier-return cost in the mounted return path, and the canonical inventory ledger is not updated for this flow. The return therefore remains an internal accounting reduction rather than a verified inventory-return transaction with source-linked cost.

## 8. Reversal and correction coverage

The repository does not provide a safe, source-specific reversal path for the supplier-return lifecycle. The following are not present in the traced production code:

- return cancellation after approval;
- post-approval return reversal that restores stock and AP/Treasury entries;
- credit-application reversal that restores bill balances and allocations;
- refund reversal after Treasury inflow;
- physical-return confirmation workflow and retraction path;
- supplier-accepted reversal or credit-note cancellation workflow.

This is a material control gap. Any implementation that attempts to reverse a return must restore not only the stock and accounting journal but also the original bill/credit application state and audit history while preserving actor attribution and preventing replay/duplicate reversals.

Because the repository lacks those source links, a generic reversal implementation would be unsafe and would likely create false reversals or hidden balance drift. P5-R11 therefore keeps the boundary at audit/design only unless a later, separate and source-linked policy is approved.

## 9. Risks and unresolved policy decisions

The following unresolved issues remain open and must be resolved before a safe implementation is attempted:

1. There is no original accepted receipt or supplier bill link in the return creation path.
2. There is no validated stock-location/ownership check on the return.
3. There is no supplier acceptance or supplier-issued credit-note evidence requirement.
4. There is no refund confirmation path for actual bank or Treasury receipt evidence.
5. The credit-application UI message is inaccurate and misleading relative to the mounted route.
6. The return path can operate on aggregate stock without any cost-layer or invoice-line provenance.
7. The return and credit paths lack a source-specific reversal and correction design.
8. There is no clear maker/checker boundary for the actual credit application route.

## 10. Safe implementation boundary

No production code change is justified at this point.

A safe implementation would require, at minimum:

- a proven source receipt or supplier bill link for the returned quantity;
- a quantity/stock ownership check using canonical inventory movement and location records;
- a validated return-eligibility rule;
- supplier-accepted credit-note evidence or confirmed refund evidence;
- a separate approval path for credit application before balance mutation;
- a reversal path that restores stock, AP, Treasury, journal, and audit history atomically;
- explicit idempotency and conflict handling for all replay/retry events.

No such architecture was found in the current repository trace.

## 11. Validation and evidence limitations

This audit used static inspection and the repository’s existing mocked, in-memory tests. No database connection, no production database, and no external supplier/bank evidence were accessed.

The relevant mocks and existing unit tests support the current internal ledger logic but do not establish persisted reconciliation, stock ownership, supplier acceptance, or external refund receipt. The repository therefore remains unable to claim the return lifecycle is complete or externally verified.

## 12. Recommended next increment

Recommended next increment: a source-linked return and credit evidence design phase, not a production code change. That next increment should establish the exact accepted-receipt, bill-line, and stock-ownership rules before altering the return or credit lifecycle. Only after those rules exist should a narrow implementation be approved that restores stock, AP, and Treasury entries atomically with a true source-specific reversal path.

## 13. Final status

- **P5-R11:** Audit and design review complete; no production behavior modified.
- **Phase 5:** Partial / incomplete.
- **R8:** Partial.
- **P4.2:** Incomplete.
- **P4.3:** In progress / incomplete.
- **Phase 4:** Incomplete.

No Phase 6 or Phase 7 work was started.
