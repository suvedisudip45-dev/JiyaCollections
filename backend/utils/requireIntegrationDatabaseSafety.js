import {
  assertIntegrationDatabaseSafety,
  verifyConfiguredIntegrationDatabase,
} from "./integrationDatabaseSafety.js";

if (!assertIntegrationDatabaseSafety()) {
  throw new Error("This database integration entry point requires RUN_DATABASE_INTEGRATION_TESTS=1 and a verified isolated target.");
}

await verifyConfiguredIntegrationDatabase("integration");
