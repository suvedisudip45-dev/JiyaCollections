/* eslint-disable no-unused-vars */
/* eslint-disable react/prop-types */
import React, { useContext } from "react";
import { ShopContext } from "../context/ShopContext";
import { Link } from "react-router-dom";

const ProductItem = ({
  id,
  image,
  name,
  price,
  discount,
  stockStatus,
  stockQuantity,
  variants,
  rating,
  reviewCount,
  newInStore,
  bestseller,
}) => {
  const { currency } = useContext(ShopContext);
  const finalPrice = discount > 0 ? Math.round(price * (1 - discount / 100)) : price;

  let parsedVariants = typeof variants === "string" ? JSON.parse(variants || "[]") : variants;
  const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;
  const effectiveStock = hasVariants
    ? parsedVariants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0)
    : Number(stockQuantity ?? 0);

  const isOutOfStock = effectiveStock <= 0;
  const isLowStock = effectiveStock > 0 && effectiveStock < 10;
  const numRating = Number(rating) || 0;

  return (
    <Link className="text-gray-700 cursor-pointer block relative group transition-transform duration-200 hover:-translate-y-0.5" to={`/product/${id}`}>
      <div className="overflow-hidden relative rounded-xl bg-gray-100 aspect-square border border-gray-100 shadow-2xs">
        <img
          className={`hover:scale-105 transition ease-out duration-300 w-full h-full object-cover ${
            isOutOfStock ? "opacity-60 grayscale" : ""
          }`}
          src={Array.isArray(image) ? image[0] : image}
          alt={name}
          loading="lazy"
        />

        {/* Top Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
          {newInStore && (
            <span className="bg-gray-900 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md shadow-xs uppercase tracking-wider">
              NEW IN STORE
            </span>
          )}
          {bestseller && !newInStore && (
            <span className="bg-amber-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md shadow-xs uppercase tracking-wider">
              BESTSELLER
            </span>
          )}
        </div>

        {/* Discount Badge */}
        {discount > 0 && (
          <span className="absolute top-2 right-2 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-md shadow-xs z-10">
            {discount}% OFF
          </span>
        )}

        {/* Stock Status Badges */}
        {isOutOfStock ? (
          <span className="absolute bottom-2 left-2 bg-gray-900/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md shadow-xs">
            OUT OF STOCK
          </span>
        ) : isLowStock ? (
          <span className="absolute bottom-2 left-2 bg-amber-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md shadow-xs">
            Only {stockQuantity} left
          </span>
        ) : null}
      </div>

      <div className="pt-2.5 pb-1">
        {/* Rating summary */}
        {numRating > 0 ? (
          <div className="flex items-center gap-1.5 mb-1">
            <svg className="w-3.5 h-3.5 text-amber-500 fill-current" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="text-xs font-semibold text-gray-800">{numRating.toFixed(1)}</span>
            {reviewCount > 0 && (
              <span className="text-[11px] text-gray-400">({reviewCount})</span>
            )}
          </div>
        ) : (
          <div className="h-4"></div>
        )}

        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-black transition-colors">
          {name}
        </p>

        {discount > 0 ? (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-bold text-red-600">
              {currency}{finalPrice}
            </span>
            <span className="text-xs text-gray-400 line-through">
              {currency}{price}
            </span>
          </div>
        ) : (
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {currency}{price}
          </p>
        )}
      </div>
    </Link>
  );
};

export default ProductItem;
