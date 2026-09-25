# ITERATION REPORT

## Iteration

15

## Status

Completed frontend refresh concurrency coordination.

## Behavior

Each portal now uses a single-flight refresh promise:

```text
Multiple protected requests
  -> concurrent 401 responses
  -> one POST /api/auth/refresh
  -> all waiting requests receive the new access token
  -> each original request retries once
```

The interceptor rejects refresh failures, clears local credentials, and redirects to the portal login route. Login and refresh requests are excluded from automatic refresh handling, preventing loops and stale-session interference with login errors.

## Portals updated

- Customer portal
- Admin portal
- Manufacturer portal
- Marketing partner portal

## Security and compatibility

- Refresh tokens remain portal-scoped in local storage under separate keys.
- Requests continue sending `Authorization: Bearer` and the legacy `token` header.
- Backend token rotation and family reuse detection remain authoritative.
- Public webhooks are unaffected.

## Validation

- Customer production build: passed.
- Admin production build: passed.
- Manufacturer production build: passed.
- Marketing production build: passed.
- Interceptor diagnostics: no errors.

## Known limitation

Browser-level concurrent 401 testing requires a running backend with the application schema and seeded accounts. The configured database currently lacks the application tables.

## Next iteration

Iteration 16: dedicated security hardening review across backend and frontend token handling.

==================================================
STOP AND WAIT FOR APPROVAL
==================================================
