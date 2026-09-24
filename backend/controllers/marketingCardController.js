import {
  assignCards,
  attachRandomCardToOrder,
  createCampaign,
  createPartner,
  generateBatch,
  getManufacturerInventory,
  listAdminCards,
  getCardMetrics,
  listCampaigns,
  listPartners,
  receiveCard,
  getLocationMappingsService,
} from "../services/marketingCardService.js";
import {
  linkCustomerCard,
  listCustomerCards,
  redeemCustomerBenefit,
  resolveCustomerQr,
} from "../services/marketingCardCustomerService.js";

const sendError = (res, error) => {
  const status = error.code === "MARKETING_CARD_FORBIDDEN" ? 403 : error.code === "MARKETING_CARD_REQUIRED" || error.code === "MARKETING_CARD_NOT_ELIGIBLE" ? 409 : 400;
  return res.status(status).json({ success: false, message: error.message || "Marketing card operation failed.", code: error.code || "MARKETING_CARD_ERROR" });
};

export const adminGetLocations = async (_req, res) => {
  try { return res.json({ success: true, locations: await getLocationMappingsService() }); } catch (error) { return sendError(res, error); }
};

export const adminListPartners = async (_req, res) => {
  try { return res.json({ success: true, partners: await listPartners() }); } catch (error) { return sendError(res, error); }
};

export const adminCreatePartner = async (req, res) => {
  try {
    if (!req.body.name?.trim() || !req.body.code?.trim()) return res.status(400).json({ success: false, message: "Partner name and code are required." });
    return res.status(201).json({ success: true, partner: await createPartner(req.body) });
  } catch (error) { return sendError(res, error); }
};

export const adminListCampaigns = async (_req, res) => {
  try { return res.json({ success: true, campaigns: await listCampaigns() }); } catch (error) { return sendError(res, error); }
};

export const adminCreateCampaign = async (req, res) => {
  try {
    if (!req.body.name?.trim() || !req.body.marketingPartnerId) return res.status(400).json({ success: false, message: "Campaign name and marketing partner are required." });
    return res.status(201).json({ success: true, campaign: await createCampaign(req.body) });
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
    return res.json({ success: true, ...result, message: `${result.count} card(s) assigned to the manufacturer.` });
  } catch (error) { return sendError(res, error); }
};

export const adminListCards = async (req, res) => {
  try { return res.json({ success: true, cards: await listAdminCards(req.query) }); } catch (error) { return sendError(res, error); }
};

export const adminCardMetrics = async (_req, res) => {
  try { return res.json({ success: true, metrics: await getCardMetrics() }); } catch (error) { return sendError(res, error); }
};

export const manufacturerListCards = async (req, res) => {
  try { return res.json({ success: true, cards: await getManufacturerInventory({ manufacturerId: req.manufacturerId, status: req.query.status }) }); } catch (error) { return sendError(res, error); }
};

export const manufacturerReceiveCard = async (req, res) => {
  try { return res.json({ success: true, card: await receiveCard({ cardId: req.params.cardId, manufacturerId: req.manufacturerId, notes: req.body.notes }) }); } catch (error) { return sendError(res, error); }
};

export const manufacturerAttachCard = async (req, res) => {
  try { return res.json({ success: true, card: await attachRandomCardToOrder({ orderId: req.params.orderId, manufacturerId: req.manufacturerId }), message: "Marketing card attached to the order." }); } catch (error) { return sendError(res, error); }
};

export const customerListCards = async (req, res) => {
  try { return res.json({ success: true, cards: await listCustomerCards(req.userId) }); } catch (error) { return sendError(res, error); }
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

