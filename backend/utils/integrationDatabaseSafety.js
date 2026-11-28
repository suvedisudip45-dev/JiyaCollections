import { PrismaClient } from "@prisma/client";

const disposableProfile = {
  url: "ACCOUNTING_TEST_DATABASE_URL",
  verified: "ACCOUNTING_TEST_DATABASE_VERIFIED",
  host: "ACCOUNTING_TEST_DATABASE_HOST",
  port: "ACCOUNTING_TEST_DATABASE_PORT",
  name: "ACCOUNTING_TEST_DATABASE_NAME",
  user: "ACCOUNTING_TEST_DATABASE_USER",
  profileName: "ACCOUNTING_TEST_DATABASE_PROFILE",
  serverHost: "ACCOUNTING_TEST_DATABASE_SERVER_HOST",
  serverPort: "ACCOUNTING_TEST_DATABASE_SERVER_PORT",
  serverUuid: "ACCOUNTING_TEST_DATABASE_SERVER_UUID",
  instanceId: "ACCOUNTING_TEST_DATABASE_INSTANCE_ID",
  isolated: true,
};

const profiles = {
  integration: {
    authorization: "RUN_DATABASE_INTEGRATION_TESTS",
    label: "Database integration tests",
    ...disposableProfile,
  },
  testMigration: {
    authorization: "RUN_DATABASE_TEST_MIGRATION",
    label: "Disposable test database migrations",
    ...disposableProfile,
  },
  maintenance: {
    authorization: "RUN_DATABASE_MAINTENANCE",
    url: "ACCOUNTING_MAINTENANCE_DATABASE_URL",
    verified: "ACCOUNTING_MAINTENANCE_DATABASE_VERIFIED",
    host: "ACCOUNTING_MAINTENANCE_DATABASE_HOST",
    port: "ACCOUNTING_MAINTENANCE_DATABASE_PORT",
    name: "ACCOUNTING_MAINTENANCE_DATABASE_NAME",
    label: "Database maintenance tools",
  },
  migration: {
    authorization: "RUN_DATABASE_MIGRATION",
    url: "ACCOUNTING_MIGRATION_DATABASE_URL",
    verified: "ACCOUNTING_MIGRATION_DATABASE_VERIFIED",
    host: "ACCOUNTING_MIGRATION_DATABASE_HOST",
    port: "ACCOUNTING_MIGRATION_DATABASE_PORT",
    name: "ACCOUNTING_MIGRATION_DATABASE_NAME",
    label: "Database migration tools",
  },
};

const validateTarget = (profile, env) => {
  const requiredKeys = [
    profile.url,
    profile.verified,
    profile.host,
    profile.port,
    profile.name,
    ...(profile.isolated
      ? [
          profile.user,
          profile.profileName,
          profile.serverHost,
          profile.serverPort,
          profile.serverUuid,
          profile.instanceId,
        ]
      : []),
  ];
  const missing = requiredKeys
    .filter((name) => !String(env[name] || "").trim());
  if (missing.length) {
    throw new Error(`${profile.label} require explicit target configuration: ${missing.join(", ")}.`);
  }
  if (env[profile.verified] !== "1") {
    throw new Error(`${profile.label} require independently verified target metadata before they can run.`);
  }

  const databaseUrl = String(env.DATABASE_URL || "");
  const approvedDatabaseUrl = String(env[profile.url] || "");
  if (!databaseUrl || databaseUrl.trim() !== databaseUrl || databaseUrl !== approvedDatabaseUrl) {
    throw new Error(`DATABASE_URL must exactly match ${profile.url}; refusing configuration fallback.`);
  }

  let url;
  let databaseName;
  try {
    url = new URL(databaseUrl);
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error(`${profile.label} require a valid MySQL URL.`);
  }

  const host = url.hostname.toLowerCase();
  const port = url.port || "3306";
  const expectedHost = String(env[profile.host]).trim().toLowerCase();
  const expectedPort = String(env[profile.port]).trim();
  const expectedDatabaseName = String(env[profile.name]).trim();
  const numericPort = Number(expectedPort);
  if (url.protocol !== "mysql:" || !host || !databaseName || databaseName.includes("/") ||
      !/^\d+$/.test(expectedPort) || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error(`${profile.label} require a complete MySQL URL and valid expected host, port, and database name.`);
  }
  if (databaseName.toLowerCase() === "clothing") {
    throw new Error("Refusing to connect to the prohibited clothing database.");
  }
  if (host !== expectedHost || port !== expectedPort || databaseName !== expectedDatabaseName) {
    throw new Error(`The database URL does not match the independently verified ${profile.host}, ${profile.port}, and ${profile.name} values.`);
  }
  if (profile.isolated) {
    const deploymentProfiles = [
      String(env.NODE_ENV || "").trim().toLowerCase(),
      String(env.APP_ENV || "").trim().toLowerCase(),
    ];
    if (deploymentProfiles.some((value) => ["prod", "production", "stage", "staging"].includes(value))) {
      throw new Error("The disposable-mysql-v1 profile cannot run when the process has a production or staging profile.");
    }
    const expectedUser = String(env[profile.user]).trim();
    const expectedServerPort = String(env[profile.serverPort]).trim();
    const serverUuid = String(env[profile.serverUuid]).trim().toLowerCase();
    const instanceId = String(env[profile.instanceId]).trim().toLowerCase();
    const username = decodeURIComponent(url.username);
    if (
      env[profile.profileName] !== "disposable-mysql-v1" ||
      !/^[a-z0-9][a-z0-9_]*_test$/.test(databaseName) ||
      !/^[a-z0-9][a-z0-9_]*_test$/.test(expectedUser) ||
      username !== expectedUser ||
      !/^\d+$/.test(expectedServerPort) ||
      Number(expectedServerPort) < 1 ||
      Number(expectedServerPort) > 65535 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(serverUuid) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId)
    ) {
      throw new Error(`${profile.label} require a disposable-mysql-v1 profile, a *_test database and user, and verified server/instance identity metadata.`);
    }
  }

  return { host, port, databaseName };
};

export const assertDatabaseToolSafety = (purpose, env = process.env) => {
  const profile = profiles[purpose];
  if (!profile) throw new Error(`Unsupported database tool purpose: ${purpose}.`);
  if (env[profile.authorization] !== "1") {
    throw new Error(`${profile.authorization}=1 is required to run ${profile.label.toLowerCase()}.`);
  }
  return validateTarget(profile, env);
};

export const assertDatabaseToolTargets = (purposes, env = process.env) => {
  if (!Array.isArray(purposes) || purposes.length === 0) {
    throw new Error("At least one database tool purpose must be authorized.");
  }
  return purposes.map((purpose) => assertDatabaseToolSafety(purpose, env));
};

export const assertIntegrationDatabaseSafety = (env = process.env) => {
  if (env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return null;
  return validateTarget(profiles.integration, env);
};

export const verifyIntegrationDatabaseIdentity = async (
  client,
  purpose = "integration",
  env = process.env,
) => {
  const profile = profiles[purpose];
  if (!profile?.isolated) {
    throw new Error("Database identity verification is restricted to disposable integration/test-migration profiles.");
  }
  const target = assertDatabaseToolSafety(purpose, env);
  if (!client || typeof client.$queryRaw !== "function") {
    throw new Error("A connected Prisma client is required to verify the disposable MySQL identity.");
  }

  let identityMismatch = false;
  try {
    const identities = await client.$queryRaw`
      SELECT
        DATABASE() AS databaseName,
        CURRENT_USER() AS currentUser,
        @@hostname AS serverHost,
        @@port AS serverPort,
        @@server_uuid AS serverUuid
    `;
    const markers = await client.$queryRaw`
      SELECT \`profile\`, \`instanceId\`
      FROM \`__test_database_identity\`
      WHERE \`singletonId\` = 1
      LIMIT 1
    `;
    const identity = identities?.[0];
    const marker = markers?.[0];
    const currentUser = String(identity?.currentUser || "").split("@", 1)[0];
    const actualServerPort = String(identity?.serverPort || "");
    const serverUuid = String(identity?.serverUuid || "").toLowerCase();
    const instanceId = String(marker?.instanceId || "").toLowerCase();
    const expectedUser = String(env[profile.user]).trim();
    const expectedServerHost = String(env[profile.serverHost]).trim().toLowerCase();
    const expectedServerPort = String(env[profile.serverPort]).trim();
    const expectedServerUuid = String(env[profile.serverUuid]).trim().toLowerCase();
    const expectedInstanceId = String(env[profile.instanceId]).trim().toLowerCase();

    if (
      !identity ||
      identity.databaseName !== target.databaseName ||
      currentUser !== expectedUser ||
      String(identity.serverHost || "").toLowerCase() !== expectedServerHost ||
      actualServerPort !== expectedServerPort ||
      serverUuid !== expectedServerUuid ||
      marker?.profile !== "disposable-mysql-v1" ||
      instanceId !== expectedInstanceId
    ) {
      identityMismatch = true;
      throw new Error("The connected MySQL identity does not match the verified disposable-test profile.");
    }
    return target;
  } catch {
    if (identityMismatch) {
      throw new Error("The connected MySQL identity does not match the verified disposable-test profile.");
    }
    throw new Error("Could not verify the connected disposable MySQL identity; refusing database work.");
  }
};

export const verifyConfiguredIntegrationDatabase = async (
  purpose = "integration",
  env = process.env,
) => {
  const profile = profiles[purpose];
  if (!profile?.isolated) {
    throw new Error("A disposable integration/test-migration profile is required.");
  }
  assertDatabaseToolSafety(purpose, env);
  const client = new PrismaClient({
    log: [],
    datasources: { db: { url: env.DATABASE_URL } },
  });
  let verified = false;
  try {
    await client.$connect();
    await verifyIntegrationDatabaseIdentity(client, purpose, env);
    verified = true;
  } catch {
    verified = false;
  } finally {
    try {
      await client.$disconnect();
    } catch {
      verified = false;
    }
  }
  if (!verified) {
    throw new Error("Could not verify the configured disposable MySQL identity; refusing database work.");
  }
};

export const assertMaintenanceDatabaseSafety = (env = process.env) =>
  assertDatabaseToolSafety("maintenance", env);

export const assertMigrationDatabaseSafety = (env = process.env) =>
  assertDatabaseToolSafety("migration", env);
