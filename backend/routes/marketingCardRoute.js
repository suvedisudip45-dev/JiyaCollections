import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import authManufacturer from "../middleware/manufacturerAuth.js";
import authUser from "../middleware/auth.js";
import marketingPartnerAuth from "../middleware/marketingPartnerAuth.js";
import marketingCardRateLimit from "../middleware/marketingCardRateLimit.js";
import {
  adminAssignCards,
  adminCreateCampaign,
  adminCreatePartner,
  adminGenerateBatch,
  adminListCards,
  adminCardMetrics,
  adminListCampaigns,
  adminListPartners,
  manufacturerAttachCard,
  manufacturerListCards,
  manufacturerReceiveCard,
  customerListCards,
  customerLinkCard,
  customerScanCard,
  customerRedeemBenefit,
} from "../controllers/marketingCardController.js";
import {
  partnerLogin,
  getProfile,
  updateProfile,
  changePassword,
  listCampaigns,
  getCampaignDetail,
  listCards,
  getCardDetail,
  getMetrics,
  listRedemptions,
  validateQr,
  redeemBenefit,
} from "../controllers/marketingPartnerController.js";

const marketingCardRouter = express.Router();

// ── Admin routes ─────────────────────────────────────────────
marketingCardRouter.get("/admin/partners", adminAuth, adminListPartners);
marketingCardRouter.post("/admin/partners", adminAuth, adminCreatePartner);
marketingCardRouter.get("/admin/campaigns", adminAuth, adminListCampaigns);
marketingCardRouter.post("/admin/campaigns", adminAuth, adminCreateCampaign);
marketingCardRouter.post("/admin/batches", adminAuth, adminGenerateBatch);
marketingCardRouter.post("/admin/assignments", adminAuth, adminAssignCards);
marketingCardRouter.get("/admin/cards", adminAuth, adminListCards);
marketingCardRouter.get("/admin/metrics", adminAuth, adminCardMetrics);

// ── Manufacturer routes ──────────────────────────────────────
marketingCardRouter.get("/manufacturer/cards", authManufacturer, manufacturerListCards);
marketingCardRouter.post("/manufacturer/cards/:cardId/receive", authManufacturer, manufacturerReceiveCard);
marketingCardRouter.post("/manufacturer/orders/:orderId/attach", authManufacturer, manufacturerAttachCard);

// ── Customer routes ──────────────────────────────────────────
marketingCardRouter.get("/customer/cards", authUser, customerListCards);
marketingCardRouter.post("/customer/cards/link", authUser, marketingCardRateLimit("link"), customerLinkCard);
marketingCardRouter.post("/customer/cards/scan", authUser, marketingCardRateLimit("scan"), customerScanCard);
marketingCardRouter.post("/customer/cards/:cardId/benefits/:benefitId/redeem", authUser, marketingCardRateLimit("redeem"), customerRedeemBenefit);

// ── Marketing Partner routes ─────────────────────────────────
marketingCardRouter.post("/partner/login", partnerLogin);
marketingCardRouter.get("/partner/profile", marketingPartnerAuth, getProfile);
marketingCardRouter.put("/partner/profile", marketingPartnerAuth, updateProfile);
marketingCardRouter.post("/partner/change-password", marketingPartnerAuth, changePassword);
marketingCardRouter.get("/partner/campaigns", marketingPartnerAuth, listCampaigns);
marketingCardRouter.get("/partner/campaigns/:id", marketingPartnerAuth, getCampaignDetail);
marketingCardRouter.get("/partner/cards", marketingPartnerAuth, listCards);
marketingCardRouter.get("/partner/cards/:id", marketingPartnerAuth, getCardDetail);
marketingCardRouter.get("/partner/metrics", marketingPartnerAuth, getMetrics);
marketingCardRouter.get("/partner/redemptions", marketingPartnerAuth, listRedemptions);
marketingCardRouter.post("/partner/qr/validate", marketingPartnerAuth, marketingCardRateLimit("scan"), validateQr);
marketingCardRouter.post("/partner/redemptions/redeem", marketingPartnerAuth, marketingCardRateLimit("redeem"), redeemBenefit);

export default marketingCardRouter;

