# Marketing Card Architecture

## Current architecture

- Backend: Express.js ES modules with Prisma 5 and MySQL.
- Database: UUID primary keys and relational Prisma models.
- Authentication: customer JWTs expose `req.userId`; manufacturer JWTs expose `req.manufacturerId`; admin JWTs expose `req.adminId` and `role: admin`.
- Authorization: route middleware plus controller ownership checks. There is no granular permission table yet.
- Fulfillment: `OrderAssignment` controls manufacturer workflow. `prepareReadyDelivery` is the server-side boundary immediately before delivery submission.
- Frontends: separate Vite React applications for admin, manufacturer, and customer experiences.
- Audit: no generic audit model exists. Marketing card lifecycle events will use a dedicated event table.

## Confirmed business rules

1. There are currently no production records to preserve.
2. Every normal online order requires a marketing card before manufacturer packaging/delivery handoff.
3. Admin assigns card inventory to manufacturers using campaign demand and location analysis.
4. A manufacturer randomly selects a card from its own received and available inventory for an order.
5. Customer activation and benefits are designed for a later slice; this implementation keeps card ownership and assignment data ready for it.

## Data integrity design

- Internal UUIDs are separate from visible card codes.
- QR secrets are cryptographically random and stored as SHA-256 hashes.
- Card codes and QR hashes are unique at the database level.
- A card can belong to only one manufacturer assignment and one order.
- Manufacturer receipt is explicit; unreceived cards cannot be reserved.
- Card reservation and order attachment happen in one database transaction.
- Lifecycle events do not store raw QR tokens.

## Integration points

- Admin APIs use existing `authAdmin` middleware.
- Manufacturer APIs use existing `authManufacturer` middleware and derive manufacturer identity from the token.
- Existing `OrderAssignment` and delivery flow are preserved.
- `prepareReadyDelivery` independently verifies that a required card is attached before creating or resubmitting a delivery order.
- Admin and manufacturer navigation receive focused additions without changing their authentication or application shells.

## Planned flow

```text
Admin creates campaign and batch
  -> cards are generated with opaque QR secrets
  -> admin assigns cards to a manufacturer
  -> manufacturer confirms receipt
  -> manufacturer views received inventory
  -> manufacturer selects a card for an assigned order
  -> transaction reserves card and attaches it to order
  -> existing packaging/delivery handoff validates the attachment again
```

## Risks and controls

- Bypassing the UI: server-side ownership and status checks are mandatory.
- Double booking: unique order/card relations plus transactions prevent it.
- Lost or unreceived stock: receipt status gates availability.
- Partial delivery failure: card attachment occurs before delivery handoff and remains auditable.
- Existing fulfillment behavior: the new requirement is isolated to card validation and does not replace the current state machine.
