# Admin-Only 2FA Integration Prompt

## Existing Clothing Store Project --- Security-First, Non-Breaking Implementation

> **Purpose:** Give this entire document to Antigravity, GitHub Copilot,
> Claude Code, Cursor, or another coding agent working directly inside
> the existing Clothing Store repository.
>
> **Primary objective:** Add secure, database-backed, admin-only
> two-factor authentication (2FA) using the existing SMS/email
> notification infrastructure, while preserving all existing non-admin
> functionality and keeping authentication/security logic out of the
> business layer wherever possible.

------------------------------------------------------------------------

## 0. Non-Negotiable Instructions

You are modifying an **existing production-style application**. Do not
treat this as a greenfield project.

### Absolute rules

1.  **Do not start coding immediately.**

    -   First inspect the repository and produce an
        architecture/security discovery report.
    -   Do not modify files during the discovery phase.

2.  **Do not rewrite existing architecture.**

    -   Reuse the current authentication, database, ORM, JWT/session,
        notification, RabbitMQ, email, SMS, logging, configuration,
        middleware/guard, and frontend conventions.
    -   Do not introduce a new framework or replacement infrastructure
        unless the repository clearly requires it.

3.  **Do not modify business logic unnecessarily.**

    -   2FA belongs primarily in the authentication/security layer.
    -   Do not rewrite product, order, inventory, manufacturer, partner,
        customer, marketing, payment, or other business services merely
        to add 2FA.
    -   If an existing business route needs a security
        guard/authorization middleware, add the smallest possible
        integration point.

4.  **Admin-only 2FA is mandatory.**

    -   ADMIN login requires password + OTP before privileged
        authentication is granted.
    -   Customer, marketing partner, manufacturer, and other non-admin
        portals must continue working exactly as before.
    -   Shared APIs must distinguish the authenticated principal's
        server-validated role/portal. Never trust a client-supplied
        role.

5.  **Never weaken existing security to make the feature easier.**

6.  **Never hardcode secrets.**

    -   All credentials, signing keys, OTP secrets, RabbitMQ
        credentials, SMS tokens, SMTP credentials, encryption keys, etc.
        must remain in environment variables or the existing
        secret-management mechanism.
    -   Never place real secrets in source code, tests, commits, logs,
        API responses, documentation, screenshots, or generated
        examples.
    -   Use placeholders in `.env.example`.

7.  **Never expose passwords or password hashes.**

    -   Existing login responses that return `user`, `manufacturer`, or
        `partner` objects containing password hashes must be
        removed/fixed as part of the authentication security cleanup.
    -   Never return bcrypt/argon2/password hashes to the browser.

8.  **Do not guarantee "zero vulnerabilities."**

    -   Implement defense in depth and perform a security review.
    -   If an architectural decision cannot be made safely from the
        repository, stop and ask for clarification rather than guessing.

9.  **Every implementation phase must compile/build, lint, type-check
    where applicable, and run relevant tests before proceeding.**

10. **Review the final git diff for unrelated changes.**

    -   Revert accidental formatting, refactors, dependency upgrades,
        generated files, or unrelated business changes.

------------------------------------------------------------------------

# 1. Existing Authentication Context

The current login endpoint is:

``` http
POST http://localhost:4000/api/auth/login
```

The existing login request includes concepts such as:

``` json
{
  "email": "admin@example.com",
  "targetPortal": "ADMIN",
  "encryptedPassword": "..."
}
```

The existing implementation may also have an IV field in the historical
request contract.

### Important existing encryption requirement

The application currently uses frontend/backend environment
configuration for the password encryption IV.

For the new implementation:

-   Keep the IV/configuration in environment variables on both frontend
    and backend according to the existing architecture.
-   **Do not send the IV in the login request.**
-   Do not hardcode the IV.
-   Do not expose other server-only encryption secrets to the browser.
-   Do not change the existing password-encryption mechanism unless the
    repository proves that a security correction is required.

If the current password encryption mechanism has architectural
weaknesses, document them separately and make only the minimum safe
correction necessary. Do not silently redesign authentication.

------------------------------------------------------------------------

# 2. Existing Login Response Security Requirement

The current login response may contain excessive data similar to:

``` json
{
  "success": true,
  "message": "Authentication successful",
  "token": "...",
  "accessToken": "...",
  "account": {},
  "user": {},
  "manufacturer": {},
  "partner": {}
}
```

This is not acceptable if the extra objects contain password hashes or
unrelated portal records.

For authenticated responses, expose only the minimum data required by
the client.

The intended minimal account shape is:

``` json
{
  "id": "...",
  "email": "...",
  "phone": "...",
  "role": "...",
  "status": "..."
}
```

Do not return:

-   password hashes
-   password fields
-   password encryption material
-   unrelated `user` records
-   unrelated `manufacturer` records
-   unrelated `partner` records
-   internal database metadata
-   internal notification records
-   OTP values
-   OTP hashes
-   secret keys
-   refresh-token internals

------------------------------------------------------------------------

# 3. Desired Admin Authentication Flow

Implement the following flow.

## Step 1 --- Admin submits credentials

Frontend:

``` http
POST /api/auth/login
```

with:

``` json
{
  "email": "admin@example.com",
  "targetPortal": "ADMIN",
  "encryptedPassword": "..."
}
```

Backend:

1.  Validate the request.
2.  Resolve the account from the server-side database.
3.  Validate the password.
4.  Validate account status.
5.  Validate that the account is actually authorized for the ADMIN
    portal.
6.  Do not trust the client merely because it submitted
    `targetPortal: "ADMIN"`.
7.  Do not issue a fully privileged admin access token yet.

If the password is incorrect, use the existing safe authentication error
behavior and throttling.

If credentials are correct and the account is an admin:

**DO NOT grant full admin authorization yet.**

Create a short-lived pre-authentication/2FA challenge state.

Return only the information required to continue the 2FA flow.

Example:

``` json
{
  "success": true,
  "message": "Additional verification required",
  "requiresTwoFactor": true,
  "challengeId": "secure-random-id",
  "availableMethods": [
    "SMS",
    "EMAIL"
  ],
  "maskedPhone": "******0536",
  "maskedEmail": "ad***@example.com"
}
```

### Important

Do not return:

``` json
{
  "token": "fully privileged token"
}
```

before OTP verification.

Do not return the actual OTP.

Do not return the full phone number or full email address unless there
is a documented existing UI requirement that cannot be satisfied with
masking.

The destination must always be resolved from the server-side admin
account.

The client must only select the **method**, not the destination.

------------------------------------------------------------------------

# 4. Non-Admin Login Behavior

For:

-   CUSTOMER
-   MARKETING PARTNER
-   MANUFACTURER
-   other existing non-admin roles

do not introduce 2FA unless the repository already has an independent
requirement for it.

Their current login flow must continue to work.

Do not:

-   send them an OTP
-   create admin 2FA challenges
-   require an admin TFA header
-   change their existing authorization
-   redirect them through the admin 2FA screen
-   change their business behavior

Regression-test all existing portal login flows.

------------------------------------------------------------------------

# 5. OTP Method Selection

After successful admin password authentication, the frontend displays:

``` text
Choose verification method:

[ SMS to ******0536 ]

[ Email to ad***@example.com ]
```

The browser then calls an endpoint following the repository's existing
route conventions, for example:

``` http
POST /api/auth/admin/2fa/send
```

Request:

``` json
{
  "challengeId": "...",
  "method": "SMS"
}
```

or:

``` json
{
  "challengeId": "...",
  "method": "EMAIL"
}
```

### Backend requirements

The server must:

1.  Validate the challenge ID.
2.  Confirm the challenge belongs to an admin authentication attempt.
3.  Confirm it is still pending.
4.  Confirm it has not expired.
5.  Confirm the selected method is allowed.
6.  Resolve the destination from the database.
7.  Generate a cryptographically secure OTP.
8.  Store only the protected representation of the OTP.
9.  Send the OTP through the existing notification infrastructure.
10. Never send the OTP directly from an auth controller if the existing
    notification service already provides a durable queue.
11. Never log the OTP.
12. Never return the OTP in an API response.

------------------------------------------------------------------------

# 6. OTP Requirements

Default configuration:

``` yaml
otp:
  expiry-minutes: 5
  length: 6
  max-attempts: 5
```

Adapt the exact configuration naming to the existing project.

All values must be configurable through environment/configuration.

## OTP generation

Use a cryptographically secure random number generator.

Do NOT use:

-   `Math.random()`
-   timestamps
-   predictable counters
-   email/phone-derived values
-   account IDs
-   JWT values
-   deterministic algorithms

For a six-digit OTP:

``` text
000000 - 999999
```

with uniform cryptographically secure generation.

If the existing product can support a longer OTP without usability
problems, document whether an 8-digit code should be adopted. Do not
change the user experience silently.

## OTP storage

Never store the plaintext OTP.

Because a 6-digit OTP has a small keyspace, simply hashing it with an
ordinary password hash does not by itself protect it from offline brute
force after database compromise.

Prefer a keyed construction such as:

``` text
otpHash = HMAC-SHA-256(
  OTP_SERVER_SECRET,
  challengeId + ":" + otp
)
```

where `OTP_SERVER_SECRET` is stored only in server-side
environment/secret management.

Use a timing-safe comparison.

If the repository already has a stronger established cryptographic
mechanism, reuse it after verifying that it is appropriate for
low-entropy OTP secrets.

Document the selected approach.

------------------------------------------------------------------------

# 7. OTP Database Design

Create a dedicated authentication/2FA table using the project's existing
ORM and migration conventions.

Suggested logical model:

``` text
admin_2fa_challenges
--------------------
id
account_id
profile_id                  nullable if architecture requires
target_portal
purpose
method
otp_hash
expires_at
attempt_count
max_attempts
resend_count
last_sent_at
status
notification_id             nullable
created_at
updated_at
verified_at                 nullable
consumed_at                 nullable
request_ip                  nullable/minimally stored
user_agent_hash             nullable
```

Suggested statuses:

``` text
PENDING
VERIFIED
EXPIRED
LOCKED
CANCELLED
```

Adapt naming to existing conventions.

## Required indexes

At minimum, consider indexes for:

``` text
account_id
expires_at
status
created_at
```

and any composite/partial index required to efficiently identify an
active challenge.

Avoid allowing unlimited active challenges for one admin.

------------------------------------------------------------------------

# 8. OTP Lifecycle

The OTP must be:

-   short-lived
-   single-use
-   attempt-limited
-   invalidated after successful verification
-   invalidated when replaced by a resend
-   invalidated after expiration
-   invalidated when the authentication flow is cancelled

### Verification

Example:

``` http
POST /api/auth/admin/2fa/verify
```

Request:

``` json
{
  "challengeId": "...",
  "otp": "123456"
}
```

Backend must verify:

1.  Challenge exists.
2.  Challenge belongs to an admin authentication flow.
3.  Challenge is still pending.
4.  Challenge is not expired.
5.  Attempt count has not exceeded the limit.
6.  OTP format is valid.
7.  Protected OTP comparison succeeds.
8.  The challenge is atomically marked consumed/verified.

### Atomicity

Prevent two concurrent requests from successfully consuming the same
OTP.

Use a transaction and/or atomic conditional update such that:

``` text
PENDING -> VERIFIED
```

can happen only once.

If two requests race, only one may succeed.

------------------------------------------------------------------------

# 9. Resend Rules

If resend functionality is required:

``` http
POST /api/auth/admin/2fa/resend
```

or follow existing route conventions.

On resend:

1.  Apply rate limits.
2.  Generate a new OTP.
3.  Replace/invalidate the old OTP.
4.  Never allow both old and new OTPs to remain valid.
5.  Update expiration.
6.  Send using the existing notification infrastructure.
7.  Do not return the OTP.
8.  Do not log the OTP.

Recommended protections:

``` text
Maximum sends per challenge
Maximum sends per account per time window
Maximum sends per IP per time window
Minimum resend interval
```

Use configuration rather than hardcoding policy values.

------------------------------------------------------------------------

# 10. Existing Notification Infrastructure MUST Be Reused

The application already has SMS/email notification functionality.

The 2FA feature must integrate with it rather than create a second
notification architecture.

Existing infrastructure includes concepts such as:

-   RabbitMQ
-   durable notification processing
-   dead-letter queue / dead-letter exchange
-   retry/scheduler behavior
-   SMS provider integration
-   email provider integration
-   notification status tracking

The authentication layer should produce an appropriate notification
command/event/job.

Conceptually:

``` text
Admin 2FA service
      |
      v
2FA challenge stored
      |
      v
Notification command/outbox
      |
      v
RabbitMQ
      |
      +------> Email worker ------> existing email provider
      |
      +------> SMS worker --------> existing SMS provider
      |
      v
status / retry / DLQ
```

Do not duplicate provider credentials or provider clients.

------------------------------------------------------------------------

# 11. Notification Reliability Requirements

The OTP generation transaction and notification delivery must be
designed carefully.

Prefer an existing **transactional outbox** pattern if the project
already has one.

The ideal sequence is:

``` text
DB transaction
  |
  +-- create/update 2FA challenge
  |
  +-- create notification/outbox record
  |
commit
  |
worker publishes/sends notification
```

This prevents an authentication challenge from being created while its
notification job is silently lost.

If the current notification system already has a reliable equivalent,
reuse it.

Do not invent a competing queue.

------------------------------------------------------------------------

# 12. SMS Provider Semantics

The existing SMS provider is SparrowSMS.

Keep its credentials in environment variables/secret management.

Do not hardcode:

-   token
-   sender credentials
-   API secrets
-   production phone numbers

The SMS provider's successful API response should not be treated as
proof that the user actually received/read the message.

Use wording such as:

``` text
Verification code sent.
```

rather than:

``` text
Verification code delivered to your phone.
```

unless the existing provider integration has an authoritative delivery
receipt.

------------------------------------------------------------------------

# 13. Email Provider Semantics

The existing email infrastructure uses the configured email
provider/SMTP integration.

Keep all credentials in environment variables/secret management.

Do not put credentials into:

-   source
-   Dockerfiles
-   frontend bundles
-   Git
-   logs
-   test snapshots
-   API responses

A successful SMTP/API submission is not necessarily proof that the
message reached the user's inbox.

------------------------------------------------------------------------

# 14. Notification Content

Example SMS/email body:

``` text
Your admin verification code is 123456. It expires in 5 minutes. Do not share this code with anyone.
```

Adapt the wording to the existing notification templates.

Do not include:

-   password
-   password hash
-   JWT
-   access token
-   refresh token
-   internal account ID
-   internal database ID
-   full authentication context
-   unnecessary personal data

Never log the rendered OTP message.

------------------------------------------------------------------------

# 15. Final Authentication Token

After successful OTP verification, issue the application's normal
authenticated admin session/access token according to the existing
architecture.

Preferred design:

``` text
password verified
+
OTP verified
=
fully authenticated admin session
```

The final authenticated token/session should carry an explicit
indication that MFA/2FA was satisfied.

For JWT-based systems, use claims appropriate to the existing
architecture, for example:

``` json
{
  "sub": "account-id",
  "accountId": "account-id",
  "role": "ADMIN",
  "portalAccess": ["ADMIN"],
  "amr": ["pwd", "otp"],
  "mfa_verified": true,
  "auth_time": 1234567890,
  "iss": "your-existing-issuer",
  "aud": "your-existing-admin-audience",
  "iat": 1234567890,
  "exp": 1234568790,
  "jti": "unique-token-id"
}
```

Do not copy this blindly. Adapt it to the repository's JWT/session
design.

### Critical

A password-only admin token must never be accepted as a fully
authenticated admin token.

If the existing architecture currently generates a JWT immediately after
password validation, either:

1.  defer privileged token issuance until OTP verification,
    **preferred**, or
2.  issue a clearly scoped pre-2FA token that every protected admin
    route rejects.

Do not allow a normal access token to exist in an intermediate state
that can accidentally reach business APIs.

------------------------------------------------------------------------

# 16. If a Separate TFA Token Is Required

The requested architecture may use a separate TFA token sent with every
admin request.

If the existing architecture requires this, implement it securely.

Example:

``` http
X-Admin-2FA-Token: <token>
```

The token must be:

-   short-lived
-   cryptographically signed
-   scoped specifically to admin 2FA
-   bound to the correct account
-   bound to the correct authentication challenge/session
-   non-reusable as an ordinary access token
-   protected against algorithm confusion
-   validated for issuer
-   validated for audience
-   validated for expiration
-   validated for not-before where used
-   validated for token type/purpose
-   assigned a unique `jti`
-   revocable if the architecture supports server-side session
    revocation

Example logical claims:

``` json
{
  "typ": "ADMIN_2FA",
  "sub": "account-id",
  "accountId": "account-id",
  "role": "ADMIN",
  "challengeId": "challenge-id",
  "amr": ["pwd", "otp"],
  "purpose": "ADMIN_ACCESS",
  "iss": "existing-issuer",
  "aud": "admin-api",
  "iat": 1234567890,
  "exp": 1234568790,
  "jti": "unique-id"
}
```

Use a separate signing key/secret from other JWT types if practical.

Do not allow an ordinary access token to satisfy the TFA header.

Do not allow a TFA token to be accepted as an ordinary user token.

Different token purposes must have mutually exclusive validation rules.

------------------------------------------------------------------------

# 17. Preferred Alternative to a Separate TFA Bearer Token

Before implementing a second bearer token, inspect the existing session
architecture.

If the application can safely represent:

``` text
mfa_verified = true
```

inside the authenticated session/access token, prefer that over
introducing another long-lived bearer credential.

The important security property is:

``` text
Admin authorization requires proof that password + OTP authentication completed.
```

If a separate TFA token is retained because the existing application
explicitly requires it, keep it short-lived and tightly scoped.

Avoid storing privileged bearer tokens in `localStorage` if the existing
architecture can safely use an HttpOnly, Secure, SameSite
cookie/session.

If the frontend architecture absolutely requires a browser-readable
token/header, preserve the existing architecture but document the
XSS/replay risk and minimize token lifetime and scope.

------------------------------------------------------------------------

# 18. Admin Authorization Guard

The most important part of this feature is not the OTP UI.

It is **server-side enforcement**.

Create/reuse a central authentication/authorization middleware, guard,
interceptor, strategy, or equivalent.

The flow should conceptually be:

``` text
Request
  |
  v
Authenticate token/session
  |
  v
Resolve server-side principal
  |
  +---- non-admin ----> existing authorization behavior
  |
  +---- admin --------> require MFA proof
                              |
                              v
                         allow request
```

Do not implement this only in frontend route guards.

Frontend route protection is not security.

The backend must enforce it.

------------------------------------------------------------------------

# 19. Shared API Requirement

The application contains APIs that may be used by:

-   admin
-   customer
-   marketing partner
-   manufacturer
-   other users

Do not globally block those APIs simply because 2FA exists.

For every shared API, determine:

``` text
Who is authenticated?
What role/portal does the server-side principal have?
Has admin MFA been completed?
Does this endpoint require admin-level authorization?
```

Example:

``` text
CUSTOMER + shared API
=> existing behavior

MANUFACTURER + shared API
=> existing behavior

PARTNER + shared API
=> existing behavior

ADMIN + protected admin operation
=> require completed admin MFA
```

Never determine this from a client-supplied:

``` json
{
  "role": "CUSTOMER"
}
```

or:

``` json
{
  "targetPortal": "CUSTOMER"
}
```

Trust only server-validated authentication claims/session state and
database authorization.

------------------------------------------------------------------------

# 20. Prevent Portal Switching Bypass

A major security test must verify that an admin cannot:

1.  authenticate as ADMIN with password,
2.  skip OTP,
3.  change `targetPortal`,
4.  obtain a customer/manufacturer/partner token,
5.  use that token to reach privileged admin functionality.

The backend must enforce authorization independently of the frontend's
portal selection.

------------------------------------------------------------------------

# 21. Pre-2FA Token Restrictions

If a pre-2FA token exists, it must be allowed only for endpoints
required to complete authentication.

For example:

``` text
POST /api/auth/admin/2fa/send
POST /api/auth/admin/2fa/resend
POST /api/auth/admin/2fa/verify
POST /api/auth/admin/2fa/cancel
```

It must NOT access:

``` text
/admin/users
/admin/orders
/admin/products
/admin/settings
/admin/reports
/admin/...
```

or any other privileged business endpoint.

Do not rely on frontend routing for this restriction.

------------------------------------------------------------------------

# 22. Account Status Checks

At minimum, verify the admin account is still active:

-   during password login
-   during 2FA challenge operations
-   during OTP verification
-   during privileged authenticated requests where the existing
    architecture performs authorization/session validation

If an account is disabled after login, its privileged access should not
continue indefinitely.

Reuse existing account-status logic rather than creating conflicting
rules.

------------------------------------------------------------------------

# 23. Rate Limiting

Implement rate limiting for:

### Password login

Reuse the existing login throttling mechanism.

### OTP send

Rate-limit by appropriate dimensions, such as:

``` text
account
IP
challenge
destination
```

### OTP verification

Rate-limit failed attempts by:

``` text
challenge
account
IP
```

Use defense in depth.

Do not allow an attacker to make unlimited guesses against a six-digit
OTP.

Recommended starting configuration:

``` text
OTP lifetime: 5 minutes
Max verification attempts: 5
```

Make these configurable.

If the existing security policy specifies different values, use it and
document the decision.

------------------------------------------------------------------------

# 24. OTP Error Messages

Avoid unnecessarily revealing authentication state.

For example:

``` text
Invalid or expired verification code.
```

is preferable to exposing internal state such as:

``` text
Challenge exists but OTP hash did not match.
```

Do not return:

-   database IDs
-   stack traces
-   provider responses
-   notification credentials
-   cryptographic errors
-   SQL errors

to the client.

------------------------------------------------------------------------

# 25. Security Logging

Add security audit events where the existing architecture supports them.

Suggested events:

``` text
ADMIN_LOGIN_PASSWORD_SUCCESS
ADMIN_LOGIN_PASSWORD_FAILURE
ADMIN_2FA_CHALLENGE_CREATED
ADMIN_2FA_METHOD_SELECTED
ADMIN_2FA_OTP_QUEUED
ADMIN_2FA_OTP_SEND_FAILED
ADMIN_2FA_FAILED
ADMIN_2FA_LOCKED
ADMIN_2FA_EXPIRED
ADMIN_2FA_VERIFIED
ADMIN_SESSION_CREATED
ADMIN_SESSION_REVOKED
```

Log metadata such as:

``` text
timestamp
account ID
event type
IP where appropriate
user-agent hash where appropriate
request/correlation ID
result
```

Never log:

``` text
password
OTP
OTP hash
JWT
TFA token
refresh token
Authorization header
SMS token
SMTP password
RabbitMQ password
encryption key
```

------------------------------------------------------------------------

# 26. Existing Login Response Cleanup

As part of the authentication change, fix the existing excessive login
response.

The browser should receive only the minimum required account
information.

For example:

``` json
{
  "success": true,
  "message": "Authentication successful",
  "token": "...",
  "accessToken": "...",
  "account": {
    "id": "...",
    "email": "...",
    "phone": "...",
    "role": "...",
    "status": "..."
  }
}
```

However, for ADMIN login **before OTP verification**, do not issue the
fully privileged token.

The admin response should instead indicate:

``` json
{
  "success": true,
  "message": "Additional verification required",
  "requiresTwoFactor": true,
  "challengeId": "...",
  "availableMethods": ["SMS", "EMAIL"],
  "maskedPhone": "******0536",
  "maskedEmail": "ad***@example.com"
}
```

Do not return both the privileged token and `requiresTwoFactor`.

------------------------------------------------------------------------

# 27. Frontend Admin Flow

Modify only the admin authentication flow as required.

Conceptually:

``` text
Admin Login Screen
      |
      v
email/password
      |
      v
POST /api/auth/login
      |
      +---- non-admin ---> existing flow
      |
      +---- admin -------> 2FA selection screen
                              |
                              v
                     choose SMS/email
                              |
                              v
                    POST /admin/2fa/send
                              |
                              v
                        OTP screen
                              |
                              v
                   POST /admin/2fa/verify
                              |
                              v
                    authenticated admin
```

The frontend must not:

-   generate OTP
-   validate OTP locally as final authorization
-   store OTP
-   send OTP directly to SparrowSMS
-   send email directly
-   decide whether a user is an admin
-   bypass backend authorization
-   expose server-side notification credentials

------------------------------------------------------------------------

# 28. Browser Token Handling

Inspect the existing frontend authentication strategy first.

Prefer the existing secure session architecture.

If tokens are currently stored client-side:

-   do not increase their lifetime unnecessarily
-   do not duplicate tokens into multiple storage mechanisms
-   do not place secrets into URLs
-   do not put tokens in query parameters
-   do not log tokens
-   do not persist the OTP
-   do not store notification credentials

If an HttpOnly Secure SameSite cookie is compatible with the existing
architecture, document whether it should be used.

If the existing frontend absolutely requires a custom header, follow the
repository's conventions and minimize the lifetime/scope of the
credential.

------------------------------------------------------------------------

# 29. Environment Variables

Use the existing configuration architecture.

Add only the required configuration values.

Example:

``` env
OTP_LENGTH=6
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=5
OTP_MAX_RESENDS=3
OTP_RESEND_COOLDOWN_SECONDS=30
OTP_SERVER_SECRET=<server-side-secret>
ADMIN_2FA_TOKEN_SECRET=<server-side-secret-if-required>
ADMIN_2FA_TOKEN_TTL_MINUTES=15
```

Adapt names to the current project.

Do NOT put actual secret values into `.env.example`.

Example:

``` env
OTP_SERVER_SECRET=replace-with-a-long-random-secret
```

All secrets must remain server-side.

------------------------------------------------------------------------

# 30. Existing Secrets

The project already has secrets for infrastructure such as:

-   RabbitMQ
-   email
-   SMS provider
-   authentication/JWT
-   encryption

**Do not hardcode any of them.**

Reuse the existing environment/configuration mechanism.

If secrets are currently committed to source control, do not print them
into the new files. Flag the issue and recommend secret
rotation/remediation.

------------------------------------------------------------------------

# 31. JWT Security

If JWTs are used, follow the repository's existing library and
architecture while enforcing:

-   explicit allowed algorithms
-   signature verification
-   issuer validation
-   audience validation
-   expiration validation
-   token type/purpose validation
-   appropriate subject/account validation
-   appropriate role validation
-   no algorithm confusion
-   no acceptance of `alg: none`
-   appropriate signing key strength
-   mutually exclusive validation for different token types

For different token types, use explicit separation such as:

``` text
ACCESS
REFRESH
PRE_2FA
ADMIN_2FA
```

with validation rules that cannot accidentally overlap.

Never accept a token simply because it contains:

``` json
{
  "role": "ADMIN"
}
```

The signature and complete validation must succeed.

------------------------------------------------------------------------

# 32. TFA Token Header

If the requested architecture requires a dedicated header:

``` http
X-Admin-2FA-Token: <token>
```

centralize validation.

Do not scatter checks throughout business controllers.

Do not allow callers to bypass the check by changing:

``` text
Authorization
X-Admin-2FA-Token
targetPortal
role
accountId
```

The server must derive the authenticated identity from trusted
authentication state.

------------------------------------------------------------------------

# 33. Do Not Put OTP in JWT

Never put:

``` json
{
  "otp": "123456"
}
```

inside a JWT.

Never put the OTP into:

-   URL
-   query string
-   cookie
-   local storage
-   database plaintext
-   logs
-   analytics
-   tracing payloads

------------------------------------------------------------------------

# 34. Challenge Identifier

The challenge ID must be unpredictable.

Use a cryptographically secure random UUID/identifier or equivalent with
sufficient entropy.

Do not use:

``` text
email
phone
accountId
timestamp
incrementing integer
```

as the challenge ID.

The challenge ID should not itself expose sensitive information.

------------------------------------------------------------------------

# 35. Business-Layer Isolation

This is a strict requirement.

### Do NOT move 2FA logic into:

``` text
ProductService
OrderService
InventoryService
ManufacturerService
PartnerService
CustomerService
PaymentService
```

or equivalent business services.

### Put 2FA in:

``` text
Authentication
Security
Identity
Access Control
Middleware
Guards
Session
Notification
```

depending on the existing architecture.

Business endpoints should remain focused on business rules.

The security layer should decide:

``` text
Is this request authenticated?
Who is the principal?
Is the principal authorized?
If ADMIN, has required MFA been completed?
```

Then the business layer can execute normally.

------------------------------------------------------------------------

# 36. Suggested Logical Module Structure

Do not blindly copy this structure.

Adapt it to the repository's framework and conventions.

``` text
auth/
  login
  session
  authorization
  two-factor/
    challenge
    otp
    verification
    guard
    token
    repository
    service
    controller
    constants
    types
    errors

notification/
  email/
  sms/
  queue/
  worker/
  retry/
  dlq/
  templates/
```

If the project uses a different organization, follow its existing
structure.

------------------------------------------------------------------------

# 37. API Contract

Use existing API naming conventions.

Suggested endpoints:

``` http
POST /api/auth/login
POST /api/auth/admin/2fa/send
POST /api/auth/admin/2fa/verify
POST /api/auth/admin/2fa/resend
POST /api/auth/admin/2fa/cancel
```

Only create endpoints that are actually required.

### Login

Admin password success:

``` json
{
  "success": true,
  "message": "Additional verification required",
  "requiresTwoFactor": true,
  "challengeId": "...",
  "availableMethods": ["SMS", "EMAIL"],
  "maskedPhone": "******0536",
  "maskedEmail": "ad***@example.com"
}
```

### Send

``` json
{
  "success": true,
  "message": "Verification code sent"
}
```

### Verify

On success:

``` json
{
  "success": true,
  "message": "Authentication successful",
  "token": "...",
  "accessToken": "...",
  "account": {
    "id": "...",
    "email": "...",
    "phone": "...",
    "role": "ADMIN",
    "status": "ACTIVE"
  }
}
```

Adapt the exact contract to the existing API.

Do not break existing non-admin response contracts unless required for
security.

------------------------------------------------------------------------

# 38. Notification Failure Handling

If SMS/email sending fails:

``` text
challenge remains controlled/pending
notification job follows existing retry policy
failed notification goes through existing DLQ policy
```

Do not generate a new OTP for every worker retry.

A notification retry should retry delivery of the same challenge's OTP.

A user-initiated resend should generate a new OTP and invalidate the old
one.

These are different operations.

------------------------------------------------------------------------

# 39. Concurrency and Race Conditions

Explicitly test:

### Double verification

Two requests submit the same valid OTP simultaneously.

Expected:

``` text
one succeeds
one fails
```

### Resend during verification

If resend and verify race:

``` text
only the currently valid challenge/OTP can succeed
```

### Multiple browser tabs

Opening multiple admin login tabs must not create a way to bypass MFA.

### Multiple OTP requests

Do not allow unlimited active challenges.

------------------------------------------------------------------------

# 40. Account/Challenge Binding

Every challenge must be bound server-side to:

``` text
account
portal = ADMIN
purpose = ADMIN_LOGIN
```

The verify endpoint must not allow:

``` text
challengeId from Account A
+
credentials/token from Account B
```

to authenticate as either account.

Never let the browser submit an arbitrary:

``` text
accountId
phone
email
role
```

and use that as the source of truth.

------------------------------------------------------------------------

# 41. Security Threat Model

Before coding, document threats including:

1.  OTP brute force
2.  OTP replay
3.  OTP database disclosure
4.  stolen pre-2FA token
5.  stolen admin TFA token
6.  JWT algorithm confusion
7.  token substitution
8.  portal-switching bypass
9.  shared-API bypass
10. frontend-only authorization
11. notification queue loss
12. notification replay
13. SMS/email provider compromise
14. account enumeration
15. OTP leakage through logs
16. OTP leakage through analytics
17. OTP leakage through traces
18. concurrent verification
19. resend race conditions
20. disabled-admin session reuse
21. refresh-token bypass
22. CSRF if cookie-based
23. XSS token theft if browser-readable tokens are used
24. insecure CORS
25. secret leakage
26. session fixation
27. token replay
28. privilege escalation
29. IDOR between accounts
30. broken access control

For each threat, document the mitigation implemented.

------------------------------------------------------------------------

# 42. Tests --- Mandatory

Create or update tests according to the existing test framework.

## Unit tests

Test:

-   OTP generation
-   OTP length
-   OTP randomness mechanism
-   OTP hashing/protection
-   constant-time comparison
-   expiry
-   maximum attempts
-   single-use
-   resend invalidation
-   challenge status transitions
-   account binding
-   method validation
-   token claim generation
-   token validation
-   token purpose separation

## Integration tests

Test:

``` text
Admin password correct
  -> no privileged token
  -> challenge created
```

``` text
Admin chooses SMS
  -> notification queued
  -> SMS notification uses existing infrastructure
```

``` text
Admin chooses EMAIL
  -> email notification queued
```

``` text
Correct OTP
  -> final authenticated admin session/token
```

``` text
Wrong OTP
  -> rejected
  -> attempt count incremented
```

``` text
Expired OTP
  -> rejected
```

``` text
OTP reused
  -> rejected
```

``` text
OTP after resend
  -> old OTP rejected
  -> new OTP accepted
```

------------------------------------------------------------------------

# 43. Security Regression Tests

These are mandatory.

### Test 1

Admin password correct but no OTP:

``` text
admin business API => 401/403
```

### Test 2

Admin password correct + invalid OTP:

``` text
admin business API => 401/403
```

### Test 3

Admin password correct + expired OTP:

``` text
admin business API => 401/403
```

### Test 4

Customer token:

``` text
shared customer API => existing behavior
```

### Test 5

Manufacturer token:

``` text
existing behavior
```

### Test 6

Marketing partner token:

``` text
existing behavior
```

### Test 7

Non-admin token must not be accepted as admin.

### Test 8

Admin pre-2FA token must not be accepted as final admin access.

### Test 9

Forged TFA token must fail.

### Test 10

Expired TFA token must fail.

### Test 11

TFA token for Account A must not work for Account B.

### Test 12

TFA token with wrong audience must fail.

### Test 13

TFA token with wrong issuer must fail.

### Test 14

Wrong token type must fail.

### Test 15

Changing client-side `role` must not change authorization.

### Test 16

Changing `targetPortal` after login must not bypass MFA.

### Test 17

Using customer/manufacturer/partner routes must not bypass admin MFA.

### Test 18

Calling admin business APIs directly without frontend UI must still
require MFA.

### Test 19

Reusing a consumed challenge must fail.

### Test 20

Concurrent OTP verification must allow only one successful consumption.

------------------------------------------------------------------------

# 44. Regression Tests for Existing Portals

Before declaring completion, verify:

``` text
ADMIN
CUSTOMER
MARKETING PARTNER
MANUFACTURER
```

login and core authenticated operations.

For non-admin portals, compare behavior before/after the change.

The expected requirement is:

``` text
No 2FA regression for non-admin portals.
```

------------------------------------------------------------------------

# 45. Shared API Classification

Before changing shared APIs, produce a table:

  -----------------------------------------------------------------------------------
  Endpoint   Public/Auth   Admin      Customer   Partner    Manufacturer   MFA
                                                                           Required
  ---------- ------------- ---------- ---------- ---------- -------------- ----------
  endpoint   ...           ...        ...        ...        ...            ...

  -----------------------------------------------------------------------------------

Do not blindly add an admin MFA requirement to every endpoint.

Use actual repository evidence.

If an endpoint has ambiguous authorization requirements, stop and ask
rather than guessing.

------------------------------------------------------------------------

# 46. Authentication State Machine

Document the state machine.

Recommended:

``` text
UNAUTHENTICATED
      |
      | password valid for ADMIN
      v
PASSWORD_VERIFIED
      |
      | challenge created
      v
MFA_PENDING
      |
      | OTP sent
      v
OTP_SENT
      |
      | valid OTP
      v
MFA_VERIFIED
      |
      v
AUTHENTICATED_ADMIN
```

Failure states:

``` text
PASSWORD_VERIFIED -> EXPIRED
MFA_PENDING -> EXPIRED
OTP_SENT -> LOCKED
OTP_SENT -> CANCELLED
```

Never allow:

``` text
PASSWORD_VERIFIED -> AUTHENTICATED_ADMIN
```

for admin accounts without MFA.

------------------------------------------------------------------------

# 47. Refresh Tokens

Inspect the existing refresh-token architecture.

If refresh tokens exist:

-   A password-only admin session must not be refreshable into a fully
    authenticated admin session.
-   An MFA-authenticated admin session should remain MFA-authenticated
    according to the session policy.
-   Revoked/disabled admin sessions must not silently regain access
    through refresh.
-   Do not introduce a refresh-token bypass.

Add tests specifically for this.

------------------------------------------------------------------------

# 48. Logout

Inspect existing logout.

If the architecture supports revocation, admin logout should
invalidate/revoke the authenticated admin session/TFA session as
appropriate.

Do not assume that deleting a frontend token alone is sufficient if the
backend maintains server-side session state.

------------------------------------------------------------------------

# 49. Observability

Add metrics using the existing observability stack.

Useful metrics:

``` text
admin_2fa_challenges_created
admin_2fa_otp_sent
admin_2fa_otp_send_failed
admin_2fa_verification_success
admin_2fa_verification_failure
admin_2fa_expired
admin_2fa_locked
admin_2fa_resend
notification_queue_latency
notification_dlq_count
```

Do not include OTP values or tokens in metric labels.

Do not use:

``` text
email
phone
OTP
JWT
account secret
```

as high-cardinality metric labels.

------------------------------------------------------------------------

# 50. Correlation IDs

If the application already uses request IDs/correlation IDs:

``` text
login request
    |
challenge
    |
notification
    |
RabbitMQ message
    |
SMS/email worker
    |
verification
```

should be traceable without logging secrets.

Reuse existing correlation infrastructure.

------------------------------------------------------------------------

# 51. Configuration Validation

At application startup, validate required environment variables.

For example:

``` text
OTP_SERVER_SECRET exists
JWT signing configuration exists
notification configuration exists
```

Fail fast for missing mandatory production secrets.

Do not print the secret values when validation fails.

------------------------------------------------------------------------

# 52. Production Security

For production:

-   HTTPS only
-   Secure cookies where cookies are used
-   appropriate SameSite policy
-   strict CORS
-   secure headers
-   rate limiting
-   secret management
-   no debug authentication output
-   no sensitive logging
-   database TLS where appropriate
-   RabbitMQ TLS/authentication where configured
-   provider credentials protected
-   audit logging
-   monitoring/alerts

Do not weaken production security for local development.

If local development requires HTTP, isolate that behavior in development
configuration only.

------------------------------------------------------------------------

# 53. Frontend Security

Do not expose:

``` text
OTP_SERVER_SECRET
JWT private key
SMS provider token
SMTP password
RabbitMQ credentials
backend encryption private keys
```

in the frontend bundle.

Only configuration intentionally designed for the public frontend may be
exposed.

------------------------------------------------------------------------

# 54. API Security

Never accept:

``` text
otp
```

through:

``` text
GET /verify?otp=123456
```

Use POST request bodies over HTTPS.

Do not put authentication secrets in URLs.

------------------------------------------------------------------------

# 55. Database Security

Use parameterized queries/ORM APIs.

Do not construct SQL with:

``` text
accountId
challengeId
email
phone
otp
```

concatenated into SQL.

Use the project's standard repository/ORM abstraction.

------------------------------------------------------------------------

# 56. Dependency Policy

Do not add a new package unless:

1.  the existing project cannot reasonably implement the requirement
    safely,
2.  the package is maintained and appropriate,
3.  the package has a compatible license,
4.  the security implications are documented,
5.  the package does not duplicate an existing project dependency.

Do not upgrade unrelated packages merely because the feature is being
implemented.

------------------------------------------------------------------------

# 57. Migration Safety

Database migrations must be:

-   reversible where the project supports rollback
-   idempotent according to existing migration conventions
-   indexed appropriately
-   safe for existing data
-   free of destructive changes unrelated to 2FA

Do not delete or rename unrelated tables/columns.

------------------------------------------------------------------------

# 58. Backward Compatibility

Do not break:

-   existing customer login
-   existing manufacturer login
-   existing partner login
-   existing public endpoints
-   existing business services
-   existing notification processing
-   existing RabbitMQ topology
-   existing email/SMS behavior
-   existing frontend navigation

Only the admin authentication flow should gain the additional step.

------------------------------------------------------------------------

# 59. API Error Contract

Reuse the application's existing error response structure.

Do not introduce inconsistent error formats unless necessary.

Example logical response:

``` json
{
  "success": false,
  "message": "Invalid or expired verification code."
}
```

Do not expose internal reasons.

------------------------------------------------------------------------

# 60. Documentation Required

Create/update documentation covering:

1.  Admin login flow
2.  2FA API contracts
3.  Environment variables
4.  Database migration
5.  Notification integration
6.  RabbitMQ flow
7.  Retry/DLQ behavior
8.  Token/session behavior
9.  Admin guard behavior
10. Shared API behavior
11. Security controls
12. Testing instructions
13. Rollback procedure
14. Future MFA extension strategy

------------------------------------------------------------------------

# 61. Future MFA Strategy

Design the abstraction so SMS/email OTP can later be supplemented or
replaced by stronger authenticators such as:

``` text
TOTP
WebAuthn
Passkeys
security keys
```

Do not tightly couple all authorization logic to:

``` text
method === SMS
```

Instead use a conceptual abstraction:

``` text
MFA challenge
MFA method
MFA verifier
MFA session
```

The current implementation can support:

``` text
SMS
EMAIL
```

without making future WebAuthn/TOTP impossible.

------------------------------------------------------------------------

# 62. Security Standard Baseline

Use these as implementation references:

-   OWASP Authentication Cheat Sheet
-   OWASP Multifactor Authentication Cheat Sheet
-   OWASP Session Management Cheat Sheet
-   NIST SP 800-63B
-   RFC 8725 --- JSON Web Token Best Current Practices

Important principles include:

-   short-lived OTPs
-   single-use OTPs
-   strict attempt limits
-   secure random generation
-   replay resistance
-   protected authentication channels
-   secure session management
-   explicit JWT validation
-   issuer/audience validation
-   separation of token types
-   phishing-resistant MFA as a future improvement

SMS/email OTP is weaker against phishing than WebAuthn/passkeys. This
implementation satisfies the requested current flow but should remain
extensible to stronger authenticators.

------------------------------------------------------------------------

# 63. Required Development Workflow

Do the work in these phases.

## Phase 0 --- Read-only architecture discovery

Inspect:

``` text
frontend
backend
database
ORM
authentication
JWT/session
authorization
middleware/guards
portal logic
notification service
RabbitMQ
email
SMS
environment configuration
tests
Docker/deployment
```

Do not modify files.

Produce:

``` text
architecture map
authentication flow
authorization flow
notification flow
database map
shared API map
security risks
2FA integration points
```

------------------------------------------------------------------------

## Phase 1 --- Security and threat model

Before coding:

1.  Define the admin authentication state machine.
2.  Define the 2FA challenge lifecycle.
3.  Define token/session model.
4.  Define admin guard behavior.
5.  Define shared API behavior.
6.  Define notification failure behavior.
7.  Define rate limits.
8.  Define database model.
9.  Define threat model.
10. Identify anything ambiguous.

If something is materially ambiguous or potentially destructive, stop
and ask.

------------------------------------------------------------------------

## Phase 2 --- Database

Implement:

-   migration
-   model/entity
-   repository
-   indexes
-   status lifecycle

Run migration tests.

------------------------------------------------------------------------

## Phase 3 --- OTP/2FA service

Implement:

-   secure OTP generation
-   protected OTP storage
-   challenge creation
-   expiry
-   attempts
-   resend
-   cancellation
-   verification
-   atomic consumption

Write unit tests.

------------------------------------------------------------------------

## Phase 4 --- Notification integration

Connect to the existing notification system.

Implement:

``` text
EMAIL
SMS
RabbitMQ
retry
DLQ
notification status
```

Do not duplicate provider integrations.

Test failure/retry behavior.

------------------------------------------------------------------------

## Phase 5 --- Admin login

Modify the existing login flow minimally.

Admin:

``` text
password correct
-> challenge
-> no privileged token
```

Non-admin:

``` text
existing behavior
```

Add regression tests.

------------------------------------------------------------------------

## Phase 6 --- OTP verification

Implement:

``` text
challenge + OTP
-> atomic verification
-> final authenticated admin session/token
```

Test token claims and security.

------------------------------------------------------------------------

## Phase 7 --- Authorization guard

Implement the central server-side enforcement.

Admin:

``` text
no MFA -> reject
MFA verified -> allow according to existing authorization
```

Non-admin:

``` text
existing authorization
```

Shared APIs:

``` text
evaluate actual authenticated principal
```

Test bypass attempts.

------------------------------------------------------------------------

## Phase 8 --- Frontend

Implement:

``` text
Admin login
    ->
2FA method selection
    ->
OTP entry
    ->
verification
    ->
admin application
```

Do not change other portal flows.

------------------------------------------------------------------------

## Phase 9 --- Full testing

Run:

``` text
unit tests
integration tests
security tests
regression tests
frontend tests
lint
typecheck
build
```

Fix failures before proceeding.

------------------------------------------------------------------------

## Phase 10 --- Security review

Perform a final review for:

``` text
authentication bypass
authorization bypass
OTP brute force
OTP replay
token replay
token substitution
JWT confusion
portal switching
shared API bypass
secret leakage
PII leakage
log leakage
notification leakage
race conditions
refresh-token bypass
frontend-only security
```

------------------------------------------------------------------------

# 64. Required Checkpoint Format

After each phase, report:

``` text
PHASE: <name>

Files inspected:
- ...

Files changed:
- ...

Why each file changed:
- ...

Security impact:
- ...

Business-layer changes:
- ...

Tests executed:
- ...

Results:
- ...

Remaining risks:
- ...

Next phase:
- ...
```

If a test fails because of an unrelated existing issue:

``` text
Do not hide it.
Do not silently modify unrelated business logic.
Report it clearly.
```

------------------------------------------------------------------------

# 65. Stop Conditions

STOP and ask for clarification if:

1.  Existing authentication architecture is unclear.
2.  A shared API has ambiguous authorization requirements.
3.  Adding 2FA requires changing unrelated business rules.
4.  Existing token behavior would make secure MFA impossible without a
    broader authentication redesign.
5.  Existing secrets are hardcoded and remediation could affect
    production credentials.
6.  A notification provider contract is unclear.
7.  A migration could destroy existing data.
8.  Existing frontend and backend contracts conflict in a way that
    cannot safely be resolved.
9.  A proposed shortcut would weaken authentication.
10. You are tempted to disable security checks to make tests pass.

Do not guess in these situations.

------------------------------------------------------------------------

# 66. Final Acceptance Criteria

The implementation is complete only when all are true.

### Authentication

-   [ ] Admin password authentication works.
-   [ ] Admin does not receive privileged access before OTP
    verification.
-   [ ] OTP is required for admin access.
-   [ ] Customer login still works.
-   [ ] Manufacturer login still works.
-   [ ] Marketing partner login still works.

### OTP

-   [ ] Cryptographically secure generation.
-   [ ] Configurable length.
-   [ ] Configurable expiration.
-   [ ] Single use.
-   [ ] Attempt limited.
-   [ ] Rate limited.
-   [ ] No plaintext storage.
-   [ ] No logs.
-   [ ] Resend invalidates old OTP.
-   [ ] Expired OTP fails.
-   [ ] Consumed OTP fails.

### Notification

-   [ ] Existing SMS infrastructure reused.
-   [ ] Existing email infrastructure reused.
-   [ ] RabbitMQ reused.
-   [ ] Retry behavior preserved.
-   [ ] DLQ behavior preserved.
-   [ ] No secrets hardcoded.
-   [ ] Notification failures do not create authentication bypasses.

### Authorization

-   [ ] Admin business APIs reject password-only sessions.
-   [ ] Admin APIs require valid MFA proof.
-   [ ] Shared APIs correctly distinguish roles.
-   [ ] Non-admin users are not forced through admin MFA.
-   [ ] Portal switching cannot bypass MFA.
-   [ ] Frontend cannot bypass backend enforcement.

### Tokens

-   [ ] Pre-2FA token cannot access business APIs.
-   [ ] Final admin token/session represents completed MFA.
-   [ ] Token types are separated.
-   [ ] Issuer validated.
-   [ ] Audience validated.
-   [ ] Signature validated.
-   [ ] Expiration validated.
-   [ ] Algorithm explicitly restricted.
-   [ ] Token replay risk is minimized.

### Data leakage

-   [ ] Password hashes are never returned.
-   [ ] OTP is never returned.
-   [ ] OTP is never logged.
-   [ ] JWT/TFA tokens are never logged.
-   [ ] Provider credentials are never returned.
-   [ ] Unrelated portal records are not returned.
-   [ ] Phone/email are masked where appropriate.

### Business layer

-   [ ] No unnecessary business-service rewrites.
-   [ ] No changes to unrelated business rules.
-   [ ] Existing functionality remains intact.

### Testing

-   [ ] Unit tests pass.
-   [ ] Integration tests pass.
-   [ ] Security tests pass.
-   [ ] Regression tests pass.
-   [ ] Frontend tests pass.
-   [ ] Lint passes.
-   [ ] Typecheck passes where applicable.
-   [ ] Build passes.

------------------------------------------------------------------------

# 67. Final Security Review Questions

Before declaring success, answer each question with evidence from the
code.

### Q1

Can an attacker obtain a fully privileged admin token with only the
correct password?

Expected:

``` text
NO
```

### Q2

Can an attacker call an admin business API directly after password
authentication but before OTP?

Expected:

``` text
NO
```

### Q3

Can a customer/manufacturer/partner bypass admin MFA using a shared API?

Expected:

``` text
NO
```

### Q4

Can an admin bypass MFA by changing `targetPortal`?

Expected:

``` text
NO
```

### Q5

Can an old OTP be reused?

Expected:

``` text
NO
```

### Q6

Can an attacker brute-force unlimited OTPs?

Expected:

``` text
NO
```

### Q7

Is the OTP stored in plaintext?

Expected:

``` text
NO
```

### Q8

Is the OTP written to logs?

Expected:

``` text
NO
```

### Q9

Can a pre-2FA token be used as an ordinary access token?

Expected:

``` text
NO
```

### Q10

Can an admin TFA token for Account A authenticate Account B?

Expected:

``` text
NO
```

### Q11

Can the browser choose an arbitrary phone/email destination?

Expected:

``` text
NO
```

### Q12

Can non-admin portals continue without 2FA?

Expected:

``` text
YES
```

### Q13

Does notification retry accidentally generate multiple valid OTPs?

Expected:

``` text
NO
```

### Q14

Does resend invalidate the previous OTP?

Expected:

``` text
YES
```

### Q15

Can a disabled admin continue indefinitely using an old session?

Expected:

``` text
NO
```

according to the application's session/account-status policy.

------------------------------------------------------------------------

# 68. Final Deliverables

At completion, provide:

``` text
1. Architecture discovery report
2. Threat model
3. Database migration
4. 2FA/authentication implementation
5. Notification integration
6. Admin authorization guard
7. Frontend admin 2FA flow
8. Unit tests
9. Integration tests
10. Security regression tests
11. Environment/config documentation
12. API documentation
13. Deployment notes
14. Rollback notes
15. Final security review
```

Also provide a concise final summary:

``` text
What changed
What did not change
Security controls added
Tests passed
Known limitations
Future improvements
```

------------------------------------------------------------------------

# 69. Important Security Limitation

SMS and email OTP are useful second-step authentication mechanisms, but
they are not the strongest available MFA methods.

They are susceptible to risks such as phishing, compromised email
accounts, and---in the case of SMS---SIM-swap/telephony attacks.

The current implementation should therefore be designed as an extensible
MFA layer so stronger methods such as:

``` text
TOTP
WebAuthn
Passkeys
FIDO2 security keys
```

can be added later without rewriting the authorization architecture.

For the current requirement, the critical security properties are:

``` text
password verification
+
server-controlled challenge
+
short-lived OTP
+
single-use OTP
+
strict attempt limits
+
rate limiting
+
secure notification delivery
+
server-side MFA enforcement
+
proper token/session validation
```

------------------------------------------------------------------------

# 70. Final Instruction to the Coding Agent

**Do not optimize for speed. Optimize for correctness, security,
maintainability, and zero regression of existing functionality.**

Read the repository first.

Understand the existing architecture.

Preserve existing conventions.

Make the smallest safe changes.

Keep authentication/2FA concerns in the authentication/security layer.

Reuse the existing notification infrastructure.

Do not expose secrets.

Do not expose password hashes.

Do not issue privileged admin access before MFA succeeds.

Do not trust frontend role/portal claims.

Do not rely on frontend-only route protection.

Do not allow shared APIs to become an MFA bypass.

Do not modify non-admin authentication behavior.

Do not silently change business logic.

Do not skip tests.

Do not hide failures.

Do not claim the implementation is secure without performing the final
security review.

If a requirement cannot be implemented safely without an architectural
decision, **stop and ask before changing it**.

------------------------------------------------------------------------

## Reference Standards

Use the latest applicable guidance from:

-   OWASP Authentication Cheat Sheet
-   OWASP Multifactor Authentication Cheat Sheet
-   OWASP Session Management Cheat Sheet
-   NIST SP 800-63B
-   RFC 8725 --- JSON Web Token Best Current Practices

The implementation should treat these as security baselines while
respecting the existing application's architecture and operational
constraints.
