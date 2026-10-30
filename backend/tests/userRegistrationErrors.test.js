import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { registerUser } from "../controllers/userController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const registerWithUniqueConflict = async (t, target) => {
  stubMethod(t, prisma.user, "findUnique", async () => null);
  stubMethod(t, prisma.authAccount, "findFirst", async () => null);
  stubMethod(t, prisma.user, "findFirst", async () => null);
  stubMethod(t, prisma, "$transaction", async () => {
    throw Object.assign(new Error("Raw Prisma unique constraint failure"), {
      code: "P2002",
      meta: { target },
    });
  });

  const response = createResponse();
  await registerUser({
    body: {
      firstName: "Test",
      lastName: "Customer",
      email: "test.customer@example.com",
      phone: "9812345678",
      password: "valid-password",
    },
  }, response);
  return response;
};

test("customer signup returns a clear message when the AuthAccount phone is already registered", async (t) => {
  const response = await registerWithUniqueConflict(t, ["phone"]);

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.body.message,
    "This mobile number is already registered. Please use a different number or sign in to your existing account."
  );
  assert.doesNotMatch(response.body.message, /prisma|constraint/i);
});

test("customer signup returns a clear message when the AuthAccount email is already registered", async (t) => {
  const response = await registerWithUniqueConflict(t, "AuthAccount_email_key");

  assert.equal(response.statusCode, 409);
  assert.equal(
    response.body.message,
    "An account with this email already exists. Please sign in or use a different email address."
  );
  assert.doesNotMatch(response.body.message, /prisma|constraint/i);
});

test("customer signup rejects a phone already used by an account before creating another one", async (t) => {
  stubMethod(t, prisma.user, "findUnique", async () => null);
  stubMethod(t, prisma.authAccount, "findFirst", async () => ({
    email: "existing@example.com",
    phone: "9812345678",
  }));
  stubMethod(t, prisma, "$transaction", async () => {
    assert.fail("Registration transaction should not run for a duplicate account phone.");
  });

  const response = createResponse();
  await registerUser({
    body: {
      firstName: "Test",
      lastName: "Customer",
      email: "new.customer@example.com",
      phone: "9812345678",
      password: "valid-password",
    },
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /mobile number is already registered/i);
});
