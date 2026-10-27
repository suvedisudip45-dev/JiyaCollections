import { prisma } from "../../config/db.js";
import { logger } from "../../utils/logger.js";
import { NcmCourierAdapter } from "./adapters/NcmCourierAdapter.js";

// Registry of supported couriers
const adapters = {
  NCM: new NcmCourierAdapter(),
};

/**
 * Returns the currently active courier adapter.
 * Defaults to "NCM" as required.
 */
export const getActiveCourier = (provider = "NCM") => {
  const normalized = String(provider || "NCM").toUpperCase();
  const adapter = adapters[normalized];
  if (!adapter) {
    throw new Error(`Unsupported courier provider: ${provider}`);
  }
  return adapter;
};

/**
 * Dynamic 77-District Shipping Rate Quote with 24-Hour Cache:
 * Resolves the 50-route static override bottleneck.
 */
export const getShippingRateForDistricts = async ({
  originDistrict,
  destDistrict,
  weightKg = 1.0,
  provider = "NCM",
}) => {
  const normOrigin = String(originDistrict || "Kathmandu").trim().toLowerCase();
  const normDest = String(destDistrict || "Kathmandu").trim().toLowerCase();
  const weight = Number(weightKg) || 1.0;

  // 1. Check database cache
  try {
    const cached = await prisma.shippingRateCache.findFirst({
      where: {
        provider,
        originDistrict: normOrigin,
        destDistrict: normDest,
        weightKg: weight,
        expiresAt: { gt: new Date() },
      },
    });

    if (cached) {
      return cached.rateNPR;
    }
  } catch (error) {
    logger.warn("Shipping rate cache lookup failed, falling back to live quote", { error: error.message });
  }

  // 2. Query active courier adapter
  const courier = getActiveCourier(provider);
  const quotedRate = await courier.quoteShippingRate({
    originDistrict: normOrigin,
    destDistrict: normDest,
    weightKg: weight,
  });

  // 3. Persist to cache with 24-hour expiration
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.shippingRateCache.upsert({
      where: {
        provider_originDistrict_destDistrict_weightKg: {
          provider,
          originDistrict: normOrigin,
          destDistrict: normDest,
          weightKg: weight,
        },
      },
      update: {
        rateNPR: quotedRate,
        expiresAt,
      },
      create: {
        provider,
        originDistrict: normOrigin,
        destDistrict: normDest,
        weightKg: weight,
        rateNPR: quotedRate,
        expiresAt,
      },
    });
  } catch (err) {
    logger.warn("Failed to update shipping rate cache", { error: err.message });
  }

  return quotedRate;
};

/**
 * Enqueue a courier action into the resilient CourierOutboxJob queue.
 * Ensures that carrier API downtime or network drops do not stall fulfillment.
 */
export const enqueueCourierJob = async ({
  jobType,
  provider = "NCM",
  orderId = null,
  transferId = null,
  payload = {},
}) => {
  return await prisma.courierOutboxJob.create({
    data: {
      provider,
      orderId,
      transferId,
      jobType,
      payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
    },
  });
};

/**
 * Resilient Dispatch:
 * Attempts immediate courier booking; if the carrier fails due to timeout or network drop,
 * enqueues a background retry job instead of crashing or blocking the distributor dispatch.
 */
export const dispatchShipmentWithResilience = async ({
  provider = "NCM",
  orderId = null,
  transferId = null,
  payload = {},
}) => {
  const courier = getActiveCourier(provider);

  try {
    const result = await courier.bookDelivery(payload);
    return {
      success: true,
      mode: "IMMEDIATE",
      ...result,
    };
  } catch (error) {
    logger.error("Carrier immediate booking failed, falling back to outbox retry queue", {
      provider,
      orderId,
      transferId,
      error: error.message,
    });

    const job = await enqueueCourierJob({
      provider,
      orderId,
      transferId,
      jobType: "BOOKING",
      payload,
    });

    return {
      success: true,
      mode: "QUEUED_OUTBOX",
      jobId: job.id,
      message: `${provider} booking queued for background dispatch due to carrier latency.`,
      warning: error.message,
    };
  }
};
