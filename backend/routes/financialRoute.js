import express from "express";
import {
  getFinancialAnalyticsDashboard,
  getTreasuryAccounts,
  createTreasuryAccount,
  recordCashTransfer,
  getCashTransactions,
  getFixedAssets,
  createFixedAsset,
  runDepreciationBatch,
  recordAssetDamageOrDisposal,
  getCapTableAndValuation,
  getPartnershipOverview,
  savePartner,
  issueNewShares,
  transferOrSellShare,
  updateCompanyValuation,
  calculateAndExecuteProfitDistribution,
  getInvestorsAndLiabilities,
  getLoanSchedule,
  recordInvestorFinancing,
  recordLiabilityRepayment,
  getPayablesAndReceivables,
  createPayable,
  createReceivable,
  settlePayable,
  collectReceivable,
  getVATAndTaxReport,
  recordOperatingExpense,
  getFinancialStatements,
  getManufacturerFinancialSummary,
} from "../controllers/financialController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const financialRouter = express.Router();

const setFinancialManufacturerContext = (req, res, next) => {
  if (req.auth.role === "ADMIN") {
    const manufacturerId = req.query?.manufacturerId || req.body?.manufacturerId;
    if (!manufacturerId) {
      return res.status(400).json({ success: false, message: "Manufacturer ID is required." });
    }
    req.manufacturerId = manufacturerId;
    return next();
  }

  const manufacturerId = req.auth.manufacturerId || req.auth.profileId;
  if (!manufacturerId) {
    return res.status(403).json({ success: false, message: "Manufacturer context unavailable." });
  }
  req.manufacturerId = manufacturerId;
  next();
};

// Executive Analytics & Overview
financialRouter.get("/dashboard", authenticate, authorize("finance:dashboard_read"), getFinancialAnalyticsDashboard);
financialRouter.get("/manufacturer-summary", authenticate, authorize("finance:manufacturer_summary"), setFinancialManufacturerContext, getManufacturerFinancialSummary);

// Treasury & Liquid Cash & Expenses
financialRouter.get("/treasury-accounts", authenticate, authorize("finance:treasury_read"), getTreasuryAccounts);
financialRouter.post("/create-account", authenticate, authorize("finance:treasury_create"), createTreasuryAccount);
financialRouter.post("/cash-transfer", authenticate, authorize("finance:cash_transfer"), recordCashTransfer);
financialRouter.post("/record-operating-expense", authenticate, authorize("finance:expense_record"), recordOperatingExpense);
financialRouter.get("/cash-transactions", authenticate, authorize("finance:transactions_read"), getCashTransactions);

// Fixed Assets & Depreciation
financialRouter.get("/fixed-assets", authenticate, authorize("finance:assets_read"), getFixedAssets);
financialRouter.post("/create-asset", authenticate, authorize("finance:asset_create"), createFixedAsset);
financialRouter.post("/run-depreciation", authenticate, authorize("finance:depreciation_run"), runDepreciationBatch);
financialRouter.post("/damage-asset", authenticate, authorize("finance:asset_damage"), recordAssetDamageOrDisposal);

// Cap Table, Shares, Company Valuation & Profit Distribution
financialRouter.get("/cap-table-valuation", authenticate, authorize("finance:captable_read"), getCapTableAndValuation);
financialRouter.get("/partnership-overview", authenticate, authorize("finance:partnership_read"), getPartnershipOverview);
financialRouter.post("/save-partner", authenticate, authorize("finance:partner_manage"), savePartner);
financialRouter.post("/issue-new-shares", authenticate, authorize("finance:shares_issue"), issueNewShares);
financialRouter.post("/transfer-share", authenticate, authorize("finance:shares_transfer"), transferOrSellShare);
financialRouter.post("/update-valuation", authenticate, authorize("finance:valuation_update"), updateCompanyValuation);
financialRouter.post("/profit-distribution", authenticate, authorize("finance:profit_distribute"), calculateAndExecuteProfitDistribution);

// Advanced Debt, Loans & Liabilities
financialRouter.get("/liabilities", authenticate, authorize("finance:liabilities_read"), getInvestorsAndLiabilities);
financialRouter.get("/loan-schedule/:id", authenticate, authorize("finance:loan_schedule_read"), getLoanSchedule);
financialRouter.post("/record-financing", authenticate, authorize("finance:financing_record"), recordInvestorFinancing);
financialRouter.post("/repay-liability", authenticate, authorize("finance:liability_repay"), recordLiabilityRepayment);

// Accounts Payable & Receivable (Liabilities & Settlements)
financialRouter.get("/payables-receivables", authenticate, authorize("finance:payables_read"), getPayablesAndReceivables);
financialRouter.post("/create-payable", authenticate, authorize("finance:payable_create"), createPayable);
financialRouter.post("/create-receivable", authenticate, authorize("finance:receivable_create"), createReceivable);
financialRouter.post("/settle-payable", authenticate, authorize("finance:payable_settle"), settlePayable);
financialRouter.post("/collect-receivable", authenticate, authorize("finance:receivable_collect"), collectReceivable);

// Tax & VAT
financialRouter.get("/tax-report", authenticate, authorize("finance:tax_report_read"), getVATAndTaxReport);

// Financial Statements
financialRouter.get("/statements", authenticate, authorize("finance:statements_read"), getFinancialStatements);

export default financialRouter;
