import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createAccountingDocument,
  allocatePaymentToDocuments,
  reconcileSubledgerToControl,
} from "../services/accountingSubledgerService.js";
import { applyManufacturerCreditToBill } from "../services/supplierCreditApplicationService.js";

const createSubledgerHarness = () => {
  const parties = new Map();
  const documents = new Map();
  const allocations = [];
  const accounts = new Map([
    ["1130", { id: "acc-1130", accountCode: "1130", accountName: "Accounts Receivable", currentBalance: new Prisma.Decimal(0) }],
    ["2160", { id: "acc-2160", accountCode: "2160", accountName: "Manufacturer Payable", currentBalance: new Prisma.Decimal(0) }],
  ]);

  const client = {
    accountingParty: {
      findUnique: async ({ where }) => parties.get(where.id) || null,
    },
    accountingDocument: {
      create: async ({ data }) => {
        const doc = {
          id: `doc-${documents.size + 1}`,
          ...data,
          party: parties.get(data.partyId) || { id: data.partyId, name: "Party" },
          allocations: [],
        };
        documents.set(doc.id, doc);
        return doc;
      },
      upsert: async ({ where, create }) => {
        const existing = [...documents.values()].find((doc) => doc.idempotencyKey === where.idempotencyKey);
        if (existing) return existing;
        const doc = {
          id: `doc-${documents.size + 1}`,
          ...create,
          party: parties.get(create.partyId) || { id: create.partyId, name: "Party" },
          allocations: [],
        };
        documents.set(doc.id, doc);
        return doc;
      },
      findMany: async ({ where, orderBy }) => {
        let list = [...documents.values()].filter((d) => {
          if (where.partyId && d.partyId !== where.partyId) return false;
          if (where.side && d.side !== where.side) return false;
          if (where.status?.in && !where.status.in.includes(d.status)) return false;
          if (where.id?.in && !where.id.in.includes(d.id)) return false;
          return true;
        });

        if (orderBy) {
          list.sort((a, b) => {
            const dateA = a.dueDate ? new Date(a.dueDate).getTime() : new Date(a.issueDate).getTime();
            const dateB = b.dueDate ? new Date(b.dueDate).getTime() : new Date(b.issueDate).getTime();
            return dateA - dateB;
          });
        }
        return list;
      },
      update: async ({ where, data }) => {
        const doc = documents.get(where.id);
        if (!doc) throw new Error("Document not found");
        Object.assign(doc, data);
        return doc;
      },
      updateMany: async ({ where, data }) => {
        const doc = documents.get(where.id);
        if (
          !doc ||
          !new Prisma.Decimal(String(doc.allocatedAmount)).equals(where.allocatedAmount) ||
          !new Prisma.Decimal(String(doc.remainingAmount)).equals(where.remainingAmount) ||
          doc.status !== where.status
        ) return { count: 0 };
        Object.assign(doc, data);
        return { count: 1 };
      },
    },
    accountingAllocation: {
      findUnique: async ({ where }) => allocations.find((allocation) => allocation.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const alloc = { id: `alloc-${allocations.length + 1}`, ...data };
        allocations.push(alloc);
        return alloc;
      },
    },
    account: {
      findUnique: async ({ where }) => accounts.get(where.accountCode) || null,
    },
  };

  return { client, parties, documents, allocations, accounts };
};

test("createAccountingDocument creates open document with positive Decimal amounts", async () => {
  const { client, parties } = createSubledgerHarness();
  parties.set("party-1", { id: "party-1", displayName: "Aama Fashions", partyType: "MANUFACTURER" });

  const doc = await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-2026-001",
    partyId: "party-1",
    side: "PAYABLE",
    sourceType: "MANUFACTURER_PO",
    sourceId: "po-001",
    amount: "15000.00",
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  }, { client });

  assert.ok(doc);
  assert.equal(doc.status, "OPEN");
  assert.equal(doc.side, "PAYABLE");
  assert.equal(doc.originalAmount.toFixed(2), "15000.00");
  assert.equal(doc.allocatedAmount.toFixed(2), "0.00");
  assert.equal(doc.remainingAmount.toFixed(2), "15000.00");
});

test("createAccountingDocument idempotency prevents duplicate distributor COD invoices", async () => {
  const { client, parties, documents } = createSubledgerHarness();
  parties.set("party-1", { id: "party-1", displayName: "Distributor", partyType: "DISTRIBUTOR" });
  const input = {
    documentType: "INVOICE",
    documentNumber: "DCO-order-1",
    partyId: "party-1",
    side: "RECEIVABLE",
    sourceType: "DISTRIBUTOR_COD_SALE",
    sourceId: "order-1",
    amount: "1500.00",
    idempotencyKey: "DISTRIBUTOR_COD_SALE:order-1",
  };
  await createAccountingDocument(input, { client });
  await createAccountingDocument(input, { client });
  assert.equal(documents.size, 1);
});

test("allocatePaymentToDocuments correctly applies partial payment and updates remaining balance", async () => {
  const { client, parties } = createSubledgerHarness();
  parties.set("party-1", { id: "party-1", displayName: "Aama Fashions", partyType: "MANUFACTURER" });

  const doc = await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-2026-002",
    partyId: "party-1",
    side: "PAYABLE",
    sourceType: "MANUFACTURER_PO",
    sourceId: "po-002",
    amount: "10000.00",
  }, { client });

  // Partial allocation of Rs 4,000
  const result = await allocatePaymentToDocuments({
    partyId: "party-1",
    side: "PAYABLE",
    amount: "4000.00",
  }, { client });

  assert.equal(result.totalAllocated.toFixed(2), "4000.00");
  assert.equal(result.unallocatedAmount.toFixed(2), "0.00");
  assert.equal(result.updatedDocuments.length, 1);

  const updatedDoc = result.updatedDocuments[0];
  assert.equal(updatedDoc.status, "PARTIALLY_PAID");
  assert.equal(updatedDoc.allocatedAmount.toFixed(2), "4000.00");
  assert.equal(updatedDoc.remainingAmount.toFixed(2), "6000.00");
  // Invariant
  assert.equal(
    updatedDoc.allocatedAmount.plus(updatedDoc.remainingAmount).toFixed(2),
    updatedDoc.originalAmount.toFixed(2)
  );
});

test("allocatePaymentToDocuments applies FIFO across multiple bills and records advance balance", async () => {
  const { client, parties } = createSubledgerHarness();
  parties.set("mfg-1", { id: "mfg-1", displayName: "Kathmandu Weavers", partyType: "MANUFACTURER" });

  // Bill 1: Rs 5,000 due in 5 days
  await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-001",
    partyId: "mfg-1",
    side: "PAYABLE",
    sourceType: "PO",
    sourceId: "po-1",
    amount: "5000.00",
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  }, { client });

  // Bill 2: Rs 3,000 due in 10 days
  await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-002",
    partyId: "mfg-1",
    side: "PAYABLE",
    sourceType: "PO",
    sourceId: "po-2",
    amount: "3000.00",
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  }, { client });

  // Pay Rs 10,000 (oversatisfies both bills, leaving Rs 2,000 unallocated advance)
  const result = await allocatePaymentToDocuments({
    partyId: "mfg-1",
    side: "PAYABLE",
    amount: "10000.00",
  }, { client });

  assert.equal(result.totalAllocated.toFixed(2), "8000.00");
  assert.equal(result.unallocatedAmount.toFixed(2), "2000.00"); // Advance
  assert.equal(result.updatedDocuments.length, 2);

  // Both bills must now be fully PAID
  assert.equal(result.updatedDocuments[0].status, "PAID");
  assert.equal(result.updatedDocuments[0].remainingAmount.toFixed(2), "0.00");
  assert.equal(result.updatedDocuments[1].status, "PAID");
  assert.equal(result.updatedDocuments[1].remainingAmount.toFixed(2), "0.00");
});

test("reconcileSubledgerToControl verifies balance against GL control account and identifies variance", async () => {
  const { client, parties, accounts } = createSubledgerHarness();
  parties.set("mfg-1", { id: "mfg-1", displayName: "Kathmandu Weavers", partyType: "MANUFACTURER" });

  await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-A",
    partyId: "mfg-1",
    side: "PAYABLE",
    sourceType: "PO",
    sourceId: "po-a",
    amount: "7500.00",
  }, { client });

  await createAccountingDocument({
    documentType: "BILL",
    documentNumber: "BILL-B",
    partyId: "mfg-1",
    side: "PAYABLE",
    sourceType: "PO",
    sourceId: "po-b",
    amount: "2500.00",
  }, { client });

  // Set GL control account to matching Rs 10,000
  accounts.get("2160").currentBalance = new Prisma.Decimal("10000.00");

  const reconciliation = await reconcileSubledgerToControl({
    side: "PAYABLE",
    accountCode: "2160",
  }, { client });

  assert.equal(reconciliation.isBalanced, true);
  assert.equal(reconciliation.glBalance, "10000.00");
  assert.equal(reconciliation.subledgerTotal, "10000.00");
  assert.equal(reconciliation.variance, "0.00");
});

test("manufacturer credit application reduces credit and linked bill without posting a second journal", async () => {
  const credit = {
    id: "credit-1",
    documentType: "CREDIT_NOTE",
    side: "RECEIVABLE",
    sourceType: "MANUFACTURER_DELIVERY_RETURN",
    sourceId: "return-1",
    partyId: "party-1",
    currency: "NPR",
    originalAmount: new Prisma.Decimal("20.00"),
    allocatedAmount: new Prisma.Decimal("0.00"),
    remainingAmount: new Prisma.Decimal("20.00"),
    status: "OPEN",
    party: { id: "party-1", partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
  };
  const bill = {
    id: "bill-1",
    documentType: "BILL",
    side: "PAYABLE",
    sourceType: "MANUFACTURER_DELIVERY_COGS",
    sourceId: "order-1",
    partyId: "party-1",
    currency: "NPR",
    originalAmount: new Prisma.Decimal("100.00"),
    allocatedAmount: new Prisma.Decimal("10.00"),
    remainingAmount: new Prisma.Decimal("90.00"),
    status: "PARTIALLY_PAID",
    party: { id: "party-1", partyType: "MANUFACTURER", sourceEntityId: "manufacturer-1" },
  };
  const updates = [];
  const applicationAllocations = [];
  let applicationRecord;
  let journalLookupCount = 0;
  const client = {
    $transaction: async (callback) => callback(client),
    supplierCreditApplication: {
      findUnique: async () => applicationRecord || null,
      create: async ({ data }) => {
        applicationRecord = { id: "app-1", ...data };
        return applicationRecord;
      },
    },
    accountingDocument: {
      findUnique: async ({ where }) => where.id === credit.id ? credit : where.id === bill.id ? bill : null,
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        return { count: 1 };
      },
    },
    customerReturn: {
      findUnique: async () => ({ id: "return-1", orderId: "order-1", manufacturerId: "manufacturer-1" }),
    },
    journalEntry: {
      findFirst: async () => {
        journalLookupCount += 1;
        return {
          id: "return-journal-1",
          lines: [{
            supplierId: "manufacturer-1",
            debit: new Prisma.Decimal("20.00"),
            account: { accountCode: "2160" },
            accountingParty: null,
          }],
        };
      },
    },
    accountingAllocation: {
      createMany: async ({ data }) => { applicationAllocations.push(...data); return { count: data.length }; },
    },
  };
  const auditEvents = [];
  const input = {
    manufacturerId: "manufacturer-1",
    creditDocumentId: credit.id,
    billDocumentId: bill.id,
    amount: "12.50",
    idempotencyKey: "credit-app-1",
    appliedByAccountId: "admin-1",
    notes: "Apply confirmed return credit.",
    client,
    writeAudit: async (_actor, payload) => auditEvents.push(payload),
  };

  const result = await applyManufacturerCreditToBill(input);

  assert.equal(result.application.journalEntryId, "return-journal-1");
  assert.equal(result.journalEntryId, "return-journal-1");
  assert.equal(result.journalPostedForApplication, false);
  assert.equal(updates[0].data.remainingAmount.toFixed(2), "7.50");
  assert.equal(updates[1].data.remainingAmount.toFixed(2), "77.50");
  assert.equal(applicationAllocations.length, 2);
  assert.deepEqual(applicationAllocations.map((allocation) => allocation.journalEntryId), [
    "return-journal-1",
    "return-journal-1",
  ]);
  assert.equal(journalLookupCount, 1);
  assert.equal(auditEvents[0].action, "MANUFACTURER_SUPPLIER_CREDIT_APPLIED");

  const replay = await applyManufacturerCreditToBill(input);
  assert.equal(replay.isReplay, true);
  assert.equal(updates.length, 2);
  assert.equal(journalLookupCount, 1);

  await assert.rejects(
    applyManufacturerCreditToBill({
      ...input,
      manufacturerId: "different-manufacturer",
      idempotencyKey: "credit-app-wrong-manufacturer",
    }),
    (error) => error.code === "CREDIT_BILL_PARTY_MISMATCH",
  );
  assert.equal(updates.length, 2);
});
