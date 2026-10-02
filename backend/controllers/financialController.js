import { prisma } from "../config/db.js";
import {
  postFixedAssetPurchaseAccounting,
  postDepreciationAccounting,
  postLoanDisbursementAccounting,
  postLoanRepaymentAccounting,
  postShareIssuanceAccounting,
  postShareBuybackAccounting,
  postSupplierPaymentAccounting,
  postCustomerPaymentAccounting,
  postDirectExpenseAccounting,
  postNcmRemittanceAccounting,
} from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

const getPostedManufacturerPayable = async (manufacturerId, manufacturerName) => {
  const payableAccount = await prisma.account.findUnique({
    where: { accountCode: "2160" },
    select: { id: true },
  });

  if (!payableAccount) return { recognized: 0, paid: 0, outstanding: 0 };

  const lines = await prisma.journalLine.findMany({
    where: { accountId: payableAccount.id },
    select: {
      debit: true,
      credit: true,
      supplierId: true,
      supplierName: true,
      accountingParty: { select: { partyType: true, sourceEntityId: true } },
      journalEntry: { select: { sourceType: true, sourceId: true } },
    },
  });

  let recognized = 0;
  let paid = 0;
  const normalizedName = String(manufacturerName || "").trim().toLowerCase();
  const isManufacturerLine = (line) =>
    line.supplierId === manufacturerId ||
    (line.accountingParty?.partyType === "MANUFACTURER" && line.accountingParty.sourceEntityId === manufacturerId) ||
    String(line.supplierName || "").trim().toLowerCase() === normalizedName;

  for (const line of lines) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    const sourceType = line.journalEntry?.sourceType;

    if (["DELIVERY_SALE", "DELIVERY_RETURN"].includes(sourceType) && isManufacturerLine(line)) {
      recognized += credit - debit;
    }

    if (sourceType === "SUPPLIER_PAYMENT" && (
      isManufacturerLine(line) ||
      line.journalEntry?.sourceId === `MFG-COGS-${manufacturerId}`
    )) {
      paid += debit - credit;
    }
  }

  const outstanding = Math.max(0, Number((recognized - paid).toFixed(2)));
  return {
    recognized: Number(recognized.toFixed(2)),
    paid: Number(paid.toFixed(2)),
    outstanding,
  };
};

// Helper to get current Year-Month
const getCurrentYearMonth = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const parseOrderItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getDateWindow = (query) => {
  const rawRange = String(query?.range || "month").toLowerCase();
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  const setEndOfDay = (date) => {
    date.setHours(23, 59, 59, 999);
    return date;
  };

  if (rawRange === "day") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    end = setEndOfDay(new Date(now));
  } else if (rawRange === "week") {
    start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    end = setEndOfDay(new Date(now));
  } else if (rawRange === "quarter") {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (rawRange === "year") {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (rawRange === "custom") {
    const customStart = query?.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const customEnd = query?.endDate ? new Date(query.endDate) : new Date(now);
    start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
    end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

export const getManufacturerFinancialSummary = async (req, res) => {
  try {
    const manufactureIdFromToken = req.manufacturerId;
    const manufacturerId = manufactureIdFromToken || req.query?.manufacturerId || req.body?.manufacturerId;

    const { start, end } = getDateWindow(req.query);
    const startTs = BigInt(start.getTime());
    const endTs = BigInt(end.getTime());

    if (manufacturerId) {
      // 1. Single Manufacturer Scope (Manufacturer portal or Admin scoped filter)
      const [orders, manufacturer, inventoryRows, allProducts, mfgTransactions] = await Promise.all([
        prisma.order.findMany({
          where: {
            manufacturerId,
            date: { gte: startTs, lte: endTs },
          },
          orderBy: { date: "desc" },
        }),
        prisma.manufacturer.findUnique({
          where: { id: manufacturerId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            city: true,
            agreedCommissionRate: true,
            proposedCommissionRate: true,
            commissionStatus: true,
            commissionLastProposedBy: true,
            commissionHistory: true,
            commissionFinalizedAt: true,
            commissionLockUntil: true,
          },
        }),
        prisma.manufacturerInventory.findMany({
          where: { manufacturerId },
          select: { productId: true, agreedCostPrice: true, proposedCostPrice: true },
        }),
        prisma.product.findMany({
          select: { id: true, costPrice: true },
        }),
        prisma.cashTransaction.findMany({
          where: {
            OR: [
              { referenceId: manufacturerId },
              { partyName: manufacturerId },
            ],
            category: { in: ["SUPPLIER_PAYMENT", "SALES", "EXPENSE", "COD_REMITTANCE"] },
            date: { gte: start, lte: end },
          },
          include: {
            fromAccount: { select: { accountName: true, accountType: true } },
            toAccount: { select: { accountName: true, accountType: true } },
          },
          orderBy: { date: "desc" },
        }),
      ]);

      const inventoryMap = {};
      inventoryRows.forEach((entry) => {
        inventoryMap[entry.productId] = Number(entry.agreedCostPrice || entry.proposedCostPrice || 0);
      });

      const productCostMap = {};
      allProducts.forEach((product) => {
        productCostMap[product.id] = Number(product.costPrice || 0);
      });

      const commissionRate = Number(
        manufacturer?.agreedCommissionRate ?? manufacturer?.proposedCommissionRate ?? 12
      );

      let totalSales = 0;
      let totalCogs = 0;
      let totalPayable = 0;
      let totalReceivable = 0;
      let totalCommission = 0;
      let totalDelivered = 0;
      let totalReturned = 0;
      let itemsSold = 0;
      let itemsDelivered = 0;
      let itemsReturned = 0;

      const orderBreakdown = orders.map((order) => {
        const items = parseOrderItems(order.items);
        const orderQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
        const orderSales = Number(order.amount || 0);

        let orderCost = 0;
        items.forEach((item) => {
          const qty = Number(item.quantity || 1);
          const productId = item.productId || item._id || item.id;
          const customCost = inventoryMap[productId];
          const unitCost = customCost !== undefined && customCost > 0 ? customCost : (productCostMap[productId] || 0);
          orderCost += qty * unitCost;
        });
        orderCost = Number(orderCost.toFixed(2));

        const statusText = String(order.status || "").trim().toLowerCase();
        const isDelivered = statusText.includes("deliver") || order.fulfillmentStatus === "DELIVERED";
        const isReturned = statusText.includes("return") || statusText.includes("cancel");
        const isDirect = order.orderType === "DIRECT_MANUFACTURER" && ["PHONE_ORDER", "HUB_VISIT"].includes(order.directOrderType);

        const grossProfit = isDirect ? Math.max(0, orderSales - orderCost) : 0;
        const orderCommission = Number((grossProfit * (commissionRate / 100)).toFixed(2));
        const manufacturerReceivable = Number((orderCost + orderCommission).toFixed(2));
        const manufacturerPayable = isDirect ? Math.max(0, Number((orderSales - manufacturerReceivable).toFixed(2))) : 0;
        const payable = req.auth?.role === "ADMIN" ? manufacturerReceivable : manufacturerPayable;
        const receivable = req.auth?.role === "ADMIN" ? manufacturerPayable : manufacturerReceivable;

        totalSales += isDirect ? orderSales : 0;
        totalCogs += orderCost;
        totalPayable += payable;
        totalReceivable += receivable;
        totalCommission += orderCommission;
        itemsSold += orderQuantity;

        if (isDelivered) {
          itemsDelivered += orderQuantity;
          totalDelivered += 1;
        }
        if (isReturned) {
          itemsReturned += orderQuantity;
          totalReturned += 1;
        }

        return {
          id: order.id,
          manufacturerId,
          manufacturerName: manufacturer?.name || "Manufacturer",
          orderType: order.orderType,
          directOrderType: order.directOrderType || null,
          isDirect,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
          date: order.date ? Number(order.date) : null,
          ...(isDirect ? { amount: orderSales } : {}),
          quantity: orderQuantity,
          cogs: orderCost,
          payable,
          receivable,
          commission: orderCommission,
          netPosition: receivable - payable,
        };
      });

      let totalPaidToMfg = 0;
      let totalCollectedFromMfg = 0;
      const formattedTransactions = mfgTransactions.map((tx) => {
        const amt = Number(tx.amount || 0);
        if (tx.type === "OUTFLOW") totalPaidToMfg += amt;
        if (tx.type === "INFLOW") totalCollectedFromMfg += amt;
        return {
          id: tx.id,
          date: tx.date || tx.createdAt,
          amount: amt,
          type: tx.type,
          category: tx.category,
          partyName: tx.partyName,
          accountName: tx.fromAccount?.accountName || tx.toAccount?.accountName || "Treasury Account",
          accountType: tx.fromAccount?.accountType || tx.toAccount?.accountType || "BANK",
          description: tx.description,
          createdAt: tx.createdAt,
        };
      });

      const isAdminView = req.auth?.role === "ADMIN";
      const paidAgainstPayable = isAdminView ? totalPaidToMfg : totalCollectedFromMfg;
      const paidAgainstReceivable = isAdminView ? totalCollectedFromMfg : totalPaidToMfg;
      const remainingPayable = Math.max(0, Number((totalPayable - paidAgainstPayable).toFixed(2)));
      const remainingReceivable = Math.max(0, Number((totalReceivable - paidAgainstReceivable).toFixed(2)));
      const netPayable = Math.max(0, Number((remainingPayable - remainingReceivable).toFixed(2)));
      const netReceivable = Math.max(0, Number((remainingReceivable - remainingPayable).toFixed(2)));

      const singleSummary = {
        totalOrders: orders.length,
        totalSales: Number(totalSales.toFixed(2)),
        totalCogs: Number(totalCogs.toFixed(2)),
        payable: Number(totalPayable.toFixed(2)),
        paidAmount: Number(totalPaidToMfg.toFixed(2)),
        remainingPayable,
        receivable: Number(totalReceivable.toFixed(2)),
        collectedAmount: Number(totalCollectedFromMfg.toFixed(2)),
        remainingReceivable,
        netPayable,
        netReceivable,
        netSettlementDue: netPayable > 0 ? netPayable : -netReceivable,
        totalCommission: Number(totalCommission.toFixed(2)),
        itemsSold,
        itemsDelivered,
        itemsReturned,
        deliveredOrders: totalDelivered,
        returnedOrders: totalReturned,
        agreedCommissionRate: commissionRate,
      };

      return res.json({
        success: true,
        range: req.query?.range || "month",
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        data: {
          manufacturer: manufacturer || { id: manufacturerId },
          summary: singleSummary,
          manufacturers: [
            {
              id: manufacturer?.id || manufacturerId,
              name: manufacturer?.name || "Manufacturer",
              email: manufacturer?.email || "",
              phone: manufacturer?.phone || "",
              city: manufacturer?.city || "",
              ...singleSummary,
              orders: orderBreakdown,
            }
          ],
          orders: orderBreakdown,
          transactions: formattedTransactions,
        },
      });
    }

    // 2. Aggregate / System-wide Scope for Admin (All Manufacturers)
    const [orders, manufacturers, inventoryRows, allProducts, supplierPayments, apRecords] = await Promise.all([
      prisma.order.findMany({
        where: {
          date: { gte: startTs, lte: endTs },
        },
        orderBy: { date: "desc" },
      }),
      prisma.manufacturer.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          agreedCommissionRate: true,
          proposedCommissionRate: true,
          isActive: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.manufacturerInventory.findMany({
        select: { manufacturerId: true, productId: true, agreedCostPrice: true, proposedCostPrice: true },
      }),
      prisma.product.findMany({
        select: { id: true, costPrice: true },
      }),
      prisma.cashTransaction.findMany({
        where: { category: { in: ["SUPPLIER_PAYMENT", "SALES", "COD_REMITTANCE", "EXPENSE"] } },
        include: {
          fromAccount: { select: { accountName: true, accountType: true } },
          toAccount: { select: { accountName: true, accountType: true } },
        },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.accountPayable.findMany({
        where: { referenceType: "MANUFACTURER_COGS" },
        select: { referenceId: true, paidAmount: true },
      }),
    ]);

    // Compute payments made to each manufacturer
    const mfgPaidMap = {};
    supplierPayments.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      if (tx.referenceId && mfgPaidMap[tx.referenceId] !== undefined) {
        mfgPaidMap[tx.referenceId] += amt;
      } else if (tx.referenceId) {
        mfgPaidMap[tx.referenceId] = amt;
      }
      manufacturers.forEach((m) => {
        if (
          tx.referenceId === m.id ||
          tx.partyName?.toLowerCase() === m.name?.toLowerCase() ||
          tx.description?.toLowerCase().includes(m.name?.toLowerCase())
        ) {
          mfgPaidMap[m.id] = (mfgPaidMap[m.id] || 0) + (tx.referenceId === m.id ? 0 : amt);
        }
      });
    });

    apRecords.forEach((ap) => {
      if (ap.referenceId) {
        mfgPaidMap[ap.referenceId] = Math.max(mfgPaidMap[ap.referenceId] || 0, Number(ap.paidAmount || 0));
      }
    });

    const mfgMap = {};
    const mfgDetailsMap = {};
    manufacturers.forEach((m) => {
      mfgMap[m.id] = Number(m.agreedCommissionRate ?? m.proposedCommissionRate ?? 12);
      mfgDetailsMap[m.id] = m;
    });

    const inventoryMap = {};
    inventoryRows.forEach((entry) => {
      inventoryMap[`${entry.manufacturerId}_${entry.productId}`] = Number(entry.agreedCostPrice || entry.proposedCostPrice || 0);
    });

    const productCostMap = {};
    allProducts.forEach((product) => {
      productCostMap[product.id] = Number(product.costPrice || 0);
    });

    // Manufacturer grouped metrics dictionary
    const mfgGroups = {};
    manufacturers.forEach((m) => {
      mfgGroups[m.id] = {
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        city: m.city,
        agreedCommissionRate: mfgMap[m.id] || 12,
        totalOrders: 0,
        totalSales: 0,
        totalCogs: 0,
        payable: 0,
        paidAmount: Number((mfgPaidMap[m.id] || 0).toFixed(2)),
        remainingPayable: 0,
        receivable: 0,
        totalCommission: 0,
        itemsSold: 0,
        itemsDelivered: 0,
        itemsReturned: 0,
        deliveredOrders: 0,
        returnedOrders: 0,
        orders: [],
      };
    });

    let totalSales = 0;
    let totalCogs = 0;
    let totalPayable = 0;
    let totalReceivable = 0;
    let totalCommission = 0;
    let totalDelivered = 0;
    let totalReturned = 0;
    let itemsSold = 0;
    let itemsDelivered = 0;
    let itemsReturned = 0;

    const orderBreakdown = orders.map((order) => {
      const items = parseOrderItems(order.items);
      const orderQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
      const orderSales = Number(order.amount || 0);
      const orderMfgId = order.manufacturerId || items[0]?.manufacturerId;
      const commissionRate = orderMfgId ? (mfgMap[orderMfgId] ?? 12) : 12;

      let orderCost = 0;
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const productId = item.productId || item._id || item.id;
        const itemMfgId = item.manufacturerId || orderMfgId;
        const customCost = itemMfgId ? inventoryMap[`${itemMfgId}_${productId}`] : undefined;
        const unitCost = customCost !== undefined && customCost > 0 ? customCost : (productCostMap[productId] || 0);
        orderCost += qty * unitCost;
      });
      orderCost = Number(orderCost.toFixed(2));

      const statusText = String(order.status || "").trim().toLowerCase();
      const isDelivered = statusText.includes("deliver") || order.fulfillmentStatus === "DELIVERED";
      const isReturned = statusText.includes("return") || statusText.includes("cancel");
      const isDirect = order.orderType === "DIRECT_MANUFACTURER" && ["PHONE_ORDER", "HUB_VISIT"].includes(order.directOrderType);

      if (!orderMfgId || !mfgGroups[orderMfgId]) return null;

      const grossProfit = isDirect ? Math.max(0, orderSales - orderCost) : 0;
      const orderCommission = Number((grossProfit * (commissionRate / 100)).toFixed(2));
      const manufacturerReceivable = Number((orderCost + orderCommission).toFixed(2));
      const manufacturerPayable = isDirect ? Math.max(0, Number((orderSales - manufacturerReceivable).toFixed(2))) : 0;
      const payable = manufacturerReceivable;
      const receivable = manufacturerPayable;

      totalSales += isDirect ? orderSales : 0;
      totalCogs += orderCost;
      totalPayable += payable;
      totalReceivable += receivable;
      totalCommission += orderCommission;
      itemsSold += orderQuantity;

      if (isDelivered) {
        itemsDelivered += orderQuantity;
        totalDelivered += 1;
      }
      if (isReturned) {
        itemsReturned += orderQuantity;
        totalReturned += 1;
      }

      const orderItem = {
        id: order.id,
        manufacturerId: orderMfgId || null,
        manufacturerName: (orderMfgId && mfgDetailsMap[orderMfgId]?.name) || "Unassigned",
        orderType: order.orderType,
        directOrderType: order.directOrderType || null,
        isDirect,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        date: order.date ? Number(order.date) : null,
        ...(isDirect ? { amount: orderSales } : {}),
        quantity: orderQuantity,
        cogs: orderCost,
        payable,
        receivable,
        commission: orderCommission,
        netPosition: receivable - payable,
      };

      // Add to manufacturer group if assigned
      {
        const grp = mfgGroups[orderMfgId];
        grp.totalOrders += 1;
        grp.totalSales += isDirect ? orderSales : 0;
        grp.totalCogs += orderCost;
        grp.payable += payable;
        grp.receivable += receivable;
        grp.totalCommission += orderCommission;
        grp.itemsSold += orderQuantity;
        if (isDelivered) {
          grp.itemsDelivered += orderQuantity;
          grp.deliveredOrders += 1;
        }
        if (isReturned) {
          grp.itemsReturned += orderQuantity;
          grp.returnedOrders += 1;
        }
        grp.orders.push(orderItem);
      }

      return orderItem;
    }).filter(Boolean);

    let totalPaidMfg = 0;
    const manufacturersList = Object.values(mfgGroups).map((mfg) => {
      const remainingPayable = Math.max(0, Number((mfg.payable - (mfg.paidAmount || 0)).toFixed(2)));
      totalPaidMfg += Number(mfg.paidAmount || 0);
      return {
        ...mfg,
        totalSales: Number(mfg.totalSales.toFixed(2)),
        totalCogs: Number(mfg.totalCogs.toFixed(2)),
        payable: Number(mfg.payable.toFixed(2)),
        paidAmount: Number((mfg.paidAmount || 0).toFixed(2)),
        remainingPayable,
        receivable: Number(mfg.receivable.toFixed(2)),
        netPayable: Math.max(0, Number((remainingPayable - mfg.receivable).toFixed(2))),
        netReceivable: Math.max(0, Number((mfg.receivable - remainingPayable).toFixed(2))),
        totalCommission: Number(mfg.totalCommission.toFixed(2)),
      };
    });

    const remainingSummaryPayable = Math.max(0, Number((totalPayable - totalPaidMfg).toFixed(2)));

    return res.json({
      success: true,
      range: req.query?.range || "month",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      data: {
        manufacturer: { id: "ALL", name: "All Manufacturers" },
        summary: {
          totalOrders: orderBreakdown.length,
          totalSales: Number(totalSales.toFixed(2)),
          totalCogs: Number(totalCogs.toFixed(2)),
          payable: Number(totalPayable.toFixed(2)),
          paidAmount: Number(totalPaidMfg.toFixed(2)),
          remainingPayable: remainingSummaryPayable,
          receivable: Number(totalReceivable.toFixed(2)),
          netPayable: Math.max(0, Number((remainingSummaryPayable - totalReceivable).toFixed(2))),
          netReceivable: Math.max(0, Number((totalReceivable - remainingSummaryPayable).toFixed(2))),
          totalCommission: Number(totalCommission.toFixed(2)),
          itemsSold,
          itemsDelivered,
          itemsReturned,
          deliveredOrders: totalDelivered,
          returnedOrders: totalReturned,
          agreedCommissionRate: 12,
        },
        manufacturers: manufacturersList,
        orders: orderBreakdown,
        transactions: (supplierPayments || []).map((tx) => ({
          id: tx.id,
          date: tx.date || tx.createdAt,
          amount: Number(tx.amount || 0),
          type: tx.type,
          category: tx.category,
          partyName: tx.partyName,
          accountName: tx.fromAccount?.accountName || tx.toAccount?.accountName || "Treasury Account",
          accountType: tx.fromAccount?.accountType || tx.toAccount?.accountType || "BANK",
          description: tx.description,
          createdAt: tx.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("getManufacturerFinancialSummary error:", error);
    return res.status(500).json({ success: false, message: error.message || "Unable to load manufacturer financial summary." });
  }
};



// ==========================================
// 1. EXECUTIVE FINANCIAL ANALYTICS & DASHBOARD
// ==========================================
export const getFinancialAnalyticsDashboard = async (req, res) => {
  try {
    const requestedMonth = req.query.month || getCurrentYearMonth();
    const [year, month] = requestedMonth.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const startTimestamp = BigInt(startDate.getTime());
    const endTimestamp = BigInt(endDate.getTime());

    // Fetch all financial data in parallel
    const [
      orders,
      products,
      operatingExpensesList,
      accounts,
      fixedAssets,
      partners,
      liabilities,
      customerReturns,
      supplierReturns,
      payables,
      receivables,
    ] = await Promise.all([
      prisma.order.findMany({
        where: {
          date: { gte: startTimestamp, lte: endTimestamp },
          status: { notIn: ["Cancelled"] },
        },
      }),
      prisma.product.findMany(),
      prisma.operatingExpense.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
        },
      }),
      prisma.financialAccount.findMany({ where: { status: "ACTIVE" } }),
      prisma.fixedAsset.findMany(),
      prisma.partnerEquity.findMany({ where: { status: "ACTIVE" } }),
      prisma.investorLiability.findMany({ where: { status: "ACTIVE" } }),
      prisma.customerReturn.findMany({
        where: {
          returnDate: { gte: startDate, lte: endDate },
          refundStatus: "COMPLETED",
        },
      }),
      prisma.supplierReturn.findMany({
        where: {
          returnDate: { gte: startDate, lte: endDate },
          status: "COMPLETED",
        },
      }),
      prisma.accountPayable.findMany({
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      }),
      prisma.accountReceivable.findMany({
        where: { status: { in: ["UNPAID", "PARTIALLY_RECEIVED"] } },
      }),
    ]);

    // Revenue calculations (Gross MRP, VAT Breakdown)
    const vatRate = 0.13; // 13% Nepal VAT
    let grossPeriodRevenueIncVat = 0;
    let periodDirectCOGS = 0; // VAT inclusive Manufacturer COGS
    let unitsSoldPeriod = 0;

    // Build Product Cost lookup
    const productCostMap = {};
    products.forEach((p) => {
      productCostMap[p.id] = Number(p.costPrice || 0);
    });

    orders.forEach((ord) => {
      grossPeriodRevenueIncVat += Number(ord.amount || 0);
      let items = [];
      try {
        items = typeof ord.items === "string" ? JSON.parse(ord.items) : (ord.items || []);
      } catch {
        items = [];
      }
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        unitsSoldPeriod += qty;
        const pId = item.productId || item._id || item.id;
        const unitCost = productCostMap[pId] || 0;
        periodDirectCOGS += unitCost * qty;
      });
    });

    // Customer Returns adjustments in period
    const totalCustomerRefunds = customerReturns.reduce((acc, r) => acc + Number(r.totalRefundAmount || 0), 0);
    const netRevenueIncVat = Math.max(0, grossPeriodRevenueIncVat - totalCustomerRefunds);
    
    // Net Taxable Revenue (Net of 13% embedded VAT)
    const taxableRevenue = Number((netRevenueIncVat / (1 + vatRate)).toFixed(2));
    const outputVatCollected = Number((netRevenueIncVat - taxableRevenue).toFixed(2));

    // Manufacturer COGS is 13% VAT Inclusive
    const taxableDirectCOGS = Number((periodDirectCOGS / (1 + vatRate)).toFixed(2));
    const cogsInputVatClaimable = Number((periodDirectCOGS - taxableDirectCOGS).toFixed(2));

    // Categorized Operating Expenses
    let marketingSpend = 0;
    let officeRent = 0;
    let electricity = 0;
    let salaries = 0;
    let utilities = 0;
    let miscExpenses = 0;
    let maintenance = 0;
    let softwareTools = 0;
    let totalPackagingExpense = 0;
    let operatingExpenseVatClaimable = 0;

    operatingExpensesList.forEach((exp) => {
      const amt = Number(exp.amount || 0);
      const vat = Number(exp.vatAmount || 0);
      const cat = (exp.category || "MISCELLANEOUS").toUpperCase();

      if (cat === "MARKETING") marketingSpend += amt;
      else if (cat === "RENT") officeRent += amt;
      else if (cat === "ELECTRICITY") electricity += amt;
      else if (cat === "SALARIES") salaries += amt;
      else if (cat === "UTILITIES") utilities += amt;
      else if (cat === "MAINTENANCE") maintenance += amt;
      else miscExpenses += amt;

      if (exp.isVatBill) {
        operatingExpenseVatClaimable += vat;
      }
    });

    const totalFixedOverheads = officeRent + electricity + utilities + salaries + miscExpenses + maintenance;
    const totalOperatingExpenses = totalFixedOverheads + marketingSpend;
    const totalVariableCosts = taxableDirectCOGS + marketingSpend;

    // Monthly Asset Depreciation
    let monthlyDepreciation = 0;
    let damagedAssetLoss = 0;
    fixedAssets.forEach((asset) => {
      if (asset.status === "ACTIVE") {
        const annualRate = Number(asset.depreciationRate || 25) / 100;
        const monthlyRate = annualRate / 12;
        const bookVal = Number(asset.currentBookValue || asset.purchaseCost || 0);
        monthlyDepreciation += Number((bookVal * monthlyRate).toFixed(2));
      } else if (asset.status === "DAMAGED" || asset.status === "WRITTEN_OFF") {
        damagedAssetLoss += Number(asset.scrapLossAmount || asset.currentBookValue || 0);
      }
    });

    // Profitability Metrics
    // Gross Profit = Net Taxable Revenue - Net Taxable COGS
    const grossProfit = Number((taxableRevenue - taxableDirectCOGS).toFixed(2));
    const grossProfitMargin = taxableRevenue > 0 ? Number(((grossProfit / taxableRevenue) * 100).toFixed(1)) : 0;
    
    // Net Operating Profit (EBITDA) = Gross Profit - Operating Expenses
    const operatingProfitEBITDA = Number((grossProfit - totalOperatingExpenses).toFixed(2));
    const netProfitBeforeTax = Number((operatingProfitEBITDA - monthlyDepreciation - damagedAssetLoss).toFixed(2));
    const netProfitMargin = taxableRevenue > 0 ? Number(((netProfitBeforeTax / taxableRevenue) * 100).toFixed(1)) : 0;

    // Break-even Analysis (BEP)
    const totalContributionMargin = Math.max(0, taxableRevenue - totalVariableCosts);
    const contributionMarginRatio = taxableRevenue > 0 ? (totalContributionMargin / taxableRevenue) : 0.4;
    const breakEvenRevenue = contributionMarginRatio > 0 ? Number((totalFixedOverheads / contributionMarginRatio).toFixed(2)) : 0;
    const avgRevenuePerUnit = unitsSoldPeriod > 0 ? (taxableRevenue / unitsSoldPeriod) : 1000;
    const avgVariableCostPerUnit = unitsSoldPeriod > 0 ? (totalVariableCosts / unitsSoldPeriod) : 600;
    const unitContributionMargin = Math.max(1, avgRevenuePerUnit - avgVariableCostPerUnit);
    const breakEvenUnits = Math.ceil(totalFixedOverheads / unitContributionMargin);

    // Live Assets & Liquid Cash Aggregates
    const totalLiquidCash = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);
    const totalFixedAssetBookValue = fixedAssets
      .filter((a) => a.status === "ACTIVE")
      .reduce((acc, a) => acc + Number(a.currentBookValue || 0), 0);
    
    // Inventory Valuation at Cost Price
    const inventoryValuationCost = products.reduce((acc, p) => acc + (Number(p.costPrice || 0) * Number(p.stockQuantity || 0)), 0);

    // Outstanding Accounts Receivable (Money owed to business)
    const totalOutstandingReceivables = receivables.reduce((acc, r) => acc + Number(r.remainingBalance || 0), 0);

    // Total Live Assets = Liquid Cash + Accounts Receivable + Inventory + Net Fixed Assets
    const totalLiveAssets = Number((totalLiquidCash + totalOutstandingReceivables + inventoryValuationCost + totalFixedAssetBookValue).toFixed(2));

    // Outstanding Liabilities = Investor/Loans Debt + Accounts Payable (Money business owes)
    const totalOutstandingLoans = liabilities.reduce((acc, l) => acc + Number(l.outstandingBalance || 0), 0);
    const totalAccountsPayable = payables.reduce((acc, p) => acc + Number(p.remainingBalance || 0), 0);
    const totalOutstandingLiabilities = Number((totalOutstandingLoans + totalAccountsPayable).toFixed(2));

    // Working Capital = Current Assets (Cash + A/R + Inventory) - Current Liabilities (A/P + Short-term Debt)
    const currentAssets = Number((totalLiquidCash + totalOutstandingReceivables + inventoryValuationCost).toFixed(2));
    const currentLiabilities = totalOutstandingLiabilities;
    const netWorkingCapital = Number((currentAssets - currentLiabilities).toFixed(2));

    // Partner Equity
    const totalPartnerCapital = partners.reduce((acc, p) => acc + Number(p.currentCapital || 0), 0);
    const netBusinessEquity = Number((totalLiveAssets - totalOutstandingLiabilities).toFixed(2));

    // Return on Investment (ROI)
    const totalInvestedCapital = Math.max(10000, totalPartnerCapital + totalOutstandingLiabilities);
    const annualizedNetProfit = netProfitBeforeTax * 12;
    const roiPercentage = Number(((annualizedNetProfit / totalInvestedCapital) * 100).toFixed(1));

    // Solvency / Health Score (0 - 100)
    let healthScore = 75;
    if (netProfitMargin >= 20) healthScore += 15;
    else if (netProfitMargin < 0) healthScore -= 25;
    if (totalLiquidCash >= totalAccountsPayable) healthScore += 10;
    else healthScore -= 10;
    if (totalOutstandingLiabilities > totalLiveAssets * 0.7) healthScore -= 15;
    healthScore = Math.max(10, Math.min(100, healthScore));

    res.json({
      success: true,
      data: {
        activeMonth: requestedMonth,
        revenue: {
          grossRevenueIncVat: grossPeriodRevenueIncVat,
          customerRefunds: totalCustomerRefunds,
          netRevenueIncVat,
          taxableRevenue,
          outputVatCollected,
          unitsSold: unitsSoldPeriod,
        },
        costsAndExpenses: {
          directCOGS: periodDirectCOGS,
          fixedOverheads: totalFixedOverheads,
          marketingSpend,
          salaries,
          officeRent,
          utilities,
          softwareTools,
          miscExpenses,
          packagingExpense: totalPackagingExpense,
          totalOperatingExpenses,
          monthlyDepreciation,
          damagedAssetLoss,
        },
        profitability: {
          grossProfit,
          grossProfitMargin,
          operatingProfitEBITDA,
          netProfitBeforeTax,
          netProfitMargin,
        },
        breakEven: {
          breakEvenRevenue,
          breakEvenUnits,
          contributionMarginRatio: Number((contributionMarginRatio * 100).toFixed(1)),
          fixedCosts: totalFixedOverheads,
          currentRevenuePacingPercent: breakEvenRevenue > 0 ? Number(((taxableRevenue / breakEvenRevenue) * 100).toFixed(1)) : 100,
        },
        balanceSheetSnapshot: {
          liquidCash: totalLiquidCash,
          accountsReceivable: totalOutstandingReceivables,
          inventoryValuation: inventoryValuationCost,
          fixedAssetsBookValue: totalFixedAssetBookValue,
          totalAssets: totalLiveAssets,
          accountsPayable: totalAccountsPayable,
          loansAndFinancing: totalOutstandingLoans,
          totalLiabilities: totalOutstandingLiabilities,
          netWorkingCapital,
          netEquity: netBusinessEquity,
          totalPartnerCapital,
        },
        analytics: {
          roiPercentage,
          totalInvestedCapital,
          healthScore,
          currency: "Rs ",
        },
      },
    });
  } catch (error) {
    console.error("Financial Analytics Dashboard Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. TREASURY & LIQUID CASH MANAGEMENT
// ==========================================
export const getTreasuryAccounts = async (req, res) => {
  try {
    const accounts = await prisma.financialAccount.findMany({
      include: {
        inflows: { take: 10, orderBy: { date: "desc" } },
        outflows: { take: 10, orderBy: { date: "desc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ success: true, accounts });
  } catch (error) {
    console.error("Get Treasury Accounts Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createTreasuryAccount = async (req, res) => {
  try {
    const { accountName, accountType, accountNumber, bankName, initialBalance } = req.body;
    if (!accountName) {
      return res.json({ success: false, message: "Account Name is required" });
    }

    const created = await prisma.financialAccount.create({
      data: {
        accountName: accountName.trim(),
        accountType: accountType || "BANK",
        accountNumber: accountNumber || "",
        bankName: bankName || "",
        currentBalance: Number(initialBalance || 0),
      },
    });

    if (Number(initialBalance || 0) > 0) {
      await prisma.cashTransaction.create({
        data: {
          amount: Number(initialBalance),
          type: "INFLOW",
          toAccountId: created.id,
          category: "CAPITAL_INJECTION",
          description: `Opening Balance for ${created.accountName}`,
        },
      });
    }

    res.json({ success: true, message: "Account created successfully", account: created });
  } catch (error) {
    console.error("Create Treasury Account Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const recordCashTransfer = async (req, res) => {
  try {
    const { fromAccountId, toAccountId, amount, category, description, type } = req.body;
    const transferAmount = Number(amount || 0);

    if (transferAmount <= 0) {
      return res.json({ success: false, message: "A positive transaction amount is required" });
    }

    // 1. Inter-Account Transfer
    if (type === "TRANSFER" && fromAccountId && toAccountId) {
      if (fromAccountId === toAccountId) {
        return res.json({ success: false, message: "Source and destination accounts must be different" });
      }

      const fromAccount = await prisma.financialAccount.findUnique({ where: { id: fromAccountId } });
      if (!fromAccount) {
        return res.json({ success: false, message: "Source account not found" });
      }

      // CRITICAL CHECK: Overdraft protection
      if (fromAccount.currentBalance < transferAmount) {
        return res.json({
          success: false,
          message: `Insufficient funds in ${fromAccount.accountName}. Available: Rs ${fromAccount.currentBalance.toLocaleString()}, Requested: Rs ${transferAmount.toLocaleString()}.`,
        });
      }

      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: fromAccountId },
          data: { currentBalance: { decrement: transferAmount } },
        }),
        prisma.financialAccount.update({
          where: { id: toAccountId },
          data: { currentBalance: { increment: transferAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: transferAmount,
            type: "TRANSFER",
            fromAccountId,
            toAccountId,
            category: "INTERNAL_TRANSFER",
            description: description || "Internal account transfer",
          },
        }),
      ]);

      return res.json({ success: true, message: "Transfer completed successfully" });
    }

    // 2. Direct Inflow
    if (type === "INFLOW" && toAccountId) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: toAccountId },
          data: { currentBalance: { increment: transferAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: transferAmount,
            type: "INFLOW",
            toAccountId,
            category: category || "SALES",
            description: description || "Direct cash deposit",
          },
        }),
      ]);
      return res.json({ success: true, message: "Inflow recorded successfully" });
    }

    // 3. Direct Outflow
    if (type === "OUTFLOW" && fromAccountId) {
      const { partyName, payeeName, invoiceNumber } = req.body;
      const finalPayeeName = (partyName || payeeName || "Vendor / Payee").trim();
      const fromAccount = await prisma.financialAccount.findUnique({ where: { id: fromAccountId } });
      if (!fromAccount) {
        return res.json({ success: false, message: "Source account not found" });
      }

      // CRITICAL CHECK: Overdraft protection / Capital Solvency
      if (fromAccount.currentBalance < transferAmount) {
        return res.json({
          success: false,
          message: `Capital Solvency Constraint: Cannot deduct Rs ${transferAmount.toLocaleString()} from ${fromAccount.accountName}. Available liquid balance is Rs ${fromAccount.currentBalance.toLocaleString()} (Shortfall: Rs ${(transferAmount - fromAccount.currentBalance).toLocaleString()}). You cannot execute cash disbursements beyond available liquid capital. You can record this expense as an Accounts Payable (Liability) to pay later when funds are available.`,
        });
      }

      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: fromAccountId },
          data: { currentBalance: { decrement: transferAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: transferAmount,
            type: "OUTFLOW",
            fromAccountId,
            category: category || "EXPENSE",
            partyName: finalPayeeName,
            invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
            description: description || `Payment to ${finalPayeeName}`,
          },
        }),
      ]);
      // Post Direct Outflow Expense to Double-Entry General Ledger
      postDirectExpenseAccounting({
        amount: transferAmount,
        category: category || "EXPENSE",
        description: description || `Payment to ${finalPayeeName}`,
        payeeName: finalPayeeName,
        fromAccountId,
      }).catch((glErr) => {
        console.error("General Ledger direct expense posting error:", glErr);
      });

      return res.json({ success: true, message: `Outflow payment of Rs ${transferAmount.toLocaleString()} to ${finalPayeeName} recorded successfully` });
    }

    res.json({ success: false, message: "Invalid transaction parameters" });
  } catch (error) {
    console.error("Record Cash Transfer Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getCashTransactions = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const [transactions, total] = await prisma.$transaction([
      prisma.cashTransaction.findMany({
      include: {
        fromAccount: { select: { accountName: true, accountType: true } },
        toAccount: { select: { accountName: true, accountType: true } },
      },
      orderBy: { date: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      }),
      prisma.cashTransaction.count(),
    ]);
    res.json(paginatedResponse("transactions", transactions, pagination, total));
  } catch (error) {
    console.error("Get Cash Transactions Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. FIXED ASSETS & DEPRECIATION ENGINE
// ==========================================
export const getFixedAssets = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const [assets, total] = await prisma.$transaction([
      prisma.fixedAsset.findMany({ orderBy: { purchaseDate: "desc" }, skip: pagination.skip, take: pagination.limit }),
      prisma.fixedAsset.count(),
    ]);
    res.json(paginatedResponse("assets", assets, pagination, total));
  } catch (error) {
    console.error("Get Fixed Assets Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createFixedAsset = async (req, res) => {
  try {
    const {
      assetName,
      category,
      purchaseDate,
      purchaseCost,
      salvageValue,
      depreciationRate,
      depreciationMethod,
      usefulLifeMonths,
      paidFromAccountId,
      settlementType = "CREDIT_PAYABLE", // FULL_CASH, CREDIT_PAYABLE, PARTIAL
      recordAsPayable = false,
      upfrontPaidAmount,
      vendorName,
      invoiceNumber,
      dueDate,
    } = req.body;

    if (!assetName || !purchaseCost) {
      return res.json({ success: false, message: "Asset Name and Purchase Cost are required" });
    }

    const cost = Number(purchaseCost);
    if (cost <= 0) {
      return res.json({ success: false, message: "Purchase cost must be greater than zero" });
    }

    const finalVendorName = (vendorName && vendorName.trim()) || "Asset Vendor";

    // Determine Settlement Breakdown (Cash vs Payable)
    let paidAmount = 0;
    let payableAmount = 0;

    if (settlementType === "FULL_CASH" || (paidFromAccountId && !recordAsPayable && settlementType !== "PARTIAL" && settlementType !== "CREDIT_PAYABLE")) {
      paidAmount = cost;
      payableAmount = 0;
    } else if (settlementType === "PARTIAL") {
      paidAmount = Math.min(cost, Math.max(0, Number(upfrontPaidAmount || 0)));
      payableAmount = Number((cost - paidAmount).toFixed(2));
    } else {
      // CREDIT_PAYABLE
      paidAmount = 0;
      payableAmount = cost;
    }

    // Capital Solvency Verification on the upfront cash portion
    let payingAccount = null;
    if (paidAmount > 0) {
      if (!paidFromAccountId) {
        return res.json({
          success: false,
          message: "Please select a Treasury / Bank account to disburse the upfront cash payment.",
        });
      }
      payingAccount = await prisma.financialAccount.findUnique({ where: { id: paidFromAccountId } });
      if (!payingAccount) {
        return res.json({ success: false, message: "Selected payment account not found" });
      }
      if (payingAccount.currentBalance < paidAmount) {
        return res.json({
          success: false,
          message: `Capital Solvency Constraint: Cannot pay Rs ${paidAmount.toLocaleString()} from ${payingAccount.accountName}. Available liquid balance is Rs ${payingAccount.currentBalance.toLocaleString()} (Shortfall: Rs ${(paidAmount - payingAccount.currentBalance).toLocaleString()}). Select 'Purchase on Credit / Record as Payable' or reduce the upfront payment amount.`,
        });
      }
    }

    const tag = `AST-${Date.now().toString().slice(-6)}`;

    // Default rates per Nepal Tax Slabs
    let rate = Number(depreciationRate);
    if (!rate || rate <= 0) {
      if (category === "COMPUTERS_IT" || category === "FURNITURE_FIXTURES") rate = 25;
      else if (category === "VEHICLES") rate = 20;
      else if (category === "MACHINERY_EQUIPMENT") rate = 15;
      else rate = 25;
    }

    // 1. Create the Fixed Asset
    const asset = await prisma.fixedAsset.create({
      data: {
        assetName: assetName.trim(),
        assetTag: tag,
        category: category || "COMPUTERS_IT",
        vendorName: finalVendorName,
        invoiceNumber: invoiceNumber ? invoiceNumber.trim() : "",
        purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
        purchaseCost: cost,
        salvageValue: Number(salvageValue || 0),
        depreciationRate: rate,
        depreciationMethod: depreciationMethod || "WRITTEN_DOWN_VALUE_SLAB",
        usefulLifeMonths: Number(usefulLifeMonths || 60),
        accumulatedDepreciation: 0,
        currentBookValue: cost,
        paidFromAccountId: paidAmount > 0 ? paidFromAccountId : null,
        paidAmount,
        payableAmount,
        status: "ACTIVE",
      },
    });

    // 2. Handle Upfront Cash Deduction
    if (paidAmount > 0 && payingAccount) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: paidFromAccountId },
          data: { currentBalance: { decrement: paidAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: paidAmount,
            type: "OUTFLOW",
            fromAccountId: paidFromAccountId,
            category: "ASSET_PURCHASE",
            partyName: finalVendorName,
            invoiceNumber: invoiceNumber || "",
            referenceId: asset.id,
            description: `Asset Purchase Upfront Payment: ${asset.assetName} (${tag}) to ${finalVendorName}`,
          },
        }),
      ]);
    }

    // 3. Handle Remaining Payable Liability Record
    let payableRecord = null;
    if (payableAmount > 0) {
      payableRecord = await prisma.accountPayable.create({
        data: {
          title: `Asset Purchase: ${asset.assetName} (${tag})`,
          payeeName: finalVendorName,
          category: "ASSET_PURCHASE",
          referenceType: "FIXED_ASSET",
          referenceId: asset.id,
          totalAmount: payableAmount,
          paidAmount: 0,
          remainingBalance: payableAmount,
          dueDate: dueDate ? new Date(dueDate) : null,
          invoiceNumber: invoiceNumber || "",
          status: "UNPAID",
          priority: "MEDIUM",
          notes: `Asset ${asset.assetName} (${tag}) acquired with Rs ${payableAmount.toLocaleString()} credit balance owed to ${finalVendorName}. Settle from Liquid Treasury when funds are available.`,
        },
      });

      await prisma.fixedAsset.update({
        where: { id: asset.id },
        data: { payableId: payableRecord.id },
      });
    }

    // Post Fixed Asset Acquisition to Double-Entry General Ledger
    postFixedAssetPurchaseAccounting({
      ...asset,
      paidAmount,
      payableAmount,
      vendorName: finalVendorName,
    }).catch((glErr) => {
      console.error("General Ledger fixed asset posting error:", glErr);
    });

    res.json({
      success: true,
      message:
        paidAmount > 0 && payableAmount > 0
          ? `Fixed asset ${asset.assetName} acquired: Rs ${paidAmount.toLocaleString()} paid from ${payingAccount?.accountName || "treasury"} and Rs ${payableAmount.toLocaleString()} registered under Accounts Payable to ${finalVendorName}.`
          : paidAmount > 0
          ? `Fixed asset ${asset.assetName} fully purchased (Rs ${paidAmount.toLocaleString()}) from ${payingAccount?.accountName || "treasury"}.`
          : `Fixed asset ${asset.assetName} recorded and registered under Accounts Payable (Rs ${payableAmount.toLocaleString()}) to ${finalVendorName}.`,
      asset,
      payable: payableRecord,
    });
  } catch (error) {
    console.error("Create Fixed Asset Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 3b. DIRECT OPERATING EXPENSE BOOKING (CASH / PAYABLE / PARTIAL)
// ==========================================
export const recordOperatingExpense = async (req, res) => {
  try {
    const {
      title,
      category = "OPERATING_EXPENSE", // SALARIES, RENT, UTILITIES, MARKETING, SOFTWARE, MISC
      amount,
      payeeName,
      invoiceNumber,
      paymentMethod = "FULL_CASH", // FULL_CASH, CREDIT_PAYABLE, PARTIAL
      paidFromAccountId,
      upfrontPaidAmount,
      dueDate,
      notes,
    } = req.body;

    const totalCost = Number(amount || 0);
    if (!title || totalCost <= 0) {
      return res.json({ success: false, message: "Expense title and a positive amount are required." });
    }

    const finalPayee = (payeeName && payeeName.trim()) || "Vendor / Service Provider";

    let paidAmt = 0;
    let payableAmt = 0;

    if (paymentMethod === "FULL_CASH") {
      paidAmt = totalCost;
      payableAmt = 0;
    } else if (paymentMethod === "PARTIAL") {
      paidAmt = Math.min(totalCost, Math.max(0, Number(upfrontPaidAmount || 0)));
      payableAmt = Number((totalCost - paidAmt).toFixed(2));
    } else {
      // CREDIT_PAYABLE
      paidAmt = 0;
      payableAmt = totalCost;
    }

    // Solvency Check on Cash Portion
    let payingAccount = null;
    if (paidAmt > 0) {
      if (!paidFromAccountId) {
        return res.json({ success: false, message: "Please select a Treasury / Bank account to disburse the cash payment." });
      }
      payingAccount = await prisma.financialAccount.findUnique({ where: { id: paidFromAccountId } });
      if (!payingAccount) {
        return res.json({ success: false, message: "Selected payment account not found" });
      }
      if (payingAccount.currentBalance < paidAmt) {
        return res.json({
          success: false,
          message: `Capital Solvency Constraint: Cannot pay Rs ${paidAmt.toLocaleString()} from ${payingAccount.accountName}. Available liquid balance is Rs ${payingAccount.currentBalance.toLocaleString()} (Shortfall: Rs ${(paidAmt - payingAccount.currentBalance).toLocaleString()}). Please record as Accounts Payable (on credit) or reduce the upfront payment.`,
        });
      }
    }

    const expenseRefId = `EXP-${Date.now().toString().slice(-6)}`;

    // 1. Cash Deduction
    if (paidAmt > 0 && payingAccount) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: paidFromAccountId },
          data: { currentBalance: { decrement: paidAmt } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: paidAmt,
            type: "OUTFLOW",
            fromAccountId: paidFromAccountId,
            category: "EXPENSE",
            partyName: finalPayee,
            invoiceNumber: invoiceNumber || "",
            referenceId: expenseRefId,
            description: `${title} paid to ${finalPayee}`,
          },
        }),
      ]);
    }

    // 2. Payable Liability Record
    let payableRecord = null;
    if (payableAmt > 0) {
      payableRecord = await prisma.accountPayable.create({
        data: {
          title: `${title} (${finalPayee})`,
          payeeName: finalPayee,
          category: "OPERATING_EXPENSE",
          referenceType: "EXPENSE",
          referenceId: expenseRefId,
          totalAmount: payableAmt,
          paidAmount: 0,
          remainingBalance: payableAmt,
          dueDate: dueDate ? new Date(dueDate) : null,
          invoiceNumber: invoiceNumber || "",
          priority: "MEDIUM",
          status: "UNPAID",
          notes: notes || `Operating expense owed to ${finalPayee}. Total expense Rs ${totalCost.toLocaleString()}, upfront paid Rs ${paidAmt.toLocaleString()}, remaining payable Rs ${payableAmt.toLocaleString()}.`,
        },
      });
    }

    // 3. Post to General Ledger
    postDirectExpenseAccounting({
      expenseId: expenseRefId,
      category,
      title,
      amount: totalCost,
      fromAccountId: paidAmt > 0 ? paidFromAccountId : null,
      isPayable: payableAmt > 0,
      payeeName: finalPayee,
    }).catch((glErr) => {
      console.error("General Ledger operating expense posting error:", glErr);
    });

    res.json({
      success: true,
      message:
        paidAmt > 0 && payableAmt > 0
          ? `Expense recorded: Rs ${paidAmt.toLocaleString()} paid from ${payingAccount?.accountName || "treasury"} and Rs ${payableAmt.toLocaleString()} registered under Accounts Payable to ${finalPayee}.`
          : paidAmt > 0
          ? `Expense fully paid (Rs ${paidAmt.toLocaleString()}) from ${payingAccount?.accountName || "treasury"} to ${finalPayee}.`
          : `Expense registered under Accounts Payable (Rs ${payableAmt.toLocaleString()}) to ${finalPayee}.`,
      payable: payableRecord,
    });
  } catch (error) {
    console.error("Record Operating Expense Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const runDepreciationBatch = async (req, res) => {
  try {
    const { monthsCount = 1 } = req.body;
    const assets = await prisma.fixedAsset.findMany({ where: { status: "ACTIVE" } });
    
    let totalDepreciated = 0;
    const updatedAssets = [];

    for (const asset of assets) {
      const annualRate = Number(asset.depreciationRate || 25) / 100;
      const currentBook = Number(asset.currentBookValue);
      const salvage = Number(asset.salvageValue || 0);

      if (currentBook <= salvage) continue;

      let depAmount = 0;
      if (asset.depreciationMethod === "STRAIGHT_LINE") {
        const monthlyDep = (Number(asset.purchaseCost) - salvage) / Math.max(1, Number(asset.usefulLifeMonths || 60));
        depAmount = monthlyDep * Number(monthsCount);
      } else {
        const monthlyRate = annualRate / 12;
        depAmount = currentBook * monthlyRate * Number(monthsCount);
      }

      depAmount = Math.min(depAmount, currentBook - salvage);
      depAmount = Number(depAmount.toFixed(2));

      const newBookValue = Number((currentBook - depAmount).toFixed(2));
      const newAccDep = Number((Number(asset.accumulatedDepreciation) + depAmount).toFixed(2));

      const updated = await prisma.fixedAsset.update({
        where: { id: asset.id },
        data: {
          currentBookValue: newBookValue,
          accumulatedDepreciation: newAccDep,
        },
      });

      totalDepreciated += depAmount;
      updatedAssets.push(updated);
    }

    // Post Depreciation Batch to Double-Entry General Ledger
    if (totalDepreciated > 0) {
      postDepreciationAccounting({
        totalDepreciation: totalDepreciated,
        count: updatedAssets.length,
        date: new Date(),
      }).catch((glErr) => {
        console.error("General Ledger depreciation posting error:", glErr);
      });
    }

    res.json({
      success: true,
      message: `Depreciation executed for ${updatedAssets.length} assets`,
      totalDepreciated: Number(totalDepreciated.toFixed(2)),
    });
  } catch (error) {
    console.error("Run Depreciation Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const recordAssetDamageOrDisposal = async (req, res) => {
  try {
    const { assetId, status, damageNotes, disposalAmount, depositAccountId } = req.body;
    const asset = await prisma.fixedAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      return res.json({ success: false, message: "Asset not found" });
    }

    const currentBook = Number(asset.currentBookValue);
    const recoveredAmount = Number(disposalAmount || 0);
    const scrapLoss = Math.max(0, currentBook - recoveredAmount);

    const updated = await prisma.fixedAsset.update({
      where: { id: assetId },
      data: {
        status: status || "DAMAGED",
        damageNotes: damageNotes || "Damaged/Disposed",
        disposalDate: new Date(),
        disposalAmount: recoveredAmount,
        scrapLossAmount: scrapLoss,
        currentBookValue: 0,
      },
    });

    // If salvage cash was recovered, deposit into treasury
    if (recoveredAmount > 0 && depositAccountId) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: depositAccountId },
          data: { currentBalance: { increment: recoveredAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: recoveredAmount,
            type: "INFLOW",
            toAccountId: depositAccountId,
            category: "CAPITAL_INJECTION",
            referenceId: asset.id,
            description: `Salvage Recovery for ${asset.assetName}`,
          },
        }),
      ]);
    }

    res.json({ success: true, message: `Asset marked as ${status}`, asset: updated, scrapLoss });
  } catch (error) {
    console.error("Asset Damage/Disposal Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// UNIVERSAL CAPITAL SOLVENCY HELPER
// ==========================================
export const checkAccountSolvency = async (accountId, requiredAmount, operationName = "Transaction") => {
  if (!accountId) return { allowed: true, account: null };
  const account = await prisma.financialAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return { allowed: false, error: `Selected payment account not found for ${operationName}` };
  }
  const currentBalance = Number(account.currentBalance || 0);
  const reqAmt = Number(requiredAmount || 0);
  if (currentBalance < reqAmt) {
    return {
      allowed: false,
      error: `Capital Solvency Constraint: Cannot deduct Rs ${reqAmt.toLocaleString()} from ${account.accountName}. Available liquid balance is Rs ${currentBalance.toLocaleString()} (Shortfall: Rs ${(reqAmt - currentBalance).toLocaleString()}). You cannot execute operations beyond available capital. You may defer this expense to Accounts Payable (Liabilities) to settle when funds become available.`,
      account,
      currentBalance,
      shortfall: reqAmt - currentBalance,
    };
  }
  return { allowed: true, account, currentBalance };
};

// ==========================================
// 4. CAP TABLE, VALUATION & SHARE MANAGEMENT
// ==========================================

// Helper: generate standard amortization schedule
const generateAmortizationSchedule = (principal, annualRatePct, termMonths, startDate = new Date()) => {
  const p = Number(principal || 0);
  const rate = Number(annualRatePct || 0);
  const n = Math.max(1, Number(termMonths || 12));
  const r = (rate / 100) / 12;

  let emi = 0;
  if (r > 0) {
    emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  } else {
    emi = p / n;
  }
  emi = Number(emi.toFixed(2));

  let currentPrincipal = p;
  const schedule = [];
  const start = new Date(startDate);

  for (let i = 1; i <= n; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);

    const interestPortion = Number((currentPrincipal * r).toFixed(2));
    const principalPortion = Number(Math.min(currentPrincipal, emi - interestPortion).toFixed(2));
    currentPrincipal = Math.max(0, Number((currentPrincipal - principalPortion).toFixed(2)));

    schedule.push({
      monthNumber: i,
      dueDate: dueDate.toISOString().split("T")[0],
      emi: Number((principalPortion + interestPortion).toFixed(2)),
      principalPortion,
      interestPortion,
      remainingPrincipal: currentPrincipal,
      status: "UPCOMING",
    });
  }

  const totalInterest = schedule.reduce((acc, s) => acc + s.interestPortion, 0);

  return {
    emi,
    schedule,
    totalInterest: Number(totalInterest.toFixed(2)),
    totalRepayment: Number((p + totalInterest).toFixed(2)),
  };
};

// Cap Table & Company Valuation Overview
export const getCapTableAndValuation = async (req, res) => {
  try {
    const [partners, valuations, shareTransactions, accounts, distributionPayables] = await Promise.all([
      prisma.partnerEquity.findMany({
        where: { status: { in: ["ACTIVE", "INACTIVE"] } },
        orderBy: [{ ownershipPercentage: "desc" }, { createdAt: "asc" }],
      }),
      prisma.companyValuation.findMany({ orderBy: { effectiveDate: "desc" } }),
      prisma.shareTransaction.findMany({ orderBy: { date: "desc" }, take: 100 }),
      prisma.financialAccount.findMany({ where: { status: "ACTIVE" } }),
      prisma.accountPayable.findMany({
        where: {
          category: "PARTNER_DISTRIBUTION",
          status: { in: ["UNPAID", "PARTIALLY_PAID"] },
        },
      }),
    ]);

    // Calculate baseline total shares
    const BASE_SHARES = 100000; // Standard 100k share cap pool
    let totalAssignedShares = partners.reduce((acc, p) => acc + Number(p.shareCount || 0), 0);

    // If legacy records exist without share counts, initialize pro-rata shares based on ownershipPercentage
    let normalizedPartners = partners.map((p) => {
      let shares = Number(p.shareCount || 0);
      let ownershipPct = Number(p.ownershipPercentage || 0);
      if (totalAssignedShares === 0 && ownershipPct > 0) {
        shares = Number(((ownershipPct / 100) * BASE_SHARES).toFixed(2));
      }
      return {
        ...p,
        shareCount: shares,
        ownershipPercentage: ownershipPct,
      };
    });

    totalAssignedShares = normalizedPartners.reduce((acc, p) => acc + Number(p.shareCount || 0), 0);
    const totalIssuedShares = Math.max(BASE_SHARES, totalAssignedShares || BASE_SHARES);

    // Calculate latest company valuation and share price
    let latestValuation = valuations.length > 0 ? valuations[0] : null;
    let preMoneyValuation = latestValuation ? Number(latestValuation.preMoneyValuation) : 10000000;
    let postMoneyValuation = latestValuation ? Number(latestValuation.postMoneyValuation) : 10000000;
    let sharePrice = totalIssuedShares > 0 ? Number((postMoneyValuation / totalIssuedShares).toFixed(2)) : 100;

    // Normalize ownership percentages so they strictly sum to at most 100%
    let totalOwnershipSum = normalizedPartners.reduce((acc, p) => acc + Number(p.ownershipPercentage || 0), 0);
    
    // If total ownership sum exceeds 100% or shares exist, normalize strictly by share count
    if (totalOwnershipSum > 100.01 || totalAssignedShares > 0) {
      normalizedPartners = normalizedPartners.map((p) => ({
        ...p,
        ownershipPercentage: Number(((Number(p.shareCount) / totalIssuedShares) * 100).toFixed(2)),
      }));
      totalOwnershipSum = normalizedPartners.reduce((acc, p) => acc + Number(p.ownershipPercentage || 0), 0);
    }
    totalOwnershipSum = Number(totalOwnershipSum.toFixed(2));

    const totalLiquidCapital = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);
    const totalPartnerCapital = normalizedPartners.reduce((acc, p) => acc + Number(p.currentCapital || 0), 0);
    const totalDrawings = normalizedPartners.reduce((acc, p) => acc + Number(p.totalDrawings || 0), 0);
    const pendingDistributionsTotal = distributionPayables.reduce((acc, p) => acc + Number(p.remainingBalance || 0), 0);

    // Enrich partner data with current share value and holding valuation
    const enrichedPartners = normalizedPartners.map((p) => {
      const currentHoldingValue = Number((p.shareCount * sharePrice).toFixed(2));
      return {
        ...p,
        currentHoldingValue,
        pricePerShare: sharePrice,
      };
    });

    res.json({
      success: true,
      data: {
        capTable: enrichedPartners,
        valuations,
        shareTransactions,
        accounts,
        metrics: {
          totalIssuedShares,
          totalAllocatedPercentage: Math.min(100, totalOwnershipSum),
          unallocatedPercentage: Number(Math.max(0, 100 - totalOwnershipSum).toFixed(2)),
          currentValuation: postMoneyValuation,
          preMoneyValuation,
          sharePrice,
          totalLiquidCapital: Number(totalLiquidCapital.toFixed(2)),
          totalPartnerCapital: Number(totalPartnerCapital.toFixed(2)),
          totalDrawings: Number(totalDrawings.toFixed(2)),
          pendingDistributionsTotal: Number(pendingDistributionsTotal.toFixed(2)),
          shareholderCount: enrichedPartners.length,
          isCapTableValid: totalOwnershipSum <= 100.01,
        },
      },
    });
  } catch (error) {
    console.error("Get Cap Table & Valuation Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// Primary Share Issuance (Company Issues Brand New Shares / Injects Investment)
export const issueNewShares = async (req, res) => {
  try {
    const {
      investorName,
      email,
      phone,
      role = "ANGEL_INVESTOR",
      preMoneyValuation,
      investmentAmount,
      depositAccountId,
      roundName = "New Equity Round",
      notes,
    } = req.body;

    if (!investorName || !email || !investmentAmount || !preMoneyValuation) {
      return res.json({
        success: false,
        message: "Investor Name, Email, Pre-Money Valuation, and Investment Amount are required.",
      });
    }

    const preVal = Number(preMoneyValuation);
    const invAmt = Number(investmentAmount);

    if (preVal <= 0 || invAmt <= 0) {
      return res.json({ success: false, message: "Valuation and Investment Amount must be greater than zero." });
    }

    // 1. Fetch current active shareholders
    const partners = await prisma.partnerEquity.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    });

    const BASE_SHARES = 100000;
    let totalPreShares = partners.reduce((acc, p) => acc + Number(p.shareCount || 0), 0);
    if (totalPreShares === 0) {
      totalPreShares = BASE_SHARES;
      // Auto-assign baseline shares to existing partners before dilution
      for (const p of partners) {
        const allocatedShares = Number(((Number(p.ownershipPercentage || 0) / 100) * BASE_SHARES).toFixed(2));
        await prisma.partnerEquity.update({
          where: { id: p.id },
          data: { shareCount: allocatedShares },
        });
        p.shareCount = allocatedShares;
      }
    }

    // 2. Venture Capital Standard Post-Money Math
    const postMoneyValuation = preVal + invAmt;
    const sharePrice = Number((preVal / totalPreShares).toFixed(4));
    const newSharesIssued = Number((invAmt / sharePrice).toFixed(2));
    const totalPostShares = Number((totalPreShares + newSharesIssued).toFixed(2));

    // Investor's post-money equity percentage: (Investment / Post-Money) * 100
    const investorOwnershipPct = Number(((invAmt / postMoneyValuation) * 100).toFixed(2));

    // 3. Pro-Rata Dilution of Existing Shareholders
    // New % = (Existing Share Count / Total Post Shares) * 100
    for (const p of partners) {
      const dilutedPct = Number(((Number(p.shareCount) / totalPostShares) * 100).toFixed(2));
      await prisma.partnerEquity.update({
        where: { id: p.id },
        data: {
          ownershipPercentage: dilutedPct,
          notes: `${p.notes || ""}\n[Dilution Round: ${roundName}] Diluted to ${dilutedPct}% on ${new Date().toISOString().split("T")[0]}`.trim(),
        },
      });
    }

    // 4. Create or Update New Investor Shareholder
    let existingInvestor = await prisma.partnerEquity.findUnique({ where: { email: email.trim() } });
    let investorPartner;

    if (existingInvestor) {
      investorPartner = await prisma.partnerEquity.update({
        where: { id: existingInvestor.id },
        data: {
          partnerName: investorName.trim(),
          phone: phone || existingInvestor.phone,
          role: role || existingInvestor.role,
          shareCount: Number(existingInvestor.shareCount) + newSharesIssued,
          ownershipPercentage: Number(existingInvestor.ownershipPercentage) + investorOwnershipPct,
          currentCapital: Number(existingInvestor.currentCapital) + invAmt,
          sharePrice,
          status: "ACTIVE",
          notes: `${existingInvestor.notes || ""}\n[New Investment: ${roundName}] Injected Rs ${invAmt.toLocaleString()} for ${newSharesIssued.toLocaleString()} shares.`.trim(),
        },
      });
    } else {
      investorPartner = await prisma.partnerEquity.create({
        data: {
          partnerName: investorName.trim(),
          email: email.trim(),
          phone: phone || "",
          role,
          shareCount: newSharesIssued,
          sharePrice,
          ownershipPercentage: investorOwnershipPct,
          initialCapital: invAmt,
          currentCapital: invAmt,
          status: "ACTIVE",
          notes: notes || `Issued ${newSharesIssued.toLocaleString()} shares in ${roundName}`,
        },
      });
    }

    // 5. Link Direct Capital Inflow to Treasury Account
    if (depositAccountId) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: depositAccountId },
          data: { currentBalance: { increment: invAmt } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: invAmt,
            type: "INFLOW",
            toAccountId: depositAccountId,
            category: "CAPITAL_INJECTION",
            referenceId: investorPartner.id,
            description: `Primary Share Issuance (${roundName}): ${investorName} injected Rs ${invAmt.toLocaleString()} for ${investorOwnershipPct}% equity`,
          },
        }),
      ]);
    }

    // 6. Record Company Valuation Milestone
    const valuationRecord = await prisma.companyValuation.create({
      data: {
        roundName: roundName.trim(),
        preMoneyValuation: preVal,
        investmentAmount: invAmt,
        postMoneyValuation,
        totalPreShares,
        newSharesIssued,
        totalPostShares,
        sharePrice,
        valuationMethod: "EQUITY_ROUND",
        leadInvestor: investorName.trim(),
        notes: notes || `Primary Share Issuance: ${investorName} acquired ${investorOwnershipPct}% stake.`,
      },
    });

    // 7. Record Immutable Share Transaction Ledger
    await prisma.shareTransaction.create({
      data: {
        transactionType: "PRIMARY_ISSUANCE",
        toPartnerId: investorPartner.id,
        toPartnerName: investorName.trim(),
        shareCount: newSharesIssued,
        sharePrice,
        totalAmount: invAmt,
        equityPercentageTransferred: investorOwnershipPct,
        depositAccountId: depositAccountId || null,
        settlementType: "COMPANY_TREASURY",
        valuationRoundId: valuationRecord.id,
        notes: `Issued ${newSharesIssued.toLocaleString()} primary shares in ${roundName} at Rs ${sharePrice}/share.`,
      },
    });

    // Post Primary Share Issuance to Double-Entry General Ledger
    postShareIssuanceAccounting({
      investorPartner,
      valuationRecord,
      invAmt,
      newSharesIssued,
      depositAccountId,
    }).catch((glErr) => {
      console.error("General Ledger share issuance posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Successfully issued ${newSharesIssued.toLocaleString()} new shares to ${investorName}. Post-Money Valuation is Rs ${postMoneyValuation.toLocaleString()} and treasury capital updated.`,
      valuation: valuationRecord,
      investor: investorPartner,
      metrics: {
        preMoneyValuation: preVal,
        investmentAmount: invAmt,
        postMoneyValuation,
        sharePrice,
        newSharesIssued,
        investorOwnershipPct,
        totalPostShares,
      },
    });
  } catch (error) {
    console.error("Issue New Shares Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// Secondary Share Transfer / Investor Personal Share Sale / Company Share Buyback
export const transferOrSellShare = async (req, res) => {
  try {
    const {
      sellerPartnerId,
      transferType = "PEER_TO_PEER", // PEER_TO_PEER, COMPANY_BUYBACK
      sharesToTransfer,
      sharePrice,
      // Buyer details if Peer-to-Peer
      buyerType = "EXISTING_PARTNER", // EXISTING_PARTNER, NEW_INVESTOR
      buyerPartnerId,
      buyerName,
      buyerEmail,
      buyerPhone,
      buyerRole = "ANGEL_INVESTOR",
      // Company Buyback treasury account
      fromTreasuryAccountId,
      notes,
    } = req.body;

    if (!sellerPartnerId || !sharesToTransfer || Number(sharesToTransfer) <= 0) {
      return res.json({ success: false, message: "Valid Seller and Share Count to transfer are required." });
    }

    const sharesCount = Number(sharesToTransfer);
    const unitPrice = Number(sharePrice || 100);
    const totalTransactionValue = Number((sharesCount * unitPrice).toFixed(2));

    const seller = await prisma.partnerEquity.findUnique({ where: { id: sellerPartnerId } });
    if (!seller) {
      return res.json({ success: false, message: "Seller partner record not found." });
    }

    if (Number(seller.shareCount) < sharesCount) {
      return res.json({
        success: false,
        message: `Insufficient shares: ${seller.partnerName} owns ${seller.shareCount.toLocaleString()} shares, but attempted to sell ${sharesCount.toLocaleString()} shares.`,
      });
    }

    // 1. Fetch total issued shares across active partners
    const allPartners = await prisma.partnerEquity.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } } });
    const currentTotalShares = allPartners.reduce((acc, p) => acc + Number(p.shareCount || 0), 0);

    // ==========================================
    // CASE A: COMPANY SHARE BUYBACK (Capital Reduction & Share Retirement)
    // ==========================================
    if (transferType === "COMPANY_BUYBACK") {
      // Solvency Check on Treasury Account
      if (fromTreasuryAccountId) {
        const solvency = await checkAccountSolvency(fromTreasuryAccountId, totalTransactionValue, "Share Buyback Payout");
        if (!solvency.allowed) {
          return res.json({ success: false, message: solvency.error });
        }

        // Deduct payout from Treasury
        await prisma.$transaction([
          prisma.financialAccount.update({
            where: { id: fromTreasuryAccountId },
            data: { currentBalance: { decrement: totalTransactionValue } },
          }),
          prisma.cashTransaction.create({
            data: {
              amount: totalTransactionValue,
              type: "OUTFLOW",
              fromAccountId: fromTreasuryAccountId,
              category: "DRAWINGS",
              referenceId: seller.id,
              description: `Company Share Buyback: Repurchased ${sharesCount.toLocaleString()} shares from ${seller.partnerName} at Rs ${unitPrice}/share`,
            },
          }),
        ]);
      }

      // Update Seller shares & status
      const newSellerShares = Number((Number(seller.shareCount) - sharesCount).toFixed(2));
      const sellerStatus = newSellerShares <= 0 ? "EXITED" : seller.status;

      await prisma.partnerEquity.update({
        where: { id: seller.id },
        data: {
          shareCount: newSellerShares,
          currentCapital: Math.max(0, Number(seller.currentCapital) - totalTransactionValue),
          status: sellerStatus,
        },
      });

      // Total company shares reduce by bought back shares
      const newTotalCompanyShares = Math.max(1, Number((currentTotalShares - sharesCount).toFixed(2)));

      // Recalculate remaining active partners' ownership % to maintain exact 100% cap table
      const remainingPartners = await prisma.partnerEquity.findMany({
        where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      });

      for (const p of remainingPartners) {
        const rebalancedPct = Number(((Number(p.shareCount) / newTotalCompanyShares) * 100).toFixed(2));
        await prisma.partnerEquity.update({
          where: { id: p.id },
          data: { ownershipPercentage: rebalancedPct },
        });
      }

      // Record Share Buyback in Audit Ledger
      await prisma.shareTransaction.create({
        data: {
          transactionType: "SHARE_BUYBACK",
          fromPartnerId: seller.id,
          fromPartnerName: seller.partnerName,
          toPartnerName: "Company Treasury (Retired)",
          shareCount: sharesCount,
          sharePrice: unitPrice,
          totalAmount: totalTransactionValue,
          equityPercentageTransferred: Number(((sharesCount / currentTotalShares) * 100).toFixed(2)),
          depositAccountId: fromTreasuryAccountId || null,
          settlementType: "COMPANY_TREASURY",
          notes: notes || `Company repurchased and retired ${sharesCount.toLocaleString()} shares from ${seller.partnerName}.`,
        },
      });

      // Post Share Buyback to Double-Entry General Ledger
      postShareBuybackAccounting({
        seller,
        sharesCount,
        unitPrice,
        totalTransactionValue,
        fromTreasuryAccountId,
      }).catch((glErr) => {
        console.error("General Ledger share buyback posting error:", glErr);
      });

      return res.json({
        success: true,
        message: `Successfully executed share buyback of ${sharesCount.toLocaleString()} shares from ${seller.partnerName} for Rs ${totalTransactionValue.toLocaleString()}. Cap table rebalanced to 100%.`,
      });
    }

    // ==========================================
    // CASE B: PEER-TO-PEER SECONDARY SHARE SALE / TRANSFER
    // ==========================================
    let buyerPartner;

    if (buyerType === "EXISTING_PARTNER") {
      if (!buyerPartnerId) {
        return res.json({ success: false, message: "Please select an existing buyer partner." });
      }
      if (buyerPartnerId === sellerPartnerId) {
        return res.json({ success: false, message: "Seller and Buyer cannot be the same partner." });
      }
      buyerPartner = await prisma.partnerEquity.findUnique({ where: { id: buyerPartnerId } });
      if (!buyerPartner) {
        return res.json({ success: false, message: "Buyer partner record not found." });
      }

      // Update Buyer shares
      await prisma.partnerEquity.update({
        where: { id: buyerPartner.id },
        data: {
          shareCount: Number((Number(buyerPartner.shareCount) + sharesCount).toFixed(2)),
          currentCapital: Number((Number(buyerPartner.currentCapital) + totalTransactionValue).toFixed(2)),
        },
      });
    } else {
      // New incoming investor purchasing secondary shares
      if (!buyerName || !buyerEmail) {
        return res.json({ success: false, message: "Buyer Name and Email are required for new incoming investor." });
      }

      buyerPartner = await prisma.partnerEquity.create({
        data: {
          partnerName: buyerName.trim(),
          email: buyerEmail.trim(),
          phone: buyerPhone || "",
          role: buyerRole || "ANGEL_INVESTOR",
          shareCount: sharesCount,
          sharePrice: unitPrice,
          ownershipPercentage: 0, // Recalculated below
          initialCapital: totalTransactionValue,
          currentCapital: totalTransactionValue,
          status: "ACTIVE",
          notes: `Acquired ${sharesCount.toLocaleString()} secondary shares from ${seller.partnerName}`,
        },
      });
    }

    // Deduct shares from Seller
    const newSellerShares = Number((Number(seller.shareCount) - sharesCount).toFixed(2));
    const sellerStatus = newSellerShares <= 0 ? "EXITED" : seller.status;

    await prisma.partnerEquity.update({
      where: { id: seller.id },
      data: {
        shareCount: newSellerShares,
        status: sellerStatus,
      },
    });

    // Total company shares remain invariant in secondary transactions.
    // Recalculate ownership % for all active partners to ensure precision
    const activePartners = await prisma.partnerEquity.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } } });
    for (const p of activePartners) {
      const updatedPct = Number(((Number(p.shareCount) / currentTotalShares) * 100).toFixed(2));
      await prisma.partnerEquity.update({
        where: { id: p.id },
        data: { ownershipPercentage: updatedPct },
      });
    }

    const transferEquityPct = Number(((sharesCount / currentTotalShares) * 100).toFixed(2));

    // Record Immutable Share Transaction
    await prisma.shareTransaction.create({
      data: {
        transactionType: "SECONDARY_TRANSFER",
        fromPartnerId: seller.id,
        fromPartnerName: seller.partnerName,
        toPartnerId: buyerPartner.id,
        toPartnerName: buyerPartner.partnerName,
        shareCount: sharesCount,
        sharePrice: unitPrice,
        totalAmount: totalTransactionValue,
        equityPercentageTransferred: transferEquityPct,
        settlementType: "PRIVATE_PEER_TO_PEER",
        notes: notes || `Secondary sale: ${seller.partnerName} transferred ${sharesCount.toLocaleString()} shares (${transferEquityPct}%) to ${buyerPartner.partnerName} at Rs ${unitPrice}/share.`,
      },
    });

    res.json({
      success: true,
      message: `Successfully transferred ${sharesCount.toLocaleString()} shares (${transferEquityPct}%) from ${seller.partnerName} to ${buyerPartner.partnerName}.`,
    });
  } catch (error) {
    console.error("Secondary Share Transfer Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// Update Company Valuation Benchmark
export const updateCompanyValuation = async (req, res) => {
  try {
    const { roundName, valuationAmount, valuationMethod = "MANUAL_REVALUATION", notes } = req.body;

    const val = Number(valuationAmount);
    if (!roundName || val <= 0) {
      return res.json({ success: false, message: "Round Name and positive Valuation Amount are required." });
    }

    const partners = await prisma.partnerEquity.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } } });
    const totalShares = partners.reduce((acc, p) => acc + Number(p.shareCount || 0), 0) || 100000;
    const sharePrice = Number((val / totalShares).toFixed(4));

    const valuationRecord = await prisma.companyValuation.create({
      data: {
        roundName: roundName.trim(),
        preMoneyValuation: val,
        investmentAmount: 0,
        postMoneyValuation: val,
        totalPreShares: totalShares,
        newSharesIssued: 0,
        totalPostShares: totalShares,
        sharePrice,
        valuationMethod,
        notes: notes || `Company valuation set to Rs ${val.toLocaleString()}`,
      },
    });

    // Update effective share price across all partners
    await prisma.partnerEquity.updateMany({
      data: { sharePrice },
    });

    res.json({
      success: true,
      message: `Company valuation updated to Rs ${val.toLocaleString()} (Rs ${sharePrice}/share).`,
      valuation: valuationRecord,
    });
  } catch (error) {
    console.error("Update Valuation Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getPartnershipOverview = async (req, res) => {
  return getCapTableAndValuation(req, res);
};

export const savePartner = async (req, res) => {
  try {
    const { id, partnerName, email, phone, role = "PARTNER", shareCount, ownershipPercentage, initialCapital, currentCapital, notes } = req.body;
    if (!partnerName || !email) {
      return res.json({ success: false, message: "Partner Name and Email are required" });
    }

    const payload = {
      partnerName: partnerName.trim(),
      email: email.trim(),
      phone: phone || "",
      role: role || "PARTNER",
      shareCount: Number(shareCount || 0),
      ownershipPercentage: Number(ownershipPercentage || 0),
      initialCapital: Number(initialCapital || 0),
      currentCapital: currentCapital !== undefined ? Number(currentCapital) : Number(initialCapital || 0),
      notes: notes || null,
    };

    let partner;
    if (id) {
      partner = await prisma.partnerEquity.update({
        where: { id },
        data: payload,
      });
    } else {
      partner = await prisma.partnerEquity.create({
        data: payload,
      });
    }

    res.json({ success: true, message: "Partner saved successfully", partner });
  } catch (error) {
    console.error("Save Partner Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const calculateAndExecuteProfitDistribution = async (req, res) => {
  try {
    const {
      periodStart,
      periodEnd,
      fiscalYear,
      retainedEarningsPercentage = 20,
      executePayout = false,
      fromAccountId,
    } = req.body;

    const pStart = periodStart ? new Date(periodStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const pEnd = periodEnd ? new Date(periodEnd) : new Date();

    const [orders, operatingExpensesList, partners] = await Promise.all([
      prisma.order.findMany({
        where: {
          date: { gte: BigInt(pStart.getTime()), lte: BigInt(pEnd.getTime()) },
          status: { notIn: ["Cancelled"] },
        },
      }),
      prisma.operatingExpense.findMany({
        where: {
          date: { gte: pStart, lte: pEnd },
        },
      }),
      prisma.partnerEquity.findMany({ where: { status: "ACTIVE" } }),
    ]);

    if (partners.length === 0) {
      return res.json({ success: false, message: "No active partners registered to distribute profit to" });
    }

    const grossRevenue = orders.reduce((acc, o) => acc + Number(o.amount || 0), 0);
    const taxableRevenue = grossRevenue / 1.13;
    const estCOGS = taxableRevenue * 0.55;
    const totalExpenses = operatingExpensesList.reduce((acc, e) => acc + Number(e.amount || 0), 0);

    const netProfit = Math.max(0, taxableRevenue - estCOGS - totalExpenses);
    const retainPct = Number(retainedEarningsPercentage || 20);
    const retainedAmount = Number(((netProfit * retainPct) / 100).toFixed(2));
    const distributableAmount = Number((netProfit - retainedAmount).toFixed(2));

    // Solvency validation if immediate payout requested
    if (executePayout && fromAccountId && distributableAmount > 0) {
      const solvency = await checkAccountSolvency(fromAccountId, distributableAmount, "Profit Distribution Payout");
      if (!solvency.allowed) {
        return res.json({ success: false, message: solvency.error });
      }
    }

    const breakdown = partners.map((p) => {
      const share = Number(((distributableAmount * Number(p.ownershipPercentage)) / 100).toFixed(2));
      return {
        partnerId: p.id,
        name: p.partnerName,
        percentage: p.ownershipPercentage,
        amount: share,
        paymentStatus: executePayout && fromAccountId ? "PAID" : "PAYABLE_DEFERRED",
        paidDate: executePayout && fromAccountId ? new Date() : null,
      };
    });

    const record = await prisma.profitDistribution.create({
      data: {
        periodStart: pStart,
        periodEnd: pEnd,
        fiscalYear: fiscalYear || "2082/2083",
        grossRevenue: Number(grossRevenue.toFixed(2)),
        netProfit: Number(netProfit.toFixed(2)),
        retainedEarningsPercentage: retainPct,
        retainedAmount,
        distributableAmount,
        partnerBreakdown: breakdown,
        status: executePayout && fromAccountId ? "PAID" : "APPROVED_PAYABLE",
      },
    });

    if (executePayout && fromAccountId && distributableAmount > 0) {
      await prisma.financialAccount.update({
        where: { id: fromAccountId },
        data: { currentBalance: { decrement: distributableAmount } },
      });

      for (const item of breakdown) {
        await prisma.partnerEquity.update({
          where: { id: item.partnerId },
          data: {
            totalDistributionsReceived: { increment: item.amount },
          },
        });
        await prisma.cashTransaction.create({
          data: {
            amount: item.amount,
            type: "OUTFLOW",
            fromAccountId,
            category: "DRAWINGS",
            referenceId: record.id,
            description: `Profit Distribution Dividend to ${item.name} (${item.percentage}%)`,
          },
        });
      }
    } else if (distributableAmount > 0) {
      for (const item of breakdown) {
        if (item.amount > 0) {
          await prisma.accountPayable.create({
            data: {
              title: `Partner Profit Share: ${fiscalYear || "FY"} - ${item.name} (${item.percentage}%)`,
              payeeName: item.name,
              category: "PARTNER_DISTRIBUTION",
              referenceType: "PROFIT_DISTRIBUTION",
              referenceId: `${record.id}#${item.partnerId}`,
              totalAmount: item.amount,
              paidAmount: 0,
              remainingBalance: item.amount,
              dueDate: null,
              status: "UNPAID",
              priority: "HIGH",
              notes: `Declared profit dividend share for partner ${item.name} for period ${pStart.toISOString().slice(0, 10)} to ${pEnd.toISOString().slice(0, 10)}.`,
            },
          });
        }
      }
    }

    res.json({
      success: true,
      message:
        executePayout && fromAccountId
          ? "Profit distribution calculated and paid out from liquid treasury"
          : "Profit distribution declared and recorded under Accounts Payable (Liabilities)",
      record,
    });
  } catch (error) {
    console.error("Profit Distribution Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. ADVANCED LOAN & DEBT FINANCING ENGINE
// ==========================================
export const getInvestorsAndLiabilities = async (req, res) => {
  try {
    const liabilities = await prisma.investorLiability.findMany({
      orderBy: { startDate: "desc" },
    });
    res.json({ success: true, liabilities });
  } catch (error) {
    console.error("Get Liabilities Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getLoanSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const loan = await prisma.investorLiability.findUnique({ where: { id } });
    if (!loan) {
      return res.json({ success: false, message: "Loan liability record not found." });
    }

    let schedule = [];
    if (Array.isArray(loan.loanSchedule) && loan.loanSchedule.length > 0) {
      schedule = loan.loanSchedule;
    } else {
      const generated = generateAmortizationSchedule(
        loan.principalAmount,
        loan.interestRate,
        loan.loanTermMonths || 12,
        loan.startDate
      );
      schedule = generated.schedule;
    }

    res.json({
      success: true,
      loan,
      schedule,
    });
  } catch (error) {
    console.error("Get Loan Schedule Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const recordInvestorFinancing = async (req, res) => {
  try {
    const {
      investorName,
      contactPhone,
      contactEmail,
      type = "LONG_TERM_LOAN", // LONG_TERM_LOAN, SHORT_TERM_BORROWING, CREDIT_LINE, EQUITY_INVESTOR
      loanType = "TERM_LOAN",
      principalAmount,
      interestRate = 0,
      loanTermMonths = 12,
      startDate,
      maturityDate,
      depositAccountId,
      notes,
    } = req.body;

    if (!investorName || !principalAmount) {
      return res.json({ success: false, message: "Investor/Lender Name and Principal Amount are required" });
    }

    const principal = Number(principalAmount);
    const rate = Number(interestRate || 0);
    const term = Number(loanTermMonths || 12);
    const start = startDate ? new Date(startDate) : new Date();

    // Generate Amortization Schedule
    const amortization = generateAmortizationSchedule(principal, rate, term, start);

    // Calculate Maturity Date if not provided
    let matDate = maturityDate ? new Date(maturityDate) : new Date(start);
    if (!maturityDate) {
      matDate.setMonth(matDate.getMonth() + term);
    }

    const record = await prisma.investorLiability.create({
      data: {
        investorName: investorName.trim(),
        contactPhone: contactPhone || "",
        contactEmail: contactEmail || "",
        type,
        loanType,
        principalAmount: principal,
        principalPaid: 0,
        interestPaid: 0,
        totalInterestPayable: amortization.totalInterest,
        amountRepaid: 0,
        outstandingBalance: principal,
        interestRate: rate,
        loanTermMonths: term,
        monthlyInstallment: amortization.emi,
        equityGrantedPercentage: 0,
        disbursementAccountId: depositAccountId || "",
        loanSchedule: amortization.schedule,
        startDate: start,
        maturityDate: matDate,
        status: "ACTIVE",
        notes: notes || null,
      },
    });

    // Automatically deposit disbursed funds into Liquid Treasury account
    if (depositAccountId && principal > 0) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: depositAccountId },
          data: { currentBalance: { increment: principal } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: principal,
            type: "INFLOW",
            toAccountId: depositAccountId,
            category: "LOAN_DISBURSEMENT",
            referenceId: record.id,
            description: `Loan Disbursement Received: ${record.investorName} (${principal.toLocaleString()} at ${rate}% APR)`,
          },
        }),
      ]);
    }

    // Post Loan Disbursement to Double-Entry General Ledger
    postLoanDisbursementAccounting(record).catch((glErr) => {
      console.error("General Ledger loan disbursement posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Financing facility registered. Principal Rs ${principal.toLocaleString()} disbursed to treasury with monthly EMI Rs ${amortization.emi.toLocaleString()}.`,
      record,
      amortization,
    });
  } catch (error) {
    console.error("Record Financing Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const recordLiabilityRepayment = async (req, res) => {
  try {
    const {
      liabilityId,
      repaymentAmount,
      principalPortion,
      interestPortion,
      fromAccountId,
      notes,
    } = req.body;

    const amount = Number(repaymentAmount || 0);
    if (amount <= 0) {
      return res.json({ success: false, message: "Repayment amount must be greater than zero" });
    }

    const liability = await prisma.investorLiability.findUnique({ where: { id: liabilityId } });
    if (!liability) {
      return res.json({ success: false, message: "Liability record not found" });
    }

    // Capital Solvency / Overdraft check against selected treasury account
    if (fromAccountId) {
      const solvency = await checkAccountSolvency(fromAccountId, amount, "Loan Repayment");
      if (!solvency.allowed) {
        return res.json({ success: false, message: solvency.error });
      }
    }

    // Principal vs Interest breakdown
    let pPortion = principalPortion !== undefined ? Number(principalPortion) : 0;
    let iPortion = interestPortion !== undefined ? Number(interestPortion) : 0;

    if (pPortion === 0 && iPortion === 0) {
      // Auto-compute based on outstanding balance and rate
      const annualRate = Number(liability.interestRate || 0) / 100;
      const monthlyRate = annualRate / 12;
      iPortion = Number((Number(liability.outstandingBalance) * monthlyRate).toFixed(2));
      pPortion = Math.max(0, Number((amount - iPortion).toFixed(2)));
    }

    const newPrincipalPaid = Number(liability.principalPaid || 0) + pPortion;
    const newInterestPaid = Number(liability.interestPaid || 0) + iPortion;
    const newTotalRepaid = Number(liability.amountRepaid || 0) + amount;
    const newOutstandingPrincipal = Math.max(0, Number(liability.principalAmount) - newPrincipalPaid);
    const newStatus = newOutstandingPrincipal === 0 ? "SETTLED" : "ACTIVE";

    // Update loan schedule status if matches milestone
    let updatedSchedule = Array.isArray(liability.loanSchedule) ? [...liability.loanSchedule] : [];
    if (updatedSchedule.length > 0) {
      const nextUpcomingIdx = updatedSchedule.findIndex((s) => s.status === "UPCOMING");
      if (nextUpcomingIdx !== -1) {
        updatedSchedule[nextUpcomingIdx].status = "PAID";
        updatedSchedule[nextUpcomingIdx].paidDate = new Date().toISOString().split("T")[0];
        updatedSchedule[nextUpcomingIdx].paidAmount = amount;
      }
    }

    const updated = await prisma.investorLiability.update({
      where: { id: liabilityId },
      data: {
        principalPaid: newPrincipalPaid,
        interestPaid: newInterestPaid,
        amountRepaid: newTotalRepaid,
        outstandingBalance: newOutstandingPrincipal,
        loanSchedule: updatedSchedule,
        status: newStatus,
        notes: notes ? `${liability.notes || ""}\n${notes}` : liability.notes,
      },
    });

    // Deduct cash from liquid treasury
    if (fromAccountId) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: fromAccountId },
          data: { currentBalance: { decrement: amount } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount,
            type: "OUTFLOW",
            fromAccountId,
            category: "LOAN_REPAYMENT",
            referenceId: liability.id,
            description: `Loan Repayment to ${liability.investorName} (Principal: Rs ${pPortion.toLocaleString()}, Interest: Rs ${iPortion.toLocaleString()})`,
          },
        }),
      ]);
    }

    // Post Loan Repayment to Double-Entry General Ledger
    postLoanRepaymentAccounting({
      liability: updated,
      amount,
      principalPortion: pPortion,
      interestPortion: iPortion,
      fromAccountId,
    }).catch((glErr) => {
      console.error("General Ledger loan repayment posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Repayment of Rs ${amount.toLocaleString()} processed (Principal: Rs ${pPortion.toLocaleString()}, Interest: Rs ${iPortion.toLocaleString()}). Remaining Balance: Rs ${newOutstandingPrincipal.toLocaleString()}.`,
      liability: updated,
    });
  } catch (error) {
    console.error("Record Repayment Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. ACCOUNTS PAYABLE & RECEIVABLE SUITE (LIABILITIES & SETTLEMENTS)
// ==========================================
export const getPayablesAndReceivables = async (req, res) => {
  try {
    const [
      storedPayables,
      storedReceivables,
      accounts,
      manufacturers,
      orders,
      products,
      manufacturerInventories,
      ncmSettlements,
      supplierCashOutflows,
      recentSettlementTransactions,
      settlementReversions,
    ] = await Promise.all([
      prisma.accountPayable.findMany({
        orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      }),
      prisma.accountReceivable.findMany({
        orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      }),
      prisma.financialAccount.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, accountName: true, currentBalance: true, accountType: true },
      }),
      prisma.manufacturer.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, phone: true, city: true, agreedCommissionRate: true },
      }),
      prisma.order.findMany({
        where: {
          status: { notIn: ["Cancelled"] },
        },
        select: {
          id: true,
          date: true,
          amount: true,
          status: true,
          fulfillmentStatus: true,
          manufacturerId: true,
          orderType: true,
          directOrderType: true,
          items: true,
          deliveryOrder: { select: { manufacturerId: true, state: true } },
        },
      }),
      prisma.product.findMany({
        select: { id: true, costPrice: true },
      }),
      prisma.manufacturerInventory.findMany({
        select: { manufacturerId: true, productId: true, agreedCostPrice: true, proposedCostPrice: true },
      }),
      prisma.deliveryFinancialSettlement.findMany({
        where: { settlementState: { notIn: ["SETTLED", "CANCELLED"] } },
      }),
      prisma.cashTransaction.findMany({
        where: { category: "SUPPLIER_PAYMENT" },
        select: { id: true, amount: true, referenceId: true, partyName: true, description: true, fromAccountId: true, date: true },
      }),
      prisma.cashTransaction.findMany({
        where: { category: { in: ["SUPPLIER_PAYMENT", "COD_REMITTANCE", "SALES", "EXPENSE"] } },
        include: {
          fromAccount: { select: { id: true, accountName: true, accountType: true } },
          toAccount: { select: { id: true, accountName: true, accountType: true } },
        },
        orderBy: { date: "desc" },
        take: 50,
      }),
      prisma.settlementReversion.findMany({
        orderBy: { revertedAt: "desc" },
        take: 100,
      }),
    ]);

    // Build Product Cost lookup
    const productCostMap = {};
    products.forEach((p) => {
      productCostMap[p.id] = Number(p.costPrice || 0);
    });

    const inventoryMap = {};
    manufacturerInventories.forEach((inv) => {
      const price = inv.agreedCostPrice !== null && inv.agreedCostPrice !== undefined ? inv.agreedCostPrice : inv.proposedCostPrice;
      if (price !== null && price !== undefined) {
        inventoryMap[`${inv.manufacturerId}_${inv.productId}`] = Number(price);
      }
    });

    // Map manufacturer payments already recorded
    const mfgPaidMap = {};
    supplierCashOutflows.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      if (tx.referenceId && mfgPaidMap[tx.referenceId] !== undefined) {
        mfgPaidMap[tx.referenceId] += amt;
      } else if (tx.referenceId) {
        mfgPaidMap[tx.referenceId] = amt;
      }
      manufacturers.forEach((m) => {
        if (
          tx.referenceId === m.id ||
          tx.partyName?.toLowerCase() === m.name?.toLowerCase() ||
          tx.description?.toLowerCase().includes(m.name?.toLowerCase())
        ) {
          mfgPaidMap[m.id] = (mfgPaidMap[m.id] || 0) + (tx.referenceId === m.id ? 0 : amt);
        }
      });
    });

    // Also account for settlements recorded in stored AccountPayable records
    storedPayables.forEach((p) => {
      if (p.referenceType === "MANUFACTURER_COGS" && p.referenceId) {
        mfgPaidMap[p.referenceId] = Math.max(mfgPaidMap[p.referenceId] || 0, Number(p.paidAmount || 0));
      }
    });

    // Calculate COGS and Direct Sales per Manufacturer from Orders
    const mfgCogsMap = {};
    const mfgDirectReceivableMap = {};

    manufacturers.forEach((m) => {
      mfgCogsMap[m.id] = 0;
      mfgDirectReceivableMap[m.id] = 0;
    });

    orders.forEach((order) => {
      const items = parseOrderItems(order.items);
      const orderSales = Number(order.amount || 0);
      const orderMfgId =
        order.manufacturerId ||
        items[0]?.manufacturerId ||
        order.deliveryOrder?.manufacturerId;

      if (!orderMfgId) return;

      const mfg = manufacturers.find((m) => m.id === orderMfgId);
      const commissionRate = Number(mfg?.agreedCommissionRate ?? 12);
      const isDirect = order.orderType === "DIRECT_MANUFACTURER" && ["PHONE_ORDER", "HUB_VISIT"].includes(order.directOrderType);

      let orderCost = 0;
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const productId = item.productId || item._id || item.id;
        const itemMfgId = item.manufacturerId || orderMfgId;
        const customCost = itemMfgId ? inventoryMap[`${itemMfgId}_${productId}`] : undefined;
        const unitCost = customCost !== undefined && customCost > 0 ? customCost : (productCostMap[productId] || 0);
        orderCost += qty * unitCost;
      });
      orderCost = Number(orderCost.toFixed(2));

      const grossProfit = isDirect ? Math.max(0, orderSales - orderCost) : 0;
      const commission = Number((grossProfit * (commissionRate / 100)).toFixed(2));
      const manufacturerReceivable = Number((orderCost + commission).toFixed(2));
      mfgCogsMap[orderMfgId] = (mfgCogsMap[orderMfgId] || 0) + manufacturerReceivable;
      if (isDirect) {
        const manufacturerPayable = Math.max(0, Number((orderSales - manufacturerReceivable).toFixed(2)));
        mfgDirectReceivableMap[orderMfgId] = (mfgDirectReceivableMap[orderMfgId] || 0) + manufacturerPayable;
      }
    });

    // Merge stored payables and direct-sale COGS-plus-commission payables.
    const payables = [...storedPayables];

    manufacturers.forEach((m) => {
      const totalCogs = Number((mfgCogsMap[m.id] || 0).toFixed(2));
      const totalPaid = Number((mfgPaidMap[m.id] || 0).toFixed(2));
      const remainingPayable = Math.max(0, Number((totalCogs - totalPaid).toFixed(2)));

      const existingIndex = payables.findIndex(
        (p) => p.referenceType === "MANUFACTURER_COGS" && p.referenceId === m.id
      );

      if (existingIndex >= 0) {
        payables[existingIndex] = {
          ...payables[existingIndex],
          title: `Manufacturer Payable - ${m.name}`,
          totalAmount: totalCogs,
          paidAmount: totalPaid,
          remainingBalance: remainingPayable,
          notes: `Platform orders are payable at COGS; direct orders at COGS plus commission.`,
          status: remainingPayable === 0 && totalCogs > 0 ? "SETTLED" : totalPaid > 0 ? "PARTIALLY_PAID" : "UNPAID",
        };
      } else if (totalCogs > 0 || totalPaid > 0) {
        payables.push({
          id: `AP-MFG-${m.id}`,
          title: `Manufacturer Payable - ${m.name}`,
          payeeName: m.name,
          category: "SUPPLIER_INVOICE",
          referenceType: "MANUFACTURER_COGS",
          referenceId: m.id,
          totalAmount: totalCogs,
          paidAmount: totalPaid,
          remainingBalance: remainingPayable,
          dueDate: null,
          invoiceNumber: `COGS-${m.id.slice(0, 6).toUpperCase()}`,
          status: remainingPayable === 0 && totalCogs > 0 ? "SETTLED" : totalPaid > 0 ? "PARTIALLY_PAID" : "UNPAID",
          priority: "HIGH",
          notes: `Platform orders are payable at COGS; direct orders at COGS plus commission.`,
          settlementHistory: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    // Merge Stored Receivables, NCM COD Remittances, and Direct Sales Receivables
    const receivables = [...storedReceivables];

    // 1. Nepal Can Move (NCM) COD Settlements
    ncmSettlements.forEach((s) => {
      const cod = Number(s.codCollected || s.codExpected || 0);
      const fee = Number(s.deliveryFeeActual || s.deliveryFeeExpected || 0);
      const netRemittance = Math.max(0, Number((cod - fee).toFixed(2)));

      if (netRemittance > 0) {
        const existing = receivables.find((r) => r.referenceId === s.id || r.id === s.id);
        if (!existing) {
          receivables.push({
            id: s.id,
            title: `NCM COD Remittance (Order #${s.ncmOrderId || s.deliveryOrder?.ncmOrderId || s.deliveryOrderId?.slice(-6) || "NCM"})`,
            payerName: "Nepal Can Move (NCM)",
            category: "CARRIER_COD_RECEIVABLE",
            referenceType: "DELIVERY_SETTLEMENT",
            referenceId: s.id,
            totalAmount: netRemittance,
            receivedAmount: 0,
            remainingBalance: netRemittance,
            dueDate: null,
            invoiceNumber: s.ncmOrderId ? `NCM-${s.ncmOrderId}` : `NCM-${s.id.slice(0, 6).toUpperCase()}`,
            status: "UNPAID",
            priority: "HIGH",
            notes: `Pending COD collection remittance from Nepal Can Move courier (Total COD: Rs ${cod}, Courier Fee: Rs ${fee}).`,
            collectionHistory: [],
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          });
        }
      }
    });

    // 2. Direct Manufacturer Sales Receivables
    manufacturers.forEach((m) => {
      const directDue = Number((mfgDirectReceivableMap[m.id] || 0).toFixed(2));
      const existingIndex = receivables.findIndex(
        (r) => r.referenceType === "MANUFACTURER_DIRECT" && r.referenceId === m.id
      );
      if (existingIndex >= 0) {
        const existing = receivables[existingIndex];
        const receivedAmount = Number(existing.receivedAmount || 0);
        const remainingBalance = Math.max(0, Number((directDue - receivedAmount).toFixed(2)));
        receivables[existingIndex] = {
          ...existing,
          title: `Direct Sales Margin - ${m.name}`,
          totalAmount: directDue,
          receivedAmount,
          remainingBalance,
          notes: `Direct manufacturer sales less COGS and commission, payable to the platform.`,
          status: remainingBalance === 0 && directDue > 0 ? "SETTLED" : receivedAmount > 0 ? "PARTIALLY_PAID" : "UNPAID",
        };
      } else if (directDue > 0) {
          receivables.push({
            id: `AR-MFG-DIRECT-${m.id}`,
            title: `Direct Sales Margin - ${m.name}`,
            payerName: m.name,
            category: "CUSTOMER_RECEIVABLE",
            referenceType: "MANUFACTURER_DIRECT",
            referenceId: m.id,
            totalAmount: directDue,
            receivedAmount: 0,
            remainingBalance: directDue,
            dueDate: null,
            invoiceNumber: `DIR-${m.id.slice(0, 6).toUpperCase()}`,
            status: "UNPAID",
            notes: `Direct manufacturer sales less COGS and commission, payable to the platform.`,
            collectionHistory: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });
      }
    });

    const totalPayablesOutstanding = payables
      .filter((p) => p.status !== "SETTLED" && p.status !== "CANCELLED")
      .reduce((acc, p) => acc + Number(p.remainingBalance || 0), 0);

    const totalPayablesSettled = payables
      .reduce((acc, p) => acc + Number(p.paidAmount || 0), 0);

    const totalReceivablesOutstanding = receivables
      .filter((r) => r.status !== "SETTLED" && r.status !== "CANCELLED")
      .reduce((acc, r) => acc + Number(r.remainingBalance || 0), 0);

    const totalReceivablesCollected = receivables
      .reduce((acc, r) => acc + Number(r.receivedAmount || 0), 0);

    const totalLiquidCash = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);

    res.json({
      success: true,
      data: {
        payables,
        receivables,
        accounts,
        recentTransactions: (recentSettlementTransactions || []).map((tx) => ({
          id: tx.id,
          date: tx.date || tx.createdAt,
          amount: Number(tx.amount || 0),
          type: tx.type,
          category: tx.category,
          partyName: tx.partyName,
          accountName: tx.fromAccount?.accountName || tx.toAccount?.accountName || "Treasury Account",
          accountType: tx.fromAccount?.accountType || tx.toAccount?.accountType || "BANK",
          description: tx.description,
          createdAt: tx.createdAt,
        })),
        settlementReversions: (settlementReversions || []).map((rev) => ({
          id: rev.id,
          reversionType: rev.reversionType,
          originalRecordId: rev.originalRecordId,
          originalAmount: Number(rev.originalAmount),
          partyName: rev.partyName,
          accountName: rev.accountName,
          revertReason: rev.revertReason,
          revertedByEmail: rev.revertedByEmail,
          revertedAt: rev.revertedAt,
          restoredStatus: rev.restoredStatus,
        })),
        metrics: {
          totalPayablesOutstanding: Number(totalPayablesOutstanding.toFixed(2)),
          totalPayablesSettled: Number(totalPayablesSettled.toFixed(2)),
          totalReceivablesOutstanding: Number(totalReceivablesOutstanding.toFixed(2)),
          totalReceivablesCollected: Number(totalReceivablesCollected.toFixed(2)),
          totalLiquidCash: Number(totalLiquidCash.toFixed(2)),
          netPayablePressure: Number((totalPayablesOutstanding - totalLiquidCash).toFixed(2)),
          canCoverAllPayablesNow: totalLiquidCash >= totalPayablesOutstanding,
        },
      },
    });
  } catch (error) {
    console.error("Get Payables and Receivables Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createPayable = async (req, res) => {
  try {
    const { title, payeeName, category, referenceType, referenceId, totalAmount, dueDate, invoiceNumber, priority, notes } = req.body;
    
    if (!title || !payeeName || !totalAmount) {
      return res.json({ success: false, message: "Title, Payee Name, and Amount are required" });
    }

    const amount = Number(totalAmount);
    if (amount <= 0) {
      return res.json({ success: false, message: "Amount must be greater than zero" });
    }

    const payable = await prisma.accountPayable.create({
      data: {
        title: title.trim(),
        payeeName: payeeName.trim(),
        category: category || "OPERATING_EXPENSE",
        referenceType: referenceType || "MANUAL",
        referenceId: referenceId || "",
        totalAmount: amount,
        paidAmount: 0,
        remainingBalance: amount,
        dueDate: dueDate ? new Date(dueDate) : null,
        invoiceNumber: invoiceNumber || "",
        priority: priority || "MEDIUM",
        status: "UNPAID",
        notes: notes || null,
      },
    });

    res.json({ success: true, message: "Payable liability recorded successfully", payable });
  } catch (error) {
    console.error("Create Payable Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const createReceivable = async (req, res) => {
  try {
    const { title, payerName, category, referenceType, referenceId, totalAmount, dueDate, invoiceNumber, notes } = req.body;
    
    if (!title || !payerName || !totalAmount) {
      return res.json({ success: false, message: "Title, Payer Name, and Amount are required" });
    }

    const amount = Number(totalAmount);
    if (amount <= 0) {
      return res.json({ success: false, message: "Amount must be greater than zero" });
    }

    const receivable = await prisma.accountReceivable.create({
      data: {
        title: title.trim(),
        payerName: payerName.trim(),
        category: category || "CUSTOMER_RECEIVABLE",
        referenceType: referenceType || "MANUAL",
        referenceId: referenceId || "",
        totalAmount: amount,
        receivedAmount: 0,
        remainingBalance: amount,
        dueDate: dueDate ? new Date(dueDate) : null,
        invoiceNumber: invoiceNumber || "",
        status: "UNPAID",
        notes: notes || null,
      },
    });

    res.json({ success: true, message: "Receivable asset recorded successfully", receivable });
  } catch (error) {
    console.error("Create Receivable Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// PAY TO MANUFACTURER (COGS Payout & Solvency Check)
// ==========================================
export const payManufacturer = async (req, res) => {
  try {
    const { manufacturerId, amount, fromAccountId, notes } = req.body;
    let payAmount = Number(amount || 0);
    const adjustmentType = String(req.body.adjustmentType || "NONE").toUpperCase();
    const adjustmentAmount = Number(req.body.adjustmentAmount || 0);

    if (!["NONE", "DISCOUNT", "FINE"].includes(adjustmentType) || !Number.isFinite(adjustmentAmount) || adjustmentAmount < 0 || (adjustmentType === "NONE" && adjustmentAmount > 0) || (adjustmentType !== "NONE" && adjustmentAmount <= 0)) {
      return res.status(400).json({ success: false, message: "Choose a valid discount or fine amount, or select no adjustment." });
    }

    if (!manufacturerId || !fromAccountId) {
      return res.status(400).json({
        success: false,
        message: "Manufacturer ID and source treasury account are required.",
      });
    }

    const [manufacturer, fromAccount, orders, allProducts, inventoryRows, pastTransactions] = await Promise.all([
      prisma.manufacturer.findUnique({ where: { id: manufacturerId } }),
      prisma.financialAccount.findUnique({ where: { id: fromAccountId } }),
      prisma.order.findMany({
        where: {
          status: { notIn: ["Cancelled"] },
        },
        select: {
          id: true,
          amount: true,
          status: true,
          fulfillmentStatus: true,
          manufacturerId: true,
          orderType: true,
          directOrderType: true,
          items: true,
        },
      }),
      prisma.product.findMany({ select: { id: true, costPrice: true } }),
      prisma.manufacturerInventory.findMany({
        where: { manufacturerId },
        select: { productId: true, agreedCostPrice: true, proposedCostPrice: true },
      }),
      prisma.cashTransaction.findMany({
        where: {
          OR: [
            { referenceId: manufacturerId },
            { partyName: manufacturerId },
          ],
        },
        select: { amount: true, type: true, category: true },
      }),
    ]);

    if (!manufacturer) {
      return res.status(404).json({ success: false, message: "Manufacturer not found." });
    }
    if (!fromAccount) {
      return res.status(404).json({ success: false, message: "Source payment account not found." });
    }

    // Build cost lookups
    const productCostMap = {};
    allProducts.forEach((p) => { productCostMap[p.id] = Number(p.costPrice || 0); });
    const inventoryMap = {};
    inventoryRows.forEach((inv) => {
      const price = inv.agreedCostPrice !== null && inv.agreedCostPrice !== undefined ? inv.agreedCostPrice : inv.proposedCostPrice;
      if (price !== null && price !== undefined) inventoryMap[inv.productId] = Number(price);
    });

    const commissionRate = Number(manufacturer.agreedCommissionRate ?? manufacturer.proposedCommissionRate ?? 12);

    let totalCogs = 0;
    let totalDirectReceivable = 0;

    orders.forEach((order) => {
      const items = parseOrderItems(order.items);
      const orderSales = Number(order.amount || 0);
      const orderMfgId = order.manufacturerId || items[0]?.manufacturerId;
      if (orderMfgId !== manufacturerId) return;

      let orderCost = 0;
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const pId = item.productId || item._id || item.id;
        const customCost = inventoryMap[pId];
        const unitCost = customCost !== undefined && customCost > 0 ? customCost : (productCostMap[pId] || 0);
        orderCost += qty * unitCost;
      });
      orderCost = Number(orderCost.toFixed(2));

      const isDirect = String(order.orderType || "").toUpperCase() === "DIRECT_MANUFACTURER" || ["PHONE_ORDER", "HUB_VISIT"].includes(String(order.directOrderType || "").toUpperCase());

      if (isDirect) {
        const grossProfit = Math.max(0, orderSales - orderCost);
        const comm = Number((grossProfit * (commissionRate / 100)).toFixed(2));
        const receivable = Math.max(0, Number((orderSales - orderCost - comm).toFixed(2)));
        totalDirectReceivable += receivable;
      } else {
        totalCogs += orderCost;
      }
    });

    let prevPaid = 0;
    let prevCollected = 0;
    pastTransactions.forEach((tx) => {
      if (tx.type === "OUTFLOW") prevPaid += Number(tx.amount || 0);
      if (tx.type === "INFLOW") prevCollected += Number(tx.amount || 0);
    });

    let remainingPayable = Math.max(0, Number((totalCogs - prevPaid).toFixed(2)));
    const remainingReceivable = Math.max(0, Number((totalDirectReceivable - prevCollected).toFixed(2)));

    // If amount is not passed or <= 0, default to the full Net Payable
    const postedPayable = await getPostedManufacturerPayable(manufacturerId, manufacturer.name);
    remainingPayable = postedPayable.outstanding;
    if (payAmount <= 0) {
      payAmount = Math.max(0, postedPayable.outstanding + (adjustmentType === "FINE" ? adjustmentAmount : 0) - (adjustmentType === "DISCOUNT" ? adjustmentAmount : 0));
    }

    const settlementAmount = payAmount + (adjustmentType === "DISCOUNT" ? adjustmentAmount : 0) - (adjustmentType === "FINE" ? adjustmentAmount : 0);
    if (settlementAmount <= 0) {
      return res.status(400).json({ success: false, message: "The cash payment and adjustment must settle a positive amount of the manufacturer payable." });
    }

    if (settlementAmount > postedPayable.outstanding) {
      return res.status(400).json({
        success: false,
        message: `Net settlement exceeds posted manufacturer payable. Posted outstanding: Rs ${postedPayable.outstanding.toLocaleString()}; net settlement: Rs ${settlementAmount.toLocaleString()}. Complete delivery/accounting posting first or record the excess as an approved manufacturer advance.`,
        postedPayable,
      });
    }

    if (settlementAmount <= 0 && remainingPayable === 0) {
      return res.status(400).json({
        success: false,
        message: `No outstanding net payable for ${manufacturer.name}. (Approved COGS: Rs ${totalCogs.toLocaleString()}, Paid: Rs ${prevPaid.toLocaleString()}, Direct Margin Offset: Rs ${remainingReceivable.toLocaleString()})`,
      });
    }

    // STRICT CAPITAL SOLVENCY CHECK
    if (fromAccount.currentBalance < payAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient liquid cash in ${fromAccount.accountName}. Available balance: Rs ${fromAccount.currentBalance.toLocaleString()}, required: Rs ${payAmount.toLocaleString()}. Please deposit funds first or pay a smaller partial amount.`,
      });
    }

    // Ensure unique idempotency key for this payout transaction
    const idempotencyKey = req.body.idempotencyKey || req.headers?.["idempotency-key"] || `MFGPAY-${manufacturerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check if duplicate transaction with this idempotency key already exists
    const existingTx = await prisma.cashTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existingTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `This manufacturer payout transaction (Rs ${existingTx.amount.toLocaleString()}) has already been processed and recorded.`,
      });
    }

    // Debounce check: prevent duplicate rapid clicks within 4 seconds
    const duplicateRecentTx = await prisma.cashTransaction.findFirst({
      where: {
        referenceId: manufacturerId,
        fromAccountId,
        amount: payAmount,
        type: "OUTFLOW",
        category: "SUPPLIER_PAYMENT",
        createdAt: { gte: new Date(Date.now() - 4000) },
      },
    });
    if (duplicateRecentTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `Duplicate transaction rejected: an identical payout of Rs ${payAmount.toLocaleString()} to ${manufacturer.name} was just processed moments ago.`,
      });
    }

    const offsetApplied = 0;

    // Find or create AccountPayable record
    let payable = await prisma.accountPayable.findFirst({
      where: { referenceType: "MANUFACTURER_COGS", referenceId: manufacturerId },
    });

    let history = [];
    if (payable) {
      try {
        history = typeof payable.settlementHistory === "string" ? JSON.parse(payable.settlementHistory) : (payable.settlementHistory || []);
      } catch {
        history = [];
      }
    }

    const settlementEntry = {
      id: Date.now().toString(),
      idempotencyKey,
      date: new Date().toISOString(),
      amount: payAmount,
      settlementAmount,
      adjustmentType,
      adjustmentAmount,
      offsetAmount: offsetApplied,
      grossPayable: remainingPayable,
      grossReceivable: remainingReceivable,
      fromAccountId,
      accountName: fromAccount.accountName,
      notes: notes || `Net settlement payout to ${manufacturer.name}`,
    };
    history.push(settlementEntry);

    const newTotalPaid = postedPayable.paid + settlementAmount;
    const finalRemainingPayable = Math.max(0, postedPayable.recognized - newTotalPaid);
    const newStatus = finalRemainingPayable === 0 ? "SETTLED" : "PARTIALLY_PAID";

    const description = `Net Settlement to ${manufacturer.name}: Approved COGS Rs ${remainingPayable.toLocaleString()} less Direct Margin Rs ${remainingReceivable.toLocaleString()} = Net Paid Rs ${payAmount.toLocaleString()}${notes ? ` (${notes})` : ""}`;

    const { updatedAccount } = await prisma.$transaction(async (tx) => {
      const updatedAccount = await tx.financialAccount.update({
        where: { id: fromAccountId },
        data: { currentBalance: { decrement: payAmount } },
      });
      await tx.cashTransaction.create({
        data: {
          idempotencyKey,
          amount: payAmount,
          type: "OUTFLOW",
          fromAccountId,
          category: "SUPPLIER_PAYMENT",
          partyName: manufacturer.name,
          referenceId: manufacturer.id,
          description,
        },
      });
      if (payable) {
        await tx.accountPayable.update({
            where: { id: payable.id },
            data: {
              totalAmount: postedPayable.recognized,
              paidAmount: newTotalPaid,
              remainingBalance: finalRemainingPayable,
              status: newStatus,
              settlementHistory: history,
            },
          });
      } else {
        await tx.accountPayable.create({
            data: {
              title: `COGS Obligation - ${manufacturer.name}`,
              payeeName: manufacturer.name,
              category: "SUPPLIER_INVOICE",
              referenceType: "MANUFACTURER_COGS",
              referenceId: manufacturer.id,
              totalAmount: postedPayable.recognized,
              paidAmount: newTotalPaid,
              remainingBalance: finalRemainingPayable,
              status: newStatus,
              priority: "HIGH",
              notes: notes || `Production cost COGS settlement`,
              settlementHistory: history,
            },
          });
      }

      await postSupplierPaymentAccounting({
        payableId: payable?.id || `MFG-COGS-${manufacturer.id}`,
        payeeName: manufacturer.name,
        amount: payAmount,
        settlementAmount,
        discountAmount: adjustmentType === "DISCOUNT" ? adjustmentAmount : 0,
        fineAmount: adjustmentType === "FINE" ? adjustmentAmount : 0,
        fromAccountType: fromAccount.accountType === "CASH" ? "CASH" : "BANK",
        payableAccountCode: "2160",
        idempotencyKey: `SUPPLIER_PAYMENT:${idempotencyKey}`,
        referenceNumber: `MFG-NET-${idempotencyKey.slice(-8)}`,
        client: tx,
      });

      return { updatedAccount };
    });

    res.json({
      success: true,
      message: `Successfully paid Net Rs ${payAmount.toLocaleString()} to ${manufacturer.name} from ${fromAccount.accountName}. (Gross COGS: Rs ${remainingPayable.toLocaleString()}, Direct Offset: Rs ${offsetApplied.toLocaleString()}). Remaining balance in ${fromAccount.accountName}: Rs ${updatedAccount.currentBalance.toLocaleString()}`,
      newAccountBalance: updatedAccount.currentBalance,
      netDisbursed: payAmount,
      offsetApplied,
    });
  } catch (error) {
    console.error("Pay Manufacturer Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to process manufacturer payment." });
  }
};

export const settlePayable = async (req, res) => {
  try {
    const { payableId, amount, fromAccountId, notes } = req.body;
    const settleAmount = Number(amount || 0);
    const adjustmentType = String(req.body.adjustmentType || "NONE").toUpperCase();
    const adjustmentAmount = Number(req.body.adjustmentAmount || 0);

    if (!payableId || !Number.isFinite(settleAmount) || settleAmount <= 0 || !fromAccountId) {
      return res.json({ success: false, message: "Payable ID, positive payment amount, and source account are required" });
    }
    if (!["NONE", "DISCOUNT", "FINE"].includes(adjustmentType) || !Number.isFinite(adjustmentAmount) || adjustmentAmount < 0 || (adjustmentType === "NONE" && adjustmentAmount > 0) || (adjustmentType !== "NONE" && adjustmentAmount <= 0)) {
      return res.status(400).json({ success: false, message: "Choose a valid discount or fine amount, or select no adjustment." });
    }
    const settlementAmount = settleAmount + (adjustmentType === "DISCOUNT" ? adjustmentAmount : 0) - (adjustmentType === "FINE" ? adjustmentAmount : 0);
    if (settlementAmount <= 0) {
      return res.status(400).json({ success: false, message: "The cash payment and adjustment must settle a positive amount of the payable." });
    }

    // Check if this is a synthesized or direct manufacturer payable
    if (String(payableId).startsWith("AP-MFG-")) {
      const manufacturerId = payableId.replace("AP-MFG-", "");
      req.body.manufacturerId = manufacturerId;
      return payManufacturer(req, res);
    }

    let payable = await prisma.accountPayable.findUnique({ where: { id: payableId } });
    if (!payable) {
      return res.json({ success: false, message: "Payable record not found" });
    }

    if (payable.referenceType === "MANUFACTURER_COGS" && payable.referenceId) {
      req.body.manufacturerId = payable.referenceId;
      return payManufacturer(req, res);
    }

    if (payable.status === "SETTLED") {
      const lastSettlement = (() => { try { const h = typeof payable.settlementHistory === "string" ? JSON.parse(payable.settlementHistory) : (payable.settlementHistory || []); return h[h.length - 1] || null; } catch { return null; } })();
      return res.status(409).json({
        success: false,
        alreadySettled: true,
        message: `This payable "${payable.title}" has already been completely settled. No further payments can be made.`,
        settledAt: lastSettlement?.date || payable.updatedAt,
        settledAmount: payable.paidAmount,
        settledTo: lastSettlement?.accountName || null,
      });
    }

    if (settlementAmount > payable.remainingBalance) {
      return res.json({
        success: false,
        message: `Net settlement (Rs ${settlementAmount.toLocaleString()}) cannot exceed remaining balance (Rs ${payable.remainingBalance.toLocaleString()}). Check the cash amount and adjustment.`,
      });
    }

    const fromAccount = await prisma.financialAccount.findUnique({ where: { id: fromAccountId } });
    if (!fromAccount) {
      return res.json({ success: false, message: "Source account not found" });
    }

    // STRICT OVERDRAFT CHECK
    if (fromAccount.currentBalance < settleAmount) {
      return res.json({
        success: false,
        message: `Insufficient liquid cash in ${fromAccount.accountName}. Available balance: Rs ${fromAccount.currentBalance.toLocaleString()}, required: Rs ${settleAmount.toLocaleString()}. Please deposit funds first or settle with a smaller partial payment.`,
      });
    }

    // Unique idempotency key
    const idempotencyKey = req.body.idempotencyKey || req.headers?.["idempotency-key"] || `PAY-${payable.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check duplicate transaction by idempotencyKey
    const existingTx = await prisma.cashTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existingTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `This payment transaction (Rs ${existingTx.amount.toLocaleString()}) has already been processed and recorded.`,
      });
    }

    // Debounce check: prevent duplicate rapid clicks within 4 seconds
    const duplicateRecentTx = await prisma.cashTransaction.findFirst({
      where: {
        referenceId: payable.id,
        fromAccountId,
        amount: settleAmount,
        type: "OUTFLOW",
        createdAt: { gte: new Date(Date.now() - 4000) },
      },
    });
    if (duplicateRecentTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `Duplicate transaction rejected: an identical payment of Rs ${settleAmount.toLocaleString()} was just recorded moments ago.`,
      });
    }

    const newRemaining = Math.max(0, Number(payable.remainingBalance) - settlementAmount);
    const newPaid = Number(payable.paidAmount) + settleAmount;
    const newStatus = newRemaining === 0 ? "SETTLED" : "PARTIALLY_PAID";

    let history = [];
    try {
      history = typeof payable.settlementHistory === "string" ? JSON.parse(payable.settlementHistory) : (payable.settlementHistory || []);
    } catch {
      history = [];
    }

    const settlementEntry = {
      id: Date.now().toString(),
      idempotencyKey,
      date: new Date().toISOString(),
      amount: settleAmount,
      settlementAmount,
      adjustmentType,
      adjustmentAmount,
      fromAccountId,
      accountName: fromAccount.accountName,
      notes: notes || "Payable settlement",
    };
    history.push(settlementEntry);

    // Determine Cash Transaction Category
    let cashCategory = "EXPENSE";
    if (payable.category === "SUPPLIER_INVOICE") cashCategory = "SUPPLIER_PAYMENT";
    else if (payable.category === "PARTNER_DISTRIBUTION") cashCategory = "DRAWINGS";
    else if (payable.category === "ASSET_PURCHASE") cashCategory = "ASSET_PURCHASE";
    else if (payable.category === "TAX_DUE") cashCategory = "EXPENSE";
    else if (payable.category === "LOAN_NOTE") cashCategory = "LOAN_REPAYMENT";

    await prisma.$transaction([
      prisma.financialAccount.update({
        where: { id: fromAccountId },
        data: { currentBalance: { decrement: settleAmount } },
      }),
      prisma.cashTransaction.create({
        data: {
          idempotencyKey,
          amount: settleAmount,
          type: "OUTFLOW",
          fromAccountId,
          category: cashCategory,
          referenceId: payable.id,
          description: `Settlement of ${payable.title} to ${payable.payeeName}`,
        },
      }),
      prisma.accountPayable.update({
        where: { id: payableId },
        data: {
          paidAmount: newPaid,
          remainingBalance: newRemaining,
          status: newStatus,
          settlementHistory: history,
        },
      }),
    ]);

    // If this payable was for a partner distribution, update the partner's total distributions received
    if (payable.category === "PARTNER_DISTRIBUTION" && payable.referenceId) {
      const parts = payable.referenceId.split("#");
      const partnerId = parts[1];
      if (partnerId) {
        await prisma.partnerEquity.updateMany({
          where: { id: partnerId },
          data: { totalDistributionsReceived: { increment: settleAmount } },
        });
      }
    }

    // Post Supplier / Accounts Payable settlement to Double-Entry General Ledger
    await postSupplierPaymentAccounting({
      payableId: payable.id,
      payeeName: payable.payeeName,
      amount: settleAmount,
      settlementAmount,
      discountAmount: adjustmentType === "DISCOUNT" ? adjustmentAmount : 0,
      fineAmount: adjustmentType === "FINE" ? adjustmentAmount : 0,
      fromAccountType: fromAccount.accountType === "CASH" ? "CASH" : "BANK",
      idempotencyKey: `SUPPLIER_PAYMENT:${idempotencyKey}`,
    }).catch((glErr) => {
      console.error("General Ledger AP settlement posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Successfully paid Rs ${settleAmount.toLocaleString()} to ${payable.payeeName}${adjustmentAmount > 0 ? ` with Rs ${adjustmentAmount.toLocaleString()} ${adjustmentType.toLowerCase()}` : ""}. Remaining balance: Rs ${newRemaining.toLocaleString()}`,
    });
  } catch (error) {
    console.error("Settle Payable Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const collectReceivable = async (req, res) => {
  try {
    const { receivableId, amount, toAccountId, notes } = req.body;
    const collectAmount = Number(amount || 0);
    const adjustmentType = String(req.body.adjustmentType || "NONE").toUpperCase();
    const adjustmentAmount = Number(req.body.adjustmentAmount || 0);

    if (!receivableId || !Number.isFinite(collectAmount) || collectAmount <= 0 || !toAccountId) {
      return res.json({ success: false, message: "Receivable ID, positive amount, and deposit account are required" });
    }
    if (!["NONE", "DISCOUNT", "FINE"].includes(adjustmentType) || !Number.isFinite(adjustmentAmount) || adjustmentAmount < 0 || (adjustmentType === "NONE" && adjustmentAmount > 0) || (adjustmentType !== "NONE" && adjustmentAmount <= 0)) {
      return res.status(400).json({ success: false, message: "Choose a valid discount or fine amount, or select no adjustment." });
    }
    const settlementAmount = collectAmount + (adjustmentType === "DISCOUNT" ? adjustmentAmount : 0) - (adjustmentType === "FINE" ? adjustmentAmount : 0);
    if (settlementAmount <= 0) {
      return res.status(400).json({ success: false, message: "The collection and adjustment must settle a positive amount of the receivable." });
    }

    const toAccount = await prisma.financialAccount.findUnique({ where: { id: toAccountId } });
    if (!toAccount) {
      return res.json({ success: false, message: "Deposit account not found" });
    }

    // Unique idempotency key for this collection event
    const idempotencyKey = req.body.idempotencyKey || req.headers?.["idempotency-key"] || `REC-${receivableId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check if this exact transaction was already executed
    const existingTx = await prisma.cashTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existingTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `This collection transaction (Rs ${existingTx.amount.toLocaleString()}) has already been recorded and processed into the ledger.`,
      });
    }

    // Debounce check: prevent duplicate rapid clicks within 4 seconds for the same receivable
    const duplicateRecentTx = await prisma.cashTransaction.findFirst({
      where: {
        referenceId: receivableId,
        toAccountId,
        amount: collectAmount,
        type: "INFLOW",
        createdAt: { gte: new Date(Date.now() - 4000) },
      },
    });
    if (duplicateRecentTx) {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: `Duplicate transaction rejected: an identical collection of Rs ${collectAmount.toLocaleString()} was just recorded moments ago. Please check transaction history.`,
      });
    }

    // Check if this is a Nepal Can Move (NCM) COD settlement
    const ncmSettlement = await prisma.deliveryFinancialSettlement.findFirst({
      where: { OR: [{ id: receivableId }, { deliveryOrderId: receivableId }] },
    });

    if (ncmSettlement) {
      if (adjustmentType !== "NONE") {
        return res.status(400).json({ success: false, message: "NCM COD settlements already account for courier fees and do not support an additional discount or fine." });
      }
      if (ncmSettlement.settlementState === "SETTLED") {
        return res.status(409).json({
          success: false,
          alreadySettled: true,
          message: `NCM COD remittance for delivery order has already been collected and settled. No further collection allowed.`,
          settledAt: ncmSettlement.settledAt,
        });
      }
      const cod = Number(ncmSettlement.codCollected || ncmSettlement.codExpected || collectAmount);
      const fee = Number(ncmSettlement.deliveryFeeActual || ncmSettlement.deliveryFeeExpected || 0);

      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: toAccountId },
          data: { currentBalance: { increment: collectAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            idempotencyKey,
            amount: collectAmount,
            type: "INFLOW",
            toAccountId,
            category: "COD_REMITTANCE",
            partyName: "Nepal Can Move (NCM)",
            referenceId: ncmSettlement.id,
            description: `NCM COD Remittance collected into ${toAccount.accountName}${notes ? ` - ${notes}` : ""}`,
          },
        }),
        prisma.deliveryFinancialSettlement.update({
          where: { id: ncmSettlement.id },
          data: {
            settlementState: "SETTLED",
            settledAt: new Date(),
            codCollected: cod,
          },
        }),
      ]);

      // Post NCM Remittance to Double-Entry General Ledger
      postNcmRemittanceAccounting({
        settlementId: ncmSettlement.id,
        codCollected: cod,
        deliveryFeeActual: fee,
        isCash: toAccount.accountType === "CASH",
        destinationAccountName: toAccount.accountName,
      }).catch((glErr) => {
        console.error("General Ledger NCM remittance posting error:", glErr);
      });

      return res.json({
        success: true,
        message: `Successfully collected NCM COD remittance of Rs ${collectAmount.toLocaleString()} into ${toAccount.accountName}. Settlement marked as SETTLED.`,
      });
    }

    // Check if direct manufacturer sales receivable
    if (String(receivableId).startsWith("AR-MFG-DIRECT-")) {
      if (adjustmentType !== "NONE") {
        return res.status(400).json({ success: false, message: "Direct manufacturer margin collections do not support adjustments in this settlement flow." });
      }
      const manufacturerId = receivableId.replace("AR-MFG-DIRECT-", "");
      const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });

      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: toAccountId },
          data: { currentBalance: { increment: collectAmount } },
        }),
        prisma.cashTransaction.create({
          data: {
            idempotencyKey,
            amount: collectAmount,
            type: "INFLOW",
            toAccountId,
            category: "SALES",
            partyName: manufacturer ? manufacturer.name : "Direct Manufacturer Sale",
            referenceId: manufacturerId,
            description: `Direct sales retail margin collected from ${manufacturer?.name || "Manufacturer"}${notes ? ` - ${notes}` : ""}`,
          },
        }),
      ]);

      return res.json({
        success: true,
        message: `Successfully collected Rs ${collectAmount.toLocaleString()} from ${manufacturer?.name || "Manufacturer"} into ${toAccount.accountName}.`,
      });
    }

    const receivable = await prisma.accountReceivable.findUnique({ where: { id: receivableId } });
    if (!receivable) {
      return res.json({ success: false, message: "Receivable record not found" });
    }

    if (receivable.status === "SETTLED") {
      const lastCollection = (() => { try { const h = typeof receivable.collectionHistory === "string" ? JSON.parse(receivable.collectionHistory) : (receivable.collectionHistory || []); return h[h.length - 1] || null; } catch { return null; } })();
      return res.status(409).json({
        success: false,
        alreadySettled: true,
        message: `This receivable "${receivable.title}" has already been fully collected. No further collection can be made.`,
        settledAt: lastCollection?.date || receivable.updatedAt,
        collectedAmount: receivable.receivedAmount,
        collectedTo: lastCollection?.accountName || null,
      });
    }

    if (settlementAmount > receivable.remainingBalance) {
      return res.json({
        success: false,
        message: `Net settlement (Rs ${settlementAmount.toLocaleString()}) cannot exceed remaining balance (Rs ${receivable.remainingBalance.toLocaleString()}). Check the cash amount and adjustment.`,
      });
    }

    const newRemaining = Math.max(0, Number(receivable.remainingBalance) - settlementAmount);
    const newReceived = Number(receivable.receivedAmount) + collectAmount;
    const newStatus = newRemaining === 0 ? "SETTLED" : "PARTIALLY_RECEIVED";

    let history = [];
    try {
      history = typeof receivable.collectionHistory === "string" ? JSON.parse(receivable.collectionHistory) : (receivable.collectionHistory || []);
    } catch {
      history = [];
    }

    const collectionEntry = {
      id: Date.now().toString(),
      idempotencyKey,
      date: new Date().toISOString(),
      amount: collectAmount,
      settlementAmount,
      adjustmentType,
      adjustmentAmount,
      toAccountId,
      accountName: toAccount.accountName,
      notes: notes || "Receivable collection",
    };
    history.push(collectionEntry);

    await prisma.$transaction([
      prisma.financialAccount.update({
        where: { id: toAccountId },
        data: { currentBalance: { increment: collectAmount } },
      }),
      prisma.cashTransaction.create({
        data: {
          idempotencyKey,
          amount: collectAmount,
          type: "INFLOW",
          toAccountId,
          category: receivable.category === "CUSTOMER_RECEIVABLE" ? "SALES" : "CAPITAL_INJECTION",
          referenceId: receivable.id,
          description: `Collection for ${receivable.title} from ${receivable.payerName}`,
        },
      }),
      prisma.accountReceivable.update({
        where: { id: receivableId },
        data: {
          receivedAmount: newReceived,
          remainingBalance: newRemaining,
          status: newStatus,
          collectionHistory: history,
        },
      }),
    ]);

    // Post to Double-Entry General Ledger
    await postCustomerPaymentAccounting({
      id: receivable.id,
      orderId: receivable.referenceId || receivable.id,
      customerName: receivable.payerName,
      amount: collectAmount,
      settlementAmount,
      discountAmount: adjustmentType === "DISCOUNT" ? adjustmentAmount : 0,
      fineAmount: adjustmentType === "FINE" ? adjustmentAmount : 0,
      depositAccountType: toAccount.accountType === "CASH" ? "CASH" : "BANK",
      referenceNumber: `REC-COLL-${Date.now()}`,
      idempotencyKey: `CUSTOMER_PAYMENT:${idempotencyKey}`,
    }).catch((glErr) => {
      console.error("General Ledger AR collection posting error:", glErr);
    });

    res.json({
      success: true,
      message: `Successfully collected Rs ${collectAmount.toLocaleString()} into ${toAccount.accountName}${adjustmentAmount > 0 ? ` with Rs ${adjustmentAmount.toLocaleString()} ${adjustmentType.toLowerCase()}` : ""}. Remaining: Rs ${newRemaining.toLocaleString()}`,
    });
  } catch (error) {
    console.error("Collect Receivable Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        alreadyProcessed: true,
        message: "Duplicate transaction rejected by database constraint: this transaction has already been recorded.",
      });
    }
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// REVERT SETTLEMENT (Admin Only)
// Atomically reverses a settled payable, receivable,
// manufacturer payout, or NCM COD remittance.
// Creates a compensation CashTransaction,
// restores AP/AR balances, and logs to SettlementReversion.
// ==========================================
export const revertSettlement = async (req, res) => {
  try {
    // Admin guard
    if (req.auth?.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only ADMIN role can revert settlements." });
    }

    const { type, recordId, cashTransactionId, revertReason } = req.body;
    if (!type || !recordId || !revertReason?.trim()) {
      return res.status(400).json({ success: false, message: "type, recordId, and revertReason are required." });
    }

    const adminEmail = req.auth?.email || "admin";
    const adminId = req.auth?.sub || req.auth?.accountId || null;

    const validTypes = ["PAYABLE", "RECEIVABLE", "MANUFACTURER_PAYMENT", "NCM_COD"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid reversion type. Must be one of: ${validTypes.join(", ")}` });
    }

    // Check no double-revert
    const existing = await prisma.settlementReversion.findFirst({
      where: { reversionType: type, originalRecordId: recordId },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        alreadyReverted: true,
        message: `This settlement has already been reverted on ${new Date(existing.revertedAt).toLocaleDateString("en-NP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} by ${existing.revertedByEmail || "admin"}. Reason: ${existing.revertReason}`,
        reversionId: existing.id,
        revertedAt: existing.revertedAt,
      });
    }

    // ── PAYABLE REVERSION ──────────────────────────────────────
    if (type === "PAYABLE" || type === "MANUFACTURER_PAYMENT") {
      const payable = await prisma.accountPayable.findUnique({ where: { id: recordId } });
      if (!payable) return res.status(404).json({ success: false, message: "Payable record not found." });

      if (payable.status === "UNPAID" && Number(payable.paidAmount) === 0) {
        return res.status(400).json({ success: false, message: "This payable has no payments to revert." });
      }

      // Find the original CashTransaction
      const cashTx = cashTransactionId
        ? await prisma.cashTransaction.findUnique({ where: { id: cashTransactionId } })
        : await prisma.cashTransaction.findFirst({
            where: { referenceId: payable.referenceId || payable.id, type: "OUTFLOW" },
            orderBy: { createdAt: "desc" },
          });

      const revertAmount = cashTx ? Number(cashTx.amount) : Number(payable.paidAmount);
      const accountId = cashTx?.fromAccountId || null;

      const priorStatus = payable.status;
      const priorPaid = Number(payable.paidAmount);
      const priorRemaining = Number(payable.remainingBalance);

      // Restore settlement history
      let history = [];
      try { history = typeof payable.settlementHistory === "string" ? JSON.parse(payable.settlementHistory) : (payable.settlementHistory || []); } catch { history = []; }
      const historyIndex = cashTx && history.length > 0
        ? history.findLastIndex((entry) => cashTx.idempotencyKey && entry.idempotencyKey
          ? entry.idempotencyKey === cashTx.idempotencyKey
          : Math.abs(Number(entry.amount) - revertAmount) < 0.01)
        : -1;
      const revertedSettlementAmount = Number(historyIndex >= 0 ? history[historyIndex].settlementAmount ?? revertAmount : revertAmount);
      const newPaid = Math.max(0, priorPaid - revertAmount);
      const newRemaining = Math.min(Number(payable.totalAmount), priorRemaining + revertedSettlementAmount);
      const restoredStatus = newRemaining >= Number(payable.totalAmount) ? "UNPAID" : "PARTIALLY_PAID";
      if (historyIndex >= 0) history.splice(historyIndex, 1);
      else if (!cashTx) history = [];

      // Compensation transaction (money flows BACK into the treasury account)
      let reversalTxId = null;
      await prisma.$transaction(async (tx) => {
        let reversalTx = null;
        if (accountId) {
          // Credit back the account
          await tx.financialAccount.update({ where: { id: accountId }, data: { currentBalance: { increment: revertAmount } } });
          reversalTx = await tx.cashTransaction.create({
            data: {
              amount: revertAmount,
              type: "INFLOW",
              toAccountId: accountId,
              category: "REFUND",
              referenceId: payable.id,
              partyName: payable.payeeName,
              description: `ADMIN REVERSAL: Settlement of "${payable.title}" reverted. Reason: ${revertReason}`,
            },
          });
          reversalTxId = reversalTx.id;
        }

        await tx.accountPayable.update({
          where: { id: payable.id },
          data: {
            paidAmount: newPaid,
            remainingBalance: newRemaining,
            status: restoredStatus,
            settlementHistory: history,
          },
        });

        // Find the FinancialAccount name for the audit record
        let accountName = null;
        if (accountId) {
          const acc = await tx.financialAccount.findUnique({ where: { id: accountId }, select: { accountName: true } });
          accountName = acc?.accountName || null;
        }

        await tx.settlementReversion.create({
          data: {
            reversionType: type,
            originalRecordId: payable.id,
            cashTransactionId: cashTx?.id || null,
            reversalTransactionId: reversalTxId,
            originalAmount: revertAmount,
            partyName: payable.payeeName,
            accountId,
            accountName,
            priorStatus,
            restoredStatus,
            priorPaidAmount: priorPaid,
            priorRemainingBalance: priorRemaining,
            revertedByAdminId: adminId,
            revertedByEmail: adminEmail,
            revertReason: revertReason.trim(),
          },
        });
      });

      return res.json({
        success: true,
        message: `Successfully reverted settlement of Rs ${revertAmount.toLocaleString()} for "${payable.title}". Status restored to ${restoredStatus}. Amount refunded to treasury.`,
        restoredStatus,
        newPaidAmount: newPaid,
        newRemainingBalance: newRemaining,
      });
    }

    // ── RECEIVABLE REVERSION ──────────────────────────────────────
    if (type === "RECEIVABLE") {
      const receivable = await prisma.accountReceivable.findUnique({ where: { id: recordId } });
      if (!receivable) return res.status(404).json({ success: false, message: "Receivable record not found." });

      if (receivable.status === "UNPAID" && Number(receivable.receivedAmount) === 0) {
        return res.status(400).json({ success: false, message: "This receivable has no collections to revert." });
      }

      const cashTx = cashTransactionId
        ? await prisma.cashTransaction.findUnique({ where: { id: cashTransactionId } })
        : await prisma.cashTransaction.findFirst({
            where: { referenceId: receivable.id, type: "INFLOW" },
            orderBy: { createdAt: "desc" },
          });

      const revertAmount = cashTx ? Number(cashTx.amount) : Number(receivable.receivedAmount);
      const accountId = cashTx?.toAccountId || null;

      const priorStatus = receivable.status;
      const priorReceived = Number(receivable.receivedAmount);
      const priorRemaining = Number(receivable.remainingBalance);

      let history = [];
      try { history = typeof receivable.collectionHistory === "string" ? JSON.parse(receivable.collectionHistory) : (receivable.collectionHistory || []); } catch { history = []; }
      const historyIndex = cashTx && history.length > 0
        ? history.findLastIndex((entry) => cashTx.idempotencyKey && entry.idempotencyKey
          ? entry.idempotencyKey === cashTx.idempotencyKey
          : Math.abs(Number(entry.amount) - revertAmount) < 0.01)
        : -1;
      const revertedSettlementAmount = Number(historyIndex >= 0 ? history[historyIndex].settlementAmount ?? revertAmount : revertAmount);
      const newReceived = Math.max(0, priorReceived - revertAmount);
      const newRemaining = Math.min(Number(receivable.totalAmount), priorRemaining + revertedSettlementAmount);
      const restoredStatus = newRemaining >= Number(receivable.totalAmount) ? "UNPAID" : "PARTIALLY_RECEIVED";
      if (historyIndex >= 0) history.splice(historyIndex, 1);
      else if (!cashTx) history = [];

      let reversalTxId = null;
      await prisma.$transaction(async (tx) => {
        let reversalTx = null;
        if (accountId) {
          await tx.financialAccount.update({ where: { id: accountId }, data: { currentBalance: { decrement: revertAmount } } });
          reversalTx = await tx.cashTransaction.create({
            data: {
              amount: revertAmount,
              type: "OUTFLOW",
              fromAccountId: accountId,
              category: "REFUND",
              referenceId: receivable.id,
              partyName: receivable.payerName,
              description: `ADMIN REVERSAL: Collection of "${receivable.title}" reverted. Reason: ${revertReason}`,
            },
          });
          reversalTxId = reversalTx.id;
        }

        await tx.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            receivedAmount: newReceived,
            remainingBalance: newRemaining,
            status: restoredStatus,
            collectionHistory: history,
          },
        });

        let accountName = null;
        if (accountId) {
          const acc = await tx.financialAccount.findUnique({ where: { id: accountId }, select: { accountName: true } });
          accountName = acc?.accountName || null;
        }

        await tx.settlementReversion.create({
          data: {
            reversionType: "RECEIVABLE",
            originalRecordId: receivable.id,
            cashTransactionId: cashTx?.id || null,
            reversalTransactionId: reversalTxId,
            originalAmount: revertAmount,
            partyName: receivable.payerName,
            accountId,
            accountName,
            priorStatus,
            restoredStatus,
            priorPaidAmount: priorReceived,
            priorRemainingBalance: priorRemaining,
            revertedByAdminId: adminId,
            revertedByEmail: adminEmail,
            revertReason: revertReason.trim(),
          },
        });
      });

      return res.json({
        success: true,
        message: `Successfully reverted collection of Rs ${revertAmount.toLocaleString()} for "${receivable.title}". Status restored to ${restoredStatus}.`,
        restoredStatus,
        newReceivedAmount: newReceived,
        newRemainingBalance: newRemaining,
      });
    }

    // ── NCM COD REVERSION ──────────────────────────────────────
    if (type === "NCM_COD") {
      const ncmSettlement = await prisma.deliveryFinancialSettlement.findFirst({
        where: { OR: [{ id: recordId }, { deliveryOrderId: recordId }] },
      });
      if (!ncmSettlement) return res.status(404).json({ success: false, message: "NCM settlement record not found." });
      if (ncmSettlement.settlementState !== "SETTLED") {
        return res.status(400).json({ success: false, message: "This NCM settlement is not in SETTLED state — nothing to revert." });
      }

      const cashTx = cashTransactionId
        ? await prisma.cashTransaction.findUnique({ where: { id: cashTransactionId } })
        : await prisma.cashTransaction.findFirst({
            where: { referenceId: ncmSettlement.id, type: "INFLOW", category: "COD_REMITTANCE" },
            orderBy: { createdAt: "desc" },
          });

      const revertAmount = cashTx ? Number(cashTx.amount) : Number(ncmSettlement.codCollected || ncmSettlement.codExpected || 0);
      const accountId = cashTx?.toAccountId || null;

      let reversalTxId = null;
      await prisma.$transaction(async (tx) => {
        let reversalTx = null;
        if (accountId) {
          await tx.financialAccount.update({ where: { id: accountId }, data: { currentBalance: { decrement: revertAmount } } });
          reversalTx = await tx.cashTransaction.create({
            data: {
              amount: revertAmount,
              type: "OUTFLOW",
              fromAccountId: accountId,
              category: "REFUND",
              referenceId: ncmSettlement.id,
              partyName: "Nepal Can Move (NCM) — REVERSAL",
              description: `ADMIN REVERSAL: NCM COD remittance reverted. Reason: ${revertReason}`,
            },
          });
          reversalTxId = reversalTx.id;
        }

        await tx.deliveryFinancialSettlement.update({
          where: { id: ncmSettlement.id },
          data: { settlementState: "PENDING", settledAt: null },
        });

        let accountName = null;
        if (accountId) {
          const acc = await tx.financialAccount.findUnique({ where: { id: accountId }, select: { accountName: true } });
          accountName = acc?.accountName || null;
        }

        await tx.settlementReversion.create({
          data: {
            reversionType: "NCM_COD",
            originalRecordId: ncmSettlement.id,
            cashTransactionId: cashTx?.id || null,
            reversalTransactionId: reversalTxId,
            originalAmount: revertAmount,
            partyName: "Nepal Can Move (NCM)",
            accountId,
            accountName,
            priorStatus: "SETTLED",
            restoredStatus: "PENDING",
            priorPaidAmount: revertAmount,
            priorRemainingBalance: 0,
            revertedByAdminId: adminId,
            revertedByEmail: adminEmail,
            revertReason: revertReason.trim(),
          },
        });
      });

      return res.json({
        success: true,
        message: `Successfully reverted NCM COD remittance of Rs ${revertAmount.toLocaleString()}. Settlement state restored to PENDING.`,
        restoredStatus: "PENDING",
      });
    }

    return res.status(400).json({ success: false, message: "Could not process reversion for the given type." });
  } catch (error) {
    console.error("Revert Settlement Error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to revert settlement." });
  }
};

// ==========================================
// 7. VAT & LEGAL TAX MINIMIZATION ADVISORY
// ==========================================
export const getVATAndTaxReport = async (req, res) => {
  try {
    const requestedMonth = req.query.month || getCurrentYearMonth();
    const [year, month] = requestedMonth.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const startTimestamp = BigInt(startDate.getTime());
    const endTimestamp = BigInt(endDate.getTime());

    const [
      orders,
      shipments,
      customerReturns,
      supplierReturns,
      operatingExpenses,
      fixedAssets,
      taxPayables,
      products,
    ] = await Promise.all([
      prisma.order.findMany({
        where: {
          date: { gte: startTimestamp, lte: endTimestamp },
          status: { notIn: ["Cancelled"] },
        },
      }),
      prisma.inboundShipment.findMany({
        where: {
          shipmentDate: { gte: startDate, lte: endDate },
        },
      }),
      prisma.customerReturn.findMany({
        where: {
          returnDate: { gte: startDate, lte: endDate },
          refundStatus: "COMPLETED",
        },
      }),
      prisma.supplierReturn.findMany({
        where: {
          returnDate: { gte: startDate, lte: endDate },
          status: "COMPLETED",
        },
      }),
      prisma.operatingExpense.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
        },
      }),
      prisma.fixedAsset.findMany({ where: { status: "ACTIVE" } }),
      prisma.accountPayable.findMany({
        where: { category: "TAX_DUE", status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      }),
      prisma.product.findMany(),
    ]);

    const vatRate = 0.13; // 13% Nepal VAT

    // Output VAT on Gross Sales
    const grossSalesIncVat = orders.reduce((acc, o) => acc + Number(o.amount || 0), 0);
    const customerRefunds = customerReturns.reduce((acc, r) => acc + Number(r.totalRefundAmount || 0), 0);
    const netSalesIncVat = Math.max(0, grossSalesIncVat - customerRefunds);
    const taxableSales = Number((netSalesIncVat / (1 + vatRate)).toFixed(2));
    const outputVat = Number((netSalesIncVat - taxableSales).toFixed(2));

    // Input VAT Breakdown:
    // 1. Manufacturer COGS (13% VAT Inclusive)
    const productCostMap = {};
    products.forEach((p) => {
      productCostMap[p.id] = Number(p.costPrice || 0);
    });

    let totalCogsIncVat = 0;
    orders.forEach((ord) => {
      let items = [];
      try {
        items = typeof ord.items === "string" ? JSON.parse(ord.items) : (ord.items || []);
      } catch {
        items = [];
      }
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const pId = item.productId || item._id || item.id;
        const unitCost = productCostMap[pId] || 0;
        totalCogsIncVat += unitCost * qty;
      });
    });

    const cogsTaxable = Number((totalCogsIncVat / (1 + vatRate)).toFixed(2));
    const cogsInputVat = Number((totalCogsIncVat - cogsTaxable).toFixed(2));

    // 2. Input VAT on Inbound Shipments & Freight
    let totalPurchasesWithVat = 0;
    shipments.forEach((s) => {
      totalPurchasesWithVat += Number(s.totalFreightCost || 0) + Number(s.customsOrTaxes || 0);
      let items = [];
      try {
        items = typeof s.items === "string" ? JSON.parse(s.items) : (s.items || []);
      } catch {
        items = [];
      }
      items.forEach((item) => {
        totalPurchasesWithVat += Number(item.unitFreightCost || 0) * Number(item.quantity || 1);
      });
    });

    const supplierReturnDebits = supplierReturns.reduce((acc, r) => acc + Number(r.totalDebitAmount || 0), 0);
    const netPurchasesWithVat = Math.max(0, totalPurchasesWithVat - supplierReturnDebits);
    const taxablePurchases = Number((netPurchasesWithVat / (1 + vatRate)).toFixed(2));
    const freightInputVat = Number((netPurchasesWithVat - taxablePurchases).toFixed(2));

    // 3. Input VAT on VAT-Inclusive Operating Expenses & Deductible Marketing
    let deductibleMarketing = 0;
    let expenseInputVat = 0;
    let totalOperatingExpenses = 0;
    operatingExpenses.forEach((exp) => {
      const amt = Number(exp.amount || 0);
      totalOperatingExpenses += amt;
      if ((exp.category || "").toUpperCase() === "MARKETING") {
        deductibleMarketing += amt;
      }
      if (exp.isVatBill) {
        expenseInputVat += Number(exp.vatAmount || 0);
      }
    });
    expenseInputVat = Number(expenseInputVat.toFixed(2));

    // Total Input VAT Credit Claimable
    const inputVat = Number((cogsInputVat + freightInputVat + expenseInputVat).toFixed(2));

    // Net VAT Payable to IRD
    const netVatPayable = Number((outputVat - inputVat).toFixed(2));

    // Corporate Income Tax & Legal Deductions Analysis
    let monthlyTaxDepreciation = 0;
    fixedAssets.forEach((asset) => {
      const annualRate = Number(asset.depreciationRate || 25) / 100;
      const bookVal = Number(asset.currentBookValue || 0);
      monthlyTaxDepreciation += (bookVal * annualRate) / 12;
    });
    monthlyTaxDepreciation = Number(monthlyTaxDepreciation.toFixed(2));

    const totalAllowableDeductions = Number((totalOperatingExpenses + monthlyTaxDepreciation).toFixed(2));
    const estimatedTaxableIncome = Math.max(0, Number((taxableSales - cogsTaxable - totalAllowableDeductions).toFixed(2)));
    const corporateTaxRate = 25; // 25% Nepal Corporate Income Tax Rate
    const estimatedCorporateTax = Number(((estimatedTaxableIncome * corporateTaxRate) / 100).toFixed(2));

    // Tax-Minimization Recommendations Engine
    const taxOptimizationStrategies = [
      {
        title: "Maximize Block B & C Asset Depreciation",
        impact: "HIGH",
        savingsEstimate: `Rs ${(monthlyTaxDepreciation * 0.25).toFixed(0)} / mo`,
        description: "Apply IRD-permitted 25% diminishing balance rate on computers, furniture, and POS hardware to accelerate tax shield deductions legally.",
      },
      {
        title: "Claim 100% Marketing & Ad Spend Deductions",
        impact: "HIGH",
        savingsEstimate: `Rs ${(deductibleMarketing * 0.25).toFixed(0)} / mo`,
        description: "Keep VAT-compliant invoices for all Meta Ads, Google Ads, and local influencer endorsements to offset corporate taxable income directly.",
      },
      {
        title: "Write Off Damaged & Unsaleable Returned Stock",
        impact: "MEDIUM",
        savingsEstimate: "Full Cost Shield",
        description: "Mark damaged customer returns as 'Damaged Write-Off' instead of holding unsaleable inventory to recognize inventory impairment loss before tax.",
      },
      {
        title: "Input VAT Credit Reclaim on Freight & Shipments",
        impact: "MEDIUM",
        savingsEstimate: `Rs ${inputVat.toFixed(0)} VAT Credit`,
        description: "Ensure courier and freight logistics providers issue registered VAT bills (13%) so input tax is fully subtracted from sales VAT.",
      },
    ];

    res.json({
      success: true,
      data: {
        vat: {
          period: requestedMonth,
          taxableSales,
          outputVat,
          taxablePurchases,
          inputVat,
          netVatPayable,
          vatStatus: netVatPayable >= 0 ? "PAYABLE_TO_IRD" : "INPUT_CREDIT_CARRYFORWARD",
        },
        incomeTax: {
          grossTaxableRevenue: taxableSales,
          totalAllowableDeductions,
          depreciationDeduction: monthlyTaxDepreciation,
          estimatedTaxableIncome,
          taxRate: corporateTaxRate,
          estimatedCorporateTax,
        },
        taxPayables,
        taxOptimizationStrategies,
      },
    });
  } catch (error) {
    console.error("VAT and Tax Report Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 8. COMPREHENSIVE FINANCIAL STATEMENTS
// ==========================================
export const getFinancialStatements = async (req, res) => {
  try {
    const requestedMonth = req.query.month || getCurrentYearMonth();
    const [year, month] = requestedMonth.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const startTimestamp = BigInt(startDate.getTime());
    const endTimestamp = BigInt(endDate.getTime());

    const [
      orders,
      products,
      operatingExpensesList,
      accounts,
      fixedAssets,
      partners,
      liabilities,
      customerReturns,
      payables,
      receivables,
    ] = await Promise.all([
      prisma.order.findMany({
        where: {
          date: { gte: startTimestamp, lte: endTimestamp },
          status: { notIn: ["Cancelled"] },
        },
      }),
      prisma.product.findMany(),
      prisma.operatingExpense.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
        },
      }),
      prisma.financialAccount.findMany({ where: { status: "ACTIVE" } }),
      prisma.fixedAsset.findMany(),
      prisma.partnerEquity.findMany({ where: { status: "ACTIVE" } }),
      prisma.investorLiability.findMany({ where: { status: "ACTIVE" } }),
      prisma.customerReturn.findMany({
        where: {
          returnDate: { gte: startDate, lte: endDate },
          refundStatus: "COMPLETED",
        },
      }),
      prisma.accountPayable.findMany({
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      }),
      prisma.accountReceivable.findMany({
        where: { status: { in: ["UNPAID", "PARTIALLY_RECEIVED"] } },
      }),
    ]);

    // P&L Calculations
    const grossRevenue = orders.reduce((acc, o) => acc + Number(o.amount || 0), 0);
    const returnsAndAllowances = customerReturns.reduce((acc, r) => acc + Number(r.totalRefundAmount || 0), 0);
    const netRevenue = Math.max(0, grossRevenue - returnsAndAllowances);
    const taxableNetRevenue = Number((netRevenue / 1.13).toFixed(2));

    // COGS (Manufacturer COGS is 13% VAT Inclusive)
    let cogsIncVat = 0;
    const costMap = {};
    products.forEach((p) => { costMap[p.id] = Number(p.costPrice || 0); });
    orders.forEach((ord) => {
      let items = [];
      try { items = typeof ord.items === "string" ? JSON.parse(ord.items) : (ord.items || []); } catch { items = []; }
      items.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const pId = item.productId || item._id || item.id;
        cogsIncVat += (costMap[pId] || 0) * qty;
      });
    });

    const cogs = Number((cogsIncVat / 1.13).toFixed(2));
    const grossProfit = Number((taxableNetRevenue - cogs).toFixed(2));

    // Operating Overhead Expenses Breakdown
    let marketing = 0;
    let rent = 0;
    let electricity = 0;
    let salaries = 0;
    let utilities = 0;
    let maintenance = 0;
    let misc = 0;

    operatingExpensesList.forEach((exp) => {
      const amt = Number(exp.amount || 0);
      const cat = (exp.category || "MISCELLANEOUS").toUpperCase();
      if (cat === "MARKETING") marketing += amt;
      else if (cat === "RENT") rent += amt;
      else if (cat === "ELECTRICITY") electricity += amt;
      else if (cat === "SALARIES") salaries += amt;
      else if (cat === "UTILITIES") utilities += amt;
      else if (cat === "MAINTENANCE") maintenance += amt;
      else misc += amt;
    });

    const totalOpex = marketing + rent + electricity + salaries + utilities + maintenance + misc;

    let depreciation = 0;
    fixedAssets.forEach((a) => {
      if (a.status === "ACTIVE") {
        depreciation += (Number(a.currentBookValue || 0) * (Number(a.depreciationRate || 25) / 100)) / 12;
      }
    });
    depreciation = Number(depreciation.toFixed(2));

    const netOperatingIncome = Number((grossProfit - totalOpex - depreciation).toFixed(2));
    const incomeTaxEstimate = Math.max(0, Number((netOperatingIncome * 0.25).toFixed(2)));
    const netIncomeAfterTax = Number((netOperatingIncome - incomeTaxEstimate).toFixed(2));

    // Balance Sheet Calculations
    const cashAndEquivalents = accounts.reduce((acc, a) => acc + Number(a.currentBalance || 0), 0);
    const accountsReceivableTotal = receivables.reduce((acc, r) => acc + Number(r.remainingBalance || 0), 0);
    const inventoryValuation = products.reduce((acc, p) => acc + (Number(p.costPrice || 0) * Number(p.stockQuantity || 0)), 0);
    const totalCurrentAssets = Number((cashAndEquivalents + accountsReceivableTotal + inventoryValuation).toFixed(2));

    const fixedAssetsGross = fixedAssets.reduce((acc, a) => acc + Number(a.purchaseCost || 0), 0);
    const accumulatedDep = fixedAssets.reduce((acc, a) => acc + Number(a.accumulatedDepreciation || 0), 0);
    const netFixedAssets = Number((fixedAssetsGross - accumulatedDep).toFixed(2));
    const totalAssets = Number((totalCurrentAssets + netFixedAssets).toFixed(2));

    const accountsPayableTotal = payables.reduce((acc, p) => acc + Number(p.remainingBalance || 0), 0);
    const totalBorrowings = liabilities.reduce((acc, l) => acc + Number(l.outstandingBalance || 0), 0);
    const totalLiabilities = Number((accountsPayableTotal + totalBorrowings).toFixed(2));

    const partnerCapital = partners.reduce((acc, p) => acc + Number(p.currentCapital || 0), 0);
    const retainedEarnings = Number((totalAssets - totalLiabilities - partnerCapital).toFixed(2));
    const totalEquity = Number((partnerCapital + retainedEarnings).toFixed(2));

    // Cash Flow Statement (GAAP / IFRS Direct & Indirect Reconciled)
    // 1. Operating Cash Inflows / Outflows
    const cashFromCustomers = Number(netRevenue.toFixed(2));
    const cashPaidToSuppliers = Number(cogsIncVat.toFixed(2));
    const cashPaidForOperatingExpenses = Number(totalOpex.toFixed(2));
    const netOperatingCashFlow = Number((cashFromCustomers - cashPaidToSuppliers - cashPaidForOperatingExpenses).toFixed(2));

    // 2. Investing Cash Outflows (Capital Asset Purchases ONLY; Depreciation is Non-Cash)
    const assetAdditionsInPeriod = fixedAssets
      .filter((a) => a.createdAt && new Date(a.createdAt) >= startDate && new Date(a.createdAt) <= endDate)
      .reduce((sum, a) => sum + Number(a.paidAmount || a.purchaseCost || 0), 0);
    const netInvestingCashFlow = -Number(assetAdditionsInPeriod.toFixed(2));

    // 3. Financing Cash Flows (Capital Injections, Loans, Repayments, Drawings)
    const capitalInjectionsInPeriod = partners
      .filter((p) => p.createdAt && new Date(p.createdAt) >= startDate && new Date(p.createdAt) <= endDate)
      .reduce((sum, p) => sum + Number(p.initialCapital || 0), 0);
    const loansDisbursedInPeriod = liabilities
      .filter((l) => l.createdAt && new Date(l.createdAt) >= startDate && new Date(l.createdAt) <= endDate)
      .reduce((sum, l) => sum + Number(l.principalAmount || 0), 0);
    const loanRepaymentsInPeriod = liabilities.reduce((sum, l) => sum + Number(l.principalPaid || 0), 0);
    const partnerDrawingsInPeriod = partners.reduce((sum, p) => sum + Number(p.totalDrawings || 0), 0);

    const netFinancingCashFlow = Number(
      (capitalInjectionsInPeriod + loansDisbursedInPeriod - loanRepaymentsInPeriod - partnerDrawingsInPeriod).toFixed(2)
    );

    // 4. Net Cash Flow & Liquid Cash Reconciliation
    const netCashFlow = Number((netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow).toFixed(2));
    const endingCash = cashAndEquivalents;
    const beginningCash = Number((endingCash - netCashFlow).toFixed(2));

    // 5. Indirect Method Operating Cash Flow Reconciliation
    const vatDifference = Number((netRevenue - taxableNetRevenue - (cogsIncVat - cogs)).toFixed(2));
    const indirectReconciliation = {
      netIncome: netIncomeAfterTax,
      depreciationAddback: depreciation,
      taxAndVatAdjustment: vatDifference,
      reconciledOperatingCashFlow: netOperatingCashFlow,
    };

    res.json({
      success: true,
      data: {
        incomeStatement: {
          period: requestedMonth,
          grossRevenue,
          returnsAndAllowances,
          taxableNetRevenue,
          cogs,
          grossProfit,
          operatingExpenses: {
            marketing,
            rent,
            electricity,
            salaries,
            utilities,
            maintenance,
            misc,
            total: totalOpex,
          },
          depreciation,
          netOperatingIncome,
          incomeTaxEstimate,
          netIncomeAfterTax,
        },
        balanceSheet: {
          assets: {
            currentAssets: {
              cashAndEquivalents,
              accountsReceivable: accountsReceivableTotal,
              inventoryValuation,
              total: totalCurrentAssets,
            },
            fixedAssets: {
              grossCost: fixedAssetsGross,
              accumulatedDepreciation: accumulatedDep,
              netBookValue: netFixedAssets,
            },
            totalAssets,
          },
          liabilities: {
            accountsPayable: accountsPayableTotal,
            loansAndDebt: totalBorrowings,
            totalLiabilities,
          },
          equity: {
            partnerCapital,
            retainedEarnings,
            totalEquity,
          },
          workingCapital: Number((totalCurrentAssets - totalLiabilities).toFixed(2)),
          balanceCheck: totalAssets === Number((totalLiabilities + totalEquity).toFixed(2)),
        },
        cashFlowStatement: {
          operatingActivities: netOperatingCashFlow,
          investingActivities: netInvestingCashFlow,
          financingActivities: netFinancingCashFlow,
          netCashFlow,
          beginningCash,
          endingCash,
          details: {
            cashFromCustomers,
            cashPaidToSuppliers: -cashPaidToSuppliers,
            cashPaidForOperatingExpenses: -cashPaidForOperatingExpenses,
            netOperatingCashFlow,
            assetAdditionsInPeriod: netInvestingCashFlow,
            capitalInjectionsInPeriod,
            loansDisbursedInPeriod,
            loanRepaymentsInPeriod: -loanRepaymentsInPeriod,
            partnerDrawingsInPeriod: -partnerDrawingsInPeriod,
            netFinancingCashFlow,
          },
          indirectReconciliation,
        },
      },
    });
  } catch (error) {
    console.error("Financial Statements Error:", error);
    res.json({ success: false, message: error.message });
  }
};
