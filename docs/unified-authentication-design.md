# Unified Authentication Design Specification

## 1. Scope & Goals
- Centralize all identity and credential management into a unified `Account` model.
- Unify login endpoints into `POST /api/auth/login`.
- Provide role-based access control (RBAC) and portal access authorization across Customer, Admin, Manufacturer, and Marketing Partner portals.
- Provide OTP challenge lifecycle modeling and abstractions.
- Preserve domain relations (Orders, Products, Campaigns, Inventory, Financials) without breaking existing business logic.

## 2. Authentication Protocol

### 2.1 Password Flow (AES-256-CBC Supported)
1. Client sends email/phone, an AES-encrypted password (`encryptedPassword`), and an AES-encrypted `targetPortal` over HTTPS. The shared AES key and IV come from frontend/backend environment configuration; the login request does not carry an IV.
2. Server decrypts (if encrypted), normalizes identifier (lowercase email or normalized 10-digit Nepal mobile number).
3. Server looks up `Account` by identifier.
4. Server checks account lockout (`accountLockedUntil`). If locked, returns standardized error and logs `ACCOUNT_LOCKED`.
5. Server compares password hash using `bcrypt` (cost 10).
6. On failure: increments `failedLoginAttempts`, locks account if attempts >= 5, logs `LOGIN_FAILED`, and returns generic error `"Invalid email or password"`.
7. On success: resets `failedLoginAttempts`, updates `lastLoginAt`, records `LOGIN_SUCCESS` in `AuthAuditLog`, and generates a standardized signed JWT token.

### 2.2 Standardized JWT Payload
```json
{
  "accountId": "uuid-v4",
  "profileId": "uuid-v4",
  "role": "CUSTOMER | ADMIN | MANUFACTURER | MARKETING_PARTNER",
  "email": "user@example.com",
  "portalAccess": ["CUSTOMER"],
  "iat": 1740000000,
  "exp": 1740604800
}
```

## 3. Authorization & Portal Enforcement

Backend middleware strictly validates role:
- `requireRole('CUSTOMER')`
- `requireRole('ADMIN')`
- `requireRole('MANUFACTURER')`
- `requireRole('MARKETING_PARTNER')`

Tokens are validated via `Authorization: Bearer <token>` or `token: <token>` headers.
