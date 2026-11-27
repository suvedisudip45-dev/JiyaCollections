import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([
  "prisma/seed.js",
  "services/rbacSeedService.js",
  "services/rbacService.js",
  "services/accessManagementService.js",
  "controllers/accessManagementController.js",
  "tests/privilegeEscalationAudit.test.js",
  "tests/rbacAuthorization.test.js",
  "tests/authHardening.test.js",
  "tests/customerOwnershipRegression.test.js",
]);

const collectJsFiles = (dir) => {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "tests") continue;
      files.push(...collectJsFiles(full));
    } else if (entry.isFile() && full.endsWith(".js")) {
      const rel = normalize(path.relative(backendRoot, full));
      if (!excluded.has(rel)) files.push(full);
    }
  }
  return files;
};

const normalize = (value) => value.replace(/\\/g, "/");

const mutationSurfacePatterns = [
  /\broleId\s*[:=]/i,
  /\bpermissionId\s*[:=]/i,
  /req\.body\.(role|roles|permission|permissions|roleId|permissionId)\b/i,
  /prisma\.(role|permission|rolePermissionMapping|authAccountRoleMapping)\.(create|update|upsert|delete|updateMany)\s*\(/i,
  /\bassign(?:ment)?\s+(?:role|permission)\b/i,
  /\bgrant(?:ed|ing)?\s+(?:role|permission)\b/i,
  /\bself\s*[-\w]*\s*(?:assign|grant)\s+(?:role|permission)\b/i,
  /\ball:function\b.*\b(?:assign|grant|self)\b/i,
  /\bSUPER_ADMIN\b/i,
];

const isConstrainedDriverProvisioningSurface = (source, routeSource) => (
  /!\["development",\s*"test"\]\.includes\(String\(env\.NODE_ENV\s*\|\|\s*""\)\.toLowerCase\(\)\)/i.test(source) &&
  /code:\s*"DRIVER",\s*portalScope:\s*"DRIVER",\s*isActive:\s*true/i.test(source) &&
  /role:\s*"DRIVER"/i.test(source) &&
  /authAccountRoleMapping\.create\(\s*\{\s*data:\s*\{\s*accountId:\s*account\.id,\s*roleId:\s*role\.id,\s*isActive:\s*true/s.test(source) &&
  /accountId:\s*null[\s\S]*?distributor:\s*\{\s*is:\s*\{\s*status:\s*"ACTIVE",\s*isActive:\s*true/s.test(source) &&
  /deliveryDriver\.updateMany\(\s*\{\s*where:\s*\{\s*id:\s*driver\.id,\s*distributorId,\s*status:\s*"ACTIVE",\s*accountId:\s*null\s*\}/s.test(source) &&
  /linked\.count\s*!==\s*1/.test(source) &&
  /authenticate,\s*requireRole\("ADMIN"\),\s*authorize\(permissions\)/.test(routeSource) &&
  /driver-provisioning\/accounts[\s\S]*?access:driver_users_manage/.test(routeSource)
);

test("RBAC mutations are confined to the audited access-management service", () => {
  const files = collectJsFiles(backendRoot);
  const findings = [];
  const driverProvisioningPath = path.join(backendRoot, "services", "adminDriverAccessService.js");
  const driverProvisioningSource = fs.readFileSync(driverProvisioningPath, "utf8");
  const driverRouteSource = fs.readFileSync(path.join(backendRoot, "routes", "accessManagementRoute.js"), "utf8");
  assert.ok(
    mutationSurfacePatterns.some((pattern) => pattern.test(driverProvisioningSource)),
    "The scanner must continue to detect the driver provisioning role assignment.",
  );
  assert.ok(
    isConstrainedDriverProvisioningSurface(driverProvisioningSource, driverRouteSource),
    "Driver provisioning must remain fixed-role, environment-gated, ownership-checked, and Admin-authorized.",
  );

  for (const file of files) {
    const rel = normalize(path.relative(backendRoot, file));
    if (excluded.has(rel)) continue;

    const text = fs.readFileSync(file, "utf8");
    for (const pattern of mutationSurfacePatterns) {
      if (pattern.test(text)) {
        const isReviewedProvisioningSurface = isConstrainedDriverProvisioningSurface(text, driverRouteSource);
        if (!isReviewedProvisioningSurface) findings.push(rel);
        break;
      }
    }
  }

  assert.deepEqual(findings, [], `Unexpected privilege mutation surface in: ${findings.join(", ") || "none"}`);
});

test("every Admin access-management route requires authentication, Admin role, and granular permission", () => {
  const routePath = path.join(backendRoot, "routes", "accessManagementRoute.js");
  const source = fs.readFileSync(routePath, "utf8");
  const routeLines = source.split(/\r?\n/).filter((line) => /accessManagementRouter\.(get|post|put|patch|delete)\(/.test(line));

  assert.ok(routeLines.length > 0);
  assert.ok(source.includes("[authenticate, requireRole(\"ADMIN\"), authorize(permissions)]"));
  assert.ok(routeLines.every((line) => line.includes("...protectedBy(\"access:")));
  assert.equal(routeLines.some((line) => /accessManagementRouter\.delete\(/.test(line)), false);
  assert.ok(source.includes("protectedBy(\"access:admin_users_create\", \"access:admin_users_assign_roles\")"));
});

test("driver provisioning classification rejects caller-controlled or unprotected role assignment", () => {
  const safeSource = fs.readFileSync(
    path.join(backendRoot, "services", "adminDriverAccessService.js"),
    "utf8",
  );
  const routeSource = fs.readFileSync(path.join(backendRoot, "routes", "accessManagementRoute.js"), "utf8");
  const callerControlledRole = safeSource.replace('role: "DRIVER"', "role: rawRole");
  const unguardedLink = safeSource.replace(
    'where: { id: driver.id, distributorId, status: "ACTIVE", accountId: null }',
    "where: { id: driver.id }",
  );

  assert.equal(isConstrainedDriverProvisioningSurface(callerControlledRole, routeSource), false);
  assert.equal(isConstrainedDriverProvisioningSurface(unguardedLink, routeSource), false);
  assert.equal(isConstrainedDriverProvisioningSurface(safeSource, routeSource), true);
});
