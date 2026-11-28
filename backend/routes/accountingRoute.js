import express from "express";
import {
  getChartOfAccounts,
  createAccount,
  updateAccount,
  getJournalEntries,
  getJournalEntryById,
  createManualJournalEntry,
  reverseJournalEntry,
  getGeneralLedgerReport,
  getTrialBalanceReport,
  getRealtimeFinancialStatements,
  getSubledgerReconciliation,
  getCollaborationFeeCreditApplications,
  postCollaborationFeeCreditApplication,
  getFiscalYearsAndPeriods,
  createFiscalYear,
  togglePeriodStatus,
  closeFiscalYearController,
  reopenFiscalYearController,
  getPeriodCloseChecklist,
  getPeriodClosePackController,
  submitPeriodCloseController,
  reviewPeriodCloseController,
  requestPeriodReopenController,
  reviewPeriodReopenController,
  getAccountingActionApprovals,
  reviewAccountingActionApprovalController,
} from "../controllers/accountingController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const accountingRouter = express.Router();

// Chart of Accounts
accountingRouter.get("/chart-of-accounts", authenticate, authorize("accounting:coa_read"), getChartOfAccounts);
accountingRouter.post("/create-account", authenticate, authorize("accounting:coa_create"), createAccount);
accountingRouter.post("/update-account", authenticate, authorize("accounting:coa_update"), updateAccount);

// Journal Entries & Double-Entry Ledger
accountingRouter.get("/journal-entries", authenticate, authorize("accounting:journal_read"), getJournalEntries);
accountingRouter.get("/journal-entry/:id", authenticate, authorize("accounting:journal_read"), getJournalEntryById);
accountingRouter.post("/manual-journal", authenticate, authorize("accounting:journal_create"), createManualJournalEntry);
accountingRouter.post("/reverse-journal", authenticate, authorize("accounting:journal_reverse"), reverseJournalEntry);
accountingRouter.get("/approval-requests", authenticate, authorize("accounting:approval_read"), getAccountingActionApprovals);
accountingRouter.post("/approval-requests/review", authenticate, authorize("accounting:approval_review"), reviewAccountingActionApprovalController);

// Reports Derived Directly from General Ledger
accountingRouter.get("/general-ledger", authenticate, authorize("accounting:ledger_read"), getGeneralLedgerReport);
accountingRouter.get("/general-ledger/:accountId", authenticate, authorize("accounting:ledger_read"), getGeneralLedgerReport);
accountingRouter.get("/trial-balance", authenticate, authorize("accounting:trial_balance_read"), getTrialBalanceReport);
accountingRouter.get("/financial-statements", authenticate, authorize("accounting:statements_read"), getRealtimeFinancialStatements);
accountingRouter.get("/subledger-reconciliation", authenticate, authorize("accounting:subledger_read"), getSubledgerReconciliation);
accountingRouter.get("/collaboration-fee-credit-applications", authenticate, authorize("accounting:subledger_read"), getCollaborationFeeCreditApplications);
accountingRouter.post("/collaboration-fee-credit-applications", authenticate, authorize("finance:receivable_collect"), postCollaborationFeeCreditApplication);

// Fiscal Years & Periods
accountingRouter.get("/fiscal-years", authenticate, authorize("accounting:fiscal_years_read"), getFiscalYearsAndPeriods);
accountingRouter.post("/create-fiscal-year", authenticate, authorize("accounting:fiscal_year_create"), createFiscalYear);
accountingRouter.post("/toggle-period", authenticate, authorize("accounting:period_toggle"), togglePeriodStatus);
accountingRouter.get("/period-close-checklist", authenticate, authorize("accounting:fiscal_years_read"), getPeriodCloseChecklist);
accountingRouter.get("/period-close/:periodId/pack", authenticate, authorize("accounting:fiscal_years_read"), getPeriodClosePackController);
accountingRouter.post("/period-close/submit", authenticate, authorize("accounting:period_close_submit"), submitPeriodCloseController);
accountingRouter.post("/period-close/review", authenticate, authorize("accounting:period_close_review"), reviewPeriodCloseController);
accountingRouter.post("/period-close/reopen/request", authenticate, authorize("accounting:period_reopen_request"), requestPeriodReopenController);
accountingRouter.post("/period-close/reopen/review", authenticate, authorize("accounting:period_reopen_review"), reviewPeriodReopenController);
accountingRouter.post("/close-fiscal-year", authenticate, authorize("accounting:period_close_review"), closeFiscalYearController);
accountingRouter.post("/reopen-fiscal-year", authenticate, authorize("accounting:period_reopen_review"), reopenFiscalYearController);

export default accountingRouter;

