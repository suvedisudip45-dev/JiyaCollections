# AI_CONTEXT.md: Aama Clothings Project Guide

This document is the compact, model-ready guide to the repository: what runs here, how the business domains fit together, where to make changes, and which deeper documents to consult. It reflects the current source tree and runtime wiring. Verify behavior in code before relying on older documents or assumptions.

## 1. Project At A Glance

Aama Clothings is a multi-portal clothing e-commerce and fulfillment system. Four React/Vite web apps use one Node.js/Express API. The API uses Prisma with MySQL, Cloudinary for uploaded media, and integrations including Nepal Can Move (NCM) delivery and a notification worker.

```text
Customer storefront ─┐
Admin portal ─────────┤
Manufacturer portal ─┼──> Express API (backend/) ──> MySQL through Prisma
Marketing portal ────┘              ├──────────────> Cloudinary media
                                    ├──────────────> Nepal Can Move API/webhooks
                                    └──────────────> Notification queue/providers
```

There is no separate `delivery/` frontend in this checkout. Delivery operations are exposed through backend APIs and integrated with NCM. Do not describe a courier-driver portal as a current app unless one is added to the repository.

## 2. Applications And Local Ports

| App | Directory | Default local port | Primary users and scope |
| --- | --- | ---: | --- |
| Customer storefront | `frontend/` | 5173 | Browse products, cart/checkout, account, orders, reviews, loyalty, and marketing-card rewards |
| Admin portal | `admin/` | 5174 | Products, orders, manufacturers, inventory network, delivery oversight, finance/accounting, partner campaigns, and system operations |
| Manufacturer portal | `manufacturer/` | 5175 | Assigned order fulfillment, production/checklists/packaging, stock, delivery handoff, and marketing-card inventory |
| Marketing Partner portal | `marketing/` | 5176 | Partner profile, campaigns/cards, metrics, and redemption workflows |
| Shared API | `backend/` | 4000 by default (`PORT` overrides) | Authentication, business rules, persistence, integrations, and authorization |

Each frontend is an independent Vite app with its own dependencies and scripts. There is no root package manifest coordinating all apps. The apps do not all use the same React/router versions; follow the manifest and conventions of the specific app being changed.

## 3. Main Business Domains

- **Commerce:** product/category/color catalog, customer accounts and addresses, carts, checkout/orders, reviews, returns, offers, loyalty, and shipping configuration.
- **Manufacturer network:** manufacturer onboarding and contracts, assignment/acceptance, production workflow, quality ratings, package details, and per-hub inventory with reservations and stock synchronization.
- **Order allocation:** the backend assigns orders to eligible manufacturer hubs based on operational constraints such as location, stock availability, contract/status, and quality. Assignment and stock changes are server-owned; do not recreate this logic in a client.
- **Delivery:** manufacturer-ready handoff creates/updates a local delivery record and can submit to NCM. The system includes NCM status/webhook handling, reconciliation, returns, delivery administration, and COD settlement APIs. Delivered status and financial settlement are distinct events.
- **Marketing cards and rewards:** admin configures partner campaigns/offers and card inventory; cards move through assignment, manufacturer receipt/attachment, customer activation/linking, scan validation, and benefit redemption. Campaign sponsor media supports image/video uploads and is shown to the customer in the scan interstitial.
- **Finance:** chart of accounts, journals, expenses, COGS, returns, financial accounts/treasury, reports, and tax-related summaries. Preserve balanced journal and idempotency rules when modifying financial behavior.
- **Notifications:** notification records/outbox and worker/provider integrations support OTP and operational messaging. Check current config and worker behavior before assuming a provider is enabled.

## 4. Backend Architecture

Entry point and runtime wiring: `backend/server.js`.

Typical request path:

```text
route -> authentication/permission middleware -> controller -> service/domain logic -> Prisma -> MySQL
```

- `backend/routes/`: REST route declarations and middleware composition.
- `backend/controllers/`: HTTP validation, orchestration, and response shaping.
- `backend/services/`: domain rules and multi-step workflows; keep business logic here where an established service exists.
- `backend/middleware/`: unified authentication, permission authorization, input sanitization, upload handling, and rate limits.
- `backend/security/`: portal MFA policy and security-specific helpers.
- `backend/dtos/`: API serialization/DTO boundaries.
- `backend/config/`: database, JWT, CORS, Cloudinary, and NCM configuration.
- `backend/notifications/`: notification configuration, delivery, and outbox-related logic.
- `backend/prisma/schema.prisma`: canonical database model and relations. Prisma/MySQL is authoritative; stray MongoDB-related files are not the persistence architecture.
- `backend/tests/`: Node test-runner tests for service, middleware, API, and business logic.

Important domain entry points:

| Domain | Routes/controllers/services |
| --- | --- |
| Auth/RBAC | `routes/authRoute.js`, `middleware/unifiedAuth.js`, `middleware/authorize.js`, `services/authService.js`, `services/tokenService.js`, `services/rbacService.js` |
| Orders and allocation | `routes/orderRoute.js`, `controllers/orderController.js`, `routes/orderAssignmentRoute.js`, `controllers/orderAssignmentController.js`, `services/fulfillmentStateMachine.js` |
| Manufacturers/inventory | `routes/manufacturerRoute.js`, `controllers/manufacturerController.js`, `controllers/manufacturerInventoryController.js`, `services/stockSyncService.js` |
| Delivery/NCM | `routes/deliveryRoute.js`, `controllers/deliveryController.js`, `services/deliveryService.js`, `services/ncmClient.js` |
| Marketing cards | `routes/marketingCardRoute.js`, `controllers/marketingCardController.js`, `controllers/marketingPartnerController.js`, `services/marketingCardService.js`, `services/marketingCardCustomerService.js` |
| Accounting/finance | `routes/accountingRoute.js`, `routes/financialRoute.js`, `services/accountingPostingEngine.js`, `controllers/expenseController.js` |
| Notifications | `routes/notificationRoute.js`, `notificationWorker.js`, `backend/notifications/` |

## 5. API Route Prefixes

All routes are mounted in `backend/server.js`. These are route families, not a promise that every operation is public; most writes require authentication and permissions.

| Prefix | Main API domain |
| --- | --- |
| `/api/auth` | Unified login, refresh/logout, MFA/OTP, account/session endpoints |
| `/api/user` | Customer profile/address and compatibility login/admin endpoints |
| `/api/product`, `/api/category`, `/api/subcategory`, `/api/color` | Catalog and product administration |
| `/api/cart`, `/api/order`, `/api/review` | Cart, checkout/order lifecycle, reviews |
| `/api/shipping`, `/api/loyalty`, `/api/offer`, `/api/returns` | Shipping, loyalty, promotions, returns |
| `/api/customer` | Customer-specific operations and uploads |
| `/api/manufacturer`, `/api/manufacturer-inventory`, `/api/assignment`, `/api/order-assignment`, `/api/manufacturer-order` | Manufacturer onboarding, stock, order assignment and fulfillment |
| `/api/delivery`, `/api/delivery-job` | Delivery/NCM operations; `delivery-job` is a compatibility alias |
| `/api/ncm-webhook`, `/webhooks` | NCM callback routes mounted through the delivery router |
| `/api/marketing-cards` | Admin campaign/card management, manufacturer inventory, customer scans/rewards, partner portal |
| `/api/finance`, `/api/accounting`, `/api/cogs`, `/api/expense` | Financial reports, journals, cost of goods, expenses |
| `/api/personalized-letter`, `/api/admin/story-letter` | Customer/personalized and admin story-letter workflows |
| `/api/notifications` | Notification operations |

Examples of high-value endpoints include `POST /api/auth/login`, `POST /api/order/create`, `GET /api/order-assignment/my`, manufacturer delivery-ready endpoints under `/api/delivery`, NCM callbacks under `/api/delivery/webhook/ncm/...`, and card flows under `/api/marketing-cards/customer/...`. Read the route file before relying on an endpoint name or request shape.

## 6. Delivery Partner And NCM Integration

In this repository, “delivery partner” refers primarily to the carrier integration with Nepal Can Move, not a separate local courier-driver frontend.

- NCM client: `backend/services/ncmClient.js`; requests use the server-side `NCM_API_TOKEN` and configurable `NCM_API_BASE_URL`.
- Delivery orchestration/state mapping: `backend/services/deliveryService.js`.
- HTTP API and callbacks: `backend/controllers/deliveryController.js` and `backend/routes/deliveryRoute.js`.
- The manufacturer flow requests delivery readiness; the server validates state/package/branch data before carrier submission.
- Admin delivery APIs support listing/details, reconciliation, and settlement operations. Customers have a customer-scoped delivery read route.
- Webhooks must be treated as untrusted input, authenticated with configured webhook secret controls, validated, deduplicated, and reconciled with carrier data as appropriate.
- Never send NCM credentials to a browser, log credentials, or let a carrier callback directly bypass inventory/accounting business transitions.
- `DELIVERY_AUTOMATION_PLAN.md` is valuable design history, but its opening status/findings are stale relative to the current NCM client, delivery service, controller, and routes. Verify implementation in code.

## 7. Authentication And Authorization

The current implementation is a unified identity architecture with portal-specific profiles. The canonical models are in `backend/prisma/schema.prisma` (`AuthAccount`, `AuthSession`, role/permission mappings, portal profiles, OTP/MFA challenges, and audit logs).

- Primary shared password endpoint: `POST /api/auth/login`. Some older/portal-specific login and signup routes remain for compatibility; inspect the route and client before consolidating or removing them.
- Roles/portals: `CUSTOMER`, `ADMIN`, `MANUFACTURER`, `MARKETING_PARTNER`.
- Access authorization is server-side. `authenticate` validates the JWT and its persisted `AuthSession`; `authorize(permission)` resolves RBAC permissions. Do not rely on hidden UI controls as authorization.
- JWTs use separate access and refresh secrets, issuer/audience validation, token IDs, and token type claims. Current defaults in `backend/config/jwt.js` are short-lived access tokens and refresh tokens; production overrides may differ.
- Refresh-token rotation, revocation, and per-portal refresh cookies are implemented. Preserve the cookie/token-family/session checks.
- MFA is required for admin, manufacturer, and marketing partner roles by `backend/security/mfaPolicy.js`; customer accounts are not included in that policy.
- OTP/MFA challenge state is persisted in MySQL and notification delivery is implemented through the notification system. **Inspect the current OTP implementation before production use:** `backend/services/portalTwoFactorService.js` has contained a fixed test OTP in the send path; do not assume OTP generation is production-random without verifying/fixing that code.
- Failed password attempts also trigger an account lockout in `services/authService.js` (currently five failures and a 15-minute lockout).
- Login rate-limit `Map`s in `middleware/authRateLimit.js` are process-local and reset on restart. OTP challenge rate checks count persisted database rows and therefore survive process restarts until their configured time window expires.

Client-side AES encryption of login fields exists in addition to HTTPS. It is not a substitute for TLS and its shared keys must never be committed or copied into this document.

## 8. Security And Data Handling Rules

- `backend/middleware/sanitize.js` is mounted globally in `server.js`; do not remove or bypass it. Keep server-side validation/authorization even when clients sanitize inputs.
- Use Prisma parameterized APIs; do not add unsafe raw SQL or concatenate user input into queries.
- Keep authorization checks on the server and use the existing granular permission middleware for protected endpoints.
- Validate uploaded file type and size on the server. Upload media through the existing Cloudinary integration; never trust client-supplied URLs or MIME metadata as the only validation.
- Avoid `dangerouslySetInnerHTML` with user-controlled data. Avoid logging passwords, OTPs, tokens, secrets, or unnecessary PII.
- Preserve generic auth failure responses and audit logging; avoid account enumeration.
- Use transactions and idempotency for inventory reservations, order assignment, card attachment/redemption, delivery submission, and financial posting.
- Keep `.env`, deployment secrets, credentials, tokens, and private customer data out of commits, prompts, screenshots, and generated docs. This conversation included a real-looking `backend/.env`; rotate any live credentials contained there before production use. This guide intentionally contains no secret values.
- Rate-limit values are configured by environment variables. They are distinct controls: auth login username/IP buckets, registration IP buckets, OTP challenge windows, and marketing-card scan/redeem limits.

## 9. Data And External Services

- **Primary persistence:** MySQL through Prisma. Modify the Prisma schema and migration workflow deliberately; do not infer persistence from old MongoDB artifacts or legacy docs.
- **Media:** Cloudinary stores product, contract, customer-letter, campaign sponsor, and other uploaded media. Persist secure URLs/asset metadata in the relevant relational model.
- **Delivery:** NCM API and webhooks; configuration is server-only.
- **Notifications:** notification/outbox records plus optional RabbitMQ-backed worker and configured SMS/email providers. A credential being present does not prove a provider is enabled or production-ready.
- **Payments:** payment-related modules/configuration exist. Check the actual checkout/controller/provider implementation and deployment configuration before claiming a provider is active; placeholder environment values are not working credentials.

## 10. Running And Testing

Run each app from its own directory after dependencies and environment are configured:

```powershell
cd backend
npm install
npm run dev
```

In separate terminals, run `npm run dev` in `frontend/`, `admin/`, `manufacturer/`, and `marketing/`. Confirm the configured backend URL and CORS origins for the local environment. Backend startup requires a reachable MySQL database and valid JWT configuration; external integrations require their own valid credentials.

- Frontend/admin/marketing/manufacturer builds: run `npm run build` inside the app directory.
- Backend tests use Node’s built-in test runner. Run a focused test as `node --test tests/<name>.test.js` from `backend/` or run `node --test` there. `backend/package.json` does not currently define a general `test` script.
- After controller/middleware/security changes, run the relevant existing tests, including `node --test tests/injectionProtection.test.js` when that test file is present and applicable.
- Do not run database reset/destructive seed commands against an unknown environment. Do not change production data or migrations without an explicit request.

## 11. Repository Map And Source Documents

- `backend/`: shared API, services, Prisma schema, migrations, scripts, tests, and notification worker.
- `frontend/`, `admin/`, `manufacturer/`, `marketing/`: independent React/Vite portals.
- `docs/`: focused auth, RBAC, marketing-card, and 2FA design documents.
- `README.md`: setup and broad product overview; some portal descriptions are outdated.
- `BACKEND_ARCHITECTURE.md`: domain architecture and route notes; verify every claim against current code.
- `FEATURES_CATALOG.md`: feature inventory; statuses may lag implementation.
- `SECURITY.md`: security guidance; recommendations are not necessarily implemented controls.
- `SCHEMA.md`: human-readable schema reference; `backend/prisma/schema.prisma` is authoritative.
- `docs/unified-authentication-design.md`, `docs/authentication-architecture-analysis.md`, and `docs/rbac/`: auth/RBAC design history; source code is current behavior.
- `docs/marketing-card-architecture.md`: card lifecycle/data-integrity design; some middleware/architecture statements predate unified RBAC.
- `DELIVERY_AUTOMATION_PLAN.md`: NCM delivery design history; parts are now implemented, so compare with current backend delivery modules.
- `UI_SYSTEM.md`: UI design conventions.

When sources conflict, use this precedence: current implementation and tests -> Prisma schema and route wiring -> current focused docs -> top-level overview/planning/prompt documents. Distinguish implemented, partial, and planned behavior explicitly.

## 12. Guidance For AI-Assisted Changes

- Start at the concrete route/component/service/test that owns the behavior. Read nearby tests and callers before editing.
- Make the smallest coherent change; preserve existing API contracts and response envelopes (`success`, optional `message`, and domain data) unless a breaking change is requested.
- Keep controllers focused on HTTP concerns; put reusable domain behavior in services. Reuse existing utilities and permission codes.
- JavaScript uses ESM. Follow the touched app’s existing React, lint, and formatting conventions; app versions differ.
- Use Prisma transactions for invariants spanning related records. Think about retries, duplicates, and concurrent requests for order, stock, delivery, rewards, and accounting changes.
- Add/update focused tests near the existing backend test patterns. Mock external providers in tests; do not call live payment, SMS, Cloudinary, or NCM services during ordinary tests.
- Do not edit secrets, generated build output, unrelated dirty files, or user changes. Do not commit, reset, or create branches unless explicitly requested.
- If changing a public API or data model, update the relevant focused docs and preserve compatibility where possible.
