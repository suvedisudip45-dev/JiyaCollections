import express from "express";
import {
  getDistributorProfile,
  getDistributorPickupProfile,
  updateDistributorPickupProfile,
  toggleDistributorAvailability,
  listDistributorApplications,
  registerDistributor,
  reviewDistributorApplication,
} from "../controllers/distributorController.js";
import {
  decreaseDistributorInventory,
  getDistributorInventory,
  getDistributorInventorySkuDetails,
} from "../controllers/distributorInventoryController.js";
import {
  createDistributorDirectOrder,
  getDistributorDirectOrders,
  updateDistributorDirectOrderStatus,
} from "../controllers/distributorDirectOrderController.js";
import {
  createStockTransferRequest,
  editStockTransferRequest,
  receiveStockTransferForRequest,
} from "../controllers/stockTransferController.js";
import {
  getAssignedOrders,
  getDistributorNcmOrders,
  holdDistributorOrder,
  bookDistributorNcmOrders,
  selectDistributorSelfDelivery,
  bulkDispatchSelfDeliveryOrders,
  updateSelfDeliveryOrderStatus,
  requestDistributorDeliveryOtp,
  processDistributorOrderReturn,
} from "../controllers/distributorDeliveryController.js";
import {
  getDistributorStatement,
  getDistributorCashRemittances,
  submitDistributorSettlementRequestEvidence,
  acknowledgeDistributorSettlementRequest,
  listDistributorRates,
} from "../controllers/distributorFinanceController.js";
import {
  acceptDistributorPaperBillAllocationController,
  getDistributorPaperBillAllocations,
} from "../controllers/paperBillController.js";
import { authenticate, authorize, setDistributorContext } from "../middleware/unifiedAuth.js";
import { publicRegistrationRateLimit } from "../middleware/authRateLimit.js";
import { secureEvidenceUpload } from "../middleware/secureUpload.js";
import { requireDistributorInventoryLocation } from "../middleware/locationScope.js";
import {
  getProductAnalyticsLocations,
  getProductAnalyticsProducts,
  getProductAnalyticsSummary,
  getProductAnalyticsTimeline,
} from "../controllers/productSalesAnalyticsController.js";
import {
  createDistributorCycleCount,
  createDistributorPrePack,
  getDistributorBarcode,
  listDistributorCycleCounts,
  listDistributorPrePacks,
  recordDistributorWarehouseScan,
} from "../controllers/distributorWarehouseController.js";
import {
  approveWholesaleQuotation,
  cancelWholesaleQuotation,
  convertWholesaleQuotation,
  createWholesaleContractPrice,
  createWholesaleDealer,
  createWholesaleQuotation,
  createWholesaleTier,
  generateWholesaleInvoice,
  getWholesaleDealerDetail,
  getWholesaleDealerStatement,
  getWholesaleDocument,
  listWholesaleDealers,
  listWholesaleOrders,
  listWholesaleQuotations,
  listWholesalePricing,
  recordWholesaleDealerPayment,
  updateWholesaleDealer,
  updateWholesaleOrderStatus,
} from "../controllers/distributorWholesaleController.js";
import {
  assignLogisticsManifest,
  cancelPeerTransfer,
  completeLogisticsStop,
  createLogisticsDriver,
  createLogisticsManifest,
  createPeerTransfer,
  dispatchLogisticsManifest,
  dispatchPeerTransfer,
  disputePeerTransfer,
  applyLogisticsManifestOptimization,
  getDistributorLogisticsAnalytics,
  getEligiblePeerDistributors,
  getPeerTransferEvidence,
  listLogisticsDrivers,
  listLogisticsManifests,
  listPeerTransfers,
  previewLogisticsManifestOptimization,
  receivePeerTransfer,
  rejectPeerTransfer,
  reorderLogisticsManifest,
  syncOfflineLogisticsDraft,
  updateLogisticsDriver,
  approvePeerTransfer,
  getLogisticsEvidence,
  uploadPeerTransferEvidence,
} from "../controllers/distributorLogisticsController.js";
import {
  acknowledgeDistributorReconciliation,
  getDistributorReconciliation,
  runDistributorReconciliationNow,
} from "../controllers/distributorReconciliationController.js";
import {
  createDistributorReplenishmentDemand,
  generateDistributorReplenishmentSuggestion,
  getDistributorForecast,
  getDistributorMonthlyStatement,
  getDistributorProfitability,
  getDistributorReplenishment,
  getDistributorVelocity,
  listDistributorReplenishmentHistory,
  saveDistributorInventoryPolicies,
} from "../controllers/distributorIntelligenceController.js";

const distributorRouter = express.Router();

distributorRouter.get(
  "/paper-bills/allocations",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorPaperBillAllocations,
);
distributorRouter.post(
  "/paper-bills/allocations/:id/accept",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  acceptDistributorPaperBillAllocationController,
);

distributorRouter.get(
  "/finance/remittances",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorCashRemittances,
);
distributorRouter.post(
  "/finance/settlement-requests/:requestId/evidence",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  ...secureEvidenceUpload("evidence"),
  submitDistributorSettlementRequestEvidence,
);
distributorRouter.post(
  "/finance/settlement-requests/:requestId/acknowledge",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  acknowledgeDistributorSettlementRequest,
);
distributorRouter.get("/register", publicRegistrationRateLimit, registerDistributor);

// Read-only product sales analytics are scoped by the authenticated distributor profile.
distributorRouter.get(
  "/product-analytics/summary",
  authenticate,
  authorize("distributor:product_sales_read"),
  setDistributorContext,
  getProductAnalyticsSummary,
);
distributorRouter.get(
  "/product-analytics/products",
  authenticate,
  authorize("distributor:product_sales_read"),
  setDistributorContext,
  getProductAnalyticsProducts,
);
distributorRouter.get(
  "/product-analytics/locations",
  authenticate,
  authorize("distributor:product_sales_read"),
  setDistributorContext,
  getProductAnalyticsLocations,
);
distributorRouter.get(
  "/product-analytics/timeline",
  authenticate,
  authorize("distributor:product_sales_read"),
  setDistributorContext,
  getProductAnalyticsTimeline,
);

// Stock & Inventory
distributorRouter.post(
  "/stock-requests",
  authenticate,
  authorize("transfer:distributor_request"),
  setDistributorContext,
  createStockTransferRequest,
);
distributorRouter.patch(
  "/stock-requests/:id",
  authenticate,
  authorize("transfer:distributor_request"),
  setDistributorContext,
  editStockTransferRequest,
);
distributorRouter.post(
  "/stock-requests/:id/receive",
  authenticate,
  authorize("transfer:distributor_receive"),
  setDistributorContext,
  receiveStockTransferForRequest,
);
distributorRouter.post(
  "/inventory/decrease",
  authenticate,
  authorize("distributor:inventory_decrease"),
  setDistributorContext,
  requireDistributorInventoryLocation,
  decreaseDistributorInventory,
);
distributorRouter.get(
  "/inventory/:inventorySkuId/details",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  getDistributorInventorySkuDetails,
);
distributorRouter.get(
  "/inventory",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  getDistributorInventory,
);
distributorRouter.get(
  "/inventory/barcode/:code",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  getDistributorBarcode,
);
distributorRouter.get(
  "/warehouse/pre-packs",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  listDistributorPrePacks,
);
distributorRouter.post(
  "/warehouse/pre-packs",
  authenticate,
  authorize("distributor:inventory_decrease"),
  setDistributorContext,
  createDistributorPrePack,
);
distributorRouter.post(
  "/warehouse/scans",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  recordDistributorWarehouseScan,
);
distributorRouter.get(
  "/warehouse/cycle-counts",
  authenticate,
  authorize("distributor:inventory_read"),
  setDistributorContext,
  listDistributorCycleCounts,
);
distributorRouter.post(
  "/warehouse/cycle-counts",
  authenticate,
  authorize("distributor:inventory_decrease"),
  setDistributorContext,
  createDistributorCycleCount,
);

// Distributor intelligence and replenishment
distributorRouter.get("/intelligence/velocity", authenticate, authorize("distributor:product_sales_read"), setDistributorContext, getDistributorVelocity);
distributorRouter.get("/intelligence/replenishment", authenticate, authorize("distributor:inventory_read"), setDistributorContext, getDistributorReplenishment);
distributorRouter.patch("/intelligence/replenishment/policies", authenticate, authorize("distributor:inventory_decrease"), setDistributorContext, saveDistributorInventoryPolicies);
distributorRouter.post("/intelligence/replenishment/:inventorySkuId/suggest", authenticate, authorize("distributor:inventory_read"), setDistributorContext, generateDistributorReplenishmentSuggestion);
distributorRouter.get("/intelligence/replenishment/history", authenticate, authorize("distributor:inventory_read"), setDistributorContext, listDistributorReplenishmentHistory);
distributorRouter.post("/intelligence/replenishment/:suggestionId/create-demand", authenticate, authorize("transfer:distributor_request"), setDistributorContext, createDistributorReplenishmentDemand);
distributorRouter.get("/intelligence/profitability", authenticate, authorize("distributor:finance_dashboard"), setDistributorContext, getDistributorProfitability);
distributorRouter.get("/intelligence/forecast", authenticate, authorize("distributor:product_sales_read"), setDistributorContext, getDistributorForecast);
distributorRouter.get("/intelligence/statement/monthly", authenticate, authorize("distributor:finance_dashboard"), setDistributorContext, getDistributorMonthlyStatement);
distributorRouter.get(
  "/orders/direct",
  authenticate,
  authorize("distributor:direct_order_read"),
  setDistributorContext,
  getDistributorDirectOrders,
);
distributorRouter.post(
  "/orders/direct",
  authenticate,
  authorize("distributor:direct_order_create"),
  setDistributorContext,
  createDistributorDirectOrder,
);
distributorRouter.patch(
  "/orders/direct/status",
  authenticate,
  authorize("distributor:direct_order_status_update"),
  setDistributorContext,
  updateDistributorDirectOrderStatus,
);

// Phase 3 route manifests, proof of delivery, offline sync, and peer stock custody
distributorRouter.get(
  "/operations/reconciliation",
  authenticate,
  authorize("distributor:operations_read"),
  setDistributorContext,
  getDistributorReconciliation,
);
distributorRouter.post(
  "/operations/reconciliation/runs",
  authenticate,
  authorize("distributor:operations_run"),
  setDistributorContext,
  runDistributorReconciliationNow,
);
distributorRouter.post(
  "/operations/reconciliation/findings/:findingId/acknowledge",
  authenticate,
  authorize("distributor:operations_acknowledge"),
  setDistributorContext,
  acknowledgeDistributorReconciliation,
);

distributorRouter.get("/logistics/drivers", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, listLogisticsDrivers);
distributorRouter.post("/logistics/drivers", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, createLogisticsDriver);
distributorRouter.patch("/logistics/drivers/:driverId", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, updateLogisticsDriver);
distributorRouter.get("/logistics/manifests", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, listLogisticsManifests);
distributorRouter.post("/logistics/manifests", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, createLogisticsManifest);
distributorRouter.patch("/logistics/manifests/:manifestId/reorder", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, reorderLogisticsManifest);
distributorRouter.post("/logistics/manifests/:manifestId/optimize", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, previewLogisticsManifestOptimization);
distributorRouter.patch("/logistics/manifests/:manifestId/optimize", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, applyLogisticsManifestOptimization);
distributorRouter.post("/logistics/manifests/:manifestId/assign", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, assignLogisticsManifest);
distributorRouter.post("/logistics/manifests/:manifestId/dispatch", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, dispatchLogisticsManifest);
distributorRouter.post(
  "/logistics/manifests/:manifestId/stops/:stopId/complete",
  authenticate,
  authorize("distributor:logistics_manage"),
  setDistributorContext,
  ...secureEvidenceUpload("photo"),
  completeLogisticsStop,
);
distributorRouter.get(
  "/logistics/manifests/:manifestId/stops/:stopId/evidence/:kind",
  authenticate,
  authorize("distributor:logistics_manage"),
  setDistributorContext,
  getLogisticsEvidence,
);
distributorRouter.post(
  "/logistics/offline-sync",
  authenticate,
  authorize("distributor:logistics_manage"),
  setDistributorContext,
  ...secureEvidenceUpload("photo"),
  syncOfflineLogisticsDraft,
);
distributorRouter.get("/logistics/analytics", authenticate, authorize("distributor:logistics_manage"), setDistributorContext, getDistributorLogisticsAnalytics);

distributorRouter.get("/peer-transfers/eligible-distributors", authenticate, authorize("transfer:distributor_read"), setDistributorContext, getEligiblePeerDistributors);
distributorRouter.get("/peer-transfers", authenticate, authorize("transfer:distributor_read"), setDistributorContext, listPeerTransfers);
distributorRouter.post("/peer-transfers", authenticate, authorize("transfer:distributor_request"), setDistributorContext, createPeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/approve", authenticate, authorize("transfer:distributor_request"), setDistributorContext, approvePeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/reject", authenticate, authorize("transfer:distributor_request"), setDistributorContext, rejectPeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/dispatch", authenticate, authorize("transfer:distributor_request"), setDistributorContext, dispatchPeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/shipments/:shipmentId/receive", authenticate, authorize("transfer:distributor_receive"), setDistributorContext, receivePeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/cancel", authenticate, authorize("transfer:distributor_request"), setDistributorContext, cancelPeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/dispute", authenticate, authorize("transfer:distributor_receive"), setDistributorContext, disputePeerTransfer);
distributorRouter.post("/peer-transfers/:transferId/evidence", authenticate, authorize("transfer:distributor_receive"), setDistributorContext, ...secureEvidenceUpload("evidence"), uploadPeerTransferEvidence);
distributorRouter.get("/peer-transfers/:transferId/evidence/:eventId", authenticate, authorize("transfer:distributor_read"), setDistributorContext, getPeerTransferEvidence);

// B2B wholesale dealer, quotation, order, invoice, and statement operations
distributorRouter.get(
  "/wholesale/dealers",
  authenticate,
  authorize("distributor:dealer_manage"),
  setDistributorContext,
  listWholesaleDealers,
);
distributorRouter.post(
  "/wholesale/dealers",
  authenticate,
  authorize("distributor:dealer_manage"),
  setDistributorContext,
  createWholesaleDealer,
);
distributorRouter.patch(
  "/wholesale/dealers/:dealerId",
  authenticate,
  authorize("distributor:dealer_manage"),
  setDistributorContext,
  updateWholesaleDealer,
);
distributorRouter.get(
  "/wholesale/dealers/:dealerId/detail",
  authenticate,
  authorize("distributor:dealer_manage"),
  setDistributorContext,
  getWholesaleDealerDetail,
);
distributorRouter.get(
  "/wholesale/pricing",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  listWholesalePricing,
);
distributorRouter.get(
  "/wholesale/dealers/:dealerId/documents/:kind/:referenceId",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  getWholesaleDocument,
);
distributorRouter.get(
  "/wholesale/dealers/:dealerId/documents/statement",
  authenticate,
  authorize("distributor:statement_read"),
  setDistributorContext,
  getWholesaleDocument,
);
distributorRouter.post(
  "/wholesale/dealers/:dealerId/contract-prices",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  createWholesaleContractPrice,
);
distributorRouter.post(
  "/wholesale/dealers/:dealerId/payments",
  authenticate,
  authorize("distributor:credit_approve"),
  setDistributorContext,
  recordWholesaleDealerPayment,
);
distributorRouter.get(
  "/wholesale/dealers/:dealerId/statement",
  authenticate,
  authorize("distributor:statement_read"),
  setDistributorContext,
  getWholesaleDealerStatement,
);
distributorRouter.post(
  "/wholesale/price-tiers",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  createWholesaleTier,
);
distributorRouter.post(
  "/wholesale/quotations",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  createWholesaleQuotation,
);
distributorRouter.get(
  "/wholesale/quotations",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  listWholesaleQuotations,
);
distributorRouter.post(
  "/wholesale/quotations/:quotationId/approve",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  approveWholesaleQuotation,
);
distributorRouter.post(
  "/wholesale/quotations/:quotationId/cancel",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  cancelWholesaleQuotation,
);
distributorRouter.post(
  "/wholesale/quotations/:quotationId/convert",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  convertWholesaleQuotation,
);
distributorRouter.get(
  "/wholesale/orders",
  authenticate,
  authorize("distributor:direct_order_read"),
  setDistributorContext,
  listWholesaleOrders,
);
distributorRouter.patch(
  "/wholesale/orders/:orderId/status",
  authenticate,
  authorize("distributor:direct_order_status_update"),
  setDistributorContext,
  updateWholesaleOrderStatus,
);
distributorRouter.post(
  "/wholesale/orders/:orderId/invoice",
  authenticate,
  authorize("distributor:wholesale_manage"),
  setDistributorContext,
  generateWholesaleInvoice,
);

// Profile & Pickup Readiness Setup
distributorRouter.get(
  "/profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorProfile,
);
distributorRouter.get(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorPickupProfile,
);
distributorRouter.post(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  updateDistributorPickupProfile,
);
distributorRouter.put(
  "/pickup-profile",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  updateDistributorPickupProfile,
);

// Availability Toggle (Online / Paused)
distributorRouter.patch(
  "/availability",
  authenticate,
  authorize("distributor:availability_update"),
  setDistributorContext,
  toggleDistributorAvailability,
);

distributorRouter.get(
  "/orders/assigned",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  getAssignedOrders,
);
distributorRouter.get(
  "/orders/ncm",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  getDistributorNcmOrders,
);
distributorRouter.post(
  "/orders/ncm/bulk-book",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  bookDistributorNcmOrders,
);
distributorRouter.post(
  "/orders/:id/hold",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  holdDistributorOrder,
);
distributorRouter.post(
  "/orders/:id/self-delivery",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  selectDistributorSelfDelivery,
);
distributorRouter.post(
  "/orders/:id/delivery-otp",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  requestDistributorDeliveryOtp,
);
distributorRouter.post(
  "/orders/self-delivery/bulk-dispatch",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  bulkDispatchSelfDeliveryOrders,
);
distributorRouter.patch(
  "/orders/:id/status",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  updateSelfDeliveryOrderStatus,
);
distributorRouter.post(
  "/orders/:id/return",
  authenticate,
  authorize("distributor:assignments_read"),
  setDistributorContext,
  ...secureEvidenceUpload("evidence"),
  processDistributorOrderReturn,
);

// Financial Dashboard, Statements & Settlements
distributorRouter.get(
  "/finance/statement",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  getDistributorStatement,
);
distributorRouter.get(
  "/rates",
  authenticate,
  authorize("distributor:profile_read"),
  setDistributorContext,
  listDistributorRates,
);

// Admin Application Review
distributorRouter.get(
  "/admin/applications",
  authenticate,
  authorize("distributor:admin_list"),
  listDistributorApplications,
);
distributorRouter.patch(
  "/admin/applications/:id/review",
  authenticate,
  authorize("distributor:admin_review"),
  reviewDistributorApplication,
);

export default distributorRouter;
