import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MIXED_PORTALS, resolveSpaEntryForPath } from "../deployment/mixed-portals/routing.mjs";
import {
  getDistributorHomePath,
  getDistributorPath,
  getWorkspaceBasePath,
} from "../manufacturer/src/utils/workspaceRoutes.js";

const readDeploymentFile = (name) =>
  readFile(new URL(`../deployment/mixed-portals/${name}`, import.meta.url), "utf8");

test("each independent portal build has a unique output directory and base path", () => {
  assert.deepEqual(
    MIXED_PORTALS.map(({ outputDirectory }) => outputDirectory),
    ["admin", "manufacturer", "marketing"]
  );
  assert.equal(new Set(MIXED_PORTALS.map(({ outputDirectory }) => outputDirectory)).size, MIXED_PORTALS.length);
  assert.equal(new Set(MIXED_PORTALS.map(({ basePath }) => basePath)).size, MIXED_PORTALS.length);
});

test("known path prefixes fall back to their own application entry", () => {
  assert.equal(resolveSpaEntryForPath("/admin"), "/admin/index.html");
  assert.equal(resolveSpaEntryForPath("/admin/login"), "/admin/index.html");
  assert.equal(resolveSpaEntryForPath("/admin/orders/123"), "/admin/index.html");
  assert.equal(resolveSpaEntryForPath("/manufacturer"), "/manufacturer/index.html");
  assert.equal(resolveSpaEntryForPath("/manufacturer/production"), "/manufacturer/index.html");
  assert.equal(resolveSpaEntryForPath("/distributor"), "/manufacturer/index.html");
  assert.equal(resolveSpaEntryForPath("/distributor/orders/123"), "/manufacturer/index.html");
  assert.equal(resolveSpaEntryForPath("/marketing"), "/marketing/index.html");
  assert.equal(resolveSpaEntryForPath("/marketing/campaigns/123"), "/marketing/index.html");
});

test("root and unknown paths do not fall through to a portal", () => {
  assert.equal(resolveSpaEntryForPath("/"), "/index.html");
  assert.equal(resolveSpaEntryForPath("/unknown/path"), "/404.html");
  assert.equal(resolveSpaEntryForPath("/administrator/login"), "/404.html");
});

test("Netlify rewrites preserve the separate Distributor workspace entry", async () => {
  const redirects = await readDeploymentFile("_redirects");
  assert.match(redirects, /^\/admin\/\* \/admin\/index\.html 200$/m);
  assert.match(redirects, /^\/manufacturer\/\* \/manufacturer\/index\.html 200$/m);
  assert.match(redirects, /^\/distributor\/\* \/manufacturer\/index\.html 200$/m);
  assert.match(redirects, /^\/marketing\/\* \/marketing\/index\.html 200$/m);
  assert.match(redirects, /^\/admin\/assets\/\* \/404\.html 404$/m);
  assert.doesNotMatch(redirects, /^\/\* /m);
});

test("cPanel rewrites route only the declared application prefixes", async () => {
  const rules = await readDeploymentFile(".htaccess");
  assert.match(rules, /RewriteRule \^admin/);
  assert.match(rules, /RewriteRule \^manufacturer.*\/manufacturer\/index\.html/);
  assert.match(rules, /RewriteRule \^distributor.*\/manufacturer\/index\.html/);
  assert.match(rules, /RewriteRule \^marketing.*\/marketing\/index\.html/);
  assert.match(rules, /RewriteRule \^\(\?:admin\|manufacturer\|marketing\)\/assets\/ - \[R=404,L\]/);
  assert.match(rules, /ErrorDocument 404 \/404\.html/);
});

test("the workspace selector links to each distinct portal login", async () => {
  const html = await readDeploymentFile("index.html");
  for (const href of ["/admin/login", "/manufacturer/login", "/distributor/login", "/marketing/login"]) {
    assert.ok(html.includes(`href="${href}"`), `Missing workspace link ${href}`);
  }
});

test("Manufacturer and Distributor paths share the app while preserving workspace selection", () => {
  assert.equal(getWorkspaceBasePath("/manufacturer/", "/manufacturer/production"), "/manufacturer");
  assert.equal(getWorkspaceBasePath("/manufacturer/", "/distributor/orders/123"), "/distributor");
  assert.equal(getDistributorPath("/manufacturer/", "/demand"), "/demand");
  assert.equal(getDistributorPath("/", "/demand"), "/distributor/demand");
  assert.equal(getDistributorPath("/", "/orders"), "/orders");
  assert.equal(getDistributorPath("/", "/ncm"), "/ncm");
  assert.equal(getDistributorHomePath("/manufacturer/"), "/");
  assert.equal(getDistributorHomePath("/"), "/distributor");
});

test("mixed portal access-token storage keys remain isolated", async () => {
  const portalFiles = ["admin", "manufacturer", "marketing"].map((portal) =>
    new URL(`../${portal}/src/auth/tokenStorage.js`, import.meta.url)
  );
  const accessTokenKeys = await Promise.all(portalFiles.map(async (url) => {
    const source = await readFile(url, "utf8");
    const match = source.match(/ACCESS_TOKEN_KEY\s*=\s*"([^"]+)"/);
    assert.ok(match, `Missing access-token key in ${url.pathname}`);
    return match[1];
  }));
  assert.equal(new Set(accessTokenKeys).size, accessTokenKeys.length);
});
