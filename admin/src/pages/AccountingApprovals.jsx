/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
};

const AccountingApprovals = ({ token }) => {
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("APPROVE");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${backendUrl}/api/accounting/approval-requests`, {
        headers: { token },
        params: { status, limit: 50 },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Could not load accounting approvals.");
      setRequests(response.data.approvalRequests || []);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not load accounting approvals.");
    } finally {
      setLoading(false);
    }
  }, [status, token]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const submitReview = async (event) => {
    event.preventDefault();
    if (!selected || reason.trim().length < 3) {
      toast.error("Enter a review reason of at least three characters.");
      return;
    }
    try {
      setSaving(true);
      const response = await axios.post(`${backendUrl}/api/accounting/approval-requests/review`, {
        approvalId: selected.id,
        decision,
        reason: reason.trim(),
      }, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Could not review accounting request.");
      toast.success(response.data.message);
      setSelected(null);
      setReason("");
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not review accounting request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Accounting approvals</h1>
          <p className="mt-1 text-sm text-slate-600">Review maker-checker requests. Approval executes the action atomically; rejection executes no accounting change.</p>
        </div>
        <div className="flex gap-2">
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button type="button" onClick={loadRequests} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh</button>
        </div>
      </header>

      {loading && <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading accounting approvals…</p>}
      {!loading && requests.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">No {status.toLowerCase()} accounting requests.</p>}

      <div className="space-y-3">
        {requests.map((request) => (
          <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">{request.actionType.replaceAll("_", " ")}</h2>
                <p className="mt-1 text-xs text-slate-500">Submitted by {request.makerAccountId} ({request.makerRole}) · {formatDate(request.createdAt)}</p>
                {request.reviewedAt && <p className="mt-1 text-xs text-slate-500">Reviewed by {request.reviewerAccountId} ({request.reviewerRole}) · {formatDate(request.reviewedAt)}</p>}
                {request.reviewReason && <p className="mt-1 text-xs text-slate-700">Review reason: {request.reviewReason}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${request.status === "PENDING" ? "bg-amber-50 text-amber-800" : request.status === "APPROVED" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                {request.status}
              </span>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Request details</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(request.payload, null, 2)}</pre>
            </details>
            {request.resultSnapshot && <p className="mt-3 text-xs text-slate-600">Result: {JSON.stringify(request.resultSnapshot)}</p>}
            {request.status === "PENDING" && (
              <button type="button" onClick={() => { setSelected(request); setDecision("APPROVE"); setReason(""); }} className="mt-3 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                Review request
              </button>
            )}
          </article>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={submitReview} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div>
              <h2 className="font-bold text-slate-900">Review {selected.actionType.replaceAll("_", " ").toLowerCase()}</h2>
              <p className="mt-1 text-xs text-slate-500">The initiating Admin cannot review this request.</p>
            </div>
            <label className="block text-sm font-semibold text-slate-700">Decision
              <select value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">
                <option value="APPROVE">Approve and execute</option>
                <option value="REJECT">Reject without execution</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">Review reason
              <textarea required minLength={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : decision === "APPROVE" ? "Approve and execute" : "Reject request"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default AccountingApprovals;
