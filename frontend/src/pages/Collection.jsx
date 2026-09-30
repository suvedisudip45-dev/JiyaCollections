import { useContext, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import ProductItem from "../components/ProductItem";
import axios from "axios";
import { Loader2, ArrowUpDown } from "lucide-react";

const Collection = () => {
  const { search, showSearch, backendUrl } = useContext(ShopContext);
  const [searchParams] = useSearchParams();

  // Filters from URL
  const [category, setCategory] = useState([]);
  const [subCategory, setSubCategory] = useState([]);
  const [sortType, setSortType] = useState("relavent");
  const featuredFilter = searchParams.get("featured");

  // Metadata for subcategory / category banner & description
  const [subcategoryMeta, setSubcategoryMeta] = useState(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // Pagination & Chunked Data State
  const [productsList, setProductsList] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const loadMoreRef = useRef(null);

  // Sync search params from URL
  useEffect(() => {
    const requestedCategory = searchParams.get("category");
    const requestedSubcategory = searchParams.get("subcategory");
    setCategory(requestedCategory ? [requestedCategory] : []);
    setSubCategory(requestedSubcategory ? [requestedSubcategory] : []);
    setIsDescriptionExpanded(false);
  }, [searchParams]);

  // Fetch subcategory banner & description metadata
  useEffect(() => {
    if (!subCategory[0]) {
      setSubcategoryMeta(null);
      return;
    }
    axios
      .get(`${backendUrl}/api/subcategory/list`)
      .then((response) => {
        const list = response.data.subCategories || [];
        const match =
          list.find(
            (item) =>
              item.name.toLowerCase() === subCategory[0].toLowerCase() &&
              (!category[0] ||
                !item.category ||
                item.category.name.toLowerCase() === category[0].toLowerCase())
          ) || list.find((item) => item.name.toLowerCase() === subCategory[0].toLowerCase());
        setSubcategoryMeta(match || null);
      })
      .catch(() => setSubcategoryMeta(null));
  }, [backendUrl, subCategory, category]);

  // Fetch first chunk of products whenever filters change
  useEffect(() => {
    const fetchFirstChunk = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (category[0]) params.set("category", category[0]);
        if (subCategory[0]) params.set("subcategory", subCategory[0]);
        if (featuredFilter) params.set("featured", featuredFilter);
        params.set("page", "1");
        params.set("limit", "12");

        const response = await axios.get(`${backendUrl}/api/product/list?${params.toString()}`);
        if (response.data.success) {
          const prods = response.data.products || [];
          setProductsList(prods);
          setPage(1);
          setHasNextPage(Boolean(response.data.pagination?.hasNextPage));
          setTotalCount(response.data.pagination?.total ?? prods.length);
        } else {
          setProductsList([]);
          setHasNextPage(false);
          setTotalCount(0);
        }
      } catch (error) {
        console.error("Error fetching collection products:", error);
        setProductsList([]);
        setHasNextPage(false);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFirstChunk();
  }, [backendUrl, category, subCategory, featuredFilter, searchParams]);

  // Infinite Scroll IntersectionObserver to fetch next chunk dynamically
  useEffect(() => {
    if (!hasNextPage || isLoading || isLoadingMore || !loadMoreRef.current) return undefined;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsLoadingMore(true);
        try {
          const nextPage = page + 1;
          const params = new URLSearchParams();
          if (category[0]) params.set("category", category[0]);
          if (subCategory[0]) params.set("subcategory", subCategory[0]);
          if (featuredFilter) params.set("featured", featuredFilter);
          params.set("page", String(nextPage));
          params.set("limit", "12");

          const response = await axios.get(`${backendUrl}/api/product/list?${params.toString()}`);
          if (response.data.success) {
            const newItems = response.data.products || [];
            setProductsList((prev) => [...prev, ...newItems]);
            setPage(nextPage);
            setHasNextPage(Boolean(response.data.pagination?.hasNextPage));
          }
        } catch (error) {
          console.error("Error fetching next chunk of products:", error);
        } finally {
          setIsLoadingMore(false);
        }
      },
      { rootMargin: "350px" }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [backendUrl, category, subCategory, featuredFilter, hasNextPage, isLoading, isLoadingMore, page]);

  // Apply in-memory search and client-side sorting
  const getProcessedProducts = () => {
    let list = [...productsList];

    if (showSearch && search) {
      const q = search.toLowerCase().trim();
      list = list.filter((item) => {
        const matchName = item.name?.toLowerCase().includes(q);
        const matchSub = item.subCategory && item.subCategory.toLowerCase().includes(q);
        const matchCat = Array.isArray(item.categories)
          ? item.categories.some((c) => c.toLowerCase().includes(q))
          : typeof item.category === "string" && item.category.toLowerCase().includes(q);
        return matchName || matchSub || matchCat;
      });
    }

    switch (sortType) {
      case "low-high":
        return list.sort((a, b) => a.price - b.price);
      case "high-low":
        return list.sort((a, b) => b.price - a.price);
      case "newest":
        return list.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
      case "top-rated":
        return list.sort((a, b) => {
          const rA = Number(a.rating || 0);
          const rB = Number(b.rating || 0);
          if (rB !== rA) return rB - rA;
          return (b.reviewCount || 0) - (a.reviewCount || 0);
        });
      default:
        return list;
    }
  };

  const displayedProducts = getProcessedProducts();
  // Subcategory or Category Banner Title
  const bannerTitle = subCategory[0]
    ? subCategory[0].toUpperCase()
    : category[0]
    ? category[0].toUpperCase()
    : featuredFilter === "new"
    ? "NEW ARRIVALS"
    : featuredFilter === "bestseller"
    ? "BEST SELLERS"
    : "ALL PRODUCTS";

  const descriptionText =
    subcategoryMeta?.description ||
    (category[0]
      ? `Explore our signature ${category[0]}'s collection, tailored for modern comfort, exceptional fit, and durable street aesthetic.`
      : featuredFilter === "new"
      ? "Discover the newest arrivals and trending drops crafted for effortless style."
      : featuredFilter === "bestseller"
      ? "Our most sought-after silhouettes and crowd favorites, loved by customers across Nepal."
      : "Shop our complete catalog of clothing, essentials, and signature wear.");

  const heroImage = subcategoryMeta?.image;

  const shouldTruncateDescription = descriptionText.length > 140;

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-16">
      {/* --- HERO BANNER & BREADCRUMBS SECTION (BONKERS CORNER STYLE) --- */}
      <section className="relative w-full overflow-hidden bg-[var(--stone)]">
        {heroImage ? (
          <div className="relative h-[280px] sm:h-[380px] md:h-[460px] w-full overflow-hidden">
            <img
              src={heroImage}
              alt={bannerTitle}
              className="h-full w-full object-cover object-center"
            />
            {/* Dark Vignette Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30" />

            {/* Breadcrumb over image */}
            <div className="absolute top-4 left-4 sm:left-8 z-10 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/90">
              <Link to="/" className="underline hover:text-white transition-colors">
                Home
              </Link>
              <span className="text-white/60">/</span>
              <Link to="/shop" className="underline hover:text-white transition-colors">
                Shop
              </Link>
              {category[0] && <><span className="text-white/60">/</span><Link to={`/shop?category=${encodeURIComponent(category[0])}`} className="underline hover:text-white transition-colors">{category[0]}</Link></>}
              {subCategory[0] && <><span className="text-white/60">/</span><span className="font-bold text-white">{subCategory[0]}</span></>}
            </div>

            {/* Centered Large Bold Title */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-widest text-white text-center drop-shadow-md">
                {bannerTitle}
              </h1>
            </div>
          </div>
        ) : (
          <div className="relative py-12 px-4 sm:px-8 border-b border-[var(--line)] bg-[var(--paper)] text-center">
            {/* Breadcrumb for text banner */}
            <div className="mb-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
              <Link to="/" className="hover:text-[var(--ink)] underline transition-colors">
                Home
              </Link>
              <span>/</span>
              <Link to="/shop" className="hover:text-[var(--ink)] underline transition-colors">
                Shop
              </Link>
              {category[0] && <><span>/</span><Link to={`/shop?category=${encodeURIComponent(category[0])}`} className="underline hover:text-[var(--ink)]">{category[0]}</Link></>}
              {subCategory[0] && <><span>/</span><span className="font-bold text-[var(--ink)]">{subCategory[0]}</span></>}
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-wider text-[var(--ink)]">
              {bannerTitle}
            </h1>
          </div>
        )}

        {/* Subcategory Description with "Read more" / "Read less" */}
        {descriptionText && (
          <div className="border-b border-[var(--line)] bg-[var(--paper)] px-4 py-4 sm:px-8">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-xs sm:text-sm leading-relaxed text-[var(--muted)]">
                {shouldTruncateDescription && !isDescriptionExpanded
                  ? `${descriptionText.slice(0, 130)}...`
                  : descriptionText}
                {shouldTruncateDescription && (
                  <button
                    type="button"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    className="ml-2 inline-block font-bold text-[var(--ink)] underline hover:text-[var(--accent)] text-xs uppercase tracking-wider cursor-pointer"
                  >
                    {isDescriptionExpanded ? "Read less" : "Read more"}
                  </button>
                )}
              </p>
            </div>
          </div>
        )}
      </section>

      <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]/95 px-4 py-3 backdrop-blur-md sm:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--ink)]"><span>{totalCount} PRODUCTS</span></div>
            <div className="flex items-center gap-2">
              <ArrowUpDown size={14} className="hidden text-[var(--muted)] sm:inline-block" />
              <select value={sortType} onChange={(event) => setSortType(event.target.value)} className="border border-[var(--line)] bg-[var(--white)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ink)] outline-none">
                <option value="relavent">Sort by: Relevant</option>
                <option value="newest">Sort by: Newest Arrivals</option>
                <option value="top-rated">Sort by: Top Rated</option>
                <option value="low-high">Sort by: Price: Low to High</option>
                <option value="high-low">Sort by: Price: High to Low</option>
              </select>
            </div>
          </div>
      </div>

      <div className="px-4 pt-8 sm:px-8">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
              {[...Array(8)].map((_, i) => <div key={i} className="animate-pulse flex flex-col space-y-3"><div className="bg-gray-200 aspect-[3/4] w-full rounded-md" /><div className="h-4 bg-gray-200 rounded w-3/4" /><div className="h-3 bg-gray-200 rounded w-1/2" /></div>)}
            </div>
          ) : displayedProducts.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center justify-center">
              <p className="text-lg font-bold uppercase tracking-wider text-[var(--ink)]">No products found</p>
              <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">We couldn&apos;t find any items in this category yet.</p>
              <Link to="/shop" className="mt-6 bg-black px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-gray-800">View All Products</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
              {displayedProducts.map((item, index) => <ProductItem key={`${item._id || item.id}-${index}`} name={item.name} id={item._id || item.id} price={item.price} image={item.image} discount={item.discount} stockStatus={item.stockStatus} stockQuantity={item.stockQuantity ?? 0} variants={item.variants} rating={item.rating} reviewCount={item.reviewCount} newInStore={item.newInStore} bestseller={item.bestseller} />)}
            </div>
          )}
          <div ref={loadMoreRef} className="flex min-h-24 items-center justify-center py-10 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
            {isLoadingMore ? <div className="flex items-center gap-2 text-[var(--ink)]"><Loader2 className="animate-spin" size={18} /><span>Loading more products...</span></div> : hasNextPage ? <span>Scroll down for more items</span> : displayedProducts.length > 0 ? <span className="w-full border-t border-[var(--line)] pt-4 text-center text-gray-400">Showing all {totalCount} products · End of category</span> : null}
          </div>
      </div>
    </div>
  );
};

export default Collection;
