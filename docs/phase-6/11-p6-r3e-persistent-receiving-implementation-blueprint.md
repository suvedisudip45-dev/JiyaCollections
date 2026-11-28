# P6-R3E - Persistent Receiving Implementation Blueprint

**Status:** COMPLETE - IMPLEMENTATION-BLUEPRINT AND READINESS PACKAGE ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3B:** COMPLETE - EXISTING-SCHEMA LOCATION/RBAC FOUNDATION
**P6-R3C:** COMPLETE - STATIC RECEIVING CONTRACT AND DATABASE-INDEPENDENT VALIDATION
**P6-R3D:** COMPLETE - STATIC RECEIPT EVIDENCE/PERSISTENCE READINESS
**P6-R3:** INCOMPLETE
**Generic warehouse/supplier receiving:** NOT IMPLEMENTED
**Existing stock-transfer receipt:** PERSISTED ROUTE EXISTS; additional hardening remains
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Verified current code state

R3A is an application-layer foundation, not a database-validated implementation:

- `backend/services/inventoryLedgerService.js` normalizes exact quantities,
  validates movement/location rules and calls `applyInventoryMovement`.
- The helper updates `InventoryBalance` and creates `InventoryLedgerEntry`
  within the caller's transaction.
- Exact idempotency replay and conflict checks are implemented.
- Real database concurrency, rollback and isolation have not been verified.

R3B provides profile-linked manufacturer/distributor location checks and a
reusable `locationScope` helper. It does not provide:

- Persisted account-to-warehouse assignment.
- Warehouse hierarchy or bin models.
- Proposed warehouse permission identifiers.
- Database-enforced location isolation.

R3C supplies a pure receiving validator:

- Lifecycle transitions.
- Exact whole-unit normalization.
- Inspection disposition reconciliation.
- Put-away quantity and location authorization checks.
- No Prisma, filesystem, network, accounting or inventory mutation.

R3D confirmed that short/outstanding quantity is separate from put-away. The
remaining dispatched quantity is calculated as
`dispatched - previously received - current arrived`, without subtracting
put-away.

No universal persistent goods-receipt model exists. The repository has bounded
persistent receipt implementations for stock transfers and distributor stock
returns. P6-R3E's "not implemented" status refers to a generic warehouse or
supplier receiving lifecycle, not the existing stock-transfer receipt route.
Supplier PO/GRN and invoice matching are missing.

## 2. Existing receiving persistence and transaction patterns

### Stock-transfer receipt

Source:

- `StockTransfer`
- `StockTransferLine`
- `StockTransferShipment`
- `StockTransferShipmentLine`
- `StockTransferReceipt`
- `StockTransferReceiptLine`
- `InventoryDiscrepancy`
- `InventoryLedgerEntry`

Route:

- `POST /api/stock-transfers/shipments/:shipmentId/receipt`
- Permission `transfer:distributor_receive`
- `setDistributorContext`

The controller obtains the shipment, validates distributor ownership, request
hash and replay, creates receipt/line records and then applies canonical
good/damaged/missing movements in one serializable Prisma transaction.

### Distributor stock-return receipt

Source:

- `DistributorStockReturn`
- `DistributorStockReturnCollection`
- `DistributorStockReturnCollectionLine`
- `DistributorStockReturnInspection`
- `DistributorStockReturnInspectionLine`

The receipt service uses request hash/idempotency, serializable transaction,
good/damaged/missing quantity reconciliation and
`applyInventoryMovement`. It also creates open discrepancies and audit events.

### Existing supplier receipt evidence

`InboundShipment` is a batch/estimated acquisition snapshot. It has no stable
purchase-order or goods-receipt line relation. `SupplierReturn` is a return/debit
model, not a goods receipt. No supplier master/PO/GRN/invoice-match model was
found.

## 3. Proposed Prisma data model

The following snippets are design-only proposals. They must not be added to
`schema.prisma` until separately approved schema/migration work starts.

### 3.1 Receiving source model

For the first increment, prefer reusing existing stock-transfer or return
source records rather than introducing a supplier PO/GRN system.

For a generic bounded receiving framework:

```prisma
enum? // Keep status fields String for compatibility; enum migration is optional.

model GoodsReceipt {
  id                  String   @id @default(uuid())
  sourceType          String   @db.VarChar(64)
  sourceDocumentId    String   @db.VarChar(191)
  sourceDocumentKey   String   @db.VarChar(191)
  receivingLocationId String
  status              String   @default("RECEIPT_INITIATED")
  idempotencyKey      String   @unique @db.VarChar(191)
  requestHash         String   @db.Char(64)
  createdByAccountId  String
  receivedByAccountId String?
  approvedByAccountId String?
  receivedAt          DateTime?
  completedAt         DateTime?
  notes               String?  @db.Text
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  receivingLocation InventoryLocation @relation(fields: [receivingLocationId], references: [id], onDelete: Restrict)
  lines             GoodsReceiptLine[]
  events            GoodsReceiptEvent[]
  putAwayLines      GoodsReceiptPutAway[]

  @@unique([sourceType, sourceDocumentId, sourceDocumentKey])
  @@index([status, createdAt])
  @@index([sourceType, sourceDocumentId])
  @@index([receivingLocationId, status])
}
```

Required fields:

- Stable UUID.
- Source type and source document identity.
- Receiving location.
- Status.
- Request idempotency key and request hash.
- Creator/actor.

Optional:

- Source document business key.
- Approved actor.
- Received/completed timestamps.
- Notes.

Do not store duplicate supplier name/order amount/party description in the
receipt if a source record is authoritative.

### 3.2 Receipt line

```prisma
model GoodsReceiptLine {
  id                         String @id @default(uuid())
  receiptId                  String
  sourceLineId               String @db.VarChar(191)
  inventorySkuId             String
  dispatchedQuantity         Int    @default(0)
  arrivedQuantity            Int    @default(0)
  inspectedQuantity          Int    @default(0)
  acceptedQuantity           Int    @default(0)
  rejectedQuantity           Int    @default(0)
  damagedQuantity            Int    @default(0)
  missingQuantity            Int    @default(0)
  quarantinedQuantity        Int    @default(0)
  putAwayQuantity            Int    @default(0)
  excessQuantity             Int    @default(0)
  evidence                   Json?
  reasonCode                 String? @db.VarChar(64)
  inspectionNotes            String? @db.Text
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  receipt       GoodsReceipt @relation(fields: [receiptId], references: [id], onDelete: Restrict)
  inventorySku  InventorySku @relation(fields: [inventorySkuId], references: [id], onDelete: Restrict)
  putAwayLines  GoodsReceiptPutAway[]

  @@unique([receiptId, sourceLineId])
  @@index([sourceLineId])
  @@index([inventorySkuId])
}
```

Quantity invariants must remain database/application enforced:

- All quantities are nonnegative whole integers.
- `inspected = accepted + rejected + damaged + missing + quarantined`.
- `inspected <= arrived`.
- `putAway <= accepted`.
- Receipt/sourced line accounted quantity is not duplicated across sessions.

The proposed model stores current cumulative receipt quantities plus immutable
events; do not infer total correctness from status alone.

### 3.3 Receipt event

```prisma
model GoodsReceiptEvent {
  id               String   @id @default(uuid())
  receiptId        String
  eventKey         String   @unique @db.VarChar(191)
  eventType        String   @db.VarChar(64)
  fromStatus       String?  @db.VarChar(32)
  toStatus         String   @db.VarChar(32)
  actorAccountId   String
  actorRole        String   @db.VarChar(32)
  effectiveAt      DateTime
  recordedAt       DateTime @default(now())
  evidence         Json?
  metadata         Json?
  receipt          GoodsReceipt @relation(fields: [receiptId], references: [id], onDelete: Restrict)

  @@index([receiptId, recordedAt])
  @@index([actorAccountId, recordedAt])
}
```

Event append-only behavior prevents silent status replacement. Corrections use
new events and compensating movement references.

### 3.4 Put-away

```prisma
model GoodsReceiptPutAway {
  id                     String   @id @default(uuid())
  receiptId              String
  receiptLineId          String
  inventorySkuId         String
  sourceLocationId       String
  destinationLocationId  String
  quantity               Int
  status                 String   @default("PENDING_CONFIRMATION")
  idempotencyKey         String   @unique @db.VarChar(191)
  requestHash            String   @db.Char(64)
  confirmedByAccountId   String?
  confirmedAt            DateTime?
  movementEntryId        String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  receipt       GoodsReceipt @relation(fields: [receiptId], references: [id], onDelete: Restrict)
  receiptLine   GoodsReceiptLine @relation(fields: [receiptLineId], references: [id], onDelete: Restrict)
  inventorySku  InventorySku @relation(fields: [inventorySkuId], references: [id], onDelete: Restrict)
  sourceLocation      InventoryLocation @relation("GoodsReceiptPutAwaySource", fields: [sourceLocationId], references: [id], onDelete: Restrict)
  destinationLocation InventoryLocation @relation("GoodsReceiptPutAwayDestination", fields: [destinationLocationId], references: [id], onDelete: Restrict)

  @@index([receiptId, status])
  @@index([receiptLineId, status])
  @@index([sourceLocationId, destinationLocationId])
}
```

The `movementEntryId` must only be set after the canonical ledger write commits.
A put-away pending placement must not increase available stock.

### 3.5 Discrepancy and evidence reuse

Reuse `InventoryDiscrepancy` for damage, missing and count discrepancies.
Add optional receipt and put-away foreign keys only in a future approved schema
change. Evidence is JSON or uploaded URL plus actor/approval metadata; it must
be linked to exact line and event.

### 3.6 Schema prerequisites

The proposed models require matching relations on:

- `InventoryLocation` for put-away source/destination.
- `InventorySku` for receipt lines/put-away.
- `AuthAccount` or existing audit actor identity.
- Optional source document tables for PO/GRN/supplier.

No `enum` model is proposed for this increment because status strings are
already the repository convention. Database check constraints or service
validation can enforce lifecycle sets.

## 4. Service architecture

The future service stack should be:

1. `receivingSourceService`
   - Resolve source type/document/line.
   - Enforce remaining quantity.
   - Verify location/workspace scope.
2. `goodsReceiptService`
   - Create/replay receipt.
   - Arrival and receipt initiation.
   - Receipt line updates.
   - Event status history.
3. `receivingInspectionService`
   - Inspection.
   - Accepted/rejected/damaged/missing/quarantine.
   - Discrepancy creation and independent review.
4. `putAwayService`
   - Assignment and physical confirmation.
   - Source/destination authorization.
   - Partial put-away cumulative validation.
5. `canonical movement orchestration`
   - Calls `applyInventoryMovement`.
   - Never writes `InventoryBalance` or `InventoryLedgerEntry` directly.
   - Adds movement reference to put-away/receipt.

Controllers remain HTTP/workspace adapters. They should not own the canonical
balance or ledger invariant.

The pure `receivingContractService` remains reusable for state/quantity
validation. It must not gain Prisma or accounting responsibilities.

## 5. API contract proposal

These routes are proposed only; none should be mounted or implemented in this
increment.

### Create receipt

`POST /api/receipts`

Headers:

- `Authorization` or existing session token.
- `Idempotency-Key`.

Body:

```json
{
  "sourceType": "STOCK_TRANSFER",
  "sourceDocumentId": "stable-source-id",
  "sourceDocumentKey": "stable-source-line-or-session",
  "receivingLocationId": "server-validated-location-id",
  "lines": [
    {
      "sourceLineId": "stable-source-line-id",
      "inventorySkuId": "inventory-sku-id",
      "arrivedQuantity": 10
    }
  ]
}
```

Permission: proposed receiving capability plus location scope. Existing
`transfer:distributor_receive` can be reused only for stock-transfer receipts;
do not reuse it for general supplier receipts.

Responses:

- `201` created.
- `200` replay.
- `409` idempotency conflict or source-line conflict.
- `403` location/permission denied.
- `404` source document/location absent or inaccessible.

### Record arrival

`POST /api/receipts/:receiptId/arrival`

Requires arrival evidence and a receiving context.

### Verify/add lines

`PUT /api/receipts/:receiptId/lines`

Requires source-line uniqueness and exact quantity arithmetic.

### Record inspection

`POST /api/receipts/:receiptId/inspection`

Requires exact accepted/rejected/damaged/missing/quarantined quantities,
inspector, evidence and discrepancy reason.

### Accept/reject

`POST /api/receipts/:receiptId/lines/:lineId/disposition`

Requires independent approver if policy classifies the disposition consequential.
No put-away or inventory movement is implied.

### Discrepancy

`POST /api/receipts/:receiptId/lines/:lineId/discrepancies`

Creates exception, evidence and open review state. It must not create
liability, receivable or write-off.

### Assign put-away

`POST /api/receipts/:receiptId/lines/:lineId/put-away`

Requires staging and destination location scope, exact quantity and assignment
authority.

### Confirm physical put-away

`POST /api/receipts/:receiptId/lines/:lineId/put-away/:putAwayId/confirm`

Requires placement confirmation, actor/evidence and destination authorization.
This operation invokes canonical movement and closes/updates put-away status.

### Receipt history

`GET /api/receipts/:receiptId`

Read-only permission plus location/source scope. It returns header, line,
event, discrepancy and put-away/movement references.

All error bodies should follow:

```json
{
  "success": false,
  "message": "Explicit message",
  "code": "STABLE_ERROR_CODE"
}
```

## 6. Transaction and concurrency design

### Atomic

The put-away confirmation transaction must atomically include:

- Put-away status/receipt line cumulative put-away update.
- Canonical source/destination balance effects.
- One canonical ledger movement.
- Receipt event/status update.
- Audit reference.

The receipt acceptance transaction may remain separate from inventory posting
when policy requires independent inspection/approval. It must still update
receipt header/line/event atomically.

### Idempotency

- Stable request key and canonical payload hash.
- Database unique key on receipt, receipt event and put-away idempotency keys.
- Changed payload under the same key conflicts.
- Repeated exact replay returns the original result without balance duplication.
- Legitimate partial receipts use separate receipt/session identities; similar
  quantities alone never imply duplicate prevention.

### Concurrency

Future persisted implementation should use:

- Serializable transaction or equivalent database locking for source-line
  remaining quantity.
- Conditional balance updates with current quantity predicates.
- Database unique constraints for receipt/session/line/movement identities.
- Retry only on retryable transaction conflicts, with bounded attempts.
- No blind read-then-write stock movement.

These behaviors must be proven against an isolated database; mocks cannot prove
them.

### Recovery

- Movement failure leaves put-away and receipt status pending, never falsely completed.
- Outbox-style recovery may process an already-decided receipt event.
- A retry revalidates source line, remaining quantity and exact movement key.
- Corrections append compensating receipt/movement events.
- Process interruption after receipt acceptance but before put-away leaves
  `PUT_AWAY_PENDING`.
- Process interruption after ledger commit but before receipt completion must
  reconcile the movement reference and close from persisted evidence.

## 7. Historical compatibility

Existing source records should be classified, not backfilled:

| Classification | Required handling |
|---|---|
| Verifiable | Stable source/line, exact quantity, evidence, receipt/movement reference |
| Partially evidenced | Keep source; missing line/actor/evidence becomes an open exception |
| Ambiguous | Preserve candidates; no max/newest/array-position guess |
| Duplicate candidate | Keep both IDs; exact idempotency proof only |
| Unmatched stock | Remain exception; no synthetic receipt |
| Manual review | Require documented approver/effective time |

Existing transfer receipts can seed receipt lineage only when shipment, shipment
line, transfer line, quantity and evidence reconcile. Existing stock-return
collections can map collection/collection-line receipt, but cost and liability
policy remain separate.

Legacy `ManufacturerInventory`, `StockLog`, `Product.variants` and
`Product.stockQuantity` changes must not be relabeled as goods receipts.

No persisted migration or backfill is authorized.

## 8. Migration and release plan

### Proposed sequence

1. Approve schema and policy.
2. Independently verify isolated migration test endpoint and backup/restore.
3. Deploy additive receipt schema only, with no stock mutation.
4. Deploy receipt-event and read-only audit support.
5. Add one bounded stock-transfer source adapter.
6. Add put-away/movement service behind feature gate.
7. Run persisted integration/concurrency/recovery tests.
8. Reconcile existing transfer receipts and canonical movements.
9. Roll out read/report and UI after separate approval.
10. Extend supplier/GRN implementation later.

### Migration safety

- Additive tables/columns only in the first migration.
- Nullable foreign keys or explicit source references for historical compatibility.
- No deletion or repurposing of existing location/source records.
- Unique constraints only after duplicate assessment.
- Backfill only deterministic, explicitly evidenced fields.
- Migration rollback is forward-corrective if old deployed code cannot understand
  new tables; never rely solely on deleting data.
- Keep old readers readable during compatibility period.

### DBA prerequisites

Before future database work:

- Independently verified endpoint host/port/database identity.
- Separate explicit migration authorization.
- Exact-match environment variables and safety guard approval.
- Isolated, non-production database confirmation.
- Backup and restore test evidence.
- Migration rollback procedure.
- Database capacity/index review.
- No `clothing` prohibited target.
- No assumption that a `clothing_test` name means isolated or safe.

Existing repository database guards require purpose-specific opt-in profiles,
exact host/port/name verification and migration/maintenance flags. They must
remain unchanged.

## 9. Test strategy

### Pure unit tests

- Lifecycle transitions.
- Exact quantity arithmetic.
- Partial and over/under receipt.
- Put-away limits.
- Source-line uniqueness.
- Input immutability.
- Stable JSON/API response shapes.

### Mocked service tests

- Receipt creation/replay.
- Conflicting request hash.
- Event/status update.
- Canonical movement call once.
- Put-away failure leaves pending state.
- Source/destination authorization denial.
- Discrepancy and audit creation.

### Database integration tests

- One transaction commits receipt/event/put-away/movement together.
- Failed movement rolls back put-away and receipt closure.
- Partial receipt leaves source remaining quantity correct.
- Repeat key replay is exact.
- Changed payload conflict.
- Source line cannot be received twice beyond remaining quantity.
- Correction/reversal creates history, not overwrites.

### Concurrency tests

- Simultaneous receipt submissions.
- Race on source remaining quantity.
- Race on balance update.
- Idempotency key collision.
- Partial put-away concurrently.
- Database lock/serialization retry behavior.

### Migration/recovery tests

- Additive migration.
- Historical exceptions.
- Forward/rollback.
- Restore and reconcile.
- Reader compatibility during dual-read window.

### Physical reconciliation tests

- Counting and put-away evidence.
- Location and SKU balance.
- Ledger net and source remaining quantity.
- Discrepancy and exception population.
- No database or physical result is complete until independently verified.

## 10. Recommended first persistent increment

Recommend a single bounded increment:

**Harden existing stock-transfer receipt persistence**, without supplier PO/GRN,
accounting, general warehouse hierarchy or direct writer migration.

Scope:

- Add receipt-session/event/put-away references required for partial sessions.
- Preserve existing `StockTransferReceipt` and `StockTransferReceiptLine`
  compatibility.
- Reuse `applyInventoryMovement`.
- Reuse existing `locationScope` for destination access.
- Keep good/damaged/missing/discrepancy separation.
- Add put-away confirmation as a separate future API only after schema approval.

Do not begin supplier PO/GRN or all-domain receiving in this increment.

## 11. Unresolved policy decisions

- Supplier/manufacturer title and custody timing.
- Approved costing method.
- Landed-cost allocation.
- Invoice and receipt 3-way evidence.
- Over-receipt approval threshold.
- Damage/loss responsibility.
- Maker/checker thresholds.
- Warehouse hierarchy and bin assignment.
- Return restock/write-off policy.
- Accounting liability/journal trigger.
- Statutory tax treatment.

These remain blocked or exception states and must not become implementation
defaults.

## 12. Exit conditions

P6-R3E is complete for blueprint scope. Generic warehouse/supplier receiving
and put-away are not implemented. The existing bounded stock-transfer receipt
route is persistent; see the independent P6-R3K verification in
[18-p6-r3k-receipt-foundation-verification-and-reconciliation-readiness.md](./18-p6-r3k-receipt-foundation-verification-and-reconciliation-readiness.md)
before any further receipt integration work.
P6-R3 remains incomplete, and P6-R3F or schema implementation requires separate
authorization and approved DBA/isolation controls.
P6-R3F is complete for static stock-transfer receipt hardening readiness in
[12-p6-r3f-stock-transfer-receipt-hardening-readiness.md](./12-p6-r3f-stock-transfer-receipt-hardening-readiness.md).
It adds no persistent transfer receipt implementation.
P6-R3G defines the next executable hardening sequence in
[13-p6-r3g-stock-transfer-hardening-implementation-plan.md](./13-p6-r3g-stock-transfer-hardening-implementation-plan.md),
but does not implement those stages.
