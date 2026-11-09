/* eslint-disable no-unused-vars, react/prop-types */
import { useCallback, useState, useEffect, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import AccountingPostingStatusBanner from "../components/AccountingPostingStatusBanner";
import NepaliDateRangePicker from "../components/NepaliDateRangePicker";
import { getCurrentNepaliDateRange, getNepaliDateRangeForDate } from "../utils/nepaliDate";

const formatPostedAmount = (value) =>
  value === null || value === undefined ? "Unavailable" : `Rs ${Number(value).toLocaleString()}`;

const FinancialStatements = ({ token }) => {
  const [activeTab, setActiveTab] = useState("PL"); // PL, BS, CF
  const [loading, setLoading] = useState(true);
  const [calendarReady, setCalendarReady] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [calendars, setCalendars] = useState([]);
  const [reportError, setReportError] = useState("");
  const statementRequestId = useRef(0);

  // Date filters
  const [dateRange, setDateRange] = useState(() => getCurrentNepaliDateRange({ fiscalYear: true }));
  const { startDate, endDate } = dateRange;

  const [realtimeData, setRealtimeData] = useState(null);

  useEffect(() => {
    let active = true;
    setCalendarReady(false);
    setCalendarError("");
    setLoading(true);
    if (!token) return () => { active = false; };
    axios.get(`${backendUrl}/api/finance/nepali-calendar/years`, { headers: { token } })
      .then((response) => {
        if (!response.data?.success || !Array.isArray(response.data.years) || !response.data.currentDate) {
          throw new Error(response.data?.message || "Could not load the configured Nepali calendar.");
        }
        if (active) {
          setCalendars(response.data.years);
        }
        if (active) {
          setDateRange(getNepaliDateRangeForDate(response.data.currentDate, { fiscalYear: true }));
        }
        if (active) setCalendarReady(true);
      })
      .catch((error) => {
        console.error("Load configured Nepali date error:", error);
        if (active) {
          const message = error.response?.data?.message || error.message || "Could not load the configured Nepali calendar.";
          setCalendarError(message);
          setLoading(false);
          toast.error(message);
        }
      });
    return () => { active = false; };
  }, [calendarRetry, token]);

  const fetchStatements = useCallback(async () => {
    const requestId = ++statementRequestId.current;
    try {
      setLoading(true);
      setRealtimeData(null);
      setReportError("");
      const rtRes = await axios.get(`${backendUrl}/api/accounting/financial-statements`, {
        headers: { token },
        params: { startDate, endDate, calendar: "BS" },
      });

      if (!rtRes.data.success) {
        throw new Error(rtRes.data.message || "Real-time financial statements could not be loaded.");
      }
      if (requestId === statementRequestId.current) {
        setRealtimeData(rtRes.data);
      }
    } catch (err) {
      console.error(err);
      if (requestId === statementRequestId.current) {
        const message = err.response?.data?.message || err.message || "Failed to load financial statements";
        setReportError(message);
        toast.error(message);
      }
    } finally {
      if (requestId === statementRequestId.current) setLoading(false);
    }
  }, [endDate, startDate, token]);

  useEffect(() => {
    if (token && calendarReady) fetchStatements();
  }, [token, dateRange, calendarReady, fetchStatements]);

  if (calendarError) {
    return (
      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-xs">
        <p role="alert" className="text-sm font-semibold text-rose-800">{calendarError}</p>
        <button
          type="button"
          onClick={() => setCalendarRetry((attempt) => attempt + 1)}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Retry calendar
        </button>
      </div>
    );
  }

  // Derive active statements based on data availability
  const rtPl = realtimeData?.incomeStatement || {};
  const rtBs = realtimeData?.balanceSheet || {};
  const displayedStartDate = startDate;

  const moCf = realtimeData?.cashFlowStatement || {};

  if (reportError && !realtimeData && !loading) {
    return (
      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-xs">
        <p role="alert" className="text-sm font-semibold text-rose-800">{reportError}</p>
        <button
          type="button"
          onClick={fetchStatements}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Retry
        </button>
      </div>
    );
  }

  const rtRevenue = rtPl.revenue || {};
  const rtCogs = rtPl.costOfGoodsSold || {};
  const rtOpex = rtPl.operatingExpenses || {};
  const plRevenue = {
    grossSales: Number(rtRevenue.grossSales || 0),
    shippingRevenue: Number(rtRevenue.shippingRevenue || 0),
    salesReturns: Number(rtRevenue.salesReturns || 0),
    salesDiscounts: Number(rtRevenue.salesDiscounts || 0),
    netRevenue: Number(rtRevenue.netRevenue || 0),
  };

  const plCogs = {
    directCOGS: Number(rtCogs.directCOGS || 0),
    freightTransport: Number(rtCogs.freightTransport || 0),
    packagingExpense: Number(rtCogs.packagingExpense || 0),
    scrapLoss: Number(rtCogs.scrapLoss || 0),
    purchaseReturns: Number(rtCogs.purchaseReturns || 0),
    totalCOGS: Number(rtCogs.totalCOGS || 0),
  };

  const plGrossProfit = rtPl.grossProfit === null || rtPl.grossProfit === undefined
    ? null
    : Number(rtPl.grossProfit);

  const plOpex = {
    salaries: Number(rtOpex.salaries || 0),
    rent: Number(rtOpex.rent || 0),
    utilities: Number(rtOpex.utilities || 0),
    marketing: Number(rtOpex.marketing || 0),
    manufacturerCommission: Number(rtOpex.manufacturerCommission || 0),
    marketingPartnerCpa: Number(rtOpex.marketingPartnerCpa || 0),
    deliveryExpense: Number(rtOpex.deliveryExpense || 0),
    ncmTransferExpense: Number(rtOpex.ncmTransferExpense || 0),
    softwareTools: Number(rtOpex.softwareTools || 0),
    miscExpenses: Number(rtOpex.miscExpenses || 0),
    totalOperatingExpenses: Number(rtOpex.totalOperatingExpenses || 0),
  };

  const plEbitda = rtPl.ebitda === null || rtPl.ebitda === undefined ? null : Number(rtPl.ebitda);
  const rtNonOp = rtPl.nonOperating || {};
  const plNonOp = {
    depreciationExpense: Number(rtNonOp.depreciationExpense || 0),
    loanInterest: Number(rtNonOp.loanInterest || 0),
    bankCharges: Number(rtNonOp.bankCharges || 0),
    otherIncome: Number(rtNonOp.otherIncome || 0),
  };
  const plNetProfit = rtPl.netProfitBeforeTax === null || rtPl.netProfitBeforeTax === undefined
    ? null
    : Number(rtPl.netProfitBeforeTax);

  // Balance Sheet details
  const bsCurrentAssets = rtBs.assets?.currentAssets || {
    cash: 0,
    bank: 0,
    accountsReceivable: 0,
    codReceivable: 0,
    distributorCodReceivable: 0,
    gatewayClearing: 0,
    inventory: 0,
    inputVat: 0,
    supplierAdvances: 0,
    vatTaxPrepayments: 0,
    totalCurrentAssets: 0,
  };

  const bsFixedAssets = rtBs.assets?.fixedAssets || {
    grossAssets: 0,
    accumulatedDepreciation: 0,
    netFixedAssets: 0,
  };

  const bsTotalAssets = rtBs.assets?.totalAssets ?? 0;

  const bsCurrentLiab = rtBs.liabilities?.currentLiabilities || {
    accountsPayable: 0,
    manufacturerPayable: 0,
    distributorPayable: 0,
    marketingPartnerPayable: 0,
    carrierPayable: 0,
    outputVat: 0,
    taxPayable: 0,
    customerRefundsPayable: 0,
    dividendsPayable: 0,
    totalCurrentLiabilities: 0,
  };

  const bsLongTermLiab = rtBs.liabilities?.longTermLiabilities || {
    bankLoans: 0,
    totalLongTermLiabilities: 0,
  };

  const bsTotalLiab = rtBs.liabilities?.totalLiabilities ?? 0;

  const bsEquity = rtBs.equity || {
    shareCapital: 0,
    sharePremium: 0,
    retainedEarnings: 0,
    currentFiscalYearNetProfit: 0,
    totalEquity: 0,
  };

  const bsTotalLiabEquity = rtBs.totalLiabilitiesAndEquity ?? 0;
  const isBsBalanced = Boolean(rtBs.isBalanceSheetBalanced);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12 p-4 sm:p-6 max-w-7xl mx-auto">
      {!realtimeData && (
        <div role="alert" className="border border-amber-200 bg-amber-50 p-4 rounded-lg text-xs text-amber-900">
          General Ledger statements are unavailable. Values are not being filled from operational estimates.
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 rounded-lg border border-teal-200/60">
              General Ledger Reports
            </span>
            <span className="text-xs font-medium text-slate-400">Statement Suite</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">Financial Statements</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Income statement, balance sheet, and cash flow use posted General Ledger journals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <NepaliDateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onApply={setDateRange}
            calendars={calendars}
          />
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

      <AccountingPostingStatusBanner status={realtimeData?.accountingPostingStatus} />

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
        <div id="financial-statement-print" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Profit &amp; Loss</p>
            <p className="text-xs text-slate-500 font-medium mt-1">
              For Period: BS {displayedStartDate} to {endDate}
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
                    <span>Inventory Damage, Scrap &amp; Expiry Loss (Account 5500)</span>
                    <span className="font-mono">(Rs {Number(plCogs.scrapLoss).toLocaleString()})</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-black text-slate-900 pt-2 border-t border-slate-200">
                  <span className="text-sm">Gross Profit</span>
                  <span className="font-mono text-sm text-emerald-700">{formatPostedAmount(plGrossProfit)}</span>
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
                  <span>Marketing &amp; Advertising (Account 6400)</span>
                  <span className="font-mono">Rs {Number(plOpex.marketing || 0).toLocaleString()}</span>
                </div>
                {Number(plOpex.manufacturerCommission || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Manufacturer Commission (Account 6410)</span>
                    <span className="font-mono">Rs {Number(plOpex.manufacturerCommission).toLocaleString()}</span>
                  </div>
                )}
                {Number(plOpex.marketingPartnerCpa || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Marketing Partner CPA (Account 6420)</span>
                    <span className="font-mono">Rs {Number(plOpex.marketingPartnerCpa).toLocaleString()}</span>
                  </div>
                )}
                {Number(plOpex.deliveryExpense || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Delivery &amp; Carrier Expense (Account 6430)</span>
                    <span className="font-mono">Rs {Number(plOpex.deliveryExpense).toLocaleString()}</span>
                  </div>
                )}
                {Number(plOpex.ncmTransferExpense || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Distributor NCM Fulfillment Expense (Account 6440)</span>
                    <span className="font-mono">Rs {Number(plOpex.ncmTransferExpense).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Software &amp; Digital Tools (Account 6500)</span>
                  <span className="font-mono">Rs {Number(plOpex.softwareTools || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50">
                  <span>Other &amp; Miscellaneous Operating Expenses (Account 6700)</span>
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
                <span className={`font-mono ${plEbitda === null ? "text-slate-500" : plEbitda >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {formatPostedAmount(plEbitda)}
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
                {Math.abs(Number(plNonOp.otherIncome || 0)) > 0.005 && (
                  <div className={`flex justify-between py-1 border-b border-slate-50 ${Number(plNonOp.otherIncome) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    <span>Other Income (Account 8100)</span>
                    <span className="font-mono">
                      {Number(plNonOp.otherIncome) > 0
                        ? `+Rs ${Number(plNonOp.otherIncome).toLocaleString()}`
                        : `(Rs ${Math.abs(Number(plNonOp.otherIncome)).toLocaleString()})`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* NET PROFIT BEFORE TAX */}
            <div className="pt-4 border-t-2 border-slate-900 flex justify-between items-center">
              <span className="text-base font-black text-slate-900 uppercase">Net Income Before Tax (Bottom Line)</span>
              <span className={`text-xl font-black font-mono ${plNetProfit === null ? "text-slate-500" : plNetProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {formatPostedAmount(plNetProfit)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 2. BALANCE SHEET */}
      {activeTab === "BS" && (
        <div id="financial-statement-print" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Financial Position (Balance Sheet)</p>
            <p className="text-xs text-slate-500 font-medium mt-1">As of BS {endDate}</p>
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
                    <span>COD Receivable from Carrier (Account 1170)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.codReceivable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>COD Receivable from Distributor (Account 1190)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.distributorCodReceivable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Wallets &amp; Payment Gateway Clearing (Account 1180)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.gatewayClearing || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Inventory at Valuation (Account 1140)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.inventory || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Input VAT Receivable (Account 1150)</span>
                    <span className="font-mono">Rs {Number(bsCurrentAssets.inputVat || 0).toLocaleString()}</span>
                  </div>
                  {Number(bsCurrentAssets.vatTaxPrepayments || 0) > 0 && (
                    <div className="flex justify-between py-1 border-b border-slate-50">
                      <span>VAT Tax Prepayments / Credits (Account 1165)</span>
                      <span className="font-mono">Rs {Number(bsCurrentAssets.vatTaxPrepayments).toLocaleString()}</span>
                    </div>
                  )}
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
                    <span>General Accounts Payable (Account 2110)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.accountsPayable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Manufacturer Payable (Account 2160)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.manufacturerPayable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Distributor Payable (Account 2190)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.distributorPayable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Marketing Partner Payable (Account 2170)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.marketingPartnerPayable || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span>Carrier Payable (Account 2180)</span>
                    <span className="font-mono">Rs {Number(bsCurrentLiab.carrierPayable || 0).toLocaleString()}</span>
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
                    <span>Current Fiscal-Year Income</span>
                    <span className={`font-mono ${Number(bsEquity.currentFiscalYearNetProfit || 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      Rs {Number(bsEquity.currentFiscalYearNetProfit || 0).toLocaleString()}
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
        <div id="financial-statement-print" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs max-w-4xl space-y-6">
          <div className="text-center pb-4 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">Aama Clothings Inc.</h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Statement of Cash Flows (Direct Method &amp; Reconciled)</p>
            <p className="text-xs text-slate-500 font-medium mt-1">For Period: BS {startDate} to {endDate}</p>
          </div>
          <div
            role={moCf.isReconciled ? "status" : "alert"}
            className={`rounded-lg border p-4 text-xs ${
              moCf.isReconciled
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {moCf.isReconciled
              ? "Cash flows use posted movements in cash, bank, and wallet/gateway clearing accounts (1110, 1120, 1180) and reconcile to their General Ledger balance. Account 1180 combines Treasury wallets and payment gateway clearing."
              : `Cash flow uses posted cash, bank, and wallet/gateway clearing journals but does not reconcile to the General Ledger balance. Difference: Rs ${Number(moCf.reconciliationDifference || 0).toLocaleString()}. Check opening balances and journal postings. Account 1180 combines Treasury wallets and payment gateway clearing.`}
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
                    +Rs {Number(moCf.details?.cashReceivedFromCustomers || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                  <span>Cash Paid to Suppliers / Manufacturers</span>
                  <span className="font-mono">(Rs {Number(moCf.details?.supplierPayments || 0).toLocaleString()})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                  <span>Other Operating Cash Outflows</span>
                  <span className="font-mono">(Rs {Number(moCf.details?.otherOperatingOutflows || 0).toLocaleString()})</span>
                </div>
                {Number(moCf.details?.otherOperatingInflows || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-50 text-emerald-700">
                    <span>Other Operating Cash Inflows</span>
                    <span className="font-mono">+Rs {Number(moCf.details.otherOperatingInflows).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Net Cash Provided by / (Used in) Operating Activities</span>
                  <span className={`font-mono ${Number(moCf.operatingActivities || 0) >= 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold"}`}>
                    Rs {Number(moCf.operatingActivities || 0).toLocaleString()}
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
                    Inflows: Rs {Number(moCf.details?.investingInflows || 0).toLocaleString()} · Outflows: (Rs {Number(moCf.details?.investingOutflows || 0).toLocaleString()})
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
                    +Rs {Number(moCf.details?.financingInflows || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-50 text-rose-600">
                  <span>Loan Repayments &amp; Partner Distributions</span>
                  <span className="font-mono">(Rs {Number(moCf.details?.financingOutflows || 0).toLocaleString()})</span>
                </div>
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
              <div className="flex justify-between py-0.5 text-slate-600">
                <span>Cash Reconciliation Difference</span>
                <span className={`font-mono ${moCf.isReconciled ? "text-emerald-700" : "text-rose-700 font-bold"}`}>
                  Rs {Number(moCf.reconciliationDifference || 0).toLocaleString()}
                </span>
              </div>

              {moCf.beginningCash !== undefined && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100 text-slate-600 font-medium">
                  <div className="flex justify-between py-0.5">
                    <span>Beginning Cash, Bank &amp; Wallet/Gateway Clearing Balance</span>
                    <span className="font-mono">Rs {Number(moCf.beginningCash || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-0.5 font-bold text-slate-900 text-xs">
                    <span>Ending Cash, Bank &amp; Wallet/Gateway Clearing Balance</span>
                    <span className="font-mono text-emerald-700 font-extrabold">Rs {Number(moCf.endingCash || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @media print {
          @page {
            size: auto;
            margin: 12mm;
          }

          html,
          body {
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #fff !important;
          }

          body *:not(#financial-statement-print):not(#financial-statement-print *) {
            display: none !important;
          }

          body *:has(#financial-statement-print):not(#financial-statement-print) {
            display: contents !important;
          }

          #financial-statement-print {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            color: #111 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          #financial-statement-print .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          #financial-statement-print .flex.justify-between {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
};

export default FinancialStatements;
