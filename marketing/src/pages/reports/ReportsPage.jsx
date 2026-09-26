import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart3, TrendingUp, Layers, Gift, CheckCircle2,
  MapPin, Calendar, RefreshCcw, AlertCircle, PieChart
} from "lucide-react";
import { metricsApi, campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";

const ReportsPage = () => {
  const [metrics, setMetrics] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, cRes] = await Promise.all([
        metricsApi.get(),
        campaignsApi.list(),
      ]);
      if (mRes.data?.success) setMetrics(mRes.data.metrics);
      if (cRes.data?.success) setCampaigns(cRes.data.campaigns || []);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load report analytics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
        <Skeleton className="h-80 w-full rounded-3xl" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center text-red-700 max-w-lg mx-auto">
        <AlertCircle size={36} className="mx-auto mb-2 text-red-500" />
        <h3 className="text-base font-bold">Failed to load reports</h3>
        <p className="text-xs mt-1">{error}</p>
        <button
          onClick={fetchData}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const physical = metrics.physical || {};
  const totalCards = metrics.totalCards || 0;
  const activated = metrics.activated || 0;
  const redeemed = metrics.redeemed || 0;

  const activationRate = totalCards > 0 ? ((activated / totalCards) * 100).toFixed(1) : "0.0";
  const redemptionRate = activated > 0 ? ((redeemed / activated) * 100).toFixed(1) : "0.0";

  // Geographic breakdown calculation from campaigns
  const geoBreakdown = {};
  campaigns.forEach((c) => {
    const scope = c.targetScopeType || "NATIONWIDE";
    const loc = scope === "NATIONWIDE" ? "Nationwide" : c.targetProvince || "Regional";
    if (!geoBreakdown[loc]) {
      geoBreakdown[loc] = { campaigns: 0, cards: 0 };
    }
    geoBreakdown[loc].campaigns += 1;
    geoBreakdown[loc].cards += c._count?.cards || 0;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Marketing Analytics & Reports</h2>
          <p className="text-xs text-[var(--mp-muted)] mt-0.5">
            Holistic distribution milestones, activation velocity, and geographic campaign metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-[var(--mp-line)] bg-white text-[var(--mp-ink)] focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All-Time Report</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
          <button
            onClick={fetchData}
            className="p-2 rounded-xl border border-[var(--mp-line)] hover:bg-white text-[var(--mp-ink-2)]"
            title="Refresh"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
      </div>

      {/* Primary KPI Conversion Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--mp-muted)]">Card Distribution</span>
            <Layers size={18} className="text-blue-500" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-[var(--mp-ink)]">{totalCards.toLocaleString()}</div>
            <p className="text-xs text-[var(--mp-muted)] mt-1">
              {(physical.ATTACHED || 0).toLocaleString()} cards on customer garments
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--mp-line)] text-xs text-[var(--mp-ink-2)] flex justify-between">
            <span>Inventory:</span>
            <span className="font-bold">{physical.GENERATED || 0} cards</span>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--mp-muted)]">Customer Activation</span>
            <CheckCircle2 size={18} className="text-teal-500" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-teal-700">{activationRate}%</div>
            <p className="text-xs text-[var(--mp-muted)] mt-1">
              {activated.toLocaleString()} cards activated by verified users
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--mp-line)] text-xs text-[var(--mp-ink-2)] flex justify-between">
            <span>Total Activated:</span>
            <span className="font-bold text-teal-700">{activated.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--mp-muted)]">Redemption Conversion</span>
            <Gift size={18} className="text-emerald-500" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-emerald-700">{redemptionRate}%</div>
            <p className="text-xs text-[var(--mp-muted)] mt-1">
              {redeemed.toLocaleString()} benefits claimed by customers
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--mp-line)] text-xs text-[var(--mp-ink-2)] flex justify-between">
            <span>Total Redeemed:</span>
            <span className="font-bold text-emerald-700">{redeemed.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Grid: Physical Status Breakdown & Regional distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Physical Status Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
          <h3 className="text-sm font-bold text-[var(--mp-ink)] mb-4 flex items-center gap-2">
            <PieChart size={16} className="text-brand-600" />
            Physical Status Breakdown
          </h3>

          <div className="space-y-3">
            {[
              { label: "Generated / In Stock", key: "GENERATED", color: "bg-blue-500" },
              { label: "Assigned to Manufacturer", key: "ASSIGNED", color: "bg-amber-500" },
              { label: "Received by Manufacturer", key: "RECEIVED", color: "bg-purple-500" },
              { label: "Attached to Garment", key: "ATTACHED", color: "bg-indigo-500" },
              { label: "Available in Floor", key: "AVAILABLE", color: "bg-teal-500" },
              { label: "Cancelled", key: "CANCELLED", color: "bg-red-500" },
            ].map((st) => {
              const count = physical[st.key] || 0;
              const pct = totalCards > 0 ? Math.round((count / totalCards) * 100) : 0;

              return (
                <div key={st.key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-[var(--mp-ink)]">{st.label}</span>
                    <span className="font-bold text-[var(--mp-ink-2)]">
                      {count.toLocaleString()} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-[var(--mp-bg)] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${st.color} rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Geographic Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm">
          <h3 className="text-sm font-bold text-[var(--mp-ink)] mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-brand-600" />
            Regional Campaign Scope
          </h3>

          {Object.keys(geoBreakdown).length === 0 ? (
            <p className="text-xs text-[var(--mp-muted)] italic">No campaigns found.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(geoBreakdown).map(([region, data]) => (
                <div
                  key={region}
                  className="p-3.5 rounded-2xl border border-[var(--mp-line)] bg-[var(--mp-surface-2)] flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-[var(--mp-brand-light)] text-brand-700 flex items-center justify-center font-bold">
                      <MapPin size={14} />
                    </div>
                    <div>
                      <span className="font-bold text-[var(--mp-ink)]">{region}</span>
                      <p className="text-[11px] text-[var(--mp-muted)]">{data.campaigns} campaign(s)</p>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-brand-700 bg-white px-3 py-1 rounded-xl border border-[var(--mp-line)]">
                    {data.cards.toLocaleString()} cards
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
