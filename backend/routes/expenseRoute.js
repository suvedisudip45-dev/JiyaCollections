import express from "express";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
} from "../controllers/expenseController.js";

const expenseRouter = express.Router();

expenseRouter.post("/add", authenticate, authorize("expense:create"), createExpense);
expenseRouter.get("/list", authenticate, authorize("expense:read"), getExpenses);
expenseRouter.post("/update", authenticate, authorize("expense:update"), updateExpense);
expenseRouter.post("/delete", authenticate, authorize("expense:delete"), deleteExpense);
expenseRouter.get("/summary", authenticate, authorize("expense:summary_read"), getExpenseSummary);

export default expenseRouter;
