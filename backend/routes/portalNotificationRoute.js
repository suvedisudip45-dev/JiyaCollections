import express from "express";
import { authenticate } from "../middleware/unifiedAuth.js";
import {
  listPortalNotificationsController,
  markPortalNotificationReadController,
  unreadPortalNotificationCountController,
} from "../controllers/portalNotificationController.js";

const portalNotificationRouter = express.Router();
const supportedRoles = new Set(["ADMIN", "MANUFACTURER", "DISTRIBUTOR"]);

portalNotificationRouter.use(authenticate, (req, res, next) => {
  const role = String(req.auth?.role || "").toUpperCase();
  if (!supportedRoles.has(role) || !req.auth?.roles?.includes(role)) {
    return res.status(403).json({
      success: false,
      message: "Notifications are not available in this workspace.",
      code: "NOTIFICATION_WORKSPACE_FORBIDDEN",
    });
  }
  return next();
});

portalNotificationRouter.get("/", listPortalNotificationsController);
portalNotificationRouter.get("/unread-count", unreadPortalNotificationCountController);
portalNotificationRouter.patch("/:id/read", markPortalNotificationReadController);

export default portalNotificationRouter;
