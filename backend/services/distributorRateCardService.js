import { prisma } from "../config/db.js";

const DEFAULT_DELIVERY_CHARGE = 100;
const DEFAULT_RETURN_CHARGE = 50;
const DEFAULT_COMMISSION_RATE = 0;
const DEFAULT_BONUS_RATE = 0;
const DEFAULT_INCENTIVE_RATE = 0;
const DEFAULT_VAT_RATE = 13;

/**
 * Record or negotiate delivery rate card between Admin and Distributor.
 */
export const recordDistributorRateCard = async ({
  distributorId,
  productId = null,
  deliveryCharge = DEFAULT_DELIVERY_CHARGE,
  returnCharge = DEFAULT_RETURN_CHARGE,
  commissionRate = DEFAULT_COMMISSION_RATE,
  bonusRate = DEFAULT_BONUS_RATE,
  incentiveRate = DEFAULT_INCENTIVE_RATE,
  vatRate = DEFAULT_VAT_RATE,
  vatInclusive = false,
  status = "APPROVED",
  proposedByRole = "ADMIN",
  proposedByAccountId = null,
  reviewedByAccountId = null,
  effectiveFrom = null,
  effectiveUntil = null,
  notes = null,
  client = prisma,
} = {}) => {
  if (!distributorId) {
    const error = new Error("Distributor ID is required.");
    error.statusCode = 400;
    throw error;
  }

  const distributor = await client.distributor.findUnique({
    where: { id: distributorId },
  });
  if (!distributor) {
    const error = new Error("Distributor profile not found.");
    error.statusCode = 404;
    throw error;
  }

  if (productId) {
    const product = await client.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      const error = new Error("Product not found.");
      error.statusCode = 404;
      throw error;
    }
  }

  const numDeliveryCharge = Math.max(0, Number(deliveryCharge || 0));
  const numReturnCharge = Math.max(0, Number(returnCharge || 0));
  const numCommissionRate = Math.max(0, Number(commissionRate || 0));
  const numBonusRate = Math.max(0, Number(bonusRate || 0));
  const numIncentiveRate = Math.max(0, Number(incentiveRate || 0));
  const numVatRate = Math.max(0, Number(vatRate !== undefined ? vatRate : DEFAULT_VAT_RATE));

  // Find existing active negotiation for distributor and product
  const existing = await client.distributorDeliveryChargeNegotiation.findFirst({
    where: {
      distributorId,
      productId: productId || null,
      status: { in: ["APPROVED", "PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = {
    distributorId,
    productId: productId || null,
    deliveryCharge: numDeliveryCharge,
    returnCharge: numReturnCharge,
    commissionRate: numCommissionRate,
    bonusRate: numBonusRate,
    incentiveRate: numIncentiveRate,
    vatRate: numVatRate,
    vatInclusive: Boolean(vatInclusive),
    status: status || "APPROVED",
    proposedByRole: proposedByRole || "ADMIN",
    proposedByAccountId: proposedByAccountId || null,
    reviewedByAccountId: reviewedByAccountId || proposedByAccountId || null,
    reviewedAt: status === "APPROVED" ? new Date() : null,
    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    effectiveUntil: effectiveUntil ? new Date(effectiveUntil) : null,
    notes: notes || null,
  };

  if (existing) {
    return client.distributorDeliveryChargeNegotiation.update({
      where: { id: existing.id },
      data,
      include: {
        distributor: { select: { id: true, name: true, city: true, phone: true } },
        product: { select: { id: true, name: true } },
      },
    });
  }

  return client.distributorDeliveryChargeNegotiation.create({
    data,
    include: {
      distributor: { select: { id: true, name: true, city: true, phone: true } },
      product: { select: { id: true, name: true } },
    },
  });
};

/**
 * List rate cards for a distributor or admin query.
 */
export const getDistributorRateCards = async ({
  distributorId = null,
  productId = null,
  status = null,
  client = prisma,
} = {}) => {
  const where = {};
  if (distributorId) where.distributorId = distributorId;
  if (productId) where.productId = productId;
  if (status && status !== "all") where.status = status;

  return client.distributorDeliveryChargeNegotiation.findMany({
    where,
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: {
      distributor: { select: { id: true, name: true, city: true, phone: true } },
      product: { select: { id: true, name: true } },
    },
  });
};

/**
 * Resolve active rate card for distributor & product.
 */
export const resolveActiveRateCard = async ({
  distributorId,
  productId = null,
  client = prisma,
} = {}) => {
  if (!distributorId) {
    return {
      deliveryCharge: DEFAULT_DELIVERY_CHARGE,
      returnCharge: DEFAULT_RETURN_CHARGE,
      commissionRate: DEFAULT_COMMISSION_RATE,
      bonusRate: DEFAULT_BONUS_RATE,
      incentiveRate: DEFAULT_INCENTIVE_RATE,
      vatRate: DEFAULT_VAT_RATE,
      vatInclusive: false,
      isDefaultFallback: true,
    };
  }

  // 1. Check product-specific approved rate card
  if (productId) {
    const productRate = await client.distributorDeliveryChargeNegotiation.findFirst({
      where: {
        distributorId,
        productId,
        status: "APPROVED",
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (productRate) {
      return {
        deliveryCharge: Number(productRate.deliveryCharge),
        returnCharge: Number(productRate.returnCharge),
        commissionRate: Number(productRate.commissionRate || 0),
        bonusRate: Number(productRate.bonusRate || 0),
        incentiveRate: Number(productRate.incentiveRate || 0),
        vatRate: Number(productRate.vatRate ?? DEFAULT_VAT_RATE),
        vatInclusive: Boolean(productRate.vatInclusive),
        rateCardId: productRate.id,
        isDefaultFallback: false,
      };
    }
  }

  // 2. Check general distributor approved rate card
  const generalRate = await client.distributorDeliveryChargeNegotiation.findFirst({
    where: {
      distributorId,
      productId: null,
      status: "APPROVED",
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (generalRate) {
    return {
      deliveryCharge: Number(generalRate.deliveryCharge),
      returnCharge: Number(generalRate.returnCharge),
      commissionRate: Number(generalRate.commissionRate || 0),
      bonusRate: Number(generalRate.bonusRate || 0),
      incentiveRate: Number(generalRate.incentiveRate || 0),
      vatRate: Number(generalRate.vatRate ?? DEFAULT_VAT_RATE),
      vatInclusive: Boolean(generalRate.vatInclusive),
      rateCardId: generalRate.id,
      isDefaultFallback: false,
    };
  }

  // 3. Fallback default
  return {
    deliveryCharge: DEFAULT_DELIVERY_CHARGE,
    returnCharge: DEFAULT_RETURN_CHARGE,
    commissionRate: DEFAULT_COMMISSION_RATE,
    bonusRate: DEFAULT_BONUS_RATE,
    incentiveRate: DEFAULT_INCENTIVE_RATE,
    vatRate: DEFAULT_VAT_RATE,
    vatInclusive: false,
    isDefaultFallback: true,
  };
};
