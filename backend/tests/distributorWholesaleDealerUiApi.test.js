import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..", "..");

test("dealer detail and document routes require distributor authentication and context", async () => {
  const routeFile = await readFile(path.join(repositoryRoot, "backend", "routes", "distributorRoute.js"), "utf8");
  for (const endpoint of [
    "/wholesale/dealers/:dealerId/detail",
    "/wholesale/dealers/:dealerId/documents/:kind/:referenceId",
    "/wholesale/dealers/:dealerId/documents/statement",
  ]) {
    assert.match(routeFile, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(routeFile, /authenticate[\s\S]*setDistributorContext[\s\S]*getWholesaleDealerDetail/);
  assert.match(routeFile, /authenticate[\s\S]*setDistributorContext[\s\S]*getWholesaleDocument/);
});

test("document controller rejects dealer ownership outside authenticated distributor", async () => {
  const controllerFile = await readFile(path.join(repositoryRoot, "backend", "controllers", "distributorWholesaleController.js"), "utf8");
  assert.match(controllerFile, /distributorId:\s*req\.distributorId/);
  assert.match(controllerFile, /where:\s*\{\s*id:\s*dealerId,\s*distributorId:\s*req\.distributorId\s*\}/);
});
