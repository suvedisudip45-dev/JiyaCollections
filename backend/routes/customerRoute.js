import express from "express";
import {
  listAllCustomers,
  searchAdminCustomers,
  getCustomerDetails,
  updateCustomerDisabledStatus,
  uploadCustomerLetter,
  deleteCustomerLetter,
} from "../controllers/customerController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import upload from "../middleware/multer.js";

const customerRouter = express.Router();

customerRouter.get("/list", authenticate, authorize("customer:admin_list"), listAllCustomers);
customerRouter.get("/admin/search", authenticate, authorize("customer:admin_list"), searchAdminCustomers);
customerRouter.get("/details/:userId", authenticate, authorize("customer:admin_detail"), getCustomerDetails);
customerRouter.patch("/admin/:userId/status", authenticate, authorize("customer:account_manage"), updateCustomerDisabledStatus);
customerRouter.post("/letter/upload", authenticate, authorize("customer:letter_manage"), upload.single("image"), uploadCustomerLetter);
customerRouter.delete("/letter/:id", authenticate, authorize("customer:letter_manage"), deleteCustomerLetter);

export default customerRouter;
