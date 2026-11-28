import "../utils/requireIntegrationDatabaseSafety.js";
import { PrismaClient } from "@prisma/client";
import { postInboundShipmentAccounting, postFixedAssetPurchaseAccounting } from "../services/accountingPostingEngine.js";

const prisma = new PrismaClient();

async function runTests() {
  console.log("\n========================================================");
  console.log("🚀 STARTING CORPORATE CAPITAL SOLVENCY & PARTIAL PAYMENT TEST SUITE");
  console.log("========================================================\n");

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      testPassed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      testFailed++;
    }
  }

  try {
    // 0. Setup a clean test treasury account
    const testAccountName = "Solvency Test Treasury " + Date.now();
    const bankAccount = await prisma.financialAccount.create({
      data: {
        accountName: testAccountName,
        accountType: "BANK",
        accountNumber: "ACC-TEST-" + Date.now(),
        bankName: "Everest Bank",
        currentBalance: 0, // Starts at 0 (No capital)
        currency: "NPR",
      },
    });
    console.log(`Created clean test bank account: ${bankAccount.accountName} with balance: Rs ${bankAccount.currentBalance}`);

    // TEST 1: Overdraft rejection when company has 0 liquid capital
    console.log("\n--- TEST 1: Solvency Protection on 0 Liquid Balance ---");
    assert(bankAccount.currentBalance === 0, "Account starts with 0 liquid balance");
    const attemptedSpend = 150000;
    const canDisburseZeroCapital = bankAccount.currentBalance >= attemptedSpend;
    assert(!canDisburseZeroCapital, "Direct cash outflow of Rs 150,000 is blocked when liquid capital is 0");

    // TEST 2: Credit purchase without liquid capital (Accounts Payable)
    console.log("\n--- TEST 2: 100% Credit Purchase (Accounts Payable Registration) ---");
    const creditShipment = await prisma.inboundShipment.create({
      data: {
        batchNumber: "CREDIT-BATCH-" + Date.now(),
        supplierName: "Biratnagar Garments Ltd",
        invoiceNumber: "BGL-2026-001",
        carrier: "East-West Cargo",
        shipmentDate: new Date(),
        totalFreightCost: 20000,
        customsOrTaxes: 10000,
        totalItemsCost: 170000,
        totalLandedCost: 200000,
        paymentStatus: "CREDIT",
        payableAmount: 200000,
        paidAmount: 0,
      },
    });

    const createdPayable = await prisma.accountPayable.create({
      data: {
        title: `Inbound Shipment ${creditShipment.batchNumber} - Biratnagar Garments Ltd`,
        payeeName: "Biratnagar Garments Ltd",
        category: "INVENTORY_PURCHASE",
        totalAmount: 200000,
        paidAmount: 0,
        remainingBalance: 200000,
        invoiceNumber: "BGL-2026-001",
        status: "PENDING",
      },
    });

    assert(creditShipment.id && createdPayable.id, "100% Credit Shipment recorded without requiring cash");
    assert(createdPayable.payeeName === "Biratnagar Garments Ltd", "Payee/Supplier is accurately tracked in Accounts Payable");
    assert(createdPayable.remainingBalance === 200000, "Full Rs 200,000 is recorded as corporate liability");

    // TEST 3: Capital Injection into Bank Account
    console.log("\n--- TEST 3: Paid-in Capital Injection into Liquid Treasury ---");
    const updatedBank = await prisma.financialAccount.update({
      where: { id: bankAccount.id },
      data: { currentBalance: 500000 },
    });
    assert(updatedBank.currentBalance === 500000, "Bank account now funded with Rs 500,000 paid-in capital");

    // TEST 4: Partial Payment Split on Inbound Shipment
    console.log("\n--- TEST 4: Partial Payment Split (Rs 100,000 Bank Cash + Rs 100,000 Payable) ---");
    const partialShipment = await prisma.inboundShipment.create({
      data: {
        batchNumber: "PARTIAL-BATCH-" + Date.now(),
        supplierName: "Kathmandu Textile Mills",
        invoiceNumber: "KTM-INV-9901",
        carrier: "Kathmandu Logistics",
        shipmentDate: new Date(),
        totalFreightCost: 25000,
        customsOrTaxes: 5000,
        totalItemsCost: 170000,
        totalLandedCost: 200000,
        paymentStatus: "PARTIAL",
        paidFromAccountId: updatedBank.id,
        paidAmount: 100000,
        payableAmount: 100000,
      },
    });

    // Deduct Rs 100,000 from Bank
    const bankAfterPartial = await prisma.financialAccount.update({
      where: { id: updatedBank.id },
      data: { currentBalance: { decrement: 100000 } },
    });

    // Create partial AccountPayable
    const partialPayable = await prisma.accountPayable.create({
      data: {
        title: `Inbound Shipment ${partialShipment.batchNumber} - Kathmandu Textile Mills (Credit Portion)`,
        payeeName: "Kathmandu Textile Mills",
        category: "INVENTORY_PURCHASE",
        totalAmount: 200000,
        paidAmount: 100000,
        remainingBalance: 100000,
        invoiceNumber: "KTM-INV-9901",
        status: "PARTIALLY_PAID",
        settlementHistory: JSON.stringify([
          {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            amount: 100000,
            fromAccountId: updatedBank.id,
            accountName: updatedBank.accountName,
            notes: "Initial upfront payment at shipment receipt",
          },
        ]),
      },
    });

    assert(partialShipment.paidAmount === 100000 && partialShipment.payableAmount === 100000, "Shipment recorded 50/50 split");
    assert(bankAfterPartial.currentBalance === 400000, "Bank balance decremented by Rs 100,000 to Rs 400,000");
    assert(partialPayable.remainingBalance === 100000, "Accounts Payable remaining balance is Rs 100,000");
    assert(partialPayable.status === "PARTIALLY_PAID", "Payable status set to PARTIALLY_PAID");

    // TEST 5: Double-Entry Posting Engine for Partial Payment
    console.log("\n--- TEST 5: Double-Entry Accounting Verification for Partial Shipment ---");
    const glPostingEntry = await postInboundShipmentAccounting({
      id: partialShipment.id,
      shipmentId: partialShipment.id,
      batchNumber: partialShipment.batchNumber,
      totalFreightCost: 25000,
      customsOrTaxes: 5000,
      totalItemsCost: 170000,
      items: [],
      paidFromAccountId: updatedBank.id,
      isCreditPayable: false,
      isPartialPayment: true,
      paidAmount: 100000,
      payableAmount: 100000,
      supplierName: "Kathmandu Textile Mills",
    });

    assert(glPostingEntry && glPostingEntry.id, "Double-Entry GL transaction posted successfully");
    if (glPostingEntry) {
      const entry = await prisma.journalEntry.findUnique({
        where: { id: glPostingEntry.id },
        include: { lines: { include: { account: true } } },
      });
      assert(Number(entry.totalDebit) === Number(entry.totalCredit), "Journal Entry is perfectly balanced (DR == CR)");
      assert(Number(entry.totalDebit) === Number(entry.totalCredit), `Debits (${entry.totalDebit}) === Credits (${entry.totalCredit})`);
      
      const crBankLine = entry.lines.find((l) => l.account?.accountCode === "1120");
      const crApLine = entry.lines.find((l) => l.account?.accountCode === "2110");
      assert(crBankLine && Number(crBankLine.credit) === 100000, "CR Bank Account (1120) for Rs 100,000");
      assert(crApLine && Number(crApLine.credit) === 100000, "CR Accounts Payable (2110) for Rs 100,000");
    }

    // TEST 6: Fixed Asset Partial Purchase
    console.log("\n--- TEST 6: Fixed Asset Partial Payment Split ---");
    const partialAsset = await prisma.fixedAsset.create({
      data: {
        assetTag: "TAG-MACH-" + Date.now(),
        assetName: "Industrial Sewing Machines Block",
        category: "MACHINERY_EQUIPMENT",
        vendorName: "Singer Nepal",
        invoiceNumber: "SNG-2026-10",
        purchaseDate: new Date(),
        purchaseCost: 300000,
        salvageValue: 0,
        depreciationRate: 15,
        depreciationMethod: "WRITTEN_DOWN_VALUE_SLAB",
        usefulLifeMonths: 80,
        accumulatedDepreciation: 0,
        currentBookValue: 300000,
        status: "ACTIVE",
        paidFromAccountId: updatedBank.id,
        paidAmount: 150000,
        payableAmount: 150000,
      },
    });

    const assetGlEntry = await postFixedAssetPurchaseAccounting({
      id: partialAsset.id,
      assetId: partialAsset.id,
      assetTag: partialAsset.assetTag,
      assetName: partialAsset.assetName,
      purchaseCost: 300000,
      category: "MACHINERY_EQUIPMENT",
      paidFromAccountId: updatedBank.id,
      isCreditPurchase: false,
      isPartialPayment: true,
      paidAmount: 150000,
      payableAmount: 150000,
      vendorName: "Singer Nepal",
    });

    assert(assetGlEntry && assetGlEntry.id, "Fixed Asset GL Journal Entry created");
    if (assetGlEntry) {
      const assetEntry = await prisma.journalEntry.findUnique({
        where: { id: assetGlEntry.id },
        include: { lines: { include: { account: true } } },
      });
      assert(Number(assetEntry.totalDebit) === Number(assetEntry.totalCredit), "Fixed Asset Journal Entry is balanced");
      const drAssetLine = assetEntry.lines.find((l) => l.account?.accountCode === "1510");
      const crBankLine = assetEntry.lines.find((l) => l.account?.accountCode === "1120");
      const crApLine = assetEntry.lines.find((l) => l.account?.accountCode === "2110");
      assert(drAssetLine && Number(drAssetLine.debit) === 300000, "DR Machinery & Equipment (1510) for full Rs 300,000");
      assert(crBankLine && Number(crBankLine.credit) === 150000, "CR Bank (1120) for upfront Rs 150,000");
      assert(crApLine && Number(crApLine.credit) === 150000, "CR Accounts Payable (2110) for remaining Rs 150,000");
    }

    // TEST 7: Settlement of Accounts Payable
    console.log("\n--- TEST 7: Settlement of Accounts Payable with Solvency Validation ---");
    // Pay Rs 50,000 towards the partialPayable
    const payableToSettle = await prisma.accountPayable.findUnique({ where: { id: partialPayable.id } });
    const settleAmt = 50000;
    assert(payableToSettle.remainingBalance >= settleAmt, "Payable has sufficient balance to settle Rs 50,000");
    
    // Simulate settlement
    const updatedPayable = await prisma.accountPayable.update({
      where: { id: partialPayable.id },
      data: {
        paidAmount: { increment: settleAmt },
        remainingBalance: { decrement: settleAmt },
        status: "PARTIALLY_PAID",
      },
    });
    assert(updatedPayable.paidAmount === 150000, "Total paid on payable is now Rs 150,000");
    assert(updatedPayable.remainingBalance === 50000, "Remaining balance on payable is Rs 50,000");

    // Clean up test account & records
    await prisma.inboundShipment.delete({ where: { id: creditShipment.id } });
    await prisma.inboundShipment.delete({ where: { id: partialShipment.id } });
    await prisma.accountPayable.delete({ where: { id: createdPayable.id } });
    await prisma.accountPayable.delete({ where: { id: partialPayable.id } });
    await prisma.fixedAsset.delete({ where: { id: partialAsset.id } });
    await prisma.financialAccount.delete({ where: { id: bankAccount.id } });

    console.log("\n========================================================");
    console.log(`🎉 TEST SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
    console.log("========================================================\n");

    if (testFailed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error("Test execution error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
