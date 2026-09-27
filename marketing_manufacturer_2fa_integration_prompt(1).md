# Marketing Partner + Manufacturer 2FA Integration Prompt

## Objective

Extend the existing **Admin 2FA implementation** so that **Marketing
Partner** and **Manufacturer** login also require 2FA, while the
**Customer portal remains completely excluded** from this change.

The implementation must be iterative, security-first, regression-safe,
and must not modify business-layer functionality.

------------------------------------------------------------------------

## 1. Non-Negotiable Rules

1.  **Inspect the repository before coding.**

    -   First map authentication, Admin 2FA, JWT/session handling,
        authorization guards, database/ORM, notification service,
        RabbitMQ, SMS, email, frontend routing, API interceptors, and
        tests.
    -   Do not modify implementation files during discovery.

2.  **Reuse the existing Admin 2FA implementation.**

    -   Generalize the existing OTP generation, challenge lifecycle,
        verification, notification integration, MFA token/session
        handling, guard, and UI where safe.
    -   Do not create independent Admin/Marketing/Manufacturer OTP
        systems unless the existing architecture makes separation
        necessary.

3.  **2FA policy:**

    -   ADMIN: required.
    -   MARKETING_PARTNER: required.
    -   MANUFACTURER: required.
    -   CUSTOMER: **not required and explicitly out of scope for the
        Customer frontend**.

4.  **Do not touch the business layer.**

    -   Do not modify product, order, inventory, customer, marketing,
        manufacturer, payment, or other business rules/services.
    -   Security must be implemented in authentication, identity,
        session, middleware, guards, controllers/routes, or notification
        layers.
    -   If a business route needs a guard, wire it at the security
        boundary without changing its business logic.

5.  Never issue privileged Admin/Marketing/Manufacturer access before
    OTP verification.

6.  Never trust a client-supplied role, accountId, profileId, phone,
    email, or portal as proof of authorization.

7.  Never hardcode secrets.

8.  Never log or return:

    -   passwords/password hashes
    -   OTP values
    -   OTP hashes
    -   JWTs/TFA tokens
    -   SMS credentials
    -   SMTP credentials
    -   RabbitMQ credentials
    -   encryption secrets

9.  Do not make unrelated refactors, dependency upgrades, formatting
    changes, or business changes.

10. After every implementation iteration:

    -   run relevant tests
    -   run lint/typecheck/build where applicable
    -   inspect the diff
    -   verify Admin, Marketing, Manufacturer, and Customer regression
        status
    -   do not proceed if a critical security/regression test fails.

------------------------------------------------------------------------

# 2. Target Architecture

The preferred architecture is:

``` text
                    REUSABLE 2FA CORE
                           |
          +----------------+----------------+
          |                |                |
        ADMIN          MARKETING       MANUFACTURER
          |             PARTNER              |
          +----------------+----------------+
                           |
                    Existing Notification
                           |
                    +------+------+
                    |             |
                   SMS           EMAIL


CUSTOMER
   |
   +--> existing authentication
   +--> NO new 2FA frontend
   +--> NO new MFA requirement
```

The existing Admin implementation should become a reusable, portal-aware
2FA mechanism.

Conceptually:

``` text
TwoFactorService
TwoFactorChallengeRepository
OtpService
TwoFactorVerificationService
TwoFactorToken/SessionService
TwoFactorGuard
NotificationDispatcher
```

with a trusted portal context:

``` text
ADMIN
MARKETING_PARTNER
MANUFACTURER
```

Customer must not enter this flow.

------------------------------------------------------------------------

# 3. Architecture Discovery --- Iteration 0

Before writing code, inspect:

``` text
authentication/login
Admin 2FA
Marketing authentication
Manufacturer authentication
Customer authentication
JWT/session
refresh tokens
authorization middleware/guards
shared APIs
database/ORM
2FA tables
notification service
RabbitMQ
SMS provider
email provider
frontend routing
frontend API client/interceptors
Admin OTP UI
tests
environment/configuration
```

Produce an architecture report containing:

``` text
1. Current authentication flow
2. Current Admin 2FA flow
3. Existing 2FA reusable components
4. Admin-specific assumptions that must be generalized
5. Marketing login integration point
6. Manufacturer login integration point
7. Customer exclusion points
8. Token/session architecture
9. Shared API classification
10. Notification architecture
11. Database/migration impact
12. Security risks
13. Test plan
14. Rollback plan
```

Create/update:

``` text
docs/2fa-portal-extension-plan.md
```

Do not modify business implementation during this phase.

------------------------------------------------------------------------

# 4. Required Authentication Behavior

## Admin

``` text
password valid
    ->
MFA challenge
    ->
SMS/email OTP
    ->
OTP verified
    ->
fully authenticated Admin
```

## Marketing Partner

``` text
password valid
    ->
MFA challenge
    ->
SMS/email OTP
    ->
OTP verified
    ->
fully authenticated Marketing Partner
```

## Manufacturer

``` text
password valid
    ->
MFA challenge
    ->
SMS/email OTP
    ->
OTP verified
    ->
fully authenticated Manufacturer
```

## Customer

``` text
existing customer login
    ->
existing authenticated behavior
```

Do not add Customer OTP UI, Customer OTP APIs, or Customer MFA
enforcement.

------------------------------------------------------------------------

# 5. Login Flow

Use the existing login endpoint and conventions, for example:

``` http
POST /api/auth/login
```

Existing request may contain:

``` json
{
  "email": "user@example.com",
  "targetPortal": "ADMIN",
  "encryptedPassword": "..."
}
```

Inspect the actual repository before changing the contract.

The backend must independently verify the account's authorized
portal/role.

The client must not be able to become Admin/Marketing/Manufacturer
simply by changing:

``` text
targetPortal
role
accountId
```

------------------------------------------------------------------------

# 6. Password-Success Behavior for MFA Portals

For Admin, Marketing Partner, and Manufacturer:

``` text
password correct
```

must result in:

``` text
PASSWORD_VERIFIED
+
MFA_PENDING
```

not:

``` text
FULLY_AUTHENTICATED
```

Example response:

``` json
{
  "success": true,
  "message": "Additional verification required",
  "requiresTwoFactor": true,
  "challengeId": "...",
  "portal": "MARKETING_PARTNER",
  "availableMethods": ["SMS", "EMAIL"],
  "maskedPhone": "******0536",
  "maskedEmail": "ma***@example.com"
}
```

Manufacturer:

``` json
{
  "success": true,
  "message": "Additional verification required",
  "requiresTwoFactor": true,
  "challengeId": "...",
  "portal": "MANUFACTURER",
  "availableMethods": ["SMS", "EMAIL"],
  "maskedPhone": "******0536",
  "maskedEmail": "ma***@example.com"
}
```

Admin must continue to follow the same architecture.

Do not return before OTP:

``` text
privileged access token
refresh token that can bypass MFA
password
password hash
OTP
full contact details
unrelated profile records
```

------------------------------------------------------------------------

# 7. Customer Login

Customer login must remain unchanged.

Explicitly verify:

``` text
Customer login -> works
Customer frontend -> no OTP screen
Customer frontend -> no 2FA API call
Customer API -> no new MFA header requirement
Customer shared endpoints -> not accidentally blocked
```

Do not add Customer to the new MFA policy.

------------------------------------------------------------------------

# 8. Generalize Existing Admin 2FA

First identify whether the current Admin implementation has assumptions
such as:

``` text
role === ADMIN
portal === ADMIN
adminAccountId
admin-specific notification event
admin-specific token type
admin-specific route
admin-only UI
```

Replace only the assumptions that prevent safe reuse.

Prefer:

``` text
portal-aware challenge
portal-aware token/session
portal-aware MFA guard
```

rather than duplicate services.

Example:

``` text
createChallenge({
    accountId,
    portal,
    purpose
})

sendOtp({
    challengeId,
    method
})

verifyOtp({
    challengeId,
    otp
})
```

The exact names must follow the repository conventions.

------------------------------------------------------------------------

# 9. Central MFA Policy

Create a centralized security policy.

Conceptually:

``` text
ADMIN:
  requireMfa = true

MARKETING_PARTNER:
  requireMfa = true

MANUFACTURER:
  requireMfa = true

CUSTOMER:
  requireMfa = false
```

Do not scatter:

``` text
if role === ADMIN
```

throughout business code.

The security layer should resolve the policy.

------------------------------------------------------------------------

# 10. OTP Challenge Model

Prefer extending the existing 2FA challenge model instead of creating
separate tables for every portal.

Conceptually:

``` text
two_factor_challenges
---------------------
id
account_id
profile_id
portal
purpose
method
otp_hash
expires_at
attempt_count
max_attempts
resend_count
last_sent_at
status
notification_id
created_at
updated_at
verified_at
consumed_at
request_ip
user_agent_hash
```

Possible statuses:

``` text
PENDING
VERIFIED
EXPIRED
LOCKED
CANCELLED
```

Use actual project naming.

Required indexes should support:

``` text
account_id
portal
status
expires_at
created_at
```

Do not create destructive migrations.

Existing Admin challenge records must remain usable.

------------------------------------------------------------------------

# 11. Challenge Binding

A challenge must be bound to:

``` text
account
portal
purpose
```

Examples:

``` text
ADMIN
MARKETING_PARTNER
MANUFACTURER
```

A Marketing challenge must never authenticate Manufacturer.

A Manufacturer challenge must never authenticate Admin.

An Admin challenge must never authenticate Marketing.

Do not trust client-supplied identity fields during verification.

------------------------------------------------------------------------

# 12. OTP Generation

Reuse the existing secure Admin OTP generator.

Requirements:

-   cryptographically secure random generation
-   configurable length
-   short expiration
-   no deterministic generation
-   no Math.random()
-   no timestamp-derived OTP
-   no account/email/phone-derived OTP

Existing recommended configuration:

``` env
OTP_LENGTH=6
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=5
```

Reuse existing names if already present.

------------------------------------------------------------------------

# 13. OTP Storage

Never store plaintext OTP.

If the current implementation uses a keyed HMAC pattern such as:

``` text
HMAC-SHA-256(
    OTP_SERVER_SECRET,
    challengeId + ":" + otp
)
```

retain it if correctly implemented.

Use:

-   server-side secret
-   protected OTP representation
-   constant-time comparison
-   expiration
-   attempt limits
-   single-use consumption
-   rate limiting

Do not expose the OTP hash.

------------------------------------------------------------------------

# 14. OTP Verification

Reuse the existing verification service.

Example:

``` http
POST /api/auth/2fa/verify
```

Request:

``` json
{
  "challengeId": "...",
  "otp": "123456"
}
```

Backend must validate:

1.  challenge exists
2.  challenge is pending
3.  challenge has not expired
4.  account binding is correct
5.  portal binding is correct
6.  account is active
7.  attempt limit is not exceeded
8.  OTP is valid
9.  OTP has not been consumed
10. challenge is atomically consumed

------------------------------------------------------------------------

# 15. Atomic Consumption

Two concurrent verification requests for the same OTP must not both
succeed.

Expected:

``` text
Request A -> SUCCESS
Request B -> FAILURE
```

Use the existing database transaction/locking/conditional-update
strategy.

------------------------------------------------------------------------

# 16. OTP Resend

Reuse existing Admin resend logic.

On user-requested resend:

``` text
old OTP invalidated
new OTP generated
new OTP stored
new expiration
new notification
```

Never allow old and new OTPs to remain valid simultaneously.

RabbitMQ retry is different:

``` text
RabbitMQ retry -> same challenge/OTP
User resend    -> new challenge/OTP state
```

Do not generate a new OTP during every queue retry.

------------------------------------------------------------------------

# 17. Notification Reuse

Reuse the existing:

``` text
Notification Service
RabbitMQ
SMS provider
Email provider
Retry
DLQ
Scheduler
```

Do not create separate:

``` text
MarketingNotificationService
ManufacturerNotificationService
```

if the existing notification system can support a reusable OTP event.

Use a trusted purpose/context such as:

``` text
ADMIN_LOGIN_2FA
MARKETING_PARTNER_LOGIN_2FA
MANUFACTURER_LOGIN_2FA
```

or a reusable:

``` text
LOGIN_2FA
```

with server-side portal metadata.

Notification metadata must never become an authorization source.

------------------------------------------------------------------------

# 18. Notification Reliability

Prefer the existing transactional/outbox pattern if available:

``` text
DB transaction
    |
    +-- create/update MFA challenge
    +-- create notification/outbox record
    |
commit
    |
RabbitMQ
    |
worker
    |
SMS/email
```

Do not introduce a second queue architecture.

------------------------------------------------------------------------

# 19. SMS/Email Security

Reuse the existing provider integrations.

Never hardcode:

``` text
SMS token
SMTP credentials
RabbitMQ credentials
JWT secrets
OTP secret
encryption keys
```

Keep them in environment/secret management.

Do not reproduce previously supplied real credentials in source,
documentation, tests, or this implementation.

Provider "accepted/queued" should be shown as:

``` text
Verification code sent.
```

not guaranteed handset/inbox delivery.

------------------------------------------------------------------------

# 20. OTP Message

Reuse existing templates if possible.

Example:

``` text
Your verification code is 123456.
It expires in 5 minutes.
Do not share this code with anyone.
```

Do not include:

``` text
password
JWT
TFA token
internal IDs
provider credentials
unnecessary PII
```

Never log rendered OTP content.

------------------------------------------------------------------------

# 21. MFA Token/Session

After successful OTP verification, issue the existing fully
authenticated session/access token.

The final authentication state must represent:

``` text
password + OTP
```

For JWT-based systems, conceptually use claims such as:

``` json
{
  "sub": "account-id",
  "accountId": "account-id",
  "role": "MARKETING_PARTNER",
  "portalAccess": ["MARKETING_PARTNER"],
  "amr": ["pwd", "otp"],
  "mfa_verified": true,
  "auth_time": 1234567890,
  "iss": "existing-issuer",
  "aud": "existing-audience",
  "iat": 1234567890,
  "exp": 1234568790,
  "jti": "unique-id"
}
```

Adapt to the existing implementation.

Never let the frontend choose these claims.

------------------------------------------------------------------------

# 22. Separate TFA Token

If the existing Admin system uses a separate TFA token/header,
generalize it rather than duplicating it.

Conceptually:

``` json
{
  "typ": "PORTAL_2FA",
  "sub": "account-id",
  "accountId": "account-id",
  "portal": "MANUFACTURER",
  "challengeId": "challenge-id",
  "amr": ["pwd", "otp"],
  "purpose": "PORTAL_ACCESS",
  "iss": "existing-issuer",
  "aud": "existing-portal-api",
  "iat": 1234567890,
  "exp": 1234567890,
  "jti": "unique-id"
}
```

The actual implementation must follow the existing token architecture.

An Admin TFA token must not authenticate Marketing or Manufacturer.

A Marketing TFA token must not authenticate Admin or Manufacturer.

A Manufacturer TFA token must not authenticate Admin or Marketing.

------------------------------------------------------------------------

# 23. JWT Security

Preserve and strengthen existing JWT validation.

Validate:

-   explicit algorithm
-   signature
-   issuer
-   audience
-   expiration
-   subject
-   token type
-   purpose
-   portal
-   account
-   role
-   MFA state

Different token types must have mutually exclusive validation rules:

``` text
PRE_2FA
ACCESS
REFRESH
PORTAL_2FA
```

Do not accept a token simply because it contains:

``` json
{
  "role": "ADMIN"
}
```

------------------------------------------------------------------------

# 24. MFA Guard

Generalize the Admin MFA guard.

Conceptually:

``` text
Request
  |
  v
Authenticate
  |
  v
Resolve trusted principal
  |
  +--> CUSTOMER
  |       |
  |       +--> existing authorization
  |
  +--> ADMIN / MARKETING / MANUFACTURER
          |
          v
       require MFA
          |
      +---+---+
      |       |
    valid   invalid
      |       |
    allow   reject
```

Do not enforce this only in frontend routing.

Backend enforcement is mandatory.

------------------------------------------------------------------------

# 25. Shared APIs

Before modifying shared endpoints, create an endpoint matrix from the
actual repository:

  --------------------------------------------------------------------------
  Endpoint    Admin       Marketing   Manufacturer   Customer    MFA
                                                                 Required
  ----------- ----------- ----------- -------------- ----------- -----------
  actual      ...         ...         ...            ...         ...
  endpoint                                                       

  --------------------------------------------------------------------------

For each endpoint determine:

``` text
authenticated principal
role
portal
authorization
MFA requirement
```

Do not globally require MFA for all authenticated users.

Customer must remain unaffected.

------------------------------------------------------------------------

# 26. Portal Switching Protection

Test:

``` text
Marketing password valid
+
change targetPortal to ADMIN
=
must NOT become Admin
```

Also:

``` text
Manufacturer password valid
+
change targetPortal to ADMIN
=
must NOT become Admin
```

And:

``` text
Admin pre-MFA
+
change targetPortal
=
must NOT bypass MFA
```

Server-side authorization is authoritative.

------------------------------------------------------------------------

# 27. Refresh Token Security

Inspect existing refresh token behavior.

Ensure:

``` text
password-only Admin
password-only Marketing
password-only Manufacturer
```

cannot be refreshed into fully authenticated sessions without OTP.

If the existing Admin implementation already solves this, generalize it.

------------------------------------------------------------------------

# 28. Customer Protection

Explicitly test:

``` text
Customer login works
Customer authenticated API works
Customer frontend has no OTP UI
Customer frontend makes no 2FA request
Customer does not need TFA header
Customer shared API behavior remains unchanged
```

Do not add customer MFA accidentally through a global guard.

------------------------------------------------------------------------

# 29. UI --- Reusable OTP Component

Create or improve a reusable component:

``` text
TwoFactorVerification
```

or equivalent project naming.

Use it for:

``` text
Admin
Marketing Partner
Manufacturer
```

Do not create duplicate OTP components unless required by the existing
frontend architecture.

------------------------------------------------------------------------

# 30. OTP UI Requirements

The UI should be attractive, responsive, accessible, and consistent with
the existing design system.

Suggested layout:

``` text
┌─────────────────────────────────────┐
│                                     │
│        Verify your identity         │
│                                     │
│  We sent a verification code to     │
│          ma***@example.com          │
│                                     │
│     [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ]│
│                                     │
│          Code expires in            │
│               04:37                 │
│                                     │
│          [ Verify Code ]            │
│                                     │
│       Didn't receive the code?      │
│            [ Resend ]               │
│                                     │
│       [ Change method ]             │
│                                     │
└─────────────────────────────────────┘
```

Requirements:

-   six-digit input or configured length
-   automatic focus
-   paste support
-   keyboard navigation
-   backspace navigation
-   mobile-friendly numeric keyboard
-   accessible labels
-   clear invalid state
-   loading state
-   disabled state
-   responsive layout
-   consistent portal branding
-   no unnecessary animations that slow authentication

------------------------------------------------------------------------

# 31. Expiry Countdown

Display:

``` text
Code expires in 04:59
```

Update every second.

When expired:

``` text
Code expired
```

Allow:

``` text
Resend code
```

subject to server-side rate limits.

Important:

``` text
Frontend timer = UX only
Backend expiresAt = security authority
```

Never trust the frontend timer.

------------------------------------------------------------------------

# 32. Resend UX

Example:

``` text
Didn't receive the code?

Resend code
```

During cooldown:

``` text
Resend available in 00:25
```

The server remains authoritative.

Do not expose provider errors.

------------------------------------------------------------------------

# 33. OTP Input Security

Do not:

-   log OTP
-   store OTP in localStorage
-   put OTP in URLs
-   send OTP to analytics
-   put OTP into telemetry
-   expose OTP in Redux/global state longer than necessary

Do support legitimate paste.

------------------------------------------------------------------------

# 34. Frontend Authentication Interceptor

Inspect the existing API client/interceptor.

After successful MFA:

``` text
Admin
Marketing Partner
Manufacturer
```

should use the existing authenticated session mechanism.

If a dedicated TFA header exists, generalize the interceptor carefully.

Do not attach the Admin/Marketing/Manufacturer MFA requirement to
Customer requests.

------------------------------------------------------------------------

# 35. Business Layer Isolation

Do not touch:

``` text
OrderService
ProductService
InventoryService
CustomerService
ManufacturerService
MarketingService
PartnerService
PaymentService
```

or equivalent business logic.

Security changes belong in:

``` text
Auth
Security
Identity
Session
Middleware
Guard
Notification
```

If route-level security metadata is needed, add only the minimal
metadata/guard wiring.

------------------------------------------------------------------------

# 36. Iteration 1 --- Generalize Admin 2FA

Goal:

``` text
Admin 2FA remains fully functional
+
2FA core becomes portal-aware
```

Tasks:

-   identify Admin-specific assumptions
-   generalize challenge model/service
-   generalize OTP service
-   generalize notification context
-   generalize token/session context
-   generalize MFA guard
-   preserve Admin behavior

Do not integrate Marketing/Manufacturer yet if this makes the change
difficult to isolate.

### Acceptance

All existing Admin 2FA tests pass.

------------------------------------------------------------------------

# 37. Iteration 2 --- Database

Goal:

Make challenge storage portal-aware.

Tasks:

-   migration
-   entity/model
-   repository
-   indexes
-   status lifecycle

Acceptance:

``` text
existing Admin challenges remain safe
new Marketing challenges supported
new Manufacturer challenges supported
Customer challenges not created
```

------------------------------------------------------------------------

# 38. Iteration 3 --- Marketing Partner

Integrate:

``` text
login
password validation
challenge
method selection
SMS/email
OTP verification
final authentication
MFA guard
frontend UI
```

Do not touch Marketing business functionality.

Run Marketing + Admin regression tests.

------------------------------------------------------------------------

# 39. Iteration 4 --- Manufacturer

Integrate:

``` text
login
password validation
challenge
method selection
SMS/email
OTP verification
final authentication
MFA guard
frontend UI
```

Do not touch Manufacturer business functionality.

Run Manufacturer + Marketing + Admin regression tests.

------------------------------------------------------------------------

# 40. Iteration 5 --- Customer Exclusion

No new feature.

Prove Customer remains unchanged.

Verify:

``` text
Customer login
Customer UI
Customer API client
Customer routes
Customer shared APIs
Customer token/session
```

Expected:

``` text
No OTP
No MFA UI
No MFA API
No MFA header requirement
No regression
```

------------------------------------------------------------------------

# 41. Iteration 6 --- Shared OTP UI

Create/reuse the attractive OTP UI for:

``` text
Admin
Marketing Partner
Manufacturer
```

Required:

-   masked destination
-   OTP entry
-   countdown
-   expiry state
-   resend
-   errors
-   loading
-   accessibility
-   responsive behavior

Do not add it to Customer.

------------------------------------------------------------------------

# 42. Iteration 7 --- Security Regression

Test:

``` text
OTP brute force
OTP replay
OTP expiry
OTP resend
OTP race
cross-portal challenge
cross-portal token
pre-MFA token
refresh bypass
portal switching
role manipulation
shared API bypass
JWT substitution
JWT algorithm confusion
issuer/audience mismatch
disabled account
notification retry
DLQ behavior
```

------------------------------------------------------------------------

# 43. Iteration 8 --- Full Regression

Run:

``` text
unit tests
integration tests
E2E tests
frontend tests
backend tests
lint
typecheck
build
migration tests
```

Verify:

``` text
Admin
Marketing Partner
Manufacturer
Customer
```

------------------------------------------------------------------------

# 44. Iteration 9 --- Final Security Review

Review final diff for:

``` text
No secrets
No OTP logs
No password hashes
No customer MFA
No business-layer changes
No duplicated OTP systems
No cross-portal token reuse
No shared API bypass
No frontend-only authorization
No unsafe migration
No unrelated refactor
```

------------------------------------------------------------------------

# 45. Required Checkpoint Format

After every iteration report:

``` text
ITERATION: <number/name>

Objective:
- ...

Files inspected:
- ...

Files changed:
- ...

Why changed:
- ...

Files explicitly NOT changed:
- ...

Business layer touched:
- YES/NO

Security controls:
- ...

Tests:
- ...

Results:
- ...

Admin regression:
- PASS/FAIL

Marketing regression:
- PASS/FAIL

Manufacturer regression:
- PASS/FAIL

Customer regression:
- PASS/FAIL

Known risks:
- ...

Next iteration:
- ...
```

Do not proceed after critical security failures.

------------------------------------------------------------------------

# 46. Stop Conditions

Stop and ask for clarification if:

1.  Existing Admin 2FA cannot safely be generalized.
2.  Marketing or Manufacturer uses incompatible authentication
    architecture.
3.  Customer would be affected.
4.  Shared endpoint authorization is ambiguous.
5.  MFA requires business-layer changes.
6.  Migration could damage existing data.
7.  Refresh tokens can bypass MFA.
8.  Existing frontend token storage makes the requested security model
    unsafe.
9.  Provider behavior is unclear.
10. A secret would need to be hardcoded.
11. Portal/role source of truth is unclear.
12. A security shortcut is required.

Never guess.

------------------------------------------------------------------------

# 47. Required Security Tests

## Admin

``` text
password only -> protected API rejected
valid OTP -> authenticated
expired OTP -> rejected
used OTP -> rejected
wrong OTP -> rejected
resend -> old OTP invalid
```

## Marketing

``` text
password only -> protected API rejected
valid OTP -> authenticated
expired OTP -> rejected
used OTP -> rejected
wrong OTP -> rejected
resend -> old OTP invalid
```

## Manufacturer

``` text
password only -> protected API rejected
valid OTP -> authenticated
expired OTP -> rejected
used OTP -> rejected
wrong OTP -> rejected
resend -> old OTP invalid
```

## Cross-portal

``` text
Admin MFA -> Marketing rejected
Admin MFA -> Manufacturer rejected
Marketing MFA -> Admin rejected
Marketing MFA -> Manufacturer rejected
Manufacturer MFA -> Admin rejected
Manufacturer MFA -> Marketing rejected
```

## Customer

``` text
Customer login -> existing behavior
Customer API -> existing behavior
Customer frontend -> no OTP
Customer -> no MFA requirement
```

------------------------------------------------------------------------

# 48. Security Standards Baseline

Use authoritative security guidance when making implementation
decisions:

-   OWASP Multifactor Authentication Cheat Sheet
-   OWASP Authentication Cheat Sheet
-   OWASP Session Management Cheat Sheet
-   NIST SP 800-63B
-   RFC 8725 --- JWT Best Current Practices

Apply:

-   short-lived OTPs
-   single-use OTPs
-   strict attempt limits
-   cryptographically secure generation
-   rate limiting
-   replay prevention
-   protected authentication channels
-   server-side authorization
-   explicit JWT validation
-   mutually exclusive token types
-   no sensitive logging

SMS/PSTN authentication has known risks including SIM-swap and
number-porting attacks. Keep the implementation extensible for stronger
MFA methods such as TOTP, WebAuthn, or passkeys.

------------------------------------------------------------------------

# 49. Final Acceptance Matrix

  Requirement                          Admin   Marketing Partner   Manufacturer            Customer
  ---------------------------------- ------- ------------------- -------------- -------------------
  Password login                         YES                 YES            YES                 YES
  OTP required                           YES                 YES            YES                  NO
  SMS OTP                                YES                 YES            YES   Existing behavior
  Email OTP                              YES                 YES            YES   Existing behavior
  OTP expiry                             YES                 YES            YES                 N/A
  OTP rate limit                         YES                 YES            YES                 N/A
  OTP single use                         YES                 YES            YES                 N/A
  Attractive OTP UI                      YES                 YES            YES                  NO
  Countdown                              YES                 YES            YES                  NO
  Resend                                 YES                 YES            YES                  NO
  MFA server guard                       YES                 YES            YES                  NO
  Business-layer changes                  NO                  NO             NO                  NO
  Existing functionality preserved       YES                 YES            YES                 YES

------------------------------------------------------------------------

# 50. Final Deliverables

Provide:

``` text
1. Architecture discovery report
2. Existing Admin 2FA reuse analysis
3. Portal-aware 2FA design
4. Database/model changes
5. Marketing Partner 2FA integration
6. Manufacturer 2FA integration
7. Admin reusable/refactored 2FA integration
8. Shared OTP UI
9. OTP countdown/expiry UI
10. Notification integration
11. MFA authorization guard
12. Cross-portal security tests
13. Customer regression tests
14. Environment/config documentation
15. API documentation
16. Deployment notes
17. Rollback plan
18. Final security review
19. Final git diff review
```

------------------------------------------------------------------------

# 51. Final Instruction

**Do not implement three separate 2FA systems.**

First understand the existing Admin implementation.

Then safely generalize it into a reusable portal-aware 2FA layer:

``` text
Existing Admin 2FA
        |
        v
Reusable 2FA Core
        |
        +---- Admin
        +---- Marketing Partner
        +---- Manufacturer
```

Customer remains outside the new MFA policy.

The final system must:

-   preserve Admin 2FA
-   add Marketing Partner 2FA
-   add Manufacturer 2FA
-   explicitly exclude Customer
-   reuse existing OTP/notification/RabbitMQ/SMS/email infrastructure
-   prevent privileged access before OTP
-   prevent cross-portal token/challenge reuse
-   enforce MFA server-side
-   protect shared APIs
-   keep OTP short-lived, single-use, and rate-limited
-   keep secrets in environment/secret management
-   keep passwords, password hashes, OTPs, and tokens out of
    responses/logs
-   provide an attractive reusable OTP UI
-   show OTP expiry countdown
-   preserve all existing functionality
-   avoid the business layer
-   implement through controlled iterations
-   test after every iteration
-   stop and ask whenever safe implementation requires an architectural
    assumption

**Optimize for security, safe reuse, minimal change surface, and zero
functional regression---not implementation speed.**
