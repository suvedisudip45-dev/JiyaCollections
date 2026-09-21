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
import authUser from "../middleware/auth.js";
import { authAdmin } from "../middleware/auth.js";

const userRouter = express.Router();

userRouter.post("/register", registerUser);
userRouter.post("/login", loginUser);
userRouter.post("/social/validate", validateSocialCustomerProfile);
userRouter.post("/social/activate", activateSocialCustomerProfile);
userRouter.post("/admin", adminLogin);

// Admin Authenticated Routes
userRouter.post("/admin/change-password", authAdmin, adminChangePassword);

// Customer Authenticated Routes
userRouter.get("/profile", authUser, getUserProfile);
userRouter.post("/profile/update", authUser, updateUserProfile);
userRouter.post("/password/change", authUser, changePassword);
userRouter.post("/address/save", authUser, saveUserAddress);
userRouter.post("/address/delete", authUser, deleteUserAddress);

export default userRouter;
