/* eslint-disable no-unused-vars, react/prop-types */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";
import NepaliDatePicker from "../components/NepaliDatePicker";
import { getNepaliDateRangeForDate } from "../utils/nepaliDate";

const PartnershipEquity = ({ token }) => {
  const [capTableData, setCapTableData] = useState({
    capTable: [],
    valuations: [],
    shareTransactions: [],
    metrics: {},
  });
  const [liabilities, setLiabilities] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calendarYears, setCalendarYears] = useState([]);
  const [calendarCurrentDate, setCalendarCurrentDate] = useState("");
  const [calendarReady, setCalendarReady] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [activeTab, setActiveTab] = useState("captable"); // captable, issue, transfer, valuation, loans, transactions, distribution

  // Modals
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [showIssueSharesModal, setShowIssueSharesModal] = useState(false);
  const [showTransferSharesModal, setShowTransferSharesModal] = useState(false);
  const [showValuationModal, setShowValuationModal] = useState(false);
  const [showAddLoanModal, setShowAddLoanModal] = useState(false);
  const [showRepayLoanModal, setShowRepayLoanModal] = useState(false);
  const [showAmortizationModal, setShowAmortizationModal] = useState(false);
  const [showDistributeModal, setShowDistributeModal] = useState(false);

  const [selectedLoan, setSelectedLoan] = useState(null);
  const [selectedLoanSchedule, setSelectedLoanSchedule] = useState([]);
  const [editingPartner, setEditingPartner] = useState(null);

  // Forms
  const [partnerForm, setPartnerForm] = useState({
    id: null,
    partnerName: "",
    email: "",
    phone: "",
    role: "FOUNDER",
    shareCount: "",
    ownershipPercentage: "",
    initialCapital: "",
    notes: "",
  });

  const [issueForm, setIssueForm] = useState({
    investorName: "",
    email: "",
    phone: "",
    role: "ANGEL_INVESTOR",
    preMoneyValuation: "",
    investmentAmount: "",
    depositAccountId: "",
    roundName: "Seed Round",
    notes: "",
  });

  const [transferForm, setTransferForm] = useState({
    sellerPartnerId: "",
    transferType: "PEER_TO_PEER", // PEER_TO_PEER, COMPANY_BUYBACK
    sharesToTransfer: "",
    sharePrice: "",
    buyerType: "EXISTING_PARTNER", // EXISTING_PARTNER, NEW_INVESTOR
    buyerPartnerId: "",
    buyerName: "",
    buyerEmail: "",
    buyerPhone: "",
    buyerRole: "ANGEL_INVESTOR",
    fromTreasuryAccountId: "",
    notes: "",
  });

  const [valuationForm, setValuationForm] = useState({
    roundName: "Annual 409A Fair Market Valuation",
    valuationAmount: "",
    valuationMethod: "EQUITY_ROUND",
    notes: "",
  });

  const [loanForm, setLoanForm] = useState({
    investorName: "",
    contactPhone: "",
    contactEmail: "",
    type: "LONG_TERM_LOAN",
    loanType: "TERM_LOAN",
    principalAmount: "",
    interestRate: "11.5",
    loanTermMonths: "12",
    startDate: "",
    depositAccountId: "",
    notes: "",
  });

  const [repayForm, setRepayForm] = useState({
    repaymentAmount: "",
    principalPortion: "",
    interestPortion: "",
    fromAccountId: "",
    notes: "",
  });

  const [distForm, setDistForm] = useState({
    periodStart: "",
    periodEnd: "",
    fiscalYear: "2082/2083",
    retainedEarningsPercentage: 20,
    executePayout: false,
    fromAccountId: "",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [capRes, liabRes, accRes] = await Promise.all([
        axios.get(`${backendUrl}/api/finance/cap-table-valuation`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/liabilities`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);

      if (capRes.data.success) {
        setCapTableData(
          capRes.data.data || { capTable: [], valuations: [], shareTransactions: [], metrics: {} }
        );
      }
      if (liabRes.data.success) setLiabilities(liabRes.data.liabilities || []);
      if (accRes.data.success) setAccounts(accRes.data.accounts || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load cap table and finance data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchData();
  }, [fetchData, token]);

  useEffect(() => {
    let active = true;
    setCalendarReady(false);
    setCalendarError("");
    if (!token) return () => { active = false; };

    axios.get(`${backendUrl}/api/finance/nepali-calendar/years`, { headers: { token } })
      .then((response) => {
        if (!response.data?.success || !Array.isArray(response.data.years) || !response.data.currentDate) {
          throw new Error(response.data?.message || "Could not load the configured Nepali calendar.");
        }
        if (active) {
          const currentDate = response.data.currentDate;
          setCalendarYears(response.data.years);
          setCalendarCurrentDate(currentDate);
          setLoanForm((current) => ({ ...current, startDate: current.startDate || currentDate }));
          setDistForm((current) => ({
            ...current,
            periodStart: current.periodStart || getNepaliDateRangeForDate(currentDate).startDate,
            periodEnd: current.periodEnd || currentDate,
          }));
          setCalendarReady(true);
        }
      })
      .catch((error) => {
        console.error("Load configured Nepali date error:", error);
        if (active) {
          const message = error.response?.data?.message || error.message || "Could not load the configured Nepali calendar.";
          setCalendarError(message);
          toast.error(message);
        }
      });

    return () => { active = false; };
  }, [calendarRetry, token]);

  // ==========================================
  // HANDLERS
  // ==========================================

  // Save / Update Partner
  const handleSavePartner = async (e) => {
    e.preventDefault();
    if (!partnerForm.partnerName || !partnerForm.email) {
      return toast.warn("Partner name and email are required");
    }

    try {
      const res = await axios.post(`${backendUrl}/api/finance/save-partner`, partnerForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message || "Partner saved successfully");
        setShowAddPartnerModal(false);
        setPartnerForm({
          id: null,
          partnerName: "",
          email: "",
          phone: "",
          role: "FOUNDER",
          shareCount: "",
          ownershipPercentage: "",
          initialCapital: "",
          notes: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Primary Share Issuance
  const handleIssueShares = async (e) => {
    e.preventDefault();
    if (!issueForm.investorName || !issueForm.email || !issueForm.preMoneyValuation || !issueForm.investmentAmount) {
      return toast.warn("Investor name, email, pre-money valuation, and investment amount are required");
    }

    try {
      const res = await axios.post(`${backendUrl}/api/finance/issue-new-shares`, issueForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowIssueSharesModal(false);
        setIssueForm({
          investorName: "",
          email: "",
          phone: "",
          role: "ANGEL_INVESTOR",
          preMoneyValuation: "",
          investmentAmount: "",
          depositAccountId: "",
          roundName: "Seed Round",
          notes: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Secondary Share Transfer / Sale / Buyback
  const handleTransferShares = async (e) => {
    e.preventDefault();
    if (!transferForm.sellerPartnerId || !transferForm.sharesToTransfer) {
      return toast.warn("Please select seller and enter share amount to transfer");
    }

    try {
      const res = await axios.post(`${backendUrl}/api/finance/transfer-share`, transferForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowTransferSharesModal(false);
        setTransferForm({
          sellerPartnerId: "",
          transferType: "PEER_TO_PEER",
          sharesToTransfer: "",
          sharePrice: "",
          buyerType: "EXISTING_PARTNER",
          buyerPartnerId: "",
          buyerName: "",
          buyerEmail: "",
          buyerPhone: "",
          buyerRole: "ANGEL_INVESTOR",
          fromTreasuryAccountId: "",
          notes: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Update Company Valuation
  const handleUpdateValuation = async (e) => {
    e.preventDefault();
    if (!valuationForm.roundName || !valuationForm.valuationAmount) {
      return toast.warn("Valuation round name and amount are required");
    }

    try {
      const res = await axios.post(`${backendUrl}/api/finance/update-valuation`, valuationForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowValuationModal(false);
        setValuationForm({
          roundName: "Annual 409A Fair Market Valuation",
          valuationAmount: "",
          valuationMethod: "EQUITY_ROUND",
          notes: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Add Loan / Financing
  const handleSaveLoan = async (e) => {
    e.preventDefault();
    if (!calendarReady) return toast.error("The configured Nepali calendar is not available.");
    if (!loanForm.investorName || !loanForm.principalAmount) {
      return toast.warn("Lender name and principal amount are required");
    }

    try {
      const res = await axios.post(`${backendUrl}/api/finance/record-financing`, { ...loanForm, calendar: "BS" }, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowAddLoanModal(false);
        setLoanForm({
          investorName: "",
          contactPhone: "",
          contactEmail: "",
          type: "LONG_TERM_LOAN",
          loanType: "TERM_LOAN",
          principalAmount: "",
          interestRate: "11.5",
          loanTermMonths: "12",
          startDate: calendarCurrentDate,
          depositAccountId: "",
          notes: "",
        });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // Repay Loan
  const handleRepayLoan = async (e) => {
    e.preventDefault();
    if (!selectedLoan || !repayForm.repaymentAmount) return;

    try {
      const res = await axios.post(
        `${backendUrl}/api/finance/repay-liability`,
        {
          liabilityId: selectedLoan.id,
          ...repayForm,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message);
        setShowRepayLoanModal(false);
        setSelectedLoan(null);
        setRepayForm({ repaymentAmount: "", principalPortion: "", interestPortion: "", fromAccountId: "", notes: "" });
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  // View Amortization Schedule
  const handleViewSchedule = async (loan) => {
    try {
      setSelectedLoan(loan);
      const res = await axios.get(`${backendUrl}/api/finance/loan-schedule/${loan.id}`, {
        headers: { token },
      });
      if (res.data.success) {
        setSelectedLoanSchedule(res.data.schedule || []);
        setShowAmortizationModal(true);
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error("Failed to load loan amortization schedule");
    }
  };

  // Profit Distribution
  const handleProfitDistribution = async (e) => {
    e.preventDefault();
    if (!calendarReady) return toast.error("The configured Nepali calendar is not available.");
    try {
      const res = await axios.post(`${backendUrl}/api/finance/profit-distribution`, { ...distForm, calendar: "BS" }, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setShowDistributeModal(false);
        fetchData();
      } else {
        toast.error(res.data.message);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  const capTable = capTableData.capTable || [];
  const valuations = capTableData.valuations || [];
  const shareTransactions = capTableData.shareTransactions || [];
  const metrics = capTableData.metrics || {};

  // Selected Seller for transfer modal
  const selectedSeller = capTable.find((p) => p.id === transferForm.sellerPartnerId);

  // Live simulation for Primary Share Issuance
  const simPreVal = Number(issueForm.preMoneyValuation || 0);
  const simInvAmt = Number(issueForm.investmentAmount || 0);
  const simPostVal = simPreVal + simInvAmt;
  const simTotalPreShares = metrics.totalIssuedShares || 100000;
  const simSharePrice = simPreVal > 0 && simTotalPreShares > 0 ? Number((simPreVal / simTotalPreShares).toFixed(4)) : 100;
  const simNewShares = simSharePrice > 0 ? Number((simInvAmt / simSharePrice).toFixed(2)) : 0;
  const simTotalPostShares = simTotalPreShares + simNewShares;
  const simInvestorPct = simPostVal > 0 ? Number(((simInvAmt / simPostVal) * 100).toFixed(2)) : 0;

  const getRoleBadge = (role) => {
    switch (role) {
      case "FOUNDER":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "CO_FOUNDER":
        return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case "ANGEL_INVESTOR":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "INSTITUTIONAL_INVESTOR":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="space-y-8 pb-16 select-none">
      {calendarError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <span>{calendarError}</span>
          <button
            type="button"
            onClick={() => setCalendarRetry((retry) => retry + 1)}
            className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold hover:bg-rose-100"
          >
            Retry calendar
          </button>
        </div>
      )}
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 text-[11px] font-black uppercase tracking-wider bg-purple-50 text-purple-700 rounded-xl border border-purple-200/60">
              Carta &amp; VC Grade Equity Vault
            </span>
            <span className="text-xs font-semibold text-slate-400">Cap Table &amp; Debt Engineering</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-black text-slate-900 mt-1 tracking-tight">
            Partnership, Valuation &amp; Investor Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Strict 100% normalized Cap Table, venture-backed Pre/Post money valuation engine, primary share issuance, secondary share trading, and amortized loan management.
          </p>
        </div>

        {/* TOP ACTION BUTTONS */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowDistributeModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
          >
            <span>💸 Distribute Profits</span>
          </button>

          <button
            onClick={() => setShowTransferSharesModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
          >
            <span>🔄 Sell / Transfer Shares</span>
          </button>

          <button
            onClick={() => setShowIssueSharesModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
          >
            <span>✨ Issue New Shares</span>
          </button>

          <button
            onClick={() => setShowAddLoanModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
          >
            <span>🏦 Add Loan</span>
          </button>

          <button
            onClick={() => {
              setEditingPartner(null);
              setPartnerForm({
                id: null,
                partnerName: "",
                email: "",
                phone: "",
                role: "PARTNER",
                shareCount: "",
                ownershipPercentage: "",
                initialCapital: "",
                notes: "",
              });
              setShowAddPartnerModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
          >
            <span>+ Add Partner</span>
          </button>
        </div>
      </div>

      {/* EXECUTIVE KPI STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Post-Money Valuation</p>
          <p className="text-lg font-black text-slate-900 mt-1">
            {currency}{Number(metrics.currentValuation || 0).toLocaleString()}
          </p>
          <span className="text-[10px] text-purple-600 font-bold bg-purple-50 px-1.5 py-0.5 rounded-md mt-1 inline-block">
            {valuations.length > 0 ? valuations[0].roundName : "Baseline Valuation"}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Issued Shares</p>
          <p className="text-lg font-black text-indigo-900 mt-1">
            {Number(metrics.totalIssuedShares || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Common &amp; Preferred</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Share Price (PPS)</p>
          <p className="text-lg font-black text-emerald-700 mt-1">
            {currency}{Number(metrics.sharePrice || 100).toLocaleString()}
          </p>
          <p className="text-[10px] text-emerald-600 font-semibold mt-1">Effective FMV</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Liquid Treasury Capital</p>
          <p className="text-lg font-black text-blue-700 mt-1">
            {currency}{Number(metrics.totalLiquidCapital || 0).toLocaleString()}
          </p>
          <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded-md mt-1 inline-block">
            Solvency Guard Active
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Allocated Equity</p>
          <p className="text-lg font-black text-purple-700 mt-1">
            {Number(metrics.totalAllocatedPercentage || 0).toFixed(1)}%
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            {Number(metrics.unallocatedPercentage || 0).toFixed(1)}% Unallocated Pool
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Debt &amp; Liabilities</p>
          <p className="text-lg font-black text-rose-700 mt-1">
            {currency}
            {liabilities
              .filter((l) => l.status === "ACTIVE")
              .reduce((acc, l) => acc + Number(l.outstandingBalance || 0), 0)
              .toLocaleString()}
          </p>
          <p className="text-[10px] text-rose-600 font-bold mt-1">{liabilities.length} Facilities Active</p>
        </div>
      </div>

      {/* STRICT 100% ALLOCATION PROGRESS BAR */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight">Cap Table Ownership Distribution</h2>
            <p className="text-xs text-slate-400">Strict 100% normalized equity split across all active stakeholders</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-purple-700 px-3 py-1 bg-purple-50 rounded-xl border border-purple-200/60">
              {metrics.totalAllocatedPercentage || 0}% / 100% Allocated
            </span>
            {metrics.unallocatedPercentage > 0 && (
              <span className="text-xs font-bold text-amber-700 px-3 py-1 bg-amber-50 rounded-xl border border-amber-200/60">
                {metrics.unallocatedPercentage}% Option Pool
              </span>
            )}
          </div>
        </div>

        <div className="w-full bg-slate-100 h-5 rounded-2xl overflow-hidden flex shadow-inner">
          {capTable.map((p, idx) => {
            const colors = [
              "bg-purple-600",
              "bg-indigo-600",
              "bg-emerald-600",
              "bg-blue-600",
              "bg-amber-600",
              "bg-rose-600",
              "bg-teal-600",
            ];
            return (
              <div
                key={p.id}
                className={`h-full ${colors[idx % colors.length]} transition-all hover:opacity-90 relative group`}
                style={{ width: `${Math.max(0, p.ownershipPercentage)}%` }}
                title={`${p.partnerName} (${p.role}): ${p.ownershipPercentage}% [${Number(p.shareCount).toLocaleString()} Shares]`}
              ></div>
            );
          })}
          {metrics.unallocatedPercentage > 0 && (
            <div
              className="h-full bg-slate-300 transition-all"
              style={{ width: `${metrics.unallocatedPercentage}%` }}
              title={`Unallocated Pool: ${metrics.unallocatedPercentage}%`}
            ></div>
          )}
        </div>

        {/* Stakeholder Badges */}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          {capTable.map((p, idx) => {
            const dotColors = [
              "bg-purple-600",
              "bg-indigo-600",
              "bg-emerald-600",
              "bg-blue-600",
              "bg-amber-600",
              "bg-rose-600",
              "bg-teal-600",
            ];
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200/60 rounded-xl text-xs"
              >
                <span className={`w-2.5 h-2.5 rounded-full ${dotColors[idx % dotColors.length]}`}></span>
                <span className="font-bold text-slate-800">{p.partnerName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold bg-white border border-slate-200 text-slate-500">
                  {p.role}
                </span>
                <span className="font-black text-slate-900">{p.ownershipPercentage}%</span>
                <span className="text-slate-400 text-[10px]">({Number(p.shareCount).toLocaleString()} sh)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto text-xs font-bold">
        <button
          onClick={() => setActiveTab("captable")}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === "captable" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          📊 Cap Table &amp; Stakeholders ({capTable.length})
        </button>
        <button
          onClick={() => setActiveTab("valuation")}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === "valuation" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          💎 Valuation &amp; Funding Rounds ({valuations.length})
        </button>
        <button
          onClick={() => setActiveTab("loans")}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === "loans" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          🏦 Debt &amp; Loans ({liabilities.length})
        </button>
        <button
          onClick={() => setActiveTab("transactions")}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === "transactions" ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          📜 Share Transaction Audit Log ({shareTransactions.length})
        </button>
      </div>

      {/* ========================================== */}
      {/* TAB 1: CAP TABLE & SHAREHOLDERS */}
      {/* ========================================== */}
      {activeTab === "captable" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Cap Table Ledger</h2>
              <p className="text-xs text-slate-400">
                Detailed share counts, equity stakes, capital accounts, and current value based on Rs{" "}
                {metrics.sharePrice}/share
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowIssueSharesModal(true)}
                className="px-3.5 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 font-bold rounded-xl text-xs transition-colors"
              >
                + Issue Primary Shares
              </button>
              <button
                onClick={() => setShowTransferSharesModal(true)}
                className="px-3.5 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold rounded-xl text-xs transition-colors"
              >
                🔄 Transfer Shares
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                  <th className="p-4">Stakeholder</th>
                  <th className="p-4">Role</th>
                  <th className="p-4 text-right">Shares Held</th>
                  <th className="p-4 text-right">Equity Stake</th>
                  <th className="p-4 text-right">Capital Contributed</th>
                  <th className="p-4 text-right">Current Valuation</th>
                  <th className="p-4 text-right">Cumulative Dividends</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {capTable.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-slate-400 font-medium">
                      No shareholders found. Click &quot;+ Add Partner&quot; or &quot;Issue New Shares&quot; to initialize cap table.
                    </td>
                  </tr>
                ) : (
                  capTable.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4">
                        <p className="font-bold text-slate-900 text-sm">{p.partnerName}</p>
                        <p className="text-[11px] text-slate-400">{p.email}</p>
                        {p.phone && <p className="text-[10px] text-slate-400">{p.phone}</p>}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${getRoleBadge(p.role)}`}>
                          {p.role}
                        </span>
                      </td>
                      <td className="p-4 text-right font-black text-indigo-900 text-sm">
                        {Number(p.shareCount || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-black text-purple-700 text-sm">
                        {Number(p.ownershipPercentage || 0).toFixed(2)}%
                      </td>
                      <td className="p-4 text-right font-semibold">
                        {currency}{Number(p.initialCapital || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-bold text-emerald-700 text-sm">
                        {currency}{Number(p.currentHoldingValue || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-bold text-slate-800">
                        {currency}{Number(p.totalDistributionsReceived || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700"
                              : p.status === "EXITED"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              setTransferForm({
                                ...transferForm,
                                sellerPartnerId: p.id,
                                sharesToTransfer: "",
                                sharePrice: metrics.sharePrice || 100,
                              });
                              setShowTransferSharesModal(true);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-[11px] transition-colors"
                            title="Sell or Transfer personal shares"
                          >
                            Trade
                          </button>
                          <button
                            onClick={() => {
                              setEditingPartner(p);
                              setPartnerForm({
                                id: p.id,
                                partnerName: p.partnerName,
                                email: p.email,
                                phone: p.phone || "",
                                role: p.role || "PARTNER",
                                shareCount: p.shareCount,
                                ownershipPercentage: p.ownershipPercentage,
                                initialCapital: p.initialCapital,
                                notes: p.notes || "",
                              });
                              setShowAddPartnerModal(true);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px] transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 2: COMPANY VALUATION & ROUNDS */}
      {/* ========================================== */}
      {activeTab === "valuation" && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Valuation Benchmarks &amp; Investment Rounds</h2>
              <p className="text-xs text-slate-400">
                Historic funding rounds, pre-money &amp; post-money benchmarks, and effective share price calculations.
              </p>
            </div>
            <button
              onClick={() => setShowValuationModal(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
            >
              + Set Fair Market Valuation (FMV)
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                    <th className="p-4">Round Name</th>
                    <th className="p-4">Effective Date</th>
                    <th className="p-4 text-right">Pre-Money Valuation</th>
                    <th className="p-4 text-right">Capital Injected</th>
                    <th className="p-4 text-right">Post-Money Valuation</th>
                    <th className="p-4 text-right">Shares Issued</th>
                    <th className="p-4 text-right">Share Price (PPS)</th>
                    <th className="p-4">Lead Investor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {valuations.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="p-8 text-center text-slate-400 font-medium">
                        No valuation rounds recorded. Click &quot;Issue New Shares&quot; or &quot;Set Fair Market Valuation&quot;.
                      </td>
                    </tr>
                  ) : (
                    valuations.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-4 font-bold text-slate-900 text-sm">{v.roundName}</td>
                        <td className="p-4 text-slate-500">
                          {new Date(v.effectiveDate).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="p-4 text-right font-semibold">
                          {currency}{Number(v.preMoneyValuation || 0).toLocaleString()}
                        </td>
                        <td className="p-4 text-right font-bold text-emerald-700">
                          {currency}{Number(v.investmentAmount || 0).toLocaleString()}
                        </td>
                        <td className="p-4 text-right font-black text-purple-800 text-sm">
                          {currency}{Number(v.postMoneyValuation || 0).toLocaleString()}
                        </td>
                        <td className="p-4 text-right font-bold text-indigo-900">
                          {Number(v.newSharesIssued || 0).toLocaleString()}
                        </td>
                        <td className="p-4 text-right font-black text-slate-900">
                          {currency}{Number(v.sharePrice || 100).toLocaleString()}
                        </td>
                        <td className="p-4 font-semibold text-slate-600">{v.leadInvestor || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: ADVANCED LOAN & DEBT HUB */}
      {/* ========================================== */}
      {activeTab === "loans" && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Debt &amp; Loan Facilities</h2>
              <p className="text-xs text-slate-400">
                Amortized bank term loans, working capital credit lines, and interest expense accounting.
              </p>
            </div>
            <button
              onClick={() => setShowAddLoanModal(true)}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
            >
              + Register New Loan / Debt
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liabilities.length === 0 ? (
              <div className="col-span-full bg-white p-12 text-center text-slate-400 font-medium rounded-3xl border border-slate-200">
                No active loans or external debt facilities registered.
              </div>
            ) : (
              liabilities.map((loan) => {
                const principal = Number(loan.principalAmount || 0);
                const outstanding = Number(loan.outstandingBalance || 0);
                const principalPaid = Number(loan.principalPaid || (principal - outstanding) || 0);
                const interestPaid = Number(loan.interestPaid || 0);
                const progressPct = principal > 0 ? Math.min(100, Math.round((principalPaid / principal) * 100)) : 0;

                return (
                  <div
                    key={loan.id}
                    className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                          {loan.loanType || loan.type}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            loan.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {loan.status}
                        </span>
                      </div>

                      <h3 className="text-base font-black text-slate-900 mt-2">{loan.investorName}</h3>
                      <p className="text-[11px] text-slate-400">{loan.contactPhone || loan.contactEmail}</p>

                      <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Principal</p>
                          <p className="font-bold text-slate-900 mt-0.5">{currency}{principal.toLocaleString()}</p>
                        </div>
                        <div className="p-2.5 bg-rose-50 rounded-xl">
                          <p className="text-[10px] font-bold text-rose-500 uppercase">Outstanding</p>
                          <p className="font-black text-rose-700 mt-0.5">{currency}{outstanding.toLocaleString()}</p>
                        </div>
                        <div className="p-2.5 bg-slate-50 rounded-xl">
                          <p className="text-[10px] font-bold text-slate-400 uppercase">Interest APR</p>
                          <p className="font-bold text-slate-900 mt-0.5">{loan.interestRate}% / yr</p>
                        </div>
                        <div className="p-2.5 bg-emerald-50 rounded-xl">
                          <p className="text-[10px] font-bold text-emerald-600 uppercase">Monthly EMI</p>
                          <p className="font-bold text-emerald-800 mt-0.5">
                            {currency}{Number(loan.monthlyInstallment || 0).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {/* Repayment Progress */}
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-[11px] mb-1 font-semibold text-slate-500">
                          <span>Principal Repaid: {progressPct}%</span>
                          <span>{currency}{principalPaid.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full rounded-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          ></div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Interest Paid to Date: <span className="font-bold text-slate-700">{currency}{interestPaid.toLocaleString()}</span>
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleViewSchedule(loan)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                      >
                        📅 View Schedule
                      </button>

                      {loan.status === "ACTIVE" && outstanding > 0 && (
                        <button
                          onClick={() => {
                            setSelectedLoan(loan);
                            setRepayForm({
                              repaymentAmount: loan.monthlyInstallment || "",
                              principalPortion: "",
                              interestPortion: "",
                              fromAccountId: accounts.length > 0 ? accounts[0].id : "",
                              notes: "",
                            });
                            setShowRepayLoanModal(true);
                          }}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
                        >
                          💸 Repay Loan / EMI
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 4: SHARE TRANSACTION AUDIT LOG */}
      {/* ========================================== */}
      {activeTab === "transactions" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-base font-black text-slate-900">Equity &amp; Share Transaction Audit Ledger</h2>
            <p className="text-xs text-slate-400">
              Immutable historical log of all primary issuances, secondary personal share sales, transfers, and company share buybacks.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                  <th className="p-4">Date</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">From (Seller)</th>
                  <th className="p-4">To (Buyer)</th>
                  <th className="p-4 text-right">Shares</th>
                  <th className="p-4 text-right">Price / Share</th>
                  <th className="p-4 text-right">Total Amount</th>
                  <th className="p-4 text-right">Equity %</th>
                  <th className="p-4">Settlement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {shareTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-slate-400 font-medium">
                      No share transactions logged yet.
                    </td>
                  </tr>
                ) : (
                  shareTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 text-slate-500 font-medium">
                        {new Date(tx.date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                            tx.transactionType === "PRIMARY_ISSUANCE"
                              ? "bg-purple-50 text-purple-800 border border-purple-200"
                              : tx.transactionType === "SECONDARY_TRANSFER"
                              ? "bg-indigo-50 text-indigo-800 border border-indigo-200"
                              : "bg-rose-50 text-rose-800 border border-rose-200"
                          }`}
                        >
                          {tx.transactionType}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-slate-900">{tx.fromPartnerName || "Company Treasury (New)"}</td>
                      <td className="p-4 font-semibold text-slate-900">{tx.toPartnerName || "Company Buyback"}</td>
                      <td className="p-4 text-right font-black text-indigo-900 text-sm">
                        {Number(tx.shareCount || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-bold text-slate-800">
                        {currency}{Number(tx.sharePrice || 100).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-black text-emerald-700 text-sm">
                        {currency}{Number(tx.totalAmount || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-bold text-purple-700">
                        {Number(tx.equityPercentageTransferred || 0).toFixed(2)}%
                      </td>
                      <td className="p-4 text-slate-500 font-medium">{tx.settlementType}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 1: PRIMARY SHARE ISSUANCE */}
      {/* ========================================== */}
      {showIssueSharesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">Issue New Company Shares (Primary Issuance)</h3>
                <p className="text-xs text-slate-400">
                  Inject new investment capital, issue newly created shares, and dilute existing stakeholders pro-rata.
                </p>
              </div>
              <button
                onClick={() => setShowIssueSharesModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleIssueShares} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Investor / Entity Full Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Kathmandu Seed Capital"
                    value={issueForm.investorName}
                    onChange={(e) => setIssueForm({ ...issueForm, investorName: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Investor Email *</label>
                  <input
                    type="email"
                    placeholder="investor@vc.com"
                    value={issueForm.email}
                    onChange={(e) => setIssueForm({ ...issueForm, email: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Round Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Seed Round"
                    value={issueForm.roundName}
                    onChange={(e) => setIssueForm({ ...issueForm, roundName: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Investor Role</label>
                  <select
                    value={issueForm.role}
                    onChange={(e) => setIssueForm({ ...issueForm, role: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                  >
                    <option value="ANGEL_INVESTOR">Angel Investor</option>
                    <option value="INSTITUTIONAL_INVESTOR">Institutional / VC Fund</option>
                    <option value="PARTNER">Strategic Partner</option>
                    <option value="CO_FOUNDER">Co-Founder</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Contact Phone</label>
                  <input
                    type="text"
                    placeholder="98XXXXXXXX"
                    value={issueForm.phone}
                    onChange={(e) => setIssueForm({ ...issueForm, phone: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
              </div>

              {/* VALUATION & INVESTMENT INPUTS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                <div>
                  <label className="font-black text-purple-900 block mb-1">
                    Pre-Money Valuation ({currency}) *
                  </label>
                  <input
                    type="number"
                    placeholder="10000000"
                    value={issueForm.preMoneyValuation}
                    onChange={(e) => setIssueForm({ ...issueForm, preMoneyValuation: e.target.value })}
                    className="w-full p-3 bg-white border border-purple-200 rounded-xl outline-hidden focus:border-purple-600 font-black text-sm"
                    required
                  />
                  <span className="text-[10px] text-purple-700 mt-1 block">Company value prior to new investment</span>
                </div>

                <div>
                  <label className="font-black text-purple-900 block mb-1">
                    New Investment Inflow ({currency}) *
                  </label>
                  <input
                    type="number"
                    placeholder="2500000"
                    value={issueForm.investmentAmount}
                    onChange={(e) => setIssueForm({ ...issueForm, investmentAmount: e.target.value })}
                    className="w-full p-3 bg-white border border-purple-200 rounded-xl outline-hidden focus:border-purple-600 font-black text-sm"
                    required
                  />
                  <span className="text-[10px] text-purple-700 mt-1 block">Cash injected into company treasury</span>
                </div>
              </div>

              {/* LIVE SIMULATION PREVIEW */}
              {simPreVal > 0 && simInvAmt > 0 && (
                <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300">
                      Live VC Deal Simulation
                    </span>
                    <span className="text-xs font-black text-emerald-400">
                      Post-Money: {currency}{simPostVal.toLocaleString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-slate-800 rounded-xl">
                      <p className="text-[10px] text-slate-400">Share Price (PPS)</p>
                      <p className="font-black text-slate-200">{currency}{simSharePrice}</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded-xl">
                      <p className="text-[10px] text-slate-400">New Shares Issued</p>
                      <p className="font-black text-indigo-300">+{simNewShares.toLocaleString()}</p>
                    </div>
                    <div className="p-2 bg-slate-800 rounded-xl">
                      <p className="text-[10px] text-slate-400">Investor Stake</p>
                      <p className="font-black text-emerald-400">{simInvestorPct}%</p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Deposit Investment Into Treasury Account (Capital Inflow)
                </label>
                <select
                  value={issueForm.depositAccountId}
                  onChange={(e) => setIssueForm({ ...issueForm, depositAccountId: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                >
                  <option value="">Do not auto-credit treasury balance</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} (Current Balance: {currency}{Number(a.currentBalance).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Term Sheet / Round Notes</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Seed round priced at Rs 10M pre-money valuation with 1 board seat."
                  value={issueForm.notes}
                  onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIssueSharesModal(false)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-xl shadow-xs"
                >
                  Confirm &amp; Issue Primary Shares
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 2: SECONDARY SHARE TRANSFER / SALE / BUYBACK */}
      {/* ========================================== */}
      {showTransferSharesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">Secondary Share Transfer / Personal Share Sale</h3>
                <p className="text-xs text-slate-400">
                  Transfer existing personal shares between investors or execute a Company Share Buyback.
                </p>
              </div>
              <button
                onClick={() => setShowTransferSharesModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleTransferShares} className="space-y-4 mt-4 text-xs">
              {/* TRANSACTION TYPE TOGGLE */}
              <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setTransferForm({ ...transferForm, transferType: "PEER_TO_PEER" })}
                  className={`py-2 rounded-xl font-bold transition-all ${
                    transferForm.transferType === "PEER_TO_PEER"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  🤝 Peer-to-Peer Transfer (Investor to Investor)
                </button>
                <button
                  type="button"
                  onClick={() => setTransferForm({ ...transferForm, transferType: "COMPANY_BUYBACK" })}
                  className={`py-2 rounded-xl font-bold transition-all ${
                    transferForm.transferType === "COMPANY_BUYBACK"
                      ? "bg-white text-rose-700 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  🏢 Company Share Buyback (Retire Shares)
                </button>
              </div>

              {/* SELLER SELECT */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Selling Stakeholder (Seller) *</label>
                <select
                  value={transferForm.sellerPartnerId}
                  onChange={(e) => setTransferForm({ ...transferForm, sellerPartnerId: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  required
                >
                  <option value="">Select seller stakeholder...</option>
                  {capTable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partnerName} ({p.role}) — {Number(p.shareCount).toLocaleString()} Shares Available ({p.ownershipPercentage}%)
                    </option>
                  ))}
                </select>
                {selectedSeller && (
                  <span className="text-[11px] text-indigo-700 font-semibold mt-1 block">
                    Available: {Number(selectedSeller.shareCount).toLocaleString()} shares ({selectedSeller.ownershipPercentage}% equity)
                  </span>
                )}
              </div>

              {/* SHARES AND PRICE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Shares to Sell / Transfer *</label>
                  <input
                    type="number"
                    placeholder="1000"
                    value={transferForm.sharesToTransfer}
                    onChange={(e) => setTransferForm({ ...transferForm, sharesToTransfer: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-black text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Agreed Price Per Share ({currency})</label>
                  <input
                    type="number"
                    placeholder="100"
                    value={transferForm.sharePrice}
                    onChange={(e) => setTransferForm({ ...transferForm, sharePrice: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Default FMV: {currency}{metrics.sharePrice}</span>
                </div>
              </div>

              {/* BUYER DETAILS IF PEER-TO-PEER */}
              {transferForm.transferType === "PEER_TO_PEER" && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">Purchaser / Buyer Type</span>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                        <input
                          type="radio"
                          name="buyerType"
                          checked={transferForm.buyerType === "EXISTING_PARTNER"}
                          onChange={() => setTransferForm({ ...transferForm, buyerType: "EXISTING_PARTNER" })}
                        />
                        Existing Partner
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                        <input
                          type="radio"
                          name="buyerType"
                          checked={transferForm.buyerType === "NEW_INVESTOR"}
                          onChange={() => setTransferForm({ ...transferForm, buyerType: "NEW_INVESTOR" })}
                        />
                        New Incoming Investor
                      </label>
                    </div>
                  </div>

                  {transferForm.buyerType === "EXISTING_PARTNER" ? (
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Select Buyer Partner *</label>
                      <select
                        value={transferForm.buyerPartnerId}
                        onChange={(e) => setTransferForm({ ...transferForm, buyerPartnerId: e.target.value })}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                        required
                      >
                        <option value="">Select buyer partner...</option>
                        {capTable
                          .filter((p) => p.id !== transferForm.sellerPartnerId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.partnerName} ({p.role}) — Currently holds {Number(p.shareCount).toLocaleString()} Shares
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">New Investor Name *</label>
                        <input
                          type="text"
                          placeholder="e.g. Jane Doe"
                          value={transferForm.buyerName}
                          onChange={(e) => setTransferForm({ ...transferForm, buyerName: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                          required
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">New Investor Email *</label>
                        <input
                          type="email"
                          placeholder="jane@example.com"
                          value={transferForm.buyerEmail}
                          onChange={(e) => setTransferForm({ ...transferForm, buyerEmail: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* COMPANY BUYBACK SOLVENCY CHECK */}
              {transferForm.transferType === "COMPANY_BUYBACK" && (
                <div className="p-4 bg-rose-50/70 rounded-2xl border border-rose-200/80 space-y-3">
                  <div>
                    <label className="font-black text-rose-900 block mb-1">
                      Pay Seller From Company Treasury Account (Capital Outflow)
                    </label>
                    <select
                      value={transferForm.fromTreasuryAccountId}
                      onChange={(e) => setTransferForm({ ...transferForm, fromTreasuryAccountId: e.target.value })}
                      className="w-full p-3 bg-white border border-rose-200 rounded-xl outline-hidden focus:border-rose-600 font-bold"
                      required
                    >
                      <option value="">Select Treasury account to fund buyback...</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountName} (Available Balance: {currency}{Number(a.currentBalance).toLocaleString()})
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-rose-700 mt-1">
                      ⚠️ Solvency Check: The system will verify that sufficient liquid capital exists before retiring shares.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 block mb-1">Transfer Agreement Notes</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Secondary share purchase agreement executed on mutual consent."
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTransferSharesModal(false)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-xs"
                >
                  Execute Share Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 3: AMORTIZATION SCHEDULE */}
      {/* ========================================== */}
      {showAmortizationModal && selectedLoan && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">Loan Amortization Schedule</h3>
                <p className="text-xs text-slate-400">
                  {selectedLoan.investorName} — Principal {currency}{Number(selectedLoan.principalAmount).toLocaleString()} at {selectedLoan.interestRate}% APR
                </p>
              </div>
              <button
                onClick={() => setShowAmortizationModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto mt-4 max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200">
                    <th className="p-3"># Month</th>
                    <th className="p-3">Due Date</th>
                    <th className="p-3 text-right">Total EMI</th>
                    <th className="p-3 text-right">Principal</th>
                    <th className="p-3 text-right">Interest</th>
                    <th className="p-3 text-right">Remaining Principal</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {selectedLoanSchedule.map((s) => (
                    <tr key={s.monthNumber} className="hover:bg-slate-50/60">
                      <td className="p-3 font-bold text-slate-900">Month {s.monthNumber}</td>
                      <td className="p-3 text-slate-500">{s.dueDate}</td>
                      <td className="p-3 text-right font-black text-emerald-700">{currency}{s.emi.toLocaleString()}</td>
                      <td className="p-3 text-right font-bold text-slate-900">{currency}{s.principalPortion.toLocaleString()}</td>
                      <td className="p-3 text-right font-semibold text-rose-600">{currency}{s.interestPortion.toLocaleString()}</td>
                      <td className="p-3 text-right font-bold text-slate-600">{currency}{s.remainingPrincipal.toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            s.status === "PAID" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={() => setShowAmortizationModal(false)}
                className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl"
              >
                Close Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 4: ADD PARTNER */}
      {/* ========================================== */}
      {showAddPartnerModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">
                {editingPartner ? "Edit Stakeholder" : "Add Business Partner / Founder"}
              </h3>
              <button onClick={() => setShowAddPartnerModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSavePartner} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Sudeep Subedi"
                  value={partnerForm.partnerName}
                  onChange={(e) => setPartnerForm({ ...partnerForm, partnerName: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Email *</label>
                  <input
                    type="email"
                    placeholder="partner@example.com"
                    value={partnerForm.email}
                    onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                    required
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Role</label>
                  <select
                    value={partnerForm.role}
                    onChange={(e) => setPartnerForm({ ...partnerForm, role: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  >
                    <option value="FOUNDER">Founder</option>
                    <option value="CO_FOUNDER">Co-Founder</option>
                    <option value="PARTNER">Operating Partner</option>
                    <option value="ANGEL_INVESTOR">Angel Investor</option>
                    <option value="INSTITUTIONAL_INVESTOR">Institutional Investor</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Initial Capital ({currency})</label>
                  <input
                    type="number"
                    placeholder="500000"
                    value={partnerForm.initialCapital}
                    onChange={(e) => setPartnerForm({ ...partnerForm, initialCapital: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Equity Stake (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="50.0"
                    value={partnerForm.ownershipPercentage}
                    onChange={(e) => setPartnerForm({ ...partnerForm, ownershipPercentage: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-black text-purple-700"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddPartnerModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800"
                >
                  Save Stakeholder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 5: ADD LOAN / DEBT */}
      {/* ========================================== */}
      {showAddLoanModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Register Loan / Debt Facility</h3>
              <button onClick={() => setShowAddLoanModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSaveLoan} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Lender / Financial Institution *</label>
                <input
                  type="text"
                  placeholder="e.g. Nabil Bank Term Loan"
                  value={loanForm.investorName}
                  onChange={(e) => setLoanForm({ ...loanForm, investorName: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Loan Type</label>
                  <select
                    value={loanForm.loanType}
                    onChange={(e) => setLoanForm({ ...loanForm, loanType: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                  >
                    <option value="TERM_LOAN">Bank Term Loan</option>
                    <option value="WORKING_CAPITAL">Working Capital</option>
                    <option value="REVOLVING_CREDIT">Revolving Credit Line</option>
                    <option value="PROMISSORY_NOTE">Promissory Note</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Principal ({currency}) *</label>
                  <input
                    type="number"
                    placeholder="1000000"
                    value={loanForm.principalAmount}
                    onChange={(e) => setLoanForm({ ...loanForm, principalAmount: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-black text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Interest Rate (% APR)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="11.5"
                    value={loanForm.interestRate}
                    onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Tenor (Months)</label>
                  <input
                    type="number"
                    placeholder="12"
                    value={loanForm.loanTermMonths}
                    onChange={(e) => setLoanForm({ ...loanForm, loanTermMonths: e.target.value })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  />
                </div>
              </div>

              <NepaliDatePicker
                label="Loan Start Date"
                value={loanForm.startDate}
                onChange={(startDate) => setLoanForm({ ...loanForm, startDate })}
                calendars={calendarYears}
              />

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Disburse Principal Into Treasury Account (Capital Inflow)
                </label>
                <select
                  value={loanForm.depositAccountId}
                  onChange={(e) => setLoanForm({ ...loanForm, depositAccountId: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                >
                  <option value="">Do not credit treasury balance</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} (Balance: {currency}{Number(a.currentBalance).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddLoanModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!calendarReady}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Register Loan Facility
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 6: REPAY LOAN */}
      {/* ========================================== */}
      {showRepayLoanModal && selectedLoan && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Record Loan Repayment / EMI</h3>
              <button onClick={() => setShowRepayLoanModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleRepayLoan} className="space-y-4 mt-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                <p className="font-bold text-slate-900">{selectedLoan.investorName}</p>
                <p className="text-slate-500">
                  Outstanding Balance: <span className="font-black text-rose-700">{currency}{Number(selectedLoan.outstandingBalance).toLocaleString()}</span>
                </p>
                <p className="text-[10px] text-slate-400">Monthly EMI: {currency}{Number(selectedLoan.monthlyInstallment || 0).toLocaleString()}</p>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Repayment Amount ({currency}) *</label>
                <input
                  type="number"
                  value={repayForm.repaymentAmount}
                  onChange={(e) => setRepayForm({ ...repayForm, repaymentAmount: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-black text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Principal Portion</label>
                  <input
                    type="number"
                    placeholder="Auto-calculated"
                    value={repayForm.principalPortion}
                    onChange={(e) => setRepayForm({ ...repayForm, principalPortion: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Interest Expense Portion</label>
                  <input
                    type="number"
                    placeholder="Auto-calculated"
                    value={repayForm.interestPortion}
                    onChange={(e) => setRepayForm({ ...repayForm, interestPortion: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="font-black text-rose-900 block mb-1">
                  Deduct From Treasury Account (Capital Solvency Guard) *
                </label>
                <select
                  value={repayForm.fromAccountId}
                  onChange={(e) => setRepayForm({ ...repayForm, fromAccountId: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  required
                >
                  <option value="">Select Treasury account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} (Balance: {currency}{Number(a.currentBalance).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRepayLoanModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Confirm Repayment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 7: SET FAIR MARKET VALUATION */}
      {/* ========================================== */}
      {showValuationModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Set Fair Market Valuation (FMV)</h3>
              <button onClick={() => setShowValuationModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleUpdateValuation} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Valuation Round / Milestone *</label>
                <input
                  type="text"
                  placeholder="e.g. FY 2082/2083 Annual 409A Valuation"
                  value={valuationForm.roundName}
                  onChange={(e) => setValuationForm({ ...valuationForm, roundName: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-bold"
                  required
                />
              </div>

              <div>
                <label className="font-black text-purple-900 block mb-1">Company Valuation ({currency}) *</label>
                <input
                  type="number"
                  placeholder="15000000"
                  value={valuationForm.valuationAmount}
                  onChange={(e) => setValuationForm({ ...valuationForm, valuationAmount: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-black text-sm"
                  required
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Will recalibrate share price across all {Number(metrics.totalIssuedShares || 100000).toLocaleString()} issued shares.
                </span>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Valuation Methodology</label>
                <select
                  value={valuationForm.valuationMethod}
                  onChange={(e) => setValuationForm({ ...valuationForm, valuationMethod: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900 font-semibold"
                >
                  <option value="EQUITY_ROUND">Priced Equity Round Benchmark</option>
                  <option value="DCF">Discounted Cash Flow (DCF)</option>
                  <option value="MULTIPLE">Revenue / GMV Multiple</option>
                  <option value="BOOK_VALUE">Net Asset Book Value</option>
                  <option value="MANUAL_REVALUATION">Manual Board Revaluation</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Valuation Rationale &amp; Notes</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Valuation based on 2.5x annualized Net Revenue."
                  value={valuationForm.notes}
                  onChange={(e) => setValuationForm({ ...valuationForm, notes: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-900"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowValuationModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800"
                >
                  Save Valuation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL 8: PROFIT DISTRIBUTION */}
      {/* ========================================== */}
      {showDistributeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Run Profit Dividend Engine</h3>
              <button onClick={() => setShowDistributeModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleProfitDistribution} className="space-y-4 mt-4 text-xs">
              <NepaliDatePicker
                label="Period Start"
                value={distForm.periodStart}
                onChange={(periodStart) => setDistForm({ ...distForm, periodStart })}
                calendars={calendarYears}
              />
              <NepaliDatePicker
                label="Period End"
                value={distForm.periodEnd}
                onChange={(periodEnd) => setDistForm({ ...distForm, periodEnd })}
                calendars={calendarYears}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Fiscal Year</label>
                  <input
                    type="text"
                    value={distForm.fiscalYear}
                    onChange={(e) => setDistForm({ ...distForm, fiscalYear: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Retained Earnings (% Reinvested)</label>
                  <input
                    type="number"
                    value={distForm.retainedEarningsPercentage}
                    onChange={(e) => setDistForm({ ...distForm, retainedEarningsPercentage: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
                <input
                  type="checkbox"
                  id="execPayout"
                  checked={distForm.executePayout}
                  onChange={(e) => setDistForm({ ...distForm, executePayout: e.target.checked })}
                  className="w-4 h-4 rounded-md accent-emerald-600 cursor-pointer"
                />
                <label htmlFor="execPayout" className="cursor-pointer">
                  <span className="font-bold text-slate-900 block">Execute Instant Bank/Cash Dividend Payout</span>
                  <span className="text-[10px] text-slate-400">Deducts funds directly from liquid treasury account.</span>
                </label>
              </div>

              {distForm.executePayout && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Disburse From Treasury Account *</label>
                  <select
                    value={distForm.fromAccountId}
                    onChange={(e) => setDistForm({ ...distForm, fromAccountId: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                    required
                  >
                    <option value="">Select Treasury account...</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName} ({currency}{Number(a.currentBalance).toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDistributeModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!calendarReady}
                  className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700"
                >
                  Calculate &amp; Execute
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnershipEquity;
