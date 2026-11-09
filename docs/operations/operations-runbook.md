# Operations Runbook

This runbook covers repository-supported checks. It does not claim live access
to the hosting platform, production database, or NCM account. Assign named
primary and backup operators for delivery reconciliation and finance close
before production use.

## Service and notification health

From `backend/`, schedule these checks through the deployment platform or an
operations runner:

- `npm run notifications:health` checks RabbitMQ connectivity, enabled queue
  consumers/depth, notification state counts, and the oldest pending/queued
  message. A nonzero exit indicates a failed dependency or missing consumer.
- `npm run ops:exceptions` reports locally tracked delivery reconciliation
  cases, ambiguous NCM return/exchange attempts, open NCM settlement variances,
  and unresolved delivered-sale accounting events. Exit code `2` means
  reviewable exceptions were found; exit code `1` means the report itself
  failed.

Alert on sustained queue age, notification `FAILED`, `DEAD_LETTERED`, or
`UNKNOWN` counts, repeated stock-projection degradation from `/health/ready`,
and unresolved delivery/accounting exceptions. Set age thresholds with the
business owners and expected provider/settlement cadence; this repository
does not choose a production SLA.

The fixed password-reset OTP `111111` and the existing development/test-only
password-recovery gate are unchanged. Do not enable password recovery in other
environments.

## Delivery and NCM reconciliation

Review the Admin Delivery Monitor's `NEEDS_RECONCILIATION` queue each business
day and after carrier incidents. Inspect return/exchange attempts whose outcome
is ambiguous and keep them blocked from automatic resubmission until NCM
confirms whether the carrier created the operation. Record the Admin decision,
carrier reference, evidence, and follow-up owner in the existing audited
workflow.

After each NCM remittance, reconcile locally linked orders, COD, carrier fees,
and any open/partially resolved settlement variance against the carrier
statement and bank evidence. NCM does not expose a complete order listing or a
full payable/receivable ledger through the configured integration. The report
therefore counts local records only and cannot prove that carrier-only
transactions are absent.

## Accounting exception handling

Review failed or blocked delivered-sale accounting events and their linked
source order before retrying or correcting them. Verify that the source snapshot
and journal state agree; preserve idempotency and use the existing Accounting
Health and audited recovery flows. A pending event may be normal while waiting
for its retry schedule, so review age and status together rather than treating
every pending count as a failure.

Do not delete, manually rewrite, or mark exception rows resolved without the
corresponding source evidence and audit trail. Keep the report output and
resolution references with the relevant close/reconciliation records under the
organization's approved retention policy.
