import { prisma } from "../config/db.js";

// Add Category
const addCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.json({ success: false, message: "Category name is required" });
    }

    const trimmedName = name.trim();
    const exists = await prisma.category.findFirst({
      where: { name: trimmedName },
    });

    if (exists) {
      return res.json({ success: false, message: "Category already exists" });
    }

    const category = await prisma.category.create({
      data: { name: trimmedName },
    });

    res.json({ success: true, message: "Category Added", category });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// List Categories (Seed defaults if empty)
const listCategories = async (req, res) => {
  try {
    let categories = await prisma.category.findMany({});
    
    // Seed defaults if empty so initial app state is populated
    if (categories.length === 0) {
      const defaults = ["Men", "Women", "Kids"];
      for (const def of defaults) {
        await prisma.category.create({ data: { name: def } }).catch(() => {});
      }
      categories = await prisma.category.findMany({});
    }

    res.json({ success: true, categories });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const listCollectionNavigation = async (req, res) => {
  try {
    const [categories, products] = await Promise.all([
      prisma.category.findMany({ orderBy: { name: "asc" } }),
      prisma.product.findMany({
        where: { published: true },
        select: { category: true, subCategory: true, newInStore: true },
      }),
    ]);

    const groups = new Map();

    products.forEach((product) => {
      let productCategories = [];
      try {
        productCategories = Array.isArray(product.category)
          ? product.category
          : JSON.parse(product.category || "[]");
      } catch {
        productCategories = String(product.category || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      }

      productCategories.forEach((category) => {
        if (!groups.has(category)) {
          groups.set(category, { subcategories: new Set(), newArrivalCount: 0 });
        }
        const group = groups.get(category);
        if (product.subCategory) group.subcategories.add(product.subCategory);
        if (product.newInStore) group.newArrivalCount += 1;
      });
    });

    res.json({
      success: true,
      navigation: [...groups.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([name, group]) => ({
        name,
        subcategories: [...group.subcategories].sort((a, b) => a.localeCompare(b)),
        newArrivalCount: group.newArrivalCount,
      })),
    });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Remove Category
const removeCategory = async (req, res) => {
  try {
    const { id } = req.body;
    await prisma.category.delete({
      where: { id },
    });
    res.json({ success: true, message: "Category Removed" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addCategory, listCategories, listCollectionNavigation, removeCategory };
