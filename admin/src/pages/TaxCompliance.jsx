/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const TaxCompliance = ({ token }) => {
  const [taxData, setTaxData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchTaxReport = async (month) => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/finance/tax-report?month=${month}`, {
        headers: { token },
      });
      if (res.data.success) {
        setTaxData(res.data.data);
      } else {
        toast.error(res.data.message || "Failed to load tax report");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchTaxReport(selectedMonth);
  }, [token, selectedMonth]);

  if (loading && !taxData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Loading Tax Compliance Engine...
          </p>
        </div>
      </div>
    );
  }

  const vat = taxData?.vat || {};
  const incomeTax = taxData?.incomeTax || {};
  const strategies = taxData?.taxOptimizationStrategies || [];

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 rounded-lg border border-amber-200/60">
              Taxation &amp; Compliance
            </span>
            <span className="text-xs font-medium text-slate-400">Nepal IRD Standards (13% VAT &amp; 25% CIT)</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">VAT &amp; Legal Tax Optimization</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            13% VAT monthly offset reconciler, corporate income tax projection, and legal tax-minimizing advisory.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            <label className="text-xs font-semibold text-slate-600">Period:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-hidden cursor-pointer"
            />
          </div>

          <button
            onClick={() => fetchTaxReport(selectedMonth)}
            className="p-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
            title="Refresh Tax Report"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 13% NEPAL VAT MONTHLY RECONCILER */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Posted VAT Monthly Reconciliation</h2>
            <p className="text-xs text-slate-400">Output VAT and verified input VAT from posted journal entries only</p>
          </div>
          <span
            className={`px-3 py-1 rounded-xl text-xs font-bold ${
              vat.netVatPayable >= 0
                ? "bg-rose-50 text-rose-700 border border-rose-200/60"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
            }`}
          >
            {vat.netVatPayable >= 0 ? "Payable to IRD" : "VAT Credit Carryforward"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          {/* OUTPUT VAT */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Output VAT (posted sales)</p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {currency}{(vat.outputVat || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Net posted revenue: {currency}{(vat.taxableSales || 0).toLocaleString()}
            </p>
          </div>

          {/* INPUT VAT */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Input VAT receivable</p>
            <p className="text-2xl font-black text-indigo-600 mt-1">
              {currency}{(vat.inputVat || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Includes only input VAT recognized in posted journals after supporting evidence is verified.
            </p>
          </div>

          {/* NET VAT PAYABLE */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Net VAT Settlement</p>
            <p className={`text-2xl font-black mt-1 ${vat.netVatPayable >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {currency}{Math.abs(vat.netVatPayable || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {vat.netVatPayable >= 0 ? "Net payable for period filing" : "Carried forward to next month"}
            </p>
          </div>
        </div>
        <p className="mt-4 text-[10px] text-slate-400">Basis: {vat.basis === "POSTED_JOURNALS" ? "posted double-entry ledger" : "unavailable"}. Pending or unposted VAT is excluded.</p>
      </div>

      {/* CORPORATE INCOME TAX PROJECTION */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Corporate Income Tax (CIT) Projection</h2>
            <p className="text-xs text-slate-400">Standard 25% tax rate after allowable expense &amp; depreciation deductions</p>
          </div>
          <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl">
            Rate: {incomeTax.taxRate || 25}%
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-6">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Gross Taxable Revenue</p>
            <p className="text-xl font-black text-slate-900 mt-1">
              {currency}{(incomeTax.grossTaxableRevenue || 0).toLocaleString()}
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Allowable Deductions</p>
            <p className="text-xl font-black text-amber-600 mt-1">
              {currency}{(incomeTax.totalAllowableDeductions || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Rent, ads, salaries, software</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tax Depreciation Shield</p>
            <p className="text-xl font-black text-indigo-600 mt-1">
              {currency}{(incomeTax.depreciationDeduction || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">IRD Block A-D depreciation</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Estimated Income Tax</p>
            <p className="text-xl font-black text-rose-600 mt-1">
              {currency}{(incomeTax.estimatedCorporateTax || 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Estimated tax liability</p>
          </div>
        </div>
      </div>

      {/* LEGAL TAX-MINIMIZATION ADVISORY ENGINE */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Legal Tax Minimization &amp; Shield Advisory</h2>
            <p className="text-xs text-slate-400">Actionable recommendations to minimize tax liability legally under Nepal tax laws</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {strategies.map((strat, idx) => (
            <div key={idx} className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/60 hover:border-slate-300 transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    {strat.impact} IMPACT
                  </span>
                  <span className="text-xs font-bold text-slate-800">
                    {strat.savingsEstimate}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mt-2">{strat.title}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{strat.description}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                <span>Compliance: Nepal IRD Standard</span>
                <span className="text-emerald-600 font-bold">100% Legal Deduction</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TaxCompliance;
