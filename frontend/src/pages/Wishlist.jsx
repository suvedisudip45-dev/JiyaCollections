import { useContext } from "react";
import { Link } from "react-router-dom";
import ProductItem from "../components/ProductItem";
import { ShopContext } from "../context/ShopContext";

const Wishlist = () => {
  const { products, wishlist } = useContext(ShopContext);
  const savedProducts = products.filter((product) => wishlist.includes(product._id));

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-12 sm:px-8 lg:px-12 lg:py-20">
      <div className="mb-10 border-b border-[var(--line)] pb-7">
        <p className="eyebrow mb-3">Your edit</p>
        <h1 className="text-4xl font-bold tracking-[-0.05em] sm:text-6xl">Wishlist</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">{savedProducts.length} saved {savedProducts.length === 1 ? "piece" : "pieces"}</p>
      </div>
      {savedProducts.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {savedProducts.map((item) => <ProductItem key={item._id} {...item} id={item._id} stockQuantity={item.stockQuantity ?? 0} />)}
        </div>
      ) : (
        <div className="border border-dashed border-[var(--line)] px-6 py-20 text-center">
          <p className="text-lg font-semibold">Nothing saved yet.</p>
          <Link to="/collection" className="mt-5 inline-flex bg-[var(--ink)] px-6 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white">Explore the collection</Link>
        </div>
      )}
    </section>
  );
};

export default Wishlist;