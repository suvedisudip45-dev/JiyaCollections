import { prisma } from "../config/db.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { postExpenseAccounting, postCustomerPaymentAccounting } from "../services/accountingPostingEngine.js";
import { checkAccountSolvency } from "./financialController.js";

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

// STANDARD BASE CATEGORIES
export const STANDARD_EXPENSE_CATEGORIES = [
  { code: "PRINTING", name: "Printing & Packaging", color: "#3b82f6" },
  { code: "SALARIES", name: "Staff Salaries & Wages", color: "#10b981" },
  { code: "RENT", name: "Office & Hub Rent", color: "#8b5cf6" },
  { code: "MARKETING", name: "Marketing & Advertising", color: "#f59e0b" },
  { code: "ELECTRICITY", name: "Electricity & Power", color: "#ec4899" },
  { code: "UTILITIES", name: "Internet & Water", color: "#06b6d4" },
  { code: "MAINTENANCE", name: "Repairs & Maintenance", color: "#64748b" },
  { code: "MISCELLANEOUS", name: "Miscellaneous Overhead", color: "#6b7280" },
];

export const STANDARD_INCOME_CATEGORIES = [
  { code: "DIRECT_SALES", name: "Direct Storefront Sales", color: "#10b981" },
  { code: "SCRAP_SALES", name: "Scrap & Fabric Waste Sales", color: "#06b6d4" },
  { code: "CUSTOM_WORK", name: "Custom Stitching / Designing", color: "#8b5cf6" },
  { code: "PRINTING_SERVICE", name: "Printing & Merch Services", color: "#3b82f6" },
  { code: "COMMISSION", name: "Affiliate & Partner Commission", color: "#f59e0b" },
  { code: "OTHER", name: "Other Direct Incomes", color: "#6b7280" },
];

// ==========================================
// 1. DYNAMIC CATEGORIES MANAGEMENT
// ==========================================
export const getFinancialCategories = async (req, res) => {
  try {
    const { type } = req.query; // EXPENSE or INCOME
    const where = { isActive: true };
    if (type) where.type = type.toUpperCase();

    const customCategories = await prisma.financialCategory.findMany({
      where,
      orderBy: { name: "asc" },
    });

    const expenseCategories = [
      ...STANDARD_EXPENSE_CATEGORIES,
      ...customCategories.filter((c) => c.type === "EXPENSE"),
    ];

    const incomeCategories = [
      ...STANDARD_INCOME_CATEGORIES,
      ...customCategories.filter((c) => c.type === "INCOME"),
    ];

    res.json({
      success: true,
      categories: {
        expense: expenseCategories,
        income: incomeCategories,
        custom: customCategories,
      },
    });
  } catch (error) {
    console.error("getFinancialCategories error:", error);
    res.json({
      success: true,
      categories: {
        expense: STANDARD_EXPENSE_CATEGORIES,
        income: STANDARD_INCOME_CATEGORIES,
        custom: [],
      },
    });
  }
};

export const createFinancialCategory = async (req, res) => {
  try {
    const { name, type, description, color } = req.body;
    if (!name || !type) {
      return res.json({ success: false, message: "Category name and type (EXPENSE/INCOME) are required" });
    }

    const code = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");

    const category = await prisma.financialCategory.upsert({
      where: { code },
      update: {
        name: name.trim(),
        type: type.toUpperCase(),
        description: description?.trim() || null,
        color: color || "#6366f1",
        isActive: true,
      },
      create: {
        name: name.trim(),
        code,
        type: type.toUpperCase(),
        description: description?.trim() || null,
        color: color || "#6366f1",
        isActive: true,
      },
    });

    res.json({ success: true, message: "Financial category saved successfully", category });
  } catch (error) {
    console.error("createFinancialCategory error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const deleteFinancialCategory = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: "Category ID is required" });

    await prisma.financialCategory.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, message: "Category deactivated successfully" });
  } catch (error) {
    console.error("deleteFinancialCategory error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. CREATE EXPENSE (WITH SOLVENCY & AUTO-PAYABLE)
// ==========================================
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
      paymentStatus = "PAID", // PAID or PAYABLE
      paymentAccountId,
      vendorName,
      invoiceNumber,
      dueDate,
      priority = "MEDIUM",
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
    const expenseDate = date ? new Date(date) : new Date();
    const finalVendorName = (vendorName || title).trim();

    // CASE A: PAID NOW (requires sufficient funds in selected Treasury account)
    if (paymentStatus === "PAID") {
      if (!paymentAccountId) {
        return res.json({
          success: false,
          message: "Please select a Bank or Cash-in-hand account to disburse this payment from.",
        });
      }

      // STRICT SOLVENCY CHECK
      const solvency = await checkAccountSolvency(paymentAccountId, numAmount, `Expense: ${title}`);
      if (!solvency.allowed) {
        return res.json({
          success: false,
          insufficientFunds: true,
          availableBalance: solvency.currentBalance,
          shortfall: solvency.shortfall,
          message: solvency.error,
        });
      }

      const [updatedAccount, cashTx, expense] = await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: paymentAccountId },
          data: { currentBalance: { decrement: numAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: numAmount,
            type: "OUTFLOW",
            fromAccountId: paymentAccountId,
            category: "EXPENSE",
            partyName: finalVendorName,
            invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
            description: `Expense: ${title.trim()} (${category.toUpperCase()}) to ${finalVendorName}`,
          },
        }),
        prisma.operatingExpense.create({
          data: {
            title: title.trim(),
            category: category.toUpperCase(),
            amount: numAmount,
            isVatBill: vatBill,
            vatAmount: computedVat,
            date: expenseDate,
            paymentMethod: paymentMethod || "CASH",
            paymentStatus: "PAID",
            financialAccountId: paymentAccountId,
            vendorName: finalVendorName,
            invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null,
            notes: notes ? notes.trim() : null,
            createdBy: "ADMIN",
          },
        }),
      ]);

      // Post to Double-Entry General Ledger
      postExpenseAccounting({
        expenseId: expense.id,
        category: expense.category,
        title: expense.title,
        amount: expense.amount,
        paidFromAccountType: updatedAccount.accountType === "CASH" ? "CASH" : "BANK",
        isPayable: false,
        payeeName: expense.vendorName,
      }).catch((glErr) => {
        console.error("General Ledger expense posting error:", glErr);
      });

      return res.json({
        success: true,
        message: `Expense of Rs ${numAmount.toLocaleString()} paid from ${updatedAccount.accountName} successfully!`,
        expense,
        account: updatedAccount,
      });
    }

    // CASE B: PAY LATER (Record as Accounts Payable Liability)
    if (paymentStatus === "PAYABLE" || paymentStatus === "UNPAID") {
      const payable = await prisma.accountPayable.create({
        data: {
          title: title.trim(),
          payeeName: finalVendorName,
          category: "OPERATING_EXPENSE",
          referenceType: "EXPENSE",
          totalAmount: numAmount,
          paidAmount: 0,
          remainingBalance: numAmount,
          dueDate: dueDate ? new Date(dueDate) : null,
          invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
          priority: priority || "MEDIUM",
          status: "UNPAID",
          notes: notes ? notes.trim() : null,
        },
      });

      const expense = await prisma.operatingExpense.create({
        data: {
          title: title.trim(),
          category: category.toUpperCase(),
          amount: numAmount,
          isVatBill: vatBill,
          vatAmount: computedVat,
          date: expenseDate,
          paymentMethod: "CREDIT",
          paymentStatus: "PAYABLE",
          payableId: payable.id,
          vendorName: finalVendorName,
          invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null,
          notes: notes ? notes.trim() : null,
          createdBy: "ADMIN",
        },
      });

      // Post Accrued Expense to GL (DR Operating Expense, CR Accounts Payable)
      postExpenseAccounting({
        expenseId: expense.id,
        category: expense.category,
        title: expense.title,
        amount: expense.amount,
        paidFromAccountType: "BANK",
        isPayable: true,
        payeeName: expense.vendorName,
      }).catch((glErr) => {
        console.error("General Ledger accrued expense posting error:", glErr);
      });

      return res.json({
        success: true,
        message: `Expense recorded as Accounts Payable liability (Pay Later) due on ${dueDate || "upcoming"}.`,
        expense,
        payable,
      });
    }

    res.json({ success: false, message: "Invalid payment status specified" });
  } catch (error) {
    console.error("createExpense error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. GET EXPENSES (WITH FILTERS & SEARCH)
// ==========================================
export const getExpenses = async (req, res) => {
  try {
    const { category, paymentStatus, startDate, endDate, search } = req.query;
    const pagination = getPagination(req.query);

    const where = {};

    if (category && category !== "ALL") {
      where.category = category.toUpperCase();
    }

    if (paymentStatus && paymentStatus !== "ALL") {
      where.paymentStatus = paymentStatus.toUpperCase();
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
    const vatBill = isVatBill !== undefined ? isVatBill === true || isVatBill === "true" : existing.isVatBill;
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

    const byCategory = {};
    let grandTotal = 0;
    let totalVatClaimable = 0;
    let totalPaid = 0;
    let totalPayable = 0;

    for (const exp of allExpenses) {
      const cat = (exp.category || "MISCELLANEOUS").toUpperCase();
      byCategory[cat] = (byCategory[cat] || 0) + (exp.amount || 0);
      grandTotal += exp.amount || 0;
      totalVatClaimable += exp.vatAmount || 0;
      if (exp.paymentStatus === "PAYABLE") {
        totalPayable += exp.amount || 0;
      } else {
        totalPaid += exp.amount || 0;
      }
    }

    res.json({
      success: true,
      grandTotal,
      totalPaid,
      totalPayable,
      totalVatClaimable,
      byCategory,
      count: allExpenses.length,
    });
  } catch (error) {
    console.error("getExpenseSummary error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. DIRECT & MISCELLANEOUS INCOME GATEWAY
// ==========================================
export const createDirectIncome = async (req, res) => {
  try {
    const { title, category, amount, toAccountId, payerName, invoiceNumber, date, notes } = req.body;

    if (!title || !amount || !toAccountId) {
      return res.json({ success: false, message: "Title, Amount, and Deposit Account are required." });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.json({ success: false, message: "Income amount must be a positive number." });
    }

    const toAccount = await prisma.financialAccount.findUnique({ where: { id: toAccountId } });
    if (!toAccount) {
      return res.json({ success: false, message: "Selected deposit account not found." });
    }

    const incomeDate = date ? new Date(date) : new Date();
    const finalPayerName = (payerName || "Customer / Buyer").trim();
    const incomeCategory = (category || "DIRECT_SALES").toUpperCase();

    const [updatedAccount, cashTx, income] = await prisma.$transaction([
      prisma.financialAccount.update({
        where: { id: toAccountId },
        data: { currentBalance: { increment: numAmount } },
      }),
      prisma.cashTransaction.create({
        data: {
          amount: numAmount,
          type: "INFLOW",
          toAccountId,
          category: "SALES",
          partyName: finalPayerName,
          invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
          description: `Direct Income: ${title.trim()} (${incomeCategory}) from ${finalPayerName}`,
        },
      }),
      prisma.directIncome.create({
        data: {
          title: title.trim(),
          category: incomeCategory,
          amount: numAmount,
          toAccountId,
          payerName: finalPayerName,
          invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null,
          date: incomeDate,
          notes: notes ? notes.trim() : null,
          createdBy: "ADMIN",
        },
      }),
    ]);

    // Post to Double-Entry General Ledger (DR Bank/Cash, CR Sales/Other Income)
    postCustomerPaymentAccounting({
      id: income.id,
      orderId: `INC-${income.id.slice(-6)}`,
      customerName: finalPayerName,
      amount: numAmount,
      depositAccountType: updatedAccount.accountType === "CASH" ? "CASH" : "BANK",
      referenceNumber: invoiceNumber || `INC-${Date.now()}`,
    }).catch((glErr) => {
      console.error("General Ledger direct income posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Income of Rs ${numAmount.toLocaleString()} deposited into ${updatedAccount.accountName} successfully!`,
      income,
      account: updatedAccount,
    });
  } catch (error) {
    console.error("createDirectIncome error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getDirectIncomes = async (req, res) => {
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
        { payerName: { contains: term } },
        { invoiceNumber: { contains: term } },
        { notes: { contains: term } },
      ];
    }

    const [incomes, total, aggregate] = await Promise.all([
      prisma.directIncome.findMany({
        where,
        orderBy: { date: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.directIncome.count({ where }),
      prisma.directIncome.aggregate({ where, _sum: { amount: true } }),
    ]);

    const totalAmount = Number(aggregate._sum.amount || 0);

    res.json({
      success: true,
      ...paginatedResponse("incomes", incomes, pagination, total),
      metrics: { totalAmount },
    });
  } catch (error) {
    console.error("getDirectIncomes error:", error);
    res.json({ success: false, message: error.message });
  }
};
