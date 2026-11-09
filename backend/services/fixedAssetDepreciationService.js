import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { postDepreciationAccounting } from "./accountingPostingEngine.js";
import {
  getConfiguredNepaliFiscalPeriod,
  getNepaliCalendarYears,
} from "./nepaliFiscalCalendar.js";

const calculateAssetDepreciation = (asset, monthsCount) => {
  const annualRate = Number(asset.depreciationRate || 25) / 100;
  const currentBook = Number(asset.currentBookValue);
  const salvage = Number(asset.salvageValue || 0);
  if (currentBook <= salvage) return 0;

  const rawAmount = asset.depreciationMethod === "STRAIGHT_LINE"
    ? ((Number(asset.purchaseCost) - salvage) / Math.max(1, Number(asset.usefulLifeMonths || 60))) * monthsCount
    : currentBook * (annualRate / 12) * monthsCount;
  return Number(Math.min(rawAmount, currentBook - salvage).toFixed(2));
};

export const runFixedAssetDepreciationBatch = async ({
  client = prisma,
  transactionDate = new Date(),
  monthsCount = 1,
  postAccounting = postDepreciationAccounting,
}) => {
  if (!Number.isInteger(monthsCount) || monthsCount !== 1) {
    const error = new Error("Depreciation batches must cover exactly one month.");
    error.statusCode = 400;
    error.code = "INVALID_DEPRECIATION_PERIOD";
    throw error;
  }

  return client.$transaction(async (tx) => {
    const calendars = await getNepaliCalendarYears(tx);
    const { periodName: periodKey, periodStart, periodEnd } =
      await getConfiguredNepaliFiscalPeriod(transactionDate, calendars);
    const idempotencyKey = `ASSET_DEPRECIATION:${periodKey}`;

    const existingEntry = await tx.journalEntry.findUnique({
      where: { idempotencyKey },
    }) || await tx.journalEntry.findFirst({
      where: {
        sourceType: "ASSET_DEPRECIATION",
        transactionDate: { gte: periodStart, lte: periodEnd },
      },
    });
    if (existingEntry) {
      if (existingEntry.status !== "POSTED") {
        const error = new Error(`A non-posted depreciation journal already exists for ${periodKey}. Finance review is required.`);
        error.statusCode = 409;
        error.code = "DEPRECIATION_PERIOD_JOURNAL_CONFLICT";
        throw error;
      }
      return {
        alreadyProcessed: true,
        count: 0,
        totalDepreciated: Number(existingEntry.totalDebit || 0),
        journalEntry: existingEntry,
      };
    }

    const assets = await tx.fixedAsset.findMany({ where: { status: "ACTIVE" } });
    let totalDepreciated = 0;
    let updatedCount = 0;

    for (const asset of assets) {
      const currentBook = Number(asset.currentBookValue);
      const accumulatedDepreciation = Number(asset.accumulatedDepreciation || 0);
      const depAmount = calculateAssetDepreciation(asset, monthsCount);
      if (depAmount <= 0) continue;

      const updateResult = await tx.fixedAsset.updateMany({
        where: {
          id: asset.id,
          status: "ACTIVE",
          currentBookValue: asset.currentBookValue,
          accumulatedDepreciation: asset.accumulatedDepreciation,
        },
        data: {
          currentBookValue: Number((currentBook - depAmount).toFixed(2)),
          accumulatedDepreciation: Number((accumulatedDepreciation + depAmount).toFixed(2)),
        },
      });
      if (updateResult.count !== 1) {
        const error = new Error(`Asset ${asset.assetTag} changed during depreciation. Refresh and retry.`);
        error.statusCode = 409;
        error.code = "FIXED_ASSET_BALANCE_CONFLICT";
        throw error;
      }

      totalDepreciated += depAmount;
      updatedCount += 1;
    }

    totalDepreciated = Number(totalDepreciated.toFixed(2));
    if (totalDepreciated > 0) {
      const journalEntry = await postAccounting({
        totalDepreciation: totalDepreciated,
        count: updatedCount,
        date: transactionDate,
        periodName: periodKey,
        idempotencyKey,
        sourceId: `DEP-${periodKey}`,
        client: tx,
        throwOnError: true,
      });
      if (!journalEntry) {
        throw new Error(`Depreciation journal for ${periodKey} was not created.`);
      }
      return { alreadyProcessed: false, count: updatedCount, totalDepreciated, journalEntry };
    }

    return { alreadyProcessed: false, count: updatedCount, totalDepreciated, journalEntry: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};
