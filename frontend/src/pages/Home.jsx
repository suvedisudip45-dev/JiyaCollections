/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import Hero from "../components/Hero";
import FestiveOfferSection from "../components/FestiveOfferSection";
import CategoryShowcase from "../components/CategoryShowcase";
import OurPolicy from "../components/OurPolicy";
import NewsletterBox from "../components/NewsletterBox";
import ProductRail from "../components/ProductRail";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import axios from "axios";

const Home = () => {
  const { products, backendUrl } = useContext(ShopContext);
  const [subcategories, setSubcategories] = useState([]);

  useEffect(() => {
    axios
      .get(`${backendUrl}/api/subcategory/list`)
      .then((res) => {
        if (res.data.success) {
          setSubcategories(res.data.subCategories || []);
        }
      })
      .catch(() => {});
  }, [backendUrl]);

  const arrivals = [...products]
    .filter((item) => item.newInStore)
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  const bestsellers = [...products]
    .filter((item) => item.bestseller)
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  const fallbackArrivals = [...products].sort((a, b) => Number(b.date || 0) - Number(a.date || 0));

  // Find sample images for Men and Women from products or subcategories
  const menProduct = products.find((p) => String(p.category || "").includes("Men"));
  const womenProduct = products.find((p) => String(p.category || "").includes("Women"));

  const menSub = subcategories.find((s) => s.category?.name?.toLowerCase() === "men" && s.image);
  const womenSub = subcategories.find((s) => s.category?.name?.toLowerCase() === "women" && s.image);

  const menImage = menSub?.image || menProduct?.image?.[0] || assets.p_img11 || assets.hero_img;
  const womenImage = womenSub?.image || womenProduct?.image?.[0] || assets.p_img2 || assets.p_img1;
  const essentialsImage = assets.p_img8 || assets.p_img14 || assets.hero_img;

  const categoryTiles = [
    {
      tag: "COLLECTION 01",
      label: "Shop Men",
      subtitle: "Oversized Tees, Cargos & Street Layering",
      query: "Men",
      image: menImage,
    },
    {
      tag: "COLLECTION 02",
      label: "Shop Women",
      subtitle: "Tanks, Fits, Crop Tees & Bottomwear",
      query: "Women",
      image: womenImage,
    },
    {
      tag: "THE EDIT",
      label: "Everyday Essentials",
      subtitle: "All-Season Signatures & Timeless Basics",
      query: "",
      image: essentialsImage,
    },
  ];

  return (
    <div className="overflow-hidden">
      <Hero />

      {/* --- ATTRACTIVE CATEGORY SHOWCASE TILES (STREETWEAR EDITORIAL) --- */}
      <section className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {categoryTiles.map((tile) => (
            <Link
              key={tile.label}
              to={tile.query ? `/collection?category=${tile.query}` : "/collection"}
              className="group relative flex h-[280px] sm:h-[340px] md:h-[400px] flex-col justify-between overflow-hidden rounded-2xl p-6 shadow-md transition-all duration-300 hover:shadow-2xl"
            >
              {/* Background Image with Zoom */}
              <img
                src={tile.image}
                alt={tile.label}
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-110"
              />

              {/* Gradient Vignette Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20 transition-opacity duration-300 group-hover:from-black/95 group-hover:via-black/50" />

              {/* Top Tag Pill */}
              <div className="relative z-10 flex items-center justify-between">
                <span className="rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-white border border-white/20">
                  {tile.tag}
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-transform duration-300 group-hover:scale-110 group-hover:bg-amber-400">
                  <ArrowUpRight
                    size={18}
                    className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </div>
              </div>

              {/* Bottom Details */}
              <div className="relative z-10 space-y-1.5 text-white">
                <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-tight drop-shadow-sm">
                  {tile.label}
                </h3>
                <p className="text-xs font-medium text-white/80 line-clamp-1">
                  {tile.subtitle}
                </p>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-400 group-hover:text-white transition-colors underline">
                    Explore Drops →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <ProductRail
        eyebrow="Just landed"
        title="New in"
        description="Fresh shapes, easy layers, and the pieces that set the tone for your next fit."
        products={arrivals.length ? arrivals : fallbackArrivals}
        actionLabel="Shop new arrivals"
      />
      <FestiveOfferSection />
      <ProductRail
        eyebrow="The repeat rotation"
        title="Best sellers"
        description="The fits our community keeps reaching for, now in the everyday edit."
        products={bestsellers.length ? bestsellers : products}
        actionLabel="Shop best sellers"
      />
      <CategoryShowcase />
      <OurPolicy />
      <NewsletterBox />
    </div>
  );
};

export default Home;
