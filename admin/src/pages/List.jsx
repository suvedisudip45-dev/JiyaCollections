/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import { Package, Eye, Edit3, Trash2, Layers, DollarSign, ShieldAlert, Check } from "lucide-react";
import ProductImageCarousel from "../components/ProductImageCarousel";

const List = ({ token }) => {
  const [list, setList] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);

  // Edit Modal State
  const [editName, setEditName] = useState("");
  const [editNepaliName, setEditNepaliName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDiscount, setEditDiscount] = useState("");
  const [editCategories, setEditCategories] = useState([]);
  const [editSubCategory, setEditSubCategory] = useState("");
  const [editBestseller, setEditBestseller] = useState(false);
  const [editNewInStore, setEditNewInStore] = useState(false);
  const [editPublished, setEditPublished] = useState(true);
  
  // Varieties in edit modal: [{ size, color, quantity, image, isFeatured, newImageFile, newImagePreview }]
  const [editVariants, setEditVariants] = useState([]);
  const [newVarSize, setNewVarSize] = useState("S");
  const [newVarColor, setNewVarColor] = useState("");
  const [newVarImageFile, setNewVarImageFile] = useState(null);
  const [newVarFeatured, setNewVarFeatured] = useState(false);
  const [editFeaturedTarget, setEditFeaturedTarget] = useState({ type: "variant", index: 0 });

  const [editImage1, setEditImage1] = useState(null);

  // Color options
  const [colorsList, setColorsList] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [subCategoriesList, setSubCategoriesList] = useState([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSubCategory, setFilterSubCategory] = useState("all");
  const [filterBestseller, setFilterBestseller] = useState("all");

  const fetchList = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/product/list", {
        headers: { token },
      });
      if (response.data.success) {
        setList(response.data.products || []);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const toggleBestsellerHandler = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/product/toggle-bestseller",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setList((prev) =>
          prev.map((p) => ((p._id || p.id) === id ? { ...p, bestseller: response.data.bestseller } : p))
        );
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const removeProduct = async (id) => {
    if (!window.confirm("Are you sure you want to delete this product? All hub inventories for this product will also be archived.")) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/product/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        await fetchList();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const togglePublishHandler = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/product/toggle-publish",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchList();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const parseArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch {}
      }
      return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  };

  const openEditModal = (product) => {
    setEditingProduct(product);
    setEditName(product.name || "");
    setEditNepaliName(product.nepaliName || "");
    setEditDescription(product.description || "");
    setEditPrice(product.price || "");
    setEditDiscount(product.discount || 0);

    const cats =
      product.categories && product.categories.length > 0
        ? product.categories
        : parseArray(product.category);
    setEditCategories(cats.length > 0 ? cats : ["Men"]);

    setEditSubCategory(product.subCategory || "");
    setEditBestseller(product.bestseller || false);
    setEditNewInStore(product.newInStore || false);
    setEditPublished(product.published !== undefined ? product.published : true);

    // Parse existing variants
    let existingVars = [];
    if (typeof product.variants === "string") {
      try {
        existingVars = JSON.parse(product.variants || "[]");
      } catch (e) {
        existingVars = [];
      }
    } else if (Array.isArray(product.variants)) {
      existingVars = product.variants;
    }

    const formattedVars = existingVars.map((v, idx) => ({
      size: v.size || "S",
      color: v.color || "Standard",
      quantity: Number(v.quantity) || 0,
      image: v.image || null,
      isFeatured: Boolean(v.isFeatured),
      newImageFile: null,
      newImagePreview: null,
    }));

    setEditVariants(formattedVars);

    // Determine initial featured index
    const featIdx = formattedVars.findIndex((v) => v.isFeatured);
    if (featIdx >= 0) {
      setEditFeaturedTarget({ type: "variant", index: featIdx });
    } else {
      setEditFeaturedTarget({ type: "gallery", index: 0 });
    }

    setNewVarSize("S");
    setNewVarColor(colorsList.length > 0 ? colorsList[0].name : "");
    setNewVarImageFile(null);
    setNewVarFeatured(false);
    setEditImage1(null);
  };

  const handleAddNewEditVariety = () => {
    if (!newVarColor) {
      toast.error("Please select or enter a color for the variety.");
      return;
    }

    const exists = editVariants.some(
      (v) => v.size === newVarSize && v.color.toLowerCase() === newVarColor.toLowerCase()
    );
    if (exists) {
      toast.warning("This size and color variety already exists.");
      return;
    }

    const newIdx = editVariants.length;
    const newV = {
      size: newVarSize,
      color: newVarColor,
      quantity: 0,
      image: null,
      isFeatured: newVarFeatured,
      newImageFile: newVarImageFile,
      newImagePreview: newVarImageFile ? URL.createObjectURL(newVarImageFile) : null,
    };

    if (newVarFeatured) {
      setEditFeaturedTarget({ type: "variant", index: newIdx });
    }

    setEditVariants([...editVariants, newV]);
    setNewVarImageFile(null);
    setNewVarFeatured(false);
    toast.success(`Added variety: ${newVarSize} / ${newVarColor}`);
  };

  const handleUpdateEditVarietyImage = (idx, file) => {
    if (!file) return;
    setEditVariants((prev) =>
      prev.map((v, i) =>
        i === idx
          ? {
              ...v,
              newImageFile: file,
              newImagePreview: URL.createObjectURL(file),
            }
          : v
      )
    );
    toast.info(`Updated photo for variety ${editVariants[idx].size} / ${editVariants[idx].color}`);
  };

  const saveEditHandler = async (e) => {
    e.preventDefault();
    if (editCategories.length === 0) {
      toast.error("Please select at least 1 category");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("id", editingProduct._id || editingProduct.id);
      formData.append("name", editName);
      formData.append("nepaliName", editNepaliName);
      formData.append("description", editDescription);
      formData.append("price", editPrice);
      formData.append("discount", editDiscount);
      formData.append("category", JSON.stringify(editCategories));
      formData.append("subCategory", editSubCategory);
      formData.append("bestseller", editBestseller);
      formData.append("newInStore", editNewInStore);
      formData.append("published", editPublished);

      const allSizes = [...new Set(editVariants.map((v) => v.size))];
      const allColors = [...new Set(editVariants.map((v) => v.color))];
      formData.append("sizes", JSON.stringify(allSizes));
      formData.append("colors", JSON.stringify(allColors));

      // Build serialized variants array
      const variantsMetadata = editVariants.map((v, idx) => ({
        size: v.size,
        color: v.color,
        quantity: Number(v.quantity) || 0,
        image: v.image || null,
        isFeatured: editFeaturedTarget.type === "variant" && editFeaturedTarget.index === idx,
      }));
      formData.append("variants", JSON.stringify(variantsMetadata));

      formData.append("featuredType", editFeaturedTarget.type);
      formData.append("featuredIndex", editFeaturedTarget.index);

      // Append new variety images
      editVariants.forEach((v, idx) => {
        if (v.newImageFile) {
          formData.append(`variantImage_${idx}`, v.newImageFile);
        }
      });

      if (editImage1) {
        formData.append("image1", editImage1);
      }

      const response = await axios.post(
        backendUrl + "/api/product/update",
        formData,
        { headers: { token } }
      );

      if (response.data.success) {
        toast.success(response.data.message || "Product & Varieties updated!");
        setEditingProduct(null);
        fetchList();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const fetchColorsAndCategories = async () => {
    try {
      const [colRes, catRes, subRes] = await Promise.all([
        axios.get(backendUrl + "/api/color/list"),
        axios.get(backendUrl + "/api/category/list"),
        axios.get(backendUrl + "/api/subcategory/list"),
      ]);
      if (colRes.data.success && colRes.data.colors.length > 0) {
        setColorsList(colRes.data.colors);
      }
      if (catRes.data.success && catRes.data.categories.length > 0) {
        setCategoriesList(catRes.data.categories);
      }
      if (subRes.data.success && subRes.data.subCategories.length > 0) {
        setSubCategoriesList(subRes.data.subCategories);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    fetchList();
    fetchColorsAndCategories();
  }, []);

  const filteredList = list.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.subCategory && item.subCategory.toLowerCase().includes(q)) ||
      (item.nepaliName && item.nepaliName.toLowerCase().includes(q));

    const itemCats = item.categories && item.categories.length > 0 ? item.categories : parseArray(item.category);
    const matchCategory =
      filterCategory === "all" ||
      itemCats.some((c) => c.toLowerCase() === filterCategory.toLowerCase());

    const matchSubCategory =
      filterSubCategory === "all" ||
      (item.subCategory && item.subCategory.toLowerCase() === filterSubCategory.toLowerCase());

    const matchBestseller =
      filterBestseller === "all" ||
      (filterBestseller === "bestseller" ? item.bestseller : !item.bestseller);

    return matchSearch && matchCategory && matchSubCategory && matchBestseller;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Catalog Management</h1>
          <p className="text-xs text-slate-500">
            Define garment styles, retail pricing, subcategories, and <strong>Subcategory Best Sellers ⭐</strong>.
          </p>
        </div>
        <button
          onClick={fetchList}
          className="text-xs font-semibold bg-white border border-slate-200 px-3.5 py-2 rounded-xl text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          Refresh Catalog
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search products by name / subcategory..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-medium focus:outline-none focus:border-indigo-500 flex-1 min-w-[200px]"
        />

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 outline-none"
        >
          <option value="all">All Categories</option>
          {categoriesList.map((cat) => (
            <option key={cat.id} value={cat.name}>{cat.name}</option>
          ))}
        </select>

        <select
          value={filterSubCategory}
          onChange={(e) => setFilterSubCategory(e.target.value)}
          className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 outline-none"
        >
          <option value="all">All Subcategories</option>
          {subCategoriesList.map((sub) => (
            <option key={sub.id} value={sub.name}>
              {sub.name} {sub.category?.name ? `(${sub.category.name})` : ""}
            </option>
          ))}
        </select>

        <select
          value={filterBestseller}
          onChange={(e) => setFilterBestseller(e.target.value)}
          className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 outline-none"
        >
          <option value="all">All Items</option>
          <option value="bestseller">⭐ Subcategory Best Sellers</option>
          <option value="standard">Standard Items</option>
        </select>

        {(searchQuery || filterCategory !== "all" || filterSubCategory !== "all" || filterBestseller !== "all") && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilterCategory("all");
              setFilterSubCategory("all");
              setFilterBestseller("all");
            }}
            className="text-xs text-rose-600 font-bold hover:underline"
          >
            Reset Filters
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Garment</th>
                <th className="py-3 px-4">Categories</th>
                <th className="py-3 px-4">Subcategory Best Seller</th>
                <th className="py-3 px-4">Retail Price</th>
                <th className="py-3 px-4">Varieties (Admin Locked)</th>
                <th className="py-3 px-4 text-center">Hub Network Stock</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="font-semibold text-sm">No products found matching filters.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Try adjusting your search query or category filters.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredList.map((item, index) => {
                  const sizes = parseArray(item.sizes);
                  const colors = parseArray(item.colors);
                  const isOutOfStock = (item.stockQuantity || 0) <= 0;
                  const isLowStock = (item.stockQuantity || 0) <= 5 && !isOutOfStock;
                  const productImages = Array.isArray(item.image) ? item.image : [item.image];

                  return (
                    <tr key={index} className={`hover:bg-slate-50/80 transition-colors ${!item.published ? "bg-slate-50/50" : ""}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <ProductImageCarousel images={productImages} alt={item.name} />
                        <div>
                          <p className="font-bold text-slate-900">{item.name}</p>
                          <span className="text-[10px] text-slate-400">Sub: {item.subCategory || "General"}</span>
                          <div className="flex gap-1 mt-0.5">
                            {item.newInStore && (
                              <span className="text-[9px] bg-amber-100 text-amber-900 px-1 py-0.2 rounded font-bold">
                                New In Store
                              </span>
                            )}
                            {item.bestseller && (
                              <span className="text-[9px] bg-yellow-100 text-yellow-800 px-1 py-0.2 rounded font-bold">
                                Best Seller ⭐
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {(item.categories && item.categories.length > 0
                          ? item.categories
                          : parseArray(item.category)
                        ).map((cat, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Subcategory Best Seller Interactive Toggle */}
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => toggleBestsellerHandler(item._id || item.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                          item.bestseller
                            ? "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200"
                        }`}
                        title={`Toggle Best Seller for ${item.subCategory || "subcategory"}`}
                      >
                        <span>{item.bestseller ? "⭐ Best Seller" : "☆ Set Best Seller"}</span>
                      </button>
                    </td>

                    <td className="py-3 px-4">
                      {item.discount > 0 ? (
                        <div>
                          <span className="font-bold text-rose-600">
                            {currency}{Math.round(item.price * (1 - item.discount / 100))}
                          </span>{" "}
                          <span className="line-through text-[10px] text-slate-400">{currency}{item.price}</span>
                        </div>
                      ) : (
                        <span className="font-bold text-slate-900">{currency}{item.price}</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-[11px] text-slate-600 space-y-0.5">
                        <p><strong className="text-slate-800">Sizes:</strong> {sizes.join(", ") || "None"}</p>
                        {colors.length > 0 && (
                          <p className="text-slate-500">
                            <strong>Colors:</strong> {colors.map(c => typeof c === 'object' ? c.name : c).join(", ")}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Network Hub Stock (Decentralized, read-only) */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          isOutOfStock
                            ? "bg-rose-100 text-rose-800"
                            : isLowStock
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {item.stockQuantity || 0} units
                      </span>
                      <p className="text-[9px] text-slate-400 mt-0.5">Managed by Hubs</p>
                    </td>

                    {/* Publishing Status */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => togglePublishHandler(item._id || item.id)}
                        className={`text-[11px] px-2.5 py-1 rounded-full font-bold cursor-pointer transition-colors ${
                          item.published
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                            : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                        }`}
                      >
                        {item.published ? "Live" : "Draft"}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEditModal(item)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer shadow-2xs"
                        >
                          Edit Varieties
                        </button>
                        <button
                          onClick={() => removeProduct(item._id || item.id)}
                          className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>


      {/* --- EDIT PRODUCT MODAL (Admin defines varieties & pricing) --- */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex justify-center items-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-4">
            <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">Edit Garment Varieties &amp; Selling Details</h3>
                <p className="text-xs text-slate-500">Configure size &amp; color specifications. Physical inventory count is updated by manufacturers.</p>
              </div>
              <button onClick={() => setEditingProduct(null)} className="text-slate-400 hover:text-slate-600 text-sm font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={saveEditHandler} className="flex flex-col gap-4 text-xs">
              <div>
                <label className="block mb-1 font-bold text-slate-700">Garment / Product Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-medium focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block mb-1 font-bold text-slate-700">Nepali Product Name</label>
                <input
                  type="text"
                  value={editNepaliName}
                  onChange={(e) => setEditNepaliName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-medium focus:outline-none focus:border-indigo-500"
                  placeholder="जस्तै: कालो टी-शर्ट"
                />
              </div>

              <div>
                <label className="block mb-1 font-bold text-slate-700">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-medium h-20 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-bold text-slate-700">Store Selling Price ({currency})</label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-bold focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1 font-bold text-slate-700">Discount Percentage (%)</label>
                  <input
                    type="number"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-bold focus:outline-none focus:border-indigo-500"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              {/* Multi-category Selector */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-700">Categories (Target Segments)</label>
                  <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full">
                    {editCategories.length} selected
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categoriesList.map((c) => {
                    const isSelected = editCategories.includes(c.name);
                    return (
                      <button
                        key={c.id || c.name}
                        type="button"
                        onClick={() => {
                          setEditCategories((prev) =>
                            prev.includes(c.name)
                              ? prev.length === 1
                                ? prev
                                : prev.filter((x) => x !== c.name)
                              : [...prev, c.name]
                          );
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                          isSelected
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {isSelected ? "✓ " : "+ "}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block mb-1 font-bold text-slate-700">Sub Category (Garment Type)</label>
                <input
                  type="text"
                  value={editSubCategory}
                  onChange={(e) => setEditSubCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              {/* VARIETIES & VARIETY IMAGES MANAGEMENT IN EDIT MODAL */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <label className="font-bold text-slate-900 text-xs">Garment Varieties &amp; Photos</label>
                    <p className="text-[10px] text-slate-500">Configure size/color varieties, upload photos, and select the featured cover image.</p>
                  </div>
                </div>

                {/* Quick Add Variety in Edit Modal */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                  <p className="text-[10px] font-bold text-slate-700 uppercase">Add New Variety:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Size</label>
                      <select
                        value={newVarSize}
                        onChange={(e) => setNewVarSize(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                      >
                        {["XS", "S", "M", "L", "XL", "XXL", "3XL", "Free Size"].map((sz) => (
                          <option key={sz} value={sz}>{sz}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Color</label>
                      {colorsList.length > 0 ? (
                        <select
                          value={newVarColor}
                          onChange={(e) => setNewVarColor(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                        >
                          <option value="">-- Choose Color --</option>
                          {colorsList.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="e.g. Navy Blue"
                          value={newVarColor}
                          onChange={(e) => setNewVarColor(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs"
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Variety Photo</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setNewVarImageFile(e.target.files[0] || null)}
                        className="w-full text-[10px] text-slate-500 file:mr-1 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-slate-900 file:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={newVarFeatured}
                        onChange={(e) => setNewVarFeatured(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-500 rounded"
                      />
                      <span>Make this variety the Featured Cover</span>
                    </label>

                    <button
                      type="button"
                      onClick={handleAddNewEditVariety}
                      className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 cursor-pointer"
                    >
                      + Add Variety
                    </button>
                  </div>
                </div>

                {/* List of Edit Varieties */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {editVariants.map((v, idx) => {
                    const isFeatured = editFeaturedTarget.type === "variant" && editFeaturedTarget.index === idx;
                    const displayImg = v.newImagePreview || v.image;

                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                          isFeatured
                            ? "bg-amber-50 border-amber-300 ring-1 ring-amber-400/30"
                            : "bg-white border-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Thumbnail / Upload */}
                          <label className="relative w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0 cursor-pointer group">
                            <img
                              src={displayImg || assets.upload_area}
                              alt={`${v.size} ${v.color}`}
                              className="w-full h-full object-cover"
                            />
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleUpdateEditVarietyImage(idx, e.target.files[0])}
                              hidden
                            />
                            <span className="absolute inset-0 bg-black/60 text-white text-[8px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-center p-0.5">
                              Change
                            </span>
                          </label>

                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-xs">{v.color}</span>
                              <span className="px-1.5 py-0.2 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold rounded">
                                Size: {v.size}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              {displayImg ? "✓ Photo Set" : "No photo (uses gallery)"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {displayImg && (
                            <button
                              type="button"
                              onClick={() => setEditFeaturedTarget({ type: "variant", index: idx })}
                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer border ${
                                isFeatured
                                  ? "bg-amber-400 text-slate-900 border-amber-500 shadow-2xs"
                                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              {isFeatured ? "★ Featured" : "Set Featured"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditVariants(editVariants.filter((_, i) => i !== idx));
                              if (editFeaturedTarget.type === "variant" && editFeaturedTarget.index === idx) {
                                setEditFeaturedTarget({ type: "gallery", index: 0 });
                              }
                            }}
                            className="text-rose-500 hover:text-rose-700 font-black text-sm cursor-pointer px-1"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Publishing & Feature toggles */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editBestseller"
                    checked={editBestseller}
                    onChange={(e) => setEditBestseller(e.target.checked)}
                    className="cursor-pointer accent-amber-500 w-4 h-4"
                  />
                  <label htmlFor="editBestseller" className="cursor-pointer font-bold text-slate-800 text-xs">
                    ⭐ Subcategory Best Seller <span className="text-slate-400 font-normal">({editSubCategory || "Subcategory"})</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editNewInStore"
                    checked={editNewInStore}
                    onChange={(e) => setEditNewInStore(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <label htmlFor="editNewInStore" className="cursor-pointer font-bold text-amber-800">
                    New in Store Flag
                  </label>
                </div>
              </div>

              <div>
                <label className="block mb-1 font-bold text-slate-700">Replace Primary Image (Optional)</label>
                <input
                  type="file"
                  onChange={(e) => setEditImage1(e.target.files[0])}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 cursor-pointer shadow-xs"
                >
                  Save Varieties &amp; Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default List;
