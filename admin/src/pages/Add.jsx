/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import { assets } from "../assets/assets";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";

const Add = ({ token }) => {
  // Gallery images
  const [image1, setImage1] = useState(false);
  const [image2, setImage2] = useState(false);
  const [image3, setImage3] = useState(false);
  const [image4, setImage4] = useState(false);

  // Featured image selection state: { type: 'gallery' | 'variant', index: number }
  const [featuredTarget, setFeaturedTarget] = useState({ type: "gallery", index: 0 });

  const [name, setName] = useState("");
  const [nepaliName, setNepaliName] = useState("");
  const [description, setDesription] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [selectedCategories, setSelectedCategories] = useState(["Men"]);
  const [subCategory, setSubCategory] = useState("Topwear");
  const [bestseller, setBestSeller] = useState(false);
  const [newInStore, setNewInStore] = useState(false);

  // Variety builder state
  const [variants, setVariants] = useState([]); // [{ size, color, quantity: 0, imageFile: File | null, imagePreview: string | null }]
  const [variantSize, setVariantSize] = useState("S");
  const [variantColor, setVariantColor] = useState("");
  const [variantImageFile, setVariantImageFile] = useState(null);
  const [isVariantFeatured, setIsVariantFeatured] = useState(false);
  const [published, setPublished] = useState(true);

  const [customCategory, setCustomCategory] = useState("");
  const [customSubCategory, setCustomSubCategory] = useState("");
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [isCustomSubCategory, setIsCustomSubCategory] = useState(false);

  const [categoriesList, setCategoriesList] = useState([]);
  const [subCategoriesList, setSubCategoriesList] = useState([]);
  const [colorsList, setColorsList] = useState([]);

  const fetchOptions = async () => {
    try {
      const [catRes, subRes, colRes] = await Promise.all([
        axios.get(backendUrl + "/api/category/list"),
        axios.get(backendUrl + "/api/subcategory/list"),
        axios.get(backendUrl + "/api/color/list"),
      ]);
      if (catRes.data.success && catRes.data.categories.length > 0) {
        setCategoriesList(catRes.data.categories);
        setSelectedCategories((prev) => (prev.length > 0 ? prev : [catRes.data.categories[0].name]));
      }
      if (subRes.data.success && subRes.data.subCategories.length > 0) {
        setSubCategoriesList(subRes.data.subCategories);
        if (!isCustomSubCategory) {
          setSubCategory(subRes.data.subCategories[0].name);
        }
      }
      if (colRes.data.success && colRes.data.colors.length > 0) {
        setColorsList(colRes.data.colors);
        setVariantColor(colRes.data.colors[0].name);
      }
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, []);

  const toggleCategorySelection = (catName) => {
    setSelectedCategories((prev) => {
      if (prev.includes(catName)) {
        if (prev.length === 1) {
          toast.warning("Please keep at least 1 category selected.");
          return prev;
        }
        return prev.filter((c) => c !== catName);
      } else {
        return [...prev, catName];
      }
    });
  };

  const handleAddNewCategoryInline = async (e) => {
    e.preventDefault();
    const trimmed = customCategory.trim();
    if (!trimmed) return;

    try {
      const res = await axios.post(
        backendUrl + "/api/category/add",
        { name: trimmed },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(`Category "${trimmed}" added!`);
        setCategoriesList((prev) =>
          prev.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
            ? prev
            : [...prev, { id: Date.now().toString(), name: trimmed }]
        );
        setSelectedCategories((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
        setCustomCategory("");
        setIsAddingNewCategory(false);
      } else {
        toast.error(res.data.message || "Failed to add category");
      }
    } catch (err) {
      toast.error(err.message || "Failed to add category");
    }
  };

  // Add variety with optional image
  const handleAddVariety = () => {
    if (!variantColor) {
      toast.error("Please select or type a color for the variety.");
      return;
    }

    const exists = variants.some(
      (v) => v.size === variantSize && v.color.toLowerCase() === variantColor.toLowerCase()
    );
    if (exists) {
      toast.warning("This size and color variety already exists.");
      return;
    }

    const newIndex = variants.length;
    const newVariant = {
      size: variantSize,
      color: variantColor,
      quantity: 0,
      imageFile: variantImageFile,
      imagePreview: variantImageFile ? URL.createObjectURL(variantImageFile) : null,
      isFeatured: isVariantFeatured,
    };

    if (isVariantFeatured) {
      setFeaturedTarget({ type: "variant", index: newIndex });
    }

    setVariants([...variants, newVariant]);
    setVariantImageFile(null);
    setIsVariantFeatured(false);
    toast.success(`Added variety: ${variantSize} / ${variantColor}`);
  };

  // Replace or add image on existing variety
  const handleUpdateVarietyImage = (idx, file) => {
    if (!file) return;
    setVariants((prev) =>
      prev.map((v, i) =>
        i === idx
          ? {
            ...v,
            imageFile: file,
            imagePreview: URL.createObjectURL(file),
          }
          : v
      )
    );
    toast.info(`Updated image for variety ${variants[idx].size} / ${variants[idx].color}`);
  };

  const onSubmitHandler = async (e) => {
      e.preventDefault();
      if (!name.trim()) {
        toast.error("Please enter a product title.");
        return;
      }

      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        toast.error("Please enter a valid positive selling price.");
        return;
      }

      if (discount !== "" && discount !== null && discount !== undefined) {
        const numDiscount = Number(discount);
        if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
          toast.error("Discount percentage must be between 0% and 100%.");
          return;
        }
      }

      if (selectedCategories.length === 0) {
        toast.error("Please select at least one category for the product.");
        return;
      }

      try {
        let finalSubCategory = subCategory;
        if (isCustomSubCategory && customSubCategory.trim()) {
          finalSubCategory = customSubCategory.trim();
          await axios
            .post(
              backendUrl + "/api/subcategory/add",
              { name: finalSubCategory },
              { headers: { token } }
            )
            .catch(() => { });
        }

        const formData = new FormData();
        formData.append("name", name);
        formData.append("nepaliName", nepaliName);
        formData.append("description", description);
        formData.append("price", price);
        formData.append("discount", discount);
        formData.append("category", JSON.stringify(selectedCategories));
        formData.append("subCategory", finalSubCategory);
        formData.append("bestseller", bestseller);
        formData.append("newInStore", newInStore);

        const computedStockQuantity = variants.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
        formData.append("stockQuantity", computedStockQuantity);
        formData.append("lowStockThreshold", lowStockThreshold || 5);

        const allSizes = [...new Set(variants.map((v) => v.size))];
        const allColors = [...new Set(variants.map((v) => v.color))];
        formData.append("sizes", JSON.stringify(allSizes));
        formData.append("colors", JSON.stringify(allColors));

        // Build serialized variants array (metadata without binary)
        const variantsMetadata = variants.map((v, idx) => ({
          size: v.size,
          color: v.color,
          quantity: Number(v.quantity) || 0,
          isFeatured: featuredTarget.type === "variant" && featuredTarget.index === idx,
        }));
        formData.append("variants", JSON.stringify(variantsMetadata));
        formData.append("published", published);

        // Featured image info
        formData.append("featuredType", featuredTarget.type);
        formData.append("featuredIndex", featuredTarget.index);

        // Gallery Images
        if (image1) formData.append("image1", image1);
        if (image2) formData.append("image2", image2);
        if (image3) formData.append("image3", image3);
        if (image4) formData.append("image4", image4);

        // Variety Images (dynamic fields: variantImage_0, variantImage_1, ...)
        variants.forEach((v, idx) => {
          if (v.imageFile) {
            formData.append(`variantImage_${idx}`, v.imageFile);
          }
        });

        const response = await axios.post(backendUrl + "/api/product/add", formData, {
          headers: { token },
        });

        if (response.data.success) {
          toast.success(response.data.message || "Product & Varieties Added Successfully!");
          setName("");
          setNepaliName("");
          setDesription("");
          setImage1(false);
          setImage2(false);
          setImage3(false);
          setImage4(false);
          setPrice("");
          setDiscount("");
          setLowStockThreshold("5");
          setBestSeller(false);
          setNewInStore(false);
          setVariants([]);
          setVariantSize("S");
          setVariantColor(colorsList.length > 0 ? colorsList[0].name : "");
          setVariantImageFile(null);
          setIsVariantFeatured(false);
          setFeaturedTarget({ type: "gallery", index: 0 });
          setSelectedCategories(categoriesList.length > 0 ? [categoriesList[0].name] : ["Men"]);
          setCustomCategory("");
          setCustomSubCategory("");
          setIsAddingNewCategory(false);
          setIsCustomSubCategory(false);
          fetchOptions();
        } else {
          toast.error(response.data.message);
        }
      } catch (error) {
        console.log(error);
        toast.error(error.message);
      }
    };

    return (
      <form onSubmit={onSubmitHandler} className="flex flex-col w-full items-start gap-6 max-w-4xl pb-16">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Add New Garment &amp; Varieties</h1>
          <p className="text-xs text-slate-500">
            Upload variety-specific garment photos, select the primary featured cover image, and define sizing/color configurations.
          </p>
        </div>

        {/* --- SECTION 1: GENERAL GALLERY IMAGES --- */}
        <div className="w-full bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-bold text-slate-900">General Gallery Images (Optional)</p>
              <p className="text-xs text-slate-500">Upload up to 4 general showcase photos of the garment.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { img: image1, setImg: setImage1, id: "image1", idx: 0 },
              { img: image2, setImg: setImage2, id: "image2", idx: 1 },
              { img: image3, setImg: setImage3, id: "image3", idx: 2 },
              { img: image4, setImg: setImage4, id: "image4", idx: 3 },
            ].map(({ img, setImg, id, idx }) => {
              const isFeatured = featuredTarget.type === "gallery" && featuredTarget.index === idx && img;
              return (
                <div key={id} className="flex flex-col items-center gap-2 p-2 border border-slate-200 rounded-xl bg-slate-50">
                  <label htmlFor={id} className="relative cursor-pointer w-full aspect-square flex items-center justify-center bg-white rounded-lg border border-dashed border-slate-300 hover:border-slate-500 overflow-hidden group">
                    <img
                      className="w-full h-full object-cover"
                      src={!img ? assets.upload_area : URL.createObjectURL(img)}
                      alt={`Upload ${id}`}
                    />
                    <input
                      onChange={(e) => {
                        if (e.target.files[0]) {
                          setImg(e.target.files[0]);
                          if (!image1 && idx === 0) {
                            setFeaturedTarget({ type: "gallery", index: 0 });
                          }
                        }
                      }}
                      type="file"
                      id={id}
                      hidden
                    />
                    {img && (
                      <span className="absolute inset-0 bg-black/40 text-white text-[11px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        Change Photo
                      </span>
                    )}
                  </label>

                  {img && (
                    <button
                      type="button"
                      onClick={() => setFeaturedTarget({ type: "gallery", index: idx })}
                      className={`w-full py-1 px-2 rounded-lg text-[10px] font-extrabold cursor-pointer transition-all border ${isFeatured
                          ? "bg-amber-400 text-slate-900 border-amber-500 shadow-xs"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                    >
                      {isFeatured ? "★ Featured Image" : "Set as Featured"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* --- SECTION 2: PRODUCT DETAILS --- */}
        <div className="w-full bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
          <p className="text-sm font-bold text-slate-900">Garment Information</p>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Product Name *</label>
            <input
              onChange={(e) => setName(e.target.value)}
              value={name}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-slate-900"
              type="text"
              placeholder="e.g. Pure Cotton Classic Oxford Shirt"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Product Nepali Name</label>
            <input
              onChange={(e) => setNepaliName(e.target.value)}
              value={nepaliName}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-slate-900"
              type="text"
              placeholder="जस्तै: टि-शर्ट, कालो स्वेटर"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Product Description *</label>
            <textarea
              onChange={(e) => setDesription(e.target.value)}
              value={description}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm h-24 focus:outline-none focus:border-slate-900 leading-relaxed"
              placeholder="Detailed description highlighting materials, fitting, craftsmanship, and styling recommendations..."
              required
            />
          </div>

          {/* Categories Selector */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-800 text-xs">
                Product Categories (Select 1 or more)
              </label>
              <span className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                {selectedCategories.length} selected
              </span>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {categoriesList.map((item) => {
                const isSelected = selectedCategories.includes(item.name);
                return (
                  <button
                    key={item.id || item.name}
                    type="button"
                    onClick={() => toggleCategorySelection(item.name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${isSelected
                        ? "bg-slate-900 text-white border-slate-900 shadow-xs scale-[1.02]"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                  >
                    <span>{isSelected ? "✓" : "+"}</span>
                    <span>{item.name}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setIsAddingNewCategory(!isAddingNewCategory)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold border border-dashed border-indigo-400 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 cursor-pointer"
              >
                {isAddingNewCategory ? "✕ Cancel" : "+ New Category..."}
              </button>
            </div>

            {isAddingNewCategory && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Type new category name"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="border border-slate-300 px-3 py-1.5 flex-1 rounded-xl text-xs bg-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddNewCategoryInline}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Add Category
                </button>
              </div>
            )}
          </div>

          {/* Subcategory & Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Subcategory (Type)</label>
              <select
                value={isCustomSubCategory ? "ADD_NEW" : subCategory}
                onChange={(e) => {
                  if (e.target.value === "ADD_NEW") {
                    setIsCustomSubCategory(true);
                  } else {
                    setIsCustomSubCategory(false);
                    setSubCategory(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none"
              >
                {subCategoriesList.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
                <option value="ADD_NEW">+ Add New SubCategory...</option>
              </select>
              {isCustomSubCategory && (
                <input
                  type="text"
                  placeholder="Type new subcategory name"
                  value={customSubCategory}
                  onChange={(e) => setCustomSubCategory(e.target.value)}
                  className="mt-2 border border-slate-300 px-3 py-1.5 w-full rounded-xl text-xs bg-white"
                  required
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Retail Selling Price (Rs) *</label>
              <input
                onChange={(e) => setPrice(e.target.value)}
                value={price}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none"
                type="number"
                placeholder="e.g. 1500"
                min="0.01"
                step="any"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Discount (%)</label>
              <input
                onChange={(e) => setDiscount(e.target.value)}
                value={discount}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none"
                type="number"
                placeholder="0"
                min="0"
                max="100"
                step="any"
              />
            </div>
          </div>
        </div>

        {/* --- SECTION 3: PRODUCT VARIETIES & VARIETY-SPECIFIC IMAGES --- */}
        <div className="w-full bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
              <h3 className="text-sm font-bold text-slate-900">Product Varieties &amp; Variety Images</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Attach dedicated photos to each garment size &amp; color. When customers pick a variety on the storefront, the photo smoothly switches!
            </p>
          </div>

          {/* Variety Builder Form */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Add a Variety:</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Garment Size</label>
                <select
                  value={variantSize}
                  onChange={(e) => setVariantSize(e.target.value)}
                  className="w-full bg-white border border-slate-300 px-3 py-2 rounded-xl text-xs font-bold focus:outline-none"
                >
                  {["XS", "S", "M", "L", "XL", "XXL", "3XL", "Free Size"].map((sz) => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Garment Color</label>
                {colorsList.length > 0 ? (
                  <select
                    value={variantColor}
                    onChange={(e) => setVariantColor(e.target.value)}
                    className="w-full bg-white border border-slate-300 px-3 py-2 rounded-xl text-xs font-bold focus:outline-none"
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
                    value={variantColor}
                    onChange={(e) => setVariantColor(e.target.value)}
                    className="w-full bg-white border border-slate-300 px-3 py-2 rounded-xl text-xs font-bold focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Variety Image (Photo for this color/size)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setVariantImageFile(e.target.files[0] || null)}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={isVariantFeatured}
                  onChange={(e) => setIsVariantFeatured(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
                <span>★ Make this variety&apos;s photo the Primary Featured Image of the product</span>
              </label>

              <button
                type="button"
                onClick={handleAddVariety}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs"
              >
                + Add Variety
              </button>
            </div>
          </div>

          {/* List of Configured Varieties */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Configured Varieties ({variants.length})
              </p>
              {variants.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  You can assign/change the Featured Cover Image below
                </span>
              )}
            </div>

            {variants.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <p className="text-xs text-slate-400 font-medium">No specific varieties added yet.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Add size and color varieties above with their photos.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {variants.map((v, idx) => {
                  const isFeatured = featuredTarget.type === "variant" && featuredTarget.index === idx;
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${isFeatured
                          ? "bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/20"
                          : "bg-white border-slate-200 shadow-2xs"
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Variety Image Thumbnail */}
                        <label className="relative w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 cursor-pointer group">
                          <img
                            src={v.imagePreview || assets.upload_area}
                            alt={`${v.size} ${v.color}`}
                            className="w-full h-full object-cover"
                          />
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleUpdateVarietyImage(idx, e.target.files[0])}
                            hidden
                          />
                          <span className="absolute inset-0 bg-black/50 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-center p-0.5">
                            Change
                          </span>
                        </label>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900">{v.color}</span>
                            <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-extrabold rounded-md">
                              Size: {v.size}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {v.imageFile ? "✓ Variety Photo Attached" : "No Photo (Uses Gallery)"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        {v.imageFile && (
                          <button
                            type="button"
                            onClick={() => setFeaturedTarget({ type: "variant", index: idx })}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold cursor-pointer border transition-all ${isFeatured
                                ? "bg-amber-400 text-slate-900 border-amber-500 shadow-2xs"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                              }`}
                          >
                            {isFeatured ? "★ Featured Cover" : "Make Featured"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setVariants(variants.filter((_, i) => i !== idx));
                            if (featuredTarget.type === "variant" && featuredTarget.index === idx) {
                              setFeaturedTarget({ type: "gallery", index: 0 });
                            }
                          }}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* --- SECTION 4: PRODUCT STATUS FLAGS & SUBMIT --- */}
        <div className="w-full bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                onChange={() => setBestSeller((prev) => !prev)}
                checked={bestseller}
                type="checkbox"
                className="w-4 h-4 accent-slate-900 cursor-pointer"
              />
              <span className="text-xs font-bold text-slate-800">Add to Bestseller</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                onChange={() => setPublished((prev) => !prev)}
                checked={published}
                type="checkbox"
                className="w-4 h-4 accent-emerald-600 cursor-pointer"
              />
              <span className="text-xs font-bold text-emerald-700">Publish to Store Immediately</span>
            </label>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
            <input
              onChange={() => setNewInStore((prev) => !prev)}
              checked={newInStore}
              type="checkbox"
              id="newInStore"
              className="w-4 h-4 accent-amber-600 cursor-pointer shrink-0"
            />
            <label className="cursor-pointer text-xs font-bold text-amber-900" htmlFor="newInStore">
              Feature as &quot;New in Store&quot; (Hero Section)
              <span className="block text-[11px] font-normal text-amber-700">
                Checking this flags this garment on the store hero banner.
              </span>
            </label>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-black text-sm rounded-2xl cursor-pointer shadow-md transition-all active:scale-95"
            >
              CREATE GARMENT &amp; VARIETIES
            </button>
          </div>
        </div>
      </form>
    );
  };

  export default Add;

