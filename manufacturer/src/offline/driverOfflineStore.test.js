import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  DRIVER_OFFLINE_DB_NAME,
  DRIVER_OFFLINE_DB_VERSION,
  clearDriverOfflineData,
  createDriverOfflineScope,
  draftFormForEditing,
  getCachedDriverProfile,
  getCachedAssignedManifests,
  getDriverDraft,
  getDriverDrafts,
  getDriverOfflineTokenRole,
  saveCachedDriverProfile,
  saveAssignedManifestSnapshots,
  saveDriverDraft,
} from "./driverOfflineStore.js";

const makeToken = (accountId) => {
  const claims = Buffer.from(JSON.stringify({ accountId, role: "DRIVER" })).toString("base64url");
  return `header.${claims}.signature`;
};
const makeScope = (accountId, driverId = "driver-1", distributorId = "distributor-1") =>
  createDriverOfflineScope(makeToken(accountId), { id: driverId, distributorId });

test("driver offline database opens its versioned stores without caching authentication tokens", async () => {
  const scope = makeScope("account-schema");
  assert.equal(scope.accountId, "account-schema");
  assert.equal(scope.driverId, "driver-1");
  assert.equal(scope.distributorId, "distributor-1");
  assert.equal(JSON.stringify(scope).includes(makeToken("account-schema")), false);
  assert.deepEqual(await getCachedAssignedManifests(scope), []);

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DRIVER_OFFLINE_DB_NAME, DRIVER_OFFLINE_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual([...database.objectStoreNames].sort(), ["drafts", "manifests", "metadata"]);
  database.close();
});

test("assigned manifest cache is scoped and omits unnecessary COD amount and arbitrary fields", async () => {
  const scope = makeScope("account-manifest");
  const manifest = {
    id: "manifest-1",
    manifestCode: "R-001",
    name: "Assigned route",
    status: "IN_TRANSIT",
    stops: [{
      id: "stop-1",
      stopSequence: 1,
      status: "PENDING",
      parcelCount: 2,
      address: { street: "Saved address", city: "Kathmandu", customerSecret: "remove-me" },
      order: {
        orderReference: "ORD-001",
        codPaymentRequired: true,
        codAmountDue: 2450,
        items: [{ name: "Shirt", sku: "SKU-1", size: "M", quantity: 2, cost: 900 }],
      },
      internalSecret: "remove-me",
    }],
  };
  await saveAssignedManifestSnapshots(scope, [manifest]);
  const cached = await getCachedAssignedManifests(scope);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].stops[0].order.codPaymentRequired, true);
  assert.equal(Object.hasOwn(cached[0].stops[0].order, "codAmountDue"), false);
  assert.equal(Object.hasOwn(cached[0].stops[0], "internalSecret"), false);
  assert.equal(Object.hasOwn(cached[0].stops[0].address, "customerSecret"), false);
  assert.equal(Object.hasOwn(cached[0].stops[0].order.items[0], "cost"), false);
  assert.deepEqual(await getCachedAssignedManifests(makeScope("other-account")), []);
});

test("cached driver profile is account-scoped and stores only an offline identity projection", async () => {
  const token = makeToken("account-profile");
  assert.equal(getDriverOfflineTokenRole(token), "DRIVER");
  await saveCachedDriverProfile(token, {
    id: "driver-profile-1",
    distributorId: "distributor-profile-1",
    name: "Driver",
    status: "ACTIVE",
    phone: "private-phone",
    licenseNumber: "private-license",
  });
  const cached = await getCachedDriverProfile(token);
  assert.equal(cached.id, "driver-profile-1");
  assert.equal(cached.distributorId, "distributor-profile-1");
  assert.equal(Object.hasOwn(cached, "phone"), false);
  assert.equal(Object.hasOwn(cached, "licenseNumber"), false);
  assert.equal(await getCachedDriverProfile(makeToken("another-account")), null);
});

test("stop drafts persist across module reload, keep evidence as blobs, omit OTP, and prevent duplicate stop records", async () => {
  const scope = makeScope("account-draft");
  const photo = new Blob(["photo-evidence"], { type: "image/png" });
  const signatureData = "data:image/png;base64,c2lnbmF0dXJl";
  const initial = await saveDriverDraft(scope, {
    manifestId: "manifest-2",
    stopId: "stop-2",
    status: "QUEUED",
    idempotencyKey: "stable-delivery-id",
    codPaymentRequired: false,
    parcelCount: 3,
    form: {
      outcome: "PARTIAL",
      recipientName: "Recipient",
      notes: "Leave at desk",
      partialQuantity: "1",
      failedReason: "",
      paymentMethod: "CASH",
      collectionConfirmed: false,
      otpCode: "123456",
      photo: new File([photo], "pod.png", { type: "image/png", lastModified: 1 }),
      signatureData,
    },
  });
  await saveDriverDraft(scope, {
    manifestId: "manifest-2",
    stopId: "stop-2",
    status: "QUEUED",
    idempotencyKey: "different-id-must-not-replace",
    form: { ...initial.formSnapshot, otpCode: "654321" },
  });

  const reloadedStore = await import(`./driverOfflineStore.js?reload=${Date.now()}`);
  const drafts = await reloadedStore.getDriverDrafts(scope);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].idempotencyKey, "stable-delivery-id");
  assert.equal(drafts[0].photoBlob.type, "image/png");
  assert.equal(await drafts[0].photoBlob.text(), "photo-evidence");
  assert.equal(drafts[0].signatureBlob.type, "image/png");
  assert.equal(JSON.stringify(drafts[0]).includes("123456"), false);
  assert.equal(JSON.stringify(drafts[0]).includes("654321"), false);
  const restored = await draftFormForEditing(drafts[0]);
  assert.equal(restored.otpCode, "");
  assert.equal(restored.collectionConfirmed, false);
  assert.equal(restored.photo.name, "pod.png");
  assert.equal(restored.signatureData, signatureData);
  assert.equal((await getDriverDraft(scope, "manifest-2", "stop-2")).idempotencyKey, "stable-delivery-id");
});

test("manifest reassignment invalidates cached route and preserves the local draft as a conflict", async () => {
  const scope = makeScope("account-reassigned");
  await saveAssignedManifestSnapshots(scope, [{
    id: "manifest-3",
    status: "IN_TRANSIT",
    stops: [{ id: "stop-3", status: "PENDING" }],
  }]);
  await saveDriverDraft(scope, {
    manifestId: "manifest-3",
    stopId: "stop-3",
    status: "QUEUED",
    form: { outcome: "DELIVERED", recipientName: "Recipient", notes: "", signatureData: "" },
  });
  await saveAssignedManifestSnapshots(scope, []);
  assert.deepEqual(await getCachedAssignedManifests(scope), []);
  const [draft] = await getDriverDrafts(scope);
  assert.equal(draft.status, "CONFLICT");
  assert.equal(draft.conflictCode, "MANIFEST_NOT_ASSIGNED");
});

test("clearing one driver's local data does not delete another account's records", async () => {
  const first = makeScope("account-clear-one");
  const second = makeScope("account-clear-two");
  await saveAssignedManifestSnapshots(first, [{ id: "manifest-one", status: "ASSIGNED", stops: [] }]);
  await saveAssignedManifestSnapshots(second, [{ id: "manifest-two", status: "ASSIGNED", stops: [] }]);
  await clearDriverOfflineData(first);
  assert.deepEqual(await getCachedAssignedManifests(first), []);
  assert.equal((await getCachedAssignedManifests(second))[0].id, "manifest-two");
});

test("IndexedDB quota failures are surfaced instead of silently dropping a draft", async () => {
  const scope = makeScope("account-quota");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DRIVER_OFFLINE_DB_NAME, DRIVER_OFFLINE_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const storePrototype = Object.getPrototypeOf(database.transaction("drafts").objectStore("drafts"));
  const originalPut = storePrototype.put;
  storePrototype.put = () => { throw new DOMException("quota exceeded", "QuotaExceededError"); };
  try {
    await assert.rejects(saveDriverDraft(scope, {
      manifestId: "manifest-quota",
      stopId: "stop-quota",
      form: { outcome: "FAILED", recipientName: "Recipient" },
    }), (error) => error.name === "QuotaExceededError");
  } finally {
    storePrototype.put = originalPut;
    database.close();
  }
});
