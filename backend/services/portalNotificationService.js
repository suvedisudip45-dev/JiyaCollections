import { prisma } from "../config/db.js";

export const PORTAL_NOTIFICATION_ROLES = new Set(["ADMIN", "MANUFACTURER", "DISTRIBUTOR"]);
export const PORTAL_NOTIFICATION_PAGE_SIZE = 10;

const invalidCursor = () => Object.assign(new Error("Notification cursor is invalid."), {
  statusCode: 400,
  code: "INVALID_NOTIFICATION_CURSOR",
});

export const encodePortalNotificationCursor = ({ createdAt, id }) =>
  Buffer.from(JSON.stringify({ createdAt: new Date(createdAt).toISOString(), id }), "utf8").toString("base64url");

export const decodePortalNotificationCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const createdAt = new Date(value.createdAt);
    if (!value.id || typeof value.id !== "string" || Number.isNaN(createdAt.getTime())) throw invalidCursor();
    return { createdAt, id: value.id };
  } catch (error) {
    if (error.statusCode) throw error;
    throw invalidCursor();
  }
};

const normalizeNotification = (notification) => ({
  ...notification,
  href: typeof notification.href === "string" && notification.href.startsWith("/") && !notification.href.startsWith("//")
    ? notification.href
    : null,
});

export const createPortalNotification = async (client, {
  recipientAccountId,
  recipientRole,
  category,
  title,
  message,
  href = null,
  entityType = null,
  entityId = null,
  dedupeKey,
}) => {
  const normalizedRole = String(recipientRole || "").trim().toUpperCase();
  if (!recipientAccountId || !PORTAL_NOTIFICATION_ROLES.has(normalizedRole) ||
      !category || !title || !message || !dedupeKey) {
    throw new Error("Portal notification is missing required recipient or event details.");
  }
  const safeHref = typeof href === "string" && href.startsWith("/") && !href.startsWith("//")
    ? href.slice(0, 512)
    : null;
  const result = await client.portalNotification.createMany({
    data: [{
      recipientAccountId,
      recipientRole: normalizedRole,
      category: String(category).slice(0, 64),
      title: String(title).slice(0, 160),
      message: String(message).slice(0, 500),
      href: safeHref,
      entityType: entityType ? String(entityType).slice(0, 64) : null,
      entityId: entityId ? String(entityId).slice(0, 191) : null,
      dedupeKey: String(dedupeKey).slice(0, 191),
    }],
    skipDuplicates: true,
  });
  return result.count;
};

export const createPortalNotificationForProfile = async (client, {
  profileType,
  profileId,
  recipientRole,
  ...notification
}) => {
  const modelName = String(profileType || "").trim().toLowerCase();
  if (!["manufacturer", "distributor"].includes(modelName) || !profileId) {
    throw new Error("Portal notification profile target is invalid.");
  }
  const profile = await client[modelName].findUnique({
    where: { id: profileId },
    select: { accountId: true },
  });
  if (!profile?.accountId) return 0;
  return createPortalNotification(client, {
    ...notification,
    recipientAccountId: profile.accountId,
    recipientRole,
  });
};

export const createAdminPortalNotifications = async (client, notification, { excludeAccountId = null } = {}) => {
  const administrators = await client.authAccount.findMany({
    where: {
      status: "ACTIVE",
      ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
      roleMappings: {
        some: {
          isActive: true,
          role: { isActive: true, portalScope: "ADMIN" },
        },
      },
    },
    select: { id: true },
  });
  if (!administrators.length) return 0;
  const result = await client.portalNotification.createMany({
    data: administrators.map(({ id }) => ({
      recipientAccountId: id,
      recipientRole: "ADMIN",
      category: String(notification.category).slice(0, 64),
      title: String(notification.title).slice(0, 160),
      message: String(notification.message).slice(0, 500),
      href: typeof notification.href === "string" && notification.href.startsWith("/") && !notification.href.startsWith("//")
        ? notification.href.slice(0, 512)
        : null,
      entityType: notification.entityType ? String(notification.entityType).slice(0, 64) : null,
      entityId: notification.entityId ? String(notification.entityId).slice(0, 191) : null,
      dedupeKey: String(notification.dedupeKey).slice(0, 191),
    })),
    skipDuplicates: true,
  });
  return result.count;
};

export const listPortalNotifications = async ({
  client = prisma,
  recipientAccountId,
  recipientRole,
  cursor,
  limit = PORTAL_NOTIFICATION_PAGE_SIZE,
}) => {
  const normalizedRole = String(recipientRole || "").trim().toUpperCase();
  if (!recipientAccountId || !PORTAL_NOTIFICATION_ROLES.has(normalizedRole)) {
    throw new Error("A valid notification recipient and workspace role are required.");
  }
  const pageSize = Math.min(PORTAL_NOTIFICATION_PAGE_SIZE, Math.max(1, Number(limit) || PORTAL_NOTIFICATION_PAGE_SIZE));
  const decodedCursor = decodePortalNotificationCursor(cursor);
  const rows = await client.portalNotification.findMany({
    where: {
      recipientAccountId,
      recipientRole: normalizedRole,
      ...(decodedCursor ? {
        OR: [
          { createdAt: { lt: decodedCursor.createdAt } },
          { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const notifications = rows.slice(0, pageSize).map(normalizeNotification);
  const last = notifications[notifications.length - 1];
  return {
    notifications,
    hasMore,
    nextCursor: hasMore && last ? encodePortalNotificationCursor(last) : null,
  };
};

export const getPortalNotificationUnreadCount = ({
  client = prisma,
  recipientAccountId,
  recipientRole,
}) => {
  const normalizedRole = String(recipientRole || "").trim().toUpperCase();
  if (!recipientAccountId || !PORTAL_NOTIFICATION_ROLES.has(normalizedRole)) {
    throw new Error("A valid notification recipient and workspace role are required.");
  }
  return client.portalNotification.count({
    where: { recipientAccountId, recipientRole: normalizedRole, isRead: false },
  });
};

export const markPortalNotificationRead = async ({
  client = prisma,
  recipientAccountId,
  recipientRole,
  notificationId,
}) => {
  const normalizedRole = String(recipientRole || "").trim().toUpperCase();
  if (!recipientAccountId || !PORTAL_NOTIFICATION_ROLES.has(normalizedRole) || !notificationId) {
    throw new Error("A valid notification recipient, workspace role, and notification ID are required.");
  }
  const where = {
    id: notificationId,
    recipientAccountId,
    recipientRole: normalizedRole,
  };
  const updated = await client.portalNotification.updateMany({
    where: { ...where, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  const notification = await client.portalNotification.findFirst({ where });
  if (!notification) {
    const error = new Error("Notification not found.");
    error.statusCode = 404;
    error.code = "NOTIFICATION_NOT_FOUND";
    throw error;
  }
  return { notification, changed: updated.count > 0 };
};
