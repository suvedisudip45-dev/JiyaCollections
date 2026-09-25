import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import { authenticate, authorize, setManufacturerContext, setMarketingPartnerContext } from "../middleware/unifiedAuth.js";
import marketingCardRateLimit from "../middleware/marketingCardRateLimit.js";
import {
  adminAssignCards,
  adminCreateCampaign,
  adminDeactivateCampaign,
  adminCreatePartner,
  adminApprovePartner,
  adminGenerateBatch,
  adminListCards,
  adminCardMetrics,
  adminCardStats,
  adminInvalidate,
  adminListCampaigns,
  adminListPartners,
  adminGetLocations,
  manufacturerAttachCard,
  manufacturerBulkUpdateCards,
  manufacturerListCards,
  manufacturerReceiveCard,
  customerListCards,
  customerVerifyCode,
  customerVerifyQr,
  customerActivateCard,
  customerLinkCard,
  customerScanCard,
  customerRedeemBenefit,
} from "../controllers/marketingCardController.js";
import {
  partnerLogin,
  partnerSignup,
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
  rejectCard,
} from "../controllers/marketingPartnerController.js";

const marketingCardRouter = express.Router();

// ── Shared / Public routes ──────────────────────────────────
marketingCardRouter.get("/locations", adminGetLocations);

// ── Admin routes ─────────────────────────────────────────────
marketingCardRouter.get("/admin/locations", adminAuth, adminGetLocations);
marketingCardRouter.get("/admin/partners", adminAuth, adminListPartners);
marketingCardRouter.post("/admin/partners", adminAuth, adminCreatePartner);
marketingCardRouter.patch("/admin/partners/:partnerId/approve", adminAuth, adminApprovePartner);
marketingCardRouter.get("/admin/campaigns", adminAuth, adminListCampaigns);
marketingCardRouter.post("/admin/campaigns", adminAuth, adminCreateCampaign);
marketingCardRouter.patch("/admin/campaigns/:campaignId/deactivate", adminAuth, adminDeactivateCampaign);
marketingCardRouter.post("/admin/batches", adminAuth, adminGenerateBatch);
marketingCardRouter.post("/admin/assignments", adminAuth, adminAssignCards);
marketingCardRouter.get("/admin/cards", adminAuth, adminListCards);
marketingCardRouter.post("/admin/cards/invalidate", adminAuth, adminInvalidate);
marketingCardRouter.get("/admin/metrics", adminAuth, adminCardMetrics);
marketingCardRouter.get("/admin/stats", adminAuth, adminCardStats);

// ── Manufacturer routes ──────────────────────────────────────
marketingCardRouter.get("/manufacturer/cards", authenticate, authorize("marketing_card:manufacturer_manage"), setManufacturerContext, manufacturerListCards);
marketingCardRouter.post("/manufacturer/cards/bulk-status", authenticate, authorize("marketing_card:manufacturer_manage"), setManufacturerContext, manufacturerBulkUpdateCards);
marketingCardRouter.post("/manufacturer/cards/:cardId/receive", authenticate, authorize("marketing_card:manufacturer_manage"), setManufacturerContext, manufacturerReceiveCard);
marketingCardRouter.post("/manufacturer/orders/:orderId/attach", authenticate, authorize("marketing_card:manufacturer_manage"), setManufacturerContext, manufacturerAttachCard);

// ── Customer routes ──────────────────────────────────────────
marketingCardRouter.get("/customer/cards", authenticate, authorize("marketing_card:customer_manage"), customerListCards);
marketingCardRouter.post("/customer/cards/verify-code", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("link"), customerVerifyCode);
marketingCardRouter.post("/customer/cards/verify-qr", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("scan"), customerVerifyQr);
marketingCardRouter.post("/customer/cards/:cardId/activate", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("link"), customerActivateCard);
marketingCardRouter.post("/customer/cards/link", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("link"), customerLinkCard);
marketingCardRouter.post("/customer/cards/scan", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("scan"), customerScanCard);
marketingCardRouter.post("/customer/cards/:cardId/benefits/:benefitId/redeem", authenticate, authorize("marketing_card:customer_manage"), marketingCardRateLimit("redeem"), customerRedeemBenefit);

// ── Marketing Partner routes ─────────────────────────────────
marketingCardRouter.post("/partner/login", partnerLogin);
marketingCardRouter.post("/partner/signup", partnerSignup);
marketingCardRouter.get("/partner/profile", authenticate, authorize("partner:profile_manage"), setMarketingPartnerContext, getProfile);
marketingCardRouter.put("/partner/profile", authenticate, authorize("partner:profile_manage"), setMarketingPartnerContext, updateProfile);
marketingCardRouter.post("/partner/change-password", authenticate, authorize("partner:profile_manage"), setMarketingPartnerContext, changePassword);
marketingCardRouter.get("/partner/campaigns", authenticate, authorize("partner:campaign_manage"), setMarketingPartnerContext, listCampaigns);
marketingCardRouter.get("/partner/campaigns/:id", authenticate, authorize("partner:campaign_manage"), setMarketingPartnerContext, getCampaignDetail);
marketingCardRouter.get("/partner/cards", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, listCards);
marketingCardRouter.get("/partner/cards/:id", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, getCardDetail);
marketingCardRouter.get("/partner/metrics", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, getMetrics);
marketingCardRouter.get("/partner/redemptions", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, listRedemptions);
marketingCardRouter.post("/partner/qr/validate", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, marketingCardRateLimit("scan"), validateQr);
marketingCardRouter.post("/partner/redemptions/redeem", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, marketingCardRateLimit("redeem"), redeemBenefit);
marketingCardRouter.post("/partner/redemptions/reject", authenticate, authorize("partner:card_manage"), setMarketingPartnerContext, marketingCardRateLimit("redeem"), rejectCard);

export default marketingCardRouter;


