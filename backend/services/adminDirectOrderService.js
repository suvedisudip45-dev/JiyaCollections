import { prisma } from "../config/db.js";
import { directOrderReceiptRequiredError } from "../utils/directOrderReceiptPolicy.js";

export const validateOrderStock = (items, dbProducts) => {
  const requestedByProduct = new Map();
  for (const cartItem of items) {
    const productId = cartItem._id || cartItem.id || cartItem.productId;
    const requestedQty = Math.max(1, Number(cartItem.quantity || 1));
    if (!Number.isFinite(requestedQty)) {
      return { valid: false, message: "Product quantity must be a valid number." };
    }
    if (!requestedByProduct.has(productId)) requestedByProduct.set(productId, []);
    requestedByProduct.get(productId).push({ cartItem, requestedQty });
  }

  for (const [productId, productRequests] of requestedByProduct) {
    const product = dbProducts.find((record) => record.id === productId);
    if (!product) {
      return { valid: false, message: `Product not found: ${productRequests[0].cartItem.name || productId}` };
    }

    let variants = typeof product.variants === "string"
      ? JSON.parse(product.variants || "[]")
      : (product.variants || []);
    if (!Array.isArray(variants)) variants = [];

    if (variants.length === 0) {
      const requestedQty = productRequests.reduce((sum, request) => sum + request.requestedQty, 0);
      const stock = Number(product.stockQuantity ?? 0);
      if (stock <= 0) {
        return { valid: false, message: `Product "${product.name}" is out of stock.` };
      }
      if (requestedQty > stock) {
        return {
          valid: false,
          message: `Requested quantity (${requestedQty}) for "${product.name}" exceeds available stock (${stock}).`,
        };
      }
      continue;
    }

    const requestedByVariant = new Map();
    for (const { cartItem, requestedQty } of productRequests) {
      const itemSize = (cartItem.size || "").trim().toLowerCase();
      const itemColor = (cartItem.color || "").trim().toLowerCase();
      let matchedVariant = null;
      if (itemSize && itemColor) {
        matchedVariant = variants.find(
          (variant) =>
            (variant.size || "").trim().toLowerCase() === itemSize &&
            (variant.color || "").trim().toLowerCase() === itemColor,
        );
      } else if (itemSize) {
        matchedVariant = variants.find(
          (variant) => (variant.size || "").trim().toLowerCase() === itemSize,
        );
      } else if (itemColor) {
        matchedVariant = variants.find(
          (variant) => (variant.color || "").trim().toLowerCase() === itemColor,
        );
      }

      if (matchedVariant) {
        const variantIndex = variants.indexOf(matchedVariant);
        requestedByVariant.set(
          variantIndex,
          (requestedByVariant.get(variantIndex) || 0) + requestedQty,
        );
      }
    }

    const requestedQty = productRequests.reduce((sum, request) => sum + request.requestedQty, 0);
    const totalVariantStock = variants.reduce(
      (sum, variant) => sum + Math.max(0, Number(variant.quantity || 0)),
      0,
    );
    if (totalVariantStock <= 0) {
      return { valid: false, message: `Product "${product.name}" is completely out of stock.` };
    }
    if (requestedQty > totalVariantStock) {
      return {
        valid: false,
        message: `Requested quantity (${requestedQty}) for "${product.name}" exceeds available stock (${totalVariantStock}).`,
      };
    }

    for (const [variantIndex, variantQty] of requestedByVariant) {
      const availableQty = Number(variants[variantIndex].quantity ?? 0);
      if (availableQty <= 0) {
        return { valid: false, message: `Product "${product.name}" is out of stock.` };
      }
      if (variantQty > availableQty) {
        return {
          valid: false,
          message: `Requested quantity (${variantQty}) for "${product.name}" exceeds available stock (${availableQty}).`,
        };
      }
    }
  }
  return { valid: true };
};

const buildProductDeductions = (items) => {
  const deductions = new Map();
  for (const item of items) {
    const productId = item.productId || item._id || item.id;
    const quantity = Number(item.quantity || 1);
    if (!productId) continue;

    if (!deductions.has(productId)) {
      deductions.set(productId, { totalQty: 0, variantDeductions: [] });
    }
    const deduction = deductions.get(productId);
    deduction.totalQty += quantity;
    if (item.size || item.color) {
      deduction.variantDeductions.push({
        size: item.size || "",
        color: item.color || "",
        quantity,
      });
    }
  }
  return deductions;
};

const deductVariants = (variants, deduction) => {
  let deductedVariantQty = 0;
  for (const variantDeduction of deduction.variantDeductions) {
    const size = variantDeduction.size.trim().toLowerCase();
    const color = variantDeduction.color.trim().toLowerCase();
    const variantIndex = variants.findIndex((variant) => {
      const variantSize = (variant.size || "").trim().toLowerCase();
      const variantColor = (variant.color || "").trim().toLowerCase();
      return size && color
        ? variantSize === size && variantColor === color
        : size
          ? variantSize === size
          : variantColor === color;
    });
    if (variantIndex === -1) continue;

    const currentQuantity = Number(variants[variantIndex].quantity || 0);
    variants[variantIndex].quantity = Math.max(0, currentQuantity - variantDeduction.quantity);
    deductedVariantQty += variantDeduction.quantity;
  }

  let remainingQty = deduction.totalQty - deductedVariantQty;
  for (const variant of variants) {
    if (remainingQty <= 0) break;
    const availableQty = Math.max(0, Number(variant.quantity || 0));
    const quantityToDeduct = Math.min(availableQty, remainingQty);
    variant.quantity = availableQty - quantityToDeduct;
    remainingQty -= quantityToDeduct;
  }
};

export const createAdminDirectOrderWithStock = async ({
  client = prisma,
  orderData,
  items,
  source = "Social Media",
}) => {
  const receiptDeclarationError = directOrderReceiptRequiredError(orderData?.payment);
  if (receiptDeclarationError) throw receiptDeclarationError;

  const productDeductions = buildProductDeductions(items);
  const productIds = [...productDeductions.keys()];

  const execute = async (tx) => {
    const currentProducts = await tx.product.findMany({
      where: { id: { in: productIds }, collaborationLink: null },
    });
    const stockValidation = validateOrderStock(items, currentProducts);
    if (!stockValidation.valid) {
      throw Object.assign(new Error(stockValidation.message), { code: "ORDER_STOCK_INVALID" });
    }

    const order = await tx.order.create({ data: orderData });
    for (const [productId, deduction] of productDeductions) {
      const product = currentProducts.find((record) => record.id === productId);
      if (!product) continue;

      const updateData = {};
      const variants = typeof product.variants === "string"
        ? JSON.parse(product.variants || "[]")
        : product.variants || [];
      const hasVariants = Array.isArray(variants) && variants.length > 0;

      if (hasVariants) {
        deductVariants(variants, deduction);
        updateData.variants = variants;
        updateData.stockQuantity = variants.reduce(
          (total, variant) => total + (Number(variant.quantity) || 0),
          0,
        );
      } else if (product.stockQuantity !== undefined && product.stockQuantity !== null) {
        updateData.stockQuantity = Math.max(0, Number(product.stockQuantity) - deduction.totalQty);
      }

      if (Object.keys(updateData).length > 0) {
        await tx.product.update({ where: { id: productId }, data: updateData });
      }

      const channelSource = source.toLowerCase().replace(/\s+/g, "_");
      await tx.stockLog.create({
        data: {
          productId,
          productName: product.name,
          variantLabel: deduction.variantDeductions.length > 0
            ? deduction.variantDeductions.map((variant) => `${variant.size}/${variant.color}`).join(", ")
            : null,
          previousQty: product.stockQuantity || 0,
          newQty: updateData.stockQuantity ?? product.stockQuantity ?? 0,
          changeQty: -deduction.totalQty,
          reason: "order_sale",
          note: `Manual Order (${source})`,
          orderId: order.id,
          source: channelSource || "admin",
        },
      });
    }

    return order;
  };

  if (typeof client.$transaction !== "function") return execute(client);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.$transaction(execute, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};
