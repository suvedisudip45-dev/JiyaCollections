import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { createManufacturerSettlementRequest } from "../controllers/manufacturerFinanceController.js";
import { getAdminManufacturerFinance } from "../controllers/adminManufacturerDetailController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const makeRequest = ({
  amount = "10.00",
  idempotencyKey = "manufacturer-request-1",
  requestType = "PRODUCTION",
  notes = null,
} = {}) => ({
  manufacturerId: "manufacturer-1",
  auth: { accountId: "account-1", role: "MANUFACTURER" },
  ip: "127.0.0.1",
  headers: { "idempotency-key": idempotencyKey, "user-agent": "test" },
  body: { amount, idempotencyKey, requestType, notes },
});

const makeTransactionClient = ({ available = "10.01", existing = null } = {}) => {
  let created;
  let createCount = 0;
  const productionBill = {
    side: "PAYABLE",
    sourceType: "MANUFACTURER_PRODUCTION",
    sourceId: "production-1",
    originalAmount: new Prisma.Decimal(available),
    allocatedAmount: new Prisma.Decimal("0"),
    remainingAmount: new Prisma.Decimal(available),
  };
  const client = {
    manufacturer: {
      findUnique: async () => ({ id: "manufacturer-1", name: "Textile Co" }),
    },
    manufacturerSettlementRequest: {
      findUnique: async () => existing,
      findMany: async () => [],
      groupBy: async () => [],
      create: async ({ data }) => {
        createCount += 1;
        created = {
          id: "settlement-1",
          ...data,
          paidAmount: new Prisma.Decimal("0.00"),
          status: "PENDING",
        };
        return created;
      },
    },
    account: {
      findUnique: async () => ({ id: "manufacturer-payable-account" }),
    },
    accountingDocument: {
      findMany: async () => [productionBill],
    },
    journalLine: {
      findMany: async () => [],
    },
    systemAuditOutbox: {
      create: async () => ({ id: "audit-1" }),
    },
  };
  return {
    client,
    getCreated: () => created,
    getCreateCount: () => createCount,
  };
};

const withTransaction = (t, implementation) => {
  let options;
  stubMethod(t, prisma, "$transaction", async (callback, transactionOptions) => {
    options = transactionOptions;
    return implementation(callback);
  });
  return { getOptions: () => options };
};

test("manufacturer settlement creation uses exact available balance and serializable Decimal writes", async (t) => {
  const transaction = makeTransactionClient({ available: "10.01" });
  const transactionStub = withTransaction(t, (callback) => callback(transaction.client));
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "10.00" }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(transaction.getCreateCount(), 1);
  assert.equal(transaction.getCreated().amount.toFixed(2), "10.00");
  assert.equal(response.body.settlement.amount, "10");
  assert.equal(response.body.settlement.paidAmount, "0");
  assert.equal(transactionStub.getOptions().isolationLevel, "Serializable");
});

test("manufacturer settlement creation rejects an amount one cent over the available balance", async (t) => {
  const transaction = makeTransactionClient({ available: "0.01" });
  withTransaction(t, (callback) => callback(transaction.client));
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "0.02" }), response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "SETTLEMENT_EXCEEDS_AVAILABLE_PAYABLE");
  assert.match(response.body.message, /Rs 0\.01/);
  assert.equal(transaction.getCreateCount(), 0);
});

test("manufacturer settlement creation replays an exact idempotent request without new effects", async (t) => {
  const existing = {
    id: "settlement-existing",
    manufacturerId: "manufacturer-1",
    requestType: "PRODUCTION",
    amount: new Prisma.Decimal("10.00"),
    paidAmount: new Prisma.Decimal("0.00"),
    status: "PENDING",
  };
  const transaction = makeTransactionClient({ existing });
  withTransaction(t, (callback) => callback(transaction.client));
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "10.00" }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.settlement.id, "settlement-existing");
  assert.equal(response.body.settlement.amount, "10");
  assert.equal(transaction.getCreateCount(), 0);
});

test("manufacturer settlement creation rejects a changed-payload idempotency replay", async (t) => {
  const existing = {
    id: "settlement-existing",
    manufacturerId: "manufacturer-1",
    requestType: "PRODUCTION",
    amount: new Prisma.Decimal("10.00"),
    status: "PENDING",
  };
  const transaction = makeTransactionClient({ existing });
  withTransaction(t, (callback) => callback(transaction.client));
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "10.01" }), response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "SETTLEMENT_REQUEST_CONFLICT");
  assert.equal(transaction.getCreateCount(), 0);
});

test("manufacturer settlement creation rejects replay when normalized notes changed", async (t) => {
  const existing = {
    id: "settlement-existing",
    manufacturerId: "manufacturer-1",
    requestType: "PRODUCTION",
    amount: new Prisma.Decimal("10.00"),
    notes: "First request",
    status: "PENDING",
  };
  const transaction = makeTransactionClient({ existing });
  withTransaction(t, (callback) => callback(transaction.client));
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ notes: "Changed request" }), response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "SETTLEMENT_REQUEST_CONFLICT");
  assert.equal(transaction.getCreateCount(), 0);
});

test("manufacturer settlement creation requires a stable client idempotency key", async (t) => {
  let transactionCount = 0;
  stubMethod(t, prisma, "$transaction", async () => {
    transactionCount += 1;
  });
  const request = makeRequest();
  request.headers = {};
  delete request.body.idempotencyKey;
  const response = createResponse();

  await createManufacturerSettlementRequest(request, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /idempotency key is required/);
  assert.equal(transactionCount, 0);
});

test("manufacturer settlement creation recovers a concurrent idempotency unique-key winner", async (t) => {
  const existing = {
    id: "settlement-concurrent",
    manufacturerId: "manufacturer-1",
    requestType: "PRODUCTION",
    amount: new Prisma.Decimal("10.00"),
    paidAmount: new Prisma.Decimal("0.00"),
    status: "PENDING",
  };
  const transaction = makeTransactionClient();
  withTransaction(t, async () => {
    throw Object.assign(new Error("Unique idempotency key conflict"), { code: "P2002" });
  });
  stubMethod(t, prisma.manufacturerSettlementRequest, "findUnique", async () => existing);
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "10.00" }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.settlement.id, "settlement-concurrent");
  assert.equal(transaction.getCreateCount(), 0);
});

test("manufacturer settlement creation retries a serializable conflict before committing", async (t) => {
  const transaction = makeTransactionClient();
  let transactionCount = 0;
  withTransaction(t, async (callback) => {
    transactionCount += 1;
    if (transactionCount === 1) {
      throw Object.assign(new Error("Serializable transaction conflict"), { code: "P2034" });
    }
    return callback(transaction.client);
  });
  stubMethod(t, prisma.manufacturerSettlementRequest, "findUnique", async () => null);
  const response = createResponse();

  await createManufacturerSettlementRequest(makeRequest({ amount: "10.00" }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(transactionCount, 2);
  assert.equal(transaction.getCreateCount(), 1);
});

test("Admin manufacturer finance serializes payable and receivable money as Decimal strings", async (t) => {
  stubMethod(t, prisma.manufacturer, "findUnique", async () => ({ id: "manufacturer-1", name: "Textile Co" }));
  stubMethod(t, prisma.manufacturerSettlementRequest, "findMany", async () => []);
  stubMethod(t, prisma.manufacturerSettlementRequest, "groupBy", async () => []);
  stubMethod(t, prisma.account, "findUnique", async () => null);
  stubMethod(t, prisma.accountingDocument, "findMany", async () => []);
  stubMethod(t, prisma.accountingParty, "findUnique", async () => ({ id: "party-1" }));
  stubMethod(t, prisma.accountingDocument, "aggregate", async () => ({
    _sum: {
      originalAmount: new Prisma.Decimal("123456789012345.67"),
      remainingAmount: new Prisma.Decimal("0.01"),
    },
    _count: { _all: 2 },
  }));
  const response = createResponse();

  await getAdminManufacturerFinance({ params: { id: "manufacturer-1" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.finance.totalManufacturedGoodsValue, "0.00");
  assert.equal(response.body.finance.receivables.total, "123456789012345.67");
  assert.equal(response.body.finance.receivables.outstanding, "0.01");
  assert.equal(response.body.finance.receivables.documents, 2);
});
