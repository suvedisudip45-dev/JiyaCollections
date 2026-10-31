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
  const [postingSettlement, setPostingSettlement] = useState(false);
  const [settlementFormOpen, setSettlementFormOpen] = useState(false);
  const [settlementForm, setSettlementForm] = useState({
    requestedAmount: "",
    setoffAgreementReference: "",
    setoffConfirmed: false,
    notes: "",
  });
  const [payoutFormByRequest, setPayoutFormByRequest] = useState({});
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

  const postUnifiedSettlement = async () => {
    const position = data?.settlementPosition;
    const maximum = Math.abs(Number(position?.netBalance || 0));
    const requestedAmount = settlementForm.requestedAmount.trim();
    const amount = Number(requestedAmount);
    const offsetAmount = Math.min(
      Number(position?.outstandingReceivable || 0),
      Number(position?.outstandingPayable || 0),
    );
    if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(requestedAmount) || !Number.isFinite(amount) || amount <= 0 || amount > maximum) {
      toast.error(`Enter a positive request amount up to the net balance of NPR ${maximum.toFixed(2)}.`);
      return;
    }
    if (offsetAmount > 0 && (
      !settlementForm.setoffAgreementReference.trim() ||
      !settlementForm.setoffConfirmed
    )) {
      toast.error("Enter the agreement reference and confirm it authorizes this set-off.");
      return;
    }
    if (!settlementForm.notes.trim()) {
      toast.error("Add a note for the settlement request.");
      return;
    }

    setPostingSettlement(true);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlements`,
        {
          requestedAmount,
          setoffAgreementReference: settlementForm.setoffAgreementReference.trim(),
          setoffConfirmed: settlementForm.setoffConfirmed,
          notes: settlementForm.notes.trim(),
          idempotencyKey: window.crypto.randomUUID(),
        },
        { headers: { token } },
      );
      toast.success("Settlement request was issued to the distributor.");
      setSettlementFormOpen(false);
      setSettlementForm({
        requestedAmount: "",
        setoffAgreementReference: "",
        setoffConfirmed: false,
        notes: "",
      });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not post distributor balance settlement.");
    } finally {
      setPostingSettlement(false);
    }
  };

  const reviewSettlementRequest = async (request, decision) => {
    const reviewNotes = decision === "REJECT"
      ? window.prompt("Why is this transfer evidence being rejected?")?.trim()
      : "";
    if (decision === "REJECT" && !reviewNotes) return;
    const financialAccountId = accountByBatch[request.id] || accounts.find((account) =>
      account.status === "ACTIVE" &&
      account.currency === "NPR" &&
      ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
    )?.id;
    if (decision === "VERIFY" && !financialAccountId) {
      toast.error("Select the active NPR treasury account that received the transfer.");
      return;
    }
    setBusyBatchId(request.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlement-requests/${request.id}/review`,
        { decision, financialAccountId, reviewNotes },
        { headers: { token } },
      );
      toast.success(decision === "VERIFY" ? "Distributor transfer evidence acknowledged and posted." : "Transfer evidence rejected.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not review settlement evidence.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const recordPayoutTransfer = async (request) => {
    const form = payoutFormByRequest[request.id] || {};
    if (!form.transferReference?.trim() || !form.financialAccountId || !form.evidenceFile) {
      toast.error("Enter the transfer reference, select the treasury account, and attach transfer evidence.");
      return;
    }
    const formData = new FormData();
    formData.append("transferReference", form.transferReference.trim());
    formData.append("financialAccountId", form.financialAccountId);
    formData.append("evidence", form.evidenceFile);
    setBusyBatchId(request.id);
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributors/${distributorId}/finance/settlement-requests/${request.id}/payout`,
        formData,
        { headers: { token } },
      );
      toast.success("Company payout recorded. The distributor can acknowledge receipt.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not record the company payout.");
    } finally {
      setBusyBatchId(null);
    }
  };

  const settlementPosition = data?.settlementPosition || {};
  const openReceivable = Number(settlementPosition.outstandingReceivable || 0);
  const openPayable = Number(settlementPosition.outstandingPayable || 0);
  const offsetPreview = Math.min(openReceivable, openPayable);
  const maximumNetCash = Math.abs(Number(settlementPosition.netBalance || 0));
  const activeSettlementRequest = (data?.settlementRequests || []).find((request) =>
    ["REQUESTED", "EVIDENCE_SUBMITTED", "PAYMENT_SENT"].includes(request.status)
  );
  const settlementBlocked = Number(settlementPosition.pendingRemittance || 0) > 0 ||
    Number(settlementPosition.pendingSettlementRequests || 0) > 0 ||
    (data?.settlementRequests || []).some((request) => ["REQUESTED", "EVIDENCE_SUBMITTED", "PAYMENT_SENT"].includes(request.status)) ||
    settlementPosition.unifiedSettlementBlocked === true;
  const hasOpenBalance = openReceivable > 0 || openPayable > 0;
  const toggleSettlementForm = () => {
    if (settlementFormOpen) {
      setSettlementFormOpen(false);
      return;
    }
    setSettlementForm({
      requestedAmount: maximumNetCash.toFixed(2),
      setoffAgreementReference: "",
      setoffConfirmed: false,
      notes: "",
    });
    setSettlementFormOpen(true);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">Distributor balance &amp; settlement</h2>
          <p className="mt-1 text-xs text-slate-500">COD, delivery earnings, incentives, refunds, and other posted distributor documents roll into one gross-to-net position.</p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {loading ? <p className="py-5 text-center text-xs text-slate-500">Loading COD ledger…</p> : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Company receivable", settlementPosition.outstandingReceivable],
              ["Company payable", settlementPosition.outstandingPayable],
              [
                Number(settlementPosition.netBalance || 0) > 0 ? "Net due to company" : "Net due to distributor",
                Math.abs(Number(settlementPosition.netBalance || 0)),
              ],
              ["Pending remittance review", data.position?.pendingRemittance],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-base font-black text-slate-900">{amountText(amount)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
            <p className="max-w-3xl text-xs leading-5 text-indigo-950">
              Admin issues one request for the distributor's current net amount. The distributor submits evidence for money owed to the company; company payouts are recorded by Admin and acknowledged by the distributor.
            </p>
            <button
              type="button"
              disabled={!hasOpenBalance || maximumNetCash <= 0 || settlementBlocked || postingSettlement}
              onClick={toggleSettlementForm}
              className="rounded-lg bg-indigo-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {settlementFormOpen ? "Close request form" : "Issue net settlement request"}
            </button>
          </div>
          {activeSettlementRequest && (
            <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
              Request {activeSettlementRequest.id} is in progress ({activeSettlementRequest.status.replaceAll("_", " ")}). Complete or reject it before issuing another request.
            </p>
          )}
          {(Number(settlementPosition.pendingRemittance || 0) > 0 || Number(settlementPosition.pendingSettlementRequests || 0) > 0) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Clear {Number(settlementPosition.pendingRemittance || 0) > 0 ? "the pending COD remittance review" : ""}
              {Number(settlementPosition.pendingRemittance || 0) > 0 && Number(settlementPosition.pendingSettlementRequests || 0) > 0 ? " and " : ""}
              {Number(settlementPosition.pendingSettlementRequests || 0) > 0 ? "existing distributor settlement request(s)" : ""}
              {" "}before issuing a settlement request.
            </p>
          )}
          {settlementPosition.unifiedSettlementBlocked && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <p>
                The net includes {amountText(settlementPosition.excludedLegacyLogisticsPayableTotal)} in legacy return/exchange logistics payables,
                but they are not yet in the accounting subledger. Settle them through Accounts Payable before issuing a settlement request.
              </p>
              <ul className="mt-2 space-y-1">
                {(settlementPosition.excludedLegacyLogisticsPayables || []).map((payable) => (
                  <li key={payable.id}>{payable.title} · {payable.referenceType} · {amountText(payable.remainingBalance)}</li>
                ))}
              </ul>
            </div>
          )}
          {settlementFormOpen && hasOpenBalance && !settlementBlocked && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                postUnifiedSettlement();
              }}
              className="grid gap-3 rounded-xl border border-indigo-200 bg-white p-4 sm:grid-cols-2"
            >
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 sm:col-span-2">
                <p><b>Net balance:</b> {amountText(maximumNetCash)} {Number(settlementPosition.netBalance || 0) >= 0 ? "owed to the company" : "owed to the distributor"}.</p>
                {offsetPreview > 0 && <p className="mt-1"><b>Offset preview:</b> {amountText(offsetPreview)} applied to both gross sides when the request is completed.</p>}
                <p className="mt-1 text-[10px] text-slate-500">The requested amount may be partial, but cannot exceed the current net balance. Transfer evidence is added by the party making the payment.</p>
              </div>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Net request amount (maximum {amountText(maximumNetCash)})
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={settlementForm.requestedAmount}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, requestedAmount: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                Set-off agreement/reference {offsetPreview > 0 ? "(required)" : "(optional)"}
                <input
                  type="text"
                  maxLength={191}
                  value={settlementForm.setoffAgreementReference}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, setoffAgreementReference: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required={offsetPreview > 0}
                />
              </label>
              {offsetPreview > 0 && (
                <label className="flex items-start gap-2 text-xs text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={settlementForm.setoffConfirmed}
                    onChange={(event) => setSettlementForm((current) => ({ ...current, setoffConfirmed: event.target.checked }))}
                    required
                    className="mt-0.5"
                  />
                  I confirm the referenced agreement permits offsetting these distributor balances.
                </label>
              )}
              <label className="space-y-1 text-xs font-semibold text-slate-700 sm:col-span-2">
                Request note
                <input
                  type="text"
                  maxLength={2000}
                  value={settlementForm.notes}
                  onChange={(event) => setSettlementForm((current) => ({ ...current, notes: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                <p className="text-[10px] text-slate-500">No accounting entry is posted until the transfer is verified or acknowledged.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSettlementFormOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-[10px] font-bold text-slate-700">Cancel</button>
                  <button type="submit" disabled={postingSettlement} className="rounded-lg bg-indigo-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                    {postingSettlement ? "Issuing request…" : "Issue request"}
                  </button>
                </div>
              </div>
            </form>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {[["Open receivable documents", settlementPosition.receivableDocuments], ["Open payable documents", settlementPosition.payableDocuments]].map(([label, documents]) => (
              <details key={label} className="rounded-xl border border-slate-100 bg-white p-3">
                <summary className="cursor-pointer text-xs font-bold text-slate-800">{label} ({documents?.length || 0})</summary>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                  {(documents || []).map((document) => (
                    <div key={document.id} className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-[10px]">
                      <div><p className="font-semibold text-slate-800">{document.documentNumber} · {document.sourceType}</p><p className="text-slate-500">{document.sourceId} · {dateText(document.issueDate)}</p></div>
                      <p className="font-bold text-slate-900">{amountText(document.remainingAmount)}</p>
                    </div>
                  ))}
                  {!documents?.length && <p className="pt-2 text-[10px] text-slate-500">No open documents.</p>}
                </div>
              </details>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Admin-issued settlement requests</h3>
            {(data.settlementRequests || []).length ? data.settlementRequests.map((request) => (
              <article key={request.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {request.direction === "COMPANY_COLLECTS" ? "Distributor pays company" : "Company pays distributor"} · {amountText(request.requestedAmount)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Request {request.id} · {dateText(request.createdAt)} · {request.status.replaceAll("_", " ")}
                    </p>
                    {request.requestNotes && <p className="mt-1 text-[10px] text-slate-600">{request.requestNotes}</p>}
                    {request.setoffAgreementReference && <p className="mt-1 text-[10px] text-slate-500">Set-off authority: {request.setoffAgreementReference}</p>}
                  </div>
                  {request.status === "REQUESTED" && request.direction === "COMPANY_COLLECTS" && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">Waiting for distributor transfer</span>
                  )}
                  {request.status === "PAYMENT_SENT" && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">Waiting for distributor acknowledgment</span>
                  )}
                  {request.status === "ACKNOWLEDGED" && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Receipt acknowledged</span>
                  )}
                </div>

                {request.status === "EVIDENCE_SUBMITTED" && (
                  <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="text-sky-950">Distributor transfer reference: <b>{request.transferReference || "—"}</b></p>
                      {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View evidence</a>}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-52 flex-1 text-[10px] font-semibold text-slate-700">
                        Treasury account receiving funds
                        <select
                          value={accountByBatch[request.id] || ""}
                          onChange={(event) => setAccountByBatch((current) => ({ ...current, [request.id]: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                        >
                          <option value="">Select an active NPR account</option>
                          {accounts.filter((account) =>
                            account.status === "ACTIVE" &&
                            account.currency === "NPR" &&
                            ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                          ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                        </select>
                      </label>
                      <button type="button" disabled={busyBatchId === request.id} onClick={() => reviewSettlementRequest(request, "VERIFY")} className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Acknowledge &amp; verify</button>
                      <button type="button" disabled={busyBatchId === request.id} onClick={() => reviewSettlementRequest(request, "REJECT")} className="rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Reject evidence</button>
                    </div>
                  </div>
                )}

                {request.status === "REQUESTED" && request.direction === "COMPANY_PAYS" && (
                  <div className="grid gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 sm:grid-cols-2">
                    <label className="text-[10px] font-semibold text-slate-700">
                      Completed transfer reference
                      <input
                        value={payoutFormByRequest[request.id]?.transferReference || ""}
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], transferReference: event.target.value },
                        }))}
                        maxLength={191}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                      />
                    </label>
                    <label className="text-[10px] font-semibold text-slate-700">
                      Treasury account paid from
                      <select
                        value={payoutFormByRequest[request.id]?.financialAccountId || ""}
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], financialAccountId: event.target.value },
                        }))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                      >
                        <option value="">Select an active NPR account</option>
                        {accounts.filter((account) =>
                          account.status === "ACTIVE" &&
                          account.currency === "NPR" &&
                          ["CASH", "BANK", "WALLET"].includes(String(account.accountType).toUpperCase())
                        ).map((account) => <option key={account.id} value={account.id}>{account.accountName}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] font-semibold text-slate-700 sm:col-span-2">
                      Transfer evidence (JPG/PNG)
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={(event) => setPayoutFormByRequest((current) => ({
                          ...current,
                          [request.id]: { ...current[request.id], evidenceFile: event.target.files?.[0] || null },
                        }))}
                        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs"
                      />
                    </label>
                    <button type="button" disabled={busyBatchId === request.id} onClick={() => recordPayoutTransfer(request)} className="justify-self-start rounded-lg bg-violet-800 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50 sm:col-span-2">
                      {busyBatchId === request.id ? "Recording transfer…" : "Record completed payout"}
                    </button>
                  </div>
                )}

                {request.transferReference && request.direction === "COMPANY_PAYS" && request.status !== "REQUESTED" && (
                  <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                    <span>Company transfer: {request.transferReference} · {request.financialAccount?.accountName || "Treasury"}</span>
                    {request.evidenceUrl && <a href={request.evidenceUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">View payout evidence</a>}
                  </div>
                )}
              </article>
            )) : <p className="text-xs text-slate-500">No Admin-issued settlement requests.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Unified settlement history</h3>
            {(data.settlements || []).length ? data.settlements.map((settlement) => (
              <details key={settlement.id} className="rounded-xl border border-slate-100 p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-slate-900">{settlement.direction.replaceAll("_", " ")} · {dateText(settlement.postedAt)}</span>
                  <span className="font-black text-slate-900">Cash {amountText(settlement.cashAmount)} · Offset {amountText(settlement.offsetAmount)}</span>
                </summary>
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                  <p>Ref {settlement.reference || "—"} · Set-off authority {settlement.setoffAgreementReference || "—"}</p>
                  <p>Journal {settlement.journalEntryId || "—"} · Cash transaction {settlement.cashTransactionId || "—"} · {settlement.financialAccount?.accountName || "No cash account"}</p>
                  {settlement.notes && <p>{settlement.notes}</p>}
                  {(settlement.allocations || []).map((allocation) => (
                    <p key={allocation.id}>
                      {allocation.allocationType || "PAYMENT"} {allocation.document?.side} · {allocation.document?.documentNumber} · {allocation.document?.sourceType} · {amountText(allocation.amount)}
                    </p>
                  ))}
                </div>
              </details>
            )) : <p className="text-xs text-slate-500">No unified settlements have been posted.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800">Legacy refund offsets</h3>
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
              ["Company receivable", summary.settlementPosition?.outstandingReceivable],
              ["Company payable", summary.settlementPosition?.outstandingPayable],
              [
                Number(summary.settlementPosition?.netBalance || 0) > 0 ? "Net due to company" : "Net due to distributor",
                Math.abs(Number(summary.settlementPosition?.netBalance || 0)),
              ],
              ["Pending COD remittance", summary.settlementPosition?.pendingRemittance],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-900">{amountText(value)}</p></div>)}
          </div>
          <p className="text-xs text-slate-500">These balances include all open NPR accounting documents. The detailed FIFO settlement documents and settlement history appear below.</p>
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
