import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  postDeliveredOrderAccounting,
  postConfirmedDeliveryReturnAccounting,
  postCustomerPaymentAccounting,
  postMarketingCpaRedemptionAccounting,
  postNcmRemittanceAccounting,
  postNcmSettlementAccounting,
  postSupplierPaymentAccounting,
  STANDARD_ACCOUNT_MAPPINGS,
  STANDARD_CHART_OF_ACCOUNTS,
} from "../services/accountingPostingEngine.js";

const createComprehensiveHarness = () => {
  const accounts = STANDARD_CHART_OF_ACCOUNTS.map((acc) => ({
    id: `acc-${acc.accountCode}`,
    accountCode: acc.accountCode,
    accountName: acc.accountName,
    accountType: acc.accountType,
    normalBalance: acc.normalBalance,
    currentBalance: new Prisma.Decimal(0),
  }));

  const mappings = new Map(
    STANDARD_ACCOUNT_MAPPINGS.map((m) => [
      m.mappingKey,
      {
        id: `map-${m.mappingKey}`,
        mappingKey: m.mappingKey,
        accountId: `acc-${m.accountCode}`,
        account: accounts.find((a) => a.accountCode === m.accountCode),
      },
    ])
  );

  const parties = new Map();
  const state = {
    fiscalYears: new Map(),
    periods: new Map(),
    sequences: new Map(),
    events: [],
    entries: [],
  };

  const client = {
    fiscalYear: {
      upsert: async ({ where, create }) => {
        if (!state.fiscalYears.has(where.name)) state.fiscalYears.set(where.name, { id: `fy-${where.name}`, ...create });
        return state.fiscalYears.get(where.name);
      },
    },
    accountingPeriod: {
      upsert: async ({ where, create }) => {
        const key = `${where.fiscalYearId_periodName.fiscalYearId}:${where.fiscalYearId_periodName.periodName}`;
        if (!state.periods.has(key)) {
          state.periods.set(key, { id: `period-${key}`, ...create, status: "OPEN" });
        }
        return state.periods.get(key);
      },
    },
    journalSequence: {
      upsert: async ({ where, create }) => {
        let sequence = state.sequences.get(where.fiscalYear);
        if (!sequence) {
          sequence = { fiscalYear: where.fiscalYear, nextNumber: create.nextNumber };
          state.sequences.set(where.fiscalYear, sequence);
        } else {
          sequence.nextNumber += 1;
        }
        return { ...sequence };
      },
    },
    account: {
      findUnique: async ({ where }) =>
        accounts.find((a) => (where.id && a.id === where.id) || (where.accountCode && a.accountCode === where.accountCode)) || null,
      update: async ({ where, data }) => {
        const account = accounts.find((a) => a.id === where.id);
        if (account && data.currentBalance?.increment) {
          account.currentBalance = account.currentBalance.plus(data.currentBalance.increment);
        }
        return account;
      },
    },
    accountingAccountMapping: {
      findUnique: async ({ where }) => mappings.get(where.mappingKey) || null,
    },
    accountingParty: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.partyType_sourceEntityId.partyType}:${where.partyType_sourceEntityId.sourceEntityId}`;
        if (!parties.has(key)) {
          parties.set(key, { id: `party-${parties.size + 1}`, ...create });
        } else {
          Object.assign(parties.get(key), update);
        }
        return parties.get(key);
      },
    },
    journalEntry: {
      findUnique: async ({ where }) => state.entries.find((e) => e.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (data.idempotencyKey && state.entries.some((e) => e.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const entry = {
          id: `journal-${state.entries.length + 1}`,
          ...data,
          lines: data.lines.create.map((l, i) => ({
            id: `line-${i + 1}`,
            ...l,
            account: accounts.find((a) => a.id === l.accountId),
          })),
        };
        state.entries.push(entry);
        return entry;
      },
    },
    accountingEvent: {
      create: async ({ data }) => {
        if (state.events.some((e) => e.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const event = { id: `event-${state.events.length + 1}`, ...data };
        state.events.push(event);
        return event;
      },
      update: async ({ where, data }) => {
        const event = state.events.find((e) => e.id === where.id);
        if (event) Object.assign(event, data);
        return event;
      },
    },
    manufacturer: {
      findUnique: async ({ where }) => ({ id: where.id, name: "Alpha Textiles" }),
    },
    marketingPartner: {
      findUnique: async ({ where }) => ({ id: where.id, name: "Pokhara Food Hub" }),
    },
    order: {
      findUnique: async ({ where }) => null, // Override in individual tests if needed
    },
    $transaction: async (callback) => callback(client),
  };

  return { client, state, accounts, parties };
};

test("delivered online store order posts balanced sales, VAT, COGS and manufacturer payable", async () => {
  const { client, state } = createComprehensiveHarness();

  const mockOrder = {
    id: "ord-store-001",
    userId: "user-cust-001",
    customerName: "Sita Sharma",
    amount: 11300, // Rs 11,300 gross (Rs 10,000 net + Rs 1,300 13% VAT)
    deliveryCharge: 0,
    paymentMethod: "ONLINE_BANK",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [
      {
        productId: "prod-001",
        quantity: 2,
        agreedUnitCogsVatInclusiveAtAcceptance: "3000.00",
      },
    ],
  };

  const journal = await postDeliveredOrderAccounting(mockOrder, { client });

  assert.ok(journal);
  assert.equal(journal.status, "POSTED");
  assert.equal(journal.sourceType, "DELIVERY_SALE");
  assert.equal(journal.idempotencyKey, "DELIVERY_SALE:ord-store-001");

  // Sum of DR and CR
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(journal.totalDebit.toFixed(2), "17300.00"); // 11,300 (Bank) + 6,000 (COGS)

  // Verify specific lines
  const bankLine = journal.lines.find((l) => l.account.accountCode === "1120");
  const revLine = journal.lines.find((l) => l.account.accountCode === "4100");
  const vatLine = journal.lines.find((l) => l.account.accountCode === "2120");
  const cogsLine = journal.lines.find((l) => l.account.accountCode === "5100");
  const mfgApLine = journal.lines.find((l) => l.account.accountCode === "2160");

  assert.equal(bankLine.debit.toFixed(2), "11300.00");
  assert.equal(revLine.credit.toFixed(2), "10000.00");
  assert.equal(vatLine.credit.toFixed(2), "1300.00");
  assert.equal(cogsLine.debit.toFixed(2), "6000.00");
  assert.equal(mfgApLine.credit.toFixed(2), "6000.00");
});

test("production-layer delivery expenses COGS without accruing it twice to manufacturer payable", async () => {
  const { client } = createComprehensiveHarness();
  const order = {
    id: "ord-production-005",
    userId: "user-cust-005",
    amount: 226,
    paymentMethod: "ONLINE_BANK",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [{
      productId: "prod-001",
      quantity: 2,
      productionCostAllocations: [{ quantity: 2, unitCogs: "100.00", unitDeliveryCost: "10.00" }],
      legacyCostQuantity: 0,
    }],
  };

  const journal = await postDeliveredOrderAccounting(order, { client });
  const cogsLine = journal.lines.find((line) => line.account.accountCode === "5100");
  const inventoryLine = journal.lines.find((line) => line.account.accountCode === "1140");
  const deliveryExpenseLine = journal.lines.find((line) => line.account.accountCode === "6430");
  const manufacturerPayableLine = journal.lines.find((line) => line.account.accountCode === "2160");

  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(cogsLine.debit.toFixed(2), "200.00");
  assert.equal(inventoryLine.credit.toFixed(2), "200.00");
  assert.equal(deliveryExpenseLine.debit.toFixed(2), "20.00");
  assert.equal(manufacturerPayableLine.credit.toFixed(2), "20.00");
});

test("delivered direct manufacturer COD sale recognizes commission expense and COD receivable", async () => {
  const { client } = createComprehensiveHarness();

  const mockOrder = {
    id: "ord-direct-002",
    userId: "user-cust-002",
    customerName: "Ram Bahadur",
    amount: 11300,
    deliveryCharge: 0,
    paymentMethod: "COD",
    orderType: "DIRECT_MANUFACTURER",
    directOrderType: "PHONE_ORDER",
    manufacturerId: "mfg-001",
    agreedCommissionRate: 10, // 10% commission on gross profit
    items: [
      {
        productId: "prod-001",
        quantity: 2,
        agreedUnitCogsVatInclusiveAtAcceptance: "3000.00", // Gross COGS = 6000
        agreedCommissionRateAtAcceptance: "10.00",
      },
    ],
  };

  // Gross profit = 10,000 (ex-VAT revenue) - 6,000 (gross COGS) = 4,000
  // Commission = 4,000 * 10% = 400
  const journal = await postDeliveredOrderAccounting(mockOrder, { client });

  assert.ok(journal);
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));

  const codLine = journal.lines.find((l) => l.account.accountCode === "1170");
  const commExpLine = journal.lines.find((l) => l.account.accountCode === "6410");
  const mfgApLines = journal.lines.filter((l) => l.account.accountCode === "2160");

  assert.equal(codLine.debit.toFixed(2), "11300.00");
  assert.equal(commExpLine.debit.toFixed(2), "400.00");

  const totalMfgApCredit = mfgApLines.reduce((acc, l) => acc.plus(l.credit), new Prisma.Decimal(0));
  assert.equal(totalMfgApCredit.toFixed(2), "6400.00"); // 6000 COGS + 400 Commission
});

test("duplicate delivery sale posting is idempotent and does not create duplicate journals", async () => {
  const { client, state } = createComprehensiveHarness();

  const mockOrder = {
    id: "ord-idem-003",
    userId: "user-cust-003",
    amount: 5650,
    deliveryCharge: 0,
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [
      {
        productId: "prod-001",
        quantity: 1,
        agreedUnitCogsVatInclusiveAtAcceptance: "2500.00",
      },
    ],
  };

  const first = await postDeliveredOrderAccounting(mockOrder, { client });
  const second = await postDeliveredOrderAccounting(mockOrder, { client });

  assert.equal(first.id, second.id);
  assert.equal(state.entries.length, 1);
});

test("delivered order posting reuses a transaction-scoped client", async () => {
  const { client } = createComprehensiveHarness();
  delete client.$transaction;

  const journal = await postDeliveredOrderAccounting({
    id: "ord-transaction-client-004",
    amount: 5650,
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [{ quantity: 1, agreedUnitCogsVatInclusiveAtAcceptance: "2500.00" }],
  }, { client });

  assert.ok(journal);
  assert.equal(journal.status, "POSTED");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "5100").debit.toFixed(2), "2500.00");
});

test("manufacturer payment reduces the manufacturer payable control account", async () => {
  const { client } = createComprehensiveHarness();
  delete client.$transaction;

  const payment = {
    payableId: "mfg-payable-001",
    payeeName: "Alpha Textiles",
    amount: 1200,
    fromAccountType: "CASH",
    payableAccountCode: "2160",
    idempotencyKey: "SUPPLIER_PAYMENT:mfg-payment-001",
    client,
  };
  const journal = await postSupplierPaymentAccounting(payment);
  const retry = await postSupplierPaymentAccounting(payment);

  assert.ok(journal);
  assert.equal(retry.id, journal.id);
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2160").debit.toFixed(2), "1200.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "1110").credit.toFixed(2), "1200.00");
});

test("customer receipt uses its mapped clearing account and stable idempotency key", async () => {
  const { client, state } = createComprehensiveHarness();
  const payment = {
    id: "receipt-001",
    orderId: "ar-001",
    amount: 900,
    depositAccountCode: "1180",
    idempotencyKey: "RECEIPT:ar-001:part-1",
    client,
  };

  const first = await postCustomerPaymentAccounting(payment);
  const retry = await postCustomerPaymentAccounting(payment);

  assert.equal(retry.id, first.id);
  assert.equal(state.entries.length, 1);
  assert.equal(first.lines.find((line) => line.account.accountCode === "1180").debit.toFixed(2), "900.00");
  assert.equal(first.lines.find((line) => line.account.accountCode === "1130").credit.toFixed(2), "900.00");
});

test("NCM cash remittance posts through the caller transaction client", async () => {
  const { client } = createComprehensiveHarness();
  delete client.$transaction;

  const journal = await postNcmRemittanceAccounting({
    settlementId: "ncm-settlement-001",
    codCollected: 1331,
    isCash: true,
    destinationAccountName: "Cash In Hand",
  }, { client });

  assert.ok(journal);
  assert.equal(journal.lines.find((line) => line.account.accountCode === "1110").debit.toFixed(2), "1331.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "1170").credit.toFixed(2), "1331.00");
});

test("confirmed delivery return reverses sales revenue, output VAT, and manufacturer AP", async () => {
  const { client } = createComprehensiveHarness();

  const mockOrder = {
    id: "ord-ret-004",
    userId: "user-cust-004",
    amount: 11300,
    deliveryCharge: 0,
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [
      {
        productId: "prod-001",
        quantity: 2,
        agreedUnitCogsVatInclusiveAtAcceptance: "3000.00",
      },
    ],
  };

  client.order.findUnique = async () => mockOrder;

  const returnRecord = {
    id: "ret-001",
    orderId: "ord-ret-004",
    manufacturerId: "mfg-001",
    state: "RECEIVED",
  };

  const journal = await postConfirmedDeliveryReturnAccounting({ returnRecord, client });

  assert.ok(journal);
  assert.equal(journal.status, "POSTED");
  assert.equal(journal.sourceType, "DELIVERY_RETURN");
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));

  const salesReturnLine = journal.lines.find((l) => l.account.accountCode === "4500");
  const vatAdjLine = journal.lines.find((l) => l.account.accountCode === "2120");
  const codClearLine = journal.lines.find((l) => l.account.accountCode === "1170");
  const mfgApReversal = journal.lines.find((l) => l.account.accountCode === "2160");
  const cogsReversal = journal.lines.find((l) => l.account.accountCode === "5100");

  assert.equal(salesReturnLine.debit.toFixed(2), "10000.00");
  assert.equal(vatAdjLine.debit.toFixed(2), "1300.00");
  assert.equal(codClearLine.credit.toFixed(2), "11300.00");
  assert.equal(mfgApReversal.debit.toFixed(2), "6000.00");
  assert.equal(cogsReversal.credit.toFixed(2), "6000.00");
});

test("production-layer return restores inventory without reversing production COGS payable", async () => {
  const { client } = createComprehensiveHarness();
  client.order.findUnique = async () => ({
    id: "ord-production-return-006",
    userId: "user-cust-006",
    amount: 226,
    paymentMethod: "COD",
    orderType: "ONLINE_STORE",
    manufacturerId: "mfg-001",
    items: [{
      productId: "prod-001",
      quantity: 2,
      productionCostAllocations: [{ quantity: 2, unitCogs: "100.00", unitDeliveryCost: "10.00" }],
      legacyCostQuantity: 0,
    }],
  });

  const journal = await postConfirmedDeliveryReturnAccounting({
    returnRecord: { id: "ret-production-006", orderId: "ord-production-return-006", manufacturerId: "mfg-001" },
    client,
  });
  const payableReversal = journal.lines.find((line) => line.account.accountCode === "2160");
  const inventoryRestock = journal.lines.find((line) => line.account.accountCode === "1140");
  const cogsReversal = journal.lines.find((line) => line.account.accountCode === "5100");

  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(payableReversal.debit.toFixed(2), "20.00");
  assert.equal(inventoryRestock.debit.toFixed(2), "200.00");
  assert.equal(cogsReversal.credit.toFixed(2), "200.00");
});

test("marketing CPA redemption posts marketing expense and partner payable", async () => {
  const { client } = createComprehensiveHarness();

  const mockRedemption = {
    id: "red-001",
    cardId: "card-001",
    partnerId: "partner-001",
    redeemedAt: new Date(),
  };

  const mockCampaign = {
    id: "camp-001",
    marketingPartnerId: "partner-001",
    cpaRate: 150, // Rs 150 per redemption
  };

  const mockPartner = {
    id: "partner-001",
    name: "Pokhara Food Hub",
  };

  const journal = await postMarketingCpaRedemptionAccounting({
    redemption: mockRedemption,
    campaign: mockCampaign,
    partner: mockPartner,
    client,
  });

  assert.ok(journal);
  assert.equal(journal.sourceType, "MARKETING_CPA");
  assert.equal(journal.totalDebit.toFixed(2), "150.00");
  assert.equal(journal.totalCredit.toFixed(2), "150.00");

  const cpaExpLine = journal.lines.find((l) => l.account.accountCode === "6420");
  const partnerApLine = journal.lines.find((l) => l.account.accountCode === "2170");

  assert.equal(cpaExpLine.debit.toFixed(2), "150.00");
  assert.equal(partnerApLine.credit.toFixed(2), "150.00");
});

test("NCM carrier settlement clears COD receivable and books carrier expense", async () => {
  const { client } = createComprehensiveHarness();

  const mockSettlement = {
    id: "settle-001",
    ncmTicketId: 10045,
    codCollected: 10000,
    deliveryFeeActual: 350,
    settledAt: new Date(),
  };

  const journal = await postNcmSettlementAccounting({ settlement: mockSettlement, client });

  assert.ok(journal);
  assert.equal(journal.sourceType, "NCM_SETTLEMENT");
  assert.equal(journal.totalDebit.toFixed(2), "10000.00");
  assert.equal(journal.totalCredit.toFixed(2), "10000.00");

  const bankLine = journal.lines.find((l) => l.account.accountCode === "1120");
  const feeLine = journal.lines.find((l) => l.account.accountCode === "6430");
  const codLine = journal.lines.find((l) => l.account.accountCode === "1170");

  assert.equal(bankLine.debit.toFixed(2), "9650.00"); // 10,000 - 350
  assert.equal(feeLine.debit.toFixed(2), "350.00");
  assert.equal(codLine.credit.toFixed(2), "10000.00");
});
