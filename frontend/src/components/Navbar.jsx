import { useContext, useState } from "react";
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
    <nav className="relative z-40 flex items-center justify-between border-b border-[#dedbd1] py-5 font-medium">
      <Link to={"/"} className="z-10 flex items-center gap-3">
        <img src={assets.logo} className="w-32 sm:w-36" alt="Logo" />
        <span className="hidden border-l border-[#c9c6bc] pl-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77776e] sm:block">
          Kathmandu / Nepal
        </span>
      </Link>

      {/* Desktop Navigation Links */}
      <ul className="hidden gap-8 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#77776e] sm:flex">
        <NavLink to="/" className="flex flex-col items-center gap-1 transition-colors hover:text-[#161714]">
          <p>Home</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/collection" className="flex flex-col items-center gap-1 transition-colors hover:text-[#161714]">
          <p>Collection</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/about" className="flex flex-col items-center gap-1 transition-colors hover:text-[#161714]">
          <p>About</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/contact" className="flex flex-col items-center gap-1 transition-colors hover:text-[#161714]">
          <p>Contact</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
      </ul>

      <div className="z-10 flex items-center gap-4 sm:gap-5">
        <img
          onClick={handleSearchClick}
          src={assets.search_icon}
          className="h-5 w-5 cursor-pointer opacity-70 transition-opacity hover:opacity-100"
          alt="Search"
        />

        {/* Profile / Account Dropdown */}
        <div className="group relative">
          <img
            onClick={() => (token ? null : navigate("/login"))}
            src={assets.profile_icon}
            className="h-5 w-5 cursor-pointer opacity-70 transition-opacity hover:opacity-100"
            alt="Profile"
          />
          {token && (
            <div className="group-hover:block hidden absolute right-0 pt-4 z-50">
              <div className="flex w-40 flex-col gap-3 rounded-none border border-[#dedbd1] bg-[#fffefa] px-5 py-4 text-sm text-[#77776e] shadow-xl">
                <p
                  onClick={() => navigate("/profile")}
                  className="cursor-pointer transition-colors hover:text-[#161714]"
                >
                  My Profile
                </p>
                <p
                  onClick={() => navigate("/orders")}
                  className="cursor-pointer transition-colors hover:text-[#161714]"
                >
                  Orders
                </p>
                <p
                  onClick={logout}
                  className="cursor-pointer font-semibold text-[#9a5945] transition-colors hover:text-[#641f2b]"
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
          <p className="absolute bottom-[-5px] right-[-5px] aspect-square w-4 rounded-full bg-[#161714] text-center text-[8px] font-bold leading-4 text-white">
            {getCartCount()}
          </p>
        </Link>

        {/* Mobile Hamburger Menu Icon */}
        <img
          onClick={() => setVisible(true)}
          src={assets.menu_icon}
          className="w-5 cursor-pointer opacity-70 transition-opacity hover:opacity-100 sm:hidden"
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
