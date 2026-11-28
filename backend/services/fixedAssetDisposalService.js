import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { postFixedAssetDisposalAccounting } from "./accountingPostingEngine.js";

const fail = (message, statusCode = 400, code = "ASSET_DISPOSAL_ERROR") =>
  Object.assign(new Error(message), { statusCode, code });

const runSerializable = (client, callback) =>
  typeof client.$transaction === "function"
    ? client.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    : callback(client);

export const recordFixedAssetDisposal = async ({
  assetId,
  status,
  damageNotes,
  disposalAmount = 0,
  idempotencyKey: rawIdempotencyKey,
  client = prisma,
  postDisposalAccounting = postFixedAssetDisposalAccounting,
} = {}) => {
  const requestKey = String(rawIdempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,140}$/.test(requestKey)) {
    throw fail("A valid Idempotency-Key is required.");
  }
  if (status === "SOLD") {
    throw fail("Asset sales are unavailable until the tax-aware sale and VAT treatment is approved and implemented.", 409, "ASSET_SALE_TAX_FLOW_REQUIRED");
  }
  if (!["DAMAGED", "WRITTEN_OFF"].includes(status)) {
    throw fail("Select a valid asset damage or write-off status.");
  }
  const recoveredAmount = Number(disposalAmount ?? 0);
  if (!Number.isFinite(recoveredAmount) || recoveredAmount < 0) {
    throw fail("Recovery amount must be a non-negative number.");
  }
  if (recoveredAmount > 0) {
    throw fail("Recording disposal proceeds is unavailable until the tax-aware sale and VAT treatment is approved and implemented.", 409, "ASSET_SALE_TAX_FLOW_REQUIRED");
  }
  if (typeof assetId !== "string" || !assetId.trim()) throw fail("Asset ID is required.");

  const normalizedDamageNotes = String(damageNotes || "").trim();
  const payloadHash = createHash("sha256").update(JSON.stringify({
    assetId,
    status,
    damageNotes: normalizedDamageNotes,
    recoveredAmount,
  })).digest("hex");
  const requestHash = createHash("sha256").update(requestKey).digest("hex");
  const internalKey = `ASSET_DISPOSAL:${requestHash}`;
  const outcome = await runSerializable(client, async (tx) => {
    const existingEntry = await tx.journalEntry.findUnique({ where: { idempotencyKey: internalKey } });
    if (existingEntry) {
      if (existingEntry.status !== "POSTED") {
        throw fail("A non-posted disposal journal exists for this request. Finance review is required.", 409, "ASSET_DISPOSAL_JOURNAL_CONFLICT");
      }
      if (existingEntry.sourceId !== assetId || existingEntry.referenceNumber !== payloadHash) {
        throw fail("This Idempotency-Key was already used for a different asset disposal.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      const existingAsset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
      return {
        asset: existingAsset,
        scrapLoss: Number(existingAsset?.scrapLossAmount || 0),
        alreadyProcessed: true,
      };
    }

    const asset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw fail("Asset not found.", 404);
    if (asset.status !== "ACTIVE") {
      throw fail("Only an active fixed asset can be damaged or disposed.", 409, "FIXED_ASSET_NOT_ACTIVE");
    }

    const disposalDate = new Date();
    const scrapLoss = Math.max(0, Number((Number(asset.currentBookValue) - recoveredAmount).toFixed(2)));
    const updateResult = await tx.fixedAsset.updateMany({
      where: {
        id: asset.id,
        status: "ACTIVE",
        currentBookValue: asset.currentBookValue,
        accumulatedDepreciation: asset.accumulatedDepreciation,
      },
      data: {
        status,
        damageNotes: normalizedDamageNotes || "Damaged/Disposed",
        disposalDate,
        disposalAmount: recoveredAmount,
        scrapLossAmount: scrapLoss,
        currentBookValue: 0,
      },
    });
    if (updateResult.count !== 1) {
      throw fail("Asset values changed during disposal. Refresh and retry.", 409, "FIXED_ASSET_BALANCE_CONFLICT");
    }

    await postDisposalAccounting(asset, {
      status,
      damageNotes: normalizedDamageNotes,
      recoveredAmount,
      disposalDate,
      idempotencyKey: internalKey,
      payloadHash,
    }, { client: tx });
    return {
      asset: await tx.fixedAsset.findUnique({ where: { id: asset.id } }),
      scrapLoss,
      alreadyProcessed: false,
    };
  });

  return outcome;
};
