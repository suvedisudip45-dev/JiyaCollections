import test from "node:test";
import assert from "node:assert/strict";
import {
  bookDistributorNcmOrders,
  canReapplyNcmSubmission,
  distributorNcmDeliveryWhere,
  holdDistributorOrderForDelivery,
  normalizeDistributorNcmStatusFilter,
} from "../services/distributorNcmService.js";

const makeHoldClient = ({
  assignmentStatus = "package_details_complete",
  deliveryType = "SELF_DELIVERY",
  notes = JSON.stringify({ packageWeight: 1 }),
  district = "Kaski",
  customerCity = "",
  customerProvince = "Gandaki Province",
  distributorCity = "Pokhara",
  distributorProvince = "Gandaki Province",
  hasDelivery = false,
  latestAttempt = null,
} = {}) => {
  const calls = [];
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "distributor-1",
    status: assignmentStatus,
    deliveryType,
    notes,
  };
  const client = {
    orderAssignment: {
      findFirst: async () => assignment,
      updateMany: async (query) => {
        calls.push({ type: "assignment.updateMany", query });
        return { count: 1 };
      },
    },
    order: {
      findUnique: async () => ({
        id: "order-1",
        status: "Confirmed",
        address: { district, city: customerCity, province: customerProvince },
      }),
      update: async (query) => {
        calls.push({ type: "order.update", query });
        return query.data;
      },
    },
    distributor: {
      findUnique: async () => ({
        city: distributorCity,
        province: distributorProvince,
        district: "Kaski",
        locations: [],
      }),
    },
    deliveryOrder: {
      findUnique: async () => hasDelivery
        ? { id: "delivery-1", state: "SUBMISSION_FAILED", ncmOrderId: null }
        : null,
    },
    ncmRequestAttempt: {
      findFirst: async () => latestAttempt,
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        calls.push({ type: "audit.create", data });
        return { id: "audit-1" };
      },
    },
    $transaction: async (callback) => callback(client),
  };
  return { client, calls };
};

test("holding a packed distributor order stores selected delivery and on-hold status", async () => {
  const { client, calls } = makeHoldClient();
  const result = await holdDistributorOrderForDelivery({
    distributorId: "distributor-1",
    assignmentId: "assignment-1",
    deliveryType: "SELF_DELIVERY",
    client,
  });

  assert.equal(result.status, "on_hold");
  const assignmentUpdate = calls.find((call) => call.type === "assignment.updateMany");
  assert.equal(assignmentUpdate.query.data.status, "on_hold");
  assert.equal(assignmentUpdate.query.data.deliveryType, "SELF_DELIVERY");
  assert.equal(JSON.parse(assignmentUpdate.query.data.notes).deliveryOnHold, true);
  assert.equal(calls.find((call) => call.type === "order.update").query.data.fulfillmentStatus, "on_hold");
  assert.equal(calls.find((call) => call.type === "audit.create").data.event.action, "DISTRIBUTOR_ORDER_HELD_FOR_DELIVERY");
});

test("holding a self-delivery order rejects a customer outside the distributor district", async () => {
  const { client } = makeHoldClient({ district: "Dharan", customerCity: "Dharan" });
  await assert.rejects(
    holdDistributorOrderForDelivery({
      distributorId: "distributor-1",
      assignmentId: "assignment-1",
      deliveryType: "SELF_DELIVERY",
      client,
    }),
    { code: "SELF_DELIVERY_DISTRICT_MISMATCH", statusCode: 409 },
  );
});

test("holding a self-delivery order accepts the same city when the district fields differ", async () => {
  const { client, calls } = makeHoldClient({
    district: "Bhaktapur",
    customerCity: "Kathmandu",
    distributorCity: "kathmandu",
  });
  const result = await holdDistributorOrderForDelivery({
    distributorId: "distributor-1",
    assignmentId: "assignment-1",
    deliveryType: "SELF_DELIVERY",
    client,
  });
  assert.equal(result.status, "on_hold");
  assert.equal(calls.find((call) => call.type === "assignment.updateMany").query.data.deliveryType, "SELF_DELIVERY");
});

test("holding a self-delivery order rejects a same-city match across provinces", async () => {
  const { client } = makeHoldClient({
    district: "Sunsari",
    customerCity: "Pokhara",
    customerProvince: "Koshi Province",
    distributorCity: "Pokhara",
    distributorProvince: "Gandaki Province",
  });
  await assert.rejects(
    holdDistributorOrderForDelivery({
      distributorId: "distributor-1",
      assignmentId: "assignment-1",
      deliveryType: "SELF_DELIVERY",
      client,
    }),
    { code: "SELF_DELIVERY_DISTRICT_MISMATCH", statusCode: 409 },
  );
});

test("bulk NCM booking only accepts orders explicitly held for NCM", async () => {
  const { client } = makeHoldClient({
    assignmentStatus: "package_details_complete",
    deliveryType: "NCM",
  });
  const result = await bookDistributorNcmOrders({
    distributorId: "distributor-1",
    assignmentIds: ["assignment-1"],
    client,
  });
  assert.equal(result.success, false);
  assert.equal(result.results[0].code, "NCM_ORDER_NOT_ON_HOLD");
});

test("NCM reapplication is available for failed submissions without admin review", () => {
  const failedDelivery = { state: "SUBMISSION_FAILED", ncmOrderId: null };
  assert.equal(canReapplyNcmSubmission(failedDelivery), true);
  assert.equal(canReapplyNcmSubmission({ ...failedDelivery, ncmOrderId: 123 }), false);
  assert.equal(canReapplyNcmSubmission({ ...failedDelivery, state: "NCM_CREATED" }), false);
});

test("failed NCM booking with unknown handoff is not rejected for requiring admin review", async () => {
  const { client } = makeHoldClient({
    assignmentStatus: "package_details_complete",
    deliveryType: "NCM",
    hasDelivery: true,
    latestAttempt: { result: "UNKNOWN" },
  });
  const result = await bookDistributorNcmOrders({
    distributorId: "distributor-1",
    assignmentIds: ["assignment-1"],
    client,
  });
  assert.equal(result.success, false);
  assert.notEqual(result.results[0].code, "NCM_ORDER_NOT_ON_HOLD");
});

test("NCM carrier status filter options map to the normalized persisted states", () => {
  assert.deepEqual(normalizeDistributorNcmStatusFilter("Sent for Pickup"), ["Pickup Order Created"]);
  assert.deepEqual(normalizeDistributorNcmStatusFilter("Drop off Order Created"), ["Pickup Order Created"]);
  assert.deepEqual(normalizeDistributorNcmStatusFilter("In Transit"), ["Dispatched"]);
  assert.deepEqual(normalizeDistributorNcmStatusFilter("Out for Delivery"), ["Sent for Delivery"]);
  assert.equal(normalizeDistributorNcmStatusFilter("Unknown"), null);
});

test("NCM delivery views separate failed, active booked, and delivered orders", () => {
  assert.deepEqual(distributorNcmDeliveryWhere("FAILED"), {
    state: "SUBMISSION_FAILED",
    ncmOrderId: null,
  });
  assert.deepEqual(distributorNcmDeliveryWhere("BOOKED"), {
    state: { not: "DELIVERED" },
    ncmOrderId: { not: null },
  });
  assert.deepEqual(distributorNcmDeliveryWhere("DELIVERED"), {
    state: "DELIVERED",
    ncmOrderId: { not: null },
  });
});
