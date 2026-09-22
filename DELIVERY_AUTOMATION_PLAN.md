# Nepal Can Move Delivery Automation Plan

Status: Planning only. No delivery automation code has been implemented yet.
Owner: Admin / Engineering
Last reviewed: 2026-09-16

## 1. Objective

Automate the lifecycle from a manufacturer's **Ready to Deliver** action through Nepal Can Move (NCM) order creation, pickup, delivery, COD reconciliation, customer tracking, and return-to-manufacturer handling.

The design must preserve the existing `Order`, `OrderAssignment`, manufacturer inventory, and accounting modules while adding an auditable delivery record. NCM is an external dependency and must never be allowed to silently change local inventory or financial balances without a recorded event and a controlled reconciliation step.

## 2. Findings From The Current System

- `Order.fulfillmentStatus` and `OrderAssignment.status` are free-form operational summaries. They do not contain a status history, NCM order ID, request attempts, or webhook event identity.
- Manufacturer status updates currently accept arbitrary status strings and update the order directly. This is the first boundary to replace with a validated transition service.
- The allocation engine assigns a manufacturer and reserves variant stock. The manufacturer must still confirm physical readiness before any carrier order is created.
- There is no NCM client, webhook route, branch mapping, delivery charge calculation, or scheduled reconciliation job.
- `CustomerReturn` and `SupplierReturn` do not model a carrier return belonging to a manufacturer assignment. They cannot by themselves prove pickup, return receipt, inspection, or restocking.
- The accounting domain already has double-entry journal posting, Account Payable, Account Receivable, and idempotency support. Delivery accounting should use those services rather than write balances directly.
- Customer order history returns order summaries, but there is no customer-safe delivery timeline endpoint.

## 3. NCM Contract Analysis And Mappings

### NCM endpoints to use

| Capability | Endpoint | Use in this system |
| --- | --- | --- |
| Branches | `GET /api/v2/branches` | Admin branch catalog and mapping validation |
| Assigned pickup branches | `GET /api/v2/vendor/assigned-branches` | Verify the manufacturer's/admin pickup branch configuration |
| Delivery rate | `GET /api/v1/shipping-rate` | Quote delivery before order creation; store the response |
| Create order | `POST /api/v1/order/create` | One guarded submission when a package is ready |
| Order detail | `GET /api/v1/order?id=...` | Reconciliation of COD, delivery fee, payment, and latest status |
| Order status | `GET /api/v1/order/status?id=...` | Detailed carrier timeline and recovery from missed webhooks |
| Bulk status | `POST /api/v1/orders/statuses` | Rate-efficient reconciliation of active deliveries |
| Comments | `GET /api/v1/order/comment?id=...` | Admin support/audit context |
| Add comment | `POST /api/v1/comment` | Add local reference or return instruction when appropriate |
| Return | `POST /api/v2/vendor/order/return` | Ask NCM to start the vendor-return process |
| Exchange | `POST /api/v2/vendor/order/exchange-create` | Exchange flow, only after admin approval |
| Redirect | `POST /api/v2/vendor/order/redirect` | Address correction, only after verification and approval |
| Labels | `GET/POST /api/v2/vendor/order/label` | Print one or many labels after NCM IDs exist |
| Webhook setting/test | `POST /api/v2/vendor/webhook` and `/test` | Admin configuration and connectivity check |
| COD ticket | `POST /api/v2/vendor/ticket/cod/create` | Request COD transfer; store ticket ID and settlement status |

### Important contract rules

- Send `Authorization: Token <NCM_API_TOKEN>` from the backend only. Never expose the token to manufacturer or customer clients.
- Keep separate configurable base URLs for demo and production. Do not hardcode the demo URL.
- NCM order creation is limited to 1,000/day and view/status/comment calls to 20,000/day. Use a queue, exponential backoff, and bulk status calls; do not poll every order independently.
- NCM creation has no documented idempotency key. The local system must prevent duplicate submissions using a unique delivery/order creation key and an atomic state transition.
- The shipping-rate endpoint uses `Pickup/Collect`, `Send Branch2Door`, `D2B`, and `B2B`, while order creation documents `Door2Door`, `Branch2Door`, `Branch2Branch`, and `Door2Branch`. Implement an explicit mapping table and verify it against a demo request before production.
- `cod_charge` includes delivery in the NCM create API. Store item subtotal, customer delivery charge, NCM delivery charge, and NCM COD amount as separate values even if one value is sent to NCM.
- Webhook documentation conflicts: one document mentions silent retries and another says no retry mechanism. Treat webhook delivery as best effort and always reconcile with NCM status/detail APIs.
- NCM webhook documentation provides no signing secret or signature header. Authenticate the local endpoint with a high-entropy URL secret, HTTPS, rate limiting, payload validation, and idempotent event storage. Rotate the secret without exposing it in logs.

## 4. Target Lifecycle

### Local states

Use a controlled transition service with an allow-list. Keep the existing summary fields synchronized for compatibility, but make the new delivery record and event history authoritative.

`PENDING_ASSIGNMENT -> ASSIGNED -> ACCEPTED -> PREPARING -> QUALITY_CHECK -> LETTER_READY -> CHECKLIST_COMPLETE -> PACKED -> PACKAGE_DETAILS_COMPLETE -> READY_TO_DELIVER -> SUBMISSION_PENDING -> NCM_CREATED -> PICKUP_CONFIRMED -> IN_TRANSIT -> ARRIVED_AT_DESTINATION -> OUT_FOR_DELIVERY -> DELIVERED`

Failure and exception states:

`SUBMISSION_FAILED`, `PICKUP_FAILED`, `DELIVERY_FAILED`, `CUSTOMER_REFUSED`, `RETURN_REQUESTED`, `RETURN_IN_TRANSIT`, `RETURNED_TO_MANUFACTURER`, `RETURN_INSPECTED`, `CANCELLED`, `EXCHANGE_REQUESTED`, `ADDRESS_CHANGE_PENDING`.

Rules:

1. A manufacturer can move only its assigned order through the controlled preparation sequence: acceptance, stitching/branding, quality check, compulsory customer letter, complete checklist, packing, and package details.
2. `READY_TO_DELIVER` requires a locked package snapshot, validated customer phone/address, mapped origin/destination branches, package weight/type, a compulsory customer letter, a complete checklist, and an inventory reservation.
3. Only a backend worker or admin-approved command may move `READY_TO_DELIVER` to `SUBMISSION_PENDING` and call NCM.
4. A successful NCM response creates exactly one local carrier order mapping and moves the order to `NCM_CREATED`.
5. Carrier statuses update the local timeline, but a webhook must not directly post cash, restock inventory, or close a return without the relevant business transition.
6. Delivered is not the same as COD settled. Delivery and cash settlement are separate states.

### Ready-to-deliver transaction

When the manufacturer clicks the action:

1. Authorize manufacturer ownership of the assignment.
2. Validate current state and reject duplicate clicks.
3. Snapshot items, quantities, variants, package description, weight, origin branch, destination branch, delivery type, address, and COD amount.
4. Confirm reserved stock is available and mark the package reservation as committed.
5. Create an outbox/job record with an idempotency key such as `NCM_CREATE:<orderId>:<packageVersion>`.
6. Return an accepted response to the UI. A worker performs the external call.
7. Calculate and store the NCM rate before creation. Require admin review if the rate, destination, COD, or address differs from the local order beyond configured rules.
8. Submit once. Persist request metadata with secrets redacted, response code/body, attempt number, and timestamps.
9. On success, persist NCM order ID, vendor reference, charge breakdown, and label data availability.
10. On timeout/5xx, retry only when the creation attempt is still unresolved. Never blindly create a second order after an unknown timeout; reconcile by vendor reference or escalate to admin.

## 5. Proposed Data Model Additions

Add these Prisma models in a dedicated migration. Prefer enums only if the current project migration style supports them; otherwise enforce values in a transition service and database indexes.

### DeliveryOrder

One record per local order/package submission.

Key fields:

- `id`, `orderId` (unique for the first version), `assignmentId`, `manufacturerId`
- `state`, `deliveryType`, `packageWeight`, `packageDescription`, `packageVersion`
- `originBranchName`, `destinationBranchName`, optional NCM branch IDs/codes
- `ncmOrderId` (unique nullable), `vendorReference` (unique), `ncmStatus`, `ncmPaymentStatus`
- `itemAmount`, `customerDeliveryCharge`, `ncmDeliveryCharge`, `codAmount`, `currency`
- `createdAt`, `readyAt`, `ncmCreatedAt`, `pickedUpAt`, `deliveredAt`, `returnedAt`
- `lastSyncedAt`, `nextSyncAt`, `syncFailureCount`, `lastSyncError`

### DeliveryEvent

Append-only local timeline and audit record.

Fields: `deliveryOrderId`, `orderId`, `source` (`MANUFACTURER`, `ADMIN`, `NCM_WEBHOOK`, `NCM_POLL`, `SYSTEM`), `eventType`, `fromState`, `toState`, `ncmStatus`, `payloadJson`, `occurredAt`, `actorId`, `idempotencyKey` unique.

### NcmRequestAttempt

Operational integration log for every external request.

Fields: `deliveryOrderId`, `operation`, `idempotencyKey` unique, `attemptNumber`, `requestUrl` without token, sanitized request/response JSON, `httpStatus`, `result`, `errorCode`, `startedAt`, `finishedAt`, `nextRetryAt`.

### NcmWebhookEvent

Raw-but-redacted inbound event store.

Fields: `eventKey` unique, `event`, `orderId`, `orderIds`, `status`, `timestamp`, `payloadJson`, `receivedAt`, `processedAt`, `processingStatus`, `processingError`.

### DeliveryReturn

Carrier return plus physical manufacturer handoff.

Fields: `deliveryOrderId`, `orderId`, `manufacturerId`, `ncmReturnRequestedAt`, `ncmReturnComment`, `returnReason`, `state`, `trackingReference`, `receivedAt`, `inspectedAt`, `inspectionResult`, `restockDecision`, `notes`, and actor/timestamps.

### DeliveryFinancialSettlement

One reconciliation record per delivery/COD cycle.

Fields: `deliveryOrderId`, `ncmOrderId`, `codExpected`, `codCollected`, `deliveryFeeExpected`, `deliveryFeeActual`, `otherAdjustments`, `manufacturerPayable`, `platformReceivable`, `ncmTicketId`, `settlementState`, `settledAt`, `journalEntryId`, `varianceReason`.

### Supporting additions

- Add `ncmBranchName/code` and `ncmApiEnabled` to manufacturer or add a `DeliveryBranchMapping` model. Do not infer production branch names from free-form city text.
- Add `customerTrackingToken` or use an authenticated customer endpoint; never expose NCM tokens, internal notes, or financial details to customers.
- Add an append-only `OrderStatusHistory` if `DeliveryEvent` is not made the shared history for all fulfillment transitions.
- Add unique/indexed fields for `OrderAssignment`, `DeliveryOrder.ncmOrderId`, event keys, state, NCM status, and sync scheduling.

## 6. API And Worker Plan

### Backend modules

- `services/ncmClient.js`: timeout, retry policy, auth header, response normalization, rate limiting, redacted logging.
- `services/deliveryStateMachine.js`: valid transitions, authorization-independent business rules, event creation.
- `services/deliveryOrchestrator.js`: quote, create, reconcile, label, return, exchange, redirect workflows.
- `services/deliveryAccountingService.js`: idempotent payable/receivable and journal integration.
- `controllers/deliveryController.js`: manufacturer ready action, admin detail/list/retry/approve, customer timeline.
- `controllers/ncmWebhookController.js`: authenticate, validate, persist, enqueue; acknowledge quickly.
- `jobs/deliveryJobs.js`: outbox processing, active-order reconciliation, webhook processing, settlement checks, stale-state alerts.
- Routes: manufacturer ready action, admin operational/financial detail, customer-safe tracking, and NCM webhook.

### Required backend behavior

- Use a request timeout shorter than NCM's 10-second webhook expectation and bounded retries for safe read operations.
- Use a queue or durable outbox. If no queue library is adopted, implement a database-backed claim/lease worker; do not rely on an in-memory timer in a multi-instance deployment.
- Poll active NCM orders in batches through `POST /api/v1/orders/statuses`; fetch full details/status history only for changed or exception orders.
- Cache branches and assigned branches with an expiry, and block creation if mapping is stale or invalid.
- Normalize NCM statuses to local states through a mapping table. Preserve the original status and response.
- Use UTC internally and retain the NCM timestamp/timezone in the raw event.

## 7A. NCM Webhook URLs

Configure these URLs in the NCM vendor portal, replacing `https://api.example.com` with the public HTTPS URL of this backend:

```text
Order Delivery Webhook URL:
https://api.example.com/api/delivery/webhook/ncm/order-status?secret=<NCM_WEBHOOK_SECRET>

Order Comment Webhook URL:
https://api.example.com/api/delivery/webhook/ncm/order-comment?secret=<NCM_WEBHOOK_SECRET>
```

The backend also accepts the secret through the `x-ncm-webhook-secret` header for internal testing, but NCM configuration should use the HTTPS query-string form because the NCM documentation does not guarantee a configurable custom header. The secret must be long, random, stored only in deployment secrets, and excluded from access logs where the hosting platform allows it.

### Order delivery callback

Accepts the documented single-order payload:

```json
{
	"order_id": "123456",
	"status": "Delivered",
	"timestamp": "2024-01-15T10:30:00Z",
	"event": "delivery_completed"
}
```

It also accepts the documented bulk form with `order_ids`. The endpoint authenticates, stores an idempotent webhook event, maps the NCM status to the local delivery state, appends a delivery timeline event, and returns:

```json
{
	"success": true,
	"duplicate": false
}
```

### Order comment callback

Accepts the NCM comment shape and compatible aliases:

```json
{
	"orderid": 123456,
	"comments": "Customer requested delivery after 5 PM",
	"addedBy": "NCM Staff",
	"added_time": "2026-09-16T10:30:00+05:45"
}
```

The comment is stored in `DeliveryComment`, linked to the local delivery when the NCM order ID is known, and added to the delivery audit timeline. Unknown NCM order IDs are retained for later admin investigation instead of being discarded. Duplicate callbacks are acknowledged without creating a second comment.

### Operational behavior

- `200` acknowledges a valid authenticated callback, including a duplicate.
- `400` means the payload is invalid and should be corrected; the comment endpoint requires a positive order ID and non-empty comment.
- `401` means the webhook secret is missing or incorrect.
- `500` means processing failed after authentication; the event is not treated as successfully processed.
- The callback endpoints do not call NCM, create orders, settle COD, refund customers, or mutate inventory directly. Those operations remain controlled by the delivery workflow and admin reconciliation.

## 7. Returns, Exchanges, And Manufacturer Handoff

1. When NCM status indicates failed delivery, refusal, or return-to-vendor, create/update `DeliveryReturn` and notify admin/manufacturer.
2. Admin approves `POST /api/v2/vendor/order/return` once the reason is verified. Store the NCM response and prevent repeated requests.
3. Track physical return separately: `RETURN_IN_TRANSIT -> RETURNED_TO_MANUFACTURER` only after receipt confirmation by the manufacturer or admin.
4. Manufacturer records inspection: restockable, damaged, missing, or disputed. Inventory is changed only from this inspection command, with a stock log linked to the return.
5. For an exchange, require admin approval, preserve the original order relationship, and create the two NCM orders returned by the API as separate delivery records.
6. For redirect/address correction, require customer verification and admin approval; capture old/new address, destination, COD, NCM changelog, and any redirect fee before notifying the customer.
7. If goods are not received or are damaged, open a dispute/ticket and do not automatically settle manufacturer payable.

## 8. Admin Operations And Financial Controls

Admin dashboard should provide:

- Kanban/list by local state, NCM status, manufacturer, branch, aging, exception, and settlement state.
- Delivery detail: package snapshot, customer-safe address, NCM order/detail/status/comments, webhook/poll history, attempts, label, return chain, and audit events.
- Exception queue: missing branch, rate mismatch, NCM create timeout, duplicate suspicion, webhook failure, stale status, failed delivery, return dispute, COD variance.
- Metrics: ready-to-submit aging, pickup SLA, delivery SLA, delivery/return rate, manufacturer on-time rate, NCM failure rate, average fee, COD outstanding, and variance by branch/manufacturer.

Financial policy to approve before implementation:

- On order confirmation: customer receivable if COD/credit terms apply; revenue recognition policy must be explicit.
- On manufacturer fulfillment: create manufacturer payable from agreed cost, either at dispatch or delivery according to the contract. Do not use proposed cost.
- On NCM delivery: update operational delivery only; do not mark NCM cash settled.
- On NCM COD transfer: create/settle the receivable from NCM using the COD ticket/bank settlement evidence. Separate NCM delivery fees and deductions.
- On customer return/refund: reverse revenue/receivable and COGS as appropriate; restore inventory only after inspection.
- On carrier loss/damage: hold payable and post an approved claim/adjustment, never silently write off the variance.
- Every posting must use `postJournalEntry` with an idempotency key such as `DELIVERY_SETTLEMENT:<deliveryOrderId>:<settlementVersion>`.

## 9. Customer Tracking

Expose a customer-authenticated endpoint that returns:

- Order number, item summary, current friendly status, expected delivery window if available, and a timeline of safe milestones.
- Manufacturer preparation milestones only at a privacy-safe level.
- NCM tracking number/order ID only if the business wants to expose it; never expose internal costs, staff comments, tokens, or raw webhook payloads.
- Return/exchange status and next action when applicable.

The customer UI should consume the normalized local timeline, not call NCM directly. For guest orders, issue a short-lived signed tracking token with rate limiting and avoid using phone number alone as authorization.

## 10. Security And Reliability Requirements

- Store the NCM token, webhook secret, and encryption key in deployment secrets; rotate them and redact them from logs, database payloads, support exports, and error messages.
- Add strict manufacturer ownership checks to every assignment/delivery route. Never accept `manufacturerId` from the body as authority when JWT claims are available.
- Validate all NCM responses before state changes. Treat unknown statuses as `EXTERNAL_STATUS_UNMAPPED` and alert admin.
- Apply webhook body size limits, JSON schema validation, replay protection via event key/timestamp window, IP/rate controls where practical, and fast acknowledgement after durable persistence.
- Use database transactions for state transition plus event/outbox creation. Use row locking or an atomic conditional update to prevent double ready clicks.
- Protect against SSRF in webhook test/configuration features: allow only `http/https`, block private/link-local destinations where the platform permits, and never fetch customer-provided URLs from privileged internal networks.
- Retain audit history and sanitized NCM request/response records according to a defined retention policy.

## 11. Delivery Phases And Acceptance Criteria

### Phase 0: Decisions and contract validation

- [ ] Confirm production NCM base URL, token ownership, assigned pickup branch, branch naming, delivery types, and rate semantics.
- [ ] Confirm manufacturer payable timing, COD settlement workflow, refund responsibility, and return inspection policy.
- [ ] Test demo create/rate/status/return/label/webhook calls with non-production data.
- [ ] Decide queue/worker technology and deployment topology.

### Phase 1: Foundation

- [ ] Add Prisma models/migration and indexes.
- [ ] Add status transition service and append-only event history.
- [ ] Add NCM client with timeout, redaction, response validation, and request-attempt persistence.
- [ ] Add branch cache/mapping and admin configuration.
- [ ] Add tests for transitions, authorization, idempotency, and NCM response parsing.

### Phase 2: Ready-to-deliver and creation

- [ ] Replace free-form manufacturer status update for the delivery boundary with the guarded ready action.
- [ ] Add rate quote, package snapshot, durable outbox, worker, and NCM create flow.
- [ ] Add duplicate/timeout recovery and admin retry/escalation actions.
- [ ] Add label retrieval and printable label view.

### Phase 3: Tracking and reconciliation

- [ ] Add webhook endpoint and event processor.
- [ ] Add scheduled bulk status reconciliation and order-detail reconciliation.
- [ ] Add admin delivery list/detail/exception views.
- [ ] Add customer-safe tracking endpoint and UI timeline.

### Phase 4: Returns and finance

- [ ] Add failed-delivery/return workflows, physical receipt, inspection, and inventory outcomes.
- [ ] Add exchange and redirect approval workflows.
- [ ] Add COD ticket and settlement reconciliation.
- [ ] Add manufacturer payable, NCM receivable, variance review, and idempotent journal posting.

### Phase 5: Production hardening

- [ ] Load-test within NCM quotas and worker concurrency limits.
- [ ] Run failure drills: timeout after create, duplicate webhook, unknown status, NCM outage, return mismatch, and COD variance.
- [ ] Add alerts, dashboards, backups, secret rotation, and runbooks.
- [ ] Pilot with a single manufacturer and branch before enabling the full network.

## 12. Test Matrix

- Ready clicked twice concurrently creates one NCM order.
- NCM create returns 200, 400, 401, 404, 429, 500, and timeout.
- Unknown create outcome is reconciled without duplicate creation.
- Webhook is duplicated, late, malformed, test-mode, bulk, or out of order.
- Polling repairs a missed webhook and does not duplicate events.
- Unauthorized manufacturer cannot view or mutate another manufacturer's delivery.
- Customer sees only their own safe timeline.
- Delivered does not imply COD settlement.
- Return request is idempotent; physical receipt and inspection are separate.
- Restock and damaged write-off produce exactly one stock log and correct accounting entries.
- Exchange creates and tracks both NCM orders.
- Accounting retry produces one journal entry per settlement version.
- Branch/rate/COD mismatch is blocked or routed to admin review.

## 13. Change Tracker

Use this section for implementation updates. Each entry should include date, owner, files/migration, behavior changed, tests, and remaining risks.

| Date | Phase | Change | Verification | Status |
| --- | --- | --- | --- | --- |
| 2026-09-16 | Planning | Added this delivery automation design and implementation checklist. No runtime code changed. | Document review pending | PLANNED |
| 2026-09-16 | Foundation / Vertical Slice 1 | Added delivery/NCM persistence, guarded manufacturer handoff, server-side NCM client, webhook ingestion, status reconciliation, customer-safe tracking, admin delivery endpoints, return request plumbing, and compatibility routes for the existing manufacturer portal. | Prisma validation/migrations, backend syntax checks, manufacturer production build, and 3 focused delivery tests passed. | IMPLEMENTED |
| 2026-09-16 | Webhooks | Added dedicated NCM Order Delivery and Order Comment webhook URLs, authenticated callback processing, idempotent comment storage, and unknown-order comment retention. | Prisma migration, backend build, syntax checks, and delivery tests passed. | IMPLEMENTED |

## 14. Recommended First Implementation Slice

After the decisions in Phase 0, implement only the foundation plus one vertical slice for a single manufacturer: `READY_TO_DELIVER -> NCM_CREATED -> webhook/poll status -> customer timeline`. Do not begin returns or automated financial settlement until the create/reconciliation path has passed timeout, duplicate, and ownership tests. Then add physical return inspection and COD settlement as separate vertical slices.