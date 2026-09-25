import test from "node:test";
import assert from "node:assert/strict";

const originalEnvironment = {
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ACCESS_TOKEN_EXPIRES_IN: process.env.JWT_ACCESS_TOKEN_EXPIRES_IN,
  JWT_REFRESH_TOKEN_EXPIRES_IN: process.env.JWT_REFRESH_TOKEN_EXPIRES_IN,
};

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

test("JWT config rejects weak signing secrets", async () => {
  process.env.JWT_ACCESS_SECRET = "short-access-secret";
  process.env.JWT_REFRESH_SECRET = "short-refresh-secret";

  const { validateJwtConfig } = await import("../config/jwt.js");
  assert.throws(() => validateJwtConfig(), /at least 32 characters/i);
  restoreEnvironment();
});

test("JWT config accepts distinct strong secrets", async () => {
  process.env.JWT_ACCESS_SECRET = "a".repeat(32);
  process.env.JWT_REFRESH_SECRET = "b".repeat(32);
  process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = "5m";
  process.env.JWT_REFRESH_TOKEN_EXPIRES_IN = "15m";

  const { validateJwtConfig } = await import("../config/jwt.js");
  const config = validateJwtConfig();
  assert.equal(config.accessSecret.length, 32);
  assert.equal(config.refreshSecret.length, 32);
  restoreEnvironment();
});

test("JWT config validation is cached after the first successful validation", async () => {
  process.env.JWT_ACCESS_SECRET = "c".repeat(32);
  process.env.JWT_REFRESH_SECRET = "d".repeat(32);

  const { getJwtConfig } = await import("../config/jwt.js");
  const first = getJwtConfig();
  process.env.JWT_ISSUER = "changed-after-startup";
  const second = getJwtConfig();

  assert.equal(first, second);
  assert.notEqual(second.issuer, "changed-after-startup");
  restoreEnvironment();
});