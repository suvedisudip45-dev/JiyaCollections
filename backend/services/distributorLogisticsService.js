import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { ensureInventoryLocation, applyInventoryMovement } from "./inventoryLedgerService.js";
import { recordSystemAudit } from "./auditService.js";
import { updateSelfDeliveryStatus } from "./distributorSelfDeliveryService.js";
import {
  planCostLayerAllocations,
  planReceivedCostLayerAllocations,
} from "./stockTransferService.js";
import { buildRoadRouteSuggestion, ROUTE_PROVENANCE } from "./roadRoutingService.js";

const fail = (message, code = "INVALID_LOGISTICS_REQUEST", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const clean = (value, maxLength = 191) => {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw fail(`Value cannot exceed ${maxLength} characters.`);
  return text;
};
const positiveQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw fail("Quantity must be a positive whole number.");
  }
  return quantity;
};
const hashPayload = (payload) => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

export const deterministicRouteSequence = (stops) =>
  [...stops].sort((left, right) => {
    const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
    const leftPriority = priorityRank[String(left.priority || "normal").toLowerCase()] ?? 2;
    const rightPriority = priorityRank[String(right.priority || "normal").toLowerCase()] ?? 2;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftWindow = left.timeWindowStart ? new Date(left.timeWindowStart).getTime() : Number.MAX_SAFE_INTEGER;
    const rightWindow = right.timeWindowStart ? new Date(right.timeWindowStart).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftWindow !== rightWindow) return leftWindow - rightWindow;
    return String(left.address?.district || left.addressSnapshot?.district || "").localeCompare(
      String(right.address?.district || right.addressSnapshot?.district || ""),
    ) || String(left.address?.city || left.addressSnapshot?.city || "").localeCompare(
      String(right.address?.city || right.addressSnapshot?.city || ""),
    );
  });

export const createDeliveryDriver = async ({ distributorId, actorAccountId, body, client }) =>
  client.$transaction(async (tx) => {
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40).replace(/[^\d+]/g, "");
    if (!name || !/^\+?\d{7,15}$/.test(phone)) throw fail("Driver name and valid phone are required.");
    const existing = await tx.deliveryDriver.findFirst({ where: { distributorId, phone } });
    if (existing) return existing;
    return tx.deliveryDriver.create({
      data: {
        distributorId,
        accountId: clean(body.accountId || "", 191) || null,
        name,
        phone,
        licenseNumber: clean(body.licenseNumber || "", 64) || null,
        vehicleType: clean(body.vehicleType || "", 64) || null,
        vehicleRegistration: clean(body.vehicleRegistration || "", 64) || null,
        status: "ACTIVE",
      },
    });
  }, { isolationLevel: "Serializable" });

  export const cancelPeerStockTransfer = async ({ distributorId, transferId, actorAccountId, reason, client }) =>
    client.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id: transferId } });
      if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
      if (transfer.sourceDistributorId !== distributorId && transfer.distributorId !== distributorId) {
        throw fail("Only the source or receiving distributor can cancel.", "FORBIDDEN_PEER_TRANSFER", 403);
      }
      if (!["PENDING_SOURCE_APPROVAL", "APPROVED"].includes(transfer.status)) {
        throw fail("A dispatched peer transfer cannot be cancelled through this endpoint.", "PEER_TRANSFER_STATE_CONFLICT", 409);
      }
      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "CANCELLED", completedAt: new Date(), adminNote: clean(reason || "Cancelled", 2000) },
      });
      await tx.peerStockTransferCustodyEvent.create({
        data: {
          stockTransferId: transfer.id,
          distributorId,
          eventType: "CANCELLED",
          custodyStage: "REQUESTED",
          responsibilityParty: distributorId === transfer.sourceDistributorId ? "SOURCE_DISTRIBUTOR" : "RECEIVING_DISTRIBUTOR",
          details: clean(reason || "Cancelled", 2000),
          idempotencyKey: `peer:${transfer.id}:cancelled`,
          actorAccountId,
        },
      });
      return updated;
    }, { isolationLevel: "Serializable" });

  export const disputePeerStockTransfer = async ({ distributorId, transferId, actorAccountId, body, client }) =>
    client.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id: transferId } });
      if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
      if (transfer.sourceDistributorId !== distributorId && transfer.distributorId !== distributorId) {
        throw fail("Only peer transfer participants can open a dispute.", "FORBIDDEN_PEER_TRANSFER", 403);
      }
      await tx.peerStockTransferCustodyEvent.create({
        data: {
          stockTransferId: transfer.id,
          distributorId,
          eventType: "DISPUTED",
          custodyStage: "DISPUTED",
          responsibilityParty: body.responsibleParty || "PLATFORM",
          details: clean(body.details || "Receipt dispute", 4000),
          evidence: body.evidence ? JSON.parse(JSON.stringify(body.evidence)) : undefined,
          idempotencyKey: clean(body.idempotencyKey || "", 191) || `peer:${transfer.id}:dispute:${Date.now()}`,
          actorAccountId,
        },
      });
      await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: "DISCREPANCY" } });
      return tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: { custodyEvents: true } });
    }, { isolationLevel: "Serializable" });

  export const getLogisticsAnalytics = async ({ distributorId, client }) => {
    const [manifests, stops, transfers] = await Promise.all([
      client.deliveryRouteManifest.findMany({
        where: { distributorId },
        include: { stops: { include: { proof: true } } },
      }),
      client.deliveryManifestStop.findMany({
        where: { manifest: { distributorId } },
        include: { proof: true },
      }),
      client.stockTransfer.findMany({
        where: { OR: [{ distributorId }, { sourceDistributorId: distributorId }] },
        include: { discrepancies: true, shipments: true },
      }),
    ]);
    const totalStops = stops.length;
    const completed = stops.filter((stop) => ["DELIVERED", "PARTIAL"].includes(stop.status)).length;
    const failed = stops.filter((stop) => stop.status === "FAILED").length;
    const completedDurations = stops
      .filter((stop) => stop.dispatchedAt && stop.completedAt)
      .map((stop) => (new Date(stop.completedAt).getTime() - new Date(stop.dispatchedAt).getTime()) / 60000)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const averageDeliveryMinutes = completedDurations.length
      ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
      : 0;
    const peerTransfers = transfers.filter((transfer) => transfer.transferKind === "PEER_DISTRIBUTOR");
    const transferDurations = peerTransfers
      .filter((transfer) => transfer.createdAt && transfer.completedAt)
      .map((transfer) => (new Date(transfer.completedAt).getTime() - new Date(transfer.createdAt).getTime()) / 60000);
    return {
      delivery: {
        routeCount: manifests.length,
        stopCount: totalStops,
        completed,
        failed,
        completionRate: totalStops ? completed / totalStops : 0,
        failureRate: totalStops ? failed / totalStops : 0,
        averageDeliveryMinutes,
      },
      transfers: {
        peerTransferCount: peerTransfers.length,
        discrepancyCount: peerTransfers.reduce((sum, transfer) => sum + transfer.discrepancies.length, 0),
        averageTurnaroundMinutes: transferDurations.length
          ? Math.round(transferDurations.reduce((sum, value) => sum + value, 0) / transferDurations.length)
          : 0,
        pending: peerTransfers.filter((transfer) => !["RECEIVED", "CANCELLED", "DISCREPANCY"].includes(transfer.status)).length,
      },
    };
  };

  export const syncOfflineDeliveryDraft = async ({
    distributorId,
    driverId = null,
    actorAccountId,
    body,
    photoPath = null,
    signaturePath = null,
    completeStop = completeRouteStop,
    client,
  }) => {
    const clientDraftId = clean(body.clientDraftId, 191);
    const manifestId = clean(body.manifestId);
    const stopId = clean(body.stopId);
    if (!clientDraftId || !manifestId || !stopId) throw fail("Offline draft identity, manifest, and stop are required.");
    const canonicalBody = {
      ...body,
      clientDraftId,
      idempotencyKey: clientDraftId,
      outcome: String(body.outcome || "").trim().toUpperCase(),
      recipientName: clean(body.recipientName, 191),
      notes: clean(body.notes || "", 4000),
      failedReason: clean(body.failedReason || "", 191),
      paymentMethod: clean(body.paymentMethod || "CASH", 32).toUpperCase(),
      collectionConfirmed: body.collectionConfirmed === true || body.collectionConfirmed === "true",
    };
    const operationHashFor = (payload) => hashPayload({
      clientDraftId: payload.clientDraftId,
      manifestId: payload.manifestId,
      stopId: payload.stopId,
      outcome: payload.outcome,
      recipientName: payload.recipientName,
      deviceTimestamp: payload.deviceTimestamp || null,
      notes: payload.notes || null,
      failedReason: payload.failedReason || null,
      partialQuantity: payload.partialQuantity || null,
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      paymentMethod: payload.paymentMethod || "CASH",
      collectionConfirmed: payload.collectionConfirmed,
      evidenceDigest: payload.evidenceDigest || null,
    });
    const operationHash = operationHashFor({
      ...canonicalBody,
      clientDraftId,
      manifestId,
      stopId,
    });

    const findAuthorizedStop = async (tx) => {
      const stop = await tx.deliveryManifestStop.findFirst({
        where: {
          id: stopId,
          manifestId,
          manifest: {
            is: {
              distributorId,
              ...(driverId ? { driverId } : {}),
            },
          },
        },
        include: { manifest: true, proof: true },
      });
      if (!stop || !stop.assignmentId) {
        throw fail("Offline draft references an unauthorized manifest stop.", "STOP_NOT_FOUND", 404);
      }
      const assignment = await tx.orderAssignment.findFirst({
        where: {
          id: stop.assignmentId,
          orderId: stop.orderId,
          distributorId,
          deliveryType: "SELF_DELIVERY",
        },
        select: { id: true },
      });
      if (!assignment) {
        throw fail("Offline draft references an unauthorized manifest stop.", "STOP_NOT_FOUND", 404);
      }
      return stop;
    };

    const safePayloadSnapshot = {
      clientDraftId,
      manifestId,
      stopId,
      idempotencyKey: clientDraftId,
      outcome: canonicalBody.outcome,
      recipientName: canonicalBody.recipientName,
      deviceTimestamp: canonicalBody.deviceTimestamp || null,
      notes: canonicalBody.notes || null,
      failedReason: canonicalBody.failedReason || null,
      partialQuantity: canonicalBody.partialQuantity || null,
      latitude: canonicalBody.latitude || null,
      longitude: canonicalBody.longitude || null,
      paymentMethod: canonicalBody.paymentMethod || "CASH",
      collectionConfirmed: canonicalBody.collectionConfirmed,
      evidenceDigest: canonicalBody.evidenceDigest || null,
      photoPath: photoPath || null,
      signaturePath: signaturePath || null,
    };

    const pending = await client.$transaction(async (tx) => {
      const stop = await findAuthorizedStop(tx);
      let existing = await tx.offlineDeliverySyncDraft.findUnique({ where: { clientDraftId } });
      if (existing) {
        if (existing.manifestId !== manifestId || existing.stopId !== stopId ||
            existing.operationHash !== operationHash) {
          const previousPayload = existing.payloadSnapshot || {};
          const isCollectionConfirmationRetry = existing.status === "PENDING" &&
            previousPayload.collectionConfirmed === false &&
            canonicalBody.collectionConfirmed === true &&
            operationHashFor({
              ...previousPayload,
              collectionConfirmed: true,
            }) === operationHash;
          if (!isCollectionConfirmationRetry) {
            throw fail("Offline draft was reused with conflicting payload.", "OFFLINE_SYNC_CONFLICT", 409);
          }
          existing = await tx.offlineDeliverySyncDraft.update({
            where: { id: existing.id },
            data: { operationHash, payloadSnapshot: safePayloadSnapshot },
          });
        }
        if (existing.status === "SYNCED") return { draft: existing, replayed: true };
        if (existing.status === "CONFLICT" || existing.status === "REJECTED") {
          throw fail("The offline draft is in conflict and requires explicit reconciliation.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        if (existing.status !== "PENDING") {
          throw fail("The offline draft has an unsupported synchronization state.", "OFFLINE_SYNC_CONFLICT", 409);
        }
      }
      const manifestIsInTransit = stop.manifest.status === "IN_TRANSIT";
      const proofMatchesDraft = stop.proof?.idempotencyKey === clientDraftId &&
        stop.proof?.outcome === canonicalBody.outcome &&
        stop.proof?.recipientName === canonicalBody.recipientName &&
        (stop.proof?.photoPath || null) === (existing?.payloadSnapshot?.photoPath || photoPath || null) &&
        (stop.proof?.signaturePath || null) === (existing?.payloadSnapshot?.signaturePath || signaturePath || null);
      if (!manifestIsInTransit && !proofMatchesDraft) {
        throw fail("The assigned manifest is no longer available for this delivery action.", "OFFLINE_SYNC_CONFLICT", 409);
      }
      if (stop.proof && !proofMatchesDraft) {
        throw fail("This stop already has a different server-confirmed delivery outcome.", "OFFLINE_SYNC_CONFLICT", 409);
      }
      if (["DELIVERED", "PARTIAL", "FAILED"].includes(stop.status) && !proofMatchesDraft) {
        throw fail("This delivery stop has already been reconciled by the server.", "OFFLINE_SYNC_CONFLICT", 409);
      }
      const draft = existing || await tx.offlineDeliverySyncDraft.create({
        data: {
          manifestId,
          stopId,
          clientDraftId,
          operationHash,
          payloadSnapshot: safePayloadSnapshot,
          status: "PENDING",
        },
      });
      return { draft, replayed: false };
    }, { isolationLevel: "Serializable" });

    if (pending.replayed) {
      return { status: "SYNCED", draft: pending.draft, replayed: true };
    }

    try {
      return await client.$transaction(async (tx) => {
        const stop = await findAuthorizedStop(tx);
        const draft = await tx.offlineDeliverySyncDraft.findUnique({ where: { clientDraftId } });
        if (!draft || draft.operationHash !== operationHash) {
          throw fail("Offline draft changed before it could be synchronized.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        if (draft.status === "SYNCED") return { status: "SYNCED", draft, replayed: true };
        if (draft.status !== "PENDING") {
          throw fail("The offline draft is in conflict and requires explicit reconciliation.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        if (stop.manifest.status !== "IN_TRANSIT" &&
            stop.proof?.idempotencyKey !== clientDraftId) {
          throw fail("The assigned manifest is no longer available for this delivery action.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        if (stop.proof && stop.proof.idempotencyKey !== clientDraftId) {
          throw fail("This stop already has a different server-confirmed delivery outcome.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        const snapshot = draft.payloadSnapshot || {};
        const completion = await completeStop({
          distributorId,
          manifestId,
          stopId,
          actorAccountId,
          body: canonicalBody,
          photoPath: snapshot.photoPath || null,
          signaturePath: snapshot.signaturePath || null,
          client: tx,
          executeInTransaction: true,
        });
        if (completion?._replayed && completion.idempotencyKey !== clientDraftId) {
          throw fail("This stop already has a different server-confirmed delivery outcome.", "OFFLINE_SYNC_CONFLICT", 409);
        }
        const synced = await tx.offlineDeliverySyncDraft.update({
          where: { id: draft.id },
          data: { status: "SYNCED", reconciledAt: new Date(), reconciledByAccountId: actorAccountId || null },
        });
        return { status: "SYNCED", draft: synced, replayed: Boolean(completion?._replayed) };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryableCodErrors = new Set([
        "COD_COLLECTION_CONFIRMATION_REQUIRED",
        "DELIVERY_OTP_REQUIRED",
        "DELIVERY_OTP_EXPIRED",
        "INVALID_DELIVERY_OTP",
        "DELIVERY_OTP_CONFLICT",
        "DELIVERY_OTP_LOCKED",
        "DELIVERY_OTP_AMOUNT_CHANGED",
        "INVALID_PAYMENT_METHOD",
      ]);
      if (error.statusCode >= 400 && error.statusCode < 500 &&
          !retryableCodErrors.has(error.code)) {
        await client.offlineDeliverySyncDraft.updateMany({
          where: { clientDraftId, status: "PENDING" },
          data: {
            status: "CONFLICT",
            conflictDetails: { code: error.code || "OFFLINE_SYNC_FAILED" },
          },
        });
      }
      throw error;
    }
  };

  export const createPeerStockTransfer = async ({
    requestingDistributorId,
    sourceDistributorId,
    actorAccountId,
    body,
    client,
  }) => client.$transaction(async (tx) => {
    if (!sourceDistributorId || sourceDistributorId === requestingDistributorId) throw fail("Choose a different source distributor.");
    const [source, destination] = await Promise.all([
      tx.distributor.findFirst({ where: { id: sourceDistributorId, status: "ACTIVE", isActive: true } }),
      tx.distributor.findFirst({ where: { id: requestingDistributorId, status: "ACTIVE", isActive: true } }),
    ]);
    if (!source || !destination) throw fail("Both peer distributors must be active.", "PEER_DISTRIBUTOR_NOT_ACTIVE", 403);
    if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) throw fail("A peer transfer requires 1 to 100 SKU lines.");
    const seen = new Set();
    const normalizedLines = body.lines.map((line) => {
      const inventorySkuId = clean(line.inventorySkuId);
      if (!inventorySkuId || seen.has(inventorySkuId)) throw fail("Peer transfer SKU lines must be unique.");
      seen.add(inventorySkuId);
      return { inventorySkuId, requestedQuantity: positiveQuantity(line.quantity) };
    });
    const skus = await tx.inventorySku.findMany({
      where: { id: { in: normalizedLines.map((line) => line.inventorySkuId) }, isActive: true },
    });
    if (skus.length !== normalizedLines.length) throw fail("One or more SKU variants are unavailable.", "SKU_NOT_FOUND", 404);
    const sourceLocation = await tx.inventoryLocation.findFirst({
      where: { kind: "DISTRIBUTOR", distributorId: source.id, inventoryOwner: "PLATFORM", isActive: true },
    });
    const destinationLocation = await tx.inventoryLocation.findFirst({
      where: { kind: "DISTRIBUTOR", distributorId: destination.id, inventoryOwner: "PLATFORM", isActive: true },
    });
    if (!sourceLocation || !destinationLocation) throw fail("Both peer distributor locations must exist.", "PEER_LOCATION_NOT_FOUND", 409);
    const sourceBalances = await tx.inventoryBalance.findMany({
      where: { locationId: sourceLocation.id, inventorySkuId: { in: normalizedLines.map((line) => line.inventorySkuId) } },
    });
    const balanceBySku = new Map(sourceBalances.map((balance) => [balance.inventorySkuId, balance]));
    for (const line of normalizedLines) {
      const balance = balanceBySku.get(line.inventorySkuId);
      if (!balance || balance.quantityOnHand - balance.reservedQuantity < line.requestedQuantity) {
        throw fail("The source distributor does not have enough available stock.", "PEER_STOCK_INSUFFICIENT", 409);
      }
    }
    const idempotencyKey = clean(body.idempotencyKey || "", 191) || `peer-request:${requestingDistributorId}:${sourceDistributorId}:${hashPayload(normalizedLines)}`;
    const existing = await tx.stockTransfer.findFirst({ where: { transferKind: "PEER_DISTRIBUTOR", requestedByAccountId: idempotencyKey } });
    if (existing) return existing;
    const transfer = await tx.stockTransfer.create({
      data: {
        manufacturerId: null,
        distributorId: destination.id,
        transferKind: "PEER_DISTRIBUTOR",
        sourceDistributorId: source.id,
        sourceLocationId: sourceLocation.id,
        destinationLocationId: destinationLocation.id,
        status: "PENDING_SOURCE_APPROVAL",
        requestedByAccountId: idempotencyKey,
        lines: {
          create: normalizedLines.map((line) => ({
            inventorySkuId: line.inventorySkuId,
            requestedQuantity: line.requestedQuantity,
            approvedQuantity: 0,
          })),
        },
      },
      include: { lines: { include: { inventorySku: { include: { product: true } } } }, sourceDistributor: true, distributor: true },
    });
    await tx.peerStockTransferCustodyEvent.create({
      data: {
        stockTransferId: transfer.id,
        distributorId: destination.id,
        eventType: "REQUESTED",
        custodyStage: "REQUESTED",
        responsibilityParty: "PLATFORM",
        idempotencyKey: `peer:${transfer.id}:requested`,
        actorAccountId,
      },
    });
    await recordSystemAudit(
      { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
      {
        action: "PEER_STOCK_TRANSFER_REQUESTED",
        entityType: "StockTransfer",
        entityId: transfer.id,
        beforeState: null,
        afterState: { sourceDistributorId: source.id, destinationDistributorId: destination.id, status: transfer.status },
      },
      { client: tx },
    );
    return transfer;
  }, { isolationLevel: "Serializable" });

  export const listEligiblePeerDistributors = async ({ distributorId, client }) => {
    const candidates = await client.distributor.findMany({
      where: {
        id: { not: distributorId },
        status: "ACTIVE",
        isActive: true,
      },
      select: { id: true, name: true, province: true, district: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 100,
    });
    if (!candidates.length) return [];
    const locations = await client.inventoryLocation.findMany({
      where: {
        distributorId: { in: candidates.map((candidate) => candidate.id) },
        kind: "DISTRIBUTOR",
        inventoryOwner: "PLATFORM",
        isActive: true,
      },
      select: { distributorId: true },
    });
    const eligibleIds = new Set(locations.map((location) => location.distributorId));
    return candidates.filter((candidate) => eligibleIds.has(candidate.id));
  };

  export const approvePeerStockTransfer = async ({
    distributorId,
    transferId,
    approval,
    actorAccountId,
    client,
  }) => client.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { lines: true },
    });
    if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
    if (approval !== "SOURCE_APPROVED" && approval !== "RECEIVER_APPROVED") throw fail("Invalid peer approval action.");
    if (approval === "SOURCE_APPROVED" && transfer.sourceDistributorId !== distributorId) throw fail("Only the source distributor can approve source dispatch.", "FORBIDDEN_PEER_TRANSFER", 403);
    if (approval === "RECEIVER_APPROVED" && transfer.distributorId !== distributorId) throw fail("Only the receiving distributor can approve receipt.", "FORBIDDEN_PEER_TRANSFER", 403);
    if (["CANCELLED", "RECEIVED"].includes(transfer.status)) throw fail("This peer transfer is closed.", "PEER_TRANSFER_STATE_CONFLICT", 409);
    const event = await tx.peerStockTransferCustodyEvent.findFirst({
      where: { stockTransferId: transfer.id, eventType: approval },
    });
    if (event) return transfer;
    await tx.peerStockTransferCustodyEvent.create({
      data: {
        stockTransferId: transfer.id,
        distributorId,
        eventType: approval,
        custodyStage: approval === "SOURCE_APPROVED" ? "SOURCE" : "DESTINATION",
        responsibilityParty: approval === "SOURCE_APPROVED" ? "SOURCE_DISTRIBUTOR" : "RECEIVING_DISTRIBUTOR",
        idempotencyKey: `peer:${transfer.id}:${approval.toLowerCase()}`,
        actorAccountId,
      },
    });
    const sourceApproved = approval === "SOURCE_APPROVED" || await tx.peerStockTransferCustodyEvent.count({
      where: { stockTransferId: transfer.id, eventType: "SOURCE_APPROVED" },
    });
    const receiverApproved = approval === "RECEIVER_APPROVED" || await tx.peerStockTransferCustodyEvent.count({
      where: { stockTransferId: transfer.id, eventType: "RECEIVER_APPROVED" },
    });
    if (approval === "SOURCE_APPROVED") {
      for (const line of transfer.lines) {
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { approvedQuantity: line.requestedQuantity },
        });
      }
    }
    return tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: sourceApproved && receiverApproved ? "APPROVED" : transfer.status,
        ...(sourceApproved && receiverApproved ? { reviewedAt: new Date(), reviewedByAccountId: actorAccountId } : {}),
      },
    });
  }, { isolationLevel: "Serializable" });

export const rejectPeerStockTransfer = async ({
  distributorId,
  transferId,
  actorAccountId,
  reason,
  client,
}) => client.$transaction(async (tx) => {
  const transfer = await tx.stockTransfer.findUnique({ where: { id: transferId } });
  if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") {
    throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
  }
  if (transfer.sourceDistributorId !== distributorId) {
    throw fail("Only the source distributor can reject this request.", "FORBIDDEN_PEER_TRANSFER", 403);
  }
  if (transfer.status === "REJECTED") return transfer;
  if (transfer.status !== "PENDING_SOURCE_APPROVAL") {
    throw fail("Only requests awaiting source approval can be rejected.", "PEER_TRANSFER_STATE_CONFLICT", 409);
  }
  const sourceApproval = await tx.peerStockTransferCustodyEvent.findFirst({
    where: { stockTransferId: transfer.id, eventType: "SOURCE_APPROVED" },
  });
  if (sourceApproval) {
    throw fail("A source-approved request cannot be rejected; cancel it before dispatch instead.", "PEER_TRANSFER_STATE_CONFLICT", 409);
  }
  const updated = await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "REJECTED", completedAt: new Date(), adminNote: clean(reason || "Rejected by source distributor.", 2000) },
  });
  await tx.peerStockTransferCustodyEvent.create({
    data: {
      stockTransferId: transfer.id,
      distributorId,
      eventType: "REJECTED",
      custodyStage: "SOURCE",
      responsibilityParty: "SOURCE_DISTRIBUTOR",
      details: clean(reason || "Rejected by source distributor.", 2000),
      idempotencyKey: `peer:${transfer.id}:rejected`,
      actorAccountId,
    },
  });
  return updated;
}, { isolationLevel: "Serializable" });

export const attachPeerTransferEvidence = async ({
  distributorId,
  transferId,
  actorAccountId,
  body,
  publicId,
  client,
}) => client.$transaction(async (tx) => {
  const transfer = await tx.stockTransfer.findUnique({
    where: { id: transferId },
    include: { shipments: { include: { lines: true } } },
  });
  if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") {
    throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
  }
  if (transfer.sourceDistributorId !== distributorId && transfer.distributorId !== distributorId) {
    throw fail("Only peer transfer participants can attach evidence.", "FORBIDDEN_PEER_TRANSFER", 403);
  }
  const shipmentLineId = clean(body.shipmentLineId || "", 191) || null;
  if (shipmentLineId && !transfer.shipments.some((shipment) =>
    shipment.lines.some((line) => line.id === shipmentLineId))) {
    throw fail("The selected shipment line does not belong to this transfer.", "PEER_EVIDENCE_LINE_INVALID", 409);
  }
  const idempotencyKey = clean(body.idempotencyKey || "", 191);
  if (!idempotencyKey) throw fail("An evidence idempotency key is required.");
  const existing = await tx.peerStockTransferCustodyEvent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.stockTransferId !== transfer.id) {
      throw fail("Evidence idempotency key was already used for another transfer.", "PEER_EVIDENCE_IDEMPOTENCY_CONFLICT", 409);
    }
    return { event: existing, replayed: true };
  }
  const details = clean(body.details || "", 2000) || null;
  const event = await tx.peerStockTransferCustodyEvent.create({
    data: {
      stockTransferId: transfer.id,
      distributorId,
      eventType: "EVIDENCE_ATTACHED",
      custodyStage: distributorId === transfer.sourceDistributorId ? "SOURCE" : "DESTINATION",
      responsibilityParty: distributorId === transfer.sourceDistributorId ? "SOURCE_DISTRIBUTOR" : "RECEIVING_DISTRIBUTOR",
      details,
      evidence: { publicId, shipmentLineId },
      idempotencyKey,
      actorAccountId,
    },
  });
  return { event, replayed: false };
}, { isolationLevel: "Serializable" });

export const listDeliveryDrivers = ({ distributorId, client }) =>
  client.deliveryDriver.findMany({
    where: { distributorId },
    orderBy: { createdAt: "desc" },
  });

export const updateDeliveryDriver = async ({ distributorId, driverId, body, client }) =>
  client.$transaction(async (tx) => {
    const current = await tx.deliveryDriver.findFirst({ where: { id: driverId, distributorId } });
    if (!current) throw fail("Driver not found.", "DRIVER_NOT_FOUND", 404);
    const status = String(body.status || current.status).toUpperCase();
    if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) throw fail("Invalid driver status.");
    const name = clean(body.name ?? current.name, 120);
    const phone = clean(body.phone ?? current.phone, 40).replace(/[^\d+]/g, "");
    if (!name || !/^\+?\d{7,15}$/.test(phone)) throw fail("Driver name and valid phone are required.");
    return tx.deliveryDriver.update({
      where: { id: current.id },
      data: {
        name,
        phone,
        licenseNumber: clean(body.licenseNumber ?? current.licenseNumber ?? "", 64) || null,
        vehicleType: clean(body.vehicleType ?? current.vehicleType ?? "", 64) || null,
        vehicleRegistration: clean(body.vehicleRegistration ?? current.vehicleRegistration ?? "", 64) || null,
        status,
      },
    });
  }, { isolationLevel: "Serializable" });

export const createRouteManifest = async ({
  distributorId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  if (!Array.isArray(body.assignmentIds) || body.assignmentIds.length < 1 || body.assignmentIds.length > 100) {
    throw fail("A route must contain between 1 and 100 assigned orders.");
  }
  const uniqueAssignmentIds = [...new Set(body.assignmentIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniqueAssignmentIds.length !== body.assignmentIds.length) throw fail("Duplicate assignment IDs are not allowed.");
  if (body.driverId) {
    const driver = await tx.deliveryDriver.findFirst({
      where: { id: body.driverId, distributorId, status: "ACTIVE" },
    });
    if (!driver) throw fail("Active driver not found.", "DRIVER_NOT_FOUND", 404);
  }
  const assignments = await tx.orderAssignment.findMany({
    where: { id: { in: uniqueAssignmentIds }, distributorId },
    include: { order: { select: { id: true, address: true, status: true, fulfillmentStatus: true } } },
  });
  if (assignments.length !== uniqueAssignmentIds.length) throw fail("One or more assignments do not belong to this distributor.", "ASSIGNMENT_NOT_FOUND", 404);

  const stopInputs = assignments.map((assignment) => {
    let address = {};
    try { address = typeof assignment.order.address === "object" ? assignment.order.address : JSON.parse(assignment.order.address || "{}"); } catch { address = {}; }
    return {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      priority: clean(body.priorities?.[assignment.id] || "NORMAL", 16).toUpperCase(),
      timeWindowStart: body.timeWindows?.[assignment.id]?.start ? new Date(body.timeWindows[assignment.id].start) : null,
      timeWindowEnd: body.timeWindows?.[assignment.id]?.end ? new Date(body.timeWindows[assignment.id].end) : null,
      address,
    };
  }).map((stop) => ({ ...stop, priority: String(stop.priority || "NORMAL").toLowerCase() }));
  const ordered = deterministicRouteSequence(stopInputs);
  const idempotencyKey = clean(body.idempotencyKey || "", 191) || `manifest:${distributorId}:${hashPayload({
    assignmentIds: uniqueAssignmentIds,
    driverId: body.driverId || null,
  })}`;
  const replay = await tx.deliveryRouteManifest.findUnique({ where: { idempotencyKey } });
  if (replay) return replay;

  const manifestCode = `RM-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  return tx.deliveryRouteManifest.create({
    data: {
      distributorId,
      driverId: body.driverId || null,
      manifestCode,
      name: clean(body.name || `Route ${manifestCode}`, 191),
      status: body.driverId ? "ASSIGNED" : "PREPARING",
      priority: clean(body.priority || "NORMAL", 16).toUpperCase(),
      plannedStartAt: body.plannedStartAt ? new Date(body.plannedStartAt) : null,
      plannedEndAt: body.plannedEndAt ? new Date(body.plannedEndAt) : null,
      optimizationSnapshot: {
        method: "DETERMINISTIC_PRIORITY_TIME_WINDOW_DISTRICT_FALLBACK",
        externalRouting: false,
        assignmentCount: ordered.length,
      },
      idempotencyKey,
      createdByAccountId: actorAccountId || null,
      stops: {
        create: ordered.map((stop, index) => ({
          orderId: stop.orderId,
          assignmentId: stop.assignmentId,
          stopSequence: index + 1,
          status: "PENDING",
          priority: String(stop.priority || "normal").toUpperCase(),
          timeWindowStart: stop.timeWindowStart,
          timeWindowEnd: stop.timeWindowEnd,
          recipientNameSnapshot: stop.address?.name || `${stop.address?.firstName || ""} ${stop.address?.lastName || ""}`.trim() || null,
          addressSnapshot: stop.address,
          parcelCount: positiveQuantity(body.parcelCounts?.[stop.assignmentId] || 1),
          idempotencyKey: `manifest-stop:${manifestCode}:${stop.orderId}`,
        })),
      },
    },
    include: { driver: true, stops: true },
  });
}, { isolationLevel: "Serializable" });

export const listRouteManifests = async ({ distributorId, driverId = null, status = null, client }) => {
  const manifests = await client.deliveryRouteManifest.findMany({
    where: {
      distributorId,
      ...(driverId ? { driverId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      driver: true,
      stops: { orderBy: { stopSequence: "asc" }, include: { proof: true } },
    },
  });
  const orderIds = [...new Set(manifests.flatMap((manifest) => manifest.stops.map((stop) => stop.orderId)))];
  if (!orderIds.length) return manifests;
  const assignments = await client.orderAssignment.findMany({
    where: { distributorId, orderId: { in: orderIds } },
    select: { orderId: true },
  });
  const assignedOrderIds = assignments.map((assignment) => assignment.orderId);
  const orders = assignedOrderIds.length
    ? await client.order.findMany({
      where: { id: { in: assignedOrderIds } },
      select: {
        id: true,
        orderReference: true,
        amount: true,
        deliveryFee: true,
        paymentMethod: true,
        payment: true,
      },
    })
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  return manifests.map((manifest) => ({
    ...manifest,
    stops: manifest.stops.map((stop) => ({ ...stop, order: ordersById.get(stop.orderId) || null })),
  }));
};

export const listDriverAssignedManifests = async ({ driverId, distributorId, client }) => {
  const manifestSelection = {
    id: true,
    manifestCode: true,
    name: true,
    status: true,
    priority: true,
    plannedStartAt: true,
    plannedEndAt: true,
    dispatchedAt: true,
    completedAt: true,
    stops: {
      orderBy: { stopSequence: "asc" },
      select: {
        id: true,
        orderId: true,
        assignmentId: true,
        stopSequence: true,
        status: true,
        recipientNameSnapshot: true,
        addressSnapshot: true,
        parcelCount: true,
        completedAt: true,
        proof: {
          select: {
            outcome: true,
            recipientName: true,
            notes: true,
            failedReason: true,
            partialQuantity: true,
            verifiedAt: true,
            signaturePath: true,
            photoPath: true,
            idempotencyKey: true,
          },
        },
      },
    },
  };
  const activeManifests = await client.deliveryRouteManifest.findMany({
    where: {
      driverId,
      distributorId,
      status: { in: ["ASSIGNED", "IN_TRANSIT"] },
    },
    orderBy: [{ plannedStartAt: "asc" }, { createdAt: "asc" }],
    take: 10,
    select: manifestSelection,
  });
  const completedManifests = activeManifests.length < 10
    ? await client.deliveryRouteManifest.findMany({
      where: { driverId, distributorId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 3,
      select: manifestSelection,
    })
    : [];
  const manifests = [...activeManifests, ...completedManifests];
  if (!manifests.length) return [];

  const assignmentIds = [...new Set(manifests.flatMap(({ stops }) => stops.map(({ assignmentId }) => assignmentId).filter(Boolean)))];
  const assignments = assignmentIds.length
    ? await client.orderAssignment.findMany({
      where: {
        id: { in: assignmentIds },
        distributorId,
        deliveryType: "SELF_DELIVERY",
      },
      select: { id: true, orderId: true },
    })
    : [];
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const validOrderIds = [...new Set(manifests.flatMap(({ stops }) => stops
    .filter((stop) => assignmentsById.get(stop.assignmentId)?.orderId === stop.orderId)
    .map(({ orderId }) => orderId)))];
  const orders = validOrderIds.length
    ? await client.order.findMany({
      where: { id: { in: validOrderIds } },
      select: {
        id: true,
        orderReference: true,
        items: true,
        amount: true,
        deliveryFee: true,
        paymentMethod: true,
        payment: true,
        address: true,
        directNotes: true,
      },
    })
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  return manifests.map((manifest) => ({
    id: manifest.id,
    manifestCode: manifest.manifestCode,
    name: manifest.name,
    status: manifest.status,
    priority: manifest.priority,
    plannedStartAt: manifest.plannedStartAt,
    plannedEndAt: manifest.plannedEndAt,
    dispatchedAt: manifest.dispatchedAt,
    completedAt: manifest.completedAt,
    stops: manifest.stops
      .filter((stop) => assignmentsById.get(stop.assignmentId)?.orderId === stop.orderId)
      .map((stop) => {
        const order = ordersById.get(stop.orderId);
        const codDue = order && String(order.paymentMethod || "COD").trim().toUpperCase() === "COD" && !order.payment;
        const proof = stop.proof;
        const itemList = Array.isArray(order?.items) ? order.items : [];
        return {
          id: stop.id,
          stopSequence: stop.stopSequence,
          status: stop.status,
          recipientName: stop.recipientNameSnapshot,
          address: stop.addressSnapshot || order?.address || null,
          parcelCount: stop.parcelCount,
          completedAt: stop.completedAt,
          proof: proof ? {
            outcome: proof.outcome,
            recipientName: proof.recipientName,
            notes: proof.notes,
            failedReason: proof.failedReason,
            partialQuantity: proof.partialQuantity,
            verifiedAt: proof.verifiedAt,
            hasSignature: Boolean(proof.signaturePath),
            hasPhoto: Boolean(proof.photoPath),
            idempotencyKey: proof.idempotencyKey,
          } : null,
          order: order ? {
            orderReference: order.orderReference,
            orderId: order.id,
            items: itemList.filter((item) => item && typeof item === "object").map((item) => ({
              name: item.name || item.productName || item.title || "Item",
              sku: item.sku || "",
              color: item.colorName || item.color || "",
              size: item.size || "",
              quantity: Number(item.quantity || item.qty || 0),
            })),
            codAmountDue: codDue ? Number(order.amount || 0) + Number(order.deliveryFee || 0) : 0,
            codPaymentRequired: Boolean(codDue),
            paymentMethod: String(order.paymentMethod || "COD").toUpperCase(),
          } : null,
          deliveryInstructions: stop.addressSnapshot?.deliveryInstructions || stop.addressSnapshot?.instructions || order?.directNotes || "",
        };
      }),
  }));
};

const sameSequence = (left, right) =>
  Array.isArray(left) && Array.isArray(right) &&
  left.length === right.length && left.every((id, index) => id === right[index]);

export const previewRouteManifestOptimization = async ({ distributorId, manifestId, client }) => {
  const manifest = await client.deliveryRouteManifest.findFirst({
    where: { id: manifestId, distributorId },
    include: { stops: { orderBy: { stopSequence: "asc" } } },
  });
  if (!manifest) throw fail("Manifest not found.", "MANIFEST_NOT_FOUND", 404);
  if (!["PREPARING", "ASSIGNED"].includes(manifest.status)) {
    throw fail("A dispatched or completed manifest cannot be optimized.", "MANIFEST_STATE_CONFLICT", 409);
  }

  const suggestion = await buildRoadRouteSuggestion({
    stops: manifest.stops,
    fallbackOrder: deterministicRouteSequence,
  });
  if (!Object.values(ROUTE_PROVENANCE).includes(suggestion.provenance)) {
    throw fail("Route proposal provenance is invalid.", "ROUTE_PROVENANCE_INVALID", 500);
  }
  return {
    manifestId: manifest.id,
    currentStopIds: manifest.stops.map(({ id }) => id),
    ...suggestion,
  };
};

export const reorderRouteManifest = async ({
  distributorId,
  manifestId,
  orderedStopIds,
  expectedStopIds = null,
  optimizationSource = null,
  client,
}) =>
  client.$transaction(async (tx) => {
    const manifest = await tx.deliveryRouteManifest.findFirst({
      where: { id: manifestId, distributorId },
      include: { stops: { orderBy: { stopSequence: "asc" } } },
    });
    if (!manifest) throw fail("Manifest not found.", "MANIFEST_NOT_FOUND", 404);
    if (!["PREPARING", "ASSIGNED"].includes(manifest.status)) throw fail("Manifest can no longer be reordered.", "MANIFEST_STATE_CONFLICT", 409);
    const currentStopIds = manifest.stops.map(({ id }) => id);
    if (expectedStopIds !== null && !sameSequence(expectedStopIds, currentStopIds)) {
      throw fail("The manifest order changed after this proposal. Refresh and review a new proposal.", "ROUTE_ORDER_CONFLICT", 409);
    }
    if (optimizationSource && !Array.isArray(expectedStopIds)) {
      throw fail("The expected manifest order is required to apply a route proposal.");
    }
    if (!Array.isArray(orderedStopIds) || orderedStopIds.length !== manifest.stops.length ||
        new Set(orderedStopIds).size !== orderedStopIds.length ||
        orderedStopIds.some((id) => !manifest.stops.some((stop) => stop.id === id))) {
      throw fail("Provide every manifest stop exactly once.");
    }
    if (optimizationSource !== null && optimizationSource !== "DETERMINISTIC_FALLBACK") {
      throw fail("The route proposal source is invalid.");
    }
    if (optimizationSource) {
      const suggestion = await buildRoadRouteSuggestion({
        stops: manifest.stops,
        fallbackOrder: deterministicRouteSequence,
      });
      if (!sameSequence(orderedStopIds, suggestion.orderedStopIds)) {
        throw fail("The route proposal is stale or invalid. Request a new proposal.", "ROUTE_PROPOSAL_STALE", 409);
      }
    }
    for (let index = 0; index < orderedStopIds.length; index += 1) {
      await tx.deliveryManifestStop.update({
        where: { id: orderedStopIds[index] },
        data: { stopSequence: index + 1 },
      });
    }
    const existingSnapshot = manifest.optimizationSnapshot &&
      typeof manifest.optimizationSnapshot === "object" &&
      !Array.isArray(manifest.optimizationSnapshot)
      ? manifest.optimizationSnapshot
      : {};
    await tx.deliveryRouteManifest.update({
      where: { id: manifest.id },
      data: {
        optimizationSnapshot: {
          ...existingSnapshot,
          lastAppliedOrdering: {
            source: optimizationSource || "MANUAL",
            externalRouting: false,
            appliedAt: new Date().toISOString(),
          },
        },
      },
    });
    return tx.deliveryRouteManifest.findUnique({
      where: { id: manifest.id },
      include: { stops: { orderBy: { stopSequence: "asc" }, include: { proof: true } }, driver: true },
    });
  }, { isolationLevel: "Serializable" });

export const assignRouteManifest = async ({ distributorId, manifestId, driverId, actorAccountId, client }) =>
  client.$transaction(async (tx) => {
    const manifest = await tx.deliveryRouteManifest.findFirst({ where: { id: manifestId, distributorId } });
    if (!manifest) throw fail("Manifest not found.", "MANIFEST_NOT_FOUND", 404);
    if (!["PREPARING", "ASSIGNED"].includes(manifest.status)) throw fail("Manifest has already been dispatched.", "MANIFEST_STATE_CONFLICT", 409);
    const driver = await tx.deliveryDriver.findFirst({ where: { id: driverId, distributorId, status: "ACTIVE" } });
    if (!driver) throw fail("Active driver not found.", "DRIVER_NOT_FOUND", 404);
    const updated = await tx.deliveryRouteManifest.update({
      where: { id: manifest.id },
      data: { driverId: driver.id, status: "ASSIGNED" },
    });
    await recordSystemAudit(
      { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
      {
        action: "DELIVERY_MANIFEST_ASSIGNED",
        entityType: "DeliveryRouteManifest",
        entityId: manifest.id,
        beforeState: { status: manifest.status, driverId: manifest.driverId },
        afterState: { status: "ASSIGNED", driverId: driver.id },
      },
      { client: tx },
    );
    return updated;
  }, { isolationLevel: "Serializable" });

export const dispatchRouteManifest = async ({ distributorId, manifestId, actorAccountId, client }) =>
  client.$transaction(async (tx) => {
    const manifest = await tx.deliveryRouteManifest.findFirst({
      where: { id: manifestId, distributorId },
      include: { stops: true, driver: true },
    });
    if (!manifest) throw fail("Manifest not found.", "MANIFEST_NOT_FOUND", 404);
    if (!manifest.driverId || !manifest.driver) throw fail("Assign an active driver before dispatch.", "MANIFEST_DRIVER_REQUIRED", 409);
    if (manifest.status === "IN_TRANSIT") return manifest;
    if (manifest.status !== "ASSIGNED") throw fail("Only assigned manifests can be dispatched.", "MANIFEST_STATE_CONFLICT", 409);
    const now = new Date();
    const updated = await tx.deliveryRouteManifest.update({
      where: { id: manifest.id },
      data: { status: "IN_TRANSIT", dispatchedAt: now },
    });
    await tx.deliveryManifestStop.updateMany({
      where: { manifestId: manifest.id, status: "PENDING" },
      data: { status: "IN_TRANSIT", dispatchedAt: now },
    });
    await recordSystemAudit(
      { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
      {
        action: "DELIVERY_MANIFEST_DISPATCHED",
        entityType: "DeliveryRouteManifest",
        entityId: manifest.id,
        beforeState: { status: manifest.status },
        afterState: { status: "IN_TRANSIT", dispatchedAt: now },
      },
      { client: tx },
    );
    return updated;
  }, { isolationLevel: "Serializable" });

export const completeRouteStop = async ({
  distributorId,
  manifestId,
  stopId,
  actorAccountId,
  body,
  photoPath = null,
  signaturePath = null,
  client,
  executeInTransaction = false,
}) => {
  const execute = async (tx) => {
  const stop = await tx.deliveryManifestStop.findFirst({
    where: { id: stopId, manifestId, manifest: { distributorId } },
    include: { manifest: true, proof: true },
  });
  if (!stop) throw fail("Manifest stop not found.", "STOP_NOT_FOUND", 404);
  if (stop.proof) return { ...stop.proof, _replayed: true };
  const outcome = String(body.outcome || "").trim().toUpperCase();
  if (!["DELIVERED", "PARTIAL", "FAILED"].includes(outcome)) throw fail("Outcome must be DELIVERED, PARTIAL, or FAILED.");
  const recipientName = clean(body.recipientName, 191);
  if (!recipientName) throw fail("Recipient name is required.");
  let latitude = null;
  let longitude = null;
  if (body.latitude !== undefined && body.latitude !== null && body.latitude !== "") {
    latitude = new Prisma.Decimal(String(body.latitude));
    if (latitude.lt(-90) || latitude.gt(90)) throw fail("Latitude is invalid.");
  }
  if (body.longitude !== undefined && body.longitude !== null && body.longitude !== "") {
    longitude = new Prisma.Decimal(String(body.longitude));
    if (longitude.lt(-180) || longitude.gt(180)) throw fail("Longitude is invalid.");
  }
  if (outcome === "DELIVERED" && !photoPath && !signaturePath) {
    throw fail("Delivered outcome requires signature or photograph evidence.", "POD_EVIDENCE_REQUIRED", 409);
  }
  if (outcome === "PARTIAL") {
    const partialQuantity = positiveQuantity(body.partialQuantity);
    if (partialQuantity >= stop.parcelCount) throw fail("Partial quantity must be less than the parcel count.");
  }
  if (outcome === "FAILED" && !clean(body.failedReason || "", 191)) throw fail("Failed delivery reason is required.");

  if (!stop.assignmentId) {
    throw fail("The manifest stop is not linked to a valid order assignment.", "POD_ASSIGNMENT_REQUIRED", 409);
  }
  const assignment = await tx.orderAssignment.findFirst({
    where: { id: stop.assignmentId, distributorId },
  });
  if (!assignment || String(assignment.deliveryType || "SELF_DELIVERY").toUpperCase() !== "SELF_DELIVERY") {
    throw fail("Proof of delivery is available only for a distributor self-delivery assignment.", "POD_ASSIGNMENT_INVALID", 409);
  }

  if (outcome === "DELIVERED") {
    const deliveryResult = await updateSelfDeliveryStatus({
      distributorId,
      assignmentIdOrOrderId: assignment.id,
      status: "Delivered",
      otpCode: body.otpCode || null,
      collectionConfirmed: body.collectionConfirmed === true || body.collectionConfirmed === "true",
      paymentMethod: clean(body.paymentMethod || "CASH", 32),
      notes: clean(body.notes || "", 4000) || null,
      actorContext: {
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        correlationId: body.correlationId || null,
      },
      client: tx,
      executeInTransaction: true,
    });
    if (deliveryResult?.deliveryOtpError) throw deliveryResult.deliveryOtpError;
  } else if (outcome === "PARTIAL") {
    const normalizedStatus = String(assignment.status || "").trim().toLowerCase();
    if (!["delivered", "on_the_way", "out_for_delivery"].includes(normalizedStatus)) {
      await updateSelfDeliveryStatus({
        distributorId,
        assignmentIdOrOrderId: assignment.id,
        status: "On the Way",
        notes: clean(body.notes || "", 4000) || null,
        actorContext: { actorId: actorAccountId, actorRole: "DISTRIBUTOR" },
        client: tx,
        executeInTransaction: true,
      });
    }
  }

  const idempotencyKey = clean(body.idempotencyKey || "", 191) || `pod:${stop.id}:${hashPayload({
    outcome,
    recipientName,
    deviceTimestamp: body.deviceTimestamp || null,
    photoPath,
    signaturePath,
    evidenceDigest: body.evidenceDigest || null,
  })}`;
  const existing = await tx.deliveryProofOfDelivery.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.stopId !== stop.id ||
        existing.outcome !== outcome ||
        existing.recipientName !== recipientName ||
        existing.photoPath !== photoPath ||
        existing.signaturePath !== signaturePath) {
      throw fail("Proof-of-delivery idempotency key was reused with conflicting details.", "POD_IDEMPOTENCY_CONFLICT", 409);
    }
    return { ...existing, _replayed: true };
  }

  const proof = await tx.deliveryProofOfDelivery.create({
    data: {
      stopId: stop.id,
      outcome,
      recipientName,
      signaturePath,
      photoPath,
      latitude,
      longitude,
      deviceTimestamp: body.deviceTimestamp ? new Date(body.deviceTimestamp) : null,
      notes: clean(body.notes || "", 4000) || null,
      failedReason: outcome === "FAILED" ? clean(body.failedReason, 191) : null,
      partialQuantity: outcome === "PARTIAL" ? positiveQuantity(body.partialQuantity) : null,
      idempotencyKey,
      actorAccountId,
    },
  });
  await tx.deliveryManifestStop.update({
    where: { id: stop.id },
    data: { status: outcome, completedAt: new Date() },
  });
  await recordSystemAudit(
    { actorId: actorAccountId, actorRole: "DISTRIBUTOR", portalSource: "DISTRIBUTOR" },
    {
      action: "DELIVERY_STOP_COMPLETED",
      entityType: "DeliveryManifestStop",
      entityId: stop.id,
      beforeState: { status: stop.status },
      afterState: { status: outcome, hasPhoto: Boolean(photoPath), hasSignature: Boolean(signaturePath) },
    },
    { client: tx },
  );
  const remaining = await tx.deliveryManifestStop.count({
    where: { manifestId: manifestId, status: { in: ["PENDING", "IN_TRANSIT"] } },
  });
  if (remaining === 0) {
    await tx.deliveryRouteManifest.update({
      where: { id: manifestId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
  return proof;
  };
  return executeInTransaction
    ? execute(client)
    : client.$transaction(execute, { isolationLevel: "Serializable" });
};

export const dispatchPeerStockTransfer = async ({
  distributorId,
  transferId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const transfer = await tx.stockTransfer.findUnique({
    where: { id: transferId },
    include: { lines: true, shipments: true },
  });
  if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
  if (transfer.sourceDistributorId !== distributorId) throw fail("Only the source distributor can dispatch this transfer.", "FORBIDDEN_PEER_TRANSFER", 403);
  if (transfer.status !== "APPROVED") throw fail("Both peer distributors must approve before dispatch.", "PEER_TRANSFER_NOT_APPROVED", 409);
  if (transfer.shipments.length > 0) throw fail("This peer transfer has already been dispatched.", "PEER_TRANSFER_ALREADY_DISPATCHED", 409);
  const transitLocation = await ensureInventoryLocation(tx, {
    kind: "IN_TRANSIT",
    referenceId: transfer.id,
    name: `Peer transfer ${transfer.id.slice(-8)} transit`,
  });
  const now = new Date();
  const shipment = await tx.stockTransferShipment.create({
    data: {
      stockTransferId: transfer.id,
      status: "DISPATCHED",
      bookingMode: "MANUAL",
      deliveryPartner: clean(body.deliveryPartner || "MANUAL", 191),
      trackingNumber: clean(body.trackingNumber || "", 191) || null,
      externalReference: clean(body.externalReference || "", 191) || null,
      dispatchedAt: now,
      lines: {
        create: transfer.lines.map((line) => ({
          stockTransferLineId: line.id,
          quantity: line.approvedQuantity || line.requestedQuantity,
        })),
      },
    },
  });
  for (const line of transfer.lines) {
    const quantity = line.approvedQuantity || line.requestedQuantity;
    const balance = await tx.inventoryBalance.findFirst({
      where: { locationId: transfer.sourceLocationId, inventorySkuId: line.inventorySkuId },
    });
    if (!balance || balance.quantityOnHand - balance.reservedQuantity < quantity) {
      throw fail("Source stock changed during peer transfer dispatch.", "PEER_STOCK_INSUFFICIENT", 409);
    }
    const shipmentLine = await tx.stockTransferShipmentLine.findFirst({
      where: { shipmentId: shipment.id, stockTransferLineId: line.id },
    });
    if (!shipmentLine) throw fail("Peer shipment line was not created.", "PEER_SHIPMENT_LINE_MISSING", 500);
    const costLayers = await tx.manufacturerInventoryCostLayer.findMany({
      where: { inventorySkuId: line.inventorySkuId, availableQuantity: { gt: 0 } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, availableQuantity: true },
    });
    const costPlan = planCostLayerAllocations(costLayers, quantity);
    await tx.stockTransferShipmentLine.update({
      where: { id: shipmentLine.id },
      data: { uncostedQuantity: costPlan.uncostedQuantity },
    });
    for (const allocation of costPlan.allocations) {
      const costLayer = costLayers.find((item) => item.id === allocation.costLayerId);
      if (!costLayer) throw fail("Peer cost-layer allocation is invalid.", "PEER_COST_LAYER_INVALID", 409);
      const claimed = await tx.manufacturerInventoryCostLayer.updateMany({
        where: { id: costLayer.id, availableQuantity: costLayer.availableQuantity },
        data: { availableQuantity: { decrement: allocation.quantity } },
      });
      if (claimed.count !== 1) throw fail("Peer cost layer changed concurrently.", "PEER_COST_LAYER_CONFLICT", 409);
      await tx.stockTransferShipmentLineCostLayer.create({
        data: {
          shipmentLineId: shipmentLine.id,
          costLayerId: costLayer.id,
          quantity: allocation.quantity,
          status: "DISPATCHED",
        },
      });
    }
    for (const allocation of costPlan.allocations) {
      await applyInventoryMovement(tx, {
        inventorySkuId: line.inventorySkuId,
        sourceLocationId: transfer.sourceLocationId,
        destinationLocationId: transitLocation.id,
        quantity: allocation.quantity,
        movementType: "TRANSFER_DISPATCH",
        referenceType: "PEER_STOCK_TRANSFER",
        referenceId: transfer.id,
        idempotencyKey: `peer-transfer:${transfer.id}:${line.id}:dispatch:${allocation.costLayerId}`,
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        reason: "Peer-distributor cost-layer stock dispatched to transit custody.",
        productionCostLayerId: allocation.costLayerId,
      });
    }
    if (costPlan.uncostedQuantity > 0) {
      await applyInventoryMovement(tx, {
        inventorySkuId: line.inventorySkuId,
        sourceLocationId: transfer.sourceLocationId,
        destinationLocationId: transitLocation.id,
        quantity: costPlan.uncostedQuantity,
        movementType: "TRANSFER_DISPATCH",
        referenceType: "PEER_STOCK_TRANSFER",
        referenceId: transfer.id,
        idempotencyKey: `peer-transfer:${transfer.id}:${line.id}:dispatch:uncosted`,
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        reason: "Peer-distributor uncosted legacy stock dispatched to transit custody.",
      });
    }
  }
  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "IN_TRANSIT", dispatchedAt: now },
  });
  await tx.peerStockTransferCustodyEvent.create({
    data: {
      stockTransferId: transfer.id,
      distributorId,
      eventType: "DISPATCHED",
      custodyStage: "IN_TRANSIT",
      responsibilityParty: "SOURCE_DISTRIBUTOR",
      idempotencyKey: `peer:${transfer.id}:dispatched`,
      actorAccountId,
    },
  });
  return shipment;
}, { isolationLevel: "Serializable" });

export const receivePeerStockTransfer = async ({
  distributorId,
  transferId,
  shipmentId,
  actorAccountId,
  body,
  client,
}) => client.$transaction(async (tx) => {
  const transfer = await tx.stockTransfer.findUnique({
    where: { id: transferId },
    include: {
      lines: { include: { inventorySku: true } },
      shipments: { include: { lines: { include: { costLayerAllocations: true } } } },
    },
  });
  if (!transfer || transfer.transferKind !== "PEER_DISTRIBUTOR") throw fail("Peer stock transfer not found.", "PEER_TRANSFER_NOT_FOUND", 404);
  if (transfer.distributorId !== distributorId) throw fail("Only the receiving distributor can record receipt.", "FORBIDDEN_PEER_TRANSFER", 403);
  const shipment = transfer.shipments.find((item) => item.id === shipmentId);
  if (!shipment || !["DISPATCHED", "PARTIALLY_RECEIVED"].includes(shipment.status)) {
    throw fail("Only dispatched peer shipments can be received.", "PEER_RECEIPT_STATE_CONFLICT", 409);
  }
  if (!Array.isArray(body.lines) || body.lines.length < 1) throw fail("Receipt lines are required.");
  const destinationLocation = await tx.inventoryLocation.findFirst({
    where: { id: transfer.destinationLocationId, distributorId, kind: "DISTRIBUTOR", inventoryOwner: "PLATFORM", isActive: true },
  });
  if (!destinationLocation) throw fail("Receiving inventory location is invalid.", "PEER_DESTINATION_INVALID", 409);
  const transitLocation = await tx.inventoryLocation.findFirst({
    where: { kind: "IN_TRANSIT", referenceId: transfer.id, isActive: true },
  });
  if (!transitLocation) throw fail("Peer transit custody location is missing.", "PEER_TRANSIT_NOT_FOUND", 409);
  const damagedLocation = await ensureInventoryLocation(tx, { kind: "DAMAGED", distributorId, name: `Damaged stock ${distributorId.slice(-8)}` });
  const lostLocation = await ensureInventoryLocation(tx, { kind: "LOST", distributorId, name: `Lost stock ${distributorId.slice(-8)}` });
  const receiptIdentity = clean(body.idempotencyKey || body.receiptIdentity || "", 191);
  if (!receiptIdentity) {
    throw fail("An Idempotency-Key is required for peer stock receipt.", "PEER_RECEIPT_IDEMPOTENCY_REQUIRED", 400);
  }
  const normalizedReceiptLines = body.lines.map((line) => ({
    shipmentLineId: line.shipmentLineId,
    goodQuantity: Number(line.goodQuantity || 0),
    damagedQuantity: Number(line.damagedQuantity || 0),
    missingQuantity: Number(line.missingQuantity || 0),
    damageType: line.damagedQuantity > 0 ? clean(line.damageType || "OTHER_DAMAGE", 120) : null,
    evidence: line.evidence ? JSON.parse(JSON.stringify(line.evidence)) : null,
    note: clean(line.note || "", 4000) || null,
  }));
  const receiptRequestHash = hashPayload(normalizedReceiptLines);
  const fullReceiptKey = `${shipment.id}:${receiptIdentity}`;
  const receiptExisting = await tx.stockTransferReceipt.findUnique({ where: { idempotencyKey: fullReceiptKey } });
  if (receiptExisting) {
    if (receiptExisting.requestHash !== receiptRequestHash) {
      throw fail("Peer receipt idempotency key was reused for conflicting quantities.", "PEER_RECEIPT_IDEMPOTENCY_CONFLICT", 409);
    }
    return receiptExisting;
  }
  const receipt = await tx.stockTransferReceipt.create({
    data: {
      shipmentId: shipment.id,
      idempotencyKey: fullReceiptKey,
      requestHash: receiptRequestHash,
      status: "CONFIRMED",
      receivedBy: actorAccountId,
      notes: clean(body.notes || "", 4000) || null,
    },
  });
  let totalAccounted = 0;
  let hasDiscrepancy = false;
  for (const input of body.lines) {
    const shipmentLine = shipment.lines.find((line) => line.id === input.shipmentLineId);
    if (!shipmentLine) throw fail("Receipt line does not belong to this shipment.", "PEER_RECEIPT_LINE_INVALID", 409);
    const transferLine = transfer.lines.find((line) => line.id === shipmentLine.stockTransferLineId);
    if (!transferLine) throw fail("Receipt SKU line is missing.", "PEER_RECEIPT_LINE_INVALID", 409);
    const good = Number(input.goodQuantity || 0);
    const damaged = Number(input.damagedQuantity || 0);
    const missing = Number(input.missingQuantity || 0);
    if (![good, damaged, missing].every((quantity) => Number.isSafeInteger(quantity) && quantity >= 0)) {
      throw fail("Peer receipt quantities must be non-negative whole numbers.");
    }
    const prior = await tx.stockTransferReceiptLine.findMany({ where: { shipmentLineId: shipmentLine.id } });
    const previouslyReceived = prior.reduce((sum, line) => sum + line.goodQuantity + line.damagedQuantity + line.missingQuantity, 0);
    if (previouslyReceived + good + damaged + missing > shipmentLine.quantity) throw fail("Peer receipt exceeds shipped quantity.", "PEER_RECEIPT_OVER_DISPATCH", 409);
    if (good === 0 && damaged === 0 && missing === 0) throw fail("A receipt must account for at least one unit.");
    await tx.stockTransferReceiptLine.create({
      data: {
        receiptId: receipt.id,
        shipmentLineId: shipmentLine.id,
        goodQuantity: good,
        damagedQuantity: damaged,
        missingQuantity: missing,
        damageType: damaged > 0 ? clean(input.damageType || "OTHER_DAMAGE", 120) : null,
        evidence: input.evidence ? JSON.parse(JSON.stringify(input.evidence)) : undefined,
        note: clean(input.note || "", 4000) || null,
      },
    });
    if (good) {
      const previouslyAccounted = prior.reduce(
        (sum, line) => sum + line.goodQuantity + line.damagedQuantity + line.missingQuantity,
        0,
      );
      const costPlan = planReceivedCostLayerAllocations(
        shipmentLine.costLayerAllocations.map((allocation) => ({
          costLayerId: allocation.costLayerId,
          quantity: allocation.quantity,
        })),
        good,
        previouslyAccounted,
      );
      for (const allocation of costPlan.allocations) {
        await applyInventoryMovement(tx, {
          inventorySkuId: transferLine.inventorySkuId,
          sourceLocationId: transitLocation.id,
          destinationLocationId: destinationLocation.id,
          quantity: allocation.quantity,
          movementType: "TRANSFER_RECEIPT",
          referenceType: "PEER_STOCK_TRANSFER_RECEIPT",
          referenceId: receipt.id,
          idempotencyKey: `${receipt.id}:${shipmentLine.id}:good:${allocation.costLayerId}`,
          actorId: actorAccountId,
          actorRole: "DISTRIBUTOR",
          reason: "Accepted peer-distributor transfer stock received with cost provenance.",
          productionCostLayerId: allocation.costLayerId,
        });
      }
      if (costPlan.uncostedQuantity > 0) {
        await applyInventoryMovement(tx, {
          inventorySkuId: transferLine.inventorySkuId,
          sourceLocationId: transitLocation.id,
          destinationLocationId: destinationLocation.id,
          quantity: costPlan.uncostedQuantity,
          movementType: "TRANSFER_RECEIPT",
          referenceType: "PEER_STOCK_TRANSFER_RECEIPT",
          referenceId: receipt.id,
          idempotencyKey: `${receipt.id}:${shipmentLine.id}:good:uncosted`,
          actorId: actorAccountId,
          actorRole: "DISTRIBUTOR",
          reason: "Accepted peer-distributor uncosted legacy stock received.",
        });
      }
    }
    if (damaged) {
      await applyInventoryMovement(tx, {
        inventorySkuId: transferLine.inventorySkuId,
        sourceLocationId: transitLocation.id,
        destinationLocationId: damagedLocation.id,
        quantity: damaged,
        movementType: "DAMAGE",
        referenceType: "PEER_STOCK_TRANSFER_RECEIPT",
        referenceId: receipt.id,
        idempotencyKey: `${receipt.id}:${shipmentLine.id}:damaged`,
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        reason: "Damaged units reported on peer-distributor receipt.",
      });
    }
    if (missing) {
      await applyInventoryMovement(tx, {
        inventorySkuId: transferLine.inventorySkuId,
        sourceLocationId: transitLocation.id,
        destinationLocationId: lostLocation.id,
        quantity: missing,
        movementType: "LOSS",
        referenceType: "PEER_STOCK_TRANSFER_RECEIPT",
        referenceId: receipt.id,
        idempotencyKey: `${receipt.id}:${shipmentLine.id}:missing`,
        actorId: actorAccountId,
        actorRole: "DISTRIBUTOR",
        reason: "Missing units reported on peer-distributor receipt.",
      });
    }
    if (damaged || missing) {
      hasDiscrepancy = true;
      await tx.inventoryDiscrepancy.create({
        data: {
          stockTransferId: transfer.id,
          shipmentId: shipment.id,
          receiptId: receipt.id,
          distributorId,
          inventoryLocationId: destinationLocation.id,
          inventorySkuId: transferLine.inventorySkuId,
          discrepancyType: missing ? "SHORT_RECEIPT" : "DELIVERY_DAMAGE",
          custodyStage: "DESTINATION",
          quantity: damaged + missing,
          status: "OPEN",
          reportedBy: actorAccountId,
          reportedByRole: "DISTRIBUTOR",
          details: clean(input.note || "", 4000) || null,
        },
      });
    }
    totalAccounted += good + damaged + missing;
  }
  const receiptLines = await tx.stockTransferReceiptLine.findMany({ where: { receipt: { shipmentId: shipment.id } } });
  const dispatched = shipment.lines.reduce((sum, line) => sum + line.quantity, 0);
  const accounted = receiptLines.reduce((sum, line) => sum + line.goodQuantity + line.damagedQuantity + line.missingQuantity, 0);
  const nextShipmentStatus = accounted >= dispatched ? (hasDiscrepancy ? "DISCREPANCY" : "DELIVERED") : "PARTIALLY_RECEIVED";
  await tx.stockTransferShipment.update({
    where: { id: shipment.id },
    data: { status: nextShipmentStatus, deliveredAt: accounted >= dispatched ? new Date() : null },
  });
  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: accounted >= dispatched ? (hasDiscrepancy ? "DISCREPANCY" : "RECEIVED") : "PARTIALLY_RECEIVED", completedAt: accounted >= dispatched ? new Date() : null },
  });
  await tx.peerStockTransferCustodyEvent.create({
    data: {
      stockTransferId: transfer.id,
      distributorId,
      eventType: accounted >= dispatched ? "RECEIVED" : "PARTIAL_RECEIVED",
      custodyStage: "DESTINATION",
      responsibilityParty: "RECEIVING_DISTRIBUTOR",
      idempotencyKey: `peer:${transfer.id}:receipt:${receipt.id}`,
      actorAccountId,
    },
  });
  return receipt;
}, { isolationLevel: "Serializable" });
