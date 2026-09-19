/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import { assets } from "../assets/assets";
import CartTotal from "../components/CartTotal";

const Cart = () => {
  const { products, currency, cartItems, updateQuantity, navigate, getMaxStock } =
    useContext(ShopContext);

  const [cartData, setCartData] = useState([]);

  useEffect(() => {
    if (products.length > 0) {
      const tempData = [];
      for (const items in cartItems) {
        for (const item in cartItems[items]) {
          if (cartItems[items][item] > 0) {
            const [size, color] = item.split("-");
            tempData.push({
              _id: items,
              size: size,
              color: color || "",
              quantity: cartItems[items][item],
            });
          }
        }
      }
      setCartData(tempData);
    }
  }, [cartItems, products]);

  return (
    <div className="border-t pt-14">
      <div className="text-2xl mb-3">
        <Title text1={"YOUR"} text2={"CART"} />
      </div>
      <div>
        {cartData.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">Your cart is currently empty.</p>
            <button
              onClick={() => navigate("/collection")}
              className="mt-4 bg-black text-white px-6 py-2 text-sm rounded hover:bg-gray-800"
            >
              Shop Now
            </button>
          </div>
        ) : (
          cartData.map((item, index) => {
            const productData = products.find(
              (product) => product._id === item._id
            );
            if (!productData) return null;
            const maxStock = getMaxStock(productData, item.size, item.color);
            const isOutOfStock = maxStock <= 0;
            const isOverStock = !isOutOfStock && item.quantity > maxStock;

            // Find variety-specific image if available
            let itemImage = Array.isArray(productData.image) ? productData.image[0] : productData.image;
            let parsedVars = typeof productData.variants === "string"
              ? JSON.parse(productData.variants || "[]")
              : (productData.variants || []);
            if (Array.isArray(parsedVars)) {
              const matchedVar = parsedVars.find(
                (v) =>
                  (!item.size || (v.size || "").toLowerCase() === item.size.toLowerCase()) &&
                  (!item.color || (v.color || "").toLowerCase() === item.color.toLowerCase()) &&
                  v.image
              );
              if (matchedVar && matchedVar.image) {
                itemImage = matchedVar.image;
              }
            }

            return (
              <div
                key={index}
                className={`py-4 border-t border-b text-gray-700 grid grid-cols-[4fr_0.5fr_0.5fr] sm:grid-cols-[4fr_2fr_0.5fr] items-center gap-4 ${
                  isOutOfStock ? "bg-red-50/50 border-red-200" : ""
                }`}
              >
                <div className="flex items-start gap-6">
                  <img
                    className={`w-16 sm:w-20 rounded-xl object-cover aspect-square border border-gray-100 shadow-2xs ${
                      isOutOfStock ? "opacity-60 grayscale" : ""
                    }`}
                    src={itemImage}
                    alt={productData.name}
                  />
                  <div>
                    <p className="text-xs sm:text-lg font-medium">
                      {productData.name}
                    </p>
                    <div className="flex items-center gap-3 sm:gap-5 mt-2 flex-wrap">
                      {productData.discount > 0 ? (
                        <p className="flex items-center gap-2">
                          <span className="font-semibold text-red-600">
                            {currency}{Math.round(productData.price * (1 - productData.discount / 100))}
                          </span>
                          <span className="text-xs text-gray-400 line-through">
                            {currency}{productData.price}
                          </span>
                        </p>
                      ) : (
                        <p>
                          {currency} {productData.price}
                        </p>
                      )}
                      <p className="px-2 sm:px-3 sm:py-1 border bg-slate-50 text-xs sm:text-sm font-semibold">
                        Size: {item.size}
                      </p>
                      {item.color && (
                        <p className="px-2 sm:px-3 sm:py-1 border bg-slate-50 text-xs sm:text-sm font-semibold">
                          Color: {item.color}
                        </p>
                      )}
                      {isOutOfStock ? (
                        <span className="text-xs text-red-700 font-bold bg-red-100 px-2.5 py-1 rounded-md border border-red-300">
                          🚫 Out of Stock
                        </span>
                      ) : maxStock > 0 ? (
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          Max available: {maxStock}
                        </span>
                      ) : null}
                    </div>
                    {isOutOfStock && (
                      <p className="text-xs text-red-600 font-bold mt-1.5 flex items-center gap-1">
                        <span>⚠️</span> This item has 0 units available. Please delete it to proceed.
                      </p>
                    )}
                    {isOverStock && (
                      <p className="text-xs text-amber-700 font-medium mt-1">
                        ⚠️ Requested quantity exceeds available stock ({maxStock}).
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <input
                    disabled={isOutOfStock}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || val === "0") return;
                      const num = Number(val);
                      updateQuantity(
                        item._id,
                        item.size,
                        item.color,
                        num
                      );
                    }}
                    className={`border max-w-14 sm:max-w-20 px-2 py-1 text-center rounded ${
                      isOutOfStock ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""
                    }`}
                    type="number"
                    min={1}
                    max={maxStock > 0 ? maxStock : 1}
                    value={item.quantity}
                  />
                </div>
                <img
                  onClick={() => updateQuantity(item._id, item.size, item.color, 0)}
                  className="w-4 mr-4 sm:w-5 cursor-pointer hover:opacity-75 transition-opacity"
                  src={assets.bin_icon}
                  alt="Delete"
                  title="Remove from cart"
                />
              </div>
            );
          })
        )}
      </div>
      <div className="flex justify-end my-20">
        <div className="w-full sm:w-[450px]">
          <CartTotal />
          <div className="w-full text-end">
            <button
              onClick={() => {
                // Check if any item in cart is out of stock or exceeds stock
                for (const item of cartData) {
                  const productData = products.find((p) => p._id === item._id);
                  if (!productData) continue;
                  const maxStock = getMaxStock(productData, item.size, item.color);
                  if (maxStock <= 0) {
                    alert(`"${productData.name}" (${item.size}/${item.color || 'Default'}) is out of stock. Please remove it from your cart before checkout.`);
                    return;
                  }
                  if (item.quantity > maxStock) {
                    alert(`"${productData.name}" (${item.size}/${item.color || 'Default'}) only has ${maxStock} item(s) in stock. Please adjust your quantity.`);
                    return;
                  }
                }
                navigate("/place-order");
              }}
              className="bg-black text-white text-sm my-8 px-8 py-3 hover:bg-gray-800 transition-colors rounded shadow-md cursor-pointer active:scale-95"
            >
              PROCEED TO CHECKOUT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;
