import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Boxes, RefreshCw, Search } from "lucide-react";
import { toast } from "react-toastify";
import { useManufacturer } from "../context/ManufacturerContext";
import Pagination from "../components/Pagination";

const DistributorInventory = () => {
  const { token, backendUrl } = useManufacturer();
  const [inventory, setInventory] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const loadInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/inventory?page=${page}&limit=20`,
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "Could not load distributor inventory.");
      setInventory(response.data.inventory || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not load distributor inventory.");
    } finally {
      setLoading(false);
    }
  }, [backendUrl, page, token]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  const filteredInventory = inventory.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || `${item.productName} ${item.size} ${item.color}`.toLowerCase().includes(query);
  });

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase text-emerald-800">Distributor hub</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Hub Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">Stock is received through approved transfers. Report damaged or lost stock with evidence.</p>
        </div>
        <button type="button" onClick={loadInventory} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, size, or color"
            className="min-h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-600"
          />
        </div>
        <p className="text-xs font-semibold text-slate-500">{pagination?.total ?? inventory.length} inventory variant(s)</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">Loading hub inventory...</div>
        ) : filteredInventory.length ? (
          <div className="divide-y divide-slate-100">
            {filteredInventory.map((item) => (
              <article key={item.inventorySkuId} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Boxes className="h-5 w-5" /></span>
                <div className="min-w-44 flex-1">
                  <h2 className="text-sm font-bold text-slate-900">{item.productName}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{item.size} / {item.color}</p>
                </div>
                <div className="grid min-w-48 grid-cols-3 gap-3 text-right">
                  <Metric label="On hand" value={item.quantity} />
                  <Metric label="Reserved" value={item.reservedQty} />
                  <Metric label="Available" value={item.availableQty} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <Boxes className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">{search ? "No matching inventory variants" : "No stock at this hub yet"}</p>
            <p className="mt-1 text-xs text-slate-500">Approved and received stock transfers will appear here.</p>
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page || page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </section>
  );
};

const Metric = ({ label, value }) => (
  <div>
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm font-black text-slate-900">{Number(value || 0).toLocaleString()}</p>
  </div>
);

export default DistributorInventory;
