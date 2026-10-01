import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../config/db.js";
import * as financialController from "../controllers/financialController.js";

test("Settlement Idempotency, 409 Conflict & Admin Reversion Flow", async (t) => {
  // Setup test bank account
  const timestamp = Date.now();
  const testAccount = await prisma.financialAccount.create({
    data: {
      accountName: `Test Revert Treasury ${timestamp}`,
      accountType: "BANK",
      currentBalance: 500000,
      status: "ACTIVE",
    }
  });

  // Setup test payable
  const testPayable = await prisma.accountPayable.create({
    data: {
      title: `Office Supplies Test ${timestamp}`,
      payeeName: "Supplier Test Hub",
      category: "OPERATIONAL_EXPENSE",
      totalAmount: 15000,
      paidAmount: 0,
      remainingBalance: 15000,
      status: "UNPAID",
      priority: "MEDIUM"
    }
  });
  const adjustmentPayables = [];
  const adjustmentReceivables = [];

  // 1. Settle the payable
  let req = {
    body: {
      payableId: testPayable.id,
      amount: 15000,
      fromAccountId: testAccount.id,
      notes: "First settlement test",
      partial: false
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" }
  };

  let resStatus = 200;
  let resJson = null;
  let res = {
    status: (code) => { resStatus = code; return res; },
    json: (data) => { resJson = data; return res; }
  };

  await financialController.settlePayable(req, res);
  assert.equal(resStatus, 200, "First settlement should succeed with 200");
  assert.equal(resJson.success, true);
  
  const settledPayable = await prisma.accountPayable.findUnique({ where: { id: testPayable.id } });
  assert.equal(settledPayable.status, "SETTLED");

  // Verify treasury account was debited
  let updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 485000, "Treasury should be debited by 15000");

  // 2. Attempt duplicate settlement -> Expect 409 Conflict
  resStatus = 200;
  resJson = null;
  await financialController.settlePayable(req, res);
  assert.equal(resStatus, 409, "Duplicate settlement must return 409 Conflict");
  assert.equal(resJson.success, false);
  assert.equal(resJson.alreadySettled, true, "Response must include alreadySettled: true");
  assert.match(resJson.message, /already been.*settled/i);

  // 3. Revert the settled payable as ADMIN
  const revertReq = {
    body: {
      type: "PAYABLE",
      recordId: testPayable.id,
      revertReason: "Accidental payment batch duplicate"
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" }
  };

  resStatus = 200;
  resJson = null;
  await financialController.revertSettlement(revertReq, res);
  assert.equal(resStatus, 200, "Revert should succeed with 200");
  assert.equal(resJson.success, true);
  assert.equal(resJson.restoredStatus, "UNPAID");

  // Verify payable status is restored
  const restoredPayable = await prisma.accountPayable.findUnique({ where: { id: testPayable.id } });
  assert.equal(restoredPayable.status, "UNPAID", "Payable status must be restored to UNPAID");
  assert.equal(restoredPayable.remainingBalance, 15000, "Remaining balance must be restored to 15000");
  assert.equal(restoredPayable.paidAmount, 0, "Paid amount must be restored to 0");

  // Verify treasury account balance was restored
  updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 500000, "Treasury account balance must be credited back to 500000");

  // 4. Attempt double revert -> Expect 409 Conflict
  resStatus = 200;
  resJson = null;
  await financialController.revertSettlement(revertReq, res);
  assert.equal(resStatus, 409, "Double revert must fail with 409 Conflict");
  assert.match(resJson.message, /already been reverted/i);

  // 4a. A discount clears the payable while only the actual cash leaves treasury.
  const discountedPayable = await prisma.accountPayable.create({
    data: {
      title: `Discounted Payable ${timestamp}`,
      payeeName: "Discount Supplier",
      totalAmount: 2000,
      paidAmount: 0,
      remainingBalance: 2000,
      status: "UNPAID",
    },
  });
  adjustmentPayables.push(discountedPayable.id);
  req = {
    body: {
      payableId: discountedPayable.id,
      amount: 1800,
      adjustmentType: "DISCOUNT",
      adjustmentAmount: 200,
      fromAccountId: testAccount.id,
      idempotencyKey: `PAY-DISCOUNT-${timestamp}`,
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
  };
  resStatus = 200;
  resJson = null;
  await financialController.settlePayable(req, res);
  assert.equal(resJson.success, true, "Discounted payable settlement should succeed");
  let adjustedPayableState = await prisma.accountPayable.findUnique({ where: { id: discountedPayable.id } });
  assert.equal(adjustedPayableState.status, "SETTLED");
  assert.equal(adjustedPayableState.paidAmount, 1800, "Paid amount tracks actual cash");
  assert.equal(adjustedPayableState.remainingBalance, 0);
  assert.equal(adjustedPayableState.settlementHistory[0].amount, 1800, "History records cash paid");
  assert.equal(adjustedPayableState.settlementHistory[0].settlementAmount, 2000, "History records obligation cleared");
  const discountedPayableJournal = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `SUPPLIER_PAYMENT:PAY-DISCOUNT-${timestamp}` },
    include: { lines: { include: { account: true } } },
  });
  assert.equal(Number(discountedPayableJournal.totalDebit), 2000);
  assert.equal(Number(discountedPayableJournal.totalCredit), 2000);
  assert.equal(Number(discountedPayableJournal.lines.find((line) => line.account.accountCode === "8100").credit), 200);
  assert.equal(Number(discountedPayableJournal.lines.find((line) => line.account.accountCode === "1120").credit), 1800);
  updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 498200, "Treasury decreases by the actual Rs 1,800 payment");

  // 4b. A fine increases the cash payment but still clears the original payable.
  const finedPayable = await prisma.accountPayable.create({
    data: {
      title: `Fined Payable ${timestamp}`,
      payeeName: "Penalty Supplier",
      totalAmount: 2000,
      paidAmount: 0,
      remainingBalance: 2000,
      status: "UNPAID",
    },
  });
  adjustmentPayables.push(finedPayable.id);
  req = {
    body: {
      payableId: finedPayable.id,
      amount: 2100,
      adjustmentType: "FINE",
      adjustmentAmount: 100,
      fromAccountId: testAccount.id,
      idempotencyKey: `PAY-FINE-${timestamp}`,
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
  };
  resStatus = 200;
  resJson = null;
  await financialController.settlePayable(req, res);
  assert.equal(resJson.success, true, "Fined payable settlement should succeed");
  adjustedPayableState = await prisma.accountPayable.findUnique({ where: { id: finedPayable.id } });
  assert.equal(adjustedPayableState.status, "SETTLED");
  assert.equal(adjustedPayableState.paidAmount, 2100, "Paid amount includes the actual cash fine");
  assert.equal(adjustedPayableState.settlementHistory[0].amount, 2100, "History records cash including the fine");
  const finedPayableJournal = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `SUPPLIER_PAYMENT:PAY-FINE-${timestamp}` },
    include: { lines: { include: { account: true } } },
  });
  assert.equal(Number(finedPayableJournal.totalDebit), 2100);
  assert.equal(Number(finedPayableJournal.totalCredit), 2100);
  assert.equal(Number(finedPayableJournal.lines.find((line) => line.account.accountCode === "6700").debit), 100);
  assert.equal(Number(finedPayableJournal.lines.find((line) => line.account.accountCode === "1120").credit), 2100);
  updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 496100, "Treasury decreases by the actual Rs 2,100 payment");

  // 5. Test Receivable Settle + Duplicate Check + Revert
  const testReceivable = await prisma.accountReceivable.create({
    data: {
      title: `Store B2B Inflow Test ${timestamp}`,
      payerName: "Direct B2B Buyer",
      category: "B2B_BULK_SALE",
      totalAmount: 25000,
      receivedAmount: 0,
      remainingBalance: 25000,
      status: "UNPAID"
    }
  });

  const collectReq = {
    body: {
      receivableId: testReceivable.id,
      amount: 25000,
      toAccountId: testAccount.id,
      notes: "Collection test",
      partial: false
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" }
  };

  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(collectReq, res);
  assert.equal(resStatus, 200, "Receivable collection should succeed");
  assert.equal(resJson.success, true);
  const settledRec = await prisma.accountReceivable.findUnique({ where: { id: testReceivable.id } });
  assert.equal(settledRec.status, "SETTLED");

  // Verify duplicate collect gives 409
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(collectReq, res);
  assert.equal(resStatus, 409, "Duplicate collection must return 409 Conflict");
  assert.ok(resJson.alreadySettled || resJson.alreadyProcessed, "Must return alreadySettled or alreadyProcessed true");

  // 6. Revert Receivable Settlement
  const revertRecReq = {
    body: {
      type: "RECEIVABLE",
      recordId: testReceivable.id,
      revertReason: "Bounced direct check"
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" }
  };

  resStatus = 200;
  resJson = null;
  await financialController.revertSettlement(revertRecReq, res);
  assert.equal(resStatus, 200, "Receivable revert should succeed");
  assert.equal(resJson.restoredStatus, "UNPAID");

  // 5a. A discount given closes the receivable based on cash plus discount.
  const discountedReceivable = await prisma.accountReceivable.create({
    data: {
      title: `Discounted Receivable ${timestamp}`,
      payerName: "Discount Customer",
      totalAmount: 2000,
      receivedAmount: 0,
      remainingBalance: 2000,
      status: "UNPAID",
    },
  });
  adjustmentReceivables.push(discountedReceivable.id);
  req = {
    body: {
      receivableId: discountedReceivable.id,
      amount: 1800,
      adjustmentType: "DISCOUNT",
      adjustmentAmount: 200,
      toAccountId: testAccount.id,
      idempotencyKey: `REC-DISCOUNT-${timestamp}`,
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
  };
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resJson.success, true, "Discounted receivable collection should succeed");
  let adjustedReceivableState = await prisma.accountReceivable.findUnique({ where: { id: discountedReceivable.id } });
  assert.equal(adjustedReceivableState.status, "SETTLED");
  assert.equal(adjustedReceivableState.receivedAmount, 1800, "Received amount tracks actual cash");
  assert.equal(adjustedReceivableState.remainingBalance, 0);
  assert.equal(adjustedReceivableState.collectionHistory[0].amount, 1800, "History records cash received");
  assert.equal(adjustedReceivableState.collectionHistory[0].settlementAmount, 2000);
  const discountedReceivableJournal = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `CUSTOMER_PAYMENT:REC-DISCOUNT-${timestamp}` },
    include: { lines: { include: { account: true } } },
  });
  assert.equal(Number(discountedReceivableJournal.totalDebit), 2000);
  assert.equal(Number(discountedReceivableJournal.totalCredit), 2000);
  assert.equal(Number(discountedReceivableJournal.lines.find((line) => line.account.accountCode === "6700").debit), 200);
  assert.equal(Number(discountedReceivableJournal.lines.find((line) => line.account.accountCode === "1120").debit), 1800);
  updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 497900, "Treasury increases by the actual Rs 1,800 receipt");

  // 5b. A fine received adds to cash while clearing the original receivable.
  const finedReceivable = await prisma.accountReceivable.create({
    data: {
      title: `Fined Receivable ${timestamp}`,
      payerName: "Late Customer",
      totalAmount: 2000,
      receivedAmount: 0,
      remainingBalance: 2000,
      status: "UNPAID",
    },
  });
  adjustmentReceivables.push(finedReceivable.id);
  req = {
    body: {
      receivableId: finedReceivable.id,
      amount: 2100,
      adjustmentType: "FINE",
      adjustmentAmount: 100,
      toAccountId: testAccount.id,
      idempotencyKey: `REC-FINE-${timestamp}`,
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
  };
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resJson.success, true, "Fined receivable collection should succeed");
  adjustedReceivableState = await prisma.accountReceivable.findUnique({ where: { id: finedReceivable.id } });
  assert.equal(adjustedReceivableState.status, "SETTLED");
  assert.equal(adjustedReceivableState.receivedAmount, 2100, "Received amount includes the actual cash fine");
  assert.equal(adjustedReceivableState.collectionHistory[0].amount, 2100, "History records cash including the fine");
  const finedReceivableJournal = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `CUSTOMER_PAYMENT:REC-FINE-${timestamp}` },
    include: { lines: { include: { account: true } } },
  });
  assert.equal(Number(finedReceivableJournal.totalDebit), 2100);
  assert.equal(Number(finedReceivableJournal.totalCredit), 2100);
  assert.equal(Number(finedReceivableJournal.lines.find((line) => line.account.accountCode === "8100").credit), 100);
  assert.equal(Number(finedReceivableJournal.lines.find((line) => line.account.accountCode === "1120").debit), 2100);
  updatedAccount = await prisma.financialAccount.findUnique({ where: { id: testAccount.id } });
  assert.equal(updatedAccount.currentBalance, 500000, "Treasury increases by the actual Rs 2,100 receipt");

  // 7. Test Multiple Partial Collections for Single Receivable + Duplicate Transaction Prevention
  const multiReceivable = await prisma.accountReceivable.create({
    data: {
      title: `Multi-Installment Customer Due ${timestamp}`,
      payerName: "Retail Store Chain",
      category: "CUSTOMER_RECEIVABLE",
      totalAmount: 30000,
      receivedAmount: 0,
      remainingBalance: 30000,
      status: "UNPAID"
    }
  });

  const txKey1 = `COLL-TEST-1-${timestamp}`;
  // 7a. First installment: Rs 10,000
  req = {
    body: {
      receivableId: multiReceivable.id,
      amount: 10000,
      toAccountId: testAccount.id,
      notes: "First installment: Cheque",
      idempotencyKey: txKey1,
      partial: true
    },
    user: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" },
    auth: { id: "test-admin", role: "ADMIN", email: "admin@aama.com" }
  };
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resStatus, 200, "First installment collection of Rs 10,000 should succeed");
  let recState = await prisma.accountReceivable.findUnique({ where: { id: multiReceivable.id } });
  assert.equal(recState.receivedAmount, 10000);
  assert.equal(recState.remainingBalance, 20000);
  assert.equal(recState.status, "PARTIALLY_RECEIVED");

  // 7b. Attempt duplicate execution of the exact same transaction (same idempotencyKey) -> Expect 409 Conflict
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resStatus, 409, "Duplicate transaction with same idempotencyKey must be rejected with 409");
  assert.equal(resJson.alreadyProcessed, true);

  // 7c. Attempt rapid duplicate click without key -> Expect 409 Conflict from debounce
  req.body.idempotencyKey = undefined;
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resStatus, 409, "Rapid duplicate transaction must be rejected with 409");
  assert.equal(resJson.alreadyProcessed, true);

  // 7d. Legitimate second installment: Rs 15,000 (different payment event with unique key)
  const txKey2 = `COLL-TEST-2-${timestamp}`;
  req.body.amount = 15000;
  req.body.idempotencyKey = txKey2;
  req.body.notes = "Second installment: Bank Transfer";
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resStatus, 200, "Legitimate second partial collection of Rs 15,000 should succeed");
  recState = await prisma.accountReceivable.findUnique({ where: { id: multiReceivable.id } });
  assert.equal(recState.receivedAmount, 25000);
  assert.equal(recState.remainingBalance, 5000);
  assert.equal(recState.status, "PARTIALLY_RECEIVED");

  // 7e. Final installment: Rs 5,000 -> completes to SETTLED
  const txKey3 = `COLL-TEST-3-${timestamp}`;
  req.body.amount = 5000;
  req.body.idempotencyKey = txKey3;
  req.body.notes = "Final installment: Cash";
  resStatus = 200;
  resJson = null;
  await financialController.collectReceivable(req, res);
  assert.equal(resStatus, 200, "Final installment should succeed");
  recState = await prisma.accountReceivable.findUnique({ where: { id: multiReceivable.id } });
  assert.equal(recState.receivedAmount, 30000);
  assert.equal(recState.remainingBalance, 0);
  assert.equal(recState.status, "SETTLED");

  // Cleanup test records
  await prisma.settlementReversion.deleteMany({
    where: { originalRecordId: { in: [testPayable.id, testReceivable.id, multiReceivable.id, ...adjustmentPayables, ...adjustmentReceivables] } }
  });
  await prisma.cashTransaction.deleteMany({
    where: {
      OR: [
        { fromAccountId: testAccount.id },
        { toAccountId: testAccount.id }
      ]
    }
  });
  await prisma.accountPayable.delete({ where: { id: testPayable.id } });
  await prisma.accountPayable.deleteMany({ where: { id: { in: adjustmentPayables } } });
  await prisma.accountReceivable.delete({ where: { id: testReceivable.id } });
  await prisma.accountReceivable.delete({ where: { id: multiReceivable.id } });
  await prisma.accountReceivable.deleteMany({ where: { id: { in: adjustmentReceivables } } });
  await prisma.financialAccount.delete({ where: { id: testAccount.id } });

  console.log("ALL IDEMPOTENCY, MULTI-PARTIAL & REVERSION TESTS PASSED PERFECTLY!");
});
