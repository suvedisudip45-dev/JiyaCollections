import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `shipment-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const FactoryTransfers = () => {
  const { token } = useManufacturer();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [bookingMode, setBookingMode] = useState({});
  const [carrierDetails, setCarrierDetails] = useState({});
  const [quantities, setQuantities] = useState({});

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/stock-transfers/manufacturer`, { headers: { token } });
      setTransfers(response.data.transfers || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load stock transfer requests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const setMode = (transferId, mode) => setBookingMode((current) => ({ ...current, [transferId]: mode }));
  const updateCarrier = (transferId, field, value) => setCarrierDetails((current) => ({
    ...current,
    [transferId]: { ...(current[transferId] || {}), [field]: value },
  }));
  const updateQuantity = (transferId, lineId, value) => setQuantities((current) => ({
    ...current,
    [transferId]: { ...(current[transferId] || {}), [lineId]: value },
  }));

  const dispatch = async (transfer) => {
    const mode = bookingMode[transfer.id] || "MANUAL";
    const requestLines = transfer.lines.map((line) => {
      const remaining = Math.max(0, Number(line.approvedQuantity || 0) - line.dispatchedQuantity - line.reservedShipmentQuantity);
      const quantity = Number(quantities[transfer.id]?.[line.id] ?? remaining);
      return { lineId: line.id, quantity, remaining };
    }).filter((line) => line.quantity > 0);
    if (!requestLines.length || requestLines.some((line) => line.quantity > line.remaining)) {
      toast.error("Enter a positive quantity within the remaining approved amount for at least one SKU.");
      return;
    }
    const details = carrierDetails[transfer.id] || {};
    if (mode === "MANUAL" && !String(details.deliveryPartner || "").trim()) {
      toast.error("Enter the manual carrier name.");
      return;
    }
    setSavingId(transfer.id);
    try {
      const url = mode === "NCM"
        ? `${backendUrl}/api/stock-transfers/${transfer.id}/ncm-booking`
        : `${backendUrl}/api/stock-transfers/${transfer.id}/dispatch`;
      const payload = {
        lines: requestLines.map(({ lineId, quantity }) => ({ lineId, quantity })),
        ...(mode === "MANUAL" ? {
          deliveryPartner: details.deliveryPartner,
          trackingNumber: details.trackingNumber,
          externalReference: details.externalReference,
          freightCharge: details.freightCharge || null,
        } : { weight: Number(details.weight || 1) }),
      };
      const response = await axios.post(url, payload, {
        headers: { token, "Idempotency-Key": newIdempotencyKey() },
      });
      if (!response.data?.success) {
        toast.warning(response.data?.message || "Shipment status needs administrator attention.");
      } else if (mode === "NCM") {
        toast.success("NCM shipment booked with COD 0. Freight is pending admin settlement.");
      } else {
        toast.success("Shipment dispatched and factory stock transferred to transit.");
      }
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not dispatch this stock transfer.");
      await loadTransfers();
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Factory operations</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Bulk stock dispatch</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Review approved distributor requests, dispatch partial quantities, and keep freight separate from product COGS. NCM bookings use COD 0; freight is recorded for admin settlement.
        </p>
      </header>

      {loading ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">Loading requests…</div> : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No distributor transfer requests yet.</div>
      ) : transfers.map((transfer) => (
        <article key={transfer.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{transfer.distributor?.name || "Distributor"} · {transfer.id.slice(-8)}</h3>
              <p className="mt-1 text-xs text-slate-500">Requested {new Date(transfer.requestedAt).toLocaleString()}</p>
              {transfer.adminNote && <p className="mt-2 text-sm text-slate-600">Admin note: {transfer.adminNote}</p>}
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{transfer.status.replaceAll("_", " ")}</span>
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            {transfer.lines.map((line) => {
              const remaining = Math.max(0, Number(line.approvedQuantity || 0) - line.dispatchedQuantity - line.reservedShipmentQuantity);
              const sku = line.inventorySku;
              return (
                <div key={line.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_140px] sm:items-center">
                  <div className="text-sm font-medium text-slate-800">{sku.product.name} · {sku.size} · {sku.color}</div>
                  <div className="text-xs text-slate-500">Requested {line.requestedQuantity} · approved {line.approvedQuantity ?? "pending"} · dispatched {line.dispatchedQuantity} · NCM booking reserved {line.reservedShipmentQuantity}</div>
                  {remaining > 0 && ["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(transfer.status) ? (
                    <label className="text-xs text-slate-500">
                      Dispatch quantity (up to {remaining})
                      <input
                        type="number"
                        min="0"
                        max={remaining}
                        step="1"
                        value={quantities[transfer.id]?.[line.id] ?? remaining}
                        onChange={(event) => updateQuantity(transfer.id, line.id, event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                      />
                    </label>
                  ) : <span className="text-xs text-slate-400">No approved quantity remaining</span>}
                </div>
              );
            })}
          </div>

          {(transfer.status === "APPROVED" || transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED") && transfer.lines.some((line) => Number(line.approvedQuantity || 0) > line.dispatchedQuantity + line.reservedShipmentQuantity) && (
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm font-medium text-slate-700">
                  Booking method
                  <select value={bookingMode[transfer.id] || "MANUAL"} onChange={(event) => setMode(transfer.id, event.target.value)} className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5">
                    <option value="MANUAL">Manual carrier booking</option>
                    <option value="NCM">NCM booking</option>
                  </select>
                </label>
                {bookingMode[transfer.id] === "NCM" ? (
                  <label className="text-sm text-slate-600">
                    Package weight (kg)
                    <input type="number" min="0.1" max="1000" step="0.1" value={carrierDetails[transfer.id]?.weight || 1} onChange={(event) => updateCarrier(transfer.id, "weight", event.target.value)} className="ml-2 w-24 rounded-lg border border-slate-300 px-2 py-1.5" />
                  </label>
                ) : (
                  <>
                    <input
                      value={carrierDetails[transfer.id]?.deliveryPartner || ""}
                      onChange={(event) => updateCarrier(transfer.id, "deliveryPartner", event.target.value)}
                      placeholder="Carrier name"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      aria-label="Carrier name"
                    />
                    <input
                      value={carrierDetails[transfer.id]?.trackingNumber || ""}
                      onChange={(event) => updateCarrier(transfer.id, "trackingNumber", event.target.value)}
                      placeholder="Tracking number"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      aria-label="Tracking number"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={carrierDetails[transfer.id]?.freightCharge || ""}
                      onChange={(event) => updateCarrier(transfer.id, "freightCharge", event.target.value)}
                      placeholder="Freight (NPR)"
                      className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      aria-label="Freight charge"
                    />
                  </>
                )}
                <button onClick={() => dispatch(transfer)} disabled={savingId === transfer.id} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingId === transfer.id ? "Booking..." : bookingMode[transfer.id] === "NCM" ? "Book NCM and dispatch" : "Record booking and dispatch"}
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">Manual freight is recorded as pending admin settlement. A successful NCM booking creates a stock transit movement only after NCM confirms it; uncertain bookings hold stock until admin review.</p>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {transfer.shipments?.map((shipment) => (
              <div key={shipment.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                {shipment.deliveryPartner || shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}
                {shipment.externalReference && ` · Reference ${shipment.externalReference}`}
                {shipment.trackingNumber && ` · Tracking ${shipment.trackingNumber}`}
                {shipment.freightCharge !== null && shipment.freightCharge !== undefined && ` · Freight NPR ${shipment.freightCharge}`}
                {shipment.freightSettlementStatus && ` · ${shipment.freightSettlementStatus.replaceAll("_", " ")}`}
                {shipment.lines?.some((line) => line.uncostedQuantity > 0) && (
                  <span className="ml-2 text-amber-700">Some legacy units have no linked COGS layer; reconcile before retail cutover.</span>
                )}
                {shipment.status === "BOOKING_UNKNOWN" && <p className="mt-1 text-amber-700">Booking outcome is uncertain. Do not retry; admin reconciliation is required.</p>}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
};

export default FactoryTransfers;
