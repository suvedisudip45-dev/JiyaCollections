import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptDistributorPaperBillAllocation,
  allocatePaperBillRange,
  createPaperBillBook,
  listDistributorPaperBillAllocations,
  listPaperBillOrderReport,
  parsePaperBillSerial,
  validatePaperBillChoice,
} from "../services/paperBillService.js";

const transactionClient = (models) => ({
  ...models,
  $transaction: async (callback) => callback(transactionClient(models)),
});

test("paper bill books reject invalid and overlapping serial ranges", async () => {
  await assert.rejects(
    createPaperBillBook({ documentType: "VAT_TAX_INVOICE", bookLabel: "VAT", seriesPrefix: "A-", startNumber: 8, endNumber: 2 }),
    { code: "INVALID_PAPER_BILL_RANGE" },
  );
  const client = transactionClient({
    paperBillBook: {
      findFirst: async () => ({ id: "existing" }),
      create: async () => assert.fail("overlapping book must not be created"),
    },
  });
  await assert.rejects(
    createPaperBillBook({
      documentType: "VAT_TAX_INVOICE",
      bookLabel: "VAT",
      seriesPrefix: "A-",
      startNumber: 1,
      endNumber: 100,
      client,
    }),
    { code: "PAPER_BILL_BOOK_RANGE_OVERLAP" },
  );
});

test("paper bill ranges must fit the registered book and cannot overlap prior allocations", async () => {
  const book = { id: "book-1", startNumber: 1, endNumber: 100, status: "ACTIVE" };
  const client = transactionClient({
    paperBillBook: { findUnique: async () => book },
    distributor: { findFirst: async () => ({ id: "dist-1" }) },
    paperBillBookAllocation: {
      findFirst: async () => null,
      create: async ({ data }) => data,
    },
  });
  await assert.rejects(
    allocatePaperBillRange({
      bookId: book.id,
      distributorId: "dist-1",
      startNumber: 90,
      endNumber: 101,
      client,
    }),
    { code: "PAPER_BILL_ALLOCATION_OUTSIDE_BOOK" },
  );
  const allocation = await allocatePaperBillRange({
    bookId: book.id,
    distributorId: "dist-1",
    startNumber: 1,
    endNumber: 20,
    client,
  });
  assert.equal(allocation.startNumber, 1);
  assert.equal(allocation.endNumber, 20);
  assert.equal(allocation.status, "PENDING_ACCEPTANCE");
});

test("distributor must accept a pending physical bill range before it becomes active", async () => {
  const allocation = {
    id: "allocation-1",
    distributorId: "dist-1",
    bookId: "book-1",
    startNumber: 1,
    endNumber: 20,
    status: "PENDING_ACCEPTANCE",
    acceptedAt: null,
    book: { documentType: "VAT_TAX_INVOICE", bookLabel: "VAT Book 1" },
  };
  let updatedData;
  const client = transactionClient({
    paperBillBookAllocation: {
      findUnique: async () => ({ ...allocation, ...updatedData }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, allocation.id);
        assert.equal(where.distributorId, "dist-1");
        assert.equal(where.status, "PENDING_ACCEPTANCE");
        updatedData = data;
        return { count: 1 };
      },
    },
  });
  const accepted = await acceptDistributorPaperBillAllocation({
    id: allocation.id,
    distributorId: "dist-1",
    acceptedBy: "account-1",
    client,
  });
  assert.equal(updatedData.status, "ACTIVE");
  assert.equal(updatedData.acceptedBy, "account-1");
  assert.ok(updatedData.acceptedAt instanceof Date);
  assert.equal(accepted.status, "ACTIVE");
});

test("distributor cannot accept another distributor's paper bill allocation", async () => {
  const client = transactionClient({
    paperBillBookAllocation: {
      findUnique: async () => ({
        id: "allocation-1",
        distributorId: "dist-owner",
        status: "PENDING_ACCEPTANCE",
      }),
      updateMany: async () => assert.fail("allocation ownership must be checked before update"),
    },
  });
  await assert.rejects(
    acceptDistributorPaperBillAllocation({
      id: "allocation-1",
      distributorId: "dist-other",
      client,
    }),
    { code: "PAPER_BILL_ALLOCATION_NOT_FOUND" },
  );
});

test("distributor bill allocation listing is scoped and only returns pending or active allocations", async () => {
  let query;
  await listDistributorPaperBillAllocations({
    distributorId: "dist-1",
    client: {
      paperBillBookAllocation: {
        findMany: async (args) => {
          query = args;
          return [];
        },
      },
    },
  });
  assert.equal(query.where.distributorId, "dist-1");
  assert.deepEqual(query.where.status.in, ["PENDING_ACCEPTANCE", "ACTIVE"]);
});

test("physical bill number must match the distributor's active document-type allocation", async () => {
  const allocation = {
    id: "allocation-1",
    startNumber: 10,
    endNumber: 20,
    book: { seriesPrefix: "VAT/", serialWidth: 4, documentType: "VAT_TAX_INVOICE" },
  };
  const client = {
    paperBillBookAllocation: { findMany: async () => [allocation] },
    orderAssignment: { findFirst: async () => null },
    salesInvoice: { findFirst: async () => null },
    orderExchangeRequest: { findFirst: async () => null },
  };
  const valid = await validatePaperBillChoice({
    client,
    distributorId: "dist-1",
    documentType: "VAT_TAX_INVOICE",
    billNumber: "VAT/0012",
    assignmentId: "assignment-1",
  });
  assert.equal(valid.paperBillAllocationId, allocation.id);
  assert.equal(valid.paperBillNumber, "VAT/0012");
  await assert.rejects(
    validatePaperBillChoice({
      client,
      distributorId: "dist-1",
      documentType: "VAT_TAX_INVOICE",
      billNumber: "VAT/0021",
    }),
    { code: "PAPER_BILL_NUMBER_OUTSIDE_ALLOCATION" },
  );
});

test("duplicate bill numbers and invalid report periods are rejected", async () => {
  const client = {
    paperBillBookAllocation: {
      findMany: async () => [{
        id: "allocation-1",
        startNumber: 1,
        endNumber: 10,
        book: { seriesPrefix: "PAN-", serialWidth: 0 },
      }],
    },
    orderAssignment: { findFirst: async () => ({ id: "another-assignment" }) },
    salesInvoice: { findFirst: async () => null },
    orderExchangeRequest: { findFirst: async () => null },
  };
  await assert.rejects(
    validatePaperBillChoice({
      client,
      distributorId: "dist-1",
      documentType: "PAN_BILL",
      billNumber: "PAN-5",
    }),
    { code: "PAPER_BILL_NUMBER_ALREADY_USED" },
  );
  await assert.rejects(
    listPaperBillOrderReport({ from: "2026-02-30", to: "2026-03-01" }),
    { code: "INVALID_PAPER_BILL_REPORT_PERIOD" },
  );
});

test("order report preserves preconverted BS Kathmandu boundaries", async () => {
  const start = new Date("2023-04-14T18:15:00.000Z");
  const end = new Date("2023-05-15T18:14:59.999Z");
  let dateFilter;
  const client = {
    order: {
      findMany: async ({ where }) => {
        dateFilter = where.date;
        return [];
      },
    },
  };
  await listPaperBillOrderReport({ from: start, to: end, client });
  assert.deepEqual(dateFilter, {
    gte: BigInt(start.getTime()),
    lte: BigInt(end.getTime()),
  });
});

test("order report filters VAT bills separately for the selected order-date period", async () => {
  const orders = [
    {
      id: "order-vat",
      orderReference: "ORD-VAT",
      date: BigInt(new Date("2026-03-01T10:00:00Z").getTime()),
      amount: 1130,
      status: "Delivered",
      address: { firstName: "A", lastName: "Customer" },
      salesInvoice: null,
    },
    {
      id: "order-no-copy",
      orderReference: "ORD-PAN",
      date: BigInt(new Date("2026-03-02T10:00:00Z").getTime()),
      amount: 500,
      status: "Delivered",
      address: { name: "B Customer" },
      salesInvoice: null,
    },
  ];
  const assignments = [
    {
      id: "assignment-vat",
      orderId: "order-vat",
      distributorId: "dist-1",
      distributor: { id: "dist-1", name: "Hub One" },
      status: "delivered",
      paperBillRequested: true,
      paperBillStatus: "ISSUED",
      paperBillDocumentType: "VAT_TAX_INVOICE",
      paperBillNumber: "VAT-1",
      paperBillIssuedAt: new Date("2026-03-01T11:00:00Z"),
      paperBillAllocation: null,
    },
    {
      id: "assignment-pan",
      orderId: "order-no-copy",
      distributorId: "dist-1",
      distributor: { id: "dist-1", name: "Hub One" },
      status: "delivered",
      paperBillRequested: false,
      paperBillStatus: "NO_PHYSICAL_COPY",
      paperBillDocumentType: "PAN_BILL",
      paperBillNumber: null,
      paperBillAllocation: null,
    },
  ];
  const client = {
    order: { findMany: async () => orders },
    orderAssignment: { findMany: async () => assignments },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
  };
  const withVatBill = await listPaperBillOrderReport({
    from: "2026-03-01",
    to: "2026-03-31",
    billFilter: "WITH_VAT_BILL",
    client,
  });
  const withoutVatBill = await listPaperBillOrderReport({
    from: "2026-03-01",
    to: "2026-03-31",
    billFilter: "WITHOUT_VAT_BILL",
    client,
  });
  assert.deepEqual(withVatBill.records.map((record) => record.orderReference), ["ORD-VAT"]);
  assert.equal(withVatBill.records[0].hasVatBill, true);
  assert.deepEqual(withoutVatBill.records.map((record) => record.orderReference), ["ORD-PAN"]);
  assert.equal(withoutVatBill.records[0].billRequested, false);
});

test("order report separates VAT, PAN, no-bill, and voided records including unassigned orders", async () => {
  const orders = ["vat", "pan", "requested", "unassigned", "voided"].map((kind) => ({
    id: `order-${kind}`,
    orderReference: `ORD-${kind.toUpperCase()}`,
    date: BigInt(new Date("2026-03-10T10:00:00Z").getTime()),
    amount: 100,
    status: "Delivered",
    address: { name: "Customer" },
    salesInvoice: null,
  }));
  const assignments = [
    {
      orderId: "order-vat",
      paperBillRequested: true,
      paperBillStatus: "ISSUED",
      paperBillDocumentType: "VAT_TAX_INVOICE",
      paperBillNumber: "VAT-1",
    },
    {
      orderId: "order-pan",
      paperBillRequested: true,
      paperBillStatus: "ISSUED",
      paperBillDocumentType: "PAN_BILL",
      paperBillNumber: "PAN-1",
    },
    {
      orderId: "order-requested",
      paperBillRequested: true,
      paperBillStatus: "NOT_SELECTED",
      paperBillDocumentType: "PAN_BILL",
      paperBillNumber: null,
    },
    {
      orderId: "order-voided",
      paperBillRequested: true,
      paperBillStatus: "VOIDED",
      paperBillDocumentType: "VAT_TAX_INVOICE",
      paperBillNumber: "VAT-2",
      paperBillVoidReason: "Returned order",
    },
  ];
  const client = {
    order: { findMany: async () => orders },
    orderAssignment: { findMany: async () => assignments },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
  };
  const query = (billFilter) => listPaperBillOrderReport({
    from: "2026-03-01",
    to: "2026-03-31",
    billFilter,
    client,
  });

  const [vat, pan, noBill, voided] = await Promise.all([
    query("VAT_BILL"),
    query("PAN_BILL"),
    query("NO_BILL"),
    query("VOIDED"),
  ]);
  assert.deepEqual(vat.records.map(({ orderReference }) => orderReference), ["ORD-VAT", "ORD-VOIDED"]);
  assert.deepEqual(pan.records.map(({ orderReference }) => orderReference), ["ORD-PAN"]);
  assert.deepEqual(noBill.records.map(({ orderReference }) => orderReference), ["ORD-REQUESTED", "ORD-UNASSIGNED"]);
  assert.equal(noBill.records[0].billClassification, "NO_BILL");
  assert.equal(noBill.records[1].billStatus, "NOT_SELECTED");
  assert.deepEqual(voided.records.map(({ orderReference }) => orderReference), ["ORD-VOIDED"]);
  assert.equal(voided.records[0].billVoidReason, "Returned order");
});

test("order report applies Nepal-local inclusive date boundaries", async () => {
  let where;
  const client = {
    order: {
      findMany: async (args) => {
        where = args.where;
        return [];
      },
    },
    orderAssignment: { findMany: async () => [] },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
  };
  await listPaperBillOrderReport({
    from: "2026-03-01",
    to: "2026-03-31",
    client,
  });
  assert.equal(
    Number(where.date.gte),
    new Date("2026-03-01T00:00:00+05:45").getTime(),
  );
  assert.equal(
    Number(where.date.lte),
    new Date("2026-03-31T23:59:59.999+05:45").getTime(),
  );
});

test("order report includes matching orders beyond the first 5,000", async () => {
  const orders = Array.from({ length: 5001 }, (_, index) => ({
    id: `order-${index}`,
    orderReference: `ORD-${index}`,
    date: BigInt(new Date("2026-03-01T10:00:00Z").getTime() - index),
    amount: 100,
    status: "Delivered",
    address: { name: "Customer" },
    salesInvoice: null,
  }));
  const assignments = new Map(orders.map((order) => [order.id, {
    orderId: order.id,
    distributorId: "dist-1",
    distributor: { id: "dist-1", name: "Hub One" },
    status: "delivered",
    paperBillRequested: true,
    paperBillStatus: "ISSUED",
    paperBillDocumentType: "VAT_TAX_INVOICE",
    paperBillNumber: `VAT-${order.orderReference}`,
    paperBillAllocation: null,
  }]));
  const client = {
    order: {
      findMany: async ({ skip, take }) => orders.slice(skip, skip + take),
    },
    orderAssignment: {
      findMany: async ({ where }) => where.orderId.in.map((id) => assignments.get(id)),
    },
    customerReturn: { findMany: async () => [] },
    orderExchangeRequest: { findMany: async () => [] },
  };
  const report = await listPaperBillOrderReport({
    from: "2026-03-01",
    to: "2026-03-31",
    billFilter: "WITH_VAT_BILL",
    page: 51,
    limit: 100,
    client,
  });
  assert.equal(report.pagination.total, 5001);
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].orderReference, "ORD-5000");
});

test("serial parser preserves prefix and configured zero-padding rules", () => {
  assert.equal(parsePaperBillSerial({ billNumber: "VAT/0012", seriesPrefix: "VAT/", serialWidth: 4 }), 12);
  assert.equal(parsePaperBillSerial({ billNumber: "VAT/12", seriesPrefix: "VAT/", serialWidth: 4 }), null);
  assert.equal(parsePaperBillSerial({ billNumber: "PAN-12", seriesPrefix: "PAN-", serialWidth: 0 }), 12);
});
