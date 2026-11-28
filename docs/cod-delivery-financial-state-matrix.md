# Phase 5D — COD and Delivery Financial State Matrix

## Baseline captured before implementation

This matrix records the existing behavior inspected before Phase 5D code
changes. It distinguishes customer collection, physical cash custody,
distributor-to-company remittance, and carrier settlement. These are related
but not interchangeable states or ledgers.

| Workflow | Existing states and transitions | Existing transaction and evidence boundary | Baseline gap / invariant for implementation |
| --- | --- | --- | --- |
| COD due at order placement | A COD order is created unpaid. Current checkout snapshots store the all-in `finalPayableTotal`, including delivery fee; legacy orders without a valid snapshot use `Order.amount + deliveryFee`. | Checkout pricing snapshot and order creation are canonical. | Never derive a new due by adding a mirrored delivery fee to a valid all-in snapshot. Collection due is server-derived. |
| Customer collection OTP | `DeliveryOtpChallenge`: `PENDING -> VERIFIED`, or `EXPIRED`, `LOCKED`, `SUPERSEDED`. The HMAC binds order, distributor, and the full expected COD amount. | Challenge issue and verification use database transactions; attempts are bounded; active challenge is unique per order. | Challenge only covers full COD; no partial amount or collection attempt identity exists. |
| Distributor self-delivery | Assignment advances through ready/accepted states, `dispatched -> on_the_way -> delivered`; invalid transitions are rejected. | `updateSelfDeliveryStatus` uses a serializable transaction for assignment/order state, COD event, inventory consumption, accounting outbox, distributor earnings, and audit. | No controlled unavailable/refused/address/reschedule transition or attempt limit is represented in the self-delivery state machine. |
| Self-delivery COD collection | Delivery creates one `CUSTOMER_COLLECTION` event for the full due. OTP-enabled collection is `VERIFIED`; with SMS OTP disabled it is `PENDING_VERIFICATION`. Event key is `delivery-collection:<orderId>`. `Order.payment` becomes true only for the OTP-verified path. | The collection write, payment marker, delivered sale outbox, inventory consumption, and status changes share the self-delivery transaction. | No partial or failed collection event, actual/outstanding amount, delivery reference, or handover link. A second collection for the order conflicts with the single fixed key. |
| Driver POD | Driver identity is bound to an active profile and distributor; stop access requires the assigned manifest, driver, distributor, and self-delivery assignment. POD outcomes are `DELIVERED`, `PARTIAL`, `FAILED`; each stop has one proof row. | POD and stop completion are written in the route-stop transaction; proof has a unique idempotency key and actor. | `PARTIAL` only changes the stop and may move the assignment to `on_the_way`; it does not record delivered line quantities, COD, or stock consumption. `FAILED` records proof but does not update the order/assignment or provide a retryable attempt history. |
| Driver cash custody | No driver collection list, handover submission, distributor confirmation, or discrepancy record was found. | Driver POD identifies the driver actor, while collection events identify the recording account; no custody transfer joins the two. | Do not count verified driver-held cash as distributor-held cash. A submitted handover must not post company cash or settle COD. Confirmed handovers must be immutable and auditable. |
| Distributor COD cash position | `getDistributorCashPosition` totals `VERIFIED`/`POSTED` customer collections, pending remittance, verified remittance, and company-collection settlement. | Remittance submission is serializable, idempotent, and capped by verified collections and open COD receivables. Admin review posts journal, accounting allocation, Treasury balance, `CashTransaction`, remittance and cash-event status atomically. | Existing position has no driver outstanding or operator-confirmed handover components; verified collections are treated as distributor-held regardless of driver custody. |
| NCM delivery and COD | NCM status events are idempotent and stale/conflicting reports go to reconciliation. `DELIVERED` updates delivery/order state and creates a `DeliveryFinancialSettlement` with expected COD. | NCM event, delivery state, order state, sale outbox and expected settlement are updated transactionally. NCM carrier calls use separate request-attempt records. | A carrier `DELIVERED` status is not collection proof. The batch settlement path records aggregate COD remittance; there is no per-delivery actual collection evidence or partial customer collection. |
| NCM settlement | `DeliveryFinancialSettlement`: open `PENDING`/`COD_RECEIVED`/`REQUESTED -> SETTLED`; reversals restore prior states through the existing correction flow. | Serializable batch processing validates selected deliveries and actual net deposit, posts journal and carrier fee, allocates receivable, records Treasury cash transaction, and links batch items. | Preserve this canonical carrier settlement. Do not equate settlement status with customer collection or alter it to represent driver handover. |
| Cancellation | Customer/Admin cancellation is allowed before carrier handoff when no payment/accounting/cash activity exists. It marks the order/assignment/delivery cancelled and releases existing reservations in one serializable transaction. | Order, inventory reservations, gift release, and cancellation audit are in the canonical cancellation transaction. | Failed delivery after dispatch is not pre-handoff cancellation. Inventory must remain reserved/in custody until an authorized return-to-custody receipt or explicit release. |
| Customer return | Idempotent request links to the original order and snapshots requested product/size/color quantities. Previously completed returns constrain cumulative quantities; an open request blocks another. Admin decision and inspection are evented. Inspection accepts `RESTOCKABLE`, `DAMAGED`, `MISSING`, or `DISPUTED`. | Return request/decision/inspection use serializable transactions. Route-specific refund payable, stock/accounting, and audit effects are handled by existing services. | Quantity is request-level rather than a universal per-line receipt/disposition model. Distributor and manufacturer routes use different inventory implementations; do not introduce a parallel return ledger. Refund/credit must remain linked to the return/order source. |
| Customer exchange | Idempotent exchange request snapshots original/replacement variants and price difference. Approval reserves replacement stock; rejection can release it. Positive difference is stored as additional COD; negative difference is a refund/credit. | Request, decision, reservation, cash-event evidence and event history use existing exchange and distributor cash services. NCM carrier work has explicit attempts and reconciliation. | Verify route-specific stock consumption and verified price-difference settlement end to end. Loyalty points do not exist; do not create a loyalty ledger in this phase. |

## Intended Phase 5D state mapping

Use the existing records as the source of truth:

| Business state | Representation to use |
| --- | --- |
| `EXPECTED` | Positive server-derived COD due with no collection event. |
| `PENDING` | Existing collection event in `PENDING_VERIFICATION`; the customer amount is not yet verified. |
| `PARTIALLY_COLLECTED` | Verified actual collection is greater than zero and less than the due; outstanding is due minus verified collection. |
| `COLLECTED` | Verified collection total equals the due. Do not infer this from POD. |
| `FAILED` | A failed collection/delivery attempt is retained as an event with reason; it does not change `Order.payment` or successful delivery state. |
| `HANDED_OVER` | Driver custody is reduced only by operator-confirmed handover allocations to verified collections. |
| `RECONCILED` | Expected, collected, driver-held, handed-over, and distributor-confirmed amounts agree; unresolved variance remains visible. |
| `SETTLED` | Only the existing distributor remittance or NCM settlement/accounting path can establish settlement. Driver submission/confirmation alone is insufficient. |

These are reporting/business states, not a new replacement enum. Existing
`DistributorCashEvent` verification states and canonical accounting/settlement
records remain authoritative. Any new persistence required for handover or
attempt history must be an auditable extension of those workflows, not a
duplicate accounting or inventory ledger.
