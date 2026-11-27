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

Password-reset codes are random eight-digit values generated with the platform
CSPRNG. The database stores a challenge-bound HMAC, not the code; notifications
carry the code only in the encrypted notification payload. Resend invalidates
the previous code, is cooldown- and attempt-limited, and delivery is
asynchronous. Do not treat a queued notification as proof of SMS delivery.

Driver password recovery is disabled by default. Keep
`PASSWORD_RESET_DRIVER_ENABLED=false` and admin driver-account provisioning
disabled outside development/test until all prerequisites are verified:

- Confirm an HTTPS SMS provider endpoint, credentials, sender configuration,
  and successful end-to-end delivery/recovery in staging. The currently
  documented Sparrow endpoint uses HTTP and is not suitable for production.
- Configure the OTP secret, expiry, attempt/resend settings, reset-token
  lifetime, and the password-reset request/verify/complete IP limits.
- Replace or front the process-local IP limiter with shared/gateway
  enforcement before running multiple API replicas.
- Document support ownership and a controlled account-recovery procedure,
  including notification states `FAILED` and `UNKNOWN`.
- Verify provider delivery, challenge expiry/replay handling, and session
  revocation in staging. Unit tests alone do not satisfy these checks.

Do not enable driver recovery or provisioning based only on the random OTP
implementation. No production recovery operation should be performed until
the above controls and the deployment configuration have been reviewed.

### Driver account recovery handling

This is the supported self-service path; operators must not issue, view, or
request an OTP, TFA token, or password, and must not edit challenge/account
records directly in the database.

1. Verify the requester's identity using the organization's approved
   out-of-band identity-check procedure. The recovery challenge is sent only to
   the active driver's registered phone; do not change contact details as part
   of a recovery request without the separate verified contact-change process.
2. Confirm that the driver understands they must select the DRIVER portal and
   use the email and phone already linked to their active driver account.
3. The driver requests a code, enters the latest SMS code before expiry, and
   completes the password reset. The code is eight digits; successful reset
   revokes existing sessions and requires a normal sign-in.
4. If the notification is `FAILED`, `UNKNOWN`, or remains queued, use approved
   deployment-level notification status tooling, if available. This repository
   does not include a per-message operator UI. `UNKNOWN` is ambiguous and must
   not be described as delivered. A resend is allowed only through the recovery
   UI; it invalidates the previous code.
5. If the challenge expired, was locked, or the account quota was reached,
   explain the generic recovery response and wait for the applicable limit to
   expire. Do not bypass the account/IP limits or disclose account eligibility.
6. Escalate unresolved identity, delivery, or account-linkage cases to the
   designated security/account owner. This repository does not currently
   implement a manual reset override or a verified contact-change workflow.

The identity-check owner, escalation contact, notification-state access roles,
and staging sign-off must be assigned and approved before production driver
provisioning is considered.

### Driver offline delivery synchronization

The driver app can retain assigned-manifest snapshots and unsent POD drafts on
the device. A saved or queued draft is not proof of delivery, payment
collection, or server acceptance. COD verification and final COD collection
confirmation must be completed online; never mark COD as complete based on a
local claim. When connectivity returns, the driver must refresh assigned
manifest state before synchronization. If the outcome is uncertain, compare
the refreshed stop and proof state; do not blindly resubmit or manually edit
database records. A matching server idempotency key means the server already
accepted that draft; a different proof or changed assignment requires the
existing reconciliation process. Preserve conflicted drafts until resolved.
Confirmed local copies expire after 30 days; unresolved records can remain
until the driver deletes local data. On a shared device, clear local driver
data after reconciliation. Offline storage is browser-local and is not
encrypted by the application; full offline delivery authorization and COD
synchronization are not supported.

## Delivery route-order proposals

No external road-routing provider, endpoint, credential, or provider-specific
configuration is currently selected. The manifest UI therefore offers a
reviewable deterministic proposal using the existing priority, time-window,
district, and city order. It does not claim road-distance optimization, live
traffic, or turn-by-turn directions. Distance and duration remain unavailable.
Each preview is marked `DETERMINISTIC_FALLBACK` and omits distance, duration,
traffic, and ETA fields. The existing manifest order is not changed unless a
distributor explicitly reviews and applies the proposal.

The provider-neutral server contract sends only per-request random opaque waypoint IDs and
validated latitude/longitude coordinates. It does not send customer names,
phone numbers, addresses, order details, COD amounts, OTPs, signatures, or
delivery evidence. Provider requests are bounded to five seconds by default,
with one retry by default for timeout, rate-limit, and server failures (the
interface caps retries at two); malformed results are rejected and use the
deterministic fallback. No provider secrets or raw provider errors are
returned to the UI or logged by this routing service.

If a routing provider is proposed for future use, first verify its official API
contract, data handling, credential storage, pricing, and rate limits. Record
those verified details here before configuring an adapter; this repository
does not currently establish any provider costs or quotas. During an outage,
confirm the proposal reports fallback status and continue with the reviewed
deterministic sequence. Never describe fallback as road-optimized.

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

## Distributor operational reconciliation

Authorized distributor operators can open `/distributor/operations` and run a
manual reconciliation. The API requires the active distributor workspace and
the `distributor:operations_read` / `distributor:operations_run` permissions;
acknowledgement additionally requires `distributor:operations_acknowledge`.
Runs are bounded and serialized per distributor. They do not modify business
source records. Finding occurrence/lifecycle metadata is persisted separately;
acknowledgement records that state and an idempotent audit event but does not
resolve or repair a source record. A successful complete run can mark an
absent finding `NO_LONGER_PRESENT`; partial or failed runs must not close
findings. Runs use a distributor-row lock and Serializable transaction
isolation; a concurrent source change may wait or cause the run to fail, in
which case the prior finding state is retained and the operator can retry.

The current report checks existing stock-transfer receipt/custody/ledger/balance
evidence through the canonical stock-transfer reconciler, open inventory
discrepancies, delivered manifest stops missing their POD record, and conflicted
offline drafts or pending drafts at least 24 hours old. It selects identifiers
and safe status/quantity evidence only; it does not read draft payloads, private
evidence, customer contacts, OTPs, or COD amounts. Open the linked existing
workflow to investigate; never edit a ledger or accounting row based on a
finding alone.

Check source coverage and the run status before acting. `PARTIAL` means at
least one source was capped or unavailable; `FAILED` means the run could not
obtain any supported source. Retry a failed/partial run after checking database
availability and the relevant service records. Recent run history is
materialized asynchronously from the audit outbox, so a newly completed run
may appear in history after the audit worker processes its event.

This dashboard does not compare all inventory balances to all ledger history,
dealer invoices to payments, expected COD to remittances, delivery accounting
to all postings, or settlement totals to every journal source. Those checks
remain deferred until their authoritative source links and completeness rules
are established. Do not interpret an empty or partial dashboard as proof of
financial close or platform-wide reconciliation.

### Reconciliation schema rollout

The additive `20261127184000_distributor_reconciliation_findings` migration
creates `DistributorReconciliationFinding` after the parent `Distributor`
table is present. Use the repository's guarded migration command only after
the migration target has independent host/database verification and a tested,
recoverable backup. On a disposable database, first apply the complete
supported migration chain, then validate the new FK, unique key, indexes, and
the reconciliation persistence/integration checks. Apply the migration before
deploying or enabling code that reads/writes finding history; the older
application is compatible with the extra table.

This migration adds one empty table and does not rewrite existing tables or
rows. A precise duration is not known without measuring the target engine.
Expect a short table-creation/index operation, while allowing for metadata-lock
waits and scheduling a maintenance window appropriate to the deployment.
There is no automatic rollback: dropping the table after use loses persisted
finding history. Prefer a forward fix; restore a verified backup only under
the approved recovery procedure. After applying, inspect `SHOW CREATE TABLE`,
the FK/index metadata, and the uniqueness/orphan checks documented in
`DATABASE_AND_SCHEMAS.md`, then verify the authorized dashboard and one
controlled reconciliation/acknowledgement cycle.

Post-migration read-only checks (run with the database selected explicitly):

```sql
SHOW CREATE TABLE `DistributorReconciliationFinding`;

SELECT `INDEX_NAME`, `COLUMN_NAME`, `SEQ_IN_INDEX`
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = 'DistributorReconciliationFinding'
ORDER BY `INDEX_NAME`, `SEQ_IN_INDEX`;

SELECT COUNT(*) AS `orphan_count`
FROM `DistributorReconciliationFinding` f
LEFT JOIN `Distributor` d ON d.`id` = f.`distributorId`
WHERE d.`id` IS NULL;

SELECT `distributorId`, `findingKey`, `occurrence`, COUNT(*) AS `duplicate_count`
FROM `DistributorReconciliationFinding`
GROUP BY `distributorId`, `findingKey`, `occurrence`
HAVING COUNT(*) > 1;
```

Expect the FK/index definitions to match the migration, `orphan_count` to be
zero, and the duplicate query to return no rows. Confirm the database session
timezone is UTC because `DATETIME(3)` does not store a timezone.

### Disposable MySQL integration target

The repository does not provision MySQL for local tests or CI. Do not enable
database integration tests or test migrations until an operator has created a
disposable MySQL instance isolated from production, staging, and developer
databases. The current environment has no verified target, so database tests
and migrations remain intentionally disabled.

Provisioning requirements:

1. Create a fresh isolated MySQL instance and a database whose lowercase name
   ends in `_test`. Create a dedicated account whose lowercase name also ends
   in `_test`; restrict its allowed connection origin to the test runner and
   grant it only the schema-level privileges needed to apply this repository's
   migrations and run tests. Do not reuse a shared or elevated account.
2. Record the instance's `@@hostname`, `@@port`, and `@@server_uuid` through
   the trusted provisioning channel. Generate a new UUID for this test
   instance and insert one identity-marker row into that database:

   ```sql
   CREATE TABLE `__test_database_identity` (
     `singletonId` TINYINT NOT NULL PRIMARY KEY,
     `profile` VARCHAR(64) NOT NULL,
     `instanceId` CHAR(36) NOT NULL
   );

   INSERT INTO `__test_database_identity`
     (`singletonId`, `profile`, `instanceId`)
   VALUES (1, 'disposable-mysql-v1', '<new-instance-uuid>');
   ```

3. Configure `DATABASE_URL` to exactly match
   `ACCOUNTING_TEST_DATABASE_URL`. Set
   `ACCOUNTING_TEST_DATABASE_VERIFIED=1`,
   `ACCOUNTING_TEST_DATABASE_PROFILE=disposable-mysql-v1`, and the matching
   `ACCOUNTING_TEST_DATABASE_HOST`, `ACCOUNTING_TEST_DATABASE_PORT`,
   `ACCOUNTING_TEST_DATABASE_NAME`, `ACCOUNTING_TEST_DATABASE_USER`,
   `ACCOUNTING_TEST_DATABASE_SERVER_HOST`,
   `ACCOUNTING_TEST_DATABASE_SERVER_PORT`,
   `ACCOUNTING_TEST_DATABASE_SERVER_UUID`, and
   `ACCOUNTING_TEST_DATABASE_INSTANCE_ID` values. Keep the password only in
   the test runner's secret environment; never commit or print the URL.
4. Set `RUN_DATABASE_TEST_MIGRATION=1` and run `npm run db:migrate:test` from
   `backend/` to verify the live MySQL identity before applying the migration
   chain. Only after that succeeds, set `RUN_DATABASE_INTEGRATION_TESTS=1` and
   run the focused integration tests or `npm test`. The test runner repeats
   the live identity check before spawning any test process. Both checks
   require the matching database name, account, server host/port/UUID, and
   marker row; missing or mismatched identity fails closed without running
   tests or migrations.
5. After collecting results, destroy only the test database/instance created
   for that run, using the provisioning system's explicit resource identity.
   The repository intentionally has no generic database-drop or cleanup
   command.

The `_test` names and caller-set profile marker are not sufficient by
themselves. The runtime also checks `DATABASE()`, `CURRENT_USER()`,
`@@hostname`, `@@port`, `@@server_uuid`, and the provisioned marker row on the
connected MySQL server, and refuses when `NODE_ENV` or `APP_ENV` is set to a
production/staging profile. The dedicated account's privilege scope and the
instance's disposable status must still be verified out of band by the
operator; these cannot be proven from a connection string alone. Never
substitute the regular migration or maintenance target for this test profile.

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
