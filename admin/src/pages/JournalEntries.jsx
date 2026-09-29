/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import Pagination from "../components/Pagination";

const SOURCE_TYPE_BADGES = {
  SALES_INVOICE: "bg-blue-50 text-blue-700 border-blue-200",
  CUSTOMER_PAYMENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PURCHASE_BILL: "bg-orange-50 text-orange-700 border-orange-200",
  SUPPLIER_PAYMENT: "bg-teal-50 text-teal-700 border-teal-200",
  SALES_RETURN: "bg-rose-50 text-rose-700 border-rose-200",
  EXPENSE_PAYMENT: "bg-amber-50 text-amber-700 border-amber-200",
  ASSET_ACQUISITION: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DEPRECIATION_BATCH: "bg-purple-50 text-purple-700 border-purple-200",
  LOAN_DISBURSEMENT: "bg-cyan-50 text-cyan-700 border-cyan-200",
  LOAN_REPAYMENT: "bg-sky-50 text-sky-700 border-sky-200",
  SHARE_ISSUANCE: "bg-violet-50 text-violet-700 border-violet-200",
  SHARE_BUYBACK: "bg-pink-50 text-pink-700 border-pink-200",
  MANUAL_JOURNAL: "bg-slate-100 text-slate-700 border-slate-300",
  REVERSAL: "bg-red-50 text-red-700 border-red-200",
};

const JournalEntries = ({ token }) => {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceTypeFilter, setSourceTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // Manual Journal Entry Modal State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDescription, setManualDescription] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().split("T")[0]);
  const [lines, setLines] = useState([
    { accountId: "", debit: "", credit: "", description: "" },
    { accountId: "", debit: "", credit: "", description: "" },
  ]);

  // Reversal Modal State
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [selectedEntryForReverse, setSelectedEntryForReverse] = useState(null);
  const [reverseReason, setReverseReason] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: 15,
      };
      if (sourceTypeFilter !== "ALL") params.sourceType = sourceTypeFilter;
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const [entriesRes, accountsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/accounting/journal-entries`, {
          headers: { token },
          params,
        }),
        axios.get(`${backendUrl}/api/accounting/chart-of-accounts`, { headers: { token } }),
      ]);

      if (entriesRes.data.success) {
        setEntries(entriesRes.data.journalEntries || entriesRes.data.entries || []);
        setPagination(entriesRes.data.pagination || null);
      } else {
        toast.error(entriesRes.data.message || "Failed to load journal entries");
      }
      if (accountsRes.data.success) {
        setAccounts(accountsRes.data.accounts || []);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Error loading journal entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, page, sourceTypeFilter, statusFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const handlePageChange = (nextPage) => setPage(nextPage);

  const addLine = () => {
    setLines([...lines, { accountId: "", debit: "", credit: "", description: "" }]);
  };

  const removeLine = (idx) => {
    if (lines.length <= 2) {
      toast.warn("A double-entry journal requires at least two lines.");
      return;
    }
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    const updated = [...lines];
    updated[idx][field] = value;
    if (field === "debit" && Number(value) > 0) {
      updated[idx].credit = "";
    } else if (field === "credit" && Number(value) > 0) {
      updated[idx].debit = "";
    }
    setLines(updated);
  };

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handlePostManualEntry = async (e) => {
    e.preventDefault();
    if (!isBalanced) {
      toast.error(`Entry is out of balance! Debits (Rs ${totalDebit}) must equal Credits (Rs ${totalCredit}).`);
      return;
    }

    const invalidLine = lines.find((l) => !l.accountId || (Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0));
    if (invalidLine) {
      toast.warn("Every journal line must have an account selected and a non-zero debit or credit amount.");
      return;
    }

    try {
      const payload = {
        transactionDate: manualDate,
        description: manualDescription.trim() || "Manual Journal Entry",
        referenceNumber: manualReference.trim() || "",
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description ? l.description.trim() : null,
        })),
      };

      const res = await axios.post(`${backendUrl}/api/accounting/manual-journal`, payload, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success(res.data.message || "Journal entry posted successfully");
        setShowManualModal(false);
        setManualDescription("");
        setManualReference("");
        setLines([
          { accountId: "", debit: "", credit: "", description: "" },
          { accountId: "", debit: "", credit: "", description: "" },
        ]);
        fetchData();
      } else {
        toast.error(res.data.message || "Failed to post manual journal entry");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Server error posting journal entry");
    }
  };

  const handleReverseEntry = async (e) => {
    e.preventDefault();
    if (!selectedEntryForReverse) return;

    try {
      const res = await axios.post(
        `${backendUrl}/api/accounting/reverse-journal`,
        {
          journalEntryId: selectedEntryForReverse.id,
          reversalReason: reverseReason.trim() || "Reversed by Admin",
        },
        { headers: { token } }
      );

      if (res.data.success) {
        toast.success(res.data.message || "Journal entry reversed successfully");
        setShowReverseModal(false);
        setSelectedEntryForReverse(null);
        setReverseReason("");
        fetchData();
      } else {
        toast.error(res.data.message || "Failed to reverse journal entry");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Server error during reversal");
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Journal Entries</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
              Double-Entry Ledger
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authoritative general journal register with automatic debit/credit balance verification
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            New Manual Journal
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Search Journal / Reference / Memo
            </label>
            <div className="relative">
              <svg className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="e.g. JRN-2026-0001, INV-1002..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Source Transaction Type
            </label>
            <select
              value={sourceTypeFilter}
              onChange={(e) => {
                setSourceTypeFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Source Types</option>
              <option value="SALES_INVOICE">Sales Invoices</option>
              <option value="CUSTOMER_PAYMENT">Customer Receipts / COD</option>
              <option value="PURCHASE_BILL">Purchase Bills</option>
              <option value="SUPPLIER_PAYMENT">Supplier / Manufacturer Payments</option>
              <option value="SALES_RETURN">Sales Returns & RMA</option>
              <option value="EXPENSE_PAYMENT">Operating Expenses</option>
              <option value="ASSET_ACQUISITION">Fixed Assets</option>
              <option value="DEPRECIATION_BATCH">Depreciation Batches</option>
              <option value="LOAN_DISBURSEMENT">Loan Disbursements</option>
              <option value="LOAN_REPAYMENT">Loan Repayments</option>
              <option value="SHARE_ISSUANCE">Share Capital</option>
              <option value="MANUAL_JOURNAL">Manual Adjustments</option>
              <option value="REVERSAL">Reversals</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Statuses</option>
              <option value="POSTED">POSTED</option>
              <option value="REVERSED">REVERSED</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
            >
              Apply Filter
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSourceTypeFilter("ALL");
                setStatusFilter("ALL");
                setStartDate("");
                setEndDate("");
                setPage(1);
              }}
              className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-xl"
              title="Reset Filters"
            >
              Reset
            </button>
          </div>
        </form>
      </div>

      {/* Journal Entries List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-2"></div>
            Loading journal entries...
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            No journal entries match the selected filters.
          </div>
        ) : (
          entries.map((ent) => {
            const isExpanded = expandedEntryId === ent.id;
            const journalNum = ent.journalNumber || ent.entryNumber || `JRN-${ent.id?.slice(0, 8)}`;
            const linesList = ent.lines || [];
            const txDate = ent.transactionDate || ent.entryDate;

            return (
              <div
                key={ent.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all"
              >
                {/* Entry Header Bar */}
                <div
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/60"
                  onClick={() => setExpandedEntryId(isExpanded ? null : ent.id)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <button
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-transform"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedEntryId(isExpanded ? null : ent.id);
                      }}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 text-xs">
                          {journalNum}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            SOURCE_TYPE_BADGES[ent.sourceType] || "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {ent.sourceType}
                        </span>
                        {ent.status === "REVERSED" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            REVERSED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            POSTED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-800 font-semibold mt-1">
                        {ent.description || ent.memo || "Double-entry Posting"}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
                        <span>Date: {txDate ? new Date(txDate).toLocaleDateString("en-NP", { year: "numeric", month: "short", day: "numeric" }) : "—"}</span>
                        {ent.referenceNumber && <span>• Ref: <strong className="text-slate-600 font-mono">{ent.referenceNumber}</strong></span>}
                        {ent.createdBy && <span>• By: {ent.createdBy}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end md:self-center">
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Balanced Amount</div>
                      <div className="font-mono font-bold text-slate-900 text-sm">
                        Rs {Number(ent.totalDebit || 0).toLocaleString()}
                      </div>
                    </div>

                    {ent.status === "POSTED" && ent.sourceType !== "REVERSAL" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEntryForReverse(ent);
                          setShowReverseModal(true);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-xl transition-colors shadow-xs"
                      >
                        Reverse
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Lines Table */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/70 p-4">
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                      <table className="w-full text-left text-xs text-slate-600">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                          <tr>
                            <th className="py-2.5 px-4">Account Code</th>
                            <th className="py-2.5 px-4">Account Title</th>
                            <th className="py-2.5 px-4">Line Memo</th>
                            <th className="py-2.5 px-4 text-right">Debit (Dr)</th>
                            <th className="py-2.5 px-4 text-right">Credit (Cr)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {linesList.map((line, idx) => (
                            <tr key={line.id || idx} className="hover:bg-slate-50/50">
                              <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                                {line.account?.accountCode || line.accountCode || "—"}
                              </td>
                              <td className="py-2.5 px-4 text-slate-800 font-medium">
                                {line.account?.accountName || line.accountName || "—"}
                              </td>
                              <td className="py-2.5 px-4 text-slate-500 text-[11px]">
                                {line.description || "—"}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                                {Number(line.debit) > 0 ? `Rs ${Number(line.debit).toLocaleString()}` : "—"}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                                {Number(line.credit) > 0 ? `Rs ${Number(line.credit).toLocaleString()}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200 font-mono font-bold text-xs text-slate-900">
                          <tr>
                            <td colSpan="3" className="py-2.5 px-4 text-right uppercase text-[10px] text-slate-500">
                              Totals Check:
                            </td>
                            <td className="py-2.5 px-4 text-right text-emerald-700">
                              Rs {Number(ent.totalDebit || 0).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-right text-emerald-700">
                              Rs {Number(ent.totalCredit || 0).toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Pagination
        page={pagination?.page || page}
        totalPages={pagination?.totalPages || 0}
        total={pagination?.total || 0}
        onPageChange={handlePageChange}
        loading={loading}
      />

      {/* Manual Journal Entry Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Create Manual Journal Entry</h2>
                <p className="text-[11px] text-slate-400">Total Debits must equal Total Credits before posting to the authoritative ledger.</p>
              </div>
              <button onClick={() => setShowManualModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handlePostManualEntry} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Posting Date *</label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Description / Memo *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Month-end Accrual / Adjustment"
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Reference Document #</label>
                  <input
                    type="text"
                    placeholder="e.g. ADJ-2026-09"
                    value={manualReference}
                    onChange={(e) => setManualReference(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
              </div>

              {/* Dynamic Line Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-5/12">Account *</th>
                      <th className="py-2.5 px-3 w-3/12">Line Memo</th>
                      <th className="py-2.5 px-3 w-2/12 text-right">Debit (Rs)</th>
                      <th className="py-2.5 px-3 w-2/12 text-right">Credit (Rs)</th>
                      <th className="py-2.5 px-2 text-center w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, idx) => (
                      <tr key={idx} className="bg-white">
                        <td className="p-2">
                          <select
                            required
                            value={line.accountId}
                            onChange={(e) => updateLine(idx, "accountId", e.target.value)}
                            className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 font-medium text-slate-900"
                          >
                            <option value="">Select Ledger Account...</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                [{acc.accountCode}] {acc.accountName} ({acc.accountType})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="Line detail..."
                            value={line.description}
                            onChange={(e) => updateLine(idx, "description", e.target.value)}
                            className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="0"
                            value={line.debit}
                            onChange={(e) => updateLine(idx, "debit", e.target.value)}
                            className="w-full p-2 text-xs text-right font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 font-bold"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="0"
                            value={line.credit}
                            onChange={(e) => updateLine(idx, "credit", e.target.value)}
                            className="w-full p-2 text-xs text-right font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 font-bold"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="text-slate-400 hover:text-rose-600 text-sm p-1 rounded-md hover:bg-rose-50"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-mono font-bold text-xs border-t border-slate-200">
                    <tr>
                      <td colSpan="2" className="p-3">
                        <button
                          type="button"
                          onClick={addLine}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 shadow-xs"
                        >
                          + Add Line
                        </button>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-900">
                        Rs {totalDebit.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-900">
                        Rs {totalCredit.toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Invariant Balance Status Pill */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold ${
                  isBalanced
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-rose-50 text-rose-800 border-rose-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${isBalanced ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`}></span>
                  <span>{isBalanced ? "Journal is Balanced (Sum Dr = Sum Cr) & Ready to Post" : "Out of Balance!"}</span>
                </div>
                <div className="font-mono">
                  Difference: Rs {Math.abs(totalDebit - totalCredit).toLocaleString()}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isBalanced}
                  className="px-5 py-2 bg-slate-900 disabled:bg-slate-300 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-all"
                >
                  Post Journal Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reversal Confirmation Modal */}
      {showReverseModal && selectedEntryForReverse && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Reverse Journal Entry</h2>
              <button onClick={() => setShowReverseModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              This action will mark <strong>{selectedEntryForReverse.journalNumber || selectedEntryForReverse.entryNumber}</strong> as REVERSED and generate an offsetting double-entry reversal to preserve the full audit trail.
            </div>

            <form onSubmit={handleReverseEntry} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Reason for Reversal *
                </label>
                <textarea
                  rows="2"
                  required
                  placeholder="Explain why this journal entry is being reversed..."
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowReverseModal(false)}
                  className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs"
                >
                  Confirm Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default JournalEntries;
