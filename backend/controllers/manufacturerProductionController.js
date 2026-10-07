import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { recordSystemAudit } from "../services/auditService.js";
import { ensureAccountingParty } from "../services/accountingPartyService.js";
import { postJournalEntry } from "../services/accountingPostingEngine.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { buildManufacturerStockMovements, normalizeStockAdjustmentReason } from "../services/manufacturerInventoryAudit.js";
import { ensureInventoryLocation, receiveCompletedProductionLine } from "../services/inventoryLedgerService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";
import { validateProductionRequestInput } from "../services/manufacturerProductionService.js";
import {
  validateAdminProductionPlan,
  validatePostProductionChecklist,
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

export const getProductionProducts = async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { published: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, image: true, sizes: true, colors: true, variants: true },
    });
    const requests = await prisma.manufacturerProductionRequest.findMany({
      where: { manufacturerId: req.manufacturerId, status: { in: ["PENDING_REVIEW", "APPROVED", "IN_PRODUCTION"] } },
      select: { id: true, productId: true, status: true },
    });
    const activeByProduct = new Map();
    for (const request of requests) {
      const current = activeByProduct.get(request.productId) || [];
      current.push(request);
      activeByProduct.set(request.productId, current);
    }
    return res.json({
      success: true,
      products: products.map((product) => ({
        ...product,
        variants: getProductVariants(product),
        activeProductionRequests: activeByProduct.get(product.id) || [],
      })),
    });
  } catch (error) {
    console.error("getProductionProducts error:", error);
    return res.status(500).json({ success: false, message: "Unable to load products available for production requests." });
  }
};

export const listProductionRequests = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const status = String(req.query.status || "").trim().toUpperCase();
    const where = {
      ...(req.manufacturerId ? { manufacturerId: req.manufacturerId } : {}),
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
    const normalized = validateProductionRequestInput({
      lines: req.body.lines,
      unitCogs: 1,
      minimumOrderQuantity: 1,
      deliveryCost: 0,
    });
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
          status: "PENDING_PRE_CHECK",
          proposedUnitCogs: null,
          minimumOrderQuantity: normalized.totalQuantity,
          proposedDeliveryCost: 0,
          approvedDeliveryCost: 0,
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
    return res.status(201).json({ success: true, message: "Production order created; manufacturer pre-production approval is required.", request });
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

export const setProductionMoqPricing = async (req, res) => {
  try {
    const { id } = req.params;
    const unitCogs = new Prisma.Decimal(String(req.body.averagePricePerUnit ?? req.body.unitCogs ?? ""));
    const moq = Number(req.body.moq ?? req.body.minimumOrderQuantity);
    if (!unitCogs.isFinite() || !unitCogs.greaterThan(0) || !Number.isInteger(moq) || moq < 1 || moq > 2147483647) {
      return res.status(400).json({ success: false, message: "Provide a positive average unit price and positive whole-number MOQ." });
    }
    const request = await prisma.manufacturerProductionRequest.findFirst({
      where: { id, manufacturerId: req.manufacturerId },
      include: { lines: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Production request not found." });
    if (!["PENDING_PRE_CHECK", "PRE_CHECK_FAILED", "PRE_CHECK_PASSED"].includes(request.status)) {
      return res.status(409).json({ success: false, message: "MOQ and pricing can only be set before production starts." });
    }
    const plannedQuantity = request.lines.reduce((total, line) => total + line.quantity, 0);
    if (moq > plannedQuantity) {
      return res.status(400).json({ success: false, message: "MOQ cannot exceed the quantity requested by the admin." });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id, manufacturerId: req.manufacturerId, status: request.status },
        data: {
          proposedUnitCogs: unitCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          approvedUnitCogs: unitCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          approvedMinimumOrderQuantity: moq,
          minimumOrderQuantity: moq,
          approvedDeliveryCost: request.approvedDeliveryCost ?? request.proposedDeliveryCost ?? new Prisma.Decimal(0),
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production request changed while pricing was being recorded."), { statusCode: 409 });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_PRODUCTION_TERMS_SET",
        entityType: "ManufacturerProductionRequest",
        entityId: id,
        afterState: { averagePricePerUnit: unitCogs.toFixed(2), moq },
      }, { client: tx });
      return tx.manufacturerProductionRequest.findUnique({ where: { id }, include: { lines: true } });
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, message: "Manufacturer MOQ and average unit price saved.", request: updated });
  } catch (error) {
    console.error("setProductionMoqPricing error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

export const createProductionRequest = async (req, res) => {
  try {
    const manufacturerId = req.manufacturerId;
    if (!manufacturerId) return res.status(403).json({ success: false, message: "Manufacturer context is required." });
    const { productId, lines, unitCogs, minimumOrderQuantity, deliveryCost, manufacturerNote } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: "Select a product for production." });
    const normalized = validateProductionRequestInput({ lines, unitCogs, minimumOrderQuantity, deliveryCost });
    const note = String(manufacturerNote || "").trim();
    if (note.length > 2000) return res.status(400).json({ success: false, message: "Production note cannot exceed 2000 characters." });
    const product = await prisma.product.findFirst({
      where: { id: String(productId), published: true, deletedAt: null },
      select: { id: true, name: true, sizes: true, colors: true, variants: true },
    });
    if (!product) return res.status(404).json({ success: false, message: "Published product not found." });
    validRequestLines(product, normalized.lines);

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.manufacturerProductionRequest.create({
        data: {
          manufacturerId,
          productId: product.id,
          productName: product.name,
          proposedUnitCogs: normalized.unitCogs,
          minimumOrderQuantity: normalized.minimumOrderQuantity,
          proposedDeliveryCost: normalized.deliveryCost,
          manufacturerNote: note || null,
          requestedBy: req.auth?.accountId || null,
          lines: { create: normalized.lines },
        },
        include: { lines: true, product: { select: { id: true, name: true } } },
      });
      await recordSystemAudit(actorContext(req), {
        action: "MANUFACTURER_PRODUCTION_REQUESTED",
        entityType: "ManufacturerProductionRequest",
        entityId: created.id,
        afterState: {
          productId: product.id,
          totalQuantity: normalized.totalQuantity,
          proposedUnitCogs: normalized.unitCogs.toFixed(2),
          minimumOrderQuantity: normalized.minimumOrderQuantity,
          proposedDeliveryCost: normalized.deliveryCost.toFixed(2),
        },
      }, { client: tx });
      return created;
    }, { isolationLevel: "Serializable" });

    return res.status(201).json({ success: true, message: "Production request submitted for admin review.", request });
  } catch (error) {
    console.error("createProductionRequest error:", error);
    return res.status(error.statusCode || 400).json({ success: false, message: error.message || "Unable to submit production request." });
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
      if (request.status !== "PENDING_REVIEW") throw Object.assign(new Error("Only pending production requests can be reviewed."), { statusCode: 409 });

      const unitCogs = new Prisma.Decimal(String(req.body.approvedUnitCogs ?? request.proposedUnitCogs));
      const deliveryCost = new Prisma.Decimal(String(req.body.approvedDeliveryCost ?? request.proposedDeliveryCost));
      const moq = Number(req.body.approvedMinimumOrderQuantity ?? request.minimumOrderQuantity);
      if (decision === "APPROVE" && (!unitCogs.isFinite() || !unitCogs.greaterThan(0) || !deliveryCost.isFinite() || deliveryCost.isNegative() || !Number.isInteger(moq) || moq < 1 || moq > 2147483647)) {
        throw Object.assign(new Error("Approved per-piece COGS, delivery cost, and MOQ are invalid."), { statusCode: 400 });
      }
      const claimed = await tx.manufacturerProductionRequest.updateMany({
        where: { id, status: "PENDING_REVIEW" },
        data: {
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          adminNote: adminNote || null,
          reviewedBy: req.auth?.accountId || null,
          reviewedAt: new Date(),
          ...(decision === "APPROVE" ? {
            approvedUnitCogs: unitCogs.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            approvedMinimumOrderQuantity: moq,
            approvedDeliveryCost: deliveryCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          } : {}),
        },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("Production request changed while it was being reviewed. Refresh and retry."), { statusCode: 409 });

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
            proposedCostPrice: Number(unitCogs),
            agreedCostPrice: Number(unitCogs),
            priceStatus: "APPROVED",
            priceNote: `Approved from production request ${request.id}`,
            adminFeedback: adminNote || "Production terms approved.",
          },
          update: {
            agreedCostPrice: Number(unitCogs),
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
            approvedMinimumOrderQuantity: moq,
            approvedDeliveryCost: deliveryCost.toFixed(2),
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
          ? "Production requires a passed pre-production checklist and saved MOQ/pricing."
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
        const goodQuantity = actual.quantity - actual.damagedQuantity;
        productionQuantity += goodQuantity;
        damagedQuantity += actual.damagedQuantity;
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
          unitCogs: request.approvedUnitCogs,
          unitDeliveryCost: request.approvedDeliveryCost,
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
          agreedCostPrice: Number(request.approvedUnitCogs),
          priceStatus: "APPROVED",
        },
        update: {
          productName: product.name,
          quantity: totalQuantity,
          reservedQty: totalReservedQty,
          variantsStock: nextVariants,
          agreedCostPrice: Number(request.approvedUnitCogs),
          priceStatus: "APPROVED",
        },
      });
      if (movements.length) await tx.manufacturerInventoryMovement.createMany({ data: movements });

      const productionCogs = new Prisma.Decimal(request.approvedUnitCogs.toString())
        .mul(productionQuantity)
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
            {
              mappingKey: "MANUFACTURER_PAYABLE",
              debit: 0,
              credit: productionCogs,
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
          productionCogs: productionCogs.toFixed(2),
          deliveryOverheadAccrued: "0.00",
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
