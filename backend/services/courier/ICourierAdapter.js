/**
 * ICourierAdapter
 * Abstract base class / interface for all courier delivery providers.
 * All providers (NCM, Pathao, Bhalo, etc.) must implement these standard methods.
 */
export class ICourierAdapter {
  constructor(providerName = "COURIER") {
    this.providerName = providerName;
  }

  /**
   * Book a shipment for customer delivery or stock transfer.
   * @param {Object} payload Standardized order/transfer booking payload
   * @returns {Promise<{ trackingId: string|number, waybillNumber: string, charge: number|null, rawResponse: any }>}
   */
  async bookDelivery(payload) {
    throw new Error(`bookDelivery() not implemented by ${this.providerName}`);
  }

  /**
   * Cancel an existing shipment booking before pickup.
   * @param {string|number} trackingId
   * @param {string} reason
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async cancelDelivery(trackingId, reason) {
    throw new Error(`cancelDelivery() not implemented by ${this.providerName}`);
  }

  /**
   * Query current shipment tracking state.
   * @param {string|number} trackingId
   * @returns {Promise<{ status: string, location: string, history: Array, codCollected: number|null, raw: any }>}
   */
  async trackDelivery(trackingId) {
    throw new Error(`trackDelivery() not implemented by ${this.providerName}`);
  }

  /**
   * Request a vendor return or return pickup.
   * @param {string|number} trackingId
   * @param {Object} options
   * @returns {Promise<{ returnTrackingId: string|number, success: boolean, message: string }>}
   */
  async requestReturn(trackingId, options = {}) {
    throw new Error(`requestReturn() not implemented by ${this.providerName}`);
  }

  /**
   * Quote dynamic shipping rate for origin/destination district pair.
   * @param {Object} params { originDistrict, destDistrict, weightKg }
   * @returns {Promise<number>} Rate in NPR
   */
  async quoteShippingRate({ originDistrict, destDistrict, weightKg = 1.0 }) {
    throw new Error(`quoteShippingRate() not implemented by ${this.providerName}`);
  }

  /**
   * File a courier dispute / support ticket.
   * @param {Object} ticketPayload
   * @returns {Promise<{ ticketId: string|number, success: boolean }>}
   */
  async createSupportTicket(ticketPayload) {
    throw new Error(`createSupportTicket() not implemented by ${this.providerName}`);
  }
}
