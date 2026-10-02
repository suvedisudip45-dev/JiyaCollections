import { useState } from "react";
import { AlertTriangle, MessageSquare, Send, Truck } from "lucide-react";

const statusPresets = [
  { status: "Pickup Order Created", event: "pickup_order_created" },
  { status: "Sent for Pickup", event: "sent_for_pickup" },
  { status: "Drop off Order Created", event: "drop_off_order_created" },
  { status: "Pickup Complete", event: "pickup_completed" },
  { status: "Sent for Delivery", event: "sent_for_delivery" },
  { status: "Dispatched", event: "dispatched" },
  { status: "In Transit", event: "in_transit" },
  { status: "Arrived", event: "arrived_at_destination" },
  { status: "Out for Delivery", event: "out_for_delivery" },
  { status: "Delivered", event: "delivery_completed" },
  { status: "Returned", event: "return_requested" },
];

const commentFormats = {
  comments: (orderId, message, timestamp) => ({
    order_id: Number(orderId),
    comments: message,
    addedBy: "NCM",
    added_time: timestamp,
  }),
  comment: (orderId, message, timestamp) => ({
    orderid: Number(orderId),
    comment: message,
    addedBy: "NCM",
    added_time: timestamp,
  }),
  message: (orderId, message, timestamp) => ({
    id: Number(orderId),
    message,
    added_by: "NCM",
    added_time: timestamp,
  }),
};

const webhookSecret = import.meta.env.VITE_NCM_WEBHOOK_SECRET ;
const webhookBaseUrl = import.meta.env.VITE_NCM_WEBHOOK_BASE_URL
  || import.meta.env.VITE_BACKEND_URL
  || "http://localhost:4000";

const NcmWebhookMockPanel = () => {
  const [orderId, setOrderId] = useState("");
  const [requestType, setRequestType] = useState("status");
  const [statusIndex, setStatusIndex] = useState(0);
  const [commentFormat, setCommentFormat] = useState("comments");
  const [comment, setComment] = useState("Courier has arrived. Please keep package at the gate.");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const sendMockWebhook = async (event) => {
    event.preventDefault();
    if (!webhookSecret) return;

    const timestamp = new Date().toISOString();
    const payload = requestType === "status"
      ? { order_id: Number(orderId), ...statusPresets[statusIndex], timestamp }
      : commentFormats[commentFormat](orderId, comment.trim(), timestamp);
    const endpoint = requestType === "status" ? "order-status" : "order-comment";
    const url = new URL(`${webhookBaseUrl.replace(/\/+$/, "")}/api/delivery/webhook/ncm/${endpoint}`);
    url.searchParams.set("secret", webhookSecret);

    setSubmitting(true);
    setLastResult(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok || responseBody.success === false) {
        throw new Error(responseBody.message || `Webhook returned HTTP ${response.status}`);
      }
      setLastResult({ ok: true, payload, response: responseBody });
    } catch (error) {
      setLastResult({ ok: false, payload, response: { message: error.message } });
    } finally {
      setSubmitting(false);
    }
  };

  const validOrderId = Number.isInteger(Number(orderId)) && Number(orderId) > 0;
  const validComment = requestType !== "comment" || Boolean(comment.trim());
  const canSubmit = Boolean(webhookSecret) && validOrderId && validComment && !submitting;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-labelledby="ncm-mock-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-amber-700" />
            <h2 id="ncm-mock-title" className="text-sm font-bold text-slate-900">NCM Webhook Simulator</h2>
            <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Demo</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">Send sample NCM callbacks directly to the public webhook. No user token is sent.</p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setRequestType("status")}
            aria-pressed={requestType === "status"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${requestType === "status" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Truck className="h-3.5 w-3.5" /> Status
          </button>
          <button
            type="button"
            onClick={() => setRequestType("comment")}
            aria-pressed={requestType === "comment"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${requestType === "comment" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Comment
          </button>
        </div>
      </div>

      {!webhookSecret && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-white p-3 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Set <code>VITE_NCM_WEBHOOK_SECRET</code> in the admin build environment to enable webhook simulation.</p>
        </div>
      )}

      <form onSubmit={sendMockWebhook} className="mt-3 grid gap-3 md:grid-cols-[minmax(150px,0.7fr)_minmax(220px,1.3fr)_auto] md:items-end">
        <label className="block text-xs font-semibold text-slate-700">
          NCM order ID
          <input
            required
            type="number"
            min="1"
            step="1"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="e.g. 70123"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-700"
          />
        </label>

        {requestType === "status" ? (
          <label className="block text-xs font-semibold text-slate-700">
            NCM status
            <select
              value={statusIndex}
              onChange={(event) => setStatusIndex(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-700"
            >
              {statusPresets.map((preset, index) => (
                <option key={preset.status} value={index}>{preset.status}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700">
              Payload format
              <select
                value={commentFormat}
                onChange={(event) => setCommentFormat(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-700"
              >
                <option value="comments">order_id + comments</option>
                <option value="comment">orderid + comment</option>
                <option value="message">id + message</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Comment text
              <input
                required
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-700"
              />
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? "Sending..." : "Send mock webhook"}
        </button>
      </form>

      {lastResult && (
        <div className={`mt-3 rounded-lg border p-3 ${lastResult.ok ? "border-emerald-200 bg-white" : "border-rose-200 bg-white"}`}>
          <p className={`text-xs font-bold ${lastResult.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {lastResult.ok ? "Webhook accepted" : "Webhook request failed"}
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-600">
            {JSON.stringify({ payload: lastResult.payload, response: lastResult.response }, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
};

export default NcmWebhookMockPanel;