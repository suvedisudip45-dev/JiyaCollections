import crypto from "node:crypto";
import { prisma } from "../config/db.js";

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const isDelivered = (order) => {
  const status = `${String(order?.status || "")} ${String(order?.fulfillmentStatus || "")}`.toLowerCase();
  return status.includes("delivered");
};

export const assertCardOrderEligibility = (
  card,
  customerId,
  {
    ownershipMessage = "This card does not belong to this customer account.",
    deliveryMessage = "This card is not eligible because the related order is not marked as delivered.",
  } = {}
) => {
  if (card.campaign?.isOwnStore) return;
  if (card.orderLink?.order?.userId && card.orderLink.order.userId !== customerId) {
    const error = new Error(ownershipMessage);
    error.code = "MARKETING_CARD_FORBIDDEN";
    throw error;
  }
  if (!card.orderLink?.order || !isDelivered(card.orderLink.order)) {
    const error = new Error(deliveryMessage);
    error.code = "MARKETING_CARD_NOT_ELIGIBLE";
    throw error;
  }
};

const addEvent = (tx, { cardId, eventType, actorId, fromStatus, toStatus, referenceId, metadata }) => tx.marketingCardEvent.create({
  data: { cardId, eventType, actorId, actorRole: "CUSTOMER", fromStatus, toStatus, referenceId, metadata },
});

const campaignWindowIsValid = (campaign, now = new Date()) => {
  if (!campaign) return false;
  // Allow CANCELLED campaigns for already-linked cards; block only for new verifications
  if (!["ACTIVE", "PAUSED"].includes(campaign.status) && campaign.status !== "CANCELLED") return false;
  if (campaign.startsAt && campaign.startsAt > now) return false;
  if (campaign.endsAt && campaign.endsAt < now) return false;
  return true;
};

export const assertCardCanBeScanned = (card) => {
  if (!card.exchangeLockRequestId) return;
  const error = new Error("This card is temporarily locked while an exchange is in progress.");
  error.code = "MARKETING_CARD_EXCHANGE_LOCKED";
  throw error;
};

export const assertCardNotPreviouslyScanned = (card) => {
  if (!card.customerLinks?.length) return;
  const error = new Error("This card has already been scanned and cannot be used again.");
  error.code = "MARKETING_CARD_ALREADY_SCANNED";
  throw error;
};

/** Returns true if card expiry date has not passed (customers can still activate / partners can still redeem). */
const cardExpiryIsValid = (campaign, now = new Date()) => {
  if (!campaign) return false;
  if (campaign.cardExpiresAt && new Date(campaign.cardExpiresAt) < now) return false;
  return true;
};

const benefitIsValid = (benefit, now = new Date()) => (
  benefit.status === "ACTIVE" &&
  (!benefit.startsAt || benefit.startsAt <= now) &&
  (!benefit.expiresAt || benefit.expiresAt >= now)
);

const partnerForCard = (card) => card.assignedPartner || card.partner || card.campaign?.marketingPartner || null;

const organizationForCard = (card) => (
  String(card.isPublic ? "Everyone" : card.assignedOrganization || partnerForCard(card)?.name || "Aama Own Store").trim()
);

const NEPAL_OFFSET_MS = 345 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

export const getScanWeekIndex = (date = new Date()) => (
  Math.floor((date.getTime() + NEPAL_OFFSET_MS - MONDAY_EPOCH_MS) / WEEK_MS)
);

const quota = (used, limit) => ({ used, limit, remaining: Math.max(0, limit - used) });

export const getOwnStoreScanLimits = (
  weeklyUsed,
  organizationUsed,
  { isPublic = false, campaignUsed = 0, maxScansPerCustomer = 1 } = {}
) => ({
  weekly: quota(weeklyUsed, 5),
  campaign: quota(campaignUsed, maxScansPerCustomer),
  ...(isPublic
    ? {}
    : { organization: quota(organizationUsed, 2) }),
});

export const assertOwnStoreScanQuota = (scanLimits, assignedOrganization) => {
  if (scanLimits.weekly.used >= scanLimits.weekly.limit) {
    const error = new Error("You have reached the limit of 5 Own Store card scans for this campaign this calendar week.");
    error.code = "MARKETING_CARD_SCAN_LIMIT";
    error.details = { limit: "WEEKLY_CAMPAIGN", scanLimits };
    throw error;
  }
  if (scanLimits.campaign && scanLimits.campaign.used >= scanLimits.campaign.limit) {
    const error = new Error(`You have reached this campaign's limit of ${scanLimits.campaign.limit} card scan(s) per customer.`);
    error.code = "MARKETING_CARD_SCAN_LIMIT";
    error.details = { limit: "CAMPAIGN_CUSTOMER", scanLimits };
    throw error;
  }
  if (scanLimits.organization && scanLimits.organization.used >= scanLimits.organization.limit) {
    const error = new Error(`You have reached the limit of 2 cards for ${assignedOrganization} in this campaign.`);
    error.code = "MARKETING_CARD_SCAN_LIMIT";
    error.details = { limit: "ORGANIZATION_CAMPAIGN", scanLimits };
    throw error;
  }
};

const incrementScanLimits = (scanLimits) => Object.fromEntries(Object.entries(scanLimits).map(([key, limit]) => [
    key,
    { ...limit, used: limit.used + 1, remaining: Math.max(0, limit.remaining - 1) },
  ]));

const scanQuotaFor = async ({
  client,
  customerId,
  campaignId,
  assignedOrganization,
  scanWeekIndex,
  isPublic = false,
  maxScansPerCustomer = 1,
}) => {
  const scope = { customerId, scanWeekIndex, card: { campaignId } };
  const [weeklyCount, organizationCount, campaignCount] = await Promise.all([
    client.marketingCardCustomer.count({ where: scope }),
    isPublic
      ? Promise.resolve(0)
      :       client.marketingCardCustomer.count({
        where: { customerId, card: { campaignId }, assignedOrganization },
      }),
    client.marketingCardCustomer.count({ where: { customerId, card: { campaignId } } }),
  ]);
  return getOwnStoreScanLimits(weeklyCount, organizationCount, {
    isPublic,
    campaignUsed: campaignCount,
    maxScansPerCustomer,
  });
};

const safeCard = (linkOrWrapper) => {
  const link = linkOrWrapper.link || linkOrWrapper;
  const card = linkOrWrapper.card || link.card;
  const benefit = card?.benefit;
  const hasBenefit = Boolean(card?.hasBenefit && benefit);
  const isActivated = link.status === "ACTIVE" && Boolean(link.activatedAt);

  const benefits = hasBenefit
    ? [
        {
          id: benefit.id,
          name: benefit.name,
          description: benefit.description,
          benefitType: benefit.benefitType,
          value: benefit.value,
          terms: benefit.terms,
          startsAt: benefit.startsAt,
          expiresAt: benefit.expiresAt,
          status: benefit.redemptions?.[0]?.status || benefit.status,
          claimedAt: benefit.redemptions?.[0]?.claimedAt || null,
          redeemedAt: benefit.redemptions?.[0]?.redeemedAt || null,
        },
      ]
    : [];

  return {
    id: card.id,
    cardCode: card.cardCode,
    status: link.status,
    linkedAt: link.linkedAt,
    scannedAt: link.scannedAt,
    assignedOrganization: link.assignedOrganization || card.assignedOrganization || null,
    isPublic: Boolean(card.isPublic),
    activatedAt: link.activatedAt,
    isActivated: link.status === "ACTIVE" && !!link.activatedAt,
    hasBenefit,
    benefitMessage: hasBenefit
      ? "Congratulations! You have an exclusive reward."
      : "Better luck next time!",
    cardExpiresAt: card.campaign?.cardExpiresAt || null,
    isCardExpired: card.campaign?.cardExpiresAt ? new Date() > new Date(card.campaign.cardExpiresAt) : false,
    partner: partnerForCard(card)
      ? { id: partnerForCard(card).id, name: partnerForCard(card).name, code: partnerForCard(card).code }
      : { id: null, name: card.assignedOrganization || "Aama Own Store", code: "OWN" },
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      isOwnStore: Boolean(card.campaign.isOwnStore),
      status: card.campaign.status,
      targetScopeType: card.campaign.targetScopeType,
      targetProvince: card.campaign.targetProvince,
      targetDistrict: card.campaign.targetDistrict,
      startsAt: card.campaign.startsAt,
      endsAt: card.campaign.endsAt,
      cardExpiresAt: card.campaign.cardExpiresAt,
    },
    benefits,
  };
};

const cardIncludeForCustomer = (customerId) => ({
  card: {
    include: {
      benefit: {
        include: {
          redemptions: { where: { customerId, status: { in: ["CLAIMED", "REDEEMED"] } }, orderBy: { redeemedAt: "desc" }, take: 1 },
        },
      },
      partner: true,
      assignedPartner: true,
      campaign: {
        include: {
          marketingPartner: true,
        },
      },
    },
  },
});

export const listCustomerCards = async (customerId) => {
  const links = await prisma.marketingCardCustomer.findMany({
    where: { customerId, status: { not: "CANCELLED" } },
    orderBy: { linkedAt: "desc" },
    include: cardIncludeForCustomer(customerId),
  });
  return links.map(safeCard);
};

export const claimCustomerReward = async ({ customerId, cardId }) => prisma.$transaction(async (tx) => {
  if (!cardId) throw new Error("A card ID is required.");

  const card = await tx.marketingCard.findUnique({
    where: { id: String(cardId) },
    include: {
      orderLink: { include: { order: true } },
      customerLinks: { where: { customerId, status: { not: "CANCELLED" } } },
      benefit: true,
      partner: true,
      assignedPartner: true,
      campaign: { include: { marketingPartner: true } },
    },
  });
  if (!card || card.physicalStatus === "CANCELLED") throw new Error("Card not found or has been cancelled.");
  assertCardCanBeScanned(card);
  if (!card.campaign.isOwnStore) throw new Error("Only Own Store campaign rewards can be claimed online.");
  if (!card.customerLinks.length) throw new Error("Scan and verify this card before claiming its reward.");
  assertCardOrderEligibility(card, customerId, {
    deliveryMessage: "This reward is only available after the related order has been delivered.",
  });
  if (!card.hasBenefit || !card.benefit || !benefitIsValid(card.benefit) || !cardExpiryIsValid(card.campaign)) {
    const error = new Error("This card has no currently claimable reward.");
    error.code = "MARKETING_CARD_REWARD_INVALID";
    throw error;
  }
  if (card.benefit.benefitType !== "DISCOUNT") {
    const error = new Error("Only discount rewards can be claimed for online checkout.");
    error.code = "MARKETING_CARD_REWARD_INVALID";
    throw error;
  }

  const link = card.customerLinks[0];
  const existing = await tx.marketingBenefitRedemption.findUnique({
    where: { cardId_benefitId: { cardId: card.id, benefitId: card.benefit.id } },
  });
  if (existing?.status === "REDEEMED") {
    const error = new Error("This reward has already been redeemed.");
    error.code = "MARKETING_CARD_REWARD_REDEEMED";
    throw error;
  }
  if (existing?.status === "CLAIMED") {
    return {
      cardId: card.id,
      benefitId: card.benefit.id,
      status: "CLAIMED",
      claimedAt: existing.claimedAt,
      alreadyClaimed: true,
    };
  }
  if (existing) {
    const error = new Error("This reward is no longer available.");
    error.code = "MARKETING_CARD_REWARD_INVALID";
    throw error;
  }

  const claimedAt = new Date();
  const redemption = await tx.marketingBenefitRedemption.create({
    data: {
      cardId: card.id,
      benefitId: card.benefit.id,
      customerId,
      status: "CLAIMED",
      claimedAt,
      redeemedAt: null,
    },
  });
  if (link.status !== "ACTIVE" || !link.activatedAt) {
    await tx.marketingCardCustomer.update({
      where: { id: link.id },
      data: { status: "ACTIVE", activatedAt: claimedAt },
    });
  }
  await addEvent(tx, {
    cardId: card.id,
    eventType: "BENEFIT_CLAIMED_BY_CUSTOMER",
    actorId: customerId,
    fromStatus: link.status,
    toStatus: "ACTIVE",
    referenceId: redemption.id,
    metadata: { benefitId: card.benefit.id, benefitName: card.benefit.name },
  });
  return {
    cardId: card.id,
    benefitId: card.benefit.id,
    status: "CLAIMED",
    claimedAt,
    alreadyClaimed: false,
  };
}, { isolationLevel: "Serializable" });

export const listClaimedCustomerRewards = async (customerId) => {
  const redemptions = await prisma.marketingBenefitRedemption.findMany({
    where: {
      customerId,
      status: "CLAIMED",
      card: {
        physicalStatus: { not: "CANCELLED" },
        campaign: { isOwnStore: true },
        customerLinks: { some: { customerId, status: { not: "CANCELLED" } } },
      },
    },
    orderBy: { claimedAt: "desc" },
    include: {
      benefit: true,
      card: {
        include: {
          assignedPartner: true,
          partner: true,
          campaign: { include: { marketingPartner: true } },
        },
      },
    },
  });
  const now = new Date();
  return redemptions
    .filter(({ benefit, card }) => benefitIsValid(benefit, now) && cardExpiryIsValid(card.campaign, now))
    .map(({ id, benefit, card, claimedAt }) => ({
      id,
      cardId: card.id,
      cardCode: card.cardCode,
      campaignId: card.campaign.id,
      campaignName: card.campaign.name,
      assignedOrganization: organizationForCard(card),
      benefit: {
        id: benefit.id,
        name: benefit.name,
        benefitType: benefit.benefitType,
        value: benefit.value,
        description: benefit.description,
        terms: benefit.terms,
        expiresAt: benefit.expiresAt,
      },
      claimedAt,
      expiresAt: benefit.expiresAt || card.campaign.cardExpiresAt,
    }));
};

/**
 * Step 1: Customer enters card code to verify eligibility before QR scan.
 */
export const verifyCustomerCardCode = async ({ customerId, cardCode }) => {
  const normalizedCode = String(cardCode || "").trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length > 64) {
    throw new Error("A valid card code is required.");
  }

  const card = await prisma.marketingCard.findUnique({
    where: { cardCode: normalizedCode },
    include: {
      orderLink: { include: { order: true } },
      customerLinks: { take: 1, select: { id: true } },
      partner: true,
      assignedPartner: true,
      campaign: { include: { marketingPartner: true } },
      benefit: true,
    },
  });

  if (!card || card.physicalStatus === "CANCELLED") {
    throw new Error("Card not found or has been cancelled.");
  }
  assertCardCanBeScanned(card);

  await prisma.marketingCardEvent.create({
    data: {
      cardId: card.id,
      eventType: "CARD_CODE_ENTERED_BY_CUSTOMER",
      actorId: customerId,
      actorRole: "CUSTOMER",
      metadata: { cardCode: card.cardCode, isOwnStore: Boolean(card.campaign.isOwnStore) },
    },
  });
  assertCardNotPreviouslyScanned(card);

  // Partner campaign cards remain tied to their delivered order and customer.
  assertCardOrderEligibility(card, customerId, {
    ownershipMessage: "This card was delivered to a different customer account.",
    deliveryMessage: "This card is only eligible for verification after your order has been delivered.",
  });

  // Allow verification for active campaigns only (campaign must not have ended)
  const isActive = card.campaign.status === "ACTIVE";
  const hasEnded = card.campaign.endsAt && new Date() > new Date(card.campaign.endsAt);
  if (!isActive || hasEnded) {
    throw new Error("This card's campaign is no longer active and cannot accept new verifications.");
  }

  return {
    success: true,
    verified: true,
    cardId: card.id,
    cardCode: card.cardCode,
    partner: partnerForCard(card)
      ? { id: partnerForCard(card).id, name: partnerForCard(card).name, code: partnerForCard(card).code }
      : { id: null, name: organizationForCard(card), code: "OWN" },
    assignedOrganization: organizationForCard(card),
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      isOwnStore: Boolean(card.campaign.isOwnStore),
      maxScansPerCustomer: card.campaign.maxScansPerCustomer,
    },
    isPublic: Boolean(card.isPublic),
    ad: card.campaign.adMediaType && card.campaign.adMediaType !== "NONE" && card.campaign.adMediaUrl ? {
      mediaType: card.campaign.adMediaType,
      mediaUrl: card.campaign.adMediaUrl,
      headline: card.campaign.adHeadline || `${partnerForCard(card)?.name || "Aama Own Store"} Special Offer`,
      description: card.campaign.adDescription || "",
      externalLink: card.campaign.adExternalLink || "",
    } : null,
    message: "Card code verified! Proceed to scan the physical QR code.",
  };
};

/**
 * Step 2: Customer scans QR code; validates that QR token matches the verified card code.
 */
export const verifyCustomerQr = async ({ customerId, cardCode, token }) => {
  const normalizedCode = String(cardCode || "").trim().toUpperCase();
  const rawToken = String(token || "").trim();

  if (!normalizedCode) throw new Error("Card code is required.");
  if (!rawToken) throw new Error("QR token is required.");

  const card = await prisma.marketingCard.findUnique({
    where: { cardCode: normalizedCode },
    include: {
      orderLink: { include: { order: true } },
      customerLinks: { take: 1, select: { id: true } },
      benefit: {
        include: {
          redemptions: { where: { customerId, status: { in: ["CLAIMED", "REDEEMED"] } }, orderBy: { redeemedAt: "desc" }, take: 1 },
        },
      },
      partner: true,
      assignedPartner: true,
      campaign: { include: { marketingPartner: true } },
    },
  });

  if (!card || card.physicalStatus === "CANCELLED") {
    throw new Error("Card not found or has been cancelled.");
  }
  assertCardCanBeScanned(card);

  // Validate QR hash match
  const expectedHash = hashToken(rawToken);
  if (card.qrTokenHash !== expectedHash) {
    throw new Error("The scanned QR code does not match this card code. Please ensure you are scanning the QR code on the correct card.");
  }
  await prisma.marketingCardEvent.create({
    data: {
      cardId: card.id,
      eventType: "CARD_QR_SCAN_ATTEMPTED",
      actorId: customerId,
      actorRole: "CUSTOMER",
      metadata: {
        cardCode: card.cardCode,
        isOwnStore: Boolean(card.campaign.isOwnStore),
        isPublic: Boolean(card.isPublic),
      },
    },
  });

  assertCardNotPreviouslyScanned(card);

  // Partner campaign cards remain tied to their delivered order and customer.
  assertCardOrderEligibility(card, customerId);

  let scanLimits = null;
  const scanWeekIndex = getScanWeekIndex();
  const assignedOrganization = organizationForCard(card);
  let scanResult;
  try {
    scanResult = await prisma.$transaction(async (tx) => {
      const latestCard = await tx.marketingCard.findUnique({
        where: { id: card.id },
        include: {
          orderLink: { include: { order: true } },
          partner: true,
          assignedPartner: true,
          campaign: { include: { marketingPartner: true } },
        },
      });
      if (!latestCard || latestCard.physicalStatus === "CANCELLED") {
        throw new Error("Card not found or has been cancelled.");
      }
      assertCardCanBeScanned(latestCard);
      assertCardOrderEligibility(latestCard, customerId);

      const existingLink = await tx.marketingCardCustomer.findUnique({ where: { cardId: card.id } });
      assertCardNotPreviouslyScanned({ customerLinks: existingLink ? [existingLink] : [] });

      const currentOrganization = organizationForCard(latestCard);
      let quotas = null;
      if (latestCard.campaign.isOwnStore) {
        quotas = await scanQuotaFor({
          client: tx,
          customerId,
          campaignId: latestCard.campaignId,
          assignedOrganization: currentOrganization,
          scanWeekIndex,
          isPublic: latestCard.isPublic,
          maxScansPerCustomer: latestCard.campaign.maxScansPerCustomer,
        });
        assertOwnStoreScanQuota(quotas, currentOrganization);
      }

      const scanClaim = await tx.marketingCard.updateMany({
        where: { id: card.id, exchangeLockRequestId: null },
        data: { updatedAt: new Date() },
      });
      if (scanClaim.count !== 1) assertCardCanBeScanned({ exchangeLockRequestId: "locked" });

      const link = await tx.marketingCardCustomer.create({
        data: {
          cardId: card.id,
          customerId,
          status: "LINKED",
          scannedAt: new Date(),
          assignedOrganization: currentOrganization,
          scanWeekIndex,
        },
      });
      await tx.marketingCardEvent.create({
        data: {
          cardId: card.id,
          eventType: "CARD_SCANNED_BY_CUSTOMER",
          actorId: customerId,
          actorRole: "CUSTOMER",
          referenceId: link.id,
          metadata: {
            cardCode: card.cardCode,
            isOwnStore: Boolean(latestCard.campaign.isOwnStore),
            isPublic: Boolean(latestCard.isPublic),
            assignedOrganization: currentOrganization,
          },
        },
      });
      await tx.marketingCardEvent.create({
        data: {
          cardId: card.id,
          eventType: "CARD_QR_SCANNED_BY_CUSTOMER",
          actorId: customerId,
          actorRole: "CUSTOMER",
          referenceId: link.id,
          metadata: { cardCode: card.cardCode, isPublic: Boolean(latestCard.isPublic) },
        },
      });
      return { link, quotas };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2002" || error.code === "P2034") {
      const existingLink = await prisma.marketingCardCustomer.findUnique({ where: { cardId: card.id } });
      if (existingLink) assertCardNotPreviouslyScanned({ customerLinks: [existingLink] });
    }
    throw error;
  }
  const link = scanResult.link;
  if (card.campaign.isOwnStore) {
    scanLimits = scanResult.quotas
      ? incrementScanLimits(scanResult.quotas)
      : await scanQuotaFor({
          client: prisma,
          customerId,
          campaignId: card.campaignId,
          assignedOrganization,
          scanWeekIndex,
          isPublic: card.isPublic,
          maxScansPerCustomer: card.campaign.maxScansPerCustomer,
        });
  }

  const hasBenefit = Boolean(card.hasBenefit && card.benefit);
  const benefit = hasBenefit ? card.benefit : null;

  return {
    success: true,
    cardId: card.id,
    cardCode: card.cardCode,
    isActivated: link.status === "ACTIVE" && !!link.activatedAt,
    hasBenefit,
    benefit: benefit
      ? {
          id: benefit.id,
          name: benefit.name,
          description: benefit.description,
          benefitType: benefit.benefitType,
          value: benefit.value,
          terms: benefit.terms,
          expiresAt: benefit.expiresAt,
        }
      : null,
    partner: {
      id: partnerForCard(card)?.id || null,
      name: partnerForCard(card)?.name || assignedOrganization,
      code: partnerForCard(card)?.code || "OWN",
    },
    assignedOrganization,
    isPublic: Boolean(card.isPublic),
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      isOwnStore: Boolean(card.campaign.isOwnStore),
      maxScansPerCustomer: card.campaign.maxScansPerCustomer,
    },
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      isOwnStore: Boolean(card.campaign.isOwnStore),
      maxScansPerCustomer: card.campaign.maxScansPerCustomer,
    },
    scanLimits,
    message: hasBenefit
      ? `Congratulations! You unlocked: ${benefit.name}.${card.campaign.isOwnStore ? " Claim it in your customer portal." : ` Activate your card to claim this offer at ${partnerForCard(card)?.name || assignedOrganization}.`}`
      : `Better luck next time! Thank you for participating in ${partnerForCard(card)?.name || assignedOrganization}'s campaign.`,
  };
};

/**
 * Step 3: Customer activates their card with the offer.
 * Note: Customer cannot self-redeem. The card must be taken to the marketing partner's store.
 */
export const activateCustomerCard = async ({ customerId, cardId }) => prisma.$transaction(async (tx) => {
  const card = await tx.marketingCard.findUnique({
    where: { id: cardId },
    include: {
      customerLinks: { where: { customerId, status: { not: "CANCELLED" } } },
      benefit: true,
      campaign: { include: { marketingPartner: true } },
    },
  });

  if (!card || card.physicalStatus === "CANCELLED") {
    throw new Error("Card not found or has been cancelled.");
  }

  if (!card.customerLinks.length) {
    throw new Error("Card must be verified by scanning the QR code before activation.");
  }

  const link = card.customerLinks[0];
  if (link.status === "ACTIVE" && link.activatedAt) {
    return safeCard({ link, card });
  }

  // Check card expiry — campaign can be inactive/cancelled but card can still be activated if not expired
  if (!cardExpiryIsValid(card.campaign)) {
    throw new Error(`This card has expired. The card expiry date was ${new Date(card.campaign.cardExpiresAt).toLocaleDateString()}. No further activation is possible.`);
  }

  const updatedLink = await tx.marketingCardCustomer.update({
    where: { id: link.id },
    data: {
      status: "ACTIVE",
      activatedAt: new Date(),
    },
  });

  await addEvent(tx, {
    cardId: card.id,
    eventType: "CARD_ACTIVATED_BY_CUSTOMER",
    actorId: customerId,
    fromStatus: "LINKED",
    toStatus: "ACTIVE",
    referenceId: updatedLink.id,
    metadata: {
      hasBenefit: card.hasBenefit,
      benefitName: card.benefit?.name || null,
      partnerName: partnerForCard(card)?.name || card.assignedOrganization || "Aama Own Store",
    },
  });

  return safeCard({ link: updatedLink, card });
}, { isolationLevel: "Serializable" });

/**
 * Backward-compatible helper for legacy resolve/link
 */
export const linkCustomerCard = async ({ customerId, cardCode }) => {
  const verify = await verifyCustomerCardCode({ customerId, cardCode });
  return verify;
};

export const resolveCustomerQr = async ({ customerId, token }) => {
  const rawToken = String(token || "").trim();
  const card = await prisma.marketingCard.findUnique({
    where: { qrTokenHash: hashToken(rawToken) },
    include: {
      customerLinks: { take: 1, select: { id: true } },
      benefit: { include: { redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 } } },
      partner: true,
      assignedPartner: true,
      campaign: { include: { marketingPartner: true } },
    },
  });
  if (!card) throw new Error("QR token is invalid.");
  await prisma.marketingCardEvent.create({
    data: {
      cardId: card.id,
      eventType: "CARD_QR_SCAN_ATTEMPTED",
      actorId: customerId,
      actorRole: "CUSTOMER",
      metadata: {
        cardCode: card.cardCode,
        isOwnStore: Boolean(card.campaign.isOwnStore),
        isPublic: Boolean(card.isPublic),
        flow: "DIRECT_QR",
      },
    },
  });
  assertCardCanBeScanned(card);
  assertCardNotPreviouslyScanned(card);
  if (!card.customerLinks.length) {
    throw new Error("Please enter your card code first to verify ownership.");
  }
  await prisma.marketingCardEvent.create({
    data: {
      cardId: card.id,
      eventType: "CARD_QR_SCANNED_BY_CUSTOMER",
      actorId: customerId,
      actorRole: "CUSTOMER",
      referenceId: card.customerLinks[0].id,
      metadata: { cardCode: card.cardCode, isPublic: Boolean(card.isPublic), flow: "DIRECT_QR" },
    },
  });
  return safeCard({ link: card.customerLinks[0], card });
};

export const redeemCustomerBenefit = async () => {
  throw new Error("Customer direct redemption is disabled. Please present your physical card to the partner's shopping store for verification and redemption.");
};
