import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { allocatePaymentToDocuments, createAccountingDocument } from "./accountingSubledgerService.js";
import { resolveSellerTaxTreatment } from "./sellerTaxProfileService.js";
import { resolveVatRatePercent } from "./vatRateService.js";
import { consumeDistributorOrderInventory } from "./distributorOrderInventoryService.js";
import { createOrderIdentity } from "../utils/orderReference.js";
import { applyInventoryMovement, ensureInventoryLocation } from "./inventoryLedgerService.js";

const fail = (message, code = "INVALID_WHOLESALE_REQUEST", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const clean = (value, maxLength = 191) => {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw fail(`Value cannot exceed ${maxLength} characters.`);
  return text;
};
const money = (value, label = "Amount") => {
  let decimal;
  try {
    decimal = new Prisma.Decimal(String(value ?? "0"));
  } catch {
    throw fail(`${label} must be a valid decimal amount.`);
  }
  if (!decimal.isFinite() || decimal.isNegative()) throw fail(`${label} must be non-negative.`);
  return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};
const positiveQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw fail("Quantity must be a positive whole number.");
  }
  return quantity;
};
const normalizePanVat = (value) => {
  const text = clean(value, 32).replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(text)) {
    throw fail("PAN/VAT number must contain exactly nine digits.", "INVALID_PAN_VAT");
  }
  return text;
};
const normalizeDealerInput = (body = {}) => {
  const businessName = clean(body.businessName, 191);
  if (!businessName) throw fail("Business name is required.");
  const panVatNumber = normalizePanVat(body.panVatNumber);
  const taxIdType = String(body.taxIdType || "PAN").trim().toUpperCase();
  if (!["PAN", "VAT"].includes(taxIdType)) throw fail("taxIdType must be PAN or VAT.");
  if (taxIdType === "VAT" && panVatNumber.length !== 9) throw fail("Nepal VAT number must contain exactly nine digits.");
  const phone = clean(body.phone, 40).replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone)) throw fail("A valid phone number is required.");
  const billingAddress = clean(body.billingAddress, 4000);
  const deliveryAddress = clean(body.deliveryAddress || body.billingAddress, 4000);
  if (!billingAddress || !deliveryAddress) throw fail("Billing and delivery addresses are required.");
  const email = clean(body.email || "", 191);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail("Email address is invalid.");
  const creditLimit = money(body.creditLimit ?? 0, "Credit limit");
  const openingBalance = money(body.openingBalance ?? 0, "Opening balance");
  const dueDays = Number(body.dueDays ?? 0);
  if (!Number.isSafeInteger(dueDays) || dueDays < 0 || dueDays > 365) throw fail("Due days must be between 0 and 365.");
  return {
    businessName,
    panVatNumber,
    taxIdType,
    contactPerson: clean(body.contactPerson || "", 120) || null,
    phone,
    email: email || null,
    billingAddress,
    deliveryAddress,
    creditLimit,
    openingBalance,
    dueDays,
    priceTierId: clean(body.priceTierId || "", 191) || null,
  };
};

export const normalizeWholesaleLines = (lines) => {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw fail("A wholesale order must contain between 1 and 100 SKU lines.");
  }
  const seen = new Set();
  return lines.map((line) => {
    const inventorySkuId = clean(line?.inventorySkuId);
    if (!inventorySkuId || seen.has(inventorySkuId)) throw fail("Each wholesale line must use a unique inventory SKU.");
    seen.add(inventorySkuId);
    return { inventorySkuId, quantity: positiveQuantity(line.quantity) };
  });
};

const roundMoney = (value) => money(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const inDateRange = (record, at) =>
  record.effectiveFrom <= at &&
  (!record.effectiveUntil || record.effectiveUntil > at);

export const calculateWholesaleLinePricing = ({
  catalogPrice,
  quantity,
  contractPrice = null,
  tier = null,
  quantityDiscount = null,
}) => {
  const base = contractPrice ? money(contractPrice) : roundMoney(catalogPrice);
  let discountPercent = new Prisma.Decimal(tier?.discountPercent || 0);
  if (quantityDiscount && money(quantityDiscount.discountPercent).greaterThan(discountPercent)) {
    discountPercent = money(quantityDiscount.discountPercent);
  }
  if (discountPercent.isNegative() || discountPercent.greaterThan(100)) {
    throw fail("Wholesale discount must be between 0 and 100 percent.");
  }
  const gross = base.mul(quantity);
  const discount = gross.mul(discountPercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    unitPrice: base,
    discountAmount: discount,
    lineTotal: roundMoney(gross.minus(discount)),
  };
};

export const getDealerAvailableCredit = async ({ tx, dealer, partyId = null }) => {
  const partyWhere = partyId ? { partyId, side: "RECEIVABLE", status: { in: ["OPEN", "PARTIALLY_PAID"] } } : null;
  if (partyId && tx.accountingDocument && tx.accountingDocument.findFirst) {
    const openingBalance = money(dealer.openingBalance || 0);
    if (openingBalance.greaterThan(0)) {
      const existingOpening = await tx.accountingDocument.findFirst({
        where: {
          partyId,
          sourceType: "B2B_DEALER_OPENING_BALANCE",
          sourceId: dealer.id,
        },
      });
      if (!existingOpening) {
        await createAccountingDocument({
          documentType: "INVOICE",
          documentNumber: `WSO-${String(dealer.id).slice(-16).toUpperCase()}`,
          partyId,
          partyTaxIdType: dealer.taxIdType || "PAN",
          partyTaxIdNumber: dealer.panVatNumber,
          side: "RECEIVABLE",
          sourceType: "B2B_DEALER_OPENING_BALANCE",
          sourceId: dealer.id,
          dueDate: dealer.dueDays > 0
            ? new Date(Date.now() + dealer.dueDays * 86400000)
            : null,
          amount: openingBalance,
          idempotencyKey: `b2b-opening:${dealer.id}`,
        }, { client: tx });
      } else if (existingOpening.status === "CANCELLED" && openingBalance.greaterThan(0)) {
        await tx.accountingDocument.update({
          where: { id: existingOpening.id },
          data: { status: "OPEN", remainingAmount: openingBalance, originalAmount: openingBalance },
        });
      }
    }
  }
  const documents = partyWhere ? await tx.accountingDocument.findMany({
    where: partyWhere,
    select: { remainingAmount: true },
  }) : [];
  const outstanding = documents.reduce(
    (sum, document) => sum.plus(money(document.remainingAmount)),
    new Prisma.Decimal(0),
  );
  const creditLimit = money(dealer.creditLimit || 0);
  return {
    creditLimit,
    outstanding,
    availableCredit: roundMoney(creditLimit.minus(outstanding).greaterThan(0)
      ? creditLimit.minus(outstanding)
      : 0),
  };
};

export const createDealerAccount = async ({
  distributorId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const input = normalizeDealerInput(body);
  if (!distributorId) throw fail("Active distributor context is required.", "DISTRIBUTOR_CONTEXT_REQUIRED", 403);
  let dealerCode;
  if (body.dealerCode) {
    dealerCode = clean(body.dealerCode, 32).toUpperCase();
  } else {
    dealerCode = `DL-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  }
  const dealer = await tx.b2BDealerAccount.create({
    data: {
      distributorId,
      dealerCode,
      ...input,
      status: "ACTIVE",
      createdByAccountId: actorAccountId || null,
      updatedByAccountId: actorAccountId || null,
    },
  });
  if (input.openingBalance.greaterThan(0)) {
    const party = await ensureAccountingParty({
      partyType: "OTHER",
      sourceEntityId: dealer.id,
      displayName: dealer.businessName,
      legalName: dealer.businessName,
    }, { client: tx });
    await createAccountingDocument({
      documentType: "INVOICE",
      documentNumber: `WSO-${String(dealer.id).slice(-16).toUpperCase()}`,
      partyId: party.id,
      partyTaxIdType: dealer.taxIdType,
      partyTaxIdNumber: dealer.panVatNumber,
      side: "RECEIVABLE",
      sourceType: "B2B_DEALER_OPENING_BALANCE",
      sourceId: dealer.id,
      dueDate: dealer.dueDays > 0
        ? new Date(Date.now() + dealer.dueDays * 86400000)
        : null,
      amount: dealer.openingBalance,
      idempotencyKey: `b2b-opening:${dealer.id}`,
    }, { client: tx });
  }
  return dealer;
}, { isolationLevel: "Serializable" });

export const updateDealerAccount = async ({
  distributorId,
  dealerId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const dealer = await tx.b2BDealerAccount.findFirst({
    where: { id: dealerId, distributorId },
  });
  if (!dealer) throw fail("Dealer not found.", "DEALER_NOT_FOUND", 404);
  const input = normalizeDealerInput({ ...dealer, ...body });
  const status = String(body.status || dealer.status).trim().toUpperCase();
  if (!["ACTIVE", "SUSPENDED", "INACTIVE"].includes(status)) throw fail("Invalid dealer status.");
  const holdReason = status === "SUSPENDED"
    ? clean(body.holdReason || dealer.holdReason || "Credit hold", 4000) || null
    : null;
  const updated = await tx.b2BDealerAccount.update({
    where: { id: dealer.id },
    data: {
      ...input,
      status,
      holdReason,
      updatedByAccountId: actorAccountId || null,
    },
  });
  if (input.openingBalance.greaterThanOrEqualTo(0) &&
      !money(dealer.openingBalance).equals(input.openingBalance)) {
    const party = await ensureAccountingParty({
      partyType: "OTHER",
      sourceEntityId: dealer.id,
      displayName: dealer.businessName,
      legalName: dealer.businessName,
    }, { client: tx });
    const openingDocument = await tx.accountingDocument.findFirst({
      where: {
        partyId: party.id,
        sourceType: "B2B_DEALER_OPENING_BALANCE",
        sourceId: dealer.id,
      },
    });
    if (openingDocument && Number(openingDocument.allocatedAmount || 0) > 0) {
      throw fail("Opening balance cannot be changed after payments have been allocated.", "OPENING_BALANCE_IMMUTABLE", 409);
    }
    if (input.openingBalance.greaterThan(0)) {
      if (openingDocument) {
        await tx.accountingDocument.update({
          where: { id: openingDocument.id },
          data: {
            status: "OPEN",
            originalAmount: input.openingBalance,
            allocatedAmount: new Prisma.Decimal(0),
            remainingAmount: input.openingBalance,
          },
        });
      } else {
        await createAccountingDocument({
          documentType: "INVOICE",
          documentNumber: `WSO-${String(dealer.id).slice(-16).toUpperCase()}`,
          partyId: party.id,
          partyTaxIdType: dealer.taxIdType,
          partyTaxIdNumber: dealer.panVatNumber,
          side: "RECEIVABLE",
          sourceType: "B2B_DEALER_OPENING_BALANCE",
          sourceId: dealer.id,
          amount: input.openingBalance,
          idempotencyKey: `b2b-opening:${dealer.id}`,
        }, { client: tx });
      }
    } else if (openingDocument) {
      await tx.accountingDocument.update({
        where: { id: openingDocument.id },
        data: { status: "CANCELLED", remainingAmount: new Prisma.Decimal(0) },
      });
    }
  }
  await tx.b2BDealerCreditTransaction.create({
    data: {
      dealerId: dealer.id,
      transactionType: status === "SUSPENDED" ? "HOLD" : status === "ACTIVE" ? "RELEASE" : "ADJUSTMENT",
      amount: money(body.creditLimitChange || 0),
      balanceAfter: money(updated.creditLimit),
      idempotencyKey: `dealer:${dealer.id}:status:${crypto.randomUUID()}`,
      actorAccountId: actorAccountId || null,
      notes: holdReason,
    },
  });
  return updated;
}, { isolationLevel: "Serializable" });

export const listDealerAccounts = ({ distributorId, client, status = null, search = "" }) =>
  client.b2BDealerAccount.findMany({
    where: {
      distributorId,
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { businessName: { contains: search } },
          { dealerCode: { contains: search } },
          { panVatNumber: { contains: search } },
          { phone: { contains: search } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { priceTier: true },
  });

export const createWholesalePriceTier = async ({
  distributorId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const name = clean(body.name, 191);
  if (!name) throw fail("Price tier name is required.");
  const minimumQuantity = Number(body.minimumQuantity ?? 1);
  if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1) throw fail("Minimum quantity must be positive.");
  const discountPercent = money(body.discountPercent ?? 0, "Tier discount");
  if (discountPercent.greaterThan(100)) throw fail("Tier discount cannot exceed 100 percent.");
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  const effectiveUntil = body.effectiveUntil ? new Date(body.effectiveUntil) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && effectiveUntil <= effectiveFrom)) {
    throw fail("Effective pricing dates are invalid.");
  }
  return tx.b2BWholesalePriceTier.create({
    data: {
      distributorId,
      name,
      minimumQuantity,
      discountPercent,
      effectiveFrom,
      effectiveUntil,
      isActive: true,
      createdByAccountId: actorAccountId || null,
    },
  });
}, { isolationLevel: "Serializable" });

export const upsertDealerContractPrice = async ({
  distributorId,
  dealerId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const dealer = await tx.b2BDealerAccount.findFirst({ where: { id: dealerId, distributorId } });
  if (!dealer) throw fail("Dealer not found.", "DEALER_NOT_FOUND", 404);
  const productId = clean(body.productId || "", 191) || null;
  const inventorySkuId = clean(body.inventorySkuId || "", 191) || null;
  if (!productId && !inventorySkuId) throw fail("A product or inventory SKU is required.");
  if (inventorySkuId) {
    const sku = await tx.inventorySku.findFirst({ where: { id: inventorySkuId, isActive: true } });
    if (!sku || (productId && sku.productId !== productId)) throw fail("Invalid inventory SKU.", "SKU_NOT_FOUND", 404);
  }
  const fixedUnitPrice = money(body.fixedUnitPrice, "Contract unit price");
  if (fixedUnitPrice.lessThanOrEqualTo(0)) throw fail("Contract unit price must be greater than zero.");
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  const effectiveUntil = body.effectiveUntil ? new Date(body.effectiveUntil) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && effectiveUntil <= effectiveFrom)) {
    throw fail("Contract effective dates are invalid.");
  }
  return tx.b2BDealerContractPrice.create({
    data: {
      distributorId,
      dealerId,
      productId,
      inventorySkuId,
      fixedUnitPrice,
      effectiveFrom,
      effectiveUntil,
      createdByAccountId: actorAccountId || null,
    },
  });
}, { isolationLevel: "Serializable" });

export const createB2BQuotation = async ({
  distributorId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const dealerId = clean(body.dealerId);
  const dealer = await tx.b2BDealerAccount.findFirst({
    where: { id: dealerId, distributorId },
  });
  if (!dealer) throw fail("Dealer not found.", "DEALER_NOT_FOUND", 404);
  if (dealer.status !== "ACTIVE") throw fail("Dealer account is not active or is on credit hold.", "DEALER_NOT_ACTIVE", 409);

  const normalizedLines = normalizeWholesaleLines(body.lines);
  const skus = await tx.inventorySku.findMany({
    where: {
      id: { in: normalizedLines.map((line) => line.inventorySkuId) },
      isActive: true,
      product: { published: true, deletedAt: null },
    },
    include: { product: { select: { id: true, name: true, price: true, costPrice: true } } },
  });
  if (skus.length !== normalizedLines.length) throw fail("Every wholesale line must be an active published SKU.", "SKU_NOT_FOUND", 409);
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const now = new Date();
  const tier = dealer.priceTierId
    ? await tx.b2BWholesalePriceTier.findFirst({
        where: { id: dealer.priceTierId, distributorId, isActive: true, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      })
    : null;

  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  const lineData = [];
  const snapshotLines = [];
  for (const line of normalizedLines) {
    const sku = skuById.get(line.inventorySkuId);
    const contract = await tx.b2BDealerContractPrice.findFirst({
      where: {
        dealerId: dealer.id,
        distributorId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        AND: [{ OR: [{ inventorySkuId: sku.id }, { inventorySkuId: null, productId: sku.productId }, { inventorySkuId: null, productId: null }] }],
      },
      orderBy: [{ inventorySkuId: "desc" }, { effectiveFrom: "desc" }],
    });
    let quantityDiscount = null;
    if (tier) {
      quantityDiscount = await tx.b2BWholesaleQuantityDiscount.findFirst({
        where: {
          tierId: tier.id,
          minimumQuantity: { lte: line.quantity },
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
        orderBy: [{ minimumQuantity: "desc" }, { effectiveFrom: "desc" }],
      });
    }
    const pricing = calculateWholesaleLinePricing({
      catalogPrice: sku.product.price,
      quantity: line.quantity,
      contractPrice: contract?.fixedUnitPrice,
      tier,
      quantityDiscount,
    });
    subtotal = subtotal.plus(pricing.lineTotal.plus(pricing.discountAmount));
    discountTotal = discountTotal.plus(pricing.discountAmount);
    lineData.push({
      inventorySkuId: sku.id,
      quantity: line.quantity,
      unitPrice: pricing.unitPrice,
      discountAmount: pricing.discountAmount,
      lineTotal: pricing.lineTotal,
    });
    snapshotLines.push({
      inventorySkuId: sku.id,
      productId: sku.productId,
      productName: sku.product.name,
      size: sku.size,
      color: sku.color,
      quantity: line.quantity,
      unitPrice: pricing.unitPrice.toString(),
      discountAmount: pricing.discountAmount.toString(),
      lineTotal: pricing.lineTotal.toString(),
      priceSource: contract ? "CONTRACT" : tier ? "WHOLESALE_TIER" : "CATALOG",
    });
  }
  subtotal = roundMoney(subtotal);
  discountTotal = roundMoney(discountTotal);
  const netTaxable = roundMoney(subtotal.minus(discountTotal));
  const sellerTax = await resolveSellerTaxTreatment(now, { client: tx });
  let vatRate = new Prisma.Decimal(0);
  if (sellerTax.taxStatus === "VAT_REGISTERED") vatRate = await resolveVatRatePercent(now, { client: tx });
  const vatAmount = roundMoney(netTaxable.mul(vatRate).div(100));
  const totalAmount = roundMoney(netTaxable.plus(vatAmount));
  const suppliedKey = clean(body.idempotencyKey || "", 191);
  const idempotencyKey = suppliedKey || `quotation:${dealer.id}:${crypto.createHash("sha256").update(JSON.stringify(snapshotLines)).digest("hex")}`;
  const existing = await tx.b2BQuotation.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const quotationNumber = `BQ-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const validUntil = body.validUntil ? new Date(body.validUntil) : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return tx.b2BQuotation.create({
    data: {
      distributorId,
      dealerId: dealer.id,
      quotationNumber,
      status: "DRAFT",
      subtotalAmount: subtotal,
      discountAmount: discountTotal,
      vatAmount,
      totalAmount,
      validUntil,
      idempotencyKey,
      pricingSnapshot: {
        snapshotLines,
        taxStatus: sellerTax.taxStatus,
        taxTreatment: sellerTax.taxTreatment,
        vatRate: vatRate.toString(),
        subtotalAmount: subtotal.toString(),
        discountAmount: discountTotal.toString(),
        taxableAmount: netTaxable.toString(),
        vatAmount: vatAmount.toString(),
        totalAmount: totalAmount.toString(),
        calculatedAt: now.toISOString(),
      },
      createdByAccountId: actorAccountId || null,
      lines: { create: lineData },
    },
    include: { dealer: true, lines: { include: { inventorySku: { include: { product: true } } } } },
  });
}, { isolationLevel: "Serializable" });

export const approveB2BQuotation = async ({
  distributorId,
  quotationId,
  actorAccountId,
  client,
}) => client.$transaction(async (tx) => {
  const quotation = await tx.b2BQuotation.findFirst({
    where: { id: quotationId, distributorId },
  });
  if (!quotation) throw fail("Quotation not found.", "QUOTATION_NOT_FOUND", 404);
  if (quotation.status === "APPROVED") return quotation;
  if (!["DRAFT"].includes(quotation.status)) throw fail("Only a draft quotation can be approved.", "QUOTATION_STATE_CONFLICT", 409);
  if (quotation.validUntil && quotation.validUntil <= new Date()) throw fail("Quotation has expired.", "QUOTATION_EXPIRED", 409);
  return tx.b2BQuotation.update({
    where: { id: quotation.id },
    data: {
      status: "APPROVED",
      approvedByAccountId: actorAccountId || null,
      approvedAt: new Date(),
    },
  });
}, { isolationLevel: "Serializable" });

export const cancelB2BQuotation = async ({
  distributorId,
  quotationId,
  actorAccountId,
  client,
}) => client.$transaction(async (tx) => {
  const quotation = await tx.b2BQuotation.findFirst({ where: { id: quotationId, distributorId } });
  if (!quotation) throw fail("Quotation not found.", "QUOTATION_NOT_FOUND", 404);
  if (quotation.status === "CONVERTED") throw fail("Converted quotations cannot be cancelled.", "QUOTATION_STATE_CONFLICT", 409);
  if (quotation.status === "CANCELLED") return quotation;
  return tx.b2BQuotation.update({
    where: { id: quotation.id },
    data: { status: "CANCELLED", pricingSnapshot: { ...quotation.pricingSnapshot, cancelledBy: actorAccountId || null } },
  });
}, { isolationLevel: "Serializable" });

export const convertB2BQuotationToOrder = async ({
  distributorId,
  quotationId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const quotation = await tx.b2BQuotation.findFirst({
    where: { id: quotationId, distributorId },
    include: { dealer: true, lines: { include: { inventorySku: { include: { product: true } } } } },
  });
  if (!quotation) throw fail("Quotation not found.", "QUOTATION_NOT_FOUND", 404);
  if (quotation.status !== "APPROVED") throw fail("Only an approved quotation can be converted.", "QUOTATION_STATE_CONFLICT", 409);
  if (quotation.validUntil && quotation.validUntil <= new Date()) throw fail("Quotation has expired.", "QUOTATION_EXPIRED", 409);
  const dealer = quotation.dealer;
  if (dealer.status !== "ACTIVE") throw fail("Dealer account is suspended or inactive.", "DEALER_NOT_ACTIVE", 409);

  if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM B2BDealerAccount WHERE id = ${dealer.id} FOR UPDATE`;
  const party = await ensureAccountingParty({
    partyType: "OTHER",
    sourceEntityId: dealer.id,
    displayName: dealer.businessName,
    legalName: dealer.businessName,
  }, { client: tx });
  const credit = await getDealerAvailableCredit({ tx, dealer, partyId: party.id });
  if (credit.availableCredit.lessThan(quotation.totalAmount)) {
    throw fail(
      `Dealer credit limit would be exceeded. Available credit is NPR ${credit.availableCredit.toFixed(2)}.`,
      "CREDIT_LIMIT_EXCEEDED",
      409,
    );
  }

  const stockLocation = await tx.inventoryLocation.findFirst({
    where: { kind: "DISTRIBUTOR", distributorId, inventoryOwner: "PLATFORM", isActive: true },
  });
  if (!stockLocation) throw fail("No active distributor inventory location was found.", "DISTRIBUTOR_LOCATION_NOT_FOUND", 409);

  const items = quotation.lines.map((line) => ({
    _id: line.inventorySku.productId,
    productId: line.inventorySku.productId,
    inventorySkuId: line.inventorySkuId,
    name: line.inventorySku.product.name,
    image: line.inventorySku.product.image,
    size: line.inventorySku.size,
    color: line.inventorySku.color,
    quantity: line.quantity,
    price: Number(line.unitPrice),
    originalUnitPrice: Number(line.unitPrice),
    costPrice: Number(line.inventorySku.product.costPrice || 0),
    lineTotal: Number(line.lineTotal),
  }));
  const now = new Date();
  const paymentMethod = String(body.paymentMethod || "CREDIT").trim().toUpperCase();
  if (!["CREDIT", "CASH", "QR_PAYMENT", "CARD"].includes(paymentMethod)) throw fail("Invalid payment method.");
  const suppliedKey = clean(body.idempotencyKey || "", 191);
  const idempotencyKey = suppliedKey || `b2b:${quotation.id}:convert`;
  const existing = await tx.b2BWholesaleOrder.findUnique({
    where: { idempotencyKey },
    include: { order: true },
  });
  if (existing) {
    if (existing.quotationId !== quotation.id ||
        existing.dealerId !== dealer.id ||
        String(existing.order?.paymentMethod || "").toUpperCase() !== paymentMethod) {
      throw fail("Wholesale conversion idempotency key was reused with conflicting details.", "B2B_CONVERSION_IDEMPOTENCY_CONFLICT", 409);
    }
    return tx.b2BWholesaleOrder.findUnique({ where: { id: existing.id }, include: { order: true, lines: true } });
  }

  const identity = createOrderIdentity();
  const order = await tx.order.create({
    data: {
      ...identity,
      userId: `DEALER_${dealer.id}`,
      items,
      amount: Number(quotation.totalAmount),
      deliveryFee: 0,
      address: {
        name: dealer.businessName,
        phone: dealer.phone,
        email: dealer.email || "",
        street: dealer.deliveryAddress,
        billingAddress: dealer.billingAddress,
        panVatNumber: dealer.panVatNumber,
        taxIdType: dealer.taxIdType,
      },
      status: "Order Placed",
      paymentMethod,
      payment: false,
      date: BigInt(now.getTime()),
      fulfillmentStatus: "accepted",
      orderType: "DIRECT_DISTRIBUTOR",
      directOrderType: "PHONE_ORDER",
      distributorId,
      directNotes: `B2B wholesale quotation ${quotation.quotationNumber}; dealer ${dealer.businessName}.`,
      marketingCardRequired: false,
    },
  });
  const assignment = await tx.orderAssignment.create({
    data: {
      orderId: order.id,
      distributorId,
      status: "ACCEPTED",
      acceptedAt: now,
      notes: `Wholesale order for ${dealer.businessName}.`,
    },
  });
  await tx.order.update({ where: { id: order.id }, data: { assignmentId: assignment.id } });
  const inventoryConsumption = await consumeDistributorOrderInventory({
    tx,
    orderId: order.id,
    distributorId,
    assignmentId: assignment.id,
    items,
    directSale: true,
    actorId: actorAccountId,
  });
  await tx.order.update({ where: { id: order.id }, data: { items: inventoryConsumption.accountingItems } });

  const wholesaleOrder = await tx.b2BWholesaleOrder.create({
    data: {
      orderId: order.id,
      distributorId,
      dealerId: dealer.id,
      quotationId: quotation.id,
      status: "CONFIRMED",
      idempotencyKey,
      createdByAccountId: actorAccountId || null,
      lines: {
        create: quotation.lines.map((line) => ({
          inventorySkuId: line.inventorySkuId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          lineTotal: line.lineTotal,
        })),
      },
    },
    include: { order: true, lines: { include: { inventorySku: { include: { product: true } } } } },
  });
  if (paymentMethod === "CREDIT") {
    await createAccountingDocument({
      documentType: "INVOICE",
      documentNumber: `WSX-${wholesaleOrder.id.slice(-16).toUpperCase()}`,
      partyId: party.id,
      partyTaxIdType: dealer.taxIdType,
      partyTaxIdNumber: dealer.panVatNumber,
      side: "RECEIVABLE",
      sourceType: "B2B_WHOLESALE_ORDER_EXPOSURE",
      sourceId: wholesaleOrder.id,
      issueDate: now,
      dueDate: dealer.dueDays > 0
        ? new Date(now.getTime() + dealer.dueDays * 24 * 60 * 60 * 1000)
        : null,
      amount: quotation.totalAmount,
      idempotencyKey: `b2b-credit-exposure:${wholesaleOrder.id}`,
      notes: `Credit exposure for wholesale order ${order.orderReference || wholesaleOrder.id}.`,
    }, { client: tx });
  }
  await tx.b2BQuotation.update({
    where: { id: quotation.id },
    data: { status: "CONVERTED", convertedAt: now },
  });
  await tx.b2BDealerCreditTransaction.create({
    data: {
      dealerId: dealer.id,
      transactionType: "ORDER_EXPOSURE",
      amount: quotation.totalAmount,
      balanceAfter: credit.outstanding.plus(quotation.totalAmount),
      referenceType: "B2B_WHOLESALE_ORDER",
      referenceId: wholesaleOrder.id,
      idempotencyKey: `dealer:${dealer.id}:order:${wholesaleOrder.id}:exposure`,
      actorAccountId: actorAccountId || null,
    },
  });
  return wholesaleOrder;
}, { isolationLevel: "Serializable" });

export const updateB2BWholesaleOrderStatus = async ({
  distributorId,
  wholesaleOrderId,
  status,
  cancellationReason = null,
  actorAccountId,
  client,
}) => client.$transaction(async (tx) => {
  const wholesaleOrder = await tx.b2BWholesaleOrder.findFirst({
    where: { id: wholesaleOrderId, distributorId },
    include: { lines: true },
  });
  if (!wholesaleOrder) throw fail("Wholesale order not found.", "WHOLESALE_ORDER_NOT_FOUND", 404);
  const normalizedStatus = String(status || "").trim().toUpperCase();
  const allowed = ["APPROVED", "PICKED", "PACKED", "DISPATCHED", "DELIVERED", "CANCELLED"];
  if (!allowed.includes(normalizedStatus)) throw fail("Invalid wholesale order status.");
  if (normalizedStatus === "CANCELLED") {
    if (!clean(cancellationReason || "", 4000)) throw fail("Cancellation reason is required.");
    if (["DISPATCHED", "DELIVERED", "CANCELLED"].includes(wholesaleOrder.status)) {
      throw fail("This wholesale order cannot be cancelled.", "WHOLESALE_ORDER_STATE_CONFLICT", 409);
    }
  }
  const updated = await tx.b2BWholesaleOrder.update({
    where: { id: wholesaleOrder.id },
    data: {
      status: normalizedStatus,
      ...(normalizedStatus === "CANCELLED" ? {
        cancelledByAccountId: actorAccountId || null,
        cancellationReason: clean(cancellationReason, 4000),
        cancelledAt: new Date(),
      } : {}),
    },
  });
  await tx.order.update({
    where: { id: wholesaleOrder.orderId },
    data: {
      status: normalizedStatus === "DELIVERED" ? "Delivered" : normalizedStatus === "CANCELLED" ? "Cancelled" : "Order Placed",
      fulfillmentStatus: normalizedStatus === "DELIVERED" ? "delivered" : normalizedStatus.toLowerCase(),
    },
  });
  if (normalizedStatus === "CANCELLED") {
    await tx.accountingDocument.updateMany({
      where: {
        sourceType: { in: ["B2B_WHOLESALE_ORDER_EXPOSURE", "B2B_WHOLESALE_INVOICE"] },
        sourceId: wholesaleOrder.id,
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
      },
      data: { status: "CANCELLED", remainingAmount: new Prisma.Decimal(0) },
    });
    const destinationLocation = await ensureInventoryLocation(tx, {
      kind: "DISTRIBUTOR",
      distributorId,
      name: `Distributor ${distributorId.slice(-8)}`,
    });
    for (const line of wholesaleOrder.lines) {
      await applyInventoryMovement(tx, {
        inventorySkuId: line.inventorySkuId,
        destinationLocationId: destinationLocation.id,
        quantity: line.quantity,
        movementType: "RETURN",
        referenceType: "B2B_WHOLESALE_ORDER_CANCELLATION",
        referenceId: wholesaleOrder.id,
        idempotencyKey: `b2b-cancel:${wholesaleOrder.id}:${line.inventorySkuId}`,
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        reason: `Cancelled wholesale order ${wholesaleOrder.orderId}.`,
      });
    }
  }
  return updated;
}, { isolationLevel: "Serializable" });

export const generateB2BWholesaleInvoice = async ({
  distributorId,
  wholesaleOrderId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const wholesaleOrder = await tx.b2BWholesaleOrder.findFirst({
    where: { id: wholesaleOrderId, distributorId },
    include: { dealer: true, order: true, lines: { include: { inventorySku: { include: { product: true } } } } },
  });
  if (!wholesaleOrder) throw fail("Wholesale order not found.", "WHOLESALE_ORDER_NOT_FOUND", 404);
  const suppliedKey = clean(body.idempotencyKey || "", 191);
  const idempotencyKey = suppliedKey || `b2b-invoice:${wholesaleOrder.id}`;
  const existing = await tx.b2BWholesaleInvoice.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const snapshot = wholesaleOrder.order.locationPricingSnapshot || {};
  const subtotal = wholesaleOrder.lines.reduce(
    (sum, line) => sum.plus(line.lineTotal.plus(line.discountAmount)),
    new Prisma.Decimal(0),
  );
  const discountAmount = wholesaleOrder.lines.reduce(
    (sum, line) => sum.plus(line.discountAmount),
    new Prisma.Decimal(0),
  );
  const taxableAmount = roundMoney(subtotal.minus(discountAmount));
  const taxPoint = new Date();
  const sellerTax = await resolveSellerTaxTreatment(taxPoint, { client: tx });
  let vatRate = new Prisma.Decimal(0);
  if (sellerTax.taxStatus === "VAT_REGISTERED") vatRate = await resolveVatRatePercent(taxPoint, { client: tx });
  const vatAmount = roundMoney(taxableAmount.mul(vatRate).div(100));
  const totalAmount = roundMoney(taxableAmount.plus(vatAmount));
  const documentType = sellerTax.taxStatus === "VAT_REGISTERED"
    ? "VAT_TAX_INVOICE"
    : sellerTax.taxStatus === "PAN_ONLY"
      ? "PAN_BILL"
      : "INTERNAL_SALES_RECORD";
  const invoiceNumber = `WB-${wholesaleOrder.order.orderReference || wholesaleOrder.orderId.slice(-12).toUpperCase()}`;

  const party = await ensureAccountingParty({
    partyType: "OTHER",
    sourceEntityId: wholesaleOrder.dealerId,
    displayName: wholesaleOrder.dealer.businessName,
    legalName: wholesaleOrder.dealer.businessName,
  }, { client: tx });
  await tx.salesInvoice.upsert({
    where: { orderId: wholesaleOrder.orderId },
    create: {
      orderId: wholesaleOrder.orderId,
      documentNumber: `SYS-${wholesaleOrder.order.orderReference || wholesaleOrder.orderId}`,
      documentType,
      issueChannel: "INTERNAL",
      status: "INTERNAL_ONLY",
      taxStatus: sellerTax.taxStatus,
      taxTreatment: sellerTax.taxTreatment,
      vatRate,
      taxableAmount,
      vatAmount,
      totalAmount,
      taxPoint,
      sellerSnapshot: {
        legalName: sellerTax.legalName,
        panNumber: sellerTax.panNumber,
        vatNumber: sellerTax.vatNumber,
        address: sellerTax.address,
      },
      buyerSnapshot: {
        name: wholesaleOrder.dealer.businessName,
        phone: wholesaleOrder.dealer.phone,
        email: wholesaleOrder.dealer.email,
        billingAddress: wholesaleOrder.dealer.billingAddress,
        deliveryAddress: wholesaleOrder.dealer.deliveryAddress,
        panVatNumber: wholesaleOrder.dealer.panVatNumber,
        taxIdType: wholesaleOrder.dealer.taxIdType,
      },
      lineSnapshots: wholesaleOrder.lines.map((line) => ({
        productId: line.inventorySku.productId,
        name: line.inventorySku.product.name,
        size: line.inventorySku.size,
        color: line.inventorySku.color,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        lineTotal: line.lineTotal.toString(),
      })),
      createdBy: actorAccountId || null,
      issuedBy: actorAccountId || null,
    },
    update: {},
  });

  await tx.accountingDocument.updateMany({
    where: {
      partyId: party.id,
      sourceType: "B2B_WHOLESALE_ORDER_EXPOSURE",
      sourceId: wholesaleOrder.id,
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
    },
    data: {
      status: "CANCELLED",
      remainingAmount: new Prisma.Decimal(0),
    },
  });
  await createAccountingDocument({
    documentType: "INVOICE",
    documentNumber: `WSI-${invoiceNumber}`,
    partyId: party.id,
    partyTaxIdType: wholesaleOrder.dealer.taxIdType,
    partyTaxIdNumber: wholesaleOrder.dealer.panVatNumber,
    side: "RECEIVABLE",
    sourceType: "B2B_WHOLESALE_INVOICE",
    sourceId: wholesaleOrder.id,
    issueDate: taxPoint,
    dueDate: wholesaleOrder.dealer.dueDays > 0
      ? new Date(taxPoint.getTime() + wholesaleOrder.dealer.dueDays * 24 * 60 * 60 * 1000)
      : null,
    amount: totalAmount,
    idempotencyKey: `accounting:${idempotencyKey}`,
  }, { client: tx });

  const dueDate = wholesaleOrder.dealer.dueDays > 0
    ? new Date(taxPoint.getTime() + wholesaleOrder.dealer.dueDays * 24 * 60 * 60 * 1000)
    : null;
  return tx.b2BWholesaleInvoice.create({
    data: {
      distributorId,
      dealerId: wholesaleOrder.dealerId,
      wholesaleOrderId: wholesaleOrder.id,
      orderId: wholesaleOrder.orderId,
      invoiceNumber,
      documentType,
      status: "ISSUED",
      vatRate,
      taxableAmount,
      vatAmount,
      discountAmount,
      totalAmount,
      dueDate,
      idempotencyKey,
      snapshot: {
        dealer: {
          businessName: wholesaleOrder.dealer.businessName,
          panVatNumber: wholesaleOrder.dealer.panVatNumber,
          taxIdType: wholesaleOrder.dealer.taxIdType,
          billingAddress: wholesaleOrder.dealer.billingAddress,
          deliveryAddress: wholesaleOrder.dealer.deliveryAddress,
        },
        sellerTax,
        snapshot,
        lines: wholesaleOrder.lines.map((line) => ({
          inventorySkuId: line.inventorySkuId,
          productName: line.inventorySku.product.name,
          size: line.inventorySku.size,
          color: line.inventorySku.color,
          quantity: line.quantity,
          unitPrice: line.unitPrice.toString(),
          discountAmount: line.discountAmount.toString(),
          lineTotal: line.lineTotal.toString(),
        })),
      },
      createdByAccountId: actorAccountId || null,
    },
  });
}, { isolationLevel: "Serializable" });

export const recordB2BDealerPayment = async ({
  distributorId,
  dealerId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const dealer = await tx.b2BDealerAccount.findFirst({ where: { id: dealerId, distributorId } });
  if (!dealer) throw fail("Dealer not found.", "DEALER_NOT_FOUND", 404);
  const amount = money(body.amount, "Payment amount");
  if (amount.lessThanOrEqualTo(0)) throw fail("Payment amount must be greater than zero.");
  const paymentMethod = clean(body.paymentMethod, 32).toUpperCase();
  if (!["CASH", "BANK_TRANSFER", "QR_PAYMENT", "CARD"].includes(paymentMethod)) throw fail("Invalid payment method.");
  const suppliedKey = clean(body.idempotencyKey || "", 191);
  if (!suppliedKey) throw fail("Idempotency-Key is required.", "IDEMPOTENCY_KEY_REQUIRED", 400);
  const existing = await tx.b2BDealerPayment.findUnique({ where: { idempotencyKey: suppliedKey } });
  if (existing) return existing;
  const party = await ensureAccountingParty({
    partyType: "OTHER",
    sourceEntityId: dealer.id,
    displayName: dealer.businessName,
    legalName: dealer.businessName,
  }, { client: tx });
  const allocations = await allocatePaymentToDocuments({
    partyId: party.id,
    side: "RECEIVABLE",
    amount,
    allocationType: "CASH",
    idempotencyKey: suppliedKey,
  }, { client: tx });
  const payment = await tx.b2BDealerPayment.create({
    data: {
      dealerId,
      distributorId,
      amount,
      paymentMethod,
      externalReference: clean(body.externalReference || "", 191) || null,
      evidenceUrl: clean(body.evidenceUrl || "", 5000) || null,
      idempotencyKey: suppliedKey,
      accountingAllocationId: allocations.allocations?.[0]?.id || null,
      actorAccountId: actorAccountId || null,
      notes: clean(body.notes || "", 4000) || null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    },
  });
  return { payment, allocations };
}, { isolationLevel: "Serializable" });

export const getB2BDealerStatement = async ({
  distributorId,
  dealerId,
  client,
}) => {
  const dealer = await client.b2BDealerAccount.findFirst({
    where: { id: dealerId, distributorId },
  });
  if (!dealer) throw fail("Dealer not found.", "DEALER_NOT_FOUND", 404);
  const party = await ensureAccountingParty({
    partyType: "OTHER",
    sourceEntityId: dealer.id,
    displayName: dealer.businessName,
    legalName: dealer.businessName,
  }, { client });
  if (money(dealer.openingBalance || 0).greaterThan(0)) {
    const existingOpening = await client.accountingDocument.findFirst({
      where: {
        partyId: party.id,
        sourceType: "B2B_DEALER_OPENING_BALANCE",
        sourceId: dealer.id,
      },
    });
    if (!existingOpening) {
      await createAccountingDocument({
        documentType: "INVOICE",
        documentNumber: `WSO-${String(dealer.id).slice(-16).toUpperCase()}`,
        partyId: party.id,
        partyTaxIdType: dealer.taxIdType || "PAN",
        partyTaxIdNumber: dealer.panVatNumber,
        side: "RECEIVABLE",
        sourceType: "B2B_DEALER_OPENING_BALANCE",
        sourceId: dealer.id,
        dueDate: dealer.dueDays > 0
          ? new Date(Date.now() + dealer.dueDays * 86400000)
          : null,
        amount: dealer.openingBalance,
        idempotencyKey: `b2b-opening:${dealer.id}`,
      }, { client });
    }
  }
  const [documents, payments, invoices, creditTransactions] = await Promise.all([
    client.accountingDocument.findMany({
      where: { partyId: party.id, side: "RECEIVABLE" },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }, { createdAt: "asc" }],
      include: { allocations: true },
    }),
    client.b2BDealerPayment.findMany({
      where: { dealerId, distributorId, status: "POSTED" },
      orderBy: { occurredAt: "desc" },
    }),
    client.b2BWholesaleInvoice.findMany({
      where: { dealerId, distributorId, status: "ISSUED" },
      orderBy: { issuedAt: "desc" },
    }),
    client.b2BDealerCreditTransaction.findMany({
      where: { dealerId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const openingBalance = money(dealer.openingBalance);
  const receivable = documents.filter((document) => ["OPEN", "PARTIALLY_PAID"].includes(document.status))
    .reduce((sum, document) => sum.plus(money(document.remainingAmount)), new Prisma.Decimal(0));
  const creditLimit = money(dealer.creditLimit);
  const now = new Date();
  const aging = { current: new Prisma.Decimal(0), days1to30: new Prisma.Decimal(0), days31to60: new Prisma.Decimal(0), over60: new Prisma.Decimal(0) };
  for (const document of documents.filter((item) => ["OPEN", "PARTIALLY_PAID"].includes(item.status))) {
    const amount = money(document.remainingAmount);
    const dueDate = document.dueDate ? new Date(document.dueDate) : null;
    if (!dueDate || dueDate >= now) aging.current = aging.current.plus(amount);
    else {
      const days = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
      if (days <= 30) aging.days1to30 = aging.days1to30.plus(amount);
      else if (days <= 60) aging.days31to60 = aging.days31to60.plus(amount);
      else aging.over60 = aging.over60.plus(amount);
    }
  }
  return {
    dealer,
    openingBalance,
    outstandingBalance: receivable,
    availableCredit: roundMoney(creditLimit.minus(receivable).greaterThan(0) ? creditLimit.minus(receivable) : 0),
    aging,
    invoices,
    documents,
    payments,
    creditTransactions,
  };
};
