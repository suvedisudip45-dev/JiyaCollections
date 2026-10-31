import { prisma } from "../config/db.js";

const DEFAULT_DELIVERY_CHARGE = 100;
const DEFAULT_RETURN_CHARGE = 50;
const DEFAULT_NCM_TRANSFER_CHARGE = 0;
const DEFAULT_COMMISSION_RATE = 0;
const DEFAULT_BONUS_RATE = 0;
const DEFAULT_INCENTIVE_RATE = 0;
const DEFAULT_VAT_RATE = 13;

const nonNegativeRateValue = (value, label, maximum = 999_999_999_999_999_999) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    const error = new Error(`${label} must be between 0 and ${maximum}.`);
    error.statusCode = 400;
    throw error;
  }
  return Number(parsed.toFixed(2));
};

/**
 * Record or negotiate delivery rate card between Admin and Distributor.
 */
export const recordDistributorRateCard = async ({
  distributorId,
  productId = null,
  deliveryCharge = DEFAULT_DELIVERY_CHARGE,
  returnCharge = DEFAULT_RETURN_CHARGE,
  ncmTransferCharge = DEFAULT_NCM_TRANSFER_CHARGE,
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

  const numDeliveryCharge = nonNegativeRateValue(deliveryCharge, "Delivery charge");
  const numReturnCharge = nonNegativeRateValue(returnCharge, "Return charge");
  const numNcmTransferCharge = nonNegativeRateValue(ncmTransferCharge, "NCM transfer charge");
  const numCommissionRate = nonNegativeRateValue(commissionRate, "Commission rate", 100);
  nonNegativeRateValue(bonusRate, "Legacy delivery incentive");
  nonNegativeRateValue(incentiveRate, "Legacy incentive rate");
  const numBonusRate = DEFAULT_BONUS_RATE;
  const numIncentiveRate = DEFAULT_INCENTIVE_RATE;
  const numVatRate = nonNegativeRateValue(vatRate !== undefined ? vatRate : DEFAULT_VAT_RATE, "VAT rate", 100);
  let startsAt = effectiveFrom ? new Date(effectiveFrom) : new Date();
  if (!Number.isFinite(startsAt.getTime())) {
    const error = new Error("Rate card effective date must be valid.");
    error.statusCode = 400;
    throw error;
  }
  const endsAt = effectiveUntil ? new Date(effectiveUntil) : null;
  if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt)) {
    const error = new Error("Rate card effective end must be after its effective start.");
    error.statusCode = 400;
    throw error;
  }

  const pending = await client.distributorDeliveryChargeNegotiation.findFirst({
    where: {
      distributorId,
      productId: productId || null,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
  const existing = await client.distributorDeliveryChargeNegotiation.findFirst({
    where: {
      distributorId,
      productId: productId || null,
      status: "APPROVED",
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (
    existing?.status === "APPROVED" &&
    !effectiveFrom &&
    startsAt <= new Date(existing.effectiveFrom || existing.createdAt || 0)
  ) {
    startsAt = new Date(new Date(existing.effectiveFrom || existing.createdAt || 0).getTime() + 1);
  }

  const data = {
    distributorId,
    productId: productId || null,
    deliveryCharge: numDeliveryCharge,
    returnCharge: numReturnCharge,
    ncmTransferCharge: numNcmTransferCharge,
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
    effectiveFrom: startsAt,
    effectiveUntil: endsAt,
    notes: notes || null,
  };

  if (pending && startsAt <= new Date(existing?.effectiveFrom || existing?.createdAt || 0)) {
    const error = new Error("A new approved rate card must start after the existing rate card became effective.");
    error.statusCode = 409;
    throw error;
  }
  if (existing && startsAt <= new Date(existing.effectiveFrom || existing.createdAt || 0)) {
    const error = new Error("A new approved rate card must start after the existing rate card became effective.");
    error.statusCode = 409;
    throw error;
  }
  if (
    existing &&
    (!existing.effectiveUntil || existing.effectiveUntil > startsAt)
  ) {
    await client.distributorDeliveryChargeNegotiation.update({
      where: { id: existing.id },
      data: { effectiveUntil: new Date(startsAt.getTime() - 1) },
    });
  }

  if (pending) {
    return client.distributorDeliveryChargeNegotiation.update({
      where: { id: pending.id },
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
  effectiveAt = new Date(),
  client = prisma,
} = {}) => {
  if (!distributorId) {
    return {
      deliveryCharge: DEFAULT_DELIVERY_CHARGE,
      returnCharge: DEFAULT_RETURN_CHARGE,
      ncmTransferCharge: DEFAULT_NCM_TRANSFER_CHARGE,
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
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveAt } }],
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveAt } }] }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (productRate) {
      return {
        deliveryCharge: Number(productRate.deliveryCharge),
        returnCharge: Number(productRate.returnCharge),
        ncmTransferCharge: Number(productRate.ncmTransferCharge ?? DEFAULT_NCM_TRANSFER_CHARGE),
        commissionRate: Number(productRate.commissionRate || 0),
        bonusRate: DEFAULT_BONUS_RATE,
        incentiveRate: DEFAULT_INCENTIVE_RATE,
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
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveAt } }],
      AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveAt } }] }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (generalRate) {
    return {
      deliveryCharge: Number(generalRate.deliveryCharge),
      returnCharge: Number(generalRate.returnCharge),
      ncmTransferCharge: Number(generalRate.ncmTransferCharge ?? DEFAULT_NCM_TRANSFER_CHARGE),
      commissionRate: Number(generalRate.commissionRate || 0),
      bonusRate: DEFAULT_BONUS_RATE,
      incentiveRate: DEFAULT_INCENTIVE_RATE,
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
    ncmTransferCharge: DEFAULT_NCM_TRANSFER_CHARGE,
    commissionRate: DEFAULT_COMMISSION_RATE,
    bonusRate: DEFAULT_BONUS_RATE,
    incentiveRate: DEFAULT_INCENTIVE_RATE,
    vatRate: DEFAULT_VAT_RATE,
    vatInclusive: false,
    isDefaultFallback: true,
  };
};
