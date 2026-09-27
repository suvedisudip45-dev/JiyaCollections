# Portal 2FA Extension: Discovery and Iteration Plan

## Scope and status

Extend the existing Admin login verification to Marketing Partner and Manufacturer. Customer authentication and the Customer frontend are explicitly excluded. Changes stay within authentication, sessions, middleware, notifications, and portal login UI; product, order, inventory, payment, and other business behavior is out of scope.

Discovery is complete. No runtime implementation was changed during discovery. The worktree already contains a substantial uncommitted Admin 2FA implementation; preserve and build on it rather than replacing or reverting it.

## 1. Current authentication flow

All four portals call `POST /api/auth/login` with an encrypted `targetPortal` and password. `authenticateAccount` loads the `AuthAccount`, verifies its password and active state, and checks the requested portal against the account's database role. This server-side role check blocks portal switching.

After password verification, Admin alone returns `requiresTwoFactor` without a session. Marketing Partner, Manufacturer, and Customer currently proceed directly to an access/refresh token pair. Login responses are serialized through `authDto.js`.

## 2. Current Admin 2FA flow

The login controller creates an Admin challenge after `authenticateAccount` returns `requiresTwoFactor`. `/api/auth/admin/2fa/send` queues an SMS/email notification; `/api/auth/admin/2fa/verify` consumes the challenge and creates the normal token pair. Refresh cookies are set only after successful verification.

The service binds challenges to account, `targetPortal=ADMIN`, and `purpose=ADMIN_LOGIN`. It HMACs OTPs with `OTP_SERVER_SECRET`, uses timing-safe comparison, checks expiry and attempt limits, conditionally consumes the challenge in a transaction, and creates MFA-marked sessions. Notification content is encrypted before persistence and the consumer cancels delivery for inactive challenges.

Critical defect: the current `generateOtp` returns the constant `111111`; a commented cryptographic generator is not active. Existing service tests pass but do not check OTP unpredictability. The current UI is Admin-specific and has a single input, no resend action, and no expiry countdown.

## 3. Existing reusable components

- `AuthAccount` is the common identity and the role is resolved from the database.
- `AdminTwoFactorChallenge` already stores `targetPortal`, `purpose`, attempts, status, resend count, expiry, request metadata, and notification linkage.
- `portalTwoFactorService.js` contains the shared challenge, OTP hash, queue, verification, session issuance, and audit lifecycle.
- The notification service, encrypted payload helper, outbox, RabbitMQ consumer, and SMS/email providers are reusable.
- `createLoginTokenPair`, refresh-token rotation, JWT signing, and `unifiedAuth` are shared session/security boundaries.

No separate Marketing or Manufacturer OTP service/table is warranted by the discovered architecture. Initially retain the existing physical challenge table and rows; `targetPortal` is already present, so a rename migration is unnecessary for behavior and would add risk.

## 4. Admin-specific assumptions to generalize

The service name, config/error labels, account-role checks, challenge portal/purpose, notification type/template/idempotency key, audit actions, and verification include (`adminProfile`) are Admin-specific. The login controller exposes Admin-only endpoints. The token helper/guard and refresh logic require MFA only for Admin. The notification consumer recognizes only `ADMIN_2FA`. The Admin login UI calls those Admin-only endpoints.

Generalize these at the security/authentication boundary with a small trusted portal policy (`ADMIN`, `MARKETING_PARTNER`, `MANUFACTURER` require MFA; `CUSTOMER` does not). Do not accept portal or identity claims supplied during OTP verification as authoritative; derive account and portal from the stored challenge.

## 5-7. Integration points and Customer exclusion

- Marketing: shared backend login is called from `marketing/src/api/auth.js`; `marketing/src/auth/AuthContext.jsx` currently stores the login response token and immediately fetches the partner profile. Add a pending challenge state so no token/profile request occurs before OTP verification.
- Manufacturer: `manufacturer/src/pages/Login.jsx` calls shared login and stores a token immediately. Add a pending verification state in the login screen; preserve its registration flow.
- Customer: `frontend/src/pages/Login.jsx` explicitly requests `targetPortal=CUSTOMER`. Keep its frontend, token storage, and API interceptor unchanged. The backend MFA policy must explicitly return false for Customer and all policy checks must be scoped to MFA-required roles.

## 8. Token/session architecture

Access and refresh tokens use separate secrets and explicit `HS256`, issuer, audience, and token-type validation. Each token is persisted as an `AuthSession`; refresh rotation checks the account and portal. MFA claims (`mfa_verified`, `amr`) are emitted by the shared token service after challenge verification. Existing refresh and access middleware currently enforce those claims for Admin only; extend both checks to the centralized MFA policy and preserve role/portal binding. The frontend portals use separate refresh-cookie portal values and local access-token storage.

## 9. Shared API classification (representative routes)

| Endpoint | Principal / portal | Current authorization | MFA policy |
| --- | --- | --- | --- |
| `POST /api/auth/login` | Account resolved by credentials and requested portal | Database role must match requested portal | Password success for Admin/Marketing Partner/Manufacturer creates only a pending challenge; Customer remains direct login |
| `POST /api/auth/refresh` | Refresh cookie plus requested portal | Refresh role must match token role; session rotates | Require MFA for the three privileged roles; no new Customer requirement |
| `GET /api/auth/me` | Authenticated session | `unifiedAuth` | Require MFA by role policy; Customer unchanged |
| `GET /api/manufacturer/profile` | Manufacturer/Admin | `authenticate`, permission, manufacturer context | Require MFA for Manufacturer/Admin |
| `GET /api/marketing-cards/partner/profile` | Marketing Partner/Admin | `authenticate`, permission/context | Require MFA for Marketing Partner/Admin |
| `POST /api/cart/get`, `POST /api/review/add` | Customer | `authenticate` and permission | No MFA requirement |

The inspected protected business routes predominantly use `unifiedAuth` and RBAC. Legacy `marketingPartnerAuth.js` and `manufacturerAuth.js` exist but have no references in the backend route tree found during discovery; do not introduce them as alternate MFA enforcement paths. Complete automated route authorization tests before release, especially for shared endpoints.

## 10. Notification architecture

The existing notification service persists notification/event/outbox data transactionally; RabbitMQ workers deliver SMS or email with retry and DLQ handling. OTP content is encrypted for storage. The consumer currently checks active challenge state only for `notificationType=ADMIN_2FA`; generalize that check to the shared login-2FA event and bind notification metadata to the stored challenge, never to authorization. Do not create a second queue/provider system.

## 11. Database and migration impact

The current Prisma challenge model already has portal/purpose fields, status lifecycle, attempts, resend count, expiry, notification reference, and account/index support. Its migration is present in the current uncommitted worktree. Prefer reusing it without destructive table changes; preserve existing Admin records and their default portal/purpose. Any later index or schema migration must be additive and tested against the existing table. Database migration application remains an explicit deployment gate.

## 12. Security risks

- Fixed Admin OTP `111111` is critical and must be fixed before claiming any portal MFA secure.
- The current challenge service supports first delivery but no user resend lifecycle; resend must invalidate old OTP atomically, rotate hash/expiry, enforce cooldown and limits, and keep queue retries on the same notification/OTP.
- The Admin service tests do not assert randomness, role/portal isolation, or Customer exclusion.
- Shared login, refresh, `unifiedAuth`, and old/legacy auth middleware need consistent MFA enforcement; a frontend-only gate is insufficient.
- Existing login response and error handling must not expose OTPs, hashes, tokens, password material, or unmasked contact details.
- A rollback to the current backend would restore password-only Marketing/Manufacturer access. Do not remove persisted challenge data; rollback must be coordinated and its temporary MFA downgrade explicitly approved.

## 13. Test plan

Use isolated service/controller tests and mocked Prisma/notification dependencies first. Cover Admin compatibility, privileged password-only login returning no access/refresh token, valid OTP session creation, invalid/expired/replayed/locked OTP, atomic concurrent consumption, resend invalidation/cooldown, portal mismatch, refresh bypass, disabled accounts, and notification retries. Add middleware tests proving each privileged role requires `pwd+otp` and Customer does not. Verify Customer login/API/UI do not call 2FA endpoints. Run backend focused tests, frontend lint/build for changed portals, then broader regression suites and a final diff/security review. `backend/tests/authIntegration.test.js` uses a real database and seeded credentials; do not run destructive or environment-dependent integration checks without confirming their database target.

## 14. Iteration and rollback plan

1. **Iteration 0: Discovery (complete).** Record architecture and risks; no implementation changes.
2. **Iteration 1: Secure reusable core.** Fix cryptographic OTP generation; generalize service/notification/challenge bindings without changing portal integrations; retain Admin behavior and verify focused tests.
3. **Iteration 2: Backend policy and endpoints.** Route all three privileged roles through challenge-only password success; add generic send/verify/resend routes; enforce role-scoped MFA in access and refresh boundaries; keep Customer unchanged.
4. **Iteration 3: Marketing Partner.** Add pending challenge UI and OTP verification; persist tokens only after server verification.
5. **Iteration 4: Manufacturer.** Add the same shared challenge flow to login without changing registration or business behavior.
6. **Iteration 5: Shared OTP UX and regression.** Reuse an OTP view where project boundaries permit; add method choice, accessible six-digit/paste entry, expiry countdown, resend cooldown and error/loading states. Verify Customer exclusion and all cross-portal cases.
7. **Iteration 6: Security/release review.** Run focused/full checks available, inspect migrations and diff, document deployment/configuration and rollback limits.

Each implementation iteration must report changed files, tests/results, regression status for Admin/Marketing/Manufacturer/Customer, risks, and next step. Stop on a critical security regression or an unresolved portal/identity source of truth. Rollback must preserve challenge rows and avoid a destructive migration; a backend rollback that disables MFA for Marketing/Manufacturer is a security downgrade and must not be treated as routine.

## Implemented checkpoint

- **Iteration 1: Secure reusable core: complete.** Fixed OTP generation with `crypto.randomInt`; retained HMAC storage, timing-safe verification, attempt limits, and atomic one-time consumption. Generalized challenge service and notification validation to Admin, Marketing Partner, and Manufacturer; retained legacy Admin endpoints and persisted Admin purpose values.
- **Iteration 2: Backend policy and lifecycle: complete.** Central role policy now gates login, refresh, and `unifiedAuth`; added shared send/verify/resend routes, cooldown/max-resend enforcement, old-code invalidation, replacement notification cancellation, and Admin-only compatibility wrappers.
- **Iteration 3: Portal login UX: complete.** Marketing, Manufacturer, and Admin login surfaces now wait for OTP before storing a session and show masked destination, expiry countdown, resend cooldown, and loading/error state.
- **Customer: excluded.** No Customer frontend file was edited. The shared login and API guard policy explicitly excludes `CUSTOMER`.
- **Database: no schema edit in this extension.** Reuses the current `AdminTwoFactorChallenge` model and its `targetPortal`/purpose fields. The existing migration in the worktree is untracked and must be included/applied as part of the deployment.

## API and deployment notes

For `ADMIN`, `MARKETING_PARTNER`, and `MANUFACTURER`, password success returns a challenge response with `requiresTwoFactor`, `challengeId`, `portal`, `codeLength`, available methods, and masked contact destinations. It does not set a refresh cookie or return an access/refresh token. `CUSTOMER` keeps the current direct login response.

- `POST /api/auth/2fa/send` accepts `{ "challengeId": "...", "method": "SMS" | "EMAIL" }`.
- `POST /api/auth/2fa/resend` accepts `{ "challengeId": "..." }` and returns server-calculated `expiresAt` and `resendAvailableAt` timestamps.
- `POST /api/auth/2fa/verify` accepts `{ "challengeId": "...", "otp": "..." }`; portal and account are taken from the stored challenge, not the request.
- Legacy `POST /api/auth/admin/2fa/send` and `/api/auth/admin/2fa/verify` remain available for Admin compatibility.

Configuration: `OTP_SERVER_SECRET` must be a server-side random secret with at least 32 characters. `OTP_LENGTH` defaults to 6 (allowed 6-8); `OTP_EXPIRY_MINUTES` defaults to 5; `OTP_MAX_ATTEMPTS` defaults to 5; `OTP_MAX_CHALLENGES_PER_WINDOW` defaults to 5; `OTP_CHALLENGE_WINDOW_MINUTES` defaults to 10; `OTP_MAX_RESENDS` defaults to 3; `OTP_RESEND_COOLDOWN_SECONDS` defaults to 30. SMS/email delivery additionally requires the existing notification, RabbitMQ, and provider configuration. A queued notification means accepted by the notification pipeline, not guaranteed delivery to a handset/inbox.

Deployment must apply the existing additive challenge migration before enabling the updated backend, set the OTP secret and provider configuration through secret management, then deploy backend and all three privileged portal frontends in a coordinated window. Backend-first deployment can temporarily interrupt portal login until matching frontends are deployed, but it cannot issue password-only privileged sessions. Smoke-test OTP delivery/verification and Customer login/API access after rollout. Preserve the challenge table and rows on rollback; reverting backend enforcement would reopen password-only privileged access and requires explicit security approval.

## Verification checkpoint

- Final focused backend suites: 28 passed, 0 failed across reusable 2FA, authorization, notification reliability/providers, and auth contracts. This includes refresh-bypass, OTP non-constant, and legacy Admin route-isolation checks.
- Marketing, Manufacturer, and Admin production builds passed after the final UI changes. Manufacturer and Admin emitted existing chunk-size warnings.
- Scoped lint completed with zero errors. Existing warnings remain in Marketing Fast Refresh and Manufacturer imports/registration hooks; the introduced render-time clock warning was removed.
- Database-backed `authHardening.test.js` and `authIntegration.test.js` were updated but not run because they create/delete records and depend on a seeded database target. No migration was applied.
- Browser/E2E verification and live SMS/email delivery were not run in this environment.

## Baseline check

`node --test backend/tests/adminTwoFactorService.test.js`: 3 passed, 0 failed. This confirms challenge verification and single-use behavior only; it does not validate OTP unpredictability or portal reuse.