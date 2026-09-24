import crypto from "node:crypto";
import { prisma } from "../config/db.js";

const MAX_BATCH_SIZE = 5000;
const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE"]);

const normalizeCode = (value, fallback = "AAMA") => {
  const code = String(value || fallback).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.slice(0, 16) || fallback;
};

const geographyCode = (campaign) => {
  if (campaign.targetScopeType === "PROVINCE") return normalizeCode(campaign.targetProvince, "PRO").slice(0, 3);
  if (campaign.targetScopeType === "DISTRICT") return normalizeCode(campaign.targetDistrict, "DIS").slice(0, 3);
  return "NAT";
};

const secureToken = () => crypto.randomBytes(32).toString("hex");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const randomBatchSuffix = () => crypto.randomBytes(4).toString("hex").toUpperCase();

const addEvent = (tx, { cardId, eventType, actorId, actorRole, fromStatus, toStatus, referenceId, metadata }) => tx.marketingCardEvent.create({
  data: { cardId, eventType, actorId, actorRole, fromStatus, toStatus, referenceId, metadata },
});

const assertQuantity = (quantity) => {
  const parsed = Number(quantity);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    const error = new Error(`Quantity must be an integer between 1 and ${MAX_BATCH_SIZE}.`);
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  return parsed;
};

export const createPartner = ({ code, name, description }) => prisma.marketingPartner.create({
  data: { code: normalizeCode(code), name: String(name || "").trim(), description: description || null },
});

export const listPartners = () => prisma.marketingPartner.findMany({ orderBy: { createdAt: "desc" } });

export const createCampaign = async ({ marketingPartnerId, name, description, targetScopeType, targetProvince, targetDistrict, requestedQuantity, benefitConfig, startsAt, endsAt }) => {
  const partner = await prisma.marketingPartner.findUnique({ where: { id: marketingPartnerId } });
  if (!partner || partner.status !== "ACTIVE") throw new Error("Active marketing partner not found.");
  const scope = String(targetScopeType || "NATIONWIDE").toUpperCase();
  if (!["NATIONWIDE", "PROVINCE", "DISTRICT"].includes(scope)) throw new Error("Invalid campaign targeting scope.");
  if (scope === "PROVINCE" && !String(targetProvince || "").trim()) throw new Error("Province is required for province campaigns.");
  if (scope === "DISTRICT" && !String(targetDistrict || "").trim()) throw new Error("District is required for district campaigns.");
  const requested = requestedQuantity === undefined || requestedQuantity === "" ? 0 : Number(requestedQuantity);
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_BATCH_SIZE) throw new Error(`Requested quantity must be an integer between 0 and ${MAX_BATCH_SIZE}.`);
  return prisma.marketingCampaign.create({
    data: {
      marketingPartnerId,
      name: String(name || "").trim(),
      description: description || null,
      targetScopeType: scope,
      targetProvince: targetProvince || null,
      targetDistrict: targetDistrict || null,
      requestedQuantity: requested,
      benefitConfig: Array.isArray(benefitConfig) ? benefitConfig : [],
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    },
    include: { marketingPartner: true },
  });
};

export const listCampaigns = () => prisma.marketingCampaign.findMany({
  orderBy: { createdAt: "desc" },
  include: { marketingPartner: true, _count: { select: { cards: true, batches: true } } },
});

export const generateBatch = async ({ campaignId, quantity, actorId }) => {
  const count = assertQuantity(quantity);
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, include: { marketingPartner: true } });
  if (!campaign) throw new Error("Campaign not found.");
  if (!ACTIVE_CAMPAIGN_STATUSES.has(campaign.status)) throw new Error("Only active campaigns can generate cards.");

  const batchCode = `${normalizeCode(campaign.marketingPartner.code)}-${geographyCode(campaign)}-${Date.now()}-${randomBatchSuffix()}`;
  const batchSegment = randomBatchSuffix().slice(0, 4);
  const created = await prisma.$transaction(async (tx) => {
    const batch = await tx.marketingCardBatch.create({ data: { campaignId, batchCode, quantity: count } });
    const cards = [];
    for (let index = 1; index <= count; index += 1) {
      const token = secureToken();
      const serial = String(campaign.generatedQuantity + index).padStart(5, "0");
      const cardCode = `AAMA-${geographyCode(campaign)}-${normalizeCode(campaign.marketingPartner.code).slice(0, 3)}-${batchSegment}B${serial}`;
      const card = await tx.marketingCard.create({
        data: {
          cardCode,
          qrTokenHash: hashToken(token),
          partnerId: campaign.marketingPartnerId,
          campaignId,
          batchId: batch.id,
        },
      });
      await addEvent(tx, { cardId: card.id, eventType: "CARD_CREATED", actorId, actorRole: "ADMIN", toStatus: "GENERATED", metadata: { batchId: batch.id } });
      cards.push({ id: card.id, cardCode: card.cardCode, qrToken: token });
    }
    await tx.marketingCampaign.update({ where: { id: campaignId }, data: { generatedQuantity: { increment: count } } });
    return { batch, cards };
  }, { isolationLevel: "Serializable" });
  return created;
};

export const listAdminCards = ({ campaignId, manufacturerId, status } = {}) => prisma.marketingCard.findMany({
  where: {
    ...(campaignId ? { campaignId } : {}),
    ...(manufacturerId ? { assignedManufacturerId: manufacturerId } : {}),
    ...(status && status !== "all" ? { physicalStatus: status } : {}),
  },
  orderBy: { createdAt: "desc" },
  take: 500,
  include: { campaign: { include: { marketingPartner: true } }, batch: true, assignedManufacturer: { select: { id: true, name: true, city: true } } },
});

export const assignCards = async ({ campaignId, manufacturerId, quantity, cardIds, actorId }) => {
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  if (!manufacturer || !manufacturer.isActive) throw new Error("Active manufacturer not found.");
  const requestedIds = Array.isArray(cardIds) && cardIds.length ? cardIds : null;
  const count = requestedIds ? requestedIds.length : assertQuantity(quantity);

  return prisma.$transaction(async (tx) => {
    const cards = await tx.marketingCard.findMany({
      where: {
        campaignId,
        physicalStatus: "GENERATED",
        ...(requestedIds ? { id: { in: requestedIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: count,
    });
    if (cards.length !== count) throw new Error("Not enough unassigned cards are available for this assignment.");

    const assignments = [];
    for (const card of cards) {
      const changed = await tx.marketingCard.updateMany({
        where: { id: card.id, physicalStatus: "GENERATED", assignedManufacturerId: null },
        data: { assignedManufacturerId: manufacturerId, physicalStatus: "ASSIGNED", assignedAt: new Date() },
      });
      if (changed.count !== 1) throw new Error("Card inventory changed during assignment. Please retry.");
      const assignment = await tx.marketingCardAssignment.create({ data: { cardId: card.id, manufacturerId, assignedBy: actorId } });
      await addEvent(tx, { cardId: card.id, eventType: "CARD_ASSIGNED_TO_MANUFACTURER", actorId, actorRole: "ADMIN", fromStatus: "GENERATED", toStatus: "ASSIGNED", referenceId: assignment.id, metadata: { manufacturerId } });
      assignments.push(assignment);
    }
    await tx.marketingCardBatch.updateMany({ where: { id: { in: cards.map((card) => card.batchId) } }, data: { status: "ASSIGNED" } });
    return { count: assignments.length, assignments };
  }, { isolationLevel: "Serializable" });
};

export const getManufacturerInventory = ({ manufacturerId, status }) => prisma.marketingCard.findMany({
  where: {
    assignedManufacturerId: manufacturerId,
    ...(status && status !== "all" ? { physicalStatus: status } : {}),
  },
  orderBy: { assignedAt: "desc" },
  include: { campaign: { include: { marketingPartner: true } }, batch: true, orderLink: true, assignments: { orderBy: { assignedAt: "desc" }, take: 1, include: { receipt: true } } },
});

export const receiveCard = async ({ cardId, manufacturerId, notes }) => prisma.$transaction(async (tx) => {
  const card = await tx.marketingCard.findUnique({ where: { id: cardId }, include: { assignments: { orderBy: { assignedAt: "desc" }, take: 1 } } });
  const assignment = card?.assignments?.[0];
  if (!card || !assignment || assignment.manufacturerId !== manufacturerId) throw new Error("Assigned card not found.");
  if (card.physicalStatus === "AVAILABLE") return card;
  if (card.physicalStatus !== "ASSIGNED") throw new Error("Only assigned cards can be received.");
  await tx.marketingCardReceipt.create({ data: { assignmentId: assignment.id, confirmedBy: manufacturerId, notes: notes || null } });
  const updated = await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "AVAILABLE", receivedAt: new Date() } });
  await tx.marketingCardAssignment.update({ where: { id: assignment.id }, data: { status: "RECEIVED", confirmedAt: new Date(), notes: notes || assignment.notes } });
  await addEvent(tx, { cardId: card.id, eventType: "CARD_RECEIPT_CONFIRMED", actorId: manufacturerId, actorRole: "MANUFACTURER", fromStatus: "ASSIGNED", toStatus: "AVAILABLE", referenceId: assignment.id });
  return updated;
});

export const attachRandomCardToOrder = async ({ orderId, manufacturerId }) => prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { marketingCardOrder: true } });
  if (!order || order.manufacturerId !== manufacturerId) throw new Error("Order not found or unauthorized.");
  if (!order.marketingCardRequired) throw new Error("This order does not require a marketing card.");
  if (order.marketingCardOrder) return order.marketingCardOrder;
  const assignment = await tx.orderAssignment.findUnique({ where: { orderId } });
  if (!assignment || assignment.manufacturerId !== manufacturerId) throw new Error("Manufacturer assignment not found.");

  const inventory = await tx.marketingCard.findMany({
    where: { assignedManufacturerId: manufacturerId, physicalStatus: "AVAILABLE", assignments: { some: { manufacturerId, status: "RECEIVED", receipt: { isNot: null } } } },
    select: { id: true, physicalStatus: true },
    take: 500,
  });
  if (!inventory.length) throw new Error("No received marketing cards are available for this manufacturer.");
  const selected = inventory[crypto.randomInt(inventory.length)];
  const claimed = await tx.marketingCard.updateMany({ where: { id: selected.id, assignedManufacturerId: manufacturerId, physicalStatus: "AVAILABLE" }, data: { physicalStatus: "ATTACHED", reservedAt: new Date(), attachedAt: new Date() } });
  if (claimed.count !== 1) throw new Error("Card inventory changed during attachment. Please retry.");
  const link = await tx.marketingCardOrder.create({ data: { cardId: selected.id, orderId, manufacturerId } });
  await addEvent(tx, { cardId: selected.id, eventType: "CARD_ATTACHED_TO_ORDER", actorId: manufacturerId, actorRole: "MANUFACTURER", fromStatus: "AVAILABLE", toStatus: "ATTACHED", referenceId: orderId });
  return tx.marketingCardOrder.findUnique({ where: { id: link.id }, include: { card: true } });
}, { isolationLevel: "Serializable" });

export const ensureOrderCardAttached = async ({ tx = prisma, orderId, manufacturerId }) => {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { marketingCardOrder: true } });
  if (!order || order.manufacturerId !== manufacturerId) throw new Error("Order not found or unauthorized.");
  if (order.marketingCardRequired && !order.marketingCardOrder) {
    const error = new Error("A marketing card must be attached before delivery handoff.");
    error.code = "MARKETING_CARD_REQUIRED";
    throw error;
  }
  return order.marketingCardOrder;
};

export const cardTokenHash = hashToken;
