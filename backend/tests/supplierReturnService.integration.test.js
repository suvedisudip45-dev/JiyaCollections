import "../utils/requireIntegrationDatabaseSafety.js";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../config/db.js";
import { createSupplierReturn } from "../services/supplierReturnService.js";

const isAuthorizedLocalSandbox = () => {
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must identify the authorized local accounting sandbox.");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL for the authorized local accounting sandbox.");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || databaseName !== "clothing") {
    throw new Error("Refusing supplier return integration test outside the authorized local clothing sandbox.");
  }
  return true;
};

const skip = !isAuthorizedLocalSandbox();
const rollbackSignal = new Error("Rollback supplier return integration fixture.");

const createProductFixture = async (tx, id) => tx.product.create({
  data: {
    id,
    name: `Integration Return Product ${id.slice(0, 8)}`,
    description: "Rollback-only supplier return integration fixture.",
    price: 100,
    image: [],
    category: "Integration",
    subCategory: "Accounting",
    sizes: [],
    date: BigInt(Date.now()),
    stockQuantity: 10,
    costPrice: 100,
  },
});

const createInput = (requestKey, productId) => ({
  requestKey,
  supplierName: "Integration Supplier",
  supplierReference: `IT-VENDOR-${requestKey.slice(-8)}`,
  supplierInvoiceNumber: `IT-INV-${requestKey.slice(-8)}`,
  vatReversal: "13.00",
  settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
  reason: "Rollback-only integration test.",
  items: [{ productId, name: "Integration Return Product", quantity: 1, unitCostPrice: "100.00" }],
});

test("supplier return credit note, inventory, and journal share one database transaction", { skip }, async () => {
  const requestKey = `IT-SUPPLIER-${randomUUID()}`;
  const productId = randomUUID();
  let returnId;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await createProductFixture(tx, productId);
      const result = await createSupplierReturn({
        input: createInput(requestKey, productId),
        actorContext: { actorId: "integration-admin", actorRole: "ADMIN", portalSource: "ADMIN" },
        client: tx,
      });
      const supplierReturn = result.supplierReturnRecord;
      returnId = supplierReturn.id;
      assert.equal(supplierReturn.status, "COMPLETED");
      assert.equal(supplierReturn.totalDebitAmount, 100);
      assert.equal(supplierReturn.vatReversal, 13);
      assert.equal((await tx.product.findUnique({ where: { id: productId } })).stockQuantity, 9);

      const creditNote = await tx.accountingDocument.findUnique({
        where: { id: supplierReturn.accountingDocumentId },
      });
      assert.equal(creditNote.documentType, "CREDIT_NOTE");
      assert.equal(creditNote.side, "PAYABLE");
      assert.equal(creditNote.originalAmount.toFixed(2), "100.00");

      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: `SUPPLIER_RETURN:${supplierReturn.id}` },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(journal);
      assert.equal(journal.totalDebit.toFixed(2), "100.00");
      assert.equal(journal.totalCredit.toFixed(2), "100.00");
      assert.deepEqual(
        journal.lines.map(({ account, debit, credit }) => ({
          accountCode: account.accountCode,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        })).sort((left, right) => left.accountCode.localeCompare(right.accountCode)),
        [
          { accountCode: "1140", debit: "0.00", credit: "87.00" },
          { accountCode: "1150", debit: "0.00", credit: "13.00" },
          { accountCode: "2110", debit: "100.00", credit: "0.00" },
        ],
      );
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.supplierReturn.count({ where: { requestKey } }), 0);
  assert.equal(await prisma.accountingDocument.count({ where: { sourceType: "SUPPLIER_RETURN", sourceId: returnId } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { sourceType: "SUPPLIER_RETURN", sourceId: returnId } }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
  assert.equal(await prisma.stockLog.count({ where: { productId } }), 0);
});

test("supplier return audit failure rolls back stock, credit note, and accounting journal", { skip }, async () => {
  const requestKey = `IT-SUPPLIER-AUDIT-${randomUUID()}`;
  const productId = randomUUID();
  let returnId;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await createProductFixture(tx, productId);
      await createSupplierReturn({
        input: createInput(requestKey, productId),
        actorContext: { actorId: "integration-admin", actorRole: "ADMIN", portalSource: "ADMIN" },
        client: tx,
        writeAudit: async (_actor, event) => {
          returnId = event.entityId;
          throw new Error("Injected supplier-return audit failure.");
        },
      });
    }),
    /Injected supplier-return audit failure/,
  );

  assert.equal(await prisma.supplierReturn.count({ where: { requestKey } }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
  assert.equal(await prisma.stockLog.count({ where: { productId } }), 0);
  assert.ok(returnId);
  assert.equal(await prisma.accountingDocument.count({ where: { sourceType: "SUPPLIER_RETURN", sourceId: returnId } }), 0);
  assert.equal(await prisma.journalEntry.count({ where: { sourceType: "SUPPLIER_RETURN", sourceId: returnId } }), 0);
});

test("supplier cash refund posts to mapped Treasury and rolls back with its source event", { skip }, async (t) => {
  const treasury = await prisma.financialAccount.findFirst({
    where: {
      status: "ACTIVE",
      currency: "NPR",
      accountType: { in: ["CASH", "BANK", "WALLET"] },
      accountingAccountId: { not: null },
      accountingAccount: { isActive: true },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!treasury) {
    t.skip("No active mapped NPR Treasury account is configured in the local sandbox.");
    return;
  }

  const requestKey = `IT-SUPPLIER-CASH-${randomUUID()}`;
  const productId = randomUUID();
  let returnId;
  const initialBalance = treasury.currentBalance;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await createProductFixture(tx, productId);
      const result = await createSupplierReturn({
        input: {
          ...createInput(requestKey, productId),
          supplierInvoiceNumber: "",
          vatReversal: "0",
          settlementType: "CASH_REFUND",
          depositAccountId: treasury.id,
        },
        actorContext: { actorId: "integration-admin", actorRole: "ADMIN", portalSource: "ADMIN" },
        client: tx,
      });
      const supplierReturn = result.supplierReturnRecord;
      returnId = supplierReturn.id;
      assert.equal(supplierReturn.accountingDocumentId, null);
      assert.ok(supplierReturn.cashTransactionId);
      const cashTransaction = await tx.cashTransaction.findUnique({
        where: { id: supplierReturn.cashTransactionId },
      });
      assert.equal(cashTransaction.type, "INFLOW");
      assert.equal(cashTransaction.amount.toFixed(2), "100.00");
      const updatedTreasury = await tx.financialAccount.findUnique({ where: { id: treasury.id } });
      assert.equal(updatedTreasury.currentBalance.toFixed(2), initialBalance.plus(100).toFixed(2));
      const journal = await tx.journalEntry.findUnique({
        where: { idempotencyKey: `SUPPLIER_RETURN:${supplierReturn.id}` },
        include: { lines: { include: { account: true } } },
      });
      assert.ok(journal);
      const treasuryLine = journal.lines.find(({ account }) => account.id === treasury.accountingAccountId);
      assert.equal(treasuryLine.debit.toFixed(2), "100.00");
      throw rollbackSignal;
    }),
    (error) => error === rollbackSignal,
  );

  assert.equal(await prisma.supplierReturn.count({ where: { requestKey } }), 0);
  assert.equal(await prisma.cashTransaction.count({ where: { referenceId: returnId } }), 0);
  assert.equal(await prisma.journalEntry.count({
    where: { idempotencyKey: `SUPPLIER_RETURN:${returnId}` },
  }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
});
