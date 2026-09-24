import { prisma } from "../config/db.js";

// Default initial loyalty tiers with customizable combination perks
const DEFAULT_LEVELS = [
  {
    levelNumber: 1,
    name: "Bronze Explorer",
    badgeIcon: "🥉",
    color: "#CD7F32",
    minSpend: 0,
    minOrders: 0,
    rewardType: "NONE",
    rewardValue: 0,
    rewardTitle: "Entry Level (No Perks)",
    rewardDescription: "Welcome to Aama Clothings! Place orders to level up and unlock exclusive discounts.",
    rewardOrderLimit: 1,
    freeShipping: false,
    discountAmount: 0,
    giftAmount: 0,
    giftDescription: "",
    letterIncluded: false,
    customPerk: "",
  },
  {
    levelNumber: 2,
    name: "Silver VIP",
    badgeIcon: "🥈",
    color: "#94A3B8",
    minSpend: 3000,
    minOrders: 2,
    rewardType: "COMBO",
    rewardValue: 100,
    rewardTitle: "Rs. 100 Off + Handwritten Letter",
    rewardDescription: "Rs. 100 flat discount on next 3 orders + Personalized handwritten thank-you note.",
    rewardOrderLimit: 3,
    freeShipping: false,
    discountAmount: 100,
    giftAmount: 0,
    giftDescription: "",
    letterIncluded: true,
    customPerk: "",
  },
  {
    levelNumber: 3,
    name: "Gold Champion",
    badgeIcon: "🥇",
    color: "#F59E0B",
    minSpend: 8000,
    minOrders: 4,
    rewardType: "COMBO",
    rewardValue: 150,
    rewardTitle: "Free Delivery + Rs. 150 Off",
    rewardDescription: "Free delivery & Rs. 150 off on next 3 orders + handwritten letter.",
    rewardOrderLimit: 3,
    freeShipping: true,
    discountAmount: 150,
    giftAmount: 0,
    giftDescription: "",
    letterIncluded: true,
    customPerk: "VIP priority dispatch",
  },
  {
    levelNumber: 4,
    name: "Diamond Legend",
    badgeIcon: "💎",
    color: "#3B82F6",
    minSpend: 18000,
    minOrders: 8,
    rewardType: "COMBO",
    rewardValue: 250,
    rewardTitle: "Free Delivery + Rs. 250 Off + Rs. 500 Gift Card",
    rewardDescription: "Free shipping, Rs. 250 discount on next 3 orders, plus Rs. 500 gift voucher & luxury packaging.",
    rewardOrderLimit: 3,
    freeShipping: true,
    discountAmount: 250,
    giftAmount: 500,
    giftDescription: "Exclusive Rs. 500 Gift Voucher",
    letterIncluded: true,
    customPerk: "Exclusive VIP Luxury Packaging",
  },
];

// Helper to ensure default levels are seeded
const ensureSeedLevels = async () => {
  const count = await prisma.customerLevel.count();
  if (count === 0) {
    for (const lvl of DEFAULT_LEVELS) {
      await prisma.customerLevel.create({ data: lvl });
    }
  }
};

const toPublicLoyaltyLevel = (level = null) => {
  if (!level) return null;

  return {
    id: level.id,
    levelNumber: level.levelNumber,
    name: level.name,
    badgeIcon: level.badgeIcon,
    color: level.color,
    minSpend: Number(level.minSpend || 0),
    minOrders: Number(level.minOrders || 0),
    rewardType: level.rewardType,
    rewardValue: Number(level.rewardValue || 0),
    rewardTitle: level.rewardTitle,
    rewardDescription: level.rewardDescription,
    rewardOrderLimit: Number(level.rewardOrderLimit || 3),
    freeShipping: Boolean(level.freeShipping),
    discountAmount: Number(level.discountAmount || 0),
    giftAmount: Number(level.giftAmount || 0),
    giftDescription: level.giftDescription || "",
    letterIncluded: Boolean(level.letterIncluded),
    customPerk: level.customPerk || "",
  };
};

export const buildPublicLoyaltySummary = (loyaltyData = {}) => {
  const currentLevel = toPublicLoyaltyLevel(loyaltyData.currentLevel);
  const nextLevel = toPublicLoyaltyLevel(loyaltyData.nextLevel);
  const activeReward = loyaltyData.activeReward || {};
  const allLevels = Array.isArray(loyaltyData.allLevels)
    ? loyaltyData.allLevels.map((level) => toPublicLoyaltyLevel(level))
    : [];

  return {
    totalSpend: Number(loyaltyData.totalSpend || 0),
    totalOrders: Number(loyaltyData.totalOrders || 0),
    currentLevel,
    nextLevel,
    progressPercentage: Number(loyaltyData.progressPercentage || 0),
    remainingSpend: Number(loyaltyData.remainingSpend || 0),
    remainingOrders: Number(loyaltyData.remainingOrders || 0),
    activeReward: {
      freeShipping: Boolean(activeReward.freeShipping),
      discountAmount: Number(activeReward.discountAmount || 0),
      giftAmount: Number(activeReward.giftAmount || 0),
      giftDescription: activeReward.giftDescription || "",
      letterIncluded: Boolean(activeReward.letterIncluded),
      customPerk: activeReward.customPerk || "",
      perkTags: Array.isArray(activeReward.perkTags) ? activeReward.perkTags : [],
      title: activeReward.title,
      description: activeReward.description,
      orderLimit: Number(activeReward.orderLimit || 0),
      remainingUses: Number(activeReward.remainingUses || 0),
      currentUseIndex: Number(activeReward.currentUseIndex || 0),
      isEligible: Boolean(activeReward.isEligible),
      usageBadge: activeReward.usageBadge,
    },
    allLevels,
  };
};

// Helper to calculate a user's loyalty status based on their orders and configured levels
export const calculateUserLoyalty = async (userId) => {
  await ensureSeedLevels();

  const [levels, orders] = await Promise.all([
    prisma.customerLevel.findMany({ orderBy: { levelNumber: "asc" } }),
    prisma.order.findMany({
      where: {
        userId,
        status: { notIn: ["Cancelled"] },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const eligibleOrders = orders.filter((order) => {
    const rewardData = typeof order.rewardApplied === "string"
      ? (() => {
          try { return JSON.parse(order.rewardApplied); } catch { return {}; }
        })()
      : (order.rewardApplied || {});
    return rewardData.loyaltyExcluded !== true;
  });

  const totalOrders = eligibleOrders.length;
  const totalSpend = eligibleOrders.reduce((acc, o) => acc + Number(o.amount || 0), 0);

  // Determine highest tier achieved where user meets BOTH minSpend AND minOrders
  let currentLevel = levels[0] || DEFAULT_LEVELS[0];
  let nextLevel = null;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    if (totalSpend >= Number(lvl.minSpend) && totalOrders >= Number(lvl.minOrders)) {
      currentLevel = lvl;
      nextLevel = levels[i + 1] || null;
    }
  }

  if (!nextLevel && levels.length > 0) {
    const firstUnmet = levels.find(
      (l) => totalSpend < Number(l.minSpend) || totalOrders < Number(l.minOrders)
    );
    if (firstUnmet && firstUnmet.levelNumber > currentLevel.levelNumber) {
      nextLevel = firstUnmet;
    }
  }

  // Calculate progress percentage to next level
  let progressPercentage = 100;
  let remainingSpend = 0;
  let remainingOrders = 0;

  if (nextLevel) {
    const spendGap = Math.max(0, Number(nextLevel.minSpend) - Number(currentLevel.minSpend));
    const userSpendProgress = Math.max(0, totalSpend - Number(currentLevel.minSpend));
    const spendRatio = spendGap > 0 ? Math.min(1, userSpendProgress / spendGap) : 1;

    const ordersGap = Math.max(0, Number(nextLevel.minOrders) - Number(currentLevel.minOrders));
    const userOrdersProgress = Math.max(0, totalOrders - Number(currentLevel.minOrders));
    const ordersRatio = ordersGap > 0 ? Math.min(1, userOrdersProgress / ordersGap) : 1;

    progressPercentage = Math.round(((spendRatio + ordersRatio) / 2) * 100);
    remainingSpend = Math.max(0, Number(nextLevel.minSpend) - totalSpend);
    remainingOrders = Math.max(0, Number(nextLevel.minOrders) - totalOrders);
  }

  // Resolve modular combination perks
  const isFreeShipping = Boolean(
    currentLevel.freeShipping ||
    currentLevel.rewardType === "FREE_SHIPPING" ||
    currentLevel.rewardType === "FREE_SHIPPING_AND_DISCOUNT"
  );

  const discountAmount = Number(
    currentLevel.discountAmount !== undefined && currentLevel.discountAmount !== null
      ? currentLevel.discountAmount
      : (currentLevel.rewardType === "DISCOUNT_AMOUNT" || currentLevel.rewardType === "FREE_SHIPPING_AND_DISCOUNT"
          ? currentLevel.rewardValue
          : 0)
  ) || 0;

  const giftAmount = Number(currentLevel.giftAmount || 0);
  const giftDescription = (currentLevel.giftDescription || "").trim();
  const letterIncluded = Boolean(currentLevel.letterIncluded || currentLevel.rewardType === "HANDWRITTEN_LETTER");
  const customPerk = (currentLevel.customPerk || "").trim();

  // Has any active perk configured?
  const hasPerks = isFreeShipping || discountAmount > 0 || giftAmount > 0 || giftDescription || letterIncluded || customPerk;

  const rewardOrderLimit = Number(currentLevel.rewardOrderLimit || 3);
  const ordersSinceQualifying = Math.max(0, totalOrders - Number(currentLevel.minOrders));
  const remainingRewardUses = Math.max(0, rewardOrderLimit - ordersSinceQualifying);
  const currentUseIndex = Math.min(rewardOrderLimit, ordersSinceQualifying + 1);
  const isRewardEligible = hasPerks && remainingRewardUses > 0;

  // Build list of perk tags for display
  const perkTags = [];
  if (isFreeShipping) perkTags.push("Free Delivery");
  if (discountAmount > 0) perkTags.push(`Rs. ${discountAmount} Off`);
  if (giftAmount > 0 || giftDescription) perkTags.push(giftDescription || `Rs. ${giftAmount} Gift Voucher`);
  if (letterIncluded) perkTags.push("Handwritten Letter");
  if (customPerk) perkTags.push(customPerk);

  const activeReward = {
    freeShipping: isFreeShipping,
    discountAmount: discountAmount,
    giftAmount: giftAmount,
    giftDescription: giftDescription,
    letterIncluded: letterIncluded,
    customPerk: customPerk,
    perkTags: perkTags,
    title: currentLevel.rewardTitle,
    description: currentLevel.rewardDescription,
    orderLimit: rewardOrderLimit,
    remainingUses: remainingRewardUses,
    currentUseIndex: currentUseIndex,
    isEligible: isRewardEligible,
    usageBadge: isRewardEligible
      ? `${currentLevel.rewardTitle} (Use ${currentUseIndex} of ${rewardOrderLimit})`
      : (hasPerks ? `Reward Completed (${rewardOrderLimit}/${rewardOrderLimit} used)` : "No Perks"),
  };

  return {
    totalSpend,
    totalOrders,
    currentLevel,
    nextLevel,
    progressPercentage,
    remainingSpend,
    remainingOrders,
    activeReward,
    allLevels: levels,
  };
};

// GET /api/loyalty/levels (Public / Admin)
export const getAllLevels = async (req, res) => {
  try {
    await ensureSeedLevels();
    const levels = await prisma.customerLevel.findMany({
      orderBy: { levelNumber: "asc" },
    });
    res.json({ success: true, levels });
  } catch (error) {
    console.error("Error fetching loyalty levels:", error);
    res.json({ success: false, message: error.message });
  }
};

// POST /api/loyalty/level (Admin only) - Create or Update Level with Modular Perks
export const createOrUpdateLevel = async (req, res) => {
  try {
    const {
      id,
      levelNumber,
      name,
      badgeIcon,
      color,
      minSpend,
      minOrders,
      rewardType,
      rewardValue,
      rewardTitle,
      rewardDescription,
      rewardOrderLimit,
      freeShipping,
      discountAmount,
      giftAmount,
      giftDescription,
      letterIncluded,
      customPerk,
    } = req.body;

    if (!name) {
      return res.json({ success: false, message: "Level Name is required" });
    }

    const isFreeShipping = Boolean(freeShipping);
    const discAmt = Math.max(0, Number(discountAmount !== undefined ? discountAmount : (rewardValue || 0)));
    const giftAmt = Math.max(0, Number(giftAmount || 0));
    const giftDesc = (giftDescription || "").trim();
    const isLetter = Boolean(letterIncluded);
    const cPerk = (customPerk || "").trim();

    // Auto-generate title if not explicitly provided
    let title = (rewardTitle || "").trim();
    if (!title) {
      const parts = [];
      if (isFreeShipping) parts.push("Free Delivery");
      if (discAmt > 0) parts.push(`Rs. ${discAmt} Off`);
      if (giftAmt > 0 || giftDesc) parts.push(giftDesc || `Rs. ${giftAmt} Gift Voucher`);
      if (isLetter) parts.push("Handwritten Letter");
      if (cPerk) parts.push(cPerk);
      title = parts.length > 0 ? parts.join(" + ") : "Entry Level";
    }

    const data = {
      levelNumber: Number(levelNumber || 1),
      name: name.trim(),
      badgeIcon: badgeIcon || "⭐",
      color: color || "#3B82F6",
      minSpend: Math.max(0, Number(minSpend || 0)),
      minOrders: Math.max(0, Number(minOrders || 0)),
      rewardType: rewardType || "COMBO",
      rewardValue: discAmt,
      rewardTitle: title,
      rewardDescription: (rewardDescription || "").trim(),
      rewardOrderLimit: Math.max(1, Number(rewardOrderLimit || 3)),
      freeShipping: isFreeShipping,
      discountAmount: discAmt,
      giftAmount: giftAmt,
      giftDescription: giftDesc,
      letterIncluded: isLetter,
      customPerk: cPerk,
    };

    let level;
    if (id) {
      level = await prisma.customerLevel.update({
        where: { id },
        data,
      });
    } else {
      level = await prisma.customerLevel.create({ data });
    }

    res.json({ success: true, message: "Loyalty Level saved successfully", level });
  } catch (error) {
    console.error("Error saving loyalty level:", error);
    res.json({ success: false, message: error.message });
  }
};

// DELETE /api/loyalty/level/:id (Admin only)
export const deleteLevel = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.customerLevel.delete({ where: { id } });
    res.json({ success: true, message: "Loyalty level removed" });
  } catch (error) {
    console.error("Error deleting loyalty level:", error);
    res.json({ success: false, message: error.message });
  }
};

// GET /api/loyalty/my-status (Authenticated User)
export const getUserLoyaltyStatus = async (req, res) => {
  try {
    const userId = req.userId || req.body.userId;
    if (!userId) {
      return res.json({ success: false, message: "User ID required" });
    }

    const loyaltyData = await calculateUserLoyalty(userId);
    res.json({ success: true, loyalty: buildPublicLoyaltySummary(loyaltyData) });
  } catch (error) {
    console.error("Error fetching user loyalty status:", error);
    res.json({ success: false, message: error.message });
  }
};

// ─── MANUFACTURER LOYALTY ENDPOINTS ──────────────────────────────────────────

/**
 * GET /api/loyalty/customer-by-phone?phone=98XXXXXXXX
 * Manufacturer: Look up a customer's loyalty status by phone number.
 */
export const getCustomerLoyaltyByPhone = async (req, res) => {
  try {
    const phone = (req.query.phone || "").trim();
    if (!phone) {
      return res.json({ success: false, message: "Phone number is required" });
    }

    // Try exact match first, then last 10 digits
    const user = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true },
    });

    if (!user) {
      return res.json({
        success: true,
        found: false,
        message: "No registered account found for this phone number. Loyalty perks are not available for unregistered customers.",
      });
    }

    const loyaltyData = await calculateUserLoyalty(user.id);

    res.json({
      success: true,
      found: true,
      customer: {
        id: user.id,
        name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        email: user.email,
        phone: user.phone,
      },
      loyalty: buildPublicLoyaltySummary(loyaltyData),
    });
  } catch (error) {
    console.error("Error fetching customer loyalty by phone:", error);
    res.json({ success: false, message: error.message });
  }
};

/**
 * GET /api/loyalty/hub-customers?page=1&limit=20
 * Manufacturer: Get list of customers who have placed direct orders at this hub,
 * enriched with loyalty tier.
 */
export const getHubCustomers = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(5, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim().toLowerCase();

    // Fetch direct orders for this hub
    const directOrders = await prisma.order.findMany({
      where: {
        manufacturerId,
        orderType: "DIRECT_MANUFACTURER",
      },
      orderBy: { date: "desc" },
    });

    // Build customer map by phone (deduplicate)
    const customerMap = new Map();
    for (const order of directOrders) {
      const addr = typeof order.address === "string" ? JSON.parse(order.address) : order.address;
      const phone = (addr?.phone || "").trim();
      if (!phone) continue;

      if (!customerMap.has(phone)) {
        customerMap.set(phone, {
          phone,
          name: addr.name || `${addr.firstName || ""} ${addr.lastName || ""}`.trim() || "Unknown",
          email: addr.email || "",
          userId: order.userId && !order.userId.startsWith("GUEST_") ? order.userId : null,
          visitCount: 0,
          lastVisit: 0,
          totalSpentAtHub: 0,
          orderIds: [],
        });
      }
      const entry = customerMap.get(phone);
      entry.visitCount += 1;
      entry.totalSpentAtHub += Number(order.amount || 0);
      entry.orderIds.push(order.id);
      const orderDate = Number(order.date);
      if (orderDate > entry.lastVisit) entry.lastVisit = orderDate;
    }

    // Filter by search
    let customers = Array.from(customerMap.values());
    if (search) {
      customers = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(search) ||
          c.phone.includes(search) ||
          c.email.toLowerCase().includes(search)
      );
    }

    // Sort by last visit descending
    customers.sort((a, b) => b.lastVisit - a.lastVisit);

    const total = customers.length;
    const paginated = customers.slice(skip, skip + limit);

    // Enrich with loyalty data for registered customers
    const enriched = await Promise.all(
      paginated.map(async (c) => {
        if (c.userId) {
          try {
            const loyaltyData = await calculateUserLoyalty(c.userId);
            const publicLoyalty = buildPublicLoyaltySummary(loyaltyData);
            return {
              ...c,
              lastVisit: c.lastVisit > 0 ? new Date(c.lastVisit).toISOString() : null,
              loyalty: {
                currentLevel: publicLoyalty.currentLevel,
                totalSpend: publicLoyalty.totalSpend,
                totalOrders: publicLoyalty.totalOrders,
                progressPercentage: publicLoyalty.progressPercentage,
                nextLevel: publicLoyalty.nextLevel,
                activeReward: publicLoyalty.activeReward,
              },
              isRegistered: true,
            };
          } catch {
            return { ...c, lastVisit: c.lastVisit > 0 ? new Date(c.lastVisit).toISOString() : null, loyalty: null, isRegistered: false };
          }
        }
        return { ...c, lastVisit: c.lastVisit > 0 ? new Date(c.lastVisit).toISOString() : null, loyalty: null, isRegistered: false };
      })
    );

    res.json({
      success: true,
      customers: enriched,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching hub customers:", error);
    res.json({ success: false, message: error.message });
  }
};

/**
 * POST /api/loyalty/hub-gift
 * Manufacturer: Record that a loyalty gift/perk was physically handed to a customer.
 * Body: { orderId, giftType, giftNote, customerPhone, customerName }
 */
export const recordLoyaltyGift = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;
    const { orderId, giftType, giftNote, customerPhone, customerName } = req.body;

    if (!giftType) {
      return res.json({ success: false, message: "Gift type is required" });
    }

    // Verify order belongs to this manufacturer if orderId provided
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: { id: orderId, manufacturerId },
      });
      if (!order) {
        return res.json({ success: false, message: "Order not found or not assigned to your hub" });
      }
    }

    // Store as a CustomerLetterImage record (reusing existing model for gift tracking)
    // We embed the gift metadata in the title/notes fields
    let userId = null;
    let userEmail = null;
    if (customerPhone) {
      const user = await prisma.user.findFirst({ where: { phone: customerPhone.trim() } });
      if (user) {
        userId = user.id;
        userEmail = user.email;
      }
    }

    const giftRecord = await prisma.customerLetterImage.create({
      data: {
        userId: userId || "GUEST",
        userEmail: userEmail || "",
        imageUrl: "", // No image for gift records
        title: `[HUB GIFT] ${giftType}`,
        notes: JSON.stringify({
          giftType,
          giftNote: giftNote || "",
          customerPhone: customerPhone || "",
          customerName: customerName || "",
          manufacturerId,
          handedOver: true,
          handedOverAt: new Date().toISOString(),
        }),
        orderId: orderId || null,
      },
    });

    res.json({
      success: true,
      message: "Loyalty gift recorded successfully!",
      record: giftRecord,
    });
  } catch (error) {
    console.error("Error recording loyalty gift:", error);
    res.json({ success: false, message: error.message });
  }
};

/**
 * GET /api/loyalty/hub-gifts
 * Manufacturer: Get all gift records for this hub.
 */
export const getHubGifts = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;

    const gifts = await prisma.customerLetterImage.findMany({
      where: {
        title: { startsWith: "[HUB GIFT]" },
        notes: { contains: manufacturerId },
      },
      orderBy: { createdAt: "desc" },
    });

    const parsed = gifts.map((g) => {
      let meta = {};
      try { meta = JSON.parse(g.notes || "{}"); } catch {}
      return {
        id: g.id,
        orderId: g.orderId,
        giftType: meta.giftType || g.title.replace("[HUB GIFT] ", ""),
        giftNote: meta.giftNote || "",
        customerName: meta.customerName || "",
        customerPhone: meta.customerPhone || "",
        handedOverAt: meta.handedOverAt || g.createdAt,
        userId: g.userId,
        userEmail: g.userEmail,
        createdAt: g.createdAt,
      };
    });

    res.json({ success: true, gifts: parsed });
  } catch (error) {
    console.error("Error fetching hub gifts:", error);
    res.json({ success: false, message: error.message });
  }
};
