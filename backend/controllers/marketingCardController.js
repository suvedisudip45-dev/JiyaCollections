import { promises as fs } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import {
  assignCards,
  assignCardsToOrganization,
  approvePartner,
  attachRandomCardToOrder,
  adminInvalidateCards,
  createCampaign,
  createPartner,
  deactivateCampaign,
  generateBatch,
  getAdminCardStats,
  listAdminCards,
  getCardMetrics,
  listCampaigns,
  listPartners,
  getLocationMappingsService,
  getDistributorInventory,
  receiveCardAsDistributor,
  bulkUpdateDistributorCards,
} from "../services/marketingCardService.js";
import {
  claimCustomerReward,
  linkCustomerCard,
  listClaimedCustomerRewards,
  listCustomerCards,
  redeemCustomerBenefit,
  resolveCustomerQr,
} from "../services/marketingCardCustomerService.js";

const sendError = (res, error) => {
  const status = error.code === "MARKETING_CARD_FORBIDDEN" ? 403
    : error.code === "MARKETING_CARD_SCAN_LIMIT" ? 429
      : error.code === "MARKETING_CARD_REQUIRED" || error.code === "MARKETING_CARD_NOT_ELIGIBLE" || error.code === "MARKETING_CARD_ALREADY_SCANNED" || error.code === "MARKETING_CARD_EXCHANGE_LOCKED" || error.code === "MARKETING_CARD_REWARD_INVALID" || error.code === "MARKETING_CARD_REWARD_REDEEMED" ? 409
        : 400;
  return res.status(status).json({
    success: false,
    message: error.message || "Marketing card operation failed.",
    code: error.code || "MARKETING_CARD_ERROR",
    ...(error.details ? { details: error.details } : {}),
  });
};

export const adminGetLocations = async (_req, res) => {
  try { return res.json({ success: true, locations: await getLocationMappingsService() }); } catch (error) { return sendError(res, error); }
};

export const adminListPartners = async (_req, res) => {
  try { return res.json({ success: true, partners: await listPartners() }); } catch (error) { return sendError(res, error); }
};

export const adminCreatePartner = async (req, res) => {
  try {
    if (!req.body.name?.trim() || !req.body.code?.trim() || !req.body.email?.trim() || !req.body.password) {
      return res.status(400).json({ success: false, message: "Partner name, code, email, and initial password are required." });
    }
    if (String(req.body.password).length < 8) return res.status(400).json({ success: false, message: "Initial password must be at least 8 characters." });
    return res.status(201).json({ success: true, partner: await createPartner(req.body) });
  } catch (error) { return sendError(res, error); }
};

export const adminApprovePartner = async (req, res) => {
  try {
    if (!req.params.partnerId || !req.body.code?.trim()) return res.status(400).json({ success: false, message: "A permanent partner code is required." });
    return res.json({ success: true, partner: await approvePartner({ partnerId: req.params.partnerId, code: req.body.code }) });
  } catch (error) { return sendError(res, error); }
};

export const adminListCampaigns = async (_req, res) => {
  try { return res.json({ success: true, campaigns: await listCampaigns() }); } catch (error) { return sendError(res, error); }
};

export const adminCreateCampaign = async (req, res) => {
  try {
    if (req.body.isOwnStore === true || String(req.body.isOwnStore).toLowerCase() === "true") {
      return res.status(403).json({ success: false, message: "Use the Own Store campaign permission to create this campaign.", code: "FORBIDDEN" });
    }
    if (!req.body.name?.trim() || !req.body.marketingPartnerId) return res.status(400).json({ success: false, message: "Campaign name and marketing partner are required." });
    return res.status(201).json({ success: true, campaign: await createCampaign(req.body) });
  } catch (error) { return sendError(res, error); }
};

export const adminCreateOwnStoreCampaign = async (req, res) => {
  try {
    if (!req.body.name?.trim()) return res.status(400).json({ success: false, message: "Campaign name is required." });
    return res.status(201).json({
      success: true,
      campaign: await createCampaign({ ...req.body, isOwnStore: true }),
    });
  } catch (error) { return sendError(res, error); }
};

export const adminUploadCampaignMedia = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Select an image or video to upload." });

  try {
    const mediaType = req.file.mimetype.startsWith("video/") ? "VIDEO" : "IMAGE";
    const uploaded = await cloudinary.uploader.upload(req.file.path, {
      resource_type: mediaType === "VIDEO" ? "video" : "image",
      folder: "aama_marketing_campaigns",
    });
    return res.status(201).json({
      success: true,
      media: { mediaType, mediaUrl: uploaded.secure_url },
    });
  } catch (error) {
    return sendError(res, error);
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
};

export const adminDeactivateCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) return res.status(400).json({ success: false, message: "campaignId is required." });
    const campaign = await deactivateCampaign({ campaignId, actorId: req.adminId, reason: req.body.reason });
    return res.json({ success: true, campaign, message: `Campaign "${campaign.name}" has been deactivated. Existing customer cards remain valid until card expiry.` });
  } catch (error) { return sendError(res, error); }
};

export const adminGenerateBatch = async (req, res) => {
  try {
    const result = await generateBatch({ ...req.body, actorId: req.adminId });
    return res.status(201).json({ success: true, batch: result.batch, cards: result.cards, message: "Card batch generated. QR tokens are returned only for this print/export operation." });
  } catch (error) { return sendError(res, error); }
};

export const adminAssignCards = async (req, res) => {
  try {
    const result = await assignCards({ ...req.body, actorId: req.adminId });
    return res.json({ success: true, ...result, message: `${result.count} card(s) assigned to the distributor.` });
  } catch (error) { return sendError(res, error); }
};

export const adminAssignCardsToOrganization = async (req, res) => {
  try {
    const result = await assignCardsToOrganization({ ...req.body, actorId: req.adminId });
    const target = result.isPublic ? "Everyone" : result.assignedOrganization;
    return res.json({ success: true, ...result, message: `${result.count} card(s) assigned to ${target}.` });
  } catch (error) { return sendError(res, error); }
};

export const adminListCards = async (req, res) => {
  try {
    const { partnerId, campaignId, manufacturerId, distributorId, status, page, pageSize, search } = req.query;
    const result = await listAdminCards({ partnerId, campaignId, manufacturerId, distributorId, status, page, pageSize, search });
    return res.json({ success: true, ...result });
  } catch (error) { return sendError(res, error); }
};

export const adminCardStats = async (_req, res) => {
  try { return res.json({ success: true, stats: await getAdminCardStats() }); } catch (error) { return sendError(res, error); }
};

export const adminCardMetrics = async (_req, res) => {
  try { return res.json({ success: true, metrics: await getCardMetrics() }); } catch (error) { return sendError(res, error); }
};

export const adminInvalidate = async (req, res) => {
  try {
    const { cardIds, reason } = req.body;
    const result = await adminInvalidateCards({ cardIds, reason, actorId: req.adminId });
    return res.json({ success: true, ...result, message: `${result.summary.succeeded} card(s) invalidated successfully.` });
  } catch (error) { return sendError(res, error); }
};

// ── Distributor Hub card management ──────────────────────────────────────────

export const distributorListCards = async (req, res) => {
  try {
    return res.json({
      success: true,
      cards: await getDistributorInventory({ distributorId: req.distributorId, status: req.query.status }),
    });
  } catch (error) { return sendError(res, error); }
};

export const distributorAttachCardToOrder = async (req, res) => {
  try {
    const card = await attachRandomCardToOrder({
      orderId: req.params.orderId,
      distributorId: req.distributorId,
    });
    return res.json({ success: true, card });
  } catch (error) { return sendError(res, error); }
};

export const distributorReceiveCard = async (req, res) => {
  try {
    return res.json({
      success: true,
      card: await receiveCardAsDistributor({ cardId: req.params.cardId, distributorId: req.distributorId, notes: req.body.notes }),
    });
  } catch (error) { return sendError(res, error); }
};

export const distributorBulkUpdateCards = async (req, res) => {
  try {
    const { cardIds, action, notes } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0)
      return res.status(400).json({ success: false, message: "cardIds array is required." });
    if (!action)
      return res.status(400).json({ success: false, message: "action is required (RECEIVE, DAMAGED, NOT_FOUND)." });
    const results = await bulkUpdateDistributorCards({
      cardIds,
      action: String(action).toUpperCase(),
      distributorId: req.distributorId,
      notes,
    });
    const total = results.succeeded.length + results.skipped.length + results.failed.length;
    return res.json({
      success: true,
      results,
      summary: { total, succeeded: results.succeeded.length, skipped: results.skipped.length, failed: results.failed.length },
      message: `${results.succeeded.length} of ${total} card(s) updated successfully.`,
    });
  } catch (error) { return sendError(res, error); }
};

export const customerListCards = async (req, res) => {
  try { return res.json({ success: true, cards: await listCustomerCards(req.userId) }); } catch (error) { return sendError(res, error); }
};

export const customerListRewards = async (req, res) => {
  try { return res.json({ success: true, rewards: await listClaimedCustomerRewards(req.userId) }); } catch (error) { return sendError(res, error); }
};

export const customerClaimReward = async (req, res) => {
  try {
    const reward = await claimCustomerReward({ customerId: req.userId, cardId: req.body.cardId });
    return res.json({ success: true, reward, message: reward.alreadyClaimed ? "This reward is already claimed and ready to use." : "Reward claimed and ready to apply at checkout." });
  } catch (error) { return sendError(res, error); }
};

export const customerVerifyCode = async (req, res) => {
  try {
    const { verifyCustomerCardCode } = await import("../services/marketingCardCustomerService.js");
    const result = await verifyCustomerCardCode({ customerId: req.userId, cardCode: req.body.cardCode });
    return res.json({ success: true, ...result });
  } catch (error) { return sendError(res, error); }
};

export const customerVerifyQr = async (req, res) => {
  try {
    const { verifyCustomerQr } = await import("../services/marketingCardCustomerService.js");
    const result = await verifyCustomerQr({ customerId: req.userId, cardCode: req.body.cardCode, token: req.body.token });
    return res.json({ success: true, ...result });
  } catch (error) { return sendError(res, error); }
};

export const customerActivateCard = async (req, res) => {
  try {
    const { activateCustomerCard } = await import("../services/marketingCardCustomerService.js");
    const card = await activateCustomerCard({ customerId: req.userId, cardId: req.params.cardId || req.body.cardId });
    return res.json({ success: true, card, message: "Card activated successfully! Present your physical card to the partner store to claim your reward." });
  } catch (error) { return sendError(res, error); }
};

export const customerLinkCard = async (req, res) => {
  try { return res.status(201).json({ success: true, card: await linkCustomerCard({ customerId: req.userId, cardCode: req.body.cardCode }) }); } catch (error) { return sendError(res, error); }
};

export const customerScanCard = async (req, res) => {
  try { return res.json({ success: true, card: await resolveCustomerQr({ customerId: req.userId, token: req.body.token }) }); } catch (error) { return sendError(res, error); }
};

export const customerRedeemBenefit = async (req, res) => {
  try { return res.status(201).json({ success: true, redemption: await redeemCustomerBenefit({ customerId: req.userId, cardId: req.params.cardId, benefitId: req.params.benefitId }), message: "Benefit redeemed successfully." }); } catch (error) { return sendError(res, error); }
};
