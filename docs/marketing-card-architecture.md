# Marketing Cards — Current Promotional Feature

## Scope boundary

Marketing cards are promotional instruments for campaign-linked discounts,
offers, or gifts. They are not bank, debit, or credit cards; they do not
authorize payment, store payment credentials, or connect to a payment
processor. Customer order payment for the first production release is COD only.

This document describes the existing source implementation, not a production
approval. No production database, card population, campaign setup, or partner
store operation was inspected.

## Implemented source model and flow

- Admin-managed campaigns, batches, benefits, and card inventory are served
  through the backend marketing-card routes and the Admin/marketing portals.
- A card has a unique internal ID and unique visible `cardCode`; its QR token is
  stored as a unique hash. Raw QR tokens are not stored in card lifecycle
  records. Printed card QR codes encode the raw QR token so the customer
  scanner can validate it; a public card code or marketing-page URL is not a
  valid substitute.
- Cards can be assigned to a partner or distributor, received into inventory,
  reserved, attached to an order, and cancelled. Assignment, attachment, and
  customer-link uniqueness are enforced by database constraints and service
  transactions.
- A customer can link and activate an eligible card after the related order's
  delivery has been verified. Campaign and benefit windows, campaign status,
  card expiry, customer/organization scan limits, card ownership, and benefit
  status are checked by the customer-card service.
- The storefront may apply an eligible card discount during checkout. The
  backend recalculates the benefit against the current order, prevents stacking
  with a loyalty reward, and transitions a claimed benefit to redeemed in the
  order-creation transaction.
- Partner redemption validation is separate from checkout. The customer direct
  redemption endpoint is disabled; in-store benefit validation/redeeming uses
  the partner workflow. Benefits can also create a gift entitlement, which is
  fulfilled through the separate gift inventory workflow.
- `MarketingBenefitRedemption` retains the customer/card/benefit relationship
  and status. A unique `(cardId, benefitId)` constraint prevents duplicate
  redemption. `MarketingCardEvent` records lifecycle actions, and Admin and
  partner reporting expose card, scan, and redemption aggregates.

## Requirement assessment

| Requirement | Source finding | Release assessment |
|---|---|---|
| Unique card identification | Unique card code and QR-token hash; internal UUID is separate | Implemented in schema and service; verify live uniqueness only after an approved data check |
| Customer assignment | Unique card-to-customer link, customer ownership checks, activation timestamp | Implemented for eligible cards |
| Activation and expiry | Activation state/time; campaign and benefit start/expiry checks; expired campaign cards are cancelled | Implemented in source; campaign setup and boundary behavior need staging tests |
| Campaign and discount rules | Active/paused/cancelled campaigns, active benefits, fixed/percentage/max discount rules, eligibility and scan limits | Implemented with route-specific rules; verify actual campaign configuration |
| Eligibility and usage restrictions | Order delivery, customer identity, campaign/benefit status, time window, scan limits, order/reward validation | Implemented for reviewed paths; do not assume every legacy order route uses identical rules |
| Duplicate redemption prevention | Conditional claimed-to-redeemed update in checkout transaction and unique card/benefit constraint | Implemented for the reviewed checkout claim path |
| Redemption history | Redemption rows, lifecycle events, and Admin/partner aggregates | Implemented; reconcile reports to persisted data before launch |
| Revocation and suspension | Card cancellation/invalidation and campaign pause/cancel exist; no distinct per-card `SUSPENDED` state was found | Partial; establish who may revoke and how a suspension differs from cancellation |
| Auditability and reporting | Card lifecycle event table plus Admin and partner reports | Implemented in source; verify audit visibility, retention, and report totals in staging |

## Operational release checks

`Order.marketingCardRequired` defaults to true, and delivery preparation rejects
an order that requires a card but has no eligible card attached. Before launch,
confirm that this is intentional for every COD order. If required, ensure the
single active distributor has enough eligible promotional-card inventory and
that attachment failure has an operator recovery path. Do not interpret that
fulfillment requirement as a payment-card requirement.

Test campaign start/end boundaries, paused/cancelled campaigns, exhausted
benefits, duplicate checkout submissions, customer ownership, cancellation,
returns/exchanges, split orders, and reward/gift fulfillment in staging. No
production card or campaign records were inspected for this audit.

## Source references

- [Marketing-card schema](../backend/prisma/schema.prisma)
- [Marketing-card service](../backend/services/marketingCardService.js)
- [Customer-card service](../backend/services/marketingCardCustomerService.js)
- [Checkout order controller](../backend/controllers/orderController.js)
- [Marketing-card routes](../backend/routes/marketingCardRoute.js)
- [Marketing-card security tests](../backend/tests/marketingCardSecurity.test.js)
- [Marketing-card reward tests](../backend/tests/marketingCardReward.test.js)
- [First production release readiness](./first-production-release-readiness.md)
