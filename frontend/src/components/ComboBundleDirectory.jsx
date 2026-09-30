import { useContext, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";

const getComboBundleImages = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    return [value];
  }
  return [];
};

const ComboBundleDirectory = () => {
  const { backendUrl } = useContext(ShopContext);
  const [searchParams] = useSearchParams();
  const [category, setCategory] = useState(null);
  const [comboBundles, setComboBundles] = useState([]);
  const [loading, setLoading] = useState(true);

  const requestedCategoryId = searchParams.get("categoryId");
  const requestedCategoryName = searchParams.get("category") || "";

  useEffect(() => {
    let cancelled = false;

    const loadDirectory = async () => {
      setLoading(true);
      try {
        let resolvedCategoryId = requestedCategoryId;
        let resolvedCategory = null;

        if (resolvedCategoryId) {
          const categoriesResponse = await axios.get(`${backendUrl}/api/category/list`);
          resolvedCategory = (categoriesResponse.data.categories || []).find(
            (entry) => entry.id === resolvedCategoryId
          ) || null;
        } else if (requestedCategoryName) {
          const categoriesResponse = await axios.get(`${backendUrl}/api/category/list`);
          resolvedCategory = (categoriesResponse.data.categories || []).find(
            (entry) => entry.name.toLowerCase() === requestedCategoryName.toLowerCase()
          ) || null;
          resolvedCategoryId = resolvedCategory?.id || "";
        }

        if (!resolvedCategoryId) {
          if (!cancelled) {
            setCategory(null);
            setComboBundles([]);
          }
          return;
        }

        const response = await axios.get(`${backendUrl}/api/combo-bundles`, {
          params: { categoryId: resolvedCategoryId, status: "ACTIVE", includeProducts: "false" },
        });

        if (!cancelled) {
          setCategory(resolvedCategory || { id: resolvedCategoryId, name: requestedCategoryName });
          setComboBundles(response.data.success ? response.data.comboBundles || [] : []);
        }
      } catch (error) {
        console.error("Unable to load category collections:", error);
        if (!cancelled) {
          setCategory(null);
          setComboBundles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, requestedCategoryId, requestedCategoryName]);

  return (
    <main className="mx-auto w-full max-w-[1440px] pb-16">
      <section className="border-b border-[var(--line)] bg-[var(--paper)] px-5 py-12 text-center sm:px-8 sm:py-16">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          {category?.name || requestedCategoryName || "Shop"}
        </p>
        <h1 className="mt-3 text-3xl font-black uppercase text-[var(--ink)] sm:text-5xl">Combo Bundles</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-[var(--muted)]">
          {category ? `Explore curated ${category.name} edits.` : "Explore curated edits from the catalog."}
        </p>
      </section>

      <section className="px-4 pt-8 sm:px-8 sm:pt-12">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="aspect-[4/5] animate-pulse bg-[var(--stone)]" />)}
          </div>
        ) : comboBundles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg font-bold uppercase text-[var(--ink)]">No combo bundles yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">There are no active combo bundles in this category.</p>
            <Link to={`/shop?category=${encodeURIComponent(category?.name || requestedCategoryName)}`} className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--ink)] underline underline-offset-4">
              Browse products <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {comboBundles.map((comboBundle, index) => {
              const images = getComboBundleImages(comboBundle.image);
              const image = images[0] || comboBundle.bannerImage || "";
              const detailUrl = `/combo-bundles/${encodeURIComponent(comboBundle.slug || comboBundle.id)}?category=${encodeURIComponent(category?.name || requestedCategoryName)}&categoryId=${encodeURIComponent(category?.id || requestedCategoryId || "")}`;

              return (
                <Link key={comboBundle.id} to={detailUrl} className="group block">
                  <div className="relative aspect-[4/5] overflow-hidden bg-[var(--stone)]">
                    {image ? (
                      <img src={image} alt={comboBundle.name} loading={index > 2 ? "lazy" : "eager"} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-8 text-center text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Bundle image coming soon</div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-5 pb-5 pt-16 text-white sm:px-7 sm:pb-7">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75">{comboBundle.productCount || 0} pieces</p>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <h2 className="text-xl font-black uppercase sm:text-2xl">{comboBundle.name}</h2>
                        <ArrowRight size={20} className="mb-1 shrink-0 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </div>
                  {comboBundle.description && <p className="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{comboBundle.description}</p>}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};

export default ComboBundleDirectory;
