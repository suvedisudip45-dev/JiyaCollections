/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import Home from "./pages/Home";
import Collection from "./pages/Collection";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import Login from "./pages/Login";
import PlaceOrder from "./pages/PlaceOrder";
import Orders from "./pages/Orders";
import Profile from "./pages/Profile";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import SearchBar from "./components/SearchBar";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Verify from "./pages/Verify";
import Wishlist from "./pages/Wishlist";
import MarketingCards from "./pages/MarketingCards";
import { ShopContext } from "./context/ShopContext";
import { installAuthInterceptor } from "./api/authInterceptor";

installAuthInterceptor();

const CustomerOnly = () => {
  const { token } = useContext(ShopContext);
  return token ? <Outlet /> : <Navigate to="/" replace />;
};

const App = () => {
  return (
    <div className="fashion-shell min-h-screen">
      <ToastContainer />
      <Navbar />
      <SearchBar />
      <main className="storefront-main px-3 sm:px-5 lg:px-8">
        <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/product/:productId" element={<Product />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/login" element={<Login />} />
        <Route element={<CustomerOnly />}>
          <Route path="place-order" element={<PlaceOrder />} />
          <Route path="orders" element={<Orders />} />
          <Route path="profile" element={<Profile />} />
          <Route path="marketing-cards" element={<MarketingCards />} />
        </Route>
        <Route path="/verify" element={<Verify />} />
        <Route path="/wishlist" element={<Wishlist />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};

export default App;
