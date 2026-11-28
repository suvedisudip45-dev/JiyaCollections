import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminPortalNotifications,
  createPortalNotification,
  createPortalNotificationForProfile,
  decodePortalNotificationCursor,
  getPortalNotificationUnreadCount,
  listPortalNotifications,
  markPortalNotificationRead,
} from "../services/portalNotificationService.js";

test("portal notifications are stored for the requested account and workspace role", async () => {
  let createArgs;
  const client = {
    portalNotification: {
      createMany: async (args) => {
        createArgs = args;
        return { count: 1 };
      },
    },
  };

  const created = await createPortalNotification(client, {
    recipientAccountId: "account-1",
    recipientRole: "distributor",
    category: "ORDER_ASSIGNMENT",
    title: "New order",
    message: "An order was assigned.",
    href: "//external.example",
    dedupeKey: "ORDER:1",
  });

  assert.equal(created, 1);
  assert.equal(createArgs.skipDuplicates, true);
  assert.equal(createArgs.data[0].recipientAccountId, "account-1");
  assert.equal(createArgs.data[0].recipientRole, "DISTRIBUTOR");
  assert.equal(createArgs.data[0].href, null);
});

test("profile and Admin notifications target only resolved active recipients", async () => {
  const saved = [];
  const client = {
    distributor: {
      findUnique: async () => ({ accountId: "distributor-account" }),
    },
    authAccount: {
      findMany: async (args) => {
        assert.equal(args.where.status, "ACTIVE");
        assert.deepEqual(args.where.id, { not: "admin-2" });
        return [{ id: "admin-1" }];
      },
    },
    portalNotification: {
      createMany: async ({ data }) => {
        saved.push(...data);
        return { count: data.length };
      },
    },
  };
  const notification = {
    category: "STOCK_TRANSFER",
    title: "Review required",
    message: "A request needs review.",
    href: "/stock-transfers",
    dedupeKey: "TRANSFER:1",
  };

  await createPortalNotificationForProfile(client, {
    ...notification,
    profileType: "distributor",
    profileId: "profile-1",
    recipientRole: "DISTRIBUTOR",
  });
  await createAdminPortalNotifications(client, notification, { excludeAccountId: "admin-2" });

  assert.deepEqual(saved.map(({ recipientAccountId, recipientRole }) => [recipientAccountId, recipientRole]), [
    ["distributor-account", "DISTRIBUTOR"],
    ["admin-1", "ADMIN"],
  ]);
});

test("notification pages are capped at ten and scoped by account and role", async () => {
  let query;
  const rows = Array.from({ length: 11 }, (_, index) => ({
    id: `notification-${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 11 - index)),
    href: "/orders/1",
    isRead: false,
  }));
  const result = await listPortalNotifications({
    client: {
      portalNotification: {
        findMany: async (args) => {
          query = args;
          return rows;
        },
      },
    },
    recipientAccountId: "account-1",
    recipientRole: "MANUFACTURER",
    limit: 50,
  });

  assert.equal(query.where.recipientAccountId, "account-1");
  assert.equal(query.where.recipientRole, "MANUFACTURER");
  assert.equal(query.take, 11);
  assert.equal(result.notifications.length, 10);
  assert.equal(result.hasMore, true);
  assert.deepEqual(decodePortalNotificationCursor(result.nextCursor), {
    createdAt: rows[9].createdAt,
    id: rows[9].id,
  });
});

test("unread count and read updates remain scoped to the current account and role", async () => {
  let countQuery;
  let updateQuery;
  const count = await getPortalNotificationUnreadCount({
    client: {
      portalNotification: {
        count: async ({ where }) => {
          countQuery = where;
          return 3;
        },
      },
    },
    recipientAccountId: "account-1",
    recipientRole: "DISTRIBUTOR",
  });

  assert.equal(count, 3);
  assert.deepEqual(countQuery, {
    recipientAccountId: "account-1",
    recipientRole: "DISTRIBUTOR",
    isRead: false,
  });

  await assert.rejects(
    markPortalNotificationRead({
      client: {
        portalNotification: {
          updateMany: async ({ where }) => {
            updateQuery = where;
            return { count: 0 };
          },
          findFirst: async () => null,
        },
      },
      recipientAccountId: "account-1",
      recipientRole: "MANUFACTURER",
      notificationId: "notification-1",
    }),
    (error) => error.statusCode === 404,
  );
  assert.equal(updateQuery.recipientAccountId, "account-1");
  assert.equal(updateQuery.recipientRole, "MANUFACTURER");
});
