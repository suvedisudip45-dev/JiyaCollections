/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import { Link } from "react-router-dom";
import AccountingPostingStatusBanner from "../components/AccountingPostingStatusBanner";

const ManufacturerPayableReconciliationSection = ({ title, sourceLabel, reconciliation = {} }) => {
  const rows = reconciliation.sources || [];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{reconciliation.coverageNote || "Source-linked manufacturer payable documents compared with posted 2160 journal lines."}</p>
        </div>
        <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${
          reconciliation.isReconciled ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }`}>
          {Number(reconciliation.sourceCount || 0) === 0
            ? "NO SOURCE ACTIVITY"
            : reconciliation.isReconciled
            ? "SOURCE MATCH"
            : `${Number(reconciliation.unmatchedCount || 0)} SOURCE(S) NEED REVIEW`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-3 text-xs sm:grid-cols-4">
        <div><span className="text-slate-500">Posted payable</span><p className="mt-1 font-mono font-semibold">Rs {Number(reconciliation.journalPayable || 0).toLocaleString()}</p></div>
        <div><span className="text-slate-500">Document total</span><p className="mt-1 font-mono font-semibold">Rs {Number(reconciliation.documentOriginal || 0).toLocaleString()}</p></div>
        <div><span className="text-slate-500">Open documents</span><p className="mt-1 font-mono font-semibold">Rs {Number(reconciliation.documentOutstanding || 0).toLocaleString()}</p></div>
        <div><span className="text-slate-500">Variance</span><p className="mt-1 font-mono font-semibold">Rs {Number(reconciliation.variance || 0).toLocaleString()}</p></div>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Manufacturer</th>
              <th className="px-5 py-3 font-semibold">{sourceLabel}</th>
              <th className="px-5 py-3 text-right font-semibold">Journal payable</th>
              <th className="px-5 py-3 text-right font-semibold">Bill original</th>
              <th className="px-5 py-3 text-right font-semibold">Bill open</th>
              <th className="px-5 py-3 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={`${row.manufacturerId || "unattributed"}:${row.sourceId}`} className="text-slate-700">
                <td className="px-5 py-3 font-mono">{row.manufacturerId || "Unattributed"}</td>
                <td className="px-5 py-3 font-mono">{row.sourceId}</td>
                <td className="px-5 py-3 text-right font-mono">Rs {Number(row.journalPayable || 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOriginal || 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOutstanding || 0).toLocaleString()}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No posted journals or payable documents found for this source.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

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
  const partySubledgers = reconciliation?.partySubledgers || [];
  const generalLedgerBalances = reconciliation?.generalLedgerBalances || {};
  const generalLedgerAccountRows = generalLedgerBalances.accounts || [];
  const controlCoverage = reconciliation?.accountingControlCoverage || {};
  const controlCoverageRows = controlCoverage.controls || [];
  const ncmCarrierFees = reconciliation?.ncmCarrierFeeReconciliation || {};
  const ncmCarrierFeeRows = ncmCarrierFees.sources || [];
  const collaborationFeeReceivables = reconciliation?.collaborationFeeReceivableReconciliation || {};
  const collaborationFeeReceivableRows = collaborationFeeReceivables.sources || [];
  const customerRefundPayables = reconciliation?.customerRefundPayableReconciliation || {};
  const customerRefundPayableRows = customerRefundPayables.sources || [];
  const manufacturerProduction = reconciliation?.manufacturerProductionReconciliation || {};
  const manufacturerLogistics = reconciliation?.manufacturerLogisticsReconciliation || {};
  const cashBank = reconciliation?.cashAndBank || {};
  const isTbBalanced = Boolean(trialBalanceData?.isBalanced);
  const isBsBalanced = Boolean(financialStatements?.isBalanceSheetBalanced);
  const hasCompleteCoverage = reconciliation?.coverageStatus === "COMPLETE";
  const hasUnpostedDeliveryAccounting = Number(reconciliation?.accountingPostingStatus?.unpostedCount || 0) > 0;

  const allReconciled =
    hasCompleteCoverage &&
    Boolean(ar.isReconciled) &&
    Boolean(ap.isReconciled) &&
    Boolean(cashBank.isReconciled) &&
    isTbBalanced &&
    isBsBalanced &&
    Boolean(generalLedgerBalances.isReconciled) &&
    !hasUnpostedDeliveryAccounting;

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

      <AccountingPostingStatusBanner status={reconciliation?.accountingPostingStatus} />

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

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">NCM Carrier Fee Payables</h2>
            <p className="mt-1 text-xs text-slate-500">{ncmCarrierFees.coverageNote || "Carrier-fee accruals compared with payable bills, allocations, and 2180 remittance debits."}</p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${
            Number(ncmCarrierFees.sourceCount || 0) === 0
              ? "bg-slate-100 text-slate-700"
              : ncmCarrierFees.isReconciled
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}>
            {Number(ncmCarrierFees.sourceCount || 0) === 0
              ? "NO SOURCE ACTIVITY"
              : ncmCarrierFees.isReconciled
              ? "SOURCE MATCH"
              : `${Number(ncmCarrierFees.unmatchedCount || 0)} SOURCE(S) NEED REVIEW`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-3 text-xs sm:grid-cols-5">
          <div><span className="text-slate-500">Accrued</span><p className="mt-1 font-mono font-semibold">Rs {Number(ncmCarrierFees.accrualPayable || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Bill original</span><p className="mt-1 font-mono font-semibold">Rs {Number(ncmCarrierFees.documentOriginal || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Allocated</span><p className="mt-1 font-mono font-semibold">Rs {Number(ncmCarrierFees.allocationAmount || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">2180 settlement debit</span><p className="mt-1 font-mono font-semibold">Rs {Number(ncmCarrierFees.settlementJournalDebit || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Outstanding</span><p className="mt-1 font-mono font-semibold">Rs {Number(ncmCarrierFees.documentOutstanding || 0).toLocaleString()}</p></div>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Fee batch</th>
                <th className="px-5 py-3 text-right font-semibold">Accrual</th>
                <th className="px-5 py-3 text-right font-semibold">Bill</th>
                <th className="px-5 py-3 text-right font-semibold">Allocated</th>
                <th className="px-5 py-3 text-right font-semibold">2180 debit</th>
                <th className="px-5 py-3 text-right font-semibold">Open</th>
                <th className="px-5 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ncmCarrierFeeRows.map((row) => (
                <tr key={row.sourceId} className="text-slate-700">
                  <td className="px-5 py-3 font-mono">{row.sourceId}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.accrualPayable || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOriginal || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.allocationAmount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.settlementJournalDebit || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOutstanding || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {ncmCarrierFeeRows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No NCM carrier fee accruals, bills, or remittance sources found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-900">Distributor &amp; NCM Party Subledgers</h2>
          <p className="mt-1 text-xs text-slate-500">
            Open source documents compared with their mapped control accounts. Historical/unmatched balances remain flagged for reconciliation.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Party balance</th>
                <th className="px-5 py-3 font-semibold">GL control</th>
                <th className="px-5 py-3 text-right font-semibold">Open documents</th>
                <th className="px-5 py-3 text-right font-semibold">Subledger</th>
                <th className="px-5 py-3 text-right font-semibold">GL</th>
                <th className="px-5 py-3 text-right font-semibold">Variance</th>
                <th className="px-5 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partySubledgers.map((row) => (
                <tr key={`${row.side}:${row.sourceType}`} className="text-slate-700">
                  <td className="px-5 py-3 font-medium">{row.label}</td>
                  <td className="px-5 py-3 font-mono">{row.controlAccountCode}</td>
                  <td className="px-5 py-3 text-right">{Number(row.documentCount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.subledgerTotal || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.glControlBalance || 0).toLocaleString()}</td>
                  <td className={`px-5 py-3 text-right font-mono ${Number(row.variance || 0) === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    Rs {Number(row.variance || 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {row.isReconciled ? "MATCH" : "REVIEW"}
                    </span>
                  </td>
                </tr>
              ))}
              {partySubledgers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">Party subledger balances are unavailable.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ManufacturerPayableReconciliationSection
        title="Manufacturer Accepted Production Bills"
        sourceLabel="Production request"
        reconciliation={manufacturerProduction}
      />

      <ManufacturerPayableReconciliationSection
        title="Manufacturer Local Freight Documents"
        sourceLabel="Shipment source"
        reconciliation={manufacturerLogistics}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Collaboration Fee Receivables</h2>
            <p className="mt-1 text-xs text-slate-500">{collaborationFeeReceivables.coverageNote || "Invoices, receivable documents, recorded allocations, and linked posted 1130 journals are compared."}</p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${
            Number(collaborationFeeReceivables.sourceCount || 0) === 0
              ? "bg-slate-100 text-slate-700"
              : collaborationFeeReceivables.isReconciled
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}>
            {Number(collaborationFeeReceivables.sourceCount || 0) === 0
              ? "NO SOURCE ACTIVITY"
              : collaborationFeeReceivables.isReconciled
              ? "SOURCE MATCH"
              : `${Number(collaborationFeeReceivables.unmatchedCount || 0)} SOURCE(S) NEED REVIEW`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-3 text-xs sm:grid-cols-4">
          <div><span className="text-slate-500">Invoice total</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.invoiceTotal || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Document original</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.documentOriginal || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Document allocated</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.documentAllocated || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Document outstanding</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.documentOutstanding || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Journal receivable</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.journalReceivable || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Allocation records</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.allocationAmount || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Posted receipt allocations</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.postedReceiptAllocationAmount || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Linked 1130 journal net</span><p className="mt-1 font-mono font-semibold">Rs {Number(collaborationFeeReceivables.collectionJournalCredit || 0).toLocaleString()}</p></div>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Invoice</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Invoice total</th>
                <th className="px-5 py-3 text-right font-semibold">Document original</th>
                <th className="px-5 py-3 text-right font-semibold">Journal debit</th>
                <th className="px-5 py-3 text-right font-semibold">Document allocated</th>
                <th className="px-5 py-3 text-right font-semibold">Allocation records</th>
                <th className="px-5 py-3 text-right font-semibold">Posted receipt allocations</th>
                <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                <th className="px-5 py-3 text-right font-semibold">Doc variance</th>
                <th className="px-5 py-3 text-right font-semibold">Journal variance</th>
                <th className="px-5 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {collaborationFeeReceivableRows.map((row) => (
                <tr key={row.sourceId} className="text-slate-700">
                  <td className="px-5 py-3 font-mono">{row.invoiceNumber || row.sourceId}</td>
                  <td className="px-5 py-3">{row.invoiceStatus || "Missing"}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.invoiceTotal || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOriginal || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.journalReceivable || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentAllocated || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.allocationAmount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.postedReceiptAllocationAmount || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentOutstanding || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.invoiceToDocumentVariance || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.documentToJournalVariance || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {collaborationFeeReceivableRows.length === 0 && (
                <tr><td colSpan={12} className="px-5 py-8 text-center text-slate-400">No collaboration fee invoices found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Platform-Funded Customer Return &amp; Exchange Refund Payables</h2>
            <p className="mt-1 text-xs text-slate-500">{customerRefundPayables.coverageNote || "Current platform-funded refund AP originals compared with source-linked 2110 journal credits."}</p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${
            Number(customerRefundPayables.sourceCount || 0) === 0
              ? "bg-slate-100 text-slate-700"
              : customerRefundPayables.isReconciled
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}>
            {Number(customerRefundPayables.sourceCount || 0) === 0
              ? "NO SOURCE ACTIVITY"
              : customerRefundPayables.isReconciled
              ? "SOURCE MATCH"
              : `${Number(customerRefundPayables.unmatchedCount || 0)} SOURCE(S) NEED REVIEW`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 px-5 py-3 text-xs sm:grid-cols-4">
          <div><span className="text-slate-500">Journal payable</span><p className="mt-1 font-mono font-semibold">Rs {Number(customerRefundPayables.journalPayable || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">AP original</span><p className="mt-1 font-mono font-semibold">Rs {Number(customerRefundPayables.payableOriginal || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">AP outstanding</span><p className="mt-1 font-mono font-semibold">Rs {Number(customerRefundPayables.payableOutstanding || 0).toLocaleString()}</p></div>
          <div><span className="text-slate-500">Variance</span><p className="mt-1 font-mono font-semibold">Rs {Number(customerRefundPayables.variance || 0).toLocaleString()}</p></div>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Refund source</th>
                <th className="px-5 py-3 font-semibold">Reference</th>
                <th className="px-5 py-3 text-right font-semibold">Journal</th>
                <th className="px-5 py-3 text-right font-semibold">AP original</th>
                <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                <th className="px-5 py-3 text-right font-semibold">Paid</th>
                <th className="px-5 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customerRefundPayableRows.map((row) => (
                <tr key={`${row.referenceType}:${row.sourceId}`} className="text-slate-700">
                  <td className="px-5 py-3 font-medium">{row.label}</td>
                  <td className="px-5 py-3 font-mono">{row.sourceId}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.journalPayable || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.payableOriginal || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.payableOutstanding || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.payablePaid || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {customerRefundPayableRows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No platform-funded customer return or exchange downgrade refund AP sources found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Balance-Sheet Control Coverage</h2>
            <p className="mt-1 text-xs text-slate-500">
              Explicit coverage and known gaps for configured balance-sheet controls. A matching GL balance alone does not mean its operational source is reconciled.
            </p>
          </div>
          <span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">
            {Number(controlCoverage.unreconciledCount || 0)} / {Number(controlCoverage.controlAccountCount || 0)} NOT COMPLETE
          </span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Control</th>
                <th className="px-5 py-3 font-semibold">Source scope</th>
                <th className="px-5 py-3 text-right font-semibold">GL balance</th>
                <th className="px-5 py-3 font-semibold">Status and gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controlCoverageRows.map((row) => (
                <tr key={row.accountCode} className="align-top text-slate-700">
                  <td className="px-5 py-3 font-medium">{row.accountCode} · {row.label}</td>
                  <td className="px-5 py-3">{row.source}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.glBalance || 0).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">
                      {row.status.replace(/_/g, " ")}
                    </span>
                    <p className="mt-1 text-slate-500">{row.gap}</p>
                  </td>
                </tr>
              ))}
              {controlCoverageRows.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Control-account coverage is unavailable.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Journal-Derived GL Balance Check</h2>
            <p className="mt-1 text-xs text-slate-500">{generalLedgerBalances.coverageNote || "Stored GL balances compared with posted journal lines."}</p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${
            generalLedgerBalances.isReconciled ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}>
            {generalLedgerBalances.isReconciled ? "ALL MATCH" : `${Number(generalLedgerBalances.unresolvedCount || 0)} ACCOUNT(S) NEED REVIEW`}
          </span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-5 py-3 text-right font-semibold">Stored GL balance</th>
                <th className="px-5 py-3 text-right font-semibold">Journal-derived</th>
                <th className="px-5 py-3 text-right font-semibold">Variance</th>
                <th className="px-5 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {generalLedgerAccountRows.map((row) => (
                <tr key={row.accountId} className="text-slate-700">
                  <td className="px-5 py-3 font-medium">{row.accountCode || "—"} · {row.accountName || "Unnamed account"}</td>
                  <td className="px-5 py-3 text-right font-mono">Rs {Number(row.storedBalance || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-mono">
                    {row.journalDerivedBalance === null ? "Unknown" : `Rs ${Number(row.journalDerivedBalance).toLocaleString()}`}
                  </td>
                  <td className={`px-5 py-3 text-right font-mono ${row.isReconciled ? "text-emerald-700" : "text-rose-700"}`}>
                    {row.variance === null ? "Unknown" : `Rs ${Number(row.variance).toLocaleString()}`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.isReconciled ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {row.isReconciled ? "MATCH" : "REVIEW"}
                    </span>
                  </td>
                </tr>
              ))}
              {generalLedgerAccountRows.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Journal-derived GL balances are unavailable.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
