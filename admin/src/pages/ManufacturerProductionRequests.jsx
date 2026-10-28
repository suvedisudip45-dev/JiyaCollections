/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Check, Factory, RefreshCw, X } from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl, currency } from "../App";

const statusClass = {
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  PENDING_MANUFACTURER_QUOTE: "bg-amber-100 text-amber-800",
  PENDING_ADMIN_APPROVAL: "bg-orange-100 text-orange-800",
  PRE_CHECK_PASSED: "bg-emerald-100 text-emerald-800",
  PRE_CHECK_FAILED: "bg-rose-100 text-rose-800",
  APPROVED: "bg-blue-100 text-blue-800",
  IN_PRODUCTION: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

const getUnitCostBreakdown = (amount, treatment, vatRate, vatVerified = false) => {
  const enteredAmount = Number(amount) || 0;
  const rate = Number(vatRate) || 0;
  let net = enteredAmount;
  let vat = 0;
  let gross = enteredAmount;
  if (treatment === "VAT_INCLUSIVE") {
    net = enteredAmount / (1 + rate / 100);
    vat = enteredAmount - net;
  } else if (treatment === "VAT_EXCLUSIVE") {
    vat = enteredAmount * rate / 100;
    gross = enteredAmount + vat;
  }
  return {
    net: net.toFixed(2),
    vat: vat.toFixed(2),
    gross: gross.toFixed(2),
    inventoryCost: (vatVerified ? net : gross).toFixed(2),
  };
};

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getProductVariants = (product) => {
  const variants = parseArray(product?.variants);
  if (variants.length) return variants.map((variant) => ({
    size: String(variant.size || "Standard"),
    color: String(variant.color || "Standard"),
  }));
  const sizes = parseArray(product?.sizes);
  const colors = parseArray(product?.colors).map((color) => typeof color === "object" ? color.name : color);
  if (!sizes.length) return [{ size: "Standard", color: "Standard" }];
  if (!colors.length) return sizes.map((size) => ({ size: String(size), color: "Standard" }));
  return sizes.flatMap((size) => colors.map((color) => ({ size: String(size), color: String(color) })));
};

const loadAllPages = async (endpoint, token) => {
  const headers = { token };
  const firstResponse = await axios.get(endpoint.url, { headers, params: { type: endpoint.type, limit: 50, page: 1 } });
  const firstRows = firstResponse.data[endpoint.type] || [];
  const pageCount = Number(firstResponse.data.pagination?.totalPages || 1);
  const rows = [...firstRows];
  for (let page = 2; page <= pageCount; page += 1) {
    const response = await axios.get(endpoint.url, { headers, params: { type: endpoint.type, limit: 50, page } });
    rows.push(...(response.data[endpoint.type] || []));
  }
  return rows;
};

const ManufacturerProductionRequests = ({ token }) => {
  const [requests, setRequests] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    manufacturerId: "",
    productId: "",
    fabricType: "",
    gsm: "",
    targetCompletionDate: "",
    adminNote: "",
  });
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState({});
  const [terms, setTerms] = useState({});
  const [savingId, setSavingId] = useState("");
  const selectedProduct = products.find((product) => product.id === draft.productId);
  const productVariants = getProductVariants(selectedProduct);
  const requestedLines = productVariants
    .map((variant) => ({
      ...variant,
      quantity: Number(quantities[`${variant.size}\u0000${variant.color}`] || 0),
    }))
    .filter((line) => line.quantity > 0);
  const totalQuantity = requestedLines.reduce((total, line) => total + line.quantity, 0);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [manufacturerRows, productRows] = await Promise.all([
        loadAllPages({ url: `${backendUrl}/api/manufacturer-production/admin/options`, type: "manufacturers" }, token),
        loadAllPages({ url: `${backendUrl}/api/manufacturer-production/admin/options`, type: "products" }, token),
      ]);
      setManufacturers(manufacturerRows);
      setProducts(productRows);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load manufacturers and products for production.");
    } finally {
      setOptionsLoading(false);
    }
  }, [token]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer-production/admin/requests?limit=100`, { headers: { token } });
      const rows = response.data.requests || [];
      setRequests(rows);
      setTerms((current) => {
        const next = { ...current };
        rows.forEach((request) => {
          next[request.id] = {
            unitCogs: request.proposedUnitCogs,
            otherCost: request.proposedDeliveryCost,
            vatTreatment: request.vatTreatment || "EXEMPT",
            vatRate: request.vatRate ?? 13,
            vatInvoiceReference: request.vatInvoiceReference || "",
            vatInvoiceVerified: false,
          };
        });
        return next;
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load manufacturer production requests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  useEffect(() => {
    setQuantities({});
  }, [draft.productId]);

  const createRequest = async (event) => {
    event.preventDefault();
    if (!totalQuantity) {
      toast.error("Enter a positive quantity for at least one size/color SKU.");
      return;
    }
    setCreating(true);
    try {
      const response = await axios.post(`${backendUrl}/api/manufacturer/production/create`, {
        ...draft,
        lines: requestedLines,
        batches: [{ batchNumber: "Batch 1", plannedQuantity: totalQuantity }],
      }, { headers: { token } });
      toast.success(response.data.message || "Production order sent to the manufacturer.");
      setDraft({
        manufacturerId: "",
        productId: "",
        fabricType: "",
        gsm: "",
        targetCompletionDate: "",
        adminNote: "",
      });
      setQuantities({});
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to create production order.");
    } finally {
      setCreating(false);
    }
  };

  const review = async (request, decision) => {
    setSavingId(request.id);
    try {
      const approved = terms[request.id] || {};
      const response = await axios.post(`${backendUrl}/api/manufacturer-production/admin/requests/${request.id}/review`, {
        decision,
        adminNote: notes[request.id] || "",
        ...(decision === "APPROVE" ? {
          approvedUnitCogs: approved.unitCogs,
          approvedOtherCost: approved.otherCost,
          approvedVatTreatment: approved.vatTreatment,
          approvedVatRate: approved.vatRate,
          approvedVatInvoiceReference: approved.vatInvoiceReference,
          approvedVatInvoiceVerified: approved.vatTreatment !== "EXEMPT" && approved.vatInvoiceVerified === true,
        } : {}),
      }, { headers: { token } });
      toast.success(response.data.message || `Request ${decision.toLowerCase()}d.`);
      await loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to review production request.");
    } finally {
      setSavingId("");
    }
  };

  const setTerm = (id, field, value) => setTerms((current) => ({
    ...current,
    [id]: { ...current[id], [field]: value },
  }));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Factory className="h-6 w-6 text-emerald-600" /> Manufacturer Production</h1><p className="mt-1 text-sm text-slate-500">Assign SKU quantities and fabric specifications, then review the manufacturer’s quote before approving production.</p></div>
        <button onClick={loadRequests} className="rounded-xl border bg-white p-2.5 text-slate-600" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      </header>
      <form onSubmit={createRequest} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="font-bold text-slate-900">Create production order</h2>
          <p className="mt-1 text-xs text-slate-500">Select the manufacturer, product SKUs, fabric specification, and required completion date. The manufacturer will return a quote for your approval.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">Manufacturer
            <select required value={draft.manufacturerId} onChange={(event) => setDraft((current) => ({ ...current, manufacturerId: event.target.value }))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm">
              <option value="">Select manufacturer</option>
              {manufacturers.map((manufacturer) => <option key={manufacturer.id} value={manufacturer.id}>{manufacturer.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Product
            <select required value={draft.productId} onChange={(event) => setDraft((current) => ({ ...current, productId: event.target.value }))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm">
              <option value="">Select product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Target completion date
            <input required type="date" value={draft.targetCompletionDate} onChange={(event) => setDraft((current) => ({ ...current, targetCompletionDate: event.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Fabric type / quality
            <input required maxLength={120} value={draft.fabricType} onChange={(event) => setDraft((current) => ({ ...current, fabricType: event.target.value }))} placeholder="e.g. Combed cotton" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Fabric GSM
            <input required type="number" min="0.01" max="1000" step="0.01" value={draft.gsm} onChange={(event) => setDraft((current) => ({ ...current, gsm: event.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        {selectedProduct && <div>
          <p className="mb-2 text-xs font-bold text-slate-700">Order quantity by SKU</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {productVariants.map((variant) => {
              const key = `${variant.size}\u0000${variant.color}`;
              return <label key={key} className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3 text-xs">
                <span className="font-semibold">{variant.size}{variant.color !== "Standard" ? ` / ${variant.color}` : ""}</span>
                <input type="number" min="0" step="1" value={quantities[key] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [key]: event.target.value }))} className="w-24 rounded-lg border px-2 py-1.5 text-center" aria-label={`Quantity for ${variant.size} ${variant.color}`} />
              </label>;
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">Total requested: {totalQuantity} units · One batch plan will be created for this quantity.</p>
        </div>}
        <label className="block text-xs font-semibold text-slate-600">Production instructions (optional)
          <textarea maxLength={2000} rows={2} value={draft.adminNote} onChange={(event) => setDraft((current) => ({ ...current, adminNote: event.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <button disabled={creating || optionsLoading || !manufacturers.length || !products.length} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          {creating ? "Sending order..." : "Send production order"}
        </button>
        {!optionsLoading && (!manufacturers.length || !products.length) && <p role="alert" className="text-xs text-rose-700">Active manufacturers or published products could not be loaded. Refresh and retry.</p>}
      </form>
      {loading && requests.length === 0 ? <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Loading production requests...</div>
        : requests.length === 0 ? <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">No production orders have been created.</div>
          : <div className="space-y-4">{requests.map((request) => {
            const quantity = (request.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
            const pending = ["PENDING_ADMIN_APPROVAL", "PENDING_REVIEW"].includes(request.status);
            const awaitingQuote = request.status === "PENDING_MANUFACTURER_QUOTE";
            const approvedTerms = terms[request.id] || {};
            const unitCostBreakdown = getUnitCostBreakdown(
              pending ? approvedTerms.unitCogs : (request.approvedUnitCogs ?? request.proposedUnitCogs),
              pending ? approvedTerms.vatTreatment : (request.approvedVatTreatment || request.vatTreatment || "EXEMPT"),
              pending ? approvedTerms.vatRate : (request.approvedVatRate ?? request.vatRate),
              pending ? approvedTerms.vatInvoiceVerified === true : request.approvedVatInvoiceVerified === true,
            );
            const batchOtherCost = Number(pending
              ? approvedTerms.otherCost
              : (request.approvedDeliveryCost ?? request.proposedDeliveryCost)) || 0;
            return <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-bold text-slate-900">{request.productName}</h2><p className="mt-1 text-xs text-slate-500">{request.manufacturer?.name} · {quantity} units · Requested {new Date(request.requestedAt).toLocaleDateString()}</p></div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass[request.status] || "bg-slate-100 text-slate-600"}`}>{request.status.replaceAll("_", " ")}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{(request.lines || []).map((line) => <span key={`${line.size}-${line.color}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">{line.size}{line.color !== "Standard" ? ` / ${line.color}` : ""}: {line.quantity}</span>)}</div>
              {(pending || request.approvedUnitCogs) && <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="text-xs font-bold text-sky-950">{pending ? "Review manufacturer quote" : "Approved cost breakdown"}</h3>
                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <p className="text-slate-600">Goods cost before VAT <strong className="mt-1 block text-slate-900">{currency}{unitCostBreakdown.net} / unit</strong></p>
                  <p className="text-slate-600">Supplier VAT ({(pending ? approvedTerms.vatTreatment : request.approvedVatTreatment) === "EXEMPT" ? "exempt" : `${pending ? approvedTerms.vatRate : request.approvedVatRate}%`}) <strong className="mt-1 block text-slate-900">{currency}{unitCostBreakdown.vat} / unit</strong></p>
                  <p className="text-slate-600">Goods total incl. VAT <strong className="mt-1 block text-slate-900">{currency}{unitCostBreakdown.gross} / unit</strong></p>
                  <p className="text-slate-600">Other production charges <strong className="mt-1 block text-slate-900">{currency}{batchOtherCost.toFixed(2)} {request.costTermsVersion >= 2 ? "/ batch" : "/ unit (legacy)"}</strong></p>
                  <p className="text-slate-600 sm:col-span-2">Inventory unit cost <strong className="text-slate-900">{currency}{unitCostBreakdown.inventoryCost}</strong> · {pending
                    ? approvedTerms.vatInvoiceVerified ? "VAT invoice verified; VAT is recoverable." : "VAT is not verified; VAT remains in inventory cost."
                    : request.approvedVatInvoiceVerified ? "VAT invoice verified; VAT is recoverable." : "VAT is not verified; VAT remains in inventory cost."}</p>
                  <p className="text-slate-600 sm:col-span-2">Delivery to distributor <strong className="text-slate-900">separate shipment cost</strong> · recorded at transfer dispatch, not included above.</p>
                </div>
              </section>}
              {awaitingQuote && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Waiting for the manufacturer to submit per-piece pricing and batch expenses.</p>}
              {pending && <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">Approved unit COGS ({currency})
                  <input type="number" min="0.01" step="0.01" value={approvedTerms.unitCogs ?? ""} onChange={(event) => setTerm(request.id, "unitCogs", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Batch other cost ({currency})
                  <input type="number" min="0" step="0.01" value={approvedTerms.otherCost ?? ""} onChange={(event) => setTerm(request.id, "otherCost", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Manufacturer COGS VAT treatment
                  <select value={approvedTerms.vatTreatment ?? "EXEMPT"} onChange={(event) => setTerm(request.id, "vatTreatment", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm">
                    <option value="EXEMPT">No VAT / exempt</option>
                    <option value="VAT_INCLUSIVE">VAT inclusive</option>
                    <option value="VAT_EXCLUSIVE">VAT exclusive</option>
                  </select>
                </label>
                {approvedTerms.vatTreatment !== "EXEMPT" && <>
                  <label className="text-xs font-semibold text-slate-600">VAT rate (%)
                    <input type="number" min="0.01" max="100" step="0.01" value={approvedTerms.vatRate ?? "13"} onChange={(event) => setTerm(request.id, "vatRate", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">Supplier VAT invoice reference
                    <input type="text" maxLength={120} required value={approvedTerms.vatInvoiceReference ?? ""} onChange={(event) => setTerm(request.id, "vatInvoiceReference", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
                  </label>
                  <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900 sm:col-span-3">
                    <input type="checkbox" checked={approvedTerms.vatInvoiceVerified === true} onChange={(event) => setTerm(request.id, "vatInvoiceVerified", event.target.checked)} className="mt-0.5" />
                    I verified the supplier VAT invoice; recognize this amount as recoverable input VAT. If unchecked, VAT stays in product inventory cost.
                  </label>
                </>}
              </div>}
              {!pending && <p className="mt-3 text-xs text-slate-500">Admin-assigned quantity: {quantity}</p>}
              {request.manufacturerNote && <p className="mt-3 text-xs text-slate-500">Manufacturer note: {request.manufacturerNote}</p>}
              {request.adminNote && <p className="mt-2 text-xs text-slate-500">Admin note: {request.adminNote}</p>}
              {pending && <>
                <textarea value={notes[request.id] ?? request.adminNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} rows={2} maxLength={2000} placeholder="Admin note (optional)" className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={savingId === request.id} onClick={() => review(request, "APPROVE")} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" /> Approve terms</button>
                  <button disabled={savingId === request.id} onClick={() => review(request, "REJECT")} className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2 text-xs font-bold text-rose-700 disabled:opacity-50"><X className="h-4 w-4" /> Reject</button>
                </div>
              </>}
            </article>;
          })}</div>}
    </div>
  );
};

export default ManufacturerProductionRequests;
