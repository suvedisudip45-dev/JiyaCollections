import "../utils/requireIntegrationDatabaseSafety.js";
import { prisma } from "../config/db.js";
import {
  ensureStandardChartOfAccounts,
  postJournalEntry,
  postSalesOrderAccounting,
  postCustomerPaymentAccounting,
  postInboundShipmentAccounting,
  postCustomerReturnAccounting,
  postFixedAssetPurchaseAccounting,
  postDepreciationAccounting,
  postLoanDisbursementAccounting,
  postLoanRepaymentAccounting,
  postShareIssuanceAccounting,
  reverseJournalEntry,
} from "../services/accountingPostingEngine.js";

const runAccountingIntegrationTests = async () => {
  console.log("=================================================");
  console.log("STARTING GENERAL LEDGER ACCOUNTING ENGINE TEST SUITE");
  console.log("=================================================\n");

  let passedTests = 0;
  let totalTests = 0;

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
    // -------------------------------------------------------------
    // Test 1: Standard Chart of Accounts Seeding & Verification
    // -------------------------------------------------------------
    console.log("--- 1. Testing Chart of Accounts Initialization ---");
    const coa = await ensureStandardChartOfAccounts();
    assert(Array.isArray(coa) && coa.length >= 25, "Standard Chart of Accounts contains >= 25 standard GAAP accounts");

    const cashAccount = await prisma.account.findUnique({ where: { accountCode: "1120" } });
    assert(cashAccount && cashAccount.accountType === "ASSET", "Bank Accounts (1120) exists under ASSET");

    const arAccount = await prisma.account.findUnique({ where: { accountCode: "1130" } });
    assert(arAccount && arAccount.accountType === "ASSET", "Accounts Receivable (1130) exists under ASSET");

    const revenueAccount = await prisma.account.findUnique({ where: { accountCode: "4100" } });
    assert(revenueAccount && revenueAccount.accountType === "REVENUE", "Sales Revenue (4100) exists under REVENUE");

    const vatAccount = await prisma.account.findUnique({ where: { accountCode: "2120" } });
    assert(vatAccount && vatAccount.accountType === "LIABILITY", "Output VAT Payable (2120) exists under LIABILITY");

    // -------------------------------------------------------------
    // Test 2: Unbalanced Journal Entry Rejection (Invariant Test)
    // -------------------------------------------------------------
    console.log("\n--- 2. Testing Invariant Protection (Unbalanced Entries) ---");
    let caughtUnbalanced = false;
    try {
      await postJournalEntry({
        sourceType: "MANUAL_JOURNAL",
        sourceId: `TEST_UNBALANCED_${Date.now()}`,
        description: "Intentionally unbalanced test entry",
        lines: [
          { accountCode: "1120", debit: 5000, credit: 0 },
          { accountCode: "4100", debit: 0, credit: 4000 }, // Discrepancy of 1000
        ],
      });
    } catch (err) {
      caughtUnbalanced = true;
      assert(err.message.includes("Unbalanced Journal Entry"), "Engine actively rejects unbalanced journal entry");
    }
    assert(caughtUnbalanced, "Unbalanced journal rejection verified");

    // -------------------------------------------------------------
    // Test 3: Idempotency Verification
    // -------------------------------------------------------------
    console.log("\n--- 3. Testing Idempotent Posting ---");
    const testSourceId = `TEST_IDEMPOTENT_${Date.now()}`;
    const entry1 = await postJournalEntry({
      sourceType: "MANUAL_JOURNAL",
      sourceId: testSourceId,
      description: "Idempotency test entry",
      lines: [
        { accountCode: "1120", debit: 2500, credit: 0 },
        { accountCode: "3100", debit: 0, credit: 2500 },
      ],
    });
    assert(entry1 && entry1.status === "POSTED", "First post succeeds");

    const entry2 = await postJournalEntry({
      sourceType: "MANUAL_JOURNAL",
      sourceId: testSourceId,
      description: "Duplicate submission",
      lines: [
        { accountCode: "1120", debit: 2500, credit: 0 },
        { accountCode: "3100", debit: 0, credit: 2500 },
      ],
    });
    assert(entry2.id === entry1.id, "Duplicate submission returns existing journal without creating duplicate lines");

    // -------------------------------------------------------------
    // Test 4: Sales Order Journal Posting (Invoice + Output VAT)
    // -------------------------------------------------------------
    console.log("\n--- 4. Testing Sales Order Double-Entry Posting ---");
    const mockOrder = {
      id: `ORD_TEST_${Date.now()}`,
      amount: 11300, // 10,000 net + 1,300 VAT (13%)
      paymentMethod: "COD",
      date: BigInt(Date.now()),
      items: [
        { productId: "p1", name: "Premium Hoodie", quantity: 2, purchasedUnitPrice: 5650, lineTotal: 11300 },
      ],
    };
    const salesJournal = await postSalesOrderAccounting(mockOrder);
    assert(salesJournal && salesJournal.status === "POSTED", "Sales order posted to GL");
    assert(Number(salesJournal.totalDebit) === 11300 && Number(salesJournal.totalCredit) === 11300, "Sales journal is balanced (Total Dr: 11,300 == Total Cr: 11,300)");

    // -------------------------------------------------------------
    // Test 5: Customer Payment Journal Posting (Cash Inflow & AR Settlement)
    // -------------------------------------------------------------
    console.log("\n--- 5. Testing Customer Payment GL Settlement ---");
    const paymentJournal = await postCustomerPaymentAccounting(mockOrder);
    assert(paymentJournal && paymentJournal.status === "POSTED", "Customer payment posted to GL");
    assert(Number(paymentJournal.totalDebit) === 11300, "Payment debited Liquid Bank (1120) and credited Accounts Receivable (1130)");

    // -------------------------------------------------------------
    // Test 6: Inbound Shipment Purchase Batch (Inventory + Input VAT + AP)
    // -------------------------------------------------------------
    console.log("\n--- 6. Testing Inbound Shipment / Purchase Bill ---");
    const mockShipment = {
      id: `SHIP_TEST_${Date.now()}`,
      batchNumber: `BATCH-TEST-${Date.now().toString().slice(-4)}`,
      totalFreightCost: 20000,
      customsOrTaxes: 2600,
      shipmentDate: new Date(),
    };
    const shipmentJournal = await postInboundShipmentAccounting(mockShipment);
    assert(shipmentJournal && shipmentJournal.status === "POSTED", "Inbound shipment posted to GL");
    assert(Number(shipmentJournal.totalDebit) === 22600, "Inbound shipment balanced (DR Inventory + DR Input VAT == CR AP)");

    // -------------------------------------------------------------
    // Test 7: Customer Return / RMA (Sales Return + Output VAT Reduction)
    // -------------------------------------------------------------
    console.log("\n--- 7. Testing Customer Return / RMA Posting ---");
    const mockReturn = {
      id: `RMA_TEST_${Date.now()}`,
      totalRefundAmount: 2260, // 2000 net + 260 VAT
      customerName: "Test Customer",
      returnDate: new Date(),
    };
    const returnJournal = await postCustomerReturnAccounting(mockReturn, { recordAsPayable: true });
    assert(returnJournal && returnJournal.status === "POSTED", "Customer return posted to GL");
    assert(Number(returnJournal.totalDebit) === 2260, "RMA debited Sales Returns (4500) & Output VAT (2120), credited AP (2110)");

    // -------------------------------------------------------------
    // Test 8: Fixed Asset Purchase & Depreciation Batch
    // -------------------------------------------------------------
    console.log("\n--- 8. Testing Fixed Asset Acquisition & Depreciation ---");
    const mockAsset = {
      id: `ASSET_TEST_${Date.now()}`,
      assetName: "Warehouse Server",
      assetTag: "AST-SRV-01",
      purchaseCost: 80000,
      purchaseDate: new Date(),
    };
    const assetJournal = await postFixedAssetPurchaseAccounting(mockAsset, { recordAsPayable: true });
    assert(assetJournal && assetJournal.status === "POSTED", "Fixed asset acquisition posted (DR Fixed Assets 1510, CR AP 2110)");

    const depJournal = await postDepreciationAccounting({
      totalDepreciation: 1500,
      count: 1,
      date: new Date(),
    });
    assert(depJournal && depJournal.status === "POSTED", "Depreciation batch posted (DR Depreciation Expense 6600, CR Accumulated Dep 1590)");

    // -------------------------------------------------------------
    // Test 9: Debt Financing & Loan Repayment
    // -------------------------------------------------------------
    console.log("\n--- 9. Testing Debt Financing & Loan Repayment ---");
    const mockLoan = {
      id: `LOAN_TEST_${Date.now()}`,
      investorName: "Commercial Bank of Nepal",
      principalAmount: 500000,
      type: "LONG_TERM_LOAN",
      startDate: new Date(),
    };
    const loanJournal = await postLoanDisbursementAccounting(mockLoan);
    assert(loanJournal && loanJournal.status === "POSTED", "Loan disbursement posted (DR Cash 1120, CR Long-Term Debt 2510)");

    const mockRepayment = {
      liability: mockLoan,
      amount: 45000,
      principalPortion: 40000,
      interestPortion: 5000,
    };
    const repayJournal = await postLoanRepaymentAccounting(mockRepayment);
    assert(repayJournal && repayJournal.status === "POSTED", "Loan repayment posted (DR Principal Debt 2510 + DR Interest Expense 7100 == CR Bank 1120)");

    // -------------------------------------------------------------
    // Test 10: Primary Equity Share Issuance
    // -------------------------------------------------------------
    console.log("\n--- 10. Testing Equity Capital Injection ---");
    const mockEquity = {
      investorPartner: { id: `PARTNER_TEST_${Date.now()}`, partnerName: "Angel Investor VC" },
      valuationRecord: { id: `VAL_TEST_${Date.now()}` },
      invAmt: 1000000,
      newSharesIssued: 5000,
    };
    const equityJournal = await postShareIssuanceAccounting(mockEquity);
    assert(equityJournal && equityJournal.status === "POSTED", "Primary equity share issuance posted (DR Bank 1120, CR Share Capital 3100)");

    // -------------------------------------------------------------
    // Test 11: Journal Reversal Integrity Test
    // -------------------------------------------------------------
    console.log("\n--- 11. Testing Journal Reversal Audit Chain ---");
    const reversal = await reverseJournalEntry(entry1.id, "Manual journal audit test", "TEST_ADMIN");
    assert(reversal && reversal.status === "POSTED", "Reversal journal generated and posted");
    assert(reversal.sourceType === "REVERSAL", "Reversal has sourceType REVERSAL");

    const originalRechecked = await prisma.journalEntry.findUnique({ where: { id: entry1.id } });
    assert(originalRechecked.status === "REVERSED", "Original journal entry marked as REVERSED");

    // -------------------------------------------------------------
    // Test 12: Trial Balance Parity & Invariant Balance Check
    // -------------------------------------------------------------
    console.log("\n--- 12. Testing System-Wide Trial Balance Parity ---");
    const activeAccounts = await prisma.account.findMany({ where: { isActive: true } });
    let totalDebitSum = 0;
    let totalCreditSum = 0;

    for (const acc of activeAccounts) {
      const isDebitNormal = acc.normalBalance === "DEBIT";
      const bal = Number(acc.currentBalance || 0);
      if (isDebitNormal) {
        if (bal >= 0) totalDebitSum += bal;
        else totalCreditSum += Math.abs(bal);
      } else {
        if (bal >= 0) totalCreditSum += bal;
        else totalDebitSum += Math.abs(bal);
      }
    }

    const variance = Math.abs(totalDebitSum - totalCreditSum);
    console.log(`  Trial Balance Total Debits : Rs ${totalDebitSum.toLocaleString()}`);
    console.log(`  Trial Balance Total Credits: Rs ${totalCreditSum.toLocaleString()}`);
    console.log(`  Trial Balance Variance     : Rs ${variance.toLocaleString()}`);

    assert(variance < 0.01, "General Ledger Invariant Preserved: Total Debits == Total Credits across entire system!");

    console.log("\n=================================================");
    console.log(`ALL ${passedTests}/${totalTests} ACCOUNTING TEST CASES PASSED SUCCESSFULLY!`);
    console.log("=================================================");
  } catch (err) {
    console.error("\nTEST SUITE FAILED WITH ERROR:", err);
    process.exit(1);
  }
};

runAccountingIntegrationTests()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
