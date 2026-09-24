import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AlertTriangle, CheckCircle2, ChevronDown, PackageCheck, PackageX,
  Printer, RefreshCw, SearchX, Square, SquareCheck, X,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import PrintSheetModal from "../components/PrintSheetModal";

/* ── Status badge ──────────────────────────────────────────── */
const STATUS_META = {
  ASSIGNED:  { label: "Assigned",  bg: "bg-amber-100",   text: "text-amber-800"   },
  AVAILABLE: { label: "Available", bg: "bg-emerald-100", text: "text-emerald-800" },
  ATTACHED:  { label: "Attached",  bg: "bg-sky-100",     text: "text-sky-800"     },
  CANCELLED: { label: "Cancelled", bg: "bg-red-100",     text: "text-red-700"     },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || { label: status, bg: "bg-slate-100", text: "text-slate-700" };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.bg} ${meta.text}`}>
      {meta.label}
    </span>
  );
};

/* ── Confirmation modal ────────────────────────────────────── */
const ACTIONS = {
  RECEIVE:   { label: "Confirm Receipt",    icon: PackageCheck, color: "bg-emerald-700 hover:bg-emerald-800", desc: "Mark selected cards as received and make them available for packaging." },
  DAMAGED:   { label: "Mark as Damaged",    icon: AlertTriangle, color: "bg-red-700 hover:bg-red-800",       desc: "Mark selected cards as physically damaged. They will be cancelled." },
  NOT_FOUND: { label: "Mark as Not Found",  icon: PackageX,     color: "bg-rose-700 hover:bg-rose-800",      desc: "Mark selected cards as missing / not delivered. They will be cancelled." },
};

const ConfirmModal = ({ action, count, onConfirm, onClose, working }) => {
  const [notes, setNotes] = useState("");
  const meta = ACTIONS[action];
  const Icon = meta.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <Icon className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">{meta.label}</h2>
              <p className="text-xs text-slate-500">{count} card{count !== 1 ? "s" : ""} selected</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <p className="mt-4 text-sm text-slate-600">{meta.desc}</p>

        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-600 mb-1">Notes <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note about this batch action…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} disabled={working} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => onConfirm(notes)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50 ${meta.color}`}
          >
            {working ? "Processing…" : `${meta.label} (${count})`}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Results modal ─────────────────────────────────────────── */
const ResultsModal = ({ results, summary, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-slate-900">Bulk Update Results</h2>
        <button type="button" onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { label: "Succeeded", count: summary.succeeded, color: "bg-emerald-50 text-emerald-700" },
          { label: "Skipped",   count: summary.skipped,   color: "bg-amber-50 text-amber-700"    },
          { label: "Failed",    count: summary.failed,    color: "bg-red-50 text-red-700"         },
        ].map(({ label, count, color }) => (
          <div key={label} className={`rounded-xl p-3 text-center ${color}`}>
            <p className="text-xl font-black">{count}</p>
            <p className="text-xs font-bold">{label}</p>
          </div>
        ))}
      </div>
      {(results.skipped.length > 0 || results.failed.length > 0) && (
        <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
          {[...results.skipped.map((r) => ({ ...r, type: "Skipped" })), ...results.failed.map((r) => ({ ...r, type: "Failed" }))].map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <span className={`mt-0.5 font-bold ${r.type === "Failed" ? "text-red-600" : "text-amber-600"}`}>{r.type}:</span>
              <span className="font-mono text-[10px]">{r.id.slice(0, 8)}…</span>
              <span className="text-slate-500">{r.reason}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white hover:bg-slate-700">
        Done
      </button>
    </div>
  </div>
);

/* ── Filter tabs ───────────────────────────────────────────── */
const FILTER_TABS = [
  { key: "all",       label: "All Cards"  },
  { key: "ASSIGNED",  label: "Assigned"   },
  { key: "AVAILABLE", label: "Available"  },
  { key: "ATTACHED",  label: "Attached"   },
  { key: "CANCELLED", label: "Cancelled"  },
];

/* ── Main component ────────────────────────────────────────── */
const MarketingCards = () => {
  const { token, backendUrl } = useManufacturer();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [confirmAction, setConfirmAction] = useState(null); // "RECEIVE" | "DAMAGED" | "NOT_FOUND"
  const [working, setWorking] = useState(false);
  const [modalResults, setModalResults] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const headerCheckRef = useRef(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const response = await axios.get(
        `${backendUrl}/api/marketing-cards/manufacturer/cards?status=all`,
        { headers: { token } }
      );
      setCards(response.data.cards || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load marketing card inventory.");
    } finally { setLoading(false); }
  }, [backendUrl, token]);

  useEffect(() => { load(); }, [load]);

  /* Derived data */
  const filtered = useMemo(() =>
    filterStatus === "all" ? cards : cards.filter((c) => c.physicalStatus === filterStatus),
    [cards, filterStatus]
  );

  const counts = useMemo(() =>
    cards.reduce((acc, c) => { acc[c.physicalStatus] = (acc[c.physicalStatus] || 0) + 1; return acc; }, {}),
    [cards]
  );

  /* Selectable cards: only ASSIGNED and AVAILABLE can be bulk actioned */
  const selectableIds = useMemo(() =>
    filtered.filter((c) => ["ASSIGNED", "AVAILABLE"].includes(c.physicalStatus)).map((c) => c.id),
    [filtered]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = !allSelected && selectableIds.some((id) => selected.has(id));

  /* Sync indeterminate state on header checkbox */
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) { selectableIds.forEach((id) => next.delete(id)); }
      else { selectableIds.forEach((id) => next.add(id)); }
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* Bulk action */
  const handleConfirm = async (notes) => {
    setWorking(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/marketing-cards/manufacturer/cards/bulk-status`,
        { cardIds: [...selected], action: confirmAction, notes },
        { headers: { token } }
      );
      if (!res.data.success) throw new Error(res.data.message);
      toast.success(res.data.message);
      setModalResults({ results: res.data.results, summary: res.data.summary });
      setConfirmAction(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Bulk update failed.");
    } finally { setWorking(false); }
  };

  const selectedCount = selected.size;

  /* ── Render ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Manufacturer inventory</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Marketing Cards</h1>
          <p className="mt-1 text-sm text-slate-500">Select cards to confirm receipt, or flag as damaged / not found.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {["ASSIGNED", "AVAILABLE", "ATTACHED", "CANCELLED"].map((s) => (
          <div key={s} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{counts[s] || 0}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
        {FILTER_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setFilterStatus(key); setSelected(new Set()); }}
            className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
              filterStatus === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}{key !== "all" && counts[key] ? ` (${counts[key]})` : ""}
          </button>
        ))}
      </div>

      {/* Card table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-black text-slate-900">
            Assigned card inventory
            {!loading && <span className="ml-2 text-slate-400 font-normal">({filtered.length} cards)</span>}
          </h2>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <Printer className="h-3.5 w-3.5 text-amber-700" />
              Print Stickers / Cards ({selected.size > 0 ? `${selected.size} Selected` : `${filtered.length} Cards`})
            </button>
          )}
        </div>

        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading inventory…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-slate-400">
            <SearchX className="h-8 w-8 mb-2" />
            <p className="text-sm font-medium">No cards match this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      ref={headerCheckRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer rounded accent-slate-800"
                      title={allSelected ? "Deselect all" : "Select all selectable"}
                    />
                  </th>
                  <th className="px-4 py-3">Card Code</th>
                  <th className="px-4 py-3">Partner / Campaign</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Benefit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((card) => {
                  const isSelectable = ["ASSIGNED", "AVAILABLE"].includes(card.physicalStatus);
                  const isChecked = selected.has(card.id);
                  return (
                    <tr
                      key={card.id}
                      className={`transition-colors ${isChecked ? "bg-slate-50" : "hover:bg-slate-50/60"} ${isSelectable ? "cursor-pointer" : ""}`}
                      onClick={() => isSelectable && toggleOne(card.id)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {isSelectable ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleOne(card.id)}
                            className="h-4 w-4 cursor-pointer rounded accent-slate-800"
                          />
                        ) : (
                          <span className="inline-block h-4 w-4 rounded border border-slate-200 bg-slate-100" title="Cannot select" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-800">{card.cardCode}</td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-800">{card.campaign?.marketingPartner?.name || "—"}</p>
                        <p className="text-slate-500">{card.campaign?.name || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{card.campaign?.targetScopeType || "NATIONWIDE"}</td>
                      <td className="px-4 py-3"><StatusBadge status={card.physicalStatus} /></td>
                      <td className="px-4 py-3 text-slate-500">
                        {card.benefit ? (
                          <span className="font-medium text-emerald-700">{card.benefit.name}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating bulk action toolbar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-900 px-5 py-3 shadow-2xl text-white">
            <button type="button" onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold">{selectedCount} card{selectedCount !== 1 ? "s" : ""} selected</span>
            <div className="h-4 w-px bg-slate-700" />
            <button
              type="button"
              onClick={() => setConfirmAction("RECEIVE")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold hover:bg-emerald-500"
            >
              <PackageCheck className="h-3.5 w-3.5" /> Confirm Receipt
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction("DAMAGED")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold hover:bg-amber-500"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Damaged
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction("NOT_FOUND")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold hover:bg-red-500"
            >
              <PackageX className="h-3.5 w-3.5" /> Not Found
            </button>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          count={selectedCount}
          working={working}
          onConfirm={handleConfirm}
          onClose={() => !working && setConfirmAction(null)}
        />
      )}

      {/* Results modal */}
      {modalResults && (
        <ResultsModal
          results={modalResults.results}
          summary={modalResults.summary}
          onClose={() => setModalResults(null)}
        />
      )}

      {/* Print Sheet Modal */}
      {printOpen && (
        <PrintSheetModal
          isOpen={printOpen}
          onClose={() => setPrintOpen(false)}
          title="Manufacturer Packaging Stickers & Cards"
          cards={selected.size > 0 ? cards.filter((c) => selected.has(c.id)) : filtered}
        />
      )}
    </div>
  );
};

export default MarketingCards;
