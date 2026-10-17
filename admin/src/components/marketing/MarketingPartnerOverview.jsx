/* eslint-disable react/prop-types */

import { Link } from "react-router-dom";

const formatCount = (value) => (value ?? 0).toLocaleString();

const MiniBar = ({ value, total, color }) => {
  const width = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] text-slate-500">{width}%</span>
    </div>
  );
};

const MarketingPartnerOverview = ({
  partners,
  partnerBreakdown,
  approvalCodes,
  onApprovalCodeChange,
  onApprove,
  working,
}) => {
  const pendingPartners = partners.filter((partner) => partner.status === "PENDING");

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-black text-slate-900">Marketing Partner Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-500">Cards printed and distributed per partner.</p>
          </div>
          <span className="text-xs text-slate-400">{partnerBreakdown.length} partners</span>
        </div>
        {!partnerBreakdown.length ? (
          <p className="p-6 text-sm text-slate-500">No partner data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Partner</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Total Cards</th>
                  <th className="px-5 py-3 text-right">Generated</th>
                  <th className="px-5 py-3 text-right">Assigned</th>
                  <th className="px-5 py-3 text-right">Available</th>
                  <th className="px-5 py-3 text-right">Attached</th>
                  <th className="px-5 py-3 text-right">Cancelled</th>
                  <th className="px-5 py-3">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {partnerBreakdown.map(({ partner, total, GENERATED, ASSIGNED, AVAILABLE, ATTACHED, CANCELLED }) => (
                  <tr key={partner.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link to={`/marketing-partners/${partner.id}`} className="font-bold text-slate-800 hover:text-indigo-700">{partner.name}</Link>
                      <p className="font-mono text-slate-400">{partner.code}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${partner.status === "ACTIVE" ? "bg-sky-100 text-sky-800" : "bg-red-100 text-red-700"}`}>
                        {partner.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-black text-slate-900">{formatCount(total)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatCount(GENERATED)}</td>
                    <td className="px-5 py-3 text-right font-bold text-amber-700">{formatCount(ASSIGNED)}</td>
                    <td className="px-5 py-3 text-right font-bold text-sky-700">{formatCount(AVAILABLE)}</td>
                    <td className="px-5 py-3 text-right font-bold text-indigo-700">{formatCount(ATTACHED)}</td>
                    <td className="px-5 py-3 text-right font-bold text-red-600">{formatCount(CANCELLED)}</td>
                    <td className="min-w-[120px] space-y-1 px-5 py-3">
                      <MiniBar value={ATTACHED || 0} total={total} color="bg-indigo-500" />
                      <MiniBar value={CANCELLED || 0} total={total} color="bg-red-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingPartners.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
          <div className="border-b border-amber-200 px-5 py-4">
            <h2 className="text-sm font-black text-amber-950">Pending Partner Approvals</h2>
            <p className="mt-0.5 text-xs text-amber-800">Verify the business, assign a permanent code, and activate portal access.</p>
          </div>
          <div className="divide-y divide-amber-100">
            {pendingPartners.map((partner) => (
              <div key={partner.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">{partner.name}</p>
                  <p className="text-xs text-slate-600">{partner.email || "No email"}</p>
                </div>
                <div className="flex w-full gap-2 md:w-auto">
                  <input
                    value={approvalCodes[partner.id] || ""}
                    onChange={(event) => onApprovalCodeChange(partner.id, event.target.value)}
                    placeholder="Permanent code"
                    className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-mono uppercase md:w-44"
                  />
                  <button type="button" disabled={working} onClick={() => onApprove(partner.id)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50">
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default MarketingPartnerOverview;
