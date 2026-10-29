/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../../App";
import { toast } from "react-toastify";
import Pagination from "../Pagination";

const pageLimit = 10;
const emptyQuery = {};
const amountText = (value) => `${currency}${Number(value || 0).toLocaleString()}`;
const dateText = (value) => (value ? new Date(value).toLocaleString() : "—");
const receiptQuantity = (line, field) => (line.shipmentLines || [])
  .flatMap((shipmentLine) => shipmentLine.receiptLines || [])
  .reduce((total, receiptLine) => total + Number(receiptLine[field] || 0), 0);
const listText = (value) => (Array.isArray(value) ? value.map((item) => {
  const name = item.product?.name || item.name || item.productName || item.productId || "Item";
  const variant = [item.size, item.color].filter(Boolean).join(" / ");
  const quantity = item.quantity || item.qty;
  return `${name}${variant ? ` · ${variant}` : ""}${quantity ? ` × ${quantity}` : ""}`;
}).join(", ") : "—");

const RecordList = ({ endpoint, responseKey, token, queryParams = emptyQuery, renderRecord, emptyMessage }) => {
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const queryString = JSON.stringify(queryParams);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await axios.get(endpoint, {
          params: { ...JSON.parse(queryString), page, limit: pageLimit },
          headers: { token },
        });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load this history.");
        if (!active) return;
        setRecords(response.data[responseKey] || []);
        setPagination(response.data.pagination || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        const message = error.response?.data?.message || error.message || "Unable to load this history.";
        setErrorMessage(message);
        setRecords([]);
        setPagination(null);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, queryString, responseKey, token]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">History</h2>
        <p className="mt-0.5 text-xs text-slate-500">Records are loaded on demand and paginated.</p>
      </div>
      {loading ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
      ) : errorMessage ? (
        <p className="px-5 py-12 text-center text-sm text-rose-600">{errorMessage}</p>
      ) : records.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {records.map((record) => (
            <article key={record.id} className="px-5 py-4">{renderRecord(record)}</article>
          ))}
        </div>
      )}
      {pagination && pagination.total > 0 && (
        <div className="border-t border-slate-100 px-5">
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} />
        </div>
      )}
    </section>
  );
};

export const DistributorInventorySection = ({ distributorId, token }) => {
  const [inventory, setInventory] = useState([]);
  const [totals, setTotals] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/inventory`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await axios.get(endpoint, { params: { page, limit: pageLimit }, headers: { token } });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load distributor inventory.");
        if (!active) return;
        setInventory(response.data.inventory || []);
        setTotals(response.data.totals || null);
        setPagination(response.data.pagination || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        toast.error(error.response?.data?.message || error.message || "Unable to load distributor inventory.");
        setInventory([]);
        setTotals(null);
        setPagination(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, token]);

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Units on hand", totals?.unitsOnHand ?? "—"],
          ["Available units", totals?.availableUnits ?? "—"],
          ["Retail value estimate", totals ? amountText(totals.estimatedRetailValue) : "—"],
          ["Cost value estimate", totals ? amountText(totals.estimatedCostValue) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-slate-900">Current inventory</h2>
          <p className="mt-0.5 text-xs text-slate-500">Value estimates use current product retail and cost prices, not historical cost layers.</p>
        </div>
        {loading ? <p className="px-5 py-12 text-center text-sm text-slate-500">Loading inventory…</p> : inventory.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No active distributor stock is recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Product / SKU</th><th className="px-5 py-3">On hand</th><th className="px-5 py-3">Reserved</th><th className="px-5 py-3">Available</th><th className="px-5 py-3">Retail estimate</th><th className="px-5 py-3">Cost estimate</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.map((item) => (
                  <tr key={item.inventorySkuId}>
                    <td className="px-5 py-3"><p className="font-semibold text-slate-900">{item.productName}</p><p className="text-xs text-slate-500">{item.size} · {item.color}</p></td>
                    <td className="px-5 py-3">{item.quantity}</td><td className="px-5 py-3">{item.reservedQty}</td><td className="px-5 py-3 font-bold">{item.availableQty}</td>
                    <td className="px-5 py-3">{amountText(item.estimatedRetailValue)}</td><td className="px-5 py-3">{amountText(item.estimatedCostValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.total > 0 && <div className="border-t border-slate-100 px-5"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
      </div>
    </section>
  );
};

export const DistributorSessionsSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/login-history`}
    responseKey="logins"
    token={token}
    renderRecord={(session) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">{String(session.action || "LOGIN").replaceAll("_", " ")} · {session.status}</p><p className="mt-1 text-xs text-slate-500">{session.userAgent || "Client information unavailable"}</p><p className="mt-1 text-xs text-slate-500">IP: {session.ipAddress || "—"} · Portal: {session.portal || "—"} · Role: {session.role || "—"}</p>{session.failureReason && <p className="mt-1 text-xs text-rose-600">Failure: {session.failureReason}</p>}</div>
        <div className="text-right text-xs text-slate-500"><p>{dateText(session.createdAt)}</p></div>
      </div>
    )}
    emptyMessage="No login sessions are recorded."
  />
);

export const DistributorTransfersSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/stock-transfers/admin`}
    responseKey="transfers"
    token={token}
    queryParams={{ distributorId }}
    renderRecord={(transfer) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">Transfer {transfer.id}</p><p className="mt-1 text-xs text-slate-500">{transfer.manufacturer?.name || "Manufacturer"} → {transfer.distributor?.name || "Distributor"}</p><p className="mt-1 text-xs text-slate-500">{transfer.lines?.length || 0} SKU lines · {transfer.shipments?.length || 0} shipments · {transfer.discrepancies?.length || 0} discrepancies</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">{(transfer.lines || []).slice(0, 5).map((line) => <li key={line.id}>{line.inventorySku?.product?.name || "Product"} · {line.inventorySku?.size || "—"} / {line.inventorySku?.color || "—"} · requested {line.requestedQuantity} · dispatched {line.dispatchedQuantity} · received good {receiptQuantity(line, "goodQuantity")} · damaged {receiptQuantity(line, "damagedQuantity")} · missing {receiptQuantity(line, "missingQuantity")}</li>)}</ul>
          {(transfer.shipments || []).slice(0, 3).map((shipment) => <p key={shipment.id} className="mt-2 text-xs text-slate-500">Shipment {shipment.status} · {shipment.bookingMode} · {shipment.trackingNumber || shipment.externalReference || "No tracking"} · freight {amountText(shipment.freightCharge)}</p>)}
        </div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{transfer.status}</p><p className="mt-1 text-xs text-slate-500">Requested {dateText(transfer.requestedAt)}</p><p className="mt-1 text-xs text-slate-500">Updated {dateText(transfer.updatedAt)}</p></div>
      </div>
    )}
    emptyMessage="No stock transfers are recorded for this distributor."
  />
);

export const DistributorFulfillmentSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/order-assignment/admin/all`}
    responseKey="assignments"
    token={token}
    queryParams={{ distributorId }}
    renderRecord={(assignment) => (
      <div className="space-y-2">
        <div className="flex flex-wrap justify-between gap-3">
          <div><p className="font-semibold text-slate-900">Order {assignment.orderId}</p><p className="mt-1 text-xs text-slate-500">Assigned {dateText(assignment.assignedAt)} · Delivered {dateText(assignment.deliveredAt)}</p></div>
          <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{assignment.status} · {assignment.deliveryType || "—"}</p><p className="mt-1 text-xs text-slate-500">COD {amountText(assignment.delivery?.codAmount)} · delivery fee {amountText(assignment.order?.deliveryFee)}</p></div>
        </div>
        <p className="text-xs text-slate-600">Items: {listText(assignment.order?.items)}</p>
        {assignment.delivery?.events?.length > 0 && <p className="text-xs text-slate-500">Latest delivery event: {assignment.delivery.events[0].eventType} · {dateText(assignment.delivery.events[0].occurredAt)}</p>}
      </div>
    )}
    emptyMessage="No order assignments are recorded for this distributor."
  />
);

export const DistributorReturnsSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/returns`}
    responseKey="returns"
    token={token}
    renderRecord={(record) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">Return {record.id}</p><p className="mt-1 text-xs text-slate-500">Order {record.orderId || "—"} · {record.customerName} · {record.customerPhone || "No phone"}</p><p className="mt-1 text-xs text-slate-600">Reason: {record.reason || "—"}</p><p className="mt-1 text-xs text-slate-500">{listText(record.items)}</p>{record.events?.[0] && <p className="mt-2 text-xs text-slate-500">Latest: {record.events[0].eventType} · {record.events[0].toStatus || "—"} · {dateText(record.events[0].occurredAt)}</p>}</div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{record.lifecycleStatus || record.refundStatus}</p><p className="mt-1 text-xs text-slate-500">Refund {amountText(record.totalRefundAmount)}</p><p className="mt-1 text-xs text-slate-500">Created {dateText(record.createdAt || record.returnDate)}</p></div>
      </div>
    )}
    emptyMessage="No return activity is recorded for this distributor."
  />
);

export const DistributorExchangesSection = ({ distributorId, token }) => (
  <RecordList
    endpoint={`${backendUrl}/api/admin/distributors/${distributorId}/exchanges`}
    responseKey="exchanges"
    token={token}
    renderRecord={(record) => (
      <div className="flex flex-wrap justify-between gap-3">
        <div><p className="font-semibold text-slate-900">Exchange {record.id}</p><p className="mt-1 text-xs text-slate-500">Order {record.orderId} · {record.customer?.name || record.customerName} · {record.customer?.phone || record.customerPhone || "No phone"}</p><p className="mt-1 text-xs text-slate-600">Reason: {record.reasonCode} {record.reasonDetails ? `· ${record.reasonDetails}` : ""}</p><p className="mt-1 text-xs text-slate-500">Items: {listText(record.items)} · Replacement: {listText(record.replacementItems)}</p>{record.events?.[0] && <p className="mt-2 text-xs text-slate-500">Latest: {record.events[0].eventType} · {record.events[0].toStatus || "—"} · {dateText(record.events[0].occurredAt)}</p>}</div>
        <div className="text-right"><p className="text-xs font-bold uppercase text-slate-700">{record.status}</p><p className="mt-1 text-xs text-slate-500">Price difference {amountText(record.priceDifference)}</p><p className="mt-1 text-xs text-slate-500">Created {dateText(record.createdAt)}</p></div>
      </div>
    )}
    emptyMessage="No exchange activity is recorded for this distributor."
  />
);

const DistributorCodRemittances = ({ distributorId, token }) => {
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountByBatch, setAccountByBatch] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyBatchId, setBusyBatchId] = useState(null);
  const [approvingNetting, setApprovingNetting] = useState(false);
  const [nettingFormOpen, setNettingFormOpen] = useState(false);
  const [nettingForm, setNettingForm] = useState({ amount: "", notes: "" });
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/finance/remittances`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [remittanceResponse, accountResponse] = await Promise.all([
        axios.get(endpoint, { headers: { token }, params: { limit: 50 } }),
        axios.get(`${backendUrl}/api/finance/treasury-accounts`, { headers: { token } }),
      ]);
      setData(remittanceResponse.data);
      setAccounts(accountResponse.data?.accounts || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load distributor COD remittances.");
      setData(null);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, token]);

  useEffect(() => { load(); }, [load]);

  const review = async (batch, decision) => {
    const reviewNotes = decision === "REJECT"
      ? window.prompt("Why is this remittance being rejected?")?.trim()
      : "";
    if (decision === "REJECT" && !reviewNotes) return;
    const financialAccountId = accountByBatch[batch.id] || accounts.find((account) =>
      account.status === "ACTIVE" &&
      account.currency === "NPR" &&
      ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
    )?.id;
    if (decision === "VERIFY" && !financialAccountId) {
      toast.error("Select an active NPR treasury account before verifying.");
      return;
    }
    setBusyBatchId(batch.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/remittances/${batch.id}/review`,
        { decision, financialAccountId, reviewNotes },
        { headers: { token } }
      );
      toast.success(decision === "VERIFY" ? "COD remittance verified and posted." : "COD remittance rejected.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review COD remittance.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const approveNetting = async () => {
    const maximum = Number(data?.position?.availableToOffset || 0);
    if (!Number.isFinite(maximum) || maximum <= 0 || approvingNetting) return;
    const amount = nettingForm.amount.trim();
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > maximum) {
      toast.error(`Enter a valid amount up to NPR ${maximum.toFixed(2)}.`);
      return;
    }
    const notes = nettingForm.notes.trim();
    if (!notes) {
      toast.error("Add an Admin note explaining this offset.");
      return;
    }

    setApprovingNetting(true);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/refund-netting`,
        { amount, notes, idempotencyKey: window.crypto.randomUUID() },
        { headers: { token } },
      );
      toast.success("Refund payable offset against COD receivable was approved and posted.");
      setNettingFormOpen(false);
      setNettingForm({ amount: "", notes: "" });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not approve distributor balance offset.");
    } finally {
      setApprovingNetting(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">COD receivables &amp; remittances</h2>
          <p className="mt-1 text-xs text-slate-500">Gross COD receivables and verified distributor refund payables remain separately recorded. Only verified remittances or explicit Admin-approved offsets clear balances.</p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {loading ? <p className="py-5 text-center text-xs text-slate-500">Loading COD ledger…</p> : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Open COD receivable", data.position?.outstandingReceivable],
              ["Pending remittance review", data.position?.pendingRemittance],
              ["Verified refund payable to distributor", data.position?.refundPayable],
              ["Available for approved offset", data.position?.availableToOffset],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-base font-black text-slate-900">{amountText(amount)}</p>
              </div>
            ))}
          </div>
          {Number(data.position?.availableToOffset || 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="max-w-2xl text-xs leading-5 text-amber-950">
                Review the verified customer-refund proof before offsetting. This action posts a journal entry and allocates both the COD receivable and distributor payable; pending remittances are excluded.
              </p>
              <button
                type="button"
                disabled={approvingNetting}
                onClick={() => {
                  setNettingForm({ amount: Number(data.position.availableToOffset).toFixed(2), notes: "" });
                  setNettingFormOpen((open) => !open);
                }}
                className="rounded-lg bg-amber-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
              >
                {nettingFormOpen ? "Close offset form" : `Prepare offset · ${amountText(data.position.availableToOffset)}`}
              </button>
            </div>
          )}
          {nettingFormOpen && Number(data.position?.availableToOffset || 0) > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                approveNetting();
              }}
              className="grid gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:grid-cols-2"
            >
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Offset amount (maximum {amountText(data.position.availableToOffset)})
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={nettingForm.amount}
                  onChange={(event) => setNettingForm((current) => ({ ...current, amount: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Admin reason
                <input
                  type="text"
                  maxLength={2000}
                  value={nettingForm.notes}
                  onChange={(event) => setNettingForm((current) => ({ ...current, notes: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                <p className="text-[10px] text-slate-500">This will reduce both the distributor COD receivable and verified refund payable. Pending remittances remain reserved.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNettingFormOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-[10px] font-bold text-slate-700">Cancel</button>
                  <button type="submit" disabled={approvingNetting} className="rounded-lg bg-amber-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                    {approvingNetting ? "Posting offset…" : "Confirm and post offset"}
                  </button>
                </div>
              </div>
            </form>
          )}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Approved receivable/payable offsets</h3>
            {(data.offsets || []).length ? data.offsets.map((offset) => (
              <div key={offset.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">Admin approved · {dateText(offset.approvedAt)}</p>
                  {offset.notes && <p className="mt-1 text-[10px] text-slate-500">{offset.notes}</p>}
                  <p className="mt-1 text-[10px] text-slate-500">Journal {offset.journalEntryId}</p>
                </div>
                <p className="text-xs font-black text-slate-900">{amountText(offset.amount)}</p>
              </div>
            )) : <p className="text-xs text-slate-500">No approved offsets.</p>}
          </div>
          <div className="space-y-2">
            {(data.remittances || []).map((batch) => (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">{amountText(batch.amount)} · {batch.reference || "No reference"}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{dateText(batch.receivedAt)} · {batch.status}</p>
                  {batch.evidenceUrl && <a className="mt-1 inline-block text-[10px] font-semibold text-blue-700 underline" href={batch.evidenceUrl} target="_blank" rel="noreferrer">View transfer evidence</a>}
                  {batch.reviewNotes && <p className="mt-1 text-[10px] text-rose-700">Admin note: {batch.reviewNotes}</p>}
                </div>
                {batch.status === "PENDING_REVIEW" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={accountByBatch[batch.id] || ""}
                      onChange={(event) => setAccountByBatch((current) => ({ ...current, [batch.id]: event.target.value }))}
                      className="max-w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px]"
                    >
                      <option value="">Select treasury account</option>
                      {accounts.filter((account) =>
                        account.status === "ACTIVE" &&
                        account.currency === "NPR" &&
                        ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                      ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                    </select>
                    <button type="button" disabled={busyBatchId === batch.id} onClick={() => review(batch, "VERIFY")} className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Verify</button>
                    <button type="button" disabled={busyBatchId === batch.id} onClick={() => review(batch, "REJECT")} className="rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Reject</button>
                  </div>
                )}
              </div>
            ))}
            {!data.remittances?.length && <p className="py-4 text-center text-xs text-slate-500">No COD remittances submitted.</p>}
          </div>
        </>
      ) : <p className="py-5 text-center text-xs text-rose-600">COD remittance data is unavailable.</p>}
    </section>
  );
};

export const DistributorFinanceSection = ({ distributorId, token }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyType, setHistoryType] = useState("transactions");
  const [refreshKey, setRefreshKey] = useState(0);
  const [reloadSummary, setReloadSummary] = useState(0);
  const endpoint = `${backendUrl}/api/admin/distributors/${distributorId}/finance`;

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(endpoint, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load financial summary.");
      setSummary(response.data);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load financial summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, token]);

  useEffect(() => { loadSummary(); }, [loadSummary, reloadSummary]);

  const historyUrl = historyType === "transactions"
    ? `${backendUrl}/api/admin/distributors/${distributorId}/finance/transactions`
    : `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlements`;

  return (
    <div className="space-y-4">
      {loading ? <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">Loading financial summary…</p> : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Net payable", summary.summary?.netPayableBalance],
              ["Paid settlements", summary.summary?.totalSettledPaid],
              ["Pending requests", summary.summary?.pendingSettlementAmount],
              ["Receivable from platform", summary.summary?.receivables],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-900">{amountText(value)}</p></div>)}
          </div>
          <p className="text-xs text-slate-500">The current distributor statement reports receivables as zero; it is not a general receivables ledger.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-slate-900">Earnings overview</h2><p className="mt-1 text-xs text-slate-500">Based on the distributor financial statement and current rate card.</p></div><button type="button" onClick={() => setReloadSummary((value) => value + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh</button></div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-slate-500">Delivery earnings</span><br /><b>{amountText(summary.summary?.grossDeliveryEarnings)}</b></p>
              <p><span className="text-slate-500">Return fees</span><br /><b>{amountText(summary.summary?.returnFeesEarned)}</b></p>
              <p><span className="text-slate-500">Incentives</span><br /><b>{amountText(summary.summary?.earnedIncentives)}</b></p>
              <p><span className="text-slate-500">Commission / discounts</span><br /><b>{amountText(summary.summary?.adminDiscountsApplied)}</b></p>
            </div>
          </div>
        </>
      ) : <p className="rounded-xl border border-rose-200 bg-white px-5 py-10 text-center text-sm text-rose-600">Financial summary is unavailable.</p>}

      <DistributorCodRemittances distributorId={distributorId} token={token} />

      <div className="flex gap-2">
        {[["transactions", "Financial transactions"], ["settlements", "Settlement requests"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => { setHistoryType(value); setRefreshKey((current) => current + 1); }} className={`rounded-lg px-4 py-2 text-xs font-bold ${historyType === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{label}</button>
        ))}
      </div>
      <RecordList
        key={`${historyType}-${refreshKey}`}
        endpoint={historyUrl}
        responseKey={historyType}
        token={token}
        renderRecord={historyType === "transactions"
          ? (record) => <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">{record.description || record.type}</p><p className="mt-1 text-xs text-slate-500">{record.type} · Ref {record.referenceId || "—"} · {dateText(record.date)}</p><p className="mt-1 text-xs text-slate-500">{record.paymentMethod || record.status || ""}</p></div><p className={`font-bold ${Number(record.netAmount) < 0 ? "text-rose-700" : "text-slate-900"}`}>{amountText(record.netAmount)}</p></div>
          : (record) => <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">Settlement request {record.id}</p><p className="mt-1 text-xs text-slate-500">Requested {dateText(record.requestedAt)}{record.settledAt ? ` · Settled ${dateText(record.settledAt)}` : ""}</p><p className="mt-1 text-xs text-slate-500">{record.notes || record.adminNotes || "No notes"}</p>{record.externalPaymentReference && <p className="mt-1 text-xs text-slate-500">Transfer ref: {record.externalPaymentReference}</p>}</div><div className="text-right"><p className="font-bold text-slate-900">{amountText(record.amount)}</p><p className="text-xs font-bold uppercase text-slate-500">{record.status}</p></div></div>}
        emptyMessage={historyType === "transactions" ? "No financial transactions are recorded." : "No settlement requests are recorded."}
      />
    </div>
  );
};
