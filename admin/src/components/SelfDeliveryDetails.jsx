/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { X } from "lucide-react";
import { backendUrl } from "../App";

const formatDate = (value) => value
  ? new Date(value).toLocaleString("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" })
  : "—";

const Info = ({ label, value }) => (
  <div>
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 break-words text-sm text-slate-800">{value === null || value === undefined || value === "" ? "—" : String(value)}</div>
  </div>
);

const SelfDeliveryDetails = ({ token, recordId, onClose }) => {
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    axios.get(`${backendUrl}/api/delivery/admin/self-deliveries/${recordId}`, {
      headers: { token },
      signal: controller.signal,
    }).then((response) => {
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load self-delivery.");
      setDelivery(response.data.delivery);
    }).catch((error) => {
      if (!axios.isCancel(error) && error.name !== "CanceledError") {
        toast.error(error.response?.data?.message || error.message || "Unable to load self-delivery.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [recordId, token]);

  const order = delivery?.order;
  const address = order?.address && typeof order.address === "object" ? order.address : {};
  const distributor = delivery?.distributor;
  const rating = delivery?.distributorReview;

  return (
    <div>
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Distributor self-delivery</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{delivery?.orderId || "Delivery details"}</h2>
          <p className="mt-1 text-xs text-slate-500">Customer order assigned directly to a distributor.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Close"><X className="h-4 w-4" /></button>
      </header>
      {loading && <p className="p-6 text-sm text-slate-500">Loading delivery details…</p>}
      {!loading && delivery && (
        <div className="space-y-4 p-5">
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Delivery timeline</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Info label="Status" value={delivery.status} />
              <Info label="Assigned" value={formatDate(delivery.assignedAt)} />
              <Info label="Accepted" value={formatDate(delivery.acceptedAt)} />
              <Info label="Dispatched" value={formatDate(delivery.dispatchedAt)} />
              <Info label="On the way" value={formatDate(delivery.onTheWayAt)} />
              <Info label="Delivered" value={formatDate(delivery.deliveredAt)} />
              <Info label="Returned" value={formatDate(delivery.returnedAt)} />
            </div>
            {delivery.notes && <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">{delivery.notes}</p>}
          </section>
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Customer order</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Info label="Customer" value={delivery.customer?.name} />
              <Info label="Phone" value={delivery.customer?.phone} />
              <Info label="Order status" value={order?.status} />
              <Info label="Created" value={formatDate(order?.createdAt)} />
              <Info label="Payment method" value={order?.paymentMethod} />
              <Info label="Paid" value={order?.payment ? "Yes" : "No"} />
              <Info label="Address" value={address.address || address.street} />
              <Info label="Order value" value={order?.amount} />
            </div>
            {Array.isArray(order?.items) && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h4 className="text-xs font-semibold text-slate-600">Items</h4>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {order.items.slice(0, 50).map((item, index) => <li key={`${item?.productId || item?.name || "item"}-${index}`}>{item?.name || item?.productName || "Item"} × {item?.quantity || 1}</li>)}
                </ul>
              </div>
            )}
          </section>
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Distributor</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Info label="Name" value={distributor?.name} />
              <Info label="Location" value={[distributor?.district, distributor?.province].filter(Boolean).join(", ")} />
              <Info label="Overall rating" value={`${Number(distributor?.qualityRating || 0).toFixed(1)} / 5 (${distributor?.ratingCount || 0})`} />
              <Info label="This order rating" value={rating?.rating ? `${rating.rating} / 5` : "Not rated"} />
              <Info label="Review date" value={formatDate(rating?.createdAt)} />
            </div>
            {rating?.comment && <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">{rating.comment}</p>}
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
                  <p className="mt-1 text-slate-600">Replacement: {item.replacementStatus || "—"} · Delivered: {formatDate(item.replacementDeliveredAt)} · Completed: {formatDate(item.completedAt)}</p>
                  {item.events?.map((event) => <p key={event.id} className="mt-1 text-slate-500">{event.eventType} · {formatDate(event.occurredAt)}</p>)}
                </div>
              ))}
              {!delivery.returnRequests?.length && !delivery.exchanges?.length && <p className="text-xs text-slate-500">No returns or exchanges recorded.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default SelfDeliveryDetails;
