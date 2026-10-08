# Architecture and Backend Reference

## 1. System Architecture

The application is structured as a distributed e-commerce platform with a central API server and multiple portal clients:

```text
Customer storefront (frontend/)        Admin portal (admin/)       Manufacturer portal (manufacturer/)
        |                                      |                                 |
        |-- HTTP REST requests ---------------->|-------------------------------|
                                                    |
                                            Node.js + Express backend (backend/)
                                                    |
                                      MySQL database via Prisma ORM
                                                    |
                                Cloudinary / payment / NCM / notification integrations
```

### Core runtime flow

1. The client application authenticates via the backend and stores tokens in local storage.
2. A frontend calls backend routes under `/api/*`.
3. The backend validates JWTs, resolves RBAC permissions, and executes business services.
4. Prisma queries and writes are performed against MySQL.
5. Domain services coordinate side effects such as order assignment, delivery handoff, manufacturer inventory updates, or marketing-card redemption.

## 2. Backend Directory Layout

| Path | Purpose |
| --- | --- |
| `backend/server.js` | Starts Express, configures middleware, mounts route groups |
| `backend/config/` | DB, CORS, Cloudinary, JWT validation, environment config |
| `backend/controllers/` | HTTP request handlers for auth, products, orders, accounting, delivery, returns |
| `backend/routes/` | Router definitions grouped by domain |
| `backend/services/` | Domain logic, RBAC, token generation, delivery/NCM reconciliation, accounting engine |
| `backend/middleware/` | Auth, sanitization, rate limiting, request-level RBAC |
| `backend/security/` | MFA policies and security-specific code |
| `backend/prisma/schema.prisma` | Canonical database schema |
| `backend/tests/` | Regression tests for order exchange, delivery automation, marketing-card security |
| `backend/notifications/` | Standalone notification worker documentation and setup |

## 3. API Routing Summary

The backend mounts the following major route groups in `backend/server.js`:

| Prefix | Domain |
| --- | --- |
| `/api/auth` | Login, refresh, MFA, OTP, logout |
| `/api/admin/access` | Access management and RBAC control |
| `/api/admin/manufacturer-locations` | Province/district coverage for manufacturers used in local pricing |
| `/api/admin/location-discounts` | Dynamic product discounts by province/district and admin overrides |
| `/api/admin/gifts` | Gift catalog, spend-rule configuration, distributor distributions, and admin return review |
| `/api/distributor/gifts` | Distributor gift-stock inbox, allocation decisions, order options, and return/loss recording |
| `/api/distributor` | Distributor direct orders, ledger-backed inventory reads, transfers, delivery, finance, and workspace profile |
| `/api/notifications` | Notification service endpoints |
| `/api/user` | User profile / account management |
| `/api/product` | Product creation, listing, publish toggles, stock adjustments |
| `/api/cart` | Cart add/update/remove flows |
| `/api/order` | Orders, admin order lookup, customer order reads, admin create order |
| `/api/returns` | Customer returns, supplier returns, exchange lifecycle |
| `/api/shipping` | Shipping config and dynamic rate calculation |
| `/api/customer` | Customer-level operational features |
| `/api/finance` | Finance domain endpoints |
| `/api/accounting` | Accounting, journals, fiscal periods, COA |
| `/api/manufacturer` | Manufacturer management |
| `/api/manufacturer-inventory` | Manufacturer stock and inventory adjustments |
| `/api/assignment` and `/api/order-assignment` | Assignment flow |
| `/api/delivery` and `/api/delivery-job` | Delivery lifecycle, NCM webhooks, settlements |
| `/api/marketing-cards` | Marketing card lifecycle, partner/customer operations, and Own Store campaigns |
| `/webhooks`, `/api/ncm-webhook` | Delivery/NCM webhook receivers |

### Key route examples from the actual code

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/2fa/send` and `/api/auth/2fa/verify`
- `GET /api/admin/manufacturer-locations`
- `POST /api/admin/manufacturer-locations`
- `GET /api/admin/location-discounts`
- `POST /api/admin/location-discounts`
- `POST /api/product/add`
- `GET /api/product/list`
- `POST /api/order/place`
- `POST /api/order/:orderId/cancel`
- `GET /api/admin/distributor-applications/coverage` and `PUT /api/admin/distributor-applications/:id/coverage`
- `PUT /api/admin/distributor-applications/:id/profile` updates the registration profile and linked login email/phone transactionally.
- `GET /api/order-assignment/admin/unassigned` lists pending customer orders for admin retry through `POST /api/order-assignment/assign`
- `POST /api/returns/exchange/customer`
- `GET /api/returns/exchange/admin` (admin exchange list; serializes the related order's `BigInt` date as a decimal string for JSON clients)
- `POST /api/returns/customer/request` and `GET /api/returns/customer/requests`
- `GET /api/returns/customer/admin/requests` and `POST /api/returns/customer/admin/:id/decision`
- `POST /api/returns/customer/admin/:id/retry-ncm`, `/:id/inspection`, and `/:id/refunded`
- `POST /api/returns/customer/admin/:id/resolve-ncm` for verified ambiguous return outcomes
- `GET /api/returns/customer/manufacturer` for the manufacturer's inbound return queue
- `POST /api/returns/exchange/admin` for an admin-created exchange case
- `GET /api/delivery/admin`
- `POST /api/delivery/admin/:id/resolve-ncm-handoff`
- `GET /api/marketing-cards/admin/cards`
- `POST /api/marketing-cards/customer/cards/scan`
- `GET /api/admin/gifts/catalog`, `POST /api/admin/gifts/catalog`, `DELETE /api/admin/gifts/catalog/:id` (archive)
- `GET /api/admin/gifts/tiers`, `POST /api/admin/gifts/tiers`, and `POST /api/admin/gifts/assign-distributor`
- `GET /api/distributor/gifts/inbound` and `POST /api/distributor/gifts/:id/respond`
- `GET /api/distributor/gifts/order-options/:orderId` returns eligible gifts only from the authenticated distributor's accepted, available inventory
- `GET /api/manufacturer-inventory/my/:productId/movements` returns that manufacturer's paginated per-variant stock adjustment history; `POST /api/manufacturer-inventory/update` stores quantity changes and history rows atomically
- `GET/POST/PATCH /api/distributor/orders/direct` list, create, and update direct distributor hub orders; `GET /api/distributor/inventory` reads distributor stock from `InventoryBalance` and `InventoryLedgerEntry`
- `GET /api/manufacturer-production/dashboard` returns manufacturer-scoped factory balance and completed/inspected production metrics
- Gift assignment is submitted with final checklist completion through the distributor order-assignment status endpoint; delivery deduction is driven by the NCM webhook, and `POST /api/distributor/gifts/returned/:orderId` records an explicit returned-or-lost decision

Gift assignment is distributor-selected and backend-authoritative for distributor hub orders. Admins configure order-value gift ceilings separately and distribute catalog gifts to distributors as pending-acceptance batches. Loyalty gift value and description are configured directly on `CustomerLevel`; the backend loyalty calculation places an active tier gift allowance in `rewardApplied` when the order is created. At the final checklist, eligible distributors see only accepted local stock within the highest active reward ceiling. Checklist completion reserves the selected batch atomically, links the exact inventory batch to the order, and writes a distributor movement log. NCM delivery consumes the reserved unit. Legacy manufacturer gift rows remain for historical records; the manufacturer gift-stock routes are no longer mounted.

Direct hub orders are created as `DIRECT_DISTRIBUTOR`, scoped to the authenticated `req.distributorId`, and deduct each selected SKU through the distributor inventory ledger in the same transaction as order and assignment creation. They do not use manufacturer assignments or `ManufacturerInventory`; the manufacturer direct-order API is no longer mounted.

Manufacturer stock quantity edits are captured in the `ManufacturerInventoryMovement` ledger per size/color variant. Each stock-in or stock-out event retains before/after quantity, signed delta, required reason, optional note, authenticated actor, and timestamp in the same database transaction as the current inventory update. This follows established inventory audit practice of retaining adjustment history instead of relying on the latest on-hand balance alone.

Factory production receipts are not storefront inventory. `Product.stockQuantity` and each product variant's available quantity are synchronized only from unreserved balances at active distributor locations. Production completion therefore leaves storefront stock unchanged; dispatched stock remains unavailable while in transit; confirmed good receipt at a distributor makes it available. Allocation reserves distributor balances, and delivery/direct hub fulfillment consumes the reservation and on-hand balance through auditable ledger movements. Cancellation releases the distributor reservation. These transitions, direct hub sales, and evidence-backed distributor stock decreases recalculate the product projection. Startup reconciles the product projection from distributor ledger balances before the API begins listening.

## 4. Request / Response Lifecycle

The backend uses a deterministic middleware pipeline:

1. `express.json({ limit: "10mb" })` parses JSON payloads.
2. `sanitizeMiddleware` runs before route handling.
3. A timing logger attaches `res.json` overrides to log request duration.
4. CORS is applied using allowed origins from environment variables.
5. Route-authentication middleware executes using `authenticate` + `authorize`.
6. Controllers call services and Prisma.
7. Responses are normalized via `success`/`message` fields in the codebase.

## 5. Security and Authentication

### Auth model

The current implementation uses JWT-based access + refresh tokens and a session table (`AuthSession`) that tracks:

- `jti`
- `tokenFamilyId`
- `issuedAt`, `expiresAt`, `revokedAt`
- `tokenType` (`ACCESS` / `REFRESH`)
- account and IP metadata

The actual validation logic is in:

- `backend/middleware/unifiedAuth.js`
- `backend/config/jwt.js`
- `backend/config/cors.js`
- `backend/services/tokenService.js`

### Role and permission model

The schema includes:

- `Role`
- `Permission`
- `RolePermissionMapping`
- `AuthAccountRoleMapping`

Authorization is enforced through a centralized `authorize` middleware that resolves account permissions from the RBAC service and checks required permission strings such as `product:create`, `order:list_admin`, `delivery:admin_list`, `access:roles_read`, and `marketing_card:admin_manage`.

Own Store campaign creation and public/organization card assignment use the additional `marketing_card:own_store_manage` and `marketing_card:custom_assign` permissions. All Own Store cards are available to any logged-in customer without a delivered-order ownership check; code entry, QR attempts, and successful scans are recorded as card events. The first successful QR scan consumes a card; the backend rejects subsequent scans by both the scanning account and other accounts. The campaign's `maxScansPerCustomer` setting (default one) limits each account across the campaign lifetime, in addition to the weekly campaign cap of five; organization-assigned cards also have a two-per-organization campaign lifetime cap. Physical card stock is assigned to active distributors, with receipt and order attachment performed under distributor context. Customer scan quotas and reward eligibility are enforced in backend services; `POST /api/marketing-cards/customer/claim-reward` claims eligible discount rewards, and `GET /api/marketing-cards/customer/rewards` lists active claims for checkout.

Checkout accepts a single explicit reward choice (`CARD`, `LOYALTY`, or `NONE`). Card discounts are recalculated and validated from the claimed reward on the server, while redemption is changed to `REDEEMED` in the same transaction as order creation. Card and loyalty benefits cannot be stacked; loyalty reward usage is not consumed by an order using a card reward.

### MFA / portal rules

- MFA checks are enforced through `requiresMfa()` and token validation in `unifiedAuth.js`.
- The code supports admin two-factor challenges and portal-specific authentication flows.
- Password-change enforcement is active for admin accounts with `mustChangePassword`.

### Security features currently active

- CORS whitelist via `CORS_ALLOWED_ORIGINS`, `ACCEPTED_URL`, `FRONTEND_URL`, `ADMIN_URL`, `MANUFACTURER_URL`, and `MARKETING_URL`
- JSON-body limits and sanitization middleware
- Auth rate limiting for login and public registration flows
- Session revocation and invalid-token checks
- Restricted token headers (`Authorization`, `token`, `adminToken`, `manufacturerToken`)

### Security caveats

- The repo explicitly warns in `backend/notifications/README.md` not to place real secrets in `.env.example` or frontend config.
- Some notification and incoming-SMS flows are disabled by default and intentionally require manual validation.

### Location-aware pricing and distributor assignment

Pricing and fulfillment are separate decisions. The pricing layer canonicalizes Nepal province/district names and evaluates `ManufacturerLocation` and `LocationProductDiscount` rules to choose an applicable local discount. It does not assign customer orders to manufacturers.

After creating a storefront or admin order, the order API waits for the distributor allocation engine. It considers active distributors with sufficient platform-owned distributor-ledger stock for every requested product variant and quantity, then applies this strict priority: exact active district service coverage; a hub registered in the customer's province or actively covering another district there; any other stocked active hub, ranked by customer-review average and review count. With no reviews yet, nationwide candidates use a stable ID tie-break so allocation can still proceed. Stock reservation and `OrderAssignment` creation are transactional; there is no manufacturer fallback. If allocation fails, the API returns per-variant required and available quantities for active distributors.

Admins configure service districts through the Service-area coverage tab in Distributor Management. Saving coverage replaces that distributor's district list and records the change in the system audit outbox. Customers may submit or edit one distributor rating per delivered order through `POST /api/review/distributor/:orderId`; the endpoint verifies order ownership, delivery, and the assigned hub, then recalculates the distributor's aggregate rating inside the transaction.

A failed NCM courier-booking request must remain in a failed state (`submission_failed`, `failed_to_book_courier`, or equivalent) and must never be converted to a success label by the UI. The backend is the only component allowed to transition the delivery state to a successful carrier booking state.

## 6. Third-Party Integrations

| Integration | Current usage |
| --- | --- |
| Cloudinary | Product media, contract uploads, partner media, uploaded assets |
| Stripe | Payment processing integration |
| Razorpay | Payment processing integration |
| Nepal Can Move (NCM) | Delivery order creation, webhook status updates, handoff reconciliation |
| RabbitMQ | Notification worker pipeline and durable queue setup |
| SMTP / Sparrow SMS | Notification worker configuration for email and SMS delivery |
| MySQL | Primary transactional database |

## 7. Operational Notes

- The backend runs on port `4000` by default and exposes portals on Vite local ports: `5173`, `5174`, `5175`, and `5176`.
- `server.js` boots the application and also initializes the default accounting chart of accounts via `ensureStandardChartOfAccounts()`.
- `npm test` in `backend/` runs unit/regression test files under `backend/tests/` sequentially; test files are isolated in individual Node test-runner processes and failures do not prevent later files from running. Tests that access the real Prisma database are opt-in with `RUN_DATABASE_INTEGRATION_TESTS=1` and must be run against an isolated, migrated/seeded test database because they create and mutate records.
- Startup now validates JWT configuration, awaits the database connection, Cloudinary setup, and standard chart initialization before opening the HTTP listener. Critical initialization failures are logged and cause a non-zero process exit instead of serving a partially initialized API.
- `sanitizeMiddleware` is called before route handling to reduce injection risk.
- API logs are produced in a structured way via `logger.request`; writes use an asynchronous bounded stream, and recent-log reads are bounded asynchronous tail reads. Sensitive metadata fields are redacted before file/console output.
- Requests receive a validated or generated `X-Correlation-ID`, which is available to audit events and returned to clients.

## 10. System audit history and performance

Business mutations enqueue a redacted `SystemAuditOutbox` record in the same Prisma transaction as the change. The background worker writes each event to `SystemAuditLog` and marks its outbox entry processed in one transaction; failed delivery is retried with bounded exponential backoff. This keeps audit processing off the HTTP response path while preserving transactional enqueueing. The worker is started only after critical startup initialization.

`recordSystemAudit` centralizes actor/request context, changed-field diffs, and sensitive-key redaction. Capture points include access-management changes, order fulfillment status transitions, product and manufacturer inventory adjustments, customer-return decisions/inspection/refund transitions, privileged authentication/MFA events, unsuccessful authentication, admin password changes, rate-limit denials, refresh-token reuse, and authenticated RBAC denials. Authentication, rate-limit, and RBAC signals that do not share a business transaction are enqueued asynchronously to avoid delaying their primary response; these signals are best-effort if the process stops before enqueue completion. Existing domain event/movement logs and legacy access-management audit records remain in place.

The protected endpoints `GET /api/admin/access/audit-logs` and `GET /api/admin/access/audit-logs/export` require `access:audit_read`. The list API supports bounded pagination and filters for date range, actor, entity, action, result status, and search; export is capped at 1,000 rows and CSV cells are protected against spreadsheet formula injection. `SecurityEvent` records are review signals, not confirmed breach determinations. Read-only page views and full request bodies are deliberately excluded.

RBAC permission resolution uses a per-process cache capped at 1,000 entries with a 2-second TTL. Access-management changes invalidate the relevant account or whole cache. The short expiry bounds stale permissions across multiple API instances; session validation is not cached. Admin audit-history query results are cached in the browser for 15 seconds, with a 20-query memory bound and an explicit refresh action.

Operational follow-up: apply `20261005000000_add_system_audit_outbox`, run the RBAC seed to register `access:audit_read` for the system Admin role, and regenerate Prisma Client before deploying the new audit endpoints or worker. Monitor outbox entries in `PENDING`/`FAILED`, and establish retention/archival and alerting policies before production audit volume grows. See [Security, Data Flow, and UI Audit](SECURITY_DATA_FLOW_AND_UI_AUDIT.md) for the static flow map, security observations, limits, and deployment checks. Client-bundled AES settings and browser local-storage access tokens remain security follow-ups; they are not a substitute for TLS or XSS controls.

## 8. Business domain map

The backend is not just a CRUD API. It contains domain logic for:

- product catalog and stock
- customer cart and checkout
- order assignment and manufacturer acceptance
- NCM delivery creation and recovery
- customer returns and exchanges
- marketing card generation and redemption
- accounting journals, liabilities, and tax records
- notifications and multi-portal access control

This makes the backend the actual business service layer for the project rather than a thin wrapper around a database.

## 9. Customer return and exchange lifecycle

- Customer and admin requests are validated against a delivered order and purchased quantities. The backend records the cause and an idempotency key; customer input never calls NCM directly.
- Admin approval is the dispatch gate. Return approval calls NCM's vendor-return endpoint; exchange approval reserves the requested replacement variant and calls NCM's exchange-create endpoint.
- `ReturnExchangeNcmAttempt` stores each carrier request, response, HTTP result, error detail, and timestamps. Available NCM charges and the selected payer are stored on the case.
- NCM HTTP 5xx responses retry up to three times by default; every transport attempt is included in the case audit. Timeouts are not blindly retried and remain an unknown outcome for admin reconciliation.
- Per NCM's API guide, `{ pk, comment }` marks the original order for return (`vendor_return: true`) and does not create a new return waybill. Exchange creation returns `cust_order` for replacement and `ven_order` for the return leg.
- Because exchange-create accepts only `pk`, the backend attaches the recorded return cause and replacement plan to the new `ven_order` using NCM's documented order-comment endpoint.
- Return webhook milestones include Pickup Complete, Sent for Delivery, Dispatched, Arrived, and Delivered; updates are applied monotonically and the return is not received until its return leg is delivered.
- The NCM return endpoint does not document a separate reverse-pickup tariff. The system records a charge from the return response when present, otherwise the documented order-detail `delivery_charge`, and records which source supplied it.
- NCM rejection is failed/retryable, not success. Ambiguous outcomes must be reconciled before retrying.
- Return webhooks use a separate state machine. Inventory is adjusted only after manufacturer receipt and inspection; refund payables are created after inspection, and a return closes only after settlement.
- Exchange replacement stock is reserved on approval, released when a rejected request is closed, and consumed when the replacement delivery completes.
- NCM exchange-create accepts only the original order `pk`; it cannot accept a replacement SKU or COD delta. The requested variant is stored/reserved internally, so admins must verify the NCM replacement waybill and coordinate any price adjustment.
- Existing processed return rows are preserved as `LEGACY_PROCESSED`; new requests use the reviewed lifecycle rather than the old immediate refund/restock route.
