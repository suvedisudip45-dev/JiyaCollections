# Phase 4.0 — Financial Precision and Nepal-Calendar Audit

**Status:** This document began as the Phase 4.0 static audit; implementation evidence is recorded in later sections. Phase 4 is **not complete**. Database, migration, historical-conversion, and reconciliation claims are limited to the evidence explicitly recorded below.

## 1. Executive findings and evidence boundary

- A fresh field-line scan of the current Prisma schema contains **135 `Float` and 141 `Decimal` scalar declarations**. Against tracked `HEAD` (142 `Float`, 127 `Decimal`), seven fields moved from Float to Decimal and seven Decimal fields were added. The counts include monetary, rate, quantity, measurement, and conversion-evidence fields; they are not a count of monetary fields. The field inventory is in Section 2.
- At least some Float fields are clearly money or monetary rates, including order prices, expenses, assets, loans, returns, delivery settlements, and marketing amounts. Others are nonfinancial (`Story.assignmentWeight`, quality ratings), quantities (`PartnerEquity.shareCount`, `CompanyValuation` share counts), or percentages/rates. Name-based inference is insufficient to classify all fields. Section 3 records the domain-level writer/reader trace and the remaining per-field trace work.
- Decimal persistence already exists in GL, payable/receivable, tax invoices, allocations, several partner/distributor/manufacturer domains, and cost layers. It does **not** make upstream JavaScript calculations exact. The P4.2 pilot and the posted GL reports now use the shared Decimal layer in selected paths; material expense, tax, loan, depreciation, settlement, dashboard, and export paths still require review.
- The existing journal helper rounds each debit and credit to 2 decimal places with `ROUND_HALF_UP`, accepts JavaScript Number inputs by stringifying them, rejects negative line amounts, and checks equality after rounding. This is current behavior, not an approved general line/tax/document/allocation policy.
- High-impact binary arithmetic remains in `accountingPostingEngine.js`, `financialController.js`, `corporateIncomeTaxService.js`, `fixedAssetDepreciationService.js`, `loanAccountingService.js`, subledger/reconciliation services, and many Admin reports. The General Ledger, trial-balance, and real-time posted financial-statement controllers now use Decimal calculations and decimal-string amounts; their Admin consumers use exact decimal formatting. Other accounting-health displays and payment/credit-application UI paths still require audit.
- A repository-wide search returned thousands of `Number`, `parseFloat`, `toFixed`, and `Math.*` occurrences, many unrelated to money. Counts from those searches are not a financial defect count. Prioritize exact call-path review and tests rather than a blanket text replacement.
- `NepaliCalendarYear.adStartDate` is the identified `DateTime @db.Date` field. Most business and financial dates are `DateTime`; their date-only versus instant meaning is not encoded by the scalar type. The central backend utility uses `Asia/Kathmandu`, validates BS/AD inputs, and preserves explicit timestamps. General Ledger, trial-balance, and real-time financial-statement filters now use shared date resolution and half-open Kathmandu date-only end bounds; other controllers, exports, jobs, and external integrations still need boundary review.
- The existing migration history includes direct `TaxFilingRecord` Float-to-Decimal `MODIFY` statements to scale 2. That migration source is evidence of a conversion strategy in code, not evidence that it ran in any target database or that historical conversion differences were measured.
- The strongest safe ordering is: finish the P4.0 classification and policy proposals; build and test the Decimal layer; finish critical writer/reader traces; only then design and validate database conversion batches. Do not start a broad migration while critical writers still calculate with Number.

### Evidence labels

- **Verified:** directly visible in checked-in schema, source, migration, or passing test.
- **Indicated:** inferred from field names, search results, or a partial caller trace; confirm in P4.2.
- **Pending:** requires business/management/accounting approval, representative data, database-backed validation, or additional source tracing.

No live database was queried. No historical values, row counts, null distributions, conversion deltas, or production migration statuses are asserted.

## 2. Prisma numeric-field inventory

This appendix lists the current `Float` and `Decimal` scalar fields in `schema.prisma` (135 and 141 respectively). `F` means Prisma `Float`; `D(p,s)` means Prisma `Decimal @db.Decimal(p,s)`. A field's semantic class, currency/unit, null/default implications, writer, and reader must be confirmed before migration; the names below do not establish those facts. The domain trace in Section 3 gives known entry points and explicitly leaves incomplete mappings open.

For compactness the tables omit each field's `?` optional marker and `@default(...)`; the canonical schema remains authoritative for those constraints. P4.2 must carry nullability/default behavior into the field-to-writer matrix before migration. Thus the scalar-name/type census is exhaustive, while the full field contract is not yet complete.

The earlier 2026-11-15 inventory recorded 59 of 141 Decimal declarations with an explicit Prisma native database scale. A fresh R8 scan of the current working tree found all 141 Decimal declarations use `@db.Decimal`: 125 `(20,2)`, 11 `(5,2)`, two `(30,14)`, and one each `(65,30)`, `(8,2)`, and `(8,3)`. The earlier 59/82 split is superseded for the current schema file. These schema annotations include percentages, physical measurements, per-unit costs, and conversion evidence; they are not all currency fields. The actual MySQL column definitions for the unavailable configured database were not queried, so no database-scale inventory is claimed.

### 2.1 Storefront, pricing, shipping, procurement, and expenses

| Model | Float fields | Decimal fields |
|---|---|---|
| `Story` | `assignmentWeight` | — |
| `LetterTemplate` | `selectionWeight` | — |
| `Product` | `price`, `discount`, `costPrice` | — |
| `ComboBundle` | `calculatedPrice`, `sellingPrice`, `discountPercentage` | — |
| `Order` | `amount`, `deliveryFee`, `loyaltyDiscount` | — |
| `ShippingConfig` | `sameDistrictFee`, `differentDistrictFee`, `sameProvinceFee`, `differentProvinceFee`, `sameProvinceDoorToDoorFee`, `sameProvinceDoorToHubFee`, `differentProvinceDoorToDoorFee`, `differentProvinceDoorToHubFee`, `splitShipmentFee`, `splitShipmentDoorToDoorFee`, `splitShipmentDoorToHubFee`, `freeShippingMin`, `ncmReturnSettlementRate`, `ncmExchangeSettlementRate`, `distributorReturnSettlementRate`, `distributorExchangeSettlementRate`, `customerReturnChargeRate` | — |
| `CustomerLevel` | `minSpend`, `rewardValue`, `discountAmount`, `giftAmount` | — |
| `LoyaltyTierConfig` | `minSpendThreshold`, `giftTargetValue` | — |
| `GiftCatalog` | `priceValue` | — |
| `GiftRewardEntitlement` | `rewardValue` | — |
| `SpecialOffer` | `discount` | — |
| `InboundShipment` | `totalFreightCost`, `customsOrTaxes`, `totalItemsCost`, `totalLandedCost`, `paidAmount`, `payableAmount` | — |
| `MonthlyExpense` | `marketingSpend`, `officeRent`, `utilities`, `salaries`, `softwareTools`, `packagingCostPerUnit`, `miscExpenses` | — |
| `MarketingCampaign` | `minOrderValue`, `cpaRate` | — |
| `MarketingBenefit` | `value`, `maxDiscountAmount`, `percentage` | — |
| `MarketingPartnerSettlement` | `cpaRate`, `totalAmount` | — |
| `LocationProductDiscount` | — | `discountPercentage D(5,2)` |
| `ShippingRateCache` | `weightKg`, `rateNPR` | — |

### 2.2 Accounting, treasury, returns, tax, and documents

| Model | Float fields | Decimal fields |
|---|---|---|
| `FinancialAccount` | — | `currentBalance D(20,2)`, `reservedBalance D(20,2)` |
| `CashTransaction` | — | `amount D(20,2)` |
| `FinancialPayout` | — | `amount D(20,2)`, `settlementAmount D(20,2)`, `adjustmentAmount D(20,2)` |
| `CustomerReturn` | `totalRefundAmount`, `vatRefunded`, `ncmDeliveryCharge`, `logisticsSettlementAmount` | `approvedRefundAmount D(20,2)` |
| `OrderExchangeRequest` | `ncmReturnCharge`, `ncmReplacementCharge`, `ncmTotalCharge`, `logisticsSettlementAmount` | `originalTotalValue D(20,2)`, `replacementTotalValue D(20,2)`, `priceDifference D(20,2)`, `priceDifferenceCodAmount D(20,2)` |
| `SupplierReturn` | — | `totalDebitAmount D(20,2)`, `vatReversal D(20,2)` |
| `TaxConfiguration` | `vatRate` | — |
| `VatRateVersion` | — | `vatRate D(5,2)` |
| `CorporateTaxPolicyVersion` | — | `baseRate D(5,2)` |
| `TaxFilingRecord` | `grossRevenue`, `totalDeductions`, `depreciationDeduction`, `taxableIncome`, `calculatedTax` | `taxableSales D(20,2)`, `outputVat D(20,2)`, `taxablePurchases D(20,2)`, `inputVat D(20,2)`, `carriedForwardInputVat D(20,2)`, `carriedForwardOutputVat D(20,2)`, `vatCreditCarryForward D(20,2)`, `carriedForwardPaymentCredit D(20,2)`, `paymentCreditApplied D(20,2)`, `netVatPayable D(20,2)`, `taxPaid D(20,2)`, `assessedAmount D(20,2)` |
| `TaxFilingAmendment` | — | `previousAssessedAmount D(20,2)`, `amendedAssessedAmount D(20,2)`, `adjustmentAmount D(20,2)` |
| `SalesInvoice` | — | `vatRate D(5,2)`, `taxableAmount D(20,2)`, `vatAmount D(20,2)`, `totalAmount D(20,2)` |
| `SalesInvoiceAdjustment` | — | `amount D(20,2)`, `vatAmount D(20,2)` |
| `TaxFilingPayment` | — | `amount D(20,2)` |
| `OperatingExpense` | — | `amount D(20,2)`, `vatAmount D(20,2)`, `paidAmount D(20,2)`, `payableAmount D(20,2)`, `purchaseTaxableAmount D(20,2)`, `purchaseVatRate D(5,2)` |
| `DirectIncome` | `amount` | — |
| `AccountPayable` | — | `totalAmount D(20,2)`, `paidAmount D(20,2)`, `creditAppliedAmount D(20,2)`, `remainingBalance D(20,2)` |
| `AccountReceivable` | — | `totalAmount D(20,2)`, `receivedAmount D(20,2)`, `remainingBalance D(20,2)` |
| `Account` | — | `currentBalance D(20,2)` |
| `JournalEntry` | — | `totalDebit D(20,2)`, `totalCredit D(20,2)` |
| `JournalLine` | — | `debit D(20,2)`, `credit D(20,2)` |
| `AccountingDocument` | — | `originalAmount D(20,2)`, `allocatedAmount D(20,2)`, `remainingAmount D(20,2)` |
| `AccountingAllocation` | — | `amount D(20,2)` |
| `SupplierCreditApplication` | — | `amount D(20,2)` |
| `SupplierReturnCreditApplication` | — | `amount D(20,2)` |
| `CollaborationFeeCreditApplication` | — | `amount D(20,2)` |
| `SettlementReversion` | `offsetAmount` | `originalAmount D(20,2)`, `priorPaidAmount D(20,2)`, `priorRemainingBalance D(20,2)` |
| `AccountingDecimalConversionEvidence` | — | `convertedValue D(20,2)`, `drift D(65,30)` |

### 2.3 Assets, equity, loans, and partner/distributor/manufacturer operations

| Model | Float fields | Decimal fields |
|---|---|---|
| `FixedAsset` | `purchaseCost`, `salvageValue`, `depreciationRate`, `accumulatedDepreciation`, `currentBookValue`, `paidAmount`, `payableAmount`, `disposalAmount`, `scrapLossAmount` | — |
| `PartnerEquity` | `shareCount`, `sharePrice`, `ownershipPercentage`, `initialCapital`, `currentCapital`, `totalDrawings`, `totalDistributionsReceived` | — |
| `CompanyValuation` | `preMoneyValuation`, `investmentAmount`, `postMoneyValuation`, `totalPreShares`, `newSharesIssued`, `totalPostShares`, `sharePrice` | — |
| `ShareTransaction` | `shareCount`, `sharePrice`, `totalAmount`, `equityPercentageTransferred` | — |
| `ProfitDistribution` | `grossRevenue`, `netProfit`, `retainedEarningsPercentage`, `retainedAmount`, `distributableAmount` | — |
| `InvestorLiability` | `principalAmount`, `principalPaid`, `interestPaid`, `totalInterestPayable`, `amountRepaid`, `outstandingBalance`, `interestRate`, `monthlyInstallment`, `equityGrantedPercentage` | — |
| `Manufacturer` | `qualityRating` | — |
| `Distributor` | `qualityRating` | — |
| `DeliveryOtpChallenge` | — | `collectionAmount D(20,2)` |
| `DistributorRemittanceBatch` | — | `amount D(20,2)` |
| `DistributorCashEvent` | — | `amount D(20,2)` |
| `DistributorSettlementOffset` | — | `amount D(20,2)` |
| `DistributorBalanceSettlement` | — | `receivableApplied D(20,2)`, `payableApplied D(20,2)`, `cashAmount D(20,2)`, `offsetAmount D(20,2)` |
| `DistributorSettlementRequestToken` | — | `requestedAmount D(20,2)` |
| `DistributorDeliveryChargeNegotiation` | — | `deliveryCharge D(20,2)`, `returnCharge D(20,2)`, `stockTransferCharge D(20,2)`, `ncmTransferCharge D(20,2)`, `counterSaleCharge D(20,2)`, `commissionRate D(20,2)`, `bonusRate D(20,2)`, `incentiveRate D(20,2)`, `vatRate D(5,2)` |
| `DistributorServiceEarning` | — | `deliveryCharge D(20,2)`, `incentiveAmount D(20,2)`, `commissionAmount D(20,2)`, `otherCharges D(20,2)`, `vatRate D(5,2)`, `vatAmount D(20,2)`, `payableAmount D(20,2)`, `appliedReversalAmount D(20,2)` |
| `DistributorBonusEarning` | — | `bonusAmount D(20,2)` |
| `DistributorSettlementRequest` | — | `amount D(20,2)`, `paidAmount D(20,2)`, `grossEarnings D(20,2)`, `incentives D(20,2)`, `bonuses D(20,2)`, `discountsApplied D(20,2)`, `chargesApplied D(20,2)`, `vatAmount D(20,2)`, `netPayable D(20,2)` |
| `StockTransferShipment` | — | `freightCharge D(20,2)`, `freightPaidAmount D(20,2)`, `packageWeight D(8,3)` |
| `InventoryDiscrepancy` | — | `platformLossAmount D(20,2)` |
| `DistributorStockReturnLine` | — | `layerCogsAmount D(20,2)` |
| `CollaborationTermsVersion` | — | `fixedFeePerUnit D(20,2)`, `retailPrice D(20,2)`, `discountPercentage D(5,2)` |
| `CollaborationSale` | — | `unitSellingPrice D(20,2)`, `unitDiscount D(20,2)`, `partnerFeePerUnit D(20,2)` |
| `CollaborationFeeInvoice` | — | `netAmount D(20,2)`, `vatAmount D(20,2)`, `totalAmount D(20,2)` |
| `CollaborationFeeInvoiceLine` | — | `unitFee D(20,2)`, `netAmount D(20,2)`, `vatAmount D(20,2)`, `totalAmount D(20,2)` |
| `ManufacturerInventory` | `proposedCostPrice`, `agreedCostPrice` | — |
| `ManufacturerProductionRequest` | — | `proposedUnitCogs D(20,2)`, `proposedDeliveryCost D(20,2)`, `vatRate D(5,2)`, `approvedUnitCogs D(20,2)`, `approvedDeliveryCost D(20,2)`, `approvedVatRate D(5,2)`, `gsm D(8,2)` |
| `ManufacturerSettlementRequest` | — | `amount D(20,2)`, `paidAmount D(20,2)` |
| `ManufacturerInventoryCostLayer` | — | `unitCogs D(30,14)`, `unitVatAmount D(30,14)`, `vatRate D(5,2)`, `unitDeliveryCost D(20,2)` |

### 2.4 Delivery and NCM

| Model | Float fields | Decimal fields |
|---|---|---|
| `DeliveryOrder` | `packageWeight`, `itemAmount`, `customerDeliveryCharge`, `ncmDeliveryCharge`, `ncmDeliveryChargeBeforeDiscount`, `ncmDeliveryDiscount`, `codAmount` | — |
| `DeliveryFinancialSettlement` | `codExpected`, `codCollected`, `deliveryFeeExpected`, `deliveryFeeActual`, `deliveryFeeDiscount`, `otherAdjustments`, `manufacturerPayable`, `platformReceivable` | — |
| `NcmSettlementBatch` | — | `totalCod D(20,2)`, `totalCarrierFee D(20,2)`, `expectedNetDeposit D(20,2)`, `actualNetDeposit D(20,2)`, `varianceAmount D(20,2)` |
| `NcmSettlementVarianceResolution` | — | `amount D(20,2)` |

### 2.5 Clearly non-monetary or ambiguous examples requiring classification

The schema inventory also contains fields that should not be migrated as money merely because they are numeric: `Story.assignmentWeight`, `LetterTemplate.selectionWeight`, `Manufacturer.qualityRating`, `Distributor.qualityRating`, `FixedAsset.depreciationRate`, ownership/interest/tax percentages, share counts, package weights, `ManufacturerProductionRequest.gsm`, and integer stock quantities. Some amount-like fields such as reward values, CPA rates, commissions, shipment cost fields, and settlement rates require business-unit confirmation before selecting scale or currency.

## 3. Quantity, rate, and unit inventory

The Prisma inventory does not provide domain-level units. The following stock/production quantity fields are stored as integers and represent discrete item counts by their model and name; fractional-unit support must not be assumed:

| Domain | Models and fields |
|---|---|
| Product/gift stock | `Product.stockQuantity`; `ManufacturerGiftInventory.quantityAvailable`, `quantityReserved`; `GiftMovementLog.quantity`, `uncostedQuantity`; `DistributorGiftInventory.quantitySent`, `quantityAvailable`, `quantityReserved`, `receivedQuantity`; `DistributorGiftMovementLog.quantity`; `StockLog.previousQty`, `newQty`, `changeQty` |
| Inventory and stock transfer | `InventoryBalance.quantityOnHand`, `reservedQuantity`; `InventoryLedgerEntry.quantity`; `StockTransferLine.requestedQuantity`, `approvedQuantity`, `dispatchedQuantity`, `reservedShipmentQuantity`; `StockTransferShipmentLine.quantity`, `uncostedQuantity`; `StockTransferShipmentLineCostLayer.quantity`; `StockTransferReceiptLine.goodQuantity`, `damagedQuantity`, `missingQuantity`; `InventoryDiscrepancy.quantity` |
| Returns and marketing | `DistributorStockReturnLine.requestedQuantity`, `approvedQuantity`, `heldQuantity`, `costedQuantity`, `uncostedQuantity`; `DistributorStockReturnCollectionLine.collectedQuantity`, `receivedGoodQuantity`, `receivedDamagedQuantity`, `missingQuantity`; `DistributorStockReturnInspectionLine.quantity`; `MarketingCampaign.requestedQuantity`, `generatedQuantity`; `MarketingCardBatch.quantity`; `MarketingBenefit.quantity`, `assignedQuantity` |
| Collaboration and manufacturing | `CollaborationSale.quantity`, `quantityReturned`, `quantityInvoiced`, `quantityCredited`; `CollaborationFeeInvoiceLine.quantity`; `ManufacturerInventory.quantity`, `reservedQty`; `ManufacturerProductionRequest.minimumOrderQuantity`, `approvedMinimumOrderQuantity`; `ManufacturerProductionRequestLine.quantity`, `actualQuantity`, `damagedQuantity`; `ManufacturerInventoryCostLayer.producedQuantity`, `availableQuantity`, `reservedQuantity`, `consumedQuantity`; `ManufacturerInventoryCostAllocation.quantity`, `returnedQuantity`; `ManufacturerInventoryMovement.previousQty`, `newQty`, `changeQty` |

Other numeric precision/unit fields requiring classification include `FixedAsset.usefulLifeMonths` (integer duration), `FinancialAccount` and `Account` balances (NPR is used by existing posting flows but currency is not carried on every row), `DistributorDeliveryChargeNegotiation` `commissionRate`/`bonusRate`/`incentiveRate` (stored as `Decimal(20,2)`, despite rate semantics), `ManufacturerInventoryCostLayer.unitCogs`/`unitVatAmount` (`Decimal(30,14)`), `StockTransferShipment.packageWeight` (`Decimal(8,3)`), `DeliveryOrder.packageWeight` and `ShippingRateCache.weightKg` (`Float`), and `ManufacturerProductionRequest.gsm` (`Decimal(8,2)`). Do not assume a universal scale for physical quantities, unit rates, percentages, or per-unit costs.

## 4. Critical arithmetic-path and report inventory

This is a verified high-risk starting map, not an exhaustive caller graph. Any `Number` use must be classified as parsing, identifier/count conversion, display serialization, or monetary arithmetic before it is changed.

| Domain/path | Verified source and arithmetic evidence | Journal/report impact and P4.2 action |
|---|---|---|
| Journal normalization/posting | `backend/services/accountingMoney.js` constructs `Prisma.Decimal(String(value))`, rounds each line to 2 places using `ROUND_HALF_UP`, and validates debit-credit equality. `backend/services/accountingPostingEngine.js` calls this at journal posting, but callers may already have converted values. | Preserve source strings/Decimals to the posting boundary. Inventory all posting call sites; decide approved precision and rounding boundaries before changing this helper. Test exact equality before and after database round trip. |
| Orders, pricing, fulfillment, COD | `Product`, `Order`, `DeliveryOrder`, `DeliveryFinancialSettlement`, and shipping fields mix Float and Decimal domains. `accountingPostingEngine.js` uses `Number(order.amount)`, converts COGS and tax results to Number, and rounds via `toFixed`; delivery/settlement services also consume these source fields. | Trace cart/discount/price → order snapshot → payment/return → GL and NCM/distributor settlement. Keep order amounts, delivery fees, discounts, COD, carrier fees, returns, and COGS on the same calculation result. |
| Expense, direct income, payable | `OperatingExpense.amount` and `vatAmount`, and `DirectIncome.amount`, remain Float; VAT support columns and common AP documents are Decimal. Expense writers are in `backend/controllers/expenseController.js`; accounting document/AP and poster flows are separate services. | High-priority mixed-type source-to-document-to-journal path. Trace create/edit, payment, vendor allocation, VAT, reversals, reports, and serialization before any column conversion. |
| Tax and invoice | `SalesInvoice`, `VatRateVersion`, corporate tax policy and much of VAT filing use Decimal. Legacy `TaxConfiguration.vatRate`, several `TaxFilingRecord` fields, and corporate tax calculations still use Float/Number. `corporateIncomeTaxService.js` converts policy/income to Number for brackets and tax totals. | Keep tax treatment unchanged. Verify effective date and policy snapshot, taxable base, rate, line/document tax, filing, payment, and correction path using independently approved calculations. |
| Inventory and COGS | On-hand/allocated unit quantities are generally Int; layer unit costs use `Decimal(30,14)`, while legacy product and manufacturer cost fields include Float. `inventoryLedgerService.js` converts quantities to Number; `accountingPostingEngine.js` contains quantity × cost paths with Number conversions. | Trace each SKU/location/owner quantity × supported cost layer into movement value, COGS, payable and GL. Keep quantities and money separate; no use of `Product.costPrice` as a substitute for source layer cost without explicit policy. |
| Treasury, cash flow, GL and financial statements | `accountingCashFlowService.js` now aggregates with shared Decimal arithmetic and returns decimal strings. General Ledger, trial-balance and real-time posted-statement controllers use Decimal sums and string outputs; date-only report ends use half-open Kathmandu-local boundaries. Treasury-to-GL control reconciliation now also uses Decimal aggregation, exact variance checks, and decimal-string output. The corresponding Admin display formats strings without Number conversion and identifies the account 1180 limitation. | Operational Treasury transaction creation/receipt paths and other reconciliation services still contain Number conversions or need review. The exact Treasury-to-mapped-GL control comparison is not bank/provider reconciliation. No database-backed report/source reconciliation has been run for this increment. |
| Fixed assets and depreciation | FixedAsset monetary book fields are Float. `fixedAssetDepreciationService.js` uses Number arithmetic/`toFixed` and posts an accounting journal. | Convert the full asset-register roll-forward and disposal path, not only journal storage. Preserve period/idempotency and compare asset books, journals and reports. |
| Loans, equity and profit estimates | Investor liability and partner/equity models use Float; `loanAccountingService.js` and multiple `accountingPostingEngine.js` routines convert principal, interest, payment and share amounts to Number. Some profit-distribution paths are explicitly estimate-only. | Keep estimates separate from posted balances. Trace agreements, schedules, drawdowns, repayments, interest, share transactions, payouts and corrections. Quantities/shares and money need distinct types. |
| Supplier/manufacturer/distributor/marketing settlements | Many recent settlement/application records are Decimal while older source records and the legacy marketing settlement totals remain Float. Services include `ncmSettlementService.js`, `distributorCashSettlementService.js`, `manufacturerSettlementService.js`, `marketingCpaSettlementService.js`, and supplier-credit application services. | Trace gross, deductions, tax, offsets, cash, reversal and paid amounts end-to-end. Validate mixed legacy/new records and never convert display Numbers back into accounting inputs. |
| Dashboards and operational reports | Admin finance, asset, tax, returns, distributor, manufacturer, marketing and delivery screens commonly coerce API values to Number for calculations or display. Backend financial statement and subledger endpoints also aggregate Numbers. | For each output, mark whether it is posted GL, source subledger, estimate, or presentation-only. Inventory the actual PDF/print, JSON, CSV and API serializers for each. Search results found print-sheet and invoice flows; absence of a match is not proof no export exists. |

### Arithmetic conversion distinctions

- `Number(value)` and `parseFloat(value)` at the request boundary can be validation/parsing only, but become financial precision risks when their result is multiplied, summed, compared, rounded, or passed to Prisma as an amount.
- `toFixed()` is a formatting operation; using it after binary floating arithmetic does not restore lost precision.
- `toNumber()` and `Number(PrismaDecimal)` at a final API boundary are presentation/serialization conversions only if no later arithmetic or persistence uses the result and the chosen API contract can represent the value exactly. JSON has no native Decimal type; a decimal string is the safer exact transport representation.
- `Math.round((amount + Number.EPSILON) * 100) / 100` in cash flow is an explicit current rounding behavior, not a confirmed company policy.
- Reconstructing Decimal from `String(number)` cannot recover precision already lost in binary arithmetic.

## 5. Decimal architecture proposal and policy decisions

### 5.1 Smallest compatible implementation

`@prisma/client` is already a dependency and exports `Prisma.Decimal` (Decimal.js-compatible). No additional package is justified by this audit. Extend/extract a shared utility around the existing `accountingMoney.js` rather than adding multiple arithmetic libraries.

Recommended responsibilities:

1. **Exact constructors:** accept canonical decimal strings, Prisma Decimal values, and explicitly documented legacy-number adapters. Reject empty, malformed, `NaN`, and infinite inputs; enforce approved range/scale constraints. Critical financial APIs should prefer decimal strings. Do not silently map missing values to zero unless that field's domain contract explicitly defines zero.
2. **Arithmetic:** expose Decimal addition, subtraction, multiplication, division, comparison and aggregation. Prevent implicit JS operators and Number conversions in financial services.
3. **Policy-injected quantization:** keep calculation precision separate from currency scale; require an explicit policy identifier and rounding boundary for quantization. Do not hard-code NPR behavior into generic money constructors.
4. **Allocation/tax:** deterministic exact allocation with residual handling, approved tax base/rate and rounding policy, and consistent source/document/journal amounts. Do not invent which line receives residual paisa.
5. **Journal validation:** compare Decimal debit/credit totals exactly at the approved journal quantum; do not silently round each line before deciding that a source is balanced.
6. **Prisma:** pass Decimal values/decimal strings to Decimal columns; do not use `Number` on the way in. Validate field precision/range and migration scale before writes.
7. **Serialization:** API monetary values should use a documented decimal-string representation for exact values; use a shared formatter only at UI/export presentation boundaries. Never feed formatted strings back into calculations.
8. **Legacy adapter:** isolate Float reads/writes; record source type, explicit conversion, and before/after delta. Remove adapter only after all writers/readers and migrations are verified.

### 5.2 Decisions that remain pending approval

| Decision | Proposal needed; no decision adopted here |
|---|---|
| Currency and storage | Confirm supported currencies and precision/scale by currency; current `NPR` literals and `Decimal(20,2)` are implementation facts, not authorization for every domain. |
| NPR minor unit | Confirm whether/how all transaction and posting values are rounded to paisa, with approver, effective date and evidence. |
| Rounding mode and stages | Approve whether and where rounding occurs for unit price, line, tax, document, allocation, journal, settlement, depreciation and reports. |
| Tax | Approve effective-dated rate/treatment rules and taxable-base rounding independently; this audit changes no tax policy. |
| Allocation residual | Approve deterministic residual-paisa allocation for split payments, refunds, tax and supplier credits. |
| Journal equality | Define the exact allowed quantum; current helper rounds inputs to 2 places before equality. |
| Quantities/unit costs | Approve integer/fractional quantity scales, package weight/GSM scales, cost-layer precision and unit-price precision. |
| Percentages and rates | Confirm unit convention (e.g. 13 vs 0.13), scale, bounds and whether a “rate” is currency-per-unit, percentage or amount. |
| Currency conversion | No exchange-rate field/policy was verified in this scan. Confirm whether foreign-currency events exist; if so define currency, rate source, time, scale and realized/unrealized differences. |
| Historical changes | Decide how to treat conversion deltas without editing posted journals; only authorized linked correction entries may change historical accounting. |

Until approved, leave existing policy-sensitive calculations unchanged and record this as an implementation blocker, not a developer-selected default.

## 6. Float-to-Decimal migration assessment

| Batch | Fields/models requiring semantic review | Main migration risk and minimum evidence |
|---|---|---|
| A — order/commerce/fulfillment | `Product`, `ComboBundle`, `Order`, `ShippingConfig`, `CustomerLevel`, `GiftCatalog`, `InboundShipment`, `DeliveryOrder`, `DeliveryFinancialSettlement`, `ShippingRateCache` | Mix of money, thresholds, discounts, percentage rates and weight. Confirm units, old API coercions, default/null behavior and downstream snapshots. Compare exact legacy Float representation, proposed decimal string, rounded result and totals before deciding direct vs staged migration. |
| B — expense/AP/income/supplier credit | `OperatingExpense`, `DirectIncome`, `MonthlyExpense`, `SupplierReturn`, `SettlementReversion`; already-Decimal `AccountingDocument`, AP and allocation records | Mixed source/ledger types; changing only one field can introduce source-vs-GL divergence. Preserve source evidence and linked documents. Verify null/default behavior, partial allocation and reversal histories. |
| C — VAT and income-tax workpapers | `TaxConfiguration`, `TaxFilingRecord` Float fields and any legacy tax amounts/rates | Some tax filing values were directly modified to `DECIMAL(20,2)` by `20261102020000_seller_tax_profile_and_filing_payments/migration.sql`; no conversion report is included in that SQL. Establish actual database migration state and review historical values before further conversion. |
| D — assets, debt, capital and shares | `FixedAsset`, `PartnerEquity`, `CompanyValuation`, `ShareTransaction`, `ProfitDistribution`, `InvestorLiability` | Separate money from rates, durations and fractional share counts. Check JSON loan schedules, estimates vs posted records, and historical journals; do not backfill from GL or estimates without source evidence. |
| E — delivery and partner settlements | `CustomerReturn`, `OrderExchangeRequest`, `MarketingPartnerSettlement`, `Distributor*`, `ManufacturerInventory`, `SettlementReversion`, and all money-like fields in delivery/courier integrations | Existing Decimal and Float representations coexist. Reconcile source event, payable/receivable, cash movement and journal keys. Confirm external evidence/idempotency before changing settlement totals. |
| F — inventory valuation/COGS | `ManufacturerInventory` Float cost fields, product cost fields and existing `ManufacturerInventoryCostLayer D(30,14)` | Quantity, unit cost, VAT-per-unit, delivery allocation and total value use different scales. Preserve layer and allocation lineage; require opening quantity/cost support and drift report. |

For every field included in a batch, require a signed-off row-level mapping with model/field, semantic class, currency/unit, old and new SQL type, intended precision/scale, null/default behavior, writers, readers, arithmetic, journal effect, date basis, migration plan, and tests. Generate record count, null/invalid count, min/max, source and converted value, rounded-row count, signed/absolute difference and aggregate difference by model/account/period in a representative isolated data copy. This report has not been run because no database was queried.

Current SQL evidence: `0_init/migration.sql` creates numerous Float-backed amounts as MySQL `DOUBLE`; the VAT migration above modifies selected `TaxFilingRecord` fields directly to Decimal; other migrations add Decimal settlement/document fields. This demonstrates mixed historical strategies, not a completed or validated monetary migration.

## 7. Nepal-calendar and timezone audit

### 7.1 Entry-point inventory

| Entry point | Verified behavior and unresolved contract |
|---|---|
| `backend/services/nepaliFiscalCalendar.js` | Shared backend conversion; uses `Asia/Kathmandu`, fixed UTC+05:45, configured BS year/month lengths and `nepali-date-converter`; validates impossible BS/AD dates and reversed ranges; date-only filters use inclusive local-day boundaries; explicit timestamps pass through as instants in its input resolver. Preserve and extend. |
| `backend/controllers/expenseController.js` | Uses shared date input/range/filter resolvers for expense/income create and list filters. Verify all date fields and caller calendar defaults, including due dates. |
| `backend/controllers/accountingController.js` | Several accounting report endpoints use configured BS ranges or an internal AD date-only boundary. `getRealtimeFinancialStatements` has a second parser; it mutates any non-date-only end timestamp with local `setHours`, so explicit instant preservation and host timezone are not guaranteed there. Consolidate only after regression tests. |
| `backend/controllers/financialController.js` | Profit-distribution estimates, financing dates and tax projections use shared calendar input functions on some routes; inspect all request parsing and reports for remaining direct `new Date` and date-only inputs. |
| `backend/controllers/vatFilingController.js`, `vatRateController.js`, `corporateTaxPolicyController.js` | Shared conversion is used for filing, amendment, payment and effective-from inputs. Verify `effectiveUntil` and transaction-date policy selection, inclusive/exclusive boundaries, and stored policy snapshot. |
| `backend/controllers/salesInvoiceController.js` | Shared resolver used for invoice issue date; `SalesInvoice.taxPoint` semantics and relation to order/receipt time need explicit business-date vs instant definition. |
| `backend/controllers/paperBillController.js` | Shared date range resolver is used for report period filtering. Verify date semantics for imported/printed document dates. |
| `backend/services/accountingPostingEngine.js` | Converts transaction date to JS `Date` and derives fiscal year/period. Define accepted input semantics and prevent date-only strings from being interpreted using host defaults. |
| `admin/src/utils/nepaliDate.js` and Admin Nepali date pickers/calendar | UI formatting uses Asia/Kathmandu and configured calendars; fallback uses `nepali-date-converter`. Browser-side conversions return strings/empty values and need parity tests against backend behavior, especially configured-year gaps and invalid values. |
| Other portals/integrations | Repository search found calendar-related formatting in frontend/manufacturer/marketing. These are primarily displays in the inspected hits; verify all API payloads that submit business dates and all third-party date fields in P4.2/P4.5. |

### 7.1.1 Material Prisma date fields

The following non-audit timestamp fields were identified in financial and fiscal models; each is currently Prisma `DateTime` unless noted. They need a declared business-date/instant/fiscal-period contract and a writer/query path in P4.5. Creation/update and workflow-event timestamps also remain instants but are not repeated in this list.

| Area | Fields |
|---|---|
| Cash, assets, financing, returns | `CashTransaction.date`; `FinancialPayout.initiatedAt`, `settledAt`, `failedAt`; `FixedAsset.purchaseDate`, `disposalDate`; `CompanyValuation.effectiveDate`; `ShareTransaction.date`; `ProfitDistribution.periodStart`, `periodEnd`; `InvestorLiability.startDate`, `maturityDate`; `CustomerReturn.returnDate`; `OrderExchangeEvent.occurredAt`; `CustomerReturnEvent.occurredAt`; `SupplierReturn.returnDate`; `InboundShipment.shipmentDate` |
| Tax and invoice | `TaxRegistrationVersion.effectiveFrom`, `effectiveUntil`; `VatRateVersion.effectiveFrom`, `effectiveUntil`; `CorporateTaxPolicyVersion.effectiveFrom`, `effectiveUntil`; `TaxFilingRecord.periodStart`, `periodEnd`, `filedDate`; `TaxFilingAmendment.amendedDate`; `SalesInvoice.taxPoint`, `issueDate`; `SalesInvoiceAdjustment.occurredAt`; `TaxFilingPayment.paymentDate` |
| GL, documents, periods | `AccountPayable.dueDate`; `AccountReceivable.dueDate`; `FiscalYear.startDate`, `endDate`; `NepaliCalendarYear.adStartDate` (`DateTime @db.Date`); `AccountingPeriod.startDate`, `endDate`; `JournalEntry.transactionDate`; `AccountingEvent.effectiveAt`; `AccountingDocument.issueDate`, `dueDate`; `SupplierCreditApplication.appliedAt`; `SupplierReturnCreditApplication.appliedAt`; `CollaborationFeeCreditApplication.appliedAt` |
| Distributor and marketing | `DistributorDeliveryChargeNegotiation.effectiveFrom`, `effectiveUntil`; `DistributorServiceEarning.effectiveAt`; `DistributorBonusPlan.effectiveFrom`, `effectiveUntil`; `DistributorBonusEarning.periodStart`, `periodEnd`; `DistributorSettlementRequest.settledAt`; `MarketingPartnerSettlement.periodStart`, `periodEnd`, `paidAt`; `CollaborationFeeInvoice.periodStart`, `periodEnd` |
| Manufacturer, transfer, delivery and COD | `Manufacturer.contractStartDate`, `contractExpiryDate`; `ManufacturerProductionRequest.approvedVatInvoiceDate`, `targetCompletionDate`; `ManufacturerSettlementRequest.paidAt`; `StockTransferShipmentEvent.occurredAt`; `DistributorCashEvent.occurredAt`; `DeliveryEvent.occurredAt`; `DeliveryFinancialSettlement.settledAt`; `NcmSettlementBatch.periodStart`, `periodEnd`, `settledAt`; `OperatingExpense.date`; `DirectIncome.date` |

### 7.2 Date storage and semantics

- **Instant:** event timestamps such as `createdAt`, `postedAt`, `occurredAt`, `settledAt`, provider callback time; persist UTC instants and do not rewrite their clock time to a day boundary.
- **Business date:** expense date, invoice issue date, payment date, return date and effective-from dates where the business meaning is a local calendar day. They currently use `DateTime` fields; their storage/query convention must be documented. Only `NepaliCalendarYear.adStartDate` is explicitly `@db.Date` in the schema scan.
- **Fiscal period:** `FiscalYear.startDate/endDate`, `AccountingPeriod.startDate/endDate`, tax filing periods and collaboration/settlement periods; verify start-inclusive/end-exclusive or inclusive convention and timezone.
- **Display date:** BS/AD rendering selected for UI/export; do not use it as an arithmetic or posting source.
- **Effective date:** tax registration, VAT rate, corporate tax policy, distributor rate/bonus terms, company valuation and other settings; choose by transaction's defined business date, retain policy-version evidence, and never recalculate historical records silently.

`DateTime` schema types do not distinguish these meanings. Inspect route validators and write paths before changing storage or query boundaries.

### 7.3 Required Nepal-calendar test matrix

| Case | Expected assertion |
|---|---|
| Shrawan 1 opening | Kathmandu local midnight maps to the correct AD instant; fiscal-year ID/name and first period match configured calendar. |
| Ashadh final day | Final BS date maps to the final inclusive instant; next Shrawan 1 starts exactly after the prior period with no gap/overlap. |
| Every BS month boundary | First/last day maps using that configured year's actual month lengths; adjacent periods meet exactly. |
| BS year crossing | Require both relevant configured years; no assumed 365-day year or silent fallback across a missing year. |
| BS leap/calendar-table boundary | Validate configured year length and adjacent-year continuity against an approved reference calendar. |
| AD leap day | Valid leap day accepted; non-leap February 29 and impossible month/day rejected. |
| Impossible dates | Reject BS and Gregorian dates that normalize through JS Date constructors; preserve existing 400 validation errors. |
| Reversed ranges | BS and AD date-only ranges reject start > end at route and service boundaries. |
| Date-only filters | Use `[Kathmandu start of day, Kathmandu start of next day)` internally or equivalent tested inclusive endpoint; include both endpoints exactly once. |
| Explicit timestamp | Preserve the supplied instant and milliseconds; an end instant must not be moved to local end-of-day. |
| UTC/Kathmandu midnight | Records immediately before/at/after each boundary are assigned once; test on server/browser environments with different local timezone settings. |
| Month/year crossing | API, report, PDF/CSV and displayed BS labels select the same period. |
| Historical effective date | Select the tax/terms version applicable to transaction business date, preserve version id/snapshot, and prove a later settings change does not change old documents. |

Existing focused tests cover Shrawan 1, contiguous month periods, Kathmandu date conversion, inclusive BS/AD date ranges, invalid/reversed dates, custom configured calendars and timestamp preservation in the shared resolver. The duplicate report parser and all other callers still need the wider matrix.

## 8. Proposed P4.1–P4.8 implementation plan

| Phase | Deliverable and exit evidence | Gate |
|---|---|---|
| **P4.1 — Shared Decimal core** | Shared `Prisma.Decimal` utility, safe string/db constructors, arithmetic, explicit quantization-policy hooks, allocation/tax interfaces, exact journal balance checks, decimal-string serialization and static guard/test pattern. Unit tests cover invalid input, scale, large value, negative correction, exact equality and serialization. | Build and test before any database migration. Do not select an unapproved rounding rule; keep legacy Number adapters isolated. |
| **P4.2 — Complete field and path inventory** | Complete every monetary/quantity field's semantic class, unit/currency, null/default, writer, reader, arithmetic, journal, report/export, migration and tests. Include imports, webhooks, schedules, portals, JSON snapshots and operational estimates. | No critical unknown writer/reader before changing its field. This audit's schema census is the starting input, not completion of this gate. |
| **P4.3 — Staged schema and writer batches** | One isolated batch at a time; each batch includes its schema conversion and the corresponding Decimal writers/readers/serializers, with a versioned old/new report, null/default/range checks, recovery plan, clean install and populated-upgrade tests. Begin with source/GL-adjacent fields only after P4.1/P4.2. | Do not migrate a field while any active writer still calculates it with Number. If its whole path is not ready, defer that field's migration. Never apply to production/shared DB under this assignment; do not rewrite posted journals. |
| **P4.4 — Calculation consistency and remaining paths** | Convert remaining source document, payment/allocation, tax, refund, inventory/COGS, payout, asset, loan and equity computations to Decimal; add source/document/journal consistency checks and migrate each remaining batch only with its completed path. | Approved rounding policy must be explicit and versioned; unexplained critical drift is zero. |
| **P4.5 — Nepal-calendar standardization** | Consolidate duplicate date parsing on tested shared semantics; classify each date field and route input as business date, instant, fiscal period or display. Add effective-date version checks and cross-portal parity tests. | Preserve passing behavior; fix the explicit timestamp/local-time boundary inconsistency with focused tests. |
| **P4.6 — Reports and exports** | Exact Decimal aggregations in APIs; explicit decimal-string transport; shared display formatter; report/export reconciliations for GL, trial balance, statements, cash flow, tax, inventory, AP/AR and settlements. Estimates remain labeled. | No financial summary silently converts to Number before aggregation; all outputs tie to source and GL evidence. |
| **P4.7 — Test and historical drift evidence** | Run the precision/calendar matrix at unit, service, API and isolated-database levels; compare old/new source, journal, report and period totals; retain rounded-record and exception schedules. | Zero unexplained critical precision drift; no database-backed claim without isolated evidence. |
| **P4.8 — Controlled cutover** | Isolated populated-copy conversion report, clean migration chain, upgrade test, backup/restore/recovery, UAT, approvals and unresolved exception list. | Tested recovery and internal approval before deployment; external compliance remains a separate release gate. |

P4.0 is the current audit/policy-baseline task. This sequence keeps the user's P4.0 audit separate from implementation increments while completing the Decimal core and full field/path inventory before P4.3 database conversion. It follows the explicit recommendation not to migrate first and patch Number arithmetic later.

## 9. Test and migration evidence plan

### Unit and service

- Decimal constructors accept decimal strings/Prisma Decimal; reject blank, nonfinite, malformed, excessive scale/range; never silently coerce invalid input to zero.
- Addition/subtraction/multiplication/division/comparison across near-paisa, large, small, negative-correction and repeated-conversion cases.
- Approved line/tax/document quantization once policy is accepted; three-way allocation sums exactly to payment and replays deterministically.
- Journal debit-credit equality and source-document equality before and after serialization.
- Financial writers: order/invoice, expense/vendor, tax, payment/refund, procurement/COGS, NCM/distributor/manufacturer settlement, marketing fees, fixed assets, depreciation, loan and equity.
- Calendar unit/service/API tests from Section 7; run on multiple host timezones or use explicit UTC/Kathmandu boundary fixtures.

### Isolated database and migration

- Decimal create/read/update/aggregate/JSON serialization round trip with Prisma and the actual MySQL version.
- Clean migration chain and populated upgrade on an approved isolated database only; never `db push` or `db reset`.
- Representative legacy Float values including fractional binary representations, nulls, defaults, min/max, large values and negative corrections.
- Compare row values and aggregate totals by model/account/period; identify every rounded row and difference.
- Force migration interruption/retry and exercise verified backup/restore/recovery.
- No shared or production database validation is claimed by this audit.

### Drift and output checks

- Compare source documents, allocations, journals, trial balance, financial statements, cash flow, reports and printed/exported values.
- Test repeated import/webhook/job delivery and existing idempotency so Decimal refactoring cannot double-post.
- Require zero unexplained critical drift; preserve known historical differences as evidence-backed exceptions rather than forcing totals to match.

## 10. Files inspected, changed, and open work

### Inspected (representative source evidence)

- `backend/prisma/schema.prisma` and migration SQL, especially `0_init/migration.sql` and `20261102020000_seller_tax_profile_and_filing_payments/migration.sql`.
- `backend/services/accountingMoney.js`, `accountingPostingEngine.js`, `accountingCashFlowService.js`, `accountingController.js`, `corporateIncomeTaxService.js`, `fixedAssetDepreciationService.js`, `loanAccountingService.js`, `treasuryAccountingService.js`, `inventoryLedgerService.js`, `nepaliFiscalCalendar.js`.
- `backend/controllers/expenseController.js`, `financialController.js`, `accountingController.js`, `vatFilingController.js`, `vatRateController.js`, `corporateTaxPolicyController.js`, `salesInvoiceController.js`, `paperBillController.js`, `nepaliCalendarController.js`.
- `admin/src/utils/nepaliDate.js`, Admin Nepali date controls, `FinancialStatements.jsx` and `GeneralLedger.jsx`.
- Relevant existing tests listed under Validation below.

This is a broad static scan plus focused reads. It is not proof that every portal, report, background job, JSON payload or arithmetic caller has been traced. Finish per-field caller mapping in P4.2.

### Changed

- Added this blueprint.
- Updated `docs/accounting/03-implementation-plan-and-iteration-tracker.md` and `docs/accounting/07-critical-high-remediation-roadmap.md` with the Phase 4.0 evidence and status.
- No application code, schema, migration, database row, journal, tax setting, or historical balance changed.

### Validation run

- From `backend/`: `node --test tests/accountingMoney.test.js tests/financialCalendarInput.test.js tests/nepaliFiscalCalendar.test.js tests/vatFilingService.test.js tests/corporateIncomeTaxService.test.js tests/salesInvoiceService.test.js tests/fixedAssetDepreciationService.test.js tests/accountingCashFlowService.test.js tests/realtimeFinancialStatements.test.js` — **54 passed, 0 failed, 0 skipped**.
- From `backend/`: `npx prisma validate` — passed. This validates schema syntax, not migration safety or database contents.
- `git diff --check` passed for tracked changes. The new untracked blueprint had no trailing-whitespace matches in a separate check. Git emitted existing line-ending warnings for unrelated files. No migration application, database integration test, historical conversion, or source amount reconciliation was performed.

## 11. Remaining risks and P4.0 conclusion

1. The schema inventory is complete only for current Prisma `Float`/`Decimal` scalar declarations. String/JSON amounts, non-Prisma inputs, generated snapshots, database views, cached values, hidden/inactive routes, and every arithmetic caller require further investigation.
2. Field units/currencies and all Float semantics remain partly unknown. The list is not a migration allowlist.
3. JavaScript Number arithmetic is still present in critical posting, tax, depreciation, loan, GL/report and cash-flow paths. Current Decimal journal storage alone does not ensure exactness.
4. Existing `ROUND_HALF_UP`/2-decimal handling is observed code behavior only. No NPR storage, tax, allocation, or journal-rounding policy has been approved by this audit.
5. Direct Float-to-Decimal SQL conversion can round historical values to the destination scale. Actual row-level effects and deployed migration status remain unknown.
6. Business-date versus instant semantics are not explicit on most `DateTime` fields. The shared calendar implementation has good existing tests, but report-level duplicate parsing and all callers need verification.
7. No database-backed migration, restore, conversion-delta report, or period comparison was run. No report is represented as reconciled, audited, or statutory-compliant.

**Conclusion:** P4.0 produced an evidence-backed starting inventory and staged implementation blueprint. P4.0 semantic classification/path coverage is still partial, and Phase 4 remains **incomplete**.

## 12. P4.1 implementation evidence (2026-11-15)

### Timestamp boundary correction

The inconsistent entry point was `GET /api/accounting/financial-statements` (`getRealtimeFinancialStatements`): it previously interpreted an explicit end timestamp as a business date and reset it to local end-of-day using the server's timezone. The handler now uses the shared calendar input resolver. Date-only inputs are Kathmandu-local dates, and the database upper bound is the half-open interval end (`transactionDate < next Kathmandu midnight`). Explicit timestamp inputs retain their original instant and use an inclusive `lte` bound. The report's in-memory period end remains the resolver's inclusive end instant. Reversed ranges return a client error.

Regression coverage verifies Kathmandu midnight (`2026-04-14T18:15:00.000Z`), the final millisecond of the local day, exclusion of the next midnight, an explicit `+05:45` timestamp end, and reversed timestamp ranges. This change is limited to the identified financial-statements entry point; it does not assert that every date filter/export in the repository has been converted to the same query convention.

### Shared Decimal foundation

Added `backend/services/accountingDecimal.js` using the already-installed `Prisma.Decimal` implementation, cloned with 80-digit calculation precision. It accepts decimal strings and Prisma Decimal values (not JavaScript Numbers); validates finite syntax, supported significant digits, database precision/scale and overflow; exposes exact add/subtract/multiply/compare within the supported precision (and rejects unsupported results), division with caller-supplied significant digits and rounding mode, explicit quantization, total-preserving allocation with an explicit residual destination, and recursive Decimal-to-string serialization. At the P4.1 checkpoint NPR quantization was pending approval; the subsequent internal policy approval and effective date are recorded in Section 13.

The helper is not yet wired into expense, supplier-payable, tax, journal, or reporting calculations. Existing `accountingMoney.js` behavior remains unchanged. No new dependency, schema field change, migration, historical conversion, or financial balance change was made.

### Expense and supplier-payable pilot proposal (historical baseline; superseded by Section 13)

The bounded customer entry path is `POST /api/expense/add` (`createExpense`), with expense readers at `GET /api/expense/list` and `GET /api/expense/summary`. The admin `ExpenseManagement` page consumes both readers. Current input normalization and VAT calculation use `Prisma.Decimal` in places but convert back to JavaScript Number; `purchaseTaxableAmount` also uses `toFixed`. `OperatingExpense.amount` and `vatAmount` are Prisma `Float`, while `AccountPayable.totalAmount`/`paidAmount`/`remainingBalance`, `AccountingDocument.originalAmount`/`allocatedAmount`/`remainingAmount`, `AccountingAllocation.amount`, `CashTransaction.amount`, and journal line amounts use Decimal schema fields.

For a payable expense, the controller creates the expense, `AccountPayable`, and (when an active `AccountingParty` is supplied) a PAYABLE `AccountingDocument` sourced by `OPERATING_EXPENSE`, then posts `EXPENSE_PAYMENT` journal lines to the expense account and 2110. A paid vendor expense can also create a cash transaction and allocate its journal payment to the bill document. The controller's request idempotency service hashes the payload; identical retries return the existing source, while changed-payload reuse conflicts. `postExpenseAccounting` currently converts the amount and split to Number, uses a 0.01 tolerance, then normalizes journal lines to Decimal.

Reader gaps and precision risks to close in P4.2:

- `/api/expense/list` aggregates database sums but converts metric values to Number before response.
- `/api/expense/summary` sums source Float fields with JavaScript arithmetic.
- `/api/financial/payables-receivables` reads `AccountPayable` balances; `/api/accounting/subledger-reconciliation` compares the legacy 2110 total with `AccountPayable.remainingBalance`. Its overall status is `PARTIAL`, and this is not a supplier-level statement or proof that operating-expense bills, their allocations, and journals agree. Its source-specific document checks do not currently include `OPERATING_EXPENSE`.
- The current expense entry supports paid or payable status, not a fully generalized partial-paid split. The settlement and supplier-credit paths must be traced and converted before calling the end-to-end pilot complete.
- Taxable-base/VAT amount scale, approved rounding points, and historical Float-to-Decimal conversion effects require authorized finance/CA decisions and a populated isolated test database.

Recommended P4.2 order: convert request validation and VAT/base arithmetic to the shared Decimal layer; decide and document authorized currency/tax quantization rules; migrate only the two expense amount fields through an isolated, measured migration after every writer is Decimal-safe; update the posting engine and payable/credit/payment allocation paths; update expense, AP/subledger, supplier-statement and export aggregation/serialization; then compare source document, allocation and journal amounts and test retries, partial settlements and credit adjustments. Do not alter historical posted journals to force agreement.

### Validation and status

- `node --test tests/accountingDecimal.test.js tests/realtimeFinancialStatements.test.js tests/financialCalendarInput.test.js tests/nepaliFiscalCalendar.test.js` — 32 passed, 0 failed.
- `node --test tests/accountingMoney.test.js tests/accountingPostingEngineUnit.test.js tests/accountingOperationalPosters.test.js tests/operatingExpenseIdempotencyService.test.js tests/accountingSubledger.test.js tests/vatRateService.test.js tests/vatFilingService.test.js tests/paperBillService.test.js tests/accountingCashFlowService.test.js` — 121 passed, 0 failed.
- `npx prisma validate` — passed; schema validation only.
- `git diff --check` — passed; Git reported line-ending warnings on unrelated pre-existing modified files.

No database-backed integration test, migration, historical comparison, or precision-drift reconciliation was performed. Number-based financial paths remain in expense input/posting/reporting, GL/statement calculations, cash flow, tax, loan, depreciation, and other domains listed in the P4.0 inventory. P4.1 is not complete until the acceptance scope and any required integration evidence are satisfied; Phase 4 remains incomplete.

## 13. P4.2 implementation status update (2026-11-15)

The internal NPR policy has since been approved by management for bookkeeping use: monetary storage precision is two decimal places, currency quantization uses `ROUND_HALF_EVEN`, and exact expense lines are summed before document-total quantization. Entered invoice VAT is recorded; any internal estimate remains `PENDING_REVIEW`. This is an internal accounting policy only, not statutory tax guidance, CA approval, or external audit approval. The effective date is 2026-11-15.

The shared Decimal helper now exposes this approved NPR quantization policy. The primary expense controller and Admin entry/report paths have partial Decimal/string handling. The second entry point, `POST /api/finance/record-operating-expense`, now requires expense and partial-payment amounts as decimal strings, quantizes them through the shared NPR helper, calculates the remaining payable using Decimal, and sends Decimal amounts through its treasury, payable-document, allocation, and journal writes. Its partial-payment split is exact; `postExpenseAccounting` validates that paid plus payable equals the total without a tolerance. `postSupplierPaymentAccounting` now calculates settlement, discount, and fine amounts using Decimal arithmetic. No frontend caller of the second endpoint was found in the repository search.

The second endpoint is a legacy parallel writer. It now creates an `OperatingExpense` source row, cash transaction when paid, an `AccountPayable` for the unpaid portion, an `AccountingDocument` when a registered supplier is selected, and the journal/allocation records in one transaction. Exact retries reuse the source; changed-payload key reuse conflicts. The source/report gap is addressed in code, but the new controller-level database integration assertions have not been rerun against the isolated database.

### Migration and historical conversion evidence

The P4.2 migration uses staged Decimal columns and conversion-evidence rows. It was applied only to the isolated `clothing_test` database. Migrated fields are `OperatingExpense.amount`, `vatAmount`, `paidAmount`, and `payableAmount`; `SupplierReturn.totalDebitAmount` and `vatReversal`; `SettlementReversion.originalAmount`, `priorPaidAmount`, and `priorRemainingBalance`; and `AccountPayable.creditAppliedAmount`. Other Float fields were not migrated by this P4.2 migration.

The isolated clone initially contained no OperatingExpense or SupplierReturn history, so no real historical expense/return drift was measured. Synthetic conversion fixtures produced the expected recorded differences: OperatingExpense amount total -0.015; SupplierReturn debit total -0.005 and VAT total +0.005; SettlementReversion snapshots -0.005, -0.004, and -0.001. The 14 pre-existing SettlementReversion rows previously measured zero two-decimal drift. These synthetic results are not evidence of real historical conversion. A persisted-data integration test passed before the controller-level source/replay assertions were added; the expanded test remains unverified because this checkout has no separate `clothing_test` connection configured.

### Remaining lifecycle gaps and status

The partial expense source invariant is `paidAmount + payableAmount = amount`; the upfront payment is allocated against the full supplier BILL, leaving the same Decimal remainder in the bill and linked AccountPayable. The posted-GL cash-flow service now aggregates with Decimal and returns decimal strings, and the Admin cash-flow view formats those strings without Number conversion. The payable-settlement route and selected supplier credit/reversal paths have Decimal support, but end-to-end settlement, discounts/fines, credit/debit notes, corrections, exports, statements, and source/subledger/journal reconciliation are not all proven. Finance dashboard, tax-estimate, legacy operational cash-flow, legacy settlement-history, and other report paths still contain Number conversions or require serialization review. The generic manual payable route still permits ambiguous `OTHER` entries that may be misused as expenses.

The internal policy version is `NPR-INTERNAL-2DP-HALF-EVEN-v1`, effective 2026-11-15. It governs internal records only and has no statutory or external professional approval claim. Purchase input VAT review now uses the shared Decimal foundation and approved HALF_EVEN boundary; tax classification and statutory treatment remain unvalidated.

Focused validation from `backend/`:

- `node --test tests/accountingOperationalPosters.test.js tests/accountingDecimal.test.js tests/operatingExpenseDecimalService.test.js` — 80 passed, 0 failed.
- `node --check controllers/financialController.js` and `node --check services/accountingPostingEngine.js` — passed.
- `git diff --check` — passed; Git reported line-ending warnings on unrelated pre-existing modified files.

- Latest focused run of the Decimal, expense, poster, supplier-return/credit, settlement-correction, and VAT service suites: 96 tests passed.
- The persisted-data test previously run on `clothing_test` passed 1/1 before the recent controller-level assertions. Its attempted rerun was blocked by the test guard because this checkout's `DATABASE_URL` resolves to `clothing`; no connection to that database was made.
- The P4.2 migration and Prisma validation had passed on the isolated `clothing_test` in the earlier recorded run. No empty-database migration-chain test or real historical expense/return conversion has been demonstrated.

P4.2 is **INCOMPLETE**. Remaining Number-based financial paths include expense/payable dashboards and aging, legacy settlement history, tax estimates, legacy operational cash flow, Treasury serialization and other domains listed in the P4.0 inventory. The selected posted-GL report paths noted below have been converted, but that is not proof of complete report, export, or subledger reconciliation. Do not begin P4.3 or claim Phase 4 completion.

## 14. Posted-ledger report increment (2026-11-15)

- The General Ledger, trial balance, real-time posted financial statements, and legacy AR/AP control comparison now aggregate through the shared Decimal layer and serialize report amounts as decimal strings. Trial-balance and statement balance checks use exact Decimal equality.
- General Ledger and trial-balance date-only filtering now uses half-open Asia/Kathmandu day bounds; explicit timestamps retain their instants. The affected Admin General Ledger, Trial Balance, Financial Statements, and Accounting Health consumers format the converted fields without converting those values to JavaScript `Number`.
- Focused validation: `node --test tests/accountingLedgerReports.test.js tests/realtimeFinancialStatements.test.js` — 7 passed, 0 failed, 0 skipped. The Admin production build passed. ESLint passed with zero errors and three React-hook dependency warnings in the changed General Ledger/Trial Balance files.
- Full backend regression run executed 177 test files, with 10 database-integration files skipped; it exited unsuccessfully because two tests in `financialPayoutService.test.js` attempt to fail a payout using its initiating actor and are rejected by the existing self-rejection guard. No files in that payout path were changed by this increment.
- Database configuration was inspected without revealing credentials: the configured target is `localhost/clothing`; no isolated test URL is configured. No connection or migration was attempted. The GL report changes have not been persisted-data validated or reconciled against source records.
- A fresh line-level Prisma schema scan reports 135 Float and 141 Decimal fields. Compared with tracked `HEAD` (142 Float, 127 Decimal), seven fields moved Float-to-Decimal and seven Decimal fields were added. Of the Decimal declarations, 59 specify `@db.Decimal` scales (52 `(20,2)`, three `(5,2)`, and one each `(30,14)`, `(65,30)`, `(8,2)`, `(8,3)`); the other 82 omit an explicit native scale. This is not a MySQL column inventory because the database was not queried, and these schema counts are not a monetary-field count. No new migration was created in this increment.
- Phase 4.2 still lacks isolated route integration assertions, complete dashboards/aging/settlement/export coverage, empty/populated migration-chain evidence, real historical expense/return conversion drift, and transaction-level source/subledger/cash/journal reconciliation. The earlier synthetic clone did not contain historical expenses or supplier returns. P4.2 and Phase 4 remain **INCOMPLETE**; do not begin P4.3.

## 15. Treasury control-report precision increment (2026-11-15)

- Inventory before this change: the expense list and expense summary already serialized Decimal-backed expense totals as strings; posted cash flow and posted GL reports were Decimal-based. Remaining readers included payable/receivable synthesis and aging/settlement history, operational Treasury reports and receipt calculations, tax estimates, exports, and source-to-journal reconciliation. The Treasury-to-GL control report specifically converted monetary values to Number and accepted variances up to NPR 0.05 as reconciled.
- `backend/services/treasuryAccountingService.js` now sums mapped Treasury balances and computes variances using the shared Decimal layer; its report amounts are two-place decimal strings. A mapped balance is marked reconciled only on exact equality. It returns both the net aggregate variance (preserving the prior field meaning) and the gross sum of per-account absolute variances, so offsetting account mismatches cannot appear as zero variance in the Admin summary.
- `admin/src/pages/AccountingHealth.jsx` formats these balances as decimal strings and labels the gross variance as a mapped control comparison, not a bank or wallet-provider reconciliation; account 1180 may include wallet and gateway-clearing movements.
- Tests: `node --test tests/treasuryAccountingService.test.js tests/accountingCashFlowService.test.js` — 20 passed, 0 failed, 0 skipped. Changed Admin page ESLint passed. `git diff --check` passed with pre-existing line-ending warnings.
- The unrelated payout test failure was checked separately: `node --test tests/financialPayoutService.test.js` — 4 passed, 2 failed. Both failures reproducibly raise `PAYOUT_SELF_REVIEW` when a payout initiator attempts to reject/fail the payout. No payout code was changed.
- No migration or database operation was needed. No database endpoint was contacted. This verifies unit behavior only; it does not reconcile persisted Treasury, GL, bank, gateway, or wallet balances. P4.2 remains **INCOMPLETE**.

## 16. Expense-linked payable reporting increment (2026-11-15)

- Traced `GET /api/finance/payables-receivables` through stored `AccountPayable` retrieval, the `OPERATING_EXPENSE`/`EXPENSE` source association, endpoint aggregation, and the Admin Payables & Receivables page. Expense sources are read from `OperatingExpense` by linked `payableId` and supported reference IDs. The writer relationship is the existing expense source's `payableId` and the payable's source reference; no duplicate source record is created.
- Added `backend/services/expensePayableReportingService.js` and integrated it in `backend/controllers/financialController.js`. The service uses the shared Decimal helper for totals, balance comparisons, summary aggregation, exact paid/partially-paid/settled classification and overdue balance inclusion. A positive remaining Decimal balance is never classified as settled, even if a stale stored status says `SETTLED`; exact zero remaining with a positive original total is settled. Cancelled and zero-total status behavior is preserved.
- Expense-linked payable responses serialize `totalAmount`, `paidAmount`, `creditAppliedAmount`, and `remainingBalance` as two-place decimal strings. Monetary amounts found in JSON settlement history are returned as Decimal strings without adding a rounding point; older JSON numeric values may already have lost precision before this reader. The expense-only `metrics.expenseLinkedPayables` reports total, paid, credit applied, outstanding, overdue, counts and source exceptions. Existing non-expense payable/receivable synthesis is outside this increment and is not certified Decimal-safe.
- Known out-of-scope Number paths remain in `getPayablesAndReceivables` for synthesized manufacturer/distributor payables and receivables and the Marketing CPA payout amount, and in Admin handling of non-expense payable percentages, receivable percentages, and manufacturer/distributor payment/position values. The shared overall endpoint totals sum current records with Decimal, but this does not restore precision already lost by Number-based synthetic inputs. These are assigned to the remaining P4.2 payable/receivable and Admin finance-reader conversion work, not claimed fixed here.
- Outstanding and overdue classification use exact Decimal comparisons. Date-only due dates preserve their calendar key; timestamp cutoffs use `Asia/Kathmandu` local date. No existing payable aging-bucket endpoint or export/download consumer was found in the inspected screen/path, so no new buckets or exports were introduced.
- The service checks each expense payable's source existence/link and verifies `OperatingExpense.paidAmount + payableAmount == amount` and source payable amount equals the payable's original total. It exposes `MATCH`, `SOURCE_MISSING`, `SOURCE_LINK_MISMATCH`, and `AMOUNT_MISMATCH`; the Admin page displays expense-only totals, uses API-provided overdue status, formats the Decimal strings, flags source exceptions, and uses exact Decimal-string comparison to decide whether to display settlement-history adjustments. These are report-layer checks, not persisted-database or source-to-journal reconciliation.
- Focused tests cover unpaid, partially paid, settled, adjusted, zero-value and large values; multiple-row summaries; settlement-history serialization; a positive one-cent residual with stale `SETTLED`; source mismatches; and the Kathmandu midnight due-date cutoff. `node --test tests/expensePayableReportingService.test.js tests/operatingExpenseDecimalService.test.js tests/operatingExpenseIdempotencyService.test.js` passed 11 tests. `node --check` passed for the changed controller, service and report test; Admin ESLint passed; `npm run build` passed with the existing large-chunk warning.
- No database was contacted. The configured database is `clothing`, and no separately verified isolated endpoint was used. There is no persisted source-to-payable test, source-to-journal reconciliation, migration test or historical conversion evidence for this increment. Existing payout self-review failures are unrelated and this change did not modify payout behavior.
- Remaining P4.2 work includes other payable/receivable synthesis and non-expense amounts, full settlement/discount/fine/debit-credit-note/reversal/export coverage, other dashboard and legacy settlement paths, route-level persisted verification, migration-chain tests, real historical conversion drift, and source/subledger/cash/journal reconciliation. This increment is implemented and unit-tested only; P4.2 remains **INCOMPLETE** and P4.3 remains unauthorized.

## 17. Non-expense party payable and receivable reporting increment (2026-11-15)

- Traced the non-expense manufacturer/distributor party rows in `GET /api/finance/payables-receivables` from `AccountPayable`/`AccountReceivable`, manufacturer orders, product/manufacturer cost inputs, supplier cash outflows, distributor settlement requests and their linked earning documents through the Admin Payables & Receivables page. The separate Admin distributor settlement-position API was traced from distributor AccountingDocuments, legacy return/exchange logistics payables and pending remittance batches through its Admin table and totals.
- Added `backend/services/nonExpensePartyReportingService.js` and `backend/services/distributorSettlementPositionReportingService.js`; wired them through `getPayablesAndReceivables` in `financialController.js` and `getAdminDistributorSettlementPositions` in `adminDistributorDetailController.js`. Shared `accountingDecimal` operations now synthesize manufacturer COGS payables and direct-sale margin receivables, cap distributor settlement requests at linked earning-document balances, normalize stored party balances, classify paid/partially paid/settled and overdue rows, and aggregate summary and distributor-position totals. Existing per-order COGS and settlement rounding boundaries are retained using the approved NPR HALF_EVEN quantizer. Existing summary-card meanings are preserved: “settled/collected” sums cash `paidAmount`/`receivedAmount`, excluding a payable credit from cash paid.
- Party monetary fields, report metrics, and distributor settlement-position amounts are serialized as decimal strings. The Admin page formats these values as strings and uses exact Decimal-string comparison/percentage helpers; the server overdue result is used for these party rows. Kathmandu-local date-only due-date cutoffs and instant timestamp boundaries are preserved. No aging buckets or export consumers were found for these exact paths; no buckets, export behavior, permissions, settlement rules, or posting flows were added or changed.
- Remaining source precision limitation: `Order.amount`, `Product.costPrice`, and `ManufacturerInventory.agreedCostPrice`/`proposedCostPrice` are Prisma `Float` inputs in this path. Prisma returns these as JavaScript numbers, which the service converts to decimal text before Decimal arithmetic; this prevents subsequent binary-float calculations but cannot recover precision already lost in storage. No schema change or migration was made.
- Remaining Number paths are explicitly outside this increment: NCM COD and Marketing CPA synthesis in the shared finance endpoint; the separate `/api/finance/manufacturer-summary` report (used by Admin and Manufacturer portals); generic non-party rows/payment-entry flows in the Admin screen; and other finance dashboards/legacy settlement paths. The endpoint-level Decimal summary cannot restore precision lost by an upstream Float or those remaining Number-based sources.
- Tests: `node --test tests/nonExpensePartyReportingService.test.js tests/distributorSettlementPositionReportingService.test.js tests/expensePayableReportingService.test.js tests/operatingExpenseDecimalService.test.js tests/operatingExpenseIdempotencyService.test.js` — 21 passed, 0 failed, 0 skipped. `node --test tests/decimalDisplay.test.js` — 1 passed. Backend `node --check` and Admin ESLint passed. `npm run build` in `admin/` passed with the existing large-chunk warning.
- Separate known failure: `node --test tests/financialPayoutService.test.js` — 4 passed, 2 failed. Both failures are the existing `PAYOUT_SELF_REVIEW` rejection in failure/release paths. This settlement-approval behavior is outside the reporting increment and was not changed.
- Evidence is report/service-level only. No database was contacted, no isolated endpoint was verified, and no migration or historical conversion was run. Tests do not establish persisted source-to-payable/subledger consistency or source-to-journal reconciliation; no automatic correction or journal was created. The bounded report services are implemented, but this increment remains **INCOMPLETE** pending Decimal conversion of the separate manufacturer-summary endpoint and its Admin/Manufacturer consumers. P4.2 remains **INCOMPLETE** and P4.3 remains unauthorized.

## 18. Manufacturer summary Decimal reporting increment (2026-11-15)

- Traced `GET /api/finance/manufacturer-summary` from its existing authenticated and authorized route through the single/all-manufacturer controller branches, Prisma reads, Decimal report service, Admin Payables & Receivables, and Manufacturer Finance summary/order/transaction views. Authorization, manufacturer context, date filters, report meanings, and payout/posting services were not changed.
- Added `backend/services/manufacturerSummaryReportingService.js` and delegated report arithmetic/serialization from `getManufacturerFinancialSummary` in `backend/controllers/financialController.js`. Payable journal-line aggregation, paid/outstanding amounts, order COGS/direct margin, manufacturer summaries, net positions and cash transaction amounts use shared Decimal values. Monetary API fields under `summary`, `manufacturers[]`, `orders[]` and `transactions[]` serialize as decimal strings. Existing NPR HALF_EVEN quantization boundaries are retained; no additional schema or rounding policy was introduced.
- Updated `admin/src/pages/PayablesReceivables.jsx` to use exact Decimal-string checks/calculation for this endpoint's summary cards, manufacturer net positions, payout prefills, order rows, and balance validation. The payment request carries the amount string; payout/settlement posting behavior was not changed. Updated `manufacturer/src/pages/Finance.jsx` and added `manufacturer/src/utils/decimalDisplay.js` for exact string-based summary, order, and transaction display. The separate settlement-request history uses a different API and retains its prior Number calculation; it remains outside this increment. No export or aging-bucket consumer of the manufacturer-summary endpoint was found.
- Source precision remains limited upstream: `Order.amount`, `Product.costPrice`, and ManufacturerInventory agreed/proposed costs are Float-backed. The service stringifies those values at the Prisma boundary before Decimal arithmetic; it cannot recover precision already lost in storage. Quantity and timestamp conversions remain non-monetary.
- Tests: `node --test tests/manufacturerSummaryReportingService.test.js tests/nonExpensePartyReportingService.test.js tests/distributorSettlementPositionReportingService.test.js tests/expensePayableReportingService.test.js tests/operatingExpenseDecimalService.test.js tests/operatingExpenseIdempotencyService.test.js` — 25 passed, 0 failed, 0 skipped; Admin decimal display test — 1 passed; Manufacturer decimal display test — 3 passed. Changed backend syntax checks, Admin targeted ESLint, Manufacturer Oxlint, and both Admin/Manufacturer production builds passed. Admin build emitted its existing large-chunk warning.
- No database connection, migration, historical conversion, persisted source/payable check, or source-to-journal reconciliation was run. The report/service tests are not persisted-data evidence. Admin has no endpoint-specific UI test; the utility tests and production build are not a rendered-browser test.
- Remaining Number arithmetic relevant to nearby consumers is outside this endpoint increment: the Manufacturer settlement-request-history table uses another API; generic Admin receivable inputs/percentage labels in the shared screen are not manufacturer-summary money; and the downstream manufacturer payout controller retains its existing Number conversion for settlement posting. The Admin report-prefill now passes decimal strings, but the posting flow was not changed. Float-backed report inputs remain a source limitation. NCM COD/Marketing CPA, other finance dashboards, legacy settlement paths, the remaining P4.2 lifecycle, historical conversion, isolated migration evidence and complete source/subledger/cash/journal reconciliation remain open. R5 is **IMPLEMENTED / UNIT TESTED**, not database validated or reconciled. P4.2 remains **INCOMPLETE** and P4.3 remains unauthorized.

## 19. Manufacturer settlement-request history Decimal increment (2026-11-15)

- Traced both history readers: `GET /api/manufacturer/finance/settlement-requests` (`getManufacturerSettlementRequests`) and `GET /api/admin/finance/settlements` (`listAdminManufacturerSettlements`). Both query `ManufacturerSettlementRequest` and attach linked `FinancialPayout` rows, matching `CashTransaction` rows, and journal-entry references in `manufacturerFinanceController.js`. Manufacturer route authorization/context and Admin role/permission checks are unchanged. The manufacturer query remains scoped to `req.manufacturerId`; the Admin query retains its optional manufacturer and status filters.
- Schema sources are `ManufacturerSettlementRequest.amount`/`paidAmount`, `FinancialPayout.amount`/`settlementAmount`/`adjustmentAmount`, and `CashTransaction.amount`, all `Decimal(20,2)`. There is no request-level approved amount, adjustment field, or CANCELLED status. Request statuses remain the existing PENDING/PARTIALLY_PAID/PAID/REJECTED values; payout attempts retain their own INITIATED/SETTLED/FAILED/REVERSED status. The existing payout validation permits nonnegative adjustment amounts only; negative remainders from inconsistent request data are clamped to zero as in the previous UI formula. Requests are not directly linked to AccountingDocuments, so history rows cannot establish current payable-subledger agreement.
- Added `backend/services/manufacturerSettlementReportingService.js` to serialize every history monetary field as a decimal string and calculate `remainingAmount = max(0, requested - paid)` with shared Decimal operations and no additional rounding. The request row's persisted status is passed through unchanged. Paid totals come from stored `paidAmount`, not from summing payout attempts, so failed/reversed attempts do not count as settled and separate request rows are not aggregated. Request/payout adjustment details are preserved and displayed; request remainder remains based on request amount and paid amount, matching the prior UI formula.
- Updated `manufacturer/src/pages/Finance.jsx` and `admin/src/components/manufacturer-details/ManufacturerDetailSections.jsx` to use decimal-string formatting for requested, paid, remaining, payout cash, payable reduction, and adjustment amounts. Both retain server status labels, existing filters/pagination/loading/error behavior, and payout workflow behavior. Repository search found no other Admin or Manufacturer consumer of these history endpoints and no export consumer.
- The history fields themselves are Decimal-backed, but the separate request-creation/eligibility path and `getManufacturerSettlementSummary` retain Number arithmetic, and legacy Float-backed source values may already have lost precision before request creation. R6 does not modify request creation, payout initiation/approval/posting, `financialPayoutService.js`, or schema.
- Tests: `node --test tests/manufacturerSettlementReportingService.test.js tests/manufacturerSettlementHistory.test.js tests/manufacturerSettlementService.test.js tests/manufacturerSummaryReportingService.test.js tests/nonExpensePartyReportingService.test.js tests/distributorSettlementPositionReportingService.test.js tests/expensePayableReportingService.test.js tests/operatingExpenseDecimalService.test.js tests/operatingExpenseIdempotencyService.test.js` — 42 passed, 0 failed, 0 skipped. Admin decimal display tests — 2 passed; Manufacturer decimal display tests — 3 passed. Backend syntax checks, Admin targeted ESLint, Manufacturer Oxlint, and both production builds passed; Admin build emitted its existing large-chunk warning.
- History API controller tests use mocked Prisma results, not persisted database rows. No isolated database was verified or accessed, and no migration, persisted source/payable comparison, historical conversion, or source-to-journal reconciliation was run. R6 is **IMPLEMENTED / UNIT TESTED**, not database validated or reconciled. P4.2 remains **INCOMPLETE** and P4.3 remains unauthorized. Previously observed `PAYOUT_SELF_REVIEW` test failures are unrelated; payout behavior was not changed.

## 20. Manufacturer settlement-request creation Decimal increment (2026-11-15)

- Traced `POST /api/manufacturer/finance/settlement-request` through `createManufacturerSettlementRequest`, `normalizeSettlementRequest`, `getManufacturerSettlementSummary`, the Admin manufacturer finance summary endpoint, and the Manufacturer Details finance display. Request creation currently has no Manufacturer portal submitter in this checkout; its API callers must send the idempotency key.
- `getManufacturerSettlementSummary` now uses `accountingDecimal`, `addDecimals`, `subtractDecimals`, and exact `compareDecimals` for payable journals, document balances, credits, request totals, paid amounts, and payable availability. NPR summary money is serialized at the existing two-decimal boundary. Date, status, and line-count fields remain non-monetary typed values. There is no new rounding point in eligibility calculations.
- Request input remains a strict decimal string and uses the existing HALF_EVEN request-posting quantization. Eligibility compares the Decimal request against the Decimal-string available amount. The Serializable transaction includes the eligibility read, request row and audit event. A client-supplied stable idempotency key now must be present; exact manufacturer/type/normalized amount/notes retries return the existing request, while changed-payload reuse conflicts. Bounded P2034 retries and P2002 winner recovery remain. The API returns domain error codes when present. No payout approval/posting behavior was changed.
- `backend/controllers/adminManufacturerDetailController.js` serializes payable/receivable money as Decimal strings. `admin/src/components/manufacturer-details/ManufacturerDetailSections.jsx` formats the finance-summary monetary fields using `formatNprAmount`; its production unit-cost breakdown still contains Number calculations, but those values come from separate production detail fields and are not this converted summary path.
- Tests: the focused R3–R7 backend command passed **54 tests, 0 failed, 0 skipped**; Admin `tests/decimalDisplay.test.js` passed **2**; Manufacturer `src/utils/decimalDisplay.test.js` passed **3**. Backend `node --check` and targeted Admin ESLint passed. Admin production build passed with the existing large-chunk warning. An initial Admin formatter command targeted `src/utils` instead of the actual `tests` directory and was rerun successfully at the correct path.
- These are service/controller mock tests, not persisted database or real concurrency tests. No database or migration was accessed. No source-to-payable, cash, or source-to-journal reconciliation was performed. Manufacturer settlement payout posting and its downstream Number arithmetic remain outside this increment. Upstream Float-backed historical inputs retain their original precision limits. Status: implemented/unit tested; database validation and reconciliation not demonstrated. P4.2 remains **INCOMPLETE**, and P4.3 remains unauthorized.

## 21. P4.2-R8 repository audit and prioritized remediation (2026-11-15)

### Audit scope and evidence

- Static scans covered backend controllers/services/routes/tests and courier/webhook-related code, Prisma schema, and all four portal source trees (`frontend`, `admin`, `manufacturer` including Distributor workspace, and `marketing`). `rg` search for `Number`, `parseFloat`, `.toNumber()`, and common numeric operations produced **1,834 candidate occurrences in 173 backend JavaScript files**; these include tests, counts, pagination, percentages and non-money conversions and are not a count of confirmed monetary defects. A monetary-name filtered portal scan returned **154 candidate occurrences across 43 files**; broad numeric matches appeared in 129 portal files and also include non-money values.
- A schema scan found **135 Prisma `Float` declarations** and **141 Decimal declarations**, all with explicit native scale in the current working tree. A field-name filter yielded **98 monetary-name candidates**, including rates/percentages and value/discount fields that still need semantic classification; this is not a count of confirmed monetary fields. No live MySQL definitions were inspected.
- **Thirteen concrete risk findings** were traced during R8; R9 also found a separate missing-source/journal/cap defect in the synthetic direct-manufacturer collection branch. The combined code-level inventory is **fourteen findings** (ten backend findings and four portal display/calculation findings). The audit is **PARTIAL**: the static scan is broad, but this pass did not establish every writer/reader/export relationship for every candidate field or inspect actual stored values. No database or credentials were accessed.

### Prioritized findings and next work

| Priority | Path / source fields | Numeric risk and impact | Existing tests / smallest fix / dependency |
|---|---|---|---|
| P1 | `backend/controllers/financialController.js` `settlePayable` and `collectReceivable`; `AccountPayable`, `AccountReceivable`, `FinancialPayout`, `CashTransaction` | Missing caller key gets a new random idempotency key; a retried payout/collection can create a second financial effect. Collection's four-second duplicate guard is not durable. | Existing `settlementIdempotencyAndRevert.test.js` is DB-guarded; Admin `PayablesReceivables.jsx` already sends stable keys. Require a valid client key before reads/writes; test early rejection without DB. Compatibility risk is limited to clients outside the repository. |
| P1 | `backend/controllers/financialController.js` `collectReceivable`; amount, adjustment, and settlement-total request values | Before R9, `Number` parsing and addition/subtraction drove receipt, adjustment and account settlement amounts; binary rounding could disagree with the receivable document and journal. | Resolved in R9 with shared Decimal parsing/calculation, Decimal journal posting, decimal-string responses, boundary/replay tests, and Admin string requests. Persisted-data validation remains blocked. |
| P1 (R9 trace; fixed) | `backend/controllers/financialController.js` `collectReceivable` direct-manufacturer branch; synthetic `AR-MFG-DIRECT-*`, `Order`, `Product`, `ManufacturerInventory`, `AccountReceivable`, `CashTransaction`, and journal | The synthetic direct-margin branch accepted collections without recomputing/capping the current source balance, did not persist collection history/receivable paid state, and did not post the collection journal. | R9 now uses the report's shared Decimal source calculation, creates/updates a linked receivable collection source and journals transactionally, and rejects collection above the computed balance. Unit tests cover the source calculation and collection service; no database validation was run. Float-backed order/product/inventory source precision remains unresolved under the separate checkout/source finding. |
| P1 | `backend/controllers/orderController.js` checkout total and shipment allocation; `Product.price`, `Order.amount`, `Order.deliveryFee`, `Order.loyaltyDiscount` | Number arithmetic and Float storage can make line/order/shipment totals disagree; payment posting later consumes the stored Order amount. | `orderAmount.test.js`, `orderShipmentSplitting.test.js`, payment tests; use Decimal/minor units with a conserved residual. Schema conversion requires isolated migration and historical reconciliation. |
| P1 | `backend/services/customerReturnWorkflowService.js`; `CustomerReturn.totalRefundAmount`, `vatRefunded` (Float) and approved amount (Decimal) | Requested refund/VAT and approved/journal amounts can diverge; `.toNumber()` and Number accumulation occur. | `customerReturnAccounting.test.js`; Decimal end-to-end and source consistency tests. Float migration/backfill must be isolated and measured. |
| P1 | `backend/services/ncmSettlementService.js`; `DeliveryFinancialSettlement` COD/fee/adjustment Float fields | Float-origin candidate/replay values can differ from Decimal remittance batches, cash and variances; account 1180 does not distinguish wallet cash from gateway clearing. | `ncmSettlementService.test.js` uses mostly whole amounts; add fractional/replay coverage and classify wallet versus gateway before reconciliation. Schema migration and open-batch evidence required. |
| P1 | `backend/controllers/financialController.js` loan schedule paths; `InvestorLiability` principal/payment/balance/installment Float fields and JSON schedule | Number/toFixed installment generation can cause amortization residuals versus principal, interest and cash postings. | `loanAccountingService.test.js` does not verify schedule cent conservation; Decimal schedule plus deterministic final-installment residual and migration/reconciliation needed. |
| P1 | `backend/controllers/financialController.js` fixed-asset purchase; `FixedAsset` cost/paid/payable/disposal Float fields | Number inputs, `===` replay comparison and Float writes can affect asset recognition and Treasury debit. | `fixedAssetDepreciationService.test.js` does not exercise purchase input/replay boundaries; validate decimal strings and normalized replay; migration required. |
| P2 | `backend/services/shareBuybackService.js`; `PartnerEquity.currentCapital`, `ShareTransaction.totalAmount` and share fields | Decimal results are converted to Number and persisted to Float cap-table values; repeated actions can accumulate discrepancy. | `shareEquityIntegrity.integration.test.js`; unit precision/conservation tests and isolated schema conversion; share register review is also required. |
| P2 | `backend/controllers/financialController.js` operational financial summaries; `backend/services/collaborationFeeReceivableReconciliationService.js` | Number accumulators and tolerance comparisons can conceal or distort displayed totals/variances against Decimal ledger values. | Existing financial dashboard and collaboration reconciliation tests; Decimal summary and exact comparisons, then align API/export strings. |
| P2 | `admin/src/components/NcmSettlementBatchManager.jsx` candidate totals/variance | Number aggregation may misstate a cent variance and the required adjustment UX; not the authoritative backend posting path. | No UI variance test found; Decimal-string sum/compare and cent-boundary test. |
| P3 | `manufacturer/src/pages/Production.jsx` quote VAT preview | Number-based VAT inclusive/exclusive preview may differ from backend Decimal quote calculation. | Backend validation is authoritative; add parity UI tests and string-safe preview calculation. |
| P3 | `admin/src/pages/FinanceDashboard.jsx` operational details subtotal | Number summation can round a management-estimate subtotal; not posted GL authority. | Backend costing tests exist; add fractional UI subtotal test and Decimal display arithmetic. |
| P3 | `manufacturer/src/pages/OrderDetail.jsx` order amount display | A JSON decimal string is formatted with `toLocaleString()` without numeric formatting, causing inconsistent grouping; no posting effect. | Add a string/number rendering test and use the portal's decimal formatter. |

### R8 bounded implementation

- Implemented the P1 idempotency gap only: payable payout initiation and receivable collection now require a stable key; the random per-request fallbacks were removed. The check is placed before the respective first Prisma read. `CONFIRM`/`FAIL` payout actions continue to use the existing payout ID contract and do not require a new key. In-repository Admin request bodies already send idempotency keys; out-of-repository callers that omit one will now receive HTTP 400.
- Added DB-free early-return tests in `backend/tests/financialCollectionIdempotencyKey.test.js`. The guarded DB integration test was not run. No Decimal arithmetic, schema, migration, payout confirmation, allocation, or accounting behavior was changed in this remediation.
- **Audit status: PARTIAL. Implementation status: COMPLETE for this bounded idempotency requirement only.** The remaining Number/Float findings above are prioritized follow-up work, not claimed fixed.
- Validation planned/performed is recorded in the R8 tracker entry. Persisted database testing and any schema conversion remain **BLOCKED** until a separately verified isolated MySQL endpoint is provided; `localhost/clothing` was not contacted.
- **Coverage limits:** Mapped Treasury-to-GL comparison uses Decimal and exact equality in its existing report, but this is not bank/provider reconciliation; GL 1180 can combine wallet and gateway-clearing movements. Marketing redemption CPA has source-snapshot and payable-document/reconciliation work recorded in earlier increments, but this scan did not establish Decimal safety for every historical CPA writer, settlement, refund/reversal and export path. External gateway/provider statements and persisted COD/remittance populations were not checked. The stock-return audit CSV passes amount values through without arithmetic; every export serialization contract was not validated.

## 22. P4.2-R9 receivable collection Decimal arithmetic (2026-11-15)

- **Root cause and trace:** `collectReceivable` converted request amounts, adjustment amounts, balances, and status decisions through JavaScript `Number`. It then passed those values to `postCustomerPaymentAccounting`, which also used `Number`. The trace covered the Admin form, NCM approval submission, the synthetic direct-manufacturer margin branch, stored `AccountReceivable` collections, cash balance/transaction writes, customer-payment journal posting, JSON collection history, replay handling, and response fields.
- **Implementation:** The endpoint accepts decimal-string monetary inputs only, parses and quantizes with the shared HALF_EVEN NPR helper, compares and calculates outstanding/received amounts with Decimal, and serializes monetary response/history values as decimal strings. Source CAS updates, treasury inflows, cash transactions, and journal posting remain within the caller's Prisma transaction. Same-key retries are classified against stored request details; changed collection payloads conflict. The synthetic direct-manufacturer source is recomputed using the existing report calculation, capped against remaining margin, and persisted with its collection history, cash transaction, and journal. Admin collection validation, request-key generation, and request serialization retain decimal strings.
- **API compatibility:** Existing Admin collection submissions now send strings. JSON numeric `amount` or `adjustmentAmount` inputs are rejected with HTTP 400 rather than converted from binary floating point; legacy clients must send decimal strings. Success bodies add decimal-string fields for collected, settlement, adjustment, received, and remaining amounts. The endpoint remains one receivable per request; no multi-receivable allocation API was introduced.
- **Tests:** `receivableCollectionService.test.js`, `financialCollectionIdempotencyKey.test.js`, and `nonExpensePartyReportingService.test.js` passed **21/21**; selected `accountingOperationalPosters.test.js` customer-payment tests passed **2/2**. The complete `accountingOperationalPosters.test.js` and `accountingEngine.test.js` runs passed **73/73** posting tests and **26/26** accounting assertions respectively. Backend syntax checks, targeted Admin ESLint, and the Admin production build passed (existing large-chunk warning). The guarded `settlementIdempotencyAndRevert.test.js` was invoked with its integration guard disabled and reported **1 skipped**; no persisted outcome is claimed.
- **Limitations and status:** No verified isolated MySQL endpoint was available; `localhost/clothing` was not accessed. Persisted transactional/replay validation, source/subledger/journal reconciliation, and historical source precision are **BLOCKED / NOT RUN**. Direct-manufacturer margin is derived from existing Float-backed `Order.amount`, `Product.costPrice`, and manufacturer inventory costs, so Decimal cannot recover precision already lost in those sources. The route processes one receivable per request; multi-document allocation is not a supported current feature. R9 code and unit behavior are implemented and tested, but the iteration is **PARTIAL** pending persisted validation; R8 audit remains **PARTIAL**, Phase 4 **INCOMPLETE**, and P4.3 **NOT STARTED**.

## 23. P4.2-R10 payout maker-checker identity (2026-11-15)

- **Trace:** Payout requests originate in `initiateFinancialPayout`, which stores `initiatedByAccountId`, reserves Treasury, and records an initiation audit. `confirmFinancialPayout` checks maker/checker identity before releasing the reservation and invoking the target-specific posting finalizer; `failFinancialPayout` releases the reservation and records `failedByAccountId` and a failure audit. Target-specific confirmation/failure callers are the Admin financial and manufacturer-finance controllers plus distributor-finance service. The payout routes require `authenticate` and `authorize("finance:payable_settle")`; the shared auth middleware resolves a canonical account ID used by both initiation and review.
- **Reproduction and classification:** `node --test tests/financialPayoutService.test.js` initially reproduced two failures (4 passed, 2 failed). The failed-payout and Marketing CPA fixtures omitted `initiatedByAccountId` but supplied a failure actor. The existing fail-closed guard raised `PAYOUT_SELF_REVIEW` when maker identity was absent; these were invalid test fixtures, not a defect allowing a maker to review their own payout. Separately, initiation allowed a missing maker and failure allowed a missing reviewer, while confirmation and failure compared unnormalized identity strings. Those are product-control defects and are corrected in this increment.
- **Change:** The payout service now requires a nonblank maker before initiation and a nonblank reviewer/checker before failure/confirmation, normalizes actor IDs before storage and audit, distinguishes missing maker from self-review, and rejects same-actor approval or failure before financial side effects. Existing Decimal monetary arithmetic, transaction boundaries, idempotency, posting finalizers, and source-backed reversal workflow were not changed. Test fixtures now use distinct maker and reviewer identities. No schema change was needed.
- **Tests:** `node --test tests/financialPayoutService.test.js tests/distributorSelfDeliveryAndFinance.test.js tests/accountingOperationalPosters.test.js` passed **106/106**; `node --test tests/settlementCorrectionService.test.js tests/accountingJournalReversalPolicy.test.js` passed **8/8**. Guarded `financialPayoutConcurrency.integration.test.js` and `settlementIdempotencyAndRevert.test.js` were run with `RUN_DATABASE_INTEGRATION_TESTS` not enabled and were **skipped (2)**. Backend syntax checks and `git diff --check` passed.
- **Limitations and status:** Tests exercise service state transitions with mock transaction clients and verify that rejected self-review does not release reservations, invoke posting, change payout state, or add payout audit records. They are not persisted database evidence. No database or migration was accessed; persisted initiation/review/failure/retry/reversal, cash/journal atomicity, and concurrency validation remain **BLOCKED / NOT RUN**. R10 is **PARTIAL** pending a verified isolated database. R8 remains **PARTIAL**, P4.2 and Phase 4 remain **INCOMPLETE**, and P4.3 remains **NOT STARTED**.

## 24. P4.2-R11 manufacturer payout lifecycle hardening (2026-11-15)

- **Trace:** Reviewed payout initiation, caller idempotency, manufacturer lookup and COGS/direct-margin source inputs, posted payable journal aggregation, available Treasury calculation, adjustment and settlement amounts, duplicate checks, payable/history updates, cash transaction, supplier-payment journal and allocation, reservation release, payout status, audit actor, API responses, shared payout lifecycle services, and related tests. The custom `payManufacturer` confirmation path does not call `confirmFinancialPayout`; it performs a separate transaction and therefore needed the same maker-checker invariant explicitly.
- **Root cause and changes:** The custom confirmation path compared maker and reviewer IDs without normalization; whitespace differences could evade self-review. Manufacturer payout INITIATE also allowed a random UUID fallback rather than requiring the caller's stable idempotency key. The controller now calls shared `assertIndependentPayoutReviewer` before the custom transaction and uses the normalized reviewer ID for payout confirmation and audit attribution. Missing/invalid caller keys now return HTTP 400 before database reads. Covered controller monetary calculations (journal payable totals, COGS and direct-margin totals, historic payment totals, outstanding and cash-availability comparisons, adjustment/settlement math, and payable updates) now use `accountingDecimal`/shared Decimal operations; monetary API/history fields remain decimal strings. The posted account-2160 aggregation returns `recognized`, `paid`, and `outstanding` strings.
- **Precision limitations and remaining conversions:** `Order.amount`, `Product.costPrice`, and ManufacturerInventory agreed/proposed costs are Float-backed source values; converting the fetched values to Decimal preserves the retrieved decimal representation but cannot restore any precision already lost in storage. The covered `payManufacturer` path has no monetary Number arithmetic/output remaining. Other Number uses elsewhere in `financialController.js`, including financial summaries and non-payout routes, and independent payout/settlement paths remain outside R11 and retain their prior ownership in P4.2 findings. No rounding policy or Prisma schema was changed; the shared NPR HALF_EVEN parser is used for this controller's submitted payout amounts.
- **API and control behavior:** INITIATE clients must submit a nonblank key of at most 191 characters or receive HTTP 400 with `IDEMPOTENCY_KEY_REQUIRED`; Admin authorization and external bank-evidence requirements are unchanged. CONFIRM still uses `payoutId` and stored payout details. Same-maker confirmation returns the existing self-approval error before additional Prisma reads or transaction mutations. Responses serialize payable/cash money as strings.
- **Tests:** `node --test tests/financialPayoutService.test.js tests/accountingOperationalPosters.test.js tests/manufacturerSettlementService.test.js tests/manufacturerSettlementCreation.test.js tests/nonExpensePartyReportingService.test.js tests/settlementIdempotencyAndRevert.test.js tests/financialPayoutConcurrency.integration.test.js` — **112 passed, 0 failed, 2 skipped**. The two skipped tests are explicitly guarded persistence/concurrency cases. `node --check` passed for `financialController.js`, `financialPayoutService.js`, and `financialPayoutService.test.js`; `git diff --check` passed (line-ending warnings only).
- **Consistency and database evidence:** These are controller/service and posting tests using mocks; they are calculation/control tests, not persisted source-to-payable checks or source-to-journal reconciliation. No database was connected, inspected, migrated, or modified. The configured `localhost/clothing` target is prohibited, and no verified isolated database endpoint was available. Persisted transaction/replay/rollback/concurrency and source/payable/cash/journal consistency are **BLOCKED / NOT TESTED**.
- **Status:** R11 is **PARTIAL** pending isolated persistence validation. R8 remains **PARTIAL**; P4.2 remains **INCOMPLETE**; Phase 4 remains **INCOMPLETE**; P4.3 remains **NOT STARTED**. Remaining P4.2 work includes other payout/settlement Number paths, legacy Float sources, outstanding P1 money paths, broad reader/writer conversion, isolated migration and historical-data checks, and source/subledger/journal reconciliation. Do not start P4.3.

## 25. P4.2-R12 isolated database safety audit (2026-11-16)

- **Connection source and current target:** `backend/prisma/schema.prisma` uses `env("DATABASE_URL")`; `backend/config/db.js` creates the shared Prisma client. `dotenv/config` is loaded by the API and several tests; Node test children inherit the parent's environment. A credentials-redacted read-only metadata check found only `backend/.env` with MySQL host `localhost`, port `3306`, database `clothing`. No `ACCOUNTING_TEST_DATABASE_URL`, test host/port/name, or verification marker was present in the inspected files/process environment. No socket/SQL connection or metadata query was attempted.
- **Environment and process behavior:** No test script assignment to `process.env.DATABASE_URL` or dotenv `override: true` was found. The repository's sequential test runner passes environment variables unchanged and serializes its own test files, but concurrent independent test processes are not coordinated by a database lock.
- **Existing guards and gaps:** The sequential runner skips a fixed list of guarded files unless `RUN_DATABASE_INTEGRATION_TESTS=1`; several other integration tests gate on the same variable. Existing target checks vary: some only check a database-name substring, one requires the literal name `clothing_test`, and payout concurrency/settlement-reversion tests previously relied only on the opt-in flag. `capitalSolvency.test.js` constructs a direct Prisma client and previously relied on the sequential-runner skip. These checks did not establish server identity or prove isolation. `financialPayoutConcurrency.integration.test.js` exercises generic `ACCOUNT_PAYABLE`, not `MANUFACTURER_PAYABLE`, and its test fixture arithmetic contains Number conversions; it was not run against a database.
- **Fail-closed change:** Added `assertIntegrationDatabaseSafety` before shared Prisma client construction and before the direct client in `capitalSolvency.test.js`. When `RUN_DATABASE_INTEGRATION_TESTS=1`, it requires the explicitly supplied test URL to exactly equal `DATABASE_URL`, a MySQL URL, explicit host/port/database identity values, an operator verification attestation, and a database name other than `clothing`; any mismatch throws before Prisma client construction. The identity marker is only an attestation; independently verified isolation evidence remains an operator prerequisite. This configuration does not modify `.env` or replace runtime URLs. Standalone seed/diagnostic scripts that instantiate Prisma directly are outside this integration gate; they were not run.
- **Migration/backup evidence:** `npm run check:migrations` passed for all 60 migration directories; `npx prisma validate` passed. These offline checks do not prove a clean migration, populated-data conversion, deployed migration status, schema drift, or backup/restore. No sanitized populated database or separately verified isolated endpoint is available. No migration, seed, backup, restore, or destructive/synchronization command was run. Clean migration, populated migration, backup, and restore are **BLOCKED / NOT TESTED**.
- **Guard tests:** `node --test tests/integrationDatabaseSafety.test.js tests/financialPayoutService.test.js tests/financialPayoutConcurrency.integration.test.js tests/settlementIdempotencyAndRevert.test.js` passed **16**, failed **0**, skipped **2** (the database tests were skipped with integration opt-in unset). The direct import probe with integration opt-in and `localhost:3306/clothing` but no test-target configuration was rejected before Prisma client construction. Syntax checks passed for the new guard, shared Prisma configuration, and guarded direct-client test; `git diff --check` passed with pre-existing line-ending warnings.
- **Financial integration and consistency:** No payout integration, transaction rollback, concurrent request/confirmation, persisted replay, cash/payable/journal/allocation/audit verification, or source-to-accounting assertion ran against MySQL. The R11 service/controller tests remain mocks/early-return tests and do not establish persisted integrity. Source-to-payable and source-to-journal checks are **NOT TESTED**.
- **Remaining inventory:** R8's 13 categorized findings remain the bounded repository inventory; R12 did not repeat a field-name Float scan or claim semantic coverage of all writers/readers/exports. Checkout/orders, returns/refunds, NCM COD, Marketing CPA, loans, fixed assets, inventory/product costs, remaining Number arithmetic, reporting/exports, and historical conversions continue to require their own source-to-accounting analysis and tests.
- **Status:** R12 is **PARTIAL / BLOCKED** because the only configured database is prohibited and no independently verified isolated endpoint or sanitized populated source exists. R8 remains **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **NOT STARTED**.

## 26. P4.2-R13 database entry-point safety and validation handoff (2026-11-16)

R13 is a test/maintenance safety increment, not a financial calculation change. It does not change the Prisma schema, accounting policy, normal application database URL, or production worker behavior.

- `backend/utils/integrationDatabaseSafety.js` now validates three explicit purposes: integration, maintenance, and migration. Each has a separate opt-in, approved URL, host, port, database name, and operator-attestation variable; the selected URL must exactly match `DATABASE_URL`, be MySQL, and match the supplied identity. The `clothing` database is rejected. Configuration validation does not connect and does not prove that the claimed endpoint is isolated.
- Guarded paths include the shared Prisma client when database integration mode is enabled, all 21 identified database-backed test modules, the sequential test runner, direct Prisma seed/diagnostic clients, shared-client maintenance scripts, and package migration/seed commands. `runIsolatedAccountingTests.ps1` provides a preflighted execution path. The direct MySQL debug scripts were also changed locally to require the maintenance profile and use the validated URL rather than embedded `localhost/clothing` credentials; those ignored scratch files are not tracked deliverables.
- The normal API and operational workers remain ungated when none of the test/maintenance/migration flags are set. Ordinary runtime database access is intentionally not restricted by this test-only hardening.
- The test runner's sequential skip behavior is extended to `.integration.test.js` and `.integration.spec.js` naming patterns plus existing database test names. Direct test processes using the shared Prisma client are still checked before client construction.
- The DBA handoff and 14-step sequence are in `06-sandbox-migration-and-cutover-runbook.md`. All process variables must be supplied out of band after independent DBA verification; the `..._VERIFIED=1` marker is an attestation, not verification evidence.
- The current environment still exposes only the prohibited `localhost:3306/clothing` target; no isolated endpoint, DBA identity evidence, or sanitized populated clone is available. No database connection, migration, seed, backup, restore, or persisted test was attempted.
- `node --test tests/integrationDatabaseSafety.test.js` passed **19/19**. Syntax checks passed for 36 JavaScript files and the PowerShell runner parsed successfully; `npm run check:migrations` checked 60 directories; `npx prisma validate` passed; `git diff --check` passed with existing line-ending warnings. These configuration/static checks establish refusal and preflight ordering only. They do not establish persisted migration correctness, financial transaction integrity, source-to-journal reconciliation, or Phase 4 completion.

**Status:** R13 is **PARTIAL / BLOCKED** pending an independently verified isolated endpoint, DBA handoff evidence, and permitted persisted validation. R12 and R8 remain **PARTIAL**; P4.2 and Phase 4 remain **INCOMPLETE**; P4.3 remains **NOT STARTED**.

## 27. P4.2-R14 accounting domain and precision-path audit (2026-11-16)

**Status: PARTIAL.** R14 produced a static internal accounting domain audit, not a financial conversion or reconciliation. See [`09-r14-business-event-inventory.md`](./09-r14-business-event-inventory.md), [`10-r14-accounting-event-matrix.md`](./10-r14-accounting-event-matrix.md), [`11-r14-sales-lifecycle.md`](./11-r14-sales-lifecycle.md), [`12-r14-returns-exchanges.md`](./12-r14-returns-exchanges.md), [`13-r14-ap-ar-lifecycle.md`](./13-r14-ap-ar-lifecycle.md), [`14-r14-inventory-cogs.md`](./14-r14-inventory-cogs.md), and [`15-r14-invariants-test-matrix.md`](./15-r14-invariants-test-matrix.md).

### Source and amount path conclusions

- **Sales and receipts:** delivered sale posting is event/outbox based, but `Order.payment` is set on COD delivery and is not settlement evidence. A separate delivered-order cash helper is not mounted in the reviewed order routes. No general payment-provider authorization/capture, mixed-tender or chargeback source path was found. Checkout and source order costs still include legacy Float-backed values; converting them at report time cannot restore historic precision.
- **Returns/exchanges:** original sale amount/discount snapshots, physical inspection, refund obligation/payment and inventory movement are separate. Platform/customer/distributor paths differ; some return stock updates remain on legacy `Product`/`StockLog`. Report date and amount populations do not necessarily represent approved, inspected or paid refunds. Full exchange cancellation/reversal is not established.
- **AP/AR:** source-linked `AccountingDocument`/allocation records coexist with legacy mutable `AccountPayable`/`AccountReceivable` and manual creation flows. Two customer collection implementations have differing adjustment semantics. Expense, manufacturer, distributor, CPA, NCM/COD and refund paths are not one demonstrated control-account population. A source row or balanced journal alone does not establish a complete payable/receivable.
- **Inventory/COGS:** `InventoryBalance`/`InventoryLedgerEntry` are canonical for newer paths, while `Product.stockQuantity`, `ManufacturerInventory` and `StockLog` remain active. Production cost layers use FIFO in selected flows; some reports use `Product.costPrice` fallback and selected movements lack layer provenance. Purchase posting has no discovered active connection to physical receipt plus canonical quantity/cost-layer creation. Inventory and COGS cannot yet be described as a complete uniform valuation path.
- **Other domains/reports:** parallel expense and settlement paths, legacy marketing settlements, NCM accrual/remittance versus older helpers, and Float/Number paths in loans/assets/equity remain. Treasury-to-GL comparison is not external bank/provider reconciliation. Cash-flow and management reports are not wholly ledger-derived.

### Remaining monetary Number/Float exposures and owners

This is a qualitative R14 follow-up to the R8 field/path inventory; it is **not** a new complete static scan or assertion that every call site was enumerated. Owners are domain owners by code/workflow, not named individuals.

| Area requiring follow-up | Known precision/reporting exposure | Responsible code owner for next bounded audit |
|---|---|---|
| Order/checkout/delivery | Float-backed order totals and product cost inputs; paid Boolean can be confused with settlement; source-to-sale/receipt linkage is incomplete | Backend order, delivery and accounting-posting owners; storefront/Admin callers |
| Customer returns/refunds/exchanges | Legacy Float refund/price fields and route-specific quantity/value aggregations; differing dates and amount bases | Backend return/refund/exchange services and owning Admin/customer/distributor consumers |
| Inventory and COGS | Float-backed `Product.costPrice`, legacy stock counters, incomplete layer provenance and fallback cost arithmetic | Backend inventory-ledger/cost-layer and production/purchase owners; Admin inventory/report consumers |
| AP/AR and payout/settlement | Legacy mutable amount fields, Number readers/aggregators and overlapping source generations outside already converted bounded endpoints | Backend financial document, collection, payout, settlement and report owners; Admin statements/exports |
| NCM/COD and Treasury | Legacy settlement/variance arithmetic and status-derived settlement assumptions; external evidence not linked for complete matching | Backend delivery/NCM/Treasury owners and Admin settlement reports |
| Marketing CPA | Legacy `MarketingPartnerSettlement` Float source alongside newer redemption bills and payout path | Backend marketing finance and Admin/marketing report owners |
| Loans, fixed assets and equity | Float-backed source amounts and Number calculation paths in balances, amortization, acquisition/depreciation, shares/drawings/distribution | Backend loan/asset/equity owners and Admin finance consumers |
| Reports, dashboards and exports | Remaining operational cash-flow, dashboard, tax-estimate and legacy settlement paths; consumers may coerce decimal strings | Owning backend report/controller and portal/export owners |

Use the shared `accountingDecimal.js` utilities and the existing NPR two-decimal HALF_EVEN policy effective 2026-11-15 when a separately scoped implementation is approved. R14 does not add a rounding boundary, modify the helper, change an account mapping or infer tax treatment. Keep quantities, rates, percentages, dates and counts in their correct semantic types.

### Evidence and remaining gates

- R14 changed documentation only; it did not run tests, builds, migration checks, schema validation or database commands.
- No local database was contacted. The sole configured `localhost:3306/clothing` target remains prohibited; no isolated database endpoint or populated backup was verified.
- **Report-calculation tests:** none run in R14.
- **Persisted source-to-subledger checks:** **BLOCKED / NOT PERFORMED.**
- **Source-to-journal/control-account reconciliation:** **BLOCKED / NOT PERFORMED.**
- **External bank/provider/carrier settlement reconciliation:** **BLOCKED / NOT PERFORMED.**
- **Historical Float conversion/drift evidence:** **BLOCKED / NOT PERFORMED.**
- The internal NPR precision policy is unchanged. No claim is made that every R14 source path already uses Decimal or that existing historical records are precise.

### Next bounded increment and phase status

The ordered R15 proposal is in [`15-r14-invariants-test-matrix.md`](./15-r14-invariants-test-matrix.md). First obtain independent DBA verification for an isolated endpoint under the R13 handoff; without it, do not run database-backed validation or migrations. Then select one approved, source-bounded reconciliation or lifecycle gap. Do not start P4.3.

**R14: PARTIAL. R13/R12: PARTIAL / BLOCKED. R8: PARTIAL. P4.2: INCOMPLETE. Phase 4: INCOMPLETE. P4.3: NOT STARTED.**

## 28. P4.2-R15 sales/COD Decimal and status-integrity increment (2026-11-16)

**Status: PARTIAL.** R15 corrected delivery/payment semantics, cancellation gating, and the bounded NCM batch/report calculations. It did not complete the entire sales, direct-order, payment, refund, reporting, or persisted-reconciliation scope.

### Implemented

- `backend/services/deliveryService.js`: NCM `DELIVERED` and `RETURN_REQUESTED` status synchronization no longer writes or resets the `Order.payment` Boolean. The existing delivered-sale event/outbox and `postDeliveredOrderAccounting` path remain unchanged.
- `backend/services/distributorSelfDeliveryService.js`: the existing full-COD `DistributorCashEvent` is still recorded; payment status is set only when the collection is OTP-verified. When OTP is disabled the recorded declaration remains `PENDING_VERIFICATION` and does not mark the order paid.
- `backend/services/orderCancellationService.js`: before any cancellation or inventory mutation, the serializable service checks payment state plus order-linked journal, accounting document, cash transaction, and distributor cash event. Financially active orders fail closed; no automatic refund or journal reversal is created.
- `backend/services/ncmSettlementService.js`: NCM candidate calculations, batch COD/fee/net/variance aggregation, receivable reconciliation, and variance allocation amounts use `accountingDecimal.js` utilities and `quantizeNprAmount` under the approved NPR two-decimal HALF_EVEN policy. Decimal values sent to Decimal treasury/cash fields are formatted as decimal strings, not converted with `toNumber()`. The NCM batch now requires `actualNetDeposit` as a decimal string and no longer substitutes the calculated expected deposit when it is absent. It also no longer overwrites Float-backed per-delivery `codCollected` with an expected amount.
- `backend/services/ncmSettlementService.js` and `backend/controllers/deliveryController.js`: settlement dashboard totals use Decimal aggregation and serialize monetary values as strings. `codSettledGross` and `codOpenExpected` are additive. Legacy `codReceived`/`codToReceive` retain the per-delivery `codCollected` field semantics and are not independent bank evidence.
- `admin/src/components/NcmSettlementBatchManager.jsx` and `admin/src/pages/DeliveryMonitor.jsx`: candidate totals, variance comparison, settlement-history amounts, and report display use decimal strings. The UI distinguishes gross COD in recorded settled batches from delivery and collection states.

### Remaining source and conversion limits

- `Order.amount` and `DeliveryFinancialSettlement` COD/fee fields remain Float-backed. Converting their current values to Decimal provides exact arithmetic only over the stored Float representation; it cannot recover historical precision.
- Storefront/Admin and manufacturer/distributor direct-order paths still lack one canonical payment-event/cash-evidence model. The Admin direct-order service can post a customer-payment journal from a paid Boolean without a linked `CashTransaction`/selected Treasury account; manufacturer direct-order status accepts a payment Boolean without an equivalent receipt workflow; distributor direct-order payment posting includes Number-based source amount conversion. These remain unmodified pending approved tender, evidence, and Treasury rules.
- `recordDeliveredOrderCashReceipt` remains unmounted in the reviewed order routes and has no explicit cash-evidence source.
- NCM integration does not currently provide a trusted per-delivery actual collection amount through the reviewed status reconciliation path. The full-amount distributor self-delivery flow does not support partial/failed collection. R15 did not add external integrations or infer actual carrier collection from delivery status.
- Customer cancellation now fails closed for financial activity but there is no general `OrderPayment`/`OrderRefund` record to derive refundable amounts from multiple, partial, pending, completed, or failed receipts. Existing RMA refund-payable and distributor evidence/review flows are separate; full refund caps, retry, reversal and report coverage remain **NOT IMPLEMENTED / NOT TESTED**.
- Full Admin sales, payment, COD, cancellation, refund, financial-statement, cash-flow, and downloadable-report population reconciliation remains **NOT TESTED**. The report-calculation tests do not establish completeness of source rows or posted journals.

### Validation and evidence

From `backend/`, the focused command
`node --test tests\ncmSettlementService.test.js tests\adminOrderCancellation.test.js tests\distributorSelfDeliveryAndFinance.test.js tests\deliveryAccountingOutboxIntegration.test.js`
passed **64**, failed **0**, skipped **0** using mocked Prisma clients/synthetic data. This includes fractional NPR aggregation, HALF_EVEN summary rounding, decimal-string values, explicit actual deposit, changed-payload replay, pending self-delivery collection, delivery status not mutating payment, and cancellation rejection before mutation. It is not persisted transaction, source-to-journal, or bank/carrier evidence.

Targeted Admin ESLint reported three `react/prop-types` errors at existing component props in `DeliveryMonitor.jsx`; frontend ESLint reported **0 errors and 1 hook-dependency warning** in `Orders.jsx`. No build or browser test was run. No database was connected to, inspected, or modified; no migration, seed, provider request, historical conversion, or external statement match was run. Persisted consistency remains **BLOCKED BY DATABASE VALIDATION**.

**R15: PARTIAL. P4.2: INCOMPLETE. Phase 4: INCOMPLETE. P4.3: NOT STARTED.** At the R15 checkpoint, R16 was recommended to establish an approved source-linked COD/direct-order receipt lifecycle—actual amount, partial/failure states, source/actor/evidence, replay/conflict behavior, and clear separation from remittance—before broad refund/report conversion. See section 29 for the R16 work and its remaining integration gap.

## 29. P4.2-R16 receipt lifecycle Decimal increment (2026-11-16)

- `backend/services/distributorDeliveryOtpService.js`: full self-delivery COD amount construction and OTP amount comparison use `accountingDecimal.js`, `addDecimals`, and `quantizeNprAmount` under the approved NPR two-decimal HALF_EVEN policy. Amounts are retained as decimal strings. Inputs are currently sourced from Float-backed order fields, so no historical precision is recovered.
- `backend/services/distributorSelfDeliveryService.js`: a COD collection write requires authenticated actor attribution; existing verified/pending collection semantics are preserved.
- `backend/controllers/orderController.js`: order-list serialization no longer infers payment from `DELIVERED` plus COD/self-delivery status.
- `backend/services/distributorCashSettlementService.js`: both the unmounted `submitDistributorRemittance` helper and routed Admin-created `COMPANY_COLLECTS` request/posting flow now cap collected cash at verified, unremitted `CUSTOMER_COLLECTION` events matched to eligible COD document IDs/source IDs; unsupported receivable sources fail closed. The Admin review path requires a decimal-string actual-received amount exactly equal to the request and a recorded Admin actor before posting. This is a conservative source-cap control, not bank-statement reconciliation or a custody subledger. Distributor cash-position monetary fields remain decimal strings; the held balance is not a physical cash count.
- `backend/controllers/distributorFinanceController.js`, `backend/tests/distributorRoutesIntegration.test.js`: the review controller forwards the Admin-entered received amount and the route wiring is asserted. `admin/src/components/distributor-details/DistributorDetailSections.jsx` requires that amount before confirmation, uses decimal-string comparisons for request bounds, position totals, and transaction signs, and presents company receipts as recorded rather than statement-reconciled. `manufacturer/src/pages/DistributorFinanceDashboard.jsx` formats the same monetary balance/request values from decimal strings.
- Existing NCM report money fields remain semantically distinct: `codExpected` is expected COD; `codOpenExpected` is expected COD in open settlement rows; `codSettledGross` is gross COD in non-reversed remittance batches; legacy `codReceived` is the sum of the Float-backed `codCollected` field and `codToReceive` is the legacy expected-minus-field calculation. These are not independent collection evidence. `financialController` still contains a Number-based NCM synthetic receivable calculation and is a remaining owner-path conversion.
- Direct Admin/manufacturer/distributor order amount and payment paths still contain Number arithmetic/conversions and lack a common source-linked actual receipt with cash location, evidence, and idempotency. `NcmCourierAdapter.trackDelivery` also converts provider `cod_collected` to Number, with no trusted persistence consumer found in this trace. These are **NOT IMPLEMENTED / REMAINING P4.2 WORK**; no historical migration was performed.
- From `backend/`, the settlement/controller/service command passed **52/52** and the adjacent delivery-accounting outbox, NCM settlement, and order-payment accounting command passed **39/39**, using mocked clients/synthetic data. Tests cover source-mismatched event rejection, exact received-amount confirmation, replay, and route-to-controller wiring. Admin and manufacturer builds passed; targeted Admin ESLint passed. Full Admin lint still reports 47 errors and 25 warnings elsewhere in the portal; targeted manufacturer Oxlint passed with four warnings in the changed file. No database or provider was accessed. Persisted replay/rollback/concurrency, source-to-journal, and external settlement validation remain **BLOCKED BY DATABASE VALIDATION**.

**R16: PARTIAL. P4.2: INCOMPLETE. Phase 4: INCOMPLETE. P4.3: NOT STARTED.** No new rounding policy or historical conversion was introduced.

