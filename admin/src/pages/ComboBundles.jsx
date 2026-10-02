/* eslint-disable no-unused-vars */
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const emptyForm = {
  categoryId: "",
  name: "",
  slug: "",
  description: "",
  status: "ACTIVE",
  image: "",
  bannerImage: "",
  calculatedPrice: "",
  sellingPrice: "",
  discountPercentage: "0",
  manualPriceOverride: false,
  priceReviewRequired: false,
};

const productHasCategory = (product, categoryName) => {
  if (!categoryName) return false;
  let categoryNames = Array.isArray(product.categories) ? product.categories : product.category;
  if (typeof categoryNames === "string") {
    try {
      categoryNames = JSON.parse(categoryNames);
    } catch {
      categoryNames = categoryNames.split(",");
    }
  }
  if (!Array.isArray(categoryNames)) categoryNames = [];
  return categoryNames.some(
    (name) => String(name).trim().toLowerCase() === categoryName.trim().toLowerCase()
  );
};

const parseList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

const getProductColorOptions = (product) => {
  const variants = parseList(product.variants);
  const colors = variants.length > 0
    ? variants
      .filter((variant) => Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0)) > 0)
      .map((variant) => variant.color)
    : Number(product.stockQuantity || 0) > 0
      ? parseList(product.colors).map((item) => item?.name || item)
      : [];
  return [...new Map(colors.map((color) => String(color || "").trim()).filter(Boolean).map((color) => [color.toLowerCase(), color])).values()];
};

const getProductSizes = (product, selectedColor = "") => {
  let variants = product.variants;
  if (typeof variants === "string") {
    try { variants = JSON.parse(variants); } catch { variants = []; }
  }
  if (Array.isArray(variants) && variants.length > 0) {
    return new Set(variants
      .filter((variant) => String(variant.size || "").trim() && Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0)) > 0 && (!selectedColor || String(variant.color || "").trim().toLowerCase() === selectedColor.toLowerCase()))
      .map((variant) => String(variant.size || "").trim().toLowerCase()));
  }

  if (Number(product.stockQuantity || 0) <= 0) return new Set();
  const sizes = parseList(product.sizes).map((item) => String(item?.name || item).trim().toLowerCase());
  return new Set(sizes);
};

const getSharedVariantCount = (products, selectedColors) => {
  if (products.length === 0) return 0;
  const sizeSets = products.map((product) => getProductSizes(product, selectedColors[product.id] || ""));
  return [...sizeSets[0]].filter((size) => sizeSets.every((sizes) => sizes.has(size))).length;
};

const ComboBundles = ({ token }) => {
  const [comboBundles, setComboBundles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [selectedColors, setSelectedColors] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bannerImageFile, setBannerImageFile] = useState(null);
  const [comboBundleImageFiles, setComboBundleImageFiles] = useState([]);

  const fetchComboBundles = async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/combo-bundles`, {
          headers: token ? { token } : {}
      });
      if (response.data.success) {
        setComboBundles(response.data.comboBundles || []);
      } else {
          toast.error(response.data.message || "Unable to load combo bundles");
      }
    } catch (error) {
      console.error(error);
        toast.error(error.message || "Unable to load combo bundles");
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/product/list?admin=true`, { headers: { token } });
      if (response.data.success) {
        setProducts(response.data.products || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/category/list`);
      if (response.data.success) setCategories(response.data.categories || []);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Unable to load categories");
    }
  };

  useEffect(() => {
    fetchComboBundles();
    fetchProducts();
    fetchCategories();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setSelectedProductIds([]);
    setSelectedColors({});
    setEditingId(null);
    setBannerImageFile(null);
    setComboBundleImageFiles([]);
  };

  const handleProductToggle = (productId) => {
    if (selectedProductIds.includes(productId)) {
      setSelectedProductIds((current) => current.filter((id) => id !== productId));
      setSelectedColors((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });
      return;
    }

    const product = products.find((entry) => entry.id === productId);
    const firstAvailableColor = product ? getProductColorOptions(product)[0] || "" : "";
    setSelectedProductIds((current) => [...current, productId]);
    setSelectedColors((current) => ({ ...current, [productId]: current[productId] || firstAvailableColor }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
        toast.warning("Combo bundle name is required");
      return;
    }
    const missingColors = selectedProducts.filter((product) => !selectedColors[product.id] || !getProductColorOptions(product).some((color) => color.toLowerCase() === selectedColors[product.id].toLowerCase()));
    if (missingColors.length > 0) {
      toast.warning(`Choose an available color for: ${missingColors.map((product) => product.name).join(", ")}`);
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      const payload = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        slug: form.slug.trim() || form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        productIds: JSON.stringify(selectedProductIds),
        productColors: JSON.stringify(selectedColors),
        calculatedPrice: form.calculatedPrice === "" ? 0 : Number(form.calculatedPrice),
        sellingPrice: form.sellingPrice === "" ? 0 : Number(form.sellingPrice),
        discountPercentage: form.discountPercentage === "" ? 0 : Number(form.discountPercentage),
        manualPriceOverride: Boolean(form.manualPriceOverride),
        priceReviewRequired: Boolean(form.priceReviewRequired),
      };

      Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        formData.append(key, String(value));
      });

      if (editingId) formData.append("id", editingId);
      if (bannerImageFile) formData.append("bannerImage", bannerImageFile);
      comboBundleImageFiles.forEach((file) => formData.append("images", file));

      const endpoint = editingId
        ? `${backendUrl}/api/combo-bundles/${encodeURIComponent(editingId)}`
        : `${backendUrl}/api/combo-bundles`;
      const response = editingId
        ? await axios.put(endpoint, formData, { headers: { token, "Content-Type": "multipart/form-data" } })
        : await axios.post(endpoint, formData, { headers: { token, "Content-Type": "multipart/form-data" } });

      if (response.data.success) {
        toast.success(response.data.message || "Combo bundle saved");
        resetForm();
        fetchComboBundles();
      } else {
        toast.error(response.data.message || "Unable to save combo bundle");
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to save combo bundle");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (comboBundle) => {
    setEditingId(comboBundle.id);
    setForm({
      categoryId: comboBundle.categoryId || "",
      name: comboBundle.name || "",
      slug: comboBundle.slug || "",
      description: comboBundle.description || "",
      status: comboBundle.status || "ACTIVE",
      image: Array.isArray(comboBundle.image) ? comboBundle.image.join(",") : (comboBundle.image || ""),
      bannerImage: comboBundle.bannerImage || "",
      calculatedPrice: String(comboBundle.calculatedPrice ?? 0),
      sellingPrice: String(comboBundle.sellingPrice ?? 0),
      discountPercentage: String(comboBundle.discountPercentage ?? 0),
      manualPriceOverride: Boolean(comboBundle.manualPriceOverride),
      priceReviewRequired: Boolean(comboBundle.priceReviewRequired),
    });
    setBannerImageFile(null);
    setComboBundleImageFiles([]);
    setSelectedProductIds(comboBundle.products?.map((item) => item.productId) || []);
    setSelectedColors(Object.fromEntries((comboBundle.products || []).map((item) => {
      const product = products.find((entry) => entry.id === item.productId) || item.product;
      return [item.productId, item.selectedColor || (product ? getProductColorOptions(product)[0] || "" : "")];
    })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const categoryProducts = selectedCategory
    ? products.filter((product) => productHasCategory(product, selectedCategory.name))
    : [];
  const selectedProductsPrice = categoryProducts
    .filter((product) => selectedProductIds.includes(product.id))
    .reduce((total, product) => total + Math.round(Number(product.price || 0) * (1 - Number(product.discount || 0) / 100)), 0);
  const selectedProducts = categoryProducts.filter((product) => selectedProductIds.includes(product.id));
  const sharedVariantCount = getSharedVariantCount(selectedProducts, selectedColors);

  const handleDelete = async (comboBundle) => {
    if (!window.confirm(`Delete combo bundle "${comboBundle.name}"?`)) return;

    try {
      const response = await axios.delete(
        `${backendUrl}/api/combo-bundles/${encodeURIComponent(comboBundle.id)}`,
        { headers: { token } }
      );

      if (response.data.success) {
        toast.success(response.data.message || "Combo bundle removed");
        if (editingId === comboBundle.id) resetForm();
        fetchComboBundles();
      } else {
        toast.error(response.data.message || "Unable to delete combo bundle");
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to delete combo bundle");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Catalog</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Combo Bundles</h1>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
          {comboBundles.length} total combo bundle{comboBundles.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              {editingId ? "Edit combo bundle" : "Create combo bundle"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Category
                <select
                  required
                  value={form.categoryId}
                  onChange={(event) => {
                    setForm({ ...form, categoryId: event.target.value });
                    setSelectedProductIds([]);
                    setSelectedColors({});
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                >
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Combo bundle name
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                  placeholder="Summer Edit"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Slug
                <input
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                  placeholder="summer-edit"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Description
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                  placeholder="Bundle description"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Bundle images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => setComboBundleImageFiles(Array.from(event.target.files || []))}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
                <span className="mt-1 block text-[11px] text-slate-500">Upload one or more bundle images.</span>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Banner image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setBannerImageFile(event.target.files?.[0] || null)}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
                <span className="mt-1 block text-[11px] text-slate-500">Use a single banner image for the bundle.</span>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Calculated Price
                <input
                  type="number"
                  value={selectedProductIds.length ? selectedProductsPrice : (form.calculatedPrice || 0)}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Bundle discount (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.discountPercentage}
                  onChange={(event) => setForm({ ...form, discountPercentage: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Manual bundle price
                <input
                  type="number"
                  min="0"
                  value={form.sellingPrice}
                  onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })}
                  disabled={!form.manualPriceOverride}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="Uses calculated price minus bundle discount"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.manualPriceOverride}
                  onChange={(event) => setForm({ ...form, manualPriceOverride: event.target.checked })}
                />
                Manual price override
              </label>

              <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.priceReviewRequired}
                  onChange={(event) => setForm({ ...form, priceReviewRequired: event.target.checked })}
                />
                Price review required
              </label>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-800">Assigned products</h3>
                <span className="text-xs font-medium text-slate-500">{selectedProductIds.length} selected</span>
              </div>
              {selectedProducts.length > 0 && (
                <p className={`mb-3 text-xs ${sharedVariantCount > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {sharedVariantCount > 0
                    ? `${sharedVariantCount} shared in-stock size option${sharedVariantCount === 1 ? "" : "s"} available across all included products.`
                    : "No shared in-stock sizes. Customers cannot purchase this bundle until every included product has a size in stock."}
                </p>
              )}

              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {!selectedCategory ? (
                  <p className="text-sm text-slate-500">Choose a category to view eligible products.</p>
                ) : categoryProducts.length === 0 ? (
                  <p className="text-sm text-slate-500">No products in {selectedCategory.name} are available yet.</p>
                ) : (
                  categoryProducts.map((product) => {
                    const isSelected = selectedProductIds.includes(product.id);
                    const colorOptions = getProductColorOptions(product);
                    return (
                      <div key={product.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700">
                        <div className="flex items-center justify-between gap-3">
                          <label className="flex min-w-0 cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleProductToggle(product.id)}
                              className="h-4 w-4 rounded border-slate-400"
                            />
                            <span className="truncate font-medium">{product.name}</span>
                          </label>
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">{selectedCategory.name}</span>
                        </div>
                        {isSelected && (
                          <label className="mt-2 block text-xs font-medium text-slate-600">
                            Color for {product.name}
                            <select
                              value={selectedColors[product.id] || ""}
                              onChange={(event) => setSelectedColors((current) => ({ ...current, [product.id]: event.target.value }))}
                              disabled={colorOptions.length === 0}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-900 disabled:bg-slate-100"
                            >
                              {colorOptions.length === 0 ? <option value="">No colors in stock</option> : colorOptions.map((color) => <option key={color} value={color}>{color}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : editingId ? "Update bundle" : "Create bundle"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Saved combo bundles</h2>
          <div className="space-y-3">
            {comboBundles.length === 0 ? (
              <p className="text-sm text-slate-500">No combo bundles yet.</p>
            ) : (
              comboBundles.map((comboBundle) => (
                <div key={comboBundle.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{comboBundle.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${comboBundle.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                          {comboBundle.status || "ACTIVE"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">/{comboBundle.slug}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{comboBundle.category?.name || "No category"}</p>
                      <p className="mt-2 text-xs text-slate-600">{comboBundle.productCount ?? comboBundle.products?.length ?? 0} products</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(comboBundle)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(comboBundle)}
                        className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ComboBundles;
