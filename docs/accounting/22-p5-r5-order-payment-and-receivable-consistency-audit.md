# P5-R5 — Order Payment and Receivable Consistency Audit

**Review date:** 2026-11-17  
**Status:** **COMPLETE FOR STATIC CODE INSPECTION ONLY**  
**Phase status:** Phase 5 remains **PARTIAL / INCOMPLETE**.

## 1. Scope and evidence boundary

This read-only audit traces order-level payment fields against customer receivable documents, receipts, distributor COD collection/remittance, NCM settlements, Treasury, journals, cancellations, returns, and the portal/API readers found in the repository. It confirms route mounts from `backend/server.js` and each router; an exported controller or isolated service test is not treated as a production route.

No application code, schema, tests, or business behavior were changed. No database or MySQL endpoint, migration, seed, provider, NCM service, bank, or production system was accessed. References to transactions describe code paths only; persisted rows, rollback, concurrency, and deployed schema remain **NOT_VERIFIABLE_WITHOUT_DATABASE**. Evidence references to supplied amounts, uploaded files, and internal ledger records do not establish independent cash receipt.

Status terms in this report:

- **VERIFIED_IN_CODE** — current source and mounted route/caller establish the described behavior; no persistence claim.
- **PARTIAL** — source behavior is only one leg of a broader lifecycle or route/caller evidence is incomplete.
- **NOT_VERIFIABLE_WITHOUT_DATABASE** — requires isolated database validation or actual source population.
- **INDEPENDENT_EVIDENCE_REQUIRED** — requires bank statement, cash count, provider statement, or equivalent evidence outside these application records.

## 2. Production paths confirmed

`backend/server.js` mounts the order, finance, distributor, and delivery routers. The following production paths are confirmed in the current repository:

| Purpose | Mounted path / portal caller | Result relevant to payment state |
|---|---|---|
| Storefront order creation and customer order list | `POST /api/order/place`; `POST /api/order/userorders`; Frontend Checkout and Orders | `placeOrder` stores `paymentMethod: "COD"` and `payment: false`. The serializer returns the order Boolean, not a linked invoice status. |
| Admin order creation and order readers | `POST /api/order/admin-create`; `POST /api/order/list`; `POST /api/order/admin-list`; Admin Orders | Direct-order creation rejects a paid declaration; its stored payment value is false. List responses serialize `Order.payment` and `paymentMethod`. |
| Distributor direct orders | `GET/POST /api/distributor/orders/direct`; `PATCH /api/distributor/orders/direct/status`; Manufacturer portal's `DirectOrders.jsx` | Creation rejects `isPaid: true` and stores `payment: false`; a HUB_VISIT order is immediately marked delivered and posted as a direct sale; status changes do not accept a paid-state mutation. |
| Distributor self-delivery and COD | `POST /api/distributor/orders/:id/delivery-otp`; `PATCH /api/distributor/orders/:id/status`; Manufacturer portal's Distributor Self-Delivery page | Delivery collection creates a `DistributorCashEvent`. With OTP verification the event is `VERIFIED` and the order is marked paid; with OTP disabled the event is `PENDING_VERIFICATION` and the order Boolean stays false. |
| Generic customer invoice receipt | `POST /api/finance/collect-receivable`; Admin Payables & Receivables | Calls `recordCustomerReceipt`; invoice eligibility is based on the accounting document and customer party, not the order Boolean or a source-type allowlist. |
| Customer receipt correction | `POST /api/finance/revert-settlement`; Admin Payables & Receivables | Submits an independently approved correction request. After approval, the settlement-correction executor calls `reverseCustomerReceipt` for a source-linked customer receipt. |
| NCM settlement | `POST /api/delivery/admin/settlements/confirm` and associated mounted delivery settlement routes | NCM expected/actual deposit and settlement records drive posting; no code path found here synchronizes `Order.payment`. |
| Distributor remittance review | `POST /api/admin/distributors/:id/finance/remittances/:batchId/review` | Admin review can post an eligible remittance batch to Treasury, journal, and distributor COD invoice allocations. The standalone submission helper has no confirmed production caller. |
| Distributor company-collection settlement request | Distributor evidence/acknowledgement routes and Admin settlement-request review route under `/api/admin/distributors/:id/finance/settlement-requests/...` | Separate net-settlement lifecycle; Admin supplies and verifies `actualReceivedAmount` before posting. The Manufacturer portal submits transfer evidence. |

Two code paths must not be mistaken for mounted production workflows:

- `manufacturerDirectOrderRoute.js` defines create/list/status routes, but `server.js` does not import or mount that router, and no active portal caller was found.
- `cashReceived` in `orderController.js` is exported and invokes `recordDeliveredOrderCashReceipt`, but `orderRoute.js` does not mount a route to it. The service is therefore **VERIFIED_IN_CODE**, but has no confirmed production route/caller in this repository. Do not infer use from its service tests.

## 3. Payment-state vocabulary and schema

| Record | Current fields/statuses | Meaning and limit |
|---|---|---|
| `Order` | `payment Boolean @default(false)`, `paymentMethod String`, `status`, `fulfillmentStatus`; no `isPaid` or `paymentStatus` column | `payment` is an order-level Boolean consumed by operational delivery and display code. `paymentMethod` is a tender/method label, not a settled-state ledger. There is no persisted `PARTIALLY_PAID` order state. |
| Direct-order request | Distributor/manufacturer controllers accept an `isPaid` declaration; Admin accepts `payment` | These are input fields, not `Order.isPaid`. Current guards reject a paid declaration for these direct-order create/status paths. |
| `AccountingDocument` | `sourceType`, `sourceId`, `side`, Decimal `originalAmount`, `allocatedAmount`, `remainingAmount`; `OPEN`, `PARTIALLY_PAID`, `PAID`, `CANCELLED` | Receivable status and outstanding customer debt are represented here. Direct-order customer invoices use `sourceType: DIRECT_ORDER_RECEIVABLE` and `sourceId: Order.id`; NCM and distributor COD are different party/source types. |
| `AccountingAllocation` | Decimal amount; `CASH`, `OFFSET`, `REVERSAL`; invoice, cash transaction, and journal references | Records invoice settlement allocation/correction links. The customer receipt reversal creates reversal allocations and restores invoice balances. |
| `CashTransaction` | `type` (`INFLOW`/`OUTFLOW`/`TRANSFER`), `category`, amount, settlement amount, Treasury account, reference, receipt and actor fields | Has no generic receipt `status` column. A customer receipt and a later reversal are distinct records; reversal is also represented by `SettlementReversion`. |
| `FinancialAccount` | Decimal `currentBalance`, currency, GL mapping, status | Internal Treasury balance projection. Its update is not an independent bank statement or cash count. |
| `DistributorCashEvent` | `PENDING_VERIFICATION`, `VERIFIED`, `POSTED`, `REJECTED`; event type, order, remittance, Treasury, journal and evidence references | Distinguishes declared/verified customer collection and remittance evidence/posting. It is not interchangeable with `Order.payment` or a company Treasury receipt. |
| `DistributorRemittanceBatch` | `PENDING_REVIEW`, `VERIFIED`, `REJECTED` | Standalone distributor remittance helper's submission/review record. |
| `DistributorSettlementRequestToken` | `REQUESTED`, `EVIDENCE_SUBMITTED`, `PAYMENT_SENT`, `ACKNOWLEDGED`, `POSTED`, `REJECTED` | Mounted company-collection request lifecycle, separate from a standalone remittance batch. |
| NCM settlement records | `DeliveryFinancialSettlement.settlementState`; `NcmSettlementBatch.status` includes settled, variance, and reversed states | Carrier COD expected/actual and net deposit settlement have their own state. They do not define the customer-facing order Boolean. |
| `JournalEntry` | `DRAFT`, `POSTED`, `REVERSED`, `VOID` | Posting/correction state for GL evidence. A posted or balanced journal alone does not establish cash receipt. |

## 4. Payment-state usage register

### 4.1 `Order.payment`, `paymentMethod`, and fulfillment

| File/function | Route or caller | Read/write | Effect and source of truth | Staleness/limit |
|---|---|---|---|---|
| `backend/controllers/orderController.js` — `placeOrder` | Mounted `POST /api/order/place`; Frontend Checkout | Writes false and `"COD"` | Initial operational order state | No invoice or receipt is created by this write. |
| `backend/controllers/orderController.js` — `adminCreateOrder`; `backend/services/adminDirectOrderService.js` | Mounted `POST /api/order/admin-create`; Admin Create Order | Rejects paid declaration and records false for accepted direct order | Direct-order creation and stock/order transaction | Does not represent subsequent invoice collection. |
| `backend/controllers/distributorDirectOrderController.js` — `createDistributorDirectOrder`, `updateDistributorDirectOrderStatus` | Mounted distributor direct-order routes; Manufacturer portal Distributor Direct Orders | Rejects paid declaration/mutation; created order has false | Operational order state | A delivered direct order may receive a customer receivable without changing this field. |
| `backend/controllers/manufacturerDirectOrderController.js` — `createDirectOrder`, `updateDirectOrderStatus` | Router is not mounted | Rejects paid declarations in code | No confirmed production effect | Controller/service evidence alone is not production usage. |
| `backend/services/distributorSelfDeliveryService.js` — `updateSelfDeliveryStatus` | Mounted distributor status route; Distributor Self-Delivery UI | Reads `paymentMethod`/`payment`; may write `payment: true` only when COD collection OTP is verified | Operational customer-collection marker at delivery | OTP-disabled collection is recorded as `PENDING_VERIFICATION` and leaves the Boolean false. A true value does not mean company Treasury has received the remittance. |
| `backend/services/distributorDeliveryOtpService.js` — `isCodUnpaidOrder`, `verifyDistributorDeliveryOtp` | Mounted OTP request/verification path | Reads COD method and false state; verifies amount-bound customer code | Controls OTP requirement and establishes a distributor collection event | It verifies the collection event contract, not bank receipt by the company. |
| `backend/services/orderPaymentAccountingService.js` — `recordDeliveredOrderCashReceipt` | Called by exported `cashReceived` controller handler; no route mapped in `orderRoute.js` | Writes true and posts an order-keyed customer-payment journal | Legacy service behavior | No confirmed mounted caller; not evidence of an active collection path. |
| `backend/services/accountingPostingEngine.js` — delivered-sale posting | Delivery accounting outbox worker / mounted delivery completion callers | Reads method and Boolean to choose debtor/control account and fail closed for some unsupported paid declarations | Sales, revenue, VAT, COD/customer receivable, COGS and payable posting | Not a general customer receipt reader. COD receivable is allocated to NCM or distributor party; direct customer receivable is a different source. |
| `backend/services/orderCancellationService.js` — cancellation guard | Mounted customer/Admin cancellation routes | Reads `payment` and independently checks journals, accounting documents, cash transactions, and distributor cash events | Blocks cancellation when financial activity exists | The Boolean alone is not decisive; a false order with a financial document or cash event is also blocked. |
| `backend/services/deliveryService.js` — `requestDeliveryReturn` | Mounted NCM delivery-return route | Reads method/Boolean; preserves the Boolean after delivered return request; keeps an undelivered COD order false | Fulfillment return state and pending settlement tracking | Does not reverse a payment Boolean based on an accounting invoice or receipt correction. |
| `backend/controllers/orderController.js` — `buildOrderListItem` | Mounted `/api/order/list`, `/admin-list`, `/userorders`; Frontend and Admin Orders | Serializes `Boolean(order.payment)` and `paymentMethod` | API contract for order-facing screens | Does not join or derive status from invoice balances, allocations, receipts, reversals, COD or settlement state. |
| `backend/services/adminOrderControlService.js`, `backend/services/adminDeliveryMonitoringService.js` | Admin order-control and delivery-monitoring routes | Select/return order payment fields | Operational Admin control/monitoring | Displays an order projection, not customer AR or Treasury receipt. |
| `backend/services/distributorNcmService.js`, delivery controllers | Distributor NCM and delivery responses | Serialize/order-select the Boolean and method | Fulfillment/carrier operational UI | Does not include the full invoice/receipt state in these order payment fields. |
| `frontend/src/pages/Orders.jsx` | Customer `POST /api/order/userorders` caller | Displays “Payment recorded”, “Pending”, “Due on delivery”, or “Collection not verified” based on the order fields and delivery occurrence | Customer-facing order status | More tender-aware than Admin's labels, but still does not display linked invoice balance or receipt reversal state. |
| `admin/src/pages/Orders.jsx` | Admin order list/control | Displays `Done`/`Paid` or `Pending (COD)`/`COD - Pending` from the Boolean | Operational order display | False is labeled COD-pending even when the tender is not COD; it does not display partial invoice settlement. |
| `manufacturer/src/pages/Orders.jsx`, `NcmDeliveries.jsx`, `DistributorSelfDelivery.jsx`, `DistributorCourierSlip.jsx` | Manufacturer/Distributor fulfillment pages | Displays paid/unpaid/cash-to-collect from order fields; self-delivery also gates collection handling on COD and false | Fulfillment and dispatch documents | Some labels simplify false to “Collect Cash” or “COD due”; verified distributor collection can show paid before company remittance. |
| `manufacturer/src/pages/DirectOrders.jsx` | Mounted `/api/distributor/orders/direct` caller | Displays paid/pending from `Order.payment`; computes its `totalRevenue` KPI from only orders where `payment` is true | Counter/phone-order operational page | Does not use delivered-sale revenue journals, invoice balances, or generic receipt allocations; its KPI is not an authoritative sales-revenue report. |

### 4.2 Invoice, receipt, COD, Treasury, and journal states

| File/function | Route or caller | Read/write | Effect and authoritative record |
|---|---|---|---|
| `backend/services/accountingPostingEngine.js` — `postDeliveredOrderAccounting` | Delivery accounting outbox worker | Writes delivered-sale journal and source-linked receivable document | A direct unpaid customer sale creates `DIRECT_ORDER_RECEIVABLE` against the customer, linked by order ID. NCM/distributor COD creates a receivable against the carrier/distributor instead. |
| `backend/services/customerReceiptService.js` — `recordCustomerReceipt` | Mounted `POST /api/finance/collect-receivable` | Reads open/partial NPR customer invoice balance; creates receipt; updates mapped Treasury balance, posts payment journal, allocates invoice balance, writes receipt audit event | Source invoice/party, allocation, Treasury movement, journal, and audit are the collection evidence chain. Does **not** update `Order.payment`. |
| `backend/services/customerReceiptService.js` — `reverseCustomerReceipt` via `settlementCorrectionService.js` and approval executor | Mounted Admin correction request, then independent approval | Reverses full customer receipt, posts cash/journal correction, writes reversal allocations and settlement-reversion/audit evidence, restores invoice balance | Does **not** update `Order.payment`. Partial receipt reversal is unsupported. |
| `backend/controllers/financialController.js` — `getPayablesAndReceivables` | Mounted `GET /api/finance/payables-receivables`; Admin Payables & Receivables | Reads receivable `AccountingDocument` balances, status, CASH allocations and cash transaction history; collects receipt reversal records for history | Reports `PARTIALLY_RECEIVED`/`SETTLED` from invoice state, independently from order Boolean. |
| `backend/services/distributorSelfDeliveryService.js` — delivery collection | Mounted distributor self-delivery | Creates `CUSTOMER_COLLECTION` event; OTP path creates `VERIFIED`, non-OTP path creates `PENDING_VERIFICATION`; order Boolean only set true in OTP path | Customer collection/custody at distributor, not company Treasury. |
| `backend/services/distributorCashSettlementService.js` — remittance review | Mounted Admin remittance review; submission helper unmounted | On verification, increments Treasury, creates cash transaction and journal, allocates to distributor COD receivables, updates batch/event and audit | Internal company receipt is a later state than customer collection at delivery. |
| `backend/services/distributorCashSettlementService.js` — settlement-request evidence/review | Mounted distributor and Admin settlement-request routes | Request/evidence/review lifecycle; checks submitted `actualReceivedAmount` against requested amount and posts company-collection settlement | Separate model from standalone remittance; user-entered evidence and internal posting are not independent bank matching. |
| NCM settlement service and delivery settlement routes | Mounted delivery settlement routes | Reads expected/actual carrier settlement, creates settlement/Treasury/journal/allocation effects, keeps variance/reversal status separately | Does not synchronize order Boolean. |
| Accounting reporting services / Admin General Ledger, Trial Balance, Financial Statements | Mounted `/api/accounting/...` readers | Read posted/reversed journal population and disclose report basis | Financial reports use journals, not `Order.payment`; their report basis does not prove complete invoice-to-cash reconciliation. |

## 5. Source-to-invoice-to-receipt relationship

1. A direct order begins with `Order.payment === false`; direct-order create guards reject a paid declaration.
2. When delivered-sale accounting posts a direct customer sale with a receivable tender mapping, the posting engine creates a customer `AccountingDocument` of type `INVOICE`, `side: RECEIVABLE`, `sourceType: DIRECT_ORDER_RECEIVABLE`, and `sourceId: Order.id`. The delivery sale journal is a separate source event.
3. The mounted generic receipt service accepts any otherwise-eligible customer invoice/debit note in NPR; it does not exclude `DIRECT_ORDER_RECEIVABLE`. For one invoice, the `CashTransaction.referenceId` uses the invoice source ID (the order ID); allocations explicitly link receipt, invoice, and payment journal.
4. Receipt collection changes the invoice `allocatedAmount`, `remainingAmount`, and status, and posts the linked Treasury and GL effects. It leaves the order row's payment Boolean unchanged.
5. Approved full receipt reversal creates the correction transaction/journal, reversal allocations, and reversal record, restoring the invoice balance/status. It also leaves the order Boolean unchanged.
6. COD is not the same source chain: NCM and distributor COD deliveries use carrier/distributor receivable documents. Distributor customer collection, distributor remittance to company, and NCM net deposit each have distinct records and states.

## 6. State transition map

| Scenario | Records that change | `Order.payment` | Financial interpretation |
|---|---|---|---|
| 1. Unpaid direct order | Order is created with method and unpaid Boolean. | False | Operationally unpaid at order level. No receipt is implied. |
| 2. Delivered direct order with customer receivable | Fulfillment/delivery state; delivery sale journal; customer `DIRECT_ORDER_RECEIVABLE` invoice when the posting event completes. | Remains false | Customer debt is carried by invoice balance; delivery is not collection. |
| 3. Partial invoice collection | Generic receipt `CashTransaction`, Treasury balance, payment journal, partial `CASH` allocation, audit event; invoice becomes `PARTIALLY_PAID`. | Unchanged (typically false for direct orders) | Customer has an open balance. Order screens have no partial state. |
| 4. Full invoice collection | Same chain; invoice `remainingAmount` reaches zero and status becomes `PAID`. | Unchanged | Invoice is settled in the subledger. This is not a synchronization to order-level status. |
| 5. Reversed customer receipt | Approved reversal cash/journal effects, reversal allocations and settlement reversion; invoice balance/status restored. | Unchanged | Original receipt remains in history with reversal evidence; source order Boolean is not recalculated. |
| 6. COD order awaiting collection | Delivery state and delivered-sale accounting; an NCM or distributor COD receivable may be created against the relevant carrier/distributor. | Usually false | Delivery status and COD expected are not proof that the customer paid or the company received funds. |
| 7. COD customer collection and company remittance | Distributor event is pending or verified. Later company remittance review or company-collection settlement can post Treasury, journal and receivable allocation; NCM has its own actual-deposit settlement/variance records. | Distributor self-delivery sets true only for the OTP-verified collection path; non-OTP declaration leaves false. NCM settlement does not sync it. | Customer collection/custody and internal receipt are distinct. A true Boolean can precede company Treasury receipt. |
| 8. Cancelled order | Cancellation sets order/fulfillment status and releases eligible operational reservations. Cancellation is blocked if `payment` is true or a linked journal, invoice, cash transaction, or distributor cash event exists. | No payment synchronization; eligible pre-financial cancellation retains false. | A false Boolean alone does not establish that cancellation is allowed or that no financial activity exists. |
| 9. Returned/refunded order | Return/exchange/refund workflows create their own fulfillment, cash, invoice, journal and settlement correction records as applicable. NCM return request records pending settlement; a pre-delivery COD request stays false, while a post-delivery request preserves the existing Boolean. | Not generally synchronized to refund/reversal state | A return or refund is not itself proof that customer cash was returned, and does not inherently clear the order Boolean. |

## 7. Evidence-backed inconsistencies and interpretation

### 7.1 Settled or partially settled invoice while order screens remain unpaid

`recordCustomerReceipt` and `reverseCustomerReceipt` update accounting documents and linked financial records but do not update the source order. The Admin receivables API and page display invoice `remainingAmount` and `AccountingDocument.status`; the order serializer and order pages display `Order.payment`. Therefore a full direct-order invoice receipt may coexist with a false order Boolean, and a partial receipt has no corresponding order-level partial state. Admin's false-state text can say `Pending (COD)`/`COD - Pending` even when `paymentMethod` is not COD.

This is a demonstrated difference between two projections, not proof that the invoice or order row is persisted in that state in any environment.

### 7.2 Hub counter tender and payment-only revenue KPI

The Distributor Direct Orders page defaults to `HUB_VISIT` and `CASH`, and sends `paymentMethod` but no paid declaration. The mounted controller records the order as `Delivered` with `payment: false`, then immediately calls delivered-sale accounting. For self-fulfilled direct sales, the accounting poster maps a false payment Boolean to `CUSTOMER_RECEIVABLE_CONTROL` and creates a `DIRECT_ORDER_RECEIVABLE` invoice. The UI explicitly warns that tender choice is not a receipt and that payment remains unrecorded until an approved receipt workflow is available; this is a deliberate fail-closed distinction, not evidence that cash was collected.

The same page's `totalRevenue` KPI sums only orders with `payment === true`. It can therefore exclude a delivered counter sale whose invoice is open or already settled through the generic invoice receipt service, and it is not the same population as posted sales revenue. If staff actually receive cash at the counter before a receipt is posted, the open invoice would also remain unresolved; actual practice cannot be established from code or without independent cash evidence.

### 7.3 “Paid” order Boolean can precede company Treasury receipt

In the mounted distributor self-delivery path, OTP verification creates a `CUSTOMER_COLLECTION` event with `VERIFIED` status and sets `Order.payment = true`. Distributor COD receivable accounting and later remittance remain separate. The order Boolean and fulfillment slip can consequently read “Paid” while the amount is still represented as distributor-held collection rather than an internally received company Treasury movement.

This can be valid if the Boolean means “customer paid the last-mile collector.” It is misleading if interpreted as “company cash/bank receipt posted.” The current field name and portal labels do not consistently communicate that distinction.

### 7.4 Delivered COD with a pending collection declaration

When distributor self-delivery OTP is disabled, the mounted delivery path requires a collection confirmation, records a `CUSTOMER_COLLECTION` event as `PENDING_VERIFICATION`, and leaves `Order.payment` false. The Distributor Self-Delivery page derives its COD state from that Boolean and may still say `COD due` after the delivery transition. The event is evidence of a declaration awaiting verification, not a verified collection.

### 7.5 Receipt reversal is not reflected in the order projection

The approved generic receipt reversal restores invoice state and Treasury/journal positions but does not update `Order.payment`. Direct orders collected through this generic invoice path normally start and remain false; the code does not establish a general true-to-false synchronization rule if an order-level Boolean was set through another path. A reversed receipt can therefore leave order-facing status stale if it had previously shown paid. The actual occurrence/population cannot be established without database inspection.

### 7.6 Cancellation and return facts are separate

Cancellation checks several financial records in addition to `Order.payment`, and blocks when any are present. This prevents a false Boolean from being treated as proof of no financial activity. Return/refund workflows also keep their own records; the order Boolean is not a reliable refund/reversal status.

### 7.7 Financial reports intentionally use different records

Admin Payables & Receivables uses invoice balances and receipt allocation history. Posted General Ledger/Trial Balance/Financial Statements use journal populations and their report-basis metadata. Order pages use the operational Boolean. These readers answer different questions; none by itself reconciles the full order/customer-collection/distributor-remittance/Treasury/GL chain.

## 8. Business-policy alternatives

| Approach | Behavior preserved or changed | Compatibility/reporting | Historical and testing impact | Schema |
|---|---|---|---|---|
| **A. Keep `Order.payment` operational; invoices/receipts are financial authority** | Preserves current order workflows and Boolean writers. Explicitly limits `payment` to its documented operational meaning and prevents it being used as AR/Treasury proof. | Lowest API risk. Existing displays still require clearer terminology to distinguish customer collection, COD pending, and internal remittance. Financial reports remain invoice/journal based. | No historical rewrite. Tests should pin down each writer's exact meaning, especially OTP verified versus pending and invoice receipt/reversal not changing the order field. | None required. |
| **B. Derive payment display from linked invoice/receipt/reversal records** | Changes order-facing payment display for orders with authoritative linked customer receivables; should not mutate the legacy Boolean. Must separately represent COD collection and distributor/NCM custody. | Prefer an additive derived status field/view to preserve API compatibility. Order pages and filters change; finance reports should remain based on subledger/GL. | Historical display changes wherever source links and reversals are complete; missing or ambiguous links must display unknown/unreconciled, not guessed paid/unpaid. Requires route/read-model tests for full, partial, reversal, return and COD paths. | Not necessarily, if derived at read time; a stored/cache projection would require a separately designed schema and consistency policy. |
| **C. Introduce explicit payment lifecycle** | Replaces ambiguous Boolean semantics with named states for unpaid, partially paid, customer-paid/collector custody, company-received, reversed, COD pending, and refunded/corrected. Requires defined transitions and ownership. | Broadest portal/API/report migration. Every writer, filter, and consumer must adopt the new semantics; old Boolean needs a compatibility period. | Requires historical classification with unknown states retained, backfill plan, event transition tests, idempotency/reversal/concurrency validation and isolated DB validation. | Likely required for persisted lifecycle/events and migration, unless implemented as a read-model first. |

### Recommendation

Adopt **Approach A as the current policy**, with a requirement that future copy and reports identify what the Boolean means and never present it as invoice settlement or company Treasury receipt. This is the least risky interpretation supported by current writers: the field is consumed by delivery/collection operations, while invoice and allocation records hold customer debt and receipts have separate Treasury/journal links. Do not synchronize it in this task.

Approach B is a reasonable later **read-only, additive** customer/order display improvement for direct customer receivables, after source mappings and fallback states are defined. It cannot safely collapse distributor/NCM COD collection, remittance, refunds, and customer invoices into one derived flag. Approach C should remain a later policy/schema project, not an R5 implementation.

## 9. Distributor-remittance boundary and recommendation

- `submitDistributorRemittance` in `distributorCashSettlementService.js` validates a distributor remittance submission, caps it against verified collection and open distributor COD receivables, then creates a `DistributorRemittanceBatch` (`PENDING_REVIEW`) and `COMPANY_REMITTANCE` cash event (`PENDING_VERIFICATION`). The helper has no confirmed route or production caller; its tests establish service behavior only.
- An Admin remittance-review route is mounted. On verification, its service records the Treasury inflow, payment journal and allocation against distributor COD receivables, advances the event/batch states, and writes audit evidence. This review route does not establish that a normal distributor submission UI/API currently creates those batches.
- The mounted company-collection settlement-request workflow is separate. Admin issues a request; the Distributor portal submits transfer reference/evidence; Admin verifies the actual received amount and Treasury account before posting a distributor balance settlement. It has different request/settlement records, statuses, netting semantics and amount checks. It is not an alternate implementation of the standalone batch helper.
- Uploaded evidence, declared references, Admin workflow state, internal Treasury records and a balanced journal do not independently match a bank statement or prove physical cash.

**Recommendation:** retain the mounted company-collection settlement-request flow for the net-settlement purpose it currently implements. Do not activate or merge `submitDistributorRemittance` as part of payment-state work. Finance/management should decide whether a distinct COD-only remittance submission is still needed; if so, define its source population, evidence requirements, partial/overpayment behavior, status ownership, Treasury matching and correction path before selecting the canonical workflow. Keep the unmounted helper pending that decision rather than silently deleting it or treating it as active.

## 10. Proposed future regression coverage

These are recommendations only; no tests were added in this audit.

1. Route/service regression: generic full and partial receipt against Admin and Distributor `DIRECT_ORDER_RECEIVABLE` source documents changes invoice allocation/balance, but not `Order.payment`.
2. Reversal regression: after approved full receipt reversal, invoice and receipt/reversal history reflect correction while order payment projection remains unchanged; do not assert persistence from mocks.
3. Order reader contract: response serializer returns order Boolean/method without implying invoice settlement; Admin, customer, Manufacturer and Distributor display states are tested separately for COD, non-COD, partial invoice and reversed receipt.
4. Distributor collection state: OTP verified -> `DistributorCashEvent.VERIFIED` and order Boolean true; OTP-disabled declaration -> pending event and Boolean false; neither path creates a company Treasury receipt solely by setting the order flag.
5. Direct counter-sale reporting: distinguish delivered-sale journal revenue, open/settled direct-order invoices, and the Direct Orders payment-only KPI; validate its label and source population.
6. Remittance boundary: helper route absence stays explicit; mounted company-collection requests require evidence and validated actual received amount; Admin remittance review cannot be counted as an independent bank match.
7. Cancellation/return: cancellation is blocked by invoice/cash/distributor event even when Boolean false; return/refund/reversal does not silently rewrite the Boolean.
8. Once isolated-database validation is authorized and available: verify persisted source links, rollback on failure, duplicate submissions/reversals, concurrent allocation, migration/schema parity, and reconciliation against supplied bank/cash evidence. No such validation was performed here.

## 11. Remaining limitations and status

- Static source confirms service/route structure only; actual record populations, applied schema, persistence, transaction atomicity, rollback, and concurrency are **NOT_VERIFIABLE_WITHOUT_DATABASE**.
- Direct customer invoice balances, distributor cash custody, NCM settlement, Treasury balances and GL journals are separate representations and were not reconciled against an actual period.
- Independent cash counts, bank statements, provider settlement statements, and external remittance confirmation are **INDEPENDENT_EVIDENCE_REQUIRED**.
- `Order.payment` semantics and portal wording need a business decision before any synchronization or lifecycle redesign.
- The standalone distributor remittance submission helper's future lifecycle remains unresolved.
- **P5-R5:** complete for the static audit/documentation scope only. **Phase 5:** **PARTIAL / INCOMPLETE**. **R8:** **PARTIAL**. **P4.2:** **INCOMPLETE**. **P4.3:** **IN PROGRESS, INCOMPLETE**. **Phase 4:** **INCOMPLETE**.
- No Phase 6 or Phase 7 work was started as part of P5-R5.

## 12. Files inspected

- `backend/server.js`
- `backend/prisma/schema.prisma`
- `backend/routes/orderRoute.js`
- `backend/routes/financialRoute.js`
- `backend/routes/distributorRoute.js`
- `backend/routes/adminDistributorDetailRoute.js`
- `backend/routes/deliveryRoute.js`
- `backend/routes/manufacturerDirectOrderRoute.js` (mount status checked)
- `backend/controllers/orderController.js`
- `backend/controllers/distributorDirectOrderController.js`
- `backend/controllers/manufacturerDirectOrderController.js` (mount status checked)
- `backend/controllers/financialController.js`
- `backend/controllers/distributorFinanceController.js`
- `backend/services/adminDirectOrderService.js`
- `backend/services/accountingPostingEngine.js`
- `backend/services/customerReceiptService.js`
- `backend/services/orderPaymentAccountingService.js`
- `backend/services/orderCancellationService.js`
- `backend/services/distributorSelfDeliveryService.js`
- `backend/services/distributorDeliveryOtpService.js`
- `backend/services/distributorCashSettlementService.js`
- `backend/services/deliveryService.js`
- `backend/services/settlementCorrectionService.js`
- `backend/services/accountingActionApprovalService.js`
- `backend/services/adminOrderControlService.js`
- `backend/services/adminDeliveryMonitoringService.js`
- `backend/services/distributorNcmService.js`
- `frontend/src/pages/Orders.jsx`
- `admin/src/pages/Orders.jsx`
- `admin/src/pages/PayablesReceivables.jsx`
- `manufacturer/src/pages/Orders.jsx`
- `manufacturer/src/pages/NcmDeliveries.jsx`
- `manufacturer/src/pages/DistributorSelfDelivery.jsx`
- `manufacturer/src/pages/DirectOrders.jsx`
- `manufacturer/src/components/DistributorCourierSlip.jsx`
- `docs/accounting/20-p5-r2-collection-return-settlement-evidence-chain.md`
- `docs/accounting/21-p5-r4-direct-order-receipt-and-reversal-regression-coverage.md`

No test suite was run because this is a documentation-only, static-inspection task. No database or external system was accessed.
