/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import ProductItem from "./ProductItem";
import { Link } from "react-router-dom";
import axios from "axios";

const CategoryShowcase = () => {
  const { products, backendUrl } = useContext(ShopContext);
  const [categories, setCategories] = useState([]);
  const [activeCategoryTabs, setActiveCategoryTabs] = useState({}); // { [categoryName]: 'combined' | 'newest' | 'top_rated' }

  // Helper: extract category names associated with a product
  const getProductCategories = (p) => {
    if (!p) return [];
    if (Array.isArray(p.categories) && p.categories.length > 0) {
      return p.categories;
    }
    if (typeof p.category === "string" && p.category) {
      const trimmed = p.category.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) {
          // ignore
        }
      }
      return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  };

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await axios.get(backendUrl + "/api/category/list");
        let list = [];
        if (res.data.success && res.data.categories.length > 0) {
          list = res.data.categories.map((c) => c.name);
        }

        // Also gather any categories present on products themselves
        const productCatSet = new Set();
        products.forEach((p) => {
          getProductCategories(p).forEach((c) => productCatSet.add(c));
        });

        const combined = Array.from(new Set([...list, ...Array.from(productCatSet)]));
        const priority = ["Men", "Women", "Kids"];
        const sortedCats = [
          ...priority.filter((c) => combined.includes(c)),
          ...combined.filter((c) => !priority.includes(c)),
        ];

        setCategories(sortedCats.length > 0 ? sortedCats : ["Men", "Women", "Kids"]);
      } catch (err) {
        console.error("Error fetching categories:", err);
        setCategories(["Men", "Women", "Kids"]);
      }
    };

    fetchCategories();
  }, [backendUrl, products]);

  // For a given category, compute the combined newly added + highly rated products
  const getCategoryProducts = (catName, tab = "combined") => {
    const matching = products.filter((p) => {
      const cats = getProductCategories(p);
      return cats.some((c) => c.toLowerCase() === catName.toLowerCase());
    });

    if (matching.length === 0) return [];

    // Sort by Newly Added (date desc)
    const newlyAdded = [...matching].sort((a, b) => Number(b.date || 0) - Number(a.date || 0));

    // Sort by Highly Rated (rating desc, then reviewCount desc, then bestseller)
    const highlyRated = [...matching].sort((a, b) => {
      const rA = Number(a.rating || 0);
      const rB = Number(b.rating || 0);
      if (rB !== rA) return rB - rA;
      if (b.bestseller && !a.bestseller) return 1;
      if (a.bestseller && !b.bestseller) return -1;
      return Number(b.date || 0) - Number(a.date || 0);
    });

    if (tab === "newest") {
      return newlyAdded.slice(0, 8);
    }
    if (tab === "top_rated") {
      return highlyRated.slice(0, 8);
    }

    // Combination: Interleave newly added and highly rated items, removing duplicates
    const combinedSet = new Set();
    const result = [];

    const maxLen = Math.max(newlyAdded.length, highlyRated.length);
    for (let i = 0; i < maxLen; i++) {
      if (newlyAdded[i] && !combinedSet.has(newlyAdded[i]._id)) {
        combinedSet.add(newlyAdded[i]._id);
        result.push(newlyAdded[i]);
      }
      if (highlyRated[i] && !combinedSet.has(highlyRated[i]._id)) {
        combinedSet.add(highestRatedItem(highlyRated[i]));
        result.push(highlyRated[i]);
      }
      if (result.length >= 10) break;
    }

    function highestRatedItem(item) {
      combinedSet.add(item._id);
      return item._id;
    }

    return result;
  };

  const handleTabChange = (catName, tab) => {
    setActiveCategoryTabs((prev) => ({ ...prev, [catName]: tab }));
  };

  const scrollToCategory = (catName) => {
    const el = document.getElementById(`category-${catName.toLowerCase().replace(/\s+/g, "-")}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Filter out categories with zero products
  const activeCategories = categories.filter((cat) => {
    const prods = products.filter((p) => {
      const cats = getProductCategories(p);
      return cats.some((c) => c.toLowerCase() === cat.toLowerCase());
    });
    return prods.length > 0;
  });

  return (
    <div className="my-14 space-y-16">
      {/* Quick Category Navigation Bar */}
      {activeCategories.length > 1 && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p className="text-xs uppercase tracking-widest font-semibold text-gray-400">
            BROWSE BY CATEGORY
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
            {activeCategories.map((cat) => {
              const count = products.filter((p) =>
                getProductCategories(p).some((c) => c.toLowerCase() === cat.toLowerCase())
              ).length;
              return (
                <button
                  key={cat}
                  onClick={() => scrollToCategory(cat)}
                  className="px-4 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-black hover:text-white transition-all duration-200 border border-gray-200 shadow-2xs cursor-pointer"
                >
                  <span>{cat}</span>
                  <span className="ml-1.5 opacity-60 text-[10px]">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Render Each Category Section */}
      {activeCategories.map((catName) => {
        const currentTab = activeCategoryTabs[catName] || "combined";
        const displayProducts = getCategoryProducts(catName, currentTab);
        const allCategoryProductsCount = products.filter((p) =>
          getProductCategories(p).some((c) => c.toLowerCase() === catName.toLowerCase())
        ).length;

        const catSlug = catName.toLowerCase().replace(/\s+/g, "-");

        return (
          <section
            key={catName}
            id={`category-${catSlug}`}
            className="pt-6 scroll-mt-20 border-t border-gray-100"
          >
            {/* Category Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-[2px] bg-black"></span>
                  <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                    CATEGORY SHOWCASE
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1 uppercase tracking-tight">
                  {catName}
                </h2>
                <p className="text-xs sm:text-sm text-gray-500 mt-0.5 max-w-xl">
                  Curated selection of newly added arrivals and highly rated customer favorites.
                </p>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl self-start md:self-auto border border-gray-200">
                <button
                  type="button"
                  onClick={() => handleTabChange(catName, "combined")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    currentTab === "combined"
                      ? "bg-white text-black shadow-2xs"
                      : "text-gray-600 hover:text-black"
                  }`}
                >
                  Curated Mix
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange(catName, "newest")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    currentTab === "newest"
                      ? "bg-white text-black shadow-2xs"
                      : "text-gray-600 hover:text-black"
                  }`}
                >
                  New Arrivals
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange(catName, "top_rated")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    currentTab === "top_rated"
                      ? "bg-white text-black shadow-2xs"
                      : "text-gray-600 hover:text-black"
                  }`}
                >
                  Top Rated
                </button>
              </div>
            </div>

            {/* Products Grid */}
            {displayProducts.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                {displayProducts.map((item) => (
                  <ProductItem
                    key={item._id}
                    id={item._id}
                    image={item.image}
                    name={item.name}
                    price={item.price}
                    discount={item.discount}
                    stockQuantity={item.stockQuantity ?? 0}
                    variants={item.variants}
                    rating={item.rating}
                    reviewCount={item.reviewCount}
                    newInStore={item.newInStore}
                    bestseller={item.bestseller}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 text-sm">
                No products found in this category.
              </div>
            )}

            {/* Explore All In Category Link */}
            <div className="text-center mt-8">
              <Link
                to="/collection"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-gray-700 hover:text-black transition-colors"
              >
                <span>View all {allCategoryProductsCount} items in {catName}</span>
                <span className="text-base leading-none">→</span>
              </Link>
            </div>
          </section>
        );
      })}

      {activeCategories.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border border-gray-200">
          <p className="text-gray-500 font-medium">No products available yet. Add products from the Admin panel!</p>
        </div>
      )}
    </div>
  );
};

export default CategoryShowcase;
