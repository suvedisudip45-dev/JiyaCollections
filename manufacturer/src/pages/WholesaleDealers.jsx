import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Building2,
  CreditCard,
  FileText,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { backendUrl, currency, useManufacturer } from "../context/ManufacturerContext";

const emptyDealer = {
  businessName: "",
  panVatNumber: "",
  taxIdType: "PAN",
  contactPerson: "",
  phone: "",
  email: "",
  billingAddress: "",
  deliveryAddress: "",
  creditLimit: "0",
  openingBalance: "0",
  dueDays: "0",
  priceTierId: "",
};

const formatMoney = (value) => `${currency}${Number(value || 0).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const WholesaleDealers = () => {
  const { token } = useManufacturer();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dealers, setDealers] = useState([]);
  const [pricing, setPricing] = useState({ tiers: [], contractPrices: [] });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDealerId, setSelectedDealerId] = useState("");
  const [dealerDetail, setDealerDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDealer, setEditingDealer] = useState(null);
  const [form, setForm] = useState(emptyDealer);
  const [documentModal, setDocumentModal] = useState(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [dealersResponse, pricingResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/distributor/wholesale/dealers`, {
          headers: { token },
          params: statusFilter === "all" ? undefined : { status: statusFilter },
        }),
        axios.get(`${backendUrl}/api/distributor/wholesale/pricing`, { headers: { token } }),
      ]);
      setDealers(dealersResponse.data.dealers || []);
      setPricing(pricingResponse.data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load dealer records.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const openDealerDetail = useCallback(async (dealerId) => {
    if (!dealerId) return;
    setSelectedDealerId(dealerId);
    setDetailLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/wholesale/dealers/${encodeURIComponent(dealerId)}/detail`,
        { headers: { token } },
      );
      setDealerDetail(response.data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not load dealer details.");
      setDealerDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  const filteredDealers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return dealers;
    return dealers.filter((dealer) =>
      `${dealer.businessName} ${dealer.dealerCode} ${dealer.panVatNumber} ${dealer.phone}`
        .toLowerCase()
        .includes(term)
    );
  }, [dealers, search]);

  const openCreate = () => {
    setEditingDealer(null);
    setForm(emptyDealer);
    setFormOpen(true);
  };

  const openEdit = (dealer) => {
    setEditingDealer(dealer);
    setForm({
      businessName: dealer.businessName || "",
      panVatNumber: dealer.panVatNumber || "",
      taxIdType: dealer.taxIdType || "PAN",
      contactPerson: dealer.contactPerson || "",
      phone: dealer.phone || "",
      email: dealer.email || "",
      billingAddress: dealer.billingAddress || "",
      deliveryAddress: dealer.deliveryAddress || "",
      creditLimit: String(dealer.creditLimit || 0),
      openingBalance: String(dealer.openingBalance || 0),
      dueDays: String(dealer.dueDays || 0),
      priceTierId: dealer.priceTierId || "",
    });
    setFormOpen(true);
  };

  const submitDealer = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingDealer) {
        const confirmed = window.confirm(`Save changes to ${editingDealer.businessName}?`);
        if (!confirmed) return;
        await axios.patch(
          `${backendUrl}/api/distributor/wholesale/dealers/${editingDealer.id}`,
          form,
          { headers: { token } },
        );
        toast.success("Dealer updated.");
      } else {
        await axios.post(`${backendUrl}/api/distributor/wholesale/dealers`, form, { headers: { token } });
        toast.success("Dealer registered.");
      }
      setFormOpen(false);
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not save dealer.");
    } finally {
      setSaving(false);
    }
  };

  const setDealerStatus = async (dealer, status) => {
    const action = status === "SUSPENDED" ? "suspend" : "activate";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${dealer.businessName}?`)) return;
    try {
      await axios.patch(
        `${backendUrl}/api/distributor/wholesale/dealers/${dealer.id}`,
        {
          businessName: dealer.businessName,
          panVatNumber: dealer.panVatNumber,
          taxIdType: dealer.taxIdType,
          phone: dealer.phone,
          email: dealer.email || "",
          billingAddress: dealer.billingAddress,
          deliveryAddress: dealer.deliveryAddress,
          creditLimit: dealer.creditLimit,
          openingBalance: dealer.openingBalance,
          dueDays: dealer.dueDays,
          priceTierId: dealer.priceTierId,
          status,
          holdReason: status === "SUSPENDED" ? "Credit hold or account suspension" : "",
        },
        { headers: { token } },
      );
      toast.success(status === "SUSPENDED" ? "Dealer suspended." : "Dealer activated.");
      await loadData();
      if (selectedDealerId === dealer.id) await openDealerDetail(dealer.id);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not change dealer status.");
    }
  };

  const downloadCsvStatement = async (dealer) => {
    try {
      const response = await axios.get(
        `${backendUrl}/api/distributor/wholesale/dealers/${dealer.id}/statement`,
        { headers: { token } },
      );
      const statement = response.data.statement;
      const rows = [
        ["Type", "Reference", "Date", "Due date", "Amount", "Status"],
        ...((statement.documents || []).map((document) => [
          document.documentType,
          document.documentNumber,
          document.issueDate ? new Date(document.issueDate).toISOString().slice(0, 10) : "",
          document.dueDate ? new Date(document.dueDate).toISOString().slice(0, 10) : "",
          document.remainingAmount,
          document.status,
        ])),
        ...((statement.payments || []).map((payment) => [
          "PAYMENT",
          payment.externalReference || payment.id,
          payment.occurredAt ? new Date(payment.occurredAt).toISOString().slice(0, 10) : "",
          "",
          payment.amount,
          payment.status,
        ])),
      ];
      const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dealer.dealerCode || "dealer"}-statement.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not download dealer statement.");
    }
  };

  const openDocument = async (kind, orderId = "") => {
    if (!selectedDealerId) return;
    try {
      const url = kind === "statement"
        ? `${backendUrl}/api/distributor/wholesale/dealers/${selectedDealerId}/documents/statement`
        : `${backendUrl}/api/distributor/wholesale/dealers/${selectedDealerId}/documents/${kind}/${orderId}`;
      const response = await axios.get(url, { headers: { token } });
      setDocumentModal({ kind, ...response.data });
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not prepare the document.");
    }
  };

  const statement = dealerDetail?.statement;
  const selectedDealer = dealerDetail?.dealer;

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase text-indigo-700">B2B distribution</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Dealer accounts</h1>
          <p className="mt-1 text-sm text-slate-600">Manage boutiques and dealers, credit controls, wholesale terms, and financial documents.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={loadData} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={openCreate} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-700 px-4 text-sm font-bold text-white">
            <Plus className="h-4 w-4" /> Add dealer
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dealer, PAN/VAT, phone"
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm"
              />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 text-xs">
              <option value="all">All</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Loading dealers...</p>
            ) : filteredDealers.length ? (
              <div className="divide-y divide-slate-100">
                {filteredDealers.map((dealer) => (
                  <button
                    key={dealer.id}
                    type="button"
                    onClick={() => openDealerDetail(dealer.id)}
                    className={`w-full px-4 py-3 text-left transition ${selectedDealerId === dealer.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{dealer.businessName}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{dealer.dealerCode} · {dealer.panVatNumber}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${dealer.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{dealer.status}</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-700">Credit {formatMoney(dealer.creditLimit)}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-slate-500">No dealers match this view.</p>
            )}
          </div>
        </aside>

        <main className="min-w-0">
          {!selectedDealerId ? (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div>
                <Building2 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-700">Select a dealer</p>
                <p className="mt-1 text-xs text-slate-500">View credit, orders, invoices, payments, and statements.</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">Loading dealer account...</div>
          ) : dealerDetail ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400">{selectedDealer.dealerCode}</p>
                    <h2 className="mt-1 text-xl font-black text-slate-950">{selectedDealer.businessName}</h2>
                    <p className="mt-1 text-xs text-slate-500">{selectedDealer.taxIdType}: {selectedDealer.panVatNumber}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEdit(selectedDealer)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Edit</button>
                    <button type="button" onClick={() => setDealerStatus(selectedDealer, selectedDealer.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED")} className={`rounded-lg px-3 py-2 text-xs font-bold text-white ${selectedDealer.status === "SUSPENDED" ? "bg-emerald-700" : "bg-rose-700"}`}>
                      {selectedDealer.status === "SUSPENDED" ? "Activate" : "Suspend"}
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Credit limit" value={formatMoney(selectedDealer.creditLimit)} />
                  <SummaryCard label="Available credit" value={formatMoney(statement?.availableCredit)} />
                  <SummaryCard label="Outstanding" value={formatMoney(statement?.outstandingBalance)} />
                  <SummaryCard label="Status" value={selectedDealer.status} />
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Contact and addresses</h3>
                  <dl className="mt-3 grid gap-2 text-xs text-slate-600">
                    <DetailRow label="Contact" value={selectedDealer.contactPerson || "—"} />
                    <DetailRow label="Phone" value={selectedDealer.phone || "—"} />
                    <DetailRow label="Email" value={selectedDealer.email || "—"} />
                    <DetailRow label="Billing" value={selectedDealer.billingAddress || "—"} />
                    <DetailRow label="Delivery" value={selectedDealer.deliveryAddress || "—"} />
                  </dl>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Statement actions</h3>
                    <CreditCard className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openDocument("statement")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><Printer className="h-3.5 w-3.5" /> Print PDF</button>
                    <button type="button" onClick={() => downloadCsvStatement(selectedDealer)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><FileText className="h-3.5 w-3.5" /> Download CSV</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <DetailRow label="Current" value={formatMoney(statement?.aging?.current)} />
                    <DetailRow label="1–30 days" value={formatMoney(statement?.aging?.days1to30)} />
                    <DetailRow label="31–60 days" value={formatMoney(statement?.aging?.days31to60)} />
                    <DetailRow label="Over 60" value={formatMoney(statement?.aging?.over60)} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Wholesale orders and invoices</h3>
                {dealerDetail.orders?.length ? (
                  <div className="mt-3 divide-y divide-slate-100">
                    {dealerDetail.orders.map((order) => (
                      <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{order.order?.orderReference || order.orderId}</p>
                          <p className="mt-1 text-[10px] text-slate-500">{order.status} · {formatMoney(order.order?.amount)}</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => openDocument("packing-slip", order.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-700"><Package className="h-3 w-3" /> Packing slip</button>
                          <button type="button" onClick={() => openDocument("invoice", order.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-700"><Printer className="h-3 w-3" /> Invoice</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">No wholesale orders.</p>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Payment history</h3>
                  {dealerDetail.dealer?.payments?.length ? (
                    <div className="mt-3 divide-y divide-slate-100">
                      {dealerDetail.dealer.payments.map((payment) => (
                        <div key={payment.id} className="flex justify-between gap-3 py-2 text-xs">
                          <div><p className="font-bold text-slate-800">{payment.paymentMethod}</p><p className="text-slate-500">{payment.externalReference || "No external reference"}</p></div>
                          <div className="text-right"><p className="font-bold text-slate-900">{formatMoney(payment.amount)}</p><p className="text-slate-500">{new Date(payment.occurredAt).toLocaleDateString()}</p></div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-3 text-xs text-slate-500">No payments recorded.</p>}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Quotation history</h3>
                  {dealerDetail.quotations?.length ? (
                    <div className="mt-3 divide-y divide-slate-100">
                      {dealerDetail.quotations.map((quotation) => (
                        <div key={quotation.id} className="flex justify-between gap-3 py-2 text-xs">
                          <p className="font-bold text-slate-800">{quotation.quotationNumber}</p>
                          <p className="font-bold text-slate-900">{quotation.status} · {formatMoney(quotation.totalAmount)}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-3 text-xs text-slate-500">No quotations.</p>}
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {pricing.tiers.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Wholesale price tiers</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pricing.tiers.map((tier) => (
              <div key={tier.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-bold text-slate-900">{tier.name}</p>
                <p className="mt-1 text-xs text-slate-500">{tier.discountPercent}% · minimum {tier.minimumQuantity} units</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={submitDealer} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-black text-slate-900">{editingDealer ? "Edit dealer" : "Register dealer"}</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg p-1 text-slate-500"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Business name" value={form.businessName} onChange={(value) => setForm((current) => ({ ...current, businessName: value }))} />
              <Field label="Contact person" value={form.contactPerson} onChange={(value) => setForm((current) => ({ ...current, contactPerson: value }))} />
              <Field label="Phone" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
              <Field label="Email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
              <div>
                <label className="text-xs font-semibold text-slate-600">Tax ID type</label>
                <select value={form.taxIdType} onChange={(event) => setForm((current) => ({ ...current, taxIdType: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
                  <option value="PAN">PAN</option>
                  <option value="VAT">VAT</option>
                </select>
              </div>
              <Field label="PAN/VAT number" value={form.panVatNumber} onChange={(value) => setForm((current) => ({ ...current, panVatNumber: value }))} />
              <Field label="Credit limit" value={form.creditLimit} type="number" onChange={(value) => setForm((current) => ({ ...current, creditLimit: value }))} />
              <Field label="Opening balance" value={form.openingBalance} type="number" onChange={(value) => setForm((current) => ({ ...current, openingBalance: value }))} />
              <Field label="Due days" value={form.dueDays} type="number" onChange={(value) => setForm((current) => ({ ...current, dueDays: value }))} />
              <div>
                <label className="text-xs font-semibold text-slate-600">Price tier</label>
                <select value={form.priceTierId} onChange={(event) => setForm((current) => ({ ...current, priceTierId: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
                  <option value="">No tier</option>
                  {pricing.tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><Field label="Billing address" value={form.billingAddress} onChange={(value) => setForm((current) => ({ ...current, billingAddress: value }))} /></div>
              <div className="sm:col-span-2"><Field label="Delivery address" value={form.deliveryAddress} onChange={(value) => setForm((current) => ({ ...current, deliveryAddress: value }))} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? "Saving..." : "Save dealer"}</button>
            </div>
          </form>
        </div>
      )}

      {documentModal && (
        <DocumentModal
          documentModal={documentModal}
          onClose={() => setDocumentModal(null)}
        />
      )}
    </section>
  );
};

const Field = ({ label, value, onChange, type = "text" }) => (
  <div>
    <label className="text-xs font-semibold text-slate-600">{label}</label>
    <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
  </div>
);

const SummaryCard = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
  </div>
);

const DetailRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
    <span className="shrink-0 text-slate-500">{label}</span>
    <span className="max-w-[70%] text-right font-semibold text-slate-800">{value}</span>
  </div>
);

const DocumentModal = ({ documentModal, onClose }) => {
  const kind = documentModal.kind;
  const dealer = documentModal.dealer || documentModal.document?.dealer || {};
  const order = documentModal.document?.order;
  const invoice = documentModal.document?.invoice;
  const lines = documentModal.document?.lines || order?.lines || [];
  const statement = documentModal.document;
  const totalUnits = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="text-base font-black text-slate-900">{kind === "invoice" ? "Wholesale invoice" : kind === "packing-slip" ? "Packing slip" : "Dealer statement"}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 rounded-xl border border-slate-900 p-5">
          <div className="flex justify-between gap-4 border-b border-slate-300 pb-4">
            <div>
              <p className="text-lg font-black text-slate-950">Distributor wholesale document</p>
              <p className="text-xs text-slate-500">{dealer.businessName}</p>
            </div>
            <div className="text-right text-xs">
              {kind === "invoice" && <><p className="font-bold">{invoice?.invoiceNumber || "Unissued"}</p><p>{invoice?.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString() : ""}</p></>}
              {kind === "packing-slip" && <><p className="font-bold">{order?.order?.orderReference || order?.orderId}</p><p>{order?.status}</p></>}
              {kind === "statement" && <p className="font-bold">{dealer.dealerCode}</p>}
            </div>
          </div>
          {kind === "statement" ? (
            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Opening" value={formatMoney(statement.openingBalance)} />
                <SummaryCard label="Outstanding" value={formatMoney(statement.outstandingBalance)} />
                <SummaryCard label="Available credit" value={formatMoney(statement.availableCredit)} />
                <SummaryCard label="Transactions" value={String((statement.documents?.length || 0) + (statement.payments?.length || 0))} />
              </div>
              <table className="w-full text-left">
                <thead><tr className="border-b"><th className="py-2">Type</th><th>Reference</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {(statement.documents || []).map((document) => <tr key={document.id} className="border-b"><td className="py-2">{document.documentType}</td><td>{document.documentNumber}</td><td>{document.issueDate ? new Date(document.issueDate).toLocaleDateString() : "—"}</td><td className="text-right">{formatMoney(document.remainingAmount)}</td></tr>)}
                  {(statement.payments || []).map((payment) => <tr key={payment.id} className="border-b"><td className="py-2">PAYMENT</td><td>{payment.externalReference || payment.id}</td><td>{new Date(payment.occurredAt).toLocaleDateString()}</td><td className="text-right">{formatMoney(payment.amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                <div><p className="font-bold">Bill to</p><p className="mt-1">{dealer.businessName}</p><p>{dealer.panVatNumber}</p><p>{dealer.billingAddress}</p></div>
                <div><p className="font-bold">Deliver to</p><p className="mt-1">{dealer.businessName}</p><p>{dealer.deliveryAddress}</p></div>
              </div>
              <table className="mt-5 w-full text-left text-xs">
                <thead><tr className="border-b-2 border-slate-900"><th className="py-2">Product / SKU</th><th>Size</th><th>Color</th><th className="text-right">Qty</th>{kind === "invoice" && <th className="text-right">Unit price</th>}{kind === "invoice" && <th className="text-right">Line total</th>}</tr></thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-slate-200">
                      <td className="py-2">{line.inventorySku?.product?.name || line.inventorySku?.productName || "Product"}<p className="text-[9px] text-slate-500">{line.inventorySkuId}</p></td>
                      <td>{line.inventorySku?.size || "—"}</td>
                      <td>{line.inventorySku?.color || "—"}</td>
                      <td className="text-right">{line.quantity}</td>
                      {kind === "invoice" && <td className="text-right">{formatMoney(line.unitPrice)}</td>}
                      {kind === "invoice" && <td className="text-right">{formatMoney(line.lineTotal)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex justify-end">
                {kind === "invoice" ? (
                  <div className="min-w-56 space-y-1 text-xs">
                    <DetailRow label="Taxable" value={formatMoney(invoice?.taxableAmount)} />
                    <DetailRow label="Discount" value={formatMoney(invoice?.discountAmount)} />
                    <DetailRow label="VAT" value={formatMoney(invoice?.vatAmount)} />
                    <DetailRow label="Grand total" value={formatMoney(invoice?.totalAmount)} />
                  </div>
                ) : <p className="text-sm font-black">Total units: {totalUnits}</p>}
              </div>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold">Close</button>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"><Printer className="mr-1 inline h-3.5 w-3.5" /> Print / Save PDF</button>
        </div>
      </div>
    </div>
  );
};

export default WholesaleDealers;
