/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import { Link } from "react-router-dom";

const FinanceDashboard = ({ token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchDashboardData = async (month) => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/finance/dashboard?month=${month}`, {
        headers: { token },
      });
      if (res.data.success) {
        setData(res.data.data);
      } else {
        toast.error(res.data.message || "Failed to load financial data");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboardData(selectedMonth);
  }, [token, selectedMonth]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Loading Financial Analytics Engine...
          </p>
        </div>
      </div>
    );
  }

  const revenue = data?.revenue || {};
  const costs = data?.costsAndExpenses || {};
  const profit = data?.profitability || {};
  const breakEven = data?.breakEven || {};
  const bs = data?.balanceSheetSnapshot || {};
  const analytics = data?.analytics || {};

  return (
    <div className="space-y-8 pb-12">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200/60">
              Enterprise Finance
            </span>
            <span className="text-xs font-medium text-slate-400">
              QuickBooks &amp; Xero Standard
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">
            Financial &amp; Executive Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time ROI, profit margins, break-even simulation, and live assets valuation.
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
            onClick={() => fetchDashboardData(selectedMonth)}
            className="p-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-xs"
            title="Refresh Analytics"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* TOP ROW: EXECUTIVE METRICS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ROI CARD */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Annualized ROI</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-bold">
              Return on Capital
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-white">
              {analytics.roiPercentage || 0}%
            </span>
            <span className="text-xs text-emerald-400 font-medium">annualized</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Invested Base: {currency}{(analytics.totalInvestedCapital || 0).toLocaleString()}
          </p>
        </div>

        {/* GROSS PROFIT MARGIN */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Gross Profit Margin</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">
              {profit.grossProfitMargin || 0}%
            </span>
            <span className="text-xs text-slate-500">
              ({currency}{(profit.grossProfit || 0).toLocaleString()})
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Taxable Sales: {currency}{(revenue.taxableRevenue || 0).toLocaleString()}
          </p>
        </div>

        {/* NET PROFIT MARGIN */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Net Profit Margin</span>
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-3xl font-black ${profit.netProfitBeforeTax >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {profit.netProfitMargin || 0}%
            </span>
            <span className="text-xs text-slate-500">
              ({currency}{(profit.netProfitBeforeTax || 0).toLocaleString()})
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            After Opex &amp; Depreciation
          </p>
        </div>

        {/* FINANCIAL HEALTH SCORE */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Solvency Health Score</span>
            <span className="text-xs font-bold text-slate-700">{analytics.healthScore || 0}/100</span>
          </div>
          <div className="mt-3">
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  analytics.healthScore >= 75 ? "bg-emerald-500" : analytics.healthScore >= 50 ? "bg-amber-500" : "bg-rose-500"
                }`}
                style={{ width: `${analytics.healthScore || 0}%` }}
              ></div>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-3 flex items-center justify-between">
            <span>Status:</span>
            <span className="font-bold text-slate-800">
              {analytics.healthScore >= 75 ? "Excellent Solvency" : analytics.healthScore >= 50 ? "Moderate Liquidity" : "Tight Cashflow"}
            </span>
          </p>
        </div>
      </div>

      {/* ROW 2: BREAK-EVEN SIMULATOR & REVENUE/COST ANALYSIS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* BREAK-EVEN ANALYSIS WIDGET */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Break-Even Point (BEP) Analysis</h2>
              <p className="text-xs text-slate-400">Fixed costs coverage vs variable contribution margin</p>
            </div>
            <span className="px-3 py-1 bg-amber-50 text-amber-700 font-bold text-xs rounded-xl border border-amber-200/60">
              CMR: {breakEven.contributionMarginRatio || 0}%
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Monthly Fixed Costs</p>
              <p className="text-xl font-black text-slate-900 mt-1">
                {currency}{(breakEven.fixedCosts || 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-400 mt-1">Rent, salaries, software &amp; utilities</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">BEP Target Revenue</p>
              <p className="text-xl font-black text-amber-600 mt-1">
                {currency}{(breakEven.breakEvenRevenue || 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-400 mt-1">Zero-profit revenue threshold</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">BEP Unit Volume</p>
              <p className="text-xl font-black text-indigo-600 mt-1">
                {breakEven.breakEvenUnits || 0} units
              </p>
              <p className="text-[10px] text-slate-400 mt-1">Minimum sales volume needed</p>
            </div>
          </div>

          {/* PACING GAUGE */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
              <span>Current Revenue vs BEP Threshold</span>
              <span>
                {currency}{(revenue.taxableRevenue || 0).toLocaleString()} / {currency}{(breakEven.breakEvenRevenue || 0).toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, breakEven.currentRevenuePacingPercent || 0)}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {breakEven.currentRevenuePacingPercent >= 100
                ? "🎉 Break-even achieved for this period! All additional sales generate pure profit."
                : `Paced at ${breakEven.currentRevenuePacingPercent || 0}% of target to clear fixed overheads.`}
            </p>
          </div>
        </div>

        {/* LIVE ASSETS & LIABILITIES SNAPSHOT */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Live Assets &amp; Net Worth</h2>
            <p className="text-xs text-slate-400">Balance sheet assets vs liabilities</p>

            <div className="space-y-3 mt-5">
              <div className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                <span className="text-xs font-medium text-emerald-900">Liquid Cash &amp; Bank</span>
                <span className="text-xs font-bold text-emerald-950">{currency}{(bs.liquidCash || 0).toLocaleString()}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                <span className="text-xs font-medium text-blue-900">Inventory at Cost</span>
                <span className="text-xs font-bold text-blue-950">{currency}{(bs.inventoryValuation || 0).toLocaleString()}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <span className="text-xs font-medium text-indigo-900">Fixed Assets (Book Value)</span>
                <span className="text-xs font-bold text-indigo-950">{currency}{(bs.fixedAssetsBookValue || 0).toLocaleString()}</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-rose-50/50 rounded-xl border border-rose-100">
                <span className="text-xs font-medium text-rose-900">Total Debt &amp; Liabilities</span>
                <span className="text-xs font-bold text-rose-950">{currency}{(bs.totalLiabilities || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Net Business Equity</span>
            <span className="text-lg font-black text-slate-900">{currency}{(bs.netEquity || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Product Cost &amp; Overhead Breakdown</h2>
            <p className="mt-1 text-xs text-slate-500">
              Accepted production cost is counted as product COGS; delivery and other approved per-unit charges are operating overhead.
            </p>
          </div>
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            {revenue.unitsSold || 0} units in period
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Product COGS", value: costs.directCOGS, style: "bg-blue-50 border-blue-100 text-blue-900" },
            { label: "Delivery & other overhead", value: costs.deliveryAndOtherOverheads, style: "bg-amber-50 border-amber-100 text-amber-900" },
            { label: "Fixed overhead", value: costs.fixedOverheads, style: "bg-slate-50 border-slate-100 text-slate-800" },
            { label: "Marketing", value: costs.marketingSpend, style: "bg-violet-50 border-violet-100 text-violet-900" },
            { label: "Total operating expenses", value: costs.totalOperatingExpenses, style: "bg-rose-50 border-rose-100 text-rose-900" },
          ].map((row) => (
            <div key={row.label} className={`rounded-xl border p-4 ${row.style}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{row.label}</p>
              <p className="mt-2 text-lg font-black">{currency}{Number(row.value || 0).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ROW 3: QUICK NAVIGATION HUBS */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          Financial Management Modules
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            to="/treasury"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Liquid Cash &amp; Treasury</p>
                <p className="text-xs text-slate-400">Manage bank accounts, wallets &amp; transfers</p>
              </div>
            </div>
          </Link>

          <Link
            to="/assets"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Fixed Assets &amp; Depreciation</p>
                <p className="text-xs text-slate-400">IRD tax slabs &amp; damaged asset write-offs</p>
              </div>
            </div>
          </Link>

          <Link
            to="/partners"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-purple-50 text-purple-600 rounded-xl group-hover:bg-purple-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Partners &amp; Profit Sharing</p>
                <p className="text-xs text-slate-400">Ownership %, dividends &amp; investor debt</p>
              </div>
            </div>
          </Link>

          <Link
            to="/tax"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-amber-50 text-amber-600 rounded-xl group-hover:bg-amber-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">13% VAT &amp; Tax Optimization</p>
                <p className="text-xs text-slate-400">VAT return reconciler &amp; tax-saving ideas</p>
              </div>
            </div>
          </Link>

          <Link
            to="/returns"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-rose-50 text-rose-600 rounded-xl group-hover:bg-rose-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Returns &amp; Debit Notes</p>
                <p className="text-xs text-slate-400">Customer RMA &amp; vendor debit claims</p>
              </div>
            </div>
          </Link>

          <Link
            to="/statements"
            className="p-5 bg-white rounded-2xl border border-slate-200/80 hover:border-slate-900 transition-all group shadow-xs"
          >
            <div className="flex items-center gap-3">
              <span className="p-3 bg-teal-50 text-teal-600 rounded-xl group-hover:bg-teal-600 group-hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Financial Statements</p>
                <p className="text-xs text-slate-400">Income Statement (P&amp;L) &amp; Balance Sheet</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default FinanceDashboard;
