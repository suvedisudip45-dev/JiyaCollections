# Security, Data Flow, and UI Audit

**Review basis:** static repository review on 2026-10-05. No production deployment, live database, payment-provider account, messaging provider, or customer records were accessed. This is an engineering review, not a forensic conclusion that a security breach has or has not occurred.

## 1. High-level data flows

### Portal API request-signature verification

The customer, admin, manufacturer, and marketing portals attach the documented legacy compatibility signature to `/api` requests. Backend middleware verifies the signature before sanitization and route dispatch; missing/mismatched signatures are rejected, and an unset backend `HMAC_SECRET` fails closed. The JSON parser retains raw request text for verification, while an absent HTTP entity remains distinct from an explicitly sent JSON `{}`. Structured diagnostics record request metadata and signature lengths for failures, but never log the secret, signature contents, authorization headers, or body. HMAC failures do not trigger access-token refresh retries in portal interceptors. NCM webhook receiver routes remain excluded and continue using their dedicated verification. Because Vite exposes `VITE_HMAC_SECRET` in the browser bundle, this compatibility check must not be treated as a confidential authentication factor or a replacement for JWT/RBAC controls.

### Admin and privileged-portal sign-in

1. The portal login UI submits an identifier and password to the backend. Some UIs AES-encrypt the password using Vite environment values before sending it.
2. The backend resolves the credential, finds the account in MySQL through Prisma, and checks the stored password hash, portal role, and account status. Privileged roles require a bounded MFA challenge when backend `MFA_ENABLED=true` (the default). If MFA is enabled but `NOTIFICATIONS_ENABLED` or every eligible delivery method is disabled, privileged login cannot complete; production must configure and verify the notification worker and a delivery channel.
3. The user selects an email or SMS delivery method. The code is queued through the notification subsystem; the challenge stores a keyed hash, expiry, attempt count, and delivery metadata rather than the plaintext code.
4. Successful verification consumes the challenge once and creates access/refresh sessions. The refresh token is issued as an HttpOnly cookie; portal code stores the access token in browser local storage.
5. Authentication history is written to `AuthAuditLog`. Privileged authentication and unsuccessful authentication events are also enqueued for `SystemAuditLog`, with request correlation IDs when available.

### SMS password recovery

1. Customer, manufacturer, distributor, and driver portals submit the login email, phone number, and portal to the public recovery endpoint. Both identifiers must match the same active account, and its primary role and active profile must match the selected portal; driver recovery additionally requires an active linked driver and active distributor. Alternate workspace roles cannot be used for cross-portal recovery. Eligible and ineligible requests return the same generic response shape and message; no account-eligibility details are returned.
2. Allowed requests create a bounded `PASSWORD_RESET` challenge and queue an encrypted SMS payload. OTPs are eight digits generated with `crypto.randomInt`; only an HMAC-SHA256 hash bound to the challenge ID and password-reset purpose is persisted. Account quotas (one request per rolling seven days and three per UTC month) suppress challenge creation while retaining the generic response. IP limits return HTTP 429. No email recovery is provided.
3. OTP challenges expire and allow a configured number of attempts (`PASSWORD_RESET_MAX_ATTEMPTS`, default 5). Resends use the same challenge, invalidate the prior code, and are limited by a cooldown and bounded resend count (`PASSWORD_RESET_RESEND_COOLDOWN_SECONDS`, default 60; `PASSWORD_RESET_MAX_RESENDS`, default 3). Conditional transactional updates enforce single-use verification and attempt limits. Successful verification returns a random 32-byte TFA token whose lifetime is controlled by `PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES` (default 5); the backend persists only its keyed hash.
4. Password completion requires the TFA token, matching confirmation, and a single-use conditional state transition. It updates the bcrypt password hash and revokes all current sessions atomically, then the user returns to ordinary login.
5. OTP verification, TFA token, and password values are not written to audit metadata. Password-reset challenges use a distinct purpose and HMAC domain from portal MFA; neither flow accepts the other flow's code. Recovery is available in development/test for supported portals. Driver production recovery remains off by default and requires an explicit feature flag plus complete configuration; admin driver provisioning remains blocked pending verified production SMS delivery, shared rate limiting, and an operational recovery procedure.

### Customer checkout and fulfillment

1. The storefront requests product, cart, and quote data from the API.
2. Backend services validate current products, prices, location pricing, discounts, card/loyalty eligibility, and inventory; the client is not authoritative for final price or eligibility. Scanned and claimed Own Store percentage discounts and fixed-value vouchers are revalidated at checkout; vouchers reduce product subtotal only and are capped at that subtotal.
3. Order placement writes the order and applicable reservations/financial state through backend services and Prisma transactions.
4. Online customer fulfillment is assigned to an active, area-matched distributor and updates distributor-ledger inventory. Manufacturer production and replenishment remain separate workflows. Distributor hub actions (direct orders, hub inventory, gift stock, and physical marketing-card stock) require distributor permissions and authenticated distributor context; direct-order stock deductions and gift/card ownership checks are backend-enforced. Gift assignment is limited to accepted, acknowledged stock belonging to distributors already assigned to the checkout; one gift can be attached per checkout group.
5. Delivery booking and state reconciliation flow through the delivery service and NCM integration/webhooks. Returns and exchanges use approval, inspection, refund/replacement, and carrier workflows; relevant decisions and state changes are audited.
6. Admin NCM tools call the server-side client only after delivery permissions are checked. Mutating operations enqueue redacted audit metadata; customer/contact and bank payloads are not logged. The client retries read-only GET requests on bounded 5xx responses, but does not automatically retry POST operations because their carrier outcome can be ambiguous. Ticket summaries and latest activity are persisted in `NcmSupportTicket` after successful create/detail/reply/close operations; the permission-protected active/closed list reads only this table and does not call NCM.

When notifications and SMS are enabled, distributor self-delivery COD is gated by a hashed, expiring, order/distributor/amount-bound OTP before delivery and sale-accounting enqueue. If either setting is disabled, delivery requires an explicit distributor confirmation of collection and records the collection event as pending verification, not OTP-verified. The sale posts to distributor receivable (1190), not company cash. A distributor remittance remains pending until Admin review; verification atomically rechecks available receivable, records treasury inflow, creates the journal/cash transaction, and allocates the subledger document. Distributor-paid refunds use the inverse control: exact Admin-approved amount, distributor evidence submission, explicit Admin verification, and a distinct distributor payable (2190). Rejected evidence cannot post accounting; Admin payout is separately authorized, idempotent, balance-checked, and allocated to that payable. Gross AR/AP are only offset after explicit Admin approval; the amount is capped by open verified balances less pending remittance reservations and posts a balanced journal with allocations to both subledgers and a transactional audit record. The distributor profile is taken from authenticated workspace context for distributor actions.

Driver access uses an isolated `DRIVER` portal scope with only
`driver:delivery_read` and `driver:delivery_complete`. An active linked driver
cannot switch into manufacturer or distributor workspaces. `/api/driver`
manifest reads filter by the authenticated driver and distributor; stop actions
also verify the manifest assignment and self-delivery assignment server-side.
The driver OTP endpoint is stop-scoped, and private evidence is retrieved only
through the authenticated evidence route. COD, inventory, and accounting remain
inside their existing canonical backend workflows. Admin account provisioning
requires `access:driver_users_manage`, links only an existing active unlinked
driver, creates no reusable/shared password, and is audited without logging
credentials. Driver accounts require MFA like other privileged workspaces.

### Driver offline delivery data

The driver portal keeps a minimal assigned-manifest snapshot and unsent POD
drafts in browser IndexedDB, partitioned by account, driver, and distributor.
Address/contact fields needed for delivery and photo/signature evidence are
stored locally; the browser database is not application-encrypted, so device
access controls remain part of the privacy boundary. Access tokens, OTP values,
COD amounts, and private evidence URLs are not stored there. The offline cache
is presentation/draft data only: it never authorizes an API request, confirms a
payment, or changes server state. On reconnect, the dedicated driver endpoint
revalidates current assignment and reuses the canonical completion service.
COD delivery completion stays online-only. The service worker caches the
application shell/static assets and excludes API responses. Confirmed local
copies expire after 30 days; queued/conflicted drafts remain until explicitly
cleared. Drivers on shared devices should clear local data after reconciliation.

### Marketing partner reporting

Partner analytics use a dedicated admin permission and partner-scoped parameterized aggregate queries. Customer scan geography is copied at scan time as province and district from the first saved address; street-level address values and customer identity are excluded from analytics responses. Existing scans without a location snapshot are grouped as unknown rather than backfilled from a later, mutable customer address.

### Product sales analytics

Admin product reports require the ADMIN role and `product:sales_analytics_read`. Admin-only comparison charts return bounded product, location, and distributor aggregates, including item revenue and estimated gross product profit. Profit is item revenue minus recorded item COGS and completed refunds; it excludes delivery and general operating expenses. Historical production allocations and accepted item COGS snapshots are preferred, with existing item/product cost fallbacks; the API reports uncosted quantities so estimates with incomplete cost coverage are not presented as fully costed. Distributor reports require `distributor:product_sales_read`; the server derives the distributor ID from authenticated workspace context and the shared aggregate service omits revenue fields (including rejecting revenue sorting). Date ranges, product IDs, sort keys, and pagination are validated on the server. The API returns bounded aggregates only, not raw orders or customer identities; location grouping exposes only province and district. Sales use order-item price/quantity snapshots and order date, while return activity uses completed refund item snapshots and refund completion date.

### Admin changes and audit review

1. The admin UI calls protected `/api/admin/...` routes with the access token.
2. `authenticate` validates the session and portal identity; `authorize` resolves the required server-side permission before the controller/service performs the operation.
3. Business mutations that support transactional auditing enqueue `SystemAuditOutbox` rows with the business write. The background worker persists them idempotently in `SystemAuditLog`.
4. Authorized administrators use `/api/admin/access/audit-logs` and its export endpoint. The UI supports pagination, filters, event details, and CSV export.
5. RBAC seeding requires `ADMIN_EMAIL` to identify the designated owner account: only that active Admin receives the built-in broad `ADMIN` role. Other Admin accounts retain custom Admin role mappings, while any mapping to the built-in full role is deactivated and audited. Review role assignments and back up existing data before running the updated seed in a deployed environment.

### Portal notification inbox

The separate `/api/portal-notifications` API authenticates every request and
requires the active `ADMIN`, `MANUFACTURER`, or `DISTRIBUTOR` workspace role.
List, unread-count, and mark-read queries bind both the recipient account ID
and active role from `req.auth`; a notification cannot be read or changed by a
different account or by switching to another workspace on a dual-role account.
Admin fan-out resolves active Admin role mappings server-side. The inbox does
not reuse outbound SMS/email notification payloads and does not expose
notification content through the customer or Marketing Partner portals.

The `all:function` permission is a server-side authorization bypass and must remain excluded from ordinary Admin roles. Generic journal reversal is limited to reasoned, authenticated reversals of `MANUAL_JOURNAL` entries, with the reversal posting, original status update, and audit-outbox event in one transaction. Source-backed payment/accounting journals must be corrected by their originating business workflow so operational cash, Treasury, settlement, and subledger records are not left out of sync.

Payable/receivable corrections and NCM remittance-batch corrections are source-aware workflows, not generic journal edits. They require an authenticated Admin, a correction mode, a reason, and an external evidence reference; their source balances, treasury movements, journals, linked accounting-document allocations, and audit records are updated atomically. Marketing CPA payout correction is restricted to the selected settled payout with verified returned-funds evidence; it restores the bill and Treasury, records a reversal allocation, reverses the payout journal, and marks the payout reversed. It cannot void a confirmed transfer or proceed while another CPA payout is initiated. NCM corrections also restore captured delivery settlement states, cancel the batch-only fee/suspense documents, retain reversed resolution history, and allow a corrected delivery to be settled again. Historical NCM batches without a captured prior delivery state fail closed for manual reconciliation.

Collaboration-fee credit application is a finance-permission-protected receivable offset, guarded by `finance:receivable_collect`. The backend verifies the credit note and target invoice against the same marketing-partner identity, currency, dates, source invoice records, and posted 1130 journals. It atomically updates both open document balances, records paired allocations against the existing credit journal, and writes a system-audit record; it does not issue a cash refund or a second journal. A separate mapped-Treasury payout workflow is required before any partner credit can be refunded.

Monthly period close uses distinct `accounting:period_close_submit` and
`accounting:period_close_review` permissions; reopen request and review also
have separate permissions. The backend rejects self-review, requires a reason
for rejected/reopen actions, and commits the period status change, sequenced
close-event snapshot, and system-audit outbox row atomically. Direct legacy
period toggles are rejected, and fiscal-year close/reopen require the monthly
approval trail. Checklist evidence references are user-entered identifiers,
not independently validated source documents.

The separate accounting action queue records normalized payloads/hashes,
maker/checker identities, sequenced decisions, and transactional audit-outbox
events. Current code gates manual journals, opening balances, reversals, COA
and Treasury setup, VAT actions, fixed-asset write-offs, distributor refund
payouts/netting, settlement corrections, NCM remittance/variance actions,
supplier-return postings, manufacturer and collaboration credit applications,
loan repayments, and share buybacks. Rejected or pending requests do not execute
the underlying mutation; supplier-return inventory and accounting effects are
also deferred until independent approval. This is an internal control only; it
is not statutory or CA approval. The user reports migrations through Phase 6
applied to a local/shared development database; this has not been independently
verified and does not establish isolated-database UAT/recovery evidence.
Route-by-route bypass verification, a reproducible signed close pack, and
Finance/management review remain outstanding. Review the actual deployed role
mappings, MFA/admin access, export restrictions, and audit retention before
relying on the controls.

## 2. Event records and interpretation

The audit history now includes:

- Business changes already covered by the system audit outbox: access/role management, product and inventory changes, order assignment/fulfillment, and return/refund decisions.
- Admin-selected distributor assignment for failed online orders is permission-protected (`order:control`), reason-required, and audited transactionally with the stock reservation. The endpoint rejects already assigned or advanced orders and never uses an unverified delivery-state override.
- The `order:control` detail endpoint exposes only bounded operational histories: up to 30 delivery events, 10 carrier attempt summaries (excluding request/response payloads), 20 cash-event summaries, and 50 order audit entries. It does not cache mutable order or carrier state.
- Admin cancellation requires an audit reason and reuses the established cancellation transaction to release stock, gifts, card reservations, assignment state, and product availability. It is pre-carrier-handoff only; ambiguous NCM submissions block it, and paid orders are redirected to the refund workflow instead of being marked cancelled without accounting.
- Authentication failures, account lock/block events, privileged-portal sign-in/MFA milestones, and refresh-token reuse detections.
- Admin password-change success and incorrect-current-password events, without storing password values or hashes.
- Authentication rate-limit denials, deduplicated per identifier/IP/portal/code during the limiter window.
- Authenticated RBAC permission denials, including the requested permission codes, method, path without query parameters, actor, and correlation ID.

Events with entity type `SecurityEvent` are **signals for review**, not proof of account compromise or a confirmed breach. A failed login or denied permission can be legitimate user error. The current system does not provide automated incident classification, alert delivery, or forensic attribution.

Hub inventory and promotions are distributor-owned. Distributor routes must derive the acting profile from authenticated workspace context rather than accepting a client-supplied distributor ID. Direct hub-order deductions must remain within the distributor's ledger-backed stock; gift receipt counts and order reservation are scoped to that distributor; marketing-card assignment, receipt, and attachment are distributor-scoped. Admin gift replacement must maintain exact reward value and same-distributor ownership and is blocked once packing starts. Legacy manufacturer-owned stock records are historical and are not valid fallbacks for distributor inventory.

Payment evidence URLs are HTTPS-only and are displayed to Admin reviewers, but the platform has no direct bank/wallet reconciliation integration for these transfers. An uploaded receipt or distributor-entered cash-refund record is not independent proof of settlement. For physical cash refunds and bank remittances, production operations must reconcile the submitted proof against bank/cash records and, when needed, independently confirm the customer received the refund before Admin verification. This human verification remains a residual fraud control, not an automated guarantee.

The Admin Audit History screen supports filtering by result (`SUCCESS`, `FAILED`, `BLOCKED`), actor, entity, action, date, and text search. Red/amber/green result styling distinguishes blocked/failed/success events. The UI explicitly warns that failed or blocked events alone do not establish a breach.

### Deliberate limits

- Routine read-only page views and every API request are not copied into the audit log. Capturing all reads would create high volume and could expose sensitive usage patterns; use structured request logs and targeted access telemetry for that purpose.
- Credentials, OTP values, tokens, and full request bodies are not audit event fields. Existing authentication storage may retain an identifier in its separate `AuthAuditLog`; avoid exporting that table broadly.
- `ADMIN_2FA_DEVELOPMENT_OTP` is an optional fixed value for Admin MFA in local development only; it is accepted only when `NODE_ENV=development` and rejected in other environments. Other privileged portals continue to receive random codes. With the variable absent, Admin send and resend also use random codes.
- Driver production recovery is default-off. Even with the opt-in flag and required environment settings, production readiness is not established: the documented SMS endpoint is HTTP, provider delivery has not been verified, the IP limiter is process-local, and no complete recovery operations procedure has been exercised. Keep driver provisioning blocked until these prerequisites are closed.
- IP and user-agent context can be personal data. Define access controls and a retention schedule before enabling production collection at scale.
- Audit rows are append-only by application convention, not cryptographically immutable against a database administrator. Production-grade tamper evidence requires separate restricted storage or an independently controlled archive.
- The in-memory auth limiter is per backend process. Durable denial events improve observability but do not make the limiter distributed across replicas.

## 3. Security findings and recommended work

| Priority | Finding | Recommendation |
| --- | --- | --- |
| High | Driver recovery has a random, challenge-bound OTP implementation, but production delivery and distributed abuse controls are not verified; driver recovery is default-off and admin provisioning remains blocked. | Keep the opt-in disabled until HTTPS SMS delivery, shared/gateway rate limiting, staging end-to-end checks, and an operational recovery procedure are verified. |
| High | Privileged MFA enforcement is controlled by backend `MFA_ENABLED` and defaults to enabled. Setting it to `false` intentionally permits password-only sign-in for privileged portals; notification settings do not implicitly bypass MFA. | Keep MFA enabled in production unless password-only privileged access is an explicitly accepted policy; configure and verify the notification worker and delivery channels. |
| High | `VITE_AES_KEY` and `VITE_AES_IV` are bundled into browser code. A browser-delivered key is not a secret; client-side AES must not be treated as protection for a password or API request. | Enforce HTTPS and use a coordinated migration to standard TLS-only credential submission. Remove the custom client encryption contract only after all portal clients and the server have been updated and tested. |
| High | Access tokens are stored in local storage in the portal token helpers. XSS could expose a bearer token. | Reduce XSS risk with a restrictive Content Security Policy and dependency hygiene; plan a migration to short-lived in-memory access tokens and an HttpOnly refresh/session design. |
| High if misconfigured | A fixed OTP for Admin MFA is permitted only by setting `ADMIN_2FA_DEVELOPMENT_OTP` with `NODE_ENV=development`. The service rejects that setting for any other environment; production must not carry the variable. | Use random codes by default. Keep the fixed value only in an untracked, local development environment and verify the variable is absent from staging/production secrets. |
| Medium | Authentication rate-limit state is held in per-process `Map`s and resets on restart. | Use a shared limiter (for example, Redis) or equivalent gateway enforcement before horizontal scaling; honor trusted-proxy configuration when deriving client IPs. |
| Medium | Driver offline snapshots include delivery contact/address details and POD evidence in browser IndexedDB, which is not encrypted by the application and may remain on a shared device until cleared. | Use protected device/browser profiles, clear local driver data after reconciliation, and avoid using shared or unmanaged devices for offline delivery work. |
| Medium | Authentication, RBAC-denial, and rate-limit events that occur outside a business transaction are queued asynchronously to preserve response latency. A process failure before the enqueue completes can lose an event. | Monitor queue/worker health, retain host logs, and decide whether high-severity events need a durable synchronous path or external security event sink. |
| Medium | The audit outbox retries failures, but production alerting, retention, and archival are not configured by this code change. | Alert on sustained `PENDING`/`FAILED` rows and worker inactivity; define retention, archival, and restricted audit-reader roles. |
| Follow-up | UI filters expose technical entity/action values and do not yet provide a dedicated incident queue or aggregate trends. | Add an incident-focused view only after event taxonomy, triage ownership, thresholds, and alert expectations are agreed. Keep the existing audit table as the source of individual event detail. |

These observations are based on source code, not a penetration test or production configuration review. In particular, this review does not establish whether any real account, payment, or customer data was accessed improperly.

## 4. Deployment and operational checklist

- Customer disable is enforced through the retained `User.isDisabled` flag, CUSTOMER workspace validation on login/access/refresh, revoked sessions, and registration/profile-activation checks. The action is gated by `customer:account_manage` and recorded through the system-audit outbox.
- The admin customer search requires an explicit query; customer records are not loaded into the page before search. Customer notification history is matched to stored contact addresses, excludes authentication/verification messages, and returns only selected message text rather than raw payloads.
- Apply the audit/outbox Prisma migration and regenerate Prisma Client.
- Run the RBAC seed so `access:audit_read` and `access:audit_export` are assigned as intended; verify the actual production role mappings rather than assuming seed state.
- Apply the product sales analytics migration before deployment and run the RBAC seed to grant `product:sales_analytics_read` to Admins and `distributor:product_sales_read` to distributors; verify no distributor permission grants revenue access.
- Configure and test `OTP_SERVER_SECRET`, outbound notification credentials, HTTPS, trusted proxy behavior, and allowed frontend origins outside source control.
- Verify the outbox worker starts, completes a test event, retries a forced transient error, and exposes pending/failed counts to monitoring.
- Check production schema compatibility and take a backup before migration. Use an isolated staging database first.
- Run a controlled MFA, rate-limit, RBAC-denial, admin-change, and export test in staging. Confirm no OTP, password, token, or full payload appears in logs or exports.
- Agree on who reviews security signals, escalation thresholds, audit data retention, and incident-response steps. Do not label a signal a breach without investigation.

## 5. User-interface update requirements

### Delivered

- Audit History includes result filtering, outcome styling, security-signal context, and an explicit non-breach disclaimer.
- Individual records expose actor/system identity, portal source, IP/user-agent, correlation ID, failure reason, and before/after state, subject to audit permissions.

### Recommended next

1. Make event names and entity types human-readable while retaining the raw action for support/export.
2. Add preset filters for security signals, privileged sign-ins, and business changes.
3. Add an incident-review workflow (owner, disposition, notes, resolution timestamp) only with a defined permission and retention model.
4. Provide a clear empty/error state and operational link for audit worker health; do not imply that an empty list proves there were no security incidents.
5. Validate responsive/table accessibility, date/time-zone display, and export safeguards in each supported admin browser.
