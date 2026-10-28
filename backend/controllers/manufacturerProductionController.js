import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { ensureAccountingParty } from "../services/accountingPartyService.js";
import { postJournalEntry } from "../services/accountingPostingEngine.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { buildManufacturerStockMovements, normalizeStockAdjustmentReason } from "../services/manufacturerInventoryAudit.js";
import { ensureInventoryLocation, receiveCompletedProductionLine } from "../services/inventoryLedgerService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import {
  calculateProductionUnitCost,
  calculateFullyLoadedUnitCogs,
  normalizeProductionVatTerms,
  normalizeProductionRequestLines,
  validateManufacturerProductionQuote,
} from "../services/manufacturerProductionService.js";
import {
  validateAdminProductionPlan,
  validatePostProductionChecklist,
  summarizeManufacturerProductionDashboard,
  validatePreProductionChecklist,
} from "../services/manufacturerProductionWorkflowService.js";

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const actorContext = (req) => ({
  actorId: req.auth?.accountId || null,
  actorRole: req.auth?.role || "SYSTEM",
  portalSource: req.auth?.role || "SYSTEM",
  ipAddress: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  correlationId: req.correlationId || null,
});

export const getManufacturerProductionDashboard = async (req, res) => {
  try {
    const [factoryBalances, productionRequests] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where: {
          location: {
            kind: "FACTORY",
            manufacturerId: req.manufacturerId,
            inventoryOwner: "PLATFORM",
            isActive: true,
          },
          inventorySku: { isActive: true },
        },
        select: {
          inventorySkuId: true,
          quantityOnHand: true,
          reservedQuantity: true,
          inventorySku: { select: { productId: true } },
        },
      }),
      prisma.manufacturerProductionRequest.findMany({
        where: { manufacturerId: req.manufacturerId },
        select: {
          status: true,
          lines: { select: { actualQuantity: true, damagedQuantity: true } },
        },
      }),
    ]);
    return res.json({
      success: true,
      dashboard: summarizeManufacturerProductionDashboard({ factoryBalances, productionRequests }),
    });
  } catch (error) {
    console.error("getManufacturerProductionDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load manufacturer production dashboard.",
    });
  }
};

const getProductVariants = (product) => {
  const variants = parseArray(product.variants);
  if (variants.length) {
    return variants.map((variant) => ({
      size: String(variant.size || "Standard").trim(),
      color: String(variant.color || "Standard").trim(),
    }));
  }
  const sizes = parseArray(product.sizes);
  const colors = parseArray(product.colors).map((color) => typeof color === "object" ? color.name : color);
  if (!sizes.length) return [{ size: "Standard", color: "Standard" }];
  if (!colors.length) return sizes.map((size) => ({ size: String(size), color: "Standard" }));
  return sizes.flatMap((size) => colors.map((color) => ({ size: String(size), color: String(color) })));
};

const validRequestLines = (product, lines) => {
  const catalogVariants = new Set(getProductVariants(product).map((variant) =>
    JSON.stringify([variant.size.toLowerCase(), variant.color.toLowerCase()])
  ));
  if (lines.some((line) => !catalogVariants.has(JSON.stringify([line.size.toLowerCase(), line.color.toLowerCase()])))) {
    throw Object.assign(new Error("Production requests can include only size/color variants configured for this product."), { statusCode: 400 });
  }
};

export const listProductionRequests = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const status = String(req.query.status || "").trim().toUpperCase();
    const requestedManufacturerId = String(req.query.manufacturerId || "").trim();
    const where = {
      ...(req.manufacturerId
        ? { manufacturerId: req.manufacturerId }
        : req.auth?.role === "ADMIN" && requestedManufacturerId
          ? { manufacturerId: requestedManufacturerId }
          : {}),
      ...(status && status !== "ALL" ? { status } : {}),
    };
    const [requests, total] = await prisma.$transaction([
      prisma.manufacturerProductionRequest.findMany({
        where,
        include: {
          manufacturer: { select: { id: true, name: true, city: true } },
          product: { select: { id: true, name: true, image: true } },
          lines: { orderBy: [{ size: "asc" }, { color: "asc" }] },
        },
        orderBy: { requestedAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.manufacturerProductionRequest.count({ where }),
    ]);
    return res.json(paginatedResponse("requests", requests, pagination, total));
  } catch (error) {
    console.error("listProductionRequests error:", error);
    return res.status(500).json({ success: false, message: "Unable to load production requests." });
  }
};

export const getAdminProductionOptions = async (req, res) => {
  try {
    const optionType = String(req.query.type || "").trim().toLowerCase();
    if (!["manufacturers", "products"].includes(optionType)) {
      return res.status(400).json({ success: false, message: "Choose manufacturers or products." });
    }
    const pagination = getPagination(req.query);
    if (optionType === "manufacturers") {
      const where = { isActive: true, contractStatus: "ACTIVE" };
      const [manufacturers, total] = await prisma.$transaction([
        prisma.manufacturer.findMany({
          where,
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          skip: pagination.skip,
          take: pagination.limit,
        }),
        prisma.manufacturer.count({ where }),
      ]);
      return res.json(paginatedResponse("manufacturers", manufacturers, pagination, total));
    }
    const where = { published: true, deletedAt: null };
    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        select: { id: true, name: true, sizes: true, colors: true, variants: true },
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.product.count({ where }),
    ]);
    return res.json(paginatedResponse("products", products, pagination, total));
  } catch (error) {
    console.error("getAdminProductionOptions error:", error);
    return res.status(500).json({ success: false, message: "Unable to load production order options." });
  }
};

export const createAdminProductionRequest = async (req, res) => {
  try {
    const manufacturerId = String(req.body.manufacturerId || "").trim();
    const productId = String(req.body.productId || "").trim();
    if (!manufacturerId || !productId) {
      return res.status(400).json({ success: false, message: "Manufacturer and product are required." });
    }
    const manufacturer = await prisma.manufacturer.findFirst({
      where: { id: manufacturerId, isActive: true, contractStatus: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!manufacturer) return res.status(404).json({ success: false, message: "Active manufacturer not found." });

    const product = await prisma.product.findFirst({
      where: { id: productId, published: true, deletedAt: null },
      select: { id: true, name: true, sizes: true, colors: true, variants: true },
    });
    if (!product) return res.status(404).json({ success: false, message: "Published product not found." });
    const normalized = normalizeProductionRequestLines(req.body.lines);
    validRequestLines(product, normalized.lines);
    const plan = validateAdminProductionPlan(req.body);
    if (plan.batchQuantity !== normalized.totalQuantity) {
      return res.status(400).json({ success: false, message: "Batch planned quantities must equal the requested size/color quantities." });
    }
    const adminNote = String(req.body.adminNote || "").trim();
    if (adminNote.length > 2000) return res.status(400).json({ success: false, message: "Admin note cannot exceed 2000 characters." });

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.manufacturerProductionRequest.create({
        data: {
          manufacturerId,
          productId,
          productName: product.name,
          status: "PENDING_MANUFACTURER_QUOTE",
          proposedUnitCogs: null,
          minimumOrderQuantity: normalized.totalQuantity,
          proposedDeliveryCost: 0,
          approvedDeliveryCost: 0,
          costTermsVersion: 2,
          fabricType: plan.fabricType,
          gsm: plan.gsm,
          targetCompletionDate: plan.targetCompletionDate,
          batchPlan: plan.batches,
          adminNote: adminNote || null,
          requestedBy: req.auth?.accountId || null,
          lines: { create: normalized.lines },
        },
        include: {
          manufacturer: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
          lines: true,
        },
      });
      await recordSystemAudit(actorContext(req), {
        action: "ADMIN_MANUFACTURER_PRODUCTION_ORDER_CREATED",
        entityType: "ManufacturerProductionRequest",
        entityId: created.id,
        afterState: {
          manufacturerId,
          productId,
          totalQuantity: normalized.totalQuantity,
          fabricType: plan.fabricType,
          gsm: plan.gsm.toFixed(2),
          targetCompletionDate: plan.targetCompletionDate.toISOString(),
          batches: plan.batches,
        },
      }, { client: tx });
      return created;
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({ success: true, message: "Production order sent to the manufacturer for a cost quote.", request });
  } catch (error) {
    console.error("createAdminProductionRequest error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Unable to create production order." });
  }
};

export const submitPreProductionChecklist = async (req, res) => {
  try {
    const checklist = validatePreProductionChecklist(req.body.checklist || req.body);
    const { id } = req.params;
    const request = await prisma.manufacturerProductionRequest.findFirst({
      where: { id, manufacturerId: req.manufacturerId },
      include: { lines: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Production request not found." });
    if (!["PENDING_PRE_CHECK", "PRE_CHECK_FAILED", "APPROVED"].includes(request.status)) {
      return res.status(409).json({ success: false, message: "Pre-production checklist can only be submitted before production starts." });
    }
    const status = checklist.passed ? "PRE_CHECK_PASSED" : "PRE_CHECK_FAILED";
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id, manufacturerId: req.manufacturerId, status: request.status },
        data: {
          preProductionChecklist: checklist,
          preProductionCheckedAt: new Date(),
          status,
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production request changed while the checklist was being recorded."), { statusCode: 409 });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_PRE_PRODUCTION_CHECKLIST_RECORDED",
        entityType: "ManufacturerProductionRequest",
        entityId: id,
        beforeState: { status: request.status },
        afterState: { status, checklist },
      }, { client: tx });
      return tx.manufacturerProductionRequest.findUnique({ where: { id }, include: { lines: true } });
    }, { isolationLevel: "Serializable" });
    return res.status(checklist.passed ? 200 : 422).json({
      success: checklist.passed,
      message: checklist.passed ? "Pre-production checklist passed." : "Resolve failed checklist items before starting production.",
      request: updated,
    });
  } catch (error) {
    console.error("submitPreProductionChecklist error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

export const submitManufacturerProductionQuote = async (req, res) => {
  try {
    const { id } = req.params;
    const quote = validateManufacturerProductionQuote(req.body);
    const request = await prisma.manufacturerProductionRequest.findFirst({
      where: { id, manufacturerId: req.manufacturerId },
      include: { lines: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Production request not found." });
    if (request.status !== "PENDING_MANUFACTURER_QUOTE") {
      return res.status(409).json({ success: false, message: "A quote can only be submitted for a production order awaiting manufacturer pricing." });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id, manufacturerId: req.manufacturerId, status: "PENDING_MANUFACTURER_QUOTE" },
        data: {
          status: "PENDING_ADMIN_APPROVAL",
          proposedUnitCogs: quote.unitCogs,
          proposedDeliveryCost: quote.otherCost,
          vatTreatment: quote.vatTreatment,
          vatRate: quote.vatRate,
          vatInvoiceReference: quote.vatInvoiceReference,
          manufacturerNote: quote.manufacturerNote,
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production request changed while the quote was being submitted."), { statusCode: 409 });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_PRODUCTION_QUOTED",
        entityType: "ManufacturerProductionRequest",
        entityId: id,
        afterState: {
          averagePricePerUnit: quote.unitCogs.toFixed(2),
          otherCost: quote.otherCost.toFixed(2),
          vatTreatment: quote.vatTreatment,
          vatRate: quote.vatRate.toFixed(2),
          vatInvoiceReference: quote.vatInvoiceReference,
          manufacturerNote: quote.manufacturerNote,
        },
      }, { client: tx });
      return tx.manufacturerProductionRequest.findUnique({ where: { id }, include: { lines: true } });
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, message: "Production quote submitted for admin approval.", request: updated });
  } catch (error) {
    console.error("submitManufacturerProductionQuote error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

export const reviewProductionRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const decision = String(req.body.decision || "").trim().toUpperCase();
    const adminNote = String(req.body.adminNote || "").trim();
    if (!["APPROVE", "REJECT"].includes(decision)) return res.status(400).json({ success: false, message: "Choose approve or reject." });
    if (adminNote.length > 2000) return res.status(400).json({ success: false, message: "Admin note cannot exceed 2000 characters." });

    const updated = await prisma.$transaction(async (tx) => {
      const request = await tx.manufacturerProductionRequest.findUnique({
        where: { id },
        include: { lines: true, manufacturer: { select: { name: true } }, product: { select: { id: true, name: true } } },
      });
      if (!request) throw Object.assign(new Error("Production request not found."), { statusCode: 404 });
      if (!["PENDING_ADMIN_APPROVAL", "PENDING_REVIEW"].includes(request.status)) {
        throw Object.assign(new Error("Only manufacturer production quotes awaiting admin approval can be reviewed."), { statusCode: 409 });
      }
      if (decision === "APPROVE" && !request.proposedUnitCogs) {
        throw Object.assign(new Error("The manufacturer must submit a per-piece production quote before approval."), { statusCode: 409 });
      }

      const isApproval = decision === "APPROVE";
      const unitCogs = isApproval
        ? new Prisma.Decimal(String(req.body.approvedUnitCogs ?? request.proposedUnitCogs))
        : null;
      const otherCost = isApproval
        ? new Prisma.Decimal(String(
          req.body.approvedOtherCost ?? req.body.approvedDeliveryCost ?? request.proposedDeliveryCost
        ))
        : null;
      const requestedQuantity = request.lines.reduce((total, line) => total + line.quantity, 0);
      const vatTerms = isApproval ? normalizeProductionVatTerms({
        vatTreatment: req.body.approvedVatTreatment ?? request.vatTreatment,
        vatRate: req.body.approvedVatRate ?? request.vatRate,
        vatInvoiceReference: req.body.approvedVatInvoiceReference ?? request.vatInvoiceReference,
      }) : null;
      const vatInvoiceVerified = isApproval && vatTerms.vatTreatment !== "EXEMPT" &&
        req.body.approvedVatInvoiceVerified === true;
      const plannedQuantity = requestedQuantity;
      let inventoryUnitCogs = null;
      if (isApproval) {
        if (!unitCogs.isFinite() || !unitCogs.greaterThan(0) || !otherCost.isFinite() || otherCost.isNegative()) {
          throw Object.assign(new Error("Approved per-piece COGS and batch other cost are invalid."), { statusCode: 400 });
        }
        inventoryUnitCogs = request.costTermsVersion >= 2 && plannedQuantity > 0
          ? calculateFullyLoadedUnitCogs({
            unitCogs: calculateProductionUnitCost({
              unitAmount: unitCogs,
              ...vatTerms,
              vatInvoiceVerified,
            }).capitalizedAmount,
            batchOtherCost: otherCost,
            goodQuantity: plannedQuantity,
          })
          : calculateProductionUnitCost({
            unitAmount: unitCogs,
            ...vatTerms,
            vatInvoiceVerified,
          }).capitalizedAmount.toDecimalPlaces(14, Prisma.Decimal.ROUND_HALF_UP);
      }
      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id, status: request.status },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          adminNote: adminNote || null,
          reviewedBy: req.auth?.accountId || null,
          reviewedAt: new Date(),
          ...(decision === "APPROVE" ? {
            approvedUnitCogs: unitCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            approvedMinimumOrderQuantity: requestedQuantity,
            approvedDeliveryCost: otherCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            approvedVatTreatment: vatTerms.vatTreatment,
            approvedVatRate: vatTerms.vatRate,
            approvedVatInvoiceReference: vatTerms.vatInvoiceReference,
            approvedVatInvoiceVerified: vatInvoiceVerified,
          } : {}),
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production quote changed while it was being reviewed. Refresh and retry."), { statusCode: 409 });

      if (decision === "APPROVE") {
        await tx.manufacturerInventory.upsert({
          where: { manufacturerId_productId: { manufacturerId: request.manufacturerId, productId: request.productId } },
          create: {
            manufacturerId: request.manufacturerId,
            productId: request.productId,
            productName: request.productName,
            quantity: 0,
            reservedQty: 0,
            variantsStock: request.lines.map((line) => ({ size: line.size, color: line.color, quantity: 0, reservedQty: 0 })),
            proposedCostPrice: Number(inventoryUnitCogs),
            agreedCostPrice: Number(inventoryUnitCogs),
            priceStatus: "APPROVED",
            priceNote: `Approved from production request ${request.id}`,
            adminFeedback: adminNote || "Production terms approved.",
          },
          update: {
            agreedCostPrice: Number(inventoryUnitCogs),
            priceStatus: "APPROVED",
            priceNote: `Approved from production request ${request.id}`,
            adminFeedback: adminNote || "Production terms approved.",
          },
        });
      }

      await recordSystemAudit(actorContext(req), {
        action: decision === "APPROVE" ? "MANUFACTURER_PRODUCTION_APPROVED" : "MANUFACTURER_PRODUCTION_REJECTED",
        entityType: "ManufacturerProductionRequest",
        entityId: request.id,
        beforeState: { status: request.status },
        afterState: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          ...(decision === "APPROVE" ? {
            approvedUnitCogs: unitCogs.toFixed(2),
            approvedMinimumOrderQuantity: requestedQuantity,
            approvedOtherCost: otherCost.toFixed(2),
            approvedVatTreatment: vatTerms.vatTreatment,
            approvedVatRate: vatTerms.vatRate.toFixed(2),
            approvedVatInvoiceReference: vatTerms.vatInvoiceReference,
            approvedVatInvoiceVerified: vatInvoiceVerified,
          } : {}),
        },
      }, { client: tx });
      return tx.manufacturerProductionRequest.findUnique({ where: { id }, include: { lines: true } });
    }, { isolationLevel: "Serializable" });

    return res.json({ success: true, message: `Production request ${decision.toLowerCase()}d.`, request: updated });
  } catch (error) {
    console.error("reviewProductionRequest error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Unable to review production request." });
  }
};

export const startProduction = async (req, res) => {
  try {
    const { id } = req.params;
    const changed = await prisma.manufacturerProductionRequest.updateMany({
      where: {
        id,
        manufacturerId: req.manufacturerId,
        status: "PRE_CHECK_PASSED",
        approvedUnitCogs: { not: null },
        approvedMinimumOrderQuantity: { not: null },
        approvedDeliveryCost: { not: null },
      },
      data: { status: "IN_PRODUCTION", startedAt: new Date() },
    });
    if (changed.count !== 1) {
      const exists = await prisma.manufacturerProductionRequest.findFirst({ where: { id, manufacturerId: req.manufacturerId } });
      return res.status(exists ? 409 : 404).json({
        success: false,
        message: exists
          ? "Production requires Admin-approved terms and a passed pre-production checklist."
          : "Production request not found.",
      });
    }
    await recordSystemAudit(actorContext(req), {
      action: "MANUFACTURER_PRODUCTION_STARTED",
      entityType: "ManufacturerProductionRequest",
      entityId: id,
      afterState: { status: "IN_PRODUCTION" },
    });
    return res.json({ success: true, message: "Production started." });
  } catch (error) {
    console.error("startProduction error:", error);
    return res.status(500).json({ success: false, message: "Unable to start production." });
  }
};

export const completeProduction = async (req, res) => {
  try {
    const { id } = req.params;
    const completed = await prisma.$transaction(async (tx) => {
      const request = await tx.manufacturerProductionRequest.findUnique({
        where: { id },
        include: { lines: true, manufacturer: { select: { id: true, name: true } } },
      });
      if (!request || request.manufacturerId !== req.manufacturerId) {
        throw Object.assign(new Error("Production request not found."), { statusCode: 404 });
      }
      if (!["IN_PRODUCTION", "POST_CHECK_FAILED"].includes(request.status)) {
        throw Object.assign(new Error("Only a request in production can be completed."), { statusCode: 409 });
      }
      if (!request.approvedUnitCogs || request.approvedMinimumOrderQuantity === null || request.approvedDeliveryCost === null) {
        throw Object.assign(new Error("The production request is missing approved cost terms."), { statusCode: 409 });
      }
      const checklist = validatePostProductionChecklist(req.body.checklist || req.body, request.lines);
      if (!checklist.passed) {
        await tx.manufacturerProductionRequest.update({
          where: { id: request.id },
          data: {
            status: "POST_CHECK_FAILED",
            postProductionChecklist: checklist,
            postProductionCheckedAt: new Date(),
          },
        });
        for (const actual of checklist.actualCounts) {
          await tx.manufacturerProductionRequestLine.update({
            where: { requestId_size_color: { requestId: request.id, size: actual.size, color: actual.color } },
            data: { actualQuantity: actual.quantity, damagedQuantity: actual.damagedQuantity },
          });
        }
        await recordSystemAudit(actorContext(req), {
          action: "MANUFACTURER_POST_PRODUCTION_CHECKLIST_FAILED",
          entityType: "ManufacturerProductionRequest",
          entityId: request.id,
          beforeState: { status: request.status },
          afterState: { status: "POST_CHECK_FAILED", checklist },
        }, { client: tx });
        return { failed: true, requestId: request.id };
      }
      const product = await tx.product.findUnique({ where: { id: request.productId }, select: { id: true, name: true } });
      if (!product) throw Object.assign(new Error("The requested product no longer exists."), { statusCode: 409 });

      for (const actual of checklist.actualCounts) {
        await tx.manufacturerProductionRequestLine.update({
          where: { requestId_size_color: { requestId: request.id, size: actual.size, color: actual.color } },
          data: { actualQuantity: actual.quantity, damagedQuantity: actual.damagedQuantity },
        });
      }
      const inventory = await tx.manufacturerInventory.findUnique({
        where: { manufacturerId_productId: { manufacturerId: request.manufacturerId, productId: request.productId } },
      });
      const factoryLocation = await ensureInventoryLocation(tx, {
        kind: "FACTORY",
        manufacturerId: request.manufacturerId,
        name: `${product.name} Factory`,
      });
      const previousVariants = parseArray(inventory?.variantsStock);
      const variantsByKey = new Map(previousVariants.map((variant) => [
        JSON.stringify([String(variant.size || "Standard").trim().toLowerCase(), String(variant.color || "Standard").trim().toLowerCase()]),
        { ...variant },
      ]));
      const actualByKey = new Map(checklist.actualCounts.map((line) => [
        JSON.stringify([line.size.toLowerCase(), line.color.toLowerCase()]),
        line,
      ]));
      let productionQuantity = 0;
      let damagedQuantity = 0;
      for (const line of request.lines) {
        const actual = actualByKey.get(JSON.stringify([line.size.toLowerCase(), line.color.toLowerCase()]));
        productionQuantity += actual.quantity - actual.damagedQuantity;
        damagedQuantity += actual.damagedQuantity;
      }
      const batchOtherCost = new Prisma.Decimal(String(request.approvedDeliveryCost || 0));
      const unitCogs = new Prisma.Decimal(String(request.approvedUnitCogs));
      const productionCost = calculateProductionUnitCost({
        unitAmount: unitCogs,
        vatTreatment: request.approvedVatTreatment,
        vatRate: request.approvedVatRate,
        vatInvoiceReference: request.approvedVatInvoiceReference,
        vatInvoiceVerified: request.approvedVatInvoiceVerified,
      });
      const fullyLoadedUnitCogs = request.costTermsVersion >= 2
        ? calculateFullyLoadedUnitCogs({
          unitCogs: productionCost.capitalizedAmount,
          batchOtherCost,
          goodQuantity: productionQuantity,
        })
        : productionCost.capitalizedAmount;
      for (const line of request.lines) {
        const actual = actualByKey.get(JSON.stringify([line.size.toLowerCase(), line.color.toLowerCase()]));
        const goodQuantity = actual.quantity - actual.damagedQuantity;
        const key = JSON.stringify([line.size.toLowerCase(), line.color.toLowerCase()]);
        const current = variantsByKey.get(key) || { size: line.size, color: line.color, quantity: 0, reservedQty: 0 };
        const reservedQty = Number(current.reservedQty || 0);
        variantsByKey.set(key, {
          ...current,
          quantity: Number(current.quantity || 0) + goodQuantity,
          reservedQty,
        });
        if (!goodQuantity) continue;
        await receiveCompletedProductionLine({
          tx,
          requestId: request.id,
          manufacturerId: request.manufacturerId,
          productId: request.productId,
          factoryLocationId: factoryLocation.id,
          size: line.size,
          color: line.color,
          quantity: goodQuantity,
          unitCogs: fullyLoadedUnitCogs,
          unitVatAmount: productionCost.vatAmount,
          vatTreatment: productionCost.vatTreatment,
          vatRate: productionCost.vatRate,
          vatInvoiceVerified: request.approvedVatInvoiceVerified,
          unitDeliveryCost: request.costTermsVersion >= 2 ? 0 : request.approvedDeliveryCost,
          actorId: req.auth?.accountId || req.auth?.profileId,
          actorRole: req.auth?.role || "MANUFACTURER",
        });
      }
      const nextVariants = [...variantsByKey.values()];
      const totalQuantity = nextVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
      const totalReservedQty = nextVariants.reduce((sum, variant) => sum + Number(variant.reservedQty || 0), 0);
      if (totalQuantity > 2147483647 || totalReservedQty > 2147483647) {
        throw Object.assign(new Error("Completed production would exceed the supported inventory quantity limit."), { statusCode: 409 });
      }
      const movements = buildManufacturerStockMovements({
        previousVariants,
        nextVariants,
        productId: product.id,
        productName: product.name,
        manufacturerId: request.manufacturerId,
        actorId: req.auth?.accountId || null,
        reason: "PRODUCTION_COMPLETED",
        note: `Production request ${request.id}`,
      });
      await tx.manufacturerInventory.upsert({
        where: { manufacturerId_productId: { manufacturerId: request.manufacturerId, productId: product.id } },
        create: {
          manufacturerId: request.manufacturerId,
          productId: product.id,
          productName: product.name,
          quantity: totalQuantity,
          reservedQty: totalReservedQty,
          variantsStock: nextVariants,
          proposedCostPrice: Number(request.approvedUnitCogs),
          agreedCostPrice: Number(fullyLoadedUnitCogs),
          priceStatus: "APPROVED",
        },
        update: {
          productName: product.name,
          quantity: totalQuantity,
          reservedQty: totalReservedQty,
          variantsStock: nextVariants,
          agreedCostPrice: Number(fullyLoadedUnitCogs),
          priceStatus: "APPROVED",
        },
      });
      if (movements.length) await tx.manufacturerInventoryMovement.createMany({ data: movements });

      const productionCogs = fullyLoadedUnitCogs
        .mul(productionQuantity)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const recoverableInputVat = productionCost.recoverableVat
        .mul(productionQuantity)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const manufacturerPayable = productionCogs.plus(recoverableInputVat)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const party = await ensureAccountingParty({
        partyType: "MANUFACTURER",
        sourceEntityId: request.manufacturerId,
        displayName: request.manufacturer.name,
      }, { client: tx });
      if (productionCogs.greaterThan(0)) {
        await postJournalEntry({
          transactionDate: new Date(),
          sourceType: "MANUFACTURER_PRODUCTION",
          sourceId: request.id,
          idempotencyKey: `MANUFACTURER_PRODUCTION:${request.id}`,
          referenceNumber: `MFG-PROD-${request.id.slice(-8).toUpperCase()}`,
          description: `Completed production of ${productionQuantity} ${product.name} units`,
          lines: [
            {
              mappingKey: "INVENTORY",
              debit: productionCogs,
              credit: 0,
              description: `Inventory received from production request ${request.id}`,
              productId: product.id,
            },
            ...(recoverableInputVat.greaterThan(0) ? [{
              mappingKey: "INPUT_VAT_RECEIVABLE",
              debit: recoverableInputVat,
              credit: 0,
              description: `Verified manufacturer VAT invoice ${request.approvedVatInvoiceReference || ""}`,
              supplierId: request.manufacturerId,
              accountingPartyId: party.id,
            }] : []),
            {
              mappingKey: "MANUFACTURER_PAYABLE",
              debit: 0,
              credit: manufacturerPayable,
              description: `Production COGS payable to ${request.manufacturer.name}`,
              supplierId: request.manufacturerId,
              accountingPartyId: party.id,
            },
          ],
          client: tx,
        });
      }

      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id: request.id, manufacturerId: request.manufacturerId, status: request.status },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          postProductionChecklist: checklist,
          postProductionCheckedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production request changed before completion could be recorded."), { statusCode: 409 });
      await syncProductStock(product.id, { client: tx, throwOnError: true });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_PRODUCTION_COMPLETED",
        entityType: "ManufacturerProductionRequest",
        entityId: request.id,
        beforeState: { status: request.status, inventoryQuantity: inventory?.quantity || 0 },
        afterState: {
          status: "COMPLETED",
          inventoryQuantity: totalQuantity,
          factoryLocationId: factoryLocation.id,
          producedQuantity: productionQuantity,
          damagedQuantity,
          approvedUnitCogs: unitCogs.toFixed(2),
          approvedVatTreatment: productionCost.vatTreatment,
          approvedVatRate: productionCost.vatRate.toFixed(2),
          vatInvoiceReference: request.approvedVatInvoiceReference,
          vatInvoiceVerified: request.approvedVatInvoiceVerified,
          productionVatAmount: recoverableInputVat.toFixed(2),
          productionOtherCost: request.costTermsVersion >= 2 ? batchOtherCost.toFixed(2) : "0.00",
          fullyLoadedUnitCogs: fullyLoadedUnitCogs.toFixed(2),
          productionCogs: productionCogs.toFixed(2),
          deliveryOverheadAccrued: request.costTermsVersion >= 2 ? "0.00" : batchOtherCost.toFixed(2),
        },
      }, { client: tx });
      return {
        requestId: request.id,
        productId: product.id,
        factoryLocationId: factoryLocation.id,
        producedQuantity: productionQuantity,
        damagedQuantity,
        productionCogs: productionCogs.toFixed(2),
      };
    }, { isolationLevel: "Serializable" });
    if (completed.failed) {
      return res.status(422).json({
        success: false,
        message: "Resolve failed post-production checks before inventory can be received.",
        requestId: completed.requestId,
      });
    }
    return res.json({ success: true, message: "Production completed; inventory and COGS payable were recorded.", ...completed });
  } catch (error) {
    console.error("completeProduction error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Unable to complete production." });
  }
};
