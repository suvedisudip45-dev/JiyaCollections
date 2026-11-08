/* eslint-disable react/prop-types */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { X } from "lucide-react";
import { backendUrl } from "../App";

const PAGE_SIZE = 25;
const BANK_TEXT_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’&()-]*$/u;
const BANK_ACCOUNT_NUMBER_PATTERN = /^\d+$/;
const money = (value) => Number(value || 0).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kathmanduDateInput = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const defaultStartDate = () => {
  const today = kathmanduDateInput(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 6)).toISOString().slice(0, 10);
};
const formatDeliveredAt = (value) => value
  ? new Date(value).toLocaleString("en-NP", { timeZone: "Asia/Kathmandu", dateStyle: "medium", timeStyle: "short" })
  : "—";

const NcmSettlementBatchManager = ({ token, onClose, onSettled }) => {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(() => kathmanduDateInput(new Date()));
  const [candidates, setCandidates] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState("request");
  const [accounts, setAccounts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [financialAccountId, setFinancialAccountId] = useState("");
  const [actualDeposit, setActualDeposit] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [varianceType, setVarianceType] = useState("DISCOUNT_OR_PROMOTION");
  const [varianceReason, setVarianceReason] = useState("");
  const [bankDetails, setBankDetails] = useState({ bankName: "", bankAccountName: "", bankAccountNumber: "" });
  const [resolutionBatchId, setResolutionBatchId] = useState("");
  const [resolutionDraft, setResolutionDraft] = useState(null);

  const selected = useMemo(() => [...selectedRows.values()], [selectedRows]);
  const totals = useMemo(() => selected.reduce((sum, row) => ({
    cod: sum.cod + Number(row.codAmount || 0),
    fee: sum.fee + Number(row.carrierFee || 0),
    net: sum.net + Number(row.calculatedNetDeposit || 0),
  }), { cod: 0, fee: 0, net: 0 }), [selected]);
  const variance = Number((Number(actualDeposit || 0) - totals.net).toFixed(2));
  const allCurrentPageSelected = candidates.length > 0 && candidates.every((row) => selectedRows.has(row.id));
  const requestAlreadySent = selected.some((row) => row.ncmTicketId != null || row.settlementState === "REQUESTED");
  const bankNameValid = BANK_TEXT_PATTERN.test(bankDetails.bankName.trim()) && bankDetails.bankName.trim().length <= 191;
  const bankAccountNameValid = BANK_TEXT_PATTERN.test(bankDetails.bankAccountName.trim()) && bankDetails.bankAccountName.trim().length <= 191;
  const bankAccountNumberValid = BANK_ACCOUNT_NUMBER_PATTERN.test(bankDetails.bankAccountNumber.trim()) && bankDetails.bankAccountNumber.trim().length <= 64;
  const bankDetailsValid = bankNameValid && bankAccountNameValid && bankAccountNumberValid;

  const loadCandidates = useCallback(async (page = 1, clearSelection = false) => {
    if (!startDate || !endDate) {
      toast.error("Choose both dates for the delivered-order period.");
      return;
    }
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/admin/settlements/candidates`, {
        headers: { token },
        params: { startDate, endDate, page, limit: PAGE_SIZE },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load delivered orders.");
      setCandidates(response.data.candidates || []);
      setPagination(response.data.pagination || null);
      if (clearSelection) setSelectedRows(new Map());
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load delivered orders.");
      setCandidates([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, token]);

  const loadHistoryAndAccounts = useCallback(async () => {
    const [batchResult, accountResult] = await Promise.allSettled([
      axios.get(`${backendUrl}/api/delivery/admin/settlements/batches`, { headers: { token } }),
      axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
    ]);
    if (batchResult.status === "fulfilled" && batchResult.value.data?.success) {
      setBatches(batchResult.value.data.batches || []);
    } else {
      const error = batchResult.status === "rejected" ? batchResult.reason : null;
      toast.error(error?.response?.data?.message || "Unable to load NCM settlement history.");
    }
    if (accountResult.status === "fulfilled" && accountResult.value.data?.success) {
      const available = accountResult.value.data.accounts || [];
      setAccounts(available);
      setFinancialAccountId((current) => current || available[0]?.id || "");
    } else {
      const error = accountResult.status === "rejected" ? accountResult.reason : null;
      toast.error(error?.response?.data?.message || "Unable to load treasury accounts.");
    }
  }, [token]);

  useEffect(() => {
    loadCandidates(1);
    loadHistoryAndAccounts();
  }, [loadCandidates, loadHistoryAndAccounts]);

  useEffect(() => {
    setSelectedRows(new Map());
  }, [startDate, endDate]);

  const toggleRow = (row) => {
    setSelectedRows((current) => {
      const next = new Map(current);
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size < 100) next.set(row.id, row);
      else toast.warning("Select no more than 100 deliveries in one settlement batch.");
      return next;
    });
  };

  const toggleCurrentPage = () => {
    setSelectedRows((current) => {
      const next = new Map(current);
      if (allCurrentPageSelected) {
        candidates.forEach((row) => next.delete(row.id));
      } else {
        for (const row of candidates) {
          if (next.size >= 100) break;
          next.set(row.id, row);
        }
      }
      return next;
    });
  };

  const submitRequest = async () => {
    if (!selected.length || selected.length > 100) return toast.error("Select between 1 and 100 delivered orders.");
    if (requestAlreadySent) return toast.error("Some selected orders already have an NCM settlement ticket.");
    if (!bankNameValid) return toast.error("Enter a bank name using text only.");
    if (!bankAccountNameValid) return toast.error("Enter an account holder name using text only.");
    if (!bankAccountNumberValid) return toast.error("Enter a bank account number using digits only.");
    setSubmitting(true);
    try {
      const response = await axios.post(`${backendUrl}/api/delivery/admin/settlements/request`, {
        ...bankDetails,
        settlementIds: selected.map((row) => row.id),
        startDate,
        endDate,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "NCM settlement request failed.");
      toast.success(`NCM settlement request ${response.data.ticketId ? `#${response.data.ticketId} ` : ""}submitted for ${response.data.selectedCount} deliveries.`);
      setSelectedRows(new Map());
      await Promise.all([loadCandidates(pagination?.page || 1), loadHistoryAndAccounts()]);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM settlement request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitConfirmation = async () => {
    if (!selected.length || selected.length > 100) return toast.error("Select between 1 and 100 delivered orders.");
    if (!financialAccountId) return toast.error("Select the treasury account that received the NCM transfer.");
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(actualDeposit)) return toast.error("Enter the actual NCM deposit to the nearest paisa.");
    if (variance !== 0 && !varianceReason.trim()) return toast.error("Explain the difference between the calculated and actual NCM deposit.");
    const ticketIds = [...new Set(selected.map((row) => row.ncmTicketId).filter((id) => id != null))];
    setSubmitting(true);
    try {
      const response = await axios.post(`${backendUrl}/api/delivery/admin/settlements/confirm`, {
        settlementIds: selected.map((row) => row.id),
        financialAccountId,
        actualNetDeposit: actualDeposit,
        reference,
        notes,
        varianceType: variance !== 0 ? varianceType : null,
        varianceReason: variance !== 0 ? varianceReason.trim() : null,
        startDate,
        endDate,
        ncmTicketId: ticketIds.length === 1 ? ticketIds[0] : null,
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "NCM settlement confirmation failed.");
      toast.success(response.data.message || "NCM settlement batch recorded.");
      setSelectedRows(new Map());
      setActualDeposit("");
      setReference("");
      setNotes("");
      setVarianceReason("");
      await Promise.all([loadCandidates(pagination?.page || 1), loadHistoryAndAccounts()]);
      onSettled?.();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM settlement confirmation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const openResolution = (batch) => {
    const remaining = Number(batch.remainingVarianceAmount ?? Math.abs(Number(batch.varianceAmount)));
    const action = Number(batch.varianceAmount) < 0 ? "COLLECT_SHORTFALL" : "APPLY_OVERPAYMENT";
    setResolutionBatchId(batch.id);
    setResolutionDraft({
      action,
      amount: remaining.toFixed(2),
      reference: "",
      notes: "",
      idempotencyKey: globalThis.crypto?.randomUUID?.() || `ncm-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });
  };

  const submitVarianceResolution = async (batch) => {
    if (!resolutionDraft) return;
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(resolutionDraft.amount) || Number(resolutionDraft.amount) <= 0) {
      return toast.error("Enter a positive resolution amount with up to two decimal places.");
    }
    if (!resolutionDraft.reference.trim() || !resolutionDraft.notes.trim()) {
      return toast.error("Add the bank/payment reference and explain the resolution.");
    }
    if (resolutionDraft.action !== "APPLY_OVERPAYMENT" && !financialAccountId) {
      return toast.error("Select the treasury account used for the NCM payment.");
    }
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/settlements/batches/${batch.id}/resolve`,
        {
          ...resolutionDraft,
          financialAccountId: resolutionDraft.action === "APPLY_OVERPAYMENT" ? null : financialAccountId,
        },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "NCM variance resolution failed.");
      toast.success(response.data.message || "NCM variance resolution recorded.");
      setResolutionBatchId("");
      setResolutionDraft(null);
      await loadHistoryAndAccounts();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "NCM variance resolution failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="ncm-settlement-title">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="ncm-settlement-title" className="text-lg font-semibold text-slate-900">Bulk NCM COD settlement</h2>
            <p className="mt-1 text-sm text-slate-500">Manually select delivered orders by delivery date. One batch covers all selected orders, not individual products.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
            <label className="text-xs font-semibold text-slate-600">Delivered from<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600">Through<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" /></label>
            <button type="button" onClick={() => loadCandidates(1, true)} disabled={loading || !startDate || !endDate} className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loading ? "Loading…" : "Load deliveries"}</button>
            <div className="ml-auto text-sm text-slate-600">Selected <strong>{selected.length}</strong> · Expected net <strong>NPR {money(totals.net)}</strong></div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[850px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-3"><input type="checkbox" checked={allCurrentPageSelected} onChange={toggleCurrentPage} aria-label="Select current page" /></th>
                  <th className="px-3 py-3">Delivered</th>
                  <th className="px-3 py-3">Order / NCM ID</th>
                  <th className="px-3 py-3 text-right">COD</th>
                  <th className="px-3 py-3 text-right">Carrier fee</th>
                  <th className="px-3 py-3 text-right">Calculated net</th>
                  <th className="px-3 py-3">NCM request</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && <tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">Loading eligible NCM deliveries…</td></tr>}
                {!loading && candidates.length === 0 && <tr><td colSpan="7" className="px-3 py-8 text-center text-slate-500">No unsettled delivered NCM orders in this period.</td></tr>}
                {!loading && candidates.map((row) => (
                  <tr key={row.id} className={selectedRows.has(row.id) ? "bg-indigo-50/60" : ""}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRow(row)} aria-label={`Select order ${row.orderId}`} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs">{formatDeliveredAt(row.deliveredAt)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.orderId}<span className="mt-1 block text-slate-500">NCM #{row.ncmOrderId}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">NPR {money(row.codAmount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">NPR {money(row.carrierFee)}</td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">NPR {money(row.calculatedNetDeposit)}</td>
                    <td className="px-3 py-3 text-xs">{row.ncmTicketId ? `Ticket #${row.ncmTicketId}` : row.settlementState}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>{pagination?.total || 0} eligible delivered orders · up to 100 per batch</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => loadCandidates(Math.max(1, (pagination?.page || 1) - 1))} disabled={loading || !pagination || pagination.page <= 1} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button>
                <span>Page {pagination?.page || 1} of {pagination?.pages || 1}</span>
                <button type="button" onClick={() => loadCandidates((pagination?.page || 1) + 1)} disabled={loading || !pagination || pagination.page >= pagination.pages} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>

          <div className="flex gap-2 border-b border-slate-200">
            <button type="button" onClick={() => setAction("request")} className={`px-3 py-2 text-sm font-medium ${action === "request" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500"}`}>Request NCM transfer</button>
            <button type="button" onClick={() => setAction("confirm")} className={`px-3 py-2 text-sm font-medium ${action === "confirm" ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500"}`}>Record received settlement</button>
          </div>

          {action === "request" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">Bank name
                <input required value={bankDetails.bankName} maxLength={191} onChange={(event) => setBankDetails((current) => ({ ...current, bankName: event.target.value }))} aria-invalid={!bankNameValid} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
                {!bankNameValid && <span className="mt-1 block font-normal text-rose-600">{bankDetails.bankName.trim() ? "Use text only (letters, spaces, and common punctuation)." : "Required."}</span>}
              </label>
              <label className="text-xs font-semibold text-slate-600">Account holder
                <input required value={bankDetails.bankAccountName} maxLength={191} onChange={(event) => setBankDetails((current) => ({ ...current, bankAccountName: event.target.value }))} aria-invalid={!bankAccountNameValid} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
                {!bankAccountNameValid && <span className="mt-1 block font-normal text-rose-600">{bankDetails.bankAccountName.trim() ? "Use text only (letters, spaces, and common punctuation)." : "Required."}</span>}
              </label>
              <label className="text-xs font-semibold text-slate-600">Account number
                <input required type="text" inputMode="numeric" pattern="[0-9]*" maxLength={64} value={bankDetails.bankAccountNumber} onChange={(event) => setBankDetails((current) => ({ ...current, bankAccountNumber: event.target.value }))} aria-invalid={!bankAccountNumberValid} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
                {!bankAccountNumberValid && <span className="mt-1 block font-normal text-rose-600">{bankDetails.bankAccountNumber.trim() ? "Use digits only." : "Required."}</span>}
              </label>
              <div className="flex items-end sm:col-span-3">
                <button type="button" onClick={submitRequest} disabled={submitting || !selected.length || requestAlreadySent || !bankDetailsValid} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Requesting…" : `Request NCM settlement for ${selected.length} selected`}</button>
              </div>
              {requestAlreadySent && <p className="text-xs text-amber-700 sm:col-span-3">A selected delivery already has an NCM settlement request; record its received settlement instead.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-semibold text-slate-600">Deposit received into
                  <select value={financialAccountId} onChange={(event) => setFinancialAccountId(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">Select treasury account</option>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.accountName} · {account.accountType}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Actual NCM deposit (NPR)
                  <input type="number" min="0.01" step="0.01" value={actualDeposit} onChange={(event) => setActualDeposit(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Bank reference
                  <input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Variance type
                  <select value={varianceType} onChange={(event) => setVarianceType(event.target.value)} disabled={variance === 0} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
                    <option value="DISCOUNT_OR_PROMOTION">Discount / promotion</option>
                    <option value="PENALTY_OR_FINE">Penalty / fine</option>
                    <option value="OTHER">Other NCM adjustment</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Notes
                  <input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Explain variance {variance !== 0 ? "(required)" : "(only needed for a difference)"}
                  <input value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} disabled={variance === 0} placeholder="e.g. NCM statement deduction for campaign offer" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm">
                <div>Calculated net: <strong>NPR {money(totals.net)}</strong> · Actual: <strong>NPR {money(actualDeposit)}</strong> · Difference: <strong className={variance < 0 ? "text-rose-700" : "text-emerald-700"}>{variance < 0 ? "−" : "+"} NPR {money(Math.abs(variance))}</strong></div>
                <button type="button" onClick={submitConfirmation} disabled={submitting || !selected.length || !financialAccountId || !actualDeposit} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Recording…" : `Record one batch for ${selected.length} deliveries`}</button>
              </div>
              <p className="text-xs text-slate-500">A difference is posted to NCM suspense for follow-up; it is not automatically written off as an expense or income.</p>
            </div>
          )}

          <section className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">Recent NCM remittance batches</h3>
            {batches.length === 0 ? <p className="text-xs text-slate-500">No remittance batches have been recorded.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-[850px] w-full text-left text-xs">
                  <thead className="text-slate-500"><tr><th className="py-2">Settled</th><th>Deliveries</th><th className="text-right">Expected</th><th className="text-right">Received</th><th className="text-right">Difference</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((batch) => {
                      const remaining = Number(batch.remainingVarianceAmount ?? Math.abs(Number(batch.varianceAmount)));
                      const hasOpenVariance = remaining > 0;
                      return (
                        <Fragment key={batch.id}>
                          <tr key={batch.id}>
                            <td className="py-2">{formatDeliveredAt(batch.settledAt)}</td>
                            <td>{batch._count?.items || 0}</td>
                            <td className="text-right">NPR {money(batch.expectedNetDeposit)}</td>
                            <td className="text-right">NPR {money(batch.actualNetDeposit)}</td>
                            <td className="text-right">NPR {money(batch.varianceAmount)}</td>
                            <td>
                              {hasOpenVariance
                                ? `${batch.status === "VARIANCE_PARTIALLY_RESOLVED" ? "Partially resolved" : "Open"} · NPR ${money(remaining)}`
                                : Number(batch.varianceAmount) === 0 ? "Matched" : "Resolved"}
                            </td>
                          </tr>
                          {batch.varianceResolutions?.map((resolution) => (
                            <tr key={resolution.id} className="bg-slate-50 text-slate-600">
                              <td className="py-2 pl-4" colSpan={2}>{resolution.action.replace(/_/g, " ")} · {formatDeliveredAt(resolution.createdAt)}</td>
                              <td className="text-right">NPR {money(resolution.amount)}</td>
                              <td colSpan={2}>{resolution.reference || "No reference"} · Journal {resolution.journalEntryId}</td>
                              <td>{resolution.cashTransactionId ? `Cash ${resolution.cashTransactionId}` : "Applied to open COD"}</td>
                            </tr>
                          ))}
                          {batch.varianceResolutions?.map((resolution) => (
                            <tr key={`${resolution.id}-notes`} className="bg-slate-50 text-slate-500">
                              <td colSpan={6} className="pb-2 pl-4">{resolution.notes}</td>
                            </tr>
                          ))}
                          {hasOpenVariance && (
                            <tr key={`${batch.id}-resolve`}>
                              <td colSpan={6} className="py-2">
                                {resolutionBatchId === batch.id && resolutionDraft ? (
                                  <div className="grid gap-2 rounded-md bg-amber-50 p-3 sm:grid-cols-2 lg:grid-cols-6">
                                    <label className="text-xs font-semibold text-slate-600">Action
                                      {Number(batch.varianceAmount) > 0 ? (
                                        <select value={resolutionDraft.action} onChange={(event) => setResolutionDraft((current) => ({ ...current, action: event.target.value, idempotencyKey: globalThis.crypto?.randomUUID?.() || `ncm-${Date.now()}-${Math.random().toString(16).slice(2)}` }))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2">
                                          <option value="APPLY_OVERPAYMENT">Apply to open NCM COD</option>
                                          <option value="REFUND_OVERPAYMENT">Refund NCM</option>
                                        </select>
                                      ) : <span className="mt-1 block rounded-md border border-slate-200 bg-white px-2 py-2">Collect shortfall</span>}
                                    </label>
                                    <label className="text-xs font-semibold text-slate-600">Amount (NPR)
                                      <input value={resolutionDraft.amount} onChange={(event) => setResolutionDraft((current) => ({ ...current, amount: event.target.value }))} inputMode="decimal" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" />
                                    </label>
                                    {resolutionDraft.action !== "APPLY_OVERPAYMENT" && (
                                      <label className="text-xs font-semibold text-slate-600">Treasury account
                                        <select value={financialAccountId} onChange={(event) => setFinancialAccountId(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2">
                                          <option value="">Select account</option>
                                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                                        </select>
                                      </label>
                                    )}
                                    <label className="text-xs font-semibold text-slate-600">Payment reference
                                      <input value={resolutionDraft.reference} onChange={(event) => setResolutionDraft((current) => ({ ...current, reference: event.target.value }))} maxLength={191} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" />
                                    </label>
                                    <label className="text-xs font-semibold text-slate-600 lg:col-span-2">Reason / evidence note
                                      <input value={resolutionDraft.notes} onChange={(event) => setResolutionDraft((current) => ({ ...current, notes: event.target.value }))} maxLength={2000} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" />
                                    </label>
                                    <div className="flex items-end gap-2">
                                      <button type="button" onClick={() => submitVarianceResolution(batch)} disabled={submitting} className="rounded-md bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{submitting ? "Recording…" : "Record resolution"}</button>
                                      <button type="button" onClick={() => { setResolutionBatchId(""); setResolutionDraft(null); }} className="rounded-md border border-slate-300 px-3 py-2">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => openResolution(batch)} className="text-left font-semibold text-indigo-700 hover:underline">
                                    Resolve remaining variance · NPR {money(remaining)}
                                  </button>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default NcmSettlementBatchManager;
