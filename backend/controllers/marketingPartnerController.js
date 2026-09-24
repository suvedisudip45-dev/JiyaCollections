import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { decryptAES } from "../utils/crypto.js";
import {
  getPartnerById,
  getPartnerCampaigns,
  getPartnerCampaignDetail,
  getPartnerCards,
  getPartnerCardDetail,
  getPartnerMetrics,
  getPartnerRedemptions,
  validatePartnerQr,
} from "../services/marketingPartnerService.js";

const sendError = (res, error) => {
  const status =
    error.code === "PARTNER_FORBIDDEN" ? 403 :
    error.code === "INVALID_INPUT" ? 400 : 400;
  return res.status(status).json({
    success: false,
    message: error.message || "Operation failed.",
    code: error.code || "PARTNER_ERROR",
  });
};

// POST /partner/login
export const partnerLogin = async (req, res) => {
  try {
    const { email, password, encryptedPassword, iv } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required." });

    // Resolve password — support both plain and AES-encrypted (same pattern as admin)
    let plainPassword;
    if (encryptedPassword && iv) {
      try {
        plainPassword = decryptAES(encryptedPassword, iv);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid encrypted credentials." });
      }
    } else if (password) {
      plainPassword = password;
    } else {
      return res.status(400).json({ success: false, message: "Password is required." });
    }

    const partner = await prisma.marketingPartner.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: { id: true, code: true, name: true, status: true, email: true, passwordHash: true },
    });

    if (!partner || !partner.passwordHash) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    if (partner.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: "Account is inactive. Please contact support." });
    }

    const isMatch = await bcrypt.compare(plainPassword, partner.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const token = jwt.sign(
      { role: "marketing_partner", partnerId: partner.id },
      process.env.JWT_SECRET
    );

    return res.json({
      success: true,
      token,
      partner: { id: partner.id, code: partner.code, name: partner.name, email: partner.email, status: partner.status },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Login failed. Please try again." });
  }
};

// GET /partner/profile
export const getProfile = async (req, res) => {
  try {
    const partner = await getPartnerById(req.partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
    return res.json({ success: true, partner });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/campaigns
export const listCampaigns = async (req, res) => {
  try {
    const campaigns = await getPartnerCampaigns({ partnerId: req.partnerId, status: req.query.status });
    return res.json({ success: true, campaigns });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/campaigns/:id
export const getCampaignDetail = async (req, res) => {
  try {
    const campaign = await getPartnerCampaignDetail({ partnerId: req.partnerId, campaignId: req.params.id });
    return res.json({ success: true, campaign });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/cards
export const listCards = async (req, res) => {
  try {
    const { campaignId, status, page = 1, limit = 50 } = req.query;
    const [cards, total] = await getPartnerCards({ partnerId: req.partnerId, campaignId, status, page, limit });
    return res.json({ success: true, cards, total, page: Number(page), limit: Number(limit) });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/cards/:id
export const getCardDetail = async (req, res) => {
  try {
    const card = await getPartnerCardDetail({ partnerId: req.partnerId, cardId: req.params.id });
    return res.json({ success: true, card });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/metrics
export const getMetrics = async (req, res) => {
  try {
    const metrics = await getPartnerMetrics(req.partnerId);
    return res.json({ success: true, metrics });
  } catch (error) { return sendError(res, error); }
};

// GET /partner/redemptions
export const listRedemptions = async (req, res) => {
  try {
    const { campaignId, status, page = 1, limit = 50 } = req.query;
    const [redemptions, total] = await getPartnerRedemptions({ partnerId: req.partnerId, campaignId, status, page, limit });
    return res.json({ success: true, redemptions, total, page: Number(page), limit: Number(limit) });
  } catch (error) { return sendError(res, error); }
};

// POST /partner/qr/validate
export const validateQr = async (req, res) => {
  try {
    const { cardCode } = req.body;
    const result = await validatePartnerQr({ partnerId: req.partnerId, cardCode });
    return res.json({ success: true, ...result });
  } catch (error) { return sendError(res, error); }
};

// POST /partner/redemptions/redeem
export const redeemBenefit = async (req, res) => {
  try {
    const { cardCode, benefitId } = req.body;
    if (!cardCode || !benefitId) {
      return res.status(400).json({ success: false, message: "cardCode and benefitId are required." });
    }
    const result = await (await import("../services/marketingPartnerService.js")).redeemPartnerBenefit({
      partnerId: req.partnerId,
      cardCode,
      benefitId,
    });
    return res.json({ success: true, ...result });
  } catch (error) { return sendError(res, error); }
};

// PUT /partner/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, contactPhone, website, address } = req.body;
    const partner = await (await import("../services/marketingPartnerService.js")).updatePartnerProfile({
      partnerId: req.partnerId,
      name,
      contactPhone,
      website,
      address,
    });
    return res.json({ success: true, partner });
  } catch (error) { return sendError(res, error); }
};

// POST /partner/change-password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Both current and new password are required." });
    }
    const partner = await prisma.marketingPartner.findUnique({
      where: { id: req.partnerId },
      select: { id: true, passwordHash: true },
    });
    if (!partner || !partner.passwordHash) {
      return res.status(404).json({ success: false, message: "Partner not found." });
    }
    const isMatch = await bcrypt.compare(currentPassword, partner.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Incorrect current password." });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.marketingPartner.update({
      where: { id: req.partnerId },
      data: { passwordHash: newHash },
    });
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) { return sendError(res, error); }
};

