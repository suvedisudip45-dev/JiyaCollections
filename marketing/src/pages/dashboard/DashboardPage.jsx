import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Megaphone, CreditCard, CheckCircle2, Gift, RefreshCcw,
  ArrowRight, TrendingUp, Layers, MapPin, AlertCircle, ChevronRight
} from "lucide-react";
import { metricsApi, campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";
import EmptyState from "../../components/common/EmptyState";

const TIME_RANGES = [
  { id: "all", label: "All Time" },
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
];

const StatCard = ({ title, value, subtitle, icon: Icon, color, linkTo }) => {
  const content = (
    <div className="bg-white rounded-2xl p-5 border border-[var(--mp-line)] shadow-sm hover:shadow-md transition-all group flex flex-col justify-between h-full">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold text-[var(--mp-ink-2)] uppercase tracking-wider">{title}</span>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}>
          <Icon size={20} strokeWidth={2} />
        </div>
      </div>
      <div>
        <div className="text-3xl font-extrabold text-[var(--mp-ink)] tracking-tight">
          {typeof value === "number" ? value.toLocaleString() : value ?? 0}
        </div>
        {subtitle && <p className="text-xs text-[var(--mp-muted)] mt-1">{subtitle}</p>}
      </div>
      {linkTo && (
        <div className="mt-3 pt-3 border-t border-[var(--mp-line)] flex items-center justify-between text-xs font-semibold text-brand-600 group-hover:text-brand-700">
          <span>View details</span>
          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </div>
      )}
    </div>
  );

  return linkTo ? <Link to={linkTo} className="block">{content}</Link> : content;
};

const DashboardPage = () => {
  const { partner } = useAuth();
  const [selectedRange, setSelectedRange] = useState("all");
  const [metrics, setMetrics] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, cRes] = await Promise.all([
        metricsApi.get(),
        campaignsApi.list({ limit: 5 }),
      ]);
      if (mRes.data?.success) setMetrics(mRes.data.metrics);
      if (cRes.data?.success) setCampaigns(cRes.data.campaigns || []);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load dashboard data."));
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
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 lg:col-span-2 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
        <AlertCircle size={36} className="mx-auto mb-2 text-red-500" />
        <h3 className="text-lg font-bold">Failed to load dashboard</h3>
        <p className="text-sm mt-1">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl font-semibold text-sm hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const physical = metrics?.physical || {};
  const totalCards = metrics?.totalCards || 0;
  const activated = metrics?.activated || 0;
  const redeemed = metrics?.redeemed || 0;
  const totalCampaigns = metrics?.totalCampaigns || 0;

  // Calculate funnel stages
  const generated = physical.GENERATED || 0;
  const assigned = (physical.ASSIGNED || 0) + (physical.RECEIVED || 0) + (physical.AVAILABLE || 0) + (physical.ATTACHED || 0);
  const attached = physical.ATTACHED || 0;

  const funnel = [
    { label: "1. Generated", count: totalCards, pct: totalCards > 0 ? 100 : 0, color: "bg-blue-500" },
    { label: "2. Assigned to Mfr", count: assigned, pct: totalCards > 0 ? Math.round((assigned / totalCards) * 100) : 0, color: "bg-amber-500" },
    { label: "3. Garment Attached", count: attached, pct: totalCards > 0 ? Math.round((attached / totalCards) * 100) : 0, color: "bg-indigo-500" },
    { label: "4. Customer Activated", count: activated, pct: totalCards > 0 ? Math.round((activated / totalCards) * 100) : 0, color: "bg-teal-500" },
    { label: "5. Benefit Redeemed", count: redeemed, pct: totalCards > 0 ? Math.round((redeemed / totalCards) * 100) : 0, color: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-6">
      {/* Top Welcome Bar */}
      <div className="bg-gradient-to-r from-brand-800 to-brand-600 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Partner Portal
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Welcome back, {partner?.name}
            </h2>
            <p className="text-brand-100 text-sm mt-1 max-w-xl">
              Monitor your card campaigns, distribution milestones, QR validation, and benefit redemptions in real-time.
            </p>
          </div>
          <div className="flex items-center gap-2 self-stretch md:self-auto">
            <Link
              to="/qr-validator"
              className="flex-1 md:flex-initial px-5 py-3 rounded-xl bg-white text-brand-800 font-bold text-sm shadow-md hover:bg-brand-50 transition-all text-center flex items-center justify-center gap-2"
            >
              <Gift size={16} />
              Validate QR
            </Link>
            <button
              onClick={fetchData}
              title="Refresh data"
              className="p-3 rounded-xl bg-brand-700/60 hover:bg-brand-700 text-white backdrop-blur-sm transition-colors"
            >
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter / Time range pill */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto pb-1">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--mp-muted)]">Timeframe:</span>
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[var(--mp-line)]">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedRange(r.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedRange === r.id
                  ? "bg-brand-600 text-white shadow-xs"
                  : "text-[var(--mp-ink-2)] hover:bg-[var(--mp-brand-light)]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Campaigns"
          value={totalCampaigns}
          subtitle="Configured marketing initiatives"
          icon={Megaphone}
          color="bg-brand-50 text-brand-600"
          linkTo="/campaigns"
        />
        <StatCard
          title="Total Cards"
          value={totalCards}
          subtitle={`${attached} cards attached to orders`}
          icon={CreditCard}
          color="bg-blue-50 text-blue-600"
          linkTo="/cards"
        />
        <StatCard
          title="Cards Activated"
          value={activated}
          subtitle={`${totalCards > 0 ? Math.round((activated / totalCards) * 100) : 0}% activation rate`}
          icon={CheckCircle2}
          color="bg-teal-50 text-teal-600"
          linkTo="/cards"
        />
        <StatCard
          title="Benefits Redeemed"
          value={redeemed}
          subtitle={`${activated > 0 ? Math.round((redeemed / activated) * 100) : 0}% conversion of active`}
          icon={Gift}
          color="bg-emerald-50 text-emerald-600"
          linkTo="/redemptions"
        />
      </div>

      {/* Main Grid: Funnel & Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Distribution Funnel */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-[var(--mp-ink)]">Card Distribution Funnel</h3>
              <p className="text-xs text-[var(--mp-muted)] mt-0.5">End-to-end lifecycle progression of your marketing cards</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--mp-brand-light)] text-brand-700">
              Live Tracker
            </span>
          </div>

          <div className="space-y-4">
            {funnel.map((step, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-[var(--mp-ink-2)]">
                  <span>{step.label}</span>
                  <div className="flex gap-2">
                    <span className="font-bold text-[var(--mp-ink)]">{step.count.toLocaleString()} cards</span>
                    <span className="text-[var(--mp-muted)]">({step.pct}%)</span>
                  </div>
                </div>
                <div className="h-3 w-full bg-[var(--mp-bg)] rounded-full overflow-hidden border border-[var(--mp-line)]/50">
                  <div
                    className={`h-full ${step.color} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.max(step.pct, step.count > 0 ? 3 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Quick Metrics Footer */}
          <div className="mt-8 pt-6 border-t border-[var(--mp-line)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="p-3 rounded-2xl bg-[var(--mp-bg)]">
              <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">In Inventory</span>
              <p className="text-lg font-bold text-[var(--mp-ink)] mt-0.5">{physical.GENERATED || 0}</p>
            </div>
            <div className="p-3 rounded-2xl bg-[var(--mp-bg)]">
              <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">With Manufacturer</span>
              <p className="text-lg font-bold text-[var(--mp-ink)] mt-0.5">{(physical.ASSIGNED || 0) + (physical.RECEIVED || 0)}</p>
            </div>
            <div className="p-3 rounded-2xl bg-[var(--mp-bg)]">
              <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">On Customer Order</span>
              <p className="text-lg font-bold text-[var(--mp-ink)] mt-0.5">{physical.ATTACHED || 0}</p>
            </div>
            <div className="p-3 rounded-2xl bg-[var(--mp-bg)]">
              <span className="text-[10px] font-bold uppercase text-[var(--mp-muted)]">Cancelled</span>
              <p className="text-lg font-bold text-red-600 mt-0.5">{physical.CANCELLED || 0}</p>
            </div>
          </div>
        </div>

        {/* Recent Campaigns Widget */}
        <div className="bg-white rounded-3xl p-6 border border-[var(--mp-line)] shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--mp-ink)]">Active Campaigns</h3>
              <Link to="/campaigns" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                View all
              </Link>
            </div>

            {campaigns.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="No campaigns yet"
                description="Your active marketing campaigns will appear here."
              />
            ) : (
              <div className="space-y-3">
                {campaigns.slice(0, 4).map((c) => (
                  <Link
                    key={c.id}
                    to={`/campaigns/${c.id}`}
                    className="p-3.5 rounded-2xl border border-[var(--mp-line)] hover:border-brand-300 hover:bg-[var(--mp-surface-2)] transition-all flex items-center justify-between group block"
                  >
                    <div className="space-y-1 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--mp-ink)] truncate group-hover:text-brand-700">
                          {c.name}
                        </span>
                        <Badge status={c.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--mp-muted)]">
                        <span className="flex items-center gap-1">
                          <MapPin size={12} />
                          {c.targetScopeType}
                        </span>
                        <span>•</span>
                        <span>{c._count?.cards || 0} cards</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-[var(--mp-muted)] group-hover:text-brand-600 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[var(--mp-line)]">
            <Link
              to="/reports"
              className="w-full py-2.5 px-4 rounded-xl border border-[var(--mp-line)] hover:bg-[var(--mp-bg)] text-center text-xs font-bold text-[var(--mp-ink-2)] transition-colors block"
            >
              📊 Open Detailed Analytics
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
