import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Check, ExternalLink, LoaderCircle, PackagePlus, RefreshCw, ShieldAlert, Truck } from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";
import { validatePeerReceiptLine } from "../utils/distributorLogisticsValidation";

const api = `${backendUrl}/api/distributor`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
const statusLabel = (value) => String(value || "PENDING").replaceAll("_", " ");
const idempotencyKey = () => crypto.randomUUID();

const PeerReceiptForm = ({ transfer, shipment, evidenceEvents, submitting, onReceive }) => {
  const [values, setValues] = useState({});
  const retryRequest = useRef(null);
  const shipmentLines = shipment.lines || [];

  const priorByLine = useMemo(() => {
    const totals = new Map();
    for (const receipt of shipment.receipts || []) {
      for (const line of receipt.lines || []) {
        const previous = totals.get(line.shipmentLineId) || 0;
        totals.set(line.shipmentLineId, previous + Number(line.goodQuantity || 0) +
          Number(line.damagedQuantity || 0) + Number(line.missingQuantity || 0));
      }
    }
    return totals;
  }, [shipment.receipts]);

  const setLineValue = (lineId, key, value) => {
    setValues((current) => ({ ...current, [lineId]: { ...current[lineId], [key]: value } }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (submitting) return;
    const lines = [];
    for (const line of shipmentLines) {
      const current = values[line.id] || {};
      const remainingQuantity = Number(line.quantity) - Number(priorByLine.get(line.id) || 0);
      if (![current.goodQuantity, current.damagedQuantity, current.missingQuantity].some((quantity) => Number(quantity || 0) > 0)) continue;
      const message = validatePeerReceiptLine({
        ...current,
        remainingQuantity,
      });
      if (message) {
        toast.error(`${line.inventorySku?.skuCode || "Shipment line"}: ${message}`);
        return;
      }
      lines.push({
        shipmentLineId: line.id,
        goodQuantity: Number(current.goodQuantity || 0),
        damagedQuantity: Number(current.damagedQuantity || 0),
        missingQuantity: Number(current.missingQuantity || 0),
        damageType: current.damagedQuantity ? current.damageType || "OTHER_DAMAGE" : undefined,
        note: current.note || "",
        evidence: current.evidenceEventId ? { evidenceEventId: current.evidenceEventId } : undefined,
      });
    }
    if (!lines.length) {
      toast.error("Enter at least one good, damaged, or missing quantity.");
      return;
    }
    const request = { shipmentId: shipment.id, notes: "", lines };
    const fingerprint = JSON.stringify(request);
    const key = retryRequest.current?.fingerprint === fingerprint ? retryRequest.current.key : idempotencyKey();
    retryRequest.current = { fingerprint, key };
    onReceive(transfer, shipment, { ...request, idempotencyKey: key }, () => {
      retryRequest.current = null;
      setValues({});
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <div>
        <h4 className="text-xs font-bold text-sky-950">Record receipt · {statusLabel(shipment.status)}</h4>
        <p className="mt-1 text-[11px] text-sky-900">Account for received, damaged, or missing units. Quantity changes are recorded only by the existing ledger-backed receipt API.</p>
      </div>
      {shipmentLines.map((line) => {
        const current = values[line.id] || {};
        const alreadyAccounted = Number(priorByLine.get(line.id) || 0);
        const remaining = Math.max(0, Number(line.quantity) - alreadyAccounted);
        const sku = line.inventorySku || transfer.lines?.find((item) => item.id === line.stockTransferLineId)?.inventorySku;
        return (
          <div key={line.id} className="rounded-lg border border-sky-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-900">{sku?.product?.name || "Product"} · {sku?.color || "—"} / {sku?.size || "—"}</p>
            <p className="mt-1 text-[10px] text-slate-500">Shipped {line.quantity} · previously accounted {alreadyAccounted} · remaining {remaining}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                ["goodQuantity", "Good"],
                ["damagedQuantity", "Damaged"],
                ["missingQuantity", "Missing"],
              ].map(([key, label]) => (
                <label key={key} className="text-[10px] font-semibold text-slate-600">
                  {label}
                  <input aria-label={`${label} quantity`} type="number" min="0" max={remaining} step="1" value={current[key] || ""} onChange={(event) => setLineValue(line.id, key, event.target.value)} className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2 text-sm" />
                </label>
              ))}
            </div>
            {Number(current.damagedQuantity || 0) > 0 && (
              <label className="mt-2 block text-[10px] font-semibold text-slate-600">
                Damage classification
                <select value={current.damageType || "OTHER_DAMAGE"} onChange={(event) => setLineValue(line.id, "damageType", event.target.value)} className="mt-1 min-h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs">
                  <option value="OTHER_DAMAGE">Other damage</option><option value="DELIVERY_DAMAGE">Delivery damage</option><option value="PACKAGING_DAMAGE">Packaging damage</option><option value="MANUFACTURING_DEFECT">Manufacturing defect</option>
                </select>
              </label>
            )}
            {evidenceEvents.length > 0 && (
              <label className="mt-2 block text-[10px] font-semibold text-slate-600">
                Link uploaded custody evidence (optional)
                <select value={current.evidenceEventId || ""} onChange={(event) => setLineValue(line.id, "evidenceEventId", event.target.value)} className="mt-1 min-h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs">
                  <option value="">No evidence selected</option>
                  {evidenceEvents.filter((item) => !item.shipmentLineId || item.shipmentLineId === line.id).map((item) => (
                    <option key={item.id} value={item.id}>{item.details || "Evidence"} · {formatDate(item.createdAt)}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="mt-2 block text-[10px] font-semibold text-slate-600">
              Line note
              <input maxLength={4000} value={current.note || ""} onChange={(event) => setLineValue(line.id, "note", event.target.value)} className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2 text-xs" />
            </label>
          </div>
        );
      })}
      <button type="submit" disabled={submitting} className="min-h-10 rounded-lg bg-sky-800 px-3 text-xs font-bold text-white disabled:opacity-50">
        {submitting ? "Recording receipt…" : "Record selected receipt quantities"}
      </button>
    </form>
  );
};

const DistributorPeerTransfers = () => {
  const { token, distributor } = useManufacturer();
  const [transfers, setTransfers] = useState([]);
  const [eligibleDistributors, setEligibleDistributors] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [inventoryPagination, setInventoryPagination] = useState(null);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryLoadingMore, setInventoryLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inventoryError, setInventoryError] = useState("");
  const [eligibleError, setEligibleError] = useState("");
  const [view, setView] = useState("ALL");
  const [sourceDistributorId, setSourceDistributorId] = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("1");
  const [requestLines, setRequestLines] = useState([]);
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState("");
  const [receivingShipmentId, setReceivingShipmentId] = useState("");
  const [evidenceUploadId, setEvidenceUploadId] = useState("");
  const [evidenceForm, setEvidenceForm] = useState({});
  const [evidencePreview, setEvidencePreview] = useState(null);
  const createRetry = useRef(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const [transfersResult, directoryResult, inventoryResult] = await Promise.allSettled([
      axios.get(`${api}/peer-transfers`, { headers: { token } }),
      axios.get(`${api}/peer-transfers/eligible-distributors`, { headers: { token } }),
      axios.get(`${api}/inventory?groupBy=product&page=1&limit=100`, { headers: { token } }),
    ]);
    if (transfersResult.status === "fulfilled") setTransfers(transfersResult.value.data.transfers || []);
    else {
      const requestError = transfersResult.reason;
      setError(requestError.response?.status === 403
        ? "Your account does not have permission to view peer stock transfers."
        : requestError.response?.data?.message || "Could not load peer stock transfer history.");
    }
    if (directoryResult.status === "fulfilled") {
      setEligibleDistributors(directoryResult.value.data.distributors || []);
      setEligibleError("");
    } else {
      setEligibleDistributors([]);
      setEligibleError(directoryResult.reason.response?.data?.message || "Eligible source distributors could not be loaded.");
    }
    if (inventoryResult.status === "fulfilled") {
      setInventory(inventoryResult.value.data.inventory || []);
      setInventoryPagination(inventoryResult.value.data.pagination || null);
      setInventoryPage(1);
      setInventoryError("");
    } else {
      setInventory([]);
      setInventoryError(inventoryResult.reason.response?.status === 403
        ? "Inventory read permission is required to select product variants."
        : inventoryResult.reason.response?.data?.message || "Product variants could not be loaded.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => {
    if (evidencePreview?.url) URL.revokeObjectURL(evidencePreview.url);
  }, [evidencePreview]);

  const loadMoreInventory = async () => {
    const nextPage = inventoryPage + 1;
    setInventoryLoadingMore(true);
    try {
      const response = await axios.get(`${api}/inventory?groupBy=product&page=${nextPage}&limit=100`, { headers: { token } });
      setInventory((current) => [...current, ...(response.data.inventory || [])]);
      setInventoryPagination(response.data.pagination || inventoryPagination);
      setInventoryPage(nextPage);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Could not load more product variants.");
    } finally {
      setInventoryLoadingMore(false);
    }
  };

  const skuOptions = useMemo(() => inventory.flatMap((product) =>
    (product.variants || []).map((variant) => ({
      ...variant,
      productName: product.productName,
      label: `${product.productName} · ${variant.color || "—"} / ${variant.size || "—"} · available ${variant.availableQty}`,
    })),
  ), [inventory]);
  const selectedSku = skuOptions.find((item) => item.inventorySkuId === selectedSkuId);

  const visibleTransfers = useMemo(() => transfers.filter((transfer) => {
    if (view === "INCOMING") return transfer.sourceDistributorId === distributor?.id;
    if (view === "OUTGOING") return transfer.distributorId === distributor?.id;
    return true;
  }), [distributor?.id, transfers, view]);

  const addRequestLine = () => {
    const quantity = Number(requestedQuantity);
    if (!selectedSkuId || !Number.isSafeInteger(quantity) || quantity < 1) {
      toast.error("Choose a variant and enter a positive whole-number quantity.");
      return;
    }
    if (requestLines.some((line) => line.inventorySkuId === selectedSkuId)) {
      toast.error("That product variant is already in this request.");
      return;
    }
    setRequestLines((current) => [...current, {
      inventorySkuId: selectedSkuId,
      productName: selectedSku.productName,
      color: selectedSku.color,
      size: selectedSku.size,
      quantity,
    }]);
  };

  const createRequest = async (event) => {
    event.preventDefault();
    if (creating) return;
    if (!sourceDistributorId || !requestLines.length) {
      toast.error("Select a source distributor and add at least one variant.");
      return;
    }
    const request = {
      sourceDistributorId,
      lines: requestLines.map(({ inventorySkuId, quantity }) => ({ inventorySkuId, quantity })),
    };
    const fingerprint = JSON.stringify(request);
    const key = createRetry.current?.fingerprint === fingerprint ? createRetry.current.key : idempotencyKey();
    createRetry.current = { fingerprint, key };
    setCreating(true);
    try {
      await axios.post(`${api}/peer-transfers`, { ...request, idempotencyKey: key }, { headers: { token } });
      createRetry.current = null;
      setRequestLines([]);
      setSourceDistributorId("");
      toast.success("Peer stock request submitted for approval.");
      await loadData();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Stock request was not submitted. Retry without changing the request to safely reuse its idempotency key.");
    } finally {
      setCreating(false);
    }
  };

  const runAction = async (transfer, action, payload = {}, confirmText = "") => {
    if (actionId) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setActionId(`${transfer.id}:${action}`);
    try {
      const url = `${api}/peer-transfers/${encodeURIComponent(transfer.id)}/${action}`;
      await axios.post(url, payload, { headers: { token } });
      toast.success(action === "dispatch" ? "Peer transfer dispatched." : `Peer transfer ${action} completed.`);
      await loadData();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || `Could not ${action} peer transfer.`);
    } finally {
      setActionId("");
    }
  };

  const recordReceipt = async (transfer, shipment, payload, onSuccess) => {
    if (receivingShipmentId) return;
    if (!window.confirm("Record these good, damaged, and missing quantities against the shipment? Inventory will be updated by the server ledger.")) return;
    setReceivingShipmentId(shipment.id);
    try {
      await axios.post(
        `${api}/peer-transfers/${encodeURIComponent(transfer.id)}/shipments/${encodeURIComponent(shipment.id)}/receive`,
        payload,
        { headers: { token, "Idempotency-Key": payload.idempotencyKey } },
      );
      onSuccess();
      toast.success("Peer transfer receipt recorded.");
      await loadData();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Receipt was not recorded. Retry the unchanged quantities to reuse the idempotency key.");
    } finally {
      setReceivingShipmentId("");
    }
  };

  const uploadEvidence = async (transfer) => {
    const current = evidenceForm[transfer.id] || {};
    if (!current.file) {
      toast.error("Select a JPG or PNG evidence image.");
      return;
    }
    const fingerprint = `${current.file.name}|${current.file.size}|${current.file.lastModified}|${current.details}|${current.shipmentLineId}`;
    const key = current.fingerprint === fingerprint && current.idempotencyKey
      ? current.idempotencyKey
      : idempotencyKey();
    const body = new FormData();
    body.append("evidence", current.file);
    body.append("details", current.details || "Transfer custody evidence");
    body.append("shipmentLineId", current.shipmentLineId || "");
    body.append("idempotencyKey", key);
    setEvidenceUploadId(transfer.id);
    try {
      await axios.post(`${api}/peer-transfers/${encodeURIComponent(transfer.id)}/evidence`, body, { headers: { token } });
      setEvidenceForm((all) => ({ ...all, [transfer.id]: {} }));
      toast.success("Private transfer evidence uploaded and recorded in custody history.");
      await loadData();
    } catch (requestError) {
      setEvidenceForm((all) => ({
        ...all,
        [transfer.id]: { ...current, fingerprint, idempotencyKey: key },
      }));
      toast.error(requestError.response?.data?.message || "Evidence was not recorded. Retry with the same file and details.");
    } finally {
      setEvidenceUploadId("");
    }
  };

  const viewEvidence = async (transfer, event) => {
    try {
      const response = await axios.get(
        `${api}/peer-transfers/${encodeURIComponent(transfer.id)}/evidence/${encodeURIComponent(event.id)}`,
        { headers: { token }, responseType: "blob" },
      );
      setEvidencePreview({ url: URL.createObjectURL(response.data), details: event.details || "Transfer evidence" });
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Could not retrieve authenticated transfer evidence.");
    }
  };

  const uploadInput = (transfer) => {
    const current = evidenceForm[transfer.id] || {};
    const shipmentLines = transfer.shipments?.flatMap((shipment) => shipment.lines || []) || [];
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
        <h4 className="text-xs font-bold text-slate-800">Private discrepancy / custody evidence</h4>
        <label className="block text-[11px] font-semibold text-slate-600">
          Attach to shipment line (optional)
          <select value={current.shipmentLineId || ""} onChange={(event) => setEvidenceForm((all) => ({ ...all, [transfer.id]: { ...current, shipmentLineId: event.target.value } }))} className="mt-1 min-h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs">
            <option value="">General transfer evidence</option>
            {shipmentLines.map((line) => <option key={line.id} value={line.id}>{line.id.slice(0, 8)} · {line.quantity} shipped</option>)}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Evidence note
          <input maxLength={2000} value={current.details || ""} onChange={(event) => setEvidenceForm((all) => ({ ...all, [transfer.id]: { ...current, details: event.target.value } }))} className="mt-1 min-h-9 w-full rounded border border-slate-300 px-2 text-xs" placeholder="Describe what the photo shows" />
        </label>
        <input type="file" accept="image/jpeg,image/png" aria-label="Upload peer transfer evidence image" onChange={(event) => setEvidenceForm((all) => ({ ...all, [transfer.id]: { ...current, file: event.target.files?.[0] || null } }))} className="block w-full text-xs" />
        <button type="button" disabled={evidenceUploadId === transfer.id || !current.file} onClick={() => uploadEvidence(transfer)} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-50">
          {evidenceUploadId === transfer.id ? "Uploading…" : "Upload private evidence"}
        </button>
        {(transfer.custodyEvents || []).filter((item) => item.eventType === "EVIDENCE_ATTACHED" && item.hasEvidence).map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-[11px]">
            <span>{item.details || "Evidence"} · {formatDate(item.createdAt)}</span>
            <button type="button" onClick={() => viewEvidence(transfer, item)} className="inline-flex items-center gap-1 font-bold text-sky-800 underline"><ExternalLink className="h-3 w-3" /> View securely</button>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600" role="status"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading peer transfers…</div>;
  }

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#dedbd3] pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Distributor logistics</p>
          <h1 className="mt-1 text-2xl font-black text-[#171717]">Peer stock transfers</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Request stock, approve custody steps, dispatch, record actual receipt quantities, and retain an auditable evidence trail.</p>
        </div>
        <button type="button" onClick={loadData} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><span>{error}</span><button type="button" onClick={loadData} className="font-bold underline">Retry</button></div>}

      {!error && (
        <form onSubmit={createRequest} className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-2">
            <PackagePlus className="mt-0.5 h-5 w-5 text-emerald-800" />
            <div><h2 className="text-sm font-bold text-emerald-950">Request stock from another distributor</h2><p className="mt-1 text-xs text-emerald-900">This creates an approval request only; it does not increase inventory. Source availability is validated by the backend.</p></div>
          </div>
          {inventoryError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{inventoryError}</p>}
          {eligibleError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{eligibleError}</p>}
          {!eligibleError && eligibleDistributors.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">No other active peer distributor is currently eligible.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Source distributor
              <select value={sourceDistributorId} onChange={(event) => setSourceDistributorId(event.target.value)} required className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">Choose an eligible distributor</option>
                {eligibleDistributors.map((item) => <option key={item.id} value={item.id}>{item.name} · {[item.district, item.province].filter(Boolean).join(", ")}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Product variant
              <select value={selectedSkuId} onChange={(event) => setSelectedSkuId(event.target.value)} disabled={Boolean(inventoryError)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">Choose variant from your current catalog</option>
                {skuOptions.map((item) => <option key={item.inventorySkuId} value={item.inventorySkuId}>{item.label}</option>)}
              </select>
            </label>
          </div>
          {inventoryPagination?.totalPages > inventoryPage && (
            <button type="button" disabled={inventoryLoadingMore} onClick={loadMoreInventory} className="text-xs font-semibold text-emerald-900 underline">
              {inventoryLoadingMore ? "Loading variants…" : `Load more variants (page ${inventoryPage + 1} of ${inventoryPagination.totalPages})`}
            </button>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-700">
              Quantity
              <input type="number" min="1" step="1" value={requestedQuantity} onChange={(event) => setRequestedQuantity(event.target.value)} className="mt-1 min-h-10 w-32 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
            </label>
            <button type="button" disabled={!selectedSku || !requestedQuantity} onClick={addRequestLine} className="min-h-10 rounded-lg border border-emerald-700 bg-white px-3 text-xs font-bold text-emerald-900 disabled:opacity-50">Add variant</button>
          </div>
          {requestLines.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {requestLines.map((line) => (
                <li key={line.inventorySkuId} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-white p-2 text-xs">
                  <span>{line.productName} · {line.color} / {line.size}</span>
                  <span className="flex items-center gap-2 font-bold">× {line.quantity}<button type="button" aria-label={`Remove ${line.productName} ${line.color} ${line.size}`} onClick={() => setRequestLines((current) => current.filter((entry) => entry.inventorySkuId !== line.inventorySkuId))} className="text-rose-700 underline">Remove</button></span>
                </li>
              ))}
            </ul>
          )}
          <button type="submit" disabled={creating || !sourceDistributorId || !requestLines.length} className="min-h-10 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white disabled:opacity-50">
            {creating ? "Submitting…" : "Submit stock request"}
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Transfer history ({visibleTransfers.length})</h2>
          <p className="mt-1 text-xs text-slate-600">Showing up to 100 recent transfers involving your authenticated distributor workspace.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter transfers">
          {["ALL", "INCOMING", "OUTGOING"].map((item) => (
            <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)} className={`min-h-9 rounded-lg border px-3 text-xs font-bold ${view === item ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{item === "ALL" ? "All" : item === "INCOMING" ? "Source requests" : "Requests I sent"}</button>
          ))}
        </div>
      </div>

      {!error && visibleTransfers.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">No peer transfers in this view yet.</div>}

      <div className="space-y-4">
        {visibleTransfers.map((transfer) => {
          const isSource = transfer.sourceDistributorId === distributor?.id;
          const counterpart = isSource ? transfer.distributor : transfer.sourceDistributor;
          const sourceApproved = transfer.custodyEvents?.some((event) => event.eventType === "SOURCE_APPROVED");
          const receiverApproved = transfer.custodyEvents?.some((event) => event.eventType === "RECEIVER_APPROVED");
          const evidenceEvents = (transfer.custodyEvents || []).filter((item) => item.eventType === "EVIDENCE_ATTACHED" && item.hasEvidence);
          const allowedCancel = ["PENDING_SOURCE_APPROVAL", "APPROVED"].includes(transfer.status) && !transfer.shipments?.length;
          const canApprove = transfer.status === "PENDING_SOURCE_APPROVAL" &&
            (isSource ? !sourceApproved : !receiverApproved);
          return (
            <article key={transfer.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{isSource ? "Incoming source request" : "Request submitted"} · {formatDate(transfer.requestedAt || transfer.createdAt)}</p>
                  <h3 className="mt-1 text-base font-black text-slate-950">{counterpart?.name || "Peer distributor"} <span className="ml-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold">{statusLabel(transfer.status)}</span></h3>
                  <p className="mt-1 text-[11px] text-slate-500">{[counterpart?.district, counterpart?.province].filter(Boolean).join(", ") || "Location not listed"} · Transfer {transfer.id.slice(0, 8)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canApprove && (
                    <button type="button" disabled={Boolean(actionId)} onClick={() => runAction(transfer, "approve", { approval: isSource ? "SOURCE_APPROVED" : "RECEIVER_APPROVED" }, "Confirm your approval of this peer stock request?")} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">
                      <Check className="h-3 w-3" /> {actionId === `${transfer.id}:approve` ? "Approving…" : `Approve ${isSource ? "dispatch" : "request"}`}
                    </button>
                  )}
                  {isSource && transfer.status === "PENDING_SOURCE_APPROVAL" && !sourceApproved && (
                    <button type="button" disabled={Boolean(actionId)} onClick={() => runAction(transfer, "reject", { reason: window.prompt("Optional rejection reason") || "Rejected by source distributor." }, "Reject this peer stock request?")} className="min-h-9 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-800 disabled:opacity-50">
                      {actionId === `${transfer.id}:reject` ? "Rejecting…" : "Reject"}
                    </button>
                  )}
                  {isSource && transfer.status === "APPROVED" && (
                    <button type="button" disabled={Boolean(actionId)} onClick={() => {
                      const deliveryPartner = window.prompt("Delivery partner (or MANUAL):", "MANUAL");
                      if (deliveryPartner === null) return;
                      const trackingNumber = window.prompt("Tracking number (optional):", "") || "";
                      runAction(transfer, "dispatch", { deliveryPartner, trackingNumber }, "Dispatch approved stock into transit custody?");
                    }} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-sky-800 px-3 text-xs font-bold text-white disabled:opacity-50">
                      <Truck className="h-3 w-3" /> {actionId === `${transfer.id}:dispatch` ? "Dispatching…" : "Dispatch"}
                    </button>
                  )}
                  {allowedCancel && (
                    <button type="button" disabled={Boolean(actionId)} onClick={() => runAction(transfer, "cancel", { reason: window.prompt("Cancellation reason:", "Cancelled by distributor") || "Cancelled by distributor" }, "Cancel this peer stock transfer?")} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-50">Cancel</button>
                  )}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {(transfer.lines || []).map((line) => (
                  <div key={line.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="font-semibold text-slate-900">{line.inventorySku?.product?.name || "Product"} · {line.inventorySku?.color || "—"} / {line.inventorySku?.size || "—"}</p>
                    <p className="mt-1 text-slate-600">Requested {line.requestedQuantity} · approved {line.approvedQuantity || "—"}</p>
                  </div>
                ))}
              </div>

              {transfer.status === "PENDING_SOURCE_APPROVAL" && (
                <p className="text-[11px] text-slate-600">Approvals: source {sourceApproved ? "complete" : "pending"} · receiving distributor {receiverApproved ? "complete" : "pending"}</p>
              )}
              {transfer.discrepancies?.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  <p className="flex items-center gap-1 font-bold"><ShieldAlert className="h-4 w-4" /> Open / recorded discrepancies</p>
                  {transfer.discrepancies.map((item) => <p key={item.id} className="mt-1">{statusLabel(item.discrepancyType)} · {item.quantity} unit(s) · {statusLabel(item.status)}</p>)}
                </div>
              )}

              {(transfer.shipments || []).map((shipment) => (
                <div key={shipment.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <p className="font-bold text-slate-900">Shipment {shipment.id.slice(0, 8)} · {statusLabel(shipment.status)}</p>
                    <p className="text-slate-600">{shipment.deliveryPartner || "Manual"} {shipment.trackingNumber ? `· ${shipment.trackingNumber}` : ""} · dispatched {formatDate(shipment.dispatchedAt)}</p>
                  </div>
                  {shipment.receipts?.map((receipt) => (
                    <div key={receipt.id} className="rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-950">
                      Receipt {receipt.id.slice(0, 8)} · {formatDate(receipt.createdAt)}
                      {(receipt.lines || []).map((line) => <p key={line.id} className="mt-1">Good {line.goodQuantity} · damaged {line.damagedQuantity} · missing {line.missingQuantity}{line.note ? ` · ${line.note}` : ""}</p>)}
                    </div>
                  ))}
                  {!isSource && ["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status) && (
                    <PeerReceiptForm
                      transfer={transfer}
                      shipment={shipment}
                      evidenceEvents={evidenceEvents}
                      submitting={receivingShipmentId === shipment.id}
                      onReceive={recordReceipt}
                    />
                  )}
                </div>
              ))}

              {(transfer.status === "DISCREPANCY" || transfer.discrepancies?.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={Boolean(actionId)} onClick={() => {
                    const details = window.prompt("Describe the disputed transfer or receipt issue:");
                    if (!details?.trim()) return;
                    runAction(transfer, "dispute", { details: details.trim(), responsibleParty: isSource ? "SOURCE_DISTRIBUTOR" : "RECEIVING_DISTRIBUTOR", idempotencyKey: idempotencyKey(), evidence: evidenceEvents.length ? { evidenceEventIds: evidenceEvents.map((item) => item.id) } : undefined }, "Submit this custody dispute?");
                  }} className="min-h-9 rounded-lg border border-amber-400 px-3 text-xs font-bold text-amber-900 disabled:opacity-50">Submit dispute</button>
                  <span className="text-[11px] text-slate-500">Evidence uploads and disputes are recorded as custody events; only the backend can resolve stock movement.</span>
                </div>
              )}

              {uploadInput(transfer)}

              {(transfer.custodyEvents || []).length > 0 && (
                <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-xs font-bold text-slate-800">Custody and audit history ({transfer.custodyEvents.length})</summary>
                  <ol className="mt-2 space-y-2">
                    {transfer.custodyEvents.map((item) => (
                      <li key={item.id} className="border-l-2 border-slate-300 pl-3 text-[11px] text-slate-700">
                        <span className="font-bold">{statusLabel(item.eventType)}</span> · {statusLabel(item.custodyStage)} · {item.responsibilityParty.replaceAll("_", " ")} · {formatDate(item.createdAt)}
                        {item.details && <p className="mt-1">{item.details}</p>}
                        {item.hasEvidence && <p className="mt-1 text-emerald-800">Private evidence attached</p>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          );
        })}
      </div>

      {evidencePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Private transfer evidence">
          <div className="max-h-[90vh] w-full max-w-3xl rounded-xl bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">{evidencePreview.details}</h2>
              <button type="button" onClick={() => setEvidencePreview(null)} className="rounded px-3 py-2 text-sm font-bold">Close</button>
            </div>
            <img src={evidencePreview.url} alt={evidencePreview.details} className="mx-auto max-h-[75vh] max-w-full object-contain" />
          </div>
        </div>
      )}
    </section>
  );
};

export default DistributorPeerTransfers;
