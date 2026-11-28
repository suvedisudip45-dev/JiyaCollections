# Gift and Marketing-Card Reward QA Review

**Review date:** 2026-10-28
**Scope:** Customer card scan, reward claim and checkout application; Admin gift/reward setup and replacement; distributor gift receipt, inventory, and fulfillment.
**Approach:** Read-only code and test review, focused automated tests, and isolated mock-based checks. No production or shared database was accessed or changed; no live account was used. The tagged `backend/.env` was not inspected.

## Executive summary

The focused review found no confirmed exploitable security vulnerability in the reviewed gift and card-reward flow. It initially found two confirmed functional defects; both have now been corrected in the working tree and have focused regression coverage:

1. A `VOUCHER` benefit can be configured by Admin but is rejected by customer claim and checkout handling, so the customer cannot redeem it online.
2. The automatic next-order gift allocator requests only selected entitlement fields (`id` and `rewardValue`) but subsequently requires `status` and `sourceType`. A Prisma-shaped mock reproduces the resulting “no reserved gift reward” outcome, so the automatic gift attachment does not proceed.

These were functional issues, not security vulnerabilities. The gift allocator test now models Prisma's selected-field projection, preventing the mock from hiding query mismatches.

## Remediation status and iteration log

| Iteration | Change | Verification |
|---|---|---|
| 1 — Gift allocation | Added `status` and `sourceType` to the reserved entitlement selection; changed the allocation test mock to return only selected fields and assert the query selection. | `giftAllocation.test.js`: 30 passed. |
| 2 — Voucher redemption | Added Own Store voucher claim support; checkout accepts both percentage discounts and fixed-value vouchers, validates them server-side, caps voucher reductions at product subtotal, excludes delivery, records reward type/value, and consumes redemption transactionally. Customer scan and checkout UIs distinguish `Rs` vouchers from percentage discounts. | Gift/voucher tests cover claims, invalid values, percentage math, fixed value, subtotal cap, and delivery exclusion. |
| 3 — Admin/distributor regression | Preserved exact-value inventory matching, one-gift-per-checkout allocation, ownership, receipt, cancellation, and replacement restrictions; updated workflow and security-flow documentation. | Five focused backend test files: 52 passed. |
| 4 — Loyalty gift integration | Selecting a configured loyalty reward creates an exact-value gift entitlement and prioritizes it for the same checkout. Matching uses accepted inventory from assigned distributors with no category restriction; if stock is unavailable, the order proceeds and the entitlement is retried after every shipment packs. | Gift, loyalty, and checkout regression tests: 41 passed; frontend and Admin builds succeeded. Full backend suite still has two unrelated baseline failures. |

## Findings

| # | Severity | File | Lines | Finding | Confidence |
|---|----------|------|-------|---------|------------|
| 1 | HIGH | `backend/services/marketingCardCustomerService.js`, `backend/controllers/orderController.js`, `frontend/src/pages/PlaceOrder.jsx` | 290-294; 778-791; 226 | **RESOLVED:** `VOUCHER` was offered as a campaign benefit type but online claim and checkout handled only `DISCOUNT` and `GIFT`/`DISCOUNT`. | 10/10 |
| 2 | MEDIUM | `backend/services/giftService.js` | 80-87; 142-145 | **RESOLVED:** The entitlement lookup omitted `status` and `sourceType` fields that automatic allocation checked, so real Prisma results prevented next-order gift assignment. | 10/10 |

### Recommended fixes

- **Voucher — completed:** Added online Own Store claims and checkout application for fixed-value rupee discounts. Backend computes and caps the amount against item subtotal, excludes delivery, validates reward value, and consumes a claim transactionally. The UI distinguishes percentage discounts from fixed vouchers.
- **Automatic gift — completed:** The entitlement query selects `status` and `sourceType`; the regression mock returns only the selected projection and the allocation test asserts the selected fields.

## Flow observations

### Customer

- Claiming an Own Store gift requires the customer to have scanned/verified the card; an assigned but unscanned card cannot create a gift entitlement.
- A successful gift claim creates a pending `CARD` entitlement. The next checkout binds the oldest pending card or loyalty gift entitlement, except a newly selected loyalty reward is prioritized for its current checkout. The fulfillment flow attempts to attach one exact-value gift from an assigned distributor; if a loyalty gift cannot be fulfilled, it returns to the pending queue after all checkout shipments pack.
- A claimed discount is listed for checkout. The backend rechecks the redemption, campaign, card/customer link, dates, minimum spend, location, and discount bounds, computes the actual discount from the item subtotal, and marks the redemption redeemed in the order-creation transaction.
- A fixed-value `VOUCHER` is listed as a rupee reduction at checkout and applied to product subtotal only; see finding 1.

### Admin

- Unit tests cover gift catalog validation, preventing value changes while gifts are assigned to active orders, rejecting gift replacement after checklist completion/packing, and limiting replacements to exact-value stock from the same distributor.
- Campaign creation exposes `VOUCHER (Rs)` and customers can claim eligible Own Store vouchers for checkout.

### Distributor

- Unit tests cover accepted-stock ownership and exact-value eligibility, receipt counts that cannot exceed dispatched quantity, stale reservation reconciliation, one gift per checkout group, and stock restoration on cancellation/intact returns.
- Automatic assignment reads the reserved entitlement with all fields needed for its checks. Regression coverage models Prisma's selected-field behavior and verifies the exact-value assignment path.

## Verification performed

- Focused gift, loyalty, and checkout suites: **41 passed, 0 failed**. Earlier gift/voucher suites passed 52 tests across five test files.
- Customer storefront and Admin production builds succeeded. Backend changed-file syntax checks passed. The full backend run retains two unrelated failures in distributor service earnings and OTP environment configuration.
- Focused frontend lint reported two unrelated errors (unused `Tag` import and unnecessary regex escape) and two hook-dependency warnings.
- Backend Prisma client generation was attempted but could not replace the Windows query-engine DLL because it was in use (`EPERM` rename). No schema changes were part of this fix.
- `npm test`: the sequential runner reported **100 test files executed; 9 database integration files skipped**. The same two unrelated failures from the baseline remain:
  - `tests/distributorServiceEarningService.test.js`: expected `"220"`, received `"180"`.
  - `tests/notificationOtpConfig.test.js`: expected `8`, received `6`.
- Database integration tests and live browser checkout, Admin, and distributor flows were not run because no isolated test database or test accounts were provided. Results above do not claim live end-to-end verification.
