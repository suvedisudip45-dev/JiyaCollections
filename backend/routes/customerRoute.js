import express from "express";
import {
  listAllCustomers,
  searchAdminCustomers,
  getCustomerAdminAnalytics,
  getCustomerAdminProfile,
  getCustomerAdminOrders,
  getCustomerAdminLetters,
  getCustomerDetails,
  updateCustomerDisabledStatus,
  uploadCustomerLetter,
  deleteCustomerLetter,
} from "../controllers/customerController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import upload from "../middleware/multer.js";

const customerRouter = express.Router();

const requireAdminRole = (req, res, next) => {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ROLE_REQUIRED",
      message: "Only administrators can access customer records.",
    });
  }
  return next();
};

customerRouter.get("/list", authenticate, requireAdminRole, authorize("customer:admin_list"), listAllCustomers);
customerRouter.get("/admin/analytics", authenticate, requireAdminRole, authorize("customer:admin_list"), getCustomerAdminAnalytics);
customerRouter.get("/admin/search", authenticate, requireAdminRole, authorize("customer:admin_list"), searchAdminCustomers);
customerRouter.get("/details/:userId/profile", authenticate, requireAdminRole, authorize("customer:admin_detail"), getCustomerAdminProfile);
customerRouter.get("/details/:userId/orders", authenticate, requireAdminRole, authorize("customer:admin_orders_read"), getCustomerAdminOrders);
customerRouter.get("/details/:userId/letters", authenticate, requireAdminRole, authorize("customer:admin_detail"), getCustomerAdminLetters);
customerRouter.get("/details/:userId", authenticate, requireAdminRole, authorize("customer:admin_detail"), getCustomerDetails);
customerRouter.patch("/admin/:userId/status", authenticate, requireAdminRole, authorize("customer:account_manage"), updateCustomerDisabledStatus);
customerRouter.post("/letter/upload", authenticate, requireAdminRole, authorize("customer:letter_manage"), upload.single("image"), uploadCustomerLetter);
customerRouter.delete("/letter/:id", authenticate, requireAdminRole, authorize("customer:letter_manage"), deleteCustomerLetter);

export default customerRouter;
