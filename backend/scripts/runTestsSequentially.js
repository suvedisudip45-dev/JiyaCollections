import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = path.join(backendDirectory, "tests");
const databaseIntegrationTests = new Set([
  "accountingEngine.test.js",
  "authHardening.test.js",
  "authIntegration.test.js",
  "capitalSolvency.test.js",
  "customMultiOfferRandomAllocation.test.js",
  "customerAndPartnerCardFlow.test.js",
  "customerOwnershipRegression.test.js",
  "marketingBenefitRandomAllocation.test.js",
  "settlementIdempotencyAndRevert.test.js",
]);

const findTestFiles = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(entryPath);
    return entry.isFile() && /\.(test|spec)\.(c|m)?js$/.test(entry.name) ? [entryPath] : [];
  })
  .sort();

const testFiles = findTestFiles(testsDirectory);
if (testFiles.length === 0) {
  throw new Error(`No test files found under ${testsDirectory}.`);
}

const failedFiles = [];
const skippedFiles = [];
for (const testFile of testFiles) {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1" && databaseIntegrationTests.has(path.basename(testFile))) {
    console.log(`\n=== ${path.relative(backendDirectory, testFile)} (skipped: requires isolated database) ===`);
    skippedFiles.push(testFile);
    continue;
  }
  console.log(`\n=== ${path.relative(backendDirectory, testFile)} ===`);
  const result = spawnSync(process.execPath, ["--test", testFile], {
    cwd: backendDirectory,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not run ${testFile}:`, result.error);
    failedFiles.push(testFile);
  } else if (result.status !== 0) {
    failedFiles.push(testFile);
  }
}

if (failedFiles.length) {
  console.error(`\n${failedFiles.length} test file(s) failed:`);
  for (const testFile of failedFiles) console.error(`- ${path.relative(backendDirectory, testFile)}`);
  process.exitCode = 1;
}

console.log(`\nSequential test run finished: ${testFiles.length - skippedFiles.length} file(s) executed, ${skippedFiles.length} database integration file(s) skipped.`);
