# JWT Architecture and Security Design

## 1. Purpose

This document defines the advanced JWT design for the existing shared-backend commerce platform while preserving the current working RBAC, compatibility shims, and public webhook exemption.

The project already has a centralized auth layer, but the advanced session lifecycle still needs to be added:

- short-lived Access Token
- long-lived Refresh Token
- unique `jti` for each token
- token family / rotation tracking
- refresh-token reuse detection
- logout and revocation state
- secure secret management
- role-aware payload for RBAC
- backend-authenticated context enforcement

## 2. Current project fit

The current architecture is already organized in the MVC/service pattern:

- `backend/server.js` mounts all route groups
- `backend/routes/*` defines HTTP endpoints
- `backend/controllers/*` handles request flow
- `backend/services/*` contains business logic and DB orchestration
- `backend/middleware/*` provides auth and RBAC middleware
- `backend/prisma/schema.prisma` defines the authoritative DB model

This means the JWT architecture should be layered in centrally, not by rewriting the app.

## 3. Security principles

1. The backend remains the authoritative security boundary.
2. Public webhooks remain public and are intentionally exempt.
3. Existing RBAC remains authoritative and must continue to work.
4. Frontend route guards are UX only; backend enforcement is the real control.
5. Tokens must be short-lived, state-aware, and session-managed.
6. Token storage and validation must be fail-closed.

## 4. Token model

### 4.1 Access token

Use a short-lived access token for protected API requests.

Recommended config:

```env
JWT_ACCESS_SECRET=
JWT_ACCESS_TOKEN_EXPIRES_IN=5m
```

Purpose:

- client sends it in `Authorization: Bearer <token>`
- validates request auth for each protected endpoint
- carries minimal identity and role context

### 4.2 Refresh token

Use a separate refresh token only for obtaining new access/refresh token pairs.

Recommended config:

```env
JWT_REFRESH_SECRET=
JWT_REFRESH_TOKEN_EXPIRES_IN=15m
```

Purpose:

- used only at `/api/auth/refresh`
- never accepted as authorization for general API calls
- rotated on every successful refresh

## 5. JWT payload contract

The payload must include role and user detail enough for RBAC and portal context, while avoiding heavy or sensitive data.

### 5.1 Access token payload

```json
{
  "sub": "USER_OR_ACCOUNT_ID",
  "jti": "access-token-uuid",
  "role": "ADMIN",
  "token_type": "access",
  "accountId": "auth-account-id",
  "profileId": "user-or-admin-or-manufacturer-or-partner-id",
  "portalAccess": ["ADMIN"],
  "email": "user@example.com",
  "phone": "+9779800000000",
  "iss": "clothes-store-api",
  "aud": "clothes-store-clients",
  "iat": 1720000000,
  "exp": 1720000300
}
```

### 5.2 Refresh token payload

```json
{
  "sub": "USER_OR_ACCOUNT_ID",
  "jti": "refresh-token-uuid",
  "role": "ADMIN",
  "token_type": "refresh",
  "accountId": "auth-account-id",
  "profileId": "user-or-admin-or-manufacturer-or-partner-id",
  "token_family_id": "family-uuid",
  "iss": "clothes-store-api",
  "aud": "clothes-store-clients",
  "iat": 1720000000,
  "exp": 1720009000
}
```

Notes:

- `sub` stays as the stable user/account identity.
- `jti` identifies the exact issued token.
- `token_family_id` lets the system track a rotating refresh chain.
- Role and account details are present for RBAC decisions, but passwords or hashes are never included.

## 6. State model: token/session tracking

JWTs should be state-aware for logout and reuse detection. A dedicated table is required.

Recommended model:

```text
AuthSession
```

Fields:

- id
- accountId
- tokenFamilyId
- jti
- tokenType (ACCESS | REFRESH)
- issuedAt
- expiresAt
- revokedAt
- replacedByTokenId
- lastUsedAt
- createdIp
- lastUsedIp
- userAgent
- revocationReason
- createdAt
- updatedAt

Recommended constraints:

- unique `jti`
- index on `accountId`
- index on `tokenFamilyId`
- index on `tokenType` + `expiresAt`
- index on `revokedAt`

This is the state that makes logout, rotation, and reuse detection reliable.

## 7. Token family and rotation model

A family groups all refresh tokens generated from the same login session.

Example:

```text
Family F1:
R1 -> R2 -> R3 -> R4
```

Rules:

- every refresh token gets a new `jti`
- the replaced token is marked revoked
- `replacedByTokenId` is saved
- old refresh tokens are rejected once rotated
- reused revoked refresh tokens trigger security handling

This provides safe rotation without insecure re-use.

## 8. Refresh token flow

### Login

```text
POST /api/auth/login
  -> validate credentials
  -> load AuthAccount and role
  -> ensure account status is ACTIVE
  -> create token family
  -> create access token
  -> create refresh token
  -> persist session records atomically
  -> return tokens + user context
```

### Refresh

```text
POST /api/auth/refresh
  -> validate refresh JWT signature / issuer / audience
  -> verify token_type = refresh
  -> lookup jti in session store
  -> reject if session revoked or missing
  -> reject if reused or already rotated
  -> verify account still active
  -> revoke current refresh token
  -> issue new access + new refresh token
  -> persist new session atomically
  -> return new pair
```

### Logout

```text
POST /api/auth/logout
  -> identify current session
  -> revoke refresh token family or current session family
  -> mark `revokedAt`
  -> keep audit trail for forensic review
  -> reject old tokens on future validation
```

## 9. Refresh-token reuse detection

If a token is presented after it was already rotated, the backend must treat it as suspicious reuse.

Example:

```text
R1 issued
R2 replaces R1
R1 presented again
```

Expected handling:

- detect `replacedByTokenId` / revoked state
- invalidate the full token family
- log a security event
- reject the request with a 401 or 403 based on policy

This prevents replay and token-family compromise.

## 10. Authenticated request flow

Every protected API should follow this path:

```text
Request
 -> extract Bearer token
 -> verify signature
 -> verify issuer / audience
 -> verify expiration
 -> verify token_type = access
 -> resolve account identity
 -> validate account state
 -> attach authenticated req.auth context
 -> execute RBAC permission check
 -> controller logic
```

This is the enforcement boundary for all protected APIs.

## 11. Recommended middleware layer

The current project already has a strong foundation in:

- `backend/middleware/unifiedAuth.js`
- `backend/middleware/authorize.js`

The advanced design should extend this model rather than replace it.

Recommended responsibilities:

- `extractToken(req)`
- `verifyAccessToken(token)`
- `verifyRefreshToken(token)`
- `resolveAuthContext(decoded)`
- `attachAuthenticatedRequest(req, authContext)`
- `authorize(requiredPermission)`

This keeps the architecture consistent with the existing route middleware pattern.

## 12. 401 vs 403 policy

### 401

- missing token
- invalid token
- malformed token
- expired token
- wrong token type
- token reuse detection rejection
- revoked refresh token

### 403

- valid auth, insufficient permission
- valid auth, denied by RBAC
- valid auth, forbidden resource access

This aligns with the current project’s existing conventions and should remain consistent.

## 13. Role and RBAC payload requirements

The JWT payload should carry enough context to support RBAC without needing to re-query the database on every request.

However, it should not carry unbounded permission sets in the payload.

Recommended:

- `role`
- `accountId`
- `profileId`
- `portalAccess`
- `email`
- optional minimal profile metadata

Do not embed:

- password
- password hash
- OTP
- secrets
- huge arrays of all permissions

The permission check remains the source of truth via the RBAC service and permission mappings.

## 14. Role claim security

The JWT role should be treated as a hint, not alone as the final authority.

The system should validate:

- token account ID is real
- `AuthAccount.role` matches the token role
- account status is ACTIVE
- current mapped role set still authorizes the route

This prevents stale or forged role claims from becoming privilege escalators.

## 15. System integration with current project

### 15.1 Backend files to extend in the next iteration

Planned next iteration changes will be centered around:

- `backend/config/jwt.js` or equivalent config utility
- `backend/services/tokenService.js`
- `backend/services/sessionService.js`
- `backend/models/AuthSession` or Prisma model extension
- `backend/routes/authRoute.js` refresh/logout endpoints
- `backend/middleware/unifiedAuth.js` for state-aware validation
- `backend/middleware/authorize.js` for consistent permission calls

### 15.2 DB schema changes expected

A new Prisma model or migration will add support for:

- auth session tracking
- token family separation
- revoked token state
- token rotation metadata

This should be added through the existing Prisma migration flow, not via ad hoc scripts.

## 16. Frontend integration design

### Storage guidance

Recommended approach:

- Access token: in memory or short-lived client memory
- Refresh token: secure HTTP-only cookie where supported

If cookie cross-domain limitations require another approach, the team should evaluate:

- CORS
- same-site policy
- secure flag
- domain + subdomain behavior
- CSRF risk

Important: credentials should never be stored in frontend source code or plain localStorage when a safer option exists.

### Interceptor flow

The UX flow should be centralized:

```text
API request
 -> if 401 and token expired
 -> do one refresh attempt
 -> retry the original request once
 -> if refresh fails, clear auth state and redirect to login
```

This avoids loops and refresh storms.

## 17. Public webhook exception

Public webhook routes must remain publicly accessible.

The current design should keep:

- `/webhooks/*`
- `/api/ncm-webhook`
- `/api/delivery/webhook/*`

outside the JWT auth middleware and outside any permission gate.

This remains untouched until the user explicitly wants it changed.

## 18. Recommended implementation sequence for the next iteration

The next actual coding phase should happen only after design approval and should follow this order:

1. add environment-based JWT config validation
2. define token/session model and migration
3. implement token generation and verification service
4. add refresh-token rotation flow
5. add logout and revoke-state support
6. integrate on the auth route layer
7. convert middleware to state-aware token validation
8. verify with unit/integration tests

This is the correct next step and matches the iterative prompt.

## 19. Final architecture decision

The system should not be rewritten. It should evolve by layering advanced JWT session state onto the current centralized auth + RBAC architecture.

The recommended final state is:

```text
Current role-based auth + RBAC
 + advanced JWT session lifecycle
 + refresh-token rotation
 + revoke-aware validation
 + jti tracking
 + token family reuse protection
```

This preserves the existing working project while meeting the advanced JWT implementation requirements.
