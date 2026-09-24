/* eslint-disable react/prop-types */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

const ProductImageCarousel = ({ images = [], alt = "Product" }) => {
  const validImages = images.filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);

  if (!validImages.length) {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-[9px] font-bold text-slate-400">
        No Img
      </div>
    );
  }

  const move = (direction) => {
    setActiveIndex((current) => (current + direction + validImages.length) % validImages.length);
  };

  return (
    <div className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <img className="h-full w-full object-cover" src={validImages[activeIndex]} alt={alt} />
      {validImages.length > 1 && (
        <>
          <button type="button" onClick={() => move(-1)} aria-label="Previous product image" className="absolute left-0 top-1/2 hidden -translate-y-1/2 bg-black/60 p-0.5 text-white group-hover:block">
            <ChevronLeft size={10} />
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Next product image" className="absolute right-0 top-1/2 hidden -translate-y-1/2 bg-black/60 p-0.5 text-white group-hover:block">
            <ChevronRight size={10} />
          </button>
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 bg-black/65 px-1 text-[8px] leading-3 text-white">
            {activeIndex + 1}/{validImages.length}
          </span>
        </>
      )}
    </div>
  );
};

export default ProductImageCarousel;