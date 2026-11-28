import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";
import { generateAccessToken } from "../services/tokenService.js";
import { createAuthenticate } from "../middleware/unifiedAuth.js";
import { isMfaEnabled, isMfaEnforced } from "../security/mfaPolicy.js";

const invoke = async ({ role, mfaVerified = false, authMethods = [], env = { NOTIFICATIONS_ENABLED: "false" } }) => {
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
        manufacturerProfile: role === "MANUFACTURER" ? { id: profileId } : null,
        distributorProfile: role === "DISTRIBUTOR" ? { id: profileId, status: "ACTIVE", isActive: true } : null,
        marketingPartnerProfile: role === "MARKETING_PARTNER" ? { id: profileId } : null,
        roleMappings: [],
      }),
    },
  };
  const req = { headers: { authorization: `Bearer ${token}` }, body: {} };
  let response;
  let nextCalled = false;
  await createAuthenticate(client, env)(req, {
    status: (code) => ({ json: (body) => { response = { code, body }; } }),
  }, () => { nextCalled = true; });
  return { req, response, nextCalled };
};

test("all privileged portal access requires signed password and OTP evidence even when notifications are disabled", async () => {
  for (const role of ["ADMIN", "MARKETING_PARTNER", "MANUFACTURER", "DISTRIBUTOR"]) {
    const result = await invoke({ role });
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.code, 401);
    assert.equal(result.response.body.code, `${role}_MFA_REQUIRED`);
  }
});

test("verified privileged access passes and CUSTOMER access remains unchanged", async () => {
  const admin = await invoke({ role: "ADMIN", mfaVerified: true, authMethods: ["pwd", "otp"] });
  const manufacturer = await invoke({ role: "MANUFACTURER", mfaVerified: true, authMethods: ["pwd", "otp"] });
  const marketing = await invoke({ role: "MARKETING_PARTNER", mfaVerified: true, authMethods: ["pwd", "otp"] });
  const customer = await invoke({ role: "CUSTOMER" });
  assert.equal(admin.nextCalled, true);
  assert.equal(admin.req.auth.mfaVerified, true);
  assert.equal(manufacturer.nextCalled, true);
  assert.equal(marketing.nextCalled, true);
  assert.equal(customer.nextCalled, true);
  assert.equal(customer.req.auth.mfaVerified, false);
});

test("MFA_ENABLED=false permits password-only privileged sessions and disables MFA enforcement", async () => {
  for (const role of ["ADMIN", "MARKETING_PARTNER", "MANUFACTURER", "DISTRIBUTOR"]) {
    const result = await invoke({ role, env: { MFA_ENABLED: "false" } });
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.auth.mfaVerified, false);
  }
  assert.equal(isMfaEnforced("ADMIN", { MFA_ENABLED: "false" }), false);
  assert.equal(isMfaEnforced("ADMIN", { MFA_ENABLED: "true" }), true);
});

test("MFA is enabled by default and rejects invalid environment values", () => {
  assert.equal(isMfaEnabled({}), true);
  assert.equal(isMfaEnabled({ MFA_ENABLED: " TRUE " }), true);
  assert.equal(isMfaEnabled({ MFA_ENABLED: "false" }), false);
  assert.throws(() => isMfaEnabled({ MFA_ENABLED: "yes" }), /MFA_ENABLED must be set to true or false/);
});