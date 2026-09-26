# API Authentication Inventory

## Public endpoints

These are intentionally public or unauthenticated for access or external integration:

- `/api/auth/login`
- `/api/auth/refresh` (refresh JWT is validated by the endpoint itself)
- `/api/auth/otp/request`
- `/api/auth/otp/verify`
- `/api/user/register`
- `/api/user/login` and `/api/user/admin` legacy login compatibility endpoints
- `/api/user/social/validate`
- `/api/user/social/activate`
- `/api/manufacturer/login`
- `/api/manufacturer/register` self-registration endpoint
- `/api/manufacturer/branches` branch catalog endpoint
- `/api/marketing-cards/locations`
- `/api/marketing-cards/partner/login`
- `/api/marketing-cards/partner/signup`
- public catalog/read endpoints such as product, category, subcategory, color, offer, review, shipping, and loyalty-level reads
- `/webhooks/*`
- `/api/ncm-webhook`

## Authenticated-only endpoints

These require a valid access token and session, but do not require a separate business permission:

- `/api/auth/me`
- `/api/auth/logout`
- `/api/auth/change-password`

## Permission-protected endpoints

Sensitive business APIs are behind `authenticate` + `authorize("permission:code")` patterns:

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
- `/api/user/profile*`, customer password, and address operations
- product/category/subcategory/color mutations
- offer, shipping, expense, COGS, returns, and accounting mutations/reports
- story-letter administration

The permission code is resolved from active `AuthAccountRoleMapping` and `RolePermissionMapping` records. A missing token/session returns `401`; an authenticated account without the required active permission returns `403`.

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
