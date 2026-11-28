import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_RETRIES = 2;
const MAX_TIMEOUT_MS = 15000;

export const ROUTE_PROVENANCE = Object.freeze({
  DETERMINISTIC_FALLBACK: "DETERMINISTIC_FALLBACK",
  ROAD_ROUTING_PROVIDER: "ROAD_ROUTING_PROVIDER",
});

const readCoordinates = (stop) => {
  const address = stop.addressSnapshot;
  const rawLatitude = address && typeof address === "object" ? address.latitude : null;
  const rawLongitude = address && typeof address === "object" ? address.longitude : null;
  const hasLatitude = rawLatitude !== null && rawLatitude !== undefined && String(rawLatitude).trim() !== "";
  const hasLongitude = rawLongitude !== null && rawLongitude !== undefined && String(rawLongitude).trim() !== "";

  if (!hasLatitude && !hasLongitude) return { reason: "COORDINATES_MISSING" };
  if (!hasLatitude || !hasLongitude) return { reason: "COORDINATES_INVALID" };
  if (!["number", "string"].includes(typeof rawLatitude) ||
      !["number", "string"].includes(typeof rawLongitude)) {
    return { reason: "COORDINATES_INVALID" };
  }

  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { reason: "COORDINATES_INVALID" };
  }
  return { coordinates: { latitude, longitude } };
};

const withTimeout = async (operation, timeoutMs) => {
  const controller = new AbortController();
  let timeout;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("Routing request timed out."), { code: "ROUTING_TIMEOUT" }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      operation(controller.signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const providerFailureReason = (error) => {
  const status = Number(error?.status || error?.statusCode);
  if (error?.code === "ROUTING_TIMEOUT" || error?.code === "ETIMEDOUT" ||
      error?.name === "AbortError" || status === 408) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status >= 500) return "PROVIDER_SERVER_ERROR";
  return "PROVIDER_ERROR";
};

const isRetryable = (reason) => [
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_SERVER_ERROR",
].includes(reason);

const validateProviderResult = (result, waypoints) => {
  if (!result || typeof result !== "object" ||
      !Array.isArray(result.orderedWaypointIds) ||
      (result.unreachableWaypointIds !== undefined && !Array.isArray(result.unreachableWaypointIds))) {
    return null;
  }
  const unreachable = result.unreachableWaypointIds || [];
  const returnedIds = [...result.orderedWaypointIds, ...unreachable];
  const expectedIds = new Set(waypoints.map(({ waypointId }) => waypointId));
  if (returnedIds.some((id) => typeof id !== "string" || !expectedIds.has(id)) ||
      new Set(returnedIds).size !== returnedIds.length ||
      returnedIds.length !== expectedIds.size) {
    return null;
  }

  for (const metric of ["distanceMeters", "durationSeconds"]) {
    if (result[metric] !== undefined &&
        (!Number.isFinite(result[metric]) || result[metric] < 0)) return null;
  }
  return { orderedWaypointIds: result.orderedWaypointIds, unreachableWaypointIds: unreachable };
};

export const buildRoadRouteSuggestion = async ({
  stops,
  provider = null,
  fallbackOrder,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
}) => {
  if (!Array.isArray(stops) || typeof fallbackOrder !== "function") {
    throw new TypeError("Stops and deterministic fallback ordering are required.");
  }

  const originalStops = [...stops];
  const fallbackIds = fallbackOrder(originalStops).map(({ id }) => id);
  const coordinateFailures = new Map();
  const routableStops = [];
  originalStops.forEach((stop) => {
    const result = readCoordinates(stop);
    if (result.reason) {
      coordinateFailures.set(stop.id, result.reason);
      return;
    }
    routableStops.push({
      stop,
      waypointId: randomUUID(),
      ...result.coordinates,
    });
  });

  const fallback = (providerStatus, fallbackReason) => ({
    provenance: ROUTE_PROVENANCE.DETERMINISTIC_FALLBACK,
    providerStatus,
    fallbackReason,
    orderedStopIds: fallbackIds,
    unroutableStops: originalStops
      .filter(({ id }) => coordinateFailures.has(id))
      .map(({ id }) => ({ stopId: id, reason: coordinateFailures.get(id) })),
  });

  if (!provider || typeof provider.route !== "function") {
    return fallback("UNAVAILABLE", "PROVIDER_NOT_CONFIGURED");
  }
  if (!routableStops.length) {
    return fallback("UNAVAILABLE", "NO_VALID_COORDINATES");
  }

  const payload = {
    stops: routableStops.map(({ waypointId, latitude, longitude }) => ({
      waypointId,
      latitude,
      longitude,
    })),
  };
  const safeTimeout = Math.max(1, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const safeRetries = Math.max(0, Math.min(MAX_RETRIES, Math.floor(Number(maxRetries) || 0)));
  let providerResult;
  let lastFailure = "PROVIDER_ERROR";

  for (let attempt = 0; attempt <= safeRetries; attempt += 1) {
    try {
      providerResult = await withTimeout(
        (signal) => provider.route(payload, { signal }),
        safeTimeout,
      );
      break;
    } catch (error) {
      lastFailure = providerFailureReason(error);
      if (!isRetryable(lastFailure) || attempt === safeRetries) {
        return fallback("UNAVAILABLE", lastFailure);
      }
    }
  }

  const validated = validateProviderResult(providerResult, routableStops);
  if (!validated) return fallback("INVALID_RESPONSE", "INVALID_PROVIDER_RESPONSE");

  const stopByWaypoint = new Map(routableStops.map(({ stop, waypointId }) => [waypointId, stop]));
  const providerOrderedStops = validated.orderedWaypointIds.map((waypointId) => stopByWaypoint.get(waypointId));
  const unreachableIds = new Set(validated.unreachableWaypointIds.map(
    (waypointId) => stopByWaypoint.get(waypointId).id,
  ));
  const unroutableStops = [
    ...originalStops
      .filter(({ id }) => coordinateFailures.has(id))
      .map(({ id }) => ({ stopId: id, reason: coordinateFailures.get(id) })),
    ...originalStops
      .filter(({ id }) => unreachableIds.has(id))
      .map(({ id }) => ({ stopId: id, reason: "UNREACHABLE" })),
  ];
  const orderedStopIds = [
    ...providerOrderedStops.map(({ id }) => id),
    ...originalStops.filter(({ id }) => unreachableIds.has(id) || coordinateFailures.has(id)).map(({ id }) => id),
  ];
  const hasUnroutableStops = unroutableStops.length > 0;

  const proposal = {
    provenance: ROUTE_PROVENANCE.ROAD_ROUTING_PROVIDER,
    providerStatus: "AVAILABLE",
    fallbackReason: null,
    orderedStopIds,
    unroutableStops,
  };
  if (!hasUnroutableStops) {
    if (providerResult.distanceMeters !== undefined) proposal.distanceMeters = providerResult.distanceMeters;
    if (providerResult.durationSeconds !== undefined) proposal.durationSeconds = providerResult.durationSeconds;
  }
  return proposal;
};
