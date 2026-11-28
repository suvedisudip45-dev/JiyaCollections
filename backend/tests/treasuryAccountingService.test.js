import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTreasuryGlReconciliation,
  getDirectCashOffsetAccountCode,
  normalizeStockReturnExpenseReference,
  validateTreasuryAccountingAccount,
  validateTreasuryAccountTypeMapping,
  validateTreasuryPayoutAccount,
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
    { id: "cash-drawer", accountName: "Shop Cash", accountType: "CASH", currentBalance: "125.10", accountingAccountId: accountingAccount.id, accountingAccount },
    { id: "cash-office", accountName: "Office Cash", accountType: "CASH", currentBalance: "174.90", accountingAccountId: accountingAccount.id, accountingAccount },
  ]);

  assert.equal(result.status, "RECONCILED");
  assert.equal(result.accountMappings.length, 1);
  assert.equal(result.accountMappings[0].treasuryAccounts.length, 2);
  assert.equal(result.treasuryAccountsTotal, "300.00");
  assert.equal(result.glTotalBalance, "300.00");
  assert.equal(result.accountMappings[0].treasuryBalance, "300.00");
  assert.equal(result.accountMappings[0].variance, "0.00");
});

test("Treasury reconciliation exposes fractional variance instead of accepting tolerance", () => {
  const accountingAccount = makeGlAccount({ currentBalance: "300.01" });
  const result = buildTreasuryGlReconciliation([
    {
      id: "cash-drawer",
      accountName: "Shop Cash",
      accountType: "CASH",
      currentBalance: "300.00",
      accountingAccountId: accountingAccount.id,
      accountingAccount,
    },
  ]);

  assert.equal(result.status, "NOT_RECONCILED");
  assert.equal(result.isReconciled, false);
  assert.equal(result.accountMappings[0].variance, "0.01");
  assert.equal(result.variance, "0.01");
  assert.equal(result.absoluteVariance, "0.01");
});

test("Treasury reconciliation reports gross mapping variance when account differences offset", () => {
  const cashAccount = makeGlAccount({ id: "gl-cash", currentBalance: "100.01" });
  const bankAccount = makeGlAccount({
    id: "gl-bank",
    accountCode: "1120",
    accountName: "Bank",
    currentBalance: "199.99",
  });
  const result = buildTreasuryGlReconciliation([
    {
      id: "cash",
      accountName: "Cash",
      accountType: "CASH",
      currentBalance: "100.00",
      accountingAccountId: cashAccount.id,
      accountingAccount: cashAccount,
    },
    {
      id: "bank",
      accountName: "Bank",
      accountType: "BANK",
      currentBalance: "200.00",
      accountingAccountId: bankAccount.id,
      accountingAccount: bankAccount,
    },
  ]);

  assert.equal(result.status, "NOT_RECONCILED");
  assert.equal(result.variance, "0.00");
  assert.equal(result.absoluteVariance, "0.02");
});

test("Treasury reconciliation rejects JavaScript Number monetary values", () => {
  const accountingAccount = makeGlAccount();
  assert.throws(
    () => buildTreasuryGlReconciliation([
      {
        id: "cash-drawer",
        accountName: "Shop Cash",
        accountType: "CASH",
        currentBalance: 250,
        accountingAccountId: accountingAccount.id,
        accountingAccount,
      },
    ]),
    { code: "INVALID_DECIMAL_INPUT" },
  );
});

test("unmapped Treasury accounts make reconciliation explicitly incomplete", () => {
  const result = buildTreasuryGlReconciliation([
    { id: "unmapped", accountName: "Wallet", accountType: "WALLET", currentBalance: "500.00" },
  ]);

  assert.equal(result.status, "NOT_RECONCILED");
  assert.equal(result.isReconciled, false);
  assert.equal(result.unmappedAccountCount, 1);
  assert.equal(result.unmappedAccounts[0].status, "UNMAPPED");
  assert.equal(result.treasuryAccountsTotal, "0.00");
});

test("direct cash entries allow only explicitly supported accounting categories", () => {
  assert.equal(getDirectCashOffsetAccountCode("INFLOW", "MISC_INFLOW"), "8100");
  assert.equal(getDirectCashOffsetAccountCode("OUTFLOW", "DRAWINGS"), "3500");
  assert.throws(() => getDirectCashOffsetAccountCode("INFLOW", "CAPITAL_INJECTION"), { statusCode: 400 });
  assert.throws(() => getDirectCashOffsetAccountCode("INFLOW", "SALES"), { statusCode: 400 });
  assert.throws(() => getDirectCashOffsetAccountCode("OUTFLOW", "SUPPLIER_PAYMENT"), { statusCode: 400 });
});

test("stock return expense references are limited to direct operating outflows", () => {
  assert.equal(
    normalizeStockReturnExpenseReference({
      type: "OUTFLOW",
      category: "EXPENSE",
      stockReturnId: "return-123",
    }),
    "return-123",
  );
  assert.equal(
    normalizeStockReturnExpenseReference({
      type: "OUTFLOW",
      category: "DRAWINGS",
      stockReturnId: "",
    }),
    null,
  );
  assert.throws(
    () => normalizeStockReturnExpenseReference({
      type: "INFLOW",
      category: "EXPENSE",
      stockReturnId: "return-123",
    }),
    /direct operating expense outflow/,
  );
  assert.throws(
    () => normalizeStockReturnExpenseReference({
      type: "OUTFLOW",
      category: "DRAWINGS",
      stockReturnId: "return-123",
    }),
    /direct operating expense outflow/,
  );
  assert.throws(
    () => normalizeStockReturnExpenseReference({
      type: "OUTFLOW",
      category: "EXPENSE",
      stockReturnId: `return-${"x".repeat(191)}`,
    }),
    /cannot exceed 191 characters/,
  );
});

test("Treasury types map to their designated GL accounts and reject carrier-held COD", () => {
  assert.equal(validateTreasuryAccountTypeMapping("CASH", "1110"), true);
  assert.equal(validateTreasuryAccountTypeMapping("BANK", "1120"), true);
  assert.equal(validateTreasuryAccountTypeMapping("WALLET", "1180"), true);
  assert.throws(() => validateTreasuryAccountTypeMapping("CASH", "1120"), { statusCode: 400 });
  assert.throws(() => validateTreasuryAccountTypeMapping("ESCROW", "1180"), { statusCode: 400 });
});

test("Treasury payouts require active NPR accounts with the matching mapped GL account", async () => {
  const accountingAccount = makeGlAccount({ accountCode: "1120" });
  const client = { account: { findUnique: async () => accountingAccount } };
  const financialAccount = {
    id: "bank-1",
    status: "ACTIVE",
    accountType: "BANK",
    currency: "NPR",
    accountingAccountId: accountingAccount.id,
  };

  assert.equal((await validateTreasuryPayoutAccount(financialAccount, client)).id, accountingAccount.id);
  await assert.rejects(
    validateTreasuryPayoutAccount({ ...financialAccount, currency: "USD" }, client),
    /require an NPR Treasury account/,
  );
  await assert.rejects(
    validateTreasuryPayoutAccount({ ...financialAccount, accountingAccountId: null }, client),
    /Select the accounting asset account/,
  );
  await assert.rejects(
    validateTreasuryPayoutAccount({ ...financialAccount, accountType: "CASH" }, client),
    /must map to GL account 1110/,
  );
});
