# JWT Authentication + Refresh Token + RBAC Integration — Iterative Implementation Prompt

## 1. Role and Engineering Standard

Act as a **senior software architect, backend engineer, frontend engineer, database designer, API security engineer, and system designer with 15+ years of production experience**.

You are working on an existing clothing-store e-commerce system with four portals and one shared backend.

Your responsibility is to integrate a secure, maintainable, performant JWT authentication system into the **existing architecture without unnecessarily breaking or rewriting existing functionality**.

Mandatory workflow:

> **Inspect → Understand → Analyze → Design → Plan one iteration → Implement → Test → Review → STOP → Wait for approval → Next iteration**

You MUST complete only one iteration at a time. After every iteration, STOP and wait for explicit approval such as `APPROVED`, `CONTINUE`, or `NEXT ITERATION`.

---

## 2. Existing Project Architecture

```text
clothing-store-ecommerce/
├── frontend/       # Customer portal
├── backend/        # Shared backend/server
├── manufacturer/   # Manufacturer portal
├── admin/          # Admin portal
└── marketing/      # Marketing Partner portal
```

The backend is shared by all portals. Authentication must therefore be centralized in the backend rather than implementing four independent authentication systems.

---

## 3. Primary Objective

Implement centralized JWT authentication consisting of:

1. Short-lived Access Token
2. Refresh Token
3. Secure token/session persistence
4. Logout invalidation
5. Refresh-token rotation
6. Refresh-token reuse detection
7. Unique JWT `jti` / `token_id`
8. Authenticated user role context
9. Environment-based secrets and configuration
10. API-level authentication
11. Foundation for RBAC and permission authorization
12. Frontend integration for all portals
13. Secure token storage and lifecycle
14. Centralized authentication middleware/guard
15. Proper database constraints and indexes
16. Security/audit logging where appropriate

Do not introduce an unrelated architecture. Adapt to the existing project.

---

## 4. First Rule — Inspect Before Coding

Before changing code, inspect:

- complete repository structure
- backend framework/language
- frontend frameworks
- database and ORM
- existing `User` model/table
- current login and registration APIs
- password hashing
- middleware/guards/interceptors
- routing
- controller/service/repository architecture
- environment configuration
- error handling
- frontend API client
- frontend route protection
- existing roles
- admin/manufacturer/marketing/customer distinctions
- migrations
- tests
- current API response conventions

Do not assume the technology stack.

Do not create files merely because a framework commonly uses them.

---

## 5. Existing User Table

Reuse the existing shared `User` table/model.

Do not create four independent user tables.

Do not unnecessarily rename or restructure existing fields.

If changes are necessary, document exactly why and verify regression impact.

---

## 6. Access Token

Access tokens are short-lived and used for normal protected API requests:

```http
Authorization: Bearer <access_token>
```

Initial configuration:

```env
JWT_ACCESS_TOKEN_EXPIRES_IN=5m
```

Never hard-code `5m` into source code.

---

## 7. Refresh Token

Refresh tokens are used only to obtain new access/refresh tokens.

Initial configuration:

```env
JWT_REFRESH_TOKEN_EXPIRES_IN=15m
```

Never hard-code `15m` into source code.

Do not accept refresh tokens as normal API authorization credentials.

---

## 8. Environment-Only Secrets

All JWT secrets/configuration must come from environment variables.

Recommended:

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TOKEN_EXPIRES_IN=5m
JWT_REFRESH_TOKEN_EXPIRES_IN=15m
JWT_ISSUER=
JWT_AUDIENCE=
```

Adapt names to existing configuration conventions.

Use separate access and refresh secrets.

Never put secrets in:

- source code
- frontend code
- committed configuration
- seed files
- README examples with real values
- logs

Add startup validation for required configuration.

Never silently fall back to weak default secrets.

Frontend environment variables are NOT secret and must never contain JWT signing secrets.

---

## 9. JWT Payload

Use standard `jti` as the unique token identifier. Internally it may be called `token_id`.

Recommended access-token payload:

```json
{
  "sub": "USER_ID",
  "jti": "UNIQUE_TOKEN_ID",
  "role": "CUSTOMER",
  "token_type": "access",
  "iat": 1234567890,
  "exp": 1234568190,
  "iss": "application",
  "aud": "application"
}
```

Refresh token:

```json
{
  "sub": "USER_ID",
  "jti": "UNIQUE_REFRESH_TOKEN_ID",
  "role": "CUSTOMER",
  "token_type": "refresh",
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "application",
  "aud": "application"
}
```

Never place passwords, password hashes, OTPs, payment information, secrets, or unnecessary sensitive personal information into JWT payloads.

JWTs are encoded, not encrypted.

---

## 10. Token IDs and Database Tracking

Do not rely on purely stateless JWTs if logout must immediately invalidate credentials.

Use server-side session/token state.

A suitable model may be:

```text
AuthSession / RefreshToken
```

with fields such as:

```text
id
user_id
token_id / jti
token_type
token_family_id
issued_at
expires_at
revoked_at
replaced_by_token_id
last_used_at
created_at
updated_at
```

Optional fields only when justified:

```text
created_ip
last_used_ip
user_agent
revocation_reason
```

Maintain:

```text
database primary key
+
unique JWT token_id/jti
```

Do not assume they must be the same identifier.

Every newly issued token gets a new unique `jti`.

---

## 11. Logout Invalidation

Do not interpret logout as merely "generate another token ID."

JWTs are normally stateless. If immediate invalidation is required, the backend needs server-side revocation state.

Recommended:

```text
Logout
 ↓
Revoke current refresh-token/session family
 ↓
Persist revoked_at/reason
 ↓
Optionally/appropriately revoke current access session
 ↓
Old refresh token cannot issue new credentials
```

Prefer revocation state over deleting security history.

---

## 12. Refresh Token Rotation

Rotation is mandatory.

Example:

```text
R1
 ↓
/auth/refresh
 ↓
R1 revoked
 ↓
A2 issued
R2 issued
```

Persist:

```text
R1.replaced_by_token_id = R2
```

Old refresh tokens must not remain reusable.

---

## 13. Refresh Token Reuse Detection

If a previously revoked refresh token is presented again:

```text
R1 → R2
R1 used again
```

treat it as suspicious reuse.

Recommended:

```text
Detect reuse
 ↓
Invalidate affected token family/session
 ↓
Log security event
 ↓
Reject request
```

Do not issue a new token from a revoked refresh token.

---

## 14. Token Family

Group rotated refresh tokens by a common:

```text
token_family_id
```

Example:

```text
Family F1

R1 → R2 → R3 → R4
```

Each refresh token is individually tracked while sharing the same family.

This supports reuse detection and session revocation.

---

## 15. Access Token Validation

Every protected API request should follow:

```text
Request
 ↓
Extract Bearer token
 ↓
Verify signature
 ↓
Verify issuer
 ↓
Verify audience
 ↓
Verify expiration
 ↓
Verify token_type = access
 ↓
Extract user ID
 ↓
Validate user/account status as required
 ↓
Create authenticated request context
 ↓
Authorization
 ↓
Controller
```

Never accept a refresh token where an access token is required.

---

## 16. Refresh Endpoint

Adapt the existing API conventions, conceptually:

```http
POST /api/auth/refresh
```

Flow:

```text
Refresh JWT
 ↓
Verify signature
 ↓
Verify token type
 ↓
Find jti/session
 ↓
Check not revoked
 ↓
Check expiry
 ↓
Check user active
 ↓
Check token family
 ↓
Rotate old token
 ↓
Create new access token
 ↓
Create new refresh token
 ↓
Persist atomically
```

Use a database transaction or equivalent atomic state transition.

---

## 17. Login Flow

Conceptually:

```text
POST /auth/login
 ↓
Validate input
 ↓
Find user
 ↓
Verify password hash
 ↓
Check account status
 ↓
Determine role
 ↓
Create token family/session
 ↓
Create access token
 ↓
Create refresh token
 ↓
Persist token state
 ↓
Return safe response
```

Do not return passwords or sensitive authentication internals.

---

## 18. Logout Flow

Adapt or create:

```http
POST /auth/logout
```

Flow:

```text
Authenticated request
 ↓
Identify current session
 ↓
Revoke appropriate token family/session
 ↓
Persist revocation
 ↓
Return success
```

Optionally evaluate a future:

```http
POST /auth/logout-all
```

only if appropriate for the existing product.

---

## 19. Authenticated Context

Expose a centralized request context similar to:

```text
AuthenticatedUser
├── userId
├── role(s)
├── tokenId
├── tokenType
└── session/token-family information
```

Adapt names to the framework.

This context becomes the foundation for RBAC.

---

## 20. RBAC Integration

The system should integrate with:

```text
User
Role
Permission
UserRoleMapping
RolePermissionMapping
```

Conceptual flow:

```text
JWT Authentication
 ↓
Authenticated User
 ↓
Role
 ↓
Permission
 ↓
API Authorization
```

Prefer centralized:

```text
authenticate()
authorize(permission)
```

rather than scattered authorization logic.

---

## 21. Role Claim Security

The JWT may contain the user's role, but do not blindly trust a stale role claim if role changes must take effect immediately.

During architecture analysis determine whether the system needs:

- DB role validation
- role/security version
- session invalidation after role changes
- authorization cache
- another invalidation mechanism

Prevent stale tokens from retaining privileges longer than the security model permits.

---

## 22. SUPER_ADMIN / ALL_FUNCTION

Support the planned RBAC concept:

```text
SUPER_ADMIN
```

and/or:

```text
ALL_FUNCTION
```

Centralize the logic.

Prevent privilege escalation such as:

- admin granting itself SUPER_ADMIN
- user granting itself ALL_FUNCTION
- unauthorized role changes
- unauthorized permission changes
- creating a higher-privileged account

---

## 23. API Security Classification

Inventory every backend API and classify it:

```text
PUBLIC
AUTHENTICATED
PERMISSION_PROTECTED
```

Examples that may be public:

```text
registration
login
refresh
province lookup
district lookup
public product browsing
```

Do not assume the list. Inspect the actual project.

Backend must fail closed for protected APIs.

---

## 24. 401 vs 403

Use:

### 401

- missing credentials
- invalid credentials
- invalid token
- expired token with no usable refresh
- malformed authentication

### 403

- authenticated identity
- insufficient role/permission
- forbidden resource

Example:

```text
Not logged in → 401
Logged in without ORDER_DELETE → 403
```

---

## 25. Resource-Level Authorization

RBAC alone is insufficient.

Use:

```text
Role
+
Permission
+
Resource ownership/scope
```

Examples:

```text
Customer A → Customer A order = allowed
Customer A → Customer B order = denied
```

```text
Manufacturer A → Manufacturer A data = allowed
Manufacturer A → Manufacturer B private data = denied
```

```text
Marketing Partner A → Partner B private data = denied
```

Use actual domain relationships rather than inventing ownership logic.

---

## 26. Portal Isolation

Verify:

```text
CUSTOMER
→ customer APIs allowed by permissions

MANUFACTURER
→ manufacturer APIs allowed by permissions

MARKETING
→ marketing APIs allowed by permissions

ADMIN
→ admin APIs allowed by permissions

SUPER_ADMIN
→ globally authorized functions
```

Frontend hiding is not a security boundary.

Direct API calls must also be denied.

---

## 27. Frontend Authentication

Integrate the centralized auth system into:

```text
frontend/
manufacturer/
admin/
marketing/
```

Each portal needs:

```text
Login
Logout
Authenticated state
Access-token handling
Refresh handling
Route protection
401 handling
403 handling
Session-expiration handling
```

Do not create four different JWT implementations.

Where possible, create reusable authentication/API-client patterns consistent with each portal's existing framework.

---

## 28. Frontend Token Storage

Prefer:

```text
Access token
→ short-lived
→ in memory

Refresh token
→ Secure
→ HttpOnly
→ SameSite cookie
```

if deployment architecture supports this safely.

If cross-origin architecture prevents it, analyze:

- CORS
- SameSite
- Secure
- HTTPS
- CSRF
- domain/subdomain structure

and document the chosen alternative.

Do not automatically put refresh tokens in `localStorage`.

Never put JWT signing secrets in frontend code.

---

## 29. Frontend 401 Handling

Centralize API authentication handling.

Conceptually:

```text
API request
 ↓
401
 ↓
Single refresh operation
 ↓
Retry original request once
```

Requirements:

- no infinite loops
- no repeated retry of the same request
- avoid multiple simultaneous refresh calls
- use a single-flight/queue mechanism where appropriate
- if refresh fails, clear auth state and redirect to login
- do not treat 403 as 401

---

## 30. Database and Performance

Use:

- primary keys
- foreign keys
- unique constraints
- appropriate indexes
- timestamps
- transactions

Potential indexes:

```text
user_id
token_id/jti
token_family_id
expires_at
revoked_at
```

Only add indexes justified by actual query patterns.

Avoid:

- N+1 queries
- unnecessary DB lookups
- huge JWT payloads
- unnecessary infrastructure

If an existing cache is present, evaluate it. Do not add Redis simply for JWT.

---

## 31. Refresh Concurrency

Handle:

```text
Request A uses R1
Request B uses R1
```

Only one valid rotation should succeed.

Use appropriate:

- transaction
- row lock
- conditional update
- unique constraint
- atomic state transition

depending on the database/ORM.

---

## 32. JWT Algorithm

During architecture design, inspect the current stack and JWT library.

Choose a secure, supported signing algorithm.

Evaluate asymmetric:

```text
RS256
ES256
```

versus symmetric:

```text
HS256
```

If symmetric signing is selected, use strong separate secrets for access and refresh.

Document the decision.

Do not change algorithms casually after implementation.

---

## 33. Future Key Rotation

Design so key rotation can be added without rewriting authentication.

Evaluate:

```text
kid
current signing key
previous signing key
key rotation
```

Do not over-engineer this in the first iteration unless justified.

---

## 34. Do Not Put All Permissions in JWT

Avoid large payloads such as:

```json
{
  "permissions": ["hundreds-of-permissions"]
}
```

Prefer:

```text
JWT
 ↓
user/role/token metadata
 ↓
authorization service
 ↓
permission lookup/cache
```

This makes permission changes easier and keeps tokens smaller.

---

# ITERATIVE IMPLEMENTATION PLAN

## ITERATION 0 — Repository and Architecture Discovery

### Objective

Understand the existing system before making changes.

### Inspect

- all four portals
- backend
- database
- User model
- authentication
- login
- registration
- password hashing
- API routes
- middleware
- frontend API client
- route guards
- environment configuration
- tests
- migrations
- error handling

### Deliverables

Create:

```text
docs/auth/current-architecture-analysis.md
docs/auth/current-authentication-analysis.md
docs/auth/api-authentication-inventory.md
```

### Restrictions

Do NOT implement JWT.

Do NOT modify application behavior.

### Completion

Report findings and STOP.

---

## ITERATION 1 — JWT Architecture and Security Design

### Objective

Design the complete JWT system before implementation.

### Define

- access token
- refresh token
- jti/token_id
- token family
- refresh rotation
- reuse detection
- logout invalidation
- session persistence
- signing algorithm
- issuer
- audience
- secret management
- frontend storage
- RBAC integration
- resource authorization
- 401/403 behavior

### Deliverable

```text
docs/auth/jwt-architecture.md
```

Include sequence diagrams/Mermaid where useful.

Do not implement code yet.

STOP.

---

## ITERATION 2 — Environment and Configuration

### Objective

Centralize secure JWT configuration.

### Add

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TOKEN_EXPIRES_IN=5m
JWT_REFRESH_TOKEN_EXPIRES_IN=15m
JWT_ISSUER=
JWT_AUDIENCE=
```

Adapt to existing configuration conventions.

### Implement

- startup configuration validation
- `.env.example`
- secret validation
- no hard-coded secrets

### Test

- missing secret
- expiration loading
- separate secrets
- source-code scan for static secrets

STOP.

---

## ITERATION 3 — Authentication Database Model

### Objective

Persist token/session state.

### Implement

A suitable model such as:

```text
AuthSession
```

or:

```text
RefreshToken
```

with appropriate:

```text
id
user_id
token_id
token_type
token_family_id
issued_at
expires_at
revoked_at
replaced_by_token_id
last_used_at
created_at
updated_at
```

Optional security metadata only if justified.

Add:

- migration
- foreign keys
- unique constraints
- indexes

Test migration and rollback.

STOP.

---

## ITERATION 4 — JWT Token Service

### Objective

Centralize token generation/verification.

Implement:

```text
generateAccessToken()
generateRefreshToken()
verifyAccessToken()
verifyRefreshToken()
```

Every token gets a unique `jti`.

Validate:

```text
signature
issuer
audience
expiration
token type
jti
```

Tests:

- valid tokens
- wrong secret
- expired token
- invalid signature
- wrong type
- issuer/audience failure
- unique jti

STOP.

---

## ITERATION 5 — Login Authentication

### Objective

Integrate JWT with existing login.

Flow:

```text
credentials
 ↓
password verification
 ↓
account status
 ↓
role
 ↓
token family
 ↓
access token
 ↓
refresh token
 ↓
DB persistence
```

Preserve existing registration and unrelated behavior.

Test successful/failed login and database session state.

STOP.

---

## ITERATION 6 — Access Token Authentication Middleware

### Objective

Protect backend APIs.

Implement centralized authentication middleware/guard.

It must:

1. extract Bearer token
2. verify JWT
3. verify token type
4. validate expiration
5. validate issuer/audience
6. identify user
7. validate user/account state as required
8. attach authenticated context

Example:

```text
request.auth = {
    userId,
    role,
    tokenId,
    tokenType,
    sessionId
}
```

Test missing, malformed, expired, wrong-type, invalid, and valid tokens.

STOP.

---

## ITERATION 7 — Refresh Token Rotation

### Objective

Implement secure refresh.

Flow:

```text
R1
 ↓
verify
 ↓
lookup
 ↓
validate
 ↓
revoke R1
 ↓
create R2
 ↓
create A2
 ↓
persist atomically
```

Test normal rotation and concurrent refresh.

STOP.

---

## ITERATION 8 — Logout and Token Invalidation

### Objective

Implement secure logout.

Revoke the appropriate session/token family.

Do not unnecessarily delete audit history.

Test:

```text
login
 ↓
authenticated API
 ↓
logout
 ↓
old refresh token rejected
```

Test old access-token behavior according to the documented revocation strategy.

STOP.

---

## ITERATION 9 — Refresh Token Reuse Detection

### Objective

Detect reuse of revoked refresh tokens.

Test:

```text
R1 → R2
R1 reused
```

Expected:

```text
reuse detected
 ↓
affected family invalidated
 ↓
security event logged
 ↓
request rejected
```

Also test concurrency.

STOP.

---

## ITERATION 10 — RBAC Authentication Integration

### Objective

Connect authenticated identity to:

```text
User
Role
Permission
UserRoleMapping
RolePermissionMapping
```

Expose centralized authenticated context and integrate:

```text
authenticate()
authorize(permission)
```

Do not scatter authorization logic.

STOP.

---

## ITERATION 11 — Permission-Based API Authorization

### Objective

Protect APIs according to permissions.

Classify:

```text
PUBLIC
AUTHENTICATED
PERMISSION_PROTECTED
```

Implement centralized authorization middleware/guard.

Use project-specific permissions.

Return correct:

```text
401
403
```

STOP.

---

## ITERATION 12 — Portal-Specific Authorization

### Objective

Protect all four portals.

Test:

```text
Customer → Admin API = denied
Manufacturer → Marketing private API = denied
Marketing → Customer private API = denied
```

Also verify permitted flows.

Test direct backend requests, not only frontend behavior.

STOP.

---

## ITERATION 13 — Resource-Level Authorization

### Objective

Prevent cross-user/resource access.

Implement:

```text
role
+
permission
+
ownership/scope
```

Test customer, manufacturer, marketing-partner, and other relevant resource boundaries.

STOP.

---

## ITERATION 14 — Frontend Authentication Integration

### Objective

Integrate authentication into:

```text
frontend
manufacturer
admin
marketing
```

Implement:

- login
- logout
- auth state
- access-token handling
- refresh
- route guards
- API interceptor/client
- 401
- 403
- session expiration

Prefer HttpOnly Secure SameSite refresh cookies where architecture permits.

STOP.

---

## ITERATION 15 — Frontend Refresh Concurrency

### Objective

Prevent refresh storms.

Example:

```text
10 simultaneous requests
 ↓
401 responses
 ↓
ONE refresh request
 ↓
others wait
 ↓
retry once
```

No infinite loops.

STOP.

---

## ITERATION 16 — Security Hardening

Perform a dedicated review for:

- hard-coded secrets
- token leakage
- refresh-token leakage
- localStorage risks
- XSS
- CSRF
- CORS
- weak secrets
- weak algorithms
- algorithm confusion
- issuer/audience validation
- token type confusion
- privilege escalation
- mass assignment
- IDOR
- broken access control
- refresh-token reuse
- race conditions
- excessive payload
- sensitive logging

Fix verified issues and test them.

STOP.

---

## ITERATION 17 — Performance Optimization

Measure and optimize:

- JWT verification
- token DB lookup
- user lookup
- role lookup
- permission lookup
- refresh frequency
- query count
- index usage

Use caching only when justified.

Avoid unnecessary infrastructure.

STOP.

---

## ITERATION 18 — Full Authentication Regression Testing

Test all portals:

```text
Customer
Manufacturer
Marketing
Admin
```

Test:

### Login

```text
valid
invalid
inactive account
```

### Access token

```text
valid
expired
invalid
tampered
wrong type
```

### Refresh token

```text
valid
expired
revoked
rotated
reused
concurrent
```

### Logout

```text
logout
old refresh token
old access token according to revocation policy
```

### RBAC

```text
valid role
missing permission
SUPER_ADMIN
ALL_FUNCTION
```

### Resource authorization

```text
owner
non-owner
cross-customer
cross-manufacturer
cross-marketing-partner
```

### Frontend

```text
login
refresh
logout
401
403
session expiry
concurrent requests
```

Then STOP.

---

# Mandatory Iteration Report

After EVERY iteration, report:

```text
==================================================
ITERATION REPORT
==================================================

Iteration:
Status:

Objective:

Files inspected:
- ...

Files created:
- ...

Files modified:
- ...

Database changes:
- ...

API changes:
- ...

Frontend changes:
- ...

Security changes:
- ...

Tests executed:
- ...

Test results:
- ...

Existing functionality verified:
- ...

Security risks discovered:
- ...

Performance impact:
- ...

Backward compatibility:
- ...

Rollback plan:
- ...

Known limitations:
- ...

Next iteration:
- ...

==================================================
STOP AND WAIT FOR APPROVAL
==================================================
```

---

# Code Quality Requirements

The implementation must:

- follow existing project conventions
- follow existing architecture
- avoid unnecessary rewrites
- centralize authentication
- centralize authorization
- use environment configuration
- use validation
- use existing error handling
- use transactions where required
- use secure defaults
- avoid magic strings/numbers
- avoid duplicate JWT logic
- use appropriate typing where the framework supports it
- maintain backward compatibility

---

# Forbidden Practices

Never:

```text
hard-code JWT secrets
hard-code token expiration
store JWT signing secrets in frontend
log access tokens
log refresh tokens
put passwords in JWT
put password hashes in JWT
trust frontend authorization
use refresh token as access token
accept expired tokens
reuse rotated refresh tokens
silently accept revoked tokens
skip issuer/audience validation without justification
create four independent auth systems
duplicate JWT generation
bypass RBAC for convenience
allow privilege escalation
```

---

# Database Migration Safety

All schema changes must use the existing migration mechanism.

Never destroy existing user data.

Migrations must be reviewable and rollback-aware.

---

# API Contract Safety

Before changing an existing API:

1. inspect current request contract
2. inspect current response contract
3. inspect frontend consumers
4. identify compatibility impact
5. preserve existing contracts where practical
6. use versioning/compatibility handling if necessary

Do not break all four portals simply to simplify JWT.

---

# Security Principle

The backend is the authoritative security boundary.

Frontend:

```text
UX
+
route protection
```

Backend:

```text
authentication
+
authorization
+
permission
+
resource ownership
```

Hidden buttons and frontend guards are not security controls.

---

# Recommended Target Architecture

```text
                    ┌──────────────────────┐
                    │      User Table      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Authentication       │
                    │ Service              │
                    └──────────┬───────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        Access Token                    Refresh Token
          5 minutes                       15 minutes
                │                             │
                ▼                             ▼
        API Authentication          Refresh Rotation
                │                             │
                └──────────────┬──────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ Auth Session / Token │
                    │ Database             │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Authenticated User   │
                    │ + Role               │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Authorization        │
                    │ Service              │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Permission           │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Resource Ownership   │
                    │ / Scope Check        │
                    └──────────┬───────────┘
                               │
                               ▼
                           API Access
```

---

# Additional Security Suggestions to Evaluate

These are recommendations, not automatic requirements:

## 1. Logout All Devices

```http
POST /auth/logout-all
```

Invalidate all active session families for the user.

## 2. Session Management

Potentially allow users/admins to view and revoke active sessions.

## 3. Role Change Invalidation

When a user's role/permissions change, consider invalidating active sessions so stale tokens cannot retain old privileges.

## 4. Permission Versioning

Consider a security/permission version for efficient invalidation of stale authorization state.

## 5. Key Rotation

Prepare for `kid` and signing-key rotation if the deployment architecture requires it.

---

# Definition of Done

The system is complete only when:

```text
[ ] Existing architecture analyzed
[ ] Existing authentication analyzed
[ ] Environment configuration implemented
[ ] No hard-coded secrets
[ ] Access JWT implemented
[ ] Refresh JWT implemented
[ ] Unique jti/token_id implemented
[ ] Token/session database tracking implemented
[ ] Refresh rotation implemented
[ ] Refresh reuse detection implemented
[ ] Logout invalidation implemented
[ ] Access authentication middleware implemented
[ ] 401/403 implemented
[ ] RBAC integration implemented
[ ] Permission authorization implemented
[ ] Resource authorization implemented
[ ] Customer APIs protected
[ ] Manufacturer APIs protected
[ ] Marketing APIs protected
[ ] Admin APIs protected
[ ] SUPER_ADMIN/ALL_FUNCTION protected
[ ] Frontend login integrated
[ ] Frontend logout integrated
[ ] Frontend refresh integrated
[ ] Frontend 401 handling implemented
[ ] Frontend 403 handling implemented
[ ] Refresh concurrency handled
[ ] CORS/CSRF reviewed
[ ] XSS/token storage reviewed
[ ] Security logging reviewed
[ ] Database indexes reviewed
[ ] Race conditions tested
[ ] Unit tests completed
[ ] Integration tests completed
[ ] Authentication regression completed
[ ] Four portals regression-tested
[ ] Existing business functionality verified
[ ] Documentation completed
```

---

# Final Operating Instructions

You MUST follow these rules throughout the project:

1. Do not code before inspecting the existing architecture.
2. Implement exactly one iteration at a time.
3. Test every iteration.
4. Review security, correctness, performance, maintainability, and compatibility after every iteration.
5. Report the iteration.
6. STOP.
7. Wait for explicit approval.
8. Never assume approval.
9. Never skip an iteration because it appears simple.
10. Never rewrite working architecture merely to make JWT easier.
11. Never hard-code secrets.
12. Never expose secrets or tokens in logs.
13. Backend authorization is authoritative.
14. JWT authentication must integrate with the existing RBAC architecture.
15. Do not move to the next iteration until the user explicitly approves the current iteration.

---

# First Action

The first and only action after receiving this prompt is:

```text
ITERATION 0 — REPOSITORY AND ARCHITECTURE DISCOVERY
```

Inspect the repository thoroughly.

Do not modify application code.

Do not create JWT migrations.

Do not implement JWT.

Do not install unnecessary dependencies.

Produce the architecture-analysis documents and iteration report.

Then:

```text
STOP AND WAIT FOR USER APPROVAL.
```

Only after explicit approval may Iteration 1 begin.
