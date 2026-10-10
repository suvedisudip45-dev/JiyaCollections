import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const hasNcmOrderId = (value) =>
  /^\d+$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

const StockTransfers = ({ token }) => {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [filter, setFilter] = useState("NCM");
  const [approvals, setApprovals] = useState({});
  const [notes, setNotes] = useState({});
  const [bookingResolution, setBookingResolution] = useState({});

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter === "NCM" ? { bookingMode: "NCM" } : filter ? { status: filter } : {};
      const response = await axios.get(`${backendUrl}/api/stock-transfers/admin`, { headers: { token }, params });
      const rows = response.data.transfers || [];
      setTransfers(rows);
      setApprovals((current) => {
        const next = { ...current };
        for (const transfer of rows) {
          if (!next[transfer.id]) {
            next[transfer.id] = Object.fromEntries(transfer.lines.map((line) => [line.id, line.approvedQuantity ?? line.requestedQuantity]));
          }
        }
        return next;
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load stock transfers.");
    } finally {
      setLoading(false);
    }
  }, [filter, token]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const review = async (transfer, status) => {
    setSavingId(transfer.id);
    try {
      await axios.patch(`${backendUrl}/api/stock-transfers/admin/${transfer.id}/review`, {
        status,
        adminNote: notes[transfer.id] || "",
        lines: status === "APPROVED"
          ? transfer.lines.map((line) => ({ lineId: line.id, approvedQuantity: Number(approvals[transfer.id]?.[line.id] ?? line.requestedQuantity) }))
          : undefined,
      }, { headers: { token } });
      toast.success(status === "APPROVED" ? "Demand approved and published to the manufacturer's factory portal." : "Transfer request rejected.");
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review the transfer.");
    } finally {
      setSavingId("");
    }
  };

  const resolveNcm = async (shipment, outcome) => {
    const draft = bookingResolution[shipment.id] || {};
    if (outcome === "BOOKED" && !String(draft.externalReference || "").trim()) {
      toast.error("Enter the NCM order reference confirmed in the carrier portal.");
      return;
    }
    setSavingId(shipment.id);
    try {
      await axios.patch(`${backendUrl}/api/stock-transfers/admin/shipments/${shipment.id}/ncm-resolution`, {
        outcome,
        externalReference: draft.externalReference,
        trackingNumber: draft.trackingNumber,
        freightCharge: draft.freightCharge || shipment.freightCharge,
      }, { headers: { token } });
      toast.success(outcome === "BOOKED" ? "Confirmed NCM booking. Factory stock remains reserved until pickup is confirmed." : "Confirmed no NCM booking; factory reservations released.");
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not reconcile the NCM booking.");
    } finally {
      setSavingId("");
    }
  };

  const refreshNcmStatus = async (shipment) => {
    setSavingId(shipment.id);
    try {
      await axios.post(
        `${backendUrl}/api/stock-transfers/admin/shipments/${shipment.id}/ncm-sync`,
        {},
        { headers: { token } },
      );
      toast.success("NCM carrier status reconciled.");
      await loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not reconcile NCM tracking.");
    } finally {
      setSavingId("");
    }
  };

  const updateResolution = (shipmentId, field, value) => setBookingResolution((current) => ({
    ...current,
    [shipmentId]: { ...(current[shipmentId] || {}), [field]: value },
  }));

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Distributor demand approvals</h1>
            <p className="mt-1 text-sm text-slate-500">Approve or reject distributor product demands. Approved quantities are published to the manufacturer factory portal for inspection, packaging, and delivery.</p>
          </div>
          <label className="text-sm text-slate-600">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="ml-2 rounded-lg border border-slate-300 px-3 py-2">
              <option value="">All statuses</option>
              <option value="NCM">NCM shipments (all statuses)</option>
              {["PENDING_ADMIN_APPROVAL", "APPROVED", "REJECTED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "DISCREPANCY", "CANCELLED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </select>
          </label>
        </div>
      </header>

      {loading ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">Loading transfers…</div> : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No transfers match this status.</div>
      ) : transfers.map((transfer) => (
        <article key={transfer.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">{transfer.manufacturer?.name} → {transfer.distributor?.name}</h2>
              <p className="mt-1 text-xs text-slate-500">Transfer {transfer.id} · requested {new Date(transfer.requestedAt).toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-600">
                NCM route: {transfer.manufacturer?.ncmPickupBranch || "No origin branch"} → {transfer.distributor?.ncmPickupBranch || "No destination branch"}
                {" · Branch status: "}
                {transfer.manufacturer?.pickupBranchStatus || "UNVERIFIED"} / {transfer.distributor?.pickupBranchStatus || "UNVERIFIED"}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{transfer.status.replaceAll("_", " ")}</span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2">Product / SKU</th><th>Requested</th><th>Approved</th><th>Dispatched</th><th>Booking reserved</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfer.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2">{line.inventorySku.product.name} · {line.inventorySku.size} · {line.inventorySku.color}</td>
                    <td>{line.requestedQuantity}</td>
                    <td>
                      {transfer.status === "PENDING_ADMIN_APPROVAL" ? (
                        <input type="number" min="0" max={line.requestedQuantity} step="1" value={approvals[transfer.id]?.[line.id] ?? line.requestedQuantity} onChange={(event) => setApprovals((current) => ({ ...current, [transfer.id]: { ...(current[transfer.id] || {}), [line.id]: event.target.value } }))} className="w-24 rounded border border-slate-300 px-2 py-1" />
                      ) : line.approvedQuantity}
                    </td>
                    <td>{line.dispatchedQuantity}</td>
                    <td>{line.reservedShipmentQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transfer.status === "PENDING_ADMIN_APPROVAL" && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input value={notes[transfer.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [transfer.id]: event.target.value }))} placeholder="Admin note (optional)" className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={() => review(transfer, "REJECTED")} disabled={savingId === transfer.id} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">Reject</button>
              <button onClick={() => review(transfer, "APPROVED")} disabled={savingId === transfer.id} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve quantities</button>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {(transfer.shipments || []).map((shipment) => (
              <div key={shipment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">{shipment.deliveryPartner || shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}</span>
                  <span className="text-slate-600">
                    {(shipment.ncmOrderId || shipment.externalReference) && `Reference ${shipment.ncmOrderId || shipment.externalReference} · `}
                    {shipment.trackingNumber && `Tracking ${shipment.trackingNumber} · `}
                    {shipment.bookingMode === "NCM" ? `NCM status ${shipment.ncmStatus || "awaiting carrier update"} · ` : ""}
                    {shipment.bookingMode === "NCM" ? "NCM delivery charge" : "Freight"} {shipment.freightCharge === null ? "not quoted" : `NPR ${shipment.freightCharge}`} · {shipment.freightSettlementStatus.replaceAll("_", " ")}
                    {shipment.bookingMode === "NCM" && ` · platform/admin settlement only`}
                    {shipment.ncmPaymentStatus && ` · NCM payment ${shipment.ncmPaymentStatus}`}
                    {shipment.ncmLastSyncedAt && ` · Updated ${new Date(shipment.ncmLastSyncedAt).toLocaleString()}`}
                  </span>
                </div>
                {shipment.bookingMode === "NCM" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {shipment.packageType && (
                      <p className="basis-full text-xs text-slate-600">
                        Package: {shipment.productType} · {shipment.productDescription} · {shipment.packageType} · {shipment.packageDimensions} · {shipment.packageWeight} kg
                        {shipment.isFragile ? " · Fragile" : ""}
                        {shipment.deliveryInstruction ? ` · Instructions: ${shipment.deliveryInstruction}` : ""}
                        {shipment.packagingNotes ? ` · Packaging notes: ${shipment.packagingNotes}` : ""}
                      </p>
                    )}
                    <button onClick={() => refreshNcmStatus(shipment)} disabled={savingId === shipment.id} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      {savingId === shipment.id ? "Reconciling..." : "Reconcile with NCM"}
                    </button>
                    <span className="text-xs text-slate-500">
                      NCM return request: {shipment.ncmReturnStatus || "NOT_REQUESTED"}
                      {shipment.ncmReturnRequestedAt ? ` · ${new Date(shipment.ncmReturnRequestedAt).toLocaleString()}` : ""}
                      {shipment.ncmReturnReason ? ` · ${shipment.ncmReturnReason}` : ""}
                    </span>
                    <p className="basis-full text-xs text-slate-500">
                      NCM permits only the vendor to mark an order for return; its response does not confirm physical receipt. Returned units still require distributor receipt and inspection. The carrier charge is settled by the platform, not payable to the manufacturer or distributor.
                    </p>
                    {(shipment.events?.length > 0 || shipment.ncmStatusHistory?.length > 0) && (
                      <ul className="basis-full space-y-1 text-xs text-slate-600" aria-label="NCM status history">
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
                    {shipment.status === "BOOKED" && <p className="basis-full text-xs font-medium text-amber-800">Booking accepted; reserved factory stock has not moved to transit until pickup is confirmed.</p>}
                    {shipment.ncmStatus === "Delivered" && <p className="basis-full text-xs font-medium text-emerald-800">Carrier reports delivery. Distributor receipt and inspection are still outstanding.</p>}
                  </div>
                )}
                {["BOOKING_PENDING", "BOOKING_UNKNOWN"].includes(shipment.status) && shipment.bookingMode === "NCM" && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <input value={bookingResolution[shipment.id]?.externalReference || ""} onChange={(event) => updateResolution(shipment.id, "externalReference", event.target.value)} placeholder="Confirmed numeric NCM order ID" inputMode="numeric" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={bookingResolution[shipment.id]?.trackingNumber || ""} onChange={(event) => updateResolution(shipment.id, "trackingNumber", event.target.value)} placeholder="Tracking number" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <input type="number" min="0" step="0.01" value={bookingResolution[shipment.id]?.freightCharge ?? shipment.freightCharge ?? ""} onChange={(event) => updateResolution(shipment.id, "freightCharge", event.target.value)} placeholder="Freight (NPR)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => resolveNcm(shipment, "BOOKED")} disabled={savingId === shipment.id} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Confirm booked</button>
                      <button onClick={() => resolveNcm(shipment, "NOT_BOOKED")} disabled={savingId === shipment.id} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">Confirm not booked</button>
                    </div>
                  </div>
                )}
                {shipment.bookingMode === "NCM" && ["BOOKED", "DISPATCHED", "PARTIALLY_RECEIVED", "DELIVERED", "DISCREPANCY"].includes(shipment.status) && !hasNcmOrderId(shipment.ncmOrderId || shipment.externalReference) && (
                  <div className="mt-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-4">
                    <p className="text-xs text-amber-900 sm:col-span-4">
                      This shipment has no NCM order ID saved, so carrier tracking cannot be queried. Confirm its order ID from the NCM portal to link tracking without repeating a stock movement.
                    </p>
                    <input value={bookingResolution[shipment.id]?.externalReference || ""} onChange={(event) => updateResolution(shipment.id, "externalReference", event.target.value)} placeholder="Confirmed numeric NCM order ID" inputMode="numeric" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <input value={bookingResolution[shipment.id]?.trackingNumber || ""} onChange={(event) => updateResolution(shipment.id, "trackingNumber", event.target.value)} placeholder="Tracking number (optional)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <input type="number" min="0" step="0.01" value={bookingResolution[shipment.id]?.freightCharge ?? shipment.freightCharge ?? ""} onChange={(event) => updateResolution(shipment.id, "freightCharge", event.target.value)} placeholder="Freight (NPR)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <button onClick={() => resolveNcm(shipment, "BOOKED")} disabled={savingId === shipment.id} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Link confirmed NCM order</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {(transfer.discrepancies || []).length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {transfer.discrepancies.map((item) => `${item.discrepancyType.replaceAll("_", " ")}: ${item.quantity} (${item.status})`).join(" · ")}
            </div>
          )}
        </article>
      ))}
    </section>
  );
};

export default StockTransfers;
