import assert from "node:assert/strict";
import test from "node:test";
import { createSupplierReturn } from "../services/supplierReturnService.js";

const createHarness = ({ failJournal = false, failAudit = false } = {}) => {
  const state = {
    products: [
      { id: "product-1", name: "Shirt", stockQuantity: 5 },
      { id: "product-2", name: "Jacket", stockQuantity: 3 },
    ],
    accountingParties: [
      { id: "party-vendor-42", partyType: "VENDOR", status: "ACTIVE", sourceEntityId: "VENDOR-42", displayName: "Example Garments" },
    ],
    supplierReturns: [],
    stockLogs: [],
    cashTransactions: [],
    documents: [],
    journals: [],
    audits: [],
    treasury: {
      id: "treasury-1",
      status: "ACTIVE",
      currency: "NPR",
      accountType: "BANK",
      accountingAccountId: "gl-bank",
      currentBalance: 1000,
      reservedBalance: 100,
      accountingAccount: { isActive: true },
    },
  };
  const createTransactionState = () => ({
    ...state,
    products: state.products.map((product) => ({ ...product })),
    accountingParties: state.accountingParties.map((party) => ({ ...party })),
    supplierReturns: state.supplierReturns.map((record) => ({ ...record })),
    stockLogs: [...state.stockLogs],
    cashTransactions: [...state.cashTransactions],
    documents: [...state.documents],
    journals: [...state.journals],
    audits: [...state.audits],
    treasury: { ...state.treasury, accountingAccount: { ...state.treasury.accountingAccount } },
  });
  const createTx = (working) => ({
    accountingParty: {
      findFirst: async ({ where }) => working.accountingParties.find((party) =>
        party.id === where.id && party.partyType === where.partyType && party.status === where.status,
      ) || null,
    },
    supplierReturn: {
      findUnique: async ({ where }) => working.supplierReturns.find((record) => record.requestKey === where.requestKey) || null,
      create: async ({ data }) => {
        const record = { id: `return-${working.supplierReturns.length + 1}`, ...data };
        working.supplierReturns.push(record);
        return record;
      },
      update: async ({ where, data }) => {
        const record = working.supplierReturns.find((candidate) => candidate.id === where.id);
        Object.assign(record, data);
        return record;
      },
    },
    inboundShipment: {
      findUnique: async () => null,
    },
    product: {
      findUnique: async ({ where }) => working.products.find((product) => product.id === where.id) || null,
      updateMany: async ({ where, data }) => {
        const product = working.products.find((candidate) =>
          candidate.id === where.id && candidate.stockQuantity === where.stockQuantity
        );
        if (!product) return { count: 0 };
        product.stockQuantity -= data.stockQuantity.decrement;
        return { count: 1 };
      },
    },
    stockLog: {
      create: async ({ data }) => {
        working.stockLogs.push(data);
        return data;
      },
    },
    financialAccount: {
      findUnique: async () => working.treasury,
      updateMany: async ({ where, data }) => {
        if (
          where.currentBalance !== working.treasury.currentBalance
          || where.reservedBalance !== working.treasury.reservedBalance
          || working.treasury.status !== "ACTIVE"
        ) return { count: 0 };
        working.treasury.currentBalance += Number(data.currentBalance.increment);
        return { count: 1 };
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        const transaction = { id: `cash-${working.cashTransactions.length + 1}`, ...data };
        working.cashTransactions.push(transaction);
        return transaction;
      },
    },
    accountingDocument: {
      create: async ({ data }) => {
        const document = { id: `document-${working.documents.length + 1}`, ...data };
        working.documents.push(document);
        return document;
      },
    },
    journalEntry: {
      create: async ({ data }) => {
        const journal = { id: `journal-${working.journals.length + 1}`, journalNumber: `JE-${working.journals.length + 1}`, ...data };
        working.journals.push(journal);
        return journal;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        working.audits.push(data);
        return { id: `audit-${working.audits.length}` };
      },
    },
  });
  const client = {
    $transaction: async (callback) => {
      const working = createTransactionState();
      const result = await callback(createTx(working));
      Object.assign(state, working);
      return result;
    },
    supplierReturn: {
      findUnique: async ({ where }) => state.supplierReturns.find((record) => record.requestKey === where.requestKey) || null,
    },
  };
  const dependencies = {
    documentService: async (data, { client: transactionClient }) => {
      return transactionClient.accountingDocument.create({ data });
    },
    journalPoster: async (data) => {
      if (failJournal) throw new Error("Injected supplier-return journal failure.");
      return data.client.journalEntry.create({ data });
    },
    writeAudit: async (_actor, event, { client: transactionClient }) => {
      if (failAudit) throw new Error("Injected supplier-return audit failure.");
      return transactionClient.systemAuditOutbox.create({ data: event });
    },
  };
  return { state, client, dependencies };
};

const buildInput = (overrides = {}) => ({
  requestKey: "supplier-return-request-1",
  supplierPartyId: "party-vendor-42",
  supplierName: "Example Garments",
  supplierReference: "VENDOR-42",
  supplierInvoiceNumber: "INV-2026-44",
  vatReversal: "25.00",
  settlementType: "CREDIT_NOTE_OFFSET_PAYABLE",
  reason: "Defective stitching",
  items: [
    { productId: "product-1", name: "Shirt", quantity: 2, unitCostPrice: "100.00" },
    { productId: "product-2", name: "Jacket", quantity: 1, unitCostPrice: "50.00" },
  ],
  ...overrides,
});

test("supplier credit note, inventory, journal, and audit commit atomically and replay once", async () => {
  const { state, client, dependencies } = createHarness();
  const actorContext = { actorId: "admin-1", actorRole: "ADMIN", portalSource: "ADMIN" };
  const first = await createSupplierReturn({ input: buildInput(), actorContext, client, ...dependencies });
  const replay = await createSupplierReturn({ input: buildInput(), actorContext, client, ...dependencies });
  await assert.rejects(
    createSupplierReturn({
      input: buildInput({ items: [{ productId: "product-1", quantity: 1, unitCostPrice: "100.00" }] }),
      actorContext,
      client,
      ...dependencies,
    }),
    (error) => error.code === "SUPPLIER_RETURN_IDEMPOTENCY_CONFLICT",
  );

  assert.equal(first.isReplay, false);
  assert.equal(replay.isReplay, true);
  assert.equal(state.supplierReturns.length, 1);
  assert.equal(state.products[0].stockQuantity, 3);
  assert.equal(state.products[1].stockQuantity, 2);
  assert.equal(state.stockLogs.length, 2);
  assert.equal(state.documents[0].documentType, "CREDIT_NOTE");
  assert.equal(state.documents[0].side, "PAYABLE");
  assert.equal(state.documents[0].amount.toString(), "250");
  assert.equal(state.journals.length, 1);
  assert.deepEqual(state.journals[0].lines.map((line) => ({
    account: line.mappingKey,
    debit: Number(line.debit),
    credit: Number(line.credit),
  })), [
    { account: "AP_CONTROL", debit: 250, credit: 0 },
    { account: "INVENTORY", debit: 0, credit: 225 },
    { account: "INPUT_VAT_RECEIVABLE", debit: 0, credit: 25 },
  ]);
  assert.equal(state.audits.length, 1);
});

test("cash refund requires a mapped Treasury account and records a balanced source event", async () => {
  const { state, client, dependencies } = createHarness();
  const input = buildInput({
    requestKey: "supplier-return-cash-1",
    settlementType: "CASH_REFUND",
    depositAccountId: "treasury-1",
  });

  const result = await createSupplierReturn({ input, client, ...dependencies });

  assert.equal(result.supplierReturnRecord.cashTransactionId, "cash-1");
  assert.equal(state.treasury.currentBalance, 1250);
  assert.equal(state.cashTransactions.length, 1);
  assert.equal(state.documents.length, 0);
  assert.equal(state.journals[0].lines[0].accountId, "gl-bank");
  assert.equal(state.journals[0].lines[0].debit.toString(), "250");
});

test("supplier-return serializable conflicts retry without duplicating effects", async () => {
  const { state, client, dependencies } = createHarness();
  const transaction = client.$transaction;
  let attempts = 0;
  client.$transaction = async (...args) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("Serialization conflict"), { code: "P2034" });
    return transaction(...args);
  };

  const result = await createSupplierReturn({ input: buildInput(), client, ...dependencies });

  assert.equal(result.isReplay, false);
  assert.equal(attempts, 2);
  assert.equal(state.supplierReturns.length, 1);
  assert.equal(state.journals.length, 1);
  assert.equal(state.stockLogs.length, 2);
});

test("journal failure rolls back supplier return, stock, Treasury, document, and audit writes", async () => {
  const { state, client, dependencies } = createHarness({ failJournal: true });

  await assert.rejects(
    createSupplierReturn({ input: buildInput(), client, ...dependencies }),
    /Injected supplier-return journal failure/,
  );

  assert.equal(state.supplierReturns.length, 0);
  assert.equal(state.products[0].stockQuantity, 5);
  assert.equal(state.products[1].stockQuantity, 3);
  assert.equal(state.stockLogs.length, 0);
  assert.equal(state.documents.length, 0);
  assert.equal(state.audits.length, 0);
});

test("supplier return rejects unsupported VAT, missing invoices, and inventory oversell", async () => {
  const { client, dependencies } = createHarness();
  await assert.rejects(
    createSupplierReturn({
      input: buildInput({ supplierInvoiceNumber: "", vatReversal: "1.00" }),
      client,
      ...dependencies,
    }),
    (error) => error.code === "SUPPLIER_INVOICE_EVIDENCE_REQUIRED",
  );
  await assert.rejects(
    createSupplierReturn({
      input: buildInput({ requestKey: "supplier-return-too-many", items: [
        { productId: "product-1", quantity: 6, unitCostPrice: "10.00" },
      ], vatReversal: "0.00" }),
      client,
      ...dependencies,
    }),
    (error) => error.code === "SUPPLIER_RETURN_STOCK_INSUFFICIENT",
  );
});
