import { prisma } from "../config/db.js";
import { v2 as cloudinary } from "cloudinary";

// Add SubCategory / Type
const addSubCategory = async (req, res) => {
  try {
    const { name, description, categoryId } = req.body;
    if (!name || !name.trim()) {
      return res.json({ success: false, message: "Type/SubCategory name is required" });
    }

    const trimmedName = name.trim();
    const exists = await prisma.subCategory.findFirst({
      where: { name: trimmedName, categoryId: categoryId || null },
    });

    if (exists) {
      return res.json({ success: false, message: "Type/SubCategory already exists" });
    }

    let image = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { resource_type: "image" });
      image = result.secure_url;
    }

    const subCategory = await prisma.subCategory.create({
      data: {
        name: trimmedName,
        description: description?.trim() || null,
        image,
        categoryId: categoryId || null,
      },
    });

    res.json({ success: true, message: "Type/SubCategory Added", subCategory });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// List SubCategories / Types (Seed defaults if empty)
const listSubCategories = async (req, res) => {
  try {
    let subCategories = await prisma.subCategory.findMany({
      include: { category: true },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });

    // Seed defaults if empty so initial app state is populated
    if (subCategories.length === 0) {
      const defaults = ["Topwear", "Bottomwear", "Winterwear"];
      for (const def of defaults) {
        await prisma.subCategory.create({ data: { name: def } }).catch(() => { });
      }
      subCategories = await prisma.subCategory.findMany({
        include: { category: true },
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      });
    }

    // Gather product and bestseller statistics per subcategory
    const allProducts = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        subCategory: true,
        bestseller: true,
      },
    });

    const enriched = subCategories.map((sub) => {
      const subNameLower = sub.name.toLowerCase();
      const parentCatNameLower = sub.category?.name?.toLowerCase();

      const matchingProducts = allProducts.filter((p) => {
        const matchesSub = (p.subCategory || "").toLowerCase() === subNameLower;
        if (!parentCatNameLower) return matchesSub;
        const pCats = String(p.category || "").toLowerCase();
        return matchesSub && pCats.includes(parentCatNameLower);
      });

      const bestsellerCount = matchingProducts.filter((p) => p.bestseller).length;

      return {
        ...sub,
        productCount: matchingProducts.length,
        bestsellerCount,
      };
    });

    res.json({ success: true, subCategories: enriched });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};


// Update SubCategory
const updateSubCategory = async (req, res) => {
  try {
    const { id, name, description, categoryId, removeImage } = req.body;
    if (!id) {
      return res.json({ success: false, message: "SubCategory ID is required" });
    }

    const existing = await prisma.subCategory.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.json({ success: false, message: "SubCategory not found" });
    }

    const trimmedName = name ? name.trim() : existing.name;
    const targetCategoryId = categoryId !== undefined ? (categoryId || null) : existing.categoryId;

    if (name || categoryId !== undefined) {
      const duplicate = await prisma.subCategory.findFirst({
        where: {
          name: trimmedName,
          categoryId: targetCategoryId,
          NOT: { id },
        },
      });
      if (duplicate) {
        return res.json({ success: false, message: "A subcategory with this name and parent category already exists" });
      }
    }

    let image = existing.image;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { resource_type: "image" });
      image = result.secure_url;
    } else if (removeImage === "true" || removeImage === true) {
      image = null;
    }

    const updated = await prisma.subCategory.update({
      where: { id },
      data: {
        name: trimmedName,
        description: description !== undefined ? (description?.trim() || null) : existing.description,
        categoryId: targetCategoryId,
        image,
      },
      include: { category: true },
    });

    res.json({ success: true, message: "SubCategory Updated", subCategory: updated });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Remove SubCategory / Type
const removeSubCategory = async (req, res) => {
  try {
    const { id } = req.body;
    await prisma.subCategory.delete({
      where: { id },
    });
    res.json({ success: true, message: "Type/SubCategory Removed" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addSubCategory, updateSubCategory, listSubCategories, removeSubCategory };

