import { PrismaClient } from "@prisma/client";
import {
  calculateCorporateIncomeTaxProjection,
  getCorporateTaxPolicyForDate,
} from "../services/corporateIncomeTaxService.js";
const prisma = new PrismaClient();

async function testCashFlow() {
  try {
    const requestedMonth = "2026-09";
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

    const grossRevenue = orders.reduce((acc, o) => acc + Number(o.amount || 0), 0);
    const returnsAndAllowances = customerReturns.reduce((acc, r) => acc + Number(r.totalRefundAmount || 0), 0);
    const netRevenue = Math.max(0, grossRevenue - returnsAndAllowances);
    const taxableNetRevenue = Number((netRevenue / 1.13).toFixed(2));

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

    let marketing = 0, rent = 0, electricity = 0, salaries = 0, utilities = 0, maintenance = 0, misc = 0;
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
    const corporateTaxPolicy = await getCorporateTaxPolicyForDate(endDate, { client: prisma });
    const incomeTaxEstimate = calculateCorporateIncomeTaxProjection({
      periodTaxableIncome: netOperatingIncome,
      policy: corporateTaxPolicy,
    }).estimatedTax;
    const netIncomeAfterTax = incomeTaxEstimate === null
      ? null
      : Number((netOperatingIncome - incomeTaxEstimate).toFixed(2));

    const cashFromCustomers = Number(netRevenue.toFixed(2));
    const cashPaidToSuppliers = Number(cogsIncVat.toFixed(2));
    const cashPaidForOperatingExpenses = Number(totalOpex.toFixed(2));
    const netOperatingCashFlow = Number((cashFromCustomers - cashPaidToSuppliers - cashPaidForOperatingExpenses).toFixed(2));

    const assetAdditionsInPeriod = fixedAssets
      .filter((a) => a.createdAt && new Date(a.createdAt) >= startDate && new Date(a.createdAt) <= endDate)
      .reduce((sum, a) => sum + Number(a.paidAmount || a.purchaseCost || 0), 0);
    const netInvestingCashFlow = -Number(assetAdditionsInPeriod.toFixed(2));

    const netFinancingCashFlow = 0;
    const netCashFlow = Number((netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow).toFixed(2));

    console.log("=== CASH FLOW TEST CALCULATIONS ===");
    console.log("Gross Revenue:", grossRevenue);
    console.log("COGS (Inc VAT):", cogsIncVat);
    console.log("Total Operating Overhead Expenses:", totalOpex);
    console.log("Net Operating Cash Flow:", netOperatingCashFlow);
    console.log("Net Investing Cash Flow:", netInvestingCashFlow);
    console.log("Net Financing Cash Flow:", netFinancingCashFlow);
    console.log("Net Cash Flow:", netCashFlow);
    console.log("Corporate Income Tax Estimate:", incomeTaxEstimate ?? "Not configured");
    console.log("Net Income After Tax:", netIncomeAfterTax ?? "Not configured");

  } catch (err) {
    console.error("Test Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

testCashFlow();
