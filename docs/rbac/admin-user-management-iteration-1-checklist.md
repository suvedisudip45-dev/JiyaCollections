# Admin User Management: Iteration Handoff

Updated: 2026-09-30

## Iteration status

- [x] Architecture and Prisma schema discovery completed.
- [x] Authentication, authorization, session, seed, and portal-boundary paths inspected.
- [x] Admin frontend routes and existing list/pagination patterns inspected.
- [x] Existing tests and RBAC implementation checklist inspected.
- [x] Handoff checklist created for the next iteration.
- [x] Owner decisions recorded; implementation completed through Iteration 2.
- [x] Prisma client regenerated and the additive feature migration applied to the confirmed local database.
- [ ] Establish a safe migration-history baseline before using `prisma migrate deploy` on this database.

Iteration 1 was architecture discovery. Iteration 2 added the schema, backend APIs, Admin UI, and focused security tests. The architecture sections below describe the original baseline; the Iteration 2 section records the current implementation and overrides baseline statements marked as missing.

## Architecture map

### Database and identity

- Prisma uses MySQL: `backend/prisma/schema.prisma`.
- `AuthAccount` is the central identity. It owns unique email/phone, password hash, primary portal `role`, account `status`, login metadata, sessions, MFA challenges, audit events, and RBAC role mappings.
- Portal profile models are related to `AuthAccount` through optional one-to-one `accountId` fields: customer `User`, `Admin`, `Manufacturer`, and `MarketingPartner`.
- `AuthAccount.role` is the primary portal identity. Login and refresh require it to match the requested portal; the admin app also checks for primary role `ADMIN` from `/api/auth/me`.
- `Admin` has a profile `displayName`, optional first/last names, unique email, phone, timestamps, and the legacy `password` field. Active authentication uses `AuthAccount.passwordHash`; Admin password changes mirror the hash into `Admin.password`.
- `AuthAccountRoleMapping` supports multiple active roles per account. `RolePermissionMapping` assigns permissions to roles. Both joins have unique pair constraints and foreign-key cascades.
- `Role` has unique `code`, `name`, description, `portalScope`, and `isActive`; there is no system-role flag, so canonical codes are protected in services. `Permission` has unique `code`, description, and `isActive`.
- These RBAC tables and identity links were added by `backend/prisma/migrations/20260925075357_add_rbac_foundation/migration.sql`. Existing schema supports user-role and role-permission relationships without a new join-table design.

### Authentication and authorization

- Login/auth/session APIs are in `backend/routes/authRoute.js` and `backend/controllers/authController.js`; account validation and login are in `backend/services/authService.js`.
- `authenticate` in `backend/middleware/unifiedAuth.js` validates the access token, `AuthSession`, canonical account, account status, primary role, profile ownership, and MFA requirement. It then populates `req.auth` and legacy controller fields.
- Portal login is isolated by `AuthAccount.role`, not merely by an RBAC mapping. Do not change the primary role as a side effect of assigning an admin permission role.
- `authorize(permission)` in `backend/middleware/authorize.js` resolves active role/permission mappings through `backend/services/rbacService.js`. The permission lookup is database-backed per request and uses only request-local caching, so role-permission changes apply on subsequent requests without waiting for token refresh.
- `all:function` is a server-side permission bypass. `backend/prisma/seed.js` assigns it through the canonical `ADMIN` role; only that protected system role can receive it through the new API.
- `requireRole` and portal context helpers also consume mapped roles. Role assignment therefore affects more than sidebar presentation and must be separately authorized and constrained.
- Inactive accounts are rejected by authenticated-request middleware and refresh. The new portal deactivation service also revokes all live sessions in the same transaction.
- Admin 2FA is part of the existing authentication flow and must be preserved.

### Roles, permissions, seed, and audit

- `backend/prisma/seed.js` defines the four canonical global roles: `ADMIN`, `CUSTOMER`, `MANUFACTURER`, and `MARKETING_PARTNER`, and the system permission catalog.
- The seed upserts canonical role definitions and permission definitions and reconciles each canonical role's permission mappings. Do not make custom admin access depend on modifying canonical-role mappings that seeding can restore.
- No `isSystemRole` flag exists; `portalScope` was added in Iteration 2. Protect canonical roles by their codes; do not hard-delete roles because mapping foreign keys cascade.
- Permissions are system-defined in the seed and currently have no CRUD API. A permission catalog should initially be read-only; role-permission assignment is the configurable operation.
- `AuthAuditLog` remains authentication/2FA-focused. `AccessManagementAuditLog` now records user/role mutations with actor, target, action, metadata, and timestamp.
- `backend/tests/rbacAuthorization.test.js`, `backend/tests/accessManagementService.test.js`, `backend/tests/authHardening.test.js`, and the revised `backend/tests/privilegeEscalationAudit.test.js` cover the new authorization and safety boundaries.

### Backend API surface

- Routes are mounted from `backend/server.js`; authorization convention is `authenticate` followed by `authorize("permission:code")` in the route layer.
- `backend/routes/userRoute.js` retains customer profile operations and Admin password change. New Admin access APIs are mounted at `/api/admin/access`.
- `backend/routes/customerRoute.js` provides customer-business-record listing/details, not general `AuthAccount` management.
- `/api/admin/access` provides protected portal-specific user list/detail/update/status APIs, Admin provisioning/role assignment, Admin role management, and a read-only permission catalog.
- Existing creation flows create the correct principal role, profile, and RBAC mapping transactionally for customers/manufacturers/marketing partners. A new admin-provisioning flow should follow that transactional pattern and must not reuse another portal's profile or role.

### Admin frontend

- `admin/src/App.jsx` checks the session with `/api/auth/me`, receives scoped roles/permissions, requires primary role `ADMIN`, and guards direct routes. Initial-password accounts render only the password-change flow until rotation succeeds.
- `admin/src/components/Sidebar.jsx` now uses the same route permission map to hide unauthorized groups and links. `PermissionsContext` provides `can`/`canAny` for access-control actions.
- Admin pages use direct Axios calls with a token header. `admin/src/api/authInterceptor.js` handles access-token refresh and redirects after unrecoverable 401 responses.
- `admin/src/pages/Customers.jsx` demonstrates server-side search and pagination; `admin/src/components/Pagination.jsx` is reusable. Toasts and `window.confirm` are existing interaction patterns.
- There is no shared admin table/modal/form library surfaced in `admin/src/components`; follow current page conventions unless a more specific nearby pattern is identified during implementation.

## Iteration 2 Delivered

- Added `Role.portalScope`, `AuthAccount.mustChangePassword`, Admin display/first/last-name fields, and `AccessManagementAuditLog` in the Prisma schema and migration `20260930100000_admin_user_management`.
- Backfilled canonical role scopes and seeded granular `access:*` permissions. The Admin seed sets a configurable display name and requires password rotation if the seed credential has not previously been changed.
- Added portal-specific user APIs for Admin, Customer, Manufacturer, and Marketing Partner accounts. Admin provisioning is supported; existing signup/creation paths for other portals remain unchanged. Deactivation is soft and revokes sessions; no hard-delete endpoint exists.
- Added Admin-only role CRUD/status/permission assignment and a read-only, searchable permission catalog. Roles are scoped to Admin; canonical roles are protected; custom roles cannot receive `all:function` or permissions assigned to active non-Admin portal roles.
- Added actor/target audit writes, transaction boundaries, duplicate/error response handling, portal filters, server-side search/pagination, role grant ceilings, self-mutation blocks, and last-full-Admin protection.
- Added forced first-login password rotation at the shared authentication middleware. Session inspection, logout, and password-change endpoints are the only allowed authenticated paths before rotation.
- Added Admin UI for portal users, Admin roles, permissions, permission-aware sidebar/routes/actions, effective-permission details, and status controls.

### Verification completed

- Prisma schema validation: passed.
- Focused backend RBAC/access/auth suites: 32 passed; forced-password middleware case: passed.
- DB-backed auth-hardening suite: 6 passed.
- Rollback-only Prisma smoke exercised Admin role/permission updates, provisioning, list/update/role assignment, and activate/deactivate. All writes rolled back, and read-only counts confirmed no temporary rows remained.
- Prisma client generation: passed after stopping the process that held the Windows engine DLL.
- The additive feature migration was executed against local `localhost/clothing`, followed by the seed. A schema diff now shows only two pre-existing default drifts (`CustomerLevel.badgeIcon`, `SpecialOffer.badgeText`).
- Backend restarted successfully on port 4000; unauthenticated `GET /api/admin/access/users/admin` returned 401.
- Targeted lint for changed Admin files: no errors; App has one Fast Refresh warning.
- Admin production build: passed; Vite reports the existing large-bundle warning.
- Full Admin lint remains red from numerous pre-existing errors in unrelated pages; no unrelated cleanup was made.

## Preserved Security Decisions

- Treat `AuthAccount.role` as the portal boundary. An admin-created admin account must use primary role `ADMIN` and only the admin profile; never create manufacturer, marketing, or customer access as an incidental role assignment.
- Do not map a new restricted admin account to canonical `ADMIN` unless full `all:function` access is intended. Use a custom role for least-privilege admin permissions.
- Never accept client-supplied permission codes or role codes without backend lookup, validation, and separate authorization for assignment operations.
- Keep permissions read-only/system-defined unless the owner explicitly requests a new permission-authoring model.
- Preserve Admin MFA, current password hashing, session validation, token refresh, customer/manufacturer/marketing flows, and public webhook routes.
- Use transactions for account/profile/role creation and mapping updates. Never return or log passwords/hashes.
- Use account status `INACTIVE` for deactivation. Revoke all outstanding account sessions on deactivation.
- Protect canonical role codes from deletion and from edits that conflict with seed reconciliation. Prefer deactivation over hard deletion for custom roles with historical mappings.
- Backend authorization is mandatory even after adding frontend guards.
- Admin management APIs reject all self-target mutations. Password rotation remains allowed as an authentication requirement. The last active full Admin cannot be deactivated or lose the final canonical Admin role.
- Existing manufacturer/partner contract and approval workflows remain in place; account management does not replace signup, registration, partner creation, or approval paths.

## Owner-confirmed decisions

- User management is portal-specific for Admin, Marketing Partner, Manufacturer, and Customer accounts.
- Admin user creation/editing includes display name, first name, last name, contact number, email, and one or more Admin-portal roles.
- Admin display name is editable; the seeded Admin receives a display name in the seed.
- An administrator sets a new Admin user's initial password. The user must change it after the first successful login.
- Custom role management is for the Admin portal only. Marketing Partner, Manufacturer, and Customer roles/permissions remain as currently defined.
- Marketing Partner, Manufacturer, and Customer management provides read/update/deactivate (no record deletion) and activation/deactivation where the account's current lifecycle permits it.
- Existing signup/creation flows remain unchanged for Marketing Partner, Manufacturer, and Customer accounts.
- Admins cannot change anything about their own account through management APIs or modify roles assigned to themselves.
- A dedicated access-management audit table is approved; authentication audit semantics remain separate.

## Remaining Environment Work

- [ ] Do not run `prisma migrate deploy` against local `clothing` yet: `_prisma_migrations` is absent and Prisma reports 36 historical migrations pending.
- [ ] Establish a baseline only after reviewing earlier data migrations, especially `20260916153500_normalize_packed_status`; do not blindly mark the old migrations applied or replay them.
- [ ] Manually verify seeded Admin display name/forced password rotation and portal-user workflows in the running Admin UI.
- [ ] Keep the two unrelated default drifts unchanged unless separately approved.
- [x] Confirm access-management APIs require authentication, primary Admin role, and granular permissions; live unauthenticated access returns 401.
- [ ] Preserve the unrelated `backend/logs/app.log` worktree modification.

## Owner decisions

All product/security decisions are confirmed. The feature migration and seed are applied locally. Remaining work is migration-history hygiene and manual UI verification; continue from this checklist rather than repeating discovery.
