import express from "express";
import { getDriverManifests, getDriverProfile } from "../controllers/driverDeliveryController.js";
import {
  completeLogisticsStop,
  getLogisticsEvidence,
  syncOfflineLogisticsDraft,
} from "../controllers/distributorLogisticsController.js";
import { requestDistributorDeliveryOtp } from "../controllers/distributorDeliveryController.js";
import { authenticate, authorize, setDeliveryDriverContext } from "../middleware/unifiedAuth.js";
import { requireAssignedDriverStop } from "../middleware/driverLogisticsAuthorization.js";
import { secureEvidenceUpload } from "../middleware/secureUpload.js";

const driverRouter = express.Router();
const driverContext = [authenticate, setDeliveryDriverContext];

driverRouter.get("/profile", ...driverContext, authorize("driver:delivery_read"), getDriverProfile);
driverRouter.get("/manifests", ...driverContext, authorize("driver:delivery_read"), getDriverManifests);
driverRouter.post(
  "/manifests/:manifestId/stops/:stopId/delivery-otp",
  ...driverContext,
  authorize("driver:delivery_complete"),
  requireAssignedDriverStop(undefined, ["IN_TRANSIT"]),
  requestDistributorDeliveryOtp,
);
driverRouter.post(
  "/manifests/:manifestId/stops/:stopId/complete",
  ...driverContext,
  authorize("driver:delivery_complete"),
  requireAssignedDriverStop(),
  ...secureEvidenceUpload("photo"),
  completeLogisticsStop,
);
driverRouter.post(
  "/manifests/:manifestId/stops/:stopId/offline-sync",
  ...driverContext,
  authorize("driver:delivery_complete"),
  requireAssignedDriverStop(undefined, ["IN_TRANSIT", "COMPLETED"]),
  ...secureEvidenceUpload("photo"),
  syncOfflineLogisticsDraft,
);
driverRouter.get(
  "/manifests/:manifestId/stops/:stopId/evidence/:kind",
  ...driverContext,
  authorize("driver:delivery_read"),
  requireAssignedDriverStop(),
  getLogisticsEvidence,
);

export default driverRouter;
