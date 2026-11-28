import assert from "node:assert/strict";
import test from "node:test";
import {
  addDecimals,
  compareDecimals,
} from "../services/accountingDecimal.js";
import {
  applyReceivableCollection,
  classifyReceivableCollectionReplay,
  parseReceivableCollectionAmounts,
} from "../services/receivableCollectionService.js";

const createCollectionHarness = (receivable) => {
  const state = {
    receivable: receivable ? { ...receivable, collectionHistory: receivable.collectionHistory || [] } : null,
    balance: "0.00",
    transactions: [],
    journals: [],
  };
  const client = {
    financialAccount: {
      update: async ({ data }) => {
        state.balance = addDecimals(state.balance, data.currentBalance.increment).toFixed(2);
      },
    },
    cashTransaction: {
      create: async ({ data }) => {
        if (state.transactions.some((transaction) => transaction.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Duplicate idempotency key"), { code: "P2002" });
        }
        state.transactions.push(data);
        return data;
      },
    },
    accountReceivable: {
      updateMany: async ({ where, data }) => {
        const current = state.receivable;
        const matches = current?.id === where.id &&
          current.status === where.status &&
          compareDecimals(current.totalAmount, where.totalAmount) === 0 &&
          compareDecimals(current.receivedAmount, where.receivedAmount) === 0 &&
          compareDecimals(current.remainingBalance, where.remainingBalance) === 0;
        if (!matches) return { count: 0 };
        Object.assign(current, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        state.receivable = { ...data };
        return state.receivable;
      },
    },
  };
  const postAccounting = async (input) => {
    const debit = addDecimals(input.amount, input.discountAmount);
    const credit = addDecimals(input.settlementAmount, input.fineAmount);
    const journal = {
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      input,
    };
    state.journals.push(journal);
    return journal;
  };
  return { client, state, postAccounting };
};

const collect = async (harness, receivable, input) => {
  const amounts = parseReceivableCollectionAmounts(input);
  return applyReceivableCollection({
    client: harness.client,
    receivable,
    amounts,
    idempotencyKey: input.idempotencyKey,
    toAccountId: "bank-1",
    toAccountName: "Operating Bank",
    notes: input.notes,
    category: "SALES",
    referenceId: receivable.id,
    partyName: receivable.payerName,
    description: "Test collection",
    postAccounting: harness.postAccounting,
    orderId: receivable.id,
    customerName: receivable.payerName,
    depositAccountType: "BANK",
  });
};

test("partial fractional collections round HALF_EVEN and settle the exact remaining balance", async () => {
  const receivable = {
    id: "ar-fractional",
    title: "Fractional sale",
    payerName: "Customer",
    category: "CUSTOMER_RECEIVABLE",
    totalAmount: "10.02",
    receivedAmount: "0.00",
    remainingBalance: "10.02",
    status: "UNPAID",
  };
  const harness = createCollectionHarness(receivable);

  const first = await collect(harness, receivable, {
    amount: "2.005",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
    idempotencyKey: "COLLECT-1",
  });
  assert.equal(first.collectedAmount, "2.00");
  assert.equal(first.remainingBalance, "8.02");
  assert.equal(first.status, "PARTIALLY_RECEIVED");

  const second = await collect(harness, harness.state.receivable, {
    amount: "8.015",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
    idempotencyKey: "COLLECT-2",
  });
  assert.equal(second.collectedAmount, "8.02");
  assert.equal(second.remainingBalance, "0.00");
  assert.equal(second.receivedAmount, "10.02");
  assert.equal(second.status, "SETTLED");
  assert.equal(harness.state.balance, "10.02");
  assert.deepEqual(harness.state.transactions.map(({ amount }) => amount), ["2.00", "8.02"]);
  assert.equal(harness.state.journals.every(({ debit, credit }) => debit === credit), true);
  assert.equal(typeof second.remainingBalance, "string");
});

test("discount and fine collections preserve cash, receivable, and journal totals", async () => {
  const discountedReceivable = {
    id: "ar-discount",
    title: "Discounted sale",
    payerName: "Customer",
    category: "CUSTOMER_RECEIVABLE",
    totalAmount: "200.00",
    receivedAmount: "0.00",
    remainingBalance: "200.00",
    status: "UNPAID",
  };
  const discountHarness = createCollectionHarness(discountedReceivable);
  const discount = await collect(discountHarness, discountedReceivable, {
    amount: "180.00",
    adjustmentAmount: "20.00",
    adjustmentType: "DISCOUNT",
    idempotencyKey: "COLLECT-DISCOUNT",
  });
  assert.equal(discount.remainingBalance, "0.00");
  assert.equal(discount.receivedAmount, "180.00");
  assert.equal(discountHarness.state.balance, "180.00");
  assert.deepEqual(
    [discountHarness.state.journals[0].debit, discountHarness.state.journals[0].credit],
    ["200.00", "200.00"],
  );

  const finedReceivable = {
    ...discountedReceivable,
    id: "ar-fine",
  };
  const fineHarness = createCollectionHarness(finedReceivable);
  const fine = await collect(fineHarness, finedReceivable, {
    amount: "205.00",
    adjustmentAmount: "5.00",
    adjustmentType: "FINE",
    idempotencyKey: "COLLECT-FINE",
  });
  assert.equal(fine.remainingBalance, "0.00");
  assert.equal(fine.receivedAmount, "205.00");
  assert.equal(fineHarness.state.balance, "205.00");
  assert.deepEqual(
    [fineHarness.state.journals[0].debit, fineHarness.state.journals[0].credit],
    ["205.00", "205.00"],
  );
});

test("amount validation rejects zero, negatives, numeric JSON values, and ambiguous input", () => {
  for (const amount of ["0", "-1", "1e2", 1.25, null]) {
    assert.throws(() => parseReceivableCollectionAmounts({ amount }), {
      code: "INVALID_DECIMAL_INPUT",
    });
  }
});

test("maximum supported NPR amount remains exact and database overflow is rejected", () => {
  const maximum = parseReceivableCollectionAmounts({
    amount: "999999999999999999.99",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
  });
  assert.equal(maximum.collectedAmount.toFixed(2), "999999999999999999.99");
  assert.throws(() => parseReceivableCollectionAmounts({
    amount: "1000000000000000000.00",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
  }), { code: "DECIMAL_OUT_OF_RANGE" });
});

test("collection cannot exceed the outstanding balance", async () => {
  const receivable = {
    id: "ar-over",
    payerName: "Customer",
    category: "CUSTOMER_RECEIVABLE",
    totalAmount: "1.00",
    receivedAmount: "0.00",
    remainingBalance: "1.00",
    status: "UNPAID",
  };
  const harness = createCollectionHarness(receivable);

  await assert.rejects(collect(harness, receivable, {
    amount: "1.01",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
    idempotencyKey: "COLLECT-OVER",
  }), { code: "RECEIVABLE_AMOUNT_EXCEEDS_BALANCE" });
  assert.equal(harness.state.transactions.length, 0);
  assert.equal(harness.state.journals.length, 0);
});

test("same-key retries compare persisted collection details and reject changed payloads", async () => {
  const amounts = parseReceivableCollectionAmounts({
    amount: "10.00",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
  });
  const transaction = {
    idempotencyKey: "COLLECT-REPLAY",
    amount: "10.00",
    type: "INFLOW",
    referenceId: "ar-replay",
    toAccountId: "bank-1",
  };
  const history = [{
    idempotencyKey: "COLLECT-REPLAY",
    amount: "10.00",
    settlementAmount: "10.00",
    adjustmentAmount: "0.00",
    requestedAmount: "10",
    requestedAdjustmentAmount: "0",
    adjustmentType: "NONE",
    toAccountId: "bank-1",
    notes: "Receivable collection",
  }];
  const shared = {
    existingTransaction: transaction,
    collectionHistory: history,
    receivableId: "ar-replay",
    amounts,
    toAccountId: "bank-1",
  };

  assert.equal(classifyReceivableCollectionReplay(shared), "REPLAY");
  assert.equal(classifyReceivableCollectionReplay({
    ...shared,
    amounts: parseReceivableCollectionAmounts({
      amount: "9.99",
      adjustmentAmount: "0",
      adjustmentType: "NONE",
    }),
  }), "CONFLICT");
  assert.equal(classifyReceivableCollectionReplay({
    ...shared,
    collectionHistory: [{ ...history[0], requestedAmount: "10.004" }],
    amounts: parseReceivableCollectionAmounts({
      amount: "10.005",
      adjustmentAmount: "0",
      adjustmentType: "NONE",
    }),
  }), "CONFLICT");
});

test("first direct-manufacturer collection creates its receivable source with a balanced journal input", async () => {
  const harness = createCollectionHarness(null);
  const amounts = parseReceivableCollectionAmounts({
    amount: "12.34",
    adjustmentAmount: "0",
    adjustmentType: "NONE",
  });
  const outcome = await applyReceivableCollection({
    client: harness.client,
    receivable: null,
    createReceivable: {
      id: "AR-MFG-DIRECT-mfg-1",
      title: "Direct Sales Margin - Manufacturer One",
      payerName: "Manufacturer One",
      category: "CUSTOMER_RECEIVABLE",
      referenceType: "MANUFACTURER_DIRECT",
      referenceId: "mfg-1",
      status: "UNPAID",
      collectionHistory: [],
    },
    totalAmount: parseReceivableCollectionAmounts({
      amount: "20.00",
      adjustmentAmount: "0",
      adjustmentType: "NONE",
    }).collectedAmount,
    balance: "20.00",
    amounts,
    idempotencyKey: "DIRECT-COLLECTION-1",
    toAccountId: "bank-1",
    toAccountName: "Operating Bank",
    category: "SALES",
    referenceId: "mfg-1",
    partyName: "Manufacturer One",
    description: "Direct margin collection",
    postAccounting: harness.postAccounting,
    orderId: "mfg-1",
    customerName: "Manufacturer One",
    depositAccountType: "BANK",
  });

  assert.equal(outcome.remainingBalance, "7.66");
  assert.equal(harness.state.receivable.id, "AR-MFG-DIRECT-mfg-1");
  assert.equal(harness.state.receivable.referenceType, "MANUFACTURER_DIRECT");
  assert.equal(harness.state.receivable.receivedAmount, "12.34");
  assert.equal(harness.state.journals[0].debit, "12.34");
  assert.equal(harness.state.journals[0].credit, "12.34");
});
