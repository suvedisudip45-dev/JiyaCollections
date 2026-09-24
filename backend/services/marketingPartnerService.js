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
      benefits: { select: { id: true, name: true, benefitType: true, value: true, percentage: true, status: true, expiresAt: true } },
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
      benefit: true,
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

/**
 * Validates a card presentation at the partner's physical shopping store.
 * Returns full customer details (name, phone, email), delivered order info,
 * product list, card activation date & expiry, and offer reward details.
 */
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
      campaign: { select: { id: true, name: true, targetScopeType: true, targetProvince: true, targetDistrict: true, endsAt: true } },
      benefit: true,
      customerLinks: {
        where: { status: { not: "CANCELLED" } },
        include: { customer: { select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true } } },
        take: 1,
      },
      orderLink: {
        include: {
          order: true,
        },
      },
      benefitRedemptions: true,
    },
  });

  if (!card) {
    return { valid: false, genuine: false, message: "Card not found or does not belong to your brand partner organization." };
  }

  const customerLink = card.customerLinks[0] || null;
  const isActivated = Boolean(customerLink && customerLink.status === "ACTIVE" && customerLink.activatedAt);
  const redemptions = card.benefitRedemptions || [];
  const isRedeemed = redemptions.some((r) => r.status === "REDEEMED");
  const isRejected = redemptions.some((r) => r.status === "REJECTED");
  const hasBenefit = Boolean(card.hasBenefit && card.benefit);

  // Extract customer info from customer profile or order shipping address
  const orderObj = card.orderLink?.order || null;
  let address = {};
  if (orderObj?.address) {
    if (typeof orderObj.address === "object") {
      address = orderObj.address;
    } else if (typeof orderObj.address === "string") {
      try { address = JSON.parse(orderObj.address); } catch { address = {}; }
    }
  }

  const user = customerLink?.customer || null;
  const customerName = user?.name || `${address?.firstName || ""} ${address?.lastName || ""}`.trim() || "Verified Customer";
  const customerPhone = user?.phone || address?.phone || "N/A";
  const customerEmail = user?.email || address?.email || "N/A";

  // Extract ordered products
  let orderedProducts = [];
  if (orderObj?.items) {
    let rawItems = [];
    if (Array.isArray(orderObj.items)) {
      rawItems = orderObj.items;
    } else if (typeof orderObj.items === "string") {
      try { rawItems = JSON.parse(orderObj.items); } catch { rawItems = []; }
    }
    orderedProducts = rawItems.map((item) => ({
      name: item.name || item.title || "Store Item",
      quantity: item.quantity || 1,
      size: item.size || "-",
      price: item.price || 0,
      image: item.image || item.images?.[0] || null,
    }));
  }

  const expiryDate = card.benefit?.expiresAt || card.campaign?.endsAt || null;

  const benefits = hasBenefit && card.benefit
    ? [
        {
          id: card.benefit.id,
          name: card.benefit.name,
          description: card.benefit.description,
          benefitType: card.benefit.benefitType,
          value: card.benefit.value,
          terms: card.benefit.terms,
          expiresAt: expiryDate,
          status: isRedeemed ? "REDEEMED" : isRejected ? "REJECTED" : card.benefit.status,
          redeemedAt: redemptions.find((r) => r.status === "REDEEMED")?.redeemedAt || null,
        },
      ]
    : [];

  return {
    valid: true,
    genuine: true,
    cardId: card.id,
    cardCode: card.cardCode,
    physicalStatus: card.physicalStatus,
    isActivated,
    activatedAt: customerLink?.activatedAt || null,
    linkedAt: customerLink?.linkedAt || null,
    expiresAt: expiryDate,
    hasBenefit,
    isRedeemed,
    isRejected,
    message: isRejected
      ? "⚠️ This card has been marked as REJECTED / Suspicious."
      : isRedeemed
      ? "⚠️ This card offer has already been redeemed."
      : !isActivated
      ? "ℹ️ This card has not been activated by the customer yet."
      : hasBenefit
      ? "✅ Valid and active card ready for redemption."
      : "🍀 Better luck next time! No reward is attached to this card.",
    customer: {
      id: user?.id || null,
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
    },
    order: orderObj
      ? {
          id: orderObj.id,
          date: orderObj.date ? Number(orderObj.date) : null,
          status: orderObj.status,
          amount: orderObj.amount,
          products: orderedProducts,
        }
      : null,
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      targetScopeType: card.campaign.targetScopeType,
      targetProvince: card.campaign.targetProvince,
      targetDistrict: card.campaign.targetDistrict,
    },
    benefits,
  };
};

export const redeemPartnerBenefit = async ({ partnerId, cardCode, benefitId }) =>
  prisma.$transaction(async (tx) => {
    const card = await tx.marketingCard.findFirst({
      where: { cardCode: String(cardCode).trim().toUpperCase(), partnerId },
      include: {
        campaign: true,
        benefit: true,
        customerLinks: { where: { status: { not: "CANCELLED" } } },
      },
    });
    if (!card) {
      const error = new Error("Card not found or does not belong to this partner.");
      error.code = "PARTNER_FORBIDDEN";
      throw error;
    }
    if (!card.hasBenefit || !card.benefit || card.benefitId !== benefitId) {
      throw new Error("This card does not carry any claimable benefit. Better luck next time!");
    }
    const benefit = card.benefit;
    if (benefit.status !== "ACTIVE") {
      throw new Error("Benefit is not active.");
    }
    const existing = await tx.marketingBenefitRedemption.findFirst({
      where: { cardId: card.id, benefitId, status: "REDEEMED" },
    });
    if (existing) {
      throw new Error("Benefit has already been redeemed for this card.");
    }
    const customerLink = card.customerLinks[0];
    if (!customerLink || customerLink.status !== "ACTIVE" || !customerLink.activatedAt) {
      throw new Error("Card must be activated by the customer before benefit redemption.");
    }
    const customerId = customerLink.customerId;

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

export const rejectPartnerCard = async ({ partnerId, cardCode, reason }) =>
  prisma.$transaction(async (tx) => {
    const card = await tx.marketingCard.findFirst({
      where: { cardCode: String(cardCode).trim().toUpperCase(), partnerId },
      include: {
        campaign: { include: { benefits: true } },
        benefit: true,
        customerLinks: { where: { status: { not: "CANCELLED" } } },
        orderLink: { include: { order: true } },
      },
    });
    if (!card) {
      const error = new Error("Card not found or does not belong to this partner.");
      error.code = "PARTNER_FORBIDDEN";
      throw error;
    }

    let customerId = card.customerLinks[0]?.customerId || card.orderLink?.order?.userId;
    if (!customerId) {
      const firstUser = await tx.user.findFirst({ select: { id: true } });
      customerId = firstUser?.id;
    }

    const benefitId = card.benefitId || card.campaign.benefits[0]?.id;

    let rejectionId = null;
    if (benefitId && customerId) {
      const rejection = await tx.marketingBenefitRedemption.create({
        data: {
          cardId: card.id,
          benefitId,
          customerId,
          status: "REJECTED",
        },
      });
      rejectionId = rejection.id;
    }

    await tx.marketingCardEvent.create({
      data: {
        cardId: card.id,
        eventType: "CARD_REJECTED_BY_PARTNER",
        actorRole: "MARKETING_PARTNER",
        actorId: partnerId,
        metadata: { reason: reason || "Suspicious or invalid card presented", rejectionId },
      },
    });

    return {
      success: true,
      cardCode: card.cardCode,
      status: "REJECTED",
      reason: reason || "Suspicious card flagged",
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
