/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import ProductItem from "./ProductItem";
import axios from "axios";
import { Link } from "react-router-dom";

const DEFAULT_THEME_COLOR = "#7c3aed";
const DEFAULT_THEME_COLOR_SECONDARY = "#f59e0b";

const getCampaignTheme = (startValue, endValue) => {
  const startColor = /^#[0-9a-f]{6}$/i.test(startValue || "") ? startValue : DEFAULT_THEME_COLOR;
  const endColor = /^#[0-9a-f]{6}$/i.test(endValue || "")
    ? endValue
    : DEFAULT_THEME_COLOR_SECONDARY;
  const colors = [startColor, endColor].map((color) =>
    [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
      .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      }),
  );
  const luminance = colors[0].reduce(
    (sum, channel, index) => sum + ((channel + colors[1][index]) / 2) * [0.2126, 0.7152, 0.0722][index],
    0,
  );

  return {
    startColor,
    endColor,
    foreground: luminance > 0.42 ? "#172033" : "#ffffff",
  };
};

const FestiveOfferBanner = ({ offer }) => {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isExpired: false,
  });

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

  if (!offer || timeLeft.isExpired) {
    return null;
  }

  const cleanTitle = offer.title ? offer.title.replace(/🎉|✨|🎁|🔥/g, "").trim() : "Festive Special Offer";
  const cleanBadge = offer.badgeText ? offer.badgeText.replace(/🎉|✨|🎁|🔥/g, "").trim() : "FESTIVE SPECIAL OFFER";
  const theme = getCampaignTheme(offer.themeColor, offer.themeColorSecondary);

  return (
    <div
      className="my-12 rounded-3xl p-6 sm:p-10 shadow-xl relative overflow-hidden border"
      style={{
        background: `linear-gradient(115deg, ${theme.startColor}, ${theme.endColor})`,
        borderColor: theme.startColor,
        color: theme.foreground,
      }}
    >
      <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ backgroundColor: theme.endColor, opacity: 0.28 }}></div>
      <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ backgroundColor: theme.startColor, opacity: 0.28 }}></div>

      {/* Header & Live Countdown */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b" style={{ borderColor: `${theme.foreground}40` }}>
        <div className="space-y-3 max-w-2xl">
          <div
            className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-xs font-bold tracking-wider uppercase border border-white/30 shadow-xs"
            style={{ color: theme.foreground }}
          >
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: theme.foreground }}></span>
            <span>{cleanBadge || "FESTIVE SPECIAL OFFER"}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight drop-shadow-sm">
            {cleanTitle}
          </h2>
          <p className="text-sm sm:text-base max-w-xl font-medium leading-relaxed">
            {offer.subtitle}
          </p>
        </div>

        {/* Live Timer Card */}
        <div className="bg-black/25 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/30 shadow-lg flex flex-col items-center sm:items-start gap-1.5 self-start lg:self-auto">
          <p className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: theme.foreground }}></span>
            FESTIVE OFFER ENDS IN:
          </p>
          <div className="flex items-center gap-2 sm:gap-3 text-center pt-1">
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black block">
                {String(timeLeft.days).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold">Days</span>
            </div>
            <span className="text-xl font-bold opacity-80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black block">
                {String(timeLeft.hours).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold">Hours</span>
            </div>
            <span className="text-xl font-bold opacity-80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black block">
                {String(timeLeft.minutes).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold">Mins</span>
            </div>
            <span className="text-xl font-bold opacity-80">:</span>
            <div className="bg-white/20 backdrop-blur-md px-3.5 py-2 rounded-xl min-w-[56px] border border-white/20 shadow-xs">
              <span className="text-xl sm:text-2xl font-black block">
                {String(timeLeft.seconds).padStart(2, "0")}
              </span>
              <span className="text-[9px] uppercase font-bold">Secs</span>
            </div>
          </div>
        </div>
      </div>

      {offer.products?.length > 0 && (
        <div className="relative z-10 pt-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {offer.products.slice(0, 10).map((item) => (
              <div
                key={item._id}
                className="bg-white p-3 rounded-2xl shadow-lg border border-gray-100 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1"
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
        </div>
      )}

      <div className="relative z-10 text-center mt-9">
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 font-bold px-8 py-3.5 rounded-full text-sm transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
            style={{ color: theme.startColor }}
          >
            <span>Explore All Festive Deals</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
      </div>
    </div>
  );
};

const FestiveOfferSection = () => {
  const { backendUrl } = useContext(ShopContext);
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const fetchActiveOffers = async () => {
      try {
        const res = await axios.get(`${backendUrl}/api/offer/active`, {
          params: { refresh: Date.now() },
        });
        if (!isMounted) return;
        if (res.data.success) {
          const activeOffers = Array.isArray(res.data.activeOffers)
            ? res.data.activeOffers
            : res.data.activeOffer
              ? [res.data.activeOffer]
              : [];
          setOffers(activeOffers);
        } else {
          setOffers([]);
        }
      } catch (err) {
        console.error("Error fetching active special offers:", err);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") fetchActiveOffers();
    };

    fetchActiveOffers();
    const refreshInterval = window.setInterval(fetchActiveOffers, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [backendUrl]);

  return (
    <>
      {offers.map((offer) => (
        <FestiveOfferBanner key={offer.id} offer={offer} />
      ))}
    </>
  );
};

export default FestiveOfferSection;
