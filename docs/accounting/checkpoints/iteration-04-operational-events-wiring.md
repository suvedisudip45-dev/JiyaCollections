# Accounting Iteration 04 Checkpoint: Operational Accounting Events & Source Wiring

**Status:** COMPLETE  
**Date:** 2026-09-28

## Completed

- **Delivered Order Posting Adapter (`postDeliveredOrderAccounting`)**:
  - Wired into NCM `DELIVERED` state transition in `deliveryService.js`.
  - Calculates exact Decimal amounts for product sales revenue ex-13% VAT, output VAT payable (13%), delivery revenue, and tender (NCM COD receivable or Bank).
  - Recognizes manufacturer COGS payable using admin-approved snapshot unit costs (`agreedUnitCogsVatInclusiveAtAcceptance`).
  - Supports input VAT splitting if a valid manufacturer tax invoice is marked.
  - Recognizes manufacturer commission expense and payable for eligible direct manufacturer phone/hub orders.
  - Creates and links stable `AccountingParty` records for Customer, Manufacturer, and Carrier.
  - Uses atomic idempotent posting with key `DELIVERY_SALE:${orderId}`.
- **Confirmed Delivery Return Reversal Adapter (`postConfirmedDeliveryReturnAccounting`)**:
  - Reverses sales revenue (debit `SALES_RETURNS`), output VAT, and manufacturer AP upon confirmed return receipt/inspection.
  - Uses atomic idempotent posting with key `DELIVERY_RETURN:${returnId}`.
- **Marketing Partner CPA Redemption Adapter (`postMarketingCpaRedemptionAccounting`)**:
  - Wired into `redeemCardBenefit` in `marketingPartnerService.js`.
  - Accrues marketing CPA expense (6420) and marketing partner payable (2170) on verified card benefit redemption when campaign `cpaRate > 0`.
  - Uses atomic idempotent posting with key `MARKETING_CPA:${redemptionId}`.
- **NCM Carrier Settlement Adapter (`postNcmSettlementAccounting`)**:
  - Settle carrier remittance: debits bank, debits delivery expense (carrier fee), and credits NCM COD receivable.
  - Uses atomic idempotent posting with key `NCM_SETTLEMENT:${settlementId}`.
- **Premature Sales Posting Removal**:
  - Removed fire-and-forget order-creation sales postings in `orderController.js` so revenue and COGS are recognized strictly on delivery, conforming to owner-approved consignment accounting rules.

## Files Changed

- `backend/services/accountingPostingEngine.js`
- `backend/services/deliveryService.js`
- `backend/services/marketingPartnerService.js`
- `backend/controllers/orderController.js`
- `backend/tests/accountingOperationalPosters.test.js`
- `docs/accounting/checkpoints/iteration-04-operational-events-wiring.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`

## Verification

- Complete accounting test suite: **41 passed, 0 failed** across all tests in `tests/accounting*.test.js`, `tests/nepaliFiscalCalendar.test.js`, `tests/manufacturer*.test.js`.
- Invariant verified: Total debits equal total credits across all operational journals.
- Idempotency verified: Duplicate postings return existing journal without duplicate lines or balance changes.
