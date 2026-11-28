import { createHash } from "node:crypto";

const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });

export const normalizeOperatingExpenseIdempotencyKey = (value) => {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 191) {
    throw fail("A valid Idempotency-Key of 8 to 191 characters is required.", 400, "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
};

export const hashOperatingExpenseRequest = (payload) => createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");

export const findOperatingExpenseReplay = async ({ client, idempotencyKey, payloadHash }) => {
  const expense = await client.operatingExpense.findUnique({ where: { idempotencyKey } });
  if (!expense) return null;
  if (expense.requestPayloadHash !== payloadHash) {
    throw fail(
      "This Idempotency-Key was already used with different expense details.",
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }

  const [account, payable] = await Promise.all([
    expense.financialAccountId
      ? client.financialAccount.findUnique({ where: { id: expense.financialAccountId } })
      : null,
    expense.payableId
      ? client.accountPayable.findUnique({ where: { id: expense.payableId } })
      : null,
  ]);
  return { expense, account, payable, replayed: true };
};

export const assertOperatingExpenseNotPosted = async (client, expenseId) => {
  const journalEntry = await client.journalEntry.findFirst({
    where: { sourceType: "EXPENSE_PAYMENT", sourceId: String(expenseId) },
    select: { id: true },
  });
  if (journalEntry) {
    throw fail(
      "A posted expense cannot be edited or deleted. Submit a linked correction or reversal instead.",
      409,
      "EXPENSE_CORRECTION_REQUIRED",
    );
  }
};
