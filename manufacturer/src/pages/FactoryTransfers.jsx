import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { Pencil } from "lucide-react";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";
import Pagination from "../components/Pagination";

const TRANSFER_PAGE_SIZE = 10;

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

const ncmTrackingSteps = [
  { rank: 0, label: "Booking accepted", description: "NCM accepted the shipment request." },
  { rank: 1, label: "Pickup order created", description: "NCM has created the pickup order." },
  { rank: 2, label: "Picked up", description: "Carrier custody is confirmed; stock moves into transit." },
  { rank: 3, label: "In transit", description: "The carrier is transporting the shipment." },
  { rank: 4, label: "At destination", description: "The shipment has arrived at its destination branch." },
  { rank: 5, label: "Out for delivery", description: "The carrier is completing the final delivery." },
  { rank: 6, label: "Carrier delivered", description: "Carrier delivery is reported; distributor receipt QA is still required." },
];

const ncmStatusRank = (value) => {
  const status = String(value || "").toLowerCase().replace(/[_-]+/g, " ");
  if (status.includes("return")) return -1;
  if (status.includes("delivered") || status.includes("delivery complete")) return 6;
  if (status.includes("sent for delivery") || status.includes("out for delivery")) return 5;
  if (status.includes("arrived")) return 4;
  if (status.includes("dispatched") || status.includes("in transit")) return 3;
  if (status.includes("pickup complete") || status.includes("pickup completed") || status.includes("picked up")) return 2;
  if (status.includes("pickup order created") || status.includes("sent for pickup") || status.includes("drop off order created")) return 1;
  return -1;
};

const formatTrackingDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const ncmEventsForShipment = (shipment) => {
  const events = shipment.events?.length
    ? shipment.events.map((entry) => ({
        status: entry.status || entry.eventType,
        source: entry.source,
        occurredAt: entry.occurredAt,
        receivedAt: entry.receivedAt,
        key: entry.id,
      }))
    : (shipment.ncmStatusHistory || []).map((entry, index) => ({
        status: entry.status,
        occurredAt: entry.addedAt,
        key: `${entry.status}-${entry.addedAt || index}`,
      }));
  return events.sort((left, right) => {
    const leftTimestamp = Date.parse(left.occurredAt || left.receivedAt || "");
    const rightTimestamp = Date.parse(right.occurredAt || right.receivedAt || "");
    return (Number.isFinite(leftTimestamp) ? leftTimestamp : 0) -
      (Number.isFinite(rightTimestamp) ? rightTimestamp : 0);
  });
};

const receiptTotalsForShipment = (shipment) => (shipment.lines || []).reduce((totals, line) => {
  for (const receipt of line.receiptLines || []) {
    totals.good += Number(receipt.goodQuantity || 0);
    totals.damaged += Number(receipt.damagedQuantity || 0);
    totals.missing += Number(receipt.missingQuantity || 0);
  }
  return totals;
}, { good: 0, damaged: 0, missing: 0 });

const TransferProgress = ({ transfer }) => {
  const shipments = transfer.shipments || [];
  const prepared = checklistComplete(transfer);
  const custodyShipmentCount = shipments.filter((shipment) =>
    ["DISPATCHED", "PARTIALLY_RECEIVED", "DELIVERED", "DISCREPANCY"].includes(shipment.status)
  ).length;
  const custodyConfirmed = custodyShipmentCount > 0;
  const shippedQuantity = shipments.reduce((sum, shipment) =>
    sum + (shipment.lines || []).reduce((lineSum, line) => lineSum + Number(line.quantity || 0), 0), 0);
  const receipts = shipments.reduce((total, shipment) => {
    const shipmentReceipts = receiptTotalsForShipment(shipment);
    return {
      good: total.good + shipmentReceipts.good,
      damaged: total.damaged + shipmentReceipts.damaged,
      missing: total.missing + shipmentReceipts.missing,
    };
  }, { good: 0, damaged: 0, missing: 0 });
  const inspectedQuantity = receipts.good + receipts.damaged + receipts.missing;
  const receiptComplete = shippedQuantity > 0 && inspectedQuantity >= shippedQuantity;
  const bookingFailed = shipments.some((shipment) => shipment.status === "BOOKING_FAILED");
  const bookingUnknown = shipments.some((shipment) => shipment.status === "BOOKING_UNKNOWN");
  const carrierDescription = custodyConfirmed
    ? `${custodyShipmentCount} of ${shipments.length} shipments have confirmed carrier custody.`
    : bookingUnknown
      ? "A booking needs administrator reconciliation before another attempt."
      : bookingFailed
        ? "A booking failed; review that shipment before creating another."
        : shipments.some((shipment) => shipment.status === "BOOKED")
          ? "Booking accepted; stock remains reserved until pickup is confirmed."
          : "Carrier handoff has not started.";
  const steps = [
    {
      label: "Demand requested",
      done: true,
      date: transfer.requestedAt,
      detail: "Distributor submitted requested SKUs and quantities.",
    },
    {
      label: "Admin approval",
      done: !["PENDING_ADMIN_APPROVAL", "REJECTED"].includes(transfer.status),
      date: transfer.reviewedAt,
      detail: "Approved quantities set the maximum that can be shipped.",
    },
    {
      label: "Factory preparation",
      done: prepared,
      date: transfer.preparedAt,
      detail: prepared ? "Availability, quality, color, size and packaging checks passed." : "Required product checks are not all complete.",
    },
    {
      label: "Carrier handoff",
      done: custodyConfirmed,
      date: transfer.dispatchedAt || shipments.find((shipment) => shipment.bookedAt)?.bookedAt,
      detail: carrierDescription,
    },
    {
      label: "Distributor receipt & QA",
      done: receiptComplete,
      date: transfer.completedAt,
      detail: receiptComplete
        ? `${inspectedQuantity}/${shippedQuantity} units inspected · ${receipts.good} good · ${receipts.damaged} damaged · ${receipts.missing} missing.`
        : inspectedQuantity
          ? `${inspectedQuantity}/${shippedQuantity} units inspected · ${receipts.good} good · ${receipts.damaged} damaged · ${receipts.missing} missing.`
          : "Carrier delivery is not stock receipt; distributor must record good, damaged and missing counts.",
    },
  ];

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Stock transfer progress">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Transfer flow</h4>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? "bg-emerald-700 text-white" : "bg-slate-200 text-slate-600"}`}>
                {step.done ? "✓" : index + 1}
              </span>
              <span className="text-xs font-semibold text-slate-900">{step.label}</span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-600">{step.detail}</p>
            {step.date && <p className="mt-2 text-[10px] text-slate-500">{formatTrackingDate(step.date)}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
};

const NcmShipmentTracking = ({ shipment, index, total, saving, returnReason, onReturnReasonChange, onRequestReturn }) => {
  const events = ncmEventsForShipment(shipment);
  const latestRank = ncmStatusRank(shipment.ncmStatus);
  const bookingFailed = shipment.status === "BOOKING_FAILED";
  const bookingUnknown = shipment.status === "BOOKING_UNKNOWN";
  const booked = Boolean(shipment.ncmOrderId || shipment.bookedAt) &&
    !bookingFailed && !bookingUnknown;
  const receipts = receiptTotalsForShipment(shipment);
  const shippedQuantity = (shipment.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const inspectedQuantity = receipts.good + receipts.damaged + receipts.missing;
  const qaComplete = shippedQuantity > 0 && inspectedQuantity >= shippedQuantity;
  const trackingEvents = events.slice(-12).reverse();

  return (
    <section className={`overflow-hidden rounded-xl border ${bookingFailed ? "border-rose-200" : bookingUnknown ? "border-amber-300" : "border-slate-200"}`} aria-label={`NCM shipment ${index} tracking`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            NCM shipment {index} of {total}
          </p>
          <h4 className="mt-1 font-semibold text-slate-900">
            {bookingFailed ? "Booking failed" : bookingUnknown ? "Booking outcome unknown" : booked ? "Booking accepted" : "Booking in progress"}
          </h4>
          <p className="mt-1 text-xs text-slate-600">
            Carrier order ID: <span className="font-mono font-medium text-slate-800">{shipment.ncmOrderId || shipment.externalReference || "Not confirmed"}</span>
            {shipment.ncmLastSyncedAt && ` · Last carrier update received ${formatTrackingDate(shipment.ncmLastSyncedAt)}`}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${bookingFailed ? "bg-rose-100 text-rose-800" : bookingUnknown ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>
          {shipment.status.replaceAll("_", " ")}
        </span>
      </header>

      <div className="space-y-4 p-4">
        {bookingFailed ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
            NCM rejected this booking. This attempt did not dispatch stock; its reservation was released. Review the shipment details before creating another booking.
          </div>
        ) : bookingUnknown ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            The booking result could not be confirmed. Do not retry or create another shipment until an administrator checks NCM and resolves this booking.
          </div>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="NCM carrier and receipt progress">
            {ncmTrackingSteps.map((step) => {
              const complete = step.rank === 0 ? booked : latestRank >= step.rank;
              const current = complete && (step.rank === 0 ? latestRank < 1 : latestRank === step.rank);
              const event = events.find((entry) => ncmStatusRank(entry.status) === step.rank);
              const stepDate = step.rank === 0
                ? formatTrackingDate(shipment.bookedAt || event?.receivedAt || shipment.createdAt)
                : formatTrackingDate(event?.occurredAt || (latestRank === step.rank ? shipment.ncmLastEventAt : null));
              return (
                <li key={step.rank} className={`rounded-lg border p-3 ${current ? "border-sky-300 bg-sky-50" : complete ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${complete ? current ? "bg-sky-700 text-white" : "bg-emerald-700 text-white" : "bg-slate-200 text-slate-600"}`}>
                      {complete ? "✓" : step.rank + 1}
                    </span>
                    <span className="text-xs font-semibold text-slate-900">{step.label}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-slate-600">{step.description}</p>
                  <p className="mt-2 text-[10px] text-slate-500">{stepDate || (complete ? "Completed" : "Waiting for carrier update")}</p>
                </li>
              );
            })}
            <li className={`rounded-lg border p-3 ${qaComplete ? "border-emerald-200 bg-emerald-50/60" : inspectedQuantity ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${qaComplete ? "bg-emerald-700 text-white" : inspectedQuantity ? "bg-amber-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {qaComplete ? "✓" : "7"}
                </span>
                <span className="text-xs font-semibold text-slate-900">Distributor receipt & QA</span>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-600">
                {qaComplete
                  ? "Receipt inspection is complete."
                  : inspectedQuantity
                    ? `${inspectedQuantity} of ${shippedQuantity} units inspected; receipt is still in progress.`
                    : "Carrier delivery does not add stock. Distributor must record the physical receipt and inspection."}
              </p>
              <p className="mt-2 text-[10px] text-slate-500">
                Good {receipts.good} · Damaged {receipts.damaged} · Missing {receipts.missing}
              </p>
            </li>
          </ol>
        )}

        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-2">
          <p><span className="font-semibold text-slate-700">Carrier status:</span> {shipment.ncmStatus || "No carrier event received yet"}</p>
          <p><span className="font-semibold text-slate-700">NCM delivery charge:</span> NPR {shipment.freightCharge ?? "not quoted"} · company payable to NCM; not payable to the manufacturer or distributor</p>
          {shipment.ncmPaymentStatus && <p><span className="font-semibold text-slate-700">NCM payment:</span> {shipment.ncmPaymentStatus}</p>}
          <p><span className="font-semibold text-slate-700">Shipment quantity:</span> {shippedQuantity} units</p>
        </div>

        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
            Carrier event history ({events.length})
          </summary>
          {trackingEvents.length ? (
            <ol className="space-y-2 border-t border-slate-200 px-3 py-3">
              {trackingEvents.map((event) => (
                <li key={event.key} className="border-l-2 border-sky-300 pl-3">
                  <p className="text-xs font-medium text-slate-800">{event.status || "Carrier status update"}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Provider time: {formatTrackingDate(event.occurredAt) || "Not supplied"}
                    {event.receivedAt && ` · Received: ${formatTrackingDate(event.receivedAt)}`}
                    {event.source && ` · Source: ${event.source.replaceAll("_", " ").toLowerCase()}`}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-t border-slate-200 px-3 py-3 text-xs text-slate-500">
              {bookingFailed ? "No carrier tracking events were recorded for this rejected booking." : "No carrier status events have been received. Refresh later or ask an administrator to reconcile the NCM order."}
            </p>
          )}
        </details>

        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Package, return and settlement details</summary>
          <div className="grid gap-2 border-t border-slate-200 px-3 py-3 text-xs text-slate-600 sm:grid-cols-2">
            <p><span className="font-semibold text-slate-700">Contents:</span> {shipment.productType || "—"} · {shipment.productDescription || "—"}</p>
            <p><span className="font-semibold text-slate-700">Package:</span> {shipment.packageType || "—"} · {shipment.packageWeight ?? "—"} kg · {shipment.packageDimensions || "—"}</p>
            {shipment.isFragile && <p>Fragile handling requested</p>}
            {shipment.deliveryInstruction && <p><span className="font-semibold text-slate-700">Instructions:</span> {shipment.deliveryInstruction}</p>}
            {shipment.packagingNotes && <p><span className="font-semibold text-slate-700">Packaging notes:</span> {shipment.packagingNotes}</p>}
            <p className="sm:col-span-2">
              <span className="font-semibold text-slate-700">Return request:</span> {shipment.ncmReturnStatus || "Not requested"}
              {shipment.ncmReturnRequestedAt && ` · ${formatTrackingDate(shipment.ncmReturnRequestedAt)}`}
              {shipment.ncmReturnReason && ` · ${shipment.ncmReturnReason}`}
            </p>
            <p className="sm:col-span-2 text-slate-500">An NCM return request does not confirm that goods have physically returned. Record returned units through distributor receipt and inspection.</p>
            {booked && !["REQUESTED", "PENDING", "UNKNOWN"].includes(shipment.ncmReturnStatus) && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <input
                  value={returnReason}
                  onChange={(event) => onReturnReasonChange(event.target.value)}
                  placeholder="Reason for return"
                  aria-label="Reason for NCM return"
                  className="min-w-48 rounded border border-slate-300 px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={onRequestReturn}
                  disabled={saving}
                  className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Submitting..." : "Request NCM return"}
                </button>
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
};

const FactoryTransfers = () => {
  const { transferId } = useParams();
  const { token } = useManufacturer();
  const [transfers, setTransfers] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [bookingMode, setBookingMode] = useState({});
  const [carrierDetails, setCarrierDetails] = useState({});
  const [quantities, setQuantities] = useState({});
  const [checklistDrafts, setChecklistDrafts] = useState({});
  const [checklistModalTransferId, setChecklistModalTransferId] = useState("");
  const [ncmReturnReasons, setNcmReturnReasons] = useState({});
  const [editingTransferId, setEditingTransferId] = useState("");
  const [editLines, setEditLines] = useState([]);
  const [editCatalog, setEditCatalog] = useState([]);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/stock-transfers/manufacturer`, {
        headers: { token },
        params: transferId
          ? { transferId, page: 1, limit: 1 }
          : { page, limit: TRANSFER_PAGE_SIZE },
      });
      setTransfers(response.data.transfers || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load stock transfer requests.");
    } finally {
      setLoading(false);
    }
  }, [page, token, transferId]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    if (!checklistModalTransferId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !savingId) setChecklistModalTransferId("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [checklistModalTransferId, savingId]);

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
  const canEditTransfer = (transfer) => (
    ["PENDING_ADMIN_APPROVAL", "APPROVED"].includes(transfer.status) &&
    !checklistComplete(transfer) &&
    !(transfer.shipments || []).length &&
    !(transfer.lines || []).some((line) => line.dispatchedQuantity > 0 || line.reservedShipmentQuantity > 0)
  );
  const beginEdit = async (transfer) => {
    setEditingTransferId(transfer.id);
    setEditLines(transfer.lines.map((line) => ({
      inventorySkuId: line.inventorySkuId,
      quantity: String(line.requestedQuantity),
    })));
    try {
      const response = await axios.get(`${backendUrl}/api/stock-transfers/manufacturer/catalog`, {
        headers: { token },
      });
      setEditCatalog(response.data.skus || []);
    } catch (error) {
      setEditingTransferId("");
      toast.error(error.response?.data?.message || "Could not load factory SKUs for editing.");
    }
  };
  const saveEdit = async (transfer) => {
    const lines = editLines
      .filter((line) => line.inventorySkuId && Number(line.quantity) > 0)
      .map((line) => ({ inventorySkuId: line.inventorySkuId, quantity: Number(line.quantity) }));
    if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.quantity))) {
      toast.error("Keep at least one product SKU with a positive whole-number quantity.");
      return;
    }
    setSavingId(transfer.id);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/stock-transfers/manufacturer/${transfer.id}`,
        { lines },
        { headers: { token } },
      );
      toast.success(response.data.message || "Stock request updated and sent for Admin review.");
      setEditingTransferId("");
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not update the stock request.");
    } finally {
      setSavingId("");
    }
  };
  const openChecklist = (transfer) => {
    setChecklistDrafts((current) => ({
      ...current,
      [transfer.id]: { ...checklistFromTransfer(transfer), ...(current[transfer.id] || {}) },
    }));
    setChecklistModalTransferId(transfer.id);
  };

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
      setChecklistModalTransferId("");
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
    if (mode === "MANUAL" && (!Number.isFinite(Number(details.freightCharge)) || Number(details.freightCharge) <= 0)) {
      toast.error("Enter a positive local delivery cost paid by the manufacturer.");
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
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-slate-900">{transferId ? "Distributor Demand Details" : "Approved distributor demands"}</h2>
          {transferId && <Link to="/bulk-transfers" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Back to demands</Link>}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Admin-approved demand appears here for product availability, quality, color, size, and packaging checks. Complete the checklist before requesting NCM or local freight delivery.
        </p>
      </header>

      {loading ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">Loading requests…</div> : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No admin-approved distributor demands are awaiting factory action.</div>
      ) : (
        <div className="space-y-4">
          {!transferId && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Demand / Date</th>
                  <th className="px-4 py-3">Distributor</th>
                  <th className="px-4 py-3">Products / Units</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.map((transfer) => {
                  const productNames = [...new Set((transfer.lines || []).map((line) => line.inventorySku?.product?.name).filter(Boolean))];
                  const units = (transfer.lines || []).reduce((sum, line) => sum + Number(line.approvedQuantity ?? line.requestedQuantity ?? 0), 0);
                  return (
                    <tr key={transfer.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <p className="font-mono font-bold text-slate-900">#{transfer.id.slice(-8)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{transfer.requestedAt ? new Date(transfer.requestedAt).toLocaleDateString() : "Date unavailable"}</p>
                      </td>
                      <td className="px-4 py-3">{transfer.distributor?.name || "Distributor"}</td>
                      <td className="px-4 py-3">
                        {productNames.slice(0, 2).join(", ") || "No products"}
                        {productNames.length > 2 ? ` +${productNames.length - 2} more` : ""}
                        <span className="ml-1 text-[10px] text-slate-500">({units} units)</span>
                      </td>
                      <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{transfer.status.replaceAll("_", " ")}</span></td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/bulk-transfers/${transfer.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                          View / Proceed
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
          {!transferId && <Pagination
            page={pagination?.page || page}
            totalPages={pagination?.totalPages || 1}
            total={pagination?.total || transfers.length}
            limit={pagination?.limit || TRANSFER_PAGE_SIZE}
            loading={loading}
            onPageChange={setPage}
          />}
          {transfers.map((transfer) => transferId === transfer.id && (
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

          <TransferProgress transfer={transfer} />

          {canEditTransfer(transfer) && (
            <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-indigo-950">Edit distributor demand</h4>
                  <p className="mt-1 text-xs text-indigo-800">Changes reset preparation checks and return the request to Admin review.</p>
                </div>
                {editingTransferId !== transfer.id && (
                  <button type="button" onClick={() => beginEdit(transfer)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-900">
                    <Pencil size={13} /> Edit request
                  </button>
                )}
              </div>
              {editingTransferId === transfer.id && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    {editLines.map((line, index) => {
                      const originalSku = transfer.lines.find((item) => item.inventorySkuId === line.inventorySkuId)?.inventorySku;
                      const originalOption = originalSku && !editCatalog.some((sku) => sku.inventorySkuId === line.inventorySkuId)
                        ? [{ inventorySkuId: line.inventorySkuId, productName: originalSku.product.name, size: originalSku.size, color: originalSku.color, availableQuantity: 0 }]
                        : [];
                      return <div key={`${line.inventorySkuId}-${index}`} className="flex flex-wrap gap-2">
                        <select value={line.inventorySkuId} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, inventorySkuId: event.target.value } : item))} className="min-w-48 flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-2 text-xs">
                          <option value="">Select product variant</option>
                          {[...originalOption, ...editCatalog].map((sku) => <option key={sku.inventorySkuId} value={sku.inventorySkuId}>{sku.productName} · {sku.size} / {sku.color} (Available: {sku.availableQuantity})</option>)}
                        </select>
                        <input type="number" min="0" step="1" value={line.quantity} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} aria-label="Requested product quantity" className="w-24 rounded border border-indigo-200 px-2 py-1.5 text-center" />
                        <button type="button" disabled={editLines.length === 1} onClick={() => setEditLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-40">Remove</button>
                      </div>;
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditLines((current) => [...current, { inventorySkuId: "", quantity: "1" }])} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-900">Add SKU</button>
                    <button type="button" disabled={savingId === transfer.id} onClick={() => saveEdit(transfer)} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingId === transfer.id ? "Saving…" : "Save changes"}</button>
                    <button type="button" onClick={() => setEditingTransferId("")} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">1</span>
              <div>
                <h4 className="font-semibold text-slate-900">Review approved demand and set dispatch quantities</h4>
                <p className="text-xs text-slate-500">Check every size/color line. Enter zero for any SKU you are not sending in this shipment.</p>
              </div>
            </div>
          <div className="divide-y divide-slate-100">
            {transfer.lines.map((line) => {
              const remaining = Math.max(0, Number(line.approvedQuantity || 0) - line.dispatchedQuantity - line.reservedShipmentQuantity);
              const sku = line.inventorySku;
              return (
                <div key={line.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_140px] sm:items-center">
                  <div className="text-sm font-medium text-slate-800">{sku.product.name} · {sku.size} · {sku.color}</div>
                  <div className="text-xs text-slate-500">Requested {line.requestedQuantity} · approved {line.approvedQuantity ?? "pending"} · custody confirmed {line.dispatchedQuantity} · reserved awaiting pickup {line.reservedShipmentQuantity}</div>
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
          </section>

          {transfer.status === "APPROVED" && !transfer.shipments?.length && (
            <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${checklistComplete(transfer) ? "bg-emerald-700 text-white" : "bg-amber-200 text-amber-900"}`}>2</span>
                  <div>
                    <h4 className="font-semibold text-slate-900">Complete product preparation checklist</h4>
                    <p className="mt-1 text-xs text-slate-600">
                      {checklistComplete(transfer)
                        ? `All checks saved${transfer.preparedAt ? ` · ${new Date(transfer.preparedAt).toLocaleString()}` : ""}.`
                        : "Confirm availability, quality, requested colors and sizes, and packaging before delivery."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openChecklist(transfer)}
                  className="rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 shadow-sm hover:bg-amber-50"
                >
                  {checklistComplete(transfer) ? "Review checklist" : "Open preparation checklist"}
                </button>
              </div>
            </section>
          )}

          {(transfer.status === "APPROVED" || transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED") && transfer.lines.some((line) => Number(line.approvedQuantity || 0) > line.dispatchedQuantity + line.reservedShipmentQuantity) && (
            <div className={`mt-4 rounded-xl p-4 ${checklistReady(transfer, checklistDrafts[transfer.id]) ? "bg-slate-50" : "bg-slate-100"}`}>
              <div className="mb-4 flex items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${checklistReady(transfer, checklistDrafts[transfer.id]) ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"}`}>3</span>
                <div>
                  <h4 className="font-semibold text-slate-900">Choose delivery and dispatch</h4>
                  <p className="text-xs text-slate-500">Choose local freight or NCM, complete the delivery details, then dispatch the selected quantities.</p>
                </div>
              </div>
              {!checklistReady(transfer, checklistDrafts[transfer.id]) && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">Delivery is locked until all preparation checks are saved as passed. Open step 2 to complete the checklist.</p>
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
                    <label className="text-xs font-medium text-slate-700">
                      Delivery to distributor (manufacturer-paid freight, NPR) *
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={carrierDetails[transfer.id]?.freightCharge || ""}
                        onChange={(event) => updateCarrier(transfer.id, "freightCharge", event.target.value)}
                        placeholder="Enter freight for this shipment"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        aria-label="Local delivery cost paid by manufacturer"
                      />
                    </label>
                  </>
                )}
                <button onClick={() => dispatch(transfer)} disabled={savingId === transfer.id || !checklistReady(transfer, checklistDrafts[transfer.id])} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingId === transfer.id ? "Processing..." : transfer.isOwnStore ? "Deliver to own store" : (bookingMode[transfer.id] || "MANUAL") === "NCM" ? "Book NCM shipment" : "Record local freight and dispatch"}
                </button>
              </div>
              {!transfer.isOwnStore && <p className="mt-3 text-xs text-slate-500">For local logistics, enter the amount the manufacturer pays; the company records it as payable to the manufacturer for reimbursement. NCM delivery charges are a company payable to NCM, never to the manufacturer or distributor. A successful NCM booking moves stock to transit only after NCM confirms pickup; uncertain bookings remain on hold for admin review.</p>}
            </div>
          )}

          <div className="mt-4 space-y-2">
            {transfer.shipments?.length > 0 && (
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">4</span>
                <div>
                  <h4 className="font-semibold text-slate-900">Track shipments and follow carrier updates</h4>
                  <p className="text-xs text-slate-500">Carrier delivery does not complete stock receipt; the distributor still records receipt and QA.</p>
                </div>
              </div>
            )}
            {transfer.shipments?.map((shipment, index) => (
              <div key={shipment.id}>
                {shipment.bookingMode === "NCM" ? (
                  <NcmShipmentTracking
                    shipment={shipment}
                    index={transfer.shipments.slice(0, index + 1).filter((item) => item.bookingMode === "NCM").length}
                    total={transfer.shipments.filter((item) => item.bookingMode === "NCM").length}
                    saving={savingId === shipment.id}
                    returnReason={ncmReturnReasons[shipment.id] || ""}
                    onReturnReasonChange={(value) => setNcmReturnReasons((current) => ({ ...current, [shipment.id]: value }))}
                    onRequestReturn={() => requestNcmReturn(shipment)}
                  />
                ) : (
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                    {shipment.deliveryPartner || shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}
                    {shipment.externalReference && ` · Reference ${shipment.externalReference}`}
                    {shipment.trackingNumber && ` · Tracking ${shipment.trackingNumber}`}
                    {shipment.freightCharge !== null && shipment.freightCharge !== undefined && ` · Delivery to distributor NPR ${Number(shipment.freightCharge).toFixed(2)} · payable to manufacturer`}
                    {shipment.freightPaidAmount !== null && shipment.freightPaidAmount !== undefined && ` · Paid NPR ${Number(shipment.freightPaidAmount).toFixed(2)} · outstanding NPR ${Math.max(0, Number(shipment.freightCharge || 0) - Number(shipment.freightPaidAmount || 0)).toFixed(2)}`}
                    {shipment.freightSettlementStatus && ` · Reimbursement ${shipment.freightSettlementStatus.replaceAll("_", " ")}`}
                    {shipment.ncmPaymentStatus && ` · NCM payment ${shipment.ncmPaymentStatus}`}
                  </div>
                )}
                {shipment.lines?.some((line) => line.uncostedQuantity > 0) && (
                  <span className="ml-2 text-amber-700">Some legacy units have no linked COGS layer; reconcile before retail cutover.</span>
                )}
              </div>
            ))}
          </div>
          {checklistModalTransferId === transfer.id && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && savingId !== transfer.id) setChecklistModalTransferId("");
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={`preparation-checklist-title-${transfer.id}`}
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Step 2 · Factory preparation</p>
                    <h3 id={`preparation-checklist-title-${transfer.id}`} className="mt-1 text-xl font-bold text-slate-900">Product preparation checklist</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {transfer.distributor?.name || "Distributor"} · Demand #{transfer.id.slice(-8)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChecklistModalTransferId("")}
                    disabled={savingId === transfer.id}
                    aria-label="Close preparation checklist"
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="text-2xl leading-none">×</span>
                  </button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {preparationChecks.map(([field, label]) => (
                    <label key={field} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 hover:bg-amber-50">
                      <input
                        type="checkbox"
                        checked={(checklistDrafts[transfer.id] || checklistFromTransfer(transfer))[field]}
                        onChange={(event) => updateChecklist(transfer.id, field, event.target.checked)}
                        className="h-4 w-4 accent-amber-700"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  Check each item only after you have verified it physically. All five checks must be saved as passed before dispatch.
                </p>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setChecklistModalTransferId("")}
                    disabled={savingId === transfer.id}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveChecklist(transfer)}
                    disabled={savingId === transfer.id}
                    className="rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                  >
                    {savingId === transfer.id ? "Saving checks..." : "Save preparation checks"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default FactoryTransfers;
