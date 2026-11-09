import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  postDirectIncomeAccounting,
  postExpenseAccounting,
} from "../services/accountingPostingEngine.js";
import { reviewOperatingExpenseInputVat } from "../services/purchaseVatService.js";
import { recordSystemAudit } from "../services/auditService.js";
import { validateTreasuryPayoutAccount } from "../services/treasuryAccountingService.js";
import {
  resolveCalendarDateFilterInput,
  resolveCalendarDateInput,
} from "../services/nepaliFiscalCalendar.js";

// Helper: Calculate 13% embedded VAT amount
const calculateVat = (amount, isVatBill, customVat, rate = 13) => {
  if (!isVatBill) return 0;
  if (customVat !== undefined && customVat !== null && customVat !== "") {
    const vat = new Prisma.Decimal(String(customVat));
    if (!vat.isFinite() || vat.isNegative()) throw new Error("VAT amount must be a non-negative decimal amount.");
    return Number(vat.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
  }
  const amt = new Prisma.Decimal(String(amount || 0));
  const vatRate = new Prisma.Decimal(String(rate || 0));
  if (vatRate.isZero() || vatRate.isNegative()) return 0;
  const vat = amt.minus(amt.dividedBy(new Prisma.Decimal(1).plus(vatRate.dividedBy(100))));
  return Number(vat.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
};

const normalizeNprAmount = (value, fieldName) => {
  let amountValue;
  try {
    amountValue = new Prisma.Decimal(String(value));
  } catch {
    throw Object.assign(new Error(`${fieldName} must be a valid decimal amount.`), { statusCode: 400 });
  }
  if (!amountValue.isFinite() || amountValue.isNegative()) {
    throw Object.assign(new Error(`${fieldName} must be a non-negative finite amount.`), { statusCode: 400 });
  }
  return Number(amountValue.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
};

const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
      purchaseVatRate,
      supplierVatNumber,
      invoiceEvidenceUrl,
      date,
      paymentMethod,
      paymentStatus = "PAID", // PAID or PAYABLE
      paymentAccountId,
      vendorName,
      invoiceNumber,
      dueDate,
      priority = "MEDIUM",
      notes,
      calendar,
    } = req.body;

    if (!title || !category || amount === undefined || amount === null || amount === "") {
      return res.json({ success: false, message: "Title, Category, and Amount are required." });
    }

    const numAmount = normalizeNprAmount(amount, "Expense amount");
    if (numAmount <= 0) {
      return res.json({ success: false, message: "Expense amount must be a positive number." });
    }

    const vatBill = isVatBill === true || isVatBill === "true";
    const vatRate = purchaseVatRate === undefined || purchaseVatRate === "" ? 13 : Number(purchaseVatRate);
    if (vatBill && (!Number.isFinite(vatRate) || vatRate <= 0 || vatRate > 100)) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_RATE", message: "Enter the VAT rate printed on the supplier invoice." });
    }
    let computedVat;
    try {
      computedVat = calculateVat(numAmount, vatBill, vatAmount, vatRate);
      if (computedVat > numAmount) throw new Error("VAT amount cannot exceed the total supplier invoice amount.");
    } catch (error) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_AMOUNT", message: error.message });
    }
    const supplierVatId = supplierVatNumber ? String(supplierVatNumber).trim() : "";
    const evidence = invoiceEvidenceUrl ? String(invoiceEvidenceUrl).trim() : "";
    if (supplierVatId && !/^\d{9}$/.test(supplierVatId)) {
      return res.status(400).json({ success: false, code: "INVALID_SUPPLIER_VAT_NUMBER", message: "Supplier VAT number must contain exactly 9 digits." });
    }
    if (evidence.length > 5000 || (evidence && !isHttpUrl(evidence))) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_EVIDENCE", message: "Supplier invoice evidence must be a valid HTTP or HTTPS URL no longer than 5,000 characters." });
    }
    const resolvedDate = date ? await resolveCalendarDateInput(date, calendar) : new Date();
    const resolvedDueDate = dueDate ? await resolveCalendarDateInput(dueDate, calendar) : null;
    const expenseDate = new Date(resolvedDate);
    if (Number.isNaN(expenseDate.getTime())) {
      return res.status(400).json({ success: false, code: "INVALID_EXPENSE_DATE", message: "Enter a valid expense and invoice date." });
    }
    const finalVendorName = (vendorName || title).trim();
    const purchaseVatData = {
      supplierVatNumber: supplierVatId || null,
      invoiceEvidenceUrl: evidence || null,
      purchaseTaxableAmount: vatBill ? Number((numAmount - computedVat).toFixed(2)) : null,
      purchaseVatRate: vatBill ? vatRate : null,
      purchaseVatStatus: vatBill ? "PENDING_REVIEW" : "NOT_CLAIMED",
    };

    if (!["PAID", "PAYABLE", "UNPAID"].includes(String(paymentStatus).toUpperCase())) {
      return res.status(400).json({ success: false, code: "INVALID_EXPENSE_PAYMENT_STATUS", message: "Select paid now or record the expense as payable." });
    }

    if (String(paymentStatus).toUpperCase() === "PAID" && !paymentAccountId) {
      return res.status(400).json({
        success: false,
        message: "Please select a mapped Bank, Cash, or Wallet Treasury account to disburse this payment from.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      let updatedAccount = null;
      let depositAccountCode = null;
      let payable = null;
      const isPaid = String(paymentStatus).toUpperCase() === "PAID";

      if (isPaid) {
        const treasuryAccount = await tx.financialAccount.findUnique({ where: { id: paymentAccountId } });
        depositAccountCode = (await validateTreasuryPayoutAccount(treasuryAccount, tx)).accountCode;
        const debitResult = await tx.financialAccount.updateMany({
          where: {
            id: paymentAccountId,
            status: "ACTIVE",
            currency: "NPR",
            currentBalance: { gte: numAmount },
          },
          data: { currentBalance: { decrement: numAmount } },
        });
        if (debitResult.count !== 1) {
          const current = await tx.financialAccount.findUnique({
            where: { id: paymentAccountId },
            select: { currentBalance: true, accountName: true },
          });
          const availableBalance = Number(current?.currentBalance || 0);
          const error = new Error(
            current
              ? `Insufficient funds in ${current.accountName}. Available Rs ${availableBalance.toLocaleString()}, required Rs ${numAmount.toLocaleString()}.`
              : "Selected Treasury account was not found.",
          );
          error.statusCode = current ? 409 : 404;
          error.code = current ? "INSUFFICIENT_TREASURY_FUNDS" : "TREASURY_ACCOUNT_NOT_FOUND";
          throw error;
        }
        updatedAccount = await tx.financialAccount.findUnique({ where: { id: paymentAccountId } });
      } else {
        payable = await tx.accountPayable.create({
          data: {
            title: title.trim(),
            payeeName: finalVendorName,
            category: "OPERATING_EXPENSE",
            referenceType: "EXPENSE",
            totalAmount: numAmount,
            paidAmount: 0,
            remainingBalance: numAmount,
            dueDate: resolvedDueDate ? new Date(resolvedDueDate) : null,
            invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
            priority: priority || "MEDIUM",
            status: "UNPAID",
            notes: notes ? notes.trim() : null,
          },
        });
      }

      const expense = await tx.operatingExpense.create({
        data: {
          title: title.trim(),
          category: category.toUpperCase(),
          amount: numAmount,
          isVatBill: vatBill,
          vatAmount: computedVat,
          ...purchaseVatData,
          date: expenseDate,
          paymentMethod: isPaid ? paymentMethod || "CASH" : "CREDIT",
          paymentStatus: isPaid ? "PAID" : "PAYABLE",
          financialAccountId: isPaid ? paymentAccountId : null,
          payableId: payable?.id || null,
          vendorName: finalVendorName,
          invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null,
          notes: notes ? notes.trim() : null,
          createdBy: "ADMIN",
        },
      });

      if (isPaid) {
        await tx.cashTransaction.create({
          data: {
            amount: numAmount,
            date: expenseDate,
            type: "OUTFLOW",
            fromAccountId: paymentAccountId,
            category: "EXPENSE",
            partyName: finalVendorName,
            invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
            referenceId: expense.id,
            description: `Expense: ${title.trim()} (${category.toUpperCase()}) to ${finalVendorName}`,
          },
        });
      }

      await postExpenseAccounting({
        expenseId: expense.id,
        category: expense.category,
        title: expense.title,
        amount: expense.amount,
        paidFromAccountCode: depositAccountCode,
        isPayable: !isPaid,
        payeeName: expense.vendorName,
        transactionDate: expense.date,
        client: tx,
        throwOnError: true,
      });

      return { expense, payable, account: updatedAccount };
    });

    if (result.account) {
      return res.json({
        success: true,
        message: `Expense of Rs ${numAmount.toLocaleString()} paid from ${result.account.accountName} successfully!`,
        expense: result.expense,
        account: result.account,
      });
    }
    return res.json({
      success: true,
      message: `Expense recorded as Accounts Payable liability (Pay Later) due on ${dueDate || "upcoming"}.`,
      expense: result.expense,
      payable: result.payable,
    });
  } catch (error) {
    console.error("createExpense error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "EXPENSE_ERROR",
      message: error.message || "Expense could not be recorded.",
    });
  }
};

// ==========================================
// 3. GET EXPENSES (WITH FILTERS & SEARCH)
// ==========================================
export const getExpenses = async (req, res) => {
  try {
    const { category, paymentStatus, startDate, endDate, search, calendar } = req.query;
    const pagination = getPagination(req.query);
    const dateRange = await resolveCalendarDateFilterInput(startDate, endDate, calendar);

    const where = {};

    if (category && category !== "ALL") {
      where.category = category.toUpperCase();
    }

    if (paymentStatus && paymentStatus !== "ALL") {
      where.paymentStatus = paymentStatus.toUpperCase();
    }

    if (startDate || endDate) {
      where.date = {};
      if (dateRange.startDate) where.date.gte = dateRange.startDate;
      if (dateRange.endDate) where.date.lte = dateRange.endDate;
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

    const [expenses, total, aggregate, verifiedVatAggregate, pendingVatAggregate] = await Promise.all([
      prisma.operatingExpense.findMany({
        where,
        orderBy: { date: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.operatingExpense.count({ where }),
      prisma.operatingExpense.aggregate({ where, _sum: { amount: true, vatAmount: true } }),
      prisma.operatingExpense.aggregate({
        where: { ...where, purchaseVatStatus: "VERIFIED" },
        _sum: { vatAmount: true },
      }),
      prisma.operatingExpense.aggregate({
        where: { ...where, purchaseVatStatus: "PENDING_REVIEW" },
        _sum: { vatAmount: true },
      }),
    ]);

    const totalAmount = Number(aggregate._sum.amount || 0);
    const totalVatClaimable = Number(verifiedVatAggregate._sum.vatAmount || 0);
    const totalVatPendingReview = Number(pendingVatAggregate._sum.vatAmount || 0);

    res.json({
      success: true,
      ...paginatedResponse("expenses", expenses, pagination, total),
      metrics: {
        totalAmount,
        totalVatClaimable,
        totalVatPendingReview,
      },
    });
  } catch (error) {
    console.error("getExpenses error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "EXPENSE_QUERY_ERROR",
      message: error.message || "Expenses could not be loaded.",
    });
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
      purchaseVatRate,
      supplierVatNumber,
      invoiceEvidenceUrl,
      date,
      paymentMethod,
      vendorName,
      invoiceNumber,
      notes,
      calendar,
    } = req.body;

    const numAmount = amount !== undefined ? normalizeNprAmount(amount, "Expense amount") : existing.amount;
    const resolvedDate = date ? await resolveCalendarDateInput(date, calendar) : null;
    const vatBill = isVatBill !== undefined ? isVatBill === true || isVatBill === "true" : existing.isVatBill;
    const vatRate = purchaseVatRate === undefined || purchaseVatRate === ""
      ? Number(existing.purchaseVatRate || 13)
      : Number(purchaseVatRate);
    if (vatBill && (!Number.isFinite(vatRate) || vatRate <= 0 || vatRate > 100)) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_RATE", message: "Enter the VAT rate printed on the supplier invoice." });
    }
    let computedVat;
    try {
      computedVat = calculateVat(numAmount, vatBill, vatAmount, vatRate);
      if (computedVat > numAmount) throw new Error("VAT amount cannot exceed the total supplier invoice amount.");
    } catch (error) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_AMOUNT", message: error.message });
    }
    if (existing.purchaseVatStatus === "VERIFIED") {
      const taxFieldsChanged =
        numAmount !== existing.amount ||
        vatBill !== existing.isVatBill ||
        computedVat !== existing.vatAmount ||
        (category !== undefined && String(category || "").trim().toUpperCase() !== existing.category) ||
        (date && new Date(date).getTime() !== existing.date.getTime()) ||
        (vendorName !== undefined && String(vendorName || "").trim() !== String(existing.vendorName || "")) ||
        (invoiceNumber !== undefined && String(invoiceNumber || "").trim() !== String(existing.invoiceNumber || "")) ||
        (supplierVatNumber !== undefined && String(supplierVatNumber || "").trim() !== String(existing.supplierVatNumber || "")) ||
        (invoiceEvidenceUrl !== undefined && String(invoiceEvidenceUrl || "").trim() !== String(existing.invoiceEvidenceUrl || "")) ||
        (purchaseVatRate !== undefined && Number(purchaseVatRate) !== Number(existing.purchaseVatRate));
      if (taxFieldsChanged) {
        return res.status(409).json({ success: false, code: "VERIFIED_PURCHASE_VAT_IMMUTABLE", message: "A verified supplier VAT record cannot be edited. Record a correction through an accountant-reviewed adjustment." });
      }
    }
    const supplierVatId = supplierVatNumber !== undefined
      ? String(supplierVatNumber || "").trim()
      : String(existing.supplierVatNumber || "");
    const evidence = invoiceEvidenceUrl !== undefined
      ? String(invoiceEvidenceUrl || "").trim()
      : String(existing.invoiceEvidenceUrl || "");
    if (supplierVatId && !/^\d{9}$/.test(supplierVatId)) {
      return res.status(400).json({ success: false, code: "INVALID_SUPPLIER_VAT_NUMBER", message: "Supplier VAT number must contain exactly 9 digits." });
    }
    if (evidence.length > 5000 || (evidence && !isHttpUrl(evidence))) {
      return res.status(400).json({ success: false, code: "INVALID_PURCHASE_VAT_EVIDENCE", message: "Supplier invoice evidence must be a valid HTTP or HTTPS URL no longer than 5,000 characters." });
    }
    const updated = await prisma.operatingExpense.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(category && { category: category.toUpperCase() }),
        amount: numAmount,
        isVatBill: vatBill,
        vatAmount: computedVat,
        supplierVatNumber: supplierVatId || null,
        invoiceEvidenceUrl: evidence || null,
        purchaseTaxableAmount: vatBill ? Number((numAmount - computedVat).toFixed(2)) : null,
        purchaseVatRate: vatBill ? vatRate : null,
        purchaseVatStatus: existing.purchaseVatStatus === "REJECTED" && vatBill
          ? "PENDING_REVIEW"
          : vatBill ? existing.purchaseVatStatus === "NOT_CLAIMED" ? "PENDING_REVIEW" : existing.purchaseVatStatus : "NOT_CLAIMED",
        ...(existing.purchaseVatStatus === "REJECTED" ? {
          purchaseVatVerifiedAt: null,
          purchaseVatVerifiedBy: null,
          purchaseVatReviewReason: null,
          purchaseVatJournalEntryId: null,
        } : {}),
        ...(resolvedDate && { date: new Date(resolvedDate) }),
        ...(paymentMethod && { paymentMethod }),
        ...(vendorName !== undefined && { vendorName: vendorName ? vendorName.trim() : null }),
        ...(invoiceNumber !== undefined && { invoiceNumber: invoiceNumber ? invoiceNumber.trim() : null }),
        ...(notes !== undefined && { notes: notes ? notes.trim() : null }),
      },
    });

    res.json({ success: true, message: "Expense updated successfully!", expense: updated });
  } catch (error) {
    console.error("updateExpense error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "EXPENSE_ERROR",
      message: error.message || "Expense could not be updated.",
    });
  }
};

// DELETE Expense
export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: "Expense ID is required." });

    const expense = await prisma.operatingExpense.findUnique({ where: { id } });
    if (!expense) return res.status(404).json({ success: false, message: "Expense record not found." });
    if (expense.purchaseVatStatus === "VERIFIED") {
      return res.status(409).json({ success: false, code: "VERIFIED_PURCHASE_VAT_IMMUTABLE", message: "A verified supplier VAT record cannot be deleted; record an accountant-reviewed correction instead." });
    }
    await prisma.operatingExpense.delete({ where: { id } });
    res.json({ success: true, message: "Expense record deleted successfully." });
  } catch (error) {
    console.error("deleteExpense error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const reviewExpenseInputVat = async (req, res) => {
  try {
    const actorId = req.auth?.accountId || req.auth?.userId || null;
    const record = await reviewOperatingExpenseInputVat({
      expenseId: req.params.id,
      decision: req.body?.decision,
      reason: req.body?.reason,
      reviewedBy: actorId,
      afterReview: (before, after, tx) => recordSystemAudit(
        { actorId, actorRole: "ADMIN", portalSource: "ADMIN" },
        {
          action: after.purchaseVatStatus === "VERIFIED"
            ? "PURCHASE_INPUT_VAT_VERIFIED"
            : "PURCHASE_INPUT_VAT_REJECTED",
          entityType: "OperatingExpense",
          entityId: after.id,
          beforeState: { purchaseVatStatus: before.purchaseVatStatus },
          afterState: {
            purchaseVatStatus: after.purchaseVatStatus,
            supplierVatNumber: after.supplierVatNumber,
            invoiceNumber: after.invoiceNumber,
            vatAmount: after.vatAmount,
            purchaseVatJournalEntryId: after.purchaseVatJournalEntryId,
            reason: after.purchaseVatReviewReason,
          },
        },
        { client: tx },
      ),
    });
    return res.status(200).json({ success: true, message: `Supplier input VAT ${record.purchaseVatStatus.toLowerCase()}.`, expense: record });
  } catch (error) {
    console.error("reviewExpenseInputVat error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "PURCHASE_VAT_REVIEW_ERROR",
      message: error.message || "Failed to review supplier input VAT.",
    });
  }
};

// GET Expense Summary Breakdown
export const getExpenseSummary = async (req, res) => {
  try {
    const { startDate, endDate, calendar } = req.query;
    const dateRange = await resolveCalendarDateFilterInput(startDate, endDate, calendar);

    const where = {};
    if (startDate || endDate) {
      where.date = {};
      if (dateRange.startDate) where.date.gte = dateRange.startDate;
      if (dateRange.endDate) where.date.lte = dateRange.endDate;
    }

    const allExpenses = await prisma.operatingExpense.findMany({ where });
    const pendingVatReview = allExpenses
      .filter((expense) => expense.purchaseVatStatus === "PENDING_REVIEW")
      .reduce((total, expense) => total + Number(expense.vatAmount || 0), 0);

    const byCategory = {};
    let grandTotal = 0;
    let totalVatClaimable = 0;
    let totalPaid = 0;
    let totalPayable = 0;

    for (const exp of allExpenses) {
      const cat = (exp.category || "MISCELLANEOUS").toUpperCase();
      byCategory[cat] = (byCategory[cat] || 0) + (exp.amount || 0);
      grandTotal += exp.amount || 0;
      if (exp.purchaseVatStatus === "VERIFIED") {
        totalVatClaimable += exp.vatAmount || 0;
      }
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
      pendingVatReview,
      byCategory,
      count: allExpenses.length,
    });
  } catch (error) {
    console.error("getExpenseSummary error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "EXPENSE_QUERY_ERROR",
      message: error.message || "Expense summary could not be loaded.",
    });
  }
};

// ==========================================
// 4. DIRECT & MISCELLANEOUS INCOME GATEWAY
// ==========================================
export const createDirectIncome = async (req, res) => {
  try {
    const { title, category, amount, toAccountId, payerName, invoiceNumber, date, notes, calendar } = req.body;

    const incomeTitle = typeof title === "string" ? title.trim() : "";
    const incomeCategory = String(category || "OTHER").trim().toUpperCase();
    if (!incomeTitle || amount === undefined || amount === null || amount === "" || !toAccountId) {
      return res.status(400).json({ success: false, message: "Title, Amount, and Deposit Account are required." });
    }

    const numAmount = normalizeNprAmount(amount, "Income amount");
    if (numAmount <= 0) {
      return res.status(400).json({ success: false, message: "Income amount must be a positive number." });
    }
    if (incomeCategory !== "OTHER") {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_MANUAL_INCOME_CATEGORY",
        message: "This form is only for Other Income confirmed by finance as not requiring output VAT. Record sales, scrap disposals, and VAT-bearing services through their tax-aware accounting workflows.",
      });
    }

    const resolvedDate = date ? await resolveCalendarDateInput(date, calendar) : new Date();
    const incomeDate = new Date(resolvedDate);
    if (Number.isNaN(incomeDate.getTime())) {
      return res.status(400).json({ success: false, code: "INVALID_INCOME_DATE", message: "Enter a valid income date." });
    }
    const finalPayerName = typeof payerName === "string" && payerName.trim()
      ? payerName.trim()
      : "Other income source";
    const finalInvoiceNumber = typeof invoiceNumber === "string" ? invoiceNumber.trim() : "";
    const finalNotes = typeof notes === "string" ? notes.trim() : "";

    const result = await prisma.$transaction(async (tx) => {
      const treasuryAccount = await tx.financialAccount.findUnique({ where: { id: toAccountId } });
      const depositAccount = await validateTreasuryPayoutAccount(treasuryAccount, tx);
      const updatedAccount = await tx.financialAccount.update({
        where: { id: toAccountId },
        data: { currentBalance: { increment: numAmount } },
      });
      const income = await tx.directIncome.create({
        data: {
          title: incomeTitle,
          category: incomeCategory,
          amount: numAmount,
          toAccountId,
          payerName: finalPayerName,
          invoiceNumber: finalInvoiceNumber || null,
          date: incomeDate,
          notes: finalNotes || null,
          createdBy: "ADMIN",
        },
      });
      await tx.cashTransaction.create({
        data: {
          amount: numAmount,
          date: incomeDate,
          type: "INFLOW",
          toAccountId,
          category: "MISC_INFLOW",
          partyName: finalPayerName,
          invoiceNumber: finalInvoiceNumber,
          referenceId: income.id,
          description: `Other Income: ${incomeTitle} from ${finalPayerName}`,
        },
      });
      await postDirectIncomeAccounting({
        incomeId: income.id,
        category: income.category,
        title: income.title,
        amount: income.amount,
        depositAccountCode: depositAccount.accountCode,
        payerName: finalPayerName,
        invoiceNumber: finalInvoiceNumber,
        transactionDate: incomeDate,
        client: tx,
      });
      return { income, account: updatedAccount };
    });

    return res.json({
      success: true,
      message: `Other income of Rs ${numAmount.toLocaleString()} deposited into ${result.account.accountName} successfully!`,
      income: result.income,
      account: result.account,
    });
  } catch (error) {
    console.error("createDirectIncome error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "INCOME_ERROR",
      message: error.message || "Income could not be recorded.",
    });
  }
};

export const getDirectIncomes = async (req, res) => {
  try {
    const { category, startDate, endDate, search, calendar } = req.query;
    const pagination = getPagination(req.query);
    const dateRange = await resolveCalendarDateFilterInput(startDate, endDate, calendar);

    const where = {};

    if (category && category !== "ALL") {
      where.category = category.toUpperCase();
    }

    if (startDate || endDate) {
      where.date = {};
      if (dateRange.startDate) where.date.gte = dateRange.startDate;
      if (dateRange.endDate) where.date.lte = dateRange.endDate;
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
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "INCOME_QUERY_ERROR",
      message: error.message || "Income records could not be loaded.",
    });
  }
};
