import express from "express";
import {
  bookNcmStockTransfer,
  createStockTransferRequest,
  dispatchManualStockTransfer,
  getStockTransferCatalog,
  listAdminStockTransfers,
  listDistributorStockTransfers,
  listManufacturerStockTransfers,
  receiveStockTransferShipment,
  resolveNcmShipmentBooking,
  reviewStockTransferRequest,
} from "../controllers/stockTransferController.js";
import { authenticate, authorize, setDistributorContext, setManufacturerContext } from "../middleware/unifiedAuth.js";

const stockTransferRouter = express.Router();

stockTransferRouter.get(
  "/catalog",
  authenticate,
  authorize("transfer:distributor_request"),
  setDistributorContext,
  getStockTransferCatalog,
);
stockTransferRouter.post(
  "/requests",
  authenticate,
  authorize("transfer:distributor_request"),
  setDistributorContext,
  createStockTransferRequest,
);
stockTransferRouter.get(
  "/distributor",
  authenticate,
  authorize("transfer:distributor_read"),
  setDistributorContext,
  listDistributorStockTransfers,
);
stockTransferRouter.post(
  "/shipments/:shipmentId/receipt",
  authenticate,
  authorize("transfer:distributor_receive"),
  setDistributorContext,
  receiveStockTransferShipment,
);
stockTransferRouter.get(
  "/manufacturer",
  authenticate,
  authorize("transfer:manufacturer_read"),
  setManufacturerContext,
  listManufacturerStockTransfers,
);
stockTransferRouter.post(
  "/:id/dispatch",
  authenticate,
  authorize("transfer:manufacturer_dispatch"),
  setManufacturerContext,
  dispatchManualStockTransfer,
);
stockTransferRouter.post(
  "/:id/ncm-booking",
  authenticate,
  authorize("transfer:manufacturer_dispatch"),
  setManufacturerContext,
  bookNcmStockTransfer,
);
stockTransferRouter.get(
  "/admin",
  authenticate,
  authorize("transfer:admin_read"),
  listAdminStockTransfers,
);
stockTransferRouter.patch(
  "/admin/:id/review",
  authenticate,
  authorize("transfer:admin_review"),
  reviewStockTransferRequest,
);
stockTransferRouter.patch(
  "/admin/shipments/:shipmentId/ncm-resolution",
  authenticate,
  authorize("transfer:admin_review"),
  resolveNcmShipmentBooking,
);

export default stockTransferRouter;
