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
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // Manual Journal Entry Modal State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualMemo, setManualMemo] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().split("T")[0]);
  const [lines, setLines] = useState([
    { accountId: "", debit: 0, credit: 0, description: "" },
    { accountId: "", debit: 0, credit: 0, description: "" },
  ]);

  // Reversal Modal State
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [selectedEntryForReverse, setSelectedEntryForReverse] = useState(null);
  const [reverseReason, setReverseReason] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const [entriesRes, accountsRes] = await Promise.all([
        axios.get(`${backendUrl}/api/accounting/journal-entries?page=${page}&limit=10`, { headers: { token } }),
        axios.get(`${backendUrl}/api/accounting/chart-of-accounts`, { headers: { token } }),
      ]);

      if (entriesRes.data.success) {
        setEntries(entriesRes.data.journalEntries || entriesRes.data.entries || []);
        setPagination(entriesRes.data.pagination || null);
      }
      if (accountsRes.data.success) {
        setAccounts(accountsRes.data.accounts || []);
      }
    } catch (err) {
      console.error(err);
      toast.error("Error loading journal entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, page]);

  const handlePageChange = (nextPage) => setPage(nextPage);

  const addLine = () => {
    setLines([...lines, { accountId: "", debit: 0, credit: 0, description: "" }]);
  };

  const removeLine = (idx) => {
    if (lines.length <= 2) {
      toast.warn("A journal entry requires at least two lines.");
      return;
    }
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    const updated = [...lines];
    updated[idx][field] = value;
    if (field === "debit" && Number(value) > 0) {
      updated[idx].credit = 0;
    } else if (field === "credit" && Number(value) > 0) {
      updated[idx].debit = 0;
    }
    setLines(updated);
  };

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handlePostManualEntry = async (e) => {
    e.preventDefault();
    if (!isBalanced) {
      toast.error(`Entry is out of balance! Total Debits: Rs ${totalDebit} vs Total Credits: Rs ${totalCredit}`);
      return;
    }

    const invalidLine = lines.find((l) => !l.accountId || (Number(l.debit) === 0 && Number(l.credit) === 0));
    if (invalidLine) {
      toast.warn("All lines must have a valid account selected and a non-zero debit or credit amount.");
      return;
    }

    try {
      const payload = {
        entryDate: manualDate,
        memo: manualMemo || "Manual Journal Entry",
        reference: manualReference || null,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description || null,
        })),
      };

      const res = await axios.post(`${backendUrl}/api/accounting/manual-journal`, payload, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success(res.data.message || "Manual journal entry posted successfully");
        setShowManualModal(false);
        setManualMemo("");
        setManualReference("");
        setLines([
          { accountId: "", debit: 0, credit: 0, description: "" },
          { accountId: "", debit: 0, credit: 0, description: "" },
        ]);
        fetchData();
      } else {
        toast.error(res.data.message || "Failed to post manual journal entry");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Server error while posting journal entry");
    }
  };

  const handleReverseEntry = async (e) => {
    e.preventDefault();
    if (!selectedEntryForReverse) return;

    try {
      const res = await axios.post(
        `${backendUrl}/api/accounting/journal-entries/${selectedEntryForReverse.id}/reverse`,
        { reason: reverseReason || "Correction reversal" },
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

  const filteredEntries = entries.filter((ent) => {
    const matchSource = sourceTypeFilter === "ALL" || ent.sourceType === sourceTypeFilter;
    const matchStatus = statusFilter === "ALL" || ent.status === statusFilter;
    return matchSource && matchStatus;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
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
            Audit-ready chronological journal with automatic balancing and immutable line entries
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors"
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
            New Manual Journal Entry
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Source Event
            </label>
            <select
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Source Types</option>
              <option value="SALES_INVOICE">Sales Invoices</option>
              <option value="CUSTOMER_PAYMENT">Customer Payments</option>
              <option value="PURCHASE_BILL">Purchase Bills / Inbound</option>
              <option value="SUPPLIER_PAYMENT">Supplier / AP Payments</option>
              <option value="SALES_RETURN">Customer Returns / RMA</option>
              <option value="EXPENSE_PAYMENT">Operating Expenses</option>
              <option value="ASSET_ACQUISITION">Fixed Assets</option>
              <option value="DEPRECIATION_BATCH">Depreciation Batches</option>
              <option value="LOAN_DISBURSEMENT">Loan Disbursements</option>
              <option value="LOAN_REPAYMENT">Loan Repayments</option>
              <option value="SHARE_ISSUANCE">Share Issuances</option>
              <option value="SHARE_BUYBACK">Share Buybacks</option>
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
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">All Statuses</option>
              <option value="POSTED">POSTED</option>
              <option value="REVERSED">REVERSED</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-900">{filteredEntries.length}</span> recorded journals
        </div>
      </div>

      {/* Journal Entries List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            Loading journal entries...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            No journal entries match the selected filters.
          </div>
        ) : (
          filteredEntries.map((ent) => {
            const isExpanded = expandedEntryId === ent.id;
            return (
              <div
                key={ent.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all"
              >
                {/* Entry Header Bar */}
                <div
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50"
                  onClick={() => setExpandedEntryId(isExpanded ? null : ent.id)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <button
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedEntryId(isExpanded ? null : ent.id);
                      }}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 text-xs">
                          {ent.entryNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                            SOURCE_TYPE_BADGES[ent.sourceType] || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {ent.sourceType}
                        </span>
                        {ent.status === "REVERSED" ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            REVERSED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            POSTED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-700 font-medium mt-1">
                        {ent.memo || "No memo"}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                        <span>Date: {new Date(ent.entryDate).toLocaleDateString()}</span>
                        {ent.reference && <span>• Ref: {ent.reference}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end md:self-center">
                    <div className="text-right">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase">Balanced Amount</div>
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
                        className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        Reverse
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Lines Table */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full text-left text-xs text-slate-600">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Account Code</th>
                            <th className="py-2.5 px-3">Account Title</th>
                            <th className="py-2.5 px-3">Line Description</th>
                            <th className="py-2.5 px-3 text-right">Debit (Dr)</th>
                            <th className="py-2.5 px-3 text-right">Credit (Cr)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {ent.lines?.map((line) => (
                            <tr key={line.id} className="hover:bg-slate-50/50">
                              <td className="py-2 px-3 font-mono font-bold text-slate-900">
                                {line.account?.accountCode}
                              </td>
                              <td className="py-2 px-3 text-slate-800">
                                {line.account?.accountName}
                              </td>
                              <td className="py-2 px-3 text-slate-500 text-[11px]">
                                {line.description || "—"}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-900">
                                {Number(line.debit) > 0 ? `Rs ${Number(line.debit).toLocaleString()}` : "—"}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-900">
                                {Number(line.credit) > 0 ? `Rs ${Number(line.credit).toLocaleString()}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50/80 border-t border-slate-200 font-mono font-bold text-xs text-slate-900">
                          <tr>
                            <td colSpan="3" className="py-2 px-3 text-right uppercase text-[10px] text-slate-500">
                              Total Check:
                            </td>
                            <td className="py-2 px-3 text-right text-emerald-700">
                              Rs {Number(ent.totalDebit).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right text-emerald-700">
                              Rs {Number(ent.totalCredit).toLocaleString()}
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
                <h2 className="text-base font-bold text-slate-900">Post Manual Adjusting Journal Entry</h2>
                <p className="text-[11px] text-slate-400">Total Debits must equal Total Credits before posting.</p>
              </div>
              <button onClick={() => setShowManualModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handlePostManualEntry} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Entry Date *</label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Memo / Purpose *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Month-end prepaid adjustment"
                    value={manualMemo}
                    onChange={(e) => setManualMemo(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Reference Doc #</label>
                  <input
                    type="text"
                    placeholder="e.g. ADJ-2026-09"
                    value={manualReference}
                    onChange={(e) => setManualReference(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                  />
                </div>
              </div>

              {/* Dynamic Line Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-5/12">Account *</th>
                      <th className="py-2 px-3 w-3/12">Line Memo</th>
                      <th className="py-2 px-3 w-2/12 text-right">Debit (Rs)</th>
                      <th className="py-2 px-3 w-2/12 text-right">Credit (Rs)</th>
                      <th className="py-2 px-2 text-center w-8"></th>
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
                            className="w-full p-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                          >
                            <option value="">Select Account...</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.accountCode} - {acc.accountName} ({acc.category})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="Description..."
                            value={line.description}
                            onChange={(e) => updateLine(idx, "description", e.target.value)}
                            className="w-full p-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="0"
                            value={line.debit || ""}
                            onChange={(e) => updateLine(idx, "debit", e.target.value)}
                            className="w-full p-1.5 text-xs text-right font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="0"
                            value={line.credit || ""}
                            onChange={(e) => updateLine(idx, "credit", e.target.value)}
                            className="w-full p-1.5 text-xs text-right font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="text-slate-400 hover:text-rose-600 text-sm"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-mono font-bold text-xs border-t border-slate-200">
                    <tr>
                      <td colSpan="2" className="p-2.5">
                        <button
                          type="button"
                          onClick={addLine}
                          className="px-2 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center gap-1"
                        >
                          + Add Line
                        </button>
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        Rs {totalDebit.toLocaleString()}
                      </td>
                      <td className="p-2.5 text-right font-mono">
                        Rs {totalCredit.toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Invariant Balance Status Pill */}
              <div
                className={`p-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
                  isBalanced
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-rose-50 text-rose-800 border-rose-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isBalanced ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`}></span>
                  <span>{isBalanced ? "Entry is Balanced & Ready to Post" : "Out of Balance!"}</span>
                </div>
                <div>
                  Difference: Rs {Math.abs(totalDebit - totalCredit).toLocaleString()}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isBalanced}
                  className="px-5 py-2 bg-slate-900 disabled:bg-slate-300 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs"
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
              This action will mark <strong>{selectedEntryForReverse.entryNumber}</strong> as REVERSED and generate an offsetting reversal entry to preserve complete audit integrity.
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
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowReverseModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl"
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
