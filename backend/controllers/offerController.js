import { prisma } from "../config/db.js";

// Helper: Safely parse JSON array field from Prisma
const parseJsonArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Helper: safely convert Prisma JSON field to plain array
const toImageArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
};

// GET /api/offer/active - Public endpoint to get currently running festive/special offer
const getActiveOffer = async (req, res) => {
  try {
    const now = new Date();

    // 1. Check for active Campaign in SpecialOffer table
    let activeCampaign = null;
    try {
      activeCampaign = await prisma.specialOffer.findFirst({
        where: {
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (e) {
      // Model might not have synced yet
      console.warn("SpecialOffer table query fallback:", e.message);
    }

    // 2. Query products that belong to this campaign OR have isSpecialOffer = true
    let campaignProductIds = activeCampaign ? parseJsonArray(activeCampaign.productIds) : [];
    
    // Find products participating in campaign or tagged directly
    const rawProducts = await prisma.product.findMany({
      where: {
        published: true,
        OR: [
          ...(campaignProductIds.length > 0 ? [{ id: { in: campaignProductIds } }] : []),
          { isSpecialOffer: true },
        ],
      },
    });

    const products = rawProducts.map((p) => ({
      ...p,
      _id: p.id,
      date: Number(p.date),
      image: toImageArray(p.image),
      categories: typeof p.category === "string" ? [p.category] : parseJsonArray(p.category),
    }));

    if (!activeCampaign && products.length === 0) {
      return res.json({ success: true, activeOffer: null });
    }

    // If campaign is set, return it with computed expiry timestamp
    if (activeCampaign) {
      return res.json({
        success: true,
        activeOffer: {
          id: activeCampaign.id,
          title: activeCampaign.title,
          subtitle: activeCampaign.subtitle,
          badgeText: activeCampaign.badgeText,
          bannerImage: activeCampaign.bannerImage,
          startDate: activeCampaign.startDate,
          endDate: activeCampaign.endDate,
          discount: activeCampaign.discount,
          products,
        },
      });
    }

    // If no campaign table entry, but individual products have special offers
    return res.json({
      success: true,
      activeOffer: {
        id: "product_special_deals",
        title: "🎉 Special Festive Deals",
        subtitle: "Hand-picked festival discounts & limited-time special prices",
        badgeText: "🎉 FESTIVE OFFER",
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        products,
      },
    });
  } catch (error) {
    console.error("Error fetching active special offer:", error);
    res.json({ success: false, message: error.message });
  }
};

// GET /api/offer/list - Admin endpoint to list all campaigns
const listOffers = async (req, res) => {
  try {
    const offers = await prisma.specialOffer.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, offers });
  } catch (error) {
    console.error("Error listing special offers:", error);
    res.json({ success: false, message: error.message });
  }
};

// POST /api/offer/create - Admin endpoint to create a campaign
const createOffer = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      badgeText,
      bannerImage,
      startDate,
      endDate,
      discount,
      productIds,
      isActive,
    } = req.body;

    if (!title || !startDate || !endDate) {
      return res.json({ success: false, message: "Title, start date, and end date are required." });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.json({ success: false, message: "End date must be after start date." });
    }

    const numDiscount = discount !== undefined && discount !== null && discount !== "" ? Number(discount) : 0;
    if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
      return res.json({ success: false, message: "Discount must be between 0% and 100%" });
    }

    const offer = await prisma.specialOffer.create({
      data: {
        title,
        subtitle: subtitle || "Exclusive festive deals and limited-time discounts",
        badgeText: badgeText || "🎉 FESTIVE OFFER",
        bannerImage: bannerImage || "",
        startDate: start,
        endDate: end,
        discount: numDiscount,
        productIds: Array.isArray(productIds) ? productIds : [],
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
    });

    res.json({ success: true, message: "Special offer campaign created successfully!", offer });
  } catch (error) {
    console.error("Error creating special offer:", error);
    res.json({ success: false, message: error.message });
  }
};

// POST /api/offer/update - Admin endpoint to update campaign
const updateOffer = async (req, res) => {
  try {
    const {
      id,
      title,
      subtitle,
      badgeText,
      bannerImage,
      startDate,
      endDate,
      discount,
      productIds,
      isActive,
    } = req.body;

    if (!id) {
      return res.json({ success: false, message: "Offer ID is required" });
    }

    let validatedDiscount = undefined;
    if (discount !== undefined && discount !== null && discount !== "") {
      const numDiscount = Number(discount);
      if (isNaN(numDiscount) || numDiscount < 0 || numDiscount > 100) {
        return res.json({ success: false, message: "Discount must be between 0% and 100%" });
      }
      validatedDiscount = numDiscount;
    }

    let parsedStart = startDate ? new Date(startDate) : undefined;
    let parsedEnd = endDate ? new Date(endDate) : undefined;
    if (parsedStart && parsedEnd && parsedEnd <= parsedStart) {
      return res.json({ success: false, message: "End date must be after start date." });
    }

    const updateData = {
      ...(title && { title }),
      ...(subtitle !== undefined && { subtitle }),
      ...(badgeText && { badgeText }),
      ...(bannerImage !== undefined && { bannerImage }),
      ...(parsedStart && { startDate: parsedStart }),
      ...(parsedEnd && { endDate: parsedEnd }),
      ...(validatedDiscount !== undefined && { discount: validatedDiscount }),
      ...(productIds !== undefined && { productIds: Array.isArray(productIds) ? productIds : [] }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    };

    const updated = await prisma.specialOffer.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, message: "Offer campaign updated!", offer: updated });
  } catch (error) {
    console.error("Error updating special offer:", error);
    res.json({ success: false, message: error.message });
  }
};

// POST /api/offer/delete - Admin endpoint to delete campaign
const deleteOffer = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.json({ success: false, message: "Offer ID is required" });
    }
    await prisma.specialOffer.delete({ where: { id } });
    res.json({ success: true, message: "Offer campaign removed." });
  } catch (error) {
    console.error("Error deleting special offer:", error);
    res.json({ success: false, message: error.message });
  }
};

export {
  getActiveOffer,
  listOffers,
  createOffer,
  updateOffer,
  deleteOffer,
};
