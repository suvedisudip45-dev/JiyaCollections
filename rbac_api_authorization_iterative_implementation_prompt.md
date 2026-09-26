# Secure RBAC + API Authorization Implementation Prompt

## Role

Act as an **18+ years experienced software architect, system designer, security architect, backend architect, database architect, API designer, performance engineer, and project manager** with deep production knowledge of Node.js, Express, React, npm, MVC/layered architecture, SQL databases, authentication, RBAC, API security, OWASP API Security, database optimization, and scalable multi-portal systems.

You are working on a security-sensitive production application. **Security, backward compatibility, and correctness are more important than speed of implementation.**

---

# 1. Project

Current repository:

```text
clothing-store-ecommerce/
├── frontend/       # Customer portal
├── backend/        # Shared backend/server
├── manufacturer/   # Manufacturer portal
├── admin/          # Admin portal
└── marketing/      # Marketing Partner portal
```

There is one shared backend/server and four portals.

The project already has a common User table for authentication/identity. Inspect it and reuse it where appropriate rather than creating duplicate credential tables.

The desired authorization architecture is:

```text
User
  │
  ▼
UserRoleMapping
  │
  ▼
Role
  │
  ▼
RolePermissionMapping
  │
  ▼
Permission
```

Core tables/entities should be:

```text
User
Role
Permission
UserRoleMapping
RolePermissionMapping
```

However, **do not create these blindly**. First inspect the existing schema and reuse/extend equivalent structures where they already exist.

---

# 2. Main Goal

Implement a secure, centralized **Role-Based Access Control (RBAC) + Permission-Based API Authorization** system.

The backend must decide:

> Can this authenticated user perform this operation on this resource?

Frontend authorization is only for UX.

**Frontend must never be the security boundary.**

The backend/API must be authoritative.

---

# 3. Critical Development Rule — Iterative Execution

## DO NOT implement the entire project in one operation.

Break the project into **small, independently verifiable iterations**.

### Mandatory workflow

```text
Analyze
   ↓
Plan Iteration 1
   ↓
Implement Iteration 1
   ↓
Test Iteration 1
   ↓
Review Iteration 1
   ↓
STOP
   ↓
Wait for approval
   ↓
Plan Iteration 2
   ↓
Implement Iteration 2
   ↓
Test Iteration 2
   ↓
Review Iteration 2
   ↓
STOP
   ↓
...
```

### Absolute rule

**Never start the next iteration until the current iteration is completely tested and verified.**

Do not combine multiple iterations merely because they are technically related.

Each iteration must produce a stable checkpoint.

---

# 4. FIRST ACTION — ANALYZE ONLY

Before changing any code:

- inspect the entire repository
- inspect backend architecture
- inspect database schema
- inspect migrations
- inspect models
- inspect controllers
- inspect services
- inspect repositories
- inspect middleware
- inspect routes
- inspect authentication
- inspect all four portals
- inspect API clients
- inspect frontend route protection
- inspect existing role checks
- inspect existing permission checks
- inspect error handling
- inspect package versions
- inspect build/test scripts

**Do not modify code during this analysis phase.**

---

# 5. Architecture Analysis Deliverables

Create:

```text
docs/rbac/current-architecture-analysis.md
docs/rbac/current-api-inventory.md
docs/rbac/current-authentication-analysis.md
```

Document:

## Backend architecture

```text
Request
 ↓
Route
 ↓
Middleware
 ↓
Controller
 ↓
Service
 ↓
Repository/Model
 ↓
Database
```

Adapt this to the actual project.

## Database

Document:

- current User table
- authentication-related fields
- existing role structures
- existing permission structures
- mappings
- indexes
- foreign keys
- constraints
- migrations
- seeds

## Authentication

Determine exactly:

- login flow
- token/session mechanism
- token storage
- authentication middleware
- current user resolution
- logout
- expiry
- refresh mechanism if any

## Existing authorization

Find:

- role checks
- permission checks
- portal checks
- controller-level authorization
- route-level authorization
- frontend-only authorization

Do not assume anything.

---

# 6. API INVENTORY

Inspect every backend route.

Create a matrix:

| Method | API | Domain | Public/Auth/Permission | Required Permission | Resource Scope |
|---|---|---|---|---|---|

Every API must be intentionally classified as:

```text
PUBLIC
AUTHENTICATED
PERMISSION_PROTECTED
```

Examples:

```text
Register
→ PUBLIC

Province list
→ PUBLIC

District list
→ PUBLIC

Current user profile
→ AUTHENTICATED

Order list
→ PERMISSION_PROTECTED

Admin user management
→ PERMISSION_PROTECTED
```

These are examples only. Derive the actual classification from the repository.

---

# 7. Public API Rule

Some APIs intentionally require no authentication.

Examples may include:

```text
register
province lookup
district lookup
public reference data
```

But public does NOT mean unrestricted.

Review public endpoints for:

- validation
- rate limiting
- abuse prevention
- payload limits
- enumeration
- excessive data exposure
- injection
- safe error messages

Never accidentally expose sensitive APIs.

---

# 8. Authentication vs Authorization

Maintain a strict separation.

### Authentication

Answers:

```text
Who is the user?
```

### Authorization

Answers:

```text
Is this user allowed to perform this operation?
```

Desired request flow:

```text
Request
 ↓
Authentication
 ↓
Trusted User Identity
 ↓
Resolve Roles
 ↓
Resolve Permissions
 ↓
Permission Check
 ↓
Resource Ownership/Scope Check
 ↓
Controller
```

Protected APIs must fail closed.

---

# 9. RBAC Database Design

Evaluate the following:

```text
User
Role
Permission
UserRoleMapping
RolePermissionMapping
```

Expected relationships:

```text
User
  1 ─── N
UserRoleMapping
  N ─── 1
Role
  1 ─── N
RolePermissionMapping
  N ─── 1
Permission
```

Use actual project conventions.

Do not duplicate existing functionality.

---

# 10. User Table

Use the existing User table for shared identity where appropriate.

Possible fields:

```text
id
email
passwordHash
contactNumber
status
createdAt
updatedAt
...
```

Do not create separate credential tables for:

```text
customer
manufacturer
admin
marketing partner
```

unless analysis proves that the existing architecture requires it.

---

# 11. Role Design

Possible roles include:

```text
SUPER_ADMIN
ADMIN
CUSTOMER
MANUFACTURER
MARKETING_PARTNER
```

These are examples.

Inspect existing role naming conventions first.

Roles should represent business responsibilities.

Do not scatter role names throughout controllers.

---

# 12. Permission Design

Permissions should represent specific capabilities.

Examples:

```text
USER_READ
USER_CREATE
USER_UPDATE
USER_DELETE

PRODUCT_READ
PRODUCT_CREATE
PRODUCT_UPDATE
PRODUCT_DELETE

ORDER_READ
ORDER_CREATE
ORDER_UPDATE
ORDER_DELETE

MANUFACTURER_READ
MANUFACTURER_UPDATE

MARKETING_CARD_READ
MARKETING_CARD_ASSIGN
MARKETING_CARD_VALIDATE

CAMPAIGN_READ
CAMPAIGN_CREATE
CAMPAIGN_UPDATE

REPORT_READ
```

These are examples only.

Derive the actual permission catalog from real APIs and business operations.

Permission codes must be stable and unique.

---

# 13. ALL_FUNCTION / SUPER_ADMIN

The desired system may support:

```text
ALL_FUNCTION
```

with:

```text
SUPER_ADMIN
    ↓
ALL_FUNCTION
```

Before implementing it, compare:

### Approach A

Database permission:

```text
ALL_FUNCTION
```

### Approach B

Special server-side SUPER_ADMIN capability.

Evaluate:

- security
- auditability
- performance
- privilege escalation risk
- revocation
- maintainability

Choose the safer design based on the actual architecture.

If `ALL_FUNCTION` is used:

- it must be server-side
- assignment must be highly restricted
- normal admins must not be able to grant it
- self-assignment must be impossible
- assignment must be auditable
- frontend must not be able to trigger it
- authorization must fail closed

---

# 14. API-Level Authorization

Every protected API must have a server-side permission check.

Conceptually:

```javascript
router.get(
  "/orders",
  authenticate,
  authorize("ORDER_READ"),
  controller.getOrders
);
```

Use the project's existing architecture and naming conventions.

The important rule is:

```text
Permission check MUST happen before protected business logic executes.
```

Never rely on:

- hidden frontend buttons
- frontend routes
- localStorage values
- request body role
- query parameter role
- client-provided permission
- URL obscurity

---

# 15. Central Authorization Middleware

Create a centralized authorization mechanism such as:

```text
authenticate()
authorize(permission)
```

or the equivalent appropriate to the current architecture.

Conceptual flow:

```text
authenticate()
       ↓
trusted req.user
       ↓
authorize(REQUIRED_PERMISSION)
       ↓
resource scope
       ↓
controller
```

Do not duplicate authorization logic across controllers.

---

# 16. Fail-Closed Requirement

If any protected authorization dependency fails:

```text
unknown user
invalid token
expired token
unknown role
unknown permission
permission lookup failure
authorization service failure
database authorization failure
```

the request must NOT continue.

Protected request:

```text
Authorization failure
        ↓
DENY
```

Never:

```text
Authorization error
        ↓
Continue anyway
```

---

# 17. HTTP Security Semantics

Use:

```text
401 Unauthorized
```

for missing/invalid authentication.

Use:

```text
403 Forbidden
```

for authenticated users without required permission.

Do not unnecessarily expose internal authorization details to clients.

---

# 18. Resource-Level Authorization

RBAC alone may not be sufficient.

Analyze APIs for ownership/scope.

Example:

```text
Manufacturer A
```

may have:

```text
ORDER_READ
```

but must not automatically access:

```text
Manufacturer B's orders
```

Similarly:

```text
Marketing Partner A
```

must not access:

```text
Marketing Partner B's cards
```

Therefore where required:

```text
RBAC
+
Permission
+
Resource Ownership/Scope
```

Examples:

```text
Customer → own orders
Manufacturer → assigned/owned resources
Marketing Partner → own campaigns/cards
Admin → authorized administrative scope
```

Use the actual project business rules.

---

# 19. Prevent Privilege Escalation

Treat these as highly sensitive:

```text
create role
update role
assign role
remove role
create permission
assign permission
remove permission
grant ALL_FUNCTION
assign SUPER_ADMIN
```

Normal users must not modify authorization structures.

An admin must not automatically have permission to grant themselves higher privileges.

Never trust client-submitted:

```text
role
roleId
permissionId
permission
isSuperAdmin
```

without backend authorization.

---

# 20. Mass Assignment Protection

Never blindly persist:

```javascript
database.update(req.body)
```

for sensitive objects.

Explicitly validate allowed fields.

A normal user profile update must not silently change:

```text
role
permissions
isSuperAdmin
accountStatus
```

unless the endpoint is explicitly designed and authorized for it.

---

# 21. Permission Lookup Performance

The user requires fast APIs and low resource consumption.

First measure the existing architecture.

Possible strategies:

### Request-scoped permission resolution

Load permissions once per request rather than repeatedly.

### Short-lived cache

Evaluate caching if justified.

If caching is used, document:

```text
cache key
TTL
invalidation
role change behavior
permission change behavior
security implications
```

Never let stale authorization data create an unacceptable privilege escalation window.

Do not automatically place a huge permission list inside JWTs.

Evaluate token size, staleness, revocation, and network overhead first.

---

# 22. Database Optimization

Evaluate indexes for frequent authorization lookups.

Potential examples:

```text
UserRoleMapping(userId, roleId)
RolePermissionMapping(roleId, permissionId)
Permission(code)
Role(code)
```

Potential unique constraints:

```text
(userId, roleId)
(roleId, permissionId)
```

Use actual database/ORM conventions.

Do not add redundant indexes.

---

# 23. Frontend Role/Permission Usage

Frontend may use permissions to:

```text
show/hide navigation
show/hide buttons
disable actions
```

But:

```text
Frontend authorization ≠ security
```

Backend authorization is always authoritative.

---

# 24. Portal Isolation

The four portals are:

```text
Customer
Manufacturer
Admin
Marketing Partner
```

Verify that:

```text
Customer → Admin APIs = DENY
Customer → Manufacturer APIs = DENY
Customer → Marketing APIs = DENY

Manufacturer → Admin APIs = DENY
Manufacturer → Marketing APIs = DENY unless explicitly required

Marketing Partner → Admin APIs = DENY
Marketing Partner → Manufacturer APIs = DENY unless explicitly required

Admin → only APIs permitted by assigned permissions
```

Do not assume role alone is sufficient.

---

# 25. Iterative Implementation Plan

The implementation MUST be completed in the following small iterations.

## ITERATION 0 — Architecture Discovery

### Goal

Understand the project completely.

### Actions

- inspect repository
- inspect backend
- inspect database
- inspect authentication
- inspect authorization
- inspect routes
- inspect all portals
- inspect package versions
- inspect tests

### Deliverables

```text
docs/rbac/current-architecture-analysis.md
docs/rbac/current-api-inventory.md
docs/rbac/current-authentication-analysis.md
```

### Code changes

**NONE**

### Completion gate

Do not continue until:

- architecture is understood
- current auth is documented
- current API inventory is complete
- existing authorization is documented

Then STOP.

---

## ITERATION 1 — RBAC Architecture Design

### Goal

Design without changing runtime behavior.

### Actions

Design:

```text
User
Role
Permission
UserRoleMapping
RolePermissionMapping
```

Design:

```text
Authentication
Authorization
Permission resolution
Resource scope
Super-admin
```

### Deliverable

```text
docs/rbac/rbac-design.md
docs/rbac/security-model.md
docs/rbac/api-permission-matrix.md
```

### Code changes

Prefer **NONE**.

### Completion gate

Review:

- security
- data model
- API mapping
- portal isolation
- performance
- migration safety

Then STOP.

---

## ITERATION 2 — Database Migration

### Goal

Implement the minimum database structures required.

### Actions

- create/modify Role
- create/modify Permission
- create/modify UserRoleMapping
- create/modify RolePermissionMapping
- add constraints
- add indexes
- add seeds

### Requirements

Seeds must be idempotent.

Do not hard-code database IDs.

Use stable role/permission codes.

### Tests

- fresh database
- migration
- rollback if supported
- seed
- duplicate seed execution
- foreign key validation
- unique constraint validation

### Completion gate

Database must pass all tests.

Then STOP.

---

## ITERATION 3 — Authorization Core

### Goal

Build the centralized authorization service.

Implement only what is required.

Possible functions:

```text
getUserRoles()
getUserPermissions()
hasPermission()
hasAnyPermission()
hasAllPermissions()
hasRole()
canAccessResource()
```

### Requirements

- fail closed
- no frontend trust
- no client-provided role trust
- efficient lookup
- centralized logic

### Tests

Unit test every authorization decision.

### Completion gate

Authorization service passes tests.

Then STOP.

---

## ITERATION 4 — Authentication Integration

### Goal

Connect existing authentication to the authorization context.

### Requirements

After successful authentication:

```text
trusted user identity
```

must be available to authorization middleware.

Do not rewrite working authentication unnecessarily.

Preserve existing login/logout/session behavior.

### Tests

- valid login
- invalid login
- expired token/session
- logout
- protected endpoint

### Completion gate

Existing authentication still works.

Then STOP.

---

## ITERATION 5 — API Authorization Middleware

### Goal

Implement:

```text
authenticate()
authorize(permission)
```

or equivalent project-native middleware.

### Requirements

```text
unauthenticated → 401
authenticated without permission → 403
authorized → continue
authorization failure → deny
```

### Tests

Test middleware independently.

### Completion gate

Middleware is stable.

Then STOP.

---

## ITERATION 6 — Public and Authenticated APIs

### Goal

Secure only:

```text
PUBLIC
AUTHENTICATED
```

classification first.

Examples:

```text
register → PUBLIC
province → PUBLIC
district → PUBLIC
profile → AUTHENTICATED
logout → AUTHENTICATED
```

Use actual project APIs.

### Tests

Verify:

```text
public works without login
authenticated API rejects anonymous users
```

### Completion gate

No public API accidentally exposes private information.

Then STOP.

---

## ITERATION 7 — Admin API Authorization

### Goal

Protect admin APIs based on permissions.

Do not simply use:

```text
role === ADMIN
```

unless genuinely required.

Map actual admin endpoints to permissions.

### Tests

- admin with permission
- admin without permission
- customer attempting admin API
- manufacturer attempting admin API
- marketing partner attempting admin API

### Completion gate

Admin API authorization passes.

Then STOP.

---

## ITERATION 8 — Manufacturer API Authorization

### Goal

Protect manufacturer APIs.

Include resource ownership/scope where required.

### Tests

```text
Manufacturer A → own resource = allowed
Manufacturer A → Manufacturer B resource = denied
Customer → manufacturer API = denied
```

### Completion gate

Manufacturer security passes.

Then STOP.

---

## ITERATION 9 — Marketing Partner API Authorization

### Goal

Protect marketing APIs.

Include partner ownership/scope where required.

Relevant domains may include:

```text
marketing cards
campaigns
benefits
reports
customer/card validation
```

Use only APIs that actually exist.

### Tests

```text
Marketing A → own data = allowed
Marketing A → Marketing B data = denied
Customer → marketing administration API = denied
```

### Completion gate

Marketing authorization passes.

Then STOP.

---

## ITERATION 10 — Customer API Authorization

### Goal

Protect customer-specific APIs.

Ensure users cannot access another customer's private resources.

Test:

```text
Customer A → own resource = allowed
Customer A → Customer B resource = denied
```

### Completion gate

Customer isolation verified.

Then STOP.

---

## ITERATION 11 — Super Admin / ALL_FUNCTION

### Goal

Implement the highest privilege level safely.

### Requirements

- explicit server-side behavior
- protected assignment
- no self-escalation
- audit sensitive changes
- normal admin cannot grant it unless explicitly authorized

### Tests

```text
SUPER_ADMIN → authorized privileged API = allowed
ADMIN → ALL_FUNCTION-only API = denied unless assigned
ADMIN → assign SUPER_ADMIN to self = denied
ordinary user → grant ALL_FUNCTION = denied
```

### Completion gate

Privilege escalation tests pass.

Then STOP.

---

## ITERATION 12 — Resource-Level Authorization

### Goal

Add ownership/scope checks where RBAC is insufficient.

Audit:

```text
customer resources
manufacturer resources
marketing partner resources
admin resources
```

### Completion gate

Cross-owner access tests pass.

Then STOP.

---

## ITERATION 13 — Security Hardening

Perform focused security review for:

```text
BOLA / IDOR
BFLA
privilege escalation
mass assignment
role manipulation
permission manipulation
token manipulation
session manipulation
cross-portal access
injection
excessive data exposure
rate limiting
CORS
CSRF where applicable
```

Fix confirmed issues.

Add regression tests.

Then STOP.

---

## ITERATION 14 — Performance Optimization

Only optimize after correctness is proven.

Measure:

- authorization query count
- query latency
- API latency
- database load
- response size

Optimize:

- indexes
- duplicate permission lookups
- request-scoped permission resolution
- safe caching
- unnecessary joins
- unnecessary data loading

Do not sacrifice authorization correctness.

Then STOP.

---

## ITERATION 15 — Full Regression

Run actual project commands for:

```text
lint
typecheck
unit tests
integration tests
API tests
frontend builds
backend build
```

Verify:

```text
Customer portal
Manufacturer portal
Admin portal
Marketing Partner portal
```

Verify all existing business flows.

Then STOP.

---

# 26. Iteration Completion Report

After EVERY iteration, report:

```text
ITERATION:
STATUS:

Objective:

Files inspected:
Files created:
Files modified:

Database changes:

API changes:

Security changes:

Tests added:

Tests executed:

Test result:

Build result:

Existing functionality verified:

Security risks discovered:

Performance impact:

Known limitations:

Rollback plan:

NEXT ITERATION:
```

Then **STOP**.

Never automatically start the next iteration.

---

# 27. Security Test Matrix

At minimum implement tests for:

## Authentication

```text
No token → protected API = 401
Invalid token → protected API = 401
Expired token → protected API = 401
```

## Permissions

```text
Valid permission → allow
Missing permission → 403
```

## Portal isolation

```text
Customer → Admin API = deny
Customer → Manufacturer API = deny
Customer → Marketing admin API = deny

Manufacturer → Admin API = deny
Marketing Partner → Admin API = deny
```

## Resource isolation

```text
Customer A → Customer B resource = deny
Manufacturer A → Manufacturer B resource = deny
Marketing A → Marketing B resource = deny
```

## Privilege escalation

```text
Normal user → SUPER_ADMIN = deny
Normal user → ALL_FUNCTION = deny
Unauthorized admin → SUPER_ADMIN = deny
Unauthorized admin → ALL_FUNCTION = deny
```

## Public APIs

```text
Anonymous → public registration = allow
Anonymous → province = allow
Anonymous → district = allow
Anonymous → private API = deny
```

---

# 28. Security Principles

Always follow:

```text
Least privilege
Default deny
Fail closed
Defense in depth
Explicit authorization
Server-side enforcement
Resource ownership validation
Secure defaults
Minimal data exposure
Auditability
```

---

# 29. Performance Principles

Follow:

```text
Measure before optimizing
Indexed lookups
No N+1 authorization queries
No repeated permission queries
Small authorization context
Small API responses
No unnecessary joins
No oversized JWT claims
Safe caching only when justified
Correct cache invalidation
```

---

# 30. Do Not Break Existing Architecture

Do NOT:

- rewrite the backend unnecessarily
- replace the ORM unnecessarily
- replace the database unnecessarily
- replace authentication unnecessarily
- move controllers without reason
- rename unrelated APIs
- change response structures unnecessarily
- change frontend architecture unnecessarily
- introduce a new framework unnecessarily
- add unnecessary packages
- duplicate existing utilities
- modify unrelated business logic

Prefer the smallest secure change that fits the existing architecture.

---

# 31. Package / npm Rules

Before adding any npm package:

1. check whether the project already has equivalent functionality
2. check current package versions
3. determine whether the dependency is actually required
4. consider security and maintenance
5. avoid unnecessary dependencies
6. explain why the dependency is needed

Do not add packages merely for convenience.

---

# 32. Final Definition of Done

## Architecture

- [ ] Repository fully analyzed
- [ ] Backend architecture documented
- [ ] Authentication documented
- [ ] Authorization documented
- [ ] API inventory completed
- [ ] API classification completed
- [ ] Resource ownership requirements documented

## Database

- [ ] Existing User table reused where appropriate
- [ ] Role implemented/verified
- [ ] Permission implemented/verified
- [ ] UserRoleMapping implemented/verified
- [ ] RolePermissionMapping implemented/verified
- [ ] Foreign keys
- [ ] Unique constraints
- [ ] Appropriate indexes
- [ ] Idempotent seeds

## Authorization

- [ ] Central authorization service
- [ ] API-level permission checks
- [ ] Authentication middleware
- [ ] Authorization middleware
- [ ] Default deny
- [ ] Fail closed
- [ ] 401 handling
- [ ] 403 handling
- [ ] Resource ownership checks
- [ ] Portal isolation
- [ ] Super-admin protection

## Public APIs

- [ ] Public APIs explicitly classified
- [ ] Input validation
- [ ] Rate limiting where required
- [ ] Abuse protection
- [ ] No sensitive data exposure

## Security

- [ ] Frontend is not security boundary
- [ ] Client role cannot be trusted
- [ ] Client permission cannot be trusted
- [ ] Mass assignment protected
- [ ] Privilege escalation prevented
- [ ] BOLA/IDOR reviewed
- [ ] BFLA reviewed
- [ ] Sensitive security events audited where appropriate
- [ ] Secrets/tokens/passwords not logged

## Performance

- [ ] Permission lookups optimized
- [ ] Indexes verified
- [ ] No N+1 authorization queries
- [ ] Request-scoped permission resolution where appropriate
- [ ] Caching evaluated
- [ ] Cache invalidation documented
- [ ] Response sizes reviewed

## Regression

- [ ] Customer portal works
- [ ] Manufacturer portal works
- [ ] Admin portal works
- [ ] Marketing portal works
- [ ] Existing login works
- [ ] Existing signup works
- [ ] Existing business flows work
- [ ] Existing tests pass
- [ ] Builds pass

---

# 33. FINAL OPERATING INSTRUCTION

**Do not start coding immediately.**

First analyze the complete project and produce the architecture/security/API inventory.

Then execute exactly one small iteration.

After that iteration:

1. test it
2. review it
3. report the result
4. verify existing functionality
5. verify security
6. STOP

Only proceed to the next iteration after explicit approval.

At every stage prioritize:

```text
Security
>
Correctness
>
Backward Compatibility
>
Maintainability
>
Performance
>
Implementation Speed
```

The final system must enforce authorization at the **API/backend level**, not merely at the frontend level.

The backend must remain the single source of truth for access control.
