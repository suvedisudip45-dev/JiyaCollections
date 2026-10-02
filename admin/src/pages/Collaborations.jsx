/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Check, Handshake, Pause, Play, ReceiptText, Send, X } from "lucide-react";
import { backendUrl, currency } from "../App";

const CollaborationCard = ({ collaboration, token, onChange }) => {
  const latestTerms = collaboration.termsVersions?.[0] || null;
  const [fee, setFee] = useState(String(latestTerms?.fixedFeePerUnit ?? "0"));
  const [vatTreatment, setVatTreatment] = useState(latestTerms?.vatTreatment || "VAT_EXCLUSIVE");
  const [retailPrice, setRetailPrice] = useState(String(latestTerms?.retailPrice ?? collaboration.product?.price ?? ""));
  const [discountPercentage, setDiscountPercentage] = useState(String(latestTerms?.discountPercentage ?? collaboration.product?.discount ?? "0"));
  const [notes, setNotes] = useState(latestTerms?.notes || "");
  const pendingFromPartner = latestTerms?.status === "PENDING_ADMIN";

  const submit = async (path, body = {}) => {
    try {
      const response = await axios.post(
        `${backendUrl}/api/collaborations/admin/products/${encodeURIComponent(collaboration.id)}/${path}`,
        body,
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to update collaboration.");
      toast.success("Collaboration updated.");
      onChange();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update collaboration.");
    }
  };

  const updateListing = async (action) => {
    try {
      const response = await axios.patch(
        `${backendUrl}/api/collaborations/admin/products/${encodeURIComponent(collaboration.id)}/listing`,
        { action },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to update listing.");
      toast.success(action === "PUBLISH" ? "Collaboration product published." : "Collaboration listing updated.");
      onChange();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update listing.");
    }
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900">{collaboration.product?.name || "Product"}</h3>
          <p className="mt-1 text-xs text-slate-500">Partner: {collaboration.partner?.name || "Unknown"}</p>
          <p className="mt-1 text-xs text-slate-500">
            Product price {currency}{Number(collaboration.product?.price || 0).toLocaleString()}
            {Number(collaboration.product?.discount || 0) > 0 && ` · ${collaboration.product.discount}% company-funded discount`}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          {collaboration.listingStatus}
        </span>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-700">Per-unit partner fee</p>
          {latestTerms && <span className="text-[11px] text-slate-500">Terms v{latestTerms.version}: {latestTerms.status.replaceAll("_", " ")}</span>}
        </div>
        {latestTerms && (
          <p className="mt-1 text-xs text-slate-600">
            {currency}{Number(latestTerms.fixedFeePerUnit || 0).toFixed(2)} per eligible unit
            {latestTerms.proposedByRole && ` · proposed by ${latestTerms.proposedByRole === "ADMIN" ? "admin" : "partner"}`}
          </p>
        )}
        {latestTerms?.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{latestTerms.notes}</p>}

        {pendingFromPartner && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => submit("respond", { action: "ACCEPT" })} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
              <Check size={14} /> Accept partner proposal
            </button>
            <button type="button" onClick={() => submit("respond", { action: "REJECT" })} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
              <X size={14} /> Reject
            </button>
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-[11px] font-semibold text-slate-600">
            Fee per unit
            <input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900" />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Retail price
            <input type="number" min="0.01" step="0.01" value={retailPrice} onChange={(event) => setRetailPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900" />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Customer discount (%)
            <input type="number" min="0" max="100" step="0.01" value={discountPercentage} onChange={(event) => setDiscountPercentage(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900" />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Fee VAT
            <select value={vatTreatment} onChange={(event) => setVatTreatment(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900">
              <option value="VAT_EXCLUSIVE">Add 13% VAT</option>
              <option value="VAT_INCLUSIVE">Includes 13% VAT</option>
              <option value="EXEMPT">Exempt</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Proposal note
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900" placeholder="Optional terms note" />
          </label>
          <button type="button" onClick={() => submit("terms", { fixedFeePerUnit: fee, vatTreatment, retailPrice, discountPercentage, notes })} className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            <Send size={13} /> Send / counter
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {collaboration.listingStatus === "ACTIVE" ? (
            <button type="button" onClick={() => updateListing("PAUSE")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Pause size={13} /> Pause listing
            </button>
          ) : collaboration.activeTermsVersion ? (
            <button type="button" onClick={() => updateListing("PUBLISH")} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
              <Play size={13} /> Publish
            </button>
          ) : (
            <p className="self-center text-[11px] text-amber-700">Partner acceptance is required before publishing.</p>
          )}
        </div>
      </div>
    </article>
  );
};

const Collaborations = ({ token }) => {
  const [collaborations, setCollaborations] = useState([]);
  const [products, setProducts] = useState([]);
  const [partners, setPartners] = useState([]);
  const [report, setReport] = useState({ summary: {}, sales: [], invoices: [] });
  const [invoiceMonth, setInvoiceMonth] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
  const [productId, setProductId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listResponse, optionsResponse, reportResponse] = await Promise.all([
        axios.get(`${backendUrl}/api/collaborations/admin/products`, { headers: { token } }),
        axios.get(`${backendUrl}/api/collaborations/admin/options`, { headers: { token } }),
        axios.get(`${backendUrl}/api/collaborations/admin/report`, { headers: { token } }),
      ]);
      setCollaborations(listResponse.data.products || []);
      setProducts(optionsResponse.data.products || []);
      setPartners(optionsResponse.data.partners || []);
      setReport({
        summary: reportResponse.data.summary || {},
        sales: reportResponse.data.sales || [],
        invoices: reportResponse.data.invoices || [],
      });
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load collaboration data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateInvoices = async () => {
    try {
      const response = await axios.post(
        `${backendUrl}/api/collaborations/admin/invoices/generate`,
        { month: invoiceMonth },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to generate invoices.");
      toast.success(response.data.message || "Invoices generated.");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to generate invoices.");
    }
  };

  const assignProduct = async (event) => {
    event.preventDefault();
    if (!productId || !partnerId) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/collaborations/admin/products`,
        { productId, partnerId },
        { headers: { token } }
      );
      if (!response.data.success) throw new Error(response.data.message || "Unable to assign product.");
      toast.success("Product assigned. It remains unpublished until partner terms are accepted.");
      setProductId("");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to assign product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Catalog</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Collaborations</h1>
        </div>
        <span className="text-xs font-semibold text-slate-500">{collaborations.length} products</span>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-900">Assign company product</h2>
        <p className="mt-1 text-xs text-slate-500">Products stay out of the public catalog until the per-product fee is accepted and admin publishes the listing.</p>
        <form onSubmit={assignProduct} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-semibold text-slate-600">
            Product
            <select required value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">
              <option value="">Select a product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {currency}{Number(product.price || 0).toLocaleString()}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Marketing partner
            <select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">
              <option value="">Select a partner</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} · {partner.code}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving || !products.length || !partners.length} className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Assigning..." : "Assign product"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Handshake size={17} /> Product agreements</div>
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading collaborations...</p> : collaborations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No collaboration products assigned.</p>
        ) : collaborations.map((collaboration) => (
          <CollaborationCard key={collaboration.id} collaboration={collaboration} token={token} onChange={fetchData} />
        ))}
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Performance</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Collaboration sales</h2>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-[11px] font-semibold text-slate-600">Invoice month
              <input type="month" value={invoiceMonth} onChange={(event) => setInvoiceMonth(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900" />
            </label>
            <button type="button" onClick={generateInvoices} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800">
              <ReceiptText size={14} /> Generate invoices
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Retained units", report.summary.retainedUnits],
            ["Returned units", report.summary.returnedUnits],
            ["Net product sales", `Rs. ${Number(report.summary.netSales || 0).toLocaleString()}`],
            ["Partner fees accrued", `Rs. ${Number(report.summary.feeAccrued || 0).toLocaleString()}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-extrabold text-slate-900">{value ?? 0}</p>
            </div>
          ))}
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Date / Order</th><th className="px-4 py-3">Partner</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Returned</th><th className="px-4 py-3">Actual rate</th><th className="px-4 py-3">Fee / unit</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-4 py-3 text-slate-500">{sale.order?.date ? new Date(sale.order.date).toLocaleDateString() : "-"}<br />#{String(sale.orderId).slice(-8)}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{sale.partner?.name || "Partner"}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{sale.product?.name || "Product"}<br /><span className="font-normal text-slate-500">{sale.size} {sale.color}</span></td>
                    <td className="px-4 py-3">{sale.status === "PENDING_DELIVERY" ? "Pending" : sale.quantity}</td>
                    <td className="px-4 py-3">{sale.quantityReturned}</td>
                    <td className="px-4 py-3">Rs. {Number(sale.unitSellingPrice || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">Rs. {Number(sale.partnerFeePerUnit || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">{sale.status.replaceAll("_", " ")}</td>
                  </tr>
                ))}
                {report.sales.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No collaboration sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Partner fee invoices</h3></div>
          <div className="divide-y divide-slate-100">
            {report.invoices.map((invoice) => (
              <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                <div><p className="font-semibold text-slate-900">{invoice.invoiceNumber} · {invoice.partner?.name}</p><p className="mt-0.5 text-slate-500">{new Date(invoice.periodStart).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · {invoice.totalUnits} net units</p></div>
                <div className="text-right"><p className="font-bold text-slate-900">Rs. {Number(invoice.totalAmount || 0).toLocaleString()}</p><p className="text-[10px] uppercase text-slate-500">{invoice.accountingDocument?.status || invoice.status}</p></div>
              </div>
            ))}
            {report.invoices.length === 0 && <p className="px-4 py-6 text-xs text-slate-500">No invoices generated yet.</p>}
          </div>
        </section>
      </section>
    </div>
  );
};

export default Collaborations;