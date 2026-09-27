import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";
import { generateAccessToken } from "../services/tokenService.js";
import { createAuthenticate } from "../middleware/unifiedAuth.js";

const invoke = async ({ role, mfaVerified = false, authMethods = [] }) => {
  const accountId = `account-${role.toLowerCase()}`;
  const profileId = `profile-${role.toLowerCase()}`;
  const token = generateAccessToken({ accountId, profileId, role, mfaVerified, authMethods });
  const client = {
    authSession: {
      findUnique: async () => ({
        id: "session-id",
        accountId,
        tokenFamilyId: "family-id",
        tokenType: "ACCESS",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
    },
    authAccount: {
      findUnique: async () => ({
        id: accountId,
        role,
        status: "ACTIVE",
        customerProfile: role === "CUSTOMER" ? { id: profileId } : null,
        adminProfile: role === "ADMIN" ? { id: profileId } : null,
        manufacturerProfile: null,
        marketingPartnerProfile: null,
        roleMappings: [],
      }),
    },
  };
  const req = { headers: { authorization: `Bearer ${token}` }, body: {} };
  let response;
  let nextCalled = false;
  await createAuthenticate(client)(req, {
    status: (code) => ({ json: (body) => { response = { code, body }; } }),
  }, () => { nextCalled = true; });
  return { req, response, nextCalled };
};

test("ADMIN access requires signed password and OTP evidence", async () => {
  const result = await invoke({ role: "ADMIN" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "ADMIN_MFA_REQUIRED");
});

test("verified ADMIN access passes and CUSTOMER access remains unchanged", async () => {
  const admin = await invoke({ role: "ADMIN", mfaVerified: true, authMethods: ["pwd", "otp"] });
  const customer = await invoke({ role: "CUSTOMER" });
  assert.equal(admin.nextCalled, true);
  assert.equal(admin.req.auth.mfaVerified, true);
  assert.equal(customer.nextCalled, true);
  assert.equal(customer.req.auth.mfaVerified, false);
});