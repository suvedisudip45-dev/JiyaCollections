import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { createAuthenticate } from "../middleware/unifiedAuth.js";
import { authenticateAccount } from "../services/authService.js";
import { generateAccessToken } from "../services/tokenService.js";

const invokeAuthenticate = async (token, account) => {
  const claims = jwt.decode(token);
  const client = {
    authSession: {
      findUnique: async () => ({
        id: "test-session",
        accountId: claims.accountId,
        tokenFamilyId: "test-family",
        tokenType: "ACCESS",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
    },
    authAccount: { findUnique: async () => account },
  };
  const request = {
    headers: { authorization: `Bearer ${token}` },
    body: {},
  };
  let response;
  let nextCalled = false;
  const result = await createAuthenticate(client)(
    request,
    {
      status: (code) => ({
        json: (body) => {
          response = { code, body };
        },
      }),
    },
    () => {
      nextCalled = true;
    }
  );
  return { request, response, nextCalled, result };
};

test("ADMIN access token without MFA is rejected after session validation", async () => {
  const account = {
    id: "admin-account",
    role: "ADMIN",
    status: "ACTIVE",
    customerProfile: null,
    adminProfile: { id: "admin-profile" },
    manufacturerProfile: null,
    marketingPartnerProfile: null,
    roleMappings: [],
  };
  const token = generateAccessToken({ accountId: account.id, profileId: "admin-profile", role: "ADMIN" });
  const result = await invokeAuthenticate(token, account);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "ADMIN_MFA_REQUIRED");
});

test("role-mismatched tokens are rejected", async () => {
  const account = {
    id: "admin-account",
    role: "ADMIN",
    status: "ACTIVE",
    customerProfile: null,
    adminProfile: { id: "admin-profile" },
    manufacturerProfile: null,
    marketingPartnerProfile: null,
    roleMappings: [],
  };
  const token = generateAccessToken({ accountId: account.id, profileId: "customer-profile", role: "CUSTOMER" });
  const result = await invokeAuthenticate(token, account);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "INVALID_IDENTITY");
});

test("profile identity must belong to the authenticated account", async () => {
  const account = {
    id: "admin-account",
    role: "ADMIN",
    status: "ACTIVE",
    customerProfile: null,
    adminProfile: { id: "admin-profile" },
    manufacturerProfile: null,
    marketingPartnerProfile: null,
    roleMappings: [],
  };

  const token = generateAccessToken({
    accountId: account.id,
    profileId: crypto.randomUUID(),
    role: "ADMIN",
    mfaVerified: true,
    authMethods: ["pwd", "otp"],
  });
  const result = await invokeAuthenticate(token, account);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "INVALID_PROFILE_OWNER");
});

test("inactive accounts are rejected", async () => {
  const account = {
    id: "inactive-account",
    role: "CUSTOMER",
    status: "SUSPENDED",
    customerProfile: { id: "inactive-profile" },
    adminProfile: null,
    manufacturerProfile: null,
    marketingPartnerProfile: null,
    roleMappings: [],
  };
  const token = generateAccessToken({ accountId: account.id, profileId: "inactive-profile", role: "CUSTOMER" });
  const result = await invokeAuthenticate(token, account);
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "ACCOUNT_INACTIVE");
});

test("approved marketing partner login succeeds when profile is active even if auth account was left pending", async () => {
  const unique = crypto.randomUUID().slice(0, 8);
  const email = `partner-approval-sync-${unique}@example.test`;
  const account = await prisma.authAccount.create({
    data: {
      email,
      phone: `+9779${unique.slice(0, 8)}`,
      passwordHash: await bcrypt.hash("StrongPass123!", 10),
      role: "MARKETING_PARTNER",
      status: "PENDING_APPROVAL",
    },
    select: { id: true, role: true, status: true },
  });

  const partner = await prisma.marketingPartner.create({
    data: {
      accountId: account.id,
      code: `APP-${unique.toUpperCase()}`,
      name: "Approval Sync Partner",
      email,
      status: "ACTIVE",
      passwordHash: await bcrypt.hash("StrongPass123!", 10),
    },
    select: { id: true, status: true, accountId: true },
  });

  try {
    const result = await authenticateAccount({
      identifier: email,
      password: "StrongPass123!",
      targetPortal: "MARKETING_PARTNER",
    });

    assert.equal(result.token.length > 0, true);
    assert.equal(result.profile.id, partner.id);
    assert.equal(result.profile.status, "ACTIVE");
  } finally {
    await prisma.marketingPartner.deleteMany({ where: { accountId: account.id } });
    await prisma.authAccount.delete({ where: { id: account.id } });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
