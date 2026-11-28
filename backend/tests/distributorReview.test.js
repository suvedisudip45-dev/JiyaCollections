import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../config/db.js";
import { submitDistributorReview } from "../controllers/distributorReviewController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("customer can review their delivered distributor order and rating aggregate is synchronized", async (t) => {
  const order = {
    id: "order-1",
    status: "Order Placed",
    fulfillmentStatus: "delivered",
    distributorId: null,
    deliveryOrder: { state: "DELIVERED" },
  };
  let savedReviewData;
  let distributorRatingData;
  stubMethod(t, prisma.order, "findFirst", async ({ where }) => {
    assert.deepEqual(where, { id: "order-1", userId: "customer-1" });
    return order;
  });
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => ({
    distributorId: "distributor-1",
    status: "DELIVERED",
  }));
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    distributorReview: {
      upsert: async ({ where, create, update }) => {
        assert.deepEqual(where, { orderId: "order-1" });
        savedReviewData = { create, update };
        return { id: "review-1", orderId: "order-1", distributorId: create.distributorId, rating: create.rating, comment: create.comment };
      },
      aggregate: async () => ({ _avg: { rating: 4.5 }, _count: { _all: 2 } }),
    },
    distributor: {
      update: async ({ data }) => {
        distributorRatingData = data;
        return data;
      },
    },
  }));

  const response = createResponse();
  await submitDistributorReview({
    params: { orderId: "order-1" },
    auth: { userId: "customer-1" },
    body: { rating: 5, comment: "<b>Great delivery</b>" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(savedReviewData.create, {
    orderId: "order-1",
    userId: "customer-1",
    distributorId: "distributor-1",
    rating: 5,
    comment: "Great delivery",
  });
  assert.deepEqual(savedReviewData.update, { rating: 5, comment: "Great delivery" });
  assert.deepEqual(distributorRatingData, { qualityRating: 4.5, ratingCount: 2 });
});

test("customer cannot review a distributor order before delivery", async (t) => {
  stubMethod(t, prisma.order, "findFirst", async () => ({
    id: "order-2",
    status: "In Transit",
    fulfillmentStatus: "in_transit",
    distributorId: "distributor-1",
    deliveryOrder: { state: "IN_TRANSIT" },
  }));
  stubMethod(t, prisma.orderAssignment, "findUnique", async () => ({
    distributorId: "distributor-1",
    status: "IN_TRANSIT",
  }));
  stubMethod(t, prisma, "$transaction", async () => {
    assert.fail("Review write must not run before delivery.");
  });

  const response = createResponse();
  await submitDistributorReview({
    params: { orderId: "order-2" },
    auth: { userId: "customer-1" },
    body: { rating: 5, comment: "" },
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /after your order is delivered/);
});

test("distributor review validates one-to-five star ratings", async (t) => {
  stubMethod(t, prisma.order, "findFirst", async () => {
    assert.fail("Invalid rating must be rejected before loading the order.");
  });

  const response = createResponse();
  await submitDistributorReview({
    params: { orderId: "order-3" },
    auth: { userId: "customer-1" },
    body: { rating: 6, comment: "" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /between 1 and 5 stars/);
});
