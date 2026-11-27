import {
  assertDatabaseToolTargets,
  verifyConfiguredIntegrationDatabase,
} from "../utils/integrationDatabaseSafety.js";

const purposes = process.argv.slice(2);
const targets = assertDatabaseToolTargets(purposes);
if (purposes.includes("testMigration")) {
  await verifyConfiguredIntegrationDatabase("testMigration");
}
console.log(JSON.stringify(targets));
