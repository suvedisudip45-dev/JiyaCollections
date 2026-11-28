import assert from "node:assert/strict";
import test from "node:test";
import {
  postOrderCustomerPaymentAccounting,
  recordDeliveredOrderCashReceipt,
} from "../services/orderPaymentAccountingService.js";

const clone = (value) => structuredClone(value);

const createHarness = ({
  status = "Delivered",
  payment = false,
  journals = [],
  collectionEvent = { amount: "125.00" },
} = {}) => {
  const state = {
    order: { id: "order-1", amount: 125, customerName: "Test Customer", status, payment },
    journals: clone(journals),
    collectionEvent: clone(collectionEvent),
  };
  const makeTransactionClient = (transactionState) => ({
    order: {
      findUnique: async ({ where }) => transactionState.order.id === where.id ? transactionState.order : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, transactionState.order.id);
        Object.assign(transactionState.order, data);
        return transactionState.order;
      },
    },
    journalEntry: {
      findFirst: async ({ where }) => transactionState.journals.find((journal) =>
        journal.sourceType === where.sourceType &&
        journal.sourceId === where.sourceId &&
        where.status.in.includes(journal.status)
      ) || null,
      create: async ({ data }) => {
        const journal = { id: `journal-${transactionState.journals.length + 1}`, ...data };
        transactionState.journals.push(journal);
        return journal;
      },
    },
    distributorCashEvent: {
      findFirst: async ({ where }) => (
        transactionState.collectionEvent &&
        where.eventType === "CUSTOMER_COLLECTION" &&
        where.status.in.includes("VERIFIED")
          ? transactionState.collectionEvent
          : null
      ),
    },
  });
  const client = {
    $transaction: async (callback) => {
      const transactionState = clone(state);
      const result = await callback(makeTransactionClient(transactionState));
      state.order = transactionState.order;
      state.journals = transactionState.journals;
      return result;
    },
  };
  return { client, state, makeTransactionClient };
};

test("delivered cash receipt rolls back payment state when accounting posting fails", async () => {
  const { client, state } = createHarness();

  await assert.rejects(
    recordDeliveredOrderCashReceipt("order-1", {
      client,
      postAccounting: async () => {
        throw new Error("Customer payment journal failed.");
      },
    }),
    /Customer payment journal failed/,
  );

  assert.equal(state.order.payment, false);
  assert.deepEqual(state.journals, []);
});

test("delivered cash receipt posts with a stable order event key and replays without a duplicate", async () => {
  const { client, state } = createHarness();
  const postedKeys = [];

  const postAccounting = async (input) => {
    postedKeys.push(input.idempotencyKey);
    assert.equal(input.client.order.findUnique instanceof Function, true);
    return input.client.journalEntry.create({ data: {
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: input.id,
      status: "POSTED",
      idempotencyKey: input.idempotencyKey,
    } });
  };

  await recordDeliveredOrderCashReceipt("order-1", { client, postAccounting });
  await recordDeliveredOrderCashReceipt("order-1", { client, postAccounting });

  assert.equal(state.order.payment, true);
  assert.deepEqual(postedKeys, ["CUSTOMER_PAYMENT:ORDER:order-1"]);
  assert.equal(state.journals.length, 1);
});

test("order payment poster reuses prior legacy posted journals and blocks reversed payment history", async () => {
  let posterCalls = 0;
  const postedJournal = { id: "legacy-journal", status: "POSTED" };
  const reversedJournal = { id: "reversed-journal", status: "REVERSED" };
  const client = {
    journalEntry: {
      findFirst: async ({ where }) => where.sourceId === "order-posted" ? postedJournal : reversedJournal,
    },
  };
  const postAccounting = async () => {
    posterCalls += 1;
    return { id: "new-journal" };
  };

  assert.equal(await postOrderCustomerPaymentAccounting({ id: "order-posted", amount: 25 }, {
    client,
    postAccounting,
  }), postedJournal);
  await assert.rejects(
    postOrderCustomerPaymentAccounting({ id: "order-reversed", amount: 25 }, { client, postAccounting }),
    { code: "CUSTOMER_PAYMENT_JOURNAL_REVERSED" },
  );
  assert.equal(posterCalls, 0);
});

test("cash receipt rejects orders that are not delivered without changing payment state", async () => {
  const { client, state } = createHarness({ status: "In Transit" });

  await assert.rejects(
    recordDeliveredOrderCashReceipt("order-1", { client }),
    { code: "ORDER_NOT_DELIVERED" },
  );

  assert.equal(state.order.payment, false);
  assert.deepEqual(state.journals, []);
});

test("delivered order cannot be marked paid without verified collection evidence", async () => {
  const { client, state } = createHarness({ collectionEvent: null });

  await assert.rejects(
    recordDeliveredOrderCashReceipt("order-1", { client }),
    { code: "CUSTOMER_COLLECTION_EVIDENCE_REQUIRED" },
  );

  assert.equal(state.order.payment, false);
  assert.deepEqual(state.journals, []);
});

test("delivered order cannot be marked paid for a mismatched COD collection amount", async () => {
  const { client, state } = createHarness({ collectionEvent: { amount: "124.00" } });

  await assert.rejects(
    recordDeliveredOrderCashReceipt("order-1", { client }),
    { code: "CUSTOMER_COLLECTION_AMOUNT_MISMATCH" },
  );

  assert.equal(state.order.payment, false);
  assert.deepEqual(state.journals, []);
});

test("cash receipt retries bounded serializable conflicts and replays its posted journal", async () => {
  const { client, state } = createHarness();
  const transaction = client.$transaction;
  let conflictCount = 0;
  let postingCount = 0;
  client.$transaction = async (callback, options) => {
    if (conflictCount === 0) {
      conflictCount += 1;
      throw Object.assign(new Error("Serializable conflict"), { code: "P2034" });
    }
    return transaction(callback, options);
  };
  const postAccounting = async (input) => {
    postingCount += 1;
    return input.client.journalEntry.create({ data: {
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: input.id,
      status: "POSTED",
      idempotencyKey: input.idempotencyKey,
    } });
  };

  await recordDeliveredOrderCashReceipt("order-1", { client, postAccounting });

  assert.equal(conflictCount, 1);
  assert.equal(postingCount, 1);
  assert.equal(state.order.payment, true);
  assert.equal(state.journals.length, 1);
});
