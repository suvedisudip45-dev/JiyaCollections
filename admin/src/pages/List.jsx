/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import {
  Package,
  Eye,
  Edit3,
  Trash2,
  Layers,
  DollarSign,
  ShieldAlert,
  Check,
  Sparkles,
  Camera,
  Shirt,
  Tag,
  CheckCircle2,
  Sliders,
  RefreshCw,
} from "lucide-react";
import ProductImageCarousel from "../components/ProductImageCarousel";
import StructuredDescriptionEditor from "../components/StructuredDescriptionEditor";
import { transliterateText, parseStructuredDescription } from "../utils/transliteration";

const List = ({ token }) => {
  const [list, setList] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);

  // Edit Modal State
  const [editName, setEditName] = useState("");
  const [editNepaliName, setEditNepaliName] = useState("");
  const [isTransliteratingEditName, setIsTransliteratingEditName] = useState(false);

  // Structured description in edit modal
  const [editDescriptionSections, setEditDescriptionSections] = useState({
    about: "",
    fabricCare: "",
    sizeFit: "",
  });

  const [editPrice, setEditPrice] = useState("");
  const [editDiscount, setEditDiscount] = useState("");
  const [editCategories, setEditCategories] = useState([]);
  const [editSubCategory, setEditSubCategory] = useState("");
  const [editBestseller, setEditBestseller] = useState(false);
  const [editNewInStore, setEditNewInStore] = useState(false);
  const [editIsUnisex, setEditIsUnisex] = useState(false);
  const [editPublished, setEditPublished] = useState(true);

  // Varieties in edit modal
  const [editVariants, setEditVariants] = useState([]);
  const [editColorImages, setEditColorImages] = useState({});
  const [newVarSize, setNewVarSize] = useState("S");
  const [newVarColor, setNewVarColor] = useState("");
  const [newVarImageFile, setNewVarImageFile] = useState(null);

  // Existing and new gallery images in edit modal
  const [existingGalleryImages, setExistingGalleryImages] = useState([]);
  const [editImage1, setEditImage1] = useState(null);
  const [editImage2, setEditImage2] = useState(null);
  const [editFeaturedGalleryIndex, setEditFeaturedGalleryIndex] = useState(0);

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
    if (!window.confirm("Are you sure you want to soft-delete this product? Relational data for combo bundles & orders will be safely preserved.")) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/product/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message || "Product soft-deleted successfully");
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

  const handleAutoTransliterateEditTitle = async () => {
    if (!editName.trim()) {
      toast.info("Enter an English title first.");
      return;
    }
    setIsTransliteratingEditName(true);
    try {
      const res = await transliterateText(editName, token);
      if (res) {
        setEditNepaliName(res);
        toast.success("Nepali title transliterated!");
      }
    } finally {
      setIsTransliteratingEditName(false);
    }
  };

  const openEditModal = (product) => {
    setEditingProduct(product);
    setEditName(product.name || "");
    setEditNepaliName(product.nepaliName || "");

    // Parse structured description sections
    const parsedDesc = parseStructuredDescription(product.description);
    setEditDescriptionSections(parsedDesc);

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
    setEditIsUnisex(Boolean(product.isUnisex || product.unisex || false));
    setEditPublished(product.published !== undefined ? product.published : true);

    // Gallery images
    const rawImages = Array.isArray(product.image) ? product.image : parseArray(product.image);
    setExistingGalleryImages(rawImages);
    setEditFeaturedGalleryIndex(0);

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

    const formattedVars = existingVars.map((v) => ({
      size: v.size || "S",
      color: v.color || "Standard",
      quantity: Number(v.quantity) || 0,
      image: v.image || null,
      isFeatured: false,
    }));

    setEditVariants(formattedVars);

    const existingColorImages = parseArray(product.colorImages);
    const colorImageMap = {};
    existingColorImages.forEach((entry) => {
      if (entry?.color) {
        colorImageMap[entry.color.trim().toLowerCase()] = {
          ...entry,
          newImageFile: null,
          newImagePreview: null,
        };
      }
    });
    formattedVars.forEach((variant) => {
      const key = variant.color.trim().toLowerCase();
      if (!colorImageMap[key] && variant.image) {
        colorImageMap[key] = {
          color: variant.color,
          image: variant.image,
          newImageFile: null,
          newImagePreview: null,
        };
      }
    });
    setEditColorImages(colorImageMap);

    setNewVarSize("S");
    setNewVarColor(colorsList.length > 0 ? colorsList[0].name : "");
    setNewVarImageFile(null);
    setEditImage1(null);
    setEditImage2(null);
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

    const newV = {
      size: newVarSize,
      color: newVarColor,
      quantity: 0,
      isFeatured: false,
    };

    if (newVarImageFile) {
      const key = newVarColor.trim().toLowerCase();
      setEditColorImages((prev) => ({
        ...prev,
        [key]: {
          color: newVarColor.trim(),
          image: prev[key]?.image || null,
          newImageFile: newVarImageFile,
          newImagePreview: URL.createObjectURL(newVarImageFile),
        },
      }));
    }

    setEditVariants([...editVariants, newV]);
    setNewVarImageFile(null);
    toast.success(`Added variety: ${newVarSize} / ${newVarColor}`);
  };

  const handleRemoveEditVariety = (idx) => {
    const target = editVariants[idx];
    const updated = editVariants.filter((_, i) => i !== idx);
    setEditVariants(updated);

    const stillHasColor = updated.some(
      (v) => v.color.toLowerCase() === target.color.toLowerCase()
    );
    if (!stillHasColor) {
      const map = { ...editColorImages };
      delete map[target.color.toLowerCase()];
      setEditColorImages(map);
    }
  };

  const saveEditHandler = async (e) => {
    e.preventDefault();
    if (editCategories.length === 0) {
      toast.error("Please select at least 1 category");
      return;
    }

    try {
      const serializedDescription = JSON.stringify({
        about: editDescriptionSections.about.trim(),
        fabricCare: editDescriptionSections.fabricCare.trim(),
        sizeFit: editDescriptionSections.sizeFit.trim(),
      });

      const formData = new FormData();
      formData.append("id", editingProduct._id || editingProduct.id);
      formData.append("name", editName);
      formData.append("nepaliName", editNepaliName);
      formData.append("description", serializedDescription);
      formData.append("price", editPrice);
      formData.append("discount", editDiscount);
      formData.append("category", JSON.stringify(editCategories));
      formData.append("subCategory", editSubCategory);
      formData.append("bestseller", editBestseller);
      formData.append("newInStore", editNewInStore);
      formData.append("isUnisex", editIsUnisex);
      formData.append("published", editPublished);

      const allSizes = [...new Set(editVariants.map((v) => v.size))];
      const allColors = [...new Set(editVariants.map((v) => v.color))];
      formData.append("sizes", JSON.stringify(allSizes));
      formData.append("colors", JSON.stringify(allColors));

      // Existing gallery images retained
      formData.append("existingImages", JSON.stringify(existingGalleryImages));

      // Build serialized variants array
      const variantsMetadata = editVariants.map((v) => ({
        size: v.size,
        color: v.color,
        quantity: Number(v.quantity) || 0,
        image: v.image || null,
        isFeatured: false,
      }));
      formData.append("variants", JSON.stringify(variantsMetadata));

      const colorImagesMetadata = Object.values(editColorImages).map((entry, index) => ({
        color: entry.color,
        image: entry.image || null,
        fileIndex: entry.newImageFile ? index : undefined,
      }));
      formData.append("colorImages", JSON.stringify(colorImagesMetadata));
      Object.values(editColorImages).forEach((entry, index) => {
        if (entry.newImageFile) formData.append(`colorImage_${index}`, entry.newImageFile);
      });

      // Cover image strictly from gallery
      formData.append("featuredType", "gallery");
      formData.append("featuredIndex", editFeaturedGalleryIndex);

      if (editImage1) formData.append("image1", editImage1);
      if (editImage2) formData.append("image2", editImage2);

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
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Catalog Management</h1>
          <p className="text-xs text-slate-500">
            Define styles, pricing, unisex discovery, and <strong>Subcategory Best Sellers ⭐</strong>.
          </p>
        </div>
        <button
          onClick={fetchList}
          className="text-xs font-bold bg-white border border-slate-200 px-3.5 py-2 rounded-xl text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Catalog</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <input
            type="text"
            placeholder="Search by title, Nepali name or subcategory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs w-full sm:w-64 focus:outline-none focus:border-slate-900 focus:bg-white"
          />

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {categoriesList.map((c) => (
              <option key={c.id || c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={filterSubCategory}
            onChange={(e) => setFilterSubCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Subcategories</option>
            {subCategoriesList.map((s) => (
              <option key={s.id || s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={filterBestseller}
            onChange={(e) => setFilterBestseller(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">All Best Seller Status</option>
            <option value="bestseller">⭐ Best Sellers Only</option>
            <option value="standard">Standard Products</option>
          </select>
        </div>

        {(searchQuery || filterCategory !== "all" || filterSubCategory !== "all" || filterBestseller !== "all") && (
          <button
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

      {/* Product Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Garment Showcase</th>
                <th className="py-3 px-4">Categories</th>
                <th className="py-3 px-4">Subcategory Best Seller</th>
                <th className="py-3 px-4">Retail Price</th>
                <th className="py-3 px-4">Varieties</th>
                <th className="py-3 px-4 text-center">Hub Stock</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="font-semibold text-sm">No products found matching filters.</p>
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
                    <tr
                      key={item._id || item.id || index}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !item.published ? "bg-slate-50/50 opacity-80" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <ProductImageCarousel images={productImages} alt={item.name} />
                          <div>
                            <p className="font-bold text-slate-900">{item.name}</p>
                            {item.nepaliName && (
                              <p className="text-[11px] text-slate-500 font-normal">{item.nepaliName}</p>
                            )}
                            <span className="text-[10px] text-slate-400">
                              Sub: {item.subCategory || "General"}
                            </span>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {item.newInStore && (
                                <span className="text-[9px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-md font-bold">
                                  New In Store
                                </span>
                              )}
                              {item.bestseller && (
                                <span className="text-[9px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-md font-bold">
                                  Best Seller ⭐
                                </span>
                              )}
                              {Boolean(item.isUnisex || item.unisex) && (
                                <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded-md font-bold">
                                  Unisex ⚧
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
                              className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Best Seller interactive toggle */}
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => toggleBestsellerHandler(item._id || item.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            item.bestseller
                              ? "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200"
                          }`}
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
                            <span className="line-through text-[10px] text-slate-400">
                              {currency}{item.price}
                            </span>
                          </div>
                        ) : (
                          <span className="font-bold text-slate-900">
                            {currency}{item.price}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-[11px] text-slate-600 space-y-0.5">
                          <p><strong className="text-slate-800">Sizes:</strong> {sizes.join(", ") || "None"}</p>
                          {colors.length > 0 && (
                            <p className="text-slate-500">
                              <strong>Colors:</strong> {colors.map((c) => (typeof c === "object" ? c.name : c)).join(", ")}
                            </p>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isOutOfStock
                              ? "bg-rose-100 text-rose-800"
                              : isLowStock
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {item.stockQuantity || 0} units
                        </span>
                      </td>

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

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(item)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer transition-all shadow-2xs flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => removeProduct(item._id || item.id)}
                            className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer transition-all"
                            title="Soft delete product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- EDIT PRODUCT MODAL --- */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex justify-center items-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Edit Garment &amp; Structured Details
                </h3>
                <p className="text-xs text-slate-500">
                  Refine textile specs, Nepali title, unisex settings, and gallery cover photo.
                </p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={saveEditHandler} className="flex flex-col gap-4 text-xs">
              {/* Product Titles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-bold text-slate-700">Garment Title (English) *</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-semibold focus:outline-none focus:border-slate-900 focus:bg-white"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-bold text-slate-700">Nepali Title</label>
                    <button
                      type="button"
                      disabled={isTransliteratingEditName || !editName.trim()}
                      onClick={handleAutoTransliterateEditTitle}
                      className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{isTransliteratingEditName ? "Translating..." : "Auto-Transliterate"}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editNepaliName}
                    onChange={(e) => setEditNepaliName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-semibold focus:outline-none focus:border-slate-900 focus:bg-white"
                    placeholder="जस्तै: कालो हुडी"
                  />
                </div>
              </div>

              {/* Structured Description Component */}
              <StructuredDescriptionEditor
                values={editDescriptionSections}
                onChange={setEditDescriptionSections}
                token={token}
              />

              {/* Pricing */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-bold text-slate-700">Selling Price ({currency}) *</label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-bold focus:outline-none focus:border-slate-900 focus:bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1 font-bold text-slate-700">Discount Percentage (%)</label>
                  <input
                    type="number"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 font-bold focus:outline-none focus:border-slate-900 focus:bg-white"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              {/* Categories & Unisex */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Categories */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-slate-700">Categories</label>
                    <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full">
                      {editCategories.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
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
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-slate-900 text-white border-slate-900"
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

                {/* Subcategory & Unisex Toggle */}
                <div className="space-y-3">
                  <div>
                    <label className="block mb-1 font-bold text-slate-700">Sub Category</label>
                    <input
                      type="text"
                      value={editSubCategory}
                      onChange={(e) => setEditSubCategory(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white"
                      required
                    />
                  </div>

                  <label className="flex items-center gap-2 p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editIsUnisex}
                      onChange={(e) => setEditIsUnisex(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <div>
                      <span className="font-bold text-slate-900">Unisex Product</span>
                      <p className="text-[10px] text-slate-500">Displays unisex badge &amp; includes in universal searches.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Gallery Cover Selection */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <label className="font-bold text-slate-900">Gallery Cover Photo</label>
                <div className="flex flex-wrap gap-2">
                  {existingGalleryImages.map((imgUrl, idx) => {
                    const isCover = editFeaturedGalleryIndex === idx;
                    return (
                      <div
                        key={idx}
                        onClick={() => setEditFeaturedGalleryIndex(idx)}
                        className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all p-0.5 ${
                          isCover ? "border-amber-500 ring-2 ring-amber-400/40 bg-amber-50" : "border-slate-200"
                        }`}
                      >
                        <img src={imgUrl} alt="Gallery" className="w-16 h-16 object-cover rounded-lg" />
                        {isCover && (
                          <span className="absolute bottom-0 inset-x-0 bg-amber-500 text-slate-900 text-[9px] font-black text-center py-0.5">
                            ★ COVER
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Variety Builder */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-900">Garment Varieties</label>
                  <span className="text-[10px] text-slate-400">Color photos are tied to variants</span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
                  <select
                    value={newVarSize}
                    onChange={(e) => setNewVarSize(e.target.value)}
                    className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold"
                  >
                    {["XS", "S", "M", "L", "XL", "XXL", "3XL", "Free Size"].map((sz) => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>

                  <select
                    value={newVarColor}
                    onChange={(e) => setNewVarColor(e.target.value)}
                    className="bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold"
                  >
                    <option value="">-- Color --</option>
                    {colorsList.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleAddNewEditVariety}
                    className="bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 cursor-pointer"
                  >
                    + Add Variety
                  </button>
                </div>

                {/* Varieties List */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {editVariants.map((v, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-white rounded-xl border border-slate-200 flex items-center justify-between"
                    >
                      <span className="font-bold text-slate-800">
                        {v.size} / {v.color}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEditVariety(idx)}
                        className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit / Cancel Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save Product Updates</span>
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
