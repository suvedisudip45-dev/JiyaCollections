import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CheckCircle2, Factory, PackagePlus, RefreshCw } from "lucide-react";
import { toast } from "react-toastify";
import { useManufacturer } from "../context/ManufacturerContext";

const parseVariants = (product) => {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants;
  return [{ size: "Standard", color: "Standard" }];
};

const statusStyle = {
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

const Production = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [products, setProducts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [productId, setProductId] = useState("");
  const [lines, setLines] = useState([]);
  const [unitCogs, setUnitCogs] = useState("");
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState("");
  const [deliveryCost, setDeliveryCost] = useState("0");
  const [manufacturerNote, setManufacturerNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId),
    [products, productId]
  );

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [productResponse, requestResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/manufacturer-production/products`, { headers: { token } }),
        axios.get(`${backendUrl}/api/manufacturer-production/requests?limit=50`, { headers: { token } }),
      ]);
      setProducts(productResponse.data.products || []);
      setRequests(requestResponse.data.requests || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load production requests.");
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedProduct) {
      setLines([]);
      return;
    }
    setLines(parseVariants(selectedProduct).map((variant) => ({
      size: variant.size || "Standard",
      color: variant.color || "Standard",
      quantity: "",
    })));
  }, [selectedProduct]);

  const updateQuantity = (index, quantity) => {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, quantity } : line
    ));
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!productId) {
      toast.error("Choose a product.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post(`${backendUrl}/api/manufacturer-production/requests`, {
        productId,
        lines: lines.filter((line) => Number(line.quantity) > 0).map((line) => ({ ...line, quantity: Number(line.quantity) })),
        unitCogs,
        minimumOrderQuantity,
        deliveryCost,
        manufacturerNote,
      }, { headers: { token } });
      toast.success(response.data.message || "Production request submitted.");
      setUnitCogs("");
      setMinimumOrderQuantity("");
      setDeliveryCost("0");
      setManufacturerNote("");
      setProductId("");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to submit production request.");
    } finally {
      setSubmitting(false);
    }
  };

  const transition = async (request, action) => {
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer-production/requests/${request.id}/${action}`,
        {},
        { headers: { token } }
      );
      toast.success(response.data.message);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update production status.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2"><Factory className="h-6 w-6 text-emerald-600" /> Production</h1>
          <p className="mt-1 text-sm text-slate-500">Request production terms; stock and product COGS payable are recorded after completion.</p>
        </div>
        <button onClick={loadData} className="rounded-xl border bg-white p-2.5 text-slate-600" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      </header>

      <form onSubmit={submitRequest} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
        <div className="flex items-center gap-2 font-bold text-slate-900"><PackagePlus className="h-5 w-5 text-emerald-600" /> New production request</div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600 md:col-span-3">Catalog product
            <select value={productId} onChange={(event) => setProductId(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="">Select product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          {[
            ["Per-piece product COGS", unitCogs, setUnitCogs, "The same for every size and color"],
            ["MOQ (informational)", minimumOrderQuantity, setMinimumOrderQuantity, "Does not multiply or gate payment"],
            ["Packaging / other cost per delivered unit", deliveryCost, setDeliveryCost, "Paid only after successful delivery"],
          ].map(([label, value, setValue, hint]) => (
            <label key={label} className="text-xs font-semibold text-slate-600">{label}
              <input type="number" min={label.includes("MOQ") ? "1" : "0"} step={label.includes("MOQ") ? "1" : "0.01"} required value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">{hint}</span>
            </label>
          ))}
        </div>
        {lines.length > 0 && <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Production quantities by variant</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lines.map((line, index) => <label key={`${line.size}-${line.color}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
              <span className="font-semibold text-slate-700">{line.size}{line.color !== "Standard" ? ` / ${line.color}` : ""}</span>
              <input type="number" min="0" step="1" value={line.quantity} onChange={(event) => updateQuantity(index, event.target.value)} placeholder="Qty" className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-center" />
            </label>)}
          </div>
        </div>}
        <label className="block text-xs font-semibold text-slate-600">Manufacturer note
          <textarea value={manufacturerNote} onChange={(event) => setManufacturerNote(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-col gap-1 rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900 sm:flex-row sm:justify-between">
          <span>Product COGS is accrued when completed stock enters inventory.</span>
          <span>MOQ is informational; payment is actual units × approved unit COGS.</span>
        </div>
        <button disabled={submitting || !selectedProduct} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{submitting ? "Submitting..." : "Submit for admin approval"}</button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Your production requests</h2><span className="text-xs text-slate-400">{requests.length} requests</span></div>
        {requests.length === 0 ? <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No production requests yet.</p> : <div className="space-y-3">
          {requests.map((request) => {
            const quantity = (request.lines || []).reduce((total, line) => total + Number(line.quantity || 0), 0);
            return <article key={request.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-bold text-slate-900">{request.productName}</h3><p className="mt-1 text-xs text-slate-500">{quantity} units · {currency}{request.approvedUnitCogs ?? request.proposedUnitCogs}/unit · MOQ {request.approvedMinimumOrderQuantity ?? request.minimumOrderQuantity}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle[request.status] || "bg-slate-100 text-slate-600"}`}>{request.status.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{(request.lines || []).map((line) => `${line.size}${line.color !== "Standard" ? ` / ${line.color}` : ""}: ${line.quantity}`).join(" · ")}</p>
              {request.adminNote && <p className="mt-2 text-xs text-slate-600">Admin note: {request.adminNote}</p>}
              {request.status === "APPROVED" && <button onClick={() => transition(request, "start")} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Start production</button>}
              {request.status === "IN_PRODUCTION" && <button onClick={() => transition(request, "complete")} className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><CheckCircle2 className="h-4 w-4" /> Complete &amp; receive stock</button>}
            </article>;
          })}
        </div>}
      </section>
    </div>
  );
};

export default Production;
