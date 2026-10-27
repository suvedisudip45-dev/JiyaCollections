# Security, Data Flow, and UI Audit

**Review basis:** static repository review on 2026-10-05. No production deployment, live database, payment-provider account, messaging provider, or customer records were accessed. This is an engineering review, not a forensic conclusion that a security breach has or has not occurred.

## 1. High-level data flows

### Admin and privileged-portal sign-in

1. The portal login UI submits an identifier and password to the backend. Some UIs AES-encrypt the password using Vite environment values before sending it.
2. The backend resolves the credential, finds the account in MySQL through Prisma, and checks the stored password hash, portal role, and account status. Privileged roles always require a bounded MFA challenge. If `NOTIFICATIONS_ENABLED` or every eligible delivery method is disabled, privileged login cannot complete; production must configure and verify the notification worker and a delivery channel.
3. The user selects an email or SMS delivery method. The code is queued through the notification subsystem; the challenge stores a keyed hash, expiry, attempt count, and delivery metadata rather than the plaintext code.
4. Successful verification consumes the challenge once and creates access/refresh sessions. The refresh token is issued as an HttpOnly cookie; portal code stores the access token in browser local storage.
5. Authentication history is written to `AuthAuditLog`. Privileged authentication and unsuccessful authentication events are also enqueued for `SystemAuditLog`, with request correlation IDs when available.

### SMS password recovery

1. Customer, manufacturer, and distributor portals submit the login email, phone number, and portal to the public recovery endpoint. Both identifiers must match the same active account, and its primary role and active profile must match the selected portal; alternate workspace roles cannot be used for cross-portal recovery. If they do not, the API returns the corresponding customer, manufacturer, or distributor not-found message; this intentionally discloses portal eligibility to help users identify the correct login portal.
2. For an eligible account, before issuing an OTP or queuing an SMS, the backend atomically enforces one password-reset request per rolling seven days and at most three requests per UTC calendar month. Limit violations return HTTP 429 without creating a challenge or sending SMS. Allowed requests create a bounded `PASSWORD_RESET` challenge and queue only an encrypted SMS payload. No email recovery is provided.
3. OTP challenges expire and allow a configured number of attempts (`PASSWORD_RESET_MAX_ATTEMPTS`, default 5). Successful verification consumes the OTP and returns a random TFA token whose lifetime is controlled by `PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES` (default 5); the backend persists only its keyed hash.
4. Password completion requires the TFA token, matching confirmation, and a single-use conditional state transition. It updates the bcrypt password hash and revokes all current sessions atomically, then the user returns to ordinary login.
5. OTP verification, TFA token, and password values are not written to audit metadata. Password recovery retains the fixed code `111111` only in `development` and `test` at the user's request. The request, verification, and completion operations return HTTP 503 in staging, production, and unspecified environments until random per-challenge OTPs are implemented and verified.

### Customer checkout and fulfillment

1. The storefront requests product, cart, and quote data from the API.
2. Backend services validate current products, prices, location pricing, discounts, card/loyalty eligibility, and inventory; the client is not authoritative for final price or eligibility.
3. Order placement writes the order and applicable reservations/financial state through backend services and Prisma transactions.
4. Online customer fulfillment is assigned to an active, area-matched distributor and updates distributor-ledger inventory. Manufacturer production and replenishment remain separate workflows. Distributor hub actions (direct orders, hub inventory, gift stock, and physical marketing-card stock) require distributor permissions and authenticated distributor context; direct-order stock deductions and gift/card ownership checks are backend-enforced.
5. Delivery booking and state reconciliation flow through the delivery service and NCM integration/webhooks. Returns and exchanges use approval, inspection, refund/replacement, and carrier workflows; relevant decisions and state changes are audited.
6. Admin NCM tools call the server-side client only after delivery permissions are checked. Mutating operations enqueue redacted audit metadata; customer/contact and bank payloads are not logged. The client retries read-only GET requests on bounded 5xx responses, but does not automatically retry POST operations because their carrier outcome can be ambiguous. Ticket summaries and latest activity are persisted in `NcmSupportTicket` after successful create/detail/reply/close operations; the permission-protected active/closed list reads only this table and does not call NCM.

When notifications and SMS are enabled, distributor self-delivery COD is gated by a hashed, expiring, order/distributor/amount-bound OTP before delivery and sale-accounting enqueue. If either setting is disabled, delivery requires an explicit distributor confirmation of collection and records the collection event as pending verification, not OTP-verified. The sale posts to distributor receivable (1190), not company cash. A distributor remittance remains pending until Admin review; verification atomically rechecks available receivable, records treasury inflow, creates the journal/cash transaction, and allocates the subledger document. Distributor-paid refunds use the inverse control: exact Admin-approved amount, distributor evidence submission, explicit Admin verification, and a distinct distributor payable (2190). Rejected evidence cannot post accounting; Admin payout is separately authorized, idempotent, balance-checked, and allocated to that payable. Gross AR/AP are only offset after explicit Admin approval; the amount is capped by open verified balances less pending remittance reservations and posts a balanced journal with allocations to both subledgers and a transactional audit record. The distributor profile is taken from authenticated workspace context for distributor actions.

### Marketing partner reporting

Partner analytics use a dedicated admin permission and partner-scoped parameterized aggregate queries. Customer scan geography is copied at scan time as province and district from the first saved address; street-level address values and customer identity are excluded from analytics responses. Existing scans without a location snapshot are grouped as unknown rather than backfilled from a later, mutable customer address.

### Product sales analytics

Admin product reports require the ADMIN role and `product:sales_analytics_read`. Admin-only comparison charts return bounded product, location, and distributor aggregates, including item revenue and estimated gross product profit. Profit is item revenue minus recorded item COGS and completed refunds; it excludes delivery and general operating expenses. Historical production allocations and accepted item COGS snapshots are preferred, with existing item/product cost fallbacks; the API reports uncosted quantities so estimates with incomplete cost coverage are not presented as fully costed. Distributor reports require `distributor:product_sales_read`; the server derives the distributor ID from authenticated workspace context and the shared aggregate service omits revenue fields (including rejecting revenue sorting). Date ranges, product IDs, sort keys, and pagination are validated on the server. The API returns bounded aggregates only, not raw orders or customer identities; location grouping exposes only province and district. Sales use order-item price/quantity snapshots and order date, while return activity uses completed refund item snapshots and refund completion date.

### Admin changes and audit review

1. The admin UI calls protected `/api/admin/...` routes with the access token.
2. `authenticate` validates the session and portal identity; `authorize` resolves the required server-side permission before the controller/service performs the operation.
3. Business mutations that support transactional auditing enqueue `SystemAuditOutbox` rows with the business write. The background worker persists them idempotently in `SystemAuditLog`.
4. Authorized administrators use `/api/admin/access/audit-logs` and its export endpoint. The UI supports pagination, filters, event details, and CSV export.

## 2. Event records and interpretation

The audit history now includes:

- Business changes already covered by the system audit outbox: access/role management, product and inventory changes, order assignment/fulfillment, and return/refund decisions.
- Authentication failures, account lock/block events, privileged-portal sign-in/MFA milestones, and refresh-token reuse detections.
- Admin password-change success and incorrect-current-password events, without storing password values or hashes.
- Authentication rate-limit denials, deduplicated per identifier/IP/portal/code during the limiter window.
- Authenticated RBAC permission denials, including the requested permission codes, method, path without query parameters, actor, and correlation ID.

Events with entity type `SecurityEvent` are **signals for review**, not proof of account compromise or a confirmed breach. A failed login or denied permission can be legitimate user error. The current system does not provide automated incident classification, alert delivery, or forensic attribution.

Hub inventory and promotions are distributor-owned. Distributor routes must derive the acting profile from authenticated workspace context rather than accepting a client-supplied distributor ID. Direct hub-order deductions must remain within the distributor's ledger-backed stock; gift allocation acceptance and order reservation are scoped to that distributor; marketing-card assignment, receipt, and attachment are distributor-scoped. Legacy manufacturer-owned stock records are historical and are not valid fallbacks for distributor inventory.

Payment evidence URLs are HTTPS-only and are displayed to Admin reviewers, but the platform has no direct bank/wallet reconciliation integration for these transfers. An uploaded receipt or distributor-entered cash-refund record is not independent proof of settlement. For physical cash refunds and bank remittances, production operations must reconcile the submitted proof against bank/cash records and, when needed, independently confirm the customer received the refund before Admin verification. This human verification remains a residual fraud control, not an automated guarantee.

The Admin Audit History screen supports filtering by result (`SUCCESS`, `FAILED`, `BLOCKED`), actor, entity, action, date, and text search. Red/amber/green result styling distinguishes blocked/failed/success events. The UI explicitly warns that failed or blocked events alone do not establish a breach.

### Deliberate limits

- Routine read-only page views and every API request are not copied into the audit log. Capturing all reads would create high volume and could expose sensitive usage patterns; use structured request logs and targeted access telemetry for that purpose.
- Credentials, OTP values, tokens, and full request bodies are not audit event fields. Existing authentication storage may retain an identifier in its separate `AuthAuditLog`; avoid exporting that table broadly.
- `ADMIN_2FA_DEVELOPMENT_OTP` is an optional fixed value for Admin MFA in local development only; it is accepted only when `NODE_ENV=development` and rejected in other environments. Other privileged portals continue to receive random codes. With the variable absent, Admin send and resend also use random codes.
- Password recovery retains fixed OTP `111111` only in `development` and `test` at the user's request. Staging, production, and unspecified environments are gated with HTTP 503 until random per-challenge OTPs are implemented and verified. The flow still requires `OTP_SERVER_SECRET` and the outbound SMS notification subsystem, and the notification worker must remain operational.
- IP and user-agent context can be personal data. Define access controls and a retention schedule before enabling production collection at scale.
- Audit rows are append-only by application convention, not cryptographically immutable against a database administrator. Production-grade tamper evidence requires separate restricted storage or an independently controlled archive.
- The in-memory auth limiter is per backend process. Durable denial events improve observability but do not make the limiter distributed across replicas.

## 3. Security findings and recommended work

| Priority | Finding | Recommendation |
| --- | --- | --- |
| Critical if publicly reachable | Password-recovery OTP remains fixed to `111111` in development and test. Other environment names, including staging, production, and unset `NODE_ENV`, fail closed with HTTP 503. | Keep recovery disabled outside development/test until random OTP generation, expiry/attempt limits, and the actual SMS-delivery path pass staging tests. |
| High | Privileged MFA was previously bypassed when `NOTIFICATIONS_ENABLED=false`. MFA is now enforced independently of that flag; the setting disables privileged sign-in rather than permitting password-only sessions. | Configure and verify the notification worker and delivery channels before enabling privileged production access. |
| High | `VITE_AES_KEY` and `VITE_AES_IV` are bundled into browser code. A browser-delivered key is not a secret; client-side AES must not be treated as protection for a password or API request. | Enforce HTTPS and use a coordinated migration to standard TLS-only credential submission. Remove the custom client encryption contract only after all portal clients and the server have been updated and tested. |
| High | Access tokens are stored in local storage in the portal token helpers. XSS could expose a bearer token. | Reduce XSS risk with a restrictive Content Security Policy and dependency hygiene; plan a migration to short-lived in-memory access tokens and an HttpOnly refresh/session design. |
| High if misconfigured | A fixed OTP for Admin MFA is permitted only by setting `ADMIN_2FA_DEVELOPMENT_OTP` with `NODE_ENV=development`. The service rejects that setting for any other environment; production must not carry the variable. | Use random codes by default. Keep the fixed value only in an untracked, local development environment and verify the variable is absent from staging/production secrets. |
| Medium | Authentication rate-limit state is held in per-process `Map`s and resets on restart. | Use a shared limiter (for example, Redis) or equivalent gateway enforcement before horizontal scaling; honor trusted-proxy configuration when deriving client IPs. |
| Medium | Authentication, RBAC-denial, and rate-limit events that occur outside a business transaction are queued asynchronously to preserve response latency. A process failure before the enqueue completes can lose an event. | Monitor queue/worker health, retain host logs, and decide whether high-severity events need a durable synchronous path or external security event sink. |
| Medium | The audit outbox retries failures, but production alerting, retention, and archival are not configured by this code change. | Alert on sustained `PENDING`/`FAILED` rows and worker inactivity; define retention, archival, and restricted audit-reader roles. |
| Follow-up | UI filters expose technical entity/action values and do not yet provide a dedicated incident queue or aggregate trends. | Add an incident-focused view only after event taxonomy, triage ownership, thresholds, and alert expectations are agreed. Keep the existing audit table as the source of individual event detail. |

These observations are based on source code, not a penetration test or production configuration review. In particular, this review does not establish whether any real account, payment, or customer data was accessed improperly.

## 4. Deployment and operational checklist

- Customer disable is enforced through the retained `User.isDisabled` flag, CUSTOMER workspace validation on login/access/refresh, revoked sessions, and registration/profile-activation checks. The action is gated by `customer:account_manage` and recorded through the system-audit outbox.
- The admin customer search requires an explicit query; customer records are not loaded into the page before search. Customer notification history is matched to stored contact addresses, excludes authentication/verification messages, and returns only selected message text rather than raw payloads.
- Apply the audit/outbox Prisma migration and regenerate Prisma Client.
- Run the RBAC seed so `access:audit_read` is assigned as intended; verify the actual production role mappings rather than assuming seed state.
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
