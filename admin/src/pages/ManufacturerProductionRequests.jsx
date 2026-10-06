import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Check, Factory, RefreshCw, X } from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const statusClass = {
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

const ManufacturerProductionRequests = ({ token }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [terms, setTerms] = useState({});
  const [savingId, setSavingId] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer-production/admin/requests?limit=100`, { headers: { token } });
      const rows = response.data.requests || [];
      setRequests(rows);
      setTerms((current) => {
        const next = { ...current };
        rows.forEach((request) => {
          if (!next[request.id]) next[request.id] = {
            unitCogs: request.proposedUnitCogs,
            minimumOrderQuantity: request.minimumOrderQuantity,
            deliveryCost: request.proposedDeliveryCost,
          };
        });
        return next;
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load manufacturer production requests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const review = async (request, decision) => {
    setSavingId(request.id);
    try {
      const approved = terms[request.id] || {};
      const response = await axios.post(`${backendUrl}/api/manufacturer-production/admin/requests/${request.id}/review`, {
        decision,
        adminNote: notes[request.id] || "",
        ...(decision === "APPROVE" ? {
          approvedUnitCogs: approved.unitCogs,
          approvedMinimumOrderQuantity: approved.minimumOrderQuantity,
          approvedDeliveryCost: approved.deliveryCost,
        } : {}),
      }, { headers: { token } });
      toast.success(response.data.message || `Request ${decision.toLowerCase()}d.`);
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to review production request.");
    } finally {
      setSavingId("");
    }
  };

  const setTerm = (id, field, value) => setTerms((current) => ({
    ...current,
    [id]: { ...current[id], [field]: value },
  }));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Factory className="h-6 w-6 text-emerald-600" /> Manufacturer Production</h1><p className="mt-1 text-sm text-slate-500">Approve product COGS, informational MOQ and delivered-unit overhead before production begins.</p></div>
        <button onClick={loadRequests} className="rounded-xl border bg-white p-2.5 text-slate-600" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      </header>
      {loading && requests.length === 0 ? <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Loading production requests...</div>
        : requests.length === 0 ? <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">No production requests have been submitted.</div>
          : <div className="space-y-4">{requests.map((request) => {
            const quantity = (request.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
            const pending = request.status === "PENDING_REVIEW";
            const approvedTerms = terms[request.id] || {};
            return <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-bold text-slate-900">{request.productName}</h2><p className="mt-1 text-xs text-slate-500">{request.manufacturer?.name} · {quantity} units · Requested {new Date(request.requestedAt).toLocaleDateString()}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass[request.status] || "bg-slate-100 text-slate-600"}`}>{request.status.replaceAll("_", " ")}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{(request.lines || []).map((line) => <span key={`${line.size}-${line.color}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">{line.size}{line.color !== "Standard" ? ` / ${line.color}` : ""}: {line.quantity}</span>)}</div>
              {pending && <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">Approved unit COGS ({currency})
                  <input type="number" min="0.01" step="0.01" value={approvedTerms.unitCogs ?? ""} onChange={(event) => setTerm(request.id, "unitCogs", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">MOQ (informational)
                  <input type="number" min="1" step="1" value={approvedTerms.minimumOrderQuantity ?? ""} onChange={(event) => setTerm(request.id, "minimumOrderQuantity", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Overhead / delivered unit ({currency})
                  <input type="number" min="0" step="0.01" value={approvedTerms.deliveryCost ?? ""} onChange={(event) => setTerm(request.id, "deliveryCost", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
              </div>}
              {!pending && <p className="mt-3 text-sm text-slate-600">Approved: {currency}{request.approvedUnitCogs ?? request.proposedUnitCogs}/unit · MOQ {request.approvedMinimumOrderQuantity ?? request.minimumOrderQuantity} · {currency}{request.approvedDeliveryCost ?? request.proposedDeliveryCost} overhead per delivered unit</p>}
              {request.manufacturerNote && <p className="mt-3 text-xs text-slate-500">Manufacturer note: {request.manufacturerNote}</p>}
              {request.adminNote && <p className="mt-2 text-xs text-slate-500">Admin note: {request.adminNote}</p>}
              {pending && <>
                <textarea value={notes[request.id] ?? request.adminNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} rows={2} maxLength={2000} placeholder="Admin note (optional)" className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={savingId === request.id} onClick={() => review(request, "APPROVE")} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" /> Approve terms</button>
                  <button disabled={savingId === request.id} onClick={() => review(request, "REJECT")} className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2 text-xs font-bold text-rose-700 disabled:opacity-50"><X className="h-4 w-4" /> Reject</button>
                </div>
              </>}
            </article>;
          })}</div>}
    </div>
  );
};

export default ManufacturerProductionRequests;
