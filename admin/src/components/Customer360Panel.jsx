/* eslint-disable react/prop-types */
import { useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import { usePermissions } from "../auth/PermissionsContext";

const dateText = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const amountText = (value) => `${currency}${Number(value || 0).toLocaleString()}`;
const statusClass = (status) => String(status || "").toLowerCase().includes("fail")
  ? "bg-red-100 text-red-700"
  : String(status || "").toLowerCase().includes("deliver")
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-700";

const Section = ({ title, count, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="mb-3 flex items-center justify-between text-sm font-bold text-slate-900">
      {title}
      {count !== undefined && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>}
    </h4>
    {children}
  </section>
);

const Empty = ({ children = "No records found." }) => (
  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{children}</p>
);

const Customer360Panel = ({ data, token, onStatusChange, hideProfile = false, hideOrders = false }) => {
  const { can } = usePermissions();
  const canManageAccount = can("customer:account_manage");
  const [savingStatus, setSavingStatus] = useState(false);
  const customer = data?.customer || {};
  const orders = data?.orders || [];
  const metrics = data?.metrics || {};
  const deliveries = new Map((data?.deliveries || []).map((delivery) => [delivery.orderId, delivery]));
  const assignments = new Map((data?.assignments || []).map((assignment) => [assignment.orderId, assignment]));
  const products = data?.products || [];
  const productReviews = data?.reviews?.products || [];
  const distributorReviews = data?.reviews?.distributors || [];
  const cardLinks = data?.cards?.linked || [];
  const cardOrders = data?.cards?.attachedToOrders || [];
  const redemptions = data?.cards?.benefitRedemptions || [];
  const letterDeliveries = data?.letterDeliveries || [];
  const storyAssignments = data?.storyAssignments || [];
  const returns = data?.returns || [];
  const exchanges = data?.exchanges || [];
  const notifications = data?.notifications || [];

  const updateAccountStatus = async () => {
    let reason = "";
    if (!customer.isDisabled) {
      reason = window.prompt("Why are you disabling this customer account?") || "";
      if (!reason.trim()) return;
    } else if (!window.confirm("Re-enable this customer account?")) {
      return;
    }

    try {
      setSavingStatus(true);
      const response = await axios.patch(
        `${backendUrl}/api/customer/admin/${customer.id}/status`,
        { disabled: !customer.isDisabled, reason },
        { headers: { token } },
      );
      if (!response.data.success) {
        toast.error(response.data.message || "Unable to update customer account.");
        return;
      }
      toast.success(response.data.message);
      onStatusChange?.(response.data.isDisabled, response.data.disabledAt, reason);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update customer account.");
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-4">
      {!hideProfile && (
        <>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Customer 360 profile</p>
          <p className="mt-1 text-xs text-slate-600">
            Account created {dateText(customer.createdAt)} · Last login {dateText(customer.lastLoginAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${customer.isDisabled ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
            {customer.isDisabled ? "Disabled" : "Enabled"}
          </span>
          {canManageAccount && (
            <button
              type="button"
              onClick={updateAccountStatus}
              disabled={savingStatus}
              className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${customer.isDisabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
            >
              {savingStatus ? "Saving..." : customer.isDisabled ? "Re-enable account" : "Disable account"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ["Lifetime purchases", amountText(metrics.totalPurchaseAmount)],
          ["Completed/non-cancelled orders", metrics.orderCount || 0],
          ["Average order", amountText(metrics.averageOrderAmount)],
          ["Cancelled orders", metrics.cancelledOrderCount || 0],
          ["Avg. days between orders", metrics.averageDaysBetweenOrders == null ? "—" : Number(metrics.averageDaysBetweenOrders).toFixed(1)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white p-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
            <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <Section title="Account, contact & addresses">
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <p><b>Email:</b> {customer.email || "—"} {customer.emailVerified ? "(verified)" : "(not verified)"}</p>
          <p><b>Phone:</b> {customer.phone || "—"} {customer.phoneVerified ? "(verified)" : "(not verified)"}</p>
          <p><b>Account status:</b> {customer.accountStatus || "Profile only"}</p>
          <p><b>Gender:</b> {customer.gender || "—"}</p>
          {(customer.addresses || []).map((address, index) => (
            <p key={`${address.street || address.city || "address"}-${index}`} className="sm:col-span-2">
              <b>Address {index + 1}:</b> {[address.street, address.landmark, address.city, address.district, address.province, address.zipcode].filter(Boolean).join(", ") || "—"}
            </p>
          ))}
        </div>
        {customer.isDisabled && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">
            Disabled {dateText(customer.disabledAt)} · Reason: {customer.disabledReason || "Not recorded"}
          </p>
        )}
      </Section>
        </>
      )}

      {!hideOrders && (
      <Section title="Order history & delivery/COD" count={orders.length}>
        {orders.length === 0 ? <Empty /> : (
          <div className="space-y-3">
            {orders.map((order) => {
              const delivery = deliveries.get(order.id);
              const assignment = assignments.get(order.id);
              const items = Array.isArray(order.items) ? order.items : [];
              return (
                <article key={order.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">Order {order.id}</p>
                      <p className="text-[11px] text-slate-500">Created {dateText(Number(order.date))} · {order.orderType || "ONLINE_STORE"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black">{amountText(order.amount)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(order.status)}`}>{order.status}</span>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    <p><b>Payment:</b> {order.payment ? "Paid" : "Unpaid"} · {order.paymentMethod}</p>
                    <p><b>Fulfillment:</b> {order.fulfillmentStatus || "—"}</p>
                    <p><b>Delivered:</b> {dateText(delivery?.deliveredAt || assignment?.deliveredAt)}</p>
                    <p><b>Delivery:</b> {assignment
                      ? `${assignment.deliveryType} · ${assignment.status} · ${assignment.distributor?.name || assignment.manufacturer?.name || "Assigned hub"}`
                      : delivery
                        ? `${delivery.deliveryType} · ${delivery.state} · NCM ${delivery.ncmStatus || "—"}`
                        : "No delivery record"}</p>
                    <p><b>COD:</b> {amountText(delivery?.codAmount)} · NCM payment {delivery?.ncmPaymentStatus || (order.payment ? "Received/paid" : "Not received/unpaid")}</p>
                    <p><b>Delivery fee:</b> {amountText(order.deliveryFee)} · NCM fee {amountText(delivery?.ncmDeliveryCharge)}</p>
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Items</p>
                    {items.map((item, index) => {
                      const details = products.find((entry) => (entry.productId || entry.id) === (item.productId || item.id));
                      const title = item.name || item.productName || details?.product?.name || "Product";
                      return (
                        <p key={`${order.id}-${index}`} className="text-xs text-slate-700">
                          {title} · {item.size || "—"} / {item.color || "—"} · Qty {item.quantity || item.qty || 1} · {amountText(item.price || item.unitPrice)}
                        </p>
                      );
                    })}
                  </div>
                  {delivery?.events?.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Delivery events</p>
                      {delivery.events.map((event, index) => (
                        <p key={`${order.id}-event-${index}`} className="text-[11px] text-slate-600">
                          {dateText(event.occurredAt)} · {event.eventType} · {event.fromState || "—"} → {event.toState || event.ncmStatus || "—"}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Section>
      )}

      <Section title="Products purchased & reviews" count={products.length}>
        {products.length === 0 && productReviews.length === 0 && distributorReviews.length === 0 ? <Empty /> : (
          <div className="space-y-2">
            {products.map((item, index) => (
              <p key={`${item.productId || item.id}-${index}`} className="text-xs text-slate-700">
                <b>{item.name || item.productName || item.product?.name || "Product"}</b> · {item.category || item.product?.category || "—"} / {item.subCategory || item.product?.subCategory || "—"} · {item.size || "—"} · {item.color || "—"} · Qty {item.quantity || item.qty || 1}
              </p>
            ))}
            {productReviews.map((review) => (
              <div key={review.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                <b>{review.product?.name || "Product"} · {review.rating}/5</b> · {dateText(Number(review.date))}
                {review.title && <p className="mt-1 font-semibold">{review.title}</p>}
                <p className="mt-1 whitespace-pre-wrap">{review.comment}</p>
              </div>
            ))}
            {distributorReviews.map((review) => (
              <div key={review.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                <b>{review.distributor?.name || "Distributor"} · {review.rating}/5</b> · {dateText(review.createdAt)}
                <p className="mt-1 whitespace-pre-wrap">{review.comment || "No written review."}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Returns & exchanges" count={returns.length + exchanges.length}>
        {returns.length === 0 && exchanges.length === 0 ? <Empty /> : (
          <div className="space-y-2">
            {returns.map((request) => (
              <div key={`return-${request.id}`} className="rounded-lg border border-slate-200 p-3 text-xs">
                <p className="font-bold">Return · {request.lifecycleStatus || request.refundStatus} · {dateText(request.createdAt)}</p>
                <p>Order {request.orderId || "—"} · Refund {amountText(request.totalRefundAmount)} · Route {request.deliveryRoute || "—"}</p>
                <p className="mt-1 whitespace-pre-wrap">{request.reason}</p>
                {(request.events || []).map((event) => <p key={event.id} className="text-[11px] text-slate-500">{dateText(event.occurredAt)} · {event.eventType} · {event.toStatus || event.status || ""}</p>)}
              </div>
            ))}
            {exchanges.map((request) => (
              <div key={`exchange-${request.id}`} className="rounded-lg border border-slate-200 p-3 text-xs">
                <p className="font-bold">Exchange · {request.status} · {dateText(request.createdAt)}</p>
                <p>Order {request.orderId} · Route {request.deliveryRoute || "—"} · Difference {amountText(request.priceDifference)}</p>
                <p className="mt-1 whitespace-pre-wrap">{request.reasonDetails || request.reasonCode}</p>
                {(request.events || []).map((event) => <p key={event.id} className="text-[11px] text-slate-500">{dateText(event.occurredAt)} · {event.eventType} · {event.fromStatus || "—"} → {event.toStatus || "—"}{event.reason ? ` · ${event.reason}` : ""}</p>)}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Marketing cards & rewards" count={cardLinks.length + cardOrders.length + redemptions.length}>
        {cardLinks.length === 0 && cardOrders.length === 0 && redemptions.length === 0 ? <Empty /> : (
          <div className="space-y-2 text-xs">
            {cardLinks.map((link) => (
              <div key={link.id} className="rounded-lg bg-slate-50 p-3">
                <b>Card {link.card?.cardCode || link.cardId}</b> · {link.status} · Linked {dateText(link.linkedAt)} · Activated {dateText(link.activatedAt)}
                <p>Campaign: {link.card?.campaign?.name || "—"} · Benefit: {link.card?.benefit?.name || "—"}</p>
                {(link.card?.events || []).map((event, index) => <p key={`${link.id}-event-${index}`} className="text-[11px] text-slate-500">{dateText(event.createdAt)} · {event.eventType} · {event.fromStatus || "—"} → {event.toStatus || "—"}</p>)}
              </div>
            ))}
            {cardOrders.map((link) => <p key={link.id}><b>Order card:</b> {link.card?.cardCode || link.cardId} · Order {link.orderId} · {link.card?.campaign?.name || "—"} · Attached {dateText(link.attachedAt)}</p>)}
            {redemptions.map((redemption) => <p key={`${redemption.cardId}-${redemption.benefitId}`}><b>{redemption.benefit?.name || "Benefit"}</b> · {redemption.status} · Campaign {redemption.card?.campaign?.name || "—"} · Redeemed {dateText(redemption.redeemedAt)}</p>)}
          </div>
        )}
      </Section>

      <Section title="Letters & loyalty activity" count={letterDeliveries.length + (data?.letters || []).length}>
        {letterDeliveries.length === 0 && !(data?.letters || []).length && storyAssignments.length === 0 ? <Empty /> : (
          <div className="space-y-2 text-xs">
            {storyAssignments.map((assignment) => <p key={assignment.id}><b>Story:</b> {assignment.story?.title || "—"} · {assignment.status} · Next sequence #{assignment.nextSequenceNumber} · Started {dateText(assignment.startedAt)}</p>)}
            {letterDeliveries.map((letter) => (
              <div key={letter.id} className="rounded-lg bg-slate-50 p-3">
                <b>{letter.storyLetter?.title || letter.template?.name || "Story letter"}</b> · {letter.status} · Order {letter.orderId} · {dateText(letter.createdAt)}
                <p>Story: {letter.story?.title || "—"} · Sequence {letter.storyLetter?.sequenceNumber || "—"} · Printed {dateText(letter.printedAt)} · Delivered {dateText(letter.deliveredAt)}</p>
                {letter.renderedContent && <details className="mt-1"><summary className="cursor-pointer font-semibold">View letter content</summary><p className="mt-1 whitespace-pre-wrap">{letter.renderedContent}</p></details>}
                {letter.renderedDocumentUrl && <a className="mt-1 inline-block text-indigo-700 underline" href={letter.renderedDocumentUrl} target="_blank" rel="noreferrer">Open rendered letter</a>}
              </div>
            ))}
            {(data?.letters || []).map((letter) => (
              <div key={letter.id} className="rounded-lg bg-slate-50 p-3">
                <b>{letter.title || "Handwritten letter"}</b> · {dateText(letter.createdAt)} · {letter.orderId ? `Order ${letter.orderId}` : "General"}
                {letter.notes && <p className="mt-1">{letter.notes}</p>}
                {letter.imageUrl && <a className="mt-1 inline-block text-indigo-700 underline" href={letter.imageUrl} target="_blank" rel="noreferrer">Open archived letter image</a>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Notification history" count={notifications.length}>
        {notifications.length === 0 ? (
          <Empty>No notification records are currently associated with this customer&apos;s email or phone.</Empty>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <div key={notification.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <b>{notification.subject || notification.type || notification.template || "Notification"}</b>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(notification.status)}`}>{notification.status}</span>
                </div>
                <p>{notification.channel} · {notification.type} · {dateText(notification.createdAt)} · Provider {notification.provider || "—"} · Attempts {notification.attemptCount}</p>
                {notification.message && <p className="mt-1 whitespace-pre-wrap">{notification.message}</p>}
                {notification.failureCode && <p className="mt-1 text-red-700">Failure code: {notification.failureCode}</p>}
              </div>
            ))}
            <p className="text-[10px] text-slate-500">This list includes recorded notification activity only; it does not imply that every order event sends a notification.</p>
          </div>
        )}
      </Section>
    </div>
  );
};

export default Customer360Panel;
