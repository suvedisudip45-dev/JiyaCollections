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
| `/api/marketing-cards` | Marketing card lifecycle and partner/customer operations |
| `/webhooks`, `/api/ncm-webhook` | Delivery/NCM webhook receivers |

### Key route examples from the actual code

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/2fa/send` and `/api/auth/2fa/verify`
- `POST /api/product/add`
- `GET /api/product/list`
- `POST /api/order/place`
- `POST /api/order/:orderId/cancel`
- `POST /api/returns/exchange/customer`
- `GET /api/delivery/admin`
- `POST /api/delivery/admin/:id/resolve-ncm-handoff`
- `GET /api/marketing-cards/admin/cards`
- `POST /api/marketing-cards/customer/cards/scan`

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
- `sanitizeMiddleware` is called before route handling to reduce injection risk.
- API logs are produced in a structured way via a `logger.request` utility, and the server explicitly logs request timing.

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
