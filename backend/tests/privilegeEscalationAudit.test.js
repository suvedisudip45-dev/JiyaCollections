import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(".");
const excluded = new Set([
  "prisma/seed.js",
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

test("RBAC mutations are confined to the audited access-management service", () => {
  const files = collectJsFiles(backendRoot);
  const findings = [];

  for (const file of files) {
    const rel = normalize(path.relative(backendRoot, file));
    if (excluded.has(rel)) continue;

    const text = fs.readFileSync(file, "utf8");
    for (const pattern of mutationSurfacePatterns) {
      if (pattern.test(text)) {
        findings.push(rel);
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
