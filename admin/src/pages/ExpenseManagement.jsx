/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Plus,
  Search,
  Calendar,
  Receipt,
  Trash2,
  Edit2,
  RefreshCw,
  X,
  Tag,
  ShieldCheck,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Clock,
  Layers,
} from "lucide-react";
import { backendUrl } from "../App";
import Pagination from "../components/Pagination";

const ExpenseManagement = ({ token }) => {
  const [activeTab, setActiveTab] = useState("EXPENSES"); // EXPENSES | INCOMES | CATEGORIES
  const [expenses, setExpenses] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [categories, setCategories] = useState({ expense: [], income: [], custom: [] });
  const [treasuryAccounts, setTreasuryAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // Summary Metrics State
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalAmount: 0,
    totalPaid: 0,
    totalPayable: 0,
    totalVatClaimable: 0,
    byCategory: {},
  });

  // Expense Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Expense Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("PRINTING");
  const [amount, setAmount] = useState("");
  const [isVatBill, setIsVatBill] = useState(false);
  const [vatAmount, setVatAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentStatus, setPaymentStatus] = useState("PAID"); // PAID or PAYABLE
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [vendorName, setVendorName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [notes, setNotes] = useState("");

  // Income Modal State
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [incomeTitle, setIncomeTitle] = useState("");
  const [incomeCategory, setIncomeCategory] = useState("DIRECT_SALES");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeToAccountId, setIncomeToAccountId] = useState("");
  const [incomePayerName, setIncomePayerName] = useState("");
  const [incomeInvoiceNumber, setIncomeInvoiceNumber] = useState("");
  const [incomeDate, setIncomeDate] = useState(new Date().toISOString().split("T")[0]);
  const [incomeNotes, setIncomeNotes] = useState("");

  // Category Modal State
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState("EXPENSE");
  const [newCatColor, setNewCatColor] = useState("#6366f1");
  const [newCatDesc, setNewCatDesc] = useState("");

  // Solvency helper for selected account
  const selectedAccount = treasuryAccounts.find((a) => a.id === paymentAccountId);
  const numAmount = parseFloat(amount) || 0;
  const isInsufficient =
    paymentStatus === "PAID" &&
    selectedAccount &&
    numAmount > 0 &&
    Number(selectedAccount.currentBalance || 0) < numAmount;
  const shortfall = isInsufficient ? numAmount - Number(selectedAccount.currentBalance || 0) : 0;

  // 1. Fetch Categories & Treasury Accounts
  const fetchMetadata = useCallback(async () => {
    if (!token) return;
    try {
      const [catRes, accRes] = await Promise.all([
        axios.get(`${backendUrl}/api/expense/categories`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);
      if (catRes.data.success) {
        setCategories(catRes.data.categories || { expense: [], income: [], custom: [] });
      }
      if (accRes.data.success) {
        const accs = accRes.data.accounts || [];
        setTreasuryAccounts(accs);
        if (accs.length > 0 && !paymentAccountId) {
          setPaymentAccountId(accs[0].id);
          setIncomeToAccountId(accs[0].id);
        }
      }
    } catch {
      console.error("Failed to load metadata");
    }
  }, [token, paymentAccountId]);

  // 2. Fetch Expenses
  const fetchExpenses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = {};
      if (selectedCategory && selectedCategory !== "ALL") params.category = selectedCategory;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (searchTerm) params.search = searchTerm;
      params.page = page;
      params.limit = 10;

      const [res, summaryRes] = await Promise.all([
        axios.get(`${backendUrl}/api/expense/list`, {
          headers: { token },
          params,
        }),
        axios.get(`${backendUrl}/api/expense/summary`, {
          headers: { token },
          params: { startDate, endDate },
        }),
      ]);

      if (res.data.success) {
        setExpenses(res.data.expenses || []);
        setPagination(res.data.pagination || null);
      }
      if (summaryRes.data.success) {
        setSummaryMetrics({
          totalAmount: summaryRes.data.grandTotal || 0,
          totalPaid: summaryRes.data.totalPaid || 0,
          totalPayable: summaryRes.data.totalPayable || 0,
          totalVatClaimable: summaryRes.data.totalVatClaimable || 0,
          byCategory: summaryRes.data.byCategory || {},
        });
      }
    } catch {
      toast.error("Failed to load operating expenses.");
    } finally {
      setLoading(false);
    }
  }, [token, selectedCategory, startDate, endDate, searchTerm, page]);

  // 3. Fetch Incomes
  const fetchIncomes = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (searchTerm) params.search = searchTerm;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await axios.get(`${backendUrl}/api/expense/income/list`, {
        headers: { token },
        params,
      });

      if (res.data.success) {
        setIncomes(res.data.incomes || []);
      }
    } catch {
      toast.error("Failed to load direct incomes.");
    } finally {
      setLoading(false);
    }
  }, [token, page, searchTerm, startDate, endDate]);

  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  useEffect(() => {
    if (activeTab === "EXPENSES") fetchExpenses();
    else if (activeTab === "INCOMES") fetchIncomes();
    else setLoading(false);
  }, [activeTab, fetchExpenses, fetchIncomes]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  // Auto-compute VAT amount
  useEffect(() => {
    if (isVatBill && amount && !isNaN(parseFloat(amount))) {
      const numAmt = parseFloat(amount);
      const computedVat = (numAmt - numAmt / 1.13).toFixed(2);
      setVatAmount(computedVat);
    } else if (!isVatBill) {
      setVatAmount("0");
    }
  }, [amount, isVatBill]);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setTitle("");
    setCategory(categories.expense[0]?.code || "PRINTING");
    setAmount("");
    setIsVatBill(false);
    setVatAmount("");
    setDate(new Date().toISOString().split("T")[0]);
    setPaymentStatus("PAID");
    if (treasuryAccounts.length > 0) setPaymentAccountId(treasuryAccounts[0].id);
    setPaymentMethod("CASH");
    setVendorName("");
    setInvoiceNumber("");
    setDueDate("");
    setPriority("MEDIUM");
    setNotes("");
    setModalOpen(true);
  };

  const handleOpenEditModal = (exp) => {
    setEditingId(exp.id);
    setTitle(exp.title || "");
    setCategory(exp.category || "MISCELLANEOUS");
    setAmount(exp.amount?.toString() || "");
    setIsVatBill(exp.isVatBill ?? false);
    setVatAmount(exp.vatAmount?.toString() || "");
    setDate(exp.date ? new Date(exp.date).toISOString().split("T")[0] : "");
    setPaymentStatus(exp.paymentStatus || "PAID");
    setPaymentAccountId(exp.financialAccountId || (treasuryAccounts[0]?.id || ""));
    setPaymentMethod(exp.paymentMethod || "CASH");
    setVendorName(exp.vendorName || "");
    setInvoiceNumber(exp.invoiceNumber || "");
    setNotes(exp.notes || "");
    setModalOpen(true);
  };

  // Convert to Payable 1-Click Action
  const handleConvertToPayable = () => {
    setPaymentStatus("PAYABLE");
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    setDueDate(nextWeek.toISOString().split("T")[0]);
    toast.info("Switched payment method to Accounts Payable (Pay Later).");
  };

  // Submit Expense
  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    if (!title.trim() || !amount) {
      toast.error("Title and Amount are required.");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Expense amount must be a positive number.");
      return;
    }

    if (paymentStatus === "PAID" && isInsufficient) {
      toast.error(`Insufficient funds in ${selectedAccount?.accountName}. Please deposit funds or Convert to Payable.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        category,
        amount: parsedAmount,
        isVatBill,
        vatAmount: parseFloat(vatAmount) || 0,
        date,
        paymentStatus,
        paymentAccountId: paymentStatus === "PAID" ? paymentAccountId : null,
        paymentMethod: paymentStatus === "PAID" ? paymentMethod : "CREDIT",
        vendorName: vendorName.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        dueDate: paymentStatus === "PAYABLE" ? dueDate : undefined,
        priority: paymentStatus === "PAYABLE" ? priority : undefined,
        notes: notes.trim() || undefined,
      };

      const url = editingId ? `${backendUrl}/api/expense/update` : `${backendUrl}/api/expense/add`;
      const reqBody = editingId ? { id: editingId, ...payload } : payload;

      const res = await axios.post(url, reqBody, { headers: { token } });

      if (res.data.success) {
        toast.success(res.data.message || "Expense recorded successfully!");
        setModalOpen(false);
        fetchExpenses();
        fetchMetadata();
      } else if (res.data.insufficientFunds) {
        toast.error(res.data.message || "Insufficient funds in selected account!");
      } else {
        toast.error(res.data.message || "Failed to save expense.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error saving expense.");
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Direct Income
  const handleSubmitIncome = async (e) => {
    e.preventDefault();
    if (!incomeTitle.trim() || !incomeAmount || !incomeToAccountId) {
      toast.error("Title, Amount and Deposit Account are required.");
      return;
    }

    const parsedAmount = parseFloat(incomeAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Income amount must be positive.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/expense/income/add`,
        {
          title: incomeTitle.trim(),
          category: incomeCategory,
          amount: parsedAmount,
          toAccountId: incomeToAccountId,
          payerName: incomePayerName.trim() || undefined,
          invoiceNumber: incomeInvoiceNumber.trim() || undefined,
          date: incomeDate,
          notes: incomeNotes.trim() || undefined,
        },
        { headers: { token } }
      );

      if (res.data.success) {
        toast.success(res.data.message || "Income recorded successfully!");
        setIncomeModalOpen(false);
        setIncomeTitle("");
        setIncomeAmount("");
        fetchIncomes();
        fetchMetadata();
      } else {
        toast.error(res.data.message || "Failed to save income.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error saving income.");
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Category
  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return toast.error("Category name required");
    try {
      const res = await axios.post(
        `${backendUrl}/api/expense/categories/add`,
        {
          name: newCatName.trim(),
          type: newCatType,
          color: newCatColor,
          description: newCatDesc,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Category added successfully!");
        setCatModalOpen(false);
        setNewCatName("");
        setNewCatDesc("");
        fetchMetadata();
      } else {
        toast.error(res.data.message);
      }
    } catch {
      toast.error("Error creating category");
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return;
    try {
      const res = await axios.post(`${backendUrl}/api/expense/delete`, { id }, { headers: { token } });
      if (res.data.success) {
        toast.success("Expense deleted successfully!");
        fetchExpenses();
      } else {
        toast.error(res.data.message || "Failed to delete expense.");
      }
    } catch {
      toast.error("Error deleting expense.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200/60">
              Cash Flow &amp; Expenses
            </span>
            <span className="text-xs font-medium text-slate-400">Solvency Guardian Active</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-600" />
            Operating Incomes &amp; Expenses
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Log printing, staff salaries, rent, direct sales, and custom revenues with strict liquid bank solvency.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (activeTab === "EXPENSES") fetchExpenses();
              else fetchIncomes();
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setCatModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
          >
            <Tag className="w-3.5 h-3.5 text-slate-500" />
            + Manage Categories
          </button>
          <button
            onClick={() => setIncomeModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <ArrowDownRight className="w-4 h-4" />
            + Direct Income
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Expense
          </button>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("EXPENSES")}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 cursor-pointer transition-all ${
            activeTab === "EXPENSES"
              ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <ArrowUpRight className="w-4 h-4 text-red-500" />
          Operating Expenses ({expenses.length})
        </button>
        <button
          onClick={() => setActiveTab("INCOMES")}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 cursor-pointer transition-all ${
            activeTab === "INCOMES"
              ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <ArrowDownRight className="w-4 h-4 text-emerald-500" />
          Direct Incomes ({incomes.length})
        </button>
        <button
          onClick={() => setActiveTab("CATEGORIES")}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 cursor-pointer transition-all ${
            activeTab === "CATEGORIES"
              ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <Layers className="w-4 h-4 text-purple-500" />
          Taxonomy &amp; Categories
        </button>
      </div>

      {/* Summary KPI Cards */}
      {activeTab === "EXPENSES" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total Expenses
            </span>
            <p className="text-2xl font-black text-slate-900 mt-1">
              Rs {Number(summaryMetrics.totalAmount || 0).toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Paid: Rs {Number(summaryMetrics.totalPaid || 0).toLocaleString()} | Due: Rs {Number(summaryMetrics.totalPayable || 0).toLocaleString()}
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Printing &amp; Packaging
            </span>
            <p className="text-2xl font-black text-blue-700 mt-1">
              Rs {Number(summaryMetrics.byCategory?.PRINTING || 0).toLocaleString()}
            </p>
            <span className="text-[10px] text-blue-600 mt-1 block">Branded Tags, Bags &amp; Cartons</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Staff Salaries &amp; Wages
            </span>
            <p className="text-2xl font-black text-emerald-700 mt-1">
              Rs {Number(summaryMetrics.byCategory?.SALARIES || 0).toLocaleString()}
            </p>
            <span className="text-[10px] text-emerald-600 mt-1 block">Payroll &amp; Contract Labor</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Input VAT Claimable
            </span>
            <p className="text-2xl font-black text-purple-700 mt-1">
              Rs {Number(summaryMetrics.totalVatClaimable || 0).toLocaleString()}
            </p>
            <span className="text-[10px] text-purple-600 mt-1 block">13% Tax Credit from VAT Bills</span>
          </div>
        </div>
      )}

      {/* --- TAB 1: EXPENSES VIEW --- */}
      {activeTab === "EXPENSES" && (
        <>
          {/* Category Filter Pills & Search */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
              <button
                onClick={() => setSelectedCategory("ALL")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  selectedCategory === "ALL"
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All Categories
              </button>
              {categories.expense.map((cat) => (
                <button
                  key={cat.code}
                  onClick={() => setSelectedCategory(cat.code)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    selectedCategory === cat.code
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search title, vendor, invoice #..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
                {(startDate || endDate || searchTerm) && (
                  <button
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                      setSearchTerm("");
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 underline cursor-pointer whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400 text-xs">Loading expenses...</div>
            ) : expenses.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-sm font-bold text-slate-700">No Operating Expenses Found</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Click &quot;New Expense&quot; to record printing, staff salaries, office rent, or marketing costs.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="py-3 px-4">Date &amp; Title</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Payee &amp; Invoice</th>
                      <th className="py-3 px-4">Payment Status</th>
                      <th className="py-3 px-4 text-center">VAT Status</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {expenses.map((exp) => {
                      const dateStr = exp.date ? new Date(exp.date).toLocaleDateString() : "N/A";
                      const isPayable = exp.paymentStatus === "PAYABLE";

                      return (
                        <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <span className="font-bold text-slate-900 block text-xs">{exp.title}</span>
                            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{dateStr}</span>
                            {exp.notes && (
                              <span className="text-[10px] text-slate-500 italic block mt-0.5 max-w-xs truncate">
                                {exp.notes}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 align-top">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                              {exp.category}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 align-top">
                            <p className="font-semibold text-slate-800">{exp.vendorName || "General Payee"}</p>
                            {exp.invoiceNumber && (
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Ref: #{exp.invoiceNumber}
                              </p>
                            )}
                          </td>

                          <td className="py-3.5 px-4 align-top">
                            {isPayable ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <Clock className="w-3 h-3" />
                                Accounts Payable (Due)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Wallet className="w-3 h-3" />
                                Paid (Treasury Outflow)
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center align-top">
                            {exp.isVatBill ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                <ShieldCheck className="w-3 h-3" />
                                13% VAT (Rs {exp.vatAmount})
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Non-VAT</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right align-top">
                            <span className="font-bold text-slate-900 text-sm block">
                              Rs {Number(exp.amount || 0).toLocaleString()}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-right align-top">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenEditModal(exp)}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteExpense(exp.id)}
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 0}
              total={pagination?.total || 0}
              onPageChange={handlePageChange}
              loading={loading}
            />
          </div>
        </>
      )}

      {/* --- TAB 2: DIRECT INCOMES VIEW --- */}
      {activeTab === "INCOMES" && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Direct Incomes &amp; Other Revenues</h3>
              <p className="text-xs text-slate-400">Direct revenue entries deposited into Bank or Cash-in-hand accounts</p>
            </div>
            <button
              onClick={() => setIncomeModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
            >
              + Record Direct Income
            </button>
          </div>

          {incomes.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">No direct income entries recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">Date &amp; Title</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Payer / Customer</th>
                    <th className="py-3 px-4 text-right">Amount Deposited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {incomes.map((inc) => (
                    <tr key={inc.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 block">{inc.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(inc.date).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {inc.category}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-slate-800 font-semibold">{inc.payerName || "Customer"}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-black text-emerald-700 text-sm">
                        + Rs {Number(inc.amount || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3: CATEGORIES VIEW --- */}
      {activeTab === "CATEGORIES" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-red-500" />
              Expense Categories ({categories.expense.length})
            </h3>
            <div className="divide-y divide-slate-100">
              {categories.expense.map((cat) => (
                <div key={cat.code} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color || "#6366f1" }}></span>
                    <span className="font-bold text-slate-800">{cat.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({cat.code})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4 text-emerald-500" />
              Income Categories ({categories.income.length})
            </h3>
            <div className="divide-y divide-slate-100">
              {categories.income.map((cat) => (
                <div key={cat.code} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color || "#10b981" }}></span>
                    <span className="font-bold text-slate-800">{cat.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({cat.code})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 1: ADD / EDIT EXPENSE --- */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingId ? "Edit Expense" : "Record Operating Expense"}
                </h3>
                <p className="text-xs text-slate-500">
                  Track printing, staff salaries, rent, and overhead with live solvency protection.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Expense Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Branded Packaging Bags & Labels, Office Staff Salaries"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Category *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  >
                    {categories.expense.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Total Amount (Rs) *</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    placeholder="25000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>
              </div>

              {/* PAYMENT MODE SELECTOR */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <label className="block font-bold text-slate-800">Disbursement / Settlement Mode *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentStatus("PAID")}
                    className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                      paymentStatus === "PAID"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    💳 Pay Now (Liquid Cash/Bank)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentStatus("PAYABLE")}
                    className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                      paymentStatus === "PAYABLE"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    ⏳ Pay Later (Accounts Payable)
                  </button>
                </div>

                {/* IF PAID NOW: Show Account Selector & Solvency Status */}
                {paymentStatus === "PAID" && (
                  <div className="space-y-2 pt-2 border-t border-slate-200">
                    <label className="block font-bold text-slate-700">Deduct From Account *</label>
                    <select
                      value={paymentAccountId}
                      onChange={(e) => setPaymentAccountId(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-semibold text-slate-900 focus:outline-none focus:border-emerald-500"
                    >
                      {treasuryAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.accountName} ({acc.accountType}) — Available: Rs {Number(acc.currentBalance || 0).toLocaleString()}
                        </option>
                      ))}
                    </select>

                    {/* LIVE SOLVENCY WARNING WITH 1-CLICK CONVERSION */}
                    {isInsufficient && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2 text-red-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Insufficient Liquid Balance</p>
                            <p className="text-[11px] text-red-700">
                              <b>{selectedAccount?.accountName}</b> has only Rs {Number(selectedAccount?.currentBalance || 0).toLocaleString()} available (Shortfall: Rs {shortfall.toLocaleString()}).
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleConvertToPayable}
                          className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs shadow-xs cursor-pointer"
                        >
                          ⚡ Convert to Accounts Payable (Pay Later)
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* IF PAY LATER: Show Due Date & Priority */}
                {paymentStatus === "PAYABLE" && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Due Date</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Priority</label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-slate-900"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* VAT Bill Checkbox */}
              <div className="p-3 rounded-2xl bg-purple-50/60 border border-purple-200 space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-purple-900">
                  <input
                    type="checkbox"
                    checked={isVatBill}
                    onChange={(e) => setIsVatBill(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded cursor-pointer"
                  />
                  13% Tax Invoice (Input VAT Reclaimable)
                </label>
                {isVatBill && (
                  <div className="flex items-center justify-between text-purple-800 text-[11px] pt-1">
                    <span>Embedded 13% Tax Credit:</span>
                    <strong className="font-bold">Rs {vatAmount || "0.00"}</strong>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vendor / Payee Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Printing Press, Landlord, Employee"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Invoice / Ref #</label>
                  <input
                    type="text"
                    placeholder="e.g. PRT-9921"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows="2"
                  placeholder="Additional expense description..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (paymentStatus === "PAID" && isInsufficient)}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: RECORD DIRECT INCOME --- */}
      {incomeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Record Direct Income</h3>
                <p className="text-xs text-slate-500">Deposit incoming funds directly into Bank or Cash account.</p>
              </div>
              <button
                onClick={() => setIncomeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitIncome} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Income Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scrap Fabric Waste Sale, Printing Service Fee"
                  value={incomeTitle}
                  onChange={(e) => setIncomeTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Category *</label>
                  <select
                    value={incomeCategory}
                    onChange={(e) => setIncomeCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-900"
                  >
                    {categories.income.map((cat) => (
                      <option key={cat.code} value={cat.code}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Amount (Rs) *</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    placeholder="15000"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Deposit Into Account *</label>
                <select
                  value={incomeToAccountId}
                  onChange={(e) => setIncomeToAccountId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-900"
                >
                  {treasuryAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountName} ({acc.accountType}) — Balance: Rs {Number(acc.currentBalance || 0).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payer / Buyer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Recycling Vendor"
                    value={incomePayerName}
                    onChange={(e) => setIncomePayerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Receipt / Invoice #</label>
                  <input
                    type="text"
                    placeholder="e.g. REC-102"
                    value={incomeInvoiceNumber}
                    onChange={(e) => setIncomeInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows="2"
                  placeholder="Notes..."
                  value={incomeNotes}
                  onChange={(e) => setIncomeNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIncomeModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700"
                >
                  {submitting ? "Saving..." : "Deposit Income"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 3: CREATE CATEGORY --- */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Add Custom Category</h3>
              <button onClick={() => setCatModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Custom Merchandise, Dyeing & Washing"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Type *</label>
                  <select
                    value={newCatType}
                    onChange={(e) => setNewCatType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-900"
                  >
                    <option value="EXPENSE">Expense Category</option>
                    <option value="INCOME">Income Category</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Color Theme</label>
                  <input
                    type="color"
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                    className="w-full h-9 rounded-xl border border-slate-200 cursor-pointer p-1 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows="2"
                  placeholder="Optional notes..."
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCatModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800">
                  Save Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseManagement;
