import express from "express";
import { authenticate, authorize, setManufacturerContext, setMarketingPartnerContext } from "../middleware/unifiedAuth.js";
import {
  assignCollaborationProduct,
  getAdminCollaborationOptions,
  getAdminCollaborationReport,
  getManufacturerCollaborationReport,
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

collaborationRouter.get("/admin/options", authenticate, authorize("collaboration:admin_manage"), getAdminCollaborationOptions);
collaborationRouter.get("/admin/products", authenticate, authorize("collaboration:admin_manage"), listAdminCollaborationProducts);
collaborationRouter.get("/admin/report", authenticate, authorize("collaboration:admin_reports_read"), getAdminCollaborationReport);
collaborationRouter.post("/admin/invoices/generate", authenticate, authorize("collaboration:admin_manage"), generateAdminCollaborationInvoices);
collaborationRouter.post("/admin/products", authenticate, authorize("collaboration:admin_manage"), assignCollaborationProduct);
collaborationRouter.post("/admin/products/:id/terms", authenticate, authorize("collaboration:admin_manage"), proposeAdminCollaborationTerms);
collaborationRouter.post("/admin/products/:id/respond", authenticate, authorize("collaboration:admin_manage"), respondAdminCollaborationTerms);
collaborationRouter.patch("/admin/products/:id/listing", authenticate, authorize("collaboration:admin_manage"), updateAdminCollaborationListing);

collaborationRouter.get("/partner/products", authenticate, authorize("partner:collaboration_read"), setMarketingPartnerContext, listPartnerCollaborationProducts);
collaborationRouter.get("/partner/report", authenticate, authorize("partner:collaboration_read"), setMarketingPartnerContext, getPartnerCollaborationReport);
collaborationRouter.post("/partner/products/:id/terms", authenticate, authorize("partner:collaboration_terms_manage"), setMarketingPartnerContext, proposePartnerCollaborationTerms);
collaborationRouter.post("/partner/products/:id/respond", authenticate, authorize("partner:collaboration_terms_manage"), setMarketingPartnerContext, respondPartnerCollaborationTerms);

collaborationRouter.get("/manufacturer/report", authenticate, authorize("manufacturer:collaboration_read"), setManufacturerContext, getManufacturerCollaborationReport);

export default collaborationRouter;