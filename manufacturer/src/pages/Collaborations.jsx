import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Handshake, ReceiptText } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const Collaborations = () => {
  const { token, backendUrl, currency } = useManufacturer();
  const [report, setReport] = useState({ summary: {}, sales: [], invoices: [] });
  const [loading, setLoading] = useState(true);

  const fetchReport = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${backendUrl}/api/collaborations/manufacturer/report`, {
        headers: { token },
      });
      if (!response.data.success) throw new Error(response.data.message || "Unable to load collaboration report.");
      setReport({
        summary: response.data.summary || {},
        sales: response.data.sales || [],
        invoices: response.data.invoices || [],
      });
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to load collaboration report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchReport();
  }, [token, backendUrl]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Commercial</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Collaboration sales</h1>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          <Handshake size={14} /> Manufacturer partner activity
        </span>
      </header>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading collaboration activity...</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Retained units", report.summary.retainedUnits],
              ["Returned units", report.summary.returnedUnits],
              ["Net sales", `${currency}${Number(report.summary.netSales || 0).toLocaleString()}`],
              ["Fees accrued", `${currency}${Number(report.summary.feeAccrued || 0).toLocaleString()}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-extrabold text-slate-900">{value ?? 0}</p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">Sales activity</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Partner</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Units</th>
                    <th className="px-4 py-3">Returned</th>
                    <th className="px-4 py-3">Actual rate</th>
                    <th className="px-4 py-3">Partner fee</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.sales.length > 0 ? report.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-4 py-3 text-slate-500">#{String(sale.orderId).slice(-8)}<br />{sale.order?.date ? new Date(sale.order.date).toLocaleDateString() : "-"}</td>
                      <td className="px-4 py-3 font-medium text-slate-700">{sale.partner?.name || "Partner"}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{sale.product?.name || "Product"}<br /><span className="font-normal text-slate-500">{sale.size} {sale.color}</span></td>
                      <td className="px-4 py-3">{sale.quantity}</td>
                      <td className="px-4 py-3">{sale.quantityReturned}</td>
                      <td className="px-4 py-3">{currency}{Number(sale.unitSellingPrice || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">{currency}{Number(sale.partnerFeePerUnit || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">{sale.status.replaceAll("_", " ")}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No collaboration sales for your products yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 flex items-center gap-2">
              <ReceiptText size={14} className="text-slate-700" />
              <h2 className="text-sm font-bold text-slate-900">Fee invoices</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {report.invoices.length > 0 ? report.invoices.map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">{invoice.invoiceNumber} · {invoice.partner?.name}</p>
                    <p className="mt-0.5 text-slate-500">{new Date(invoice.periodStart).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · {invoice.totalUnits} units</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">{currency}{Number(invoice.totalAmount || 0).toLocaleString()}</p>
                    <p className="text-[10px] uppercase text-slate-500">{invoice.accountingDocument?.status || invoice.status}</p>
                  </div>
                </div>
              )) : (
                <p className="px-4 py-6 text-xs text-slate-500">No collaboration invoices are linked to your supplied products yet.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default Collaborations;
