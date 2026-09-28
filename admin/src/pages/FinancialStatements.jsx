/* eslint-disable no-unused-vars */
import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const FinancialStatements = ({ token }) => {
  const [activeTab, setActiveTab] = useState("PL"); // PL, BS, CF
  const [mode, setMode] = useState("REALTIME"); // REALTIME (from GL) | MONTHLY (Full cash flow & audited)
  const [loading, setLoading] = useState(true);

  // Date filters
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [realtimeData, setRealtimeData] = useState(null);
  const [monthlyData, setMonthlyData] = useState(null);

  const fetchStatements = async () => {
    try {
      setLoading(true);
      const [rtRes, moRes] = await Promise.all([
        axios.get(`${backendUrl}/api/accounting/financial-statements`, {
          headers: { token },
          params: { startDate, endDate },
        }).catch(() => ({ data: { success: false } })),
        axios.get(`${backendUrl}/api/finance/statements`, {
          headers: { token },
          params: { month: selectedMonth },
        }).catch(() => ({ data: { success: false } })),
      ]);

      if (rtRes.data.success) {
        setRealtimeData(rtRes.data);
      }
      if (moRes.data.success) {
        setMonthlyData(moRes.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load financial statements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchStatements();
  }, [token, startDate, endDate, selectedMonth]);

  // Derive active statements based on data availability
  const rtPl = realtimeData?.incomeStatement || {};
  const rtBs = realtimeData?.balanceSheet || {};

  const moPl = monthlyData?.incomeStatement || {};
  const moBs = monthlyData?.balanceSheet || {};
  const moCf = monthlyData?.cashFlowStatement || {};

  const plRevenue = rtPl.revenue || {
    grossSales: moPl.grossRevenue || 0,
    shippingRevenue: 0,
    salesReturns: moPl.returnsAndAllowances || 0,
    salesDiscounts: 0,
    netRevenue: moPl.taxableNetRevenue || 0,
  };

  const plCogs = rtPl.costOfGoodsSold || {
    directCOGS: moPl.cogs || 0,
    freightTransport: 0,
    packagingExpense: 0,
    scrapLoss: 0,
    purchaseReturns: 0,
    totalCOGS: moPl.cogs || 0,
  };

  const plGrossProfit = rtPl.grossProfit ?? (moPl.grossProfit || 0);

  const plOpex = rtPl.operatingExpenses || {
    salaries: moPl.operatingExpenses?.salaries || 0,
    rent: moPl.operatingExpenses?.rent || 0,
    utilities: moPl.operatingExpenses?.utilities || 0,
    marketing: moPl.operatingExpenses?.marketing || 0,
    softwareTools: moPl.operatingExpenses?.software || 0,
    miscExpenses: moPl.operatingExpenses?.misc || 0,
    totalOperatingExpenses: moPl.operatingExpenses?.total || 0,
  };

  const plEbitda = rtPl.ebitda ?? (plGrossProfit - (plOpex.totalOperatingExpenses || 0));
  const plNonOp = rtPl.nonOperating || {
    depreciationExpense: moPl.depreciation || 0,
    loanInterest: 0,
    bankCharges: 0,
    otherIncome: 0,
  };
  const plNetProfit = rtPl.netProfitBeforeTax ?? (moPl.netIncomeAfterTax || 0);

  // Balance Sheet details
  const bsCurrentAssets = rtBs.assets?.currentAssets || {
    cash: moBs.assets?.currentAssets?.cashAndEquivalents || 0,
    bank: 0,
    accountsReceivable: 0,
    inventory: moBs.assets?.currentAssets?.inventoryValuation || 0,
    inputVat: 0,
    supplierAdvances: 0,
    totalCurrentAssets: moBs.assets?.currentAssets?.total || 0,
  };

  const bsFixedAssets = rtBs.assets?.fixedAssets || {
    grossAssets: moBs.assets?.fixedAssets?.grossCost || 0,
    accumulatedDepreciation: moBs.assets?.fixedAssets?.accumulatedDepreciation || 0,
    netFixedAssets: moBs.assets?.fixedAssets?.netBookValue || 0,
  };

  const bsTotalAssets = rtBs.assets?.totalAssets ?? (moBs.assets?.totalAssets || 0);

  const bsCurrentLiab = rtBs.liabilities?.currentLiabilities || {
    accountsPayable: moBs.liabilities?.totalLiabilities || 0,
    outputVat: 0,
    taxPayable: 0,
    customerRefundsPayable: 0,
    dividendsPayable: 0,
    totalCurrentLiabilities: moBs.liabilities?.totalLiabilities || 0,
  };

  const bsLongTermLiab = rtBs.liabilities?.longTermLiabilities || {
    bankLoans: 0,
    totalLongTermLiabilities: 0,
  };

  const bsTotalLiab = rtBs.liabilities?.totalLiabilities ?? (moBs.liabilities?.totalLiabilities || 0);

  const bsEquity = rtBs.equity || {
    shareCapital: moBs.equity?.partnerCapital || 0,
    sharePremium: 0,
    retainedEarnings: moBs.equity?.retainedEarnings || 0,
    currentPeriodNetProfit: plNetProfit,
    totalEquity: moBs.equity?.totalEquity || 0,
  };

  const bsTotalLiabEquity = rtBs.totalLiabilitiesAndEquity ?? (bsTotalLiab + (bsEquity.totalEquity || 0));
  const isBsBalanced = Boolean(rtBs.isBalanceSheetBalanced ?? (Math.abs(bsTotalAssets - bsTotalLiabEquity) <= 0.05));

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 rounded-lg border border-teal-200/60">
              GAAP &amp; Double-Entry Standard
            </span>
            <span className="text-xs font-medium text-slate-400">Statement Suite</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Financial Statements</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Authoritative Income Statement (P&amp;L), Statement of Financial Position (Balance Sheet), and Cash Flow Statement
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            <label className="text-xs font-semibold text-slate-600">From:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            <label className="text-xs font-semibold text-slate-600">To:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
            title="Print or Save PDF"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Export / Print
          </button>
        </div>
      </div>

      {/* STATEMENTS NAVIGATION TABS */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-200/60 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab("PL")}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "PL" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Income Statement (P&amp;L)
        </button>

        <button
          onClick={() => setActiveTab("BS")}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "BS" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Balance Sheet
        </button>

        <button
          onClick={() => setActiveTab("CF")}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "CF" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Cash Flow Statement
        </button>
      </div>

      {/* 1. INCOME STATEMENT (P&L) */}
      {activeTab === "PL" && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Profit &amp; Loss</p>
            <p className="text-xs text-slate-500 font-medium mt-1">
              For Period: {startDate} to {endDate}
            </p>
          </div>

          <div className="space-y-4 text-xs">
            {/* REVENUE SECTION */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">Operating Revenue</p>
              <div className="space-y-1.5 pl-4 text-slate-700">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Gross Product Sales (Account 4100)</span>
                  <span className="font-mono font-semibold">Rs {Number(plRevenue.grossSales || 0).toLocaleString()}</span>
                </div>
                {Number(plRevenue.shippingRevenue || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Shipping &amp; Delivery Revenue (Account 4200)</span>
                    <span className="font-mono">Rs {Number(plRevenue.shippingRevenue).toLocaleString()}</span>
                  </div>
                )}
                {Number(plRevenue.salesReturns || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Less: Sales Returns &amp; RMA (Account 4500)</span>
                    <span className="font-mono">(Rs {Number(plRevenue.salesReturns).toLocaleString()})</span>
                  </div>
                )}
                {Number(plRevenue.salesDiscounts || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Less: Sales Discounts &amp; Vouchers (Account 4600)</span>
                    <span className="font-mono">(Rs {Number(plRevenue.salesDiscounts).toLocaleString()})</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Net Operating Revenue</span>
                  <span className="font-mono text-emerald-700 font-extrabold">Rs {Number(plRevenue.netRevenue || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* COGS SECTION */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">Cost of Goods Sold (COGS)</p>
              <div className="space-y-1.5 pl-4 text-slate-700">
                <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                  <span>Approved Manufacturer COGS (Account 5100)</span>
                  <span className="font-mono">(Rs {Number(plCogs.directCOGS || 0).toLocaleString()})</span>
                </div>
                {Number(plCogs.freightTransport || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Inbound Freight &amp; Transport (Account 5200)</span>
                    <span className="font-mono">(Rs {Number(plCogs.freightTransport).toLocaleString()})</span>
                  </div>
                )}
                {Number(plCogs.packagingExpense || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Packaging &amp; Materials (Account 5300)</span>
                    <span className="font-mono">(Rs {Number(plCogs.packagingExpense).toLocaleString()})</span>
                  </div>
                )}
                {Number(plCogs.scrapLoss || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Inventory Write-off &amp; Expiry Loss (Account 5500)</span>
                    <span className="font-mono">(Rs {Number(plCogs.scrapLoss).toLocaleString()})</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-black text-slate-900 pt-2 border-t border-slate-200">
                  <span className="text-sm">Gross Profit</span>
                  <span className="font-mono text-sm text-emerald-700">Rs {Number(plGrossProfit).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* OPERATING EXPENSES */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">Operating Expenses (OPEX)</p>
              <div className="space-y-1.5 pl-4 text-slate-700">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Staff Salaries &amp; Payroll (Account 6100)</span>
                  <span className="font-mono">Rs {Number(plOpex.salaries || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Office Rent &amp; Hub Lease (Account 6200)</span>
                  <span className="font-mono">Rs {Number(plOpex.rent || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Electricity &amp; Utilities (Account 6300)</span>
                  <span className="font-mono">Rs {Number(plOpex.utilities || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Marketing &amp; Partner Commissions (Account 6400)</span>
                  <span className="font-mono">Rs {Number(plOpex.marketing || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Software &amp; Digital Tools (Account 6500)</span>
                  <span className="font-mono">Rs {Number(plOpex.softwareTools || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Miscellaneous &amp; Overhead (Account 6700)</span>
                  <span className="font-mono">Rs {Number(plOpex.miscExpenses || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Total Operating Expenses</span>
                  <span className="font-mono text-rose-600">(Rs {Number(plOpex.totalOperatingExpenses || 0).toLocaleString()})</span>
                </div>
              </div>
            </div>

            {/* EBITDA & NON-OPERATING */}
            <div>
              <div className="flex justify-between py-1.5 font-bold text-slate-900 border-t border-b border-slate-200">
                <span className="uppercase tracking-wider text-[11px]">Operating Profit (EBITDA)</span>
                <span className={`font-mono ${plEbitda >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  Rs {Number(plEbitda).toLocaleString()}
                </span>
              </div>

              <div className="space-y-1.5 pl-4 text-slate-700 mt-2">
                {Number(plNonOp.depreciationExpense || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-amber-700">
                    <span>Asset Depreciation (Account 6600)</span>
                    <span className="font-mono">(Rs {Number(plNonOp.depreciationExpense).toLocaleString()})</span>
                  </div>
                )}
                {Number(plNonOp.loanInterest || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Financing Loan Interest (Account 7100)</span>
                    <span className="font-mono">(Rs {Number(plNonOp.loanInterest).toLocaleString()})</span>
                  </div>
                )}
                {Number(plNonOp.bankCharges || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Payment Gateway &amp; Bank Fees (Account 7200)</span>
                    <span className="font-mono">(Rs {Number(plNonOp.bankCharges).toLocaleString()})</span>
                  </div>
                )}
                {Number(plNonOp.otherIncome || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-emerald-700">
                    <span>Other Operating Income (Account 8100)</span>
                    <span className="font-mono">+Rs {Number(plNonOp.otherIncome).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* NET PROFIT BEFORE TAX */}
            <div className="pt-4 border-t-2 border-slate-900 flex justify-between items-center">
              <span className="text-base font-black text-slate-900 uppercase">Net Income Before Tax (Bottom Line)</span>
              <span className={`text-xl font-black font-mono ${plNetProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                Rs {Number(plNetProfit).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 2. BALANCE SHEET */}
      {activeTab === "BS" && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Financial Position (Balance Sheet)</p>
            <p className="text-xs text-slate-500 font-medium mt-1">As of {endDate}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
            {/* ASSETS SIDE */}
            <div className="space-y-4">
              <div className="pb-2 border-b-2 border-slate-900 flex items-center justify-between">
                <span className="text-sm font-black text-slate-900 uppercase tracking-wider">Assets</span>
                <span className="text-xs text-slate-400 font-mono">Dr Balances</span>
              </div>

              <div>
                <p className="font-bold text-slate-800 uppercase text-[11px] mb-2">Current Assets</p>
                <div className="space-y-1.5 pl-3 text-slate-700">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Cash on Hand (Account 1110)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.cash || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Bank Accounts (Account 1120)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.bank || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Accounts Receivable (Account 1130)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.accountsReceivable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Inventory at Valuation (Account 1140)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.inventory || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Input VAT Receivable (Account 1150)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.inputVat || 0).toLocaleString()}</span>
                  </div>
                  {Number(bsCurrentAssets.supplierAdvances || 0) > 0 && (
                    <div className="flex justify-between py-1 border-b border-slate-50">
                      <span>Supplier Advances (Account 1160)</span>
                      <span className="font-mono">Rs {Number(bsCurrentAssets.supplierAdvances).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Current Assets</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.totalCurrentAssets || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <p className="font-bold text-slate-800 uppercase text-[11px] mb-2">Non-Current (Fixed) Assets</p>
                <div className="space-y-1.5 pl-3 text-slate-700">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Gross Fixed Assets Cost (Accounts 1510-1530)</span>
                    <span className="font-mono">Rs {Number(bsFixedAssets.grossAssets || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50 text-amber-700">
                    <span>Less: Accumulated Depreciation (Account 1590)</span>
                    <span className="font-mono">(Rs {Number(bsFixedAssets.accumulatedDepreciation || 0).toLocaleString()})</span>
                  </div>
                  <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Net Fixed Assets Book Value</span>
                    <span className="font-mono">Rs {Number(bsFixedAssets.netFixedAssets || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t-2 border-slate-900 flex justify-between items-center font-black text-slate-900 text-sm">
                <span>TOTAL ASSETS</span>
                <span className="font-mono text-emerald-700 text-base">Rs {Number(bsTotalAssets).toLocaleString()}</span>
              </div>
            </div>

            {/* LIABILITIES & EQUITY SIDE */}
            <div className="space-y-4">
              <div className="pb-2 border-b-2 border-slate-900 flex items-center justify-between">
                <span className="text-sm font-black text-slate-900 uppercase tracking-wider">Liabilities &amp; Equity</span>
                <span className="text-xs text-slate-400 font-mono">Cr Balances</span>
              </div>

              <div>
                <p className="font-bold text-slate-800 uppercase text-[11px] mb-2">Current Liabilities</p>
                <div className="space-y-1.5 pl-3 text-slate-700">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Accounts Payable (Account 2110)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.accountsPayable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Output 13% VAT Payable (Account 2120)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.outputVat || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Corporate Tax Payable (Account 2130)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.taxPayable || 0).toLocaleString()}</span>
                  </div>
                  {Number(bsCurrentLiab.customerRefundsPayable || 0) > 0 && (
                    <div className="flex justify-between py-1 border-b border-slate-50">
                      <span>Customer RMA Payable (Account 2140)</span>
                      <span className="font-mono">Rs {Number(bsCurrentLiab.customerRefundsPayable).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Current Liabilities</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.totalCurrentLiabilities || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {Number(bsLongTermLiab.bankLoans || 0) > 0 && (
                <div>
                  <p className="font-bold text-slate-800 uppercase text-[11px] mb-2">Long-Term Debt</p>
                  <div className="space-y-1.5 pl-3 text-slate-700">
                    <div className="flex justify-between py-1 border-b border-slate-50">
                      <span>Bank Loans &amp; Term Debt (Account 2510)</span>
                      <span className="font-mono">Rs {Number(bsLongTermLiab.bankLoans).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <p className="font-bold text-slate-800 uppercase text-[11px] mb-2">Owner &amp; Partner Equity</p>
                <div className="space-y-1.5 pl-3 text-slate-700">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Share Capital (Account 3100)</span>
                    <span className="font-mono">Rs {Number(bsEquity.shareCapital || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Retained Earnings (Account 3300)</span>
                    <span className="font-mono">Rs {Number(bsEquity.retainedEarnings || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50 font-semibold">
                    <span>Current Period Net Income</span>
                    <span className={`font-mono ${Number(bsEquity.currentPeriodNetProfit || 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      Rs {Number(bsEquity.currentPeriodNetProfit || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Equity Base</span>
                    <span className="font-mono">Rs {Number(bsEquity.totalEquity || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t-2 border-slate-900 flex justify-between items-center font-black text-slate-900 text-sm">
                <span>TOTAL LIABILITIES &amp; EQUITY</span>
                <span className="font-mono text-emerald-700 text-base">
                  Rs {Number(bsTotalLiabEquity).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500">Balance Sheet Parity Status:</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${isBsBalanced ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
              {isBsBalanced ? "Assets = Liabilities + Equity (Balanced)" : "Imbalance Detected"}
            </span>
          </div>
        </div>
      )}

      {/* 3. CASH FLOW STATEMENT */}
      {activeTab === "CF" && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Cash Flows (Direct Method &amp; Reconciled)</p>
            <p className="text-xs text-slate-500 font-medium mt-1">For Period: {selectedMonth}</p>
          </div>

          <div className="space-y-6 text-xs text-slate-700">
            {/* OPERATING CASH FLOWS */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">
                Cash Flows from Operating Activities
              </p>
              <div className="space-y-1.5 pl-4">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Cash Inflows from Customer Sales &amp; Collections</span>
                  <span className="font-mono text-emerald-700 font-bold">
                    +Rs {Number(moCf.details?.cashFromCustomers || (typeof moCf.operatingActivities === 'number' ? moCf.operatingActivities : 0)).toLocaleString()}
                  </span>
                </div>
                {moCf.details?.cashPaidToSuppliers !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Cash Outflows to Suppliers / Manufacturer COGS</span>
                    <span className="font-mono">
                      (Rs {Math.abs(moCf.details.cashPaidToSuppliers).toLocaleString()})
                    </span>
                  </div>
                )}
                {moCf.details?.cashPaidForOperatingExpenses !== undefined && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Cash Outflows for Overhead (Rent, Ads, Salaries, Utilities)</span>
                    <span className="font-mono">
                      (Rs {Math.abs(moCf.details.cashPaidForOperatingExpenses).toLocaleString()})
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Net Cash Provided by / (Used in) Operating Activities</span>
                  <span className={`font-mono ${(typeof moCf.operatingActivities === 'number' ? moCf.operatingActivities : moCf.details?.netOperatingCashFlow || 0) >= 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold"}`}>
                    Rs {Number(typeof moCf.operatingActivities === 'number' ? moCf.operatingActivities : moCf.details?.netOperatingCashFlow || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* INVESTING CASH FLOWS */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">
                Cash Flows from Investing Activities
              </p>
              <div className="space-y-1.5 pl-4">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Fixed Asset Additions &amp; Capital Purchases</span>
                  <span className="font-mono">
                    {moCf.details?.assetAdditionsInPeriod !== undefined ? (
                      moCf.details.assetAdditionsInPeriod === 0 ? "Rs 0" : `(Rs ${Math.abs(moCf.details.assetAdditionsInPeriod).toLocaleString()})`
                    ) : (
                      `Rs ${Number(moCf.investingActivities || 0).toLocaleString()}`
                    )}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Net Cash Used in Investing Activities</span>
                  <span className="font-mono">Rs {Number(moCf.investingActivities || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* FINANCING CASH FLOWS */}
            <div>
              <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">
                Cash Flows from Financing Activities
              </p>
              <div className="space-y-1.5 pl-4">
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Capital Contributed &amp; Debt Borrowings</span>
                  <span className="font-mono text-emerald-700">
                    +Rs {Number((moCf.details?.capitalInjectionsInPeriod || 0) + (moCf.details?.loansDisbursedInPeriod || 0)).toLocaleString()}
                  </span>
                </div>
                {(moCf.details?.loanRepaymentsInPeriod !== undefined || moCf.details?.partnerDrawingsInPeriod !== undefined) && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                    <span>Loan Principal Repayments &amp; Partner Drawings</span>
                    <span className="font-mono">
                      (Rs {Math.abs((moCf.details?.loanRepaymentsInPeriod || 0) + (moCf.details?.partnerDrawingsInPeriod || 0)).toLocaleString()})
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Net Cash from Financing Activities</span>
                  <span className="font-mono">Rs {Number(moCf.financingActivities || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* NET CHANGE & LIQUID CASH RECONCILIATION */}
            <div className="pt-4 border-t-2 border-slate-900 space-y-3">
              <div className="flex justify-between items-center font-black text-slate-900 text-sm">
                <span>NET CHANGE IN LIQUID CASH</span>
                <span className={`font-mono text-base ${(moCf.netCashFlow || 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  Rs {Number(moCf.netCashFlow || 0).toLocaleString()}
                </span>
              </div>

              {moCf.beginningCash !== undefined && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100 text-slate-600 font-medium">
                  <div className="flex justify-between py-0.5">
                    <span>Beginning Liquid Cash Balance</span>
                    <span className="font-mono">Rs {Number(moCf.beginningCash || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-0.5 font-bold text-slate-900 text-xs">
                    <span>Ending Liquid Treasury Cash Balance</span>
                    <span className="font-mono text-emerald-700 font-extrabold">Rs {Number(moCf.endingCash || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialStatements;
