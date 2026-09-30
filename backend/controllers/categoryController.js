import { prisma } from "../config/db.js";
import { parseProductCategoryNames } from "../services/productCategoryRules.js";

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

const listCategoryNavigation = async (req, res) => {
  try {
    const [categories, products] = await Promise.all([
      prisma.category.findMany({
        orderBy: { name: "asc" },
        include: {
          comboBundles: {
            where: { status: "ACTIVE" },
            orderBy: { name: "asc" },
            select: { id: true, name: true, slug: true, image: true, bannerImage: true },
          },
        },
      }),
      prisma.product.findMany({
        where: { published: true },
        select: { category: true, subCategory: true },
      }),
    ]);

    const navigation = categories.map((category) => {
      const categoryProducts = products.filter((product) =>
        parseProductCategoryNames(product.category).some(
          (name) => name.toLowerCase() === category.name.trim().toLowerCase()
        )
      );
      return {
        id: category.id,
        name: category.name,
        productCount: categoryProducts.length,
        subcategories: [...new Set(categoryProducts.map((product) => product.subCategory).filter(Boolean))]
          .sort((first, second) => first.localeCompare(second)),
        comboBundles: category.comboBundles,
      };
    }).filter((category) => category.productCount > 0 || category.comboBundles.length > 0);

    res.json({
      success: true,
      navigation,
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

export { addCategory, listCategories, listCategoryNavigation, removeCategory };
