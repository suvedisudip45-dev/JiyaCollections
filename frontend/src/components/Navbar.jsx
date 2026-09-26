import { useContext, useEffect, useState } from "react";
import { assets } from "../assets/assets";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { Heart, Menu, Search, ShoppingBag, UserRound, X } from "lucide-react";
import axios from "axios";
import { revokeAuthSession } from "../auth/tokenStorage";

const Navbar = () => {
  const [visible, setVisible] = useState(false);
  const [activeMobileCategory, setActiveMobileCategory] = useState("");
  const location = useLocation();
  const {
    setShowSearch,
    getCartCount,
    navigate,
    token,
    setToken,
    setCartItems,
    backendUrl,
  } = useContext(ShopContext);

  const [navigationGroups, setNavigationGroups] = useState([]);

  useEffect(() => {
    const fetchNavigationOptions = async () => {
      try {
        const response = await axios.get(`${backendUrl}/api/category/navigation`);
        setNavigationGroups(response.data.success ? response.data.navigation || [] : []);
      } catch (error) {
        console.error("Unable to load storefront navigation options:", error);
        setNavigationGroups([]);
      }
    };

    fetchNavigationOptions();
  }, [backendUrl]);

  const categoryLinks = navigationGroups.slice(0, 3);

  useEffect(() => {
    if (categoryLinks.length && !categoryLinks.some((group) => group.name === activeMobileCategory)) {
      setActiveMobileCategory(categoryLinks[0].name);
    }
  }, [categoryLinks, activeMobileCategory]);

  const activeMobileGroup = categoryLinks.find((group) => group.name === activeMobileCategory) || categoryLinks[0];

  const handleSearchClick = () => {
    setShowSearch(true);
    if (!location.pathname.includes("collection")) {
      navigate("/collection");
    }
  };

  const logout = async () => {
    await revokeAuthSession(backendUrl);
    localStorage.removeItem("cartItems");
    setToken("");
    setCartItems({});
    navigate("/login");
  };


  return (
    <>
      <div className="announcement-bar" aria-label="Store announcements">
        <div className="announcement-track">
          {[1, 2].map((copy) => (
            <span className="announcement-copy" key={copy} aria-hidden={copy === 2}>
              Free shipping on orders over Rs 3,000 <b>•</b> Made for everyday movement
            </span>
          ))}
        </div>
      </div>
      <nav className="relative z-40 border-b border-[var(--line)] bg-[var(--paper)] font-medium">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-8 lg:px-12">
      <Link to={"/"} className="z-10 flex items-center gap-3">
        <img src={assets.logo} className="w-32 sm:w-36" alt="Logo" />
        <span className="hidden border-l border-[#c9c6bc] pl-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77776e] sm:block">
          Kathmandu / Nepal
        </span>
      </Link>

      {/* Desktop Navigation Links */}
      <ul className="hidden gap-7 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] lg:flex">
        {categoryLinks.map((group) => (
          <li key={group.name} className="group relative">
            <NavLink
              to={`/collection?category=${encodeURIComponent(group.name)}`}
              className="block py-2 transition-colors hover:text-[var(--ink)] focus:text-[var(--ink)]"
            >
              {group.name.toUpperCase()}
            </NavLink>
            <div className="invisible absolute left-1/2 top-full z-50 w-64 -translate-x-1/2 border border-[var(--line)] bg-[var(--white)] p-5 opacity-0 shadow-xl transition-all duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              <Link to={`/collection?category=${encodeURIComponent(group.name)}`} className="mb-4 block border-b border-[var(--line)] pb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink)] hover:text-[var(--accent)]">
                Shop {group.name}
              </Link>
              {group.newArrivalCount > 0 && (
                <Link to={`/collection?category=${encodeURIComponent(group.name)}&featured=new`} className="mb-3 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--accent)] hover:text-[var(--ink)]">
                  New arrivals
                </Link>
              )}
              <div className="flex flex-col gap-2">
                {group.subcategories.map((subcategory) => (
                  <Link key={`${group.name}-${subcategory}`} to={`/collection?category=${encodeURIComponent(group.name)}&subcategory=${encodeURIComponent(subcategory)}`} className="text-xs uppercase tracking-[0.06em] text-[var(--muted)] hover:text-[var(--ink)]">
                    {subcategory}
                  </Link>
                ))}
              </div>
            </div>
          </li>
        ))}
        <NavLink to="/collection?featured=new" className="transition-colors hover:text-[var(--ink)]">New Arrivals</NavLink>
        <NavLink to="/collection?featured=bestseller" className="transition-colors hover:text-[var(--ink)]">Best Sellers</NavLink>
        <NavLink to="/about" className="transition-colors hover:text-[var(--ink)]">The Journal</NavLink>
      </ul>

      <div className="z-10 flex items-center gap-4 sm:gap-5">
        <button onClick={handleSearchClick} className="icon-button" aria-label="Search products">
          <Search size={19} strokeWidth={1.8} />
        </button>
        <div className="group relative">
          <button onClick={() => (token ? null : navigate("/login"))} className="icon-button" aria-label="Account">
            <UserRound size={19} strokeWidth={1.8} />
          </button>
          {token && (
            <div className="group-hover:block hidden absolute right-0 pt-4 z-50">
              <div className="flex w-40 flex-col gap-3 border border-[var(--line)] bg-[var(--white)] px-5 py-4 text-sm text-[var(--muted)] shadow-xl">
                <p onClick={() => navigate("/profile")} className="cursor-pointer transition-colors hover:text-[var(--ink)]">My Profile</p>
                <p onClick={() => navigate("/orders")} className="cursor-pointer transition-colors hover:text-[var(--ink)]">Orders</p>
                <p onClick={() => navigate("/marketing-cards")} className="cursor-pointer transition-colors hover:text-[var(--ink)]">Marketing Cards</p>
                <p onClick={logout} className="cursor-pointer font-semibold text-[var(--accent)] transition-colors hover:text-[var(--ink)]">Logout</p>
              </div>
            </div>
          )}
        </div>
        <button onClick={() => navigate("/wishlist")} className="icon-button" aria-label="Wishlist">
          <Heart size={19} strokeWidth={1.8} />
        </button>
        <Link to="/cart" className="icon-button relative" aria-label="Shopping bag">
          <ShoppingBag size={20} strokeWidth={1.8} />
          <span className="cart-count">{getCartCount()}</span>
        </Link>
        <button onClick={() => setVisible(true)} className="icon-button lg:hidden" aria-label="Open menu">
          <Menu size={21} strokeWidth={1.8} />
        </button>
      </div>
        </div>

      </nav>

      {visible && <div onClick={() => setVisible(false)} className="fixed inset-0 z-50 bg-black/45 lg:hidden" />}
      <div className={`fixed right-0 top-0 z-[60] h-full overflow-y-auto bg-[var(--paper)] shadow-2xl transition-all duration-300 lg:hidden ${visible ? "w-full max-w-[390px]" : "pointer-events-none w-0 overflow-hidden"}`}>
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <button onClick={() => setVisible(false)} className="icon-button" aria-label="Close menu"><X size={27} strokeWidth={1.8} /></button>
          <button onClick={() => { setVisible(false); navigate(token ? "/profile" : "/login"); }} className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink)]">
            <UserRound size={18} strokeWidth={1.6} /> {token ? "Account" : "Login"}
          </button>
          <Link to="/cart" onClick={() => setVisible(false)} className="icon-button" aria-label="Shopping bag"><ShoppingBag size={23} strokeWidth={1.7} /></Link>
        </div>

        <div className="flex border-b border-[var(--line)] px-4 pt-4">
          {categoryLinks.map((group) => (
            <button
              key={group.name}
              type="button"
              onClick={() => setActiveMobileCategory(group.name)}
              className={`flex-1 border-b-2 px-2 pb-4 text-center text-sm font-bold capitalize transition-colors ${activeMobileCategory === group.name ? "border-[var(--ink)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              {group.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col">
          {activeMobileGroup && (
            <div className="border-b border-[var(--line)]">
              {activeMobileGroup.newArrivalCount > 0 && (
                <Link onClick={() => setVisible(false)} to={`/collection?category=${encodeURIComponent(activeMobileGroup.name)}&featured=new`} className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5 text-sm font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                  {activeMobileGroup.name} new arrivals <span className="text-xl">→</span>
                </Link>
              )}
              {activeMobileGroup.subcategories.map((subcategory) => (
                <Link key={`${activeMobileGroup.name}-${subcategory}`} onClick={() => setVisible(false)} to={`/collection?category=${encodeURIComponent(activeMobileGroup.name)}&subcategory=${encodeURIComponent(subcategory)}`} className="block border-b border-[var(--line)] px-5 py-5 text-sm uppercase tracking-[0.08em] text-[var(--muted)] hover:text-[var(--ink)]">
                  {subcategory}
                </Link>
              ))}
            </div>
          )}
          <Link onClick={() => setVisible(false)} to="/collection?featured=bestseller" className="border-b border-[var(--line)] px-5 py-5 text-sm font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Best sellers
          </Link>
          <Link onClick={() => setVisible(false)} to="/contact" className="border-b border-[var(--line)] px-5 py-5 text-sm font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Contact
          </Link>
        </div>

        <Link onClick={() => setVisible(false)} to="/collection" className="group relative block aspect-[4/5] overflow-hidden bg-[var(--stone)]">
          <img src={assets.hero_img} alt="Explore the collection" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <div className="absolute bottom-7 left-6 text-white">
            <p className="text-2xl font-bold uppercase tracking-[0.08em]">Explore the edit</p>
            <span className="mt-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">Shop now <span className="text-lg">→</span></span>
          </div>
        </Link>
      </div>
    </>
  );
};

export default Navbar;
