# Database and Schemas

## 1. Database Engine and ORM

The project uses:

- MySQL as the primary transactional database
- Prisma ORM as the schema, migration, and query layer
- `@prisma/client` for typed database access from the backend

The primary schema definition is in:

- `backend/prisma/schema.prisma`

The schema currently contains a large multi-domain model set, including auth, product catalogs, finance, delivery, returns, marketing cards, manufacturer inventory, and access management. The schema includes 136 model definitions grouped by domain.

## 2. Core Model Families

| Domain | Representative models | Purpose |
| --- | --- | --- |
| Authentication | `AuthAccount`, `AuthSession`, `Role`, `Permission`, `OtpChallenge`, `AdminTwoFactorChallenge`, `AuthAuditLog` | identity, sessions, RBAC, MFA, audit |
| Users & profiles | `User`, `Admin`, `Manufacturer`, `Distributor`, `MarketingPartner` | customer and portal profiles; `User.isDisabled` and its audit metadata retain an administratively disabled customer identity |
| Catalog | `Product`, `Category`, `SubCategory`, `Color`, `ComboBundle`, `Review`, `SpecialOffer` | products, variants, bundles, reviews |
| Orders | `Order`, `OrderAssignment`, `DeliveryOrder`, `DeliveryEvent`, `DeliveryComment` | ordering, fulfillment, shipping lifecycle |
| Returns & exchanges | `CustomerReturn`, `CustomerReturnEvent`, `OrderExchangeRequest`, `OrderExchangeEvent`, `ReturnExchangeNcmAttempt`, `DeliveryReturn` | customer requests, approvals, inspections, carrier attempts, and audit history |
| Inventory | `InventorySku`, `InventoryLocation`, `InventoryBalance`, `InventoryLedgerEntry`, `ManufacturerInventory`, `DistributorGiftInventory`, `ManufacturerGiftInventory`, `GiftMovementLog`, `DistributorGiftMovementLog`, `StockLog`, `InboundShipment` | distributor hub product stock uses the ledger; legacy manufacturer product/gift records remain distinct |
| Marketing | `MarketingCampaign`, `MarketingCardBatch`, `MarketingCard`, `MarketingCardCustomer`, `MarketingBenefit`, `MarketingBenefitRedemption` | campaigns, cards, benefits |
| Legacy collaboration history | `CollaborationProduct`, `CollaborationTermsVersion`, `CollaborationSale`, `CollaborationFeeInvoice`, `CollaborationFeeInvoiceLine` | retained collaboration agreements, sales, invoices, and accounting history; new collaboration activity is disabled |
| Finance & accounting | `FinancialAccount`, `Account`, `JournalEntry`, `JournalLine`, `AccountPayable`, `AccountReceivable`, `TaxConfiguration`, `TaxFilingRecord` | double-entry accounting and operational finance |
| Delivery / NCM | `NcmRequestAttempt`, `NcmWebhookEvent`, `NcmSupportTicket`, `DeliveryOrder`, `DeliveryFinancialSettlement` | carrier submission, reconciliation, locally indexed NCM support tickets, and carrier-fee settlement |
| Access & notifications | `Notification`, `NotificationAttempt`, `NotificationEvent`, `NotificationOutbox`, `AccessManagementAuditLog`, `SystemAuditLog`, `SystemAuditOutbox` | paging, notifications, access governance, and cross-domain audit events |
| Platform configuration | `PlatformFeatureConfig` | singleton admin-managed feature flags for loyalty, marketing cards, and letters |

## 3. Major Schemas

### 3.1 Authentication and RBAC

The auth layer is built around `AuthAccount` and related session tables.

Product sales analytics are guarded by the seeded `product:sales_analytics_read` (admin) and `distributor:product_sales_read` (distributor) permissions. The latter is granted only to the distributor role and exposes quantity/location aggregates without revenue.

Customer disable state is stored on `User`, not by deleting or replacing the identity. The profile's `isDisabled` state prevents CUSTOMER workspace authentication, already-issued requests, and refresh-token rotation; disable also revokes active `AuthSession` rows for the linked account. Email and phone identity records remain retained so registration and social-profile activation cannot reuse a disabled identity.

| Model | Core fields | Notes |
| --- | --- | --- |
| `AuthAccount` | `id`, `email`, `phone`, `passwordHash`, `role`, `status`, `failedLoginAttempts`, `passwordResetLastRequestedAt`, `passwordResetMonthlyKey`, `passwordResetMonthlyCount`, `lastLoginAt`, etc. | Base identity; password recovery quota is stored per account |
| `AuthSession` | `accountId`, `tokenFamilyId`, `jti`, `tokenType`, `expiresAt`, `revokedAt` | Tracks login sessions and JWT lifecycle |
| `AdminTwoFactorChallenge` | `accountId`, `targetPortal`, `purpose`, `method`, `otpHash`, `status`, `attemptCount`, `expiresAt`, `consumedAt` | Also stores the SMS password-reset OTP and its one-use TFA-token lifecycle |
| `Role` | `code`, `name`, `portalScope`, `permissions` | Portal-specific role definitions |
| `Permission` | `code`, `description`, `isActive` | Fine-grained permission values |
| `AuthAuditLog` | `identifier`, `action`, `status`, `metadata` | Security/audit trail |

The password reset timestamp enforces a rolling seven-day interval, while the monthly quota key uses the UTC calendar month. Recovery requires matching account email and phone plus the active primary role/profile for the selected portal; role mappings for other workspaces do not grant cross-portal recovery. Ineligible accounts return a portal-specific not-found response, intentionally disclosing portal eligibility. Before creating a challenge or SMS, the flow enforces one OTP request per rolling seven days and at most three per month; quota violations return HTTP 429. Apply `20261016000000_add_password_reset_limits` before deploying the updated Prisma client.

### 3.2 Customer and profile models

| Model | Core fields | Notes |
| --- | --- | --- |
| `User` | `name`, `email`, `phone`, `addresses`, `cartData`, `loyaltyTier` | Customer profile and shopping state |
| `Admin` | `accountId`, `name`, `email`, `phone`, `role` | Admin account profile |
| `Manufacturer` | `name`, `city`, `qualityRating`, `pickupBranch`, `contractStatus` | manufacturing network partner |
| `Distributor` | `name`, linked account email/phone, `province`, `district`, NCM branch/covered-area and pickup details, contract dates, `status`, `qualityRating`, `ratingCount` | distributor application and operational hub profile with customer-review aggregate |
| `MarketingPartner` | `code`, `name`, `status`, `email`, `passwordHash` | partner for marketing card campaigns |

Migration `20261028064000_remove_manufacturer_commission` drops manufacturer
commission proposal/agreement columns and removes their RBAC permissions.
Previously posted accounting journals are retained for audit history.

### 3.3 Catalog and merchandising

| Model | Core fields | Notes |
| --- | --- | --- |
| `Product` | `name`, `description`, `price`, `category`, `subCategory`, `sizes`, `colors`, `variants`, `stockQuantity`, `published` | Catalog fields plus a storefront-availability projection of unreserved stock held at active distributor hubs; factory and in-transit stock are excluded |
| `Category` | `name` | root category |
| `SubCategory` | `name`, `categoryId` | nested category structure |
| `Color` | `name`, `nepaliName` | color catalog |
| `ComboBundle` | `name`, `slug`, `sellingPrice`, `discountPercentage`, `status` | curated product bundles |
| `Review` | `productId`, `userId`, `rating`, `comment`, `verified` | product reviews |
| `DistributorReview` | `orderId`, `userId`, `distributorId`, `rating`, `comment` | one verified hub review per delivered customer order; updates the distributor's aggregate rating |
| `SpecialOffer` | `title`, `startDate`, `endDate`, `discount`, `productIds` | time-bound offers |

Migration `20261028094400_disable_marketing_collaborations` marks all
collaboration listings as ended, unpublishes their products, inactivates combo
bundles containing those products, and deactivates collaboration permissions.
It preserves the related rows and posted accounting history; no new
collaboration activity is accepted by the application.

### 3.4 Orders, fulfillment, and delivery

| Model | Core fields | Notes |
| --- | --- | --- |
| `Order` | `id` (internal UUID), unique `orderReference` (15-character uppercase customer/NCM reference), `userId`, `items`, `amount`, `address`, `status`, `date` (`BigInt`), `updatedAt`, `paymentMethod`, `fulfillmentStatus`, `checkoutGroupId`, `manufacturerId`, `distributorId`, `deliveryJobId`, gift inventory references, `giftStatus`, `specialOrder*` | primary order transaction; a multi-hub checkout creates one order per hub and shares `checkoutGroupId` across the independently delivered orders; `orderReference` is persisted, unique, and used as NCM's vendor reference; `updatedAt` is maintained by Prisma and indexed for recently-updated-first lists; admin exchange-list API returns `date` as a decimal string for JSON safety; product analytics reads item-level quantity and price snapshots and delivery province/district from this order |
| `OrderAssignment` | `orderId`, nullable `manufacturerId`/`distributorId`, `status`, `acceptedAt`, `readyAt`, `pickedUpAt` | customer-order fulfillment assignment; each order in a multi-hub checkout has its own assignment and only the hub's allocated items; admin self-delivery monitoring explicitly filters `deliveryType=SELF_DELIVERY` and excludes orders with a `DeliveryOrder` |
| `ShippingConfig` | `sameDistrictFee`, same/different-province door-to-door and door-to-hub fees, `routeOverrides`, separate door-to-door and door-to-hub split-shipment fees, `freeShippingMin`, NCM/distributor return and exchange settlement rates | shared customer delivery tariffs plus optional route exceptions and company-paid return/exchange logistics rates; same-zone deliveries use door-to-door only, while route and split-shipment choices use their configured tariff; approved return/exchange requests snapshot the settlement rate and create an accounts payable after logistics completion |
| `DeliveryOrder` | `orderId`, optional `manufacturerId`/`distributorId`, `state`, `deliveryType`, `ncmOrderId`, `ncmStatus`, `ncmReconciliationRequired`, `ncmReconciliationReason`, `vendorReference`, `codAmount` | customer-order carrier package record owned by the assigned fulfillment hub; split checkout children have separately tracked delivery records; indexes support the NCM admin monitor and pending reconciliation queue |
| `DeliveryEvent` | `deliveryOrderId`, `eventType`, `fromState`, `toState`, `payloadJson` | state transition tracking |
| `DeliveryComment` | `ncmOrderId`, `comments`, `payloadJson`, `eventKey` | NCM delivery comments |
| `NcmRequestAttempt` | `deliveryOrderId`, `operation`, `requestUrl`, `result`, `httpStatus` | idempotent request tracking |
| `NcmWebhookEvent` | `eventKey`, `event`, `orderId`, `status`, `payloadJson` | webhook ingestion |
| `NcmSupportTicket` | `ncmTicketId`, `ticketType`, `message`, `status`, `addedOn`, `closedOn`, `lastActivityAt` | compact local ticket index; create/detail/reply/close operations update it, so active/closed lists are served from MySQL without a carrier call; latest comment/reply summaries are retained for activity tracking |

For distributor-assigned customer orders, admins can enter package details and
request NCM booking from Order Assignments. The persisted `Order.orderReference`
is displayed to customers and sent to NCM as `vref_id`; it is capped at 15
uppercase alphanumeric characters to fit the carrier reference field. Confirmed booking data and webhook
status changes are persisted on the delivery and related order records.
Customer-order status reads use this database state rather than polling NCM's
status/detail APIs. The webhook is acknowledged after event and status
persistence. `DeliveryOrder.customerDeliveryCharge` remains the customer-facing
checkout charge; `ncmDeliveryChargeBeforeDiscount`, `ncmDeliveryDiscount`, and
`ncmDeliveryCharge` separately snapshot the NCM gross fee, discount, and net
carrier fee. `DeliveryFinancialSettlement.deliveryFeeActual` stores the net
carrier fee used for remittance accounting, while `deliveryFeeDiscount` retains
the discount as an auditable amount. Admin can record or correct this pricing
from NCM order details before remittance is settled. The carrier discount does
not rewrite customer COD or checkout pricing.
The additive migration `20261030170000_ncm_delivery_discounts` must be applied
and Prisma Client regenerated before deploying the discount fields or Admin
pricing action.

Admin monitoring lists are paginated and return compact row fields; detail
routes load bounded event, return, exchange, rating, and settlement sections
only after a record is opened. NCM date filters use `DeliveryOrder.createdAt`;
the pending NCM reconciliation filter is not date-limited, so unresolved records
remain visible regardless of age. Unknown or conflicting carrier updates retain
the last trusted `state` and store the reason and Admin decision history on the
delivery record and its `DeliveryEvent` timeline.
self-delivery date filters use the customer order's epoch-millisecond `Order.date`.
Both interpret today/week/month/year/custom boundaries in `Asia/Kathmandu`.
The `OrderAssignment(deliveryType, distributorId, status, assignedAt)` index
supports the explicit self-delivery filter. NCM has no documented full order
listing or separate payable/receivable ledger endpoint, so reconciliation is
limited to known local NCM order IDs.

### 3.5 Returns and exchange management

| Model | Core fields | Notes |
| --- | --- | --- |
| `CustomerReturn` | `orderId`, `requestKey`, `requestHash`, `items`, `reason`, `lifecycleStatus`, `deliveryRoute`, admin/NCM fields, `ncmDeliveryCharge`, `ncmChargeSource`, `logisticsSettlementAmount`, refund and inspection fields including `inspectionEvidenceUrl`, `refundPolicySnapshot`, `approvedRefundAmount`, `accountingJournalEntryId`, `taxCreditNoteNumber` | approved RMA lifecycle; snapshots return-charge policy and exact refund at approval; distributor receipt requires a JPG/PNG goods photo; legacy rows default to `LEGACY_PROCESSED`; completed return analytics use the product/quantity/refund snapshots and `returnDate`, with compound refund/date indexes |
| `CustomerReturnEvent` | `customerReturnId`, event/status transition, actor, reason, metadata, idempotency key | return audit trail |
| `DeliveryOtpChallenge` | order/distributor binding, hashed OTP, amount, attempt/expiry/status fields, active-order and notification keys | limits repeated delivery attempts and prevents unpaid COD handoff until the customer OTP is verified |
| `DistributorRemittanceBatch` | distributor, amount, evidence/reference, status, idempotency key, optional company treasury account and review data | distributor-submitted COD remittances remain pending until Admin verifies and posts them |
| `DistributorCashEvent` | distributor, optional order/return/exchange/remittance/accounting document, amount, event/status, payment evidence, journal/cash references, idempotency key | immutable-style operational cash trail for COD collection, company remittance, distributor-funded refund, and company reimbursement; NCM exchange price-difference proof is linked to its exchange and reviewed by Admin |
| `DistributorSettlementOffset` | distributor, amount, journal entry, unique idempotency key, Admin approver/time, notes | records explicit Admin-approved offsets between open distributor COD receivables and verified distributor refund payables |
| `OrderExchangeRequest` | `orderId`, `customerId`, `manufacturerId`, `settlementDistributorId`, returned `items`, `replacementItems`, `exchangeType`, warranty fields, original/replacement value and cost snapshots, `priceDifference`, settlement/COD fields, `exchangeJournalEntryId`, `scrapJournalEntryId`, `taxCreditNoteNumber`, NCM leg IDs/charges, `logisticsSettlementAmount`, stock reservation timestamps | exchange lifecycle and replacement-stock control; returned-item cost uses the original order snapshot, replacement cost is captured from the active catalog at request time, configured logistics settlement is snapshotted at approval, and NCM exchange price differences are settled with the original assigned distributor |
| `OrderExchangeEvent` | `exchangeRequestId`, `eventType`, `fromStatus`, `toStatus`, `metadata` | audit trail for exchange state transitions |
| `ReturnExchangeNcmAttempt` | optional return/exchange ID, operation, request/response JSON, HTTP status, result, error, idempotency key | durable NCM request history |
| `DeliveryReturn` | `deliveryOrderId`, `orderId`, optional `manufacturerId`/`distributorId`, `state`, `returnReason`, `inspectionResult` | return-inspection record owned by the assigned fulfillment hub |

### 3.6.1 System audit and transactional outbox

| Model | Core fields | Notes |
| --- | --- | --- |
| `SystemAuditLog` | actor/role, action, entity type/ID, JSON before/after diff, portal/IP/user-agent, status, failure reason, correlation ID, timestamp | Admin-facing cross-domain audit history; indexed by entity, actor, creation time, and correlation ID. Sensitive fields in state diffs are redacted before storage. Includes selected authentication/MFA, rate-limit, refresh-reuse, and RBAC-denial security signals; these are not confirmed breach records. |
| `SystemAuditOutbox` | JSON event, status, attempts, availability/claim/process timestamps, last error | Durable enqueue record created in the same transaction as a business mutation. A retrying worker writes the log row and marks the outbox row processed atomically; `SystemAuditLog.outboxId` is unique for idempotency. |

### 3.6 Inventory and manufacturer operations

| Model | Core fields | Notes |
| --- | --- | --- |
| `ManufacturerInventory` | `manufacturerId`, `productId`, `quantity`, `reservedQty`, `variantsStock`, `agreedCostPrice` | warehouse stock by manufacturer |
| `ManufacturerProductionRequest` | Admin-assigned manufacturer, product/SKU quantities, fabric/GSM, target date and batch plan; manufacturer proposed/approved unit COGS and batch other cost, VAT treatment/rate and invoice verification; pre/post-production QA | Workflow moves from `PENDING_MANUFACTURER_QUOTE` to `PENDING_ADMIN_APPROVAL`, then `APPROVED` before manufacturer pre-check/start. Admin approval records whether the supplier VAT invoice was verified; `EXEMPT`, `VAT_INCLUSIVE`, or `VAT_EXCLUSIVE` are supported. |
| `ManufacturerInventoryCostLayer` | produced/available/reserved/consumed quantities, capitalized unit COGS, unit VAT, VAT treatment/rate, invoice-verification state | Verified input VAT is posted at production receipt; unverified VAT remains in capitalized inventory cost |
| `ManufacturerInventoryMovement` | `manufacturerId`, `productId`, `variantLabel`, `previousQty`, `newQty`, signed `changeQty`, `movementType`, `reason`, `note`, `actorId`, `createdAt` | immutable, per-variant manufacturer stock adjustment history |
| `StockLog` | `productId`, `quantityChange`, `reason`, `createdAt` | stock movement audit |
| `InboundShipment` | `manufacturerId`, `shipmentNumber`, `quantity`, `notes` | inbound logistics model |

Apply `backend/prisma/migrations/20261017120000_manufacturer_production_vat/migration.sql` before deploying the production VAT changes. Existing production records migrate as exempt, and existing cost layers receive zero VAT by default. The `20261028092400_admin_manufacturer_production_quotes` migration changes the default request state to manufacturer quote, matching the admin-issued quote/approval workflow; existing request states are preserved.
Apply `backend/prisma/migrations/20261017130000_reconcile_manufacturer_freight_settlements/migration.sql` to persist the portion of each local shipment's freight charge settled through approved manufacturer logistics payments.

Factory receipts from production remain in manufacturer-owned factory locations and are not available to customer checkout. Stock becomes storefront-eligible only when a distributor confirms receipt into an active distributor location. Product-level and variant-level stock fields mirror the sum of unreserved active distributor ledger balances; `InventoryBalance` and its ledger entries remain authoritative.

Bulk distributor replenishment uses a separate `StockTransfer` lifecycle:

| Model | Core fields | Notes |
| --- | --- | --- |
| `StockTransfer` | manufacturer/distributor profile IDs, source/destination locations, status, request/review actor and timestamps, five manufacturer preparation-check booleans, preparation actor/time | Distributor demand is admin-approved before becoming actionable in the manufacturer portal. |
| `StockTransferLine` | transfer/SKU IDs, requested/approved/dispatched/reserved quantities | Admin approval is bounded by the request and current available factory balance. |
| `StockTransferShipment` | booking mode, carrier/tracking, dedicated `ncmOrderId`, NCM package type/product/weight/dimensions/instructions/fragility/packaging notes, freight charge/paid amount/settlement status, NCM status/history/payment/sync/event and return-request fields, status/timestamps | Supports NCM, local freight, and direct `SELF_STORE` delivery. NCM package details are persisted for the audit trail; type and dimensions are serialized into NCM's documented `package` string rather than sent as unsupported request fields. Own-store shipments carry zero freight and are immediately received into the distributor ledger location. NCM booking is `BOOKED`; factory stock remains reserved until a pickup/custody webhook or admin reconciliation moves it to transit. Carrier delivery remains separate from receipt/inventory state. NCM freight is held for platform/admin settlement, not manufacturer/distributor payables. Paid LOGISTICS settlements are allocated FIFO to dispatched local shipments; shipment-level paid and outstanding amounts appear in finance details. |
| `StockTransferShipmentEvent` | shipment ID, unique provider-event key, source, event type/status, sanitized payload, provider occurrence and receive timestamps | Durable, idempotent NCM booking/status timeline; event insertion and first custody inventory movement commit in the same transaction. |
| `StockTransferReceipt` / `StockTransferReceiptLine` | shipment, receiver/time, good/damaged/missing quantities | Self-store delivery records an idempotent all-good receipt in the same transaction as its ledger movements. |

Every shipment requires saved passing manufacturer checks for product availability,
quality, requested color, requested size, and packaging. Self-store eligibility
requires the manufacturer and distributor profiles to share the same account.
NCM shipment returns record the manufacturer's request state/reason and carrier
status; a return request does not itself receive, inspect, or restock goods.

### 3.7 Location-aware pricing and local manufacturer assignment

The schema includes explicit coverage and pricing metadata for Nepal-specific local ordering rules:

| Model | Core fields | Notes |
| --- | --- | --- |
| `LocationMapping` | `code`, `name`, `type`, `province` | canonical Nepal province/district code map used for normalization and matching |
| `NcmBranch` | `name`, `provinceName`, `districtName`, `coveredAreas`, `isActive` | active branch and covered-area choices exposed by the shared location lookup API |
| `ManufacturerLocation` | `manufacturerId`, `province`, `district`, `isActive` | local dispatch coverage by manufacturer, keyed to deliverable province/district pairs |
| `LocationProductDiscount` | `productId`, `distributorId`, `province`, `district`, `discountPercentage`, `isActive` | per-product discount rule keyed to the customer district and expected fulfilling distributor; `distributorId` may be null for legacy all-distributor rules |

The `Order` row also captures the resolved local-pricing decision in:

- `locationDiscountDistributorId`
- `locationDiscountProvince`
- `locationDiscountDistrict`
- `locationPricingSnapshot`

These fields lock each order shipment to the backend-resolved local discount and distributor. Pricing uses the distributor selected by checkout from active distributor-ledger stock; it does not depend on `ManufacturerLocation` or `ManufacturerInventory`. The legacy `locationDiscountManufacturerId` field remains for historical records only.

### 3.8 Marketing cards and campaigns

| Model | Core fields | Notes |
| --- | --- | --- |
| `MarketingCampaign` | `marketingPartnerId`, `isOwnStore`, `maxScansPerCustomer`, `targetScopeType`, `benefitConfig`, `requestedQuantity`, `status` | partner or in-house campaign definition; non-distributor Own Store per-customer scan cap defaults to one |
| `MarketingCardBatch` | `campaignId`, `batchCode`, `quantity`, `status` | card batch control |
| `MarketingCard` | `cardCode`, `qrTokenHash`, `partnerId`, `assignedPartnerId`, `assignedOrganization`, `isPublic`, `campaignId`, `batchId`, `exchangeLockRequestId`, `physicalStatus` | individual card instance and optional public/Own Store destination |
| `MarketingCardOrder` | `cardId`, `orderId`, nullable `manufacturerId`, nullable `distributorId` | card-to-order association |
| `MarketingCardAssignment` | `cardId`, nullable `manufacturerId`, nullable `distributorId`, status/receipt fields | stock assignment to a hub; new assignments target distributors |
| `MarketingCardCustomer` | `cardId`, `customerId`, `status`, `scannedAt`, `scannedProvince`, `scannedDistrict`, `assignedOrganization`, `scanWeekIndex`, `activatedAt`, `otpExpiresAt` | customer card ownership, indexed scan-limit data, and non-street-level province/district snapshot for aggregate scan reports |
| `MarketingBenefit` | `campaignId`, `benefitType`, `value`, `maxDiscountAmount`, `percentage`, `quantity` | campaign benefit definitions; Own Store percentage discounts may set an optional maximum rupee discount |
| `MarketingBenefitRedemption` | `cardId`, `benefitId`, `customerId`, `status`, `claimedAt`, `redeemedAt` | claim and redemption lifecycle |

Own Store campaigns may have no marketing partner. Their cards can be tracked as public-to-everyone, assigned to an existing partner, or assigned to a custom organization name. Physical campaign card stock is assigned to active distributors and received/attached through distributor-scoped APIs; old manufacturer assignment references remain available for historical records. Public, partner, and custom-organization Own Store cards can be scanned by any logged-in customer without an attached/delivered order; card-code entry and QR scan attempts are recorded in `MarketingCardEvent`. The first successful QR scan consumes each physical card. The campaign's configurable `maxScansPerCustomer` cap (default one per account for the campaign lifetime) applies to these assignment types, in addition to the five-per-campaign weekly cap; organization-assigned cards also retain a two-per-campaign, per-organization lifetime cap. Distributor-assigned Own Store cards are attached to a specific order and can be scanned/claimed only by that delivered order's customer. This order-linked path bypasses all scan caps, allowing distinct distributor cards on multiple delivered orders to each grant a claim, while each physical card remains single-use. Customer scans snapshot the assigned organization and a Nepal-time Monday-based calendar-week index when quotas apply. Claimed Own Store discounts, vouchers, and gifts are stored as `CLAIMED` rewards; checkout atomically redeems selected discount/voucher rewards, while gifts create customer entitlements.

Admin partner analytics are scoped to one partner and return campaign card/scan/reward counts, distributor card totals, and separate province/district scan and distributor-assignment aggregates. Scan location fields are copied from the customer's first saved address when the scan is recorded; historical scans without snapshots are reported as `Unknown`. The report does not expose customer identities or street-level addresses.

### 3.8 Finance, accounting, and tax

The schema includes a full accounting engine with:

- `Account`
- `FinancialAccount`
- `AccountPayable`
- `DistributorSettlementRequest`
- `AccountReceivable`
- `JournalEntry`
- `JournalLine`
- `AccountingParty`
- `AccountingDocument`
- `AccountingAllocation`
- `DistributorServiceEarning`
- `AccountingPeriod`
- `FiscalYear`
- `TaxConfiguration`
- `VatRateVersion`
- `TaxFilingRecord`
- `OperatingExpense`
- `DirectIncome`
- `FinancialCategory`
- `SettlementReversion`

This layer indicates the platform is designed beyond simple ecommerce transactions and includes operational finance, AP/AR, and reporting.

`ManufacturerProductionRequest.approvedUnitCogs` is the approved base unit COGS. New requests use `costTermsVersion = 2`: `approvedDeliveryCost` stores batch-total production other cost, allocated over actual good units and included in `ManufacturerInventoryCostLayer.unitCogs` (14 decimal places so the batch total is not prematurely rounded); new layers have zero separate delivery overhead. Existing version-1 requests keep their legacy per-unit `approvedDeliveryCost` interpretation, stored as `unitDeliveryCost`. The admin financial dashboard prefers order cost snapshots, then weights completed production-layer rates by produced quantity for distributor-fulfilled sales; approved manufacturer inventory pricing and legacy `Product.costPrice` are fallbacks when no production layer exists.

For posted accounting, accepted production layers are traced to distributor stock through `StockTransferShipmentLineCostLayer` and good-receipt `InventoryLedgerEntry.productionCostLayerId` values. Admin acceptance of production posts accepted good-unit value to inventory (1140), verified recoverable VAT to input VAT (1150), and the corresponding manufacturer payable (2160) in the same transaction, with an idempotent payable bill keyed to the production request. The cost layer records that payable-recognition point; downstream delivery records COGS (5100) and inventory relief (1140) without accruing the manufacturer payable again. Distributor order fulfillment records the consumed layer ID on its `FULFILLMENT` ledger movement and persists its accepted cost allocation in `Order.items`. Existing received stock without ledger layer provenance is not assigned a guessed layer cost, and its historical payable recognition is not inferred. Manufacturer-paid local transfer freight is recognized as delivery expense (6430) and manufacturer payable (2160) on dispatch, when the carrier service is performed; the same transaction creates an idempotent `MANUFACTURER_LOGISTICS` payable bill keyed to the shipment. Manufacturer logistics payouts allocate against those bills and retain the existing shipment-level paid/outstanding status. Accounting Health separately compares posted 2160 `MANUFACTURER_PRODUCTION` journals to request-linked production bills and `MANUFACTURER_LOGISTICS` journals to shipment-linked freight bills. These checks are source-scoped; legacy delivery-accrued costs, other manufacturer payable sources, and historical balances remain unresolved.

`AccountingEvent` also serves as the durable delivered-sale outbox for NCM and distributor self-delivery. The delivery transaction stores a versioned source snapshot and payload hash; `nextAttemptAt` and `claimedAt` support scheduled retries and stale-claim recovery. The worker links the journal to the source event and commits journal creation plus the `POSTED` event state atomically. The additive migration `20261017000000_delivery_accounting_outbox_schedule` must be applied and Prisma Client regenerated before deploying this worker; it has not yet been applied.

Completed self-delivery creates an immutable `DistributorServiceEarning` with delivery charge, zero new per-delivery incentive, commission/tax snapshots, and linked journal/payable `AccountingDocument` references. Historical incentive values in old earning snapshots are preserved. Admin-configured `DistributorBonusPlan` records define additive monthly completed-self-delivery tiers; eligible closed periods create idempotent `DistributorBonusEarning` records with delivery-count/tier snapshots and linked journal/payable documents. Distributor settlement requests snapshot gross earnings, legacy incentives, target bonuses, deductions, VAT, and itemized delivery/bonus lines; their `bonuses` column keeps the target-bonus total separate. Admin payouts allocate against earning documents and clear control 2190. Old `DistributorSettlementRequest` and `AccountPayable` data remain a legacy reconciliation path; do not generate duplicate expense accruals for deliveries already represented by an earning snapshot.

NCM-delivered COD records receivable `AccountingDocument` rows by source order against control 1170. A confirmed NCM batch accrues the carrier fee to 6430/2180, creates its payable document, then allocates gross COD and fee payable against the remittance journal in one transaction. Accounting Health checks the fee chain across the posted `NCM_CARRIER_FEE_ACCRUAL` 2180 credit, the matching `NCM_CARRIER_FEE` bill, its `AccountingAllocation` amount/journal link, and the linked `PAYMENT` journal's 2180 debit. Distributor-collected COD uses party documents against 1190; distributor-paid refunds and delivery compensation use payable documents against 2190. `AccountingHealth` compares these source-specific open balances to their respective GL controls and checks every stored `Account.currentBalance` against the debit/credit totals of posted and reversed `JournalLine` records. Reversed original journals remain included because their separately posted reversal entry offsets them. An opening balance without a journal is surfaced as a variance; the check does not imply operational subledger coverage. Its control-coverage registry enumerates the 23 configured balance-sheet control accounts and labels each as source-scoped, legacy-partial, treasury-register-only, unreconciled, or missing; source-scoped is not equivalent to fully reconciled. By policy, legacy/opening balances remain flagged and are not automatically converted until Finance reviews and approves a documented cutover. The endpoint intentionally reports partial coverage while historical and other-party documents remain unreconciled.

`VatRateVersion` stores append-only VAT percentages and UTC effective intervals. The Admin Tax Compliance page can schedule only future rates and cancel only the latest scheduled version. Delivered sales and full-delivery returns resolve the rate from the source order timestamp. Approved customer return snapshots retain the applicable rate and VAT refund; subsequent versions do not change approved amounts.

Migrations `20261027150000_distributor_service_earnings` and `20261027160000_effective_vat_rate_versions` are additive and must be applied, then Prisma Client regenerated, before deploying these changes. Do not treat schema validation alone as migration rollout or as reconciliation of legacy financial rows.

### 3.9 Gift promotions and distributor gift stock

| Model | Core fields | Notes |
| --- | --- | --- |
| `GiftCatalog` | `name`, `sku`, `priceValue`, `category`, `isActive` | Reusable physical gift assortment; catalog removal is a soft archive |
| `LoyaltyTierConfig` | `tierName`, `triggerType`, `minSpendThreshold`, `giftTargetValue`, `isActive` | Configurable `ORDER_VALUE` trigger and exact gift value; loyalty gifts are configured on `CustomerLevel` |
| `DistributorGiftInventory` | `distributorId`, `giftId`, `quantitySent`, `receivedQuantity`, `quantityAvailable`, `quantityReserved`, `status` | Hub distribution batches record Admin dispatch and distributor-acknowledged receipt counts; only accepted batches are eligible |
| `DistributorGiftMovementLog` | `distributorId`, `giftId`, `orderId`, `movementType`, `quantity` | Audit records for distributor gift allocation, reservation, deduction, restock, and loss |
| `GiftRewardEntitlement` | `customerId`, `sourceType`, unique `sourceKey`, exact `rewardValue`, `status`, checkout/order/gift/inventory references | Carries card, loyalty, or order-value rewards from claim through assignment and fulfillment; one order can be linked per entitlement |
| `ManufacturerGiftInventory`, `GiftMovementLog` | legacy manufacturer-owned gift records | Retained for historical data; not used for new distributor hub activity |

An order stores its gift catalog reference and the exact inventory batch reserved for it, using `assignedDistributorGiftInventoryId` for distributor hub orders while retaining the legacy manufacturer reference for historical orders. Loyalty gift allowances are represented by `CustomerLevel.giftAmount` and `giftDescription`; eligible rewards are snapshotted into `Order.rewardApplied`. Card gifts become pending entitlements when claimed and are reserved by the customer's next checkout. At the distributor `letter_ready` transition, the backend selects one exact-value gift for the checkout group from already-assigned distributors' accepted stock, prioritizing the customer's district, province, then other eligible hubs; it randomizes equivalent choices and reserves the selected batch atomically. `giftStatus` progresses through `NONE`, `PENDING_PACKING`, `RESERVED`, and `DELIVERED`, or to `RETURNED` / `LOST` when a protected return decision is recorded. Admin replacement is restricted to the same value and distributor before packing. Delivered stock is deducted through the delivery transition.

Migration `20261028193000_gift_reward_lifecycle` adds the entitlement table and distributor dispatch/receipt counts. It is additive but has not been applied to the configured database; validate and deploy it using the isolated migration and backup process, then regenerate Prisma Client before enabling the flow.

Distributor direct hub orders use `Order.orderType = DIRECT_DISTRIBUTOR` and `Order.distributorId`. Their product quantities are deducted transactionally from unreserved distributor stock, with FIFO production cost-layer allocations snapshotted on each order item for COGS, inventory, and VAT accounting. Legacy stock without cost-layer provenance uses the admin-controlled product cost as a COGS fallback against inventory; confirmed returns reverse the same inventory cost and payment account. Legacy version-1 per-unit delivery/other cost is recognized separately as delivery expense and manufacturer payable; version-2 batch other cost is already included in unit COGS. Paid cash/COD sales debit cash on hand; unpaid phone orders record customer receivables that are cleared when payment is confirmed. These orders do not use `ManufacturerInventory` or manufacturer assignment records. Product prices come from the admin-controlled catalog, and manual distributor discounts are rejected; only eligible customer loyalty rewards may apply automatically.

## 4. Data Dictionary: Key Enumerations and Status Values

### Auth / user states

- `AuthAccount.role`: `CUSTOMER`, `ADMIN`, `MANUFACTURER`, `MARKETING_PARTNER`
- `AuthAccount.status`: `ACTIVE`, `PENDING_APPROVAL`, `SUSPENDED`, `REJECTED`, `INACTIVE`
- `AuthSession.tokenType`: `ACCESS`, `REFRESH`

### Product / order fields

- `Order.status`: order state from the app, e.g. `Order Placed`, with fulfillment tracking in `fulfillmentStatus`
- `Order.fulfillmentStatus`: `PENDING_ASSIGNMENT`, `ASSIGNED`, `ACCEPTED`, `MANUFACTURING`, `QUALITY_CHECK`, `PACKED`, `READY_FOR_PICKUP`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, `FAILED`
- `Order.orderType`: `ONLINE_STORE`, legacy `DIRECT_MANUFACTURER`, `DIRECT_DISTRIBUTOR`

### Manufacturer / delivery state

- `ManufacturerInventory.priceStatus`: `PENDING`, `APPROVED`, `REJECTED`
- `OrderAssignment.status`: `PENDING_ACCEPTANCE`, `ACCEPTED`, `MANUFACTURING`, `QUALITY_CHECK`, `PACKED`, `READY_FOR_PICKUP`, `PICKED_UP`, `REJECTED`
- `DeliveryOrder.state`: `READY_TO_DELIVER` and related lifecycle states

### Returns / exchange state

- `CustomerReturn.lifecycleStatus`: starts at `PENDING_ADMIN_REVIEW`; NCM handoff, return transit, warehouse receipt, inspection, and refund are separate states.
- Distributor self-delivery COD is a distributor receivable (GL control 1190) until an evidenced remittance is Admin-verified, journaled to company treasury, and allocated to open distributor receivable documents. The Admin-verified customer refund paid by a distributor is separately recorded as distributor payable (control 2190), with a distinct company payout and payable allocation. Gross balances remain intact until an Admin explicitly approves a netting transaction; the balanced journal debits 2190 and credits 1190, with allocations against both open subledgers in one serializable transaction. Pending remittances reserve COD receivables and are excluded from the available offset.
- New manufacturer production payable documents are created at accepted production receipt and payout allocations track production and delivery bill balances. Legacy delivery-recognized costs continue to create payable documents on delivery. A supplier credit note is created on return only when the corresponding delivery bill exists; historical manufacturer payable journals remain a legacy reconciliation balance. Distributor settlement requests without matched earning documents do not create an AP from the request amount and are marked reconciliation-required. Payout eligibility requires an active NPR Treasury account mapped to the type-specific GL cash/bank/wallet account.
- Admin approval snapshots the configured return charge percentage against returned product value; the original delivery fee is excluded from the refund. A distributor return must be received/inspected, the distributor must submit payment evidence for exactly the approved refund, and Admin must verify it before the payable is posted. Rejected evidence reopens the refund task without posting accounting.
- Accounting Health source-matches the original AP amount for platform-funded customer returns (`AccountPayable.referenceType = CUSTOMER_REFUND`) to the 2110 credit on the matching `SALES_RETURN` journal. Platform-funded exchange downgrade refunds (`CUSTOMER_EXCHANGE_REFUND`) match to the 2110 credit on the `ORDER_EXCHANGE` journal keyed by `EXCHANGE-<requestId>`. Paid/outstanding AP amounts are displayed, but payment clearing, distributor-funded refund payables, and legacy AP remain outside this source-scoped check.
- Collaboration fee invoices are source-checked across `CollaborationFeeInvoice.totalAmount`, the `COLLABORATION_FEE` receivable document, posted 1130 `COLLABORATION_FEE_INVOICE` debits, recorded `AccountingAllocation` rows, and linked posted 1130 journal entries. This uses only existing allocation and journal evidence; it does not establish a collaboration collection workflow, cover unlinked or legacy collections, reconcile credits/reversals, or establish the full 1130 control.
- Return/exchange journals use the current period at inspection or replacement completion rather than backdating to the original sale. The case stores its journal reference and generated credit-note number. Exchange price/VAT adjustments use the original order VAT rate for the returned item and the current rate for the replacement; replacement cost and original return cost are separately snapshotted.
- Exchange upgrades remain distributor COD receivables until collected/remitted; downgrades are distributor-funded customer refunds in the payable subledger, including NCM-delivered exchanges. For NCM exchanges, `settlementDistributorId` points to the original assigned distributor. `DistributorCashEvent` records the distributor-submitted exact-amount payment evidence and Admin review status; verification does not itself settle the receivable/payable. NCM exchange-create remains `pk`-only and carries no price difference.
- `OrderExchangeRequest.status`: begins at `REQUESTED`; NCM attempts and outcomes are separately audited. Replacement stock is reserved at approval and consumed on confirmed replacement delivery.
- NCM HTTP 4xx response bodies are retained in the attempt record; an attempted request must not be treated as a successful booking.
- NCM return marking uses the original order ID (`vendor_return` flag); exchange leg IDs are NCM's `ven_order` (return) and `cust_order` (replacement).
- `MarketingCard.physicalStatus`: `GENERATED`, `ASSIGNED`, `RECEIVED`, `AVAILABLE`, `RESERVED`, `ATTACHED`, `CANCELLED`
- `MarketingCardCustomer.status`: `LINKED`, `ACTIVE`, `CANCELLED`

## 5. Relationship Notes

- `AuthAccount` sits at the top of both access control and portal identity.
- `User` is the customer profile record; `Manufacturer` and `MarketingPartner` are separate business profiles linked to the same auth system.
- An `Order` can be associated with `DeliveryOrder`, `LetterDelivery`, and `MarketingCardOrder` records.
- `ManufacturerInventory` is keyed by `(manufacturerId, productId)` and tracks both physical stock and reserved stock.
- Manufacturer portal stock adjustments write one `ManufacturerInventoryMovement` per changed variant in the same transaction as the inventory update. The movement captures prior/current quantities, signed delta, stock-in/out direction, reason, optional note, and actor; the manufacturer history endpoint is scoped to the authenticated manufacturer.
- `LocationMapping` supplies canonical Nepal geography; `LocationProductDiscount` is scoped to the customer district and expected fulfilling distributor. `ManufacturerLocation` is managed independently and does not determine customer pricing. `DistributorLocation` stores service districts used by prioritized customer-order allocation. `DistributorReview` is linked to one delivered `Order` and contributes to its distributor's `qualityRating` and `ratingCount`.
- `MarketingCampaign` → `MarketingCardBatch` → `MarketingCard` forms the card issuance chain.
- `OrderExchangeRequest` is the main exchange transaction record and is accompanied by an audit event log (`OrderExchangeEvent`).
- System-level audit events complement existing domain ledgers and access-management logs; do not replace those records or write directly to the audit log from business request paths. Use the shared audit service so event enqueueing participates in the business transaction.

## 6. Operational Database Guidance

- The schema is the canonical business model; future AI work should treat it as the source of truth before writing new endpoints or UI logic.
- New features should preserve existing relationships and status semantics rather than inventing alternate tables for domain concepts already covered here.
- Location-aware pricing and assignment rules are enforced server-side using the geography map, covered districts, and per-product discounts; they should not be reimplemented in the frontend as a trust boundary.
- The repo uses a `db push` / `prisma db seed` workflow in local development, but production deployment guidance in the notifications docs warns against using `db push` in production and prefers staged migration review.
- Apply `20261001193000_return_exchange_lifecycle_overhaul`, run the RBAC seed to register new return/exchange permissions, and regenerate Prisma Client before restarting the API. The migration is additive, preserves existing processed return data, and maps its composite attempt indexes to MySQL-safe names under the 64-character identifier limit.
- Apply `20261005000000_add_system_audit_outbox`, run the RBAC seed to grant `access:audit_read` to the system Admin role, and regenerate Prisma Client before enabling the audit-history API or worker. This migration adds the two audit tables and their query/claim indexes without changing existing business tables. Preserve audit records under a documented retention policy and monitor outbox rows in `FAILED`.
- Apply `20261017000000_delivery_accounting_outbox_schedule` and regenerate Prisma Client before deploying the delivered-sale accounting worker. Verify migration state in an approved isolated environment; do not use production or an unverified database for validation.
- Apply `20261027120000_return_and_cash_evidence_images` and regenerate Prisma Client before requiring return-goods inspection photos. Distributor remittance and refund evidence are uploaded as JPG/PNG images and stored through Cloudinary.
- Apply `20261027130000_distributor_refund_receivable_netting` and regenerate Prisma Client before enabling Admin-approved settlement offsets. This additive migration stores each offset and its journal link; verify idempotency-key uniqueness before deployment.
- Apply `20261015193000_admin_delivery_monitoring_indexes` to add the monitor query indexes before deploying the new paginated delivery views.
