import assert from "node:assert/strict";
import test from "node:test";
import { getRealtimeFinancialStatements } from "../controllers/accountingController.js";
import { prisma } from "../config/db.js";

const replaceMethod = (t, target, key, implementation) => {
  const original = target[key];
  target[key] = implementation;
  t.after(() => {
    target[key] = original;
  });
};

test("realtime balance sheet includes distributor COD receivables and distributor payables", async (t) => {
  const accounts = [
    { id: "account-1190", accountCode: "1190", accountType: "ASSET", normalBalance: "DEBIT" },
    { id: "account-2190", accountCode: "2190", accountType: "LIABILITY", normalBalance: "CREDIT" },
    { id: "account-4100", accountCode: "4100", accountType: "REVENUE", normalBalance: "CREDIT" },
    { id: "account-2120", accountCode: "2120", accountType: "LIABILITY", normalBalance: "CREDIT" },
    { id: "account-6430", accountCode: "6430", accountType: "EXPENSE", normalBalance: "DEBIT" },
  ];
  const transactionDate = new Date("2026-10-30T12:00:00.000Z");
  const entries = [
    { accountCode: "1190", debit: 1500, credit: 0 },
    { accountCode: "4100", debit: 0, credit: 1327.43 },
    { accountCode: "2120", debit: 0, credit: 172.57 },
    { accountCode: "6430", debit: 350, credit: 0 },
    { accountCode: "2190", debit: 0, credit: 350 },
  ];
  const lines = entries.map((entry) => {
    const account = accounts.find((item) => item.accountCode === entry.accountCode);
    return {
      accountId: account.id,
      account,
      debit: entry.debit,
      credit: entry.credit,
      journalEntry: { transactionDate, sourceType: "TEST" },
    };
  });

  replaceMethod(t, prisma.account, "findMany", async () => accounts);
  replaceMethod(t, prisma.journalLine, "findMany", async () => lines);
  replaceMethod(t, prisma.accountingEvent, "groupBy", async () => []);
  replaceMethod(t, prisma.accountingEvent, "findMany", async () => []);

  let response;
  await getRealtimeFinancialStatements(
    { query: { startDate: "2026-10-30", endDate: "2026-10-30" } },
    { json: (payload) => { response = payload; } },
  );

  assert.equal(response.success, true);
  assert.equal(response.balanceSheet.assets.currentAssets.distributorCodReceivable, 1500);
  assert.equal(response.balanceSheet.assets.currentAssets.totalCurrentAssets, 1500);
  assert.equal(response.balanceSheet.liabilities.currentLiabilities.distributorPayable, 350);
  assert.equal(response.balanceSheet.liabilities.currentLiabilities.totalCurrentLiabilities, 522.57);
  assert.equal(response.balanceSheet.assets.totalAssets, 1500);
  assert.equal(response.balanceSheet.totalLiabilitiesAndEquity, 1500);
  assert.equal(response.balanceSheet.isBalanceSheetBalanced, true);
});
