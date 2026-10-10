import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { applyInventoryMovement, ensureInventoryLocation, normalizeSkuOption } from "../services/inventoryLedgerService.js";
import { buildManufacturerStockMovements } from "../services/manufacturerInventoryAudit.js";
import { syncProductStock } from "../services/stockSyncService.js";
import { ensureAccountingParty } from "../services/accountingPartyService.js";
import { postJournalEntry } from "../services/accountingPostingEngine.js";
import {
  normalizeDistributorInboundChecklist,
  normalizeDistributorStockDecrease,
} from "../services/distributorStockService.js";
import {
  buildReceiptRequestHash,
  buildShipmentRequestHash,
  deriveTransferStatus,
  normalizeApprovalLines,
  normalizeShipmentReceiptLines,
  normalizeTransferPreparationChecklist,
  normalizeTransferRequestLines,
  buildNcmStockTransferPayload,
  extractNcmOrderId,
  latestNcmStockTransferStatus,
  normalizeNcmStockTransferEvent,
  normalizeNcmOrderId,
  normalizeNcmStockTransferStatusHistory,
  normalizeNcmStockTransferPackageDetails,
  isNcmBranchEligible,
  shouldAdvanceNcmStockTransferStatus,
  isTransferPreparationComplete,
  isSameProfileOwner,
  isPositiveLocalFreightCharge,
  planCostLayerAllocations,
  remainingApprovedQuantity,
  validateTransferRequestAvailability,
} from "../services/stockTransferService.js";
import {
  createOrderOnce,
  getNcmResponseRejection,
  getOrder,
  getOrderStatus,
  getShippingRate,
  requestOrderReturnOnce,
} from "../services/ncmClient.js";

const fail = (message, code = "INVALID_STOCK_TRANSFER", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const clean = (value) => String(value || "").trim();
const MAX_PAGE_SIZE = 100;

const transferInclude = {
  manufacturer: { select: { id: true, name: true, phone: true, city: true, pickupAddress: true, pickupContactName: true, pickupContactPhone: true, ncmPickupBranch: true, pickupBranchStatus: true } },
  distributor: { select: { id: true, name: true, phone: true, address: true, city: true, ncmPickupBranch: true, pickupBranchStatus: true } },
  lines: {
    include: {
      inventorySku: { include: { product: { select: { id: true, name: true } } } },
      shipmentLines: {
        include: {
          shipment: { select: {
            id: true, status: true, bookingMode: true, deliveryPartner: true,
            trackingNumber: true, externalReference: true, ncmOrderId: true,
            freightCharge: true, freightSettlementStatus: true, packageWeight: true,
            packageType: true, productType: true, productDescription: true,
            packageDimensions: true, isFragile: true, deliveryInstruction: true,
            packagingNotes: true, ncmStatus: true, ncmStatusHistory: true,
            ncmPaymentStatus: true, ncmLastSyncedAt: true, ncmLastEventAt: true,
            ncmReturnStatus: true, ncmReturnReason: true, ncmReturnRequestedAt: true,
            createdAt: true, dispatchedAt: true, deliveredAt: true,
          } },
          receiptLines: { include: { receipt: { select: { id: true, receivedAt: true, receivedBy: true, notes: true, status: true } } } },
          costLayerAllocations: { include: { costLayer: { select: { id: true, unitCogs: true, unitDeliveryCost: true } } } },
        },
      },
    },
  },
  shipments: {
    include: {
      lines: {
        include: {
          stockTransferLine: { include: { inventorySku: { include: { product: { select: { id: true, name: true } } } } } },
          receiptLines: { include: { receipt: { select: { id: true, receivedAt: true, receivedBy: true, notes: true, status: true } } } },
          costLayerAllocations: { include: { costLayer: { select: { id: true, unitCogs: true, unitDeliveryCost: true } } } },
        },
      },
      receipts: { orderBy: { receivedAt: "desc" }, include: { lines: true } },
      discrepancies: { orderBy: { createdAt: "desc" } },
      events: { orderBy: [{ occurredAt: "desc" }, { receivedAt: "desc" }] },
    },
  },
  discrepancies: { orderBy: { createdAt: "desc" } },
};

const respondError = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "The stock transfer operation could not be completed.",
    ...(error.code ? { code: error.code } : {}),
  });
};

const actorFor = (req) => ({
  id: req.auth?.accountId || req.auth?.profileId,
  role: String(req.auth?.role || "").toUpperCase(),
});

const isOwnStoreTransfer = async (tx, transfer) => {
  const [manufacturer, distributor] = await Promise.all([
    tx.manufacturer.findUnique({ where: { id: transfer.manufacturerId }, select: { accountId: true } }),
    tx.distributor.findUnique({ where: { id: transfer.distributorId }, select: { accountId: true } }),
  ]);
  return isSameProfileOwner(manufacturer?.accountId, distributor?.accountId);
};

const assertPreparationComplete = (transfer) => {
  if (!isTransferPreparationComplete(transfer)) {
    throw fail("Complete and save every manufacturer product preparation check before dispatch.", "TRANSFER_PREPARATION_REQUIRED", 409);
  }
};

const requestKeyFor = (req) => clean(req.get?.("Idempotency-Key") || req.body?.idempotencyKey);

const resolveStockRequestLines = async (tx, lines) => {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw fail("A stock request must contain between 1 and 100 SKU lines.");
  }
  const variantLines = lines.map((line) => {
    if (line?.inventorySkuId) return null;
    const productId = clean(line?.productId);
    if (!clean(line?.size) || !clean(line?.color)) {
      throw fail("Each variant stock request must include a size and color.");
    }
    const size = normalizeSkuOption(line?.size);
    const color = normalizeSkuOption(line?.color);
    const quantity = Number(line?.quantity);
    if (!productId || productId.length > 191 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
      throw fail("Each variant stock request must include a valid product, size, color, and positive whole-number quantity.");
    }
    return { productId, size, color };
  });
  const variantKeys = new Set(variantLines.filter(Boolean).map(({ productId, size, color }) =>
    JSON.stringify([productId, size.key, color.key])
  ));
  let variantSkuByKey = new Map();
  if (variantKeys.size) {
    const variantInputs = variantLines.filter(Boolean);
    const skus = await tx.inventorySku.findMany({
      where: {
        isActive: true,
        OR: variantInputs.map(({ productId, size, color }) => ({
          productId,
          sizeKey: size.key,
          colorKey: color.key,
        })),
      },
      select: { id: true, productId: true, sizeKey: true, colorKey: true },
    });
    variantSkuByKey = new Map(skus.map((sku) => [
      JSON.stringify([sku.productId, sku.sizeKey, sku.colorKey]),
      sku.id,
    ]));
  }
  const resolvedLines = lines.map((line, index) => {
    if (line?.inventorySkuId) return line;
    const variant = variantLines[index];
    const inventorySkuId = variantSkuByKey.get(JSON.stringify([variant.productId, variant.size.key, variant.color.key]));
    if (!inventorySkuId) {
      throw fail(`No active inventory SKU exists for product ${variant.productId} (${variant.size.label}/${variant.color.label}).`, "SKU_NOT_FOUND", 404);
    }
    return { inventorySkuId, quantity: line.quantity };
  });
  return normalizeTransferRequestLines(resolvedLines);
};

const ensureActiveDistributor = async (tx, distributorId) => {
  const distributor = await tx.distributor.findFirst({
    where: { id: distributorId, status: "ACTIVE", isActive: true },
    select: { id: true, name: true, phone: true, address: true, city: true },
  });
  if (!distributor) throw fail("An active distributor profile is required.", "DISTRIBUTOR_NOT_ACTIVE", 403);
  return distributor;
};

const loadTransfer = (tx, id) => tx.stockTransfer.findUnique({
  where: { id },
  include: {
    manufacturer: { select: { id: true, name: true, phone: true, city: true, pickupAddress: true, pickupContactName: true, pickupContactPhone: true, ncmPickupBranch: true, pickupBranchStatus: true } },
    distributor: {
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        ncmPickupBranch: true,
        pickupBranchStatus: true,
      },
    },
    lines: { include: { inventorySku: { include: { product: { select: { id: true, name: true } } } } } },
    shipments: { select: { id: true } },
  },
});

const normalizeDispatchRequestLines = (requestedLines, transferLines) => {
  if (!Array.isArray(requestedLines) || requestedLines.length < 1 || requestedLines.length > transferLines.length) {
    throw fail("A shipment must contain at least one approved SKU line.");
  }
  const byId = new Map(transferLines.map((line) => [line.id, line]));
  const seen = new Set();
  return requestedLines.map((requested) => {
    const lineId = clean(requested?.lineId);
    const line = byId.get(lineId);
    const quantity = Number(requested?.quantity);
    if (
      !line ||
      seen.has(lineId) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > 2147483647
    ) {
      throw fail("Shipment quantities must be positive whole numbers for unique transfer lines.");
    }
    seen.add(lineId);
    return { stockTransferLineId: lineId, quantity, line };
  });
};

const assertDispatchAvailability = (lines) => {
  for (const { line, quantity } of lines) {
    if (quantity > remainingApprovedQuantity(line)) {
      throw fail("Shipment quantities must be within each approved, undispatched line.", "INSUFFICIENT_APPROVED_QUANTITY", 409);
    }
  }
};

const normalizeFreightCharge = (value) => {
  if (value === undefined || value === null || value === "") return null;
  let amount;
  try {
    amount = new Prisma.Decimal(String(value));
  } catch {
    throw fail("Freight charge must be a valid non-negative amount.");
  }
  if (!amount.isFinite() || amount.lessThan(0) || amount.greaterThan("999999999999999999.99")) {
    throw fail("Freight charge must be a non-negative amount within the supported limit.");
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

const shipmentHashPayload = ({
  bookingMode,
  deliveryPartner,
  trackingNumber,
  externalReference,
  freightCharge,
  packageDetails,
  originBranch = null,
  destinationBranch = null,
  lines,
}) => ({
  bookingMode,
  deliveryPartner: deliveryPartner || null,
  trackingNumber: trackingNumber || null,
  externalReference: externalReference || null,
  freightCharge: freightCharge === null ? null : String(freightCharge),
  weight: packageDetails?.packageWeight ?? null,
  packageDetails: packageDetails ?? null,
  originBranch,
  destinationBranch,
  lines: [...lines]
    .map(({ stockTransferLineId, quantity }) => ({ stockTransferLineId, quantity }))
    .sort((left, right) => left.stockTransferLineId.localeCompare(right.stockTransferLineId)),
});

const groupedShipmentLines = (transfer, shipmentLines) => {
  const transferLines = new Map(transfer.lines.map((line) => [line.id, line]));
  const grouped = new Map();
  for (const shipmentLine of shipmentLines) {
    const line = transferLines.get(shipmentLine.stockTransferLineId);
    if (!line) throw fail("A shipment line no longer belongs to this stock transfer.", "TRANSFER_LINE_NOT_FOUND", 409);
    const productId = line.inventorySku.productId;
    const group = grouped.get(productId) || [];
    group.push({ line, quantity: shipmentLine.quantity });
    grouped.set(productId, group);
  }
  return grouped;
};

const updateLegacyFactoryStock = async (tx, transfer, shipmentLines, { reserve = false, release = false, actorId = null } = {}) => {
  const grouped = groupedShipmentLines(transfer, shipmentLines);
  for (const [productId, stockLines] of grouped) {
    const inventory = await tx.manufacturerInventory.findUnique({
      where: { manufacturerId_productId: { manufacturerId: transfer.manufacturerId, productId } },
    });
    if (!inventory) throw fail("Legacy factory stock is missing; reconcile before transferring inventory.", "LEGACY_FACTORY_STOCK_MISSING", 409);
    let variants;
    try {
      variants = Array.isArray(inventory.variantsStock)
        ? inventory.variantsStock.map((variant) => ({ ...variant }))
        : JSON.parse(inventory.variantsStock || "[]");
    } catch {
      throw fail("Legacy factory variant data is invalid; reconcile before transferring inventory.", "LEGACY_FACTORY_STOCK_INVALID", 409);
    }
    if (!Array.isArray(variants)) throw fail("Legacy factory variants are invalid; reconcile before transferring inventory.", "LEGACY_FACTORY_STOCK_INVALID", 409);
    let quantityDelta = 0;
    let reservedDelta = 0;
    for (const { line, quantity } of stockLines) {
      const sizeKey = normalizeSkuOption(line.inventorySku.size).key;
      const colorKey = normalizeSkuOption(line.inventorySku.color).key;
      const variant = variants.find((item) =>
        normalizeSkuOption(item.size).key === sizeKey && normalizeSkuOption(item.color).key === colorKey
      );
      if (!variant) throw fail("A requested variant is absent from legacy factory stock; reconcile before transferring inventory.", "LEGACY_FACTORY_VARIANT_MISSING", 409);
      const onHand = Number(variant.quantity || 0);
      const reserved = Number(variant.reservedQty || 0);
      if (!Number.isSafeInteger(onHand) || !Number.isSafeInteger(reserved) || onHand < 0 || reserved < 0 || reserved > onHand) {
        throw fail("Legacy factory stock contains an invalid variant balance.", "LEGACY_FACTORY_STOCK_INVALID", 409);
      }
      if (reserve) {
        if (onHand - reserved < quantity) throw fail("The legacy factory inventory has insufficient unreserved stock.", "INSUFFICIENT_LEGACY_STOCK", 409);
        variant.reservedQty = reserved + quantity;
        reservedDelta += quantity;
      } else if (release) {
        if (reserved < quantity) throw fail("The legacy factory shipment reservation is inconsistent.", "LEGACY_RESERVATION_CONFLICT", 409);
        variant.reservedQty = reserved - quantity;
        reservedDelta -= quantity;
      } else {
        if (onHand - reserved < quantity) throw fail("The legacy factory inventory has insufficient unreserved stock.", "INSUFFICIENT_LEGACY_STOCK", 409);
        variant.quantity = onHand - quantity;
        quantityDelta += quantity;
      }
    }
    const previousQuantity = Number(inventory.quantity || 0);
    const previousReserved = Number(inventory.reservedQty || 0);
    const variantQuantity = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
    const variantReserved = variants.reduce((sum, variant) => sum + Number(variant.reservedQty || 0), 0);
    const nextQuantity = previousQuantity - quantityDelta;
    const nextReserved = previousReserved + reservedDelta;
    if (variantQuantity !== nextQuantity || variantReserved !== nextReserved || nextQuantity < nextReserved) {
      throw fail("Legacy factory aggregate quantities do not match their variants; reconcile before transferring inventory.", "LEGACY_FACTORY_STOCK_VARIANCE", 409);
    }
    const updated = await tx.manufacturerInventory.updateMany({
      where: { id: inventory.id, quantity: previousQuantity, reservedQty: previousReserved },
      data: {
        quantity: nextQuantity,
        reservedQty: nextReserved,
        variantsStock: variants,
      },
    });
    if (updated.count !== 1) throw fail("Legacy factory stock changed concurrently; refresh and retry.", "LEGACY_FACTORY_STOCK_CONFLICT", 409);
    if (quantityDelta) {
      const movements = buildManufacturerStockMovements({
        previousVariants: Array.isArray(inventory.variantsStock) ? inventory.variantsStock : JSON.parse(inventory.variantsStock || "[]"),
        nextVariants: variants,
        productId,
        productName: stockLines[0].line.inventorySku.product.name,
        manufacturerId: transfer.manufacturerId,
        actorId,
        reason: "BULK_TRANSFER_DISPATCH",
        note: `Stock transfer ${transfer.id}`,
      });
      if (movements.length) await tx.manufacturerInventoryMovement.createMany({ data: movements });
      await syncProductStock(productId, { client: tx, throwOnError: true });
    }
  }
};

const adjustFactoryLedgerReservations = async (tx, transfer, shipmentLines, { release = false } = {}) => {
  for (const { line, quantity } of [...groupedShipmentLines(transfer, shipmentLines).values()].flat()) {
    const key = { locationId_inventorySkuId: { locationId: transfer.sourceLocationId, inventorySkuId: line.inventorySkuId } };
    await tx.inventoryBalance.upsert({
      where: key,
      create: { locationId: transfer.sourceLocationId, inventorySkuId: line.inventorySkuId, quantityOnHand: 0, reservedQuantity: 0 },
      update: {},
    });
    const balance = await tx.inventoryBalance.findUnique({ where: key });
    const nextReserved = balance.reservedQuantity + (release ? -quantity : quantity);
    if (release ? balance.reservedQuantity < quantity : balance.quantityOnHand - balance.reservedQuantity < quantity) {
      throw fail("The factory ledger has insufficient unreserved stock for the NCM booking.", release ? "LEDGER_RESERVATION_CONFLICT" : "INSUFFICIENT_FACTORY_STOCK", 409);
    }
    const updated = await tx.inventoryBalance.updateMany({
      where: {
        locationId: transfer.sourceLocationId,
        inventorySkuId: line.inventorySkuId,
        quantityOnHand: balance.quantityOnHand,
        reservedQuantity: balance.reservedQuantity,
      },
      data: { reservedQuantity: nextReserved },
    });
    if (updated.count !== 1) throw fail("The factory balance changed concurrently; refresh and retry.", "INVENTORY_CONFLICT", 409);
  }
};

const allocateShipmentCostLayers = async (tx, transfer, shipment, { reserve = false } = {}) => {
  const transferLines = new Map(transfer.lines.map((line) => [line.id, line]));
  let uncostedQuantity = 0;
  for (const shipmentLine of shipment.lines) {
    const transferLine = transferLines.get(shipmentLine.stockTransferLineId);
    if (!transferLine) throw fail("A shipment line no longer belongs to this stock transfer.", "TRANSFER_LINE_NOT_FOUND", 409);
    const layers = await tx.manufacturerInventoryCostLayer.findMany({
      where: {
        manufacturerId: transfer.manufacturerId,
        inventorySkuId: transferLine.inventorySkuId,
        availableQuantity: { gt: 0 },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, availableQuantity: true, reservedQuantity: true },
    });
    const plan = planCostLayerAllocations(layers, shipmentLine.quantity);
    for (const allocation of plan.allocations) {
      const layer = layers.find((item) => item.id === allocation.costLayerId);
      const updated = await tx.manufacturerInventoryCostLayer.updateMany({
        where: {
          id: layer.id,
          availableQuantity: layer.availableQuantity,
          reservedQuantity: layer.reservedQuantity,
        },
        data: {
          availableQuantity: { decrement: allocation.quantity },
          ...(reserve ? { reservedQuantity: { increment: allocation.quantity } } : {}),
        },
      });
      if (updated.count !== 1) throw fail("A production cost layer changed concurrently; refresh and retry.", "COST_LAYER_CONFLICT", 409);
      await tx.stockTransferShipmentLineCostLayer.create({
        data: {
          shipmentLineId: shipmentLine.id,
          costLayerId: layer.id,
          quantity: allocation.quantity,
          status: reserve ? "RESERVED" : "DISPATCHED",
        },
      });
    }
    uncostedQuantity += plan.uncostedQuantity;
    await tx.stockTransferShipmentLine.update({
      where: { id: shipmentLine.id },
      data: { uncostedQuantity: plan.uncostedQuantity },
    });
  }
  return { uncostedQuantity };
};

const finalizeShipmentCostLayers = async (tx, shipment, { release = false } = {}) => {
  const allocations = await tx.stockTransferShipmentLineCostLayer.findMany({
    where: {
      shipmentLine: { shipmentId: shipment.id },
      status: "RESERVED",
    },
  });
  for (const allocation of allocations) {
    const updated = await tx.manufacturerInventoryCostLayer.updateMany({
      where: { id: allocation.costLayerId, reservedQuantity: { gte: allocation.quantity } },
      data: release
        ? {
            reservedQuantity: { decrement: allocation.quantity },
            availableQuantity: { increment: allocation.quantity },
          }
        : { reservedQuantity: { decrement: allocation.quantity } },
    });
    if (updated.count !== 1) throw fail("A production cost-layer reservation is inconsistent.", "COST_LAYER_RESERVATION_CONFLICT", 409);
    await tx.stockTransferShipmentLineCostLayer.update({
      where: { id: allocation.id },
      data: { status: release ? "RELEASED" : "DISPATCHED" },
    });
  }
};

const createTransferShipment = async (tx, transfer, {
  lines,
  bookingMode,
  bookingIdempotencyKey,
  bookingRequestHash,
  deliveryPartner = null,
  trackingNumber = null,
  externalReference = null,
  freightCharge = null,
  initialStatus = "PREPARING",
  packageDetails = null,
}) => tx.stockTransferShipment.create({
  data: {
    stockTransferId: transfer.id,
    bookingMode,
    bookingIdempotencyKey,
    bookingRequestHash,
    deliveryPartner,
    trackingNumber,
    externalReference,
    freightCharge,
    ...(packageDetails ? {
      packageWeight: packageDetails.packageWeight,
      packageType: packageDetails.packageType,
      productType: packageDetails.productType,
      productDescription: packageDetails.productDescription,
      packageDimensions: packageDetails.packageDimensions,
      isFragile: packageDetails.isFragile,
      deliveryInstruction: packageDetails.deliveryInstruction || null,
      packagingNotes: packageDetails.packagingNotes || null,
    } : {}),
    status: initialStatus,
    ...(initialStatus === "BOOKING_PENDING" ? {} : { bookedAt: new Date() }),
    lines: {
      create: lines.map(({ stockTransferLineId, quantity }) => ({ stockTransferLineId, quantity })),
    },
  },
  include: { lines: true },
});

const dispatchShipmentStock = async (tx, transfer, shipment, lines, actor, { releaseReservations = false } = {}) => {
  if (releaseReservations) {
    await adjustFactoryLedgerReservations(tx, transfer, shipment.lines, { release: true });
    await updateLegacyFactoryStock(tx, transfer, shipment.lines, { release: true, actorId: actor.id });
    await finalizeShipmentCostLayers(tx, shipment);
  } else {
    await allocateShipmentCostLayers(tx, transfer, shipment);
  }
  const transitLocation = await ensureInventoryLocation(tx, {
    kind: "IN_TRANSIT",
    referenceId: shipment.id,
    name: `Transfer ${transfer.id.slice(-8)} shipment`,
  });
  for (const shipmentLine of shipment.lines) {
    const transferLine = lines.find((line) => line.id === shipmentLine.stockTransferLineId);
    if (!transferLine) throw fail("A shipment line no longer belongs to this stock transfer.", "TRANSFER_LINE_NOT_FOUND", 409);
    const reservationDecrement = releaseReservations ? shipmentLine.quantity : 0;
    if (releaseReservations && transferLine.reservedShipmentQuantity < shipmentLine.quantity) {
      throw fail("The NCM booking reservation no longer matches the shipment.", "TRANSFER_RESERVATION_CONFLICT", 409);
    }
    await applyInventoryMovement(tx, {
      inventorySkuId: transferLine.inventorySkuId,
      sourceLocationId: transfer.sourceLocationId,
      destinationLocationId: transitLocation.id,
      quantity: shipmentLine.quantity,
      movementType: "TRANSFER_DISPATCH",
      referenceType: "STOCK_TRANSFER",
      referenceId: transfer.id,
      idempotencyKey: `stock-transfer:${shipment.id}:dispatch:${transferLine.inventorySkuId}`,
      actorId: actor.id,
      actorRole: actor.role,
      reason: `Bulk stock dispatched to distributor under transfer ${transfer.id}.`,
    });
    const updated = await tx.stockTransferLine.updateMany({
      where: {
        id: transferLine.id,
        dispatchedQuantity: transferLine.dispatchedQuantity,
        reservedShipmentQuantity: transferLine.reservedShipmentQuantity,
      },
      data: {
        dispatchedQuantity: { increment: shipmentLine.quantity },
        ...(reservationDecrement ? { reservedShipmentQuantity: { decrement: reservationDecrement } } : {}),
      },
    });
    if (updated.count !== 1) throw fail("The transfer line changed concurrently; refresh and retry.", "TRANSFER_LINE_CONFLICT", 409);
    transferLine.dispatchedQuantity += shipmentLine.quantity;
    transferLine.reservedShipmentQuantity -= reservationDecrement;
  }
  await updateLegacyFactoryStock(tx, transfer, shipment.lines, { actorId: actor.id });
  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "IN_TRANSIT", dispatchedAt: transfer.dispatchedAt || new Date() },
  });
  return transitLocation;
};

const releaseNcmReservations = async (tx, transfer, shipment, actorId) => {
  const lines = transfer.lines;
  await adjustFactoryLedgerReservations(tx, transfer, shipment.lines, { release: true });
  await updateLegacyFactoryStock(tx, transfer, shipment.lines, { release: true, actorId });
  await finalizeShipmentCostLayers(tx, shipment, { release: true });
  for (const shipmentLine of shipment.lines) {
    const transferLine = lines.find((line) => line.id === shipmentLine.stockTransferLineId);
    if (!transferLine || transferLine.reservedShipmentQuantity < shipmentLine.quantity) {
      throw fail("The NCM booking reservation no longer matches the shipment.", "TRANSFER_RESERVATION_CONFLICT", 409);
    }
    const updated = await tx.stockTransferLine.updateMany({
      where: { id: transferLine.id, reservedShipmentQuantity: transferLine.reservedShipmentQuantity },
      data: { reservedShipmentQuantity: { decrement: shipmentLine.quantity } },
    });
    if (updated.count !== 1) throw fail("The transfer reservation changed concurrently.", "TRANSFER_LINE_CONFLICT", 409);
    transferLine.reservedShipmentQuantity -= shipmentLine.quantity;
  }
};

const completedLineQuantities = (transfer) => transfer.lines.flatMap((line) =>
  line.shipmentLines.map((shipmentLine) => shipmentLine.receiptLines.reduce((sum, receiptLine) => ({
    goodQuantity: sum.goodQuantity + receiptLine.goodQuantity,
    damagedQuantity: sum.damagedQuantity + receiptLine.damagedQuantity,
    missingQuantity: sum.missingQuantity + receiptLine.missingQuantity,
  }), { goodQuantity: 0, damagedQuantity: 0, missingQuantity: 0 }))
);

export const getStockTransferCatalog = async (req, res) => {
  try {
    await ensureActiveDistributor(prisma, req.distributorId);
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        quantityOnHand: { gt: 0 },
        location: { kind: "FACTORY", isActive: true, manufacturer: { isActive: true } },
        inventorySku: { isActive: true, product: { published: true, deletedAt: null } },
      },
      select: {
        quantityOnHand: true,
        reservedQuantity: true,
        location: { select: { manufacturerId: true, manufacturer: { select: { id: true, name: true, city: true } } } },
        inventorySku: { select: { id: true, size: true, color: true, product: { select: { id: true, name: true } } } },
      },
      orderBy: [{ location: { manufacturer: { name: "asc" } } }, { inventorySku: { product: { name: "asc" } } }],
      take: 5000,
    });
    const manufacturers = new Map();
    for (const balance of balances) {
      const manufacturer = balance.location.manufacturer;
      const availableQuantity = balance.quantityOnHand - balance.reservedQuantity;
      if (!manufacturer || availableQuantity <= 0) continue;
      if (!manufacturers.has(manufacturer.id)) manufacturers.set(manufacturer.id, { ...manufacturer, stock: [] });
      manufacturers.get(manufacturer.id).stock.push({
        inventorySkuId: balance.inventorySku.id,
        productId: balance.inventorySku.product.id,
        productName: balance.inventorySku.product.name,
        size: balance.inventorySku.size,
        color: balance.inventorySku.color,
        availableQuantity,
      });
    }
    return res.json({ success: true, manufacturers: [...manufacturers.values()] });
  } catch (error) {
    return respondError(res, error, "getStockTransferCatalog");
  }
};

export const createStockTransferRequest = async (req, res) => {
  try {
    const manufacturerId = clean(req.body?.manufacturerId);
    if (!manufacturerId || manufacturerId.length > 191) throw fail("Select a valid manufacturer.");
    const transfer = await prisma.$transaction(async (tx) => {
      await ensureActiveDistributor(tx, req.distributorId);
      const requestedLines = await resolveStockRequestLines(tx, req.body?.lines);
      const manufacturer = await tx.manufacturer.findFirst({
        where: { id: manufacturerId, isActive: true },
        select: { id: true },
      });
      if (!manufacturer) throw fail("The selected manufacturer is not active.", "MANUFACTURER_NOT_ACTIVE", 404);
      const skus = await tx.inventorySku.findMany({
        where: { id: { in: requestedLines.map((line) => line.inventorySkuId) }, isActive: true, product: { published: true, deletedAt: null } },
        select: { id: true },
      });
      if (skus.length !== requestedLines.length) throw fail("Every requested product variant must be active.", "SKU_INACTIVE", 409);
      const sourceLocation = await tx.inventoryLocation.findFirst({
        where: { kind: "FACTORY", manufacturerId, inventoryOwner: "PLATFORM", isActive: true },
        select: { id: true },
      });
      if (!sourceLocation) throw fail("The selected manufacturer has no factory stock location yet.", "FACTORY_LOCATION_NOT_FOUND", 409);
      const factoryBalances = await tx.inventoryBalance.findMany({
        where: {
          locationId: sourceLocation.id,
          inventorySkuId: { in: requestedLines.map((line) => line.inventorySkuId) },
        },
        select: { inventorySkuId: true, quantityOnHand: true, reservedQuantity: true },
      });
      validateTransferRequestAvailability(requestedLines, factoryBalances);
      const destinationLocation = await ensureInventoryLocation(tx, {
        kind: "DISTRIBUTOR",
        distributorId: req.distributorId,
        name: `Distributor ${req.distributorId.slice(-8)}`,
      });
      return tx.stockTransfer.create({
        data: {
          manufacturerId,
          distributorId: req.distributorId,
          sourceLocationId: sourceLocation.id,
          destinationLocationId: destinationLocation.id,
          requestedByAccountId: req.auth.accountId,
          lines: { create: requestedLines },
        },
        include: transferInclude,
      });
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error, "createStockTransferRequest");
  }
};

export const updateStockTransferPreparation = async (req, res) => {
  try {
    const checklist = normalizeTransferPreparationChecklist(req.body?.checklist);
    const transfer = await prisma.$transaction(async (tx) => {
      const current = await loadTransfer(tx, req.params.id);
      if (!current || current.manufacturerId !== req.manufacturerId) {
        throw fail("Stock transfer request not found.", "TRANSFER_NOT_FOUND", 404);
      }
      if (current.status !== "APPROVED" || current.lines.some((line) =>
        line.dispatchedQuantity > 0 || line.reservedShipmentQuantity > 0
      ) || current.shipments.length > 0) {
        throw fail("Preparation checks can only be updated before any shipment is created.", "TRANSFER_STATE_CONFLICT", 409);
      }
      return tx.stockTransfer.update({
        where: { id: current.id },
        data: {
          ...checklist,
          preparedByAccountId: req.auth.accountId,
          preparedAt: new Date(),
        },
        include: transferInclude,
      });
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error, "updateStockTransferPreparation");
  }
};

export const listDistributorStockTransfers = async (req, res) => {
  try {
    await ensureActiveDistributor(prisma, req.distributorId);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const where = { distributorId: req.distributorId };
    const [transfers, total] = await prisma.$transaction([
      prisma.stockTransfer.findMany({ where, include: transferInclude, orderBy: { requestedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.stockTransfer.count({ where }),
    ]);
    return res.json({ success: true, transfers, page, limit, total });
  } catch (error) {
    return respondError(res, error, "listDistributorStockTransfers");
  }
};

export const listManufacturerStockTransfers = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const where = { manufacturerId: req.manufacturerId, status: { not: "PENDING_ADMIN_APPROVAL" } };
    const [transfers, total, pendingPreparationCount] = await prisma.$transaction([
      prisma.stockTransfer.findMany({
        where,
        include: {
          ...transferInclude,
          distributor: { select: { id: true, name: true, phone: true, address: true, city: true, accountId: true } },
        },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.stockTransfer.count({ where }),
      prisma.stockTransfer.count({ where: { manufacturerId: req.manufacturerId, status: "APPROVED" } }),
    ]);
    const visibleTransfers = transfers.map(({ distributor, ...transfer }) => ({
      ...transfer,
      isOwnStore: Boolean(req.auth.accountId && distributor.accountId === req.auth.accountId),
      distributor: {
        id: distributor.id,
        name: distributor.name,
        phone: distributor.phone,
        address: distributor.address,
        city: distributor.city,
      },
    }));
    return res.json({ success: true, transfers: visibleTransfers, page, limit, total, pendingPreparationCount });
  } catch (error) {
    return respondError(res, error, "listManufacturerStockTransfers");
  }
};

export const listAdminStockTransfers = async (req, res) => {
  try {
    const status = clean(req.query.status).toUpperCase();
    const bookingMode = clean(req.query.bookingMode).toUpperCase();
    if (bookingMode && bookingMode !== "NCM") throw fail("Booking mode filter is invalid.");
    const where = {
      ...(status ? { status } : {}),
      ...(bookingMode ? { shipments: { some: { bookingMode } } } : {}),
    };
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const [transfers, total] = await prisma.$transaction([
      prisma.stockTransfer.findMany({ where, include: transferInclude, orderBy: { requestedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.stockTransfer.count({ where }),
    ]);
    return res.json({ success: true, transfers, page, limit, total });
  } catch (error) {
    return respondError(res, error, "listAdminStockTransfers");
  }
};

export const listAdminInventoryDiscrepancies = async (req, res) => {
  try {
    const status = clean(req.query.status).toUpperCase();
    if (status && !["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"].includes(status)) {
      throw fail("Discrepancy status filter is invalid.");
    }
    const distributorId = clean(req.query.distributorId);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const where = {
      ...(status ? { status } : {}),
      ...(distributorId ? { distributorId } : {}),
    };
    const [discrepancies, total] = await prisma.$transaction([
      prisma.inventoryDiscrepancy.findMany({
        where,
        include: {
          distributor: { select: { id: true, name: true } },
          inventoryLocation: { select: { id: true, name: true, kind: true } },
          inventorySku: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
          stockTransfer: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryDiscrepancy.count({ where }),
    ]);
    return res.json({ success: true, discrepancies, page, limit, total });
  } catch (error) {
    return respondError(res, error, "listAdminInventoryDiscrepancies");
  }
};

export const reviewStockTransferRequest = async (req, res) => {
  const targetStatus = clean(req.body?.status).toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(targetStatus)) {
    return res.status(400).json({ success: false, message: "Status must be APPROVED or REJECTED." });
  }
  try {
    const transfer = await prisma.$transaction(async (tx) => {
      const current = await loadTransfer(tx, req.params.id);
      if (!current) throw fail("Stock transfer request not found.", "TRANSFER_NOT_FOUND", 404);
      if (current.status !== "PENDING_ADMIN_APPROVAL") throw fail("Only pending transfer requests can be reviewed.", "TRANSFER_STATE_CONFLICT", 409);
      if (targetStatus === "REJECTED") {
        await tx.stockTransferLine.updateMany({
          where: { stockTransferId: current.id },
          data: { approvedQuantity: 0 },
        });
        return tx.stockTransfer.update({
          where: { id: current.id },
          data: {
            status: "REJECTED",
            reviewedByAccountId: req.auth.accountId,
            reviewedAt: new Date(),
            adminNote: clean(req.body?.adminNote) || null,
          },
          include: transferInclude,
        });
      }
      const approvalLines = normalizeApprovalLines(req.body?.lines, current.lines);
      const balanceBySku = await tx.inventoryBalance.findMany({
        where: { locationId: current.sourceLocationId, inventorySkuId: { in: current.lines.map((line) => line.inventorySkuId) } },
        select: { inventorySkuId: true, quantityOnHand: true, reservedQuantity: true },
      });
      const balances = new Map(balanceBySku.map((balance) => [balance.inventorySkuId, balance]));
      for (const approval of approvalLines) {
        const line = current.lines.find((item) => item.id === approval.id);
        const balance = balances.get(line.inventorySkuId);
        const available = balance ? balance.quantityOnHand - balance.reservedQuantity : 0;
        if (approval.approvedQuantity > available) {
          throw fail(`Approved quantity for ${line.inventorySku.product.name} (${line.inventorySku.size}/${line.inventorySku.color}) exceeds available factory stock.`, "INSUFFICIENT_FACTORY_STOCK", 409);
        }
      }
      if (approvalLines.every((line) => line.approvedQuantity === 0)) {
        throw fail("Approve at least one unit or reject the transfer request.");
      }
      for (const line of approvalLines) {
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { approvedQuantity: line.approvedQuantity },
        });
      }
      return tx.stockTransfer.update({
        where: { id: current.id },
        data: {
          status: "APPROVED",
          reviewedByAccountId: req.auth.accountId,
          reviewedAt: new Date(),
          adminNote: clean(req.body?.adminNote) || null,
        },
        include: transferInclude,
      });
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error, "reviewStockTransferRequest");
  }
};

export const dispatchManualStockTransfer = async (req, res) => {
  try {
    const idempotencyKey = requestKeyFor(req);
    if (!idempotencyKey || idempotencyKey.length > 140) throw fail("Provide a valid Idempotency-Key for this shipment.");
    const deliveryPartner = clean(req.body?.deliveryPartner);
    const trackingNumber = clean(req.body?.trackingNumber) || null;
    const externalReference = clean(req.body?.externalReference) || null;
    if (!deliveryPartner || deliveryPartner.length > 191) throw fail("A manual shipment carrier name is required.");
    if (trackingNumber?.length > 191 || externalReference?.length > 191) throw fail("Shipment tracking details are too long.");
    const freightCharge = normalizeFreightCharge(req.body?.freightCharge);
    if (!isPositiveLocalFreightCharge(freightCharge)) {
      throw fail("Local logistics requires a positive manufacturer-paid freight charge.", "LOCAL_FREIGHT_REQUIRED", 400);
    }
    const outcome = await prisma.$transaction(async (tx) => {
      const transfer = await loadTransfer(tx, req.params.id);
      if (!transfer || transfer.manufacturerId !== req.manufacturerId) throw fail("Stock transfer not found.", "TRANSFER_NOT_FOUND", 404);
      assertPreparationComplete(transfer);
      if (await isOwnStoreTransfer(tx, transfer)) {
        throw fail("This distributor is your own store. Use own-store delivery with zero freight instead.", "OWN_STORE_DELIVERY_REQUIRED", 409);
      }
      const actor = actorFor(req);
      const requestedLines = normalizeDispatchRequestLines(req.body?.lines, transfer.lines);
      const requestHash = buildShipmentRequestHash(shipmentHashPayload({
        bookingMode: "MANUAL",
        deliveryPartner,
        trackingNumber,
        externalReference,
        freightCharge,
        weight: null,
        lines: requestedLines,
      }));
      const fullIdempotencyKey = `${transfer.id}:manual:${idempotencyKey}`;
      const existing = await tx.stockTransferShipment.findUnique({ where: { bookingIdempotencyKey: fullIdempotencyKey } });
      if (existing) {
        if (existing.bookingRequestHash !== requestHash) throw fail("The shipment idempotency key was used for different shipment details.", "IDEMPOTENCY_CONFLICT", 409);
        return { shipment: existing, replayed: true };
      }
      if (!["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(transfer.status)) {
        throw fail("This transfer is not available for dispatch.", "TRANSFER_STATE_CONFLICT", 409);
      }
      assertDispatchAvailability(requestedLines);
      const shipment = await createTransferShipment(tx, transfer, {
        lines: requestedLines,
        bookingMode: "MANUAL",
        bookingIdempotencyKey: fullIdempotencyKey,
        bookingRequestHash: requestHash,
        deliveryPartner,
        trackingNumber,
        externalReference,
        freightCharge,
        initialStatus: "DISPATCHED",
      });
      await dispatchShipmentStock(tx, transfer, shipment, transfer.lines, actor);
      const updatedShipment = await tx.stockTransferShipment.update({
        where: { id: shipment.id },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
        include: { lines: true },
      });
      if (freightCharge?.greaterThan(0)) {
        const party = await ensureAccountingParty({
          partyType: "MANUFACTURER",
          sourceEntityId: transfer.manufacturerId,
          displayName: transfer.manufacturer.name,
        }, { client: tx });
        await postJournalEntry({
          transactionDate: new Date(),
          sourceType: "MANUFACTURER_LOGISTICS",
          sourceId: shipment.id,
          idempotencyKey: `MANUFACTURER_LOGISTICS:TRANSFER:${shipment.id}`,
          referenceNumber: `MFG-LOG-${shipment.id.slice(-8).toUpperCase()}`,
          description: `Manufacturer-paid logistics for stock transfer ${transfer.id}`,
          lines: [
            {
              mappingKey: "DELIVERY_EXPENSE",
              debit: freightCharge,
              credit: 0,
              description: `Local logistics for stock transfer ${transfer.id}`,
            },
            {
              mappingKey: "MANUFACTURER_PAYABLE",
              debit: 0,
              credit: freightCharge,
              description: `Local logistics payable to ${transfer.manufacturer.name}`,
              supplierId: transfer.manufacturerId,
              accountingPartyId: party.id,
            },
          ],
          client: tx,
        });
      }
      return { shipment: updatedShipment, replayed: false };
    }, { isolationLevel: "Serializable" });
    return res.status(outcome.replayed ? 200 : 201).json({ success: true, ...outcome });
  } catch (error) {
    return respondError(res, error, "dispatchManualStockTransfer");
  }
};

export const bookNcmStockTransfer = async (req, res) => {
  try {
    const transfer = await loadTransfer(prisma, req.params.id);
    if (!transfer || transfer.manufacturerId !== req.manufacturerId) throw fail("Stock transfer not found.", "TRANSFER_NOT_FOUND", 404);
    assertPreparationComplete(transfer);
    if (await isOwnStoreTransfer(prisma, transfer)) {
      throw fail("This distributor is your own store. Use own-store delivery with zero freight instead.", "OWN_STORE_DELIVERY_REQUIRED", 409);
    }
    const idempotencyKey = requestKeyFor(req);
    if (!idempotencyKey || idempotencyKey.length > 140) throw fail("Provide a valid Idempotency-Key for this NCM booking.");
    const packageDetails = normalizeNcmStockTransferPackageDetails(req.body?.packageDetails || req.body);
    const requestedLines = normalizeDispatchRequestLines(req.body?.lines, transfer.lines);
    const fullIdempotencyKey = `${transfer.id}:ncm:${idempotencyKey}`;
    const requestHash = buildShipmentRequestHash(shipmentHashPayload({
      bookingMode: "NCM",
      deliveryPartner: "NCM",
      trackingNumber: null,
      externalReference: null,
      freightCharge: null,
      weight: packageDetails.packageWeight,
      packageDetails,
      originBranch: transfer.manufacturer.ncmPickupBranch,
      destinationBranch: transfer.distributor.ncmPickupBranch,
      lines: requestedLines,
    }));
    const existingShipment = await prisma.stockTransferShipment.findUnique({
      where: { bookingIdempotencyKey: fullIdempotencyKey },
    });
    if (existingShipment) {
      if (existingShipment.bookingRequestHash !== requestHash) throw fail("The NCM idempotency key was used for different shipment details.", "IDEMPOTENCY_CONFLICT", 409);
      return res.json({
        success: true,
        shipment: existingShipment,
        replayed: true,
        bookingPending: ["BOOKING_PENDING", "BOOKING_UNKNOWN"].includes(existingShipment.status),
      });
    }
    const branchNames = [
      clean(transfer.manufacturer.ncmPickupBranch).toUpperCase(),
      clean(transfer.distributor.ncmPickupBranch).toUpperCase(),
    ];
    const activeBranches = await prisma.ncmBranch.findMany({
      where: { name: { in: branchNames }, isActive: true },
      select: { name: true },
    });
    const activeBranchNames = activeBranches.map(({ name }) => name);
    if (!isNcmBranchEligible({
      branchName: transfer.manufacturer.ncmPickupBranch,
      status: transfer.manufacturer.pickupBranchStatus,
      activeBranchNames,
    })) {
      const rejected = String(transfer.manufacturer.pickupBranchStatus || "").toUpperCase() === "REJECTED";
      throw fail(
        rejected
          ? "The manufacturer's NCM pickup branch was rejected. Ask an administrator to assign a valid branch."
          : "The manufacturer's NCM pickup branch is missing from the active NCM branch catalog. Sync the NCM branches or choose manual booking.",
        rejected ? "NCM_PICKUP_BRANCH_REJECTED" : "NCM_PICKUP_BRANCH_UNAVAILABLE",
        409,
      );
    }
    if (!isNcmBranchEligible({
      branchName: transfer.distributor.ncmPickupBranch,
      status: transfer.distributor.pickupBranchStatus,
      activeBranchNames,
    })) {
      const rejected = String(transfer.distributor.pickupBranchStatus || "").toUpperCase() === "REJECTED";
      throw fail(
        rejected
          ? "The distributor's NCM destination branch was rejected. Ask an administrator to assign a valid branch."
          : "The distributor's NCM destination branch is missing from the active NCM branch catalog. Sync the NCM branches or choose manual booking.",
        rejected ? "NCM_DESTINATION_BRANCH_REJECTED" : "NCM_DESTINATION_BRANCH_UNAVAILABLE",
        409,
      );
    }
    const branchVerifiedAt = new Date();
    const branchVerificationUpdates = [
      ...(transfer.manufacturer.pickupBranchStatus !== "VERIFIED" ? [
        prisma.manufacturer.update({
          where: { id: transfer.manufacturer.id },
          data: { pickupBranchStatus: "VERIFIED", pickupBranchVerifiedAt: branchVerifiedAt },
        }),
      ] : []),
      ...(transfer.distributor.pickupBranchStatus !== "VERIFIED" ? [
        prisma.distributor.update({
          where: { id: transfer.distributor.id },
          data: { pickupBranchStatus: "VERIFIED", pickupBranchVerifiedAt: branchVerifiedAt },
        }),
      ] : []),
    ];
    if (branchVerificationUpdates.length) await prisma.$transaction(branchVerificationUpdates);
    if (!transfer.distributor.address || !transfer.distributor.phone) {
      throw fail("The distributor profile needs an address and phone number for NCM delivery.", "NCM_DESTINATION_INCOMPLETE", 409);
    }
    let rateResponse;
    try {
      rateResponse = await getShippingRate({
        creation: transfer.manufacturer.ncmPickupBranch,
        destination: transfer.distributor.ncmPickupBranch,
        type: "Door2Door",
      });
    } catch (error) {
      throw Object.assign(new Error("NCM could not quote this route. Check the pickup and destination branches or choose manual booking."), {
        code: error.code || "NCM_RATE_UNAVAILABLE",
        statusCode: 502,
      });
    }
    const rate = Number(rateResponse.data?.delivery_charge ?? rateResponse.data?.charge ?? rateResponse.data?.shipping_charge);
    if (!Number.isFinite(rate) || rate < 0) throw fail("NCM returned an invalid freight quote.", "NCM_INVALID_RATE", 502);
    const freightCharge = new Prisma.Decimal(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const prepared = await prisma.$transaction(async (tx) => {
      const current = await loadTransfer(tx, transfer.id);
      if (!current || current.manufacturerId !== req.manufacturerId) throw fail("Stock transfer not found.", "TRANSFER_NOT_FOUND", 404);
      if (!["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(current.status)) {
        throw fail("This transfer is not available for dispatch.", "TRANSFER_STATE_CONFLICT", 409);
      }
      const existing = await tx.stockTransferShipment.findUnique({ where: { bookingIdempotencyKey: fullIdempotencyKey } });
      if (existing) {
        if (existing.bookingRequestHash !== requestHash) throw fail("The NCM idempotency key was used for different shipment details.", "IDEMPOTENCY_CONFLICT", 409);
        return { shipment: existing, replayed: true };
      }
      const lockedLines = normalizeDispatchRequestLines(req.body?.lines, current.lines);
      assertDispatchAvailability(lockedLines);
      const reservationLines = lockedLines.map(({ stockTransferLineId, quantity }) => ({ stockTransferLineId, quantity }));
      await adjustFactoryLedgerReservations(tx, current, reservationLines);
      await updateLegacyFactoryStock(tx, current, reservationLines, { reserve: true, actorId: actorFor(req).id });
      for (const { line, quantity } of lockedLines) {
        const updated = await tx.stockTransferLine.updateMany({
          where: { id: line.id, reservedShipmentQuantity: line.reservedShipmentQuantity, dispatchedQuantity: line.dispatchedQuantity },
          data: { reservedShipmentQuantity: { increment: quantity } },
        });
        if (updated.count !== 1) throw fail("The transfer line changed concurrently; refresh and retry.", "TRANSFER_LINE_CONFLICT", 409);
        line.reservedShipmentQuantity += quantity;
      }
      const shipment = await createTransferShipment(tx, current, {
        lines: lockedLines,
        bookingMode: "NCM",
        bookingIdempotencyKey: fullIdempotencyKey,
        bookingRequestHash: requestHash,
        deliveryPartner: "NCM",
        freightCharge,
        packageDetails,
        initialStatus: "BOOKING_PENDING",
      });
      await allocateShipmentCostLayers(tx, current, shipment, { reserve: true });
      return { shipment, replayed: false };
    }, { isolationLevel: "Serializable" });

    if (prepared.replayed) {
      return res.json({ success: true, ...prepared, bookingPending: ["BOOKING_PENDING", "BOOKING_UNKNOWN"].includes(prepared.shipment.status) });
    }

    const ncmPayload = buildNcmStockTransferPayload({ transfer, packageDetails });

    let ncmResponse;
    try {
      ncmResponse = await createOrderOnce(ncmPayload);
      const rejection = getNcmResponseRejection(ncmResponse.data);
      if (rejection) {
        throw Object.assign(new Error(`NCM rejected the booking: ${rejection}`), {
          code: "NCM_BOOKING_REJECTED",
          httpStatus: 400,
          response: ncmResponse.data,
        });
      }
    } catch (error) {
      const isDefinitiveRejection = [400, 401, 403, 404, 422].includes(Number(error.httpStatus));
      await prisma.$transaction(async (tx) => {
        const currentShipment = await tx.stockTransferShipment.findUnique({
          where: { id: prepared.shipment.id },
          include: { lines: true },
        });
        if (!currentShipment || currentShipment.status !== "BOOKING_PENDING") return;
        if (isDefinitiveRejection) {
          const currentTransfer = await loadTransfer(tx, transfer.id);
          await releaseNcmReservations(tx, currentTransfer, currentShipment, req.auth.accountId);
        }
        await tx.stockTransferShipment.update({
          where: { id: currentShipment.id },
          data: { status: isDefinitiveRejection ? "BOOKING_FAILED" : "BOOKING_UNKNOWN" },
        });
      }, { isolationLevel: "Serializable" });
      throw Object.assign(new Error(isDefinitiveRejection
        ? "NCM rejected the booking; no stock was dispatched. Correct the details or use manual booking."
        : "NCM booking outcome is uncertain. Dispatch is locked until an administrator reconciles the carrier booking."),
      {
        code: isDefinitiveRejection ? "NCM_BOOKING_REJECTED" : "NCM_BOOKING_UNKNOWN",
        statusCode: isDefinitiveRejection ? 502 : 202,
      });
    }

    const ncmOrderId = extractNcmOrderId(ncmResponse.data);
    if (!ncmOrderId) {
      await prisma.stockTransferShipment.update({
        where: { id: prepared.shipment.id, status: "BOOKING_PENDING" },
        data: { status: "BOOKING_UNKNOWN" },
      });
      throw fail("NCM returned no booking reference. An administrator must reconcile this booking before retrying.", "NCM_BOOKING_UNKNOWN", 202);
    }

    const finalized = await prisma.$transaction(async (tx) => {
      const shipment = await tx.stockTransferShipment.findUnique({
        where: { id: prepared.shipment.id },
        include: { lines: true },
      });
      const current = await loadTransfer(tx, transfer.id);
      if (!shipment || shipment.status !== "BOOKING_PENDING") {
        throw fail("NCM booking is recorded but needs administrator reconciliation.", "NCM_BOOKING_FINALIZATION_REQUIRED", 202);
      }
      const booked = await tx.stockTransferShipment.update({
        where: { id: shipment.id },
        data: {
          status: "BOOKED",
          ncmOrderId,
          externalReference: ncmOrderId,
          trackingNumber: clean(ncmResponse.data?.tracking_number || ncmResponse.data?.trackingNumber) || null,
          bookedAt: new Date(),
          freightCharge,
        },
        include: { lines: true },
      });
      await tx.stockTransferShipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          eventKey: ncmShipmentEventKey(shipment.id, "BOOKING_CONFIRMED", ncmOrderId, ""),
          source: "NCM_BOOKING",
          eventType: "BOOKING_CONFIRMED",
          status: "BOOKED",
          payload: { orderId: ncmOrderId },
          occurredAt: booked.bookedAt,
        },
      });
      return booked;
    }, { isolationLevel: "Serializable" });
    return res.status(201).json({ success: true, shipment: finalized, replayed: false, codCharge: "0.00" });
  } catch (error) {
    return respondError(res, error, "bookNcmStockTransfer");
  }
};

const loadNcmShipmentForAction = async (req, { adminOnly = false } = {}) => {
  const shipment = await prisma.stockTransferShipment.findUnique({
    where: { id: req.params.shipmentId },
    include: { stockTransfer: { select: { manufacturerId: true, distributorId: true } } },
  });
  const isAdmin = req.adminId ||
    String(req.auth?.role || "").toUpperCase() === "ADMIN" ||
    req.auth?.roles?.includes("ADMIN");
  const isParticipant =
    (req.manufacturerId && shipment?.stockTransfer.manufacturerId === req.manufacturerId) ||
    (req.distributorId && shipment?.stockTransfer.distributorId === req.distributorId);
  if (
    !shipment ||
    shipment.bookingMode !== "NCM" ||
    (adminOnly ? !isAdmin : !isAdmin && !isParticipant)
  ) {
    throw fail("NCM shipment not found.", "SHIPMENT_NOT_FOUND", 404);
  }
  const ncmOrderId = normalizeNcmOrderId(shipment.ncmOrderId || shipment.externalReference);
  if (!ncmOrderId) {
    throw fail("This shipment has no confirmed NCM order ID to query.", "NCM_ORDER_ID_MISSING", 409);
  }
  return { shipment, ncmOrderId: Number(ncmOrderId) };
};

const parseNcmEventDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const ncmShipmentEventKey = (shipmentId, event, status, timestamp) => crypto
  .createHash("sha256")
  .update([shipmentId, event || "", status || "", timestamp || ""].join("|"))
  .digest("hex");

export const applyNcmStockTransferWebhook = async ({ payload, ncmId, source = "NCM_WEBHOOK" }) => {
  const orderId = String(ncmId || "").trim();
  if (!orderId) return false;
  const shipment = await prisma.stockTransferShipment.findFirst({
    where: {
      bookingMode: "NCM",
      OR: [{ ncmOrderId: orderId }, { externalReference: orderId }],
    },
    select: { id: true },
  });
  if (!shipment) return false;

  const event = String(payload.event || "NCM_STATUS_CHANGED").trim().slice(0, 191);
  const normalized = normalizeNcmStockTransferEvent(payload.status, payload.event);
  const status = normalized.status || null;
  const occurredAt = parseNcmEventDate(payload.timestamp);
  const eventKey = ncmShipmentEventKey(shipment.id, event, status, payload.timestamp || "");
  const occurredAtKey = eventKey;

  const webhookResult = await prisma.$transaction(async (tx) => {
    const current = await tx.stockTransferShipment.findUnique({
      where: { id: shipment.id },
      include: { lines: true },
    });
    if (!current || current.bookingMode !== "NCM") return null;

    const insertedEvent = await tx.stockTransferShipmentEvent.createMany({
      data: [{
        shipmentId: current.id,
        eventKey: occurredAtKey,
        source,
        eventType: event,
        status,
        payload: {
          orderId,
          status: payload.status || null,
          event: payload.event || null,
          timestamp: payload.timestamp || null,
        },
        occurredAt,
      }],
      skipDuplicates: true,
    });
    if (!insertedEvent.count) {
      return {
        shipmentId: current.id,
        shipmentStatus: current.status,
        ncmStatus: current.ncmStatus,
        duplicate: true,
        stockMovementApplied: false,
      };
    }

    let dispatchedAt = current.dispatchedAt;
    let shipmentStatus = current.status;
    let stockMovementApplied = false;
    if (normalized.custodyConfirmed && ["BOOKED", "BOOKING_UNKNOWN"].includes(current.status)) {
      const transfer = await loadTransfer(tx, current.stockTransferId);
      if (!transfer) throw fail("Stock transfer not found for NCM pickup event.", "TRANSFER_NOT_FOUND", 404);
      await dispatchShipmentStock(
        tx,
        transfer,
        current,
        transfer.lines,
        { id: null, role: "SYSTEM" },
        { releaseReservations: true },
      );
      dispatchedAt = new Date();
      shipmentStatus = "DISPATCHED";
      stockMovementApplied = true;
    }

    const shouldAdvanceStatus = shouldAdvanceNcmStockTransferStatus(current.ncmStatus || "", status || "");
    const previousEventAt = current.ncmLastEventAt;
    const latestEventAt = !previousEventAt || !occurredAt || occurredAt > previousEventAt
      ? (occurredAt || new Date())
      : previousEventAt;
    const history = Array.isArray(current.ncmStatusHistory) ? current.ncmStatusHistory : [];
    const nextHistory = status
      ? [{ status, addedAt: (occurredAt || new Date()).toISOString() }, ...history]
        .slice(0, 50)
      : history;

    const updated = await tx.stockTransferShipment.update({
      where: { id: current.id },
      data: {
        ...(shouldAdvanceStatus && status ? { ncmStatus: status } : {}),
        ...(status ? { ncmStatusHistory: nextHistory } : {}),
        ncmLastSyncedAt: new Date(),
        ncmLastEventAt: latestEventAt,
        ...(shipmentStatus !== current.status ? { status: shipmentStatus, dispatchedAt } : {}),
      },
      select: { id: true, status: true, ncmStatus: true },
    });
    return {
      shipmentId: updated.id,
      shipmentStatus: updated.status,
      ncmStatus: updated.ncmStatus,
      duplicate: false,
      stockMovementApplied,
    };
  }, { isolationLevel: "Serializable" });
  return webhookResult || false;
};

export const syncNcmStockTransferShipment = async (req, res) => {
  try {
    const { shipment, ncmOrderId } = await loadNcmShipmentForAction(req, { adminOnly: true });
    const [detailResponse, statusResponse] = await Promise.all([
      getOrder(ncmOrderId),
      getOrderStatus(ncmOrderId),
    ]);
    const ncmStatus = latestNcmStockTransferStatus(statusResponse, detailResponse);
    const ncmStatusHistory = normalizeNcmStockTransferStatusHistory(statusResponse);
    const detail = detailResponse.data && !Array.isArray(detailResponse.data)
      ? detailResponse.data
      : {};
    const deliveryCharge = detail.delivery_charge === undefined || detail.delivery_charge === null
      ? null
      : Number(detail.delivery_charge);
    if (deliveryCharge !== null && (!Number.isFinite(deliveryCharge) || deliveryCharge < 0)) {
      throw fail("NCM returned an invalid delivery charge.", "NCM_INVALID_RATE", 502);
    }
    if (ncmStatus) {
      await applyNcmStockTransferWebhook({
        payload: {
          order_id: String(ncmOrderId),
          status: ncmStatus,
          event: ncmStatus,
          timestamp: ncmStatusHistory[0]?.addedAt || null,
        },
        ncmId: String(ncmOrderId),
        source: "ADMIN_RECONCILIATION",
      });
    }
    const current = await prisma.stockTransferShipment.findUnique({ where: { id: shipment.id } });
    if (!current) throw fail("NCM shipment not found.", "SHIPMENT_NOT_FOUND", 404);
    if (ncmStatusHistory.length) {
      const orderedHistory = [...ncmStatusHistory].reverse();
      for (const entry of orderedHistory) {
        await applyNcmStockTransferWebhook({
          payload: {
            order_id: String(ncmOrderId),
            status: entry.status,
            event: entry.status,
            timestamp: entry.addedAt,
          },
          ncmId: String(ncmOrderId),
          source: "ADMIN_RECONCILIATION",
        });
      }
    } else if (ncmStatus) {
      await applyNcmStockTransferWebhook({
        payload: {
          order_id: String(ncmOrderId),
          status: ncmStatus,
          event: ncmStatus,
          timestamp: null,
        },
        ncmId: String(ncmOrderId),
        source: "ADMIN_RECONCILIATION",
      });
    }
    const updated = await prisma.stockTransferShipment.update({
      where: { id: shipment.id },
      data: {
        ...(detail.payment_status ? { ncmPaymentStatus: String(detail.payment_status).slice(0, 64) } : {}),
        ...(deliveryCharge === null ? {} : {
          freightCharge: new Prisma.Decimal(deliveryCharge).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        }),
        ...(detail.vendor_return === true && ["PENDING", "UNKNOWN"].includes(current.ncmReturnStatus)
          ? { ncmReturnStatus: "REQUESTED" }
          : {}),
        ncmLastSyncedAt: new Date(),
      },
    });
    return res.json({ success: true, shipment: updated });
  } catch (error) {
    if (error.code === "NCM_ORDER_ID_MISSING" || error.code === "SHIPMENT_NOT_FOUND" || error.code === "NCM_INVALID_RATE") {
      return respondError(res, error, "syncNcmStockTransferShipment");
    }
    console.error("syncNcmStockTransferShipment error:", error);
    return res.status(502).json({
      success: false,
      message: "NCM tracking could not be refreshed. The last saved carrier status has been kept.",
      code: error.code || "NCM_STATUS_SYNC_FAILED",
    });
  }
};

export const requestNcmStockTransferReturn = async (req, res) => {
  let shipment;
  try {
    const loaded = await loadNcmShipmentForAction(req);
    shipment = loaded.shipment;
    if (!req.manufacturerId || shipment.stockTransfer.manufacturerId !== req.manufacturerId) {
      throw fail("Only the manufacturer that booked this shipment can request an NCM return.", "NCM_RETURN_FORBIDDEN", 403);
    }
    const reason = clean(req.body?.reason);
    if (!reason || reason.length > 2000) throw fail("Provide an NCM return reason no longer than 2000 characters.");
    if (["REQUESTED", "PENDING", "UNKNOWN"].includes(shipment.ncmReturnStatus)) {
      if (shipment.ncmReturnStatus === "REQUESTED") return res.json({ success: true, shipment, replayed: true });
      throw fail("The NCM return request is unresolved. Refresh tracking before trying again.", "NCM_RETURN_UNRESOLVED", 409);
    }
    const claim = await prisma.stockTransferShipment.updateMany({
      where: { id: shipment.id, ncmReturnStatus: shipment.ncmReturnStatus },
      data: {
        ncmReturnStatus: "PENDING",
        ncmReturnReason: reason,
        ncmReturnRequestedAt: new Date(),
      },
    });
    if (claim.count !== 1) throw fail("The NCM return state changed; refresh the shipment and retry.", "NCM_RETURN_CONFLICT", 409);

    let response;
    try {
      response = await requestOrderReturnOnce({
        pk: loaded.ncmOrderId,
        comment: reason,
      });
    } catch (error) {
      const isDefinitiveRejection = [400, 401, 403, 404, 422].includes(Number(error.httpStatus));
      await prisma.stockTransferShipment.update({
        where: { id: shipment.id, ncmReturnStatus: "PENDING" },
        data: { ncmReturnStatus: isDefinitiveRejection ? "FAILED" : "UNKNOWN" },
      });
      throw Object.assign(
        new Error(isDefinitiveRejection
          ? "NCM rejected the return request. Correct the details or contact the carrier."
          : "NCM return outcome is uncertain. Refresh tracking before retrying."),
        { code: isDefinitiveRejection ? "NCM_RETURN_REJECTED" : "NCM_RETURN_UNKNOWN", statusCode: 502 },
      );
    }

    const rejection = getNcmResponseRejection(response.data);
    if (rejection) {
      await prisma.stockTransferShipment.update({
        where: { id: shipment.id, ncmReturnStatus: "PENDING" },
        data: { ncmReturnStatus: "FAILED" },
      });
      throw fail(`NCM rejected the return request: ${rejection}`, "NCM_RETURN_REJECTED", 502);
    }
    if (response.data?.vendor_return !== true) {
      await prisma.stockTransferShipment.update({
        where: { id: shipment.id, ncmReturnStatus: "PENDING" },
        data: { ncmReturnStatus: "UNKNOWN" },
      });
      throw fail("NCM did not confirm the return request. Refresh carrier status before retrying.", "NCM_RETURN_UNKNOWN", 202);
    }
    const updated = await prisma.stockTransferShipment.update({
      where: { id: shipment.id, ncmReturnStatus: "PENDING" },
      data: { ncmReturnStatus: "REQUESTED" },
    });
    return res.status(201).json({ success: true, shipment: updated, replayed: false });
  } catch (error) {
    return respondError(res, error, "requestNcmStockTransferReturn");
  }
};

export const deliverStockTransferToOwnStore = async (req, res) => {
  try {
    const idempotencyKey = requestKeyFor(req);
    if (!idempotencyKey || idempotencyKey.length > 140) {
      throw fail("Provide a valid Idempotency-Key for own-store delivery.");
    }
    const outcome = await prisma.$transaction(async (tx) => {
      const transfer = await loadTransfer(tx, req.params.id);
      if (!transfer || transfer.manufacturerId !== req.manufacturerId) {
        throw fail("Stock transfer not found.", "TRANSFER_NOT_FOUND", 404);
      }
      if (!(await isOwnStoreTransfer(tx, transfer))) {
        throw fail("Own-store delivery is available only when the manufacturer and distributor profiles belong to the same account.", "NOT_OWN_STORE_TRANSFER", 409);
      }
      await ensureActiveDistributor(tx, transfer.distributorId);
      assertPreparationComplete(transfer);
      const requestedLines = normalizeDispatchRequestLines(req.body?.lines, transfer.lines);
      const bookingIdempotencyKey = `${transfer.id}:self-store:${idempotencyKey}`;
      const requestHash = buildShipmentRequestHash(shipmentHashPayload({
        bookingMode: "SELF_STORE",
        deliveryPartner: "Own distributor store",
        trackingNumber: null,
        externalReference: null,
        freightCharge: new Prisma.Decimal(0),
        weight: null,
        lines: requestedLines,
      }));
      const existing = await tx.stockTransferShipment.findUnique({
        where: { bookingIdempotencyKey },
      });
      if (existing) {
        if (existing.bookingRequestHash !== requestHash) {
          throw fail("The own-store idempotency key was used for different shipment details.", "IDEMPOTENCY_CONFLICT", 409);
        }
        return { shipment: existing, replayed: true };
      }
      if (!["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(transfer.status)) {
        throw fail("This transfer is not available for own-store delivery.", "TRANSFER_STATE_CONFLICT", 409);
      }
      assertDispatchAvailability(requestedLines);
      const shipment = await createTransferShipment(tx, transfer, {
        lines: requestedLines,
        bookingMode: "SELF_STORE",
        bookingIdempotencyKey,
        bookingRequestHash: requestHash,
        deliveryPartner: "Own distributor store",
        freightCharge: new Prisma.Decimal(0),
        initialStatus: "DELIVERED",
      });
      const actor = actorFor(req);
      const transitLocation = await dispatchShipmentStock(tx, transfer, shipment, transfer.lines, actor);
      const receiptNotes = "Delivered directly to the manufacturer's own distributor store.";
      const receiptLines = shipment.lines.map((line) => ({
        shipmentLineId: line.id,
        goodQuantity: line.quantity,
        damagedQuantity: 0,
        missingQuantity: 0,
        damageType: null,
        evidence: null,
        note: null,
      }));
      const receiptRequestHash = buildReceiptRequestHash({ notes: receiptNotes, lines: receiptLines });
      const receipt = await tx.stockTransferReceipt.create({
        data: {
          shipmentId: shipment.id,
          idempotencyKey: `${shipment.id}:self-store-receipt`,
          requestHash: receiptRequestHash,
          status: "CONFIRMED",
          receivedBy: req.auth.accountId,
          notes: receiptNotes,
          lines: {
            create: receiptLines.map(({ shipmentLineId, goodQuantity }) => ({ shipmentLineId, goodQuantity })),
          },
        },
      });
      for (const line of shipment.lines) {
        const transferLine = transfer.lines.find((item) => item.id === line.stockTransferLineId);
        if (!transferLine) throw fail("A shipment line no longer belongs to this stock transfer.", "TRANSFER_LINE_NOT_FOUND", 409);
        await applyInventoryMovement(tx, {
          inventorySkuId: transferLine.inventorySkuId,
          sourceLocationId: transitLocation.id,
          destinationLocationId: transfer.destinationLocationId,
          quantity: line.quantity,
          movementType: "TRANSFER_RECEIPT",
          referenceType: "STOCK_TRANSFER_RECEIPT",
          referenceId: receipt.id,
          idempotencyKey: `stock-transfer:${receipt.id}:${line.id}:own-store`,
          actorId: actor.id,
          actorRole: actor.role,
          reason: "Accepted-good units delivered directly to the manufacturer's own distributor store.",
        });
      }
      const productIds = [...new Set(transfer.lines
        .filter((line) => requestedLines.some((requested) => requested.stockTransferLineId === line.id))
        .map((line) => line.inventorySku.productId))];
      await Promise.all(productIds.map((productId) =>
        syncProductStock(productId, { client: tx, throwOnError: true })
      ));
      await tx.stockTransferShipment.update({
        where: { id: shipment.id },
        data: {
          status: "DELIVERED",
          freightCharge: new Prisma.Decimal(0),
          freightSettlementStatus: "NOT_APPLICABLE",
          dispatchedAt: new Date(),
          deliveredAt: new Date(),
        },
      });
      const updatedTransfer = await tx.stockTransfer.findUnique({
        where: { id: transfer.id },
        include: {
          lines: { include: { shipmentLines: { include: { receiptLines: true } } } },
        },
      });
      const status = deriveTransferStatus({
        lines: updatedTransfer.lines,
        shipmentLines: completedLineQuantities(updatedTransfer),
      });
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status,
          ...(["RECEIVED", "DISCREPANCY"].includes(status) ? { completedAt: new Date() } : {}),
        },
      });
      return {
        shipment: await tx.stockTransferShipment.findUnique({
          where: { id: shipment.id },
          include: { lines: true, receipts: { include: { lines: true } } },
        }),
        replayed: false,
        transferStatus: status,
      };
    }, { isolationLevel: "Serializable" });
    return res.status(outcome.replayed ? 200 : 201).json({ success: true, ...outcome, freightCharge: "0.00" });
  } catch (error) {
    return respondError(res, error, "deliverStockTransferToOwnStore");
  }
};

export const dispatchStockTransferRequest = async (req, res) => {
  try {
    const method = clean(req.body?.deliveryMethod || req.body?.method).toUpperCase().replace(/[\s-]+/g, "_");
    if (method === "SELF_STORE") {
      return deliverStockTransferToOwnStore(req, res);
    }
    if (["NCM", "NEPAL_CAN_MOVE"].includes(method)) {
      return bookNcmStockTransfer(req, res);
    }
    if (!["LOCAL", "LOCAL_LOGISTICS"].includes(method)) {
      throw fail("Delivery method must be NCM or LOCAL_LOGISTICS.");
    }
    const freightCharge = normalizeFreightCharge(req.body?.freightCharge);
    if (!freightCharge?.greaterThan(0)) {
      throw fail("Local logistics requires a positive manufacturer-paid freight charge.");
    }
    req.body = {
      ...req.body,
      deliveryPartner: clean(req.body?.deliveryPartner) || "Local Logistics",
      freightCharge: freightCharge.toFixed(2),
    };
    return dispatchManualStockTransfer(req, res);
  } catch (error) {
    return respondError(res, error, "dispatchStockTransferRequest");
  }
};

export const resolveNcmShipmentBooking = async (req, res) => {
  const outcome = clean(req.body?.outcome).toUpperCase();
  if (!["BOOKED", "NOT_BOOKED"].includes(outcome)) {
    return res.status(400).json({ success: false, message: "Outcome must be BOOKED or NOT_BOOKED." });
  }
  try {
    const shipment = await prisma.$transaction(async (tx) => {
      const currentShipment = await tx.stockTransferShipment.findUnique({
        where: { id: req.params.shipmentId },
        include: { lines: true },
      });
      const isUnresolvedBooking = ["BOOKING_PENDING", "BOOKING_UNKNOWN"].includes(currentShipment?.status);
      const canRepairMissingReference = ["BOOKED", "DISPATCHED", "PARTIALLY_RECEIVED", "DELIVERED", "DISCREPANCY"].includes(currentShipment?.status)
        && !normalizeNcmOrderId(currentShipment.ncmOrderId || currentShipment.externalReference);
      const pendingTooRecently = currentShipment?.status === "BOOKING_PENDING"
        && Date.now() - currentShipment.createdAt.getTime() < 5 * 60 * 1000;
      if (
        !currentShipment ||
        currentShipment.bookingMode !== "NCM" ||
        (!isUnresolvedBooking && !(outcome === "BOOKED" && canRepairMissingReference)) ||
        pendingTooRecently
      ) {
        throw fail("Only an unresolved NCM booking or a dispatched/received NCM shipment missing its carrier ID can be reconciled.", "SHIPMENT_STATE_CONFLICT", 409);
      }
      const transfer = await loadTransfer(tx, currentShipment.stockTransferId);
      if (!transfer) throw fail("Stock transfer not found.", "TRANSFER_NOT_FOUND", 404);
      if (outcome === "NOT_BOOKED" && !isUnresolvedBooking) {
        throw fail("A dispatched shipment cannot be marked as not booked.", "SHIPMENT_STATE_CONFLICT", 409);
      }
      if (outcome === "NOT_BOOKED") {
        await releaseNcmReservations(tx, transfer, currentShipment, req.auth.accountId);
        return tx.stockTransferShipment.update({
          where: { id: currentShipment.id },
          data: { status: "BOOKING_FAILED" },
          include: { lines: true },
        });
      }
      const ncmOrderId = normalizeNcmOrderId(req.body?.externalReference);
      if (!ncmOrderId) throw fail("Provide the numeric NCM order ID confirmed in the carrier portal.");
      const conflictingShipment = await tx.stockTransferShipment.findFirst({
        where: { ncmOrderId, id: { not: currentShipment.id } },
        select: { id: true },
      });
      if (conflictingShipment) {
        throw fail("That NCM order ID is already linked to another shipment.", "NCM_ORDER_ID_CONFLICT", 409);
      }
      const booked = await tx.stockTransferShipment.update({
        where: { id: currentShipment.id },
        data: {
          ...(isUnresolvedBooking ? { status: "BOOKED" } : {}),
          ncmOrderId,
          externalReference: ncmOrderId,
          trackingNumber: clean(req.body?.trackingNumber) || currentShipment.trackingNumber,
          freightCharge: normalizeFreightCharge(req.body?.freightCharge) ?? currentShipment.freightCharge,
          bookedAt: currentShipment.bookedAt || new Date(),
        },
        include: { lines: true },
      });
      if (isUnresolvedBooking) {
        await tx.stockTransferShipmentEvent.create({
          data: {
            shipmentId: currentShipment.id,
            eventKey: ncmShipmentEventKey(currentShipment.id, "BOOKING_CONFIRMED", ncmOrderId, ""),
            source: "ADMIN_RECONCILIATION",
            eventType: "BOOKING_CONFIRMED",
            status: "BOOKED",
            payload: { orderId: ncmOrderId },
            occurredAt: booked.bookedAt,
          },
        });
      }
      return booked;
    }, { isolationLevel: "Serializable" });
    return res.json({ success: true, shipment });
  } catch (error) {
    return respondError(res, error, "resolveNcmShipmentBooking");
  }
};

export const receiveStockTransferForRequest = async (req, res) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id },
      include: {
        shipments: {
          where: { status: { in: ["DISPATCHED", "PARTIALLY_RECEIVED"] } },
          include: {
            lines: {
              include: {
                stockTransferLine: { include: { inventorySku: true } },
                receiptLines: true,
              },
            },
          },
        },
      },
    });
    if (!transfer || transfer.distributorId !== req.distributorId) {
      throw fail("Stock request not found for this distributor.", "TRANSFER_NOT_FOUND", 404);
    }
    const pendingShipments = transfer.shipments.map((shipment) => ({
      ...shipment,
      lines: shipment.lines.map((line) => ({
        ...line,
        remainingQuantity: line.quantity - line.receiptLines.reduce(
          (total, receiptLine) => total + receiptLine.goodQuantity + receiptLine.damagedQuantity + receiptLine.missingQuantity,
          0,
        ),
      })).filter((line) => line.remainingQuantity > 0),
    })).filter((shipment) => shipment.lines.length > 0);
    const shipment = req.body?.shipmentId
      ? pendingShipments.find((candidate) => candidate.id === String(req.body.shipmentId))
      : pendingShipments.length === 1 ? pendingShipments[0] : null;
    if (!shipment) {
      if (pendingShipments.length > 1 && !req.body?.shipmentId) {
        throw fail("This stock request has multiple dispatched shipments; provide shipmentId from the transfer details.", "SHIPMENT_ID_REQUIRED", 409);
      }
      throw fail("No dispatched shipment awaiting receipt was found for this stock request.", "SHIPMENT_NOT_FOUND", 404);
    }
    const checklist = normalizeDistributorInboundChecklist(
      req.body?.checklist || req.body,
      shipment.lines,
    );
    req.params.shipmentId = shipment.id;
    req.body = {
      ...req.body,
      lines: checklist.lines,
      notes: [
        String(req.body?.notes || "").trim(),
        `Overall quality check passed.${checklist.qualityNotes ? ` ${checklist.qualityNotes}` : ""}`,
      ].filter(Boolean).join("\n"),
    };
    return receiveStockTransferShipment(req, res);
  } catch (error) {
    return respondError(res, error, "receiveStockTransferForRequest");
  }
};

export const receiveStockTransferShipment = async (req, res) => {
  try {
    const idempotencyKey = requestKeyFor(req);
    if (!idempotencyKey || idempotencyKey.length > 140) throw fail("Provide a valid Idempotency-Key for this receipt.");
    const notes = clean(req.body?.notes);
    if (notes.length > 4000) throw fail("Receipt notes cannot exceed 4000 characters.");
    const outcome = await prisma.$transaction(async (tx) => {
      const shipment = await tx.stockTransferShipment.findUnique({
        where: { id: req.params.shipmentId },
        include: {
          stockTransfer: {
            include: {
              manufacturer: { select: { id: true, name: true } },
              distributor: { select: { id: true, name: true } },
              lines: true,
            },
          },
          lines: {
            include: {
              stockTransferLine: { include: { inventorySku: true } },
              receiptLines: true,
            },
          },
        },
      });
      if (!shipment || shipment.stockTransfer.distributorId !== req.distributorId) {
        throw fail("Shipment not found for this distributor.", "SHIPMENT_NOT_FOUND", 404);
      }
      await ensureActiveDistributor(tx, req.distributorId);
      const idempotencyKeyFull = `${shipment.id}:receipt:${idempotencyKey}`;
      const normalizedForHash = normalizeShipmentReceiptLines(req.body?.lines, shipment.lines.map((line) => ({
        id: line.id,
        remainingQuantity: line.quantity,
      })));
      const requestHash = buildReceiptRequestHash({ notes, lines: normalizedForHash });
      const existing = await tx.stockTransferReceipt.findUnique({ where: { idempotencyKey: idempotencyKeyFull } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw fail("The receipt idempotency key was used for different receipt details.", "IDEMPOTENCY_CONFLICT", 409);
        return { receipt: existing, replayed: true };
      }
      if (!["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status)) {
        throw fail("Only dispatched shipments awaiting receipt can be received.", "SHIPMENT_STATE_CONFLICT", 409);
      }
      const receiptLines = normalizeShipmentReceiptLines(req.body?.lines, shipment.lines.map((line) => {
        const previouslyAccounted = line.receiptLines.reduce(
          (sum, receiptLine) => sum + receiptLine.goodQuantity + receiptLine.damagedQuantity + receiptLine.missingQuantity,
          0,
        );
        return { id: line.id, remainingQuantity: line.quantity - previouslyAccounted };
      }));
      const hasDiscrepancy = receiptLines.some((line) => line.damagedQuantity || line.missingQuantity);
      const receipt = await tx.stockTransferReceipt.create({
        data: {
          shipmentId: shipment.id,
          idempotencyKey: idempotencyKeyFull,
          requestHash,
          status: hasDiscrepancy ? "DISPUTED" : "CONFIRMED",
          receivedBy: req.auth.accountId,
          notes: notes || null,
          lines: {
            create: receiptLines.map((line) => ({
              ...line,
              evidence: line.evidence === null ? Prisma.DbNull : line.evidence,
            })),
          },
        },
        include: { lines: true },
      });
      const transitLocation = await ensureInventoryLocation(tx, {
        kind: "IN_TRANSIT",
        referenceId: shipment.id,
        name: `Transfer ${shipment.stockTransferId.slice(-8)} shipment`,
      });
      const damageLocation = await ensureInventoryLocation(tx, {
        kind: "DAMAGED",
        distributorId: req.distributorId,
        name: `Damaged stock ${shipment.stockTransfer.distributor.name}`,
      });
      const lostLocation = await ensureInventoryLocation(tx, {
        kind: "LOST",
        distributorId: req.distributorId,
        name: `Lost stock ${shipment.stockTransfer.distributor.name}`,
      });
      for (const receiptLine of receipt.lines) {
        const shipmentLine = shipment.lines.find((line) => line.id === receiptLine.shipmentLineId);
        const inventorySkuId = shipmentLine.stockTransferLine.inventorySkuId;
        if (receiptLine.goodQuantity) {
          await applyInventoryMovement(tx, {
            inventorySkuId,
            sourceLocationId: transitLocation.id,
            destinationLocationId: shipment.stockTransfer.destinationLocationId,
            quantity: receiptLine.goodQuantity,
            movementType: "TRANSFER_RECEIPT",
            referenceType: "STOCK_TRANSFER_RECEIPT",
            referenceId: receipt.id,
            idempotencyKey: `stock-transfer:${receipt.id}:${shipmentLine.id}:good`,
            actorId: req.auth.accountId,
            actorRole: "DISTRIBUTOR",
            reason: "Accepted-good units received at distributor location.",
          });
        }
        if (receiptLine.damagedQuantity) {
          await applyInventoryMovement(tx, {
            inventorySkuId,
            sourceLocationId: transitLocation.id,
            destinationLocationId: damageLocation.id,
            quantity: receiptLine.damagedQuantity,
            movementType: "DAMAGE",
            referenceType: "STOCK_TRANSFER_RECEIPT",
            referenceId: receipt.id,
            idempotencyKey: `stock-transfer:${receipt.id}:${shipmentLine.id}:damaged`,
            actorId: req.auth.accountId,
            actorRole: "DISTRIBUTOR",
            reason: `Distributor reported ${receiptLine.damageType.toLowerCase()} during bulk receipt.`,
          });
        }
        if (receiptLine.missingQuantity) {
          await applyInventoryMovement(tx, {
            inventorySkuId,
            sourceLocationId: transitLocation.id,
            destinationLocationId: lostLocation.id,
            quantity: receiptLine.missingQuantity,
            movementType: "LOSS",
            referenceType: "STOCK_TRANSFER_RECEIPT",
            referenceId: receipt.id,
            idempotencyKey: `stock-transfer:${receipt.id}:${shipmentLine.id}:missing`,
            actorId: req.auth.accountId,
            actorRole: "DISTRIBUTOR",
            reason: "Distributor reported missing units during bulk receipt.",
          });
        }
        const transferLine = shipmentLine.stockTransferLine;
        if (receiptLine.damagedQuantity) {
          await tx.inventoryDiscrepancy.create({
            data: {
              stockTransferId: shipment.stockTransferId,
              shipmentId: shipment.id,
              receiptId: receipt.id,
              distributorId: req.distributorId,
              inventoryLocationId: damageLocation.id,
              inventorySkuId,
              discrepancyType: receiptLine.damageType,
              custodyStage: "DISTRIBUTOR_RECEIPT",
              quantity: receiptLine.damagedQuantity,
              reportedBy: req.auth.accountId,
              reportedByRole: "DISTRIBUTOR",
              evidence: receiptLine.evidence === null ? Prisma.DbNull : receiptLine.evidence,
              details: receiptLine.note,
            },
          });
        }
        if (receiptLine.missingQuantity) {
          await tx.inventoryDiscrepancy.create({
            data: {
              stockTransferId: shipment.stockTransferId,
              shipmentId: shipment.id,
              receiptId: receipt.id,
              distributorId: req.distributorId,
              inventoryLocationId: lostLocation.id,
              inventorySkuId,
              discrepancyType: "MISSING",
              custodyStage: "IN_TRANSIT",
              quantity: receiptLine.missingQuantity,
              reportedBy: req.auth.accountId,
              reportedByRole: "DISTRIBUTOR",
              evidence: receiptLine.evidence === null ? Prisma.DbNull : receiptLine.evidence,
              details: receiptLine.note,
            },
          });
        }
        if (!transferLine) throw fail("Receipt line lost its transfer reference.", "TRANSFER_LINE_NOT_FOUND", 409);
      }
      const receivedProductIds = new Set(shipment.lines.map((line) =>
        line.stockTransferLine.inventorySku.productId
      ));
      await Promise.all([...receivedProductIds].map((productId) =>
        syncProductStock(productId, { client: tx, throwOnError: true })
      ));
      const updatedShipmentLines = await tx.stockTransferShipmentLine.findMany({
        where: { shipmentId: shipment.id },
        include: { receiptLines: true },
      });
      const shipmentComplete = updatedShipmentLines.every((line) =>
        line.receiptLines.reduce((sum, receiptLine) =>
          sum + receiptLine.goodQuantity + receiptLine.damagedQuantity + receiptLine.missingQuantity, 0
        ) === line.quantity
      );
      const shipmentHasDiscrepancy = updatedShipmentLines.some((line) =>
        line.receiptLines.some((receiptLine) => receiptLine.damagedQuantity || receiptLine.missingQuantity)
      );
      await tx.stockTransferShipment.update({
        where: { id: shipment.id },
        data: {
          status: shipmentComplete ? (shipmentHasDiscrepancy ? "DISCREPANCY" : "DELIVERED") : "PARTIALLY_RECEIVED",
          ...(shipmentComplete ? { deliveredAt: new Date() } : {}),
        },
      });
      const currentTransfer = await tx.stockTransfer.findUnique({
        where: { id: shipment.stockTransferId },
        include: {
          lines: { include: { shipmentLines: { include: { receiptLines: true } } } },
        },
      });
      const transferStatus = deriveTransferStatus({
        lines: currentTransfer.lines,
        shipmentLines: completedLineQuantities(currentTransfer),
      });
      await tx.stockTransfer.update({
        where: { id: currentTransfer.id },
        data: {
          status: transferStatus,
          ...(["RECEIVED", "DISCREPANCY"].includes(transferStatus) ? { completedAt: new Date() } : {}),
        },
      });
      return { receipt, replayed: false, shipmentStatus: shipmentComplete ? (shipmentHasDiscrepancy ? "DISCREPANCY" : "DELIVERED") : "PARTIALLY_RECEIVED", transferStatus };
    }, { isolationLevel: "Serializable" });
    return res.status(outcome.replayed ? 200 : 201).json({ success: true, ...outcome });
  } catch (error) {
    return respondError(res, error, "receiveStockTransferShipment");
  }
};
