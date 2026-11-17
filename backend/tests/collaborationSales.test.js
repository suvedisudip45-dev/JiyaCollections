import assert from "node:assert/strict";
import test from "node:test";

import {
  accrueCollaborationSalesForOrder,
  applyCollaborationReturnAdjustments,
  calculateCollaborationFeeAmounts,
  finalizeCollaborationFeeInvoice,
} from "../services/collaborationSalesService.js";

test("delivery accrual only updates pending sale rows", async () => {
  let update;
  const count = await accrueCollaborationSalesForOrder({
    orderId: "order-1",
    deliveredAt: new Date("2026-09-10T00:00:00.000Z"),
    client: { collaborationSale: { updateMany: async (value) => { update = value; return { count: 1 }; } } },
  });

  assert.equal(count, 1);
  assert.deepEqual(update.where, { orderId: "order-1", status: "PENDING_DELIVERY" });
  assert.equal(update.data.status, "ACCRUED");
});

test("partial and full returns update retained sale quantities without exceeding sold units", async () => {
  const sale = {
    id: "sale-1",
    productId: "product-1",
    size: "M",
    color: "White",
    quantity: 3,
    quantityReturned: 0,
    status: "ACCRUED",
  };
  const client = {
    collaborationSale: {
      findMany: async () => [sale],
      update: async ({ data }) => {
        Object.assign(sale, data);
        return { ...sale };
      },
    },
  };

  const partial = await applyCollaborationReturnAdjustments({
    orderId: "order-1",
    items: [{ productId: "product-1", size: "M", color: "White", quantity: 1 }],
    client,
  });
  assert.equal(partial[0].sale.quantityReturned, 1);
  assert.equal(partial[0].sale.status, "PARTIALLY_REVERSED");

  const full = await applyCollaborationReturnAdjustments({
    orderId: "order-1",
    items: [{ productId: "product-1", size: "M", color: "White", quantity: 2 }],
    client,
  });
  assert.equal(full[0].sale.quantityReturned, 3);
  assert.equal(full[0].sale.status, "REVERSED");

  await assert.rejects(
    applyCollaborationReturnAdjustments({
      orderId: "order-1",
      items: [{ productId: "product-1", size: "M", color: "White", quantity: 1 }],
      client,
    }),
    /exceeds sold collaboration quantity/
  );
});

test("collaboration fee invoices apply VAT-exclusive, VAT-inclusive, or exempt terms", () => {
  const exclusive = calculateCollaborationFeeAmounts(100, 2, "VAT_EXCLUSIVE", 13);
  assert.equal(exclusive.netAmount.toString(), "200");
  assert.equal(exclusive.vatAmount.toString(), "26");
  assert.equal(exclusive.totalAmount.toString(), "226");

  const inclusive = calculateCollaborationFeeAmounts(113, 1, "VAT_INCLUSIVE", 13);
  assert.equal(inclusive.netAmount.toString(), "100");
  assert.equal(inclusive.vatAmount.toString(), "13");
  assert.equal(inclusive.totalAmount.toString(), "113");

  const exempt = calculateCollaborationFeeAmounts(100, 1, "EXEMPT", 13);
  assert.equal(exempt.netAmount.toString(), "100");
  assert.equal(exempt.vatAmount.toString(), "0");
  assert.equal(exempt.totalAmount.toString(), "100");

  const unregistered = calculateCollaborationFeeAmounts(100, 1, "VAT_EXCLUSIVE");
  assert.equal(unregistered.vatAmount.toString(), "0");
  assert.equal(unregistered.totalAmount.toString(), "100");
});

const createInvoiceHarness = ({ failPosting = false, failSaleUpdate = false } = {}) => {
  const state = {
    invoice: {
      id: "invoice-1",
      status: "PENDING_POSTING",
      invoiceNumber: "COL-TEST-202609",
      totalAmount: 226,
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      issuedAt: new Date("2026-10-01T00:00:00.000Z"),
      accountingDocumentId: null,
      lines: [{ saleId: "sale-1", entryType: "FEE", quantity: 2 }],
    },
    sale: { id: "sale-1", quantityInvoiced: 0, quantityCredited: 0 },
    documents: [],
    journals: [],
  };
  let transactionCount = 0;
  const client = {
    $transaction: async (callback, options) => {
      transactionCount += 1;
      assert.equal(options.isolationLevel, "Serializable");
      const transactionState = {
        ...state,
        invoice: { ...state.invoice, lines: state.invoice.lines.map((line) => ({ ...line })) },
        sale: { ...state.sale },
        documents: [...state.documents],
        journals: [...state.journals],
      };
      const tx = {
        collaborationFeeInvoice: {
          findUnique: async ({ where }) => transactionState.invoice.id === where.id
            ? transactionState.invoice
            : null,
          update: async ({ where, data }) => {
            assert.equal(where.id, transactionState.invoice.id);
            Object.assign(transactionState.invoice, data);
            return transactionState.invoice;
          },
        },
        accountingDocument: {
          findUnique: async ({ where }) => transactionState.documents.find(({ id }) => id === where.id) || null,
          findFirst: async ({ where }) => transactionState.documents.find(
            (document) => document.sourceType === where.sourceType && document.sourceId === where.sourceId,
          ) || null,
          create: async ({ data }) => {
            const document = { id: "document-1", ...data };
            transactionState.documents.push(document);
            return document;
          },
        },
        collaborationSale: {
          update: async ({ where, data }) => {
            if (failSaleUpdate) throw new Error("Collaboration sale update failed.");
            assert.equal(where.id, transactionState.sale.id);
            for (const [field, update] of Object.entries(data)) {
              transactionState.sale[field] += update.increment;
            }
            return transactionState.sale;
          },
        },
        journalEntry: {
          create: async ({ data }) => {
            transactionState.journals.push(data);
            return data;
          },
        },
      };
      const result = await callback(tx);
      Object.assign(state, transactionState);
      return result;
    },
  };

  const dependencies = {
    ensureParty: async (input, { client: transactionClient }) => {
      assert.ok(transactionClient);
      assert.equal(input.sourceEntityId, "partner-1");
      return { id: "party-1" };
    },
    createDocument: async (data, { client: transactionClient }) => transactionClient.accountingDocument.create({ data }),
    postAccounting: async ({ invoice, client: transactionClient }) => {
      assert.ok(transactionClient);
      await transactionClient.journalEntry.create({
        data: { idempotencyKey: `COLLABORATION_FEE_INVOICE:${invoice.id}` },
      });
      if (failPosting) throw new Error("Collaboration invoice journal failed.");
      return { id: "journal-1" };
    },
  };

  return { client, state, dependencies, getTransactionCount: () => transactionCount };
};

test("collaboration invoice document, journal, invoice status, and sale quantities commit atomically", async () => {
  const { client, state, dependencies, getTransactionCount } = createInvoiceHarness();
  const invoice = { ...state.invoice };
  const partner = { id: "partner-1", name: "Test Partner" };

  const issued = await finalizeCollaborationFeeInvoice({ invoice, partner, client, ...dependencies });
  const replay = await finalizeCollaborationFeeInvoice({ invoice, partner, client, ...dependencies });

  assert.equal(issued.status, "ISSUED");
  assert.equal(issued.accountingDocumentId, "document-1");
  assert.equal(replay.status, "ISSUED");
  assert.equal(state.invoice.status, "ISSUED");
  assert.equal(state.sale.quantityInvoiced, 2);
  assert.equal(state.documents.length, 1);
  assert.equal(state.journals.length, 1);
  assert.equal(getTransactionCount(), 2);
});

test("collaboration returns exceeding current-period fees issue an AR credit note atomically", async () => {
  const { client, state, dependencies } = createInvoiceHarness();
  state.invoice.netAmount = -100;
  state.invoice.vatAmount = -13;
  state.invoice.totalAmount = -113;
  state.invoice.lines = [{ saleId: "sale-1", entryType: "RETURN_CREDIT", quantity: 2 }];

  const issued = await finalizeCollaborationFeeInvoice({
    invoice: { ...state.invoice },
    partner: { id: "partner-1", name: "Test Partner" },
    client,
    ...dependencies,
  });

  assert.equal(issued.status, "ISSUED");
  assert.equal(issued.accountingDocumentId, "document-1");
  assert.equal(state.documents[0].documentType, "CREDIT_NOTE");
  assert.equal(state.documents[0].documentNumber, "CN-COL-TEST-202609");
  assert.equal(state.documents[0].amount.toString(), "113");
  assert.equal(state.sale.quantityCredited, 2);
  assert.equal(state.journals.length, 1);
});

test("zero-net collaboration invoice adjustments consume quantities without creating a zero-value document", async () => {
  const { client, state, dependencies } = createInvoiceHarness();
  state.invoice.netAmount = 0;
  state.invoice.vatAmount = 0;
  state.invoice.totalAmount = 0;

  const first = await finalizeCollaborationFeeInvoice({
    invoice: { ...state.invoice },
    partner: { id: "partner-1", name: "Test Partner" },
    client,
    ...dependencies,
  });
  const replay = await finalizeCollaborationFeeInvoice({
    invoice: { ...state.invoice },
    partner: { id: "partner-1", name: "Test Partner" },
    client,
    ...dependencies,
  });

  assert.equal(first.status, "ISSUED");
  assert.equal(first.accountingDocumentId, null);
  assert.equal(replay.status, "ISSUED");
  assert.equal(state.sale.quantityInvoiced, 2);
  assert.deepEqual(state.documents, []);
  assert.deepEqual(state.journals, []);
});

test("collaboration invoice retries a serialization conflict and replays without duplicate effects", async () => {
  const { client, state, dependencies, getTransactionCount } = createInvoiceHarness();
  const transaction = client.$transaction;
  let conflictCount = 0;
  client.$transaction = async (callback, options) => {
    if (conflictCount === 0) {
      conflictCount += 1;
      throw Object.assign(new Error("Serializable conflict"), { code: "P2034" });
    }
    return transaction(callback, options);
  };

  await finalizeCollaborationFeeInvoice({
    invoice: { ...state.invoice },
    partner: { id: "partner-1", name: "Test Partner" },
    client,
    ...dependencies,
  });

  assert.equal(conflictCount, 1);
  assert.equal(getTransactionCount(), 1);
  assert.equal(state.invoice.status, "ISSUED");
  assert.equal(state.sale.quantityInvoiced, 2);
  assert.equal(state.documents.length, 1);
  assert.equal(state.journals.length, 1);
});

test("failed collaboration invoice posting rolls back its document, journal, invoice, and sale updates", async () => {
  const { client, state, dependencies } = createInvoiceHarness({ failPosting: true });

  await assert.rejects(
    finalizeCollaborationFeeInvoice({
      invoice: { ...state.invoice },
      partner: { id: "partner-1", name: "Test Partner" },
      client,
      ...dependencies,
    }),
    /Collaboration invoice journal failed/,
  );

  assert.equal(state.invoice.status, "PENDING_POSTING");
  assert.equal(state.invoice.accountingDocumentId, null);
  assert.equal(state.sale.quantityInvoiced, 0);
  assert.deepEqual(state.documents, []);
  assert.deepEqual(state.journals, []);
});

test("failed collaboration sale update rolls back the posted journal and invoice status", async () => {
  const { client, state, dependencies } = createInvoiceHarness({ failSaleUpdate: true });

  await assert.rejects(
    finalizeCollaborationFeeInvoice({
      invoice: { ...state.invoice },
      partner: { id: "partner-1", name: "Test Partner" },
      client,
      ...dependencies,
    }),
    /Collaboration sale update failed/,
  );

  assert.equal(state.invoice.status, "PENDING_POSTING");
  assert.equal(state.sale.quantityInvoiced, 0);
  assert.deepEqual(state.documents, []);
  assert.deepEqual(state.journals, []);
});
