import express from "express";
import {
  listAllCustomers,
  getCustomerDetails,
  uploadCustomerLetter,
  deleteCustomerLetter,
} from "../controllers/customerController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";
import upload from "../middleware/multer.js";

const customerRouter = express.Router();

customerRouter.get("/list", authenticate, authorize("customer:admin_list"), listAllCustomers);
customerRouter.get("/details/:userId", authenticate, authorize("customer:admin_detail"), getCustomerDetails);
customerRouter.post("/letter/upload", authenticate, authorize("customer:letter_manage"), upload.single("image"), uploadCustomerLetter);
customerRouter.delete("/letter/:id", authenticate, authorize("customer:letter_manage"), deleteCustomerLetter);

export default customerRouter;
