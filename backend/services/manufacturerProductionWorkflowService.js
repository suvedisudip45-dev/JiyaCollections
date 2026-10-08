import { Prisma } from "@prisma/client";

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const validateAdminProductionPlan = ({ fabricType, gsm, targetCompletionDate, batches }) => {
  const normalizedFabric = String(fabricType || "").trim();
  const normalizedGsm = new Prisma.Decimal(String(gsm ?? ""));
  const completion = new Date(targetCompletionDate);
  if (!normalizedFabric || normalizedFabric.length > 120) {
    throw fail("Fabric type is required and must not exceed 120 characters.");
  }
  if (!normalizedGsm.isFinite() || !normalizedGsm.greaterThan(0) || normalizedGsm.greaterThan(1000)) {
    throw fail("GSM must be a valid value greater than zero and no more than 1000.");
  }
  if (!targetCompletionDate || Number.isNaN(completion.getTime())) {
    throw fail("A valid target completion date is required.");
  }
  if (!Array.isArray(batches) || batches.length < 1 || batches.length > 50) {
    throw fail("Provide between one and 50 production batches.");
  }
  const batchNumbers = new Set();
  const normalizedBatches = batches.map((batch, index) => {
    const batchNumber = String(batch?.batchNumber || index + 1).trim();
    const plannedQuantity = Number(batch?.plannedQuantity);
    if (!batchNumber || batchNumber.length > 80 || batchNumbers.has(batchNumber.toLowerCase())) {
      throw fail("Production batch numbers must be unique and no more than 80 characters.");
    }
    if (!Number.isSafeInteger(plannedQuantity) || plannedQuantity < 1 || plannedQuantity > 2147483647) {
      throw fail(`Planned quantity for batch ${batchNumber} must be a positive whole number.`);
    }
    batchNumbers.add(batchNumber.toLowerCase());
    return { batchNumber, plannedQuantity };
  });
  const batchQuantity = normalizedBatches.reduce((total, batch) => total + batch.plannedQuantity, 0);
  if (batchQuantity > 2147483647) throw fail("Total batch quantity exceeds the supported inventory limit.");
  return {
    fabricType: normalizedFabric,
    gsm: normalizedGsm.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    targetCompletionDate: completion,
    batches: normalizedBatches,
    batchQuantity,
  };
};

const validateBooleanChecklist = (value, fields, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail(`${label} checklist is required.`);
  }
  for (const field of fields) {
    if (typeof value[field] !== "boolean") throw fail(`${label} checklist field ${field} must be true or false.`);
  }
  const notes = value.notes === undefined ? "" : String(value.notes).trim();
  if (notes.length > 2000) throw fail(`${label} checklist notes cannot exceed 2000 characters.`);
  return { ...Object.fromEntries(fields.map((field) => [field, value[field]])), notes };
};

export const summarizeManufacturerProductionDashboard = ({
  factoryBalances = [],
  productionRequests = [],
}) => {
  const stockedProducts = new Set();
  const stockedSkus = new Set();
  let factoryUnitsOnHand = 0;
  let factoryUnitsAvailable = 0;
  let factoryUnitsReserved = 0;

  for (const balance of factoryBalances) {
    const onHand = Math.max(0, Number(balance.quantityOnHand || 0));
    const reserved = Math.max(0, Number(balance.reservedQuantity || 0));
    const available = Math.max(0, onHand - reserved);
    factoryUnitsOnHand += onHand;
    factoryUnitsReserved += reserved;
    factoryUnitsAvailable += available;
    if (onHand > 0) stockedSkus.add(balance.inventorySkuId);
    if (onHand > 0 && balance.inventorySku?.productId) {
      stockedProducts.add(balance.inventorySku.productId);
    }
  }

  let producedUnits = 0;
  let damagedUnits = 0;
  let goodUnitsProduced = 0;
  let completedBatches = 0;
  let failedQaBatches = 0;
  let activeBatches = 0;
  for (const request of productionRequests) {
    if (["PENDING_REVIEW", "PENDING_PRE_CHECK", "PRE_CHECK_FAILED", "PRE_CHECK_PASSED", "APPROVED", "IN_PRODUCTION", "POST_CHECK_FAILED"].includes(request.status)) {
      activeBatches += 1;
    }
    for (const line of request.lines || []) {
      if (line.actualQuantity === null || line.actualQuantity === undefined) continue;
      producedUnits += Number(line.actualQuantity || 0);
      damagedUnits += Number(line.damagedQuantity || 0);
      if (request.status === "COMPLETED") {
        goodUnitsProduced += Math.max(0, Number(line.actualQuantity || 0) - Number(line.damagedQuantity || 0));
      }
    }
    if (request.status === "COMPLETED") {
      completedBatches += 1;
    } else if (request.status === "POST_CHECK_FAILED") {
      failedQaBatches += 1;
    }
  }

  return {
    factoryProductCount: stockedProducts.size,
    factorySkuCount: stockedSkus.size,
    factoryUnitsOnHand,
    factoryUnitsAvailable,
    factoryUnitsReserved,
    producedUnits,
    goodUnitsProduced,
    damagedUnits,
    completedBatches,
    failedQaBatches,
    activeBatches,
  };
};

export const validatePreProductionChecklist = (value) => {
  const fields = ["fabricPassed", "qualitySamplePassed", "colorShadeMatched"];
  const fieldAliases = {
    fabricPassed: "fabricCheckPassed",
    qualitySamplePassed: "sampleCheckPassed",
    colorShadeMatched: "colorShadeCheckPassed",
  };
  const normalizedValue = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : value;
  if (normalizedValue && typeof normalizedValue === "object" && !Array.isArray(normalizedValue)) {
    for (const [field, alias] of Object.entries(fieldAliases)) {
      if (!Object.hasOwn(normalizedValue, field) && Object.hasOwn(normalizedValue, alias)) {
        normalizedValue[field] = normalizedValue[alias];
      }
    }
  }
  const checklist = validateBooleanChecklist(normalizedValue, fields, "Pre-production");
  return { ...checklist, passed: Object.values(checklist).filter((entry) => typeof entry === "boolean").every(Boolean) };
};

export const validatePostProductionChecklist = (value, requestedLines) => {
  const checklist = validateBooleanChecklist(
    value,
    ["stitchingPassed", "qualityPassed", "colorPassed", "sizeCountVerified"],
    "Post-production",
  );
  if (!Array.isArray(value.actualCounts) || value.actualCounts.length !== requestedLines.length) {
    throw fail("Post-production actual counts must include every requested size/color variant exactly once.");
  }
  const requested = new Map(requestedLines.map((line) => [
    JSON.stringify([line.size.trim().toLowerCase(), line.color.trim().toLowerCase()]),
    line,
  ]));
  const actualCounts = [];
  const seen = new Set();
  for (const actual of value.actualCounts) {
    const size = String(actual?.size || "").trim();
    const color = String(actual?.color || "").trim();
    const key = JSON.stringify([size.toLowerCase(), color.toLowerCase()]);
    const requestedLine = requested.get(key);
    const quantity = Number(actual?.quantity);
    const damagedQuantity = Number(actual?.damagedQuantity ?? 0);
    if (!requestedLine || seen.has(key)) throw fail("Actual counts contain an unknown or duplicate size/color variant.");
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > requestedLine.quantity ||
      !Number.isSafeInteger(damagedQuantity) ||
      damagedQuantity < 0 ||
      damagedQuantity > quantity
    ) {
      throw fail(`Actual and damaged quantities for ${size} / ${color} must be whole numbers within the requested quantity.`);
    }
    seen.add(key);
    actualCounts.push({ size: requestedLine.size, color: requestedLine.color, quantity, damagedQuantity });
  }
  const passed = Object.values(checklist).filter((entry) => typeof entry === "boolean").every(Boolean);
  return { ...checklist, actualCounts, passed };
};
