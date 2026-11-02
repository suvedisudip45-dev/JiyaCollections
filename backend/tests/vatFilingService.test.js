import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createVatFilingDraft } from "../services/vatFilingService.js";

const makeClient = ({ overlappingRecord = null } = {}) => {
  const createdRecords = [];
  const reportingLines = [
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(1000),
      account: { accountCode: "4100", accountType: "REVENUE", accountName: "Sales", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "DELIVERED_ORDER", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(130),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "DELIVERED_ORDER", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(60),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-10-10T12:00:00.000Z"), sourceType: "SUPPLIER_INVOICE", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(25),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-10-20T12:00:00.000Z"), sourceType: "VAT_RETURN_NETTING", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(25),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-10-20T12:00:00.000Z"), sourceType: "VAT_RETURN_NETTING", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(40),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "1150", accountType: "ASSET", accountName: "Input VAT", normalBalance: "DEBIT" },
      journalEntry: { transactionDate: new Date("2026-09-20T12:00:00.000Z"), sourceType: "SUPPLIER_INVOICE", status: "POSTED" },
    },
    {
      debit: new Prisma.Decimal(10),
      credit: new Prisma.Decimal(0),
      account: { accountCode: "2120", accountType: "LIABILITY", accountName: "Output VAT", normalBalance: "CREDIT" },
      journalEntry: { transactionDate: new Date("2026-09-20T12:00:00.000Z"), sourceType: "DELIVERY_RETURN", status: "POSTED" },
    },
  ];
  const client = {
    taxFilingRecord: {
      findFirst: async ({ where }) => {
        if (where.periodStart) return overlappingRecord;
        return null;
      },
      create: async ({ data }) => {
        const record = { ...data, assessedAmount: null, payments: [] };
        createdRecords.push(record);
        return record;
      },
    },
    journalLine: {
      findMany: async () => reportingLines,
    },
    $transaction: async (callback) => callback(client),
  };
  return { client, createdRecords };
};

test("VAT filing draft uses full Nepal calendar dates, excludes filing settlements, and carries prior input credit", async () => {
  const { client, createdRecords } = makeClient();
  const record = await createVatFilingDraft({
    periodKey: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    client,
  });

  assert.equal(record.periodStart.toISOString(), "2026-09-30T18:15:00.000Z");
  assert.equal(record.periodEnd.toISOString(), "2026-10-31T18:14:59.999Z");
  assert.equal(record.taxableSales, "1000.00");
  assert.equal(record.outputVat, "130.00");
  assert.equal(record.inputVat, "60.00");
  assert.equal(record.carriedForwardInputVat, "40.00");
  assert.equal(record.carriedForwardOutputVat, "10.00");
  assert.equal(record.netVatPayable, "20.00");
  assert.match(record.notes, /invoice\/credit-note registers require independent verification/);
  assert.equal(createdRecords.length, 1);
});

test("VAT filing draft rejects overlapping date ranges", async () => {
  const { client, createdRecords } = makeClient({ overlappingRecord: { id: "existing-return" } });

  await assert.rejects(createVatFilingDraft({
    periodKey: "2026-Q4",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    client,
  }), (error) => error.code === "VAT_RETURN_PERIOD_OVERLAP");
  assert.equal(createdRecords.length, 0);
});
