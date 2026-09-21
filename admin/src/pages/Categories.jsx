/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";

const Categories = ({ token }) => {
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);

  const [newCategory, setNewCategory] = useState("");
  const [newSubCategory, setNewSubCategory] = useState("");
  const [colors, setColors] = useState([]);
  const [newColor, setNewColor] = useState("");
  const [newColorNepali, setNewColorNepali] = useState("");

  const fetchCategories = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/category/list");
      if (response.data.success) {
        setCategories(response.data.categories);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const fetchSubCategories = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/subcategory/list");
      if (response.data.success) {
        setSubCategories(response.data.subCategories);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const fetchColors = async () => {
    try {
      const response = await axios.get(backendUrl + "/api/color/list");
      if (response.data.success) {
        setColors(response.data.colors);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const addCategoryHandler = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/category/add",
        { name: newCategory },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setNewCategory("");
        fetchCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const removeCategoryHandler = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/category/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const addSubCategoryHandler = async (e) => {
    e.preventDefault();
    if (!newSubCategory.trim()) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/subcategory/add",
        { name: newSubCategory },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setNewSubCategory("");
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const removeSubCategoryHandler = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/subcategory/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchSubCategories();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const addColorHandler = async (e) => {
    e.preventDefault();
    if (!newColor.trim()) return;
    try {
      const response = await axios.post(
        backendUrl + "/api/color/add",
        { name: newColor },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setNewColor("");
        setNewColorNepali("");
        fetchColors();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const removeColorHandler = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/color/remove",
        { id },
        { headers: { token } }
      );
      if (response.data.success) {
        toast.success(response.data.message);
        fetchColors();
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchSubCategories();
    fetchColors();
  }, []);

  return (
    <div className="flex flex-col gap-8 w-full max-w-[800px]">
      <p className="text-xl font-semibold">Manage Categories & Product Types</p>

      {/* --- CATEGORIES SECTION --- */}
      <div className="border p-5 rounded bg-white shadow-sm">
        <h2 className="text-lg font-medium mb-4">Product Categories</h2>
        <form onSubmit={addCategoryHandler} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Add new category (e.g. Men, Accessories)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="border px-3 py-2 rounded flex-1 max-w-[400px]"
            required
          />
          <button
            type="submit"
            className="bg-black text-white px-6 py-2 rounded text-sm hover:bg-gray-800"
          >
            Add Category
          </button>
        </form>

        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-[3fr_1fr] bg-gray-100 px-4 py-2 text-sm font-medium border-b">
            <span>Category Name</span>
            <span className="text-center">Action</span>
          </div>
          {categories.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No categories found.</p>
          ) : (
            categories.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[3fr_1fr] items-center px-4 py-2 text-sm border-b last:border-b-0 hover:bg-gray-50"
              >
                <span>{item.name}</span>
                <button
                  onClick={() => removeCategoryHandler(item.id)}
                  className="text-red-600 hover:text-red-800 font-semibold text-center"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- SUBCATEGORIES / TYPES SECTION --- */}
      <div className="border p-5 rounded bg-white shadow-sm">
        <h2 className="text-lg font-medium mb-4">Product Types (SubCategories)</h2>
        <form onSubmit={addSubCategoryHandler} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Add new type (e.g. Topwear, Footwear)"
            value={newSubCategory}
            onChange={(e) => setNewSubCategory(e.target.value)}
            className="border px-3 py-2 rounded flex-1 max-w-[400px]"
            required
          />
          <button
            type="submit"
            className="bg-black text-white px-6 py-2 rounded text-sm hover:bg-gray-800"
          >
            Add Type
          </button>
        </form>

        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-[3fr_1fr] bg-gray-100 px-4 py-2 text-sm font-medium border-b">
            <span>Type Name</span>
            <span className="text-center">Action</span>
          </div>
          {subCategories.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No types found.</p>
          ) : (
            subCategories.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[3fr_1fr] items-center px-4 py-2 text-sm border-b last:border-b-0 hover:bg-gray-50"
              >
                <span>{item.name}</span>
                <button
                  onClick={() => removeSubCategoryHandler(item.id)}
                  className="text-red-600 hover:text-red-800 font-semibold text-center"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- COLORS SECTION --- */}
      <div className="border p-5 rounded bg-white shadow-sm">
        <h2 className="text-lg font-medium mb-4">Product Colors</h2>
        <form onSubmit={addColorHandler} className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="Add new color (e.g. Red, Navy Blue)"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="border px-3 py-2 rounded flex-1 max-w-[260px]"
            required
          />
          <input
            type="text"
            placeholder="Nepali name (e.g. रातो)"
            value={newColorNepali}
            onChange={(e) => setNewColorNepali(e.target.value)}
            className="border px-3 py-2 rounded flex-1 max-w-[260px]"
          />
          <button
            type="submit"
            className="bg-black text-white px-6 py-2 rounded text-sm hover:bg-gray-800"
          >
            Add Color
          </button>
        </form>

        <div className="border rounded overflow-hidden">
          <div className="grid grid-cols-[3fr_1fr] bg-gray-100 px-4 py-2 text-sm font-medium border-b">
            <span>Color Name</span>
            <span className="text-center">Action</span>
          </div>
          {colors.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No colors found.</p>
          ) : (
            colors.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[3fr_1fr] items-center px-4 py-2 text-sm border-b last:border-b-0 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border border-gray-300 inline-block"
                    style={{ backgroundColor: item.name.toLowerCase() }}
                  />
                  {item.name}
                </span>
                <button
                  onClick={() => removeColorHandler(item.id)}
                  className="text-red-600 hover:text-red-800 font-semibold text-center"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Categories;
