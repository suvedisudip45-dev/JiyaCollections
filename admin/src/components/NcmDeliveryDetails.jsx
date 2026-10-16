/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { RefreshCw, X } from "lucide-react";
import { backendUrl } from "../App";

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400";
const formatDate = (value) => value
  ? new Date(value).toLocaleString("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" })
  : "—";
const displayValue = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
const detailFields = "grid grid-cols-2 gap-3";

const Info = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 break-words text-sm text-slate-800">{displayValue(value)}</div>
  </div>
);

const NcmDeliveryDetails = ({ token, recordId, row, onClose }) => {
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [remoteStatus, setRemoteStatus] = useState(null);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [branches, setBranches] = useState([]);
  const [redirectForm, setRedirectForm] = useState({ name: "", phone: "", address: "", destination: "", cod_charge: "" });

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/admin/ncm/deliveries/${recordId}`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load NCM delivery.");
      const value = response.data.delivery;
      setDelivery(value);
      const address = value.order?.address && typeof value.order.address === "object" ? value.order.address : {};
      setRedirectForm((current) => ({
        ...current,
        name: value.customer?.name || address.name || [address.firstName, address.lastName].filter(Boolean).join(" "),
        phone: value.customer?.phone || address.phone || "",
        address: address.address || address.street || "",
      }));
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load NCM delivery.");
    } finally {
      setLoading(false);
    }
  }, [recordId, token]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const loadBranches = async () => {
    setBusy("branches");
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/admin/ncm/branches`, { headers: { token } });
      setBranches(Array.isArray(response.data?.data) ? response.data.data : response.data?.data?.results || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load NCM branches.");
    } finally {
      setBusy("");
    }
  };

  const loadRemoteStatus = async () => {
    if (!delivery?.ncmOrderId) return;
    setBusy("status");
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/ncm/orders/compare-statuses`,
        { deliveryIds: [recordId] },
        { headers: { token } },
      );
      setRemoteStatus({ local: response.data?.local || [], ncm: response.data?.ncm ?? null });
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to fetch NCM status.");
    } finally {
      setBusy("");
    }
  };

  const reconcile = async () => {
    setBusy("reconcile");
    try {
      const response = await axios.post(`${backendUrl}/api/delivery/admin/${recordId}/reconcile`, {}, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Reconciliation failed.");
      if (response.data.delivery?.ncmReconciliationRequired) {
        toast.warning("NCM returned an ambiguous status. This delivery needs an Admin decision.");
      } else {
        toast.success("Delivery status refreshed from NCM.");
      }
      await loadDetails();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Reconciliation failed.");
      if (error.response?.data?.code === "NCM_RECONCILIATION_FETCH_FAILED") await loadDetails();
    } finally {
      setBusy("");
    }
  };

  const resolveReconciliation = async (decision) => {
    setBusy("resolve");
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/${recordId}/resolve-ncm-status`,
        { decision, note: reconciliationNote },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Reconciliation decision failed.");
      toast.success(decision === "CONFIRM_DELIVERED"
        ? "Delivery confirmed; any required sale accounting was handled through the normal transaction."
        : "Not-delivered decision recorded; the last confirmed delivery state was preserved.");
      setReconciliationNote("");
      await loadDetails();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Reconciliation decision failed.");
    } finally {
      setBusy("");
    }
  };

  const loadComments = async () => {
    if (!delivery?.ncmOrderId) return;
    setBusy("comments");
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/admin/ncm/orders/${delivery.ncmOrderId}/comments`, { headers: { token } });
      setComments(response.data?.data ?? null);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load NCM comments.");
    } finally {
      setBusy("");
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    setBusy("comment");
    try {
      const response = await axios.post(
        `${backendUrl}/api/delivery/admin/ncm/orders/comments`,
        { orderid: delivery.ncmOrderId, comments: commentText },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Comment could not be submitted.");
      toast.success("Comment added to the NCM order.");
      setCommentText("");
      await loadComments();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Comment could not be submitted.");
    } finally {
      setBusy("");
    }
  };

  const submitRedirect = async (event) => {
    event.preventDefault();
    if (!window.confirm("This changes the NCM delivery destination and may add a redirect charge. Continue?")) return;
    setBusy("redirect");
    try {
      const payload = {
        name: redirectForm.name,
        phone: redirectForm.phone,
        address: redirectForm.address,
        ...(redirectForm.destination ? { destination: Number(redirectForm.destination) } : {}),
        ...(redirectForm.cod_charge !== "" ? { cod_charge: Number(redirectForm.cod_charge) } : {}),
      };
      const response = await axios.post(`${backendUrl}/api/delivery/admin/ncm/deliveries/${recordId}/redirect`, payload, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Redirect request failed.");
      toast.success("NCM order redirected and local details synchronized.");
      await loadDetails();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Redirect request failed.");
    } finally {
      setBusy("");
    }
  };

  const address = delivery?.order?.address && typeof delivery.order.address === "object" ? delivery.order.address : {};
  const settlement = delivery?.financialSettlement;

  return (
    <div>
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">NCM delivery</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{delivery?.orderId || row?.orderId || "Delivery details"}</h2>
          <p className="mt-1 text-xs text-slate-500">Carrier ID: {delivery?.ncmOrderId || row?.ncmOrderId || "Not booked"}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadDetails} disabled={loading} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Refresh details"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
      </header>

      {loading && <p className="p-6 text-sm text-slate-500">Loading order details…</p>}
      {!loading && delivery && (
        <div className="space-y-4 p-5">
          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Delivery summary</h3>
              <button type="button" onClick={reconcile} disabled={busy !== "" || !delivery.ncmOrderId} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">
                {busy === "reconcile" ? "Refreshing…" : "Reconcile from NCM"}
              </button>
            </div>
            <div className={`${detailFields} mt-4`}>
              <Info label="Local status" value={delivery.state} />
              <Info label="NCM status" value={delivery.ncmStatus} />
              <Info label="Created" value={formatDate(delivery.createdAt)} />
              <Info label="Delivered" value={formatDate(delivery.deliveredAt)} />
              <Info label="Returned" value={formatDate(delivery.returnedAt)} />
              <Info label="Last synced" value={formatDate(delivery.lastSyncedAt)} />
              <Info label="Origin" value={delivery.originBranchName} />
              <Info label="Destination" value={delivery.destinationBranchName} />
            </div>
            {delivery.lastSyncError && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{delivery.lastSyncError}</p>}
          </section>

          {delivery.ncmReconciliationRequired && (
            <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div>
                <h3 className="text-sm font-semibold text-amber-900">Needs reconciliation</h3>
                <p className="mt-1 text-xs text-amber-800">
                  The last NCM response was not safe to apply automatically. Current order status, COD, inventory and accounting have not been advanced from that response.
                </p>
                {delivery.ncmReconciliationReason && <p className="mt-2 text-xs text-amber-900">{delivery.ncmReconciliationReason}</p>}
              </div>
              <label className="block text-xs font-medium text-amber-900">
                Investigation note (10–2000 characters)
                <textarea
                  value={reconciliationNote}
                  onChange={(event) => setReconciliationNote(event.target.value)}
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  className={`${inputClass} mt-1`}
                  placeholder="Record the NCM evidence checked and why this decision is appropriate."
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resolveReconciliation("CONFIRM_DELIVERED")}
                  disabled={busy !== "" || reconciliationNote.trim().length < 10}
                  className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === "resolve" ? "Recording…" : "Confirm delivered"}
                </button>
                <button
                  type="button"
                  onClick={() => resolveReconciliation("CONFIRM_NOT_DELIVERED")}
                  disabled={busy !== "" || reconciliationNote.trim().length < 10 || delivery.state === "DELIVERED" || Boolean(delivery.deliveredAt)}
                  className="rounded-md border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
                >
                  Confirm not delivered
                </button>
              </div>
            </section>
          )}

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Customer and order</h3>
            <div className={`${detailFields} mt-4`}>
              <Info label="Customer" value={delivery.customer?.name} />
              <Info label="Phone" value={delivery.customer?.phone} />
              <Info label="Order status" value={delivery.order?.status} />
              <Info label="Payment method" value={delivery.order?.paymentMethod} />
              <Info label="Address" value={address.address || address.street} />
              <Info label="COD amount" value={delivery.codAmount} />
              <Info label="Delivery charge" value={delivery.ncmDeliveryCharge ?? delivery.customerDeliveryCharge} />
              <Info label="Package" value={`${delivery.packageWeight || 0} kg · ${delivery.packageDescription || "—"}`} />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Status history</h3>
            <div className="mt-3 space-y-2">
              {(delivery.events || []).map((event) => (
                <div key={event.id} className="flex items-start justify-between gap-3 border-l-2 border-indigo-200 pl-3 text-xs">
                  <div>
                    <p className="font-medium text-slate-700">{event.eventType || event.ncmStatus}</p>
                    <p className="mt-0.5 text-slate-500">
                      {event.fromState ? `${event.fromState} → ` : ""}{event.toState || event.ncmStatus || "Recorded"}
                      {event.source ? ` · ${event.source}` : ""}
                    </p>
                    {event.payloadJson?.note && <p className="mt-1 text-slate-600">Admin note: {event.payloadJson.note}</p>}
                  </div>
                  <time className="shrink-0 text-slate-400">{formatDate(event.occurredAt)}</time>
                </div>
              ))}
              {!delivery.events?.length && <p className="text-xs text-slate-500">No local status events recorded.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Compare local and NCM status</h3>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={loadRemoteStatus} disabled={busy !== "" || !delivery.ncmOrderId} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {busy === "status" ? "Comparing…" : "Compare current status"}
              </button>
            </div>
            {remoteStatus && <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(remoteStatus, null, 2)}</pre>}
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Order comments</h3>
              <button type="button" onClick={loadComments} disabled={busy !== "" || !delivery.ncmOrderId} className="text-xs font-semibold text-indigo-700">
                {busy === "comments" ? "Loading…" : "Fetch comments"}
              </button>
            </div>
            {comments && <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(comments, null, 2)}</pre>}
            <form onSubmit={submitComment} className="mt-3 flex gap-2">
              <input value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={2000} required placeholder="Add a comment to the NCM order" className={inputClass} />
              <button type="submit" disabled={busy !== "" || !delivery.ncmOrderId} className="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {busy === "comment" ? "Sending…" : "Send"}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Return and exchange history</h3>
            <div className="mt-3 space-y-3">
              {(delivery.returnRequests || []).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-3 text-xs">
                  <div className="flex justify-between gap-2"><strong>Return · {item.lifecycleStatus || "Requested"}</strong><span>{formatDate(item.returnDate)}</span></div>
                  <p className="mt-1 text-slate-600">{item.reason || "No reason recorded"}</p>
                  {item.events?.map((event) => <p key={event.id} className="mt-1 text-slate-500">{event.eventType} · {formatDate(event.occurredAt)}</p>)}
                </div>
              ))}
              {(delivery.exchanges || []).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-3 text-xs">
                  <div className="flex justify-between gap-2"><strong>Exchange · {item.status}</strong><span>{formatDate(item.createdAt)}</span></div>
                  <p className="mt-1 text-slate-600">Replacement: {item.replacementStatus || "—"} · Completed: {formatDate(item.completedAt)}</p>
                  {item.events?.map((event) => <p key={event.id} className="mt-1 text-slate-500">{event.eventType} · {formatDate(event.occurredAt)}</p>)}
                </div>
              ))}
              {!delivery.returnRequests?.length && !delivery.exchanges?.length && <p className="text-xs text-slate-500">No returns or exchanges recorded.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Settlement</h3>
            {settlement ? (
              <div className={`${detailFields} mt-4`}>
                <Info label="State" value={settlement.settlementState} />
                <Info label="NCM ticket" value={settlement.ncmTicketId} />
                <Info label="Expected COD" value={settlement.codExpected} />
                <Info label="Collected COD" value={settlement.codCollected} />
                <Info label="Expected delivery fee" value={settlement.deliveryFeeExpected} />
                <Info label="Actual delivery fee" value={settlement.deliveryFeeActual} />
                <Info label="Settled" value={formatDate(settlement.settledAt)} />
                <Info label="Variance reason" value={settlement.varianceReason} />
              </div>
            ) : <p className="mt-2 text-xs text-slate-500">No local settlement record has been created for this delivery.</p>}
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Redirect NCM delivery</h3>
                <p className="mt-1 text-xs text-slate-500">NCM may apply a redirect fee. Local order details update after NCM accepts.</p>
              </div>
              <button type="button" onClick={loadBranches} disabled={busy !== ""} className="shrink-0 text-xs font-semibold text-indigo-700">
                {busy === "branches" ? "Loading…" : "Load branches"}
              </button>
            </div>
            <form onSubmit={submitRedirect} className="mt-3 space-y-2">
              <input required value={redirectForm.name} onChange={(event) => setRedirectForm((current) => ({ ...current, name: event.target.value }))} placeholder="Customer name" className={inputClass} />
              <input required value={redirectForm.phone} onChange={(event) => setRedirectForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Customer phone" className={inputClass} />
              <input required value={redirectForm.address} onChange={(event) => setRedirectForm((current) => ({ ...current, address: event.target.value }))} placeholder="Full delivery address" className={inputClass} />
              <select value={redirectForm.destination} onChange={(event) => setRedirectForm((current) => ({ ...current, destination: event.target.value }))} className={inputClass}>
                <option value="">Keep current branch</option>
                {branches.map((branch) => {
                  const id = branch.pk ?? branch.id;
                  const label = branch.name || branch.branch_name || branch.branch || branch.code || `Branch ${id}`;
                  return <option key={id} value={id}>{label} · {id}</option>;
                })}
              </select>
              <input type="number" min="0" step="0.01" value={redirectForm.cod_charge} onChange={(event) => setRedirectForm((current) => ({ ...current, cod_charge: event.target.value }))} placeholder="Updated COD amount (optional)" className={inputClass} />
              <button type="submit" disabled={busy !== "" || !delivery.ncmOrderId} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">
                {busy === "redirect" ? "Redirecting…" : "Confirm redirect"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default NcmDeliveryDetails;
