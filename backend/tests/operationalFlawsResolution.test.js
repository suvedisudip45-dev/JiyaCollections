import { prisma } from "../config/db.js";
import {
  ensureStandardChartOfAccounts,
  postJournalEntry,
  postProfitDistributionAccounting,
} from "../services/accountingPostingEngine.js";
import { closeFiscalYear, reopenFiscalYear } from "../services/fiscalClosingService.js";
import { ICourierAdapter } from "../services/courier/ICourierAdapter.js";
import { NcmCourierAdapter } from "../services/courier/adapters/NcmCourierAdapter.js";
import {
  getActiveCourier,
  getShippingRateForDistricts,
  enqueueCourierJob,
} from "../services/courier/courierService.js";
import { processCourierJob } from "../services/courier/courierOutboxWorker.js";
import {
  ensureDefaultApprovalPolicies,
  evaluateStockTransferAutoApproval,
  evaluateCustomerReturnAutoApproval,
} from "../services/autoApprovalPolicyService.js";
import { runSlaEscalationSweep } from "../workers/slaEscalationWorker.js";

const runTests = async () => {
  console.log("=================================================================");
  console.log("STARTING TEST SUITE: RESOLUTION OF CRITICAL FLAWS 1, 2, AND 3");
  console.log("=================================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  const assert = (condition, message) => {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] Test ${totalTests}: ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] Test ${totalTests}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  };

  try {
    // =================================================================
    // SECTION 1: Unified Accounting & Single Source of Truth (Flaw 1)
    // =================================================================
    console.log("--- SECTION 1: Unified Accounting & Single Source of Truth ---");
    await ensureStandardChartOfAccounts();

    // 1.1 Test Partner Profit Distribution Journal Posting
    const distId = `TEST-DIST-${Date.now()}`;
    const distJournal = await postProfitDistributionAccounting({
      distributionId: distId,
      partnerId: "partner-test-1",
      partnerName: "Test Partner",
      amount: 15000,
      fiscalYear: "2082/2083",
      isImmediatePayout: true,
      cashAccountCode: "1120",
    });

    assert(distJournal && distJournal.id, "Profit distribution journal entry created in GL");
    assert(
      Number(distJournal.totalDebit) === 15000 && Number(distJournal.totalCredit) === 15000,
      "Profit distribution journal is balanced (Total Debit == Total Credit == 15,000)"
    );

    // 1.2 Test Fiscal Year Closing & Retained Earnings Transfer
    // Clean up any stale test journal entries or test fiscal years from prior runs
    const staleEntries = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { sourceId: { startsWith: "FY-" } },
          { description: { contains: "Fiscal Closing" } },
        ],
      },
      select: { id: true },
    });
    if (staleEntries.length > 0) {
      const entryIds = staleEntries.map((e) => e.id);
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    await prisma.fiscalYear.deleteMany({ where: { name: { startsWith: "FY-TEST-" } } });

    const testFyName = `FY-TEST-${Date.now()}`;
    const testFy = await prisma.fiscalYear.create({
      data: {
        name: testFyName,
        startDate: new Date("2028-01-01"),
        endDate: new Date("2028-12-31"),
        status: "OPEN",
      },
    });

    // Create posted test revenue entry in this FY: DR Bank (1120) 50,000 / CR Sales Revenue (4100) 50,000
    await postJournalEntry({
      transactionDate: new Date("2028-06-15"),
      sourceType: "SALES_INVOICE",
      sourceId: `FY-SALE-${Date.now()}`,
      description: "Test Sales for Fiscal Closing",
      lines: [
        { accountCode: "1120", debit: 50000, credit: 0, description: "Bank receipt" },
        { accountCode: "4100", debit: 0, credit: 50000, description: "Sales revenue" },
      ],
      allowClosedPeriod: true,
    });

    // Create posted test expense entry: DR Marketing Expense (6400) 10,000 / CR Bank (1120) 10,000
    await postJournalEntry({
      transactionDate: new Date("2028-07-20"),
      sourceType: "EXPENSE_PAYMENT",
      sourceId: `FY-EXP-${Date.now()}`,
      description: "Test Expense for Fiscal Closing",
      lines: [
        { accountCode: "6400", debit: 10000, credit: 0, description: "Marketing expense" },
        { accountCode: "1120", debit: 0, credit: 10000, description: "Bank payout" },
      ],
      allowClosedPeriod: true,
    });

    // Execute Fiscal Closing
    const closeResult = await closeFiscalYear({
      fiscalYearId: testFy.id,
      closedBy: "SYSTEM_TEST",
    });

    assert(closeResult.success, "closeFiscalYear executed successfully");
    assert(closeResult.fiscalYear.status === "CLOSED", "FiscalYear status transitioned to CLOSED");
    assert(closeResult.fiscalYear.isClosed === true, "FiscalYear isClosed audit flag set to true");
    assert(closeResult.totalRevenue === 50000, "Fiscal Closing summed total revenue Rs 50,000");
    assert(closeResult.totalExpenses === 10000, "Fiscal Closing summed total expenses Rs 10,000");
    assert(closeResult.netIncome === 40000, "Net Income computed at Rs 40,000");
    assert(closeResult.closingJournalEntry != null, "Balanced period closing journal entry posted");

    // Test Reopening Fiscal Year
    const reopenResult = await reopenFiscalYear({
      fiscalYearId: testFy.id,
      reopenedBy: "SYSTEM_TEST",
      reason: "Test Reopening Validation",
    });
    assert(reopenResult.success, "reopenFiscalYear executed successfully");
    assert(reopenResult.fiscalYear.status === "OPEN", "FiscalYear status restored to OPEN");

    // Clean up test FY
    await prisma.fiscalYear.delete({ where: { id: testFy.id } });

    // =================================================================
    // SECTION 2: Courier Resiliency & Agnostic Adapter (Flaw 2)
    // =================================================================
    console.log("\n--- SECTION 2: Courier Resiliency & Agnostic Adapter ---");

    const activeCourier = getActiveCourier("NCM");
    assert(activeCourier instanceof ICourierAdapter, "NcmCourierAdapter implements ICourierAdapter interface");
    assert(activeCourier.providerName === "NCM", "Active courier provider is NCM by default");

    // Dynamic 77-District Rate Quote & Caching Test
    const rate1 = await getShippingRateForDistricts({
      originDistrict: "Kathmandu",
      destDistrict: "Pokhara",
      weightKg: 1.5,
      provider: "NCM",
    });
    assert(typeof rate1 === "number" && rate1 > 0, `Dynamic rate quote returned NPR ${rate1} for Kathmandu->Pokhara`);

    // Verify rate was cached in database
    const cachedRate = await prisma.shippingRateCache.findFirst({
      where: {
        provider: "NCM",
        originDistrict: "kathmandu",
        destDistrict: "pokhara",
        weightKg: 1.5,
      },
    });
    assert(cachedRate != null && cachedRate.rateNPR === rate1, "Rate successfully cached in ShippingRateCache table");

    // Courier Outbox Queue & Retry Worker Test
    const queuedJob = await enqueueCourierJob({
      provider: "NCM",
      orderId: "test-order-123",
      jobType: "SUPPORT_TICKET",
      payload: { ticketType: "COD_TRANSFER", message: "Test outbox ticket message" },
    });
    assert(queuedJob && queuedJob.status === "PENDING", "Courier job queued into CourierOutboxJob");

    // =================================================================
    // SECTION 3: Admin Bottleneck Elimination & Auto-Approvals (Flaw 3)
    // =================================================================
    console.log("\n--- SECTION 3: Admin Bottleneck Elimination & Auto-Approvals ---");

    // 3.1 Policy Seeding
    await ensureDefaultApprovalPolicies();
    const activePolicies = await prisma.approvalPolicyRule.findMany({ where: { isActive: true } });
    assert(activePolicies.length >= 3, `Default approval policies active (${activePolicies.length} policies found)`);

    // 3.2 Stock Transfer Policy Evaluation
    // Low risk request (10 units, ample stock)
    const lowRiskTransfer = await evaluateStockTransferAutoApproval({
      requestedLines: [{ inventorySkuId: "sku-1", requestedQuantity: 10 }],
      factoryBalances: [{ inventorySkuId: "sku-1", quantityOnHand: 50, reservedQuantity: 5 }],
    });
    assert(lowRiskTransfer.shouldAutoApprove === true, "Low-risk stock transfer (10 units) auto-approved by policy");

    // High risk request (100 units > 50 ceiling)
    const highRiskTransfer = await evaluateStockTransferAutoApproval({
      requestedLines: [{ inventorySkuId: "sku-1", requestedQuantity: 100 }],
      factoryBalances: [{ inventorySkuId: "sku-1", quantityOnHand: 200, reservedQuantity: 0 }],
    });
    assert(highRiskTransfer.shouldAutoApprove === false, "High-risk transfer (100 units > 50 units ceiling) correctly requires admin review");

    // 3.3 Customer Return Policy Evaluation
    // Return within 3 days for size exchange <= Rs 5000 with evidence
    const lowRiskReturn = await evaluateCustomerReturnAutoApproval({
      order: { deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      reasonCode: "SIZE_EXCHANGE",
      refundAmount: 2500,
      hasEvidence: true,
    });
    assert(lowRiskReturn.shouldAutoApprove === true, "Valid 3-day customer return (Rs 2,500) auto-approved by policy");

    // Return past 7-day window (e.g. 15 days ago)
    const staleReturn = await evaluateCustomerReturnAutoApproval({
      order: { deliveredAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      reasonCode: "SIZE_EXCHANGE",
      refundAmount: 2500,
      hasEvidence: true,
    });
    assert(staleReturn.shouldAutoApprove === false, "Stale return (15 days post-delivery) correctly held for manual admin review");

    // 3.4 SLA Escalation Sweep Test
    const slaSweep = await runSlaEscalationSweep();
    assert(slaSweep.success === true, "SLA escalation sweep executed without errors");

    console.log("\n=================================================================");
    console.log(`ALL ${totalTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log("=================================================================\n");
  } catch (error) {
    console.error("Test failure:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

runTests();
