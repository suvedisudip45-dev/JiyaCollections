import { prisma } from "../config/db.js";

const ACCOUNTING_UNRESOLVED = ["PENDING", "PROCESSING", "FAILED", "BLOCKED"];
const ACCOUNTING_ACTION_REQUIRED = ["FAILED", "BLOCKED"];
const NCM_OPEN_VARIANCE = ["VARIANCE_OPEN", "VARIANCE_PARTIALLY_RESOLVED"];

const countStatuses = (rows) => Object.fromEntries(
  rows.map(({ status, _count }) => [status, _count._all])
);

export const buildOperationalExceptionReport = async ({
  client = prisma,
  now = new Date(),
} = {}) => {
  const [
    deliveryReconciliationRequired,
    ambiguousNcmAttempts,
    openNcmSettlementVariances,
    accountingStatuses,
    oldestUnresolvedAccountingEvent,
  ] = await Promise.all([
    client.deliveryOrder.count({ where: { ncmReconciliationRequired: true } }),
    client.returnExchangeNcmAttempt.count({ where: { result: { in: ["STARTED", "UNKNOWN"] } } }),
    client.ncmSettlementBatch.count({ where: { status: { in: NCM_OPEN_VARIANCE } } }),
    client.accountingEvent.groupBy({
      by: ["status"],
      where: { status: { in: ACCOUNTING_UNRESOLVED } },
      _count: { _all: true },
    }),
    client.accountingEvent.findFirst({
      where: { status: { in: ACCOUNTING_UNRESOLVED } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const accountingByStatus = countStatuses(accountingStatuses);
  const accountingActionRequired = ACCOUNTING_ACTION_REQUIRED
    .reduce((total, status) => total + (accountingByStatus[status] || 0), 0);

  return {
    hasExceptions: Boolean(
      deliveryReconciliationRequired ||
      ambiguousNcmAttempts ||
      openNcmSettlementVariances ||
      accountingActionRequired
    ),
    locallyTracked: {
      deliveryReconciliationRequired,
      ambiguousNcmAttempts,
      openNcmSettlementVariances,
      accountingByStatus,
      oldestUnresolvedAccountingEventAt: oldestUnresolvedAccountingEvent?.createdAt?.toISOString() || null,
      oldestUnresolvedAccountingAgeSeconds: oldestUnresolvedAccountingEvent
        ? Math.max(0, Math.floor(
          (now.getTime() - oldestUnresolvedAccountingEvent.createdAt.getTime()) / 1000
        ))
        : null,
    },
    limitations: [
      "NCM carrier-only orders and a complete NCM financial ledger are not available through the configured integration.",
      "Counts cover locally persisted records only and do not prove carrier-side completeness.",
    ],
  };
};
