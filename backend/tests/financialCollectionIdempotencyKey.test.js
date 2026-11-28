import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import { collectReceivable, settlePayable } from "../controllers/financialController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("payable payout initiation rejects missing idempotency keys before database access", async (t) => {
  stubMethod(t, prisma.accountPayable, "findUnique", async () => {
    throw new Error("Database access must not occur for a missing idempotency key.");
  });
  const response = createResponse();

  await settlePayable({
    body: { payableId: "payable-1", amount: "12.34", fromAccountId: "account-1" },
    headers: {},
    auth: { accountId: "admin-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("receivable collection rejects missing idempotency keys before database access", async (t) => {
  stubMethod(t, prisma.financialAccount, "findUnique", async () => {
    throw new Error("Database access must not occur for a missing idempotency key.");
  });
  const response = createResponse();

  await collectReceivable({
    body: {
      receivableId: "receivable-1",
      amount: "12.34",
      toAccountId: "account-1",
    },
    headers: {},
    auth: { accountId: "admin-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("payable payout initiation rejects malformed idempotency keys before database access", async (t) => {
  stubMethod(t, prisma.accountPayable, "findUnique", async () => {
    throw new Error("Database access must not occur for an invalid idempotency key.");
  });
  const response = createResponse();

  await settlePayable({
    body: {
      payableId: "payable-1",
      amount: "12.34",
      fromAccountId: "account-1",
      idempotencyKey: "invalid key",
    },
    headers: {},
    auth: { accountId: "admin-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("receivable collection rejects malformed idempotency keys before database access", async (t) => {
  stubMethod(t, prisma.financialAccount, "findUnique", async () => {
    throw new Error("Database access must not occur for an invalid idempotency key.");
  });
  const response = createResponse();

  await collectReceivable({
    body: {
      receivableId: "receivable-1",
      amount: "12.34",
      toAccountId: "account-1",
      idempotencyKey: "invalid key",
    },
    headers: {},
    auth: { accountId: "admin-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("receivable collection rejects numeric JSON money inputs before database access", async (t) => {
  stubMethod(t, prisma.financialAccount, "findUnique", async () => {
    throw new Error("Database access must not occur for a numeric monetary input.");
  });
  const response = createResponse();

  await collectReceivable({
    body: {
      receivableId: "receivable-1",
      amount: 12.34,
      toAccountId: "account-1",
      idempotencyKey: "COLLECTION-1",
    },
    headers: {},
    auth: { accountId: "admin-1" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "INVALID_DECIMAL_INPUT");
});
