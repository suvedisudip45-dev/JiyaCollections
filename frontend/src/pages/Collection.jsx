import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import Title from "../components/Title";
import ProductItem from "../components/ProductItem";
import axios from "axios";

const Collection = () => {
  const { products, search, showSearch, backendUrl } = useContext(ShopContext);
  const [showFilter, setShowFilter] = useState(false);
  const [filterProducts, setFilterProducts] = useState([]);
  const [category, setCategory] = useState([]);
  const [subCategory, setSubCategory] = useState([]);
  const [sortType, setSortType] = useState("relavent");

  const [categoriesList, setCategoriesList] = useState([]);
  const [subCategoriesList, setSubCategoriesList] = useState([]);

  useEffect(() => {
    const fetchDynamicFilters = async () => {
      try {
        const [catRes, subRes] = await Promise.all([
          axios.get(backendUrl + "/api/category/list"),
          axios.get(backendUrl + "/api/subcategory/list"),
        ]);
        if (catRes.data.success && catRes.data.categories.length > 0) {
          setCategoriesList(catRes.data.categories.map((c) => c.name));
        } else {
          setCategoriesList(["Men", "Women", "Kids"]);
        }
        if (subRes.data.success && subRes.data.subCategories.length > 0) {
          setSubCategoriesList(subRes.data.subCategories.map((s) => s.name));
        } else {
          setSubCategoriesList(["Topwear", "Bottomwear", "Winterwear"]);
        }
      } catch (error) {
        console.log(error);
        setCategoriesList(["Men", "Women", "Kids"]);
        setSubCategoriesList(["Topwear", "Bottomwear", "Winterwear"]);
      }
    };
    fetchDynamicFilters();
  }, [backendUrl]);

  // Dynamically include any custom categories present on products (e.g. Festival Offer)
  useEffect(() => {
    if (products && products.length > 0) {
      setCategoriesList((prev) => {
        const prodCats = [];
        products.forEach((p) => {
          if (Array.isArray(p.categories)) {
            prodCats.push(...p.categories);
          } else if (typeof p.category === "string" && p.category) {
            const trimmed = p.category.trim();
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
              try {
                prodCats.push(...JSON.parse(trimmed));
              } catch {
                prodCats.push(trimmed);
              }
            } else {
              prodCats.push(...trimmed.split(",").map((s) => s.trim()));
            }
          }
        });
        const combined = Array.from(new Set([...prev, ...prodCats.filter(Boolean)]));
        return combined;
      });
    }
  }, [products]);

  const toggleCategory = (e) => {
    if (category.includes(e.target.value)) {
      setCategory((prev) => prev.filter((item) => item !== e.target.value));
    } else {
      setCategory((prev) => [...prev, e.target.value]);
    }
  };

  const toogleSubCategory = (e) => {
    if (subCategory.includes(e.target.value)) {
      setSubCategory((prev) => prev.filter((item) => item !== e.target.value));
    } else {
      setSubCategory((prev) => [...prev, e.target.value]);
    }
  };

  const applyFilter = () => {
    let productsCopy = products.slice();

    if (showSearch && search) {
      const q = search.toLowerCase().trim();
      productsCopy = productsCopy.filter((item) => {
        const matchName = item.name.toLowerCase().includes(q);
        const matchSub = item.subCategory && item.subCategory.toLowerCase().includes(q);
        const matchCat = Array.isArray(item.categories)
          ? item.categories.some((c) => c.toLowerCase().includes(q))
          : typeof item.category === "string" && item.category.toLowerCase().includes(q);
        return matchName || matchSub || matchCat;
      });
    }

    if (category.length > 0) {
      productsCopy = productsCopy.filter((item) => {
        let itemCats = [];
        if (Array.isArray(item.categories)) {
          itemCats = item.categories;
        } else if (typeof item.category === "string") {
          const trimmed = item.category.trim();
          if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
              itemCats = JSON.parse(trimmed);
            } catch {
              itemCats = [trimmed];
            }
          } else {
            itemCats = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
          }
        }
        return itemCats.some((c) => category.includes(c));
      });
    }

    if (subCategory.length > 0) {
      productsCopy = productsCopy.filter((item) =>
        subCategory.includes(item.subCategory)
      );
    }

    setFilterProducts(productsCopy);
  };

  const sortProduct = () => {
    let fpCopy = filterProducts.slice();
    switch (sortType) {
      case "low-high":
        setFilterProducts(fpCopy.sort((a, b) => a.price - b.price));
        break;
      case "high-low":
        setFilterProducts(fpCopy.sort((a, b) => b.price - a.price));
        break;
      case "newest":
        setFilterProducts(fpCopy.sort((a, b) => Number(b.date || 0) - Number(a.date || 0)));
        break;
      case "top-rated":
        setFilterProducts(
          fpCopy.sort((a, b) => {
            const rA = Number(a.rating || 0);
            const rB = Number(b.rating || 0);
            if (rB !== rA) return rB - rA;
            return (b.reviewCount || 0) - (a.reviewCount || 0);
          })
        );
        break;
      default:
        applyFilter();
        break;
    }
  };

  useEffect(() => {
    applyFilter();
  }, [category, subCategory, search, showSearch, products]);

  useEffect(() => {
    sortProduct();
  }, [sortType]);

  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-10 pt-10 border-t">
      {/* Filter Options */}
      <div className="min-w-60">
        <p
          onClick={() => setShowFilter(!showFilter)}
          className="my-2 text-xl flex items-center cursor-pointer gap-2"
        >
          FILTERS
          <img
            className={`h-3 sm:hidden ${showFilter ? "rotate-90" : ""}`}
            src={assets.dropdown_icon}
            alt=""
          />
        </p>
        {/* Category Filter */}
        <div
          className={`border border-gray-300 pl-5 py-3 mt-6 ${
            showFilter ? "" : "hidden"
          } sm:block`}
        >
          <p className="mb-3 text-sm font-medium">CATEGORIES</p>
          <div className="flex flex-col gap-2 text-sm font-light text-gray-700">
            {categoriesList.map((cat, idx) => (
              <p className="flex gap-2" key={idx}>
                <input
                  className="w-3"
                  type="checkbox"
                  value={cat}
                  onChange={toggleCategory}
                />
                {cat}
              </p>
            ))}
          </div>
        </div>
        {/* SubCategory Filter */}
        <div
          className={`border border-gray-300 pl-5 py-3 my-5 ${
            showFilter ? "" : "hidden"
          } sm:block`}
        >
          <p className="mb-3 text-sm font-medium">TYPE</p>
          <div className="flex flex-col gap-2 text-sm font-light text-gray-700">
            {subCategoriesList.map((sub, idx) => (
              <p className="flex gap-2" key={idx}>
                <input
                  className="w-3"
                  type="checkbox"
                  value={sub}
                  onChange={toogleSubCategory}
                />
                {sub}
              </p>
            ))}
          </div>
        </div>
      </div>
      {/* Right Side */}
      <div className="flex-1">
        <div className="flex justify-between text-base sm:text-2xl mb-4">
          <Title text1={"ALL"} text2={"COLLECTIONS"} />
          {/* Product Sort */}
          <select
            onChange={(e) => setSortType(e.target.value)}
            className="border-2 border-gray-300 text-sm px-2 py-1 rounded"
          >
            <option value="relavent">Sort by: Relevant</option>
            <option value="newest">Sort by: Newest Arrivals</option>
            <option value="top-rated">Sort by: Top Rated</option>
            <option value="low-high">Sort by: Price: Low to High</option>
            <option value="high-low">Sort by: Price: High to Low</option>
          </select>
        </div>
        {/* Map Products */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 gap-y-6">
          {filterProducts.map((item, index) => (
            <ProductItem
              key={index}
              name={item.name}
              id={item._id}
              price={item.price}
              image={item.image}
              discount={item.discount}
              stockStatus={item.stockStatus}
              stockQuantity={item.stockQuantity ?? 0}
              variants={item.variants}
              rating={item.rating}
              reviewCount={item.reviewCount}
              newInStore={item.newInStore}
              bestseller={item.bestseller}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Collection;
