import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";

let initialized = false;
let stockProjection = "not_started";

export const markApplicationInitialized = () => {
  initialized = true;
};

export const setStockProjectionStatus = (status) => {
  if (!["not_started", "syncing", "ready", "failed"].includes(status)) {
    throw new TypeError(`Invalid stock projection status: ${status}`);
  }
  stockProjection = status;
};

export const getRuntimeStatus = () => ({ initialized, stockProjection });

export const createReadinessHandler = ({
  database = prisma,
  getStatus = getRuntimeStatus,
  log = logger,
} = {}) => async (_req, res) => {
  const runtime = getStatus();
  if (!runtime.initialized) {
    return res.status(503).json({
      ready: false,
      status: "starting",
      dependencies: { database: "not_checked" },
      stockProjection: runtime.stockProjection,
    });
  }

  try {
    await database.$queryRaw`SELECT 1`;
  } catch (error) {
    log.warn("Readiness database check failed.", {
      errorCode: error?.code || error?.name || "DATABASE_UNAVAILABLE",
    });
    return res.status(503).json({
      ready: false,
      status: "not_ready",
      dependencies: { database: "unavailable" },
      stockProjection: runtime.stockProjection,
    });
  }

  return res.status(200).json({
    ready: true,
    status: runtime.stockProjection === "failed" ? "degraded" : "ready",
    dependencies: { database: "ok" },
    stockProjection: runtime.stockProjection,
  });
};

export const livenessHandler = (_req, res) =>
  res.status(200).json({ live: true });
