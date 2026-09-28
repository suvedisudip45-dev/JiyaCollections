/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const CATEGORY_COLORS = {
  ASSET: "bg-emerald-50 text-emerald-700 border-emerald-200",
  LIABILITY: "bg-amber-50 text-amber-700 border-amber-200",
  EQUITY: "bg-purple-50 text-purple-700 border-purple-200",
  REVENUE: "bg-blue-50 text-blue-700 border-blue-200",
  COGS: "bg-orange-50 text-orange-700 border-orange-200",
  EXPENSE: "bg-rose-50 text-rose-700 border-rose-200",
};

const TrialBalance = ({ token }) => {
  const [data, setData] = useState(null);
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [hideZeroBalances, setHideZeroBalances] = useState(true);

  const fetchTrialBalance = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/accounting/trial-balance`, {
        headers: { token },
        params: { startDate, endDate: asOfDate },
      });

      if (res.data.success) {
        setData(res.data);
      } else {
        toast.error(res.data.message || "Failed to load Trial Balance");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Error connecting to Accounting Engine");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrialBalance();
  }, [startDate, asOfDate, token]);

  const rows = data?.rows || data?.trialBalance || [];
  const totals = data?.totals || {};
  const isBalanced = Boolean(data?.isBalanced ?? totals.isBalanced);
  const variance = Math.abs(Number(totals.totalClosingDebit || 0) - Number(totals.totalClosingCredit || 0));

  const filteredRows = rows.filter((r) => {
    const matchCat = filterCategory === "ALL" || r.accountType === filterCategory || r.category === filterCategory;
    const hasActivity =
      !hideZeroBalances ||
      r.closingDebit > 0 ||
      r.closingCredit > 0 ||
      r.periodDebit > 0 ||
      r.periodCredit > 0 ||
      r.openingDebit > 0 ||
      r.openingCredit > 0;
    return matchCat && hasActivity;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Trial Balance</h1>
            {isBalanced ? (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                BALANCED &bull; &Sigma; Dr = &Sigma; Cr
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                OUT OF BALANCE (Variance: Rs {variance.toFixed(2)})
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authoritative double-entry parity verification across opening balances, period activity, and closing ledgers
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">From:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">As of:</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <button
            onClick={fetchTrialBalance}
            className="px-3.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Invariant Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Closing Debits</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
            Rs {Number(totals.totalClosingDebit || 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Total active debit closing balances</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Closing Credits</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
            Rs {Number(totals.totalClosingCredit || 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Total active credit closing balances</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Imbalance Variance</div>
          <div
            className={`text-2xl font-mono font-bold mt-1 ${
              variance <= 0.05 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            Rs {variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">|Sum(Dr) - Sum(Cr)|</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ledger Health</div>
            <div className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isBalanced ? "bg-emerald-500" : "bg-rose-500 animate-pulse"
                }`}
              ></span>
              {isBalanced ? "Double-Entry Invariant Satisfied" : "Posting Variance Detected"}
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            {rows.length} Ledger accounts evaluated
          </div>
        </div>
      </div>

      {/* Filter and Option Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {["ALL", "ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filterCategory === cat
                  ? "bg-slate-900 text-white font-semibold shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat === "ALL" ? "All Categories" : cat}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 select-none">
          <input
            type="checkbox"
            checked={hideZeroBalances}
            onChange={(e) => setHideZeroBalances(e.target.checked)}
            className="rounded text-slate-900 focus:ring-slate-900"
          />
          Hide Zero / Inactive Balances
        </label>
      </div>

      {/* Trial Balance Comprehensive Grid */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th rowSpan="2" className="py-3 px-4 border-r border-slate-200">Account Code</th>
                <th rowSpan="2" className="py-3 px-4 border-r border-slate-200">Account Title</th>
                <th rowSpan="2" className="py-3 px-4 border-r border-slate-200">Category</th>
                <th colSpan="2" className="py-2 px-3 text-center border-b border-r border-slate-200 bg-slate-100/60">
                  Opening Balance
                </th>
                <th colSpan="2" className="py-2 px-3 text-center border-b border-r border-slate-200 bg-slate-100/60">
                  Period Activity
                </th>
                <th colSpan="2" className="py-2 px-3 text-center border-b border-slate-200 bg-slate-100/60 font-bold text-slate-800">
                  Closing Balance
                </th>
              </tr>
              <tr>
                <th className="py-1.5 px-3 text-right border-r border-slate-200 text-slate-500 font-mono">Dr (Rs)</th>
                <th className="py-1.5 px-3 text-right border-r border-slate-200 text-slate-500 font-mono">Cr (Rs)</th>
                <th className="py-1.5 px-3 text-right border-r border-slate-200 text-slate-500 font-mono">Dr (Rs)</th>
                <th className="py-1.5 px-3 text-right border-r border-slate-200 text-slate-500 font-mono">Cr (Rs)</th>
                <th className="py-1.5 px-3 text-right border-r border-slate-200 font-bold text-slate-700 font-mono">Dr (Rs)</th>
                <th className="py-1.5 px-3 text-right font-bold text-slate-700 font-mono">Cr (Rs)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {loading ? (
                <tr>
                  <td colSpan="9" className="py-12 text-center text-slate-400 text-xs">
                    <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-2"></div>
                    Generating Trial Balance...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="9" className="py-12 text-center text-slate-400 text-xs">
                    No accounts match the active filter criteria.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, idx) => (
                  <tr key={r.id || r.accountCode || idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900 border-r border-slate-100">
                      {r.accountCode}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 font-semibold border-r border-slate-100">
                      {r.accountName}
                    </td>
                    <td className="py-2.5 px-4 border-r border-slate-100">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          CATEGORY_COLORS[r.accountType || r.category] || "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {r.accountType || r.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">
                      {r.openingDebit > 0 ? Number(r.openingDebit).toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">
                      {r.openingCredit > 0 ? Number(r.openingCredit).toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">
                      {r.periodDebit > 0 ? Number(r.periodDebit).toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">
                      {r.periodCredit > 0 ? Number(r.periodCredit).toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-100 bg-slate-50/40">
                      {r.closingDebit > 0 ? `Rs ${Number(r.closingDebit).toLocaleString()}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 bg-slate-50/40">
                      {r.closingCredit > 0 ? `Rs ${Number(r.closingCredit).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {totals && (
              <tfoot className="bg-slate-100/90 border-t-2 border-slate-300 font-mono font-bold text-xs text-slate-900">
                <tr>
                  <td colSpan="3" className="py-3 px-4 text-right uppercase text-[10px] text-slate-500 border-r border-slate-300">
                    Grand Totals:
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 border-r border-slate-300">
                    Rs {Number(totals.totalOpeningDebit || 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 border-r border-slate-300">
                    Rs {Number(totals.totalOpeningCredit || 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 border-r border-slate-300">
                    Rs {Number(totals.totalPeriodDebit || 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 border-r border-slate-300">
                    Rs {Number(totals.totalPeriodCredit || 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-800 border-r border-slate-300 bg-emerald-50/50">
                    Rs {Number(totals.totalClosingDebit || 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-800 bg-emerald-50/50">
                    Rs {Number(totals.totalClosingCredit || 0).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default TrialBalance;
