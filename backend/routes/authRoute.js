import express from "express";
import {
  login,
  refresh,
  getMe,
  logout,
  changePassword,
  requestOtp,
  verifyOtp,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/unifiedAuth.js";

const authRouter = express.Router();

// Public Authentication Endpoints
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", authenticate, logout);

// OTP Endpoints
authRouter.post("/otp/request", requestOtp);
authRouter.post("/otp/verify", verifyOtp);

// Authenticated Account Endpoints
authRouter.get("/me", authenticate, getMe);
authRouter.post("/change-password", authenticate, changePassword);

export default authRouter;
