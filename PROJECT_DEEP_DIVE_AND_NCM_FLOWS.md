# Project Deep Dive: Architecture, Data, and Manufacturer-to-Distributor Delivery

**Evidence basis:** this document describes the repository implementation as inspected on 2026-10-11. Source code, schema, migrations, and tests are cited so the behavior can be checked. No live NCM account, production credentials, or provider-side webhook configuration were inspected. Where the code only reveals what it sends or parses, this document does not claim to establish NCM's complete external contract.

## Contents

- [1. System overview](#1-system-overview)
- [2. Portals and features](#2-portals-and-features)
- [3. Backend structure and request lifecycle](#3-backend-structure-and-request-lifecycle)
- [4. Database model map](#4-database-model-map)
- [5. Factory production to distributor stock](#5-factory-production-to-distributor-stock)
- [6. Delivery option A: local logistics](#6-delivery-option-a-local-logistics)
- [7. Delivery option B: NCM](#7-delivery-option-b-ncm)
- [8. Internal stock-transfer API contracts](#8-internal-stock-transfer-api-contracts)
- [9. Security and operational boundaries](#9-security-and-operational-boundaries)
- [10. Separate customer-order delivery flow](#10-separate-customer-order-delivery-flow)
- [11. Verification sources and limits](#11-verification-sources-and-limits)

## 1. System overview

The repository contains four independent React/Vite portals and one shared Express API. The portals do not import one another's application code. The backend owns authorization, inventory quantities, order/transfer state, pricing, accounting, and external carrier interactions.

```text
Customer storefront ─┐
Admin operations ────┼── HTTP/JSON ──> Express API ── Prisma ──> MySQL
Manufacturer portal ─┤                     │
Marketing portal ────┘                     ├── NCM API / inbound NCM webhooks
                                           ├── Cloudinary / payment integrations
                                           └── separate notification worker
```

The important stock boundary is:

```text
production at factory -> distributor demand and approval -> shipment -> distributor receipt
```

Factory output and stock in transit are not storefront stock. In this flow, only good units received into an active distributor inventory location can contribute to storefront availability. The newer SKU/location ledger is authoritative; legacy aggregate inventory models are not interchangeable with it. See [the Prisma schema](./backend/prisma/schema.prisma), [inventory ledger service](./backend/services/inventoryLedgerService.js), and [product stock projection service](./backend/services/stockSyncService.js).

## 2. Portals and features

| Application | Main responsibilities |
| --- | --- |
| [`frontend/`](./frontend/) | Customer browsing/search, product pages, cart and wishlist, location-aware checkout, customer orders, cancellation, returns/exchanges, reviews, loyalty and marketing-card experiences. |
| [`admin/`](./admin/) | Catalog and order administration, order assignment, delivery monitoring, manufacturer/distributor management, production approvals, bulk stock-transfer review and NCM reconciliation, inventory/audit, finance/accounting/tax, returns, access control, marketing and gifts. |
| [`manufacturer/`](./manufacturer/) | Manufacturer production and factory operations; manufacturer-to-distributor replenishment and local/NCM shipment booking. For accounts with both roles, the portal also has a distinct distributor workspace for hub inventory, assigned customer orders, direct hub orders, receipts and self-delivery. |
| [`marketing/`](./marketing/) | Marketing-partner accounts, campaigns, cards, QR validation, redemptions, reports, collaborations and profile/settings. |

The portal route and feature descriptions are also maintained in [Frontend and UI Reference](./FRONTEND_AND_UI.md), and the end-to-end manufacturer/distributor operating guide is [here](./DISTRIBUTOR_MANUFACTURER_ADMIN_GUIDE.md).

## 3. Backend structure and request lifecycle

### Main layers

| Code area | Responsibility |
| --- | --- |
| [`backend/server.js`](./backend/server.js) | Express startup, middleware, route mounting, readiness checks and workers. |
| [`backend/routes/`](./backend/routes/) | HTTP method/path plus authentication, permission and workspace-context middleware. |
| [`backend/controllers/`](./backend/controllers/) | HTTP validation, orchestration, Prisma transactions and response serialization. |
| [`backend/services/`](./backend/services/) | Reusable business rules, normalization, ledger/accounting logic, NCM transport and domain helpers. |
| [`backend/middleware/`](./backend/middleware/) | JWT/session validation, role/permission authorization, input sanitation and workspace context. |
| [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) and [`backend/prisma/migrations/`](./backend/prisma/migrations/) | Canonical relational schema and migration history. |
| [`backend/tests/`](./backend/tests/) | Node test-runner unit and regression tests. |

The usual execution path is route -> authentication/authorization/context -> controller -> service/helpers and Prisma -> JSON response. The stock-transfer workflow is a notable implementation detail: its HTTP controller contains much of the transaction orchestration, while pure validation/status/payload functions are in `stockTransferService.js` and ledger movements are in `inventoryLedgerService.js`.

### Controllers and services in the requested journey

| Journey step | Route/controller | Service/helper boundary |
| --- | --- | --- |
| Production request, checks, start and completion | [`manufacturerProductionRoute.js`](./backend/routes/manufacturerProductionRoute.js) -> [`manufacturerProductionController.js`](./backend/controllers/manufacturerProductionController.js) | Production workflow service and ledger/cost-layer writes. |
| Distributor demand, admin review, manufacturer preparation, local/NCM booking, distributor receipt | [`stockTransferRoute.js`](./backend/routes/stockTransferRoute.js) -> [`stockTransferController.js`](./backend/controllers/stockTransferController.js) | [`stockTransferService.js`](./backend/services/stockTransferService.js) normalizes request lines, checklists, status, package payload and cost allocations; [`inventoryLedgerService.js`](./backend/services/inventoryLedgerService.js) applies movements/balance changes; [`ncmClient.js`](./backend/services/ncmClient.js) performs provider HTTP calls; [`accountingPostingEngine.js`](./backend/services/accountingPostingEngine.js) posts local logistics cost. |
| NCM status webhook intake | [`deliveryRoute.js`](./backend/routes/deliveryRoute.js) -> [`deliveryController.js`](./backend/controllers/deliveryController.js) | [`deliveryService.js`](./backend/services/deliveryService.js) deduplicates/stores shared webhook records and calls the stock-transfer status handler for matched NCM IDs. |
| Admin NCM sync/ambiguous-booking recovery | [`stockTransferRoute.js`](./backend/routes/stockTransferRoute.js) -> [`stockTransferController.js`](./backend/controllers/stockTransferController.js) | [`ncmClient.js`](./backend/services/ncmClient.js) reads provider detail/status; [`stockTransferService.js`](./backend/services/stockTransferService.js) normalizes status history; transfer controller applies reconciliation and reservation rules. |

### Request lifecycle

In broad order, `server.js` parses JSON (10 MB limit), applies sanitization, attaches a validated or generated `X-Correlation-ID`, logs completion, configures CORS, and mounts route groups. Route middleware then authenticates and checks permissions. Workspace-specific routes attach the authenticated profile context; handlers must not trust a client-supplied manufacturer/distributor profile ID as authorization.

Endpoints generally return JSON with a `success` flag and often `message`/`code`; the success resource key varies by route (`transfer`, `shipment`, `receipt`, `orders`, etc.), so consumers must follow each endpoint's shape. Stock-transfer errors use `{ success: false, message, code? }`; known validation/conflict errors preserve their HTTP status, while unexpected failures return a generic operation-failed message.

The shared backend mounts the bulk transfer router under `/api/stock-transfers`. The relevant route and permission map is in [`stockTransferRoute.js`](./backend/routes/stockTransferRoute.js). Other major groups cover auth, users, products, orders, returns, accounting, manufacturer operations, delivery, distributor operations and marketing cards; see route mounts in [`server.js`](./backend/server.js).

## 4. Database model map

The database is MySQL and Prisma is the ORM. The schema is larger than the transfer domain; the following map names the records relevant to the requested product journey and the surrounding platform.

### Main domain families

| Domain | Representative tables/models | What they represent |
| --- | --- | --- |
| Identity and RBAC | `AuthAccount`, `AuthSession`, `Role`, `Permission`, `RolePermissionMapping`, `AuthAccountRoleMapping`, `OtpChallenge`, `AdminTwoFactorChallenge` | Login identities, database-backed active roles/permissions, sessions, OTP/MFA. |
| Profiles | `User`, `Admin`, `Manufacturer`, `Distributor`, `MarketingPartner` | Portal-specific person/business records linked to an account. |
| Catalog | `Product`, `Category`, `SubCategory`, `Color`, `ComboBundle`, `Review` | Products, product options and customer-facing catalog data. |
| Customer orders | `Order`, `OrderAssignment`, `DeliveryOrder`, `DeliveryEvent` | Customer purchase, fulfillment assignment and separate parcel-delivery lifecycle. |
| Production and factory inventory | `ManufacturerProductionRequest`, `ManufacturerProductionRequestLine`, `ManufacturerInventoryCostLayer`, `InventorySku`, `InventoryLocation`, `InventoryBalance`, `InventoryLedgerEntry` | Production plan/results, SKU identity, location quantities, movement history and cost. |
| Manufacturer-to-distributor replenishment | `StockTransfer`, `StockTransferLine`, `StockTransferShipment`, `StockTransferShipmentLine`, `StockTransferShipmentLineCostLayer`, `StockTransferShipmentEvent`, `StockTransferReceipt`, `StockTransferReceiptLine`, `InventoryDiscrepancy` | Request/approval, shipment/booking, event history, receipt/QA, cost allocation and discrepancies. |
| NCM/customer delivery audit | `NcmRequestAttempt`, `NcmWebhookEvent`, `DeliveryComment`, `DeliveryFinancialSettlement` | Customer-order request attempts, inbound carrier events/comments and delivery settlement. These are distinct from the stock-transfer event rows. |
| Returns and exchanges | `CustomerReturn`, `CustomerReturnEvent`, `OrderExchangeRequest`, `OrderExchangeEvent`, `ReturnExchangeNcmAttempt`, `DeliveryReturn` | Reviewed customer return/exchange, carrier attempts, inspection and refund stages. |
| Accounting | `Account`, `JournalEntry`, `JournalLine`, `AccountingParty`, `AccountPayable`, `AccountReceivable`, `FinancialAccount`, `CashTransaction` | Financial posting, balances and liabilities/receivables. |
| Audit and messaging | `SystemAuditLog`, `SystemAuditOutbox`, `AuthAuditLog`, `Notification`, `NotificationOutbox` | Auditing/outbox and notification records. The notification worker is a separate subsystem. |

### Transfer and inventory relationships

```text
ManufacturerProductionRequest
  └── ManufacturerProductionRequestLine
       └── production receipt -> InventoryLedgerEntry / InventoryBalance at FACTORY
       └── ManufacturerInventoryCostLayer

Distributor ── StockTransfer ── Manufacturer
                  ├── StockTransferLine ── InventorySku ── Product
                  ├── StockTransferShipment
                  │    ├── StockTransferShipmentLine ── StockTransferLine
                  │    ├── StockTransferShipmentLineCostLayer ── cost layer
                  │    ├── StockTransferShipmentEvent (NCM/provider timeline)
                  │    └── StockTransferReceipt ── StockTransferReceiptLine
                  └── InventoryDiscrepancy (damage/missing/etc.)

InventorySku + InventoryLocation -> InventoryBalance (on-hand and reserved)
InventoryLedgerEntry             -> immutable/idempotent stock movement record
```

### Table responsibilities and state

| Model | Important data and role |
| --- | --- |
| `InventorySku` | Product + normalized size/color identity; unique by `(productId, sizeKey, colorKey)`. |
| `InventoryLocation` | A location (`FACTORY`, `DISTRIBUTOR`, `IN_TRANSIT`, `QUARANTINE`, `DAMAGED`, `LOST`) and owner/profile. |
| `InventoryBalance` | Current `quantityOnHand` and `reservedQuantity`, unique per location/SKU. Available quantity is on-hand minus reserved. |
| `InventoryLedgerEntry` | Quantity movement, source/destination, movement type, reference, actor and a unique idempotency key. Balances and ledger movements are updated together by the ledger service. |
| `StockTransfer` | Manufacturer, distributor, source/destination location, review/request actors/times, preparation checklist, and overall transfer status. |
| `StockTransferLine` | One SKU on the transfer with requested, approved, dispatched and reserved-shipment quantities. |
| `StockTransferShipment` | One shipment/booking mode (`MANUAL`, `NCM`, `SELF_STORE`), its status, idempotency key/hash, carrier IDs, freight/settlement, saved package metadata, NCM status/history/return fields and timestamps. |
| `StockTransferShipmentLine` | Shipped quantity per transfer line, plus cost-layer allocation relations. |
| `StockTransferShipmentEvent` | Shipment-scoped provider event; unique `eventKey` makes repeated webhook/reconciliation events idempotent. |
| `StockTransferReceipt` and `StockTransferReceiptLine` | Who received and when, receipt status, and per-line good/damaged/missing unit counts, evidence and notes. |
| `InventoryDiscrepancy` | Evidence-backed damage/loss/short receipt with custody stage, reporter, responsibility and review/resolution. |
| `NcmBranch` | Locally synchronized NCM branch catalog. Branch validity/active status is checked before NCM shipment booking. |

The `StockTransfer` status values include `PENDING_ADMIN_APPROVAL`, `APPROVED`, `REJECTED`, `IN_TRANSIT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `DISCREPANCY`, and `CANCELLED`. Shipment booking/custody states are separate: `BOOKING_PENDING`, `BOOKING_UNKNOWN`, `BOOKING_FAILED`, `BOOKED`, `DISPATCHED`, `PARTIALLY_RECEIVED`, `DELIVERED`, `DISCREPANCY`, `LOST`, and `CANCELLED`. These are string state columns documented in the schema and guarded by transition checks in services/controllers, not Prisma enum types.

## 5. Factory production to distributor stock

Production and replenishment are separate workflows:

1. Admin-issued production requests carry explicit fabric/GSM, target completion date and batch plan.
2. Manufacturer performs the pre-production checks and records MOQ/unit COGS before starting.
3. Completion requires post-production QA and actual size/color counts. Good units are received through the inventory-ledger path, with production/cost records in the same transactional completion path; damaged units are not counted as good stock.
4. This stock is factory stock, not storefront stock.
5. An active distributor submits a `StockTransfer` request for SKU quantities from a manufacturer's factory location.
6. Admin approval publishes approved quantities to the manufacturer workspace.
7. Manufacturer completes and saves all five transfer-preparation checks: availability, quality, color, size and packaging.
8. Manufacturer chooses a shipment method. Local logistics dispatches immediately; NCM booking reserves stock pending carrier custody confirmation; same-account manufacturer/distributor profiles may use the separate own-store flow.
9. Distributor records the final receipt and QA. Good units become distributor-location stock; damaged/missing units move to their respective locations and create discrepancies.

Production schema and endpoints are defined in [`ManufacturerProductionRequest` models](./backend/prisma/schema.prisma) and [`manufacturerProductionRoute.js`](./backend/routes/manufacturerProductionRoute.js). The transfer API is described below and in [`stockTransferRoute.js`](./backend/routes/stockTransferRoute.js).

## 6. Delivery option A: local logistics

Local/manual dispatch is an explicit manufacturer-paid carrier handoff, not an NCM booking:

1. The manufacturer submits shipment lines, `deliveryPartner`, optional tracking/reference values, positive `freightCharge`, and an `Idempotency-Key`.
2. Backend verifies manufacturer ownership, approved remaining quantities, saved passing preparation checks, shipment details and non-own-store eligibility.
3. A serializable database transaction creates a `MANUAL` shipment, allocates/consumes the applicable factory cost-layer stock, and writes a `TRANSFER_DISPATCH` ledger movement from `FACTORY` to a shipment-scoped `IN_TRANSIT` location.
4. The same transaction records the manufacturer-paid logistics expense/payable through the accounting party and journal-posting path (`MANUFACTURER_LOGISTICS` source and idempotency key).
5. The shipment is immediately `DISPATCHED`; it does not wait for a carrier webhook.
6. Distributor receipt is a separate request. Each SKU line must account for all remaining shipped units as good, damaged, or missing. The transaction posts `TRANSFER_RECEIPT`, `DAMAGE`, and/or `LOSS` movements, creates discrepancy rows as needed, recalculates the product stock projection, and updates shipment/transfer status.

The normal internal endpoint is `POST /api/stock-transfers/:id/dispatch`. The manufacturer compatibility endpoint `POST /api/manufacturer/stock-requests/:id/dispatch` accepts `deliveryMethod: "LOCAL"` / `"LOCAL_LOGISTICS"` and routes to the same manual dispatch logic. Local logistics requires positive freight; a no-freight own-store shipment is not allowed through this path.

### Own-store exception

When the manufacturer and distributor profiles belong to the same `AuthAccount`, the manufacturer can deliver directly into its own distributor store. The separate `SELF_STORE` workflow uses zero freight, verifies the shared account, and records dispatch plus an all-good receipt into the distributor ledger in one transaction. It does not call NCM and does not create a manufacturer logistics payable.

## 7. Delivery option B: NCM

### What the implementation does

The NCM integration is server-to-server. The manufacturer portal does **not** call NCM directly; it sends an authenticated request to this backend, which validates, quotes and books through [`ncmClient.js`](./backend/services/ncmClient.js).

1. Manufacturer submits saved passing preparation checks, shipment quantities, package details, and `Idempotency-Key`.
2. Backend verifies transfer ownership and remaining quantities; rejects own-store transfers; checks both pickup and destination branch names against active `NcmBranch` rows and rejects branches explicitly marked `REJECTED`.
3. If an active catalog branch was previously `UNVERIFIED`, the profile is promoted to verified for booking. Distributor address and phone are required.
4. Backend requests a Door-to-Door shipping-rate quote. It accepts `data.delivery_charge`, `data.charge`, or `data.shipping_charge`; invalid/negative values are rejected.
5. In a serializable transaction, backend reserves factory ledger quantities, legacy mirror quantities where applicable, transfer-line shipment quantities and production cost layers; it creates the shipment as `BOOKING_PENDING`.
6. Backend submits one NCM order-create request. It deliberately uses a one-shot create call (no automatic retry) because retrying an ambiguous create could create a duplicate carrier order.
7. A definitive accepted response with a valid numeric NCM order ID sets the shipment to `BOOKED` and stores the carrier ID/reference. Booking is **not** pickup, dispatch, delivery, or distributor receipt.
8. A definitive rejection releases reservations and records `BOOKING_FAILED`. An ambiguous timeout/transport/server response or success-shaped response without a usable ID is kept as `BOOKING_UNKNOWN` for admin reconciliation; it is not converted to success.
9. The first qualifying NCM pickup/custody event applies the `TRANSFER_DISPATCH` movement from factory to transit and consumes/releases reservations exactly once. Webhook-driven movements use the explicit `SYSTEM:NCM_WEBHOOK` / `SYSTEM` ledger actor identity for auditability; they do not bypass inventory-ledger validation. The event is persisted in `StockTransferShipmentEvent`.
10. Later carrier statuses (including NCM `Delivered`) update carrier status/history. They do not post distributor inventory or complete inspection.
11. Distributor submits the receipt checklist. Only accepted-good quantities enter the active distributor stock balance; damaged/missing units are recorded in `DAMAGED`/`LOST` and create open discrepancies.

### Actual outbound NCM API calls

The client uses `NCM_API_BASE_URL` (fallback: `https://demo.nepalcanmove.com`), `NCM_API_TOKEN`, JSON request/response handling and `Authorization: Token <server-side token>`. The client defaults to a 30-second timeout. Its general HTTP helper retries eligible HTTP 5xx responses up to 1–5 configured attempts (default 3) with a delay; bulk order creation deliberately calls the one-shot method and does not retry. Relevant optional settings are `NCM_API_TIMEOUT_MS`, `NCM_HTTP_MAX_ATTEMPTS`, and `NCM_HTTP_RETRY_DELAY_MS`. The related operations used in the transfer flow are:

| Purpose | Provider call | What the application consumes |
| --- | --- | --- |
| Branch catalog | `GET /api/v2/branches` | Branch rows synchronized to local `NcmBranch`. |
| Freight quote | `GET /api/v1/shipping-rate` | One of `data.delivery_charge`, `data.charge`, `data.shipping_charge`. The rate helper maps the app's `Door2Door` choice to NCM's `Pickup/Collect` rate query values. |
| Create bulk shipment | `POST /api/v1/order/create` | Numeric carrier order ID from supported response nesting/keys; optional carrier tracking number fields. |
| Admin manual refresh | `GET /api/v1/order?id=<ncmOrderId>` and `GET /api/v1/order/status?id=<ncmOrderId>` | Detail fields such as `payment_status`, `delivery_charge`, `vendor_return`, `last_delivery_status`; status history uses `status` and `added_time`. |
| Request vendor return | `POST /api/v2/vendor/order/return` with `{ "pk": "<ncmOrderId>", "comment": "<reason>" }` | Only a verified `vendor_return: true` response is treated as confirmed; it does not mean returned goods are physically received. |

The API token and base URL remain server-side; these are not frontend request headers or client configuration.

#### Exact bulk stock-transfer create body

The following is the exact shape asserted by the repository test for an example transfer. Values such as names/branches are fixtures; the `package` and `instruction` fields are composed by `buildNcmStockTransferPayload()`:

```json
{
  "name": "Distributor",
  "phone": "9800000000",
  "phone2": "",
  "cod_charge": "0",
  "address": "Pokhara",
  "fbranch": "SANKHU",
  "branch": "POKHARA",
  "package": "Apparel | Shirts and trousers | Package: Carton | Dimensions: 40 x 30 x 25 cm | Fragile | Packaging: Waterproof wrapping | Stock transfer 12345678",
  "instruction": "Call on arrival No COD collection.",
  "delivery_type": "Door2Door",
  "weight": "2.5"
}
```

Details:

- `fbranch` is the manufacturer's origin; `branch` is the distributor's destination.
- `cod_charge` is `"0"` for stock-transfer shipments.
- Weight is serialized as a string. The stored package type/dimensions/fragility/packing notes are folded into the provider's documented `package` text field; they are not sent as separate `packageType` or `packageDimensions` properties.
- The optional `vref_id` is intentionally omitted because the full internal transfer reference is too long for the provider. The shipment's internal IDs and idempotency data remain in the local DB.
- The test asserting these exact fields is [`stockTransferService.test.js`](./backend/tests/stockTransferService.test.js); the builder is in [`stockTransferService.js`](./backend/services/stockTransferService.js).

### What NCM create responses mean in this application

The code does not define NCM's complete response schema. It searches for a numeric, safe order identifier under `orderid`, `order_id`, or `id` in the top-level object or nested `data`, `result`, or `order` objects. If found, that identifier becomes `StockTransferShipment.ncmOrderId` and the compatibility `externalReference`; it may also save `tracking_number`/`trackingNumber`. A quote response is read from `data.*` as described above.

Therefore, the exact *application-consumed* response contract is:

```text
create accepted: a parseable positive numeric carrier order ID in one of the supported keys/nesting locations
optional:         tracking_number or trackingNumber
rate quote:       data.delivery_charge OR data.charge OR data.shipping_charge
admin detail:     payment_status, delivery_charge, vendor_return, last_delivery_status
admin status:     list/rows containing status and added_time (where available)
vendor return:    vendor_return === true for confirmed request
```

This is not a fabricated full NCM response sample. The code and tests prove the parser's accepted shapes, not every response field NCM may return.

### Webhook use, URL, and payload processing

**Yes, the implementation supports NCM status webhooks for manufacturer-to-distributor NCM shipments.** They use the shared delivery webhook routes, which pass matched stock-transfer events to `applyNcmStockTransferWebhook()`. Examples of mounted callback paths include:

- `POST /webhooks/webhook/ncm`
- `POST /api/ncm-webhook/webhook/ncm`
- `POST /api/delivery/webhook/ncm`
- `POST /api/delivery/webhook/ncm/order-status`

Aliases are also mounted in [`deliveryRoute.js`](./backend/routes/deliveryRoute.js). The route accepts carrier identifiers including `order_id`, `orderid`, `orderId`, `vref_id`, `vendorReference`, `delivery_order_id` and `order_ids[]`; a transfer is matched using its NCM order ID or compatibility external reference.

The handler validates the JSON body before persistence: it requires at least one valid identifier and a string status or event, rejects payloads over 64 KiB and batches over 100 IDs, and ignores malformed members of otherwise-valid bulk identifier lists while reporting their count. Authentication is checked before body processing. Stored webhook JSON redacts fields whose names indicate tokens, secrets, authorization, passwords, or API keys; nested data is capped at 12 levels.

For a matched transfer, the callback records a shipment-specific event and applies custody/status changes transactionally. It compares a valid provider event timestamp with the latest timed webhook/reconciliation event; a stale event is retained for diagnosis but cannot regress the status or trigger the first custody/ledger movement. Untimed events retain the existing status-rank guard. Duplicate event keys are ignored. The shared receiver checks for conflicting references across stock-transfer shipments, customer-delivery records, active customer returns, and exchange legs; ambiguous identifiers are logged and left unapplied rather than choosing a record arbitrarily. In the customer-delivery path, multiple matching delivery records are likewise treated as ambiguous before return/delivery state mutation.

The receiver returns HTTP 200 only after persistence/processing completes. Its `accepted: true` means the webhook was recorded/handled by the receiver, not that every bulk ID matched a record or was applied: inspect `updates`, `ambiguousOrderIds`, `invalidOrderIdCount`, and `unmatchedOrderIds`. Processing failures return an error so the provider may retry.

The handler recognizes carrier order identifiers in the fields described above and consumes status/event/timestamp values. In simplified form, the event data it uses is:

```json
{
  "order_id": "123456",
  "status": "Pickup Complete",
  "event": "Pickup Complete",
  "timestamp": "2026-10-11T12:00:00Z"
}
```

This illustrates fields consumed by the application, not a claim that this is NCM's only or complete webhook schema. On successful processing, the response follows the shape shown in the API table below.

### Polling/reconciliation: what is and is not happening

- There is **no continuous frontend polling loop** for manufacturer/distributor stock-transfer views. They read the persisted transfer/shipment/event data. The manufacturer page reloads after actions and on focus.
- There is **no automatic recurring NCM poller identified for stock transfers**. Admins can explicitly request reconciliation with `POST /api/stock-transfers/admin/shipments/:shipmentId/ncm-sync`; this performs the provider order-detail and order-status reads and feeds their history through the same idempotent event application path.
- Admin booking resolution is a separate manual action for an ambiguous create result: `PATCH /api/stock-transfers/admin/shipments/:shipmentId/ncm-resolution`, with `outcome: "BOOKED"` or `"NOT_BOOKED"` and verified carrier reference data.
- The NCM HTTP client has bounded retries for eligible 5xx calls generally, but bulk order creation intentionally uses the one-shot create method. That retry behavior is not polling.
- The code proves a callback receiver exists and is guarded by a secret in production. **It cannot prove that a production NCM vendor account has been configured to call a particular URL, or that NCM actually delivers every webhook.** Admin sync is the recovery path for missed/uncertain events.

## 8. Internal stock-transfer API contracts

All routes below are mounted under `/api/stock-transfers`, unless the full route is shown. Authenticated portal clients currently send their JWT in the `token` header; the backend also accepts `Authorization: Bearer …`. Permissions and manufacturer/distributor context are enforced by the route.

| Actor and endpoint | Request shape | Success response / effect |
| --- | --- | --- |
| Distributor `GET /catalog` | No request body. | `{ success: true, manufacturers: [...] }`, with eligible factory products/SKUs. |
| Distributor `POST /requests` | `{ manufacturerId, lines: [{ inventorySkuId, quantity }] }` (variant product/size/color form is also normalized by the controller). | HTTP 201 `{ success: true, transfer }`; verifies active distributor/manufacturer, active published SKU and available factory stock; creates a pending request. |
| Distributor `GET /distributor` | Optional `page`, `limit`. | `{ success: true, transfers, page, limit, total }`, scoped to authenticated distributor. |
| Admin `GET /admin` | Optional `status`, `bookingMode=NCM`, `page`, `limit`. | `{ success: true, transfers, page, limit, total }`. |
| Admin `PATCH /admin/:id/review` | `{ status: "APPROVED" \| "REJECTED", adminNote?, lines?: [{ lineId, approvedQuantity }] }`. | `{ success: true, transfer }`; approval quantities cannot exceed requested or available factory stock. |
| Manufacturer `GET /manufacturer` | Optional `page`, `limit`. | `{ success: true, transfers, page, limit, total, pendingPreparationCount }`; pending admin-review requests are hidden. |
| Manufacturer `PATCH /:id/preparation` | `{ checklist: { availabilityPassed, qualityPassed, colorPassed, sizePassed, packagingPassed } }`. | `{ success: true, transfer }`; may be changed only before shipment creation. All must be true before dispatch. |
| Manufacturer `POST /:id/dispatch` | Header `Idempotency-Key`; `{ lines: [{ lineId, quantity }], deliveryPartner, trackingNumber?, externalReference?, freightCharge }`. | HTTP 201 new / 200 replay: `{ success: true, shipment, replayed }`; dispatches factory stock to transit and posts local freight accounting. |
| Manufacturer `POST /:id/ncm-booking` | Header `Idempotency-Key`; `{ lines: [{ lineId, quantity }], packageDetails: { packageType, productType, productDescription, packageWeight, packageDimensions, deliveryInstruction?, isFragile?, packagingNotes? } }`. | Pending/replayed attempts return `{ success: true, shipment, replayed, bookingPending }`. A newly completed booking returns `{ success: true, shipment, replayed: false, codCharge: "0.00" }`. Neither response means pickup or receipt. |
| Manufacturer compatibility `POST /api/manufacturer/stock-requests/:id/dispatch` | Header `Idempotency-Key`; `{ deliveryMethod: "LOCAL_LOGISTICS" \| "NCM" \| "SELF_STORE", ...methodSpecificFields }`. | Routes to the corresponding local, NCM, or own-store workflow; each retains its distinct freight and stock-transition behavior. |
| NCM `POST /webhooks/webhook/ncm` (also mounted aliases) | Provider JSON carrying a recognized order ID and string `status` or `event`; optional `timestamp`, up to 100 identifiers and 64 KiB total. Secret may be supplied through supported header/query/body locations; production requires a configured secret. | HTTP 200 `{ status: "received", success: true, accepted: true, duplicate, updates, ambiguousOrderIds, invalidOrderIdCount, unmatchedOrderIds }` after persistence. `accepted` is receiver-level, not proof every ID was applied. Invalid/unauthorized/error responses are not success. |
| Admin `POST /admin/shipments/:shipmentId/ncm-sync` | Empty JSON body. | `{ success: true, shipment }` after manual order-detail/status reconciliation. Provider error returns 502 and leaves the last saved status intact. |
| Admin `PATCH /admin/shipments/:shipmentId/ncm-resolution` | `{ outcome: "BOOKED" \| "NOT_BOOKED", externalReference?, trackingNumber?, freightCharge? }`. | `{ success: true, shipment }`; records verified decision and either keeps booking or releases reservations. |
| Manufacturer `POST /manufacturer/shipments/:shipmentId/ncm-return` | `{ reason }`. | `{ success: true, shipment, replayed }`; submits return request and records request status, not physical receipt. |
| Distributor `POST /shipments/:shipmentId/receipt` | Header `Idempotency-Key`; `{ notes?, lines: [{ shipmentLineId, goodQuantity, damagedQuantity, missingQuantity, damageType?, evidence?: string[], note? }] }`. Counts must equal remaining shipped quantity. | HTTP 201 new / 200 replay: `{ success: true, receipt, replayed, shipmentStatus, transferStatus }`; applies ledger and discrepancy effects transactionally. |

The detailed route middleware and controller response logic are in [`stockTransferRoute.js`](./backend/routes/stockTransferRoute.js) and [`stockTransferController.js`](./backend/controllers/stockTransferController.js). Exact request field validation is performed server-side; frontend validation is only user experience and is not authorization.

## 9. Security and operational boundaries

- **Session-aware authorization:** access JWT is checked against its database-backed `AuthSession` (`jti`, account, token type, expiry and revocation), then active account/workspace profile and role/permission checks are applied. A decoded role claim alone is insufficient. See [`unifiedAuth.js`](./backend/middleware/unifiedAuth.js), [`authorize.js`](./backend/middleware/authorize.js), and [`rbacService.js`](./backend/services/rbacService.js).
- **Workspace scope:** stock-transfer routes attach authenticated manufacturer/distributor context. The controller checks transfer ownership, destination distributor and active status; customer-supplied profile IDs do not confer access.
- **NCM API credentials:** `NCM_API_TOKEN` and base URL are server-side environment settings. They must not be exposed in Vite/public frontend variables.
- **Webhook authentication:** `NCM_WEBHOOK_SECRET` is compared in constant time. Supported input locations include `x-ncm-webhook-secret`, query token/secret, `Authorization: Token …` or Bearer, and body secret/token. In production, an unset secret does not authorize ordinary webhook requests; in non-production, the no-secret configuration allows them. The test-payload fast path (`test: true` or `order_id` beginning `TEST-`) acknowledges before secret validation. Prefer the dedicated header rather than query/body secrets.
- **Idempotency and concurrency:** outbound transfer create and local receipt require an `Idempotency-Key`, with a hash to reject key reuse for different inputs. Database unique keys, serializable transactions, ledger idempotency keys, event keys and status ordering protect against duplicate stock movements.
- **Ambiguous external outcomes:** a timeout/unknown create is not retried into a possible duplicate and is not reported booked. The shipment stays unresolved for admin reconciliation. A carrier booking failure does not become success in portal status labels.
- **Audit and evidence:** inventory is changed via ledger movements, and damaged/missing receipts create discrepancies with reporter/evidence fields. Local manufacturer-paid freight has its own accounting posting; NCM freight is tracked for platform/admin settlement and is not treated as a manufacturer/distributor payable.
- **External integration limitations:** repository code cannot prove provider uptime, live NCM credentials, a configured NCM callback URL, delivery guarantees, or the complete provider response schema.

## 10. Separate customer-order delivery flow

Bulk stock transfers must not be confused with customer-order fulfillment:

| Concern | Bulk manufacturer -> distributor | Customer order -> customer |
| --- | --- | --- |
| Primary workflow record | `StockTransfer` / `StockTransferShipment` | `Order` / `OrderAssignment` / `DeliveryOrder` |
| Ownership | Manufacturer's factory stock moves to a distributor hub | Active distributor with stock is assigned the order; manufacturer is not a checkout fulfillment fallback |
| NCM booking | Manufacturer books the distributor replenishment shipment | Admin/fulfillment path requests customer delivery for an assigned order |
| Webhook persistence | `StockTransferShipmentEvent` plus shared webhook record | `DeliveryEvent` / `NcmWebhookEvent` and delivery/order state |
| Who confirms inventory receipt | Distributor receipt checklist | Customer delivery status; this is not the distributor replenishment receipt flow |

Customer checkout allocation reserves distributor-ledger stock; delivery status is served from the saved backend state. Customer returns/exchanges have their own NCM attempts and event/state lifecycle. Their endpoints, models, and accounting are documented in [Architecture and Backend Reference](./ARCHITECTURE_AND_BACKEND.md), [Database and Schemas](./DATABASE_AND_SCHEMAS.md), and [Security, Data Flow, and UI Audit](./SECURITY_DATA_FLOW_AND_UI_AUDIT.md).

## 11. Verification sources and limits

Key source evidence for the flow:

- Route permissions and workspace context: [`backend/routes/stockTransferRoute.js`](./backend/routes/stockTransferRoute.js), [`backend/middleware/unifiedAuth.js`](./backend/middleware/unifiedAuth.js).
- Request/approval/local/NCM/receipt orchestration: [`backend/controllers/stockTransferController.js`](./backend/controllers/stockTransferController.js).
- Transfer state rules, payload builder, status normalization and provider client: [`backend/services/stockTransferService.js`](./backend/services/stockTransferService.js), [`backend/services/ncmClient.js`](./backend/services/ncmClient.js).
- Webhook auth, shared receiver and persistence dispatch: [`backend/controllers/deliveryController.js`](./backend/controllers/deliveryController.js), [`backend/services/deliveryService.js`](./backend/services/deliveryService.js).
- Table fields and relations: [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) and stock-transfer migration files under [`backend/prisma/migrations/`](./backend/prisma/migrations/).
- Exact test fixture for NCM transfer payload, booking ID parsing, branch validation, state ordering and idempotency helpers: [`backend/tests/stockTransferService.test.js`](./backend/tests/stockTransferService.test.js). Delivery NCM request/webhook behaviors are also exercised in [`backend/tests/deliveryAutomation.test.js`](./backend/tests/deliveryAutomation.test.js).

The transfer helper tests validate payload construction and state rules; they are not a live NCM integration test and do not prove provider-side configuration. For deployment verification, confirm the NCM production base URL/token out of band, register the selected callback URL with NCM, configure the secret, and exercise booking/webhook/reconciliation against an isolated approved integration environment.
