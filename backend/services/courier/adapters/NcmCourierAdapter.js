import { ICourierAdapter } from "../ICourierAdapter.js";
import {
  createOrder as createNcmOrder,
  getShippingRate as getNcmShippingRate,
  getOrderStatus as getNcmOrderStatus,
  requestOrderReturn as requestNcmOrderReturn,
  createCodTransferTicket as createNcmCodTicket,
  extractNcmCharge,
  validateNcmPackageName,
  getNcmErrorMessage,
} from "../../ncmClient.js";

/**
 * NcmCourierAdapter
 * Concrete adapter for Nepal Can Move (NCM) delivery partner.
 */
export class NcmCourierAdapter extends ICourierAdapter {
  constructor() {
    super("NCM");
  }

  /**
   * Books a delivery with NCM.
   */
  async bookDelivery(payload) {
    try {
      const packageType = validateNcmPackageName(payload.packageType || "Box");
      const ncmPayload = {
        name: payload.customerName || payload.name,
        phone: payload.customerPhone || payload.phone,
        address: payload.customerAddress || payload.address,
        destination: payload.destinationBranch || payload.destinationDistrict || payload.destination,
        origin: payload.originBranch || payload.originDistrict || payload.origin,
        cod: Number(payload.codAmount || payload.cod || 0),
        instruction: (payload.instruction || "").slice(0, 255),
        package_name: packageType,
        delivery_type: payload.deliveryType || "Doorstep",
        weight: Number(payload.weight || 1.0),
        v_order_id: payload.vendorOrderId || payload.orderId || payload.transferId || "",
        reference_id: payload.referenceId || payload.orderId || "",
      };

      const response = await createNcmOrder(ncmPayload);
      const data = response?.data || response;
      const trackingId = data?.order_id || data?.id || data?.orderId;
      const charge = extractNcmCharge(response);

      return {
        provider: "NCM",
        trackingId: trackingId ? String(trackingId) : null,
        waybillNumber: data?.waybill || data?.tracking_code || String(trackingId || ""),
        charge: charge != null ? charge : null,
        status: "BOOKED",
        rawResponse: response,
      };
    } catch (error) {
      const readable = getNcmErrorMessage(error);
      const err = new Error(`NCM booking failed: ${readable}`);
      err.code = "NCM_BOOKING_ERROR";
      err.raw = error;
      throw err;
    }
  }

  /**
   * Tracks an NCM order.
   */
  async trackDelivery(trackingId) {
    try {
      const response = await getNcmOrderStatus(trackingId);
      const data = response?.data || response;
      const statusStr = String(data?.status || data?.state || "UNKNOWN").toUpperCase();

      return {
        provider: "NCM",
        trackingId: String(trackingId),
        status: statusStr,
        location: data?.current_branch || data?.location || "",
        history: Array.isArray(data?.history) ? data.history : [],
        codCollected: data?.cod_collected ? Number(data.cod_collected) : null,
        raw: response,
      };
    } catch (error) {
      throw new Error(`NCM tracking lookup failed: ${getNcmErrorMessage(error)}`);
    }
  }

  /**
   * Requests a return with NCM.
   */
  async requestReturn(trackingId, options = {}) {
    try {
      const response = await requestNcmOrderReturn(trackingId, options);
      return {
        provider: "NCM",
        trackingId: String(trackingId),
        success: true,
        rawResponse: response,
      };
    } catch (error) {
      throw new Error(`NCM return request failed: ${getNcmErrorMessage(error)}`);
    }
  }

  /**
   * Quotes shipping rate from NCM API.
   */
  async quoteShippingRate({ originDistrict, destDistrict, weightKg = 1.0 }) {
    try {
      const response = await getNcmShippingRate({
        from: originDistrict,
        to: destDistrict,
        weight: weightKg,
      });
      const charge = extractNcmCharge(response);
      return charge != null && charge > 0 ? charge : 120; // Safe domestic default
    } catch (error) {
      // In case of carrier quote failure, use standard Nepal geographic tier
      return originDistrict?.toLowerCase() === destDistrict?.toLowerCase() ? 80 : 150;
    }
  }

  /**
   * Creates a COD support ticket with NCM.
   */
  async createSupportTicket(ticketPayload) {
    try {
      const response = await createNcmCodTicket(ticketPayload);
      return {
        provider: "NCM",
        ticketId: response?.ticket_id || response?.id || null,
        success: true,
        rawResponse: response,
      };
    } catch (error) {
      throw new Error(`NCM support ticket failed: ${getNcmErrorMessage(error)}`);
    }
  }
}
