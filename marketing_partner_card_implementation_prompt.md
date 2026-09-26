# Marketing Partner Card System — Implementation Prompt

## 0. Role and implementation standard

You are an AI software-development agent acting as a **senior full-stack engineer with 18+ years of practical software-development experience**, with precise, production-level knowledge of:

- Node.js
- React
- npm
- TypeScript/JavaScript as used by the existing repository
- REST/API design
- relational database design and migrations
- authentication/authorization
- transactions and concurrency control
- secure QR/token workflows
- testing and production-grade error handling

You are implementing a new **Marketing Partner Card System** inside an existing application.

### Critical instruction

**DO NOT REWRITE, REPLACE, OR BREAK THE CURRENT ARCHITECTURE.**

Before coding, inspect and understand the existing repository architecture, conventions, authentication, authorization, routing, database layer, API patterns, UI component system, sidebar/navigation, validation, error handling, logging, testing, and deployment assumptions.

The existing application is the source of truth.

You may:

- add new modules/features
- add new database tables/relations
- extend existing schemas where justified
- add migrations
- add new routes/pages/components/services
- add new permissions if the existing authorization architecture supports them
- refactor only when required for safe integration

You must **not**:

- replace the existing framework
- introduce a second ORM/database abstraction unnecessarily
- introduce a second authentication system
- duplicate existing user/order/manufacturer/customer models
- create parallel versions of existing services
- change unrelated business logic
- modify existing APIs unless integration genuinely requires it
- bypass existing authentication/authorization
- weaken existing security controls

The database may be reset during development, so schema design may be improved cleanly. Preserve compatibility with the application's current architecture and existing entities.

---

# 1. Product objective

Build the first version of a physical marketing-card distribution and redemption system.

A marketing partner can purchase/request cards targeted at:

- Nationwide
- Province
- District

The admin generates/manages cards and assigns batches of cards to manufacturers.

Manufacturers receive physical cards and must confirm receipt.

When a manufacturer fulfills an eligible online clothing order, the manufacturer must attach a valid marketing card before the order can proceed to final fulfillment.

The card is ultimately linked to the customer who received it.

Only an authenticated/logged-in customer can activate/access the card.

The customer can then view available benefits.

When a customer redeems/collects a benefit, **that customer benefit becomes redeemed**. The physical card must NOT be globally destroyed or made unusable for legitimate marketing-partner validation/history.

Marketing-partner portal is **NOT part of this implementation**.

For now implement:

1. Admin functionality
2. Manufacturer functionality
3. Customer frontend functionality required for card activation/benefits
4. Backend/API/database/security supporting the above

Do not implement a Marketing Partner Portal yet.

---

# 2. Existing architecture protection

Before changing anything, inspect:

## Backend

- package.json
- npm scripts
- Node version
- TypeScript configuration, if applicable
- application entry points
- route organization
- controller/service/repository architecture
- ORM/query builder
- database schema/migrations
- authentication middleware
- authorization/RBAC
- session/JWT handling
- existing user/customer/manufacturer/admin models
- order/fulfillment models
- order status transitions
- validation library
- error handling
- logging/audit mechanisms
- transaction utilities
- test framework
- API response conventions

## Frontend

- React version
- routing
- authentication state
- current layout
- sidebar architecture
- admin layout
- manufacturer layout
- customer layout
- existing design system/component library
- forms
- API client
- state management
- notification/toast system
- loading/error patterns
- responsive/mobile behavior
- QR scanner capabilities already present
- permission/role guards

## Mandatory discovery output

Before coding, document:

```text
Current architecture:
Backend:
Frontend:
Database:
Authentication:
Authorization:
Orders:
Manufacturer:
Customer:
Admin:
Existing reusable components:
Existing reusable services:
Existing testing:
Potential integration points:
Potential risks:
```

Do not start implementation until this inspection is complete.

---

# 3. Core domain principles

## 3.1 Card code vs internal identity

A human-readable card code may look like:

`AAMA-NAT-001B00001`

Example:

```text
AAMA-NAT-001B00001
│    │   │  │ │
│    │   │  │ └── sequence/card number
│    │   │  └──── buffer/separator/security-friendly segment
│    │   └────── marketing partner identifier
│    └────────── geography/campaign scope
└─────────────── platform/brand prefix
```

Possible geographic codes:

- `NAT` = nationwide
- `GAN` = Gandaki
- `SUD` = Sudurpashchim
- `PAR` = Parbat
- etc.

However:

**Do not use the visible card code as the database primary key.**

Use an internal immutable ID, preferably the existing database ID strategy or UUID strategy already used by the application.

Example conceptual model:

```text
Card
- id
- cardCode
- campaignId
- marketingPartnerId
- geographyId / targeting metadata
- manufacturerId
- status
- createdAt
- updatedAt
```

The application must rely on relational IDs, not parsing strings.

The visible card code is a human-facing reference.

---

# 4. QR security model

The QR code must NOT expose sensitive customer/order information.

Do not encode:

- customer ID
- customer name
- phone number
- order details
- benefit details
- private database IDs if avoidable

The QR should resolve through a secure opaque token.

Conceptually:

```text
QR
  ↓
opaque random token
  ↓
authenticated backend request
  ↓
card lookup
```

Use a cryptographically secure random token.

Do not use predictable incremental values as QR secrets.

The visible serial/card code and QR security token are separate concepts.

---

# 5. Absolute authentication rule

## ONLY LOGGED-IN USERS MAY SCAN/ACTIVATE/VALIDATE CARDS

This is a hard security requirement.

### Customer

Only an authenticated customer can:

- open card activation functionality
- associate a card with their account
- activate a card
- scan/resolve the QR for their own card
- view benefits
- redeem benefits

### Manufacturer

Only an authenticated, authorized manufacturer user can:

- view their assigned card inventory
- confirm card receipt
- attach a card to an eligible order
- scan/enter a card during fulfillment

### Admin

Only an authenticated, authorized admin can:

- create/manage marketing partners
- create card campaigns/batches
- allocate cards
- assign cards to manufacturers
- monitor card flow
- override statuses where explicitly authorized

### Unauthenticated user

Must receive no card details.

An unauthenticated request to a QR endpoint must be rejected.

Do not rely only on frontend route hiding.

Backend authorization is mandatory.

---

# 6. Card lifecycle

Separate **physical/operational card lifecycle** from **customer benefit lifecycle**.

Do NOT represent all states using one overloaded status field.

## 6.1 Physical/operational card lifecycle

Suggested states:

```text
GENERATED
PRINTED
ASSIGNED_TO_MANUFACTURER
RECEIVED_BY_MANUFACTURER
AVAILABLE
RESERVED_FOR_ORDER
PACKED
DELIVERED
CANCELLED
```

Use only states that fit the existing order/fulfillment architecture.

## 6.2 Customer activation lifecycle

Suggested:

```text
NOT_LINKED
LINKED
ACTIVE
```

## 6.3 Benefit lifecycle

Each benefit should have its own redemption state:

```text
AVAILABLE
REDEEMED
EXPIRED
CANCELLED
```

### Critical rule

A customer redeeming one benefit does NOT necessarily invalidate the entire card.

Example:

```text
Card AAMA-NAT-001B00001

Benefit 1 → REDEEMED
Benefit 2 → AVAILABLE
Benefit 3 → AVAILABLE
```

This supports future multi-benefit campaigns.

---

# 7. Recommended data model

Adapt names/types to the existing ORM/database conventions.

## MarketingPartner

```text
id
code
name
description
contact information as appropriate
status
createdAt
updatedAt
```

Partner ID/code may be used in card-code generation, but the database relation must be authoritative.

## MarketingCampaign

Represents a partner's campaign/request.

```text
id
marketingPartnerId
name
description
targetScopeType
targetProvinceId nullable
targetDistrictId nullable
targetMunicipalityId nullable if current system supports it
benefit configuration
requestedQuantity
generatedQuantity
status
startAt
endAt
createdAt
updatedAt
```

Scope examples:

```text
NATIONWIDE
PROVINCE
DISTRICT
```

Do not hard-code province/district names into business logic.

Use the application's existing geographic entities if they exist.

## MarketingCardBatch

A batch helps manage printing/distribution.

```text
id
campaignId
batchCode
quantity
printMethod
status
createdAt
updatedAt
```

## MarketingCard

One physical card = one record.

```text
id
cardCode
qrTokenHash or equivalent secure representation
campaignId
batchId
marketingPartnerId
assignedManufacturerId nullable
physicalStatus
customerActivationStatus
assignedOrderId nullable
customerId nullable
assignedAt nullable
receivedAt nullable
packedAt nullable
activatedAt nullable
createdAt
updatedAt
```

Do not duplicate relations unnecessarily if they can be derived safely, but keep the schema optimized for audit/reporting where justified.

## MarketingCardAssignment

Use an assignment/history table if the existing architecture supports audit/history cleanly.

```text
id
cardId or batchId
manufacturerId
assignedBy
assignedAt
quantity if batch assignment
status
confirmedAt
```

If assigning individual cards is too large at national scale, use batch allocation plus individual inventory records. Design for scale.

## MarketingCardReceipt

Track manufacturer receipt confirmation.

```text
id
manufacturerId
batchId or assignmentId
confirmedBy
confirmedAt
receivedQuantity
notes
```

If individual discrepancies matter, support card-level discrepancy records.

## CustomerCard

Represents customer linkage.

```text
id
cardId
customerId
orderId
linkedAt
activatedAt
status
```

Enforce one active customer association per physical card unless a future business rule explicitly allows otherwise.

## MarketingBenefit

```text
id
campaignId
name
description
benefitType
benefitValue
terms
startsAt
expiresAt
status
```

## CardBenefit

If benefits must be snapshotted/assigned per card:

```text
id
cardId
benefitId
status
redeemedAt nullable
redeemedBy/customer or partner actor as appropriate
```

Otherwise use a campaign-benefit relationship and create redemption records.

## BenefitRedemption

Strongly recommended.

```text
id
cardId
customerId
benefitId
marketingPartnerId
redeemedAt
validationMethod
status
metadata
```

Enforce the correct uniqueness constraint, e.g. one successful redemption per card + benefit unless campaign rules explicitly allow otherwise.

## AuditLog

Reuse the existing audit mechanism if present.

Record sensitive lifecycle changes:

- card generation
- batch creation
- assignment
- manufacturer receipt confirmation
- card reservation
- card attachment to order
- customer linking
- activation
- benefit redemption
- cancellation
- administrative override

---

# 8. Card-code generation

Support the desired human-readable format:

```text
AAMA-NAT-001B00001
```

Do not derive authorization from the format.

The generator should:

1. obtain the campaign
2. determine geography code
3. determine marketing partner code
4. generate unique card code
5. generate secure QR token
6. persist the card
7. ensure uniqueness at database level

Never trust a client-provided card code.

Use database uniqueness constraints.

Handle concurrent generation safely.

---

# 9. QR/token rules

The QR token must be:

- cryptographically random
- sufficiently long
- unguessable
- unique
- revocable
- not based solely on the visible serial number

Prefer storing a secure hash of the token if compatible with the application's architecture.

The QR should resolve only after authentication.

Do not create a public endpoint that returns card/customer/benefit information merely because someone possesses the QR.

---

# 10. Admin feature

Create a **separate Marketing Partner section/sidebar group** in the existing admin navigation.

Do NOT redesign the existing admin sidebar.

Add a separate group such as:

```text
Marketing Partners
    Dashboard
    Partners
    Campaigns
    Card Batches
    Card Inventory
    Manufacturer Assignments
    Card Flow
```

Use naming consistent with the existing application.

## Admin capabilities

### Partners

- create partner
- edit partner
- activate/deactivate partner
- view partner details
- view campaigns

### Campaigns

Admin can create a campaign with:

- marketing partner
- campaign name
- geography scope
- benefit(s)
- quantity
- validity
- status

### Card generation

Admin can generate cards based on campaign demand.

Support:

- requested quantity
- target geography
- partner
- batch
- printable/exportable card data if existing printing architecture allows

### Assignment to manufacturers

Admin can:

- select manufacturer
- select campaign/batch
- assign quantity or specific card range
- view current manufacturer inventory
- see unassigned inventory
- see received inventory
- see discrepancies

### Monitoring

Show lifecycle counts:

```text
Generated
Printed
Assigned
Received
Available
Reserved
Packed
Delivered
Activated
Redeemed
Cancelled
```

Use separate physical/customer/benefit metrics where necessary.

---

# 11. Manufacturer feature

Add the feature to the existing manufacturer page/layout.

Do not create a separate application.

## Manufacturer card inventory

Show only cards assigned to that manufacturer.

Filters:

- campaign
- partner
- geography
- status
- date

## Receipt confirmation

Manufacturer must confirm cards received.

Confirmation must be authenticated and authorized.

Do not allow manufacturer A to confirm manufacturer B's cards.

If quantity/batch mismatch exists, provide a discrepancy workflow rather than silently changing records.

## Order fulfillment integration

When an eligible order reaches the manufacturer's packaging/fulfillment step:

Show:

```text
Marketing Card
[Required/Optional according to campaign/order rules]
```

If required:

- manufacturer must provide a valid card
- manufacturer may scan QR OR enter serial number
- backend validates ownership/status/order eligibility
- card is reserved/attached transactionally
- fulfillment cannot proceed without successful attachment

Do not rely on the frontend checkbox for enforcement.

The final fulfillment API/service must independently verify the requirement.

## Validation rules

When manufacturer attaches a card:

```text
authenticated manufacturer?
        ↓
manufacturer authorized for order?
        ↓
card exists?
        ↓
card belongs to this manufacturer?
        ↓
manufacturer has confirmed receipt?
        ↓
card available?
        ↓
campaign valid?
        ↓
geography/order eligibility valid?
        ↓
card not already attached?
        ↓
reserve/attach transactionally
```

If any check fails, reject.

---

# 12. Customer frontend

Add a customer-facing entry point using the existing customer navigation.

Example:

```text
My Marketing Cards
```

The customer must be logged in.

## Customer flow

### Step 1

Customer logs in.

### Step 2

Customer opens:

```text
Marketing Cards
```

### Step 3

Customer enters the card serial number.

Example:

```text
AAMA-NAT-001B00001
```

### Step 4

Backend verifies:

- authenticated customer
- card exists
- card was actually attached to a delivered/eligible order
- card belongs to that order's customer
- card isn't already linked to another customer
- card is not cancelled
- campaign is valid as required

### Step 5

Link card to customer.

### Step 6

Only after successful linking should the QR scanner be made available if the UX requires QR scanning.

The frontend must not simply unlock the scanner based on local state.

The backend remains authoritative.

---

# 13. Customer QR scanner

Only render/enable scanner for an authenticated customer.

Recommended flow:

```text
Login
  ↓
Marketing Cards
  ↓
Enter card serial
  ↓
Backend verifies ownership/eligibility
  ↓
Card linked
  ↓
Authenticated QR scan
  ↓
Backend resolves token
  ↓
Verify authenticated user owns/has access to card
  ↓
Show card/benefits
```

If a QR is scanned by the wrong authenticated user:

```text
403 Forbidden
```

Do not leak:

- owner name
- phone
- order number
- benefit details
- partner information beyond what is necessary

---

# 14. Benefit redemption

Customer sees:

```text
Available Benefits
```

Each benefit shows:

- partner
- benefit title
- discount/value
- terms
- expiry
- redemption status

When customer redeems:

Use a backend transaction.

The server must re-check:

- authenticated customer
- card ownership
- benefit ownership/eligibility
- campaign validity
- benefit not already redeemed
- redemption not expired/cancelled

Then create the redemption record.

Do not trust frontend status.

Use database constraints/transactions to prevent double redemption under concurrent requests.

---

# 15. Marketing partner validation — backend support only for now

Do NOT build the marketing partner portal.

However, design the backend/data model so that a future partner portal can:

- scan/validate a card
- verify card authenticity
- determine whether the relevant benefit is available/redeemed
- record redemption
- view campaign analytics later

Do not expose partner APIs publicly unless authenticated and authorized.

If a partner-scanning endpoint is implemented now for future readiness, keep it disabled/unreachable from public routes until partner authentication exists.

---

# 16. Privacy requirements

Marketing partners should not automatically receive unnecessary customer data.

Do not expose full:

- phone number
- address
- complete order information
- customer identity
- purchase history

unless required by an explicit business operation and authorized.

Use data minimization.

For future partner dashboards, prefer:

```text
campaign metrics
activation counts
redemption counts
geographic aggregates
```

over unrestricted customer-level data.

If customer-level redemption information is later required, expose only the minimum fields necessary.

---

# 17. Authorization requirements

Create/extend permissions using the existing authorization system.

Suggested conceptual permissions:

```text
MARKETING_PARTNER_VIEW
MARKETING_PARTNER_MANAGE
MARKETING_CAMPAIGN_MANAGE
MARKETING_CARD_GENERATE
MARKETING_CARD_ASSIGN
MARKETING_CARD_MONITOR
MANUFACTURER_MARKETING_CARD_VIEW
MANUFACTURER_MARKETING_CARD_RECEIVE
MANUFACTURER_MARKETING_CARD_ATTACH
CUSTOMER_MARKETING_CARD_VIEW
CUSTOMER_MARKETING_CARD_ACTIVATE
CUSTOMER_MARKETING_CARD_REDEEM
```

Do not blindly create these exact names if the existing application uses another permission convention.

Map them into the existing RBAC/authorization architecture.

---

# 18. API security

Every sensitive API must perform authorization server-side.

Never rely on:

- hidden buttons
- disabled buttons
- route visibility
- frontend role checks
- client-supplied manufacturer/customer IDs
- client-supplied partner IDs
- client-supplied card ownership

Derive identity from the authenticated session/token.

For example, do not trust:

```json
{
  "customerId": "123"
}
```

when the authenticated identity is available from the server.

Use the authenticated principal.

---

# 19. Concurrency and transactions

Card assignment and redemption are concurrency-sensitive.

Use transactions for:

### Manufacturer attachment

```text
begin transaction
lock/check card
verify ownership/status
verify order
reserve card
attach card to order
write audit record
commit
```

### Customer activation

```text
begin transaction
check card
check existing customer link
create link
activate
audit
commit
```

### Benefit redemption

```text
begin transaction
check benefit/card/customer
ensure not already redeemed
create redemption
update benefit status
audit
commit
```

Database uniqueness constraints must supplement application checks.

Never assume a frontend validation prevents race conditions.

---

# 20. API design

Follow the existing API style.

Conceptual endpoints may include:

```text
GET    /admin/marketing-partners
POST   /admin/marketing-partners
PATCH  /admin/marketing-partners/:id

GET    /admin/marketing-campaigns
POST   /admin/marketing-campaigns
PATCH  /admin/marketing-campaigns/:id

POST   /admin/marketing-cards/batches
GET    /admin/marketing-cards
GET    /admin/marketing-cards/:id

POST   /admin/marketing-card-assignments
GET    /admin/marketing-card-assignments

POST   /manufacturer/marketing-cards/:batchId/receive
GET    /manufacturer/marketing-cards
POST   /manufacturer/orders/:orderId/marketing-card

POST   /customer/marketing-cards/link
GET    /customer/marketing-cards
POST   /customer/marketing-cards/:id/activate
POST   /customer/marketing-cards/scan
POST   /customer/marketing-cards/:id/benefits/:benefitId/redeem
```

These are examples only.

Use existing route naming conventions.

Do not duplicate existing order endpoints if the application already has an appropriate fulfillment endpoint.

---

# 21. Validation

Use the project's existing validation library.

Validate:

- card code format
- quantity limits
- campaign dates
- geography scope
- manufacturer authorization
- card ownership
- order eligibility
- benefit validity
- redemption status
- authentication
- authorization

Return safe errors.

Do not leak internal database information.

---

# 22. Auditability

Every important card transition should be traceable.

Example:

```text
CARD_CREATED
CARD_PRINTED
CARD_ASSIGNED_TO_MANUFACTURER
CARD_RECEIPT_CONFIRMED
CARD_RESERVED_FOR_ORDER
CARD_PACKED
CARD_DELIVERED
CARD_LINKED_TO_CUSTOMER
CARD_ACTIVATED
BENEFIT_REDEEMED
CARD_CANCELLED
```

Use the existing audit system if available.

Include:

- actor
- actor role
- timestamp
- entity
- action
- previous state
- new state
- relevant reference IDs

Do not log secrets such as raw QR tokens.

---

# 23. Frontend UX requirements

Use existing UI components/styles.

Do not introduce a separate design language.

All pages need:

- loading states
- empty states
- error states
- success feedback
- confirmation for destructive actions
- responsive behavior
- accessibility
- permission-aware rendering

For card assignment, show enough information to prevent operator mistakes:

```text
Partner
Campaign
Geography
Batch
Quantity
Manufacturer
Current assignment
Remaining quantity
```

For manufacturer inventory:

```text
Card code
Campaign
Partner
Geography
Status
Assigned date
```

For customer:

```text
Card
Partner
Campaign
Available benefits
Redeemed benefits
Expiry
```

---

# 24. Implementation strategy: iterative development

Do NOT attempt the entire feature in one giant implementation.

Work in small, independently verifiable phases.

After each phase:

1. inspect changed files
2. run formatting
3. run lint
4. run type checks
5. run relevant tests
6. run build
7. verify no unrelated behavior changed
8. document what was completed
9. identify remaining risks

Do not continue if the current phase has failing critical tests.

---

# PHASE 0 — Repository discovery

### Tasks

- inspect repository
- understand architecture
- identify existing auth/RBAC
- identify existing entities
- identify database conventions
- identify order/fulfillment lifecycle
- identify frontend layouts
- identify reusable components
- identify tests

### Deliverable

Create:

```text
docs/marketing-card-architecture.md
```

containing the current architecture and proposed integration points.

### Acceptance criteria

- no code changes that alter behavior
- architecture understood
- integration points documented

---

# PHASE 1 — Domain/database design

### Tasks

Design:

- MarketingPartner
- MarketingCampaign
- MarketingCardBatch
- MarketingCard
- manufacturer assignment/receipt history
- customer-card linkage
- MarketingBenefit
- redemption
- audit integration

Add database constraints and indexes.

### Important indexes/constraints

At minimum consider:

- unique cardCode
- unique QR token/hash
- unique active customer-card relationship
- unique successful redemption per card + benefit where appropriate
- manufacturer/card lookup indexes
- campaign/geography indexes
- status indexes

### Acceptance criteria

- schema reviewed
- migration works
- reset/reseed works
- constraints prevent duplicate cards/redemptions
- existing application schema remains functional

---

# PHASE 2 — Backend card generation

### Tasks

- campaign creation
- batch creation
- card generation
- card code generation
- secure QR token generation
- inventory APIs
- backend validation
- authorization
- audit events

### Tests

- generates unique cards
- duplicate generation prevented
- correct campaign/partner/geography association
- secure token generation
- unauthorized requests rejected

---

# PHASE 3 — Admin Marketing Partner module

### Tasks

Add a separate sidebar group in the existing admin UI.

Implement:

- partner CRUD
- campaign CRUD
- card batch generation
- card inventory
- manufacturer assignment
- assignment history
- monitoring

### Acceptance criteria

Admin can:

```text
Create partner
→ create campaign
→ generate cards
→ assign cards/batch to manufacturer
→ monitor assignment/receipt/status
```

No existing admin navigation is broken.

---

# PHASE 4 — Manufacturer card inventory and receipt

### Tasks

Implement manufacturer UI:

- assigned cards
- batches
- receipt confirmation
- discrepancy handling
- inventory status

### Security

Manufacturer can only access its own assignments.

### Acceptance criteria

Manufacturer A cannot:

- view Manufacturer B's cards
- confirm Manufacturer B's cards
- attach Manufacturer B's cards
- manipulate another manufacturer's inventory

---

# PHASE 5 — Order fulfillment integration

### Tasks

Integrate card attachment into the existing manufacturer fulfillment workflow.

Do not duplicate the order system.

Determine eligibility from the existing order/customer/manufacturer data.

### Requirements

If marketing card is required:

```text
Manufacturer cannot complete fulfillment
until a valid card is attached.
```

Validation happens server-side.

### Acceptance tests

- valid card accepted
- wrong manufacturer rejected
- already-used card rejected
- cancelled card rejected
- unreceived card rejected
- card already attached to another order rejected
- wrong/invalid campaign rejected
- concurrent attachment cannot double-book a card

---

# PHASE 6 — Customer card activation

### Tasks

Add customer page/navigation.

Implement:

- enter card serial
- backend verification
- customer-card linking
- activation
- card list
- benefits list

### Security tests

- anonymous request rejected
- customer A cannot link customer B's card
- customer A cannot view customer B's card
- customer cannot activate a card not delivered/eligible to them
- already-linked card cannot be hijacked

---

# PHASE 7 — Authenticated QR scanning

### Tasks

- integrate existing QR scanner if available
- otherwise add the smallest compatible scanner dependency
- only expose scanner to authenticated customers
- resolve secure QR token
- verify customer/card relationship
- show safe result

### Important

A QR scan must never become a public information endpoint.

Test:

```text anonymous scan → reject
wrong authenticated customer → reject
correct authenticated customer → success
manufacturer → only if authorized endpoint exists
```

---

# PHASE 8 — Benefit redemption

### Tasks

- benefit display
- benefit eligibility
- redemption transaction
- redemption history
- audit

### Concurrency test

Two simultaneous redemption requests must result in:

```text
exactly one successful redemption
```

unless campaign rules explicitly allow more.

---

# PHASE 9 — Hardening

Perform:

- authorization review
- IDOR testing
- CSRF protection review if applicable
- XSS review
- injection review
- rate limiting review
- QR brute-force protection
- token secrecy review
- sensitive-data exposure review
- logging review
- audit review
- transaction/concurrency review

Test every object ID with another user's/manufacturer's ID.

---

# PHASE 10 — Final integration verification

Run:

```text
install
lint
typecheck
unit tests
integration tests
frontend tests
backend tests
production build
database reset/migration
seed
```

Then manually test the complete flow.

---

# 25. End-to-end acceptance test

The complete happy path must work:

```text
Admin logs in
 ↓
Creates marketing partner
 ↓
Creates campaign
 ↓
Sets geography
 ↓
Defines benefit
 ↓
Generates card batch
 ↓
Assigns cards to Manufacturer A
 ↓
Manufacturer A logs in
 ↓
Confirms receipt
 ↓
Customer places eligible order
 ↓
Manufacturer receives/fulfills order
 ↓
Manufacturer selects Add Marketing Card
 ↓
Manufacturer scans/enters card
 ↓
Backend verifies card belongs to Manufacturer A
 ↓
Card attached to order
 ↓
Order delivered
 ↓
Customer logs in
 ↓
Customer enters card code
 ↓
Backend verifies customer/order/card relationship
 ↓
Card linked
 ↓
Authenticated customer scans QR
 ↓
Benefits appear
 ↓
Customer redeems benefit
 ↓
Redemption recorded
 ↓
Customer sees benefit as redeemed
 ↓
Card remains historically valid
 ↓
Future authorized partner validation can identify
the card and redemption state
```

---

# 26. Negative/security acceptance tests

The implementation is NOT complete until these cases are tested.

## Authentication

- logged-out customer cannot access card data
- logged-out user cannot scan QR
- logged-out user cannot redeem
- logged-out manufacturer cannot access inventory
- logged-out admin cannot manage cards

## Authorization

- customer A cannot access customer B's card
- manufacturer A cannot access manufacturer B's cards
- manufacturer cannot assign cards
- manufacturer cannot change assignment ownership
- customer cannot act as manufacturer/admin
- ordinary admin without permission cannot perform restricted operations if RBAC supports granular permissions

## Card ownership

- wrong manufacturer card rejected
- unreceived card rejected
- cancelled card rejected
- already attached card rejected
- card attached to another order rejected

## Customer linking

- card belonging to another customer cannot be linked
- same card cannot be linked twice
- customer cannot self-assign an arbitrary available warehouse card

## QR

- random QR token cannot be guessed practically
- invalid token rejected
- expired/cancelled token rejected
- QR does not expose private data
- wrong authenticated customer rejected

## Redemption

- already redeemed benefit cannot be redeemed twice
- concurrent redemption cannot double redeem
- expired benefit cannot be redeemed
- wrong customer's benefit cannot be redeemed

## Input/security

- SQL/NoSQL injection tests as applicable
- XSS payloads rejected/safely escaped
- malformed card codes rejected
- extreme quantities rejected
- unauthorized object IDs rejected

---

# 27. Do not over-engineer

The first release does NOT need:

- marketing partner portal
- complex analytics dashboard for partners
- predictive analytics
- recommendation engine
- external CRM integration
- payment integration for marketing cards
- unnecessary microservices
- event-driven architecture unless the existing system already uses it
- a second authentication system
- a second database
- a separate frontend application

Build a clean modular feature inside the current monolith/application architecture unless the repository already uses another architecture.

---

# 28. Future extensibility

Design cleanly so later versions can add:

- marketing partner portal
- partner QR validation
- redemption validation at physical businesses
- campaign analytics
- province/district reports
- weekly/monthly/yearly reports
- partner-level customer engagement
- multiple benefits per card
- benefit-specific redemption limits
- campaign budgets
- card expiration
- stolen-card reporting
- card replacement
- manufacturer discrepancy management
- print-provider integration

Do not implement these now unless required by the current architecture.

---

# 29. Reporting foundation

Even though the marketing partner portal is not being built now, store enough structured data to later answer:

- how many cards generated?
- how many assigned?
- how many received?
- how many packed?
- how many delivered?
- how many activated?
- how many benefits redeemed?
- by partner?
- by campaign?
- by province?
- by district?
- by manufacturer?
- by week/month/year?

Do not attempt to reconstruct these metrics from unstructured logs later.

---

# 30. Code-quality requirements

Follow existing repository standards.

Prefer:

- small services
- clear domain boundaries
- typed DTOs
- schema validation
- centralized authorization
- transaction boundaries
- reusable components
- explicit error handling
- meaningful names
- tests close to business rules

Avoid:

- giant controllers
- business logic in React components
- business logic in route definitions
- duplicated validation
- client-side-only security
- hidden state transitions
- magic strings
- hard-coded geographic mappings
- hard-coded manufacturer IDs
- hard-coded partner IDs

---

# 31. Definition of done

The feature is complete only when:

- [ ] Existing architecture remains intact
- [ ] Existing authentication is reused
- [ ] Existing authorization is reused/extended safely
- [ ] Admin Marketing Partner sidebar section exists
- [ ] Admin can manage partners
- [ ] Admin can create campaigns
- [ ] Admin can generate cards
- [ ] Admin can assign cards to manufacturers
- [ ] Admin can monitor card lifecycle
- [ ] Manufacturer can view assigned cards
- [ ] Manufacturer can confirm receipt
- [ ] Manufacturer can attach a valid card to an eligible order
- [ ] Server prevents invalid card attachment
- [ ] Customer can access marketing cards only while authenticated
- [ ] Customer can link only a card legitimately delivered to them
- [ ] QR scanning requires authentication
- [ ] QR token is secure and opaque
- [ ] Wrong customer cannot use another customer's card
- [ ] Benefits are displayed correctly
- [ ] Redemption is transactional
- [ ] Double redemption is prevented
- [ ] Card history remains available after redemption
- [ ] Sensitive customer information is not unnecessarily exposed
- [ ] Audit trail exists
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Security tests pass
- [ ] Build passes
- [ ] No unrelated feature regressions detected

---

# 32. Required agent workflow

For every implementation phase, report:

## Before coding

```text
What I inspected:
What I found:
What I will reuse:
What I need to add:
Potential risks:
```

## After coding

```text
Files changed:
Database changes:
API changes:
UI changes:
Security controls:
Tests added:
Tests executed:
Results:
Known limitations:
```

Do not silently make architectural changes.

If the existing architecture conflicts with this specification, stop and explain the conflict before making a major architectural decision.

When two designs are possible, prefer the one that:

1. preserves existing architecture
2. minimizes new dependencies
3. preserves security
4. preserves data integrity
5. is easiest to test
6. is easiest to maintain
7. supports future marketing-partner functionality

---

# 33. Final instruction to the AI agent

Treat this as a production system, not a demo.

The most important properties are:

**security > data integrity > architectural compatibility > correctness > maintainability > convenience**

Never sacrifice authentication or authorization for UX convenience.

Never trust client-provided ownership.

Never expose customer data through QR endpoints.

Never allow card double-assignment.

Never allow benefit double-redemption.

Never bypass the existing order/fulfillment workflow.

Never rewrite the existing architecture merely to make this feature easier to implement.

Build the feature incrementally and prove each phase works before continuing.

The database may be reset, so take the opportunity to create a clean relational model with strong constraints, indexes, and auditability.

The Marketing Partner Portal is explicitly out of scope for this release, but the backend/data model must be designed so it can be added later without redesigning the card lifecycle.
