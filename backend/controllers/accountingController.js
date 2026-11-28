import { prisma } from "../config/db.js";
import {
  ensureStandardChartOfAccounts,
  ensureFiscalYearAndPeriod,
} from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { buildTreasuryGlReconciliation } from "../services/treasuryAccountingService.js";
import {
  getConfiguredNepaliDateRange,
  getConfiguredNepaliFiscalPeriod,
  getConfiguredNepaliFiscalYear,
  getNepaliCalendarYears,
  resolveCalendarDateFilterInput,
} from "../services/nepaliFiscalCalendar.js";
import { getDeliveryAccountingOutboxStatus } from "../services/accountingOutboxService.js";
import { buildPartySubledgerReconciliation } from "../services/partySubledgerReconciliationService.js";
import { isLegacyPerOrderDeliveryExpenseEntry } from "../services/accountingRecognitionPolicy.js";
import { buildDirectCashFlowStatement } from "../services/accountingCashFlowService.js";
import {
  BALANCE_REPORT_JOURNAL_STATUSES,
  buildGeneralLedgerBalanceReconciliation,
} from "../services/accountingLedgerIntegrityService.js";
import {
  accountingDecimal,
  addDecimals,
  compareDecimals,
  serializeAccountingValue,
  subtractDecimals,
} from "../services/accountingDecimal.js";
import { buildAccountingControlCoverage } from "../services/accountingControlCoverageService.js";
import {
  buildManufacturerLogisticsReconciliation,
  buildManufacturerProductionReconciliation,
} from "../services/manufacturerLogisticsReconciliationService.js";
import { buildCustomerRefundPayableReconciliation } from "../services/customerRefundPayableReconciliationService.js";
import { buildCollaborationFeeReceivableReconciliation } from "../services/collaborationFeeReceivableReconciliationService.js";
import {
  getCollaborationFeeCreditApplications as listCollaborationFeeCreditApplications,
} from "../services/collaborationFeeCreditApplicationService.js";
import { buildNcmCarrierFeeReconciliation } from "../services/ncmCarrierFeeReconciliationService.js";
import { buildMarketingCpaPayableReconciliation } from "../services/marketingCpaPayableReconciliationService.js";
import { buildFixedAssetReconciliation } from "../services/fixedAssetReconciliationService.js";
import { buildInventoryValuationReconciliation } from "../services/inventoryValuationReconciliationService.js";
import { loadPlatformInventoryValuationSources } from "../services/inventoryValuationSourceService.js";
import {
  createAccountingPeriodClosePack,
  getAccountingPeriodCloseChecklist,
  submitAccountingPeriodClose,
  reviewAccountingPeriodClose,
  requestAccountingPeriodReopen,
  reviewAccountingPeriodReopen,
} from "../services/accountingPeriodCloseService.js";
import {
  listAccountingActionApprovals,
  requestAccountingActionApproval,
  reviewAccountingActionApproval,
} from "../services/accountingActionApprovalService.js";

const getAccountingAdminActor = (req) => ({
  accountId: req.auth?.accountId || req.auth?.userId || null,
  role: req.auth?.role,
});
const getAccountingRequestKey = (req) =>
  req.headers?.["idempotency-key"] || req.body?.idempotencyKey || "";
const getAccountingAuditContext = (req) => ({
  ipAddress: req.ip || null,
  userAgent: req.get?.("user-agent") || null,
  correlationId: req.correlationId || null,
});
const buildPostedLedgerReportBasis = ({ start, end }) => ({
  classification: "POSTED_JOURNAL_LEDGER",
  source: "JournalEntry and JournalLine",
  includedJournalStatuses: [...BALANCE_REPORT_JOURNAL_STATUSES],
  dateField: "JournalEntry.transactionDate",
  period: { start, end },
  sourceCompleteness: "NOT_ESTABLISHED",
  subledgerReconciliation: "NOT_ESTABLISHED",
  limitations: [
    "Only journal entries in the included posted/reversed statuses are reported; pending and unposted accounting events are excluded.",
    "Balanced journal totals do not establish completeness of source events or operational subledgers.",
    "Opening balances not represented by included journal lines are not reconstructed from operational records.",
  ],
});

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
    const result = await requestAccountingActionApproval({
      actionType: "COA_CREATE",
      requestKey: getAccountingRequestKey(req),
      payload: req.body,
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });
    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This chart-of-accounts request already exists." : "Chart-of-accounts change submitted for independent Admin approval.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Create Account Error:", error);
    res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message });
  }
};

export const updateAccount = async (req, res) => {
  try {
    const result = await requestAccountingActionApproval({
      actionType: "COA_UPDATE",
      requestKey: getAccountingRequestKey(req),
      payload: req.body,
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });
    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This chart-of-accounts request already exists." : "Chart-of-accounts change submitted for independent Admin approval.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Update Account Error:", error);
    res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message });
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
      const dateRange = req.query.calendar === "BS"
        ? await getConfiguredNepaliDateRange(startDate, endDate)
        : { startDate: new Date(startDate), endDate: getNepalDateBoundary(endDate, true) };
      where.transactionDate = {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
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

    res.json({
      ...paginatedResponse("journalEntries", journalEntries, pagination, total),
      accountingPostingStatus: await getDeliveryAccountingOutboxStatus(),
    });
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
    const { transactionDate } = req.body || {};
    const resolvedDate = req.body?.calendar === "BS" && transactionDate
        ? (await getConfiguredNepaliDateRange(transactionDate, transactionDate)).startDate
        : transactionDate ? new Date(transactionDate) : new Date();
    const actionType = String(req.body?.actionType || "MANUAL_JOURNAL").toUpperCase();
    if (!["MANUAL_JOURNAL", "OPENING_BALANCE"].includes(actionType)) {
      return res.status(400).json({ success: false, code: "INVALID_ACCOUNTING_ACTION", message: "Choose a supported manual journal type." });
    }
    const result = await requestAccountingActionApproval({
      actionType,
      requestKey: getAccountingRequestKey(req),
      payload: { ...req.body, transactionDate: resolvedDate },
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });
    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This journal request already exists." : "Journal submitted for independent Admin approval; it has not been posted.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Create Manual Journal Entry Error:", error);
    res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message });
  }
};

export const reverseJournalEntry = async (req, res) => {
  try {
    const { journalEntryId, reversalReason } = req.body;
    if (!journalEntryId || String(reversalReason || "").trim().length < 3) {
      return res.status(400).json({ success: false, message: "Journal entry ID and a reversal reason of at least three characters are required." });
    }

    const result = await requestAccountingActionApproval({
      actionType: "JOURNAL_REVERSAL",
      requestKey: getAccountingRequestKey(req),
      payload: { journalEntryId, reason: reversalReason },
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });

    res.status(result.isReplay ? 200 : 202).json({
      success: true,
      message: result.isReplay ? "This journal reversal request already exists." : "Journal reversal submitted for independent Admin approval; no reversal has been posted.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Reverse Journal Entry Error:", error);
    res.status(error.statusCode || 400).json({ success: false, code: error.code || "JOURNAL_REVERSAL_FAILED", message: error.message });
  }
};

export const getAccountingActionApprovals = async (req, res) => {
  try {
    const approvalRequests = await listAccountingActionApprovals({
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, approvalRequests });
  } catch (error) {
    console.error("Get Accounting Action Approvals Error:", error);
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message });
  }
};

export const reviewAccountingActionApprovalController = async (req, res) => {
  try {
    const result = await reviewAccountingActionApproval({
      approvalId: req.body?.approvalId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });
    return res.status(200).json({
      success: true,
      message: result.isReplay
        ? "This accounting action was already reviewed."
        : result.approvalRequest.status === "APPROVED"
          ? "Accounting action approved and executed."
          : "Accounting action rejected; no financial entry or balance change was executed.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Review Accounting Action Approval Error:", error);
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message });
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

    const calendar = String(req.query.calendar || "AD").trim().toUpperCase();
    const reportRange = await resolveCalendarDateFilterInput(startDate, endDate, calendar);
    const start = reportRange.startDate || (await getConfiguredNepaliFiscalPeriod(new Date())).fiscalYearStart;
    const end = reportRange.endDate || new Date();
    const endIsDateOnly = typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    const endFilter = endIsDateOnly
      ? { lt: new Date(end.getTime() + 1) }
      : { lte: end };

    // 1. Calculate Opening Balance prior to startDate
    const priorLines = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          status: { in: BALANCE_REPORT_JOURNAL_STATUSES },
          transactionDate: { lt: start },
        },
      },
      select: { debit: true, credit: true },
    });

    let openingBalance = accountingDecimal("0");
    for (const l of priorLines) {
      if (account.normalBalance === "DEBIT") {
        openingBalance = addDecimals(
          openingBalance,
          subtractDecimals(l.debit ?? "0", l.credit ?? "0"),
        );
      } else {
        openingBalance = addDecimals(
          openingBalance,
          subtractDecimals(l.credit ?? "0", l.debit ?? "0"),
        );
      }
    }

    // 2. Fetch Period Journal Lines
    const periodLines = await prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          status: { in: BALANCE_REPORT_JOURNAL_STATUSES },
          transactionDate: { gte: start, ...endFilter },
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
    let totalPeriodDebit = accountingDecimal("0");
    let totalPeriodCredit = accountingDecimal("0");

    const statementLines = periodLines.map((l) => {
      const debit = accountingDecimal(l.debit ?? "0");
      const credit = accountingDecimal(l.credit ?? "0");
      totalPeriodDebit = addDecimals(totalPeriodDebit, debit);
      totalPeriodCredit = addDecimals(totalPeriodCredit, credit);

      if (account.normalBalance === "DEBIT") {
        runningBalance = addDecimals(runningBalance, subtractDecimals(debit, credit));
      } else {
        runningBalance = addDecimals(runningBalance, subtractDecimals(credit, debit));
      }

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
        debit: debit.toString(),
        credit: credit.toString(),
        runningBalance: runningBalance.toString(),
      };
    });

    const closingBalance = runningBalance;

    res.json({
      success: true,
      account,
      dateRange: { start, end },
      reportBasis: buildPostedLedgerReportBasis({ start, end }),
      metrics: {
        openingBalance: openingBalance.toString(),
        totalPeriodDebit: totalPeriodDebit.toString(),
        totalPeriodCredit: totalPeriodCredit.toString(),
        closingBalance: closingBalance.toString(),
        linesCount: statementLines.length,
      },
      statementLines,
      accountingPostingStatus: await getDeliveryAccountingOutboxStatus(),
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

    const reportEndDate = asOfDate || endDate;
    const calendar = String(req.query.calendar || "AD").trim().toUpperCase();
    const reportRange = await resolveCalendarDateFilterInput(startDate, reportEndDate, calendar);
    const start = reportRange.startDate || (await getConfiguredNepaliFiscalPeriod(new Date())).fiscalYearStart;
    const end = reportRange.endDate || new Date();
    const endIsDateOnly = typeof reportEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportEndDate);
    const endFilter = endIsDateOnly
      ? { lt: new Date(end.getTime() + 1) }
      : { lte: end };

    const accounts = await prisma.account.findMany({
      orderBy: { accountCode: "asc" },
    });

    let totalOpeningDebit = accountingDecimal("0");
    let totalOpeningCredit = accountingDecimal("0");
    let totalPeriodDebit = accountingDecimal("0");
    let totalPeriodCredit = accountingDecimal("0");
    let totalClosingDebit = accountingDecimal("0");
    let totalClosingCredit = accountingDecimal("0");

    const trialBalanceRows = [];

    for (const acc of accounts) {
      // Prior transactions for opening balance
      const priorLines = await prisma.journalLine.findMany({
        where: {
          accountId: acc.id,
          journalEntry: {
            status: { in: BALANCE_REPORT_JOURNAL_STATUSES },
            transactionDate: { lt: start },
          },
        },
        select: { debit: true, credit: true },
      });

      let priorDr = accountingDecimal("0");
      let priorCr = accountingDecimal("0");
      for (const l of priorLines) {
        priorDr = addDecimals(priorDr, l.debit ?? "0");
        priorCr = addDecimals(priorCr, l.credit ?? "0");
      }

      let openingDr = accountingDecimal("0");
      let openingCr = accountingDecimal("0");
      if (acc.normalBalance === "DEBIT") {
        const net = subtractDecimals(priorDr, priorCr);
        if (compareDecimals(net, "0") >= 0) openingDr = net;
        else openingCr = net.abs();
      } else {
        const net = subtractDecimals(priorCr, priorDr);
        if (compareDecimals(net, "0") >= 0) openingCr = net;
        else openingDr = net.abs();
      }

      // Period transactions
      const periodLines = await prisma.journalLine.findMany({
        where: {
          accountId: acc.id,
          journalEntry: {
            status: { in: BALANCE_REPORT_JOURNAL_STATUSES },
            transactionDate: { gte: start, ...endFilter },
          },
        },
        select: { debit: true, credit: true },
      });

      let periodDr = accountingDecimal("0");
      let periodCr = accountingDecimal("0");
      for (const l of periodLines) {
        periodDr = addDecimals(periodDr, l.debit ?? "0");
        periodCr = addDecimals(periodCr, l.credit ?? "0");
      }

      // Closing balance
      const totalAccDr = addDecimals(priorDr, periodDr);
      const totalAccCr = addDecimals(priorCr, periodCr);
      let closingDr = accountingDecimal("0");
      let closingCr = accountingDecimal("0");

      if (compareDecimals(totalAccDr, totalAccCr) >= 0) {
        closingDr = subtractDecimals(totalAccDr, totalAccCr);
      } else {
        closingCr = subtractDecimals(totalAccCr, totalAccDr);
      }

      totalOpeningDebit = addDecimals(totalOpeningDebit, openingDr);
      totalOpeningCredit = addDecimals(totalOpeningCredit, openingCr);
      totalPeriodDebit = addDecimals(totalPeriodDebit, periodDr);
      totalPeriodCredit = addDecimals(totalPeriodCredit, periodCr);
      totalClosingDebit = addDecimals(totalClosingDebit, closingDr);
      totalClosingCredit = addDecimals(totalClosingCredit, closingCr);

      // Only include if there is any activity or non-zero balance
      if (
        !openingDr.isZero()
        || !openingCr.isZero()
        || !periodDr.isZero()
        || !periodCr.isZero()
        || !closingDr.isZero()
        || !closingCr.isZero()
      ) {
        trialBalanceRows.push({
          id: acc.id,
          accountCode: acc.accountCode,
          accountName: acc.accountName,
          accountType: acc.accountType,
          category: acc.accountType,
          normalBalance: acc.normalBalance,
          openingDebit: openingDr.toString(),
          openingCredit: openingCr.toString(),
          periodDebit: periodDr.toString(),
          periodCredit: periodCr.toString(),
          closingDebit: closingDr.toString(),
          closingCredit: closingCr.toString(),
        });
      }
    }

    const isBalanced = compareDecimals(totalClosingDebit, totalClosingCredit) === 0;

    res.json({
      success: true,
      dateRange: { start, end },
      reportBasis: buildPostedLedgerReportBasis({ start, end }),
      totals: {
        totalOpeningDebit: totalOpeningDebit.toString(),
        totalOpeningCredit: totalOpeningCredit.toString(),
        totalPeriodDebit: totalPeriodDebit.toString(),
        totalPeriodCredit: totalPeriodCredit.toString(),
        totalClosingDebit: totalClosingDebit.toString(),
        totalClosingCredit: totalClosingCredit.toString(),
        isBalanced,
      },
      isBalanced,
      rows: trialBalanceRows,
      trialBalance: trialBalanceRows,
      accountingPostingStatus: await getDeliveryAccountingOutboxStatus(),
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
    const calendar = String(req.query.calendar || "AD").trim().toUpperCase();
    const nepaliRange = calendar === "BS" && (startDate || endDate)
      ? await getConfiguredNepaliDateRange(startDate, endDate)
      : null;
    const gregorianRange = calendar === "BS" || (!startDate && !endDate)
      ? { startDate: null, endDate: null }
      : await resolveCalendarDateFilterInput(startDate, endDate, calendar);
    const start = nepaliRange?.startDate || gregorianRange.startDate
      || (await getConfiguredNepaliFiscalPeriod(new Date())).fiscalYearStart;
    const end = nepaliRange?.endDate || gregorianRange.endDate || new Date();
    const endIsDateOnly = typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    const endExclusive = endIsDateOnly ? new Date(end.getTime() + 1) : null;
    const transactionDateFilter = endIsDateOnly
      ? { lt: endExclusive }
      : { lte: end };

    const [allAccounts, journalLines] = await Promise.all([
      prisma.account.findMany(),
      prisma.journalLine.findMany({
        where: {
          journalEntry: {
            status: { in: BALANCE_REPORT_JOURNAL_STATUSES },
            transactionDate: transactionDateFilter,
          },
        },
        include: {
          journalEntry: { select: { id: true, transactionDate: true, sourceType: true } },
          account: true,
        },
      }),
    ]);
    const balanceSheetFiscalYearStart = (await getConfiguredNepaliFiscalPeriod(end)).fiscalYearStart;
    const cashFlowStatement = buildDirectCashFlowStatement({
      journalLines,
      startDate: start,
      endDate: end,
    });

    // Compute Net Activity per account for (1) Cumulative and (2) In-Period
    const accountPeriodMap = {};
    const accountCumulativeMap = {};
    const accountFiscalYearMap = {};
    const zero = () => accountingDecimal("0");

    allAccounts.forEach((a) => {
      accountPeriodMap[a.id] = zero();
      accountCumulativeMap[a.id] = zero();
      accountFiscalYearMap[a.id] = zero();
    });

    journalLines.forEach((l) => {
      if (isLegacyPerOrderDeliveryExpenseEntry({
        accountCode: l.account.accountCode,
        sourceType: l.journalEntry.sourceType,
      })) return;
      const isPeriod = new Date(l.journalEntry.transactionDate) >= start;
      const dr = accountingDecimal(l.debit ?? "0");
      const cr = accountingDecimal(l.credit ?? "0");
      const normal = l.account.normalBalance;
      const net = normal === "DEBIT"
        ? subtractDecimals(dr, cr)
        : subtractDecimals(cr, dr);

      accountCumulativeMap[l.accountId] = addDecimals(
        accountCumulativeMap[l.accountId] || zero(),
        net,
      );
      if (isPeriod) {
        accountPeriodMap[l.accountId] = addDecimals(
          accountPeriodMap[l.accountId] || zero(),
          net,
        );
      }
      if (new Date(l.journalEntry.transactionDate) >= balanceSheetFiscalYearStart) {
        accountFiscalYearMap[l.accountId] = addDecimals(
          accountFiscalYearMap[l.accountId] || zero(),
          net,
        );
      }
    });

    // 1. PROFIT & LOSS BREAKDOWN
    let grossSales = zero();
    let shippingRevenue = zero();
    let salesReturns = zero();
    let salesDiscounts = zero();
    let directCOGS = zero();
    let freightTransport = zero();
    let packagingExpense = zero();
    let purchaseReturns = zero();
    let scrapLoss = zero();

    let salaries = zero();
    let rent = zero();
    let utilities = zero();
    let marketing = zero();
    let manufacturerCommission = zero();
    let marketingPartnerCpa = zero();
    let deliveryExpense = zero();
    let ncmTransferExpense = zero();
    let softwareTools = zero();
    let depreciationExpense = zero();
    let miscExpenses = zero();
    let loanInterest = zero();
    let bankCharges = zero();
    let otherIncome = zero();

    allAccounts.forEach((a) => {
      const periodBal = accountPeriodMap[a.id] || zero();
      const code = a.accountCode;

      if (code === "4100") grossSales = addDecimals(grossSales, periodBal);
      else if (code === "4200") shippingRevenue = addDecimals(shippingRevenue, periodBal);
      else if (code === "4500") salesReturns = addDecimals(salesReturns, periodBal);
      else if (code === "4600") salesDiscounts = addDecimals(salesDiscounts, periodBal);
      else if (code === "5100") directCOGS = addDecimals(directCOGS, periodBal);
      else if (code === "5200") freightTransport = addDecimals(freightTransport, periodBal);
      else if (code === "5300") packagingExpense = addDecimals(packagingExpense, periodBal);
      else if (code === "5400") purchaseReturns = addDecimals(purchaseReturns, periodBal);
      else if (code === "5500") scrapLoss = addDecimals(scrapLoss, periodBal);
      else if (code === "6100") salaries = addDecimals(salaries, periodBal);
      else if (code === "6200") rent = addDecimals(rent, periodBal);
      else if (code === "6300") utilities = addDecimals(utilities, periodBal);
      else if (code === "6400") marketing = addDecimals(marketing, periodBal);
      else if (code === "6410") manufacturerCommission = addDecimals(manufacturerCommission, periodBal);
      else if (code === "6420") marketingPartnerCpa = addDecimals(marketingPartnerCpa, periodBal);
      else if (code === "6430") deliveryExpense = addDecimals(deliveryExpense, periodBal);
      else if (code === "6440") ncmTransferExpense = addDecimals(ncmTransferExpense, periodBal);
      else if (code === "6500") softwareTools = addDecimals(softwareTools, periodBal);
      else if (code === "6600") depreciationExpense = addDecimals(depreciationExpense, periodBal);
      else if (code === "6700") miscExpenses = addDecimals(miscExpenses, periodBal);
      else if (code === "7100") loanInterest = addDecimals(loanInterest, periodBal);
      else if (code === "7200") bankCharges = addDecimals(bankCharges, periodBal);
      else if (code === "8100") otherIncome = addDecimals(otherIncome, periodBal);
    });

    const netRevenue = subtractDecimals(
      addDecimals(grossSales, shippingRevenue),
      addDecimals(salesReturns, salesDiscounts),
    );
    const totalCOGS = subtractDecimals(
      addDecimals(directCOGS, freightTransport, packagingExpense, scrapLoss),
      purchaseReturns,
    );
    const grossProfit = subtractDecimals(netRevenue, totalCOGS);
    const totalOperatingExpenses = addDecimals(
      salaries,
      rent,
      utilities,
      marketing,
      manufacturerCommission,
      marketingPartnerCpa,
      deliveryExpense,
      ncmTransferExpense,
      softwareTools,
      miscExpenses,
    );
    const ebitda = subtractDecimals(grossProfit, totalOperatingExpenses);
    const netProfitBeforeTax = addDecimals(
      subtractDecimals(subtractDecimals(subtractDecimals(ebitda, depreciationExpense), loanInterest), bankCharges),
      otherIncome,
    );

    let fiscalYearGrossSales = zero();
    let fiscalYearShippingRevenue = zero();
    let fiscalYearSalesReturns = zero();
    let fiscalYearSalesDiscounts = zero();
    let fiscalYearDirectCOGS = zero();
    let fiscalYearFreightTransport = zero();
    let fiscalYearPackagingExpense = zero();
    let fiscalYearPurchaseReturns = zero();
    let fiscalYearScrapLoss = zero();
    let fiscalYearSalaries = zero();
    let fiscalYearRent = zero();
    let fiscalYearUtilities = zero();
    let fiscalYearMarketing = zero();
    let fiscalYearManufacturerCommission = zero();
    let fiscalYearMarketingPartnerCpa = zero();
    let fiscalYearDeliveryExpense = zero();
    let fiscalYearNcmTransferExpense = zero();
    let fiscalYearSoftwareTools = zero();
    let fiscalYearMiscExpenses = zero();
    let fiscalYearDepreciationExpense = zero();
    let fiscalYearLoanInterest = zero();
    let fiscalYearBankCharges = zero();
    let fiscalYearOtherIncome = zero();

    allAccounts.forEach((account) => {
      const balance = accountFiscalYearMap[account.id] || zero();
      switch (account.accountCode) {
        case "4100": fiscalYearGrossSales = addDecimals(fiscalYearGrossSales, balance); break;
        case "4200": fiscalYearShippingRevenue = addDecimals(fiscalYearShippingRevenue, balance); break;
        case "4500": fiscalYearSalesReturns = addDecimals(fiscalYearSalesReturns, balance); break;
        case "4600": fiscalYearSalesDiscounts = addDecimals(fiscalYearSalesDiscounts, balance); break;
        case "5100": fiscalYearDirectCOGS = addDecimals(fiscalYearDirectCOGS, balance); break;
        case "5200": fiscalYearFreightTransport = addDecimals(fiscalYearFreightTransport, balance); break;
        case "5300": fiscalYearPackagingExpense = addDecimals(fiscalYearPackagingExpense, balance); break;
        case "5400": fiscalYearPurchaseReturns = addDecimals(fiscalYearPurchaseReturns, balance); break;
        case "5500": fiscalYearScrapLoss = addDecimals(fiscalYearScrapLoss, balance); break;
        case "6100": fiscalYearSalaries = addDecimals(fiscalYearSalaries, balance); break;
        case "6200": fiscalYearRent = addDecimals(fiscalYearRent, balance); break;
        case "6300": fiscalYearUtilities = addDecimals(fiscalYearUtilities, balance); break;
        case "6400": fiscalYearMarketing = addDecimals(fiscalYearMarketing, balance); break;
        case "6410": fiscalYearManufacturerCommission = addDecimals(fiscalYearManufacturerCommission, balance); break;
        case "6420": fiscalYearMarketingPartnerCpa = addDecimals(fiscalYearMarketingPartnerCpa, balance); break;
        case "6430": fiscalYearDeliveryExpense = addDecimals(fiscalYearDeliveryExpense, balance); break;
        case "6440": fiscalYearNcmTransferExpense = addDecimals(fiscalYearNcmTransferExpense, balance); break;
        case "6500": fiscalYearSoftwareTools = addDecimals(fiscalYearSoftwareTools, balance); break;
        case "6600": fiscalYearDepreciationExpense = addDecimals(fiscalYearDepreciationExpense, balance); break;
        case "6700": fiscalYearMiscExpenses = addDecimals(fiscalYearMiscExpenses, balance); break;
        case "7100": fiscalYearLoanInterest = addDecimals(fiscalYearLoanInterest, balance); break;
        case "7200": fiscalYearBankCharges = addDecimals(fiscalYearBankCharges, balance); break;
        case "8100": fiscalYearOtherIncome = addDecimals(fiscalYearOtherIncome, balance); break;
        default: break;
      }
    });

    const fiscalYearNetRevenue = subtractDecimals(
      addDecimals(fiscalYearGrossSales, fiscalYearShippingRevenue),
      addDecimals(fiscalYearSalesReturns, fiscalYearSalesDiscounts),
    );
    const fiscalYearTotalCogs = subtractDecimals(
      addDecimals(
        fiscalYearDirectCOGS,
        fiscalYearFreightTransport,
        fiscalYearPackagingExpense,
        fiscalYearScrapLoss,
      ),
      fiscalYearPurchaseReturns,
    );
    const fiscalYearTotalOpex = addDecimals(
      fiscalYearSalaries,
      fiscalYearRent,
      fiscalYearUtilities,
      fiscalYearMarketing,
      fiscalYearManufacturerCommission,
      fiscalYearMarketingPartnerCpa,
      fiscalYearDeliveryExpense,
      fiscalYearNcmTransferExpense,
      fiscalYearSoftwareTools,
      fiscalYearMiscExpenses,
    );
    const currentFiscalYearNetProfit = addDecimals(
      subtractDecimals(
        subtractDecimals(
          subtractDecimals(
            subtractDecimals(fiscalYearNetRevenue, fiscalYearTotalCogs),
            fiscalYearTotalOpex,
          ),
          fiscalYearDepreciationExpense,
        ),
        fiscalYearLoanInterest,
      ),
      subtractDecimals(fiscalYearOtherIncome, fiscalYearBankCharges),
    );

    // 2. BALANCE SHEET BREAKDOWN (Cumulative as of endDate)
    let cash = zero();
    let bank = zero();
    let ar = zero();
    let codReceivable = zero();
    let distributorCodReceivable = zero();
    let gatewayClearing = zero();
    let inventory = zero();
    let inputVat = zero();
    let supplierAdvances = zero();
    let vatTaxPrepayments = zero();
    let fixedAssetsGross = zero();
    let accumulatedDepreciation = zero();

    let ap = zero();
    let manufacturerPayable = zero();
    let distributorPayable = zero();
    let marketingPartnerPayable = zero();
    let carrierPayable = zero();
    let outputVat = zero();
    let taxPayable = zero();
    let customerRefundsPayable = zero();
    let dividendsPayable = zero();
    let bankLoans = zero();

    let shareCapital = zero();
    let sharePremium = zero();
    let retainedEarnings = zero();

    allAccounts.forEach((a) => {
      const cumBal = accountCumulativeMap[a.id] || zero();
      const code = a.accountCode;

      if (code === "1110") cash = addDecimals(cash, cumBal);
      else if (code === "1120") bank = addDecimals(bank, cumBal);
      else if (code === "1130") ar = addDecimals(ar, cumBal);
      else if (code === "1170") codReceivable = addDecimals(codReceivable, cumBal);
      else if (code === "1190") distributorCodReceivable = addDecimals(distributorCodReceivable, cumBal);
      else if (code === "1180") gatewayClearing = addDecimals(gatewayClearing, cumBal);
      else if (code === "1140") inventory = addDecimals(inventory, cumBal);
      else if (code === "1150") inputVat = addDecimals(inputVat, cumBal);
      else if (code === "1160") supplierAdvances = addDecimals(supplierAdvances, cumBal);
      else if (code === "1165") vatTaxPrepayments = addDecimals(vatTaxPrepayments, cumBal);
      else if (["1510", "1520", "1530"].includes(code)) fixedAssetsGross = addDecimals(fixedAssetsGross, cumBal);
      else if (code === "1590") accumulatedDepreciation = addDecimals(accumulatedDepreciation, cumBal);
      else if (code === "2110") ap = addDecimals(ap, cumBal);
      else if (code === "2160") manufacturerPayable = addDecimals(manufacturerPayable, cumBal);
      else if (code === "2190") distributorPayable = addDecimals(distributorPayable, cumBal);
      else if (code === "2170") marketingPartnerPayable = addDecimals(marketingPartnerPayable, cumBal);
      else if (code === "2180") carrierPayable = addDecimals(carrierPayable, cumBal);
      else if (code === "2120") outputVat = addDecimals(outputVat, cumBal);
      else if (code === "2130") taxPayable = addDecimals(taxPayable, cumBal);
      else if (code === "2140") customerRefundsPayable = addDecimals(customerRefundsPayable, cumBal);
      else if (code === "2150") dividendsPayable = addDecimals(dividendsPayable, cumBal);
      else if (code === "2510") bankLoans = addDecimals(bankLoans, cumBal);
      else if (code === "3100") shareCapital = addDecimals(shareCapital, cumBal);
      else if (code === "3200") sharePremium = addDecimals(sharePremium, cumBal);
      else if (code === "3300") retainedEarnings = addDecimals(retainedEarnings, cumBal);
    });

    const netFixedAssets = subtractDecimals(fixedAssetsGross, accumulatedDepreciation);
    const totalCurrentAssets = addDecimals(
      cash,
      bank,
      ar,
      codReceivable,
      distributorCodReceivable,
      gatewayClearing,
      inventory,
      inputVat,
      supplierAdvances,
      vatTaxPrepayments,
    );
    const totalAssets = addDecimals(totalCurrentAssets, netFixedAssets);

    const totalCurrentLiabilities = addDecimals(
      ap,
      manufacturerPayable,
      distributorPayable,
      marketingPartnerPayable,
      carrierPayable,
      outputVat,
      taxPayable,
      customerRefundsPayable,
      dividendsPayable,
    );
    const totalLongTermLiabilities = bankLoans;
    const totalLiabilities = addDecimals(totalCurrentLiabilities, totalLongTermLiabilities);

    // Retained Earnings + Current Year Net Profit from P&L
    const totalEquity = addDecimals(
      shareCapital,
      sharePremium,
      retainedEarnings,
      currentFiscalYearNetProfit,
    );
    const totalLiabilitiesAndEquity = addDecimals(totalLiabilities, totalEquity);

    const isBalanceSheetBalanced = compareDecimals(totalAssets, totalLiabilitiesAndEquity) === 0;

    res.json({
      success: true,
      period: { start, end },
      reportBasis: buildPostedLedgerReportBasis({ start, end }),
      incomeStatement: serializeAccountingValue({
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
          manufacturerCommission,
          marketingPartnerCpa,
          deliveryExpense,
          ncmTransferExpense,
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
      }),
      balanceSheet: serializeAccountingValue({
        assets: {
          currentAssets: {
            cash,
            bank,
            accountsReceivable: ar,
            codReceivable,
            distributorCodReceivable,
            gatewayClearing,
            inventory,
            inputVat,
            supplierAdvances,
            vatTaxPrepayments,
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
            manufacturerPayable,
            distributorPayable,
            marketingPartnerPayable,
            carrierPayable,
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
          currentFiscalYearNetProfit,
          totalEquity,
        },
        totalLiabilitiesAndEquity,
        isBalanceSheetBalanced,
      }),
      cashFlowStatement,
      accountingPostingStatus: await getDeliveryAccountingOutboxStatus(),
    });
  } catch (error) {
    console.error("Get Realtime Financial Statements Error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code });
  }
};

// ==========================================
// 6. SUB-LEDGER RECONCILIATION
// ==========================================

export const getSubledgerReconciliation = async (req, res) => {
  try {
    const partyControlCodes = ["1170", "1190", "2180", "2190"];
    const [
      arAccount,
      apAccount,
      payables,
      receivables,
      accounts,
      accountingPostingStatus,
      partyDocumentGroups,
      partyControlAccounts,
      ledgerAccounts,
      fixedAssets,
      journalLineGroups,
      manufacturerLogisticsJournalLines,
      manufacturerLogisticsDocuments,
      manufacturerProductionJournalLines,
      manufacturerProductionDocuments,
      customerRefundPayableJournalLines,
      customerRefundPayables,
      collaborationFeeInvoices,
      collaborationFeeDocuments,
      collaborationFeeJournalLines,
      ncmCarrierFeeAccrualJournalLines,
      ncmCarrierFeeDocuments,
      ncmCarrierFeeSettlementJournalLines,
      marketingCpaJournalEntries,
      marketingCpaDocuments,
      marketingCpaRedemptionEvents,
    ] = await Promise.all([
      prisma.account.findUnique({ where: { accountCode: "1130" } }),
      prisma.account.findUnique({ where: { accountCode: "2110" } }),
      prisma.accountPayable.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
      prisma.accountReceivable.findMany({ where: { status: { in: ["UNPAID", "PARTIALLY_RECEIVED"] } } }),
      prisma.financialAccount.findMany({
        where: { status: "ACTIVE" },
        include: { accountingAccount: true },
      }),
      getDeliveryAccountingOutboxStatus(),
      prisma.accountingDocument.groupBy({
        by: ["side", "sourceType"],
        where: {
          status: { in: ["OPEN", "PARTIALLY_PAID"] },
          sourceType: { in: ["NCM_COD_SALE", "DISTRIBUTOR_COD_SALE", "NCM_CARRIER_FEE", "DISTRIBUTOR_DELIVERY_EARNING"] },
        },
        _sum: { remainingAmount: true },
        _count: { _all: true },
      }),
      prisma.account.findMany({
        where: { accountCode: { in: partyControlCodes } },
        select: { accountCode: true, currentBalance: true },
      }),
      prisma.account.findMany({
        select: {
          id: true,
          accountCode: true,
          accountName: true,
          normalBalance: true,
          currentBalance: true,
        },
        orderBy: { accountCode: "asc" },
      }),
      prisma.fixedAsset.findMany({
        select: {
          id: true,
          assetTag: true,
          assetName: true,
          category: true,
          purchaseCost: true,
          accumulatedDepreciation: true,
          currentBookValue: true,
          status: true,
        },
      }),
      prisma.journalLine.groupBy({
        by: ["accountId"],
        where: {
          journalEntry: { status: { in: BALANCE_REPORT_JOURNAL_STATUSES } },
        },
        _sum: { debit: true, credit: true },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "2160" } },
          journalEntry: { is: { sourceType: "MANUFACTURER_LOGISTICS", status: "POSTED" } },
        },
        select: {
          debit: true,
          credit: true,
          supplierId: true,
          accountingParty: { select: { partyType: true, sourceEntityId: true } },
          journalEntry: { select: { sourceId: true } },
        },
      }),
      prisma.accountingDocument.findMany({
        where: { side: "PAYABLE", sourceType: "MANUFACTURER_LOGISTICS" },
        select: {
          side: true,
          sourceId: true,
          originalAmount: true,
          remainingAmount: true,
          party: { select: { partyType: true, sourceEntityId: true } },
        },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "2160" } },
          journalEntry: { is: { sourceType: "MANUFACTURER_PRODUCTION", status: "POSTED" } },
        },
        select: {
          debit: true,
          credit: true,
          supplierId: true,
          accountingParty: { select: { partyType: true, sourceEntityId: true } },
          journalEntry: { select: { sourceId: true } },
        },
      }),
      prisma.accountingDocument.findMany({
        where: { side: "PAYABLE", sourceType: "MANUFACTURER_PRODUCTION" },
        select: {
          side: true,
          sourceId: true,
          originalAmount: true,
          remainingAmount: true,
          party: { select: { partyType: true, sourceEntityId: true } },
        },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "2110" } },
          journalEntry: {
            is: {
              sourceType: { in: ["SALES_RETURN", "ORDER_EXCHANGE"] },
              status: "POSTED",
            },
          },
        },
        select: {
          debit: true,
          credit: true,
          journalEntry: { select: { sourceType: true, sourceId: true } },
        },
      }),
      prisma.accountPayable.findMany({
        where: { referenceType: { in: ["CUSTOMER_REFUND", "CUSTOMER_EXCHANGE_REFUND"] } },
        select: {
          referenceType: true,
          referenceId: true,
          totalAmount: true,
          paidAmount: true,
          remainingBalance: true,
          status: true,
        },
      }),
      prisma.collaborationFeeInvoice.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
        },
      }),
      prisma.accountingDocument.findMany({
        where: { side: "RECEIVABLE", sourceType: "COLLABORATION_FEE" },
        select: {
          id: true,
          documentType: true,
          side: true,
          sourceType: true,
          sourceId: true,
          partyId: true,
          currency: true,
          issueDate: true,
          status: true,
          originalAmount: true,
          allocatedAmount: true,
          remainingAmount: true,
        },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "1130" } },
          journalEntry: { is: { sourceType: "COLLABORATION_FEE_INVOICE", status: "POSTED" } },
        },
        select: {
          debit: true,
          credit: true,
          journalEntry: { select: { sourceType: true, sourceId: true } },
        },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "2180" } },
          journalEntry: { is: { sourceType: "NCM_CARRIER_FEE_ACCRUAL", status: "POSTED" } },
        },
        select: {
          debit: true,
          credit: true,
          journalEntry: { select: { sourceType: true, sourceId: true } },
        },
      }),
      prisma.accountingDocument.findMany({
        where: { side: "PAYABLE", sourceType: "NCM_CARRIER_FEE" },
        select: {
          side: true,
          sourceType: true,
          sourceId: true,
          originalAmount: true,
          remainingAmount: true,
          allocations: { select: { amount: true, journalEntryId: true } },
        },
      }),
      prisma.journalLine.findMany({
        where: {
          account: { is: { accountCode: "2180" } },
          journalEntry: {
            is: {
              sourceType: "PAYMENT",
              sourceId: { startsWith: "NCM-REMIT-" },
              status: "POSTED",
            },
          },
        },
        select: {
          debit: true,
          credit: true,
          journalEntry: { select: { id: true, sourceType: true, sourceId: true } },
        },
      }),
      prisma.journalEntry.findMany({
        where: { sourceType: "MARKETING_CPA" },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          status: true,
          reversedEntryId: true,
          lines: {
            where: { account: { is: { accountCode: { in: ["6420", "2170"] } } } },
            select: {
              debit: true,
              credit: true,
              account: { select: { accountCode: true } },
              accountingParty: {
                select: { partyType: true, sourceEntityId: true, displayName: true },
              },
            },
          },
        },
      }),
      prisma.accountingDocument.findMany({
        where: { sourceType: "MARKETING_CPA" },
        select: {
          id: true,
          documentType: true,
          side: true,
          sourceType: true,
          sourceId: true,
          partyId: true,
          currency: true,
          status: true,
          originalAmount: true,
          allocatedAmount: true,
          remainingAmount: true,
          party: { select: { partyType: true, sourceEntityId: true, displayName: true } },
        },
      }),
      prisma.marketingCardEvent.findMany({
        where: { eventType: "BENEFIT_REDEEMED" },
        select: { id: true, eventType: true, referenceId: true, metadata: true },
      }),
    ]);

    const {
      locations: platformInventoryLocations,
      balances: platformInventoryBalances,
      layerBalances: platformInventoryLayerBalances,
    } = await loadPlatformInventoryValuationSources(prisma, {
      includeLostLocations: true,
      includeLedgerOnlyLocations: true,
    });

    const collaborationDocumentIds = collaborationFeeDocuments.map((document) => document.id);
    const collaborationFeeAllocations = collaborationDocumentIds.length
      ? await prisma.accountingAllocation.findMany({
        where: { documentId: { in: collaborationDocumentIds } },
        select: {
          documentId: true,
          journalEntryId: true,
          allocationType: true,
          idempotencyKey: true,
          amount: true,
        },
      })
      : [];
    const collaborationFeeCreditApplications = collaborationDocumentIds.length
      ? await prisma.collaborationFeeCreditApplication.findMany({
        where: {
          OR: [
            { creditDocumentId: { in: collaborationDocumentIds } },
            { invoiceDocumentId: { in: collaborationDocumentIds } },
          ],
        },
        select: {
          idempotencyKey: true,
          creditDocumentId: true,
          invoiceDocumentId: true,
          journalEntryId: true,
          amount: true,
        },
      })
      : [];
    const collaborationReceiptJournalIds = [
      ...new Set(collaborationFeeAllocations.map((allocation) => allocation.journalEntryId).filter(Boolean)),
    ];
    const [collaborationReceiptAllocations, collaborationReceiptJournals] = collaborationReceiptJournalIds.length
      ? await Promise.all([
        prisma.accountingAllocation.findMany({
          where: { journalEntryId: { in: collaborationReceiptJournalIds } },
          select: {
            documentId: true,
            journalEntryId: true,
            allocationType: true,
            idempotencyKey: true,
            amount: true,
          },
        }),
        prisma.journalEntry.findMany({
          where: { id: { in: collaborationReceiptJournalIds } },
          select: {
            id: true,
            status: true,
            sourceType: true,
            sourceId: true,
            lines: {
              where: { account: { is: { accountCode: "1130" } } },
              select: { debit: true, credit: true },
            },
          },
        }),
      ])
      : [[], []];

    const arControlBalance = accountingDecimal(arAccount?.currentBalance ?? "0");
    const sumReceivables = receivables.reduce(
      (total, receivable) => addDecimals(total, receivable.remainingBalance ?? "0"),
      accountingDecimal("0"),
    );
    const arVariance = subtractDecimals(arControlBalance, sumReceivables);

    const apControlBalance = accountingDecimal(apAccount?.currentBalance ?? "0");
    const sumPayables = payables.reduce(
      (total, payable) => addDecimals(total, payable.remainingBalance ?? "0"),
      accountingDecimal("0"),
    );
    const apVariance = subtractDecimals(apControlBalance, sumPayables);

    const cashAndBankReconciliation = buildTreasuryGlReconciliation(accounts);
    const partySubledgers = buildPartySubledgerReconciliation({
      documentGroups: partyDocumentGroups,
      accounts: partyControlAccounts,
    });
    const generalLedgerBalances = buildGeneralLedgerBalanceReconciliation({
      accounts: ledgerAccounts,
      journalLineGroups,
    });
    const accountingControlCoverage = buildAccountingControlCoverage({ accounts: ledgerAccounts });
    const fixedAssetReconciliation = buildFixedAssetReconciliation({
      assets: fixedAssets,
      accounts: ledgerAccounts,
    });
    const inventoryValuationReconciliation = buildInventoryValuationReconciliation({
      balances: platformInventoryBalances,
      layerBalances: platformInventoryLayerBalances,
      locations: platformInventoryLocations,
      accounts: ledgerAccounts,
    });
    const manufacturerLogisticsReconciliation = buildManufacturerLogisticsReconciliation({
      journalLines: manufacturerLogisticsJournalLines,
      documents: manufacturerLogisticsDocuments,
    });
    const manufacturerProductionReconciliation = buildManufacturerProductionReconciliation({
      journalLines: manufacturerProductionJournalLines,
      documents: manufacturerProductionDocuments,
    });
    const customerRefundPayableReconciliation = buildCustomerRefundPayableReconciliation({
      journalLines: customerRefundPayableJournalLines,
      payables: customerRefundPayables,
    });
    const collaborationFeeReceivableReconciliation = buildCollaborationFeeReceivableReconciliation({
      invoices: collaborationFeeInvoices,
      documents: collaborationFeeDocuments,
      journalLines: collaborationFeeJournalLines,
      documentAllocations: collaborationFeeAllocations,
      allocations: collaborationReceiptAllocations,
      collectionJournals: collaborationReceiptJournals,
      creditApplications: collaborationFeeCreditApplications,
    });
    const ncmCarrierFeeReconciliation = buildNcmCarrierFeeReconciliation({
      accrualJournalLines: ncmCarrierFeeAccrualJournalLines,
      documents: ncmCarrierFeeDocuments,
      settlementJournalLines: ncmCarrierFeeSettlementJournalLines,
    });
    const marketingCpaPayableReconciliation = buildMarketingCpaPayableReconciliation({
      redemptionEvents: marketingCpaRedemptionEvents,
      journalEntries: marketingCpaJournalEntries,
      documents: marketingCpaDocuments,
    });

    res.json({
      success: true,
      coverageStatus: "PARTIAL",
      coverageGaps: [
        "Legacy AR checks only account 1130; collaboration fee invoices are checked separately below, while COD, gateway, and other receivables remain incomplete.",
        "Legacy AP checks account 2110; accepted-production, local-freight, and platform-funded customer refund sources are checked separately below, while settlement clearing, legacy delivery accruals, and other manufacturer, marketing-partner, and carrier balances remain incomplete.",
        "Marketing CPA redemption-event, journal, and bill matching is source-scoped below; historical rates, legacy settlements, payouts, and the full 2170 control remain unresolved.",
        "Party-level checks below cover only the listed NCM and distributor sources; carrier-fee accrual, bill, allocation, and remittance clearing is checked separately below, while historical and other-party documents remain incomplete.",
        "Delivery-sale accounting events are tracked below; other source events without journals are not yet exhaustively reconciled.",
        "GL balances are compared with journal-derived balances; any opening balance not represented by a posted journal remains unresolved.",
        `${accountingControlCoverage.unreconciledCount} configured balance-sheet control accounts do not yet have complete operational subledger reconciliation.`,
      ],
      reconciliation: {
        coverageStatus: "PARTIAL",
        coverageGaps: [
          "Legacy AR checks only account 1130; collaboration fee invoices are checked separately below, while COD, gateway, and other receivables remain incomplete.",
          "Legacy AP checks account 2110; accepted-production, local-freight, and platform-funded customer refund sources are checked separately below, while settlement clearing, legacy delivery accruals, and other manufacturer, marketing-partner, and carrier balances remain incomplete.",
          "Marketing CPA journal-to-bill matching is source-scoped below; missing accruals, legacy settlements, payouts, and the full 2170 control remain unresolved.",
          "Party-level checks below cover only the listed NCM and distributor sources; carrier-fee accrual, bill, allocation, and remittance clearing is checked separately below, while historical and other-party documents remain incomplete.",
          "Delivery-sale accounting events are tracked below; other source events without journals are not yet exhaustively reconciled.",
          "GL balances are compared with journal-derived balances; any opening balance not represented by a posted journal remains unresolved.",
          `${accountingControlCoverage.unreconciledCount} configured balance-sheet control accounts do not yet have complete operational subledger reconciliation.`,
        ],
        accountsReceivable: {
          glControlAccount: "1130 Accounts Receivable",
          coverageStatus: "LEGACY_PARTIAL",
          glControlBalance: arControlBalance.toString(),
          subledgerTotal: sumReceivables.toString(),
          variance: arVariance.toString(),
          isReconciled: arVariance.isZero(),
        },
        accountsPayable: {
          glControlAccount: "2110 Accounts Payable",
          coverageStatus: "LEGACY_PARTIAL",
          glControlBalance: apControlBalance.toString(),
          subledgerTotal: sumPayables.toString(),
          variance: apVariance.toString(),
          isReconciled: apVariance.isZero(),
        },
        partySubledgers,
        generalLedgerBalances,
        accountingControlCoverage,
        fixedAssetReconciliation,
        inventoryValuationReconciliation,
        customerRefundPayableReconciliation,
        collaborationFeeReceivableReconciliation,
        ncmCarrierFeeReconciliation,
        marketingCpaPayableReconciliation,
        manufacturerProductionReconciliation,
        manufacturerLogisticsReconciliation,
        cashAndBank: {
          glControlAccounts: "Explicitly mapped Treasury asset accounts",
          ...cashAndBankReconciliation,
        },
        accountingPostingStatus,
      },
      accountingPostingStatus,
    });
  } catch (error) {
    console.error("Get Subledger Reconciliation Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getCollaborationFeeCreditApplications = async (req, res) => {
  try {
    const result = await listCollaborationFeeCreditApplications();
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Get Collaboration Fee Credit Applications Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to load collaboration-fee credit applications.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

export const postCollaborationFeeCreditApplication = async (req, res) => {
  try {
    const result = await requestAccountingActionApproval({
      actionType: "COLLABORATION_CREDIT_APPLICATION",
      requestKey: getAccountingRequestKey(req),
      payload: {
        creditDocumentId: req.body?.creditDocumentId,
        invoiceDocumentId: req.body?.invoiceDocumentId,
        amount: req.body?.amount,
        reason: req.body?.notes,
      },
      actor: getAccountingAdminActor(req),
      auditContext: getAccountingAuditContext(req),
    });
    return res.status(result.isReplay ? 200 : 202).json({
      success: true,
      alreadyPending: true,
      message: result.isReplay
        ? "This collaboration-fee credit application request already exists."
        : "Partner credit application submitted for independent Admin approval.",
      approvalRequest: result.approvalRequest,
    });
  } catch (error) {
    console.error("Apply Collaboration Fee Credit Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to apply collaboration-fee credit.",
      ...(error.code ? { code: error.code } : {}),
    });
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
          include: {
            closeEvents: {
              orderBy: { sequence: "desc" },
              take: 20,
              select: {
                id: true,
                sequence: true,
                cycle: true,
                eventType: true,
                actorAccountId: true,
                actorRole: true,
                subjectSequence: true,
                checklistSnapshot: true,
                reason: true,
                createdAt: true,
              },
            },
          },
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
    const { name, startDate, endDate, calendar } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Fiscal Year Name, BS start date, and BS end date are required." });
    }
    if (calendar && String(calendar).trim().toUpperCase() !== "BS") {
      return res.status(400).json({
        success: false,
        message: "Fiscal year dates must use the BS calendar.",
        code: "INVALID_CALENDAR",
      });
    }
    const result = await prisma.$transaction(async (tx) => {
      const calendars = await getNepaliCalendarYears(tx);
      const fiscalYear = await getConfiguredNepaliFiscalYear(startDate, endDate, calendars);
      const record = await tx.fiscalYear.create({
        data: {
          name: name.trim(),
          startDate: fiscalYear.fiscalYearStart,
          endDate: fiscalYear.fiscalYearEnd,
          status: "OPEN",
        },
      });
      await tx.accountingPeriod.createMany({
        data: fiscalYear.periods.map((period) => ({
          ...period,
          fiscalYearId: record.id,
        })),
      });
      return { fiscalYear: record, periodCount: fiscalYear.periods.length };
    });

    res.json({
      success: true,
      message: `Fiscal Year created successfully with ${result.periodCount} BS accounting periods.`,
      fiscalYear: result.fiscalYear,
      periodCount: result.periodCount,
    });
  } catch (error) {
    console.error("Create Fiscal Year Error:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code });
  }
};

export const togglePeriodStatus = async (req, res) => {
  return res.status(409).json({
    success: false,
    message: "Direct accounting-period status changes are disabled. Use the independent close or reopen approval workflow.",
    code: "PERIOD_CLOSE_WORKFLOW_REQUIRED",
  });
};

const periodCloseActor = (req) => ({
  accountId: req.auth?.accountId,
  role: req.auth?.role,
  ipAddress: req.ip,
  userAgent: req.get?.("user-agent") || req.headers?.["user-agent"],
  correlationId: req.correlationId || null,
});

const periodCloseErrorResponse = (res, error, defaultMessage) => {
  console.error(defaultMessage, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || defaultMessage,
    ...(error.code ? { code: error.code } : {}),
  });
};

const requestIdempotencyKey = (req) => req.headers["idempotency-key"] || req.body?.idempotencyKey;

export const getPeriodCloseChecklist = async (_req, res) => {
  return res.json({ success: true, checklist: getAccountingPeriodCloseChecklist() });
};

export const getPeriodClosePackController = async (req, res) => {
  try {
    const result = await createAccountingPeriodClosePack({
      periodId: req.params?.periodId,
      actor: periodCloseActor(req),
    });
    return res.json(result);
  } catch (error) {
    return periodCloseErrorResponse(res, error, "Unable to generate accounting period close pack.");
  }
};

export const submitPeriodCloseController = async (req, res) => {
  try {
    const result = await submitAccountingPeriodClose({
      periodId: req.body?.periodId,
      checklist: req.body?.checklist,
      idempotencyKey: requestIdempotencyKey(req),
      actor: periodCloseActor(req),
    });
    return res.status(result.isReplay ? 200 : 201).json(result);
  } catch (error) {
    return periodCloseErrorResponse(res, error, "Unable to submit accounting period close.");
  }
};

export const reviewPeriodCloseController = async (req, res) => {
  try {
    const result = await reviewAccountingPeriodClose({
      periodId: req.body?.periodId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      idempotencyKey: requestIdempotencyKey(req),
      actor: periodCloseActor(req),
    });
    return res.json(result);
  } catch (error) {
    return periodCloseErrorResponse(res, error, "Unable to review accounting period close.");
  }
};

export const requestPeriodReopenController = async (req, res) => {
  try {
    const result = await requestAccountingPeriodReopen({
      periodId: req.body?.periodId,
      reason: req.body?.reason,
      idempotencyKey: requestIdempotencyKey(req),
      actor: periodCloseActor(req),
    });
    return res.status(result.isReplay ? 200 : 201).json(result);
  } catch (error) {
    return periodCloseErrorResponse(res, error, "Unable to request accounting period reopening.");
  }
};

export const reviewPeriodReopenController = async (req, res) => {
  try {
    const result = await reviewAccountingPeriodReopen({
      periodId: req.body?.periodId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      idempotencyKey: requestIdempotencyKey(req),
      actor: periodCloseActor(req),
    });
    return res.json(result);
  } catch (error) {
    return periodCloseErrorResponse(res, error, "Unable to review accounting period reopening.");
  }
};

export const closeFiscalYearController = async (req, res) => {
  try {
    const { fiscalYearId } = req.body;
    if (!fiscalYearId) {
      return res.status(400).json({ success: false, message: "fiscalYearId is required." });
    }
    const periods = await prisma.accountingPeriod.findMany({
      where: { fiscalYearId },
      select: {
        status: true,
        closeEvents: {
          orderBy: { sequence: "desc" },
          take: 1,
          select: { eventType: true },
        },
      },
    });
    if (!periods.length || periods.some((period) => period.status !== "CLOSED" || period.closeEvents[0]?.eventType !== "CLOSE_APPROVED")) {
      return res.status(409).json({
        success: false,
        message: "Every accounting period must be closed through its independent close approval before the fiscal year can be closed.",
        code: "PERIODS_NOT_APPROVED_FOR_FISCAL_CLOSE",
      });
    }
    const { closeFiscalYear } = await import("../services/fiscalClosingService.js");
    const result = await closeFiscalYear({
      fiscalYearId,
      closedBy: req.auth?.accountId || "ADMIN",
    });
    return res.json(result);
  } catch (error) {
    console.error("Close Fiscal Year Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reopenFiscalYearController = async (req, res) => {
  try {
    const { fiscalYearId, reason } = req.body;
    if (!fiscalYearId) {
      return res.status(400).json({ success: false, message: "fiscalYearId is required." });
    }
    if (!String(reason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "A reason is required to reopen a fiscal year.",
        code: "REOPEN_REASON_REQUIRED",
      });
    }
    const periods = await prisma.accountingPeriod.findMany({
      where: { fiscalYearId },
      select: {
        status: true,
        closeEvents: {
          orderBy: { sequence: "desc" },
          take: 1,
          select: { eventType: true },
        },
      },
    });
    if (!periods.length || periods.some((period) => period.status !== "OPEN" || period.closeEvents[0]?.eventType !== "REOPEN_APPROVED")) {
      return res.status(409).json({
        success: false,
        message: "Each closed accounting period must first be reopened through its independent approval workflow.",
        code: "PERIOD_REOPEN_APPROVAL_REQUIRED",
      });
    }
    const { reopenFiscalYear } = await import("../services/fiscalClosingService.js");
    const result = await reopenFiscalYear({
      fiscalYearId,
      reopenedBy: req.auth?.accountId || "ADMIN",
      reason: String(reason).trim(),
    });
    return res.json(result);
  } catch (error) {
    console.error("Reopen Fiscal Year Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
