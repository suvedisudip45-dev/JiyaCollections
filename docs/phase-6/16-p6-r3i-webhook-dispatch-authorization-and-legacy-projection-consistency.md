# P6-R3I - Webhook Dispatch Authorization and Legacy Projection Consistency

**Status:** COMPLETE - DATABASE-INDEPENDENT WEBHOOK/LEGACY CONSISTENCY HARDENING
**P6-R3H:** PARTIALLY VERIFIED
**P6-R3H-V:** COMPLETE - VERIFICATION ONLY
**P6-R3:** INCOMPLETE
**Persistent receiving:** NOT IMPLEMENTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Fresh source audit

Every stock-transfer dispatch path converges on
`dispatchShipmentStock` in `backend/controllers/stockTransferController.js`
for:

- manual local dispatch
- NCM pickup/reconciliation/webhook dispatch
- NCM sync/admin reconciliation
- own-store dispatch

The active HTTP dispatch routes are:

- `POST /api/stock-transfers/:id/dispatch`
- `POST /api/stock-transfers/:id/ncm-booking`
- `POST /api/manufacturer/stock-requests/:id/dispatch`

Machine-to-machine NCM status dispatch is not an HTTP transfer route. It enters
through `deliveryController.receiveWebhook` and
`applyNcmStockTransferWebhook`.

## 2. Webhook authorization

The NCM webhook route is mounted under both `/api/ncm-webhook` and
`/webhooks/ncm`/`/webhooks`. It validates a configured `NCM_WEBHOOK_SECRET`
against:

- `x-ncm-webhook-secret`
- query token/secret
- Bearer/Token authorization
- payload secret/token

Production rejects the webhook when no secret is configured. Development
may permit an unauthenticated test mode only when explicitly coded. The
P6-R3I implementation does not invent credentials or identity mappings.

After carrier event authentication, `applyNcmStockTransferWebhook` resolves
the shipment and transfer server-side. It now resolves the transfer
`sourceLocationId` and calls `validateWebhookDispatchAuthorization` before
dispatch.

The validator fails closed if:

- custody is not confirmed.
- transfer/shipment identity is missing.
- source location is missing.
- source location is inactive.
- source location is not `FACTORY`.
- source location is not `PLATFORM` owned.
- source location manufacturer does not match the transfer manufacturer.
- shipment is no longer in `BOOKED` or `BOOKING_UNKNOWN`.

Client-controlled location values are not used. The webhook uses the shipment
and transfer server records to resolve source identity.

## 3. Legacy projection consistency

Dispatch also updates:

- `ManufacturerInventory.quantity`
- `ManufacturerInventory.reservedQty`
- `ManufacturerInventory.variantsStock`
- `ManufacturerInventoryMovement`
- `StockLog`
- `Product.stockQuantity` through `syncProductStock`

These remain compatibility/audit projections. They are not an independent
canonical physical stock authority.

The pure
`assessLegacyDispatchProjectionConsistency` helper now defines exact consistency
for:

- Dispatch: on-hand decreases by dispatched quantity; reserved stays unchanged.
- Reserve: on-hand unchanged; reserved increases.
- Release: on-hand unchanged; reserved decreases.

It rejects negative, fractional, out-of-range or conflicting projection values.
The existing `updateLegacyFactoryStock` transaction now calls this helper after
variant and aggregate values are calculated.

This does not remove legacy writes or guarantee persisted cross-source
consistency. It makes mismatched aggregate projections fail instead of being
silently accepted.

## 4. Idempotency and retry

Existing:

- NCM shipment events use `StockTransferShipmentEvent.eventKey` and
  `createMany(skipDuplicates: true)`.
- A duplicate event returns `stockMovementApplied: false`.
- Shipment booking uses `bookingIdempotencyKey` plus request hash.
- Canonical dispatch uses
  `stock-transfer:<shipmentId>:dispatch:<inventorySkuId>`.
- Reused canonical keys replay exact content and conflict on changed content.

P6-R3I added explicit source/custody validation before canonical dispatch.
It does not add a new persisted correction or reservation model.

Database-dependent retry/concurrency remains unverified.

## 5. Reconciliation impact

The read-only reconciliation service remains unchanged.

It can detect:

- duplicate dispatch movements
- dispatch missing its ledger movement
- dispatch movement quantity conflicts
- mismatch between dispatch, receipt and shipment quantities
- missing source location evidence
- source coverage incomplete

It does not currently load or compare:

- `ManufacturerInventory`
- `ManufacturerInventoryMovement`
- `StockLog`
- legacy `Product.stockQuantity`

Therefore it cannot independently detect canonical dispatch with a mismatched
legacy projection. It must remain incomplete until a future source loader
links legacy projection evidence explicitly.

No discrepancy is automatically repaired or closed.

## 6. Tests

Executed command:

```sh
cd backend
node --test tests/stockTransferService.test.js tests/locationScope.test.js tests/inventoryLedgerService.test.js tests/ncmWebhookSimulator.test.js
```

Result: **51 passed, 0 failed**.

P6-R3I-specific coverage:

- NCM webhook source/custody/location authorization
- inactive and mismatched source location rejection
- missing/unconfirmed custody rejection
- dispatch-state conflict rejection
- legacy dispatch projection consistency
- legacy reservation/release consistency
- legacy mismatch rejection

Existing NCM simulator tests pass and demonstrate that linked stock-transfer,
delivery, return and exchange IDs are refused for staging simulation.

## 7. Remaining limitations

- The HTTP webhook secret remains the machine identity boundary; a different
  persisted identity/allowlist model is not present.
- Destination-location scope is not yet applied to transfer dispatch.
- Legacy projection writes remain inside the canonical dispatch transaction.
- There is no database-backed proof of concurrent replay/rollback.
- There is no persisted correction/reversal for legacy or canonical movement.
- Reconciliation does not compare legacy and canonical stock effects.
- No database, Prisma, migration or external call occurred.

## 8. Files changed

- `backend/services/stockTransferService.js`
- `backend/controllers/stockTransferController.js`
- `backend/tests/stockTransferService.test.js`
- `docs/phase-6/16-p6-r3i-webhook-dispatch-authorization-and-legacy-projection-consistency.md`
- Phase 6/status documentation references
