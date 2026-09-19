/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import ProductItem from "./ProductItem";
import axios from "axios";
import { Link } from "react-router-dom";

const FestiveOfferSection = () => {
  const { backendUrl, products } = useContext(ShopContext);
  const [offer, setOffer] = useState(null);
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isExpired: false,
  });

  const fetchActiveOffer = async () => {
    try {
      const res = await axios.get(backendUrl + "/api/offer/active");
      if (res.data.success && res.data.activeOffer) {
        setOffer(res.data.activeOffer);
      } else {
        setOffer(null);
      }
    } catch (err) {
      console.error("Error fetching active special offer:", err);
    }
  };

  useEffect(() => {
    fetchActiveOffer();
  }, [backendUrl]);

  // Live Countdown calculation
  useEffect(() => {
    if (!offer || !offer.endDate) return;

    const calculateTimeLeft = () => {
      const difference = new Date(offer.endDate).getTime() - new Date().getTime();
      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        isExpired: false,
      };
    };

    setTimeLeft(calculateTimeLeft());
    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining.isExpired) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [offer]);

  if (!offer || timeLeft.isExpired || !offer.products || offer.products.length === 0) {
    return null;
  }

  const cleanTitle = offer.title ? offer.title.replace(/🎉|✨|🎁|🔥/g, "").trim() : "Festive Special Offer";
  const cleanBadge = offer.badgeText ? offer.badgeText.replace(/🎉|✨|🎁|🔥/g, "").trim() : "FESTIVE SPECIAL OFFER";

  return (
    <div className="my-12 rounded-3xl p-6 sm:p-10 bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 text-white shadow-xl relative overflow-hidden border border-rose-300">
      {/* Decorative bright festive radiant ambient glows */}
      <div className="absolute -top-20 -right-20 w-80 h-80 bg-amber-300/30 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-red-300/30 rounded-full blur-3xl pointer-events-none"></div>

      {/* Header & Live Countdown */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-white/25">
        <div className="space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-xs font-bold tracking-wider uppercase text-amber-100 border border-white/30 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse"></span>
            <span>{cleanBadge || "FESTIVE SPECIAL OFFER"}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white drop-shadow-sm">
            {cleanTitle}
          </h2>
          <p className="text-sm sm:text-base text-rose-50 max-w-xl font-medium leading-relaxed">
            {offer.subtitle}
          </p>
        </div>

        {/* Live Timer Card */}
        <div className="bg-black/25 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/30 shadow-lg flex flex-col items-center sm:items-start gap-1.5 self-start lg:self-auto">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping"></span>
            FESTIVE OFFER ENDS IN:
          </p>
          <div className="flex items-center gap-2 sm:gap-3 text-center pt-1">
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black text-white block">
                {String(timeLeft.days).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold text-amber-100">Days</span>
            </div>
            <span className="text-xl font-bold text-white/80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black text-white block">
                {String(timeLeft.hours).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold text-amber-100">Hours</span>
            </div>
            <span className="text-xl font-bold text-white/80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black text-white block">
                {String(timeLeft.minutes).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold text-amber-100">Mins</span>
            </div>
            <span className="text-xl font-bold text-white/80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black text-white block">
                {String(timeLeft.seconds).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold text-amber-100">Secs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Featured Products Grid */}
      <div className="relative z-10 pt-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {offer.products.slice(0, 10).map((item) => (
            <div
              key={item._id}
              className="bg-white p-3 rounded-2xl shadow-lg border border-rose-100 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <ProductItem
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
            </div>
          ))}
        </div>

        <div className="text-center mt-9">
          <Link
            to="/collection"
            className="inline-flex items-center gap-2 bg-white hover:bg-rose-50 text-red-600 font-bold px-8 py-3.5 rounded-full text-sm transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <span>Explore All Festive Deals</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default FestiveOfferSection;
