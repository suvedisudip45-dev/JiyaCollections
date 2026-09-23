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
    <Link className="group relative block cursor-pointer text-[#45463f]" to={`/product/${id}`}>
      <div className="relative aspect-[4/5] overflow-hidden border border-[#e3e0d7] bg-[#ebe9e1]">
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
            <span className="bg-[#fffefa]/95 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#161714]">
              New arrival
            </span>
          )}
          {bestseller && !newInStore && (
            <span className="bg-[#5d6855]/95 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white">
              Bestseller
            </span>
          )}
        </div>

        {/* Discount Badge */}
        {discount > 0 && (
          <span className="absolute right-2 top-2 z-10 bg-[#9a5945] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
            {discount}% OFF
          </span>
        )}

        {/* Stock Status Badges */}
        {isOutOfStock ? (
          <span className="absolute bottom-2 left-2 bg-[#161714]/90 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
            OUT OF STOCK
          </span>
        ) : isLowStock ? (
          <span className="absolute bottom-2 left-2 bg-[#9a5945] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
            Only {stockQuantity} left
          </span>
        ) : null}
      </div>

      <div className="border-b border-[#dedbd1] pb-4 pt-4">
        {/* Rating summary */}
        {numRating > 0 ? (
          <div className="flex items-center gap-1.5 mb-1">
            <svg className="w-3.5 h-3.5 text-amber-500 fill-current" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="text-xs font-semibold text-[#45463f]">{numRating.toFixed(1)}</span>
            {reviewCount > 0 && (
              <span className="text-[11px] text-[#96958c]">({reviewCount})</span>
            )}
          </div>
        ) : (
          <div className="h-4"></div>
        )}

        <p className="truncate text-[15px] font-semibold text-[#272923] transition-colors group-hover:text-[#9a5945]">
          {name}
        </p>

        {discount > 0 ? (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-bold text-[#9a5945]">
              {currency}{finalPrice}
            </span>
            <span className="text-xs text-[#96958c] line-through">
              {currency}{price}
            </span>
          </div>
        ) : (
          <p className="mt-1 text-sm font-semibold text-[#161714]">
            {currency}{price}
          </p>
        )}
      </div>
    </Link>
  );
};

export default ProductItem;
