import { prisma } from "../config/db.js";
import { generateMonthlyCollaborationInvoices, getCollaborationSalesReport } from "../services/collaborationSalesService.js";

const safePartnerSelect = { id: true, code: true, name: true, status: true };
const productInclude = { product: true, partner: { select: safePartnerSelect } };

// Product.date is BigInt — coerce to Number so JSON.stringify works
const safeProduct = (p) => p ? { ...p, date: p.date != null ? Number(p.date) : null } : p;
const safeCollab = (c) => c ? { ...c, product: safeProduct(c.product) } : c;
const safeCollabs = (list) => list.map(safeCollab);

const getCollaboration = async (collaborationId, partnerId) => prisma.collaborationProduct.findFirst({
  where: { id: collaborationId, ...(partnerId ? { partnerId } : {}) },
  include: { ...productInclude, termsVersions: { orderBy: { version: "desc" } } },
});

export const listAdminCollaborationProducts = async (_req, res) => {
  try {
    const products = await prisma.collaborationProduct.findMany({
      orderBy: { updatedAt: "desc" },
      include: { ...productInclude, termsVersions: { orderBy: { version: "desc" } } },
    });
    return res.json({ success: true, products: safeCollabs(products) });
  } catch (error) {
    console.error("listAdminCollaborationProducts error:", error);
    return res.status(500).json({ success: false, message: "Unable to load collaboration products." });
  }
};

export const getAdminCollaborationOptions = async (_req, res) => {
  try {
    const [products, partners] = await Promise.all([
      prisma.product.findMany({
        where: { collaborationLink: null },
        orderBy: { date: "desc" },
        select: { id: true, name: true, price: true, discount: true, published: true, stockQuantity: true, image: true, category: true },
      }),
      prisma.marketingPartner.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: safePartnerSelect,
      }),
    ]);
    // Products from options query don't include BigInt date (select projection omits it) — safe to return directly
    return res.json({ success: true, products, partners });
  } catch (error) {
    console.error("getAdminCollaborationOptions error:", error);
    return res.status(500).json({ success: false, message: "Unable to load collaboration options." });
  }
};

export const assignCollaborationProduct = async (req, res) => {
  try {
    const productId = String(req.body?.productId || "").trim();
    const partnerId = String(req.body?.partnerId || "").trim();
    if (!productId || !partnerId) {
      return res.status(400).json({ success: false, message: "Product and marketing partner are required." });
    }

    const [product, partner] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.marketingPartner.findFirst({ where: { id: partnerId, status: "ACTIVE" }, select: { id: true } }),
    ]);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    if (!partner) return res.status(404).json({ success: false, message: "Active marketing partner not found." });
    if (await prisma.collaborationProduct.findUnique({ where: { productId }, select: { id: true } })) {
      return res.status(409).json({ success: false, message: "This product is already assigned to a collaboration." });
    }

    const collaboration = await prisma.$transaction(async (tx) => {
      const created = await tx.collaborationProduct.create({
        data: { productId, partnerId, listingStatus: "DRAFT" },
        include: productInclude,
      });
      await tx.product.update({ where: { id: productId }, data: { published: false } });
      return created;
    });
    return res.status(201).json({ success: true, collaboration: safeCollab(collaboration) });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ success: false, message: "This product is already assigned to a collaboration." });
    console.error("assignCollaborationProduct error:", error);
    return res.status(500).json({ success: false, message: "Unable to assign product to collaboration." });
  }
};

const proposeTerms = async ({ collaborationId, actorRole, actorId, partnerId, body }) => {
  const collaboration = await getCollaboration(collaborationId, partnerId);
  if (!collaboration) {
    const error = new Error("Collaboration product not found or access denied.");
    error.status = 404;
    throw error;
  }
  if (collaboration.partner.status !== "ACTIVE") {
    const error = new Error("The marketing partner is not active.");
    error.status = 409;
    throw error;
  }

  const fixedFeePerUnit = Number(body?.fixedFeePerUnit);
  if (!Number.isFinite(fixedFeePerUnit) || fixedFeePerUnit < 0) {
    const error = new Error("Per-unit partner fee must be a non-negative amount.");
    error.status = 400;
    throw error;
  }
  const vatTreatment = String(body?.vatTreatment || "VAT_EXCLUSIVE").trim().toUpperCase();
  if (!["VAT_EXCLUSIVE", "VAT_INCLUSIVE", "EXEMPT"].includes(vatTreatment)) {
    const error = new Error("VAT treatment must be VAT_EXCLUSIVE, VAT_INCLUSIVE, or EXEMPT.");
    error.status = 400;
    throw error;
  }
  const retailPrice = Number(body?.retailPrice ?? collaboration.product.price);
  const discountPercentage = Number(body?.discountPercentage ?? collaboration.product.discount ?? 0);
  if (!Number.isFinite(retailPrice) || retailPrice <= 0) {
    const error = new Error("Customer retail price must be a positive amount.");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
    const error = new Error("Customer discount must be between 0% and 100%.");
    error.status = 400;
    throw error;
  }
  const notes = String(body?.notes || "").trim().slice(0, 5000) || null;
  const product = collaboration.product;

  return prisma.$transaction(async (tx) => {
    await tx.collaborationTermsVersion.updateMany({
      where: {
        collaborationProductId: collaborationId,
        status: { in: ["PENDING_ADMIN", "PENDING_PARTNER"] },
      },
      data: { status: "SUPERSEDED" },
    });
    const previous = await tx.collaborationTermsVersion.findFirst({
      where: { collaborationProductId: collaborationId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (previous?.version || 0) + 1;
    const created = await tx.collaborationTermsVersion.create({
      data: {
        collaborationProductId: collaborationId,
        version,
        proposedByRole: actorRole,
        proposedById: actorId,
        status: actorRole === "ADMIN" ? "PENDING_PARTNER" : "PENDING_ADMIN",
        fixedFeePerUnit,
        retailPrice,
        discountPercentage,
        vatTreatment,
        notes,
      },
    });
    await tx.collaborationProduct.update({
      where: { id: collaborationId },
      data: { pendingTermsVersion: version },
    });
    return created;
  });
};

export const proposeAdminCollaborationTerms = async (req, res) => {
  try {
    const version = await proposeTerms({
      collaborationId: req.params.id,
      actorRole: "ADMIN",
      actorId: req.auth.profileId,
      body: req.body,
    });
    return res.status(201).json({ success: true, version });
  } catch (error) {
    console.error("proposeAdminCollaborationTerms error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to submit terms." });
  }
};

export const listPartnerCollaborationProducts = async (req, res) => {
  try {
    const products = await prisma.collaborationProduct.findMany({
      where: { partnerId: req.partnerId },
      orderBy: { updatedAt: "desc" },
      include: {
        product: true,
        termsVersions: {
          orderBy: { version: "desc" },
          select: {
            version: true,
            status: true,
            fixedFeePerUnit: true,
            retailPrice: true,
            discountPercentage: true,
            vatTreatment: true,
            notes: true,
            proposedByRole: true,
            proposedAt: true,
            respondedByRole: true,
            respondedAt: true,
          },
        },
      },
    });
    return res.json({ success: true, products: safeCollabs(products) });
  } catch (error) {
    console.error("listPartnerCollaborationProducts error:", error);
    return res.status(500).json({ success: false, message: "Unable to load your collaboration products." });
  }
};

export const proposePartnerCollaborationTerms = async (req, res) => {
  try {
    const version = await proposeTerms({
      collaborationId: req.params.id,
      actorRole: "MARKETING_PARTNER",
      actorId: req.partnerId,
      partnerId: req.partnerId,
      body: req.body,
    });
    const { proposedById: _proposedById, respondedById: _respondedById, ...safeVersion } = version;
    return res.status(201).json({ success: true, version: safeVersion });
  } catch (error) {
    console.error("proposePartnerCollaborationTerms error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to submit terms." });
  }
};

const respondToTerms = async ({ collaborationId, actorRole, actorId, partnerId, action }) => {
  if (!["ACCEPT", "REJECT"].includes(action)) {
    const error = new Error("Action must be ACCEPT or REJECT. Submit a new proposal to counteroffer.");
    error.status = 400;
    throw error;
  }
  return prisma.$transaction(async (tx) => {
    const collaboration = await tx.collaborationProduct.findFirst({
      where: { id: collaborationId, ...(partnerId ? { partnerId } : {}) },
      select: { id: true, productId: true, partnerId: true, listingStatus: true, pendingTermsVersion: true },
    });
    if (!collaboration || !collaboration.pendingTermsVersion) {
      const error = new Error("No pending terms were found for this collaboration product.");
      error.status = 404;
      throw error;
    }
    const version = await tx.collaborationTermsVersion.findUnique({
      where: { collaborationProductId_version: { collaborationProductId: collaborationId, version: collaboration.pendingTermsVersion } },
    });
    const expectedResponder = version?.proposedByRole === "ADMIN" ? "MARKETING_PARTNER" : "ADMIN";
    if (!version || version.status !== `PENDING_${expectedResponder === "ADMIN" ? "ADMIN" : "PARTNER"}` || actorRole !== expectedResponder) {
      const error = new Error("Only the other party can accept or reject the current terms proposal.");
      error.status = 409;
      throw error;
    }

    const accepted = action === "ACCEPT";
    const updatedVersion = await tx.collaborationTermsVersion.update({
      where: { id: version.id },
      data: {
        status: accepted ? "ACCEPTED" : "REJECTED",
        respondedByRole: actorRole,
        respondedById: actorId,
        respondedAt: new Date(),
      },
    });
    if (accepted) {
      await tx.product.update({
        where: { id: collaboration.productId },
        data: {
          price: Number(version.retailPrice),
          discount: Number(version.discountPercentage),
          published: collaboration.listingStatus === "ACTIVE",
        },
      });
    }
    await tx.collaborationProduct.update({
      where: { id: collaborationId },
      data: {
        pendingTermsVersion: null,
        ...(accepted ? { activeTermsVersion: version.version } : {}),
      },
    });
    return updatedVersion;
  });
};

export const respondAdminCollaborationTerms = async (req, res) => {
  try {
    const version = await respondToTerms({
      collaborationId: req.params.id,
      actorRole: "ADMIN",
      actorId: req.auth.profileId,
      action: String(req.body?.action || "").toUpperCase(),
    });
    const { proposedById: _proposedById, respondedById: _respondedById, ...safeVersion } = version;
    return res.json({ success: true, version: safeVersion });
  } catch (error) {
    console.error("respondAdminCollaborationTerms error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to respond to terms." });
  }
};

export const respondPartnerCollaborationTerms = async (req, res) => {
  try {
    const version = await respondToTerms({
      collaborationId: req.params.id,
      actorRole: "MARKETING_PARTNER",
      actorId: req.partnerId,
      partnerId: req.partnerId,
      action: String(req.body?.action || "").toUpperCase(),
    });
    return res.json({ success: true, version });
  } catch (error) {
    console.error("respondPartnerCollaborationTerms error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Unable to respond to terms." });
  }
};

export const updateAdminCollaborationListing = async (req, res) => {
  try {
    const action = String(req.body?.action || "").toUpperCase();
    if (!["PUBLISH", "PAUSE", "END"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be PUBLISH, PAUSE, or END." });
    }
    const collaboration = await prisma.collaborationProduct.findUnique({
      where: { id: req.params.id },
      include: { product: true },
    });
    if (!collaboration) return res.status(404).json({ success: false, message: "Collaboration product not found." });
    if (action === "PUBLISH" && !collaboration.activeTermsVersion) {
      return res.status(409).json({ success: false, message: "An accepted agreement is required before publishing." });
    }

    const listingStatus = action === "PUBLISH" ? "ACTIVE" : action === "PAUSE" ? "PAUSED" : "ENDED";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.collaborationProduct.update({
        where: { id: collaboration.id },
        data: { listingStatus, ...(action === "PUBLISH" ? { publishedAt: new Date() } : {}) },
        include: { ...productInclude, termsVersions: { orderBy: { version: "desc" } } },
      });
      await tx.product.update({ where: { id: collaboration.productId }, data: { published: action === "PUBLISH" } });
      return result;
    });
    return res.json({ success: true, collaboration: safeCollab(updated) });
  } catch (error) {
    console.error("updateAdminCollaborationListing error:", error);
    return res.status(500).json({ success: false, message: "Unable to update collaboration listing." });
  }
};

export const listPublicCollaborationProducts = async (_req, res) => {
  try {
    const collaborations = await prisma.collaborationProduct.findMany({
      where: {
        listingStatus: "ACTIVE",
        activeTermsVersion: { not: null },
        product: { published: true },
        partner: { status: "ACTIVE" },
      },
      orderBy: { publishedAt: "desc" },
      include: {
        product: true,
        partner: { select: { id: true, code: true, name: true } },
      },
    });
    return res.json({ success: true, collaborations: safeCollabs(collaborations) });
  } catch (error) {
    console.error("listPublicCollaborationProducts error:", error);
    return res.status(500).json({ success: false, message: "Unable to load collaboration products." });
  }
};

export const getPartnerCollaborationReport = async (req, res) => {
  try {
    const report = await getCollaborationSalesReport({ partnerId: req.partnerId });
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("getPartnerCollaborationReport error:", error);
    return res.status(500).json({ success: false, message: "Unable to load collaboration sales." });
  }
};

export const getAdminCollaborationReport = async (_req, res) => {
  try {
    const report = await getCollaborationSalesReport({});
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("getAdminCollaborationReport error:", error);
    return res.status(500).json({ success: false, message: "Unable to load collaboration sales." });
  }
};

export const getManufacturerCollaborationReport = async (req, res) => {
  try {
    const report = await getCollaborationSalesReport({ manufacturerId: req.manufacturerId });
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("getManufacturerCollaborationReport error:", error);
    return res.status(500).json({ success: false, message: "Unable to load manufacturer collaboration sales." });
  }
};

export const generateAdminCollaborationInvoices = async (req, res) => {
  try {
    const previousMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    const invoices = await generateMonthlyCollaborationInvoices({ month: req.body?.month || previousMonth });
    return res.json({ success: true, message: `${invoices.length} collaboration invoice(s) generated.`, invoices });
  } catch (error) {
    console.error("generateAdminCollaborationInvoices error:", error);
    return res.status(400).json({ success: false, message: error.message || "Unable to generate collaboration invoices." });
  }
};