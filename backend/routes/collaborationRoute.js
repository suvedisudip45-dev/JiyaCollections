import express from "express";
import { authenticate, authorize, setMarketingPartnerContext } from "../middleware/unifiedAuth.js";
import {
  assignCollaborationProduct,
  getAdminCollaborationOptions,
  getAdminCollaborationReport,
  listAdminCollaborationProducts,
  listPartnerCollaborationProducts,
  listPublicCollaborationProducts,
  proposeAdminCollaborationTerms,
  proposePartnerCollaborationTerms,
  respondAdminCollaborationTerms,
  respondPartnerCollaborationTerms,
  getPartnerCollaborationReport,
  generateAdminCollaborationInvoices,
  updateAdminCollaborationListing,
} from "../controllers/collaborationController.js";

const collaborationRouter = express.Router();

collaborationRouter.get("/public/products", listPublicCollaborationProducts);

// ── Admin routes ────────────────────────────────────────────────────────────
collaborationRouter.get("/admin/options", authenticate, authorize("collaboration:admin_manage"), getAdminCollaborationOptions);
collaborationRouter.get("/admin/products", authenticate, authorize("collaboration:admin_manage"), listAdminCollaborationProducts);
collaborationRouter.get("/admin/report", authenticate, authorize("collaboration:admin_reports_read"), getAdminCollaborationReport);
collaborationRouter.post("/admin/invoices/generate", authenticate, authorize("collaboration:admin_manage"), generateAdminCollaborationInvoices);
collaborationRouter.post("/admin/products", authenticate, authorize("collaboration:admin_manage"), assignCollaborationProduct);
collaborationRouter.post("/admin/products/:id/terms", authenticate, authorize("collaboration:admin_manage"), proposeAdminCollaborationTerms);
collaborationRouter.post("/admin/products/:id/respond", authenticate, authorize("collaboration:admin_manage"), respondAdminCollaborationTerms);
collaborationRouter.patch("/admin/products/:id/listing", authenticate, authorize("collaboration:admin_manage"), updateAdminCollaborationListing);

// ── Marketing Partner routes ─────────────────────────────────────────────────
collaborationRouter.get("/partner/products", authenticate, authorize("partner:collaboration_read"), setMarketingPartnerContext, listPartnerCollaborationProducts);
collaborationRouter.get("/partner/report", authenticate, authorize("partner:collaboration_read"), setMarketingPartnerContext, getPartnerCollaborationReport);
collaborationRouter.post("/partner/products/:id/terms", authenticate, authorize("partner:collaboration_terms_manage"), setMarketingPartnerContext, proposePartnerCollaborationTerms);
collaborationRouter.post("/partner/products/:id/respond", authenticate, authorize("partner:collaboration_terms_manage"), setMarketingPartnerContext, respondPartnerCollaborationTerms);

// NOTE: The /manufacturer/report route has been intentionally removed.
// Collaboration Sales is no longer accessible from the Manufacturer portal.

export default collaborationRouter;