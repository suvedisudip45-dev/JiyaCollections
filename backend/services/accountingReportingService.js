import { prisma } from "../config/db.js";
import { isLegacyPerOrderDeliveryExpenseEntry } from "./accountingRecognitionPolicy.js";

const toCents = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const toAmount = (cents) => Number((cents / 100).toFixed(2));

const signedBalance = (debitCents, creditCents, normalBalance) =>
  normalBalance === "CREDIT" ? creditCents - debitCents : debitCents - creditCents;

const isVatFilingJournal = (sourceType) =>
  String(sourceType || "").startsWith("VAT_RETURN") ||
  String(sourceType || "").startsWith("VAT_PAYMENT") ||
  sourceType === "VAT_ASSESSMENT_ADJUSTMENT";

export const buildPostedFinanceSnapshot = ({ lines = [], startDate, endDate }) => {
  const periodTotals = new Map();
  const closingTotals = new Map();
  const vatPeriodCents = { outputVat: 0, inputVat: 0 };
  const openingVatCents = { outputVatCredit: 0, inputVatCredit: 0 };
  const start = startDate ? new Date(startDate).getTime() : Number.NEGATIVE_INFINITY;
  const end = endDate ? new Date(endDate).getTime() : Number.POSITIVE_INFINITY;

  for (const line of lines) {
    const account = line.account;
    const journalEntry = line.journalEntry;
    if (!account?.accountCode || !journalEntry?.transactionDate) continue;
    if (journalEntry.status && journalEntry.status !== "POSTED") continue;
    if (isLegacyPerOrderDeliveryExpenseEntry({
      accountCode: account.accountCode,
      sourceType: journalEntry.sourceType,
    })) continue;

    const transactionTime = new Date(journalEntry.transactionDate).getTime();
    if (!Number.isFinite(transactionTime) || transactionTime > end) continue;

    const debit = toCents(line.debit);
    const credit = toCents(line.credit);
    const totals = closingTotals.get(account.accountCode) || { debit: 0, credit: 0, account };
    totals.debit += debit;
    totals.credit += credit;
    closingTotals.set(account.accountCode, totals);

    if (transactionTime < start && account.accountCode === "1150") {
      openingVatCents.inputVatCredit += debit - credit;
    }
    if (transactionTime < start && account.accountCode === "2120") {
      openingVatCents.outputVatCredit += debit - credit;
    }

    if (transactionTime >= start) {
      const period = periodTotals.get(account.accountCode) || { debit: 0, credit: 0, account };
      period.debit += debit;
      period.credit += credit;
      periodTotals.set(account.accountCode, period);
      if (!isVatFilingJournal(journalEntry.sourceType)) {
        if (account.accountCode === "2120") vatPeriodCents.outputVat += credit - debit;
        if (account.accountCode === "1150") vatPeriodCents.inputVat += debit - credit;
      }
    }
  }

  const serialize = (totals) => Object.fromEntries([...totals].map(([code, value]) => [
    code,
    {
      debit: toAmount(value.debit),
      credit: toAmount(value.credit),
      balance: toAmount(signedBalance(value.debit, value.credit, value.account.normalBalance)),
      accountType: value.account.accountType || null,
      accountName: value.account.accountName || null,
    },
  ]));

  const period = serialize(periodTotals);
  const closing = serialize(closingTotals);
  const balance = (code, source = period) => source[code]?.balance || 0;
  const netRevenue = balance("4100") + balance("4200") - balance("4500") - balance("4600");
  const totalCogs = balance("5100") + balance("5200") + balance("5300") + balance("5500") - balance("5400");
  const totalOperatingExpenses = ["6100", "6200", "6300", "6400", "6410", "6420", "6430", "6440", "6500", "6600", "6700"]
    .reduce((total, code) => total + balance(code), 0);
  const otherIncome = balance("8100");
  const loanInterestExpense = balance("7100");
  const bankCharges = balance("7200");
  const nonOperatingNet = otherIncome - loanInterestExpense - bankCharges;
  const grossProfit = netRevenue - totalCogs;
  const netProfitBeforeTax = grossProfit - totalOperatingExpenses + nonOperatingNet;
  const outputVat = toAmount(vatPeriodCents.outputVat);
  const inputVat = toAmount(vatPeriodCents.inputVat);
  const carriedForwardInputVat = Math.max(0, toAmount(openingVatCents.inputVatCredit));
  const carriedForwardOutputVat = 0;
  const closingBalance = (code) => balance(code, closing);

  const currentAssets = ["1110", "1120", "1130", "1140", "1150", "1160", "1165", "1170", "1180", "1190"]
    .reduce((total, code) => total + balance(code, closing), 0);
  const fixedAssets = ["1510", "1520", "1530", "1590"]
    .reduce((total, code) => total + balance(code, closing), 0);
  const currentLiabilities = ["2110", "2120", "2130", "2140", "2150", "2160", "2170", "2180", "2190"]
    .reduce((total, code) => total + balance(code, closing), 0);
  const longTermLiabilities = balance("2510", closing);
  const totalAssets = currentAssets + fixedAssets;
  const totalLiabilities = currentLiabilities + longTermLiabilities;

  return {
    basis: "POSTED_JOURNALS",
    period: {
      start: startDate ? new Date(startDate).toISOString() : null,
      end: endDate ? new Date(endDate).toISOString() : null,
    },
    incomeStatement: {
      netRevenue: toAmount(toCents(netRevenue)),
      totalCogs: toAmount(toCents(totalCogs)),
      grossProfit: toAmount(toCents(grossProfit)),
      totalOperatingExpenses: toAmount(toCents(totalOperatingExpenses)),
      otherOperatingExpenses: toAmount(toCents(balance("6700"))),
      otherIncome: toAmount(toCents(otherIncome)),
      loanInterestExpense: toAmount(toCents(loanInterestExpense)),
      bankCharges: toAmount(toCents(bankCharges)),
      netProfitBeforeTax: toAmount(toCents(netProfitBeforeTax)),
    },
    vat: {
      outputVat,
      inputVat,
      carriedForwardInputVat,
      carriedForwardOutputVat,
      netVatPayable: toAmount(toCents(outputVat - inputVat - carriedForwardInputVat - carriedForwardOutputVat)),
    },
    balanceSheet: {
      cash: toAmount(toCents(closingBalance("1110"))),
      bank: toAmount(toCents(closingBalance("1120"))),
      accountsReceivable: toAmount(toCents(closingBalance("1130"))),
      inventory: toAmount(toCents(closingBalance("1140"))),
      inputVatReceivable: toAmount(toCents(closingBalance("1150"))),
      vatTaxPrepayments: toAmount(toCents(closingBalance("1165"))),
      codReceivable: toAmount(toCents(closingBalance("1170"))),
      distributorCodReceivable: toAmount(toCents(closingBalance("1190"))),
      gatewayClearing: toAmount(toCents(closingBalance("1180"))),
      currentAssets: toAmount(toCents(currentAssets)),
      fixedAssets: toAmount(toCents(fixedAssets)),
      totalAssets: toAmount(toCents(totalAssets)),
      accountsPayable: toAmount(toCents(closingBalance("2110"))),
      outputVatPayable: toAmount(toCents(closingBalance("2120"))),
      manufacturerPayable: toAmount(toCents(closingBalance("2160"))),
      marketingPartnerPayable: toAmount(toCents(closingBalance("2170"))),
      carrierPayable: toAmount(toCents(closingBalance("2180"))),
      distributorPayable: toAmount(toCents(closingBalance("2190"))),
      currentLiabilities: toAmount(toCents(currentLiabilities)),
      longTermLiabilities: toAmount(toCents(longTermLiabilities)),
      totalLiabilities: toAmount(toCents(totalLiabilities)),
    },
    periodAccounts: period,
    closingAccounts: closing,
  };
};

export const getPostedFinanceSnapshot = async ({ startDate, endDate, client = prisma }) => {
  const lines = await client.journalLine.findMany({
    where: {
      journalEntry: {
        status: "POSTED",
        transactionDate: { lte: endDate },
      },
    },
    select: {
      debit: true,
      credit: true,
      account: {
        select: {
          accountCode: true,
          accountName: true,
          accountType: true,
          normalBalance: true,
        },
      },
      journalEntry: {
        select: {
          transactionDate: true,
          sourceType: true,
          status: true,
        },
      },
    },
  });

  return buildPostedFinanceSnapshot({ lines, startDate, endDate });
};
