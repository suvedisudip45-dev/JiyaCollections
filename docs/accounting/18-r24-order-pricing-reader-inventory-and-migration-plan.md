# P4.2-R24 — Order Pricing Reader Inventory and Decimal Migration Plan

**Review date:** 2026-11-17
**Status:** **COMPLETE FOR THIS DOCUMENTED STATIC INVENTORY/DESIGN SCOPE; IMPLEMENTATION AND DATABASE VALIDATION NOT CLAIMED.**
**Scope:** Storefront and direct-order pricing values from catalog/rule sources through order snapshots, readers, delivery/accounting, operational lifecycle, and reports. This is not the repository-wide R8 register. No database or external provider was accessed.

**Execution update:** The first code increment under the subsequent Phase 4 programme now writes v3 snapshots for the storefront, Admin, manufacturer, and distributor order-creation paths. The implementation is additive to this design: it preserves v2 readers and legacy fields, records partial provenance rather than guessing, and remains Float-column-backed. See the R25 tracker entry below and the current v3 fields in `backend/services/checkoutPricingService.js`.

## 1. Baseline and safety

R23 implementation is present in `backend/services/checkoutPricingService.js`, the storefront/Admin/manufacturer/distributor order writers, delivery accounting, and selected readers. It stores a v2 decimal-string object under the existing `Order.locationPricingSnapshot` JSON field while retaining `Float` columns as compatibility mirrors. The delivery outbox copies the accepted snapshot; `postDeliveredOrderAccounting` reads it. R24 makes no schema or runtime persistence change.

Static schema evidence:

| Model / field | Prisma type | Checked-in initial migration type | Meaning and current source status |
|---|---|---|---|
| `Product.price` | `Float NOT NULL` | `DOUBLE NOT NULL` | Catalog selling unit rate; value is an input to, not a record of, an accepted order price. |
| `Product.discount` | `Float @default(0)` | `DOUBLE NOT NULL DEFAULT 0` | Percentage rate, not money. |
| `Product.costPrice` | `Float @default(0)` | `DOUBLE NOT NULL DEFAULT 0` | Catalog/reference unit cost. Not an authoritative cost layer and must not replace delivered-sale COGS allocation. |
| `Order.amount` | `Float NOT NULL` | `DOUBLE NOT NULL` | Accepted payable amount; not evidence of payment, revenue recognition, or cash. |
| `Order.deliveryFee` | `Float @default(0)` | `DOUBLE NOT NULL DEFAULT 0` | Customer delivery charge component; distinct from carrier cost. |
| `Order.loyaltyDiscount` | `Float? @default(0)` | `DOUBLE NULL DEFAULT 0` | Monetary discount compatibility field; also used by some direct/Admin order flows for non-loyalty/manual discounts. Semantics are overloaded. |
| `Order.items` | `Json` | MySQL JSON | Legacy item snapshots include numeric quantities, prices, discounts, and totals; no numeric scale constraint. |
| `Order.locationPricingSnapshot` | `Json?` | MySQL JSON | Location decision plus additive v2 exact pricing snapshot. |
| `ComboBundle.calculatedPrice`, `sellingPrice` | `Float` | `DOUBLE` | Money-like bundle prices; `discountPercentage` is a rate. |
| `LocationProductDiscount.discountPercentage` | `Decimal @db.Decimal(5,2)` | Migration-defined Decimal | Percentage rate with two fractional places, not currency. |
| `MarketingCampaign.minOrderValue` | `Float` | Not relevant to `0_init` order table; current schema says Float | Order-value threshold in NPR. |
| `MarketingBenefit.value`, `maxDiscountAmount` | `Float` | Current schema says Float | `value` is polymorphic by `benefitType` (percentage vs voucher amount); `maxDiscountAmount` is money. Requires split semantics before conversion. |

The initial migration establishes the repository's declared baseline physical type; it does not establish any deployed database's actual schema. No live schema inspection was performed.

## 2. Checkout and direct-order writer inventory

### Catalog and rule sources

| Source | Writers / production entry points | Applied meaning and boundary |
|---|---|---|
| Product price, discount, cost reference | `backend/controllers/productController.js` — `addProduct`, `updateProduct`; catalog UI in Admin product management | Catalog values are stored in Float columns. Checkout adapts retrieved values using `decimalFromStoredFloat`; this preserves the current stored representation but cannot restore digits lost on write. `costPrice` is not accepted sale COGS when production/inventory cost allocations exist. |
| Place-wise price rules | `backend/services/locationPricingService.js` — rule create/update and `resolveLocationProductPrices`; Admin `admin/src/pages/LocationPricing.jsx` | `LocationProductDiscount.discountPercentage` is a Decimal rate. The resolver returns both numeric compatibility fields and decimal-string pricing fields. Effective location/product choice is frozen at order acceptance only partially in v2. |
| Bundle price and discount | `backend/controllers/comboBundleController.js`; `backend/services/comboBundleRules.js` — `calculateComboBundlePrice`, `allocateComboBundleComponentPriceDecimals`; Admin `admin/src/pages/ComboBundles.jsx` | Bundle unit prices are calculated/allocated as Decimal, with explicit component-price allocation; legacy bundle model fields remain Float. Positive-price percentage discount behavior rounds unit selling price using the existing commercial rule before quantity multiplication. |
| Own Store/loyalty/gift adjustments | `backend/services/marketingCardReward.js`, `backend/services/giftService.js`, `backend/controllers/orderController.js` — `placeOrder`; loyalty reader `calculateUserLoyalty` | Selected reward eligibility and discount are validated server-side. v2 captures aggregate order discount and rule-related item percentages where supplied, but does not consistently preserve every source-separated discount component. |
| Shipping | `backend/services/shippingRateService.js`, `backend/controllers/shippingController.js`, `backend/controllers/orderController.js` — checkout recalculates shipping server-side | Accepted customer charge is included in order snapshot; carrier fee/discount remains a separate delivery settlement source. Legacy delivery fields stay Float-backed. |

### Order creation and edit behavior

| Channel | Entry point / route | Pricing and persistence |
|---|---|---|
| Storefront | `frontend/src/pages/PlaceOrder.jsx` → `POST /api/order/place` (`backend/routes/orderRoute.js` → `orderController.placeOrder`) | Re-resolves product/location/bundle pricing, discounts, rewards, shipping and distributor split. Apparel stock quantities are validated as whole units. Uses shared Decimal helpers and persists item compatibility JSON, Float mirrors, and v2 snapshot. Split shipment fee/discount totals are reconciled with deterministic residual allocation. Storefront commercial final-total rule is `NEAREST_NPR_5_V1`. |
| Admin direct/social | `admin/src/pages/CreateOrder.jsx` → `POST /api/order/admin-create` → `orderController.adminCreateOrder` → `adminDirectOrderService.createAdminDirectOrderWithStock` | Recalculates product unit prices, shipping/manual fee and manual discount; persists v2 snapshot and checked Float mirrors in the existing transactional order/stock flow. Admin order control (`GET /api/order/admin/control/:orderId`) exposes fulfillment/cancellation controls; no order-price edit endpoint was found in the mounted `orderRoute.js`. |
| Manufacturer | `POST /api/manufacturer/direct-orders/create` (mounted in `backend/routes/manufacturerDirectOrderRoute.js`) → `manufacturerDirectOrderController.createDirectOrder` | Validates inventory and price, calculates Decimal lines/order and loyalty discount, snapshots accepted values, then adds accepted cost-layer allocations to items in the same source workflow. `updateDirectOrderStatus` changes status/fulfillment and triggers delivery accounting; it does not reprice. `GET /my-orders` uses `getMyDirectOrders` and adds exact pricing API fields. |
| Distributor | `POST /api/distributor/orders/direct` and `/direct/status` (`backend/routes/distributorRoute.js`) → `createDistributorDirectOrder` / `updateDistributorDirectOrderStatus` | Decimal merchandise/discount total and v2 snapshot, legacy Float mirrors; direct order consumes distributor inventory. Status changes can trigger delivered-sale posting; no price edit is performed. Direct-order list/status responses add exact pricing fields. |

No mounted order edit path that recalculates an accepted amount was found in the inspected order, manufacturer-direct, or distributor-direct routes. Product and discount-rule edits do not mutate old accepted order snapshots. Status, assignment, delivery, receipt, cancellation, return, exchange, and refund transitions must therefore treat the source order as immutable and create linked adjustment events rather than silently repricing it.

## 3. Order reader and consumer inventory

This table identifies known production consumers found by source searches and inspection. “Numeric compatibility” means a reader still consumes the original Float/Number fields or numeric item JSON; it does not mean every returned amount is exact.

| Consumer / entry point | Source read | Snapshot/legacy behavior | Purpose and remaining gap |
|---|---|---|---|
| `orderController.buildOrderListItem` used by `allOrders`, `allAdminOrders`, `userOrders`; routes `/api/order/list`, `/admin-list`, `/userorders` | `Order.amount`, `deliveryFee`, `loyaltyDiscount`, `items`, `locationPricingSnapshot` | Preserves numeric `amount`/`deliveryFee`; adds `amountDecimal`, `deliveryFeeDecimal`, `pricingSnapshotVersion`, and snapshot when valid v2 exists. Legacy orders stringify stored Float representation. | Main customer/Admin history contract. Portal consumers remain numeric and use `items` JSON. |
| Manufacturer direct-order `getMyDirectOrders`; create/status response | Order fields and v2 JSON | Adds exact pricing fields through `exactPricingApiFields`; keeps raw legacy fields. | API is additive, not a full client migration. |
| Distributor direct-order list/create/status | Order fields and v2 JSON | List/response helpers add exact fields in direct-order paths. | General distributor assignment/NCM/finance APIs are separate and do not consistently attach exact fields. |
| `customerController.getCustomer360` | Order rows, item JSON, amount | Adds exact order fields and computes lifetime total using `pricingSnapshotAmounts`; also returns legacy numeric total/average. | Snapshot-aware detail. |
| `customerController.getAllCustomers` and customer summary query | `Order.amount` aggregate / rows | Uses Number accumulation or SQL `SUM(amount)` and Number serialization; no per-order snapshot reconciliation. | Stale/approximate customer spend and tier summary; P1 reader gap. |
| `loyaltyController.calculateUserLoyalty`, `getHubCustomers` | Order amount and reward | Uses Decimal addition/comparison on accepted v2 snapshot where valid; legacy Float adapter otherwise. Returns numeric compatibility spend and `totalSpendDecimal`. | Calculation improved in R23; customer-facing API still has a numeric compatibility field. |
| `orderAssignmentController.buildFulfillmentBenefits` and assignment/fulfillment response builders | `Order.items` original/purchased prices, quantity, percentage; order/reward discount | Reconstructs product discount as Number `(original - purchased) * quantity`; combines with loyalty discount using Number and `.toFixed(2)`. Other assignment response builders return raw item JSON/order fields. | Cannot reliably distinguish stacked/selected rule sources; not snapshot provenance-aware. |
| `distributorNcmService` direct/order assignment response | `Order.amount`, fee, discount, items | Converts fields to Number and returns operational response. | Compatibility-only display/operational transfer; not exact accounting source. |
| `distributorSelfDeliveryService` / `distributorDeliveryOtpService` | Order amounts/fees and item JSON | OTP helper stringifies legacy fields and quantizes for collection comparison; other responses include raw numeric order amounts. | COD amount/evidence and accepted payable must remain distinct; exact snapshot not consistently serialized here. |
| `distributorFinanceService` | Order amount in earning and finance rows | Number projections for `orderAmount`; earning values may be stored snapshots separate from order consideration. | Operational statement, not source-to-journal reconciliation. |
| `deliveryService` and delivery API | Order items, amount, fee, delivery/COD fields | `deliveryService` uses snapshot-first accepted amount in the traced item amount helper; booking/settlement detail responses still include some Number conversions and separate carrier amounts. | Keep customer delivery charge distinct from NCM actual/discount/net carrier fee. |
| `accountingOutboxService.enqueueDeliveredSaleAccounting` → `processDeliveryAccountingOutbox` | Order amount, fee, items, v2 snapshot | Copies snapshot final payable/fee when valid, else explicit legacy `String(Float)` fallback; immutable event hash and stable key. | Existing event retry/idempotency remains. Legacy fallback cannot recover stored Float precision. |
| `accountingPostingEngine.postDeliveredOrderAccounting` | Accepted snapshot, order items, cost allocations, delivery data | Uses accepted v2 gross and delivery charge with shared Decimal/HALF_EVEN posting; reads accepted item cost-layer snapshots for COGS. | Mocked poster tests are not persisted inventory/journal/transaction validation. Other legacy sale/return poster paths still use source Float/JSON adapters. |
| `orderPaymentAccountingService` / `customerReceiptService.recordCustomerReceipt` / `reverseCustomerReceipt` | Accepted payable and linked invoice/receipt amounts | Order payment helper uses snapshot-first accepted amount; receipts post from source-linked invoice allocation and receipt values; reversal is separate event. | Receipt is not re-created from current product values; database atomicity and source population not validated here. |
| COD/remittance: `distributorDeliveryOtpService`, `distributorSelfDeliveryService`, `ncmSettlementService`, `deliveryController`, `distributorNcmService` | Order accepted amount, expected/collected COD, settlement cash/fees | Several portal/operational projections still use Number/Float; settlement posting uses its own Decimal source values. Delivery or `payment=true` is not proof of collection/remittance. | Reconcile expected, collected, verified, remitted, and bank-confirmed amounts independently. |
| Cancellation: `orderCancellationService.cancelCustomerOrder`, `cancelAdminOrder` | Order state, items/reservations, linked journals/documents | Guards financially active orders; does not rewrite accepted price. | Refund/reversal policy is separate and remains incomplete for some paths. |
| Customer returns: `customerReturnWorkflowService`, `returnsController`, `customerReturnWorkflowController` | Original order item JSON, delivery fee, previous returns | `returnItemsFromOrder` and refund snapshots consume legacy item JSON and some Float delivery fee reads; return event uses its own calculated/approved amount. | Must use v3 preserved original discount components to cap/reconcile refunds; historical unknown discounts remain unknown. |
| Exchange: `orderExchangeService`, `orderExchangeController` | Original order item JSON and requested/replacement lines | Snapshots requested items against legacy item JSON; no catalog repricing should occur. | Exchange monetary difference and posted effects need complete Decimal/source-link trace. |
| Distributor refund/exchange: `distributorReturnRefundService`, `distributorExchangeService` | Order lines, settlement/refund amounts | Independent return/refund calculations and approval; source fields vary. | Exact source-to-order and source-to-journal round trip is not fully proven. |
| Discounts report: `discountAnalyticsService.classifyOrderDiscounts`, `getDiscountAnalytics` | `Order.items`, reward JSON, `loyaltyDiscount`, `amount`, delivery fee | Reconstructs line discount with Number from original and purchased price; category is inferred from optional legacy fields; uses Number for order amount/fee. | Cannot reproduce provenance when rules stack/override or snapshots do not contain source amounts. |
| Product sales: `productSalesAnalyticsService.getProductSalesSummary`, `getProductSalesRows`, locations/timeline/charts | Order item JSON quantities/prices and delivery/order dates | Aggregates item snapshots; no universal v2 line parser or proof every revenue amount equals posted GL. | Operational product report, not authoritative GL revenue. |
| Dashboard/estimates: `financialDashboardCosting`, `financialController` dashboard/profit estimates | Order amounts/items, current/approved cost layers, expense and journal aggregates | Some paths use posted GL, others label operational estimate and sum `Number(order.amount)`. | Do not equate operational order total to earned revenue or posted GL. |
| Manufacturer summary and party reporting: `manufacturerSummaryReportingService`, `nonExpensePartyReportingService`, `manufacturerSettlementReportingService`, `adminManufacturerDetailController` | Direct order amounts/items, settlement/payment data | Some summary calculations use `pricingSnapshotAmounts`; other direct order/party rows use `Number`/stored decimals. | Not a unified order-to-ledger report basis. |
| Paper bill / invoice and delivery docs: `paperBillService`, `salesInvoiceController`, Admin shipping label | Order payable, items and delivery | Paper-bill response has numeric `amount` plus additive `amountDecimal`; shipping label reconstructs item totals/fee from Number fields. | Printed and exported documents need v3 snapshot parsing and exact-string fields. |
| Admin order control, delivery monitor and customer panels | Order source, item/fee, COD | Operational controls and detail APIs expose numeric fields; delivery monitor derives COD amount numerically. | Visible customer/admin amount readers in `admin/src/pages/Orders.jsx`, `OrderAssignments.jsx`, `CreateOrder.jsx`, `CustomerDetail.jsx`, `Customer360Panel.jsx`, `DeliveryMonitor.jsx`, `ShippingLabelModal.jsx`, `SelfDeliveryDetails.jsx`, and NCM details. |
| Customer storefront | `/api/order/userorders` and customer profile/order responses | `frontend/src/pages/Orders.jsx` renders numeric `amount`, item `purchasedUnitPrice`/`lineTotal`, fee, loyalty discount; invoice subtotal can be recalculated from item JSON. `PlaceOrder.jsx`, `Cart.jsx`, and `CartTotal.jsx` use Number for display/quote calculations. | Customer-facing UI is not a Decimal arithmetic authority. |
| Manufacturer/distributor portal | Assignment, direct-order, finance, NCM, self-delivery APIs | `manufacturer/src/pages/Orders.jsx`, `OrderDetail.jsx`, `DirectOrders.jsx`, `Finance.jsx`, `NcmDeliveries.jsx`, `DistributorSelfDelivery.jsx`, and courier-slip component consume numeric amount/item fields. | Direct-order route can carry exact additive fields; assignment and financial data still need consumer migration. |
| Marketing portal | QR-validation result | `marketing/src/pages/qr-validator/QrValidatorPage.jsx` displays returned order amount. | No full order-price ledger consumer identified in this portal scan; response compatibility still matters. |

### Consumer search coverage and limits

The static search covered Prisma schema and checked-in initial migration, backend order/product/fulfillment/accounting/customer/finance/return/report services and controllers, mounted order/financial/direct-order routes, plus `src` trees for frontend, admin, manufacturer, and marketing. Candidate files were reviewed by code context where listed above. Searches included order amount, delivery fee, loyalty discount, `items`, line totals, original/purchased prices, snapshot helpers, order model accessors, and endpoint strings.

This is an evidence-backed inventory of discovered primary consumers, not a proof that every dynamically named SQL query, report export, notification template, external API client, historical import, test fixture, old migration, or deployed consumer was found. Name-only matches were not counted as monetary fields. Uncertain/legacy consumers remain explicitly listed as gaps. R8 still needs a repository-wide field-by-field register.

## 4. R23 snapshot limitation and v3 provenance proposal

### Current v2 facts

`checkoutPricingService.createOrderPricingSnapshot` currently writes version 2 with currency, rule version, source, timestamp, line product/variant, accepted unit price, quantity, line total, optional percentage/discount amount inputs, and aggregate totals. Existing R23 writers do not consistently preserve original catalog unit price or source-separated line discount amounts for product, location, and bundle rules. The discount report reconstructs some savings from Number-valued legacy item fields; that is not reliable provenance. No historical discount component may be inferred from today's catalog/rules.

### Proposed additive version 3 shape

Do not mutate v2 snapshots. In a later code-only increment, introduce a version-aware v3 writer/reader with this logical shape (all monetary values and quantities are canonical decimal strings; percentage rates are decimal strings tagged with unit `PERCENT`):

```json
{
  "version": 3,
  "currency": "NPR",
  "pricingRuleVersion": "NPR-CHECKOUT-3",
  "source": "CHECKOUT",
  "acceptedAt": "ISO-8601",
  "provenanceStatus": "COMPLETE",
  "lines": [{
    "productId": "stable-id",
    "variant": { "size": "M", "color": "Navy" },
    "quantity": { "value": "2", "unit": "EACH" },
    "catalogUnitPrice": "100",
    "preLineDiscountUnitPrice": "100",
    "acceptedUnitPrice": "85",
    "lineGross": "200",
    "discountComponents": [{
      "source": "LOCATION",
      "ruleId": "stable-rule-id",
      "rate": { "value": "15", "unit": "PERCENT" },
      "amount": "30",
      "calculationBasis": "UNIT_PRICE_DELTA_X_QUANTITY",
      "appliedOrder": 1
    }],
    "lineDiscountTotal": "30",
    "acceptedLineTotal": "170"
  }],
  "adjustments": [
    { "source": "LOYALTY", "kind": "DISCOUNT", "amount": "5" },
    { "source": "SHIPPING", "kind": "CUSTOMER_CHARGE", "amount": "20" }
  ],
  "totals": {
    "lineGrossTotal": "200",
    "lineDiscountTotal": "30",
    "orderDiscountTotal": "5",
    "shippingTotal": "20",
    "otherAdjustmentTotal": "0",
    "preCommercialRoundingTotal": "185",
    "commercialRoundingAdjustment": "0",
    "finalPayableTotal": "185"
  },
  "commercialRounding": { "rule": "NEAREST_NPR_5_V1", "stage": "FINAL_PAYABLE" }
}
```

The example is a contract proposal, not accepted transaction evidence or an instruction to apply these exact example values. Required invariants:

1. Each line's gross is original accepted catalog/reference unit price × quantity, before discounts, at stored calculation precision.
2. Record the actual applied unit-price path and ordered components. For non-stacking precedence, record only the selected source. For bundle allocation, record bundle rule ID, allocated accepted component price, and explicit bundle discount contribution; do not relabel an allocation as a product or location discount.
3. Per-line discount components sum exactly to `lineDiscountTotal`; `lineGross - lineDiscountTotal = acceptedLineTotal` using the captured rounding boundary. If the legacy commercial rule rounds the unit price before multiplication, record that rule and its resulting component amount.
4. `sum(acceptedLineTotal) + shippingTotal + otherAdjustmentTotal - orderDiscountTotal + commercialRoundingAdjustment = finalPayableTotal`. Order-level manual, loyalty, coupon/card, reward, fee, and shipping adjustments are separate typed components, not embedded in unit price.
5. For split orders, child line and adjustment amounts plus deterministic signed residual allocations equal the parent checkout snapshot exactly. Preserve the parent group ID and allocation rule.
6. Every component has explicit source/rule references when the writer has them. If a historic source cannot establish a component, set `provenanceStatus: "PARTIAL"` and component state `NOT_CAPTURED`/`UNRECOVERABLE`; never invent zero or current-catalog values.
7. Keep currency, accepted timestamp, pricing rule version, quantity unit/precision, monetary scale, percentage unit, and commercial/accounting rounding boundaries explicit.

### Version and API compatibility proposal

- Readers dispatch v3 → v2 → legacy; v3 is schema-validated and reconciled before using exact amounts. V2 remains immutable with `provenanceStatus=PARTIAL_LEGACY` at the adapter layer only; do not write that label back onto historical JSON.
- Legacy order fields (`amount`, `deliveryFee`, `loyaltyDiscount`) and legacy item numeric members remain available during migration. Add `amountDecimal`, `deliveryFeeDecimal`, `loyaltyDiscountDecimal`, `pricingSnapshotVersion`, and versioned snapshot fields; current exact pricing projections include `legacyNumericFieldsCompatibilityOnly: true`. Never change existing numeric response types in-place during an API compatibility window.
- A `Number` is a compatibility/display projection only. Financial/export consumers should use strings or Decimal objects internally and serialize strings at API/report boundaries.
- Do not enable a v3 writer until all consumers that affect accounting or accepted order presentation can read the version; no new DB column is required for JSON persistence, but JSON fields do not enforce numeric precision or mandatory components.

## 5. Decimal storage plan by field (design only)

Proposed scales are engineering candidates subject to business range, unit, import, and historical data review. These are not a schema migration proposal ready to apply.

| Field | Current type | Proposed storage / scale | Validation, reader/writer, compatibility, and history |
|---|---|---|---|
| `Order.amount` | Prisma Float; checked-in init `DOUBLE NOT NULL` | Add nullable `amountDecimal DECIMAL(20,2)`; 18 integer digits, cents; only cut authority after staged rollout | Strict string/Decimal service input; nonnegative, finite, fit check before writes. Dual-read prefers validated Decimal for new rows, v3 snapshot next, legacy Float fallback. Existing `amount` response stays numeric; additive string field. Historical backfill compares against v2 and linked postings; do not round/overwrite original. Rollback keeps old column read-only and requires switching readers back only while dual writes remain consistent. |
| `Order.deliveryFee` | Prisma Float; init `DOUBLE NOT NULL DEFAULT 0` | Add nullable `deliveryFeeDecimal DECIMAL(20,2)` | Same money validation; distinguish customer charge from delivery carrier fee. V3 snapshot/order rows determine amount. Legacy null/default and split-shipment first-child fee behavior must be retained. Preserve API number plus string. Backfill compares snapshot and legacy column; do not infer missing fee from current shipping configuration. |
| `Order.loyaltyDiscount` | Prisma Float?; init `DOUBLE NULL DEFAULT 0` | Add nullable `orderDiscountDecimal DECIMAL(20,2)` only after field semantics are disentangled; do not name new field loyalty-only if it stores manual/card values | Existing writer overloads this field. New v3 typed `adjustments[]` is authoritative for provenance; keep old field compatibility. A nullable legacy value/default is not proof of no discount. Historical conversion must use source reward/item data only when evidenced; otherwise mark incomplete. |
| `Order.items` JSON prices/totals/discounts | MySQL JSON containing historical numeric values | Retain legacy JSON unchanged; v3 stores decimal strings. If SQL querying or relational integrity is later required, add `OrderPricingLine` child table with version/order/item index, `DECIMAL(20,6)` unit rates, `DECIMAL(20,2)` monetary totals/discount components, and separately scaled quantity | JSON strings are not DB Decimal columns: validate shape/range at application boundary. Do not blanket-convert numeric JSON keys or historical records. A future child table is additive and must not become required until deployed. Need stable line identity for split/duplicate product variants. |
| `Order.locationPricingSnapshot` / `rewardApplied` JSON | MySQL JSON | Keep versioned JSON; exact decimal strings; no fixed DB numeric precision | Treat v2 and legacy as immutable. v3 reader validates invariants; unknown versions fail closed for accounting and preserve raw data for review, not fallback to today's catalog. |
| `Product.price` | Prisma Float; init `DOUBLE NOT NULL` | Add nullable `priceDecimal DECIMAL(20,6)` as a **unit rate**, not currency-settled amount | Validate nonnegative max/range, supported fractional precision, and per-unit commercial rounding. Writers: `productController.addProduct/updateProduct`; readers include location, combo, direct/storefront pricing and portal display. API keeps number plus decimal-string catalog field until consumers migrate. Historical conversion compares Float representations; catalog history may not prove old accepted orders, which use frozen snapshots. |
| `Product.discount` | Prisma Float; init `DOUBLE NOT NULL DEFAULT 0` | Add `discountRateDecimal DECIMAL(7,4)` candidate (0–100 percent, 4 fractional places) | Rate must be bounded 0–100 and labeled percent; never format/quantize as NPR. Keep a separate legacy response field. Writer/admin input and all pricing/UI readers require migration. Historical current rule values cannot establish rule applied to old order. |
| `Product.costPrice` | Prisma Float; init `DOUBLE NOT NULL DEFAULT 0` | If retained after semantic audit, add nullable `referenceUnitCostDecimal DECIMAL(20,6)`; not an inventory valuation or COGS source | Writers product admin and old cost proposals; readers legacy direct-order snapshots/reports. Accepted COGS remains cost-layer/inventory-ledger source. Do not use current catalog value for historical sale conversion or replace production cost allocation. |
| `ComboBundle.calculatedPrice`, `sellingPrice` | Prisma Float; init `DOUBLE` | Candidate `DECIMAL(20,2)` for total bundle-price fields; `discountPercentage` candidate `DECIMAL(7,4)` | Reconfirm whether calculated/selling fields are whole bundle totals and how component unit prices are allocated. Keep decimal strings in APIs. Historical orders use accepted line snapshot, not current bundle price. |
| `LocationProductDiscount.discountPercentage` | Prisma `Decimal(5,2)` current schema; initial schema/migration history must be checked for evolution | Retain or widen to `DECIMAL(7,4)` only if business-approved fractional-percent range requires it | It is a rate (0–100 expected), not money. No conversion by monetary scale. Existing readers and portal preview use Number; dual API and validation needed. |
| `MarketingCampaign.minOrderValue` | Prisma Float; current threshold semantics | Candidate `minOrderValueDecimal DECIMAL(20,2)` | NPR threshold. Marketing campaign writer, card attachment and threshold report consume it. Do not interpret campaign threshold as accepted order total if discount/shipping eligibility policy says merchandise subtotal; current code paths need policy sign-off. |
| `MarketingBenefit.value`, `maxDiscountAmount` | Prisma Float, `value` polymorphic | Split by `benefitType` in a later additive model/fields: `fixedValueDecimal DECIMAL(20,2)` and/or `discountRateDecimal DECIMAL(7,4)`; `maxDiscountAmountDecimal DECIMAL(20,2)` | First classify benefit types and affected APIs. `percentage` field is card-population share and not order discount percentage. Preserve legacy field until all benefits are classified and historic redemption snapshots mapped. |
| `Order` related delivery/settlement fields | `DeliveryOrder`/`DeliveryFinancialSettlement` include separate Float order/fee/COD values | Out of this order-pricing migration; classify separately before any type change | Expected customer payable, COD expected/collected, carrier fee, settlement/remittance are different monetary events. Do not convert together just because they reference an order. |

### Migration ordering and rollback gate

1. Add nullable Decimal shadow columns and indexes/constraints only in an additive migration; deploy that migration before application code that references the columns.
2. Regenerate Prisma client and verify generated/deployed schema in an independently authorized, clean and populated test database. Code may not write shadow fields until that gate is recorded.
3. Release readers that select valid v3/specific Decimal fields, then v2 snapshots, then explicit legacy compatibility. Log and expose mismatches; do not suppress invalid snapshots into success-shaped fallbacks.
4. Dual-write only after schema deployment and test identical quantized values/amounts. Preserve Float source values read-only during the reconciliation window.
5. Cut over writers and reports only after consumer inventory, precision limits, reconciliation thresholds, approvals, and rollback checks pass.
6. Keep old columns/snapshots through the rollback period. A rollback must not reconstitute Decimal history from Float or rewrite journals. Remove legacy columns only after independent approval and verified backup/restore.

No migration file was prepared. Adding fields to Prisma or activating writes now would violate the no-unapplied-schema dependency boundary.

## 6. Read-only historical precision and drift procedure

This procedure is a future design only. It may run only after separate authorization and an independently verified isolated database, verified backup/restore, read-only credentials for extraction, and reviewed data scope. It must not be run against `localhost:3306/clothing` or an assumed test database.

### Inputs and deterministic normalization

For each order, preserve source IDs, raw values, source column representations, snapshot bytes/hash, raw JSON item bytes/hash, linked invoice/journal/outbox/receipt/return IDs, and software/rule version. Never update a source row during the run.

1. Parse v3/v2 decimal strings with the strict shared decimal parser and enforce schema/precision without rounding. A malformed or out-of-range value is invalid.
2. For Float columns, capture the database-returned binary value and encode its exact IEEE-754 value as a rational/high-precision decimal for comparison; separately record the ordinary round-trip decimal string used by legacy runtime code. Do not silently convert either into a rounded currency amount.
3. Parse historical JSON numeric tokens from raw stored JSON where available. If only parsed JavaScript Number is available, mark token-level precision unrecoverable and use round-trip representation only for compatibility comparison.
4. Reconstruct line totals only when unit-price basis, quantity precision, discounts and per-unit rounding rule are evidenced in the immutable snapshot/source. Do not read current product/catalog/rule values to fill omissions.
5. Compare order totals to posted sales invoice/journal lines only through explicit stable source links and known posting rounding/tax treatment. Do not equate order payable with revenue if delivery fee, VAT, discount, COD receivable, or return adjustments are separate.

### Comparison tolerances and classes

| Class | Deterministic criterion | Treatment |
|---|---|---|
| `EXACT_AGREEMENT` | Canonical Decimal values match exactly at the field's declared scale; group/split allocation sums match exactly. | Pass comparison only; not an accounting sign-off. |
| `EXPLAINABLE_ROUNDING_DIFFERENCE` | Difference is exactly reproduced by the captured, versioned commercial/accounting rounding operation and sequence. For non-Float stored Decimal totals, the operation must match within one smallest posting unit (`0.01 NPR`) at the documented boundary, with no unexplained residual. | Report rule, stage, signed difference, source and calculation trace; reviewer approval still required. Nearest-NPR-5 can create a multi-rupee adjustment only when v2/v3 has the pre-round and final values/rule; do not apply a generic 0.01 tolerance to excuse it. |
| `RECOVERABLE_FLOAT_REPRESENTATION` | Exact binary Float differs from its stored decimal-string mirror by no more than half one ULP at the Float's magnitude, and the original accepted decimal is independently present in a v2/v3 snapshot or immutable source. | Preserve both raw values; use snapshot/source as accepted amount. |
| `RECOVERABLE_PRECISION_LOSS` | Legacy Float/JSON Number is imprecise but an independent immutable accepted snapshot or posted source document establishes the exact amount, and difference is bounded to the representation/rounding process documented for that writer. | Mark legacy field imprecise; never backfill without dual approval and linkage. |
| `MISSING_OR_INCOMPLETE_PROVENANCE` | No reliable captured source establishes one or more applied components, line identity, rate, quantity, or rounding boundary. | Do not reconstruct from current rules. Create an exception record and obtain source evidence or approve a non-reconstructed historical treatment. |
| `UNEXPLAINED_DISCREPANCY` | Amounts differ after exact parsing and no captured rule/source explains the difference; or posted invoice/journal does not reconcile to the linked event. | Block backfill/cutover for the order population; escalate to Finance and independent reviewer. No balancing journal or silent rounding. |
| `INVALID_OR_OUT_OF_RANGE` | Malformed/non-finite values, negative amount where prohibited, invalid percentage/quantity, `Decimal(precision,scale)` overflow, or broken snapshot equations. | Quarantine; no conversion or write. |

The half-ULP rule is used only to describe IEEE representation error; it never replaces the exact snapshot amount or posting boundary. There is no global “small difference” tolerance for order/journal reconciliation. If no v2/v3/source amount survives, accepted historical precision is not recoverable by decimal conversion. Only separately approved append-only correction or documented exception may resolve it.

### Output

Produce read-only row-level CSV/JSON and summary counts by order channel, snapshot version, amount field, return status, and classification; include source hashes, exact differences, policy version, exception owner, approval status, and code version. Re-running on the same immutable dataset and version must yield identical classifications. Finance and an independent reviewer sign the exception population before any write/backfill proposal.

## 7. Staged cutover and rollback plan

| Stage | Work and exit evidence | Required gate |
|---|---|---|
| 1. Semantic inventory | Complete field/writer/reader/API/report inventory; settle overloaded `loyaltyDiscount`, conditional benefit values, and rate/quantity scales. | Engineering + Finance sign-off; no database required for static inventory. |
| 2. Snapshot provenance | Implement and test v3 writer/reader and v2/legacy adapters; establish component reconciliation and historical `PARTIAL` treatment. | Code review and mocked/API/portal contract tests; no DB needed for JSON-only code. |
| 3. Additive migration | Prepare shadow Decimal columns and constraints; verify migration order and generated Prisma client. Do not activate writes. | DBA-provisioned isolated clean schema and representative copy, backup/restore evidence, separately authorized migration tests. |
| 4. Historical validation | Run the read-only drift process above; review exceptions and source/journal linkage. | Independently verified isolated database, approved immutable extract, Finance and independent reviewer approval. |
| 5. Dual read/write | Deploy additive schema first, then reader fallback, then dual-write with payload/hash conflict detection and Decimal/Float mirror agreement report. | Persisted route, retry, rollback, concurrency, and outbox/journal tests on isolated DB; external consumers inventoried. |
| 6. Authority cutover | Use Decimal shadow fields and v3 snapshots as new-order authority; keep original Float and legacy JSON unchanged. Reconcile all active reports/portals and source-to-journal populations. | No unexplained discrepancies; all exceptions approved; operational and accounting owners sign. |
| 7. Rollback/monitoring | Keep both representations read-only/dual-write through rollback window; alert on missing version, invalid precision, mismatch, stale clients, and accounting snapshot conflict. Revert reader/writer feature flags without rewriting accepted snapshots or journals. | Tested restore/rollback and named operators. Removing Float columns needs a later independently approved migration. |

Stages 1–2 and static documentation/tests can continue without DB access. Stages 3–7 require DBA-provisioned isolation and separate authorization; no such evidence is claimed here.

## 8. Safe test evidence and remaining blockers

R23 tests currently cover shared Decimal pricing, rounding, quantity/discount validation, split allocation, version-2 serialization, legacy fallback, delivered-sale accepted snapshot consumption, outbox immutability, order projections, and selected direct-order flows. The R24 addition in `backend/tests/checkoutPricingService.test.js` verifies that the v2 parser does not mutate an incomplete legacy snapshot or invent discount component details.

These are production-function unit tests with mocked/in-memory Prisma dependencies. They do not validate a mounted API request through a persistent database, migration behavior, transaction rollback/concurrency, historic conversion, actual deployed schema, or posted subledger reconciliation. The v2 immutability test is a parser test, not a guarantee against external mutation of a persisted JSON value.

### Prioritized remaining R8 / P4.2 blockers

1. Build the v3 snapshot with source-separated discount provenance and an immutable writer contract; extend all pricing writers/readers without changing v2 history.
2. Close known exact-value consumer gaps: customer list/SQL aggregate, operational financial estimates, assignment discount reconstruction, distributor/NCM/OTP/order finance outputs, discount analytics, item/product sales analytics, and portal label/invoice calculations. Preserve existing numeric response fields while adding exact strings.
3. Complete line/item historical identity and return/exchange/refund linkage; classify component provenance as unavailable instead of reconstructing it from current rules.
4. Resolve field-specific ranges/scales and API/UI precision for Product unit prices, percentage rules, bundle values, campaign thresholds, and conditional marketing-benefit value. Keep `Product.costPrice` a catalog/reference input and preserve cost-layer COGS authority.
5. Produce/additive migration and read-only drift tooling only after sign-off. Historical backfill/cutover, persisted transaction/rollback/concurrency tests, external remittance reconciliation, returns/refunds, COD/customer receipt, inventory/COGS, and cross-report reconciliation remain open.

**R24:** COMPLETE for the static inventory, v3 design, migration/drift specification and explicit gap list in this document.
**R8:** PARTIAL; repository-wide semantic classification and writer/reader/report coverage remain incomplete.
**P4.2:** INCOMPLETE; other domains, historical conversion, database validation, and reconciliation remain.
**P4.3:** IN PROGRESS, INCOMPLETE; no P4.3 validation is claimed by R24.
**Phase 4:** INCOMPLETE. Phase 5 was not started.

## 9. Subsequent first-code-increment evidence

The v3 writer/reader service and primary writer wiring are implemented in `backend/services/checkoutPricingService.js`, `backend/services/locationPricingService.js`, `backend/controllers/orderController.js`, `backend/controllers/manufacturerDirectOrderController.js`, and `backend/controllers/distributorDirectOrderController.js`. V3 preserves the existing string `quantity` alias and adds `quantityMeasure: { value, unit }`; it records `catalogUnitPrice`, `acceptedUnitPrice`, `lineGross`, ordered `pricingSteps`, typed `discountComponents`, signed `lineAdjustments`, `lineDiscountTotal`, `acceptedLineTotal`, typed order-level `adjustments`, order totals, `acceptedAt`, and completeness state. It enforces price-step continuity and line/order reconciliation. Catalog prices sourced from current Float fields are labeled `PRODUCT_FLOAT_COMPATIBILITY`; this does not restore source precision.

The four creation paths now write v3, and shared readers (`exactPricingApiFields`, `pricingSnapshotAmounts`, delivered-sale posting and the delivery outbox) accept v3 and continue to accept v2. Existing numeric fields remain unchanged and additive exact API values identify numeric mirrors as compatibility-only. V2 construction remains available for representative historical/test fixtures. Focused mocked regression tests passed **123/123** across checkout, location pricing, order projection/splitting, direct-order paid-state guards, Admin direct-order service, delivered-sale posters, and outbox. Syntax checks passed for the changed backend modules. This does not yet update every operational, portal, return, exchange, refund, invoice, or analytics reader to use v3 provenance, nor does it test a persisted database, a mounted end-to-end pricing request, historical conversion, or deployed schema.
