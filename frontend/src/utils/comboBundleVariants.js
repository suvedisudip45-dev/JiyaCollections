export const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getSharedComboBundleVariants = (products = [], requestedQuantity = 1) => {
  if (!products.length) return [];
  const requiredQuantity = Math.max(1, Number(requestedQuantity) || 1);
  const variantMaps = products.map((product) => {
    const variants = parseJsonArray(product.variants);
    const options = new Map();
    const assignedColor = String(product.comboBundleColor || "").trim().toLowerCase();
    if (variants.length > 0) {
      variants.forEach((variant) => {
        const size = String(variant.size || "").trim();
        const color = String(variant.color || "").trim();
        const availableQuantity = Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0));
        if (!size || !color || availableQuantity < requiredQuantity) return;
        if (assignedColor && color.toLowerCase() !== assignedColor) return;
        const key = size.toLowerCase();
        const colors = options.get(key) || new Map();
        const colorKey = color.toLowerCase();
        const existing = colors.get(colorKey);
        colors.set(colorKey, {
          size: existing?.size || size,
          color: existing?.color || color,
          availableQuantity: (existing?.availableQuantity || 0) + availableQuantity,
        });
        options.set(key, colors);
      });
    } else {
      const sizes = parseJsonArray(product.sizes).map((entry) => String(entry?.name || entry).trim()).filter(Boolean);
      const colors = parseJsonArray(product.colors).map((entry) => String(entry?.name || entry).trim()).filter(Boolean);
      const stock = Math.max(0, Number(product.stockQuantity || 0) - Number(product.reservedQty || 0));
      if (!stock) return options;
      sizes.forEach((size) => {
        const availableColors = assignedColor ? colors.filter((color) => color.toLowerCase() === assignedColor) : colors;
        options.set(size.toLowerCase(), new Map(availableColors.map((color) => [color.toLowerCase(), { size, color, availableQuantity: stock }])));
      });
    }
    return options;
  });

  return [...variantMaps[0].keys()]
    .filter((sizeKey) => variantMaps.every((variants) => {
      const colors = variants.get(sizeKey);
      return colors && [...colors.values()].some((option) => option.availableQuantity >= requiredQuantity);
    }))
    .map((sizeKey) => {
      const productVariants = variantMaps.map((variants) => [...variants.get(sizeKey).values()]
        .filter((option) => option.availableQuantity >= requiredQuantity)
        .sort((first, second) => second.availableQuantity - first.availableQuantity || first.color.localeCompare(second.color))[0]);
      return {
        size: productVariants[0].size,
        availableQuantity: Math.min(...productVariants.map((variant) => variant.availableQuantity)),
        productVariants,
      };
    })
    .filter((option) => option.availableQuantity >= requiredQuantity)
    .sort((first, second) => first.size.localeCompare(second.size));
};

export const getColorSwatch = (color) => {
  const swatches = {
    black: "#171717",
    white: "#ffffff",
    blue: "#2563eb",
    navy: "#1e3a8a",
    red: "#dc2626",
    green: "#16a34a",
    grey: "#6b7280",
    gray: "#6b7280",
    olive: "#556b2f",
    brown: "#78350f",
    pink: "#ec4899",
    beige: "#d8c6b0",
    cream: "#fffdd0",
  };
  return swatches[String(color || "").trim().toLowerCase()] || "#d6d3d1";
};
