# Aama Clothings — Distributed E-Commerce Ecosystem

## 1. Project Summary

Aama Clothings is a multi-portal clothing commerce platform built around a central Node.js + Express API and MySQL Prisma data layer. The system supports a customer storefront, a business admin portal, manufacturer operations, distributor hub operations, marketing partner campaigns, and delivery/NCM fulfillment workflows.

The repository separates factory production and replenishment from customer-facing distributor hub fulfillment. Production completion creates factory inventory only; storefront product availability is projected exclusively from unreserved stock in active distributor ledgers, and transfer stock is not sellable until the distributor records receipt. Customer checkout prefers one active distributor with stock for the full cart; when no single hub can fulfill it but multiple hubs collectively can, it creates product-specific orders and separate deliveries under a shared checkout group, using the admin-configured flat split-shipment fee once. Active distributors with exact delivery-area coverage receive priority, including when a business account also has a manufacturer profile. The manufacturer portal dashboard distinguishes factory stock, produced good units, and damaged units.

## 2. Technology Stack

| Layer | Current implementation |
| --- | --- |
| Runtime | Node.js (project docs specify Node.js 18+), Express 4.21.1 |
| Backend ORM / DB | Prisma 5.22.0, MySQL via `DATABASE_URL` |
| Frontend | React 18.3.1 + Vite 5, React Router 6/7, Tailwind CSS 3 |
| Manufacturer portal | React 19.2.8 + Vite 8 + Tailwind |
| API auth | JWT access/refresh tokens; custom RBAC enforcement; privileged-portal MFA controlled by backend `MFA_ENABLED` (enabled by default) |
| Storage | Cloudinary integration for product/media/contract uploads |
| Payments | Stripe, Razorpay |
| Email / SMS / notifications | SMTP + Sparrow SMS primitives and a notification worker, but production enablement is still gated |
| Delivery integration | Nepal Can Move APIs and webhook handlers |
| UI libraries | `react-toastify`, `lucide-react`, `qrcode`, `jspdf`, `xlsx`, `leaflet` |
| Security tooling | `cors`, `express.json`, custom sanitization middleware, JWT validation, auth rate limits |

## 3. Current Development Status

### Fully implemented / active

- Customer storefront browsing, cart, wishlist, product search, order placement, return/exchange flows, and marketing-card redemption UX.
- Customer checkout now verifies server-authoritative location pricing by province/district and stores the resolved local-discount manufacturer, price snapshot, and assignment context on the order.
- Admin portal with catalog management, orders, manufacturer management, inventory monitoring, financing/accounting, tax, refunds, shared shipment-rate tiers with optional corridor overrides, access control, and exchange/return reconciliation.
- Admin manufacturer management includes a dedicated, permission-scoped detail page for profile, factory ledger inventory, production costs/QA, distributor transfers, finance, journal transactions, and payable requests, while reusing existing paginated operational APIs where possible.
- Admin-only Platform Feature Settings control customer loyalty, marketing cards, and letters across the storefront, partner, and distributor workflows. Newly initialized databases seed these optional features as disabled; admins can enable them without deleting existing loyalty or letter progress.
- The admin customer CRM is search-first and provides a customer 360 history. Admins with `customer:account_manage` can disable/re-enable accounts; disabled identities remain reserved, active sessions are revoked, and CUSTOMER access is rejected during login, access-token validation, and refresh.
- Gift promotion operations across the Admin and distributor portals: Admin-managed gift catalog and exact-value rules, distributor stock dispatch and counted receipt acknowledgement, and random automatic selection from accepted stock at distributors assigned to a checkout. Split shipments share one physical gift; unfulfilled card/loyalty rewards remain available for a later order.
- Manufacturer portal with production, factory dispatch, pickup profile, performance, and finance; customer-facing hub fulfillment tools are in the distributor workspace.
- Distributor hub operations for ledger-backed inventory, direct phone/walk-in orders, gift stock, marketing-card receipt and attachment, loyalty customers, and assigned customer-order fulfillment.
- Distributor self-registration collects the same business identity, Nepal province/district, NCM branch/covered area, pickup contacts, return instructions, and contract dates as manufacturer registration. Its base district becomes initial exact order coverage; admins can edit the profile and separately manage additional service districts.
- Location-aware assignment prefers an in-stock active distributor covering the exact district, then an in-stock distributor in the same province, then ranks other in-stock hubs by verified customer ratings. All tiers require every ordered variant and quantity to be available in distributor-ledger stock, reserved transactionally. Customers can review a distributor after delivery; admins can retry older unassigned orders in the allocation monitor.
- Marketing partner portal with login, campaigns, campaign detail, card management, redemption validation, and reporting routes.
- Admin marketing partner detail pages show current/expired campaign card, scan, and reward metrics, distributor assignment/attachment/claim totals, and province/district-level scan and distribution summaries. Partner accounts enter through public signup and admin approval rather than direct admin creation.
- Delivery and NCM integration for ready-for-pickup, webhook handling, manual handoff recovery, delivery settlements, and return workflows.
- Distributor self-delivery COD is gated by customer OTP and recorded as distributor receivable until an Admin verifies an evidenced remittance. Distributor-paid customer refunds require return receipt/inspection, exact approved refund amount, payment evidence, and Admin verification before a separate distributor payable is created. New self-delivery completions also snapshot the approved compensation terms into immutable earning documents; Admin payout allocates those documents and clears distributor payable. Gross balances are settled separately unless an Admin explicitly approves an audited offset against verified refund payable; pending COD remittances cannot also be offset.
- NCM create-booking flows now preserve explicit failure states such as `submission_failed` / `failed_to_book_courier`, and the frontend must not surface those cases as a successful courier booking.
- Admin Order Assignments can enter customer-order package details and request NCM delivery for distributor-assigned orders. Customer-order NCM status is persisted from webhooks and served from the database to admin and fulfillment views; NCM status is not polled for each read. Customer-order NCM charges are platform/admin settlement amounts, not manufacturer/distributor payables.
- Admin Logistics includes separate paginated NCM and distributor self-delivery monitors. Both use Kathmandu-local date filters and compact record tables with lazy-loaded details; self-delivery includes only explicit `SELF_DELIVERY` assignments and excludes NCM-linked orders. NCM tools expose documented per-order, branch/rate, label, comment, ticket, customer, and staff operations behind admin delivery permissions; webhook callbacks are handled by the backend integration. Support and COD-settlement ticket summaries are indexed in `NcmSupportTicket` after creation/detail/reply/close actions, including NCM's documented scalar `ticket` ID response; active and closed lists are database-only.
- The supplied NCM API does not expose a complete date-range order list or payable/receivable ledger. Admin reconciliation therefore compares or refreshes known locally linked NCM IDs only; it cannot independently enumerate carrier-only orders or verify a full carrier financial ledger.
- Distributor hubs can hold packed orders after selecting NCM or self-delivery. A dedicated NCM delivery desk supports carrier-state views and selecting multiple held orders for separate individual NCM bookings, while held orders stay out of the ordinary hub queue.
- Bulk stock-transfer NCM bookings omit the optional oversized vendor reference, remain `BOOKED` with factory stock reserved until pickup/custody confirmation, and persist webhook status events for manufacturer/distributor/admin views. Admins alone can reconcile carrier APIs; distributor receipt remains separate from carrier delivery. Manufacturer return requests are supported, and NCM freight remains platform/admin settlement rather than partner payables.
- RBAC and auth system with user, admin, manufacturer, and partner roles plus permission checks and session validation.
- Admin audit history backed by a transactional outbox, with redacted before/after diffs for business changes and reviewable authentication, MFA, rate-limit, refresh-token-reuse, and RBAC-denial security signals.
- Delivered-sale accounting for NCM and distributor self-delivery now enqueues a versioned, hash-checked `AccountingEvent` in the delivery transaction. A scheduled worker retries journal posting, and accounting reports/screens expose unresolved amounts as excluded from posted GL totals; the required additive migration is still unapplied, so deployment is gated.
- NCM settlement now requires matching source-order COD receivables, accrues actual carrier fees to the NCM payable subledger, and atomically allocates gross COD and fee balances with the net cash receipt. Admin Accounting Health displays source-scoped NCM/distributor party-control reconciliations. Future VAT changes are append-only, effective-dated versions and are snapshotted for approved returns; the new migrations must be applied and Prisma Client regenerated before enabling these flows.
- MySQL + Prisma schema covering auth, catalog, inventory, orders, finance, accounting, marketing, returns, delivery, and local pricing flows.
- Distributor gift inventory is batch-based and auditable: one order per checkout group reserves an exact-value accepted batch, preferring the customer's district, then province, then other assigned distributors. Packing and delivery transitions update the gift state; movement logs record dispatch, receipt, allocation, reservation, deduction, restock, or loss. Admins can replace an un-packed assigned gift only with same-value accepted stock from that distributor. Legacy manufacturer gift records remain for historical orders and are not used for new distributor hub activity.

### Partially implemented or intentionally gated

- Notification worker exists as a separate subsystem. Portal MFA and password recovery enqueue SMS through it; most business flows do not automatically send SMS/email, and inbound SMS processing is not implemented.
- SMS password recovery is available only in `development` and `test`; it remains unavailable in staging, production, and unspecified environments while its code remains the fixed `111111` by explicit development instruction. Before enabling recovery elsewhere, implement and verify random per-challenge OTPs. The marketing portal's signup, password-reset, and email-verification flows remain outside this implementation.
- Privileged portal MFA is controlled by backend `MFA_ENABLED` (defaults to `true`) and does not depend on notification enablement. If MFA is enabled but notifications or a delivery method are unavailable, privileged login cannot complete; configure and verify the notification worker before enabling those portals in production.
- Accounting remains partially implemented; see the accounting audit for unresolved posting, report-snapshot, Treasury, tender, and subledger gaps. The delivered-sale outbox covers delivery posting only and does not close those wider gaps.
- Delivered-sale outbox deployment requires applying `20261017000000_delivery_accounting_outbox_schedule` and regenerating Prisma Client first; migration and isolated-database concurrency verification are pending.
- Distributor COD/refund deployment additionally requires applying `20261027100000_distributor_cod_and_return_cash` and regenerating Prisma Client. No migration was applied to the configured database; verify migration and concurrent remittance/refund/payout behavior on an isolated database first.
- Distributor remittance and refund evidence uses JPG/PNG image uploads; return-goods inspection also requires a photo. Apply `20261027120000_return_and_cash_evidence_images` and regenerate Prisma Client before deploying the new return inspection field.
- Prisma generation in a local Windows environment may be blocked by a native query-engine DLL lock while the backend server is running; this is an environment issue, not a schema-level application bug.
- Scanned-and-claimed Own Store card gifts and selected loyalty gift perks create physical-gift entitlements. Loyalty gifts first try to match the configured exact value against accepted stock at distributors assigned to that checkout; catalog category is unrestricted. If assigned distributors lack stock, fulfillment proceeds and the reward is returned to the pending queue after all split shipments pack, for a later checkout attempt. One physical gift is assigned per checkout group, and catalog value changes are blocked while that gift is assigned to an unfulfilled order. Order-value rules do not attach physical gifts. Campaign/product-category triggers and automatic return-inspection reconciliation remain follow-up work; returned/lost gift outcomes can currently be recorded through the protected lifecycle API. The additive gift migration is not applied automatically; deploy only after Prisma Client generation and isolated migration review.

### Production migration safety

Use Prisma Migrate's deployment command from `backend/` (`npm run db:migrate:deploy`) only after reviewing pending migrations, taking a recoverable database backup, and validating the migration against an isolated staging copy. Do not use `db:push`, `db:sync`, or `db:reset` as a production deployment step. A deploy command does not make a destructive migration safe; review its data impact and coordinate an explicit rollout/rollback plan first. Database-backed integration tests must also target an isolated test database.

## 4. High-Level Platform Map

| Portal | Purpose | Primary routes / flows |
| --- | --- | --- |
| `frontend/` | Customer storefront | catalog, cart, checkout, profile, orders, marketing cards |
| `admin/` | Business operations | products, orders, product sales analytics, inventory, suppliers, finance/accounting, access control |
| `manufacturer/` | Production fulfillment | order acceptance, inventory, pickup settings, performance, finance |
| `marketing/` | Partner campaigns | campaign management, card validation, redemption, reports |
| `backend/` | API + domain logic | Prisma service layer, routers, controllers, auth/RBAC, order orchestration |

## 5. Immediate Roadmap / Next Steps

1. Complete the still-missing marketing partner flows called out in the repo analysis: signup, forgot-password/reset-password, and email verification support.
2. Finish the notification production path: enable the worker only after env validation, secure provider credentials, and staging tests for RabbitMQ/SMTP/SMS behavior.
3. Close the manufacturer payable/cost-basis accounting gap described in the accounting docs before relying on production financial summaries.
4. Validate the schema against a clean database state and regenerate Prisma client after stopping any running backend process that holds the native client binary.
5. Review the current `backend/notifications/README.md` and staging deployment notes before enabling outbound messaging in production.
6. Keep route-level RBAC and backend ownership checks as the source of truth for all future feature work.
7. Apply the additive `20261005000000_add_system_audit_outbox` migration, run the RBAC seed to register `access:audit_read` for the system Admin role, and regenerate Prisma Client before deploying the admin audit-history endpoints. The seed fallback account data remains unchanged.
8. Monitor pending/failed system-audit outbox records and define retention/archival policy before audit volume grows.
9. Review [Security, Data Flow, and UI Audit](SECURITY_DATA_FLOW_AND_UI_AUDIT.md) before production rollout; it documents source-code-based flows and security/UI follow-ups, not production or forensic findings.

## 6. Documentation Maintenance Rule

This repository treats the documentation set as the canonical implementation guide for future AI agents and engineers. Any code change affecting portals, routes, schemas, permissions, environment variables, workflows, or deployment setup must be mirrored into the project documentation set immediately.

The active documentation files are:

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [PROJECT_DEEP_DIVE_AND_NCM_FLOWS.md](PROJECT_DEEP_DIVE_AND_NCM_FLOWS.md)
- [ARCHITECTURE_AND_BACKEND.md](ARCHITECTURE_AND_BACKEND.md)
- [DATABASE_AND_SCHEMAS.md](DATABASE_AND_SCHEMAS.md)
- [FRONTEND_AND_UI.md](FRONTEND_AND_UI.md)
- [AI_CODING_RULES.md](AI_CODING_RULES.md)

## 7. Repository Notes

- The project is intentionally multi-portal and distributed rather than a single app.
- Backend routes are mounted under `/api/...` and are the stable contract for the frontends.
- Admin product performance reports load summary, product/return, location, and selected-product timeline data through separate permission-protected APIs. Distributor reporting reuses those aggregates with authenticated workspace scoping and never returns revenue.
- Product, order, inventory, finance, and card logic are implemented directly in the backend; the frontends are mostly consumers and UI overlays around those server-side rules.
