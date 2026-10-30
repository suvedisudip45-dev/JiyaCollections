import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerReturnAccountingLines,
  resolveCustomerReturnTreasuryGlAccountId,
} from "../services/accountingPostingEngine.js";

const baseReturn = {
  returnId: "return-123456",
  customerName: "Customer",
  totalRefund: 113,
  vat: 13,
  isPayable: false,
  refundMethod: "CASH",
};

test("customer return GL credit uses the selected treasury GL account", () => {
  const lines = buildCustomerReturnAccountingLines({
    ...baseReturn,
    treasuryGlAccountId: "selected-gl-account",
  });

  assert.equal(lines[2].accountId, "selected-gl-account");
  assert.equal("accountCode" in lines[2], false);
});

test("customer return resolves the selected treasury record to its linked GL account", async () => {
  let queriedId;
  const treasuryGlAccountId = await resolveCustomerReturnTreasuryGlAccountId({
    financialAccount: {
      findUnique: async ({ where }) => {
        queriedId = where.id;
        return { accountId: "selected-gl-account" };
      },
    },
  }, "selected-treasury-account");

  assert.equal(queriedId, "selected-treasury-account");
  assert.equal(treasuryGlAccountId, "selected-gl-account");

  await assert.rejects(
    resolveCustomerReturnTreasuryGlAccountId({
      financialAccount: { findUnique: async () => ({}) },
    }, "unlinked-treasury-account"),
    /not linked to a General Ledger account/,
  );
});

test("customer return only reverses inventory and COGS for a positive costed restock", () => {
  const costedLines = buildCustomerReturnAccountingLines({
    ...baseReturn,
    restockedInventoryCost: 25,
  });
  assert.deepEqual(costedLines.slice(-2).map(({ accountCode, debit, credit }) => ({ accountCode, debit, credit })), [
    { accountCode: "1140", debit: 25, credit: 0 },
    { accountCode: "5100", debit: 0, credit: 25 },
  ]);

  for (const restockedInventoryCost of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const lines = buildCustomerReturnAccountingLines({ ...baseReturn, restockedInventoryCost });
    assert.equal(lines.some(({ accountCode }) => ["1140", "5100"].includes(accountCode)), false);
  }
});

test("zero-refund return still records a costed inventory adjustment", () => {
  const lines = buildCustomerReturnAccountingLines({
    ...baseReturn,
    totalRefund: 0,
    vat: 0,
    restockedInventoryCost: 25,
  });

  assert.deepEqual(lines.slice(-2).map(({ accountCode, debit, credit }) => ({ accountCode, debit, credit })), [
    { accountCode: "1140", debit: 25, credit: 0 },
    { accountCode: "5100", debit: 0, credit: 25 },
  ]);
});
