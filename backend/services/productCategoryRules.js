export const parseProductCategoryNames = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim()).filter(Boolean);
  } catch {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
};

export const productBelongsToCategory = (product, categoryName) =>
  parseProductCategoryNames(product?.category).some(
    (name) => name.toLowerCase() === String(categoryName || "").trim().toLowerCase()
  );
