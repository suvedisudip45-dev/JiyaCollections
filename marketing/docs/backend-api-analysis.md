# Marketing Partner Backend API Analysis

## Scope inspected

- backend/routes/marketingCardRoute.js
- backend/controllers/marketingPartnerController.js
- backend/services/marketingPartnerService.js
- backend/middleware/marketingPartnerAuth.js
- backend/services/marketingCardService.js
- backend/server.js
- backend/config/cors.js
- admin/src/App.jsx
- manufacturer/src/App.jsx
- marketing/src/auth/AuthContext.jsx
- marketing/src/api/client.js

## Authentication

- The backend authenticates marketing partners through the marketing-card router and a JWT stored in the `token` header.
- Middleware: `backend/middleware/marketingPartnerAuth.js`
- JWT payload contains:
  - `role: "marketing_partner"`
  - `partnerId`
- Login endpoint: `POST /api/marketing-cards/partner/login`
- Supported login fields:
  - `email`
  - `password` or AES-encrypted credentials (`encryptedPassword` + `iv`)
- On success, the API returns:
  - `token`
  - `partner`: `{ id, code, name, email, status }`
- The backend checks `status === "ACTIVE"` before login is allowed.
- There is no public signup flow for marketing partners in the current backend; the current project uses backend-managed partner creation and admin onboarding.

## Authorization / RBAC

- Authorization is enforced primarily on the server, not in the frontend.
- The auth middleware authenticates the user and sets `req.partnerId` from the JWT.
- All partner-scoped services use `WHERE marketingPartnerId = partnerId` or `WHERE partnerId = partnerId` to prevent cross-partner reads.
- Examples:
  - `getPartnerCampaignDetail({ partnerId, campaignId })`
  - `getPartnerCardDetail({ partnerId, cardId })`
  - `validatePartnerQr({ partnerId, cardCode })`
- The backend treats URL IDs and body IDs as untrusted for ownership; it re-checks ownership in the database.
- The current role model is a direct `marketing_partner` role with no separate marketing partner permission matrix in the app layer.

## Marketing partner APIs

### Partner profile
- `GET /api/marketing-cards/partner/profile`
- `PUT /api/marketing-cards/partner/profile`
- `POST /api/marketing-cards/partner/change-password`

### Campaign APIs
- `GET /api/marketing-cards/partner/campaigns`
- `GET /api/marketing-cards/partner/campaigns/:id`
- Returns campaigns scoped to the logged-in partner and includes campaign metadata plus counts and benefit list.

### Card APIs
- `GET /api/marketing-cards/partner/cards`
- `GET /api/marketing-cards/partner/cards/:id`
- Supports filtering by `campaignId`, `status`, `page`, and `limit`.
- `getPartnerCards` and `getPartnerCardDetail` are partner-scoped and omit raw QR token content.

### Card assignment APIs
- Admin and manufacturer flows exist separately under the same router, not under partner routes.
- Partner app should not assume it can assign cards; it only reads partner-owned card state.

### Benefit APIs
- `POST /api/marketing-cards/partner/redemptions/redeem`
- `GET /api/marketing-cards/partner/redemptions`
- Benefit redemption is validated against the card’s campaign and active benefit list.
- Duplicate redemption is rejected by checking for an existing `REDEEMED` record.

### Redemption APIs
- `GET /api/marketing-cards/partner/redemptions`
- `POST /api/marketing-cards/partner/redemptions/redeem`

### QR APIs
- `POST /api/marketing-cards/partner/qr/validate`
- Validates card code against the partner’s ownership and current card state.
- Response includes `valid`, `genuine`, and benefit state without exposing raw QR or secret data.

### Analytics APIs
- `GET /api/marketing-cards/partner/metrics`
- Returns campaign count, card totals, physical status distribution, activated cards, and redeemed benefits.

### Geographic APIs
- Geography is attached to campaigns and card records via `targetScopeType`, `targetProvince`, and `targetDistrict`.
- No separate geographic API exists; the frontend should consume the geography fields embedded in campaign/card responses.

### Profile/account APIs
- Partner profile, password change, and current account retrieval are supported.
- No dedicated email verification or reset flows are currently implemented for marketing partners.

## Existing validation

Backend validation patterns currently include:
- required email / password checks in login
- required `cardCode` and `benefitId` checks before redemption
- ownership checks through partner-scoped `findFirst` queries
- invalid-token handling in `marketingPartnerAuth`
- duplicate redemption prevention
- status checks on partner and benefit state

## Existing pagination/filtering

- Partner list/card APIs use `page` and `limit` query params.
- Campaign filter supports `status`.
- Card filter supports `campaignId`, `status`, `page`, and `limit`.
- Redemption filter supports `campaignId`, `status`, `page`, and `limit`.
- The project currently prefers server-side pagination over client-side pagination.

## Existing API error format

Responses generally follow a consistent structure:

```json
{
  "success": false,
  "message": "Human-readable message",
  "code": "PARTNER_ERROR" | "INVALID_INPUT" | "PARTNER_FORBIDDEN"
}
```

For successful operations, the backend commonly returns:

```json
{
  "success": true,
  "...": "resource data"
}
```

## Existing frontend conventions

- `admin` and `manufacturer` apps rely on `BrowserRouter`, `Routes`, and route-level auth checks.
- The project uses `localStorage` for token persistence; the marketing app follows the same pattern.
- UI styling uses Tailwind utility classes and a light neutral palette with brand teal/green accents.
- `react-toastify` is used for user messaging, and the design pattern is side navigation + top header + content workspace.
- Error handling is centralized in `marketing/src/api/client.js` and the frontend uses `getErrorMessage` to avoid leaking backend stack traces.
- Layout conventions are simple and production focused, not decorative.

## Security requirements

- Backend must remain authoritative for ownership and campaign/card validation.
- The frontend must never trust URL params or client state as proof of ownership.
- QR validation must be backend-validated and should never expose raw QR secrets.
- JWTs are passed as a bearer-like `token` header; the frontend should treat this as sensitive and avoid logging it.
- The backend is currently the source of truth for role/authorization checks; the portal should surface permission-aware UX but not assume it is the security enforcement layer.

## Integration risks

- Some marketing portal requirements refer to flows that are not implemented in the backend yet, such as signup, forgot password, reset password, and email verification.
- The backend organizes everything under the same `marketing-cards` router, so the frontend must stick to that API surface rather than inventing separate endpoints.
- The app should avoid assuming geography or analytics are available as separate APIs; these values are often embedded in campaign and card records.
- Frontend route protection should be paired with backend ownership checks because the portal could otherwise disclose data by URL manipulation.
- The `marketingPartnerAuth` middleware writes to `req.body.partnerId` as a fallback, which is acceptable for this codebase but should not be treated as a trust boundary.

## Current gap assessment

The repository already has a meaningful foundation for the marketing portal:
- protected routing
- partner auth middleware and login flow
- partner-scoped metrics and card reads
- QR validation endpoint
- redemption flow
- campaign/card/detail retrieval

The remaining product-level work is mainly around UX polish, form coverage, and ensuring the app strictly matches the backend contract rather than adding unsupported routes or flows.

## Recommended implementation direction

- Build the marketing portal around existing backend routes only.
- Keep partner ownership checks server-side.
- Reuse the Tailwind + route pattern already present in the admin and manufacturer apps.
- Prefer backend-filtered pagination and analytics responses over frontend reconstruction.
- Keep QR validation as an authenticated partner-only action with a manual fallback and no raw token exposure.
