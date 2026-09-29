/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import { Link } from "react-router-dom";

const AccountingHealth = ({ token }) => {
  const [reconciliation, setReconciliation] = useState(null);
  const [trialBalanceData, setTrialBalanceData] = useState(null);
  const [financialStatements, setFinancialStatements] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      const [recRes, tbRes, stmtRes] = await Promise.all([
        axios.get(`${backendUrl}/api/accounting/subledger-reconciliation`, { headers: { token } }),
        axios.get(`${backendUrl}/api/accounting/trial-balance`, { headers: { token } }),
        axios.get(`${backendUrl}/api/accounting/financial-statements`, { headers: { token } }),
      ]);

      if (recRes.data.success) {
        setReconciliation(recRes.data.reconciliation || null);
      }
      if (tbRes.data.success) {
        setTrialBalanceData(tbRes.data);
      }
      if (stmtRes.data.success) {
        setFinancialStatements(stmtRes.data);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to compile accounting reconciliation health data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchHealthData();
  }, [token]);

  const ar = reconciliation?.accountsReceivable || {};
  const ap = reconciliation?.accountsPayable || {};
  const cashBank = reconciliation?.cashAndBank || {};
  const isTbBalanced = Boolean(trialBalanceData?.isBalanced);
  const isBsBalanced = Boolean(financialStatements?.isBalanceSheetBalanced);
  const hasCompleteCoverage = reconciliation?.coverageStatus === "COMPLETE";

  const allReconciled =
    hasCompleteCoverage &&
    Boolean(ar.isReconciled) &&
    Boolean(ap.isReconciled) &&
    Boolean(cashBank.isReconciled) &&
    isTbBalanced &&
    isBsBalanced;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Accounting Health &amp; Subledger Reconciliation</h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                allReconciled
                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                  : "bg-amber-100 text-amber-800 border-amber-200"
              }`}
            >
              {allReconciled ? "All Controls Reconciled" : hasCompleteCoverage ? "Action Required" : "Coverage Incomplete"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Continuous automated verification of General Ledger control accounts against operating subledgers and double-entry invariants
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchHealthData}
            className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Re-run Health Engine
          </button>
        </div>
      </div>

      {/* OVERALL HEALTH STATUS BANNER */}
      <div
        className={`p-6 rounded-2xl border transition-all ${
          allReconciled
            ? "bg-gradient-to-r from-emerald-900 to-slate-900 text-white border-emerald-800 shadow-sm"
            : "bg-gradient-to-r from-amber-900 to-slate-900 text-white border-amber-800 shadow-sm"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${allReconciled ? "bg-emerald-400" : "bg-amber-400 animate-ping"}`}></span>
              <h2 className="text-lg font-bold">
                {allReconciled
                  ? "Configured balances match"
                  : !hasCompleteCoverage
                  ? "Reconciliation coverage incomplete"
                  : "Variance Identified Across Subsidiary Ledgers"}
              </h2>
            </div>
            <p className="text-xs text-slate-300">
              {allReconciled
                ? "All configured ledgers and source-event coverage checks match for this run."
                : !hasCompleteCoverage
                ? "Some control accounts and source-event populations are not yet connected to complete subledgers. Treat matching totals as partial checks, not a complete reconciliation."
                : "One or more configured comparisons do not reconcile. Review the mapping and unmatched balances below."}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <Link
              to="/journal-entries"
              className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 font-semibold text-xs rounded-xl shadow-xs transition-colors"
            >
              View Journal Entries
            </Link>
          </div>
        </div>
      </div>

      {reconciliation?.coverageGaps?.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 p-4 rounded-lg">
          <h2 className="text-xs font-bold text-amber-900">Reconciliation coverage gaps</h2>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {reconciliation.coverageGaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </div>
      )}

      {/* RECONCILIATION CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 1. ACCOUNTS RECEIVABLE RECONCILIATION */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Accounts Receivable Subledger
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  ar.coverageStatus !== "COMPLETE"
                    ? "bg-amber-100 text-amber-800"
                    : ar.isReconciled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {ar.coverageStatus !== "COMPLETE" ? "Partial Coverage" : ar.isReconciled ? "Reconciled" : "Variance Detected"}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Customer AR vs GL Control
            </h3>
            <p className="text-[11px] text-slate-400">GL Account: 1130 Accounts Receivable</p>

            <div className="space-y-2 mt-4 pt-3 border-t border-slate-100 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>GL Control Balance (1130):</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(ar.glControlBalance || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Active AR Bills Total:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(ar.subledgerTotal || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold">
                <span>Reconciliation Variance:</span>
                <span
                  className={`font-mono ${
                    Number(ar.variance || 0) === 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  Rs {Number(ar.variance || 0).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <Link
            to="/payables"
            className="w-full text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            Inspect Open Receivables &rarr;
          </Link>
        </div>

        {/* 2. ACCOUNTS PAYABLE RECONCILIATION */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Accounts Payable Subledger
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  ap.coverageStatus !== "COMPLETE"
                    ? "bg-amber-100 text-amber-800"
                    : ap.isReconciled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {ap.coverageStatus !== "COMPLETE" ? "Partial Coverage" : ap.isReconciled ? "Reconciled" : "Variance Detected"}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Supplier / AP vs GL Control
            </h3>
            <p className="text-[11px] text-slate-400">GL Account: 2110 Accounts Payable</p>

            <div className="space-y-2 mt-4 pt-3 border-t border-slate-100 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>GL Control Balance (2110):</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(ap.glControlBalance || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Active AP Bills Total:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(ap.subledgerTotal || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold">
                <span>Reconciliation Variance:</span>
                <span
                  className={`font-mono ${
                    Number(ap.variance || 0) === 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  Rs {Number(ap.variance || 0).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <Link
            to="/payables"
            className="w-full text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            Inspect Open Payables &rarr;
          </Link>
        </div>

        {/* 3. CASH & BANK LIQUIDITY RECONCILIATION */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Treasury &amp; Bank Subledger
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  cashBank.isReconciled
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {cashBank.isReconciled
                  ? "Reconciled"
                  : Number(cashBank.unmappedAccountCount || 0) > 0
                  ? "Mapping Required"
                  : "Variance Detected"}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Treasury Cash vs GL Control
            </h3>
            <p className="text-[11px] text-slate-400">Each Treasury balance is compared with its explicitly mapped GL account.</p>

            <div className="space-y-2 mt-4 pt-3 border-t border-slate-100 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Mapped GL balance:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(cashBank.glTotalBalance || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Mapped Treasury balance:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs {Number(cashBank.treasuryAccountsTotal || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold">
                <span>Reconciliation Variance:</span>
                <span
                  className={`font-mono ${
                    Number(cashBank.variance || 0) === 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  Rs {Number(cashBank.variance || 0).toLocaleString()}
                </span>
              </div>
              {Number(cashBank.unmappedAccountCount || 0) > 0 && (
                <div className="pt-2 text-amber-700">
                  {cashBank.unmappedAccountCount} Treasury account(s) need a GL mapping.
                  {cashBank.unmappedAccounts?.length > 0 && (
                    <span className="block mt-1">{cashBank.unmappedAccounts.map((account) => account.accountName).join(", ")}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <Link
            to="/treasury"
            className="w-full text-center py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors"
          >
            Inspect Liquid Treasury &rarr;
          </Link>
        </div>
      </div>

      {/* DOUBLE ENTRY FINANCIAL INVARIANTS STATUS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Trial Balance Invariant */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Trial Balance Debit = Credit Invariant</h3>
              <p className="text-[11px] text-slate-400">Verifies mathematical equality of all double-entry ledger lines</p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                isTbBalanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {isTbBalanced ? "Invariant Passed" : "Invariant Violated"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400">Total Debit Balance</span>
              <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                Rs {Number(trialBalanceData?.totals?.totalClosingDebit || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400">Total Credit Balance</span>
              <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                Rs {Number(trialBalanceData?.totals?.totalClosingCredit || 0).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
            <Link to="/trial-balance" className="text-xs font-semibold text-slate-900 hover:underline">
              Open Full Trial Balance &rarr;
            </Link>
          </div>
        </div>

        {/* Balance Sheet Invariant */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Balance Sheet Equation Invariant</h3>
              <p className="text-[11px] text-slate-400">Assets = Liabilities + Owner Equity</p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                isBsBalanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}
            >
              {isBsBalanced ? "Equation Balanced" : "Out of Balance"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400">Total Assets</span>
              <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                Rs {Number(financialStatements?.balanceSheet?.assets?.totalAssets || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400">Total Liabilities + Equity</span>
              <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
                Rs {Number(financialStatements?.balanceSheet?.totalLiabilitiesAndEquity || 0).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
            <Link to="/statements" className="text-xs font-semibold text-slate-900 hover:underline">
              Open Financial Statements &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountingHealth;
