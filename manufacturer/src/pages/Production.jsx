import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CheckCircle2, Factory, PackagePlus, RefreshCw, ShieldCheck, Layers, Play } from "lucide-react";
import { toast } from "react-toastify";
import { useManufacturer } from "../context/ManufacturerContext";
import { PreProductionChecklistModal, PostProductionChecklistModal } from "../components/ProductionChecklistModal";

const parseVariants = (product) => {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants;
  return [{ size: "Standard", color: "Standard" }];
};

const statusStyle = {
  PENDING_REVIEW: "bg-amber-50 text-amber-800 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-800 border-blue-200",
  PRE_CHECK_PASSED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PRE_CHECK_FAILED: "bg-rose-50 text-rose-800 border-rose-200",
  IN_PRODUCTION: "bg-indigo-50 text-indigo-800 border-indigo-200",
  POST_CHECK_FAILED: "bg-rose-50 text-rose-800 border-rose-200",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
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

  // Quality Checklist Modals
  const [preCheckRequest, setPreCheckRequest] = useState(null);
  const [postCheckRequest, setPostCheckRequest] = useState(null);

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
    setLines(
      parseVariants(selectedProduct).map((variant) => ({
        size: variant.size || "Standard",
        color: variant.color || "Standard",
        quantity: "",
      }))
    );
  }, [selectedProduct]);

  const updateQuantity = (index, quantity) => {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, quantity } : line))
    );
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!productId) {
      toast.error("Choose a product.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer-production/requests`,
        {
          productId,
          lines: lines
            .filter((line) => Number(line.quantity) > 0)
            .map((line) => ({ ...line, quantity: Number(line.quantity) })),
          unitCogs,
          minimumOrderQuantity,
          deliveryCost,
          manufacturerNote,
        },
        { headers: { token } }
      );
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

  const startProduction = async (request) => {
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer-production/requests/${request.id}/start`,
        {},
        { headers: { token } }
      );
      toast.success(response.data.message || "Production started successfully!");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to start production.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#171717] flex items-center gap-2">
            <Factory className="h-6 w-6 text-[#171717]" /> Production &amp; Manufacturing
          </h1>
          <p className="mt-1 text-xs text-[#575757]">
            Request batch production terms, conduct QA checklists, and receive finished stock.
          </p>
        </div>
        <button
          onClick={loadData}
          className="rounded-xl border border-[#dedbd3] bg-[#ffffff] p-2 text-[#575757] hover:text-[#171717]"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* New production request form */}
      <form onSubmit={submitRequest} className="rounded-2xl border border-[#dedbd3] bg-[#ffffff] p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-2 text-sm font-bold text-[#171717]">
          <PackagePlus className="h-4 w-4 text-[#171717]" /> New Production Batch Request
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-xs font-semibold text-[#171717] md:col-span-3">
            Catalog Product
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-[#dedbd3] bg-[#ffffff] px-3 py-2.5 text-xs text-[#171717] focus:outline-none focus:border-[#171717]"
            >
              <option value="">-- Select Product --</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          {[
            ["Per-piece product COGS (Rs)", unitCogs, setUnitCogs, "Standard cost across variants"],
            ["MOQ (Minimum Order Quantity)", minimumOrderQuantity, setMinimumOrderQuantity, "Batch production minimum"],
            ["Packaging / logistics cost (Rs)", deliveryCost, setDeliveryCost, "Accrued upon delivery"],
          ].map(([label, value, setValue, hint]) => (
            <label key={label} className="text-xs font-semibold text-[#171717]">
              {label}
              <input
                type="number"
                min={label.includes("MOQ") ? "1" : "0"}
                step={label.includes("MOQ") ? "1" : "0.01"}
                required
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[#dedbd3] px-3 py-2.5 text-xs text-[#171717] focus:outline-none focus:border-[#171717]"
              />
              <span className="mt-1 block text-[10px] font-normal text-[#575757]">{hint}</span>
            </label>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[#575757]">
              Target Quantities by Variant
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lines.map((line, index) => (
                <label
                  key={`${line.size}-${line.color}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#dedbd3] p-3 text-xs bg-[#f8f7f4]"
                >
                  <span className="font-semibold text-[#171717]">
                    {line.size}
                    {line.color !== "Standard" ? ` / ${line.color}` : ""}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.quantity}
                    onChange={(event) => updateQuantity(index, event.target.value)}
                    placeholder="Qty"
                    className="w-20 rounded-lg border border-[#dedbd3] bg-[#ffffff] px-2 py-1.5 text-center text-xs font-bold focus:outline-none focus:border-[#171717]"
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="block text-xs font-semibold text-[#171717]">
          Manufacturer Note / Fabric Specifications
          <textarea
            value={manufacturerNote}
            onChange={(event) => setManufacturerNote(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="e.g., 100% organic cotton, 220 GSM combed knit"
            className="mt-1 w-full rounded-xl border border-[#dedbd3] px-3 py-2 text-xs focus:outline-none focus:border-[#171717] resize-none"
          />
        </label>

        <button
          disabled={submitting || !selectedProduct}
          className="rounded-xl bg-[#171717] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#262626] transition-colors disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Batch Request for Admin Approval"}
        </button>
      </form>

      {/* Production Requests Queue */}
      <section className="rounded-2xl border border-[#dedbd3] bg-[#ffffff] p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#171717]">Production Request Queue</h2>
          <span className="text-xs text-[#575757]">{requests.length} batch(es)</span>
        </div>

        {requests.length === 0 ? (
          <p className="rounded-xl bg-[#f8f7f4] p-6 text-center text-xs text-[#575757]">
            No production requests submitted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => {
              const quantity = (request.lines || []).reduce(
                (total, line) => total + Number(line.requestedQuantity || line.quantity || 0),
                0
              );
              return (
                <article key={request.id} className="rounded-xl border border-[#dedbd3] p-4 space-y-3 hover:border-[#171717]/40 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-xs text-[#171717]">{request.product?.name || request.productName}</h3>
                      <p className="mt-0.5 text-[11px] text-[#575757]">
                        {quantity} units • {currency}
                        {request.approvedUnitCogs ?? request.proposedUnitCogs}/unit • Target MOQ:{" "}
                        {request.approvedMinimumOrderQuantity ?? request.minimumOrderQuantity}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border uppercase ${
                        statusStyle[request.status] || "bg-[#f8f7f4] text-[#171717] border-[#dedbd3]"
                      }`}
                    >
                      {request.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  <p className="text-[11px] text-[#575757]">
                    {(request.lines || [])
                      .map((line) => `${line.size}${line.color !== "Standard" ? ` / ${line.color}` : ""}: ${line.requestedQuantity || line.quantity}`)
                      .join(" • ")}
                  </p>

                  {/* Step Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {["APPROVED", "PRE_CHECK_FAILED"].includes(request.status) && (
                      <button
                        onClick={() => setPreCheckRequest(request)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#dedbd3] bg-[#f8f7f4] hover:bg-[#dedbd3]/50 text-xs font-bold text-[#171717] transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        {request.status === "PRE_CHECK_FAILED" ? "Retry Pre-Production Check" : "Pre-Production Check"}
                      </button>
                    )}

                    {request.status === "PRE_CHECK_PASSED" && (
                      <button
                        onClick={() => startProduction(request)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#171717] hover:bg-[#262626] text-xs font-bold text-white transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Start Production
                      </button>
                    )}

                    {["IN_PRODUCTION", "POST_CHECK_FAILED"].includes(request.status) && (
                      <button
                        onClick={() => setPostCheckRequest(request)}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3.5 py-1.5 text-xs font-bold text-white transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {request.status === "POST_CHECK_FAILED" ? "Retry QA & Receive Stock" : "Complete QA & Receive Stock"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Pre-Check Quality Modal */}
      {preCheckRequest && (
        <PreProductionChecklistModal
          request={preCheckRequest}
          token={token}
          onClose={() => setPreCheckRequest(null)}
          onSuccess={loadData}
        />
      )}

      {/* Post-Check Quality & Stock Modal */}
      {postCheckRequest && (
        <PostProductionChecklistModal
          request={postCheckRequest}
          token={token}
          onClose={() => setPostCheckRequest(null)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
};

export default Production;
