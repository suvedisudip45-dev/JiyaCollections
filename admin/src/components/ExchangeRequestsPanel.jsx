import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const REASON_LABELS = {
  SIZE_OR_FIT: "Size or fit",
  DEFECTIVE: "Defective product",
  WRONG_ITEM: "Wrong item",
  DAMAGED_IN_TRANSIT: "Damaged in transit",
  OTHER: "Other",
};

const STATUS_STYLES = {
  REQUESTED: "bg-amber-50 text-amber-800 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-800 border-blue-200",
  NCM_SUBMISSION_UNKNOWN: "bg-orange-50 text-orange-800 border-orange-200",
  NCM_CREATED: "bg-blue-50 text-blue-800 border-blue-200",
  RETURN_PICKUP_COMPLETE: "bg-cyan-50 text-cyan-800 border-cyan-200",
  RETURN_RECEIVED: "bg-indigo-50 text-indigo-800 border-indigo-200",
  INSPECTED: "bg-violet-50 text-violet-800 border-violet-200",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
  NCM_REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
};

const formatMoney = (amount) => `${currency}${Number(amount || 0).toLocaleString("en-NP")}`;
const formatDate = (date) => date ? new Date(date).toLocaleString() : "Not recorded";

const ExchangeRequestsPanel = ({ token }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [decisionReasons, setDecisionReasons] = useState({});
  const [inspectionForms, setInspectionForms] = useState({});
  const [ncmResolutionForms, setNcmResolutionForms] = useState({});

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${backendUrl}/api/returns/exchange/admin`, {
        headers: { token },
      });
      if (response.data.success) setRequests(response.data.requests || []);
      else toast.error(response.data.message || "Unable to load exchange requests");
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load exchange requests");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchRequests();
  }, [token, fetchRequests]);

  const postAction = async (requestId, path, payload, successMessage) => {
    if (busyId) return;
    setBusyId(requestId);
    try {
      const response = await axios.post(`${backendUrl}/api/returns/exchange/admin/${requestId}/${path}`, payload, {
        headers: { token },
      });
      if (response.data.success) {
        toast.success(successMessage);
        await fetchRequests();
      } else {
        toast.error(response.data.message || "Exchange action failed");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Exchange action failed");
    } finally {
      setBusyId("");
    }
  };

  const inspect = (request) => {
    const form = inspectionForms[request.id] || { result: "RESTOCKABLE", notes: "" };
    postAction(request.id, "inspection", form, "Return inspection recorded");
  };

  if (loading) return <div className="py-12 text-center text-sm text-slate-500">Loading exchange requests...</div>;
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{requests.length} exchange request{requests.length === 1 ? "" : "s"}</p>
        <button onClick={fetchRequests} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-semibold text-slate-700">Refresh</button>
      </div>
      {!requests.length && <div className="py-12 text-center text-sm text-slate-500">No exchange requests yet.</div>}
      {requests.map((request) => {
        const items = Array.isArray(request.items) ? request.items : [];
        const decisionReason = decisionReasons[request.id] || "";
        const inspection = inspectionForms[request.id] || { result: "RESTOCKABLE", notes: "" };
        const ncmResolution = ncmResolutionForms[request.id] || { outcome: "FOUND", ncmReturnOrderId: "", ncmReplacementOrderId: "", reason: "" };
        const statusClass = STATUS_STYLES[request.status] || "bg-slate-50 text-slate-700 border-slate-200";
        const canInspect = request.manufacturerReceivedAt && !request.inspectedAt;
        const canResolveNcm = request.status === "NCM_SUBMISSION_UNKNOWN" || (
          request.status === "SUBMITTING" && Date.now() - new Date(request.ncmSubmissionAttemptedAt || 0).getTime() >= 120000
        );

        return (
          <article key={request.id} className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Exchange {request.id.slice(0, 8).toUpperCase()}</h3>
                  <span className={`px-2 py-0.5 border rounded-full text-[10px] font-bold uppercase ${statusClass}`}>
                    {request.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Order #{request.orderId.slice(0, 8).toUpperCase()} · Requested {formatDate(request.createdAt)}</p>
              </div>
              <p className="text-xs font-semibold text-slate-700">Lifetime returned units: {request.lifetimeReturnedUnits}</p>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-3">
              <div><p className="text-slate-400">Customer</p><p className="font-semibold text-slate-800">{request.customer?.name || request.customerName}</p><p className="text-slate-500">{request.customer?.phone || request.customerPhone || "No phone"}</p></div>
              <div><p className="text-slate-400">Manufacturer</p><p className="font-semibold text-slate-800">{request.manufacturerName || "Not assigned"}</p></div>
              <div><p className="text-slate-400">Return reason</p><p className="font-semibold text-slate-800">{REASON_LABELS[request.reasonCode] || request.reasonCode}</p><p className="text-slate-600">{request.reasonDetails || "No extra details"}</p></div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Requested items</p>
              <div className="space-y-1">
                {items.map((item, index) => (
                  <div key={`${item.productId}-${index}`} className="flex flex-wrap justify-between gap-2 text-xs text-slate-700">
                    <span>{item.name} · {item.size || "One size"} {item.color ? `· ${item.color}` : ""} · Qty {item.quantity}</span>
                    <span>{formatMoney(item.unitPrice)} each</span>
                  </div>
                ))}
              </div>
            </div>

            {(request.ncmReturnOrderId || request.ncmReplacementOrderId) && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                NCM return #{request.ncmReturnOrderId || "Pending"} · Pickup: {request.returnPickupStatus || "Pending"} · Replacement #{request.ncmReplacementOrderId || "Pending"} · {request.replacementStatus || "Pending"}
              </div>
            )}
            {request.status === "SUBMITTING" && !canResolveNcm && (
              <p className="text-xs text-orange-900 bg-orange-50 border border-orange-200 rounded-md p-2">NCM submission is still being confirmed. Manual resolution becomes available after two minutes.</p>
            )}
            {canResolveNcm && (
              <div className="space-y-2 rounded-md bg-orange-50 border border-orange-200 p-3">
                <p className="text-xs text-orange-900">NCM may have created this exchange. Check the NCM portal before resolving; do not retry an unknown request.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={ncmResolution.outcome} onChange={(event) => setNcmResolutionForms({ ...ncmResolutionForms, [request.id]: { ...ncmResolution, outcome: event.target.value } })} className="border border-orange-300 rounded-md px-3 py-2 text-xs">
                    <option value="FOUND">Exchange exists in NCM</option>
                    <option value="NOT_CREATED">NCM confirms no exchange was created</option>
                  </select>
                  {ncmResolution.outcome === "FOUND" && <>
                    <input type="number" min="1" value={ncmResolution.ncmReturnOrderId} onChange={(event) => setNcmResolutionForms({ ...ncmResolutionForms, [request.id]: { ...ncmResolution, ncmReturnOrderId: event.target.value } })} className="border border-orange-300 rounded-md px-3 py-2 text-xs" placeholder="NCM return order ID" />
                    <input type="number" min="1" value={ncmResolution.ncmReplacementOrderId} onChange={(event) => setNcmResolutionForms({ ...ncmResolutionForms, [request.id]: { ...ncmResolution, ncmReplacementOrderId: event.target.value } })} className="border border-orange-300 rounded-md px-3 py-2 text-xs" placeholder="NCM replacement order ID" />
                  </>}
                  <input value={ncmResolution.reason} onChange={(event) => setNcmResolutionForms({ ...ncmResolutionForms, [request.id]: { ...ncmResolution, reason: event.target.value } })} className="border border-orange-300 rounded-md px-3 py-2 text-xs sm:col-span-2" placeholder="What did you verify in NCM?" />
                </div>
                <button
                  disabled={busyId === request.id || ncmResolution.reason.trim().length < 5 || (ncmResolution.outcome === "FOUND" && (!ncmResolution.ncmReturnOrderId || !ncmResolution.ncmReplacementOrderId))}
                  onClick={() => postAction(request.id, "resolve-ncm", ncmResolution, "NCM outcome recorded")}
                  className="px-3 py-2 rounded-md bg-orange-800 text-white text-xs font-bold disabled:opacity-50"
                >Resolve verified outcome
                </button>
              </div>
            )}

            {request.status === "REQUESTED" && (
              <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row">
                <input
                  value={decisionReason}
                  onChange={(event) => setDecisionReasons({ ...decisionReasons, [request.id]: event.target.value })}
                  className="min-w-0 flex-1 border border-slate-300 rounded-md px-3 py-2 text-xs"
                  placeholder="Decision note (required)"
                />
                <button disabled={busyId === request.id || decisionReason.trim().length < 3} onClick={() => postAction(request.id, "decision", { decision: "APPROVE", reason: decisionReason }, "Exchange approved; NCM submission recorded")} className="px-3 py-2 rounded-md bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">Approve</button>
                <button disabled={busyId === request.id || decisionReason.trim().length < 3} onClick={() => postAction(request.id, "decision", { decision: "REJECT", reason: decisionReason }, "Exchange request rejected")} className="px-3 py-2 rounded-md bg-rose-700 text-white text-xs font-bold disabled:opacity-50">Reject</button>
              </div>
            )}

            {request.status === "NCM_REJECTED" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button disabled={busyId === request.id} onClick={() => postAction(request.id, "retry-ncm", {}, "Exchange resubmission attempted")} className="px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold disabled:opacity-50">Retry NCM after verified rejection</button>
                <button disabled={busyId === request.id || decisionReason.trim().length < 3} onClick={() => postAction(request.id, "decision", { decision: "REJECT", reason: decisionReason }, "Exchange request closed; card unlocked")} className="px-3 py-2 rounded-md border border-rose-300 text-rose-800 text-xs font-bold disabled:opacity-50">Close exchange request</button>
                <input value={decisionReason} onChange={(event) => setDecisionReasons({ ...decisionReasons, [request.id]: event.target.value })} className="min-w-0 flex-1 border border-slate-300 rounded-md px-3 py-2 text-xs" placeholder="Reason for closing" />
              </div>
            )}
            {request.ncmReturnOrderId && request.ncmReplacementOrderId && request.status !== "COMPLETED" && (
              <button disabled={busyId === request.id} onClick={() => postAction(request.id, "reconcile", {}, "NCM exchange statuses refreshed")} className="px-3 py-2 rounded-md border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50">Reconcile NCM statuses</button>
            )}

            {canInspect && (
              <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_2fr_auto]">
                <select value={inspection.result} onChange={(event) => setInspectionForms({ ...inspectionForms, [request.id]: { ...inspection, result: event.target.value } })} className="border border-slate-300 rounded-md px-3 py-2 text-xs">
                  <option value="RESTOCKABLE">Restockable</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="MISSING">Missing</option>
                  <option value="DISPUTED">Disputed</option>
                </select>
                <input value={inspection.notes} onChange={(event) => setInspectionForms({ ...inspectionForms, [request.id]: { ...inspection, notes: event.target.value } })} className="border border-slate-300 rounded-md px-3 py-2 text-xs" placeholder="Inspection notes" />
                <button disabled={busyId === request.id || (inspection.result !== "RESTOCKABLE" && inspection.notes.trim().length < 5)} onClick={() => inspect(request)} className="px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold disabled:opacity-50">Record inspection</button>
              </div>
            )}

            {request.inspectedAt && <p className="text-[11px] text-slate-500">Inspected {formatDate(request.inspectedAt)} · {request.inspectionResult}: {request.inspectionNotes || "No notes"}</p>}
            {request.decisionReason && <p className="text-[11px] text-slate-500">Admin decision: {request.decisionReason}</p>}
          </article>
        );
      })}
    </div>
  );
};

export default ExchangeRequestsPanel;