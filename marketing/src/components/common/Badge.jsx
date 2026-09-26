import React from "react";

/** Status badge — maps status strings to color classes */
const STATUS_MAP = {
  // Physical card status
  GENERATED:  "badge-generated",
  ASSIGNED:   "badge-assigned",
  RECEIVED:   "badge-received",
  AVAILABLE:  "badge-available",
  ATTACHED:   "badge-attached",
  RESERVED:   "badge-assigned",
  CANCELLED:  "badge-cancelled",
  // Campaign status
  ACTIVE:     "badge-active",
  INACTIVE:   "badge-inactive",
  DRAFT:      "badge-draft",
  PAUSED:     "badge-paused",
  EXPIRED:    "badge-expired",
  // Redemption
  REDEEMED:   "badge-redeemed",
  LINKED:     "badge-linked",
  // Geography
  NATIONWIDE: "badge-nationwide",
  PROVINCE:   "badge-province",
  DISTRICT:   "badge-district",
};

const Badge = ({ status, className = "", label }) => {
  const colorClass = STATUS_MAP[String(status).toUpperCase()] || "badge-draft";
  const display = label || String(status).charAt(0) + String(status).slice(1).toLowerCase();
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ${colorClass} ${className}`}
    >
      {display}
    </span>
  );
};

export default Badge;
