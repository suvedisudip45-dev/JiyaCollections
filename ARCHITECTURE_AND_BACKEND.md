# Architecture and Backend Reference

## Request signing and HMAC compatibility

All portal clients sign `/api` requests, including authentication calls. Backend middleware verifies `Request-Signature` after JSON parsing but before sanitization and route dispatch; missing or invalid values are rejected, and an unset backend secret fails closed. The JSON parser retains the raw request body for signature verification so it matches the exact text sent by the portal; absent bodies remain distinct from JSON `{}`. Structured warning/error logs identify missing configuration, missing signatures, and mismatches with request metadata and signature lengths; secret values, signature contents, authorization headers, and request bodies are never logged. The canonical string is `METHOD|canonicalUrl|bodyText`, where the URL path is lowercased and query parameters are lowercased and sorted before hashing. The shared secret is appended to the canonical message, SHA-256 is computed, the digest is uppercased to hex, and the resulting hex string is base64-encoded. NCM webhook receiver routes are excluded from this middleware and retain their dedicated validation path.

Configure `HMAC_SECRET` on the backend and the matching `VITE_HMAC_SECRET` in each portal. `VITE_` settings are public in browser bundles; this legacy compatibility signing flow does not replace JWT authentication or authorization and must not be treated as a confidential client secret.

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

The API exposes `/health/live` for process liveness and `/health/ready` for
startup/database readiness. The readiness response also reports the derived
stock projection state: product-list reads do not trigger a catalog-wide
synchronization, startup reconciliation runs in bounded pages in the background,
and the distributor inventory ledger remains authoritative for checkout. A
failed projection sync is logged and reported as degraded without falsely
marking the database unavailable.

The separate notification worker is monitored with
`npm run notifications:health` from `backend/`. This check reports enabled queue
consumer counts and depth, notification counts by channel/status, and the age
of the oldest queued notification; schedule it externally and alert on
backlog or unresolved `FAILED`, `DEAD_LETTERED`, and `UNKNOWN` states. It does
not retry ambiguous provider outcomes or change the fixed password-reset OTP.
`npm run ops:exceptions` reports locally tracked carrier/accounting exceptions
without exposing customer data; it cannot enumerate carrier-only NCM orders.
See the [Operations Runbook](docs/operations/operations-runbook.md) for owner,
reconciliation, and escalation expectations.

Orders retain an internal UUID primary key and a separate unique 15-character
`orderReference`. Customer/admin displays use the order reference, and new NCM
delivery submissions send that same value as the carrier vendor reference.

## 2. Backend Directory Layout

| Path | Purpose |
| --- | --- |
| `backend/server.js` | Starts Express, configures middleware, mounts route groups |
| `backend/config/` | DB, CORS, Cloudinary, JWT validation, environment config |
| `backend/controllers/` | HTTP request handlers for auth, products, orders, accounting, delivery, returns |
| `backend/routes/` | Router definitions grouped by domain |
| `backend/services/` | Domain logic, RBAC, token generation, delivery/NCM reconciliation, accounting engine |
| `backend/middleware/` | Auth, pre-route request-signature verification, sanitization, rate limiting, request-level RBAC |
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
| `/api/admin/discount-analytics` | Admin discount totals and customer/order-level classification analytics |
| `/api/admin/manufacturer-locations` | Province/district coverage for manufacturers used in local pricing |
| `/api/admin/location-discounts` | Dynamic product discounts by province/district and admin overrides |
| `/api/lookups` | Public Nepal province, district, active NCM branch, and covered-area lookups |
| `/api/admin/gifts` | Gift catalog, spend-rule configuration, distributor distributions, and admin return review |
| `/api/admin/distributors` | Distributor administration, per-distributor Finance records, paginated settlement-position summaries, and audited distributor stock-return authorization |
| `/api/distributor/gifts` | Distributor gift-stock inbox, allocation decisions, order options, and return/loss recording |
| `/api/distributor` | Distributor direct orders, ledger-backed inventory reads, transfers, delivery, finance, and workspace profile |
| `/api/notifications` | Notification service endpoints |
| `/api/user` | User profile / account management |
| `/api/product` | Product creation, listing, publish toggles, stock adjustments |
| `/api/cart` | Cart add/update/remove flows |
| `/api/order` | Orders, admin order lookup, customer order reads, admin create order |
| `/api/order/admin/control/:orderId` | Permission-protected Admin order detail with bounded split-shipment, carrier, cash/accounting, and audit history; `POST /:orderId/cancel` permits audited unpaid pre-handoff cancellation |
| `/api/order-assignment/admin/control` | Permission-protected Admin failed-order assignment override; reasoned and ledger-reserved |
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
| `/api/storefront-content` | Public storefront announcement, shared header/footer logo, card, footer, About, and terms content with permission-protected admin updates/image uploads |
| `/webhooks`, `/api/ncm-webhook` | Delivery/NCM webhook receivers |

`/api/finance/paper-bill-books`, `/paper-bill-allocations`, and
`/paper-bill-orders` provide Admin bill-book/range management and date-filtered
order reporting with VAT-bill, PAN-bill, no-bill, and voided-bill filters.
Inclusive order-date ranges use Nepal-local day boundaries and the report
includes unassigned orders. Admin order-list and order-control details expose
the recorded physical bill type, number, issue time, and void/adjustment
metadata. Read operations use `finance:tax_report_read`;
book creation, allocation, and return use `finance:tax_configure`. Distributor
`GET /api/distributor/paper-bills/allocations` and
`POST /api/distributor/paper-bills/allocations/:id/accept` list only the
authenticated distributor's allocations and record explicit physical receipt.
New allocations remain unusable while `PENDING_ACCEPTANCE`; successful
acceptance records the account/timestamp and activates the serial range.
Distributor packing records an explicit requested/not-requested physical-copy choice and,
when requested, the allocated bill number. The backend validates ownership and
range before accepting it and blocks subsequent packing, NCM handoff, and
self-delivery dispatch until the choice exists. Delivered-sale posting copies
the recorded number to `SalesInvoice`; accepted returns/exchanges append linked
`SalesInvoiceAdjustment` records without rewriting the original bill. An
unequal-value distributor exchange with a requested physical copy captures a
new allocated number before replacement dispatch; an equal-value exchange
retains the original. NCM exchange approval submits immediately, so the Admin
approval validates and records any requested unequal-value replacement bill
number against the settlement distributor's active allocation. Distributor
exchange inspection and dispatch endpoints remain restricted to distributor
routes. These endpoints do not print or submit statutory
invoices/credit notes or call an IRD/third-party e-billing provider.

New physical bill-range allocations begin in `PENDING_ACCEPTANCE`. A distributor
can list only its own ranges and explicitly accept receipt through the
distributor-scoped paper-bills endpoints. Acceptance records the account and
timestamp, changes the range to `ACTIVE`, and is required before bill-number
validation for order packing. Existing active allocations remain usable for
backward compatibility; they predate receipt-confirmation tracking.

Newly initialized databases seed loyalty, marketing cards, and customer letters as disabled by default. Their admin-controlled feature flags do not affect core production, stock transfer, customer order, or delivery operations.

Marketing collaborations have been decommissioned: the `/api/collaborations`
router is no longer mounted, partner/admin/manufacturer collaboration
permissions are inactive, and collaboration-linked products and bundles are
unpublished/inactive. Existing collaboration tables and posted accounting
records are retained for history; delivery accrual and return adjustment logic
continues to reconcile already-recorded collaboration sales.

### Key route examples from the actual code

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/admin/product-analytics/summary`, `/products`, `/locations`, and `/timeline` require the `ADMIN` role and `product:sales_analytics_read`. Each endpoint returns a focused aggregate; timeline requests validate the selected product ID and all date/page/sort filters are checked server-side.
- `GET /api/admin/product-analytics/charts` requires the same Admin role and permission. It returns bounded product, province/district, and distributor comparison series for quantity, item revenue, recorded COGS, completed refunds, and estimated gross product profit; `productId` narrows the distributor comparison to one validated product.
- `GET /api/admin/discount-analytics` and `/filters` require the `ADMIN` role and `product:sales_analytics_read`. The report supports all-time, today, week, month, year, and custom (up to 366-day) ranges, with category, province, district, distributor, and customer filters. It classifies saved item price reductions and order reward snapshots into product, place-wise, loyalty, marketing-card/voucher, combo-bundle, admin, and legacy categories; totals include paginated customer and order details. Canceled orders are excluded. Place-wise pricing replaces, rather than stacks with, the product setting discount. Free-shipping savings and historical orders without original-price snapshots are not inferable from persisted data and are explicitly excluded.
- `GET /api/distributor/product-analytics/summary`, `/products`, `/locations`, and `/timeline` require `distributor:product_sales_read` and authenticated distributor workspace context. Scope is derived from the session, never a client-provided distributor ID; the service omits revenue fields and rejects revenue sorting.
- `GET /api/features` and `PATCH /api/features` (the update requires `platform:features_manage`)
- `GET /api/storefront-content`, `PUT /api/storefront-content`, and `POST /api/storefront-content/upload-image` (updates/uploads require `platform:features_manage`; images pass secure upload validation before Cloudinary storage)
- `GET /api/admin/distributors/settlement-positions` requires `finance:payables_read` and returns distributor-wise open NPR receivables, payables, pending remittances, and net due. Aggregate net receivable/payable totals are summed per distributor and cannot cross-offset counterparties.
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
- The admin distributor directory and dedicated profile are served from `/api/admin/distributors`: `GET /` requires a search query of at least two characters and supports `page` and `limit`; `GET /:id/profile`, `/login-history`, `/inventory`, `/stock-returns`, `/returns`, `/exchanges`, and `/finance` load focused profile/history sections. `/finance/transactions`, `/finance/settlements`, and `/finance/activity` are separately paginated; activity merges legacy earnings requests, Admin-issued net-balance requests, and unlinked balance settlements while retaining source, cash, journal, payout-evidence, and remaining-amount references.
- These detail endpoints require the `ADMIN` role plus section permissions (`distributor:admin_detail`, `distributor:admin_sessions_read`, `distributor:admin_inventory_read`, `distributor:admin_stock_return`, `distributor:admin_returns_read`, `distributor:admin_exchanges_read`, or `distributor:admin_finance_read`). The seed does not grant `distributor:admin_*` permissions to distributor workspaces. Profile and rate changes reuse the audited admin profile and approved rate-card endpoints.
- Distributor stock-return APIs are `GET /:id/stock-returns` (inventory-read permission), `POST /:id/stock-returns` (idempotent request; dedicated stock-return permission), and `PATCH /:id/stock-returns/:returnId/review` (approve quantities or reject; dedicated permission). `POST /:id/stock-returns/:returnId/collections` records partial/full physical handovers, carrier references, evidence, and idempotent collection batches, moving stock to collection-specific transit locations. `POST /:id/stock-returns/:returnId/collections/:collectionId/receipt` records complete receipt counts, evidence, and discrepancies. `POST /:id/stock-returns/:returnId/collections/:collectionId/inspection` records an idempotent, quantity-reconciled warehouse condition assessment and proposed disposition routes. `POST /:id/stock-returns/:returnId/discrepancies/:discrepancyId/reviews` appends an idempotent investigation note/evidence record and marks an open discrepancy `UNDER_REVIEW`; it cannot assign responsibility, resolve the case, adjust stock, or post a journal. All these operations are non-posting; received units remain quarantined.
- Existing `GET /api/stock-transfers/admin?distributorId=...` and `GET /api/order-assignment/admin/all?distributorId=...` provide paginated inbound transfer and order/delivery history for the selected distributor. They are admin-role protected and accept the focused detail permissions in addition to their general listing permissions.
- Distributor detail remains separate from the manufacturer profile even when both profiles share an `AuthAccount`; the detail page links to the existing manufacturer page. Distributor inventory value is explicitly estimated from current product price/cost fields, not historical cost layers. The financial statement currently reports platform receivables as zero; it is not a general accounting-party receivables ledger.
- Admin distributor stock-return requests are separate from customer returns and replenishment `StockTransfer`s. All inventory is platform/admin-owned; distributor and return locations track custody rather than legal title. A request requires idempotency and is revalidated at review. Approval moves approved, unreserved units to a distributor-custodied `RETURN_HOLD` location. Collection batches move only handed-over units to collection-specific transit locations; receipt moves physically received good/damaged units to a return-specific `RETURN_RECEIPT` quarantine location. Damaged/missing counts open `InventoryDiscrepancy` records; missing units stay in transit pending investigation rather than being prematurely removed as a loss. Investigation notes and evidence are append-only under `InventoryDiscrepancyReview` and do not determine liability or disposition. A separate inspection records count allocations, condition notes, evidence, and a proposed review route without moving stock or authorizing disposition. These custody stages do not create an inventory acquisition, post GL entries, or perform impairment, donation, disposal, or sale. Production cost layers remain the carrying-cost source where available. Generic Treasury outflows do not create inventory cost layers and must not be used to capitalize the same goods again when settling a payable. A non-tax `OUTFLOW`/`EXPENSE` may carry a validated stock-return ID in `CashTransaction.referenceId`; return detail displays those linked transactions without changing their expense posting. Admins can export a CSV audit report containing the full return event history, SKU/collection/inspection details, evidence references, investigation notes, and linked operating expenses. Financial disposition still requires the applicable Nepal reporting framework and tax treatment to be implemented and versioned.
- The manufacturer directory links to `/manufacturers/:manufacturerId`, a dedicated admin detail page. It reuses the existing paginated manufacturer profile/update, production-request, stock-transfer, and settlement-request APIs. Focused APIs under `/api/admin/manufacturers/:id` provide paginated factory ledger inventory, manufacturer finance summary, and paginated journal transactions; each requires the ADMIN role and a matching `manufacturer:admin_*` section permission. The profile editor synchronizes an edited email to the linked login account; contract/account status changes remain on the existing contract-status flow. Inventory quantities come from factory `InventoryBalance` records, while production data distinguishes approved unit COGS from per-unit overhead.
- `GET /api/order-assignment/admin/unassigned` lists pending customer orders for admin retry through `POST /api/order-assignment/assign`
- `POST /api/returns/exchange/customer`
- `GET /api/returns/exchange/distributor`, `POST /api/returns/exchange/distributor/:id/process`, and `POST /api/returns/exchange/distributor/:id/payment-evidence` for approved self-delivery exchange steps and exact-amount price-difference proof
- `POST /api/returns/exchange/admin/:id/payment-review` for Admin verification or rejection of distributor-submitted price-difference proof
- `GET /api/returns/exchange/admin` (admin exchange list; serializes the related order's `BigInt` date as a decimal string for JSON clients)
- `POST /api/returns/customer/request` and `GET /api/returns/customer/requests`
- `GET /api/returns/customer/admin/requests` and `POST /api/returns/customer/admin/:id/decision`
- `POST /api/returns/customer/admin/:id/retry-ncm`, `/:id/inspection`, and `/:id/refunded`
- `POST /api/returns/customer/admin/:id/resolve-ncm` for verified ambiguous return outcomes
- `POST /api/returns/customer/admin/:id/reconcile-ncm` polls the full status history for an active NCM return, replays usable timestamped events oldest-first without a fixed history cap, and ignores events older than the return request. The response reports skipped/unusable entries and the Admin UI warns on partial reconciliation; return-event metadata retains the Admin actor and `NCM_POLL` source.
- `GET /api/returns/customer/manufacturer` for the manufacturer's inbound return queue
- `POST /api/returns/exchange/admin` for an admin-created exchange case
- `GET /api/delivery/admin`
- `POST /api/delivery/admin/reconcile-active` reads and applies current NCM status for up to 25 active customer deliveries per request; supports keyset continuation via `afterId`.
- Optional `npm run delivery:ncm-reconcile` is an externally scheduled, disabled-by-default one-shot poll for stale active NCM deliveries. It skips records flagged for Admin review and uses `SCHEDULED_RECONCILIATION` audit events.
- `GET /api/delivery/admin/ncm/deliveries` and `/api/delivery/admin/self-deliveries` provide separate paginated, database-backed admin monitors with Kathmandu-local date filters; `GET` detail routes load order, status-event, return/exchange, distributor-rating, and settlement data on demand.
- `GET /api/delivery/admin/settlements/candidates` returns date-filtered delivered NCM COD candidates; `GET /api/delivery/admin/settlements/batches` lists recent bulk remittances. Admin selects deliveries for `/api/delivery/admin/settlements/request` and confirms one actual net deposit plus any explained variance through `/api/delivery/admin/settlements/confirm`. COD transfer requests validate bank and account-holder names as text and account numbers as digits on both the Admin UI and backend before calling NCM; upstream 4xx responses return sanitized provider field errors without echoing submitted bank values.
- `/api/delivery/admin/ncm/*` exposes bounded, permission-protected documented NCM reads and explicit tools (status comparison is limited to selected known local IDs; ticket, comment, webhook, redirect, branch, rate, label, staff, and customer operations). `GET /api/delivery/admin/ncm/tickets` serves active/closed ticket summaries from `NcmSupportTicket` without contacting NCM. NCM ticket-creation responses return the ticket ID as a scalar `ticket` field; successful support-ticket and COD-settlement ticket create/detail/reply/close operations upsert that local index. Mutating calls are audited, and ambiguous provider outcomes are not retried automatically.
- `POST /api/delivery/admin/:id/resolve-ncm-handoff`
- `POST /api/delivery/manufacturer/return` requests an NCM return for an eligible manufacturer/distributor delivery. The request remains `RETURN_REQUESTED`; it does not set physical `returnedAt`, mark the order fully returned, reverse COD/payment, or post a refund/restock/accounting adjustment. Delivery settlement writes are part of the webhook transaction and failures propagate for retry.
- `GET /api/marketing-cards/admin/cards`
- `GET /api/marketing-cards/admin/partners/:partnerId/analytics` returns partner-scoped campaign, distributor, and province/district aggregate reporting; it requires `marketing_card:analytics_read`.
- `POST /api/marketing-cards/customer/cards/scan`
- `GET /api/admin/gifts/catalog`, `POST /api/admin/gifts/catalog`, `DELETE /api/admin/gifts/catalog/:id` (archive)
- `GET /api/admin/gifts/tiers`, `POST /api/admin/gifts/tiers`, and `POST /api/admin/gifts/assign-distributor`
- `GET /api/admin/gifts/stock` and `GET /api/admin/gifts/orders` provide bounded Admin inventory and un-packed assignment views; `GET /api/admin/gifts/orders/:orderId/options` and `PUT /api/admin/gifts/orders/:orderId/gift` support exact-value replacement before packing
- `GET /api/distributor/gifts/inbound` and `POST /api/distributor/gifts/:id/respond`
- Distributor receipt acknowledgement includes the counted quantity received; only accepted, acknowledged available stock can be allocated.
- `GET /api/distributor/gifts/order-options/:orderId` returns eligible gifts only from the authenticated distributor's accepted, available inventory
- `GET /api/manufacturer-inventory/my/:productId/movements` returns that manufacturer's paginated per-variant stock adjustment history; `POST /api/manufacturer-inventory/update` stores quantity changes and history rows atomically
- `GET/POST/PATCH /api/distributor/orders/direct` list, create, and update direct distributor hub orders; `GET /api/distributor/inventory` preserves its SKU-level response for existing consumers, while `?groupBy=product` groups variants and aggregates on-hand, reserved, available, and damaged quantities; `GET /api/distributor/inventory/:inventorySkuId/details` returns scoped ledger movement history
- `GET /api/manufacturer-production/dashboard` returns manufacturer-scoped factory balance and completed/inspected production metrics
- At the distributor `letter_ready` transition, the backend automatically selects one exact-value physical gift for the whole checkout group from already-assigned distributors' accepted stock, prioritizing matching district, then province, then other eligible assigned hubs; choice among equivalent stock is randomized. Allocation reserves stock atomically, and the gift is exposed in the hub packing checklist for confirmation; delivery transitions deduct the reserved unit. A card gift claim creates a pending customer entitlement for a future checkout; additional entitlements are retained when one checkout can receive only one physical gift. Admin replacement uses only the same distributor's accepted exact-value stock and atomically rejects orders that have entered packing. `POST /api/distributor/gifts/returned/:orderId` records an explicit returned-or-lost decision.

Physical gift assignment is automatic and backend-authoritative. A scanned-and-claimed Own Store card gift creates an entitlement, and selecting a loyalty reward with a configured gift creates an exact-value entitlement for that checkout. Checkout reserves the selected loyalty entitlement first, otherwise the oldest pending card or loyalty gift entitlement. At the distributor `letter_ready` transition the backend chooses one exact-value gift for the checkout group from already-assigned distributors' accepted inventory, preferring matching district, then province, then other eligible assigned hubs; any catalog category may match. When no assigned distributor has matching stock, the order continues without a gift, and the reserved entitlement returns to the pending queue only after every shipment in the checkout group is packed, allowing a later checkout to retry it. Order-value rules do not create physical gift entitlements. Allocation reserves the selected batch atomically and writes a distributor movement log. On assignment detail reads and distributor gift-inventory refreshes, the backend reconciles legacy un-packed unsupported gift assignments: it clears the checklist item, restores the reserved unit to available stock, and cancels the stale entitlement; packed orders, valid claimed-card gifts, and assigned loyalty gifts are preserved. The packing checklist confirms the assigned gift; delivery consumes the reserved unit. Admins can replace a gift only before packing with same-value accepted inventory from the assigned distributor. Legacy manufacturer gift rows remain for historical records; the manufacturer gift-stock routes are no longer mounted.

Direct hub orders are created as `DIRECT_DISTRIBUTOR`, scoped to the authenticated `req.distributorId`, and deduct each selected SKU through the distributor inventory ledger in the same transaction as order and assignment creation. The deduction consumes unreserved stock by FIFO cost layer and snapshots COGS/VAT recognition data on the order item, so both walk-in and phone sales carry their inventory cost into the delivered-sale journal. Legacy stock without cost-layer provenance uses the admin-controlled product cost as a COGS fallback and reduces inventory; confirmed returns reverse the same inventory cost and payment account. Legacy version-1 per-unit delivery/other cost is expensed separately against manufacturer payable; version-2 batch other cost is already included in unit COGS. Paid direct cash/COD sales debit cash on hand; unpaid phone orders debit customer receivables, and a later payment confirmation clears that receivable. They do not use manufacturer assignments or `ManufacturerInventory`; the manufacturer direct-order API is no longer mounted.

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
The customer checkout delivery charge is kept separate from the NCM carrier
fee. NCM gross fee, discount, and net fee are recorded separately; remittance
and carrier-fee accounting use the net fee, while customer COD remains unchanged.
When NCM does not provide discount data to the integration, Admin can record
the gross fee and discount from the NCM order details before confirming
remittance. The update is audited and locked after settlement.
Admin can resolve recorded bulk-remittance variances through a dedicated
permission-protected route. Shortfalls are collected against the remaining
batch COD receivables; overpayments can be refunded or offset against open NCM
COD receivables. Each partial resolution is idempotent and transactionally
links its journal, cash movement where applicable, document allocations, and
immutable evidence record. The original signed variance is retained, and no
automatic write-off or income recognition is performed.
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

The Admin distributor Finance detail derives gross receivable, gross payable,
and signed net balances from all open party accounting documents; it never
stores a mutable net-balance counter. Admin issues a partial or full net
settlement request, tracked by `DistributorSettlementRequestToken`; issuing a
request does not post accounting. For company collections, the distributor
submits a transfer reference and evidence, then Admin verifies the received
funds. For company payouts, Admin records the completed transfer and evidence,
then the distributor acknowledges receipt. The accounting posting allocates
the lower gross side first (FIFO), then posts the remaining cash movement.
Posting creates one balanced journal, Treasury cash transaction, document
allocations tagged `CASH` or `OFFSET`, a batch record, and an audit event in one
serializable transaction. A posted cash movement requires a transfer
reference and active NPR Treasury account. An offset requires a set-off
agreement reference and explicit Admin confirmation; gross AR/AP documents
remain visible. Pending legacy COD remittances and legacy pending distributor
payout requests block new unified requests until reviewed. The workflow
requires explicit Admin confirmation and a recorded set-off reference as an
internal business control; the application does not make legal
determinations.

The legacy earnings payout request and Admin-issued net-balance request remain
separate business records and are not interchangeable. Request creation is
serialized on the distributor row and rejects an active request in the other
workflow; direct balance postings reject an active net-balance request unless
they are posting that request with its own idempotency key, and legacy payout
initiation/recording also rechecks active unified requests to prevent
overlapping payments. Admin finance activity presents both request types and
unlinked posted balance settlements in one paginated history.

Completed distributor return/exchange logistics create source-linked payable
bills under the distributor accounting party, and those bills are included in
the same statement and unified settlement allocation flow as other open
distributor liabilities. Existing logistics entries held only in legacy
`AccountPayable` remain separately visible and block unified settlement until
resolved there. NCM return/exchange liabilities remain in Accounts Payable;
confirmed carrier charges are preferred over configured estimates, and
customer-paid NCM charges do not accrue as company payables.

Manufacturer post-production QA now enters `PENDING_ADMIN_ACCEPTANCE`; inventory
and production cost layers are recorded only after Admin accepts the reported
good-unit counts. In that same transaction, accepted good-unit value and
input VAT is posted to inventory/input VAT against manufacturer payable only
when the manufacturer profile declares VAT with a 9-digit ID, the supplier invoice is
verified and dated, and the buyer's VAT registration was effective on the
invoice date. The idempotent production bill snapshots the manufacturer's PAN
or VAT ID and records the gross payable; supplier VAT that is not recoverable
is capitalized into inventory. The cost layer snapshots recoverability.
Delivery consumes that cost layer and relieves
inventory without accruing the payable a second time. Legacy stock with
delivery-recognized costs retains its existing
path. Manufacturer payouts allocate against production and delivery bills;
returns create supplier credit notes only when a delivery bill exists. New
distributor settlement requests without earning documents do not accrue AP from
the requested amount and remain blocked until historical earnings are
reconciled. Manufacturer, distributor, and generic payable payouts require an
active NPR Treasury account mapped to the correct cash/bank/wallet GL account.
Older distributor settlement requests retain their legacy payout lifecycle;
new Admin-issued requests reconcile COD and posted distributor payable
sources together through the party subledger.

Manufacturer request availability reserves the remaining unpaid amount of
both `PENDING` and `PARTIALLY_PAID` requests. Manufacturer finance history is
available through a paginated, manufacturer-scoped endpoint, while Admin can
filter settlement requests by partial-payment status. Both histories enrich
each request with its payout attempts, treasury account, transfer and bank
evidence references, and the linked cash transaction and payment journal when
posted; this uses payout idempotency keys rather than ambiguous manufacturer-
wide cash references.

Manual local stock-transfer dispatch posts delivery expense 6430 and manufacturer
payable 2160 together with an idempotent shipment-linked payable bill.
Manufacturer logistics payouts allocate against these freight bills separately
from production bills; unmatched paid amounts remain explicitly unallocated.
Accounting Health reports source-scoped 2160 journal-to-bill comparisons for
accepted production requests and local freight shipments. It does not reconcile
legacy delivery-accrued costs, other manufacturer payable sources, or opening
balances, so the manufacturer payable control remains incomplete.
The same health report compares platform-funded customer-return and exchange
downgrade refund AP originals with their source-linked 2110 journal credits.
It displays paid and outstanding AP amounts but does not reconcile payment
clearing, distributor-funded refunds, legacy AP, or the full 2110 control.
For accounts receivable, it separately compares collaboration-fee invoice
totals, their receivable documents, and the 1130 invoice debits. Existing
document allocations are checked against the document balances and their linked
posted 1130 receipt journals. This does not establish a collaboration
collection workflow, cover unlinked or legacy collections, reconcile
credits/reversals, or complete the 1130 control.

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

The same permission protects admin updates to the singleton `StorefrontContentConfig`. The public endpoint supplies announcement messages, the shared header/footer logo URL, three policy/benefit cards, footer description/contact details, About page content, and ordered sign-up Terms & Conditions. The logo falls back to the bundled storefront asset when no custom image is set. Customer registration and social-profile activation require the current terms version and create an append-only `CustomerTermsAcceptance` record in the same transaction as account activation. Each record retains the exact accepted terms snapshot, SHA-256 version, server timestamp, source, IP address, and user agent. Long-form descriptions retain newline and paragraph whitespace through request sanitization and storefront rendering. Each benefit card stores its image URL, title, and description; uploaded images are checked by the secure image-upload middleware and stored in Cloudinary.

Own Store campaign creation and public/organization card assignment use the additional `marketing_card:own_store_manage` and `marketing_card:custom_assign` permissions. Public, marketing-partner, and custom-organization Own Store cards are available to signed-in customers without a delivered-order ownership check; their code entry, QR attempts, and successful scans are recorded as card events. The first successful QR scan consumes a physical card; the backend rejects subsequent scans by the same or another account. The campaign's `maxScansPerCustomer` setting (default one) limits each account across those assignment types for the campaign lifetime, in addition to the weekly campaign cap of five; organization-assigned cards also have a two-per-organization campaign lifetime cap. Distributor-assigned Own Store cards follow a separate order-reward path: attachment records the distributor and order, and only the account on that delivered order can scan and claim the card. These distributor-issued cards are exempt from the weekly, campaign-account, and organization scan caps, so the same customer can claim a separate card reward from multiple eligible orders; each physical card remains single-use. Physical card stock is assigned to active distributors, with receipt and order attachment performed under distributor context. An attached fulfillment card is valid only while its campaign is active and both its campaign end date and card expiry date have not passed. If it becomes invalid before fulfillment, the old card is cancelled and unlinked, the distributor portal attempts to attach an eligible replacement from received stock, and fulfillment is blocked until a valid card is attached. Customer scan quotas and reward eligibility are enforced in backend services; `POST /api/marketing-cards/customer/claim-reward` claims eligible Own Store discounts, vouchers, and gifts, and `GET /api/marketing-cards/customer/rewards` lists active claims for checkout.

Checkout accepts a single explicit reward choice (`CARD`, `LOYALTY`, or `NONE`) and applies no reward when the choice is omitted. Card discounts are recalculated and validated from the claimed reward on the server, while redemption is changed to `REDEEMED` in the same transaction as order creation. Card and loyalty benefits cannot be stacked; loyalty reward usage is not consumed by an order using a card reward. A physical Own Store card's gift benefit creates an entitlement only after the customer scans and claims that card.
Own Store percentage discounts may set an optional `MarketingBenefit.maxDiscountAmount`; checkout applies the lower of the percentage discount, that cap, and the eligible item subtotal.

### MFA / portal rules

- Privileged-portal MFA is enabled by default and controlled by the backend `MFA_ENABLED` environment variable (`true` or `false`). When enabled, `isMfaEnforced()` and token validation require MFA across login, refresh, workspace switching, and authentication middleware. When explicitly disabled, privileged portals use password-only authentication and MFA challenge endpoints are unavailable. Notification configuration does not change the MFA policy; with MFA enabled, unavailable notification delivery prevents privileged sign-in.
- The code supports admin two-factor challenges and portal-specific authentication flows.
- Password-change enforcement is active for admin accounts with `mustChangePassword`.

### Password recovery

`POST /api/auth/password-reset/request`, `/verify`, and `/complete` implement SMS-only password recovery for CUSTOMER, MANUFACTURER, and DISTRIBUTOR accounts. Requests require both the login email and contact number to match the same active account, and the account's primary role and active profile must match the selected portal; an alternate workspace role does not authorize cross-portal recovery. An ineligible request returns a portal-specific not-found response; this intentionally identifies account/portal eligibility to help users select the correct login portal. Eligible requests enqueue an encrypted SMS through the notification outbox. Before creating the challenge or queuing an SMS, the backend atomically enforces one request per rolling seven days and at most three per UTC calendar month. The last-request timestamp and monthly quota are stored on `AuthAccount`; quota violations return HTTP 429 and do not issue a challenge or SMS. IP rate limits also cover request, OTP verification, and completion routes.

OTP verification consumes the challenge and issues a random, short-lived `tfaToken`; its lifetime is controlled by `PASSWORD_RESET_TFA_TOKEN_LIFETIME_MINUTES` (default 5, range 1–30). `PASSWORD_RESET_MAX_ATTEMPTS` controls OTP attempts per challenge (default 5, range 1–10). Password completion requires the token and atomically consumes it once. Password reset updates the bcrypt hash and revokes all active account sessions in one transaction. The UI returns to the ordinary login flow; it does not create a session automatically. The OTP remains the fixed six-digit code `111111`; password recovery is enabled only in `development` and `test`, and is unavailable in staging, production, and unspecified environments. Do not enable it in other environments or change the code without an explicit decision. The quota fields are in the checked-in `0_init` baseline; older notes citing `20261016000000_add_password_reset_limits` refer to an absent historical migration ID, not a deployment command.

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

Place-wise pricing is tied to the distributor selected by checkout, not manufacturer service coverage. The pricing layer canonicalizes the customer's Nepal province/district and matches a `LocationProductDiscount` by product, customer district, and selected distributor. Checkout selects the distributor from active hubs and distributor-ledger stock; manufacturer coverage and `ManufacturerInventory` do not affect this price. Split shipments resolve each product line against its own hub. The resulting distributor, district, discount, and unit price are frozen in the order snapshot. If the selected hub's stock changes after a place-wise discount is quoted, allocation does not silently fall back to another hub at that price; the order stays pending until it can be fulfilled by the priced distributor. Existing rules without a `distributorId` remain legacy all-distributor rules.

After creating a storefront or admin order, the order API waits for the distributor allocation engine. It first prefers one active distributor with sufficient platform-owned distributor-ledger stock for every requested product variant and quantity. If none exists but active hubs collectively cover the cart, it plans separate product orders by stock-bearing hub (splitting a variant quantity across hubs when required), then creates one independently assigned order and delivery per product/hub pair. Each product order stores only its own item lines; orders from one checkout share an indexed `checkoutGroupId`. The checkout's configured split-shipment fee is applied once to the group, with separate door-to-door and door-to-hub rates. Routing priority is: same registered district; exact configured service-district coverage; matching NCM pickup branch; same province; then any stocked active distributor nationwide. If no service areas are configured, the registered province/district remains the default coverage. This prioritizes a locally registered stocked hub over a remote hub that merely lists the customer district as a service area, so the route rate reflects the local hub's actual origin. Each tier is ranked by distributor quality rating, then rating count, then stable ID. Allocation uses only province, district, and NCM branch—not street address or free-form city proximity. Shipping quotes and final order creation use the selected `province` before the legacy `state` field and normalize district labels before calculating the route rate. When the likely distributor and customer are in the same district/service zone (including the Kathmandu Valley cluster), delivery is door-to-door only; otherwise customer checkout and admin social orders may select door-to-door or NCM door-to-hub pickup. Same-province, cross-province, and split-shipment door-to-door/door-to-hub tariffs are independently configurable in Shipping Settings. Order creation recalculates the selected method and fee server-side. Stock reservation and each `OrderAssignment` creation are transactional; there is no manufacturer fallback. If combined stock is insufficient, the API returns per-variant required and available quantities for active distributors. Distributor assignment history remains visible in the distributor Orders list after an order is placed on the delivery queue or handed to NCM; the assignment detail is read-only after queue handoff or carrier booking/delivery, and the status-update API rejects further fulfillment edits.
An Admin with the dedicated `order:control` permission may explicitly select a distributor for a failed, unassigned online order. The endpoint requires an audit reason, validates the selected hub is active and eligible, reserves all requested variants transactionally, and does not fall back if that hub lacks stock. Admins may also reroute an existing distributor assignment while its status is `assigned`/pending acceptance or rejected, provided no delivery record exists; the assignment table exposes the control before the distributor accepts. This transaction reserves the target hub's exact SKU quantities, releases the source hub's matching reservation, synchronizes storefront stock, and records the reason in the audit outbox. Any reservation mismatch, concurrent fulfillment change, or target stock shortage aborts the transaction. Manufacturer assignments and orders already accepted, in fulfillment, cancelled, or handed to delivery cannot use this reroute operation. The existing distributor-priority allocation path is unchanged for automatic assignment and ordinary retries.

Admins with `order:control` can also advance an assigned order through the next validated fulfillment stage from its control timeline. The endpoint requires a reason and uses the normal acceptance transaction when accepting an assignment, including manufacturer cost snapshots and production-layer allocation. Later stages reuse the fulfillment state machine, card/checklist prerequisites, gift allocation, and packing lifecycle based on the assigned hub type. Admin control cannot roll stages backward or alter carrier/delivery statuses; it is disabled once a delivery record exists. Each successful Admin stage update is recorded in the system audit outbox.

The admin financial dashboard calculates product COGS from accepted per-order cost snapshots first, then from production cost layers completed by the selected month (weighted by produced units) for distributor-fulfilled inventory. Approved manufacturer inventory cost is the next fallback, with `Product.costPrice` retained only for legacy products without approved cost records. Its live balance-sheet inventory value sums current on-hand stock in platform-owned inventory locations (excluding stock recorded as lost), valuing cost-layered units using their production COGS and falling back to `Product.costPrice` only for uncosted or legacy stock. Manufacturer-to-distributor transportation and logistics overhead is sourced separately from dispatched MANUAL `StockTransferShipment` records in the selected dispatch month: each shipment's `freightCharge` is counted once, and the detail identifies its local delivery partner and stock transfer. Order-level delivery/other-cost snapshots and weighted product cost-layer overheads are not used for this finance category; NCM carrier charges remain separate. The posted financial statement's account 6430 likewise excludes legacy per-order delivery-sale overhead journal lines; actual carrier settlements, local transfer freight accruals, and recorded delivery expenses remain included, with shipment freight booked once at dispatch. Recorded fixed and marketing expenses are itemized from the selected month's operating-expense records. The existing authenticated `finance:dashboard_read` route protects both summary and detail data.

The posted Profit & Loss statement recognizes COGS when a distributor-fulfilled order is delivered, not when production is approved or completed. Distributor receipt ledger movements retain the production cost-layer ID from the stock-transfer shipment allocation; self-delivery fulfillment and NCM delivery consume those received layer quantities, persist the consumed cost snapshot on the order for audit/history, pass the exact unit COGS and overhead into the delivery journal, and post the delivery sale and inventory relief in the same transaction. The self-delivery path must pass the full order and transaction client to the accounting poster. Transfers received before this provenance tracking was deployed remain uncosted in the ledger and are not backfilled with guessed production layers.

Admin selects the manufacturer, product SKUs and quantities, fabric/GSM, target date, and batch plan when creating a production order. The manufacturer submits per-piece pricing and batch expenses as a quote; the order stays out of production until an admin approves the quoted terms. The manufacturer then completes the required pre-production checks before starting, followed by post-production QA before stock receipt. Production quote terms capture VAT treatment as exempt, inclusive, or exclusive plus rate and supplier invoice reference. Admin approval records whether the invoice was verified. Production receipt recognizes input VAT only if the supplier invoice is verified and the business is VAT-registered at acquisition; otherwise VAT is included in inventory cost. The manufacturer payable remains gross. Cost layers retain the input-VAT recoverability decision so later registration cannot create a retroactive credit.

The Admin Tax Compliance page stores seller PAN/legal identity and effective `TaxRegistrationVersion` history. Missing registration history defaults to `PAN_ONLY`; output VAT is posted only for tax points inside an effective VAT-registration window. Append-only `VatRateVersion` records separately control the percentage. Delivered-sales and return journals resolve registration/rate by transaction tax point; customer-return snapshots retain the applicable treatment. Paper-bill records retain immutable sale/tax snapshots and allow Admin to record the actual paper number/date after issuance; they do not generate or submit a statutory bill or connect to an IRD e-billing provider. Operating-expense input VAT remains unclaimed until Finance verifies supplier VAT identity, invoice evidence and amount reconciliation and confirms buyer registration on the invoice date; approval reclassifies VAT to GL input VAT. Manufacturer production VAT recovery also requires retained invoice evidence and buyer registration at acquisition. VAT return drafts exclude netting/payment journals, include opening input/output VAT credits, reconcile covered sales and partial purchase sources to the GL, and reject overlapping periods. Filing and later IRD amendments preserve the assessed amount/reference/reason and post linked balanced journals; these are accounting records only, not statutory submission. Other purchase sources, returns, opening balances, and any source/GL variance remain for accountant reconciliation. Admin date entry and report periods use date-only Bikram Sambat values (`YYYY-MM-DD`) with explicit `calendar: "BS"` semantics. The backend performs the authoritative conversion to Asia/Kathmandu day boundaries. Financial report ranges retain their BS default; single-date tax mutation endpoints without a calendar preserve their previous input interpretation for backwards compatibility. The same mapping is used for accounting reports, journal filters/manual entries, fiscal periods, tax/VAT effective dates, payments, paper-bill reports, filing periods, partnership profit-distribution periods, and loan start dates. Fiscal-year setup requires exact Shrawan 1-through-Ashadh-end boundaries and transactionally creates 12 continuous BS accounting periods from the configured mapping. Verify periods and all documents with a Nepal-qualified accountant before filing.

Corporate income tax estimates use the shared `corporateIncomeTaxService` and effective-dated `CorporateTaxPolicyVersion` records, not a built-in percentage. Admin policy versions support a base rate, progressive brackets, and validated context rules for user/taxpayer/location matching, rate overrides, discounts, and penalties. The Tax Compliance API accepts optional preview context; financial statements use the same policy resolver. Monthly projections annualize the monthly taxable-income run rate for bracket calculation and divide the estimated annual liability by 12. Missing policy is reported as unconfigured, and estimates are not filing assessments. Policy configuration must be reviewed by a qualified tax adviser.

Distributor delivery earnings are recognized for completed self-delivery assignments and completed direct phone orders, using the approved delivery compensation; assignments with a corresponding NCM `DeliveryOrder` never create self-delivery earnings. Hub walk-in sales instead accrue the separately approved flat counter-sale compensation under `COUNTER_SALE`, posted to expense 6450 against distributor payable 2190. Admin rate-card revisions create versions rather than rewriting historical values. Verified returns of hub counter sales create an idempotent proportional `COUNTER_SALE_REVERSAL`, a payable credit note, and a debit to payable 2190 against credit to expense 6450. The credit note is offset against open service-earning bills; unapplied credit remains in the subledger and is carried to future service-earning documents. A product return does not reverse completed delivery compensation. Payouts allocate earning documents and clear 2190; legacy settlement records remain visible for reconciliation and are not double-accrued for new deliveries. Distributor service VAT is not claimed without verified supplier-invoice evidence.

Admins configure a per-distributor stock-transfer compensation per product unit on the general rate card. It accrues only after successful delivery, across NCM, self-delivery, direct phone orders, and hub walk-in sales; failed, stale, and repeated NCM events do not accrue it. The amount is additional to the configured channel-specific delivery or counter-sale compensation. Each earning snapshots its rate-card version, delivered unit count, and per-unit rate, creates an idempotent distributor payable, and posts to expense account 6440 against distributor payable 2190. A later merchandise return does not reverse completed-delivery compensation. Historical NCM-only `NCM_TRANSFER` earnings remain visible as stock-transfer compensation without being recreated.

The distributor rate editor exposes separate approved amounts for self-delivery/phone delivery and hub counter sales. The additive migration `20261101110000_distributor_compensation_channels` adds the counter-sale rate and tracks how much of each negative reversal has been applied to payable documents; apply it and regenerate Prisma Client before deploying the updated flow.

Delivered NCM COD creates party receivables against control 1170. Admin can select delivered COD orders within a Kathmandu-local date range and create one NCM transfer request for the batch. Confirmation records one actual net deposit; carrier fees clear payable control 2180, shortfalls remain open against NCM COD receivables, and overpayments remain in suspense payable 2185 until reconciled. The selected delivery links, batch journal, Treasury movement, and cash transaction are committed serializably. Accounting Health compares open NCM COD, distributor COD, NCM carrier-fee, and distributor-earning documents with controls 1170, 1190, 2180, and 2190 respectively. It also compares each stored GL account balance with journal-derived balances across posted and reversed journals; opening balances without posted journal support remain visible as variances. Its balance-sheet coverage registry enumerates the 23 configured control accounts and distinguishes source-scoped checks from legacy-partial, treasury-register-only, and not-reconciled controls; it does not infer a complete source balance. Legacy/opening balances are not auto-converted; Finance must review and approve a documented cutover. These checks do not reconcile all legacy and other-party documents, so overall accounting coverage remains partial until those sources are migrated and reconciled.
For NCM carrier fees, Accounting Health additionally matches each 2180 accrual journal to its payable bill, allocation, and 2180 debit in the linked NCM remittance journal. This is limited to the current NCM fee settlement flow; it does not establish historical carrier or broader 2180 completeness.

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
- Delivered NCM and distributor self-delivery transitions enqueue a versioned, hashed `AccountingEvent` snapshot in the same transaction as the delivery update. The scheduled delivery-accounting worker claims due events with conditional updates, retries transient failures, and posts through the central journal engine; journal creation and event completion share a transaction. Accounting APIs expose unresolved event status so reports can warn that unposted sales are excluded from GL figures. The checked-in `0_init` baseline includes the event retry and claim fields. The historical ID `20261017000000_delivery_accounting_outbox_schedule` is absent from the repository; verify the target database independently rather than treating older “unapplied” notes as current migration status.
- The Admin finance dashboard exposes a `postedAccounting` summary calculated from posted `JournalLine` rows, while operational cost detail remains a separate analytical view. Use posted journal totals for financial statements; display unresolved delivery-accounting outbox events as exclusions rather than treating them as posted.
- Admins configure Bikram Sambat years at `/nepali-calendar` by entering Baisakh 1's Gregorian date and the 12 month lengths. Saved definitions are immutable, created transactionally with an audit event, and use serializable validation to prevent overlapping concurrent saves; identical retries are idempotent. The backend derives dates and weekdays from that anchor; finance report ranges and Nepali fiscal periods use configured years, with the established converter retained for years not configured. A mapping correction requires a separately approved and audited correction workflow. Apply `20261107090000_nepali_calendar_years` and regenerate Prisma Client before deployment.
- Distributor COD/refund workflows depend on schema and migration state. Older notes cite `20261027100000_distributor_cod_and_return_cash` and `20261027130000_distributor_refund_receivable_netting`, which are absent from the checked-in migration history. Verify the actual target schema and `_prisma_migrations` records on an isolated copy; do not execute or mark either absent ID as applied.
- `npm test` in `backend/` runs unit/regression test files under `backend/tests/` sequentially; test files are isolated in individual Node test-runner processes and failures do not prevent later files from running. Tests that access the real Prisma database are opt-in with `RUN_DATABASE_INTEGRATION_TESTS=1` and must be run against an isolated, migrated/seeded test database because they create and mutate records.
- `operationalFlawsResolution.test.js` is database-backed and is gated by the sequential runner and a database-name check for an isolated test database. It intentionally does not delete prior test journals or fiscal years: deleting journal rows without reversing their stored account-balance effects corrupted balances in the local database.
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

Bulk list endpoints use `page` and `limit` query parameters. The shared backend defaults to page 1 and 12 records, caps requests at 50, and returns records once under the endpoint-specific response key plus `pagination: { page, limit, total, totalPages, hasNextPage, hasPreviousPage }`; avoid duplicating the list in a generic `data` field. The public storefront product list/detail responses use an explicit customer-facing projection and exclude internal product fields such as cost price and low-stock thresholds. Orders and transfers sort most recently updated first with their creation/request timestamp as a tie-breaker. The admin Orders, Delivery Monitor, manufacturer directory, Stock Transfers, manufacturer Factory Transfers, distributor inbound-transfer, and marketing-partner campaign screens send page parameters and render controls. Manufacturer and partner campaign search is applied before pagination; manufacturer details use an exact ID filter instead of assuming the requested item is on page 1.

Operational follow-up: the checked-in `0_init` baseline contains `SystemAuditOutbox`; older notes that instruct applying `20261005000000_add_system_audit_outbox` refer to an absent migration. Verify target schema and migration history before deploying audit endpoints or workers. Run the RBAC seed as appropriate for the target, monitor outbox entries in `PENDING`/`FAILED`, and establish retention, archival, and alerting policies before production audit volume grows. See [Security, Data Flow, and UI Audit](SECURITY_DATA_FLOW_AND_UI_AUDIT.md) for the static flow map, security observations, limits, and deployment checks. Client-bundled AES settings and browser local-storage access tokens remain security follow-ups; they are not a substitute for TLS or XSS controls.

The checked-in `0_init` baseline includes `Order.updatedAt`. Older notes citing `20261011203000_add_order_updated_at` refer to an absent migration; confirm that the target database has the column and the required order-list indexes before deploying queries that sort by it.

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
- NCM return approval calls `/api/v2/vendor/order/return` with the original NCM order ID and reason. This marks the original order for return rather than creating a new return waybill; NCM webhooks and Admin-triggered reconciliation poll the documented order-status history. Polling applies timestamped history oldest-first and ignores events older than the return request. `Sent to Vendor` is accepted as the warehouse-receipt milestone only for an active NCM return, while a generic `Delivered` status requires the return to have entered transit. Receipt only enables inspection; it does not itself post inventory, refund, tax, or accounting effects. Confirm this carrier label's exact operational meaning with NCM before relying on it in production.
- NCM exchange approval calls `/api/v2/vendor/order/exchange-create` with the original NCM order ID. NCM creates distinct return (`ven_order`) and replacement (`cust_order`) legs; the backend stores both IDs, attaches the return reason/replacement plan to the return leg, and Admin reconciliation replays each leg's full timestamped history oldest-first without a fixed history cap. Invalid or pre-submission entries are reported as skipped, with a warning in Admin. On the return leg, `Sent to Vendor`/`Returned to Vendor` or a generic `Delivered` after a pickup milestone enables warehouse inspection; a generic delivery before pickup does not. Confirm these provider status semantics with NCM before relying on them operationally.
- Approved distributor returns are assigned to the original distributor for receipt, QA, inventory adjustment, and return accounting. A partial return does not change the original order or assignment to `Returned`; that state is set only when the current and previously completed returns cover every purchased variant quantity. Approved distributor exchanges reserve replacement stock from that distributor's ledger; the distributor receives and inspects the returned units, dispatches the reserved replacement, and marks it delivered. Neither distributor route calls NCM.
- `ReturnExchangeNcmAttempt` stores each carrier request, response, HTTP result, error detail, and timestamps. Available NCM charges and the selected payer are stored on the case.
- NCM HTTP 5xx responses retry up to three times by default; every transport attempt is included in the case audit. Timeouts are not blindly retried and remain an unknown outcome for admin reconciliation.
- Because exchange-create accepts only `pk`, the backend attaches the recorded return cause and replacement plan to the new `ven_order` using NCM's order-comment endpoint; NCM does not accept the replacement SKU or price delta in the exchange-create request.
- Return webhook milestones include Pickup Complete, Sent for Delivery, Dispatched, Arrived, and Delivered; updates are applied monotonically. A return leg is not marked received from an unsequenced generic `Delivered` status; a pickup milestone must precede it unless NCM explicitly reports `Sent to Vendor`/`Returned to Vendor`.
- The NCM return endpoint does not document a separate reverse-pickup tariff. The system records a charge from the return response when present, otherwise the documented order-detail `delivery_charge`, and records which source supplied it.
- NCM rejection is failed/retryable, not success. Ambiguous outcomes must be reconciled before retrying.
- Return webhooks use a separate state machine. Inventory is adjusted only after manufacturer receipt and inspection; refund payables are created after inspection, and a return closes only after settlement.
- Admins configure separate NCM/distributor return and exchange logistics settlement rates in Shipping Rate Settings. The selected rate is snapshotted at approval, is not charged to the customer, and becomes an accounts payable to NCM or the original distributor only when the logistics workflow completes. The NCM-reported carrier charge remains a separate actual-charge record.
- Return and exchange sales/VAT adjustments post in the current accounting period when the refund is completed or the replacement is delivered. For distributor self-delivery returns, inspection separately posts the returned-item cost adjustment in the current period: restockable goods debit inventory and credit COGS; defective goods debit account 5500 (damaged/scrap loss) and credit COGS. The inspection journal has its own idempotency key and `CustomerReturn.inventoryAccountingJournalEntryId`; refund verification posts only the sales/VAT and distributor-payable adjustment, preventing duplicate cost reversals. Distributor inspection is rejected if the original unit cost is missing or invalid. Manufacturer/NCM returns continue posting their sales/VAT and inspection cost adjustments together when inspected. Returned-item cost uses the original order cost snapshot; replacement COGS uses the cost captured when the exchange is requested. Credit-note references remain linked to the refund journal.
- Accounting Health source-matches platform-funded customer return refund payables (`CUSTOMER_REFUND` / `SALES_RETURN`) and exchange downgrade refund payables (`CUSTOMER_EXCHANGE_REFUND` / `ORDER_EXCHANGE`) against their 2110 journal credits. This original-obligation check does not reconcile AP payments or the full AP control.
- Exchange price upgrades/decreases are split into net revenue and VAT. For both NCM and self-delivery exchanges, the responsible distributor records exact-amount customer collection/refund evidence in `DistributorCashEvent`, and Admin verifies it. Self-delivery replacement dispatch may proceed, but delivery/completion is blocked until evidence is verified; zero-difference exchanges are unaffected. For NCM, the assigned distributor handles the price difference separately from carrier transport. Upgrade collections create a distributor COD receivable, downgrade refunds create a distributor payable, and evidence verification does not itself settle that balance. NCM's exchange-create contract accepts only the original order ID (`pk`), so NCM transports the replacement but does not collect or pay the price difference.
- NCM exchange replacement stock follows the manufacturer reservation and carrier-status lifecycle. For self-delivery exchanges, reserved distributor-ledger stock is consumed at dispatch; the distributor must receive and inspect the return before dispatch, then mark the replacement delivered. Good returned items are ledgered as `RETURN`; damaged items are ledgered to `DAMAGED` and recorded as open inventory discrepancies.
- NCM exchange replacements are not variant- or price-adjusted by NCM's API call. The requested variant is stored/reserved internally, so admins must verify the NCM replacement waybill; the assigned distributor separately handles and evidences any price difference.
- Existing processed return rows are preserved as `LEGACY_PROCESSED`; new requests use the reviewed lifecycle rather than the old immediate refund/restock route.
