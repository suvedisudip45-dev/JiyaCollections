# RBAC Implementation Checklist

Updated: 2026-09-25

## Completed

- [x] Iteration 1: RBAC schema and idempotent seed
  - Added `Role`, `Permission`, `RolePermissionMapping`, and `AuthAccountRoleMapping`.
  - Seeded roles, permissions, role-permission mappings, and existing account-role mappings.
  - Preserved `AuthAccount.role` for backward compatibility.
- [x] Iteration 2: Authorization core
  - Added centralized permission resolution and request-scoped caching.
  - Added fail-closed `authorize(permission)` middleware with 401, 403, and authorization-service failure handling.
  - Added server-side `all:function` bypass.
- [x] Iteration 3: Admin route authorization
  - Migrated admin-only route groups to `authenticate + authorize(permission)`.
  - Preserved the mixed manufacturer financial summary route for compatibility.
- [x] Iteration 4: Manufacturer route authorization
  - Migrated manufacturer endpoints across manufacturer, inventory, assignments, direct orders, delivery, letters, loyalty, and marketing cards.
  - Preserved `req.manufacturerId` and `req.body.manufacturerId` through `setManufacturerContext`.
  - Kept external webhook routes public with no authentication or RBAC checks.
- [x] Iteration 5: Customer route authorization
  - Migrated customer profile, cart, order, review, delivery, loyalty, and marketing-card endpoints.
  - Preserved `req.userId` and `req.body.userId` behavior through unified authentication.
  - Added legacy profile-token lookup to recover the related `AuthAccount` before permission resolution.
  - Corrected customer mapping for `marketing_card:customer_manage`.
- [x] Iteration 6: Marketing partner route authorization
  - Migrated authenticated partner endpoints to unified authentication and explicit partner permissions.
  - Preserved `req.partnerId` and `req.body.partnerId` through `setMarketingPartnerContext`.
  - Preserved rate-limit middleware ordering for QR and redemption endpoints.
  - Kept partner login and signup public.

## Validation Completed

- [x] Prisma schema validation and client generation
- [x] Backend build
- [x] RBAC authorization tests
- [x] Migrated route module loading
- [x] Idempotent RBAC seeding
- [x] Permission catalog contains the permissions used by migrated routes
- [x] Webhook routes remain unauthenticated and unprotected

## Deferred / Known Boundaries

- Legacy middleware files are retained only for the existing direct integration-test imports; production routes no longer use them.
- The mixed `/api/finance/manufacturer-summary` route now uses unified authentication, RBAC, and scoped manufacturer context.
- Admin variants in manufacturer, delivery, inventory, assignment, and marketing-card routers now use centralized RBAC permissions.
- Resource ownership checks remain in their existing services/controllers and have not been redesigned.

## Next Checkpoint

- [~] Iteration 7: Cleanup and hardening in progress
  - [x] Revalidated recent route migrations and permission mappings.
  - [x] Added live account, role, status, and legacy profile-token validation to unified authentication.
  - [x] Replaced mixed financial summary JWT verification with centralized RBAC and owner-scoped manufacturer context.
  - [x] Added regression tests for legacy profile resolution, role mismatch rejection, and suspended-account denial.
  - [x] Preserved external webhooks as public and RBAC-free integrations.
  - [x] Migrated remaining production route aliases away from legacy middleware.
  - [ ] Decide whether to update or retire legacy middleware imports in the pre-existing integration test.
  - [ ] Complete resource ownership and privilege-escalation regression tests.

## Rules To Preserve

- External webhooks are public integrations. Do not add authentication, role checks, or RBAC middleware to webhook routes.
- Frontend visibility is not an authorization boundary.
- Do not remove legacy middleware until all dependent routes have been migrated and regression-tested.
- Do not change controller payloads or response structures during route authorization migration.
