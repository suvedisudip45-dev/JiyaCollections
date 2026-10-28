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
| `/api/auth` | Login, refresh, MFA, OTP, password recovery, logout |
| `/api/admin/access` | Access management and RBAC control |
| `/api/admin/product-analytics` | Admin product sales, revenue, return, location, and timeline analytics |
| `/api/admin/manufacturer-locations` | Province/district coverage for manufacturers used in local pricing |
| `/api/admin/location-discounts` | Dynamic product discounts by province/district and admin overrides |
| `/api/lookups` | Public Nepal province, district, active NCM branch, and covered-area lookups |
| `/api/admin/gifts` | Gift catalog, spend-rule configuration, distributor distributions, and admin return review |
| `/api/distributor/gifts` | Distributor gift-stock inbox, allocation decisions, order options, and return/loss recording |
| `/api/distributor` | Distributor direct orders, ledger-backed inventory reads, transfers, delivery, finance, and workspace profile |
| `/api/notifications` | Notification service endpoints |
| `/api/user` | User profile / account management |
| `/api/product` | Product creation, listing, publish toggles, stock adjustments |
| `/api/cart` | Cart add/update/remove flows |
| `/api/order` | Orders, admin order lookup, customer order reads, admin create order |
| `/api/returns` | Customer returns, supplier returns, exchange lifecycle |
| `/api/shipping` | Shipping config and dynamic rate calculation; checkout quotes return the stock-eligible probable distributor and fail rather than invent a generic rate when no shipping origin can be resolved |
| `/api/customer` | Customer-level operational features |
| `/api/finance` | Finance domain endpoints |
| `/api/accounting` | Accounting, journals, fiscal periods, COA |
| `/api/manufacturer` | Manufacturer management |
| `/api/manufacturer-inventory` | Manufacturer stock and inventory adjustments |
| `/api/assignment` and `/api/order-assignment` | Assignment flow |
| `/api/delivery` and `/api/delivery-job` | Delivery lifecycle, NCM webhooks, settlements |
| `/api/marketing-cards` | Marketing card lifecycle, partner/customer operations, and Own Store campaigns |
| `/api/features` | Public feature flags and admin-only platform feature updates |
| `/webhooks`, `/api/ncm-webhook` | Delivery/NCM webhook receivers |

Newly initialized databases seed loyalty, marketing cards, and customer letters as disabled by default. Their admin-controlled feature flags do not affect core production, stock transfer, customer order, or delivery operations.

### Key route examples from the actual code

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/admin/product-analytics/summary`, `/products`, `/locations`, and `/timeline` require the `ADMIN` role and `product:sales_analytics_read`. Each endpoint returns a focused aggregate; timeline requests validate the selected product ID and all date/page/sort filters are checked server-side.
- `GET /api/admin/product-analytics/charts` requires the same Admin role and permission. It returns bounded product, province/district, and distributor comparison series for quantity, item revenue, recorded COGS, completed refunds, and estimated gross product profit; `productId` narrows the distributor comparison to one validated product.
- `GET /api/distributor/product-analytics/summary`, `/products`, `/locations`, and `/timeline` require `distributor:product_sales_read` and authenticated distributor workspace context. Scope is derived from the session, never a client-provided distributor ID; the service omits revenue fields and rejects revenue sorting.
- `GET /api/features` and `PATCH /api/features` (the update requires `platform:features_manage`)
- Customer administration endpoints additionally require the authenticated `ADMIN` role. `GET /api/customer/admin/analytics` returns aggregate active/disabled totals, province/district counts, weekly/monthly/yearly and selected-period account-creation counts, repeat-purchase rate, and all-time order sales by delivery-address province/district. Split-shipment order rows sharing a `checkoutGroupId` count as one transaction for transaction and repeat-purchase counts; revenue, item costs, and per-package carrier charges still sum across shipment rows. Production overhead in the sales estimate uses only overhead recorded on sold order-item cost snapshots, divided by that product's all-time non-cancelled units sold and allocated by location units sold; unsold inventory and produced quantities in cost layers are not overhead inputs. Approximate profit subtracts available product COGS, this allocated overhead, and recorded NCM charges; local distributor delivery expenses, unrecorded carrier charges, returns/refunds, and other operating expenses are not included. It requires `customer:admin_list` and does not return customer identities. `GET /api/customer/admin/search` requires a search of at least two characters or an explicit status, location, or account-creation date filter, supports server-side pagination, and sorts customers by latest non-cancelled order; it requires `customer:admin_list`.
- `GET /api/customer/details/:userId/profile` returns the compact customer profile, customer code, loyalty summary, and aggregate marketing-card scan/claimed/used reward counts (`customer:admin_detail`). `GET /api/customer/details/:userId/orders` and `/letters` return separately paginated history (`customer:admin_orders_read` and `customer:admin_detail`, respectively). The legacy details endpoint accepts `includeOrders=false` to load individual card/reward and other customer-activity records without duplicating the paginated order history.
- `PATCH /api/customer/admin/:userId/status` requires `customer:account_manage`; disabling a customer revokes that account's active sessions and is recorded in the system audit outbox. Letter uploads/deletes require `customer:letter_manage`.
- `POST /api/auth/2fa/send` and `/api/auth/2fa/verify`
- `GET /api/admin/manufacturer-locations`
- `POST /api/admin/manufacturer-locations`
- `GET /api/lookups/nepal` returns canonical `LocationMapping` provinces/districts and active `NcmBranch` records, with optional province, district, and branch filters. The backend caches the combined lookup for ten minutes and invalidates it after NCM branch synchronization.
- `GET /api/admin/location-discounts`
- `POST /api/admin/location-discounts`
- `POST /api/product/add`
- `GET /api/product/list`
- `POST /api/order/place`
- `POST /api/order/:orderId/cancel`
- `GET /api/admin/distributor-applications/coverage` and `PUT /api/admin/distributor-applications/:id/coverage`
- `PUT /api/admin/distributor-applications/:id/profile` updates the registration profile and linked login email/phone transactionally.
- The admin distributor directory and dedicated profile are served from `/api/admin/distributors`: `GET /` requires a search query of at least two characters and supports `page` and `limit`; `GET /:id/profile`, `/login-history`, `/inventory`, `/returns`, `/exchanges`, and `/finance` load focused profile/history sections. `/finance/transactions` and `/finance/settlements` are separately paginated.
- These detail endpoints require the `ADMIN` role plus section permissions (`distributor:admin_detail`, `distributor:admin_sessions_read`, `distributor:admin_inventory_read`, `distributor:admin_returns_read`, `distributor:admin_exchanges_read`, or `distributor:admin_finance_read`). The seed does not grant `distributor:admin_*` permissions to distributor workspaces. Profile and rate changes reuse the audited admin profile and approved rate-card endpoints.
- Existing `GET /api/stock-transfers/admin?distributorId=...` and `GET /api/order-assignment/admin/all?distributorId=...` provide paginated inbound transfer and order/delivery history for the selected distributor. They are admin-role protected and accept the focused detail permissions in addition to their general listing permissions.
- Distributor detail remains separate from the manufacturer profile even when both profiles share an `AuthAccount`; the detail page links to the existing manufacturer page. Distributor inventory value is explicitly estimated from current product price/cost fields, not historical cost layers. The financial statement currently reports platform receivables as zero; it is not a general accounting-party receivables ledger.
- The manufacturer directory links to `/manufacturers/:manufacturerId`, a dedicated admin detail page. It reuses the existing paginated manufacturer profile/update, production-request, stock-transfer, and settlement-request APIs. Focused APIs under `/api/admin/manufacturers/:id` provide paginated factory ledger inventory, manufacturer finance summary, and paginated journal transactions; each requires the ADMIN role and a matching `manufacturer:admin_*` section permission. The profile editor synchronizes an edited email to the linked login account; contract/account status changes remain on the existing contract-status flow. Inventory quantities come from factory `InventoryBalance` records, while production data distinguishes approved unit COGS from per-unit overhead.
- `GET /api/order-assignment/admin/unassigned` lists pending customer orders for admin retry through `POST /api/order-assignment/assign`
- `POST /api/returns/exchange/customer`
- `GET /api/returns/exchange/distributor` and `POST /api/returns/exchange/distributor/:id/process`
- `GET /api/returns/exchange/admin` (admin exchange list; serializes the related order's `BigInt` date as a decimal string for JSON clients)
- `POST /api/returns/customer/request` and `GET /api/returns/customer/requests`
- `GET /api/returns/customer/admin/requests` and `POST /api/returns/customer/admin/:id/decision`
- `POST /api/returns/customer/admin/:id/retry-ncm`, `/:id/inspection`, and `/:id/refunded`
- `POST /api/returns/customer/admin/:id/resolve-ncm` for verified ambiguous return outcomes
- `GET /api/returns/customer/manufacturer` for the manufacturer's inbound return queue
- `POST /api/returns/exchange/admin` for an admin-created exchange case
- `GET /api/delivery/admin`
- `GET /api/delivery/admin/ncm/deliveries` and `/api/delivery/admin/self-deliveries` provide separate paginated, database-backed admin monitors with Kathmandu-local date filters; `GET` detail routes load order, status-event, return/exchange, distributor-rating, and settlement data on demand.
- `/api/delivery/admin/ncm/*` exposes bounded, permission-protected documented NCM reads and explicit tools (status comparison is limited to selected known local IDs; ticket, comment, webhook, redirect, branch, rate, label, staff, and customer operations). `GET /api/delivery/admin/ncm/tickets` serves active/closed ticket summaries from `NcmSupportTicket` without contacting NCM. NCM ticket-creation responses return the ticket ID as a scalar `ticket` field; successful support-ticket and COD-settlement ticket create/detail/reply/close operations upsert that local index. Mutating calls are audited, and ambiguous provider outcomes are not retried automatically.
- `POST /api/delivery/admin/:id/resolve-ncm-handoff`
- `GET /api/marketing-cards/admin/cards`
- `GET /api/marketing-cards/admin/partners/:partnerId/analytics` returns partner-scoped campaign, distributor, and province/district aggregate reporting; it requires `marketing_card:analytics_read`.
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

Distributor customer-order delivery is selected after package details are complete. The distributor chooses self-delivery or NCM and places the assignment on hold; held assignments are excluded from the ordinary hub queue. Self-delivery is permitted when the customer's district matches the distributor's registered or active coverage district, or when both have the same exact city and the same province. District matching rejects conflicting province values; city matching is exact, not address-proximity matching. Self-Delivery Management lists self-delivery orders in a paginated table with customer, destination, payment/COD, status, configured expected delivery charge, and order details. Distributors can dispatch an order individually or submit up to 50 selected assignments through `POST /api/distributor/orders/self-delivery/bulk-dispatch`; each assignment follows the existing dispatch transaction and returns an individual success or failure result. NCM-held orders are managed from the distributor NCM desk, where the distributor can submit selected orders as separate NCM bookings in one action. Each order keeps its own booking, waybill, and failure result; this is not a carrier-side multi-parcel booking. Existing NCM submission and reconciliation safeguards remain in use. Self-Delivery Management only lists self-delivery assignments and excludes assignments with an NCM delivery record, including legacy records.

The distributor NCM desk provides on-hold, failed NCM, active booked, delivered, and all-NCM views, with order details, product image, payment/delivery state, creation time, and any likely-delivery date found in persisted NCM event payloads. The Booked view excludes delivered orders; Failed NCM contains failed submissions without an NCM order ID. It does not infer an ETA when the carrier has not provided one. Its list and bulk-book routes require authenticated distributor context and `distributor:assignments_read`.

Admins can submit package details from Order Assignments and request NCM
delivery for a distributor-assigned order. The request uses the assigned hub's
pickup branch and the standard NCM order-creation contract. For distributor
orders, the assigned distributor's NCM pickup branch is the NCM pickup origin
(`fbranch`); the customer's selected NCM branch, or saved customer city/location
for older orders, is the destination (`branch`). Manufacturer-originated
bookings continue using the assigned manufacturer's pickup branch. Customer-order
carrier status is updated from NCM webhooks and persisted in the database;
customer-order reads do not poll NCM status/detail APIs. Webhook success is
returned only after the event and status update have been saved. NCM delivery
charges are platform/admin settlement amounts, not partner payables.
Customer-delivery statuses are matched against exact normalized NCM status/event
aliases; negative, conflicting, generic, and unmapped responses set
`DeliveryOrder.ncmReconciliationRequired` without changing the last trusted
delivery/order/assignment state, COD, inventory, or accounting. Older recognized
milestones cannot rewind later local states. Admin's NCM reconciliation queue
is available in the delivery monitor; “Reconcile from NCM” fetches the provider
status endpoint and applies only recognized milestones. Admin decisions to
confirm delivery or confirm it was not delivered require an investigation note
and are recorded in `DeliveryEvent`. Only confirmed delivery enters the
delivered-sale inventory and accounting transaction.

For unpaid distributor self-delivery COD, when notifications and SMS are
enabled, the distributor requests a short-lived, hashed customer OTP bound to
the assigned order, distributor, and exact order amount. When either setting is
disabled, delivery instead requires an explicit distributor confirmation that
the full amount was collected; the cash event is marked pending verification.
Delivery, inventory consumption, the distributor cash event, and accounting-
outbox enqueue are committed together.
The delivered-sale journal debits `DISTRIBUTOR_COD_RECEIVABLE` (1190), not
carrier receivables or company cash. Distributors submit remittance amount,
reference, and a JPG/PNG transfer evidence image; Admin verification rechecks the open receivable
inside a serializable transaction, posts the treasury receipt, creates a cash
transaction, and allocates the amount to the distributor's receivable documents.

Admin return approval snapshots the configured percentage charge against
returned product value; the original delivery fee is excluded. For distributor
returns, receipt and inspection only create a refund task. Return inspection
records a JPG/PNG photo of the returned goods. The distributor submits a
JPG/PNG payment evidence image for the exact approved amount, and an Admin must verify
it before the return completes and the company recognizes a distributor payable
(2190). Admin payout is a separate idempotent operation against an active NPR
treasury account and the specific payable document. Gross receivables and
payables remain separately recorded; an Admin may explicitly approve an offset
through the distributor Finance detail. The offset is capped at the lower of
open COD receivable less pending remittances and verified refund payable, then
posts a balanced 2190/1190 journal and allocates both subledger documents in
one serializable transaction. Offset history and an audit event are retained.
These cash flows use scoped distributor context, idempotency keys, and
transactional accounting and audit records.

Manufacturer-to-distributor stock-transfer booking resolves the destination
branch from the distributor profile and validates origin and destination
against active `NcmBranch` records. A catalog-matched branch marked
`UNVERIFIED` is promoted to `VERIFIED` during booking; explicitly rejected or
unavailable branches remain blocked. The booking query must select the same
branch and status fields displayed in portal shipment views.

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

The admin-only `platform:features_manage` permission protects changes to the singleton `PlatformFeatureConfig`. The public read endpoint supplies flags for storefront, marketing-partner, and distributor portals. Loyalty, marketing cards, and letters default to enabled for compatibility. Backend order reward logic and feature-sensitive card, loyalty, letter, and fulfillment endpoints also enforce the flags; client-side hiding is only the corresponding UX. Disabling letters skips the required-letter validation without deleting `LetterDelivery` or customer story-assignment progress, so the same persisted progression remains available when letters are re-enabled.

Own Store campaign creation and public/organization card assignment use the additional `marketing_card:own_store_manage` and `marketing_card:custom_assign` permissions. All Own Store cards are available to any logged-in customer without a delivered-order ownership check; code entry, QR attempts, and successful scans are recorded as card events. The first successful QR scan consumes a card; the backend rejects subsequent scans by both the scanning account and other accounts. The campaign's `maxScansPerCustomer` setting (default one) limits each account across the campaign lifetime, in addition to the weekly campaign cap of five; organization-assigned cards also have a two-per-organization campaign lifetime cap. Physical card stock is assigned to active distributors, with receipt and order attachment performed under distributor context. Customer scan quotas and reward eligibility are enforced in backend services; `POST /api/marketing-cards/customer/claim-reward` claims eligible discount rewards, and `GET /api/marketing-cards/customer/rewards` lists active claims for checkout.

Checkout accepts a single explicit reward choice (`CARD`, `LOYALTY`, or `NONE`). Card discounts are recalculated and validated from the claimed reward on the server, while redemption is changed to `REDEEMED` in the same transaction as order creation. Card and loyalty benefits cannot be stacked; loyalty reward usage is not consumed by an order using a card reward.

### MFA / portal rules

- Privileged-portal MFA is enabled by default and controlled by the backend `MFA_ENABLED` environment variable (`true` or `false`). When enabled, `isMfaEnforced()` and token validation require MFA across login, refresh, workspace switching, and authentication middleware. When explicitly disabled, privileged portals use password-only authentication and MFA challenge endpoints are unavailable. Notification configuration does not change the MFA policy; with MFA enabled, unavailable notification delivery prevents privileged sign-in.
- The code supports admin two-factor challenges and portal-specific authentication flows.
- Password-change enforcement is active for admin accounts with `mustChangePassword`.

### Password recovery

`POST /api/auth/password-reset/request`, `/verify`, and `/complete` implement SMS-only password recovery for CUSTOMER, MANUFACTURER, and DISTRIBUTOR accounts. Requests require both the login email and contact number to match the same active account, and the account's primary role and active profile must match the selected portal; an alternate workspace role does not authorize cross-portal recovery. An ineligible request returns a portal-specific not-found response; this intentionally identifies account/portal eligibility to help users select the correct login portal. Eligible requests enqueue an encrypted SMS through the notification outbox. Before creating the challenge or queuing an SMS, the backend atomically enforces one request per rolling seven days and at most three per UTC calendar month. The last-request timestamp and monthly quota are stored on `AuthAccount`; quota violations return HTTP 429 and do not issue a challenge or SMS. IP rate limits also cover request, OTP verification, and completion routes.

OTP verification consumes the challenge and issues a random, short-lived `tfaToken`; its lifetime is controlled by `PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES` (default 5, range 1–30). `PASSWORD_RESET_MAX_ATTEMPTS` controls OTP attempts per challenge (default 5, range 1–10). Password completion requires the token and atomically consumes it once. Password reset updates the bcrypt hash and revokes all active account sessions in one transaction. The UI returns to the ordinary login flow; it does not create a session automatically. Temporarily, password recovery always uses the fixed six-digit code `111111` in every environment; this is unsafe for production and must be replaced with cryptographically random OTPs before public production use. Apply migration `20261016000000_add_password_reset_limits` before deploying this flow.

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

After creating a storefront or admin order, the order API waits for the distributor allocation engine. It first prefers one active distributor with sufficient platform-owned distributor-ledger stock for every requested product variant and quantity. If none exists but active hubs collectively cover the cart, it plans separate product orders by stock-bearing hub (splitting a variant quantity across hubs when required), then creates one independently assigned order and delivery per product/hub pair. Each product order stores only its own item lines; orders from one checkout share an indexed `checkoutGroupId`. The checkout's configured split-shipment fee is applied once to the group, with separate door-to-door and door-to-hub rates. Routing priority is: exact configured service-district coverage (or the registered province/district when no service area is configured); same registered district; matching NCM pickup branch; same province; then any stocked active distributor nationwide. Each tier is ranked by distributor quality rating, then rating count, then stable ID. Allocation uses only province, district, and NCM branch—not street address or free-form city proximity. Shipping quotes and final order creation use the selected `province` before the legacy `state` field and normalize district labels before calculating the route rate. When the likely distributor and customer are in the same district/service zone (including the Kathmandu Valley cluster), delivery is door-to-door only; otherwise customer checkout and admin social orders may select door-to-door or NCM door-to-hub pickup. Same-province, cross-province, and split-shipment door-to-door/door-to-hub tariffs are independently configurable in Shipping Settings. Order creation recalculates the selected method and fee server-side. Stock reservation and each `OrderAssignment` creation are transactional; there is no manufacturer fallback. If combined stock is insufficient, the API returns per-variant required and available quantities for active distributors. Distributor assignment history remains visible in the distributor Orders list after an order is placed on the delivery queue or handed to NCM; the assignment detail is read-only after queue handoff or carrier booking/delivery, and the status-update API rejects further fulfillment edits.

The admin financial dashboard calculates product COGS from accepted per-order cost snapshots first, then from production cost layers completed by the selected month (weighted by produced units) for distributor-fulfilled inventory. Approved manufacturer inventory cost is the next fallback, with `Product.costPrice` retained only for legacy products without approved cost records. Its live balance-sheet inventory value sums current on-hand stock in platform-owned inventory locations (excluding stock recorded as lost), valuing cost-layered units using their production COGS and falling back to `Product.costPrice` only for uncosted or legacy stock. Manufacturer-to-distributor transportation and logistics overhead is sourced separately from dispatched MANUAL `StockTransferShipment` records in the selected dispatch month: each shipment's `freightCharge` is counted once, and the detail identifies its local delivery partner and stock transfer. Order-level delivery/other-cost snapshots and weighted product cost-layer overheads are not used for this finance category; NCM carrier charges remain separate. The posted financial statement's account 6430 likewise excludes legacy per-order delivery-sale overhead journal lines; actual carrier settlements, local transfer freight accruals, and recorded delivery expenses remain included, with shipment freight booked once at dispatch. Recorded fixed and marketing expenses are itemized from the selected month's operating-expense records. The existing authenticated `finance:dashboard_read` route protects both summary and detail data.

The posted Profit & Loss statement recognizes COGS when a distributor-fulfilled order is delivered, not when production is approved or completed. Distributor receipt ledger movements retain the production cost-layer ID from the stock-transfer shipment allocation; self-delivery fulfillment and NCM delivery consume those received layer quantities, persist the consumed cost snapshot on the order for audit/history, pass the exact unit COGS and overhead into the delivery journal, and post the delivery sale and inventory relief in the same transaction. The self-delivery path must pass the full order and transaction client to the accounting poster. Transfers received before this provenance tracking was deployed remain uncosted in the ledger and are not backfilled with guessed production layers.

Manufacturer production terms capture VAT treatment as exempt, inclusive, or exclusive plus rate and supplier invoice reference. Admin approval records whether the invoice was verified. Production receipt capitalizes unverified VAT into inventory; verified VAT is posted once to input VAT receivable, while manufacturer payable reflects the gross supplier amount. The Admin tax report and finance dashboard both use posted-journal VAT totals; operational cost estimates are not treated as VAT claims.

Future output VAT rates are managed as append-only `VatRateVersion` records by `finance:tax_configure`. Only future timestamps can be scheduled, only the latest scheduled version can be cancelled, and rate resolution uses the transaction's source date. Delivered-sales and full-delivery-return journals use that effective rate; customer-return approvals snapshot the rate and VAT reversal so a later change cannot alter an approved refund. Before the first version effective for a transaction date, the legacy `TaxConfiguration.vatRate` value (or 13% fallback) remains in force. Pre-version historical treatment still requires reconciliation.

Distributor delivery earnings are recognized only for completed `SELF_DELIVERY` assignments with no corresponding NCM `DeliveryOrder`; NCM carrier deliveries never create distributor delivery earnings. Each new completion snapshots the approved rate-card values and posts delivery expense 6430 against distributor payable 2190, with a matching earning document in the same delivery transaction. Admin rate-card revisions create versions rather than rewriting the historical values. Payouts allocate earning documents and clear 2190; legacy settlement records remain visible for reconciliation and are not double-accrued for new deliveries. Distributor service VAT is not claimed without verified supplier-invoice evidence.

Delivered NCM COD creates party receivables against control 1170. An Admin remittance requires the selected delivery orders' open COD source documents, accrues the actual carrier fee against payable control 2180, allocates both sides, and books net cash, settlement journal, settlement state, and Treasury transaction in one serializable transaction. Accounting Health compares open NCM COD, distributor COD, NCM carrier-fee, and distributor-earning documents with controls 1170, 1190, 2180, and 2190 respectively. These checks are source-scoped; legacy and other-party documents still require migration/reconciliation before overall accounting coverage can be called complete.

Admins configure service districts through the Service-area coverage tab in Distributor Management. Saving coverage replaces that distributor's district list and records the change in the system audit outbox. Customers may submit or edit one distributor rating per delivered order through `POST /api/review/distributor/:orderId`; the endpoint verifies order ownership, delivery, and the assigned hub, then recalculates the distributor's aggregate rating inside the transaction.

Checkout shipping preview calls the same distributor-selection logic without reserving inventory. Only distributors with a valid registered province/district origin are eligible, even if their service-area coverage is configured; legacy manufacturer-linked distributors can resolve that origin from their canonical district city or NCM pickup branch. This keeps quoted and actual shipment routes resolvable. A hub with the full cart is preferred over split fulfillment, including when a higher-priority hub has only partial stock. Any distributor included in a checkout shipment plan is only a preference during final assignment: if its stock is no longer sufficient, allocation continues through the location tiers and assigns a stocked hub. Single-hub orders use the selected hub's route rate; split orders list the supplying hubs and use the admin-configured flat split fee once (unless existing free-shipping or loyalty rules waive it). Order creation reruns the quote and allocation plan server-side and persists the fee on one product order in the group. Existing district-only consumers retain their prior same-/different-district calculation when they do not provide a shipment origin.

Approving manufacturer distributor access copies the manufacturer's business name, phone, address, city, NCM pickup branch, pickup address/contact/window, and return instructions into the linked distributor profile. Distributor pickup verification starts as `UNVERIFIED`. Approval retains a valid existing distributor origin; otherwise it resolves the origin from the manufacturer's canonical district city, then NCM pickup branch, then the first active manufacturer location in province/district order. The origin is saved on the distributor and upserted as its initial service area so upgraded hubs remain eligible for stock-based allocation and route-specific shipping rates. Admins can edit the profile in Distributor Management; distributors can update business/contact/location and pickup details from the distributor workspace's Pickup Profile page.

A failed NCM courier-booking request must remain in a failed state (`submission_failed`, `failed_to_book_courier`, or equivalent) and must never be converted to a success label by the UI. The backend is the only component allowed to transition the delivery state to a successful carrier booking state.

Bulk stock-transfer NCM bookings use the documented `/api/v1/order/create`
payload; the optional NCM `vref_id` is omitted because NCM rejects the full
internal transfer identifier as too long. A confirmed NCM order ID is retained
as the shipment's dedicated NCM order ID and compatibility external reference.
Booking acceptance is `BOOKED`, with factory inventory and cost-layer quantities
reserved until the first pickup/custody event. That event atomically moves stock
to transit and consumes its reservations once; carrier delivery remains
separate from distributor receipt, inspection, and ledger posting. Shipment
webhook events are persisted idempotently, and normal manufacturer/distributor
tracking reads the database. Only admin reconciliation calls NCM status/detail
APIs and can recover a missed custody event. Production webhook authentication
requires the configured secret; `User-Agent` is not authentication. The
manufacturer can request an NCM return through the
documented vendor return endpoint; only NCM's vendor-return response confirms
that request, and returned units still require a distributor receipt/inspection.
The NCM freight quote and later carrier charge remain platform/admin settlement
data, not manufacturer or distributor payables.

## 6. Third-Party Integrations

| Integration | Current usage |
| --- | --- |
| Cloudinary | Product media, contract uploads, partner media, uploaded assets |
| Stripe | Payment processing integration |
| Razorpay | Payment processing integration |
| Nepal Can Move (NCM) | Customer delivery creation, webhook status updates, bulk stock-transfer booking/tracking/returns, and handoff reconciliation |
| RabbitMQ | Notification worker pipeline and durable queue setup |
| SMTP / Sparrow SMS | Notification worker configuration for email and SMS delivery |
| MySQL | Primary transactional database |

## 7. Operational Notes

- The backend runs on port `4000` by default and exposes portals on Vite local ports: `5173`, `5174`, `5175`, and `5176`.
- `server.js` boots the application and also initializes the default accounting chart of accounts via `ensureStandardChartOfAccounts()`.
- Delivered NCM and distributor self-delivery transitions enqueue a versioned, hashed `AccountingEvent` snapshot in the same transaction as the delivery update. The scheduled delivery-accounting worker claims due events with conditional updates, retries transient failures, and posts through the central journal engine; journal creation and event completion share a transaction. Accounting APIs expose unresolved event status so reports can warn that unposted sales are excluded from GL figures. Apply `20261017000000_delivery_accounting_outbox_schedule` and regenerate Prisma Client before deployment; that migration has not yet been applied.
- The Admin finance dashboard exposes a `postedAccounting` summary calculated from posted `JournalLine` rows, while operational cost detail remains a separate analytical view. Use posted journal totals for financial statements; display unresolved delivery-accounting outbox events as exclusions rather than treating them as posted.
- Distributor COD/refund workflows additionally require applying `20261027100000_distributor_cod_and_return_cash` and regenerating Prisma Client. Apply it only after review and backup; integration/concurrency verification belongs on an isolated migrated test database.
- Apply `20261027130000_distributor_refund_receivable_netting` and regenerate Prisma Client before enabling Admin-approved refund-payable/COD-receivable offsets. The migration adds an offset audit record and does not rewrite existing balances; confirm idempotency-key uniqueness before deployment.
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

General Prisma list/count/aggregate reads are cached only for the non-identity catalog models `Product`, `Category`, `SubCategory`, `Color`, and `ComboBundle`, using a process-local cache (5-second TTL, maximum 2,000 entries). Transactions and all other models bypass it. Prisma writes and successful HTTP mutation responses invalidate that cache. Each portal also keeps eligible JSON GET responses in a bounded in-memory cache (10-second TTL, maximum 100 entries), keyed by URL, query parameters, access token, manufacturer workspace, and `Accept`; successful mutations and auth-token changes clear it. Binary responses are not cached. These caches are an optimization only: they are not shared across backend instances or browser tabs, and the short TTL is the cross-instance staleness bound. Do not use the caches for authorization decisions or sensitive session state.

Bulk list endpoints use `page` and `limit` query parameters. The shared backend defaults to page 1 and 12 records, caps requests at 50, and returns `pagination: { page, limit, total, totalPages, hasNextPage, hasPreviousPage }`. Orders and transfers sort most recently updated first with their creation/request timestamp as a tie-breaker. The admin Orders, Delivery Monitor, manufacturer directory, Stock Transfers, manufacturer Factory Transfers, distributor inbound-transfer, and marketing-partner campaign screens send page parameters and render controls. Manufacturer and partner campaign search is applied before pagination; manufacturer details use an exact ID filter instead of assuming the requested item is on page 1.

Operational follow-up: apply `20261005000000_add_system_audit_outbox`, run the RBAC seed to register `access:audit_read` for the system Admin role, and regenerate Prisma Client before deploying the new audit endpoints or worker. Monitor outbox entries in `PENDING`/`FAILED`, and establish retention/archival and alerting policies before production audit volume grows. See [Security, Data Flow, and UI Audit](SECURITY_DATA_FLOW_AND_UI_AUDIT.md) for the static flow map, security observations, limits, and deployment checks. Client-bundled AES settings and browser local-storage access tokens remain security follow-ups; they are not a substitute for TLS or XSS controls.

The order update timestamp requires applying `20261011203000_add_order_updated_at` and regenerating Prisma Client before deploying order list queries that sort by `Order.updatedAt`.

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
- The original completed delivery channel determines the handler: NCM-delivered orders route both returns and exchanges through NCM; `SELF_DELIVERY` orders route to the distributor on the original `OrderAssignment`. Admin approval is the dispatch gate, and the admin panels display this handler before approval.
- NCM return approval calls `/api/v2/vendor/order/return` with the original NCM order ID and reason. This marks the original order for return rather than creating a new return waybill; NCM webhooks/polling track the reverse leg until delivered to the manufacturer, where inspection and refund accounting continue.
- NCM exchange approval calls `/api/v2/vendor/order/exchange-create` with the original NCM order ID. NCM creates distinct return (`ven_order`) and replacement (`cust_order`) legs; the backend stores and reconciles both IDs and attaches the return reason/replacement plan to the return leg. Returned goods must reach and be inspected at the manufacturer, while replacement status tracks NCM delivery.
- Approved distributor returns are assigned to the original distributor for receipt, QA, inventory adjustment, and return accounting. Approved distributor exchanges reserve replacement stock from that distributor's ledger; the distributor receives and inspects the returned units, dispatches the reserved replacement, and marks it delivered. Neither distributor route calls NCM.
- `ReturnExchangeNcmAttempt` stores each carrier request, response, HTTP result, error detail, and timestamps. Available NCM charges and the selected payer are stored on the case.
- NCM HTTP 5xx responses retry up to three times by default; every transport attempt is included in the case audit. Timeouts are not blindly retried and remain an unknown outcome for admin reconciliation.
- Because exchange-create accepts only `pk`, the backend attaches the recorded return cause and replacement plan to the new `ven_order` using NCM's order-comment endpoint; NCM does not accept the replacement SKU or price delta in the exchange-create request.
- Return webhook milestones include Pickup Complete, Sent for Delivery, Dispatched, Arrived, and Delivered; updates are applied monotonically and the return is not received until its return leg is delivered.
- The NCM return endpoint does not document a separate reverse-pickup tariff. The system records a charge from the return response when present, otherwise the documented order-detail `delivery_charge`, and records which source supplied it.
- NCM rejection is failed/retryable, not success. Ambiguous outcomes must be reconciled before retrying.
- Return webhooks use a separate state machine. Inventory is adjusted only after manufacturer receipt and inspection; refund payables are created after inspection, and a return closes only after settlement.
- Admins configure separate NCM/distributor return and exchange logistics settlement rates in Shipping Rate Settings. The selected rate is snapshotted at approval, is not charged to the customer, and becomes an accounts payable to NCM or the original distributor only when the logistics workflow completes. The NCM-reported carrier charge remains a separate actual-charge record.
- NCM exchange replacement stock follows the manufacturer reservation and carrier-status lifecycle. For self-delivery exchanges, reserved distributor-ledger stock is consumed at dispatch; the distributor must receive and inspect the return before dispatch, then mark the replacement delivered. Good returned items are ledgered as `RETURN`; damaged items are ledgered to `DAMAGED` and recorded as open inventory discrepancies.
- NCM exchange replacements are not variant- or price-adjusted by NCM's API call. The requested variant is stored/reserved internally, so admins must verify the NCM replacement waybill and coordinate any price adjustment.
- Existing processed return rows are preserved as `LEGACY_PROCESSED`; new requests use the reviewed lifecycle rather than the old immediate refund/restock route.
