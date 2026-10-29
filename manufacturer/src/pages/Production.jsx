import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Factory, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "react-toastify";
import { useManufacturer } from "../context/ManufacturerContext";
import { PreProductionChecklistModal, PostProductionChecklistModal } from "../components/ProductionChecklistModal";

const statusStyle = {
  PENDING_MANUFACTURER_QUOTE: "bg-amber-50 text-amber-800 border-amber-200",
  PENDING_ADMIN_APPROVAL: "bg-orange-50 text-orange-800 border-orange-200",
  APPROVED: "bg-blue-50 text-blue-800 border-blue-200",
  PRE_CHECK_PASSED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PRE_CHECK_FAILED: "bg-rose-50 text-rose-800 border-rose-200",
  IN_PRODUCTION: "bg-indigo-50 text-indigo-800 border-indigo-200",
  PENDING_ADMIN_ACCEPTANCE: "bg-amber-50 text-amber-800 border-amber-200",
  POST_CHECK_FAILED: "bg-rose-50 text-rose-800 border-rose-200",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
};

const emptyQuote = {
  unitCogs: "",
  otherCost: "0",
  vatTreatment: "EXEMPT",
  vatRate: "13",
  vatInvoiceReference: "",
  manufacturerNote: "",
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

const Production = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [requests, setRequests] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [savingId, setSavingId] = useState("");
  const [preCheckRequest, setPreCheckRequest] = useState(null);
  const [postCheckRequest, setPostCheckRequest] = useState(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const response = await axios.get(`${backendUrl}/api/manufacturer-production/requests?limit=50`, { headers: { token } });
      setRequests(response.data.requests || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load production orders.");
      setRequests([]);
    }
  }, [backendUrl, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateQuote = (requestId, field, value) => {
    setQuotes((current) => ({
      ...current,
      [requestId]: { ...emptyQuote, ...current[requestId], [field]: value },
    }));
  };

  const submitQuote = async (event, request) => {
    event.preventDefault();
    const quote = { ...emptyQuote, ...quotes[request.id] };
    setSavingId(request.id);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/manufacturer/production/${request.id}/quote`,
        quote,
        { headers: { token } }
      );
      toast.success(response.data.message || "Production quote sent to Admin for approval.");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to submit production quote.");
    } finally {
      setSavingId("");
    }
  };

  const startProduction = async (request) => {
    setSavingId(request.id);
    try {
      const response = await axios.post(
        `${backendUrl}/api/manufacturer-production/requests/${request.id}/start`,
        {},
        { headers: { token } }
      );
      toast.success(response.data.message || "Production started successfully.");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to start production.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#171717] sm:text-2xl">
            <Factory className="h-6 w-6" /> Production &amp; Manufacturing
          </h1>
          <p className="mt-1 text-xs text-[#575757]">
            Admin assigns each production order. Submit your quote, wait for Admin approval, then complete the pre-production checks before starting.
          </p>
        </div>
        <button
          onClick={loadData}
          className="rounded-xl border border-[#dedbd3] bg-white p-2 text-[#575757] hover:text-[#171717]"
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <section className="rounded-2xl border border-[#dedbd3] bg-white p-5 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#171717]">Admin-assigned production orders</h2>
          <span className="text-xs text-[#575757]">{requests?.length ?? 0} order(s)</span>
        </div>
        {requests === null ? (
          <p className="rounded-xl bg-[#f8f7f4] p-6 text-center text-xs text-[#575757]">
            Loading assigned production orders...
          </p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl bg-[#f8f7f4] p-6 text-center text-xs text-[#575757]">
            No production orders have been assigned.
          </p>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const quantity = (request.lines || []).reduce((total, line) => total + Number(line.quantity || 0), 0);
              const quote = { ...emptyQuote, ...quotes[request.id] };
              const approved = [
                "APPROVED",
                "PRE_CHECK_PASSED",
                "PRE_CHECK_FAILED",
                "IN_PRODUCTION",
                "PENDING_ADMIN_ACCEPTANCE",
                "POST_CHECK_FAILED",
                "COMPLETED",
              ].includes(request.status);
              const unitAmount = approved ? request.approvedUnitCogs : request.proposedUnitCogs;
              const vatTreatment = approved
                ? (request.approvedVatTreatment || "EXEMPT")
                : (request.vatTreatment || "EXEMPT");
              const vatRate = approved ? request.approvedVatRate : request.vatRate;
              const costBreakdown = getUnitCostBreakdown(
                unitAmount,
                vatTreatment,
                vatRate,
                approved && request.approvedVatInvoiceVerified === true,
              );

              return (
                <article key={request.id} className="space-y-3 rounded-xl border border-[#dedbd3] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold text-[#171717]">{request.product?.name || request.productName}</h3>
                      <p className="mt-1 text-[11px] text-[#575757]">
                        Admin requested {quantity} units · Target {request.targetCompletionDate
                          ? new Date(request.targetCompletionDate).toLocaleDateString()
                          : "not specified"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusStyle[request.status] || "border-[#dedbd3] bg-[#f8f7f4] text-[#171717]"}`}>
                      {request.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  <div className="grid gap-2 rounded-lg bg-[#f8f7f4] p-3 text-[11px] sm:grid-cols-2">
                    <p>Fabric: <strong>{request.fabricType || "Not specified"}</strong></p>
                    <p>GSM: <strong>{request.gsm ?? "Not specified"}</strong></p>
                    {Array.isArray(request.batchPlan) && <p className="sm:col-span-2">Batch plan: <strong>{request.batchPlan.map((batch) => `${batch.batchNumber}: ${batch.plannedQuantity}`).join(" · ")}</strong></p>}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(request.lines || []).map((line) => (
                      <span key={`${line.size}-${line.color}`} className="rounded-lg bg-[#f8f7f4] px-2.5 py-1.5 text-xs text-[#575757]">
                        {line.size}{line.color !== "Standard" ? ` / ${line.color}` : ""}: {line.quantity}
                      </span>
                    ))}
                  </div>

                  {request.adminNote && <p className="text-[11px] text-[#575757]">Admin instructions: {request.adminNote}</p>}

                  {request.status === "PENDING_MANUFACTURER_QUOTE" && (
                    <form onSubmit={(event) => submitQuote(event, request)} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <div>
                        <h4 className="text-xs font-bold text-amber-950">Submit your production quote</h4>
                        <p className="mt-1 text-[10px] text-amber-900">Admin controls the ordered SKUs and quantities. Your quote must be approved before production can begin.</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="text-xs font-semibold text-[#171717]">Price per piece ({currency})
                          <input required type="number" min="0.01" step="0.01" value={quote.unitCogs} onChange={(event) => updateQuote(request.id, "unitCogs", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="text-xs font-semibold text-[#171717]">Other production expenses for this order ({currency})
                          <input required type="number" min="0" step="0.01" value={quote.otherCost} onChange={(event) => updateQuote(request.id, "otherCost", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="text-xs font-semibold text-[#171717]">VAT treatment
                          <select value={quote.vatTreatment} onChange={(event) => updateQuote(request.id, "vatTreatment", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm">
                            <option value="EXEMPT">No VAT / exempt</option>
                            <option value="VAT_INCLUSIVE">VAT inclusive</option>
                            <option value="VAT_EXCLUSIVE">VAT exclusive</option>
                          </select>
                        </label>
                        {quote.vatTreatment !== "EXEMPT" && <>
                          <label className="text-xs font-semibold text-[#171717]">VAT rate (%)
                            <input required type="number" min="0.01" max="100" step="0.01" value={quote.vatRate} onChange={(event) => updateQuote(request.id, "vatRate", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
                          </label>
                          <label className="text-xs font-semibold text-[#171717]">VAT invoice reference
                            <input required maxLength={120} value={quote.vatInvoiceReference} onChange={(event) => updateQuote(request.id, "vatInvoiceReference", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
                          </label>
                        </>}
                      </div>
                      <label className="block text-xs font-semibold text-[#171717]">Quote notes (optional)
                        <textarea maxLength={2000} rows={2} value={quote.manufacturerNote} onChange={(event) => updateQuote(request.id, "manufacturerNote", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
                      </label>
                      <button disabled={savingId === request.id} className="rounded-xl bg-[#171717] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                        {savingId === request.id ? "Submitting quote..." : "Submit quote for Admin approval"}
                      </button>
                    </form>
                  )}

                  {request.status === "PENDING_ADMIN_APPROVAL" && (
                    <p className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">Your quote has been sent to Admin. Wait for approval before starting production.</p>
                  )}

                  {unitAmount != null && (
                    <div className="grid gap-2 rounded-lg border border-[#dedbd3] bg-white p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                      <p>{approved ? "Approved" : "Quoted"} price per piece <strong className="block">{currency}{costBreakdown.gross}</strong></p>
                      <p>{approved ? "Approved" : "Quoted"} other production expenses <strong className="block">{currency}{Number(approved ? request.approvedDeliveryCost || 0 : request.proposedDeliveryCost || 0).toFixed(2)} / order</strong></p>
                      <p>Inventory unit cost <strong className="block">{currency}{costBreakdown.inventoryCost}</strong></p>
                      <p>VAT invoice {(approved && request.approvedVatInvoiceVerified) ? <strong>verified</strong> : <strong>not verified</strong>}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {["APPROVED", "PRE_CHECK_FAILED"].includes(request.status) && (
                      <button onClick={() => setPreCheckRequest(request)} className="flex items-center gap-1 rounded-lg border border-[#dedbd3] bg-[#f8f7f4] px-3 py-1.5 text-xs font-bold text-[#171717]">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        {request.status === "PRE_CHECK_FAILED" ? "Retry Pre-Production Check" : "Pre-Production Check"}
                      </button>
                    )}
                    {request.status === "PRE_CHECK_PASSED" && (
                      <button disabled={savingId === request.id} onClick={() => startProduction(request)} className="flex items-center gap-1 rounded-lg bg-[#171717] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                        <Play className="h-3.5 w-3.5" /> Start Production
                      </button>
                    )}
                    {["IN_PRODUCTION", "POST_CHECK_FAILED"].includes(request.status) && (
                      <button onClick={() => setPostCheckRequest(request)} className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {request.status === "POST_CHECK_FAILED" ? "Retry QA & Submit" : "Complete QA & Submit"}
                      </button>
                    )}
                  </div>
                  {request.status === "PENDING_ADMIN_ACCEPTANCE" && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      Final inspection is awaiting Admin acceptance. Do not dispatch these units; stock is not available until accepted.
                    </p>
                  )}
                  {request.status === "POST_CHECK_FAILED" && request.productionReviewDecision === "REJECT" && (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                      Admin requested rework before accepting these units. {request.productionReviewNote || ""}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {preCheckRequest && (
        <PreProductionChecklistModal
          request={preCheckRequest}
          token={token}
          onClose={() => setPreCheckRequest(null)}
          onSuccess={loadData}
        />
      )}
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
