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
import adminAuth from "../middleware/adminAuth.js";
import manufacturerAuth from "../middleware/manufacturerAuth.js";

const financialRouter = express.Router();

const authorizeManufacturerOrAdmin = (req, res, next) => {
  const token = req.headers.token || req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = decoded.role;
    if (role === "admin" || role === "manufacturer") {
      req.manufacturerId = decoded.manufacturerId || req.query?.manufacturerId || req.body?.manufacturerId;
      return next();
    }
    return res.status(403).json({ success: false, message: "Access denied." });
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || "Invalid token." });
  }
};

// Executive Analytics & Overview
financialRouter.get("/dashboard", adminAuth, getFinancialAnalyticsDashboard);
financialRouter.get("/manufacturer-summary", authorizeManufacturerOrAdmin, getManufacturerFinancialSummary);

// Treasury & Liquid Cash & Expenses
financialRouter.get("/treasury-accounts", adminAuth, getTreasuryAccounts);
financialRouter.post("/create-account", adminAuth, createTreasuryAccount);
financialRouter.post("/cash-transfer", adminAuth, recordCashTransfer);
financialRouter.post("/record-operating-expense", adminAuth, recordOperatingExpense);
financialRouter.get("/cash-transactions", adminAuth, getCashTransactions);

// Fixed Assets & Depreciation
financialRouter.get("/fixed-assets", adminAuth, getFixedAssets);
financialRouter.post("/create-asset", adminAuth, createFixedAsset);
financialRouter.post("/run-depreciation", adminAuth, runDepreciationBatch);
financialRouter.post("/damage-asset", adminAuth, recordAssetDamageOrDisposal);

// Cap Table, Shares, Company Valuation & Profit Distribution
financialRouter.get("/cap-table-valuation", adminAuth, getCapTableAndValuation);
financialRouter.get("/partnership-overview", adminAuth, getPartnershipOverview);
financialRouter.post("/save-partner", adminAuth, savePartner);
financialRouter.post("/issue-new-shares", adminAuth, issueNewShares);
financialRouter.post("/transfer-share", adminAuth, transferOrSellShare);
financialRouter.post("/update-valuation", adminAuth, updateCompanyValuation);
financialRouter.post("/profit-distribution", adminAuth, calculateAndExecuteProfitDistribution);

// Advanced Debt, Loans & Liabilities
financialRouter.get("/liabilities", adminAuth, getInvestorsAndLiabilities);
financialRouter.get("/loan-schedule/:id", adminAuth, getLoanSchedule);
financialRouter.post("/record-financing", adminAuth, recordInvestorFinancing);
financialRouter.post("/repay-liability", adminAuth, recordLiabilityRepayment);

// Accounts Payable & Receivable (Liabilities & Settlements)
financialRouter.get("/payables-receivables", adminAuth, getPayablesAndReceivables);
financialRouter.post("/create-payable", adminAuth, createPayable);
financialRouter.post("/create-receivable", adminAuth, createReceivable);
financialRouter.post("/settle-payable", adminAuth, settlePayable);
financialRouter.post("/collect-receivable", adminAuth, collectReceivable);

// Tax & VAT
financialRouter.get("/tax-report", adminAuth, getVATAndTaxReport);

// Financial Statements
financialRouter.get("/statements", adminAuth, getFinancialStatements);

export default financialRouter;
