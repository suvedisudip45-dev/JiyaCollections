/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import { NEPAL_CITIES, NEPAL_PROVINCES } from "../data/nepalLocations";
import { NEPAL_DISTRICTS_BY_PROVINCE } from "../data/nepalDistricts";
import ShippingLabelModal from "../components/ShippingLabelModal";
import { Link, useNavigate } from "react-router-dom";

const SOCIAL_CHANNELS = [
  { id: "Instagram", name: "Instagram", icon: "📷", color: "from-pink-500 to-purple-600", text: "text-pink-600", bg: "bg-pink-50 border-pink-200" },
  { id: "Facebook", name: "Facebook", icon: "📘", color: "from-blue-600 to-blue-700", text: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  { id: "TikTok", name: "TikTok", icon: "🎵", color: "from-gray-900 to-gray-800", text: "text-gray-900", bg: "bg-gray-100 border-gray-300" },
  { id: "Twitter", name: "Twitter / X", icon: "🐦", color: "from-slate-700 to-black", text: "text-slate-800", bg: "bg-slate-100 border-slate-300" },
  { id: "WhatsApp", name: "WhatsApp", icon: "💬", color: "from-emerald-500 to-green-600", text: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
  { id: "Direct", name: "Phone / Direct", icon: "📞", color: "from-amber-500 to-orange-600", text: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
];

const PAYMENT_METHODS = [
  { id: "COD", label: "Cash on Delivery (COD)", desc: "Payment collected at delivery" },
  { id: "Bank Transfer / QR", label: "Bank Transfer / QR", desc: "Fonepay / Mobile Banking" },
  { id: "eSewa", label: "eSewa Wallet", desc: "Paid through eSewa" },
  { id: "Khalti", label: "Khalti Wallet", desc: "Paid through Khalti" },
  { id: "Cash", label: "Direct Cash", desc: "Direct payment received" },
];

const CreateOrder = ({ token }) => {
  const navigate = useNavigate();

  // Client Details state
  const [client, setClient] = useState({
    source: "Instagram",
    socialUsername: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    gender: "PREFER_NOT_TO_SAY",
    province: "Bagmati Province",
    district: "Kathmandu",
    city: "Kathmandu",
    ncmBranch: "Kathmandu",
    landmark: "",
    street: "",
    state: "Bagmati Province",
    zipcode: "44600",
    country: "Nepal",
    orderNotes: "",
  });

  const [ncmBranches, setNcmBranches] = useState([]);
  const [loadingNcmBranches, setLoadingNcmBranches] = useState(false);

  // Selected Order Items: list of { productId, name, image, size, color, quantity, originalUnitPrice, discountPercentage, purchasedUnitPrice, stockAvailable }
  const [selectedItems, setSelectedItems] = useState([]);

  // Financials & Payment state
  const [discountAmount, setDiscountAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [isPaid, setIsPaid] = useState(false);
  const [initialStatus, setInitialStatus] = useState("Order Placed");
  const [customDeliveryFee, setCustomDeliveryFee] = useState("");
  const [useCustomShipping, setUseCustomShipping] = useState(false);

  // Available Products & Categories
  const [allProducts, setAllProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [shippingConfig, setShippingConfig] = useState(null);
  const [catalogCategoriesList, setCatalogCategoriesList] = useState(["Men", "Women", "Kids"]);

  // Product Selection Modal state
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All");

  // Inline Quick Search state
  const [quickSearchQuery, setQuickSearchQuery] = useState("");
  const [quickSearchResults, setQuickSearchResults] = useState([]);

  // Draft variant selections in modal: map of productId -> { size, color, quantity }
  const [modalDrafts, setModalDrafts] = useState({});

  // Submitting state & Print Label Modal state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrderForPrint, setCreatedOrderForPrint] = useState(null);
  const [isPrintingModalActive, setIsPrintingModalActive] = useState(false);

  // Load Shipping Config, Products & Categories
  useEffect(() => {
    fetchShippingConfig();
    fetchCategories();
    fetchProducts();
  }, [token]);

  const fetchCategories = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/category/list`);
      if (res.data.success && Array.isArray(res.data.categories)) {
        const names = res.data.categories
          .map((c) => (typeof c === "string" ? c : c.name))
          .filter(Boolean);
        if (names.length > 0) {
          setCatalogCategoriesList((prev) =>
            Array.from(new Set([...prev, ...names]))
          );
        }
      }
    } catch (e) {
      console.error("Failed to load categories for order creation:", e);
    }
  };

  const fetchShippingConfig = async () => {
    try {
      const res = await axios.get(`${backendUrl}/api/shipping/config`);
      if (res.data.success && res.data.config) {
        setShippingConfig(res.data.config);
      }
    } catch (e) {
      console.error("Failed to load shipping config:", e);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoadingProducts(true);
      const res = await axios.get(`${backendUrl}/api/product/list`, {
        headers: { token },
      });
      if (res.data.success) {
        const prods = res.data.products || [];
        setAllProducts(prods);

        // Dynamically include any categories that products are tagged with
        const prodCats = [];
        prods.forEach((p) => {
          if (Array.isArray(p.categories)) {
            prodCats.push(...p.categories);
          } else if (typeof p.category === "string" && p.category) {
            prodCats.push(...p.category.split(",").map((c) => c.trim()));
          }
        });
        if (prodCats.length > 0) {
          setCatalogCategoriesList((prev) =>
            Array.from(new Set([...prev, ...prodCats.filter(Boolean)]))
          );
        }
      } else {
        toast.error(res.data.message);
      }
    } catch (e) {
      console.error("Failed to fetch products:", e);
      toast.error("Failed to fetch products catalog");
    } finally {
      setLoadingProducts(false);
    }
  };

  // Client form changes handler
  const handleClientChange = (e) => {
    const { name, value } = e.target;
    setClient((prev) => {
      const updated = { ...prev, [name]: value };

      if (name === "province") {
        const nextDistrict = NEPAL_DISTRICTS_BY_PROVINCE[value]?.[0] || "";
        updated.province = value;
        updated.state = value;
        updated.district = nextDistrict;
        updated.city = nextDistrict;
        updated.ncmBranch = nextDistrict;
        updated.zipcode = "";
      }

      if (name === "district") {
        updated.district = value;
        updated.city = value;
        updated.ncmBranch = value;
      }

      if (name === "city") {
        updated.city = value;
        updated.ncmBranch = value;
        const found = NEPAL_CITIES.find(
          (c) => c.name.toLowerCase() === value.trim().toLowerCase()
        );
        if (found) {
          updated.state = found.province;
          updated.province = found.province;
          updated.zipcode = found.zipcode;
        }
      }

      if (name === "ncmBranch") {
        updated.ncmBranch = value;
        updated.city = value;
      }

      return updated;
    });
  };

  useEffect(() => {
    const fetchNcmBranches = async () => {
      if (!client.province || !client.district) {
        setNcmBranches([]);
        return;
      }

      setLoadingNcmBranches(true);
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: { province: client.province, district: client.district },
        });

        if (response.data.success) {
          setNcmBranches(response.data.branches || []);
        } else {
          setNcmBranches([]);
        }
      } catch (error) {
        setNcmBranches([]);
        console.error("Failed to load NCM branches for admin order:", error);
      } finally {
        setLoadingNcmBranches(false);
      }
    };

    fetchNcmBranches();
  }, [backendUrl, client.province, client.district]);

  // Calculate items subtotal
  const itemsSubtotal = useMemo(() => {
    return selectedItems.reduce(
      (sum, item) => sum + (Number(item.purchasedUnitPrice || item.price || 0) * Number(item.quantity || 1)),
      0
    );
  }, [selectedItems]);

  // Dynamic Shipping Fee according to shipment rates (ShippingConfig)
  const calculatedShippingFee = useMemo(() => {
    if (!shippingConfig) return 50;
    const destCity = (client.city || "").trim().toLowerCase();
    const baseCity = (shippingConfig.baseCity || "Kathmandu").trim().toLowerCase();
    const freeMin = Number(shippingConfig.freeShippingMin || 0);

    if (freeMin > 0 && itemsSubtotal >= freeMin) {
      return 0;
    }
    if (destCity && destCity === baseCity) {
      return Number(shippingConfig.sameCityFee ?? 50);
    }
    return Number(shippingConfig.differentCityFee ?? 120);
  }, [shippingConfig, client.city, itemsSubtotal]);

  // Resolved Shipping Fee (auto vs custom override)
  const activeShippingFee = useMemo(() => {
    if (useCustomShipping && customDeliveryFee !== "") {
      return Math.max(0, Number(customDeliveryFee) || 0);
    }
    return calculatedShippingFee;
  }, [useCustomShipping, customDeliveryFee, calculatedShippingFee]);

  // Discount validation & Grand Total
  const activeDiscount = Math.max(0, Number(discountAmount) || 0);
  const grandTotal = Math.max(0, itemsSubtotal + activeShippingFee - activeDiscount);

  // Filter products for Catalog Modal
  const filteredCatalogProducts = useMemo(() => {
    return allProducts.filter((p) => {
      if (!p.published) return false;
      const pCats = Array.isArray(p.categories) && p.categories.length > 0
        ? p.categories
        : (p.category ? [p.category] : []);
      const matchesCategory =
        catalogCategory === "All" ||
        pCats.some((c) => c.toLowerCase() === catalogCategory.toLowerCase());
      const query = catalogSearch.trim().toLowerCase();
      const matchesSearch =
        !query ||
        p.name?.toLowerCase().includes(query) ||
        pCats.some((c) => c.toLowerCase().includes(query)) ||
        p.subCategory?.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [allProducts, catalogCategory, catalogSearch]);

  // Instant quick search
  useEffect(() => {
    if (!quickSearchQuery.trim()) {
      setQuickSearchResults([]);
      return;
    }
    const q = quickSearchQuery.toLowerCase();
    const matches = allProducts
      .filter((p) => {
        if (!p.published) return false;
        const pCats = Array.isArray(p.categories) && p.categories.length > 0
          ? p.categories
          : (p.category ? [p.category] : []);
        return (
          p.name?.toLowerCase().includes(q) ||
          pCats.some((c) => c.toLowerCase().includes(q)) ||
          p.subCategory?.toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
    setQuickSearchResults(matches);
  }, [quickSearchQuery, allProducts]);

  // Helper to get product price snapshot
  const getProductPricing = (product) => {
    const originalPrice = Number(product.price || 0);
    const discount = Number(product.discount || 0);
    const finalPrice = discount > 0 ? Math.round(originalPrice * (1 - discount / 100)) : originalPrice;
    return { originalPrice, discount, finalPrice };
  };

  // Helper to parse product variants safely
  const parseVariants = (product) => {
    if (!product) return [];
    if (Array.isArray(product.variants)) return product.variants;
    if (typeof product.variants === "string") {
      try {
        return JSON.parse(product.variants);
      } catch {
        return [];
      }
    }
    return [];
  };

  // Parse product sizes safely
  const parseSizes = (product) => {
    if (!product) return [];
    if (Array.isArray(product.sizes)) return product.sizes;
    if (typeof product.sizes === "string") {
      try {
        return JSON.parse(product.sizes);
      } catch {
        return [];
      }
    }
    return [];
  };

  // Parse product colors safely
  const parseColors = (product) => {
    if (!product) return [];
    if (Array.isArray(product.colors)) return product.colors;
    if (typeof product.colors === "string") {
      try {
        return JSON.parse(product.colors);
      } catch {
        return [];
      }
    }
    return [];
  };

  // Check available stock for a product variant, taking into account items already added to the order draft
  const getAvailableStock = (product, size, color) => {
    if (!product) return 0;
    const variants = parseVariants(product);

    let rawStock = 0;
    if (size && color && variants.length > 0) {
      const matchV = variants.find((v) => v.size === size && v.color === color);
      rawStock = matchV && matchV.quantity !== undefined ? Number(matchV.quantity) : 0;
    } else if (variants.length > 0) {
      const matching = variants.filter(
        (v) => (!size || v.size === size) && (!color || v.color === color)
      );
      rawStock = matching.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
    } else {
      rawStock = Number(product.stockQuantity || 0);
    }

    const pId = product._id || product.id;
    const alreadyAdded = selectedItems
      .filter(
        (it) =>
          it.productId === pId &&
          (!size || it.size === size) &&
          (!color || it.color === color)
      )
      .reduce((sum, it) => sum + Number(it.quantity || 0), 0);

    return Math.max(0, rawStock - alreadyAdded);
  };

  // Check if a product has any stock available across all variants
  const isProductInStock = (product) => {
    if (!product) return false;
    const variants = parseVariants(product);
    if (variants.length > 0) {
      return variants.some((v) => Number(v.quantity || 0) > 0);
    }
    return Number(product.stockQuantity || 0) > 0;
  };

  // Initialize draft for a product (automatically pre-selecting an in-stock variant if available)
  const getDraftForProduct = (product) => {
    const pId = product._id || product.id;
    if (modalDrafts[pId]) return modalDrafts[pId];

    const sizes = parseSizes(product);
    const colors = parseColors(product);
    const variants = parseVariants(product);

    // Pick first variant that actually has stock if available
    const inStockVariant = variants.find((v) => Number(v.quantity || 0) > 0);
    const initialSize = inStockVariant?.size || (sizes.length > 0 ? sizes[0] : "");
    const initialColor = inStockVariant?.color || (colors.length > 0 ? colors[0] : "");

    return {
      size: initialSize,
      color: initialColor,
      quantity: 1,
    };
  };

  const updateDraft = (pId, key, value) => {
    setModalDrafts((prev) => ({
      ...prev,
      [pId]: {
        ...(prev[pId] || {}),
        [key]: value,
      },
    }));
  };

  // Add a product item to the order ONLY if available in stock
  const addItemToOrder = (product, sizeChoice, colorChoice, quantityChoice) => {
    const pId = product._id || product.id;
    const { originalPrice, discount, finalPrice } = getProductPricing(product);
    const size = sizeChoice || parseSizes(product)[0] || "";
    const color = colorChoice || parseColors(product)[0] || "";
    const requestedQty = Math.max(1, Number(quantityChoice) || 1);

    const availableStock = getAvailableStock(product, size, color);

    // Strict availability verification: if out of stock, reject immediately
    if (availableStock <= 0) {
      toast.error(
        `"${product.name}" (${size ? size : "Standard"}${color ? "/" + color : ""}) is Out of Stock and cannot be added.`
      );
      return;
    }

    const effectiveQty = Math.min(requestedQty, availableStock);

    setSelectedItems((prev) => {
      // If same product, size, and color is already in order, increase quantity
      const existingIdx = prev.findIndex(
        (item) => item.productId === pId && item.size === size && item.color === color
      );

      if (existingIdx !== -1) {
        const updated = [...prev];
        const newQty = updated[existingIdx].quantity + effectiveQty;
        
        // Find raw variant stock limit
        const variants = parseVariants(product);
        let rawMax = product.stockQuantity || 999;
        if (size && color && variants.length > 0) {
          const matchV = variants.find((v) => v.size === size && v.color === color);
          if (matchV && matchV.quantity !== undefined) rawMax = Number(matchV.quantity);
        }

        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: Math.min(newQty, rawMax),
        };
        toast.info(
          `Updated quantity for "${product.name}" (${size}) to ${updated[existingIdx].quantity}`
        );
        return updated;
      }

      // Otherwise append new item
      const newItem = {
        productId: pId,
        _id: pId,
        name: product.name,
        image: Array.isArray(product.image) ? product.image : [product.image].filter(Boolean),
        category: Array.isArray(product.categories) && product.categories.length > 0
          ? product.categories.join(", ")
          : (product.category || ""),
        categories: Array.isArray(product.categories) ? product.categories : (product.category ? [product.category] : []),
        subCategory: product.subCategory || "",
        size,
        color,
        quantity: effectiveQty,
        originalUnitPrice: originalPrice,
        discountPercentage: discount,
        purchasedUnitPrice: finalPrice,
        price: finalPrice,
        stockAvailable: availableStock,
      };

      toast.success(`Added "${product.name}" (${size}) to order!`);
      return [...prev, newItem];
    });
  };

  // Modify quantity of selected item with strict stock ceiling
  const handleQuantityChange = (idx, newQty) => {
    if (newQty <= 0) {
      removeItemFromOrder(idx);
      return;
    }

    const item = selectedItems[idx];
    const prod = allProducts.find((p) => (p._id || p.id) === item.productId);

    // Compute raw maximum stock for this variant from catalog
    let rawMax = item.stockAvailable || 999;
    if (prod) {
      const variants = parseVariants(prod);
      if (item.size && item.color && variants.length > 0) {
        const matchV = variants.find((v) => v.size === item.size && v.color === item.color);
        if (matchV && matchV.quantity !== undefined) rawMax = Number(matchV.quantity);
      } else if (prod.stockQuantity !== undefined) {
        rawMax = Number(prod.stockQuantity);
      }
    }

    if (newQty > rawMax) {
      toast.warning(
        `Cannot exceed available stock (${rawMax}) for "${item.name}" (${item.size}/${item.color})`
      );
      return;
    }

    setSelectedItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity: newQty };
      return updated;
    });
  };

  // Remove item from order
  const removeItemFromOrder = (idx) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Submit Order to backend
  const handleSubmitOrder = async (e) => {
    e.preventDefault();

    // Validations
    if (!client.firstName.trim()) {
      toast.error("Please enter the client's First Name.");
      return;
    }
    if (!client.phone.trim()) {
      toast.error("Please enter the client's Contact Phone Number.");
      return;
    }
    const deliveryLocation = (client.city || client.ncmBranch || client.district || "").trim();
    if (!deliveryLocation) {
      toast.error("Please specify the delivery City.");
      return;
    }
    if (!client.landmark.trim()) {
      toast.error("Please enter a Nearest Landmark / Nearby Location for accurate courier delivery.");
      return;
    }
    if (selectedItems.length === 0) {
      toast.error("Please select at least one product before placing the order.");
      return;
    }

    try {
      setIsSubmitting(true);

      const payload = {
        client: {
          ...client,
          firstName: client.firstName.trim(),
          lastName: client.lastName.trim(),
          phone: client.phone.trim(),
          email: client.email.trim(),
          gender: client.gender || "PREFER_NOT_TO_SAY",
          province: client.province || client.state || "Bagmati Province",
          district: client.district || client.city || "Kathmandu",
          city: client.city || client.ncmBranch || client.district || "Kathmandu",
          ncmBranch: client.ncmBranch || client.city || client.district || "Kathmandu",
          landmark: client.landmark.trim(),
          street: client.street.trim(),
          state: client.state || client.province || "Bagmati Province",
        },
        items: selectedItems,
        discount: activeDiscount,
        deliveryFee: activeShippingFee,
        paymentMethod,
        payment: isPaid,
        status: initialStatus,
      };

      const res = await axios.post(`${backendUrl}/api/order/admin-create`, payload, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success(`Order created successfully! (ID: #${res.data.orderId.slice(-6).toUpperCase()})`);
        
        // Store created order object for immediate printing modal
        setCreatedOrderForPrint(res.data.order);
      } else {
        toast.error(res.data.message || "Failed to create order");
      }
    } catch (err) {
      console.error("Error creating order:", err);
      toast.error(err.response?.data?.message || err.message || "Error submitting order");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset form for another order
  const handleResetForm = () => {
    setClient({
      source: "Instagram",
      socialUsername: "",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      gender: "PREFER_NOT_TO_SAY",
      province: "Bagmati Province",
      district: "Kathmandu",
      city: "Kathmandu",
      ncmBranch: "Kathmandu",
      landmark: "",
      street: "",
      state: "Bagmati Province",
      zipcode: "44600",
      country: "Nepal",
      orderNotes: "",
    });
    setSelectedItems([]);
    setDiscountAmount("");
    setPaymentMethod("COD");
    setIsPaid(false);
    setInitialStatus("Order Placed");
    setCustomDeliveryFee("");
    setUseCustomShipping(false);
    setCreatedOrderForPrint(null);
    setIsPrintingModalActive(false);
  };

  return (
    <div className="pb-16 max-w-7xl mx-auto">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg text-lg">
              📦
            </span>
            <div>
              <h2 className="text-2xl font-bold text-gray-800 tracking-tight">
                Add Social Media & Direct Order
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Record new customer orders received from Instagram, Facebook, TikTok, Twitter / X, WhatsApp, or phone inquiries.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/orders"
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 shadow-xs transition-all"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Orders</span>
          </Link>

          <button
            type="button"
            onClick={handleResetForm}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-all"
          >
            Clear Form
          </button>
        </div>
      </div>

      {/* Main Grid: Left Column for Client Info, Right Column for Product Selection & Pricing */}
      <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ================= LEFT COLUMN: CLIENT & SOCIAL DETAILS (5 cols) ================= */}
        <div className="lg:col-span-5 space-y-6">
          {/* Social Channel Selector Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
              <span>🌐</span> Order Source Channel
            </h3>
            
            <div className="grid grid-cols-3 gap-2">
              {SOCIAL_CHANNELS.map((ch) => {
                const isSelected = client.source === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setClient((prev) => ({ ...prev, source: ch.id }))}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                      isSelected
                        ? `${ch.bg} ${ch.text} ring-2 ring-indigo-500/40 shadow-xs scale-[1.02]`
                        : "bg-gray-50/70 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-xl mb-1">{ch.icon}</span>
                    <span className="truncate w-full text-center">{ch.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Social Username / Profile Handle */}
            <div className="mt-4">
              <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                Social Username / Profile Link (Optional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">@</span>
                <input
                  type="text"
                  name="socialUsername"
                  placeholder="e.g. sitashrestha or FB profile link"
                  value={client.socialUsername}
                  onChange={handleClientChange}
                  className="w-full pl-7 pr-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Client Identity & Contact Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <span>👤</span> Customer Details
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  First Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="firstName"
                  required
                  placeholder="First name"
                  value={client.firstName}
                  onChange={handleClientChange}
                  className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  name="lastName"
                  placeholder="Last name"
                  value={client.lastName}
                  onChange={handleClientChange}
                  className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                Gender
              </label>
              <select
                name="gender"
                value={client.gender}
                onChange={handleClientChange}
                className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Contact Number <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">📞</span>
                  <input
                    type="tel"
                    name="phone"
                    required
                    placeholder="98XXXXXXXX"
                    value={client.phone}
                    onChange={handleClientChange}
                    className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">✉️</span>
                  <input
                    type="email"
                    name="email"
                    placeholder="customer@email.com"
                    value={client.email}
                    onChange={handleClientChange}
                    className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Delivery Address Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                <span>📍</span> Delivery Location
              </h3>
              <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full">
                For 4x6 Dispatch Slip
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Province <span className="text-rose-500">*</span>
                </label>
                <select
                  name="province"
                  value={client.province}
                  onChange={handleClientChange}
                  className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none font-medium text-gray-800"
                >
                  {NEPAL_PROVINCES.map((province) => (
                    <option key={province} value={province}>{province}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  District <span className="text-rose-500">*</span>
                </label>
                <select
                  name="district"
                  value={client.district}
                  onChange={handleClientChange}
                  className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none font-medium text-gray-800"
                >
                  {(NEPAL_DISTRICTS_BY_PROVINCE[client.province] || []).map((district) => (
                    <option key={district} value={district}>{district}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                NCM Branch / Delivery Town <span className="text-rose-500">*</span>
              </label>
              <select
                name="ncmBranch"
                value={client.ncmBranch}
                onChange={handleClientChange}
                disabled={loadingNcmBranches || ncmBranches.length === 0}
                className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none font-medium text-gray-800 disabled:opacity-50"
              >
                {loadingNcmBranches ? (
                  <option value="">Loading NCM branches...</option>
                ) : ncmBranches.length === 0 ? (
                  <option value="">No branch available in this district</option>
                ) : (
                  ncmBranches.map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))
                )}
              </select>
            </div>

            {/* Landmark (CRITICAL for courier delivery) */}
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
              <label className="block text-[11px] font-extrabold text-amber-900 uppercase tracking-wider mb-1 flex items-center gap-1">
                <span>🚩</span> Nearby Landmark / Delivery Spot <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="landmark"
                required
                placeholder="e.g. Near Siddhartha Bank, Opposite Civil Mall, Beside Water Tank"
                value={client.landmark}
                onChange={handleClientChange}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-300 rounded-lg focus:border-amber-600 focus:outline-none font-medium text-gray-900"
              />
              <p className="text-[10px] text-amber-700 mt-1">
                Required for courier dispatch riders to locate destination quickly without failed deliveries.
              </p>
            </div>

            {/* Street Address / Tol */}
            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                Street Address / Tol / House Details
              </label>
              <input
                type="text"
                name="street"
                placeholder="e.g. New Road, Pipalbot Chowk, House #42"
                value={client.street}
                onChange={handleClientChange}
                className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Delivery / Order Notes */}
            <div>
              <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                Order Notes / Courier Instructions (Optional)
              </label>
              <textarea
                name="orderNotes"
                rows="2"
                placeholder="e.g. Call before 2 PM, leave with neighbor if unavailable"
                value={client.orderNotes}
                onChange={handleClientChange}
                className="w-full px-3 py-2 text-xs bg-gray-50/50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
              ></textarea>
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN: PRODUCTS, MULTI-SELECT & FINANCIALS (7 cols) ================= */}
        <div className="lg:col-span-7 space-y-6">
          {/* Product Selection Control Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <span>👗</span> Product Selection
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Search instantly or open the visual catalog to pick sizes, colors, and multiple items.
                </p>
              </div>

              {/* BIG BUTTON: OPEN PRODUCT CATALOG */}
              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span>Browse Product Catalog</span>
              </button>
            </div>

            {/* Quick Search Bar */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
              <input
                type="text"
                placeholder="Type to quickly search products by name, category, or subcategory..."
                value={quickSearchQuery}
                onChange={(e) => setQuickSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50/60 border border-gray-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
              {quickSearchQuery && (
                <button
                  type="button"
                  onClick={() => setQuickSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}

              {/* Instant Quick Search Dropdown */}
              {quickSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-30 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                  <div className="p-2 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-500">
                    Quick Search Matches ({quickSearchResults.length})
                  </div>
                  {quickSearchResults.map((prod) => {
                    const { originalPrice, discount, finalPrice } = getProductPricing(prod);
                    const sizes = parseSizes(prod);
                    const colors = parseColors(prod);
                    const imgUrl = Array.isArray(prod.image) ? prod.image[0] : prod.image;
                    const inStock = isProductInStock(prod);
                    const variants = parseVariants(prod);
                    const availableVar = variants.find((v) => Number(v.quantity || 0) > 0);

                    return (
                      <div
                        key={prod._id || prod.id}
                        className="p-3 border-b border-gray-100 last:border-b-0 hover:bg-indigo-50/40 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {imgUrl ? (
                            <img src={imgUrl} alt={prod.name} className="w-10 h-10 object-cover rounded-lg border border-gray-200" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-[10px] text-gray-400">
                              Item
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-gray-800 line-clamp-1">{prod.name}</p>
                              {inStock ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full">
                                  In Stock
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded-full">
                                  Out of Stock
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400">
                              {prod.category} &bull; {prod.subCategory}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs font-extrabold text-indigo-700">{currency} {finalPrice}</span>
                              {discount > 0 && (
                                <span className="text-[10px] line-through text-gray-400">{currency} {originalPrice}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {inStock ? (
                            <button
                              type="button"
                              onClick={() => {
                                addItemToOrder(
                                  prod,
                                  availableVar?.size || sizes[0] || "",
                                  availableVar?.color || colors[0] || "",
                                  1
                                );
                                setQuickSearchQuery("");
                              }}
                              className="px-3 py-1 bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-all shadow-2xs"
                            >
                              + Quick Add
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="px-3 py-1 bg-gray-100 text-gray-400 border border-gray-200 rounded-lg text-xs font-bold cursor-not-allowed"
                            >
                              Out of Stock
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Selected Order Items Table */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                <span>🛒</span> Order Items ({selectedItems.length})
              </h3>
              {selectedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedItems([])}
                  className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold"
                >
                  Remove All
                </button>
              )}
            </div>

            {selectedItems.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-gray-200 rounded-xl text-center">
                <span className="text-3xl mb-2 inline-block">🛍️</span>
                <p className="text-xs font-bold text-gray-700">No products added yet</p>
                <p className="text-[11px] text-gray-400 mt-0.5 max-w-xs mx-auto">
                  Click &ldquo;Browse Product Catalog&rdquo; above or use the quick search bar to add items with size and color choices.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCatalogModalOpen(true)}
                  className="mt-3 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-semibold"
                >
                  Browse Catalog
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto pr-1">
                {selectedItems.map((item, idx) => {
                  const imgUrl = Array.isArray(item.image) ? item.image[0] : item.image;
                  const itemLineTotal = (item.purchasedUnitPrice || item.price || 0) * (item.quantity || 1);

                  return (
                    <div key={idx} className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {imgUrl ? (
                          <img src={imgUrl} alt={item.name} className="w-12 h-12 object-cover rounded-xl border border-gray-200" />
                        ) : (
                          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-xs text-gray-400">
                            Item
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-bold text-gray-800 line-clamp-1">{item.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                            {item.size && (
                              <span className="px-1.5 py-0.2 bg-gray-100 text-gray-700 rounded font-semibold border border-gray-200">
                                Size: {item.size}
                              </span>
                            )}
                            {item.color && (
                              <span className="px-1.5 py-0.2 bg-gray-100 text-gray-700 rounded font-medium border border-gray-200">
                                Color: {item.color}
                              </span>
                            )}
                            <span className="text-gray-400">|</span>
                            <span className="text-gray-600 font-semibold">{currency} {item.purchasedUnitPrice || item.price} each</span>
                          </div>
                        </div>
                      </div>

                      {/* Quantity Stepper & Subtotal */}
                      <div className="flex items-center gap-4">
                        <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleQuantityChange(idx, item.quantity - 1)}
                            className="px-2 py-1 text-gray-500 hover:bg-gray-200 text-xs font-bold"
                          >
                            -
                          </button>
                          <span className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleQuantityChange(idx, item.quantity + 1)}
                            className="px-2 py-1 text-gray-500 hover:bg-gray-200 text-xs font-bold"
                          >
                            +
                          </button>
                        </div>

                        <div className="text-right w-20">
                          <p className="text-xs font-extrabold text-gray-800">{currency} {itemLineTotal}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItemFromOrder(idx)}
                          className="text-gray-400 hover:text-rose-600 p-1"
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pricing, Shipping Rates, Manual Discount & Payment Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <span>💳</span> Shipping, Discount & Order Summary
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {/* Shipping Rate Calculation Display */}
              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-indigo-900 uppercase">
                    Shipment Rate Rule
                  </span>
                  <button
                    type="button"
                    onClick={() => setUseCustomShipping(!useCustomShipping)}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-semibold"
                  >
                    {useCustomShipping ? "Reset to Auto" : "Manual Override"}
                  </button>
                </div>

                {!useCustomShipping ? (
                  <div>
                    <p className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                      <span>🚚</span> {client.city} Delivery:{" "}
                      <span className="text-indigo-700 text-sm">
                        {calculatedShippingFee === 0 ? "FREE" : `${currency} ${calculatedShippingFee}`}
                      </span>
                    </p>
                    <p className="text-[10px] text-indigo-600 mt-0.5">
                      {shippingConfig?.baseCity?.toLowerCase() === client.city?.toLowerCase()
                        ? `Same City (${shippingConfig?.baseCity}) standard rate`
                        : `Outside City dispatch courier rate`}
                      {shippingConfig?.freeShippingMin > 0 && (
                        <span> &bull; Free above {currency} {shippingConfig.freeShippingMin}</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-indigo-900 uppercase mb-1">
                      Custom Delivery Fee ({currency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 0 or 80"
                      value={customDeliveryFee}
                      onChange={(e) => setCustomDeliveryFee(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-indigo-300 rounded-lg focus:outline-none font-bold"
                    />
                  </div>
                )}
              </div>

              {/* MANUAL DISCOUNT AMOUNT BOX */}
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl space-y-1.5">
                <label className="block text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
                  Manual Discount Amount ({currency})
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-700 font-bold text-xs">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Enter discount if any (e.g. 150)"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-emerald-300 rounded-lg focus:border-emerald-600 focus:outline-none font-bold text-emerald-900"
                  />
                </div>
                <p className="text-[10px] text-emerald-700">
                  Direct discount applied to client order (e.g. promotional or social coupon).
                </p>
              </div>
            </div>

            {/* Payment Method & Payment Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-gray-50/60 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none font-medium"
                >
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Payment Status
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsPaid(false)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      !isPaid
                        ? "bg-amber-100 text-amber-900 border-amber-300 shadow-2xs"
                        : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    Pending (COD)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPaid(true)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      isPaid
                        ? "bg-emerald-600 text-white border-emerald-700 shadow-2xs"
                        : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    ✓ Paid / Received
                  </button>
                </div>
              </div>
            </div>

            {/* Financials Breakdown */}
            <div className="p-4 bg-gray-50/80 rounded-xl border border-gray-100 space-y-2 text-xs">
              <div className="flex justify-between items-center text-gray-600">
                <span>Items Subtotal:</span>
                <span className="font-semibold text-gray-800">{currency} {itemsSubtotal}</span>
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span>Delivery Fee (as per shipment rates):</span>
                <span className="font-semibold text-gray-800">
                  {activeShippingFee > 0 ? `${currency} ${activeShippingFee}` : "FREE"}
                </span>
              </div>
              {activeDiscount > 0 && (
                <div className="flex justify-between items-center text-emerald-700 font-semibold">
                  <span>Manual Discount:</span>
                  <span>- {currency} {activeDiscount}</span>
                </div>
              )}
              <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                <span className="text-sm font-bold text-gray-900">Total Order Amount:</span>
                <span className="text-xl font-black text-indigo-700">
                  {currency} {grandTotal}
                </span>
              </div>
            </div>

            {/* Place Order CTA */}
            <button
              type="submit"
              disabled={isSubmitting || selectedItems.length === 0}
              className={`w-full py-3 rounded-xl text-sm font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                isSubmitting || selectedItems.length === 0
                  ? "bg-gray-300 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] shadow-indigo-200"
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing Order...</span>
                </>
              ) : (
                <>
                  <span>✓ Place Order for Client</span>
                  <span>&bull;</span>
                  <span>{currency} {grandTotal}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ================= MODAL: VISUAL PRODUCT CATALOG PICKER ================= */}
      {isCatalogModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/80">
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  Select Products from Catalog
                </h3>
                <p className="text-xs text-gray-500">
                  Choose items, customize size and color, and add multiple products to the order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-600 text-sm font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Search & Category Filter Bar */}
            <div className="p-4 border-b border-gray-100 bg-white flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-80">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                <input
                  type="text"
                  placeholder="Search products by title or category..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                {["All", ...catalogCategoriesList].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCatalogCategory(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                      catalogCategory === cat
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Products Grid Content */}
            <div className="p-5 overflow-y-auto flex-1 bg-gray-50/40">
              {loadingProducts ? (
                <div className="p-12 text-center">
                  <div className="inline-block animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-2" />
                  <p className="text-xs font-semibold text-gray-600">Loading catalog...</p>
                </div>
              ) : filteredCatalogProducts.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <span className="text-3xl mb-2 inline-block">🔍</span>
                  <p className="text-sm font-bold text-gray-700">No products match your search</p>
                  <p className="text-xs text-gray-400 mt-1">Try a different category or search term.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {filteredCatalogProducts.map((product) => {
                    const pId = product._id || product.id;
                    const { originalPrice, discount, finalPrice } = getProductPricing(product);
                    const sizes = parseSizes(product);
                    const colors = parseColors(product);
                    const draft = getDraftForProduct(product);
                    const imgUrl = Array.isArray(product.image) ? product.image[0] : product.image;

                    const productHasAnyStock = isProductInStock(product);
                    const currentStock = getAvailableStock(product, draft.size, draft.color);
                    const isVariantAvailable = currentStock > 0;

                    return (
                      <div
                        key={pId}
                        className={`bg-white rounded-xl border p-3.5 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between ${
                          !productHasAnyStock
                            ? "border-gray-200 opacity-75 bg-gray-50/50"
                            : !isVariantAvailable
                            ? "border-rose-200"
                            : "border-gray-200"
                        }`}
                      >
                        <div>
                          {/* Image & Price Header */}
                          <div className="relative rounded-lg overflow-hidden bg-gray-100 mb-2.5 h-40 flex items-center justify-center">
                            {imgUrl ? (
                              <img src={imgUrl} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-gray-400 text-xs">No Image</span>
                            )}

                            {/* Badges */}
                            <div className="absolute top-2 left-2 flex flex-col gap-1">
                              {discount > 0 && (
                                <span className="bg-rose-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow-xs">
                                  {discount}% OFF
                                </span>
                              )}
                              {!productHasAnyStock && (
                                <span className="bg-red-700 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide shadow-xs">
                                  OUT OF STOCK
                                </span>
                              )}
                            </div>

                            <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-xs text-white text-xs font-extrabold px-2 py-0.5 rounded">
                              {currency} {finalPrice}
                            </span>
                          </div>

                          <div className="flex items-start justify-between gap-1 mb-1">
                            <h4 className="font-bold text-gray-800 text-xs line-clamp-1">{product.name}</h4>
                          </div>

                          <p className="text-[10px] text-gray-400 mb-2">
                            {(Array.isArray(product.categories) && product.categories.length > 0
                              ? product.categories.join(", ")
                              : product.category || "")} &bull; {product.subCategory}
                          </p>

                          {/* Live Availability Badge for selected variant */}
                          <div className="mb-2.5">
                            {isVariantAvailable ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                In Stock ({currentStock} available)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                Out of Stock
                              </span>
                            )}
                          </div>

                          {/* Size Selection Pills */}
                          {sizes.length > 0 && (
                            <div className="mb-2">
                              <span className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                Size:
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {sizes.map((s) => {
                                  const sizeHasStock = parseVariants(product).some(
                                    (v) => v.size === s && Number(v.quantity || 0) > 0
                                  );
                                  const isSelected = draft.size === s;

                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      onClick={() => updateDraft(pId, "size", s)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                                        isSelected
                                          ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                          : !sizeHasStock
                                          ? "bg-gray-100 text-gray-400 border-gray-200 line-through"
                                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                                      }`}
                                      title={!sizeHasStock ? `${s} is Out of Stock` : `Select ${s}`}
                                    >
                                      {s}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Color Selection Pills */}
                          {colors.length > 0 && (
                            <div className="mb-3">
                              <span className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                Color:
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {colors.map((c) => {
                                  const isSelected = draft.color === c;
                                  const colorStock = getAvailableStock(product, draft.size, c);
                                  const isColorAvailable = colorStock > 0;

                                  return (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => updateDraft(pId, "color", c)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                                        isSelected
                                          ? "bg-gray-900 text-white border-gray-900 shadow-2xs"
                                          : !isColorAvailable
                                          ? "bg-gray-100 text-gray-400 border-gray-200 line-through"
                                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                                      }`}
                                      title={!isColorAvailable ? `${c} (${draft.size}) is Out of Stock` : c}
                                    >
                                      {c}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Quantity Stepper & Add Button */}
                        <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                          <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
                            <button
                              type="button"
                              disabled={!isVariantAvailable || (draft.quantity || 1) <= 1}
                              onClick={() =>
                                updateDraft(
                                  pId,
                                  "quantity",
                                  Math.max(1, (draft.quantity || 1) - 1)
                                )
                              }
                              className="px-2 py-1 text-gray-600 text-xs font-bold hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              -
                            </button>
                            <span className="px-2.5 py-1 text-xs font-bold text-gray-800 bg-white">
                              {isVariantAvailable ? (draft.quantity || 1) : 0}
                            </span>
                            <button
                              type="button"
                              disabled={
                                !isVariantAvailable ||
                                (draft.quantity || 1) >= currentStock
                              }
                              onClick={() =>
                                updateDraft(
                                  pId,
                                  "quantity",
                                  Math.min(currentStock, (draft.quantity || 1) + 1)
                                )
                              }
                              className="px-2 py-1 text-gray-600 text-xs font-bold hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              +
                            </button>
                          </div>

                          {isVariantAvailable ? (
                            <button
                              type="button"
                              onClick={() => {
                                addItemToOrder(
                                  product,
                                  draft.size,
                                  draft.color,
                                  Math.min(draft.quantity || 1, currentStock)
                                );
                              }}
                              className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 flex items-center justify-center gap-1"
                            >
                              <span>+ Add to Order</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="flex-1 py-1.5 bg-gray-100 text-gray-400 border border-gray-200 rounded-lg text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1 shadow-none"
                              title="Selected size and color is out of stock"
                            >
                              <span>🚫 Out of Stock</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Bottom Confirmation Bar */}
            <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-between">
              <div className="text-xs">
                <span className="text-gray-500">Currently in Order:</span>{" "}
                <strong className="text-indigo-700 font-bold">{selectedItems.length} products</strong> &bull; Total:{" "}
                <strong className="text-gray-900 font-extrabold">{currency} {itemsSubtotal}</strong>
              </div>

              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
              >
                Done Selecting Items
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ORDER CREATION SUCCESS MODAL & COURIER PRINT SLIP ================= */}
      {createdOrderForPrint && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 text-center border border-gray-200 animate-in zoom-in-95 duration-150">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
              ✓
            </div>

            <h3 className="text-xl font-extrabold text-gray-900">
              Order Placed Successfully!
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Order <strong className="text-gray-800">#{createdOrderForPrint._id?.slice(-8).toUpperCase()}</strong> has been recorded in the database.
            </p>

            <div className="my-4 p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs text-left space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Client:</span>
                <span className="font-bold text-gray-800">
                  {createdOrderForPrint.address?.firstName} {createdOrderForPrint.address?.lastName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Channel:</span>
                <span className="font-semibold text-indigo-700">
                  {createdOrderForPrint.address?.source || "Social Media"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Destination:</span>
                <span className="font-semibold text-gray-800">
                  {createdOrderForPrint.address?.city} (📍 {createdOrderForPrint.address?.landmark})
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-gray-200">
                <span className="font-bold text-gray-700">Grand Total:</span>
                <span className="font-black text-indigo-700">{currency} {createdOrderForPrint.amount}</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsPrintingModalActive(true)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Print 4x6 Courier Shipping Slip</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-all"
                >
                  + Add Another Order
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/orders")}
                  className="flex-1 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-xs font-semibold transition-all"
                >
                  View in Orders List
                </button>
              </div>
            </div>
          </div>

          {/* Render Shipping Label Modal when button clicked */}
          {isPrintingModalActive && (
            <ShippingLabelModal
              order={createdOrderForPrint}
              currency={currency}
              onClose={() => setIsPrintingModalActive(false)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default CreateOrder;
