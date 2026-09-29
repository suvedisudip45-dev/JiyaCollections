import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  getFinancialCategories,
  createFinancialCategory,
  deleteFinancialCategory,
  createDirectIncome,
  getDirectIncomes,
} from "../controllers/expenseController.js";

const expenseRouter = express.Router();

// Expenses
expenseRouter.post("/add", authenticate, authorize("expense:create"), createExpense);
expenseRouter.get("/list", authenticate, authorize("expense:read"), getExpenses);
expenseRouter.post("/update", authenticate, authorize("expense:update"), updateExpense);
expenseRouter.post("/delete", authenticate, authorize("expense:delete"), deleteExpense);
expenseRouter.get("/summary", authenticate, authorize("expense:summary_read"), getExpenseSummary);

// Financial Categories
expenseRouter.get("/categories", authenticate, authorize("expense:read"), getFinancialCategories);
expenseRouter.post("/categories/add", authenticate, authorize("expense:create"), createFinancialCategory);
expenseRouter.post("/categories/delete", authenticate, authorize("expense:delete"), deleteFinancialCategory);

// Direct & Miscellaneous Incomes
expenseRouter.post("/income/add", authenticate, authorize("finance:income_create"), createDirectIncome);
expenseRouter.get("/income/list", authenticate, authorize("finance:income_read"), getDirectIncomes);

export default expenseRouter;
