import "../utils/requireMaintenanceDatabaseSafety.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkData() {
  try {
    console.log("=== CHECKING FINANCIAL DATA IN DATABASE ===");
    
    const cashTxCount = await prisma.cashTransaction.count();
    console.log("Cash Transactions Count:", cashTxCount);
    
    const cashTxs = await prisma.cashTransaction.findMany({
      take: 20,
      orderBy: { date: "desc" },
    });
    console.log("Recent Cash Transactions:", JSON.stringify(cashTxs, null, 2));

    const accounts = await prisma.financialAccount.findMany();
    console.log("Financial Accounts:", JSON.stringify(accounts, null, 2));

    const ordersCount = await prisma.order.count();
    console.log("Orders Count:", ordersCount);

    const expenses = await prisma.operatingExpense.findMany();
    console.log("Operating Expenses:", JSON.stringify(expenses, null, 2));

    const fixedAssets = await prisma.fixedAsset.findMany();
    console.log("Fixed Assets:", JSON.stringify(fixedAssets, null, 2));

    const loans = await prisma.investorLiability.findMany();
    console.log("Investor Liabilities / Loans:", JSON.stringify(loans, null, 2));

    const returns = await prisma.customerReturn.findMany();
    console.log("Customer Returns:", JSON.stringify(returns, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
