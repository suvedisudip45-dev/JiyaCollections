import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import authManufacturer from "../middleware/manufacturerAuth.js";
import authUser from "../middleware/auth.js";
import {
  adminAssignCards,
  adminCreateCampaign,
  adminCreatePartner,
  adminGenerateBatch,
  adminListCards,
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

const marketingCardRouter = express.Router();

marketingCardRouter.get("/admin/partners", adminAuth, adminListPartners);
marketingCardRouter.post("/admin/partners", adminAuth, adminCreatePartner);
marketingCardRouter.get("/admin/campaigns", adminAuth, adminListCampaigns);
marketingCardRouter.post("/admin/campaigns", adminAuth, adminCreateCampaign);
marketingCardRouter.post("/admin/batches", adminAuth, adminGenerateBatch);
marketingCardRouter.post("/admin/assignments", adminAuth, adminAssignCards);
marketingCardRouter.get("/admin/cards", adminAuth, adminListCards);

marketingCardRouter.get("/manufacturer/cards", authManufacturer, manufacturerListCards);
marketingCardRouter.post("/manufacturer/cards/:cardId/receive", authManufacturer, manufacturerReceiveCard);
marketingCardRouter.post("/manufacturer/orders/:orderId/attach", authManufacturer, manufacturerAttachCard);

marketingCardRouter.get("/customer/cards", authUser, customerListCards);
marketingCardRouter.post("/customer/cards/link", authUser, customerLinkCard);
marketingCardRouter.post("/customer/cards/scan", authUser, customerScanCard);
marketingCardRouter.post("/customer/cards/:cardId/benefits/:benefitId/redeem", authUser, customerRedeemBenefit);

export default marketingCardRouter;
