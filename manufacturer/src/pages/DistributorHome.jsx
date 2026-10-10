import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { RotateCw } from "lucide-react";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const requestKey = () => globalThis.crypto?.randomUUID?.() || `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const emptyRow = () => ({ inventorySkuId: "", quantity: 1 });

const DistributorHome = () => {
  const { token, manufacturer: distributor } = useManufacturer();
  const [catalog, setCatalog] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [manufacturerId, setManufacturerId] = useState("");
  const [requestLines, setRequestLines] = useState([emptyRow()]);
  const [receivingLine, setReceivingLine] = useState(null);
  const [receiptDraft, setReceiptDraft] = useState({ goodQuantity: 0, damagedQuantity: 0, missingQuantity: 0, damageType: "DELIVERY_DAMAGE", evidence: "", note: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedManufacturer = useMemo(
    () => catalog.find((item) => item.id === manufacturerId),
    [catalog, manufacturerId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = { token };
      const [catalogResponse, transferResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/stock-transfers/catalog`, { headers }),
        axios.get(`${backendUrl}/api/stock-transfers/distributor`, { headers }),
      ]);
      setCatalog(catalogResponse.data.manufacturers || []);
      setTransfers(transferResponse.data.transfers || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load stock transfers.");
    } finally {
      setLoading(false);
    }
  }, [token]);

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
    setRequestLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: value } : line
    ));
  };

  const availableForRequestLine = (skuId, lineIndex) => {
    const sku = selectedManufacturer?.stock?.find((item) => item.inventorySkuId === skuId);
    if (!sku) return 0;
    const requestedElsewhere = requestLines.reduce((total, line, index) =>
      index !== lineIndex && line.inventorySkuId === skuId
        ? total + Math.max(0, Number(line.quantity) || 0)
        : total, 0);
    return Math.max(0, sku.availableQuantity - requestedElsewhere);
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!manufacturerId) {
      toast.error("Select a manufacturer.");
      return;
    }
    const requestQuantities = new Map();
    for (const line of requestLines) {
      const quantity = Number(line.quantity);
      if (!line.inventorySkuId || !Number.isSafeInteger(quantity) || quantity < 1) {
        toast.error("Select a product variant and enter a positive whole-number quantity.");
        return;
      }
      requestQuantities.set(line.inventorySkuId, (requestQuantities.get(line.inventorySkuId) || 0) + quantity);
    }
    const exceededSku = selectedManufacturer?.stock?.find((sku) =>
      (requestQuantities.get(sku.inventorySkuId) || 0) > sku.availableQuantity
    );
    if (exceededSku) {
      toast.error(`Requested quantity for ${exceededSku.productName} (${exceededSku.size} / ${exceededSku.color}) exceeds the manufacturer's available ${exceededSku.availableQuantity} units.`);
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/stock-transfers/requests`,
        {
          manufacturerId,
          lines: requestLines.map((line) => ({ inventorySkuId: line.inventorySkuId, quantity: Number(line.quantity) })),
        },
        { headers: { token } },
      );
      toast.success("Stock request sent for admin review.");
      setRequestLines([emptyRow()]);
      setTransfers((current) => [response.data.transfer, ...current]);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not submit the stock request.");
    } finally {
      setSaving(false);
    }
  };

  const openReceipt = (shipmentLine) => {
    const alreadyReceived = (shipmentLine.receiptLines || []).reduce(
      (sum, line) => sum + line.goodQuantity + line.damagedQuantity + line.missingQuantity,
      0,
    );
    const remaining = Math.max(0, shipmentLine.quantity - alreadyReceived);
    setReceivingLine({ ...shipmentLine, remaining });
    setReceiptDraft({ goodQuantity: remaining, damagedQuantity: 0, missingQuantity: 0, damageType: "DELIVERY_DAMAGE", evidence: "", note: "" });
  };

  const submitReceipt = async (event) => {
    event.preventDefault();
    if (!receivingLine) return;
    setSaving(true);
    try {
      const evidence = receiptDraft.evidence.trim() ? [receiptDraft.evidence.trim()] : [];
      await axios.post(
        `${backendUrl}/api/stock-transfers/shipments/${receivingLine.shipmentId}/receipt`,
        {
          notes: "",
          lines: [{
            shipmentLineId: receivingLine.id,
            goodQuantity: Number(receiptDraft.goodQuantity),
            damagedQuantity: Number(receiptDraft.damagedQuantity),
            missingQuantity: Number(receiptDraft.missingQuantity),
            damageType: Number(receiptDraft.damagedQuantity) > 0 ? receiptDraft.damageType : null,
            evidence,
            note: receiptDraft.note,
          }],
        },
        { headers: { token, "Idempotency-Key": requestKey() } },
      );
      toast.success("Shipment receipt recorded.");
      setReceivingLine(null);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record shipment receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-[#dedbd3] bg-[#ffffff] p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                Authorized Distributor Hub
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-[#171717] font-heading">
              Distributor Operations Command
            </h2>
            <p className="mt-1 text-sm text-[#575757]">
              Welcome, {distributor?.businessName || distributor?.name || "Distributor"}. Manage assigned regional customer orders, local hub stock, direct walk-in sales, and bulk replenishment.
            </p>
          </div>
        </div>

        {/* Hub Quick Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
          <a
            href="/orders"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Customer Fulfillment</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Order Assignments
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              View →
            </span>
          </a>

          <a
            href="/direct-orders"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Walk-in &amp; Phone Sales</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Direct Hub Orders
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Manage →
            </span>
          </a>

          <a
            href="/inventory"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Local Warehouse</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Hub Inventory Stock
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Stock →
            </span>
          </a>

          <a
            href="/distributor/deliveries"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Last-Mile Routing</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Self-Delivery Portal
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Dispatch →
            </span>
          </a>

          <a
            href="/distributor/demand"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Factory Stock Inbound</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Demand &amp; Receipts
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Inbound →
            </span>
          </a>

          <a
            href="/distributor/finance"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">Earnings &amp; Settlements</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Distributor Finance
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Statement →
            </span>
          </a>

          <a
            href="/pickup-profile"
            className="flex items-center justify-between p-4 rounded-xl bg-[#f8f7f4] border border-[#dedbd3] hover:border-[#171717] transition-all group sm:col-span-2 lg:col-span-3"
          >
            <div>
              <p className="text-xs text-[#575757] font-medium">NCM Courier Partner Logistics</p>
              <h4 className="text-sm font-bold text-[#171717] group-hover:text-emerald-700 transition-colors">
                Operational Pickup &amp; Branch Handoff Setup
              </h4>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-white border border-[#dedbd3] text-[#171717]">
              Configure Setup →
            </span>
          </a>
        </div>
      </header>

      <form onSubmit={submitRequest} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Request stock</h3>
          <p className="mt-1 text-sm text-slate-500">Requests require admin approval. Accepted stock becomes sellable only after you receive it.</p>
        </div>
        <label className="mb-4 block text-sm font-medium text-slate-700">
          Manufacturer
          <select
            value={manufacturerId}
            onChange={(event) => {
              setManufacturerId(event.target.value);
              setRequestLines([emptyRow()]);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2"
            required
          >
            <option value="">Choose a manufacturer with available factory stock</option>
            {catalog.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.city || "Location not listed"}</option>)}
          </select>
        </label>
        {requestLines.map((line, index) => (
          <div key={`request-${index}`} className="mb-3 grid gap-3 sm:grid-cols-[1fr_130px_auto]">
            <select
              value={line.inventorySkuId}
              onChange={(event) => updateRequestLine(index, "inventorySkuId", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
              required
              disabled={!selectedManufacturer}
            >
              <option value="">Choose product / size / color</option>
              {(selectedManufacturer?.stock || []).map((sku) => (
                <option key={sku.inventorySkuId} value={sku.inventorySkuId}>
                  {sku.productName} · {sku.size} · {sku.color} · {sku.availableQuantity} available
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              max={availableForRequestLine(line.inventorySkuId, index)}
              step="1"
              value={line.quantity}
              onChange={(event) => updateRequestLine(index, "quantity", event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
              aria-label="Requested quantity"
              required
              disabled={!line.inventorySkuId}
            />
            <button
              type="button"
              onClick={() => setRequestLines((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              disabled={requestLines.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setRequestLines((current) => [...current, emptyRow()])} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Add SKU
          </button>
          <button type="submit" disabled={saving || !catalog.length} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Submitting..." : "Submit stock request"}
          </button>
        </div>
      </form>

      <section className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Your transfer requests</h3>
            <p className="mt-1 text-sm text-slate-500">Good units received are added to your sellable location. Damaged and missing units are tracked separately for review.</p>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            aria-label="Refresh transfer and NCM status"
            title="Refresh transfer and NCM status"
          >
            <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {loading ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">Loading transfers…</div> : transfers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No stock transfer requests yet.</div>
        ) : transfers.map((transfer) => (
          <article key={transfer.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-slate-900">{transfer.manufacturer?.name || "Manufacturer"} · {transfer.id.slice(-8)}</h4>
                <p className="mt-1 text-xs text-slate-500">Requested {new Date(transfer.requestedAt).toLocaleString()}</p>
                <p className="mt-1 text-xs text-slate-600">
                  NCM destination branch: {transfer.distributor?.ncmPickupBranch || "Not configured"}
                  {transfer.distributor?.pickupBranchStatus
                    ? ` · ${transfer.distributor.pickupBranchStatus}`
                    : ""}
                </p>
                {transfer.adminNote && <p className="mt-2 text-sm text-slate-600">Admin note: {transfer.adminNote}</p>}
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{transfer.status.replaceAll("_", " ")}</span>
            </div>
            <div className="mt-4 space-y-3">
              {(transfer.shipments || []).map((shipment) => (
                <div key={shipment.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <div className="font-medium text-slate-800">
                      {shipment.deliveryPartner || shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}
                    </div>
                    <div className="text-slate-500">
                      {shipment.trackingNumber || shipment.ncmOrderId || shipment.externalReference ? `Tracking/reference: ${shipment.trackingNumber || shipment.ncmOrderId || shipment.externalReference}` : "Tracking reference pending"}
                    </div>
                  </div>
                  {shipment.bookingMode === "NCM" && (
                    <div className="mt-2 space-y-2">
                      {shipment.packageType && (
                        <p className="text-xs text-slate-600">
                          Package: {shipment.productType} · {shipment.productDescription} · {shipment.packageType} · {shipment.packageDimensions} · {shipment.packageWeight} kg
                          {shipment.isFragile ? " · Fragile" : ""}
                          {shipment.deliveryInstruction ? ` · Instructions: ${shipment.deliveryInstruction}` : ""}
                          {shipment.packagingNotes ? ` · Packaging notes: ${shipment.packagingNotes}` : ""}
                        </p>
                      )}
                      <p className="text-xs text-slate-600">
                        Route: {transfer.manufacturer?.ncmPickupBranch || "origin not set"} → {transfer.distributor?.ncmPickupBranch || "destination not set"}
                        {transfer.distributor?.pickupBranchStatus === "UNVERIFIED"
                          ? " · Booking verifies a destination matching the active NCM catalog."
                          : ""}
                      </p>
                      <p className="text-xs text-slate-600">
                        NCM tracking status: {shipment.ncmStatus || "awaiting carrier update"}
                        {shipment.ncmPaymentStatus ? ` · Carrier payment: ${shipment.ncmPaymentStatus}` : ""}
                        {shipment.ncmLastSyncedAt ? ` · Updated ${new Date(shipment.ncmLastSyncedAt).toLocaleString()}` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        NCM return request: {shipment.ncmReturnStatus || "NOT_REQUESTED"}
                        {shipment.ncmReturnRequestedAt ? ` · ${new Date(shipment.ncmReturnRequestedAt).toLocaleString()}` : ""}
                        {shipment.ncmReturnReason ? ` · ${shipment.ncmReturnReason}` : ""}
                        . Only the NCM vendor can submit a return request; a carrier return status is not confirmation of physical receipt. Record and inspect any returned stock through the receipt checklist.
                      </p>
                      <p className="text-xs text-slate-500">
                        NCM delivery charge: NPR {shipment.freightCharge ?? "not quoted"} · platform/admin settlement only, not a payable to the distributor or manufacturer ({(shipment.freightSettlementStatus || "PENDING_ADMIN_SETTLEMENT").replaceAll("_", " ")}).
                      </p>
                      {shipment.status === "BOOKED" && <p className="text-xs font-medium text-amber-800">NCM accepted the booking and is awaiting carrier pickup confirmation.</p>}
                      {shipment.ncmStatus === "Delivered" && <p className="text-xs font-medium text-emerald-800">NCM reports carrier delivery. Inspect the goods and record receipt QA below; this confirmation does not add stock until you submit the receipt.</p>}
                      {(shipment.events?.length > 0 || shipment.ncmStatusHistory?.length > 0) && (
                        <ul className="space-y-1 text-xs text-slate-600" aria-label="NCM status history">
                          {(shipment.events?.length ? shipment.events.map((entry) => ({
                            status: entry.status || entry.eventType,
                            addedAt: entry.occurredAt || entry.receivedAt,
                            key: entry.id,
                          })) : shipment.ncmStatusHistory).slice(0, 10).map((entry, index) => (
                            <li key={entry.key || `${entry.status}-${entry.addedAt || index}`}>
                              {entry.status}{entry.addedAt ? ` · ${new Date(entry.addedAt).toLocaleString()}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {shipment.status === "BOOKING_UNKNOWN" && (
                    <p className="mt-2 text-sm text-amber-800">Carrier booking is being reconciled by the platform administrator; this shipment is locked against duplicate dispatch.</p>
                  )}
                  <div className="mt-3 space-y-2">
                    {(shipment.lines || []).map((shipmentLine) => {
                      const received = (shipmentLine.receiptLines || []).reduce(
                        (sum, item) => sum + item.goodQuantity + item.damagedQuantity + item.missingQuantity,
                        0,
                      );
                      const remaining = Math.max(0, shipmentLine.quantity - received);
                      const sku = shipmentLine.stockTransferLine?.inventorySku;
                      const canReceive = remaining > 0 && ["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status);
                      return (
                        <div key={shipmentLine.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span>{sku?.product?.name} · {sku?.size} · {sku?.color}</span>
                          <span className="text-slate-600">Shipped {shipmentLine.quantity} · received {received} · remaining {remaining}</span>
                          {canReceive && <button onClick={() => openReceipt({ ...shipmentLine, shipmentId: shipment.id })} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Record receipt</button>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {(!transfer.shipments || transfer.shipments.length === 0) && (
              <div className="mt-4 space-y-2">
                {transfer.lines.map((line) => (
                  <div key={line.id} className="text-sm text-slate-600">
                    {line.inventorySku.product.name} · {line.inventorySku.size} · {line.inventorySku.color}
                    {" — "}requested {line.requestedQuantity}
                    {line.approvedQuantity !== null && ` · approved ${line.approvedQuantity}`}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {receivingLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form onSubmit={submitReceipt} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Record shipment receipt</h3>
              <p className="mt-1 text-sm text-slate-500">Up to {receivingLine.remaining} units remain for this SKU line.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["goodQuantity", "damagedQuantity", "missingQuantity"].map((field) => (
                <label key={field} className="text-xs font-medium capitalize text-slate-600">
                  {field.replace("Quantity", "")}
                  <input
                    type="number"
                    min="0"
                    max={receivingLine.remaining}
                    step="1"
                    value={receiptDraft[field]}
                    onChange={(event) => setReceiptDraft((current) => ({ ...current, [field]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                    required
                  />
                </label>
              ))}
            </div>
            {Number(receiptDraft.damagedQuantity) > 0 && (
              <label className="block text-sm font-medium text-slate-700">
                Damage type
                <select value={receiptDraft.damageType} onChange={(event) => setReceiptDraft((current) => ({ ...current, damageType: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="STITCH_DAMAGE">Stitch damage</option>
                  <option value="DELIVERY_DAMAGE">Damage during delivery</option>
                  <option value="OTHER_DAMAGE">Other damage</option>
                </select>
              </label>
            )}
            <label className="block text-sm font-medium text-slate-700">
              Evidence URL (optional)
              <input type="url" value={receiptDraft.evidence} onChange={(event) => setReceiptDraft((current) => ({ ...current, evidence: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Note (optional)
              <textarea value={receiptDraft.note} onChange={(event) => setReceiptDraft((current) => ({ ...current, note: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" rows={2} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReceivingLine(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? "Saving..." : "Confirm receipt"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default DistributorHome;
