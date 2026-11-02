/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import { backendUrl, currency } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

// The admin route provides this shared authentication prop.
// eslint-disable-next-line react/prop-types
const TaxCompliance = ({ token }) => {
  const today = new Date();
  const todayInputDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  const [taxData, setTaxData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vatVersions, setVatVersions] = useState([]);
  const [sellerTaxProfile, setSellerTaxProfile] = useState({ legalName: "", panNumber: "", address: "" });
  const [taxRegistrationVersions, setTaxRegistrationVersions] = useState([]);
  const [currentTaxStatus, setCurrentTaxStatus] = useState("PAN_ONLY");
  const [registrationStatus, setRegistrationStatus] = useState("VAT_REGISTERED");
  const [registrationVatNumber, setRegistrationVatNumber] = useState("");
  const [registrationEffectiveDate, setRegistrationEffectiveDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [savingSellerProfile, setSavingSellerProfile] = useState(false);
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [vatFilings, setVatFilings] = useState([]);
  const [salesInvoices, setSalesInvoices] = useState([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState([]);
  const [filingDraft, setFilingDraft] = useState(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      periodKey: month,
      periodStart: `${month}-01`,
      periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    };
  });
  const [filingSubmission, setFilingSubmission] = useState({ id: "", assessedAmount: "", filedReference: "", adjustmentReason: "" });
  const [vatPayment, setVatPayment] = useState({ filingId: "", amount: "", paymentReference: "", treasuryAccountId: "", paymentDate: new Date().toISOString().slice(0, 10) });
  const [paperBill, setPaperBill] = useState({ invoiceId: "", invoiceNumber: "", issueDate: new Date().toISOString().slice(0, 10), evidenceUrl: "" });
  const [paperBillBooks, setPaperBillBooks] = useState([]);
  const [paperBillDistributors, setPaperBillDistributors] = useState([]);
  const [paperBillReport, setPaperBillReport] = useState([]);
  const [paperBillReportFrom, setPaperBillReportFrom] = useState(`${todayInputDate.slice(0, 7)}-01`);
  const [paperBillReportTo, setPaperBillReportTo] = useState(todayInputDate);
  const [paperBillReportPreset, setPaperBillReportPreset] = useState("MONTH");
  const [paperBillReportFilter, setPaperBillReportFilter] = useState("ALL");
  const [paperBillReportLoading, setPaperBillReportLoading] = useState(false);
  const [paperBillReportPagination, setPaperBillReportPagination] = useState(null);
  const [paperBillReportPage, setPaperBillReportPage] = useState(1);
  const [paperBillBookDraft, setPaperBillBookDraft] = useState({
    documentType: "PAN_BILL",
    bookLabel: "",
    seriesPrefix: "",
    startNumber: "",
    endNumber: "",
    serialWidth: "0",
  });
  const [paperBillAllocationDraft, setPaperBillAllocationDraft] = useState({
    bookId: "",
    distributorId: "",
    startNumber: "",
    endNumber: "",
    notes: "",
  });
  const [savingTaxAction, setSavingTaxAction] = useState(false);
  const [vatRate, setVatRate] = useState("13");
  const [vatEffectiveDate, setVatEffectiveDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [savingVatRate, setSavingVatRate] = useState(false);
  const { canAny } = usePermissions();
  const canConfigureVat = canAny(["finance:tax_configure"]);
  const canViewStorefrontOrders = canAny(["order:control", "order:list_all"]);
  const canViewAdminOrders = canAny(["order:control", "order:list_admin"]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchTaxReport = useCallback(async (month) => {
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
  }, [token]);

  const fetchVatVersions = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/finance/vat-rates`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Failed to load VAT rate history.");
      setVatVersions(response.data.versions || []);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Failed to load VAT rate history.");
    }
  }, [token]);

  const fetchSellerTaxProfile = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/finance/tax-profile`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Failed to load seller tax details.");
      setSellerTaxProfile({
        legalName: response.data.profile?.legalName || "",
        panNumber: response.data.profile?.panNumber || "",
        address: response.data.profile?.address || "",
      });
      setTaxRegistrationVersions(response.data.registrations || []);
      setCurrentTaxStatus(response.data.currentRegistration?.taxStatus || "PAN_ONLY");
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Failed to load seller tax details.");
    }
  }, [token]);

  const fetchTaxRecords = useCallback(async () => {
    try {
      const [filingResponse, invoiceResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/finance/tax-filings`, { headers: { token } }),
        axios.get(`${backendUrl}/api/finance/sales-invoices`, { headers: { token } }),
      ]);
      if (!filingResponse.data?.success || !invoiceResponse.data?.success) {
        throw new Error("One or more tax filing or sales bill records could not be loaded.");
      }
      setVatFilings(filingResponse.data.records || []);
      setSalesInvoices(invoiceResponse.data.records || []);
      const treasuryResponse = await axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } });
      if (!treasuryResponse.data?.success) throw new Error(treasuryResponse.data?.message || "Treasury accounts could not be loaded.");
      const accounts = (treasuryResponse.data.accounts || []).filter((account) =>
        account.status === "ACTIVE" &&
        account.currency === "NPR" &&
        ["1110", "1120"].includes(account.accountingAccount?.accountCode)
      );
      setTreasuryAccounts(accounts);
      setVatPayment((current) => ({
        ...current,
        treasuryAccountId: accounts.some((account) => account.id === current.treasuryAccountId)
          ? current.treasuryAccountId
          : accounts[0]?.id || "",
      }));
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Failed to load tax records.");
    }
  }, [token]);

  const fetchPaperBillBooks = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/finance/paper-bill-books`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Paper bill books could not be loaded.");
      setPaperBillBooks(response.data.books || []);
      setPaperBillDistributors(response.data.distributors || []);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Paper bill books could not be loaded.");
    }
  }, [token]);

  const fetchPaperBillReport = useCallback(async (page = 1) => {
    try {
      setPaperBillReportLoading(true);
      const params = new URLSearchParams({
        from: paperBillReportFrom,
        to: paperBillReportTo,
        billFilter: paperBillReportFilter,
        page: String(page),
      });
      const response = await axios.get(`${backendUrl}/api/finance/paper-bill-orders?${params}`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Paper bill order report could not be loaded.");
      setPaperBillReport(response.data.records || []);
      setPaperBillReportPagination(response.data.pagination || null);
      setPaperBillReportPage(response.data.pagination?.page || page);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Paper bill order report could not be loaded.");
    } finally {
      setPaperBillReportLoading(false);
    }
  }, [paperBillReportFilter, paperBillReportFrom, paperBillReportTo, token]);

  const applyPaperBillReportPreset = (preset) => {
    const now = new Date();
    const kathmanduDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kathmandu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const [year, month, day] = kathmanduDate.split("-").map(Number);
    const end = new Date(Date.UTC(year, month - 1, day));
    const start = new Date(end);
    if (preset === "WEEK") start.setUTCDate(start.getUTCDate() - 6);
    else if (preset === "MONTH") start.setUTCDate(1);
    else if (["THREE_MONTHS", "SIX_MONTHS", "YEAR"].includes(preset)) {
      const monthsBack = preset === "THREE_MONTHS" ? 3 : preset === "SIX_MONTHS" ? 6 : 12;
      const targetMonth = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
      const targetLastDay = new Date(Date.UTC(
        targetMonth.getUTCFullYear(),
        targetMonth.getUTCMonth() + 1,
        0,
      )).getUTCDate();
      start.setUTCFullYear(
        targetMonth.getUTCFullYear(),
        targetMonth.getUTCMonth(),
        Math.min(day, targetLastDay),
      );
    }
    const toInput = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    setPaperBillReportFrom(toInput(start));
    setPaperBillReportTo(toInput(end));
    setPaperBillReportPreset(preset);
  };

  const createFilingDraft = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/tax-filings`, {
        ...filingDraft,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "VAT return draft could not be prepared.");
      toast.success(response.data.message || "VAT return draft prepared.");
      await fetchTaxRecords();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "VAT return draft could not be prepared.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const submitVatFiling = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/tax-filings/${filingSubmission.id}/file`, {
        assessedAmount: filingSubmission.assessedAmount,
        filedReference: filingSubmission.filedReference,
        adjustmentReason: filingSubmission.adjustmentReason,
        filedDate: new Date().toISOString(),
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "VAT filing could not be recorded.");
      toast.success(response.data.message || "VAT filing recorded.");
      setFilingSubmission({ id: "", assessedAmount: "", filedReference: "", adjustmentReason: "" });
      await fetchTaxRecords();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "VAT filing could not be recorded.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const submitVatPayment = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/tax-filings/${vatPayment.filingId}/payments`, {
        amount: vatPayment.amount,
        paymentReference: vatPayment.paymentReference,
        treasuryAccountId: vatPayment.treasuryAccountId,
        paymentDate: `${vatPayment.paymentDate}T12:00:00.000Z`,
        idempotencyKey: `VATPAY:${vatPayment.filingId}:${vatPayment.paymentReference.trim()}`,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "VAT payment could not be recorded.");
      toast.success(response.data.message || "VAT payment recorded.");
      setVatPayment((current) => ({ ...current, filingId: "", amount: "", paymentReference: "" }));
      await fetchTaxRecords();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "VAT payment could not be recorded.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const submitPaperBill = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/sales-invoices/${paperBill.invoiceId}/paper-issue`, {
        invoiceNumber: paperBill.invoiceNumber,
        issueDate: `${paperBill.issueDate}T12:00:00.000Z`,
        evidenceUrl: paperBill.evidenceUrl,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Paper bill details could not be recorded.");
      toast.success(response.data.message || "Paper bill details recorded.");
      setPaperBill({ invoiceId: "", invoiceNumber: "", issueDate: new Date().toISOString().slice(0, 10), evidenceUrl: "" });
      await fetchTaxRecords();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Paper bill details could not be recorded.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const submitPaperBillBook = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/paper-bill-books`, paperBillBookDraft, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Paper bill book could not be recorded.");
      toast.success(response.data.message || "Paper bill book recorded.");
      setPaperBillBookDraft((current) => ({ ...current, bookLabel: "", seriesPrefix: "", startNumber: "", endNumber: "" }));
      await fetchPaperBillBooks();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Paper bill book could not be recorded.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const submitPaperBillAllocation = async (event) => {
    event.preventDefault();
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/paper-bill-allocations`, paperBillAllocationDraft, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Bill range could not be allocated.");
      toast.success(response.data.message || "Bill range allocated.");
      setPaperBillAllocationDraft((current) => ({ ...current, startNumber: "", endNumber: "", notes: "" }));
      await fetchPaperBillBooks();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Bill range could not be allocated.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const returnPaperBillAllocation = async (allocationId) => {
    if (!window.confirm("Return the unused portion of this range? Issued bill numbers remain permanently reserved.")) return;
    try {
      setSavingTaxAction(true);
      const response = await axios.post(`${backendUrl}/api/finance/paper-bill-allocations/${allocationId}/return`, {}, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Bill range could not be returned.");
      toast.success(response.data.message || "Bill range marked as returned.");
      await fetchPaperBillBooks();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Bill range could not be returned.");
    } finally {
      setSavingTaxAction(false);
    }
  };

  const saveSellerTaxProfile = async (event) => {
    event.preventDefault();
    try {
      setSavingSellerProfile(true);
      const response = await axios.patch(`${backendUrl}/api/finance/tax-profile`, sellerTaxProfile, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Seller tax profile could not be saved.");
      toast.success(response.data.message || "Seller tax profile saved.");
      await fetchSellerTaxProfile();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Seller tax profile could not be saved.");
    } finally {
      setSavingSellerProfile(false);
    }
  };

  const scheduleTaxRegistration = async (event) => {
    event.preventDefault();
    try {
      setSavingRegistration(true);
      const response = await axios.post(`${backendUrl}/api/finance/tax-registration-versions`, {
        taxStatus: registrationStatus,
        vatNumber: registrationVatNumber,
        effectiveFrom: `${registrationEffectiveDate}T00:00:00+05:45`,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Tax registration change could not be scheduled.");
      toast.success(response.data.message || "Tax registration change scheduled.");
      await fetchSellerTaxProfile();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Tax registration change could not be scheduled.");
    } finally {
      setSavingRegistration(false);
    }
  };

  const cancelTaxRegistration = async (versionId) => {
    try {
      const response = await axios.post(`${backendUrl}/api/finance/tax-registration-versions/${versionId}/cancel`, {}, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Tax registration change could not be cancelled.");
      toast.success(response.data.message || "Tax registration change cancelled.");
      await fetchSellerTaxProfile();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Tax registration change could not be cancelled.");
    }
  };

  const scheduleVatRate = async (event) => {
    event.preventDefault();
    if (!vatEffectiveDate || !/^\d{1,3}(?:\.\d{1,2})?$/.test(vatRate)) {
      toast.error("Enter a valid VAT percentage and future effective date.");
      return;
    }
    try {
      setSavingVatRate(true);
      const response = await axios.post(`${backendUrl}/api/finance/vat-rates`, {
        vatRate,
        effectiveFrom: `${vatEffectiveDate}T00:00:00+05:45`,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "VAT rate could not be scheduled.");
      toast.success(response.data.message || "VAT rate scheduled.");
      await fetchVatVersions();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "VAT rate could not be scheduled.");
    } finally {
      setSavingVatRate(false);
    }
  };

  const cancelVatRate = async (versionId) => {
    try {
      const response = await axios.post(`${backendUrl}/api/finance/vat-rates/${versionId}/cancel`, {}, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Scheduled VAT rate could not be cancelled.");
      toast.success(response.data.message || "Scheduled VAT rate cancelled.");
      await fetchVatVersions();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Scheduled VAT rate could not be cancelled.");
    }
  };

  useEffect(() => {
    if (token) fetchTaxReport(selectedMonth);
  }, [fetchTaxReport, selectedMonth, token]);

  useEffect(() => {
    if (token) fetchVatVersions();
  }, [fetchVatVersions, token]);

  useEffect(() => {
    if (token) fetchSellerTaxProfile();
  }, [fetchSellerTaxProfile, token]);

  useEffect(() => {
    if (token) fetchTaxRecords();
  }, [fetchTaxRecords, token]);

  useEffect(() => {
    if (token) fetchPaperBillBooks();
  }, [fetchPaperBillBooks, token]);

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
            <span className="text-xs font-medium text-slate-400">Configured effective VAT rates &amp; CIT projection</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1">VAT &amp; Tax Reconciliation</h1>
          <p className="text-xs text-slate-500 mt-0.5">
          Effective-dated output VAT tracking, posted-ledger reconciliation, and corporate income tax projection.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="#physical-bill-allocation"
            className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900 hover:bg-sky-100"
          >
            Allocate physical bills
          </a>
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

      <section id="physical-bill-allocation" className="scroll-mt-6 rounded-2xl border-2 border-sky-200 bg-white p-6 shadow-xs">
        <div className="border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-sky-800">Paper bill workflow</p>
              <h2 className="mt-1 text-base font-bold text-slate-900">Allocate physical PAN/VAT bills to distributors</h2>
              <p className="mt-1 max-w-3xl text-xs text-slate-600">
                Use the serial numbers printed on your physical bill book. Register the book below, then assign the range you physically hand to a distributor. New ranges stay pending until the distributor confirms receipt in their portal, and cannot be used for orders before acceptance. This is separate from the business VAT registration number above.
              </p>
            </div>
            {!canConfigureVat && (
              <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
                Read-only: your Admin account needs the finance tax-configuration permission to register or allocate ranges.
              </span>
            )}
          </div>
        </div>
        {canConfigureVat && (
          <>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Step 1 — Register the physical bill book</h3>
              <p className="mt-1 text-xs text-slate-600">Enter its actual printed series prefix and first/last serial. Select VAT tax invoice for a VAT book, or PAN bill for a PAN book.</p>
              <form onSubmit={submitPaperBillBook} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
              <label className="text-xs font-semibold text-slate-700 lg:col-span-1">Bill type
                <select value={paperBillBookDraft.documentType} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, documentType: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="PAN_BILL">PAN bill</option>
                  <option value="VAT_TAX_INVOICE">VAT tax invoice</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Book label<input required maxLength={120} value={paperBillBookDraft.bookLabel} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, bookLabel: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Series prefix<input required maxLength={60} value={paperBillBookDraft.seriesPrefix} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, seriesPrefix: event.target.value }))} placeholder="e.g. 2083/" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">First serial<input type="number" min="1" required value={paperBillBookDraft.startNumber} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, startNumber: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Last serial<input type="number" min="1" required value={paperBillBookDraft.endNumber} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, endNumber: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Serial digits (0 = no padding)<input type="number" min="0" max="10" value={paperBillBookDraft.serialWidth} onChange={(event) => setPaperBillBookDraft((current) => ({ ...current, serialWidth: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <button type="submit" disabled={savingTaxAction} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 lg:col-span-6">{savingTaxAction ? "Saving..." : "Register physical bill book"}</button>
              </form>
            </div>

            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
              <h3 className="text-sm font-bold text-slate-900">Step 2 — Hand a serial range to a distributor</h3>
              <p className="mt-1 text-xs text-slate-600">Choose a registered book and distributor, then enter only the unused serial numbers physically issued to that distributor. The distributor must confirm receipt before the range becomes usable.</p>
              <form onSubmit={submitPaperBillAllocation} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <label className="text-xs font-semibold text-slate-700 lg:col-span-1">Book
                <select required value={paperBillAllocationDraft.bookId} onChange={(event) => {
                  const bookId = event.target.value;
                  const book = paperBillBooks.find((item) => item.id === bookId);
                  setPaperBillAllocationDraft((current) => ({
                    ...current,
                    bookId,
                    startNumber: book ? String(book.startNumber) : current.startNumber,
                    endNumber: book ? String(book.endNumber) : current.endNumber,
                  }));
                }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Select a book</option>
                  {paperBillBooks.filter((book) => book.status === "ACTIVE").map((book) => <option key={book.id} value={book.id}>{book.bookLabel} · {book.seriesPrefix}{book.startNumber}-{book.endNumber}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Distributor
                <select required value={paperBillAllocationDraft.distributorId} onChange={(event) => setPaperBillAllocationDraft((current) => ({ ...current, distributorId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Select a distributor</option>
                  {paperBillDistributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">First serial given to distributor<input type="number" min="1" required value={paperBillAllocationDraft.startNumber} onChange={(event) => setPaperBillAllocationDraft((current) => ({ ...current, startNumber: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Last serial given to distributor<input type="number" min="1" required value={paperBillAllocationDraft.endNumber} onChange={(event) => setPaperBillAllocationDraft((current) => ({ ...current, endNumber: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Note (optional)<input maxLength={500} value={paperBillAllocationDraft.notes} onChange={(event) => setPaperBillAllocationDraft((current) => ({ ...current, notes: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
              <button type="submit" disabled={savingTaxAction || paperBillBooks.length === 0 || paperBillDistributors.length === 0} className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 lg:col-span-5">{savingTaxAction ? "Saving..." : "Assign physical bills to distributor"}</button>
              </form>
            </div>
          </>
        )}
        <div className="mt-5 space-y-3">
          {paperBillBooks.map((book) => (
            <article key={book.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-900">{book.bookLabel} · {book.documentType === "VAT_TAX_INVOICE" ? "VAT tax invoice" : "PAN bill"}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Series {book.seriesPrefix}{book.startNumber}–{book.endNumber} · {book.status}</p>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Distributor</th><th className="py-2 pr-3">Allocated range</th><th className="py-2 pr-3">Assigned orders</th><th className="py-2 pr-3">Status</th>{canConfigureVat && <th className="py-2 text-right">Action</th>}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(book.allocations || []).map((allocation) => (
                      <tr key={allocation.id} className="text-slate-700">
                        <td className="py-2 pr-3">{allocation.distributor?.name || "Distributor"}</td>
                        <td className="py-2 pr-3">{book.seriesPrefix}{allocation.startNumber}–{allocation.endNumber}</td>
                        <td className="py-2 pr-3">{allocation._count?.assignments || 0}</td>
                        <td className="py-2 pr-3">
                          {allocation.status === "PENDING_ACCEPTANCE"
                            ? "Awaiting distributor receipt"
                            : allocation.status === "ACTIVE"
                              ? allocation.acceptedAt
                                ? `Accepted ${new Date(allocation.acceptedAt).toLocaleDateString()}`
                                : "Active (legacy allocation)"
                              : allocation.status}
                        </td>
                        {canConfigureVat && <td className="py-2 text-right">{["ACTIVE", "PENDING_ACCEPTANCE"].includes(allocation.status) && <button type="button" disabled={savingTaxAction} onClick={() => returnPaperBillAllocation(allocation.id)} className="font-semibold text-rose-700 disabled:opacity-50">Return unused range</button>}</td>}
                      </tr>
                    ))}
                    {(book.allocations || []).length === 0 && <tr><td colSpan={canConfigureVat ? 5 : 4} className="py-4 text-center text-slate-400">No distributor ranges allocated.</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
          {paperBillBooks.length === 0 && <p className="py-4 text-center text-xs text-slate-400">No physical bill books are registered.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Seller identity and PAN/VAT status</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              PAN-only is the safe default. Output VAT is posted only for transactions whose tax point falls inside an effective VAT-registration period.
            </p>
          </div>
          <span className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
            currentTaxStatus === "VAT_REGISTERED"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-slate-100 text-slate-700"
          }`}>
            Current: {currentTaxStatus === "VAT_REGISTERED" ? "VAT registered" : "PAN-only"}
          </span>
        </div>

        <form onSubmit={saveSellerTaxProfile} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">
            Legal seller name
            <input
              value={sellerTaxProfile.legalName}
              onChange={(event) => setSellerTaxProfile((current) => ({ ...current, legalName: event.target.value }))}
              maxLength={255}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              disabled={!canConfigureVat}
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            PAN number
            <input
              value={sellerTaxProfile.panNumber}
              onChange={(event) => setSellerTaxProfile((current) => ({ ...current, panNumber: event.target.value }))}
              maxLength={32}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              disabled={!canConfigureVat}
            />
          </label>
          <label className="text-xs font-semibold text-slate-700 md:col-span-2">
            Registered business address
            <textarea
              value={sellerTaxProfile.address}
              onChange={(event) => setSellerTaxProfile((current) => ({ ...current, address: event.target.value }))}
              maxLength={5000}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              disabled={!canConfigureVat}
            />
          </label>
          {canConfigureVat && (
            <div className="md:col-span-2">
              <button type="submit" disabled={savingSellerProfile} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {savingSellerProfile ? "Saving..." : "Save seller details"}
              </button>
            </div>
          )}
        </form>

        {canConfigureVat && (
          <form onSubmit={scheduleTaxRegistration} className="mt-5 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="text-xs font-semibold text-slate-700">
              Registration status
              <select value={registrationStatus} onChange={(event) => setRegistrationStatus(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="PAN_ONLY">PAN-only</option>
                <option value="VAT_REGISTERED">VAT registered</option>
              </select>
            </label>
            {registrationStatus === "VAT_REGISTERED" && (
              <label className="text-xs font-semibold text-slate-700">
                VAT registration number
                <input value={registrationVatNumber} onChange={(event) => setRegistrationVatNumber(event.target.value)} maxLength={32} required className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
            )}
            <label className="text-xs font-semibold text-slate-700">
              Effective from (UTC)
              <input type="date" value={registrationEffectiveDate} onChange={(event) => setRegistrationEffectiveDate(event.target.value)} required className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <button type="submit" disabled={savingRegistration} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {savingRegistration ? "Scheduling..." : "Schedule status"}
            </button>
          </form>
        )}

        {taxRegistrationVersions.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Tax status</th>
                  <th className="py-2 pr-4">VAT number</th>
                  <th className="py-2 pr-4">Effective from UTC</th>
                  <th className="py-2 pr-4">Effective until UTC</th>
                  <th className="py-2 pr-4">Version status</th>
                  {canConfigureVat && <th className="py-2 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxRegistrationVersions.map((version) => {
                  const isFuture = version.status === "ACTIVE" && new Date(version.effectiveFrom) > new Date();
                  return (
                    <tr key={version.id} className="text-slate-700">
                      <td className="py-3 pr-4 font-semibold">{version.taxStatus === "VAT_REGISTERED" ? "VAT registered" : "PAN-only"}</td>
                      <td className="py-3 pr-4">{version.vatNumber || "—"}</td>
                      <td className="py-3 pr-4">{new Date(version.effectiveFrom).toLocaleString("en-GB", { timeZone: "UTC" })}</td>
                      <td className="py-3 pr-4">{version.effectiveUntil ? new Date(version.effectiveUntil).toLocaleString("en-GB", { timeZone: "UTC" }) : "Open"}</td>
                      <td className="py-3 pr-4">{version.status}</td>
                      {canConfigureVat && <td className="py-3 text-right">{isFuture && <button type="button" onClick={() => cancelTaxRegistration(version.id)} className="font-semibold text-rose-700 hover:text-rose-900">Cancel change</button>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Effective-Dated VAT Rate History</h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              New rates apply only to transactions on or after their UTC effective date. Historical and effective rates are immutable; cancel only a future scheduled version.
            </p>
          </div>
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
            Confirm statutory rates with your accountant
          </span>
        </div>

        {canConfigureVat && (
          <form onSubmit={scheduleVatRate} className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-xs font-semibold text-slate-700">
              New VAT rate (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={vatRate}
                onChange={(event) => setVatRate(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Effective from (UTC)
              <input
                type="date"
                required
                value={vatEffectiveDate}
                onChange={(event) => setVatEffectiveDate(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={savingVatRate}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingVatRate ? "Scheduling..." : "Schedule rate"}
            </button>
          </form>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">Rate</th>
                <th className="py-2 pr-4 font-semibold">Effective from (UTC)</th>
                <th className="py-2 pr-4 font-semibold">Effective until (exclusive)</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                {canConfigureVat && <th className="py-2 text-right font-semibold">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vatVersions.map((version) => {
                const isFutureActive = version.status === "ACTIVE" && new Date(version.effectiveFrom) > new Date();
                return (
                  <tr key={version.id} className="text-slate-700">
                    <td className="py-3 pr-4 font-semibold">{Number(version.vatRate).toFixed(2)}%</td>
                    <td className="py-3 pr-4">{new Date(version.effectiveFrom).toLocaleString("en-GB", { timeZone: "UTC" })}</td>
                    <td className="py-3 pr-4">{version.effectiveUntil ? new Date(version.effectiveUntil).toLocaleString("en-GB", { timeZone: "UTC" }) : "Open"}</td>
                    <td className="py-3 pr-4">{version.status}</td>
                    {canConfigureVat && (
                      <td className="py-3 text-right">
                        {isFutureActive && (
                          <button
                            type="button"
                            onClick={() => cancelVatRate(version.id)}
                            className="font-semibold text-rose-700 hover:text-rose-900"
                          >
                            Cancel scheduled rate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {vatVersions.length === 0 && (
                <tr>
                  <td colSpan={canConfigureVat ? 5 : 4} className="py-6 text-center text-slate-400">
                    No rate versions scheduled. The current legacy tax configuration remains in effect.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900">Paper sales bills</h2>
          <p className="mt-1 text-xs text-slate-500">Delivered sales create an internal tax snapshot. Record the matching paper bill number and date after issuing the physical PAN bill or VAT tax invoice.</p>
        </div>
        {paperBill.invoiceId && canConfigureVat && (
          <form onSubmit={submitPaperBill} className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="text-xs font-semibold text-slate-700">Official paper bill number<input required value={paperBill.invoiceNumber} onChange={(event) => setPaperBill((current) => ({ ...current, invoiceNumber: event.target.value }))} maxLength={191} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Issue date<input type="date" required value={paperBill.issueDate} onChange={(event) => setPaperBill((current) => ({ ...current, issueDate: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Evidence URL (optional)<input value={paperBill.evidenceUrl} onChange={(event) => setPaperBill((current) => ({ ...current, evidenceUrl: event.target.value }))} maxLength={5000} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={savingTaxAction} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingTaxAction ? "Saving..." : "Record issued bill"}</button>
          </form>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">Order</th><th className="py-2 pr-4">Bill type</th><th className="py-2 pr-4">Tax point</th><th className="py-2 pr-4">Total</th><th className="py-2 pr-4">VAT</th><th className="py-2 pr-4">Paper number</th><th className="py-2 pr-4">Status</th>{canConfigureVat && <th className="py-2 text-right">Action</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {salesInvoices.map((invoice) => (
                <tr key={invoice.id} className="text-slate-700">
                  <td className="py-3 pr-4">{invoice.order?.orderReference || invoice.documentNumber}</td>
                  <td className="py-3 pr-4 font-semibold">{invoice.documentType === "VAT_TAX_INVOICE" ? "VAT tax invoice" : "PAN bill"}</td>
                  <td className="py-3 pr-4">{new Date(invoice.taxPoint).toLocaleDateString()}</td>
                  <td className="py-3 pr-4">{currency}{Number(invoice.totalAmount).toLocaleString()}</td>
                  <td className="py-3 pr-4">{currency}{Number(invoice.vatAmount).toLocaleString()}</td>
                  <td className="py-3 pr-4">{invoice.invoiceNumber || "Not recorded"}</td>
                  <td className="py-3 pr-4">{invoice.status}</td>
                  {canConfigureVat && <td className="py-3 text-right">{invoice.status === "PENDING_PAPER_DETAILS" && <button type="button" onClick={() => setPaperBill((current) => ({ ...current, invoiceId: invoice.id }))} className="font-semibold text-indigo-700 hover:text-indigo-900">Record paper bill</button>}</td>}
                </tr>
              ))}
              {salesInvoices.length === 0 && <tr><td colSpan={canConfigureVat ? 8 : 7} className="py-6 text-center text-slate-400">No delivered-sale bill snapshots are available.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900">Distributor order paper-bill report</h2>
          <p className="mt-1 text-xs text-slate-500">The report includes assigned and unassigned orders and uses Nepal-local order placement dates. Issued PAN/VAT bills require a recorded physical number; voided and credited bills remain identifiable as previously issued.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["DAY", "Today"],
            ["WEEK", "Last 7 days"],
            ["MONTH", "This month"],
            ["THREE_MONTHS", "Last 3 months"],
            ["SIX_MONTHS", "Last 6 months"],
            ["YEAR", "Last 1 year"],
          ].map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPaperBillReportPreset(preset)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                paperBillReportPreset === preset
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <label className="text-xs font-semibold text-slate-700">From<input type="date" value={paperBillReportFrom} onChange={(event) => { setPaperBillReportPreset("CUSTOM"); setPaperBillReportFrom(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700">To<input type="date" value={paperBillReportTo} onChange={(event) => { setPaperBillReportPreset("CUSTOM"); setPaperBillReportTo(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700">Orders
            <select value={paperBillReportFilter} onChange={(event) => setPaperBillReportFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="ALL">All orders</option>
              <option value="VAT_BILL">VAT bill issued</option>
              <option value="PAN_BILL">PAN bill issued</option>
              <option value="NO_BILL">No bill issued</option>
              <option value="VOIDED">Bill voided / reverted</option>
            </select>
          </label>
          <button type="button" onClick={() => fetchPaperBillReport(1)} disabled={paperBillReportLoading} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{paperBillReportLoading ? "Loading..." : "Load report"}</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Showing order dates {paperBillReportFrom} through {paperBillReportTo} (Nepal time). A bill counts as issued only when its type and physical number are recorded.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Order / placed</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Distributor</th><th className="py-2 pr-3">Physical bill</th><th className="py-2 pr-3">Bill number</th><th className="py-2 pr-3">Adjustment</th><th className="py-2 pr-3">Order status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {paperBillReport.map((record) => (
                <tr key={record.orderId} className="text-slate-700">
                  <td className="py-3 pr-3 font-semibold">{(record.orderType === "ADMIN_DIRECT" ? canViewAdminOrders : canViewStorefrontOrders) ? <Link to={`/orders/${encodeURIComponent(record.orderId)}?source=${record.orderType === "ADMIN_DIRECT" ? "admin" : "monitor"}`} className="text-indigo-700 hover:underline">{record.orderReference}</Link> : record.orderReference}<span className="mt-1 block text-[10px] font-normal text-slate-500">{new Date(record.orderDate).toLocaleDateString("en-GB", { timeZone: "Asia/Kathmandu" })}</span></td>
                  <td className="py-3 pr-3">{record.customerName || "—"}</td>
                  <td className="py-3 pr-3">{record.distributor?.name || "—"}</td>
                  <td className="py-3 pr-3">{record.billStatus === "VOIDED" ? "Bill voided / reverted" : record.billClassification === "VAT_BILL" ? "VAT bill issued" : record.billClassification === "PAN_BILL" ? "PAN bill issued" : record.billStatus === "NOT_SELECTED" ? "Choice not recorded" : "No bill issued"}<span className="mt-1 block text-[10px] text-slate-500">{record.salesInvoice?.status === "PAPER_BILL_TYPE_MISMATCH" ? "Tax registration mismatch — review required" : record.billStatus}</span></td>
                  <td className="py-3 pr-3 font-mono">{record.billNumber || "—"}</td>
                  <td className="py-3 pr-3">{[
                    ...(record.salesInvoice?.adjustments || []).map((item) => `${item.sourceType} ${item.status}${item.externalDocumentNumber ? ` · ${item.externalDocumentNumber}` : ""}`),
                    ...(record.returns || []).map((item) => `Return ${item.taxCreditNoteNumber || item.lifecycleStatus}`),
                    ...(record.exchanges || []).map((item) => `Exchange ${item.taxCreditNoteNumber || item.priceDifference || "same-value"}${item.replacementPaperBillNumber ? ` · replacement bill ${item.replacementPaperBillNumber}` : ""}`),
                    ...(record.billVoidReason ? [record.billVoidReason] : []),
                    ...(record.billAdjustmentReason ? [record.billAdjustmentReason] : []),
                  ].join("; ") || "—"}</td>
                  <td className="py-3 pr-3">{record.orderStatus}</td>
                </tr>
              ))}
              {paperBillReport.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">{paperBillReportLoading ? "Loading bill records..." : "No orders found for this period and bill filter."}</td></tr>}
            </tbody>
          </table>
        </div>
        {paperBillReportPagination?.total > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{paperBillReportPagination.total} matching order(s)</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={paperBillReportLoading || paperBillReportPage <= 1} onClick={() => fetchPaperBillReport(paperBillReportPage - 1)} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40">Previous</button>
              <span>Page {paperBillReportPage} of {paperBillReportPagination.totalPages}</span>
              <button type="button" disabled={paperBillReportLoading || paperBillReportPage >= paperBillReportPagination.totalPages} onClick={() => fetchPaperBillReport(paperBillReportPage + 1)} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900">VAT return filings and settlement</h2>
          <p className="mt-1 text-xs text-slate-500">Prepare a draft from posted journal data for the period assigned by IRD. Record the official assessed amount, filing reference, and each actual payment separately.</p>
        </div>
        {canConfigureVat && (
          <form onSubmit={createFilingDraft} className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="text-xs font-semibold text-slate-700">IRD period label<input required value={filingDraft.periodKey} onChange={(event) => setFilingDraft((current) => ({ ...current, periodKey: event.target.value }))} maxLength={64} placeholder="As assigned by IRD" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Period start<input type="date" required value={filingDraft.periodStart} onChange={(event) => setFilingDraft((current) => ({ ...current, periodStart: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Period end<input type="date" required value={filingDraft.periodEnd} onChange={(event) => setFilingDraft((current) => ({ ...current, periodEnd: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={savingTaxAction} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingTaxAction ? "Preparing..." : "Prepare VAT return draft"}</button>
          </form>
        )}
        {filingSubmission.id && canConfigureVat && (
          <form onSubmit={submitVatFiling} className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="text-xs font-semibold text-slate-700">IRD-assessed amount<input type="number" min="0" step="0.01" required value={filingSubmission.assessedAmount} onChange={(event) => setFilingSubmission((current) => ({ ...current, assessedAmount: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">IRD filing reference<input required value={filingSubmission.filedReference} onChange={(event) => setFilingSubmission((current) => ({ ...current, filedReference: event.target.value }))} maxLength={191} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700 lg:col-span-1">Reason if assessment differs<input value={filingSubmission.adjustmentReason} onChange={(event) => setFilingSubmission((current) => ({ ...current, adjustmentReason: event.target.value }))} maxLength={2000} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={savingTaxAction} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingTaxAction ? "Saving..." : "Record filed return"}</button>
          </form>
        )}
        {vatPayment.filingId && canConfigureVat && (
          <form onSubmit={submitVatPayment} className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <label className="text-xs font-semibold text-slate-700">Payment amount<input type="number" min="0.01" step="0.01" required value={vatPayment.amount} onChange={(event) => setVatPayment((current) => ({ ...current, amount: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Payment reference<input required value={vatPayment.paymentReference} onChange={(event) => setVatPayment((current) => ({ ...current, paymentReference: event.target.value }))} maxLength={191} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Paid from<select required value={vatPayment.treasuryAccountId} onChange={(event) => setVatPayment((current) => ({ ...current, treasuryAccountId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Select cash/bank</option>{treasuryAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountName} ({account.accountingAccount?.accountCode})</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700">Payment date<input type="date" required value={vatPayment.paymentDate} onChange={(event) => setVatPayment((current) => ({ ...current, paymentDate: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={savingTaxAction || !treasuryAccounts.length} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingTaxAction ? "Posting..." : "Record payment"}</button>
          </form>
        )}
        {canConfigureVat && treasuryAccounts.length === 0 && <p className="mt-3 text-xs text-amber-800">Map an active NPR cash or bank Treasury account to GL account 1110 or 1120 before recording a tax payment.</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">IRD period</th><th className="py-2 pr-4">Date range</th><th className="py-2 pr-4">Output VAT</th><th className="py-2 pr-4">Input VAT</th><th className="py-2 pr-4">Brought-forward credit</th><th className="py-2 pr-4">Ledger position</th><th className="py-2 pr-4">Assessed</th><th className="py-2 pr-4">Paid</th><th className="py-2 pr-4">Outstanding</th><th className="py-2 pr-4">Status</th>{canConfigureVat && <th className="py-2 text-right">Action</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {vatFilings.map((filing) => (
                <tr key={filing.id} className="text-slate-700">
                  <td className="py-3 pr-4 font-semibold">{filing.periodKey}</td>
                  <td className="py-3 pr-4">{filing.periodStart ? new Date(filing.periodStart).toLocaleDateString() : "—"} – {filing.periodEnd ? new Date(filing.periodEnd).toLocaleDateString() : "—"}</td>
                  <td className="py-3 pr-4">{currency}{Number(filing.outputVat).toLocaleString()}</td>
                  <td className="py-3 pr-4">{currency}{Number(filing.inputVat).toLocaleString()}</td>
                  <td className="py-3 pr-4" title={`Input VAT credit: ${currency}${Number(filing.carriedForwardInputVat).toLocaleString()} · Output VAT credit: ${currency}${Number(filing.carriedForwardOutputVat).toLocaleString()}`}>{currency}{(Number(filing.carriedForwardInputVat) + Number(filing.carriedForwardOutputVat)).toLocaleString()}</td>
                  <td className="py-3 pr-4">{currency}{Number(filing.netVatPayable).toLocaleString()}</td>
                  <td className="py-3 pr-4">{filing.assessedAmount === null ? "Not filed" : `${currency}${Number(filing.assessedAmount).toLocaleString()}`}</td>
                  <td className="py-3 pr-4">{currency}{Number(filing.taxPaid).toLocaleString()}</td>
                  <td className="py-3 pr-4">{filing.outstandingAmount === null ? "—" : `${currency}${Number(filing.outstandingAmount).toLocaleString()}`}</td>
                  <td className="py-3 pr-4">{filing.status}</td>
                  {canConfigureVat && <td className="py-3 text-right">{filing.status === "DRAFT" ? <button type="button" onClick={() => setFilingSubmission({ id: filing.id, assessedAmount: Math.max(Number(filing.netVatPayable), 0).toFixed(2), filedReference: "", adjustmentReason: "" })} className="font-semibold text-indigo-700 hover:text-indigo-900">Record filing</button> : Number(filing.outstandingAmount || 0) > 0 ? <button type="button" onClick={() => setVatPayment((current) => ({ ...current, filingId: filing.id, amount: filing.outstandingAmount }))} className="font-semibold text-indigo-700 hover:text-indigo-900">Record payment</button> : "Settled"}</td>}
                </tr>
              ))}
              {vatFilings.length === 0 && <tr><td colSpan={canConfigureVat ? 11 : 10} className="py-6 text-center text-slate-400">No VAT returns recorded.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-slate-500">The draft is a posted-ledger reconciliation, not an IRD return. Taxable purchase totals and complete invoice/credit-note registers are not yet generated; verify these, the filing period, and all submitted figures against IRD instructions and supporting documents before filing. Payment records post to VAT payable and the selected mapped cash/bank account.</p>
      </section>

      {/* MONTHLY VAT RECONCILER */}
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
