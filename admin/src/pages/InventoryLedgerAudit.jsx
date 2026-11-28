/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL;
const endpoint = `${backendUrl}/api/admin/inventory-ledger`;

const InventoryLedgerAudit = ({ token }) => {
  const [options, setOptions] = useState({ skus: [], locations: [] });
  const [filters, setFilters] = useState({
    inventorySkuId: "",
    locationId: "",
    movementType: "",
    from: "",
    to: "",
  });
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciling, setReconciling] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const response = await axios.get(`${endpoint}/options`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOptions({ skus: response.data.skus || [], locations: response.data.locations || [] });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Inventory audit filters could not be loaded.");
    }
  }, [token]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, page, limit: 25 }).filter(([, value]) => value !== ""));
      const response = await axios.get(endpoint, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      setEntries(response.data.entries || []);
      setTotal(response.data.total || 0);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Inventory ledger entries could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setReconciliation(null);
  };

  const runReconciliation = async () => {
    if (!filters.inventorySkuId && !filters.locationId) {
      setError("Choose a SKU, a location, or both before running reconciliation.");
      return;
    }
    setReconciling(true);
    setError("");
    try {
      const response = await axios.get(`${endpoint}/reconciliation`, {
        params: {
          ...(filters.inventorySkuId ? { inventorySkuId: filters.inventorySkuId } : {}),
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      setReconciliation(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Inventory reconciliation could not be completed.");
    } finally {
      setReconciling(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inventory Ledger Audit</h1>
        <p className="mt-1 text-sm text-slate-500">Append-only stock movements, location balances, and ledger reconciliation.</p>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-600">
          Product / SKU
          <select value={filters.inventorySkuId} onChange={(event) => updateFilter("inventorySkuId", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800">
            <option value="">All SKUs</option>
            {options.skus.map((sku) => (
              <option key={sku.id} value={sku.id}>{sku.product?.name || sku.productId} — {sku.size} / {sku.color}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Location
          <select value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800">
            <option value="">All locations</option>
            {options.locations.map((location) => (
              <option key={location.id} value={location.id}>{location.kind} — {location.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Movement type
          <select value={filters.movementType} onChange={(event) => updateFilter("movementType", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800">
            <option value="">All movements</option>
            {["OPENING_BALANCE", "PRODUCTION_RECEIPT", "TRANSFER_DISPATCH", "TRANSFER_RECEIPT", "FULFILLMENT", "RETURN", "DAMAGE", "LOSS", "ADJUSTMENT"].map((movement) => (
              <option key={movement} value={movement}>{movement.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          From
          <input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          To
          <input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={runReconciliation} disabled={reconciling} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {reconciling ? "Reconciling…" : "Reconcile selected stock"}
          </button>
        </div>
      </div>

      {reconciliation && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold text-slate-900">Reconciliation</h2>
            <span className={`text-sm font-semibold ${reconciliation.varianceCount ? "text-rose-700" : "text-emerald-700"}`}>
              {reconciliation.varianceCount} variance(s)
            </span>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Location ID</th><th className="px-4 py-3">SKU ID</th><th className="px-4 py-3">Ledger qty</th><th className="px-4 py-3">Balance qty</th><th className="px-4 py-3">Reserved</th><th className="px-4 py-3">Variance</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reconciliation.items.map((item) => (
                <tr key={`${item.locationId}:${item.inventorySkuId}`}>
                  <td className="px-4 py-3 font-mono text-xs">{item.locationId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.inventorySkuId}</td>
                  <td className="px-4 py-3">{item.ledgerQuantity}</td>
                  <td className="px-4 py-3">{item.balanceQuantity}</td>
                  <td className="px-4 py-3">{item.reservedQuantity}</td>
                  <td className={`px-4 py-3 font-semibold ${item.variance ? "text-rose-700" : "text-emerald-700"}`}>{item.variance}</td>
                </tr>
              ))}
              {!reconciliation.items.length && <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">No balances or movements found for this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Product / Variant</th><th className="px-4 py-3">Movement</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Actor / Reason</th><th className="px-4 py-3">Reference</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">Loading ledger…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">No inventory ledger entries match these filters.</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-900">
                  <div className="font-medium">{entry.inventorySku?.product?.name || "Unknown product"}</div>
                  <div className="text-xs text-slate-500">{entry.inventorySku?.size} / {entry.inventorySku?.color}</div>
                </td>
                <td className="px-4 py-3">{entry.movementType.replaceAll("_", " ")}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{entry.sourceLocation?.name || "—"} → {entry.destinationLocation?.name || "—"}</td>
                <td className="px-4 py-3 font-semibold">{entry.quantity}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{entry.actorRole} · {entry.actorId}<div>{entry.reason}</div></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{entry.referenceType || "—"}{entry.referenceId ? ` · ${entry.referenceId}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>{total} entries · Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= Math.ceil(total / 25) || loading} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default InventoryLedgerAudit;
