# ITERATION REPORT

## Iteration

13

## Status

Completed centralized resource identity and ownership hardening.

## Architecture review

Resource authorization is layered after authentication and permissions:

```text
JWT + AuthSession
  -> AuthAccount identity
  -> role-specific profile binding
  -> portal context / permission
  -> controller or resource service ownership checks
```

Existing customer, manufacturer, and marketing-card services already contain resource-specific ownership checks. The remaining centralized gap was that `profileId` was trusted after `accountId` and role validation without confirming that the profile belonged to the account.

## Changes

- `authenticate()` now loads the role-specific profile relation from `AuthAccount`.
- A token with a valid account but mismatched customer/admin/manufacturer/partner profile is rejected with `401 INVALID_PROFILE_OWNER`.
- Account-ID fallback profiles remain compatible when no role-specific profile exists.
- Existing provider context guards and server-derived IDs remain unchanged.
- Public webhooks remain unprotected.

## Regression coverage

Added a database-backed regression case for a valid account paired with a forged profile ID. Existing provider ownership and portal-boundary tests remain green.

## Validation

- Provider escalation tests: 3 passed.
- RBAC tests: 3 passed.
- JWT tests: 3 passed.
- Prisma schema validation: passed.
- Syntax checks and editor diagnostics: passed.
- Database-backed auth ownership suite: blocked because the configured database lacks the `admin` and `authaccount` tables.

## Known limitation

Full customer/manufacturer/partner resource tests require the application schema and seeded data to be applied to the configured database.

## Next iteration

Iteration 14: frontend authentication integration across customer, manufacturer, admin, and marketing portals.

==================================================
STOP AND WAIT FOR APPROVAL
==================================================
