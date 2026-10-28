import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  postDeliveredOrderAccounting,
  postConfirmedDeliveryReturnAccounting,
  postCustomerPaymentAccounting,
  postDistributorCustomerRefundAccounting,
  postMarketingCpaRedemptionAccounting,
  postNcmRemittanceAccounting,
  postNcmSettlementAccounting,
  postJournalEntry,
  postSupplierPaymentAccounting,
  postDistributorSettlementRequestAccounting,
  STANDARD_ACCOUNT_MAPPINGS,
  STANDARD_CHART_OF_ACCOUNTS,
} from "../services/accountingPostingEngine.js";
import { isLegacyPerOrderDeliveryExpenseEntry } from "../services/accountingRecognitionPolicy.js";
import { consumeDistributorOrderInventory } from "../services/distributorOrderInventoryService.js";
import { postReturnExchangeSettlementAccounting } from "../services/returnExchangeSettlementService.js";

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
    documents: [],
    vatRateVersions: [],
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
    accountingDocument: {
      upsert: async ({ where, create, include }) => {
        let document = state.documents.find((entry) => entry.idempotencyKey === where.idempotencyKey);
        if (!document) {
          document = { id: `document-${state.documents.length + 1}`, ...create };
          state.documents.push(document);
        }
        return include?.party
          ? { ...document, party: [...parties.values()].find((party) => party.id === document.partyId) || null }
          : document;
      },
    },
    taxConfiguration: {
      findUnique: async () => ({ vatRate: 13 }),
    },
    vatRateVersion: {
      findFirst: async ({ where }) => state.vatRateVersions
        .filter((version) =>
          version.status === where.status &&
          version.effectiveFrom <= where.effectiveFrom.lte &&
          (!version.effectiveUntil || version.effectiveUntil > where.effectiveFrom.lte)
        )
        .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] || null,
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
      findUnique: async ({ where }) => state.events.find((e) => e.id === where.id) || null,
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
    distributor: {
      findUnique: async ({ where }) => ({ id: where.id, name: "Distributor One" }),
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

test("delivered sales use the VAT rate effective on the source order date", async () => {
  const { client, state } = createComprehensiveHarness();
  state.vatRateVersions.push({
    id: "vat-20",
    vatRate: new Prisma.Decimal("20.00"),
    effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    status: "ACTIVE",
  });

  const journal = await postDeliveredOrderAccounting({
    id: "ord-vat-20",
    amount: 1200,
    paymentMethod: "ONLINE_BANK",
    date: BigInt(Date.parse("2027-01-02T00:00:00.000Z")),
    items: [],
  }, { client });

  assert.equal(journal.lines.find((line) => line.account.accountCode === "4100").credit.toFixed(2), "1000.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2120").credit.toFixed(2), "200.00");
});

test("self-delivered COD posts to distributor receivable and creates an idempotent AR document", async () => {
  const { client, state, parties } = createComprehensiveHarness();
  const order = {
    id: "ord-distributor-cod-001",
    userId: "user-cust-001",
    amount: 1500,
    deliveryCharge: 100,
    paymentMethod: "COD",
    collectionDistributorId: "dist-001",
    orderType: "ONLINE_STORE",
    items: [],
  };

  const first = await postDeliveredOrderAccounting(order, { client });
  const second = await postDeliveredOrderAccounting(order, { client });
  const receivableLine = first.lines.find((line) => line.account.accountCode === "1190");

  assert.equal(first.id, second.id);
  assert.equal(state.entries.length, 1);
  assert.equal(receivableLine.debit.toFixed(2), "1500.00");
  assert.equal(parties.get("DISTRIBUTOR:dist-001").displayName, "Distributor One");
  assert.equal(state.documents.length, 1);
  assert.equal(state.documents[0].idempotencyKey, "DISTRIBUTOR_COD_SALE:ord-distributor-cod-001");
  assert.equal(state.documents[0].originalAmount.toFixed(2), "1500.00");
  assert.equal(state.documents[0].side, "RECEIVABLE");
});

test("verified distributor-paid customer refund creates balanced GL and distributor AP", async () => {
  const { client, state } = createComprehensiveHarness();
  const journal = await postDistributorCustomerRefundAccounting({
    client,
    returnRecord: {
      id: "return-dist-001",
      distributorId: "dist-001",
      approvedRefundAmount: "900.00",
      vatRefunded: 103.54,
      completedAt: new Date("2026-10-01T10:00:00.000Z"),
      items: [
        { condition: "RESTOCKABLE", unitCostPrice: 50, quantity: 2 },
        { condition: "DAMAGED", unitCostPrice: 80, quantity: 1 },
      ],
    },
  });
  assert.equal(journal.totalDebit.toFixed(2), "1000.00");
  assert.equal(journal.totalCredit.toFixed(2), "1000.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2190").credit.toFixed(2), "900.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "1140").debit.toFixed(2), "100.00");
  assert.equal(state.documents.length, 1);
  assert.equal(state.documents[0].side, "PAYABLE");
  assert.equal(state.documents[0].originalAmount.toFixed(2), "900.00");
});

test("delivery accounting does not multiply batch logistics overhead across sold orders", async () => {
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

  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(cogsLine.debit.toFixed(2), "200.00");
  assert.equal(inventoryLine.credit.toFixed(2), "200.00");
  assert.equal(journal.lines.some((line) => line.account.accountCode === "6430"), false);
});

test("new manufacturer production layers flow through distributor delivery into P&L COGS", async () => {
  const { client } = createComprehensiveHarness();
  const fulfillmentMovements = [];
  const balance = { id: "balance-1", locationId: "dist-location-1", quantityOnHand: 2, reservedQuantity: 2 };
  client.inventorySku = {
    findUnique: async () => ({ id: "sku-1", isActive: true }),
  };
  client.inventoryBalance = {
    findMany: async ({ where }) => (where.location?.distributorId
      ? [{ ...balance }]
      : []),
    updateMany: async () => {
      balance.quantityOnHand = 0;
      balance.reservedQuantity = 0;
      return { count: 1 };
    },
  };
  client.inventoryLedgerEntry = {
    findMany: async ({ where }) => {
      if (where.referenceType === "ORDER") return [];
      return [
        {
          destinationLocationId: "dist-location-1",
          sourceLocationId: null,
          quantity: 1,
          productionCostLayerId: "layer-a",
          productionCostLayer: {
            id: "layer-a",
            unitCogs: "100.00",
            unitDeliveryCost: "10.00",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        },
        {
          destinationLocationId: "dist-location-1",
          sourceLocationId: null,
          quantity: 1,
          productionCostLayerId: "layer-b",
          productionCostLayer: {
            id: "layer-b",
            unitCogs: "125.00",
            unitDeliveryCost: "15.00",
            createdAt: new Date("2026-02-01T00:00:00Z"),
          },
        },
      ];
    },
    create: async ({ data }) => {
      fulfillmentMovements.push(data);
      return data;
    },
  };
  client.product = {
    findUnique: async () => ({ id: "prod-new-mfg", variants: [] }),
    update: async ({ data }) => data,
  };
  const inventoryConsumption = await consumeDistributorOrderInventory({
    tx: client,
    orderId: "ord-distributor-new-mfg-006",
    distributorId: "dist-1",
    assignmentId: "assignment-1",
    actorId: "account-1",
    items: [{ productId: "prod-new-mfg", size: "M", color: "Black", quantity: 2 }],
  });
  assert.deepEqual(fulfillmentMovements.map((movement) => movement.productionCostLayerId), ["layer-a", "layer-b"]);

  const journal = await postDeliveredOrderAccounting({
    id: "ord-distributor-new-mfg-006",
    userId: "user-cust-006",
    amount: 452,
    paymentMethod: "ONLINE_BANK",
    orderType: "ONLINE_STORE",
    items: inventoryConsumption.accountingItems,
  }, { client });

  const cogsLine = journal.lines.find((line) => line.account.accountCode === "5100");
  const inventoryLine = journal.lines.find((line) => line.account.accountCode === "1140");
  assert.equal(cogsLine.debit.toFixed(2), "225.00");
  assert.equal(inventoryLine.credit.toFixed(2), "225.00");
  assert.equal(journal.lines.some((line) => line.account.accountCode === "6430"), false);
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
});

test("financial statement excludes legacy per-order batch overhead but keeps carrier charges", () => {
  assert.equal(isLegacyPerOrderDeliveryExpenseEntry({
    accountCode: "6430",
    sourceType: "DELIVERY_SALE",
  }), true);
  assert.equal(isLegacyPerOrderDeliveryExpenseEntry({
    accountCode: "6430",
    sourceType: "DELIVERY_RETURN",
  }), true);
  assert.equal(isLegacyPerOrderDeliveryExpenseEntry({
    accountCode: "6430",
    sourceType: "MANUFACTURER_LOGISTICS",
  }), false);
  assert.equal(isLegacyPerOrderDeliveryExpenseEntry({
    accountCode: "6430",
    sourceType: "NCM_SETTLEMENT",
  }), false);
  assert.equal(isLegacyPerOrderDeliveryExpenseEntry({
    accountCode: "5100",
    sourceType: "DELIVERY_SALE",
  }), false);
});

test("delivered direct manufacturer COD sale recognizes approved COGS and COD receivable only", async () => {
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
    items: [
      {
        productId: "prod-001",
        quantity: 2,
        agreedUnitCogsVatInclusiveAtAcceptance: "3000.00", // Gross COGS = 6000
      },
    ],
  };

  const journal = await postDeliveredOrderAccounting(mockOrder, { client });

  assert.ok(journal);
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));

  const codLine = journal.lines.find((l) => l.account.accountCode === "1170");
  const mfgApLines = journal.lines.filter((l) => l.account.accountCode === "2160");

  assert.equal(codLine.debit.toFixed(2), "11300.00");
  const totalMfgApCredit = mfgApLines.reduce((acc, l) => acc.plus(l.credit), new Prisma.Decimal(0));
  assert.equal(totalMfgApCredit.toFixed(2), "6000.00");
  assert.equal(journal.lines.some((line) => line.account.accountCode === "6410"), false);
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

test("delivered sale posting consumes a claimed outbox event and includes the order delivery fee", async () => {
  const { client, state } = createComprehensiveHarness();
  const sourcePayload = {
    snapshotVersion: 1,
    order: { id: "ord-outbox-005", amount: "226.00" },
  };
  const accountingEvent = {
    id: "event-outbox-005",
    idempotencyKey: "DELIVERY_SALE:ord-outbox-005",
    sourceType: "DELIVERY_SALE",
    sourceId: "ord-outbox-005",
    status: "PROCESSING",
    payload: sourcePayload,
    payloadHash: "immutable-source-hash",
  };
  state.events.push(accountingEvent);

  const journal = await postDeliveredOrderAccounting({
    order: {
      id: "ord-outbox-005",
      amount: 226,
      deliveryFee: 22.6,
      paymentMethod: "COD",
      orderType: "ONLINE_STORE",
      items: [],
    },
    deliveryOrder: { deliveredAt: new Date("2026-10-16T10:00:00.000Z") },
  }, { client, accountingEventId: accountingEvent.id });

  assert.equal(journal.accountingEventId, accountingEvent.id);
  assert.equal(journal.lines.find((line) => line.account.accountCode === "4200").credit.toFixed(2), "20.00");
  assert.equal(accountingEvent.status, "POSTED");
  assert.equal(accountingEvent.nextAttemptAt, null);
  assert.deepEqual(accountingEvent.payload, sourcePayload);
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
    cashAccountId: "acc-1120",
    supplierId: "mfg-001",
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
  const payableLine = journal.lines.find((line) => line.account.accountCode === "2160");
  const treasuryLine = journal.lines.find((line) => line.account.id === "acc-1120");
  assert.equal(payableLine.supplierId, "mfg-001");
  assert.equal(treasuryLine.credit.toFixed(2), "1200.00");
});

test("distributor refund reimbursement clears the distributor payable control account", async () => {
  const { client } = createComprehensiveHarness();
  delete client.$transaction;
  const journal = await postSupplierPaymentAccounting({
    payableId: "refund-document-001",
    payeeName: "Distributor One",
    amount: 875.5,
    settlementAmount: 875.5,
    payableAccountCode: "2190",
    cashAccountId: "acc-1120",
    accountingPartyId: "party-dist-001",
    idempotencyKey: "DISTRIBUTOR_REFUND_PAYOUT:refund-001",
    client,
  });
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2190").debit.toFixed(2), "875.50");
  assert.equal(journal.lines.find((line) => line.account.id === "acc-1120").credit.toFixed(2), "875.50");
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
});

test("manufacturer local freight is expensed and accrued to payable when dispatched", async () => {
  const { client, state } = createComprehensiveHarness();
  delete client.$transaction;
  const journal = await postJournalEntry({
    sourceType: "MANUFACTURER_LOGISTICS",
    sourceId: "transfer-001",
    idempotencyKey: "MANUFACTURER_LOGISTICS:TRANSFER:transfer-001",
    lines: [
      { mappingKey: "DELIVERY_EXPENSE", debit: 100, credit: 0, supplierId: "mfg-001", supplierName: "Alpha Textiles" },
      { accountCode: "2160", debit: 0, credit: 100, supplierId: "mfg-001", supplierName: "Alpha Textiles" },
    ],
    client,
  });
  assert.equal(journal.sourceType, "MANUFACTURER_LOGISTICS");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "6430").debit.toFixed(2), "100.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2160").credit.toFixed(2), "100.00");
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  const payment = await postSupplierPaymentAccounting({
    payableId: "mfg-logistics-001",
    payeeName: "Alpha Textiles",
    amount: 100,
    settlementAmount: 100,
    payableAccountCode: "2160",
    fromAccountType: "CASH",
    idempotencyKey: "SUPPLIER_PAYMENT:mfg-logistics-001",
    client,
  });
  assert.equal(payment.lines.find((line) => line.account.accountCode === "2160").debit.toFixed(2), "100.00");
  assert.equal(payment.lines.find((line) => line.account.accountCode === "1110").credit.toFixed(2), "100.00");
  assert.equal(state.entries.flatMap((entry) => entry.lines)
    .filter((line) => line.account.accountCode === "6430")
    .reduce((total, line) => total + Number(line.debit), 0), 100);
});

test("distributor settlement request accrues delivery expense and accounts payable once", async () => {
  const { client, state } = createComprehensiveHarness();
  delete client.$transaction;
  const request = {
    id: "dist-settlement-001",
    amount: 250,
    requestedAt: new Date("2026-10-17T12:00:00.000Z"),
  };
  const journal = await postDistributorSettlementRequestAccounting({
    settlement: request,
    distributorName: "Kathmandu Hub",
    client,
  });
  const retry = await postDistributorSettlementRequestAccounting({
    settlement: request,
    distributorName: "Kathmandu Hub",
    client,
  });

  assert.equal(retry.id, journal.id);
  assert.equal(journal.lines.find((line) => line.account.accountCode === "6430").debit.toFixed(2), "250.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2110").credit.toFixed(2), "250.00");
  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(state.entries.filter((entry) => entry.sourceId === request.id).length, 1);
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

test("NCM remittance rejects carrier fees greater than collected COD", async () => {
  const { client, state } = createComprehensiveHarness();
  delete client.$transaction;

  await assert.rejects(() => postNcmRemittanceAccounting({
    settlementId: "ncm-settlement-invalid-fee",
    codCollected: 100,
    deliveryFeeActual: 101,
  }, { client }), /Carrier fee cannot exceed NCM COD collected/);
  assert.equal(state.entries.length, 0);
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

test("production-layer return restores inventory without reversing batch freight overhead per order", async () => {
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
  const inventoryRestock = journal.lines.find((line) => line.account.accountCode === "1140");
  const cogsReversal = journal.lines.find((line) => line.account.accountCode === "5100");

  assert.equal(journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2));
  assert.equal(journal.lines.some((line) => line.account.accountCode === "2160"), false);
  assert.equal(journal.lines.some((line) => line.account.accountCode === "6430"), false);
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

test("return logistics payable and expense journal can post in its source transaction", async () => {
  const { client } = createComprehensiveHarness();
  const journal = await postReturnExchangeSettlementAccounting({
    operation: "RETURN",
    requestId: "return-logistics-001",
    payable: {
      title: "Return logistics settlement",
      payeeName: "NCM",
      totalAmount: new Prisma.Decimal("42.00"),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    client,
  });

  assert.equal(journal.status, "POSTED");
  assert.equal(journal.totalDebit.toFixed(2), "42.00");
  assert.equal(journal.totalCredit.toFixed(2), "42.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "6430").debit.toFixed(2), "42.00");
  assert.equal(journal.lines.find((line) => line.account.accountCode === "2110").credit.toFixed(2), "42.00");
});
