import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../config/db.js";
import { parseProductCategoryNames, productBelongsToCategory } from "../services/productCategoryRules.js";
import { calculateComboBundlePrice } from "../services/comboBundleRules.js";
import { syncProductStock } from "../services/stockSyncService.js";

const toSlug = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "combo-bundle";
};

const normalizeStatus = (status) => {
  const normalized = String(status || "ACTIVE").trim().toUpperCase();
  return normalized === "INACTIVE" ? "INACTIVE" : "ACTIVE";
};

const parseBooleanInput = (value) => value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";

const parseProductIds = (payload) => {
  if (Array.isArray(payload)) return payload.map((entry) => String(entry?.productId || entry?.id || entry || "")).filter(Boolean);

  if (Array.isArray(payload?.products)) {
    return payload.products
      .map((entry) => String(entry?.productId || entry?.id || entry || ""))
      .filter(Boolean);
  }

  if (Array.isArray(payload?.productIds)) {
    return payload.productIds.map((entry) => String(entry?.productId || entry?.id || entry || "")).filter(Boolean);
  }

  if (typeof payload?.productIds === "string") {
    try {
      const parsed = JSON.parse(payload.productIds);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry?.productId || entry?.id || entry || "")).filter(Boolean);
    } catch {
      if (payload.productIds) return [payload.productIds];
    }
  }

  if (payload?.productId) return [String(payload.productId)];

  return [];
};

const parseProductColorMap = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseJsonList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const validateProductCategory = async (category, productIds, client = prisma) => {
  if (productIds.length === 0) return;
  const products = await client.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, category: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const missingIds = productIds.filter((productId) => !productById.has(productId));
  if (missingIds.length > 0) throw new Error(`Product not found: ${missingIds.join(", ")}`);

  const invalidProducts = products.filter((product) => !productBelongsToCategory(product, category.name));
  if (invalidProducts.length > 0) {
    throw new Error(`Products must belong to ${category.name}: ${invalidProducts.map((product) => product.name).join(", ")}`);
  }
};

const validateProductColorSelections = async (productIds, selectedColors, client = prisma) => {
  const selections = productIds
    .map((productId) => [productId, String(selectedColors[productId] || "").trim()])
    .filter(([, color]) => color);
  if (selections.length === 0) return;

  const products = await client.product.findMany({
    where: { id: { in: selections.map(([productId]) => productId) } },
    select: { id: true, name: true, variants: true, colors: true, stockQuantity: true },
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  for (const [productId, selectedColor] of selections) {
    const product = productsById.get(productId);
    const variants = parseJsonList(product?.variants);
    const normalizedColor = selectedColor.toLowerCase();
    const isAvailable = variants.length > 0
      ? variants.some((variant) => String(variant.color || "").trim().toLowerCase() === normalizedColor && Math.max(0, Number(variant.quantity || 0) - Number(variant.reservedQty || 0)) > 0)
      : Number(product?.stockQuantity || 0) > 0 && parseJsonList(product?.colors)
        .some((entry) => String(entry?.name || entry).trim().toLowerCase() === normalizedColor);
    if (!isAvailable) {
      throw new Error(`Selected color ${selectedColor} is unavailable for product ${product?.name || productId}`);
    }
  }
};

const parseImageValue = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value.filter(Boolean).map((entry) => String(entry));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((entry) => String(entry));
    } catch {
      // ignore invalid JSON and fall back to raw URL string below
    }
    return [trimmed];
  }
  return fallback;
};

const serializeComboBundleValue = (value) => {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => serializeComboBundleValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeComboBundleValue(item)])
    );
  }
  return value;
};

const normalizeComboBundleJson = (comboBundle) => {
  if (!comboBundle) return null;

  const products = Array.isArray(comboBundle.products)
    ? comboBundle.products.filter((entry) => productBelongsToCategory(entry?.product, comboBundle.category?.name)).map((entry) => {
        const product = entry?.product ? serializeComboBundleValue(entry.product) : null;
        if (product && product.date !== undefined) {
          product.date = Number(product.date);
        }
        if (product) {
          product.comboBundleColor = entry.selectedColor || "";
          product.categories = parseProductCategoryNames(product.category);
          product.category = product.categories.join(", ");
          product.image = parseImageValue(product.image);
        }
        return { ...serializeComboBundleValue(entry), product };
      })
    : [];
  const bundlePrice = products.length > 0
    ? calculateComboBundlePrice({
        products: products.map((entry) => entry.product).filter(Boolean),
        discountPercentage: comboBundle.discountPercentage,
        manualPriceOverride: comboBundle.manualPriceOverride,
        sellingPrice: comboBundle.sellingPrice,
      })
    : {
        calculatedPrice: Number(comboBundle.calculatedPrice || 0),
        sellingPrice: Number(comboBundle.sellingPrice || 0),
        discountPercentage: Number(comboBundle.discountPercentage || 0),
        manualPriceOverride: Boolean(comboBundle.manualPriceOverride),
      };

  return {
    ...serializeComboBundleValue(comboBundle),
    ...bundlePrice,
    category: comboBundle.category ? serializeComboBundleValue(comboBundle.category) : null,
    image: parseImageValue(comboBundle.image),
    bannerImage: comboBundle.bannerImage || "",
    productCount: comboBundle._count?.products ?? products.length,
    products,
    createdAt: comboBundle.createdAt ? new Date(comboBundle.createdAt).toISOString() : null,
    updatedAt: comboBundle.updatedAt ? new Date(comboBundle.updatedAt).toISOString() : null,
  };
};

const uploadImageToCloudinary = async (file) => {
  if (!file) return "";
  const result = await cloudinary.uploader.upload(file.path, { resource_type: "image" });
  return result.secure_url;
};

const syncComboBundleProducts = async (comboBundleId, category, productIds = [], selectedColors = {}) => {
  const uniqueIds = [...new Set(productIds.filter(Boolean).map((id) => String(id)))];

  await prisma.$transaction(async (tx) => {
    await validateProductCategory(category, uniqueIds, tx);
    await validateProductColorSelections(uniqueIds, selectedColors, tx);
    await tx.comboBundleProduct.deleteMany({ where: { comboBundleId } });
    if (uniqueIds.length > 0) {
      await tx.comboBundleProduct.createMany({
        data: uniqueIds.map((productId, index) => ({
          comboBundleId,
          productId,
          selectedColor: String(selectedColors[productId] || "").trim() || null,
          sortOrder: index + 1,
        })),
      });
    }
  });
};

const createComboBundle = async (req, res) => {
  try {
    const { categoryId, name, description, status, image, bannerImage, slug, color, calculatedPrice, sellingPrice, discountPercentage, manualPriceOverride, priceReviewRequired } = req.body;
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      return res.status(400).json({ success: false, message: "Combo bundle name is required" });
    }

    if (!categoryId) return res.status(400).json({ success: false, message: "Category is required" });
    const category = await prisma.category.findUnique({ where: { id: String(categoryId) } });
    if (!category) return res.status(400).json({ success: false, message: "Selected category was not found" });
    const parsedDiscountPercentage = Number(discountPercentage ?? 0);
    if (!Number.isFinite(parsedDiscountPercentage) || parsedDiscountPercentage < 0 || parsedDiscountPercentage > 100) {
      return res.status(400).json({ success: false, message: "Combo bundle discount must be between 0% and 100%" });
    }
    const useManualPrice = parseBooleanInput(manualPriceOverride);
    if (useManualPrice && (!Number.isFinite(Number(sellingPrice)) || Number(sellingPrice) <= 0)) {
      return res.status(400).json({ success: false, message: "A positive manual combo bundle price is required when price override is enabled" });
    }

    const finalSlug = toSlug(slug || cleanName);
    const existingSlug = await prisma.comboBundle.findUnique({ where: { slug: finalSlug } });
    if (existingSlug) {
      return res.status(409).json({ success: false, message: "Combo bundle slug already exists" });
    }

    const uploadedImages = Array.isArray(req.files?.images) ? req.files.images : [];
    const bannerFile = req.files?.bannerImage?.[0] || null;
    const uploadedImageUrls = await Promise.all(uploadedImages.map((file) => uploadImageToCloudinary(file)));
    const resolvedImageValue = uploadedImageUrls.length > 0
      ? uploadedImageUrls
      : parseImageValue(image);
    const resolvedBannerImage = bannerFile ? await uploadImageToCloudinary(bannerFile) : (bannerImage || "");

    const productIds = parseProductIds(req.body);
    const selectedColors = parseProductColorMap(req.body.productColors);
    await validateProductCategory(category, productIds);
    await validateProductColorSelections(productIds, selectedColors);
    const comboBundle = await prisma.comboBundle.create({
      data: {
      categoryId: category.id,
        name: cleanName,
        slug: finalSlug,
        description: description || "",
        status: normalizeStatus(status),
        color: String(color ?? "").trim(),
        image: JSON.stringify(resolvedImageValue),
        bannerImage: resolvedBannerImage || "",
        calculatedPrice: Number(calculatedPrice || 0),
        sellingPrice: Number(sellingPrice || 0),
        discountPercentage: parsedDiscountPercentage,
        manualPriceOverride: useManualPrice,
        priceReviewRequired: parseBooleanInput(priceReviewRequired),
      },
    });

    await syncComboBundleProducts(comboBundle.id, category, productIds, selectedColors);

    const savedComboBundle = await prisma.comboBundle.findUnique({
      where: { id: comboBundle.id },
      include: {
        products: {
          include: { product: true },
          orderBy: { sortOrder: "asc" },
        },
        category: true,
      },
    });

    return res.status(201).json({ success: true, message: "Combo bundle created", comboBundle: normalizeComboBundleJson(savedComboBundle) });
  } catch (error) {
    console.error("createComboBundle error:", error);
    const isValidationError = /product not found|products must belong|category|color/i.test(error.message || "");
    return res.status(isValidationError ? 400 : 500).json({ success: false, message: error.message || "Unable to create combo bundle" });
  }
};

const updateComboBundle = async (req, res) => {
  try {
    const { categoryId, name, description, status, image, bannerImage, slug, color, calculatedPrice, sellingPrice, discountPercentage, manualPriceOverride, priceReviewRequired } = req.body;
    const id = req.params.id || req.body.id;

    if (!id) {
      return res.status(400).json({ success: false, message: "Combo bundle ID is required" });
    }

    const existingComboBundle = await prisma.comboBundle.findUnique({ where: { id } });
    if (!existingComboBundle) {
      return res.status(404).json({ success: false, message: "Combo bundle not found" });
    }

    const targetCategoryId = categoryId || existingComboBundle.categoryId;
    const category = await prisma.category.findUnique({ where: { id: String(targetCategoryId) } });
    if (!category) return res.status(400).json({ success: false, message: "Selected category was not found" });
    const parsedDiscountPercentage = Number(discountPercentage ?? existingComboBundle.discountPercentage ?? 0);
    if (!Number.isFinite(parsedDiscountPercentage) || parsedDiscountPercentage < 0 || parsedDiscountPercentage > 100) {
      return res.status(400).json({ success: false, message: "Combo bundle discount must be between 0% and 100%" });
    }
    const useManualPrice = manualPriceOverride === undefined
      ? existingComboBundle.manualPriceOverride
      : parseBooleanInput(manualPriceOverride);
    const nextSellingPrice = Number(sellingPrice ?? existingComboBundle.sellingPrice);
    if (useManualPrice && (!Number.isFinite(nextSellingPrice) || nextSellingPrice <= 0)) {
      return res.status(400).json({ success: false, message: "A positive manual combo bundle price is required when price override is enabled" });
    }

    const cleanName = String(name || existingComboBundle.name).trim();
    const finalSlug = toSlug(slug || existingComboBundle.slug || cleanName);

    if (finalSlug !== existingComboBundle.slug) {
      const duplicate = await prisma.comboBundle.findUnique({ where: { slug: finalSlug } });
      if (duplicate && duplicate.id !== id) {
        return res.status(409).json({ success: false, message: "Combo bundle slug already exists" });
      }
    }

    const uploadedImages = Array.isArray(req.files?.images) ? req.files.images : [];
    const bannerFile = req.files?.bannerImage?.[0] || null;
    const uploadedImageUrls = await Promise.all(uploadedImages.map((file) => uploadImageToCloudinary(file)));
    const resolvedImageValue = uploadedImageUrls.length > 0
      ? uploadedImageUrls
      : parseImageValue(image ?? existingComboBundle.image);
    const resolvedBannerImage = bannerFile ? await uploadImageToCloudinary(bannerFile) : (bannerImage ?? existingComboBundle.bannerImage ?? "");

    const productIds = parseProductIds(req.body);
    const includesProductSelection = Object.keys(req.body).some((key) => ["productIds", "products", "productId"].includes(key));
    const currentSelections = includesProductSelection
      ? []
      : await prisma.comboBundleProduct.findMany({ where: { comboBundleId: id }, select: { productId: true, selectedColor: true } });
    const selectedProductIds = includesProductSelection ? productIds : currentSelections.map((entry) => entry.productId);
    const selectedColors = includesProductSelection
      ? parseProductColorMap(req.body.productColors)
      : Object.fromEntries(currentSelections.map((entry) => [entry.productId, entry.selectedColor || ""]));
    await validateProductCategory(category, selectedProductIds);
    await validateProductColorSelections(selectedProductIds, selectedColors);
    const updatedComboBundle = await prisma.comboBundle.update({
      where: { id },
      data: {
        categoryId: category.id,
        name: cleanName,
        slug: finalSlug,
        description: description ?? existingComboBundle.description,
        status: normalizeStatus(status || existingComboBundle.status),
        color: String(color ?? existingComboBundle.color ?? "").trim(),
        image: JSON.stringify(resolvedImageValue),
        bannerImage: resolvedBannerImage || "",
        calculatedPrice: Number(calculatedPrice ?? existingComboBundle.calculatedPrice),
        sellingPrice: nextSellingPrice,
        discountPercentage: parsedDiscountPercentage,
        manualPriceOverride: useManualPrice,
        priceReviewRequired: priceReviewRequired !== undefined ? parseBooleanInput(priceReviewRequired) : existingComboBundle.priceReviewRequired,
      },
    });

    if (includesProductSelection || category.id !== existingComboBundle.categoryId) {
      await syncComboBundleProducts(id, category, selectedProductIds, selectedColors);
    }

    const savedComboBundle = await prisma.comboBundle.findUnique({
      where: { id },
      include: {
        products: {
          include: { product: true },
          orderBy: { sortOrder: "asc" },
        },
        category: true,
      },
    });

    return res.json({ success: true, message: "Combo bundle updated", comboBundle: normalizeComboBundleJson(savedComboBundle) });
  } catch (error) {
    console.error("updateComboBundle error:", error);
    const isValidationError = /product not found|products must belong|category|color/i.test(error.message || "");
    return res.status(isValidationError ? 400 : 500).json({ success: false, message: error.message || "Unable to update combo bundle" });
  }
};

const listComboBundles = async (req, res) => {
  try {
    const where = {
      ...(req.query.categoryId ? { categoryId: String(req.query.categoryId) } : {}),
      ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}),
    };
    const comboBundles = await prisma.comboBundle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
          ...(req.query.includeProducts === "false"
            ? { _count: { select: { products: true } } }
            : { products: { include: { product: true }, orderBy: { sortOrder: "asc" } } }),
        category: true,
      },
    });

    return res.json({
      success: true,
      comboBundles: comboBundles.map((comboBundle) => normalizeComboBundleJson(comboBundle)),
    });
  } catch (error) {
    console.error("listComboBundles error:", error);
    return res.status(500).json({ success: false, message: error.message || "Unable to list combo bundles" });
  }
};

const getComboBundle = async (req, res) => {
  try {
    const { id, slug } = { ...req.query, ...req.body, ...req.params };
    const identifier = id || slug;
    const comboBundleReference = await prisma.comboBundle.findFirst({
      where: {
        ...(identifier ? { OR: [{ id: identifier }, { slug: identifier }] } : {}),
        ...(req.query.categoryId ? { categoryId: String(req.query.categoryId) } : {}),
        ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}),
      },
      select: { id: true, products: { select: { productId: true } } },
    });

    if (!comboBundleReference) {
      return res.status(404).json({ success: false, message: "Combo bundle not found" });
    }

    await Promise.all(comboBundleReference.products.map((entry) => syncProductStock(entry.productId)));

    const comboBundle = await prisma.comboBundle.findFirst({
      where: {
        id: comboBundleReference.id,
        ...(req.query.categoryId ? { categoryId: String(req.query.categoryId) } : {}),
        ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}),
      },
      include: {
        products: {
          include: { product: true },
          orderBy: { sortOrder: "asc" },
        },
        category: true,
      },
    });

    if (!comboBundle) {
      return res.status(404).json({ success: false, message: "Combo bundle not found" });
    }

    return res.json({ success: true, comboBundle: normalizeComboBundleJson(comboBundle) });
  } catch (error) {
    console.error("getComboBundle error:", error);
    return res.status(500).json({ success: false, message: error.message || "Unable to fetch combo bundle" });
  }
};

const removeComboBundle = async (req, res) => {
  try {
    const id = req.params.id || req.body.id;
    if (!id) {
      return res.status(400).json({ success: false, message: "Combo bundle ID is required" });
    }

    await prisma.comboBundle.delete({ where: { id } });
    return res.json({ success: true, message: "Combo bundle removed" });
  } catch (error) {
    console.error("removeComboBundle error:", error);
    return res.status(500).json({ success: false, message: error.message || "Unable to remove combo bundle" });
  }
};

export {
  createComboBundle,
  updateComboBundle,
  listComboBundles,
  getComboBundle,
  removeComboBundle,
};
