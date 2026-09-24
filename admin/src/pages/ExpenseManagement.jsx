/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Plus,
  Search,
  Filter,
  Calendar,
  Building,
  Zap,
  TrendingUp,
  Receipt,
  Trash2,
  Edit2,
  RefreshCw,
  X,
  Tag,
  ShieldCheck,
  Megaphone,
  Briefcase,
  Wrench,
} from "lucide-react";
import { backendUrl } from "../App";
import Pagination from "../components/Pagination";

const ExpenseManagement = ({ token }) => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // Summary Metrics State
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalAmount: 0,
    totalVatClaimable: 0,
    byCategory: {},
  });

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [amount, setAmount] = useState("");
  const [isVatBill, setIsVatBill] = useState(true);
  const [vatAmount, setVatAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [vendorName, setVendorName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const categories = [
    { key: "ALL", label: "All Overhead Categories", icon: Filter },
    { key: "MARKETING", label: "Marketing & Ads", icon: Megaphone },
    { key: "RENT", label: "Office & Hub Rent", icon: Building },
    { key: "ELECTRICITY", label: "Electricity & Power", icon: Zap },
    { key: "SALARIES", label: "Staff Salaries & Wages", icon: Briefcase },
    { key: "UTILITIES", label: "Internet & Water", icon: TrendingUp },
    { key: "MAINTENANCE", label: "Repairs & Maintenance", icon: Wrench },
    { key: "MISCELLANEOUS", label: "Miscellaneous", icon: Tag },
  ];

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

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  // Auto-compute VAT amount when total amount or isVatBill changes in modal
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
    setCategory("MARKETING");
    setAmount("");
    setIsVatBill(true);
    setVatAmount("");
    setDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("BANK_TRANSFER");
    setVendorName("");
    setInvoiceNumber("");
    setNotes("");
    setModalOpen(true);
  };

  const handleOpenEditModal = (exp) => {
    setEditingId(exp.id);
    setTitle(exp.title || "");
    setCategory(exp.category || "MISCELLANEOUS");
    setAmount(exp.amount?.toString() || "");
    setIsVatBill(exp.isVatBill ?? true);
    setVatAmount(exp.vatAmount?.toString() || "");
    setDate(exp.date ? new Date(exp.date).toISOString().split("T")[0] : "");
    setPaymentMethod(exp.paymentMethod || "CASH");
    setVendorName(exp.vendorName || "");
    setInvoiceNumber(exp.invoiceNumber || "");
    setNotes(exp.notes || "");
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
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

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        category,
        amount: parsedAmount,
        isVatBill,
        vatAmount: parseFloat(vatAmount) || 0,
        date,
        paymentMethod,
        vendorName: vendorName.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      const url = editingId
        ? `${backendUrl}/api/expense/update`
        : `${backendUrl}/api/expense/add`;

      const reqBody = editingId ? { id: editingId, ...payload } : payload;

      const res = await axios.post(url, reqBody, { headers: { token } });

      if (res.data.success) {
        toast.success(res.data.message || "Expense saved successfully!");
        setModalOpen(false);
        fetchExpenses();
      } else {
        toast.error(res.data.message || "Failed to save expense.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error saving expense.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this operating expense?")) return;
    try {
      const res = await axios.post(
        `${backendUrl}/api/expense/delete`,
        { id },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Expense deleted successfully!");
        fetchExpenses();
      } else {
        toast.error(res.data.message || "Failed to delete expense.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error deleting expense.");
    }
  };

  const getCategoryBadgeClass = (cat) => {
    switch (cat) {
      case "MARKETING":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "RENT":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "ELECTRICITY":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "SALARIES":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "UTILITIES":
        return "bg-cyan-50 text-cyan-700 border-cyan-200";
      case "MAINTENANCE":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-emerald-600" />
            Operating &amp; Overhead Expenses
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Log marketing, rent, electricity, salaries, and operating expenses. Operating costs are automatically deducted from Gross Profit to derive Net Profit and claim 13% Input VAT credit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchExpenses}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Operating Expense
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Overhead Expenses
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            Rs {Number(summaryMetrics.totalAmount || 0).toLocaleString()}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 block">Deducted from Gross Profit</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Marketing &amp; Ads Spend
          </span>
          <p className="text-2xl font-black text-purple-700 mt-1">
            Rs {Number(summaryMetrics.byCategory?.MARKETING || 0).toLocaleString()}
          </p>
          <span className="text-[10px] text-purple-600 mt-1 block">Meta, Google &amp; Local Ads</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Rent &amp; Electricity
          </span>
          <p className="text-2xl font-black text-blue-700 mt-1">
            Rs {Number((summaryMetrics.byCategory?.RENT || 0) + (summaryMetrics.byCategory?.ELECTRICITY || 0)).toLocaleString()}
          </p>
          <span className="text-[10px] text-blue-600 mt-1 block">Facilities &amp; Power Costs</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Input VAT Claimable
          </span>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            Rs {Number(summaryMetrics.totalVatClaimable || 0).toLocaleString()}
          </p>
          <span className="text-[10px] text-emerald-600 mt-1 block">13% Tax Credit from VAT Bills</span>
        </div>
      </div>

      {/* Category Pills & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const active = selectedCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    active
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Filter & Search */}
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

      {/* Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs">Loading expenses...</div>
        ) : expenses.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No Operating Expenses Recorded</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Click &quot;New Operating Expense&quot; to log overhead expenses like Rent, Electricity, Salaries, or Ads.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Date &amp; Title</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Vendor &amp; Invoice</th>
                  <th className="py-3 px-4 text-center">VAT Status</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {expenses.map((exp) => {
                  const badgeClass = getCategoryBadgeClass(exp.category);
                  const dateStr = exp.date ? new Date(exp.date).toLocaleDateString() : "N/A";

                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Date & Title */}
                      <td className="py-3.5 px-4 align-top">
                        <span className="font-bold text-slate-900 block text-xs">{exp.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{dateStr}</span>
                        {exp.notes && (
                          <span className="text-[10px] text-slate-500 italic block mt-0.5 max-w-xs truncate">
                            {exp.notes}
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-4 align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${badgeClass}`}
                        >
                          {exp.category}
                        </span>
                      </td>

                      {/* Vendor & Invoice */}
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-semibold text-slate-800">{exp.vendorName || "General Vendor"}</p>
                        {exp.invoiceNumber && (
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                            Ref: #{exp.invoiceNumber}
                          </p>
                        )}
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          Via {exp.paymentMethod || "CASH"}
                        </span>
                      </td>

                      {/* VAT Status */}
                      <td className="py-3.5 px-4 text-center align-top">
                        {exp.isVatBill ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ShieldCheck className="w-3 h-3" />
                            13% VAT Bill (Rs {exp.vatAmount})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                            Non-VAT Bill
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right align-top">
                        <span className="font-bold text-slate-900 text-sm block">
                          Rs {Number(exp.amount || 0).toLocaleString()}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(exp)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(exp.id)}
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

      {/* --- ADD / EDIT EXPENSE MODAL --- */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingId ? "Edit Operating Expense" : "Log New Operating Expense"}
                </h3>
                <p className="text-xs text-slate-500">
                  Enter overhead cost details. Operating expenses automatically deduct from Gross Profit.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Expense Title / Description *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Meta Ads Campaign - Dashain Special"
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
                    <option value="MARKETING">Marketing &amp; Ads</option>
                    <option value="RENT">Office / Hub Rent</option>
                    <option value="ELECTRICITY">Electricity &amp; Power</option>
                    <option value="SALARIES">Staff Salaries &amp; Wages</option>
                    <option value="UTILITIES">Internet, Water &amp; Phone</option>
                    <option value="MAINTENANCE">Repairs &amp; Maintenance</option>
                    <option value="MISCELLANEOUS">Miscellaneous</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Total Amount (Rs) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="50000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>
              </div>

              {/* VAT Bill Checkbox */}
              <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-emerald-900">
                    <input
                      type="checkbox"
                      checked={isVatBill}
                      onChange={(e) => setIsVatBill(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                    />
                    Registered 13% VAT Bill Issued
                  </label>
                  {isVatBill && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      Tax Credit Reclaimable
                    </span>
                  )}
                </div>

                {isVatBill && (
                  <div className="flex items-center justify-between text-emerald-800 text-[11px] pt-1 border-t border-emerald-200/60">
                    <span>Embedded 13% Input VAT:</span>
                    <strong className="font-bold">Rs {vatAmount || "0.00"}</strong>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  >
                    <option value="BANK_TRANSFER">Bank Wire Transfer</option>
                    <option value="CASH">Cash Payment</option>
                    <option value="QR_PAYMENT">Fonepay / QR Code</option>
                    <option value="CREDIT">Accounts Payable (Credit)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vendor / Payee Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Meta Ireland / Landlord Name"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Invoice / Bill Reference #</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-99824"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes / Internal Reference</label>
                <textarea
                  rows="2"
                  placeholder="Additional context or campaign details..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 text-slate-900"
                ></textarea>
              </div>

              {/* Submit Buttons */}
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
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Saving..." : editingId ? "Save Changes" : "Save Expense"}
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
