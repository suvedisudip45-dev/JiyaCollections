import { prisma } from "../config/db.js";
import { postJournalEntry } from "./accountingPostingEngine.js";

/**
 * Closes an entire fiscal year:
 * 1. Closes all underlying monthly accounting periods.
 * 2. Sums all posted revenues (4xxx) and expenses (5xxx, 6xxx, 7xxx).
 * 3. Generates a balanced closing Journal Entry:
 *    - DR all Revenue accounts with net credit balance (to zero them out).
 *    - CR all Expense accounts with net debit balance (to zero them out).
 *    - Posts net income difference into Account 3300 (Retained Earnings).
 * 4. Marks the FiscalYear as CLOSED and locks the period.
 */
export const closeFiscalYear = async ({
  fiscalYearId,
  closedBy = "ADMIN",
}) => {
  const fy = await prisma.fiscalYear.findUnique({
    where: { id: fiscalYearId },
    include: { periods: true },
  });

  if (!fy) {
    throw new Error(`Fiscal Year with ID ${fiscalYearId} not found.`);
  }

  if (fy.status === "CLOSED" || fy.isClosed) {
    throw new Error(`Fiscal Year ${fy.name} is already closed.`);
  }

  // 1. Close any remaining open periods in this fiscal year
  await prisma.accountingPeriod.updateMany({
    where: { fiscalYearId: fy.id, status: "OPEN" },
    data: { status: "CLOSED" },
  });

  // 2. Fetch all posted journal lines within this fiscal year date range
  const journalLines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        status: "POSTED",
        transactionDate: { gte: fy.startDate, lte: fy.endDate },
        sourceType: { not: "PERIOD_CLOSING" }, // Exclude any prior closing entry
      },
    },
    include: {
      account: true,
    },
  });

  // 3. Aggregate net balances by account code
  const accountBalances = new Map();
  for (const line of journalLines) {
    const code = line.account.accountCode;
    const type = line.account.accountType;
    const name = line.account.accountName;
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (!accountBalances.has(code)) {
      accountBalances.set(code, {
        accountId: line.accountId,
        accountCode: code,
        accountName: name,
        accountType: type,
        netDebit: 0,
        netCredit: 0,
      });
    }

    const current = accountBalances.get(code);
    current.netDebit += debit;
    current.netCredit += credit;
  }

  // 4. Identify Revenue (4000-4999) and Expense/COGS (5000-7999) accounts
  const closingLines = [];
  let totalRevenueNet = 0;
  let totalExpenseNet = 0;

  for (const [code, item] of accountBalances.entries()) {
    const isRevenue = item.accountType === "REVENUE" || code.startsWith("4");
    const isExpense = item.accountType === "EXPENSE" || code.startsWith("5") || code.startsWith("6") || code.startsWith("7");

    if (isRevenue) {
      const netCredit = Number((item.netCredit - item.netDebit).toFixed(2));
      if (Math.abs(netCredit) > 0.001) {
        totalRevenueNet += netCredit;
        // Zero out Revenue: If net credit, DR to zero it; if net debit, CR to zero it
        if (netCredit > 0) {
          closingLines.push({
            accountCode: code,
            debit: netCredit,
            credit: 0,
            description: `Closing Revenue account ${code} (${item.accountName}) to Retained Earnings`,
          });
        } else {
          closingLines.push({
            accountCode: code,
            debit: 0,
            credit: Math.abs(netCredit),
            description: `Closing negative Revenue account ${code} (${item.accountName}) to Retained Earnings`,
          });
        }
      }
    } else if (isExpense) {
      const netDebit = Number((item.netDebit - item.netCredit).toFixed(2));
      if (Math.abs(netDebit) > 0.001) {
        totalExpenseNet += netDebit;
        // Zero out Expense: If net debit, CR to zero it; if net credit, DR to zero it
        if (netDebit > 0) {
          closingLines.push({
            accountCode: code,
            debit: 0,
            credit: netDebit,
            description: `Closing Expense account ${code} (${item.accountName}) to Retained Earnings`,
          });
        } else {
          closingLines.push({
            accountCode: code,
            debit: Math.abs(netDebit),
            credit: 0,
            description: `Closing negative Expense account ${code} (${item.accountName}) to Retained Earnings`,
          });
        }
      }
    }
  }

  const netIncome = Number((totalRevenueNet - totalExpenseNet).toFixed(2));

  // 5. Transfer Net Income to Retained Earnings (Account 3300)
  if (Math.abs(netIncome) > 0.001) {
    if (netIncome > 0) {
      // Net Profit: Credit Retained Earnings
      closingLines.push({
        accountCode: "3300",
        debit: 0,
        credit: netIncome,
        description: `Net Profit transfer to Retained Earnings for ${fy.name}`,
      });
    } else {
      // Net Loss: Debit Retained Earnings
      closingLines.push({
        accountCode: "3300",
        debit: Math.abs(netIncome),
        credit: 0,
        description: `Net Loss absorption against Retained Earnings for ${fy.name}`,
      });
    }
  }

  let closingJournal = null;
  if (closingLines.length >= 2) {
    closingJournal = await postJournalEntry({
      transactionDate: fy.endDate,
      sourceType: "PERIOD_CLOSING",
      sourceId: fy.id,
      idempotencyKey: `FISCAL_CLOSING:${fy.id}`,
      referenceNumber: `CLOSE-${fy.name.replace(/\//g, "-")}`,
      description: `Fiscal Year Closing Entry for ${fy.name} (Revenues: Rs ${totalRevenueNet.toFixed(2)}, Expenses: Rs ${totalExpenseNet.toFixed(2)}, Net: Rs ${netIncome.toFixed(2)})`,
      lines: closingLines,
      createdBy: closedBy,
      allowClosedPeriod: true,
    });
  }

  // 6. Update Fiscal Year record to CLOSED
  const updatedFy = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: {
      status: "CLOSED",
      isClosed: true,
      closedAt: new Date(),
      closedBy,
    },
  });

  return {
    success: true,
    fiscalYear: updatedFy,
    netIncome,
    totalRevenue: totalRevenueNet,
    totalExpenses: totalExpenseNet,
    closingJournalEntry: closingJournal,
  };
};

/**
 * Reopens a closed fiscal year (Admin only):
 * Reverses the period closing journal entry and sets status back to OPEN.
 */
export const reopenFiscalYear = async ({ fiscalYearId, reopenedBy = "ADMIN", reason = "Audit Correction" }) => {
  const fy = await prisma.fiscalYear.findUnique({
    where: { id: fiscalYearId },
  });

  if (!fy) throw new Error(`Fiscal Year ${fiscalYearId} not found.`);
  if (fy.status !== "CLOSED" && !fy.isClosed) {
    throw new Error(`Fiscal Year ${fy.name} is already OPEN.`);
  }

  // Find and reverse the closing journal entry
  const closingEntry = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "PERIOD_CLOSING",
      sourceId: fy.id,
      status: "POSTED",
    },
    include: { lines: true },
  });

  if (closingEntry) {
    const reversalLines = closingEntry.lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      description: `Reversal of closing entry for FY reopening: ${line.description || ""}`,
    }));

    await postJournalEntry({
      transactionDate: new Date(),
      sourceType: "REVERSAL",
      sourceId: closingEntry.id,
      idempotencyKey: `REVERSE_CLOSING:${closingEntry.id}`,
      referenceNumber: `REV-${closingEntry.journalNumber}`,
      description: `Reversal of Fiscal Year ${fy.name} Closing Entry: ${reason}`,
      lines: reversalLines,
      createdBy: reopenedBy,
      allowClosedPeriod: true,
    });

    await prisma.journalEntry.update({
      where: { id: closingEntry.id },
      data: { status: "REVERSED", reversalReason: reason },
    });
  }

  const updatedFy = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: {
      status: "OPEN",
      isClosed: false,
      closedAt: null,
      closedBy: null,
    },
  });

  return {
    success: true,
    fiscalYear: updatedFy,
    message: `Fiscal Year ${fy.name} has been reopened successfully.`,
  };
};
