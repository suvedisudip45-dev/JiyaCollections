# Sandbox Migration And Cutover Runbook

## Objective

Validate the Treasury-to-GL mapping and associated accounting changes in a sandbox database before any production deployment. This runbook keeps the project aligned with the design philosophy: no live accounting mutation without verified schema integrity, idempotent retry behavior, reconciliation status, and operator sign-off.

## Scope

This runbook covers:

- Prisma schema validation
- sandbox migration execution
- application smoke checks for Treasury and cash flows
- rollback and operator sign-off steps
- the exact conditions that must be satisfied before a production cutover

It does not authorize a production migration.

---

## 1. Preflight checklist

Before running a migration, confirm all of the following:

- the target environment is a sandbox or isolated database
- no production or customer live database is selected
- the Prisma engine lock issue on Windows has been checked and resolved
- the current working branch is approved for accounting changes
- the accounting policy and the Treasury mapping rules are reviewed by the finance approver
- a backup is available for any non-empty sandbox database
- the migration files are reviewed in the repo before execution

Required verification commands:

```bash
cd backend
npx prisma validate
npx prisma generate
```

If the local Prisma client fails because a Windows process is holding the engine binary, stop and investigate before continuing. Do not run a migration against a production or shared environment while the engine is locked.

---

## 2. Sandbox migration steps

### 2.1 Prepare the sandbox database

Use a dedicated sandbox database or a local copy, not the production database.

Example:

```bash
cd backend
npx prisma migrate dev --name add_treasury_gl_mapping
```

This should be run only in a disposable or isolated environment.

### 2.2 If the database needs a baseline diff

If the project uses a pre-existing sandbox database and needs a migration diff review, do this before running the migration:

```bash
cd backend
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
```

This helps confirm the generated migration is additive and does not unexpectedly drop or rewrite historical accounting data.

---

## 3. Runtime validation after migration

After the migration completes, run the following smoke tests in sandbox:

```bash
cd backend
node --test tests/treasuryAccountingService.test.js
node --test tests/accountingOperationalPosters.test.js
node --test tests/nepaliFiscalCalendar.test.js
```

Then validate the Admin app:

```bash
cd admin
npm run build
```

### Required checks

- Treasury accounts can be created only with a valid mapping
- zero-balance creation works
- nonzero opening balance is rejected without a proper opening voucher flow
- internal transfer postings remain balanced
- AP settlement uses the mapped Treasury account and posted payable control account
- manufacturer and distributor payouts reject unmapped, inactive, non-NPR, or type-mismatched Treasury accounts and credit the mapped GL account
- manufacturer delivery bills are reduced by document allocations; supplier credits are recorded for returns backed by those bills
- new distributor requests without earning documents create no AP and cannot be paid before reconciliation
- distributor COD warnings remain visible during service-settlement review; COD and service earnings remain gross unless an approved offset is posted
- AR/NCM receipt postings use the mapped Treasury account and calculate net remittance correctly
- no unsupported category silently posts as a guessed account
- unmapped account warnings appear in reconciliation and health views

---

## 4. Reconciliation gate

The sandbox migration passes only if these conditions are satisfied:

1. Treasury accounts map to GL cash/bank/clearing accounts only
2. all journal lines balance to zero
3. the Treasury account balance matches the mapped GL cash/bank aggregate where the mapping is valid
4. unmapped accounts are visible as `UNMAPPED` or `NOT_RECONCILED`
5. unsupported categories are blocked
6. all APS/AR receipts/payments remain idempotent under retry
7. existing Treasury mappings, legacy manufacturer journals, and old distributor request-accrual AP records have documented reconciliation/backfill decisions

If any check fails, stop the cutover and fix the accounting logic before the next deployment.

---

## 5. Rollback plan

### 5.1 If migration fails before commit

Use Prisma rollback or revert to the previous branch state, depending on the sandbox environment.

Example:

```bash
cd backend
npx prisma migrate resolve --rolled-back <migration_name>
```

Only use this in a disposable environment.

### 5.2 If data is mutated in the sandbox

- restore the sandbox database from backup
- verify that all Treasury mappings and GL balances are reset
- rerun the test suite
- re-check the health/reconciliation endpoints

Never attempt a production rollback without a signed-off cutover plan.

---

## 6. Production cutover gate

Production deployment is allowed only when all of the following are true:

- sandbox migration passes
- Prisma schema validation passes
- the accounting regression suite passes
- Admin build passes
- finance approver reviews the Treasury/GL mapping rules
- reconciliation and health screens show clean or explicit warning states
- no unsupported cash category remains active in the UI
- a rollback procedure and operator sign-off are documented

If even one item fails, do not proceed to production.

---

## 7. Sign-off summary

The migration is ready for production only when the following statement is true:

> The sandbox account mapping and posting checks passed, all test-gated accounting invariants held, the reconciliation health status is acceptable, and the rollback plan is confirmed by the finance approver and engineering owner.

Without this sign-off, treat the migration as incomplete.

---

## 8. Guarded integration-test target verification

Database-backed tests are skipped unless `RUN_DATABASE_INTEGRATION_TESTS=1`. Enabling that flag alone is not authorization to use an arbitrary database. Before setting it, an independent owner must verify the database server identity, host, port, database name, isolation boundary, and access scope. A name containing `test` is not proof of isolation.

The shared Prisma client now fails closed when the integration flag is enabled unless all of the following are supplied in the test process:

```text
RUN_DATABASE_INTEGRATION_TESTS=1
DATABASE_URL=<the explicitly approved isolated MySQL URL>
ACCOUNTING_TEST_DATABASE_URL=<exactly the same URL>
ACCOUNTING_TEST_DATABASE_VERIFIED=1
ACCOUNTING_TEST_DATABASE_HOST=<independently verified host>
ACCOUNTING_TEST_DATABASE_PORT=<independently verified port>
ACCOUNTING_TEST_DATABASE_NAME=<independently verified database name>
```

Do not put credentials in documentation, command history, or source control. Set the approved URL and identity variables through an authorized ephemeral environment; do not silently replace `backend/.env`. The code checks that the two URLs match, the URL is MySQL, the host/port/database match the supplied verified identity, and the database is not named `clothing`. The `ACCOUNTING_TEST_DATABASE_VERIFIED` value is an operator attestation, not automatic proof of isolation; retain the external verification evidence separately.

Current R12 environment inspection found only `backend/.env` with a target resolving to `localhost:3306/clothing`; no explicit isolated-test URL or verified identity settings are present. This target is prohibited. No database connection was attempted. With the current configuration, enabling the integration flag must fail before Prisma creates its client. Persisted migration, financial integration, rollback, concurrency, and source-consistency checks therefore remain **BLOCKED / NOT TESTED**.

The payout concurrency and settlement/reversion integration tests use a `RUN_DATABASE_INTEGRATION_TESTS` opt-in and the shared Prisma client; their target is now subject to this gate. `capitalSolvency.test.js` constructs a Prisma client directly and now calls the same guard before construction. At the time of R12, seed and diagnostic scripts remained outside the integration gate; Section 9 records their R13 follow-up. Static migration-file checks and Prisma schema validation do not contact MySQL and must not be represented as migration-application evidence.

Connection-free validation for R12 passed: `npm run check:migrations` checked 60 migration directories, `npx prisma validate` accepted the schema, and the guard unit/import tests rejected an unsafe `clothing` target before Prisma client construction. None of these results establishes an applied migration or persisted database state.

## 9. R13 database tooling safety and DBA handoff

### Current gate and environment

R13 extended the preflight to three explicit purposes: integration tests, maintenance/seed/diagnostic tools, and migration commands. Each purpose requires its own opt-in flag, approved URL, exact `DATABASE_URL` match, independent host/port/database identity, and `..._VERIFIED=1` operator attestation. The `clothing` database is rejected for every purpose. Setting a database name ending in `_test` is not sufficient. Validation parses configuration only and does not probe the server.

The only configured database identified in R12 remains the prohibited `localhost:3306/clothing`. No verified isolated endpoint, isolated clone, DBA identity evidence, or target credentials have been supplied. No database connection was made in R13. The attestation variables are not proof: before setting them, the DBA must independently provide evidence of the server identity, isolation boundary, database ownership, and the authorization scope. Never set these variables against the current `clothing` target.

### Required process-level variables

Supply these values to the process from an approved secret manager or other authorized ephemeral mechanism; do not write credentials to `.env`, source, documentation, shell history, or test output. `DATABASE_URL` must be exactly the approved URL for the selected purpose.

| Purpose | Required process variables |
| --- | --- |
| Integration tests | `RUN_DATABASE_INTEGRATION_TESTS=1`, `DATABASE_URL`, `ACCOUNTING_TEST_DATABASE_URL`, `ACCOUNTING_TEST_DATABASE_VERIFIED=1`, `ACCOUNTING_TEST_DATABASE_HOST`, `ACCOUNTING_TEST_DATABASE_PORT`, `ACCOUNTING_TEST_DATABASE_NAME` |
| Maintenance, seed, diagnostics | `RUN_DATABASE_MAINTENANCE=1`, `DATABASE_URL`, `ACCOUNTING_MAINTENANCE_DATABASE_URL`, `ACCOUNTING_MAINTENANCE_DATABASE_VERIFIED=1`, `ACCOUNTING_MAINTENANCE_DATABASE_HOST`, `ACCOUNTING_MAINTENANCE_DATABASE_PORT`, `ACCOUNTING_MAINTENANCE_DATABASE_NAME` |
| Migrations | `RUN_DATABASE_MIGRATION=1`, `DATABASE_URL`, `ACCOUNTING_MIGRATION_DATABASE_URL`, `ACCOUNTING_MIGRATION_DATABASE_VERIFIED=1`, `ACCOUNTING_MIGRATION_DATABASE_HOST`, `ACCOUNTING_MIGRATION_DATABASE_PORT`, `ACCOUNTING_MIGRATION_DATABASE_NAME` |

`npm run db:push` requires both migration and maintenance profiles because it can change schema and seed data. `npm run db:reset` remains destructive even when its safety preflight accepts a target; this runbook does not authorize running it. Prefer migration deployment against a DBA-provisioned disposable schema. Direct `npx prisma db ...` commands bypass the package-script wrappers and are not an approved execution route.

For a failed migration, inspect the target schema and migration record before recovery. Use the guarded `npm run db:migrate:resolve -- --rolled-back <migration-name>` wrapper only after confirming the failed migration left no partial objects; then rerun `npm run db:migrate:deploy`. Do not mark a migration rolled back based only on the CLI error.

### Executable isolated-test instructions

After an independent DBA verifies and provisions an isolated target, load the integration variables above into the current PowerShell process from the approved secret mechanism. Set `DATABASE_URL` and `ACCOUNTING_TEST_DATABASE_URL` to the same approved value and supply the matching verified metadata. Then, from `backend/`, run:

```powershell
.\scripts\runIsolatedAccountingTests.ps1 -TestFile tests\financialPayoutConcurrency.integration.test.js
```

Omit `-TestFile` to run the sequential backend suite. The script first runs `scripts/assertDatabaseToolTarget.js integration`; a failed preflight aborts before starting tests. The sequential runner repeats the check and now automatically skips names ending in `.integration.test.js` / `.integration.spec.js` (and the existing explicit database-test list) when integration opt-in is absent. All 21 identified database-backed test modules have a first-evaluated integration guard, including the direct-client `capitalSolvency.test.js`; shared-client construction also validates integration configuration. A direct `node --test` invocation without the integration flag therefore refuses before database test imports proceed.

For a DBA-approved migration validation on a separately provisioned disposable database, set the migration-profile variables in that same process and use `npm run db:migrate:deploy`. Do not substitute `db:push`, `db:reset`, or a raw Prisma CLI command. Migration validation must use separate empty-schema and sanitized-populated targets; do not migrate an original or production database.

### DBA evidence requested before authorization

The DBA must provide to the project owner, out of band:

- The database server/instance identity and verified network host and port, established from the DB administration plane rather than inferred from the URL or database name.
- The exact isolated database name and an explanation of the isolation boundary (separate server/instance or separately controlled disposable database and credentials).
- Written confirmation that the target is not `localhost/clothing`, not production/shared development, and cannot route to a protected database through aliases, proxies, or failover.
- The approved purpose, test window, database privileges, data-retention/deletion plan, and named operator authorized to set the corresponding attestation variables.
- For populated validation, sanitized-source provenance, masking rules, restore logs, row-count/checksum evidence, and confirmation that the source backup was not modified.
- A disposable empty schema for clean migration validation, and an independently restorable sanitized populated copy for upgrade/backfill validation. Keep them distinct from the original source.
- A backup/restore rehearsal record, including restore target identity, verification procedure, and cleanup approval.

The code's `..._VERIFIED=1` values are operator assertions only. They neither establish database isolation nor perform identity verification.

### Future 14-step validation sequence

Do not begin until the DBA evidence above is reviewed and the responsible operator authorizes the target. Run each step against the target dedicated to that step; do not reuse a source or production connection.

1. Record the approved purpose, owner, test window, target identity, permitted operations, and stop/rollback contact.
2. Independently verify the server/instance identity, host, port, and database name through the DBA control plane.
3. Confirm network, account, proxy, and failover isolation from `localhost/clothing`, production, and shared development.
4. Provision a disposable empty schema and a separate sanitized populated copy; do not use one as the other's recovery source.
5. Review sanitization, source provenance, row-count/checksum evidence, and restore logs with the DBA and data owner.
6. Create least-privilege, time-limited accounts scoped only to the approved disposable target; separately confirm required migration and integration privileges.
7. Load the purpose-specific environment variables into a process from the approved secret mechanism; do not edit `.env`.
8. Run the preflight wrapper and confirm the printed result contains only non-secret host, port, and database identity; stop on any mismatch.
9. Run connection-free `npx prisma validate` and `npm run check:migrations`; record them as static checks, not database evidence.
10. Apply committed migrations to the empty disposable schema using `npm run db:migrate:deploy`; capture full output and verify the resulting Prisma migration status.
11. Apply the same committed migration chain to the separately restored sanitized populated copy and verify row counts, conversion evidence, and source balances against the approved baseline.
12. Run the guarded integration cases through `.\scripts\runIsolatedAccountingTests.ps1`; execute payout, payable, receivable, rollback, replay, and concurrency cases only on the isolated target.
13. Verify source/subledger/cash/journal/audit consistency and forced-failure rollback from persisted records; distinguish report/unit tests from these persisted checks and from source-to-journal reconciliation.
14. Rehearse restore to a fresh isolated target, independently verify it, record all results and exceptions, revoke temporary access, and obtain DBA/Finance/engineering sign-off before any separate release decision.

No step above has been run for R13. Persisted migration, restore, integration, and reconciliation evidence remain **BLOCKED / NOT TESTED** until an approved isolated endpoint and DBA evidence are available.
