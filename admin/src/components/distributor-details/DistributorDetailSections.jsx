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
          : (record) => <div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-900">Settlement request {record.id}</p><p className="mt-1 text-xs text-slate-500">Requested {dateText(record.requestedAt)}{record.settledAt ? ` · Settled ${dateText(record.settledAt)}` : ""}</p><p className="mt-1 text-xs text-slate-500">{record.notes || record.adminNotes || "No notes"}</p></div><div className="text-right"><p className="font-bold text-slate-900">{amountText(record.amount)}</p><p className="text-xs font-bold uppercase text-slate-500">{record.status}</p></div></div>}
        emptyMessage={historyType === "transactions" ? "No financial transactions are recorded." : "No settlement requests are recorded."}
      />
    </div>
  );
};
