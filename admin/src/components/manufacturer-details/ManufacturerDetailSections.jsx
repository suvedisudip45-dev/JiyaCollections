/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../../App";
import Pagination from "../Pagination";

const limit = 10;
const amount = (value) => `${currency}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
const getProductionUnitCostBreakdown = (request) => {
  const entered = Number(request.approvedUnitCogs ?? request.proposedUnitCogs) || 0;
  const rate = Number(request.approvedVatRate ?? request.vatRate) || 0;
  const treatment = request.approvedVatTreatment || request.vatTreatment || "EXEMPT";
  let goodsBeforeVat = entered;
  let vatPerUnit = 0;
  let goodsWithVat = entered;
  if (treatment === "VAT_INCLUSIVE") {
    goodsBeforeVat = entered / (1 + rate / 100);
    vatPerUnit = entered - goodsBeforeVat;
  } else if (treatment === "VAT_EXCLUSIVE") {
    vatPerUnit = entered * rate / 100;
    goodsWithVat = entered + vatPerUnit;
  }
  const invoiceVerified = request.approvedVatInvoiceVerified === true;
  return {
    treatment,
    rate,
    goodsBeforeVat,
    vatPerUnit,
    goodsWithVat,
    inventoryGoodsCost: invoiceVerified ? goodsBeforeVat : goodsWithVat,
    invoiceVerified,
  };
};

const usePagedRecords = ({ endpoint, token, params = {} }) => {
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await axios.get(endpoint, {
          params: { ...JSON.parse(paramsKey), page, limit },
          headers: { token },
        });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load manufacturer records.");
        if (!active) return;
        const key = Object.keys(response.data).find((candidate) => Array.isArray(response.data[candidate]) && candidate !== "data");
        setRecords(key ? response.data[key] : []);
        setPagination(response.data.pagination || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        setErrorMessage(error.response?.data?.message || error.message || "Unable to load manufacturer records.");
        setRecords([]);
        setPagination(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, paramsKey, token]);

  return { records, pagination, page, setPage, loading, errorMessage };
};

const RecordFrame = ({ title, description, loading, errorMessage, emptyMessage, children, pagination, page, setPage }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>
    {loading ? <p className="px-5 py-12 text-center text-sm text-slate-500">Loading…</p>
      : errorMessage ? <p className="px-5 py-12 text-center text-sm text-rose-600">{errorMessage}</p>
        : children || <p className="px-5 py-12 text-center text-sm text-slate-500">{emptyMessage}</p>}
    {pagination?.total > 0 && <div className="border-t border-slate-100 px-5"><Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
  </section>
);

export const ManufacturerInventorySection = ({ manufacturerId, token }) => {
  const [inventory, setInventory] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [totals, setTotals] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const endpoint = `${backendUrl}/api/admin/manufacturers/${manufacturerId}/inventory`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const response = await axios.get(endpoint, { params: { page, limit }, headers: { token } });
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load factory inventory.");
        if (!active) return;
        setInventory(response.data.inventory || []);
        setPagination(response.data.pagination || null);
        setTotals(response.data.totals || null);
      } catch (error) {
        if (!active) return;
        console.error(error);
        setErrorMessage(error.response?.data?.message || error.message || "Unable to load factory inventory.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [endpoint, page, token]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Units on hand" value={totals?.unitsOnHand ?? "—"} />
        <SummaryCard label="Available units" value={totals?.availableUnits ?? "—"} />
        <SummaryCard label="Units with cost layers" value={totals?.unitsWithCostLayers ?? "—"} />
      </div>
      <RecordFrame title="In-house inventory" description="Current factory stock is sourced from InventoryBalance; historical product-level counters are not used." loading={loading} errorMessage={errorMessage} emptyMessage="No factory inventory is recorded." pagination={pagination} page={page} setPage={setPage}>
        {inventory.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Product / SKU</th><th className="px-4 py-3">Factory location</th><th className="px-4 py-3">On hand</th><th className="px-4 py-3">Reserved</th><th className="px-4 py-3">Available</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{inventory.map((item) => <tr key={item.id}>
            <td className="px-4 py-3 font-semibold text-slate-800">{item.product?.name || item.productId}<span className="mt-1 block font-normal text-slate-500">{item.size} / {item.color}</span></td>
            <td className="px-4 py-3">{item.location?.name || "Factory"}</td><td className="px-4 py-3">{item.quantityOnHand}</td><td className="px-4 py-3">{item.reservedQuantity}</td><td className="px-4 py-3 font-bold">{item.availableQuantity}</td>
          </tr>)}</tbody>
        </table></div>}
      </RecordFrame>
      <p className="text-[11px] text-slate-500">The inventory ledger is authoritative for quantity. Cost is reported with production records and payable summaries; inventory totals do not estimate historical value from current retail prices.</p>
    </div>
  );
};

export const ManufacturerProductionSection = ({ manufacturerId, token }) => {
  const { records, pagination, page, setPage, loading, errorMessage } = usePagedRecords({
    endpoint: `${backendUrl}/api/manufacturer-production/admin/requests`,
    token,
    params: { manufacturerId },
  });

  return (
    <RecordFrame title="Production history" description="Approved fabric/GSM, batch plan, MOQ, COGS, overhead, QA and actual completed quantities." loading={loading} errorMessage={errorMessage} emptyMessage="No production orders found." pagination={pagination} page={page} setPage={setPage}>
      {records.length > 0 && <div className="divide-y divide-slate-100">{records.map((request) => {
        const requested = (request.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const produced = (request.lines || []).reduce((sum, line) => sum + Number(line.actualQuantity ?? 0), 0);
        const good = (request.lines || []).reduce((sum, line) => sum + Math.max(0, Number(line.actualQuantity ?? 0) - Number(line.damagedQuantity || 0)), 0);
        const cost = getProductionUnitCostBreakdown(request);
        const otherCost = Number(request.approvedDeliveryCost ?? request.proposedDeliveryCost) || 0;
        const otherCostPerGoodUnit = request.costTermsVersion >= 2 && good > 0 ? otherCost / good : 0;
        return <article key={request.id} className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{request.productName || request.product?.name}</h3><p className="mt-1 text-xs text-slate-500">Requested {date(request.requestedAt)} · Target {date(request.targetCompletionDate)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700">{String(request.status || "").replaceAll("_", " ")}</span></div>
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Fabric / GSM" value={`${request.fabricType || "—"} / ${request.gsm ?? "—"}`} />
            <Fact label="MOQ" value={request.approvedMinimumOrderQuantity ?? request.minimumOrderQuantity ?? "—"} />
            <Fact label="Goods cost before VAT / unit" value={amount(cost.goodsBeforeVat)} />
            <Fact label={`Supplier VAT / unit (${cost.treatment === "EXEMPT" ? "exempt" : `${cost.rate}%`})`} value={amount(cost.vatPerUnit)} />
            <Fact label="Goods total including VAT / unit" value={amount(cost.goodsWithVat)} />
            {request.costTermsVersion >= 2 && <Fact label="Fully loaded good-unit cost" value={amount(
              good > 0
                ? cost.inventoryGoodsCost + otherCostPerGoodUnit
                : 0
            )} />}
            <Fact label={request.costTermsVersion >= 2 ? "Batch other cost" : "Other cost / unit (legacy)"} value={amount(request.approvedDeliveryCost ?? request.proposedDeliveryCost)} />
            <Fact label="Requested / actual / good" value={`${requested} / ${produced} / ${good}`} />
            <Fact label="VAT invoice status" value={cost.treatment === "EXEMPT" ? "Exempt / no VAT" : cost.invoiceVerified ? "Verified · input VAT recoverable" : "Not verified · VAT included in inventory cost"} />
            <Fact label="Pre-production QA" value={request.preProductionChecklist?.passed === true ? "Passed" : request.preProductionChecklist?.passed === false ? "Failed" : "Not recorded"} />
            <Fact label="Post-production QA" value={request.postProductionChecklist?.passed === true ? "Passed" : request.postProductionChecklist?.passed === false ? "Failed" : "Not recorded"} />
          </div>
          {(request.lines || []).length > 0 && <div className="flex flex-wrap gap-2">{request.lines.map((line) => <span key={`${line.size}-${line.color}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">{line.size} / {line.color}: {line.actualQuantity ?? line.quantity} made, {line.damagedQuantity || 0} damaged</span>)}</div>}
          {request.batchPlan && <details className="text-xs text-slate-600"><summary className="cursor-pointer font-semibold">View batch plan</summary><pre className="mt-2 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px]">{JSON.stringify(request.batchPlan, null, 2)}</pre></details>}
        </article>;
      })}</div>}
    </RecordFrame>
  );
};

export const ManufacturerTransfersSection = ({ manufacturerId, token }) => {
  const { records, pagination, page, setPage, loading, errorMessage } = usePagedRecords({
    endpoint: `${backendUrl}/api/stock-transfers/admin`,
    token,
    params: { manufacturerId },
  });

  return (
    <RecordFrame title="Distributor transfers" description="Goods sent from this manufacturer to distributor hubs, including shipment and receipt status." loading={loading} errorMessage={errorMessage} emptyMessage="No stock transfers found." pagination={pagination} page={page} setPage={setPage}>
      {records.length > 0 && <div className="divide-y divide-slate-100">{records.map((transfer) => <article key={transfer.id} className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{transfer.distributor?.name || "Distributor"} · {transfer.status.replaceAll("_", " ")}</h3><p className="mt-1 text-xs text-slate-500">Requested {date(transfer.requestedAt)} · Dispatched {date(transfer.dispatchedAt)} · Received {date(transfer.completedAt)}</p></div><span className="text-xs font-semibold text-slate-600">{transfer.id}</span></div>
        <div className="flex flex-wrap gap-2">{(transfer.lines || []).map((line) => <span key={line.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">{line.inventorySku?.product?.name || "Product"} · {line.inventorySku?.size} / {line.inventorySku?.color} · requested {line.requestedQuantity}, dispatched {line.dispatchedQuantity}, approved {line.approvedQuantity ?? "—"}</span>)}</div>
        {(transfer.shipments || []).length > 0 && <div className="space-y-2">{transfer.shipments.map((shipment) => <p key={shipment.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{shipment.bookingMode} · {shipment.status.replaceAll("_", " ")}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}{shipment.deliveredAt ? ` · delivered ${date(shipment.deliveredAt)}` : ""}{shipment.bookingMode === "NCM" ? ` · NCM carrier charge ${shipment.freightCharge == null ? "not recorded" : amount(shipment.freightCharge)} · platform payable to NCM` : ` · delivery to distributor ${shipment.freightCharge == null ? "not recorded" : amount(shipment.freightCharge)} · payable to manufacturer · paid ${amount(shipment.freightPaidAmount)} · outstanding ${amount(Math.max(0, Number(shipment.freightCharge || 0) - Number(shipment.freightPaidAmount || 0)))}`}</p>)}</div>}
      </article>)}</div>}
    </RecordFrame>
  );
};

export const ManufacturerFinanceSection = ({ manufacturerId, token }) => {
  const [finance, setFinance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const endpoint = `${backendUrl}/api/admin/manufacturers/${manufacturerId}/finance`;

  useEffect(() => {
    let active = true;
    axios.get(endpoint, { headers: { token } })
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load manufacturer finance.");
        if (active) setFinance(response.data.finance);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setErrorMessage(error.response?.data?.message || error.message || "Unable to load manufacturer finance.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint, token]);

  if (loading) return <p className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">Loading financial summary…</p>;
  if (errorMessage) return <p className="rounded-2xl border border-rose-200 bg-white px-5 py-12 text-center text-sm text-rose-700">{errorMessage}</p>;
  if (!finance) return null;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryCard label="Recognized production value" value={amount(finance.totalManufacturedGoodsValue)} />
      <SummaryCard label="Logistics reimbursements accrued" value={amount(finance.logisticsReimbursements)} />
      <SummaryCard label="Outstanding payable" value={amount(finance.outstandingPayable)} />
      <SummaryCard label="Pending settlement requests" value={amount(finance.pendingSettlements)} />
      <SummaryCard label="Completed payments" value={amount(finance.completedPayments)} />
      <SummaryCard label="Receivables outstanding" value={amount(finance.receivables?.outstanding)} />
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600">
      <h2 className="font-bold text-slate-900">Payable and receivable breakdown</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Fact label="Production payable" value={amount(finance.productionOutstanding)} />
        <Fact label="Logistics payable" value={amount(finance.logisticsOutstanding)} />
        <Fact label="Receivable documents / total" value={`${finance.receivables?.documents || 0} / ${amount(finance.receivables?.total)}`} />
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Payables reuse the manufacturer settlement accounting service. Receivables are from manufacturer-linked accounting documents; they are not inferred from unrelated supplier/customer balances.</p>
    </section>
  </div>;
};

export const ManufacturerTransactionsSection = ({ manufacturerId, token }) => {
  const { records, pagination, page, setPage, loading, errorMessage } = usePagedRecords({
    endpoint: `${backendUrl}/api/admin/manufacturers/${manufacturerId}/finance/transactions`,
    token,
  });
  return <RecordFrame title="Accounting transactions" description="Paginated journal entries linked to this manufacturer as supplier or accounting party." loading={loading} errorMessage={errorMessage} emptyMessage="No manufacturer-linked journal transactions found." pagination={pagination} page={page} setPage={setPage}>
    {records.length > 0 && <div className="divide-y divide-slate-100">{records.map((entry) => <article key={entry.id} className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{entry.journalNumber} · {String(entry.sourceType || "").replaceAll("_", " ")}</h3><p className="mt-1 text-xs text-slate-500">{date(entry.transactionDate)} · {entry.referenceNumber || entry.sourceId || "No reference"}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700">{entry.status}</span></div>
      <p className="text-xs text-slate-600">{entry.description}</p>
      <div className="flex flex-wrap gap-2">{(entry.lines || []).map((line) => <span key={line.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">{line.account?.accountCode} {line.account?.accountName} · Dr {amount(line.debit)} / Cr {amount(line.credit)}</span>)}</div>
    </article>)}</div>}
  </RecordFrame>;
};

export const ManufacturerSettlementsSection = ({ manufacturerId, token }) => {
  const { records, pagination, page, setPage, loading, errorMessage } = usePagedRecords({
    endpoint: `${backendUrl}/api/admin/finance/settlements`,
    token,
    params: { manufacturerId },
  });
  return <RecordFrame title="Payable requests" description="Existing manufacturer settlement requests, their requested type, amount and payment state." loading={loading} errorMessage={errorMessage} emptyMessage="No settlement requests found." pagination={pagination} page={page} setPage={setPage}>
    {records.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs">
      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Notes</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{records.map((settlement) => <tr key={settlement.id}><td className="px-4 py-3">{date(settlement.requestedAt)}</td><td className="px-4 py-3">{settlement.requestType}</td><td className="px-4 py-3 font-semibold">{amount(settlement.amount)}</td><td className="px-4 py-3">{settlement.status}</td><td className="px-4 py-3">{date(settlement.paidAt)}</td><td className="px-4 py-3">{settlement.notes || "—"}</td></tr>)}</tbody>
    </table></div>}
  </RecordFrame>;
};

const SummaryCard = ({ label, value }) => <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-slate-900">{value}</p></div>;
const Fact = ({ label, value }) => <p className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span><b className="mt-1 block text-slate-800">{value}</b></p>;
