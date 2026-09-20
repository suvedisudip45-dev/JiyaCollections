import React, { useContext, useState } from "react";
import { assets } from "../assets/assets";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";

const Navbar = () => {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  const {
    setShowSearch,
    getCartCount,
    navigate,
    token,
    setToken,
    setCartItems,
  } = useContext(ShopContext);

  const handleSearchClick = () => {
    setShowSearch(true);
    if (!location.pathname.includes("collection")) {
      navigate("/collection");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("cartItems");
    setToken("");
    setCartItems({});
    navigate("/login");
  };


  return (
    <nav className="relative z-40 flex items-center justify-between py-5 font-medium">
      <Link to={"/"} className="z-10">
        <img src={assets.logo} className="w-36" alt="Logo" />
      </Link>

      {/* Desktop Navigation Links */}
      <ul className="hidden sm:flex gap-5 text-sm text-gray-700">
        <NavLink to="/" className="flex flex-col items-center gap-1">
          <p>HOME</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/collection" className="flex flex-col items-center gap-1">
          <p>COLLECTION</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/about" className="flex flex-col items-center gap-1">
          <p>ABOUT</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/contact" className="flex flex-col items-center gap-1">
          <p>CONTACT</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
      </ul>

      <div className="flex items-center gap-6 z-10">
        <img
          onClick={handleSearchClick}
          src={assets.search_icon}
          className="w-5 cursor-pointer hover:opacity-80 transition-opacity"
          alt="Search"
        />

        {/* Profile / Account Dropdown */}
        <div className="group relative">
          <img
            onClick={() => (token ? null : navigate("/login"))}
            src={assets.profile_icon}
            className="w-5 cursor-pointer hover:opacity-80 transition-opacity"
            alt="Profile"
          />
          {token && (
            <div className="group-hover:block hidden absolute right-0 pt-4 z-50">
              <div className="flex flex-col gap-2 w-36 py-3 px-5 bg-white border border-gray-200 shadow-xl text-gray-600 rounded-xl text-sm">
                <p
                  onClick={() => navigate("/profile")}
                  className="cursor-pointer hover:text-black transition-colors"
                >
                  My Profile
                </p>
                <p
                  onClick={() => navigate("/orders")}
                  className="cursor-pointer hover:text-black transition-colors"
                >
                  Orders
                </p>
                <p
                  onClick={logout}
                  className="cursor-pointer text-red-600 hover:text-red-700 font-semibold transition-colors"
                >
                  Logout
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Cart Icon */}
        <Link to="/cart" className="relative">
          <img src={assets.cart_icon} className="w-5 min-w-5" alt="Cart" />
          <p className="absolute right-[-5px] bottom-[-5px] w-4 text-center leading-4 bg-black text-white aspect-square rounded-full text-[8px] font-bold">
            {getCartCount()}
          </p>
        </Link>

        {/* Mobile Hamburger Menu Icon */}
        <img
          onClick={() => setVisible(true)}
          src={assets.menu_icon}
          className="w-5 cursor-pointer sm:hidden hover:opacity-80 transition-opacity"
          alt="Open Menu"
        />
      </div>

      {/* Mobile Drawer Backdrop */}
      {visible && (
        <div
          onClick={() => setVisible(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 sm:hidden transition-opacity"
        />
      )}

      {/* Sidebar menu for small screens */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 bg-white shadow-2xl transition-all duration-300 ease-in-out flex flex-col ${
          visible ? "w-[75%] max-w-xs" : "w-0 overflow-hidden pointer-events-none"
        }`}
      >
        <div className="flex flex-col text-gray-700 h-full w-full">
          {/* Header */}
          <div
            onClick={() => setVisible(false)}
            className="flex items-center justify-between p-4 border-b border-gray-200 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="font-bold text-sm tracking-wide text-gray-900">MENU</span>
            <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
              <span>Close</span>
              <img className="h-3.5 rotate-180" src={assets.dropdown_icon} alt="" />
            </div>
          </div>

          {/* Nav Links */}
          <div className="flex flex-col py-2">
            <NavLink
              onClick={() => setVisible(false)}
              className={({ isActive }) =>
                `py-3.5 px-6 border-b border-gray-100 text-sm font-semibold transition-colors ${
                  isActive ? "text-black bg-gray-50 font-bold" : "text-gray-600 hover:text-black hover:bg-gray-50"
                }`
              }
              to="/"
            >
              HOME
            </NavLink>
            <NavLink
              onClick={() => setVisible(false)}
              className={({ isActive }) =>
                `py-3.5 px-6 border-b border-gray-100 text-sm font-semibold transition-colors ${
                  isActive ? "text-black bg-gray-50 font-bold" : "text-gray-600 hover:text-black hover:bg-gray-50"
                }`
              }
              to="/collection"
            >
              COLLECTION
            </NavLink>
            <NavLink
              onClick={() => setVisible(false)}
              className={({ isActive }) =>
                `py-3.5 px-6 border-b border-gray-100 text-sm font-semibold transition-colors ${
                  isActive ? "text-black bg-gray-50 font-bold" : "text-gray-600 hover:text-black hover:bg-gray-50"
                }`
              }
              to="/about"
            >
              ABOUT
            </NavLink>
            <NavLink
              onClick={() => setVisible(false)}
              className={({ isActive }) =>
                `py-3.5 px-6 border-b border-gray-100 text-sm font-semibold transition-colors ${
                  isActive ? "text-black bg-gray-50 font-bold" : "text-gray-600 hover:text-black hover:bg-gray-50"
                }`
              }
              to="/contact"
            >
              CONTACT
            </NavLink>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
