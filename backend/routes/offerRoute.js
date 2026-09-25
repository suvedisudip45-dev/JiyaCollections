import express from "express";
import {
  getActiveOffer,
  listOffers,
  createOffer,
  updateOffer,
  deleteOffer,
} from "../controllers/offerController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const offerRouter = express.Router();

// Public route to get currently active festive campaign
offerRouter.get("/active", getActiveOffer);

// Admin routes
offerRouter.get("/list", authenticate, authorize("offer:list"), listOffers);
offerRouter.post("/create", authenticate, authorize("offer:create"), createOffer);
offerRouter.post("/update", authenticate, authorize("offer:update"), updateOffer);
offerRouter.post("/delete", authenticate, authorize("offer:delete"), deleteOffer);

export default offerRouter;
