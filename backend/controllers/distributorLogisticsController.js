import { prisma } from "../config/db.js";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  deletePrivateEvidenceImage,
  getPrivateEvidenceDownloadUrl,
  uploadPrivateEvidenceDataUrl,
  uploadPrivateEvidenceImage,
} from "../utils/evidenceImageUpload.js";
import {
  approvePeerStockTransfer,
  attachPeerTransferEvidence,
  assignRouteManifest,
  cancelPeerStockTransfer,
  completeRouteStop,
  createDeliveryDriver,
  createPeerStockTransfer,
  createRouteManifest,
  dispatchPeerStockTransfer,
  dispatchRouteManifest,
  disputePeerStockTransfer,
  getLogisticsAnalytics,
  listDeliveryDrivers,
  listRouteManifests,
  receivePeerStockTransfer,
  rejectPeerStockTransfer,
  reorderRouteManifest,
  listEligiblePeerDistributors,
  previewRouteManifestOptimization,
  syncOfflineDeliveryDraft,
  updateDeliveryDriver,
} from "../services/distributorLogisticsService.js";

const actor = (req) => req.auth?.accountId || req.auth?.profileId || null;
const respondError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : "The logistics operation could not be completed.",
  code: error.code || "LOGISTICS_OPERATION_FAILED",
});

export const listLogisticsDrivers = async (req, res) => {
  try {
    return res.json({ success: true, drivers: await listDeliveryDrivers({ distributorId: req.distributorId, client: prisma }) });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createLogisticsDriver = async (req, res) => {
  try {
    const driver = await createDeliveryDriver({ distributorId: req.distributorId, actorAccountId: actor(req), body: req.body, client: prisma });
    return res.status(201).json({ success: true, driver });
  } catch (error) {
    return respondError(res, error);
  }
};

export const updateLogisticsDriver = async (req, res) => {
  try {
    const driver = await updateDeliveryDriver({ distributorId: req.distributorId, driverId: req.params.driverId, body: req.body, client: prisma });
    return res.json({ success: true, driver });
  } catch (error) {
    return respondError(res, error);
  }
};

export const listLogisticsManifests = async (req, res) => {
  try {
    const manifests = await listRouteManifests({
      distributorId: req.distributorId,
      driverId: req.query.driverId || null,
      status: req.query.status ? String(req.query.status).toUpperCase() : null,
      client: prisma,
    });
    return res.json({ success: true, manifests });
  } catch (error) {
    return respondError(res, error);
  }
};

export const createLogisticsManifest = async (req, res) => {
  try {
    const manifest = await createRouteManifest({
      distributorId: req.distributorId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, manifest });
  } catch (error) {
    return respondError(res, error);
  }
};

export const reorderLogisticsManifest = async (req, res) => {
  try {
    const manifest = await reorderRouteManifest({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      orderedStopIds: req.body.orderedStopIds,
      client: prisma,
    });
    return res.json({ success: true, manifest });
  } catch (error) {
    return respondError(res, error);
  }
};

export const previewLogisticsManifestOptimization = async (req, res) => {
  try {
    const proposal = await previewRouteManifestOptimization({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      client: prisma,
    });
    return res.json({ success: true, proposal });
  } catch (error) {
    return respondError(res, error);
  }
};

export const applyLogisticsManifestOptimization = async (req, res) => {
  try {
    const manifest = await reorderRouteManifest({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      orderedStopIds: req.body.orderedStopIds,
      expectedStopIds: req.body.expectedStopIds,
      optimizationSource: "DETERMINISTIC_FALLBACK",
      client: prisma,
    });
    return res.json({ success: true, manifest });
  } catch (error) {
    return respondError(res, error);
  }
};

export const assignLogisticsManifest = async (req, res) => {
  try {
    const manifest = await assignRouteManifest({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      driverId: req.body.driverId,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, manifest });
  } catch (error) {
    return respondError(res, error);
  }
};

export const dispatchLogisticsManifest = async (req, res) => {
  try {
    const manifest = await dispatchRouteManifest({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, manifest });
  } catch (error) {
    return respondError(res, error);
  }
};

export const completeLogisticsStop = async (req, res) => {
  let photoPath = null;
  let signaturePath = null;
  let uploadedPhoto = null;
  let uploadedSignature = null;
  try {
    const evidenceDigests = [];
    if (req.file?.path) {
      evidenceDigests.push(crypto.createHash("sha256").update(await readFile(req.file.path)).digest("hex"));
      uploadedPhoto = await uploadPrivateEvidenceImage(req.file, `delivery-evidence/${req.distributorId}/photos`);
      photoPath = uploadedPhoto.public_id;
    }
    if (req.body.signatureData) {
      evidenceDigests.push(crypto.createHash("sha256").update(req.body.signatureData).digest("hex"));
      uploadedSignature = await uploadPrivateEvidenceDataUrl(
        req.body.signatureData,
        `delivery-evidence/${req.distributorId}/signatures`,
      );
      signaturePath = uploadedSignature.public_id;
    }
    req.body.evidenceDigest = evidenceDigests.length
      ? crypto.createHash("sha256").update(evidenceDigests.sort().join(":")).digest("hex")
      : null;
    const proof = await completeRouteStop({
      distributorId: req.distributorId,
      manifestId: req.params.manifestId,
      stopId: req.params.stopId,
      actorAccountId: actor(req),
      body: req.body,
      photoPath,
      signaturePath,
      client: prisma,
    });
    if (proof._replayed) {
      if (uploadedPhoto?.public_id) await deletePrivateEvidenceImage(uploadedPhoto.public_id);
      if (uploadedSignature?.public_id) await deletePrivateEvidenceImage(uploadedSignature.public_id);
    }
    return res.status(201).json({ success: true, proof });
  } catch (error) {
    if (error.code !== "OFFLINE_SYNC_CONFLICT") {
      if (uploadedPhoto?.public_id) await deletePrivateEvidenceImage(uploadedPhoto.public_id);
      if (uploadedSignature?.public_id) await deletePrivateEvidenceImage(uploadedSignature.public_id);
    }
    return respondError(res, error);
  }
};

export const syncOfflineLogisticsDraft = async (req, res) => {
  let uploadedPhoto = null;
  let uploadedSignature = null;
  let clientDraftId = "";
  let manifestId = "";
  let stopId = "";
  try {
    clientDraftId = String(req.body?.clientDraftId || "").trim();
    manifestId = String(req.params?.manifestId || req.body?.manifestId || "").trim();
    stopId = String(req.params?.stopId || req.body?.stopId || "").trim();
    let photoPath = null;
    let signaturePath = null;
    const evidenceDigests = [];
    if (req.file?.path) {
      evidenceDigests.push(crypto.createHash("sha256").update(await readFile(req.file.path)).digest("hex"));
    }
    if (req.body.signatureData) {
      evidenceDigests.push(crypto.createHash("sha256").update(req.body.signatureData).digest("hex"));
    }
    const evidenceDigest = evidenceDigests.length
      ? crypto.createHash("sha256").update(evidenceDigests.sort().join(":")).digest("hex")
      : null;
    const existing = clientDraftId
      ? await prisma.offlineDeliverySyncDraft.findUnique({ where: { clientDraftId } })
      : null;
    const existingSnapshot = existing?.payloadSnapshot || {};
    const sameStoredOperation = existing?.manifestId === manifestId &&
      existing?.stopId === stopId &&
      existingSnapshot.evidenceDigest === evidenceDigest;
    if (sameStoredOperation) {
      photoPath = existingSnapshot.photoPath || null;
      signaturePath = existingSnapshot.signaturePath || null;
    } else if (!existing) {
      if (req.file?.path) {
        uploadedPhoto = await uploadPrivateEvidenceImage(req.file, `delivery-evidence/${req.distributorId}/photos`);
        photoPath = uploadedPhoto.public_id;
      }
      if (req.body.signatureData) {
        uploadedSignature = await uploadPrivateEvidenceDataUrl(
          req.body.signatureData,
          `delivery-evidence/${req.distributorId}/signatures`,
        );
        signaturePath = uploadedSignature.public_id;
      }
    }
    req.body.manifestId = manifestId;
    req.body.stopId = stopId;
    req.body.evidenceDigest = evidenceDigest;
    const result = await syncOfflineDeliveryDraft({
      distributorId: req.distributorId,
      driverId: req.driverId || null,
      actorAccountId: actor(req),
      body: req.body,
      photoPath,
      signaturePath,
      client: prisma,
    });
    if (uploadedPhoto?.public_id && result.draft?.payloadSnapshot?.photoPath !== uploadedPhoto.public_id) {
      if (uploadedPhoto?.public_id) await deletePrivateEvidenceImage(uploadedPhoto.public_id);
      uploadedPhoto = null;
    }
    if (uploadedSignature?.public_id && result.draft?.payloadSnapshot?.signaturePath !== uploadedSignature.public_id) {
      if (uploadedSignature?.public_id) await deletePrivateEvidenceImage(uploadedSignature.public_id);
      uploadedSignature = null;
    }
    return res.status(200).json({
      success: true,
      status: result.status,
      replayed: result.replayed,
      reconciledAt: result.draft?.reconciledAt || null,
    });
  } catch (error) {
    if (uploadedPhoto?.public_id || uploadedSignature?.public_id) {
      let savedDraft = null;
      try {
        savedDraft = clientDraftId
          ? await prisma.offlineDeliverySyncDraft.findUnique({ where: { clientDraftId } })
          : null;
      } catch (lookupError) {
        console.error("Could not verify offline delivery evidence retention after sync failure.", lookupError);
      }
      const payload = savedDraft?.payloadSnapshot || {};
      if (uploadedPhoto?.public_id && payload.photoPath !== uploadedPhoto.public_id) {
        await deletePrivateEvidenceImage(uploadedPhoto.public_id);
      }
      if (uploadedSignature?.public_id && payload.signaturePath !== uploadedSignature.public_id) {
        await deletePrivateEvidenceImage(uploadedSignature.public_id);
      }
    }
    return respondError(res, error);
  }
};

export const createPeerTransfer = async (req, res) => {
  try {
    const transfer = await createPeerStockTransfer({
      requestingDistributorId: req.distributorId,
      sourceDistributorId: req.body.sourceDistributorId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getEligiblePeerDistributors = async (req, res) => {
  try {
    const distributors = await listEligiblePeerDistributors({
      distributorId: req.distributorId,
      client: prisma,
    });
    return res.json({ success: true, distributors });
  } catch (error) {
    return respondError(res, error);
  }
};

export const approvePeerTransfer = async (req, res) => {
  try {
    const transfer = await approvePeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      approval: String(req.body.approval || "").toUpperCase(),
      actorAccountId: actor(req),
      client: prisma,
    });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const rejectPeerTransfer = async (req, res) => {
  try {
    const transfer = await rejectPeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      actorAccountId: actor(req),
      reason: req.body.reason,
      client: prisma,
    });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const dispatchPeerTransfer = async (req, res) => {
  try {
    const shipment = await dispatchPeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.status(201).json({ success: true, shipment });
  } catch (error) {
    return respondError(res, error);
  }
};

export const receivePeerTransfer = async (req, res) => {
  try {
    const receipt = await receivePeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      shipmentId: req.params.shipmentId,
      actorAccountId: actor(req),
      body: {
        ...req.body,
        idempotencyKey: req.headers["idempotency-key"] || req.body.idempotencyKey,
      },
      client: prisma,
    });
    return res.status(201).json({ success: true, receipt });
  } catch (error) {
    return respondError(res, error);
  }
};

export const cancelPeerTransfer = async (req, res) => {
  try {
    const transfer = await cancelPeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      actorAccountId: actor(req),
      reason: req.body.reason,
      client: prisma,
    });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const disputePeerTransfer = async (req, res) => {
  try {
    const transfer = await disputePeerStockTransfer({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      actorAccountId: actor(req),
      body: req.body,
      client: prisma,
    });
    return res.json({ success: true, transfer });
  } catch (error) {
    return respondError(res, error);
  }
};

export const uploadPeerTransferEvidence = async (req, res) => {
  let uploadedEvidence = null;
  try {
    if (!req.file) {
      return respondError(res, Object.assign(new Error("A JPG or PNG evidence image is required."), {
        statusCode: 400,
        code: "EVIDENCE_IMAGE_REQUIRED",
      }));
    }
    uploadedEvidence = await uploadPrivateEvidenceImage(
      req.file,
      `peer-transfer-evidence/${req.distributorId}`,
    );
    const result = await attachPeerTransferEvidence({
      distributorId: req.distributorId,
      transferId: req.params.transferId,
      actorAccountId: actor(req),
      body: req.body,
      publicId: uploadedEvidence.public_id,
      client: prisma,
    });
    if (result.replayed) await deletePrivateEvidenceImage(uploadedEvidence.public_id);
    return res.status(201).json({
      success: true,
      event: {
        id: result.event.id,
        eventType: result.event.eventType,
        custodyStage: result.event.custodyStage,
        details: result.event.details,
        createdAt: result.event.createdAt,
      },
    });
  } catch (error) {
    if (uploadedEvidence?.public_id) {
      await deletePrivateEvidenceImage(uploadedEvidence.public_id);
    }
    return respondError(res, error);
  }
};

export const getPeerTransferEvidence = async (req, res) => {
  try {
    const event = await prisma.peerStockTransferCustodyEvent.findFirst({
      where: {
        id: req.params.eventId,
        stockTransferId: req.params.transferId,
        eventType: "EVIDENCE_ATTACHED",
        stockTransfer: {
          transferKind: "PEER_DISTRIBUTOR",
          OR: [
            { distributorId: req.distributorId },
            { sourceDistributorId: req.distributorId },
          ],
        },
      },
      select: { evidence: true },
    });
    const publicId = event?.evidence && typeof event.evidence === "object"
      ? event.evidence.publicId
      : null;
    if (!publicId) {
      return respondError(res, Object.assign(new Error("Transfer evidence not found."), {
        statusCode: 404,
        code: "PEER_EVIDENCE_NOT_FOUND",
      }));
    }
    const url = getPrivateEvidenceDownloadUrl(publicId, "photo");
    if (!url) {
      return respondError(res, Object.assign(new Error("The evidence URL could not be generated."), {
        statusCode: 502,
        code: "PEER_EVIDENCE_URL_FAILED",
      }));
    }
    return res.redirect(302, url);
  } catch (error) {
    return respondError(res, error);
  }
};

export const getLogisticsEvidence = async (req, res) => {
  try {
    const kind = String(req.params.kind || "").toLowerCase();
    if (!["photo", "signature"].includes(kind)) {
      return respondError(res, Object.assign(new Error("Invalid evidence type."), { statusCode: 400, code: "INVALID_EVIDENCE_TYPE" }));
    }
    const stop = await prisma.deliveryManifestStop.findFirst({
      where: {
        id: req.params.stopId,
        manifestId: req.params.manifestId,
        manifest: { distributorId: req.distributorId },
      },
      include: { proof: true },
    });
    if (!stop?.proof) {
      return respondError(res, Object.assign(new Error("Proof of delivery evidence not found."), { statusCode: 404, code: "POD_EVIDENCE_NOT_FOUND" }));
    }
    const publicId = kind === "photo" ? stop.proof.photoPath : stop.proof.signaturePath;
    if (!publicId) {
      return respondError(res, Object.assign(new Error("The requested evidence was not captured."), { statusCode: 404, code: "POD_EVIDENCE_NOT_CAPTURED" }));
    }
    const url = getPrivateEvidenceDownloadUrl(publicId, kind);
    if (!url) {
      return respondError(res, Object.assign(new Error("The evidence URL could not be generated."), { statusCode: 502, code: "POD_EVIDENCE_URL_FAILED" }));
    }
    return res.redirect(302, url);
  } catch (error) {
    return respondError(res, error);
  }
};

export const listPeerTransfers = async (req, res) => {
  try {
    const transfers = await prisma.stockTransfer.findMany({
      where: {
        transferKind: "PEER_DISTRIBUTOR",
        OR: [{ distributorId: req.distributorId }, { sourceDistributorId: req.distributorId }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sourceDistributor: { select: { id: true, name: true, province: true, district: true } },
        distributor: { select: { id: true, name: true, province: true, district: true } },
        lines: { include: { inventorySku: { include: { product: true } } } },
        shipments: { include: { lines: true, receipts: { include: { lines: true } }, discrepancies: true } },
        custodyEvents: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            eventType: true,
            custodyStage: true,
            responsibilityParty: true,
            details: true,
            createdAt: true,
            evidence: true,
          },
        },
        discrepancies: true,
      },
    });
    const safeTransfers = transfers.map((transfer) => ({
      ...transfer,
      custodyEvents: transfer.custodyEvents.map(({ evidence, ...event }) => ({
        ...event,
        hasEvidence: Boolean(evidence),
        evidenceEventId: evidence?.publicId ? event.id : evidence?.eventId || null,
        shipmentLineId: evidence?.shipmentLineId || null,
      })),
    }));
    return res.json({ success: true, transfers: safeTransfers });
  } catch (error) {
    return respondError(res, error);
  }
};

export const getDistributorLogisticsAnalytics = async (req, res) => {
  try {
    const analytics = await getLogisticsAnalytics({ distributorId: req.distributorId, client: prisma });
    return res.json({ success: true, analytics });
  } catch (error) {
    return respondError(res, error);
  }
};
