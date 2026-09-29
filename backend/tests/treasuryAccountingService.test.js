import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTreasuryGlReconciliation,
  getDirectCashOffsetAccountCode,
  validateTreasuryAccountingAccount,
  validateTreasuryAccountTypeMapping,
} from "../services/treasuryAccountingService.js";

const makeGlAccount = (overrides = {}) => ({
  id: "gl-cash",
  accountCode: "1110",
  accountName: "Cash on Hand",
  accountType: "ASSET",
  normalBalance: "DEBIT",
  isActive: true,
  subAccounts: [],
  currentBalance: "250.00",
  ...overrides,
});

test("Treasury mapping accepts an active debit-balance asset leaf account", async () => {
  const expected = makeGlAccount();
  const account = await validateTreasuryAccountingAccount(expected.id, {
    account: { findUnique: async () => expected },
  });

  assert.equal(account.id, expected.id);
});

test("Treasury mapping rejects liability, inactive, and parent accounts", async (t) => {
  const cases = [
    ["liability", makeGlAccount({ accountType: "LIABILITY", normalBalance: "CREDIT" })],
    ["inactive", makeGlAccount({ isActive: false })],
    ["parent", makeGlAccount({ subAccounts: [{ id: "child" }] })],
    ["customer receivable", makeGlAccount({ accountCode: "1130" })],
  ];

  for (const [name, account] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        () => validateTreasuryAccountingAccount(account.id, { account: { findUnique: async () => account } }),
        { statusCode: 400 }
      );
    });
  }
});

test("Treasury reconciliation aggregates multiple accounts mapped to one GL account", () => {
  const accountingAccount = makeGlAccount({ currentBalance: "300.00" });
  const result = buildTreasuryGlReconciliation([
    { id: "cash-drawer", accountName: "Shop Cash", accountType: "CASH", currentBalance: 125, accountingAccountId: accountingAccount.id, accountingAccount },
    { id: "cash-office", accountName: "Office Cash", accountType: "CASH", currentBalance: 175, accountingAccountId: accountingAccount.id, accountingAccount },
  ]);

  assert.equal(result.status, "RECONCILED");
  assert.equal(result.accountMappings.length, 1);
  assert.equal(result.accountMappings[0].treasuryAccounts.length, 2);
  assert.equal(result.treasuryAccountsTotal, 300);
  assert.equal(result.glTotalBalance, 300);
});

test("unmapped Treasury accounts make reconciliation explicitly incomplete", () => {
  const result = buildTreasuryGlReconciliation([
    { id: "unmapped", accountName: "Wallet", accountType: "WALLET", currentBalance: 500 },
  ]);

  assert.equal(result.status, "NOT_RECONCILED");
  assert.equal(result.isReconciled, false);
  assert.equal(result.unmappedAccountCount, 1);
  assert.equal(result.unmappedAccounts[0].status, "UNMAPPED");
  assert.equal(result.treasuryAccountsTotal, 0);
});

test("direct cash entries allow only explicitly supported accounting categories", () => {
  assert.equal(getDirectCashOffsetAccountCode("INFLOW", "MISC_INFLOW"), "8100");
  assert.equal(getDirectCashOffsetAccountCode("OUTFLOW", "DRAWINGS"), "3500");
  assert.throws(() => getDirectCashOffsetAccountCode("INFLOW", "CAPITAL_INJECTION"), { statusCode: 400 });
  assert.throws(() => getDirectCashOffsetAccountCode("INFLOW", "SALES"), { statusCode: 400 });
  assert.throws(() => getDirectCashOffsetAccountCode("OUTFLOW", "SUPPLIER_PAYMENT"), { statusCode: 400 });
});

test("Treasury types map to their designated GL accounts and reject carrier-held COD", () => {
  assert.equal(validateTreasuryAccountTypeMapping("CASH", "1110"), true);
  assert.equal(validateTreasuryAccountTypeMapping("BANK", "1120"), true);
  assert.equal(validateTreasuryAccountTypeMapping("WALLET", "1180"), true);
  assert.throws(() => validateTreasuryAccountTypeMapping("CASH", "1120"), { statusCode: 400 });
  assert.throws(() => validateTreasuryAccountTypeMapping("ESCROW", "1180"), { statusCode: 400 });
});
