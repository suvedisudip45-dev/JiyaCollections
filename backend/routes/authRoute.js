import express from "express";
import {
  login,
  refresh,
  getMe,
  switchWorkspace,
  logout,
  changePassword,
  requestOtp,
  verifyOtp,
  sendPortalTwoFactor,
  resendPortalTwoFactor,
  verifyPortalTwoFactor,
  sendAdminTwoFactor,
  verifyAdminTwoFactor,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/unifiedAuth.js";
import { loginRateLimit, resetLoginRateLimitOnSuccess } from "../middleware/authRateLimit.js";

const authRouter = express.Router();

// Public Authentication Endpoints
authRouter.post("/login", loginRateLimit, resetLoginRateLimitOnSuccess, login);
authRouter.post("/refresh", refresh);
authRouter.post("/workspace", authenticate, switchWorkspace);
authRouter.post("/2fa/send", sendPortalTwoFactor);
authRouter.post("/2fa/resend", resendPortalTwoFactor);
authRouter.post("/2fa/verify", resetLoginRateLimitOnSuccess, verifyPortalTwoFactor);
authRouter.post("/admin/2fa/send", sendAdminTwoFactor);
authRouter.post("/admin/2fa/verify", resetLoginRateLimitOnSuccess, verifyAdminTwoFactor);
authRouter.post("/logout", authenticate, logout);

// OTP Endpoints
authRouter.post("/otp/request", requestOtp);
authRouter.post("/otp/verify", verifyOtp);

// Authenticated Account Endpoints
authRouter.get("/me", authenticate, getMe);
authRouter.post("/change-password", authenticate, changePassword);

export default authRouter;
