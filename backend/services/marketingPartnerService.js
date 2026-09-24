import { prisma } from "../config/db.js";

/**
 * Partner-scoped read-only service functions.
 * All queries enforce WHERE partnerId = req.partnerId to ensure data isolation.
 */

export const getPartnerById = (partnerId) =>
  prisma.marketingPartner.findUnique({
    where: { id: partnerId },
    select: { id: true, code: true, name: true, description: true, status: true, createdAt: true },
  });

export const getPartnerCampaigns = ({ partnerId, status } = {}) =>
  prisma.marketingCampaign.findMany({
    where: {
      marketingPartnerId: partnerId,
      ...(status && status !== "all" ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { cards: true, batches: true, benefits: true },
      },
      benefits: { select: { id: true, name: true, benefitType: true, value: true, status: true, expiresAt: true } },
    },
  });

export const getPartnerCampaignDetail = async ({ partnerId, campaignId }) => {
  const campaign = await prisma.marketingCampaign.findFirst({
    where: { id: campaignId, marketingPartnerId: partnerId },
    include: {
      benefits: true,
      batches: { select: { id: true, batchCode: true, quantity: true, status: true, createdAt: true } },
      _count: { select: { cards: true } },
    },
  });
  if (!campaign) {
    const error = new Error("Campaign not found or access denied.");
    error.code = "PARTNER_FORBIDDEN";
    throw error;
  }

  // Aggregate card stats for this campaign
  const [physicalCounts, activatedCount, redeemedCount] = await Promise.all([
    prisma.marketingCard.groupBy({
      by: ["physicalStatus"],
      where: { campaignId, partnerId },
      _count: { _all: true },
    }),
    prisma.marketingCardCustomer.count({
      where: { card: { campaignId, partnerId }, status: "ACTIVE" },
    }),
    prisma.marketingBenefitRedemption.count({
      where: { card: { campaignId, partnerId }, status: "REDEEMED" },
    }),
  ]);

  const physical = Object.fromEntries(physicalCounts.map((item) => [item.physicalStatus, item._count._all]));

  return { ...campaign, stats: { physical, activated: activatedCount, redeemed: redeemedCount } };
};

export const getPartnerCards = ({ partnerId, campaignId, status, page = 1, limit = 50 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {
    partnerId,
    ...(campaignId ? { campaignId } : {}),
    ...(status && status !== "all" ? { physicalStatus: status } : {}),
  };
  return Promise.all([
    prisma.marketingCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: Number(limit),
      include: {
        campaign: { select: { id: true, name: true, targetScopeType: true, targetProvince: true, targetDistrict: true } },
        customerLinks: { select: { id: true, status: true, linkedAt: true, activatedAt: true } },
        benefitRedemptions: { select: { id: true, status: true, redeemedAt: true } },
        assignedManufacturer: { select: { id: true, name: true, city: true } },
      },
    }),
    prisma.marketingCard.count({ where }),
  ]);
};

export const getPartnerCardDetail = async ({ partnerId, cardId }) => {
  const card = await prisma.marketingCard.findFirst({
    where: { id: cardId, partnerId },
    include: {
      campaign: { include: { benefits: true } },
      assignedManufacturer: { select: { id: true, name: true, city: true } },
      customerLinks: { select: { id: true, status: true, linkedAt: true, activatedAt: true } },
      benefitRedemptions: { select: { id: true, benefitId: true, status: true, redeemedAt: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!card) {
    const error = new Error("Card not found or access denied.");
    error.code = "PARTNER_FORBIDDEN";
    throw error;
  }
  // Never expose qrTokenHash
  const { qrTokenHash: _removed, ...safeCard } = card;
  return safeCard;
};

export const getPartnerMetrics = async (partnerId) => {
  const [physicalStatuses, activatedCount, redeemedCount, campaignCount] = await Promise.all([
    prisma.marketingCard.groupBy({
      by: ["physicalStatus"],
      where: { partnerId },
      _count: { _all: true },
    }),
    prisma.marketingCardCustomer.count({
      where: { card: { partnerId }, status: "ACTIVE" },
    }),
    prisma.marketingBenefitRedemption.count({
      where: { card: { partnerId }, status: "REDEEMED" },
    }),
    prisma.marketingCampaign.count({ where: { marketingPartnerId: partnerId } }),
  ]);

  const physical = Object.fromEntries(physicalStatuses.map((item) => [item.physicalStatus, item._count._all]));
  const totalCards = Object.values(physical).reduce((sum, n) => sum + n, 0);

  return {
    totalCampaigns: campaignCount,
    totalCards,
    physical,
    activated: activatedCount,
    redeemed: redeemedCount,
  };
};

export const getPartnerRedemptions = ({ partnerId, campaignId, status, page = 1, limit = 50 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {
    card: { partnerId },
    ...(campaignId ? { card: { partnerId, campaignId } } : {}),
    ...(status && status !== "all" ? { status } : {}),
  };
  return Promise.all([
    prisma.marketingBenefitRedemption.findMany({
      where,
      orderBy: { redeemedAt: "desc" },
      skip,
      take: Number(limit),
      include: {
        benefit: { select: { id: true, name: true, benefitType: true, value: true } },
        card: { select: { id: true, cardCode: true, campaignId: true, campaign: { select: { name: true, targetScopeType: true, targetProvince: true, targetDistrict: true } } } },
      },
    }),
    prisma.marketingBenefitRedemption.count({ where }),
  ]);
};

export const validatePartnerQr = async ({ partnerId, cardCode }) => {
  const normalizedCode = String(cardCode || "").trim().toUpperCase();
  if (!normalizedCode) {
    const error = new Error("A valid card code is required.");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const card = await prisma.marketingCard.findFirst({
    where: { cardCode: normalizedCode, partnerId },
    include: {
      campaign: { include: { benefits: true } },
      customerLinks: { where: { status: { not: "CANCELLED" } }, take: 1 },
      benefitRedemptions: { where: { status: "REDEEMED" } },
    },
  });

  if (!card) {
    return { valid: false, genuine: false, message: "Card not found or does not belong to this partner." };
  }

  const isActivated = card.customerLinks.length > 0;
  const redemptions = card.benefitRedemptions;

  return {
    valid: true,
    genuine: true,
    cardCode: card.cardCode,
    physicalStatus: card.physicalStatus,
    isActivated,
    campaign: { id: card.campaign.id, name: card.campaign.name, targetScopeType: card.campaign.targetScopeType },
    benefits: card.campaign.benefits.map((b) => ({
      id: b.id,
      name: b.name,
      benefitType: b.benefitType,
      value: b.value,
      status: redemptions.find((r) => r.benefitId === b.id) ? "REDEEMED" : b.status,
      redeemedAt: redemptions.find((r) => r.benefitId === b.id)?.redeemedAt || null,
    })),
  };
};

export const redeemPartnerBenefit = async ({ partnerId, cardCode, benefitId }) =>
  prisma.$transaction(async (tx) => {
    const card = await tx.marketingCard.findFirst({
      where: { cardCode: String(cardCode).trim().toUpperCase(), partnerId },
      include: {
        campaign: { include: { benefits: true } },
        customerLinks: { where: { status: { not: "CANCELLED" } } },
      },
    });
    if (!card) {
      const error = new Error("Card not found or does not belong to this partner.");
      error.code = "PARTNER_FORBIDDEN";
      throw error;
    }
    const benefit = card.campaign.benefits.find((b) => b.id === benefitId);
    if (!benefit || benefit.status !== "ACTIVE") {
      throw new Error("Benefit is not active or not found in this campaign.");
    }
    const existing = await tx.marketingBenefitRedemption.findFirst({
      where: { cardId: card.id, benefitId, status: "REDEEMED" },
    });
    if (existing) {
      throw new Error("Benefit has already been redeemed for this card.");
    }
    const customerId = card.customerLinks[0]?.customerId;
    if (!customerId) {
      throw new Error("Card must be activated by a customer before benefit redemption.");
    }

    const redemption = await tx.marketingBenefitRedemption.create({
      data: { cardId: card.id, benefitId, customerId, status: "REDEEMED" },
    });

    await tx.marketingCardEvent.create({
      data: {
        cardId: card.id,
        eventType: "BENEFIT_REDEEMED",
        actorRole: "MARKETING_PARTNER",
        actorId: partnerId,
        metadata: { benefitName: benefit.name, value: benefit.value, redemptionId: redemption.id },
      },
    });

    return {
      success: true,
      redemptionId: redemption.id,
      redeemedAt: redemption.redeemedAt,
      benefit: { id: benefit.id, name: benefit.name, benefitType: benefit.benefitType, value: benefit.value },
    };
  });

export const updatePartnerProfile = async ({ partnerId, name, contactPhone, website, address }) =>
  prisma.marketingPartner.update({
    where: { id: partnerId },
    data: {
      ...(name ? { name: String(name).trim() } : {}),
      ...(contactPhone !== undefined ? { contactPhone: contactPhone || null } : {}),
      ...(website !== undefined ? { website: website || null } : {}),
      ...(address !== undefined ? { address: address || null } : {}),
    },
    select: { id: true, code: true, name: true, email: true, status: true, contactPhone: true, website: true, address: true },
  });

