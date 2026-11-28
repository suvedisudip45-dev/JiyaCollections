import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { ensureAccountingParty } from "./accountingPartyService.js";
import { createAccountingDocument } from "./accountingSubledgerService.js";
import { postJournalEntry } from "./accountingPostingEngine.js";
import { recordSystemAudit } from "./auditService.js";

const kathmanduDateParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
  };
};

const kathmanduMonthStart = (year, month) => new Date(Date.UTC(year, month - 1, 1, -5, -45));

const parseTiers = (tiers) => {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 10) {
    throw Object.assign(new Error("Configure between one and ten bonus tiers."), { statusCode: 400 });
  }
  const normalized = tiers.map((tier) => {
    const targetCount = Number(tier?.targetCount);
    const bonusAmount = new Prisma.Decimal(String(tier?.bonusAmount ?? ""));
    if (!Number.isInteger(targetCount) || targetCount < 1 || !bonusAmount.isFinite() || !bonusAmount.greaterThan(0)) {
      throw Object.assign(new Error("Each tier needs a positive whole-delivery target and a positive bonus amount."), { statusCode: 400 });
    }
    return { targetCount, bonusAmount: bonusAmount.toDecimalPlaces(2).toFixed(2) };
  }).sort((a, b) => a.targetCount - b.targetCount);
  if (new Set(normalized.map((tier) => tier.targetCount)).size !== normalized.length) {
    throw Object.assign(new Error("Bonus tier delivery targets must be unique."), { statusCode: 400 });
  }
  return normalized;
};

export const saveDistributorBonusPlan = async ({
  distributorId,
  tiers,
  effectiveFrom = new Date(),
  notes = null,
  createdBy = null,
  actorContext = {},
  client = prisma,
} = {}) => {
  if (!distributorId) throw Object.assign(new Error("Distributor ID is required."), { statusCode: 400 });
  const distributor = await client.distributor.findUnique({ where: { id: distributorId }, select: { id: true } });
  if (!distributor) throw Object.assign(new Error("Distributor profile not found."), { statusCode: 404 });
  const parsedTiers = parseTiers(tiers);
  const startsAt = new Date(effectiveFrom);
  if (!Number.isFinite(startsAt.getTime())) throw Object.assign(new Error("Bonus plan effective date must be valid."), { statusCode: 400 });

  return client.$transaction(async (tx) => {
    const current = await tx.distributorBonusPlan.findFirst({
      where: { distributorId, status: "ACTIVE", effectiveUntil: null },
      orderBy: { effectiveFrom: "desc" },
    });
    if (current && startsAt <= current.effectiveFrom) {
      throw Object.assign(new Error("A revised bonus plan must start after the current plan."), { statusCode: 409 });
    }
    if (current) {
      await tx.distributorBonusPlan.update({
        where: { id: current.id },
        data: { effectiveUntil: new Date(startsAt.getTime() - 1) },
      });
    }
    const plan = await tx.distributorBonusPlan.create({
      data: {
        distributorId,
        periodType: "MONTHLY",
        metric: "DELIVERED_ORDERS",
        tiers: parsedTiers,
        effectiveFrom: startsAt,
        notes: typeof notes === "string" ? notes.trim().slice(0, 1000) || null : null,
        createdBy,
      },
    });
    await recordSystemAudit(
      { ...actorContext, actorId: createdBy, actorRole: "ADMIN", portalSource: "ADMIN" },
      {
        action: "DISTRIBUTOR_BONUS_PLAN_CREATED",
        entityType: "DistributorBonusPlan",
        entityId: plan.id,
        afterState: {
          distributorId: plan.distributorId,
          metric: plan.metric,
          periodType: plan.periodType,
          tiers: plan.tiers,
          effectiveFrom: plan.effectiveFrom,
        },
      },
      { client: tx },
    );
    return plan;
  });
};

export const getDistributorBonusPlans = ({ distributorId, client = prisma } = {}) => client.distributorBonusPlan.findMany({
  where: distributorId ? { distributorId } : {},
  orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
});

export const getClosedDistributorBonusPreview = async ({
  distributorId,
  now = new Date(),
  client = prisma,
} = {}) => {
  if (!distributorId) throw new Error("Distributor ID is required to calculate target bonuses.");
  const plans = await client.distributorBonusPlan.findMany({
    where: { distributorId, status: "ACTIVE", effectiveFrom: { lt: now } },
    orderBy: { effectiveFrom: "asc" },
  });
  const currentParts = kathmanduDateParts(now);
  let year = currentParts.year;
  let month = currentParts.month - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const currentMonthStart = kathmanduMonthStart(currentParts.year, currentParts.month);
  const periods = [];

  for (const plan of plans) {
    const startParts = kathmanduDateParts(plan.effectiveFrom);
    let periodYear = startParts.year;
    let periodMonth = startParts.month;
    while (periodYear < year || (periodYear === year && periodMonth <= month)) {
      const periodStart = kathmanduMonthStart(periodYear, periodMonth);
      const nextPeriodStart = periodMonth === 12
        ? kathmanduMonthStart(periodYear + 1, 1)
        : kathmanduMonthStart(periodYear, periodMonth + 1);
      const periodEnd = new Date(nextPeriodStart.getTime() - 1);
      const planCoversWholePeriod = plan.effectiveFrom <= periodStart &&
        (!plan.effectiveUntil || plan.effectiveUntil >= periodEnd);
      if (planCoversWholePeriod && periodStart < currentMonthStart) {
        const existing = await client.distributorBonusEarning.findFirst({
          where: { distributorId, periodStart },
        });
        const eligibleDeliveryCount = existing?.eligibleDeliveryCount ?? await client.orderAssignment.count({
          where: {
            distributorId,
            deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
            status: { in: ["delivered", "Delivered"] },
            deliveredAt: { gte: periodStart, lte: periodEnd },
          },
        });
        const tiers = parseTiers(plan.tiers);
        const earnedTiers = tiers.filter((tier) => eligibleDeliveryCount >= tier.targetCount);
        const bonusAmount = existing
          ? new Prisma.Decimal(existing.bonusAmount)
          : earnedTiers.reduce((total, tier) => total.plus(tier.bonusAmount), new Prisma.Decimal(0))
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        if (bonusAmount.greaterThan(0)) {
          periods.push({
            planId: plan.id,
            periodStart,
            periodEnd,
            period: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
            eligibleDeliveryCount,
            tiers,
            earnedTiers: existing?.snapshot?.earnedTiers || earnedTiers,
            bonusAmount: bonusAmount.toFixed(2),
            accrued: Boolean(existing),
            earningId: existing?.id || null,
            accountingDocumentId: existing?.accountingDocumentId || null,
          });
        }
      }
      periodMonth += 1;
      if (periodMonth > 12) {
        periodMonth = 1;
        periodYear += 1;
      }
    }
  }

  const activePlan = plans.find((plan) =>
    plan.effectiveFrom <= currentMonthStart && (!plan.effectiveUntil || plan.effectiveUntil >= now)
  );
  const currentPeriodCount = activePlan
    ? await client.orderAssignment.count({
        where: {
          distributorId,
          deliveryType: { in: ["SELF_DELIVERY", "self_delivery"] },
          status: { in: ["delivered", "Delivered"] },
          deliveredAt: { gte: currentMonthStart, lt: kathmanduMonthStart(currentParts.year, currentParts.month + 1) },
        },
      })
    : 0;
  return {
    periods,
    currentPeriod: activePlan ? {
      period: `${currentParts.year}-${String(currentParts.month).padStart(2, "0")}`,
      eligibleDeliveryCount: currentPeriodCount,
      tiers: parseTiers(activePlan.tiers),
      closesAt: kathmanduMonthStart(currentParts.year, currentParts.month + 1),
    } : null,
    projectedBonusTotal: periods.reduce((total, period) => total + Number(period.bonusAmount), 0),
  };
};

export const accrueClosedDistributorBonuses = async ({
  distributorId,
  distributorName,
  now = new Date(),
  client = prisma,
} = {}) => {
  if (!distributorId || !distributorName) throw new Error("Distributor identity is required to accrue target bonuses.");
  const preview = await getClosedDistributorBonusPreview({ distributorId, now, client });
  const createdBonuses = [];
  for (const period of preview.periods.filter((item) => !item.accrued)) {
    const idempotencyKey = `DISTRIBUTOR_BONUS:${distributorId}:${period.period}`;
    const bonus = await client.distributorBonusEarning.create({
      data: {
        distributorId,
        planId: period.planId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        eligibleDeliveryCount: period.eligibleDeliveryCount,
        bonusAmount: period.bonusAmount,
        idempotencyKey,
        snapshot: {
          metric: "DELIVERED_ORDERS",
          period: period.period,
          eligibleDeliveryCount: period.eligibleDeliveryCount,
          tiers: period.tiers,
          earnedTiers: period.earnedTiers,
          bonusAmount: period.bonusAmount,
          qualification: "COMPLETED_SELF_DELIVERIES_ONLY",
        },
      },
    });
    const party = await ensureAccountingParty({
      partyType: "DISTRIBUTOR",
      sourceEntityId: distributorId,
      displayName: distributorName,
    }, { client });
    const journal = await postJournalEntry({
      transactionDate: period.periodEnd,
      sourceType: "DISTRIBUTOR_TARGET_BONUS",
      sourceId: bonus.id,
      idempotencyKey,
      referenceNumber: `DIST-BONUS-${bonus.id.slice(-8)}`,
      description: `Distributor monthly delivery target bonus for ${distributorName}`,
      lines: [
        { mappingKey: "DELIVERY_EXPENSE", debit: period.bonusAmount, credit: 0, description: "Distributor target bonus expense", accountingPartyId: party.id },
        { mappingKey: "DISTRIBUTOR_PAYABLE", debit: 0, credit: period.bonusAmount, description: "Distributor target bonus payable", accountingPartyId: party.id },
      ],
      client,
    });
    const document = await createAccountingDocument({
      documentType: "BILL",
      documentNumber: `DIST-BONUS-${bonus.id}`,
      partyId: party.id,
      side: "PAYABLE",
      sourceType: "DISTRIBUTOR_TARGET_BONUS",
      sourceId: bonus.id,
      issueDate: period.periodEnd,
      amount: period.bonusAmount,
      idempotencyKey,
      notes: JSON.stringify(bonus.snapshot),
    }, { client });
    const recorded = await client.distributorBonusEarning.update({
      where: { id: bonus.id },
      data: { accountingDocumentId: document.id, journalEntryId: journal.id },
    });
    createdBonuses.push(recorded);
  }
  return createdBonuses;
};
