import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  createAccountingDocument,
  allocatePaymentToDocuments,
  reconcileSubledgerToControl,
} from "../services/accountingSubledgerService.js";

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
    },
    accountingAllocation: {
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
