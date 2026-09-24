/* eslint-disable no-unused-vars */
import React from "react";
import { assets } from "../assets/assets";

const Footer = () => {
  return (
    <footer className="mt-32 border-t border-[#d9d6cc] pt-12 text-sm">
      <div className="my-10 grid gap-12 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <img className="mb-5 w-32" src={assets.logo} alt="Aama Collections" />
          <p className="w-full max-w-md leading-7 text-[#77776e]">
          At Aama Collections, we redefine fashion with an emphasis on grace, poise, and enduring style. Each piece in our collection is thoughtfully crafted to exude sophistication, blending classic aesthetics with modern trends. Whether you’re dressing for a special occasion or elevating your everyday look, Aama Collections promises designs that make you feel confident, refined, and truly unforgettable.
          </p>
        </div>
        <div>
          <p className="eyebrow mb-5">Company</p>
          <ul className="flex flex-col gap-3 text-[#77776e]">
            <li>Home</li>
            <li>About us</li>
            <li>Delivery</li>
            <li>Privacy policy</li>
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-5">Get in touch</p>
          <ul className="flex flex-col gap-3 text-[#77776e]">
            <li>+1-8515-56789</li>
            <li>contact@aamacollections.com</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[#d9d6cc]">
        <p className="py-5 text-center text-xs text-[#96958c]">
          Copyright 2026 @ Aasha Technologies - All Rights Reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
