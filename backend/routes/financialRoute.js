import express from "express";
import jwt from "jsonwebtoken";
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

const authorizeManufacturerOrAdmin = (req, res, next) => {
  const token = req.headers.token || req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = String(decoded.role || "").toUpperCase();
    if (role === "ADMIN" || role === "MANUFACTURER") {
      req.manufacturerId = decoded.manufacturerId || req.query?.manufacturerId || req.body?.manufacturerId;
      req.adminId = decoded.adminId || decoded.profileId;
      return next();
    }
    return res.status(403).json({ success: false, message: "Access denied." });
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || "Invalid token." });
  }
};

// Executive Analytics & Overview
financialRouter.get("/dashboard", authenticate, authorize("finance:dashboard_read"), getFinancialAnalyticsDashboard);
financialRouter.get("/manufacturer-summary", authorizeManufacturerOrAdmin, getManufacturerFinancialSummary);

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
