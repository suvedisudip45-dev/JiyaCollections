/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "./Title";
import Product from "../pages/Product";
import ProductItem from "./ProductItem";

const RelatedProducts = ({ category, categories, subCategory, currentId }) => {
  const { products } = useContext(ShopContext);
  const [related, setRelated] = useState([]);

  useEffect(() => {
    if (products.length > 0) {
      // Gather target category list (case-insensitive)
      let targetCats = [];
      if (Array.isArray(categories) && categories.length > 0) {
        targetCats = categories.map((c) => String(c).trim().toLowerCase());
      } else if (typeof category === "string" && category) {
        targetCats = category.split(",").map((c) => c.trim().toLowerCase());
      }

      // Filter out current product if provided
      let productsCopy = products.filter(
        (item) => !currentId || (item._id !== currentId && item.id !== currentId)
      );

      // Match products that share any category
      if (targetCats.length > 0) {
        productsCopy = productsCopy.filter((item) => {
          let itemCats = [];
          if (Array.isArray(item.categories) && item.categories.length > 0) {
            itemCats = item.categories.map((c) => String(c).trim().toLowerCase());
          } else if (typeof item.category === "string" && item.category) {
            const trimmed = item.category.trim();
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
              try {
                itemCats = JSON.parse(trimmed).map((c) => String(c).trim().toLowerCase());
              } catch {
                itemCats = [trimmed.toLowerCase()];
              }
            } else {
              itemCats = trimmed.split(",").map((c) => c.trim().toLowerCase());
            }
          }
          return itemCats.some((c) => targetCats.includes(c));
        });
      }

      // Filter by subcategory if matching ones exist
      if (subCategory) {
        const subFiltered = productsCopy.filter(
          (item) => item.subCategory?.toLowerCase() === subCategory.toLowerCase()
        );
        if (subFiltered.length > 0) {
          productsCopy = subFiltered;
        }
      }

      setRelated(productsCopy.slice(0, 5));
    }
  }, [products, category, categories, subCategory, currentId]);
  return (
    <div className="my-24">
      <div className="text-center text-3xl py-2">
        <Title text1={"RELATED"} text2={"PRODUCTS"} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
        {related.map((item, index) => (
          <ProductItem
            key={index}
            id={item._id}
            image={item.image}
            name={item.name}
            price={item.price}
            discount={item.discount}
            stockStatus={item.stockStatus}
            stockQuantity={item.stockQuantity ?? 0}
            variants={item.variants}
          />
        ))}
      </div>
    </div>
  );
};

export default RelatedProducts;
