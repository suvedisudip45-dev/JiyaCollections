# Unified Authentication System for Four Portals — Architecture Analysis & Implementation Prompt

## ROLE

Act as a **15+ years experienced Software Architect, System Designer, Backend Engineer, Security Engineer, Database Architect, and Project Manager**.

You have deep production expertise in Node.js/Express or the project's existing backend framework, React, REST APIs, MVC architecture, database design, authentication, authorization, RBAC, OTP, sessions/tokens, secure cookies, JWT, CSRF, CORS, API security, migrations, testing, npm, and large-scale refactoring without breaking existing systems.

Work like a senior architect responsible for a production system.

**Do not rush into coding. First understand the entire existing project, then design, then implement in small, verifiable phases.**

---

## 1. PROJECT CONTEXT

The current project has one backend/server and four portals:

```text
clothing-store-ecommerce/
├── frontend/       # Customer portal
├── backend/        # Shared server/backend
├── manufacturer/   # Manufacturer portal
├── admin/          # Admin portal
└── marketing/      # Marketing Partner portal
```

Currently, each portal has a different login flow even though the backend/server is shared.

The target is:

```text
                    ┌──────────────────────┐
                    │    SINGLE BACKEND    │
                    │  UNIFIED AUTH LAYER  │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
      Customer            Manufacturer            Admin
      Portal                 Portal               Portal
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                       Marketing Partner
                            Portal
```

All four portals should use **one unified login/authentication process**, while **signup/registration remains portal-specific**.

The database should be treated as a **fresh start**. Assume there are no important production records that must be migrated.

However:

> Existing architecture, business logic, APIs, working features, and portal behavior must not be unnecessarily broken, rewritten, or redesigned.

---

# 2. PRIMARY OBJECTIVE

Design and implement a centralized authentication system for:

1. Customer
2. Manufacturer
3. Admin
4. Marketing Partner

The unified authentication system should determine:

- who the user is
- how they authenticate
- their role
- their portal access
- their permissions
- whether the account is active
- whether verification is required
- whether OTP is required
- whether password authentication is allowed
- which portal they may access

Authentication and authorization must be centralized at the backend level.

---

# 3. IMPORTANT DATABASE REQUIREMENT

I am considering introducing a dedicated authentication/credential structure that stores credentials independently from portal-specific business data.

Conceptually:

```text
Account / Identity
       │
       ├── Credential
       │     ├── email
       │     ├── mobile
       │     ├── password hash
       │     ├── OTP information
       │     ├── OTP expiry
       │     ├── passwordChangedAt
       │     ├── lastLoginAt
       │     └── security metadata
       │
       └── Portal-specific profile
             ├── Customer
             ├── Manufacturer
             ├── Admin
             └── Marketing Partner
```

**Do not blindly implement this exact model.**

First inspect the repository and database. Compare possible designs such as:

```text
Design A:
Each portal stores its own credentials.

Design B:
Account + Credential + Role + Portal Profile.

Design C:
Identity + Credential + AccountRole + PortalMembership + Profile.
```

Evaluate:

- normalization
- security
- uniqueness
- multiple roles
- multiple portals
- OTP
- password reset
- audit logging
- session management
- future scalability
- simplicity
- compatibility with the current MVC architecture

Then choose the best design based on actual repository evidence.

---

# 4. ADMIN MOBILE NUMBER

Admin currently has no mobile number.

Because this is a fresh database, the admin seed must use:

```text
9846008536
```

Do not hard-code this number throughout application logic.

It must exist only as appropriate seed/configuration data.

The seed must be idempotent: running it repeatedly must not create duplicate admin accounts.

If an initial admin password is required, do not commit a real production password into source code. Use an appropriate secure bootstrap mechanism.

---

# 5. OTP STATUS

OTP is **not currently implemented**.

OTP will be introduced soon.

Therefore:

- Do not create a fake production OTP system.
- Analyze where OTP belongs architecturally.
- Make the authentication design OTP-ready.
- Avoid coupling the whole authentication system to an unfinished provider.
- If a provider is not yet available, create a clean provider abstraction and document the remaining integration.
- Never store production OTPs in plaintext if a safer design is possible.

The future OTP design should support:

```text
purpose
channel
destination
expiry
attempt limit
resend cooldown
verification
invalidation
rate limiting
auditability
```

Potential purposes:

```text
LOGIN
SIGNUP
PASSWORD_RESET
CHANGE_EMAIL
CHANGE_MOBILE
```

---

# 6. NON-NEGOTIABLE RULE: ANALYZE BEFORE CODING

**Do not modify code immediately.**

First inspect the entire repository:

```text
clothing-store-ecommerce/
├── frontend/
├── backend/
├── manufacturer/
├── admin/
└── marketing/
```

Also inspect any additional directories that exist.

---

# 7. PHASE 0 — COMPLETE SYSTEM DISCOVERY

Inspect the backend:

- package.json
- entry point
- server/app bootstrap
- routes
- controllers
- services
- models
- repositories
- middleware
- validators
- utilities
- configuration
- environment handling
- database connection
- migrations
- seeds
- schemas
- authentication
- authorization
- roles
- error handling
- logging
- CORS
- cookies
- sessions
- JWT/token handling
- password hashing
- current login endpoints
- current signup endpoints
- OTP placeholders

Inspect all portals:

```text
frontend/
manufacturer/
admin/
marketing/
```

Analyze:

- package.json
- routing
- login pages
- signup pages
- API clients
- auth context/provider
- token handling
- localStorage/sessionStorage
- cookies
- protected routes
- role checks
- logout
- session restoration
- API interceptors
- errors
- environment configuration
- reusable UI conventions

Inspect database:

- schema
- models
- relationships
- indexes
- unique constraints
- migrations
- seeds
- foreign keys
- timestamps
- delete behavior

Understand existing business flows:

- customer registration/login
- manufacturer registration/login
- admin login
- marketing partner registration/login
- customer ordering
- manufacturer operations
- admin operations
- marketing card/campaign operations
- permissions
- portal isolation

Do not assume the existing implementation is correct. Document what actually exists.

---

# 8. REQUIRED ARCHITECTURE REPORT BEFORE CODING

Create:

```text
docs/authentication-architecture-analysis.md
```

or the equivalent existing documentation location.

The report must contain:

## A. Current architecture

Show the real flow, for example:

```text
Frontend
  ↓
API
  ↓
Routes
  ↓
Controllers
  ↓
Services
  ↓
Models/Repositories
  ↓
Database
```

Adapt this to the actual codebase.

## B. Current login flow

Document separately:

```text
Customer Login
Manufacturer Login
Admin Login
Marketing Partner Login
```

For each:

```text
UI
→ API
→ Route
→ Middleware
→ Controller
→ Service
→ Database
→ Token/Session
→ Response
→ Frontend auth state
→ Protected routes
```

## C. Current problems

Only identify evidence-based issues such as:

- duplicate authentication logic
- duplicate password logic
- duplicate token logic
- inconsistent error handling
- duplicated credential storage
- insecure storage
- missing constraints
- missing indexes
- weak validation
- account enumeration
- inconsistent logout
- inconsistent session expiry
- authorization gaps
- architecture coupling

Do not invent problems.

## D. Current database relationships

Create an actual ER-style relationship diagram.

## E. Recommended architecture

Explain the proposed design and why it fits the existing system.

---

# 9. AUTHENTICATION VS AUTHORIZATION

Keep these separate.

### Authentication

> Who are you?

### Authorization

> What are you allowed to access?

The unified login authenticates the identity.

Authorization determines:

```text
role
permissions
portal
resource ownership
```

Possible roles may include:

```text
CUSTOMER
MANUFACTURER
ADMIN
MARKETING_PARTNER
```

But inspect the actual codebase and use its existing naming conventions where appropriate.

---

# 10. PORTAL ACCESS

A successful login must not automatically grant access to every portal.

Conceptually:

```text
Customer
→ Customer portal

Manufacturer
→ Manufacturer portal

Admin
→ Admin portal

Marketing Partner
→ Marketing portal
```

If the current business model allows one identity to have multiple roles/portal memberships, design for that rather than duplicating accounts.

Do not assume one identity = one portal unless the repository proves that rule.

---

# 11. UNIFIED LOGIN

The final system should have one backend authentication process.

A conceptual example is:

```http
POST /auth/login
```

But:

> Do not assume this exact endpoint.

Inspect the existing API and follow its conventions.

The login process should:

1. validate input
2. normalize identifier
3. find account
4. verify credentials
5. check account state
6. determine authorized portal/role
7. create secure session/token
8. return only safe user information
9. audit the login
10. enforce rate limiting

---

# 12. NEVER TRUST FRONTEND AUTHORIZATION

Frontend checks are for UX only.

This is not security:

```javascript
if (user.role === "ADMIN") {
  showAdminPage();
}
```

Backend must enforce:

```text
authentication
authorization
role
permission
portal access
resource ownership
```

A user must not gain access by changing:

```text
localStorage
sessionStorage
URL
query parameters
request body
frontend state
React state
browser devtools
```

Do not trust role/portal values supplied by the client.

---

# 13. AUTHENTICATION DATA MODEL

Evaluate whether the system needs entities such as:

```text
Account
Credential
Role
Permission
AccountRole
Portal
PortalMembership
Session
OTPChallenge
PasswordHistory
AuditLog
```

Do not create all of these automatically.

Create only what is justified by the architecture.

Avoid duplicate:

```text
email
mobile
password
OTP
```

records across four portal tables if a normalized identity model is appropriate.

---

# 14. PASSWORD SECURITY

Never store:

```text
plain-text password
plain-text password history
```

Use a modern password hashing algorithm supported by the project's stack.

Evaluate:

- Argon2id
- bcrypt

Do not use:

```text
MD5
SHA1
plain SHA256
reversible encryption
```

for password storage.

Support appropriate metadata where justified:

```text
passwordChangedAt
lastLoginAt
lastFailedLoginAt
failedLoginAttempts
accountLockedUntil
createdAt
updatedAt
```

Do not add fields merely because they sound useful.

---

# 15. EMAIL AND MOBILE

Analyze whether email and mobile should be globally unique.

Consider:

- case-insensitive email normalization
- normalized mobile format
- country codes
- duplicate account prevention
- verification state
- soft-deleted accounts
- nullable mobile for account types that do not require it
- admin-specific authentication requirements

Do not add uniqueness constraints without understanding business rules.

---

# 16. OTP ARCHITECTURE

Design a future OTP challenge mechanism.

A conceptual model could contain:

```text
id
accountId
purpose
channel
destination
codeHash
expiresAt
attemptCount
maxAttempts
lastSentAt
verifiedAt
createdAt
```

Adapt to the project's ORM and database.

Security requirements:

- short expiry
- limited attempts
- resend cooldown
- rate limiting
- single-use verification
- invalidation after success
- invalidation after excessive failures
- bind OTP to account and purpose
- never log OTP
- never return OTP from production APIs
- prevent brute force
- prevent resend abuse
- prevent account enumeration

If an SMS/email provider is added later, isolate it behind:

```text
OTPService
   ↓
Provider Interface
   ↓
SMS Provider / Email Provider
```

---

# 17. SESSION / TOKEN DESIGN

Inspect the current implementation before choosing the final strategy.

Evaluate:

- server sessions
- JWT
- access + refresh tokens
- HTTP-only cookies
- SameSite
- Secure
- CSRF
- token rotation
- session revocation
- expiration
- logout
- password-change invalidation

Do not introduce JWT simply because it is popular.

Choose the approach that best fits the current application architecture.

If cookies are used, review:

```text
HttpOnly
Secure
SameSite
CSRF
domain/path
```

If tokens are used, review:

```text
expiration
rotation
revocation
storage
XSS exposure
```

---

# 18. "PROXY-FREE" REQUIREMENT

Interpret "proxyfree" as a request for a clean, secure authentication boundary.

Do not blindly remove legitimate reverse proxies or gateways.

Analyze the actual network architecture.

Ensure:

- no unnecessary authentication proxy layer
- no insecure frontend proxy assumptions
- no credentials through untrusted intermediaries
- correct CORS
- correct cookie behavior
- HTTPS in production
- no exposed internal services
- no secret leakage through proxy headers

If a reverse proxy is legitimately required, keep it and document its role.

---

# 19. API DESIGN

Possible authentication endpoints include:

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/me
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/verify-otp
POST   /auth/resend-otp
```

These are examples only.

Use the project's actual API naming/versioning conventions.

---

# 20. SIGNUP REMAINS PORTAL-SPECIFIC

Do not force all four portals into one signup page.

Conceptually:

```text
Customer Signup
Manufacturer Signup
Marketing Partner Signup
Admin Controlled Creation / Seed
```

Each signup can create/connect to the centralized identity model:

```text
Portal-specific Signup
        ↓
Validate business profile
        ↓
Create Account
        ↓
Create Credential
        ↓
Assign Role / Portal Membership
        ↓
Verification
```

Do not duplicate authentication credentials in every portal profile.

Do not change signup behavior unnecessarily.

---

# 21. ADMIN SEED

Create a proper idempotent admin seed.

Mobile:

```text
9846008536
```

Do not:

- hard-code it in controllers
- hard-code it in frontend
- expose it in public configuration
- create duplicate admins on every startup

Use the project's existing seed architecture.

---

# 22. SECURITY REQUIREMENTS

Review and implement as appropriate:

### Authentication

- password hashing
- account verification
- secure session/token handling
- logout
- expiration
- refresh/revocation
- password reset

### Authorization

- RBAC
- permissions
- portal access
- resource ownership

### Abuse prevention

- rate limiting
- login attempt protection
- OTP attempt limits
- resend limits
- reset limits

### Data protection

- no password logs
- no OTP logs
- no token logs
- no frontend secrets
- no Git secrets
- minimize PII

### Web security

Review:

- CORS
- CSRF
- XSS
- injection
- session fixation
- account enumeration
- open redirects
- IDOR
- broken access control
- credential stuffing
- brute force
- replay attacks

---

# 23. ERROR SECURITY

Never expose:

```text
SQL errors
ORM errors
stack traces
filesystem paths
internal service names
database details
OTP details
```

Use safe external messages and secure internal logging.

Avoid account enumeration.

---

# 24. AUDIT LOGGING

Evaluate authentication audit events such as:

```text
LOGIN_SUCCESS
LOGIN_FAILURE
LOGOUT
PASSWORD_CHANGED
PASSWORD_RESET_REQUESTED
PASSWORD_RESET_COMPLETED
OTP_REQUESTED
OTP_VERIFIED
OTP_FAILED
ACCOUNT_LOCKED
ACCOUNT_UNLOCKED
SESSION_REVOKED
```

Never log secrets.

---

# 25. DATABASE RULES

Because this is a fresh start, authentication schema may be redesigned.

However:

> Do not redesign unrelated business tables without a legitimate reason.

Use where appropriate:

- foreign keys
- unique constraints
- indexes
- transactions
- timestamps
- normalized relationships

Authentication changes must not unnecessarily alter:

- orders
- products
- inventory
- manufacturers
- customers
- marketing cards
- campaigns
- benefits
- other business structures

---

# 26. TRANSACTION SAFETY

Where appropriate, account creation should be transactional:

```text
Create Account
+
Create Credential
+
Create Role/Portal Mapping
+
Create Portal Profile
```

If a critical step fails:

```text
ROLLBACK
```

Apply similar transaction thinking to password resets and security-sensitive operations.

---

# 27. IMPLEMENTATION PLAN

Break the migration into these small phases.

## Phase 1 — Discovery Only

Inspect the entire repository.

Deliver:

```text
docs/authentication-architecture-analysis.md
docs/authentication-current-flow.md
```

**No application logic changes.**

---

## Phase 2 — Target Architecture

Create:

```text
docs/unified-authentication-design.md
docs/authentication-database-design.md
docs/authentication-api-contract.md
```

Document:

- architecture
- ER diagram
- login sequence
- authorization
- signup integration
- OTP extension
- session/token strategy
- security
- errors
- portal isolation

Then stop for review.

---

## Phase 3 — Database Foundation

Tasks:

- authentication tables
- relationships
- constraints
- indexes
- migrations
- admin seed
- development seed if appropriate

Admin mobile:

```text
9846008536
```

Verify:

- uniqueness
- foreign keys
- seed idempotency
- migration rollback

Do not modify unrelated business tables without necessity.

---

## Phase 4 — Authentication Domain

Build/refactor a clean authentication layer appropriate to the project's MVC architecture.

Potential structure:

```text
Routes
  ↓
Controller
  ↓
Auth Service
  ↓
Repository / Model
  ↓
Database
```

Potential services:

```text
AuthService
CredentialService
SessionService
PasswordService
OTPService
AuthorizationService
```

Only create what the actual architecture needs.

---

## Phase 5 — Unified Login API

Implement central login:

- input validation
- identifier normalization
- credential verification
- account state checks
- portal/role resolution
- secure session/token creation
- safe response
- audit event
- rate limiting
- secure errors

Test independently before portal migration.

---

## Phase 6 — Authentication Middleware

Centralize request authentication.

Conceptually:

```text
authenticate request
↓
resolve identity
↓
attach safe auth context
↓
authorization
↓
controller
```

Do not place excessive business logic in middleware.

---

## Phase 7 — Authorization

Implement consistent authorization mechanisms appropriate to the current codebase:

```text
requireAuth()
requireRole()
requirePermission()
requirePortalAccess()
```

Backend remains authoritative.

---

## Phase 8 — Customer Portal Migration

Migrate only login/auth handling.

Keep signup separate.

Verify:

- login
- logout
- protected routes
- session restoration
- authorization
- customer features
- ordering flow

---

## Phase 9 — Manufacturer Portal Migration

Verify:

- login
- logout
- protected routes
- manufacturer-only access
- existing manufacturer workflows
- order fulfillment
- marketing-card workflow
- authorization

Do not break existing manufacturer functionality.

---

## Phase 10 — Admin Portal Migration

Verify:

- seeded admin
- admin authentication
- admin authorization
- protected routes
- existing admin features
- role restrictions

Confirm admin mobile:

```text
9846008536
```

---

## Phase 11 — Marketing Partner Portal Migration

Verify:

- partner authentication
- portal protection
- partner isolation
- campaign/card access
- QR permissions
- existing marketing features

---

## Phase 12 — OTP Foundation

Build only the architecture currently justified:

- OTP challenge model if needed
- OTP service abstraction
- expiry
- attempt limits
- resend cooldown
- verification
- provider abstraction
- audit events

If provider credentials are unavailable:

**do not fake production delivery.**

---

## Phase 13 — Password Reset

If supported by the project requirements:

- short-lived reset challenge
- single use
- expiry
- rate limiting
- session invalidation
- account enumeration protection
- audit logging

Never store or send plaintext passwords.

---

## Phase 14 — Security Hardening

Perform a dedicated review for:

### Authentication

- brute force
- credential stuffing
- session fixation
- session hijacking
- token replay

### Authorization

- role manipulation
- portal manipulation
- IDOR
- URL manipulation
- request-body manipulation
- cross-portal access

### OTP

- brute force
- replay
- expiry
- resend abuse
- enumeration

### Browser

- XSS
- CSRF
- insecure storage
- cookie configuration
- CORS

### API

- missing authentication
- missing authorization
- excessive data exposure
- unsafe error responses

---

## Phase 15 — Testing

Create automated tests using the project's existing testing framework.

### Unit

Test:

- password hashing
- password verification
- identifier normalization
- OTP verification
- OTP expiry
- role checks
- permission checks
- session/token behavior

### Integration

Test:

```text
Customer login
Manufacturer login
Admin login
Marketing Partner login
```

### Security

Test:

```text
Customer → Admin API = denied
Customer → Manufacturer API = denied
Manufacturer A → Manufacturer B data = denied
Marketing A → Marketing B data = denied
Unauthenticated → protected API = denied
Wrong role → protected API = denied
```

### Regression

Run the existing test suite.

---

## Phase 16 — End-to-End Verification

For all four portals:

```text
Signup
↓
Account creation
↓
Login
↓
Session
↓
Protected page
↓
API request
↓
Authorization
↓
Logout
↓
Login again
```

Do not unnecessarily change signup.

---

# 28. CHECKPOINT REPORT AFTER EACH PHASE

After every major phase, report:

```text
Phase:
Objective:

Files inspected:
Files changed:
Files created:

Architecture decisions:
Database changes:
API changes:
Frontend changes:

Security controls:
Tests added:
Tests executed:
Build status:

Existing functionality verified:
Potential regressions:

Known limitations:
Next phase:
```

Do not silently continue past a critical security or data-integrity problem.

---

# 29. VALIDATION AFTER EVERY CHANGE

Use the actual scripts in package.json for:

```text
lint
typecheck
unit tests
integration tests
build
```

Do not invent commands.

If a script does not exist, state that.

After each major change:

1. inspect changed files
2. run relevant tests
3. run build
4. verify API behavior
5. verify affected portal behavior
6. verify unrelated portals still work

---

# 30. DEPENDENCY RULES

Before adding an npm package:

1. Check whether the functionality already exists.
2. Inspect current dependencies.
3. Check compatibility.
4. Prefer stable maintained packages.
5. Avoid dependencies for trivial functionality.
6. Explain why each new package is necessary.
7. Use available security auditing tools when appropriate.

Do not replace existing libraries without a clear reason.

---

# 31. ENVIRONMENT / SECRETS

Never commit:

```text
passwords
JWT secrets
session secrets
OTP provider keys
SMS credentials
email credentials
database passwords
production secrets
```

Use the existing secure configuration mechanism.

Never expose backend secrets through frontend environment variables.

---

# 32. DATABASE RESET

Because this is a fresh-start project, document the actual safe development reset procedure:

```text
reset database
↓
run migrations
↓
run seeds
↓
verify admin
↓
start backend
↓
start portals
```

Use actual project commands.

Never perform destructive production operations.

---

# 33. BACKWARD COMPATIBILITY

The migration must not unnecessarily break:

- customer ordering
- manufacturer fulfillment
- manufacturer card assignment/receipt
- admin management
- marketing partner features
- product management
- inventory
- customer profile
- marketing cards
- QR validation
- benefits
- reports

If an existing API must change:

1. document it
2. update consumers
3. test it
4. verify old consumers are not still dependent on removed behavior

---

# 34. DO NOT OVER-ENGINEER

Do not introduce:

- microservices
- Kafka
- Redis
- GraphQL
- complex IAM
- external identity providers
- new API gateways

unless repository evidence shows that they are actually needed.

A clean modular monolith is acceptable and often preferable for this architecture.

---

# 35. REQUIRED DESIGN COMPARISON

Before implementation, explicitly compare:

### Option A

```text
Customer
Manufacturer
Admin
MarketingPartner
```

Each has credentials.

### Option B

```text
Account
Credential
Role
PortalProfile
```

### Option C

```text
Identity
Credential
AccountRole
PortalMembership
Profile
```

For each, evaluate:

- normalization
- security
- uniqueness
- multiple roles
- multiple portals
- OTP
- password reset
- sessions
- audit logging
- future expansion
- implementation complexity
- current MVC compatibility

Then select the design based on evidence.

---

# 36. EXPECTED TARGET ARCHITECTURE

Conceptually:

```text
                    ┌────────────────────┐
                    │   Unified Auth API │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Account / Identity │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼────────────────┐
              │               │                │
         Credential         Session        Authorization
              │               │                │
              └───────────────┼────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   Customer              Manufacturer              Admin
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                       Marketing Partner
```

This is conceptual. Adapt it to the actual repository.

---

# 37. DEFINITION OF DONE

## Architecture

- [ ] Complete repository analyzed
- [ ] Current authentication documented
- [ ] Current authorization documented
- [ ] MVC flow documented
- [ ] Database relationships documented
- [ ] Target architecture documented

## Database

- [ ] Central authentication design implemented
- [ ] Credential structure implemented
- [ ] Constraints implemented
- [ ] Indexes implemented
- [ ] Migrations implemented
- [ ] Admin seed implemented
- [ ] Admin mobile = `9846008536`
- [ ] Seed is idempotent

## Authentication

- [ ] One unified login process
- [ ] Secure password hashing
- [ ] Secure session/token handling
- [ ] Logout
- [ ] Session expiration
- [ ] Password reset architecture
- [ ] OTP-ready architecture

## Authorization

- [ ] Customer isolation
- [ ] Manufacturer isolation
- [ ] Admin isolation
- [ ] Marketing Partner isolation
- [ ] Role/permission enforcement
- [ ] Backend authorization
- [ ] Resource ownership checks

## OTP

- [ ] OTP architecture documented
- [ ] OTP expiry supported
- [ ] Attempt limits designed
- [ ] Resend limits designed
- [ ] Provider abstraction designed
- [ ] OTP secrets never logged

## Frontend

- [ ] All four portals use unified authentication
- [ ] Portal-specific signup remains functional
- [ ] Protected routes work
- [ ] Logout works
- [ ] Session restoration works
- [ ] 401/403 handling works

## Security

- [ ] Passwords never stored plaintext
- [ ] Tokens/secrets never logged
- [ ] No backend secrets in frontend
- [ ] No unnecessary credential storage in browser
- [ ] CSRF/CORS reviewed
- [ ] XSS reviewed
- [ ] Rate limiting reviewed
- [ ] Brute-force protection reviewed
- [ ] Account enumeration reviewed
- [ ] IDOR reviewed
- [ ] Cross-portal access tested

## Regression

- [ ] Customer flow works
- [ ] Manufacturer flow works
- [ ] Admin flow works
- [ ] Marketing flow works
- [ ] Existing business features work
- [ ] Existing tests pass
- [ ] Production builds pass

---

# 38. HOW YOU MUST WORK

### Rule 1 — Analyze first

Never code before understanding the existing architecture.

### Rule 2 — Reuse before replacing

Reuse existing authentication, API, middleware, models, services, utilities, validation, and error handling where appropriate.

### Rule 3 — Small changes

Make changes in small, reviewable phases.

### Rule 4 — Security first

Authentication and authorization are security-critical infrastructure.

### Rule 5 — Backend is authoritative

Never rely on frontend authorization for security.

### Rule 6 — Do not invent APIs

Use existing APIs or explicitly create documented APIs.

### Rule 7 — Do not invent relationships

Derive relationships from the real codebase.

### Rule 8 — Preserve working features

Every migration step requires regression verification.

### Rule 9 — No silent architecture changes

Do not silently redesign unrelated systems.

### Rule 10 — Explain major decisions

For every major architecture decision provide:

```text
Decision
Reason
Alternatives considered
Risk
Impact
```

---

# 39. FIRST RESPONSE REQUIRED FROM THE AI AGENT

Before writing or changing code, your first response must contain:

## 1. Repository understanding

```text
Project structure:
Backend:
Frontend portals:
Database:
Current authentication:
Current authorization:
```

## 2. Current login architecture

Explain all four login flows.

## 3. Problems found

Only evidence-based problems.

## 4. Recommended authentication architecture

Explain whether a shared:

```text
Account
Credential
Role
Portal
Session
OTP
```

model is appropriate.

## 5. Database proposal

Provide the proposed ER relationship.

## 6. Security proposal

Explain:

- password storage
- session/token strategy
- OTP strategy
- authorization
- rate limiting
- audit logging

## 7. Migration plan

Show:

```text
Phase 1
Phase 2
Phase 3
...
```

## 8. Risk assessment

Categorize:

```text
High risk
Medium risk
Low risk
```

## 9. STOP

After presenting the architecture analysis and implementation plan:

**STOP and wait for approval before making major code changes.**

Do not assume approval.

---

# 40. FINAL COMMAND

Start by deeply analyzing the entire repository.

Do not modify code yet.

Treat the database as a fresh start, but preserve existing application architecture and working features.

The priorities are:

```text
1. Correct architecture
2. Secure authentication
3. Correct authorization
4. One unified login process
5. Separate portal-specific signup
6. OTP-ready architecture
7. Strong database design
8. Four-portal isolation
9. No unnecessary architectural disruption
10. Incremental implementation
11. Easy testing and rollback
12. Production-quality maintainability
```

**Do not code until the architecture analysis is complete and presented.**
