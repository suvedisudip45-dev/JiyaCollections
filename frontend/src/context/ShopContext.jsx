import { createContext, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export const ShopContext = createContext();

const ShopContextProvider = (props) => {
  const currency = "Rs ";
  const delivery_fee = 50; // fallback only — dynamic fee is calculateDeliveryFee
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [cartItems, setCartItems] = useState({});
  const [products, setProducts] = useState([]);
  const [wishlist, setWishlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("wishlist") || "[]");
    } catch {
      return [];
    }
  });
  const [token, setToken] = useState("");
  const navigate = useNavigate();

  // Shipping config from backend
  const [shippingConfig, setShippingConfig] = useState({
    sameDistrictFee: 50,
    differentDistrictFee: 120,
    freeShippingMin: 0,
  });

  const fetchShippingConfig = async () => {
    try {
      const res = await axios.get(backendUrl + "/api/shipping/config");
      if (res.data.success && res.data.config) {
        const c = res.data.config;
        setShippingConfig({
          sameDistrictFee: Number(c.sameDistrictFee ?? c.sameCityFee ?? 50),
          differentDistrictFee: Number(c.differentDistrictFee ?? c.differentCityFee ?? 120),
          freeShippingMin: Number(c.freeShippingMin ?? 0),
        });
      }
    } catch (err) {
      console.warn("Could not fetch shipping config, using defaults.", err.message);
    }
  };

  // Authoritative backend shipping rate calculation
  const calculateShippingRate = async (district, province = "", subtotal = 0) => {
    try {
      const res = await axios.get(backendUrl + "/api/shipping/calculate", {
        params: { district, province, subtotal },
      });
      if (res.data.success) {
        return res.data;
      }
    } catch (err) {
      console.error("Error fetching calculated shipping rate:", err);
    }
    return {
      fee: shippingConfig.differentDistrictFee || 120,
      tier: "DIFFERENT_DISTRICT",
      label: "Outside District Delivery",
      sameDistrictFee: shippingConfig.sameDistrictFee,
      differentDistrictFee: shippingConfig.differentDistrictFee,
    };
  };

  // Backwards compatibility helper for instant display
  const calculateDeliveryFee = (district, subtotal) => {
    const freeMin = Number(shippingConfig.freeShippingMin || 0);
    if (freeMin > 0 && subtotal >= freeMin) return 0;
    const dest = (district || "").trim().toLowerCase();
    const ktmCluster = ["kathmandu", "lalitpur", "bhaktapur"];
    if (dest && ktmCluster.includes(dest)) {
      return shippingConfig.sameDistrictFee;
    }
    return shippingConfig.differentDistrictFee;
  };

  const getMaxStock = (product, size, color) => {
    if (!product) return 0;
    let variants = product.variants;
    if (typeof variants === "string") {
      try {
        variants = JSON.parse(variants);
      } catch (e) {
        variants = [];
      }
    }
    if (Array.isArray(variants) && variants.length > 0) {
      const s = (size || "").trim().toLowerCase();
      const c = (color || "").trim().toLowerCase();

      if (s && c) {
        const matched = variants.find(
          (v) =>
            (v.size || "").trim().toLowerCase() === s &&
            (v.color || "").trim().toLowerCase() === c
        );
        if (matched && matched.quantity !== undefined && matched.quantity !== null) {
          return Math.max(0, Number(matched.quantity));
        }
        return 0; // Specific variant combination does not exist
      } else if (s) {
        const matchingSizes = variants.filter(
          (v) => (v.size || "").trim().toLowerCase() === s
        );
        if (matchingSizes.length > 0) {
          return matchingSizes.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
        }
        return 0;
      } else if (c) {
        const matchingColors = variants.filter(
          (v) => (v.color || "").trim().toLowerCase() === c
        );
        if (matchingColors.length > 0) {
          return matchingColors.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
        }
        return 0;
      }
      return variants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
    }
    return Math.max(0, Number(product.stockQuantity ?? 0));
  };

  const addToCart = async (itemId, size, color) => {
    if (!size) {
      toast.error("Select Product Size");
      return;
    }
    if (!color) {
      toast.error("Select Product Color");
      return;
    }

    const itemInfo = products.find((product) => product._id === itemId || product.id === itemId);
    const maxStock = getMaxStock(itemInfo, size, color);
    const variantKey = `${size}-${color}`;
    const currentQty = (cartItems[itemId] && cartItems[itemId][variantKey]) || 0;

    if (maxStock <= 0) {
      toast.error("This product/variant is out of stock");
      return;
    }

    if (currentQty + 1 > maxStock) {
      toast.error(`Cannot add more. Only ${maxStock} item${maxStock > 1 ? "s" : ""} available in stock.`);
      return;
    }

    let cartData = structuredClone(cartItems);

    if (cartData[itemId]) {
      if (cartData[itemId][variantKey]) {
        cartData[itemId][variantKey] += 1;
      } else {
        cartData[itemId][variantKey] = 1;
      }
    } else {
      cartData[itemId] = {};
      cartData[itemId][variantKey] = 1;
    }
    setCartItems(cartData);

    if (!token) {
      localStorage.setItem("cartItems", JSON.stringify(cartData));
    }

    toast.success(`Added to cart — ${size} / ${color}`, {
      position: "bottom-right",
      autoClose: 2000,
      hideProgressBar: true,
    });

    if (token) {
      try {
        const response = await axios.post(
          backendUrl + "/api/cart/add",
          { itemId, size, color },
          { headers: { token } }
        );
        if (response.data && !response.data.success) {
          toast.error(response.data.message || "Failed to add to cart");
          // Revert local state
          getUserCart(token);
        }
      } catch (error) {
        console.error("Cart add error:", error);
        toast.error(error.message);
      }
    }
  };

  const getCartCount = () => {
    let totalCount = 0;
    for (const items in cartItems) {
      for (const item in cartItems[items]) {
        try {
          if (cartItems[items][item] > 0) {
            totalCount += cartItems[items][item];
          }
        } catch (error) {
          /* empty */
        }
      }
    }
    return totalCount;
  };

  const toggleWishlist = (itemId) => {
    setWishlist((current) => {
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId];
      localStorage.setItem("wishlist", JSON.stringify(next));
      return next;
    });
  };

  const updateQuantity = async (itemId, size, color, quantity) => {
    let cartData = structuredClone(cartItems);
    const variantKey = `${size}-${color}`;

    if (quantity > 0) {
      const itemInfo = products.find((product) => product._id === itemId || product.id === itemId);
      const maxStock = getMaxStock(itemInfo, size, color);
      if (maxStock <= 0) {
        toast.error("This product/variant is out of stock");
        quantity = 0;
      } else if (quantity > maxStock) {
        toast.error(`Only ${maxStock} item${maxStock > 1 ? "s" : ""} available in stock`);
        quantity = maxStock;
      }
    }

    if (quantity <= 0) {
      if (cartData[itemId]) {
        delete cartData[itemId][variantKey];
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      }
    } else {
      if (!cartData[itemId]) {
        cartData[itemId] = {};
      }
      cartData[itemId][variantKey] = quantity;
    }

    setCartItems(cartData);

    if (!token) {
      localStorage.setItem("cartItems", JSON.stringify(cartData));
    }

    if (token) {
      try {
        const response = await axios.post(
          backendUrl + "/api/cart/update",
          { itemId, size, color, quantity },
          { headers: { token } }
        );
        if (response.data && !response.data.success) {
          toast.error(response.data.message || "Failed to update cart");
          getUserCart(token);
        }
      } catch (error) {
        console.error("Cart update error:", error);
        toast.error(error.message);
      }
    }
  };

  const getCartAmount = () => {
    let totalAmount = 0;
    for (const items in cartItems) {
      let itemsInfo = products.find((product) => product._id === items);
      if (!itemsInfo) continue;
      for (const item in cartItems[items]) {
        try {
          if (cartItems[items][item] > 0) {
            const effectivePrice = itemsInfo.discount > 0
              ? Math.round(itemsInfo.price * (1 - itemsInfo.discount / 100))
              : itemsInfo.price;
            totalAmount += effectivePrice * cartItems[items][item];
          }
        } catch (error) {
          // empty
        }
      }
    }
    return totalAmount;
  };

  const getProductsData = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/product/list");
      if (response.data.success) {
        setProducts(response.data.products);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const getUserCart = async (userToken) => {
    if (!userToken) return;
    try {
      // Check if there are local guest items to sync with user account
      const storedGuestCart = localStorage.getItem("cartItems");
      let guestCartObj = null;
      if (storedGuestCart) {
        try {
          guestCartObj = JSON.parse(storedGuestCart);
        } catch (e) {
          guestCartObj = null;
        }
      }

      if (guestCartObj && Object.keys(guestCartObj).length > 0) {
        const syncRes = await axios.post(
          backendUrl + "/api/cart/sync",
          { localCart: guestCartObj },
          { headers: { token: userToken } }
        );
        if (syncRes.data.success) {
          setCartItems(syncRes.data.cartData || {});
          localStorage.removeItem("cartItems");
          return;
        }
      }

      const response = await axios.post(
        backendUrl + "/api/cart/get",
        {},
        { headers: { token: userToken } }
      );
      if (response.data.success) {
        setCartItems(response.data.cartData || {});
      } else {
        const msg = (response.data.message || "").toLowerCase();
        if (
          msg.includes("not authorized") ||
          msg.includes("jwt") ||
          msg.includes("user not found") ||
          msg.includes("invalid token")
        ) {
          // Clear stale or expired token so app reflects logged out state
          localStorage.removeItem("token");
          setToken("");
        }
      }
    } catch (error) {
      console.error("Error fetching user cart:", error);
    }
  };

  useEffect(() => {
    getProductsData();
    fetchShippingConfig();
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    if (storedToken) {
      setToken(storedToken);
      getUserCart(storedToken);
    } else {
      const storedCart = localStorage.getItem("cartItems");
      if (storedCart) {
        try {
          setCartItems(JSON.parse(storedCart));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (token) {
      getUserCart(token);
    }
  }, [token]);

  const value = {
    products,
    currency,
    delivery_fee,
    shippingConfig,
    calculateDeliveryFee,
    calculateShippingRate,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    cartItems,
    addToCart,
    setCartItems,
    getCartCount,
    updateQuantity,
    getCartAmount,
    navigate,
    backendUrl,
    setToken,
    token,
    getMaxStock,
    getProductsData,
    getUserCart,
    wishlist,
    toggleWishlist,
  };

  return (
    <ShopContext.Provider value={value}>{props.children}</ShopContext.Provider>
  );
};

export default ShopContextProvider;
