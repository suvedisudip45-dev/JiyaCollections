# API Payload Minimization & Performance Refactor — Zero-Regression Agent Prompt

## Purpose

You are working on an existing production-oriented e-commerce platform that was largely vibe-coded and now needs a **careful API payload/performance refactor**.

The platform has:

- One shared backend.
- Three portals/clients:
  1. Admin portal
  2. Manufacturer portal
  3. Customer-facing website
- Social-media order functionality.
- Loyalty-card / loyalty-level functionality.
- Product/catalog, cart, checkout, order, customer, address, inventory, manufacturer, admin, and other existing features.
- Existing authentication/authorization and validation.
- Existing business rules that must remain unchanged.

### Primary objective

Reduce:

- API request payload size.
- API response payload size.
- Database rows/columns/documents fetched unnecessarily.
- Serialization/deserialization work.
- Backend CPU work.
- Network transfer.
- Memory usage.
- Query execution time.
- Repeated data processing.
- Unnecessary frontend state/data handling.

### Absolute priority

**DO NOT change functionality. DO NOT weaken security. DO NOT remove validation. DO NOT remove features. DO NOT change business rules. DO NOT silently change API semantics.**

The goal is:

> Return and accept only the minimum data required for a specific API operation and consumer, while preserving exactly the same externally observable business behavior.

Performance improvements are secondary to correctness and security.

---

# 1. Critical instructions to the coding agent

Before modifying code, **deeply inspect the entire repository**.

Do not start by editing the example endpoint.

Build an understanding of:

- Backend architecture.
- Database/ORM models.
- Controllers/routes.
- Services/use-cases.
- Repositories/data-access code.
- DTOs/schemas/validators.
- Authentication.
- Authorization/RBAC.
- Admin frontend API calls.
- Manufacturer frontend API calls.
- Customer website API calls.
- Social-media order flow.
- Loyalty flow.
- Checkout/order flow.
- Product/catalog flow.
- Existing caching.
- Existing pagination.
- Existing query population/includes/joins.
- Existing serializers.
- Existing tests.
- Existing error handling.
- Existing API documentation/contracts.
- Any background jobs/events/webhooks that consume API/service results.

Do not assume that a field is unused just because it is not visibly rendered in one component.

Search the complete codebase for every endpoint and every response/request field before removing or changing it.

---

# 2. Non-negotiable safety rules

## 2.1 Preserve business logic

Do not modify:

- pricing rules;
- discounts;
- loyalty calculations;
- loyalty eligibility;
- reward usage;
- stock rules;
- inventory reservation;
- order totals;
- shipping/delivery fee rules;
- payment rules;
- manufacturer assignment;
- order status transitions;
- cancellation/refund rules;
- social-media order behavior;
- customer permissions;
- admin permissions;
- manufacturer permissions;
- authentication;
- authorization;
- audit behavior;
- notification behavior;
- transactional behavior;
- database relationships.

If an optimization appears to require changing any of these, stop and redesign the optimization.

---

## 2.2 Never trust client-supplied calculated values

This is especially important for orders.

The client must NOT be allowed to establish authoritative:

- product price;
- cost price;
- discount amount;
- delivery fee;
- tax;
- subtotal;
- grand total;
- stock quantity;
- loyalty eligibility;
- reward amount;
- reward validity;
- manufacturer;
- inventory availability;
- order ownership;
- privileged status;
- role;
- permissions.

The server must derive authoritative values from trusted server-side data.

For example, the existing request:

```json
{
  "address": {
    "firstName": "sita",
    "lastName": "sunar",
    "email": "sita@gmail.com",
    "phone": "9874563210",
    "street": "KATTIKE",
    "landmark": "sankhu bridge",
    "district": "Kathmandu",
    "city": "SANKHU",
    "ncmBranch": "SANKHU",
    "deliveryInstruction": "",
    "province": "Bagmati Province",
    "state": "Bagmati Province",
    "country": "Nepal"
  },
  "items": [
    {
      "id": "115e768e-0b84-4791-bb64-1434a973c632",
      "name": "Tshirt",
      "nepaliName": "टी-शर्ट",
      "description": "this is 100 percent cotton comb tshirt",
      "price": 1100,
      "image": ["..."],
      "category": "Men, Women",
      "subCategory": "Topwear",
      "sizes": ["M", "S", "L"],
      "colors": ["Black", "White"],
      "variants": [],
      "bestseller": true,
      "newInStore": false,
      "isSpecialOffer": false,
      "offerTag": "",
      "offerEndDate": null,
      "discount": 10,
      "costPrice": 800,
      "stockQuantity": 11,
      "lowStockThreshold": 5,
      "published": true,
      "date": 1790013932448,
      "categories": ["Men", "Women"],
      "rating": 0,
      "reviewCount": 0,
      "size": "M",
      "color": "Black",
      "quantity": 1
    }
  ],
  "deliveryFee": 50,
  "amount": 1040
}
```

contains a large amount of data that should normally NOT be accepted as authoritative order input.

A safe minimal order command should conceptually resemble:

```json
{
  "address": {
    "firstName": "sita",
    "lastName": "sunar",
    "email": "sita@gmail.com",
    "phone": "9874563210",
    "street": "KATTIKE",
    "landmark": "sankhu bridge",
    "district": "Kathmandu",
    "city": "SANKHU",
    "ncmBranch": "SANKHU",
    "deliveryInstruction": "",
    "province": "Bagmati Province",
    "state": "Bagmati Province",
    "country": "Nepal"
  },
  "items": [
    {
      "productId": "115e768e-0b84-4791-bb64-1434a973c632",
      "size": "M",
      "color": "Black",
      "quantity": 1
    }
  ]
}
```

**This is an architectural direction, not permission to blindly change the existing contract.**

First inspect the actual application and all consumers.

If the existing API uses variant IDs, SKU IDs, cart-line IDs, or another canonical identifier, use that identifier instead of inventing a new one.

The server must load the authoritative product/variant data internally and calculate the final order.

---

# 3. Core architecture principle

Separate these concepts:

### Command DTO

Data required from the client to perform an operation.

Example:

```text
CreateOrderCommand
UpdateOrderCommand
AddCartItemCommand
ApplyCouponCommand
UseLoyaltyRewardCommand
```

### Query DTO

Data required to answer a specific read operation.

Example:

```text
ProductListDTO
ProductDetailDTO
OrderSummaryDTO
OrderDetailDTO
LoyaltySummaryDTO
AdminOrderDTO
ManufacturerOrderDTO
```

### Domain/model entity

Internal database/domain representation.

### Persistence projection

Only columns/fields required by the current operation.

### Response DTO

Only fields actually required by the requesting client/use-case.

Never serialize database entities directly to API responses.

Never use the same giant DTO for every endpoint merely because it is convenient.

---

# 4. Endpoint inventory must come first

Before implementation, generate an internal inventory containing:

| Method | Endpoint | Consumer | Auth | Request fields | Response fields | DB fields | Current payload | Required payload | Risk |
|---|---|---|---|---|---|---|---|---|---|

Cover:

- Admin
- Manufacturer
- Customer website
- Social media
- Authentication
- Products
- Categories
- Variants
- Cart
- Checkout
- Orders
- Addresses
- Loyalty
- Rewards
- Customers
- Manufacturers
- Inventory
- Payments
- Shipping
- Reviews
- Search/filter
- Notifications
- Reports
- Dashboard
- Settings
- Any other endpoint found in the repository.

Do not leave this inventory only in memory.

Use it to drive the refactor.

---

# 5. Field classification

For every request and response field, classify it as one of:

1. `REQUIRED`
2. `CONDITIONALLY_REQUIRED`
3. `OPTIONAL`
4. `SERVER_DERIVED`
5. `INTERNAL_ONLY`
6. `DEPRECATED_BUT_COMPATIBLE`
7. `SECURITY_SENSITIVE`

### Important

`SERVER_DERIVED`, `INTERNAL_ONLY`, and security-sensitive values should not be accepted from an untrusted client merely because they existed in the previous payload.

Examples:

```text
costPrice
stockQuantity
discount
deliveryFee
amount
role
permissions
manufacturerId
isAdmin
loyaltyLevel
reward eligibility
database timestamps
internal IDs
audit metadata
```

Whether a particular field belongs in a response must be decided by actual consumer requirements and authorization.

---

# 6. Response minimization

## 6.1 Never return database entities directly

Bad:

```js
return res.json(product);
```

if `product` is a full database document containing:

- internal fields;
- cost price;
- inventory internals;
- all images;
- all variants;
- audit timestamps;
- manufacturer internals;
- unrelated metadata;
- administrative fields.

Use explicit response DTOs/projections.

Example:

```js
const productListItem = {
  id: product.id,
  name: product.name,
  price: product.price,
  image: product.image?.[0],
  rating: product.rating,
  reviewCount: product.reviewCount
};
```

But do not copy this blindly. Determine the actual frontend requirements first.

---

# 7. Database query minimization

Reducing JSON after fetching a giant database record is NOT sufficient.

Bad optimization:

```text
SELECT *
     ↓
load entire object
     ↓
remove 70% of fields
     ↓
JSON response
```

Preferred:

```text
SELECT only required columns
     ↓
minimal domain/query object
     ↓
minimal response DTO
```

For MongoDB-like systems:

```js
find(filter).select("id name price image rating reviewCount")
```

or the equivalent projection.

For SQL/ORM systems:

```text
SELECT id, name, price, image, rating, review_count
FROM products
WHERE ...
```

Use the appropriate ORM/repository mechanism already used by the project.

Do not introduce raw queries if they bypass existing security, tenancy, transactions, or repository conventions.

---

# 8. Prevent over-fetching and N+1 queries

Inspect every endpoint for:

- unnecessary joins;
- unnecessary populate/include;
- nested eager loading;
- repeated queries inside loops;
- duplicate queries for the same entity;
- loading all variants when only one variant is needed;
- loading all loyalty levels when only current/next level is needed;
- loading complete users when only IDs/names are needed;
- loading complete products when only price/stock is needed.

Replace N+1 patterns with appropriate:

- batch queries;
- projections;
- joins/includes only where necessary;
- aggregation;
- grouped queries;
- indexed lookups.

Do not trade one N+1 problem for an enormous aggregation that is harder to maintain unless measurements justify it.

---

# 9. Order creation must be especially strict

Order creation is a high-risk operation.

The client should provide only information needed to express intent.

Conceptually:

```json
{
  "items": [
    {
      "productId": "...",
      "variantId": "...",
      "quantity": 1
    }
  ],
  "addressId": "...",
  "deliveryInstruction": ""
}
```

Use the existing application's actual identifiers.

If the business requires a new address, accept only validated address fields required for creation.

The server must:

1. Authenticate the user.
2. Authorize the operation.
3. Validate item identifiers.
4. Validate quantity.
5. Load authoritative product/variant information.
6. Verify publication/availability rules.
7. Verify stock.
8. Calculate current price.
9. Calculate applicable discounts.
10. Calculate loyalty benefits.
11. Calculate shipping/delivery fees.
12. Calculate taxes if applicable.
13. Calculate final total.
14. Create/reserve inventory atomically as currently required.
15. Create the order.
16. Trigger existing side effects.
17. Return only the order response required by the caller.

Do not trust:

```text
name
description
price
costPrice
discount
stockQuantity
deliveryFee
amount
rating
images
categories
published
manufacturer
loyalty reward
```

from the client as authoritative order data.

---

# 10. Loyalty API minimization

The supplied loyalty response currently duplicates level data heavily.

For example, `currentLevel` and `nextLevel` contain many fields, while `allLevels` repeats the same records.

Do NOT automatically return all loyalty configuration to a customer.

Determine what the UI actually renders.

A customer-facing summary may only need something conceptually like:

```json
{
  "totalSpend": 1110,
  "totalOrders": 1,
  "currentLevel": {
    "levelNumber": 1,
    "name": "Bronze Explorer",
    "badgeIcon": "🥉",
    "color": "#CD7F32"
  },
  "nextLevel": {
    "levelNumber": 2,
    "name": "Silver VIP",
    "badgeIcon": "🥈",
    "color": "#94A3B8",
    "minSpend": 3000,
    "minOrders": 2
  },
  "progressPercentage": 44,
  "remainingSpend": 1890,
  "remainingOrders": 1,
  "activeReward": {
    "freeShipping": false,
    "discountAmount": 0,
    "giftAmount": 0,
    "letterIncluded": false,
    "title": "Entry Level (No Perks)",
    "description": "...",
    "orderLimit": 1,
    "remainingUses": 0
  }
}
```

Again, this is an example.

Use actual frontend usage to determine the exact contract.

If an admin screen genuinely needs all loyalty configuration, expose a separate admin-specific endpoint/DTO.

Do not force the customer API to carry admin configuration.

---

# 11. Separate customer, manufacturer, and admin projections

Do not return one universal response object to all three portals.

Example:

```text
GET /orders
    ↓
CustomerOrderListDTO

GET /manufacturer/orders
    ↓
ManufacturerOrderListDTO

GET /admin/orders
    ↓
AdminOrderListDTO
```

Each should contain only fields required by that actor.

Authorization must be applied before projection.

Do not rely on "we don't render that field" as a security mechanism.

---

# 12. Request minimization for PUT/PATCH

Do not require clients to send the entire resource when only one field changes.

Prefer:

```http
PATCH /users/me
```

with:

```json
{
  "phone": "..."
}
```

instead of:

```json
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "address": "...",
  "loyalty": "...",
  "orders": "...",
  ...
}
```

Use PATCH semantics only where compatible with the existing API.

For PUT endpoints that currently require full replacement semantics, do not silently change semantics.

If converting to PATCH, update all consumers and tests deliberately.

---

# 13. POST response minimization

After creating a resource, return only what the caller needs.

Do not automatically return:

```text
entire created entity
+ related entities
+ user
+ product
+ manufacturer
+ loyalty
+ audit data
+ inventory
+ all images
```

If the frontend only needs:

```json
{
  "id": "...",
  "status": "PENDING"
}
```

return that.

If the UI needs a complete order confirmation, return the minimum confirmation DTO required by that screen.

---

# 14. DELETE response minimization

Avoid returning deleted database entities.

Prefer a minimal response such as:

```json
{
  "success": true
}
```

or the existing standard success envelope if the project already has one.

Do not change established error semantics without reason.

---

# 15. List API minimization

Every list endpoint must consider:

- pagination;
- page size limits;
- cursor pagination where appropriate;
- filtering;
- sorting;
- minimal list-item DTO;
- detail endpoint for full resource;
- projection;
- indexed filters.

Avoid:

```text
GET /products
→ every product
→ every variant
→ every image
→ every review
→ every manufacturer
```

when the page only needs:

```text
id
name
price
thumbnail
rating
availability
```

Never remove pagination merely to simplify code.

Never allow unbounded result sets.

---

# 16. Detail endpoints

Use separate detail projections when required.

Example:

```text
GET /products
```

returns lightweight cards.

```text
GET /products/:id
```

returns product-detail data.

Do not make the list endpoint return detail-level data simply because one frontend page needs it.

---

# 17. Conditional/expandable data

If an existing feature genuinely needs optional related data, consider a controlled mechanism such as:

```text
?include=variants
```

or the project's equivalent.

Rules:

- only allow explicitly supported includes;
- enforce authorization for every included resource;
- enforce limits;
- never allow arbitrary database field selection from the client;
- never accept arbitrary populate paths;
- never expose internal fields through generic `select` parameters.

A whitelist is mandatory.

Bad:

```text
?fields=passwordHash,internalNotes,costPrice
```

Good:

```text
?include=variants,reviews
```

only if those include values are explicitly supported.

---

# 18. Security requirements

The refactor must preserve or improve:

### Authentication

- JWT/session validation.
- Token expiration.
- Refresh-token behavior.
- Authentication middleware.

### Authorization

Verify authorization server-side for every protected resource.

Examples:

- Customer can only access their own orders.
- Manufacturer can only access permitted manufacturer/order data.
- Admin can access authorized administrative data.

Do not rely on frontend route guards.

### Mass-assignment protection

Never blindly do:

```js
Model.update(req.body)
```

or equivalent.

Use explicit allowed fields.

### Field-level security

Never expose sensitive/internal fields such as:

- password hashes;
- reset tokens;
- refresh tokens;
- secrets;
- private API keys;
- internal notes;
- cost prices to unauthorized users;
- internal supplier/manufacturer data;
- authorization metadata.

### IDOR protection

Changing:

```text
/order/:id
```

to another valid ID must not expose another user's resource.

### Input validation

Preserve or improve:

- type validation;
- enum validation;
- length limits;
- numeric bounds;
- quantity bounds;
- UUID/ID validation;
- address validation;
- string sanitization where appropriate;
- business validation.

### DoS protection

Avoid allowing clients to request:

```text
100000 records
```

or:

```text
all variants + all reviews + all images
```

in one request.

Set safe server-side limits.

---

# 19. Do not expose arbitrary field selection

Do NOT implement generic:

```text
?fields=*
?select=*
?populate=*
?include=*
```

without strict whitelisting.

A safe implementation is:

```text
ALLOWED_PRODUCT_INCLUDES = {
  variants,
  reviews
}
```

with authorization and maximum expansion rules.

---

# 20. Pagination and limits

Every potentially large collection must have bounded results.

Examples:

```text
limit <= 50
```

or an appropriate project-specific maximum.

Do not pick 50 blindly. Inspect existing UX and workload.

Never let a client bypass the maximum through:

```text
limit=999999
limit=-1
limit=null
limit=Infinity
```

Validate and normalize all pagination values.

---

# 21. Caching

Consider caching only where it is safe and useful.

Potential candidates:

- public product catalog;
- categories;
- public configuration;
- loyalty configuration that is not user-specific.

Do NOT cache personalized/private data without correct cache isolation.

Never cache:

- authenticated user data in a shared public cache;
- order data across users;
- payment-sensitive data.

Consider:

- ETag / If-None-Match;
- Cache-Control;
- application-level caching;
- Redis or existing cache infrastructure.

Do not introduce infrastructure solely for theoretical optimization unless measurements justify it.

---

# 22. Avoid duplicate calculations

If a response needs the same derived value multiple times:

```text
progressPercentage
remainingSpend
remainingOrders
```

calculate it once.

Do not repeatedly scan large arrays.

Prefer:

```text
O(n)
```

over repeated:

```text
O(n) + O(n) + O(n)
```

when the result can be computed in one pass.

But do not optimize code at the expense of readability when it has no meaningful performance impact.

---

# 23. Avoid loading full arrays for simple aggregates

If the backend only needs:

```text
total orders
total spend
```

do not necessarily load every order document into application memory.

Prefer database-side:

- COUNT;
- SUM;
- aggregation;
- indexed query;
- precomputed aggregate where already appropriate.

However, preserve exact existing business semantics.

For money, use the project's existing safe monetary representation and avoid introducing floating-point rounding errors.

---

# 24. Database indexing

Inspect query patterns.

Add indexes only where justified by actual query patterns.

Consider:

- userId + createdAt;
- order status + createdAt;
- manufacturerId + status;
- productId;
- SKU/variant identifiers;
- category filters;
- published status;
- loyalty/customer identifiers.

Do not create indexes blindly.

Verify index selectivity and write overhead.

Do not remove existing indexes without evidence.

---

# 25. API response envelope

If the project already consistently uses:

```json
{
  "success": true,
  "data": {}
}
```

preserve that convention.

Do not create inconsistent response formats.

But do not duplicate the same data at multiple levels.

Avoid:

```json
{
  "success": true,
  "data": {
    "order": {...}
  },
  "order": {...}
}
```

unless there is a demonstrated compatibility requirement.

---

# 26. Backward compatibility

Before changing a contract:

1. Search all consumers.
2. Search all tests.
3. Search documentation.
4. Search API clients.
5. Search mobile/web integrations if present.
6. Search webhooks/background jobs.
7. Search social-media integrations.

Do not remove fields that are still used.

If compatibility is required, use:

- versioned DTOs;
- temporary deprecated fields;
- migration adapters;
- feature flags.

Do not maintain compatibility by continuing to fetch unnecessary database data if a compatibility adapter can derive the old shape from a smaller internal query.

---

# 27. Error responses

Do not make errors larger than necessary.

Preserve useful error structure, for example:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Requested quantity is not available."
  }
}
```

Do not leak:

- SQL errors;
- stack traces;
- internal file paths;
- database structure;
- secret configuration;
- internal identifiers unless intentionally part of the public contract.

Do not change error codes relied upon by the frontend unless all consumers are updated.

---

# 28. Logging

Do not log entire request/response bodies by default.

Especially avoid logging:

- passwords;
- access tokens;
- refresh tokens;
- payment information;
- private customer data;
- unnecessary product blobs;
- complete order objects.

Use structured logs with only diagnostic fields.

---

# 29. Observability

Before and after the refactor, measure where practical:

- response payload bytes;
- request payload bytes;
- average latency;
- p50 latency;
- p95 latency;
- p99 latency where available;
- DB query count;
- DB query duration;
- serialization time where measurable;
- memory usage;
- number of returned records;
- number of selected columns/fields where tooling supports it.

Do not claim a performance improvement without measurement.

---

# 30. Required implementation workflow

Follow this exact sequence.

## Phase 1 — Discovery

Do not modify behavior.

1. Inventory all API endpoints.
2. Identify all consumers.
3. Identify all request and response schemas.
4. Identify direct entity serialization.
5. Identify `SELECT *`, full-document queries, broad populate/include.
6. Identify N+1 queries.
7. Identify unbounded lists.
8. Identify duplicate data in responses.
9. Identify security-sensitive fields.
10. Identify client-supplied calculated values.
11. Identify duplicated loyalty configuration.
12. Identify oversized order creation requests.

Produce a report.

---

## Phase 2 — Contract map

For every endpoint determine:

```text
Who calls it?
Why is it called?
What fields are actually used?
Which fields are authoritative?
Which fields are derived?
Which fields are security-sensitive?
Which database fields are required?
Which related entities are required?
```

---

## Phase 3 — DTO/projection design

Create explicit:

```text
Request DTOs
Command DTOs
Query DTOs
Response DTOs
Persistence projections
```

Use the project's existing validation framework.

Do not introduce an unnecessary new architecture if the existing project already has a clean equivalent.

---

## Phase 4 — Safe implementation

Refactor one feature area at a time.

Recommended order:

1. Read-only list endpoints.
2. Read-only detail endpoints.
3. Loyalty reads.
4. Customer/profile reads.
5. Cart operations.
6. Order reads.
7. Order creation.
8. Order updates.
9. Admin APIs.
10. Manufacturer APIs.
11. Social-media order flow.
12. Other large/high-traffic endpoints.

After each area:

- run tests;
- build backend;
- build all portals;
- verify API consumers;
- inspect payloads;
- inspect authorization.

---

# 31. Example transformation

## Current pattern

```text
Frontend
   ↓
GET /product
   ↓
Backend
   ↓
SELECT *
   ↓
full product entity
   ↓
full product JSON
   ↓
Frontend only uses 6 fields
```

## Target pattern

```text
Frontend
   ↓
GET /product
   ↓
Backend
   ↓
SELECT only required fields
   ↓
ProductListDTO
   ↓
small JSON
   ↓
Frontend
```

---

# 32. Order creation transformation

## Current anti-pattern

```text
Frontend sends:
product name
description
images
price
costPrice
discount
stock
variants
categories
rating
delivery fee
amount
...
```

## Target behavior

```text
Frontend sends:
product/variant identifier
quantity
required customer/address information
required delivery instruction
required payment/checkout intent fields
```

Then:

```text
server
  ↓
validate request
  ↓
authorize
  ↓
load authoritative product/variant data
  ↓
validate stock
  ↓
calculate price
  ↓
calculate discounts
  ↓
calculate loyalty
  ↓
calculate shipping
  ↓
calculate final total
  ↓
persist order transactionally
  ↓
existing side effects
  ↓
minimal response
```

This is a security improvement as well as a payload optimization.

---

# 33. Loyalty transformation

Current response repeats the same level configuration in:

```text
currentLevel
nextLevel
allLevels
```

Do not blindly delete `allLevels`.

First find every frontend use.

If the customer page only displays progress/current/next level, create a customer summary DTO.

If the admin page needs all loyalty levels, keep that data behind an admin-specific endpoint.

Do not send administrative configuration to customers merely because it is already present in the backend object.

---

# 34. Testing requirements

Testing is mandatory.

The refactor is not complete until all existing tests pass and the new tests below are implemented.

## 34.1 Contract tests

For every modified endpoint verify:

- HTTP method unchanged unless intentionally migrated.
- URL unchanged unless intentionally migrated.
- Authentication unchanged.
- Authorization unchanged.
- Required request fields accepted.
- Invalid requests rejected.
- Response envelope remains compatible.
- Required response fields remain present.
- Removed fields are genuinely unused.
- Error codes remain compatible.

---

# 35. Security test cases

## Authentication

### Test: unauthenticated order creation

Expected:

```text
401
```

No order created.

### Test: expired authentication

Expected:

```text
401
```

No order created.

---

## Authorization

### Test: customer reads another customer's order

Expected:

```text
403 or 404
```

according to the existing security convention.

Must not leak order data.

### Test: manufacturer reads unauthorized manufacturer's order

Expected:

```text
403 or 404
```

according to existing convention.

### Test: customer attempts admin endpoint

Expected:

```text
403
```

or existing equivalent.

---

# 36. Mass-assignment tests

Attempt:

```json
{
  "phone": "123",
  "role": "ADMIN",
  "permissions": ["*"],
  "isAdmin": true
}
```

Expected:

- normal allowed fields update if valid;
- privileged fields are ignored/rejected;
- authorization remains unchanged.

Do the same for:

- manufacturer;
- order;
- loyalty;
- product;
- inventory;
- user/profile.

---

# 37. Order security tests

Submit an order containing forged:

```json
{
  "price": 1,
  "costPrice": 0,
  "discount": 999999,
  "deliveryFee": 0,
  "amount": 1,
  "stockQuantity": 999999
}
```

Expected:

- server ignores/rejects untrusted calculated fields;
- authoritative server-side price is used;
- authoritative shipping fee is used;
- authoritative discount/loyalty rules are used;
- final amount is correct;
- no security bypass occurs.

---

# 38. Order correctness tests

### Valid order

Given:

```text
product exists
variant exists
stock sufficient
quantity valid
address valid
```

Expected:

- order created;
- stock updated exactly as before;
- totals match existing business rules;
- all existing side effects still occur.

### Insufficient stock

Expected:

```text
4xx
```

and:

- no invalid order;
- no incorrect stock reduction;
- no unintended side effects.

### Invalid product

Expected:

```text
4xx
```

No order created.

### Invalid variant

Expected:

```text
4xx
```

No order created.

### Quantity <= 0

Expected rejection.

### Quantity above allowed maximum

Expected rejection.

### Concurrent order

Run concurrent order attempts against limited stock.

Expected:

- no overselling;
- existing transactional guarantees preserved.

---

# 39. Loyalty regression tests

Given the same historical customer/order dataset, compare old and new implementation results for:

- total spend;
- total orders;
- current level;
- next level;
- progress percentage;
- remaining spend;
- remaining orders;
- active reward;
- reward eligibility;
- remaining uses;
- reward order limits.

The refactor must produce the same business result.

Only representation/payload size may change.

---

# 40. Response-shape tests

For each endpoint assert that:

### Required fields exist

```text
id
status
name
...
```

according to the endpoint contract.

### Unnecessary fields do not exist

Where the endpoint has deliberately been minimized, assert that large internal fields are absent.

Examples:

```text
costPrice
passwordHash
internalNotes
allVariants
unrelatedRelations
```

Do not assert absence of a field that remains required by a consumer.

---

# 41. Payload-size regression tests

For representative endpoints capture:

```text
before bytes
after bytes
```

Examples:

- product list;
- product detail;
- order creation request;
- order creation response;
- order list;
- order detail;
- loyalty summary;
- manufacturer order list;
- admin order list.

Target:

```text
after payload <= before payload
```

unless a documented feature requires otherwise.

Record actual measurements rather than making arbitrary percentage promises.

---

# 42. Database query tests

Where test infrastructure permits, assert:

- no unexpected extra queries;
- no N+1 queries;
- expected projection is used;
- pagination is enforced;
- authorization filter is included.

Example conceptual test:

```text
GET /orders
with 20 orders

Expected:
query count remains bounded
and does not become 21+ queries
```

Do not use an excessively rigid query-count assertion if the ORM legitimately changes query strategy. Prefer testing absence of pathological growth.

---

# 43. Pagination tests

Test:

```text
limit=10
limit=50
limit=999999
limit=-1
limit=abc
page=0
page=-1
```

Expected:

- valid values work;
- invalid values are rejected or normalized;
- maximum limit is enforced;
- no unbounded query occurs.

---

# 44. Include/expansion security tests

If the project introduces:

```text
?include=variants
```

test:

```text
?include=passwordHash
?include=internalNotes
?include=costPrice
?include=*
?include=unknown
```

Expected:

- unsupported/private expansions rejected or ignored according to documented behavior;
- no sensitive field becomes available.

---

# 45. Compatibility tests

For every frontend:

### Customer website

Test:

- login;
- product listing;
- product detail;
- search;
- cart;
- checkout;
- order placement;
- order history;
- order detail;
- loyalty;
- profile;
- address;
- reviews;
- social-media order flow.

### Manufacturer portal

Test:

- authentication;
- assigned products;
- inventory;
- orders;
- order status updates;
- relevant dashboards;
- manufacturer-specific permissions.

### Admin portal

Test:

- authentication;
- dashboard;
- users;
- products;
- categories;
- variants;
- manufacturers;
- orders;
- loyalty configuration;
- rewards;
- reports;
- settings;
- all CRUD flows.

No UI should break because a previously over-fetched field was removed.

---

# 46. Performance tests

For representative endpoints measure before/after:

```text
request size
response size
latency
DB query count
DB time
CPU where available
memory where available
```

At minimum test:

1. Product listing.
2. Product detail.
3. Loyalty summary.
4. Order listing.
5. Order detail.
6. Create order.
7. Manufacturer order listing.
8. Admin order listing.

Use realistic data sizes.

---

# 47. Load/scaling tests

If load testing infrastructure exists, run:

```text
10 concurrent requests
50 concurrent requests
100 concurrent requests
```

or the project's realistic levels.

Look for:

- response latency;
- database saturation;
- memory growth;
- connection exhaustion;
- serialization overhead.

Do not claim a specific scalability multiplier unless measured.

---

# 48. Functional equivalence strategy

For risky endpoints, implement a comparison test:

```text
same logical input
        ↓
old implementation
        ↓
normalized business result

same logical input
        ↓
new implementation
        ↓
normalized business result
```

Compare business meaning, not irrelevant representation.

Example:

Do NOT fail because:

```text
old response field order differs
```

Do fail if:

```text
old total = 1040
new total = 940
```

without a documented business-rule change.

---

# 49. Do not introduce accidental functionality changes

Do NOT:

- rename database fields unnecessarily;
- rename public API fields unnecessarily;
- alter enum values;
- alter status values;
- alter currency behavior;
- alter date semantics;
- alter timezone behavior;
- alter rounding;
- alter ordering;
- alter default filters;
- alter authorization;
- alter pagination semantics;
- alter sorting;
- alter loyalty calculations;
- alter stock behavior;
- alter payment behavior.

Payload optimization is not a license for cleanup unrelated to the objective.

---

# 50. Code quality requirements

Use:

- explicit DTOs;
- explicit allowlists;
- clear service boundaries;
- reusable serializers/mappers;
- database projections;
- existing validation mechanisms;
- existing error handling;
- existing authentication/authorization mechanisms.

Avoid:

- clever abstractions;
- generic magic serializers;
- reflection-heavy field filtering;
- dynamic unrestricted query builders;
- arbitrary client-controlled projections;
- duplicated validation;
- premature micro-optimizations.

Prefer boring, explicit, maintainable code.

---

# 51. Required final report

After implementation, produce a report containing:

## A. Endpoints changed

```text
METHOD
PATH
OLD PAYLOAD
NEW PAYLOAD
WHY
CONSUMERS VERIFIED
```

## B. Security changes

List:

- mass-assignment protections;
- server-side price validation;
- authorization protections;
- sensitive-field removal;
- IDOR protections;
- pagination limits;
- include allowlists.

## C. Performance results

Provide measured before/after values where available:

```text
Endpoint | Request bytes before | Request bytes after | Response bytes before | Response bytes after | Query behavior | Latency before | Latency after
```

Do not invent measurements.

## D. Compatibility results

```text
Customer portal: PASS/FAIL
Manufacturer portal: PASS/FAIL
Admin portal: PASS/FAIL
Social media order: PASS/FAIL
Loyalty: PASS/FAIL
Checkout: PASS/FAIL
```

## E. Tests

Report:

```text
Existing tests
New contract tests
Security tests
Order tests
Loyalty tests
Payload tests
Performance tests
Build tests
```

with actual results.

## F. Remaining risks

Explicitly list anything that could not be verified.

---

# 52. Acceptance criteria

The work is considered successful only if ALL are true:

- [ ] Existing features still work.
- [ ] All three portals still work.
- [ ] Social-media ordering still works.
- [ ] Loyalty functionality still works.
- [ ] Authentication is unchanged or stronger.
- [ ] Authorization is unchanged or stronger.
- [ ] Validation is unchanged or stronger.
- [ ] Client cannot forge authoritative prices/totals/stock/discounts.
- [ ] No sensitive internal fields are accidentally exposed.
- [ ] Database queries fetch only necessary data where safely possible.
- [ ] API responses contain only fields required by the consumer.
- [ ] API requests contain only fields required for the operation.
- [ ] List endpoints remain bounded/paginated where appropriate.
- [ ] No N+1 regression is introduced.
- [ ] No functionality is removed.
- [ ] No business rule is changed.
- [ ] No public contract is broken without a deliberate migration.
- [ ] Existing tests pass.
- [ ] New security tests pass.
- [ ] New contract tests pass.
- [ ] Payload-size measurements are collected.
- [ ] Performance measurements are collected where infrastructure permits.
- [ ] All changes are documented.
- [ ] No unverified performance claims are made.

---

# 53. Special instruction for vibe-coded codebases

Because this codebase was largely generated/iterated through AI/vibe coding, assume there may be:

- duplicated business logic;
- accidental API coupling;
- unused response fields;
- frontend dependence on undocumented fields;
- inconsistent validation;
- hidden consumers;
- redundant queries;
- accidental security holes;
- oversized DTOs;
- direct database entity serialization.

Therefore:

**Do not perform a broad rewrite.**

Use an incremental, evidence-driven approach.

For every field you remove from a request or response:

1. Search the repository.
2. Identify all consumers.
3. Verify runtime usage where possible.
4. Check tests.
5. Check documentation.
6. Check background jobs/integrations.
7. Check authorization implications.
8. Only then remove or isolate it.

---

# 54. Most important implementation principle

Do not confuse:

```text
"frontend doesn't display this field"
```

with:

```text
"backend does not need to fetch this field"
```

Both layers should be optimized.

The target architecture is:

```text
CLIENT INTENT
    ↓
minimal validated request DTO
    ↓
authorization
    ↓
business service
    ↓
minimal database projection
    ↓
business calculation
    ↓
minimal response DTO
    ↓
CLIENT
```

Not:

```text
CLIENT
    ↓
giant request
    ↓
giant database query
    ↓
full entity
    ↓
giant response
    ↓
frontend throws most of it away
```

---

# 55. Final instruction to the coding agent

**Think carefully before changing anything.**

Do not optimize by deleting fields randomly.

Do not optimize by trusting the client.

Do not optimize by bypassing validation.

Do not optimize by bypassing authorization.

Do not optimize by removing business logic.

Do not optimize by fetching everything and trimming the JSON afterward.

Do not optimize one portal while breaking another.

Do not optimize based on assumptions.

**Inspect → map dependencies → define minimal contracts → project at database level → validate → authorize → implement incrementally → test → measure → compare → only then finalize.**

The goal is not merely "smaller JSON."

The goal is:

> **Minimum necessary data movement and processing, with maximum preservation of security, correctness, compatibility, and existing functionality.**

When uncertain between a more aggressive optimization and a safer optimization, choose the safer one unless measurements and code evidence justify the aggressive change.
