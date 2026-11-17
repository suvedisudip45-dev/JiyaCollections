import { assertDatabaseToolTargets } from "../utils/integrationDatabaseSafety.js";

const purposes = process.argv.slice(2);
const targets = assertDatabaseToolTargets(purposes);
console.log(JSON.stringify(targets));
