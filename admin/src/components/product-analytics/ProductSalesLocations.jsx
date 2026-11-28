/* eslint-disable react/prop-types */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, MapPin, RotateCw } from "lucide-react";
import { productAnalyticsApi } from "../../api/productAnalytics";

const money = (amount) => `Rs ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const number = (amount) => Number(amount || 0).toLocaleString();

const ProductSalesLocations = ({ token, filters, product }) => {
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(product?.productId || "");
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [loading, setLoading] = useState(true);
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

  const loadLocations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await productAnalyticsApi.locations(token, {
        ...filters,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
      });
      if (!response.data?.success) throw new Error("Unable to load location sales.");
      setLocations(response.data.locations || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load location sales.");
    } finally {
      setLoading(false);
    }
  }, [filters, selectedProductId, token]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const provinces = useMemo(() => {
    const groups = new Map();
    for (const location of locations) {
      const group = groups.get(location.province) || { province: location.province, districts: [], soldQuantity: 0, grossRevenue: 0 };
      group.districts.push(location);
      group.soldQuantity += location.soldQuantity;
      group.grossRevenue += location.grossRevenue || 0;
      groups.set(location.province, group);
    }
    return [...groups.values()].sort((left, right) => right.soldQuantity - left.soldQuantity);
  }, [locations]);
  const locationStats = useMemo(() => ({
    districts: locations.length,
    provinces: provinces.length,
    soldQuantity: locations.reduce((total, location) => total + location.soldQuantity, 0),
    grossRevenue: locations.reduce((total, location) => total + (location.grossRevenue || 0), 0),
    orderCount: locations.reduce((total, location) => total + location.orderCount, 0),
  }), [locations, provinces.length]);
  const selectedProductName = products.find(({ productId: id }) => id === selectedProductId)?.name
    || (product?.productId === selectedProductId ? product.name : "");

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex items-center gap-2">
          <MapPin size={17} className="text-indigo-600" />
          <h2 className="text-sm font-black text-slate-900">Where customers are buying</h2>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-xs text-slate-500">
            {selectedProductName ? `Sales for ${selectedProductName}` : "All products"}
            {" · grouped by the order’s delivery province and district."}
          </p>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Filter by product
            <select
              aria-label="Filter location sales by product"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              disabled={productsLoading}
              className="min-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold normal-case tracking-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-wait disabled:opacity-60"
            >
              <option value="">All products</option>
              {products.map((item) => <option key={item.productId} value={item.productId}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </header>
      {!loading && !error && locations.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Summary of locations shown</p>
          <div className="flex flex-wrap items-center gap-2">
            {[
              [`${number(locationStats.provinces)} Provinces`, "text-indigo-700"],
              [`${number(locationStats.districts)} Districts`, "text-slate-700"],
              [`${number(locationStats.soldQuantity)} Sold units`, "text-blue-700"],
              [money(locationStats.grossRevenue), "text-emerald-700"],
              [`${number(locationStats.orderCount)} Orders`, "text-slate-700"],
            ].map(([label, tone]) => (
              <span key={label} className={`rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-bold ${tone}`}>{label}</span>
            ))}
          </div>
        </div>
      )}
      {productsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Product filters are unavailable: {productsError}</p>}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading locations…</div> : error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="flex items-center gap-2 font-bold"><AlertCircle size={16} /> Location sales unavailable</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={loadLocations} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white"><RotateCw size={13} /> Try again</button>
        </div>
      ) : provinces.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No sales locations in this period.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {provinces.map((group) => (
            <article key={group.province} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <div>
                  <h3 className="text-sm font-black text-slate-900">{group.province}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">{group.districts.length} districts with sales</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-indigo-700">{number(group.soldQuantity)} pcs</p>
                  <p className="text-[11px] text-slate-500">{money(group.grossRevenue)}</p>
                </div>
              </header>
              <div className="divide-y divide-slate-100">
                {group.districts.map((district) => (
                  <div key={`${district.province}-${district.district}`} className="flex items-center justify-between px-5 py-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-800">{district.district}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{number(district.customerCount)} customers · {number(district.orderCount)} orders</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-nums text-slate-800">{number(district.soldQuantity)} pcs</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{money(district.grossRevenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default ProductSalesLocations;
