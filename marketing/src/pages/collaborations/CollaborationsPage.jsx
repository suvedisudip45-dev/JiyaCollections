import { useCallback, useEffect, useState } from "react";
import { Check, Handshake, Send, X } from "lucide-react";
import { collaborationsApi } from "../../api";
import { getErrorMessage } from "../../api/client";

const CollaborationCard = ({ collaboration, onChange }) => {
  const latestTerms = collaboration.termsVersions?.[0] || null;
  const [fee, setFee] = useState(String(latestTerms?.fixedFeePerUnit ?? "0"));
  const [vatTreatment, setVatTreatment] = useState(latestTerms?.vatTreatment || "VAT_EXCLUSIVE");
  const [retailPrice, setRetailPrice] = useState(String(latestTerms?.retailPrice ?? collaboration.product?.price ?? ""));
  const [discountPercentage, setDiscountPercentage] = useState(String(latestTerms?.discountPercentage ?? collaboration.product?.discount ?? "0"));
  const [notes, setNotes] = useState(latestTerms?.notes || "");
  const pendingFromAdmin = latestTerms?.status === "PENDING_PARTNER";
  const [actionError, setActionError] = useState("");

  const submit = async (request) => {
    setActionError("");
    try {
      await request();
      await onChange();
    } catch (error) {
      setActionError(getErrorMessage(error, "Unable to update collaboration terms."));
    }
  };

  return (
    <article className="rounded-2xl border border-[var(--mp-line)] bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--mp-ink)]">{collaboration.product?.name || "Collaboration product"}</h2>
          <p className="mt-1 text-xs text-[var(--mp-muted)]">
            Rs. {Number(collaboration.product?.price || 0).toLocaleString()}
            {Number(collaboration.product?.discount || 0) > 0 && ` · ${collaboration.product.discount}% company-funded discount`}
          </p>
        </div>
        <span className="rounded-full bg-[var(--mp-brand-light)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
          {collaboration.listingStatus}
        </span>
      </div>

      <div className="mt-4 border-t border-[var(--mp-line)] pt-3">
        {actionError && <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{actionError}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--mp-ink)]">Fixed fee per eligible unit</p>
          {latestTerms && <span className="text-[11px] text-[var(--mp-muted)]">Terms v{latestTerms.version}: {latestTerms.status.replaceAll("_", " ")}</span>}
        </div>
        {latestTerms && <p className="mt-1 text-xs text-[var(--mp-ink-2)]">Rs. {Number(latestTerms.fixedFeePerUnit || 0).toFixed(2)} per delivered unit</p>}
        {latestTerms?.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--mp-muted)]">{latestTerms.notes}</p>}

        {pendingFromAdmin && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => submit(() => collaborationsApi.respond(collaboration.id, "ACCEPT"))} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white hover:bg-brand-800">
              <Check size={14} /> Accept terms
            </button>
            <button type="button" onClick={() => submit(() => collaborationsApi.respond(collaboration.id, "REJECT"))} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50">
              <X size={14} /> Reject
            </button>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-[11px] font-semibold text-[var(--mp-muted)]">
            Fee per unit
            <input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--mp-line)] px-3 py-2 text-sm text-[var(--mp-ink)]" />
          </label>
          <label className="text-[11px] font-semibold text-[var(--mp-muted)]">
            Retail price
            <input type="number" min="0.01" step="0.01" value={retailPrice} onChange={(event) => setRetailPrice(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--mp-line)] px-3 py-2 text-sm text-[var(--mp-ink)]" />
          </label>
          <label className="text-[11px] font-semibold text-[var(--mp-muted)]">
            Customer discount (%)
            <input type="number" min="0" max="100" step="0.01" value={discountPercentage} onChange={(event) => setDiscountPercentage(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--mp-line)] px-3 py-2 text-sm text-[var(--mp-ink)]" />
          </label>
          <label className="text-[11px] font-semibold text-[var(--mp-muted)]">
            Fee VAT
            <select value={vatTreatment} onChange={(event) => setVatTreatment(event.target.value)} className="mt-1 w-full rounded-xl border border-[var(--mp-line)] bg-white px-3 py-2 text-sm text-[var(--mp-ink)]">
              <option value="VAT_EXCLUSIVE">Add 13% VAT</option>
              <option value="VAT_INCLUSIVE">Includes 13% VAT</option>
              <option value="EXEMPT">Exempt</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-[var(--mp-muted)]">
            Proposal note
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} className="mt-1 w-full rounded-xl border border-[var(--mp-line)] px-3 py-2 text-sm text-[var(--mp-ink)]" placeholder="Optional counteroffer note" />
          </label>
          <button type="button" onClick={() => submit(() => collaborationsApi.proposeTerms(collaboration.id, { fixedFeePerUnit: fee, vatTreatment, retailPrice, discountPercentage, notes }))} className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white hover:bg-brand-800">
            <Send size={13} /> Propose / counter
          </button>
        </div>
        {latestTerms?.status === "PENDING_ADMIN" && <p className="mt-3 text-[11px] text-amber-700">Your proposal is waiting for admin review.</p>}
        {!latestTerms && <p className="mt-3 text-[11px] text-[var(--mp-muted)]">Submit a per-unit fee proposal to begin the agreement.</p>}
      </div>
    </article>
  );
};

const CollaborationsPage = () => {
  const [products, setProducts] = useState([]);
  const [report, setReport] = useState({ summary: {}, sales: [], invoices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [productsResponse, reportResponse] = await Promise.all([
        collaborationsApi.list(),
        collaborationsApi.report(),
      ]);
      setProducts(productsResponse.data.products || []);
      setReport({
        summary: reportResponse.data.summary || {},
        sales: reportResponse.data.sales || [],
        invoices: reportResponse.data.invoices || [],
      });
    } catch (fetchError) {
      setError(getErrorMessage(fetchError, "Unable to load collaboration products."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-600">Partner catalog</p>
        <h1 className="mt-1 text-xl font-extrabold text-[var(--mp-ink)]">Collaborations</h1>
        <p className="mt-1 text-xs text-[var(--mp-muted)]">Review and negotiate the fixed fee for each assigned product.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Retained units", report.summary.retainedUnits],
          ["Returned units", report.summary.returnedUnits],
          ["Net product sales", `Rs. ${Number(report.summary.netSales || 0).toLocaleString()}`],
          ["Fee invoiced", `Rs. ${Number(report.summary.feeInvoiced || 0).toLocaleString()}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[var(--mp-line)] bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--mp-muted)]">{label}</p>
            <p className="mt-2 text-lg font-extrabold text-[var(--mp-ink)]">{value ?? 0}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--mp-line)] bg-white">
        <div className="border-b border-[var(--mp-line)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--mp-ink)]">Sales detail</h2>
          <p className="mt-0.5 text-[11px] text-[var(--mp-muted)]">Delivered quantities, returned quantities, actual selling rate, and fee accrual.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[var(--mp-bg)] text-[10px] uppercase tracking-wide text-[var(--mp-muted)]">
              <tr><th className="px-4 py-3">Date / Order</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Returned</th><th className="px-4 py-3">Actual rate</th><th className="px-4 py-3">Partner fee</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--mp-line)]">
              {report.sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="px-4 py-3 text-[var(--mp-muted)]">{sale.order?.date ? new Date(sale.order.date).toLocaleDateString() : "-"}<br />#{String(sale.orderId).slice(-8)}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--mp-ink)]">{sale.product?.name || "Product"}<br /><span className="font-normal text-[var(--mp-muted)]">{sale.size} {sale.color}</span></td>
                  <td className="px-4 py-3">{sale.status === "PENDING_DELIVERY" ? "Pending" : sale.quantity}</td>
                  <td className="px-4 py-3">{sale.quantityReturned}</td>
                  <td className="px-4 py-3">Rs. {Number(sale.unitSellingPrice || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">Rs. {(Number(sale.partnerFeePerUnit || 0) * Math.max(0, sale.quantity - sale.quantityReturned)).toLocaleString()}</td>
                </tr>
              ))}
              {report.sales.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--mp-muted)]">No collaboration sales yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--mp-line)] bg-white">
        <div className="border-b border-[var(--mp-line)] px-4 py-3"><h2 className="text-sm font-bold text-[var(--mp-ink)]">Monthly fee invoices</h2></div>
        <div className="divide-y divide-[var(--mp-line)]">
          {report.invoices.map((invoice) => (
            <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
              <div><p className="font-semibold text-[var(--mp-ink)]">{invoice.invoiceNumber}</p><p className="mt-0.5 text-[var(--mp-muted)]">{new Date(invoice.periodStart).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · {invoice.totalUnits} net units</p></div>
              <div className="text-right"><p className="font-bold text-[var(--mp-ink)]">Rs. {Number(invoice.totalAmount || 0).toLocaleString()}</p><p className="text-[10px] uppercase text-[var(--mp-muted)]">{invoice.accountingDocument?.status || invoice.status}</p></div>
            </div>
          ))}
          {report.invoices.length === 0 && <p className="px-4 py-6 text-xs text-[var(--mp-muted)]">No invoices issued yet.</p>}
        </div>
      </section>
      {loading ? <div className="py-12 text-center text-sm text-[var(--mp-muted)]">Loading collaborations...</div> : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--mp-line)] bg-white p-10 text-center">
          <Handshake size={24} className="mx-auto text-brand-600" />
          <p className="mt-3 text-sm font-bold text-[var(--mp-ink)]">No assigned collaboration products</p>
          <p className="mt-1 text-xs text-[var(--mp-muted)]">Products assigned by the admin will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((collaboration) => (
            <CollaborationCard key={collaboration.id} collaboration={collaboration} onChange={fetchProducts} />
          ))}
        </div>
      )}
    </div>
  );
};

export default CollaborationsPage;