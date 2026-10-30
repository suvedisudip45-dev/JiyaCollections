import { Prisma } from "@prisma/client";

export const BALANCE_REPORT_JOURNAL_STATUSES = ["POSTED", "REVERSED"];

const decimal = (value) => new Prisma.Decimal(String(value ?? 0));

export const buildGeneralLedgerBalanceReconciliation = ({
  accounts = [],
  journalLineGroups = [],
} = {}) => {
  const groupsByAccountId = new Map(journalLineGroups.map((group) => [group.accountId, group]));
  const accountRows = accounts.map((account) => {
    const group = groupsByAccountId.get(account.id);
    const debitTotal = decimal(group?._sum?.debit);
    const creditTotal = decimal(group?._sum?.credit);
    const normalBalance = String(account.normalBalance || "").toUpperCase();
    const ledgerBalance = normalBalance === "DEBIT"
      ? debitTotal.minus(creditTotal)
      : normalBalance === "CREDIT"
        ? creditTotal.minus(debitTotal)
        : null;
    const storedBalance = decimal(account.currentBalance);
    const variance = ledgerBalance === null ? null : storedBalance.minus(ledgerBalance);
    const isReconciled = variance !== null && variance.abs().lessThanOrEqualTo("0.05");

    return {
      accountId: account.id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      normalBalance,
      storedBalance: storedBalance.toNumber(),
      journalDerivedBalance: ledgerBalance?.toNumber() ?? null,
      variance: variance?.toNumber() ?? null,
      isReconciled,
    };
  });
  const unresolvedCount = accountRows.filter((row) => !row.isReconciled).length;

  return {
    coverageStatus: "ALL_GL_ACCOUNTS",
    source: "POSTED_JOURNAL_LINES",
    journalStatusesIncluded: BALANCE_REPORT_JOURNAL_STATUSES,
    accountCount: accountRows.length,
    unresolvedCount,
    isReconciled: accountRows.length > 0 && unresolvedCount === 0,
    accounts: accountRows,
    coverageNote: "This compares journal-derived account balances with stored GL balances. Opening balances must be represented by posted journals; this check does not reconcile operational subledgers.",
  };
};
