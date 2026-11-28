import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Boxes, ChevronDown, ChevronUp, RefreshCw, Search } from "lucide-react";
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
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [detailsSkuId, setDetailsSkuId] = useState(null);
  const [skuDetails, setSkuDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [cycleCountOpen, setCycleCountOpen] = useState(false);
  const [cycleCountCode, setCycleCountCode] = useState("");
  const [cycleCountLines, setCycleCountLines] = useState([]);
  const [replenishment, setReplenishment] = useState([]);

  const loadInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [response, replenishmentResponse] = await Promise.all([
        axios.get(
        `${backendUrl}/api/distributor/inventory?groupBy=product&page=${page}&limit=20`,
        { headers: { token } },
        ),
        axios.get(`${backendUrl}/api/distributor/intelligence/replenishment`, { headers: { token } }),
      ]);
      if (!response.data.success) throw new Error(response.data.message || "Could not load distributor inventory.");
      setInventory(response.data.inventory || []);
      setPagination(response.data.pagination || null);
      setReplenishment(replenishmentResponse.data.recommendations || []);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not load distributor inventory.");
    } finally {
      setLoading(false);
    }
  }, [backendUrl, page, token]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  const loadSkuDetails = async (inventorySkuId, detailsPage = 1) => {
    setDetailsSkuId(inventorySkuId);
    setDetailsLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/inventory/${encodeURIComponent(inventorySkuId)}/details?page=${detailsPage}&limit=10`,
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "Could not load variant details.");
      setSkuDetails(response.data);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Could not load variant details.");
      setDetailsSkuId(null);
      setSkuDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const toggleSkuDetails = (inventorySkuId) => {
    if (detailsSkuId === inventorySkuId) {
      setDetailsSkuId(null);
      setSkuDetails(null);
      return;
    }
    loadSkuDetails(inventorySkuId);
  };

  const filteredInventory = inventory.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || item.productName.toLowerCase().includes(query) ||
      item.variants.some((variant) => `${variant.size} ${variant.color}`.toLowerCase().includes(query));
  });

  const openCycleCount = () => {
    const lines = inventory.flatMap((item) =>
      item.variants.map((variant) => ({
        inventorySkuId: variant.inventorySkuId,
        label: `${item.productName} — ${variant.size} / ${variant.color}`,
        systemQuantity: Math.max(0, Number(variant.availableQty || 0)),
        countedQuantity: "",
        note: "",
      })),
    );
    setCycleCountCode(`CC-${Date.now().toString(36).toUpperCase()}`);
    setCycleCountLines(lines);
    setCycleCountOpen(true);
  };

  const submitCycleCount = async (event) => {
    event.preventDefault();
    if (!cycleCountLines.length) return;
    if (cycleCountLines.some((line) => line.countedQuantity === "")) {
      toast.error("Enter a physical count for every SKU variant.");
      return;
    }
    try {
      await axios.post(
        `${backendUrl}/api/distributor/warehouse/cycle-counts`,
        {
          countCode: cycleCountCode,
          lines: cycleCountLines.map((line) => ({
            inventorySkuId: line.inventorySkuId,
            countedQuantity: Number(line.countedQuantity),
            note: line.note,
          })),
        },
        { headers: { token } },
      );
      toast.success("Physical cycle count recorded. Stock was not changed.");
      setCycleCountOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record cycle count.");
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase text-emerald-800">Distributor hub</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Hub Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">On-hand, reserved, available, and damaged quantities come from canonical inventory balances. They are not independent physical counts or a valuation. Report damaged or lost stock with evidence.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openCycleCount} disabled={loading || !inventory.length} className="inline-flex min-h-10 items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">
            Cycle count
          </button>
          <button type="button" onClick={loadInventory} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
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
        <p className="text-xs font-semibold text-slate-500">
          {pagination?.total ?? inventory.length} product{(pagination?.total ?? inventory.length) === 1 ? "" : "s"}
        </p>
      </div>

      {replenishment.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-amber-950">Replenishment intelligence</p>
              <p className="mt-1 text-[11px] text-amber-900">Server-calculated from available stock, incoming transfers, safety stock, and 14/30/90-day sales velocity.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {replenishment.filter((item) => item.recommendedQuantity > 0).slice(0, 8).map((item) => (
              <div key={item.inventorySkuId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">{item.productName}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{item.size} / {item.color} · {item.availableQuantity} available · {item.incomingQuantity} incoming</p>
                  <p className="mt-1 text-[10px] font-semibold text-amber-800">{item.confidence} confidence · {item.trend} trend · 30-day velocity {Number(item.salesVelocity30 || 0).toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-slate-950">{item.recommendedQuantity}</p>
                  <p className="text-[9px] uppercase text-slate-500">recommended units</p>
                </div>
              </div>
            ))}
            {!replenishment.some((item) => item.recommendedQuantity > 0) && (
              <p className="rounded-lg border border-amber-200 bg-white px-3 py-4 text-center text-xs text-slate-600">No replenishment quantities are currently recommended.</p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">Loading hub inventory...</div>
        ) : filteredInventory.length ? (
          <div className="divide-y divide-slate-100">
            {filteredInventory.map((item) => {
              const isOpen = expandedProductId === item.productId;
              return (
                <article key={item.productId}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Boxes className="h-5 w-5" /></span>
                    <div className="min-w-44 flex-1">
                      <h2 className="text-sm font-bold text-slate-900">{item.productName}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">{item.variants.length} size/color SKU{item.variants.length === 1 ? "" : "s"}</p>
                    </div>
                    <div className="grid min-w-64 flex-1 grid-cols-2 gap-3 text-right sm:grid-cols-4">
                      <Metric label="On hand" value={item.quantity} />
                      <Metric label="Reserved" value={item.reservedQty} />
                      <Metric label="Available" value={item.availableQty} />
                      <Metric label="Damaged" value={item.damagedQty} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedProductId(isOpen ? null : item.productId)}
                      aria-expanded={isOpen}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {isOpen ? "Hide SKUs" : "View SKUs"}
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700">Inventory by size and color</h3>
                      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                        {item.variants.map((variant) => {
                          const variantDetailsOpen = detailsSkuId === variant.inventorySkuId;
                          return (
                            <div key={variant.inventorySkuId}>
                              <div className="flex flex-wrap items-center gap-3 px-3 py-3">
                                <div className="min-w-36 flex-1">
                                  <p className="text-xs font-bold text-slate-800">{variant.size} / {variant.color}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">SKU variant</p>
                                </div>
                                <div className="grid min-w-52 flex-1 grid-cols-2 gap-3 text-right sm:grid-cols-4">
                                  <Metric label="On hand" value={variant.quantity} />
                                  <Metric label="Reserved" value={variant.reservedQty} />
                                  <Metric label="Available" value={variant.availableQty} />
                                  <Metric label="Damaged" value={variant.damagedQty} />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleSkuDetails(variant.inventorySkuId)}
                                  disabled={detailsLoading}
                                  aria-expanded={variantDetailsOpen}
                                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  {variantDetailsOpen ? "Hide details" : "Details"}
                                  {variantDetailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                              </div>
                              {variantDetailsOpen && (
                                <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                                  {detailsLoading ? (
                                    <p className="py-3 text-center text-xs text-slate-500">Loading variant details...</p>
                                  ) : skuDetails?.inventorySkuId === variant.inventorySkuId ? (
                                    <SkuDetails
                                      data={skuDetails}
                                      onPageChange={(nextPage) => loadSkuDetails(variant.inventorySkuId, nextPage)}
                                    />
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
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
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={setPage}
        />
      )}

      {cycleCountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitCycleCount} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-black text-slate-900">Physical cycle count</h2>
                <p className="mt-1 text-xs text-slate-500">Variances are recorded for review; this does not change inventory.</p>
              </div>
              <button type="button" onClick={() => setCycleCountOpen(false)} className="rounded-lg px-2 py-1 text-slate-500">Close</button>
            </div>
            <div className="mt-4 space-y-2">
              <input
                value={cycleCountCode}
                onChange={(event) => setCycleCountCode(event.target.value)}
                aria-label="Cycle count code"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              {cycleCountLines.map((line, index) => (
                <div key={line.inventorySkuId} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_110px_1fr]">
                  <div>
                    <p className="text-xs font-bold text-slate-800">{line.label}</p>
                    <p className="text-[10px] text-slate-500">System available: {line.systemQuantity}</p>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.countedQuantity}
                    onChange={(event) => setCycleCountLines((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, countedQuantity: event.target.value } : item
                    ))}
                    placeholder="Physical"
                    aria-label={`Physical count for ${line.label}`}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-bold"
                  />
                  <input
                    value={line.note}
                    onChange={(event) => setCycleCountLines((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, note: event.target.value } : item
                    ))}
                    placeholder="Variance note"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCycleCountOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold">Cancel</button>
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">Record count</button>
            </div>
          </form>
        </div>
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

const SkuDetails = ({ data, onPageChange }) => {
  const { inventory, movements, pagination } = data;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Variant stock details</h3>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DetailMetric label="On hand at hub" value={inventory.quantity} />
          <DetailMetric label="Reserved at hub" value={inventory.reservedQty} />
          <DetailMetric label="Available at hub" value={inventory.availableQty} />
          <DetailMetric label="Damaged" value={inventory.damagedQty} />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Stock movement history</h3>
        {movements.length ? (
          <div className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {movements.map((movement) => (
              <div key={movement.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-3 text-xs">
                <div>
                  <p className="font-bold text-slate-800">{movement.movementType.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-slate-500">
                    {movement.sourceLocation?.name || "External"} <span aria-hidden="true">→</span> {movement.destinationLocation?.name || "External"}
                  </p>
                  {movement.reason && <p className="mt-1 text-slate-500">{movement.reason}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">{Number(movement.quantity).toLocaleString()} unit(s)</p>
                  <p className="mt-1 text-slate-500">{new Date(movement.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500">No stock movements recorded for this variant.</p>
        )}
        {pagination?.totalPages > 1 && (
          <div className="mt-3">
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const DetailMetric = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm font-black text-slate-900">{Number(value || 0).toLocaleString()}</p>
  </div>
);

export default DistributorInventory;
