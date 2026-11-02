import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDistributorReturnInventoryAccountingLines,
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

test("distributor return cost is split between restockable inventory and defective loss", () => {
  const lines = buildDistributorReturnInventoryAccountingLines({
    returnId: "return-123456",
    items: [
      { condition: "RESTOCKABLE", unitCostPrice: "50.00", quantity: 2 },
      { condition: "DAMAGED", unitCostPrice: "80.00", quantity: 1 },
    ],
  });

  assert.deepEqual(
    lines.map(({ accountCode, mappingKey, debit, credit }) => ({
      account: accountCode || mappingKey,
      debit: Number(debit),
      credit: Number(credit),
    })),
    [
      { account: "INVENTORY", debit: 100, credit: 0 },
      { account: "5500", debit: 80, credit: 0 },
      { account: "COGS", debit: 0, credit: 180 },
    ],
  );
});

test("distributor return inventory accounting rejects unknown conditions and invalid costs", () => {
  assert.throws(
    () => buildDistributorReturnInventoryAccountingLines({
      returnId: "return-123456",
      items: [{ condition: "MISSING", unitCostPrice: 20, quantity: 1 }],
    }),
    /Unsupported distributor return condition/,
  );
  assert.throws(
    () => buildDistributorReturnInventoryAccountingLines({
      returnId: "return-123456",
      items: [{ condition: "RESTOCKABLE", unitCostPrice: -1, quantity: 1 }],
    }),
    /valid non-negative unit cost/,
  );
  assert.throws(
    () => buildDistributorReturnInventoryAccountingLines({
      returnId: "return-123456",
      items: [{ condition: "RESTOCKABLE", quantity: 1 }],
    }),
    /original unit cost/,
  );
});
