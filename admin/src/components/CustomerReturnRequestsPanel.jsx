import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const money = (value) => `${currency}${Number(value || 0).toLocaleString("en-NP")}`;
const readable = (value) => String(value || "").replace(/_/g, " ");

const CustomerReturnRequestsPanel = ({ token }) => {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [decisionNotes, setDecisionNotes] = useState({});
  const [chargePayers, setChargePayers] = useState({});
  const [inspections, setInspections] = useState({});
  const [resolutions, setResolutions] = useState({});

  const fetchReturns = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${backendUrl}/api/returns/customer/admin/requests`, { headers: { token } });
      if (response.data.success) setReturns(response.data.returns || []);
      else toast.error(response.data.message || "Unable to load return requests");
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load return requests");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchReturns();
  }, [token, fetchReturns]);

  const postAction = async (returnId, path, payload, successMessage) => {
    if (busyId) return;
    setBusyId(returnId);
    try {
      const response = await axios.post(`${backendUrl}/api/returns/customer/admin/${returnId}/${path}`, payload, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Return action failed");
      const record = response.data.returnRecord;
      if (record?.lifecycleStatus === "NCM_REJECTED") {
        toast.error(record.ncmSubmissionError || "NCM rejected the return request");
      } else if (record?.lifecycleStatus === "NCM_SUBMISSION_UNKNOWN") {
        toast.warning("NCM outcome is unknown. Reconcile with the carrier before retrying.");
      } else {
        toast.success(successMessage);
      }
      await fetchReturns();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Return action failed");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <div className="py-8 text-center text-sm text-slate-500">Loading customer return requests...</div>;
  return (
    <section className="space-y-3 border-b border-slate-200 pb-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Return requests awaiting review and fulfillment</h3>
        <button type="button" onClick={fetchReturns} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-semibold text-slate-700">Refresh</button>
      </div>
      {!returns.length && <p className="py-5 text-center text-xs text-slate-500">No return requests recorded.</p>}
      {returns.map((record) => {
        const note = decisionNotes[record.id] || "";
        const chargePayer = chargePayers[record.id] || "MERCHANT";
        const inspection = inspections[record.id] || { result: "RESTOCKABLE", notes: "" };
        const resolution = resolutions[record.id] || { outcome: "FOUND", reason: "" };
        const canResolve = record.lifecycleStatus === "NCM_SUBMISSION_UNKNOWN" || (
          record.lifecycleStatus === "SUBMITTING" && Date.now() - new Date(record.ncmSubmissionAttemptedAt || 0).getTime() >= 120000
        );
        const items = Array.isArray(record.items) ? record.items : [];
        return (
          <article key={record.id} className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-slate-900">RMA-{record.id.slice(0, 8).toUpperCase()} · Order #{String(record.orderId || "").slice(0, 8).toUpperCase()}</h4>
                <p className="text-[11px] text-slate-500">{record.customerName} · {record.customerPhone || "No phone"} · {new Date(record.createdAt).toLocaleString()}</p>
              </div>
              <span className="px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-700">{readable(record.lifecycleStatus)}</span>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <p><span className="text-slate-400">Cause</span><br /><span className="text-slate-800">{record.reason}</span></p>
              <p><span className="text-slate-400">NCM original ID</span><br /><span className="font-mono text-slate-800">{record.originalNcmOrderId || "Not linked"}</span></p>
              <p><span className="text-slate-400">NCM-reported delivery charge</span><br /><span className="font-semibold text-slate-800">{record.ncmDeliveryCharge == null ? "Not supplied by NCM" : `${money(record.ncmDeliveryCharge)} · ${record.ncmChargeSource === "ORDER_DETAIL" ? "order detail" : "return response"}`} · {record.ncmChargePayer}</span></p>
            </div>
            <div className="space-y-1 text-xs text-slate-700">
              {items.map((item, index) => <p key={`${item.productId}-${index}`}>{item.name} · {item.size || "One size"}{item.color ? ` · ${item.color}` : ""} · Qty {item.quantity} · Refund estimate {money(item.refundAmount)}</p>)}
            </div>
            {record.ncmSubmissionError && <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">NCM response: {record.ncmSubmissionError}</p>}
            {record.ncmAttempts?.length > 0 && (
              <details className="text-[11px] text-slate-600">
                <summary className="cursor-pointer font-semibold">NCM attempt history ({record.ncmAttempts.length})</summary>
                <div className="mt-2 space-y-2">
                  {record.ncmAttempts.map((attempt) => (
                    <div key={attempt.id} className="rounded-md bg-slate-50 p-2">
                      <p>Attempt {attempt.attemptNumber} · {attempt.result} · HTTP {attempt.httpStatus || "—"} · {new Date(attempt.startedAt).toLocaleString()}</p>
                      {attempt.errorMessage && <p className="text-rose-700">{attempt.errorMessage}</p>}
                      {attempt.responseJson && <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(attempt.responseJson)}</pre>}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {record.lifecycleStatus === "PENDING_ADMIN_REVIEW" && (
              <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_auto_auto]">
                <input value={note} onChange={(event) => setDecisionNotes({ ...decisionNotes, [record.id]: event.target.value })} className="min-w-0 border border-slate-300 rounded-md px-3 py-2 text-xs" placeholder="Decision reason (required)" />
                <select value={chargePayer} onChange={(event) => setChargePayers({ ...chargePayers, [record.id]: event.target.value })} className="border border-slate-300 rounded-md px-2 py-2 text-xs" title="Who pays NCM return charge">
                  <option value="MERCHANT">Merchant pays NCM</option>
                  <option value="CUSTOMER">Customer pays NCM</option>
                </select>
                <div className="flex gap-2">
                  <button disabled={busyId === record.id || note.trim().length < 3} onClick={() => postAction(record.id, "decision", { decision: "APPROVE", reason: note, chargePayer }, "Return approved and sent to NCM")} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">Approve</button>
                  <button disabled={busyId === record.id || note.trim().length < 3} onClick={() => postAction(record.id, "decision", { decision: "REJECT", reason: note }, "Return rejected")} className="px-3 py-2 rounded-md bg-rose-700 text-white text-xs font-bold disabled:opacity-50">Reject</button>
                </div>
              </div>
            )}
            {record.lifecycleStatus === "NCM_REJECTED" && (
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={busyId === record.id} onClick={() => postAction(record.id, "retry-ncm", { chargePayer }, "Return resubmitted to NCM")} className="px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold disabled:opacity-50">Retry confirmed NCM rejection</button>
                <input value={note} onChange={(event) => setDecisionNotes({ ...decisionNotes, [record.id]: event.target.value })} className="min-w-0 flex-1 border border-slate-300 rounded-md px-3 py-2 text-xs" placeholder="Reason for closing this request" />
                <button disabled={busyId === record.id || note.trim().length < 3} onClick={() => postAction(record.id, "decision", { decision: "REJECT", reason: note }, "Carrier-rejected request closed")} className="px-3 py-2 rounded-md border border-rose-300 text-rose-800 text-xs font-bold disabled:opacity-50">Close request</button>
              </div>
            )}
            {canResolve && (
              <div className="grid gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 sm:grid-cols-[auto_1fr_auto]">
                <select value={resolution.outcome} onChange={(event) => setResolutions({ ...resolutions, [record.id]: { ...resolution, outcome: event.target.value } })} className="border border-orange-300 rounded-md px-2 py-2 text-xs">
                  <option value="FOUND">NCM confirms return is marked</option>
                  <option value="NOT_CREATED">NCM confirms return was not marked</option>
                </select>
                <input value={resolution.reason} onChange={(event) => setResolutions({ ...resolutions, [record.id]: { ...resolution, reason: event.target.value } })} className="border border-orange-300 rounded-md px-3 py-2 text-xs" placeholder="NCM portal verification notes" />
                <button disabled={busyId === record.id || resolution.reason.trim().length < 5} onClick={() => postAction(record.id, "resolve-ncm", resolution, "NCM return outcome recorded")} className="px-3 py-2 rounded-md bg-orange-800 text-white text-xs font-bold disabled:opacity-50">Resolve NCM outcome</button>
              </div>
            )}
            {record.lifecycleStatus === "RECEIVED_AT_WAREHOUSE" && (
              <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[auto_1fr_auto]">
                <select value={inspection.result} onChange={(event) => setInspections({ ...inspections, [record.id]: { ...inspection, result: event.target.value } })} className="border border-slate-300 rounded-md px-2 py-2 text-xs">
                  <option value="RESTOCKABLE">Passed, restockable</option><option value="DAMAGED">Damaged, refund only</option><option value="MISSING">Missing</option><option value="DISPUTED">Disputed</option>
                </select>
                <input value={inspection.notes} onChange={(event) => setInspections({ ...inspections, [record.id]: { ...inspection, notes: event.target.value } })} className="border border-slate-300 rounded-md px-3 py-2 text-xs" placeholder="Inspection notes for damaged/missing/disputed" />
                <button disabled={busyId === record.id || (inspection.result !== "RESTOCKABLE" && inspection.notes.trim().length < 5)} onClick={() => postAction(record.id, "inspection", inspection, "Return inspection recorded")} className="px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold disabled:opacity-50">Record inspection</button>
              </div>
            )}
            {record.lifecycleStatus === "REFUND_PENDING" && (
              <button disabled={busyId === record.id} onClick={() => postAction(record.id, "refunded", {}, "Refund marked complete")} className="px-3 py-2 rounded-md border border-emerald-300 text-emerald-800 text-xs font-bold disabled:opacity-50">Confirm payable settled</button>
            )}
          </article>
        );
      })}
    </section>
  );
};

export default CustomerReturnRequestsPanel;
