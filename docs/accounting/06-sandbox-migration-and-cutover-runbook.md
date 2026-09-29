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
