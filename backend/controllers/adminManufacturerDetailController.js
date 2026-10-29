import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { getManufacturerSettlementSummary } from "../services/manufacturerSettlementService.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

const sendError = (res, error, action) => {
  console.error(`${action} error:`, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : "Unable to load manufacturer details.",
    ...(error.code ? { code: error.code } : {}),
  });
};

const findManufacturer = (manufacturerId, select = { id: true }) =>
  prisma.manufacturer.findUnique({ where: { id: manufacturerId }, select });

export const getAdminManufacturerInventory = async (req, res) => {
  try {
    const { id: manufacturerId } = req.params;
    const pagination = getPagination(req.query);
    const manufacturer = await findManufacturer(manufacturerId);
    if (!manufacturer) {
      return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    }

    const locations = await prisma.inventoryLocation.findMany({
      where: { manufacturerId, kind: "FACTORY", inventoryOwner: "PLATFORM", isActive: true },
      select: { id: true },
    });
    const locationIds = locations.map(({ id }) => id);
    const where = { locationId: { in: locationIds } };
    const [balances, total, totals, costTotals] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where,
        orderBy: [
          { inventorySku: { product: { name: "asc" } } },
          { inventorySku: { size: "asc" } },
          { inventorySku: { color: "asc" } },
          { location: { name: "asc" } },
        ],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          location: { select: { id: true, name: true } },
          inventorySku: {
            include: {
              product: { select: { id: true, name: true, image: true } },
            },
          },
        },
      }),
      prisma.inventoryBalance.count({ where }),
      locationIds.length
        ? prisma.$queryRaw(Prisma.sql`
            SELECT
              COALESCE(SUM(b.quantityOnHand), 0) AS unitsOnHand,
              COALESCE(SUM(GREATEST(b.quantityOnHand - b.reservedQuantity, 0)), 0) AS availableUnits
            FROM InventoryBalance b
            INNER JOIN InventoryLocation l ON l.id = b.locationId
            WHERE l.manufacturerId = ${manufacturerId}
              AND l.kind = 'FACTORY'
              AND l.inventoryOwner = 'PLATFORM'
              AND l.isActive = 1
          `)
        : Promise.resolve([]),
      prisma.manufacturerInventoryCostLayer.aggregate({
        where: { manufacturerId, availableQuantity: { gt: 0 } },
        _sum: { availableQuantity: true },
      }),
    ]);

    const inventory = balances.map((balance) => ({
      id: balance.id,
      location: balance.location,
      inventorySkuId: balance.inventorySkuId,
      productId: balance.inventorySku.productId,
      product: balance.inventorySku.product,
      size: balance.inventorySku.size,
      color: balance.inventorySku.color,
      quantityOnHand: balance.quantityOnHand,
      reservedQuantity: balance.reservedQuantity,
      availableQuantity: Math.max(0, balance.quantityOnHand - balance.reservedQuantity),
    }));
    const totalsRow = totals[0] || {};
    return res.json({
      ...paginatedResponse("inventory", inventory, pagination, total),
      totals: {
        unitsOnHand: Number(totalsRow.unitsOnHand || 0),
        availableUnits: Number(totalsRow.availableUnits || 0),
        unitsWithCostLayers: Number(costTotals._sum.availableQuantity || 0),
        valuationBasis: "PRODUCTION_COST_LAYERS",
      },
    });
  } catch (error) {
    return sendError(res, error, "getAdminManufacturerInventory");
  }
};

export const getAdminManufacturerFinance = async (req, res) => {
  try {
    const { id: manufacturerId } = req.params;
    const [summary, accountingParty] = await Promise.all([
      getManufacturerSettlementSummary(manufacturerId),
      prisma.accountingParty.findUnique({
        where: {
          partyType_sourceEntityId: {
            partyType: "MANUFACTURER",
            sourceEntityId: manufacturerId,
          },
        },
        select: { id: true },
      }),
    ]);
    if (!summary) {
      return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    }

    const receivableTotals = accountingParty
      ? await prisma.accountingDocument.aggregate({
          where: { partyId: accountingParty.id, side: "RECEIVABLE", status: { not: "CANCELLED" } },
          _sum: { originalAmount: true, remainingAmount: true },
          _count: { _all: true },
        })
      : null;
    return res.json({
      success: true,
      finance: {
        totalManufacturedGoodsValue: summary.totalManufacturedGoodsValue,
        logisticsReimbursements: summary.logisticsReimbursements,
        pendingSettlements: summary.pendingSettlementAmount,
        completedPayments: summary.completedPayments,
        outstandingPayable: summary.outstandingPayable,
        productionOutstanding: summary.productionOutstanding,
        logisticsOutstanding: summary.logisticsOutstanding,
        supplierCreditOutstanding: summary.supplierCreditOutstanding,
        receivables: {
          total: Number(receivableTotals?._sum.originalAmount || 0),
          outstanding: Number(receivableTotals?._sum.remainingAmount || 0),
          documents: Number(receivableTotals?._count._all || 0),
          source: "ACCOUNTING_DOCUMENTS",
        },
      },
    });
  } catch (error) {
    return sendError(res, error, "getAdminManufacturerFinance");
  }
};

export const getAdminManufacturerFinancialTransactions = async (req, res) => {
  try {
    const { id: manufacturerId } = req.params;
    const pagination = getPagination(req.query);
    const manufacturer = await findManufacturer(manufacturerId, { id: true, name: true });
    if (!manufacturer) {
      return res.status(404).json({ success: false, message: "Manufacturer profile not found." });
    }

    const accountingParty = await prisma.accountingParty.findUnique({
      where: {
        partyType_sourceEntityId: {
          partyType: "MANUFACTURER",
          sourceEntityId: manufacturerId,
        },
      },
      select: { id: true },
    });
    const identityFilter = {
      OR: [
        { supplierId: manufacturerId },
        ...(accountingParty ? [{ accountingPartyId: accountingParty.id }] : []),
        { supplierName: manufacturer.name },
      ],
    };
    const where = { lines: { some: identityFilter } };
    const [entries, total] = await prisma.$transaction([
      prisma.journalEntry.findMany({
        where,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        include: {
          lines: {
            where: identityFilter,
            include: { account: { select: { accountCode: true, accountName: true } } },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);
    const transactions = entries.map((entry) => ({
      ...entry,
      lines: entry.lines.map((line) => ({
        ...line,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
    }));
    return res.json(paginatedResponse("transactions", transactions, pagination, total));
  } catch (error) {
    return sendError(res, error, "getAdminManufacturerFinancialTransactions");
  }
};
