# Gift and Marketing-Card Reward QA Review

**Review date:** 2026-10-28
**Scope:** Customer card scan, reward claim and checkout application; Admin gift/reward setup and replacement; distributor gift receipt, inventory, and fulfillment.
**Approach:** Read-only code and test review, focused automated tests, and isolated mock-based checks. No production or shared database was accessed or changed; no live account was used. The tagged `backend/.env` was not inspected.

## Executive summary

The focused review found no confirmed exploitable security vulnerability in the reviewed gift and card-reward flow. It found two confirmed functional defects:

1. A `VOUCHER` benefit can be configured by Admin but is rejected by customer claim and checkout handling, so the customer cannot redeem it online.
2. The automatic next-order gift allocator requests only selected entitlement fields (`id` and `rewardValue`) but subsequently requires `status` and `sourceType`. A Prisma-shaped mock reproduces the resulting “no reserved gift reward” outcome, so the automatic gift attachment does not proceed.

These are functional issues, not security vulnerabilities. The gift allocator's existing unit test returns `status` and `sourceType` from its mock despite the Prisma `select`, which masks the production-query behavior.

## Findings

| # | Severity | File | Lines | Finding | Confidence |
|---|----------|------|-------|---------|------------|
| 1 | HIGH | `backend/services/marketingCardCustomerService.js`, `backend/controllers/orderController.js`, `frontend/src/pages/PlaceOrder.jsx` | 290-294; 778-791; 226 | `VOUCHER` is offered as a campaign benefit type, but online claim accepts only `DISCOUNT` and `GIFT`, while checkout exposes and applies only `DISCOUNT`. A voucher reward therefore cannot be claimed/applied as a customer. | 10/10 |
| 2 | MEDIUM | `backend/services/giftService.js` | 80-87; 142-145 | The reserved-card-entitlement lookup selects only `id` and `rewardValue`, while automatic allocation checks `status` and `sourceType` on the result. Those fields are absent from a real Prisma result, so automatic next-order allocation reports no reserved gift. | 10/10 |

### Recommended fixes

- **Voucher:** Decide and implement a single voucher contract end to end. For a fixed-value discount voucher, allow `VOUCHER` in eligible card claims, present it distinctly in checkout, compute a capped fixed-amount reduction against eligible item subtotal, and have the backend independently validate eligibility and consume the redemption transactionally. If vouchers are not intended for online checkout, remove or disable that campaign option and explicitly label the supported in-store-only redemption path.
- **Automatic gift:** Either include `status` and `sourceType` in the Prisma `select` or remove the redundant checks because the query already constrains those values. Update the test mock to honor the requested `select` projection, and assert that automatic assignment reaches the exact-value inventory selection and reserves stock exactly once.

## Flow observations

### Customer

- Claiming an Own Store gift requires the customer to have scanned/verified the card; an assigned but unscanned card cannot create a gift entitlement.
- A successful gift claim creates a pending `CARD` entitlement. The next checkout binds the oldest pending card-gift entitlement to the checkout group. The fulfillment flow then attempts to attach one exact-value gift from an assigned distributor.
- A claimed discount is listed for checkout. The backend rechecks the redemption, campaign, card/customer link, dates, minimum spend, location, and discount bounds, computes the actual discount from the item subtotal, and marks the redemption redeemed in the order-creation transaction.
- A `VOUCHER` benefit cannot complete this flow; see finding 1.

### Admin

- Unit tests cover gift catalog validation, preventing value changes while gifts are assigned to active orders, rejecting gift replacement after checklist completion/packing, and limiting replacements to exact-value stock from the same distributor.
- Campaign creation currently exposes `VOUCHER (Rs)`, despite the unsupported customer claim/checkout path.

### Distributor

- Unit tests cover accepted-stock ownership and exact-value eligibility, receipt counts that cannot exceed dispatched quantity, stale reservation reconciliation, one gift per checkout group, and stock restoration on cancellation/intact returns.
- Automatic assignment is triggered in the fulfillment progression, but is blocked by finding 2. A mock-based pass in the existing test does not model Prisma's selected-field behavior.

## Verification performed

- `node --test tests/giftAllocation.test.js`: **30 passed, 0 failed**.
- Isolated mock checks:
  - `DISCOUNT` claim: accepted.
  - `GIFT` claim: accepted.
  - `VOUCHER` claim: rejected with “Only discount and gift rewards can be claimed online.”
  - Prisma-shaped entitlement projection: automatic allocation returned “no reserved gift reward.”
- `npm test`: the sequential runner reported **99 test files executed; 9 database integration files skipped**. Two unrelated test failures were reported:
  - `tests/distributorServiceEarningService.test.js`: expected `"220"`, received `"180"`.
  - `tests/notificationOtpConfig.test.js`: expected `8`, received `6`.
- Database integration tests and live browser checkout, Admin, and distributor flows were not run because no isolated test database or test accounts were provided. Results above do not claim live end-to-end verification.
