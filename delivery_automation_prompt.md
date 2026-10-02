Markdown
# Role & Context
You are a Principal Backend Engineer & Enterprise Solutions Architect with 18+ years of expertise in Node.js, Express, Prisma ORM, MySQL, and Courier/Logistics Integrations (specifically Nepal Can Move - NCM).

You are tasked with redesigning and implementing an end-to-end Automated Delivery, Exchange, and Return Lifecycle system for a multi-portal clothing e-commerce platform ("Aama Clothings").

---

## 1. System Rules & Domain Principles
1. **Backend as Source of Truth**: All validation, access control (RBAC), state transitions, stock updates, and NCM API calls MUST happen in the Node.js backend (`backend/`).
2. **Admin Verification Gate**: Customers can request Returns or Exchanges. These requests enter a mandatory review pipeline (`PENDING_ADMIN_REVIEW`). NCM API endpoints (`/api/v2/vendor/order/return` or `/api/v2/vendor/order/exchange-create`) MUST ONLY be called after an Admin explicitly approves the request.
3. **Dynamic Multi-Vendor Pickup**: `fbranch` (From Branch) in NCM requests must dynamically resolve to the fulfilling `Manufacturer.pickupBranch` assigned to the order/item.
4. **Error-Free & Idempotent NCM Integration**: Wrap all NCM HTTP calls in retry logic with `NcmRequestAttempt` logs. Process webhooks idempotently using event deduplication keys.
5. **Double-Entry Accounting & Inventory Alignment**:
   - Return Approval -> Restock inventory / write off damaged items + Create refund/credit entry in `JournalEntry`.
   - Exchange Approval -> Reserve replacement item stock + adjust price delta COD if new variant price differs.

---

## 2. Target NCM API Specs (V1 & V2)
- **Base URL**: `https://demo.nepalcanmove.com/` (Configurable via `process.env.NCM_BASE_URL`)
- **Authentication**: Header `Authorization: Token <NCM_TOKEN>`
- **Endpoints to integrate**:
  - `POST /api/v1/order/create` (Delivery creation)
  - `POST /api/v2/vendor/order/return` (`{ "pk": <ncmOrderId>, "comment": "Reason" }`)
  - `POST /api/v2/vendor/order/exchange-create` (`{ "pk": <ncmOrderId> }` -> Returns `{ cust_order, ven_order }`)
  - `POST /api/v2/vendor/order/redirect` (Address or destination adjustments)
  - `POST /api/v2/vendor/webhook` & webhook payload ingestion handler.

---

## 3. Database Schema Modifications (`backend/prisma/schema.prisma`)

Update or extend the following Prisma models while maintaining full backward compatibility:

```prisma
// Enum updates
enum ExchangeStatus {
  PENDING_ADMIN_REVIEW
  APPROVED_BY_ADMIN
  REJECTED_BY_ADMIN
  NCM_EXCHANGE_INITIATED
  REVERSE_PICKUP_IN_TRANSIT
  REPLACEMENT_IN_TRANSIT
  COMPLETED
  CANCELLED
}

enum ReturnStatus {
  PENDING_ADMIN_REVIEW
  APPROVED_BY_ADMIN
  REJECTED_BY_ADMIN
  NCM_RETURN_INITIATED
  RETURN_IN_TRANSIT
  RECEIVED_AT_WAREHOUSE
  INSPECTED_PASSED
  INSPECTED_FAILED
  REFUNDED
  CANCELLED
}

// Model Modifications
model OrderExchangeRequest {
  id                   String         @id @default(uuid())
  orderId              String
  order                Order          @relation(fields: [orderId], references: [id])
  customerId           String
  customer             User           @relation(fields: [customerId], references: [id])
  manufacturerId       String
  manufacturer         Manufacturer   @relation(fields: [manufacturerId], references: [id])
  
  // Exchange Details
  oldProductId         String
  oldVariantSKU        String
  newProductId         String
  newVariantSKU        String
  reasonCode           String
  customerReason       String?
  
  // Financial Adjustment
  priceDifference      Decimal        @default(0.00) // COD amount if new item is pricier
  
  // Status & Approval
  status               ExchangeStatus @default(PENDING_ADMIN_REVIEW)
  adminReviewerId      String?
  adminNotes           String?
  rejectionReason      String?
  approvedAt           DateTime?
  
  // NCM Specific Tracking
  originalNcmOrderId   Int?
  ncmReplacementOrderId Int?          // cust_order from NCM
  ncmReturnOrderId      Int?          // ven_order from NCM
  
  events               OrderExchangeEvent[]
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
}

model CustomerReturn {
  id                   String       @id @default(uuid())
  orderId              String
  order                Order        @relation(fields: [orderId], references: [id])
  customerId           String
  customer             User         @relation(fields: [customerId], references: [id])
  manufacturerId       String
  manufacturer         Manufacturer @relation(fields: [manufacturerId], references: [id])
  
  items                Json         // Returned items with SKUs and quantities
  reason               String
  status               ReturnStatus @default(PENDING_ADMIN_REVIEW)
  
  // Admin Gate
  adminReviewerId      String?
  adminNotes           String?
  rejectionReason      String?
  approvedAt           DateTime?
  
  // NCM Integration
  ncmOrderId           Int?         // Original NCM order ID
  ncmReturnMarked      Boolean      @default(false)
  
  // Refund & Inventory Action
  totalRefundAmount    Decimal      @default(0.00)
  refundStatus         String       @default("PENDING") // PENDING, PROCESSING, COMPLETED, REJECTED
  inventoryAction      String?      // RESTOCK, SCRAP, DEFECTIVE
  
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt
}
4. Iterative Implementation Roadmap
Execute the solution step-by-step across 5 focused iterations. Maintain full test coverage for each step.

Iteration 1: Schema Updates & Core NCM Service Layer
Update schema.prisma with extended models and run Prisma migration (prisma migrate dev).

Create backend/services/ncmService.js implementing clean HTTP wrappers:

createNcmOrder(payload)

markNcmOrderReturn(ncmOrderId, comment)

createNcmExchange(ncmOrderId)

redirectNcmOrder(payload)

Implement error handling, auto-retry on 5xx errors, and structured logging into NcmRequestAttempt.

Iteration 2: Customer Request Interfaces & Validation Engine
Customer Endpoints:

POST /api/returns/exchange/request: Customer submits exchange request (checks if order is DELIVERED within eligible return/exchange window).

POST /api/returns/return/request: Customer submits return request.

Validate stock availability for requested replacement variant before saving exchange request.

Set initial status to PENDING_ADMIN_REVIEW. Block direct calls to NCM.

Iteration 3: Admin Review, Approval & NCM Dispatch Engine
Admin Review Endpoints:

GET /api/admin/returns/pending: List all exchange & return requests awaiting approval.

POST /api/admin/returns/exchange/:id/review: Approve/Reject exchange.

On Approval: Call ncmService.createNcmExchange(originalNcmOrderId). Save returned cust_order (replacement) and ven_order (reverse pickup).

Reserve replacement variant stock in ManufacturerInventory.

POST /api/admin/returns/return/:id/review: Approve/Reject return.

On Approval: Call ncmService.markNcmOrderReturn(originalNcmOrderId, comment). Set NCM return flag.

Iteration 4: Webhook Processing & Sync Pipeline
Enhance POST /api/ncm-webhook or /webhooks/ncm:

Handle status events: Pickup Order Created, Sent for Pickup, Pickup Complete, Sent for Delivery, Delivered, Returned.

Map NCM ven_order and cust_order updates back to OrderExchangeRequest and CustomerReturn states.

On reverse delivery completion (ven_order delivered back to vendor): Automatically update state to RECEIVED_AT_WAREHOUSE and trigger inspection workflow.

Iteration 5: Financials, Restocking & Portal UI Hooks
Trigger automated accounting entries in JournalEntry upon completed return/refund or exchange COD delta reconciliation.

Release/restock physical inventory in ManufacturerInventory when inspection passes.

Provide response payloads formatted for:

Customer order history UI (frontend/src/pages/Orders.jsx).

Admin inspection & approval panel (admin/src/pages/Returns.jsx).

Manufacturer pickup & incoming return dashboard (manufacturer/src/pages/Orders.jsx).

5. Deliverables & Execution Instructions
Implement all backend routes, services, middleware, and controllers.

Update existing schema files and ensure no broken imports or unhandled promises exist.

Write comprehensive unit/integration tests in backend/tests/ covering:

Request creation by customer.

Admin approval -> Successful NCM API call.

Admin rejection -> Reason propagation.

NCM Webhook handling for dual exchange orders (cust_order & ven_order).

Keep step-by-step progress logs during generation.


---

### Key Highlights
1. **Unified Dual-Order Exchange Lifecycle**: Maps NCM's `cust_order` (replacement delivery) and `ven_order` (item pickup/return) to database states so customer, admin, and manufacturer portals maintain visibility[cite: 17, 33].
2. **Strict Safety Gates**: Customer actions are isolated behind `PENDING_ADMIN_REVIEW` to protect against unauthorized logistics actions or accidental NCM dispatch[cite: 33].
3. **Auditability**: Extends `OrderExchangeEvent` and accounting double-entry registers (`JournalEntry`) to maintain full financial compliance[cite: 34].