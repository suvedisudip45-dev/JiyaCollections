import assert from "node:assert/strict";
import test from "node:test";
import { buildRoadRouteSuggestion } from "../services/roadRoutingService.js";
import {
  previewRouteManifestOptimization,
  reorderRouteManifest,
} from "../services/distributorLogisticsService.js";

const deterministicOrder = (stops) => [...stops].sort((left, right) =>
  String(left.addressSnapshot?.district || "").localeCompare(String(right.addressSnapshot?.district || "")),
);

const routeStops = [
  {
    id: "stop-a",
    priority: "NORMAL",
    addressSnapshot: { district: "Lalitpur", latitude: 27.66, longitude: 85.32 },
    recipientNameSnapshot: "Private Customer A",
    orderId: "private-order-a",
    codAmount: 1250,
    otp: "123456",
    signaturePath: "private-signature",
  },
  {
    id: "stop-b",
    priority: "HIGH",
    addressSnapshot: { district: "Kathmandu", latitude: 27.71, longitude: 85.32 },
    recipientNameSnapshot: "Private Customer B",
    orderId: "private-order-b",
    codAmount: 500,
    otp: "987654",
    signaturePath: "private-signature-b",
  },
];

test("no configured provider returns deterministic fallback with no route metrics", async () => {
  const proposal = await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
  });
  assert.equal(proposal.provenance, "DETERMINISTIC_FALLBACK");
  assert.equal(proposal.providerStatus, "UNAVAILABLE");
  assert.equal(proposal.fallbackReason, "PROVIDER_NOT_CONFIGURED");
  assert.deepEqual(proposal.orderedStopIds, ["stop-b", "stop-a"]);
  assert.deepEqual(proposal.unroutableStops, []);
  assert.equal("distanceMeters" in proposal, false);
  assert.equal("durationSeconds" in proposal, false);
});

test("provider receives only opaque waypoint IDs and valid coordinates", async () => {
  let sentPayload;
  const proposal = await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route(payload) {
        sentPayload = payload;
        return {
          orderedWaypointIds: payload.stops.map(({ waypointId }) => waypointId).reverse(),
          distanceMeters: 6300,
          durationSeconds: 900,
          traffic: "unverified",
          eta: "unverified",
          apiKey: "provider-secret",
        };
      },
    },
  });

  assert.deepEqual(sentPayload.stops.map(({ latitude, longitude }) => ({ latitude, longitude })), [
    { latitude: 27.66, longitude: 85.32 },
    { latitude: 27.71, longitude: 85.32 },
  ]);
  assert.ok(sentPayload.stops.every(({ waypointId }) => /^[0-9a-f-]{36}$/i.test(waypointId)));
  const payloadText = JSON.stringify(sentPayload);
  for (const privateValue of ["stop-a", "private-order", "Private Customer", "1250", "123456", "signature"]) {
    assert.equal(payloadText.includes(privateValue), false);
  }
  assert.equal(proposal.provenance, "ROAD_ROUTING_PROVIDER");
  assert.deepEqual(proposal.orderedStopIds, ["stop-b", "stop-a"]);
  assert.equal(proposal.distanceMeters, 6300);
  assert.equal(proposal.durationSeconds, 900);
  assert.equal("traffic" in proposal, false);
  assert.equal("eta" in proposal, false);
  assert.equal(JSON.stringify(proposal).includes("provider-secret"), false);
});

test("missing and invalid coordinates are not sent to provider and remain in the proposal", async () => {
  const stops = [
    ...routeStops,
    { id: "stop-missing", addressSnapshot: { district: "Bhaktapur" } },
    { id: "stop-invalid", addressSnapshot: { latitude: 91, longitude: 85 } },
    { id: "stop-boolean", addressSnapshot: { latitude: true, longitude: 85 } },
  ];
  let sentPayload;
  const proposal = await buildRoadRouteSuggestion({
    stops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route(payload) {
        sentPayload = payload;
        return { orderedWaypointIds: payload.stops.map(({ waypointId }) => waypointId) };
      },
    },
  });

  assert.equal(sentPayload.stops.length, 2);
  assert.deepEqual(proposal.unroutableStops, [
    { stopId: "stop-missing", reason: "COORDINATES_MISSING" },
    { stopId: "stop-invalid", reason: "COORDINATES_INVALID" },
    { stopId: "stop-boolean", reason: "COORDINATES_INVALID" },
  ]);
  assert.deepEqual(proposal.orderedStopIds.slice(-3), ["stop-missing", "stop-invalid", "stop-boolean"]);
  assert.equal("distanceMeters" in proposal, false);
  assert.equal("durationSeconds" in proposal, false);
});

test("coordinates on geographic boundaries are accepted and passed unchanged", async () => {
  let sentPayload;
  await buildRoadRouteSuggestion({
    stops: [
      { id: "southwest", addressSnapshot: { latitude: -90, longitude: -180 } },
      { id: "northeast", addressSnapshot: { latitude: 90, longitude: 180 } },
    ],
    fallbackOrder: (stops) => stops,
    provider: {
      async route(payload) {
        sentPayload = payload;
        return { orderedWaypointIds: payload.stops.map(({ waypointId }) => waypointId) };
      },
    },
  });
  assert.deepEqual(sentPayload.stops.map(({ latitude, longitude }) => ({ latitude, longitude })), [
    { latitude: -90, longitude: -180 },
    { latitude: 90, longitude: 180 },
  ]);
});

test("provider timeout, rate limits, and server failures use bounded retries and safe fallback", async (t) => {
  const cases = [
    {
      name: "timeout",
      failure: () => new Promise(() => {}),
      reason: "PROVIDER_TIMEOUT",
    },
    {
      name: "rate limit",
      failure: () => Promise.reject(Object.assign(new Error("secret response"), { status: 429, apiKey: "secret-credential" })),
      reason: "PROVIDER_RATE_LIMITED",
    },
    {
      name: "server error",
      failure: () => Promise.reject(Object.assign(new Error("secret response"), { status: 503, apiKey: "secret-credential" })),
      reason: "PROVIDER_SERVER_ERROR",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      let calls = 0;
      const proposal = await buildRoadRouteSuggestion({
        stops: routeStops,
        fallbackOrder: deterministicOrder,
        timeoutMs: 5,
        maxRetries: 1,
        provider: { route: () => { calls += 1; return item.failure(); } },
      });
      assert.equal(calls, 2);
      assert.equal(proposal.provenance, "DETERMINISTIC_FALLBACK");
      assert.equal(proposal.fallbackReason, item.reason);
      assert.equal(JSON.stringify(proposal).includes("secret response"), false);
      assert.equal(JSON.stringify(proposal).includes("secret-credential"), false);
    });
  }
});

test("provider malformed responses are rejected without retry", async () => {
  let calls = 0;
  const proposal = await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route(payload) {
        calls += 1;
        const waypointId = payload.stops[0].waypointId;
        return { orderedWaypointIds: [waypointId, waypointId], distanceMeters: -5 };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(proposal.providerStatus, "INVALID_RESPONSE");
  assert.equal(proposal.fallbackReason, "INVALID_PROVIDER_RESPONSE");
  assert.deepEqual(proposal.orderedStopIds, ["stop-b", "stop-a"]);
});

test("missing and foreign waypoint identities are rejected", async (t) => {
  const cases = [
    { name: "missing waypoint", response: (ids) => ({ orderedWaypointIds: [ids[0]] }) },
    { name: "unknown cross-manifest waypoint", response: (ids) => ({ orderedWaypointIds: [ids[0], "foreign-manifest-waypoint"] }) },
    { name: "internal stop ID injection", response: (ids) => ({ orderedWaypointIds: [ids[0], "private-order-from-another-distributor"] }) },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const proposal = await buildRoadRouteSuggestion({
        stops: routeStops,
        fallbackOrder: deterministicOrder,
        provider: {
          async route(payload) {
            return item.response(payload.stops.map(({ waypointId }) => waypointId));
          },
        },
      });
      assert.equal(proposal.provenance, "DETERMINISTIC_FALLBACK");
      assert.equal(proposal.providerStatus, "INVALID_RESPONSE");
      assert.deepEqual(proposal.orderedStopIds, ["stop-b", "stop-a"]);
    });
  }
});

test("a previous manifest proposal cannot inject its waypoint identities into a new request", async () => {
  let firstManifestWaypoints;
  await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route(payload) {
        firstManifestWaypoints = payload.stops.map(({ waypointId }) => waypointId);
        return { orderedWaypointIds: firstManifestWaypoints };
      },
    },
  });
  const secondManifestStops = routeStops.map((stop) => ({
    ...stop,
    id: `other-${stop.id}`,
    orderId: `other-${stop.orderId}`,
  }));
  const proposal = await buildRoadRouteSuggestion({
    stops: secondManifestStops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route() {
        return { orderedWaypointIds: firstManifestWaypoints };
      },
    },
  });
  assert.equal(proposal.provenance, "DETERMINISTIC_FALLBACK");
  assert.equal(proposal.providerStatus, "INVALID_RESPONSE");
  assert.deepEqual(proposal.orderedStopIds, ["other-stop-b", "other-stop-a"]);
});

test("provider retry count is capped even when a larger value is requested", async () => {
  let calls = 0;
  const proposal = await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
    maxRetries: 100,
    provider: {
      async route() {
        calls += 1;
        throw Object.assign(new Error("provider unavailable"), { status: 503 });
      },
    },
  });
  assert.equal(calls, 3);
  assert.equal(proposal.fallbackReason, "PROVIDER_SERVER_ERROR");
});

test("non-retryable provider errors fall back without retrying", async () => {
  let calls = 0;
  const proposal = await buildRoadRouteSuggestion({
    stops: routeStops,
    fallbackOrder: deterministicOrder,
    provider: {
      async route() {
        calls += 1;
        throw Object.assign(new Error("provider rejected request"), { status: 400 });
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(proposal.fallbackReason, "PROVIDER_ERROR");
});

test("unreachable stops are explicit and route metrics are omitted for partial routes", async () => {
  const proposal = await buildRoadRouteSuggestion({
    stops: [...routeStops, {
      id: "stop-c",
      addressSnapshot: { latitude: 27.7, longitude: 85.3 },
    }],
    fallbackOrder: deterministicOrder,
    provider: {
      async route(payload) {
        return {
          orderedWaypointIds: [payload.stops[2].waypointId, payload.stops[0].waypointId],
          unreachableWaypointIds: [payload.stops[1].waypointId],
          distanceMeters: 4200,
          durationSeconds: 600,
        };
      },
    },
  });
  assert.deepEqual(proposal.orderedStopIds, ["stop-c", "stop-a", "stop-b"]);
  assert.deepEqual(proposal.unroutableStops, [{ stopId: "stop-b", reason: "UNREACHABLE" }]);
  assert.equal("distanceMeters" in proposal, false);
  assert.equal("durationSeconds" in proposal, false);
});

const makeManifestClient = (manifest) => {
  const state = {
    ...manifest,
    stops: manifest.stops.map((stop) => ({ ...stop })),
  };
  const writes = { manifest: 0, stops: 0, isolationLevels: [] };
  const currentManifest = () => ({
    ...state,
    stops: [...state.stops].sort((left, right) => left.stopSequence - right.stopSequence),
  });
  const client = {
    $transaction: (callback, options) => {
      writes.isolationLevels.push(options?.isolationLevel);
      return callback(client);
    },
    deliveryRouteManifest: {
      findFirst: async ({ where }) =>
        state.id === where.id && state.distributorId === where.distributorId ? currentManifest() : null,
      update: async ({ data }) => {
        writes.manifest += 1;
        return Object.assign(state, data);
      },
      findUnique: async () => currentManifest(),
    },
    deliveryManifestStop: {
      update: async ({ where, data }) => {
        writes.stops += 1;
        const stop = state.stops.find((item) => item.id === where.id);
        Object.assign(stop, data);
        return stop;
      },
    },
  };
  return { client, state, writes };
};

const manifestFixture = (overrides = {}) => ({
  id: "manifest-1",
  distributorId: "distributor-1",
  status: "PREPARING",
  optimizationSnapshot: { method: "DETERMINISTIC_PRIORITY_TIME_WINDOW_DISTRICT_FALLBACK" },
  stops: [
    { id: "stop-a", stopSequence: 1, priority: "NORMAL", addressSnapshot: { district: "Lalitpur" } },
    { id: "stop-b", stopSequence: 2, priority: "NORMAL", addressSnapshot: { district: "Kathmandu" } },
  ],
  ...overrides,
});

test("manifest proposal is tenant-scoped, read-only, and rejects dispatched manifests", async () => {
  const { client, state, writes } = makeManifestClient(manifestFixture());
  const proposal = await previewRouteManifestOptimization({
    distributorId: "distributor-1",
    manifestId: "manifest-1",
    client,
  });
  assert.equal(proposal.provenance, "DETERMINISTIC_FALLBACK");
  assert.equal("distanceMeters" in proposal, false);
  assert.equal("durationSeconds" in proposal, false);
  assert.deepEqual(proposal.currentStopIds, ["stop-a", "stop-b"]);
  assert.deepEqual(proposal.orderedStopIds, ["stop-b", "stop-a"]);
  assert.deepEqual(state.stops.map(({ stopSequence }) => stopSequence), [1, 2]);
  assert.deepEqual(writes, { manifest: 0, stops: 0, isolationLevels: [] });
  await assert.rejects(
    previewRouteManifestOptimization({ distributorId: "other-distributor", manifestId: "manifest-1", client }),
    (error) => error.code === "MANIFEST_NOT_FOUND" && error.statusCode === 404,
  );

  const dispatched = makeManifestClient(manifestFixture({ status: "IN_TRANSIT" }));
  await assert.rejects(
    previewRouteManifestOptimization({
      distributorId: "distributor-1",
      manifestId: "manifest-1",
      client: dispatched.client,
    }),
    (error) => error.code === "MANIFEST_STATE_CONFLICT" && error.statusCode === 409,
  );
});

test("applying a proposal requires its unchanged source order and persists the reviewed fallback", async () => {
  const { client, state } = makeManifestClient(manifestFixture());
  const manifest = await reorderRouteManifest({
    distributorId: "distributor-1",
    manifestId: "manifest-1",
    expectedStopIds: ["stop-a", "stop-b"],
    orderedStopIds: ["stop-b", "stop-a"],
    optimizationSource: "DETERMINISTIC_FALLBACK",
    client,
  });
  assert.deepEqual(manifest.stops.map(({ id }) => id), ["stop-b", "stop-a"]);
  assert.deepEqual(state.optimizationSnapshot.lastAppliedOrdering, {
    source: "DETERMINISTIC_FALLBACK",
    externalRouting: false,
    appliedAt: state.optimizationSnapshot.lastAppliedOrdering.appliedAt,
  });
});

test("stale proposals and dispatched or completed manifest changes are rejected without writes", async (t) => {
  await t.test("manual reorder commits between preview and apply", async () => {
    const { client, state, writes } = makeManifestClient(manifestFixture());
    state.stops[0].stopSequence = 2;
    state.stops[1].stopSequence = 1;
    await assert.rejects(
      reorderRouteManifest({
        distributorId: "distributor-1",
        manifestId: "manifest-1",
        expectedStopIds: ["stop-a", "stop-b"],
        orderedStopIds: ["stop-b", "stop-a"],
        optimizationSource: "DETERMINISTIC_FALLBACK",
        client,
      }),
      (error) => error.code === "ROUTE_ORDER_CONFLICT" && error.statusCode === 409,
    );
    assert.equal(state.optimizationSnapshot.lastAppliedOrdering, undefined);
    assert.deepEqual(writes.isolationLevels, ["Serializable"]);
    assert.equal(writes.stops, 0);
    assert.equal(writes.manifest, 0);
  });

  await t.test("altered stop ordering is rejected", async () => {
    const { client, state, writes } = makeManifestClient(manifestFixture());
    await assert.rejects(
      reorderRouteManifest({
        distributorId: "distributor-1",
        manifestId: "manifest-1",
        expectedStopIds: ["stop-a", "stop-b"],
        orderedStopIds: ["stop-a", "stop-b"],
        optimizationSource: "DETERMINISTIC_FALLBACK",
        client,
      }),
      (error) => error.code === "ROUTE_PROPOSAL_STALE" && error.statusCode === 409,
    );
    assert.deepEqual(state.stops.map(({ stopSequence }) => stopSequence), [1, 2]);
    assert.equal(writes.stops, 0);
    assert.equal(writes.manifest, 0);
  });

  for (const status of ["IN_TRANSIT", "COMPLETED"]) {
    await t.test(`manifest status ${status}`, async () => {
      const { client, state } = makeManifestClient(manifestFixture({ status }));
      await assert.rejects(
        reorderRouteManifest({
          distributorId: "distributor-1",
          manifestId: "manifest-1",
          expectedStopIds: ["stop-a", "stop-b"],
          orderedStopIds: ["stop-b", "stop-a"],
          optimizationSource: "DETERMINISTIC_FALLBACK",
          client,
        }),
        (error) => error.code === "MANIFEST_STATE_CONFLICT" && error.statusCode === 409,
      );
      assert.deepEqual(state.stops.map(({ stopSequence }) => stopSequence), [1, 2]);
    });
  }
});
