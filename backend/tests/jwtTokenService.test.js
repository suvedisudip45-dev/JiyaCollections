import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ??= "access-token-secret-for-tests-123456";
process.env.JWT_REFRESH_SECRET ??= "refresh-token-secret-for-tests-123456";
process.env.JWT_ISSUER ??= "clothes-store-api";
process.env.JWT_AUDIENCE ??= "clothes-store-clients";
process.env.JWT_ACCESS_TOKEN_EXPIRES_IN ??= "5m";
process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ??= "15m";

const { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken } = await import("../services/tokenService.js");

test("access and refresh tokens are signed with the correct JWT config and contain token metadata", () => {
  const accessToken = generateAccessToken({
    accountId: "acc-123",
    role: "ADMIN",
    email: "admin@example.com",
    profileId: "admin-1",
    portalAccess: ["ADMIN"],
  });

  const refreshToken = generateRefreshToken({
    accountId: "acc-123",
    role: "ADMIN",
    email: "admin@example.com",
    profileId: "admin-1",
    tokenFamilyId: "family-999",
    portalAccess: ["ADMIN"],
  });

  const decodedAccess = verifyAccessToken(accessToken);
  const decodedRefresh = verifyRefreshToken(refreshToken);

  assert.equal(decodedAccess.accountId, "acc-123");
  assert.equal(decodedAccess.role, "ADMIN");
  assert.equal(decodedAccess.token_type, "access");
  assert.equal(Boolean(decodedAccess.jti), true);

  assert.equal(decodedRefresh.accountId, "acc-123");
  assert.equal(decodedRefresh.role, "ADMIN");
  assert.equal(decodedRefresh.token_type, "refresh");
  assert.equal(decodedRefresh.token_family_id, "family-999");
  assert.equal(Boolean(decodedRefresh.jti), true);
});

test("wrong token type is rejected during verification", () => {
  const refreshToken = generateRefreshToken({
    accountId: "acc-456",
    role: "CUSTOMER",
    email: "customer@example.com",
    profileId: "cust-7",
    tokenFamilyId: "family-77",
  });

  assert.throws(() => verifyAccessToken(refreshToken), /Invalid token type|token_type/i);
});

test("expired tokens are rejected", async () => {
  const expiredAccessToken = generateAccessToken({
    accountId: "acc-789",
    role: "CUSTOMER",
    email: "customer@example.com",
    profileId: "cust-99",
    expiresIn: "1ms",
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.throws(() => verifyAccessToken(expiredAccessToken), /expired|jwt|signature/i);
});
