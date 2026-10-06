/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import { assets } from "../assets/assets";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import {
  Sparkles,
  Camera,
  Layers,
  DollarSign,
  Tag,
  Palette,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sliders,
  Eye,
  Trash2,
} from "lucide-react";
import StructuredDescriptionEditor from "../components/StructuredDescriptionEditor";
import { transliterateText } from "../utils/transliteration";

const Add = ({ token }) => {
  // Gallery images (up to 8 gallery images supported)
  const [image1, setImage1] = useState(false);
  const [image2, setImage2] = useState(false);
  const [image3, setImage3] = useState(false);
  const [image4, setImage4] = useState(false);
  const [image5, setImage5] = useState(false);
  const [image6, setImage6] = useState(false);

  // Featured image selection state: index of the gallery image selected as Cover
  const [featuredGalleryIndex, setFeaturedGalleryIndex] = useState(0);

  const [name, setName] = useState("");
  const [nepaliName, setNepaliName] = useState("");
  const [isTransliteratingName, setIsTransliteratingName] = useState(false);

  // Structured Description
  const [descriptionSections, setDescriptionSections] = useState({
    about: "",
    fabricCare: "",
    sizeFit: "",
  });

  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [selectedCategories, setSelectedCategories] = useState(["Men"]);
  const [subCategory, setSubCategory] = useState("Topwear");
  const [bestseller, setBestSeller] = useState(false);
  const [newInStore, setNewInStore] = useState(false);
  const [showInNavigation, setShowInNavigation] = useState(false);
  const [isUnisex, setIsUnisex] = useState(false);

  // Variety builder state
  const [variants, setVariants] = useState([]); // [{ size, color, quantity: 0 }]
  const [colorImageFiles, setColorImageFiles] = useState({}); // { normalizedColor: { color, file, preview } }
  const [variantSize, setVariantSize] = useState("S");
  const [variantColor, setVariantColor] = useState("");
  const [variantImageFile, setVariantImageFile] = useState(null);
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

  // Live transliteration for Product Title
  const handleAutoTransliterateTitle = async () => {
    if (!name.trim()) {
      toast.info("Type a product title in English first.");
      return;
    }
    setIsTransliteratingName(true);
    try {
      const transliterated = await transliterateText(name, token);
      if (transliterated) {
        setNepaliName(transliterated);
        toast.success("Nepali title transliterated!");
      }
    } finally {
      setIsTransliteratingName(false);
    }
  };

  // Add a size/color stock variant and optionally set its shared color image
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

    const colorKey = variantColor.trim().toLowerCase();
    if (variantImageFile) {
      setColorImageFiles((prev) => ({
        ...prev,
        [colorKey]: {
          color: variantColor.trim(),
          file: variantImageFile,
          preview: URL.createObjectURL(variantImageFile),
        },
      }));
    }

    const newVariant = {
      size: variantSize,
      color: variantColor,
      quantity: 0,
      isFeatured: false,
    };

    setVariants([...variants, newVariant]);
    setVariantImageFile(null);
    toast.success(`Added variety: ${variantSize} / ${variantColor}`);
  };

  const handleRemoveVariety = (index) => {
    const target = variants[index];
    const newVariants = variants.filter((_, i) => i !== index);
    setVariants(newVariants);

    // If no more variants use this color, remove the color image
    const remainingWithColor = newVariants.some(
      (v) => v.color.toLowerCase() === target.color.toLowerCase()
    );
    if (!remainingWithColor) {
      const newColorImages = { ...colorImageFiles };
      delete newColorImages[target.color.toLowerCase()];
      setColorImageFiles(newColorImages);
    }
  };

  const handleUpdateVarietyStock = (index, qty) => {
    const val = Math.max(0, parseInt(qty, 10) || 0);
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, quantity: val } : v))
    );
  };

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a product title.");
      return;
    }

    // Merchandising Rule 1: Compulsory at least one gallery image
    const galleryFiles = [image1, image2, image3, image4, image5, image6].filter(Boolean);
    if (galleryFiles.length === 0) {
      toast.error("At least ONE gallery photo is strictly required as the Cover image.");
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
          .catch(() => {});
      }

      // Serialize structured description
      const serializedDescription = JSON.stringify({
        about: descriptionSections.about.trim(),
        fabricCare: descriptionSections.fabricCare.trim(),
        sizeFit: descriptionSections.sizeFit.trim(),
      });

      const formData = new FormData();
      formData.append("name", name);
      formData.append("nepaliName", nepaliName);
      formData.append("description", serializedDescription);
      formData.append("price", price);
      formData.append("discount", discount);
      formData.append("category", JSON.stringify(selectedCategories));
      formData.append("subCategory", finalSubCategory);
      formData.append("bestseller", bestseller);
      formData.append("newInStore", newInStore);
      formData.append("showInNavigation", showInNavigation);
      formData.append("isUnisex", isUnisex);

      const computedStockQuantity = variants.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
      formData.append("stockQuantity", computedStockQuantity);
      formData.append("lowStockThreshold", lowStockThreshold || 5);

      const allSizes = [...new Set(variants.map((v) => v.size))];
      const allColors = [...new Set(variants.map((v) => v.color))];
      formData.append("sizes", JSON.stringify(allSizes));
      formData.append("colors", JSON.stringify(allColors));

      // Build serialized variants array
      const variantsMetadata = variants.map((v) => ({
        size: v.size,
        color: v.color,
        quantity: Number(v.quantity) || 0,
        isFeatured: false,
      }));
      formData.append("variants", JSON.stringify(variantsMetadata));

      // Color Images
      const colorImagesMetadata = Object.values(colorImageFiles).map((entry, index) => ({
        color: entry.color,
        fileIndex: index,
      }));
      formData.append("colorImages", JSON.stringify(colorImagesMetadata));
      Object.values(colorImageFiles).forEach((entry, index) => {
        formData.append(`colorImage_${index}`, entry.file);
      });

      formData.append("published", published);

      // Merchandising Rules: Cover is strictly from gallery
      formData.append("featuredType", "gallery");
      formData.append("featuredIndex", featuredGalleryIndex);

      // Gallery Images
      if (image1) formData.append("image1", image1);
      if (image2) formData.append("image2", image2);
      if (image3) formData.append("image3", image3);
      if (image4) formData.append("image4", image4);
      if (image5) formData.append("image5", image5);
      if (image6) formData.append("image6", image6);

      const response = await axios.post(backendUrl + "/api/product/add", formData, {
        headers: { token },
      });

      if (response.data.success) {
        toast.success(response.data.message || "Product & Varieties Added Successfully!");
        setName("");
        setNepaliName("");
        setDescriptionSections({ about: "", fabricCare: "", sizeFit: "" });
        setImage1(false);
        setImage2(false);
        setImage3(false);
        setImage4(false);
        setImage5(false);
        setImage6(false);
        setPrice("");
        setDiscount("");
        setLowStockThreshold("5");
        setBestSeller(false);
        setNewInStore(false);
        setShowInNavigation(false);
        setIsUnisex(false);
        setVariants([]);
        setColorImageFiles({});
        setVariantSize("S");
        setVariantColor(colorsList.length > 0 ? colorsList[0].name : "");
        setVariantImageFile(null);
        setFeaturedGalleryIndex(0);
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

  const galleryInputs = [
    { img: image1, setImg: setImage1, id: "image1", idx: 0 },
    { img: image2, setImg: setImage2, id: "image2", idx: 1 },
    { img: image3, setImg: setImage3, id: "image3", idx: 2 },
    { img: image4, setImg: setImage4, id: "image4", idx: 3 },
    { img: image5, setImg: setImage5, id: "image5", idx: 4 },
    { img: image6, setImg: setImage6, id: "image6", idx: 5 },
  ];

  return (
    <form onSubmit={onSubmitHandler} className="flex flex-col w-full items-start gap-6 max-w-4xl pb-16">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-6 bg-slate-900 rounded-full"></span>
          <h1 className="text-xl font-bold text-slate-900">Add New Garment &amp; Merchandising</h1>
        </div>
        <p className="text-xs text-slate-500">
          Enforce visual standards, structured textile details, and unisex storefront discovery.
        </p>
      </div>

      {/* --- SECTION 1: GALLERY & COVER MERCHANDISING RULES --- */}
      <div className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">Product Showcase Gallery</h3>
              <span className="text-[10px] bg-amber-100 text-amber-900 font-extrabold px-2 py-0.5 rounded-md">
                1 Cover Image Required *
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload high-resolution photography. Click &quot;Set as Cover&quot; to choose the hero storefront display photo.
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>MIME &amp; Magic-Byte Protected</span>
          </div>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {galleryInputs.map(({ img, setImg, id, idx }) => {
            const isFeatured = featuredGalleryIndex === idx && img;

            return (
              <div
                key={id}
                className={`relative flex flex-col items-center gap-2 p-2 rounded-2xl border transition-all ${
                  isFeatured
                    ? "bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/30"
                    : "bg-slate-50 border-slate-200 hover:border-slate-300"
                }`}
              >
                <label
                  htmlFor={id}
                  className="relative cursor-pointer w-full aspect-square flex items-center justify-center bg-white rounded-xl border border-dashed border-slate-300 hover:border-slate-500 overflow-hidden group"
                >
                  <img
                    className="w-full h-full object-cover"
                    src={!img ? assets.upload_area : URL.createObjectURL(img)}
                    alt={`Upload slot ${idx + 1}`}
                  />
                  <input
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        setImg(e.target.files[0]);
                        // If this is the first image uploaded, auto-set as cover
                        if (!image1 && idx === 0) {
                          setFeaturedGalleryIndex(0);
                        }
                      }
                    }}
                    type="file"
                    id={id}
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                  />
                  {img && (
                    <span className="absolute inset-0 bg-black/40 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      Replace
                    </span>
                  )}
                </label>

                {img ? (
                  <button
                    type="button"
                    onClick={() => setFeaturedGalleryIndex(idx)}
                    className={`w-full py-1 px-1.5 rounded-lg text-[10px] font-extrabold cursor-pointer transition-all border ${
                      isFeatured
                        ? "bg-amber-400 text-slate-900 border-amber-500 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {isFeatured ? "★ COVER IMAGE" : "Set as Cover"}
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">
                    Slot {idx + 1} {idx === 0 ? "(Required)" : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-3 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-900 leading-relaxed">
            <strong>Merchandising Rule:</strong> The Cover Image is strictly chosen from the main gallery slots above. Color-option images in the variety builder cannot override the cover image.
          </p>
        </div>
      </div>

      {/* --- SECTION 2: BASIC DETAILS & AUTO-TRANSLITERATION --- */}
      <div className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Tag className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">Garment Identity &amp; Translation</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Product Title (English) *
            </label>
            <input
              onChange={(e) => setName(e.target.value)}
              value={name}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              type="text"
              placeholder="e.g. Classic Organic Cotton Hoodie"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Product Title (Nepali Unicode)
              </label>
              <button
                type="button"
                disabled={isTransliteratingName || !name.trim()}
                onClick={handleAutoTransliterateTitle}
                className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isTransliteratingName ? "Translating..." : "Auto-Transliterate"}</span>
              </button>
            </div>
            <input
              onChange={(e) => setNepaliName(e.target.value)}
              value={nepaliName}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              type="text"
              placeholder="जस्तै: क्लासिक अर्गानिक कटन हुडी"
            />
          </div>
        </div>

        {/* Structured Description Component */}
        <StructuredDescriptionEditor
          values={descriptionSections}
          onChange={setDescriptionSections}
          token={token}
        />
      </div>

      {/* --- SECTION 3: CATEGORIES, UNISEX & STOREFRONT FLAGS --- */}
      <div className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Layers className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">Categorization &amp; Storefront Discovery</h3>
        </div>

        {/* Categories Selector */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-bold text-slate-800 text-xs">
              Target Audience Categories (Select 1 or more) *
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    isSelected
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

        {/* Subcategory & Unisex Toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Subcategory / Garment Type *
            </label>
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
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:bg-white"
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
                className="mt-2 border border-slate-300 px-3 py-2 w-full rounded-xl text-xs bg-white"
                required
              />
            )}
          </div>

          {/* Unisex Flag Card */}
          <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-900 block">Unisex Garment</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Renders the Unisex badge &amp; displays in universal search.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isUnisex}
                onChange={(e) => setIsUnisex(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </div>

        {/* Discovery Flags */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-all">
            <input
              type="checkbox"
              checked={bestseller}
              onChange={(e) => setBestSeller(e.target.checked)}
              className="w-4 h-4 accent-amber-500 rounded"
            />
            <span className="text-xs font-bold text-slate-800">⭐ Best Seller Badge</span>
          </label>

          <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-all">
            <input
              type="checkbox"
              checked={newInStore}
              onChange={(e) => setNewInStore(e.target.checked)}
              className="w-4 h-4 accent-indigo-600 rounded"
            />
            <span className="text-xs font-bold text-slate-800">✨ New In Store</span>
          </label>

          <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-all">
            <input
              type="checkbox"
              checked={showInNavigation}
              onChange={(e) => setShowInNavigation(e.target.checked)}
              className="w-4 h-4 accent-slate-900 rounded"
            />
            <span className="text-xs font-bold text-slate-800">🧭 Highlight in Nav</span>
          </label>
        </div>
      </div>

      {/* --- SECTION 4: PRICING & STOCK CONTROLS --- */}
      <div className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <DollarSign className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">Commercial Pricing &amp; Stock Guard</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Retail Selling Price (Rs) *
            </label>
            <input
              onChange={(e) => setPrice(e.target.value)}
              value={price}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-900 focus:bg-white"
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
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-900 focus:bg-white"
              type="number"
              placeholder="0"
              min="0"
              max="100"
              step="any"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Low Stock Alert Threshold
            </label>
            <input
              onChange={(e) => setLowStockThreshold(e.target.value)}
              value={lowStockThreshold}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-900 focus:bg-white"
              type="number"
              placeholder="5"
              min="0"
            />
          </div>
        </div>
      </div>

      {/* --- SECTION 5: VARIETIES & COLOR-SPECIFIC PHOTOS --- */}
      <div className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Palette className="w-4 h-4 text-indigo-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Garment Varieties &amp; Color Swatches</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Upload one photo per color. Color photos are grouped with variants and never replace the Cover image.
            </p>
          </div>
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
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Color Photo</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setVariantImageFile(e.target.files[0] || null)}
                className="w-full text-[10px] text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-slate-900 file:text-white cursor-pointer"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleAddVariety}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
            >
              + Add Size &amp; Color Variety
            </button>
          </div>
        </div>

        {/* List of Configured Varieties */}
        {variants.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700">Configured Varieties ({variants.length})</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
              {variants.map((v, idx) => {
                const colorKey = v.color.trim().toLowerCase();
                const colorImg = colorImageFiles[colorKey];

                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5">
                      {colorImg?.preview ? (
                        <img
                          src={colorImg.preview}
                          alt={v.color}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                          No Pic
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          {v.size} / {v.color}
                        </p>
                        <span className="text-[10px] text-slate-400">Stock managed by Hubs</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveVariety(idx)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Remove variety"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="w-full flex justify-end gap-3 pt-2">
        <button
          type="submit"
          className="px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Publish Product with Verified Merchandising</span>
        </button>
      </div>
    </form>
  );
};

export default Add;
