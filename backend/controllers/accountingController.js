import { prisma } from "../config/db.js";
import {
  ensureStandardChartOfAccounts,
  ensureFiscalYearAndPeriod,
  postJournalEntry,
  reverseJournalEntryById,
} from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

// ==========================================
// 1. CHART OF ACCOUNTS (COA)
// ==========================================

export const getChartOfAccounts = async (req, res) => {
  try {
    await ensureStandardChartOfAccounts();

    const accounts = await prisma.account.findMany({
      include: {
        parentAccount: { select: { id: true, accountCode: true, accountName: true } },
      },
      orderBy: { accountCode: "asc" },
    });

    // Group by category for quick high-level summary
    const summary = {
      totalAccounts: accounts.length,
      assetsCount: accounts.filter((a) => a.accountType === "ASSET").length,
      liabilitiesCount: accounts.filter((a) => a.accountType === "LIABILITY").length,
      equityCount: accounts.filter((a) => a.accountType === "EQUITY").length,
      revenueCount: accounts.filter((a) => a.accountType === "REVENUE").length,
      expenseCount: accounts.filter((a) => a.accountType === "EXPENSE").length,
    };

    res.json({ success: true, accounts, summary });
  } catch (error) {
    console.error("Get Chart of Accounts Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createAccount = async (req, res) => {
  try {
    const { accountCode, accountName, accountType, normalBalance, parentAccountId, description } = req.body;

    if (!accountCode || !accountName || !accountType) {
      return res.json({ success: false, message: "Account Code, Name, and Type are required." });
    }

    const existing = await prisma.account.findUnique({ where: { accountCode: accountCode.trim() } });
    if (existing) {
      return res.json({ success: false, message: `Account code ${accountCode} already exists.` });
    }

    let resolvedNormalBalance = normalBalance;
    if (!resolvedNormalBalance) {
      resolvedNormalBalance = accountType === "ASSET" || accountType === "EXPENSE" ? "DEBIT" : "CREDIT";
    }

    const account = await prisma.account.create({
      data: {
        accountCode: accountCode.trim(),
        accountName: accountName.trim(),
        accountType,
        normalBalance: resolvedNormalBalance,
        parentAccountId: parentAccountId || null,
        description: description || null,
        isSystemAccount: false,
        isActive: true,
        currentBalance: 0,
      },
    });

    res.json({ success: true, message: "Account created successfully in Chart of Accounts.", account });
  } catch (error) {
    console.error("Create Account Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const updateAccount = async (req, res) => {
  try {
    const { id, accountName, description, isActive } = req.body;
    if (!id) return res.json({ success: false, message: "Account ID is required." });

    const account = await prisma.account.update({
      where: { id },
      data: {
        accountName: accountName ? accountName.trim() : undefined,
        description: description !== undefined ? description : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    });

    res.json({ success: true, message: "Account updated successfully.", account });
  } catch (error) {
    console.error("Update Account Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. JOURNAL ENTRIES
// ==========================================

export const getJournalEntries = async (req, res) => {
  try {
    const { sourceType, status, startDate, endDate, search } = req.query;
    const pagination = getPagination(req.query);

    const where = {};
    if (sourceType) where.sourceType = sourceType;
    if (status) where.status = status;
    if (startDate && endDate) {
      where.transactionDate = {
        gte: new Date(startDate),
        lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
      };
    }
    if (search) {
      where.OR = [
        { journalNumber: { contains: search } },
        { referenceNumber: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [journalEntries, total] = await prisma.$transaction([
      prisma.journalEntry.findMany({
        where,
        include: {
        lines: {
          include: {
            account: { select: { accountCode: true, accountName: true, accountType: true } },
          },
        },
        },
        orderBy: { transactionDate: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json(paginatedResponse("journalEntries", journalEntries, pagination, total));
  } catch (error) {
    console.error("Get Journal Entries Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getJournalEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!entry) {
      return res.json({ success: false, message: "Journal Entry not found." });
    }

    res.json({ success: true, journalEntry: entry });
  } catch (error) {
    console.error("Get Journal Entry By ID Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createManualJournalEntry = async (req, res) => {
  try {
    const { transactionDate, referenceNumber, description, lines } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return res.json({ success: false, message: "Manual journal entry must have at least 2 lines." });
    }

    const result = await postJournalEntry({
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      sourceType: "MANUAL_JOURNAL",
      sourceId: `MANUAL-${Date.now()}`,
      referenceNumber: referenceNumber || "",
      description: description || "Manual Journal Entry",
      lines,
      createdBy: "admin",
    });

    res.json({
      success: true,
      message: `Journal entry ${result.journalEntry.journalNumber} created and posted successfully.`,
      journalEntry: result.journalEntry,
    });
  } catch (error) {
    console.error("Create Manual Journal Entry Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const reverseJournalEntry = async (req, res) => {
  try {
    const { journalEntryId, reversalReason } = req.body;
    if (!journalEntryId) {
      return res.json({ success: false, message: "Journal Entry ID is required for reversal." });
    }

    const reversedEntry = await reverseJournalEntryById({
      journalEntryId,
      reversalReason: reversalReason || "Reversed by admin",
      reversedBy: "admin",
    });

    res.json({
      success: true,
      message: `Journal entry successfully reversed with new entry ${reversedEntry.journalNumber}.`,
      reversedEntry,
    });
  } catch (error) {
    console.error("Reverse Journal Entry Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. GENERAL LEDGER REPORT / STATEMENT
// ==========================================

export const getGeneralLedgerReport = async (req, res) => {
  try {
    const accountId = req.params.accountId || req.query.accountId;
    const { startDate, endDate } = req.query;

    if (!accountId) {
      return res.json({ success: false, message: "Please select an account for the General Ledger statement." });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.json({ success: false, message: "Selected account not found." });
    }

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();

    // 1. Calculate Opening Balance prior to startDate
    const priorLines = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          status: "POSTED",
          transactionDate: { lt: start },
        },
      },
      select: { debit: true, credit: true },
    });

    let openingBalance = 0;
    for (const l of priorLines) {
      if (account.normalBalance === "DEBIT") {
        openingBalance += Number(l.debit || 0) - Number(l.credit || 0);
      } else {
        openingBalance += Number(l.credit || 0) - Number(l.debit || 0);
      }
    }
    openingBalance = Number(openingBalance.toFixed(2));

    // 2. Fetch Period Journal Lines
    const periodLines = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          status: "POSTED",
          transactionDate: { gte: start, lte: end },
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            journalNumber: true,
            transactionDate: true,
            sourceType: true,
            referenceNumber: true,
            description: true,
          },
        },
      },
      orderBy: {
        journalEntry: {
          transactionDate: "asc",
        },
      },
    });

    // 3. Calculate Running Balances
    let runningBalance = openingBalance;
    let totalPeriodDebit = 0;
    let totalPeriodCredit = 0;

    const statementLines = periodLines.map((l) => {
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);
      totalPeriodDebit += debit;
      totalPeriodCredit += credit;

      if (account.normalBalance === "DEBIT") {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }
      runningBalance = Number(runningBalance.toFixed(2));

      return {
        id: l.id,
        date: l.journalEntry.transactionDate,
        journalNumber: l.journalEntry.journalNumber,
        journalEntryId: l.journalEntry.id,
        sourceType: l.journalEntry.sourceType,
        referenceNumber: l.journalEntry.referenceNumber,
        description: l.description || l.journalEntry.description,
        customerName: l.customerName,
        supplierName: l.supplierName,
        debit,
        credit,
        runningBalance,
      };
    });

    totalPeriodDebit = Number(totalPeriodDebit.toFixed(2));
    totalPeriodCredit = Number(totalPeriodCredit.toFixed(2));
    const closingBalance = runningBalance;

    res.json({
      success: true,
      account,
      dateRange: { start, end },
      metrics: {
        openingBalance,
        totalPeriodDebit,
        totalPeriodCredit,
        closingBalance,
        linesCount: statementLines.length,
      },
      statementLines,
    });
  } catch (error) {
    console.error("Get General Ledger Report Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. TRIAL BALANCE REPORT
// ==========================================

export const getTrialBalanceReport = async (req, res) => {
  try {
    const { startDate, endDate, asOfDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = asOfDate
      ? new Date(new Date(asOfDate).setHours(23, 59, 59, 999))
      : endDate
      ? new Date(new Date(endDate).setHours(23, 59, 59, 999))
      : new Date();

    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { accountCode: "asc" },
    });

    let totalOpeningDebit = 0;
    let totalOpeningCredit = 0;
    let totalPeriodDebit = 0;
    let totalPeriodCredit = 0;
    let totalClosingDebit = 0;
    let totalClosingCredit = 0;

    const trialBalanceRows = [];

    for (const acc of accounts) {
      // Prior transactions for opening balance
      const priorLines = await prisma.journalLine.findMany({
        where: {
          accountId: acc.id,
          journalEntry: {
            status: "POSTED",
            transactionDate: { lt: start },
          },
        },
        select: { debit: true, credit: true },
      });

      let priorDr = 0;
      let priorCr = 0;
      for (const l of priorLines) {
        priorDr += Number(l.debit || 0);
        priorCr += Number(l.credit || 0);
      }

      let openingDr = 0;
      let openingCr = 0;
      if (acc.normalBalance === "DEBIT") {
        const net = priorDr - priorCr;
        if (net >= 0) openingDr = net;
        else openingCr = Math.abs(net);
      } else {
        const net = priorCr - priorDr;
        if (net >= 0) openingCr = net;
        else openingDr = Math.abs(net);
      }

      // Period transactions
      const periodLines = await prisma.journalLine.findMany({
        where: {
          accountId: acc.id,
          journalEntry: {
            status: "POSTED",
            transactionDate: { gte: start, lte: end },
          },
        },
        select: { debit: true, credit: true },
      });

      let periodDr = 0;
      let periodCr = 0;
      for (const l of periodLines) {
        periodDr += Number(l.debit || 0);
        periodCr += Number(l.credit || 0);
      }

      // Closing balance
      const totalAccDr = priorDr + periodDr;
      const totalAccCr = priorCr + periodCr;
      let closingDr = 0;
      let closingCr = 0;

      if (totalAccDr >= totalAccCr) {
        closingDr = Number((totalAccDr - totalAccCr).toFixed(2));
      } else {
        closingCr = Number((totalAccCr - totalAccDr).toFixed(2));
      }

      totalOpeningDebit += openingDr;
      totalOpeningCredit += openingCr;
      totalPeriodDebit += periodDr;
      totalPeriodCredit += periodCr;
      totalClosingDebit += closingDr;
      totalClosingCredit += closingCr;

      // Only include if there is any activity or non-zero balance
      if (openingDr > 0 || openingCr > 0 || periodDr > 0 || periodCr > 0 || closingDr > 0 || closingCr > 0) {
        trialBalanceRows.push({
          id: acc.id,
          accountCode: acc.accountCode,
          accountName: acc.accountName,
          accountType: acc.accountType,
          category: acc.accountType,
          normalBalance: acc.normalBalance,
          openingDebit: Number(openingDr.toFixed(2)),
          openingCredit: Number(openingCr.toFixed(2)),
          periodDebit: Number(periodDr.toFixed(2)),
          periodCredit: Number(periodCr.toFixed(2)),
          closingDebit: Number(closingDr.toFixed(2)),
          closingCredit: Number(closingCr.toFixed(2)),
        });
      }
    }

    totalOpeningDebit = Number(totalOpeningDebit.toFixed(2));
    totalOpeningCredit = Number(totalOpeningCredit.toFixed(2));
    totalPeriodDebit = Number(totalPeriodDebit.toFixed(2));
    totalPeriodCredit = Number(totalPeriodCredit.toFixed(2));
    totalClosingDebit = Number(totalClosingDebit.toFixed(2));
    totalClosingCredit = Number(totalClosingCredit.toFixed(2));

    const isBalanced = Math.abs(totalClosingDebit - totalClosingCredit) <= 0.05;

    res.json({
      success: true,
      dateRange: { start, end },
      totals: {
        totalOpeningDebit,
        totalOpeningCredit,
        totalPeriodDebit,
        totalPeriodCredit,
        totalClosingDebit,
        totalClosingCredit,
        isBalanced,
      },
      isBalanced,
      rows: trialBalanceRows,
      trialBalance: trialBalanceRows,
    });
  } catch (error) {
    console.error("Get Trial Balance Report Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. REALTIME P&L AND BALANCE SHEET DERIVED FROM GL
// ==========================================

export const getRealtimeFinancialStatements = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();

    const [allAccounts, journalLines] = await Promise.all([
      prisma.account.findMany({ where: { isActive: true } }),
      prisma.journalLine.findMany({
        where: {
          journalEntry: {
            status: "POSTED",
            transactionDate: { lte: end },
          },
        },
        include: {
          journalEntry: { select: { transactionDate: true } },
          account: true,
        },
      }),
    ]);

    // Compute Net Activity per account for (1) Cumulative and (2) In-Period
    const accountPeriodMap = {};
    const accountCumulativeMap = {};

    allAccounts.forEach((a) => {
      accountPeriodMap[a.id] = 0;
      accountCumulativeMap[a.id] = 0;
    });

    journalLines.forEach((l) => {
      const isPeriod = new Date(l.journalEntry.transactionDate) >= start;
      const dr = Number(l.debit || 0);
      const cr = Number(l.credit || 0);
      const normal = l.account.normalBalance;
      const net = normal === "DEBIT" ? dr - cr : cr - dr;

      accountCumulativeMap[l.accountId] = (accountCumulativeMap[l.accountId] || 0) + net;
      if (isPeriod) {
        accountPeriodMap[l.accountId] = (accountPeriodMap[l.accountId] || 0) + net;
      }
    });

    // 1. PROFIT & LOSS BREAKDOWN
    let grossSales = 0;
    let shippingRevenue = 0;
    let salesReturns = 0;
    let salesDiscounts = 0;
    let directCOGS = 0;
    let freightTransport = 0;
    let packagingExpense = 0;
    let purchaseReturns = 0;
    let scrapLoss = 0;

    let salaries = 0;
    let rent = 0;
    let utilities = 0;
    let marketing = 0;
    let softwareTools = 0;
    let depreciationExpense = 0;
    let miscExpenses = 0;
    let loanInterest = 0;
    let bankCharges = 0;
    let otherIncome = 0;

    allAccounts.forEach((a) => {
      const periodBal = Number(accountPeriodMap[a.id] || 0);
      const code = a.accountCode;

      if (code === "4100") grossSales += periodBal;
      else if (code === "4200") shippingRevenue += periodBal;
      else if (code === "4500") salesReturns += periodBal;
      else if (code === "4600") salesDiscounts += periodBal;
      else if (code === "5100") directCOGS += periodBal;
      else if (code === "5200") freightTransport += periodBal;
      else if (code === "5300") packagingExpense += periodBal;
      else if (code === "5400") purchaseReturns += periodBal;
      else if (code === "5500") scrapLoss += periodBal;
      else if (code === "6100") salaries += periodBal;
      else if (code === "6200") rent += periodBal;
      else if (code === "6300") utilities += periodBal;
      else if (code === "6400") marketing += periodBal;
      else if (code === "6500") softwareTools += periodBal;
      else if (code === "6600") depreciationExpense += periodBal;
      else if (code === "6700") miscExpenses += periodBal;
      else if (code === "7100") loanInterest += periodBal;
      else if (code === "7200") bankCharges += periodBal;
      else if (code === "8100") otherIncome += periodBal;
    });

    const netRevenue = Number((grossSales + shippingRevenue - salesReturns - salesDiscounts).toFixed(2));
    const totalCOGS = Number((directCOGS + freightTransport + packagingExpense + scrapLoss - purchaseReturns).toFixed(2));
    const grossProfit = Number((netRevenue - totalCOGS).toFixed(2));
    const totalOperatingExpenses = Number((salaries + rent + utilities + marketing + softwareTools + miscExpenses).toFixed(2));
    const ebitda = Number((grossProfit - totalOperatingExpenses).toFixed(2));
    const netProfitBeforeTax = Number((ebitda - depreciationExpense - loanInterest - bankCharges + otherIncome).toFixed(2));

    // 2. BALANCE SHEET BREAKDOWN (Cumulative as of endDate)
    let cash = 0;
    let bank = 0;
    let ar = 0;
    let inventory = 0;
    let inputVat = 0;
    let supplierAdvances = 0;
    let fixedAssetsGross = 0;
    let accumulatedDepreciation = 0;

    let ap = 0;
    let outputVat = 0;
    let taxPayable = 0;
    let customerRefundsPayable = 0;
    let dividendsPayable = 0;
    let bankLoans = 0;

    let shareCapital = 0;
    let sharePremium = 0;
    let retainedEarnings = 0;

    allAccounts.forEach((a) => {
      const cumBal = Number(accountCumulativeMap[a.id] || 0);
      const code = a.accountCode;

      if (code === "1110") cash += cumBal;
      else if (code === "1120") bank += cumBal;
      else if (code === "1130") ar += cumBal;
      else if (code === "1140") inventory += cumBal;
      else if (code === "1150") inputVat += cumBal;
      else if (code === "1160") supplierAdvances += cumBal;
      else if (["1510", "1520", "1530"].includes(code)) fixedAssetsGross += cumBal;
      else if (code === "1590") accumulatedDepreciation += cumBal;
      else if (code === "2110") ap += cumBal;
      else if (code === "2120") outputVat += cumBal;
      else if (code === "2130") taxPayable += cumBal;
      else if (code === "2140") customerRefundsPayable += cumBal;
      else if (code === "2150") dividendsPayable += cumBal;
      else if (code === "2510") bankLoans += cumBal;
      else if (code === "3100") shareCapital += cumBal;
      else if (code === "3200") sharePremium += cumBal;
      else if (code === "3300") retainedEarnings += cumBal;
    });

    const netFixedAssets = Number((fixedAssetsGross - accumulatedDepreciation).toFixed(2));
    const totalCurrentAssets = Number((cash + bank + ar + inventory + inputVat + supplierAdvances).toFixed(2));
    const totalAssets = Number((totalCurrentAssets + netFixedAssets).toFixed(2));

    const totalCurrentLiabilities = Number((ap + outputVat + taxPayable + customerRefundsPayable + dividendsPayable).toFixed(2));
    const totalLongTermLiabilities = Number(bankLoans.toFixed(2));
    const totalLiabilities = Number((totalCurrentLiabilities + totalLongTermLiabilities).toFixed(2));

    // Retained Earnings + Current Year Net Profit from P&L
    const totalEquity = Number((shareCapital + sharePremium + retainedEarnings + netProfitBeforeTax).toFixed(2));
    const totalLiabilitiesAndEquity = Number((totalLiabilities + totalEquity).toFixed(2));

    const isBalanceSheetBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) <= 0.05;

    res.json({
      success: true,
      period: { start, end },
      incomeStatement: {
        revenue: {
          grossSales,
          shippingRevenue,
          salesReturns,
          salesDiscounts,
          netRevenue,
        },
        costOfGoodsSold: {
          directCOGS,
          freightTransport,
          packagingExpense,
          scrapLoss,
          purchaseReturns,
          totalCOGS,
        },
        grossProfit,
        operatingExpenses: {
          salaries,
          rent,
          utilities,
          marketing,
          softwareTools,
          miscExpenses,
          totalOperatingExpenses,
        },
        ebitda,
        nonOperating: {
          depreciationExpense,
          loanInterest,
          bankCharges,
          otherIncome,
        },
        netProfitBeforeTax,
      },
      balanceSheet: {
        assets: {
          currentAssets: {
            cash,
            bank,
            accountsReceivable: ar,
            inventory,
            inputVat,
            supplierAdvances,
            totalCurrentAssets,
          },
          fixedAssets: {
            grossAssets: fixedAssetsGross,
            accumulatedDepreciation,
            netFixedAssets,
          },
          totalAssets,
        },
        liabilities: {
          currentLiabilities: {
            accountsPayable: ap,
            outputVat,
            taxPayable,
            customerRefundsPayable,
            dividendsPayable,
            totalCurrentLiabilities,
          },
          longTermLiabilities: {
            bankLoans,
            totalLongTermLiabilities,
          },
          totalLiabilities,
        },
        equity: {
          shareCapital,
          sharePremium,
          retainedEarnings,
          currentPeriodNetProfit: netProfitBeforeTax,
          totalEquity,
        },
        totalLiabilitiesAndEquity,
        isBalanceSheetBalanced,
      },
    });
  } catch (error) {
    console.error("Get Realtime Financial Statements Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. SUB-LEDGER RECONCILIATION
// ==========================================

export const getSubledgerReconciliation = async (req, res) => {
  try {
    const [arAccount, apAccount, bankAccount, cashAccount, payables, receivables, accounts] = await Promise.all([
      prisma.account.findUnique({ where: { accountCode: "1130" } }),
      prisma.account.findUnique({ where: { accountCode: "2110" } }),
      prisma.account.findUnique({ where: { accountCode: "1120" } }),
      prisma.account.findUnique({ where: { accountCode: "1110" } }),
      prisma.accountPayable.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
      prisma.accountReceivable.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_RECEIVED"] } } }),
      prisma.financialAccount.findMany({ where: { status: "ACTIVE" } }),
    ]);

    const arControlBalance = Number(arAccount?.currentBalance || 0);
    const sumReceivables = receivables.reduce((acc, r) => acc + Number(r.remainingBalance || 0), 0);

    const apControlBalance = Number(apAccount?.currentBalance || 0);
    const sumPayables = payables.reduce((acc, p) => acc + Number(p.remainingBalance || 0), 0);

    const bankControlBalance = Number(bankAccount?.currentBalance || 0);
    const cashControlBalance = Number(cashAccount?.currentBalance || 0);
    const sumLiquidTreasury = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);

    res.json({
      success: true,
      reconciliation: {
        accountsReceivable: {
          glControlAccount: "1130 Accounts Receivable",
          glControlBalance: arControlBalance,
          subledgerTotal: Number(sumReceivables.toFixed(2)),
          variance: Number((arControlBalance - sumReceivables).toFixed(2)),
          isReconciled: Math.abs(arControlBalance - sumReceivables) <= 0.05,
        },
        accountsPayable: {
          glControlAccount: "2110 Accounts Payable",
          glControlBalance: apControlBalance,
          subledgerTotal: Number(sumPayables.toFixed(2)),
          variance: Number((apControlBalance - sumPayables).toFixed(2)),
          isReconciled: Math.abs(apControlBalance - sumPayables) <= 0.05,
        },
        cashAndBank: {
          glControlAccounts: "1110 Cash + 1120 Bank Accounts",
          glTotalBalance: Number((cashControlBalance + bankControlBalance).toFixed(2)),
          treasuryAccountsTotal: Number(sumLiquidTreasury.toFixed(2)),
          variance: Number((cashControlBalance + bankControlBalance - sumLiquidTreasury).toFixed(2)),
          isReconciled: Math.abs(cashControlBalance + bankControlBalance - sumLiquidTreasury) <= 0.05,
        },
      },
    });
  } catch (error) {
    console.error("Get Subledger Reconciliation Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 7. FISCAL YEARS AND PERIODS
// ==========================================

export const getFiscalYearsAndPeriods = async (req, res) => {
  try {
    const fiscalYears = await prisma.fiscalYear.findMany({
      include: {
        periods: {
          orderBy: { periodName: "asc" },
        },
      },
      orderBy: { startDate: "desc" },
    });
    res.json({ success: true, fiscalYears });
  } catch (error) {
    console.error("Get Fiscal Years Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createFiscalYear = async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) {
      return res.json({ success: false, message: "Fiscal Year Name, Start Date, and End Date are required." });
    }

    const fy = await prisma.fiscalYear.create({
      data: {
        name: name.trim(),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: "OPEN",
      },
    });

    res.json({ success: true, message: "Fiscal Year created successfully.", fiscalYear: fy });
  } catch (error) {
    console.error("Create Fiscal Year Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const togglePeriodStatus = async (req, res) => {
  try {
    const { periodId, status } = req.body;
    if (!periodId || !["OPEN", "CLOSED"].includes(status)) {
      return res.json({ success: false, message: "Valid Period ID and Status (OPEN/CLOSED) are required." });
    }

    const updated = await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status },
    });

    res.json({ success: true, message: `Accounting period ${updated.periodName} is now ${status}.`, period: updated });
  } catch (error) {
    console.error("Toggle Period Status Error:", error);
    res.json({ success: false, message: error.message });
  }
};
