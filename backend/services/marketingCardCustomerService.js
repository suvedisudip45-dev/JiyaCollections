import crypto from "node:crypto";
import { prisma } from "../config/db.js";

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const isDelivered = (order) => {
  const status = `${String(order?.status || "")} ${String(order?.fulfillmentStatus || "")}`.toLowerCase();
  return status.includes("delivered");
};

const addEvent = (tx, { cardId, eventType, actorId, fromStatus, toStatus, referenceId }) => tx.marketingCardEvent.create({
  data: { cardId, eventType, actorId, actorRole: "CUSTOMER", fromStatus, toStatus, referenceId },
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

const safeCard = (link) => ({
  id: link.card.id,
  cardCode: link.card.cardCode,
  status: link.status,
  linkedAt: link.linkedAt,
  activatedAt: link.activatedAt,
  partner: { id: link.card.campaign.marketingPartner.id, name: link.card.campaign.marketingPartner.name },
  campaign: {
    id: link.card.campaign.id,
    name: link.card.campaign.name,
    targetScopeType: link.card.campaign.targetScopeType,
    targetProvince: link.card.campaign.targetProvince,
    targetDistrict: link.card.campaign.targetDistrict,
    startsAt: link.card.campaign.startsAt,
    endsAt: link.card.campaign.endsAt,
  },
  benefits: link.card.campaign.benefits.map((benefit) => ({
    id: benefit.id,
    name: benefit.name,
    description: benefit.description,
    benefitType: benefit.benefitType,
    value: benefit.value,
    terms: benefit.terms,
    startsAt: benefit.startsAt,
    expiresAt: benefit.expiresAt,
    status: benefit.redemptions.length ? "REDEEMED" : benefit.status,
    redeemedAt: benefit.redemptions[0]?.redeemedAt || null,
  })),
});

const cardIncludeForCustomer = (customerId) => ({
  card: {
    include: {
      campaign: { include: { marketingPartner: true, benefits: { include: { redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 } } } } },
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

export const linkCustomerCard = async ({ customerId, cardCode }) => prisma.$transaction(async (tx) => {
  const normalizedCode = String(cardCode || "").trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length > 64) throw new Error("A valid card code is required.");
  const card = await tx.marketingCard.findUnique({
    where: { cardCode: normalizedCode },
    include: {
      orderLink: { include: { order: true } },
      customerLinks: { where: { status: { not: "CANCELLED" } } },
      campaign: { include: { marketingPartner: true, benefits: { include: { redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 } } } } },
    },
  });
  if (!card || card.physicalStatus === "CANCELLED") throw new Error("Card not found or cancelled.");
  if (!card.orderLink?.order || card.orderLink.order.userId !== customerId || !isDelivered(card.orderLink.order)) {
    throw new Error("This card is not eligible for activation by this customer.");
  }
  if (!campaignWindowIsValid(card.campaign)) throw new Error("This card campaign is not currently active.");
  if (card.customerLinks.length && card.customerLinks[0].customerId !== customerId) throw new Error("This card is already linked to another customer.");
  const existing = card.customerLinks.find((link) => link.customerId === customerId);
  if (existing) return safeCard({ ...existing, card });

  const link = await tx.marketingCardCustomer.create({ data: { cardId: card.id, customerId, status: "ACTIVE", activatedAt: new Date() } });
  await addEvent(tx, { cardId: card.id, eventType: "CARD_LINKED_TO_CUSTOMER", actorId: customerId, fromStatus: card.physicalStatus, toStatus: card.physicalStatus, referenceId: link.id });
  return safeCard({ link, card });
}, { isolationLevel: "Serializable" });

export const resolveCustomerQr = async ({ customerId, token }) => {
  const rawToken = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) throw new Error("Invalid QR token.");
  const card = await prisma.marketingCard.findUnique({
    where: { qrTokenHash: hashToken(rawToken) },
    include: {
      customerLinks: { where: { customerId, status: { not: "CANCELLED" } } },
      campaign: { include: { marketingPartner: true, benefits: { include: { redemptions: { where: { customerId, status: "REDEEMED" }, take: 1 } } } } },
    },
  });
  if (!card || !card.customerLinks.length || card.physicalStatus === "CANCELLED") throw new Error("QR token is invalid or not available to this customer.");
  return safeCard({ link: card.customerLinks[0], card });
};

export const redeemCustomerBenefit = async ({ customerId, cardId, benefitId }) => prisma.$transaction(async (tx) => {
  const link = await tx.marketingCardCustomer.findFirst({ where: { cardId, customerId, status: { not: "CANCELLED" } } });
  if (!link) throw new Error("Card is not linked to this customer.");
  const benefit = await tx.marketingBenefit.findUnique({ where: { id: benefitId }, include: { campaign: true } });
  const card = await tx.marketingCard.findUnique({ where: { id: cardId }, include: { campaign: true } });
  if (!benefit || !card || benefit.campaignId !== card.campaignId || !campaignWindowIsValid(card.campaign)) throw new Error("Benefit is not eligible.");
  if (!benefitIsValid(benefit)) throw new Error("This benefit is expired or unavailable.");
  const redemption = await tx.marketingBenefitRedemption.create({ data: { cardId, benefitId, customerId } });
  await addEvent(tx, { cardId, eventType: "BENEFIT_REDEEMED", actorId: customerId, referenceId: redemption.id });
  return redemption;
}, { isolationLevel: "Serializable" });
EOF