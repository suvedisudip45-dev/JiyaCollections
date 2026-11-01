/* eslint-disable no-unused-vars */
import React, { useContext } from "react";
import { assets } from "../assets/assets";
import { ShopContext } from "../context/ShopContext";

const OurPolicy = () => {
  const { storefrontContent } = useContext(ShopContext);
  const benefits = storefrontContent?.benefits || [];
  const fallbackImages = [assets.exchange_icon, assets.quality_icon, assets.support_img];

  return (
    <section className="storefront-section grid grid-cols-1 gap-8 py-10 text-center text-xs text-gray-700 sm:grid-cols-3 sm:gap-5 sm:py-12 sm:text-sm lg:gap-8 lg:py-16">
      {benefits.map((benefit, index) => (
        <div className="mx-auto w-full max-w-sm" key={`${benefit.title}-${index}`}>
          <img
            src={benefit.image || fallbackImages[index]}
            className="m-auto mb-5 h-12 w-12 object-contain"
            alt=""
          />
          <p className="font-semibold">{benefit.title}</p>
          <p className="text-gray-400">{benefit.description}</p>
        </div>
      ))}
    </section>
  );
};

export default OurPolicy;
