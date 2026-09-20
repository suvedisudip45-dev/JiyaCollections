/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const PayablesReceivables = ({ token }) => {
  const [data, setData] = useState(null);
  const [manufacturerSummary, setManufacturerSummary] = useState(null);
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("payables"); // payables | receivables

  // Modals
  const [showAddPayable, setShowAddPayable] = useState(false);
  const [showAddReceivable, setShowAddReceivable] = useState(false);
  const [showSettle, setShowSettle] = useState(null); // holds the payable record
  const [showCollect, setShowCollect] = useState(null); // holds the receivable record

  // Forms
  const [payableForm, setPayableForm] = useState({
    title: "",
    payeeName: "",
    category: "OPERATING_EXPENSE",
    totalAmount: "",
    dueDate: "",
    invoiceNumber: "",
    priority: "MEDIUM",
    notes: "",
  });

  const [receivableForm, setReceivableForm] = useState({
    title: "",
    payerName: "",
    category: "CUSTOMER_RECEIVABLE",
    totalAmount: "",
    dueDate: "",
    invoiceNumber: "",
    notes: "",
  });

  const [settleForm, setSettleForm] = useState({
    amount: "",
    fromAccountId: "",
    notes: "",
  });

  const [collectForm, setCollectForm] = useState({
    amount: "",
    toAccountId: "",
    notes: "",
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/finance/payables-receivables`, {
        headers: { token },
      });
      if (res.data.success) {
        setData(res.data.data);
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load payables & receivables");
    } finally {
      setLoading(false);
    }
  };

  const fetchManufacturerSummary = async (selectedRange = range) => {
    try {
      const res = await axios.get(`${backendUrl}/api/finance/manufacturer-summary`, {
        headers: { token },
        params: { range: selectedRange },
      });
      if (res.data.success) {
        setManufacturerSummary(res.data.data);
      }
    } catch (err) {
      console.error("Failed to load manufacturer summary", err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchData();
      fetchManufacturerSummary();
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchManufacturerSummary(range);
    }
  }, [range, token]);

  // Handlers
  const handleCreatePayable = async (e) => {
    e.preventDefault();
    if (!payableForm.title || !payableForm.payeeName || !payableForm.totalAmount) {
      return toast.warn("Title, Payee Name, and Amount are required");
    }
    try {
      const res = await axios.post(`${backendUrl}/api/finance/create-payable`, payableForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Payable recorded");
        setShowAddPayable(false);
        setPayableForm({ title: "", payeeName: "", category: "OPERATING_EXPENSE", totalAmount: "", dueDate: "", invoiceNumber: "", priority: "MEDIUM", notes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleCreateReceivable = async (e) => {
    e.preventDefault();
    if (!receivableForm.title || !receivableForm.payerName || !receivableForm.totalAmount) {
      return toast.warn("Title, Payer Name, and Amount are required");
    }
    try {
      const res = await axios.post(`${backendUrl}/api/finance/create-receivable`, receivableForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Receivable recorded");
        setShowAddReceivable(false);
        setReceivableForm({ title: "", payerName: "", category: "CUSTOMER_RECEIVABLE", totalAmount: "", dueDate: "", invoiceNumber: "", notes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleSettlePayable = async (e) => {
    e.preventDefault();
    if (!settleForm.amount || !settleForm.fromAccountId) {
      return toast.warn("Payment amount and source account are required");
    }
    try {
      const res = await axios.post(
        `${backendUrl}/api/finance/settle-payable`,
        { payableId: showSettle.id, ...settleForm },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message);
        setShowSettle(null);
        setSettleForm({ amount: "", fromAccountId: "", notes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const handleCollectReceivable = async (e) => {
    e.preventDefault();
    if (!collectForm.amount || !collectForm.toAccountId) {
      return toast.warn("Collection amount and deposit account are required");
    }
    try {
      const res = await axios.post(
        `${backendUrl}/api/finance/collect-receivable`,
        { receivableId: showCollect.id, ...collectForm },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message);
        setShowCollect(null);
        setCollectForm({ amount: "", toAccountId: "", notes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Utils
  const fmt = (n) => `${currency}${Number(n || 0).toLocaleString("en-NP", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const statusBadge = (status) => {
    const map = {
      UNPAID: "bg-red-100 text-red-700",
      PARTIALLY_PAID: "bg-amber-100 text-amber-700",
      PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700",
      SETTLED: "bg-emerald-100 text-emerald-700",
      CANCELLED: "bg-slate-100 text-slate-500",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${map[status] || "bg-slate-100 text-slate-500"}`}>
        {status?.replace(/_/g, " ")}
      </span>
    );
  };

  const priorityBadge = (priority) => {
    const map = {
      LOW: "bg-slate-100 text-slate-500",
      MEDIUM: "bg-blue-100 text-blue-700",
      HIGH: "bg-orange-100 text-orange-700",
      URGENT: "bg-red-100 text-red-700 animate-pulse",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${map[priority] || "bg-slate-100 text-slate-500"}`}>
        {priority}
      </span>
    );
  };

  const categoryLabels = {
    SUPPLIER_INVOICE: "Supplier Invoice",
    OPERATING_EXPENSE: "Expense",
    ASSET_PURCHASE: "Asset Purchase",
    PARTNER_DISTRIBUTION: "Partner Payout",
    TAX_DUE: "Tax Due",
    LOAN_NOTE: "Loan Note",
    OTHER: "Other",
    CUSTOMER_RECEIVABLE: "Customer Due",
    SUPPLIER_DEBIT_REFUND: "Supplier Credit",
    TAX_REFUND_CREDIT: "Tax Credit",
  };

  const formatDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-NP", { year: "numeric", month: "short", day: "numeric" });
  };

  const isOverdue = (dueDate) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-300 border-t-slate-900 rounded-full animate-spin"></div>
      </div>
    );
  }

  const metrics = data?.metrics || {};
  const payables = data?.payables || [];
  const receivables = data?.receivables || [];
  const accounts = data?.accounts || [];
  const manufacturerSummaryData = manufacturerSummary?.summary || {};
  const manufacturerOrders = manufacturerSummary?.orders || [];

  const openPayables = payables.filter((p) => p.status !== "SETTLED" && p.status !== "CANCELLED");
  const settledPayables = payables.filter((p) => p.status === "SETTLED");
  const openReceivables = receivables.filter((r) => r.status !== "SETTLED" && r.status !== "CANCELLED");
  const settledReceivables = receivables.filter((r) => r.status === "SETTLED");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Accounts Payable & Receivable</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track money you owe (Payables) and money owed to you (Receivables). Settle payables from liquid cash.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddPayable(true)}
            className="px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-all flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Record Payable
          </button>
          <button
            onClick={() => setShowAddReceivable(true)}
            className="px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-all flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Record Receivable
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Total Payables Due</p>
          <p className="text-lg font-bold text-red-700 mt-1">{fmt(metrics.totalPayablesOutstanding)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{openPayables.length} unpaid items</p>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">Total Receivables Due</p>
          <p className="text-lg font-bold text-emerald-700 mt-1">{fmt(metrics.totalReceivablesOutstanding)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{openReceivables.length} pending items</p>
        </div>
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Liquid Cash Available</p>
          <p className="text-lg font-bold text-blue-700 mt-1">{fmt(metrics.totalLiquidCash)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Across all accounts</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 ${metrics.canCoverAllPayablesNow ? "border-emerald-200" : "border-red-200"}`}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Net Payable Pressure</p>
          <p className={`text-lg font-bold mt-1 ${metrics.netPayablePressure > 0 ? "text-red-700" : "text-emerald-700"}`}>
            {metrics.netPayablePressure > 0 ? `-${fmt(metrics.netPayablePressure)}` : fmt(Math.abs(metrics.netPayablePressure || 0))}
          </p>
          <p className="text-[10px] mt-0.5">
            {metrics.canCoverAllPayablesNow ? (
              <span className="text-emerald-600 font-medium">✅ Can settle all now</span>
            ) : (
              <span className="text-red-600 font-medium">⚠️ Shortfall — deposit funds first</span>
            )}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Manufacturer summary</p>
            <h2 className="text-base font-bold text-slate-900">Payables & receivables by manufacturer</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "day", label: "Today" },
              { value: "week", label: "7 Days" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "3 Months" },
              { value: "year", label: "Year" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setRange(option.value)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                  range === option.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-red-600">Payable</p>
            <p className="mt-1 text-xl font-black text-red-700">{fmt(manufacturerSummaryData.payable || 0)}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-emerald-600">Receivable</p>
            <p className="mt-1 text-xl font-black text-emerald-700">{fmt(manufacturerSummaryData.receivable || 0)}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-blue-600">Net receivable</p>
            <p className="mt-1 text-xl font-black text-blue-700">{fmt(manufacturerSummaryData.netReceivable || 0)}</p>
          </div>
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-600">Sold / delivered / returned</p>
            <p className="mt-1 text-lg font-black text-slate-800">
              {manufacturerSummaryData.itemsSold || 0} / {manufacturerSummaryData.itemsDelivered || 0} / {manufacturerSummaryData.itemsReturned || 0}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Sales</th>
                <th className="px-3 py-2 font-semibold">Payable</th>
                <th className="px-3 py-2 font-semibold">Receivable</th>
              </tr>
            </thead>
            <tbody>
              {manufacturerOrders.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-3 py-6 text-center text-slate-400">No manufacturer order activity in this period.</td>
                </tr>
              ) : (
                manufacturerOrders.map((order) => (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-700">{order.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold ${
                        String(order.status || "").toLowerCase().includes("deliver")
                          ? "bg-emerald-100 text-emerald-700"
                          : String(order.status || "").toLowerCase().includes("return")
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-700"
                      }`}>
                        {order.status || "Pending"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{order.quantity}</td>
                    <td className="px-3 py-2 text-slate-700">{fmt(order.amount)}</td>
                    <td className="px-3 py-2 text-red-700 font-semibold">{fmt(order.payable)}</td>
                    <td className="px-3 py-2 text-emerald-700 font-semibold">{fmt(order.receivable)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab("payables")}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "payables"
                ? "border-red-600 text-red-700 bg-red-50/50"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Payables (You Owe)
            {openPayables.length > 0 && (
              <span className="ml-1.5 bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full text-[10px]">
                {openPayables.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("receivables")}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "receivables"
                ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Receivables (Owed to You)
            {openReceivables.length > 0 && (
              <span className="ml-1.5 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[10px]">
                {openReceivables.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Payables Tab */}
      {activeTab === "payables" && (
        <div className="space-y-4">
          {openPayables.length === 0 && settledPayables.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-xl">
              <p className="text-slate-400 text-sm">No payables recorded yet</p>
              <p className="text-[11px] text-slate-400 mt-1">Record expenses, supplier invoices, or other liabilities you owe</p>
            </div>
          ) : (
            <>
              {/* Open Payables */}
              {openPayables.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Outstanding Payables</h3>
                  <div className="space-y-2">
                    {openPayables.map((p) => (
                      <div
                        key={p.id}
                        className={`bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                          isOverdue(p.dueDate) ? "border-red-300 bg-red-50/30" : "border-slate-200"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900 truncate">{p.title}</p>
                            {statusBadge(p.status)}
                            {priorityBadge(p.priority)}
                            {isOverdue(p.dueDate) && (
                              <span className="text-[10px] font-bold text-red-600 animate-pulse">OVERDUE</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>To: <b className="text-slate-700">{p.payeeName}</b></span>
                            <span>•</span>
                            <span>{categoryLabels[p.category] || p.category}</span>
                            {p.dueDate && (
                              <>
                                <span>•</span>
                                <span>Due: {formatDate(p.dueDate)}</span>
                              </>
                            )}
                            {p.invoiceNumber && (
                              <>
                                <span>•</span>
                                <span>Inv: {p.invoiceNumber}</span>
                              </>
                            )}
                          </div>
                          {p.notes && <p className="text-[10px] text-slate-400 mt-1 truncate">{p.notes}</p>}
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-bold text-red-700">{fmt(p.remainingBalance)}</p>
                            {p.paidAmount > 0 && (
                              <p className="text-[10px] text-slate-400">Paid: {fmt(p.paidAmount)} / {fmt(p.totalAmount)}</p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setShowSettle(p);
                              setSettleForm({ amount: String(p.remainingBalance), fromAccountId: "", notes: "" });
                            }}
                            className="px-3 py-1.5 bg-slate-900 text-white text-[11px] font-semibold rounded-lg hover:bg-slate-700 transition-all whitespace-nowrap"
                          >
                            Pay Now
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Settled Payables */}
              {settledPayables.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Settled History</h3>
                  <div className="space-y-1.5">
                    {settledPayables.slice(0, 10).map((p) => (
                      <div key={p.id} className="bg-white border border-slate-100 rounded-lg p-3 flex items-center gap-3 opacity-70">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{p.title}</p>
                          <p className="text-[10px] text-slate-400">
                            {p.payeeName} • {formatDate(p.updatedAt)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {statusBadge("SETTLED")}
                          <p className="text-xs font-semibold text-slate-600 mt-0.5">{fmt(p.totalAmount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Receivables Tab */}
      {activeTab === "receivables" && (
        <div className="space-y-4">
          {openReceivables.length === 0 && settledReceivables.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-xl">
              <p className="text-slate-400 text-sm">No receivables recorded yet</p>
              <p className="text-[11px] text-slate-400 mt-1">Track supplier credit notes, customer dues, or other money owed to you</p>
            </div>
          ) : (
            <>
              {/* Open Receivables */}
              {openReceivables.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Outstanding Receivables</h3>
                  <div className="space-y-2">
                    {openReceivables.map((r) => (
                      <div
                        key={r.id}
                        className={`bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                          isOverdue(r.dueDate) ? "border-amber-300 bg-amber-50/30" : "border-slate-200"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-900 truncate">{r.title}</p>
                            {statusBadge(r.status)}
                            {isOverdue(r.dueDate) && (
                              <span className="text-[10px] font-bold text-amber-600">OVERDUE</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span>From: <b className="text-slate-700">{r.payerName}</b></span>
                            <span>•</span>
                            <span>{categoryLabels[r.category] || r.category}</span>
                            {r.dueDate && (
                              <>
                                <span>•</span>
                                <span>Due: {formatDate(r.dueDate)}</span>
                              </>
                            )}
                          </div>
                          {r.notes && <p className="text-[10px] text-slate-400 mt-1 truncate">{r.notes}</p>}
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-bold text-emerald-700">{fmt(r.remainingBalance)}</p>
                            {r.receivedAmount > 0 && (
                              <p className="text-[10px] text-slate-400">Received: {fmt(r.receivedAmount)} / {fmt(r.totalAmount)}</p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setShowCollect(r);
                              setCollectForm({ amount: String(r.remainingBalance), toAccountId: "", notes: "" });
                            }}
                            className="px-3 py-1.5 bg-emerald-700 text-white text-[11px] font-semibold rounded-lg hover:bg-emerald-600 transition-all whitespace-nowrap"
                          >
                            Collect
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Settled Receivables */}
              {settledReceivables.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Collection History</h3>
                  <div className="space-y-1.5">
                    {settledReceivables.slice(0, 10).map((r) => (
                      <div key={r.id} className="bg-white border border-slate-100 rounded-lg p-3 flex items-center gap-3 opacity-70">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{r.title}</p>
                          <p className="text-[10px] text-slate-400">
                            {r.payerName} • {formatDate(r.updatedAt)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {statusBadge("SETTLED")}
                          <p className="text-xs font-semibold text-slate-600 mt-0.5">{fmt(r.totalAmount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ======================= MODALS ======================= */}

      {/* Add Payable Modal */}
      {showAddPayable && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-slate-900">Record New Payable (Liability)</h2>
                <button onClick={() => setShowAddPayable(false)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
              </div>
              <form onSubmit={handleCreatePayable} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                  <input
                    value={payableForm.title}
                    onChange={(e) => setPayableForm({ ...payableForm, title: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="e.g. Supplier Invoice #001, Office Rent Sept"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Payee Name *</label>
                    <input
                      value={payableForm.payeeName}
                      onChange={(e) => setPayableForm({ ...payableForm, payeeName: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                      placeholder="Who you owe"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <select
                      value={payableForm.category}
                      onChange={(e) => setPayableForm({ ...payableForm, category: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    >
                      <option value="SUPPLIER_INVOICE">Supplier Invoice</option>
                      <option value="OPERATING_EXPENSE">Operating Expense</option>
                      <option value="ASSET_PURCHASE">Asset Purchase</option>
                      <option value="TAX_DUE">Tax Due</option>
                      <option value="LOAN_NOTE">Loan Note</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs) *</label>
                    <input
                      type="number"
                      min="1"
                      value={payableForm.totalAmount}
                      onChange={(e) => setPayableForm({ ...payableForm, totalAmount: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={payableForm.dueDate}
                      onChange={(e) => setPayableForm({ ...payableForm, dueDate: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                    <select
                      value={payableForm.priority}
                      onChange={(e) => setPayableForm({ ...payableForm, priority: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea
                    value={payableForm.notes}
                    onChange={(e) => setPayableForm({ ...payableForm, notes: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="Optional details..."
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all"
                >
                  Record Payable Liability
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Receivable Modal */}
      {showAddReceivable && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-slate-900">Record New Receivable (Asset)</h2>
                <button onClick={() => setShowAddReceivable(false)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
              </div>
              <form onSubmit={handleCreateReceivable} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                  <input
                    value={receivableForm.title}
                    onChange={(e) => setReceivableForm({ ...receivableForm, title: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="e.g. Pending COD Payment, Supplier Credit Note"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Payer Name *</label>
                    <input
                      value={receivableForm.payerName}
                      onChange={(e) => setReceivableForm({ ...receivableForm, payerName: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                      placeholder="Who owes you"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <select
                      value={receivableForm.category}
                      onChange={(e) => setReceivableForm({ ...receivableForm, category: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    >
                      <option value="CUSTOMER_RECEIVABLE">Customer Due</option>
                      <option value="SUPPLIER_DEBIT_REFUND">Supplier Debit / Refund</option>
                      <option value="TAX_REFUND_CREDIT">Tax Refund / Credit</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs) *</label>
                    <input
                      type="number"
                      min="1"
                      value={receivableForm.totalAmount}
                      onChange={(e) => setReceivableForm({ ...receivableForm, totalAmount: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={receivableForm.dueDate}
                      onChange={(e) => setReceivableForm({ ...receivableForm, dueDate: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea
                    value={receivableForm.notes}
                    onChange={(e) => setReceivableForm({ ...receivableForm, notes: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="Optional details..."
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-all"
                >
                  Record Receivable Asset
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Settle Payable Modal */}
      {showSettle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900">Settle Payable</h2>
                <button onClick={() => setShowSettle(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-xs font-semibold text-red-800">{showSettle.title}</p>
                <p className="text-[11px] text-red-600 mt-0.5">
                  To: {showSettle.payeeName} • Remaining: <b>{fmt(showSettle.remainingBalance)}</b>
                </p>
              </div>
              <form onSubmit={handleSettlePayable} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Payment Amount (Rs) *</label>
                  <input
                    type="number"
                    min="1"
                    max={showSettle.remainingBalance}
                    value={settleForm.amount}
                    onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    You can make a partial payment. Max: {fmt(showSettle.remainingBalance)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Pay From Account *</label>
                  <select
                    value={settleForm.fromAccountId}
                    onChange={(e) => setSettleForm({ ...settleForm, fromAccountId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                  >
                    <option value="">Select treasury account...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} ({a.accountType}) — Balance: {fmt(a.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Payment Notes</label>
                  <input
                    value={settleForm.notes}
                    onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="e.g. Cheque #XYZ, Bank transfer reference"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-all"
                >
                  Confirm Payment
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Collect Receivable Modal */}
      {showCollect && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900">Collect Receivable</h2>
                <button onClick={() => setShowCollect(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
                <p className="text-xs font-semibold text-emerald-800">{showCollect.title}</p>
                <p className="text-[11px] text-emerald-600 mt-0.5">
                  From: {showCollect.payerName} • Remaining: <b>{fmt(showCollect.remainingBalance)}</b>
                </p>
              </div>
              <form onSubmit={handleCollectReceivable} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Collection Amount (Rs) *</label>
                  <input
                    type="number"
                    min="1"
                    max={showCollect.remainingBalance}
                    value={collectForm.amount}
                    onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    You can collect partially. Max: {fmt(showCollect.remainingBalance)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Deposit Into Account *</label>
                  <select
                    value={collectForm.toAccountId}
                    onChange={(e) => setCollectForm({ ...collectForm, toAccountId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                  >
                    <option value="">Select treasury account...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} ({a.accountType})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Collection Notes</label>
                  <input
                    value={collectForm.notes}
                    onChange={(e) => setCollectForm({ ...collectForm, notes: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-600 outline-none"
                    placeholder="e.g. Cash received, cheque deposit"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 transition-all"
                >
                  Confirm Collection
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayablesReceivables;
