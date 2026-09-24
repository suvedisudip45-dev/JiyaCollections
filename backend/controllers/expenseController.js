import { prisma } from "../config/db.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { postExpenseAccounting } from "../services/accountingPostingEngine.js";

// Helper: Calculate 13% embedded VAT amount
const calculateVat = (amount, isVatBill, customVat) => {
  if (!isVatBill) return 0;
  if (customVat !== undefined && customVat !== null && customVat !== "") {
    return Math.max(0, Number(customVat));
  }
  const amt = Number(amount) || 0;
  // 13% Nepal VAT embedded: amount - (amount / 1.13)
  return Number((amt - amt / 1.13).toFixed(2));
};

// CREATE Expense
export const createExpense = async (req, res) => {
  try {
    const {
      title,
      category,
      amount,
      isVatBill,
      vatAmount,
      date,
      paymentMethod,
      vendorName,
      invoiceNumber,
      notes,
    } = req.body;

    if (!title || !category || amount === undefined || amount === null || amount === "") {
      return res.json({ success: false, message: "Title, Category, and Amount are required." });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.json({ success: false, message: "Expense amount must be a positive number." });
    }

    const vatBill = isVatBill === true || isVatBill === "true";
    const computedVat = calculateVat(numAmount, vatBill, vatAmount);

    const expense = await prisma.operatingExpense.create({
      data: {
        title: title.trim(),
        category: (category || "MISCELLANEOUS").toUpperCase(),
        amount: numAmount,
        isVatBill: vatBill,
        vatAmount: computedVat,
        date: date ? new Date(date) : new Date(),
        paymentMethod: paymentMethod || "CASH",
        vendorName: vendorName ? vendorName.trim() : null,
        invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null,
        notes: notes ? notes.trim() : null,
        createdBy: "ADMIN",
      },
    });

    // Auto-post double-entry GL journal entry to General Ledger & Chart of Accounts
    await postExpenseAccounting({
      expenseId: expense.id,
      category: expense.category,
      title: expense.title,
      amount: expense.amount,
      paidFromAccountType: expense.paymentMethod === "CASH" ? "CASH" : "BANK",
      isPayable: expense.paymentMethod === "CREDIT",
      payeeName: expense.vendorName,
    });

    res.json({ success: true, message: "Expense recorded successfully!", expense });
  } catch (error) {
    console.error("createExpense error:", error);
    res.json({ success: false, message: error.message });
  }
};

// GET Expenses (with filters & search)
export const getExpenses = async (req, res) => {
  try {
    const { category, startDate, endDate, search } = req.query;
    const pagination = getPagination(req.query);

    const where = {};

    if (category && category !== "ALL") {
      where.category = category.toUpperCase();
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { title: { contains: term } },
        { vendorName: { contains: term } },
        { invoiceNumber: { contains: term } },
        { notes: { contains: term } },
      ];
    }

    const [expenses, total, aggregate] = await Promise.all([
      prisma.operatingExpense.findMany({
        where,
        orderBy: { date: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.operatingExpense.count({ where }),
      prisma.operatingExpense.aggregate({ where, _sum: { amount: true, vatAmount: true } }),
    ]);

    // Aggregate metrics for filtered view
    const totalAmount = Number(aggregate._sum.amount || 0);
    const totalVatClaimable = Number(aggregate._sum.vatAmount || 0);

    res.json({
      success: true,
      ...paginatedResponse("expenses", expenses, pagination, total),
      metrics: {
        totalAmount,
        totalVatClaimable,
      },
    });
  } catch (error) {
    console.error("getExpenses error:", error);
    res.json({ success: false, message: error.message });
  }
};

// UPDATE Expense
export const updateExpense = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: "Expense ID is required." });

    const existing = await prisma.operatingExpense.findUnique({ where: { id } });
    if (!existing) return res.json({ success: false, message: "Expense record not found." });

    const {
      title,
      category,
      amount,
      isVatBill,
      vatAmount,
      date,
      paymentMethod,
      vendorName,
      invoiceNumber,
      notes,
    } = req.body;

    const numAmount = amount !== undefined ? Math.max(0, Number(amount)) : existing.amount;
    const vatBill = isVatBill !== undefined ? (isVatBill === true || isVatBill === "true") : existing.isVatBill;
    const computedVat = calculateVat(numAmount, vatBill, vatAmount);

    const updated = await prisma.operatingExpense.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(category && { category: category.toUpperCase() }),
        amount: numAmount,
        isVatBill: vatBill,
        vatAmount: computedVat,
        ...(date && { date: new Date(date) }),
        ...(paymentMethod && { paymentMethod }),
        ...(vendorName !== undefined && { vendorName: vendorName ? vendorName.trim() : null }),
        ...(invoiceNumber !== undefined && { invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null }),
        ...(notes !== undefined && { notes: notes ? notes.trim() : null }),
      },
    });

    res.json({ success: true, message: "Expense updated successfully!", expense: updated });
  } catch (error) {
    console.error("updateExpense error:", error);
    res.json({ success: false, message: error.message });
  }
};

// DELETE Expense
export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: "Expense ID is required." });

    await prisma.operatingExpense.delete({ where: { id } });
    res.json({ success: true, message: "Expense record deleted successfully." });
  } catch (error) {
    console.error("deleteExpense error:", error);
    res.json({ success: false, message: error.message });
  }
};

// GET Expense Summary Breakdown
export const getExpenseSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const allExpenses = await prisma.operatingExpense.findMany({ where });

    const byCategory = {
      MARKETING: 0,
      RENT: 0,
      ELECTRICITY: 0,
      SALARIES: 0,
      UTILITIES: 0,
      MISCELLANEOUS: 0,
      MAINTENANCE: 0,
    };

    let grandTotal = 0;
    let totalVatClaimable = 0;

    for (const exp of allExpenses) {
      const cat = (exp.category || "MISCELLANEOUS").toUpperCase();
      byCategory[cat] = (byCategory[cat] || 0) + (exp.amount || 0);
      grandTotal += exp.amount || 0;
      totalVatClaimable += exp.vatAmount || 0;
    }

    res.json({
      success: true,
      grandTotal,
      totalVatClaimable,
      byCategory,
      count: allExpenses.length,
    });
  } catch (error) {
    console.error("getExpenseSummary error:", error);
    res.json({ success: false, message: error.message });
  }
};
