import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachPeerTransferEvidence,
  listEligiblePeerDistributors,
  rejectPeerStockTransfer,
} from "../services/distributorLogisticsService.js";
import {
  validatePeerReceiptLine,
  validatePodForm,
} from "../../manufacturer/src/utils/distributorLogisticsValidation.js";

test("POD validation requires outcome evidence, partial quantities, failure reasons, and COD confirmation", () => {
  const delivered = {
    outcome: "DELIVERED",
    recipientName: "Recipient",
    parcelCount: 1,
    hasPhoto: false,
    hasSignature: false,
    isUnpaidCod: false,
  };
  assert.match(validatePodForm(delivered), /photo or recipient signature/);
  assert.equal(validatePodForm({ ...delivered, hasPhoto: true }), null);
  assert.match(validatePodForm({ ...delivered, outcome: "PARTIAL", partialQuantity: 1 }), /below the parcel count/);
  assert.match(validatePodForm({ ...delivered, outcome: "FAILED" }), /reason is required/);
  assert.match(validatePodForm({ ...delivered, isUnpaidCod: true, otpRequired: true, hasSignature: true }), /6-digit/);
  assert.equal(validatePodForm({
    ...delivered,
    isUnpaidCod: true,
    otpRequired: false,
    collectionConfirmed: true,
    hasSignature: true,
  }), null);
});

test("peer receipt quantity validation rejects empty, fractional, and over-dispatch counts", () => {
  assert.match(validatePeerReceiptLine({
    goodQuantity: 0, damagedQuantity: 0, missingQuantity: 0, remainingQuantity: 3,
  }), /at least one unit/);
  assert.match(validatePeerReceiptLine({
    goodQuantity: 1.5, damagedQuantity: 0, missingQuantity: 0, remainingQuantity: 3,
  }), /whole numbers/);
  assert.match(validatePeerReceiptLine({
    goodQuantity: 2, damagedQuantity: 1, missingQuantity: 1, remainingQuantity: 3,
  }), /exceed/);
  assert.equal(validatePeerReceiptLine({
    goodQuantity: 1, damagedQuantity: 1, missingQuantity: 1, remainingQuantity: 3,
  }), null);
});

test("eligible peer directory excludes the current distributor and requires an active platform stock location", async () => {
  let distributorQuery;
  const result = await listEligiblePeerDistributors({
    distributorId: "current",
    client: {
      distributor: {
        findMany: async (query) => {
          distributorQuery = query;
          return [
            { id: "current", name: "Current", phone: "private" },
            { id: "eligible", name: "Eligible", province: "P1", district: "D1" },
            { id: "no-location", name: "No location" },
          ];
        },
      },
      inventoryLocation: {
        findMany: async () => [{ distributorId: "eligible" }],
      },
    },
  });
  assert.equal(distributorQuery.where.id.not, "current");
  assert.equal(distributorQuery.where.status, "ACTIVE");
  assert.deepEqual(result, [{ id: "eligible", name: "Eligible", province: "P1", district: "D1" }]);
});

test("peer request rejection is source-only and records a custody event", async () => {
  const transfer = {
    id: "transfer-1",
    transferKind: "PEER_DISTRIBUTOR",
    sourceDistributorId: "source",
    distributorId: "receiver",
    status: "PENDING_SOURCE_APPROVAL",
  };
  const calls = { update: 0, event: 0 };
  const client = {
    $transaction: (callback) => callback({
      stockTransfer: {
        findUnique: async () => transfer,
        update: async ({ data }) => {
          calls.update += 1;
          return { ...transfer, ...data };
        },
      },
      peerStockTransferCustodyEvent: {
        findFirst: async () => null,
        create: async ({ data }) => {
          calls.event += 1;
          return data;
        },
      },
    }),
  };
  await assert.rejects(
    rejectPeerStockTransfer({ distributorId: "receiver", transferId: transfer.id, client }),
    (error) => error.code === "FORBIDDEN_PEER_TRANSFER",
  );
  assert.equal(calls.update, 0);
  const rejected = await rejectPeerStockTransfer({
    distributorId: "source",
    transferId: transfer.id,
    reason: "Unavailable",
    client,
  });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(calls.event, 1);
});

test("private transfer evidence requires a participant and validates the shipment line before recording", async () => {
  const transfer = {
    id: "transfer-2",
    transferKind: "PEER_DISTRIBUTOR",
    sourceDistributorId: "source",
    distributorId: "receiver",
    shipments: [{ lines: [{ id: "shipment-line-1" }] }],
  };
  let eventWrites = 0;
  const client = {
    $transaction: (callback) => callback({
      stockTransfer: { findUnique: async () => transfer },
      peerStockTransferCustodyEvent: {
        findUnique: async () => null,
        create: async ({ data }) => {
          eventWrites += 1;
          return { id: "event-1", ...data };
        },
      },
    }),
  };
  await assert.rejects(attachPeerTransferEvidence({
    distributorId: "other",
    transferId: transfer.id,
    body: { idempotencyKey: "key" },
    publicId: "private/public-id",
    client,
  }), (error) => error.code === "FORBIDDEN_PEER_TRANSFER");
  await assert.rejects(attachPeerTransferEvidence({
    distributorId: "receiver",
    transferId: transfer.id,
    body: { idempotencyKey: "key", shipmentLineId: "wrong-line" },
    publicId: "private/public-id",
    client,
  }), (error) => error.code === "PEER_EVIDENCE_LINE_INVALID");
  assert.equal(eventWrites, 0);
});

test("logistics UI routes retain authenticated permission and distributor context middleware", async () => {
  const routeSource = await readFile(new URL("../routes/distributorRoute.js", import.meta.url), "utf8");
  const controllerSource = await readFile(new URL("../controllers/distributorLogisticsController.js", import.meta.url), "utf8");
  assert.match(routeSource, /get\("\/peer-transfers\/eligible-distributors", authenticate, authorize\("transfer:distributor_read"\), setDistributorContext/);
  assert.match(routeSource, /post\("\/peer-transfers\/:transferId\/reject", authenticate, authorize\("transfer:distributor_request"\), setDistributorContext/);
  assert.match(routeSource, /post\("\/peer-transfers\/:transferId\/evidence", authenticate, authorize\("transfer:distributor_receive"\), setDistributorContext/);
  assert.match(routeSource, /get\("\/peer-transfers\/:transferId\/evidence\/:eventId", authenticate, authorize\("transfer:distributor_read"\), setDistributorContext/);
  assert.match(routeSource, /post\("\/logistics\/manifests\/:manifestId\/optimize", authenticate, authorize\("distributor:logistics_manage"\), setDistributorContext, previewLogisticsManifestOptimization\)/);
  assert.match(routeSource, /patch\("\/logistics\/manifests\/:manifestId\/optimize", authenticate, authorize\("distributor:logistics_manage"\), setDistributorContext, applyLogisticsManifestOptimization\)/);
  assert.match(controllerSource, /sourceDistributorId: req\.distributorId/);
  assert.match(controllerSource, /OR:\s*\[\s*\{ distributorId: req\.distributorId \},\s*\{ sourceDistributorId: req\.distributorId \}/);
});

test("route proposal UI labels deterministic ordering and preserves the current order until apply", async () => {
  const pageSource = await readFile(new URL("../../manufacturer/src/pages/DistributorLogistics.jsx", import.meta.url), "utf8");
  assert.match(pageSource, /proposal\.provenance !== "DETERMINISTIC_FALLBACK"/);
  assert.match(pageSource, /Review deterministic suggested order/);
  assert.match(pageSource, /not road-distance optimized/);
  assert.match(pageSource, /current manifest order remains unchanged unless you apply this proposal/);
  assert.doesNotMatch(pageSource, /Provider-generated|Estimated distance|Estimated travel/);
});

test("driver completion and private evidence routes retain driver and assigned-stop authorization", async () => {
  const routeSource = await readFile(new URL("../routes/driverRoute.js", import.meta.url), "utf8");
  const controllerSource = await readFile(new URL("../controllers/distributorLogisticsController.js", import.meta.url), "utf8");
  const driverPageSource = await readFile(new URL("../../manufacturer/src/pages/DriverDeliveries.jsx", import.meta.url), "utf8");
  assert.match(routeSource, /driverRouter\.get\("\/manifests", \.\.\.driverContext, authorize\("driver:delivery_read"\), getDriverManifests\)/);
  assert.match(routeSource, /"\/manifests\/:manifestId\/stops\/:stopId\/delivery-otp"[\s\S]*?authorize\("driver:delivery_complete"\)[\s\S]*?requireAssignedDriverStop\(undefined, \["IN_TRANSIT"\]\)/);
  assert.match(routeSource, /"\/manifests\/:manifestId\/stops\/:stopId\/complete"[\s\S]*?authorize\("driver:delivery_complete"\)[\s\S]*?requireAssignedDriverStop\(\)[\s\S]*?secureEvidenceUpload\("photo"\)[\s\S]*?completeLogisticsStop/);
  assert.match(routeSource, /"\/manifests\/:manifestId\/stops\/:stopId\/evidence\/:kind"[\s\S]*?authorize\("driver:delivery_read"\)[\s\S]*?requireAssignedDriverStop\(\)[\s\S]*?getLogisticsEvidence/);
  assert.match(controllerSource, /manifest:\s*\{\s*distributorId: req\.distributorId\s*\}/);
  assert.match(controllerSource, /uploadPrivateEvidenceImage/);
  assert.match(controllerSource, /uploadPrivateEvidenceDataUrl/);
  assert.match(controllerSource, /getPrivateEvidenceDownloadUrl\(publicId, kind\)/);
  assert.match(driverPageSource, /responseType: "blob"/);
  assert.match(driverPageSource, /buildPodSubmissionFingerprint/);
});
