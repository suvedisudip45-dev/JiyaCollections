# Database and Schemas

## 1. Database Engine and ORM

The project uses:

- MySQL as the primary transactional database
- Prisma ORM as the schema, migration, and query layer
- `@prisma/client` for typed database access from the backend

The primary schema definition is in:

- `backend/prisma/schema.prisma`

The schema currently contains a large multi-domain model set, including auth, product catalogs, finance, delivery, returns, marketing cards, manufacturer inventory, and access management. The schema includes 98 model definitions grouped by domain.

## 2. Core Model Families

| Domain | Representative models | Purpose |
| --- | --- | --- |
| Authentication | `AuthAccount`, `AuthSession`, `Role`, `Permission`, `OtpChallenge`, `AdminTwoFactorChallenge`, `AuthAuditLog` | identity, sessions, RBAC, MFA, audit |
| Users & profiles | `User`, `Admin`, `Manufacturer`, `Distributor`, `MarketingPartner` | customer and portal profiles |
| Catalog | `Product`, `Category`, `SubCategory`, `Color`, `ComboBundle`, `Review`, `SpecialOffer` | products, variants, bundles, reviews |
| Orders | `Order`, `OrderAssignment`, `DeliveryOrder`, `DeliveryEvent`, `DeliveryComment` | ordering, fulfillment, shipping lifecycle |
| Returns & exchanges | `CustomerReturn`, `CustomerReturnEvent`, `OrderExchangeRequest`, `OrderExchangeEvent`, `ReturnExchangeNcmAttempt`, `DeliveryReturn` | customer requests, approvals, inspections, carrier attempts, and audit history |
| Inventory | `InventorySku`, `InventoryLocation`, `InventoryBalance`, `InventoryLedgerEntry`, `ManufacturerInventory`, `DistributorGiftInventory`, `ManufacturerGiftInventory`, `GiftMovementLog`, `DistributorGiftMovementLog`, `StockLog`, `InboundShipment` | distributor hub product stock uses the ledger; legacy manufacturer product/gift records remain distinct |
| Marketing | `MarketingCampaign`, `MarketingCardBatch`, `MarketingCard`, `MarketingCardCustomer`, `MarketingBenefit`, `MarketingBenefitRedemption` | campaigns, cards, benefits |
| Finance & accounting | `FinancialAccount`, `Account`, `JournalEntry`, `JournalLine`, `AccountPayable`, `AccountReceivable`, `TaxConfiguration`, `TaxFilingRecord` | double-entry accounting and operational finance |
| Delivery / NCM | `NcmRequestAttempt`, `NcmWebhookEvent`, `DeliveryFinancialSettlement` | carrier submission, reconciliation, webhook handling |
| Access & notifications | `Notification`, `NotificationAttempt`, `NotificationEvent`, `NotificationOutbox`, `AccessManagementAuditLog`, `SystemAuditLog`, `SystemAuditOutbox` | paging, notifications, access governance, and cross-domain audit events |

## 3. Major Schemas

### 3.1 Authentication and RBAC

The auth layer is built around `AuthAccount` and related session tables.

| Model | Core fields | Notes |
| --- | --- | --- |
| `AuthAccount` | `id`, `email`, `phone`, `passwordHash`, `role`, `status`, `failedLoginAttempts`, `lastLoginAt`, etc. | Base identity model |
| `AuthSession` | `accountId`, `tokenFamilyId`, `jti`, `tokenType`, `expiresAt`, `revokedAt` | Tracks login sessions and JWT lifecycle |
| `Role` | `code`, `name`, `portalScope`, `permissions` | Portal-specific role definitions |
| `Permission` | `code`, `description`, `isActive` | Fine-grained permission values |
| `AuthAuditLog` | `identifier`, `action`, `status`, `metadata` | Security/audit trail |

### 3.2 Customer and profile models

| Model | Core fields | Notes |
| --- | --- | --- |
| `User` | `name`, `email`, `phone`, `addresses`, `cartData`, `loyaltyTier` | Customer profile and shopping state |
| `Admin` | `accountId`, `name`, `email`, `phone`, `role` | Admin account profile |
| `Manufacturer` | `name`, `city`, `qualityRating`, `pickupBranch`, `commissionStatus`, `contractStatus` | manufacturing network partner |
| `Distributor` | `name`, linked account email/phone, `province`, `district`, NCM branch/covered-area and pickup details, contract dates, `status`, `qualityRating`, `ratingCount` | distributor application and operational hub profile with customer-review aggregate |
| `MarketingPartner` | `code`, `name`, `status`, `email`, `passwordHash` | partner for marketing card campaigns |

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

### 3.4 Orders, fulfillment, and delivery

| Model | Core fields | Notes |
| --- | --- | --- |
| `Order` | `userId`, `items`, `amount`, `address`, `status`, `date` (`BigInt`), `paymentMethod`, `fulfillmentStatus`, `manufacturerId`, `distributorId`, `deliveryJobId`, gift inventory references, `giftStatus`, `specialOrder*` | primary order transaction; direct distributor orders identify their hub through `distributorId`; admin exchange-list API returns `date` as a decimal string for JSON safety |
| `OrderAssignment` | `orderId`, nullable `manufacturerId`/`distributorId`, `status`, `acceptedAt`, `readyAt`, `pickedUpAt` | customer-order fulfillment assignment; automatic allocation targets distributors |
| `DeliveryOrder` | `orderId`, `manufacturerId`, `state`, `deliveryType`, `ncmOrderId`, `ncmStatus`, `vendorReference`, `codAmount` | carrier package record |
| `DeliveryEvent` | `deliveryOrderId`, `eventType`, `fromState`, `toState`, `payloadJson` | state transition tracking |
| `DeliveryComment` | `ncmOrderId`, `comments`, `payloadJson`, `eventKey` | NCM delivery comments |
| `NcmRequestAttempt` | `deliveryOrderId`, `operation`, `requestUrl`, `result`, `httpStatus` | idempotent request tracking |
| `NcmWebhookEvent` | `eventKey`, `event`, `orderId`, `status`, `payloadJson` | webhook ingestion |

### 3.5 Returns and exchange management

| Model | Core fields | Notes |
| --- | --- | --- |
| `CustomerReturn` | `orderId`, `requestKey`, `requestHash`, `items`, `reason`, `lifecycleStatus`, admin/NCM fields, `ncmDeliveryCharge`, `ncmChargeSource`, refund and inspection fields | approved RMA lifecycle; legacy rows default to `LEGACY_PROCESSED` |
| `CustomerReturnEvent` | `customerReturnId`, event/status transition, actor, reason, metadata, idempotency key | return audit trail |
| `OrderExchangeRequest` | `orderId`, `customerId`, `manufacturerId`, returned `items`, `replacementItems`, `priceDifference`, NCM leg IDs/charges, stock reservation timestamps | exchange lifecycle and replacement-stock control |
| `OrderExchangeEvent` | `exchangeRequestId`, `eventType`, `fromStatus`, `toStatus`, `metadata` | audit trail for exchange state transitions |
| `ReturnExchangeNcmAttempt` | optional return/exchange ID, operation, request/response JSON, HTTP status, result, error, idempotency key | durable NCM request history |
| `DeliveryReturn` | `deliveryOrderId`, `orderId`, `manufacturerId`, `state`, `returnReason`, `inspectionResult` | return-inspection record |

### 3.6.1 System audit and transactional outbox

| Model | Core fields | Notes |
| --- | --- | --- |
| `SystemAuditLog` | actor/role, action, entity type/ID, JSON before/after diff, portal/IP/user-agent, status, failure reason, correlation ID, timestamp | Admin-facing cross-domain audit history; indexed by entity, actor, creation time, and correlation ID. Sensitive fields in state diffs are redacted before storage. Includes selected authentication/MFA, rate-limit, refresh-reuse, and RBAC-denial security signals; these are not confirmed breach records. |
| `SystemAuditOutbox` | JSON event, status, attempts, availability/claim/process timestamps, last error | Durable enqueue record created in the same transaction as a business mutation. A retrying worker writes the log row and marks the outbox row processed atomically; `SystemAuditLog.outboxId` is unique for idempotency. |

### 3.6 Inventory and manufacturer operations

| Model | Core fields | Notes |
| --- | --- | --- |
| `ManufacturerInventory` | `manufacturerId`, `productId`, `quantity`, `reservedQty`, `variantsStock`, `agreedCostPrice` | warehouse stock by manufacturer |
| `ManufacturerInventoryMovement` | `manufacturerId`, `productId`, `variantLabel`, `previousQty`, `newQty`, signed `changeQty`, `movementType`, `reason`, `note`, `actorId`, `createdAt` | immutable, per-variant manufacturer stock adjustment history |
| `StockLog` | `productId`, `quantityChange`, `reason`, `createdAt` | stock movement audit |
| `InboundShipment` | `manufacturerId`, `shipmentNumber`, `quantity`, `notes` | inbound logistics model |

Factory receipts from production remain in manufacturer-owned factory locations and are not available to customer checkout. Stock becomes storefront-eligible only when a distributor confirms receipt into an active distributor location. Product-level and variant-level stock fields mirror the sum of unreserved active distributor ledger balances; `InventoryBalance` and its ledger entries remain authoritative.

Bulk distributor replenishment uses a separate `StockTransfer` lifecycle:

| Model | Core fields | Notes |
| --- | --- | --- |
| `StockTransfer` | manufacturer/distributor profile IDs, source/destination locations, status, request/review actor and timestamps, five manufacturer preparation-check booleans, preparation actor/time | Distributor demand is admin-approved before becoming actionable in the manufacturer portal. |
| `StockTransferLine` | transfer/SKU IDs, requested/approved/dispatched/reserved quantities | Admin approval is bounded by the request and current available factory balance. |
| `StockTransferShipment` | booking mode, carrier/tracking, freight and settlement fields, status/timestamps | Supports NCM, local freight, and direct `SELF_STORE` delivery. Own-store shipments carry zero freight and are immediately received into the distributor ledger location. |
| `StockTransferReceipt` / `StockTransferReceiptLine` | shipment, receiver/time, good/damaged/missing quantities | Self-store delivery records an idempotent all-good receipt in the same transaction as its ledger movements. |

Every shipment requires saved passing manufacturer checks for product availability,
quality, requested color, requested size, and packaging. Self-store eligibility
requires the manufacturer and distributor profiles to share the same account.

### 3.7 Location-aware pricing and local manufacturer assignment

The schema includes explicit coverage and pricing metadata for Nepal-specific local ordering rules:

| Model | Core fields | Notes |
| --- | --- | --- |
| `LocationMapping` | `code`, `name`, `type`, `province` | canonical Nepal province/district code map used for normalization and matching |
| `ManufacturerLocation` | `manufacturerId`, `province`, `district`, `isActive` | local dispatch coverage by manufacturer, keyed to deliverable province/district pairs |
| `LocationProductDiscount` | `productId`, `province`, `district`, `discountPercentage`, `isActive` | per-product local discount overrides by geography |

The `Order` row also captures the resolved local-pricing decision in:

- `locationDiscountManufacturerId`
- `locationDiscountProvince`
- `locationDiscountDistrict`
- `locationPricingSnapshot`

These fields lock the order to the backend-resolved local discount and assigned manufacturer so checkout cannot drift to stale frontend pricing after a stock or assignment change.

### 3.8 Marketing cards and campaigns

| Model | Core fields | Notes |
| --- | --- | --- |
| `MarketingCampaign` | `marketingPartnerId`, `isOwnStore`, `maxScansPerCustomer`, `targetScopeType`, `benefitConfig`, `requestedQuantity`, `status` | partner or in-house campaign definition; public card scan cap defaults to one |
| `MarketingCardBatch` | `campaignId`, `batchCode`, `quantity`, `status` | card batch control |
| `MarketingCard` | `cardCode`, `qrTokenHash`, `partnerId`, `assignedPartnerId`, `assignedOrganization`, `isPublic`, `campaignId`, `batchId`, `exchangeLockRequestId`, `physicalStatus` | individual card instance and optional public/Own Store destination |
| `MarketingCardOrder` | `cardId`, `orderId`, nullable `manufacturerId`, nullable `distributorId` | card-to-order association |
| `MarketingCardAssignment` | `cardId`, nullable `manufacturerId`, nullable `distributorId`, status/receipt fields | stock assignment to a hub; new assignments target distributors |
| `MarketingCardCustomer` | `cardId`, `customerId`, `status`, `scannedAt`, `assignedOrganization`, `scanWeekIndex`, `activatedAt`, `otpExpiresAt` | customer card ownership and indexed scan-limit data |
| `MarketingBenefit` | `campaignId`, `benefitType`, `value`, `percentage`, `quantity` | campaign benefit definitions |
| `MarketingBenefitRedemption` | `cardId`, `benefitId`, `customerId`, `status`, `claimedAt`, `redeemedAt` | claim and redemption lifecycle |

Own Store campaigns may have no marketing partner. Their cards can be tracked as public-to-everyone, assigned to an existing partner, or assigned to a custom organization name. Physical campaign card stock is assigned to active distributors and received/attached through distributor-scoped APIs; old manufacturer assignment references remain available for historical records. All Own Store cards are free for any logged-in customer to scan without an attached/delivered order; card-code entry and QR scan attempts are recorded in `MarketingCardEvent`. A card is consumed by its first successful QR scan and cannot be scanned again by that account or any other account. The campaign's configurable `maxScansPerCustomer` cap (default one per account for the campaign lifetime) applies across its Own Store cards, in addition to the five-per-campaign weekly cap. Organization-assigned cards also retain a two-per-campaign, per-organization lifetime cap. Customer scans snapshot the assigned organization and a Nepal-time Monday-based calendar-week index. Claimed Own Store discount rewards are stored as `CLAIMED` until checkout atomically changes the redemption to `REDEEMED`.

### 3.8 Finance, accounting, and tax

The schema includes a full accounting engine with:

- `Account`
- `FinancialAccount`
- `AccountPayable`
- `AccountReceivable`
- `JournalEntry`
- `JournalLine`
- `AccountingPeriod`
- `FiscalYear`
- `TaxConfiguration`
- `TaxFilingRecord`
- `OperatingExpense`
- `DirectIncome`
- `FinancialCategory`
- `SettlementReversion`

This layer indicates the platform is designed beyond simple ecommerce transactions and includes operational finance, AP/AR, and reporting.

### 3.9 Gift promotions and distributor gift stock

| Model | Core fields | Notes |
| --- | --- | --- |
| `GiftCatalog` | `name`, `sku`, `priceValue`, `category`, `isActive` | Reusable physical gift assortment; catalog removal is a soft archive |
| `LoyaltyTierConfig` | `tierName`, `triggerType`, `minSpendThreshold`, `giftTargetValue`, `isActive` | Configurable `ORDER_VALUE` trigger and gift-value ceiling; loyalty gifts are configured on `CustomerLevel` |
| `DistributorGiftInventory` | `distributorId`, `giftId`, `quantityAvailable`, `quantityReserved`, `status` | New hub distribution batches; each is `PENDING_ACCEPTANCE`, `ACCEPTED`, or `REJECTED` |
| `DistributorGiftMovementLog` | `distributorId`, `giftId`, `orderId`, `movementType`, `quantity` | Audit records for distributor gift allocation, reservation, deduction, restock, and loss |
| `ManufacturerGiftInventory`, `GiftMovementLog` | legacy manufacturer-owned gift records | Retained for historical data; not used for new distributor hub activity |

An order stores its gift catalog reference and the exact inventory batch reserved for it, using `assignedDistributorGiftInventoryId` for distributor hub orders while retaining the legacy manufacturer reference for historical orders. Loyalty gift allowances are represented by `CustomerLevel.giftAmount` and `giftDescription`; eligible rewards are snapshotted into `Order.rewardApplied`. At the distributor final checklist, the backend verifies eligibility, distributor ownership, accepted stock, and gift value, then reserves the selected batch atomically. `giftStatus` progresses through `NONE`, `PENDING_PACKING`, `RESERVED`, and `DELIVERED`, or to `RETURNED` / `LOST` when a protected return decision is recorded. Delivered stock is deducted through the NCM delivery transaction.

Distributor direct hub orders use `Order.orderType = DIRECT_DISTRIBUTOR` and `Order.distributorId`. Their product quantities are deducted transactionally from the distributor's ledger-backed stock; these orders do not use `ManufacturerInventory` or manufacturer assignment records.

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
- `LocationMapping` supplies canonical Nepal geography; `ManufacturerLocation` and `LocationProductDiscount` drive local discount selection, while `DistributorLocation` stores service districts used by prioritized customer-order allocation. `DistributorReview` is linked to one delivered `Order` and contributes to its distributor's `qualityRating` and `ratingCount`.
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
