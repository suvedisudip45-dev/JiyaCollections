import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Boxes,
  Truck,
  Plus,
  Trash2,
  CheckCircle2,
  RotateCw,
  PackageCheck,
} from "lucide-react";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";
import Pagination from "../components/Pagination";

const emptyRow = () => ({ inventorySkuId: "", quantity: 1 });
const TRANSFER_PAGE_SIZE = 10;

const DistributorDemandReceipt = () => {
  const { transferId } = useParams();
  const { token, distributor } = useManufacturer();
  const [activeTab, setActiveTab] = useState(transferId ? "receipts" : "demand"); // 'demand' | 'receipts'
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [transfers, setTransfers] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [manufacturerId, setManufacturerId] = useState("");
  const [requestLines, setRequestLines] = useState([emptyRow()]);
  const [receivingLine, setReceivingLine] = useState(null);
  const [receiptDraft, setReceiptDraft] = useState({
    goodQuantity: 0,
    damagedQuantity: 0,
    missingQuantity: 0,
    damageType: "DELIVERY_DAMAGE",
    evidence: "",
    note: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTransferId, setEditingTransferId] = useState("");
  const [editLines, setEditLines] = useState([]);

  const selectedManufacturer = useMemo(
    () => catalog.find((item) => item.id === manufacturerId),
    [catalog, manufacturerId]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { token };
      const catalogRequest = axios
        .get(`${backendUrl}/api/stock-transfers/catalog`, { headers })
        .then(({ data }) => {
          const manufacturers = data?.manufacturers;
          if (!Array.isArray(manufacturers)) {
            throw new Error("The factory stock catalog returned an invalid response.");
          }
          setCatalog(manufacturers);
          setCatalogError("");
        })
        .catch((error) => {
          const message = error?.response?.data?.message || error?.message || "Could not load available factory stock.";
          setCatalogError(message);
          toast.error(message);
        });
      const transfersRequest = axios
        .get(`${backendUrl}/api/stock-transfers/distributor`, {
          headers,
          params: transferId
            ? { transferId, page: 1, limit: 1 }
            : { page, limit: TRANSFER_PAGE_SIZE },
        })
        .then(({ data }) => {
          const listedTransfers = data?.transfers;
          if (!Array.isArray(listedTransfers)) {
            throw new Error("The inbound transfer list returned an invalid response.");
          }
          setTransfers(listedTransfers);
          setPagination(data.pagination || null);
        })
        .catch((error) => {
          toast.error(error?.response?.data?.message || error?.message || "Could not load inbound transfers.");
        });
      await Promise.all([catalogRequest, transfersRequest]);
    } finally {
      setLoading(false);
    }
  }, [page, token, transferId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const refreshWhenFocused = () => {
      if (document.visibilityState === "visible") loadData();
    };
    window.addEventListener("focus", refreshWhenFocused);
    return () => window.removeEventListener("focus", refreshWhenFocused);
  }, [loadData]);

  const updateRequestLine = (index, field, value) => {
    setRequestLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line
      )
    );
  };

  const addLine = () => setRequestLines((curr) => [...curr, emptyRow()]);
  const removeLine = (idx) => {
    if (requestLines.length === 1) return;
    setRequestLines((curr) => curr.filter((_, i) => i !== idx));
  };

  const submitDemandRequest = async (e) => {
    e.preventDefault();
    if (!manufacturerId) {
      toast.error("Please select a manufacturing factory.");
      return;
    }
    const validLines = requestLines.filter((l) => l.inventorySkuId && Number(l.quantity) > 0);
    if (!validLines.length) {
      toast.error("Add at least one valid product SKU variant with quantity.");
      return;
    }

    setSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/stock-transfers/requests`,
        {
          manufacturerId,
          lines: validLines.map((line) => ({
            inventorySkuId: line.inventorySkuId,
            quantity: Number(line.quantity),
          })),
        },
        { headers: { token } }
      );
      toast.success("Stock demand request submitted for Admin review.");
      setRequestLines([emptyRow()]);
      setTransfers((current) => [response.data.transfer, ...current]);
      setActiveTab("receipts");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to submit demand request.");
    } finally {
      setSaving(false);
    }
  };

  const canEditTransfer = (transfer) => (
    ["PENDING_ADMIN_APPROVAL", "APPROVED"].includes(transfer.status) &&
    ![
      transfer.availabilityPassed,
      transfer.qualityPassed,
      transfer.colorPassed,
      transfer.sizePassed,
      transfer.packagingPassed,
    ].every((value) => value === true) &&
    !(transfer.shipments || []).length &&
    !(transfer.lines || []).some((line) => line.dispatchedQuantity > 0 || line.reservedShipmentQuantity > 0)
  );
  const beginEdit = (transfer) => {
    setManufacturerId(transfer.manufacturerId);
    setEditLines(transfer.lines.map((line) => ({
      inventorySkuId: line.inventorySkuId,
      quantity: String(line.requestedQuantity),
    })));
    setEditingTransferId(transfer.id);
  };
  const updateEditLine = (index, field, value) => setEditLines((current) =>
    current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line)
  );
  const saveDemandEdit = async (transfer) => {
    const lines = editLines
      .filter((line) => line.inventorySkuId && Number(line.quantity) > 0)
      .map((line) => ({ inventorySkuId: line.inventorySkuId, quantity: Number(line.quantity) }));
    if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.quantity))) {
      toast.error("Keep at least one product SKU with a positive whole-number quantity.");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/stock-transfers/distributor/${transfer.id}`,
        { lines },
        { headers: { token } },
      );
      toast.success(response.data.message || "Product request updated and sent for Admin review.");
      setEditingTransferId("");
      setEditLines([]);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not update the product request.");
    } finally {
      setSaving(false);
    }
  };

  const openReceiptModal = (shipmentLine, shipmentId) => {
    const alreadyReceived = (shipmentLine.receiptLines || []).reduce(
      (sum, line) => sum + line.goodQuantity + line.damagedQuantity + line.missingQuantity,
      0
    );
    const remaining = Math.max(0, shipmentLine.quantity - alreadyReceived);
    setReceivingLine({ ...shipmentLine, shipmentId, remaining });
    setReceiptDraft({
      goodQuantity: remaining,
      damagedQuantity: 0,
      missingQuantity: 0,
      damageType: "DELIVERY_DAMAGE",
      evidence: "",
      note: "",
    });
  };

  const submitReceiptQA = async (e) => {
    e.preventDefault();
    if (!receivingLine) return;

    const good = Number(receiptDraft.goodQuantity || 0);
    const damaged = Number(receiptDraft.damagedQuantity || 0);
    const missing = Number(receiptDraft.missingQuantity || 0);
    const total = good + damaged + missing;

    if (total !== receivingLine.remaining) {
      toast.error(`The sum of good (${good}), damaged (${damaged}), and missing (${missing}) units must equal ${receivingLine.remaining}.`);
      return;
    }

    setSaving(true);
    try {
      const evidence = receiptDraft.evidence.trim() ? [receiptDraft.evidence.trim()] : [];
      await axios.post(
        `${backendUrl}/api/stock-transfers/shipments/${receivingLine.shipmentId}/receipt`,
        {
          notes: receiptDraft.note || "",
          lines: [
            {
              shipmentLineId: receivingLine.id,
              goodQuantity: good,
              damagedQuantity: damaged,
              missingQuantity: missing,
              damageType: damaged > 0 ? receiptDraft.damageType : null,
              evidence,
              note: receiptDraft.note,
            },
          ],
        },
        {
          headers: {
            token,
            "Idempotency-Key": `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          },
        }
      );
      toast.success("Shipment receipt and QA recorded successfully.");
      setReceivingLine(null);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record shipment receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#dedbd3] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#171717]">{transferId ? "Inbound Transfer Details" : "Stock Demand &amp; Inbound Receipt"}</h1>
          <p className="text-xs text-[#575757] mt-1">
            Request inventory from factories and inspect inbound deliveries at {distributor?.name || "Hub"}.
          </p>
        </div>

        {/* Tab Switcher */}
        {transferId ? (
          <Link to="/distributor/demand" className="rounded-lg border border-[#dedbd3] px-3.5 py-2 text-xs font-bold text-[#171717] hover:bg-[#f8f7f4]">
            Back to transfers
          </Link>
        ) : <div className="flex items-center gap-1 bg-[#ffffff] p-1 rounded-xl border border-[#dedbd3] self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("demand")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === "demand"
                ? "bg-[#171717] text-white shadow-xs"
                : "text-[#575757] hover:text-[#171717] hover:bg-[#f8f7f4]"
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Demand Request
          </button>
          <button
            onClick={() => setActiveTab("receipts")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === "receipts"
                ? "bg-[#171717] text-white shadow-xs"
                : "text-[#575757] hover:text-[#171717] hover:bg-[#f8f7f4]"
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Inbound Shipments
          </button>
        </div>}
      </div>

      {activeTab === "demand" && !transferId ? (
        /* ================= DEMAND REQUEST VIEW ================= */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-6 shadow-xs space-y-5">
            <h2 className="text-sm font-bold text-[#171717]">Create Factory Stock Request</h2>

            <form onSubmit={submitDemandRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#171717] mb-1.5">Select Manufacturer Factory</label>
                <select
                  value={manufacturerId}
                  disabled={loading || Boolean(catalogError) || catalog.length === 0}
                  onChange={(e) => {
                    setManufacturerId(e.target.value);
                    setRequestLines([emptyRow()]);
                  }}
                  className="w-full text-xs p-2.5 rounded-xl border border-[#dedbd3] bg-[#ffffff] text-[#171717] focus:outline-none focus:border-[#171717]"
                  required
                >
                  <option value="">
                    {loading ? "Loading factories..." : catalogError ? "Factory catalog unavailable" : catalog.length ? "-- Choose Factory Partner --" : "No factories with available stock"}
                  </option>
                  {catalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.city || "Nepal"}) • {m.stock?.length || 0} SKU variants available
                    </option>
                  ))}
                </select>
                {!loading && catalogError && (
                  <p className="mt-2 text-xs text-rose-700">{catalogError}</p>
                )}
                {!loading && !catalogError && catalog.length === 0 && (
                  <p className="mt-2 text-xs text-[#575757]">
                    Factories appear here when they have an active factory location and unreserved stock for published product variants. If stock is expected, ask an administrator to check the factory inventory ledger.
                  </p>
                )}
              </div>

              {selectedManufacturer && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#171717]">Requested SKU Variants</span>
                    <button
                      type="button"
                      onClick={addLine}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#171717] bg-[#f8f7f4] hover:bg-[#dedbd3]/50 px-2.5 py-1 rounded-lg border border-[#dedbd3] transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add Variant
                    </button>
                  </div>

                  <div className="space-y-2">
                    {requestLines.map((line, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 rounded-xl bg-[#f8f7f4] border border-[#dedbd3]">
                        <select
                          value={line.inventorySkuId}
                          onChange={(e) => updateRequestLine(idx, "inventorySkuId", e.target.value)}
                          className="flex-1 text-xs p-2 rounded-lg border border-[#dedbd3] bg-[#ffffff] text-[#171717] focus:outline-none focus:border-[#171717]"
                          required
                        >
                          <option value="">-- Select SKU Variant --</option>
                          {selectedManufacturer.stock?.map((sku) => (
                            <option key={sku.inventorySkuId} value={sku.inventorySkuId}>
                              {sku.productName} • {sku.size} / {sku.color} (Available: {sku.availableQuantity})
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateRequestLine(idx, "quantity", e.target.value)}
                          placeholder="Qty"
                          className="w-20 text-xs p-2 rounded-lg border border-[#dedbd3] bg-[#ffffff] text-[#171717] text-center font-bold focus:outline-none focus:border-[#171717]"
                          required
                        />
                        {requestLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="p-2 text-[#575757] hover:text-rose-600 rounded-lg hover:bg-[#ffffff] transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={saving || loading || Boolean(catalogError) || !selectedManufacturer}
                    className="w-full mt-4 py-2.5 bg-[#171717] text-white text-xs font-bold rounded-xl hover:bg-[#262626] transition-colors disabled:opacity-50"
                  >
                    {saving ? "Submitting Request..." : "Send Request for Admin Approval"}
                  </button>
                </div>
              )}
            </form>
          </div>

          <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#575757]">Supply Workflow</h3>
            <ol className="space-y-3 text-xs text-[#575757]">
              <li className="flex gap-2">
                <span className="font-bold text-[#171717]">1.</span>
                <span>Select active factory and request specific SKU variant quantities.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#171717]">2.</span>
                <span>Admin verifies request and sets approved fulfillment quantities.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#171717]">3.</span>
                <span>Factory dispatches goods via carrier or local logistics.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#171717]">4.</span>
                <span>Distributor inspects inbound goods and confirms receipt in local stock.</span>
              </li>
            </ol>
          </div>
        </div>
      ) : (
        /* ================= INBOUND SHIPMENTS & QA VIEW ================= */
        <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-[#dedbd3] flex items-center justify-between bg-[#f8f7f4]">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#171717]">Recent Inbound Transfers</h2>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              aria-label="Refresh transfer and NCM status"
              title="Refresh transfer and NCM status"
              className="p-1 text-[#575757] hover:text-[#171717] rounded-lg disabled:opacity-50"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-[#575757]">Loading transfer receipts...</div>
          ) : !transfers.length ? (
            <div className="p-8 text-center text-xs text-[#575757]">No transfer requests found.</div>
          ) : (
            <div className="space-y-3">
              {!transferId && <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-[#f8f7f4] text-[10px] uppercase tracking-wider text-[#575757]">
                    <tr>
                      <th className="px-4 py-3">Transfer / Date</th>
                      <th className="px-4 py-3">Factory</th>
                      <th className="px-4 py-3">Products</th>
                      <th className="px-4 py-3 text-center">Shipments</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#dedbd3]">
                    {transfers.map((transfer) => {
                      const productNames = [...new Set((transfer.lines || [])
                        .map((line) => line.inventorySku?.product?.name)
                        .filter(Boolean))];
                      return (
                        <tr key={transfer.id} className="hover:bg-[#f8f7f4]/70">
                          <td className="px-4 py-3">
                            <p className="font-mono font-bold text-[#171717]">#{transfer.id.slice(0, 8)}</p>
                            <p className="mt-1 text-[10px] text-[#575757]">
                              {transfer.requestedAt ? new Date(transfer.requestedAt).toLocaleDateString() : "Date unavailable"}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-medium text-[#171717]">{transfer.manufacturer?.name || "Factory"}</td>
                          <td className="px-4 py-3 text-[#575757]">
                            {productNames.slice(0, 2).join(", ") || "No product details"}
                            {productNames.length > 2 ? ` +${productNames.length - 2} more` : ""}
                          </td>
                          <td className="px-4 py-3 text-center">{transfer.shipments?.length || 0}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full border border-[#dedbd3] bg-white px-2.5 py-1 text-[10px] font-bold uppercase text-[#171717]">
                              {transfer.status?.replaceAll("_", " ") || "Unknown"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              to={`/distributor/demand/${transfer.id}`}
                              className="rounded-lg border border-[#dedbd3] px-3 py-1.5 text-[11px] font-bold text-[#171717] hover:bg-white"
                            >
                              View / Receive
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}
              {transfers.map((transfer) => (
                transferId === transfer.id && (
                <div key={transfer.id} className="rounded-xl border border-[#dedbd3] bg-white p-4 sm:p-5 space-y-3">

                  {canEditTransfer(transfer) && (
                    <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-indigo-950">Edit product request</h3>
                          <p className="mt-1 text-xs text-indigo-800">You can edit quantities and SKU variants until the manufacturer passes all preparation checks. Saving returns the request to Admin review.</p>
                        </div>
                        {editingTransferId !== transfer.id && (
                          <button type="button" onClick={() => beginEdit(transfer)} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-bold text-indigo-900">
                            Edit request
                          </button>
                        )}
                      </div>
                      {editingTransferId === transfer.id && (
                        <div className="mt-3 space-y-2">
                          {editLines.map((line, index) => {
                            const transferSku = transfer.lines.find((item) => item.inventorySkuId === line.inventorySkuId)?.inventorySku;
                            const stockSkus = selectedManufacturer?.stock || [];
                            const existingOption = transferSku && !stockSkus.some((sku) => sku.inventorySkuId === line.inventorySkuId)
                              ? [{
                                  inventorySkuId: line.inventorySkuId,
                                  productName: transferSku.product.name,
                                  size: transferSku.size,
                                  color: transferSku.color,
                                  availableQuantity: 0,
                                }]
                              : [];
                            const skuOptions = [...existingOption, ...stockSkus];
                            return (
                              <div key={`${line.inventorySkuId}-${index}`} className="flex flex-wrap gap-2">
                                <select value={line.inventorySkuId} onChange={(event) => updateEditLine(index, "inventorySkuId", event.target.value)} className="min-w-48 flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs">
                                  <option value="">Select product variant</option>
                                  {skuOptions.map((sku) => <option key={sku.inventorySkuId} value={sku.inventorySkuId}>{sku.productName} · {sku.size} / {sku.color} (Available: {sku.availableQuantity})</option>)}
                                </select>
                                <input type="number" min="0" step="1" value={line.quantity} onChange={(event) => updateEditLine(index, "quantity", event.target.value)} aria-label="Requested product quantity" className="w-24 rounded-lg border border-indigo-200 px-2 py-2 text-center text-xs" />
                                <button type="button" disabled={editLines.length === 1} onClick={() => setEditLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-40">Remove</button>
                              </div>
                            );
                          })}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <button type="button" onClick={() => setEditLines((current) => [...current, { inventorySkuId: "", quantity: "1" }])} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-900">Add SKU</button>
                            <button type="button" onClick={() => saveDemandEdit(transfer)} disabled={saving} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
                            <button type="button" onClick={() => { setEditingTransferId(""); setEditLines([]); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Transfer Shipments */}
                  {transfer.shipments && transfer.shipments.length > 0 ? (
                    <div className="space-y-2 mt-2">
                      {transfer.shipments.map((shipment) => (
                        <div key={shipment.id} className="p-3 bg-[#f8f7f4] rounded-xl border border-[#dedbd3] space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#171717]">
                              Shipment ({shipment.bookingMode || "MANUAL"}) • Tracking: {shipment.trackingNumber || shipment.ncmOrderId || "N/A"}
                            </span>
                            <span className="text-[11px] text-[#575757]">Shipment: {shipment.status.replaceAll("_", " ")}</span>
                          </div>
                          {shipment.bookingMode === "NCM" && (
                            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
                              <p>Carrier status: {shipment.ncmStatus || "Awaiting NCM update"}</p>
                              <p>NCM order ID: {shipment.ncmOrderId || shipment.externalReference || "Not recorded"}</p>
                              {shipment.ncmLastSyncedAt && (
                                <p>Last carrier update received: {new Date(shipment.ncmLastSyncedAt).toLocaleString()}</p>
                              )}
                              {shipment.ncmStatus === "Delivered" ? (
                                <p className="mt-1 font-semibold">
                                  Carrier reports delivered. Inspect the shipment and record good, damaged, and missing units; inventory is not available until receipt QA is submitted.
                                </p>
                              ) : (
                                <p className="mt-1">
                                  {["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status)
                                    ? "Carrier custody is confirmed. Inspect the goods and record the actual good, damaged, and missing counts below."
                                    : "Receipt becomes available after an NCM custody event moves this shipment to DISPATCHED. Carrier status alone does not add stock; distributor inspection and receipt are still required."}
                                </p>
                              )}
                              {(shipment.events?.length > 0 || shipment.ncmStatusHistory?.length > 0) ? (
                                <ol className="mt-2 space-y-1 border-l border-sky-200 pl-3" aria-label="NCM shipment timeline">
                                  {[...(shipment.events?.length ? shipment.events.map((entry) => ({
                                    status: entry.status || entry.eventType,
                                    addedAt: entry.occurredAt || entry.receivedAt,
                                    key: entry.id,
                                  })) : shipment.ncmStatusHistory || [])]
                                    .sort((left, right) => {
                                      const leftTimestamp = Date.parse(left.addedAt || "");
                                      const rightTimestamp = Date.parse(right.addedAt || "");
                                      return (Number.isFinite(leftTimestamp) ? leftTimestamp : 0) -
                                        (Number.isFinite(rightTimestamp) ? rightTimestamp : 0);
                                    })
                                    .slice(-10)
                                    .map((entry, index) => (
                                      <li key={entry.key || `${entry.status}-${entry.addedAt || index}`}>
                                        {entry.status || "Carrier status update"}
                                        {entry.addedAt ? ` · ${new Date(entry.addedAt).toLocaleString()}` : ""}
                                      </li>
                                    ))}
                                    {transferId && !transfers.some((transfer) => transfer.id === transferId) && (
                                      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                                        This inbound transfer could not be found in your distributor workspace.
                                      </div>
                                    )}
                                </ol>
                              ) : (
                                <p className="mt-2">No carrier timeline events have been received yet. Refresh to check for updates.</p>
                              )}
                            </div>
                          )}

                          <div className="divide-y divide-[#dedbd3]/60">
                            {shipment.lines?.map((line) => {
                              const alreadyReceived = (line.receiptLines || []).reduce(
                                (sum, r) => sum + r.goodQuantity + r.damagedQuantity + r.missingQuantity,
                                0
                              );
                              const remaining = Math.max(0, line.quantity - alreadyReceived);
                              const canReceive = remaining > 0 && ["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status);

                              return (
                                <div key={line.id} className="py-2 flex items-center justify-between text-xs">
                                  <div>
                                    <p className="font-medium text-[#171717]">
                                      {line.stockTransferLine?.inventorySku?.product?.name || "Product"}
                                    </p>
                                    <p className="text-[11px] text-[#575757]">
                                      {line.stockTransferLine?.inventorySku?.size} / {line.stockTransferLine?.inventorySku?.color} • Shipped: {line.quantity} (Remaining to QA: {remaining})
                                    </p>
                                  </div>
                                  {canReceive ? (
                                    <button
                                      onClick={() => openReceiptModal(line, shipment.id)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171717] text-white text-[11px] font-bold rounded-lg hover:bg-[#262626] transition-colors"
                                    >
                                      <PackageCheck className="w-3.5 h-3.5" />
                                      Record Receipt QA
                                    </button>
                                  ) : (
                                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                      {remaining > 0 ? (
                                        <span className="font-medium text-amber-800">Awaiting carrier dispatch confirmation</span>
                                      ) : (
                                        <><CheckCircle2 className="w-3.5 h-3.5" /> Fully Received</>
                                      )}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#575757] italic">Awaiting factory dispatch.</p>
                  )}
                </div>
              )))}
            </div>
          )}
          {!transferId && <Pagination
            page={pagination?.page || page}
            totalPages={pagination?.totalPages || 1}
            total={pagination?.total || transfers.length}
            limit={pagination?.limit || TRANSFER_PAGE_SIZE}
            loading={loading}
            onPageChange={setPage}
          />}
        </div>
      )}

      {/* Inbound Receipt Modal */}
      {receivingLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-[#ffffff] border border-[#dedbd3] rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#dedbd3] bg-[#f8f7f4]">
              <h3 className="text-sm font-bold text-[#171717]">Inbound Shipment QA Receipt</h3>
              <button onClick={() => setReceivingLine(null)} className="text-[#575757] p-1">
                ✕
              </button>
            </div>

            <form onSubmit={submitReceiptQA} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-[#f8f7f4] rounded-xl border border-[#dedbd3]">
                <p className="font-bold text-[#171717]">
                  {receivingLine.stockTransferLine?.inventorySku?.product?.name || "SKU Variant"}
                </p>
                <p className="text-[11px] text-[#575757]">
                  {receivingLine.stockTransferLine?.inventorySku?.size} / {receivingLine.stockTransferLine?.inventorySku?.color} • Expected Intake: <strong>{receivingLine.remaining}</strong> units
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-emerald-700 mb-1">Good Units</label>
                  <input
                    type="number"
                    min="0"
                    value={receiptDraft.goodQuantity}
                    onChange={(e) => setReceiptDraft({ ...receiptDraft, goodQuantity: e.target.value })}
                    className="w-full p-2 border border-[#dedbd3] rounded-lg text-center font-bold focus:outline-none focus:border-[#171717]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-rose-600 mb-1">Damaged</label>
                  <input
                    type="number"
                    min="0"
                    value={receiptDraft.damagedQuantity}
                    onChange={(e) => setReceiptDraft({ ...receiptDraft, damagedQuantity: e.target.value })}
                    className="w-full p-2 border border-[#dedbd3] rounded-lg text-center font-bold focus:outline-none focus:border-rose-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-amber-600 mb-1">Missing / Lost</label>
                  <input
                    type="number"
                    min="0"
                    value={receiptDraft.missingQuantity}
                    onChange={(e) => setReceiptDraft({ ...receiptDraft, missingQuantity: e.target.value })}
                    className="w-full p-2 border border-[#dedbd3] rounded-lg text-center font-bold focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              {Number(receiptDraft.damagedQuantity) > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-[#171717] mb-1">Damage Classification</label>
                  <select
                    value={receiptDraft.damageType}
                    onChange={(e) => setReceiptDraft({ ...receiptDraft, damageType: e.target.value })}
                    className="w-full p-2 border border-[#dedbd3] rounded-lg bg-[#ffffff]"
                  >
                    <option value="DELIVERY_DAMAGE">Carrier / Transit Damage</option>
                    <option value="STITCH_DAMAGE">Stitching / Factory Defect</option>
                    <option value="OTHER_DAMAGE">Other Discrepancy</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-[#171717] mb-1">Receipt Remarks (Optional)</label>
                <input
                  type="text"
                  value={receiptDraft.note}
                  onChange={(e) => setReceiptDraft({ ...receiptDraft, note: e.target.value })}
                  placeholder="e.g., Box seal intact, verified against delivery challan"
                  className="w-full p-2 border border-[#dedbd3] rounded-lg focus:outline-none focus:border-[#171717]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#dedbd3]">
                <button
                  type="button"
                  onClick={() => setReceivingLine(null)}
                  className="px-3 py-1.5 border border-[#dedbd3] rounded-lg text-[#575757]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#171717] text-white font-bold rounded-lg hover:bg-[#262626] transition-colors disabled:opacity-50"
                >
                  {saving ? "Confirming..." : "Confirm Intake"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DistributorDemandReceipt;
