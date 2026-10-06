# Aama Clothings — Distributed E-Commerce Ecosystem

## 1. Project Summary

Aama Clothings is a multi-portal clothing commerce platform built around a central Node.js + Express API and MySQL Prisma data layer. The system supports a customer storefront, a business admin portal, manufacturer operations, marketing partner campaigns, and delivery/NCM fulfillment workflows.

The repository implements a distributed operating model where customer orders are matched to manufacturers, inventory is tracked at the manufacturer level, deliveries are coordinated with Nepal Can Move (NCM), and admin workflows cover finance, access control, product management, inventory, customer returns, and exchange reconciliation.

## 2. Technology Stack

| Layer | Current implementation |
| --- | --- |
| Runtime | Node.js (project docs specify Node.js 18+), Express 4.21.1 |
| Backend ORM / DB | Prisma 5.22.0, MySQL via `DATABASE_URL` |
| Frontend | React 18.3.1 + Vite 5, React Router 6/7, Tailwind CSS 3 |
| Manufacturer portal | React 19.2.8 + Vite 8 + Tailwind |
| API auth | JWT access/refresh tokens; custom RBAC enforcement; MFA checks for some portal flows |
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
- Admin portal with catalog management, orders, manufacturer management, inventory monitoring, financing/accounting, tax, refunds, shipping config, access control, and exchange/return reconciliation.
- Gift promotion operations across the admin and manufacturer portals: generated gift SKUs, controlled gift categories, configurable order-value rules, loyalty-tier gift allowances, per-hub stock acceptance, manufacturer-selected order gifts, packing verification, and delivery deduction.
- Manufacturer portal with order acceptance, pickup profile, inventory management, performance, finance, and marketing card handling.
- Location-aware assignment logic that maps qualifying local manufacturers to customer delivery districts, applies the product discount hierarchy, and reserves stock before final order confirmation.
- Marketing partner portal with login, campaigns, campaign detail, card management, redemption validation, and reporting routes.
- Delivery and NCM integration for ready-for-pickup, webhook handling, manual handoff recovery, delivery settlements, and return workflows.
- NCM create-booking flows now preserve explicit failure states such as `submission_failed` / `failed_to_book_courier`, and the frontend must not surface those cases as a successful courier booking.
- RBAC and auth system with user, admin, manufacturer, and partner roles plus permission checks and session validation.
- Admin audit history backed by a transactional outbox, with redacted before/after diffs for business changes and reviewable authentication, MFA, rate-limit, refresh-token-reuse, and RBAC-denial security signals.
- MySQL + Prisma schema covering auth, catalog, inventory, orders, finance, accounting, marketing, returns, delivery, and local pricing flows.
- Gift inventory is batch-based and auditable: orders reserve one accepted manufacturer batch atomically, pack/delivery transitions update the gift state, and movement logs record allocation, reservation, deduction, restock, or loss.

### Partially implemented or intentionally gated

- Notification worker exists as a separate subsystem, but business flows do not automatically send SMS/email and inbound SMS processing is not implemented.
- The marketing portal backend analysis document explicitly notes that some flows such as signup, password reset, and email verification are not implemented yet.
- The accounting architecture docs call out a manufacturer payable trigger gap: the current sales posting logic recognizes cost and commission data, but a manufacturer-specific payable trigger and cost basis are not fully implemented.
- Prisma generation in a local Windows environment may be blocked by a native query-engine DLL lock while the backend server is running; this is an environment issue, not a schema-level application bug.
- Loyalty gifts trigger automatically when the backend applies an eligible loyalty reward to an order; order-value promotions use separate configurable thresholds. Campaign/product-category triggers and automatic return-inspection reconciliation remain follow-up work; returned/lost gift outcomes can currently be recorded through the protected lifecycle API.

## 4. High-Level Platform Map

| Portal | Purpose | Primary routes / flows |
| --- | --- | --- |
| `frontend/` | Customer storefront | catalog, cart, checkout, profile, orders, marketing cards |
| `admin/` | Business operations | products, orders, inventory, suppliers, finance/accounting, access control |
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
- [ARCHITECTURE_AND_BACKEND.md](ARCHITECTURE_AND_BACKEND.md)
- [DATABASE_AND_SCHEMAS.md](DATABASE_AND_SCHEMAS.md)
- [FRONTEND_AND_UI.md](FRONTEND_AND_UI.md)
- [AI_CODING_RULES.md](AI_CODING_RULES.md)

## 7. Repository Notes

- The project is intentionally multi-portal and distributed rather than a single app.
- Backend routes are mounted under `/api/...` and are the stable contract for the frontends.
- Product, order, inventory, finance, and card logic are implemented directly in the backend; the frontends are mostly consumers and UI overlays around those server-side rules.
