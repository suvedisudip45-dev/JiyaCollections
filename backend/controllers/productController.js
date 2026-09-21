import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../config/db.js";
import { syncProductStock, syncAllProductsStock } from "../services/stockSyncService.js";

// Helper: safely convert Prisma JSON field to plain array
const toImageArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  // Prisma sometimes wraps JSON as a special object
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
};

// Helper: normalize category input into a clean string array
const normalizeCategories = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
      } catch {}
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

// Helper: extract file by fieldname from req.files (array from upload.any() or fields object)
const getFileByFieldname = (files, fieldname) => {
  if (!files) return null;
  if (Array.isArray(files)) {
    return files.find((f) => f.fieldname === fieldname) || null;
  }
  if (files[fieldname]) {
    return Array.isArray(files[fieldname]) ? files[fieldname][0] : files[fieldname];
  }
  return null;
};

// function for add product
const addProduct = async (req, res) => {
  try {
    const {
      name,
      nepaliName,
      nameNepali,
      description,
      price,
      category,
      subCategory,
      sizes,
      bestseller,
      newInStore,
      discount,
      costPrice,
      stockQuantity,
      lowStockThreshold,
      colors,
      variants,
      published,
      featuredType, // 'variant' | 'gallery'
      featuredIndex, // number index
    } = req.body;

    let parsedVariants = typeof variants === "string" ? JSON.parse(variants || "[]") : variants || [];
    if (!Array.isArray(parsedVariants)) parsedVariants = [];

    // 1. Upload gallery images (image1, image2, image3, image4, etc.)
    const galleryFiles = [];
    for (let i = 1; i <= 8; i++) {
      const f = getFileByFieldname(req.files, `image${i}`);
      if (f) galleryFiles.push(f);
    }

    const galleryUrls = await Promise.all(
      galleryFiles.map(async (file) => {
        const result = await cloudinary.uploader.upload(file.path, {
          resource_type: "image",
        });
        return result.secure_url;
      })
    );

    // 2. Upload variety-specific images (variantImage_0, variantImage_1, etc.)
    for (let i = 0; i < parsedVariants.length; i++) {
      const vFile =
        getFileByFieldname(req.files, `variantImage_${i}`) ||
        getFileByFieldname(req.files, `variant_image_${i}`);

      if (vFile) {
        const result = await cloudinary.uploader.upload(vFile.path, {
          resource_type: "image",
        });
        parsedVariants[i].image = result.secure_url;
      }
    }

    // 3. Assemble and order the full image gallery, ensuring Featured Image is at index 0
    let featuredUrl = "";
    const featIdx = featuredIndex !== undefined && featuredIndex !== null ? parseInt(featuredIndex, 10) : -1;

    if (featuredType === "variant" && featIdx >= 0 && featIdx < parsedVariants.length) {
      featuredUrl = parsedVariants[featIdx]?.image || "";
      parsedVariants = parsedVariants.map((v, idx) => ({
        ...v,
        isFeatured: idx === featIdx,
      }));
    } else if (featuredType === "gallery" && featIdx >= 0 && featIdx < galleryUrls.length) {
      featuredUrl = galleryUrls[featIdx] || "";
      parsedVariants = parsedVariants.map((v) => ({ ...v, isFeatured: false }));
    } else {
      // Check if any variant has isFeatured = true
      const featVar = parsedVariants.find((v) => v.isFeatured && v.image);
      if (featVar) {
        featuredUrl = featVar.image;
      } else if (galleryUrls.length > 0) {
        featuredUrl = galleryUrls[0];
      } else if (parsedVariants.length > 0 && parsedVariants[0].image) {
        featuredUrl = parsedVariants[0].image;
        parsedVariants[0].isFeatured = true;
      }
    }

    // Combine all distinct image URLs
    const allImages = [];
    if (featuredUrl) allImages.push(featuredUrl);

    // Add remaining gallery URLs
    galleryUrls.forEach((u) => {
      if (u && !allImages.includes(u)) allImages.push(u);
    });

    // Add remaining variant image URLs
    parsedVariants.forEach((v) => {
      if (v.image && !allImages.includes(v.image)) {
        allImages.push(v.image);
      }
    });

    let qty = stockQuantity !== undefined && stockQuantity !== "" ? parseInt(stockQuantity, 10) : 0;
    if (parsedVariants.length > 0) {
      qty = parsedVariants.reduce((sum, v) => sum + Math.max(0, parseInt(v.quantity || 0, 10)), 0);
    }
    const categoriesArray = normalizeCategories(category);
    const isNewInStore = newInStore === "true" || newInStore === true;

    // If marked as new in store, ensure all existing products have newInStore = false
    if (isNewInStore) {
      await prisma.product.updateMany({
        data: { newInStore: false },
      });
    }

    const resolvedNepaliName = (nepaliName || nameNepali || name || "").trim();

    const productData = {
      name,
      nepaliName: resolvedNepaliName,
      description,
      price: Number(price),
      category: JSON.stringify(categoriesArray),
      subCategory,
      sizes: typeof sizes === "string" ? JSON.parse(sizes) : sizes,
      image: allImages,
      bestseller: bestseller === "true" || bestseller === true ? true : false,
      newInStore: isNewInStore,
      discount: discount ? Number(discount) : 0,
      costPrice: costPrice !== undefined && costPrice !== null && costPrice !== "" ? Number(costPrice) : 0,
      stockQuantity: qty,
      lowStockThreshold: lowStockThreshold !== undefined ? parseInt(lowStockThreshold, 10) : 5,
      colors: typeof colors === "string" ? JSON.parse(colors) : colors || [],
      variants: parsedVariants,
      published: published === "false" || published === false ? false : true,
      date: BigInt(Date.now()),
    };

    const newProduct = await prisma.product.create({ data: productData });

    // Log initial stock
    if (qty > 0) {
      await prisma.stockLog.create({
        data: {
          productId: newProduct.id,
          productName: name,
          previousQty: 0,
          newQty: qty,
          changeQty: qty,
          reason: "INITIAL_STOCK",
          note: "Stock set during product creation",
          source: "admin",
        },
      });
    }

    res.json({ success: true, message: "Product Added with Varieties" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// function for updating product details & images
const updateProduct = async (req, res) => {
  try {
    const {
      id,
      name,
      nepaliName,
      nameNepali,
      description,
      price,
      category,
      subCategory,
      sizes,
      bestseller,
      newInStore,
      discount,
      costPrice,
      stockQuantity,
      lowStockThreshold,
      colors,
      variants,
      published,
      featuredType,
      featuredIndex,
      existingImages,
    } = req.body;

    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.json({ success: false, message: "Product not found" });
    }

    let parsedVariants = typeof variants === "string" ? JSON.parse(variants || "[]") : variants || [];
    if (!Array.isArray(parsedVariants)) parsedVariants = [];

    // Parse existing images array
    let currentImages = existingImages
      ? (typeof existingImages === "string" ? JSON.parse(existingImages) : existingImages)
      : toImageArray(existingProduct.image);

    // 1. Upload new gallery images if provided
    const newGalleryFiles = [];
    for (let i = 1; i <= 8; i++) {
      const f = getFileByFieldname(req.files, `image${i}`);
      if (f) newGalleryFiles.push(f);
    }

    let newGalleryUrls = [];
    if (newGalleryFiles.length > 0) {
      newGalleryUrls = await Promise.all(
        newGalleryFiles.map(async (file) => {
          const result = await cloudinary.uploader.upload(file.path, {
            resource_type: "image",
          });
          return result.secure_url;
        })
      );
    }

    // 2. Upload variety-specific images if uploaded
    for (let i = 0; i < parsedVariants.length; i++) {
      const vFile =
        getFileByFieldname(req.files, `variantImage_${i}`) ||
        getFileByFieldname(req.files, `variant_image_${i}`);

      if (vFile) {
        const result = await cloudinary.uploader.upload(vFile.path, {
          resource_type: "image",
        });
        parsedVariants[i].image = result.secure_url;
      }
    }

    // 3. Determine Featured Image
    const featIdx = featuredIndex !== undefined && featuredIndex !== null ? parseInt(featuredIndex, 10) : -1;
    let featuredUrl = "";

    if (featuredType === "variant" && featIdx >= 0 && featIdx < parsedVariants.length) {
      featuredUrl = parsedVariants[featIdx]?.image || "";
      parsedVariants = parsedVariants.map((v, idx) => ({
        ...v,
        isFeatured: idx === featIdx,
      }));
    } else if (featuredType === "gallery") {
      const combinedGallery = [...newGalleryUrls, ...currentImages];
      if (featIdx >= 0 && featIdx < combinedGallery.length) {
        featuredUrl = combinedGallery[featIdx] || "";
      }
      parsedVariants = parsedVariants.map((v) => ({ ...v, isFeatured: false }));
    } else {
      const featVar = parsedVariants.find((v) => v.isFeatured && v.image);
      if (featVar) {
        featuredUrl = featVar.image;
      } else if (newGalleryUrls.length > 0) {
        featuredUrl = newGalleryUrls[0];
      } else if (currentImages.length > 0) {
        featuredUrl = currentImages[0];
      } else if (parsedVariants.length > 0 && parsedVariants[0].image) {
        featuredUrl = parsedVariants[0].image;
        parsedVariants[0].isFeatured = true;
      }
    }

    // Combine all images cleanly
    const allImages = [];
    if (featuredUrl) allImages.push(featuredUrl);

    newGalleryUrls.forEach((u) => {
      if (u && !allImages.includes(u)) allImages.push(u);
    });

    currentImages.forEach((u) => {
      if (u && !allImages.includes(u)) allImages.push(u);
    });

    parsedVariants.forEach((v) => {
      if (v.image && !allImages.includes(v.image)) {
        allImages.push(v.image);
      }
    });

    // Determine stock quantity
    let newQty = existingProduct.stockQuantity;
    if (stockQuantity !== undefined && stockQuantity !== "") {
      newQty = parseInt(stockQuantity, 10);
    }
    if (parsedVariants.length > 0) {
      newQty = parsedVariants.reduce((sum, v) => sum + Math.max(0, parseInt(v.quantity || 0, 10)), 0);
    }

    const categoryStorage =
      category !== undefined ? JSON.stringify(normalizeCategories(category)) : undefined;

    let isNewInStore = undefined;
    if (newInStore !== undefined) {
      isNewInStore = newInStore === "true" || newInStore === true;
      if (isNewInStore) {
        await prisma.product.updateMany({
          where: { id: { not: id } },
          data: { newInStore: false },
        });
      }
    }

    const resolvedNepaliName = (nepaliName || nameNepali || existingProduct.nepaliName || name || "").trim();

    const updateData = {
      ...(name && { name }),
      ...(resolvedNepaliName || existingProduct.nepaliName ? { nepaliName: resolvedNepaliName || existingProduct.nepaliName || "" } : {}),
      ...(description && { description }),
      ...(price !== undefined && { price: Number(price) }),
      ...(categoryStorage !== undefined && { category: categoryStorage }),
      ...(subCategory && { subCategory }),
      ...(sizes && { sizes: typeof sizes === "string" ? JSON.parse(sizes) : sizes }),
      image: allImages,
      ...(bestseller !== undefined && { bestseller: bestseller === "true" || bestseller === true }),
      ...(isNewInStore !== undefined && { newInStore: isNewInStore }),
      ...(discount !== undefined && { discount: Number(discount) }),
      ...(costPrice !== undefined && { costPrice: Number(costPrice) }),
      stockQuantity: newQty,
      ...(lowStockThreshold !== undefined && { lowStockThreshold: parseInt(lowStockThreshold, 10) }),
      ...(colors !== undefined && { colors: typeof colors === "string" ? JSON.parse(colors) : colors }),
      variants: parsedVariants,
      ...(published !== undefined && { published: published === "true" || published === true }),
    };

    await prisma.product.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, message: "Product and Varieties Updated Successfully" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// function to toggle product published/unpublished status
const togglePublish = async (req, res) => {
  try {
    const { id } = req.body;
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.json({ success: false, message: "Product not found" });
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: { published: !existingProduct.published },
    });

    const statusText = updatedProduct.published ? "Published" : "Unpublished";
    res.json({ success: true, message: `Product is now ${statusText}`, published: updatedProduct.published });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// function for list products
const listProducts = async (req, res) => {
  try {
    const isAdmin = req.headers.token || req.query.admin === "true";

    // Synchronize current stockQuantity & variant stock from ManufacturerInventory
    await syncAllProductsStock();

    // Admin sees all products; Public customers see only published products
    const whereCondition = isAdmin ? {} : { published: true };

    const [rawProducts, allReviews] = await Promise.all([
      prisma.product.findMany({
        where: whereCondition,
        orderBy: { date: "desc" },
      }),
      prisma.review.findMany({
        select: { productId: true, rating: true },
      }),
    ]);

    // Build rating lookup map per product
    const reviewStatsMap = {};
    for (const r of allReviews) {
      if (!reviewStatsMap[r.productId]) {
        reviewStatsMap[r.productId] = { sum: 0, count: 0 };
      }
      reviewStatsMap[r.productId].sum += Number(r.rating) || 5;
      reviewStatsMap[r.productId].count += 1;
    }

    const products = rawProducts.map((item) => {
      const cats = normalizeCategories(item.category);
      const rStats = reviewStatsMap[item.id] || { sum: 0, count: 0 };
      const avgRating = rStats.count > 0 ? Number((rStats.sum / rStats.count).toFixed(1)) : 0;

      return {
        ...item,
        _id: item.id,
        date: Number(item.date),
        image: toImageArray(item.image),
        categories: cats,
        category: cats.join(", "),
        newInStore: Boolean(item.newInStore),
        costPrice: Number(item.costPrice || 0),
        lowStockThreshold: item.lowStockThreshold || 5,
        rating: avgRating,
        reviewCount: rStats.count,
      };
    });

    res.json({ success: true, products });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// function for removing product
const removeProduct = async (req, res) => {
  try {
    const { id } = req.body;
    await prisma.product.delete({
      where: { id: id },
    });
    res.json({ success: true, message: "Product Removed" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// function for single product info
const singleProduct = async (req, res) => {
  try {
    const { productId } = req.body;
    
    // Sync stock from manufacturer inventory first
    await syncProductStock(productId);

    const rawProduct = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!rawProduct) {
      return res.json({ success: false, message: "Product not found" });
    }

    // Get review stats
    const productReviews = await prisma.review.findMany({
      where: { productId },
      select: { rating: true },
    });
    let ratingSum = 0;
    for (const r of productReviews) {
      ratingSum += Number(r.rating) || 5;
    }
    const avgRating = productReviews.length > 0 ? Number((ratingSum / productReviews.length).toFixed(1)) : 0;

    const cats = normalizeCategories(rawProduct.category);
    const product = {
      ...rawProduct,
      _id: rawProduct.id,
      date: Number(rawProduct.date),
      image: toImageArray(rawProduct.image),
      categories: cats,
      category: cats.join(", "),
      newInStore: Boolean(rawProduct.newInStore),
      costPrice: Number(rawProduct.costPrice || 0),
      lowStockThreshold: rawProduct.lowStockThreshold || 5,
      rating: avgRating,
      reviewCount: productReviews.length,
    };
    res.json({ success: true, product });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Adjust stock for a product (restock, manual correction, return)
const adjustStock = async (req, res) => {
  try {
    const { productId, adjustments, reason, note, source } = req.body;

    if (!productId || !adjustments || !reason) {
      return res.json({ success: false, message: "productId, adjustments, and reason are required" });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    let parsedVariants = typeof product.variants === "string"
      ? JSON.parse(product.variants || "[]")
      : (product.variants || []);
    const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;

    const stockLogs = [];

    if (hasVariants && adjustments.length > 0 && adjustments[0].size) {
      // Variant-level adjustments
      for (const adj of adjustments) {
        const vIdx = parsedVariants.findIndex(
          (v) => v.size === adj.size && v.color === adj.color
        );
        if (vIdx !== -1) {
          const previousQty = Number(parsedVariants[vIdx].quantity || 0);
          const changeQty = Number(adj.quantity || 0);
          const newQty = Math.max(0, previousQty + changeQty);
          parsedVariants[vIdx].quantity = newQty;

          stockLogs.push({
            productId,
            productName: product.name,
            variantLabel: `${adj.size} / ${adj.color}`,
            previousQty,
            newQty,
            changeQty,
            reason,
            note: note || null,
            source: source || "admin",
          });
        }
      }

      // Sync total stockQuantity from variants
      const totalVariantStock = parsedVariants.reduce(
        (acc, v) => acc + (Number(v.quantity) || 0), 0
      );

      await prisma.product.update({
        where: { id: productId },
        data: { variants: parsedVariants, stockQuantity: totalVariantStock },
      });
    } else {
      // Simple product-level stock adjustment
      const totalChange = adjustments.reduce((sum, a) => sum + Number(a.quantity || 0), 0);
      const previousQty = product.stockQuantity || 0;
      const newQty = Math.max(0, previousQty + totalChange);

      stockLogs.push({
        productId,
        productName: product.name,
        previousQty,
        newQty,
        changeQty: totalChange,
        reason,
        note: note || null,
        source: source || "admin",
      });

      await prisma.product.update({
        where: { id: productId },
        data: { stockQuantity: newQty },
      });
    }

    // Create stock log entries
    if (stockLogs.length > 0) {
      await prisma.stockLog.createMany({ data: stockLogs });
    }

    res.json({ success: true, message: "Stock adjusted successfully" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Get stock movement logs (filterable, paginated)
const getStockLogs = async (req, res) => {
  try {
    const { productId, limit, offset } = req.query;
    const take = parseInt(limit) || 50;
    const skip = parseInt(offset) || 0;

    const where = productId ? { productId } : {};

    const [logs, total] = await Promise.all([
      prisma.stockLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.stockLog.count({ where }),
    ]);

    res.json({ success: true, logs, total });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export { addProduct, updateProduct, togglePublish, listProducts, removeProduct, singleProduct, adjustStock, getStockLogs };
