# ITERATION REPORT

## Iteration

14

## Status

Completed frontend JWT authentication integration across all four portals.

## Backend contract used

- Login: `POST /api/auth/login` with `targetPortal`.
- Login response: `accessToken`, `refreshToken`, and legacy `token`.
- Refresh: `POST /api/auth/refresh` with `{ refreshToken }`.
- Protected requests: `Authorization: Bearer <accessToken>` plus legacy `token` compatibility header.
- Logout: authenticated `POST /api/auth/logout`, which revokes the token family.
- Server-side 401 and 403 responses remain authoritative.

## Frontend changes

- Customer, admin, manufacturer, and marketing logins now use the unified auth endpoint with the correct portal target.
- Added portal-local access/refresh token storage adapters.
- Added Axios request interceptors that attach Bearer and legacy token headers.
- Added one-attempt refresh-and-retry behavior for expired access tokens.
- Added server-backed logout for all four portals.
- Preserved existing local token keys and legacy response compatibility where required.
- Preserved public registration, onboarding, catalog, and webhook flows.

## Security boundary

Refresh tokens remain in browser storage during this iteration because the existing architecture is local-storage based. HttpOnly Secure SameSite refresh cookies remain a future hardening option where deployment and CORS configuration permit.

Refresh concurrency coordination is intentionally deferred to Iteration 15; the current interceptor prevents infinite retry loops but does not yet share one refresh promise across simultaneous 401 responses.

## Validation

- Customer production build: passed.
- Admin production build: passed.
- Manufacturer production build: passed.
- Marketing production build: passed.
- Existing backend JWT/RBAC/portal tests remain green in prior validation.

## Known limitations

Full browser login/refresh/logout verification requires the backend database to contain the application tables and seeded accounts. The current configured database is missing those tables.

## Next iteration

Iteration 15: refresh concurrency coordination and single-flight retry handling.

==================================================
STOP AND WAIT FOR APPROVAL
==================================================
