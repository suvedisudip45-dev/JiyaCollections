import { prisma } from "../config/db.js";

// Helper: Calculate available stock for a product and optional variant
const getProductAvailableStock = (product, size, color) => {
  if (!product) return 0;
  let variants = product.variants;
  if (typeof variants === "string") {
    try {
      variants = JSON.parse(variants);
    } catch {
      variants = [];
    }
  }
  if (!Array.isArray(variants)) variants = [];

  const itemSize = (size || "").trim().toLowerCase();
  const itemColor = (color || "").trim().toLowerCase();

  if (variants.length > 0) {
    let matched = null;
    if (itemSize && itemColor) {
      matched = variants.find(
        (v) =>
          (v.size || "").trim().toLowerCase() === itemSize &&
          (v.color || "").trim().toLowerCase() === itemColor
      );
    } else if (itemSize) {
      matched = variants.find(
        (v) => (v.size || "").trim().toLowerCase() === itemSize
      );
    } else if (itemColor) {
      matched = variants.find(
        (v) => (v.color || "").trim().toLowerCase() === itemColor
      );
    }

    if (matched) {
      return Math.max(0, Number(matched.quantity ?? 0));
    }
    return variants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
  }

  return Math.max(0, Number(product.stockQuantity ?? 0));
};

// add products to user cart
const addToCart = async (req, res) => {
  try {
    const { userId, itemId, size, color } = req.body;
    const [userData, product] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.product.findUnique({ where: { id: itemId } }),
    ]);

    if (!userData) {
      return res.json({ success: false, message: "User not found" });
    }
    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    const maxStock = getProductAvailableStock(product, size, color);
    if (maxStock <= 0) {
      return res.json({
        success: false,
        message: "This product / variant is currently out of stock.",
      });
    }

    let cartData = structuredClone(userData.cartData || {});
    const variantKey = color ? `${size}-${color}` : size;
    const currentQty = (cartData[itemId] && cartData[itemId][variantKey]) || 0;

    if (currentQty + 1 > maxStock) {
      return res.json({
        success: false,
        message: `Cannot add more. Only ${maxStock} item${maxStock > 1 ? "s" : ""} available in stock.`,
      });
    }

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

    await prisma.user.update({
      where: { id: userId },
      data: { cartData },
    });
    res.json({ success: true, message: "Added To Cart" });
  } catch (error) {
    console.error("addToCart error:", error);
    res.json({ success: false, message: error.message });
  }
};

// update user cart
const updateCart = async (req, res) => {
  try {
    const { userId, itemId, size, color, quantity } = req.body;
    const [userData, product] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.product.findUnique({ where: { id: itemId } }),
    ]);

    if (!userData) {
      return res.json({ success: false, message: "User not found" });
    }

    let cartData = structuredClone(userData.cartData || {});
    const variantKey = color ? `${size}-${color}` : size;

    if (!cartData[itemId]) {
      cartData[itemId] = {};
    }

    if (quantity <= 0) {
      delete cartData[itemId][variantKey];
      if (Object.keys(cartData[itemId]).length === 0) {
        delete cartData[itemId];
      }
    } else {
      const maxStock = getProductAvailableStock(product, size, color);
      if (maxStock <= 0) {
        delete cartData[itemId][variantKey];
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
        await prisma.user.update({
          where: { id: userId },
          data: { cartData },
        });
        return res.json({
          success: false,
          message: "This item is out of stock and was removed from your cart.",
        });
      }

      if (quantity > maxStock) {
        cartData[itemId][variantKey] = maxStock;
        await prisma.user.update({
          where: { id: userId },
          data: { cartData },
        });
        return res.json({
          success: false,
          message: `Only ${maxStock} item(s) available in stock. Quantity adjusted.`,
        });
      }

      cartData[itemId][variantKey] = quantity;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { cartData },
    });
    res.json({ success: true, message: "Cart Updated" });
  } catch (error) {
    console.error("updateCart error:", error);
    res.json({ success: false, message: error.message });
  }
};

// get user cart data
const getUserCart = async (req, res) => {
  try {
    const { userId } = req.body;
    const userData = await prisma.user.findUnique({ where: { id: userId } });
    if (!userData) {
      return res.json({ success: false, message: "User not found" });
    }
    let cartData = userData.cartData || {};

    res.json({ success: true, cartData });
  } catch (error) {
    console.error("getUserCart error:", error);
    res.json({ success: false, message: error.message });
  }
};

// sync guest cart into user cart upon login
const syncCart = async (req, res) => {
  try {
    const { userId, localCart } = req.body;
    const userData = await prisma.user.findUnique({ where: { id: userId } });
    if (!userData) {
      return res.json({ success: false, message: "User not found" });
    }

    let cartData = structuredClone(userData.cartData || {});
    if (localCart && typeof localCart === "object") {
      for (const itemId in localCart) {
        if (!cartData[itemId]) {
          cartData[itemId] = {};
        }
        for (const variantKey in localCart[itemId]) {
          const qty = Number(localCart[itemId][variantKey]) || 0;
          if (qty > 0) {
            cartData[itemId][variantKey] = Math.max(
              Number(cartData[itemId][variantKey] || 0),
              qty
            );
          }
        }
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { cartData },
    });

    res.json({ success: true, cartData });
  } catch (error) {
    console.error("syncCart error:", error);
    res.json({ success: false, message: error.message });
  }
};

export { addToCart, updateCart, getUserCart, syncCart };


