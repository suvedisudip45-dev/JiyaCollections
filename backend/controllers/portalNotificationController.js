import {
  getPortalNotificationUnreadCount,
  listPortalNotifications,
  markPortalNotificationRead,
} from "../services/portalNotificationService.js";

const logControllerError = (action, error) => {
  console.error(`${action} error:`, error);
};

export const listPortalNotificationsController = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const result = await listPortalNotifications({
      recipientAccountId: req.auth.accountId,
      recipientRole: req.auth.role,
      cursor: req.query.cursor,
      limit: Number.isInteger(limit) ? limit : undefined,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logControllerError("listPortalNotifications", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to load notifications.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

export const unreadPortalNotificationCountController = async (req, res) => {
  try {
    const count = await getPortalNotificationUnreadCount({
      recipientAccountId: req.auth.accountId,
      recipientRole: req.auth.role,
    });
    return res.json({ success: true, count });
  } catch (error) {
    logControllerError("unreadPortalNotificationCount", error);
    return res.status(500).json({ success: false, message: "Unable to load unread notifications." });
  }
};

export const markPortalNotificationReadController = async (req, res) => {
  try {
    const result = await markPortalNotificationRead({
      recipientAccountId: req.auth.accountId,
      recipientRole: req.auth.role,
      notificationId: String(req.params.id || "").trim(),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    logControllerError("markPortalNotificationRead", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to update notification.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
};
