# Current Architecture Analysis

## 1. Overall system shape

This project uses a shared backend at `backend/` and multiple frontends:

- `frontend/` – customer-facing portal
- `admin/` – administrative portal
- `manufacturer/` – manufacturer portal
- `marketing/` – marketing partner portal

The backend is the authoritative security boundary. All protected API endpoints are mounted from the same Express app in `backend/server.js` and rely on centralized middleware rather than portal-local auth.

## 2. Backend runtime and framework

Key evidence:

- `backend/package.json` uses `express`, `cors`, `jsonwebtoken`, `bcryptjs`, `@prisma/client`, `dotenv`.
- `backend/server.js` builds a single Express app and mounts route groups under `/api/*` and the public webhook endpoints.
- The project uses Prisma ORM with MySQL (`backend/config/db.js`, `backend/prisma/schema.prisma`).

This is a classic MVC-ish structure:

- routes/ → HTTP contract
- controllers/ → request handling
- services/ → business logic and DB orchestration
- middleware/ → auth, RBAC, context injection
- config/ → environment and service config
- prisma/schema.prisma → database schema

## 3. Current authentication and RBAC state

Key files:

- `backend/routes/authRoute.js`
- `backend/services/authService.js`
- `backend/middleware/unifiedAuth.js`
- `backend/middleware/authorize.js`
- `backend/services/rbacService.js`
- `backend/prisma/schema.prisma`
- `backend/prisma/seed.js`

Current findings:

- JWT creation already exists in `generateAuthToken()`.
- Access tokens are generated with role and profile identity in the payload, such as:
  - `accountId`
  - `role`
  - `email`
  - `phone`
  - `portalAccess`
  - `adminId` / `manufacturerId` / `partnerId` / `userId` depending on role
- Authentication middleware verifies the token and resolves the canonical `AuthAccount` identity.
- `authorize()` middleware checks required permission codes against the user’s effective permissions.
- RBAC tables already exist in Prisma for:
  - `Role`
  - `Permission`
  - `RolePermissionMapping`
  - `AuthAccountRoleMapping`

This means the project already implements the core JWT + RBAC foundation required by the prompt, but it is not yet the advanced state described in the JWT prompt because it is still missing a dedicated refresh-token rotation/session model and stateful token invalidation.

## 4. Webhook handling and public exposure

Webhooks are intentionally public and remain unprotected.

Evidence in `backend/routes/deliveryRoute.js`:

- `deliveryRouter.post("/webhook/ncm", ...)`
- `deliveryRouter.post("/ncm", ...)`
- `deliveryRouter.post("/webhook", ...)`
- `server.js` mounts `deliveryRouter` at `/webhooks` and `/api/ncm-webhook`

This matches the requirement: webhooks are free and publicly reachable without authentication for now.

## 5. Existing auth flow behavior

The current auth flow is centralized and role-aware:

- `authenticate` verifies JWT signature and expiration
- resolves account identity from `accountId` or profile mappings
- checks `AuthAccount.role` matches the token role
- rejects inactive/suspended/rejected accounts
- writes `req.auth`
- backfills `req.userId`, `req.adminId`, `req.manufacturerId`, or `req.partnerId` for older controller compatibility

This is a strong compatibility layer and protects the existing API surface without rewriting all route handlers.

## 6. Current resource and permission pattern

The route layer is heavily permission-based.

Examples:

- `backend/routes/accountingRoute.js`
- `backend/routes/cartRoute.js`
- `backend/routes/orderRoute.js`
- `backend/routes/manufacturerRoute.js`
- `backend/routes/marketingCardRoute.js`

Each route uses middleware like:

- `authenticate`
- `authorize("permission:code")`
- sometimes `setManufacturerContext` / `setMarketingPartnerContext`

This is a proper separation of concerns: authentication and authorization are centralized, while route-specific context is applied only when needed.

## 7. Current gap relative to the JWT prompt

The project already satisfies many foundational requirements:

- centralized auth middleware
- role-aware JWT payload
- permission-based API authorization
- secure public webhook separation
- RBAC schema + mapping

However, the advanced JWT requirements from the prompt still need additional stateful work:

- no dedicated refresh-token rotation model
- no token family tracking
- no refresh-token reuse detection
- no logout/session revocation database table
- no reusable JWT filter pattern outside the current ad hoc middleware
- no explicit `jti` tracking for access and refresh tokens
- no central `AuthSession`/`RefreshToken` persistence layer
- no credential lifecycle enforcement beyond account status checks

## 8. Current compatibility and security posture

The project is intentionally careful about compatibility:

- public webhooks remain public
- backward compatibility fields are attached to the request object
- role validation uses the canonical `AuthAccount`
- profile IDs are resolved against their account owner

This is a good security posture and should be preserved while continuing with the advanced JWT work.

## 9. Conclusion

The project is not a blank slate. It already has essential JWT + RBAC foundations. The next step is not a rewrite; it is to add the missing advanced token lifecycle features while preserving the current security model and webhook exemption.

This is a valid platform for iterative continuation under the prompt’s workflow.
