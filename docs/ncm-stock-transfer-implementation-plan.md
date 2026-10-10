# NCM Stock Transfer Flow: Iterative Plan and Checklist

## Scope and guardrails

This plan covers the manufacturer-to-external-distributor stock-transfer
workflow that uses NCM or local logistics. It does not merge this workflow with
customer-order delivery or own-store transfers. Preserve all pre-existing
worktree changes, especially the separate customer-order delivery changes.
Do not edit `backend/services/adminTwoFactorService.js`.

The NCM API and webhook PDFs supplied for this task were reviewed locally:

- `NCM API DOC V2.pdf` (32 pages)
- `NCM webhook-documentation.pdf` (8 pages)

### Contract facts used in this plan

- Order creation is `POST /api/v1/order/create` with
  `Authorization: Token …` and JSON fields `name`, `phone`, `cod_charge`,
  `address`, `fbranch`, and `branch`; `phone2`, `package`, `vref_id`,
  `instruction`, `delivery_type`, and `weight` are optional. The documented
  delivery types are `Door2Door`, `Branch2Door`, `Branch2Branch`, and
  `Door2Branch`. A successful response includes a numeric `orderid`.
- The rate endpoint takes origin branch (`creation`), destination branch, and
  carrier delivery type. NCM's rate `type` values differ from the order
  `delivery_type` values.
- NCM's order status/detail endpoints are available, but normal portal reads
  should use the saved application state. Carrier reads are reserved for
  deliberate admin reconciliation.
- A return request is `POST /api/v2/vendor/order/return` with numeric `pk` and
  optional `comment`. A successful request sets `vendor_return`; it does not
  prove that goods have physically returned.
- NCM's webhook sends `order_id` or `order_ids`, `status`, `timestamp`, and
  `event`. Documented events include pickup completed, sent for delivery,
  dispatched from origin, arrived at destination, and delivery completed.
  Configure the callback in the NCM vendor portal; respond within 10 seconds
  and use idempotent processing.
- The webhook PDF is inconsistent about delivery retries: one section says
  failed deliveries are retried, another says no retry mechanism exists.
  Therefore the implementation must tolerate duplicates but must not rely on
  NCM retrying a missed event; provide admin reconciliation and monitoring.
- NCM's webhook authentication is configurable by URL/header token, without a
  documented signature scheme. Production webhook access must not trust
  `User-Agent` as authentication.
- Stock-transfer COD remains zero: this is a business-to-business inventory
  transfer, not customer COD collection. NCM freight is a platform/admin
  expense/settlement, not a manufacturer or distributor payable.

## Iteration checklist

### Iteration 0 — Baseline and contract audit

- [x] Record worktree changes before editing; preserve existing customer-order
  and stock-transfer work.
- [x] Review both NCM PDFs and compare create, rate, status, return, and webhook
  contracts with the current client/controller/service code.
- [x] Trace request, approval, preparation, booking, shipment, receipt,
  accounting, webhook, route authorization, and the three portal views.
- [x] Record local logistics as unverified and identify test gaps.

### Iteration 1 — Booking inputs and local-dispatch invariants

- [x] Use the distributor's verified NCM destination branch rather than
  substituting its city name.
- [x] Enforce the positive local freight amount in the direct backend dispatch
  handler, not only in the wrapper/UI.
- [x] Give stock-transfer shipments a dedicated numeric-string NCM order ID and
  durable shipment-event record; backfill existing numeric references safely.
- [x] Validate the Prisma schema/migration without applying it to a database.

### Iteration 2 — Booking, custody, and inventory lifecycle

- [x] Treat NCM booking acceptance as `BOOKED`, not physical dispatch.
- [x] Keep reserved stock at the factory until NCM confirms pickup/handoff.
- [x] On the first valid custody-confirming NCM event (pickup complete or a
  later delivery-progress event), atomically move stock to in-transit, consume
  reservations/cost allocations once, and advance the transfer lifecycle.
- [x] Keep NCM delivered status distinct from distributor's physical receipt,
  inspection, damage, missing counts, and ledger receipt.
- [x] Show the NCM carrier status separately from local shipment status and
  enable receipt QA only after the local shipment reaches `DISPATCHED` or
  `PARTIALLY_RECEIVED`.
- [x] Ensure out-of-order/duplicate webhooks cannot reverse lifecycle state or
  repeat inventory movements.
- [x] Keep ambiguous booking outcomes reserved and admin-reconcilable; never
  automatically retry order creation when the carrier may have accepted it.

### Iteration 3 — Webhook reliability, status reads, return, and UI

- [x] Persist one idempotent event per shipment and provider status event.
- [x] Acknowledge webhook only after its event and state transition are saved;
  make failed processing retryable locally because NCM retry behavior is
  undocumented/inconsistent. Duplicate deliveries are re-applied through
  idempotent downstream processing; admin reconciliation recovers missed
  pickup events.
- [x] Remove NCM API polling from manufacturer/distributor tracking views.
- [x] Keep an explicit admin-only carrier reconciliation action for missed or
  ambiguous events; normal views read database state.
- [x] Show one event timeline and clear booking, pickup, transit, carrier
  delivery, physical receipt, return request, and exception states in admin,
  manufacturer, and distributor portals.
- [x] Keep the NCM return request separate from physical return receipt and
  inspection.
- [x] Ensure NCM freight is tracked as platform/admin settlement only and never
  creates a manufacturer/distributor payable.
- [x] Collect and validate package type, product contents/type, weight,
  dimensions, delivery instructions, fragile handling, and packaging notes
  before manufacturer NCM booking. Persist them with the shipment and display
  them to admin, manufacturer, and distributor users.

### Iteration 4 — Regression validation and rollout

- [ ] Add database-backed tests for booking acceptance without dispatch,
  pickup webhook idempotency, out-of-order events, ambiguous booking
  reconciliation, return receipt, and accounting invariants. Pure normalization
  and local-freight coverage exists in `stockTransferService.test.js`; the
  repository has no isolated database-backed stock-transfer webhook harness.
- [x] Run focused backend tests, Prisma schema validation, and relevant portal
  builds. (31 focused Node tests pass; schema validation passes; manufacturer
  and admin production builds pass.)
- [x] Update the existing architecture/database/operations documentation to
  match implemented behavior.
- [ ] Resolve the Windows Prisma engine DLL file lock and complete
  `npm run build`/client generation before applying the migration.
- [ ] Verify local-logistics and NCM pickup/return workflows against an
  isolated database and carrier sandbox before production rollout.

### Manual sandbox and local-logistics verification

Use only a dedicated test database that has the reviewed migrations applied and
the Prisma client generated. Set `RUN_DATABASE_INTEGRATION_TESTS=1` only when
`DATABASE_URL` points to that isolated database. Configure a non-production
NCM credential and `NCM_WEBHOOK_SECRET`; do not paste bearer or carrier tokens
into logs, tickets, or source files.

1. Create and admin-approve a distributor demand. Complete all manufacturer
   preparation checks and book a partial quantity with NCM using a verified
   pickup and destination branch.
2. Before sending a webhook, confirm the shipment reads `BOOKED`; factory
   ledger and legacy quantities remain unchanged, while reservations and
   reserved cost-layer quantities increase. Confirm duplicate booking requests
   return the same shipment and do not submit a second NCM order.
3. Send the NCM test webhook and confirm it is acknowledged without changing
   stock. Send a valid pickup-completed webhook for the numeric NCM order ID;
   verify one in-transit ledger movement, one dispatched manufacturer stock
   movement, released reservations, dispatched cost-layer allocations, and a
   saved shipment event. Replay the exact webhook and confirm there is no second
   movement. Also verify a delivery-completed event can confirm custody when it
   is the first event received, and that the webhook response identifies the
   matched shipment and resulting local/carrier statuses.
4. Send a delivery-completed webhook. Confirm it updates the carrier timeline
   only and does not receive distributor inventory. Record distributor good,
   damaged, and missing quantities through the receipt checklist; verify the
   ledger, discrepancy, and receipt result. Exercise the NCM return request
   separately and confirm it never counts as a physical receipt.
5. In admin only, reconcile a deliberately missed pickup/status using NCM's
   status endpoint. Confirm the same event/custody path is used exactly once.
   Confirm manufacturer/distributor reads do not call NCM, and production
   webhook requests without the configured secret (including a forged NCM
   `User-Agent`) are rejected.
6. For local logistics, dispatch an approved shipment with a positive freight
   amount and verify the existing manufacturer freight accrual and stock
   movement, with no distributor payable. Confirm zero/missing freight is
   rejected by the backend. Keep own-store delivery on the separate
   zero-freight `SELF_STORE` path. Receive and inspect the shipment using the
   normal checklist.
7. Capture test results and any NCM sandbox limitations, then run focused
   tests and relevant portal builds again before production rollout.

### Implemented iteration notes

- NCM booking response and admin booking reconciliation now set `BOOKED`;
  reservation and cost-layer state stay at the manufacturer until custody.
- Pickup-or-later carrier events use the existing transactional dispatch
  ledger path. The shipment-level event key prevents duplicate movements, and
  a monotonic rank prevents stale carrier states from replacing newer ones.
- Admin status reconciliation feeds saved carrier status/history through the
  same event application path, allowing it to recover a missed custody event.
- Manufacturer/distributor NCM tracking endpoints and refresh buttons were
  removed. The admin reconciliation endpoint is now admin-only.
- NCM production webhooks require `NCM_WEBHOOK_SECRET`; a matching
  `User-Agent` is never accepted as authentication.
- Manufacturer NCM booking now requires complete package details. The booking
  maps type, contents, dimensions, fragile handling, and packaging notes into
  NCM's documented `package` string; user instructions and the no-COD note go
  into `instruction`, and measured weight goes into `weight`. It sends no
  undocumented package-type or dimension fields. Details are included in the
  idempotency hash and durably stored on the shipment.
- NCM stock-transfer branch preflight now verifies origin/destination against
  the active synchronized `NcmBranch` catalog. Catalog-matched unverified
  branch selections are marked verified; rejected or unavailable branches
  remain blocked.
- Fixed the transfer-loading query used by booking: its distributor projection
  previously omitted `ncmPickupBranch` and `pickupBranchStatus`, so valid
  configured destinations arrived as `undefined` at preflight. Admin,
  manufacturer, and distributor views now surface the NCM route/status; the
  manufacturer sees the automatic verification rule before booking.
- Branch eligibility regression test passes; focused stock-transfer tests
  pass (16/16), backend syntax and Prisma schema validation pass, the
  manufacturer and admin portal builds pass, and `git diff --check` passes.
  Focused manufacturer lint passes with existing unused-import/effect
  warnings. The schema migration remains unapplied.
- Focused stock-transfer tests pass (15/15), Prisma schema validation passes,
  and manufacturer/admin production builds pass. Manufacturer focused lint
  reports two existing `set-state-in-effect` warnings; admin lint reports its
  existing missing `token` prop-types declaration in `StockTransfers.jsx`.
  Backend syntax checks and `git diff --check` pass. The database migration
  remains unapplied.
- Focused portal lint still reports baseline issues outside the edited files
  (`admin` repository-wide lint) and existing warnings (`manufacturer` full
  lint). The changed manufacturer pages pass focused oxlint; the changed admin
  page is subject to the portal's existing prop-types lint rule for its `token`
  parameter.
- `backend/npm run build` attempted Prisma client generation but Windows denied
  replacing `query_engine-windows.dll.node` (EPERM). A syntax check, schema
  validation, controller import check, and the existing generated-client
  model check pass; do not apply the migration until client generation succeeds.
- The full `backend/npm test` run executed 70 test files and skipped 9
  database-backed files. The shipment/delivery tests pass, but the suite exits
  non-zero on three `adminTwoFactorService.test.js` cases because fixed-OTP
  configuration causes generated test codes to remain `111111`. That service
  is outside this task's scope and was not changed.
- [x] Document the manual NCM sandbox and local-logistics end-to-end test
  procedure. Do not apply migrations or assume local-logistics production
  readiness without an isolated database and carrier test.

## Implementation decisions and open operational checks

- Use NCM's documented `pickup_completed` event as proof of carrier custody.
  Do not move physical stock merely because the order-create request succeeded.
- Preserve the current no-`vref_id` booking behavior: the NCM order ID is the
  correlation key, and the internal UUID must not be sent as a long vendor
  reference.
- The distributor's `ncmPickupBranch` is the candidate destination branch only
  when that profile branch is verified. Do not guess from `city`.
- Do not infer that the carrier's final delivery means the distributor has
  inspected and accepted the stock.
- NCM's final invoicing/settlement evidence for these B2B shipments must be
  confirmed in the vendor portal before building automatic payment posting.
  Until then, persist quoted/confirmed carrier charges for admin review and
  keep them out of supplier/distributor payables.
