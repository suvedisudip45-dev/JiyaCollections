import React, { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CreditCard, Search, Filter, RefreshCcw, AlertCircle,
  Eye, CheckCircle2, Gift, Building2, ChevronLeft, ChevronRight
} from "lucide-react";
import { cardsApi, campaignsApi } from "../../api";
import { getErrorMessage } from "../../api/client";
import Badge from "../../components/common/Badge";
import Skeleton from "../../components/common/Skeleton";
import EmptyState from "../../components/common/EmptyState";
import Pagination from "../../components/common/Pagination";

const PHYSICAL_STATUSES = [
  { id: "all", label: "All Physical Statuses" },
  { id: "GENERATED", label: "Generated" },
  { id: "ASSIGNED", label: "Assigned" },
  { id: "RECEIVED", label: "Received by Mfr" },
  { id: "AVAILABLE", label: "Available" },
  { id: "ATTACHED", label: "Attached to Garment" },
  { id: "CANCELLED", label: "Cancelled" },
];

const CardListPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const campaignParam = searchParams.get("campaignId") || "";

  const [cards, setCards] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchCode, setSearchCode] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCampaign, setSelectedCampaign] = useState(campaignParam);

  // Fetch campaign options for filter
  useEffect(() => {
    campaignsApi.list().then((res) => {
      if (res.data?.success) {
        setCampaigns(res.data.campaigns || []);
      }
    }).catch(() => {});
  }, []);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await cardsApi.list({
        campaignId: selectedCampaign || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        page,
        limit,
      });
      if (res.data?.success) {
        setCards(res.data.cards || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load cards."));
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign, statusFilter, page, limit]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  // Sync selected campaign with query param
  const handleCampaignChange = (cId) => {
    setSelectedCampaign(cId);
    setPage(1);
    if (cId) {
      setSearchParams({ campaignId: cId });
    } else {
      setSearchParams({});
    }
  };

  // Filter cards by client-side code search if typed
  const filteredCards = cards.filter((c) =>
    searchCode ? c.cardCode.toLowerCase().includes(searchCode.toLowerCase().trim()) : true
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-[var(--mp-ink)]">Marketing Cards</h2>
          <p className="text-xs text-[var(--mp-muted)] mt-0.5">
            Track individual card codes, manufacturer assignments, and customer activation states
          </p>
        </div>
        <button
          onClick={fetchCards}
          className="p-2.5 rounded-xl border border-[var(--mp-line)] hover:bg-white text-[var(--mp-ink-2)] transition-colors flex items-center gap-2 text-xs font-semibold"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-[var(--mp-line)] shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search by card code */}
        <div className="relative w-full md:w-72">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--mp-muted)]" />
          <input
            type="text"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            placeholder="Search Card Code (e.g. AAMA-NAT)..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[var(--mp-line)] focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all uppercase placeholder:normal-case font-mono"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Campaign Filter */}
          <select
            value={selectedCampaign}
            onChange={(e) => handleCampaignChange(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-[var(--mp-line)] bg-white text-[var(--mp-ink)] focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-[200px]"
          >
            <option value="">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-[var(--mp-line)] bg-white text-[var(--mp-ink)] focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {PHYSICAL_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
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
            onClick={fetchCards}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading table */}
      {loading && (
        <div className="bg-white rounded-3xl border border-[var(--mp-line)] p-6 space-y-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Table & Cards */}
      {!loading && !error && filteredCards.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title="No cards found"
          description={
            searchCode || statusFilter !== "all" || selectedCampaign
              ? "No cards matched your current filter criteria."
              : "No cards have been assigned to your partner account yet."
          }
        />
      )}

      {!loading && !error && filteredCards.length > 0 && (
        <div className="bg-white rounded-3xl border border-[var(--mp-line)] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs responsive-table">
              <thead className="bg-[var(--mp-bg)] border-b border-[var(--mp-line)] text-[var(--mp-muted)] font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Card Code</th>
                  <th className="py-3.5 px-4">Campaign</th>
                  <th className="py-3.5 px-4">Manufacturer</th>
                  <th className="py-3.5 px-4">Physical Status</th>
                  <th className="py-3.5 px-4">Customer Status</th>
                  <th className="py-3.5 px-4">Redemption</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--mp-line)] text-[var(--mp-ink)]">
                {filteredCards.map((card) => {
                  const isActivated = card.customerLinks?.some((l) => l.status === "ACTIVE" || l.status === "LINKED");
                  const isRedeemed = card.benefitRedemptions?.some((r) => r.status === "REDEEMED");

                  return (
                    <tr key={card.id} className="hover:bg-[var(--mp-surface-2)] transition-colors">
                      {/* Card Code */}
                      <td className="py-3.5 px-4 sm:px-6 font-mono font-bold text-brand-700" data-label="Card Code">
                        <Link to={`/cards/${card.id}`} className="hover:underline flex items-center gap-1.5">
                          <CreditCard size={13} className="text-brand-500 flex-shrink-0" />
                          <span>{card.cardCode}</span>
                        </Link>
                      </td>

                      {/* Campaign */}
                      <td className="py-3.5 px-4" data-label="Campaign">
                        <span className="font-semibold">{card.campaign?.name || "—"}</span>
                      </td>

                      {/* Manufacturer */}
                      <td className="py-3.5 px-4" data-label="Manufacturer">
                        {card.assignedManufacturer ? (
                          <span className="inline-flex items-center gap-1 text-[var(--mp-ink-2)]">
                            <Building2 size={12} className="text-[var(--mp-muted)]" />
                            {card.assignedManufacturer.name}
                          </span>
                        ) : (
                          <span className="text-[var(--mp-muted)] italic">Not assigned</span>
                        )}
                      </td>

                      {/* Physical Status */}
                      <td className="py-3.5 px-4" data-label="Physical Status">
                        <Badge status={card.physicalStatus} />
                      </td>

                      {/* Customer Status */}
                      <td className="py-3.5 px-4" data-label="Customer Status">
                        {isActivated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-bold text-[10px]">
                            <CheckCircle2 size={11} />
                            Activated
                          </span>
                        ) : (
                          <span className="text-[var(--mp-muted)]">Unlinked</span>
                        )}
                      </td>

                      {/* Redemption */}
                      <td className="py-3.5 px-4" data-label="Redemption">
                        {isRedeemed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                            <Gift size={11} />
                            Redeemed
                          </span>
                        ) : (
                          <span className="text-[var(--mp-muted)]">Pending</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right" data-label="Actions">
                        <Link
                          to={`/cards/${card.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--mp-brand-light)] text-brand-700 hover:bg-brand-600 hover:text-white font-bold text-[11px] transition-all"
                        >
                          <Eye size={12} />
                          Details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-[var(--mp-line)] flex items-center justify-between">
            <span className="text-xs text-[var(--mp-muted)]">
              Showing {cards.length} of {total} total cards
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

export default CardListPage;
