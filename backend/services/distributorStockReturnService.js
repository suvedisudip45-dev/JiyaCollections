import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { applyInventoryMovement, ensureInventoryLocation } from "./inventoryLedgerService.js";
import { recordSystemAudit } from "./auditService.js";
import { syncProductStock } from "./stockSyncService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const MAX_RETURN_LINES = 100;
const MAX_RETURN_COLLECTIONS = 100;
const MAX_RETURN_INSPECTION_LINES = 500;
const RETURN_DISPOSITION_RECOMMENDATIONS = new Set([
  "RESTOCK_REVIEW",
  "REPAIR_REVIEW",
  "SALE_REVIEW",
  "DONATION_REVIEW",
  "DISPOSAL_REVIEW",
  "UNRESOLVED",
]);
const RETURN_STATUSES = new Set([
  "PENDING_APPROVAL",
  "AUTHORIZED_FOR_COLLECTION",
  "PARTIALLY_COLLECTED",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "REJECTED",
]);
const RETURN_INCLUDE = {
  lines: {
    include: {
      inventorySku: { select: { id: true, product: { select: { id: true, name: true } } } },
    },
    orderBy: [{ productNameSnapshot: "asc" }, { sizeSnapshot: "asc" }, { colorSnapshot: "asc" }],
  },
  collections: {
    orderBy: [{ collectedAt: "desc" }, { id: "desc" }],
    include: {
      lines: {
        include: {
          discrepancies: {
            include: {
              investigationReviews: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
          stockReturnLine: {
            select: {
              id: true,
              inventorySkuId: true,
              productNameSnapshot: true,
              sizeSnapshot: true,
              colorSnapshot: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      inspection: {
        include: {
          lines: { orderBy: [{ collectionLineId: "asc" }, { recommendedDisposition: "asc" }] },
        },
      },
    },
  },
  events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 },
};

export const normalizeDistributorStockReturnLines = (input) => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RETURN_LINES) {
    throw fail(`A stock return must contain between 1 and ${MAX_RETURN_LINES} SKU lines.`, "INVALID_RETURN_LINES");
  }
  const seen = new Set();
  return input.map((line) => {
    const inventorySkuId = String(line?.inventorySkuId || "").trim();
    const requestedQuantity = Number(line?.requestedQuantity);
    if (!inventorySkuId || inventorySkuId.length > 191) {
      throw fail("Every stock return line requires a valid inventory SKU.", "INVALID_RETURN_SKU");
    }
    if (seen.has(inventorySkuId)) {
      throw fail("A stock return cannot contain the same SKU more than once.", "DUPLICATE_RETURN_SKU");
    }
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 2147483647) {
      throw fail("Return quantities must be positive whole numbers.", "INVALID_RETURN_QUANTITY");
    }
    seen.add(inventorySkuId);
    return { inventorySkuId, requestedQuantity };
  }).sort((left, right) => left.inventorySkuId.localeCompare(right.inventorySkuId));
};

export const planDistributorReturnCostLayers = (layers, quantity) => {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw fail("Return quantities must be non-negative whole numbers.", "INVALID_RETURN_QUANTITY");
  }
  let remaining = quantity;
  const allocations = [];
  for (const entry of layers) {
    const layerQuantity = Number(entry.quantity);
    if (!Number.isSafeInteger(layerQuantity) || layerQuantity < 0) {
      throw fail("Cost-layer balances must be non-negative whole numbers.", "INVALID_RETURN_COST_LAYER_BALANCE", 409);
    }
    const allocatedQuantity = Math.min(remaining, layerQuantity);
    if (!allocatedQuantity) continue;
    allocations.push({ layer: entry.layer, quantity: allocatedQuantity });
    remaining -= allocatedQuantity;
    if (!remaining) break;
  }
  return { allocations, uncostedQuantity: remaining };
};

const normalizeReason = (value) => {
  const reason = String(value || "").trim();
  if (reason.length < 5 || reason.length > 2000) {
    throw fail("A stock return reason of 5 to 2000 characters is required.", "INVALID_RETURN_REASON");
  }
  return reason;
};

const normalizeIdempotencyKey = (value, prefix = "DISTRIBUTOR_STOCK_RETURN") => {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,140}$/.test(key)) {
    throw fail("A valid Idempotency-Key header is required.", "INVALID_IDEMPOTENCY_KEY");
  }
  return `${prefix}:${createHash("sha256").update(key).digest("hex")}`;
};

const requestDigest = ({ distributorId, reason, lines }) => createHash("sha256")
  .update(JSON.stringify({ distributorId, reason, lines }))
  .digest("hex");

const collectionRequestDigest = ({
  distributorId,
  stockReturnId,
  carrier,
  trackingReference,
  handoverEvidence,
  notes,
  lines,
}) =>
  createHash("sha256").update(JSON.stringify({
    distributorId,
    stockReturnId,
    carrier,
    trackingReference,
    handoverEvidence,
    notes,
    lines,
  })).digest("hex");

const receiptRequestDigest = ({ distributorId, stockReturnId, collectionId, notes, lines }) =>
  createHash("sha256").update(JSON.stringify({
    distributorId,
    stockReturnId,
    collectionId,
    notes,
    lines,
  })).digest("hex");

const inspectionRequestDigest = ({ distributorId, stockReturnId, collectionId, notes, lines }) =>
  createHash("sha256").update(JSON.stringify({
    distributorId,
    stockReturnId,
    collectionId,
    notes,
    lines,
  })).digest("hex");

const discrepancyReviewRequestDigest = ({
  distributorId,
  stockReturnId,
  discrepancyId,
  notes,
  evidence,
}) => createHash("sha256").update(JSON.stringify({
  distributorId,
  stockReturnId,
  discrepancyId,
  notes,
  evidence,
})).digest("hex");

export const deriveReturnStatus = (stockReturn, collections = stockReturn.collections || []) => {
  const approvedQuantity = stockReturn.lines.reduce((sum, line) => sum + Number(line.approvedQuantity || 0), 0);
  const collectedQuantity = collections.reduce(
    (sum, collection) => sum + collection.lines.reduce((lineSum, line) => lineSum + line.collectedQuantity, 0),
    0,
  );
  if (!collectedQuantity) return "AUTHORIZED_FOR_COLLECTION";
  if (collectedQuantity < approvedQuantity) {
    return collections.some((collection) => collection.status === "RECEIVED")
      ? "PARTIALLY_RECEIVED"
      : "PARTIALLY_COLLECTED";
  }
  if (
    collections.some((collection) => collection.status === "RECEIVED")
    && collections.some((collection) => collection.status !== "RECEIVED")
  ) return "PARTIALLY_RECEIVED";
  return collections.every((collection) => collection.status === "RECEIVED") ? "RECEIVED" : "IN_TRANSIT";
};

const auditActor = (actor) => ({
  actorId: actor.accountId,
  actorRole: "ADMIN",
  portalSource: "ADMIN",
  ipAddress: actor.ipAddress || null,
  userAgent: actor.userAgent || null,
  correlationId: actor.correlationId || null,
});

const writeAudit = (client, actor, payload) => recordSystemAudit(auditActor(actor), payload, { client });
const nullableJson = (value) => (value === null ? Prisma.DbNull : value);

const getAvailableBalances = async (tx, distributorId, inventorySkuIds) => tx.inventoryBalance.findMany({
  where: {
    inventorySkuId: { in: inventorySkuIds },
    location: {
      kind: "DISTRIBUTOR",
      distributorId,
      inventoryOwner: "PLATFORM",
      isActive: true,
    },
  },
  include: { location: { select: { id: true } } },
  orderBy: [{ locationId: "asc" }, { inventorySkuId: "asc" }],
});

const getCostLayerBalances = async (tx, inventorySkuId, locationId) => {
  const movements = await tx.inventoryLedgerEntry.findMany({
    where: {
      inventorySkuId,
      productionCostLayerId: { not: null },
      OR: [{ sourceLocationId: locationId }, { destinationLocationId: locationId }],
    },
    include: {
      productionCostLayer: { select: { id: true, unitCogs: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byLayer = new Map();
  for (const movement of movements) {
    const layer = movement.productionCostLayer;
    if (!layer) continue;
    const current = byLayer.get(layer.id) || { layer, quantity: 0 };
    if (movement.destinationLocationId === locationId) current.quantity += movement.quantity;
    if (movement.sourceLocationId === locationId) current.quantity -= movement.quantity;
    byLayer.set(layer.id, current);
  }
  return [...byLayer.values()]
    .filter(({ quantity }) => quantity > 0)
    .sort((left, right) => (
      new Date(left.layer.createdAt).getTime() - new Date(right.layer.createdAt).getTime()
      || left.layer.id.localeCompare(right.layer.id)
    ));
};

const getLayerBalancesAtLocation = async (tx, inventorySkuId, locationId) => {
  const movements = await tx.inventoryLedgerEntry.findMany({
    where: {
      inventorySkuId,
      OR: [{ sourceLocationId: locationId }, { destinationLocationId: locationId }],
    },
    include: {
      productionCostLayer: { select: { id: true, unitCogs: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byLayer = new Map();
  for (const movement of movements) {
    const key = movement.productionCostLayerId || "uncosted";
    const current = byLayer.get(key) || { layer: movement.productionCostLayer, quantity: 0 };
    if (movement.destinationLocationId === locationId) current.quantity += movement.quantity;
    if (movement.sourceLocationId === locationId) current.quantity -= movement.quantity;
    byLayer.set(key, current);
  }
  return [...byLayer.values()]
    .filter(({ quantity }) => quantity > 0)
    .sort((left, right) => (
      Number(Boolean(right.layer)) - Number(Boolean(left.layer))
      || (left.layer && right.layer
        ? new Date(left.layer.createdAt).getTime() - new Date(right.layer.createdAt).getTime()
          || left.layer.id.localeCompare(right.layer.id)
        : 0)
    ));
};

const getReturnHoldLayerBalances = async (tx, { stockReturnId, inventorySkuId, holdLocationId }) => {
  const collections = await tx.distributorStockReturnCollection.findMany({
    where: { stockReturnId },
    select: { id: true },
  });
  const movements = await tx.inventoryLedgerEntry.findMany({
    where: {
      inventorySkuId,
      OR: [
        {
          referenceType: "DISTRIBUTOR_STOCK_RETURN",
          referenceId: stockReturnId,
          destinationLocationId: holdLocationId,
        },
        ...(collections.length ? [{
          referenceType: "DISTRIBUTOR_STOCK_RETURN_COLLECTION",
          referenceId: { in: collections.map(({ id }) => id) },
          sourceLocationId: holdLocationId,
        }] : []),
      ],
    },
    include: {
      productionCostLayer: { select: { id: true, unitCogs: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byLayer = new Map();
  for (const movement of movements) {
    const key = movement.productionCostLayerId || "uncosted";
    const current = byLayer.get(key) || { layer: movement.productionCostLayer, quantity: 0 };
    if (movement.destinationLocationId === holdLocationId) current.quantity += movement.quantity;
    if (movement.sourceLocationId === holdLocationId) current.quantity -= movement.quantity;
    byLayer.set(key, current);
  }
  return [...byLayer.values()]
    .filter(({ quantity }) => quantity > 0)
    .sort((left, right) => (
      Number(Boolean(right.layer)) - Number(Boolean(left.layer))
      || (left.layer && right.layer
        ? new Date(left.layer.createdAt).getTime() - new Date(right.layer.createdAt).getTime()
          || left.layer.id.localeCompare(right.layer.id)
        : 0)
    ));
};

export const planLayerRange = (layers, offset, quantity) => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  ) {
    throw fail("Return cost-layer offsets and quantities must be non-negative whole numbers.", "INVALID_RETURN_COST_LAYER_BALANCE", 409);
  }
  let skip = offset;
  let remaining = quantity;
  const allocations = [];
  for (const entry of layers) {
    const available = Number(entry.quantity);
    if (!Number.isSafeInteger(available) || available < 0) {
      throw fail("Return cost-layer balances must be non-negative whole numbers.", "INVALID_RETURN_COST_LAYER_BALANCE", 409);
    }
    const skipped = Math.min(skip, available);
    skip -= skipped;
    const allocated = Math.min(remaining, available - skipped);
    if (allocated > 0) allocations.push({ layer: entry.layer, quantity: allocated });
    remaining -= allocated;
    if (!remaining) break;
  }
  if (skip > 0 || remaining > 0) {
    throw fail("Return transit cost-layer quantities do not reconcile to the collection.", "RETURN_LAYER_BALANCE_MISMATCH", 409);
  }
  return allocations;
};

const validateShortText = (value, label, maximum = 191) => {
  const text = String(value || "").trim();
  if (text.length > maximum) throw fail(`${label} cannot exceed ${maximum} characters.`, "INVALID_RETURN_COLLECTION");
  return text || null;
};

const normalizeEvidenceUrls = (evidence, label) => {
  if (evidence === undefined || evidence === null) return null;
  if (!Array.isArray(evidence) || evidence.length > 10) {
    throw fail(`${label} must contain up to 10 HTTP(S) URLs.`, "INVALID_RETURN_EVIDENCE");
  }
  return evidence.map((value) => {
    const url = String(value || "").trim();
    if (url.length > 2048 || !/^https?:\/\/\S+$/i.test(url)) {
      throw fail(`${label} items must be valid HTTP(S) URLs no longer than 2048 characters.`, "INVALID_RETURN_EVIDENCE");
    }
    return url;
  });
};

export const normalizeStockReturnDiscrepancyReview = ({ notes: rawNotes, evidence: rawEvidence }) => {
  const notes = String(rawNotes || "").trim();
  if (notes.length < 5 || notes.length > 4000) {
    throw fail("Investigation notes must contain 5 to 4000 characters.", "INVALID_RETURN_DISCREPANCY_REVIEW");
  }
  const evidence = normalizeEvidenceUrls(rawEvidence, "Discrepancy investigation evidence") || [];
  return { notes, evidence };
};

export const validateReturnDiscrepancyReviewState = (discrepancy) => {
  if (!["OPEN", "UNDER_REVIEW"].includes(discrepancy?.status)) {
    throw fail("Only open return discrepancies can receive investigation notes.", "RETURN_DISCREPANCY_NOT_REVIEWABLE", 409);
  }
  if (discrepancy.financialResponsibleParty !== "UNDETERMINED") {
    throw fail("Return discrepancy responsibility must remain undetermined during investigation.", "RETURN_DISCREPANCY_RESPONSIBILITY_CONFLICT", 409);
  }
  return true;
};

export const normalizeCollectionLines = (input, returnLines) => {
  if (!Array.isArray(input) || input.length < 1 || input.length > returnLines.length) {
    throw fail("A collection must include at least one approved SKU line.", "INVALID_RETURN_COLLECTION_LINES");
  }
  const returnLineById = new Map(returnLines.map((line) => [line.id, line]));
  const seen = new Set();
  return input.map((item) => {
    const stockReturnLineId = String(item?.stockReturnLineId || "").trim();
    const returnLine = returnLineById.get(stockReturnLineId);
    const collectedQuantity = Number(item?.collectedQuantity);
    if (
      !returnLine ||
      seen.has(stockReturnLineId) ||
      !Number.isSafeInteger(collectedQuantity) ||
      collectedQuantity < 1 ||
      collectedQuantity > 2147483647
    ) {
      throw fail("Collection lines must reference unique approved return lines and contain positive whole quantities.", "INVALID_RETURN_COLLECTION_LINES");
    }
    seen.add(stockReturnLineId);
    return { stockReturnLineId, collectedQuantity };
  }).sort((left, right) => left.stockReturnLineId.localeCompare(right.stockReturnLineId));
};

export const normalizeReceiptLines = (input, collectionLines) => {
  if (!Array.isArray(input) || input.length !== collectionLines.length) {
    throw fail("Receipt must account for every collected SKU line.", "INVALID_RETURN_RECEIPT_LINES");
  }
  const collectionLineById = new Map(collectionLines.map((line) => [line.id, line]));
  const seen = new Set();
  return input.map((item) => {
    const collectionLineId = String(item?.collectionLineId || "").trim();
    const collectionLine = collectionLineById.get(collectionLineId);
    const receivedGoodQuantity = Number(item?.receivedGoodQuantity ?? 0);
    const receivedDamagedQuantity = Number(item?.receivedDamagedQuantity ?? 0);
    const missingQuantity = Number(item?.missingQuantity ?? 0);
    const damageType = String(item?.damageType || "").trim().toUpperCase() || null;
    const evidence = normalizeEvidenceUrls(item?.evidence, "Receipt evidence");
    const receiptNotes = String(item?.receiptNotes || "").trim();
    const quantities = [receivedGoodQuantity, receivedDamagedQuantity, missingQuantity];
    if (
      !collectionLine ||
      seen.has(collectionLineId) ||
      quantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) ||
      quantities.reduce((sum, quantity) => sum + quantity, 0) !== collectionLine.collectedQuantity ||
      (receivedDamagedQuantity > 0 && !["STITCH_DAMAGE", "DELIVERY_DAMAGE", "OTHER_DAMAGE"].includes(damageType)) ||
      (receivedDamagedQuantity === 0 && damageType) ||
      ((receivedDamagedQuantity > 0 || missingQuantity > 0) && receiptNotes.length < 5) ||
      receiptNotes.length > 4000
    ) {
      throw fail("Receipt counts must reconcile to collected quantities; damaged or missing units require a reason and valid damage type.", "INVALID_RETURN_RECEIPT_LINES");
    }
    seen.add(collectionLineId);
    return {
      collectionLineId,
      receivedGoodQuantity,
      receivedDamagedQuantity,
      missingQuantity,
      damageType,
      evidence,
      receiptNotes: receiptNotes || null,
    };
  }).sort((left, right) => left.collectionLineId.localeCompare(right.collectionLineId));
};

export const normalizeReturnInspectionLines = (input, collectionLines) => {
  const inspectableLines = collectionLines.filter((line) =>
    Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0) > 0
  );
  if (
    !inspectableLines.length ||
    !Array.isArray(input) ||
    input.length < inspectableLines.length ||
    input.length > MAX_RETURN_INSPECTION_LINES
  ) {
    throw fail("Inspection must account for every physically received SKU quantity.", "INVALID_RETURN_INSPECTION_LINES");
  }
  const collectionLineById = new Map(inspectableLines.map((line) => [line.id, line]));
  const seen = new Set();
  const totals = new Map();
  const normalized = input.map((item) => {
    const collectionLineId = String(item?.collectionLineId || "").trim();
    const recommendedDisposition = String(item?.recommendedDisposition || "").trim().toUpperCase();
    const quantity = Number(item?.quantity);
    const conditionNotes = String(item?.conditionNotes || "").trim();
    const evidence = normalizeEvidenceUrls(item?.evidence, "Inspection evidence");
    const key = `${collectionLineId}:${recommendedDisposition}`;
    if (
      !collectionLineById.has(collectionLineId) ||
      !RETURN_DISPOSITION_RECOMMENDATIONS.has(recommendedDisposition) ||
      seen.has(key) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 2147483647 ||
      conditionNotes.length < 5 ||
      conditionNotes.length > 4000
    ) {
      throw fail("Inspection lines require a valid received SKU, unique recommendation, positive count, and condition notes.", "INVALID_RETURN_INSPECTION_LINES");
    }
    seen.add(key);
    totals.set(collectionLineId, (totals.get(collectionLineId) || 0) + quantity);
    return {
      collectionLineId,
      recommendedDisposition,
      quantity,
      conditionNotes,
      evidence,
    };
  }).sort((left, right) => (
    left.collectionLineId.localeCompare(right.collectionLineId)
    || left.recommendedDisposition.localeCompare(right.recommendedDisposition)
  ));
  for (const line of inspectableLines) {
    const expected = Number(line.receivedGoodQuantity || 0) + Number(line.receivedDamagedQuantity || 0);
    if (totals.get(line.id) !== expected) {
      throw fail("Inspection counts must exactly equal the physically received good and damaged units.", "RETURN_INSPECTION_QUANTITY_MISMATCH", 409);
    }
  }
  if (totals.size !== inspectableLines.length) {
    throw fail("Inspection contains a line that was not received.", "INVALID_RETURN_INSPECTION_LINES");
  }
  return normalized;
};

const holdReturnLine = async (tx, { stockReturn, line, holdLocation, actor, quantity }) => {
  const balances = await getAvailableBalances(tx, stockReturn.distributorId, [line.inventorySkuId]);
  let remaining = quantity;
  let costedQuantity = 0;
  let uncostedQuantity = 0;
  let layerCogsAmount = new Prisma.Decimal(0);

  for (const balance of balances) {
    if (remaining === 0) break;
    const availableQuantity = Math.max(0, balance.quantityOnHand - balance.reservedQuantity);
    let takeFromLocation = Math.min(remaining, availableQuantity);
    if (!takeFromLocation) continue;

    const layerBalances = await getCostLayerBalances(tx, line.inventorySkuId, balance.locationId);
    const layerPlan = planDistributorReturnCostLayers(layerBalances, takeFromLocation);
    for (const { layer, quantity: allocatedQuantity } of layerPlan.allocations) {
      await applyInventoryMovement(tx, {
        inventorySkuId: line.inventorySkuId,
        sourceLocationId: balance.locationId,
        destinationLocationId: holdLocation.id,
        quantity: allocatedQuantity,
        movementType: "RETURN",
        referenceType: "DISTRIBUTOR_STOCK_RETURN",
        referenceId: stockReturn.id,
        productionCostLayerId: layer.id,
        idempotencyKey: `distributor-stock-return:${stockReturn.id}:${line.id}:${balance.locationId}:${layer.id}`,
        actorId: actor.accountId,
        actorRole: "ADMIN",
        reason: `Authorized distributor stock return ${stockReturn.id}: ${stockReturn.reason}`,
      });
      layerCogsAmount = layerCogsAmount.add(new Prisma.Decimal(String(layer.unitCogs)).mul(allocatedQuantity));
      takeFromLocation -= allocatedQuantity;
      remaining -= allocatedQuantity;
      costedQuantity += allocatedQuantity;
      if (remaining === 0) break;
    }
    if (layerPlan.uncostedQuantity > 0) {
      await applyInventoryMovement(tx, {
        inventorySkuId: line.inventorySkuId,
        sourceLocationId: balance.locationId,
        destinationLocationId: holdLocation.id,
        quantity: layerPlan.uncostedQuantity,
        movementType: "RETURN",
        referenceType: "DISTRIBUTOR_STOCK_RETURN",
        referenceId: stockReturn.id,
        idempotencyKey: `distributor-stock-return:${stockReturn.id}:${line.id}:${balance.locationId}:uncosted`,
        actorId: actor.accountId,
        actorRole: "ADMIN",
        reason: `Authorized distributor stock return ${stockReturn.id}; no production cost layer was traceable.`,
      });
      remaining -= layerPlan.uncostedQuantity;
      uncostedQuantity += layerPlan.uncostedQuantity;
    }
  }
  if (remaining > 0) {
    throw fail(
      `Available distributor stock changed for SKU ${line.inventorySkuId}; refresh and review the return quantities.`,
      "RETURN_STOCK_CHANGED",
      409,
    );
  }
  return {
    heldQuantity: quantity,
    costedQuantity,
    uncostedQuantity,
    layerCogsAmount: layerCogsAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
};

export const createDistributorStockReturn = async ({
  distributorId,
  reason: rawReason,
  lines: rawLines,
  idempotencyKey: rawIdempotencyKey,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const reason = normalizeReason(rawReason);
  const lines = normalizeDistributorStockReturnLines(rawLines);
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
  const requestHash = requestDigest({ distributorId, reason, lines });
  const existing = await prisma.distributorStockReturn.findUnique({
    where: { idempotencyKey },
    include: RETURN_INCLUDE,
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw fail("Idempotency-Key was already used for a different stock return request.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { stockReturn: existing, replayed: true };
  }

  try {
    const stockReturn = await prisma.$transaction(async (tx) => {
      const distributor = await tx.distributor.findUnique({
        where: { id: distributorId },
        select: { id: true },
      });
      if (!distributor) throw fail("Distributor profile not found.", "DISTRIBUTOR_NOT_FOUND", 404);
      const skus = await tx.inventorySku.findMany({
        where: { id: { in: lines.map((line) => line.inventorySkuId) }, isActive: true, product: { deletedAt: null } },
        select: { id: true, size: true, color: true, product: { select: { name: true } } },
      });
      if (skus.length !== lines.length) throw fail("One or more selected SKUs are unavailable.", "RETURN_SKU_NOT_FOUND", 404);
      const skuById = new Map(skus.map((sku) => [sku.id, sku]));
      const balances = await getAvailableBalances(tx, distributorId, lines.map((line) => line.inventorySkuId));
      for (const line of lines) {
        const available = balances
          .filter((balance) => balance.inventorySkuId === line.inventorySkuId)
          .reduce((sum, balance) => sum + Math.max(0, balance.quantityOnHand - balance.reservedQuantity), 0);
        if (available < line.requestedQuantity) {
          throw fail(`Requested quantity exceeds available stock for SKU ${line.inventorySkuId}.`, "INSUFFICIENT_RETURN_STOCK", 409);
        }
      }

      const created = await tx.distributorStockReturn.create({
        data: {
          distributorId,
          status: "PENDING_APPROVAL",
          reason,
          idempotencyKey,
          requestHash,
          createdByAccountId: actor.accountId,
          lines: {
            create: lines.map((line) => {
              const sku = skuById.get(line.inventorySkuId);
              return {
                ...line,
                productNameSnapshot: sku.product.name,
                sizeSnapshot: sku.size,
                colorSnapshot: sku.color,
              };
            }),
          },
        },
        include: { lines: true },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId: created.id,
          action: "REQUESTED",
          toStatus: "PENDING_APPROVAL",
          actorAccountId: actor.accountId,
          notes: reason,
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_REQUESTED",
        entityType: "DistributorStockReturn",
        entityId: created.id,
        afterState: {
          distributorId,
          status: created.status,
          reason,
          lines: created.lines.map(({ inventorySkuId, requestedQuantity }) => ({ inventorySkuId, requestedQuantity })),
        },
      });
      return created;
    }, { isolationLevel: "Serializable" });
    const result = await prisma.distributorStockReturn.findUnique({
      where: { id: stockReturn.id },
      include: RETURN_INCLUDE,
    });
    return { stockReturn: result, replayed: false };
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const raced = await prisma.distributorStockReturn.findUnique({ where: { idempotencyKey }, include: RETURN_INCLUDE });
    if (!raced) throw error;
    if (raced.requestHash !== requestHash) {
      throw fail("Idempotency-Key was already used for a different stock return request.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { stockReturn: raced, replayed: true };
  }
};

export const listDistributorStockReturns = async ({ distributorId, query = {} }) => {
  const pagination = getPagination(query);
  const status = String(query.status || "").trim().toUpperCase();
  if (status && !RETURN_STATUSES.has(status)) throw fail("Select a valid stock return status.", "INVALID_RETURN_STATUS");
  const distributor = await prisma.distributor.findUnique({
    where: { id: distributorId },
    select: { id: true },
  });
  if (!distributor) throw fail("Distributor profile not found.", "DISTRIBUTOR_NOT_FOUND", 404);
  const where = { distributorId, ...(status ? { status } : {}) };
  const [stockReturns, total] = await prisma.$transaction([
    prisma.distributorStockReturn.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.limit,
      include: RETURN_INCLUDE,
    }),
    prisma.distributorStockReturn.count({ where }),
  ]);
  const returnIds = stockReturns.map(({ id }) => id);
  const carryingExpenses = returnIds.length
    ? await prisma.cashTransaction.findMany({
      where: {
        referenceId: { in: returnIds },
        type: "OUTFLOW",
        category: "EXPENSE",
      },
      select: {
        id: true,
        referenceId: true,
        amount: true,
        date: true,
        partyName: true,
        invoiceNumber: true,
        description: true,
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    })
    : [];
  const expensesByReturnId = new Map();
  for (const expense of carryingExpenses) {
    const expenses = expensesByReturnId.get(expense.referenceId) || [];
    expenses.push(expense);
    expensesByReturnId.set(expense.referenceId, expenses);
  }
  return paginatedResponse(
    "stockReturns",
    stockReturns.map((stockReturn) => ({
      ...stockReturn,
      carryingExpenses: expensesByReturnId.get(stockReturn.id) || [],
    })),
    pagination,
    total,
  );
};

export const getDistributorStockReturnAuditReport = async ({ distributorId, stockReturnId }) => {
  const stockReturn = await prisma.distributorStockReturn.findFirst({
    where: { id: stockReturnId, distributorId },
    include: {
      ...RETURN_INCLUDE,
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!stockReturn) throw fail("Stock return was not found.", "STOCK_RETURN_NOT_FOUND", 404);
  const carryingExpenses = await prisma.cashTransaction.findMany({
    where: {
      referenceId: stockReturn.id,
      type: "OUTFLOW",
      category: "EXPENSE",
    },
    select: {
      id: true,
      referenceId: true,
      amount: true,
      date: true,
      partyName: true,
      invoiceNumber: true,
      description: true,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return { success: true, stockReturn, carryingExpenses };
};

export const recordDistributorStockReturnDiscrepancyReview = async ({
  distributorId,
  stockReturnId,
  discrepancyId,
  notes: rawNotes,
  evidence: rawEvidence,
  idempotencyKey: rawIdempotencyKey,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const { notes, evidence } = normalizeStockReturnDiscrepancyReview({
    notes: rawNotes,
    evidence: rawEvidence,
  });
  const idempotencyKey = normalizeIdempotencyKey(
    rawIdempotencyKey,
    "DISTRIBUTOR_RETURN_DISCREPANCY_REVIEW",
  );
  const requestHash = discrepancyReviewRequestDigest({
    distributorId,
    stockReturnId,
    discrepancyId,
    notes,
    evidence,
  });
  const replay = async () => {
    const existing = await prisma.inventoryDiscrepancyReview.findUnique({
      where: { idempotencyKey },
      include: { discrepancy: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw fail("Idempotency-Key was already used for a different discrepancy investigation.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { review: existing, discrepancy: existing.discrepancy, replayed: true };
  };
  const existing = await replay();
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const discrepancy = await tx.inventoryDiscrepancy.findFirst({
        where: {
          id: discrepancyId,
          stockReturnCollectionLine: {
            collection: {
              stockReturnId,
              stockReturn: { distributorId },
            },
          },
        },
        include: {
          stockReturnCollectionLine: {
            include: {
              collection: { select: { id: true, stockReturnId: true } },
            },
          },
        },
      });
      if (!discrepancy) {
        throw fail("Return discrepancy was not found.", "RETURN_DISCREPANCY_NOT_FOUND", 404);
      }
      validateReturnDiscrepancyReviewState(discrepancy);
      const review = await tx.inventoryDiscrepancyReview.create({
        data: {
          discrepancyId,
          idempotencyKey,
          requestHash,
          reviewedBy: actor.accountId,
          notes,
          evidence: nullableJson(evidence.length ? evidence : null),
        },
      });
      const updatedDiscrepancy = await tx.inventoryDiscrepancy.update({
        where: { id: discrepancyId },
        data: {
          status: "UNDER_REVIEW",
          reviewedBy: actor.accountId,
        },
      });
      const collection = discrepancy.stockReturnCollectionLine.collection;
      const stockReturn = await tx.distributorStockReturn.findUnique({
        where: { id: stockReturnId },
        select: { id: true, status: true },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId,
          action: "DISCREPANCY_INVESTIGATION_RECORDED",
          fromStatus: stockReturn.status,
          toStatus: stockReturn.status,
          actorAccountId: actor.accountId,
          notes,
          metadata: {
            discrepancyId,
            reviewId: review.id,
            collectionId: collection.id,
            discrepancyStatus: updatedDiscrepancy.status,
            evidence,
            financialResponsibleParty: "UNDETERMINED",
            inventoryOrAccountingChanged: false,
          },
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_DISCREPANCY_INVESTIGATED",
        entityType: "InventoryDiscrepancy",
        entityId: discrepancyId,
        beforeState: {
          status: discrepancy.status,
          financialResponsibleParty: discrepancy.financialResponsibleParty,
        },
        afterState: {
          status: updatedDiscrepancy.status,
          reviewedBy: updatedDiscrepancy.reviewedBy,
          reviewId: review.id,
          notes,
          evidence,
          financialResponsibleParty: updatedDiscrepancy.financialResponsibleParty,
          inventoryOrAccountingChanged: false,
        },
      });
      return { review, discrepancy: updatedDiscrepancy, replayed: false };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const raced = await replay();
    if (!raced) throw error;
    return raced;
  }
};

export const reviewDistributorStockReturn = async ({
  distributorId,
  stockReturnId,
  decision: rawDecision,
  lines: rawApprovals,
  notes: rawNotes,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const decision = String(rawDecision || "").trim().toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw fail("Decision must be APPROVE or REJECT.", "INVALID_RETURN_DECISION");
  const notes = String(rawNotes || "").trim();
  if (notes.length > 2000 || (decision === "REJECT" && notes.length < 5)) {
    throw fail("Rejection requires a reason of 5 to 2000 characters; review notes cannot exceed 2000 characters.", "INVALID_REVIEW_NOTES");
  }
  const stockReturn = await prisma.$transaction(async (tx) => {
    const current = await tx.distributorStockReturn.findFirst({
      where: { id: stockReturnId, distributorId },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    if (!current) throw fail("Stock return request not found.", "RETURN_NOT_FOUND", 404);
    if (current.status !== "PENDING_APPROVAL") {
      throw fail("Only pending stock return requests can be reviewed.", "RETURN_NOT_REVIEWABLE", 409);
    }

    const previousStatus = current.status;
    if (decision === "REJECT") {
      const rejected = await tx.distributorStockReturn.update({
        where: { id: current.id },
        data: {
          status: "REJECTED",
          reviewedByAccountId: actor.accountId,
          reviewedAt: new Date(),
          reviewNotes: notes,
        },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId: current.id,
          action: "REJECTED",
          fromStatus: previousStatus,
          toStatus: rejected.status,
          actorAccountId: actor.accountId,
          notes,
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_REJECTED",
        entityType: "DistributorStockReturn",
        entityId: current.id,
        beforeState: { status: previousStatus },
        afterState: { status: rejected.status, reviewNotes: notes },
      });
    } else {
      if (!Array.isArray(rawApprovals) || rawApprovals.length !== current.lines.length) {
        throw fail("Approval must specify a quantity for every requested SKU line.", "INVALID_RETURN_APPROVAL_LINES");
      }
      const approvalsById = new Map();
      for (const approval of rawApprovals) {
        const lineId = String(approval?.lineId || "").trim();
        const quantity = Number(approval?.approvedQuantity);
        if (
          !lineId ||
          approvalsById.has(lineId) ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0
        ) {
          throw fail("Every return approval line must have a unique ID and a non-negative whole quantity.", "INVALID_RETURN_APPROVAL_LINES");
        }
        approvalsById.set(lineId, quantity);
      }
      if (current.lines.some((line) => !approvalsById.has(line.id))) {
        throw fail("Approval must include every requested SKU line.", "INVALID_RETURN_APPROVAL_LINES");
      }
      const approvedTotal = current.lines.reduce((sum, line) => {
        const quantity = approvalsById.get(line.id);
        if (quantity > line.requestedQuantity) {
          throw fail("Approved quantities cannot exceed requested quantities.", "INVALID_RETURN_APPROVED_QUANTITY");
        }
        return sum + quantity;
      }, 0);
      if (!approvedTotal) throw fail("At least one unit must be approved.", "EMPTY_RETURN_APPROVAL");

      const holdLocation = await ensureInventoryLocation(tx, {
        kind: "RETURN_HOLD",
        distributorId,
        name: `Authorized return hold - ${distributorId}`,
      });
      const heldLines = [];
      const affectedProductIds = new Set();
      for (const line of current.lines) {
        const quantity = approvalsById.get(line.id);
        const valuation = quantity
          ? await holdReturnLine(tx, { stockReturn: current, line, holdLocation, actor, quantity })
          : { heldQuantity: 0, costedQuantity: 0, uncostedQuantity: 0, layerCogsAmount: new Prisma.Decimal(0) };
        const updatedLine = await tx.distributorStockReturnLine.update({
          where: { id: line.id },
          data: {
            approvedQuantity: quantity,
            ...valuation,
          },
        });
        if (quantity > 0) {
          const sku = await tx.inventorySku.findUnique({
            where: { id: line.inventorySkuId },
            select: { productId: true },
          });
          if (!sku) throw fail("A return SKU disappeared during approval.", "RETURN_SKU_NOT_FOUND", 409);
          affectedProductIds.add(sku.productId);
        }
        heldLines.push({
          lineId: line.id,
          inventorySkuId: line.inventorySkuId,
          approvedQuantity: quantity,
          costedQuantity: valuation.costedQuantity,
          uncostedQuantity: valuation.uncostedQuantity,
          layerCogsAmount: valuation.layerCogsAmount.toFixed(2),
        });
      }
      await Promise.all([...affectedProductIds].map((productId) =>
        syncProductStock(productId, { client: tx, throwOnError: true })
      ));
      const approved = await tx.distributorStockReturn.update({
        where: { id: current.id },
        data: {
          status: "AUTHORIZED_FOR_COLLECTION",
          holdLocationId: holdLocation.id,
          reviewedByAccountId: actor.accountId,
          reviewedAt: new Date(),
          reviewNotes: notes || null,
        },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId: current.id,
          action: "AUTHORIZED_FOR_COLLECTION",
          fromStatus: previousStatus,
          toStatus: approved.status,
          actorAccountId: actor.accountId,
          notes: notes || null,
          metadata: { holdLocationId: holdLocation.id, lines: heldLines },
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_AUTHORIZED",
        entityType: "DistributorStockReturn",
        entityId: current.id,
        beforeState: { status: previousStatus },
        afterState: { status: approved.status, holdLocationId: holdLocation.id, lines: heldLines },
      });
    }
    return tx.distributorStockReturn.findUnique({
      where: { id: current.id },
      include: RETURN_INCLUDE,
    });
  }, { isolationLevel: "Serializable" });
  return stockReturn;
};

export const createDistributorStockReturnCollection = async ({
  distributorId,
  stockReturnId,
  carrier: rawCarrier,
  trackingReference: rawTrackingReference,
  handoverEvidence: rawHandoverEvidence,
  notes: rawNotes,
  lines: rawLines,
  idempotencyKey: rawIdempotencyKey,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const carrier = validateShortText(rawCarrier, "Carrier");
  const trackingReference = validateShortText(rawTrackingReference, "Tracking reference");
  const handoverEvidence = normalizeEvidenceUrls(rawHandoverEvidence, "Handover evidence");
  const notes = String(rawNotes || "").trim();
  if (notes.length > 2000) throw fail("Collection notes cannot exceed 2000 characters.", "INVALID_RETURN_COLLECTION");
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey, "DISTRIBUTOR_STOCK_RETURN_COLLECTION");

  const existing = await prisma.distributorStockReturnCollection.findUnique({
    where: { idempotencyKey },
    include: { stockReturn: { include: RETURN_INCLUDE } },
  });
  if (existing) {
    const requestLines = normalizeCollectionLines(rawLines, existing.stockReturn.lines);
    const requestHash = collectionRequestDigest({
      distributorId,
      stockReturnId,
      carrier,
      trackingReference,
      handoverEvidence,
      notes,
      lines: requestLines,
    });
    if (existing.requestHash !== requestHash) {
      throw fail("Idempotency-Key was already used for a different return collection.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { stockReturn: existing.stockReturn, collection: existing, replayed: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.distributorStockReturn.findFirst({
        where: { id: stockReturnId, distributorId },
        include: {
          lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          collections: { include: { lines: true } },
        },
      });
      if (!current) throw fail("Stock return request not found.", "RETURN_NOT_FOUND", 404);
      if (!["AUTHORIZED_FOR_COLLECTION", "PARTIALLY_COLLECTED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(current.status)) {
        throw fail("This stock return is not available for collection.", "RETURN_NOT_COLLECTABLE", 409);
      }
      if (current.collections.length >= MAX_RETURN_COLLECTIONS) {
        throw fail("This stock return has reached the maximum number of collection batches.", "RETURN_COLLECTION_LIMIT", 409);
      }
      if (!current.holdLocationId) throw fail("The authorized return has no return-hold location.", "RETURN_HOLD_LOCATION_MISSING", 409);

      const lines = normalizeCollectionLines(rawLines, current.lines);
      const collectionsByLine = new Map();
      for (const collection of current.collections) {
        for (const line of collection.lines) {
          collectionsByLine.set(
            line.stockReturnLineId,
            (collectionsByLine.get(line.stockReturnLineId) || 0) + line.collectedQuantity,
          );
        }
      }
      for (const line of lines) {
        const returnLine = current.lines.find(({ id }) => id === line.stockReturnLineId);
        const remaining = Number(returnLine?.approvedQuantity || 0) - (collectionsByLine.get(line.stockReturnLineId) || 0);
        if (line.collectedQuantity > remaining) {
          throw fail("Collection quantity exceeds the approved quantity still held for this SKU.", "RETURN_COLLECTION_EXCEEDS_HOLD", 409);
        }
      }
      const requestHash = collectionRequestDigest({
        distributorId,
        stockReturnId,
        carrier,
        trackingReference,
        handoverEvidence,
        notes,
        lines,
      });
      const collection = await tx.distributorStockReturnCollection.create({
        data: {
          stockReturnId,
          status: "IN_TRANSIT",
          idempotencyKey,
          requestHash,
          carrier,
          trackingReference,
          handoverEvidence: nullableJson(handoverEvidence),
          collectionNotes: notes || null,
          collectedByAccountId: actor.accountId,
          lines: {
            create: lines.map((line) => ({
              stockReturnLineId: line.stockReturnLineId,
              collectedQuantity: line.collectedQuantity,
            })),
          },
        },
        include: { lines: true },
      });
      const transitLocation = await ensureInventoryLocation(tx, {
        kind: "IN_TRANSIT",
        referenceId: collection.id,
        name: `Distributor stock return transit ${collection.id}`,
      });
      for (const collectionLine of collection.lines) {
        const layerBalances = await getReturnHoldLayerBalances(tx, {
          stockReturnId,
          inventorySkuId: current.lines.find(({ id }) => id === collectionLine.stockReturnLineId).inventorySkuId,
          holdLocationId: current.holdLocationId,
        });
        const allocations = planDistributorReturnCostLayers(layerBalances, collectionLine.collectedQuantity).allocations;
        const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (allocatedQuantity !== collectionLine.collectedQuantity) {
          throw fail("The return-hold ledger does not reconcile to the collection quantity.", "RETURN_HOLD_BALANCE_MISMATCH", 409);
        }
        const returnLine = current.lines.find(({ id }) => id === collectionLine.stockReturnLineId);
        for (const allocation of allocations) {
          const layerKey = allocation.layer?.id || "uncosted";
          await applyInventoryMovement(tx, {
            inventorySkuId: returnLine.inventorySkuId,
            sourceLocationId: current.holdLocationId,
            destinationLocationId: transitLocation.id,
            quantity: allocation.quantity,
            movementType: "RETURN",
            referenceType: "DISTRIBUTOR_STOCK_RETURN_COLLECTION",
            referenceId: collection.id,
            productionCostLayerId: allocation.layer?.id || null,
            idempotencyKey: `return-collection:${collection.id}:${collectionLine.id}:${layerKey}`,
            actorId: actor.accountId,
            actorRole: "ADMIN",
            reason: `Collected authorized distributor return ${stockReturnId}.`,
          });
        }
      }

      const fullCollection = await tx.distributorStockReturnCollection.findUnique({
        where: { id: collection.id },
        include: { lines: true },
      });
      const nextStatus = deriveReturnStatus(current, [...current.collections, fullCollection]);
      await tx.distributorStockReturn.update({
        where: { id: stockReturnId },
        data: { status: nextStatus },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId,
          action: "COLLECTED_FOR_RETURN",
          fromStatus: current.status,
          toStatus: nextStatus,
          actorAccountId: actor.accountId,
          notes: notes || null,
          metadata: {
            collectionId: collection.id,
            carrier,
            trackingReference,
            lines: collection.lines.map(({ stockReturnLineId, collectedQuantity }) => ({ stockReturnLineId, collectedQuantity })),
          },
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_COLLECTED",
        entityType: "DistributorStockReturn",
        entityId: stockReturnId,
        beforeState: { status: current.status },
        afterState: {
          status: nextStatus,
          collectionId: collection.id,
          carrier,
          trackingReference,
          lines: collection.lines.map(({ stockReturnLineId, collectedQuantity }) => ({ stockReturnLineId, collectedQuantity })),
        },
      });
      const stockReturn = await tx.distributorStockReturn.findUnique({
        where: { id: stockReturnId },
        include: RETURN_INCLUDE,
      });
      return { stockReturn, collection: fullCollection, replayed: false };
    }, { isolationLevel: "Serializable" });
    return result;
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const raced = await prisma.distributorStockReturnCollection.findUnique({
      where: { idempotencyKey },
      include: { stockReturn: { include: RETURN_INCLUDE } },
    });
    if (!raced) throw error;
    const racedLines = normalizeCollectionLines(rawLines, raced.stockReturn.lines);
    if (raced.requestHash !== collectionRequestDigest({
      distributorId,
      stockReturnId,
      carrier,
      trackingReference,
      handoverEvidence,
      notes,
      lines: racedLines,
    })) {
      throw fail("Idempotency-Key was already used for a different return collection.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { stockReturn: raced.stockReturn, collection: raced, replayed: true };
  }
};

export const receiveDistributorStockReturnCollection = async ({
  distributorId,
  stockReturnId,
  collectionId,
  notes: rawNotes,
  lines: rawLines,
  idempotencyKey: rawIdempotencyKey,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const notes = String(rawNotes || "").trim();
  if (notes.length > 2000) throw fail("Receipt notes cannot exceed 2000 characters.", "INVALID_RETURN_RECEIPT");
  const receiptIdempotencyKey = normalizeIdempotencyKey(
    rawIdempotencyKey,
    "DISTRIBUTOR_STOCK_RETURN_RECEIPT",
  );
  try {
    const result = await prisma.$transaction(async (tx) => {
    const current = await tx.distributorStockReturnCollection.findFirst({
      where: { id: collectionId, stockReturnId, stockReturn: { distributorId } },
      include: {
        lines: { include: { stockReturnLine: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        stockReturn: {
          include: {
            lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            collections: { include: { lines: true } },
          },
        },
      },
    });
    if (!current) throw fail("Return collection not found.", "RETURN_COLLECTION_NOT_FOUND", 404);
    if (current.status !== "IN_TRANSIT" && current.status !== "RECEIVED") {
      throw fail("Only an in-transit return collection can be received.", "RETURN_COLLECTION_NOT_RECEIVABLE", 409);
    }
    const receiptLines = normalizeReceiptLines(rawLines, current.lines);
    const receiptRequestHash = receiptRequestDigest({
      distributorId,
      stockReturnId,
      collectionId,
      notes,
      lines: receiptLines,
    });
    if (current.status === "RECEIVED") {
      if (current.receiptIdempotencyKey !== receiptIdempotencyKey || current.receiptRequestHash !== receiptRequestHash) {
        throw fail("This collection was already received with a different receipt request.", "RETURN_COLLECTION_ALREADY_RECEIVED", 409);
      }
      const stockReturn = await tx.distributorStockReturn.findUnique({
        where: { id: stockReturnId },
        include: RETURN_INCLUDE,
      });
      return { stockReturn, collection: current, replayed: true };
    }

    const transitLocation = await ensureInventoryLocation(tx, {
      kind: "IN_TRANSIT",
      referenceId: current.id,
      name: `Distributor stock return transit ${current.id}`,
    });
    const receiptLocation = await ensureInventoryLocation(tx, {
      kind: "RETURN_RECEIPT",
      referenceId: stockReturnId,
      name: `Received distributor return quarantine ${stockReturnId}`,
    });
    const receiptByLine = new Map(receiptLines.map((line) => [line.collectionLineId, line]));
    for (const collectionLine of current.lines) {
      const receiptLine = receiptByLine.get(collectionLine.id);
      const inventorySkuId = collectionLine.stockReturnLine.inventorySkuId;
      const layerBalances = await getLayerBalancesAtLocation(tx, inventorySkuId, transitLocation.id);
      const receivedQuantity = receiptLine.receivedGoodQuantity + receiptLine.receivedDamagedQuantity;
      const receivedAllocations = planLayerRange(layerBalances, 0, receivedQuantity);
      const lineLayerTotal = layerBalances.reduce((sum, entry) => sum + entry.quantity, 0);
      if (lineLayerTotal !== collectionLine.collectedQuantity) {
        throw fail("The return-in-transit ledger does not reconcile to the collection quantity.", "RETURN_TRANSIT_BALANCE_MISMATCH", 409);
      }
      for (const allocation of receivedAllocations) {
        const layerKey = allocation.layer?.id || "uncosted";
        await applyInventoryMovement(tx, {
          inventorySkuId,
          sourceLocationId: transitLocation.id,
          destinationLocationId: receiptLocation.id,
          quantity: allocation.quantity,
          movementType: "RETURN",
          referenceType: "DISTRIBUTOR_STOCK_RETURN_RECEIPT",
          referenceId: current.id,
          productionCostLayerId: allocation.layer?.id || null,
          idempotencyKey: `return-receipt:${current.id}:${collectionLine.id}:${layerKey}`,
          actorId: actor.accountId,
          actorRole: "ADMIN",
          reason: `Received distributor stock return ${stockReturnId} into quarantine.`,
        });
      }
      const updatedLine = await tx.distributorStockReturnCollectionLine.update({
        where: { id: collectionLine.id },
        data: {
          receivedGoodQuantity: receiptLine.receivedGoodQuantity,
          receivedDamagedQuantity: receiptLine.receivedDamagedQuantity,
          missingQuantity: receiptLine.missingQuantity,
          damageType: receiptLine.damageType,
          evidence: nullableJson(receiptLine.evidence),
          receiptNotes: receiptLine.receiptNotes,
        },
      });
      const discrepancies = [
        receiptLine.receivedDamagedQuantity > 0 ? {
          discrepancyType: receiptLine.damageType,
          custodyStage: "DISTRIBUTOR_RETURN_RECEIPT",
          quantity: receiptLine.receivedDamagedQuantity,
          inventoryLocationId: receiptLocation.id,
          details: receiptLine.receiptNotes,
          suffix: "damaged",
        } : null,
        receiptLine.missingQuantity > 0 ? {
          discrepancyType: "SHORT_RECEIPT",
          custodyStage: "DISTRIBUTOR_RETURN_TRANSIT",
          quantity: receiptLine.missingQuantity,
          inventoryLocationId: transitLocation.id,
          details: receiptLine.receiptNotes,
          suffix: "missing",
        } : null,
      ].filter(Boolean);
      for (const discrepancy of discrepancies) {
        await tx.inventoryDiscrepancy.create({
          data: {
            distributorId,
            inventoryLocationId: discrepancy.inventoryLocationId,
            inventorySkuId,
            discrepancyType: discrepancy.discrepancyType,
            custodyStage: discrepancy.custodyStage,
            quantity: discrepancy.quantity,
            status: "OPEN",
            reportedBy: actor.accountId,
            reportedByRole: "ADMIN",
            evidence: nullableJson(receiptLine.evidence),
            details: discrepancy.details,
            financialResponsibleParty: "UNDETERMINED",
            idempotencyKey: `return-discrepancy:${current.id}:${collectionLine.id}:${discrepancy.suffix}`,
            stockReturnCollectionLineId: updatedLine.id,
          },
        });
      }
    }

    const received = await tx.distributorStockReturnCollection.update({
      where: { id: current.id },
      data: {
        status: "RECEIVED",
        receiptIdempotencyKey,
        receiptRequestHash,
        receiptNotes: notes || null,
        receivedByAccountId: actor.accountId,
        receivedAt: new Date(),
      },
      include: { lines: { include: { stockReturnLine: true } } },
    });
    const collections = current.stockReturn.collections.map((collection) =>
      collection.id === current.id ? received : collection
    );
    const nextStatus = deriveReturnStatus(current.stockReturn, collections);
    await tx.distributorStockReturn.update({
      where: { id: stockReturnId },
      data: { status: nextStatus },
    });
    await tx.distributorStockReturnEvent.create({
      data: {
        stockReturnId,
        action: "WAREHOUSE_RECEIPT_RECORDED",
        fromStatus: current.stockReturn.status,
        toStatus: nextStatus,
        actorAccountId: actor.accountId,
        notes: notes || null,
        metadata: {
          collectionId: current.id,
          receiptLocationId: receiptLocation.id,
          lines: received.lines.map((line) => ({
            collectionLineId: line.id,
            collectedQuantity: line.collectedQuantity,
            receivedGoodQuantity: line.receivedGoodQuantity,
            receivedDamagedQuantity: line.receivedDamagedQuantity,
            missingQuantity: line.missingQuantity,
          })),
        },
      },
    });
    await writeAudit(tx, actor, {
      action: "DISTRIBUTOR_STOCK_RETURN_RECEIVED",
      entityType: "DistributorStockReturn",
      entityId: stockReturnId,
      beforeState: { status: current.stockReturn.status, collectionStatus: current.status },
      afterState: {
        status: nextStatus,
        collectionId: current.id,
        collectionStatus: received.status,
        receiptLocationId: receiptLocation.id,
      },
    });
    const stockReturn = await tx.distributorStockReturn.findUnique({
      where: { id: stockReturnId },
      include: RETURN_INCLUDE,
    });
    return { stockReturn, collection: received, replayed: false };
    }, { isolationLevel: "Serializable" });
    return result;
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const raced = await prisma.distributorStockReturnCollection.findUnique({
      where: { receiptIdempotencyKey },
      include: {
        lines: { include: { stockReturnLine: true } },
        stockReturn: { include: RETURN_INCLUDE },
      },
    });
    if (!raced) throw error;
    const receiptLines = normalizeReceiptLines(rawLines, raced.lines);
    if (raced.receiptRequestHash !== receiptRequestDigest({
      distributorId,
      stockReturnId,
      collectionId,
      notes,
      lines: receiptLines,
    })) {
      throw fail("Idempotency-Key was already used for a different return receipt.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return { stockReturn: raced.stockReturn, collection: raced, replayed: true };
  }
};

export const inspectDistributorStockReturnCollection = async ({
  distributorId,
  stockReturnId,
  collectionId,
  notes: rawNotes,
  lines: rawLines,
  idempotencyKey: rawIdempotencyKey,
  actor,
}) => {
  if (!actor?.accountId) throw fail("An authenticated administrator is required.", "ADMIN_ACTOR_REQUIRED", 401);
  const notes = String(rawNotes || "").trim();
  if (notes.length > 2000) throw fail("Inspection notes cannot exceed 2000 characters.", "INVALID_RETURN_INSPECTION");
  const idempotencyKey = normalizeIdempotencyKey(
    rawIdempotencyKey,
    "DISTRIBUTOR_STOCK_RETURN_INSPECTION",
  );
  const existing = await prisma.distributorStockReturnInspection.findUnique({
    where: { idempotencyKey },
    include: {
      collection: {
        include: {
          lines: true,
          stockReturn: { include: RETURN_INCLUDE },
        },
      },
      lines: true,
    },
  });
  if (existing) {
    const lines = normalizeReturnInspectionLines(rawLines, existing.collection.lines);
    const requestHash = inspectionRequestDigest({ distributorId, stockReturnId, collectionId, notes, lines });
    if (existing.requestHash !== requestHash) {
      throw fail("Idempotency-Key was already used for a different return inspection.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return {
      stockReturn: existing.collection.stockReturn,
      collection: existing.collection,
      inspection: existing,
      replayed: true,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.distributorStockReturnCollection.findFirst({
        where: { id: collectionId, stockReturnId, stockReturn: { distributorId } },
        include: {
          lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          inspection: { include: { lines: true } },
          stockReturn: { select: { id: true, status: true } },
        },
      });
      if (!current) throw fail("Return collection not found.", "RETURN_COLLECTION_NOT_FOUND", 404);
      if (current.status !== "RECEIVED") {
        throw fail("Only a completed warehouse receipt can be inspected.", "RETURN_COLLECTION_NOT_RECEIVED", 409);
      }
      if (current.inspection) {
        throw fail("This collection already has a completed inspection.", "RETURN_INSPECTION_ALREADY_RECORDED", 409);
      }
      const lines = normalizeReturnInspectionLines(rawLines, current.lines);
      const requestHash = inspectionRequestDigest({ distributorId, stockReturnId, collectionId, notes, lines });
      const inspection = await tx.distributorStockReturnInspection.create({
        data: {
          collectionId,
          idempotencyKey,
          requestHash,
          inspectedByAccountId: actor.accountId,
          notes: notes || null,
          lines: {
            create: lines.map((line) => ({
              ...line,
              evidence: nullableJson(line.evidence),
            })),
          },
        },
        include: { lines: true },
      });
      await tx.distributorStockReturnEvent.create({
        data: {
          stockReturnId,
          action: "WAREHOUSE_INSPECTION_RECORDED",
          fromStatus: current.stockReturn.status,
          toStatus: current.stockReturn.status,
          actorAccountId: actor.accountId,
          notes: notes || null,
          metadata: {
            collectionId,
            inspectionId: inspection.id,
            lines: inspection.lines.map((line) => ({
              collectionLineId: line.collectionLineId,
              recommendedDisposition: line.recommendedDisposition,
              quantity: line.quantity,
            })),
          },
        },
      });
      await writeAudit(tx, actor, {
        action: "DISTRIBUTOR_STOCK_RETURN_INSPECTION_RECORDED",
        entityType: "DistributorStockReturnCollection",
        entityId: collectionId,
        beforeState: { inspectionRecorded: false },
        afterState: {
          inspectionId: inspection.id,
          inspectedAt: inspection.inspectedAt,
          lines: inspection.lines.map((line) => ({
            collectionLineId: line.collectionLineId,
            recommendedDisposition: line.recommendedDisposition,
            quantity: line.quantity,
          })),
        },
      });
      const [stockReturn, updatedCollection] = await Promise.all([
        tx.distributorStockReturn.findUnique({
          where: { id: stockReturnId },
          include: RETURN_INCLUDE,
        }),
        tx.distributorStockReturnCollection.findUnique({
          where: { id: collectionId },
          include: {
            lines: {
              include: {
                stockReturnLine: {
                  select: {
                    id: true,
                    inventorySkuId: true,
                    productNameSnapshot: true,
                    sizeSnapshot: true,
                    colorSnapshot: true,
                  },
                },
              },
            },
            inspection: { include: { lines: true } },
          },
        }),
      ]);
      return { stockReturn, collection: updatedCollection, inspection, replayed: false };
    }, { isolationLevel: "Serializable" });
    return result;
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const raced = await prisma.distributorStockReturnInspection.findUnique({
      where: { idempotencyKey },
      include: {
        collection: {
          include: {
            lines: true,
            stockReturn: { include: RETURN_INCLUDE },
          },
        },
        lines: true,
      },
    });
    if (!raced) {
      const existingCollectionInspection = await prisma.distributorStockReturnInspection.findUnique({
        where: { collectionId },
        select: { id: true },
      });
      if (existingCollectionInspection) {
        throw fail("This collection already has a completed inspection.", "RETURN_INSPECTION_ALREADY_RECORDED", 409);
      }
      throw error;
    }
    const lines = normalizeReturnInspectionLines(rawLines, raced.collection.lines);
    if (raced.requestHash !== inspectionRequestDigest({ distributorId, stockReturnId, collectionId, notes, lines })) {
      throw fail("Idempotency-Key was already used for a different return inspection.", "IDEMPOTENCY_CONFLICT", 409);
    }
    return {
      stockReturn: raced.collection.stockReturn,
      collection: raced.collection,
      inspection: raced,
      replayed: true,
    };
  }
};
