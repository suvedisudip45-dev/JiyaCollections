import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  RefreshCcw, Gift, Search, Filter, Calendar,
  CreditCard, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight
} from "lucide-react";
import { redemptionsApi, campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";
import EmptyState from "../../components/common/EmptyState";
import Pagination from "../../components/common/Pagination";

const RedemptionsPage = () => {
  const [redemptions, setRedemptions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("");

  // Fetch campaigns for dropdown filter
  useEffect(() => {
    campaignsApi.list().then((res) => {
      if (res.data?.success) {
        setCampaigns(res.data.campaigns || []);
      }
    }).catch(() => {});
  }, []);

  const fetchRedemptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await redemptionsApi.list({
        campaignId: selectedCampaign || undefined,
        page,
        limit,
      });
      if (res.data?.success) {
        setRedemptions(res.data.redemptions || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load redemptions history."));
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign, page, limit]);

  useEffect(() => {
    fetchRedemptions();
  }, [fetchRedemptions]);

  // Client search filter
  const filtered = redemptions.filter((r) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (r.card?.cardCode && r.card.cardCode.toLowerCase().includes(q)) ||
      (r.benefit?.name && r.benefit.name.toLowerCase().includes(q)) ||
      (r.id && r.id.toLowerCase().includes(q)) ||
      (r.card?.campaign?.name && r.card.campaign.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Redemption History</h2>
          <p className="text-xs text-[var(--mp-muted)] mt-0.5">
            Audit log of all marketing benefits claimed by customers across your campaigns
          </p>
        </div>
        <button
          onClick={fetchRedemptions}
          className="p-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-white text-[var(--mp-ink-2)] transition-colors flex items-center gap-2 text-xs font-semibold"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-[var(--mp-line)] shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--mp-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Card Code, Benefit, Redemption ID..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[var(--mp-line)] focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all placeholder:text-[var(--mp-muted)]"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={selectedCampaign}
            onChange={(e) => { setSelectedCampaign(e.target.value); setPage(1); }}
            className="w-full md:w-auto px-3 py-2 text-xs font-semibold rounded-xl border border-[var(--mp-line)] bg-white text-[var(--mp-ink)] focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-xs"
          >
            <option value="">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error state */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700">
          <AlertCircle size={32} className="mx-auto mb-2 text-red-500" />
          <p className="font-bold text-sm">{error}</p>
          <button
            onClick={fetchRedemptions}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-3xl border border-[var(--mp-line)] p-6 space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={Gift}
          title="No redemptions found"
          description={
            search || selectedCampaign
              ? "No redemptions matched your search or campaign filter."
              : "No benefits have been redeemed yet for your partner campaigns."
          }
        />
      )}

      {/* Redemptions Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white rounded-3xl border border-[var(--mp-line)] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs responsive-table">
              <thead className="bg-[var(--mp-bg)] border-b border-[var(--mp-line)] text-[var(--mp-muted)] font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Redemption Date</th>
                  <th className="py-3.5 px-4">Card Code</th>
                  <th className="py-3.5 px-4">Campaign</th>
                  <th className="py-3.5 px-4">Benefit Claimed</th>
                  <th className="py-3.5 px-4">Value</th>
                  <th className="py-3.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--mp-line)] text-[var(--mp-ink)]">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--mp-surface-2)] transition-colors">
                    {/* Date */}
                    <td className="py-3.5 px-4 sm:px-6 font-medium text-[var(--mp-ink-2)]" data-label="Date">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-[var(--mp-muted)] flex-shrink-0" />
                        <span>{new Date(r.redeemedAt).toLocaleString()}</span>
                      </div>
                    </td>

                    {/* Card Code */}
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-700" data-label="Card Code">
                      {r.card?.id ? (
                        <Link to={`/cards/${r.card.id}`} className="hover:underline flex items-center gap-1.5">
                          <CreditCard size={13} className="text-brand-500 flex-shrink-0" />
                          <span>{r.card?.cardCode}</span>
                        </Link>
                      ) : (
                        <span>{r.card?.cardCode || "—"}</span>
                      )}
                    </td>

                    {/* Campaign */}
                    <td className="py-3.5 px-4 font-semibold" data-label="Campaign">
                      {r.card?.campaign?.name || "—"}
                    </td>

                    {/* Benefit */}
                    <td className="py-3.5 px-4 font-medium" data-label="Benefit">
                      <span className="inline-flex items-center gap-1 text-[var(--mp-ink)]">
                        <Gift size={12} className="text-emerald-600" />
                        {r.benefit?.name || "Standard Benefit"}
                      </span>
                    </td>

                    {/* Value */}
                    <td className="py-3.5 px-4" data-label="Value">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-bold text-[11px]">
                        {r.benefit?.value > 0 ? `${r.benefit.value}% OFF` : r.benefit?.benefitType || "REWARD"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 text-right" data-label="Status">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] uppercase">
                        <CheckCircle2 size={11} />
                        Redeemed
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-[var(--mp-line)] flex items-center justify-between">
            <span className="text-xs text-[var(--mp-muted)]">
              Showing {redemptions.length} of {total} redemptions
            </span>
            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={limit}
              onPageChange={(newPage) => setPage(newPage)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default RedemptionsPage;
