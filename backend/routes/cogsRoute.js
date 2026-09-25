import express from "express";
import {
  getCOGSOverview,
  acceptProposedPrice,
  rejectProposedPrice,
  getPendingProposals,
} from "../controllers/cogsController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const cogsRouter = express.Router();

// Admin-protected COGS & Manufacturer Pricing Agreement routes
cogsRouter.get("/overview", authenticate, authorize("cogs:read"), getCOGSOverview);
cogsRouter.get("/margins", authenticate, authorize("cogs:read"), getCOGSOverview);
cogsRouter.get("/pending-proposals", authenticate, authorize("cogs:proposals_read"), getPendingProposals);
cogsRouter.post("/accept-price", authenticate, authorize("cogs:price_approve"), acceptProposedPrice);
cogsRouter.post("/reject-price", authenticate, authorize("cogs:price_reject"), rejectProposedPrice);

export default cogsRouter;
