/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { assets } from "../assets/assets";
import { ShopContext } from "../context/ShopContext";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Tag, ShieldCheck, Truck, RefreshCw } from "lucide-react";

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
    <section className="relative mx-auto w-full max-w-[1440px] overflow-hidden bg-[#111210] text-white">
      {/* ========================================================
          MOBILE VIEW (Full-Bleed Immersive Visual with Overlay)
          ======================================================== */}
      <div className="relative block lg:hidden min-h-[560px] sm:min-h-[620px] w-full">
        {/* Background Model Image */}
        <img
          src={heroImage}
          alt={featuredProduct?.name || "New in Store"}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />

        {/* Deep Cinematic Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/20" />

        {/* Floating Top Pill */}
        <div className="absolute top-5 left-5 z-20">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-[10px] font-extrabold uppercase tracking-widest text-amber-400 shadow-md">
            <Sparkles size={11} />
            <span>NEW IN STORE • 2026</span>
          </span>
        </div>

        {/* Content Anchored at Bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-6 sm:p-8 space-y-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-md">
              {featuredProduct?.name || "THE NEW STREET EDIT"}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 font-medium line-clamp-1 mt-1">
              Premium heavyweight cotton • Relaxed tailored silhouette
            </p>
          </div>

          {/* Price Tag Bar */}
          {featuredProduct && (
            <div className="flex items-center gap-3 py-1">
              <span className="text-2xl sm:text-3xl font-black text-white drop-shadow-sm">
                {currency}{finalPrice}
              </span>
              {featuredProduct.discount > 0 && (
                <>
                  <span className="text-sm font-semibold text-white/60 line-through">
                    {currency}{featuredProduct.price}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md bg-rose-600 text-white font-black text-xs uppercase tracking-wider shadow-sm">
                    {featuredProduct.discount}% OFF
                  </span>
                </>
              )}
            </div>
          )}

          {/* Action CTAs */}
          <div className="flex items-center gap-3 pt-1">
            {featuredProduct ? (
              <Link
                to={`/product/${featuredProduct._id}`}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-white text-black py-3.5 px-5 rounded-md text-xs font-black uppercase tracking-wider shadow-lg hover:bg-amber-400 transition-colors"
              >
                <span>Shop Product</span>
                <ArrowRight size={15} />
              </Link>
            ) : null}
            <Link
              to="/collection"
              className="flex-1 inline-flex items-center justify-center bg-white/15 backdrop-blur-md border border-white/30 text-white py-3.5 px-5 rounded-md text-xs font-bold uppercase tracking-wider hover:bg-white/25 transition-colors"
            >
              <span>Explore</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ========================================================
          DESKTOP VIEW (Editorial Split Screen with High Contrast)
          ======================================================== */}
      <div className="hidden lg:grid lg:grid-cols-12 min-h-[620px] items-stretch">
        {/* Left Editorial Text Column */}
        <div className="lg:col-span-6 xl:col-span-7 flex flex-col justify-center px-12 xl:px-16 py-16 z-10 space-y-7">
          {/* Category Tag */}
          <div className="flex items-center gap-3">
            <span className="h-0.5 w-10 bg-amber-400 inline-block" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-amber-400">
              FEATURED ARRIVAL • SEASON DROP
            </span>
          </div>

          {/* Headline */}
          <div>
            <h1 className="text-6xl xl:text-7xl font-black uppercase tracking-tight text-white leading-[0.95]">
              New in <br />
              <span className="text-amber-400">Store</span>
            </h1>
            <p className="mt-4 text-lg font-semibold text-white/90 capitalize max-w-md">
              {featuredProduct?.name || "Signature Garments & Streetwear Essentials"}
            </p>
            <p className="text-xs text-white/60 mt-1 max-w-lg leading-relaxed">
              Crafted from high-grade breathable cotton with a relaxed streetwear cut. Built for everyday durability and modern lifestyle movement.
            </p>
          </div>

          {/* Price Tag Card */}
          {featuredProduct && (
            <div className="inline-flex items-center gap-4 py-2 px-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/15 w-fit">
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-black text-white">
                  {currency}{finalPrice}
                </span>
                {featuredProduct.discount > 0 && (
                  <span className="text-base font-semibold text-white/50 line-through">
                    {currency}{featuredProduct.price}
                  </span>
                )}
              </div>
              {featuredProduct.discount > 0 && (
                <span className="bg-rose-600 text-white px-3 py-1 text-xs font-black uppercase tracking-wider rounded-md shadow-md">
                  {featuredProduct.discount}% OFF
                </span>
              )}
            </div>
          )}

          {/* Action CTAs */}
          <div className="flex items-center gap-4 pt-2">
            {featuredProduct && (
              <Link
                to={`/product/${featuredProduct._id}`}
                className="group inline-flex items-center gap-3 bg-white text-black px-8 py-4 rounded-md text-xs font-black uppercase tracking-widest hover:bg-amber-400 transition-all duration-200 shadow-xl"
              >
                <span>Shop Product</span>
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
            )}
            <Link
              to="/collection"
              className="inline-flex items-center gap-2 border border-white/30 bg-transparent px-7 py-4 rounded-md text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 hover:border-white transition-all"
            >
              <span>Explore Collection</span>
            </Link>
          </div>

          {/* Trust Value Badges */}
          <div className="pt-6 border-t border-white/15 grid grid-cols-3 gap-3 text-[11px] font-bold uppercase tracking-wider text-white/70">
            <div className="flex items-center gap-2">
              <Truck size={15} className="text-amber-400 shrink-0" />
              <span>Fast Nepal Delivery</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-amber-400 shrink-0" />
              <span>100% Cotton Feel</span>
            </div>
            <div className="flex items-center gap-2">
              <RefreshCw size={15} className="text-amber-400 shrink-0" />
              <span>Easy Exchanges</span>
            </div>
          </div>
        </div>

        {/* Right Photo Column */}
        <div className="lg:col-span-6 xl:col-span-5 relative min-h-[620px] overflow-hidden group">
          {featuredProduct ? (
            <Link to={`/product/${featuredProduct._id}`} className="block w-full h-full relative">
              <img
                src={heroImage}
                alt={featuredProduct.name || "Hero"}
                className="w-full h-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 opacity-60 group-hover:opacity-40 transition-opacity" />

              {/* Floating Featured Badge */}
              <div className="absolute top-6 right-6 bg-black/75 backdrop-blur-md border border-white/20 px-4 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest text-white shadow-xl">
                ★ FEATURED PIECE
              </div>

              {/* Bottom Card */}
              <div className="absolute bottom-6 left-6 right-6 p-4 rounded-xl bg-black/75 backdrop-blur-md text-white border border-white/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Available In Stock</span>
                  <p className="text-sm font-black truncate max-w-[220px]">{featuredProduct.name}</p>
                </div>
                <span className="text-xs font-bold underline flex items-center gap-1 hover:text-amber-400">
                  Quick View <ArrowRight size={13} />
                </span>
              </div>
            </Link>
          ) : (
            <img
              src={heroImage}
              alt="Hero"
              className="w-full h-full object-cover object-center"
            />
          )}
        </div>
      </div>
    </section>
  );
};

export default Hero;
