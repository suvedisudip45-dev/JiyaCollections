import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";

const getImages = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [value];
  }
};

const CollaborationDirectory = () => {
  const { backendUrl } = useContext(ShopContext);
  const [collaborations, setCollaborations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    axios.get(`${backendUrl}/api/collaborations/public/products`)
      .then((response) => {
        if (!cancelled) setCollaborations(response.data.collaborations || []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.response?.data?.message || "Unable to load collaboration products.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [backendUrl]);

  return (
    <main className="mx-auto w-full max-w-[1440px] pb-16">
      <section className="border-b border-[var(--line)] bg-[var(--paper)] px-5 py-12 text-center sm:px-8 sm:py-16">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Partner edit</p>
        <h1 className="mt-3 text-3xl font-black uppercase text-[var(--ink)] sm:text-5xl">Collaboration</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--muted)]">Products made with our marketing partners.</p>
      </section>

      <section className="px-4 pt-8 sm:px-8 sm:pt-12">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="aspect-[4/5] animate-pulse bg-[var(--stone)]" />)}
          </div>
        ) : error ? (
          <p role="alert" className="py-16 text-center text-sm text-rose-700">{error}</p>
        ) : collaborations.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg font-bold uppercase text-[var(--ink)]">No collaboration products yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">New partner products will appear here when available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {collaborations.map((entry, index) => {
              const product = entry.product;
              if (!product) return null;
              const image = getImages(product.image)[0];
              const salePrice = Math.round(Number(product.price || 0) * (1 - Number(product.discount || 0) / 100));
              return (
                <Link key={entry.id} to={`/product/${product.id}`} className="group block">
                  <div className="relative aspect-[4/5] overflow-hidden bg-[var(--stone)]">
                    {image ? <img src={image} alt={product.name} loading={index > 2 ? "lazy" : "eager"} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-xs font-bold uppercase text-[var(--muted)]">Product image coming soon</div>}
                    {Number(product.discount || 0) > 0 && <span className="absolute left-3 top-3 bg-[var(--accent)] px-2.5 py-1 text-[10px] font-bold uppercase text-white">{product.discount}% off</span>}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent px-5 pb-5 pt-14 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75">{entry.partner?.name || "Partner"}</p>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <h2 className="text-lg font-black uppercase">{product.name}</h2>
                        <ArrowRight size={19} className="mb-1 shrink-0 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2 text-sm">
                    <span className="font-bold text-[var(--ink)]">Rs. {salePrice.toLocaleString()}</span>
                    {salePrice < Number(product.price || 0) && <span className="text-xs text-[var(--muted)] line-through">Rs. {Number(product.price || 0).toLocaleString()}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};

export default CollaborationDirectory;