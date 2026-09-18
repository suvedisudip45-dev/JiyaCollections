import React from "react";

export const StatusBadge = ({ status, deliveryStatus }) => {
  const getBadgeConfig = () => {
    // If explicit live delivery status from carrier is provided, prioritize it
    const active = String(deliveryStatus || status || "").toLowerCase().trim();

    switch (active) {
      case "assigned":
        return {
          bg: "bg-amber-50 text-amber-700 border-amber-200",
          dot: "bg-amber-500 animate-pulse",
          label: "New Order (Pending Acceptance)",
        };
      case "accepted":
        return {
          bg: "bg-blue-50 text-blue-700 border-blue-200",
          dot: "bg-blue-500",
          label: "Accepted",
        };
      case "preparing":
      case "in_production":
        return {
          bg: "bg-indigo-50 text-indigo-700 border-indigo-200",
          dot: "bg-indigo-500 animate-pulse",
          label: "In Production / Packing",
        };
      case "packed":
        return {
          bg: "bg-purple-50 text-purple-700 border-purple-200",
          dot: "bg-purple-500",
          label: "Packed & Sealed",
        };
      case "ncm_created":
      case "pickup_order_created":
      case "pickup order created":
        return {
          bg: "bg-orange-50 text-orange-700 border-orange-200",
          dot: "bg-orange-500 animate-pulse",
          label: "Courier Booked (Awaiting Pickup)",
        };
      case "ready_for_pickup":
      case "sent for pickup":
        return {
          bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
          dot: "bg-emerald-500 animate-pulse",
          label: "Ready for Courier Pickup",
        };
      case "picked_up":
      case "pickup complete":
      case "pickup_completed":
        return {
          bg: "bg-teal-50 text-teal-700 border-teal-200",
          dot: "bg-teal-500",
          label: "Picked Up by Courier",
        };
      case "in_transit":
      case "in transit":
      case "dispatched":
      case "order_dispatched":
      case "order_dispached":
        return {
          bg: "bg-sky-50 text-sky-700 border-sky-200",
          dot: "bg-sky-500 animate-pulse",
          label: "Dispatched / In Transit",
        };
      case "arrived":
      case "order_arrived":
      case "arrived_at_destination":
        return {
          bg: "bg-cyan-50 text-cyan-700 border-cyan-200",
          dot: "bg-cyan-500",
          label: "Arrived at Destination Hub",
        };
      case "out_for_delivery":
      case "sent for delivery":
      case "sent_for_delivery":
        return {
          bg: "bg-violet-50 text-violet-700 border-violet-200",
          dot: "bg-violet-500 animate-pulse",
          label: "Out for Delivery (Rider Dispatched)",
        };
      case "delivered":
      case "delivery_completed":
        return {
          bg: "bg-green-50 text-green-700 border-green-200",
          dot: "bg-green-600",
          label: "Delivered to Customer",
        };
      case "rejected":
        return {
          bg: "bg-rose-50 text-rose-700 border-rose-200",
          dot: "bg-rose-500",
          label: "Rejected",
        };
      case "cancelled":
        return {
          bg: "bg-slate-100 text-slate-700 border-slate-200",
          dot: "bg-slate-400",
          label: "Cancelled",
        };
      case "return_requested":
      case "returned":
        return {
          bg: "bg-rose-50 text-rose-700 border-rose-200",
          dot: "bg-rose-600 animate-pulse",
          label: "Return Requested",
        };
      default:
        return {
          bg: "bg-slate-100 text-slate-600 border-slate-200",
          dot: "bg-slate-400",
          label: (deliveryStatus || status || "Unknown").replace(/_/g, " "),
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.bg}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
};

export default StatusBadge;
