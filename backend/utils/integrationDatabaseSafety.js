const profiles = {
  integration: {
    authorization: "RUN_DATABASE_INTEGRATION_TESTS",
    url: "ACCOUNTING_TEST_DATABASE_URL",
    verified: "ACCOUNTING_TEST_DATABASE_VERIFIED",
    host: "ACCOUNTING_TEST_DATABASE_HOST",
    port: "ACCOUNTING_TEST_DATABASE_PORT",
    name: "ACCOUNTING_TEST_DATABASE_NAME",
    label: "Database integration tests",
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
  const missing = [profile.url, profile.verified, profile.host, profile.port, profile.name]
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

export const assertMaintenanceDatabaseSafety = (env = process.env) =>
  assertDatabaseToolSafety("maintenance", env);

export const assertMigrationDatabaseSafety = (env = process.env) =>
  assertDatabaseToolSafety("migration", env);
