# First Production Release — Scope and Readiness Assessment

**Audit date:** 2026-11-27  
**Decision:** NOT READY FOR PRODUCTION APPROVAL  
**Evidence:** Static source/document review plus focused database-free tests  
**Database, migration, live provider, production account, and deployment checks:** NOT PERFORMED

## 1. Approved first-release scope

- Customer website orders and manually entered social-media orders.
- One active distributor in the first phase.
- Cash on Delivery (COD) as the only customer order payment method.
- Product variant selection, server-side price/discount validation, inventory
  reservation, dispatch and delivery.
- Delivery proof, failed delivery, customer-unreachable handling, cancellation,
  returns, inspection, exchanges, refunds/customer credit, and COD reconciliation.
- Existing marketing cards and gifts/offers as promotional features.
- Existing customer loyalty features as they actually exist today; a points
  program is a separately identified gap.
- B2B wholesale and other non-COD tender workflows are not part of this
  customer-order release and must not be exposed as first-release payment
  options.

The following are explicitly out of scope: bank/debit/credit-card payment
gateways, payment processors, card tokenization or storage, PCI payment
processing, and payment-provider webhooks. NCM is the courier integration; its
delivery callbacks are not payment-provider webhooks. Marketing cards are
promotional instruments only.

No payment gateway was created or integrated. Unused Stripe/Razorpay backend
dependencies and placeholder environment variables were removed. The legacy
accounting chart entry for gateway clearing is not an enabled payment method or
an integration.

## 2. Executive findings

The repository contains substantial, separate implementations for storefront
checkout, direct order entry, distributor fulfillment, NCM delivery, returns,
exchanges, COD cash positions, promotional cards, and gift fulfillment. That
does not amount to a verified end-to-end production release. The release is
blocked by operational and workflow gaps below, including missing partial COD
collection states, no explicit driver-to-distributor cash handover, no points
ledger, incomplete customer-unreachable handling, legacy/canonical stock
coexistence, and unverified deployment/database state.

The COD amount used by the current storefront delivery-code flow was corrected
in this audit: current order pricing snapshots store an all-in `finalPayableTotal`
that already includes delivery fee. Collection now uses that accepted snapshot
total rather than adding the fee a second time. Older orders without a valid
snapshot retain the legacy `amount + deliveryFee` calculation. Admin social
order entry now displays COD only and rejects non-COD methods server-side.
Focused COD/OTP and direct-order policy tests passed after these changes.

## 3. Readiness by required module

| Module | Current source evidence | Readiness |
|---|---|---|
| Customer order placement and order management | Storefront checkout validates customer/address, price, discounts, variants and COD; Admin direct-order entry captures social-media source/contact details and now accepts COD only. Source attribution is embedded in order metadata rather than a dedicated normalized channel record. | Partial; staging and operational entry/replay checks required |
| Variants, pricing and discounts | Size/color line snapshots, server-side pricing, reward validation, and an accepted order pricing snapshot exist. `Order.amount` is a legacy numeric mirror; the snapshot's `finalPayableTotal` is the authoritative value when present. | Source-supported; verify exact basket, split-shipment and rounding cases |
| Inventory reservation, dispatch and movement | Distributor assignment and ledger-backed inventory flows exist, but legacy catalog stock and canonical location-ledger paths coexist. The broader ERP audit records checkout projection/allocation separation and other legacy writers. | Partial; reconcile the one distributor's actual stock and test oversell/retry paths |
| Delivery assignment and proof of delivery | Distributor self-delivery, NCM bookings/webhooks/reconciliation, manifest stops and POD evidence exist in selected paths. Delivery status and COD settlement are intentionally separate. | Partial; enforce POD and verify NCM/self-delivery recovery in staging |
| Failed delivery and customer unreachable | Generic failed/rescheduled delivery states exist. No dedicated customer-unreachable reason/state and end-to-end retry policy was verified across storefront, driver, distributor and NCM paths. | Gap; define retry/contact limits, reschedule, return-to-hub and cancellation behavior |
| COD collection and order paid state | Storefront orders default to COD. Self-delivery uses an authenticated distributor actor and a customer OTP when enabled; with OTP disabled, collection is pending verification and does not set the order paid. Collection event IDs are unique/idempotent. | Partial; only full-amount collection is represented, and OTP/deployment controls need staging verification |
| Expected versus actual collection | The customer collection event stores the scheduled/expected amount; the self-delivery request does not accept a separate actual collected amount. | Gap for mismatch, short collection and over-collection |
| Full, partial, failed and pending collection | Pending verification, verified, posted and rejected event states exist, but partial/failed customer collection and amount adjustments are not modeled as a complete order collection lifecycle. | Partial |
| Driver-to-distributor handover | Distributor remittance and settlement services cover distributor-to-company cash evidence/review; no distinct driver cash-custody handover event or reconciliation was found. | Gap |
| COD outstanding and settlement | Distributor COD receivables, verified collection totals, remittance batches, Admin review, Treasury posting, idempotency, and aggregate cash-position reporting exist. NCM COD settlement is a separate carrier flow. | Partial; no production data, bank statement or complete population was reconciled |
| Protection from delivery-only payment | Active self-delivery only sets `Order.payment` in the OTP-verified collection path; delivery-only status does not do so there. The legacy `recordDeliveredOrderCashReceipt` helper now also requires a verified/posted canonical collection event whose amount matches the authoritative COD due. | Guarded in source and regression-tested; maintain this evidence requirement |
| Cancellation | Unpaid orders can be cancelled before carrier handoff with a reason; financial activity/paid orders fail closed rather than implying a refund. | Partial; paid cancellation/refund is a separate, incomplete workflow |
| Returns and refund/customer credit | Requests link to the original order and have idempotency keys, review, physical receipt/inspection, refund obligations and route-specific settlement. Return inspection records an aggregate result; the repository does not establish a universal per-line received-good/damaged/unsellable quantity and disposition ledger. Refund and store-credit evidence differ by route. | Partial; normalize the operating checklist and verify physical/financial linkage |
| Exchanges | Requests link to original orders/items, retain replacement snapshots and price differences, use request/event idempotency, and selected distributor flows reserve replacement stock. Exact price-difference evidence is required for delivery completion. | Partial; route-specific cancellation/reversal and reporting are not universal |
| Marketing cards and offers | Unique card codes/QR hashes, customer linking/activation, campaign/benefit windows, eligibility and discount validation, duplicate redemption constraint, redemption history/events, cancellation, and reports exist. Cards are promotional, not payment instruments. | Implemented in source with operational gates; confirm the default required-card-at-delivery behavior and seed eligible inventory |
| Gifts | Gift entitlements and accepted distributor gift inventory are separate from COD and card payment. Gift selection, reservation, dispatch/receipt and order fulfillment flows exist. | Partial; test exact-value stock availability and no-stock recovery |
| Customer loyalty | Tier/spend/order-count rewards and checkout discounts exist. No point balance/ledger model, point earning/redemption, expiry, or return/cancellation/exchange reversal ledger was found. | Not a points program; points requirements are not implemented |

## 4. COD amount and collection controls

- Current storefront checkout writes both `Order.amount` and
  `locationPricingSnapshot.totals.finalPayableTotal`; in this path the amount
  includes the delivery fee. Delivery OTP collection now uses the validated
  snapshot final total. Legacy records without a valid snapshot still use the
  legacy `amount + deliveryFee` calculation.
- `DeliveryOtpChallenge.collectionAmount` binds an OTP to the order, distributor
  and amount. `DistributorCashEvent.idempotencyKey` is unique per order for the
  customer collection event. A retry cannot create a second collection event.
- When SMS/OTP is unavailable, the distributor must explicitly confirm
  collection; the event remains `PENDING_VERIFICATION` and `Order.payment`
  remains false. This fallback requires a staffed review and must not be
  reported as paid.
- A verified event currently represents the full expected amount. There is no
  separate actual amount for the customer handoff, no partial-collection
  allocation, and no explicit failed-collection event/reason taxonomy.
- Distributor remittance submission is capped against open COD receivables and
  verified, unremitted collections. Admin verification and accounting/Treasury
  posting exist in the canonical settlement service; retain that service and
  do not create a second collection or settlement ledger.
- The legacy `recordDeliveredOrderCashReceipt` helper is not a collection
  mechanism: it now only records payment after finding a verified/posted
  `CUSTOMER_COLLECTION` event for the order and matching that event to the
  authoritative COD amount. It must not be wired as a delivery-only state change.
  Future payment state changes must continue to use canonical collection
  evidence; delivery status alone is not receipt evidence.

## 5. Marketing-card assessment

Marketing cards are physical/QR promotional cards that can link a customer to a
campaign benefit. They are not payment cards. Existing validation includes
campaign and benefit status/time windows, card/customer eligibility, discount
limits, order reward selection, and uniqueness-backed duplicate redemption
protection. Redemption/event records and Admin/partner reporting exist.

Card cancellation/revocation and campaign pause/cancel exist, but no separate
per-card `SUSPENDED` state was found. More importantly, `Order.marketingCardRequired`
defaults to true and delivery preparation rejects an order missing its required
card. Confirm whether every first-release COD order must include a promotional
card; if yes, seed/receive sufficient stock at the one distributor and rehearse
replacement and no-stock recovery. Do not conflate this order requirement with
payment processing.

Detailed source assessment: [Marketing Card Architecture](./marketing-card-architecture.md).

## 6. Returns, exchanges, cancellation and loyalty boundary

The existing return/exchange paths must remain distinct from COD collection,
inventory and accounting. Requests do not themselves prove physical receipt,
inspection, refund, or restock. For every release case, operators need to retain
the original order and item/variant, requested and received quantities,
inspection result, good/damaged/unsellable disposition, refund or customer
credit evidence, replacement reservation, price difference/additional COD,
and any loyalty adjustment.

Current code supports selected pieces, but a universal per-item custody and
financial reversal chain is not verified. The older source audit
[R14 Returns and Exchanges](./accounting/12-r14-returns-exchanges.md) records
route differences and remaining cancellation/refund/reconciliation gaps. The
existing loyalty system is a tier/reward projection, not a points ledger; do
not claim point reversals or balances.

## 7. Single-distributor first-phase operating model

The application supports multiple distributors, location-based allocation and
split shipments. It does not enforce a one-distributor-only deployment mode.
For phase one:

1. Activate exactly one distributor for online customer fulfillment.
2. Verify its service area, COD coverage, driver assignments, product/variant
   ledger balances, card/gift stock and return instructions.
3. Exercise one full basket, one unavailable variant, one split/retry attempt,
   one cancelled order, one failed/unreachable delivery, one return and one
   exchange in a non-production environment.
4. Confirm no second distributor can receive an order through stale assignments,
   direct-order entry, or manually selected Admin allocation.

This is a deployment/operations constraint, not a code-level single-distributor
feature.

## 8. Required release gates

1. Verify the corrected authoritative COD due amount across customer checkout,
   delivery OTP, order display, receipt/accounting, split shipment and returns.
   The checkout/OTP double-count correction in this audit has focused test
   coverage; run full workflow tests before release.
2. Keep every `Order.payment` writer bound to verified collection evidence.
   Confirm payment is never inferred from NCM POD or a `Delivered` status.
3. Decide and implement/operate partial, failed, short, over and pending COD
   collection; define actual-vs-expected amount capture, driver cash handover,
   outstanding amount handling and reconciliation without introducing a
   parallel ledger.
4. Approve explicit customer-unreachable contact, reschedule, attempt-limit,
   failed-delivery, return-to-hub and cancellation policies.
5. Reconcile one distributor's physical stock to the canonical inventory
   balances; test variant reservation, concurrency, dispatch, return
   disposition and any remaining legacy stock writers.
6. Approve return/exchange rules for received quantities, inspection by line,
   good/damaged/unsellable disposition, refund versus store credit, price
   differences/additional COD, post-handoff cancellation and loyalty treatment.
7. Decide whether promotional cards are required on all orders; verify campaign
   stock, offer validation, revocation and reporting from an Admin/partner
   account.
8. Do not advertise points until a ledger-backed membership, earning,
   redemption, expiry, cancellation/return/exchange reversal and reconciliation
   workflow exists.
9. Run portal builds/lint, backend tests, isolated-database integration tests,
   migration readiness review, access-control checks, backup/restore and
   end-to-end staging/UAT. Validate NCM contract/configuration separately.
10. Keep B2B wholesale and any non-COD tender routes outside the first-release
    customer-order surface. Obtain operations, finance and business-owner
    sign-off. This static assessment is not deployment approval.

## 9. Audit boundaries and focused verification

No production database was queried or changed. No migration, seed, deployment,
external payment provider, bank, NCM live account, or customer data was used.
The COD amount regression was checked with:

```powershell
Set-Location backend
node --test tests\distributorDeliveryOtp.test.js tests\directOrderReceiptPolicy.test.js tests\orderPaymentAccountingService.test.js
```

Result: **18/18 tests passed**. This verifies focused amount/OTP, COD-only
direct-order, and payment-evidence guard behavior; it does not establish
persisted atomicity, production configuration, financial reconciliation, or an
end-to-end delivery.

## 10. Source references

- [Storefront order controller](../backend/controllers/orderController.js)
- [Checkout pricing snapshots](../backend/services/checkoutPricingService.js)
- [Distributor delivery OTP and collection amount](../backend/services/distributorDeliveryOtpService.js)
- [Distributor self-delivery](../backend/services/distributorSelfDeliveryService.js)
- [Distributor cash and settlement service](../backend/services/distributorCashSettlementService.js)
- [Order payment accounting helper](../backend/services/orderPaymentAccountingService.js)
- [Customer return workflow](../backend/services/customerReturnWorkflowService.js)
- [Order exchange service](../backend/services/orderExchangeService.js)
- [Loyalty controller](../backend/controllers/loyaltyController.js)
- [Marketing-card services](../backend/services/marketingCardService.js)
- [Marketing-card schema](../backend/prisma/schema.prisma)
- [R14 return/exchange source audit](./accounting/12-r14-returns-exchanges.md)
- [P6 whole-project ERP readiness audit](./phase-6/04-whole-project-erp-implementation-readiness-audit.md)
