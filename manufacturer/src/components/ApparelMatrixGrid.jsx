import { useEffect, useMemo, useState } from "react";

const normalize = (value, fallback) => String(value || fallback).trim();

export default function ApparelMatrixGrid({
  products = [],
  title = "Color × Size matrix",
  onApply,
  applyLabel = "Apply quantities",
  initialProductId = "",
  prePackRatios = null,
  prePackCount = 1,
}) {
  const [productId, setProductId] = useState(initialProductId);
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (!productId && products.length === 1) setProductId(products[0].id);
  }, [products, productId]);

  const product = useMemo(
    () => products.find((item) => item.id === productId) || null,
    [products, productId],
  );

  const { sizes, colors, variantMap } = useMemo(() => {
    const sizes = [];
    const colors = [];
    const variantMap = new Map();
    for (const variant of product?.variants || []) {
      const size = normalize(variant.size, "One size");
      const color = normalize(variant.color, "Standard");
      if (!sizes.includes(size)) sizes.push(size);
      if (!colors.includes(color)) colors.push(color);
      variantMap.set(`${color}\u001f${size}`, variant);
    }
    return { sizes, colors, variantMap };
  }, [product]);

  const setQuantity = (color, size, value) => {
    const key = `${color}\u001f${size}`;
    const quantity = value === "" ? "" : Math.max(0, Number.parseInt(value, 10) || 0);
    setQuantities((current) => ({ ...current, [key]: quantity }));
  };

  const applyPrePack = () => {
    if (!prePackRatios || !product) return;
    const next = {};
    for (const color of colors) {
      for (const [size, perPack] of Object.entries(prePackRatios)) {
        const variant = variantMap.get(`${color}\u001f${size}`);
        if (!variant) continue;
        const quantity = Math.max(0, Number(perPack) || 0) * Math.max(1, Number(prePackCount) || 1);
        const available = Number(variant.availableQuantity ?? variant.quantity ?? 0);
        next[`${color}\u001f${size}`] = Math.min(quantity, available);
      }
    }
    setQuantities(next);
  };

  const apply = () => {
    if (!product || typeof onApply !== "function") return;
    const result = [];
    for (const [key, quantity] of Object.entries(quantities)) {
      const numericQuantity = Number(quantity);
      if (!Number.isSafeInteger(numericQuantity) || numericQuantity < 1) continue;
      const variant = variantMap.get(key);
      if (!variant) continue;
      const available = Number(
        variant.availableQuantity ?? variant.quantity ?? Number.MAX_SAFE_INTEGER,
      );
      if (numericQuantity <= available) {
        result.push({
          inventorySkuId: variant.inventorySkuId,
          productId: product.id,
          size: normalize(variant.size, "One size"),
          color: normalize(variant.color, "Standard"),
          quantity: numericQuantity,
          variant,
        });
      }
    }
    onApply(result);
  };

  return (
    <div className="space-y-3 rounded-xl border border-[#dedbd3] bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-[#171717]">{title}</h3>
          <p className="mt-1 text-[11px] text-[#575757]">Enter multiple size/color quantities in one operation.</p>
        </div>
        {products.length > 1 && (
          <select
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setQuantities({});
            }}
            className="min-w-48 rounded-lg border border-[#dedbd3] px-3 py-2 text-xs"
          >
            <option value="">Select garment</option>
            {products.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        )}
      </div>
      {product ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-[#dedbd3]">
            <table className="w-full min-w-[520px] text-center text-xs">
              <thead className="bg-[#f8f7f4]">
                <tr>
                  <th className="px-3 py-2 text-left">Color / Size</th>
                  {sizes.map((size) => <th key={size} className="px-3 py-2">{size}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eeeae2]">
                {colors.map((color) => (
                  <tr key={color}>
                    <th className="px-3 py-2 text-left font-semibold">{color}</th>
                    {sizes.map((size) => {
                      const key = `${color}\u001f${size}`;
                      const variant = variantMap.get(key);
                      const available = Number(
                        variant?.availableQuantity ?? variant?.quantity ?? 0,
                      );
                      return (
                        <td key={size} className="px-2 py-2">
                          {variant ? (
                            <div>
                              <input
                                type="number"
                                min="0"
                                max={available}
                                step="1"
                                value={quantities[key] ?? ""}
                                onChange={(event) => setQuantity(color, size, event.target.value)}
                                aria-label={`${color}, ${size} quantity`}
                                className="h-9 w-16 rounded-md border border-[#dedbd3] text-center font-bold outline-none focus:border-[#171717]"
                              />
                              <p className="mt-1 text-[9px] text-[#777]">{available} available</p>
                            </div>
                          ) : <span className="text-[#bbb]">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prePackRatios && (
            <button
              type="button"
              onClick={applyPrePack}
              className="mr-2 rounded-lg border border-[#dedbd3] bg-white px-4 py-2.5 text-xs font-bold text-[#171717]"
            >
              Apply ratio pack
            </button>
          )}
          <button
            type="button"
            onClick={apply}
            className="rounded-lg bg-[#171717] px-4 py-2.5 text-xs font-bold text-white"
          >
            {applyLabel}
          </button>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-[#dedbd3] py-6 text-center text-xs text-[#777]">
          Select a garment to show the size/color matrix.
        </p>
      )}
    </div>
  );
}
