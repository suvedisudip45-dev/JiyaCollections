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
  getFiscalYearsAndPeriods,
  createFiscalYear,
  togglePeriodStatus,
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

// Reports Derived Directly from General Ledger
accountingRouter.get("/general-ledger", authenticate, authorize("accounting:ledger_read"), getGeneralLedgerReport);
accountingRouter.get("/general-ledger/:accountId", authenticate, authorize("accounting:ledger_read"), getGeneralLedgerReport);
accountingRouter.get("/trial-balance", authenticate, authorize("accounting:trial_balance_read"), getTrialBalanceReport);
accountingRouter.get("/financial-statements", authenticate, authorize("accounting:statements_read"), getRealtimeFinancialStatements);
accountingRouter.get("/subledger-reconciliation", authenticate, authorize("accounting:subledger_read"), getSubledgerReconciliation);

// Fiscal Years & Periods
accountingRouter.get("/fiscal-years", authenticate, authorize("accounting:fiscal_years_read"), getFiscalYearsAndPeriods);
accountingRouter.post("/create-fiscal-year", authenticate, authorize("accounting:fiscal_year_create"), createFiscalYear);
accountingRouter.post("/toggle-period", authenticate, authorize("accounting:period_toggle"), togglePeriodStatus);

export default accountingRouter;
