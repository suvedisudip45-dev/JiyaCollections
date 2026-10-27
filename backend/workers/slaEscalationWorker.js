import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";

/**
 * Sweeps for operational SLA breaches and triggers escalations.
 */
export const runSlaEscalationSweep = async () => {
  const now = Date.now();
  const summary = {
    transfersEscalated: 0,
    returnsEscalated: 0,
    shipmentsFlagged: 0,
  };

  try {
    // 1. Stock Transfers pending review > 24 hours
    const transferThreshold = new Date(now - 24 * 60 * 60 * 1000);
    const staleTransfers = await prisma.stockTransfer.findMany({
      where: {
        status: "PENDING_ADMIN_APPROVAL",
        requestedAt: { lt: transferThreshold },
      },
      select: { id: true, requestedAt: true, distributorId: true },
    });

    for (const transfer of staleTransfers) {
      logger.warn(`SLA BREACH: Stock transfer ${transfer.id} has been pending admin review > 24 hours`, {
        transferId: transfer.id,
        requestedAt: transfer.requestedAt,
        distributorId: transfer.distributorId,
      });
      summary.transfersEscalated++;
    }

    // 2. Customer Returns pending admin review > 48 hours
    const returnThreshold = new Date(now - 48 * 60 * 60 * 1000);
    const staleReturns = await prisma.customerReturn.findMany({
      where: {
        lifecycleStatus: "PENDING_ADMIN_REVIEW",
        createdAt: { lt: returnThreshold },
      },
      select: { id: true, orderId: true, createdAt: true },
    });

    for (const ret of staleReturns) {
      logger.warn(`SLA BREACH: Customer return ${ret.id} has been pending admin review > 48 hours`, {
        returnId: ret.id,
        orderId: ret.orderId,
        createdAt: ret.createdAt,
      });
      summary.returnsEscalated++;
    }

    // 3. Courier Outbox Jobs stalled in DEAD_LETTER or pending > 4 hours
    const outboxThreshold = new Date(now - 4 * 60 * 60 * 1000);
    const deadLetterJobs = await prisma.courierOutboxJob.findMany({
      where: {
        status: "DEAD_LETTER",
        createdAt: { gte: outboxThreshold },
      },
      select: { id: true, provider: true, jobType: true, lastError: true },
    });

    if (deadLetterJobs.length > 0) {
      logger.error(`OPERATIONAL ALERT: ${deadLetterJobs.length} courier jobs in DEAD_LETTER require immediate attention`, {
        jobs: deadLetterJobs,
      });
      summary.shipmentsFlagged = deadLetterJobs.length;
    }

    return {
      success: true,
      timestamp: new Date(),
      ...summary,
    };
  } catch (error) {
    logger.error("Error running SLA escalation sweep", { error: error.message });
    return { success: false, error: error.message };
  }
};
