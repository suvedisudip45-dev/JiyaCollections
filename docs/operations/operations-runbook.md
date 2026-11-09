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

An optional one-shot recovery job can be run by an external scheduler with
`npm run delivery:ncm-reconcile` from `backend/`. It is disabled unless
`NCM_DELIVERY_AUTO_RECONCILIATION_ENABLED=true`, requires a server-side NCM token
and explicit base URL, and processes no more than 25 due deliveries per run.
Set `NCM_DELIVERY_RECONCILIATION_STALE_MINUTES` with the operations owner after
confirming the NCM rate limit and expected callback delay. Schedule a single
non-overlapping runner; inspect exit code `2` for flagged reviews, failed
lookups, or remaining backlog. Records requiring manual reconciliation are
not automatically polled again. In production, the job rejects demo/test NCM
hosts. Do not treat successful HTTP polling as proof of COD settlement.

For a staging callback smoke test, use an externally reachable staging API URL
and a dedicated unmatched synthetic order ID. `localhost` (including
`http://localhost:4000`) is reachable only from the machine making the request;
it is not a callback address NCM can reach from its infrastructure. The Admin
Delivery Monitor simulator now calls an authenticated backend endpoint and is
disabled by default. Enable `NCM_WEBHOOK_SIMULATOR_ENABLED=true` only in an
isolated development/staging environment; if `NODE_ENV=production`, also set
`APP_ENV=staging` explicitly. Never put `NCM_WEBHOOK_SECRET` in a `VITE_`
variable or browser bundle. If a webhook secret was previously included in a
deployed frontend build, rotate it and update the backend and NCM configuration.
A simulator event is rejected when its numeric order ID is already linked to a
customer delivery, stock transfer, return, or exchange. Use an unmatched
synthetic ID. This tests receiver processing only; it does not prove that NCM is
configured to deliver callbacks.

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
