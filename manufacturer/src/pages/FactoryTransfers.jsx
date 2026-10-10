import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `shipment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const preparationChecks = [
  ["availabilityPassed", "Requested product quantities are available"],
  ["qualityPassed", "Product quality inspection passed"],
  ["colorPassed", "Colors match the distributor request"],
  ["sizePassed", "Sizes match the distributor request"],
  ["packagingPassed", "Products are packaged and ready for delivery"],
];
const checklistFromTransfer = (transfer) => Object.fromEntries(
  preparationChecks.map(([field]) => [field, transfer[field] === true]),
);
const checklistComplete = (transfer) => preparationChecks.every(([field]) => transfer[field] === true);
const checklistReady = (transfer, draft) => {
  const effectiveChecklist = { ...checklistFromTransfer(transfer), ...(draft || {}) };
  return checklistComplete(effectiveChecklist) && preparationChecks.every(([field]) =>
    effectiveChecklist[field] === transfer[field]
  );
};
const initialNcmPackageDetails = (transfer) => {
  const products = [...new Set(transfer.lines.map((line) => line.inventorySku?.product?.name).filter(Boolean))];
  return {
    packageType: "Carton",
    productType: "Apparel",
    productDescription: products.length ? `Bulk clothing shipment: ${products.join(", ")}`.slice(0, 300) : "",
    packageWeight: "",
    packageDimensions: "",
    deliveryInstruction: "",
    isFragile: false,
    packagingNotes: "",
  };
};

const FactoryTransfers = () => {
  const { token } = useManufacturer();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [bookingMode, setBookingMode] = useState({});
  const [carrierDetails, setCarrierDetails] = useState({});
  const [quantities, setQuantities] = useState({});
  const [checklistDrafts, setChecklistDrafts] = useState({});
  const [ncmReturnReasons, setNcmReturnReasons] = useState({});

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

  const setMode = (transfer, mode) => {
    setBookingMode((current) => ({ ...current, [transfer.id]: mode }));
    if (mode === "NCM") {
      setCarrierDetails((current) => ({
        ...current,
        [transfer.id]: { ...initialNcmPackageDetails(transfer), ...(current[transfer.id] || {}) },
      }));
    }
  };
  const updateCarrier = (transferId, field, value) => setCarrierDetails((current) => ({
    ...current,
    [transferId]: { ...(current[transferId] || {}), [field]: value },
  }));
  const updateQuantity = (transferId, lineId, value) => setQuantities((current) => ({
    ...current,
    [transferId]: { ...(current[transferId] || {}), [lineId]: value },
  }));
  const updateChecklist = (transferId, field, checked) => setChecklistDrafts((current) => ({
    ...current,
    [transferId]: { ...(current[transferId] || {}), [field]: checked },
  }));

  const requestNcmReturn = async (shipment) => {
    const reason = String(ncmReturnReasons[shipment.id] || "").trim();
    if (!reason) {
      toast.error("Enter a reason for the NCM return request.");
      return;
    }
    setSavingId(shipment.id);
    try {
      await axios.post(
        `${backendUrl}/api/stock-transfers/manufacturer/shipments/${shipment.id}/ncm-return`,
        { reason },
        { headers: { token } },
      );
      toast.success("NCM return request submitted. Track carrier updates before recording receipt.");
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not request the NCM return.");
      await loadTransfers();
    } finally {
      setSavingId("");
    }
  };

  const saveChecklist = async (transfer) => {
    const checklist = { ...checklistFromTransfer(transfer), ...(checklistDrafts[transfer.id] || {}) };
    setSavingId(transfer.id);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/stock-transfers/${transfer.id}/preparation`,
        { checklist },
        { headers: { token } },
      );
      setTransfers((current) => current.map((item) =>
        item.id === transfer.id ? { ...item, ...response.data.transfer } : item
      ));
      setChecklistDrafts((current) => ({ ...current, [transfer.id]: checklist }));
      toast.success("Product preparation checks saved.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not save preparation checks.");
    } finally {
      setSavingId("");
    }
  };

  const dispatch = async (transfer) => {
    if (!checklistReady(transfer, checklistDrafts[transfer.id])) {
      toast.error("Complete and save all product preparation checks before delivery.");
      return;
    }
    const mode = transfer.isOwnStore ? "SELF_STORE" : bookingMode[transfer.id] || "MANUAL";
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
    if (mode === "NCM") {
      const requiredPackageFields = [
        ["packageType", "package type"],
        ["productType", "product type"],
        ["productDescription", "package contents / description"],
        ["packageWeight", "package weight"],
        ["packageDimensions", "package dimensions"],
      ];
      const missingField = requiredPackageFields.find(([field]) => !String(details[field] ?? "").trim());
      const weight = Number(details.packageWeight);
      if (missingField) {
        toast.error(`Enter the ${missingField[1]} for this NCM shipment.`);
        return;
      }
      if (!Number.isFinite(weight) || weight < 0.1 || weight > 1000) {
        toast.error("Package weight must be between 0.1 and 1000 kg.");
        return;
      }
    }
    setSavingId(transfer.id);
    try {
      const url = mode === "SELF_STORE"
        ? `${backendUrl}/api/manufacturer/stock-requests/${transfer.id}/dispatch`
        : mode === "NCM"
          ? `${backendUrl}/api/stock-transfers/${transfer.id}/ncm-booking`
          : `${backendUrl}/api/stock-transfers/${transfer.id}/dispatch`;
      const payload = mode === "SELF_STORE"
        ? { deliveryMethod: "SELF_STORE", lines: requestLines.map(({ lineId, quantity }) => ({ lineId, quantity })) }
        : {
            lines: requestLines.map(({ lineId, quantity }) => ({ lineId, quantity })),
            ...(mode === "MANUAL" ? {
              deliveryPartner: details.deliveryPartner,
              trackingNumber: details.trackingNumber,
              externalReference: details.externalReference,
              freightCharge: details.freightCharge || null,
            } : {
              packageDetails: {
                packageType: details.packageType,
                productType: details.productType,
                productDescription: details.productDescription,
                packageWeight: Number(details.packageWeight),
                packageDimensions: details.packageDimensions,
                deliveryInstruction: details.deliveryInstruction,
                isFragile: Boolean(details.isFragile),
                packagingNotes: details.packagingNotes,
              },
            }),
          };
      const response = await axios.post(url, payload, {
        headers: { token, "Idempotency-Key": newIdempotencyKey() },
      });
      if (!response.data?.success) {
        toast.warning(response.data?.message || "Shipment status needs administrator attention.");
      } else if (mode === "NCM") {
        toast.success("NCM shipment booked with COD 0. Freight is pending admin settlement.");
      } else if (mode === "SELF_STORE") {
        toast.success("Stock delivered directly to your distributor store with NPR 0 freight.");
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
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Approved distributor demands</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Admin-approved demand appears here for product availability, quality, color, size, and packaging checks. Complete the checklist before requesting NCM or local freight delivery.
        </p>
      </header>

      {loading ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">Loading requests…</div> : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No admin-approved distributor demands are awaiting factory action.</div>
      ) : transfers.map((transfer) => (
        <article key={transfer.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{transfer.distributor?.name || "Distributor"} · {transfer.id.slice(-8)}</h3>
              <p className="mt-1 text-xs text-slate-500">Requested {new Date(transfer.requestedAt).toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-600">
                NCM destination: {transfer.distributor?.ncmPickupBranch || "Not configured"}
                {transfer.distributor?.pickupBranchStatus
                  ? ` · ${transfer.distributor.pickupBranchStatus}`
                  : ""}
                {transfer.distributor?.pickupBranchStatus === "UNVERIFIED"
                  ? " · If this branch is in the active NCM catalog, booking will verify it automatically."
                  : ""}
              </p>
              {transfer.status === "APPROVED" && <p className="mt-2 text-sm font-medium text-emerald-800">Admin approved this demand. Complete product checks before preparing delivery.</p>}
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

          {transfer.status === "APPROVED" && !transfer.shipments?.length && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h4 className="font-semibold text-slate-900">Product preparation checklist</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {preparationChecks.map(([field, label]) => (
                  <label key={field} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={(checklistDrafts[transfer.id] || checklistFromTransfer(transfer))[field]}
                      onChange={(event) => updateChecklist(transfer.id, field, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => saveChecklist(transfer)}
                disabled={savingId === transfer.id}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
              >
                {savingId === transfer.id ? "Saving..." : "Save preparation checks"}
              </button>
              {transfer.preparedAt && (
                <p className="mt-2 text-xs text-slate-600">Last saved {new Date(transfer.preparedAt).toLocaleString()}.</p>
              )}
            </div>
          )}

          {(transfer.status === "APPROVED" || transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED") && transfer.lines.some((line) => Number(line.approvedQuantity || 0) > line.dispatchedQuantity + line.reservedShipmentQuantity) && (
            <div className={`mt-4 rounded-xl p-4 ${checklistReady(transfer, checklistDrafts[transfer.id]) ? "bg-slate-50" : "bg-slate-100"}`}>
              {!checklistReady(transfer, checklistDrafts[transfer.id]) && (
                <p className="mb-3 text-sm font-medium text-amber-800">Delivery is locked until all preparation checks are saved as passed.</p>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm font-medium text-slate-700">
                  Booking method
                  <select value={transfer.isOwnStore ? "SELF_STORE" : bookingMode[transfer.id] || "MANUAL"} onChange={(event) => setMode(transfer, event.target.value)} disabled={transfer.isOwnStore} className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 disabled:bg-emerald-50">
                    {transfer.isOwnStore ? (
                      <option value="SELF_STORE">Own distributor store · NPR 0</option>
                    ) : (
                      <>
                        <option value="MANUAL">Local freight delivery</option>
                        <option value="NCM">NCM booking</option>
                      </>
                    )}
                  </select>
                </label>
                {transfer.isOwnStore ? (
                  <p className="text-sm font-medium text-emerald-800">Delivery is automatically routed to your own distributor store. Freight charge: NPR 0.</p>
                ) : (bookingMode[transfer.id] || "MANUAL") === "NCM" ? (
                  <div className="w-full rounded-xl border border-slate-200 bg-white p-4">
                    <h4 className="font-semibold text-slate-900">NCM package and delivery details</h4>
                    <p className="mb-3 mt-1 text-xs text-slate-500">
                      Destination branch: {transfer.distributor?.ncmPickupBranch || "Not configured"}. NCM accepts package description, instructions, and weight. Package type and dimensions are included in the description; no undocumented NCM fields are sent.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-xs font-medium text-slate-700">
                        Package type *
                        <select value={carrierDetails[transfer.id]?.packageType || "Carton"} onChange={(event) => updateCarrier(transfer.id, "packageType", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          {["Carton", "Box", "Polybag", "Envelope", "Other"].map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-700">
                        Product type *
                        <input required maxLength={120} value={carrierDetails[transfer.id]?.productType || ""} onChange={(event) => updateCarrier(transfer.id, "productType", event.target.value)} placeholder="e.g. Apparel" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-700">
                        Package weight (kg) *
                        <input required type="number" min="0.1" max="1000" step="0.1" value={carrierDetails[transfer.id]?.packageWeight ?? ""} onChange={(event) => updateCarrier(transfer.id, "packageWeight", event.target.value)} placeholder="e.g. 2.5" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                        Package contents / description *
                        <textarea required maxLength={300} rows={2} value={carrierDetails[transfer.id]?.productDescription || ""} onChange={(event) => updateCarrier(transfer.id, "productDescription", event.target.value)} placeholder="Describe the stock in this package" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-700">
                        Package dimensions (L × W × H cm) *
                        <input required maxLength={120} value={carrierDetails[transfer.id]?.packageDimensions || ""} onChange={(event) => updateCarrier(transfer.id, "packageDimensions", event.target.value)} placeholder="e.g. 40 x 30 x 25 cm" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                        Delivery instructions
                        <textarea maxLength={480} rows={2} value={carrierDetails[transfer.id]?.deliveryInstruction || ""} onChange={(event) => updateCarrier(transfer.id, "deliveryInstruction", event.target.value)} placeholder="Instructions for NCM delivery staff" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                        Packaging notes
                        <textarea maxLength={500} rows={2} value={carrierDetails[transfer.id]?.packagingNotes || ""} onChange={(event) => updateCarrier(transfer.id, "packagingNotes", event.target.value)} placeholder="e.g. Waterproof wrapping; quality checked" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="flex items-center gap-2 self-center text-sm text-slate-700">
                        <input type="checkbox" checked={Boolean(carrierDetails[transfer.id]?.isFragile)} onChange={(event) => updateCarrier(transfer.id, "isFragile", event.target.checked)} className="h-4 w-4 accent-amber-600" />
                        Mark package as fragile
                      </label>
                    </div>
                  </div>
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
                <button onClick={() => dispatch(transfer)} disabled={savingId === transfer.id || !checklistReady(transfer, checklistDrafts[transfer.id])} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingId === transfer.id ? "Processing..." : transfer.isOwnStore ? "Deliver to own store" : (bookingMode[transfer.id] || "MANUAL") === "NCM" ? "Book NCM shipment" : "Record local freight and dispatch"}
                </button>
              </div>
              {!transfer.isOwnStore && <p className="mt-3 text-xs text-slate-500">Local freight paid by the manufacturer is recorded for admin settlement. A successful NCM booking creates a stock transit movement only after NCM confirms it; uncertain bookings hold stock until admin review.</p>}
            </div>
          )}

          <div className="mt-4 space-y-2">
            {transfer.shipments?.map((shipment) => (
              <div key={shipment.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                {shipment.deliveryPartner || shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}
                {shipment.externalReference && ` · Reference ${shipment.externalReference}`}
                {shipment.trackingNumber && ` · Tracking ${shipment.trackingNumber}`}
                {shipment.bookingMode === "NCM" && ` · NCM status ${shipment.ncmStatus || "awaiting carrier update"}`}
                {shipment.bookingMode === "NCM" && shipment.packageType && ` · ${shipment.packageType} ${shipment.packageDimensions || ""} · ${shipment.packageWeight} kg`}
                {shipment.bookingMode === "NCM" && ` · Delivery charge NPR ${shipment.freightCharge ?? "not quoted"} (platform/admin settlement; no manufacturer or distributor payable)`}
                {shipment.freightSettlementStatus && ` · ${shipment.freightSettlementStatus.replaceAll("_", " ")}`}
                {shipment.ncmPaymentStatus && ` · NCM payment ${shipment.ncmPaymentStatus}`}
                {shipment.ncmLastSyncedAt && ` · Carrier update ${new Date(shipment.ncmLastSyncedAt).toLocaleString()}`}
                {shipment.bookingMode === "NCM" && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-slate-600">
                      Package: {shipment.productType} · {shipment.productDescription} · {shipment.packageType} · {shipment.packageDimensions} · {shipment.packageWeight} kg
                      {shipment.isFragile ? " · Fragile" : ""}
                      {shipment.deliveryInstruction ? ` · Instructions: ${shipment.deliveryInstruction}` : ""}
                      {shipment.packagingNotes ? ` · Packaging notes: ${shipment.packagingNotes}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      NCM return policy: only the NCM vendor can mark an order for return. NCM accepts an optional comment and may add a pending return comment; a request is not confirmation of physical receipt. Record and inspect returned stock through the normal receipt workflow.
                      {shipment.ncmReturnStatus && ` Return request: ${shipment.ncmReturnStatus.replaceAll("_", " ")}`}
                      {shipment.ncmReturnRequestedAt && ` · Requested ${new Date(shipment.ncmReturnRequestedAt).toLocaleString()}`}
                      {shipment.ncmReturnReason && ` · Reason: ${shipment.ncmReturnReason}`}
                    </p>
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
                    {shipment.status === "BOOKED" && <p className="text-xs font-medium text-amber-800">NCM accepted the booking. Factory stock remains reserved until the pickup webhook confirms carrier custody.</p>}
                    {shipment.ncmStatus === "Delivered" && <p className="text-xs font-medium text-emerald-800">NCM reports carrier delivery. Distributor inspection and receipt are still required to complete the stock transfer.</p>}
                    <div className="flex flex-wrap gap-2">
                      {!["REQUESTED", "PENDING", "UNKNOWN"].includes(shipment.ncmReturnStatus) && (
                        <>
                          <input
                            value={ncmReturnReasons[shipment.id] || ""}
                            onChange={(event) => setNcmReturnReasons((current) => ({ ...current, [shipment.id]: event.target.value }))}
                            placeholder="Reason for return"
                            aria-label="Reason for NCM return"
                            className="min-w-48 rounded border border-slate-300 px-2 py-1.5 text-xs"
                          />
                          <button onClick={() => requestNcmReturn(shipment)} disabled={savingId === shipment.id} className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                            Request NCM return
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
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
