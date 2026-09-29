import { Prisma } from "@prisma/client";

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

const toAmount = (value) => new Prisma.Decimal(String(value || 0));
const amountNumber = (value) => Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

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

export const getDirectCashOffsetAccountCode = (type, category) => {
  const direction = String(type || "").toUpperCase();
  const normalizedCategory = String(category || "").toUpperCase();
  const accountCode = DIRECT_CASH_OFFSET_CODES[direction]?.[normalizedCategory];
  if (!accountCode) {
    throw mappingError("This movement requires a sales, bill, COD, asset, or other dedicated accounting workflow.");
  }
  return accountCode;
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
        balance: amountNumber(toAmount(treasury.currentBalance)),
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
        treasuryBalance: new Prisma.Decimal(0),
        glBalance: toAmount(glAccount.currentBalance),
        treasuryAccounts: [],
      };
      mappedGroups.set(glAccount.id, group);
    }

    const balance = toAmount(treasury.currentBalance);
    group.treasuryBalance = group.treasuryBalance.plus(balance);
    group.treasuryAccounts.push({
      id: treasury.id,
      accountName: treasury.accountName,
      accountType: treasury.accountType,
      balance: amountNumber(balance),
    });
  }

  const accountMappings = [...mappedGroups.values()].map((group) => {
    const variance = group.glBalance.minus(group.treasuryBalance).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const isReconciled = variance.abs().lte("0.05");
    return {
      accountingAccountId: group.accountingAccountId,
      accountCode: group.accountCode,
      accountName: group.accountName,
      treasuryBalance: amountNumber(group.treasuryBalance),
      glBalance: amountNumber(group.glBalance),
      variance: amountNumber(variance),
      isReconciled,
      status: isReconciled ? "RECONCILED" : "VARIANCE",
      treasuryAccounts: group.treasuryAccounts,
    };
  });

  const treasuryTotal = accountMappings.reduce((sum, group) => sum.plus(group.treasuryBalance), new Prisma.Decimal(0));
  const glTotal = accountMappings.reduce((sum, group) => sum.plus(group.glBalance), new Prisma.Decimal(0));
  const varianceTotal = glTotal.minus(treasuryTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const isReconciled = unmappedAccounts.length === 0 && accountMappings.every((group) => group.isReconciled);

  return {
    status: isReconciled ? "RECONCILED" : "NOT_RECONCILED",
    isReconciled,
    treasuryAccountsTotal: amountNumber(treasuryTotal),
    glTotalBalance: amountNumber(glTotal),
    variance: amountNumber(varianceTotal),
    mappedAccountCount: accountMappings.length,
    unmappedAccountCount: unmappedAccounts.length,
    accountMappings,
    unmappedAccounts,
  };
};
