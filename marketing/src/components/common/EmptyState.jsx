import React from "react";
import { AlertTriangle, WifiOff, ShieldX, Search } from "lucide-react";

const ICONS = {
  error:     AlertTriangle,
  network:   WifiOff,
  forbidden: ShieldX,
  empty:     Search,
};

/**
 * Full-state empty/error display for pages.
 * type: "error" | "network" | "forbidden" | "empty"
 */
const EmptyState = ({ type = "empty", title, message, action, className = "" }) => {
  const Icon = ICONS[type] || Search;
  const colors = {
    error:     "text-red-500 bg-red-50",
    network:   "text-orange-500 bg-orange-50",
    forbidden: "text-amber-500 bg-amber-50",
    empty:     "text-[var(--mp-muted)] bg-[var(--mp-brand-light)]",
  };

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${colors[type]}`}>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-bold text-[var(--mp-ink)] mb-1">{title}</h3>
      {message && <p className="text-sm text-[var(--mp-muted)] max-w-xs">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};

export default EmptyState;
