import { prisma } from "../config/db.js";
import { v2 as cloudinary } from "cloudinary";
import { calculateUserLoyalty } from "./loyaltyController.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { recordSystemAudit } from "../services/auditService.js";

// Helper to safely parse JSON arrays
const parseJson = (val, fallback = []) => {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

// GET /api/customer/list (Admin only)
export const listAllCustomers = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const pagination = getPagination(req.query);

    const [users, orders, letters, levels] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          phone: true,
          gender: true,
          socialCustomerCode: true,
          socialCustomerPhone: true,
          loyaltyTier: true,
          isInactiveProfile: true,
          inactiveProfileData: true,
          addresses: true,
        },
      }),
      prisma.order.findMany({
        where: { status: { notIn: ["Cancelled"] } },
        select: {
          id: true,
          userId: true,
          amount: true,
          date: true,
          status: true,
          address: true,
        },
      }),
      prisma.customerLetterImage.findMany({
        select: { id: true, userId: true },
      }),
      prisma.customerLevel.findMany({ orderBy: { levelNumber: "asc" } }),
    ]);

    // Aggregate orders & letters per user
    const ordersByUser = {};
    for (const o of orders) {
      if (!ordersByUser[o.userId]) ordersByUser[o.userId] = [];
      ordersByUser[o.userId].push(o);
    }

    const lettersByUser = {};
    for (const l of letters) {
      if (!lettersByUser[l.userId]) lettersByUser[l.userId] = 0;
      lettersByUser[l.userId]++;
    }

    // Build customer cards with calculated loyalty level
    let customerList = users.map((user) => {
      const userOrders = ordersByUser[user.id] || [];
      const totalOrders = userOrders.length;
      const totalSpend = userOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
      const letterCount = lettersByUser[user.id] || 0;

      // Determine level
      let currentLevel = levels[0] || {
        levelNumber: 1,
        name: "Bronze Explorer",
        badgeIcon: "🥉",
        color: "#CD7F32",
      };

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        if (totalSpend >= Number(lvl.minSpend) && totalOrders >= Number(lvl.minOrders)) {
          currentLevel = lvl;
        }
      }

      // Latest order
      const latestOrder = userOrders.length > 0
        ? userOrders.sort((a, b) => Number(b.date) - Number(a.date))[0]
        : null;

      const addresses = parseJson(user.addresses, []);
      const primaryCity = addresses.length > 0
        ? addresses[0].city
        : (latestOrder ? parseJson(latestOrder.address, {})?.city : "");

      const inactiveProfileData = parseJson(user.inactiveProfileData, {});

      return {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Customer",
        email: user.email,
        phone: user.phone || (addresses[0]?.phone || "") || user.socialCustomerPhone || "",
        gender: user.gender || inactiveProfileData.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode || "",
        socialCustomerPhone: user.socialCustomerPhone || user.phone || "",
        loyaltyTier: user.loyaltyTier || inactiveProfileData.loyaltyTier || "",
        isInactiveProfile: Boolean(user.isInactiveProfile),
        inactiveProfileData,
        city: primaryCity || "",
        totalSpend,
        totalOrders,
        letterCount,
        currentLevel,
        latestOrderDate: latestOrder ? Number(latestOrder.date) : null,
      };
    });

    // Apply search filter
    const searchStr = typeof search === "string" ? search.trim() : "";
    if (searchStr) {
      const query = searchStr.toLowerCase();
      customerList = customerList.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query) ||
          (c.phone && c.phone.toLowerCase().includes(query)) ||          (c.socialCustomerCode && c.socialCustomerCode.toLowerCase().includes(query)) ||
          (c.loyaltyTier && c.loyaltyTier.toLowerCase().includes(query)) ||          (c.city && c.city.toLowerCase().includes(query)) ||
          c.currentLevel.name.toLowerCase().includes(query)
      );
    }

    // Sort by total spend descending
    customerList.sort((a, b) => b.totalSpend - a.totalSpend);

    const total = customerList.length;
    const pageCustomers = customerList.slice(pagination.skip, pagination.skip + pagination.limit);
    res.json(paginatedResponse("customers", pageCustomers, pagination, total));
  } catch (error) {
    console.error("Error listing customers:", error);
    res.json({ success: false, message: error.message });
  }
};

const parseNotificationMessage = (payload) => {
  const value = typeof payload === "string" ? parseJson(payload, {}) : payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of ["message", "text", "body", "content"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].slice(0, 4000);
  }
  return null;
};

// GET /api/customer/admin/search (Admin only; requires an explicit query)
export const searchAdminCustomers = async (req, res) => {
  try {
    const query = String(req.query.search || "").trim();
    if (query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Enter at least two characters to search for a customer.",
        code: "CUSTOMER_SEARCH_REQUIRED",
      });
    }

    const pagination = getPagination(req.query);
    const where = {
      OR: [
        { name: { contains: query } },
        { firstName: { contains: query } },
        { lastName: { contains: query } },
        { email: { contains: query } },
        { phone: { contains: query } },
        { socialCustomerPhone: { contains: query } },
        { socialCustomerCode: { contains: query } },
      ],
    };
    const [total, pageUsers] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          accountId: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          phone: true,
          gender: true,
          socialCustomerCode: true,
          socialCustomerPhone: true,
          loyaltyTier: true,
          isInactiveProfile: true,
          isDisabled: true,
          disabledAt: true,
          addresses: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);
    const pageUserIds = pageUsers.map(({ id }) => id);
    const [orders, letters, levels, accounts] = await Promise.all([
      pageUserIds.length
        ? prisma.order.findMany({
            where: { userId: { in: pageUserIds }, status: { notIn: ["Cancelled"] } },
            select: { id: true, userId: true, amount: true, date: true, status: true, address: true },
          })
        : [],
      pageUserIds.length
        ? prisma.customerLetterImage.findMany({
            where: { userId: { in: pageUserIds } },
            select: { id: true, userId: true },
          })
        : [],
      prisma.customerLevel.findMany({ orderBy: { levelNumber: "asc" } }),
      pageUsers.some(({ accountId }) => accountId)
        ? prisma.authAccount.findMany({
            where: { id: { in: pageUsers.map(({ accountId }) => accountId).filter(Boolean) } },
            select: { id: true, createdAt: true, lastLoginAt: true, status: true },
          })
        : [],
    ]);

    const ordersByUser = new Map();
    for (const order of orders) {
      const userOrders = ordersByUser.get(order.userId) || [];
      userOrders.push(order);
      ordersByUser.set(order.userId, userOrders);
    }
    const letterCounts = new Map();
    for (const letter of letters) letterCounts.set(letter.userId, (letterCounts.get(letter.userId) || 0) + 1);
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    const customers = pageUsers.map((user) => {
      const userOrders = ordersByUser.get(user.id) || [];
      const totalSpend = userOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
      let currentLevel = levels[0] || {
        levelNumber: 1,
        name: "Bronze Explorer",
        badgeIcon: "🥉",
        color: "#CD7F32",
      };
      for (const level of levels) {
        if (totalSpend >= Number(level.minSpend) && userOrders.length >= Number(level.minOrders)) {
          currentLevel = level;
        }
      }
      const latestOrder = userOrders.reduce(
        (latest, order) => (!latest || Number(order.date) > Number(latest.date) ? order : latest),
        null,
      );
      const addresses = parseJson(user.addresses, []);
      const latestAddress = latestOrder ? parseJson(latestOrder.address, {}) : {};
      const account = accountById.get(user.accountId);
      return {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Customer",
        email: user.email,
        phone: user.phone || user.socialCustomerPhone || addresses[0]?.phone || "",
        gender: user.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode || "",
        loyaltyTier: user.loyaltyTier || "",
        isInactiveProfile: Boolean(user.isInactiveProfile),
        isDisabled: Boolean(user.isDisabled),
        disabledAt: user.disabledAt,
        city: addresses[0]?.city || latestAddress.city || latestAddress.district || "",
        totalSpend,
        totalOrders: userOrders.length,
        letterCount: letterCounts.get(user.id) || 0,
        currentLevel,
        latestOrderDate: latestOrder ? Number(latestOrder.date) : null,
        accountCreatedAt: account?.createdAt || null,
        lastLoginAt: account?.lastLoginAt || null,
      };
    });

    return res.json(paginatedResponse("customers", customers, pagination, total));
  } catch (error) {
    console.error("Error searching customers:", error);
    return res.status(500).json({ success: false, message: "Unable to search customers." });
  }
};

// GET /api/customer/details/:userId (Admin only)
export const getCustomerDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    const [orders, loyaltyStatus] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      }),
      calculateUserLoyalty(userId),
    ]);

    const addresses = parseJson(user.addresses, []);

    const orderIds = orders.map(({ id }) => id);
    const orderItems = orders.flatMap((order) => {
      const items = parseJson(order.items, []);
      return Array.isArray(items) ? items : [];
    });
    const productIds = [...new Set(orderItems.map((item) => item.productId || item.id).filter(Boolean))];
    const inactiveProfileData = parseJson(user.inactiveProfileData, {});
    const historicalContacts = orders.map((order) => parseJson(order.address, {}));
    const contactSources = [
      ...addresses,
      inactiveProfileData,
      ...historicalContacts,
    ];
    const notificationAddresses = [...new Set([
      user.email?.trim().toLowerCase(),
      inactiveProfileData.email?.trim().toLowerCase(),
      user.phone?.trim(),
      user.socialCustomerPhone?.trim(),
      ...contactSources.flatMap((contact) => [
        contact.email?.trim().toLowerCase(),
        contact.phone?.trim(),
      ]),
    ].filter(Boolean))];

    const [
      account,
      assignments,
      deliveryOrders,
      returnRequests,
      exchangeRequests,
      productReviews,
      distributorReviews,
      cardLinks,
      cardOrders,
      benefitRedemptions,
      storyAssignments,
      letterDeliveries,
      manualLetters,
      products,
      notifications,
    ] = await Promise.all([
      user.accountId
        ? prisma.authAccount.findUnique({
            where: { id: user.accountId },
            select: { id: true, status: true, createdAt: true, lastLoginAt: true, isEmailVerified: true, isPhoneVerified: true },
          })
        : null,
      orderIds.length
          ? prisma.orderAssignment.findMany({
              where: { orderId: { in: orderIds } },
              select: {
                orderId: true,
                deliveryType: true,
                status: true,
                assignedAt: true,
                acceptedAt: true,
                dispatchedAt: true,
                onTheWayAt: true,
                deliveredAt: true,
                returnedAt: true,
                notes: true,
                distributor: { select: { id: true, name: true } },
                manufacturer: { select: { id: true, name: true } },
              },
            })
          : [],
      orderIds.length
        ? prisma.deliveryOrder.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              orderId: true,
              state: true,
              deliveryType: true,
              originBranchName: true,
              destinationBranchName: true,
              itemAmount: true,
              customerDeliveryCharge: true,
              ncmDeliveryCharge: true,
              codAmount: true,
              ncmOrderId: true,
              ncmStatus: true,
              ncmPaymentStatus: true,
              readyAt: true,
              ncmCreatedAt: true,
              pickedUpAt: true,
              deliveredAt: true,
              returnedAt: true,
              createdAt: true,
              events: {
                orderBy: { occurredAt: "asc" },
                select: { source: true, eventType: true, fromState: true, toState: true, ncmStatus: true, occurredAt: true },
              },
            },
          })
        : [],
      prisma.customerReturn.findMany({
        where: {
          OR: [
            { userId },
            ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          manufacturerId: true,
          distributorId: true,
          deliveryRoute: true,
          customerName: true,
          customerPhone: true,
          returnDate: true,
          items: true,
          totalRefundAmount: true,
          vatRefunded: true,
          refundMethod: true,
          refundStatus: true,
          inventoryAction: true,
          reason: true,
          notes: true,
          lifecycleStatus: true,
          adminReviewerId: true,
          adminNotes: true,
          approvedAt: true,
          originalNcmOrderId: true,
          ncmReturnOrderId: true,
          ncmDeliveryCharge: true,
          ncmChargeSource: true,
          ncmChargePayer: true,
          logisticsSettlementAmount: true,
          returnPickupStatus: true,
          returnPickupCompletedAt: true,
          manufacturerReceivedAt: true,
          inspectedAt: true,
          inspectionResult: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            orderBy: { occurredAt: "asc" },
            select: { id: true, eventType: true, fromStatus: true, toStatus: true, actorRole: true, reason: true, occurredAt: true },
          },
        },
      }),
      prisma.orderExchangeRequest.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          customerName: true,
          customerPhone: true,
          manufacturerId: true,
          distributorId: true,
          deliveryRoute: true,
          reasonCode: true,
          reasonDetails: true,
          items: true,
          replacementItems: true,
          priceDifference: true,
          status: true,
          decisionActorId: true,
          decisionReason: true,
          decidedAt: true,
          ncmReturnOrderId: true,
          ncmReplacementOrderId: true,
          ncmReturnCharge: true,
          ncmReplacementCharge: true,
          ncmTotalCharge: true,
          ncmChargePayer: true,
          logisticsSettlementAmount: true,
          returnPickupStatus: true,
          returnPickupCompletedAt: true,
          replacementStatus: true,
          replacementDeliveredAt: true,
          manufacturerReceivedAt: true,
          inspectedAt: true,
          inspectionResult: true,
          inspectionNotes: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          events: {
            orderBy: { occurredAt: "asc" },
            select: { id: true, eventType: true, fromStatus: true, toStatus: true, actorRole: true, reason: true, occurredAt: true },
          },
        },
      }),
      prisma.review.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        select: { id: true, productId: true, rating: true, title: true, comment: true, verified: true, date: true },
      }),
      prisma.distributorReview.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { distributor: { select: { id: true, name: true } } },
      }),
      prisma.marketingCardCustomer.findMany({
        where: { customerId: userId },
        orderBy: { linkedAt: "desc" },
        select: {
          id: true,
          cardId: true,
          linkedAt: true,
          scannedAt: true,
          assignedOrganization: true,
          scanWeekIndex: true,
          activatedAt: true,
          status: true,
          card: {
            select: {
              id: true,
              cardCode: true,
              hasBenefit: true,
              physicalStatus: true,
              assignedOrganization: true,
              assignedAt: true,
              receivedAt: true,
              reservedAt: true,
              attachedAt: true,
              createdAt: true,
              campaign: { select: { id: true, name: true } },
              benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
              events: { orderBy: { createdAt: "asc" }, select: { eventType: true, fromStatus: true, toStatus: true, createdAt: true } },
            },
          },
        },
      }),
      orderIds.length
        ? prisma.marketingCardOrder.findMany({
            where: { orderId: { in: orderIds } },
            orderBy: { attachedAt: "desc" },
            include: {
              card: {
                select: {
                  id: true,
                  cardCode: true,
                  hasBenefit: true,
                  physicalStatus: true,
                  createdAt: true,
                  campaign: { select: { id: true, name: true } },
                  benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
                },
              },
            },
          })
        : [],
      prisma.marketingBenefitRedemption.findMany({
        where: { customerId: userId },
        orderBy: { redeemedAt: "desc" },
        include: {
          benefit: { select: { id: true, name: true, description: true, benefitType: true, value: true } },
          card: { select: { id: true, cardCode: true, campaign: { select: { name: true } } } },
        },
      }),
      prisma.customerStoryAssignment.findMany({
        where: { customerId: userId },
        orderBy: { startedAt: "desc" },
        include: { story: { select: { id: true, title: true } } },
      }),
      prisma.letterDelivery.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          status: true,
          reservedAt: true,
          printedAt: true,
          packedAt: true,
          shippedAt: true,
          deliveredAt: true,
          createdAt: true,
          renderedContent: true,
          renderedDocumentUrl: true,
          story: { select: { title: true } },
          storyLetter: { select: { title: true, sequenceNumber: true } },
          template: { select: { name: true } },
        },
      }),
      prisma.customerLetterImage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      productIds.length
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, image: true, category: true, subCategory: true },
          })
        : [],
      notificationAddresses.length
        ? prisma.notification.findMany({
            where: {
                recipientAddress: { in: notificationAddresses },
              },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              notificationType: true,
              channel: true,
              status: true,
              subject: true,
              template: true,
              payload: true,
              provider: true,
              attemptCount: true,
              queuedAt: true,
              acceptedAt: true,
              deliveredAt: true,
              failedAt: true,
              failureCode: true,
              createdAt: true,
            },
          })
        : [],
    ]);

    const productsById = new Map(products.map((product) => [product.id, product]));
    const orderProducts = orderItems.map((item) => ({
      ...item,
      product: productsById.get(item.productId || item.id) || null,
    }));
    const formattedOrders = orders.map((o) => {
      const items = parseJson(o.items, []);
      return {
        ...o,
        date: Number(o.date),
        items: (Array.isArray(items) ? items : []).map((item) => ({
          ...item,
          product: productsById.get(item.productId || item.id) || null,
        })),
        address: parseJson(o.address, {}),
      };
    });
    const lifetimeOrders = orders.filter((order) => order.status !== "Cancelled");
    const totalPurchaseAmount = lifetimeOrders.reduce((total, order) => total + Number(order.amount || 0), 0);
    const notificationsForProfile = notifications
      .filter((notification) => !/(otp|two.?factor|auth|verification|password|reset|login)/i.test(notification.notificationType))
      .map((notification) => ({
      id: notification.id,
      type: notification.notificationType,
      channel: notification.channel,
      status: notification.status,
      subject: notification.subject,
      template: notification.template,
      message: parseNotificationMessage(notification.payload),
      provider: notification.provider,
      attemptCount: notification.attemptCount,
      queuedAt: notification.queuedAt,
      acceptedAt: notification.acceptedAt,
      deliveredAt: notification.deliveredAt,
      failedAt: notification.failedAt,
      failureCode: notification.failureCode,
      createdAt: notification.createdAt,
      }));

    res.json({
      success: true,
      customer: {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        gender: user.gender || inactiveProfileData.gender || "PREFER_NOT_TO_SAY",
        socialCustomerCode: user.socialCustomerCode || "",
        socialCustomerPhone: user.socialCustomerPhone || user.phone || "",
        loyaltyTier: user.loyaltyTier || inactiveProfileData.loyaltyTier || "",
        isInactiveProfile: Boolean(user.isInactiveProfile),
        isDisabled: Boolean(user.isDisabled),
        disabledAt: user.disabledAt,
        disabledBy: user.disabledBy,
        disabledReason: user.disabledReason || "",
        createdAt: account?.createdAt || null,
        lastLoginAt: account?.lastLoginAt || null,
        accountStatus: account?.status || (user.isInactiveProfile ? "PROFILE_ONLY" : "NO_AUTH_ACCOUNT"),
        emailVerified: Boolean(account?.isEmailVerified),
        phoneVerified: Boolean(account?.isPhoneVerified),
        inactiveProfileData,
        addresses,
      },
      loyalty: loyaltyStatus,
      orders: formattedOrders,
      assignments,
      metrics: {
        orderCount: lifetimeOrders.length,
        cancelledOrderCount: orders.length - lifetimeOrders.length,
        totalPurchaseAmount,
        averageOrderAmount: lifetimeOrders.length ? totalPurchaseAmount / lifetimeOrders.length : 0,
        firstOrderDate: lifetimeOrders.length ? Math.min(...lifetimeOrders.map((order) => Number(order.date))) : null,
        lastOrderDate: lifetimeOrders.length ? Math.max(...lifetimeOrders.map((order) => Number(order.date))) : null,
        averageDaysBetweenOrders: lifetimeOrders.length > 1
          ? (Math.max(...lifetimeOrders.map((order) => Number(order.date))) - Math.min(...lifetimeOrders.map((order) => Number(order.date))))
            / (lifetimeOrders.length - 1) / 86_400_000
          : null,
      },
      products: orderProducts,
      deliveries: deliveryOrders,
      returns: returnRequests,
      exchanges: exchangeRequests,
      reviews: {
        products: productReviews.map((review) => ({
          ...review,
          date: Number(review.date),
          product: productsById.get(review.productId) || null,
        })),
        distributors: distributorReviews,
      },
      cards: {
        linked: cardLinks,
        attachedToOrders: cardOrders,
        benefitRedemptions,
      },
      letters: manualLetters,
      letterDeliveries,
      storyAssignments,
      notifications: notificationsForProfile,
    });
  } catch (error) {
    console.error("Error getting customer details:", error);
    res.status(500).json({ success: false, message: "Unable to load customer details." });
  }
};

export const updateCustomerDisabledStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const disabled = req.body.disabled;
    const reason = String(req.body.reason || "").trim().slice(0, 1000);
    if (typeof disabled !== "boolean") {
      return res.status(400).json({ success: false, message: "A boolean disabled value is required." });
    }
    if (disabled && !reason) {
      return res.status(400).json({ success: false, message: "Provide a reason when disabling a customer account." });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountId: true, isDisabled: true, disabledAt: true, disabledBy: true, disabledReason: true },
    });
    if (!currentUser) return res.status(404).json({ success: false, message: "Customer not found." });
    if (currentUser.isDisabled === disabled) {
      return res.json({ success: true, message: disabled ? "Customer account is already disabled." : "Customer account is already enabled.", isDisabled: disabled });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          isDisabled: disabled,
          disabledAt: disabled ? now : null,
          disabledBy: disabled ? req.auth.accountId : null,
          disabledReason: disabled ? reason : null,
        },
      });
      if (disabled && currentUser.accountId) {
        await tx.authSession.updateMany({
          where: { accountId: currentUser.accountId, revokedAt: null },
          data: { revokedAt: now, revocationReason: "CUSTOMER_ACCOUNT_DISABLED" },
        });
      }
      await recordSystemAudit({
        actorId: req.auth.accountId,
        actorRole: req.auth.role,
        portalSource: "ADMIN",
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        correlationId: req.correlationId || null,
      }, {
        action: disabled ? "CUSTOMER_ACCOUNT_DISABLED" : "CUSTOMER_ACCOUNT_RE_ENABLED",
        entityType: "CUSTOMER",
        entityId: userId,
        beforeState: {
          isDisabled: currentUser.isDisabled,
          disabledAt: currentUser.disabledAt,
          disabledBy: currentUser.disabledBy,
          disabledReason: currentUser.disabledReason,
        },
        afterState: {
          isDisabled: disabled,
          disabledAt: disabled ? now : null,
          disabledBy: disabled ? req.auth.accountId : null,
          disabledReason: disabled ? reason : null,
        },
      }, { client: tx });
    });

    return res.json({
      success: true,
      message: disabled ? "Customer account disabled and active sessions revoked." : "Customer account re-enabled.",
      isDisabled: disabled,
      disabledAt: disabled ? now : null,
    });
  } catch (error) {
    console.error("Error updating customer account status:", error);
    return res.status(500).json({ success: false, message: "Unable to update the customer account status." });
  }
};

// POST /api/customer/letter/upload (Admin only)
export const uploadCustomerLetter = async (req, res) => {
  try {
    const { userId, title, notes, orderId } = req.body;
    const file = req.file;

    if (!userId) {
      return res.json({ success: false, message: "User ID is required" });
    }
    if (!file) {
      return res.json({ success: false, message: "Letter image file is required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.json({ success: false, message: "Customer not found" });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder: "aama_customer_letters",
    });

    const letterRecord = await prisma.customerLetterImage.create({
      data: {
        userId,
        userEmail: user.email,
        imageUrl: uploadResult.secure_url,
        title: (title || "Handwritten Letter / Dispatch Note").trim(),
        notes: (notes || "").trim(),
        orderId: orderId ? orderId.trim() : null,
      },
    });

    res.json({
      success: true,
      message: "Letter image stored successfully",
      letter: letterRecord,
    });
  } catch (error) {
    console.error("Error uploading customer letter:", error);
    res.json({ success: false, message: error.message });
  }
};

// DELETE /api/customer/letter/:id (Admin only)
export const deleteCustomerLetter = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.customerLetterImage.delete({ where: { id } });
    res.json({ success: true, message: "Letter image deleted successfully" });
  } catch (error) {
    console.error("Error deleting customer letter:", error);
    res.json({ success: false, message: error.message });
  }
};
