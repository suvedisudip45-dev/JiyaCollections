import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";
import { authenticate } from "../middleware/unifiedAuth.js";

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
