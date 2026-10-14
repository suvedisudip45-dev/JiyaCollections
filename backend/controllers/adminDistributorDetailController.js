import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { getDistributorFinancialStatement } from "../services/distributorFinanceService.js";
import { resolveActiveRateCard } from "../services/distributorRateCardService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

const sendError = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Unable to load distributor details.",
    ...(error.code ? { code: error.code } : {}),
  });
};

const distributorExists = async (distributorId) => {
  const distributor = await prisma.distributor.findUnique({
    where: { id: distributorId },
    select: { id: true },
  });
  return Boolean(distributor);
};

export const listAdminDistributors = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const query = String(req.query.q || "").trim().slice(0, 120);
    if (query.length < 2) {
      return res.json(paginatedResponse("distributors", [], pagination, 0));
    }
    const where = query
      ? {
          OR: [
            { name: { contains: query } },
            { phone: { contains: query } },
            { city: { contains: query } },
            { district: { contains: query } },
            { account: { email: { contains: query } } },
          ],
        }
      : {};

    const [distributors, total] = await prisma.$transaction([
      prisma.distributor.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          accountId: true,
          name: true,
          phone: true,
          address: true,
          city: true,
          province: true,
          district: true,
          status: true,
          isActive: true,
          qualityRating: true,
          createdAt: true,
          updatedAt: true,
          account: { select: { email: true, lastLoginAt: true } },
          assignments: {
            take: 1,
            orderBy: [{ assignedAt: "desc" }],
            select: { assignedAt: true },
          },
          _count: { select: { assignments: true, destinationTransfers: true } },
        },
      }),
      prisma.distributor.count({ where }),
    ]);

    return res.json(paginatedResponse("distributors", distributors, pagination, total));
  } catch (error) {
    return sendError(res, error, "listAdminDistributors");
  }
};

export const getAdminDistributorProfile = async (req, res) => {
  try {
    const distributor = await prisma.distributor.findUnique({
      where: { id: req.params.id },
      include: {
        account: {
          select: {
            id: true,
            email: true,
            phone: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            manufacturerProfile: { select: { id: true, name: true } },
          },
        },
        locations: {
          where: { isActive: true },
          orderBy: [{ province: "asc" }, { district: "asc" }],
          select: { id: true, province: true, district: true, isActive: true },
        },
        deliveryChargeNegotiations: {
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
          take: 10,
          select: {
            id: true,
            productId: true,
            deliveryCharge: true,
            returnCharge: true,
            commissionRate: true,
            bonusRate: true,
            incentiveRate: true,
            vatRate: true,
            status: true,
            effectiveFrom: true,
            effectiveUntil: true,
            createdAt: true,
          },
        },
      },
    });
    if (!distributor) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    return res.json({ success: true, distributor });
  } catch (error) {
    return sendError(res, error, "getAdminDistributorProfile");
  }
};

export const getAdminDistributorLoginHistory = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const distributor = await prisma.distributor.findUnique({
      where: { id: req.params.id },
      select: { accountId: true },
    });
    if (!distributor) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    if (!distributor.accountId) {
      return res.json(paginatedResponse("logins", [], pagination, 0));
    }

    const where = {
      accountId: distributor.accountId,
      action: { in: ["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_BLOCKED", "LOGIN_REJECTED"] },
    };
    const [logins, total] = await prisma.$transaction([
      prisma.authAuditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          action: true,
          role: true,
          portal: true,
          status: true,
          failureReason: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
      }),
      prisma.authAuditLog.count({ where }),
    ]);
    return res.json(paginatedResponse("logins", logins, pagination, total));
  } catch (error) {
    return sendError(res, error, "getAdminDistributorLoginHistory");
  }
};

export const getAdminDistributorInventory = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const distributorId = req.params.id;
    const locations = await prisma.inventoryLocation.findMany({
      where: { distributorId, kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", isActive: true },
      select: { id: true },
    });
    if (!(await distributorExists(distributorId))) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    const locationIds = locations.map(({ id }) => id);
    if (locationIds.length === 0) {
      return res.json({
        ...paginatedResponse("inventory", [], pagination, 0),
        totals: { unitsOnHand: 0, availableUnits: 0, estimatedRetailValue: 0, estimatedCostValue: 0 },
      });
    }

    const where = {
      locationId: { in: locationIds },
      inventorySku: { isActive: true, product: { published: true } },
    };
    const [balances, total, totals] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where,
        orderBy: [
          { inventorySku: { product: { name: "asc" } } },
          { inventorySku: { size: "asc" } },
          { inventorySku: { color: "asc" } },
        ],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          inventorySku: {
            include: {
              product: {
                select: { id: true, name: true, image: true, price: true, costPrice: true },
              },
            },
          },
        },
      }),
      prisma.inventoryBalance.count({ where }),
      prisma.$queryRaw(Prisma.sql`
        SELECT
          COALESCE(SUM(b.quantityOnHand), 0) AS unitsOnHand,
          COALESCE(SUM(GREATEST(b.quantityOnHand - b.reservedQuantity, 0)), 0) AS availableUnits,
          COALESCE(SUM(b.quantityOnHand * p.price), 0) AS estimatedRetailValue,
          COALESCE(SUM(b.quantityOnHand * p.costPrice), 0) AS estimatedCostValue
        FROM InventoryBalance b
        INNER JOIN InventoryLocation l ON l.id = b.locationId
        INNER JOIN InventorySku s ON s.id = b.inventorySkuId
        INNER JOIN Product p ON p.id = s.productId
        WHERE l.distributorId = ${distributorId}
          AND l.kind = 'DISTRIBUTOR'
          AND l.inventoryOwner = 'PLATFORM'
          AND l.isActive = 1
          AND s.isActive = 1
          AND p.published = 1
      `),
    ]);

    const inventory = balances.map((balance) => {
      const quantity = balance.quantityOnHand;
      const product = balance.inventorySku.product;
      return {
        inventorySkuId: balance.inventorySkuId,
        productId: balance.inventorySku.productId,
        productName: product.name,
        product,
        size: balance.inventorySku.size,
        color: balance.inventorySku.color,
        quantity,
        reservedQty: balance.reservedQuantity,
        availableQty: Math.max(0, quantity - balance.reservedQuantity),
        estimatedRetailValue: Number((quantity * product.price).toFixed(2)),
        estimatedCostValue: Number((quantity * product.costPrice).toFixed(2)),
        valuationBasis: "CURRENT_PRODUCT_PRICES",
      };
    });
    const totalsRow = totals[0] || {};
    return res.json({
      ...paginatedResponse("inventory", inventory, pagination, total),
      totals: {
        unitsOnHand: Number(totalsRow.unitsOnHand || 0),
        availableUnits: Number(totalsRow.availableUnits || 0),
        estimatedRetailValue: Number(Number(totalsRow.estimatedRetailValue || 0).toFixed(2)),
        estimatedCostValue: Number(Number(totalsRow.estimatedCostValue || 0).toFixed(2)),
        valuationBasis: "CURRENT_PRODUCT_PRICES",
      },
    });
  } catch (error) {
    return sendError(res, error, "getAdminDistributorInventory");
  }
};

export const getAdminDistributorReturns = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    if (!(await distributorExists(req.params.id))) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    const where = { distributorId: req.params.id };
    const [returns, total] = await prisma.$transaction([
      prisma.customerReturn.findMany({
        where,
        orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          events: {
            orderBy: { occurredAt: "desc" },
            take: 5,
          },
        },
      }),
      prisma.customerReturn.count({ where }),
    ]);
    return res.json(paginatedResponse("returns", returns, pagination, total));
  } catch (error) {
    return sendError(res, error, "getAdminDistributorReturns");
  }
};

export const getAdminDistributorExchanges = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    if (!(await distributorExists(req.params.id))) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    const where = { distributorId: req.params.id };
    const [exchanges, total] = await prisma.$transaction([
      prisma.orderExchangeRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
          order: { select: { id: true, date: true, status: true, amount: true, paymentMethod: true, payment: true } },
          events: {
            orderBy: { occurredAt: "desc" },
            take: 5,
          },
        },
      }),
      prisma.orderExchangeRequest.count({ where }),
    ]);
    const serializedExchanges = exchanges.map((exchange) => ({
      ...exchange,
      order: exchange.order ? { ...exchange.order, date: String(exchange.order.date) } : null,
    }));
    return res.json(paginatedResponse("exchanges", serializedExchanges, pagination, total));
  } catch (error) {
    return sendError(res, error, "getAdminDistributorExchanges");
  }
};

export const getAdminDistributorFinance = async (req, res) => {
  try {
    const statement = await getDistributorFinancialStatement({
      distributorId: req.params.id,
      withVat: req.query.withVat !== "false",
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    });
    return res.json({
      success: true,
      distributor: statement.distributor,
      rateCard: statement.rateCard,
      vatMode: statement.vatMode,
      summary: statement.summary,
    });
  } catch (error) {
    return sendError(res, error, "getAdminDistributorFinance");
  }
};

export const getAdminDistributorFinanceTransactions = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const distributorId = req.params.id;
    if (!(await distributorExists(distributorId))) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }

    const [rateCard, deliveries, returns, settlements, rows] = await Promise.all([
      resolveActiveRateCard({ distributorId }),
      prisma.orderAssignment.count({ where: { distributorId, status: { in: ["delivered", "Delivered"] } } }),
      prisma.orderAssignment.count({ where: { distributorId, status: { in: ["returned", "Returned"] } } }),
      prisma.distributorSettlementRequest.count({ where: { distributorId } }),
      prisma.$queryRaw(Prisma.sql`
        SELECT *
        FROM (
          SELECT
            'DELIVERY' AS transactionType,
            a.id AS sourceId,
            a.orderId AS referenceId,
            COALESCE(a.deliveredAt, a.assignedAt) AS transactionDate,
            COALESCE(o.amount, 0) AS orderAmount,
            COALESCE(o.paymentMethod, 'COD') AS paymentMethod,
            0 AS settlementAmount,
            NULL AS status,
            NULL AS notes,
            NULL AS financialAccountId
          FROM OrderAssignment a
          LEFT JOIN \`Order\` o ON o.id = a.orderId
          WHERE a.distributorId = ${distributorId}
            AND a.status IN ('delivered', 'Delivered')
          UNION ALL
          SELECT
            'RETURN' AS transactionType,
            a.id AS sourceId,
            a.orderId AS referenceId,
            COALESCE(a.returnedAt, a.assignedAt) AS transactionDate,
            0 AS orderAmount,
            'N/A' AS paymentMethod,
            0 AS settlementAmount,
            NULL AS status,
            NULL AS notes,
            NULL AS financialAccountId
          FROM OrderAssignment a
          WHERE a.distributorId = ${distributorId}
            AND a.status IN ('returned', 'Returned')
          UNION ALL
          SELECT
            'SETTLEMENT' AS transactionType,
            s.id AS sourceId,
            s.id AS referenceId,
            COALESCE(s.settledAt, s.requestedAt) AS transactionDate,
            0 AS orderAmount,
            'N/A' AS paymentMethod,
            s.amount AS settlementAmount,
            s.status AS status,
            s.notes AS notes,
            s.financialAccountId AS financialAccountId
          FROM DistributorSettlementRequest s
          WHERE s.distributorId = ${distributorId}
        ) AS distributorTransactions
        ORDER BY transactionDate DESC, sourceId DESC
        LIMIT ${pagination.limit} OFFSET ${pagination.skip}
      `),
    ]);

    const commission = rateCard.commissionRate > 0 && rateCard.commissionRate <= 100
      ? rateCard.deliveryCharge * (rateCard.commissionRate / 100)
      : rateCard.commissionRate;
    const transactions = rows.map((row) => {
      if (row.transactionType === "DELIVERY") {
        const bonus = rateCard.bonusRate || rateCard.incentiveRate;
        return {
          id: `tx-del-${row.sourceId}`,
          type: "DELIVERY",
          referenceId: row.referenceId,
          date: row.transactionDate,
          description: `Self-delivery completed for Order ${String(row.referenceId).slice(0, 8)}`,
          grossAmount: Number(rateCard.deliveryCharge.toFixed(2)),
          incentiveAmount: Number(bonus.toFixed(2)),
          discountChargeAmount: Number(commission.toFixed(2)),
          netAmount: Number((rateCard.deliveryCharge + bonus - commission).toFixed(2)),
          orderAmount: Number(row.orderAmount || 0),
          paymentMethod: row.paymentMethod,
        };
      }
      if (row.transactionType === "RETURN") {
        return {
          id: `tx-ret-${row.sourceId}`,
          type: "RETURN",
          referenceId: row.referenceId,
          date: row.transactionDate,
          description: `Customer return QA processed for Order ${String(row.referenceId).slice(0, 8)}`,
          grossAmount: Number(rateCard.returnCharge.toFixed(2)),
          incentiveAmount: 0,
          discountChargeAmount: 0,
          netAmount: Number(rateCard.returnCharge.toFixed(2)),
          orderAmount: 0,
          paymentMethod: "N/A",
        };
      }
      const settlementAmount = Number(row.settlementAmount || 0);
      return {
        id: `tx-set-${row.sourceId}`,
        type: "SETTLEMENT",
        referenceId: row.referenceId,
        date: row.transactionDate,
        description: row.status === "SETTLED" ? "Settlement Payout Executed" : "Settlement Payout Requested (Pending)",
        grossAmount: -settlementAmount,
        incentiveAmount: 0,
        discountChargeAmount: 0,
        netAmount: -settlementAmount,
        status: row.status,
        notes: row.notes || null,
        financialAccountId: row.financialAccountId || null,
      };
    });
    return res.json(paginatedResponse("transactions", transactions, pagination, deliveries + returns + settlements));
  } catch (error) {
    return sendError(res, error, "getAdminDistributorFinanceTransactions");
  }
};

export const getAdminDistributorSettlements = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    if (!(await distributorExists(req.params.id))) {
      return res.status(404).json({ success: false, message: "Distributor profile not found." });
    }
    const where = { distributorId: req.params.id };
    if (req.query.status && req.query.status !== "all") where.status = String(req.query.status).toUpperCase();
    const [settlements, total] = await prisma.$transaction([
      prisma.distributorSettlementRequest.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.distributorSettlementRequest.count({ where }),
    ]);
    return res.json(paginatedResponse("settlements", settlements, pagination, total));
  } catch (error) {
    return sendError(res, error, "getAdminDistributorSettlements");
  }
};
