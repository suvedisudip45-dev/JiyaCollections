/* eslint-disable no-unused-vars */
/* eslint-disable react/prop-types */
import React from "react";

const Title = ({ text1, text2 }) => {
  return (
    <div className="mb-3 inline-flex items-center gap-3">
      <p className="eyebrow">
        {text1} <span className="text-gray-700 font-medium">{text2}</span>
      </p>
      <p className="h-px w-8 bg-[#9a5945] sm:w-12"></p>
    </div>
  );
};

export default Title;
