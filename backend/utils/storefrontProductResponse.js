const toImageArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeCategories = (value) => {
  if (Array.isArray(value)) return value.map((category) => String(category).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((category) => String(category).trim()).filter(Boolean);
    } catch {
      return trimmed.split(",").map((category) => category.trim()).filter(Boolean);
    }
  }
  return trimmed.split(",").map((category) => category.trim()).filter(Boolean);
};

export const toStorefrontProduct = (product, { rating = 0, reviewCount = 0 } = {}) => ({
  _id: product.id,
  name: product.name,
  nepaliName: product.nepaliName || "",
  description: product.description,
  price: Number(product.price),
  image: toImageArray(product.image),
  category: normalizeCategories(product.category).join(", "),
  subCategory: product.subCategory,
  sizes: product.sizes,
  colors: product.colors,
  colorImages: product.colorImages,
  variants: product.variants,
  bestseller: Boolean(product.bestseller),
  newInStore: Boolean(product.newInStore),
  isUnisex: Boolean(product.isUnisex),
  discount: Number(product.discount || 0),
  stockQuantity: Number(product.stockQuantity || 0),
  date: Number(product.date),
  rating,
  reviewCount,
});
