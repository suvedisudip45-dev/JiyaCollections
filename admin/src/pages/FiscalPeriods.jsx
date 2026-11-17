/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
import { formatNepaliDate, getNepaliMonthLength } from "../utils/nepaliDate";
import NepaliDatePicker from "../components/NepaliDatePicker";

const FiscalPeriods = ({ token }) => {
  const [fiscalYears, setFiscalYears] = useState([]);
  const [calendarYears, setCalendarYears] = useState([]);
  const [calendarReady, setCalendarReady] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [closeChecklist, setCloseChecklist] = useState([]);
  const [closeModal, setCloseModal] = useState(null);
  const [closeDraft, setCloseDraft] = useState([]);
  const [closeReason, setCloseReason] = useState("");
  const [savingCloseAction, setSavingCloseAction] = useState(false);
  const [downloadingClosePack, setDownloadingClosePack] = useState("");
  const initialBsDate = formatNepaliDate(new Date());
  const [initialYear, initialMonth] = initialBsDate.split("-").map(Number);
  const initialFiscalStartYear = initialMonth >= 4 ? initialYear : initialYear - 1;
  const [newFyForm, setNewFyForm] = useState({
    name: `FY ${initialFiscalStartYear}/${initialFiscalStartYear + 1}`,
    startDate: `${initialFiscalStartYear}-04-01`,
    endDate: `${initialFiscalStartYear + 1}-03-${String(getNepaliMonthLength(initialFiscalStartYear + 1, 3)).padStart(2, "0")}`,
  });

  const fetchFiscalYears = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/accounting/fiscal-years`, {
        headers: { token },
      });
      if (res.data.success) {
        setFiscalYears(res.data.fiscalYears || []);
      } else {
        toast.error(res.data.message || "Failed to load fiscal years");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Error fetching fiscal periods");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchFiscalYears();
  }, [fetchFiscalYears, token]);

  useEffect(() => {
    let active = true;
    if (!token) return () => { active = false; };
    axios.get(`${backendUrl}/api/accounting/period-close-checklist`, { headers: { token } })
      .then((response) => {
        if (!response.data?.success || !Array.isArray(response.data.checklist)) {
          throw new Error(response.data?.message || "Could not load the accounting close checklist.");
        }
        if (active) setCloseChecklist(response.data.checklist);
      })
      .catch((error) => {
        console.error("Load accounting close checklist error:", error);
        if (active) toast.error(error.response?.data?.message || error.message || "Could not load the accounting close checklist.");
      });
    return () => { active = false; };
  }, [token]);

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
        if (!active) return;
        const years = response.data.years || [];
        const currentDate = response.data.currentDate;
        const [year, month] = currentDate.split("-").map(Number);
        const startYear = month >= 4 ? year : year - 1;
        const endMonthLength = getNepaliMonthLength(startYear + 1, 3, years);
        setCalendarYears(years);
        setNewFyForm({
          name: `FY ${startYear}/${startYear + 1}`,
          startDate: `${startYear}-04-01`,
          endDate: `${startYear + 1}-03-${String(endMonthLength).padStart(2, "0")}`,
        });
        setCalendarReady(true);
      })
      .catch((error) => {
        console.error("Load configured fiscal calendar error:", error);
        if (active) {
          const message = error.response?.data?.message || error.message || "Could not load the configured Nepali calendar.";
          setCalendarError(message);
          toast.error(message);
        }
      });
    return () => { active = false; };
  }, [calendarRetry, token]);

  const downloadClosePack = async (period, fiscalYearName) => {
    setDownloadingClosePack(period.id);
    try {
      const response = await axios.get(
        `${backendUrl}/api/accounting/period-close/${period.id}/pack`,
        { headers: { token } },
      );
      if (!response.data?.success || !response.data.pack || !response.data.integrity?.contentHash) {
        throw new Error(response.data?.message || "The close pack was incomplete and could not be downloaded.");
      }

      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = `${fiscalYearName}-${period.periodName}`
        .replace(/[^A-Za-z0-9._-]/g, "-");
      link.href = blobUrl;
      link.download = `internal-close-pack-${filename}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      toast.success("Internal close pack downloaded with its SHA-256 content hash.");
    } catch (error) {
      console.error("Download accounting close pack error:", error);
      toast.error(error.response?.data?.message || error.message || "Unable to download the accounting close pack.");
    } finally {
      setDownloadingClosePack("");
    }
  };

  const handleCreateFiscalYear = async (e) => {
    e.preventDefault();
    if (!calendarReady) {
      toast.error("The configured Nepali calendar is not available.");
      return;
    }
    if (!newFyForm.name || !newFyForm.startDate || !newFyForm.endDate) {
      toast.warn("Fiscal Year Name, Start Date, and End Date are required.");
      return;
    }

    try {
      const res = await axios.post(
        `${backendUrl}/api/accounting/create-fiscal-year`,
        { ...newFyForm, calendar: "BS" },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || "Fiscal Year initialized successfully");
        setShowCreateModal(false);
        fetchFiscalYears();
      } else {
        toast.error(res.data.message || "Failed to create fiscal year");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Server error while creating fiscal year");
    }
  };

  const openPeriodClose = (period, action) => {
    setCloseReason("");
    setCloseDraft(closeChecklist.map((item) => ({
      ...item,
      status: "",
      evidenceReference: "",
      notes: "",
    })));
    setCloseModal({ period, action });
  };

  const updateCloseDraft = (key, field, value) => {
    setCloseDraft((current) => current.map((item) => (
      item.key === key ? { ...item, [field]: value } : item
    )));
  };

  const submitPeriodCloseAction = async (event, decision) => {
    event.preventDefault();
    if (!closeModal || savingCloseAction) return;
    setSavingCloseAction(true);
    const periodId = closeModal.period.id;
    try {
      const requestHeaders = { token, "Idempotency-Key": crypto.randomUUID() };
      let endpoint;
      let body;
      if (closeModal.action === "submit") {
        endpoint = "/period-close/submit";
        body = { periodId, checklist: closeDraft };
      } else if (closeModal.action === "review-close") {
        endpoint = "/period-close/review";
        body = { periodId, decision, reason: closeReason };
      } else if (closeModal.action === "request-reopen") {
        endpoint = "/period-close/reopen/request";
        body = { periodId, reason: closeReason };
      } else {
        endpoint = "/period-close/reopen/review";
        body = { periodId, decision, reason: closeReason };
      }

      const response = await axios.post(`${backendUrl}/api/accounting${endpoint}`, body, { headers: requestHeaders });
      if (!response.data?.success) throw new Error(response.data?.message || "The close action was not completed.");
      const decisionLabel = decision === "APPROVE" ? "approved" : "rejected";
      toast.success(
        closeModal.action === "submit" ? "Period close submitted for independent review."
          : closeModal.action === "review-close" ? `Period close ${decisionLabel}.`
            : closeModal.action === "request-reopen" ? "Period reopening submitted for independent review."
              : `Period reopening ${decisionLabel}.`
      );
      setCloseModal(null);
      await fetchFiscalYears();
    } catch (error) {
      console.error("Accounting period close action error:", error);
      toast.error(error.response?.data?.message || error.message || "Could not complete the period close action.");
    } finally {
      setSavingCloseAction(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Fiscal Years &amp; Period Control</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Audit Lock Governance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Establish annual fiscal reporting calendars and control accounting period locks to prevent unauthorized backdated journal postings
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchFiscalYears}
            className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!calendarReady}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center gap-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            New Fiscal Year
          </button>
        </div>
      </div>

      {/* Fiscal Years List */}
      <div className="space-y-6">
        {loading ? (
          <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-slate-200">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-2"></div>
            Loading fiscal periods...
          </div>
        ) : fiscalYears.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <p className="text-slate-500 text-sm font-medium">No fiscal years have been configured yet.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs"
            >
              Initialize First Fiscal Year
            </button>
          </div>
        ) : (
          fiscalYears.map((fy) => {
            const periods = fy.periods || [];
            const openPeriodsCount = periods.filter((p) => p.status === "OPEN").length;
            const closedPeriodsCount = periods.filter((p) => p.status === "CLOSED").length;

            return (
              <div key={fy.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                {/* Fiscal Year Top Header */}
                <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{fy.name}</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {fy.status || "ACTIVE"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Calendar Range (BS): {formatNepaliDate(fy.startDate, calendarYears)} — {formatNepaliDate(fy.endDate, calendarYears)}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {openPeriodsCount} Open Periods
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                      {closedPeriodsCount} Closed / Locked Periods
                    </span>
                  </div>
                </div>

                {/* 12 Monthly Accounting Periods Grid */}
                <div className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {periods.map((period) => {
                      const isOpen = period.status === "OPEN";
                      const closeEvents = period.closeEvents || [];
                      const latestCloseEvent = closeEvents[0];
                      const closePending = latestCloseEvent?.eventType === "CLOSE_SUBMITTED";
                      const reopenPending = latestCloseEvent?.eventType === "REOPEN_REQUESTED";
                      const canDownloadClosePack = period.status === "CLOSED" &&
                        ["CLOSE_APPROVED", "REOPEN_REJECTED"].includes(latestCloseEvent?.eventType);
                      const fiscalYearClosed = fy.status === "CLOSED";
                      const canSubmitClose = isOpen && !fiscalYearClosed && (!latestCloseEvent || ["CLOSE_REJECTED", "REOPEN_APPROVED"].includes(latestCloseEvent.eventType));
                      const canRequestReopen = !isOpen && ["CLOSE_APPROVED", "REOPEN_REJECTED"].includes(latestCloseEvent?.eventType);
                      const buttonLabel = closePending ? "Review Close"
                        : reopenPending ? "Review Reopen"
                          : canSubmitClose ? "Prepare Close"
                            : canRequestReopen ? "Request Reopen"
                              : null;
                      return (
                        <div
                          key={period.id}
                          className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                            isOpen
                              ? "bg-white border-slate-200 hover:border-emerald-300 shadow-xs"
                              : "bg-slate-50 border-slate-200 text-slate-400"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-slate-800">
                                {period.periodName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isOpen && !fiscalYearClosed
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {period.status === "OPEN" && fiscalYearClosed ? "FISCAL YEAR LOCKED" : period.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                              {period.startDate ? formatNepaliDate(period.startDate, calendarYears) : ""} — {period.endDate ? formatNepaliDate(period.endDate, calendarYears) : ""}
                            </p>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">
                              {isOpen && !fiscalYearClosed ? "Accepts Postings" : "Postings Locked"}
                            </span>
                            <div className="flex items-center gap-2">
                              {buttonLabel && (
                                <button
                                  type="button"
                                  disabled={savingCloseAction || (canSubmitClose && !closeChecklist.length)}
                                  onClick={() => openPeriodClose(
                                    period,
                                    closePending ? "review-close"
                                      : reopenPending ? "review-reopen"
                                        : canRequestReopen ? "request-reopen" : "submit"
                                  )}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {buttonLabel}
                                </button>
                              )}
                              {canDownloadClosePack && (
                                <button
                                  type="button"
                                  disabled={Boolean(downloadingClosePack)}
                                  onClick={() => downloadClosePack(period, fy.name)}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {downloadingClosePack === period.id ? "Preparing pack..." : "Download close pack"}
                                </button>
                              )}
                            </div>
                          </div>
                          {latestCloseEvent && (
                            <p className="text-[10px] text-slate-500">
                              Close workflow: {latestCloseEvent.eventType.replaceAll("_", " ")} by {latestCloseEvent.actorAccountId} ({latestCloseEvent.actorRole}) on {new Date(latestCloseEvent.createdAt).toLocaleString()}
                              {latestCloseEvent.reason ? ` — ${latestCloseEvent.reason}` : ""}
                            </p>
                          )}
                          {period.status === "CLOSED" && !latestCloseEvent && (
                            <p className="text-[10px] text-amber-700">Legacy locked period — approval evidence is not recorded; reopening is blocked.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {closeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {closeModal.action === "submit" ? "Prepare Period Close"
                    : closeModal.action === "review-close" ? "Review Period Close"
                      : closeModal.action === "request-reopen" ? "Request Period Reopen" : "Review Reopen Request"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {closeModal.period.periodName} · independent preparer/reviewer control · evidence references are stored with the audit snapshot
                </p>
              </div>
              <button type="button" onClick={() => setCloseModal(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close dialog">✕</button>
            </div>

            {closeModal.action === "submit" && (
              <form onSubmit={(event) => submitPeriodCloseAction(event)} className="space-y-4">
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Every applicable checklist item needs a source/evidence reference. Only payroll and foreign currency may be marked not applicable, with an explanation.
                </p>
                <div className="space-y-3">
                  {closeDraft.map((item) => (
                    <div key={item.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select
                          required
                          value={item.status}
                          onChange={(event) => updateCloseDraft(item.key, "status", event.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        >
                          <option value="">Select review status</option>
                          <option value="COMPLETE">Complete</option>
                          {item.mayBeNotApplicable && <option value="NOT_APPLICABLE">Not applicable</option>}
                        </select>
                        {item.status === "COMPLETE" && (
                          <input
                            required
                            maxLength={500}
                            value={item.evidenceReference}
                            onChange={(event) => updateCloseDraft(item.key, "evidenceReference", event.target.value)}
                            placeholder="Evidence reference / report ID"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          />
                        )}
                        {item.status === "NOT_APPLICABLE" && (
                          <input
                            required
                            maxLength={1000}
                            value={item.notes}
                            onChange={(event) => updateCloseDraft(item.key, "notes", event.target.value)}
                            placeholder="Explain why this is not applicable"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setCloseModal(null)} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button type="submit" disabled={savingCloseAction} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {savingCloseAction ? "Submitting..." : "Submit for Review"}
                  </button>
                </div>
              </form>
            )}

            {(closeModal.action === "review-close" || closeModal.action === "review-reopen") && (
              <form onSubmit={(event) => submitPeriodCloseAction(event, "APPROVE")} className="space-y-4">
                {closeModal.action === "review-reopen" && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    Request reason: {closeModal.period.closeEvents?.[0]?.reason || "No reason recorded"}
                  </p>
                )}
                {closeModal.action === "review-close" && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-800">Submitted close evidence</h3>
                    {(closeModal.period.closeEvents?.[0]?.checklistSnapshot?.items || []).map((item) => (
                      <div key={item.key} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span className="font-semibold">{item.label}: {item.status.replaceAll("_", " ")}</span>
                        {item.evidenceReference && <span className="block text-slate-600">Evidence: {item.evidenceReference}</span>}
                        {item.notes && <span className="block text-slate-600">Note: {item.notes}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <label className="block text-xs font-semibold text-slate-700">
                  Review note (required when rejecting)
                  <textarea
                    value={closeReason}
                    onChange={(event) => setCloseReason(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal"
                    placeholder="Record the decision context; a rejection requires a reason."
                  />
                </label>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setCloseModal(null)} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button type="button" disabled={savingCloseAction} onClick={(event) => submitPeriodCloseAction(event, "REJECT")} className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Reject</button>
                  <button type="submit" disabled={savingCloseAction} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button>
                </div>
              </form>
            )}

            {closeModal.action === "request-reopen" && (
              <form onSubmit={(event) => submitPeriodCloseAction(event)} className="space-y-4">
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Reopening is not effective until a different Admin reviews and approves the request.
                </p>
                <label className="block text-xs font-semibold text-slate-700">
                  Reopen reason *
                  <textarea required value={closeReason} onChange={(event) => setCloseReason(event.target.value)} maxLength={1000} rows={4} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal" />
                </label>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => setCloseModal(null)} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button type="submit" disabled={savingCloseAction} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Submit Reopen Request</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* New Fiscal Year Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Initialize New Fiscal Year</h2>
                <p className="text-[11px] text-slate-400">Creates calendar year and 12 monthly accounting sub-periods</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateFiscalYear} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Fiscal Year Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FY 2083/2084"
                  value={newFyForm.name}
                  onChange={(e) => setNewFyForm({ ...newFyForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NepaliDatePicker
                  label="Start Date"
                  value={newFyForm.startDate}
                  calendars={calendarYears}
                  onChange={(startDate) => setNewFyForm((current) => ({ ...current, startDate }))}
                />
                <NepaliDatePicker
                  label="End Date"
                  value={newFyForm.endDate}
                  calendars={calendarYears}
                  onChange={(endDate) => setNewFyForm((current) => ({ ...current, endDate }))}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!calendarReady}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs"
                >
                  Create Calendar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiscalPeriods;
