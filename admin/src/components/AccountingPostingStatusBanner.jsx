/* eslint-disable react/prop-types */
import { Link } from "react-router-dom";

const formatAmount = (amount) => {
  if (amount === null || amount === undefined || amount === "") return "Unavailable";
  return `Rs ${Number(amount).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const AccountingPostingStatusBanner = ({ status }) => {
  if (!status || Number(status.unpostedCount || 0) === 0) return null;

  return (
    <section
      role="status"
      className="border border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3"
    >
      <div>
        <h2 className="text-sm font-bold text-amber-950">Delivered sales awaiting GL posting</h2>
        <p className="mt-1 text-xs text-amber-900">
          These delivery events are not included in the posted ledger balances below. The scheduled worker retries
          failed postings; review blocked or repeatedly failing events before relying on these statements.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-amber-950">
        <span>Pending: <strong>{status.pendingCount || 0}</strong></span>
        <span>Processing: <strong>{status.processingCount || 0}</strong></span>
        <span>Failed: <strong>{status.failedCount || 0}</strong></span>
        <span>Blocked: <strong>{status.blockedCount || 0}</strong></span>
      </div>
      {status.events?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs text-left">
            <thead className="text-amber-900">
              <tr>
                <th className="py-1 pr-3">Order</th>
                <th className="py-1 pr-3">Delivered-sale amount</th>
                <th className="py-1 pr-3">Posting state</th>
                <th className="py-1 pr-3">Attempts</th>
                <th className="py-1">Next retry</th>
              </tr>
            </thead>
            <tbody>
              {status.events.map((event) => (
                <tr key={event.id} className="border-t border-amber-200 text-amber-950">
                  <td className="py-1.5 pr-3 font-mono">{event.orderId}</td>
                  <td className="py-1.5 pr-3">{formatAmount(event.grossAmount)}</td>
                  <td className="py-1.5 pr-3 font-semibold">{event.status}</td>
                  <td className="py-1.5 pr-3">{event.attemptCount}</td>
                  <td className="py-1.5">
                    {event.nextAttemptAt ? new Date(event.nextAttemptAt).toLocaleString() : "Manual review required"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {status.unpostedCount > status.events.length && (
            <p className="mt-1 text-[11px] text-amber-900">
              Showing up to {status.events.length} unresolved events, ordered by state and age.
            </p>
          )}
        </div>
      )}
      <Link to="/journal-entries" className="inline-block text-xs font-semibold text-amber-950 underline">
        Review journal postings
      </Link>
    </section>
  );
};

export default AccountingPostingStatusBanner;
