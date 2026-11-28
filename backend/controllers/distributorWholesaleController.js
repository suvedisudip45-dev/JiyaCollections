import { prisma } from "../config/db.js";
import {
  approveB2BQuotation,
  cancelB2BQuotation,
  convertB2BQuotationToOrder,
  createB2BQuotation,
  createDealerAccount,
  createWholesalePriceTier,
  generateB2BWholesaleInvoice,
  getB2BDealerStatement,
  listDealerAccounts,
  recordB2BDealerPayment,
  updateB2BWholesaleOrderStatus,
  updateDealerAccount,
  upsertDealerContractPrice,
} from "../services/distributorWholesaleService.js";

const respondError = (res, error) => res.status(error.statusCode || (error.code === "P2002" ? 409 : 500)).json({
  success: false,
  message: error.code === "P2002"
    ? "A unique wholesale record already exists."
    : error.statusCode
      ? error.message
      : "The wholesale operation could not be completed.",
  code: error.code === "P2002" ? "WHOLESALE_UNIQUE_CONFLICT" : (error.code || "WHOLESALE_OPERATION_FAILED"),
});

const actor = (req) => req.auth?.accountId || req.auth?.profileId || null;

export const getWholesaleDealerDetail = async (req, res) => {
  try {
    const dealerId = String(req.params.dealerId || "").trim();
    if (!dealerId) throw Object.assign(new Error("Dealer ID is required."), { statusCode: 400, code: "DEALER_ID_REQUIRED" });
    const dealer = await prisma.b2BDealerAccount.findFirst({
      where: { id: dealerId, distributorId: req.distributorId },
      include: {
        priceTier: true,
        contractPrices: {
          orderBy: { effectiveFrom: "desc" },
          take: 100,
          include: { product: true, inventorySku: { include: { product: true } } },
        },
        creditTransactions: { orderBy: { createdAt: "desc" }, take: 100 },
        payments: { orderBy: { occurredAt: "desc" }, take: 100 },
      },
    });
    if (!dealer) throw Object.assign(new Error("Dealer not found."), { statusCode: 404, code: "DEALER_NOT_FOUND" });
    const [orders, invoices, quotations, statement] = await Promise.all([
      prisma.b2BWholesaleOrder.findMany({
        where: { distributorId: req.distributorId, dealerId },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          order: true,
          lines: { include: { inventorySku: { include: { product: true } } } },
          invoices: true,
        },
      }),
      prisma.b2BWholesaleInvoice.findMany({
        where: { distributorId: req.distributorId, dealerId, status: "ISSUED" },
        orderBy: { issuedAt: "desc" },
        take: 100,
        include: { wholesaleOrder: { include: { order: true, lines: { include: { inventorySku: { include: { product: true } } } } } } },
      }),
      prisma.b2BQuotation.findMany({
        where: { distributorId: req.distributorId, dealerId },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { lines: { include: { inventorySku: { include: { product: true } } } } },
      }),
      getB2BDealerStatement({ distributorId: req.distributorId, dealerId, client: prisma }),
    ]);
    return res.json({
      success: true,
      dealer,
      orders,
      invoices,
      quotations,
      statement,
    });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listWholesalePricing = async (req, res) => {
  try {
    const tiers = await prisma.b2BWholesalePriceTier.findMany({
      where: { distributorId: req.distributorId },
      orderBy: { createdAt: "desc" },
      include: { quantityDiscounts: { orderBy: [{ minimumQuantity: "asc" }, { effectiveFrom: "asc" }] }, dealers: true },
    });
    const contractPrices = await prisma.b2BDealerContractPrice.findMany({
      where: { distributorId: req.distributorId },
      orderBy: { effectiveFrom: "desc" },
      take: 250,
      include: {
        dealer: true,
        product: true,
        inventorySku: { include: { product: true } },
      },
    });
    return res.json({ success: true, tiers, contractPrices });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getWholesaleDocument = async (req, res) => {
  try {
    const kind = String(req.params.kind || (String(req.route?.path || "").includes("statement") ? "statement" : "")).toLowerCase();
    const dealerId = String(req.params.dealerId || "").trim();
    const referenceId = String(req.params.referenceId || "").trim();
    if (!["invoice", "packing-slip", "statement"].includes(kind)) {
      throw Object.assign(new Error("Invalid document type."), { statusCode: 400, code: "INVALID_DOCUMENT_TYPE" });
    }
    const dealer = await prisma.b2BDealerAccount.findFirst({
      where: { id: dealerId, distributorId: req.distributorId },
    });
    if (!dealer) throw Object.assign(new Error("Dealer not found."), { statusCode: 404, code: "DEALER_NOT_FOUND" });
    if (kind === "statement") {
      const statement = await getB2BDealerStatement({ distributorId: req.distributorId, dealerId, client: prisma });
      return res.json({ success: true, kind, dealer, document: statement });
    }
    if (!referenceId) throw Object.assign(new Error("Document reference is required."), { statusCode: 400, code: "DOCUMENT_REFERENCE_REQUIRED" });
    const order = await prisma.b2BWholesaleOrder.findFirst({
      where: { id: referenceId, distributorId: req.distributorId, dealerId },
      include: {
        order: true,
        dealer: true,
        invoices: { orderBy: { issuedAt: "desc" } },
        lines: { include: { inventorySku: { include: { product: true } } } },
      },
    });
    if (!order) throw Object.assign(new Error("Wholesale order not found."), { statusCode: 404, code: "WHOLESALE_ORDER_NOT_FOUND" });
    const invoice = order.invoices[0] || null;
    const document = {
      order,
      invoice,
      dealer,
      lines: order.lines,
    };
    return res.json({ success: true, kind, document });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listWholesaleDealers = async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const dealers = await listDealerAccounts({
      distributorId: req.distributorId,
      status,
      search: String(req.query.search || "").trim().slice(0, 191),
      client: prisma,
    });
    return res.json({ success: true, dealers });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createWholesaleDealer = async (req, res) => {
  try {
    const dealer = await createDealerAccount({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, dealer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const updateWholesaleDealer = async (req, res) => {
  try {
    const dealer = await updateDealerAccount({
      distributorId: req.distributorId,
      dealerId: req.params.dealerId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.json({ success: true, dealer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createWholesaleTier = async (req, res) => {
  try {
    const tier = await createWholesalePriceTier({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, tier });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createWholesaleContractPrice = async (req, res) => {
  try {
    const contractPrice = await upsertDealerContractPrice({
      distributorId: req.distributorId,
      dealerId: req.params.dealerId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, contractPrice });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createWholesaleQuotation = async (req, res) => {
  try {
    const quotation = await createB2BQuotation({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, quotation });
  } catch (error) {
    return respondError(res, error);
  }
};

export const approveWholesaleQuotation = async (req, res) => {
  try {
    const quotation = await approveB2BQuotation({
      distributorId: req.distributorId,
      quotationId: req.params.quotationId,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, quotation });
  } catch (error) {
    return respondError(res, error);
  }
};

export const cancelWholesaleQuotation = async (req, res) => {
  try {
    const quotation = await cancelB2BQuotation({
      distributorId: req.distributorId,
      quotationId: req.params.quotationId,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, quotation });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listWholesaleQuotations = async (req, res) => {
  try {
    const where = {
      distributorId: req.distributorId,
      ...(req.params.dealerId ? { dealerId: req.params.dealerId } : {}),
      ...(req.query.status ? { status: String(req.query.status).trim().toUpperCase() } : {}),
    };
    const quotations = await prisma.b2BQuotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { dealer: true, lines: { include: { inventorySku: { include: { product: true } } } } },
    });
    return res.json({ success: true, quotations });
  } catch (error) {
    return respondError(res, error);
  }
};

export const convertWholesaleQuotation = async (req, res) => {
  try {
    const wholesaleOrder = await convertB2BQuotationToOrder({
      distributorId: req.distributorId,
      quotationId: req.params.quotationId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, wholesaleOrder });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listWholesaleOrders = async (req, res) => {
  try {
    const orders = await prisma.b2BWholesaleOrder.findMany({
      where: {
        distributorId: req.distributorId,
        ...(req.params.dealerId ? { dealerId: req.params.dealerId } : {}),
        ...(req.query.status ? { status: String(req.query.status).trim().toUpperCase() } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        dealer: true,
        order: true,
        lines: { include: { inventorySku: { include: { product: true } } } },
        invoices: true,
      },
    });
    return res.json({ success: true, orders });
  } catch (error) {
    return respondError(res, error);
  }
};

export const updateWholesaleOrderStatus = async (req, res) => {
  try {
    const wholesaleOrder = await updateB2BWholesaleOrderStatus({
      distributorId: req.distributorId,
      wholesaleOrderId: req.params.orderId,
      status: req.body.status,
      cancellationReason: req.body.cancellationReason,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, wholesaleOrder });
  } catch (error) {
    return respondError(res, error);
  }
};

export const generateWholesaleInvoice = async (req, res) => {
  try {
    const invoice = await generateB2BWholesaleInvoice({
      distributorId: req.distributorId,
      wholesaleOrderId: req.params.orderId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, invoice });
  } catch (error) {
    return respondError(res, error);
  }
};

export const recordWholesaleDealerPayment = async (req, res) => {
  try {
    const result = await recordB2BDealerPayment({
      distributorId: req.distributorId,
      dealerId: req.params.dealerId,
      actorAccountId: actor(req),
      body: {
        ...req.body,
        idempotencyKey: req.headers["idempotency-key"] || req.body.idempotencyKey,
      },
      client: prisma,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getWholesaleDealerStatement = async (req, res) => {
  try {
    const statement = await getB2BDealerStatement({
      distributorId: req.distributorId,
      dealerId: req.params.dealerId,
      client: prisma,
    });
    return res.json({ success: true, statement });
  } catch (error) {
    return respondError(res, error);
  }
};
