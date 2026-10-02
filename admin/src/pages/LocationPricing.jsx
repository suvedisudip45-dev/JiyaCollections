import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Check, MapPinned, Percent, RefreshCw, Save, Search, Tag } from "lucide-react";
import { backendUrl, currency } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const locationKey = (province, district) => `${province}|${district}`;
const parsePercentage = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

const LocationPricing = ({ token }) => {
  const { can } = usePermissions();
  const canManageCoverage = can("manufacturer:admin_update");
  const canManageDiscounts = can("product:update");
  const [activeTab, setActiveTab] = useState(canManageCoverage ? "coverage" : "discounts");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState("");
  const [selectedPairs, setSelectedPairs] = useState(new Set());
  const [selectedProvince, setSelectedProvince] = useState("");
  const [districtSearch, setDistrictSearch] = useState("");
  const [discountForm, setDiscountForm] = useState({ productId: "", province: "", district: "", discountPercentage: "", isActive: true });
  const [editingDiscountId, setEditingDiscountId] = useState("");

  const provinces = useMemo(() => locations.filter((location) => location.type === "PROVINCE"), [locations]);
  const districts = useMemo(() => locations.filter((location) =>
    location.type === "DISTRICT" &&
    (!selectedProvince || location.province === selectedProvince) &&
    location.name.toLowerCase().includes(districtSearch.trim().toLowerCase())
  ), [locations, selectedProvince, districtSearch]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const tasks = [];
    if (canManageCoverage) {
      tasks.push(axios.get(`${backendUrl}/api/admin/manufacturer-locations`, { headers: { token } }).then((response) => {
        if (response.data.success) {
          setLocations(response.data.locations || []);
          setManufacturers(response.data.manufacturers || []);
          setMappings(response.data.mappings || []);
        }
      }));
    }
    if (canManageDiscounts) {
      tasks.push(axios.get(`${backendUrl}/api/admin/location-discounts`, { headers: { token } }));
    }
    try {
      const results = await Promise.allSettled(tasks);
      if (canManageDiscounts) {
        const discountResult = results.find((result) => result.status === "fulfilled" && result.value?.data?.discounts);
        if (discountResult) {
          setDiscounts(discountResult.value.data.discounts || []);
          setProducts(discountResult.value.data.products || []);
          if (!canManageCoverage) setLocations(discountResult.value.data.locations || []);
        }
      }
      if (results.some((result) => result.status === "rejected")) toast.error("Some location-pricing data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token, canManageCoverage, canManageDiscounts]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  useEffect(() => {
    const next = mappings
      .filter((mapping) => mapping.manufacturerId === selectedManufacturerId && mapping.isActive)
      .map((mapping) => locationKey(mapping.province, mapping.district));
    setSelectedPairs(new Set(next));
  }, [selectedManufacturerId, mappings]);

  const togglePair = (key) => {
    setSelectedPairs((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveCoverage = async () => {
    if (!selectedManufacturerId) return toast.error("Select a manufacturer first.");
    setSaving(true);
    try {
      const assignments = [...selectedPairs].map((key) => {
        const [province, district] = key.split("|");
        return { province, district };
      });
      const response = await axios.post(`${backendUrl}/api/admin/manufacturer-locations`, {
        manufacturerId: selectedManufacturerId,
        locations: assignments,
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to save manufacturer coverage");
      setMappings(response.data.mappings || []);
      toast.success(`Saved ${assignments.length} district${assignments.length === 1 ? "" : "s"} for this manufacturer.`);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to save manufacturer coverage");
    } finally {
      setSaving(false);
    }
  };

  const saveDiscount = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.post(`${backendUrl}/api/admin/location-discounts`, {
        ...discountForm,
        discountPercentage: Number(discountForm.discountPercentage),
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to save location discount");
      setDiscountForm({ productId: "", province: "", district: "", discountPercentage: "", isActive: true });
      setEditingDiscountId("");
      await fetchData();
      toast.success("Location discount saved.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to save location discount");
    } finally {
      setSaving(false);
    }
  };

  const editDiscount = (discount) => {
    setEditingDiscountId(discount.id);
    setDiscountForm({
      productId: discount.productId,
      province: discount.province,
      district: discount.district,
      discountPercentage: String(discount.discountPercentage),
      isActive: discount.isActive,
    });
    setActiveTab("discounts");
  };

  const toggleDiscount = async (discount) => {
    try {
      const response = await axios.post(`${backendUrl}/api/admin/location-discounts`, {
        productId: discount.productId,
        province: discount.province,
        district: discount.district,
        discountPercentage: Number(discount.discountPercentage),
        isActive: !discount.isActive,
      }, { headers: { token } });
      if (!response.data.success) throw new Error(response.data.message || "Unable to change discount state");
      setDiscounts((current) => current.map((item) => item.id === discount.id ? response.data.discount : item));
      toast.success(response.data.discount.isActive ? "Location discount enabled." : "Location discount disabled.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to change discount state");
    }
  };

  const discountProvinces = provinces.length ? provinces : locations.filter((location) => location.type === "PROVINCE");
  const discountDistricts = locations.filter((location) => location.type === "DISTRICT" && location.province === discountForm.province);

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Commerce rules</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Location pricing</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Discount previews use local stock. Checkout verifies one mapped hub can fulfill the complete cart before locking a price.</p>
        </div>
        <button type="button" onClick={fetchData} className="inline-flex items-center gap-2 self-start border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:self-auto">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      <div className="flex gap-2 border-b border-slate-200">
        {canManageCoverage && <button type="button" onClick={() => setActiveTab("coverage")} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === "coverage" ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}><MapPinned size={15} className="mr-2 inline" />Manufacturer coverage</button>}
        {canManageDiscounts && <button type="button" onClick={() => setActiveTab("discounts")} className={`border-b-2 px-3 py-2 text-sm font-semibold ${activeTab === "discounts" ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}><Percent size={15} className="mr-2 inline" />Product discounts</button>}
      </div>

      {loading ? <div className="py-16 text-center text-sm text-slate-500">Loading location rules…</div> : activeTab === "coverage" && canManageCoverage ? (
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-900">Assign service districts</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">A manufacturer becomes price-eligible only when active, contracted, and holding enough unreserved variant stock.</p>
            <label className="mt-5 block text-xs font-semibold text-slate-700">Manufacturer
              <select value={selectedManufacturerId} onChange={(event) => setSelectedManufacturerId(event.target.value)} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm">
                <option value="">Select manufacturer</option>
                {manufacturers.map((manufacturer) => <option key={manufacturer.id} value={manufacturer.id}>{manufacturer.name} · {manufacturer.city}</option>)}
              </select>
            </label>
            <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-600">{selectedPairs.size} district{selectedPairs.size === 1 ? "" : "s"} selected</div>
            <button type="button" onClick={saveCoverage} disabled={saving || !selectedManufacturerId} className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />Save coverage</button>
          </section>

          <section className="border border-slate-200 bg-white p-5">
            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <label className="text-xs font-semibold text-slate-700">Province
                <select value={selectedProvince} onChange={(event) => setSelectedProvince(event.target.value)} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All provinces</option>{provinces.map((province) => <option key={province.code} value={province.name}>{province.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Find district
                <span className="relative mt-1.5 block"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={districtSearch} onChange={(event) => setDistrictSearch(event.target.value)} className="w-full border border-slate-300 py-2.5 pl-9 pr-3 text-sm" placeholder="Search 77 districts" /></span>
              </label>
            </div>
            <div className="mt-4 grid max-h-[440px] grid-cols-1 gap-1 overflow-y-auto border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {districts.map((district) => {
                const key = locationKey(district.province, district.name);
                const checked = selectedPairs.has(key);
                return <label key={district.code} className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-xs ${checked ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-transparent text-slate-700 hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={checked} disabled={!selectedManufacturerId} onChange={() => togglePair(key)} className="accent-emerald-700" />
                  <span className="flex-1">{district.name}</span><span className="text-[10px] text-slate-400">{district.province.replace(" Province", "")}</span>
                </label>;
              })}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-900">{editingDiscountId ? "Edit location discount" : "Set a product discount"}</h2>
            <form onSubmit={saveDiscount} className="mt-4 space-y-4">
              <label className="block text-xs font-semibold text-slate-700">Province
                <select required value={discountForm.province} onChange={(event) => setDiscountForm({ ...discountForm, province: event.target.value, district: "" })} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">Select province</option>{discountProvinces.map((province) => <option key={province.code} value={province.name}>{province.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">District
                <select required disabled={!discountForm.province} value={discountForm.district} onChange={(event) => setDiscountForm({ ...discountForm, district: event.target.value })} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-100">
                  <option value="">Select district</option>{discountDistricts.map((district) => <option key={district.code} value={district.name}>{district.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">Product
                <select required value={discountForm.productId} onChange={(event) => setDiscountForm({ ...discountForm, productId: event.target.value })} className="mt-1.5 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">Select product</option>{products.map((product) => <option key={product.id || product._id} value={product.id || product._id}>{product.name} · {currency}{Number(product.price).toLocaleString()}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">Location discount (%)
                <span className="relative mt-1.5 block"><input required type="number" min="0" max="100" step="0.01" value={discountForm.discountPercentage} onChange={(event) => setDiscountForm({ ...discountForm, discountPercentage: event.target.value })} className="w-full border border-slate-300 px-3 py-2.5 pr-10 text-sm" placeholder="0.00" /><Percent size={15} className="absolute right-3 top-3 text-slate-400" /></span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={discountForm.isActive} onChange={(event) => setDiscountForm({ ...discountForm, isActive: event.target.checked })} className="accent-emerald-700" />Rule active</label>
              <div className="flex gap-2">
                <button disabled={saving} className="inline-flex flex-1 items-center justify-center gap-2 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{saving ? "Saving…" : editingDiscountId ? "Update rule" : "Save rule"}</button>
                {editingDiscountId && <button type="button" onClick={() => { setEditingDiscountId(""); setDiscountForm({ productId: "", province: "", district: "", discountPercentage: "", isActive: true }); }} className="border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>}
              </div>
            </form>
          </section>

          <section className="border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Place-wise product rules</h2><p className="mt-0.5 text-xs text-slate-500">A rule is used only when a mapped hub has the full cart's requested stock.</p></div><span className="text-xs font-semibold text-slate-500">{discounts.length} rules</span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Location</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Discount</th><th className="px-4 py-3">State</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {discounts.map((discount) => <tr key={discount.id} className="hover:bg-slate-50/60"><td className="px-4 py-3 text-slate-700">{discount.district}<span className="block text-[10px] text-slate-400">{discount.province}</span></td><td className="px-4 py-3 font-semibold text-slate-900">{discount.product?.name || discount.productId}</td><td className="px-4 py-3 font-bold text-emerald-800">{parsePercentage(discount.discountPercentage)}%</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 ${discount.isActive ? "text-emerald-700" : "text-slate-400"}`}>{discount.isActive ? <Check size={13} /> : <Tag size={13} />}{discount.isActive ? "Active" : "Paused"}</span></td><td className="px-4 py-3 text-right"><button type="button" onClick={() => editDiscount(discount)} className="px-2 py-1 font-semibold text-slate-700 hover:text-emerald-800">Edit</button><button type="button" onClick={() => toggleDiscount(discount)} className="px-2 py-1 font-semibold text-slate-700 hover:text-rose-700">{discount.isActive ? "Disable" : "Enable"}</button></td></tr>)}
                  {!discounts.length && <tr><td colSpan="5" className="px-4 py-12 text-center text-slate-400">No location discount rules yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default LocationPricing;