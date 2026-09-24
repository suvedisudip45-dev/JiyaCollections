import React, { useContext, useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import RelatedProducts from "../components/RelatedProducts";
import ReviewSection from "../components/ReviewSection";
import { toast } from "react-toastify";
import {
  Heart,
  ShoppingBag,
  Zap,
  Truck,
  RotateCcw,
  ShieldCheck,
  Ruler,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  Check,
  Info,
  Sparkles,
  Layers,
} from "lucide-react";

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getColorImage = (product, selectedColor) => {
  const key = String(selectedColor || "").trim().toLowerCase();
  if (!key) return "";
  const colorImages = parseJsonArray(product?.colorImages);
  return colorImages.find((entry) => String(entry?.color || "").trim().toLowerCase() === key)?.image || "";
};

const Product = () => {
  const { productId } = useParams();
  const { products, currency, addToCart, wishlist, toggleWishlist, navigate } =
    useContext(ShopContext);

  const [productData, setProductData] = useState(false);
  const [image, setImage] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isImageTransitioning, setIsImageTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState("reviews"); // "description" | "details" | "reviews"
  const [reviewStats, setReviewStats] = useState({ totalReviews: 0, averageRating: 0 });
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isAddedAnimation, setIsAddedAnimation] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);

  // Zoom on hover state
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });

  const mainActionRef = useRef(null);
  const carouselRef = useRef(null);
  // Touch tracking refs for mobile swipe
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);

  const fetchProductData = () => {
    const matched = products.find(
      (item) => item._id === productId || item.id === productId
    );
    if (matched) {
      setProductData(matched);

      const imageList = [...new Set(parseJsonArray(matched.image).filter(Boolean))];
      let initialImg = imageList[0] || "";
      let initialSize = matched.sizes && matched.sizes.length > 0 ? matched.sizes[0] : "";
      let initialColor = "";

      // Parse variants
      const parsedVariants = parseJsonArray(matched.variants);

      // If there's a featured variant with an image, select it first
      const featVar = parsedVariants.find((v) => v.isFeatured && v.image);
      if (featVar) {
        initialImg = featVar.image;
        if (featVar.size) initialSize = featVar.size;
        if (featVar.color) initialColor = featVar.color;
      } else if (matched.colors && matched.colors.length > 0) {
        const firstCol =
          typeof matched.colors[0] === "object"
            ? matched.colors[0].name
            : matched.colors[0];
        initialColor = firstCol;
        initialImg = getColorImage(matched, firstCol) || initialImg;
      }

      setImage(initialImg);
      const foundIdx = imageList.indexOf(initialImg);
      setActiveImageIndex(foundIdx >= 0 ? foundIdx : 0);
      setSize(initialSize);
      setColor(initialColor);
      setQuantity(1);
    }
  };

  useEffect(() => {
    fetchProductData();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [productId, products]);

  // Observer for sticky bottom bar
  useEffect(() => {
    const handleScroll = () => {
      if (mainActionRef.current) {
        const rect = mainActionRef.current.getBoundingClientRect();
        setShowStickyBar(rect.bottom < 0);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll the mobile carousel to a specific image index
  const scrollCarouselToIndex = (idx) => {
    if (!carouselRef.current) return;
    const containerWidth = carouselRef.current.offsetWidth;
    carouselRef.current.scrollTo({
      left: containerWidth * idx,
      behavior: "smooth",
    });
  };

  // Smooth animated image switch
  const switchImageSmoothly = (newUrl, index = -1) => {
    if (!newUrl || newUrl === image) return;
    setIsImageTransitioning(true);
    setTimeout(() => {
      setImage(newUrl);
      let resolvedIdx = index;
      if (index >= 0) {
        setActiveImageIndex(index);
        resolvedIdx = index;
      } else if (productData) {
        const imgList = [...new Set(parseJsonArray(productData.image).filter(Boolean))];
        const idx = imgList.indexOf(newUrl);
        if (idx >= 0) {
          setActiveImageIndex(idx);
          resolvedIdx = idx;
        }
      }
      // Sync mobile carousel position
      if (resolvedIdx >= 0) scrollCarouselToIndex(resolvedIdx);
      setIsImageTransitioning(false);
    }, 120);
  };

  // Switch variety by selecting color
  const handleSelectColor = (selectedColor) => {
    setColor(selectedColor);

    if (productData) {
      const colorImage = getColorImage(productData, selectedColor);
      if (colorImage) switchImageSmoothly(colorImage);
    }
  };

  // Switch size
  const handleSelectSize = (selectedSize) => {
    setSize(selectedSize);

  };

  // Click thumbnail
  const handleThumbnailClick = (thumbUrl, index) => {
    switchImageSmoothly(thumbUrl, index);

    // If this thumbnail matches a specific variety, auto-select that variety
    if (productData) {
      const colorImage = parseJsonArray(productData.colorImages).find((entry) => entry?.image === thumbUrl);
      if (colorImage?.color) setColor(colorImage.color);
    }
  };

  const handleNextImage = () => {
    const imgList = [...new Set(parseJsonArray(productData.image).filter(Boolean))];
    const nextIdx = (activeImageIndex + 1) % imgList.length;
    handleThumbnailClick(imgList[nextIdx], nextIdx);
  };

  const handlePrevImage = () => {
    const imgList = [...new Set(parseJsonArray(productData.image).filter(Boolean))];
    const prevIdx = (activeImageIndex - 1 + imgList.length) % imgList.length;
    handleThumbnailClick(imgList[prevIdx], prevIdx);
  };

  // Zoom handlers
  const handleMouseMove = (e) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosition({ x, y });
  };

  // Quantity stepper
  const handleQuantityStep = (direction) => {
    if (direction === "inc") {
      if (currentVariantStock > 0 && quantity >= currentVariantStock) {
        toast.info(`Max available stock (${currentVariantStock}) reached.`);
        return;
      }
      setQuantity((prev) => prev + 1);
    } else if (direction === "dec" && quantity > 1) {
      setQuantity((prev) => prev - 1);
    }
  };

  const handleAddToCart = () => {
    if (isOutOfStock || currentVariantStock <= 0) {
      toast.error("This product/variety is currently out of stock!");
      return;
    }
    if (!size && productData.sizes && productData.sizes.length > 0) {
      toast.error("Please select a size first");
      return;
    }
    if (productData.colors && productData.colors.length > 0 && !color) {
      toast.error("Please select a color first");
      return;
    }

    for (let i = 0; i < quantity; i++) {
      addToCart(productData._id || productData.id, size, color);
    }

    setIsAddedAnimation(true);
    setTimeout(() => setIsAddedAnimation(false), 2000);
  };

  const handleBuyNow = () => {
    if (isOutOfStock || currentVariantStock <= 0) {
      toast.error("This product/variety is currently out of stock!");
      return;
    }
    if (!size && productData.sizes && productData.sizes.length > 0) {
      toast.error("Please select a size first");
      return;
    }
    if (productData.colors && productData.colors.length > 0 && !color) {
      toast.error("Please select a color first");
      return;
    }

    addToCart(productData._id || productData.id, size, color);
    navigate("/cart");
  };

  const renderTopStars = (score) => {
    const rounded = Math.round(score || 5);
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

  // Color hex palette
  const getColorHex = (name) => {
    const map = {
      black: "#171717",
      white: "#FFFFFF",
      offwhite: "#F5F5F0",
      red: "#DC2626",
      blue: "#2563EB",
      navy: "#1E3A8A",
      "navy blue": "#1E3A8A",
      green: "#16A34A",
      yellow: "#EAB308",
      gray: "#6B7280",
      grey: "#6B7280",
      pink: "#EC4899",
      purple: "#9333EA",
      brown: "#78350F",
      orange: "#EA580C",
      maroon: "#800000",
      olive: "#556B2F",
      cream: "#FFFDD0",
      beige: "#D8C6B0",
      charcoal: "#374151",
      lavender: "#E6E6FA",
    };
    return map[(name || "").toLowerCase().trim()] || null;
  };

  if (!productData) {
    return (
      <div className="min-h-[60vh] flex flex-col justify-center items-center gap-3">
        <div className="w-10 h-10 border-3 border-black border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Loading garment details...
        </p>
      </div>
    );
  }

  // Parse variants for stock
  let parsedVariants =
    typeof productData.variants === "string"
      ? JSON.parse(productData.variants || "[]")
      : productData.variants || [];
  if (!Array.isArray(parsedVariants)) parsedVariants = [];
  const hasVariants = parsedVariants.length > 0;

  const totalProductStock = hasVariants
    ? parsedVariants.reduce(
        (sum, v) => sum + Math.max(0, Number(v.quantity || 0)),
        0
      )
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
    ? currentVariant
      ? Math.max(0, Number(currentVariant.quantity ?? 0))
      : size && color
      ? 0
      : totalProductStock
    : Math.max(0, Number(productData.stockQuantity || 0));

  const isOutOfStock =
    totalProductStock <= 0 ||
    (size && color && hasVariants ? currentVariantStock <= 0 : false);

  const showLowStock =
    !isOutOfStock && currentVariantStock > 0 && currentVariantStock <= 5;

  const imageList = [...new Set(parseJsonArray(productData.image).filter(Boolean))];

  const currentActiveImage = image || imageList[0];
  const finalPrice =
    productData.discount > 0
      ? Math.round(productData.price * (1 - productData.discount / 100))
      : productData.price;
  const savings =
    productData.discount > 0 ? productData.price - finalPrice : 0;
  const isWishlisted = wishlist.includes(productData._id || productData.id);

  return (
    <div className="pt-4 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* --- Breadcrumbs --- */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-xs text-gray-500 py-3 mb-6 border-b border-stone-200/80 overflow-x-auto whitespace-nowrap scrollbar-none"
      >
        <Link
          to="/"
          className="hover:text-black transition-colors font-medium"
        >
          Home
        </Link>
        <span className="text-gray-300">/</span>
        <Link
          to="/collection"
          className="hover:text-black transition-colors font-medium"
        >
          Shop
        </Link>
        {productData.category && (
          <>
            <span className="text-gray-300">/</span>
            <Link
              to={`/collection?category=${encodeURIComponent(
                productData.category
              )}`}
              className="hover:text-black transition-colors font-medium"
            >
              {productData.category}
            </Link>
          </>
        )}
        {productData.subCategory && (
          <>
            <span className="text-gray-300">/</span>
            <Link
              to={`/collection?subCategory=${encodeURIComponent(
                productData.subCategory
              )}`}
              className="hover:text-black transition-colors font-medium"
            >
              {productData.subCategory}
            </Link>
          </>
        )}
        <span className="text-gray-300">/</span>
        <span className="text-gray-900 font-semibold truncate max-w-[200px] sm:max-w-xs">
          {productData.name}
        </span>
      </nav>

      {/* --- Main Product Grid --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 xl:gap-16 items-start">
        {/* ================= LEFT COLUMN: IMAGERY ================= */}
        <div className="lg:col-span-7">

          {/* ─── MOBILE CAROUSEL (hidden on md+) ─── */}
          <div className="md:hidden relative select-none">
            {/* Swipeable Scroll Container */}
            <div
              ref={carouselRef}
              className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none rounded-2xl"
              style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
              onTouchStart={(e) => {
                touchStartX.current = e.touches[0].clientX;
                touchStartY.current = e.touches[0].clientY;
                isDragging.current = false;
              }}
              onTouchMove={(e) => {
                const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
                const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
                if (dx > dy) isDragging.current = true;
              }}
              onTouchEnd={(e) => {
                if (!isDragging.current) return;
                const dx = e.changedTouches[0].clientX - touchStartX.current;
                if (Math.abs(dx) > 40) {
                  const nextIdx = dx < 0
                    ? Math.min(activeImageIndex + 1, imageList.length - 1)
                    : Math.max(activeImageIndex - 1, 0);
                  handleThumbnailClick(imageList[nextIdx], nextIdx);
                }
                isDragging.current = false;
              }}
              onScroll={(e) => {
                const containerWidth = e.currentTarget.offsetWidth;
                if (containerWidth === 0) return;
                const newIdx = Math.round(e.currentTarget.scrollLeft / containerWidth);
                if (newIdx !== activeImageIndex && newIdx >= 0 && newIdx < imageList.length) {
                  setActiveImageIndex(newIdx);
                  setImage(imageList[newIdx]);
                  const colorImage = parseJsonArray(productData.colorImages).find((entry) => entry?.image === imageList[newIdx]);
                  if (colorImage?.color) setColor(colorImage.color);
                }
              }}
            >
              {imageList.map((item, index) => (
                <div
                  key={index}
                  className="flex-shrink-0 w-full snap-center"
                  style={{ scrollSnapAlign: "center" }}
                >
                  <div
                    className="relative w-full aspect-[4/5] bg-stone-100 overflow-hidden"
                    onClick={() => setIsLightboxOpen(true)}
                  >
                    <img
                      src={item}
                      alt={`${productData.name} — view ${index + 1}`}
                      className="w-full h-full object-cover object-center"
                      loading={index === 0 ? "eager" : "lazy"}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Floating overlay badges on mobile (positioned absolutely over the carousel) */}
            <div className="pointer-events-none absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5">
              {productData.bestseller && (
                <span className="bg-black/90 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                  <Sparkles size={11} className="text-amber-400" />
                  Bestseller
                </span>
              )}
              {color && (
                <span className="bg-white/95 backdrop-blur-md text-gray-900 border border-stone-200/90 text-[11px] font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1.5">
                  {getColorHex(color) && (
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-black/20"
                      style={{ backgroundColor: getColorHex(color) }}
                    />
                  )}
                  {color}
                </span>
              )}
            </div>

            {/* Discount + Wishlist badges */}
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
              {productData.discount > 0 && (
                <span className="bg-[#d85b3f] text-white text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                  -{productData.discount}% OFF
                </span>
              )}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  toggleWishlist(productData._id || productData.id);
                }}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-md border shadow-sm cursor-pointer ${
                  isWishlisted
                    ? "bg-[#d85b3f] text-white border-[#d85b3f] scale-105"
                    : "bg-white/90 text-gray-800 border-stone-200"
                }`}
                aria-label="Save to wishlist"
              >
                <Heart size={18} fill={isWishlisted ? "currentColor" : "none"} strokeWidth={2} />
              </button>
            </div>

            {/* Out of Stock Overlay */}
            {isOutOfStock && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-30 pointer-events-none rounded-2xl">
                <div className="bg-white text-black font-black text-xs px-6 py-3 rounded-2xl shadow-2xl uppercase tracking-widest border border-stone-300">
                  Out of Stock
                </div>
              </div>
            )}

            {/* Arrow Buttons — mobile always visible on sides */}
            {imageList.length > 1 && (
              <>
                <button
                  onClick={handlePrevImage}
                  disabled={activeImageIndex === 0}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-black border border-stone-200 shadow-md flex items-center justify-center cursor-pointer disabled:opacity-30 active:scale-95 transition-all"
                  aria-label="Previous image"
                >
                  <ChevronLeft size={18} strokeWidth={2.5} />
                </button>
                <button
                  onClick={handleNextImage}
                  disabled={activeImageIndex === imageList.length - 1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-black border border-stone-200 shadow-md flex items-center justify-center cursor-pointer disabled:opacity-30 active:scale-95 transition-all"
                  aria-label="Next image"
                >
                  <ChevronRight size={18} strokeWidth={2.5} />
                </button>
              </>
            )}

            {/* Dot Indicators + Expand Button */}
            <div className="absolute bottom-3.5 left-0 right-0 z-20 flex items-center justify-center gap-1.5">
              {imageList.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => handleThumbnailClick(imageList[idx], idx)}
                  className={`rounded-full transition-all duration-200 cursor-pointer ${
                    idx === activeImageIndex
                      ? "w-5 h-2 bg-white shadow-md"
                      : "w-2 h-2 bg-white/50 hover:bg-white/80"
                  }`}
                  aria-label={`Go to image ${idx + 1}`}
                />
              ))}
            </div>

            {/* Counter + Expand (bottom-right) */}
            <div className="absolute bottom-3.5 right-3.5 z-20">
              <button
                onClick={() => setIsLightboxOpen(true)}
                className="w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
                aria-label="Expand image fullscreen"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          {/* ─── DESKTOP / TABLET LAYOUT (hidden on mobile) ─── */}
          <div className="hidden md:flex flex-row gap-4">
            {/* Vertical Thumbnail Strip */}
            {imageList.length > 1 && (
              <div className="flex flex-col gap-3 overflow-y-auto max-h-[640px] w-20 lg:w-24 shrink-0 py-1 scrollbar-thin">
                {imageList.map((item, index) => {
                  const isSelected = item === currentActiveImage;
                  return (
                    <button
                      key={index}
                      onClick={() => handleThumbnailClick(item, index)}
                      className={`relative w-full h-28 rounded-xl overflow-hidden border-2 transition-all duration-200 shrink-0 cursor-pointer bg-stone-100 group ${
                        isSelected
                          ? "border-black shadow-md ring-2 ring-black/10 scale-[1.02]"
                          : "border-stone-200 hover:border-stone-400 opacity-75 hover:opacity-100"
                      }`}
                      aria-label={`View garment image ${index + 1}`}
                    >
                      <img
                        src={item}
                        alt={`Garment angle ${index + 1}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                      {isSelected && (
                        <span className="absolute bottom-1.5 right-1.5 w-2 h-2 bg-black rounded-full ring-2 ring-white" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Main Large Visual Stage */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-stone-100 border border-stone-200 shadow-xs group aspect-[4/5] flex items-center justify-center select-none">
              {/* Top-Left Floating Tag Cluster */}
              <div className="absolute top-4 left-4 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
                {productData.bestseller && (
                  <span className="bg-black/90 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                    <Sparkles size={11} className="text-amber-400" />
                    Bestseller
                  </span>
                )}
                {color && (
                  <span className="bg-white/95 backdrop-blur-md text-gray-900 border border-stone-200/90 text-[11px] font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1.5">
                    {getColorHex(color) && (
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-black/20"
                        style={{ backgroundColor: getColorHex(color) }}
                      />
                    )}
                    {color}
                  </span>
                )}
              </div>

              {/* Top-Right Action Badges (Discount & Wishlist) */}
              <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                {productData.discount > 0 && (
                  <span className="bg-[#d85b3f] text-white text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    -{productData.discount}% OFF
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    toggleWishlist(productData._id || productData.id);
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-md border shadow-sm cursor-pointer ${
                    isWishlisted
                      ? "bg-[#d85b3f] text-white border-[#d85b3f] scale-105"
                      : "bg-white/90 text-gray-800 border-stone-200 hover:bg-white hover:scale-105"
                  }`}
                  aria-label="Save to wishlist"
                >
                  <Heart size={18} fill={isWishlisted ? "currentColor" : "none"} strokeWidth={2} />
                </button>
              </div>

              {/* Main Interactive Stage Photo with Hover Zoom */}
              <div
                className="w-full h-full relative cursor-crosshair overflow-hidden"
                onMouseEnter={() => setIsZoomed(true)}
                onMouseLeave={() => setIsZoomed(false)}
                onMouseMove={handleMouseMove}
                onClick={() => setIsLightboxOpen(true)}
              >
                <img
                  src={currentActiveImage}
                  alt={productData.name}
                  className={`w-full h-full object-cover object-center transition-opacity duration-300 ${
                    isImageTransitioning ? "opacity-30" : "opacity-100"
                  } ${isZoomed ? "opacity-0" : "opacity-100"}`}
                />

                {/* High-res zoom container */}
                {isZoomed && (
                  <div
                    className="absolute inset-0 bg-no-repeat bg-stone-100 pointer-events-none"
                    style={{
                      backgroundImage: `url(${currentActiveImage})`,
                      backgroundPosition: `${zoomPosition.x}% ${zoomPosition.y}%`,
                      backgroundSize: "220%",
                    }}
                  />
                )}
              </div>

              {/* Out of Stock Overlay Banner */}
              {isOutOfStock && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-30 pointer-events-none">
                  <div className="bg-white text-black font-black text-sm px-6 py-3 rounded-2xl shadow-2xl uppercase tracking-widest border border-stone-300">
                    Sold Out / Out of Stock
                  </div>
                </div>
              )}

              {/* Floating Navigation Arrows (hover reveal) */}
              {imageList.length > 1 && (
                <>
                  <button
                    onClick={handlePrevImage}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-black border border-stone-200 shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
                    aria-label="Previous image"
                  >
                    <ChevronLeft size={18} strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={handleNextImage}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-black border border-stone-200 shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
                    aria-label="Next image"
                  >
                    <ChevronRight size={18} strokeWidth={2.5} />
                  </button>
                </>
              )}

              {/* Fullscreen Expand Trigger & Image Count Indicator */}
              <div className="absolute bottom-3.5 right-3.5 z-20 flex items-center gap-2">
                <span className="bg-black/75 backdrop-blur-md text-white text-[11px] font-bold px-2.5 py-1 rounded-full tracking-wider">
                  {activeImageIndex + 1} / {imageList.length}
                </span>
                <button
                  onClick={() => setIsLightboxOpen(true)}
                  className="w-8 h-8 rounded-full bg-white/90 hover:bg-white text-black border border-stone-200 shadow-sm flex items-center justify-center transition-transform hover:scale-105 cursor-pointer"
                  aria-label="Expand image fullscreen"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN: DETAILS & ACTIONS ================= */}
        <div className="lg:col-span-5 flex flex-col space-y-6 lg:sticky lg:top-24">
          {/* Header & Title */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {productData.category && (
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#d85b3f] bg-[#d85b3f]/10 px-2.5 py-0.5 rounded-md">
                  {productData.category}
                </span>
              )}
              {productData.subCategory && (
                <span className="text-[11px] font-semibold text-gray-500 bg-stone-100 px-2.5 py-0.5 rounded-md">
                  {productData.subCategory}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight leading-snug">
              {productData.name}
            </h1>

            {/* Rating Summary & Quick Review Link */}
            <div className="flex items-center gap-2 mt-2.5">
              <div className="flex items-center gap-0.5">
                {renderTopStars(reviewStats.averageRating)}
              </div>
              <span className="text-sm font-bold text-gray-900">
                {reviewStats.averageRating > 0
                  ? reviewStats.averageRating.toFixed(1)
                  : "5.0"}
              </span>
              <span className="text-gray-300">•</span>
              <button
                onClick={() => {
                  setActiveTab("reviews");
                  const el = document.getElementById("product-tabs-section");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
                className="text-xs font-semibold text-gray-600 hover:text-black underline underline-offset-4 cursor-pointer"
              >
                {reviewStats.totalReviews}{" "}
                {reviewStats.totalReviews === 1 ? "review" : "reviews"}
              </button>
            </div>
          </div>

          {/* Pricing Highlight Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-stone-200/90 shadow-2xs">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
                {currency}
                {finalPrice.toLocaleString()}
              </span>
              {productData.discount > 0 && (
                <>
                  <span className="text-lg text-gray-400 line-through font-medium">
                    {currency}
                    {productData.price.toLocaleString()}
                  </span>
                  <span className="text-xs font-bold text-[#d85b3f] bg-[#d85b3f]/10 border border-[#d85b3f]/20 px-2.5 py-1 rounded-full">
                    Save {currency}
                    {savings.toLocaleString()} ({productData.discount}% OFF)
                  </span>
                </>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1.5">
              <Check size={13} className="text-emerald-600" />
              <span>Inclusive of all taxes. Fast cash on delivery available.</span>
            </p>
          </div>

          {/* Short Bio */}
          {productData.description && (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
              {productData.description}
            </p>
          )}

          <hr className="border-stone-200" />

          {/* ================= VARIETY 1: COLOR SWATCHES ================= */}
          {productData.colors && productData.colors.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                    Color:
                  </span>
                  <span className="text-xs font-bold text-gray-800 bg-stone-100 px-2.5 py-0.5 rounded-md">
                    {color || "Select color"}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400">
                  {productData.colors.length} shades available
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {productData.colors.map((c, idx) => {
                  const colorName = typeof c === "object" ? c.name : c;
                  const isSelected =
                    (color || "").toLowerCase() === colorName.toLowerCase();
                  const hex = getColorHex(colorName);

                  const colorStock = hasVariants
                    ? parsedVariants
                        .filter(
                          (v) =>
                            (v.color || "").trim().toLowerCase() ===
                            colorName.trim().toLowerCase()
                        )
                        .reduce(
                          (s, v) => s + Math.max(0, Number(v.quantity || 0)),
                          0
                        )
                    : totalProductStock;
                  const isSoldOut = colorStock <= 0;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectColor(colorName)}
                      className={`group relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-black bg-black text-white shadow-sm scale-105 ring-2 ring-black/10"
                          : isSoldOut
                          ? "border-stone-200 bg-stone-50 text-gray-400 opacity-60 hover:opacity-100"
                          : "border-stone-300 bg-white text-gray-800 hover:border-black hover:bg-stone-50"
                      }`}
                      title={`${colorName}${isSoldOut ? " (Sold Out)" : ""}`}
                    >
                      {hex && (
                        <span
                          className={`w-3.5 h-3.5 rounded-full border shadow-2xs shrink-0 ${
                            isSelected ? "border-white" : "border-black/20"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      )}
                      <span>{colorName}</span>
                      {isSoldOut && (
                        <span className="text-[10px] text-red-500 font-normal">
                          (Out)
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= VARIETY 2: SIZE TILES ================= */}
          {productData.sizes && productData.sizes.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                    Size:
                  </span>
                  <span className="text-xs font-bold text-gray-800 bg-stone-100 px-2.5 py-0.5 rounded-md">
                    {size || "Select size"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSizeGuideOpen(true)}
                  className="text-xs font-semibold text-gray-700 hover:text-black flex items-center gap-1 underline underline-offset-4 cursor-pointer"
                >
                  <Ruler size={13} />
                  <span>Size Chart</span>
                </button>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
                {productData.sizes.map((sz, idx) => {
                  const isSelected =
                    (size || "").toLowerCase() === sz.toLowerCase();
                  const sizeStock = hasVariants
                    ? parsedVariants
                        .filter(
                          (v) =>
                            (v.size || "").trim().toLowerCase() ===
                              sz.trim().toLowerCase() &&
                            (!color ||
                              (v.color || "").trim().toLowerCase() ===
                                color.trim().toLowerCase())
                        )
                        .reduce(
                          (s, v) => s + Math.max(0, Number(v.quantity || 0)),
                          0
                        )
                    : totalProductStock;
                  const isSoldOut = sizeStock <= 0;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSize(sz)}
                      className={`relative py-3 rounded-xl text-xs font-extrabold border-2 text-center transition-all duration-150 cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                        isSelected
                          ? "border-black bg-black text-white shadow-md ring-2 ring-black/10 scale-102"
                          : isSoldOut
                          ? "border-stone-200 bg-stone-100/60 text-gray-400 cursor-pointer hover:border-stone-300"
                          : "border-stone-200 bg-white text-gray-800 hover:border-black hover:bg-stone-50"
                      }`}
                    >
                      <span className={isSoldOut && !isSelected ? "line-through text-gray-400" : ""}>
                        {sz}
                      </span>
                      {isSoldOut ? (
                        <span className="text-[9px] font-bold text-red-500 uppercase">
                          Out
                        </span>
                      ) : sizeStock <= 3 ? (
                        <span className="text-[9px] font-bold text-amber-600">
                          {sizeStock} left
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= STOCK STATUS & NOTIFICATION ================= */}
          <div>
            {isOutOfStock ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs font-bold text-red-700">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                <span>Currently out of stock for this size/color combination.</span>
              </div>
            ) : showLowStock ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs font-bold text-amber-900">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span>
                  Hurry! Only {currentVariantStock} item
                  {currentVariantStock > 1 ? "s" : ""} left in stock.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>In Stock & Ready for Immediate Dispatch</span>
              </div>
            )}
          </div>

          {/* ================= ADD TO CART & QUANTITY ACTION BAR ================= */}
          <div ref={mainActionRef} className="space-y-3 pt-1">
            <div className="flex items-stretch gap-3">
              {/* Stepper Quantity */}
              <div className="flex items-center justify-between border-2 border-stone-200 rounded-2xl bg-white px-2 py-1 shrink-0 min-w-[110px]">
                <button
                  type="button"
                  disabled={quantity <= 1 || isOutOfStock}
                  onClick={() => handleQuantityStep("dec")}
                  className="w-8 h-8 flex items-center justify-center font-bold text-base text-gray-700 hover:text-black disabled:opacity-30 cursor-pointer rounded-lg hover:bg-stone-100 active:scale-95"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="font-extrabold text-sm text-gray-900 px-2 select-none">
                  {quantity}
                </span>
                <button
                  type="button"
                  disabled={
                    isOutOfStock ||
                    (currentVariantStock > 0 && quantity >= currentVariantStock)
                  }
                  onClick={() => handleQuantityStep("inc")}
                  className="w-8 h-8 flex items-center justify-center font-bold text-base text-gray-700 hover:text-black disabled:opacity-30 cursor-pointer rounded-lg hover:bg-stone-100 active:scale-95"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>

              {/* Main Add to Cart Button */}
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={handleAddToCart}
                className={`flex-1 py-4 px-6 rounded-2xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer shadow-md active:scale-[0.98] ${
                  isOutOfStock
                    ? "bg-stone-200 text-gray-400 cursor-not-allowed shadow-none border border-stone-300"
                    : isAddedAnimation
                    ? "bg-emerald-600 text-white shadow-emerald-200 scale-102"
                    : "bg-black text-white hover:bg-neutral-800 hover:shadow-xl"
                }`}
              >
                {isAddedAnimation ? (
                  <>
                    <Check size={18} strokeWidth={3} className="animate-bounce" />
                    <span>Added to Bag!</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag size={18} strokeWidth={2.2} />
                    <span>{isOutOfStock ? "Out of Stock" : "Add to Bag"}</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick Buy Now Button */}
            {!isOutOfStock && (
              <button
                type="button"
                onClick={handleBuyNow}
                className="w-full py-3.5 px-6 rounded-2xl font-bold text-xs uppercase tracking-wider border-2 border-black text-black bg-white hover:bg-black hover:text-white transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <Zap size={16} fill="currentColor" />
                <span>Buy Now with 1-Click</span>
              </button>
            )}
          </div>

          {/* Garment Assurances / Trust Pillars */}
          <div className="grid grid-cols-3 gap-2.5 pt-4 border-t border-stone-200 text-center">
            <div className="p-3 bg-white rounded-xl border border-stone-200 shadow-2xs">
              <ShieldCheck size={20} className="mx-auto mb-1 text-gray-800" />
              <p className="text-[11px] font-bold text-gray-900">100% Genuine</p>
              <p className="text-[10px] text-gray-500">Quality Certified</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-stone-200 shadow-2xs">
              <Truck size={20} className="mx-auto mb-1 text-gray-800" />
              <p className="text-[11px] font-bold text-gray-900">Fast Delivery</p>
              <p className="text-[10px] text-gray-500">2-4 Days in Nepal</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-stone-200 shadow-2xs">
              <RotateCcw size={20} className="mx-auto mb-1 text-gray-800" />
              <p className="text-[11px] font-bold text-gray-900">Easy Return</p>
              <p className="text-[10px] text-gray-500">7 Days Window</p>
            </div>
          </div>
        </div>
      </div>

      {/* ================= BOTTOM CONTENT: TABS / SPECS / REVIEWS ================= */}
      <div id="product-tabs-section" className="mt-20">
        <div className="flex border-b border-stone-200">
          <button
            onClick={() => setActiveTab("reviews")}
            className={`px-6 sm:px-8 py-4 text-xs sm:text-sm font-extrabold uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center gap-2 ${
              activeTab === "reviews"
                ? "border-black text-black bg-white shadow-2xs"
                : "border-transparent text-gray-500 hover:text-black bg-stone-50"
            }`}
          >
            <span>Customer Reviews</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-black ${
                activeTab === "reviews"
                  ? "bg-black text-white"
                  : "bg-stone-200 text-gray-700"
              }`}
            >
              {reviewStats.totalReviews}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("description")}
            className={`px-6 sm:px-8 py-4 text-xs sm:text-sm font-extrabold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === "description"
                ? "border-black text-black bg-white shadow-2xs"
                : "border-transparent text-gray-500 hover:text-black bg-stone-50"
            }`}
          >
            Garment Story & Description
          </button>

          <button
            onClick={() => setActiveTab("details")}
            className={`px-6 sm:px-8 py-4 text-xs sm:text-sm font-extrabold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === "details"
                ? "border-black text-black bg-white shadow-2xs"
                : "border-transparent text-gray-500 hover:text-black bg-stone-50"
            }`}
          >
            Fabric, Care & Shipping
          </button>
        </div>

        {activeTab === "description" && (
          <div className="bg-white border border-t-0 border-stone-200 p-6 sm:p-10 rounded-b-3xl space-y-6">
            <h3 className="text-lg font-bold text-gray-900">
              About {productData.name}
            </h3>
            <p className="text-base text-gray-700 leading-relaxed max-w-3xl">
              {productData.description ||
                "A premium quality streetwear piece engineered for optimal comfort, modern silhouettes, and daily durability."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-stone-100">
              <div className="flex items-start gap-3 p-4 bg-stone-50 rounded-2xl border border-stone-200/80">
                <Layers className="w-5 h-5 text-gray-900 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                    Tailored Construction
                  </h4>
                  <p className="text-xs text-gray-600 mt-1 leading-normal">
                    Precision high-density stitching with reinforced seams designed to maintain fit after multiple wash cycles.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-stone-50 rounded-2xl border border-stone-200/80">
                <Sparkles className="w-5 h-5 text-gray-900 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                    Authentic Color Fastness
                  </h4>
                  <p className="text-xs text-gray-600 mt-1 leading-normal">
                    Specially dyed using eco-conscious pigments for rich saturation and minimal fading.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "details" && (
          <div className="bg-white border border-t-0 border-stone-200 p-6 sm:p-10 rounded-b-3xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  🧵 Fabric & Material
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  100% Super-Combed Ring Spun Heavyweight Cotton (220-240 GSM). Preshrunk fabric for true-to-size wear.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  🧼 Wash & Garment Care
                </h4>
                <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                  <li>Machine wash cold with like colors</li>
                  <li>Do not bleach or dry clean</li>
                  <li>Tumble dry low or hang in shade</li>
                  <li>Iron inside-out on low heat</li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                  🚚 Delivery & Cash on Delivery
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Dispatched from Kathmandu within 24 hours. Inside Valley delivered in 1-2 days; all other major districts within 3-4 days. Cash on delivery accepted.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "reviews" && (
          <div className="bg-white border border-t-0 border-stone-200 p-4 sm:p-8 rounded-b-3xl">
            <ReviewSection
              productId={productData._id || productData.id}
              productName={productData.name}
              onStatsUpdate={(newStats) => setReviewStats(newStats)}
            />
          </div>
        )}
      </div>

      {/* ================= RELATED PRODUCTS ================= */}
      <RelatedProducts
        category={productData.category}
        categories={productData.categories}
        subCategory={productData.subCategory}
        currentId={productData._id || productData.id}
      />

      {/* ================= STICKY MOBILE BOTTOM BAR ================= */}
      {showStickyBar && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 px-4 py-3 shadow-2xl flex items-center justify-between gap-3 animate-slide-up lg:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={currentActiveImage}
              alt={productData.name}
              className="w-11 h-11 rounded-lg object-cover bg-stone-100 border border-stone-200 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-900 truncate">
                {productData.name}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-extrabold text-[#d85b3f]">
                  {currency}
                  {finalPrice.toLocaleString()}
                </span>
                {size && (
                  <span className="text-[10px] bg-stone-100 px-1.5 py-0.5 rounded font-bold text-gray-600">
                    {size}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isOutOfStock}
            onClick={handleAddToCart}
            className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
              isOutOfStock
                ? "bg-stone-200 text-gray-400"
                : "bg-black text-white hover:bg-neutral-800 shadow-md"
            }`}
          >
            <ShoppingBag size={14} />
            <span>{isOutOfStock ? "Out" : "Add to Bag"}</span>
          </button>
        </div>
      )}

      {/* ================= SIZE GUIDE MODAL ================= */}
      {isSizeGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative border border-stone-200 animate-scale-up">
            <button
              onClick={() => setIsSizeGuideOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-gray-700 cursor-pointer"
              aria-label="Close size guide"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-1 text-gray-900">
              <Ruler size={20} className="text-[#d85b3f]" />
              <h3 className="text-lg font-black uppercase tracking-tight">
                Garment Sizing Guide
              </h3>
            </div>
            <p className="text-xs text-gray-500 mb-6">
              All garment measurements are in inches. Standard relaxed fit.
            </p>

            <div className="overflow-x-auto rounded-xl border border-stone-200 mb-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-100 text-gray-900 font-bold border-b border-stone-200">
                  <tr>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">Chest (in)</th>
                    <th className="py-2.5 px-3">Length (in)</th>
                    <th className="py-2.5 px-3">Shoulder (in)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-gray-700">
                  <tr>
                    <td className="py-2 px-3 font-bold text-gray-900">S</td>
                    <td className="py-2 px-3">38 - 40</td>
                    <td className="py-2 px-3">27</td>
                    <td className="py-2 px-3">18</td>
                  </tr>
                  <tr className="bg-stone-50/50">
                    <td className="py-2 px-3 font-bold text-gray-900">M</td>
                    <td className="py-2 px-3">40 - 42</td>
                    <td className="py-2 px-3">28</td>
                    <td className="py-2 px-3">19</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-bold text-gray-900">L</td>
                    <td className="py-2 px-3">42 - 44</td>
                    <td className="py-2 px-3">29</td>
                    <td className="py-2 px-3">20</td>
                  </tr>
                  <tr className="bg-stone-50/50">
                    <td className="py-2 px-3 font-bold text-gray-900">XL</td>
                    <td className="py-2 px-3">44 - 46</td>
                    <td className="py-2 px-3">30</td>
                    <td className="py-2 px-3">21</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-bold text-gray-900">XXL</td>
                    <td className="py-2 px-3">46 - 48</td>
                    <td className="py-2 px-3">31</td>
                    <td className="py-2 px-3">22</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3.5 bg-stone-50 rounded-2xl border border-stone-200/80 text-xs text-gray-600 flex items-start gap-2.5">
              <Info size={16} className="text-[#d85b3f] shrink-0 mt-0.5" />
              <p>
                <strong>Fit Tip:</strong> For an oversized streetwear fit, choose your normal size. For a regular fitted look, consider sizing down one size.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================= FULLSCREEN LIGHTBOX MODAL ================= */}
      {isLightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-fade-in">
          <button
            onClick={() => setIsLightboxOpen(false)}
            className="absolute top-6 right-6 z-50 w-10 h-10 rounded-full bg-white/20 hover:bg-white text-white hover:text-black flex items-center justify-center transition-all cursor-pointer"
            aria-label="Close modal"
          >
            <X size={22} />
          </button>

          {imageList.length > 1 && (
            <>
              <button
                onClick={handlePrevImage}
                className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-12 h-12 rounded-full bg-white/20 hover:bg-white text-white hover:text-black flex items-center justify-center transition-all cursor-pointer"
                aria-label="Previous image"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                onClick={handleNextImage}
                className="absolute right-6 top-1/2 -translate-y-1/2 z-50 w-12 h-12 rounded-full bg-white/20 hover:bg-white text-white hover:text-black flex items-center justify-center transition-all cursor-pointer"
                aria-label="Next image"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}

          <div className="max-w-4xl max-h-[88vh] flex flex-col items-center justify-center">
            <img
              src={currentActiveImage}
              alt={productData.name}
              className="max-h-[82vh] w-auto object-contain rounded-2xl shadow-2xl"
            />
            <p className="text-white/80 text-xs mt-3 font-semibold tracking-wider">
              {productData.name} — {activeImageIndex + 1} of {imageList.length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Product;
