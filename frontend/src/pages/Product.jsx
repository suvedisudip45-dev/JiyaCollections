import React, { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import RelatedProducts from "../components/RelatedProducts";
import ReviewSection from "../components/ReviewSection";
import {
  playSwitchSound,
  playCountSound,
  playAddToCartSound,
  isSoundEnabled,
  toggleSound,
} from "../utils/soundEffects";

const Product = () => {
  const { productId } = useParams();
  const { products, currency, addToCart } = useContext(ShopContext);
  const [productData, setProductData] = useState(false);
  const [image, setImage] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isImageTransitioning, setIsImageTransitioning] = useState(false);
  const [soundActive, setSoundActive] = useState(isSoundEnabled());
  const [activeTab, setActiveTab] = useState("reviews"); // "description" | "reviews"
  const [reviewStats, setReviewStats] = useState({ totalReviews: 0, averageRating: 0 });

  // Listen for sound setting changes
  useEffect(() => {
    const handleSoundChange = (e) => {
      if (e.detail && e.detail.enabled !== undefined) {
        setSoundActive(e.detail.enabled);
      }
    };
    window.addEventListener("sound-setting-changed", handleSoundChange);
    return () => window.removeEventListener("sound-setting-changed", handleSoundChange);
  }, []);

  const fetchProductData = () => {
    const matched = products.find((item) => item._id === productId);
    if (matched) {
      setProductData(matched);

      let initialImg = Array.isArray(matched.image) ? matched.image[0] : matched.image;
      let initialSize = matched.sizes && matched.sizes.length > 0 ? matched.sizes[0] : "";
      let initialColor = "";

      // Parse variants
      let parsedVariants = typeof matched.variants === "string"
        ? JSON.parse(matched.variants || "[]")
        : (matched.variants || []);
      if (!Array.isArray(parsedVariants)) parsedVariants = [];

      // If there's a featured variant with an image, select it first
      const featVar = parsedVariants.find((v) => v.isFeatured && v.image);
      if (featVar) {
        initialImg = featVar.image;
        if (featVar.size) initialSize = featVar.size;
        if (featVar.color) initialColor = featVar.color;
      } else if (matched.colors && matched.colors.length > 0) {
        const firstCol = typeof matched.colors[0] === "object" ? matched.colors[0].name : matched.colors[0];
        initialColor = firstCol;
      }

      setImage(initialImg);
      setSize(initialSize);
      setColor(initialColor);
      setQuantity(1);
    }
  };

  useEffect(() => {
    fetchProductData();
  }, [productId, products]);

  // Smooth animated image switch
  const switchImageSmoothly = (newUrl) => {
    if (!newUrl || newUrl === image) return;
    setIsImageTransitioning(true);
    setTimeout(() => {
      setImage(newUrl);
      setIsImageTransitioning(false);
    }, 120);
  };

  // Switch variety by selecting color
  const handleSelectColor = (selectedColor) => {
    playSwitchSound();
    setColor(selectedColor);

    if (productData) {
      let parsedVariants = typeof productData.variants === "string"
        ? JSON.parse(productData.variants || "[]")
        : (productData.variants || []);
      if (Array.isArray(parsedVariants)) {
        // Find variant matching selected color
        const matched = parsedVariants.find(
          (v) => (v.color || "").toLowerCase() === (selectedColor || "").toLowerCase() && v.image
        );
        if (matched && matched.image) {
          switchImageSmoothly(matched.image);
        }
      }
    }
  };

  // Switch size
  const handleSelectSize = (selectedSize) => {
    playSwitchSound();
    setSize(selectedSize);

    if (productData) {
      let parsedVariants = typeof productData.variants === "string"
        ? JSON.parse(productData.variants || "[]")
        : (productData.variants || []);
      if (Array.isArray(parsedVariants)) {
        // Find variant matching selected size and current color
        const matched = parsedVariants.find(
          (v) =>
            (v.size || "").toLowerCase() === (selectedSize || "").toLowerCase() &&
            (!color || (v.color || "").toLowerCase() === (color || "").toLowerCase()) &&
            v.image
        );
        if (matched && matched.image) {
          switchImageSmoothly(matched.image);
        }
      }
    }
  };

  // Click thumbnail
  const handleThumbnailClick = (thumbUrl) => {
    playSwitchSound();
    switchImageSmoothly(thumbUrl);

    // If this thumbnail matches a specific variety, auto-select that variety
    if (productData) {
      let parsedVariants = typeof productData.variants === "string"
        ? JSON.parse(productData.variants || "[]")
        : (productData.variants || []);
      if (Array.isArray(parsedVariants)) {
        const matched = parsedVariants.find((v) => v.image === thumbUrl);
        if (matched) {
          if (matched.color) setColor(matched.color);
          if (matched.size) setSize(matched.size);
        }
      }
    }
  };

  // Quantity stepper
  const handleQuantityStep = (direction) => {
    if (direction === "inc") {
      const next = quantity + 1;
      setQuantity(next);
      playCountSound("inc", next);
    } else if (direction === "dec" && quantity > 1) {
      const next = quantity - 1;
      setQuantity(next);
      playCountSound("dec", next);
    }
  };

  const handleAddToCart = () => {
    if (isOutOfStock || currentVariantStock <= 0) {
      toast.error("This product/variety is out of stock!");
      return;
    }
    if (!size) {
      toast.error("Please select a size");
      return;
    }
    if (productData.colors && productData.colors.length > 0 && !color) {
      toast.error("Please select a color");
      return;
    }
    for (let i = 0; i < quantity; i++) {
      addToCart(productData._id, size, color);
    }
  };

  const renderTopStars = (score) => {
    const rounded = Math.round(score || 0);
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <img
          key={i}
          className="w-4 h-4"
          src={i <= rounded ? assets.star_icon : assets.star_dull_icon}
          alt=""
        />
      );
    }
    return stars;
  };

  // Color dot helper
  const getColorHex = (name) => {
    const map = {
      black: "#111827",
      white: "#F9FAFB",
      red: "#DC2626",
      blue: "#2563EB",
      navy: "#1E3A8A",
      "navy blue": "#1E3A8A",
      green: "#16A34A",
      yellow: "#CA8A04",
      gray: "#6B7280",
      grey: "#6B7280",
      pink: "#EC4899",
      purple: "#9333EA",
      brown: "#78350F",
      orange: "#EA580C",
      maroon: "#800000",
      olive: "#556B2F",
      cream: "#FFFDD0",
      beige: "#F5F5DC",
    };
    return map[(name || "").toLowerCase()] || null;
  };

  if (!productData) {
    return (
      <div className="py-20 flex justify-center items-center">
        <div className="w-8 h-8 border-3 border-black border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Parse variants for stock
  let parsedVariants = typeof productData.variants === "string"
    ? JSON.parse(productData.variants || "[]")
    : (productData.variants || []);
  if (!Array.isArray(parsedVariants)) parsedVariants = [];
  const hasVariants = parsedVariants.length > 0;

  const totalProductStock = hasVariants
    ? parsedVariants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0)
    : Math.max(0, Number(productData.stockQuantity || 0));

  let currentVariant = null;
  if (hasVariants && size && color) {
    currentVariant = parsedVariants.find(
      (v) =>
        (v.size || "").trim().toLowerCase() === (size || "").trim().toLowerCase() &&
        (v.color || "").trim().toLowerCase() === (color || "").trim().toLowerCase()
    );
  } else if (hasVariants && size) {
    currentVariant = parsedVariants.find(
      (v) => (v.size || "").trim().toLowerCase() === (size || "").trim().toLowerCase()
    );
  } else if (hasVariants && color) {
    currentVariant = parsedVariants.find(
      (v) => (v.color || "").trim().toLowerCase() === (color || "").trim().toLowerCase()
    );
  }

  const currentVariantStock = hasVariants
    ? (currentVariant ? Math.max(0, Number(currentVariant.quantity ?? 0)) : (size && color ? 0 : totalProductStock))
    : Math.max(0, Number(productData.stockQuantity || 0));

  const isOutOfStock = totalProductStock <= 0 || (size && color && hasVariants ? currentVariantStock <= 0 : false);

  const showLowStock = !isOutOfStock && currentVariantStock > 0 && currentVariantStock <= 5;

  const imageList = Array.isArray(productData.image) ? productData.image : [productData.image];

  return (
    <div className="pt-6 pb-16 transition-opacity duration-300 opacity-100">
      {/* --- Breadcrumb & Audio Experience Bar --- */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6 text-xs text-gray-500 border-b border-gray-100 mb-8">
        <div className="flex items-center gap-2">
          <span>Home</span>
          <span>/</span>
          <span>{productData.category || "Collection"}</span>
          <span>/</span>
          <span className="font-semibold text-gray-900 truncate max-w-[240px]">{productData.name}</span>
        </div>

        {/* Tactile Audio Mode Indicator */}
        <button
          onClick={() => {
            const next = toggleSound();
            setSoundActive(next);
            if (next) playAddToCartSound();
          }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
            soundActive
              ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 shadow-2xs"
              : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
          }`}
          title="Toggle interactive audio feedback"
        >
          <span className={`w-2 h-2 rounded-full ${soundActive ? "bg-emerald-500 animate-ping" : "bg-gray-400"}`}></span>
          <span>{soundActive ? "🔊 Interactive Sound: ON" : "🔇 Sound: Muted"}</span>
        </button>
      </div>

      {/* --- Main Product Section --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 xl:gap-14">
        {/* --- LEFT: Product Gallery & Showcase --- */}
        <div className="lg:col-span-7 flex flex-col-reverse md:flex-row gap-4">
          {/* Vertical/Horizontal Thumbnails */}
          {imageList.length > 1 && (
            <div className="flex md:flex-col gap-3 overflow-x-auto md:overflow-y-auto md:max-h-[560px] md:w-24 shrink-0 py-1 scrollbar-thin">
              {imageList.map((item, index) => {
                const isSelected = item === image;
                return (
                  <button
                    key={index}
                    onClick={() => handleThumbnailClick(item)}
                    className={`relative w-20 md:w-full aspect-square rounded-2xl overflow-hidden border-2 transition-all duration-200 shrink-0 cursor-pointer ${
                      isSelected
                        ? "border-black shadow-md scale-105 ring-2 ring-black/10"
                        : "border-gray-200 hover:border-gray-400 opacity-80 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={item}
                      alt={`Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <span className="absolute bottom-1 right-1 w-2 h-2 bg-black rounded-full ring-2 ring-white"></span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Large Main Feature Image Showcase with Smooth Animated Morph */}
          <div className="flex-1 relative rounded-3xl overflow-hidden bg-gray-50 border border-gray-200/80 shadow-xs group aspect-square flex items-center justify-center">
            {/* Active Variety Floating Badge */}
            {color && (
              <div className="absolute top-4 left-4 z-20 bg-white/95 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-sm border border-gray-200/80 flex items-center gap-2 animate-fade-in">
                {getColorHex(color) && (
                  <span
                    className="w-3 h-3 rounded-full border border-black/20 shadow-2xs"
                    style={{ backgroundColor: getColorHex(color) }}
                  ></span>
                )}
                <span className="text-xs font-bold text-gray-900 tracking-wide">
                  {color} Edition
                </span>
              </div>
            )}

            {/* Discount Ribbon */}
            {productData.discount > 0 && (
              <div className="absolute top-4 right-4 z-20 bg-red-600 text-white text-xs font-black px-3 py-1.5 rounded-xl shadow-md uppercase tracking-wider">
                {productData.discount}% OFF
              </div>
            )}

            {/* Main Stage Image */}
            <img
              src={image || imageList[0]}
              alt={productData.name}
              className={`w-full h-full object-cover object-center transition-all duration-300 transform ${
                isImageTransitioning
                  ? "opacity-40 scale-95 blur-2xs"
                  : "opacity-100 scale-100 blur-none"
              } group-hover:scale-105`}
            />

            {/* Out of Stock Overlay */}
            {isOutOfStock && (
              <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-30">
                <span className="bg-white text-black font-extrabold text-sm px-6 py-2.5 rounded-2xl shadow-xl uppercase tracking-widest">
                  Currently Out of Stock
                </span>
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT: Product Details, Variety Selectors & Purchasing --- */}
        <div className="lg:col-span-5 flex flex-col justify-start space-y-6">
          <div>
            {/* Categories & Badges */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {(Array.isArray(productData.categories) && productData.categories.length > 0
                ? productData.categories
                : productData.category
                ? [productData.category]
                : []
              ).map((cat, idx) => (
                <span
                  key={idx}
                  className="text-xs font-bold tracking-wide px-3 py-1 rounded-lg bg-gray-100 text-gray-800 border border-gray-200"
                >
                  {cat}
                </span>
              ))}
              {productData.subCategory && (
                <span className="text-xs font-bold tracking-wide px-3 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200">
                  {productData.subCategory}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">
              {productData.name}
            </h1>

            {/* Ratings & Reviews */}
            <div className="flex items-center gap-2 mt-2.5">
              <div className="flex items-center gap-0.5">
                {renderTopStars(reviewStats.averageRating)}
              </div>
              <span className="text-sm font-bold text-gray-900">
                {reviewStats.averageRating > 0 ? reviewStats.averageRating : "5.0"}
              </span>
              <span className="text-xs text-gray-500">
                ({reviewStats.totalReviews} {reviewStats.totalReviews === 1 ? "customer review" : "customer reviews"})
              </span>
            </div>
          </div>

          {/* Pricing Row */}
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-baseline gap-3">
            {productData.discount > 0 ? (
              <>
                <span className="text-3xl font-black text-red-600">
                  {currency}{Math.round(productData.price * (1 - productData.discount / 100))}
                </span>
                <span className="text-lg text-gray-400 line-through font-medium">
                  {currency}{productData.price}
                </span>
                <span className="text-xs font-bold text-red-700 bg-red-100 px-2.5 py-1 rounded-lg ml-auto">
                  Save {currency}{Math.round(productData.price * (productData.discount / 100))}
                </span>
              </>
            ) : (
              <span className="text-3xl font-black text-gray-900">
                {currency}{productData.price}
              </span>
            )}
          </div>

          {/* Description Snippet */}
          <p className="text-sm text-gray-600 leading-relaxed">
            {productData.description}
          </p>

          <hr className="border-gray-100" />

          {/* --- VARIETY 1: COLOR SELECTION (Grandpa-friendly + Ultra-modern) --- */}
          {productData.colors && productData.colors.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-extrabold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <span>1. Choose Color:</span>
                  <span className="text-indigo-600 font-bold normal-case text-sm bg-indigo-50 px-2.5 py-0.5 rounded-md">
                    {color || "Select a color"}
                  </span>
                </label>
                <span className="text-[11px] text-gray-400">Click to switch photo</span>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {productData.colors.map((c, idx) => {
                  const colorName = typeof c === "object" ? c.name : c;
                  const isSelected = (color || "").toLowerCase() === colorName.toLowerCase();
                  const hex = getColorHex(colorName);

                  const colorStock = hasVariants
                    ? parsedVariants
                        .filter((v) => (v.color || "").trim().toLowerCase() === colorName.trim().toLowerCase())
                        .reduce((s, v) => s + Math.max(0, Number(v.quantity || 0)), 0)
                    : totalProductStock;
                  const isSoldOut = colorStock <= 0;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectColor(colorName)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-all cursor-pointer shadow-2xs ${
                        isSelected
                          ? "border-black bg-black text-white ring-2 ring-black/10 scale-105"
                          : isSoldOut
                          ? "border-dashed border-gray-300 bg-gray-50 text-gray-400 opacity-75 hover:border-gray-400"
                          : "border-gray-200 bg-white text-gray-800 hover:border-gray-400 hover:bg-gray-50"
                      }`}
                    >
                      {hex && (
                        <span
                          className={`w-3.5 h-3.5 rounded-full border shadow-2xs shrink-0 ${
                            isSelected ? "border-white" : "border-black/20"
                          }`}
                          style={{ backgroundColor: hex }}
                        ></span>
                      )}
                      <span>{colorName}</span>
                      {isSoldOut && <span className="text-[10px] text-red-500 font-semibold">(Sold Out)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* --- VARIETY 2: SIZE SELECTION (Grandpa-friendly High Contrast) --- */}
          {productData.sizes && productData.sizes.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-extrabold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <span>2. Choose Size:</span>
                  <span className="text-indigo-600 font-bold normal-case text-sm bg-indigo-50 px-2.5 py-0.5 rounded-md">
                    {size || "Select a size"}
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {productData.sizes.map((sz, idx) => {
                  const isSelected = (size || "").toLowerCase() === sz.toLowerCase();
                  const sizeStock = hasVariants
                    ? parsedVariants
                        .filter(
                          (v) =>
                            (v.size || "").trim().toLowerCase() === sz.trim().toLowerCase() &&
                            (!color || (v.color || "").trim().toLowerCase() === color.trim().toLowerCase())
                        )
                        .reduce((s, v) => s + Math.max(0, Number(v.quantity || 0)), 0)
                    : totalProductStock;
                  const isSoldOut = sizeStock <= 0;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSize(sz)}
                      className={`min-w-[56px] py-3 px-4 rounded-xl text-sm font-extrabold border-2 text-center transition-all cursor-pointer shadow-2xs flex items-center justify-center gap-1.5 ${
                        isSelected
                          ? "border-black bg-black text-white ring-2 ring-black/10 scale-105"
                          : isSoldOut
                          ? "border-dashed border-gray-300 bg-gray-50 text-gray-400 opacity-75 hover:border-gray-400"
                          : "border-gray-200 bg-white text-gray-800 hover:border-gray-400 hover:bg-gray-50"
                      }`}
                    >
                      <span className={isSoldOut && !isSelected ? "line-through" : ""}>{sz}</span>
                      {isSoldOut && <span className="text-[10px] text-red-500 font-normal">Out</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* --- QUANTITY STEPPER & ADD TO CART --- */}
          <div className="space-y-3 pt-2">
            {/* Out of stock or Low stock warning */}
            {isOutOfStock ? (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-xs font-bold text-red-700">
                <span className="text-base">🚫</span>
                <span>Currently out of stock. Please select another variety or check back later.</span>
              </div>
            ) : showLowStock ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs font-bold text-amber-900 animate-pulse">
                <span>⚠️</span>
                <span>Low stock alert: Only {currentVariantStock} item(s) remaining for this variety!</span>
              </div>
            ) : null}

            <div className="flex flex-col sm:flex-row items-stretch gap-3.5">
              {/* Quantity Selector Stepper */}
              <div className="flex items-center justify-between border-2 border-gray-300 rounded-2xl bg-white px-3 py-1.5 shrink-0 min-w-[130px]">
                <button
                  type="button"
                  disabled={quantity <= 1 || isOutOfStock}
                  onClick={() => handleQuantityStep("dec")}
                  className="w-9 h-9 flex items-center justify-center font-bold text-lg text-gray-600 hover:text-black disabled:opacity-30 cursor-pointer rounded-xl hover:bg-gray-100 active:scale-95"
                >
                  −
                </button>
                <span className="font-extrabold text-base text-gray-900 px-3">
                  {quantity}
                </span>
                <button
                  type="button"
                  disabled={isOutOfStock || (currentVariantStock > 0 && quantity >= currentVariantStock)}
                  onClick={() => handleQuantityStep("inc")}
                  className="w-9 h-9 flex items-center justify-center font-bold text-lg text-gray-600 hover:text-black disabled:opacity-30 cursor-pointer rounded-xl hover:bg-gray-100 active:scale-95"
                >
                  +
                </button>
              </div>

              {/* Add to Cart Action Button */}
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={handleAddToCart}
                className={`flex-1 py-4 px-8 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-3 transition-all cursor-pointer shadow-lg active:scale-[0.98] ${
                  isOutOfStock
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none border border-gray-300"
                    : "bg-black text-white hover:bg-gray-800 hover:shadow-xl"
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <span>{isOutOfStock ? "Out of Stock" : "Add to Cart"}</span>
              </button>
            </div>
          </div>

          {/* Guarantees & Features */}
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-100 text-center">
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-base block mb-1">✨</span>
              <p className="text-[11px] font-bold text-gray-800">100% Authentic</p>
              <p className="text-[10px] text-gray-500">Genuine Garment</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-base block mb-1">🚚</span>
              <p className="text-[11px] font-bold text-gray-800">Fast Delivery</p>
              <p className="text-[10px] text-gray-500">Across Nepal</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-base block mb-1">🔄</span>
              <p className="text-[11px] font-bold text-gray-800">Easy Returns</p>
              <p className="text-[10px] text-gray-500">7 Days Window</p>
            </div>
          </div>
        </div>
      </div>

      {/* --- Description & Review Section --- */}
      <div className="mt-16">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("description")}
            className={`px-8 py-3.5 text-sm font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === "description"
                ? "border-black text-black bg-white"
                : "border-transparent text-gray-500 hover:text-black bg-gray-50"
            }`}
          >
            Product Description
          </button>
          <button
            onClick={() => setActiveTab("reviews")}
            className={`px-8 py-3.5 text-sm font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
              activeTab === "reviews"
                ? "border-black text-black bg-white"
                : "border-transparent text-gray-500 hover:text-black bg-gray-50"
            }`}
          >
            <span>Customer Reviews</span>
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
              activeTab === "reviews" ? "bg-black text-white" : "bg-gray-200 text-gray-700"
            }`}>
              {reviewStats.totalReviews}
            </span>
          </button>
        </div>

        {activeTab === "description" ? (
          <div className="flex flex-col gap-4 border border-t-0 px-8 py-8 text-sm text-gray-600 bg-white rounded-b-2xl leading-relaxed">
            <p className="text-base text-gray-800 font-medium">
              {productData.description || "An authentic premium quality product crafted with attention to details and comfortable fabrics."}
            </p>
            <p>
              Each piece is meticulously crafted and inspected at certified manufacturing hubs before dispatch. Color variations and sizing specifications follow authentic standard garment grading.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-t-0 px-6 sm:px-8 py-8 rounded-b-2xl">
            <ReviewSection
              productId={productData._id}
              productName={productData.name}
              onStatsUpdate={(newStats) => setReviewStats(newStats)}
            />
          </div>
        )}
      </div>

      {/* --- Related Products --- */}
      <RelatedProducts
        category={productData.category}
        categories={productData.categories}
        subCategory={productData.subCategory}
        currentId={productData._id}
      />
    </div>
  );
};

export default Product;

