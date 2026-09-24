/* eslint-disable react/prop-types */
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router-dom";
import ProductItem from "./ProductItem";

const ProductRail = ({ eyebrow, title, description, products = [], actionLabel = "Shop all" }) => {
  const railRef = useRef(null);
  const moveRail = (direction) => {
    railRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  };

  if (!products.length) return null;

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-8 lg:px-12 lg:py-20">
      <div className="mb-7 flex items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">{eyebrow}</p>
          <h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-5xl">{title}</h2>
          {description && <p className="mt-3 max-w-lg text-sm text-[var(--muted)]">{description}</p>}
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <button onClick={() => moveRail(-1)} className="icon-button h-10 w-10 border border-[var(--line)]" aria-label="Previous products"><ChevronLeft size={18} /></button>
          <button onClick={() => moveRail(1)} className="icon-button h-10 w-10 border border-[var(--line)]" aria-label="Next products"><ChevronRight size={18} /></button>
          <Link to="/collection" className="ml-3 hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] lg:flex">{actionLabel} <ArrowRight size={15} /></Link>
        </div>
      </div>
      <div ref={railRef} className="flex snap-x gap-4 overflow-x-auto pb-2 sm:gap-5">
        {products.slice(0, 10).map((item) => (
          <div key={item._id} className="w-[68vw] min-w-[68vw] snap-start sm:w-[31vw] sm:min-w-[31vw] md:w-[23vw] md:min-w-[23vw] lg:w-[18.5vw] lg:min-w-[18.5vw]">
            <ProductItem {...item} id={item._id} image={item.image} stockQuantity={item.stockQuantity ?? 0} />
          </div>
        ))}
      </div>
      <Link to="/collection" className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] sm:hidden">{actionLabel} <ArrowRight size={15} /></Link>
    </section>
  );
};

export default ProductRail;