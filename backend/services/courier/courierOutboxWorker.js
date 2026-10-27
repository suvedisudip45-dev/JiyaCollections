import { prisma } from "../../config/db.js";
import { logger } from "../../utils/logger.js";
import { getActiveCourier } from "./courierService.js";

/**
 * Process a single courier outbox job.
 */
export const processCourierJob = async (job) => {
  const courier = getActiveCourier(job.provider || "NCM");
  const payload = job.payload || {};

  try {
    let result = null;
    switch (job.jobType) {
      case "BOOKING":
        result = await courier.bookDelivery(payload);
        break;
      case "CANCEL":
        result = await courier.cancelDelivery(payload.trackingId, payload.reason || "Cancelled");
        break;
      case "RETURN":
        result = await courier.requestReturn(payload.trackingId, payload);
        break;
      case "SUPPORT_TICKET":
        result = await courier.createSupportTicket(payload);
        break;
      default:
        throw new Error(`Unknown courier job type: ${job.jobType}`);
    }

    await prisma.courierOutboxJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        lastError: null,
      },
    });

    logger.info(`Courier job ${job.id} (${job.jobType}) successfully completed`, { result });
    return { success: true, result };
  } catch (error) {
    const nextAttemptCount = job.attempts + 1;
    const isDeadLetter = nextAttemptCount >= job.maxAttempts;
    // Exponential backoff: 1 min, 4 min, 9 min, 16 min...
    const backoffSeconds = Math.min(3600, Math.pow(nextAttemptCount, 2) * 60);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    await prisma.courierOutboxJob.update({
      where: { id: job.id },
      data: {
        attempts: nextAttemptCount,
        status: isDeadLetter ? "DEAD_LETTER" : "PENDING",
        lastError: error.message,
        nextAttemptAt,
      },
    });

    logger.warn(`Courier job ${job.id} attempt ${nextAttemptCount} failed. Dead letter: ${isDeadLetter}`, {
      error: error.message,
      nextAttemptAt,
    });
    return { success: false, error: error.message, isDeadLetter };
  }
};

/**
 * Runs one sweep of all ready pending courier jobs.
 */
export const runCourierOutboxSweep = async (batchSize = 20) => {
  const pendingJobs = await prisma.courierOutboxJob.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    take: batchSize,
    orderBy: { nextAttemptAt: "asc" },
  });

  const results = [];
  for (const job of pendingJobs) {
    const outcome = await processCourierJob(job);
    results.push({ jobId: job.id, ...outcome });
  }

  return {
    processedCount: pendingJobs.length,
    results,
  };
};
