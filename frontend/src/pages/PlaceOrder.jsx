/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import Title from "../components/Title";
import CartTotal from "../components/CartTotal";
import { assets } from "../assets/assets";
import { ShopContext } from "../context/ShopContext";
import axios from "axios";
import { toast } from "react-toastify";
import NepalMapModal from "../components/NepalMapModal";
import {
  NEPAL_CITIES,
  NEPAL_PROVINCES,
  getCityInfo,
} from "../data/nepalLocations";
import { NEPAL_DISTRICTS_BY_PROVINCE } from "../data/nepalDistricts";

const isValidNepalMobileNumber = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.replace(/^0+/, "").replace(/^977/, "");
  return /^9[78]\d{8}$/.test(normalized);
};

const PlaceOrder = () => {
  const [
    method, setMethod
  ] = useState("cod");
  const {
    navigate,
    backendUrl,
    token,
    cartItems,
    setCartItems,
    getCartAmount,
    delivery_fee,
    shippingConfig,
    calculateDeliveryFee,
    calculateShippingRate,
    products,
    getMaxStock,
    getProductsData,
  } = useContext(ShopContext);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    landmark: "",
    district: "Kathmandu",
    city: "",
    ncmBranch: "",
    province: "Bagmati Province",
    state: "Bagmati Province",
    country: "Nepal",
  });

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState(null);
  const [saveAddressForFuture, setSaveAddressForFuture] = useState(true);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ncmBranches, setNcmBranches] = useState([]);
  const [coveredAreas, setCoveredAreas] = useState([]);
  const [loadingNcmBranches, setLoadingNcmBranches] = useState(false);

  // Dynamic delivery fee - recalculated when city changes
  const [dynamicDeliveryFee, setDynamicDeliveryFee] = useState(delivery_fee);
  const [shippingTierLabel, setShippingTierLabel] = useState("");
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loyaltyDiscountAmount, setLoyaltyDiscountAmount] = useState(0);
  const [loyaltyDiscountLabel, setLoyaltyDiscountLabel] = useState("");
  const [loyaltyGiftInfo, setLoyaltyGiftInfo] = useState(null); // { amount, description, letterIncluded, customPerk }

  // Fetch logged-in user profile & saved addresses & loyalty status
  const fetchUserProfile = async () => {
    if (!token) return;
    try {
      setLoadingProfile(true);
      const [profRes, loyRes] = await Promise.all([
        axios.get(`${backendUrl}/api/user/profile`, { headers: { token } }),
        axios.get(`${backendUrl}/api/loyalty/my-status`, { headers: { token } }),
      ]);

      if (profRes.data.success && profRes.data.user) {
        const u = profRes.data.user;
        const addresses = u.addresses || [];
        setSavedAddresses(addresses);

        // If user has saved addresses, pre-fill with the first/most recent
        if (addresses.length > 0) {
          const firstAddr = addresses[0];
          setSelectedSavedId(firstAddr.id);
          setFormData((prev) => ({
            ...prev,
            firstName: firstAddr.firstName || u.firstName || "",
            lastName: firstAddr.lastName || u.lastName || "",
            email: firstAddr.email || u.email || "",
            phone: firstAddr.phone || u.phone || "",
            street: firstAddr.street || "",
            landmark: firstAddr.landmark || "",
            district: firstAddr.district || "Kathmandu",
            city: firstAddr.city || "",
            ncmBranch: firstAddr.ncmBranch || firstAddr.city || "",
            province: firstAddr.province || firstAddr.state || "Bagmati Province",
            state: firstAddr.state || "Bagmati Province",
            country: "Nepal",
          }));
        } else {
          // Pre-fill user name, email, phone from registration
          setFormData((prev) => ({
            ...prev,
            firstName: u.firstName || (u.name ? u.name.split(" ")[0] : ""),
            lastName: u.lastName || (u.name ? u.name.split(" ").slice(1).join(" ") : ""),
            email: u.email || "",
            phone: u.phone || "",
          }));
        }
      }

      if (!profRes.data.success) {
        const msg = (profRes.data.message || "").toLowerCase();
        if (msg.includes("not authorized") || msg.includes("jwt") || msg.includes("user not found")) {
          localStorage.removeItem("token");
          setToken("");
          toast.error("Session expired. Please login again.");
          navigate("/login", { state: { from: "/place-order" } });
          return;
        }
      }

      if (loyRes.data.success && loyRes.data.loyalty) {
        setLoyaltyData(loyRes.data.loyalty);
      }
    } catch (err) {
      console.error("Error fetching user profile & loyalty:", err);
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (!token) {
      toast.info("Please sign in or create an account to proceed with checkout");
      navigate("/login", { state: { from: "/place-order" } });
      return;
    }
    fetchUserProfile();
  }, [token]);


  useEffect(() => {
    const fetchDistrictBranches = async () => {
      if (!formData.province || !formData.district) {
        setNcmBranches([]);
        setCoveredAreas([]);
        return;
      }
      setLoadingNcmBranches(true);
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: { province: formData.province, district: formData.district },
        });
        setNcmBranches(response.data.success ? response.data.branches || [] : []);
      } catch (error) {
        setNcmBranches([]);
        console.error("Failed to load NCM branches for district", error);
      } finally {
        setLoadingNcmBranches(false);
      }
    };

    fetchDistrictBranches();
  }, [backendUrl, formData.province, formData.district]);

  useEffect(() => {
    const fetchCoveredAreas = async () => {
      if (!formData.city) {
        setCoveredAreas([]);
        return;
      }
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: { branch: formData.city, district: formData.district, province: formData.province },
        });
        setCoveredAreas(response.data.success ? response.data.coveredAreas || [] : []);
      } catch (error) {
        setCoveredAreas([]);
      }
    };
    fetchCoveredAreas();
  }, [backendUrl, formData.city, formData.district, formData.province]);

  // Recalculate fee & loyalty rewards whenever district, province, shippingConfig or loyalty changes
  useEffect(() => {
    let isCancelled = false;
    const updateRates = async () => {
      const subtotal = getCartAmount();
      const district = formData.district || "Kathmandu";
      const province = formData.province || "Bagmati Province";

      let serverFee = 120;
      let serverLabel = "Outside District Delivery";

      if (calculateShippingRate) {
        const rateResult = await calculateShippingRate(district, province, subtotal);
        if (!isCancelled && rateResult) {
          serverFee = rateResult.fee !== undefined ? rateResult.fee : 120;
          serverLabel = rateResult.label || "Standard Shipping";
        }
      } else {
        serverFee = calculateDeliveryFee ? calculateDeliveryFee(district, subtotal) : 50;
      }

      if (isCancelled) return;

      let fee = serverFee;
      let tierLabel = serverLabel;

      // ---- Modular loyalty reward resolution ----
      let isLoyaltyFreeShipping = false;
      let discAmount = 0;
      let discLabel = "";
      let giftInfo = null;

      if (loyaltyData?.activeReward?.isEligible) {
        const act = loyaltyData.activeReward;
        const lvl = loyaltyData.currentLevel;
        const usageText = `Use ${act.currentUseIndex} of ${act.orderLimit}`;

        // Free Delivery
        if (act.freeShipping) {
          isLoyaltyFreeShipping = true;
          fee = 0;
          tierLabel = `Free Delivery · ${lvl.name} (${usageText})`;
        }

        // Price Discount
        if (Number(act.discountAmount) > 0) {
          discAmount = Math.min(subtotal, Number(act.discountAmount));
          const parts = [];
          if (act.freeShipping) parts.push("Free Delivery");
          parts.push(`Rs. ${discAmount} Off`);
          discLabel = `${lvl.name} · ${parts.join(" + ")} (${usageText})`;
        } else if (act.freeShipping) {
          discLabel = `${lvl.name} · Free Delivery (${usageText})`;
        }

        // Gift / Letter / Custom Perk
        if (act.giftAmount > 0 || act.giftDescription || act.letterIncluded || act.customPerk) {
          giftInfo = {
            amount: Number(act.giftAmount || 0),
            description: act.giftDescription || "",
            letterIncluded: Boolean(act.letterIncluded),
            customPerk: act.customPerk || "",
          };
        }
      }

      setShippingTierLabel(tierLabel);
      setDynamicDeliveryFee(fee);
      setLoyaltyDiscountAmount(discAmount);
      setLoyaltyDiscountLabel(discLabel);
      setLoyaltyGiftInfo(giftInfo);
    };

    updateRates();

    return () => {
      isCancelled = true;
    };
  }, [formData.district, formData.province, shippingConfig, cartItems, loyaltyData]);

  const onChangeHandler = (event) => {
    const { name, value } = event.target;

    if (name === "province") {
      const nextDistrict = NEPAL_DISTRICTS_BY_PROVINCE[value]?.[0] || "";
      setFormData((data) => ({ ...data, province: value, state: value, district: nextDistrict, city: "", ncmBranch: "", street: "" }));
      return;
    }

    if (name === "district") {
      setFormData((data) => ({ ...data, district: value, city: "", ncmBranch: "", street: "" }));
      return;
    }

    if (name === "phone") {
      setFormData((data) => ({ ...data, phone: value.replace(/[^0-9]/g, "") }));
      return;
    }

    // Keep the submitted branch synchronized with the live NCM selection.
    if (name === "city") {
      const cityInfo = getCityInfo(value);
      setFormData((data) => ({
        ...data,
        city: value,
        ncmBranch: value,
        street: "",
        state: cityInfo?.province || data.state,
      }));
      return;
    }

    setFormData((data) => ({
      ...data,
      [name]: value,
    }));
  };

  // Handle map location selected
  const handleMapLocationSelect = (loc) => {
    setSelectedSavedId(null);
    setFormData((prev) => ({
      ...prev,
      province: loc.state || prev.province,
      state: loc.state || prev.state,
      district: loc.city || prev.district,
      city: loc.city || prev.city,
      ncmBranch: "",
      street: loc.addressSnippet || loc.city || prev.street,
      landmark: loc.addressSnippet || `${loc.city || "Selected map location"} (${loc.lat}, ${loc.lng})`,
    }));
    toast.success(`Location set: ${loc.city}, ${loc.state}`);
  };

  // Select a saved address
  const handleSelectSavedAddress = (addr) => {
    setSelectedSavedId(addr.id);
    setFormData((prev) => ({
      ...prev,
      firstName: addr.firstName || prev.firstName,
      lastName: addr.lastName || prev.lastName,
      email: addr.email || prev.email,
      phone: addr.phone || prev.phone,
      street: addr.street || "",
      landmark: addr.landmark || "",
      district: addr.district || "Kathmandu",
      city: addr.city || "",
      ncmBranch: addr.ncmBranch || addr.city || "",
      province: addr.province || addr.state || "Bagmati Province",
      state: addr.state || "Bagmati Province",
      country: "Nepal",
    }));
  };

  // Delete a saved address
  const handleDeleteSavedAddress = async (e, addressId) => {
    e.stopPropagation();
    try {
      const res = await axios.post(
        `${backendUrl}/api/user/address/delete`,
        { addressId },
        { headers: { token } }
      );
      if (res.data.success) {
        setSavedAddresses(res.data.addresses || []);
        if (selectedSavedId === addressId) {
          setSelectedSavedId(null);
        }
        toast.info("Saved address removed");
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();
    if (!token) {
      toast.error("Please login to place your order");
      navigate("/login");
      return;
    }

    // Validations
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error("Please provide first and last name");
      return;
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      toast.error("Please provide a valid email address");
      return;
    }
    if (!isValidNepalMobileNumber(formData.phone)) {
      toast.error("Please provide a valid mobile number starting with 98 or 97");
      return;
    }
    if (!formData.street.trim()) {
      toast.error("Please select an NCM covered area");
      return;
    }
    if (!formData.landmark.trim()) {
      toast.error("Please provide a nearest landmark for delivery");
      return;
    }
    if (!formData.province || !formData.district || !formData.city) {
      toast.error("Please select your province, district, and NCM delivery town");
      return;
    }
    if (!ncmBranches.includes(formData.city)) {
      toast.error("Please select a valid NCM branch for this district");
      return;
    }
    if (!coveredAreas.includes(formData.street)) {
      toast.error("Please select a covered area provided by NCM");
      return;
    }

    try {
      setSubmitting(true);
      let orderItems = [];
      for (const items in cartItems) {
        for (const item in cartItems[items]) {
          if (cartItems[items][item] > 0) {
            const itemInfo = structuredClone(
              products.find((product) => product._id === items)
            );
            if (itemInfo) {
              const [size, color] = item.split("-");
              itemInfo.size = size;
              itemInfo.color = color || "";
              itemInfo.quantity = cartItems[items][item];

              const maxStock = getMaxStock(itemInfo, size, color);
              if (maxStock <= 0) {
                toast.error(`"${itemInfo.name}" (${size}/${color || 'Default'}) is out of stock.`);
                return;
              }
              if (itemInfo.quantity > maxStock) {
                toast.error(`"${itemInfo.name}" (${size}/${color || 'Default'}) exceeds available stock (${maxStock}). Please adjust your cart.`);
                return;
              }

              orderItems.push(itemInfo);
            }
          }
        }
      }

      if (orderItems.length === 0) {
        toast.error("Your cart is empty");
        return;
      }

      let orderData = {
        address: {
          ...formData,
          street: formData.street,
          province: formData.province,
          district: formData.district,
          ncmBranch: formData.ncmBranch || formData.city,
          country: "Nepal",
        },
        items: orderItems,
        deliveryFee: dynamicDeliveryFee,
        amount: getCartAmount() + dynamicDeliveryFee,
      };

      switch (method) {
        case "cod": {
          const response = await axios.post(
            backendUrl + "/api/order/place",
            orderData,
            { headers: { token } }
          );

          if (response.data.success) {
            setCartItems({});
            localStorage.removeItem("cartItems");
            if (getProductsData) {
              await getProductsData();
            }
            toast.success("Order Placed Successfully!");
            navigate("/orders");
          } else {
            toast.error(response.data.message);
          }
          break;
        }
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <form
        onSubmit={onSubmitHandler}
        className="flex flex-col lg:flex-row justify-between gap-8 pt-5 sm:pt-10 min-h-[80vh] border-t"
      >
        {/* --- Left Side: Delivery Address --- */}
        <div className="flex flex-col gap-4 w-full lg:max-w-[560px]">
          <div className="flex items-center justify-between flex-wrap gap-2 my-2">
            <div className="text-xl sm:text-2xl">
              <Title text1={"DELIVERY"} text2={"INFORMATION"} />
            </div>
            {/* Map / GPS Picker Button */}
            <button
              type="button"
              onClick={() => setIsMapOpen(true)}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
            >
              <svg className="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Choose on Map / GPS</span>
            </button>
          </div>

          {/* Saved Addresses Quick Selector */}
          {savedAddresses.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  Saved Addresses ({savedAddresses.length})
                </span>
                <span className="text-[10px] text-gray-400">Click to auto-fill</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {savedAddresses.map((addr) => {
                  const isSelected = selectedSavedId === addr.id;
                  return (
                    <div
                      key={addr.id}
                      onClick={() => handleSelectSavedAddress(addr)}
                      className={`relative p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        isSelected
                          ? "bg-black text-white border-black shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <p className={`font-semibold text-xs ${isSelected ? "text-white" : "text-gray-900"}`}>
                          {addr.city}, {addr.state?.split(" ")[0]}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSavedAddress(e, addr.id)}
                          className={`p-0.5 rounded hover:bg-red-100 ${
                            isSelected ? "text-gray-300 hover:text-red-300" : "text-gray-400 hover:text-red-600"
                          }`}
                          title="Remove saved address"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <p className={`text-[11px] truncate mt-0.5 ${isSelected ? "text-gray-200" : "text-gray-500"}`}>
                        {addr.street}
                      </p>
                      {addr.landmark && (
                        <p className={`text-[10px] truncate ${isSelected ? "text-amber-200" : "text-amber-700"}`}>
                          Landmark: {addr.landmark}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Customer Name */}
          <div className="flex gap-3">
            <div className="w-1/2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">First Name *</label>
              <input
                required
                onChange={onChangeHandler}
                name="firstName"
                value={formData.firstName}
                className="border border-gray-300 rounded-lg py-2 px-3.5 w-full text-sm focus:outline-none focus:border-black"
                type="text"
                placeholder="First name"
              />
            </div>
            <div className="w-1/2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Last Name *</label>
              <input
                required
                onChange={onChangeHandler}
                name="lastName"
                value={formData.lastName}
                className="border border-gray-300 rounded-lg py-2 px-3.5 w-full text-sm focus:outline-none focus:border-black"
                type="text"
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Contact Email & Phone */}
          <div className="flex gap-3 flex-col sm:flex-row">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address *</label>
              <input
                required
                onChange={onChangeHandler}
                name="email"
                value={formData.email}
                className="border border-gray-300 rounded-lg py-2 px-3.5 w-full text-sm focus:outline-none focus:border-black"
                type="email"
                placeholder="Email address"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Contact Phone *</label>
              <input
                required
                onChange={onChangeHandler}
                name="phone"
                value={formData.phone}
                className="border border-gray-300 rounded-lg py-2 px-3.5 w-full text-sm focus:outline-none focus:border-black"
                type="tel"
                placeholder="Phone (e.g. 9841234567)"
              />
            </div>
          </div>

          {/* Province, District, and NCM branch */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Province *
              </label>
              <select
                required
                name="province"
                value={formData.province}
                onChange={onChangeHandler}
                className="border border-gray-300 rounded-lg py-2 px-3 w-full text-sm bg-white focus:outline-none focus:border-black cursor-pointer"
              >
                {NEPAL_PROVINCES.map((province) => (
                  <option key={province} value={province}>{province}</option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                District *
              </label>
              <select
                required
                name="district"
                value={formData.district}
                onChange={onChangeHandler}
                className="border border-gray-300 rounded-lg py-2 px-3 w-full text-sm bg-white focus:outline-none focus:border-black cursor-pointer"
              >
                {(NEPAL_DISTRICTS_BY_PROVINCE[formData.province] || []).map((district) => (
                  <option key={district} value={district}>{district}</option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1">NCM Town / Branch *</label>
              <select
                required
                name="city"
                value={formData.city}
                onChange={onChangeHandler}
                disabled={loadingNcmBranches || ncmBranches.length === 0}
                className="border border-gray-300 rounded-lg py-2 px-3 w-full text-sm bg-white focus:outline-none focus:border-black cursor-pointer disabled:bg-gray-100"
              >
                <option value="">{loadingNcmBranches ? "Loading NCM branches..." : "Select NCM branch"}</option>
                {ncmBranches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
              {!loadingNcmBranches && ncmBranches.length === 0 && (
                <p className="text-[10px] text-rose-600 mt-1">NCM has no branch listed for this district.</p>
              )}
            </div>
          </div>

          {/* Covered area selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Street / Covered Area *</label>
            <select
              required
              name="street"
              value={formData.street}
              onChange={onChangeHandler}
              disabled={!formData.city || coveredAreas.length === 0}
              className="border border-gray-300 rounded-lg py-2 px-3 w-full text-sm bg-white focus:outline-none focus:border-black cursor-pointer disabled:bg-gray-100"
            >
              <option value="">{formData.city && coveredAreas.length === 0 ? "No covered areas returned by NCM" : "Select a covered area"}</option>
              {coveredAreas.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
            {formData.city && coveredAreas.length === 0 && (
              <p className="text-[11px] text-rose-600 mt-1">This branch has no covered areas in NCM. Choose another branch.</p>
            )}
          </div>

          {/* Precise nearest location */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nearest Location *</label>
            <input
              required
              onChange={onChangeHandler}
              name="landmark"
              value={formData.landmark}
              className="border border-gray-300 rounded-lg py-2 px-3.5 w-full text-sm focus:outline-none focus:border-black"
              type="text"
              placeholder="Enter nearest location or landmark"
            />
          </div>

        </div>

        {/* --- Right Side: Summary & Payment --- */}
        <div className="flex-1 lg:max-w-[420px] flex flex-col justify-between">
          <div>
            <div className="min-w-full">

              {/* ===== VIP LOYALTY REWARD BANNER ===== */}
              {loyaltyData?.activeReward?.isEligible && (
                <div className="mb-4 rounded-2xl overflow-hidden border border-amber-300 shadow-sm">
                  {/* Banner Header */}
                  <div
                    className="px-4 py-2.5 flex items-center gap-2.5"
                    style={{
                      background: `linear-gradient(135deg, #1a1a2e 0%, ${loyaltyData.currentLevel?.color || "#F59E0B"} 100%)`,
                    }}
                  >
                    <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white">
                      VIP
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-bold text-xs tracking-wide">
                        VIP REWARD APPLIED — {loyaltyData.currentLevel?.name}
                      </p>
                      <p className="text-white/70 text-[11px]">
                        {loyaltyData.activeReward.title} · Use {loyaltyData.activeReward.currentUseIndex} of {loyaltyData.activeReward.orderLimit}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold bg-amber-400 text-amber-950 px-2 py-0.5 rounded-full">
                      ACTIVE
                    </span>
                  </div>

                  {/* Perk Pills */}
                  <div className="bg-amber-50 px-4 py-3 flex flex-col gap-2">
                    {/* Free Delivery Perk */}
                    {loyaltyData.activeReward.freeShipping && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">✓</span>
                        <div className="flex-1">
                          <span className="font-bold text-emerald-800">Free Delivery</span>
                          <span className="text-emerald-600 ml-1 font-semibold">— courier fee waived on this order</span>
                        </div>
                        <span className="font-black text-emerald-700 text-sm">FREE</span>
                      </div>
                    )}

                    {/* Price Discount Perk */}
                    {Number(loyaltyData.activeReward.discountAmount) > 0 && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">%</span>
                        <div className="flex-1">
                          <span className="font-bold text-rose-800">Price Discount</span>
                          <span className="text-rose-600 ml-1">— deducted from your total</span>
                        </div>
                        <span className="font-black text-rose-700 text-sm">- Rs. {Math.min(getCartAmount(), Number(loyaltyData.activeReward.discountAmount))}</span>
                      </div>
                    )}

                    {/* Gift Voucher / Item Perk */}
                    {(Number(loyaltyData.activeReward.giftAmount) > 0 || loyaltyData.activeReward.giftDescription) && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">+</span>
                        <div className="flex-1">
                          <span className="font-bold text-indigo-800">Special Gift Included</span>
                          {loyaltyData.activeReward.giftDescription && (
                            <p className="text-indigo-600 text-[11px] mt-0.5">{loyaltyData.activeReward.giftDescription}</p>
                          )}
                        </div>
                        {Number(loyaltyData.activeReward.giftAmount) > 0 && (
                          <span className="font-black text-indigo-700 text-sm">Rs. {loyaltyData.activeReward.giftAmount}</span>
                        )}
                      </div>
                    )}

                    {/* Handwritten Letter */}
                    {loyaltyData.activeReward.letterIncluded && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">✉</span>
                        <span className="font-bold text-violet-800">Handwritten Thank-You Letter</span>
                        <span className="text-violet-600 ml-auto text-[10px] font-semibold">Included</span>
                      </div>
                    )}

                    {/* Custom VIP Perk */}
                    {loyaltyData.activeReward.customPerk && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">★</span>
                        <span className="font-bold text-amber-800">{loyaltyData.activeReward.customPerk}</span>
                      </div>
                    )}

                    {/* Remaining Uses Notice */}
                    <div className="mt-1 pt-2 border-t border-amber-200 flex items-center justify-between">
                      <p className="text-[10px] text-amber-700 font-semibold">
                        ⏳ {loyaltyData.activeReward.remainingUses - 1 > 0
                          ? `${loyaltyData.activeReward.remainingUses - 1} more reward order(s) remaining after this`
                          : `This is your last reward order for this level`
                        }
                      </p>
                      <span className="text-[10px] font-bold text-amber-900 bg-amber-200 px-1.5 py-0.5 rounded">
                        {loyaltyData.activeReward.currentUseIndex}/{loyaltyData.activeReward.orderLimit}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {/* ===== END VIP BANNER ===== */}

              {/* Dynamic Shipping Rate Badge (only shown when NOT a loyalty free delivery) */}
              {shippingTierLabel && !loyaltyData?.activeReward?.isEligible && (
                <div className={`mb-3 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  dynamicDeliveryFee === 0
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    : shippingTierLabel.includes("Inside")
                    ? "bg-sky-50 border border-sky-200 text-sky-700"
                    : "bg-amber-50 border border-amber-200 text-amber-700"
                }`}>
                  <span>{shippingTierLabel}</span>
                  <span className="ml-auto font-bold">
                    {dynamicDeliveryFee === 0 ? "FREE" : `Rs. ${dynamicDeliveryFee}`}
                  </span>
                </div>
              )}
              <CartTotal
                deliveryFee={dynamicDeliveryFee}
                shippingLabel={shippingTierLabel}
                loyaltyDiscount={loyaltyDiscountAmount}
                loyaltyLabel={loyaltyDiscountLabel}
                loyaltyGift={loyaltyGiftInfo}
              />
            </div>

            {/* Delivery Destination Badge */}
            <div className="mt-6 p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span>Delivery To: {formData.city ? `${formData.city}, ` : ""}{formData.district}, {formData.province}</span>
              </div>
              <p className="text-[11px] text-gray-500 pl-5">
                {formData.street ? formData.street : "Street address pending"} {formData.landmark && `(Near ${formData.landmark})`}
              </p>
            </div>

            <div className="mt-8">
              <Title text1={"PAYMENT"} text2={"METHOD"} />

              {/* Payment Method Selection */}
              <div className="flex gap-3 flex-col mt-3">
                <div
                  onClick={() => setMethod("cod")}
                  className="flex items-center gap-3 border p-3 rounded-xl cursor-pointer bg-white hover:border-black transition-colors"
                >
                  <p
                    className={`min-w-4 h-4 border-2 rounded-full flex items-center justify-center ${
                      method === "cod" ? "border-black bg-black" : "border-gray-300"
                    }`}
                  >
                    {method === "cod" && <span className="w-1.5 h-1.5 bg-white rounded-full"></span>}
                  </p>
                  <div>
                    <p className="text-gray-900 text-sm font-semibold">
                      CASH ON DELIVERY (COD)
                    </p>
                    <p className="text-[11px] text-gray-500">Pay safely upon delivery at your doorstep</p>
                  </div>
                </div>
              </div>

              <div className="w-full text-end mt-8">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-black text-white px-12 py-3.5 text-sm font-semibold rounded-xl hover:bg-gray-800 active:scale-95 transition-all w-full sm:w-auto shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  )}
                  <span>PLACE ORDER NOW</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Nepal Location Map Modal */}
      <NepalMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onLocationSelect={handleMapLocationSelect}
        initialCity={formData.city}
      />
    </>
  );
};

export default PlaceOrder;
