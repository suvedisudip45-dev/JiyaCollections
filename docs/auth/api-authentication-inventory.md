# API Authentication Inventory

## Public endpoints

These are intentionally public or unauthenticated for access or external integration:

- `/api/auth/login`
- `/api/auth/otp/request`
- `/api/auth/otp/verify`
- `/api/user/register` or equivalent registration APIs if present in the current route file
- `/webhooks/*`
- `/api/ncm-webhook`

## Authenticated endpoints

These depend on `authenticate` middleware:

- `/api/auth/me`
- `/api/auth/logout`
- `/api/auth/change-password`
- all `/api/*` routes that are not explicitly public

## Permission-protected endpoints

These are behind `authenticate` + `authorize("permission:code")` patterns:

- `/api/order/*`
- `/api/product/*`
- `/api/cart/*`
- `/api/loyalty/*`
- `/api/customer/*`
- `/api/manufacturer/*`
- `/api/assignment/*`
- `/api/finance/*`
- `/api/accounting/*`
- `/api/marketing-cards/*`
- `/api/delivery/*` for admin/manufacturer/customer flows

## Webhook exception

The following routes are intentionally public and should remain public until further instructions:

- `/webhooks`
- `/webhooks/*`
- `/api/ncm-webhook`
- `/api/delivery/webhook/*`

## Current enforcement model

The backend uses a fail-closed model:

- missing token ⇒ 401
- invalid token / expired token ⇒ 401
- authenticated identity without proper permission ⇒ 403
- no route bypass is allowed for protected APIs

This should remain unchanged while implementing the next advanced JWT lifecycle iteration.
