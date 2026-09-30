/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import { useLocation, useNavigate } from "react-router-dom";

const SearchBar = () => {
  const { search, setSearch, showSearch, setShowSearch } = useContext(ShopContext);
  const location = useLocation();
  const navigate = useNavigate();

  const handleInputChange = (e) => {
    setSearch(e.target.value);
    if (!location.pathname.includes("shop") && !location.pathname.includes("collection")) {
      navigate("/shop");
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!location.pathname.includes("shop") && !location.pathname.includes("collection")) {
      navigate("/shop");
    }
  };

  const handleClose = () => {
    setShowSearch(false);
    setSearch("");
  };

  if (!showSearch) return null;

  return (
    <div className="border-t border-b bg-gray-50 text-center py-4 relative z-30 shadow-2xs">
      <form
        onSubmit={handleSearchSubmit}
        className="inline-flex items-center justify-center border border-gray-300 bg-white px-5 py-2.5 rounded-full w-4/5 sm:w-1/2 shadow-xs focus-within:border-black focus-within:ring-1 focus-within:ring-black transition-all"
      >
        <input
          value={search}
          onChange={handleInputChange}
          className="flex-1 outline-none bg-transparent text-sm text-gray-800 placeholder-gray-400"
          type="text"
          placeholder="Search products by name, category, style..."
          autoFocus
        />
        <button type="submit" className="p-1 cursor-pointer">
          <img className="w-4 opacity-70 hover:opacity-100 transition-opacity" src={assets.search_icon} alt="Search" />
        </button>
      </form>
      <img
        onClick={handleClose}
        className="inline w-3.5 ml-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
        src={assets.cross_icon}
        alt="Close Search"
      />
    </div>
  );
};

export default SearchBar;
