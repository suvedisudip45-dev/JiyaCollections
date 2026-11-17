import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertDatabaseToolSafety,
  assertDatabaseToolTargets,
  assertIntegrationDatabaseSafety,
} from "../utils/integrationDatabaseSafety.js";

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const safeUrl = "mysql://tester:secret@127.0.0.1:3307/accounting_sandbox";

const profileDefinitions = {
  integration: {
    authorization: "RUN_DATABASE_INTEGRATION_TESTS",
    url: "ACCOUNTING_TEST_DATABASE_URL",
    verified: "ACCOUNTING_TEST_DATABASE_VERIFIED",
    host: "ACCOUNTING_TEST_DATABASE_HOST",
    port: "ACCOUNTING_TEST_DATABASE_PORT",
    name: "ACCOUNTING_TEST_DATABASE_NAME",
  },
  maintenance: {
    authorization: "RUN_DATABASE_MAINTENANCE",
    url: "ACCOUNTING_MAINTENANCE_DATABASE_URL",
    verified: "ACCOUNTING_MAINTENANCE_DATABASE_VERIFIED",
    host: "ACCOUNTING_MAINTENANCE_DATABASE_HOST",
    port: "ACCOUNTING_MAINTENANCE_DATABASE_PORT",
    name: "ACCOUNTING_MAINTENANCE_DATABASE_NAME",
  },
  migration: {
    authorization: "RUN_DATABASE_MIGRATION",
    url: "ACCOUNTING_MIGRATION_DATABASE_URL",
    verified: "ACCOUNTING_MIGRATION_DATABASE_VERIFIED",
    host: "ACCOUNTING_MIGRATION_DATABASE_HOST",
    port: "ACCOUNTING_MIGRATION_DATABASE_PORT",
    name: "ACCOUNTING_MIGRATION_DATABASE_NAME",
  },
};

const makeEnvironment = (purpose, overrides = {}) => {
  const profile = profileDefinitions[purpose];
  return {
    [profile.authorization]: "1",
    DATABASE_URL: safeUrl,
    [profile.url]: safeUrl,
    [profile.verified]: "1",
    [profile.host]: "127.0.0.1",
    [profile.port]: "3307",
    [profile.name]: "accounting_sandbox",
    ...overrides,
  };
};

const source = (relativePath) => readFileSync(path.join(backendDirectory, relativePath), "utf8");

test("integration target validation is inert when integration testing is disabled", () => {
  assert.equal(assertIntegrationDatabaseSafety({
    DATABASE_URL: "mysql://tester:secret@localhost:3306/clothing",
  }), null);
});

test("integration opt-in fails closed when any explicit verified target field is missing", () => {
  const missingFields = [
    "DATABASE_URL",
    "ACCOUNTING_TEST_DATABASE_URL",
    "ACCOUNTING_TEST_DATABASE_VERIFIED",
    "ACCOUNTING_TEST_DATABASE_HOST",
    "ACCOUNTING_TEST_DATABASE_PORT",
    "ACCOUNTING_TEST_DATABASE_NAME",
  ];

  for (const field of missingFields) {
    const env = makeEnvironment("integration");
    delete env[field];
    assert.throws(
      () => assertIntegrationDatabaseSafety(env),
      field === "ACCOUNTING_TEST_DATABASE_VERIFIED" ? /explicit target configuration/ : /explicit target configuration|exactly match/,
      field,
    );
  }
});

test("integration target rejects a .env fallback and any URL not exactly approved", () => {
  assert.throws(
    () => assertIntegrationDatabaseSafety({
      RUN_DATABASE_INTEGRATION_TESTS: "1",
      DATABASE_URL: safeUrl,
    }),
    /explicit target configuration/,
  );
  assert.throws(
    () => assertIntegrationDatabaseSafety(makeEnvironment("integration", {
      DATABASE_URL: "mysql://tester:secret@localhost:3306/clothing",
    })),
    /exactly match/,
  );
});

test("all database modes reject malformed URLs, non-MySQL protocols, and unsafe target metadata", () => {
  for (const purpose of Object.keys(profileDefinitions)) {
    assert.throws(
      () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, {
        DATABASE_URL: "not-a-url",
        [profileDefinitions[purpose].url]: "not-a-url",
      })),
      /valid MySQL URL/,
      `${purpose}: malformed URL`,
    );
    assert.throws(
      () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, {
        DATABASE_URL: "postgresql://tester:secret@127.0.0.1:3307/accounting_sandbox",
        [profileDefinitions[purpose].url]: "postgresql://tester:secret@127.0.0.1:3307/accounting_sandbox",
      })),
      /complete MySQL URL/,
      `${purpose}: non-MySQL URL`,
    );
    assert.throws(
      () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, {
        [profileDefinitions[purpose].verified]: "0",
      })),
      /independently verified/,
      `${purpose}: unverified target`,
    );
  }
});

test("all database modes reject the prohibited clothing database regardless of host casing", () => {
  for (const purpose of Object.keys(profileDefinitions)) {
    const profile = profileDefinitions[purpose];
    const clothingUrl = "mysql://tester:secret@127.0.0.1:3307/CLOTHING";
    assert.throws(
      () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, {
        DATABASE_URL: clothingUrl,
        [profile.url]: clothingUrl,
        [profile.name]: "CLOTHING",
      })),
      /prohibited clothing database/,
      purpose,
    );
  }
});

test("all database modes require exact independently verified host, port, and database identity", () => {
  for (const purpose of Object.keys(profileDefinitions)) {
    const profile = profileDefinitions[purpose];
    for (const [field, value] of [
      [profile.host, "localhost"],
      [profile.port, "3308"],
      [profile.name, "another_database"],
    ]) {
      assert.throws(
        () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, { [field]: value })),
        /does not match/,
        `${purpose}: ${field}`,
      );
    }
    assert.throws(
      () => assertDatabaseToolSafety(purpose, makeEnvironment(purpose, { [profile.port]: "0" })),
      /valid expected host, port, and database name/,
      `${purpose}: invalid port`,
    );
  }
});

test("maintenance and migration operations require their own explicit authorization flags", () => {
  for (const purpose of ["maintenance", "migration"]) {
    const profile = profileDefinitions[purpose];
    const env = makeEnvironment(purpose);
    delete env[profile.authorization];
    assert.throws(
      () => assertDatabaseToolSafety(purpose, env),
      new RegExp(`${profile.authorization}=1`),
    );
  }
});

test("combined migration and seed operations validate both profiles against one target", () => {
  const env = {
    ...makeEnvironment("migration"),
    ...makeEnvironment("maintenance"),
  };
  assert.deepEqual(assertDatabaseToolTargets(["migration", "maintenance"], env), [
    { host: "127.0.0.1", port: "3307", databaseName: "accounting_sandbox" },
    { host: "127.0.0.1", port: "3307", databaseName: "accounting_sandbox" },
  ]);
});

test("accepted target validation is configuration-only and returns identity without connecting", () => {
  assert.deepEqual(assertIntegrationDatabaseSafety(makeEnvironment("integration")), {
    host: "127.0.0.1",
    port: "3307",
    databaseName: "accounting_sandbox",
  });
});

test("maintenance entry point guard refuses to proceed before any database client is loaded", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'await import("./utils/requireMaintenanceDatabaseSafety.js")',
  ], {
    cwd: backendDirectory,
    env: { ...process.env, RUN_DATABASE_MAINTENANCE: "", DATABASE_URL: "" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RUN_DATABASE_MAINTENANCE=1/);
});

test("direct seed entry point refuses before constructing Prisma without maintenance authorization", () => {
  const result = spawnSync(process.execPath, ["prisma/seed.js"], {
    cwd: backendDirectory,
    env: {
      PATH: process.env.PATH || "",
      SystemRoot: process.env.SystemRoot || "",
      RUN_DATABASE_MAINTENANCE: "0",
      DATABASE_URL: "",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RUN_DATABASE_MAINTENANCE=1/);
});

test("migration target preflight refuses an invocation without explicit authorization", () => {
  const result = spawnSync(process.execPath, ["scripts/assertDatabaseToolTarget.js", "migration"], {
    cwd: backendDirectory,
    env: { ...process.env, RUN_DATABASE_MIGRATION: "", DATABASE_URL: "" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RUN_DATABASE_MIGRATION=1/);
});

test("sequential test runner rejects unsafe integration opt-in before spawning any test", () => {
  const result = spawnSync(process.execPath, ["scripts/runTestsSequentially.js"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      RUN_DATABASE_INTEGRATION_TESTS: "1",
      DATABASE_URL: "mysql://tester:secret@localhost:3306/clothing",
      ACCOUNTING_TEST_DATABASE_URL: "",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit target configuration|exactly match/);
  assert.doesNotMatch(result.stdout, /=== .*\\.test\\.js/);
});

test("direct integration guard refuses an unapproved test process before Prisma import", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'await import("./utils/requireIntegrationDatabaseSafety.js")',
  ], {
    cwd: backendDirectory,
    env: {
      PATH: process.env.PATH || "",
      SystemRoot: process.env.SystemRoot || "",
      RUN_DATABASE_INTEGRATION_TESTS: "0",
      DATABASE_URL: "",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RUN_DATABASE_INTEGRATION_TESTS=1/);
});

test("shared Prisma client validates integration configuration before construction", () => {
  const dbConfig = source("config/db.js");
  assert.ok(dbConfig.indexOf("assertIntegrationDatabaseSafety();") < dbConfig.indexOf("new PrismaClient("));
});

test("direct Prisma integration test and sequential runner preflight before running tests", () => {
  const directTest = source("tests/capitalSolvency.test.js");
  assert.ok(directTest.indexOf('import "../utils/requireIntegrationDatabaseSafety.js";') <
    directTest.indexOf('import { PrismaClient }'));
  const runner = source("scripts/runTestsSequentially.js");
  assert.ok(runner.indexOf("assertIntegrationDatabaseSafety();") < runner.indexOf("const result = spawnSync("));
  assert.match(runner, /\.integration\\\.\(test\|spec\)/);

  const databaseTestFiles = [
    "tests/accountingEngine.test.js",
    "tests/authHardening.test.js",
    "tests/authIntegration.test.js",
    "tests/capitalSolvency.test.js",
    "tests/customMultiOfferRandomAllocation.test.js",
    "tests/customerAndPartnerCardFlow.test.js",
    "tests/customerOwnershipRegression.test.js",
    "tests/marketingBenefitRandomAllocation.test.js",
    "tests/operationalFlawsResolution.test.js",
    "tests/settlementIdempotencyAndRevert.test.js",
    "tests/adminDirectOrderService.integration.test.js",
    "tests/collaborationFeeCreditApplication.integration.test.js",
    "tests/collaborationSales.integration.test.js",
    "tests/financialPayoutConcurrency.integration.test.js",
    "tests/marketingPartnerAccounting.integration.test.js",
    "tests/operatingExpenseDecimal.integration.test.js",
    "tests/orderPaymentAccounting.integration.test.js",
    "tests/shareEquityIntegrity.integration.test.js",
    "tests/supplierCreditApplication.integration.test.js",
    "tests/supplierReturnCreditApplication.integration.test.js",
    "tests/supplierReturnService.integration.test.js",
  ];
  for (const file of databaseTestFiles) {
    assert.ok(
      source(file).startsWith('import "../utils/requireIntegrationDatabaseSafety.js";'),
      `${file} must preflight before test imports`,
    );
  }
});

test("database maintenance scripts and direct-client seed are guarded before connection construction", () => {
  const guardedScripts = [
    "prisma/seed.js",
    "scripts/backfillInventoryLedger.js",
    "scripts/reportOperationalExceptions.js",
    "scripts/checkNotificationHealth.js",
    "scripts/test_statements.js",
    "scripts/check_orders.js",
    "scripts/check_cashflow.js",
  ];

  for (const file of guardedScripts) {
    const content = source(file);
    assert.ok(content.includes("requireMaintenanceDatabaseSafety.js"), `${file} must load the maintenance gate`);
    const guardIndex = content.indexOf("requireMaintenanceDatabaseSafety.js");
    const clientIndex = Math.min(
      ...[content.indexOf("new PrismaClient("), content.indexOf("prisma.$connect(")]
        .filter((index) => index >= 0),
    );
    assert.ok(clientIndex === Infinity || guardIndex < clientIndex, `${file} gate must precede client use`);
  }
});

test("package migration, reset, push, and seed commands invoke the preflight wrapper", () => {
  const packageJson = JSON.parse(source("package.json"));
  const { scripts } = packageJson;
  assert.match(scripts["db:migrate:deploy"], /assertDatabaseToolTarget\.js migration/);
  assert.match(scripts["db:sync"], /assertDatabaseToolTarget\.js migration/);
  assert.match(scripts["db:reset"], /assertDatabaseToolTarget\.js migration/);
  assert.match(scripts["db:push"], /assertDatabaseToolTarget\.js migration maintenance/);
  assert.match(scripts["db:seed"], /assertDatabaseToolTarget\.js maintenance/);
});

test("normal application operation remains ungated unless integration mode is explicitly enabled", () => {
  assert.equal(assertIntegrationDatabaseSafety({ DATABASE_URL: safeUrl }), null);
});
