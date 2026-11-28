import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  subtractDecimals,
} from "./accountingDecimal.js";

const mappingError = (message) => Object.assign(new Error(message), { statusCode: 400 });
const TREASURY_GL_ACCOUNT_CODES = new Set(["1110", "1120", "1180"]);
const DIRECT_CASH_OFFSET_CODES = {
  INFLOW: {
    MISC_INFLOW: "8100",
  },
  OUTFLOW: {
    EXPENSE: "6700",
    DRAWINGS: "3500",
  },
};

const toAmount = (value) => accountingDecimal(value ?? "0");
const amountString = (value) => value.toFixed(2);

export const validateTreasuryAccountingAccount = async (accountingAccountId, client) => {
  if (!accountingAccountId) {
    throw mappingError("Select the accounting asset account that represents this Treasury account.");
  }

  const account = await client.account.findUnique({
    where: { id: accountingAccountId },
    include: { subAccounts: { select: { id: true } } },
  });

  if (!account || !account.isActive) {
    throw mappingError("The selected accounting account does not exist or is inactive.");
  }
  if (account.accountType !== "ASSET" || account.normalBalance !== "DEBIT") {
    throw mappingError("A Treasury account must map to an active debit-balance asset account.");
  }
  if (!TREASURY_GL_ACCOUNT_CODES.has(account.accountCode)) {
    throw mappingError("Treasury can map only to Cash on Hand (1110), Bank (1120), or Gateway Clearing (1180).");
  }
  if (account.subAccounts?.length) {
    throw mappingError("Map Treasury to a posting account, not a parent/group account.");
  }

  return account;
};

export const validateTreasuryAccountTypeMapping = (treasuryAccountType, accountingAccountCode) => {
  const type = String(treasuryAccountType || "").toUpperCase();
  const expectedCode = {
    CASH: "1110",
    BANK: "1120",
    WALLET: "1180",
  }[type];

  if (!expectedCode) {
    throw mappingError("Carrier-held COD and escrow are receivables, not Treasury cash accounts.");
  }
  if (accountingAccountCode !== expectedCode) {
    throw mappingError(`${type} Treasury accounts must map to GL account ${expectedCode}.`);
  }
  return true;
};

export const validateTreasuryPayoutAccount = async (financialAccount, client) => {
  const treasuryType = String(financialAccount?.accountType || "").toUpperCase();
  if (!financialAccount || financialAccount.status !== "ACTIVE" ||
      !["CASH", "BANK", "WALLET"].includes(treasuryType)) {
    throw mappingError("Select an active cash, bank, or wallet Treasury account for payout.");
  }
  if (String(financialAccount.currency || "").toUpperCase() !== "NPR") {
    throw mappingError("Supplier payouts currently require an NPR Treasury account.");
  }
  const accountingAccount = await validateTreasuryAccountingAccount(financialAccount.accountingAccountId, client);
  validateTreasuryAccountTypeMapping(treasuryType, accountingAccount.accountCode);
  return accountingAccount;
};

export const getDirectCashOffsetAccountCode = (type, category) => {
  const direction = String(type || "").toUpperCase();
  const normalizedCategory = String(category || "").toUpperCase();
  const accountCode = DIRECT_CASH_OFFSET_CODES[direction]?.[normalizedCategory];
  if (!accountCode) {
    throw mappingError("This movement requires a sales, bill, COD, asset, or other dedicated accounting workflow.");
  }
  return accountCode;
};

export const normalizeStockReturnExpenseReference = ({ type, category, stockReturnId }) => {
  const returnId = String(stockReturnId || "").trim();
  if (!returnId) return null;
  if (returnId.length > 191) {
    throw mappingError("Stock return reference cannot exceed 191 characters.");
  }
  if (String(type || "").toUpperCase() !== "OUTFLOW" || String(category || "").toUpperCase() !== "EXPENSE") {
    throw mappingError("A stock return can be linked only to a direct operating expense outflow.");
  }
  return returnId;
};

export const buildTreasuryGlReconciliation = (treasuryAccounts = []) => {
  const mappedGroups = new Map();
  const unmappedAccounts = [];

  for (const treasury of treasuryAccounts) {
    if (!treasury.accountingAccountId || !treasury.accountingAccount) {
      unmappedAccounts.push({
        id: treasury.id,
        accountName: treasury.accountName,
        accountType: treasury.accountType,
        balance: amountString(toAmount(treasury.currentBalance)),
        status: "UNMAPPED",
      });
      continue;
    }

    const glAccount = treasury.accountingAccount;
    let group = mappedGroups.get(glAccount.id);
    if (!group) {
      group = {
        accountingAccountId: glAccount.id,
        accountCode: glAccount.accountCode,
        accountName: glAccount.accountName,
        treasuryBalance: accountingDecimal("0"),
        glBalance: toAmount(glAccount.currentBalance),
        treasuryAccounts: [],
      };
      mappedGroups.set(glAccount.id, group);
    }

    const balance = toAmount(treasury.currentBalance);
    group.treasuryBalance = addDecimals(group.treasuryBalance, balance);
    group.treasuryAccounts.push({
      id: treasury.id,
      accountName: treasury.accountName,
      accountType: treasury.accountType,
      balance: amountString(balance),
    });
  }

  const accountMappings = [...mappedGroups.values()].map((group) => {
    const variance = subtractDecimals(group.glBalance, group.treasuryBalance);
    const isReconciled = compareDecimals(variance, "0") === 0;
    return {
      accountingAccountId: group.accountingAccountId,
      accountCode: group.accountCode,
      accountName: group.accountName,
      treasuryBalance: amountString(group.treasuryBalance),
      glBalance: amountString(group.glBalance),
      variance: amountString(variance),
      isReconciled,
      status: isReconciled ? "RECONCILED" : "VARIANCE",
      treasuryAccounts: group.treasuryAccounts,
    };
  });

  const treasuryTotal = accountMappings.reduce(
    (sum, group) => addDecimals(sum, group.treasuryBalance),
    accountingDecimal("0"),
  );
  const glTotal = accountMappings.reduce(
    (sum, group) => addDecimals(sum, group.glBalance),
    accountingDecimal("0"),
  );
  const varianceTotal = subtractDecimals(glTotal, treasuryTotal);
  const absoluteVarianceTotal = accountMappings.reduce(
    (total, mapping) => addDecimals(total, accountingDecimal(mapping.variance).abs()),
    accountingDecimal("0"),
  );
  const isReconciled = unmappedAccounts.length === 0 && accountMappings.every((group) => group.isReconciled);

  return {
    status: isReconciled ? "RECONCILED" : "NOT_RECONCILED",
    isReconciled,
    treasuryAccountsTotal: amountString(treasuryTotal),
    glTotalBalance: amountString(glTotal),
    variance: amountString(varianceTotal),
    absoluteVariance: amountString(absoluteVarianceTotal),
    mappedAccountCount: accountMappings.length,
    unmappedAccountCount: unmappedAccounts.length,
    accountMappings,
    unmappedAccounts,
  };
};
