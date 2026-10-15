import express from "express";
import {
  adminConfirmSettlement,
  adminListDeliveries,
  adminRequestNcmDeliveryByAssignment,
  adminListSettlements,
  adminSettlementSummary,
  adminRequestSettlement,
  adminReconcileActive,
  adminReconcileDelivery,
  adminResolveNcmHandoff,
  getCustomerDelivery,
  getDelivery,
  getRecentSystemLogs,
  readyForDelivery,
  readyForDeliveryByAssignment,
  receiveWebhook,
  receiveOrderCommentWebhook,
  receiveOrderStatusWebhook,
  requestReturn,
} from "../controllers/deliveryController.js";
import {
  authenticate,
  authorize,
  authorizeAny,
  setManufacturerContext,
  setFulfillmentContext,
} from "../middleware/unifiedAuth.js";
import {
  getAdminNcmDeliveryRecord,
  getAdminSelfDeliveryRecord,
  listAdminSelfDeliveryDistributorsForAdmin,
  listAdminNcmDeliveryRecords,
  listAdminSelfDeliveryRecords,
} from "../controllers/adminDeliveryMonitoringController.js";
import {
  getNcmAdminAssignedBranches,
  getNcmAdminBranches,
  getNcmAdminBulkOrderComments,
  getNcmAdminCustomer,
  getNcmAdminCustomerRatings,
  getNcmAdminCustomers,
  getNcmAdminOrder,
  getNcmAdminOrderComments,
  getNcmAdminOrderLabel,
  getNcmAdminOrderStatus,
  getNcmAdminShippingRate,
  getNcmAdminStaff,
  getNcmAdminSupportTickets,
  getNcmAdminTicket,
  postNcmAdminBulkOrderStatuses,
  postNcmAdminOrderComment,
  postNcmAdminOrderLabels,
  postNcmAdminRedirectOrder,
  postNcmAdminTicket,
  postNcmAdminTicketClose,
  postNcmAdminTicketResponse,
  postNcmAdminWebhookConfiguration,
  postNcmAdminWebhookTest,
  postNcmAdminCompareStatuses,
} from "../controllers/ncmAdminController.js";

const deliveryRouter = express.Router();

deliveryRouter.post("/webhook/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/ncm", receiveOrderStatusWebhook);
deliveryRouter.post("/", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-status", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook/ncm/order-comment", receiveOrderCommentWebhook);
deliveryRouter.post("/ncm-webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/webhook", receiveOrderStatusWebhook);
deliveryRouter.post("/manufacturer/ready", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDelivery);
deliveryRouter.post("/job/ready/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/job/ready-for-pickup/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/ready-for-pickup/:id", authenticate, authorizeAny("distributor:delivery_ready", "manufacturer:delivery_ready"), setFulfillmentContext, readyForDeliveryByAssignment);
deliveryRouter.post("/manufacturer/return", authenticate, authorizeAny("distributor:delivery_return", "manufacturer:delivery_return"), setFulfillmentContext, requestReturn);
deliveryRouter.get("/customer/:id", authenticate, authorize("customer:delivery_read"), getCustomerDelivery);
deliveryRouter.get("/admin", authenticate, authorize("delivery:admin_list"), adminListDeliveries);
deliveryRouter.get("/admin/ncm/deliveries", authenticate, authorize("delivery:admin_list"), listAdminNcmDeliveryRecords);
deliveryRouter.get("/admin/ncm/deliveries/:id", authenticate, authorize("delivery:admin_detail"), getAdminNcmDeliveryRecord);
deliveryRouter.get("/admin/self-deliveries", authenticate, authorize("delivery:admin_list"), listAdminSelfDeliveryRecords);
deliveryRouter.get("/admin/self-deliveries/distributors", authenticate, authorize("delivery:admin_list"), listAdminSelfDeliveryDistributorsForAdmin);
deliveryRouter.get("/admin/self-deliveries/:id", authenticate, authorize("delivery:admin_detail"), getAdminSelfDeliveryRecord);
deliveryRouter.get("/admin/ncm/branches", authenticate, authorize("delivery:admin_list"), getNcmAdminBranches);
deliveryRouter.get("/admin/ncm/assigned-branches", authenticate, authorize("delivery:admin_list"), getNcmAdminAssignedBranches);
deliveryRouter.get("/admin/ncm/staff", authenticate, authorize("delivery:admin_list"), getNcmAdminStaff);
deliveryRouter.get("/admin/ncm/shipping-rate", authenticate, authorize("delivery:admin_list"), getNcmAdminShippingRate);
deliveryRouter.get("/admin/ncm/comments", authenticate, authorize("delivery:admin_list"), getNcmAdminBulkOrderComments);
deliveryRouter.get("/admin/ncm/orders/:orderId", authenticate, authorize("delivery:admin_detail"), getNcmAdminOrder);
deliveryRouter.get("/admin/ncm/orders/:orderId/status", authenticate, authorize("delivery:admin_detail"), getNcmAdminOrderStatus);
deliveryRouter.get("/admin/ncm/orders/:orderId/comments", authenticate, authorize("delivery:admin_detail"), getNcmAdminOrderComments);
deliveryRouter.get("/admin/ncm/orders/:orderId/label", authenticate, authorize("delivery:admin_detail"), getNcmAdminOrderLabel);
deliveryRouter.post("/admin/ncm/orders/labels", authenticate, authorize("delivery:admin_detail"), postNcmAdminOrderLabels);
deliveryRouter.post("/admin/ncm/orders/statuses", authenticate, authorize("delivery:admin_detail"), postNcmAdminBulkOrderStatuses);
deliveryRouter.post("/admin/ncm/orders/comments", authenticate, authorize("delivery:reconcile"), postNcmAdminOrderComment);
deliveryRouter.post("/admin/ncm/orders/compare-statuses", authenticate, authorize("delivery:admin_detail"), postNcmAdminCompareStatuses);
deliveryRouter.post("/admin/ncm/deliveries/:deliveryId/redirect", authenticate, authorize("delivery:reconcile"), postNcmAdminRedirectOrder);
deliveryRouter.post("/admin/ncm/webhook", authenticate, authorize("delivery:reconcile"), postNcmAdminWebhookConfiguration);
deliveryRouter.post("/admin/ncm/webhook/test", authenticate, authorize("delivery:reconcile"), postNcmAdminWebhookTest);
deliveryRouter.post("/admin/ncm/tickets", authenticate, authorize("delivery:reconcile"), postNcmAdminTicket);
deliveryRouter.get("/admin/ncm/tickets", authenticate, authorize("delivery:admin_list"), getNcmAdminSupportTickets);
deliveryRouter.get("/admin/ncm/tickets/:ticketId", authenticate, authorize("delivery:admin_detail"), getNcmAdminTicket);
deliveryRouter.post("/admin/ncm/tickets/:ticketId/response", authenticate, authorize("delivery:reconcile"), postNcmAdminTicketResponse);
deliveryRouter.post("/admin/ncm/tickets/:ticketId/close", authenticate, authorize("delivery:reconcile"), postNcmAdminTicketClose);
deliveryRouter.get("/admin/ncm/customers", authenticate, authorize("delivery:admin_list"), getNcmAdminCustomers);
deliveryRouter.get("/admin/ncm/customers/:customerId", authenticate, authorize("delivery:admin_detail"), getNcmAdminCustomer);
deliveryRouter.get("/admin/ncm/ratings", authenticate, authorize("delivery:admin_detail"), getNcmAdminCustomerRatings);
deliveryRouter.post("/admin/assignment/:id/ncm", authenticate, authorize("assignment:admin_list"), adminRequestNcmDeliveryByAssignment);
deliveryRouter.get("/admin/settlements", authenticate, authorize("delivery:settlements_read"), adminListSettlements);
deliveryRouter.get("/admin/settlements/summary", authenticate, authorize("delivery:settlement_summary"), adminSettlementSummary);
deliveryRouter.post("/admin/settlements/request", authenticate, authorize("delivery:settlement_request"), adminRequestSettlement);
deliveryRouter.post("/admin/settlements/confirm", authenticate, authorize("delivery:settlement_request"), adminConfirmSettlement);
deliveryRouter.get("/admin/logs", authenticate, authorize("delivery:logs_read"), getRecentSystemLogs);
deliveryRouter.get("/admin/:id", authenticate, authorize("delivery:admin_detail"), getDelivery);
deliveryRouter.post("/admin/:id/reconcile", authenticate, authorize("delivery:reconcile"), adminReconcileDelivery);
deliveryRouter.post("/admin/:id/resolve-ncm-handoff", authenticate, authorize("delivery:ncm_handoff_recover"), adminResolveNcmHandoff);
deliveryRouter.post("/admin/reconcile-active", authenticate, authorize("delivery:reconcile"), adminReconcileActive);


export default deliveryRouter;
