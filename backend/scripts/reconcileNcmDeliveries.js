import "dotenv/config";
import { prisma } from "../config/db.js";
import { reconcileDueActiveDeliveries } from "../services/deliveryService.js";

const isEnabled = process.env.NCM_DELIVERY_AUTO_RECONCILIATION_ENABLED === "true";
const staleMinutes = Number(process.env.NCM_DELIVERY_RECONCILIATION_STALE_MINUTES);
const maximumBatchSize = 25;

const validateConfiguration = () => {
  if (!process.env.NCM_API_TOKEN) {
    throw new Error("NCM_API_TOKEN is required when scheduled delivery reconciliation is enabled.");
  }
  if (!process.env.NCM_API_BASE_URL) {
    throw new Error("Set NCM_API_BASE_URL explicitly when scheduled delivery reconciliation is enabled.");
  }
  if (!Number.isInteger(staleMinutes) || staleMinutes < 1 || staleMinutes > 10080) {
    throw new Error("NCM_DELIVERY_RECONCILIATION_STALE_MINUTES must be a whole number between 1 and 10080.");
  }

  const host = new URL(process.env.NCM_API_BASE_URL).hostname.toLowerCase();
  const pointsToNonProduction = /demo|sandbox|staging|stage|test/.test(host);
  if (process.env.NODE_ENV === "production" && pointsToNonProduction) {
    throw new Error("Production scheduled reconciliation cannot use a demo, sandbox, staging, or test NCM endpoint.");
  }
};

try {
  if (!isEnabled) {
    console.log(JSON.stringify({ outcome: "SKIPPED", reason: "Scheduled NCM delivery reconciliation is disabled." }));
  } else {
    validateConfiguration();
    const result = await reconcileDueActiveDeliveries({
      olderThan: new Date(Date.now() - staleMinutes * 60 * 1000),
      limit: maximumBatchSize,
    });
    console.log(JSON.stringify({
      outcome: result.failedCount || result.reviewCount ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED",
      staleMinutes,
      batchLimit: maximumBatchSize,
      scannedCount: result.count,
      reconciledCount: result.reconciledCount,
      reviewCount: result.reviewCount,
      failedCount: result.failedCount,
      hasMore: result.hasMore,
    }));
    if (result.failedCount || result.reviewCount || result.hasMore) process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({
    outcome: "FAILED",
    code: error?.code || error?.name || "NCM_RECONCILIATION_JOB_FAILED",
    message: error.message || "Scheduled NCM delivery reconciliation failed.",
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
