import crypto from "node:crypto";
import { prisma } from "../config/db.js";
import {
  NEPAL_LOCATION_MAP,
  NEPAL_PROVINCES,
  get4CharCodeForCampaign,
  resolveLocationEntry,
} from "../utils/nepalLocationData.js";

const MAX_BATCH_SIZE = 5000;
const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE"]);

/** Returns true if the campaign is still accepting new card-to-order attachments (not expired/cancelled). */
const isCampaignAcceptingOrders = (campaign) => {
  if (!ACTIVE_CAMPAIGN_STATUSES.has(campaign.status)) return false;
  if (campaign.endsAt && new Date() > new Date(campaign.endsAt)) return false;
  return true;
};

/** Returns true if a card from this campaign can still be redeemed by a customer (card hasn't expired). */
export const isCampaignCardRedeemable = (campaign) => {
  if (campaign.cardExpiresAt && new Date() > new Date(campaign.cardExpiresAt)) return false;
  return true;
};

const normalizeCode = (value, fallback = "AAMA") => {
  const code = String(value || fallback).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.slice(0, 16) || fallback;
};

const geographyCode = (campaign) => get4CharCodeForCampaign(campaign);

const secureToken = () => crypto.randomBytes(32).toString("hex");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const randomBatchSuffix = () => crypto.randomBytes(4).toString("hex").toUpperCase();
const normalizeLocation = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const parseJsonObject = (value) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};

export const getOrderLocationCodes = (order) => {
  const address = parseJsonObject(order.address);
  const districtRaw = address.district || address.city;
  const provinceRaw = address.province || address.state;

  const districtLoc = resolveLocationEntry(districtRaw);
  const provinceLoc = resolveLocationEntry(provinceRaw) || (districtLoc?.province ? resolveLocationEntry(districtLoc.province) : null);

  return {
    districtCode: districtLoc?.code || null,
    districtName: districtLoc?.name || districtRaw,
    provinceCode: provinceLoc?.code || null,
    provinceName: provinceLoc?.name || provinceRaw,
    rawDistrict: districtRaw,
    rawProvince: provinceRaw,
  };
};

export const campaignMatchesOrder = (campaign, order) => {
  if (campaign.targetScopeType === "NATIONWIDE") return true;
  const loc = getOrderLocationCodes(order);

  if (campaign.targetScopeType === "PROVINCE") {
    const campaignProv = resolveLocationEntry(campaign.targetProvince);
    if (campaignProv && loc.provinceCode) {
      return campaignProv.code === loc.provinceCode;
    }
    return normalizeLocation(campaign.targetProvince) === normalizeLocation(loc.provinceName || loc.rawProvince);
  }

  if (campaign.targetScopeType === "DISTRICT") {
    const campaignDist = resolveLocationEntry(campaign.targetDistrict);
    if (campaignDist && loc.districtCode) {
      return campaignDist.code === loc.districtCode;
    }
    return normalizeLocation(campaign.targetDistrict) === normalizeLocation(loc.districtName || loc.rawDistrict);
  }

  return false;
};

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

export const createPartner = async ({ code, name, description, email, password, contactPhone, website, address }) => {
  let passwordHash = null;
  if (password) {
    const bcrypt = await import("bcryptjs");
    passwordHash = await bcrypt.default.hash(String(password), 10);
  }
  return prisma.marketingPartner.create({
    data: {
      code: normalizeCode(code),
      name: String(name || "").trim(),
      description: description || null,
      email: email ? String(email).trim().toLowerCase() : null,
      passwordHash,
      contactPhone: contactPhone || null,
      website: website || null,
      address: address || null,
    },
  });
};

export const listPartners = () => prisma.marketingPartner.findMany({ orderBy: { createdAt: "desc" } });


export const createCampaign = async ({ marketingPartnerId, name, description, targetScopeType, targetProvince, targetDistrict, requestedQuantity, benefitConfig, benefits, startsAt, endsAt, cardExpiresAt }) => {
  const partner = await prisma.marketingPartner.findUnique({ where: { id: marketingPartnerId } });
  if (!partner || partner.status !== "ACTIVE") throw new Error("Active marketing partner not found.");
  const scope = String(targetScopeType || "NATIONWIDE").toUpperCase();
  if (!["NATIONWIDE", "PROVINCE", "DISTRICT"].includes(scope)) throw new Error("Invalid campaign targeting scope.");
  if (scope === "PROVINCE" && !String(targetProvince || "").trim()) throw new Error("Province is required for province campaigns.");
  if (scope === "DISTRICT" && !String(targetDistrict || "").trim()) throw new Error("District is required for district campaigns.");
  const requested = requestedQuantity === undefined || requestedQuantity === "" ? 0 : Number(requestedQuantity);
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_BATCH_SIZE) throw new Error(`Requested quantity must be an integer between 0 and ${MAX_BATCH_SIZE}.`);

  // Validate dates: cardExpiresAt must be at least 1 day after endsAt
  const parsedEndsAt = endsAt ? new Date(endsAt) : null;
  const parsedCardExpiresAt = cardExpiresAt ? new Date(cardExpiresAt) : null;
  if (parsedEndsAt && isNaN(parsedEndsAt.getTime())) throw new Error("Invalid campaign end date.");
  if (parsedCardExpiresAt && isNaN(parsedCardExpiresAt.getTime())) throw new Error("Invalid card expiry date.");
  if (parsedEndsAt && parsedCardExpiresAt) {
    const minCardExpiry = new Date(parsedEndsAt.getTime() + 24 * 60 * 60 * 1000); // +1 day
    if (parsedCardExpiresAt < minCardExpiry) {
      throw new Error("Card expiry date must be at least 1 day after the campaign end date.");
    }
  }

  const campaignBenefits = (Array.isArray(benefits) ? benefits : []).filter((benefit) => String(benefit?.name || "").trim()).map((benefit) => ({
    name: String(benefit.name).trim(),
    description: benefit.description || null,
    benefitType: String(benefit.benefitType || "CUSTOM").toUpperCase(),
    value: Number(benefit.value || 0),
    percentage: Number(benefit.percentage || 0),
    quantity: Number(benefit.quantity || benefit.maxQuantity || 0),
    terms: benefit.terms || null,
    startsAt: benefit.startsAt ? new Date(benefit.startsAt) : null,
    expiresAt: benefit.expiresAt ? new Date(benefit.expiresAt) : null,
  }));
  if (campaignBenefits.some((benefit) => !Number.isFinite(benefit.value) || benefit.value < 0)) throw new Error("Benefit value must be a non-negative number.");
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.marketingCampaign.create({
      data: {
        marketingPartnerId,
        name: String(name || "").trim(),
        description: description || null,
        targetScopeType: scope,
        targetProvince: targetProvince || null,
        targetDistrict: targetDistrict || null,
        requestedQuantity: requested,
        benefitConfig: Array.isArray(benefitConfig) ? benefitConfig : campaignBenefits,
        startsAt: parsedEndsAt ? new Date(startsAt) : (startsAt ? new Date(startsAt) : null),
        endsAt: parsedEndsAt,
        cardExpiresAt: parsedCardExpiresAt,
      },
    });
    if (campaignBenefits.length) await tx.marketingBenefit.createMany({ data: campaignBenefits.map((benefit) => ({ ...benefit, campaignId: campaign.id })) });
    return tx.marketingCampaign.findUnique({ where: { id: campaign.id }, include: { marketingPartner: true, benefits: true } });
  });
};

/**
 * Deactivate a campaign (set to CANCELLED status).
 * Cards already with customers remain redeemable until cardExpiresAt.
 * No new cards can be attached to orders after deactivation.
 */
export const deactivateCampaign = async ({ campaignId, actorId, reason }) => {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "CANCELLED") throw new Error("Campaign is already cancelled.");
  return prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: { status: "CANCELLED", endsAt: campaign.endsAt || new Date() },
    include: { marketingPartner: true, benefits: true, _count: { select: { cards: true } } },
  });
};

export const listCampaigns = () => prisma.marketingCampaign.findMany({
  orderBy: { createdAt: "desc" },
  include: { marketingPartner: true, benefits: true, _count: { select: { cards: true, batches: true } } },
});

export const generateBatch = async ({ campaignId, quantity, actorId }) => {
  const count = assertQuantity(quantity);
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, include: { marketingPartner: true, benefits: true } });
  if (!campaign) throw new Error("Campaign not found.");
  if (!ACTIVE_CAMPAIGN_STATUSES.has(campaign.status)) throw new Error("Only active campaigns can generate cards.");

  const batchCode = `${normalizeCode(campaign.marketingPartner.code)}-${geographyCode(campaign)}-${Date.now()}-${randomBatchSuffix()}`;
  const batchSegment = randomBatchSuffix().slice(0, 4);
  const created = await prisma.$transaction(async (tx) => {
    const batch = await tx.marketingCardBatch.create({ data: { campaignId, batchCode, quantity: count } });

    // Fetch active benefits to allocate to cards in this batch
    const activeBenefits = await tx.marketingBenefit.findMany({
      where: { campaignId, status: "ACTIVE" },
      orderBy: { id: "asc" },
    });

    // Build array of benefit assignments for this batch
    const benefitAssignments = [];
    for (const benefit of activeBenefits) {
      let targetCount = 0;
      if (benefit.percentage && benefit.percentage > 0) {
        // Percentage-based offer allocation (e.g. 10% of 500 = 50 cards)
        targetCount = Math.round((Number(benefit.percentage) / 100) * count);
      } else if (benefit.quantity && benefit.quantity > 0) {
        // Fixed quantity offer allocation
        const unassigned = Math.max(0, benefit.quantity - (benefit.assignedQuantity || 0));
        targetCount = unassigned;
      }

      const toAssign = Math.min(count - benefitAssignments.length, targetCount);
      for (let i = 0; i < toAssign; i++) {
        benefitAssignments.push(benefit.id);
      }
      if (toAssign > 0) {
        await tx.marketingBenefit.update({
          where: { id: benefit.id },
          data: { assignedQuantity: { increment: toAssign } },
        });
      }
    }

    // Fill remaining cards in the batch with null (non-winning cards: "Better luck next time")
    while (benefitAssignments.length < count) {
      benefitAssignments.push(null);
    }

    // Randomly shuffle benefit assignments across the batch (Fisher-Yates shuffle)
    for (let i = benefitAssignments.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      const temp = benefitAssignments[i];
      benefitAssignments[i] = benefitAssignments[j];
      benefitAssignments[j] = temp;
    }

    const cards = [];
    for (let index = 1; index <= count; index += 1) {
      const token = secureToken();
      const serial = String(campaign.generatedQuantity + index).padStart(5, "0");
      const cardCode = `AAMA-${geographyCode(campaign)}-${normalizeCode(campaign.marketingPartner.code).slice(0, 3)}-${batchSegment}B${serial}`;
      const assignedBenefitId = benefitAssignments[index - 1] || null;

      const card = await tx.marketingCard.create({
        data: {
          cardCode,
          qrTokenHash: hashToken(token),
          partnerId: campaign.marketingPartnerId,
          campaignId,
          batchId: batch.id,
          hasBenefit: !!assignedBenefitId,
          benefitId: assignedBenefitId,
        },
      });
      await addEvent(tx, { cardId: card.id, eventType: "CARD_CREATED", actorId, actorRole: "ADMIN", toStatus: "GENERATED", metadata: { batchId: batch.id, hasBenefit: !!assignedBenefitId, benefitId: assignedBenefitId } });
      cards.push({ id: card.id, cardCode: card.cardCode, qrToken: token, hasBenefit: !!assignedBenefitId });
    }
    await tx.marketingCampaign.update({ where: { id: campaignId }, data: { generatedQuantity: { increment: count } } });
    return { batch, cards };
  }, { isolationLevel: "Serializable" });
  return created;
};

export const listAdminCards = async ({ partnerId, campaignId, manufacturerId, status, page = 1, pageSize = 50, search } = {}) => {
  const where = {
    ...(campaignId ? { campaignId } : {}),
    ...(partnerId && !campaignId ? { campaign: { marketingPartnerId: partnerId } } : {}),
    ...(manufacturerId ? { assignedManufacturerId: manufacturerId } : {}),
    ...(status && status !== "all" ? { physicalStatus: status } : {}),
    ...(search ? { cardCode: { contains: search } } : {}),
  };
  const skip = (Math.max(1, Number(page)) - 1) * Number(pageSize);
  const take = Math.min(200, Math.max(1, Number(pageSize)));
  const [cards, total] = await Promise.all([
    prisma.marketingCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        campaign: { include: { marketingPartner: true } },
        benefit: true,
        batch: true,
        assignedManufacturer: { select: { id: true, name: true, city: true } },
      },
    }),
    prisma.marketingCard.count({ where }),
  ]);
  return { cards, total, page: Number(page), pageSize: take, totalPages: Math.ceil(total / take) };
};

export const getAdminCardStats = async () => {
  const [
    partnerStats,
    campaignStats,
    manufacturerStats,
    statusBreakdown,
  ] = await Promise.all([
    // Per-partner: total generated, attached, cancelled
    prisma.marketingCard.groupBy({
      by: ["partnerId"],
      _count: { _all: true },
    }),
    // Per-campaign: total, attached, cancelled, activated
    prisma.marketingCampaign.findMany({
      include: {
        marketingPartner: { select: { id: true, name: true, code: true } },
        _count: { select: { cards: true, batches: true } },
        benefits: { select: { id: true, name: true, assignedQuantity: true, quantity: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Per-manufacturer: assigned, received, attached, cancelled
    prisma.marketingCard.groupBy({
      by: ["assignedManufacturerId", "physicalStatus"],
      where: { assignedManufacturerId: { not: null } },
      _count: { _all: true },
    }),
    // Global status breakdown
    prisma.marketingCard.groupBy({
      by: ["physicalStatus"],
      _count: { _all: true },
    }),
  ]);

  // Partner lookup
  const allPartners = await prisma.marketingPartner.findMany({ select: { id: true, name: true, code: true, status: true } });
  const partnerMap = Object.fromEntries(allPartners.map((p) => [p.id, p]));

  // Enrich partner stats
  const partnerBreakdown = await Promise.all(allPartners.map(async (partner) => {
    const rows = await prisma.marketingCard.groupBy({
      by: ["physicalStatus"],
      where: { partnerId: partner.id },
      _count: { _all: true },
    });
    const statusMap = Object.fromEntries(rows.map((r) => [r.physicalStatus, r._count._all]));
    const total = Object.values(statusMap).reduce((s, v) => s + v, 0);
    return { partner, total, ...statusMap };
  }));

  // Manufacturer breakdown
  const manufacturerIds = [...new Set(manufacturerStats.filter((r) => r.assignedManufacturerId).map((r) => r.assignedManufacturerId))];
  const manufacturers = await prisma.manufacturer.findMany({ where: { id: { in: manufacturerIds } }, select: { id: true, name: true, city: true } });
  const manuMap = Object.fromEntries(manufacturers.map((m) => [m.id, m]));
  const manuBreakdown = {};
  for (const row of manufacturerStats) {
    const id = row.assignedManufacturerId;
    if (!id) continue;
    if (!manuBreakdown[id]) manuBreakdown[id] = { manufacturer: manuMap[id] || { id, name: "Unknown" }, total: 0 };
    manuBreakdown[id][row.physicalStatus] = row._count._all;
    manuBreakdown[id].total += row._count._all;
  }

  return {
    partnerBreakdown,
    campaignBreakdown: campaignStats.map((c) => ({
      id: c.id, name: c.name, status: c.status,
      targetScopeType: c.targetScopeType, targetProvince: c.targetProvince, targetDistrict: c.targetDistrict,
      partner: c.marketingPartner,
      cardCount: c._count.cards, batchCount: c._count.batches,
      generatedQuantity: c.generatedQuantity, requestedQuantity: c.requestedQuantity,
      benefits: c.benefits,
      startsAt: c.startsAt, endsAt: c.endsAt, createdAt: c.createdAt,
    })),
    manufacturerBreakdown: Object.values(manuBreakdown),
    statusBreakdown: Object.fromEntries(statusBreakdown.map((r) => [r.physicalStatus, r._count._all])),
  };
};

export const adminInvalidateCards = async ({ cardIds, reason, actorId }) => {
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new Error("At least one card ID is required.");
  if (cardIds.length > 500) throw new Error("Cannot invalidate more than 500 cards at once.");

  return prisma.$transaction(async (tx) => {
    const cards = await tx.marketingCard.findMany({
      where: { id: { in: cardIds } },
      include: { assignments: { orderBy: { assignedAt: "desc" }, take: 1 } },
    });
    if (cards.length === 0) throw new Error("No cards found.");

    const results = { succeeded: [], skipped: [], failed: [] };
    for (const card of cards) {
      if (card.physicalStatus === "CANCELLED") {
        results.skipped.push({ id: card.id, reason: "Already cancelled." });
        continue;
      }
      if (["REDEEMED"].includes(card.physicalStatus)) {
        results.skipped.push({ id: card.id, reason: `Cannot invalidate a ${card.physicalStatus} card.` });
        continue;
      }
      try {
        await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "CANCELLED" } });
        const assignment = card.assignments?.[0];
        if (assignment && assignment.status !== "CANCELLED") {
          await tx.marketingCardAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", notes: reason || "Invalidated by admin." } });
        }
        await addEvent(tx, { cardId: card.id, eventType: "CARD_CANCELLED", actorId, actorRole: "ADMIN", fromStatus: card.physicalStatus, toStatus: "CANCELLED", metadata: { reason: reason || "Admin invalidation" } });
        results.succeeded.push({ id: card.id, fromStatus: card.physicalStatus });
      } catch (err) {
        results.failed.push({ id: card.id, reason: err.message });
      }
    }
    return { results, summary: { total: cards.length, succeeded: results.succeeded.length, skipped: results.skipped.length, failed: results.failed.length } };
  });
};

export const getCardMetrics = async () => {
  const [physicalStatuses, assignedCount, receivedCount, attachedCount, deliveredCount, activatedCount, redeemedCount] = await Promise.all([
    prisma.marketingCard.groupBy({ by: ["physicalStatus"], _count: { _all: true } }),
    prisma.marketingCardAssignment.count({ where: { status: { not: "CANCELLED" } } }),
    prisma.marketingCardReceipt.count(),
    prisma.marketingCardOrder.count(),
    prisma.marketingCardOrder.count({ where: { order: { fulfillmentStatus: "delivered" } } }),
    prisma.marketingCardCustomer.count({ where: { status: "ACTIVE" } }),
    prisma.marketingBenefitRedemption.count({ where: { status: "REDEEMED" } }),
  ]);
  return {
    physical: Object.fromEntries(physicalStatuses.map((item) => [item.physicalStatus, item._count._all])),
    assigned: assignedCount,
    received: receivedCount,
    attached: attachedCount,
    delivered: deliveredCount,
    activated: activatedCount,
    redeemed: redeemedCount,
  };
};

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

/**
 * Bulk update card statuses for a manufacturer.
 * action: "RECEIVE"    → ASSIGNED → AVAILABLE  (confirms receipt)
 * action: "DAMAGED"    → ASSIGNED | AVAILABLE  → CANCELLED  (physical damage)
 * action: "NOT_FOUND"  → ASSIGNED → CANCELLED  (card missing / not delivered)
 */
export const bulkUpdateManufacturerCards = async ({ cardIds, action, manufacturerId, notes }) => {
  if (!Array.isArray(cardIds) || cardIds.length === 0) throw new Error("At least one card must be selected.");
  if (cardIds.length > 200) throw new Error("Cannot update more than 200 cards at once.");
  const validActions = ["RECEIVE", "DAMAGED", "NOT_FOUND"];
  if (!validActions.includes(action)) throw new Error(`Invalid action. Must be one of: ${validActions.join(", ")}.`);

  return prisma.$transaction(async (tx) => {
    // Fetch all cards scoped to this manufacturer
    const cards = await tx.marketingCard.findMany({
      where: { id: { in: cardIds }, assignedManufacturerId: manufacturerId },
      include: { assignments: { orderBy: { assignedAt: "desc" }, take: 1 } },
    });

    const found = new Set(cards.map((c) => c.id));
    const notFound = cardIds.filter((id) => !found.has(id));
    if (notFound.length > 0) throw new Error(`${notFound.length} card(s) not found in your inventory.`);

    const results = { succeeded: [], skipped: [], failed: [] };

    for (const card of cards) {
      const assignment = card.assignments?.[0];
      const fromStatus = card.physicalStatus;

      try {
        if (action === "RECEIVE") {
          if (fromStatus === "AVAILABLE") { results.skipped.push({ id: card.id, reason: "Already received." }); continue; }
          if (fromStatus !== "ASSIGNED") { results.skipped.push({ id: card.id, reason: `Cannot receive card with status ${fromStatus}.` }); continue; }
          if (!assignment) { results.failed.push({ id: card.id, reason: "No assignment record found." }); continue; }
          await tx.marketingCardReceipt.create({ data: { assignmentId: assignment.id, confirmedBy: manufacturerId, notes: notes || null } });
          await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "AVAILABLE", receivedAt: new Date() } });
          await tx.marketingCardAssignment.update({ where: { id: assignment.id }, data: { status: "RECEIVED", confirmedAt: new Date(), notes: notes || assignment.notes } });
          await addEvent(tx, { cardId: card.id, eventType: "CARD_RECEIPT_CONFIRMED", actorId: manufacturerId, actorRole: "MANUFACTURER", fromStatus, toStatus: "AVAILABLE", referenceId: assignment?.id });
          results.succeeded.push({ id: card.id, toStatus: "AVAILABLE" });

        } else if (action === "DAMAGED") {
          if (!["ASSIGNED", "AVAILABLE"].includes(fromStatus)) { results.skipped.push({ id: card.id, reason: `Cannot mark ${fromStatus} card as damaged.` }); continue; }
          await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "CANCELLED" } });
          if (assignment && assignment.status !== "CANCELLED") {
            await tx.marketingCardAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", notes: notes || "Marked as DAMAGED by manufacturer." } });
          }
          await addEvent(tx, { cardId: card.id, eventType: "CARD_CANCELLED", actorId: manufacturerId, actorRole: "MANUFACTURER", fromStatus, toStatus: "CANCELLED", metadata: { reason: "DAMAGED", notes: notes || null } });
          results.succeeded.push({ id: card.id, toStatus: "CANCELLED", reason: "DAMAGED" });

        } else if (action === "NOT_FOUND") {
          if (fromStatus !== "ASSIGNED") { results.skipped.push({ id: card.id, reason: `Only ASSIGNED cards can be marked as not found. Current status: ${fromStatus}.` }); continue; }
          await tx.marketingCard.update({ where: { id: card.id }, data: { physicalStatus: "CANCELLED" } });
          if (assignment && assignment.status !== "CANCELLED") {
            await tx.marketingCardAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", notes: notes || "Marked as NOT FOUND by manufacturer." } });
          }
          await addEvent(tx, { cardId: card.id, eventType: "CARD_CANCELLED", actorId: manufacturerId, actorRole: "MANUFACTURER", fromStatus, toStatus: "CANCELLED", metadata: { reason: "NOT_FOUND", notes: notes || null } });
          results.succeeded.push({ id: card.id, toStatus: "CANCELLED", reason: "NOT_FOUND" });
        }
      } catch (err) {
        results.failed.push({ id: card.id, reason: err.message });
      }
    }

    return results;
  });
};

export const attachRandomCardToOrder = async ({ orderId, manufacturerId }) => prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { marketingCardOrder: true } });
  if (!order || order.manufacturerId !== manufacturerId) throw new Error("Order not found or unauthorized.");
  if (!order.marketingCardRequired) throw new Error("This order does not require a marketing card.");
  if (order.marketingCardOrder) return order.marketingCardOrder;
  const assignment = await tx.orderAssignment.findUnique({ where: { orderId } });
  if (!assignment || assignment.manufacturerId !== manufacturerId) throw new Error("Manufacturer assignment not found.");

  const inventory = await tx.marketingCard.findMany({
    where: { assignedManufacturerId: manufacturerId, physicalStatus: "AVAILABLE", assignments: { some: { manufacturerId, status: "RECEIVED", receipt: { isNot: null } } } },
    select: { id: true, physicalStatus: true, campaign: true },
    take: 500,
  });
  const now = new Date();
  const eligibleInventory = inventory.filter((card) => {
    const c = card.campaign;
    // Must be an active campaign
    if (!ACTIVE_CAMPAIGN_STATUSES.has(c.status)) return false;
    // Must not have passed the campaign end date (new attachments blocked after expiry)
    if (c.endsAt && now > new Date(c.endsAt)) return false;
    // Must match order geography
    return campaignMatchesOrder(c, order);
  });
  if (!eligibleInventory.length) {
    const error = new Error("No received marketing cards match this order's active campaign and delivery geography. The campaign may have expired.");
    error.code = "MARKETING_CARD_NOT_ELIGIBLE";
    throw error;
  }

  // Partition eligible cards by geography hierarchy: DISTRICT, PROVINCE, NATIONWIDE
  const districtCards = [];
  const provinceCards = [];
  const nationwideCards = [];

  for (const card of eligibleInventory) {
    if (card.campaign.targetScopeType === "DISTRICT") {
      districtCards.push(card);
    } else if (card.campaign.targetScopeType === "PROVINCE") {
      provinceCards.push(card);
    } else {
      nationwideCards.push(card);
    }
  }

  // Prioritized Weighted Random Distribution:
  // 5 (District) : 3 (Province) : 2 (Nationwide)
  const candidateTiers = [];
  if (districtCards.length > 0) candidateTiers.push({ tier: "DISTRICT", weight: 5, cards: districtCards });
  if (provinceCards.length > 0) candidateTiers.push({ tier: "PROVINCE", weight: 3, cards: provinceCards });
  if (nationwideCards.length > 0) candidateTiers.push({ tier: "NATIONWIDE", weight: 2, cards: nationwideCards });

  const totalWeight = candidateTiers.reduce((sum, item) => sum + item.weight, 0);
  let randomWeight = Math.random() * totalWeight;
  let chosenTierCards = candidateTiers[0].cards;

  for (const item of candidateTiers) {
    if (randomWeight < item.weight) {
      chosenTierCards = item.cards;
      break;
    }
    randomWeight -= item.weight;
  }

  const selected = chosenTierCards[crypto.randomInt(chosenTierCards.length)];
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

export const getLocationMappingsService = async () => {
  try {
    const locations = await prisma.locationMapping.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    if (locations && locations.length > 0) return locations;
  } catch (_err) {
    // Fallback if table not ready
  }
  return NEPAL_LOCATION_MAP;
};

export const cardTokenHash = hashToken;
