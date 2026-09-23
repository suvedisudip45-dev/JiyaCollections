/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { assets } from "../assets/assets";
import { ShopContext } from "../context/ShopContext";
import { Link } from "react-router-dom";

const Hero = () => {
  const { products, currency } = useContext(ShopContext);

  // Find the designated "New in Store" product, or fallback to the latest added product
  const featuredProduct = products.find((p) => p.newInStore) || (products.length > 0 ? products[0] : null);

  const heroImage =
    featuredProduct && featuredProduct.image && featuredProduct.image.length > 0
      ? featuredProduct.image[0]
      : assets.hero_img;

  const finalPrice = featuredProduct
    ? featuredProduct.discount > 0
      ? Math.round(featuredProduct.price * (1 - featuredProduct.discount / 100))
      : featuredProduct.price
    : null;

  return (
    <div className="relative flex flex-col items-stretch overflow-hidden border border-[#d9d6cc] bg-[#e5e2d8] sm:min-h-[560px] sm:flex-row">
      {/* Hero Left Content */}
      <div className="relative z-10 flex w-full flex-col justify-center px-7 py-12 sm:w-[45%] sm:px-10 md:px-16">
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-block h-px w-8 bg-[#9a5945] md:w-10"></span>
            <span className="eyebrow">
              {featuredProduct?.newInStore ? "FEATURED ARRIVAL" : "TRENDING NOW"}
            </span>
          </div>

          <div>
            <h1 className="prata-regular text-5xl leading-[0.95] text-[#161714] sm:text-6xl lg:text-7xl">
              New in store
            </h1>
            {featuredProduct ? (
              <p className="mt-4 max-w-md truncate text-base font-medium text-[#5d5d55] sm:text-lg">
                {featuredProduct.name}
              </p>
            ) : (
              <p className="mt-4 text-sm text-[#77776e]">
                Discover the latest arrivals hand-picked for this season.
              </p>
            )}
          </div>

          {featuredProduct && (
            <div className="flex items-center gap-3 pt-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#161714] sm:text-3xl">
                  {currency}{finalPrice}
                </span>
                {featuredProduct.discount > 0 && (
                    <span className="text-sm text-[#77776e] line-through">
                    {currency}{featuredProduct.price}
                  </span>
                )}
              </div>
              {featuredProduct.discount > 0 && (
                <span className="bg-[#9a5945] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                  {featuredProduct.discount}% OFF
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-3">
            {featuredProduct ? (
              <Link
                to={`/product/${featuredProduct._id}`}
                className="inline-flex items-center gap-2 bg-[#161714] px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#5d6855]"
              >
                <span>Shop Product</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            ) : null}
            <Link
              to="/collection"
              className="inline-flex items-center gap-2 border border-[#aaa89e] bg-transparent px-5 py-3 text-sm font-semibold text-[#161714] transition-all duration-200 hover:border-[#161714]"
            >
              <span>Explore Collection</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Hero Right Image */}
      <div className="relative min-h-[330px] w-full overflow-hidden bg-[#c9c3b6] sm:min-h-[560px] sm:w-[55%]">
        {featuredProduct ? (
          <Link to={`/product/${featuredProduct._id}`} className="block w-full h-full group relative">
            <img
              className="h-full w-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
              src={heroImage}
              alt={featuredProduct.name || "New In Store"}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-40 group-hover:opacity-20 transition-opacity"></div>
            <div className="absolute bottom-5 left-5 border border-white/40 bg-[#161714]/75 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
              Featured Item
            </div>
          </Link>
        ) : (
          <img
            className="w-full h-full object-cover object-center"
            src={heroImage}
            alt="Hero"
          />
        )}
      </div>
    </div>
  );
};

export default Hero;
