/* eslint-disable react/prop-types */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, RotateCw, TrendingUp } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const number = (amount) => Number(amount || 0).toLocaleString();
const money = (amount) => `Rs ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const dateLabel = (value) => {
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: value.length === 7 ? undefined : "numeric", year: "2-digit" }).format(date);
};

const ProductSalesTimeline = ({ token, filters, product }) => {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(product?.productId || "");
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedProductId(product?.productId || "");
  }, [product?.productId]);

  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      setProductsLoading(true);
      setProductsError("");
      try {
        const response = await productAnalyticsApi.products(token, {
          ...filters,
          page: 1,
          limit: 100,
          sort: "soldQuantity",
        });
        if (!response.data?.success) throw new Error("Unable to load product choices.");
        if (active) {
          const options = response.data.products || [];
          if (product?.productId && !options.some(({ productId: id }) => id === product.productId)) {
            options.unshift({ productId: product.productId, name: product.name });
          }
          setProducts(options);
        }
      } catch (requestError) {
        if (active) setProductsError(requestError.response?.data?.message || "Unable to load product choices.");
      } finally {
        if (active) setProductsLoading(false);
      }
    };
    loadProducts();
    return () => { active = false; };
  }, [filters, product?.name, product?.productId, token]);

  const loadTimeline = useCallback(async () => {
    if (!selectedProductId) {
      setPoints([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await productAnalyticsApi.timeline(token, { ...filters, productId: selectedProductId });
      if (!response.data?.success) throw new Error("Unable to load the product timeline.");
      setPoints(response.data.timeline || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load the product timeline.");
    } finally {
      setLoading(false);
    }
  }, [filters, selectedProductId, token]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const selectedProduct = useMemo(
    () => products.find(({ productId }) => productId === selectedProductId)
      || (product?.productId === selectedProductId ? product : null),
    [product, products, selectedProductId],
  );

  const maxQuantity = Math.max(1, ...points.map((point) => Number(point.soldQuantity || 0)));
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={17} className="text-indigo-600" />
            <h2 className="text-sm font-black text-slate-900">{selectedProduct?.name || "Product"} · sales timeline</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Pieces sold, completed returns, and revenue over time for the selected range.</p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          View timeline for
          <select
            aria-label="Select product for timeline"
            value={selectedProductId}
            onChange={(event) => setSelectedProductId(event.target.value)}
            disabled={productsLoading}
            className="min-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-wait disabled:opacity-60"
          >
            <option value="">Choose a product</option>
            {products.map((item) => <option key={item.productId} value={item.productId}>{item.name}</option>)}
          </select>
        </label>
      </header>
      {productsError && <p role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">Product choices are unavailable: {productsError}</p>}
      {!selectedProductId ? (
        <p className="p-8 text-center text-sm text-slate-500">{productsLoading ? "Loading products…" : "Choose a product to view its sales history."}</p>
      ) : loading ? <p className="p-8 text-center text-sm text-slate-500">Loading timeline…</p> : error ? (
        <div role="alert" className="p-6 text-sm text-red-800">
          <p className="flex items-center gap-2 font-bold"><AlertCircle size={16} /> Timeline unavailable</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={loadTimeline} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white"><RotateCw size={13} /> Try again</button>
        </div>
      ) : points.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No sales or completed returns for {selectedProduct?.name || "this product"} in the selected range.</p>
      ) : (
        <>
          <div className="flex h-52 items-end gap-2 overflow-x-auto px-5 pb-2 pt-6">
            {points.map((point) => (
              <div key={point.date} className="group flex min-w-8 flex-1 flex-col items-center justify-end gap-2">
                <div className="relative flex h-36 w-full items-end justify-center rounded-t-md bg-indigo-50">
                  <div
                    title={`${number(point.soldQuantity)} pieces sold`}
                    className="w-full rounded-t-md bg-indigo-600 transition-colors group-hover:bg-indigo-700"
                    style={{ height: `${Math.max(point.soldQuantity ? 5 : 0, (Number(point.soldQuantity || 0) / maxQuantity) * 100)}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-[9px] text-slate-500">{dateLabel(point.date)}</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Pieces sold</th>
                  <th className="px-5 py-3 text-right">Orders</th>
                  <th className="px-5 py-3 text-right">Returned</th>
                  <th className="px-5 py-3 text-right">Gross revenue</th>
                  <th className="px-5 py-3 text-right">Refunded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {points.map((point) => (
                  <tr key={`row-${point.date}`}>
                    <td className="px-5 py-3 font-semibold text-slate-700">{dateLabel(point.date)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{number(point.soldQuantity)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{number(point.orderCount)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{number(point.returnedQuantity)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(point.grossRevenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(point.refundedRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[11px] leading-relaxed text-slate-500">Sales are grouped by order date; returns are grouped by the date the refund was completed.</p>
        </>
      )}
    </section>
  );
};

export default ProductSalesTimeline;
