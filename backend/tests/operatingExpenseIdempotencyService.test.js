import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOperatingExpenseNotPosted,
  findOperatingExpenseReplay,
  hashOperatingExpenseRequest,
  normalizeOperatingExpenseIdempotencyKey,
} from "../services/operatingExpenseIdempotencyService.js";

test("expense idempotency keys are trimmed and constrained", () => {
  assert.equal(normalizeOperatingExpenseIdempotencyKey("  request-key-01  "), "request-key-01");
  assert.throws(() => normalizeOperatingExpenseIdempotencyKey("short"), {
    code: "INVALID_IDEMPOTENCY_KEY",
  });
  assert.throws(() => normalizeOperatingExpenseIdempotencyKey("x".repeat(192)), {
    code: "INVALID_IDEMPOTENCY_KEY",
  });
});

test("expense request hashes are deterministic and change with financial details", () => {
  const payload = { amount: "100.00", paymentStatus: "PAID", paymentAccountId: "cash-1" };
  assert.equal(hashOperatingExpenseRequest(payload), hashOperatingExpenseRequest({ ...payload }));
  assert.notEqual(
    hashOperatingExpenseRequest(payload),
    hashOperatingExpenseRequest({ ...payload, amount: "101.00" }),
  );
});

test("expense retry returns the prior record without writes when the payload matches", async () => {
  const expense = {
    id: "expense-1",
    requestPayloadHash: "matching-hash",
    financialAccountId: "account-1",
    payableId: null,
  };
  const calls = [];
  const client = {
    operatingExpense: { findUnique: async (args) => { calls.push(["expense", args]); return expense; } },
    financialAccount: { findUnique: async (args) => { calls.push(["account", args]); return { id: "account-1" }; } },
    accountPayable: { findUnique: async (args) => { calls.push(["payable", args]); return null; } },
  };

  const replay = await findOperatingExpenseReplay({
    client,
    idempotencyKey: "request-key-01",
    payloadHash: "matching-hash",
  });

  assert.equal(replay.expense, expense);
  assert.equal(replay.account.id, "account-1");
  assert.equal(replay.payable, null);
  assert.equal(replay.replayed, true);
  assert.deepEqual(calls.map(([model]) => model), ["expense", "account"]);
});

test("expense retry rejects reuse of a key with changed request details", async () => {
  const client = {
    operatingExpense: {
      findUnique: async () => ({ requestPayloadHash: "original-hash" }),
    },
  };

  await assert.rejects(
    findOperatingExpenseReplay({
      client,
      idempotencyKey: "request-key-01",
      payloadHash: "different-hash",
    }),
    { code: "IDEMPOTENCY_KEY_REUSED", statusCode: 409 },
  );
});

test("posted expense sources cannot be edited or deleted without a correction event", async () => {
  await assertOperatingExpenseNotPosted({
    journalEntry: { findFirst: async () => null },
  }, "expense-unposted");

  await assert.rejects(
    assertOperatingExpenseNotPosted({
      journalEntry: { findFirst: async () => ({ id: "journal-1" }) },
    }, "expense-posted"),
    { code: "EXPENSE_CORRECTION_REQUIRED", statusCode: 409 },
  );
});
