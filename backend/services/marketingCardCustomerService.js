import crypto from "node:crypto";
import { prisma } from "../config/db.js";

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const isDelivered = (order) => {
  const status = `${String(order?.status || "")} ${String(order?.fulfillmentStatus || "")}`.toLowerCase();
  return status.includes("delivered");
};

const addEvent = (tx, { cardId, eventType, actorId, fromStatus, toStatus, referenceId, metadata }) => tx.marketingCardEvent.create({
  data: { cardId, eventType, actorId, actorRole: "CUSTOMER", fromStatus, toStatus, referenceId, metadata },
});

const campaignWindowIsValid = (campaign, now = new Date()) => {
  if (!campaign || campaign.status !== "ACTIVE") return false;
  if (campaign.startsAt && campaign.startsAt > now) return false;
  if (campaign.endsAt && campaign.endsAt < now) return false;
  return true;
};

const benefitIsValid = (benefit, now = new Date()) => (
  benefit.status === "ACTIVE" &&
  (!benefit.startsAt || benefit.startsAt <= now) &&
  (!benefit.expiresAt || benefit.expiresAt >= now)
);

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
          status: benefit.redemptions && benefit.redemptions.length ? "REDEEMED" : benefit.status,
          redeemedAt: benefit.redemptions?.[0]?.redeemedAt || null,
        },
      ]
    : [];

  return {
    id: card.id,
    cardCode: card.cardCode,
    status: link.status,
    linkedAt: link.linkedAt,
    activatedAt: link.activatedAt,
    isActivated: link.status === "ACTIVE" && !!link.activatedAt,
    hasBenefit,
    benefitMessage: hasBenefit
      ? "Congratulations! You have an exclusive reward."
      : "Better luck next time!",
    partner: {
      id: card.campaign.marketingPartner.id,
      name: card.campaign.marketingPartner.name,
      code: card.campaign.marketingPartner.code,
    },
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
      targetScopeType: card.campaign.targetScopeType,
      targetProvince: card.campaign.targetProvince,
      targetDistrict: card.campaign.targetDistrict,
      startsAt: card.campaign.startsAt,
      endsAt: card.campaign.endsAt,
    },
    benefits,
  };
};

const cardIncludeForCustomer = (customerId) => ({
  card: {
    include: {
      benefit: {
        include: {
          redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 },
        },
      },
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
      customerLinks: { where: { status: { not: "CANCELLED" } } },
      campaign: { include: { marketingPartner: true } },
      benefit: true,
    },
  });

  if (!card || card.physicalStatus === "CANCELLED") {
    throw new Error("Card not found or has been cancelled.");
  }

  // Enforce order delivery and customer ownership
  if (card.orderLink?.order?.userId && card.orderLink.order.userId !== customerId) {
    const error = new Error("This card was delivered to a different customer account.");
    error.code = "MARKETING_CARD_FORBIDDEN";
    throw error;
  }

  if (!card.orderLink?.order || !isDelivered(card.orderLink.order)) {
    const error = new Error("This card is only eligible for verification after your order has been delivered.");
    error.code = "MARKETING_CARD_NOT_ELIGIBLE";
    throw error;
  }

  if (!campaignWindowIsValid(card.campaign)) {
    throw new Error("This card campaign is not currently active.");
  }

  if (card.customerLinks.length && card.customerLinks[0].customerId !== customerId) {
    throw new Error("This card is already linked to another customer.");
  }

  return {
    success: true,
    verified: true,
    cardId: card.id,
    cardCode: card.cardCode,
    partner: {
      id: card.campaign.marketingPartner.id,
      name: card.campaign.marketingPartner.name,
      code: card.campaign.marketingPartner.code,
    },
    campaign: {
      id: card.campaign.id,
      name: card.campaign.name,
    },
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
      customerLinks: { where: { customerId, status: { not: "CANCELLED" } } },
      benefit: {
        include: {
          redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 },
        },
      },
      campaign: { include: { marketingPartner: true } },
    },
  });

  if (!card) throw new Error("Card not found.");

  // Validate QR hash match
  const expectedHash = hashToken(rawToken);
  if (card.qrTokenHash !== expectedHash) {
    throw new Error("The scanned QR code does not match this card code. Please ensure you are scanning the QR code on the correct card.");
  }

  // Ensure card ownership and delivery
  if (card.orderLink?.order?.userId && card.orderLink.order.userId !== customerId) {
    const error = new Error("This card does not belong to this customer account.");
    error.code = "MARKETING_CARD_FORBIDDEN";
    throw error;
  }

  if (!card.orderLink?.order || !isDelivered(card.orderLink.order)) {
    throw new Error("This card is not eligible because the related order is not marked as delivered.");
  }

  // Link card to customer if not yet linked
  let link = card.customerLinks[0];
  if (!link) {
    link = await prisma.marketingCardCustomer.create({
      data: {
        cardId: card.id,
        customerId,
        status: "LINKED",
      },
    });
    await prisma.marketingCardEvent.create({
      data: {
        cardId: card.id,
        eventType: "CARD_SCANNED_BY_CUSTOMER",
        actorId: customerId,
        actorRole: "CUSTOMER",
        referenceId: link.id,
      },
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
      id: card.campaign.marketingPartner.id,
      name: card.campaign.marketingPartner.name,
      code: card.campaign.marketingPartner.code,
    },
    message: hasBenefit
      ? `Congratulations! You unlocked: ${benefit.name}. Activate your card to claim this offer at ${card.campaign.marketingPartner.name}.`
      : "🍀 Better luck next time! Thank you for participating in our brand partner campaign.",
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

  if (!card) throw new Error("Card not found.");

  if (!card.customerLinks.length) {
    throw new Error("Card must be verified by scanning the QR code before activation.");
  }

  const link = card.customerLinks[0];
  if (link.status === "ACTIVE" && link.activatedAt) {
    return safeCard({ link, card });
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
      partnerName: card.campaign.marketingPartner.name,
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
      customerLinks: { where: { customerId, status: { not: "CANCELLED" } } },
      benefit: { include: { redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 } } },
      campaign: { include: { marketingPartner: true } },
    },
  });
  if (!card) throw new Error("QR token is invalid.");
  if (!card.customerLinks.length) {
    throw new Error("Please enter your card code first to verify ownership.");
  }
  return safeCard({ link: card.customerLinks[0], card });
};

export const redeemCustomerBenefit = async () => {
  throw new Error("Customer direct redemption is disabled. Please present your physical card to the partner's shopping store for verification and redemption.");
};
