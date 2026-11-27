import assert from "node:assert/strict";
import test from "node:test";
import { serializeSessionProfile } from "../dtos/authDto.js";
import { requireAssignedDriverStop } from "../middleware/driverLogisticsAuthorization.js";
import { setDeliveryDriverContext } from "../middleware/unifiedAuth.js";
import {
  getActiveWorkspaceRoles,
  isWorkspaceProfileActive,
  resolveTargetPortal,
} from "../services/authService.js";
import { requiresMfa } from "../security/mfaPolicy.js";
import {
  listDriverAssignedManifests as loadDriverManifests,
  completeRouteStop,
  syncOfflineDeliveryDraft,
} from "../services/distributorLogisticsService.js";
import {
  buildDriverMapUrl,
  buildPodCompletionPayload,
  buildPodSubmissionFingerprint,
  getDriverManifestProgress,
  getPodIdempotencyKey,
  isPodSubmissionOutcomeUncertain,
  validatePodForm,
} from "../../manufacturer/src/utils/distributorLogisticsValidation.js";

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

test("driver portal is exclusive and serializes only its restricted profile fields", () => {
  const account = {
    id: "account-1",
    email: "driver@example.com",
    role: "CUSTOMER",
    roleMappings: [
      { isActive: true, role: { code: "DRIVER", isActive: true } },
      { isActive: true, role: { code: "DISTRIBUTOR", isActive: true } },
    ],
    deliveryDriverProfile: {
      id: "driver-1",
      distributorId: "dist-1",
      name: "Driver",
      phone: "9800000000",
      status: "ACTIVE",
      vehicleType: "Van",
      vehicleRegistration: "ABC-123",
      licenseNumber: "private-license",
      distributor: { id: "dist-1", name: "Distributor", status: "ACTIVE", isActive: true },
    },
    distributorProfile: { id: "dist-1", status: "ACTIVE" },
  };
  assert.equal(resolveTargetPortal("driver"), "DRIVER");
  assert.equal(requiresMfa("DRIVER"), true);
  assert.equal(isWorkspaceProfileActive(account, "DRIVER"), true);
  assert.deepEqual(getActiveWorkspaceRoles(account), ["DRIVER"]);
  const response = serializeSessionProfile(account, "DRIVER");
  assert.equal(response.driver.id, "driver-1");
  assert.equal(response.driver.distributorId, "dist-1");
  assert.equal(JSON.stringify(response).includes("private-license"), false);
  assert.equal(Object.hasOwn(response, "distributor"), false);
  assert.equal(isWorkspaceProfileActive({
    ...account,
    deliveryDriverProfile: { ...account.deliveryDriverProfile, status: "SUSPENDED" },
  }, "DRIVER"), false);
});

test("driver context overwrites user-controlled distributor context from linked profile", () => {
  const req = {
    auth: {
      accountId: "account-1",
      role: "DRIVER",
      driverId: "driver-1",
      driver: { id: "driver-1", distributorId: "authorized-dist" },
    },
    body: { distributorId: "attacker-dist", distributorIdOverride: "attacker-dist" },
  };
  const res = makeResponse();
  let continued = false;
  setDeliveryDriverContext(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(req.distributorId, "authorized-dist");
  assert.equal(req.body.distributorId, "authorized-dist");
  assert.equal(Object.hasOwn(req.body, "distributorIdOverride"), false);
});

test("driver stop guard requires the exact assigned manifest and self-delivery order", async () => {
  let stopQuery;
  let assignmentQuery;
  const client = {
    deliveryManifestStop: {
      findFirst: async (query) => {
        stopQuery = query;
        return { id: "stop-1", orderId: "order-1", assignmentId: "assignment-1" };
      },
    },
    orderAssignment: {
      findFirst: async (query) => {
        assignmentQuery = query;
        return { id: "assignment-1" };
      },
    },
  };
  const req = {
    auth: { driverId: "driver-1" },
    distributorId: "dist-1",
    params: { manifestId: "manifest-1", stopId: "stop-1" },
  };
  const res = makeResponse();
  let continued = false;
  await requireAssignedDriverStop(client)(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(stopQuery.where.manifest.is.driverId, "driver-1");
  assert.equal(stopQuery.where.manifest.is.distributorId, "dist-1");
  assert.deepEqual(assignmentQuery.where, {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
  });
  assert.equal(req.params.id, "order-1");
});

test("driver stop guard rejects unassigned IDs without querying an assignment", async () => {
  let assignmentLookup = false;
  const client = {
    deliveryManifestStop: { findFirst: async () => null },
    orderAssignment: { findFirst: async () => { assignmentLookup = true; return null; } },
  };
  const req = {
    auth: { driverId: "driver-1" },
    distributorId: "dist-1",
    params: { manifestId: "other-manifest", stopId: "other-stop" },
  };
  const res = makeResponse();
  await requireAssignedDriverStop(client)(req, res, () => assert.fail("Unassigned stop must not continue."));
  assert.equal(res.statusCode, 404);
  assert.equal(assignmentLookup, false);
});

test("driver offline sync persists a sanitized, purpose-bound draft and keeps OTP retryable", async () => {
  const drafts = new Map();
  const stop = {
    id: "stop-1",
    orderId: "order-1",
    assignmentId: "assignment-1",
    status: "PENDING",
    manifest: { id: "manifest-1", distributorId: "dist-1", driverId: "driver-1", status: "IN_TRANSIT" },
    proof: null,
  };
  let stopQuery;
  const tx = {
    deliveryManifestStop: {
      findFirst: async (query) => {
        stopQuery = query;
        return stop;
      },
    },
    orderAssignment: { findFirst: async () => ({ id: "assignment-1" }) },
    offlineDeliverySyncDraft: {
      findUnique: async ({ where }) => drafts.get(where.clientDraftId) || null,
      create: async ({ data }) => {
        const draft = { id: "draft-1", ...data };
        drafts.set(data.clientDraftId, draft);
        return draft;
      },
      update: async ({ where, data }) => {
        const draft = [...drafts.values()].find((item) => item.id === where.id);
        const updated = { ...draft, ...data };
        drafts.set(draft.clientDraftId, updated);
        return updated;
      },
    },
  };
  const client = {
    $transaction: async (callback) => callback(tx),
    offlineDeliverySyncDraft: {
      updateMany: async ({ where, data }) => {
        const draft = drafts.get(where.clientDraftId);
        if (draft && draft.status === where.status) {
          drafts.set(draft.clientDraftId, { ...draft, ...data });
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  const base = {
    distributorId: "dist-1",
    driverId: "driver-1",
    actorAccountId: "account-1",
    body: {
      clientDraftId: "client-draft-1",
      manifestId: "manifest-1",
      stopId: "stop-1",
      idempotencyKey: "client-draft-1",
      outcome: "DELIVERED",
      recipientName: "Recipient",
      notes: "",
      paymentMethod: "CASH",
      collectionConfirmed: true,
      otpCode: "123456",
      signatureData: "data:image/png;base64,c2lnbmF0dXJl",
      evidenceDigest: "evidence-hash",
    },
    photoPath: "private/photo-id",
    signaturePath: "private/signature-id",
    client,
  };
  let receivedCode = "";
  const otpError = Object.assign(new Error("The customer delivery code is invalid."), {
    statusCode: 400,
    code: "INVALID_DELIVERY_OTP",
  });
  await assert.rejects(syncOfflineDeliveryDraft({
    ...base,
    completeStop: async ({ body }) => {
      receivedCode = body.otpCode;
      throw otpError;
    },
  }), (error) => error.code === "INVALID_DELIVERY_OTP");
  assert.equal(receivedCode, "123456");
  assert.equal(stopQuery.where.manifest.is.driverId, "driver-1");
  assert.equal(stopQuery.where.manifest.is.distributorId, "dist-1");
  const pending = drafts.get("client-draft-1");
  assert.equal(pending.status, "PENDING");
  assert.equal(Object.hasOwn(pending.payloadSnapshot, "otpCode"), false);
  assert.equal(Object.hasOwn(pending.payloadSnapshot, "signatureData"), false);
  assert.equal(pending.payloadSnapshot.photoPath, "private/photo-id");
  assert.equal(pending.payloadSnapshot.signaturePath, "private/signature-id");

  const result = await syncOfflineDeliveryDraft({
    ...base,
    body: { ...base.body, otpCode: "654321" },
    completeStop: async ({ body }) => {
      assert.equal(body.otpCode, "654321");
      return { idempotencyKey: "client-draft-1", _replayed: false };
    },
  });
  assert.equal(result.status, "SYNCED");
  assert.equal(drafts.get("client-draft-1").status, "SYNCED");
});

test("driver offline COD retry can add the required collection confirmation to a pending draft", async () => {
  const drafts = new Map();
  const stop = {
    id: "stop-cod",
    orderId: "order-cod",
    assignmentId: "assignment-cod",
    status: "PENDING",
    manifest: { id: "manifest-cod", distributorId: "dist-cod", driverId: "driver-cod", status: "IN_TRANSIT" },
    proof: null,
  };
  const tx = {
    deliveryManifestStop: { findFirst: async () => stop },
    orderAssignment: { findFirst: async () => ({ id: "assignment-cod" }) },
    offlineDeliverySyncDraft: {
      findUnique: async ({ where }) => drafts.get(where.clientDraftId) || null,
      create: async ({ data }) => {
        const draft = { id: "draft-cod", ...data };
        drafts.set(data.clientDraftId, draft);
        return draft;
      },
      update: async ({ where, data }) => {
        const draft = [...drafts.values()].find((item) => item.id === where.id);
        const updated = { ...draft, ...data };
        drafts.set(draft.clientDraftId, updated);
        return updated;
      },
    },
  };
  const client = {
    $transaction: async (callback) => callback(tx),
    offlineDeliverySyncDraft: {
      updateMany: async ({ where, data }) => {
        const draft = drafts.get(where.clientDraftId);
        if (draft && draft.status === where.status) {
          drafts.set(draft.clientDraftId, { ...draft, ...data });
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  const base = {
    distributorId: "dist-cod",
    driverId: "driver-cod",
    actorAccountId: "account-cod",
    client,
    body: {
      clientDraftId: "client-draft-cod",
      manifestId: "manifest-cod",
      stopId: "stop-cod",
      outcome: "DELIVERED",
      recipientName: "Recipient",
      collectionConfirmed: false,
    },
  };
  await assert.rejects(syncOfflineDeliveryDraft({
    ...base,
    completeStop: async () => {
      throw Object.assign(new Error("Collection confirmation is required."), {
        statusCode: 400,
        code: "COD_COLLECTION_CONFIRMATION_REQUIRED",
      });
    },
  }), (error) => error.code === "COD_COLLECTION_CONFIRMATION_REQUIRED");
  assert.equal(drafts.get("client-draft-cod").status, "PENDING");

  const result = await syncOfflineDeliveryDraft({
    ...base,
    body: { ...base.body, collectionConfirmed: true },
    completeStop: async ({ body }) => {
      assert.equal(body.collectionConfirmed, true);
      return { idempotencyKey: "client-draft-cod", _replayed: false };
    },
  });
  assert.equal(result.status, "SYNCED");
  assert.equal(drafts.get("client-draft-cod").payloadSnapshot.collectionConfirmed, true);
});

test("driver offline sync cannot replay a draft after assignment authorization is lost", async () => {
  let completionCalls = 0;
  const client = {
    $transaction: async (callback) => callback({
      deliveryManifestStop: { findFirst: async () => null },
      orderAssignment: { findFirst: async () => null },
      offlineDeliverySyncDraft: {
        findUnique: async () => ({
          id: "existing-draft",
          manifestId: "manifest-1",
          stopId: "stop-1",
          operationHash: "matching-is-not-enough",
          status: "SYNCED",
        }),
      },
    }),
  };
  await assert.rejects(syncOfflineDeliveryDraft({
    distributorId: "dist-1",
    driverId: "driver-1",
    body: {
      clientDraftId: "client-draft-1",
      manifestId: "manifest-1",
      stopId: "stop-1",
      outcome: "DELIVERED",
      recipientName: "Recipient",
    },
    client,
    completeStop: async () => { completionCalls += 1; },
  }), (error) => error.code === "STOP_NOT_FOUND");
  assert.equal(completionCalls, 0);
});

test("driver manifests are scoped to active assignment, distributor, and self-delivery orders", async () => {
  let manifestQuery;
  let assignmentQuery;
  let orderQuery;
  const assignedManifest = {
    id: "manifest-1",
    manifestCode: "R-001",
    name: "Route",
    status: "IN_TRANSIT",
    stops: [
      { id: "stop-1", orderId: "order-1", assignmentId: "assignment-1", stopSequence: 1, status: "PENDING", parcelCount: 2, addressSnapshot: { city: "Kathmandu" }, proof: null },
      { id: "stop-2", orderId: "order-2", assignmentId: "assignment-2", stopSequence: 2, status: "PENDING", parcelCount: 1, addressSnapshot: { city: "Patan" }, proof: null },
    ],
  };
  const client = {
    deliveryRouteManifest: {
      findMany: async (query) => {
        manifestQuery = query;
        return query.where.status === "COMPLETED" ? [] : [assignedManifest];
      },
    },
    orderAssignment: {
      findMany: async (query) => {
        assignmentQuery = query;
        return [{ id: "assignment-1", orderId: "order-1" }];
      },
    },
    order: {
      findMany: async (query) => {
        orderQuery = query;
        return [{
          id: "order-1",
          orderReference: "ORD-001",
          items: [{ name: "Shirt", sku: "SKU-1", color: "Blue", size: "M", quantity: 2, price: 999 }],
          amount: 1000,
          deliveryFee: 50,
          paymentMethod: "COD",
          payment: false,
          address: { city: "Kathmandu" },
        }];
      },
    },
  };
  const manifests = await loadDriverManifests({
    driverId: "driver-1",
    distributorId: "dist-1",
    client,
  });
  assert.equal(manifestQuery.where.driverId, "driver-1");
  assert.equal(manifestQuery.where.distributorId, "dist-1");
  assert.equal(assignmentQuery.where.distributorId, "dist-1");
  assert.equal(assignmentQuery.where.deliveryType, "SELF_DELIVERY");
  assert.deepEqual(orderQuery.where.id.in, ["order-1"]);
  assert.equal(manifests[0].stops.length, 1);
  assert.equal(manifests[0].stops[0].order.orderId, "order-1");
  assert.equal(manifests[0].stops[0].order.codAmountDue, 1050);
  assert.equal(Object.hasOwn(manifests[0].stops[0].order.items[0], "price"), false);
});

test("navigation preserves saved address data and encodes it for maps", () => {
  const address = { street: "12/3 Main St", city: "Kathmandu", district: "Kathmandu" };
  const mapUrl = buildDriverMapUrl(address);
  assert.equal(mapUrl.startsWith("https://www.google.com/maps/search/?api=1&query="), true);
  assert.equal(decodeURIComponent(mapUrl.split("query=")[1]), "12/3 Main St, Kathmandu, Kathmandu");
  assert.equal(buildDriverMapUrl(null), "");
});

test("driver offline synchronization route requires driver permission and assigned-stop authorization", async () => {
  const routeSource = await (await import("node:fs/promises")).readFile(
    new URL("../routes/driverRoute.js", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /"\/manifests\/:manifestId\/stops\/:stopId\/offline-sync"[\s\S]*?authorize\("driver:delivery_complete"\)[\s\S]*?requireAssignedDriverStop\(undefined, \["IN_TRANSIT", "COMPLETED"\]\)[\s\S]*?secureEvidenceUpload\("photo"\)[\s\S]*?syncOfflineLogisticsDraft/);
});

test("driver POD validation covers successful, partial, failed, and COD cases", () => {
  assert.equal(validatePodForm({
    outcome: "DELIVERED", recipientName: "Receiver", parcelCount: 1,
    hasSignature: true, isUnpaidCod: false,
  }), null);
  assert.match(validatePodForm({
    outcome: "PARTIAL", recipientName: "Receiver", parcelCount: 3,
    partialQuantity: "3",
  }), /below the parcel count/);
  assert.match(validatePodForm({
    outcome: "FAILED", recipientName: "Receiver", parcelCount: 1,
  }), /reason is required/);
  assert.match(validatePodForm({
    outcome: "DELIVERED", recipientName: "Receiver", parcelCount: 1,
    hasPhoto: true, isUnpaidCod: true, otpRequired: true, otpCode: "",
  }), /6-digit/);
});

test("driver dashboard progress handles empty and mixed manifest states", () => {
  assert.deepEqual(getDriverManifestProgress(null), {
    total: 0, completed: 0, remaining: 0, failed: 0, partial: 0,
  });
  assert.deepEqual(getDriverManifestProgress({
    stops: [
      { status: "PENDING" },
      { status: "DELIVERED", proof: { outcome: "DELIVERED" } },
      { status: "FAILED", proof: { outcome: "FAILED" } },
      { status: "PARTIAL", proof: { outcome: "PARTIAL" } },
    ],
  }), {
    total: 4, completed: 3, remaining: 1, failed: 1, partial: 1,
  });
});

test("driver POD retries reuse an idempotency key only for an unchanged form", () => {
  const form = {
    outcome: "DELIVERED",
    recipientName: "  Receiver ",
    notes: "Left with recipient",
    partialQuantity: "",
    failedReason: "",
    otpCode: "123456",
    otpRequired: true,
    collectionConfirmed: false,
    paymentMethod: "CASH",
    photo: { name: "pod.jpg", size: 1024, lastModified: 1 },
    signatureData: "data:image/png;base64,signature",
  };
  const fingerprint = buildPodSubmissionFingerprint(form);
  let generated = 0;
  const createKey = () => `key-${++generated}`;
  const key = getPodIdempotencyKey(null, fingerprint, createKey);
  assert.equal(getPodIdempotencyKey({ fingerprint, key }, fingerprint, createKey), key);
  assert.equal(getPodIdempotencyKey(
    { fingerprint, key },
    buildPodSubmissionFingerprint({ ...form, notes: "Different note" }),
    createKey,
  ), "key-2");
  assert.equal(generated, 2);
});

test("driver completion payload keeps delivered, partial, failed, and COD fields on the canonical contract", () => {
  const common = {
    outcome: "DELIVERED",
    recipientName: "  Receiver ",
    notes: "  Leave at reception  ",
    signatureData: "signature",
    photo: { name: "pod.jpg" },
    otpCode: "123456",
    otpRequired: true,
    collectionConfirmed: false,
    paymentMethod: "CASH",
  };
  const otpPayload = buildPodCompletionPayload({
    form: common,
    idempotencyKey: "delivery-key",
    isUnpaidCod: true,
  });
  assert.equal(otpPayload.outcome, "DELIVERED");
  assert.equal(otpPayload.recipientName, "Receiver");
  assert.equal(otpPayload.notes, "Leave at reception");
  assert.equal(otpPayload.otpCode, "123456");
  assert.equal(otpPayload.idempotencyKey, "delivery-key");
  assert.equal(Object.hasOwn(otpPayload, "collectionConfirmed"), false);
  assert.equal(otpPayload.photo, common.photo);
  assert.equal(otpPayload.signatureData, "signature");

  const collectionPayload = buildPodCompletionPayload({
    form: { ...common, otpRequired: false, collectionConfirmed: true },
    idempotencyKey: "delivery-key",
    isUnpaidCod: true,
  });
  assert.equal(collectionPayload.collectionConfirmed, "true");
  assert.equal(Object.hasOwn(collectionPayload, "otpCode"), false);

  assert.equal(buildPodCompletionPayload({
    form: { ...common, outcome: "PARTIAL", partialQuantity: "2" },
    idempotencyKey: "partial-key",
    isUnpaidCod: true,
  }).partialQuantity, "2");
  assert.equal(buildPodCompletionPayload({
    form: { ...common, outcome: "FAILED", failedReason: "Recipient unavailable" },
    idempotencyKey: "failed-key",
    isUnpaidCod: false,
  }).failedReason, "Recipient unavailable");
});

test("driver POD distinguishes rejected responses from uncertain network outcomes", () => {
  assert.equal(isPodSubmissionOutcomeUncertain(new Error("Network unavailable")), true);
  assert.equal(isPodSubmissionOutcomeUncertain({ response: { status: 503 } }), true);
  assert.equal(isPodSubmissionOutcomeUncertain({ response: { status: 409 } }), false);
  assert.equal(isPodSubmissionOutcomeUncertain({ response: { status: 422 } }), false);
});

test("driver multipart COD confirmation is normalized before the canonical delivery workflow", async () => {
  const previousNotificationsEnabled = process.env.NOTIFICATIONS_ENABLED;
  const previousSmsEnabled = process.env.SMS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = "false";
  process.env.SMS_ENABLED = "false";
  const assignment = {
    id: "assignment-1",
    orderId: "order-1",
    distributorId: "dist-1",
    deliveryType: "SELF_DELIVERY",
    status: "on_the_way",
  };
  const client = {
    deliveryManifestStop: {
      findFirst: async () => ({
        id: "stop-1",
        manifestId: "manifest-1",
        parcelCount: 1,
        assignmentId: assignment.id,
        status: "IN_TRANSIT",
        proof: null,
      }),
    },
    orderAssignment: { findFirst: async () => assignment },
    deliveryOrder: { findUnique: async () => null },
    order: {
      findUnique: async () => ({
        id: assignment.orderId,
        paymentMethod: "COD",
        payment: false,
        items: "[]",
      }),
    },
    distributorCashEvent: { create: async () => ({}) },
    distributor: { findUnique: async () => null },
  };
  const complete = (collectionConfirmed) => completeRouteStop({
    distributorId: "dist-1",
    manifestId: "manifest-1",
    stopId: "stop-1",
    actorAccountId: "driver-account-1",
    body: {
      outcome: "DELIVERED",
      recipientName: "Recipient",
      collectionConfirmed,
    },
    photoPath: "private/photo",
    client,
    executeInTransaction: true,
  });

  try {
    await assert.rejects(complete("false"), (error) => error.code === "COD_COLLECTION_CONFIRMATION_REQUIRED");
    await assert.rejects(complete("true"), (error) => error.code === "DISTRIBUTOR_NOT_FOUND");
  } finally {
    if (previousNotificationsEnabled === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = previousNotificationsEnabled;
    if (previousSmsEnabled === undefined) delete process.env.SMS_ENABLED;
    else process.env.SMS_ENABLED = previousSmsEnabled;
  }
});
