import test from "node:test";
import assert from "node:assert/strict";
import {
  createRequireLocationAccess,
  evaluateLocationAccess,
  evaluateMovementLocationAccess,
  createRequireManufacturerTransferSourceLocation,
  normalizeLocationIdentity,
} from "../middleware/locationScope.js";

const invoke = (middleware, req) => new Promise((resolve) => {
  const response = {
    status: (code) => ({
      json: (body) => resolve({ code, body }),
    }),
  };
  middleware(req, response, () => resolve({ code: 200 }));
});

test("location identity normalization rejects missing and malformed identities", () => {
  assert.equal(normalizeLocationIdentity("location-1"), "location-1");
  assert.equal(normalizeLocationIdentity(""), null);
  assert.equal(normalizeLocationIdentity("bad location"), null);
  assert.equal(normalizeLocationIdentity("../location"), null);
});

test("assigned distributor location access succeeds and cross-location access is denied", () => {
  const auth = { role: "DISTRIBUTOR", accountId: "account-1", distributorId: "distributor-1" };
  assert.equal(evaluateLocationAccess({
    auth,
    location: {
      id: "location-1",
      isActive: true,
      inventoryOwner: "PLATFORM",
      distributorId: "distributor-1",
    },
  }).allowed, true);
  assert.equal(evaluateLocationAccess({
    auth,
    location: {
      id: "location-2",
      isActive: true,
      inventoryOwner: "PLATFORM",
      distributorId: "distributor-2",
    },
  }).code, "LOCATION_ACCESS_DENIED");
});

test("assigned manufacturer location access succeeds and inactive locations fail closed", () => {
  const auth = { role: "MANUFACTURER", accountId: "account-2", manufacturerId: "manufacturer-1" };
  assert.equal(evaluateLocationAccess({
    auth,
    location: {
      id: "factory-1",
      isActive: true,
      inventoryOwner: "PLATFORM",
      manufacturerId: "manufacturer-1",
    },
  }).allowed, true);
  assert.equal(evaluateLocationAccess({
    auth,
    location: {
      id: "factory-1",
      isActive: false,
      inventoryOwner: "PLATFORM",
      manufacturerId: "manufacturer-1",
    },
  }).code, "LOCATION_INACTIVE");
});

test("Admin global access is explicit and non-Admin roles cannot bypass location scope", () => {
  const admin = { role: "ADMIN", accountId: "admin-1" };
  assert.equal(evaluateLocationAccess({
    auth: admin,
    location: { id: "location-1", isActive: true, inventoryOwner: "PLATFORM" },
  }).code, "LOCATION_SCOPE_REQUIRED");
  assert.equal(evaluateLocationAccess({
    auth: admin,
    location: { id: "location-1", isActive: true, inventoryOwner: "PLATFORM" },
    allowGlobalLocationAccess: true,
  }).allowed, true);
  assert.equal(evaluateLocationAccess({
    auth: { role: "CUSTOMER", accountId: "customer-1" },
    location: { id: "location-1", isActive: true, inventoryOwner: "PLATFORM" },
  }).code, "LOCATION_ACCESS_DENIED");
});

test("movement authorization requires source and destination permissions separately", () => {
  const auth = { role: "MANUFACTURER", accountId: "account-1", manufacturerId: "manufacturer-1" };
  const source = {
    id: "factory-1",
    isActive: true,
    inventoryOwner: "PLATFORM",
    manufacturerId: "manufacturer-1",
  };
  const destination = {
    id: "distributor-1",
    isActive: true,
    inventoryOwner: "PLATFORM",
    distributorId: "distributor-1",
  };
  assert.equal(evaluateMovementLocationAccess({
    auth,
    sourceLocation: source,
    destinationLocation: destination,
    sourcePermissionGranted: true,
    destinationPermissionGranted: false,
  }).code, "DESTINATION_PERMISSION_REQUIRED");
  assert.equal(evaluateMovementLocationAccess({
    auth,
    sourceLocation: source,
    destinationLocation: destination,
    sourcePermissionGranted: false,
    destinationPermissionGranted: true,
  }).code, "SOURCE_PERMISSION_REQUIRED");
});

test("manufacturer transfer dispatch source scope is resolved from server transfer identity", async () => {
  const client = {
    stockTransfer: {
      findUnique: async ({ where }) => ({
        id: where.id,
        manufacturerId: "manufacturer-1",
        sourceLocationId: "factory-1",
      }),
    },
    inventoryLocation: {
      findUnique: async ({ where }) => ({
        id: where.id,
        kind: "FACTORY",
        inventoryOwner: "PLATFORM",
        manufacturerId: "manufacturer-1",
        distributorId: null,
        isActive: true,
      }),
    },
  };
  const middleware = createRequireManufacturerTransferSourceLocation({ client, auditRecorder: async () => {} });
  const req = {
    auth: { accountId: "account-1", role: "MANUFACTURER", manufacturerId: "manufacturer-1" },
    params: { id: "transfer-1" },
    body: { locationId: "client-owned-location" },
    method: "POST",
  };
  assert.equal((await invoke(middleware, req)).code, 200);
  assert.equal(req.sourceLocationScope.locationId, "factory-1");

  const denied = await invoke(middleware, {
    auth: { accountId: "account-2", role: "MANUFACTURER", manufacturerId: "manufacturer-2" },
    params: { id: "transfer-1" },
  });
  assert.equal(denied.code, 403);
  assert.equal(denied.body.code, "LOCATION_ACCESS_DENIED");
});

test("manufacturer transfer source middleware rejects missing, inactive, and cross-location sources", async () => {
  const missing = await invoke(createRequireManufacturerTransferSourceLocation({
    client: { stockTransfer: { findUnique: async () => null } },
  }), {
    auth: { accountId: "account-1", role: "MANUFACTURER", manufacturerId: "manufacturer-1" },
    params: { id: "transfer-1" },
  });
  assert.equal(missing.code, 404);
  assert.equal(missing.body.code, "TRANSFER_NOT_FOUND");

  const inactive = await invoke(createRequireManufacturerTransferSourceLocation({
    client: {
      stockTransfer: { findUnique: async () => ({
        id: "transfer-1",
        manufacturerId: "manufacturer-1",
        sourceLocationId: "factory-1",
      }) },
      inventoryLocation: { findUnique: async () => ({
        id: "factory-1",
        kind: "FACTORY",
        inventoryOwner: "PLATFORM",
        manufacturerId: "manufacturer-1",
        distributorId: null,
        isActive: false,
      }) },
    },
  }), {
    auth: { accountId: "account-1", role: "MANUFACTURER", manufacturerId: "manufacturer-1" },
    params: { id: "transfer-1" },
  });
  assert.equal(inactive.code, 403);
  assert.equal(inactive.body.code, "LOCATION_INACTIVE");
});

test("location middleware resolves server-side location and ignores client-supplied location IDs", async () => {
  let resolverCalls = 0;
  const middleware = createRequireLocationAccess({
    resolveLocation: async (req) => {
      resolverCalls += 1;
      return {
        id: "server-location-1",
        kind: "DISTRIBUTOR",
        inventoryOwner: "PLATFORM",
        distributorId: "distributor-1",
        isActive: true,
      };
    },
  });
  const req = {
    auth: { accountId: "account-1", role: "DISTRIBUTOR", distributorId: "distributor-1" },
    body: { locationId: "location-from-client" },
    method: "POST",
    originalUrl: "/api/distributor/inventory/decrease",
  };
  const allowed = await invoke(middleware, req);
  assert.equal(allowed.code, 200);
  assert.equal(resolverCalls, 1);
  assert.equal(req.locationScope.locationId, "server-location-1");

  const crossLocationRequest = {
    auth: { accountId: "account-2", role: "DISTRIBUTOR", distributorId: "distributor-2" },
    body: { locationId: "server-location-1" },
    method: "POST",
    originalUrl: "/api/distributor/inventory/decrease",
  };
  const denied = await invoke(middleware, crossLocationRequest);
  assert.equal(denied.code, 403);
  assert.equal(denied.body.code, "LOCATION_ACCESS_DENIED");
});

test("location middleware fails closed for missing, inactive, and non-platform locations", async () => {
  const missing = await invoke(createRequireLocationAccess({
    resolveLocation: async () => null,
  }), {
    auth: { accountId: "account-1", role: "DISTRIBUTOR", distributorId: "distributor-1" },
  });
  assert.equal(missing.code, 404);
  assert.equal(missing.body.code, "LOCATION_NOT_FOUND");

  const inactive = await invoke(createRequireLocationAccess({
    resolveLocation: async () => ({
      id: "location-1",
      kind: "DISTRIBUTOR",
      inventoryOwner: "PLATFORM",
      distributorId: "distributor-1",
      isActive: false,
    }),
  }), {
    auth: { accountId: "account-1", role: "DISTRIBUTOR", distributorId: "distributor-1" },
  });
  assert.equal(inactive.code, 403);
  assert.equal(inactive.body.code, "LOCATION_INACTIVE");

  const nonPlatform = await invoke(createRequireLocationAccess({
    resolveLocation: async () => ({
      id: "location-1",
      kind: "DISTRIBUTOR",
      inventoryOwner: "DISTRIBUTOR",
      distributorId: "distributor-1",
      isActive: true,
    }),
  }), {
    auth: { accountId: "account-1", role: "DISTRIBUTOR", distributorId: "distributor-1" },
  });
  assert.equal(nonPlatform.code, 403);
  assert.equal(nonPlatform.body.code, "LOCATION_OWNER_UNSUPPORTED");
});
