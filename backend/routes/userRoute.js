import express from "express";
import {
  loginUser,
  registerUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  saveUserAddress,
  deleteUserAddress,
  adminLogin,
  validateSocialCustomerProfile,
  activateSocialCustomerProfile,
} from "../controllers/userController.js";
import { adminChangePassword } from "../controllers/adminController.js";
import { authenticate, authorize } from "../middleware/unifiedAuth.js";

const userRouter = express.Router();

userRouter.post("/register", registerUser);
userRouter.post("/login", loginUser);
userRouter.post("/social/validate", validateSocialCustomerProfile);
userRouter.post("/social/activate", activateSocialCustomerProfile);
userRouter.post("/admin", adminLogin);

// Admin Authenticated Routes
userRouter.post("/admin/change-password", authenticate, authorize("admin:change_password"), adminChangePassword);

// Customer Authenticated Routes
userRouter.get("/profile", authenticate, authorize("customer:profile_read"), getUserProfile);
userRouter.post("/profile/update", authenticate, authorize("customer:profile_update"), updateUserProfile);
userRouter.post("/password/change", authenticate, authorize("customer:password_change"), changePassword);
userRouter.post("/address/save", authenticate, authorize("customer:address_manage"), saveUserAddress);
userRouter.post("/address/delete", authenticate, authorize("customer:address_manage"), deleteUserAddress);

export default userRouter;
