import { useContext, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import { getSharedComboBundleVariants } from "../utils/comboBundleVariants";

const ComboBundle = () => {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const { backendUrl, navigate, token } = useContext(ShopContext);
  const [comboBundle, setComboBundle] = useState(null);
  const [size, setSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const categoryId = searchParams.get("categoryId") || "";
  const categoryName = searchParams.get("category") || "";

  useEffect(() => {
    let cancelled = false;
    const loadBundle = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(
          `${backendUrl}/api/combo-bundles/${encodeURIComponent(slug)}`,
          { params: { categoryId: categoryId || undefined, status: "ACTIVE" } }
        );
        if (!response.data.success || !response.data.comboBundle) {
          throw new Error(response.data.message || "Combo bundle not found.");
        }
        const loadedBundle = response.data.comboBundle;
        const variants = getSharedComboBundleVariants(
          (loadedBundle.products || []).map((entry) => entry.product).filter(Boolean),
          1
        );
        if (!cancelled) {
          setComboBundle(loadedBundle);
          setSize(variants[0]?.size || "");
          setQuantity(1);
        }
      } catch (loadError) {
        if (!cancelled) {
          setComboBundle(null);
          setError(loadError.response?.data?.message || loadError.message || "Unable to load this combo bundle.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadBundle();
    return () => { cancelled = true; };
  }, [backendUrl, slug, categoryId]);

  const products = (comboBundle?.products || []).map((entry) => entry.product).filter(Boolean);
  const variants = getSharedComboBundleVariants(products, 1);
  const sizes = [...new Set(variants.map((variant) => variant.size))];
  const selectedVariant = variants.find(
    (variant) => variant.size.toLowerCase() === size.toLowerCase()
  );
  const maxQuantity = selectedVariant?.availableQuantity || 0;
  const unitPrice = Number(comboBundle?.sellingPrice || comboBundle?.calculatedPrice || 0);
  const calculatedPrice = Number(comboBundle?.calculatedPrice || 0);
  const gallery = Array.isArray(comboBundle?.image) ? comboBundle.image : [];
  const heroImage = comboBundle?.bannerImage || gallery[0] || "";
  const categoryLabel = comboBundle?.category?.name || categoryName;

  const handleCheckout = () => {
    if (!comboBundle || !selectedVariant || quantity > maxQuantity) return;
    const purchase = {
      comboBundleId: comboBundle.id,
      categoryId: comboBundle.categoryId,
      size,
      quantity,
    };
    sessionStorage.setItem("pendingComboBundlePurchase", JSON.stringify(purchase));
    if (!token) {
      navigate("/login", { state: { from: "/place-order" } });
      return;
    }
    navigate("/place-order", { state: { comboBundlePurchase: purchase } });
  };

  if (loading) {
    return <div className="flex min-h-[55vh] items-center justify-center text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"><Loader2 size={18} className="mr-2 animate-spin" />Loading combo bundle</div>;
  }

  if (!comboBundle) {
    return <main className="mx-auto max-w-3xl px-5 py-24 text-center"><h1 className="text-2xl font-black uppercase">Combo bundle unavailable</h1><p className="mt-3 text-sm text-[var(--muted)]">{error}</p><Link to={`/combo-bundles?category=${encodeURIComponent(categoryName)}&categoryId=${encodeURIComponent(categoryId)}`} className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase underline underline-offset-4"><ArrowLeft size={15} />Browse combo bundles</Link></main>;
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] pb-16">
      <div className="px-4 pt-4 sm:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-[var(--line)] pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          <Link to="/" className="hover:text-[var(--ink)]">Home</Link><span>/</span>
          <Link to={`/combo-bundles?category=${encodeURIComponent(categoryLabel)}&categoryId=${encodeURIComponent(comboBundle.categoryId)}`} className="hover:text-[var(--ink)]">{categoryLabel}</Link><span>/</span>
          <span className="font-bold text-[var(--ink)]">{comboBundle.name}</span>
        </nav>
      </div>

      <section className="grid gap-7 px-4 pt-6 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:gap-10 lg:pt-9">
        <div>
          <div className="relative aspect-[4/4.3] overflow-hidden bg-[var(--stone)] sm:aspect-[4/4.5]">
            {heroImage && <img src={heroImage} alt={comboBundle.name} className="h-full w-full object-cover" />}
            {comboBundle.discountPercentage > 0 && <span className="absolute left-4 top-4 bg-[var(--accent)] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white">{comboBundle.discountPercentage}% off bundle</span>}
          </div>
          {gallery.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {gallery.slice(heroImage === comboBundle.bannerImage ? 0 : 1).map((image, index) => <img key={`${image}-${index}`} src={image} alt={`${comboBundle.name} view ${index + 1}`} loading="lazy" className="aspect-[4/5] w-full object-cover" />)}
            </div>
          )}
        </div>

        <div className="md:sticky md:top-8 md:self-start">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{categoryLabel} · Combo bundle</p>
          <h1 className="mt-2 text-3xl font-black uppercase leading-tight text-[var(--ink)] sm:text-4xl">{comboBundle.name}</h1>
          {comboBundle.description && <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">{comboBundle.description}</p>}
          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-2xl font-black text-[var(--ink)]">Rs. {unitPrice.toLocaleString()}</span>
            {calculatedPrice > unitPrice && <span className="text-sm text-[var(--muted)] line-through">Rs. {calculatedPrice.toLocaleString()}</span>}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">One of each included item · {products.length} pieces per bundle</p>

          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink)]">Size <span className="font-normal text-[var(--muted)]">{size}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sizes.map((choice) => <button key={choice} type="button" aria-pressed={choice === size} onClick={() => { setSize(choice); setQuantity(1); }} className={`min-w-12 border px-3 py-2 text-xs font-semibold ${choice === size ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)]"}`}>{choice}</button>)}
            </div>
          </div>

          {selectedVariant ? (
            <div className="mt-4 space-y-1 text-[11px]">
              <p className="font-medium text-emerald-700">{maxQuantity} complete bundle{maxQuantity === 1 ? "" : "s"} available in this size</p>
              {products.map((product, index) => (
                <p key={product.id || product._id} className="text-[var(--muted)]">{product.name} · {selectedVariant.productVariants[index]?.color}</p>
              ))}
            </div>
          ) : <p className="mt-4 text-[11px] font-semibold text-rose-700">No complete in-stock size is currently available.</p>}

          <div className="mt-5 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--ink)]">Bundles</span>
            <div className="inline-flex h-10 items-center border border-[var(--line)] bg-white">
              <button type="button" aria-label="Decrease bundle quantity" disabled={quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))} className="grid h-10 w-10 place-items-center disabled:opacity-40"><Minus size={14} /></button>
              <span className="w-8 text-center text-sm font-bold">{quantity}</span>
              <button type="button" aria-label="Increase bundle quantity" disabled={!selectedVariant || quantity >= maxQuantity} onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))} className="grid h-10 w-10 place-items-center disabled:opacity-40"><Plus size={14} /></button>
            </div>
          </div>

          <button type="button" disabled={!selectedVariant || !size || quantity > maxQuantity} onClick={handleCheckout} className="mt-6 w-full bg-[var(--ink)] px-5 py-4 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"><ShoppingBag size={16} className="mr-2 inline" />Proceed to checkout · Rs. {(unitPrice * quantity).toLocaleString()}</button>
        </div>
      </section>

      <section className="px-4 pt-12 sm:px-8">
        <div className="mb-5 flex items-end justify-between border-b border-[var(--line)] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Included products</p><h2 className="mt-1 text-lg font-black uppercase text-[var(--ink)]">{products.length} pieces in this bundle</h2></div><p className="text-[11px] text-[var(--muted)]">Sold together as one item</p></div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product, index) => (
            <article key={product.id || product._id} className="min-w-0 rounded-2xl border border-[var(--line)] bg-white p-2">
              <div className="aspect-[4/5] overflow-hidden bg-[var(--stone)]">
                <img src={Array.isArray(product.image) ? product.image[0] : product.image} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <h3 className="mt-2 text-xs font-bold uppercase text-[var(--ink)]">{product.name}</h3>
              <p className="mt-1 text-[10px] text-[var(--muted)]">{selectedVariant?.productVariants[index]?.color || "Included in bundle"}</p>
              <div className="mt-3 flex gap-2">
                <Link to={`/product/${product._id || product.id}`} className="flex-1 rounded-lg border border-[var(--line)] px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-[var(--stone)]">View</Link>
                <Link to={`/product/${product._id || product.id}`} className="flex-1 rounded-lg bg-[var(--ink)] px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white hover:bg-[var(--accent)]">Buy</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};

export default ComboBundle;
