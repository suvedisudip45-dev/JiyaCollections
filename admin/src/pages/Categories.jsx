/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import { Star, Sparkles, SlidersHorizontal, Eye, Edit, Trash2 } from "lucide-react";

const Categories = ({ token }) => {
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [colors, setColors] = useState([]);

  // Category Add Form
  const [newCategory, setNewCategory] = useState("");

  // SubCategory Add Form
  const [newSubCategory, setNewSubCategory] = useState("");
  const [newSubCategoryDescription, setNewSubCategoryDescription] = useState("");
  const [newSubCategoryCategoryId, setNewSubCategoryCategoryId] = useState("");
  const [newSubCategoryImage, setNewSubCategoryImage] = useState(null);
  const [newSubCategoryImagePreview, setNewSubCategoryImagePreview] = useState("");
  const [submittingSubCategory, setSubmittingSubCategory] = useState(false);

  // SubCategory Filter & Search
  const [selectedCategoryTab, setSelectedCategoryTab] = useState("all");
  const [subCategorySearch, setSubCategorySearch] = useState("");

  // SubCategory Edit Modal State
  const [editingSubCategory, setEditingSubCategory] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState("");
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [updatingSubCategory, setUpdatingSubCategory] = useState(false);

  // SubCategory Bestseller Modal State
  const [bestsellerModalSub, setBestsellerModalSub] = useState(null);
  const [subcategoryProducts, setSubcategoryProducts] = useState([]);
  const [loadingSubProducts, setLoadingSubProducts] = useState(false);

  // Colors Form
  const [newColor, setNewColor] = useState("");
  const [newColorNepali, setNewColorNepali] = useState("");

  const fetchCategories = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/category/list");
      if (response.data.success) {
        setCategories(response.data.categories || []);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const fetchSubCategories = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/subcategory/list");
      if (response.data.success) {
        setSubCategories(response.data.subCategories || []);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const fetchColors = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/color/list");
      if (response.data.success) {
        setColors(response.data.colors || []);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Add Category Handler
  const addCategoryHandler = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/category/add",
        { name: newCategory.trim() },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setNewCategory("");
        fetchCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Remove Category Handler
  const removeCategoryHandler = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete category "${name}"?`)) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/category/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchCategories();
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Image Selection for Add SubCategory
  const handleNewImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewSubCategoryImage(file);
      setNewSubCategoryImagePreview(URL.createObjectURL(file));
    }
  };

  const clearNewImage = () => {
    setNewSubCategoryImage(null);
    setNewSubCategoryImagePreview("");
  };

  // Add SubCategory Handler
  const addSubCategoryHandler = async (e) => {
    e.preventDefault();
    if (!newSubCategory.trim()) {
      toast.warning("Subcategory name is required");
      return;
    }

    setSubmittingSubCategory(true);
    try {
      const formData = new FormData();
      formData.append("name", newSubCategory.trim());
      formData.append("description", newSubCategoryDescription.trim());
      if (newSubCategoryCategoryId) {
        formData.append("categoryId", newSubCategoryCategoryId);
      }
      if (newSubCategoryImage) {
        formData.append("image", newSubCategoryImage);
      }

      const response = await axios.post(backendUrl + "/api/subcategory/add", formData, {
        headers: { token, "Content-Type": "multipart/form-data" },
      });

      if (response.data.success) {
        toast.success(response.data.message);
        setNewSubCategory("");
        setNewSubCategoryDescription("");
        setNewSubCategoryCategoryId("");
        clearNewImage();
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    } finally {
      setSubmittingSubCategory(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (item) => {
    setEditingSubCategory(item);
    setEditName(item.name || "");
    setEditCategoryId(item.categoryId || "");
    setEditDescription(item.description || "");
    setEditImageFile(null);
    setEditImagePreview(item.image || "");
    setRemoveExistingImage(false);
  };

  const closeEditModal = () => {
    setEditingSubCategory(null);
    setEditName("");
    setEditCategoryId("");
    setEditDescription("");
    setEditImageFile(null);
    setEditImagePreview("");
    setRemoveExistingImage(false);
  };

  const handleEditImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditImageFile(file);
      setEditImagePreview(URL.createObjectURL(file));
      setRemoveExistingImage(false);
    }
  };

  const handleRemoveEditImage = () => {
    setEditImageFile(null);
    setEditImagePreview("");
    setRemoveExistingImage(true);
  };

  // Save Edit SubCategory
  const updateSubCategoryHandler = async (e) => {
    e.preventDefault();
    if (!editingSubCategory || !editName.trim()) {
      toast.warning("Subcategory name is required");
      return;
    }

    setUpdatingSubCategory(true);
    try {
      const formData = new FormData();
      formData.append("id", editingSubCategory.id);
      formData.append("name", editName.trim());
      formData.append("categoryId", editCategoryId || "");
      formData.append("description", editDescription.trim());
      formData.append("removeImage", removeExistingImage ? "true" : "false");

      if (editImageFile) {
        formData.append("image", editImageFile);
      }

      const response = await axios.post(backendUrl + "/api/subcategory/update", formData, {
        headers: { token, "Content-Type": "multipart/form-data" },
      });

      if (response.data.success) {
        toast.success(response.data.message || "Subcategory updated successfully");
        closeEditModal();
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    } finally {
      setUpdatingSubCategory(false);
    }
  };

  // Open Bestseller Manager Modal for a specific Subcategory
  const openBestsellerModal = async (sub) => {
    setBestsellerModalSub(sub);
    setLoadingSubProducts(true);
    try {
      const params = new URLSearchParams();
      if (sub.category?.name) params.set("category", sub.category.name);
      params.set("subcategory", sub.name);
      params.set("admin", "true");

      const response = await axios.get(`${backendUrl}/api/product/list?${params.toString()}`, {
        headers: { token },
      });
      if (response.data.success) {
        setSubcategoryProducts(response.data.products || []);
      } else {
        setSubcategoryProducts([]);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load products for subcategory");
      setSubcategoryProducts([]);
    } finally {
      setLoadingSubProducts(false);
    }
  };

  const closeBestsellerModal = () => {
    setBestsellerModalSub(null);
    setSubcategoryProducts([]);
    fetchSubCategories();
  };

  // Toggle Bestseller status for a product in this subcategory
  const handleToggleProductBestseller = async (productId) => {
    try {
      const response = await axios.post(
        `${backendUrl}/api/product/toggle-bestseller`,
        { id: productId },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setSubcategoryProducts((prev) =>
          prev.map((p) => (p._id === productId ? { ...p, bestseller: response.data.bestseller } : p))
        );
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to toggle best seller status");
    }
  };

  // Remove SubCategory Handler
  const removeSubCategoryHandler = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete subcategory "${name}"?`)) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/subcategory/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Add Color Handler
  const addColorHandler = async (e) => {
    e.preventDefault();
    if (!newColor.trim()) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/color/add",
        { name: newColor.trim(), nepaliName: newColorNepali.trim() },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setNewColor("");
        setNewColorNepali("");
        fetchColors();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  // Remove Color Handler
  const removeColorHandler = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete color "${name}"?`)) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/color/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchColors();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchSubCategories();
    fetchColors();
  }, []);

  // Filtered Subcategories
  const filteredSubCategories = subCategories.filter((sub) => {
    const matchCategory =
      selectedCategoryTab === "all" ||
      (selectedCategoryTab === "uncategorized"
        ? !sub.categoryId
        : sub.categoryId === selectedCategoryTab ||
          sub.category?.name?.toLowerCase() === selectedCategoryTab.toLowerCase());

    const matchSearch =
      !subCategorySearch.trim() ||
      sub.name.toLowerCase().includes(subCategorySearch.toLowerCase()) ||
      (sub.description && sub.description.toLowerCase().includes(subCategorySearch.toLowerCase())) ||
      (sub.category?.name && sub.category.name.toLowerCase().includes(subCategorySearch.toLowerCase()));

    return matchCategory && matchSearch;
  });

  return (
    <div className="flex flex-col gap-8 w-full max-w-[1150px] pb-16">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Categories & Subcategories Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure categories, subcategories with custom feature banner images, descriptions, and <strong>Subcategory Best Sellers ⭐</strong>.
        </p>
      </div>

      {/* --- SUBCATEGORIES SECTION (MAIN FEATURE) --- */}
      <div className="border border-gray-200 p-6 rounded-xl bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-gray-100 gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span>🖼️</span> Subcategories & Curated Best Sellers
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage feature images, descriptions, and best-selling items for every subcategory under each category.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full w-fit">
            {subCategories.length} Total Subcategories
          </span>
        </div>

        {/* Add Subcategory Form */}
        <form onSubmit={addSubCategoryHandler} className="bg-gray-50/70 p-5 rounded-lg border border-gray-200 mb-8">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-4">Add New Subcategory</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Subcategory / Type Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Tanks Women, Bottomwear, Cargo Pants"
                value={newSubCategory}
                onChange={(e) => setNewSubCategory(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm focus:ring-1 focus:ring-black outline-none bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Category</label>
              <select
                value={newSubCategoryCategoryId}
                onChange={(e) => setNewSubCategoryCategoryId(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm focus:ring-1 focus:ring-black outline-none bg-white"
              >
                <option value="">No Parent (All / Global)</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Subcategory Description (Shown below banner on storefront)
              </label>
              <textarea
                value={newSubCategoryDescription}
                onChange={(e) => setNewSubCategoryDescription(e.target.value)}
                placeholder="e.g. Stay cool and confident with our relaxed fit tanks and breathable streetwear essentials..."
                className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm focus:ring-1 focus:ring-black outline-none bg-white"
                rows="2"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Feature Hero Banner Image
              </label>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <label className="cursor-pointer border border-dashed border-gray-300 bg-white hover:bg-gray-50 px-4 py-2.5 rounded-md text-xs font-medium text-gray-700 flex items-center gap-2 shadow-sm">
                  <span>📁</span> Choose Feature Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleNewImageChange}
                    className="hidden"
                  />
                </label>
                {newSubCategoryImagePreview && (
                  <div className="flex items-center gap-3">
                    <img
                      src={newSubCategoryImagePreview}
                      alt="Preview"
                      className="w-20 h-12 object-cover rounded border border-gray-300 shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={clearNewImage}
                      className="text-xs text-red-600 hover:text-red-800 font-medium"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={submittingSubCategory}
              className="bg-black text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {submittingSubCategory ? "Adding..." : "Add Subcategory"}
            </button>
          </div>
        </form>

        {/* Subcategories Category Filter Tabs & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategoryTab("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                selectedCategoryTab === "all"
                  ? "bg-black text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              All ({subCategories.length})
            </button>
            {categories.map((cat) => {
              const count = subCategories.filter(
                (s) => s.categoryId === cat.id || s.category?.name?.toLowerCase() === cat.name.toLowerCase()
              ).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryTab(cat.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                    selectedCategoryTab === cat.id
                      ? "bg-black text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>

          <input
            type="text"
            placeholder="Search subcategories..."
            value={subCategorySearch}
            onChange={(e) => setSubCategorySearch(e.target.value)}
            className="border border-gray-300 px-3 py-1.5 rounded text-xs outline-none focus:ring-1 focus:ring-black w-full sm:w-48 bg-white"
          />
        </div>

        {/* Subcategories Table / Grid */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[80px_1.8fr_1.2fr_1.5fr_2fr_180px] bg-gray-100 px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-700 border-b">
            <span>Banner</span>
            <span>Subcategory</span>
            <span>Category</span>
            <span>Best Sellers</span>
            <span>Description</span>
            <span className="text-right">Actions</span>
          </div>

          {filteredSubCategories.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No subcategories found for the selected filter.
            </div>
          ) : (
            filteredSubCategories.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[80px_1.8fr_1.2fr_1.5fr_2fr_180px] items-center px-4 py-3 text-sm border-b last:border-b-0 hover:bg-gray-50 transition-colors"
              >
                <div>
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-14 h-10 object-cover rounded border border-gray-200 shadow-sm"
                    />
                  ) : (
                    <div className="w-14 h-10 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                      No Image
                    </div>
                  )}
                </div>
                <div>
                  <span className="font-semibold text-gray-900 block">{item.name}</span>
                  <span className="text-[11px] text-gray-500">{item.productCount ?? 0} Products</span>
                </div>
                <div>
                  {item.category?.name ? (
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-200">
                      {item.category.name}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Global / All</span>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => openBestsellerModal(item)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 transition-colors"
                    title="Manage Best Sellers for this Subcategory"
                  >
                    <Star size={13} className="text-amber-500 fill-amber-500" />
                    <span>{item.bestsellerCount ?? 0} Best Sellers</span>
                  </button>
                </div>
                <div className="text-xs text-gray-600 line-clamp-2 pr-3">
                  {item.description || <span className="text-gray-400 italic">No description</span>}
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="text-xs font-semibold px-2.5 py-1 bg-gray-100 hover:bg-black hover:text-white rounded text-gray-800 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSubCategoryHandler(item.id, item.name)}
                    className="text-xs font-semibold px-2.5 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- CATEGORIES SECTION --- */}
      <div className="border border-gray-200 p-6 rounded-xl bg-white shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Product Categories</h2>
        <form onSubmit={addCategoryHandler} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Add new category (e.g. Men, Women, Kids)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="border border-gray-300 px-3 py-2 rounded-md flex-1 max-w-[400px] text-sm outline-none focus:ring-1 focus:ring-black bg-white"
            required
          />
          <button
            type="submit"
            className="bg-black text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Add Category
          </button>
        </form>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[3fr_1fr] bg-gray-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-700 border-b">
            <span>Category Name</span>
            <span className="text-right">Action</span>
          </div>
          {categories.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No categories found.</p>
          ) : (
            categories.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[3fr_1fr] items-center px-4 py-2.5 text-sm border-b last:border-b-0 hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{item.name}</span>
                <div className="text-right">
                  <button
                    onClick={() => removeCategoryHandler(item.id, item.name)}
                    className="text-xs font-semibold text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- COLORS SECTION --- */}
      <div className="border border-gray-200 p-6 rounded-xl bg-white shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Product Colors</h2>
        <form onSubmit={addColorHandler} className="flex flex-wrap gap-3 mb-6">
          <input
            type="text"
            placeholder="Add new color (e.g. Black, Olive)"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="border border-gray-300 px-3 py-2 rounded-md flex-1 min-w-[200px] max-w-[260px] text-sm outline-none focus:ring-1 focus:ring-black bg-white"
            required
          />
          <input
            type="text"
            placeholder="Nepali name (e.g. कालो)"
            value={newColorNepali}
            onChange={(e) => setNewColorNepali(e.target.value)}
            className="border border-gray-300 px-3 py-2 rounded-md flex-1 min-w-[200px] max-w-[260px] text-sm outline-none focus:ring-1 focus:ring-black bg-white"
          />
          <button
            type="submit"
            className="bg-black text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Add Color
          </button>
        </form>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[3fr_1fr] bg-gray-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-700 border-b">
            <span>Color Name</span>
            <span className="text-right">Action</span>
          </div>
          {colors.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No colors found.</p>
          ) : (
            colors.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[3fr_1fr] items-center px-4 py-2.5 text-sm border-b last:border-b-0 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border border-gray-300 inline-block shadow-inner"
                    style={{ backgroundColor: item.name.toLowerCase() }}
                  />
                  <span className="font-medium text-gray-900">{item.name}</span>
                  {item.nepaliName && <span className="text-xs text-gray-400">({item.nepaliName})</span>}
                </span>
                <div className="text-right">
                  <button
                    onClick={() => removeColorHandler(item.id, item.name)}
                    className="text-xs font-semibold text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- SUBCATEGORY BEST SELLERS CURATOR MODAL --- */}
      {bestsellerModalSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-amber-50/60">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Star className="text-amber-500 fill-amber-500" size={18} />
                  <span>Curate Best Sellers: {bestsellerModalSub.name}</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Parent Category: <span className="font-semibold text-gray-700">{bestsellerModalSub.category?.name || "Global"}</span> • Click the star to mark products as Best Seller in this subcategory.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBestsellerModal}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none p-1"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {loadingSubProducts ? (
                <div className="py-12 text-center text-sm text-gray-500 animate-pulse">
                  Loading products for {bestsellerModalSub.name}...
                </div>
              ) : subcategoryProducts.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-semibold text-gray-700">No products found for this subcategory yet.</p>
                  <p className="text-xs text-gray-500 mt-1">Add products under &quot;{bestsellerModalSub.name}&quot; from the Add Product page.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-500 pb-2 border-b">
                    <span>Product Details</span>
                    <span>Best Seller Toggle</span>
                  </div>
                  {subcategoryProducts.map((p) => (
                    <div
                      key={p._id || p.id}
                      className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                        p.bestseller
                          ? "bg-amber-50/50 border-amber-300 shadow-xs"
                          : "bg-white border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {p.image && p.image[0] ? (
                          <img
                            src={p.image[0]}
                            alt={p.name}
                            className="w-12 h-12 object-cover rounded border border-gray-200"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">
                            No Img
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-bold text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-500">
                            Rs {p.price} • Stock: {p.stockQuantity ?? 0}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleProductBestseller(p._id || p.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                          p.bestseller
                            ? "bg-amber-500 text-white shadow-sm hover:bg-amber-600"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        <Star size={14} className={p.bestseller ? "fill-white" : ""} />
                        <span>{p.bestseller ? "Best Seller ⭐" : "Mark as Best Seller"}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={closeBestsellerModal}
                className="bg-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- EDIT SUBCATEGORY MODAL --- */}
      {editingSubCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-base font-bold text-gray-900">
                Edit Subcategory: <span className="text-black">{editingSubCategory.name}</span>
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={updateSubCategoryHandler} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Subcategory Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm outline-none focus:ring-1 focus:ring-black bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Parent Category</label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm outline-none focus:ring-1 focus:ring-black bg-white"
                >
                  <option value="">No Parent (All / Global)</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Subcategory Description (Shown below hero banner)
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Enter a description for this subcategory..."
                  className="w-full border border-gray-300 px-3 py-2 rounded-md text-sm outline-none focus:ring-1 focus:ring-black bg-white"
                  rows="3"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Feature Hero Banner Image
                </label>
                <div className="space-y-3">
                  {editImagePreview ? (
                    <div className="relative rounded-lg overflow-hidden border border-gray-200 group w-full h-36 bg-gray-100">
                      <img
                        src={editImagePreview}
                        alt="Banner Preview"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="cursor-pointer bg-white text-black px-3 py-1.5 rounded text-xs font-semibold shadow hover:bg-gray-100">
                          Replace Image
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleEditImageChange}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleRemoveEditImage}
                          className="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-semibold shadow hover:bg-red-700"
                        >
                          Remove Image
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer border-2 border-dashed border-gray-300 hover:border-black rounded-lg p-6 flex flex-col items-center justify-center bg-gray-50 text-center transition-colors">
                      <span className="text-2xl mb-1">📁</span>
                      <span className="text-xs font-semibold text-gray-700">Upload Feature Hero Banner Image</span>
                      <span className="text-[11px] text-gray-400 mt-1">Recommended: 1600x600 px or high resolution photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleEditImageChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingSubCategory}
                  className="px-5 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {updatingSubCategory ? "Saving Changes..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Categories;
