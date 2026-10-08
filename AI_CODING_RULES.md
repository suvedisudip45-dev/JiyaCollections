# AI Coding Rules and Project Guardrails

This document captures the constraints that future AI agents must follow when working in this repository. These rules are derived from the actual code and infrastructure currently in the project.

## 1. Documentation Synchronization Rule

All future project changes must be reflected in the documentation set in this repository. The files below are treated as the live project knowledge base and must be kept aligned with code changes as they happen:

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [ARCHITECTURE_AND_BACKEND.md](ARCHITECTURE_AND_BACKEND.md)
- [DATABASE_AND_SCHEMAS.md](DATABASE_AND_SCHEMAS.md)
- [FRONTEND_AND_UI.md](FRONTEND_AND_UI.md)
- [SECURITY_DATA_FLOW_AND_UI_AUDIT.md](SECURITY_DATA_FLOW_AND_UI_AUDIT.md)
- [AI_CODING_RULES.md](AI_CODING_RULES.md)

This is a hard operating rule. Do not merge or continue feature work without updating the relevant documentation sections for any route, model, permission, flow, environment variable, deployment detail, or UI change.

### 1.1 Keep backend logic authoritative

The backend is the real source of truth for:

- RBAC and route permission checks
- token validation and auth state
- stock availability and reservation logic
- order assignment, shipping, and handoff logic
- NCM reconciliation and exchange review logic
- accounting postings and ledger integrity
- location-based discount resolution and distributor hub assignment for checkout
- distributor registration profile data and service-district coverage, including the distinction between hub address and fulfillment coverage
- distributor allocation priority: exact district, same province, then nationwide by verified customer ratings, while requiring distributor-ledger stock at every tier
- marketing card ownership, Own Store scan quotas, reward claims, and exclusive reward application at checkout

Do not assume the frontend is trusted to enforce business rules. The code explicitly validates permissions and ownership server-side.

### 1.2 Never infer successful courier creation from optimistic UI state

A backend NCM booking attempt is only successful when the delivery state is explicitly transitioned to a successful carrier-created state. Failed attempts such as `submission_failed`, `failed_to_book_courier`, or `ncm_submission_failed` must remain failed and should never be displayed as "Courier Booked" in any portal. The UI is allowed to reflect the authoritative backend result, not guess it.

### 1.3 Preserve the platform split

This repo is intentionally split into multiple apps:

- `frontend/` for customer storefront
- `admin/` for operations
- `manufacturer/` for factory production and the distributor workspace
- `marketing/` for partner flows
- `backend/` for business logic and data access

Changes should be implemented in the correct runtime boundary. Do not create cross-app logic that bypasses the backend API contract.

### 1.4 Follow the existing route and permission conventions

The codebase consistently uses:

- `authenticate`
- `authorize("permission:code")`
- `setManufacturerContext` or `setMarketingPartnerContext` when necessary
- route-level permission maps in `admin/src/auth/adminRoutePermissions.js`

When adding a protected feature, add the route permission and ensure the backend permission exists before assuming the UI can access it.

### 1.5 Respect existing domain boundaries

Examples:

- product catalog logic belongs in the product routes/services, not ad hoc frontend logic
- shipping logic belongs in backend shipping config and delivery integration
- card assignment and redemption logic belongs in the marketing-card routes and service layer
- return/exchange reconciliation belongs in the order exchange and delivery domain, not as isolated UI-only logic

### 1.6 Match the repo’s naming and state conventions

Use status strings and IDs consistent with Prisma and the current service layer. For example:

- roles are stored as uppercase codes (`ADMIN`, `CUSTOMER`, `MANUFACTURER`, `MARKETING_PARTNER`)
- many domain models use `status` and `state` strings rather than booleans for workflow progression
- route and permission handling is exact; avoid introducing new permission names without updating both backend and admin permission maps

### 1.7 Gift promotion and inventory rules

- Gifts are reusable retention/promotion inventory, not a loyalty-only feature. Loyalty eligibility comes from the backend's active reward snapshot; order-value promotions remain separately configurable. Keep trigger evaluation in backend services and do not treat UI-selected gifts as authoritative.
- Distributor gift distributions are independently accepted inventory batches. The distributor chooses only from its own accepted stock for distributor hub orders; the backend must claim that exact batch atomically and store it on the order.
- Distributor actions that change a hub order gift must verify authenticated distributor ownership. Pack, delivery, return, and loss transitions must be idempotent and update distributor movement logs and stock in the same transaction. Legacy manufacturer gift rows remain historical and must not be treated as distributor inventory.
- Direct hub orders, hub inventory, physical marketing-card stock, and gift stock are distributor features. Direct hub stock reads and deductions must use the distributor inventory ledger; never use `ManufacturerInventory` as a distributor fallback. Keep their routes, permissions, UI access, and admin allocations distributor-scoped.
- NCM delivery status is authoritative for delivered-gift deduction. Do not mark a gift delivered from optimistic frontend state.
- Update this guide and the project overview, architecture, schema, and UI docs when gift routes, permissions, states, or lifecycle rules change.

## 2. Do’s and Don’ts

### Do

- Use Prisma schema and backend service logic as the canonical model for data behavior.
- Validate user input against the existing backend validation and sanitization patterns.
- Preserve the support for both `Authorization: Bearer ...` and legacy token-header patterns where the code explicitly supports them.
- Keep RBAC and audit logging in place when changing auth-sensitive endpoints.
- Write new tests around real behavior, not mock-only assertions.
- Keep `localStorage` and frontend token behavior consistent with the current auth interceptor pattern.

### Don’t

- Do not bypass the API with client-only stock checks that overwrite official backend rules.
- Do not add unscoped routes or partner/admin endpoints without proper RBAC.
- Do not invent new marketing or payment flows without verifying backend support.
- Do not assume secrets belong in `.env.example`, frontend files, or source-controlled config.
- Do not treat notifications as production-ready without validating the worker, credentials, and staging environment.
- Do not make one-off changes to schema fields without checking cross-portal impacts.

## 3. Critical Project Constraints

### 3.1 Security constraints

- JWT secrets must be distinct between access and refresh tokens.
- CORS settings are explicitly layered and environment-driven.
- MFA requirements are enforced in the auth middleware, not only in the UI.
- Password-change enforcement is part of the current auth flow for certain accounts.

### 3.2 Data integrity constraints

- Orders, delivery jobs, marketing cards, and exchange requests require explicit status tracking.
- Inventory and stock movement should not be treated as simple frontend counters.
- NCM and delivery jobs must preserve idempotency and reconcile unknown outcomes rather than assuming success.
- Accounts and sessions must not be treated as stateless objects in a way that bypasses the `AuthSession` logic.

### 3.3 Frontend constraints

- The frontends are UI layers and should remain thin compared to the backend business logic.
- Use existing `react-toastify`, localStorage token handling, and router patterns instead of introducing new auth patterns.
- Keep route/portal logic aligned with the backend permission names and the admin permission map.

## 4. Error-Free Development Guidelines

### API responses

Follow the repo’s current response style:

- `success: true|false`
- `message` for user-facing text
- optional `code` for security and API-specific errors
- avoid leaking raw backend stack traces to end users

### Edge cases to keep explicit

- out-of-stock product or size-color combination
- invalid or expired JWTs
- repeated card scans, duplicate redemption attempts, and manual exchange locking
- Own Store campaign limits are five scans per customer/campaign/calendar week and two per customer/campaign/assigned organization; count and insert must remain server-side and transactional
- card-reward and loyalty-reward application are mutually exclusive; checkout must validate and consume a card claim atomically with order creation
- NCM ambiguity where the platform cannot determine whether a create request succeeded
- supplier and customer return outcomes that influence inventory and reconciliation
- permission-denied or password-change-required states

### Future feature work

New features should be implemented in a way that preserves existing flows:

- maintain route-level permission checks
- maintain separation between customer/admin/manufacturer/marketing contexts
- keep data models aligned with `schema.prisma`
- prefer one backend service and one route contract over isolated UI-only logic

## 5. Repository-Specific Reminder

This codebase has documented gaps and intentionally gated features. Future agents should treat the repo as a real production architecture with active business logic, not as a demo scaffold. The safest workflow is:

1. inspect the backend route and service contract,
2. check the Prisma schema and permissions,
3. patch the right layer,
4. validate with the project’s targeted tests and builds.

When in doubt, default to the current code pattern already checked into the repository rather than inventing a new convention.
