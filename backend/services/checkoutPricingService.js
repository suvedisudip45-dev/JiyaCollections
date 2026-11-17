import { Prisma } from "@prisma/client";
import {
  accountingDecimal,
  addDecimals,
  allocateDecimal,
  assertFitsDatabaseDecimal,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  parseNprAmountString,
  quantizeCurrencyAmount,
  quantizeDecimal,
  serializeAccountingDecimal,
  subtractDecimals,
} from "./accountingDecimal.js";

export const ORDER_PRICING_SNAPSHOT_VERSION = 2;
export const ORDER_PRICING_SNAPSHOT_V3_VERSION = 3;
export const ORDER_PRICING_RULE_VERSION = "NPR-CHECKOUT-2";
export const ORDER_PRICING_V3_RULE_VERSION = "NPR-CHECKOUT-3";
export const COMMERCIAL_ORDER_ROUNDING_RULE = "NEAREST_NPR_5_V1";

const HALF_EVEN = Prisma.Decimal.ROUND_HALF_EVEN;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export const decimalFromStoredFloat = (value, fieldName = "Stored monetary value") => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw Object.assign(new TypeError(`${fieldName} must be finite.`), { code: "INVALID_DECIMAL_INPUT" });
  }
  if (value === null || value === undefined || value === "") return accountingDecimal("0", fieldName);
  return accountingDecimal(typeof value === "number" ? String(value) : value, fieldName);
};

export const requirePricingDecimal = (value, fieldName = "Amount", options = {}) =>
  parseNprAmountString(value, fieldName, options);

export const decimalQuantity = (value, fieldName = "Quantity") => {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value;
  const quantity = accountingDecimal(text, fieldName);
  if (
    !quantity.greaterThan(0) ||
    !quantity.lessThanOrEqualTo("2147483647") ||
    quantity.decimalPlaces() > 6
  ) {
    throw Object.assign(new TypeError(`${fieldName} must be positive, no greater than the supported range, and have at most six fractional digits.`), {
      code: "INVALID_ORDER_QUANTITY",
    });
  }
  return quantity;
};

export const wholeOrderQuantity = (value, fieldName = "Quantity") => {
  const quantity = decimalQuantity(value, fieldName);
  if (!quantity.isInteger()) {
    throw Object.assign(new TypeError(`${fieldName} must be a positive whole number for apparel inventory.`), {
      code: "INVALID_ORDER_QUANTITY",
    });
  }
  return quantity;
};

export const calculatePricedLine = ({ unitPrice, quantity, fieldName = "Unit price" }) => {
  const price = accountingDecimal(unitPrice, fieldName);
  if (price.isNegative()) {
    throw Object.assign(new TypeError(`${fieldName} cannot be negative.`), { code: "INVALID_ORDER_PRICE" });
  }
  const units = decimalQuantity(quantity);
  return {
    unitPrice: price,
    quantity: units,
    lineTotal: multiplyDecimals(price, units.toString()),
  };
};

export const applyPercentagePriceDiscount = (unitPrice, percentage, fieldName = "Discount percentage") => {
  const price = accountingDecimal(unitPrice, "Unit price");
  const rate = accountingDecimal(percentage, fieldName);
  if (price.isNegative() || rate.isNegative() || rate.greaterThan(100)) {
    throw Object.assign(new TypeError(`${fieldName} must be from 0 to 100 and price cannot be negative.`), {
      code: "INVALID_ORDER_DISCOUNT",
    });
  }
  const undiscountedShare = subtractDecimals("100", rate);
  return quantizeDecimal(
    divideDecimals(
      multiplyDecimals(price, undiscountedShare.toString()),
      "100",
      { significantDigits: 40, roundingMode: HALF_EVEN },
    ),
    0,
    HALF_UP,
  );
};

export const roundCommercialOrderTotal = (value) => {
  const amount = accountingDecimal(value, "Pre-adjustment order total");
  if (amount.isNegative()) {
    throw Object.assign(new TypeError("Order total cannot be negative."), { code: "INVALID_ORDER_AMOUNT" });
  }
  const wholeRupees = quantizeDecimal(amount, 0, HALF_UP);
  const base = wholeRupees.dividedToIntegerBy(10).times(10);
  const finalDigit = wholeRupees.minus(base);
  if (finalDigit.lessThanOrEqualTo(3)) return base;
  if (finalDigit.lessThanOrEqualTo(7)) return base.plus(5);
  return base.plus(10);
};

export const allocatePricingAmount = (total, weights, residualTargetIndex = weights.length - 1) => {
  const normalizedWeights = weights.map((weight) => accountingDecimal(weight, "Allocation weight"));
  const allocationWeights = normalizedWeights.every((weight) => weight.isZero())
    ? normalizedWeights.map(() => "1")
    : normalizedWeights;
  return allocateDecimal(quantizeCurrencyAmount(total, "NPR"), allocationWeights, {
    scale: 2,
    roundingMode: HALF_EVEN,
    residualTargetIndex,
    divisionSignificantDigits: 40,
  }).allocations;
};

export const toLegacyFloatMirror = (value, fieldName = "Legacy Float mirror") => {
  const number = Number(serializeAccountingDecimal(value));
  if (!Number.isFinite(number)) {
    throw Object.assign(new RangeError(`${fieldName} exceeds the legacy Float storage range.`), {
      code: "DECIMAL_OUT_OF_RANGE",
    });
  }
  return number;
};

const snapshotLine = (line) => ({
  productId: String(line.productId || line._id || ""),
  variant: {
    size: String(line.size || ""),
    color: String(line.color || ""),
  },
  unitPrice: serializeAccountingDecimal(line.unitPrice),
  quantity: serializeAccountingDecimal(line.quantity),
  lineTotal: serializeAccountingDecimal(line.lineTotal),
  ...(line.discountPercentage !== undefined
    ? { discountPercentage: serializeAccountingDecimal(line.discountPercentage) }
    : {}),
  ...(line.discountAmount !== undefined
    ? { discountAmount: serializeAccountingDecimal(line.discountAmount) }
    : {}),
});

export const createOrderPricingSnapshot = ({
  lines,
  subtotal,
  discountTotal = "0",
  deliveryFee = "0",
  otherAdjustments = "0",
  preCommercialRoundingTotal,
  finalPayableTotal,
  commercialRoundingRule = null,
  allocationRule = null,
  group = null,
  source = "CHECKOUT",
  calculatedAt = new Date(),
}) => {
  const normalizedLines = lines.map(snapshotLine);
  const exactSubtotal = accountingDecimal(subtotal, "Order subtotal");
  const exactDiscount = accountingDecimal(discountTotal, "Order discount");
  const exactDeliveryFee = accountingDecimal(deliveryFee, "Delivery fee");
  const exactAdjustments = accountingDecimal(otherAdjustments, "Order adjustments");
  const exactPreRound = accountingDecimal(preCommercialRoundingTotal, "Pre-rounding order total");
  const exactFinal = accountingDecimal(finalPayableTotal, "Final order total");
  if (
    exactSubtotal.isNegative() || exactDiscount.isNegative() || exactDeliveryFee.isNegative() ||
    exactFinal.isNegative()
  ) {
    throw Object.assign(new TypeError("Order pricing snapshot contains a negative total."), {
      code: "INVALID_ORDER_AMOUNT",
    });
  }
  assertFitsDatabaseDecimal(exactFinal, { precision: 20, scale: 2 });
  assertFitsDatabaseDecimal(exactDeliveryFee, { precision: 20, scale: 2 });
  const expectedPreRound = subtractDecimals(
    addDecimals(exactSubtotal, exactDeliveryFee, exactAdjustments),
    exactDiscount,
  );
  if (!expectedPreRound.equals(exactPreRound)) {
    throw Object.assign(new Error("Order pricing snapshot components do not reconcile to the pre-rounding total."), {
      code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
    });
  }
  return {
    version: ORDER_PRICING_SNAPSHOT_VERSION,
    pricingRuleVersion: ORDER_PRICING_RULE_VERSION,
    currency: "NPR",
    source,
    calculatedAt: new Date(calculatedAt).toISOString(),
    lines: normalizedLines,
    totals: {
      subtotal: serializeAccountingDecimal(exactSubtotal),
      discountTotal: serializeAccountingDecimal(exactDiscount),
      deliveryFee: serializeAccountingDecimal(exactDeliveryFee),
      otherAdjustments: serializeAccountingDecimal(exactAdjustments),
      preCommercialRoundingTotal: serializeAccountingDecimal(exactPreRound),
      finalPayableTotal: serializeAccountingDecimal(exactFinal),
    },
    commercialRoundingRule,
    ...(allocationRule ? { allocationRule } : {}),
    ...(group ? { group } : {}),
  };
};

const normalizePricingSource = (value) => {
  const source = String(value || "").trim().toUpperCase();
  return source || null;
};

const snapshotLineV3 = (line) => {
  const unitPrice = accountingDecimal(line.unitPrice, "Accepted unit price");
  const quantity = accountingDecimal(line.quantity, "Accepted quantity");
  const acceptedLineTotal = accountingDecimal(line.lineTotal, "Accepted line total");
  if (unitPrice.isNegative() || !quantity.greaterThan(0) || acceptedLineTotal.isNegative()) {
    throw Object.assign(new TypeError("Pricing snapshot line contains an invalid price, quantity, or total."), {
      code: "INVALID_ORDER_PRICING_LINE",
    });
  }
  const calculatedLineTotal = multiplyDecimals(unitPrice, quantity);
  if (!calculatedLineTotal.equals(acceptedLineTotal)) {
    throw Object.assign(new Error("Accepted unit price and quantity do not reconcile to the accepted line total."), {
      code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
    });
  }

  const catalogUnitPrice = line.catalogUnitPrice === null || line.catalogUnitPrice === undefined
    ? null
    : accountingDecimal(line.catalogUnitPrice, "Original catalog unit price");
  if (catalogUnitPrice?.isNegative()) {
    throw Object.assign(new TypeError("Original catalog unit price cannot be negative."), {
      code: "INVALID_ORDER_PRICE",
    });
  }

  let lineGross = null;
  let lineDiscountTotal = accountingDecimal("0");
  let discountComponents = [];
  let lineAdjustments = [];
  let normalizedPriceSteps = null;
  let provenanceStatus = "PARTIAL";
  const source = normalizePricingSource(line.discountSource);
  const knownDiscountSources = new Set(["PRODUCT", "LOCATION", "BUNDLE", "PROMOTION", "DIRECT_ORDER_PRICE"]);
  const knownPriceStepSources = new Set([...knownDiscountSources, "BASE"]);

  if (catalogUnitPrice !== null) {
    lineGross = multiplyDecimals(catalogUnitPrice, quantity);
    const difference = subtractDecimals(lineGross, acceptedLineTotal);
    if (Array.isArray(line.priceSteps)) {
      let expectedBefore = catalogUnitPrice;
      normalizedPriceSteps = [];
      for (const step of line.priceSteps) {
        const source = normalizePricingSource(step.source);
        const before = accountingDecimal(step.unitPriceBefore, "Price-step starting unit price");
        const after = accountingDecimal(step.unitPriceAfter, "Price-step accepted unit price");
        if (before.isNegative() || after.isNegative() || !before.equals(expectedBefore)) {
          throw Object.assign(new Error("Pricing steps must form a continuous non-negative accepted-price path."), {
            code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
          });
        }
        const rate = step.rate === null || step.rate === undefined
          ? null
          : accountingDecimal(step.rate, "Pricing-step percentage");
        if (rate && (rate.isNegative() || rate.greaterThan(100))) {
          throw Object.assign(new TypeError("Pricing-step percentage must be from 0 to 100."), {
            code: "INVALID_ORDER_DISCOUNT",
          });
        }
        normalizedPriceSteps.push({
          source: knownPriceStepSources.has(source) ? source : "UNCLASSIFIED",
          ...(step.sourceId ? { sourceId: String(step.sourceId) } : {}),
          unitPriceBefore: serializeAccountingDecimal(before),
          unitPriceAfter: serializeAccountingDecimal(after),
          ...(rate ? { rate: { value: serializeAccountingDecimal(rate), unit: "PERCENT" } } : {}),
        });
        const stepDifference = multiplyDecimals(subtractDecimals(before, after), quantity);
        if (stepDifference.greaterThan(0)) {
          discountComponents.push({
            source: knownDiscountSources.has(source) ? source : "UNCLASSIFIED",
            ...(step.sourceId ? { sourceId: String(step.sourceId) } : {}),
            ...(rate ? { rate: { value: serializeAccountingDecimal(rate), unit: "PERCENT" } } : {}),
            amount: serializeAccountingDecimal(stepDifference),
            calculationBasis: "UNIT_PRICE_STEP_X_QUANTITY",
            appliedOrder: discountComponents.length + 1,
            ...(!knownPriceStepSources.has(source) ? { provenanceStatus: "PARTIAL" } : {}),
          });
          lineDiscountTotal = addDecimals(lineDiscountTotal, stepDifference);
        } else if (stepDifference.isNegative()) {
          lineAdjustments.push({
            source: knownDiscountSources.has(source) ? source : "UNCLASSIFIED",
            kind: "UNIT_PRICE_INCREASE",
            amount: serializeAccountingDecimal(stepDifference.abs()),
          });
          if (!knownPriceStepSources.has(source)) provenanceStatus = "PARTIAL";
        }
        expectedBefore = after;
      }
      if (!expectedBefore.equals(unitPrice)) {
        throw Object.assign(new Error("Pricing steps do not end at the accepted unit price."), {
          code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
        });
      }
      const stepAdjustmentTotal = addDecimals(...lineAdjustments.map((adjustment) => adjustment.amount));
      if (!subtractDecimals(addDecimals(lineGross, stepAdjustmentTotal), lineDiscountTotal).equals(acceptedLineTotal)) {
        throw Object.assign(new Error("Price steps do not reconcile to the accepted line total."), {
          code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
        });
      }
      provenanceStatus = discountComponents.some((component) =>
        component.source === "UNCLASSIFIED" || component.provenanceStatus === "PARTIAL") ||
        normalizedPriceSteps.some((step) => step.source === "UNCLASSIFIED") ||
        line.provenanceStatus === "PARTIAL"
        ? "PARTIAL"
        : "COMPLETE";
    } else if (Array.isArray(line.discountComponents)) {
      discountComponents = line.discountComponents.map((component) => ({
        source: normalizePricingSource(component.source) || "UNCLASSIFIED",
        ...(component.sourceId ? { sourceId: String(component.sourceId) } : {}),
        ...(component.rate ? {
          rate: {
            value: serializeAccountingDecimal(component.rate.value),
            unit: "PERCENT",
          },
        } : {}),
        amount: serializeAccountingDecimal(component.amount),
        calculationBasis: String(component.calculationBasis || "CAPTURED_SOURCE_AMOUNT"),
        appliedOrder: discountComponents.length + 1,
        ...(component.provenanceStatus === "PARTIAL" ? { provenanceStatus: "PARTIAL" } : {}),
      }));
      lineDiscountTotal = addDecimals(...discountComponents.map((component) => component.amount));
      lineAdjustments = (line.lineAdjustments || []).map((adjustment) => ({
        source: normalizePricingSource(adjustment.source) || "UNCLASSIFIED",
        kind: normalizePricingSource(adjustment.kind) || "ADJUSTMENT",
        amount: serializeAccountingDecimal(adjustment.amount),
      }));
      const adjustmentsTotal = addDecimals(...lineAdjustments.map((adjustment) => adjustment.amount));
      if (!subtractDecimals(addDecimals(lineGross, adjustmentsTotal), lineDiscountTotal).equals(acceptedLineTotal)) {
        throw Object.assign(new Error("Discount provenance components do not reconcile to the accepted line total."), {
          code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
        });
      }
      provenanceStatus = discountComponents.some((component) =>
        component.source === "UNCLASSIFIED" || component.provenanceStatus === "PARTIAL") ||
        line.provenanceStatus === "PARTIAL"
        ? "PARTIAL"
        : "COMPLETE";
    } else if (difference.greaterThan(0) && knownDiscountSources.has(source)) {
      const rate = line.discountPercentage === null || line.discountPercentage === undefined
        ? null
        : {
            value: serializeAccountingDecimal(line.discountPercentage),
            unit: "PERCENT",
          };
      discountComponents = [{
        source,
        ...(line.discountSourceId ? { sourceId: String(line.discountSourceId) } : {}),
        ...(rate ? { rate } : {}),
        amount: serializeAccountingDecimal(difference),
        calculationBasis: "ACCEPTED_LINE_PRICE_DIFFERENCE",
      }];
      lineDiscountTotal = difference;
      provenanceStatus = "COMPLETE";
    } else if (difference.isNegative()) {
      lineAdjustments = [{
        source: source && source !== "BASE" ? source : "UNCLASSIFIED_PRICE_OVERRIDE",
        kind: "UNIT_PRICE_INCREASE",
        amount: serializeAccountingDecimal(difference.abs()),
      }];
      provenanceStatus = knownDiscountSources.has(source) ? "COMPLETE" : "PARTIAL";
    } else if (difference.isZero()) {
      provenanceStatus = source ? "COMPLETE" : "PARTIAL";
    } else {
      lineAdjustments = [{
        source: "UNCLASSIFIED_PRICE_DIFFERENCE",
        kind: "UNCLASSIFIED",
        amount: serializeAccountingDecimal(difference.negated()),
      }];
    }
  }

  const serializedRate = line.discountPercentage === null || line.discountPercentage === undefined
    ? undefined
    : serializeAccountingDecimal(line.discountPercentage);
  if (lineGross !== null && compareDecimals(lineDiscountTotal, lineGross) > 0) {
    throw Object.assign(new TypeError("Line discounts cannot exceed the original line gross."), {
      code: "INVALID_ORDER_DISCOUNT",
    });
  }
  return {
    productId: String(line.productId || line._id || ""),
    variant: {
      size: String(line.size || ""),
      color: String(line.color || ""),
    },
    catalogUnitPrice: catalogUnitPrice === null ? null : serializeAccountingDecimal(catalogUnitPrice),
    catalogPriceSource: String(line.catalogPriceSource || "ORDER_ACCEPTANCE_SOURCE"),
    acceptedUnitPrice: serializeAccountingDecimal(unitPrice),
    quantity: serializeAccountingDecimal(quantity),
    quantityMeasure: {
      value: serializeAccountingDecimal(quantity),
      unit: String(line.quantityUnit || "EACH"),
    },
    lineGross: lineGross === null ? null : serializeAccountingDecimal(lineGross),
    discountComponents,
    lineDiscountTotal: serializeAccountingDecimal(lineDiscountTotal),
    lineAdjustments,
    acceptedLineTotal: serializeAccountingDecimal(acceptedLineTotal),
    provenanceStatus: line.provenanceStatus === "PARTIAL" ? "PARTIAL" : provenanceStatus,
    ...(source ? { pricingSource: source } : {}),
    ...(line.discountSourceId ? { pricingSourceId: String(line.discountSourceId) } : {}),
    ...(normalizedPriceSteps ? { pricingSteps: normalizedPriceSteps } : {}),
    ...(serializedRate !== undefined ? {
      discountRate: { value: serializedRate, unit: "PERCENT" },
      discountPercentage: serializedRate,
    } : {}),
    // Keep v2 line keys for clients that already read the additive snapshot field.
    unitPrice: serializeAccountingDecimal(unitPrice),
    lineTotal: serializeAccountingDecimal(acceptedLineTotal),
  };
};

export const createOrderPricingSnapshotV3 = ({
  lines,
  subtotal,
  discountTotal = "0",
  deliveryFee = "0",
  otherAdjustments = "0",
  preCommercialRoundingTotal,
  finalPayableTotal,
  commercialRoundingRule = null,
  allocationRule = null,
  group = null,
  source = "CHECKOUT",
  orderDiscountComponents = [],
  calculatedAt = new Date(),
}) => {
  const legacySnapshot = createOrderPricingSnapshot({
    lines,
    subtotal,
    discountTotal,
    deliveryFee,
    otherAdjustments,
    preCommercialRoundingTotal,
    finalPayableTotal,
    commercialRoundingRule,
    allocationRule,
    group,
    source,
    calculatedAt,
  });
  const normalizedLines = lines.map(snapshotLineV3);
  const exactSubtotal = accountingDecimal(subtotal, "Accepted merchandise total");
  const exactDiscount = accountingDecimal(discountTotal, "Order-level discounts");
  const exactDeliveryFee = accountingDecimal(deliveryFee, "Delivery fee");
  const exactAdjustments = accountingDecimal(otherAdjustments, "Other order adjustments");
  const exactPreRound = accountingDecimal(preCommercialRoundingTotal, "Pre-rounding order total");
  const exactFinal = accountingDecimal(finalPayableTotal, "Final order total");
  const lineTotal = addDecimals(...normalizedLines.map((line) => line.acceptedLineTotal));
  if (normalizedLines.length && !lineTotal.equals(exactSubtotal)) {
    throw Object.assign(new Error("Accepted line totals do not reconcile to the order merchandise total."), {
      code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
    });
  }

  const suppliedDiscounts = orderDiscountComponents.map((component, index) => ({
    source: normalizePricingSource(component.source) || "UNCLASSIFIED_ORDER_DISCOUNT",
    kind: "DISCOUNT",
    amount: serializeAccountingDecimal(component.amount),
    appliedOrder: index + 1,
    ...(component.sourceId ? { sourceId: String(component.sourceId) } : {}),
    ...(component.provenanceStatus === "PARTIAL" ? { provenanceStatus: "PARTIAL" } : {}),
  }));
  if (suppliedDiscounts.some((component) => accountingDecimal(component.amount).isNegative()) ||
    compareDecimals(exactDiscount, exactSubtotal) > 0) {
    throw Object.assign(new TypeError("Order discount components must be non-negative and cannot exceed merchandise total."), {
      code: "INVALID_ORDER_DISCOUNT",
    });
  }
  const classifiedDiscountTotal = addDecimals(...suppliedDiscounts.map((component) => component.amount));
  if (compareDecimals(classifiedDiscountTotal, exactDiscount) > 0) {
    throw Object.assign(new Error("Order discount components exceed the accepted order discount."), {
      code: "ORDER_PRICING_SNAPSHOT_MISMATCH",
    });
  }
  const unclassifiedDiscountRemainder = subtractDecimals(exactDiscount, classifiedDiscountTotal);
  const orderProvenanceComplete = unclassifiedDiscountRemainder.isZero() &&
    suppliedDiscounts.every((component) => component.source !== "UNCLASSIFIED_ORDER_DISCOUNT" &&
      component.provenanceStatus !== "PARTIAL");
  const orderDiscounts = [
    ...suppliedDiscounts,
    ...(!unclassifiedDiscountRemainder.isZero() ? [{
        source: "UNCLASSIFIED_ORDER_DISCOUNT",
        kind: "DISCOUNT",
        amount: serializeAccountingDecimal(unclassifiedDiscountRemainder),
        provenanceStatus: "PARTIAL",
      }] : []),
  ];
  const orderAdjustmentComponents = [
    ...(exactDeliveryFee.isZero() ? [] : [{
      source: "SHIPPING",
      kind: "CUSTOMER_CHARGE",
      amount: serializeAccountingDecimal(exactDeliveryFee),
    }]),
    ...orderDiscounts,
    ...(exactAdjustments.isZero() ? [] : [{
      source: "UNCLASSIFIED_ADJUSTMENT",
      kind: "ADJUSTMENT",
      amount: serializeAccountingDecimal(exactAdjustments),
      provenanceStatus: "PARTIAL",
    }]),
  ];
  const lineGrossValues = normalizedLines.map((line) => line.lineGross);
  const hasCompleteLineGross = lineGrossValues.every((value) => value !== null);
  const lineGrossTotal = hasCompleteLineGross
    ? serializeAccountingDecimal(addDecimals(...lineGrossValues))
    : null;
  const lineDiscountTotal = serializeAccountingDecimal(
    addDecimals(...normalizedLines.map((line) => line.lineDiscountTotal)),
  );
  const commercialRoundingAdjustment = subtractDecimals(exactFinal, exactPreRound);
  const provenanceStatus = normalizedLines.every((line) => line.provenanceStatus === "COMPLETE") &&
    orderProvenanceComplete &&
    exactAdjustments.isZero()
    ? "COMPLETE"
    : "PARTIAL";

  return {
    ...legacySnapshot,
    version: ORDER_PRICING_SNAPSHOT_V3_VERSION,
    pricingRuleVersion: ORDER_PRICING_V3_RULE_VERSION,
    acceptedAt: legacySnapshot.calculatedAt,
    provenanceStatus,
    lines: normalizedLines,
    adjustments: orderAdjustmentComponents,
    totals: {
      ...legacySnapshot.totals,
      lineGrossTotal,
      lineDiscountTotal,
      orderDiscountTotal: serializeAccountingDecimal(exactDiscount),
      commercialRoundingAdjustment: serializeAccountingDecimal(commercialRoundingAdjustment),
    },
    commercialRounding: {
      rule: commercialRoundingRule || "NONE",
      stage: "FINAL_PAYABLE",
    },
  };
};

const parseJsonObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readOrderPricingSnapshot = (value) => {
  const wrapper = parseJsonObject(value);
  const snapshot = wrapper?.pricingSnapshot || wrapper;
  if (
    ![ORDER_PRICING_SNAPSHOT_VERSION, ORDER_PRICING_SNAPSHOT_V3_VERSION].includes(snapshot?.version) ||
    snapshot.currency !== "NPR" ||
    typeof snapshot.totals?.finalPayableTotal !== "string" ||
    typeof snapshot.totals?.deliveryFee !== "string" ||
    !Array.isArray(snapshot.lines)
  ) return null;
  try {
    accountingDecimal(snapshot.totals.finalPayableTotal, "Snapshot final payable total");
    accountingDecimal(snapshot.totals.deliveryFee, "Snapshot delivery fee");
    if (snapshot.version === ORDER_PRICING_SNAPSHOT_V3_VERSION) {
      if (!["COMPLETE", "PARTIAL"].includes(snapshot.provenanceStatus) ||
        snapshot.pricingRuleVersion !== ORDER_PRICING_V3_RULE_VERSION ||
        typeof snapshot.acceptedAt !== "string" ||
        Number.isNaN(Date.parse(snapshot.acceptedAt)) ||
        typeof snapshot.totals.lineDiscountTotal !== "string" ||
        !(snapshot.totals.lineGrossTotal === null || typeof snapshot.totals.lineGrossTotal === "string") ||
        !Array.isArray(snapshot.adjustments)) {
        return null;
      }
      const subtotal = accountingDecimal(snapshot.totals.subtotal, "Snapshot merchandise total");
      const discounts = accountingDecimal(snapshot.totals.orderDiscountTotal, "Snapshot order discounts");
      const deliveryFee = accountingDecimal(snapshot.totals.deliveryFee, "Snapshot delivery fee");
      const otherAdjustments = accountingDecimal(snapshot.totals.otherAdjustments, "Snapshot other adjustments");
      const preCommercialRoundingTotal = accountingDecimal(
        snapshot.totals.preCommercialRoundingTotal,
        "Snapshot pre-rounding total",
      );
      const finalPayableTotal = accountingDecimal(snapshot.totals.finalPayableTotal, "Snapshot final total");
      const commercialRoundingAdjustment = accountingDecimal(
        snapshot.totals.commercialRoundingAdjustment,
        "Snapshot commercial rounding adjustment",
      );
      const lineDiscountTotal = accountingDecimal(snapshot.totals.lineDiscountTotal, "Snapshot line discounts");
      const acceptedLinesTotal = addDecimals(...snapshot.lines.map((line) => line.acceptedLineTotal));
      if (subtotal.isNegative() || discounts.isNegative() || deliveryFee.isNegative() ||
        finalPayableTotal.isNegative() ||
        !subtractDecimals(addDecimals(subtotal, deliveryFee, otherAdjustments), discounts).equals(preCommercialRoundingTotal) ||
        !addDecimals(preCommercialRoundingTotal, commercialRoundingAdjustment).equals(finalPayableTotal) ||
        !acceptedLinesTotal.equals(subtotal) ||
        !addDecimals(...snapshot.lines.map((line) => line.lineDiscountTotal)).equals(lineDiscountTotal)) {
        return null;
      }
      if (snapshot.totals.lineGrossTotal !== null &&
        !addDecimals(...snapshot.lines.map((line) => line.lineGross)).equals(snapshot.totals.lineGrossTotal)) {
        return null;
      }
      for (const line of snapshot.lines) {
        if (!["COMPLETE", "PARTIAL"].includes(line.provenanceStatus) ||
          !Array.isArray(line.discountComponents) ||
          !Array.isArray(line.lineAdjustments) ||
          !(line.catalogUnitPrice === null || typeof line.catalogUnitPrice === "string")) {
          return null;
        }
        const acceptedLineTotal = accountingDecimal(line.acceptedLineTotal, "Snapshot accepted line total");
        const acceptedUnitPrice = accountingDecimal(line.acceptedUnitPrice, "Snapshot accepted unit price");
        const quantity = accountingDecimal(line.quantityMeasure?.value, "Snapshot quantity");
        if (acceptedUnitPrice.isNegative() || !quantity.greaterThan(0) ||
          !multiplyDecimals(acceptedUnitPrice, quantity).equals(acceptedLineTotal)) return null;
        const lineDiscountTotal = accountingDecimal(line.lineDiscountTotal, "Snapshot line discount total");
        const lineAdjustmentTotal = addDecimals(...(line.lineAdjustments || []).map((adjustment) => adjustment.amount));
        if (line.lineGross !== null) {
          const lineGross = accountingDecimal(line.lineGross, "Snapshot line gross");
          if (lineGross.isNegative() || lineDiscountTotal.isNegative() ||
            compareDecimals(lineDiscountTotal, lineGross) > 0 ||
            !subtractDecimals(addDecimals(lineGross, lineAdjustmentTotal), lineDiscountTotal).equals(acceptedLineTotal)) {
            return null;
          }
        }
        const componentsTotal = addDecimals(...(line.discountComponents || []).map((component) => component.amount));
        if (!componentsTotal.equals(lineDiscountTotal)) return null;
        for (const component of line.discountComponents) {
          const amount = accountingDecimal(component.amount, "Snapshot discount component");
          if (amount.isNegative()) return null;
          if (component.rate) {
            const rate = accountingDecimal(component.rate.value, "Snapshot discount rate");
            if (component.rate.unit !== "PERCENT" || rate.isNegative() || rate.greaterThan(100)) return null;
          }
        }
        if (line.pricingSteps?.length) {
          if (line.catalogUnitPrice === null) return null;
          let previousPrice = accountingDecimal(line.catalogUnitPrice, "Snapshot catalog unit price");
          for (const step of line.pricingSteps) {
            const before = accountingDecimal(step.unitPriceBefore, "Snapshot price-step input");
            const after = accountingDecimal(step.unitPriceAfter, "Snapshot price-step output");
            if (!before.equals(previousPrice) || before.isNegative() || after.isNegative()) return null;
            if (step.rate) {
              const rate = accountingDecimal(step.rate.value, "Snapshot price-step rate");
              if (step.rate.unit !== "PERCENT" || rate.isNegative() || rate.greaterThan(100)) return null;
            }
            previousPrice = after;
          }
          if (!previousPrice.equals(acceptedUnitPrice)) return null;
        }
      }
      const orderDiscountComponents = snapshot.adjustments
        .filter((adjustment) => adjustment.kind === "DISCOUNT");
      if (orderDiscountComponents.some((adjustment) => accountingDecimal(adjustment.amount).isNegative())) return null;
      if (!addDecimals(...orderDiscountComponents.map((adjustment) => adjustment.amount)).equals(discounts)) return null;
      const hasPartialProvenance = snapshot.lines.some((line) => line.provenanceStatus === "PARTIAL" ||
        line.discountComponents.some((component) => component.source === "UNCLASSIFIED" ||
          component.provenanceStatus === "PARTIAL") ||
        line.pricingSteps?.some((step) => step.source === "UNCLASSIFIED")) ||
        snapshot.adjustments.some((adjustment) => adjustment.provenanceStatus === "PARTIAL" ||
          adjustment.source.startsWith("UNCLASSIFIED"));
      if (snapshot.provenanceStatus === "COMPLETE" && hasPartialProvenance) return null;
    }
    return snapshot;
  } catch {
    return null;
  }
};

export const withOrderPricingSnapshot = (existing, pricingSnapshot) => ({
  ...(parseJsonObject(existing) || {}),
  pricingSnapshot,
});

export const exactPricingApiFields = (order) => {
  const snapshot = readOrderPricingSnapshot(order?.locationPricingSnapshot);
  return snapshot
    ? {
        amountDecimal: snapshot.totals.finalPayableTotal,
        deliveryFeeDecimal: snapshot.totals.deliveryFee,
        pricingSnapshotVersion: snapshot.version,
        pricingSnapshot: snapshot,
        legacyNumericFieldsCompatibilityOnly: true,
      }
    : {
        amountDecimal: serializeAccountingDecimal(decimalFromStoredFloat(order?.amount, "Legacy order amount")),
        deliveryFeeDecimal: serializeAccountingDecimal(decimalFromStoredFloat(order?.deliveryFee, "Legacy delivery fee")),
        pricingSnapshotVersion: null,
        pricingSnapshot: null,
        legacyNumericFieldsCompatibilityOnly: true,
      };
};

export const pricingSnapshotAmounts = (order) => {
  const snapshot = readOrderPricingSnapshot(order?.locationPricingSnapshot);
  if (snapshot) return snapshot.totals;
  return {
    finalPayableTotal: serializeAccountingDecimal(decimalFromStoredFloat(order?.amount, "Legacy order amount")),
    deliveryFee: serializeAccountingDecimal(decimalFromStoredFloat(order?.deliveryFee, "Legacy delivery fee")),
  };
};

export const hasNoOverDiscount = (discount, subtotal, fieldName = "Discount") => {
  const amount = accountingDecimal(discount, fieldName);
  const base = accountingDecimal(subtotal, "Order subtotal");
  if (amount.isNegative() || compareDecimals(amount, base) > 0) {
    throw Object.assign(new TypeError(`${fieldName} must be between zero and the order subtotal.`), {
      code: "INVALID_ORDER_DISCOUNT",
    });
  }
  return amount;
};
