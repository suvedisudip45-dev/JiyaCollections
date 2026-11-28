import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../config/db.js";
import {
  adminResolveNcmDeliveryReconciliation,
  getNcmSettlementFailureMessage,
} from "../controllers/deliveryController.js";

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const replaceMethods = (replacements) => {
  const originals = replacements.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of replacements) target[key] = value;
  return () => {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  };
};

test("NCM COD ticket errors expose provider field details without echoing bank data", () => {
  const message = getNcmSettlementFailureMessage({
    code: "NCM_HTTP_400",
    message: "NCM request failed with HTTP 400",
    response: {
      message: JSON.stringify({
        message: "You already have 1 open COD Transfer ticket. Please wait for it to be closed before creating a new one.",
      }),
    },
  }, {
    bankName: "Example Bank",
    bankAccountName: "John Doe",
    bankAccountNumber: "001234567",
  });

  assert.equal(
    message,
    "You already have 1 open COD Transfer ticket. Please wait for it to be closed before creating a new one.",
  );
  assert.doesNotMatch(message, /HTTP|400|John Doe|001234567|Example Bank/);
});

test("NCM provider field errors remain readable without exposing submitted bank values", () => {
  const message = getNcmSettlementFailureMessage({
    code: "NCM_HTTP_400",
    response: {
      bankAccountName: ["Account holder John Doe is not registered"],
      bankAccountNumber: ["Invalid account number 001234567"],
      internal_debug: "not returned",
    },
  }, {
    bankName: "Example Bank",
    bankAccountName: "John Doe",
    bankAccountNumber: "001234567",
  });

  assert.match(message, /bank Account Name: Account holder \[REDACTED\] is not registered/);
  assert.match(message, /bank Account Number: Invalid account number \[REDACTED\]/);
  assert.doesNotMatch(message, /HTTP|400|Example Bank|internal_debug/);
});

test("Admin reconciliation decisions require a useful investigation note", async () => {
  const response = makeResponse();
  await adminResolveNcmDeliveryReconciliation({
    params: { id: "delivery-1" },
    body: { decision: "CONFIRM_NOT_DELIVERED", note: "short" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "INVALID_NCM_RECONCILIATION_DECISION");
});

test("Admin not-delivered decision clears the queue and records the note in the same transaction", async () => {
  const delivery = {
    id: "delivery-1",
    orderId: "order-1",
    ncmOrderId: 123,
    state: "IN_TRANSIT",
    ncmStatus: "Pending review",
    ncmReconciliationRequired: true,
    deliveredAt: null,
  };
  let deliveryUpdate;
  let eventRecord;
  let findCount = 0;
  const tx = {
    deliveryOrder: {
      findUnique: async () => delivery,
      update: async ({ data }) => {
        deliveryUpdate = data;
        return { ...delivery, ...data };
      },
    },
    deliveryEvent: {
      create: async ({ data }) => {
        eventRecord = data;
        return { id: "event-1", ...data };
      },
    },
  };
  const restore = replaceMethods([
    [prisma.deliveryOrder, "findUnique", async () => {
      findCount += 1;
      return findCount === 1 ? delivery : { ...delivery, ...deliveryUpdate };
    }],
    [prisma, "$transaction", async (callback) => callback(tx)],
  ]);
  const response = makeResponse();

  try {
    await adminResolveNcmDeliveryReconciliation({
      params: { id: "delivery-1" },
      auth: { accountId: "admin-7" },
      body: {
        decision: "CONFIRM_NOT_DELIVERED",
        note: "Checked the NCM order history; no delivery scan is present.",
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(deliveryUpdate.ncmReconciliationRequired, false);
    assert.equal(deliveryUpdate.ncmReconciliationReason, null);
    assert.equal(eventRecord.eventType, "NCM_RECONCILIATION_CONFIRMED_NOT_DELIVERED");
    assert.equal(eventRecord.actorId, "admin-7");
    assert.equal(eventRecord.payloadJson.note, "Checked the NCM order history; no delivery scan is present.");
  } finally {
    restore();
  }
});
