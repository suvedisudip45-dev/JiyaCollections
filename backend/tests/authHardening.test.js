import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { authenticate } from "../middleware/unifiedAuth.js";
import { authenticateAccount } from "../services/authService.js";
import { generateAccessToken } from "../services/tokenService.js";

const invokeAuthenticate = async (token) => {
  const request = {
    headers: { authorization: `Bearer ${token}` },
    body: {},
  };
  let response;
  let nextCalled = false;
  const result = await authenticate(
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

test("legacy admin profile token resolves to its AuthAccount", async () => {
  const admin = await prisma.admin.findFirst({
    where: { accountId: { not: null } },
    select: { id: true, accountId: true },
  });
  if (!admin) return;

  const token = jwt.sign({ adminId: admin.id, role: "ADMIN" }, process.env.JWT_SECRET);
  const result = await invokeAuthenticate(token);

  assert.equal(result.nextCalled, true);
  assert.equal(result.request.auth.accountId, admin.accountId);
  assert.equal(result.request.auth.role, "ADMIN");
});

test("role-mismatched tokens are rejected", async () => {
  const account = await prisma.authAccount.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (!account) return;

  const token = jwt.sign({ accountId: account.id, role: "CUSTOMER" }, process.env.JWT_SECRET);
  const result = await invokeAuthenticate(token);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "INVALID_IDENTITY");
});

test("profile identity must belong to the authenticated account", async () => {
  const account = await prisma.authAccount.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    include: { adminProfile: { select: { id: true } } },
  });
  if (!account?.adminProfile) return;

  const token = generateAccessToken({
    accountId: account.id,
    profileId: crypto.randomUUID(),
    role: "ADMIN",
  });
  const result = await invokeAuthenticate(token);

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.code, 401);
  assert.equal(result.response.body.code, "INVALID_PROFILE_OWNER");
});

test("inactive accounts are rejected", async () => {
  const email = `rbac-hardening-${crypto.randomUUID()}@example.test`;
  const account = await prisma.authAccount.create({
    data: {
      email,
      passwordHash: "test-only-hash",
      role: "CUSTOMER",
      status: "SUSPENDED",
    },
    select: { id: true },
  });

  try {
    const token = jwt.sign({ accountId: account.id, role: "CUSTOMER" }, process.env.JWT_SECRET);
    const result = await invokeAuthenticate(token);
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.code, 401);
    assert.equal(result.response.body.code, "ACCOUNT_INACTIVE");
  } finally {
    await prisma.authAccount.delete({ where: { id: account.id } });
  }
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
