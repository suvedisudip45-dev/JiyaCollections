import "../utils/requireIntegrationDatabaseSafety.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { applyManufacturerCreditToBill } from "../services/supplierCreditApplicationService.js";

test("supplier credit application updates both documents, allocations, and idempotent replay atomically", {
  skip: process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1",
}, async () => {
  const suffix = randomUUID();
  const idempotencyPrefix = `TEST-SUPPLIER-CREDIT-${suffix}`;
  const created = {
    manufacturerId: null,
    partyId: null,
    returnId: null,
    journalId: null,
    documentIds: [],
  };

  try {
    const payableAccount = await prisma.account.findUnique({ where: { accountCode: "2160" } });
    const expenseAccount = await prisma.account.findUnique({ where: { accountCode: "5100" } });
    assert.ok(payableAccount, "Manufacturer payable GL account 2160 must exist");
    assert.ok(expenseAccount, "Expense GL account 5100 must exist");

    const manufacturer = await prisma.manufacturer.create({
      data: {
        name: `Integration Manufacturer ${suffix}`,
        email: `supplier-credit-${suffix}@example.test`,
        phone: "9800000000",
        city: "Kathmandu",
      },
    });
    created.manufacturerId = manufacturer.id;
    const party = await prisma.accountingParty.create({
      data: {
        partyType: "MANUFACTURER",
        sourceEntityId: manufacturer.id,
        displayName: manufacturer.name,
        currency: "NPR",
      },
    });
    created.partyId = party.id;

    const returnRecord = await prisma.customerReturn.create({
      data: {
        orderId: `TEST-ORDER-${suffix}`,
        manufacturerId: manufacturer.id,
        customerName: "Integration Test Customer",
        reason: "Database integration test supplier credit",
        refundStatus: "COMPLETED",
        lifecycleStatus: "COMPLETED",
      },
    });
    created.returnId = returnRecord.id;

    const journal = await prisma.journalEntry.create({
      data: {
        journalNumber: `TEST-SUPPLIER-CREDIT-${suffix}`,
        sourceType: "DELIVERY_RETURN",
        sourceId: returnRecord.id,
        idempotencyKey: `${idempotencyPrefix}:RETURN-JOURNAL`,
        description: "Integration test manufacturer payable return reversal",
        totalDebit: 20,
        totalCredit: 20,
        lines: {
          create: [
            {
              accountId: payableAccount.id,
              debit: 20,
              credit: 0,
              supplierId: manufacturer.id,
              supplierName: manufacturer.name,
            },
            {
              accountId: expenseAccount.id,
              debit: 0,
              credit: 20,
            },
          ],
        },
      },
    });
    created.journalId = journal.id;

    const credit = await prisma.accountingDocument.create({
      data: {
        documentType: "CREDIT_NOTE",
        documentNumber: `TEST-CREDIT-${suffix}`,
        partyId: party.id,
        side: "RECEIVABLE",
        sourceType: "MANUFACTURER_DELIVERY_RETURN",
        sourceId: returnRecord.id,
        originalAmount: 20,
        remainingAmount: 20,
        status: "OPEN",
      },
    });
    created.documentIds.push(credit.id);

    const bill = await prisma.accountingDocument.create({
      data: {
        documentType: "BILL",
        documentNumber: `TEST-BILL-${suffix}`,
        partyId: party.id,
        side: "PAYABLE",
        sourceType: "MANUFACTURER_DELIVERY_COGS",
        sourceId: returnRecord.orderId,
        originalAmount: 100,
        allocatedAmount: 10,
        remainingAmount: 90,
        status: "PARTIALLY_PAID",
      },
    });
    created.documentIds.push(bill.id);

    const input = {
      manufacturerId: manufacturer.id,
      creditDocumentId: credit.id,
      billDocumentId: bill.id,
      amount: "12.50",
      idempotencyKey: `${idempotencyPrefix}:APPLICATION`,
      appliedByAccountId: "integration-test",
      notes: "Apply verified integration-test credit.",
      writeAudit: async () => {},
    };
    const result = await applyManufacturerCreditToBill(input);
    assert.equal(result.isReplay, undefined);
    assert.equal(result.journalEntryId, journal.id);
    assert.equal(result.journalPostedForApplication, false);

    const [updatedCredit, updatedBill, allocations, application, journalCount] = await Promise.all([
      prisma.accountingDocument.findUnique({ where: { id: credit.id } }),
      prisma.accountingDocument.findUnique({ where: { id: bill.id } }),
      prisma.accountingAllocation.findMany({
        where: { idempotencyKey: { in: [`${input.idempotencyKey}:CREDIT`, `${input.idempotencyKey}:BILL`] } },
      }),
      prisma.supplierCreditApplication.findUnique({ where: { idempotencyKey: input.idempotencyKey } }),
      prisma.journalEntry.count({ where: { sourceType: "DELIVERY_RETURN", sourceId: returnRecord.id } }),
    ]);

    assert.equal(updatedCredit.remainingAmount.toFixed(2), "7.50");
    assert.equal(updatedCredit.allocatedAmount.toFixed(2), "12.50");
    assert.equal(updatedCredit.status, "PARTIALLY_PAID");
    assert.equal(updatedBill.remainingAmount.toFixed(2), "77.50");
    assert.equal(updatedBill.allocatedAmount.toFixed(2), "22.50");
    assert.equal(updatedBill.status, "PARTIALLY_PAID");
    assert.equal(allocations.length, 2);
    assert.ok(allocations.every(({ journalEntryId, amount }) =>
      journalEntryId === journal.id && amount.toFixed(2) === "12.50"));
    assert.equal(application.journalEntryId, journal.id);
    assert.equal(application.amount.toFixed(2), "12.50");
    assert.equal(journalCount, 1, "Applying the credit must not post a duplicate journal");

    const replay = await applyManufacturerCreditToBill(input);
    assert.equal(replay.isReplay, true);
    assert.equal(await prisma.accountingAllocation.count({
      where: { idempotencyKey: { in: [`${input.idempotencyKey}:CREDIT`, `${input.idempotencyKey}:BILL`] } },
    }), 2);
    await assert.rejects(
      applyManufacturerCreditToBill({ ...input, amount: "10.00" }),
      { code: "IDEMPOTENCY_KEY_REUSED" },
    );

    const concurrentApplications = await Promise.allSettled(["A", "B"].map((suffix) =>
      applyManufacturerCreditToBill({
        ...input,
        amount: "5.00",
        idempotencyKey: `${idempotencyPrefix}:CONCURRENT-${suffix}`,
      })));
    assert.equal(
      concurrentApplications.filter(({ status }) => status === "fulfilled").length,
      1,
      "Only one competing application may consume the remaining supplier credit",
    );
    assert.equal(concurrentApplications.filter(({ status }) => status === "rejected").length, 1);
    const rejectedApplication = concurrentApplications.find(({ status }) => status === "rejected");
    assert.equal(rejectedApplication.reason.code, "CREDIT_APPLICATION_EXCEEDS_BALANCE");

    const [creditAfterRace, billAfterRace, raceApplications, raceAllocations] = await Promise.all([
      prisma.accountingDocument.findUnique({ where: { id: credit.id } }),
      prisma.accountingDocument.findUnique({ where: { id: bill.id } }),
      prisma.supplierCreditApplication.findMany({
        where: { idempotencyKey: { startsWith: `${idempotencyPrefix}:CONCURRENT-` } },
      }),
      prisma.accountingAllocation.findMany({
        where: {
          idempotencyKey: {
            in: [
              `${idempotencyPrefix}:CONCURRENT-A:CREDIT`,
              `${idempotencyPrefix}:CONCURRENT-A:BILL`,
              `${idempotencyPrefix}:CONCURRENT-B:CREDIT`,
              `${idempotencyPrefix}:CONCURRENT-B:BILL`,
            ],
          },
        },
      }),
    ]);
    assert.equal(creditAfterRace.remainingAmount.toFixed(2), "2.50");
    assert.equal(creditAfterRace.allocatedAmount.toFixed(2), "17.50");
    assert.equal(billAfterRace.remainingAmount.toFixed(2), "72.50");
    assert.equal(billAfterRace.allocatedAmount.toFixed(2), "27.50");
    assert.equal(raceApplications.length, 1);
    assert.equal(raceAllocations.length, 2);

    const rollbackKey = `${idempotencyPrefix}:ROLLBACK`;
    await assert.rejects(
      applyManufacturerCreditToBill({
        ...input,
        amount: "1.00",
        idempotencyKey: rollbackKey,
        writeAudit: async () => {
          throw new Error("Injected audit failure for transaction rollback test");
        },
      }),
      /Injected audit failure for transaction rollback test/,
    );
    const [creditAfterRollback, billAfterRollback, rollbackApplicationCount, rollbackAllocationCount] =
      await Promise.all([
        prisma.accountingDocument.findUnique({ where: { id: credit.id } }),
        prisma.accountingDocument.findUnique({ where: { id: bill.id } }),
        prisma.supplierCreditApplication.count({ where: { idempotencyKey: rollbackKey } }),
        prisma.accountingAllocation.count({
          where: { idempotencyKey: { in: [`${rollbackKey}:CREDIT`, `${rollbackKey}:BILL`] } },
        }),
      ]);
    assert.equal(creditAfterRollback.remainingAmount.toFixed(2), "2.50");
    assert.equal(creditAfterRollback.allocatedAmount.toFixed(2), "17.50");
    assert.equal(billAfterRollback.remainingAmount.toFixed(2), "72.50");
    assert.equal(billAfterRollback.allocatedAmount.toFixed(2), "27.50");
    assert.equal(rollbackApplicationCount, 0);
    assert.equal(rollbackAllocationCount, 0);

    const afterRollbackRetry = await applyManufacturerCreditToBill({
      ...input,
      amount: "1.00",
      idempotencyKey: rollbackKey,
    });
    assert.equal(afterRollbackRetry.isReplay, undefined);
    assert.equal(await prisma.supplierCreditApplication.count({ where: { idempotencyKey: rollbackKey } }), 1);

    const sameKeyInput = {
      ...input,
      amount: "0.50",
      idempotencyKey: `${idempotencyPrefix}:CONCURRENT-REPLAY`,
    };
    const sameKeyRace = await Promise.all([
      applyManufacturerCreditToBill(sameKeyInput),
      applyManufacturerCreditToBill(sameKeyInput),
    ]);
    assert.equal(sameKeyRace.filter(({ isReplay }) => isReplay === true).length, 1);
    assert.equal(sameKeyRace.filter(({ isReplay }) => isReplay !== true).length, 1);
    assert.equal(await prisma.supplierCreditApplication.count({
      where: { idempotencyKey: sameKeyInput.idempotencyKey },
    }), 1);
    assert.equal(await prisma.accountingAllocation.count({
      where: {
        idempotencyKey: {
          in: [`${sameKeyInput.idempotencyKey}:CREDIT`, `${sameKeyInput.idempotencyKey}:BILL`],
        },
      },
    }), 2);
  } finally {
    if (created.documentIds.length) {
      await prisma.accountingAllocation.deleteMany({ where: { documentId: { in: created.documentIds } } });
      await prisma.supplierCreditApplication.deleteMany({
        where: { creditDocumentId: { in: created.documentIds } },
      });
      await prisma.accountingDocument.deleteMany({ where: { id: { in: created.documentIds } } });
    }
    if (created.journalId) {
      await prisma.journalLine.deleteMany({ where: { journalEntryId: created.journalId } });
      await prisma.journalEntry.deleteMany({ where: { id: created.journalId } });
    }
    if (created.returnId) await prisma.customerReturn.deleteMany({ where: { id: created.returnId } });
    if (created.partyId) await prisma.accountingParty.deleteMany({ where: { id: created.partyId } });
    if (created.manufacturerId) await prisma.manufacturer.deleteMany({ where: { id: created.manufacturerId } });
  }
});
