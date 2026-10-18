/* eslint-disable no-unused-vars */
import React from "react";
import { assets } from "../assets/assets";

const OurPolicy = () => {
  return (
    <section className="storefront-section grid grid-cols-1 gap-8 py-10 text-center text-xs text-gray-700 sm:grid-cols-3 sm:gap-5 sm:py-12 sm:text-sm lg:gap-8 lg:py-16">
      <div className="mx-auto w-full max-w-sm">
        <img src={assets.exchange_icon} className="w-12 m-auto mb-5" alt="" />
        <p className="font-semibold">Easy Exchange Policy</p>
        <p className="text-gray-400">We offer hassle free exchange policy</p>
      </div>
      <div className="mx-auto w-full max-w-sm">
        <img src={assets.quality_icon} className="w-12 m-auto mb-5" alt="" />
        <p className="font-semibold">7 Days Return Policy</p>
        <p className="text-gray-400">We provide 7 days free return policy</p>
      </div>
      <div className="mx-auto w-full max-w-sm">
        <img src={assets.support_img} className="w-12 m-auto mb-5" alt="" />
        <p className="font-semibold">Best customer support</p>
        <p className="text-gray-400">We provide 24/7 customer support</p>
      </div>
    </section>
  );
};

export default OurPolicy;
