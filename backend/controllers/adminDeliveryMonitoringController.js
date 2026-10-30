import {
  getAdminNcmDeliveryDetails,
  getAdminSelfDeliveryDetails,
  listAdminNcmDeliveries,
  listAdminSelfDeliveries,
  listAdminSelfDeliveryDistributors,
  recordAdminNcmDeliveryPricing,
} from "../services/adminDeliveryMonitoringService.js";

const sendFailure = (res, error, fallbackMessage) =>
  res.status(error.statusCode || 500).json({
    success: false,
    code: error.code || "DELIVERY_MONITOR_ERROR",
    message: error.message || fallbackMessage,
  });

export const listAdminNcmDeliveryRecords = async (req, res) => {
  try {
    return res.json(await listAdminNcmDeliveries(req.query));
  } catch (error) {
    return sendFailure(res, error, "Failed to list NCM deliveries.");
  }
};

export const getAdminNcmDeliveryRecord = async (req, res) => {
  try {
    const result = await getAdminNcmDeliveryDetails(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "NCM delivery not found." });
    return res.json(result);
  } catch (error) {
    return sendFailure(res, error, "Failed to load NCM delivery details.");
  }
};

export const recordAdminNcmDeliveryPricingController = async (req, res) => {
  try {
    const result = await recordAdminNcmDeliveryPricing({
      deliveryId: req.params.deliveryId,
      chargeBeforeDiscount: req.body?.chargeBeforeDiscount,
      discountAmount: req.body?.discountAmount,
      note: req.body?.note,
      actorAccountId: req.auth?.accountId || req.auth?.userId || null,
    });
    return res.json(result);
  } catch (error) {
    return sendFailure(res, error, "Failed to record NCM delivery pricing.");
  }
};

export const listAdminSelfDeliveryRecords = async (req, res) => {
  try {
    return res.json(await listAdminSelfDeliveries(req.query));
  } catch (error) {
    return sendFailure(res, error, "Failed to list distributor self-deliveries.");
  }
};

export const listAdminSelfDeliveryDistributorsForAdmin = async (req, res) => {
  try {
    return res.json(await listAdminSelfDeliveryDistributors(req.query));
  } catch (error) {
    return sendFailure(res, error, "Failed to list self-delivery distributors.");
  }
};

export const getAdminSelfDeliveryRecord = async (req, res) => {
  try {
    const result = await getAdminSelfDeliveryDetails(req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Distributor self-delivery not found.",
      });
    }
    return res.json(result);
  } catch (error) {
    return sendFailure(res, error, "Failed to load self-delivery details.");
  }
};
