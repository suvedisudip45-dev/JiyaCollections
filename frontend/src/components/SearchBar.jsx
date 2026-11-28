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
    <div className="relative z-30 border-y border-[var(--line)] bg-[var(--paper)] px-4 py-4 text-center">
      <form
        onSubmit={handleSearchSubmit}
        className="mx-auto inline-flex min-h-12 w-full max-w-2xl items-center justify-center border border-[var(--line)] bg-white px-4 transition-colors focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]"
      >
        <input
          value={search}
          onChange={handleInputChange}
          className="flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
          type="text"
          placeholder="Search products by name, category, style..."
          autoFocus
        />
        <button type="submit" className="p-1 cursor-pointer">
          <img className="w-4 opacity-70 hover:opacity-100 transition-opacity" src={assets.search_icon} alt="Search" />
        </button>
      </form>
      <button onClick={handleClose} className="icon-button ml-2 h-11 w-11" aria-label="Close search">
        <img className="w-3.5 opacity-60 transition-opacity hover:opacity-100" src={assets.cross_icon} alt="" />
      </button>
    </div>
  );
};

export default SearchBar;
