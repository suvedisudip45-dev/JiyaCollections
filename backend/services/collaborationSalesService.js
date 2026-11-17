import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";
import { postCollaborationFeeInvoiceAccounting } from "./accountingPostingEngine.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { resolveSellerTaxTreatment } from "./sellerTaxProfileService.js";

const toDecimal = (value) => new Prisma.Decimal(String(value || 0));
const roundMoney = (value) => toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const normalize = (value) => String(value || "").trim().toLowerCase();

export const accrueCollaborationSalesForOrder = async ({ orderId, deliveredAt = new Date(), client = prisma }) => {
  if (!orderId) return 0;
  const result = await client.collaborationSale.updateMany({
    where: { orderId, status: "PENDING_DELIVERY" },
    data: { status: "ACCRUED", deliveredAt, accruedAt: deliveredAt },
  });
  return result.count;
};

export const applyCollaborationReturnAdjustments = async ({ orderId, items = [], returnedAt = new Date(), client = prisma }) => {
  if (!orderId || !items.length) return [];
  const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  const saleLines = await client.collaborationSale.findMany({
    where: { orderId, productId: { in: productIds }, status: { not: "PENDING_DELIVERY" } },
    orderBy: { orderItemIndex: "asc" },
  });
  const adjustments = [];

  for (const item of items) {
    const itemProductId = item.productId;
    if (!itemProductId) continue;
    const relevantLines = saleLines.filter((line) => line.productId === itemProductId);
    if (relevantLines.length === 0) continue;

    let quantityRemaining = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const matchingLines = relevantLines.filter((line) =>
      normalize(line.size) === normalize(item.size) && normalize(line.color) === normalize(item.color)
    );
    for (const line of matchingLines) {
      if (quantityRemaining <= 0) break;
      const available = Math.max(0, line.quantity - line.quantityReturned);
      const appliedQuantity = Math.min(available, quantityRemaining);
      if (appliedQuantity <= 0) continue;
      const nextReturned = line.quantityReturned + appliedQuantity;
      const updated = await client.collaborationSale.update({
        where: { id: line.id },
        data: {
          quantityReturned: nextReturned,
          lastReturnAt: returnedAt,
          status: nextReturned >= line.quantity ? "REVERSED" : "PARTIALLY_REVERSED",
        },
      });
      adjustments.push({ saleId: line.id, quantity: appliedQuantity, sale: updated });
      line.quantityReturned = nextReturned;
      quantityRemaining -= appliedQuantity;
    }
    if (quantityRemaining > 0) {
      throw new Error(`Return quantity exceeds sold collaboration quantity for ${item.name || itemProductId}.`);
    }
  }
  return adjustments;
};

export const calculateCollaborationFeeAmounts = (unitFee, quantity, vatTreatment, vatRatePercent = 0) => {
  const fee = toDecimal(unitFee).times(quantity);
  const rate = toDecimal(vatRatePercent).div(100);
  if (vatTreatment === "EXEMPT") return { netAmount: roundMoney(fee), vatAmount: toDecimal(0), totalAmount: roundMoney(fee) };
  if (vatTreatment === "VAT_INCLUSIVE") {
    const totalAmount = roundMoney(fee);
    const netAmount = roundMoney(totalAmount.div(toDecimal(1).plus(rate)));
    return { netAmount, vatAmount: roundMoney(totalAmount.minus(netAmount)), totalAmount };
  }
  const netAmount = roundMoney(fee);
  const vatAmount = roundMoney(netAmount.times(rate));
  return { netAmount, vatAmount, totalAmount: roundMoney(netAmount.plus(vatAmount)) };
};

const getMonthPeriod = (month) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) throw new Error("month must use YYYY-MM format.");
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("month is invalid.");
  const periodStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  const periodEnd = new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999));
  const thisMonthStart = new Date();
  thisMonthStart.setUTCDate(1);
  thisMonthStart.setUTCHours(0, 0, 0, 0);
  if (periodStart >= thisMonthStart) throw new Error("Only a completed calendar month can be invoiced.");
  return { periodStart, periodEnd, year, monthNumber };
};

const buildInvoiceLines = async ({ partnerId, client, period }) => {
  const saleLines = await client.collaborationSale.findMany({
    where: {
      partnerId,
      status: { in: ["ACCRUED", "INVOICED", "PARTIALLY_REVERSED", "REVERSED"] },
      deliveredAt: { not: null },
    },
    orderBy: [{ accruedAt: "asc" }, { orderItemIndex: "asc" }],
  });
  const lines = [];

  for (const sale of saleLines) {
    const retainedQuantity = Math.max(0, sale.quantity - sale.quantityReturned);
    const netInvoicedQuantity = sale.quantityInvoiced - sale.quantityCredited;
    const delta = retainedQuantity - netInvoicedQuantity;
    if (!delta) continue;
    const taxPoint = sale.deliveredAt || period.periodEnd;
    const sellerTaxTreatment = await resolveSellerTaxTreatment(taxPoint, { client });
    const vatTreatment = sellerTaxTreatment.taxStatus === "VAT_REGISTERED"
      ? sale.vatTreatment
      : "EXEMPT";
    const vatRate = sellerTaxTreatment.vatRate?.toNumber() ?? 0;
    const amounts = calculateCollaborationFeeAmounts(sale.partnerFeePerUnit, delta, vatTreatment, vatRate);
    lines.push({
      saleId: sale.id,
      entryType: delta > 0 ? "FEE" : "RETURN_CREDIT",
      quantity: Math.abs(delta),
      unitFee: sale.partnerFeePerUnit,
      netAmount: amounts.netAmount,
      vatAmount: amounts.vatAmount,
      totalAmount: amounts.totalAmount,
      delta,
    });
  }
  return lines;
};

export const finalizeCollaborationFeeInvoice = async ({
  invoice,
  partner,
  client = prisma,
  ensureParty = ensureAccountingParty,
  createDocument = createAccountingDocument,
  postAccounting = postCollaborationFeeInvoiceAccounting,
}) => {
  const finalize = async (tx) => {
    const currentInvoice = await tx.collaborationFeeInvoice.findUnique({
      where: { id: invoice.id },
      include: { lines: true },
    });
    if (!currentInvoice) throw new Error("Collaboration fee invoice was not found.");
    if (currentInvoice.status === "ISSUED") return currentInvoice;
    if (currentInvoice.status !== "PENDING_POSTING") {
      throw new Error(`Collaboration fee invoice cannot be issued from ${currentInvoice.status} status.`);
    }

    const totalAmount = toDecimal(currentInvoice.totalAmount);
    let accountingDocument = null;
    if (!totalAmount.isZero()) {
      const isCreditNote = totalAmount.isNegative();
      const document = currentInvoice.accountingDocumentId
        ? await tx.accountingDocument.findUnique({ where: { id: currentInvoice.accountingDocumentId } })
        : await tx.accountingDocument.findFirst({
          where: { sourceType: "COLLABORATION_FEE", sourceId: currentInvoice.id },
        });
      if (document && document.documentType !== (isCreditNote ? "CREDIT_NOTE" : "INVOICE")) {
        throw new Error("Existing collaboration fee accounting document type does not match the invoice balance.");
      }
      accountingDocument = document || await createDocument({
        documentType: isCreditNote ? "CREDIT_NOTE" : "INVOICE",
        documentNumber: isCreditNote ? `CN-${currentInvoice.invoiceNumber}` : currentInvoice.invoiceNumber,
        partyId: (await ensureParty({
          partyType: "MARKETING_PARTNER",
          sourceEntityId: partner.id,
          displayName: partner.name,
        }, { client: tx })).id,
        side: "RECEIVABLE",
        sourceType: "COLLABORATION_FEE",
        sourceId: currentInvoice.id,
        idempotencyKey: `COLLABORATION_FEE_INVOICE_DOCUMENT:${currentInvoice.id}`,
        issueDate: currentInvoice.issuedAt,
        amount: totalAmount.abs(),
        notes: `Collaboration selling fee ${isCreditNote ? "credit note" : "invoice"} for ${currentInvoice.periodStart.toISOString().slice(0, 7)}.`,
      }, { client: tx });

      await postAccounting({ invoice: currentInvoice, partner, client: tx });
    }

    await tx.collaborationFeeInvoice.update({
      where: { id: currentInvoice.id },
      data: { status: "ISSUED", accountingDocumentId: accountingDocument?.id || null },
    });
    for (const line of currentInvoice.lines) {
      const delta = line.entryType === "FEE" ? line.quantity : -line.quantity;
      await tx.collaborationSale.update({
        where: { id: line.saleId },
        data: {
          ...(delta > 0 ? { quantityInvoiced: { increment: delta } } : { quantityCredited: { increment: -delta } }),
        },
      });
    }
    return { ...currentInvoice, status: "ISSUED", accountingDocumentId: accountingDocument?.id || null };
  };

  if (typeof client.$transaction !== "function") return finalize(client);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.$transaction(finalize, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
};

export const generateMonthlyCollaborationInvoices = async ({ month, client = prisma }) => {
  const period = getMonthPeriod(month);
  const sales = await client.collaborationSale.findMany({
    where: { status: { in: ["ACCRUED", "INVOICED", "PARTIALLY_REVERSED", "REVERSED"] }, deliveredAt: { not: null } },
    select: { partnerId: true },
    distinct: ["partnerId"],
  });
  const results = [];

  for (const { partnerId } of sales) {
    let invoice = await client.collaborationFeeInvoice.findUnique({
      where: { partnerId_periodStart: { partnerId, periodStart: period.periodStart } },
      include: { lines: true },
    });
    if (invoice?.status === "ISSUED") {
      results.push(invoice);
      continue;
    }
    if (!invoice) {
      const lines = await buildInvoiceLines({ partnerId, client, period });
      const totals = lines.reduce((sum, line) => ({
        units: sum.units + (line.delta > 0 ? line.delta : -Math.abs(line.delta)),
        net: sum.net.plus(line.netAmount),
        vat: sum.vat.plus(line.vatAmount),
        total: sum.total.plus(line.totalAmount),
      }), { units: 0, net: toDecimal(0), vat: toDecimal(0), total: toDecimal(0) });
      if (!lines.length) continue;

      const partner = await client.marketingPartner.findUnique({ where: { id: partnerId }, select: { id: true, code: true, name: true } });
      if (!partner) continue;
      const invoiceNumber = `COL-${String(partner.code).replace(/[^a-z0-9]/gi, "").toUpperCase()}-${String(period.year)}${String(period.monthNumber).padStart(2, "0")}`;
      invoice = await client.collaborationFeeInvoice.create({
        data: {
          invoiceNumber,
          partnerId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          totalUnits: totals.units,
          netAmount: roundMoney(totals.net),
          vatAmount: roundMoney(totals.vat),
          totalAmount: roundMoney(totals.total),
          status: "PENDING_POSTING",
          lines: { create: lines.map(({ delta, ...line }) => line) },
        },
        include: { lines: true },
      });
    }

    const partner = await client.marketingPartner.findUnique({ where: { id: partnerId }, select: { id: true, code: true, name: true } });
    if (!partner) continue;
    results.push(await finalizeCollaborationFeeInvoice({ invoice, partner, client }));
  }
  return results;
};

export const getCollaborationSalesReport = async ({ partnerId, manufacturerId, client = prisma }) => {
  let productIds = [];
  if (manufacturerId) {
    const inventoryRows = await client.manufacturerInventory.findMany({
      where: { manufacturerId },
      select: { productId: true },
    });
    productIds = inventoryRows.map((row) => row.productId);
  }

  const sales = await client.collaborationSale.findMany({
    where: {
      ...(partnerId ? { partnerId } : {}),
      ...(manufacturerId && productIds.length > 0 ? { productId: { in: productIds } } : manufacturerId ? { productId: { in: [] } } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      product: { select: { id: true, name: true, image: true } },
      partner: { select: { id: true, name: true, code: true } },
      order: { select: { id: true, status: true, date: true } },
    },
  });
  const salesIds = sales.map((sale) => sale.id);
  const invoices = await client.collaborationFeeInvoice.findMany({
    where: {
      ...(partnerId ? { partnerId } : {}),
      ...(salesIds.length > 0 ? { lines: { some: { saleId: { in: salesIds } } } } : {}),
    },
    orderBy: { issuedAt: "desc" },
    include: { partner: { select: { id: true, name: true, code: true } }, lines: true },
  });
  const documentIds = invoices.map((invoice) => invoice.accountingDocumentId).filter(Boolean);
  const documents = documentIds.length ? await client.accountingDocument.findMany({ where: { id: { in: documentIds } } }) : [];
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const summary = sales.reduce((totals, sale) => {
    totals.orderedUnits += sale.quantity;
    if (sale.status !== "PENDING_DELIVERY") {
      const retained = Math.max(0, sale.quantity - sale.quantityReturned);
      totals.deliveredUnits += sale.quantity;
      totals.returnedUnits += sale.quantityReturned;
      totals.retainedUnits += retained;
      totals.netSales += Number(sale.unitSellingPrice) * retained;
      totals.discountAmount += Number(sale.unitDiscount) * retained;
      totals.feeAccrued += Number(sale.partnerFeePerUnit) * retained;
      totals.feeInvoiced += Number(sale.partnerFeePerUnit) * Math.max(0, sale.quantityInvoiced - sale.quantityCredited);
    }
    return totals;
  }, { orderedUnits: 0, deliveredUnits: 0, returnedUnits: 0, retainedUnits: 0, netSales: 0, discountAmount: 0, feeAccrued: 0, feeInvoiced: 0 });
  const safeSales = sales.map((sale) => ({
    ...sale,
    order: sale.order ? { ...sale.order, date: Number(sale.order.date || 0) } : null,
  }));

  return {
    summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value.toFixed(2))])),
    sales: safeSales,
    invoices: invoices.map((invoice) => ({
      ...invoice,
      accountingDocument: documentsById.get(invoice.accountingDocumentId) || null,
    })),
  };
};