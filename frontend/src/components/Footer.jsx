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
          At Aama Collections, we redefine everyday fashion with a focus on refined structure, confident silhouettes, and long-wearing essentials. Each piece is designed to move seamlessly from daily life to elevated moments, helping you feel polished, comfortable, and effortlessly styled.
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
