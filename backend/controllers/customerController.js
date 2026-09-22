import { prisma } from "../config/db.js";
import { v2 as cloudinary } from "cloudinary";
import { calculateUserLoyalty } from "./loyaltyController.js";

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

    res.json({ success: true, customers: customerList });
  } catch (error) {
    console.error("Error listing customers:", error);
    res.json({ success: false, message: error.message });
  }
};

// GET /api/customer/details/:userId (Admin only)
export const getCustomerDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const [user, orders, letters, loyaltyStatus] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      }),
      prisma.customerLetterImage.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      calculateUserLoyalty(userId),
    ]);

    if (!user) {
      return res.json({ success: false, message: "Customer not found" });
    }

    const addresses = parseJson(user.addresses, []);

    // Format orders for response
    const formattedOrders = orders.map((o) => ({
      ...o,
      date: Number(o.date),
      items: parseJson(o.items, []),
      address: parseJson(o.address, {}),
    }));

    const inactiveProfileData = parseJson(user.inactiveProfileData, {});

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
        inactiveProfileData,
        addresses,
      },
      loyalty: loyaltyStatus,
      orders: formattedOrders,
      letters,
    });
  } catch (error) {
    console.error("Error getting customer details:", error);
    res.json({ success: false, message: error.message });
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
