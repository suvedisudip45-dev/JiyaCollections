import assert from "node:assert/strict";
import test from "node:test";
import {
  accrueDistributorDeliveryEarning,
  accrueDistributorCounterSaleEarning,
  accrueDistributorNcmTransferEarning,
  accrueDistributorStockTransferEarning,
  accrueDistributorServiceCharge,
  reverseDistributorCounterSaleEarning,
} from "../services/distributorServiceEarningService.js";
import { reconcileSubledgerToControl } from "../services/accountingSubledgerService.js";

const createHarness = () => {
  const state = { earnings: [], journals: [], documents: [], order: null };
  let allocationId = 0;
  const client = {
    distributorServiceEarning: {
      findUnique: async ({ where }) => state.earnings.find((earning) => earning.idempotencyKey === where.idempotencyKey) || null,
      findMany: async ({ where }) => state.earnings.filter((earning) => (
        (!where.distributorId || earning.distributorId === where.distributorId) &&
        (!where.orderId || earning.orderId === where.orderId) &&
        (!where.serviceType || earning.serviceType === where.serviceType)
      )),
      create: async ({ data }) => {
        const earning = { id: `earning-${state.earnings.length + 1}`, ...data };
        state.earnings.push(earning);
        return earning;
      },
      update: async ({ where, data }) => {
        const earning = state.earnings.find((item) => item.id === where.id);
        Object.assign(earning, data);
        return earning;
      },
    },
    order: {
      findUnique: async () => state.order,
    },
    accountingParty: {
      upsert: async ({ create }) => ({ id: "party-1", ...create }),
    },
    accountingDocument: {
      findMany: async ({ where }) => state.documents.filter((document) => (
        (!where.partyId || document.partyId === where.partyId) &&
        (!where.side || document.side === where.side) &&
        (!where.id?.in || where.id.in.includes(document.id)) &&
        (!where.sourceType?.in || where.sourceType.in.includes(document.sourceType)) &&
        (!where.status?.in || where.status.in.includes(document.status))
      )),
      updateMany: async ({ where, data }) => {
        const document = state.documents.find((item) => item.id === where.id);
        if (!document) return { count: 0 };
        Object.assign(document, data);
        return { count: 1 };
      },
      upsert: async ({ create }) => {
        const prior = state.documents.find((item) => item.idempotencyKey === create.idempotencyKey);
        if (prior) return prior;
        const document = { id: `document-${state.documents.length + 1}`, ...create };
        state.documents.push(document);
        return document;
      },
    },
    accountingAllocation: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: `allocation-${++allocationId}`, ...data }),
    },
  };
  return { client, state };
};

test("delivery earning excludes new per-delivery incentives and snapshots the approved rate", async () => {
  const { client, state } = createHarness();
  const result = await accrueDistributorDeliveryEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    effectiveAt: new Date("2026-10-27T00:00:00.000Z"),
    client,
    rateCardResolver: async () => ({
      rateCardId: "rate-1",
      deliveryCharge: 200,
      bonusRate: 40,
      commissionRate: 10,
    }),
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "journal-1" };
    },
  });

  test("hub counter sale earning is separate, idempotent, and snapshots its merchandise base", async () => {
    const { client, state } = createHarness();
    const result = await accrueDistributorCounterSaleEarning({
      distributorId: "dist-1",
      distributorName: "Distributor One",
      assignmentId: "assignment-1",
      orderId: "order-1",
      saleBaseAmount: 1200,
      client,
      rateCardResolver: async () => ({ rateCardId: "rate-1", counterSaleCharge: 25 }),
      journalPoster: async (journal) => {
        state.journals.push(journal);
        return { id: "counter-journal-1" };
      },
    });

    assert.equal(result.serviceType, "COUNTER_SALE");
    assert.equal(result.otherCharges.toString(), "25");
    assert.equal(result.payableAmount.toString(), "25");
    assert.equal(result.snapshot.saleBaseAmount, "1200.00");
    assert.equal(state.journals[0].lines[0].mappingKey, "DISTRIBUTOR_COUNTER_SALE_EXPENSE");
  });

  test("hub sale return reverses compensation proportionally and records an unapplied payable credit", async () => {
    const { client, state } = createHarness();
    const original = {
      id: "earning-original",
      distributorId: "dist-1",
      orderId: "order-1",
      assignmentId: "assignment-1",
      serviceType: "COUNTER_SALE",
      idempotencyKey: "DISTRIBUTOR_COUNTER_SALE_EARNING:order-1",
      rateCardId: "rate-1",
      payableAmount: "40.00",
      snapshot: { saleBaseAmount: "1000.00" },
    };
    state.earnings.push(original);
    state.order = {
      id: "order-1",
      orderType: "DIRECT_DISTRIBUTOR",
      directOrderType: "HUB_VISIT",
      distributorId: "dist-1",
    };
    const journalCalls = [];
    const result = await reverseDistributorCounterSaleEarning({
      returnRecord: {
        id: "return-1",
        orderId: "order-1",
        distributorId: "dist-1",
        items: [{ quantity: 1, unitPrice: 250, refundAmount: 250 }],
      },
      distributorName: "Distributor One",
      client,
      journalPoster: async (journal) => {
        journalCalls.push(journal);
        return { id: "reversal-journal-1" };
      },
    });

    assert.equal(result.serviceType, "COUNTER_SALE_REVERSAL");
    assert.equal(result.payableAmount.toString(), "-10");
    assert.equal(result.appliedReversalAmount.toString(), "0");
    assert.equal(journalCalls[0].lines[0].mappingKey, "DISTRIBUTOR_PAYABLE");
    assert.equal(journalCalls[0].lines[1].mappingKey, "DISTRIBUTOR_COUNTER_SALE_EXPENSE");
    assert.equal(state.documents[0].documentType, "CREDIT_NOTE");
  });

  test("unapplied hub-sale return credit offsets a future service earning document", async () => {
    const { client, state } = createHarness();
    const reversal = {
      id: "reversal-1",
      distributorId: "dist-1",
      orderId: "order-1",
      serviceType: "COUNTER_SALE_REVERSAL",
      payableAmount: "-10.00",
      appliedReversalAmount: "0.00",
      accountingDocumentId: "credit-note-1",
      journalEntryId: "reversal-journal-1",
    };
    state.earnings.push(reversal);
    state.documents.push({
      id: "credit-note-1",
      partyId: "party-1",
      side: "PAYABLE",
      sourceType: "DISTRIBUTOR_SERVICE_EARNING_REVERSAL",
      originalAmount: "10.00",
      allocatedAmount: "0.00",
      remainingAmount: "10.00",
      status: "OPEN",
      documentType: "CREDIT_NOTE",
    });

    await accrueDistributorServiceCharge({
      distributorId: "dist-1",
      distributorName: "Distributor One",
      assignmentId: "assignment-2",
      orderId: "order-2",
      sourceId: "return-service-2",
      serviceType: "RETURN",
      chargeAmount: 20,
      client,
      journalPoster: async () => ({ id: "service-journal-2" }),
    });

    const serviceBill = state.documents.find((document) => document.idempotencyKey === "DISTRIBUTOR_RETURN_EARNING:return-service-2");
    assert.equal(serviceBill.remainingAmount.toString(), "10");
    assert.equal(state.documents.find((document) => document.id === "credit-note-1").remainingAmount.toString(), "0");
    assert.equal(reversal.appliedReversalAmount.toString(), "10");
  });

  test("open payable credit notes reduce the distributor payable subledger balance", async () => {
    const result = await reconcileSubledgerToControl({
      side: "PAYABLE",
      accountCode: "2190",
      partyType: "DISTRIBUTOR",
    }, {
      client: {
        account: { findUnique: async () => ({ accountName: "Distributor Payable", currentBalance: "20.00" }) },
        accountingDocument: {
          findMany: async () => [
            { documentType: "BILL", remainingAmount: "50.00" },
            { documentType: "CREDIT_NOTE", remainingAmount: "30.00" },
          ],
        },
      },
    });

    assert.equal(result.subledgerTotal, "20.00");
    assert.equal(result.variance, "0.00");
    assert.equal(result.isBalanced, true);
  });

  assert.equal(result.incentiveAmount.toString(), "0");
  assert.equal(result.payableAmount.toString(), "180");
  assert.equal(result.rateCardId, "rate-1");
  assert.equal(result.vatAmount.toString(), "0");
  assert.equal(result.accountingDocumentId, "document-1");
  assert.equal(result.journalEntryId, "journal-1");
  assert.equal(state.documents[0].side, "PAYABLE");
  assert.equal(state.documents[0].sourceType, "DISTRIBUTOR_SERVICE_EARNING");
  assert.equal(state.journals[0].lines[0].debit.toString(), "180");
  assert.equal(state.journals[0].lines[1].credit.toString(), "180");
});

test("delivery earning replay does not accrue a duplicate document or journal", async () => {
  const { client, state } = createHarness();
  const input = {
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    client,
    rateCardResolver: async () => ({ deliveryCharge: 100 }),
    journalPoster: async () => {
      state.journals.push("posted");
      return { id: "journal-1" };
    },
  };
  const first = await accrueDistributorDeliveryEarning(input);
  const replay = await accrueDistributorDeliveryEarning(input);

  assert.equal(first.id, replay.id);
  assert.equal(state.earnings.length, 1);
  assert.equal(state.documents.length, 1);
  assert.equal(state.journals.length, 1);
});

test("delivery earning rejects a commission larger than the contracted compensation", async () => {
  const { client } = createHarness();
  await assert.rejects(() => accrueDistributorDeliveryEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    client,
    rateCardResolver: async () => ({ deliveryCharge: 100, commissionRate: 150 }),
  }), /commission exceeds delivery compensation/);
});

test("return service charge is snapshotted and creates a payable earning document with VAT", async () => {
  const { client, state } = createHarness();
  const result = await accrueDistributorServiceCharge({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    sourceId: "return-1",
    serviceType: "RETURN",
    chargeAmount: 50,
    vatRate: 13,
    effectiveAt: new Date("2026-10-30T00:00:00.000Z"),
    client,
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "return-journal-1" };
    },
  });

  assert.equal(result.serviceType, "RETURN");
  assert.equal(result.otherCharges.toString(), "50");
  assert.equal(result.vatAmount.toString(), "6.5");
  assert.equal(result.payableAmount.toString(), "56.5");
  assert.equal(result.accountingDocumentId, "document-1");
  assert.equal(result.journalEntryId, "return-journal-1");
  assert.equal(state.documents[0].sourceType, "DISTRIBUTOR_SERVICE_EARNING");
  assert.equal(state.documents[0].originalAmount.toString(), "56.5");
  assert.equal(state.journals[0].lines[1].credit.toString(), "56.5");
});

test("NCM transfer earning uses the distributor rate, separate expense mapping, and idempotent payable", async () => {
  const { client, state } = createHarness();
  const input = {
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    sourceId: "delivery-1",
    serviceType: "NCM_TRANSFER",
    chargeAmount: 80,
    client,
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "ncm-journal-1" };
    },
  };
  const first = await accrueDistributorServiceCharge(input);
  const replay = await accrueDistributorServiceCharge(input);

  assert.equal(first.id, replay.id);
  assert.equal(first.serviceType, "NCM_TRANSFER");
  assert.equal(first.otherCharges.toString(), "80");
  assert.equal(first.vatAmount.toString(), "0");
  assert.equal(first.payableAmount.toString(), "80");
  assert.equal(state.earnings.length, 1);
  assert.equal(state.documents[0].originalAmount.toString(), "80");
  assert.equal(state.journals[0].lines[0].mappingKey, "DISTRIBUTOR_NCM_TRANSFER_EXPENSE");
  assert.equal(state.journals[0].lines[1].mappingKey, "DISTRIBUTOR_PAYABLE");
  assert.equal(state.journals.length, 1);
});

test("NCM transfer earning snapshots the configured distributor fee and skips a zero fee", async () => {
  const { client } = createHarness();
  const captured = [];
  const input = {
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    deliveryOrderId: "delivery-1",
    effectiveAt: new Date("2026-10-31T00:00:00.000Z"),
    client,
    rateCardResolver: async ({ distributorId, effectiveAt }) => {
      assert.equal(distributorId, "dist-1");
      assert.equal(effectiveAt.toISOString(), "2026-10-31T00:00:00.000Z");
      return { rateCardId: "rate-1", ncmTransferCharge: 75 };
    },
    accrueServiceCharge: async (earning) => {
      captured.push(earning);
      return earning;
    },
  };

  const earning = await accrueDistributorNcmTransferEarning(input);
  assert.equal(earning.serviceType, "NCM_TRANSFER");
  assert.equal(earning.sourceId, "delivery-1");
  assert.equal(earning.rateCardId, "rate-1");
  assert.equal(earning.chargeAmount.toString(), "75");
  assert.equal(captured.length, 1);

  const zeroFee = await accrueDistributorNcmTransferEarning({
    ...input,
    rateCardResolver: async () => ({ ncmTransferCharge: 0 }),
  });
  assert.equal(zeroFee, null);
  assert.equal(captured.length, 1);
});

test("stock-transfer compensation is paid per successfully delivered product unit", async () => {
  const { client, state } = createHarness();
  const earning = await accrueDistributorStockTransferEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-1",
    items: JSON.stringify([{ quantity: 2 }, { qty: 3 }]),
    client,
    rateCardResolver: async () => ({ rateCardId: "rate-1", stockTransferCharge: 12.5 }),
    journalPoster: async (journal) => {
      state.journals.push(journal);
      return { id: "stock-transfer-journal-1" };
    },
  });

  assert.equal(earning.serviceType, "STOCK_TRANSFER");
  assert.equal(earning.otherCharges.toString(), "62.5");
  assert.equal(earning.payableAmount.toString(), "62.5");
  assert.equal(earning.snapshot.quantity, 5);
  assert.equal(earning.snapshot.unitCharge, "12.50");
  assert.equal(state.journals[0].lines[0].mappingKey, "DISTRIBUTOR_STOCK_TRANSFER_EXPENSE");

  await assert.rejects(() => accrueDistributorStockTransferEarning({
    distributorId: "dist-1",
    distributorName: "Distributor One",
    assignmentId: "assignment-1",
    orderId: "order-2",
    items: [{ quantity: 0 }],
    client,
    rateCardResolver: async () => ({ stockTransferCharge: 12.5 }),
  }), /positive whole-number quantity/);
});
